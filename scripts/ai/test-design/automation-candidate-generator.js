/**
 * Provider-backed AutomationCandidate generation (Roadmap #22E).
 *
 * accepted RequirementModel v1 (upstream, from #22C)
 * + accepted TestCaseModel v1 (upstream, from #22D)
 * + the id of ONE test case inside that model
 *   -> single-read snapshot of both upstream artifacts into a fresh
 *      #22E-owned plain-data tree
 *   -> local re-validation of both upstream artifacts AND their existing
 *      cross-model relationship (frozen v1 + frozen cross-model validator)
 *   -> bounded positive provider prompt (automation-candidate-prompt.js)
 *   -> provider response
 *   -> strict JSON parsing
 *   -> frozen cross-model validation (AutomationCandidate v1 shape +
 *      project/schemaVersion consistency + testCaseModel/testCaseId
 *      traceability against the accepted upstream artifacts)
 *   -> #22E-local binding check (the returned candidate must be about the
 *      SAME test case this call was asked to evaluate, never a different
 *      - but still valid - test case in the same model)
 *   -> accepted AutomationCandidate v1.
 *
 * THIS MODULE DOES NOT REGENERATE REQUIREMENTS OR TEST CASES. Both
 * `requirementModel` and `testCaseModel` are ACCEPTED UPSTREAM ARTIFACTS
 * (#22C's and #22D's own output) - this module never calls those
 * generators, never re-ingests raw #22B evidence, and never repairs/
 * normalizes/mutates either model it is given. It only reads accepted
 * requirement/test-case content to ground a provider-authored automation
 * *recommendation* for ONE test case - never automation code, a file path,
 * a selector, or any AutomationPlan content (Roadmap #23C is a separate,
 * later stage this module has no dependency on: it never imports
 * scripts/ai/test-automation/**, never knows about
 * AutomationRepositoryContext, and never reads a real repository/
 * filesystem).
 *
 * This module also does not trust that a caller-supplied RequirementModel/
 * TestCaseModel behaves like ordinary plain data (the #22C-R/#22C-C1/
 * #22D-C1 lesson, reused here rather than re-derived): every caller-owned
 * property this module reads - from either model, at any nesting depth -
 * is read EXACTLY ONCE, up front, into a fresh, frozen, #22E-owned snapshot
 * (see snapshotRequirementModel()/snapshotTestCaseModel() below) before any
 * validation runs at all. Validation, the prompt projection, and the
 * post-provider cross-model/binding checks all consume those two snapshots
 * exclusively; neither caller object is ever read again past that point,
 * and neither is ever mutated or frozen.
 *
 * PROJECT-SCOPED FRAMEWORK AUTHORIZATION (Roadmap #22E-R1): a senior review
 * of the original implementation found that AutomationCandidate v1's own
 * targetFrameworks check only enforces the GLOBAL, project-agnostic
 * SUPPORTED_FRAMEWORKS vocabulary ("cypress"/"playwright") - it has no
 * notion of which framework(s) a SPECIFIC project actually supports. A
 * provider could therefore recommend "playwright" for a project whose real
 * trusted capability is "cypress only", and the frozen schema alone would
 * accept it (both names are individually valid enum members). No
 * authoritative per-project framework-capability data source exists
 * anywhere else in this repository (confirmed by direct search: ProjectProfile
 * has no such field, and scripts/ai/test-automation/automation-repository-
 * context.js - #23B - is architecturally off-limits as a dependency here,
 * since #22E must never depend on #23). `frameworkCapability` (see
 * generateAutomationCandidate()'s own parameter doc below) is therefore a
 * new, REQUIRED, #22E-local, project-bound generator input - the narrowest
 * safe addition consistent with the existing ProjectProfile pattern (a
 * plain, caller-supplied, safely-snapshotted object) - never a change to
 * any frozen v1 contract. The global SUPPORTED_FRAMEWORKS enum remains
 * exactly what it always was: schema VOCABULARY (which strings are
 * well-formed framework names at all), never AUTHORIZATION (which of those
 * names this specific project may actually use) - the two checks are now
 * layered, never merged, and the project-specific check always runs in
 * addition to, never instead of, the frozen schema's own enum check.
 *
 * EVIDENCE PROVENANCE BINDING (Roadmap #22E-R1): the same review found that
 * candidate.evidenceRefs was validated only for internal structural
 * consistency (id/kind/locator bounds) and that candidate.
 * rationaleEvidenceRefIds was checked only against that SAME
 * provider-authored array - a provider could invent an entirely fabricated,
 * syntactically valid evidence entry and then "cite" its own fabrication,
 * with nothing external ever checked. Every candidate.evidenceRefs entry is
 * now required to match - by full canonical identity (id AND kind AND
 * sourceId AND location, exactly as scripts/ai/generation/primitives.js's
 * own validateEvidenceRef treats those fields) - an entry that genuinely
 * exists in the accepted RequirementModel's own evidenceRefs registry
 * (see buildTrustedEvidenceRegistry()/validateEvidenceProvenance() below).
 * This is the only trusted, already-available evidence source #22E has
 * without adding a new upstream ingestion dependency (which would be a
 * redesign, not a narrow hardening fix) - it is also now positively
 * projected into the prompt (as plain id/kind/sourceId/location pointers,
 * never raw evidence content) so a well-behaved provider has a genuine,
 * quotable menu to cite from instead of inventing one.
 *
 * Pure orchestration otherwise: no filesystem, network, browser, git,
 * child_process, or repository mutation. The only external effect is a
 * bounded number of provider.analyze() calls through the existing,
 * unmodified scripts/ai/providers/ contract (provider is dependency-
 * injected - this module never knows a provider name, API URL, key, or
 * transport header).
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId, SUPPORTED_FRAMEWORKS } = require("../generation/primitives");
const { LIMITS } = require("../generation/limits");
const { validateGenerationChain } = require("../generation/cross-model-validation");
const { validateProvider, validateProviderResponse } = require("../providers/provider-contract");
const { normalizeProviderError, PROVIDER_ERROR_CODES } = require("../providers/provider-error");
const { buildAutomationCandidateSystemPrompt, buildAutomationCandidateUserPrompt } = require("./automation-candidate-prompt");

// Roadmap #22E: initial attempt + at most one bounded correction retry -
// never unbounded, never recursive. Mirrors #22C's/#22D's own retry policy
// exactly (the established #22-stream convention this module is part of;
// Roadmap #23C's own generator independently chose a stricter
// undefined/1/2-only maxAttempts policy for its own, separately reviewed
// reasons - #22E is not #23C and follows its own stream's convention).
const MAX_PROVIDER_ATTEMPTS = 2;

// Roadmap #22E response-size bound, derived the same way #22D-C1 derived
// its own (a formula from the actual frozen scripts/ai/generation/limits.js
// maxima, never a "realistic output" guess - see test-case-model-generator.js's
// own comment for why a fixed guess was found insufficient). Every bounded
// string field AutomationCandidate v1 permits (isBoundedText/isValidId) may
// legitimately contain a quote, backslash, tab, newline, or carriage
// return, and JSON.stringify expands each to exactly 2 output characters -
// a 2x escaping factor per character-limited field is EXACT, not merely
// conservative. This is a post-provider parse/retention guard, never a
// network-transport byte limit.
const JSON_ESCAPE_FACTOR = 2;
const STRUCTURAL_OVERHEAD_PER_STRING = 8; // quotes + comma + margin
const STRUCTURAL_OVERHEAD_PER_OBJECT = 96; // field-name keys + braces/commas, generous
const STRUCTURAL_OVERHEAD_PER_ENUM = 64; // a short, closed-vocabulary string field

function maxIdFieldSize() {
  return LIMITS.ID_MAX_LENGTH * JSON_ESCAPE_FACTOR + STRUCTURAL_OVERHEAD_PER_STRING;
}
function maxTextFieldSize(maxLength) {
  return maxLength * JSON_ESCAPE_FACTOR + STRUCTURAL_OVERHEAD_PER_STRING;
}

// EvidenceRef worst case: id + kind + BOTH optional sourceId and location
// present simultaneously (validateEvidenceRef's own rule is "at least one
// of sourceId/location", never "at most one").
const MAX_EVIDENCE_REF_SIZE =
  maxIdFieldSize() + // id
  STRUCTURAL_OVERHEAD_PER_ENUM + // kind
  maxIdFieldSize() + // sourceId
  maxTextFieldSize(LIMITS.SHORT_TEXT_MAX_LENGTH) + // location
  STRUCTURAL_OVERHEAD_PER_OBJECT;

const MAX_ASSUMPTION_SIZE =
  maxIdFieldSize() + // id
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // text
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // rationale
  STRUCTURAL_OVERHEAD_PER_OBJECT;

const MAX_OPEN_QUESTION_SIZE =
  maxIdFieldSize() + // id
  STRUCTURAL_OVERHEAD_PER_ENUM + // type
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // description
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // reason
  STRUCTURAL_OVERHEAD_PER_OBJECT;

const MAX_TOP_LEVEL_OVERHEAD =
  maxIdFieldSize() * 4 + // id, projectId, testCaseModelId, testCaseId
  STRUCTURAL_OVERHEAD_PER_ENUM + // decision
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // rationale
  64 + // schemaVersion, kind
  STRUCTURAL_OVERHEAD_PER_OBJECT;

const MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS =
  MAX_TOP_LEVEL_OVERHEAD +
  LIMITS.MAX_EVIDENCE_REFS * MAX_EVIDENCE_REF_SIZE + // evidenceRefs
  LIMITS.MAX_EVIDENCE_REFS * maxIdFieldSize() + // rationaleEvidenceRefIds
  2 * STRUCTURAL_OVERHEAD_PER_ENUM + // targetFrameworks (closed 2-value vocabulary)
  LIMITS.MAX_ASSUMPTIONS * MAX_ASSUMPTION_SIZE +
  LIMITS.MAX_OPEN_QUESTIONS * MAX_OPEN_QUESTION_SIZE;

// Roadmap #22E: closes the #22C-C1 diagnostic-amplification lesson from the
// start rather than discovering it after the fact - same bounds as #22D.
const MAX_CORRECTION_ERRORS = 20;
const MAX_CORRECTION_DIAGNOSTIC_CHARS = 8192;

// --- snapshot (Roadmap #22E; reuses the #22D-C1 hardened mechanism
// verbatim, never a casually reimplemented weaker clone - see
// scripts/ai/test-design/test-case-model-generator.js's own, more detailed
// comment for the exact prototype-pollution/caller-array-method exploits
// this closes) -----------------------------------------------------------

function snapshotOwnProperties(value) {
  if (!isPlainObject(value)) return value;
  const snapshot = Object.create(null);
  for (const key of Object.keys(value)) {
    const propertyValue = value[key];
    Object.defineProperty(snapshot, key, { value: propertyValue, enumerable: true, writable: true, configurable: true });
  }
  return snapshot;
}

function snapshotArray(value, snapshotItem) {
  if (!Array.isArray(value)) return value;
  const length = value.length;
  const ownKeys = Object.keys(value);
  for (const key of ownKeys) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
      throw new Error("array carries an unexpected own property");
    }
  }
  if (ownKeys.length !== length) {
    throw new Error("sparse array is not valid plain data");
  }
  const fresh = new Array(length);
  for (let i = 0; i < length; i += 1) {
    fresh[i] = snapshotItem(value[i]);
  }
  return fresh;
}

function snapshotArrayOfObjects(value) {
  return snapshotArray(value, (item) => snapshotOwnProperties(item));
}

function snapshotArrayOfPrimitives(value) {
  return snapshotArray(value, (item) => item);
}

// Reads the ENTIRE caller-supplied RequirementModel exactly once - top
// level, every requirement/evidenceRef/assumption/openQuestion - into a
// fresh, inert plain-data tree. Identical in structure to #22D's own
// snapshotRequirementModel() (RequirementModel v1's shape is unchanged).
function snapshotRequirementModel(requirementModel) {
  const modelSnapshot = snapshotOwnProperties(requirementModel);
  if (!isPlainObject(modelSnapshot)) return modelSnapshot;

  if (Array.isArray(modelSnapshot.requirements)) {
    modelSnapshot.requirements = snapshotArray(modelSnapshot.requirements, (requirement) => {
      const requirementSnapshot = snapshotOwnProperties(requirement);
      if (isPlainObject(requirementSnapshot) && Array.isArray(requirementSnapshot.evidenceRefIds)) {
        requirementSnapshot.evidenceRefIds = snapshotArrayOfPrimitives(requirementSnapshot.evidenceRefIds);
      }
      return requirementSnapshot;
    });
  }
  if (Array.isArray(modelSnapshot.evidenceRefs)) {
    modelSnapshot.evidenceRefs = snapshotArrayOfObjects(modelSnapshot.evidenceRefs);
  }
  if (Array.isArray(modelSnapshot.assumptions)) {
    modelSnapshot.assumptions = snapshotArrayOfObjects(modelSnapshot.assumptions);
  }
  if (Array.isArray(modelSnapshot.openQuestions)) {
    modelSnapshot.openQuestions = snapshotArrayOfObjects(modelSnapshot.openQuestions);
  }
  return modelSnapshot;
}

// Reads the ENTIRE caller-supplied TestCaseModel exactly once - top level,
// every testCase/step/priority - into a fresh, inert plain-data tree.
function snapshotTestCaseModel(testCaseModel) {
  const modelSnapshot = snapshotOwnProperties(testCaseModel);
  if (!isPlainObject(modelSnapshot)) return modelSnapshot;

  if (Array.isArray(modelSnapshot.testCases)) {
    modelSnapshot.testCases = snapshotArray(modelSnapshot.testCases, (testCase) => {
      const testCaseSnapshot = snapshotOwnProperties(testCase);
      if (!isPlainObject(testCaseSnapshot)) return testCaseSnapshot;

      if (Array.isArray(testCaseSnapshot.requirementIds)) {
        testCaseSnapshot.requirementIds = snapshotArrayOfPrimitives(testCaseSnapshot.requirementIds);
      }
      if (Array.isArray(testCaseSnapshot.preconditions)) {
        testCaseSnapshot.preconditions = snapshotArrayOfPrimitives(testCaseSnapshot.preconditions);
      }
      if (Array.isArray(testCaseSnapshot.steps)) {
        testCaseSnapshot.steps = snapshotArray(testCaseSnapshot.steps, (step) => {
          const stepSnapshot = snapshotOwnProperties(step);
          if (isPlainObject(stepSnapshot) && Array.isArray(stepSnapshot.requirementIds)) {
            stepSnapshot.requirementIds = snapshotArrayOfPrimitives(stepSnapshot.requirementIds);
          }
          return stepSnapshot;
        });
      }
      if (testCaseSnapshot.priority !== undefined) {
        const prioritySnapshot = snapshotOwnProperties(testCaseSnapshot.priority);
        if (isPlainObject(prioritySnapshot) && Array.isArray(prioritySnapshot.requirementIds)) {
          prioritySnapshot.requirementIds = snapshotArrayOfPrimitives(prioritySnapshot.requirementIds);
        }
        testCaseSnapshot.priority = prioritySnapshot;
      }
      return testCaseSnapshot;
    });
  }
  return modelSnapshot;
}

// Reads a caller-supplied ProjectProfile-shaped guidance object exactly
// once - the same "own data only, never a caller method/prototype" safety
// as every other snapshot in this module, even though ProjectProfile
// content is prompt-only guidance, never validated schema content (see
// buildPositiveProjection() below and scripts/ai/project-profile.js's own
// "GUIDANCE, NEVER EVIDENCE" ledger).
function snapshotProjectProfile(projectProfile) {
  const snapshot = snapshotOwnProperties(projectProfile);
  if (!isPlainObject(snapshot)) return snapshot;
  if (Array.isArray(snapshot.knownProjectConstraints)) {
    snapshot.knownProjectConstraints = snapshotArrayOfPrimitives(snapshot.knownProjectConstraints);
  }
  return snapshot;
}

// Roadmap #22E-R1: reads a caller-supplied project-specific framework
// capability object exactly once, via the exact same safe mechanism as
// every other snapshot in this module - a caller-owned `.map`/`.slice`
// override on `supportedFrameworks`, an own "__proto__" key, an own Symbol
// key, a sparse array, or a getter mutation are all closed by the shared
// snapshotOwnProperties()/snapshotArrayOfPrimitives() machinery, never a
// second, weaker copy.
function snapshotFrameworkCapability(frameworkCapability) {
  const snapshot = snapshotOwnProperties(frameworkCapability);
  if (!isPlainObject(snapshot)) return snapshot;
  if (Array.isArray(snapshot.supportedFrameworks)) {
    snapshot.supportedFrameworks = snapshotArrayOfPrimitives(snapshot.supportedFrameworks);
  }
  return snapshot;
}

// Deep-freezes a plain-data tree (the only shapes this module ever
// produces) - never applied to a caller-owned object.
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

// --- bounded generation diagnostics (applying the #22C-C1 lesson, reused
// verbatim from #22D) --------------------------------------------------------
function boundGenerationErrors(errors) {
  const bounded = [];
  let serializedLength = 2; // "[]"
  for (const e of errors) {
    if (bounded.length >= MAX_CORRECTION_ERRORS) break;
    const projected = { path: e.path, code: e.code, message: e.message };
    const addedLength = JSON.stringify(projected).length + (bounded.length > 0 ? 1 : 0);
    if (serializedLength + addedLength > MAX_CORRECTION_DIAGNOSTIC_CHARS) break;
    bounded.push(projected);
    serializedLength += addedLength;
  }
  return bounded;
}

// --- provider error privacy (mirrors #22C's/#22D's own local copy) ---------
const SAFE_PROVIDER_ERROR_MESSAGES = Object.freeze({
  [PROVIDER_ERROR_CODES.AUTH]: "Provider authentication failed",
  [PROVIDER_ERROR_CODES.RATE_LIMIT]: "Provider rate limit exceeded",
  [PROVIDER_ERROR_CODES.TIMEOUT]: "Provider request timed out",
  [PROVIDER_ERROR_CODES.NETWORK]: "Provider network request failed",
  [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: "Provider returned an invalid response",
  [PROVIDER_ERROR_CODES.CONFIGURATION]: "Provider configuration error",
  [PROVIDER_ERROR_CODES.UNKNOWN]: "Unknown provider error",
});

function summarizeProviderError(providerError) {
  const message = SAFE_PROVIDER_ERROR_MESSAGES[providerError.code] || SAFE_PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.UNKNOWN];
  return err("$.provider", providerError.code || PROVIDER_ERROR_CODES.UNKNOWN, message);
}

function resolveMaxAttempts(maxAttempts) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) return MAX_PROVIDER_ATTEMPTS;
  return Math.min(maxAttempts, MAX_PROVIDER_ATTEMPTS);
}

// Builds the ONLY object ever sent to the provider. A deliberate positive
// allowlist covering exactly one test case (never the other test cases in
// the model) plus the requirements it actually references, plus the whole
// model's assumptions/openQuestions (both are model-scoped, not tied to a
// specific requirement in RequirementModel v1's own schema, so partial
// filtering would be arbitrary), optional ProjectProfile guidance, the
// project-specific authorized framework set (Roadmap #22E-R1 H1), and the
// trusted evidence registry the provider may cite from (Roadmap #22E-R1
// H2) - projected as plain id/kind/sourceId/location POINTERS only, never
// raw evidence content, matching scripts/ai/generation/primitives.js's own
// EvidenceRef design ("pointers, never a container for the evidence's own
// raw content").
function buildPositiveProjection({ requirementModelSnapshot, testCaseModelSnapshot, testCaseSnapshot, projectProfileSnapshot, frameworkCapabilitySnapshot }) {
  const referencedRequirementIds = new Set(testCaseSnapshot.requirementIds);
  return {
    projectId: requirementModelSnapshot.projectId,
    testCaseModelId: testCaseModelSnapshot.id,
    testCase: {
      id: testCaseSnapshot.id,
      title: testCaseSnapshot.title,
      objective: testCaseSnapshot.objective,
      requirementIds: testCaseSnapshot.requirementIds,
      preconditions: testCaseSnapshot.preconditions,
      steps: testCaseSnapshot.steps.map((s) => ({ action: s.action, expectedResult: s.expectedResult, requirementIds: s.requirementIds })),
      priority: testCaseSnapshot.priority ? { level: testCaseSnapshot.priority.level, rationale: testCaseSnapshot.priority.rationale, requirementIds: testCaseSnapshot.priority.requirementIds } : undefined,
    },
    requirements: requirementModelSnapshot.requirements.filter((r) => referencedRequirementIds.has(r.id)).map((r) => ({ id: r.id, text: r.text })),
    assumptions: (requirementModelSnapshot.assumptions || []).map((a) => ({ id: a.id, text: a.text, rationale: a.rationale })),
    openQuestions: (requirementModelSnapshot.openQuestions || []).map((q) => ({ id: q.id, type: q.type, description: q.description, reason: q.reason })),
    projectProfile: projectProfileSnapshot && isPlainObject(projectProfileSnapshot) ? { displayName: projectProfileSnapshot.displayName, knownProjectConstraints: projectProfileSnapshot.knownProjectConstraints } : null,
    authorizedFrameworks: frameworkCapabilitySnapshot.supportedFrameworks,
    availableEvidence: requirementModelSnapshot.evidenceRefs.map((e) => ({ id: e.id, kind: e.kind, sourceId: e.sourceId, location: e.location })),
  };
}

// #22E-local binding check: the accepted candidate must be about the exact
// test case this call was asked to evaluate. The frozen cross-model
// validator's own F4 rule only proves `candidate.testCaseId` resolves to
// SOME test case in the model - it has no notion of "the one the caller
// asked about", since a chain-validation call may legitimately carry many
// candidates for many test cases at once elsewhere in this foundation.
// This mirrors Roadmap #23C's own validatePlanBinding() pattern: a small,
// #22E-local addition layered on top of (never replacing) the frozen
// validator, never a second reimplementation of what F4 already checks.
function validateCandidateBinding(candidate, requestedTestCaseId) {
  if (!isPlainObject(candidate)) return [];
  if (candidate.testCaseId !== requestedTestCaseId) {
    return [err("$.testCaseId", ERROR_CODES.INVALID_REFERENCE, "does not match the test case this generation call was requested for")];
  }
  return [];
}

// --- H1: project-scoped framework authorization (Roadmap #22E-R1) ----------

const FRAMEWORK_CAPABILITY_ALLOWED_KEYS = Object.freeze(["projectId", "supportedFrameworks"]);

// Validates the #22E-local `frameworkCapability` snapshot shape and binds
// it to the same project as the upstream artifacts - a mismatched or
// malformed capability object is rejected here, before any provider call,
// exactly like every other pre-provider gate in this module. `expectedProjectId`
// here is always the SNAPSHOT's own already-validated projectId (see
// generateAutomationCandidate() below), never the caller's raw, unvalidated
// parameter - the same "intrinsic binding, optional external cross-check is
// additive only" posture Roadmap #23C's own generator established.
function validateFrameworkCapabilitySnapshot(capability, { expectedProjectId }) {
  const errors = [];
  if (!isPlainObject(capability)) {
    return [err("$.frameworkCapability", ERROR_CODES.INVALID_TYPE, "frameworkCapability must be a plain object")];
  }
  for (const key of Object.keys(capability)) {
    if (!FRAMEWORK_CAPABILITY_ALLOWED_KEYS.includes(key)) {
      errors.push(err(`$.frameworkCapability.${key}`, ERROR_CODES.UNKNOWN_FIELD, "$.frameworkCapability: unknown field"));
    }
  }
  if (!isValidId(capability.projectId)) {
    errors.push(err("$.frameworkCapability.projectId", ERROR_CODES.INVALID_TYPE, "$.frameworkCapability.projectId must be a bounded string id"));
  } else if (expectedProjectId !== undefined && capability.projectId !== expectedProjectId) {
    errors.push(err("$.frameworkCapability.projectId", ERROR_CODES.PROJECT_MISMATCH, "$.frameworkCapability.projectId does not match the accepted upstream project"));
  }
  if (!Array.isArray(capability.supportedFrameworks)) {
    errors.push(err("$.frameworkCapability.supportedFrameworks", ERROR_CODES.MISSING_FIELD, "$.frameworkCapability.supportedFrameworks must be an array"));
  } else if (capability.supportedFrameworks.length > SUPPORTED_FRAMEWORKS.length) {
    errors.push(err("$.frameworkCapability.supportedFrameworks", ERROR_CODES.INVALID_VALUE, `$.frameworkCapability.supportedFrameworks exceeds the maximum of ${SUPPORTED_FRAMEWORKS.length}`));
  } else {
    // Roadmap #22E-R1: every project-specific authorized framework must
    // ITSELF already be a member of the closed global vocabulary - the
    // global enum remains schema VOCABULARY (which names are well-formed
    // framework identifiers at all); this project-specific array is the
    // AUTHORIZATION layer on top of it, never a replacement or a second,
    // independent vocabulary a caller could use to smuggle a name the
    // frozen v1 schema itself would never accept.
    capability.supportedFrameworks.forEach((fw, i) => {
      if (!SUPPORTED_FRAMEWORKS.includes(fw)) {
        errors.push(err(`$.frameworkCapability.supportedFrameworks[${i}]`, ERROR_CODES.INVALID_ENUM, `$.frameworkCapability.supportedFrameworks[${i}] must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
      }
    });
    if (new Set(capability.supportedFrameworks).size !== capability.supportedFrameworks.length) {
      errors.push(err("$.frameworkCapability.supportedFrameworks", ERROR_CODES.DUPLICATE_ID, "$.frameworkCapability.supportedFrameworks must not contain duplicate frameworks"));
    }
  }
  return errors;
}

// Roadmap #22E-R1 (H1): applied to EVERY accepted candidate regardless of
// `decision` - the frozen v1 schema explicitly permits a non-empty
// targetFrameworks on DO_NOT_AUTOMATE/BLOCKED (recording which frameworks
// were merely considered), so this must not be gated to AUTOMATE only. Every
// entry in the provider's own targetFrameworks array must be a member of
// THIS project's authorized set - the frozen validator's own enum check
// already proved each entry is a well-formed GLOBAL framework name; this is
// the separate, additional, project-specific AUTHORIZATION check.
function validateFrameworkAuthorization(candidate, authorizedFrameworks) {
  if (!isPlainObject(candidate) || !Array.isArray(candidate.targetFrameworks)) return [];
  const authorizedSet = new Set(authorizedFrameworks);
  const errors = [];
  candidate.targetFrameworks.forEach((fw, i) => {
    if (!authorizedSet.has(fw)) {
      errors.push(err(`$.targetFrameworks[${i}]`, ERROR_CODES.INVARIANT_VIOLATION, `$.targetFrameworks[${i}] is not an authorized framework for this project`));
    }
  });
  return errors;
}

// --- H2: evidence provenance binding (Roadmap #22E-R1) ---------------------

// Builds the trusted evidence registry from the accepted RequirementModel
// snapshot - a Map keyed by evidenceRef id, values holding the FULL
// canonical identity (kind, sourceId, location) needed for exact-match
// comparison below. `undefined` is used (not omitted) for an absent
// sourceId/location so a candidate entry that also omits that same field
// compares as a genuine match, while one that INVENTS a value where the
// trusted entry has none is correctly caught as a mismatch.
function buildTrustedEvidenceRegistry(requirementModelSnapshot) {
  const registry = new Map();
  for (const evidenceRef of requirementModelSnapshot.evidenceRefs) {
    if (isPlainObject(evidenceRef) && typeof evidenceRef.id === "string") {
      registry.set(evidenceRef.id, { id: evidenceRef.id, kind: evidenceRef.kind, sourceId: evidenceRef.sourceId, location: evidenceRef.location });
    }
  }
  return registry;
}

// Roadmap #22E-R1 (H2): every candidate.evidenceRefs entry must resolve, by
// FULL canonical identity, to a genuine entry in the trusted registry - an
// unknown id, or a known id whose kind/sourceId/location has been altered
// from the trusted entry, is rejected. This closes the "provider invents
// evidence AND its own citation" class the original implementation had: a
// provider proposing a syntactically-valid-but-fabricated evidenceRefs
// entry (whether a brand-new id, or a known id with an altered sourceId/
// kind/location) is rejected here, BEFORE the existing (and still useful)
// rationaleEvidenceRefIds-resolves-within-evidenceRefs check ever runs -
// the full chain is now trusted registry -> candidate.evidenceRefs ->
// rationaleEvidenceRefIds, never merely candidate.evidenceRefs ->
// rationaleEvidenceRefIds in isolation.
function validateEvidenceProvenance(candidate, trustedEvidenceRegistry) {
  if (!isPlainObject(candidate) || !Array.isArray(candidate.evidenceRefs)) return [];
  const errors = [];
  candidate.evidenceRefs.forEach((ref, i) => {
    if (!isPlainObject(ref) || typeof ref.id !== "string") return; // already reported by the frozen validator's own shape check
    const trusted = trustedEvidenceRegistry.get(ref.id);
    if (!trusted) {
      errors.push(err(`$.evidenceRefs[${i}].id`, ERROR_CODES.INVALID_REFERENCE, `$.evidenceRefs[${i}] does not correspond to any supplied trusted evidence`));
      return;
    }
    if (ref.kind !== trusted.kind || ref.sourceId !== trusted.sourceId || ref.location !== trusted.location) {
      errors.push(err(`$.evidenceRefs[${i}]`, ERROR_CODES.INVALID_REFERENCE, `$.evidenceRefs[${i}] does not match the trusted evidence entry's canonical identity`));
    }
  });
  return errors;
}

/**
 * Generates a grounded AutomationCandidate v1 for ONE test case inside an
 * accepted TestCaseModel v1, grounded in an accepted RequirementModel v1,
 * via a dependency-injected provider.
 *
 * `testCaseId` identifies which test case inside `testCaseModel.testCases`
 * to evaluate - validated against the accepted snapshot before any
 * provider call, so an unknown id makes zero provider calls.
 *
 * `projectProfile`, when supplied, is optional prompt-only GUIDANCE (never
 * validated schema content, never evidence) - the same
 * scripts/ai/project-profile.js shape (`displayName`,
 * `knownProjectConstraints`).
 *
 * `frameworkCapability` (Roadmap #22E-R1) is REQUIRED: `{projectId,
 * supportedFrameworks}`, the project-specific set of frameworks this
 * candidate's targetFrameworks may draw from. It must belong to the same
 * project as `requirementModel`/`testCaseModel` (checked intrinsically
 * against the accepted snapshot's own projectId, regardless of whether
 * `expectedProjectId` was also supplied) and every entry must already be a
 * member of the frozen v1 SUPPORTED_FRAMEWORKS vocabulary - this input
 * narrows that global vocabulary down to what THIS project actually
 * supports, it can never widen it.
 *
 * Returns `{ ok: true, automationCandidate, providerAttempts }` or
 * `{ ok: false, errors, providerAttempts }` - `errors` is always the
 * bounded `{path, code, message}` shape (at most MAX_CORRECTION_ERRORS
 * entries, never exceeding MAX_CORRECTION_DIAGNOSTIC_CHARS serialized),
 * never a raw provider response, rejected value, or stack trace.
 * `providerAttempts` is 0 whenever a local, deterministic pre-provider gate
 * failed (invalid provider object, invalid/unreadable upstream artifact,
 * unknown testCaseId, invalid/mismatched frameworkCapability) - those never
 * consume a provider call.
 */
async function generateAutomationCandidate({ requirementModel, testCaseModel, testCaseId, frameworkCapability, provider, maxAttempts, expectedProjectId, projectProfile } = {}) {
  try {
    validateProvider(provider);
  } catch (rawErr) {
    return { ok: false, errors: [summarizeProviderError(normalizeProviderError(rawErr))], providerAttempts: 0 };
  }

  // Roadmap #22E: both caller-controlled upstream artifacts (and the
  // optional ProjectProfile guidance) are read exactly once, right here,
  // into fresh #22E-owned plain-data snapshots, then frozen. None of
  // `requirementModel`/`testCaseModel`/`projectProfile` is ever read again
  // below this line - every subsequent step (upstream validation, prompt
  // projection, cross-model/binding check) consumes only the snapshots. A
  // getter/accessor that throws during this single read is caught and
  // reported as a bounded, static, privacy-safe diagnostic - never the raw
  // thrown message/stack, never any model content - with zero provider
  // calls.
  let requirementModelSnapshot;
  let testCaseModelSnapshot;
  let projectProfileSnapshot;
  let frameworkCapabilitySnapshot;
  try {
    requirementModelSnapshot = deepFreeze(snapshotRequirementModel(requirementModel));
    testCaseModelSnapshot = deepFreeze(snapshotTestCaseModel(testCaseModel));
    projectProfileSnapshot = projectProfile === undefined ? undefined : deepFreeze(snapshotProjectProfile(projectProfile));
    frameworkCapabilitySnapshot = deepFreeze(snapshotFrameworkCapability(frameworkCapability));
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "upstream artifacts could not be read")], providerAttempts: 0 };
  }

  if (!isValidId(testCaseId)) {
    return { ok: false, errors: [err("$.testCaseId", ERROR_CODES.INVALID_TYPE, "testCaseId must be a bounded string id")], providerAttempts: 0 };
  }

  // Upstream artifact validation (Roadmap #22E): both accepted models, AND
  // their existing project/schemaVersion/requirement-linkage relationship,
  // are re-validated here via the frozen shared chain validator - never
  // trusted merely because they are shaped like #22C's/#22D's own output,
  // and never a second, locally reimplemented cross-reference check.
  // `expectedProjectId`, when supplied, is an additional orchestrator-level
  // constraint checked via that same frozen mechanism; malformed or
  // mismatched values fail closed with zero provider calls.
  const upstreamResult = validateGenerationChain({ requirementModel: requirementModelSnapshot, testCaseModel: testCaseModelSnapshot }, { expectedProjectId });
  if (!upstreamResult.ok) {
    return { ok: false, errors: boundGenerationErrors(upstreamResult.errors), providerAttempts: 0 };
  }

  const projectId = requirementModelSnapshot.projectId;

  // Roadmap #22E-R1 (H1): the project-specific framework capability is
  // validated and bound to the SAME project as the upstream artifacts here,
  // before any provider call - a malformed or cross-project capability
  // object is rejected with zero provider calls, exactly like every other
  // pre-provider gate in this function.
  const frameworkCapabilityErrors = validateFrameworkCapabilitySnapshot(frameworkCapabilitySnapshot, { expectedProjectId: projectId });
  if (frameworkCapabilityErrors.length > 0) {
    return { ok: false, errors: boundGenerationErrors(frameworkCapabilityErrors), providerAttempts: 0 };
  }

  const testCaseSnapshot = isPlainObject(testCaseModelSnapshot) && Array.isArray(testCaseModelSnapshot.testCases) ? testCaseModelSnapshot.testCases.find((tc) => isPlainObject(tc) && tc.id === testCaseId) : undefined;
  if (!testCaseSnapshot) {
    return { ok: false, errors: [err("$.testCaseId", ERROR_CODES.INVALID_REFERENCE, "unknown test case id")], providerAttempts: 0 };
  }

  // Roadmap #22E-R1 (H2): the trusted evidence registry a provider may cite
  // from is derived here, from the accepted RequirementModel snapshot only
  // - never from anything the provider will later produce.
  const trustedEvidenceRegistry = buildTrustedEvidenceRegistry(requirementModelSnapshot);

  const projection = deepFreeze(buildPositiveProjection({ requirementModelSnapshot, testCaseModelSnapshot, testCaseSnapshot, projectProfileSnapshot, frameworkCapabilitySnapshot }));
  const systemPrompt = buildAutomationCandidateSystemPrompt();
  const attempts = resolveMaxAttempts(maxAttempts);

  let providerAttempts = 0;
  let lastErrors = [];
  let correctionErrors = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    providerAttempts = attempt;
    const userPrompt = buildAutomationCandidateUserPrompt(projection, { correctionErrors });

    let response;
    try {
      response = await provider.analyze({ systemPrompt, userPrompt });
      validateProviderResponse(response);
    } catch (rawErr) {
      const providerError = normalizeProviderError(rawErr);
      lastErrors = [summarizeProviderError(providerError)];
      if (attempt === attempts || !providerError.retryable) {
        return { ok: false, errors: lastErrors, providerAttempts };
      }
      // A transport/contract-level failure carries no validation
      // diagnostic to correct - resend the original prompt unchanged.
      correctionErrors = null;
      continue;
    }

    if (response.length > MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS) {
      lastErrors = [err("$", ERROR_CODES.INVALID_VALUE, "provider response exceeds the maximum allowed length")];
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    // Strict parsing: trim whitespace only, then JSON.parse. No
    // markdown-fence stripping, no "find first { ... }", no regex
    // extraction, no repair - a fenced or otherwise non-strict response
    // fails exactly like any other invalid JSON.
    let parsed;
    try {
      parsed = JSON.parse(response.trim());
    } catch {
      lastErrors = [err("$", ERROR_CODES.INVALID_TYPE, "provider response was not valid JSON")];
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    // CRITICAL POST-PROVIDER GATE (Roadmap #22E, hardened #22E-R1): the
    // frozen cross-model validator both (a) individually validates the
    // parsed AutomationCandidate against its own v1 schema (schemaVersion/
    // kind/id/projectId/testCaseModelId/testCaseId/decision/rationale/
    // evidenceRefs/targetFrameworks shape, unknown-field rejection,
    // decision/framework invariant, dangling rationaleEvidenceRefIds
    // rejection) and (b) checks it against the accepted upstream snapshots:
    // project + schemaVersion consistency across every artifact,
    // candidate.testCaseModelId === testCaseModel.id, and
    // candidate.testCaseId resolves to a real test case in that model -
    // fail closed, never a best-effort resolution. Reused exactly as
    // scripts/ai/generation/cross-model-validation.js already implements
    // it - never a second, locally reimplemented cross-reference check.
    // validateAutomationCandidate's own targetFrameworks check restricts
    // every entry to the fixed v1 SUPPORTED_FRAMEWORKS VOCABULARY (which
    // names are well-formed at all) - validateFrameworkAuthorization()
    // below is the separate, additional, project-specific AUTHORIZATION
    // layer (Roadmap #22E-R1 H1) on top of it, applied regardless of
    // `decision` (the frozen schema permits non-empty targetFrameworks on
    // DO_NOT_AUTOMATE/BLOCKED too). validateEvidenceProvenance() (Roadmap
    // #22E-R1 H2) closes the evidence-fabrication gap: every
    // candidate.evidenceRefs entry must match a genuine trusted registry
    // entry by full canonical identity, checked BEFORE the frozen
    // validator's own (still useful, but no longer sufficient alone)
    // rationaleEvidenceRefIds-within-evidenceRefs check is treated as
    // meaningful.
    const chainResult = validateGenerationChain({ requirementModel: requirementModelSnapshot, testCaseModel: testCaseModelSnapshot, automationCandidates: [parsed] }, { expectedProjectId: projectId });
    const bindingErrors = validateCandidateBinding(parsed, testCaseId);
    const frameworkAuthorizationErrors = validateFrameworkAuthorization(parsed, frameworkCapabilitySnapshot.supportedFrameworks);
    const evidenceProvenanceErrors = validateEvidenceProvenance(parsed, trustedEvidenceRegistry);
    const allErrors = [...(chainResult.ok ? [] : chainResult.errors), ...bindingErrors, ...frameworkAuthorizationErrors, ...evidenceProvenanceErrors];

    if (allErrors.length > 0) {
      lastErrors = boundGenerationErrors(allErrors);
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    return { ok: true, automationCandidate: deepFreeze(parsed), providerAttempts };
  }

  return { ok: false, errors: lastErrors, providerAttempts };
}

module.exports = {
  generateAutomationCandidate,
  snapshotRequirementModel,
  snapshotTestCaseModel,
  snapshotFrameworkCapability,
  boundGenerationErrors,
  buildPositiveProjection,
  buildTrustedEvidenceRegistry,
  validateFrameworkAuthorization,
  validateEvidenceProvenance,
  MAX_PROVIDER_ATTEMPTS,
  MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS,
  MAX_CORRECTION_ERRORS,
  MAX_CORRECTION_DIAGNOSTIC_CHARS,
};
