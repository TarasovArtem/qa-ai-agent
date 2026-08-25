"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ERROR_CODES } = require("./errors");
const { LIMITS } = require("./limits");
const { KIND, DECISIONS, validateAutomationCandidate } = require("./automation-candidate");

const PROJECT_ID = "test-project";

function minimalCandidate(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: KIND,
    id: "cand-1",
    projectId: PROJECT_ID,
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "AUTOMATE",
    rationale: "Existing Playwright infrastructure covers this flow.",
    evidenceRefs: [{ id: "ev-1", kind: "repository", location: "playwright/tests/" }],
    rationaleEvidenceRefIds: ["ev-1"],
    targetFrameworks: ["playwright"],
    ...overrides,
  };
}

test("valid minimal AutomationCandidate is accepted", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate()).ok, true);
});

test("valid representative candidate with assumptions/openQuestions is accepted", () => {
  const candidate = minimalCandidate({
    assumptions: [{ id: "as-1", text: "a", rationale: "r" }],
    openQuestions: [{ id: "oq-1", type: "OPEN_QUESTION", description: "d", reason: "r" }],
  });
  assert.equal(validateAutomationCandidate(candidate).ok, true);
});

test("null is rejected", () => {
  assert.equal(validateAutomationCandidate(null).ok, false);
});

test("array instead of object is rejected", () => {
  assert.equal(validateAutomationCandidate([]).ok, false);
});

test("wrong schemaVersion is rejected", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ schemaVersion: 2 })).ok, false);
});

test("missing schemaVersion is rejected", () => {
  const candidate = minimalCandidate();
  delete candidate.schemaVersion;
  assert.equal(validateAutomationCandidate(candidate).ok, false);
});

test("wrong kind is rejected", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ kind: "AutomationPlan" })).ok, false);
});

test("missing projectId is rejected", () => {
  const candidate = minimalCandidate();
  delete candidate.projectId;
  assert.equal(validateAutomationCandidate(candidate).ok, false);
});

test("project mismatch against expectedProjectId is rejected", () => {
  const result = validateAutomationCandidate(minimalCandidate(), { expectedProjectId: "other" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.PROJECT_MISMATCH));
});

test("unknown top-level field is rejected", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ confidence: 0.8 })).ok, false);
});

test("unknown nested field (on an evidenceRef) is rejected", () => {
  const candidate = minimalCandidate({ evidenceRefs: [{ id: "ev-1", kind: "repository", raw: "dump" }] });
  const result = validateAutomationCandidate(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD && e.path.includes("raw")));
});

test("missing required field (rationale) is rejected", () => {
  const candidate = minimalCandidate();
  delete candidate.rationale;
  assert.equal(validateAutomationCandidate(candidate).ok, false);
});

test("wrong primitive type (testCaseId as number) is rejected", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ testCaseId: 1 })).ok, false);
});

test("empty required string (rationale) is rejected", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ rationale: "   " })).ok, false);
});

test("over-limit string (rationale) is rejected", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ rationale: "a".repeat(LIMITS.LONG_TEXT_MAX_LENGTH + 1) })).ok, false);
});

test("over-limit array (evidenceRefs exceeding MAX_EVIDENCE_REFS) is rejected", () => {
  const evidenceRefs = Array.from({ length: LIMITS.MAX_EVIDENCE_REFS + 1 }, (_, i) => ({ id: `ev-${i}`, kind: "repository" }));
  assert.equal(validateAutomationCandidate(minimalCandidate({ evidenceRefs, rationaleEvidenceRefIds: ["ev-0"] })).ok, false);
});

test("duplicate ids are rejected", () => {
  const candidate = minimalCandidate({
    evidenceRefs: [
      { id: "ev-1", kind: "repository" },
      { id: "ev-1", kind: "document" },
    ],
  });
  const result = validateAutomationCandidate(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

test("dangling reference (rationaleEvidenceRefIds pointing nowhere) is rejected", () => {
  const candidate = minimalCandidate({ rationaleEvidenceRefIds: ["ev-does-not-exist"] });
  const result = validateAutomationCandidate(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE));
});

// --- Stage K: AutomationCandidate tests ---------------------------------
// (unknown test / wrong project are cross-model concerns - see
// cross-model-validation.test.js)

test("unknown recommendation/decision value is rejected", () => {
  const candidate = minimalCandidate({ decision: "MAYBE" });
  const result = validateAutomationCandidate(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

test("AUTOMATE with zero target frameworks is rejected", () => {
  const candidate = minimalCandidate({ targetFrameworks: [] });
  const result = validateAutomationCandidate(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVARIANT_VIOLATION));
});

test("AUTOMATE with playwright target is accepted", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ targetFrameworks: ["playwright"] })).ok, true);
});

test("AUTOMATE with cypress target is accepted", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ targetFrameworks: ["cypress"] })).ok, true);
});

test("AUTOMATE with an unsupported framework string is rejected", () => {
  const candidate = minimalCandidate({ targetFrameworks: ["selenium"] });
  const result = validateAutomationCandidate(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

test("duplicate frameworks in targetFrameworks is rejected", () => {
  const candidate = minimalCandidate({ targetFrameworks: ["playwright", "playwright"] });
  const result = validateAutomationCandidate(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

test("BLOCKED candidate with an empty target-framework list and an open question is accepted", () => {
  const candidate = minimalCandidate({
    decision: "BLOCKED",
    targetFrameworks: [],
    openQuestions: [{ id: "oq-1", type: "OPEN_QUESTION", description: "Login flow undefined", reason: "no requirement covers auth" }],
  });
  assert.equal(validateAutomationCandidate(candidate).ok, true);
});

test("DO_NOT_AUTOMATE with an empty target-framework list is accepted (no automation is proposed)", () => {
  assert.equal(validateAutomationCandidate(minimalCandidate({ decision: "DO_NOT_AUTOMATE", targetFrameworks: [] })).ok, true);
});

test("repository evidence ref dangling from evidenceRefs registry is rejected", () => {
  const candidate = minimalCandidate({
    evidenceRefs: [{ id: "ev-real", kind: "repository" }],
    rationaleEvidenceRefIds: ["ev-real", "ev-phantom"],
  });
  const result = validateAutomationCandidate(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE));
});

// --- Stage M: serialization ---------------------------------------------

test("a valid AutomationCandidate survives JSON round-trip unchanged", () => {
  const candidate = minimalCandidate();
  const roundTripped = JSON.parse(JSON.stringify(candidate));
  assert.deepEqual(roundTripped, candidate);
  assert.equal(validateAutomationCandidate(roundTripped).ok, true);
});

test("DECISIONS is exactly the documented three-value enum", () => {
  assert.deepEqual(DECISIONS, ["AUTOMATE", "DO_NOT_AUTOMATE", "BLOCKED"]);
});
