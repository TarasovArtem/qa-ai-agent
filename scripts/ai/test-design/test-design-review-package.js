/**
 * TestDesignReviewPackage v1 (Roadmap #22F).
 *
 * A deterministic, immutable representation of EXACTLY what a human
 * reviewer is being asked to approve: one accepted RequirementModel v1,
 * one accepted TestCaseModel v1, and exactly one AutomationCandidate v1
 * per TestCaseModel.testCases entry - never a change to any frozen
 * Generation Foundation contract, and never a field embedded into those
 * contracts themselves. This is governance metadata ABOUT already-accepted
 * Test Design artifacts, not a fourth generation model.
 *
 * #22F reviews Test Design only: RequirementModel, TestCaseModel,
 * AutomationCandidate. It never reviews AutomationPlan, GeneratedChangeSet,
 * generated source code, or any repository mutation - those belong to a
 * later, separate human gate (#23's own equivalent, not built here). This
 * module has no dependency on scripts/ai/test-automation/** and no
 * knowledge of AutomationRepositoryContext/AutomationPlan.
 *
 * CANDIDATE COVERAGE (Roadmap #22F): every current #22E test/design
 * assumes exactly one AutomationCandidate per TestCaseModel test case (one
 * generateAutomationCandidate() call per testCaseId, and the frozen
 * cross-model validator's own F4 rule never contemplates more than one
 * candidate legitimately representing the same test case within one
 * review). This module enforces that as a hard completeness invariant -
 * a missing, duplicate, or orphaned (referencing no real test case)
 * candidate makes the whole package construction fail, before any human
 * ever sees it.
 *
 * TRUST BOUNDARY: every caller-supplied input (requirementModel,
 * testCaseModel, automationCandidates, frameworkCapability, optional
 * projectProfile) is read exactly once via
 * test-design-review-canonical.js's snapshotOwnData() - Object.create(null)
 * + Object.defineProperty record copying, manual-indexed dense-array
 * copying, and an EXPLICIT ancestors-based cycle guard (never reliance on
 * stack-depth exhaustion - see that module's own docstring for why this is
 * a deliberate improvement over the #22E "F3" pattern for this NEW trust
 * boundary). Nothing below this module's own snapshot calls ever reads a
 * caller object again.
 *
 * FRAMEWORK CAPABILITY: `frameworkCapability` is included in the package
 * (and therefore bound into its content digest) for the same reason the
 * #22E-R1 review recorded as finding H1-F1: the review must be pinned to
 * the EXACT declared capability context the candidates were generated
 * under. This module does not resolve, and does not claim to resolve,
 * H1-F1 - it does not independently prove `frameworkCapability` reflects
 * objective project truth, only that a change to it after approval
 * produces a different package digest (see PACKAGE DIGEST below).
 *
 * PACKAGE DIGEST: a SHA-256, domain-separated content digest (see
 * test-design-review-canonical.js) computed over the package's own
 * reviewed content (including every reviewTargets[] entry's own digest) -
 * a human approval bound to this digest becomes invalid the instant any
 * reviewed content changes, even if every artifact id stays the same (see
 * test-design-review-record.js's validateApprovedTestDesignReview()).
 *
 * No filesystem, network, browser, git, child_process, or provider
 * dependency anywhere in this module - it returns data only.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId, SUPPORTED_FRAMEWORKS } = require("../generation/primitives");
const { LIMITS } = require("../generation/limits");
const { validateGenerationChain } = require("../generation/cross-model-validation");
const { snapshotOwnData, deepFreeze, computeDigest, isValidDigest } = require("./test-design-review-canonical");

const KIND = "TestDesignReviewPackage";
const SCHEMA_VERSION = 1;

const DIGEST_LABEL_PACKAGE = "test-design-review-package:v1";
const DIGEST_LABEL_REQUIREMENT_MODEL = "test-design-review-artifact:v1:RequirementModel";
const DIGEST_LABEL_TEST_CASE_MODEL = "test-design-review-artifact:v1:TestCaseModel";
const DIGEST_LABEL_AUTOMATION_CANDIDATE = "test-design-review-artifact:v1:AutomationCandidate";

// Roadmap #22F: #22E's own frameworkCapability shape validator
// (validateFrameworkCapabilitySnapshot) is NOT exported by
// automation-candidate-generator.js (it is intentionally private to that
// module) - #22F must not modify #22E to expose it, so this is a narrow,
// independent, #22F-local re-implementation of the exact same shape rule
// (projectId + supportedFrameworks, every entry a member of the frozen
// global SUPPORTED_FRAMEWORKS vocabulary, no duplicates), the same
// "a two/three-field shape check is not worth a fragile cross-module
// private-detail dependency" convention already used repeatedly in this
// codebase (automation-repository-context.js and automation-plan-
// generator.js both independently re-declare SUPPORTED_FRAMEWORKS rather
// than cross-import one another's private constants).
const FRAMEWORK_CAPABILITY_ALLOWED_KEYS = Object.freeze(["projectId", "supportedFrameworks"]);

function validateFrameworkCapabilityShape(capability, path, errors, { expectedProjectId } = {}) {
  if (!isPlainObject(capability)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be a plain object`));
    return;
  }
  for (const key of Object.keys(capability)) {
    if (!FRAMEWORK_CAPABILITY_ALLOWED_KEYS.includes(key)) {
      errors.push(err(`${path}.${key}`, ERROR_CODES.UNKNOWN_FIELD, `${path}: unknown field`));
    }
  }
  if (!isValidId(capability.projectId)) {
    errors.push(err(`${path}.projectId`, ERROR_CODES.INVALID_TYPE, `${path}.projectId must be a bounded string id`));
  } else if (expectedProjectId !== undefined && capability.projectId !== expectedProjectId) {
    errors.push(err(`${path}.projectId`, ERROR_CODES.PROJECT_MISMATCH, `${path}.projectId does not match the reviewed project`));
  }
  if (!Array.isArray(capability.supportedFrameworks)) {
    errors.push(err(`${path}.supportedFrameworks`, ERROR_CODES.MISSING_FIELD, `${path}.supportedFrameworks must be an array`));
  } else if (capability.supportedFrameworks.length > SUPPORTED_FRAMEWORKS.length) {
    errors.push(err(`${path}.supportedFrameworks`, ERROR_CODES.INVALID_VALUE, `${path}.supportedFrameworks exceeds the maximum of ${SUPPORTED_FRAMEWORKS.length}`));
  } else {
    capability.supportedFrameworks.forEach((fw, i) => {
      if (!SUPPORTED_FRAMEWORKS.includes(fw)) {
        errors.push(err(`${path}.supportedFrameworks[${i}]`, ERROR_CODES.INVALID_ENUM, `${path}.supportedFrameworks[${i}] must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
      }
    });
    if (new Set(capability.supportedFrameworks).size !== capability.supportedFrameworks.length) {
      errors.push(err(`${path}.supportedFrameworks`, ERROR_CODES.DUPLICATE_ID, `${path}.supportedFrameworks must not contain duplicate frameworks`));
    }
  }
}

// Roadmap #22F: ProjectProfile guidance is included ONLY if the caller
// actually supplies it, and ONLY the same bounded positive projection
// #22E itself already exposes to a provider (displayName,
// knownProjectConstraints) - never gratuitously added, never unrelated
// internal configuration. See this module's own docstring ("PROJECTPROFILE
// CONTEXT").
function projectProfileProjection(snapshot) {
  if (!isPlainObject(snapshot)) return null;
  return { displayName: snapshot.displayName, knownProjectConstraints: Array.isArray(snapshot.knownProjectConstraints) ? snapshot.knownProjectConstraints : null };
}

/**
 * Builds one TestDesignReviewPackage v1 from an accepted RequirementModel
 * v1, an accepted TestCaseModel v1, the complete set of AutomationCandidate
 * v1 entries for that TestCaseModel's test cases (exactly one per test
 * case, any order), and the frameworkCapability context those candidates
 * were generated under.
 *
 * Returns `{ ok: true, reviewPackage }` or `{ ok: false, errors }` -
 * `errors` is always the bounded `{path, code, message}` shape, never a
 * raw caller value, stack trace, or partially-constructed package.
 */
function buildTestDesignReviewPackage({ requirementModel, testCaseModel, automationCandidates, frameworkCapability, projectProfile, expectedProjectId } = {}) {
  let requirementModelSnapshot;
  let testCaseModelSnapshot;
  let automationCandidatesSnapshot;
  let frameworkCapabilitySnapshot;
  let projectProfileSnapshot;
  try {
    requirementModelSnapshot = deepFreeze(snapshotOwnData(requirementModel));
    testCaseModelSnapshot = deepFreeze(snapshotOwnData(testCaseModel));
    automationCandidatesSnapshot = deepFreeze(snapshotOwnData(automationCandidates));
    frameworkCapabilitySnapshot = deepFreeze(snapshotOwnData(frameworkCapability));
    projectProfileSnapshot = projectProfile === undefined ? undefined : deepFreeze(snapshotOwnData(projectProfile));
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "inputs could not be read")] };
  }

  const errors = [];

  // Upstream artifact validation: RequirementModel + TestCaseModel and
  // their existing relationship, via the frozen shared chain validator -
  // never trusted merely because they look right, never a second,
  // locally reimplemented cross-reference check.
  const upstreamResult = validateGenerationChain({ requirementModel: requirementModelSnapshot, testCaseModel: testCaseModelSnapshot }, { expectedProjectId });
  if (!upstreamResult.ok) {
    return { ok: false, errors: upstreamResult.errors };
  }
  const projectId = requirementModelSnapshot.projectId;

  if (!Array.isArray(automationCandidatesSnapshot)) {
    return { ok: false, errors: [err("$.automationCandidates", ERROR_CODES.MISSING_FIELD, "$.automationCandidates must be an array")] };
  }
  if (automationCandidatesSnapshot.length > LIMITS.MAX_TEST_CASES) {
    return { ok: false, errors: [err("$.automationCandidates", ERROR_CODES.INVALID_VALUE, `$.automationCandidates exceeds the maximum of ${LIMITS.MAX_TEST_CASES}`)] };
  }

  // Every candidate must independently satisfy the frozen generation
  // chain against these SAME upstream snapshots (schema shape +
  // project/schemaVersion consistency + testCaseModelId/testCaseId
  // traceability) - reused exactly as scripts/ai/generation/
  // cross-model-validation.js already implements it.
  automationCandidatesSnapshot.forEach((candidate, i) => {
    const result = validateGenerationChain({ requirementModel: requirementModelSnapshot, testCaseModel: testCaseModelSnapshot, automationCandidates: [candidate] }, { expectedProjectId: projectId });
    if (!result.ok) {
      for (const e of result.errors) {
        // Re-root only the candidate-specific errors under this
        // package's own automationCandidates[i] path - the chain
        // validator's own upstream-artifact errors were already checked
        // above and cannot recur here since requirementModel/
        // testCaseModel are unchanged between calls.
        if (e.path.startsWith("automationCandidates[0]")) {
          errors.push(err(`$.automationCandidates[${i}]${e.path.slice("automationCandidates[0]".length)}`, e.code, e.message));
        }
      }
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Candidate uniqueness (Roadmap #22F): a human must never receive two
  // conflicting candidates for one test case, and never two candidates
  // sharing one id, inside the same review package.
  const seenCandidateIds = new Set();
  const seenTestCaseIds = new Set();
  automationCandidatesSnapshot.forEach((candidate, i) => {
    if (seenCandidateIds.has(candidate.id)) {
      errors.push(err(`$.automationCandidates[${i}].id`, ERROR_CODES.DUPLICATE_ID, "duplicate AutomationCandidate id in this review package"));
    }
    seenCandidateIds.add(candidate.id);
    if (seenTestCaseIds.has(candidate.testCaseId)) {
      errors.push(err(`$.automationCandidates[${i}].testCaseId`, ERROR_CODES.DUPLICATE_ID, "more than one AutomationCandidate for the same test case in this review package"));
    }
    seenTestCaseIds.add(candidate.testCaseId);
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Candidate completeness (Roadmap #22F): the candidate set's testCaseId
  // membership must equal TestCaseModel.testCases' id membership exactly
  // - no missing test case, no orphaned/extra candidate referencing a
  // test case outside this model (the chain validator's own F4 rule
  // already independently proved every candidate.testCaseId resolves to
  // a real test case, so "extra" here can only mean "duplicate", already
  // rejected above - this check specifically closes the "missing"
  // direction).
  const testCaseIds = testCaseModelSnapshot.testCases.map((tc) => tc.id);
  const missingTestCaseIds = testCaseIds.filter((id) => !seenTestCaseIds.has(id));
  if (missingTestCaseIds.length > 0) {
    return { ok: false, errors: [err("$.automationCandidates", ERROR_CODES.MISSING_FIELD, "every TestCaseModel.testCases entry requires exactly one AutomationCandidate; at least one is missing")] };
  }

  if (automationCandidatesSnapshot.length !== testCaseIds.length) {
    // Defensive - already implied by the uniqueness + completeness checks
    // above (a candidate set that is duplicate-free, entirely resolves to
    // real test cases, and covers every test case id can only be exactly
    // the same size as testCaseIds), kept as an explicit invariant check.
    return { ok: false, errors: [err("$.automationCandidates", ERROR_CODES.INVALID_VALUE, "automationCandidates count does not match TestCaseModel.testCases count")] };
  }

  // Project binding (Roadmap #22F): every artifact - including the
  // #22F-local frameworkCapability input - must belong to the exact same
  // project. Checked deterministically, before the package is ever
  // constructed for human review.
  automationCandidatesSnapshot.forEach((candidate, i) => {
    if (candidate.projectId !== projectId) {
      errors.push(err(`$.automationCandidates[${i}].projectId`, ERROR_CODES.PROJECT_MISMATCH, "does not match the reviewed project"));
    }
  });
  validateFrameworkCapabilityShape(frameworkCapabilitySnapshot, "$.frameworkCapability", errors, { expectedProjectId: projectId });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Roadmap #22F (Section 15): canonical ORDER is TestCaseModel.testCases'
  // own order, never whatever order the caller happened to pass
  // automationCandidates in - this provides a stable review display, a
  // stable digest, and a stable human target identity regardless of
  // caller array ordering.
  const candidatesByTestCaseId = new Map(automationCandidatesSnapshot.map((c) => [c.testCaseId, c]));
  const orderedCandidates = testCaseIds.map((testCaseId) => candidatesByTestCaseId.get(testCaseId));

  const requirementModelDigest = computeDigest(DIGEST_LABEL_REQUIREMENT_MODEL, requirementModelSnapshot);
  const testCaseModelDigest = computeDigest(DIGEST_LABEL_TEST_CASE_MODEL, testCaseModelSnapshot);
  const reviewTargets = [
    { artifactKind: "RequirementModel", artifactId: requirementModelSnapshot.id, artifactDigest: requirementModelDigest },
    { artifactKind: "TestCaseModel", artifactId: testCaseModelSnapshot.id, artifactDigest: testCaseModelDigest },
    ...orderedCandidates.map((candidate) => ({ artifactKind: "AutomationCandidate", artifactId: candidate.id, artifactDigest: computeDigest(DIGEST_LABEL_AUTOMATION_CANDIDATE, candidate) })),
  ];

  const packageContent = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    projectId,
    requirementModel: requirementModelSnapshot,
    testCaseModel: testCaseModelSnapshot,
    automationCandidates: orderedCandidates,
    frameworkCapability: frameworkCapabilitySnapshot,
    projectProfile: projectProfileSnapshot !== undefined ? projectProfileProjection(projectProfileSnapshot) : null,
    reviewTargets,
  };

  const reviewPackageDigest = computeDigest(DIGEST_LABEL_PACKAGE, packageContent);

  return { ok: true, reviewPackage: deepFreeze({ ...packageContent, reviewPackageDigest }) };
}

/**
 * Recomputes a review package's digest from its own reviewed content
 * (never trusting the `reviewPackageDigest` field already stored on the
 * object) and returns whether it matches. Used by
 * validateApprovedTestDesignReview() (test-design-review-record.js) to
 * detect both outright digest tampering and any material content change
 * since a review record was produced.
 */
function recomputePackageDigest(reviewPackage) {
  if (!isPlainObject(reviewPackage)) return null;
  const { reviewPackageDigest, ...rest } = reviewPackage;
  try {
    return computeDigest(DIGEST_LABEL_PACKAGE, rest);
  } catch {
    return null;
  }
}

module.exports = {
  KIND,
  SCHEMA_VERSION,
  DIGEST_LABEL_PACKAGE,
  DIGEST_LABEL_REQUIREMENT_MODEL,
  DIGEST_LABEL_TEST_CASE_MODEL,
  DIGEST_LABEL_AUTOMATION_CANDIDATE,
  buildTestDesignReviewPackage,
  recomputePackageDigest,
  validateFrameworkCapabilityShape,
};
