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
 * VALIDATOR EXPORT - ACTIVATED BY RTI-8 (this module's own prior deferral,
 * now resolved): the original MVP deliberately shipped with no exported
 * `assertValidTestDesignArtifact`, reasoning that TestDesignArtifact was
 * never externally-authored untrusted input - only ever produced by this
 * module's own deterministic construction, in process, immediately
 * consumed - and that no concrete external caller existed yet to prove the
 * actual shape needed. That deferral explicitly named its own
 * re-evaluation trigger (see requirement-traceability.js's own identical
 * trigger language): "the moment TestDesignArtifact crosses an actual
 * storage/network/external-import boundary (... or an RTI-8 stored/
 * serialized round-trip)". Roadmap RTI-8 (publishing generated test
 * designs to an external destination) is exactly that trigger -
 * `assertValidTestDesignArtifact` below is RTI-4-owned (this module remains
 * the one place that owns the TestDesignArtifact contract's shape) and is
 * additive: `generateTestDesign`/`generateTestDesigns`'s own behavior and
 * output shape are completely unchanged by its addition.
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

// --- assertValidTestDesignArtifact (RTI-8 activation - see module docstring
// above) - shared primitives deliberately duplicated, not imported, matching
// this repository's established "small duplicated primitives over premature
// shared abstraction" convention (identical copies already exist in
// requirement-artifact.js, requirement-traceability.js,
// requirements-source-provider.js). ---------------------------------------

const TD_MAX_STRING_LENGTH = 200; // requirementId, source.requirementId, source.criterionId
// id/title are generator-composed from a requirement's own <=200-char id/
// title plus a fixed "::test::<ordinal>"/" — AC <ordinal>" suffix (ordinal
// bounded by RTI-1's own MAX_ARRAY_LENGTH=200 acceptanceCriteria cap) - a
// tight 200-char bound would reject the generator's own legitimate output.
const TD_MAX_ID_LENGTH = 256;
const TD_MAX_TITLE_LENGTH = 256;
// objective/expectedResults entries are generator-composed from a
// requirement's own <=20000-char content/criterion text (plus a fixed
// "Verify that: " prefix for objective) - sized with headroom above 20000.
const TD_MAX_PROSE_LENGTH = 20100;
const TD_MAX_ARRAY_LENGTH = 200;

const TD_ARTIFACT_ALLOWED_KEYS = Object.freeze(["id", "requirementId", "title", "objective", "expectedResults", "source"]);
const TD_SOURCE_ALLOWED_KEYS = Object.freeze(["requirementId", "criterionId", "criterionIndex"]);

function tdIsPlainDataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function tdIsNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function tdHasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function tdIsSafeBoundedString(value, maxLength) {
  return tdIsNonEmptyString(value) && value.length <= maxLength && !tdHasControlChar(value);
}

function tdIsNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// Object.getOwnPropertyDescriptor() never invokes a getter - matching
// requirement-artifact.js's own getOwnEnumerableDataProperty() exactly, so
// an accessor-backed or inherited value is never trusted and an accessor's
// getter is never invoked on this untrusted-data boundary.
function tdGetOwnEnumerableDataProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return { present: false, valid: false, value: undefined };
  const isDataDescriptor = Object.prototype.hasOwnProperty.call(descriptor, "value");
  if (!descriptor.enumerable || !isDataDescriptor) return { present: true, valid: false, value: undefined };
  return { present: true, valid: true, value: descriptor.value };
}

function tdPushUnknownKeyErrors(object, allowedKeys, errors, describe) {
  const unknown = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  for (const key of unknown) errors.push(describe(key));
}

function validateTestDesignSource(source, requirementId, errors, path) {
  if (!tdIsPlainDataObject(source)) {
    errors.push(`${path}.source: must be a plain object`);
    return;
  }
  tdPushUnknownKeyErrors(source, TD_SOURCE_ALLOWED_KEYS, errors, (key) => `${path}.source.${key}: unknown key is not permitted`);

  const srcRequirementIdField = tdGetOwnEnumerableDataProperty(source, "requirementId");
  if (!srcRequirementIdField.valid || !tdIsSafeBoundedString(srcRequirementIdField.value, TD_MAX_STRING_LENGTH)) {
    errors.push(`${path}.source.requirementId: must be a non-empty, bounded own enumerable data string property`);
  } else if (srcRequirementIdField.value !== requirementId) {
    errors.push(`${path}.source.requirementId: must equal ${path}.requirementId (source/top-level requirement identity must never disagree)`);
  }

  const criterionIdField = tdGetOwnEnumerableDataProperty(source, "criterionId");
  const hasCriterionId = criterionIdField.present;
  if (hasCriterionId) {
    if (!criterionIdField.valid || !tdIsSafeBoundedString(criterionIdField.value, TD_MAX_STRING_LENGTH)) {
      errors.push(`${path}.source.criterionId: must be a non-empty, bounded string when supplied`);
    }
  }

  const criterionIndexField = tdGetOwnEnumerableDataProperty(source, "criterionIndex");
  const hasCriterionIndex = criterionIndexField.present;
  if (hasCriterionIndex) {
    if (!criterionIndexField.valid || !tdIsNonNegativeInteger(criterionIndexField.value)) {
      errors.push(`${path}.source.criterionIndex: must be a non-negative integer when supplied`);
    }
  }

  // Mirrors RTI-5's own identical rejection: a criterion reference must be
  // unambiguous - the generator itself never emits both on one artifact.
  if (hasCriterionId && hasCriterionIndex) {
    errors.push(`${path}.source: criterionId and criterionIndex must not both be present (ambiguous criterion reference)`);
  }
}

function validateTestDesignArtifact(artifact) {
  const errors = [];
  const path = "artifact";

  if (!tdIsPlainDataObject(artifact)) {
    return { valid: false, errors: [`${path} must be a plain, JSON-like object`] };
  }

  tdPushUnknownKeyErrors(artifact, TD_ARTIFACT_ALLOWED_KEYS, errors, (key) => `unknown key "${key}" is not permitted`);

  const idField = tdGetOwnEnumerableDataProperty(artifact, "id");
  if (!idField.valid || !tdIsSafeBoundedString(idField.value, TD_MAX_ID_LENGTH)) {
    errors.push(`${path}.id: must be a non-empty, bounded own enumerable data string property`);
  }

  const requirementIdField = tdGetOwnEnumerableDataProperty(artifact, "requirementId");
  let requirementIdValue;
  if (!requirementIdField.valid || !tdIsSafeBoundedString(requirementIdField.value, TD_MAX_STRING_LENGTH)) {
    errors.push(`${path}.requirementId: must be a non-empty, bounded own enumerable data string property`);
  } else {
    requirementIdValue = requirementIdField.value;
  }

  const titleField = tdGetOwnEnumerableDataProperty(artifact, "title");
  if (!titleField.valid || !tdIsSafeBoundedString(titleField.value, TD_MAX_TITLE_LENGTH)) {
    errors.push(`${path}.title: must be a non-empty, bounded own enumerable data string property`);
  }

  const objectiveField = tdGetOwnEnumerableDataProperty(artifact, "objective");
  if (!objectiveField.valid || !tdIsSafeBoundedString(objectiveField.value, TD_MAX_PROSE_LENGTH)) {
    errors.push(`${path}.objective: must be a non-empty, bounded own enumerable data string property`);
  }

  const expectedResultsField = tdGetOwnEnumerableDataProperty(artifact, "expectedResults");
  if (!expectedResultsField.valid) {
    errors.push(`${path}.expectedResults: must be an own enumerable data property`);
  } else {
    const value = expectedResultsField.value;
    if (!Array.isArray(value) || value.length === 0 || value.length > TD_MAX_ARRAY_LENGTH) {
      errors.push(`${path}.expectedResults: must be a non-empty array (max ${TD_MAX_ARRAY_LENGTH} entries)`);
    } else if (!value.every((entry) => tdIsSafeBoundedString(entry, TD_MAX_PROSE_LENGTH))) {
      errors.push(`${path}.expectedResults: every entry must be a non-empty, bounded string`);
    }
  }

  const sourceField = tdGetOwnEnumerableDataProperty(artifact, "source");
  if (!sourceField.valid) {
    errors.push(`${path}.source: must be an own enumerable data property`);
  } else {
    validateTestDesignSource(sourceField.value, requirementIdValue, errors, path);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Fail-closed structural validator for a TestDesignArtifact - the RTI-8
 * activation of this module's own previously-deferred decision (see module
 * docstring). Every field is read via own-enumerable-data-property access
 * only; an accessor's getter is never invoked. Never mutates `artifact`.
 *
 * @param {object} artifact a candidate TestDesignArtifact
 * @param {string} callerLabel identifies the calling module/function in
 *   thrown error messages
 * @returns {object} the same `artifact` reference, unchanged
 * @throws {Error} TEST_DESIGN_ARTIFACT_REQUIRED / TEST_DESIGN_ARTIFACT_INVALID
 */
function assertValidTestDesignArtifact(artifact, callerLabel) {
  if (artifact === undefined || artifact === null) {
    throw new Error(`TEST_DESIGN_ARTIFACT_REQUIRED: ${callerLabel} requires an explicit TestDesignArtifact; none was supplied.`);
  }
  const { valid, errors } = validateTestDesignArtifact(artifact);
  if (!valid) {
    throw new Error(`TEST_DESIGN_ARTIFACT_INVALID: ${callerLabel} received an invalid TestDesignArtifact (${boundedDetail(errors)}).`);
  }
  return artifact;
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
  assertValidTestDesignArtifact,
};
