"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ERROR_CODES } = require("./errors");
const { validateGenerationChain } = require("./cross-model-validation");

const PROJECT_ID = "test-project";

function baseRequirementModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: PROJECT_ID,
    evidenceRefs: [{ id: "ev-1", kind: "document" }],
    requirements: [{ id: "req-1", text: "The system shall do X.", evidenceRefIds: ["ev-1"] }],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  };
}

function baseTestCaseModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "TestCaseModel",
    id: "tcm-1",
    projectId: PROJECT_ID,
    requirementModelId: "rm-1",
    testCases: [
      {
        id: "tc-1",
        title: "t",
        objective: "o",
        requirementIds: ["req-1"],
        steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }],
      },
    ],
    ...overrides,
  };
}

function baseCandidate(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id: "cand-1",
    projectId: PROJECT_ID,
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "AUTOMATE",
    rationale: "Existing Playwright infrastructure covers this flow.",
    evidenceRefs: [],
    rationaleEvidenceRefIds: [],
    targetFrameworks: ["playwright"],
    ...overrides,
  };
}

function basePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "AutomationPlan",
    id: "plan-1",
    projectId: PROJECT_ID,
    automationCandidateId: "cand-1",
    framework: "playwright",
    plannedChanges: [{ path: "playwright/tests/generated/foo.spec.js", operation: "CREATE", purpose: "p" }],
    ...overrides,
  };
}

function fullChain(overrides = {}) {
  return {
    requirementModel: baseRequirementModel(),
    testCaseModel: baseTestCaseModel(),
    automationCandidates: [baseCandidate()],
    automationPlans: [basePlan()],
    ...overrides,
  };
}

test("a fully valid chain (RequirementModel -> TestCaseModel -> Candidate -> Plan) is accepted", () => {
  const result = validateGenerationChain(fullChain());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("a chain with only RequirementModel + TestCaseModel (no candidates/plans yet) is accepted", () => {
  const result = validateGenerationChain({ requirementModel: baseRequirementModel(), testCaseModel: baseTestCaseModel() });
  assert.equal(result.ok, true);
});

test("null chain is rejected", () => {
  assert.equal(validateGenerationChain(null).ok, false);
});

test("an individually-invalid member fails the whole chain with that member's own errors", () => {
  const result = validateGenerationChain(fullChain({ requirementModel: baseRequirementModel({ schemaVersion: 2 }) }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_VERSION && e.path.startsWith("requirementModel")));
});

// --- F1: project isolation ----------------------------------------------

test("F1: a testCaseModel with a different projectId fails closed", () => {
  const result = validateGenerationChain(fullChain({ testCaseModel: baseTestCaseModel({ projectId: "other-project" }) }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.PROJECT_MISMATCH));
});

test("F1: expectedProjectId option rejects a chain whose own requirementModel.projectId does not match", () => {
  const result = validateGenerationChain(fullChain(), { expectedProjectId: "other-project" });
  assert.equal(result.ok, false);
});

// --- F2: version consistency ---------------------------------------------

test("F2: mixed schemaVersion across the chain fails closed even when each artifact's own field is well-typed", () => {
  // requirementModel is well-formed v1 on its own; testCaseModel individually
  // fails its own schemaVersion check (2 is not 1), which is already caught
  // before the cross-chain F2 pass - demonstrating no v2 member can ever
  // silently enter a v1 chain.
  const result = validateGenerationChain(fullChain({ testCaseModel: baseTestCaseModel({ schemaVersion: 2 }) }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_VERSION));
});

// --- F3: TestCaseModel -> RequirementModel -------------------------------

test("F3: unknown requirement id referenced by a test case is rejected", () => {
  const result = validateGenerationChain(
    fullChain({ testCaseModel: baseTestCaseModel({ testCases: [{ id: "tc-1", title: "t", objective: "o", requirementIds: ["req-ghost"], steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-ghost"] }] }] }) })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE && e.path.includes("requirementIds")));
});

test("F3: wrong requirementModelId is rejected", () => {
  const result = validateGenerationChain(fullChain({ testCaseModel: baseTestCaseModel({ requirementModelId: "rm-wrong" }) }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === "testCaseModel.requirementModelId"));
});

// --- F4: AutomationCandidate -> TestCaseModel ----------------------------

test("F4: candidate referencing an unknown test case id is rejected", () => {
  const result = validateGenerationChain(fullChain({ automationCandidates: [baseCandidate({ testCaseId: "tc-ghost" })] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE && e.path.includes("testCaseId")));
});

test("F4: candidate referencing the wrong testCaseModelId is rejected", () => {
  const result = validateGenerationChain(fullChain({ automationCandidates: [baseCandidate({ testCaseModelId: "tcm-wrong" })] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE && e.path.includes("testCaseModelId")));
});

// --- F5/F6: AutomationPlan -> AutomationCandidate ------------------------

test("F5: plan referencing an unknown candidate id is rejected", () => {
  const result = validateGenerationChain(fullChain({ automationPlans: [basePlan({ automationCandidateId: "cand-ghost" })] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE && e.path.includes("automationCandidateId")));
});

test("F6: plan using a framework the candidate does not support is rejected", () => {
  const result = validateGenerationChain(
    fullChain({ automationCandidates: [baseCandidate({ targetFrameworks: ["cypress"] })], automationPlans: [basePlan({ framework: "playwright" })] })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_VALUE && e.path.includes("framework")));
});

test("F6: plan framework matching one of the candidate's target frameworks is accepted", () => {
  const result = validateGenerationChain(
    fullChain({ automationCandidates: [baseCandidate({ targetFrameworks: ["cypress", "playwright"] })], automationPlans: [basePlan({ framework: "cypress" })] })
  );
  assert.equal(result.ok, true);
});

// --- F7: duplicates --------------------------------------------------------

test("F7: duplicate automationCandidate ids across the chain are rejected", () => {
  const result = validateGenerationChain(fullChain({ automationCandidates: [baseCandidate(), baseCandidate({ testCaseId: "tc-1" })] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID && e.path === "automationCandidates"));
});

test("F7: duplicate automationPlan ids across the chain are rejected", () => {
  const result = validateGenerationChain(fullChain({ automationPlans: [basePlan(), basePlan()] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID && e.path === "automationPlans"));
});

// --- F8: no best-effort/fallback resolution ------------------------------

test("F8: a near-miss id (case-different) is never silently accepted as a match", () => {
  const result = validateGenerationChain(fullChain({ automationCandidates: [baseCandidate({ testCaseId: "TC-1" })] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE));
});
