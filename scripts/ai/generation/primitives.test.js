"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { LIMITS } = require("./limits");
const { ERROR_CODES } = require("./errors");
const {
  SCHEMA_VERSION,
  SUPPORTED_FRAMEWORKS,
  EVIDENCE_REF_KINDS,
  OPEN_QUESTION_TYPES,
  isValidId,
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

test("SCHEMA_VERSION is exactly the number 1", () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(typeof SCHEMA_VERSION, "number");
});

test("SUPPORTED_FRAMEWORKS is exactly [playwright, cypress]", () => {
  assert.deepEqual(SUPPORTED_FRAMEWORKS, ["playwright", "cypress"]);
});

test("isValidId: accepts a bounded, trimmed, non-empty string", () => {
  assert.equal(isValidId("req-1"), true);
});

test("isValidId: rejects non-strings (A1 - not arrays/objects/numbers)", () => {
  assert.equal(isValidId(1), false);
  assert.equal(isValidId(["req-1"]), false);
  assert.equal(isValidId({ id: "req-1" }), false);
  assert.equal(isValidId(null), false);
  assert.equal(isValidId(undefined), false);
  assert.equal(isValidId(true), false);
});

test("isValidId: rejects empty string", () => {
  assert.equal(isValidId(""), false);
});

test("isValidId: rejects a string with leading/trailing whitespace (not trim-stable)", () => {
  assert.equal(isValidId(" req-1"), false);
  assert.equal(isValidId("req-1 "), false);
});

test("isValidId: accepts exactly LIMITS.ID_MAX_LENGTH, rejects one over", () => {
  const atLimit = "a".repeat(LIMITS.ID_MAX_LENGTH);
  const overLimit = "a".repeat(LIMITS.ID_MAX_LENGTH + 1);
  assert.equal(isValidId(atLimit), true);
  assert.equal(isValidId(overLimit), false);
});

test("isValidId: rejects control characters, including NUL", () => {
  assert.equal(isValidId("req\x001"), false);
  assert.equal(isValidId("req\x071"), false);
});

test("isBoundedText: rejects whitespace-only text", () => {
  assert.equal(isBoundedText("   ", LIMITS.SHORT_TEXT_MAX_LENGTH), false);
});

test("isBoundedText: accepts normal whitespace (tab/newline) in human text", () => {
  assert.equal(isBoundedText("line one\nline two\ttabbed", LIMITS.LONG_TEXT_MAX_LENGTH), true);
});

test("isBoundedText: rejects NUL even inside otherwise normal text", () => {
  assert.equal(isBoundedText("hello\x00world", LIMITS.LONG_TEXT_MAX_LENGTH), false);
});

test("isBoundedText: accepts exactly maxLength, rejects one over", () => {
  const atLimit = "a".repeat(LIMITS.SHORT_TEXT_MAX_LENGTH);
  const overLimit = "a".repeat(LIMITS.SHORT_TEXT_MAX_LENGTH + 1);
  assert.equal(isBoundedText(atLimit, LIMITS.SHORT_TEXT_MAX_LENGTH), true);
  assert.equal(isBoundedText(overLimit, LIMITS.SHORT_TEXT_MAX_LENGTH), false);
});

test("collectIdError: pushes INVALID_TYPE and returns false for a bad id", () => {
  const errors = [];
  const result = collectIdError(123, "$.id", errors);
  assert.equal(result, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.INVALID_TYPE);
  assert.equal(errors[0].path, "$.id");
});

test("collectUnknownKeyErrors: rejects a field not in the allowlist", () => {
  const errors = [];
  collectUnknownKeyErrors({ id: "x", extra: "smuggled" }, ["id"], "$", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.UNKNOWN_FIELD);
  assert.match(errors[0].path, /extra$/);
});

test("collectUnknownKeyErrors: accepts every allowlisted field with zero errors", () => {
  const errors = [];
  collectUnknownKeyErrors({ id: "x", name: "y" }, ["id", "name"], "$", errors);
  assert.equal(errors.length, 0);
});

test("collectDuplicateIdErrors: reports exactly one error per duplicate id, not one per occurrence", () => {
  const errors = [];
  collectDuplicateIdErrors([{ id: "a" }, { id: "a" }, { id: "a" }, { id: "b" }], "id", "$.items", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.DUPLICATE_ID);
});

test("validateSchemaVersion: rejects missing version", () => {
  const errors = [];
  validateSchemaVersion(undefined, "$.schemaVersion", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.MISSING_FIELD);
});

test("validateSchemaVersion: rejects a v2 artifact", () => {
  const errors = [];
  validateSchemaVersion(2, "$.schemaVersion", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.INVALID_VERSION);
});

test("validateSchemaVersion: rejects a string \"1\" (no coercion)", () => {
  const errors = [];
  validateSchemaVersion("1", "$.schemaVersion", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.INVALID_VERSION);
});

test("validateSchemaVersion: accepts exactly the number 1", () => {
  const errors = [];
  validateSchemaVersion(1, "$.schemaVersion", errors);
  assert.equal(errors.length, 0);
});

test("validateKind: rejects a mismatched kind", () => {
  const errors = [];
  validateKind("SomethingElse", "RequirementModel", "$.kind", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.INVALID_VALUE);
});

test("validateProjectId: enforces expectedProjectId exactly, no normalization", () => {
  const errors = [];
  validateProjectId("Project-A", "$.projectId", errors, { expectedProjectId: "project-a" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.PROJECT_MISMATCH);
});

test("validateProjectId: accepts an exact match", () => {
  const errors = [];
  validateProjectId("project-a", "$.projectId", errors, { expectedProjectId: "project-a" });
  assert.equal(errors.length, 0);
});

test("validateProjectId: no expectedProjectId option means no cross-project check", () => {
  const errors = [];
  validateProjectId("project-a", "$.projectId", errors, {});
  assert.equal(errors.length, 0);
});

test("EVIDENCE_REF_KINDS and OPEN_QUESTION_TYPES are the documented closed vocabularies", () => {
  assert.deepEqual(EVIDENCE_REF_KINDS, ["user_input", "document", "repository", "project_profile", "knowledge"]);
  assert.deepEqual(OPEN_QUESTION_TYPES, ["OPEN_QUESTION", "AMBIGUITY", "MISSING_REQUIREMENT"]);
});

test("validateEvidenceRef: rejects unknown fields and an unrecognized kind", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "raw_dump", extra: true }, "$.ref", errors);
  const codes = errors.map((e) => e.code);
  assert.ok(codes.includes(ERROR_CODES.UNKNOWN_FIELD));
  assert.ok(codes.includes(ERROR_CODES.INVALID_ENUM));
});

test("validateEvidenceRef: accepts a minimal valid reference with a location", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "repository", location: "docs/requirements.md" }, "$.ref", errors);
  assert.equal(errors.length, 0);
});

test("validateEvidenceRef: a ref with neither sourceId nor location is rejected (empty pointer)", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "repository" }, "$.ref", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.INVARIANT_VIOLATION);
});

test("validateEvidenceRef: sourceId alone satisfies the pointer requirement", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "document", sourceId: "requirements-doc" }, "$.ref", errors);
  assert.equal(errors.length, 0);
});

test("validateEvidenceRef: location alone satisfies the pointer requirement", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "repository", location: "docs/requirements.md" }, "$.ref", errors);
  assert.equal(errors.length, 0);
});

test("validateEvidenceRef: both sourceId and location together are accepted", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "document", sourceId: "requirements-doc", location: "section 3" }, "$.ref", errors);
  assert.equal(errors.length, 0);
});

test("validateEvidenceRef: an empty-string sourceId does not count toward the pointer requirement", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "document", sourceId: "" }, "$.ref", errors);
  assert.ok(errors.some((e) => e.code === ERROR_CODES.INVARIANT_VIOLATION));
});

test("validateEvidenceRef: a whitespace-only location does not count toward the pointer requirement", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "document", location: "   " }, "$.ref", errors);
  assert.ok(errors.some((e) => e.code === ERROR_CODES.INVARIANT_VIOLATION));
});

test("validateEvidenceRef: a wrong-type sourceId does not count toward the pointer requirement", () => {
  const errors = [];
  validateEvidenceRef({ id: "ev-1", kind: "document", sourceId: 123 }, "$.ref", errors);
  assert.ok(errors.some((e) => e.code === ERROR_CODES.INVARIANT_VIOLATION));
});

test("validateEvidenceRef: pointer sufficiency holds for every allowed kind", () => {
  for (const kind of ["user_input", "document", "repository", "project_profile", "knowledge"]) {
    const empty = [];
    validateEvidenceRef({ id: "ev-1", kind }, "$.ref", empty);
    assert.ok(empty.some((e) => e.code === ERROR_CODES.INVARIANT_VIOLATION), `expected ${kind} empty pointer to be rejected`);

    const withLocation = [];
    validateEvidenceRef({ id: "ev-1", kind, location: "somewhere" }, "$.ref", withLocation);
    assert.equal(withLocation.length, 0, `expected ${kind} with a location to be accepted`);
  }
});

test("validateAssumption: requires id/text/rationale and rejects unknown fields", () => {
  const errors = [];
  validateAssumption({ id: "a-1", text: "some assumption", rationale: "because", metadata: {} }, "$.a", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.UNKNOWN_FIELD);
});

test("validateOpenQuestion: rejects an unrecognized type value", () => {
  const errors = [];
  validateOpenQuestion({ id: "q-1", type: "UNRESOLVED", description: "d", reason: "r" }, "$.q", errors);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, ERROR_CODES.INVALID_ENUM);
});

test("validateOpenQuestion: accepts each of the three canonical types", () => {
  for (const type of OPEN_QUESTION_TYPES) {
    const errors = [];
    validateOpenQuestion({ id: "q-1", type, description: "d", reason: "r" }, "$.q", errors);
    assert.equal(errors.length, 0, `expected ${type} to be accepted`);
  }
});

test("no validation error ever includes an 'errors' or nested object dump - every error is {path, code, message}", () => {
  const errors = [];
  validateEvidenceRef({ id: 123, kind: "bogus", extra: { nested: "leak" } }, "$.ref", errors);
  for (const e of errors) {
    assert.deepEqual(Object.keys(e).sort(), ["code", "message", "path"]);
    assert.equal(typeof e.path, "string");
    assert.equal(typeof e.code, "string");
    assert.equal(typeof e.message, "string");
  }
});
