/**
 * GeneratedChangeSetReviewPackage v1 (Roadmap #23E).
 *
 * A deterministic, immutable representation of EXACTLY what a human
 * reviewer is being asked to approve: one already-validated GeneratedChangeSet
 * v1, bound to the exact AutomationPlan v1 and AutomationRepositoryContext
 * it was itself validated against - never a change to any frozen contract,
 * never a field embedded into GeneratedChangeSet v1 itself. This is
 * governance metadata ABOUT an already-validated proposal, not a fifth
 * generation model and not a modification of the fourth.
 *
 * #23E reviews GeneratedChangeSet content only - proposed CREATE/MODIFY
 * file operations. It never reviews RequirementModel/TestCaseModel/
 * AutomationCandidate (that is #22F's own, separate, unrelated human gate),
 * and it never writes to disk, touches Git, or executes generated code -
 * those belong to a later, separate stage (#23F, not built here). This
 * module has no dependency on scripts/ai/test-design/** and no knowledge
 * of RequirementModel/TestCaseModel/AutomationCandidate.
 *
 * WHAT #23E ANSWERS: "has a human review decision been recorded against
 * THIS EXACT GeneratedChangeSet content?" It does NOT answer whether the
 * proposed content is syntactically valid, will pass, is safe to write to
 * the real filesystem, or is compatible with the repository's current
 * state - see generated-change-set-review-record.js's own docstring for
 * the full authority-separation statement.
 *
 * GENERATEDCHANGESET VALIDATION FIRST: this module never builds a review
 * package from an unverified triple. It re-validates the supplied
 * GeneratedChangeSet against the supplied AutomationPlan/
 * AutomationRepositoryContext via generated-change-set.js's own real,
 * unmodified validateGeneratedChangeSet() - the exact same deterministic
 * boundary #23D itself enforces (project binding, full-content plan/
 * context binding, write-scope/path/protected-area checks, CREATE/MODIFY
 * existence and staleness) - never a weaker, review-local reimplementation
 * of that logic. A GeneratedChangeSet that would be rejected by #23D is
 * rejected here too, before a human ever sees it.
 *
 * TRUST BOUNDARY: every caller-supplied input (automationPlan,
 * repositoryContext, generatedChangeSet) is read exactly once via
 * generated-change-set-review-canonical.js's snapshotOwnData() - a FRESH,
 * independent reimplementation of the same hardened pattern #22F/#23D
 * already established (Object.create(null) + Object.defineProperty record
 * copying, manual-indexed dense-array copying, an explicit ancestors-based
 * cycle guard). Nothing below this module's own snapshot calls ever reads
 * a caller object again - validateGeneratedChangeSet() itself is called
 * only on these already-owned snapshots, never on the caller's original
 * objects.
 *
 * REVIEW TARGET GRANULARITY: exactly one review target per
 * GeneratedChangeSet.changes[] entry, in that array's own canonical order
 * (already plannedChanges-ordered by #23D itself - never re-sorted here).
 * Completeness is guaranteed for free: GeneratedChangeSet v1 itself already
 * requires exactly one change per plannedChanges entry, so this module
 * never needs (and never implements) a separate missing/extra/duplicate-
 * target check the way #22F needed for its own, independently-sized
 * candidate array.
 *
 * PACKAGE DIGEST: a SHA-256, domain-separated content digest (see
 * generated-change-set-review-canonical.js) computed over the package's
 * own reviewed content (including every reviewTargets[] entry's own
 * digest) - a human approval bound to this digest becomes invalid the
 * instant any reviewed content changes (a new proposed source character,
 * a drifted plan/context/changeSet digest), even if every id stays the
 * same (see generated-change-set-review-record.js's own
 * validateApprovedGeneratedChangeSetReview()).
 *
 * CREATE TARGETS CARRY 23D-R-3 FORWARD: a CREATE review target's
 * `existingContent` is always `null` - this module never claims to prove
 * the target is actually absent from the real repository, only that it
 * was absent from the bound AutomationRepositoryContext's own selective
 * evidence (exactly GeneratedChangeSet v1's own documented limitation).
 * Real-filesystem revalidation remains #23F's responsibility
 * (FUTURE_CHANGESET_APPLICATION_REVALIDATION_GUARD).
 *
 * No filesystem, network, browser, git, child_process, or provider
 * dependency anywhere in this module - it returns data only.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId } = require("../generation/primitives");
const { LIMITS: GENERATION_LIMITS } = require("../generation/limits");
const { validateGeneratedChangeSet } = require("./generated-change-set");
const { snapshotOwnData, deepFreeze, computeDigest } = require("./generated-change-set-review-canonical");

const KIND = "GeneratedChangeSetReviewPackage";
const SCHEMA_VERSION = 1;

const DIGEST_LABEL_PACKAGE = "generated-change-set-review-package:v1";
const DIGEST_LABEL_TARGET = "generated-change-set-review-target:v1";
const DIGEST_LABEL_TARGET_CONTENT = "generated-change-set-review-target-content:v1";

// Roadmap #23E: a review target count can never legitimately exceed
// GeneratedChangeSet v1's own MAX_CHANGES bound (already enforced by
// validateGeneratedChangeSet() before this module ever builds a single
// target) - no second, larger envelope is introduced here.
const LIMITS = Object.freeze({
  MAX_REVIEW_TARGETS: GENERATION_LIMITS.MAX_PLANNED_CHANGES,
});

/**
 * Builds one GeneratedChangeSetReviewPackage v1 from an AutomationPlan v1,
 * an AutomationRepositoryContext, and a GeneratedChangeSet v1 already
 * independently re-validated (via #23D's own validateGeneratedChangeSet())
 * to correspond to that exact plan/context.
 *
 * Returns `{ ok: true, reviewPackage }` or `{ ok: false, errors }` -
 * `errors` is always the bounded `{path, code, message}` shape, never a
 * raw caller value, stack trace, or partially-constructed package.
 */
function buildGeneratedChangeSetReviewPackage({ automationPlan, repositoryContext, generatedChangeSet, expectedProjectId } = {}) {
  let planSnapshot;
  let contextSnapshot;
  let changeSetSnapshot;
  try {
    planSnapshot = deepFreeze(snapshotOwnData(automationPlan));
    contextSnapshot = deepFreeze(snapshotOwnData(repositoryContext));
    changeSetSnapshot = deepFreeze(snapshotOwnData(generatedChangeSet));
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "inputs could not be read")] };
  }

  // The real, unmodified #23D validation boundary - never a review-local
  // reimplementation. Called only on the already-owned snapshots above,
  // never on the caller's original objects.
  const changeSetResult = validateGeneratedChangeSet({
    automationPlan: planSnapshot,
    repositoryContext: contextSnapshot,
    generatedChangeSet: changeSetSnapshot,
    expectedProjectId,
  });
  if (!changeSetResult.ok) {
    return { ok: false, errors: changeSetResult.errors };
  }

  if (expectedProjectId !== undefined && !isValidId(expectedProjectId)) {
    return { ok: false, errors: [err("$.expectedProjectId", ERROR_CODES.INVALID_TYPE, "$.expectedProjectId must be a bounded string id")] };
  }

  const projectId = changeSetSnapshot.projectId;
  const framework = planSnapshot.framework;

  // Purpose traceability: a Map from plannedChanges path -> purpose.
  // validateGeneratedChangeSet() above already guarantees every
  // changeSetSnapshot.changes[] entry's path matches exactly one
  // planSnapshot.plannedChanges entry, so this lookup can never miss.
  const purposeByPath = new Map(planSnapshot.plannedChanges.map((c) => [c.path, c.purpose]));
  // MODIFY existing-content lookup: a Map from repositoryEvidence location
  // -> content. Reused for the same reason - already independently
  // re-verified as correct by validateGeneratedChangeSet() above.
  const evidenceByPath = new Map(contextSnapshot.repositoryEvidence.map((e) => [e.evidenceRef.location, e]));

  if (changeSetSnapshot.changes.length > LIMITS.MAX_REVIEW_TARGETS) {
    // Defensive - already implied by GeneratedChangeSet v1's own
    // MAX_CHANGES bound, which validateGeneratedChangeSet() above has
    // already enforced. Kept as an explicit invariant check so a review
    // target count can never silently exceed this module's own documented
    // maximum even under a future #23D contract change.
    return { ok: false, errors: [err("$.generatedChangeSet.changes", ERROR_CODES.INVALID_VALUE, `exceeds the maximum of ${LIMITS.MAX_REVIEW_TARGETS} review targets`)] };
  }

  // Canonical order = changeSetSnapshot.changes' own order (already
  // plannedChanges-ordered by #23D itself) - never re-sorted here.
  const reviewTargets = changeSetSnapshot.changes.map((change) => {
    const existing = change.operation === "MODIFY" ? evidenceByPath.get(change.path) : undefined;
    const existingContent = existing ? existing.content : null;
    const purpose = purposeByPath.get(change.path);

    const proposedContentDigest = computeDigest(DIGEST_LABEL_TARGET_CONTENT, change.content);

    const targetContent = {
      operation: change.operation,
      path: change.path,
      purpose,
      baseContentDigest: change.baseContentDigest,
      existingContent,
      proposedContent: change.content,
    };
    const targetDigest = computeDigest(DIGEST_LABEL_TARGET, targetContent);

    return {
      operation: change.operation,
      path: change.path,
      purpose,
      baseContentDigest: change.baseContentDigest,
      existingContent,
      proposedContent: change.content,
      proposedContentDigest,
      targetDigest,
    };
  });

  const packageContent = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    projectId,
    framework,
    automationPlanId: planSnapshot.id,
    changeSetDigest: changeSetSnapshot.changeSetDigest,
    automationPlanDigest: changeSetSnapshot.automationPlanDigest,
    repositoryContextDigest: changeSetSnapshot.repositoryContextDigest,
    reviewTargets,
  };

  const packageDigest = computeDigest(DIGEST_LABEL_PACKAGE, packageContent);

  return { ok: true, reviewPackage: deepFreeze({ ...packageContent, packageDigest }) };
}

/**
 * Recomputes a review package's digest from its own reviewed content
 * (never trusting the `packageDigest` field already stored on the object)
 * and returns whether it matches. Used by
 * validateApprovedGeneratedChangeSetReview() (generated-change-set-review-
 * record.js) to detect both outright digest tampering and any material
 * content change since a review record was produced.
 */
function recomputeReviewPackageDigest(reviewPackage) {
  if (!isPlainObject(reviewPackage)) return null;
  const { packageDigest, ...rest } = reviewPackage;
  try {
    return computeDigest(DIGEST_LABEL_PACKAGE, rest);
  } catch {
    return null;
  }
}

module.exports = {
  KIND,
  SCHEMA_VERSION,
  LIMITS,
  DIGEST_LABEL_PACKAGE,
  DIGEST_LABEL_TARGET,
  DIGEST_LABEL_TARGET_CONTENT,
  buildGeneratedChangeSetReviewPackage,
  recomputeReviewPackageDigest,
};
