/**
 * Provider-backed RequirementModel generation (Roadmap #22C).
 *
 * accepted #22B evidence bundle
 *   -> independently re-validated bundle/canonical-evidence trust boundary
 *   -> bounded provider prompt (test-design-prompt.js)
 *   -> provider response
 *   -> strict JSON parsing
 *   -> frozen RequirementModel v1 validation
 *   -> canonical provenance verification
 *   -> accepted RequirementModel v1.
 *
 * THE MODEL DOES NOT OWN PROVENANCE. Roadmap #22B's deterministic ingestion
 * (evidence-ingestion.js) is the only owner of canonical EvidenceRefs. This
 * module treats a provider response as a low-trust generation of
 * requirement *content* only: every EvidenceRef the provider echoes back is
 * verified by EXACT field equality against a per-invocation canonical
 * registry built from the input bundle, never merely by id membership -
 * see checkCanonicalProvenance() below. A provider can therefore reference
 * canonical evidence, but can never invent it, alter it, or add to it.
 *
 * This module also does NOT trust that an object shaped like #22B's output
 * actually came from evidence-ingestion.js in-process (Roadmap #22B review
 * finding: PRODUCTION_EVIDENCE_VALIDATION was CONSTRUCTION_GUARANTEE_ONLY
 * there). validateEvidenceBundle() below independently re-validates bundle
 * shape/bounds, and every canonical EvidenceRef is re-checked against the
 * frozen scripts/ai/generation/primitives.js validateEvidenceRef() before
 * any provider call - closing that finding at this trust boundary.
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
const { isPlainObject, isBoundedText, collectUnknownKeyErrors, validateProjectId, validateEvidenceRef } = require("../generation/primitives");
const { validateRequirementModel } = require("../generation/requirement-model");
const { validateProvider, validateProviderResponse } = require("../providers/provider-contract");
const { normalizeProviderError, PROVIDER_ERROR_CODES } = require("../providers/provider-error");
const { LIMITS: EVIDENCE_LIMITS, EVIDENCE_KIND_USER_INPUT } = require("./evidence-ingestion");
const { buildRequirementModelSystemPrompt, buildRequirementModelUserPrompt } = require("./test-design-prompt");

// Roadmap #22C: initial attempt + at most one bounded correction retry -
// never unbounded, never recursive. A caller-supplied maxAttempts is only
// ever narrowed toward this ceiling (see resolveMaxAttempts below), never
// raised past it.
const MAX_PROVIDER_ATTEMPTS = 2;

// A well-formed generation call is grounded in at most
// EVIDENCE_LIMITS.MAX_AGGREGATE_TEXT_LENGTH (20000) chars of #22B-owned
// source text; even a maximal RequirementModel built from that much
// material (bounded ids/kind/sourceId echoes plus provider-authored
// requirement/assumption/openQuestion text) has no legitimate need for
// anywhere near scripts/ai/generation/limits.js's theoretical v1 ceiling.
// Chosen as a generous, bounded multiple of that input aggregate so a
// genuine response is never rejected, while a runaway/hostile response is
// rejected before it is ever handed to JSON.parse.
const MAX_REQUIREMENT_MODEL_RESPONSE_CHARS = 5 * EVIDENCE_LIMITS.MAX_AGGREGATE_TEXT_LENGTH;

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

// Freshly constructed, frozen copies - never the caller's own live
// objects - so a hostile bundle cannot alter what "canonical" means after
// validation via a later mutation or a getter re-evaluated on a second
// read (see module comment: caller-owned input is never trusted by
// reference). Only ever called after validateEvidenceBundle() and every
// per-item validateEvidenceRef() call below have both already passed.
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

// CRITICAL post-provider gate (Roadmap #22C Phase 18-20): every EvidenceRef
// the model's own RequirementModel.evidenceRefs carries must both (a) exist
// in the per-bundle canonical registry by id, and (b) match that canonical
// entry by EXACT field equality - id, kind, sourceId presence/value alike.
// A known id with an altered kind/sourceId, an added field (e.g.
// "location"), or a missing sourceId all fail (b); an id the registry never
// issued fails (a). The model MAY reference a strict subset of the
// registry - full coverage is never required (Roadmap #22C Phase 21).
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

// --- output freeze (Roadmap #22C Phase 31) ----------------------------------
//
// Only ever called on `parsed` - a value JSON.parse just constructed fresh
// for this call, never the caller's bundle/provider objects (FREEZE_
// BOUNDARY = OUTPUT_ONLY, matching evidence-ingestion.js's own deepFreeze).
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

function resolveMaxAttempts(maxAttempts) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) return MAX_PROVIDER_ATTEMPTS;
  return Math.min(maxAttempts, MAX_PROVIDER_ATTEMPTS);
}

/**
 * Generates a grounded RequirementModel v1 from an accepted #22B evidence
 * bundle via a dependency-injected provider.
 *
 * Returns `{ ok: true, requirementModel, providerAttempts }` or
 * `{ ok: false, errors, providerAttempts }` - `errors` is always the
 * bounded `{path, code, message}` shape, never a raw provider response,
 * rejected value, or stack trace. `providerAttempts` is 0 whenever a local,
 * deterministic pre-provider gate failed (invalid provider object, invalid
 * evidence bundle, invalid canonical EvidenceRef) - those never consume a
 * provider call.
 */
async function generateRequirementModel({ evidenceBundle, provider, maxAttempts, expectedProjectId } = {}) {
  try {
    validateProvider(provider);
  } catch (rawErr) {
    return { ok: false, errors: [summarizeProviderError(normalizeProviderError(rawErr))], providerAttempts: 0 };
  }

  const bundleErrors = validateEvidenceBundle(evidenceBundle, { expectedProjectId });
  if (bundleErrors.length > 0) {
    return { ok: false, errors: bundleErrors, providerAttempts: 0 };
  }

  // Snapshot every id/kind/sourceId with exactly ONE property read each,
  // into fresh frozen objects, before any further validation - not merely
  // for freeze-boundary hygiene (see module comment), but so a hostile
  // bundle cannot use a getter to present one value to validateEvidenceRef
  // below and a DIFFERENT value to the registry/prompt afterward (a
  // time-of-check-to-time-of-use gap). Whatever this snapshot captures is
  // the only value ever validated, registered, or shown to the provider.
  const canonicalEvidence = toCanonicalEvidence(evidenceBundle.evidenceItems);

  // MANDATORY before any provider call (Roadmap #22C Phase 7): every
  // canonical EvidenceRef is independently re-validated against the frozen
  // v1 validateEvidenceRef(), never trusted merely because
  // validateEvidenceBundle() above already checked this module's own
  // narrower local shape. Validated on the snapshot itself (not the
  // caller's original object) so this is exactly what becomes canonical.
  const canonicalErrors = [];
  canonicalEvidence.forEach((item, i) => {
    validateEvidenceRef(item.evidenceRef, `$.evidenceItems[${i}].evidenceRef`, canonicalErrors);
  });
  if (canonicalErrors.length > 0) {
    return { ok: false, errors: canonicalErrors, providerAttempts: 0 };
  }

  const registry = new Map(canonicalEvidence.map((item) => [item.evidenceRef.id, item.evidenceRef]));

  const projectId = evidenceBundle.projectId;
  const systemPrompt = buildRequirementModelSystemPrompt();
  const attempts = resolveMaxAttempts(maxAttempts);

  let providerAttempts = 0;
  let lastErrors = [];
  let correctionErrors = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    providerAttempts = attempt;
    const userPrompt = buildRequirementModelUserPrompt({ projectId, canonicalEvidence }, { correctionErrors });

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

    const modelResult = validateRequirementModel(parsed, { expectedProjectId: projectId });
    if (!modelResult.ok) {
      lastErrors = modelResult.errors;
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    const provenanceErrors = checkCanonicalProvenance(parsed.evidenceRefs, registry);
    if (provenanceErrors.length > 0) {
      lastErrors = provenanceErrors;
      correctionErrors = lastErrors;
      if (attempt === attempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    return { ok: true, requirementModel: deepFreeze(parsed), providerAttempts };
  }

  return { ok: false, errors: lastErrors, providerAttempts };
}

module.exports = {
  generateRequirementModel,
  validateEvidenceBundle,
  checkCanonicalProvenance,
  MAX_PROVIDER_ATTEMPTS,
  MAX_REQUIREMENT_MODEL_RESPONSE_CHARS,
};
