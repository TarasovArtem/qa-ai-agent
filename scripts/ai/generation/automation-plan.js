/**
 * AutomationPlan v1 (Roadmap #22/23-F0).
 *
 * An AutomationPlan is a NON-MUTATING, descriptive proposed implementation
 * plan for one AutomationCandidate - never generated code, a patch blob, or
 * an `apply()`/filesystem-writer method. It describes bounded repository
 * changes (CREATE/MODIFY only - no DELETE, which no current roadmap
 * requirement needs) to safe, repository-relative paths, each with a
 * human-readable purpose, plus an optional list of intended (not executed)
 * validation steps. A future #23 stage will implement dry-run/apply policy
 * separately - this module performs ZERO filesystem access.
 */

"use strict";

const { LIMITS } = require("./limits");
const { ERROR_CODES, err, ok, fail } = require("./errors");
const {
  SUPPORTED_FRAMEWORKS,
  isPlainObject,
  isBoundedText,
  hasIdControlChars,
  collectIdError,
  collectUnknownKeyErrors,
  validateSchemaVersion,
  validateKind,
  validateProjectId,
} = require("./primitives");
// Roadmap #22/23-F0 (E3): reuses context-utils.js's existing, already-
// tested, framework-neutral path classifier rather than introducing a
// second, weaker one. classifyPathString() is a pure string classification
// - it never touches the filesystem - matching this module's own "planned
// path string only, zero repository mutation" contract.
const { classifyPathString, PATH_KIND } = require("../context-utils");

const KIND = "AutomationPlan";

// E2: only CREATE/MODIFY - DELETE is deliberately not supported (no current
// roadmap requirement needs it).
const OPERATIONS = Object.freeze(["CREATE", "MODIFY"]);

// E5: plan descriptions only - F0 never executes any of these.
const VALIDATION_STEP_TYPES = Object.freeze(["STATIC", "UNIT", "BROWSER", "REVIEW"]);

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "id",
  "projectId",
  "automationCandidateId",
  "framework",
  "plannedChanges",
  "validationPlan",
]);
const PLANNED_CHANGE_ALLOWED_KEYS = Object.freeze(["path", "operation", "purpose"]);
const VALIDATION_STEP_ALLOWED_KEYS = Object.freeze(["type", "description"]);

// E3: only a SAFE_RELATIVE classification is ever accepted for a planned
// repository path - every other classification (POSIX/Windows-drive/UNC
// absolute, URL-like/file: scheme, traversal, or an unrecognizable/invalid
// string) is rejected. Also rejects control characters, which
// classifyPathString() itself does not check (it only classifies path
// *shape*, not character content).
function isSafeRepoRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (hasIdControlChars(value)) return false;
  return classifyPathString(value) === PATH_KIND.SAFE_RELATIVE;
}

function validatePlannedChange(change, path, errors) {
  if (!isPlainObject(change)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(change, PLANNED_CHANGE_ALLOWED_KEYS, path, errors);

  if (typeof change.path !== "string" || change.path.length === 0) {
    errors.push(err(`${path}.path`, ERROR_CODES.MISSING_FIELD, `${path}.path is required`));
  } else if (change.path.length > LIMITS.SHORT_TEXT_MAX_LENGTH) {
    errors.push(err(`${path}.path`, ERROR_CODES.INVALID_PATH, `${path}.path exceeds the maximum length`));
  } else if (!isSafeRepoRelativePath(change.path)) {
    errors.push(err(`${path}.path`, ERROR_CODES.INVALID_PATH, `${path}.path must be a safe, repository-relative path`));
  }

  if (!OPERATIONS.includes(change.operation)) {
    errors.push(err(`${path}.operation`, ERROR_CODES.INVALID_ENUM, `${path}.operation must be one of ${OPERATIONS.join(", ")}`));
  }

  if (!isBoundedText(change.purpose, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.purpose`, ERROR_CODES.INVALID_TYPE, `${path}.purpose must be a bounded, non-empty string`));
  }
}

function validateValidationStep(step, path, errors) {
  if (!isPlainObject(step)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(step, VALIDATION_STEP_ALLOWED_KEYS, path, errors);
  if (!VALIDATION_STEP_TYPES.includes(step.type)) {
    errors.push(err(`${path}.type`, ERROR_CODES.INVALID_ENUM, `${path}.type must be one of ${VALIDATION_STEP_TYPES.join(", ")}`));
  }
  if (!isBoundedText(step.description, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.description`, ERROR_CODES.INVALID_TYPE, `${path}.description must be a bounded, non-empty string`));
  }
}

function validateAutomationPlan(plan, { expectedProjectId } = {}) {
  const errors = [];
  if (!isPlainObject(plan)) {
    return fail([err("$", ERROR_CODES.INVALID_TYPE, "AutomationPlan must be a plain object")]);
  }

  collectUnknownKeyErrors(plan, TOP_LEVEL_ALLOWED_KEYS, "$", errors);
  validateSchemaVersion(plan.schemaVersion, "$.schemaVersion", errors);
  validateKind(plan.kind, KIND, "$.kind", errors);
  collectIdError(plan.id, "$.id", errors);
  validateProjectId(plan.projectId, "$.projectId", errors, { expectedProjectId });
  collectIdError(plan.automationCandidateId, "$.automationCandidateId", errors);

  if (!SUPPORTED_FRAMEWORKS.includes(plan.framework)) {
    errors.push(err("$.framework", ERROR_CODES.INVALID_ENUM, `$.framework must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
  }

  if (!Array.isArray(plan.plannedChanges) || plan.plannedChanges.length === 0) {
    errors.push(err("$.plannedChanges", ERROR_CODES.MISSING_FIELD, "$.plannedChanges must be a non-empty array"));
  } else if (plan.plannedChanges.length > LIMITS.MAX_PLANNED_CHANGES) {
    errors.push(err("$.plannedChanges", ERROR_CODES.INVALID_VALUE, `$.plannedChanges exceeds the maximum of ${LIMITS.MAX_PLANNED_CHANGES}`));
  } else {
    plan.plannedChanges.forEach((c, i) => validatePlannedChange(c, `$.plannedChanges[${i}]`, errors));
  }

  if (plan.validationPlan !== undefined) {
    if (!Array.isArray(plan.validationPlan) || plan.validationPlan.length > LIMITS.MAX_VALIDATION_STEPS) {
      errors.push(err("$.validationPlan", ERROR_CODES.INVALID_TYPE, `$.validationPlan must be an array of at most ${LIMITS.MAX_VALIDATION_STEPS} items`));
    } else {
      plan.validationPlan.forEach((s, i) => validateValidationStep(s, `$.validationPlan[${i}]`, errors));
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

module.exports = { KIND, OPERATIONS, VALIDATION_STEP_TYPES, isSafeRepoRelativePath, validateAutomationPlan };
