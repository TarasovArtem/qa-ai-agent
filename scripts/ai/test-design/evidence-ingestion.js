/**
 * Deterministic requirement-evidence ingestion (Roadmap #22B).
 *
 * First real #22 AI Test Design component. This module does NOT generate a
 * RequirementModel and does NOT call a provider - it takes bounded, direct
 * user-provided requirement text and deterministically assigns each source
 * its own canonical, frozen-v1-valid EvidenceRef, producing a small,
 * strict, JSON-serializable internal evidence bundle.
 *
 * CANONICAL EVIDENCE OWNERSHIP (the core invariant this module exists to
 * establish before any LLM is introduced): this deterministic ingestion
 * layer - never a caller, never a future provider - assigns every
 * EvidenceRef's id/kind/sourceId. A caller supplies only requirement text;
 * it may not choose an evidence id or a sourceId. A future #22C provider
 * call will be allowed to REFERENCE a canonical EvidenceRef by id - it will
 * never be allowed to invent one or restate one with different kind/
 * sourceId/location while keeping the same id. This module's output (each
 * evidenceItems[].evidenceRef, exactly as produced here) is the source of
 * truth #22C must compare a provider's echoed EvidenceRef against, by exact
 * field equality - that comparison is not implemented here, only made
 * possible.
 *
 * Requirement source text is DATA, never instructions - this module
 * performs no semantic interpretation of it at all (not even prompt
 * construction; there is no provider call in this stage). A prompt-
 * injection-shaped string is accepted, preserved, and returned inertly like
 * any other requirement text, exactly the same "data, never instructions"
 * boundary already enforced for current-run evidence by
 * scripts/ai/qa-agent-prompt.js and for curated guidance by
 * scripts/ai/knowledge/schema.js.
 *
 * The produced bundle is an internal projection, not a new cross-stream
 * public contract: it is deliberately NOT schemaVersion: 1, NOT part of
 * scripts/ai/generation/, and NOT frozen - only #22's own later stages
 * consume it. Every EvidenceRef it contains, however, is constructed to
 * satisfy scripts/ai/generation/primitives.js's own frozen v1
 * validateEvidenceRef() unmodified (see evidence-ingestion.test.js), reused
 * here strictly read-only.
 *
 * Pure, synchronous, deterministic, offline: no filesystem, network,
 * provider, timestamp, random, or environment-derived identity. The same
 * ordered input always produces a deep-equal bundle.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isBoundedText, collectUnknownKeyErrors, validateProjectId } = require("../generation/primitives");

// Roadmap #22B-owned bounds - deliberately local to this module, never
// added to or read from scripts/ai/generation/limits.js (that file bounds
// the frozen v1 contracts, not this pre-contract ingestion stage). Chosen
// conservatively with a future provider prompt's size in mind:
//  - MAX_SOURCES: generous for one real user-submitted set of direct
//    requirement-text snippets, while keeping the total item count a
//    future prompt payload small enough to review.
//  - MAX_SOURCE_TEXT_LENGTH: matches the "one long free-text field" order
//    of magnitude scripts/ai/generation/limits.js already uses for
//    requirement/rationale text (LONG_TEXT_MAX_LENGTH = 4000) - enough for
//    a real paragraph/section of a requirement document.
//  - MAX_AGGREGATE_TEXT_LENGTH: deliberately much smaller than
//    MAX_SOURCES * MAX_SOURCE_TEXT_LENGTH (20 * 4000 = 80000), so the
//    per-source cap alone can never be the only bound - a caller cannot
//    reach a huge total prompt payload merely by supplying many
//    individually-small-enough sources.
const LIMITS = Object.freeze({
  MAX_SOURCES: 20,
  MAX_SOURCE_TEXT_LENGTH: 4000,
  MAX_AGGREGATE_TEXT_LENGTH: 20000,
});

// Roadmap #22B supports exactly one source class: direct user-provided
// requirement text (see the #22A readiness audit's "minimum useful first
// source set" recommendation). Uploaded documents, repository docs,
// Knowledge, and ProjectProfile-as-evidence are future source adapters,
// deliberately not implemented here.
//
// "user_input" is drawn from scripts/ai/generation/primitives.js's frozen
// EVIDENCE_REF_KINDS vocabulary - hardcoded here (rather than indexed out
// of that array, which would be order-dependent and fragile) and
// cross-checked against the live frozen enum in
// evidence-ingestion.test.js, so any future drift in that enum's contents
// would fail a test here rather than silently diverge.
const EVIDENCE_KIND_USER_INPUT = "user_input";

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze(["projectId", "sources"]);
const SOURCE_ALLOWED_KEYS = Object.freeze(["text"]);

// 1-based, zero-padded ordinal - deterministic and stable for the same
// input position, never derived from time, randomness, or environment.
function formatOrdinal(n) {
  return String(n).padStart(4, "0");
}

// Recursively freezes a plain-object/array/primitive tree (the only shapes
// this module ever produces) so the bundle #22C consumes cannot be
// accidentally mutated in-process. Deliberately not a general-purpose deep
// freeze (no Map/Set/class-instance handling) - this module never produces
// those shapes, so a general-purpose implementation would be unused
// complexity.
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

/**
 * Validates and deterministically ingests `input` into a plain,
 * JSON-serializable evidence bundle.
 *
 * `input` shape: { projectId: string, sources: [{ text: string }, ...] }.
 * A caller may never supply an evidence id, a sourceId, or any other field
 * beyond `text` on a source entry - see SOURCE_ALLOWED_KEYS above; any
 * extra key fails closed as UNKNOWN_FIELD.
 *
 * `options.expectedProjectId`, when supplied, is passed straight through to
 * primitives.js's own validateProjectId() (the same optional cross-check
 * every frozen v1 contract validator already accepts) - omitted, `input
 * .projectId` is accepted as-is with no comparison.
 *
 * Returns { ok: true, bundle } or { ok: false, errors: [{path,code,
 * message}, ...] } - errors never echo raw requirement text, the supplied
 * projectId value, or any other rejected value; see evidence-ingestion
 * .test.js's privacy tests.
 */
function ingestRequirementEvidence(input, { expectedProjectId } = {}) {
  const errors = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "input must be a plain object")] };
  }

  collectUnknownKeyErrors(input, TOP_LEVEL_ALLOWED_KEYS, "$", errors);
  validateProjectId(input.projectId, "$.projectId", errors, { expectedProjectId });

  const sources = input.sources;
  const validSources = [];

  if (!Array.isArray(sources) || sources.length === 0) {
    errors.push(err("$.sources", ERROR_CODES.MISSING_FIELD, "$.sources must be a non-empty array"));
  } else if (sources.length > LIMITS.MAX_SOURCES) {
    errors.push(err("$.sources", ERROR_CODES.INVALID_VALUE, `$.sources exceeds the maximum of ${LIMITS.MAX_SOURCES}`));
  } else {
    sources.forEach((source, i) => {
      const path = `$.sources[${i}]`;
      if (!isPlainObject(source)) {
        errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
        return;
      }
      collectUnknownKeyErrors(source, SOURCE_ALLOWED_KEYS, path, errors);
      if (!isBoundedText(source.text, LIMITS.MAX_SOURCE_TEXT_LENGTH)) {
        errors.push(err(`${path}.text`, ERROR_CODES.INVALID_TYPE, `${path}.text must be a bounded, non-empty string`));
        return;
      }
      // Preserved exactly as supplied - no trim/case/punctuation/
      // line-ending rewrite. Source order is meaningful input order and is
      // never sorted or deduplicated: two identical requirement strings
      // remain two distinct source entries.
      validSources.push(source.text);
    });

    // Meaningful only once every source was itself individually
    // well-formed (matching test-case-model.js's collectRequirementIdList
    // convention of only chasing valid entries into a cross-check) - a
    // still-malformed source has already been reported above, and an
    // aggregate figure over a partially-invalid array would be misleading.
    if (validSources.length === sources.length) {
      const aggregateLength = validSources.reduce((sum, text) => sum + text.length, 0);
      if (aggregateLength > LIMITS.MAX_AGGREGATE_TEXT_LENGTH) {
        errors.push(err("$.sources", ERROR_CODES.INVALID_VALUE, `$.sources aggregate text exceeds the maximum of ${LIMITS.MAX_AGGREGATE_TEXT_LENGTH}`));
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const evidenceItems = validSources.map((text, i) => {
    const ordinal = formatOrdinal(i + 1);
    return {
      evidenceRef: {
        id: `evidence-${ordinal}`,
        kind: EVIDENCE_KIND_USER_INPUT,
        sourceId: `user-input-${ordinal}`,
      },
      text,
    };
  });

  const bundle = deepFreeze({
    projectId: input.projectId,
    evidenceItems,
  });

  return { ok: true, bundle };
}

module.exports = { ingestRequirementEvidence, LIMITS, EVIDENCE_KIND_USER_INPUT };
