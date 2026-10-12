/**
 * GeneratedChangeSetReviewRecord v1 (Roadmap #23E).
 *
 * The deterministic, non-generative human decision made about ONE
 * GeneratedChangeSetReviewPackage v1 - one decision (APPROVE /
 * REQUEST_CHANGES / REJECT) for every entry in that package's own
 * `reviewTargets`, an overall `status` DERIVED from those decisions (never
 * trusted from the caller), and a binding back to the exact package
 * content that was reviewed via `reviewPackageDigest`.
 *
 * AUTHORITY SEPARATION (read this before wiring this into anything): this
 * module grants exactly one thing - a tamper-evident record of a human
 * decision bound to exact reviewed content. It grants NOTHING else.
 * Specifically, a successful APPROVE record does NOT mean:
 *   - the proposed code is syntactically valid;
 *   - the proposed test will pass;
 *   - it is safe to write to the real filesystem;
 *   - the current repository state is still compatible with the reviewed
 *     content (see FUTURE_CHANGESET_APPLICATION_REVALIDATION_GUARD -
 *     that belongs to #23F, a stage this module does not implement);
 *   - files may now be written, Git may now be mutated, generated code
 *     may now execute, or the change may now be merged.
 * `validateApprovedGeneratedChangeSetReview()` below answers exactly one
 * question: "does a structurally valid, untampered APPROVE decision exist
 * for this exact GeneratedChangeSet content?" - nothing more.
 *
 * STALE-APPROVAL PROTECTION (the core security property of this module,
 * together with generated-change-set-review-package.js's own digest): a
 * record approves ONE specific, immutable snapshot of reviewed content -
 * if the underlying GeneratedChangeSet, AutomationPlan, or
 * AutomationRepositoryContext changes after a human approved it (even if
 * every artifact id stays the same), the newly-built review package gets a
 * different `packageDigest`, and `validateApprovedGeneratedChangeSetReview()`
 * will correctly refuse to treat the OLD record as approval for the NEW
 * package. An id/path match alone is never sufficient for approval - only
 * an exact digest match is.
 *
 * TAMPER DETECTION: `recordDigest` is a content digest of the record's own
 * decision/status/reviewer content (mirroring `packageDigest`/
 * `recomputeReviewPackageDigest()`). A record whose `status` or
 * `decisions` were altered after construction - without going back through
 * `buildGeneratedChangeSetReviewRecord()` - will fail
 * `recomputeReviewRecordDigest()` verification.
 *
 * INTEGRITY IS NOT AUTHENTICITY (read this before relying on
 * `validateApprovedGeneratedChangeSetReview()` for anything beyond what it
 * actually proves - mirrors #22F's own identical warning):
 * `computeDigest()`/`canonicalStringify()`
 * (generated-change-set-review-canonical.js) are a PLAIN, UNKEYED SHA-256
 * hash - not an HMAC, not a digital signature, and not bound to any
 * secret. A matching `recordDigest` proves only that this exact object's
 * fields have not been altered since being serialized in this shape. It
 * does NOT prove:
 *   - that `reviewerId` identifies a real, authenticated reviewer
 *     (FUTURE_REVIEWER_IDENTITY_PROVENANCE_GUARD, carried forward
 *     unchanged from #22F/#22E-R1's own H1);
 *   - that `buildGeneratedChangeSetReviewRecord()` (and therefore its
 *     completeness/business-rule checks) ever actually ran;
 *   - that any human produced these `decisions` at all
 *     (FUTURE_HUMAN_DECISION_PROVENANCE_GUARD, carried forward unchanged
 *     from #22F). Future orchestration MUST create/accept
 *     GeneratedChangeSetReviewRecord decisions only through an
 *     authenticated and authorized human-principal interaction path - a
 *     recomputable SHA-256 digest MUST NOT be treated by any future
 *     integration as proof that a human produced or authorized the review
 *     record. That guarantee does not exist at this layer and is not
 *     implemented by #23E.
 * Concretely: any caller with require-access to this module's exported
 * `computeDigest`/`DIGEST_LABEL_RECORD` (or an independent SHA-256
 * reimplementation of the same canonicalization) can hand-construct an
 * arbitrary GeneratedChangeSetReviewRecord-shaped object - fabricated
 * `decisions`, an arbitrary `status`, any `reviewerId` - and compute a
 * `recordDigest` that will pass `recomputeReviewRecordDigest()` and
 * therefore `validateApprovedGeneratedChangeSetReview()`, entirely
 * bypassing `buildGeneratedChangeSetReviewRecord()`. This is the same,
 * already-documented, intentional limitation #22F's own review layer
 * carries (see its "DOCUMENTED LIMITATION" test) -
 * `validateApprovedGeneratedChangeSetReview()` therefore proves CONTENT
 * INTEGRITY and STALE-APPROVAL PROTECTION only, never that a real human,
 * via a real review flow, produced the record it is validating.
 *
 * FUTURE_GENERATED_CHANGESET_REVIEW_GUARD: this module IS the mechanism
 * that guard called for - a generated-code human-review artifact now
 * exists. It does NOT resolve the deeper identity/provenance guards above,
 * which remain open exactly as they remain open for #22F today.
 *
 * This module never calls an AI provider, never touches the filesystem,
 * network, git, or child_process, and never mutates the repository - it
 * returns data only.
 */

"use strict";
const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject } = require("../generation/primitives");
const { snapshotOwnData, deepFreeze } = require("./generated-change-set-review-canonical");
const { recomputeReviewPackageDigest } = require("./generated-change-set-review-package");
const builder = require("./generated-change-set-review-record-builder");
const { KIND, SCHEMA_VERSION, recomputeReviewRecordDigest } = builder;
/**
 * The single deterministic approval gate: returns `{ ok: true }` only when
 * `reviewRecord` is an untampered, APPROVED record produced for EXACTLY
 * this `reviewPackage`'s current content (never a stale approval of
 * earlier content, never a cross-project or cross-package replay).
 *
 * Both `reviewPackage` and `reviewRecord` are re-verified against their
 * own stored digests here - this function never merely trusts that a
 * caller-supplied pair is internally consistent.
 *
 * A successful result means ONLY that a structurally valid APPROVE
 * decision exists for this exact GeneratedChangeSet content - see this
 * module's own docstring ("AUTHORITY SEPARATION") for the exhaustive list
 * of what it does NOT mean. It grants no filesystem, Git, or execution
 * authority whatsoever.
 */
function validateApprovedGeneratedChangeSetReview(reviewPackageInput, reviewRecordInput, { expectedProjectId } = {}) {
  // RP-32 (closes N-15): every check below - the digest recomputations AND
  // the later packageDigest/projectId/status reads - runs against ONE
  // deep-frozen own-data snapshot per input, so a getter/Proxy cannot show
  // the digest check one record and the status check another. An
  // unreadable input snapshots to null and is rejected as INVALID_TYPE.
  let reviewPackage;
  let reviewRecord;
  try {
    reviewPackage = deepFreeze(snapshotOwnData(reviewPackageInput));
    reviewRecord = deepFreeze(snapshotOwnData(reviewRecordInput));
  } catch {
    reviewPackage = null;
    reviewRecord = null;
  }
  if (!isPlainObject(reviewPackage) || reviewPackage.kind !== "GeneratedChangeSetReviewPackage" || reviewPackage.schemaVersion !== 1) {
    return { ok: false, errors: [err("$.reviewPackage", ERROR_CODES.INVALID_TYPE, "$.reviewPackage must be a valid GeneratedChangeSetReviewPackage v1")] };
  }
  if (!isPlainObject(reviewRecord) || reviewRecord.kind !== KIND || reviewRecord.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, errors: [err("$.reviewRecord", ERROR_CODES.INVALID_TYPE, "$.reviewRecord must be a valid GeneratedChangeSetReviewRecord v1")] };
  }

  const errors = [];

  const freshPackageDigest = recomputeReviewPackageDigest(reviewPackage);
  if (freshPackageDigest === null || freshPackageDigest !== reviewPackage.packageDigest) {
    errors.push(err("$.reviewPackage.packageDigest", ERROR_CODES.INVALID_VALUE, "$.reviewPackage content does not match its own stored digest"));
  }
  const freshRecordDigest = recomputeReviewRecordDigest(reviewRecord);
  if (freshRecordDigest === null || freshRecordDigest !== reviewRecord.recordDigest) {
    errors.push(err("$.reviewRecord.recordDigest", ERROR_CODES.INVALID_VALUE, "$.reviewRecord content does not match its own stored digest"));
  }
  if (errors.length > 0) return { ok: false, errors };

  // STALE-APPROVAL / cross-package replay: the record must have been
  // produced for exactly this package's current content.
  if (reviewRecord.packageDigest !== reviewPackage.packageDigest) {
    errors.push(err("$.reviewRecord.packageDigest", ERROR_CODES.INVALID_REFERENCE, "reviewRecord was not produced for this exact reviewPackage content (stale approval, tampered content, or mismatched/replayed record)"));
  }
  // cross-project replay, checked independently on both sides plus their
  // own mutual agreement - never inferred from the digest match alone.
  if (reviewRecord.projectId !== reviewPackage.projectId) {
    errors.push(err("$.reviewRecord.projectId", ERROR_CODES.PROJECT_MISMATCH, "reviewRecord.projectId does not match reviewPackage.projectId"));
  }
  if (expectedProjectId !== undefined) {
    if (reviewPackage.projectId !== expectedProjectId) {
      errors.push(err("$.reviewPackage.projectId", ERROR_CODES.PROJECT_MISMATCH, "reviewPackage.projectId does not match the expected project"));
    }
    if (reviewRecord.projectId !== expectedProjectId) {
      errors.push(err("$.reviewRecord.projectId", ERROR_CODES.PROJECT_MISMATCH, "reviewRecord.projectId does not match the expected project"));
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  if (reviewRecord.status !== "APPROVED") {
    return { ok: false, errors: [err("$.reviewRecord.status", ERROR_CODES.INVALID_VALUE, "reviewRecord.status is not APPROVED")] };
  }

  return { ok: true, errors: [] };
}

module.exports = { ...builder, validateApprovedGeneratedChangeSetReview };
