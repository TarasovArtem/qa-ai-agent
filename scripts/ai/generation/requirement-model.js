/**
 * RequirementModel v1 (Roadmap #22/23-F0).
 *
 * A RequirementModel represents GROUNDED requirements, their provenance,
 * and the explicit gaps around them (assumptions, open questions) - never
 * generated tests, automation recommendations, or implementation plans
 * (those are TestCaseModel/AutomationCandidate/AutomationPlan, see the
 * sibling modules in this directory).
 *
 * Core anti-hallucination invariant: every requirement must cite at least
 * one evidence/source reference that actually exists in this model's own
 * `evidenceRefs` registry - a "grounded requirement" with zero provenance,
 * or with a dangling reference id, fails validation. Unspecified behavior
 * must never be smuggled in as a requirement with invented provenance -
 * the contract instead offers `assumptions` and `openQuestions`
 * (types OPEN_QUESTION / AMBIGUITY / MISSING_REQUIREMENT) as the only
 * legitimate way to represent a gap.
 */

"use strict";

const { LIMITS } = require("./limits");
const { ERROR_CODES, err, ok, fail } = require("./errors");
const {
  isPlainObject,
  isBoundedText,
  collectIdError,
  collectUnknownKeyErrors,
  collectDuplicateIdErrors,
  validateSchemaVersion,
  validateKind,
  validateProjectId,
  validateEvidenceRef,
  validateAssumption,
  validateOpenQuestion,
} = require("./primitives");

const KIND = "RequirementModel";

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "id",
  "projectId",
  "evidenceRefs",
  "requirements",
  "assumptions",
  "openQuestions",
]);

const REQUIREMENT_ALLOWED_KEYS = Object.freeze(["id", "text", "evidenceRefIds"]);

function validateRequirement(requirement, path, errors, evidenceRefIds) {
  if (!isPlainObject(requirement)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(requirement, REQUIREMENT_ALLOWED_KEYS, path, errors);
  collectIdError(requirement.id, `${path}.id`, errors);

  if (!isBoundedText(requirement.text, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.text`, ERROR_CODES.INVALID_TYPE, `${path}.text must be a bounded, non-empty string`));
  }

  // B3/B5: the core grounding invariant - at least one evidence reference,
  // and every cited id must resolve inside this model's own evidenceRefs
  // registry. No fallback, no best-effort resolution: a dangling id fails
  // closed, exactly like every other cross-reference in this foundation.
  if (!Array.isArray(requirement.evidenceRefIds) || requirement.evidenceRefIds.length === 0) {
    errors.push(
      err(
        `${path}.evidenceRefIds`,
        ERROR_CODES.MISSING_FIELD,
        `${path}.evidenceRefIds must be a non-empty array - a grounded requirement must cite at least one evidence reference`
      )
    );
  } else if (requirement.evidenceRefIds.length > LIMITS.MAX_EVIDENCE_REFS) {
    errors.push(err(`${path}.evidenceRefIds`, ERROR_CODES.INVALID_VALUE, `${path}.evidenceRefIds exceeds the maximum of ${LIMITS.MAX_EVIDENCE_REFS}`));
  } else {
    requirement.evidenceRefIds.forEach((refId, i) => {
      if (!collectIdError(refId, `${path}.evidenceRefIds[${i}]`, errors)) return;
      if (!evidenceRefIds.has(refId)) {
        errors.push(err(`${path}.evidenceRefIds[${i}]`, ERROR_CODES.INVALID_REFERENCE, `${path}.evidenceRefIds[${i}] "${refId}" does not exist in evidenceRefs`));
      }
    });
  }
}

// `options.expectedProjectId`, when supplied, enforces A2 project
// isolation: `model.projectId` must match it exactly.
function validateRequirementModel(model, { expectedProjectId } = {}) {
  const errors = [];

  if (!isPlainObject(model)) {
    return fail([err("$", ERROR_CODES.INVALID_TYPE, "RequirementModel must be a plain object")]);
  }

  collectUnknownKeyErrors(model, TOP_LEVEL_ALLOWED_KEYS, "$", errors);
  validateSchemaVersion(model.schemaVersion, "$.schemaVersion", errors);
  validateKind(model.kind, KIND, "$.kind", errors);
  collectIdError(model.id, "$.id", errors);
  validateProjectId(model.projectId, "$.projectId", errors, { expectedProjectId });

  const evidenceRefIds = new Set();
  if (!Array.isArray(model.evidenceRefs)) {
    errors.push(err("$.evidenceRefs", ERROR_CODES.MISSING_FIELD, "$.evidenceRefs must be an array"));
  } else if (model.evidenceRefs.length > LIMITS.MAX_EVIDENCE_REFS) {
    errors.push(err("$.evidenceRefs", ERROR_CODES.INVALID_VALUE, `$.evidenceRefs exceeds the maximum of ${LIMITS.MAX_EVIDENCE_REFS}`));
  } else {
    model.evidenceRefs.forEach((ref, i) => validateEvidenceRef(ref, `$.evidenceRefs[${i}]`, errors));
    collectDuplicateIdErrors(model.evidenceRefs, "id", "$.evidenceRefs", errors);
    for (const ref of model.evidenceRefs) {
      if (ref && typeof ref === "object" && typeof ref.id === "string") evidenceRefIds.add(ref.id);
    }
  }

  if (!Array.isArray(model.requirements) || model.requirements.length === 0) {
    errors.push(err("$.requirements", ERROR_CODES.MISSING_FIELD, "$.requirements must be a non-empty array"));
  } else if (model.requirements.length > LIMITS.MAX_REQUIREMENTS) {
    errors.push(err("$.requirements", ERROR_CODES.INVALID_VALUE, `$.requirements exceeds the maximum of ${LIMITS.MAX_REQUIREMENTS}`));
  } else {
    model.requirements.forEach((r, i) => validateRequirement(r, `$.requirements[${i}]`, errors, evidenceRefIds));
    collectDuplicateIdErrors(model.requirements, "id", "$.requirements", errors);
  }

  // Required top-level fields, but a genuinely empty array is a legitimate
  // state (e.g. "no assumptions were needed for this requirement set") -
  // this is different from being absent entirely.
  if (!Array.isArray(model.assumptions)) {
    errors.push(err("$.assumptions", ERROR_CODES.MISSING_FIELD, "$.assumptions must be an array (use an empty array when there are none)"));
  } else if (model.assumptions.length > LIMITS.MAX_ASSUMPTIONS) {
    errors.push(err("$.assumptions", ERROR_CODES.INVALID_VALUE, `$.assumptions exceeds the maximum of ${LIMITS.MAX_ASSUMPTIONS}`));
  } else {
    model.assumptions.forEach((a, i) => validateAssumption(a, `$.assumptions[${i}]`, errors));
    collectDuplicateIdErrors(model.assumptions, "id", "$.assumptions", errors);
  }

  if (!Array.isArray(model.openQuestions)) {
    errors.push(err("$.openQuestions", ERROR_CODES.MISSING_FIELD, "$.openQuestions must be an array (use an empty array when there are none)"));
  } else if (model.openQuestions.length > LIMITS.MAX_OPEN_QUESTIONS) {
    errors.push(err("$.openQuestions", ERROR_CODES.INVALID_VALUE, `$.openQuestions exceeds the maximum of ${LIMITS.MAX_OPEN_QUESTIONS}`));
  } else {
    model.openQuestions.forEach((q, i) => validateOpenQuestion(q, `$.openQuestions[${i}]`, errors));
    collectDuplicateIdErrors(model.openQuestions, "id", "$.openQuestions", errors);
  }

  return errors.length === 0 ? ok() : fail(errors);
}

module.exports = { KIND, validateRequirementModel };
