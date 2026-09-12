"use strict";

/**
 * Test Design Generation (Roadmap RTI-4) - the first deterministic layer
 * that converts a validated, sufficiently-testable RequirementArtifact
 * (RTI-1) into generic TestDesignArtifact[] once RequirementQuality
 * analysis (RTI-3) has certified it READY.
 *
 * Conceptual pipeline this module implements:
 *
 *   RequirementArtifact
 *           |
 *           v
 *   assertValidRequirementArtifact()   (RTI-1, structural authority)
 *           |
 *           v
 *   analyzeRequirementQuality()        (RTI-3, semantic-quality authority)
 *           |
 *           v
 *   require quality.status === "READY"
 *           |
 *           v
 *   generate TestDesignArtifact[]      (this module)
 *
 * THE CENTRAL INVARIANT (identical in spirit to RTI-3's own, extended one
 * level further downstream): RTI-4 may transform requirement semantics that
 * are EXPLICITLY present in the RequirementArtifact - it must never invent
 * a missing timeout, HTTP status, actor, authentication rule, error
 * message, retry behavior, security control, performance threshold,
 * negative/boundary case, or procedural UI/API step. If a detail is not in
 * the source, it is not in the generated test design either. This module
 * is deliberately a faithful, conservative, source-preserving
 * transformation, not a test-design "author."
 *
 * RTI-3 IS THE SOLE QUALITY AUTHORITY: this module calls
 * analyzeRequirementQuality() and trusts its verdict completely - it never
 * re-implements or duplicates any of RTI-3's own vague-term/placeholder/
 * measurability rule vocabulary. A RequirementArtifact whose quality status
 * is anything other than "READY" (PARTIALLY_TESTABLE, AMBIGUOUS,
 * MISSING_INFORMATION, UNTESTABLE) is refused outright - generation never
 * proceeds "partially" or attempts to repair the semantic gap RTI-3 found.
 *
 * DETERMINISTIC, ZERO AI: no LLM/AI calls, no network, no filesystem, no
 * environment variables, no randomness (Math.random()), no clock dependency
 * (Date.now()). The same RequirementArtifact always produces the same
 * TestDesignArtifact[], in the same order, with the same ids.
 *
 * SOURCE-INDEPENDENT / TYPE-UNIFORM: `artifact.source.type` is never read
 * here (generation is identical whether a requirement came from a file, a
 * future issue tracker, or any other adapter). `artifact.type` does not
 * select different generation branches in this MVP - every artifact type
 * uses the same generic transformation; a type-aware generation matrix is
 * explicitly deferred until a concrete, evidence-based need exists (the
 * same "avoid speculative complexity" posture this repository has applied
 * consistently since RTI-1).
 *
 * ACCEPTANCE CRITERIA ARE THE PRIMARY GENERATION UNIT: when
 * `acceptanceCriteria[]` is present (even alongside `content`), one
 * TestDesignArtifact is generated per criterion, in array order - never a
 * merged/summarized scenario, which would require inference this module
 * does not perform. When no acceptanceCriteria are present, exactly one
 * TestDesignArtifact is generated directly from `content`. This is a fixed,
 * simple, always-predictable N-in/N-out (or 1-in/1-out) rule - see this
 * module's own docstring section on why a different rule would need
 * explicit architectural justification this MVP does not have.
 *
 * RESULT CONTRACT (data-only, JSON-serializable, deliberately narrower than
 * the roadmap's own candidate shape):
 *
 *   TestDesignArtifact = {
 *     id: string,                 // deterministic, see ID STRATEGY below
 *     requirementId: string,      // === artifact.id
 *     title: string,              // source-preserving, bounded by construction
 *     objective: string,          // "Verify that: <source text>", never rewritten
 *     expectedResults: string[],  // [<source text>] - single element in this MVP
 *     source: {
 *       requirementId: string,
 *       criterionId?: string,     // present only for an id-bearing criterion
 *       criterionIndex?: number,  // positional fallback - NEVER a generated/persisted id
 *     }
 *   }
 *
 * DELIBERATELY EXCLUDED FROM THIS CONTRACT (not "included but always
 * empty" - genuinely absent, because no legitimate source data exists yet
 * to populate them without inventing structure):
 *
 *   - `steps` / `preconditions`: RequirementArtifact (RTI-1) has no
 *     structured field for procedural actions or setup state - `content`
 *     and `acceptanceCriteria[].text` are prose, not step lists. Inventing
 *     "1. Open login page, 2. Enter username, ..." from a requirement that
 *     never described those actions would be exactly the kind of invented
 *     procedural detail this module's central invariant forbids. A future
 *     phase may add structured step extraction once a real, evidence-based
 *     source for it exists (e.g. a requirement format that legitimately
 *     encodes steps) - it is not simulated here by omission-as-empty-array,
 *     which would misleadingly imply "no steps were needed" rather than
 *     "steps were never knowable."
 *   - `testType`, translated `priority`, `labels`: none can be derived from
 *     RequirementArtifact fields without either inventing a classification
 *     or reinterpreting data whose actual meaning (e.g. requirement
 *     priority) does not necessarily correspond to test priority. Omitted
 *     until a concrete, justified need exists.
 *   - negative-path / boundary-value / equivalence-partition test designs:
 *     never auto-generated from a positive-path source. A requirement
 *     stating "valid token returns HTTP 200" produces exactly one test
 *     design about that stated behavior - never an invented 401/403/expired
 *     variant. Explicit boundary values already present verbatim in source
 *     text are technically extractable in a future phase but are not
 *     attempted in this MVP (see module's own docstring on why: even a
 *     "simple" boundary rule needs its own careful design and evidence
 *     before being added, exactly like RTI-1's own deferred collection
 *     validator was".
 *
 * TRACEABILITY-READY FOR RTI-5: every generated artifact carries
 * `requirementId` (both at the top level and inside `source`) and, when
 * generated from a specific acceptance criterion, either `criterionId`
 * (when the source criterion had one) or a `criterionIndex` positional
 * fallback (when it did not) - RTI-5 (Requirement<->Test Traceability/
 * Coverage) can compute criterion coverage without ever having to parse a
 * human-readable title/objective string or receive a fabricated criterion
 * identity.
 *
 * ID STRATEGY: `${requirementId}::test::${ordinal}`, where `ordinal` is the
 * 1-based position of the acceptanceCriteria entry (or `1` for a
 * content-only artifact) - never Math.random()/a UUID/Date.now(). Stable
 * for the same input, deterministic order, no environment/time dependency,
 * JSON-safe. Because every producing collection API (RTI-2's
 * loadRequirementsFromFile, RTI-3's analyzeRequirementsQuality, and this
 * module's own generateTestDesigns) already rejects duplicate
 * RequirementArtifact.id defensively, test ids are automatically
 * collision-free across an entire generated collection, with no additional
 * uniqueness bookkeeping needed here.
 *
 * DUPLICATE CRITERION ID DEFENSE: RTI-1 does not itself enforce
 * acceptanceCriteria[].id uniqueness WITHIN one artifact (RTI-2's file
 * ingestion adds that check for file-sourced artifacts specifically, but a
 * RequirementArtifact reaching this module directly - not necessarily via
 * RTI-2 - carries no such guarantee). Two criteria sharing the same id
 * would make `source.criterionId`-based RTI-5 traceability genuinely
 * ambiguous, so generation for that whole artifact fails closed
 * (TEST_DESIGN_GENERATION_FAILED) rather than silently emitting
 * indistinguishable provenance.
 *
 * INPUT SAFETY: assertValidRequirementArtifact() runs as the literal first
 * statement, before any property of `artifact` is read - exactly RTI-3's
 * own established pattern. Every field subsequently read (id, title,
 * content, acceptanceCriteria[].text/.id) is exactly one of the fields
 * RTI-1's own validator already certified via getOwnEnumerableDataProperty()
 * (own, enumerable, data-only; an accessor's getter is never invoked).
 *
 * NO EXPLICIT VALIDATOR EXPORT (deliberate, re-evaluated from the roadmap's
 * own candidate design): unlike RequirementArtifact, a TestDesignArtifact
 * is never externally-authored untrusted input in this MVP - it is only
 * ever produced by this module's own deterministic construction, in
 * process, immediately consumed. There is no concrete external caller yet
 * (RTI-5/RTI-8 do not exist) that would receive an arbitrary
 * caller-supplied TestDesignArtifact needing hostile-input defense the way
 * RequirementArtifact does. Adding `assertValidTestDesignArtifact` now
 * would be exactly the kind of speculative complexity this repository
 * consistently avoids (see RTI-1's own deferred collection validator for
 * the identical precedent) - it is deferred until a real caller proves the
 * actual shape needed.
 *
 * DATA-ONLY, SHALLOW-FROZEN: every returned TestDesignArtifact, its
 * `expectedResults` array, and its `source` object are all frozen
 * (Object.freeze()) - since `expectedResults` contains only primitive
 * strings and `source` only primitive string/number values, this is
 * effectively complete immutability for this contract's actual (flat)
 * shape, unlike RequirementArtifact/RequirementQualityResult, which have
 * genuinely deeper, unfrozen nested structures. Stated exactly that way,
 * not overclaimed.
 */

const { assertValidRequirementArtifact } = require("./requirement-artifact");
const { analyzeRequirementQuality } = require("./requirement-quality");

const MAX_VALIDATION_DETAIL_LENGTH = 1024;
const MAX_REPORTED_ERRORS = 20;

function boundedDetail(errors) {
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const omitted = errors.length - shown.length;
  const joined = shown.join("; ") + (omitted > 0 ? `; ${omitted} additional error(s) omitted` : "");
  return joined.length <= MAX_VALIDATION_DETAIL_LENGTH ? joined : `${joined.slice(0, MAX_VALIDATION_DETAIL_LENGTH)}...`;
}

function buildSourceRef(artifact, criterion, index) {
  const ref = { requirementId: artifact.id };
  const hasId = criterion && typeof criterion.id === "string" && criterion.id.length > 0;
  if (hasId) {
    ref.criterionId = criterion.id;
  } else {
    ref.criterionIndex = index;
  }
  return Object.freeze(ref);
}

function buildFromCriterion(artifact, criterion, index) {
  const ordinal = index + 1;
  return Object.freeze({
    id: `${artifact.id}::test::${ordinal}`,
    requirementId: artifact.id,
    title: `${artifact.title} — AC ${ordinal}`,
    objective: `Verify that: ${criterion.text}`,
    expectedResults: Object.freeze([criterion.text]),
    source: buildSourceRef(artifact, criterion, index),
  });
}

function buildFromContent(artifact) {
  return Object.freeze({
    id: `${artifact.id}::test::1`,
    requirementId: artifact.id,
    title: artifact.title,
    objective: `Verify that: ${artifact.content}`,
    expectedResults: Object.freeze([artifact.content]),
    source: Object.freeze({ requirementId: artifact.id }),
  });
}

// Fails closed (rather than silently accepting ambiguous provenance) when
// two acceptanceCriteria entries in the SAME artifact share a non-empty id
// - see this module's own docstring "DUPLICATE CRITERION ID DEFENSE".
function assertNoDuplicateCriterionIds(artifact) {
  if (!Array.isArray(artifact.acceptanceCriteria)) return;
  const seen = new Map();
  artifact.acceptanceCriteria.forEach((criterion, index) => {
    const id = criterion && typeof criterion.id === "string" ? criterion.id : undefined;
    if (!id) return;
    if (seen.has(id)) {
      throw new Error(
        `TEST_DESIGN_GENERATION_FAILED: generateTestDesign found ambiguous acceptanceCriteria provenance for requirement "${artifact.id}" - criterion id "${id}" is used by both acceptanceCriteria[${seen.get(id)}] and acceptanceCriteria[${index}].`
      );
    }
    seen.set(id, index);
  });
}

function buildTestDesigns(artifact) {
  assertNoDuplicateCriterionIds(artifact);
  if (Array.isArray(artifact.acceptanceCriteria) && artifact.acceptanceCriteria.length > 0) {
    return artifact.acceptanceCriteria.map((criterion, index) => buildFromCriterion(artifact, criterion, index));
  }
  return [buildFromContent(artifact)];
}

/**
 * Generates one or more TestDesignArtifact from a single, already-
 * structurally-valid, RTI-3-READY RequirementArtifact. Returns an ARRAY -
 * never a single object - because one requirement legitimately produces
 * multiple test designs (one per acceptance criterion) whenever
 * acceptanceCriteria are present.
 *
 * @param {object} artifact a RequirementArtifact (scripts/ai/requirement-artifact.js)
 * @returns {object[]} TestDesignArtifact[] in acceptanceCriteria order (or
 *   a single content-derived entry) - the top-level artifact, its
 *   `expectedResults` array, and its `source` object are all frozen
 * @throws {Error} REQUIREMENT_ARTIFACT_REQUIRED / REQUIREMENT_ARTIFACT_INVALID
 *   (RTI-1, structural) / TEST_DESIGN_REQUIREMENT_NOT_READY (RTI-3 quality
 *   gate) / TEST_DESIGN_GENERATION_FAILED (defensive backstop, including
 *   ambiguous duplicate criterion-id provenance)
 */
function generateTestDesign(artifact) {
  assertValidRequirementArtifact(artifact, "generateTestDesign");
  const quality = analyzeRequirementQuality(artifact);
  if (quality.status !== "READY") {
    throw new Error(
      `TEST_DESIGN_REQUIREMENT_NOT_READY: generateTestDesign requires a READY RequirementArtifact (artifact "${artifact.id}" has quality status "${quality.status}").`
    );
  }
  try {
    return buildTestDesigns(artifact);
  } catch (err) {
    if (/^TEST_DESIGN_GENERATION_FAILED:/.test(err.message)) throw err;
    throw new Error(`TEST_DESIGN_GENERATION_FAILED: generateTestDesign could not generate a test design for requirement "${artifact.id}" (${err.message}).`);
  }
}

/**
 * Generates TestDesignArtifact[] for an array of RequirementArtifact[], in
 * input order, concatenated (never grouped/nested per requirement - each
 * element already carries its own requirementId/source for grouping if a
 * caller needs it). Atomic: fails the WHOLE call if any artifact is
 * structurally invalid, if any two artifacts share an id, or if any
 * artifact is not RTI-3 READY - never a partial result that would hide
 * quality debt.
 *
 * @param {object[]} artifacts RequirementArtifact[]
 * @returns {object[]} TestDesignArtifact[] (flat, concatenated, in order)
 */
function generateTestDesigns(artifacts) {
  if (artifacts === undefined || artifacts === null) {
    throw new Error("TEST_DESIGN_INPUT_REQUIRED: generateTestDesigns requires an explicit array of RequirementArtifact; none was supplied.");
  }
  if (!Array.isArray(artifacts)) {
    throw new Error("TEST_DESIGN_INPUT_INVALID: generateTestDesigns requires an array of RequirementArtifact.");
  }

  const shapeErrors = [];
  artifacts.forEach((artifact, index) => {
    try {
      assertValidRequirementArtifact(artifact, "generateTestDesigns");
    } catch (err) {
      shapeErrors.push(`artifacts[${index}]: ${err.message}`);
    }
  });
  if (shapeErrors.length > 0) {
    throw new Error(`TEST_DESIGN_INPUT_INVALID: generateTestDesigns received invalid requirement record(s) (${boundedDetail(shapeErrors)}).`);
  }

  const collectionErrors = [];
  const seenIds = new Map();
  artifacts.forEach((artifact, index) => {
    if (seenIds.has(artifact.id)) {
      collectionErrors.push(`artifacts[${index}].id "${artifact.id}" duplicates artifacts[${seenIds.get(artifact.id)}].id`);
    } else {
      seenIds.set(artifact.id, index);
    }
  });
  if (collectionErrors.length > 0) {
    throw new Error(`TEST_DESIGN_COLLECTION_INVALID: generateTestDesigns received a collection with duplicate artifact ids (${boundedDetail(collectionErrors)}).`);
  }

  const notReadyErrors = [];
  const qualities = artifacts.map((artifact, index) => {
    const quality = analyzeRequirementQuality(artifact);
    if (quality.status !== "READY") {
      notReadyErrors.push(`artifacts[${index}] (id "${artifact.id}"): quality status "${quality.status}"`);
    }
    return quality;
  });
  if (notReadyErrors.length > 0) {
    throw new Error(`TEST_DESIGN_REQUIREMENT_NOT_READY: generateTestDesigns requires every RequirementArtifact to be READY (${boundedDetail(notReadyErrors)}).`);
  }
  void qualities; // computed once to fail atomically before any generation; not otherwise reused

  const results = [];
  artifacts.forEach((artifact) => {
    try {
      results.push(...buildTestDesigns(artifact));
    } catch (err) {
      if (/^TEST_DESIGN_GENERATION_FAILED:/.test(err.message)) throw err;
      throw new Error(`TEST_DESIGN_GENERATION_FAILED: generateTestDesigns could not generate a test design for requirement "${artifact.id}" (${err.message}).`);
    }
  });
  return results;
}

module.exports = {
  generateTestDesign,
  generateTestDesigns,
};
