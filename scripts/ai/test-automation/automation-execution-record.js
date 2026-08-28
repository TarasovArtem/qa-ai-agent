/**
 * AutomationExecutionRecord v1 (Roadmap #23G - "Controlled Execution +
 * Bounded Regeneration Loop"). #23G is a PROPOSED/PINNED roadmap
 * identifier, adopted by this implementation - it is the next stage after
 * #23F (COMPLETE_ON_MAIN).
 *
 * Deterministic EVIDENCE of one controlled-execution attempt of an
 * already-applied GeneratedChangeSet - what exact AppliedChangeSetRecord
 * was executed, through which allowlisted framework runner, and what the
 * bounded outcome was. It is the closing artifact of the execution stage of
 * the #23 authority chain, never a new authority itself.
 *
 * EVIDENCE, NOT AUTHORIZATION: a `status: "PASSED"` record means only that
 * controlled-execution.js's own bounded child process exited 0 within the
 * configured timeout and output bounds. It does NOT mean the executed code
 * is free of defects the test itself didn't catch, that the external SUT
 * behaved correctly, that no further authority (Git/PR/merge/deploy) is
 * granted, or any host/reviewer/human identity. This module itself performs
 * ZERO process execution and ZERO outcome decisions - it only validates the
 * SHAPE of a caller-supplied outcome description and computes a
 * tamper-evident digest over it. Whether the described execution actually
 * happened is entirely controlled-execution.js's own responsibility.
 *
 * NO ABSOLUTE HOST PATHS: this record never carries repositoryRoot or any
 * other absolute host filesystem path - only the bounded, already-sanitized
 * evidence fields listed below.
 *
 * DIGEST IS INTEGRITY, NOT AUTHENTICITY (same limitation every #22F/#23D/
 * #23E/#23F digest already documents): `recordDigest` is a plain, unkeyed
 * SHA-256 domain-separated content digest - it proves this exact object's
 * fields have not been altered since being serialized in this shape. It
 * does NOT prove the described execution actually occurred on any specific
 * host, that the process which ran it was legitimate, or any human/host
 * identity - a caller with require-access to this module's own exported
 * `computeDigest`/`DIGEST_LABEL_RECORD` can hand-construct an arbitrary
 * self-consistent-digest AutomationExecutionRecord-shaped object, exactly
 * like every other digest in this repository's #22F/#23D/#23E/#23F chain.
 * This record is evidence for a human/future stage to inspect, never a
 * capability grant.
 *
 * This module never calls a provider, never touches the filesystem,
 * network, git, or child_process, and never mutates the repository - it
 * validates shape and returns data only.
 */

"use strict";

const crypto = require("node:crypto");

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId } = require("../generation/primitives");

const KIND = "AutomationExecutionRecord";
const SCHEMA_VERSION = 1;

const SUPPORTED_FRAMEWORKS = Object.freeze(["cypress", "playwright"]);

// Closed status vocabulary (Roadmap #23G Section 29): distinguishes "the
// process ran and the test outcome was X" from "execution could not be
// safely attempted at all" - the latter never reaches this module (see
// controlled-execution.js's own REJECTED_PRECONDITION-style {ok:false,
// errors} contract, which never builds a record).
const STATUSES = Object.freeze(["PASSED", "TEST_FAILED", "EXECUTION_ERROR", "TIMED_OUT"]);

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "projectId",
  "appliedChangeSetRecordDigest",
  "framework",
  "command",
  "status",
  "exitCode",
  "timedOut",
  "stdout",
  "stderr",
  "startedAt",
  "completedAt",
]);
const OUTPUT_ALLOWED_KEYS = Object.freeze(["text", "truncated"]);

// Roadmap #23G Section 26: bounded evidence text - never the raw unbounded
// child output. Chosen well below generation/limits.js's own
// LONG_TEXT_MAX_LENGTH (4000) headroom class, since this is diagnostic
// evidence, not primary generated content, and must stay comfortably
// embeddable in a bounded provider prompt for a future regeneration
// decision without itself needing a second truncation pass there.
const MAX_OUTPUT_TEXT_LENGTH = 4000;
const MAX_COMMAND_LENGTH = 300;

const DOMAIN_PREFIX = "qa-ai-agent:";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DIGEST_LABEL_RECORD = "automation-execution-record:v1";

// --- canonical snapshot / digest primitives -------------------------------
//
// Roadmap #23G: a FRESH, independent reimplementation of the same hardened
// pattern #22F/#23D/#23E/#23F each already established - never imported
// from any of them, matching this repository's own "small duplicated
// primitives, not a shared refactor" convention across every roadmap-stage
// boundary so far.

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function defineOwnSnapshotProperty(out, key, value) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

const CYCLE = Symbol("qa-ai-agent:automation-execution-record:cycle-detected");

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

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
function isValidTimestamp(value) {
  return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value);
}

function isBoundedText(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength;
}

function validateOutputField(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  const unknown = Object.keys(value).filter((k) => !OUTPUT_ALLOWED_KEYS.includes(k));
  unknown.forEach((k) => errors.push(err(`${path}.${k}`, ERROR_CODES.UNKNOWN_FIELD, `${path}.${k} is not a recognized field`)));
  if (!isBoundedText(value.text, MAX_OUTPUT_TEXT_LENGTH)) {
    errors.push(err(`${path}.text`, ERROR_CODES.INVALID_VALUE, `${path}.text must be a bounded string of at most ${MAX_OUTPUT_TEXT_LENGTH} characters`));
  }
  if (typeof value.truncated !== "boolean") {
    errors.push(err(`${path}.truncated`, ERROR_CODES.INVALID_TYPE, `${path}.truncated must be a boolean`));
  }
}

/**
 * Builds one AutomationExecutionRecord v1 from a caller-described execution
 * outcome. INTERNAL builder: called only by controlled-execution.js, after
 * it has already independently performed and bounded a real child-process
 * execution - this function itself never spawns a process and never
 * decides what happened, only validates the SHAPE of what its caller
 * reports and computes a tamper-evident digest over it.
 *
 * `input` shape: { projectId, appliedChangeSetRecordDigest, framework,
 * command, status, exitCode, timedOut, stdout, stderr, startedAt,
 * completedAt }.
 *
 * Returns `{ ok: true, automationExecutionRecord }` or `{ ok: false, errors }`.
 */
function buildAutomationExecutionRecord(input) {
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
  if (!isValidDigest(snapshot.appliedChangeSetRecordDigest)) {
    errors.push(err("$.appliedChangeSetRecordDigest", ERROR_CODES.INVALID_VALUE, "$.appliedChangeSetRecordDigest must be a valid sha256:<64 lowercase hex> digest"));
  }
  if (!SUPPORTED_FRAMEWORKS.includes(snapshot.framework)) {
    errors.push(err("$.framework", ERROR_CODES.INVALID_ENUM, `$.framework must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
  }
  if (!isBoundedText(snapshot.command, MAX_COMMAND_LENGTH) || snapshot.command.length === 0) {
    errors.push(err("$.command", ERROR_CODES.INVALID_VALUE, `$.command must be a bounded, non-empty string of at most ${MAX_COMMAND_LENGTH} characters`));
  }
  if (!STATUSES.includes(snapshot.status)) {
    errors.push(err("$.status", ERROR_CODES.INVALID_ENUM, `$.status must be one of ${STATUSES.join(", ")}`));
  }
  // exitCode: an integer when the process actually produced one, or null
  // (TIMED_OUT / EXECUTION_ERROR before/without a real exit).
  if (snapshot.exitCode !== null && !(typeof snapshot.exitCode === "number" && Number.isInteger(snapshot.exitCode))) {
    errors.push(err("$.exitCode", ERROR_CODES.INVALID_VALUE, "$.exitCode must be null or an integer"));
  }
  if (typeof snapshot.timedOut !== "boolean") {
    errors.push(err("$.timedOut", ERROR_CODES.INVALID_TYPE, "$.timedOut must be a boolean"));
  }
  validateOutputField(snapshot.stdout, "$.stdout", errors);
  validateOutputField(snapshot.stderr, "$.stderr", errors);
  if (!isValidTimestamp(snapshot.startedAt)) {
    errors.push(err("$.startedAt", ERROR_CODES.INVALID_VALUE, "$.startedAt must be a UTC ISO-8601 timestamp"));
  }
  if (!isValidTimestamp(snapshot.completedAt)) {
    errors.push(err("$.completedAt", ERROR_CODES.INVALID_VALUE, "$.completedAt must be a UTC ISO-8601 timestamp"));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Roadmap #23G-C1 (closes 23G-RV-5): cross-field semantic coherence, not
  // merely independent per-field shape. Every branch below reflects an
  // ACTUAL reachable outcome of controlled-execution.js's own real
  // status-derivation logic (never an invented/stricter-than-reality rule):
  //   spawnError -> EXECUTION_ERROR (exitCode always null on this path)
  //   else timedOut -> TIMED_OUT (exitCode may still be null or a real
  //     integer, since the child's 'close' event can race the kill signal)
  //   else exitCode===0 -> PASSED (timedOut is necessarily false here,
  //     since the timedOut branch above already takes priority)
  //   else -> TEST_FAILED (timedOut is necessarily false; exitCode is
  //     usually a non-zero integer, but Node's 'close' event reports a
  //     null code when the process was terminated by an external signal
  //     rather than exiting on its own, so null remains valid here too)
  if (snapshot.status === "PASSED" && (snapshot.exitCode !== 0 || snapshot.timedOut !== false)) {
    errors.push(err("$", ERROR_CODES.INVARIANT_VIOLATION, "a PASSED record requires exitCode 0 and timedOut false"));
  }
  if (snapshot.status === "TEST_FAILED" && (snapshot.timedOut !== false || (snapshot.exitCode !== null && snapshot.exitCode === 0))) {
    errors.push(err("$", ERROR_CODES.INVARIANT_VIOLATION, "a TEST_FAILED record requires timedOut false and a non-zero (or null) exitCode"));
  }
  if (snapshot.status === "TIMED_OUT" && snapshot.timedOut !== true) {
    errors.push(err("$", ERROR_CODES.INVARIANT_VIOLATION, "a TIMED_OUT record requires timedOut true"));
  }
  if (snapshot.status === "EXECUTION_ERROR" && snapshot.exitCode !== null) {
    errors.push(err("$", ERROR_CODES.INVARIANT_VIOLATION, "an EXECUTION_ERROR record requires a null exitCode"));
  }
  if (errors.length === 0 && isValidTimestamp(snapshot.startedAt) && isValidTimestamp(snapshot.completedAt)) {
    if (new Date(snapshot.completedAt).getTime() < new Date(snapshot.startedAt).getTime()) {
      errors.push(err("$.completedAt", ERROR_CODES.INVARIANT_VIOLATION, "$.completedAt must not be earlier than $.startedAt"));
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const recordContent = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    projectId: snapshot.projectId,
    appliedChangeSetRecordDigest: snapshot.appliedChangeSetRecordDigest,
    framework: snapshot.framework,
    command: snapshot.command,
    status: snapshot.status,
    exitCode: snapshot.exitCode,
    timedOut: snapshot.timedOut,
    stdout: snapshot.stdout,
    stderr: snapshot.stderr,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
  };

  const recordDigest = computeDigest(DIGEST_LABEL_RECORD, recordContent);

  return { ok: true, automationExecutionRecord: deepFreeze({ ...recordContent, recordDigest }) };
}

function recomputeAutomationExecutionRecordDigest(automationExecutionRecord) {
  if (!isPlainObject(automationExecutionRecord)) return null;
  const { recordDigest, ...rest } = automationExecutionRecord;
  try {
    return computeDigest(DIGEST_LABEL_RECORD, rest);
  } catch {
    return null;
  }
}

module.exports = {
  KIND,
  SCHEMA_VERSION,
  SUPPORTED_FRAMEWORKS,
  STATUSES,
  MAX_OUTPUT_TEXT_LENGTH,
  MAX_COMMAND_LENGTH,
  DIGEST_PATTERN,
  DIGEST_LABEL_RECORD,
  isValidDigest,
  isValidTimestamp,
  computeDigest,
  snapshotOwnData,
  deepFreeze,
  buildAutomationExecutionRecord,
  recomputeAutomationExecutionRecordDigest,
};
