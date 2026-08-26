"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ERROR_CODES } = require("./errors");
const { LIMITS } = require("./limits");
const { KIND, validateTestCaseModel } = require("./test-case-model");

const PROJECT_ID = "test-project";

function minimalModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: KIND,
    id: "tcm-1",
    projectId: PROJECT_ID,
    requirementModelId: "rm-1",
    testCases: [
      {
        id: "tc-1",
        title: "Selecting a category shows POI tiles",
        objective: "Verify the category selection flow.",
        requirementIds: ["req-1"],
        steps: [{ action: "Select the category", expectedResult: "POI tiles are shown", requirementIds: ["req-1"] }],
      },
    ],
    ...overrides,
  };
}

test("valid minimal TestCaseModel is accepted", () => {
  const result = validateTestCaseModel(minimalModel());
  assert.equal(result.ok, true);
});

test("valid representative TestCaseModel with preconditions and priority is accepted", () => {
  const model = minimalModel({
    testCases: [
      {
        id: "tc-1",
        title: "t",
        objective: "o",
        requirementIds: ["req-1", "req-2"],
        preconditions: ["The app is loaded"],
        steps: [
          { action: "a1", expectedResult: "e1", requirementIds: ["req-1"] },
          { action: "a2", expectedResult: "e2", requirementIds: ["req-2"] },
        ],
        priority: { level: "HIGH", rationale: "core flow", requirementIds: ["req-1"] },
      },
    ],
  });
  const result = validateTestCaseModel(model);
  assert.equal(result.ok, true);
});

test("null is rejected", () => {
  assert.equal(validateTestCaseModel(null).ok, false);
});

test("array instead of object is rejected", () => {
  assert.equal(validateTestCaseModel([]).ok, false);
});

test("wrong schemaVersion is rejected", () => {
  assert.equal(validateTestCaseModel(minimalModel({ schemaVersion: 2 })).ok, false);
});

test("missing schemaVersion is rejected", () => {
  const model = minimalModel();
  delete model.schemaVersion;
  assert.equal(validateTestCaseModel(model).ok, false);
});

test("wrong kind is rejected", () => {
  assert.equal(validateTestCaseModel(minimalModel({ kind: "RequirementModel" })).ok, false);
});

test("missing projectId is rejected", () => {
  const model = minimalModel();
  delete model.projectId;
  assert.equal(validateTestCaseModel(model).ok, false);
});

test("project mismatch against expectedProjectId is rejected", () => {
  const result = validateTestCaseModel(minimalModel(), { expectedProjectId: "other" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.PROJECT_MISMATCH));
});

test("unknown top-level field is rejected", () => {
  assert.equal(validateTestCaseModel(minimalModel({ extra: 1 })).ok, false);
});

test("unknown nested field (on a step) is rejected", () => {
  const model = minimalModel({
    testCases: [
      {
        id: "tc-1",
        title: "t",
        objective: "o",
        requirementIds: ["req-1"],
        steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"], selector: "#foo" }],
      },
    ],
  });
  const result = validateTestCaseModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD && e.path.includes("selector")));
});

test("missing required field (title) is rejected", () => {
  const model = minimalModel({
    testCases: [{ id: "tc-1", objective: "o", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }] }],
  });
  assert.equal(validateTestCaseModel(model).ok, false);
});

test("wrong primitive type (requirementModelId as number) is rejected", () => {
  assert.equal(validateTestCaseModel(minimalModel({ requirementModelId: 1 })).ok, false);
});

test("empty required string (objective) is rejected", () => {
  const model = minimalModel({
    testCases: [{ id: "tc-1", title: "t", objective: "  ", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }] }],
  });
  assert.equal(validateTestCaseModel(model).ok, false);
});

test("over-limit array (testCases exceeding MAX_TEST_CASES) is rejected", () => {
  const testCases = Array.from({ length: LIMITS.MAX_TEST_CASES + 1 }, (_, i) => ({
    id: `tc-${i}`,
    title: "t",
    objective: "o",
    requirementIds: ["req-1"],
    steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }],
  }));
  assert.equal(validateTestCaseModel(minimalModel({ testCases })).ok, false);
});

test("duplicate test case ids are rejected", () => {
  const model = minimalModel({
    testCases: [
      { id: "tc-1", title: "t1", objective: "o", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }] },
      { id: "tc-1", title: "t2", objective: "o", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }] },
    ],
  });
  const result = validateTestCaseModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

// --- Stage J: TestCaseModel adversarial tests --------------------------

test("test case with no requirementIds is rejected", () => {
  const model = minimalModel({
    testCases: [{ id: "tc-1", title: "t", objective: "o", requirementIds: [], steps: [{ action: "a", expectedResult: "e", requirementIds: [] }] }],
  });
  const result = validateTestCaseModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD && e.path.includes("requirementIds")));
});

test("step missing expectedResult is rejected", () => {
  const model = minimalModel({
    testCases: [{ id: "tc-1", title: "t", objective: "o", requirementIds: ["req-1"], steps: [{ action: "a", requirementIds: ["req-1"] }] }],
  });
  assert.equal(validateTestCaseModel(model).ok, false);
});

test("step claiming an expected result with no requirement grounding is rejected", () => {
  const model = minimalModel({
    testCases: [{ id: "tc-1", title: "t", objective: "o", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "e", requirementIds: [] }] }],
  });
  const result = validateTestCaseModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD && e.path.includes("steps[0].requirementIds")));
});

test("step grounding in a requirement id the test case itself never declared is rejected", () => {
  const model = minimalModel({
    testCases: [
      {
        id: "tc-1",
        title: "t",
        objective: "o",
        requirementIds: ["req-1"],
        steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-undeclared"] }],
      },
    ],
  });
  const result = validateTestCaseModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE));
});

test("priority with an unrecognized level is rejected", () => {
  const model = minimalModel({
    testCases: [
      {
        id: "tc-1",
        title: "t",
        objective: "o",
        requirementIds: ["req-1"],
        steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }],
        priority: { level: "URGENT", rationale: "r", requirementIds: ["req-1"] },
      },
    ],
  });
  const result = validateTestCaseModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

test("priority is never allowed to carry an ungrounded numeric confidence field", () => {
  const model = minimalModel({
    testCases: [
      {
        id: "tc-1",
        title: "t",
        objective: "o",
        requirementIds: ["req-1"],
        steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }],
        priority: { level: "HIGH", rationale: "r", requirementIds: ["req-1"], confidence: 0.95 },
      },
    ],
  });
  const result = validateTestCaseModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD && e.path.includes("confidence")));
});

// --- Stage M: serialization ---------------------------------------------

test("a valid TestCaseModel survives JSON round-trip unchanged", () => {
  const model = minimalModel();
  const roundTripped = JSON.parse(JSON.stringify(model));
  assert.deepEqual(roundTripped, model);
  assert.equal(validateTestCaseModel(roundTripped).ok, true);
});
