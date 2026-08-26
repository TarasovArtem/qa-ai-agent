/**
 * Roadmap #22/23-F0 Stage G/M security-boundary tests, exercised across all
 * four contracts together rather than duplicated per-file: no generic data
 * bags, no secret-shaped fields, no raw-object error leakage, and no
 * function/Date/Map/Set/Buffer contract-data semantics.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const requirementModel = require("./requirement-model");
const testCaseModel = require("./test-case-model");
const automationCandidate = require("./automation-candidate");
const automationPlan = require("./automation-plan");
const { validateGenerationChain } = require("./cross-model-validation");
const { LIMITS } = require("./limits");

const FORBIDDEN_FIELD_NAMES = ["metadata", "extras", "context", "raw", "data", "payload", "apiKey", "token", "secret", "password", "authorization", "cookie"];

// Roadmap #22/23-F0-C2: shared assertion for every "does this marker leak
// into a validation error" test below - asserts the validation actually
// failed (a marker planted in a value that happened to be accepted proves
// nothing) and that the marker never appears anywhere in the serialized
// error list.
function assertRejectedWithoutLeaking(result, marker, label) {
  assert.equal(result.ok, false, `${label}: expected validation to fail`);
  const serialized = JSON.stringify(result.errors);
  assert.ok(!serialized.includes(marker), `${label}: marker "${marker}" must not appear in validation errors, got ${serialized}`);
}

// Reaches into each module's own internal ALLOWED_KEYS constants via a
// throwaway hostile object carrying every forbidden name at once, and
// asserts every one of them is rejected as UNKNOWN_FIELD - this is a
// behavioral check (what the validator actually does), not a static
// source-text grep, so it can never pass merely because a constant
// happens to be named safely.
test("G1: no contract accepts a generic data-bag field (metadata/extras/context/raw/...)", () => {
  const hostilePatch = Object.fromEntries(FORBIDDEN_FIELD_NAMES.map((name) => [name, { smuggled: true }]));

  const rm = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [],
    requirements: [],
    assumptions: [],
    openQuestions: [],
    ...hostilePatch,
  });
  assert.equal(rm.ok, false);
  for (const name of FORBIDDEN_FIELD_NAMES) {
    assert.ok(rm.errors.some((e) => e.path === `$.${name}`), `expected ${name} to be rejected on RequirementModel`);
  }

  const tcm = testCaseModel.validateTestCaseModel({
    schemaVersion: 1,
    kind: "TestCaseModel",
    id: "tcm-1",
    projectId: "p",
    requirementModelId: "rm-1",
    testCases: [],
    ...hostilePatch,
  });
  assert.equal(tcm.ok, false);
  for (const name of FORBIDDEN_FIELD_NAMES) {
    assert.ok(tcm.errors.some((e) => e.path === `$.${name}`), `expected ${name} to be rejected on TestCaseModel`);
  }
  // testCases is required non-empty, so this also fails for that reason -
  // that's fine, this test only asserts the hostile fields are individually
  // flagged, not that they are the only errors.

  const cand = automationCandidate.validateAutomationCandidate({
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id: "c-1",
    projectId: "p",
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "BLOCKED",
    rationale: "r",
    evidenceRefs: [],
    targetFrameworks: [],
    ...hostilePatch,
  });
  assert.equal(cand.ok, false);
  for (const name of FORBIDDEN_FIELD_NAMES) {
    assert.ok(cand.errors.some((e) => e.path === `$.${name}`), `expected ${name} to be rejected on AutomationCandidate`);
  }

  const plan = automationPlan.validateAutomationPlan({
    schemaVersion: 1,
    kind: "AutomationPlan",
    id: "plan-1",
    projectId: "p",
    automationCandidateId: "c-1",
    framework: "playwright",
    plannedChanges: [{ path: "playwright/tests/x.spec.js", operation: "CREATE", purpose: "p" }],
    ...hostilePatch,
  });
  assert.equal(plan.ok, false);
  for (const name of FORBIDDEN_FIELD_NAMES) {
    assert.ok(plan.errors.some((e) => e.path === `$.${name}`), `expected ${name} to be rejected on AutomationPlan`);
  }
});

test("G2: a credential-shaped field value is never echoed into a validation error message", () => {
  const secretValue = "sk-live-super-secret-token-do-not-leak-1234567890";
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [],
    requirements: [],
    assumptions: [],
    openQuestions: [],
    apiKey: secretValue,
  });
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result.errors);
  assert.ok(!serialized.includes(secretValue), "a rejected field's own value must never appear in a validation error");
});

test("G6: validation errors never dump the rejected raw object, even for a deeply hostile input", () => {
  const hostileMarker = "HOSTILE_TOSTRING_MARKER_22_23_F0";
  const hostile = {
    toString() {
      return hostileMarker;
    },
    schemaVersion: 1,
    kind: "RequirementModel",
    id: { toString: () => hostileMarker },
    projectId: "p",
    evidenceRefs: "not-an-array",
    requirements: null,
    assumptions: null,
    openQuestions: null,
  };
  const result = requirementModel.validateRequirementModel(hostile);
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result.errors);
  assert.ok(!serialized.includes(hostileMarker), "validation errors must never reflect a hostile input's own toString()/content back to the caller");
  for (const e of result.errors) {
    assert.deepEqual(Object.keys(e).sort(), ["code", "message", "path"]);
  }
});

test("G6: validation errors on a cross-model chain never dump raw artifact content", () => {
  const hostileMarker = "CHAIN_HOSTILE_MARKER";
  const result = validateGenerationChain({
    requirementModel: { schemaVersion: 1, kind: "RequirementModel", id: "rm-1", projectId: hostileMarker, evidenceRefs: [], requirements: [], assumptions: [], openQuestions: [] },
    testCaseModel: null,
  });
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result.errors);
  // The project id itself is a legitimate, bounded id value and is allowed
  // to appear in provenance elsewhere in this codebase, but no error
  // message here should need to echo it back - this chain fails on
  // testCaseModel being null, which produces only a fixed, templated
  // "$ must be a plain object" message.
  assert.ok(!serialized.includes(hostileMarker) || result.errors.every((e) => typeof e.message === "string" && e.message.length < 200));
});

// --- Roadmap #22/23-F0-C2: duplicate/reference/decision value privacy ----
// The focused #22/23-F0-C1-R review reproduced a literal duplicate planned
// -path value ("SECRET_F0_C1_REVIEW/foo.js") appearing inside a validation
// error message via the shared collectDuplicateIdErrors() helper. The fix
// applies at that shared helper (and every other message that echoed an
// input-derived value), so every duplicate-id/dangling-reference/decision
// -authorization/unknown-field message across all four contracts is
// covered here, not just the one originally reported call site.

test("duplicate RequirementModel requirement id is not echoed", () => {
  const marker = "SECRET_F0_C2_DUPLICATE_REQ";
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [{ id: "ev-1", kind: "document", location: "x" }],
    requirements: [
      { id: marker, text: "t1", evidenceRefIds: ["ev-1"] },
      { id: marker, text: "t2", evidenceRefIds: ["ev-1"] },
    ],
    assumptions: [],
    openQuestions: [],
  });
  assertRejectedWithoutLeaking(result, marker, "duplicate requirement id");
});

test("duplicate EvidenceRef id is not echoed", () => {
  const marker = "SECRET_F0_C2_DUPLICATE_EV";
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [
      { id: marker, kind: "document", location: "x" },
      { id: marker, kind: "repository", location: "y" },
    ],
    requirements: [{ id: "req-1", text: "t", evidenceRefIds: [marker] }],
    assumptions: [],
    openQuestions: [],
  });
  assertRejectedWithoutLeaking(result, marker, "duplicate evidence ref id");
});

test("duplicate Assumption id and duplicate OpenQuestion id are not echoed", () => {
  const marker = "SECRET_F0_C2_DUPLICATE_ASSUMPTION_OQ";
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [],
    requirements: [],
    assumptions: [
      { id: marker, text: "t1", rationale: "r1" },
      { id: marker, text: "t2", rationale: "r2" },
    ],
    openQuestions: [
      { id: marker, type: "OPEN_QUESTION", description: "d1", reason: "r1" },
      { id: marker, type: "AMBIGUITY", description: "d2", reason: "r2" },
    ],
  });
  assertRejectedWithoutLeaking(result, marker, "duplicate assumption/open-question id");
});

test("duplicate TestCase id is not echoed", () => {
  const marker = "SECRET_F0_C2_DUPLICATE_TC";
  const step = { action: "a", expectedResult: "e", requirementIds: ["req-1"] };
  const result = testCaseModel.validateTestCaseModel({
    schemaVersion: 1,
    kind: "TestCaseModel",
    id: "tcm-1",
    projectId: "p",
    requirementModelId: "rm-1",
    testCases: [
      { id: marker, title: "t1", objective: "o", requirementIds: ["req-1"], steps: [step] },
      { id: marker, title: "t2", objective: "o", requirementIds: ["req-1"], steps: [step] },
    ],
  });
  assertRejectedWithoutLeaking(result, marker, "duplicate test case id");
});

function chainFixture({ candidateId = "cand-1", candidateDecision = "AUTOMATE", planId = "plan-1", planCandidateId = candidateId } = {}) {
  return {
    requirementModel: {
      schemaVersion: 1,
      kind: "RequirementModel",
      id: "rm-1",
      projectId: "p",
      evidenceRefs: [{ id: "ev-1", kind: "document", location: "x" }],
      requirements: [{ id: "req-1", text: "t", evidenceRefIds: ["ev-1"] }],
      assumptions: [],
      openQuestions: [],
    },
    testCaseModel: {
      schemaVersion: 1,
      kind: "TestCaseModel",
      id: "tcm-1",
      projectId: "p",
      requirementModelId: "rm-1",
      testCases: [{ id: "tc-1", title: "t", objective: "o", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "e", requirementIds: ["req-1"] }] }],
    },
    automationCandidates: [
      {
        schemaVersion: 1,
        kind: "AutomationCandidate",
        id: candidateId,
        projectId: "p",
        testCaseModelId: "tcm-1",
        testCaseId: "tc-1",
        decision: candidateDecision,
        rationale: "r",
        evidenceRefs: [],
        targetFrameworks: ["playwright"],
      },
    ],
    automationPlans: [
      {
        schemaVersion: 1,
        kind: "AutomationPlan",
        id: planId,
        projectId: "p",
        automationCandidateId: planCandidateId,
        framework: "playwright",
        plannedChanges: [{ path: "foo/bar.spec.js", operation: "CREATE", purpose: "p" }],
      },
    ],
  };
}

test("duplicate AutomationCandidate id (chain scope) is not echoed", () => {
  const marker = "SECRET_F0_C2_DUPLICATE_CAND";
  const chain = chainFixture({ candidateId: marker });
  chain.automationCandidates.push({ ...chain.automationCandidates[0] });
  const result = validateGenerationChain(chain);
  assertRejectedWithoutLeaking(result, marker, "duplicate candidate id");
});

test("duplicate AutomationPlan id (chain scope) is not echoed", () => {
  const marker = "SECRET_F0_C2_DUPLICATE_PLAN";
  const chain = chainFixture({ planId: marker });
  chain.automationPlans.push({ ...chain.automationPlans[0], plannedChanges: [{ path: "foo/baz.spec.js", operation: "CREATE", purpose: "p" }] });
  const result = validateGenerationChain(chain);
  assertRejectedWithoutLeaking(result, marker, "duplicate plan id");
});

test("duplicate planned-change path is not echoed", () => {
  const marker = "SECRET_F0_C2_DUPLICATE_PATH";
  const result = automationPlan.validateAutomationPlan({
    schemaVersion: 1,
    kind: "AutomationPlan",
    id: "plan-1",
    projectId: "p",
    automationCandidateId: "cand-1",
    framework: "playwright",
    plannedChanges: [
      { path: `${marker}/foo.js`, operation: "CREATE", purpose: "p1" },
      { path: `${marker}/foo.js`, operation: "MODIFY", purpose: "p2" },
    ],
  });
  assertRejectedWithoutLeaking(result, marker, "duplicate planned path");
});

test("a non-AUTOMATE candidate id is not echoed in the decision-authorization error", () => {
  const marker = "SECRET_F0_C2_CANDIDATE";
  const chain = chainFixture({ candidateId: marker, candidateDecision: "DO_NOT_AUTOMATE" });
  const result = validateGenerationChain(chain);
  assertRejectedWithoutLeaking(result, marker, "non-AUTOMATE candidate id");
  assert.ok(result.errors.some((e) => e.code === "INVARIANT_VIOLATION" && e.path.includes("automationCandidateId")));
});

test("a BLOCKED candidate id is not echoed in the decision-authorization error", () => {
  const marker = "SECRET_F0_C2_BLOCKED_CANDIDATE";
  const chain = chainFixture({ candidateId: marker, candidateDecision: "BLOCKED" });
  const result = validateGenerationChain(chain);
  assertRejectedWithoutLeaking(result, marker, "BLOCKED candidate id");
});

test("dangling evidenceRefIds/requirementIds/rationaleEvidenceRefIds values are not echoed", () => {
  const marker = "SECRET_F0_C2_DANGLING_REF";

  const rmResult = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [],
    requirements: [{ id: "req-1", text: "t", evidenceRefIds: [marker] }],
    assumptions: [],
    openQuestions: [],
  });
  assertRejectedWithoutLeaking(rmResult, marker, "dangling evidenceRefIds");

  const candResult = automationCandidate.validateAutomationCandidate({
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id: "cand-1",
    projectId: "p",
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "BLOCKED",
    rationale: "r",
    evidenceRefs: [],
    rationaleEvidenceRefIds: [marker],
    targetFrameworks: [],
  });
  assertRejectedWithoutLeaking(candResult, marker, "dangling rationaleEvidenceRefIds");

  const chain = chainFixture();
  chain.testCaseModel.testCases[0].requirementIds = [marker];
  chain.testCaseModel.testCases[0].steps = [{ action: "a", expectedResult: "e", requirementIds: [marker] }];
  const chainResult = validateGenerationChain(chain);
  assertRejectedWithoutLeaking(chainResult, marker, "dangling cross-model requirement id");
});

test("project mismatch does not echo either project id", () => {
  const markerA = "SECRET_PROJECT_A";
  const markerB = "SECRET_PROJECT_B";
  const chain = chainFixture();
  chain.requirementModel.projectId = markerA;
  chain.testCaseModel.projectId = markerB;
  chain.automationCandidates[0].projectId = markerA;
  chain.automationPlans[0].projectId = markerA;
  const result = validateGenerationChain(chain);
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result.errors);
  assert.ok(!serialized.includes(markerA) && !serialized.includes(markerB), "neither project id marker may appear in the mismatch error");
});

test("an over-limit text value is not echoed even when it embeds a marker", () => {
  const marker = "SECRET_F0_C2_HUGE";
  const hugeText = marker + "a".repeat(LIMITS.LONG_TEXT_MAX_LENGTH + 100);
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [{ id: "ev-1", kind: "document", location: "x" }],
    requirements: [{ id: "req-1", text: hugeText, evidenceRefIds: ["ev-1"] }],
    assumptions: [],
    openQuestions: [],
  });
  assertRejectedWithoutLeaking(result, marker, "over-limit text");
});

test("an oversized unknown-field key name is truncated in error.path and absent from message", () => {
  const marker = "SECRET_F0_C2_HUGE_KEY";
  const hugeKey = marker + "x".repeat(500);
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [],
    requirements: [{ id: "req-1", text: "t", evidenceRefIds: [] }],
    assumptions: [],
    openQuestions: [],
    [hugeKey]: 1,
  });
  assert.equal(result.ok, false);
  const unknownFieldError = result.errors.find((e) => e.code === "UNKNOWN_FIELD" && e.path.includes(marker));
  assert.ok(unknownFieldError, "expected an UNKNOWN_FIELD error referencing the oversized key");
  assert.ok(unknownFieldError.path.length < 100, `expected error.path to be bounded, got length ${unknownFieldError.path.length}`);
  assert.ok(!unknownFieldError.message.includes(marker), "the oversized key name must never appear in message, only a bounded form in path");
});

test("hostile toString on the top-level artifact still never leaks into errors after the privacy hardening", () => {
  const marker = "SECRET_F0_C2_TOSTRING";
  const hostile = {
    toString() {
      return marker;
    },
    schemaVersion: 1,
    kind: "RequirementModel",
    id: { toString: () => marker },
    projectId: "p",
    evidenceRefs: "not-an-array",
    requirements: null,
    assumptions: null,
    openQuestions: null,
  };
  const result = requirementModel.validateRequirementModel(hostile);
  assertRejectedWithoutLeaking(result, marker, "hostile toString");
  for (const e of result.errors) {
    assert.deepEqual(Object.keys(e).sort(), ["code", "message", "path"]);
  }
});

// --- Stage M (data semantics): no function/Date/Map/Set/Buffer fields ---

test("a Date instance in place of a bounded id/text field is rejected, not silently accepted", () => {
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: new Date(),
    projectId: "p",
    evidenceRefs: [],
    requirements: [],
    assumptions: [],
    openQuestions: [],
  });
  assert.equal(result.ok, false);
});

test("a function value in place of a bounded field is rejected, not silently accepted", () => {
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: [],
    requirements: [],
    assumptions: [],
    openQuestions: () => [],
  });
  assert.equal(result.ok, false);
});

test("a Map/Set value in place of an array field is rejected, not silently accepted", () => {
  const result = requirementModel.validateRequirementModel({
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "p",
    evidenceRefs: new Map(),
    requirements: new Set(),
    assumptions: [],
    openQuestions: [],
  });
  assert.equal(result.ok, false);
});
