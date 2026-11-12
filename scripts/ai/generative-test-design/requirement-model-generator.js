/**
 * Provider-backed RequirementModel generation (Roadmap #22C; TPR G2 finding
 * R1, docs/architecture-model-boundary-v3.md).
 *
 * accepted #22B evidence bundle + canonical requirement projection
 *   -> single-read snapshot of both into fresh #22C-owned plain-data trees
 *   -> independently re-validated bundle/canonical-evidence trust boundary
 *   -> canonical requirements proven to be exactly the projection of that
 *      bundle (evidence-ingestion.js verifyCanonicalRequirements)
 *   -> bounded provider prompt (test-design-prompt.js)
 *   -> provider response: ONLY {assumptions, openQuestions}
 *   -> strict JSON parsing + closed-shape gap-analysis validation
 *   -> deterministic assembly: schemaVersion/kind/REQUIREMENT_MODEL_ID/
 *      projectId/canonical evidenceRefs/canonical requirements + the
 *      provider's assumptions/openQuestions
 *   -> frozen RequirementModel v1 validation + canonical provenance
 *   -> accepted RequirementModel v1.
 *
 * THE MODEL DOES NOT OWN REQUIREMENT WORDING (boundary v3). Requirement ids
 * and text come only from the deterministic projection; a provider response
 * carrying `requirements`, `evidenceRefs` or any other RequirementModel field
 * is rejected (UNKNOWN_FIELD), never merged, and there is no fallback to
 * provider-authored requirements: a missing or misaligned projection fails
 * closed before any provider call.
 *
 * THE MODEL DOES NOT OWN PROVENANCE. Roadmap #22B's deterministic ingestion
 * (evidence-ingestion.js) is the only owner of canonical EvidenceRefs. Since
 * boundary v3 the provider returns no EvidenceRef at all: the model's
 * `evidenceRefs` is assembled by this module as the full canonical registry
 * in bundle order, and a provider response carrying `evidenceRefs` is
 * refused (UNKNOWN_FIELD). The assembled registry is still verified by EXACT
 * field equality against a per-invocation canonical registry built from the
 * input bundle, never merely by id membership - see
 * checkCanonicalProvenance() below - as defense in depth. A provider can
 * therefore never invent, alter, select or add to canonical evidence.
 *
 * This module also does NOT trust that an object shaped like #22B's output
 * actually came from evidence-ingestion.js in-process (Roadmap #22B review
 * finding: PRODUCTION_EVIDENCE_VALIDATION was CONSTRUCTION_GUARANTEE_ONLY
 * there). Nor does it trust that a caller-supplied bundle behaves like
 * ordinary plain data at all (Roadmap #22C-R review finding:
 * BUNDLE_SNAPSHOT_BOUNDARY was PARTIAL - a getter-backed projectId,
 * evidenceItems array, or item text could diverge between what was
 * validated and what was actually canonicalized/prompted). Every
 * caller-owned property this module reads - evidenceBundle.projectId,
 * evidenceBundle.evidenceItems, each item's evidenceRef/text, each ref's
 * id/kind/sourceId - is read EXACTLY ONCE, up front, into a fresh, frozen,
 * #22C-owned snapshot (see snapshotEvidenceBundle() below) before any
 * validation runs at all. Validation, canonical-registry construction,
 * prompt construction, and model-project binding all consume that one
 * snapshot exclusively; evidenceBundle itself is never read again past that
 * point. What is validated is therefore always exactly what is prompted and
 * exactly what the accepted model is bound to.
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
const { LIMITS: GENERATION_LIMITS } = require("../generation/limits");
const {
  SCHEMA_VERSION,
  isPlainObject,
  isBoundedText,
  collectUnknownKeyErrors,
  collectDuplicateIdErrors,
  validateProjectId,
  validateEvidenceRef,
  validateAssumption,
  validateOpenQuestion,
} = require("../generation/primitives");
const { KIND, validateRequirementModel } = require("../generation/requirement-model");
const { validateProvider, validateProviderResponse } = require("../providers/provider-contract");
const { normalizeProviderError, PROVIDER_ERROR_CODES } = require("../providers/provider-error");
const { LIMITS: EVIDENCE_LIMITS, EVIDENCE_KIND_USER_INPUT, verifyCanonicalRequirements } = require("./evidence-ingestion");
const { buildRequirementModelSystemPrompt, buildRequirementModelUserPrompt } = require("./test-design-prompt");

// TPR G2 finding R1 (boundary v3): the RequirementModel id is fixed, never
// provider-chosen. One design run produces exactly one RequirementModel.
const REQUIREMENT_MODEL_ID = "requirement-model-0001";

// The provider's only output (boundary v3): a closed two-key object.
const GAP_ANALYSIS_ALLOWED_KEYS = Object.freeze(["assumptions", "openQuestions"]);

// Roadmap #22C: initial attempt + at most one bounded correction retry -
// never unbounded, never recursive. A caller-supplied maxAttempts is only
// ever narrowed toward this ceiling (see resolveMaxAttempts below), never
// raised past it.
const MAX_PROVIDER_ATTEMPTS = 2;

// A well-formed generation call is grounded in at most
// EVIDENCE_LIMITS.MAX_AGGREGATE_TEXT_LENGTH (20000) chars of #22B-owned
// source text; since boundary v3 the response carries only provider-authored
// assumption/openQuestion entries (no requirement text, no EvidenceRef
// echoes), which has no legitimate need for anywhere near
// scripts/ai/generation/limits.js's theoretical v1 ceiling. The bound is
// deliberately unchanged from before v3 (never raised).
// Chosen as a generous, bounded multiple of that input aggregate so a
// genuine response is never rejected, while a runaway/hostile response is
// rejected before it is ever handed to JSON.parse.
const MAX_REQUIREMENT_MODEL_RESPONSE_CHARS = 5 * EVIDENCE_LIMITS.MAX_AGGREGATE_TEXT_LENGTH;

// Roadmap #22C-C1: closes the #22C-R review's CORRECTION_DIAGNOSTICS =
// AMPLIFICATION_RISK finding. A single ~100000-char hostile/buggy provider
// response can trigger one frozen-validator error per malformed/unknown
// field - potentially thousands of entries from one bounded response. Both
// caps apply together (count AND total serialized size), whichever is hit
// first stops inclusion, so neither the correction retry prompt nor a
// terminal failure result can balloon disproportionately to the response
// that produced it. 20/8192 are small enough that a real, small, legitimate
// error set is never truncated, while a pathological one is capped to a
// low single-digit KB regardless of how malformed the response was.
const MAX_CORRECTION_ERRORS = 20;
const MAX_CORRECTION_DIAGNOSTIC_CHARS = 8192;

// --- snapshot (Roadmap #22C-C1) ---------------------------------------------
//
// Reads every OWN enumerable key of `value` exactly once each into a fresh
// plain object. Object.keys() itself never invokes a getter (enumeration is
// a distinct operation from property access), so the loop below performs
// the one and only [[Get]] for each key - a value read here is never read
// again by this module. Unknown keys are preserved as-is (never filtered
// to an allowlist), so downstream unknown-field detection keeps working
// unchanged; only WHERE it reads from changes. Anything that isn't plain-
// object-shaped is returned completely untouched (no property access at
// all) so a non-object bundle/item can never throw here - that shape
// mismatch is validateEvidenceBundle()'s job to report, not this
// function's job to reject.
//
// TPR-R1-PR270-C3 (A-01): each key is DEFINED on the snapshot, never
// assigned. Assigning a literal own "__proto__" key would run the inherited
// Object.prototype.__proto__ setter instead of creating the key - dropping
// it before unknown-field detection and, for an object value, replacing the
// snapshot's prototype.
function defineOwnValue(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function snapshotOwnProperties(value) {
  if (!isPlainObject(value)) return value;
  const snapshot = {};
  for (const key of Object.keys(value)) {
    defineOwnValue(snapshot, key, value[key]);
  }
  return snapshot;
}

// TPR-R1-PR270-C3 (A-01): copies a caller-supplied array into a fresh,
// ordinary array of the same length, index by index, keeping exactly the
// OWN indices. A hole stays a hole and an index that is only reachable
// through the prototype chain stays a hole, so downstream own-element checks
// see the caller's real structure. No method is looked up on `source` (its
// own or inherited map/forEach/... are never called); each own element is
// read exactly once.
function snapshotOwnElements(source, snapshotElement) {
  const length = source.length;
  const snapshot = [];
  snapshot.length = length;
  for (let i = 0; i < length; i += 1) {
    if (Object.prototype.hasOwnProperty.call(source, i)) {
      defineOwnValue(snapshot, i, snapshotElement(source[i]));
    }
  }
  return snapshot;
}

// Reads the ENTIRE caller-supplied evidence bundle exactly once - top
// level, every evidence item, every EvidenceRef - into a fresh, inert
// plain-data tree. Once this function returns, nothing in this module ever
// reads a property of `evidenceBundle` (or anything nested inside it)
// again; every later step (validateEvidenceBundle, canonical registry
// construction, prompt construction, model-project binding) consumes only
// the returned snapshot. isPlainObject()/Array.isArray() here only ever
// gate whether to recurse further - a malformed shape is captured as-is
// and left for validateEvidenceBundle() to report structurally.
function snapshotEvidenceBundle(evidenceBundle) {
  const bundleSnapshot = snapshotOwnProperties(evidenceBundle);
  if (!isPlainObject(bundleSnapshot) || !Array.isArray(bundleSnapshot.evidenceItems)) {
    return bundleSnapshot;
  }
  bundleSnapshot.evidenceItems = bundleSnapshot.evidenceItems.map((rawItem) => {
    const itemSnapshot = snapshotOwnProperties(rawItem);
    if (isPlainObject(itemSnapshot) && isPlainObject(itemSnapshot.evidenceRef)) {
      itemSnapshot.evidenceRef = snapshotOwnProperties(itemSnapshot.evidenceRef);
    }
    return itemSnapshot;
  });
  return bundleSnapshot;
}

// TPR G2 finding R1: the caller-supplied canonical requirement list gets the
// same single-read discipline as the bundle - every own enumerable key of
// every entry, and every evidenceRefIds element, is read exactly once into a
// fresh plain-data tree before verification; nothing reads the caller's list
// again. Non-array/non-object shapes are captured untouched for
// verifyCanonicalRequirements() to refuse. TPR-R1-PR270-C3 (A-01): the copy
// is structural (snapshotOwnElements()/snapshotOwnProperties()) - holes,
// inherited indices and own unknown keys are neither filled in nor dropped.
function snapshotCanonicalRequirements(canonicalRequirements) {
  if (!Array.isArray(canonicalRequirements)) return canonicalRequirements;
  return snapshotOwnElements(canonicalRequirements, (rawRequirement) => {
    const requirementSnapshot = snapshotOwnProperties(rawRequirement);
    if (requirementSnapshot !== rawRequirement && Array.isArray(requirementSnapshot.evidenceRefIds)) {
      requirementSnapshot.evidenceRefIds = snapshotOwnElements(requirementSnapshot.evidenceRefIds, (id) => id);
    }
    return requirementSnapshot;
  });
}

// Deep-freezes a plain-data tree (the only shapes this module ever
// produces, for both the internal bundle snapshot and the accepted
// RequirementModel output) - never applied to a caller-owned object.
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

// --- bounded generation diagnostics (Roadmap #22C-C1) -----------------------
//
// Projects a (possibly very large) validator error array down to at most
// MAX_CORRECTION_ERRORS entries, never exceeding MAX_CORRECTION_DIAGNOSTIC_
// CHARS once serialized - whichever limit is reached first stops further
// inclusion. Preserves the validator's own deterministic error order
// (earliest first), never samples. Applied uniformly to every error array
// this module returns or forwards into a correction prompt, so neither
// path can be used to amplify a bounded provider response into a
// disproportionately large diagnostic payload.
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

// --- bundle trust boundary (Roadmap #22C Phase 6) --------------------------
//
// #22B's own output shape is not schemaVersion:1/frozen (see
// evidence-ingestion.js's module comment) and this module must not assume a
// caller-supplied bundle genuinely came from that code in-process. This is
// a narrow, #22C-local structural check of exactly the shape
// evidence-ingestion.js's ingestRequirementEvidence() actually produces -
// deliberately not a new shared/F0 contract, and deliberately stricter than
// the frozen EvidenceRef shape alone: a "location" field is structurally
// impossible from real #22B output today (ingestion never sets one), so its
// presence here means the bundle did not really come from #22B and is
// treated as incoherent/forged, not merely as "an EvidenceRef with an extra
// optional field".
//
// Operates exclusively on a snapshot already produced by
// snapshotEvidenceBundle() - never on a live caller object - so every read
// below is a plain-data read with no possibility of divergence between two
// calls to the same accessor.

const BUNDLE_TOP_LEVEL_ALLOWED_KEYS = Object.freeze(["projectId", "evidenceItems"]);
const EVIDENCE_ITEM_ALLOWED_KEYS = Object.freeze(["evidenceRef", "text"]);
const BUNDLE_EVIDENCE_REF_ALLOWED_KEYS = Object.freeze(["id", "kind", "sourceId"]);

function validateEvidenceBundle(bundle, { expectedProjectId } = {}) {
  const errors = [];

  if (!isPlainObject(bundle)) {
    return [err("$", ERROR_CODES.INVALID_TYPE, "evidence bundle must be a plain object")];
  }

  collectUnknownKeyErrors(bundle, BUNDLE_TOP_LEVEL_ALLOWED_KEYS, "$", errors);
  validateProjectId(bundle.projectId, "$.projectId", errors, { expectedProjectId });

  const items = bundle.evidenceItems;
  const seenIds = new Set();
  const seenSourceIds = new Set();
  let aggregateLength = 0;
  let allItemsWellFormed = true;

  if (!Array.isArray(items) || items.length === 0) {
    errors.push(err("$.evidenceItems", ERROR_CODES.MISSING_FIELD, "$.evidenceItems must be a non-empty array"));
  } else if (items.length > EVIDENCE_LIMITS.MAX_SOURCES) {
    errors.push(err("$.evidenceItems", ERROR_CODES.INVALID_VALUE, `$.evidenceItems exceeds the maximum of ${EVIDENCE_LIMITS.MAX_SOURCES}`));
  } else {
    items.forEach((item, i) => {
      const path = `$.evidenceItems[${i}]`;

      if (!isPlainObject(item)) {
        errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
        allItemsWellFormed = false;
        return;
      }
      collectUnknownKeyErrors(item, EVIDENCE_ITEM_ALLOWED_KEYS, path, errors);

      const refPath = `${path}.evidenceRef`;
      const ref = item.evidenceRef;
      if (!isPlainObject(ref)) {
        errors.push(err(refPath, ERROR_CODES.INVALID_TYPE, `${refPath} must be an object`));
        allItemsWellFormed = false;
      } else {
        collectUnknownKeyErrors(ref, BUNDLE_EVIDENCE_REF_ALLOWED_KEYS, refPath, errors);

        if (ref.kind !== EVIDENCE_KIND_USER_INPUT) {
          errors.push(err(`${refPath}.kind`, ERROR_CODES.INVALID_ENUM, `${refPath}.kind must be "${EVIDENCE_KIND_USER_INPUT}"`));
          allItemsWellFormed = false;
        }

        if (typeof ref.id !== "string" || ref.id.length === 0) {
          errors.push(err(`${refPath}.id`, ERROR_CODES.INVALID_TYPE, `${refPath}.id must be a non-empty string`));
          allItemsWellFormed = false;
        } else {
          if (seenIds.has(ref.id)) {
            errors.push(err(path, ERROR_CODES.DUPLICATE_ID, `${path}: duplicate evidenceRef.id`));
          }
          seenIds.add(ref.id);
        }

        if (typeof ref.sourceId !== "string" || ref.sourceId.length === 0) {
          errors.push(err(`${refPath}.sourceId`, ERROR_CODES.INVALID_TYPE, `${refPath}.sourceId must be a non-empty string`));
          allItemsWellFormed = false;
        } else {
          if (seenSourceIds.has(ref.sourceId)) {
            errors.push(err(path, ERROR_CODES.DUPLICATE_ID, `${path}: duplicate evidenceRef.sourceId`));
          }
          seenSourceIds.add(ref.sourceId);
        }
      }

      if (!isBoundedText(item.text, EVIDENCE_LIMITS.MAX_SOURCE_TEXT_LENGTH)) {
        errors.push(err(`${path}.text`, ERROR_CODES.INVALID_TYPE, `${path}.text must be a bounded, non-empty string`));
        allItemsWellFormed = false;
      } else {
        aggregateLength += item.text.length;
      }
    });

    // Same "only meaningful once every item is itself well-formed"
    // convention evidence-ingestion.js uses for its own aggregate check -
    // a still-malformed item has already been reported above.
    if (allItemsWellFormed && aggregateLength > EVIDENCE_LIMITS.MAX_AGGREGATE_TEXT_LENGTH) {
      errors.push(
        err("$.evidenceItems", ERROR_CODES.INVALID_VALUE, `$.evidenceItems aggregate text exceeds the maximum of ${EVIDENCE_LIMITS.MAX_AGGREGATE_TEXT_LENGTH}`)
      );
    }
  }

  return errors;
}

// --- canonical registry (Roadmap #22C Phases 7-9) --------------------------

// Projects an already-snapshotted, already-validated evidenceItems array
// (plain data, single-read-captured - see snapshotEvidenceBundle above)
// into the canonical evidence shape this module hands to the prompt and
// the provenance registry. No further caller-object reads happen here.
function toCanonicalEvidence(evidenceItems) {
  return evidenceItems.map((item) => ({
    evidenceRef: Object.freeze({ id: item.evidenceRef.id, kind: item.evidenceRef.kind, sourceId: item.evidenceRef.sourceId }),
    text: item.text,
  }));
}

function isExactCanonicalMatch(providerRef, canonicalRef) {
  if (!providerRef || typeof providerRef !== "object") return false;
  const providerKeys = Object.keys(providerRef).sort();
  const canonicalKeys = Object.keys(canonicalRef).sort();
  if (providerKeys.length !== canonicalKeys.length) return false;
  for (let i = 0; i < providerKeys.length; i += 1) {
    if (providerKeys[i] !== canonicalKeys[i]) return false;
  }
  return canonicalKeys.every((key) => providerRef[key] === canonicalRef[key]);
}

// CRITICAL provenance gate (Roadmap #22C Phase 18-20): every EvidenceRef a
// RequirementModel.evidenceRefs carries must both (a) exist in the
// per-bundle canonical registry by id, and (b) match that canonical entry by
// EXACT field equality - id, kind, sourceId presence/value alike. A known id
// with an altered kind/sourceId, an added field (e.g. "location"), or a
// missing sourceId all fail (b); an id the registry never issued fails (a).
//
// This function is a membership + exact-match check only: on its own it
// accepts a strict subset of the registry (Roadmap #22C Phase 21) and does
// not require full coverage. Since boundary v3 the subset case no longer
// arises from generation - this module assembles the full registry itself
// and the provider supplies no EvidenceRef - and full-registry equality of
// fresh and persisted designs is enforced separately by the CLI
// (scripts/ai/cli/run-artifacts.js validateDesign), which also calls this
// function on models read from disk.
function checkCanonicalProvenance(modelEvidenceRefs, registry) {
  const errors = [];
  modelEvidenceRefs.forEach((ref, i) => {
    const path = `$.evidenceRefs[${i}]`;
    const canonical = ref && typeof ref === "object" && typeof ref.id === "string" ? registry.get(ref.id) : undefined;
    if (!canonical) {
      errors.push(err(path, ERROR_CODES.INVALID_REFERENCE, `${path}: evidence reference id is not a supplied canonical evidence reference`));
      return;
    }
    if (!isExactCanonicalMatch(ref, canonical)) {
      errors.push(err(path, ERROR_CODES.INVARIANT_VIOLATION, `${path}: evidence reference does not exactly match its canonical provenance`));
    }
  });
  return errors;
}

// --- provider output: gap analysis only (TPR G2 finding R1, boundary v3) ----
//
// The provider's response must be exactly {assumptions, openQuestions}; each
// entry is checked with the frozen v1 primitives (read-only reuse) and the
// same per-array bounds/duplicate-id rules RequirementModel v1 applies. Any
// other key - `requirements`, `evidenceRefs`, `schemaVersion`, `id`, ... - is
// UNKNOWN_FIELD: the provider cannot override, extend or restate canonical
// requirements.
function validateGapAnalysis(value) {
  if (!isPlainObject(value)) {
    return [err("$", ERROR_CODES.INVALID_TYPE, "provider response must be a JSON object with exactly assumptions and openQuestions")];
  }
  const errors = [];
  collectUnknownKeyErrors(value, GAP_ANALYSIS_ALLOWED_KEYS, "$", errors);

  if (!Array.isArray(value.assumptions)) {
    errors.push(err("$.assumptions", ERROR_CODES.MISSING_FIELD, "$.assumptions must be an array (use an empty array when there are none)"));
  } else if (value.assumptions.length > GENERATION_LIMITS.MAX_ASSUMPTIONS) {
    errors.push(err("$.assumptions", ERROR_CODES.INVALID_VALUE, `$.assumptions exceeds the maximum of ${GENERATION_LIMITS.MAX_ASSUMPTIONS}`));
  } else {
    value.assumptions.forEach((a, i) => validateAssumption(a, `$.assumptions[${i}]`, errors));
    collectDuplicateIdErrors(value.assumptions, "id", "$.assumptions", errors);
  }

  if (!Array.isArray(value.openQuestions)) {
    errors.push(err("$.openQuestions", ERROR_CODES.MISSING_FIELD, "$.openQuestions must be an array (use an empty array when there are none)"));
  } else if (value.openQuestions.length > GENERATION_LIMITS.MAX_OPEN_QUESTIONS) {
    errors.push(err("$.openQuestions", ERROR_CODES.INVALID_VALUE, `$.openQuestions exceeds the maximum of ${GENERATION_LIMITS.MAX_OPEN_QUESTIONS}`));
  } else {
    value.openQuestions.forEach((q, i) => validateOpenQuestion(q, `$.openQuestions[${i}]`, errors));
    collectDuplicateIdErrors(value.openQuestions, "id", "$.openQuestions", errors);
  }
  return errors;
}

// Deterministic RequirementModel assembly (boundary v3): everything except
// assumptions/openQuestions is fixed by the canonical inputs. evidenceRefs is
// the full canonical registry in bundle order - every evidence item yields at
// least one canonical requirement, so every reference is cited. Fresh copies
// only; nothing the caller or provider owns is aliased into the result.
function assembleRequirementModel({ projectId, canonicalEvidence, canonicalRequirements, gapAnalysis }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    id: REQUIREMENT_MODEL_ID,
    projectId,
    evidenceRefs: canonicalEvidence.map((item) => ({ id: item.evidenceRef.id, kind: item.evidenceRef.kind, sourceId: item.evidenceRef.sourceId })),
    requirements: canonicalRequirements.map((r) => ({ id: r.id, text: r.text, evidenceRefIds: [...r.evidenceRefIds] })),
    assumptions: gapAnalysis.assumptions.map((a) => ({ id: a.id, text: a.text, rationale: a.rationale })),
    openQuestions: gapAnalysis.openQuestions.map((q) => ({ id: q.id, type: q.type, description: q.description, reason: q.reason })),
  };
}

// --- provider error privacy (Roadmap #22C Phase 29) -------------------------
//
// A small local copy of analyze-failure.js's summarizeProviderError()
// pattern (fixed, allowlisted messages keyed on PROVIDER_ERROR_CODES,
// deliberately never err.message/err.cause) rather than an import from
// that module - this repository's own documented convention (see
// project-profile.js) is small duplicated primitives across independent
// domains, not a shared refactor, and #22C has no reason to depend on the
// FailureAnalysis domain module.
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
 * Generates a grounded RequirementModel v1 from an accepted #22B evidence
 * bundle and its canonical requirement projection (boundary v3) via a
 * dependency-injected provider that contributes only assumptions and open
 * questions.
 *
 * `canonicalRequirements` is REQUIRED: the exact `canonicalRequirements`
 * list ingestRequirementArtifactsAsEvidence() returned with that bundle. It
 * is re-proven against the bundle's own evidence text before any provider
 * call; a missing, reordered, reworded, re-identified or otherwise
 * misaligned list fails closed (providerAttempts 0) - there is no fallback
 * to provider-authored requirements.
 *
 * Returns `{ ok: true, requirementModel, providerAttempts }` or
 * `{ ok: false, errors, providerAttempts }` - `errors` is always the
 * bounded `{path, code, message}` shape (at most MAX_CORRECTION_ERRORS
 * entries, never exceeding MAX_CORRECTION_DIAGNOSTIC_CHARS serialized),
 * never a raw provider response, rejected value, or stack trace.
 * `providerAttempts` is 0 whenever a local, deterministic pre-provider gate
 * failed (invalid provider object, invalid evidence bundle, invalid
 * canonical EvidenceRef, missing/misaligned canonical requirements) - those
 * never consume a provider call.
 */
async function generateRequirementModel({ evidenceBundle, canonicalRequirements, provider, maxAttempts, expectedProjectId } = {}) {
  try {
    validateProvider(provider);
  } catch (rawErr) {
    return { ok: false, errors: [summarizeProviderError(normalizeProviderError(rawErr))], providerAttempts: 0 };
  }

  // Roadmap #22C-C1: the entire caller-controlled bundle is read exactly
  // once, right here, into a fresh #22C-owned plain-data snapshot, then
  // frozen. evidenceBundle is never read again below this line - every
  // subsequent step (validation, canonical registry, prompt construction,
  // model-project binding) consumes only `snapshot`. See
  // snapshotEvidenceBundle()'s own comment for why this closes the #22C-R
  // review's BUNDLE_SNAPSHOT_BOUNDARY finding for projectId, evidenceItems,
  // and per-item text alike (EvidenceRef id/kind/sourceId were already
  // single-read-safe before this change; that discipline is preserved).
  const snapshot = deepFreeze(snapshotEvidenceBundle(evidenceBundle));

  const bundleErrors = validateEvidenceBundle(snapshot, { expectedProjectId });
  if (bundleErrors.length > 0) {
    return { ok: false, errors: boundGenerationErrors(bundleErrors), providerAttempts: 0 };
  }

  const canonicalEvidence = toCanonicalEvidence(snapshot.evidenceItems);

  // MANDATORY before any provider call (Roadmap #22C Phase 7): every
  // canonical EvidenceRef is independently re-validated against the frozen
  // v1 validateEvidenceRef(), never trusted merely because
  // validateEvidenceBundle() above already checked this module's own
  // narrower local shape. Validated on the same snapshot everything else
  // below consumes.
  const canonicalErrors = [];
  canonicalEvidence.forEach((item, i) => {
    validateEvidenceRef(item.evidenceRef, `$.evidenceItems[${i}].evidenceRef`, canonicalErrors);
  });
  if (canonicalErrors.length > 0) {
    return { ok: false, errors: boundGenerationErrors(canonicalErrors), providerAttempts: 0 };
  }

  // validateEvidenceBundle() above already rejected the whole bundle on any
  // duplicate evidenceRef.id/sourceId within snapshot.evidenceItems - by
  // construction, every id inserted below is already proven unique, so this
  // Map can never silently collapse a genuine duplicate via "last write
  // wins" semantics; there is no remaining duplicate for it to absorb.
  const registry = new Map(canonicalEvidence.map((item) => [item.evidenceRef.id, item.evidenceRef]));

  const projectId = snapshot.projectId;

  // TPR G2 finding R1 (boundary v3), MANDATORY before any provider call: the
  // canonical requirement list is read once, then proven to be exactly the
  // projection of the very evidence snapshot the prompt and the model are
  // built from, and the deterministic part of the model is validated against
  // the frozen v1 RequirementModel validator and canonical provenance with
  // no provider content in it at all.
  //
  // TPR-R1-PR270-C3 (A-01): the snapshot is frozen only AFTER it is proven
  // exact. A refused snapshot can still hold caller-owned values (a non-array
  // list, a non-plain entry, a nested object under an unknown key), and
  // freezing those would mutate the caller's input; an exact one is, by the
  // proof itself, nothing but this module's own fresh arrays/objects and
  // strings.
  const requirementsSnapshot = snapshotCanonicalRequirements(canonicalRequirements);
  const projectionErrors = verifyCanonicalRequirements(requirementsSnapshot, snapshot.evidenceItems);
  if (projectionErrors.length > 0) {
    return { ok: false, errors: boundGenerationErrors(projectionErrors), providerAttempts: 0 };
  }
  deepFreeze(requirementsSnapshot);
  const deterministicModel = assembleRequirementModel({ projectId, canonicalEvidence, canonicalRequirements: requirementsSnapshot, gapAnalysis: { assumptions: [], openQuestions: [] } });
  const deterministicErrors = [
    ...(validateRequirementModel(deterministicModel, { expectedProjectId: projectId }).errors || []),
    ...checkCanonicalProvenance(deterministicModel.evidenceRefs, registry),
  ];
  if (deterministicErrors.length > 0) {
    return { ok: false, errors: boundGenerationErrors(deterministicErrors), providerAttempts: 0 };
  }

  const systemPrompt = buildRequirementModelSystemPrompt();
  const attempts = resolveMaxAttempts(maxAttempts);

  let providerAttempts = 0;
  let lastErrors = [];
  let correctionErrors = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    providerAttempts = attempt;
    const userPrompt = buildRequirementModelUserPrompt({ projectId, canonicalEvidence, canonicalRequirements: requirementsSnapshot }, { correctionErrors });

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

    if (response.length > MAX_REQUIREMENT_MODEL_RESPONSE_CHARS) {
      lastErrors = [err("$", ERROR_CODES.INVALID_VALUE, "provider response exceeds the maximum allowed length")];
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    // Strict parsing (Roadmap #22C Phase 15): trim whitespace only, then
    // JSON.parse. No markdown-fence stripping, no "find first { ... }", no
    // regex extraction, no repair - a fenced or otherwise non-strict
    // response fails exactly like any other invalid JSON.
    let parsed;
    try {
      parsed = JSON.parse(response.trim());
    } catch {
      lastErrors = [err("$", ERROR_CODES.INVALID_TYPE, "provider response was not valid JSON")];
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    const gapErrors = validateGapAnalysis(parsed);
    if (gapErrors.length > 0) {
      // Roadmap #22C-C1: bounded here, not forwarded wholesale - see
      // boundGenerationErrors()'s own comment. Applies to both the
      // correction prompt (below) and a terminal failure result.
      lastErrors = boundGenerationErrors(gapErrors);
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    // Defense in depth: the assembled model is re-validated in full against
    // the frozen v1 validator and canonical provenance. Its deterministic
    // part already passed above and its provider part passed the same
    // primitives, so a failure here is a defect, never something a retry
    // could correct - it ends the call without another attempt.
    const requirementModel = assembleRequirementModel({ projectId, canonicalEvidence, canonicalRequirements: requirementsSnapshot, gapAnalysis: parsed });
    const assembledErrors = [
      ...(validateRequirementModel(requirementModel, { expectedProjectId: projectId }).errors || []),
      ...checkCanonicalProvenance(requirementModel.evidenceRefs, registry),
    ];
    if (assembledErrors.length > 0) {
      return { ok: false, errors: boundGenerationErrors(assembledErrors), providerAttempts };
    }

    return { ok: true, requirementModel: deepFreeze(requirementModel), providerAttempts };
  }

  return { ok: false, errors: lastErrors, providerAttempts };
}

module.exports = {
  generateRequirementModel,
  validateEvidenceBundle,
  validateGapAnalysis,
  checkCanonicalProvenance,
  snapshotEvidenceBundle,
  snapshotCanonicalRequirements,
  boundGenerationErrors,
  REQUIREMENT_MODEL_ID,
  MAX_PROVIDER_ATTEMPTS,
  MAX_REQUIREMENT_MODEL_RESPONSE_CHARS,
  MAX_CORRECTION_ERRORS,
  MAX_CORRECTION_DIAGNOSTIC_CHARS,
};
