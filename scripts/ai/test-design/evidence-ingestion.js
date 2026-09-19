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
 *
 * REQUIREMENTARTIFACT EVIDENCE ADAPTER (Roadmap ACG-A3, Architecture
 * Conformance Gate finding A-3): `ingestRequirementArtifactsAsEvidence()`
 * below is the ONE explicit, opt-in, one-directional seam between RTI's
 * deterministic `RequirementArtifact` contract (scripts/ai/
 * requirement-artifact.js) and this #22 evidence layer - see
 * docs/architecture-model-boundary-v1.md for the full normative contract.
 * It is a thin adapter, not a second ingestion engine: it validates each
 * supplied `RequirementArtifact` with RTI-1's own
 * `assertValidRequirementArtifact()`, deterministically projects it to
 * plain evidence text (title/content/acceptance-criteria only - never
 * `source.location`, `metadata`, or any other field), and reuses
 * `buildCanonicalEvidenceBundle()` - the same canonical-construction
 * primitive `ingestRequirementEvidence()` above itself uses - to assign
 * `EvidenceRef`s; canonical evidence ownership (the invariant this whole
 * module exists to establish) is never touched or duplicated by the
 * adapter.
 *
 * ARTIFACT EVIDENCE BUDGET (ACG-A3 corrective, finding ACG-A3-R02): RTI-1
 * structural validity alone does NOT guarantee a `RequirementArtifact` is
 * representable by this adapter. `RequirementArtifact.content` is valid up
 * to 20000 characters and `acceptanceCriteria` up to 200 entries at up to
 * 20000 characters each (scripts/ai/requirement-artifact.js) - far more
 * than a single evidence item can carry. This adapter enforces its own
 * explicit, named `ARTIFACT_EVIDENCE_LIMITS` (see below) BEFORE ever
 * building a bundle, so an oversized artifact fails closed with an
 * artifact-facing `$.artifacts[i]`/`$.artifacts` error - never the
 * direct-text path's internal `$.sources[...]` error, and never silently
 * truncated. Those limits are deliberately equal to `LIMITS` above, not
 * coincidentally: `scripts/ai/test-design/requirement-model-generator.js`
 * (#22C) imports `LIMITS` from this module and independently re-validates
 * every evidence bundle against these exact same thresholds regardless of
 * ingestion path, so no relaxation here could ever be honored end-to-end
 * without also changing that separate, out-of-scope, security-reviewed
 * trust boundary. See docs/architecture-model-boundary-v1.md's "Artifact
 * evidence budget" section for the full rationale.
 *
 * INPUT SAFETY / GETTER SAFETY: `assertValidRequirementArtifact(artifact,
 * ...)` is called FIRST, before the adapter reads a single property of
 * `artifact`. This mirrors scripts/ai/requirement-quality.js's own
 * established, independently-reviewed precedent for consuming a validated
 * `RequirementArtifact` exactly: every field the adapter subsequently reads
 * (`id`, `title`, `content`, `acceptanceCriteria[].id`/`.text`) is EXACTLY
 * one of the fields RTI-1's own validator already certified via
 * `getOwnEnumerableDataProperty()` (own, enumerable, data-only - never an
 * inherited, non-enumerable, or accessor-backed value; a data descriptor
 * has no getter function left to invoke a second time, so a value already
 * certified this way cannot differ between the validation call and the
 * adapter's own read). Execution is fully synchronous with no intervening
 * async boundary between validation and these reads, so no concurrent
 * mutation of `artifact` can occur between the two (single-threaded JS, no
 * I/O in between) - matching requirement-quality.js's own documented
 * reasoning exactly rather than re-implementing RTI-1's hardening
 * primitives a second time in this module.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isBoundedText, collectUnknownKeyErrors, collectDuplicateIdErrors, validateProjectId } = require("../generation/primitives");
const { assertValidRequirementArtifact } = require("../requirement-artifact");

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

// ACG-A3 corrective (finding ACG-A3-R02): the artifact-evidence budget
// below is DELIBERATELY equal in value to LIMITS above - this is not the
// original bug (silently reusing the direct-text path's own bound) restated
// unchanged; it is a distinct, explicitly-named, independently-derived
// contract that happens to land on the same numbers for a specific, provable
// reason. scripts/ai/test-design/requirement-model-generator.js (#22C)
// imports LIMITS from THIS module and independently re-validates every
// evidence bundle it receives - regardless of which ingestion path produced
// it - against these exact same per-item/aggregate thresholds as its own
// caller-can't-be-trusted trust-boundary re-check (see that module's own
// MAX_REQUIREMENT_MODEL_RESPONSE_CHARS, itself derived from
// LIMITS.MAX_AGGREGATE_TEXT_LENGTH). Raising a bound here for the artifact
// path alone could therefore never be honored end-to-end: an oversized
// bundle would simply be rejected later, by #22C's own re-validation, with
// an even more disconnected error that can no longer be traced back to the
// originating RequirementArtifact. See
// docs/architecture-model-boundary-v1.md's "Artifact evidence budget"
// section for the full rationale and its explicit consequence: RTI-1
// structural validity alone does not guarantee a RequirementArtifact's
// projection is accepted by this adapter.
const ARTIFACT_EVIDENCE_LIMITS = Object.freeze({
  MAX_PROJECTED_TEXT_LENGTH: LIMITS.MAX_SOURCE_TEXT_LENGTH,
  MAX_AGGREGATE_PROJECTED_TEXT_LENGTH: LIMITS.MAX_AGGREGATE_TEXT_LENGTH,
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

// ACG-A3 corrective (ACG-A3-R02): the ONE place either ingestion path
// (direct-text or RequirementArtifact-derived) assigns canonical
// EvidenceRef.id/kind/sourceId - factored out so canonical evidence
// ownership stays enforced in exactly one place regardless of which public
// function produced `texts`. Never exported, never a public API: `texts`
// must already be validated (bounded, non-empty strings, already within
// whichever contract's own bounds) by the caller - this helper performs no
// validation of its own and therefore never produces an error of any kind.
function buildCanonicalEvidenceBundle(projectId, texts) {
  const evidenceItems = texts.map((text, i) => {
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
  return deepFreeze({ projectId, evidenceItems });
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

  const bundle = buildCanonicalEvidenceBundle(input.projectId, validSources);

  return { ok: true, bundle };
}

// Roadmap ACG-A3 (Architecture Conformance Gate finding A-3) - the one
// explicit, opt-in adapter allowed by docs/architecture-model-boundary-v1.md:
// RequirementArtifact[] -> #22 evidence, never the reverse, never a direct
// RequirementModel coercion. See this module's own docstring for the full
// rationale, including the INPUT SAFETY / GETTER SAFETY reasoning this
// function relies on.
const ARTIFACT_INPUT_ALLOWED_KEYS = Object.freeze(["projectId", "artifacts"]);
const INGEST_ARTIFACTS_CALLER_LABEL = "ingestRequirementArtifactsAsEvidence";

// Deterministic, offline, no AI, no summarization: same validated artifact
// always produces byte-identical evidence text. Field order is fixed
// (title, then content, then acceptance criteria in original array order).
// Deliberately excludes `source.location` (never filesystem/executable
// authority), `metadata` (no evidence-backed reason to surface it yet), and
// `relationships[]` (structural cross-references, not requirement wording -
// resolving them would invent an RTI collection-level responsibility
// RequirementArtifact's own contract explicitly defers). `type`/`priority`/
// `labels` are likewise left out of v1: none carry requirement *wording*,
// and omitting them keeps the projection minimal-sufficient rather than
// maximal - see docs/architecture-model-boundary-v1.md for the full
// rationale and how to extend this list if a real caller ever needs one of
// these fields as grounding text.
function projectRequirementArtifactToEvidenceText(artifact) {
  const lines = [`Title: ${artifact.title}`];
  if (typeof artifact.content === "string" && artifact.content.length > 0) {
    lines.push(`Content: ${artifact.content}`);
  }
  if (artifact.acceptanceCriteria.length > 0) {
    lines.push("Acceptance Criteria:");
    artifact.acceptanceCriteria.forEach((criterion) => lines.push(`- ${criterion.text}`));
  }
  return lines.join("\n");
}

/**
 * Validates and deterministically adapts `input.artifacts` (RTI-1
 * `RequirementArtifact[]`) into a canonical #22 evidence bundle, by
 * delegating actual `EvidenceRef` construction to
 * `ingestRequirementEvidence()` above unchanged.
 *
 * `input` shape: { projectId: string, artifacts: RequirementArtifact[] }.
 * Every `artifacts[i]` must independently satisfy RTI-1's own
 * `assertValidRequirementArtifact()` - this adapter never re-implements or
 * loosens that contract. `artifacts[i].id` values must be unique (an
 * unambiguous artifact -> evidence mapping is required - see `mapping`
 * below); a duplicate id fails closed as `DUPLICATE_ID`, matching every
 * other collection validator in this codebase family
 * (`collectDuplicateIdErrors()`, scripts/ai/generation/primitives.js).
 * `artifacts` is bounded by the same `LIMITS.MAX_SOURCES` this module
 * already enforces for direct-text sources - each artifact becomes exactly
 * one evidence item, so the same prompt-budget reasoning applies unchanged.
 *
 * `options.expectedProjectId` behaves exactly as it does for
 * `ingestRequirementEvidence()` - passed straight through.
 *
 * Returns `{ ok: true, bundle, mapping }` on success - `bundle` is the
 * IDENTICAL shape `ingestRequirementEvidence()` itself returns (frozen,
 * canonical `EvidenceRef`s, never caller-influenced), and `mapping` is a
 * separate, frozen, adapter-owned array of `{ requirementArtifactId,
 * evidenceRefId }` pairs (input order preserved) giving traceability back
 * to the source `RequirementArtifact` WITHOUT adding any new field to the
 * frozen v1 `EvidenceRef` schema. Returns `{ ok: false, errors }` on any
 * validation failure, including an oversized projection (see
 * `ARTIFACT_EVIDENCE_LIMITS` above) - errors never echo raw artifact
 * content, matching this module's own existing privacy convention, and
 * always reference this function's own `$.artifacts[...]`/`$.artifacts`
 * input shape, never the unrelated direct-text `$.sources[...]` shape
 * (ACG-A3-R02).
 */
function ingestRequirementArtifactsAsEvidence(input, { expectedProjectId } = {}) {
  const errors = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "input must be a plain object")] };
  }

  collectUnknownKeyErrors(input, ARTIFACT_INPUT_ALLOWED_KEYS, "$", errors);
  validateProjectId(input.projectId, "$.projectId", errors, { expectedProjectId });

  const artifacts = input.artifacts;
  const validatedArtifacts = [];

  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    errors.push(err("$.artifacts", ERROR_CODES.MISSING_FIELD, "$.artifacts must be a non-empty array"));
  } else if (artifacts.length > LIMITS.MAX_SOURCES) {
    errors.push(err("$.artifacts", ERROR_CODES.INVALID_VALUE, `$.artifacts exceeds the maximum of ${LIMITS.MAX_SOURCES}`));
  } else {
    artifacts.forEach((artifact, i) => {
      const path = `$.artifacts[${i}]`;
      try {
        assertValidRequirementArtifact(artifact, INGEST_ARTIFACTS_CALLER_LABEL);
      } catch (e) {
        errors.push(err(path, ERROR_CODES.INVALID_VALUE, `${path} is not a valid RequirementArtifact`));
        return;
      }
      // See module docstring's INPUT SAFETY / GETTER SAFETY section - every
      // field read below was already certified an own-enumerable-data
      // property by the assertValidRequirementArtifact() call immediately
      // above, with no intervening async boundary.
      const acceptanceCriteria = Array.isArray(artifact.acceptanceCriteria)
        ? artifact.acceptanceCriteria.map((criterion) => ({ id: criterion.id, text: criterion.text }))
        : [];
      validatedArtifacts.push({
        id: artifact.id,
        title: artifact.title,
        content: artifact.content,
        acceptanceCriteria,
      });
    });

    // Meaningful only once every artifact was itself individually valid -
    // matching this module's own existing "only chase valid entries into a
    // cross-check" convention above.
    if (validatedArtifacts.length === artifacts.length) {
      collectDuplicateIdErrors(validatedArtifacts, "id", "$.artifacts", errors);
    }
  }

  // ACG-A3-R02 corrective: artifact-domain evidence-budget validation runs
  // HERE, entirely before any call into the direct-text path, so an
  // oversized artifact can never produce ingestRequirementEvidence()'s own
  // internal $.sources[...] error - it fails closed with an artifact-facing
  // path instead. Meaningful only once every artifact was itself
  // individually valid, matching this function's own existing convention
  // above (a still-malformed artifact has already been reported; a
  // length figure computed over its projection would be meaningless).
  let projectedTexts = [];
  if (validatedArtifacts.length === artifacts?.length && validatedArtifacts.length > 0) {
    projectedTexts = validatedArtifacts.map((artifact) => projectRequirementArtifactToEvidenceText(artifact));

    projectedTexts.forEach((text, i) => {
      if (text.length > ARTIFACT_EVIDENCE_LIMITS.MAX_PROJECTED_TEXT_LENGTH) {
        errors.push(
          err(
            `$.artifacts[${i}]`,
            ERROR_CODES.INVALID_VALUE,
            `$.artifacts[${i}] projected evidence exceeds the maximum supported length of ${ARTIFACT_EVIDENCE_LIMITS.MAX_PROJECTED_TEXT_LENGTH}`
          )
        );
      }
    });

    if (projectedTexts.every((text) => text.length <= ARTIFACT_EVIDENCE_LIMITS.MAX_PROJECTED_TEXT_LENGTH)) {
      const aggregateLength = projectedTexts.reduce((sum, text) => sum + text.length, 0);
      if (aggregateLength > ARTIFACT_EVIDENCE_LIMITS.MAX_AGGREGATE_PROJECTED_TEXT_LENGTH) {
        errors.push(
          err(
            "$.artifacts",
            ERROR_CODES.INVALID_VALUE,
            `$.artifacts aggregate projected evidence exceeds the maximum of ${ARTIFACT_EVIDENCE_LIMITS.MAX_AGGREGATE_PROJECTED_TEXT_LENGTH}`
          )
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // One RequirementArtifact -> exactly one evidence item, preserving input
  // order, so the index-aligned mapping below is unambiguous. Builds the
  // bundle directly via the same canonical primitive ingestRequirementEvidence()
  // itself uses - never by delegating to that function - so no direct-text
  // $.sources[...] error path is structurally reachable from this function.
  const bundle = buildCanonicalEvidenceBundle(input.projectId, projectedTexts);

  const mapping = deepFreeze(
    validatedArtifacts.map((artifact, i) => ({
      requirementArtifactId: artifact.id,
      evidenceRefId: bundle.evidenceItems[i].evidenceRef.id,
    }))
  );

  return { ok: true, bundle, mapping };
}

module.exports = {
  ingestRequirementEvidence,
  ingestRequirementArtifactsAsEvidence,
  LIMITS,
  ARTIFACT_EVIDENCE_LIMITS,
  EVIDENCE_KIND_USER_INPUT,
};
