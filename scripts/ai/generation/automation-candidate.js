/**
 * AutomationCandidate v1 (Roadmap #22/23-F0).
 *
 * An AutomationCandidate is a RECOMMENDATION artifact, not a requirement
 * fact: it proposes whether one TestCaseModel's test case should be
 * automated, using an explicit bounded decision enum (never an unexplained
 * boolean), an explicit rationale, and bounded evidence references for any
 * repository/project-profile fact the rationale relies on (e.g. "existing
 * Playwright infrastructure exists" must cite that fact, not merely assert
 * it).
 */

"use strict";

const { LIMITS } = require("./limits");
const { ERROR_CODES, err, ok, fail } = require("./errors");
const {
  SUPPORTED_FRAMEWORKS,
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

const KIND = "AutomationCandidate";

// D2: an explicit, bounded recommendation enum - never true/false with
// unexplained semantics.
const DECISIONS = Object.freeze(["AUTOMATE", "DO_NOT_AUTOMATE", "BLOCKED"]);

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "id",
  "projectId",
  "testCaseModelId",
  "testCaseId",
  "decision",
  "rationale",
  "evidenceRefs",
  "rationaleEvidenceRefIds",
  "targetFrameworks",
  "assumptions",
  "openQuestions",
]);

function validateAutomationCandidate(candidate, { expectedProjectId } = {}) {
  const errors = [];
  if (!isPlainObject(candidate)) {
    return fail([err("$", ERROR_CODES.INVALID_TYPE, "AutomationCandidate must be a plain object")]);
  }

  collectUnknownKeyErrors(candidate, TOP_LEVEL_ALLOWED_KEYS, "$", errors);
  validateSchemaVersion(candidate.schemaVersion, "$.schemaVersion", errors);
  validateKind(candidate.kind, KIND, "$.kind", errors);
  collectIdError(candidate.id, "$.id", errors);
  validateProjectId(candidate.projectId, "$.projectId", errors, { expectedProjectId });
  collectIdError(candidate.testCaseModelId, "$.testCaseModelId", errors);
  collectIdError(candidate.testCaseId, "$.testCaseId", errors);

  if (!DECISIONS.includes(candidate.decision)) {
    errors.push(err("$.decision", ERROR_CODES.INVALID_ENUM, `$.decision must be one of ${DECISIONS.join(", ")}`));
  }

  if (!isBoundedText(candidate.rationale, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err("$.rationale", ERROR_CODES.INVALID_TYPE, "$.rationale must be a bounded, non-empty string"));
  }

  // D3: bounded evidence-reference registry backing the rationale.
  const evidenceRefIds = new Set();
  if (!Array.isArray(candidate.evidenceRefs)) {
    errors.push(err("$.evidenceRefs", ERROR_CODES.MISSING_FIELD, "$.evidenceRefs must be an array"));
  } else if (candidate.evidenceRefs.length > LIMITS.MAX_EVIDENCE_REFS) {
    errors.push(err("$.evidenceRefs", ERROR_CODES.INVALID_VALUE, `$.evidenceRefs exceeds the maximum of ${LIMITS.MAX_EVIDENCE_REFS}`));
  } else {
    candidate.evidenceRefs.forEach((ref, i) => validateEvidenceRef(ref, `$.evidenceRefs[${i}]`, errors));
    collectDuplicateIdErrors(candidate.evidenceRefs, "id", "$.evidenceRefs", errors);
    for (const ref of candidate.evidenceRefs) {
      if (ref && typeof ref === "object" && typeof ref.id === "string") evidenceRefIds.add(ref.id);
    }
  }

  // Optional: which of the evidenceRefs registry entries specifically
  // support `rationale`. When present, every id must resolve - no
  // dangling repository/project-profile evidence claim.
  if (candidate.rationaleEvidenceRefIds !== undefined) {
    if (!Array.isArray(candidate.rationaleEvidenceRefIds) || candidate.rationaleEvidenceRefIds.length > LIMITS.MAX_EVIDENCE_REFS) {
      errors.push(
        err("$.rationaleEvidenceRefIds", ERROR_CODES.INVALID_TYPE, `$.rationaleEvidenceRefIds must be an array of at most ${LIMITS.MAX_EVIDENCE_REFS} evidence ref ids`)
      );
    } else {
      candidate.rationaleEvidenceRefIds.forEach((refId, i) => {
        if (!collectIdError(refId, `$.rationaleEvidenceRefIds[${i}]`, errors)) return;
        if (!evidenceRefIds.has(refId)) {
          errors.push(
            err(`$.rationaleEvidenceRefIds[${i}]`, ERROR_CODES.INVALID_REFERENCE, `$.rationaleEvidenceRefIds[${i}] "${refId}" does not exist in evidenceRefs`)
          );
        }
      });
    }
  }

  // D4/Roadmap #22/23-F0-C1 (B7): closed v1 framework vocabulary only -
  // never an arbitrary string. targetFrameworks is allowed to be non-empty
  // on a DO_NOT_AUTOMATE or BLOCKED candidate (it may legitimately record
  // which frameworks were contemplated when that decision was made) -
  // this field alone never authorizes an AutomationPlan for a non-AUTOMATE
  // candidate; that is enforced structurally by
  // cross-model-validation.js's decision-compatibility check, not by
  // restricting this field.
  if (!Array.isArray(candidate.targetFrameworks)) {
    errors.push(err("$.targetFrameworks", ERROR_CODES.MISSING_FIELD, "$.targetFrameworks must be an array"));
  } else {
    candidate.targetFrameworks.forEach((fw, i) => {
      if (!SUPPORTED_FRAMEWORKS.includes(fw)) {
        errors.push(err(`$.targetFrameworks[${i}]`, ERROR_CODES.INVALID_ENUM, `$.targetFrameworks[${i}] must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
      }
    });
    if (new Set(candidate.targetFrameworks).size !== candidate.targetFrameworks.length) {
      errors.push(err("$.targetFrameworks", ERROR_CODES.DUPLICATE_ID, "$.targetFrameworks must not contain duplicate frameworks"));
    }
    // D4: an AUTOMATE recommendation that names zero supported frameworks
    // is an incoherent recommendation.
    if (candidate.decision === "AUTOMATE" && candidate.targetFrameworks.length === 0) {
      errors.push(err("$.targetFrameworks", ERROR_CODES.INVARIANT_VIOLATION, "AUTOMATE decision requires at least one supported target framework"));
    }
  }

  if (candidate.assumptions !== undefined) {
    if (!Array.isArray(candidate.assumptions) || candidate.assumptions.length > LIMITS.MAX_ASSUMPTIONS) {
      errors.push(err("$.assumptions", ERROR_CODES.INVALID_TYPE, `$.assumptions must be an array of at most ${LIMITS.MAX_ASSUMPTIONS} items`));
    } else {
      candidate.assumptions.forEach((a, i) => validateAssumption(a, `$.assumptions[${i}]`, errors));
      collectDuplicateIdErrors(candidate.assumptions, "id", "$.assumptions", errors);
    }
  }

  if (candidate.openQuestions !== undefined) {
    if (!Array.isArray(candidate.openQuestions) || candidate.openQuestions.length > LIMITS.MAX_OPEN_QUESTIONS) {
      errors.push(err("$.openQuestions", ERROR_CODES.INVALID_TYPE, `$.openQuestions must be an array of at most ${LIMITS.MAX_OPEN_QUESTIONS} items`));
    } else {
      candidate.openQuestions.forEach((q, i) => validateOpenQuestion(q, `$.openQuestions[${i}]`, errors));
      collectDuplicateIdErrors(candidate.openQuestions, "id", "$.openQuestions", errors);
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

module.exports = { KIND, DECISIONS, validateAutomationCandidate };
