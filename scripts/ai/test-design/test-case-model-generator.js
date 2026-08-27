/**
 * Provider-backed TestCaseModel generation (Roadmap #22D).
 *
 * accepted RequirementModel v1 (upstream, from #22C)
 *   -> single-read snapshot into a fresh #22D-owned plain-data tree
 *   -> local re-validation of the upstream artifact (frozen v1)
 *   -> bounded provider prompt (test-case-model-prompt.js)
 *   -> provider response
 *   -> strict JSON parsing
 *   -> frozen cross-model validation (TestCaseModel v1 shape + requirement
 *      traceability against the accepted RequirementModel)
 *   -> accepted TestCaseModel v1.
 *
 * THE MODEL DOES NOT REGENERATE REQUIREMENTS. The RequirementModel handed to
 * this module is an ACCEPTED UPSTREAM ARTIFACT (Roadmap #22C's own output) -
 * this module never calls #22C's generator, never re-ingests raw #22B
 * evidence, and never repairs/normalizes/mutates the RequirementModel it is
 * given. It only reads the accepted requirement ids/text (plus assumptions/
 * openQuestions, kept explicitly distinct) to ground provider-authored test
 * case *content*. Every requirement id a provider's TestCaseModel cites is
 * checked against the accepted RequirementModel's own requirements by the
 * frozen scripts/ai/generation/cross-model-validation.js validator - never
 * by a locally reimplemented cross-reference check.
 *
 * This module also does not trust that a caller-supplied RequirementModel
 * behaves like ordinary plain data (Roadmap #22C-R/#22C-C1 lesson): every
 * caller-owned property this module reads - requirementModel.projectId,
 * .id, .requirements, .assumptions, .openQuestions, and every item/field
 * inside those arrays - is read EXACTLY ONCE, up front, into a fresh,
 * frozen, #22D-owned snapshot (see snapshotRequirementModel() below) before
 * any validation runs at all. Validation, the prompt projection, and the
 * post-provider cross-model check all consume that one snapshot exclusively;
 * the caller's RequirementModel object is never read again past that point,
 * and is never mutated or frozen.
 *
 * Pure orchestration otherwise: no filesystem, network, browser, git,
 * child_process, or repository mutation. The only external effect is a
 * bounded number of provider.analyze() calls through the existing,
 * unmodified scripts/ai/providers/ contract (provider is dependency-
 * injected - this module never knows a provider name, API URL, key, or
 * transport header). #22D is framework-neutral test design: it never reads
 * #23's AutomationRepositoryContext/AutomationCandidate/AutomationPlan or
 * any repository/Cypress/Playwright content.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject } = require("../generation/primitives");
const { LIMITS } = require("../generation/limits");
const { validateRequirementModel } = require("../generation/requirement-model");
const { validateGenerationChain } = require("../generation/cross-model-validation");
const { validateProvider, validateProviderResponse } = require("../providers/provider-contract");
const { normalizeProviderError, PROVIDER_ERROR_CODES } = require("../providers/provider-error");
const { buildTestCaseModelSystemPrompt, buildTestCaseModelUserPrompt } = require("./test-case-model-prompt");

// Roadmap #22D: initial attempt + at most one bounded correction retry -
// never unbounded, never recursive. A caller-supplied maxAttempts is only
// ever narrowed toward this ceiling (see resolveMaxAttempts below), never
// raised past it. Mirrors #22C's own retry policy exactly.
const MAX_PROVIDER_ATTEMPTS = 2;

// Roadmap #22D-C1: replaces an undersized fixed 200000 guess (#22D-R found a
// structurally-valid frozen v1 TestCaseModel - 200 test cases, 5 modest
// steps each - that already serialized past it). This is a formula derived
// from the actual frozen scripts/ai/generation/limits.js maxima, not a
// "realistic output" guess: every bounded string field TestCaseModel v1
// permits (isBoundedText/isValidId) may legitimately contain a quote,
// backslash, tab, newline, or carriage return - none of which either
// validator forbids - and JSON.stringify expands each of those to exactly
// 2 output characters, so a 2x escaping factor per character-limited field
// is EXACT, not merely conservative. A fixed per-string/per-object
// allowance covers JSON structural characters (quotes/colons/commas/
// braces/field-name keys). Empirically verified against an actual maxed-out
// (escape-heavy) valid TestCaseModel: real serialized size ~238,055,887
// chars, safely under this formula's ~307,903,352. This is a post-provider
// parse/retention guard, never a network-transport byte limit.
const JSON_ESCAPE_FACTOR = 2;
const STRUCTURAL_OVERHEAD_PER_STRING = 8; // quotes + comma + margin
const STRUCTURAL_OVERHEAD_PER_OBJECT = 96; // field-name keys + braces/commas, generous

function maxIdFieldSize() {
  return LIMITS.ID_MAX_LENGTH * JSON_ESCAPE_FACTOR + STRUCTURAL_OVERHEAD_PER_STRING;
}
function maxIdListFieldSize(count) {
  return count * maxIdFieldSize();
}
function maxTextFieldSize(maxLength) {
  return maxLength * JSON_ESCAPE_FACTOR + STRUCTURAL_OVERHEAD_PER_STRING;
}

const MAX_STEP_SIZE =
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // action
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // expectedResult
  maxIdListFieldSize(LIMITS.MAX_RELATED_IDS) + // requirementIds
  STRUCTURAL_OVERHEAD_PER_OBJECT;

const MAX_PRIORITY_SIZE =
  32 + // level (short, closed enum)
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // rationale
  maxIdListFieldSize(LIMITS.MAX_RELATED_IDS) + // requirementIds
  STRUCTURAL_OVERHEAD_PER_OBJECT;

const MAX_TEST_CASE_SIZE =
  maxIdFieldSize() + // id
  maxTextFieldSize(LIMITS.SHORT_TEXT_MAX_LENGTH) + // title
  maxTextFieldSize(LIMITS.LONG_TEXT_MAX_LENGTH) + // objective
  maxIdListFieldSize(LIMITS.MAX_RELATED_IDS) + // requirementIds
  LIMITS.MAX_TEST_STEPS * maxTextFieldSize(LIMITS.SHORT_TEXT_MAX_LENGTH) + // preconditions (bounded by MAX_TEST_STEPS per test-case-model.js)
  LIMITS.MAX_TEST_STEPS * MAX_STEP_SIZE + // steps
  MAX_PRIORITY_SIZE +
  STRUCTURAL_OVERHEAD_PER_OBJECT;

const MAX_TOP_LEVEL_OVERHEAD =
  maxIdFieldSize() * 2 + // id, requirementModelId
  maxIdFieldSize() + // projectId (validateProjectId -> isValidId, bounded by ID_MAX_LENGTH too)
  64 + // schemaVersion, kind
  STRUCTURAL_OVERHEAD_PER_OBJECT;

const MAX_TEST_CASE_MODEL_RESPONSE_CHARS = MAX_TOP_LEVEL_OVERHEAD + LIMITS.MAX_TEST_CASES * MAX_TEST_CASE_SIZE;

// Roadmap #22D: closes the #22C-C1 diagnostic-amplification lesson from the
// start rather than discovering it after the fact. Both caps apply together
// (count AND total serialized size), whichever is hit first stops
// inclusion, so neither the correction retry prompt nor a terminal failure
// result can balloon disproportionately to the response that produced it.
const MAX_CORRECTION_ERRORS = 20;
const MAX_CORRECTION_DIAGNOSTIC_CHARS = 8192;

// --- snapshot (Roadmap #22D; hardened in #22D-C1) ---------------------------
//
// #22D-C1 closes two defects #22D-R found in the original implementation:
//
// (1) copying an array via a caller-RESOLVED instance method
//     (`array.map(...)`/`array.slice(...)`) lets a caller whose array has
//     an OWN `map`/`slice` property substitute entirely forged content,
//     since method lookup walks the prototype chain and an own property
//     shadows the real Array.prototype method - confirmed to let forged
//     requirement text reach the actual provider prompt.
// (2) copying a caller's own "__proto__" key via plain bracket assignment
//     into a `{}` destination (`snapshot[key] = value[key]`) invokes the
//     legacy Object.prototype.__proto__ SETTER instead of creating an own
//     data property - a classic prototype-pollution-via-object-copy
//     pattern. The key silently vanishes from Object.keys() and the
//     snapshot's actual [[Prototype]] becomes attacker-controlled.
//
// Both helpers below only ever perform plain property reads (Object.keys()
// enumeration + bracket [[Get]], never a method resolved from the caller
// object) and write into a null-prototype destination via
// Object.defineProperty, so a literal "__proto__" key can never trigger the
// legacy setter regardless of destination prototype.

// Reads every OWN enumerable key of `value` exactly once each into a fresh,
// NULL-PROTOTYPE object. A key literally named "__proto__" (however the
// caller created it - direct assignment, Object.defineProperty, even
// JSON.parse) always becomes an ordinary own data property here - null
// prototype destinations have no inherited "__proto__" accessor to trigger,
// and Object.defineProperty never invokes one regardless. Unknown keys
// (including "__proto__"/"constructor"/"prototype") are preserved as
// ordinary own keys, so downstream unknown-field detection keeps working
// unchanged. Anything that isn't plain-object-shaped is returned completely
// untouched (no property access at all) so a non-object input can never
// throw here - that shape mismatch is validateRequirementModel()'s job to
// report. Deliberately NOT JSON.stringify/JSON.parse: that would invoke a
// caller-supplied toJSON, drop undefined/function/symbol-valued keys before
// fail-closed validation ever saw them, and coerce NaN/Infinity.
function snapshotOwnProperties(value) {
  if (!isPlainObject(value)) return value;
  const snapshot = Object.create(null);
  for (const key of Object.keys(value)) {
    const propertyValue = value[key];
    Object.defineProperty(snapshot, key, { value: propertyValue, enumerable: true, writable: true, configurable: true });
  }
  return snapshot;
}

// Copies a caller-supplied array's own content into a fresh native Array
// WITHOUT ever calling any method resolved from that array (no .map,
// .slice, spread, for...of, Array.from - all of which dispatch through the
// prototype chain or the iterator protocol and can be shadowed by an own
// property or an Array subclass override). `.length` is read once - safe,
// because a genuine Array exotic object's `length` is a special,
// non-configurable-as-accessor own data property the spec forbids
// redefining as a getter (Array.isArray() above already confirmed `value`
// is a genuine, possibly-subclassed, Array). Every element is read exactly
// once via plain indexed [[Get]] (`value[i]`), which never invokes
// Symbol.iterator or any overridden instance method.
//
// Any OTHER own enumerable key on the array - an attached "map"/"slice"/
// "toJSON"/arbitrary metadata property, or a missing index (a sparse-array
// hole) - makes the array incoherent/forged plain data and is rejected by
// throwing, caught by generateTestCaseModel()'s own snapshot try/catch and
// reported as the same bounded, static, privacy-safe diagnostic used for
// any other unreadable input, with zero provider calls. Sparse arrays are
// deliberately rejected outright (never silently filled with an invented
// value for the missing index).
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
// fresh, inert plain-data tree. Once this function returns, nothing in this
// module ever reads a property of `requirementModel` (or anything nested
// inside it) again; every later step (upstream validation, prompt
// projection, cross-model check) consumes only the returned snapshot.
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

// Deep-freezes a plain-data tree (the only shapes this module ever
// produces, for both the internal RequirementModel snapshot and the
// accepted TestCaseModel output) - never applied to a caller-owned object.
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

// --- bounded generation diagnostics (applying the #22C-C1 lesson) ----------
//
// Projects a (possibly very large) validator error array down to at most
// MAX_CORRECTION_ERRORS entries, never exceeding MAX_CORRECTION_DIAGNOSTIC_
// CHARS once serialized - whichever limit is reached first stops further
// inclusion. Preserves the validator's own deterministic error order
// (earliest first), never samples. Applied uniformly to every error array
// this module returns or forwards into a correction prompt.
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

// --- provider error privacy (mirrors #22C's local copy) ---------------------
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

/**
 * Generates a grounded TestCaseModel v1 from an accepted RequirementModel v1
 * via a dependency-injected provider.
 *
 * Returns `{ ok: true, testCaseModel, providerAttempts }` or
 * `{ ok: false, errors, providerAttempts }` - `errors` is always the
 * bounded `{path, code, message}` shape (at most MAX_CORRECTION_ERRORS
 * entries, never exceeding MAX_CORRECTION_DIAGNOSTIC_CHARS serialized),
 * never a raw provider response, rejected value, or stack trace.
 * `providerAttempts` is 0 whenever a local, deterministic pre-provider gate
 * failed (invalid provider object, invalid/unreadable RequirementModel) -
 * those never consume a provider call.
 */
async function generateTestCaseModel({ requirementModel, provider, maxAttempts, expectedProjectId } = {}) {
  try {
    validateProvider(provider);
  } catch (rawErr) {
    return { ok: false, errors: [summarizeProviderError(normalizeProviderError(rawErr))], providerAttempts: 0 };
  }

  // Roadmap #22D: the entire caller-controlled RequirementModel is read
  // exactly once, right here, into a fresh #22D-owned plain-data snapshot,
  // then frozen. requirementModel is never read again below this line -
  // every subsequent step (upstream validation, prompt projection,
  // cross-model check) consumes only `snapshot`. A getter/accessor that
  // throws during this single read is caught and reported as a bounded,
  // static, privacy-safe diagnostic - never the raw thrown message/stack,
  // never any requirement content - with zero provider calls.
  let snapshot;
  try {
    snapshot = deepFreeze(snapshotRequirementModel(requirementModel));
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "requirement model could not be read")], providerAttempts: 0 };
  }

  // Upstream artifact validation (Roadmap #22D): the accepted RequirementModel
  // is re-validated against the frozen v1 validator here - never trusted
  // merely because it is shaped like #22C's own output. `expectedProjectId`,
  // when supplied, is an additional orchestrator-level constraint checked
  // here via the same frozen mechanism #22B/#22C already use; malformed or
  // mismatched values fail closed with zero provider calls.
  const upstreamResult = validateRequirementModel(snapshot, { expectedProjectId });
  if (!upstreamResult.ok) {
    return { ok: false, errors: boundGenerationErrors(upstreamResult.errors), providerAttempts: 0 };
  }

  // Positive projection (Roadmap #22D data minimization): only the fields
  // TestCaseModel generation actually needs - projectId, the RequirementModel's
  // own id (to be copied into requirementModelId), and each requirement's
  // id/text. Assumptions/openQuestions are projected separately and kept
  // explicitly distinct (never merged into the requirements list) - see
  // test-case-model-prompt.js. Never includes evidenceRefs, repository
  // context, or any #23 content, none of which TestCaseModel v1 has any
  // field for.
  const projectId = snapshot.projectId;
  const requirementModelId = snapshot.id;
  const requirements = snapshot.requirements.map((r) => ({ id: r.id, text: r.text }));
  const assumptions = (snapshot.assumptions || []).map((a) => ({ id: a.id, text: a.text, rationale: a.rationale }));
  const openQuestions = (snapshot.openQuestions || []).map((q) => ({ id: q.id, type: q.type, description: q.description, reason: q.reason }));

  const systemPrompt = buildTestCaseModelSystemPrompt();
  const attempts = resolveMaxAttempts(maxAttempts);

  let providerAttempts = 0;
  let lastErrors = [];
  let correctionErrors = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    providerAttempts = attempt;
    const userPrompt = buildTestCaseModelUserPrompt({ projectId, requirementModelId, requirements, assumptions, openQuestions }, { correctionErrors });

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

    if (response.length > MAX_TEST_CASE_MODEL_RESPONSE_CHARS) {
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

    // CRITICAL POST-PROVIDER GATE (Roadmap #22D): the frozen cross-model
    // validator both (a) individually validates the parsed TestCaseModel
    // against its own v1 schema (schemaVersion/kind/id/projectId/
    // requirementModelId/testCases shape, unknown-field rejection, step/
    // priority-internal grounding) and (b) checks it against the accepted
    // RequirementModel snapshot: project + schemaVersion consistency across
    // both artifacts, testCaseModel.requirementModelId === snapshot.id, and
    // every testCases[].requirementIds entry actually exists in
    // snapshot.requirements - fail closed, never a best-effort resolution.
    // Reused exactly as scripts/ai/generation/cross-model-validation.js
    // already implements it - never a second, locally reimplemented
    // cross-reference check.
    const chainResult = validateGenerationChain({ requirementModel: snapshot, testCaseModel: parsed }, { expectedProjectId: projectId });
    if (!chainResult.ok) {
      lastErrors = boundGenerationErrors(chainResult.errors);
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    return { ok: true, testCaseModel: deepFreeze(parsed), providerAttempts };
  }

  return { ok: false, errors: lastErrors, providerAttempts };
}

module.exports = {
  generateTestCaseModel,
  snapshotRequirementModel,
  boundGenerationErrors,
  MAX_PROVIDER_ATTEMPTS,
  MAX_TEST_CASE_MODEL_RESPONSE_CHARS,
  MAX_CORRECTION_ERRORS,
  MAX_CORRECTION_DIAGNOSTIC_CHARS,
};
