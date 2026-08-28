/**
 * AppliedChangeSetRecord v1 (Roadmap #23F).
 *
 * Deterministic EVIDENCE of one application attempt of an already-approved
 * GeneratedChangeSet against the real repository filesystem - what exact
 * approved proposal was attempted, what changes actually reached the
 * filesystem, what resulting content digests exist, and the overall
 * application outcome. It is the closing artifact of the #23 authority
 * chain (AutomationPlan -> GeneratedChangeSet -> GeneratedChangeSetReviewPackage
 * -> GeneratedChangeSetReviewRecord -> #23F application), never a new
 * authority itself.
 *
 * EVIDENCE, NOT AUTHORIZATION: a successful `status: "APPLIED"` record means
 * only that change-set-application.js's own real filesystem writes
 * completed and were verified by re-reading the resulting bytes. It does
 * NOT mean the written files are syntactically valid, will pass, are safe
 * to commit/push, or may be executed - #23F never runs generated code, never
 * touches Git, and never calls a provider (see change-set-application.js's
 * own authority-separation docstring). This module itself performs ZERO
 * filesystem access and ZERO application-outcome decisions - it only
 * validates the SHAPE of a caller-supplied outcome description and computes
 * a tamper-evident digest over it. Whether the described outcome actually
 * happened on disk is entirely change-set-application.js's own
 * responsibility, verified there via real post-write reads before this
 * module is ever called.
 *
 * NO ABSOLUTE HOST PATHS: every `changes[].path` is the same repository-
 * relative path already carried by the reviewed GeneratedChangeSet -
 * `repositoryRoot` (an absolute host filesystem path, private to the
 * runtime that performed the application) is never included in this record
 * in any form, to avoid leaking host filesystem layout into a persisted
 * artifact (Roadmap #23F Section 58/59).
 *
 * DIGEST IS INTEGRITY, NOT AUTHENTICITY (same limitation #22F/#23D/#23E
 * already document for their own digests): `recordDigest` is a plain,
 * unkeyed SHA-256 domain-separated content digest - it proves this exact
 * object's fields have not been altered since being serialized in this
 * shape. It does NOT prove that the described filesystem writes actually
 * occurred, that the process which ran them was legitimate, or any host/
 * machine identity - a caller with require-access to this module's own
 * exported `computeDigest`/`DIGEST_LABEL_RECORD` can hand-construct an
 * arbitrary self-consistent-digest AppliedChangeSetRecord-shaped object,
 * exactly like every other digest in this repository's #22F/#23D/#23E
 * chain. This record is evidence for a future consumer (e.g. #23G) to
 * inspect, never a capability grant.
 *
 * This module never calls an AI provider, never touches the filesystem,
 * network, git, or child_process, and never mutates the repository - it
 * validates shape and returns data only.
 */

"use strict";

const crypto = require("node:crypto");

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId } = require("../generation/primitives");
const { LIMITS: GENERATION_LIMITS } = require("../generation/limits");

const KIND = "AppliedChangeSetRecord";
const SCHEMA_VERSION = 1;

const CHANGE_OPERATIONS = Object.freeze(["CREATE", "MODIFY"]);
// A per-change entry only ever appears in a record once change-set-
// application.js's own mutation phase was reached for it - "APPLIED" (write
// verified), "ROLLED_BACK" (a later failure in the same batch triggered
// compensation that verifiably succeeded for this entry), or
// "ROLLBACK_INCOMPLETE" (compensation for this entry could not be safely
// completed - see change-set-application.js Section on rollback races).
const CHANGE_STATUSES = Object.freeze(["APPLIED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"]);
// Overall record status. There is deliberately no "REJECTED_PRECONDITION"
// value here - a precondition rejection (zero writes ever attempted) never
// reaches buildAppliedChangeSetRecord() at all (Roadmap #23F Section 62:
// no AppliedChangeSetRecord unless an application attempt reached the
// mutation phase) - change-set-application.js reports that case as a plain
// bounded error result with no record.
const RECORD_STATUSES = Object.freeze(["APPLIED", "APPLICATION_FAILED_ROLLED_BACK", "APPLICATION_FAILED_ROLLBACK_INCOMPLETE"]);

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "projectId",
  "changeSetDigest",
  "reviewPackageDigest",
  "reviewRecordDigest",
  "changes",
  "status",
  "appliedAt",
]);
const CHANGE_ALLOWED_KEYS = Object.freeze(["operation", "path", "beforeDigest", "afterDigest", "status"]);

// Reuses the SAME upper bound GeneratedChangeSet v1 itself already enforces
// on `changes.length` (never a separately-maintained duplicate) - an
// applied-record's own change count can never legitimately exceed the
// change set it is evidence for.
const LIMITS = Object.freeze({ MAX_CHANGES: GENERATION_LIMITS.MAX_PLANNED_CHANGES });

// --- canonical snapshot / digest primitives -------------------------------
//
// Roadmap #23F: a FRESH, independent reimplementation of the same hardened
// pattern #22F/#23D/#23E each already established (Object.create(null) +
// Object.defineProperty record snapshotting, manual-indexed dense-array
// copying, an explicit `ancestors`-based cycle guard) - never imported from
// #23D/#23E, matching this repository's own established "small duplicated
// primitives, not a shared refactor" convention across every roadmap-stage
// boundary so far. #23F's own inputs (the `changes` description handed to
// buildAppliedChangeSetRecord() by change-set-application.js) are snapshotted
// through this exact same trust boundary as every other stage's caller
// input, even though in practice change-set-application.js is this
// repository's own trusted caller - defense in depth, and parity with
// precedent.

const DOMAIN_PREFIX = "qa-ai-agent:";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DIGEST_LABEL_RECORD = "applied-change-set-record:v1";

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function defineOwnSnapshotProperty(out, key, value) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

const CYCLE = Symbol("qa-ai-agent:applied-change-set-record:cycle-detected");

function snapshotValue(value, ancestors) {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return CYCLE;

  if (Array.isArray(value)) {
    ancestors.add(value);
    const length = value.length;
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
      ancestors.delete(value);
      return null;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      ancestors.delete(value);
      return null;
    }
    const ownKeys = Object.keys(value);
    if (ownKeys.length !== length) {
      ancestors.delete(value);
      return null;
    }
    for (let i = 0; i < length; i += 1) {
      if (ownKeys[i] !== String(i)) {
        ancestors.delete(value);
        return null;
      }
    }
    const out = new Array(length);
    for (let i = 0; i < length; i += 1) {
      const key = String(i);
      const snapshotted = snapshotValue(value[key], ancestors);
      if (snapshotted === CYCLE) {
        ancestors.delete(value);
        return CYCLE;
      }
      defineOwnSnapshotProperty(out, key, snapshotted);
    }
    ancestors.delete(value);
    return out;
  }

  if (!isPlainRecord(value)) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;

  ancestors.add(value);
  const out = Object.create(null);
  for (const key of Object.keys(value)) {
    const snapshotted = snapshotValue(value[key], ancestors);
    if (snapshotted === CYCLE) {
      ancestors.delete(value);
      return CYCLE;
    }
    defineOwnSnapshotProperty(out, key, snapshotted);
  }
  ancestors.delete(value);
  return out;
}

function snapshotOwnData(value) {
  try {
    const result = snapshotValue(value, new Set());
    return result === CYCLE ? null : result;
  } catch {
    return null;
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

function canonicalStringify(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalStringify: non-finite number is not valid digest input");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
  }
  throw new Error("canonicalStringify: unsupported value type for digest input");
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function computeDigest(label, value) {
  return `sha256:${sha256Hex(`${DOMAIN_PREFIX}${label}:${canonicalStringify(value)}`)}`;
}

function isValidDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

// UTC-only ISO-8601 timestamp - identical convention to #22F's/#23E's own
// isValidTimestamp(). Caller-supplied (matches #23E's reviewedAt precedent:
// this module never implicitly calls Date.now() - determinism of the
// record's own shape/digest never depends on wall-clock time).
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
function isValidTimestamp(value) {
  return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value);
}

function isValidDigestOrNull(value) {
  return value === null || isValidDigest(value);
}

// Repository-relative path shape only - #23F's own change-set-application.js
// has already independently re-validated every path's full safety
// (containment/traversal/symlink) against the real filesystem before this
// module is ever reached; this is a bounded shape check only, not a second
// security gate.
function isBoundedRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function validateAppliedChange(change, path, errors) {
  if (!isPlainObject(change)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  const unknown = Object.keys(change).filter((k) => !CHANGE_ALLOWED_KEYS.includes(k));
  unknown.forEach((k) => errors.push(err(`${path}.${k}`, ERROR_CODES.UNKNOWN_FIELD, `${path}.${k} is not a recognized field`)));

  if (!CHANGE_OPERATIONS.includes(change.operation)) {
    errors.push(err(`${path}.operation`, ERROR_CODES.INVALID_ENUM, `${path}.operation must be one of ${CHANGE_OPERATIONS.join(", ")}`));
  }
  if (!isBoundedRelativePath(change.path)) {
    errors.push(err(`${path}.path`, ERROR_CODES.INVALID_PATH, `${path}.path must be a bounded, non-empty repository-relative path string`));
  }
  // beforeDigest: null for CREATE (there was no prior content), a valid
  // digest for MODIFY (the actual pre-write content digest that was
  // verified immediately before mutation).
  if (!isValidDigestOrNull(change.beforeDigest)) {
    errors.push(err(`${path}.beforeDigest`, ERROR_CODES.INVALID_VALUE, `${path}.beforeDigest must be null or a valid sha256:<64 lowercase hex> digest`));
  }
  // afterDigest: the resulting content digest, verified by re-reading the
  // actual written bytes - null only when status is ROLLBACK_INCOMPLETE and
  // the resulting on-disk state could not be safely determined by the
  // caller, or when a compensating rollback removed a CREATE entirely.
  if (!isValidDigestOrNull(change.afterDigest)) {
    errors.push(err(`${path}.afterDigest`, ERROR_CODES.INVALID_VALUE, `${path}.afterDigest must be null or a valid sha256:<64 lowercase hex> digest`));
  }
  if (!CHANGE_STATUSES.includes(change.status)) {
    errors.push(err(`${path}.status`, ERROR_CODES.INVALID_ENUM, `${path}.status must be one of ${CHANGE_STATUSES.join(", ")}`));
  }
}

/**
 * Builds one AppliedChangeSetRecord v1 from a caller-described application
 * outcome. INTERNAL builder: called only by change-set-application.js,
 * after it has already independently performed and verified (or rolled
 * back) every real filesystem operation - this function itself never
 * touches the filesystem and never decides what happened, only validates
 * the SHAPE of what its caller reports and computes a tamper-evident digest
 * over it.
 *
 * `input` shape: { projectId, changeSetDigest, reviewPackageDigest,
 * reviewRecordDigest, changes, status, appliedAt }.
 *
 * Returns `{ ok: true, appliedChangeSetRecord }` or `{ ok: false, errors }`.
 */
function buildAppliedChangeSetRecord(input) {
  let snapshot;
  try {
    snapshot = snapshotOwnData(input);
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "input could not be read")] };
  }

  const errors = [];

  if (!isPlainRecord(snapshot)) {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "$ must be an object")] };
  }
  const unknown = Object.keys(snapshot).filter((k) => !TOP_LEVEL_ALLOWED_KEYS.includes(k));
  unknown.forEach((k) => errors.push(err(`$.${k}`, ERROR_CODES.UNKNOWN_FIELD, `$.${k} is not a recognized field`)));

  if (!isValidId(snapshot.projectId)) {
    errors.push(err("$.projectId", ERROR_CODES.INVALID_TYPE, "$.projectId must be a bounded string id"));
  }
  if (!isValidDigest(snapshot.changeSetDigest)) {
    errors.push(err("$.changeSetDigest", ERROR_CODES.INVALID_VALUE, "$.changeSetDigest must be a valid sha256:<64 lowercase hex> digest"));
  }
  if (!isValidDigest(snapshot.reviewPackageDigest)) {
    errors.push(err("$.reviewPackageDigest", ERROR_CODES.INVALID_VALUE, "$.reviewPackageDigest must be a valid sha256:<64 lowercase hex> digest"));
  }
  if (!isValidDigest(snapshot.reviewRecordDigest)) {
    errors.push(err("$.reviewRecordDigest", ERROR_CODES.INVALID_VALUE, "$.reviewRecordDigest must be a valid sha256:<64 lowercase hex> digest"));
  }
  if (!RECORD_STATUSES.includes(snapshot.status)) {
    errors.push(err("$.status", ERROR_CODES.INVALID_ENUM, `$.status must be one of ${RECORD_STATUSES.join(", ")}`));
  }
  if (!isValidTimestamp(snapshot.appliedAt)) {
    errors.push(err("$.appliedAt", ERROR_CODES.INVALID_VALUE, "$.appliedAt must be a UTC ISO-8601 timestamp"));
  }

  if (!Array.isArray(snapshot.changes)) {
    errors.push(err("$.changes", ERROR_CODES.MISSING_FIELD, "$.changes must be an array"));
  } else if (snapshot.changes.length === 0) {
    errors.push(err("$.changes", ERROR_CODES.MISSING_FIELD, "$.changes must not be empty"));
  } else if (snapshot.changes.length > LIMITS.MAX_CHANGES) {
    errors.push(err("$.changes", ERROR_CODES.INVALID_VALUE, `$.changes exceeds the maximum of ${LIMITS.MAX_CHANGES}`));
  } else {
    const seenPaths = new Set();
    snapshot.changes.forEach((change, i) => {
      const itemPath = `$.changes[${i}]`;
      validateAppliedChange(change, itemPath, errors);
      if (isPlainObject(change) && typeof change.path === "string") {
        if (seenPaths.has(change.path)) {
          errors.push(err(`${itemPath}.path`, ERROR_CODES.DUPLICATE_ID, `${itemPath}.path duplicates another entry in this record`));
        }
        seenPaths.add(change.path);
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const recordContent = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    projectId: snapshot.projectId,
    changeSetDigest: snapshot.changeSetDigest,
    reviewPackageDigest: snapshot.reviewPackageDigest,
    reviewRecordDigest: snapshot.reviewRecordDigest,
    changes: snapshot.changes,
    status: snapshot.status,
    appliedAt: snapshot.appliedAt,
  };

  const recordDigest = computeDigest(DIGEST_LABEL_RECORD, recordContent);

  return { ok: true, appliedChangeSetRecord: deepFreeze({ ...recordContent, recordDigest }) };
}

/**
 * Recomputes an applied record's own digest from its content (excluding the
 * stored digest field itself) - never trusts the stored value.
 */
function recomputeAppliedChangeSetRecordDigest(appliedChangeSetRecord) {
  if (!isPlainObject(appliedChangeSetRecord)) return null;
  const { recordDigest, ...rest } = appliedChangeSetRecord;
  try {
    return computeDigest(DIGEST_LABEL_RECORD, rest);
  } catch {
    return null;
  }
}

module.exports = {
  KIND,
  SCHEMA_VERSION,
  LIMITS,
  CHANGE_OPERATIONS,
  CHANGE_STATUSES,
  RECORD_STATUSES,
  DIGEST_PATTERN,
  DIGEST_LABEL_RECORD,
  isValidDigest,
  isValidTimestamp,
  computeDigest,
  snapshotOwnData,
  deepFreeze,
  buildAppliedChangeSetRecord,
  recomputeAppliedChangeSetRecordDigest,
};
