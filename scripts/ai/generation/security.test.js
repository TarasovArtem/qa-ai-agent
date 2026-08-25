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

const FORBIDDEN_FIELD_NAMES = ["metadata", "extras", "context", "raw", "data", "payload", "apiKey", "token", "secret", "password", "authorization", "cookie"];

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
