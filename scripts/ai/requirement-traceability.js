"use strict";

/**
 * Requirement <-> Test-Design Traceability / Coverage (Roadmap RTI-5) - the
 * first layer that maps validated RequirementArtifact[] (RTI-1) against
 * TestDesignArtifact[] (RTI-4) using only structured provenance, and
 * derives snapshot-scoped coverage from that mapping.
 *
 * OWNERSHIP BOUNDARY (no duplication of any upstream authority):
 *
 *   RTI-1 (requirement-artifact.js)  - RequirementArtifact structural validity
 *   RTI-3 (requirement-quality.js)   - requirement quality/testability
 *   RTI-4 (test-design.js)           - TestDesignArtifact generation
 *   RTI-5 (this module)              - traceability / coverage analysis only
 *
 * This module never calls analyzeRequirementQuality()/analyzeRequirementsQuality()
 * and never calls generateTestDesign()/generateTestDesigns() - coverage is a
 * STRUCTURAL fact ("is this criterion referenced by a test design?"), never
 * a semantic-quality or generation concern. A structurally valid
 * RequirementArtifact is accepted here regardless of its RTI-3 status;
 * coverage != quality.
 *
 * TWO-STAGE ARCHITECTURE - TRACEABILITY FIRST, COVERAGE DERIVED:
 *
 *   RequirementArtifact[] + TestDesignArtifact[]
 *           |
 *           v
 *   buildRequirementTraceability()   -> TraceabilityLink[]  (first-class,
 *           |                            structural, exported)
 *           v
 *   analyzeRequirementsCoverage()    -> RequirementCoverageResult[]
 *                                        (aggregated on top of the SAME
 *                                        links - never a second, independent
 *                                        mapping implementation that could
 *                                        drift from the first)
 *
 * IDENTITY MODEL (no new identity layer invented):
 *
 *   Requirement identity:               RequirementArtifact.id (RTI-1)
 *   Criterion durable identity:         acceptanceCriteria[].id, when supplied
 *   Criterion fallback identity:        criterionIndex - SNAPSHOT-SCOPED ONLY,
 *                                        the exact array position within the
 *                                        RequirementArtifact[] passed to THIS
 *                                        call; never durable across a
 *                                        revision that inserts, removes, or
 *                                        reorders acceptanceCriteria
 *   Test design snapshot identity:      TestDesignArtifact.id (RTI-4)
 *   Persistent cross-revision test id:  NOT DEFINED - not invented here
 *
 * A link resolves EITHER identity to the criterion's exact array position:
 * a `criterionId` reference is looked up against that requirement's own
 * acceptanceCriteria[].id values; a `criterionIndex` reference IS that
 * position directly. Deliberately, coverage aggregation resolves BOTH forms
 * to the same canonical array position before counting - a test design that
 * references an id-bearing criterion by its (also valid) positional index
 * counts toward that criterion's coverage exactly the same as one that used
 * the id. This is a safe, natural consequence of "durable identity when
 * supplied, positional fallback otherwise" - it does not invent any new
 * identity, it just recognizes both are valid ways to reference the SAME
 * criterion.
 *
 * SNAPSHOT SEMANTICS: this module operates on exactly one
 * RequirementArtifact[] + TestDesignArtifact[] pair supplied together in a
 * single call. Every result is valid only for that snapshot. If a
 * requirement's acceptanceCriteria are later inserted, removed, or
 * reordered, `criterionIndex`-based coverage from a prior call becomes
 * meaningless for the new snapshot - this module never reuses, migrates, or
 * infers continuity between calls. Recompute from the new snapshot; there
 * is no cross-revision matching (semantic or positional) anywhere here.
 *
 * TRUST BOUNDARY / VALIDATOR DECISION - DEFERRED (RTI-5 design report,
 * approved): unlike RequirementArtifact (validated via
 * assertValidRequirementArtifact, RTI-1's own exported authority, reused
 * here unchanged), TestDesignArtifact has no exported
 * `assertValidTestDesignArtifact` and this module does not introduce one.
 * No storage, network, or external-deserialization path for
 * TestDesignArtifact exists anywhere in this codebase yet - its only
 * realistic producer today is RTI-4's own generateTestDesign(s)(), consumed
 * in-process. This decision must be re-evaluated (and a general-purpose,
 * RTI-4-owned validator introduced) the moment TestDesignArtifact crosses an
 * actual storage/network/external-import boundary (a future RTI-6/RTI-7
 * external test import, or an RTI-8 stored/serialized round-trip).
 *
 * This deferral does NOT mean malformed input is silently trusted: every
 * TestDesignArtifact field this module actually reads (id, requirementId,
 * source, source.requirementId, source.criterionId, source.criterionIndex)
 * is read defensively via getOwnEnumerableDataProperty() - an own,
 * enumerable, data property; an accessor's getter is NEVER invoked - and
 * type/shape-checked before use. This is narrow, purpose-built field
 * validation, not a second competing schema authority for the whole
 * TestDesignArtifact contract (RTI-4 remains the one place that OWNS that
 * contract's shape).
 *
 * NO TEXT PARSING, EVER: traceability is derived exclusively from
 * `requirementId`, `source.requirementId`, `source.criterionId`, and
 * `source.criterionIndex`. `id`, `title`, `objective`, and
 * `expectedResults` are never read, inspected, or pattern-matched for
 * traceability purposes - a misleading test id (e.g.
 * "REQ-WRONG::test::999"), a misleading title, or a misleading objective
 * has zero effect on the computed traceability/coverage.
 *
 * COVERAGE SEMANTICS - STRUCTURAL, NOT ADEQUACY: "covered" means "at least
 * one TestDesignArtifact structurally references this criterion/
 * requirement" - never "this criterion is sufficiently/correctly tested".
 * No adequacy score, no coverage percentage, no quality status is computed
 * or implied here.
 *
 * Exactly three coverage statuses (a fourth, `NOT_APPLICABLE`, was
 * considered and deliberately rejected - a zero-criteria requirement's
 * coverage is a genuinely evaluable BINARY fact, not an inapplicable one):
 *
 *   FULLY_COVERED / PARTIALLY_COVERED / UNCOVERED
 *
 * ZERO-CRITERIA (content-only) REQUIREMENTS: `totalCriteria`/
 * `coveredCriteria`/`uncoveredCriteria` are always 0 in this branch and
 * carry no pass/fail meaning by themselves (deliberately avoiding the
 * "0/0 = fully covered" trap) - the actual signal is the separate
 * `requirementLevelCovered` boolean plus `requirementLevelTestIds`.
 * `PARTIALLY_COVERED` is structurally impossible here (a single boolean has
 * no partial state).
 *
 * UNMAPPED TEST DESIGNS: when a requirement HAS acceptanceCriteria but a
 * TestDesignArtifact references only the requirement (neither criterionId
 * nor criterionIndex), it counts toward NO criterion's coverage - fabricating
 * which criterion it validates would violate the same no-hallucination
 * principle RTI-3/RTI-4 already enforce. It is not silently dropped either:
 * it is surfaced in that requirement's `unmappedTestDesignIds`, so a
 * legitimate structural reference never becomes invisible.
 *
 * REFERENTIAL-INTEGRITY / DUPLICATE POLICY - FAIL CLOSED, ATOMIC, NEVER A
 * PARTIAL RESULT: the whole call rejects (never a silent skip, never a
 * best-effort partial TraceabilityLink[]/RequirementCoverageResult[]) on any
 * of:
 *
 *   - a test design referencing an unknown requirement id
 *   - `requirementId` !== `source.requirementId` on the same test design
 *     (neither field is ever treated as more authoritative than the other)
 *   - `source.criterionId` that does not exist on the target requirement
 *   - `source.criterionIndex` out of range (not clipped, not ignored)
 *   - `source.criterionId` AND `source.criterionIndex` both present on the
 *     same test design (no ambiguity resolution)
 *   - a criterion reference (`criterionId` or `criterionIndex`) on a
 *     requirement that has zero acceptanceCriteria (a nonsensical
 *     relationship)
 *   - a duplicate RequirementArtifact.id across the requirements input
 *   - a duplicate acceptanceCriteria[].id WITHIN one requirement (even
 *     though RTI-1's own structural validator permits this shape - here it
 *     would make criterion-id-based traceability genuinely ambiguous)
 *   - a duplicate TestDesignArtifact.id across the testDesigns input
 *
 * requirements MUST be a non-empty array (an empty requirements[] is
 * rejected, not silently treated as "zero coverage results"). testDesigns
 * MAY be an empty array - a perfectly valid case meaning every requirement
 * is currently UNCOVERED.
 *
 * DETERMINISTIC, ZERO AI, PURE DATA TRANSFORM: no LLM/AI calls, no network,
 * no filesystem, no environment variables, no randomness, no clock
 * dependency, no `repositoryRoot`. The same inputs always produce the same
 * TraceabilityLink[]/RequirementCoverageResult[], in the same order:
 * requirements input order for RequirementCoverageResult[], acceptanceCriteria
 * order for each result's `criteria[]`, and testDesigns input order for
 * every `testDesignIds`/`requirementLevelTestIds`/`unmappedTestDesignIds`
 * array and for TraceabilityLink[] itself - no hidden sorting anywhere.
 *
 * IMMUTABLE INPUT, FROZEN OUTPUT: neither `requirements` nor `testDesigns`
 * is ever mutated. Every level of both return values is frozen
 * (Object.freeze()) - each link, the links array; each RequirementCoverageResult,
 * its `criteria[]` and each CriterionCoverage entry, every `testDesignIds`/
 * `requirementLevelTestIds`/`unmappedTestDesignIds` array, and the outer
 * results array - complete freezing for this contract's actual (flat) shape,
 * not overclaimed.
 *
 * SOURCE / PROVIDER / DESTINATION / FRAMEWORK INDEPENDENT: never branches on
 * `requirement.source.type`/`.system`, never assumes a TestDesignArtifact
 * was produced by RTI-4 specifically (no assumption that `id` follows RTI-4's
 * own `::test::N` pattern), and contains no reference to any test-management
 * system, external requirement source, or test-automation framework. Any
 * future RTI-6/RTI-7/RTI-8 producer of RequirementArtifact/TestDesignArtifact-
 * shaped data composes unchanged, as long as it satisfies these same
 * minimal structural contracts.
 *
 * COMPLEXITY: O(R + C + T) - one Map<requirementId, RequirementArtifact>
 * built once (R), one Map<criterionId, index> built per requirement on
 * demand (total O(C) across all requirements), each test design resolved via
 * O(1) lookups (T). Internal Maps only; both public return values remain
 * plain, JSON-serializable arrays/objects.
 */

const { assertValidRequirementArtifact } = require("./requirement-artifact");

const MAX_STRING_LENGTH = 200;
const MAX_VALIDATION_DETAIL_LENGTH = 1024;
const MAX_REPORTED_ERRORS = 20;

// --- Shared primitives (deliberately duplicated, not imported - matching
// this repository's own established "small duplicated primitives over
// premature shared abstraction" convention, e.g.
// scripts/ai/requirement-artifact.js's identical copies) ---------------

function isPlainDataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isSafeBoundedString(value, maxLength) {
  return isNonEmptyString(value) && value.length <= maxLength && !hasControlChar(value);
}

// Object.getPrototypeOf/getOwnPropertyDescriptor never invoke a getter, so
// this is always safe to call, even on a hostile accessor-backed input.
// Only a `valid` result's `.value` (the descriptor's own captured value) is
// ever read afterward.
function getOwnEnumerableDataProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) {
    return { present: false, valid: false, value: undefined };
  }
  const isDataDescriptor = Object.prototype.hasOwnProperty.call(descriptor, "value");
  if (!descriptor.enumerable || !isDataDescriptor) {
    return { present: true, valid: false, value: undefined };
  }
  return { present: true, valid: true, value: descriptor.value };
}

function boundedDetail(errors) {
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const omitted = errors.length - shown.length;
  const joined = shown.join("; ") + (omitted > 0 ? `; ${omitted} additional error(s) omitted` : "");
  return joined.length <= MAX_VALIDATION_DETAIL_LENGTH ? joined : `${joined.slice(0, MAX_VALIDATION_DETAIL_LENGTH)}...`;
}

// --- Input validation -------------------------------------------------

function assertRequirementsInput(requirements, callerLabel) {
  if (requirements === undefined || requirements === null) {
    throw new Error(`TRACEABILITY_INPUT_REQUIRED: ${callerLabel} requires an explicit, non-empty array of RequirementArtifact; none was supplied.`);
  }
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new Error(`TRACEABILITY_INPUT_INVALID: ${callerLabel} requires a non-empty array of RequirementArtifact.`);
  }
  const shapeErrors = [];
  requirements.forEach((requirement, index) => {
    try {
      assertValidRequirementArtifact(requirement, callerLabel);
    } catch (err) {
      shapeErrors.push(`requirements[${index}]: ${err.message}`);
    }
  });
  if (shapeErrors.length > 0) {
    throw new Error(`TRACEABILITY_INPUT_INVALID: ${callerLabel} received invalid requirement record(s) (${boundedDetail(shapeErrors)}).`);
  }
}

// Rejects a duplicate RequirementArtifact.id across the collection, and a
// duplicate acceptanceCriteria[].id WITHIN any single requirement - see
// this module's own docstring for why the latter is enforced here even
// though RTI-1's structural validator permits that shape.
function assertNoDuplicateRequirementOrCriterionIds(requirements, callerLabel) {
  const collectionErrors = [];
  const seenRequirementIds = new Map();
  requirements.forEach((requirement, index) => {
    if (seenRequirementIds.has(requirement.id)) {
      collectionErrors.push(`requirements[${index}].id "${requirement.id}" duplicates requirements[${seenRequirementIds.get(requirement.id)}].id`);
    } else {
      seenRequirementIds.set(requirement.id, index);
    }
    if (Array.isArray(requirement.acceptanceCriteria)) {
      const seenCriterionIds = new Map();
      requirement.acceptanceCriteria.forEach((criterion, criterionIndex) => {
        const id = criterion && typeof criterion.id === "string" ? criterion.id : undefined;
        if (!id) return;
        if (seenCriterionIds.has(id)) {
          collectionErrors.push(
            `requirements[${index}] (id "${requirement.id}").acceptanceCriteria[${criterionIndex}].id "${id}" duplicates acceptanceCriteria[${seenCriterionIds.get(id)}].id`
          );
        } else {
          seenCriterionIds.set(id, criterionIndex);
        }
      });
    }
  });
  if (collectionErrors.length > 0) {
    throw new Error(`TRACEABILITY_COLLECTION_INVALID: ${callerLabel} received a requirements collection with duplicate id(s) (${boundedDetail(collectionErrors)}).`);
  }
}

function assertTestDesignsInput(testDesigns, callerLabel) {
  if (testDesigns === undefined || testDesigns === null) {
    throw new Error(`TRACEABILITY_INPUT_REQUIRED: ${callerLabel} requires an explicit array of TestDesignArtifact; none was supplied.`);
  }
  if (!Array.isArray(testDesigns)) {
    throw new Error(`TRACEABILITY_INPUT_INVALID: ${callerLabel} requires an array of TestDesignArtifact.`);
  }
}

// Narrow, purpose-built defensive read of exactly the fields this module
// consumes (see module docstring "TRUST BOUNDARY / VALIDATOR DECISION -
// DEFERRED") - NOT a general-purpose TestDesignArtifact schema validator.
// Pushes errors and returns null when a REQUIRED field (id/requirementId/
// source/source.requirementId) is malformed; an optional
// criterionId/criterionIndex malformation is also reported but does not by
// itself suppress the returned reference record, since the caller always
// checks `errors.length` before using any record.
function readTestDesignReference(design, index, errors) {
  const path = `testDesigns[${index}]`;
  if (!isPlainDataObject(design)) {
    errors.push(`${path}: must be a plain object`);
    return null;
  }

  const idField = getOwnEnumerableDataProperty(design, "id");
  const idValid = idField.valid && isSafeBoundedString(idField.value, MAX_STRING_LENGTH);
  if (!idValid) errors.push(`${path}.id: must be a non-empty, bounded own enumerable data string property`);

  const requirementIdField = getOwnEnumerableDataProperty(design, "requirementId");
  const requirementIdValid = requirementIdField.valid && isSafeBoundedString(requirementIdField.value, MAX_STRING_LENGTH);
  if (!requirementIdValid) errors.push(`${path}.requirementId: must be a non-empty, bounded own enumerable data string property`);

  const sourceField = getOwnEnumerableDataProperty(design, "source");
  if (!sourceField.valid || !isPlainDataObject(sourceField.value)) {
    errors.push(`${path}.source: must be a plain object, present as an own enumerable data property`);
    return null;
  }
  const source = sourceField.value;

  const sourceRequirementIdField = getOwnEnumerableDataProperty(source, "requirementId");
  const sourceRequirementIdValid = sourceRequirementIdField.valid && isSafeBoundedString(sourceRequirementIdField.value, MAX_STRING_LENGTH);
  if (!sourceRequirementIdValid) errors.push(`${path}.source.requirementId: must be a non-empty, bounded own enumerable data string property`);

  let criterionId;
  const criterionIdField = getOwnEnumerableDataProperty(source, "criterionId");
  if (criterionIdField.present) {
    if (!criterionIdField.valid || !isSafeBoundedString(criterionIdField.value, MAX_STRING_LENGTH)) {
      errors.push(`${path}.source.criterionId: must be a non-empty, bounded string when supplied`);
    } else {
      criterionId = criterionIdField.value;
    }
  }

  let criterionIndex;
  const criterionIndexField = getOwnEnumerableDataProperty(source, "criterionIndex");
  if (criterionIndexField.present) {
    if (!criterionIndexField.valid || !Number.isInteger(criterionIndexField.value) || criterionIndexField.value < 0) {
      errors.push(`${path}.source.criterionIndex: must be a non-negative integer when supplied`);
    } else {
      criterionIndex = criterionIndexField.value;
    }
  }

  if (!idValid || !requirementIdValid || !sourceRequirementIdValid) return null;

  return {
    index,
    id: idField.value,
    requirementId: requirementIdField.value,
    sourceRequirementId: sourceRequirementIdField.value,
    criterionId,
    criterionIndex,
  };
}

// --- Canonical traceability builder (single source of truth; both public
// APIs go through this exact function - see module docstring "TWO-STAGE
// ARCHITECTURE") --------------------------------------------------------

function buildTraceabilityLinks(requirements, testDesigns, callerLabel) {
  assertRequirementsInput(requirements, callerLabel);
  assertNoDuplicateRequirementOrCriterionIds(requirements, callerLabel);
  assertTestDesignsInput(testDesigns, callerLabel);

  const shapeErrors = [];
  const normalized = testDesigns.map((design, index) => readTestDesignReference(design, index, shapeErrors));
  if (shapeErrors.length > 0) {
    throw new Error(`TRACEABILITY_INPUT_INVALID: ${callerLabel} received invalid test design record(s) (${boundedDetail(shapeErrors)}).`);
  }

  const duplicateErrors = [];
  const seenTestDesignIds = new Map();
  normalized.forEach((ref) => {
    if (seenTestDesignIds.has(ref.id)) {
      duplicateErrors.push(`testDesigns[${ref.index}].id "${ref.id}" duplicates testDesigns[${seenTestDesignIds.get(ref.id)}].id`);
    } else {
      seenTestDesignIds.set(ref.id, ref.index);
    }
  });
  if (duplicateErrors.length > 0) {
    throw new Error(`TRACEABILITY_COLLECTION_INVALID: ${callerLabel} received a testDesigns collection with duplicate id(s) (${boundedDetail(duplicateErrors)}).`);
  }

  const requirementsById = new Map(requirements.map((requirement) => [requirement.id, requirement]));

  const referenceErrors = [];
  const links = [];
  normalized.forEach((ref) => {
    const path = `testDesigns[${ref.index}]`;

    if (ref.requirementId !== ref.sourceRequirementId) {
      referenceErrors.push(`${path}: requirementId "${ref.requirementId}" does not match source.requirementId "${ref.sourceRequirementId}"`);
      return;
    }
    const requirement = requirementsById.get(ref.requirementId);
    if (!requirement) {
      referenceErrors.push(`${path}: references unknown requirement "${ref.requirementId}"`);
      return;
    }
    if (ref.criterionId !== undefined && ref.criterionIndex !== undefined) {
      referenceErrors.push(`${path}: source.criterionId and source.criterionIndex must not both be present`);
      return;
    }

    const totalCriteria = Array.isArray(requirement.acceptanceCriteria) ? requirement.acceptanceCriteria.length : 0;

    if (ref.criterionId !== undefined) {
      if (totalCriteria === 0) {
        referenceErrors.push(`${path}: source.criterionId references requirement "${ref.requirementId}", which has no acceptanceCriteria`);
        return;
      }
      const exists = requirement.acceptanceCriteria.some((criterion) => criterion && criterion.id === ref.criterionId);
      if (!exists) {
        referenceErrors.push(`${path}: source.criterionId "${ref.criterionId}" does not exist on requirement "${ref.requirementId}"`);
        return;
      }
      links.push(Object.freeze({ requirementId: ref.requirementId, criterionId: ref.criterionId, testDesignId: ref.id }));
      return;
    }

    if (ref.criterionIndex !== undefined) {
      if (totalCriteria === 0) {
        referenceErrors.push(`${path}: source.criterionIndex references requirement "${ref.requirementId}", which has no acceptanceCriteria`);
        return;
      }
      if (ref.criterionIndex >= totalCriteria) {
        referenceErrors.push(`${path}: source.criterionIndex ${ref.criterionIndex} is out of range for requirement "${ref.requirementId}" (${totalCriteria} criteria)`);
        return;
      }
      links.push(Object.freeze({ requirementId: ref.requirementId, criterionIndex: ref.criterionIndex, testDesignId: ref.id }));
      return;
    }

    links.push(Object.freeze({ requirementId: ref.requirementId, testDesignId: ref.id }));
  });

  if (referenceErrors.length > 0) {
    throw new Error(`TRACEABILITY_INCONSISTENT_REFERENCE: ${callerLabel} found inconsistent requirement/test-design reference(s) (${boundedDetail(referenceErrors)}).`);
  }

  return Object.freeze(links);
}

/**
 * Builds TraceabilityLink[] mapping TestDesignArtifact[] to the
 * RequirementArtifact[]/acceptanceCriteria they structurally reference, in
 * `testDesigns` input order. See this module's own docstring for the full
 * identity/snapshot/trust-boundary/fail-closed contract.
 *
 * @param {object[]} requirements RequirementArtifact[] (non-empty)
 * @param {object[]} testDesigns TestDesignArtifact[] (may be empty)
 * @returns {object[]} TraceabilityLink[] - each `{ requirementId,
 *   criterionId?, criterionIndex?, testDesignId }`, frozen, in testDesigns
 *   input order
 */
function buildRequirementTraceability(requirements, testDesigns) {
  return buildTraceabilityLinks(requirements, testDesigns, "buildRequirementTraceability");
}

/**
 * Analyzes structural requirement <-> test-design coverage, derived from
 * buildRequirementTraceability()'s own canonical links - never an
 * independent second mapping implementation. See this module's own
 * docstring for the full coverage-status/zero-criteria/unmapped-design
 * contract.
 *
 * @param {object[]} requirements RequirementArtifact[] (non-empty)
 * @param {object[]} testDesigns TestDesignArtifact[] (may be empty)
 * @returns {object[]} RequirementCoverageResult[], in requirements input
 *   order, frozen at every level
 */
function analyzeRequirementsCoverage(requirements, testDesigns) {
  const links = buildTraceabilityLinks(requirements, testDesigns, "analyzeRequirementsCoverage");

  const linksByRequirement = new Map();
  links.forEach((link) => {
    if (!linksByRequirement.has(link.requirementId)) linksByRequirement.set(link.requirementId, []);
    linksByRequirement.get(link.requirementId).push(link);
  });

  const results = requirements.map((requirement) => {
    const requirementLinks = linksByRequirement.get(requirement.id) || [];
    const totalCriteria = Array.isArray(requirement.acceptanceCriteria) ? requirement.acceptanceCriteria.length : 0;

    if (totalCriteria === 0) {
      const requirementLevelTestIds = requirementLinks
        .filter((link) => link.criterionId === undefined && link.criterionIndex === undefined)
        .map((link) => link.testDesignId);
      const requirementLevelCovered = requirementLevelTestIds.length > 0;
      return Object.freeze({
        requirementId: requirement.id,
        status: requirementLevelCovered ? "FULLY_COVERED" : "UNCOVERED",
        totalCriteria: 0,
        coveredCriteria: 0,
        uncoveredCriteria: 0,
        criteria: Object.freeze([]),
        requirementLevelCovered,
        requirementLevelTestIds: Object.freeze(requirementLevelTestIds),
        unmappedTestDesignIds: Object.freeze([]),
      });
    }

    // Resolve every criterion-referencing link to its exact array position -
    // see module docstring on why an id-based and an index-based reference
    // to the SAME criterion both count toward that one criterion's coverage.
    const idToIndex = new Map();
    requirement.acceptanceCriteria.forEach((criterion, position) => {
      if (criterion && typeof criterion.id === "string" && criterion.id.length > 0) {
        idToIndex.set(criterion.id, position);
      }
    });

    const testIdsByPosition = new Map();
    const unmappedTestDesignIds = [];
    requirementLinks.forEach((link) => {
      let position;
      if (link.criterionId !== undefined) {
        position = idToIndex.get(link.criterionId);
      } else if (link.criterionIndex !== undefined) {
        position = link.criterionIndex;
      } else {
        unmappedTestDesignIds.push(link.testDesignId);
        return;
      }
      if (!testIdsByPosition.has(position)) testIdsByPosition.set(position, []);
      testIdsByPosition.get(position).push(link.testDesignId);
    });

    let coveredCriteria = 0;
    const criteria = requirement.acceptanceCriteria.map((criterion, position) => {
      const testDesignIds = testIdsByPosition.get(position) || [];
      const covered = testDesignIds.length > 0;
      if (covered) coveredCriteria += 1;
      const hasId = criterion && typeof criterion.id === "string" && criterion.id.length > 0;
      return Object.freeze(
        hasId
          ? { criterionId: criterion.id, covered, testDesignIds: Object.freeze(testDesignIds) }
          : { criterionIndex: position, covered, testDesignIds: Object.freeze(testDesignIds) }
      );
    });

    const uncoveredCriteria = totalCriteria - coveredCriteria;
    const status = coveredCriteria === totalCriteria ? "FULLY_COVERED" : coveredCriteria === 0 ? "UNCOVERED" : "PARTIALLY_COVERED";

    return Object.freeze({
      requirementId: requirement.id,
      status,
      totalCriteria,
      coveredCriteria,
      uncoveredCriteria,
      criteria: Object.freeze(criteria),
      unmappedTestDesignIds: Object.freeze(unmappedTestDesignIds),
    });
  });

  return Object.freeze(results);
}

module.exports = {
  buildRequirementTraceability,
  analyzeRequirementsCoverage,
};
