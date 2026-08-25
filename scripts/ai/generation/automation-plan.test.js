"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ERROR_CODES } = require("./errors");
const { LIMITS } = require("./limits");
const { KIND, OPERATIONS, isSafeRepoRelativePath, validateAutomationPlan } = require("./automation-plan");

const PROJECT_ID = "test-project";

function minimalPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: KIND,
    id: "plan-1",
    projectId: PROJECT_ID,
    automationCandidateId: "cand-1",
    framework: "playwright",
    plannedChanges: [{ path: "playwright/tests/generated/foo.spec.js", operation: "CREATE", purpose: "New generated smoke test for the category flow." }],
    ...overrides,
  };
}

test("valid minimal AutomationPlan is accepted", () => {
  assert.equal(validateAutomationPlan(minimalPlan()).ok, true);
});

test("valid representative plan with validationPlan is accepted", () => {
  const plan = minimalPlan({
    validationPlan: [
      { type: "STATIC", description: "Lint the generated file." },
      { type: "REVIEW", description: "Human review before merge." },
    ],
  });
  assert.equal(validateAutomationPlan(plan).ok, true);
});

test("null is rejected", () => {
  assert.equal(validateAutomationPlan(null).ok, false);
});

test("array instead of object is rejected", () => {
  assert.equal(validateAutomationPlan([]).ok, false);
});

test("wrong schemaVersion is rejected", () => {
  assert.equal(validateAutomationPlan(minimalPlan({ schemaVersion: 2 })).ok, false);
});

test("missing schemaVersion is rejected", () => {
  const plan = minimalPlan();
  delete plan.schemaVersion;
  assert.equal(validateAutomationPlan(plan).ok, false);
});

test("wrong kind is rejected", () => {
  assert.equal(validateAutomationPlan(minimalPlan({ kind: "AutomationCandidate" })).ok, false);
});

test("missing projectId is rejected", () => {
  const plan = minimalPlan();
  delete plan.projectId;
  assert.equal(validateAutomationPlan(plan).ok, false);
});

test("project mismatch against expectedProjectId is rejected", () => {
  const result = validateAutomationPlan(minimalPlan(), { expectedProjectId: "other" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.PROJECT_MISMATCH));
});

test("unknown top-level field is rejected", () => {
  assert.equal(validateAutomationPlan(minimalPlan({ code: "generated source" })).ok, false);
});

test("unknown nested field (on a planned change) is rejected", () => {
  const plan = minimalPlan({ plannedChanges: [{ path: "playwright/tests/x.spec.js", operation: "CREATE", purpose: "p", patch: "diff --git" }] });
  const result = validateAutomationPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD && e.path.includes("patch")));
});

test("missing required field (purpose) is rejected", () => {
  const plan = minimalPlan({ plannedChanges: [{ path: "playwright/tests/x.spec.js", operation: "CREATE" }] });
  assert.equal(validateAutomationPlan(plan).ok, false);
});

test("wrong primitive type (framework as number) is rejected", () => {
  assert.equal(validateAutomationPlan(minimalPlan({ framework: 1 })).ok, false);
});

test("empty required string (purpose) is rejected", () => {
  const plan = minimalPlan({ plannedChanges: [{ path: "playwright/tests/x.spec.js", operation: "CREATE", purpose: "   " }] });
  assert.equal(validateAutomationPlan(plan).ok, false);
});

test("over-limit string (purpose) is rejected", () => {
  const plan = minimalPlan({
    plannedChanges: [{ path: "playwright/tests/x.spec.js", operation: "CREATE", purpose: "a".repeat(LIMITS.LONG_TEXT_MAX_LENGTH + 1) }],
  });
  assert.equal(validateAutomationPlan(plan).ok, false);
});

test("over-limit array (plannedChanges exceeding MAX_PLANNED_CHANGES) is rejected", () => {
  const plannedChanges = Array.from({ length: LIMITS.MAX_PLANNED_CHANGES + 1 }, (_, i) => ({
    path: `playwright/tests/generated/foo-${i}.spec.js`,
    operation: "CREATE",
    purpose: "p",
  }));
  assert.equal(validateAutomationPlan(minimalPlan({ plannedChanges })).ok, false);
});

test("no plannedChanges is rejected", () => {
  assert.equal(validateAutomationPlan(minimalPlan({ plannedChanges: [] })).ok, false);
});

// --- isSafeRepoRelativePath: direct unit coverage of the path classifier -

test("isSafeRepoRelativePath: accepts neutral safe relative examples", () => {
  assert.equal(isSafeRepoRelativePath("playwright/tests/generated/foo.spec.js"), true);
  assert.equal(isSafeRepoRelativePath("cypress/e2e/generated/foo.cy.js"), true);
});

test("isSafeRepoRelativePath: rejects POSIX absolute path", () => {
  assert.equal(isSafeRepoRelativePath("/tmp/foo"), false);
});

test("isSafeRepoRelativePath: rejects traversal", () => {
  assert.equal(isSafeRepoRelativePath("../foo"), false);
  assert.equal(isSafeRepoRelativePath("../../package.json"), false);
  assert.equal(isSafeRepoRelativePath("repo/../../foo"), false);
});

test("isSafeRepoRelativePath: rejects Windows drive-absolute path", () => {
  assert.equal(isSafeRepoRelativePath("C:\\repo\\foo"), false);
});

test("isSafeRepoRelativePath: rejects UNC path", () => {
  assert.equal(isSafeRepoRelativePath("\\\\server\\share\\foo"), false);
});

test("isSafeRepoRelativePath: rejects file: scheme", () => {
  assert.equal(isSafeRepoRelativePath("file:///tmp/foo"), false);
});

test("isSafeRepoRelativePath: rejects an http(s) URL", () => {
  assert.equal(isSafeRepoRelativePath("https://example.com/foo"), false);
});

test("isSafeRepoRelativePath: rejects a non-string value", () => {
  assert.equal(isSafeRepoRelativePath(42), false);
  assert.equal(isSafeRepoRelativePath(null), false);
});

// --- Stage L: AutomationPlan path/operation tests -----------------------

test("planned change with a safe path in each named example is accepted", () => {
  for (const path of ["playwright/tests/generated/foo.spec.js", "cypress/e2e/generated/foo.cy.js"]) {
    const plan = minimalPlan({ framework: path.startsWith("cypress") ? "cypress" : "playwright", plannedChanges: [{ path, operation: "CREATE", purpose: "p" }] });
    assert.equal(validateAutomationPlan(plan).ok, true, `expected ${path} to be accepted`);
  }
});

test("planned change with an unsafe path is rejected in every listed adversarial form", () => {
  const unsafePaths = [
    "/tmp/foo",
    "../foo",
    "../../package.json",
    "C:\\repo\\foo",
    "\\\\server\\share\\foo",
    "file:///tmp/foo",
    "https://example.com/foo",
    "repo/../../foo",
  ];
  for (const path of unsafePaths) {
    const plan = minimalPlan({ plannedChanges: [{ path, operation: "CREATE", purpose: "p" }] });
    const result = validateAutomationPlan(plan);
    assert.equal(result.ok, false, `expected ${path} to be rejected`);
    assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_PATH), `expected INVALID_PATH for ${path}`);
  }
});

test("DELETE operation is rejected", () => {
  const plan = minimalPlan({ plannedChanges: [{ path: "playwright/tests/x.spec.js", operation: "DELETE", purpose: "p" }] });
  const result = validateAutomationPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

test("an unknown operation value is rejected", () => {
  const plan = minimalPlan({ plannedChanges: [{ path: "playwright/tests/x.spec.js", operation: "RENAME", purpose: "p" }] });
  assert.equal(validateAutomationPlan(plan).ok, false);
});

test("OPERATIONS is exactly [CREATE, MODIFY] - no DELETE", () => {
  assert.deepEqual(OPERATIONS, ["CREATE", "MODIFY"]);
});

test("MODIFY operation is accepted", () => {
  const plan = minimalPlan({ plannedChanges: [{ path: "playwright/tests/x.spec.js", operation: "MODIFY", purpose: "p" }] });
  assert.equal(validateAutomationPlan(plan).ok, true);
});

test("unrecognized framework not in the shared v1 vocabulary is rejected", () => {
  assert.equal(validateAutomationPlan(minimalPlan({ framework: "selenium" })).ok, false);
});

test("unrecognized validationPlan step type is rejected", () => {
  const plan = minimalPlan({ validationPlan: [{ type: "MANUAL", description: "d" }] });
  const result = validateAutomationPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

// --- Stage M: serialization ---------------------------------------------

test("a valid AutomationPlan survives JSON round-trip unchanged", () => {
  const plan = minimalPlan();
  const roundTripped = JSON.parse(JSON.stringify(plan));
  assert.deepEqual(roundTripped, plan);
  assert.equal(validateAutomationPlan(roundTripped).ok, true);
});
