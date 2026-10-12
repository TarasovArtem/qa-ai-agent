/** Gate-free #23E v1 builder: pure code motion for Stage 4; semantics unchanged. */
"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId, isBoundedText } = require("../generation/primitives");
const { LIMITS: GENERATION_LIMITS } = require("../generation/limits");
const { OPERATIONS, isSafeRepoRelativePath, isCanonicalPlanPath } = require("../generation/automation-plan");
const { snapshotOwnData, deepFreeze, computeDigest, isValidDigest } = require("./generated-change-set-review-canonical");
const { recomputeReviewPackageDigest } = require("./generated-change-set-review-package");

const KIND = "GeneratedChangeSetReviewRecord";
const SCHEMA_VERSION = 1;

const DECISIONS = Object.freeze(["APPROVE", "REQUEST_CHANGES", "REJECT"]);
const STATUSES = Object.freeze(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]);

const DIGEST_LABEL_RECORD = "generated-change-set-review-record:v1";

// Roadmap #23E: reuses the existing LONG_TEXT bound rather than inventing
// a new limit - a per-decision reason or an overall review comment is
// free-form human prose, the same shape/size class as a RequirementModel
// requirement's own "text" field (mirrors #22F's own MAX_COMMENT_LENGTH).
const MAX_REASON_LENGTH = GENERATION_LIMITS.LONG_TEXT_MAX_LENGTH;
const MAX_COMMENT_LENGTH = GENERATION_LIMITS.LONG_TEXT_MAX_LENGTH;

// UTC-only ISO-8601 timestamp - a fixed, unambiguous, sortable audit-log
// timestamp shape. A caller-supplied local offset or a bare date is
// deliberately rejected rather than silently reinterpreted. Identical
// convention to #22F's own isValidTimestamp().
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function isValidTimestamp(value) {
  return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value);
}

const DECISION_ENTRY_ALLOWED_KEYS = Object.freeze(["operation", "path", "targetDigest", "decision", "reason"]);

// Roadmap #23E: identity key for matching a decision entry to a reviewPackage
// reviewTargets entry - the full {operation, path, targetDigest} triple,
// never path alone (a decision naming a stale targetDigest for a path
// whose proposed content has since changed is treated as absent, exactly
// like a genuinely missing one). Length-prefixed concatenation mirrors
// #22F's own reviewTargetKey() - closes the same key-collision class an
// earlier #22F corrective review found (e.g. operation="a", path="bc" must
// never collide with operation="ab", path="c").
function reviewTargetKey(target) {
  return `${target.operation.length}:${target.operation}${target.path.length}:${target.path}${target.targetDigest.length}:${target.targetDigest}`;
}

// Roadmap #23E-C1 (closes 23E-R-1): reviewTargetKey() above dereferences
// `.length` on `operation`/`path`/`targetDigest` unconditionally - a
// reviewPackage.reviewTargets entry is normally only ever produced by
// buildGeneratedChangeSetReviewPackage() (which always supplies well-
// formed strings there), but this module's own public functions accept
// `reviewPackage` as a caller-supplied parameter, not something they
// themselves constructed - a hand-forged reviewPackage (a self-consistent
// recomputed packageDigest is trivial for anyone with require() access to
// this module's own digest primitives, exactly like the already-documented
// "INTEGRITY IS NOT AUTHENTICITY" limitation above) with a malformed
// reviewTargets entry must never reach reviewTargetKey() un-validated,
// or it throws an uncaught TypeError instead of the documented bounded
// `{ok:false, errors}` contract. This validates exactly the three fields
// reviewTargetKey() itself dereferences - never the full target shape
// (purpose/proposedContent/etc. are never read by this module at all, so
// validating them here would be unrelated scope creep) - reusing the
// frozen AutomationPlan v1 OPERATIONS enum and path classifiers
// (../generation/automation-plan) and this module's own digest-format
// check (isValidDigest), rather than inventing new semantics. No implicit
// coercion (String(...)) and no optional-chain silent collapse
// (`target?.operation?.length ?? 0`) - a malformed field is rejected
// outright with a bounded error, never repaired or defaulted.
function validateReviewTargetReferenceShape(target, path, errors) {
  if (!isPlainObject(target)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  if (typeof target.operation !== "string" || !OPERATIONS.includes(target.operation)) {
    errors.push(err(`${path}.operation`, ERROR_CODES.INVALID_ENUM, `${path}.operation must be one of ${OPERATIONS.join(", ")}`));
  }
  if (typeof target.path !== "string" || !isSafeRepoRelativePath(target.path) || !isCanonicalPlanPath(target.path)) {
    errors.push(err(`${path}.path`, ERROR_CODES.INVALID_PATH, `${path}.path must be a safe, canonical, repository-relative path`));
  }
  if (typeof target.targetDigest !== "string" || !isValidDigest(target.targetDigest)) {
    errors.push(err(`${path}.targetDigest`, ERROR_CODES.INVALID_VALUE, `${path}.targetDigest must be a valid sha256:<64 lowercase hex> digest`));
  }
}

/**
 * Builds one GeneratedChangeSetReviewRecord v1 recording a human
 * reviewer's decision for every entry in `reviewPackage.reviewTargets`.
 *
 * `decisions` must contain exactly one entry per `reviewTargets` entry,
 * matched by the FULL `{operation, path, targetDigest}` triple (never by
 * path alone) - a decision entry naming a stale targetDigest for a target
 * whose proposed content has since changed is rejected exactly like a
 * missing one.
 *
 * `status` is never accepted from the caller: it is always derived here as
 * REJECTED if any decision is REJECT, else CHANGES_REQUESTED if any
 * decision is REQUEST_CHANGES, else APPROVED.
 *
 * Returns `{ ok: true, reviewRecord }` or `{ ok: false, errors }`.
 */
function buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId, reviewedAt, decisions, comment, expectedProjectId } = {}) {
  let reviewPackageSnapshot;
  let reviewerIdSnapshot;
  let reviewedAtSnapshot;
  let decisionsSnapshot;
  let commentSnapshot;
  try {
    reviewPackageSnapshot = deepFreeze(snapshotOwnData(reviewPackage));
    reviewerIdSnapshot = snapshotOwnData(reviewerId);
    reviewedAtSnapshot = snapshotOwnData(reviewedAt);
    decisionsSnapshot = deepFreeze(snapshotOwnData(decisions));
    commentSnapshot = comment === undefined ? undefined : snapshotOwnData(comment);
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "inputs could not be read")] };
  }

  const errors = [];

  if (!isPlainObject(reviewPackageSnapshot) || reviewPackageSnapshot.kind !== "GeneratedChangeSetReviewPackage" || reviewPackageSnapshot.schemaVersion !== 1 || !Array.isArray(reviewPackageSnapshot.reviewTargets)) {
    return { ok: false, errors: [err("$.reviewPackage", ERROR_CODES.INVALID_TYPE, "$.reviewPackage must be a valid GeneratedChangeSetReviewPackage v1")] };
  }
  // Roadmap #23E: a record must never be built for a reviewPackage object
  // that does not even match its own stored digest - this catches a
  // tampered/hand-assembled package at record-creation time, not only
  // later at validateApprovedGeneratedChangeSetReview().
  const recomputedPackageDigest = recomputeReviewPackageDigest(reviewPackageSnapshot);
  if (recomputedPackageDigest === null || recomputedPackageDigest !== reviewPackageSnapshot.packageDigest) {
    return { ok: false, errors: [err("$.reviewPackage.packageDigest", ERROR_CODES.INVALID_VALUE, "$.reviewPackage content does not match its own stored digest")] };
  }

  if (expectedProjectId !== undefined && reviewPackageSnapshot.projectId !== expectedProjectId) {
    errors.push(err("$.reviewPackage.projectId", ERROR_CODES.PROJECT_MISMATCH, "$.reviewPackage.projectId does not match the expected project"));
  }
  if (!isValidId(reviewerIdSnapshot)) {
    errors.push(err("$.reviewerId", ERROR_CODES.INVALID_TYPE, "$.reviewerId must be a bounded string id"));
  }
  if (!isValidTimestamp(reviewedAtSnapshot)) {
    errors.push(err("$.reviewedAt", ERROR_CODES.INVALID_TYPE, "$.reviewedAt must be a UTC ISO-8601 timestamp"));
  }
  if (commentSnapshot !== undefined && !isBoundedText(commentSnapshot, MAX_COMMENT_LENGTH)) {
    errors.push(err("$.comment", ERROR_CODES.INVALID_VALUE, `$.comment must be a bounded string of at most ${MAX_COMMENT_LENGTH} characters`));
  }
  if (!Array.isArray(decisionsSnapshot)) {
    errors.push(err("$.decisions", ERROR_CODES.MISSING_FIELD, "$.decisions must be an array"));
  } else if (decisionsSnapshot.length > GENERATION_LIMITS.MAX_PLANNED_CHANGES) {
    errors.push(err("$.decisions", ERROR_CODES.INVALID_VALUE, `$.decisions exceeds the maximum of ${GENERATION_LIMITS.MAX_PLANNED_CHANGES}`));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  decisionsSnapshot.forEach((entry, i) => {
    const path = `$.decisions[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be a plain object`));
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!DECISION_ENTRY_ALLOWED_KEYS.includes(key)) {
        errors.push(err(`${path}.${key}`, ERROR_CODES.UNKNOWN_FIELD, `${path}: unknown field`));
      }
    }
    if (typeof entry.operation !== "string" || entry.operation.length === 0) {
      errors.push(err(`${path}.operation`, ERROR_CODES.INVALID_TYPE, `${path}.operation must be a non-empty string`));
    }
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      errors.push(err(`${path}.path`, ERROR_CODES.INVALID_TYPE, `${path}.path must be a non-empty string`));
    }
    if (typeof entry.targetDigest !== "string" || entry.targetDigest.length === 0) {
      errors.push(err(`${path}.targetDigest`, ERROR_CODES.INVALID_TYPE, `${path}.targetDigest must be a string`));
    }
    if (!DECISIONS.includes(entry.decision)) {
      errors.push(err(`${path}.decision`, ERROR_CODES.INVALID_ENUM, `${path}.decision must be one of ${DECISIONS.join(", ")}`));
    }
    if (entry.reason !== undefined) {
      if (!isBoundedText(entry.reason, MAX_REASON_LENGTH)) {
        errors.push(err(`${path}.reason`, ERROR_CODES.INVALID_VALUE, `${path}.reason must be a bounded string of at most ${MAX_REASON_LENGTH} characters`));
      }
    } else if (entry.decision === "REQUEST_CHANGES" || entry.decision === "REJECT") {
      errors.push(err(`${path}.reason`, ERROR_CODES.MISSING_FIELD, `${path}.reason is required when decision is REQUEST_CHANGES or REJECT`));
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Roadmap #23E-C1 (closes 23E-R-1): every reviewPackage.reviewTargets
  // entry must be structurally valid BEFORE reviewTargetKey() is ever
  // called on it - reviewPackage is caller-supplied data (a hand-forged,
  // self-consistent-digest package is not excluded merely because the
  // real builder would never produce one), and reviewTargetKey()'s own
  // `.length` dereferences would otherwise throw an uncaught TypeError on
  // a malformed entry instead of the documented bounded error contract.
  reviewPackageSnapshot.reviewTargets.forEach((target, i) => {
    validateReviewTargetReferenceShape(target, `$.reviewPackage.reviewTargets[${i}]`, errors);
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Completeness + exact-binding (Roadmap #23E, mirrors #22F): every
  // reviewTargets entry requires exactly one decisions[] entry matching
  // its full {operation, path, targetDigest} triple - never matched by
  // path alone, so a decision recorded against a since-changed target
  // digest is treated as absent, identically to a genuinely missing one.
  const targetKeys = new Set(reviewPackageSnapshot.reviewTargets.map(reviewTargetKey));
  const decisionKeyCounts = new Map();
  decisionsSnapshot.forEach((entry) => {
    const key = reviewTargetKey(entry);
    decisionKeyCounts.set(key, (decisionKeyCounts.get(key) || 0) + 1);
  });

  for (const key of decisionKeyCounts.keys()) {
    if (!targetKeys.has(key)) {
      errors.push(err("$.decisions", ERROR_CODES.INVALID_REFERENCE, "a decision entry does not match any reviewTargets entry in this reviewPackage (unknown target, or a stale/mismatched targetDigest)"));
    }
  }
  for (const [key, count] of decisionKeyCounts.entries()) {
    if (targetKeys.has(key) && count > 1) {
      errors.push(err("$.decisions", ERROR_CODES.DUPLICATE_ID, "more than one decision entry for the same reviewTargets entry"));
    }
  }
  for (const key of targetKeys) {
    if (!decisionKeyCounts.has(key)) {
      errors.push(err("$.decisions", ERROR_CODES.MISSING_FIELD, "every reviewPackage.reviewTargets entry requires exactly one matching decision entry; at least one is missing"));
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Canonical order (Roadmap #23E, mirrors #22F): mirrors reviewTargets'
  // own order, never the caller-supplied decisions[] order.
  const decisionsByKey = new Map(decisionsSnapshot.map((entry) => [reviewTargetKey(entry), entry]));
  // Roadmap #23E-C1 (closes 23E-R-1): a defensive, last-resort guard - not
  // a replacement for the completeness checks above, which remain the
  // primary, redundant (unknown-reference + missing-reference) enforcement
  // and are independently sufficient under normal correct-logic flow. This
  // guard exists so that IF the completeness invariant were ever somehow
  // compromised (e.g. both directions disabled), decisionsByKey.get()
  // resolving to `undefined` here produces a bounded `{ok:false, errors}`
  // result instead of an uncaught TypeError on `entry.operation` - the
  // exact failure mode the independent review's combined-mutation probe
  // demonstrated. No optional-chain silent collapse: an unresolved lookup
  // is treated as a hard, reported error, never defaulted/skipped.
  let unresolvedTargetCount = 0;
  const orderedDecisions = reviewPackageSnapshot.reviewTargets.map((target) => {
    const entry = decisionsByKey.get(reviewTargetKey(target));
    if (entry === undefined) {
      unresolvedTargetCount += 1;
      return null;
    }
    return { operation: entry.operation, path: entry.path, targetDigest: entry.targetDigest, decision: entry.decision, reason: entry.reason === undefined ? null : entry.reason };
  });
  if (unresolvedTargetCount > 0) {
    return { ok: false, errors: [err("$.decisions", ERROR_CODES.INVALID_REFERENCE, "one or more reviewPackage.reviewTargets entries could not be resolved to a decision")] };
  }

  // status is DERIVED, never accepted as caller input.
  let status;
  if (orderedDecisions.some((d) => d.decision === "REJECT")) {
    status = "REJECTED";
  } else if (orderedDecisions.some((d) => d.decision === "REQUEST_CHANGES")) {
    status = "CHANGES_REQUESTED";
  } else {
    status = "APPROVED";
  }

  const recordContent = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    projectId: reviewPackageSnapshot.projectId,
    packageDigest: reviewPackageSnapshot.packageDigest,
    reviewerId: reviewerIdSnapshot,
    reviewedAt: reviewedAtSnapshot,
    decisions: orderedDecisions,
    status,
    comment: commentSnapshot === undefined ? null : commentSnapshot,
  };

  const recordDigest = computeDigest(DIGEST_LABEL_RECORD, recordContent);

  return { ok: true, reviewRecord: deepFreeze({ ...recordContent, recordDigest }) };
}

/**
 * Recomputes a review record's digest from its own content (never trusting
 * the stored `recordDigest` field) and returns whether it matches -
 * detects direct tampering with `decisions`/`status`/`reviewerId`/
 * `reviewedAt`/`comment` after construction.
 */
function recomputeReviewRecordDigest(reviewRecord) {
  if (!isPlainObject(reviewRecord)) return null;
  const { recordDigest, ...rest } = reviewRecord;
  try {
    return computeDigest(DIGEST_LABEL_RECORD, rest);
  } catch {
    return null;
  }
}

module.exports = {
  KIND,
  SCHEMA_VERSION,
  DECISIONS,
  STATUSES,
  DIGEST_LABEL_RECORD,
  buildGeneratedChangeSetReviewRecord,
  recomputeReviewRecordDigest,
  isValidTimestamp,
  reviewTargetKey,
  validateReviewTargetReferenceShape,
};
