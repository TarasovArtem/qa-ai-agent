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
 * Pure orchestration otherwise: no filesystem, network, browser, git,
 * child_process, or repository mutation. The only external effect is a
 * bounded number of provider.analyze() calls through the existing,
 * unmodified scripts/ai/providers/ contract (provider is dependency-
 * injected - this module never knows a provider name, API URL, key, or
 * transport header).
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId } = require("../generation/primitives");
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
// filtering would be arbitrary) and optional ProjectProfile guidance.
function buildPositiveProjection({ requirementModelSnapshot, testCaseModelSnapshot, testCaseSnapshot, projectProfileSnapshot }) {
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
 * Returns `{ ok: true, automationCandidate, providerAttempts }` or
 * `{ ok: false, errors, providerAttempts }` - `errors` is always the
 * bounded `{path, code, message}` shape (at most MAX_CORRECTION_ERRORS
 * entries, never exceeding MAX_CORRECTION_DIAGNOSTIC_CHARS serialized),
 * never a raw provider response, rejected value, or stack trace.
 * `providerAttempts` is 0 whenever a local, deterministic pre-provider gate
 * failed (invalid provider object, invalid/unreadable upstream artifact,
 * unknown testCaseId) - those never consume a provider call.
 */
async function generateAutomationCandidate({ requirementModel, testCaseModel, testCaseId, provider, maxAttempts, expectedProjectId, projectProfile } = {}) {
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
  try {
    requirementModelSnapshot = deepFreeze(snapshotRequirementModel(requirementModel));
    testCaseModelSnapshot = deepFreeze(snapshotTestCaseModel(testCaseModel));
    projectProfileSnapshot = projectProfile === undefined ? undefined : deepFreeze(snapshotProjectProfile(projectProfile));
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

  const testCaseSnapshot = isPlainObject(testCaseModelSnapshot) && Array.isArray(testCaseModelSnapshot.testCases) ? testCaseModelSnapshot.testCases.find((tc) => isPlainObject(tc) && tc.id === testCaseId) : undefined;
  if (!testCaseSnapshot) {
    return { ok: false, errors: [err("$.testCaseId", ERROR_CODES.INVALID_REFERENCE, "unknown test case id")], providerAttempts: 0 };
  }

  const projectId = requirementModelSnapshot.projectId;
  const projection = deepFreeze(buildPositiveProjection({ requirementModelSnapshot, testCaseModelSnapshot, testCaseSnapshot, projectProfileSnapshot }));
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

    // CRITICAL POST-PROVIDER GATE (Roadmap #22E): the frozen cross-model
    // validator both (a) individually validates the parsed
    // AutomationCandidate against its own v1 schema (schemaVersion/kind/id/
    // projectId/testCaseModelId/testCaseId/decision/rationale/evidenceRefs/
    // targetFrameworks shape, unknown-field rejection, decision/framework
    // invariant, dangling rationaleEvidenceRefIds rejection) and (b) checks
    // it against the accepted upstream snapshots: project + schemaVersion
    // consistency across every artifact, candidate.testCaseModelId ===
    // testCaseModel.id, and candidate.testCaseId resolves to a real test
    // case in that model - fail closed, never a best-effort resolution.
    // Reused exactly as scripts/ai/generation/cross-model-validation.js
    // already implements it - never a second, locally reimplemented
    // cross-reference check. Framework authorization is likewise never
    // reimplemented: validateAutomationCandidate's own targetFrameworks
    // check already restricts every entry to the fixed v1
    // SUPPORTED_FRAMEWORKS vocabulary, so a provider can never propose a
    // framework outside cypress/playwright regardless of what its response
    // claims.
    const chainResult = validateGenerationChain({ requirementModel: requirementModelSnapshot, testCaseModel: testCaseModelSnapshot, automationCandidates: [parsed] }, { expectedProjectId: projectId });
    const bindingErrors = validateCandidateBinding(parsed, testCaseId);
    const allErrors = [...(chainResult.ok ? [] : chainResult.errors), ...bindingErrors];

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
  boundGenerationErrors,
  buildPositiveProjection,
  MAX_PROVIDER_ATTEMPTS,
  MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS,
  MAX_CORRECTION_ERRORS,
  MAX_CORRECTION_DIAGNOSTIC_CHARS,
};
