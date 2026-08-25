/**
 * Cross-model reference validation (Roadmap #22/23-F0, Stage F).
 *
 * Deterministically validates a full RequirementModel -> TestCaseModel ->
 * AutomationCandidate[] -> AutomationPlan[] chain, entirely offline: no
 * provider call, no network, no filesystem access, no browser. Every
 * artifact is first validated in isolation by its own v1 validator (a
 * chain can never be cross-model-valid if one of its own members isn't
 * even v1-valid); only once every member individually passes does this
 * function check the NEW invariants that only make sense across artifacts:
 * project isolation, version consistency, and that every downstream
 * reference (TestCaseModel.testCases[].requirementIds,
 * AutomationCandidate.testCaseId/testCaseModelId,
 * AutomationPlan.automationCandidateId/framework) actually resolves - fail
 * closed, never a best-effort/first-match fallback, never a normalized
 * (e.g. case-insensitive) identity comparison.
 */

"use strict";

const { ERROR_CODES, err, ok, fail } = require("./errors");
const { isPlainObject } = require("./primitives");
const { validateRequirementModel } = require("./requirement-model");
const { validateTestCaseModel } = require("./test-case-model");
const { validateAutomationCandidate } = require("./automation-candidate");
const { validateAutomationPlan } = require("./automation-plan");

// Re-labels a sub-validator's own "$"-rooted path onto its position in the
// chain (e.g. "$.decision" on automationCandidates[1] becomes
// "automationCandidates[1].decision") so every error in the aggregated
// result is unambiguous about which artifact it came from.
function rebase(errors, prefix) {
  return errors.map((e) => ({ ...e, path: `${prefix}${e.path.slice(1)}` }));
}

function validateGenerationChain(chain, { expectedProjectId } = {}) {
  if (!isPlainObject(chain)) {
    return fail([err("$", ERROR_CODES.INVALID_TYPE, "chain must be an object")]);
  }

  const { requirementModel, testCaseModel } = chain;
  const automationCandidates = Array.isArray(chain.automationCandidates) ? chain.automationCandidates : [];
  const automationPlans = Array.isArray(chain.automationPlans) ? chain.automationPlans : [];

  const errors = [];

  const reqResult = validateRequirementModel(requirementModel, { expectedProjectId });
  if (!reqResult.ok) errors.push(...rebase(reqResult.errors, "requirementModel"));

  const tcResult = validateTestCaseModel(testCaseModel, { expectedProjectId });
  if (!tcResult.ok) errors.push(...rebase(tcResult.errors, "testCaseModel"));

  automationCandidates.forEach((candidate, i) => {
    const r = validateAutomationCandidate(candidate, { expectedProjectId });
    if (!r.ok) errors.push(...rebase(r.errors, `automationCandidates[${i}]`));
  });

  automationPlans.forEach((plan, i) => {
    const r = validateAutomationPlan(plan, { expectedProjectId });
    if (!r.ok) errors.push(...rebase(r.errors, `automationPlans[${i}]`));
  });

  // A member that isn't even individually v1-valid makes any further
  // cross-reference check meaningless (garbage-in/garbage-out) - report
  // only the individual failures first, exactly like requiring a single
  // artifact's own fields to be well-formed before its cross-references
  // are checked.
  if (errors.length > 0) return fail(errors);

  // --- F1/F2: project + schemaVersion isolation across the whole chain --
  const projectId = expectedProjectId !== undefined ? expectedProjectId : requirementModel.projectId;
  const allArtifacts = [
    { artifact: requirementModel, label: "requirementModel" },
    { artifact: testCaseModel, label: "testCaseModel" },
    ...automationCandidates.map((a, i) => ({ artifact: a, label: `automationCandidates[${i}]` })),
    ...automationPlans.map((a, i) => ({ artifact: a, label: `automationPlans[${i}]` })),
  ];
  for (const { artifact, label } of allArtifacts) {
    if (artifact.projectId !== projectId) {
      errors.push(err(`${label}.projectId`, ERROR_CODES.PROJECT_MISMATCH, `${label}.projectId does not match the chain's project identity`));
    }
    if (artifact.schemaVersion !== 1) {
      errors.push(err(`${label}.schemaVersion`, ERROR_CODES.INVALID_VERSION, `${label} is not schemaVersion 1`));
    }
  }

  // --- F3: TestCaseModel -> RequirementModel -----------------------------
  if (testCaseModel.requirementModelId !== requirementModel.id) {
    errors.push(err("testCaseModel.requirementModelId", ERROR_CODES.INVALID_REFERENCE, "testCaseModel.requirementModelId does not match requirementModel.id"));
  }
  const requirementIds = new Set(requirementModel.requirements.map((r) => r.id));
  testCaseModel.testCases.forEach((tc, i) => {
    tc.requirementIds.forEach((reqId, j) => {
      if (!requirementIds.has(reqId)) {
        errors.push(err(`testCaseModel.testCases[${i}].requirementIds[${j}]`, ERROR_CODES.INVALID_REFERENCE, `unknown requirement id "${reqId}"`));
      }
    });
  });

  // --- F4/F7: AutomationCandidate -> TestCaseModel -----------------------
  const testCaseIds = new Set(testCaseModel.testCases.map((tc) => tc.id));
  automationCandidates.forEach((candidate, i) => {
    if (candidate.testCaseModelId !== testCaseModel.id) {
      errors.push(err(`automationCandidates[${i}].testCaseModelId`, ERROR_CODES.INVALID_REFERENCE, "does not match testCaseModel.id"));
    }
    if (!testCaseIds.has(candidate.testCaseId)) {
      errors.push(err(`automationCandidates[${i}].testCaseId`, ERROR_CODES.INVALID_REFERENCE, `unknown test case id "${candidate.testCaseId}"`));
    }
  });
  reportDuplicateArtifactIds(automationCandidates, "automationCandidates", errors);

  // --- F5/F6/F7: AutomationPlan -> AutomationCandidate -------------------
  const candidatesById = new Map(automationCandidates.map((c) => [c.id, c]));
  automationPlans.forEach((plan, i) => {
    const candidate = candidatesById.get(plan.automationCandidateId);
    if (!candidate) {
      errors.push(err(`automationPlans[${i}].automationCandidateId`, ERROR_CODES.INVALID_REFERENCE, `unknown automationCandidate id "${plan.automationCandidateId}"`));
      return;
    }
    if (!candidate.targetFrameworks.includes(plan.framework)) {
      errors.push(err(`automationPlans[${i}].framework`, ERROR_CODES.INVALID_VALUE, `framework "${plan.framework}" is not among candidate "${candidate.id}"'s target frameworks`));
    }
  });
  reportDuplicateArtifactIds(automationPlans, "automationPlans", errors);

  return errors.length === 0 ? ok() : fail(errors);
}

// F7 (chain scope): no two candidates/plans in the same chain may share an
// id - exact string identity only, never a normalized/lower-cased match.
function reportDuplicateArtifactIds(items, path, errors) {
  const seen = new Set();
  const reported = new Set();
  for (const item of items) {
    if (typeof item.id !== "string") continue;
    if (seen.has(item.id) && !reported.has(item.id)) {
      errors.push(err(path, ERROR_CODES.DUPLICATE_ID, `${path}: duplicate id "${item.id}"`));
      reported.add(item.id);
    }
    seen.add(item.id);
  }
}

module.exports = { validateGenerationChain };
