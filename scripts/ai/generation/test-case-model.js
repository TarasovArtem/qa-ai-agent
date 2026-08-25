/**
 * TestCaseModel v1 (Roadmap #22/23-F0).
 *
 * A TestCaseModel represents human-readable LOGICAL test cases derived from
 * one RequirementModel - never automation code, selectors, repository write
 * operations, branch information, or PR information (those belong to
 * AutomationCandidate/AutomationPlan downstream).
 *
 * Core anti-hallucination invariant: a real test case must reference at
 * least one requirement (C3), and every step's claimed expected result must
 * itself be grounded in one or more of that test case's own declared
 * requirement ids (C2) - a step can never claim grounding in a requirement
 * its parent test case never declared. This module never resolves those
 * requirement ids against an actual RequirementModel object (it has none);
 * that cross-model resolution is cross-model-validation.js's job (F3).
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
} = require("./primitives");

const KIND = "TestCaseModel";

// Bounded v1 priority vocabulary (C5) - deliberately a canonical level +
// rationale + grounding, never an ungrounded numeric "AI confidence" score.
const PRIORITY_LEVELS = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze(["schemaVersion", "kind", "id", "projectId", "requirementModelId", "testCases"]);
const TEST_CASE_ALLOWED_KEYS = Object.freeze(["id", "title", "objective", "requirementIds", "preconditions", "steps", "priority"]);
const STEP_ALLOWED_KEYS = Object.freeze(["action", "expectedResult", "requirementIds"]);
const PRIORITY_ALLOWED_KEYS = Object.freeze(["level", "rationale", "requirementIds"]);

// Validates `value` as an array of bounded requirement-id strings. Returns
// only the entries that were themselves individually valid ids, so a
// caller can still safely cross-check them against a grounding set even
// when some entries were malformed (each malformed entry already got its
// own INVALID_TYPE error here).
function collectRequirementIdList(value, path, errors, { allowEmpty }) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > LIMITS.MAX_RELATED_IDS) {
    errors.push(
      err(
        path,
        allowEmpty ? ERROR_CODES.INVALID_TYPE : ERROR_CODES.MISSING_FIELD,
        `${path} must be ${allowEmpty ? "an" : "a non-empty"} array of at most ${LIMITS.MAX_RELATED_IDS} requirement ids`
      )
    );
    return [];
  }
  const valid = [];
  value.forEach((id, i) => {
    if (collectIdError(id, `${path}[${i}]`, errors)) valid.push(id);
  });
  return valid;
}

function validateStep(step, path, errors, testCaseRequirementIds) {
  if (!isPlainObject(step)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(step, STEP_ALLOWED_KEYS, path, errors);

  if (!isBoundedText(step.action, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.action`, ERROR_CODES.INVALID_TYPE, `${path}.action must be a bounded, non-empty string`));
  }
  if (!isBoundedText(step.expectedResult, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.expectedResult`, ERROR_CODES.INVALID_TYPE, `${path}.expectedResult must be a bounded, non-empty string`));
  }

  // C2/C3: the claimed expected result must be grounded, and every
  // grounding id must be one this test case itself already declared.
  const stepReqIds = collectRequirementIdList(step.requirementIds, `${path}.requirementIds`, errors, { allowEmpty: false });
  stepReqIds.forEach((reqId, i) => {
    if (!testCaseRequirementIds.has(reqId)) {
      errors.push(
        err(`${path}.requirementIds[${i}]`, ERROR_CODES.INVALID_REFERENCE, `${path}.requirementIds[${i}] "${reqId}" is not declared in this test case's own requirementIds`)
      );
    }
  });
}

function validatePriority(priority, path, errors, testCaseRequirementIds) {
  if (priority === undefined) return; // optional (C5)
  if (!isPlainObject(priority)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(priority, PRIORITY_ALLOWED_KEYS, path, errors);

  if (!PRIORITY_LEVELS.includes(priority.level)) {
    errors.push(err(`${path}.level`, ERROR_CODES.INVALID_ENUM, `${path}.level must be one of ${PRIORITY_LEVELS.join(", ")}`));
  }
  if (!isBoundedText(priority.rationale, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.rationale`, ERROR_CODES.INVALID_TYPE, `${path}.rationale must be a bounded, non-empty string`));
  }

  const ids = collectRequirementIdList(priority.requirementIds, `${path}.requirementIds`, errors, { allowEmpty: false });
  ids.forEach((reqId, i) => {
    if (!testCaseRequirementIds.has(reqId)) {
      errors.push(
        err(`${path}.requirementIds[${i}]`, ERROR_CODES.INVALID_REFERENCE, `${path}.requirementIds[${i}] "${reqId}" is not declared in this test case's own requirementIds`)
      );
    }
  });
}

function validateTestCase(testCase, path, errors) {
  if (!isPlainObject(testCase)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(testCase, TEST_CASE_ALLOWED_KEYS, path, errors);
  collectIdError(testCase.id, `${path}.id`, errors);

  if (!isBoundedText(testCase.title, LIMITS.SHORT_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.title`, ERROR_CODES.INVALID_TYPE, `${path}.title must be a bounded, non-empty string`));
  }
  if (!isBoundedText(testCase.objective, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.objective`, ERROR_CODES.INVALID_TYPE, `${path}.objective must be a bounded, non-empty string`));
  }

  // C3: a real test case must reference at least one grounded requirement.
  const requirementIds = collectRequirementIdList(testCase.requirementIds, `${path}.requirementIds`, errors, { allowEmpty: false });
  const requirementIdSet = new Set(requirementIds);

  if (testCase.preconditions !== undefined) {
    if (!Array.isArray(testCase.preconditions) || testCase.preconditions.length > LIMITS.MAX_TEST_STEPS) {
      errors.push(err(`${path}.preconditions`, ERROR_CODES.INVALID_TYPE, `${path}.preconditions must be an array of at most ${LIMITS.MAX_TEST_STEPS} bounded strings`));
    } else {
      testCase.preconditions.forEach((p, i) => {
        if (!isBoundedText(p, LIMITS.SHORT_TEXT_MAX_LENGTH)) {
          errors.push(err(`${path}.preconditions[${i}]`, ERROR_CODES.INVALID_TYPE, `${path}.preconditions[${i}] must be a bounded, non-empty string`));
        }
      });
    }
  }

  if (!Array.isArray(testCase.steps) || testCase.steps.length === 0) {
    errors.push(err(`${path}.steps`, ERROR_CODES.MISSING_FIELD, `${path}.steps must be a non-empty array`));
  } else if (testCase.steps.length > LIMITS.MAX_TEST_STEPS) {
    errors.push(err(`${path}.steps`, ERROR_CODES.INVALID_VALUE, `${path}.steps exceeds the maximum of ${LIMITS.MAX_TEST_STEPS}`));
  } else {
    testCase.steps.forEach((step, i) => validateStep(step, `${path}.steps[${i}]`, errors, requirementIdSet));
  }

  validatePriority(testCase.priority, `${path}.priority`, errors, requirementIdSet);
}

function validateTestCaseModel(model, { expectedProjectId } = {}) {
  const errors = [];
  if (!isPlainObject(model)) {
    return fail([err("$", ERROR_CODES.INVALID_TYPE, "TestCaseModel must be a plain object")]);
  }

  collectUnknownKeyErrors(model, TOP_LEVEL_ALLOWED_KEYS, "$", errors);
  validateSchemaVersion(model.schemaVersion, "$.schemaVersion", errors);
  validateKind(model.kind, KIND, "$.kind", errors);
  collectIdError(model.id, "$.id", errors);
  validateProjectId(model.projectId, "$.projectId", errors, { expectedProjectId });
  collectIdError(model.requirementModelId, "$.requirementModelId", errors);

  if (!Array.isArray(model.testCases) || model.testCases.length === 0) {
    errors.push(err("$.testCases", ERROR_CODES.MISSING_FIELD, "$.testCases must be a non-empty array"));
  } else if (model.testCases.length > LIMITS.MAX_TEST_CASES) {
    errors.push(err("$.testCases", ERROR_CODES.INVALID_VALUE, `$.testCases exceeds the maximum of ${LIMITS.MAX_TEST_CASES}`));
  } else {
    model.testCases.forEach((tc, i) => validateTestCase(tc, `$.testCases[${i}]`, errors));
    collectDuplicateIdErrors(model.testCases, "id", "$.testCases", errors);
  }

  return errors.length === 0 ? ok() : fail(errors);
}

module.exports = { KIND, PRIORITY_LEVELS, validateTestCaseModel };
