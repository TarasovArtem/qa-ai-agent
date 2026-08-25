"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ERROR_CODES } = require("./errors");
const { LIMITS } = require("./limits");
const { KIND, validateRequirementModel } = require("./requirement-model");

const PROJECT_ID = "test-project";

function minimalModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: KIND,
    id: "rm-1",
    projectId: PROJECT_ID,
    evidenceRefs: [{ id: "ev-1", kind: "document", location: "docs/requirements.md" }],
    requirements: [{ id: "req-1", text: "The system shall do X.", evidenceRefIds: ["ev-1"] }],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  };
}

test("valid minimal RequirementModel is accepted", () => {
  const result = validateRequirementModel(minimalModel());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("valid representative RequirementModel with assumptions/openQuestions is accepted", () => {
  const model = minimalModel({
    requirements: [
      { id: "req-1", text: "The system shall do X.", evidenceRefIds: ["ev-1"] },
      { id: "req-2", text: "The system shall do Y.", evidenceRefIds: ["ev-1"] },
    ],
    assumptions: [{ id: "as-1", text: "Assume Z", rationale: "no evidence either way" }],
    openQuestions: [
      { id: "oq-1", type: "OPEN_QUESTION", description: "What happens on timeout?", reason: "not specified" },
      { id: "oq-2", type: "AMBIGUITY", description: "Unclear ordering", reason: "two conflicting statements" },
      { id: "oq-3", type: "MISSING_REQUIREMENT", description: "No error-state requirement", reason: "gap found" },
    ],
  });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, true);
});

test("null is rejected", () => {
  const result = validateRequirementModel(null);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, ERROR_CODES.INVALID_TYPE);
});

test("array instead of object is rejected", () => {
  const result = validateRequirementModel([]);
  assert.equal(result.ok, false);
});

test("wrong schemaVersion is rejected", () => {
  const result = validateRequirementModel(minimalModel({ schemaVersion: 2 }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_VERSION));
});

test("missing schemaVersion is rejected", () => {
  const model = minimalModel();
  delete model.schemaVersion;
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD && e.path === "$.schemaVersion"));
});

test("wrong kind is rejected", () => {
  const result = validateRequirementModel(minimalModel({ kind: "TestCaseModel" }));
  assert.equal(result.ok, false);
});

test("missing projectId is rejected", () => {
  const model = minimalModel();
  delete model.projectId;
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
});

test("project mismatch against expectedProjectId is rejected", () => {
  const result = validateRequirementModel(minimalModel(), { expectedProjectId: "other-project" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.PROJECT_MISMATCH));
});

test("matching expectedProjectId is accepted", () => {
  const result = validateRequirementModel(minimalModel(), { expectedProjectId: PROJECT_ID });
  assert.equal(result.ok, true);
});

test("unknown top-level field is rejected", () => {
  const result = validateRequirementModel(minimalModel({ extra: "field" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD));
});

test("unknown nested field (on a requirement) is rejected", () => {
  const model = minimalModel({ requirements: [{ id: "req-1", text: "t", evidenceRefIds: ["ev-1"], confidence: 0.9 }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD && e.path.includes("confidence")));
});

test("missing required field (requirement.text) is rejected", () => {
  const model = minimalModel({ requirements: [{ id: "req-1", evidenceRefIds: ["ev-1"] }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
});

test("wrong primitive type (id as number) is rejected", () => {
  const result = validateRequirementModel(minimalModel({ id: 42 }));
  assert.equal(result.ok, false);
});

test("empty required string (requirement.text) is rejected", () => {
  const model = minimalModel({ requirements: [{ id: "req-1", text: "   ", evidenceRefIds: ["ev-1"] }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
});

test("over-limit string (requirement.text) is rejected", () => {
  const model = minimalModel({
    requirements: [{ id: "req-1", text: "a".repeat(LIMITS.LONG_TEXT_MAX_LENGTH + 1), evidenceRefIds: ["ev-1"] }],
  });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
});

test("over-limit array (requirements exceeding MAX_REQUIREMENTS) is rejected", () => {
  const requirements = Array.from({ length: LIMITS.MAX_REQUIREMENTS + 1 }, (_, i) => ({
    id: `req-${i}`,
    text: "t",
    evidenceRefIds: ["ev-1"],
  }));
  const result = validateRequirementModel(minimalModel({ requirements }));
  assert.equal(result.ok, false);
});

// --- Stage I: RequirementModel adversarial tests -----------------------

test("grounded requirement with zero evidence refs is rejected", () => {
  const model = minimalModel({ requirements: [{ id: "req-1", text: "t", evidenceRefIds: [] }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD && e.path.includes("evidenceRefIds")));
});

test("requirement citing an unknown evidence ref is rejected (dangling provenance)", () => {
  const model = minimalModel({ requirements: [{ id: "req-1", text: "t", evidenceRefIds: ["ev-does-not-exist"] }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE));
});

// --- Roadmap #22/23-F0-C1: empty-pointer grounding correction -----------

test("a requirement grounded only in an empty-pointer evidence ref is rejected - referencing an id is not the same as referencing real evidence", () => {
  const model = minimalModel({ evidenceRefs: [{ id: "ev-1", kind: "repository" }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVARIANT_VIOLATION));
});

test("relatedIds is no longer an accepted field on an assumption - it fails closed like any unknown field", () => {
  const model = minimalModel({ assumptions: [{ id: "as-1", text: "t", rationale: "r", relatedIds: ["req-1"] }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD && e.path.includes("relatedIds")));
});

test("relatedIds is no longer an accepted field on an open question - it fails closed like any unknown field", () => {
  const model = minimalModel({ openQuestions: [{ id: "oq-1", type: "OPEN_QUESTION", description: "d", reason: "r", relatedIds: ["req-1"] }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD && e.path.includes("relatedIds")));
});

test("duplicate requirement id is rejected", () => {
  const model = minimalModel({
    requirements: [
      { id: "req-1", text: "t1", evidenceRefIds: ["ev-1"] },
      { id: "req-1", text: "t2", evidenceRefIds: ["ev-1"] },
    ],
  });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

test("duplicate evidence ref id is rejected", () => {
  const model = minimalModel({
    evidenceRefs: [
      { id: "ev-1", kind: "document", location: "docs/a.md" },
      { id: "ev-1", kind: "repository", location: "docs/b.md" },
    ],
  });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

test("an assumption is accepted and stays structurally separate from requirements", () => {
  const model = minimalModel({ assumptions: [{ id: "as-1", text: "assume it", rationale: "why" }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, true);
});

test("open question of type OPEN_QUESTION is accepted", () => {
  const model = minimalModel({ openQuestions: [{ id: "oq-1", type: "OPEN_QUESTION", description: "d", reason: "r" }] });
  assert.equal(validateRequirementModel(model).ok, true);
});

test("open question of type AMBIGUITY is accepted", () => {
  const model = minimalModel({ openQuestions: [{ id: "oq-1", type: "AMBIGUITY", description: "d", reason: "r" }] });
  assert.equal(validateRequirementModel(model).ok, true);
});

test("open question of type MISSING_REQUIREMENT is accepted", () => {
  const model = minimalModel({ openQuestions: [{ id: "oq-1", type: "MISSING_REQUIREMENT", description: "d", reason: "r" }] });
  assert.equal(validateRequirementModel(model).ok, true);
});

test("open question with an unknown/unrecognized type is rejected", () => {
  const model = minimalModel({ openQuestions: [{ id: "oq-1", type: "GUESS", description: "d", reason: "r" }] });
  const result = validateRequirementModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

// --- Stage M: serialization ---------------------------------------------

test("a valid RequirementModel survives JSON.stringify -> JSON.parse -> validation unchanged", () => {
  const model = minimalModel({
    assumptions: [{ id: "as-1", text: "assume it", rationale: "why" }],
    openQuestions: [{ id: "oq-1", type: "OPEN_QUESTION", description: "d", reason: "r" }],
  });
  const roundTripped = JSON.parse(JSON.stringify(model));
  assert.deepEqual(roundTripped, model);
  assert.equal(validateRequirementModel(roundTripped).ok, true);
});
