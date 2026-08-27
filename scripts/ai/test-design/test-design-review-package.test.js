"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildTestDesignReviewPackage, recomputePackageDigest, validateFrameworkCapabilityShape, KIND, SCHEMA_VERSION } = require("./test-design-review-package");
const { ERROR_CODES } = require("../generation/errors");

const PROJECT_ID = "proj-1";

function requirementModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: PROJECT_ID,
    evidenceRefs: [{ id: "evidence-0001", kind: "user_input", sourceId: "user-input-0001" }],
    requirements: [{ id: "req-1", text: "The login page must show an error on invalid credentials.", evidenceRefIds: ["evidence-0001"] }],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  };
}

function testCaseModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "TestCaseModel",
    id: "tcm-1",
    projectId: PROJECT_ID,
    requirementModelId: "rm-1",
    testCases: [
      {
        id: "tc-1",
        title: "Invalid login shows error",
        objective: "Verify an error is shown on invalid credentials.",
        requirementIds: ["req-1"],
        steps: [{ action: "Submit invalid credentials.", expectedResult: "An error message is displayed.", requirementIds: ["req-1"] }],
      },
    ],
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id: "ac-1",
    projectId: PROJECT_ID,
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "AUTOMATE",
    rationale: "Well grounded.",
    evidenceRefs: [],
    rationaleEvidenceRefIds: [],
    targetFrameworks: ["cypress"],
    ...overrides,
  };
}

function frameworkCapability(overrides = {}) {
  return { projectId: PROJECT_ID, supportedFrameworks: ["cypress"], ...overrides };
}

function buildValid(overrides = {}) {
  return buildTestDesignReviewPackage({
    requirementModel: requirementModel(),
    testCaseModel: testCaseModel(),
    automationCandidates: [candidate()],
    frameworkCapability: frameworkCapability(),
    expectedProjectId: PROJECT_ID,
    ...overrides,
  });
}

// --- happy path ---------------------------------------------------------------

test("a well-formed package is accepted with schemaVersion 1, correct kind, and a valid digest", () => {
  const result = buildValid();
  assert.equal(result.ok, true);
  assert.equal(result.reviewPackage.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.reviewPackage.kind, KIND);
  assert.equal(result.reviewPackage.projectId, PROJECT_ID);
  assert.match(result.reviewPackage.reviewPackageDigest, /^sha256:[0-9a-f]{64}$/);
});

test("the returned package is deep-frozen and cannot be mutated after construction", () => {
  const result = buildValid();
  const before = result.reviewPackage.projectId;
  try {
    result.reviewPackage.projectId = "hacked";
  } catch {
    // strict-mode assignment to a frozen property throws - either outcome is acceptable, checked below
  }
  assert.equal(result.reviewPackage.projectId, before);
  assert.ok(Object.isFrozen(result.reviewPackage));
  assert.ok(Object.isFrozen(result.reviewPackage.automationCandidates));
});

test("reviewTargets lists RequirementModel, TestCaseModel, then every candidate, each with a valid digest", () => {
  const result = buildValid();
  const kinds = result.reviewPackage.reviewTargets.map((t) => t.artifactKind);
  assert.deepEqual(kinds, ["RequirementModel", "TestCaseModel", "AutomationCandidate"]);
  for (const target of result.reviewPackage.reviewTargets) {
    assert.match(target.artifactDigest, /^sha256:[0-9a-f]{64}$/);
  }
});

test("recomputePackageDigest matches the stored reviewPackageDigest for an untampered package", () => {
  const result = buildValid();
  assert.equal(recomputePackageDigest(result.reviewPackage), result.reviewPackage.reviewPackageDigest);
});

test("candidates are ordered by TestCaseModel.testCases order, never by caller-supplied array order", () => {
  const tcm = testCaseModel({
    testCases: [
      { id: "tc-1", title: "A", objective: "A", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "a", requirementIds: ["req-1"] }] },
      { id: "tc-2", title: "B", objective: "B", requirementIds: ["req-1"], steps: [{ action: "b", expectedResult: "b", requirementIds: ["req-1"] }] },
    ],
  });
  // caller supplies tc-2's candidate FIRST
  const c2 = candidate({ id: "ac-2", testCaseId: "tc-2" });
  const c1 = candidate({ id: "ac-1", testCaseId: "tc-1" });
  const result = buildTestDesignReviewPackage({ requirementModel: requirementModel(), testCaseModel: tcm, automationCandidates: [c2, c1], frameworkCapability: frameworkCapability(), expectedProjectId: PROJECT_ID });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reviewPackage.automationCandidates.map((c) => c.testCaseId), ["tc-1", "tc-2"]);
});

// --- candidate coverage: missing / extra / duplicate ---------------------------

test("zero candidates for a non-empty TestCaseModel is rejected (missing coverage)", () => {
  const result = buildValid({ automationCandidates: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD));
});

test("a candidate referencing a test case id that does not exist in the TestCaseModel is rejected", () => {
  const result = buildValid({ automationCandidates: [candidate({ testCaseId: "tc-does-not-exist" })] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE));
});

test("two candidates for the same test case id (duplicate coverage) is rejected", () => {
  const result = buildValid({ automationCandidates: [candidate({ id: "ac-1" }), candidate({ id: "ac-2" })] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

test("two candidates sharing the same id (even for different test cases) is rejected", () => {
  const tcm = testCaseModel({
    testCases: [
      { id: "tc-1", title: "A", objective: "A", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "a", requirementIds: ["req-1"] }] },
      { id: "tc-2", title: "B", objective: "B", requirementIds: ["req-1"], steps: [{ action: "b", expectedResult: "b", requirementIds: ["req-1"] }] },
    ],
  });
  const result = buildTestDesignReviewPackage({
    requirementModel: requirementModel(),
    testCaseModel: tcm,
    automationCandidates: [candidate({ id: "ac-1", testCaseId: "tc-1" }), candidate({ id: "ac-1", testCaseId: "tc-2" })],
    frameworkCapability: frameworkCapability(),
    expectedProjectId: PROJECT_ID,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

test("a missing test case among multiple (one covered, one not) is rejected", () => {
  const tcm = testCaseModel({
    testCases: [
      { id: "tc-1", title: "A", objective: "A", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "a", requirementIds: ["req-1"] }] },
      { id: "tc-2", title: "B", objective: "B", requirementIds: ["req-1"], steps: [{ action: "b", expectedResult: "b", requirementIds: ["req-1"] }] },
    ],
  });
  const result = buildTestDesignReviewPackage({
    requirementModel: requirementModel(),
    testCaseModel: tcm,
    automationCandidates: [candidate({ id: "ac-1", testCaseId: "tc-1" })],
    frameworkCapability: frameworkCapability(),
    expectedProjectId: PROJECT_ID,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD));
});

// --- project binding -------------------------------------------------------------

test("a candidate from a different project is rejected", () => {
  const result = buildValid({ automationCandidates: [candidate({ projectId: "other-project" })] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.PROJECT_MISMATCH));
});

test("a frameworkCapability from a different project is rejected", () => {
  const result = buildValid({ frameworkCapability: frameworkCapability({ projectId: "other-project" }) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.PROJECT_MISMATCH));
});

test("a requirementModel/testCaseModel that don't already agree on project is rejected before candidates are even inspected", () => {
  const result = buildTestDesignReviewPackage({
    requirementModel: requirementModel({ projectId: "proj-a" }),
    testCaseModel: testCaseModel({ projectId: "proj-b" }),
    automationCandidates: [candidate()],
    frameworkCapability: frameworkCapability(),
  });
  assert.equal(result.ok, false);
});

test("expectedProjectId mismatched against the requirementModel's own project is rejected", () => {
  const result = buildValid({ expectedProjectId: "some-other-project" });
  assert.equal(result.ok, false);
});

// --- upstream artifact validity is re-checked, never merely trusted ------------

test("a structurally invalid RequirementModel (missing required field) is rejected before packaging", () => {
  const rm = requirementModel();
  delete rm.requirements;
  const result = buildValid({ requirementModel: rm });
  assert.equal(result.ok, false);
});

test("a structurally invalid TestCaseModel is rejected before packaging", () => {
  const tcm = testCaseModel();
  delete tcm.testCases;
  const result = buildValid({ testCaseModel: tcm });
  assert.equal(result.ok, false);
});

test("a structurally invalid AutomationCandidate (bad decision enum) is rejected", () => {
  const result = buildValid({ automationCandidates: [candidate({ decision: "MAYBE" })] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

test("a TestCaseModel whose requirementModelId does not match the supplied RequirementModel is rejected", () => {
  const result = buildValid({ testCaseModel: testCaseModel({ requirementModelId: "wrong-rm-id" }) });
  assert.equal(result.ok, false);
});

// --- frameworkCapability shape -------------------------------------------------

test("validateFrameworkCapabilityShape rejects an unknown framework name outside the global vocabulary", () => {
  const errors = [];
  validateFrameworkCapabilityShape(frameworkCapability({ supportedFrameworks: ["selenium"] }), "$.frameworkCapability", errors);
  assert.ok(errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

test("validateFrameworkCapabilityShape rejects a duplicate framework entry", () => {
  const errors = [];
  validateFrameworkCapabilityShape(frameworkCapability({ supportedFrameworks: ["cypress", "cypress"] }), "$.frameworkCapability", errors);
  assert.ok(errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

test("validateFrameworkCapabilityShape rejects an unknown field", () => {
  const errors = [];
  validateFrameworkCapabilityShape({ ...frameworkCapability(), extra: true }, "$.frameworkCapability", errors);
  assert.ok(errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD));
});

test("a frameworkCapability naming a framework outside the global vocabulary is rejected by the package builder", () => {
  const result = buildValid({ frameworkCapability: frameworkCapability({ supportedFrameworks: ["playwright", "selenium"] }) });
  assert.equal(result.ok, false);
});

// --- prototype / array / getter / cycle attacks on every new input -------------

test("a __proto__ own key anywhere in requirementModel/testCaseModel/candidate/frameworkCapability never pollutes the global prototype and is safely rejected as an unknown field", () => {
  const evilCapability = JSON.parse('{"__proto__": {"polluted": true}, "projectId": "proj-1", "supportedFrameworks": ["cypress"]}');
  const result = buildValid({ frameworkCapability: evilCapability });
  assert.equal(({}).polluted, undefined);
  assert.equal(result.ok, false);
});

test("a caller array with an overridden .map on automationCandidates is never invoked and is safely rejected", () => {
  let calls = 0;
  const arr = [candidate()];
  arr.map = () => { calls += 1; return []; };
  const result = buildValid({ automationCandidates: arr });
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
});

test("a getter that throws while reading requirementModel is caught and reported as a bounded structural error, never a raw exception", () => {
  const rm = requirementModel();
  Object.defineProperty(rm, "requirements", {
    get() { throw new Error("boom"); },
    enumerable: true,
  });
  assert.doesNotThrow(() => buildValid({ requirementModel: rm }));
  const result = buildValid({ requirementModel: rm });
  assert.equal(result.ok, false);
});

test("a cyclic testCaseModel is safely rejected, never causing a stack overflow", () => {
  const tcm = testCaseModel();
  tcm.self = tcm;
  assert.doesNotThrow(() => buildValid({ testCaseModel: tcm }));
  const result = buildValid({ testCaseModel: tcm });
  assert.equal(result.ok, false);
});

// --- digest material-change tests: every field category must move the digest --

test("changing requirementModel content changes the package digest", () => {
  const base = buildValid().reviewPackage.reviewPackageDigest;
  const changed = buildValid({ requirementModel: requirementModel({ requirements: [{ id: "req-1", text: "A materially different requirement statement.", evidenceRefIds: ["evidence-0001"] }] }) }).reviewPackage.reviewPackageDigest;
  assert.notEqual(base, changed);
});

test("changing testCaseModel content changes the package digest", () => {
  const base = buildValid().reviewPackage.reviewPackageDigest;
  const changed = buildValid({
    testCaseModel: testCaseModel({
      testCases: [{ id: "tc-1", title: "Different title", objective: "Verify an error is shown on invalid credentials.", requirementIds: ["req-1"], steps: [{ action: "Submit invalid credentials.", expectedResult: "An error message is displayed.", requirementIds: ["req-1"] }] }],
    }),
  }).reviewPackage.reviewPackageDigest;
  assert.notEqual(base, changed);
});

test("changing a candidate's decision changes the package digest", () => {
  const base = buildValid().reviewPackage.reviewPackageDigest;
  const changed = buildValid({ automationCandidates: [candidate({ decision: "BLOCKED", targetFrameworks: [] })] }).reviewPackage.reviewPackageDigest;
  assert.notEqual(base, changed);
});

test("changing frameworkCapability's supportedFrameworks changes the package digest", () => {
  const base = buildValid().reviewPackage.reviewPackageDigest;
  const changed = buildValid({ frameworkCapability: frameworkCapability({ supportedFrameworks: [] }) }).reviewPackage.reviewPackageDigest;
  assert.notEqual(base, changed);
});

test("two structurally identical packages built from independently-constructed-but-equal inputs produce the same digest (determinism)", () => {
  const a = buildValid().reviewPackage.reviewPackageDigest;
  const b = buildValid().reviewPackage.reviewPackageDigest;
  assert.equal(a, b);
});

// --- projectProfile: optional, bounded projection -------------------------------

test("projectProfile is omitted entirely (null) when the caller does not supply one", () => {
  const result = buildValid();
  assert.equal(result.reviewPackage.projectProfile, null);
});

test("a supplied projectProfile is projected down to displayName/knownProjectConstraints only", () => {
  const result = buildValid({ projectProfile: { displayName: "Example", knownProjectConstraints: ["c1"], secretInternalField: "leak-me" } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reviewPackage.projectProfile, { displayName: "Example", knownProjectConstraints: ["c1"] });
});

// --- no side effects -------------------------------------------------------------

test("buildTestDesignReviewPackage performs no filesystem/network/child_process access (source scan)", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./test-design-review-package.js"), "utf8");
  assert.ok(!/require\(["']node:fs["']\)/.test(src));
  assert.ok(!/require\(["']fs["']\)/.test(src));
  assert.ok(!/require\(["']node:child_process["']\)/.test(src));
  assert.ok(!/require\(["']child_process["']\)/.test(src));
  assert.ok(!/require\(["']node:https?["']\)/.test(src));
});
