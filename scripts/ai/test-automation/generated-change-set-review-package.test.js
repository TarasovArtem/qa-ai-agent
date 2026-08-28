"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGeneratedChangeSet, computeDigest: gcsComputeDigest, LABEL_FILE_CONTENT } = require("./generated-change-set");
const { buildGeneratedChangeSetReviewPackage, recomputeReviewPackageDigest, LIMITS, DIGEST_LABEL_PACKAGE, DIGEST_LABEL_TARGET, DIGEST_LABEL_TARGET_CONTENT } = require("./generated-change-set-review-package");

function validPlan(overrides = {}) {
  return {
    schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1",
    automationCandidateId: "cand-1", framework: "cypress",
    plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "Add coverage." }],
    ...overrides,
  };
}
function validContext(overrides = {}) {
  return { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }], ...overrides };
}
function modifyPlan(overrides = {}) {
  return validPlan({ plannedChanges: [{ path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "Update it." }], ...overrides });
}
function modifyContext(content = "describe('old', () => {});", overrides = {}) {
  return validContext({ repositoryEvidence: [{ evidenceRef: { location: "cypress/e2e/tests/existing_spec.cy.js" }, content }], ...overrides });
}
function buildValidCreateChangeSet() {
  const plan = validPlan();
  const context = validContext();
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('x', () => {});" }] });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return { plan, context, generatedChangeSet: built.generatedChangeSet };
}
function buildValidModifyChangeSet() {
  const plan = modifyPlan();
  const context = modifyContext();
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: gcsComputeDigest(LABEL_FILE_CONTENT, "describe('old', () => {});"), content: "describe('new', () => {});" }] });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return { plan, context, generatedChangeSet: built.generatedChangeSet };
}

// --- valid CREATE / MODIFY / multi-file --------------------------------------

test("valid CREATE change set produces a valid review package with one target", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const pkg = result.reviewPackage;
  assert.equal(pkg.schemaVersion, 1);
  assert.equal(pkg.kind, "GeneratedChangeSetReviewPackage");
  assert.equal(pkg.projectId, "proj-1");
  assert.equal(pkg.framework, "cypress");
  assert.equal(pkg.automationPlanId, "plan-1");
  assert.equal(pkg.changeSetDigest, generatedChangeSet.changeSetDigest);
  assert.equal(pkg.automationPlanDigest, generatedChangeSet.automationPlanDigest);
  assert.equal(pkg.repositoryContextDigest, generatedChangeSet.repositoryContextDigest);
  assert.equal(pkg.reviewTargets.length, 1);
  const target = pkg.reviewTargets[0];
  assert.equal(target.operation, "CREATE");
  assert.equal(target.path, "cypress/e2e/tests/new_spec.cy.js");
  assert.equal(target.purpose, "Add coverage.");
  assert.equal(target.baseContentDigest, null);
  assert.equal(target.existingContent, null, "CREATE must never claim existing content or real-filesystem absence");
  assert.equal(target.proposedContent, "describe('x', () => {});");
  assert.match(target.proposedContentDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(target.targetDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(pkg.packageDigest, /^sha256:[0-9a-f]{64}$/);
});

test("valid MODIFY change set binds existingContent, baseContentDigest, and proposedContent", () => {
  const { plan, context, generatedChangeSet } = buildValidModifyChangeSet();
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const target = result.reviewPackage.reviewTargets[0];
  assert.equal(target.operation, "MODIFY");
  assert.equal(target.existingContent, "describe('old', () => {});");
  assert.equal(target.proposedContent, "describe('new', () => {});");
  assert.equal(target.baseContentDigest, gcsComputeDigest(LABEL_FILE_CONTENT, "describe('old', () => {});"));
});

test("multi-file package (CREATE + MODIFY) preserves canonical plannedChanges order and both targets", () => {
  const plan = validPlan({
    plannedChanges: [
      { path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "Add coverage." },
      { path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "Update it." },
    ],
  });
  const context = validContext({ repositoryEvidence: [
    { evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" },
    { evidenceRef: { location: "cypress/e2e/tests/existing_spec.cy.js" }, content: "describe('old', () => {});" },
  ] });
  const changes = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('x', () => {});" },
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: gcsComputeDigest(LABEL_FILE_CONTENT, "describe('old', () => {});"), content: "describe('new', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.reviewPackage.reviewTargets.length, 2);
  assert.equal(result.reviewPackage.reviewTargets[0].path, "cypress/e2e/tests/new_spec.cy.js");
  assert.equal(result.reviewPackage.reviewTargets[1].path, "cypress/e2e/tests/existing_spec.cy.js");
});

// --- GeneratedChangeSet validation is reused, never re-implemented ----------

test("an invalid GeneratedChangeSet (wrong project) is rejected before any package is built", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet, expectedProjectId: "OTHER-PROJECT" });
  assert.equal(result.ok, false);
});

test("a hand-tampered GeneratedChangeSet (changed content, old digest) is rejected", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const tampered = { ...generatedChangeSet, changes: [{ ...generatedChangeSet.changes[0], content: "TAMPERED" }] };
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: tampered });
  assert.equal(result.ok, false);
});

test("a GeneratedChangeSet validated against a mismatched plan (wrong automationPlanId binding) is rejected", () => {
  const { context, generatedChangeSet } = buildValidCreateChangeSet();
  const driftedPlan = validPlan({ plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "A DIFFERENT purpose entirely" }] });
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: driftedPlan, repositoryContext: context, generatedChangeSet });
  assert.equal(result.ok, false);
});

test("a GeneratedChangeSet validated against a mismatched context is rejected", () => {
  const { plan, generatedChangeSet } = buildValidCreateChangeSet();
  const driftedContext = validContext({ repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = { DRIFTED: true };" }] });
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: driftedContext, generatedChangeSet });
  assert.equal(result.ok, false);
});

// --- package digest recomputation / tamper detection -------------------------

test("recomputeReviewPackageDigest matches the stored digest for a genuine package, and detects tamper", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet });
  assert.equal(recomputeReviewPackageDigest(result.reviewPackage), result.reviewPackage.packageDigest);

  const tampered = { ...result.reviewPackage, reviewTargets: [{ ...result.reviewPackage.reviewTargets[0], proposedContent: "TAMPERED" }] };
  assert.notEqual(recomputeReviewPackageDigest(tampered), result.reviewPackage.packageDigest);
});

test("packageDigest excludes itself from its own computation (self-reference excluded)", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet });
  const { packageDigest, ...rest } = result.reviewPackage;
  const recomputedFromRest = require("./generated-change-set-review-canonical").computeDigest(DIGEST_LABEL_PACKAGE, rest);
  assert.equal(recomputedFromRest, packageDigest);
});

test("recomputeReviewPackageDigest returns null for a non-plain-object input", () => {
  assert.equal(recomputeReviewPackageDigest(null), null);
  assert.equal(recomputeReviewPackageDigest("string"), null);
  assert.equal(recomputeReviewPackageDigest([1, 2]), null);
});

// --- immutability / JSON round trip ------------------------------------------

test("returned reviewPackage is deeply immutable", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet });
  const pkg = result.reviewPackage;
  assert.ok(Object.isFrozen(pkg));
  assert.ok(Object.isFrozen(pkg.reviewTargets));
  assert.ok(Object.isFrozen(pkg.reviewTargets[0]));
  assert.throws(() => { "use strict"; pkg.projectId = "hacked"; });
});

test("reviewPackage is JSON-round-trip stable with the same packageDigest", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet });
  const roundTripped = JSON.parse(JSON.stringify(result.reviewPackage));
  assert.equal(recomputeReviewPackageDigest(roundTripped), result.reviewPackage.packageDigest);
});

// --- hostile-object matrix -----------------------------------------------------

test("a __proto__-named own key on generatedChangeSet is rejected as an ordinary unknown field, never mutates the prototype", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const hostile = JSON.parse(JSON.stringify(generatedChangeSet).replace('"kind":"GeneratedChangeSet"', '"__proto__":{"polluted":true},"kind":"GeneratedChangeSet"'));
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: hostile });
  assert.equal(result.ok, false);
  assert.equal(({}).polluted, undefined);
});

test("a throwing getter on generatedChangeSet produces a bounded, private rejection - never leaks its message", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const hostile = { ...generatedChangeSet };
  Object.defineProperty(hostile, "changeSetDigest", { enumerable: true, get() { throw new Error("SECRET_PACKAGE_MARKER"); } });
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: hostile });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("SECRET_PACKAGE_MARKER"));
});

test("a cyclic generatedChangeSet is safely rejected, never causing a stack overflow", () => {
  const { plan, context } = buildValidCreateChangeSet();
  const cyclic = { kind: "GeneratedChangeSet" };
  cyclic.self = cyclic;
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: cyclic });
  assert.equal(result.ok, false);
});

test("error output never contains raw proposed source content or repository content beyond bounded paths", () => {
  const plan = validPlan();
  const context = validContext({ repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "SECRET_CONTEXT_MARKER" }] });
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: { kind: "not valid" } });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("SECRET_CONTEXT_MARKER"));
});

// --- expectedProjectId validation --------------------------------------------

test("a malformed expectedProjectId is rejected", () => {
  const { plan, context, generatedChangeSet } = buildValidCreateChangeSet();
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet, expectedProjectId: 12345 });
  assert.equal(result.ok, false);
});

// --- bounds --------------------------------------------------------------------

test(`review target count exactly equals GeneratedChangeSet.changes.length (bounded by LIMITS.MAX_REVIEW_TARGETS=${LIMITS.MAX_REVIEW_TARGETS})`, () => {
  const plannedChanges = Array.from({ length: 50 }, (_, i) => ({ path: `cypress/e2e/tests/f${i}.cy.js`, operation: "CREATE", purpose: "x" }));
  const plan = validPlan({ plannedChanges });
  const context = validContext();
  const changes = plannedChanges.map((c) => ({ operation: "CREATE", path: c.path, baseContentDigest: null, content: "x" }));
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const result = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.reviewPackage.reviewTargets.length, 50);
});

// --- domain separation ---------------------------------------------------------

test("target digest domain differs from package digest domain and target-content digest domain", () => {
  assert.notEqual(DIGEST_LABEL_PACKAGE, DIGEST_LABEL_TARGET);
  assert.notEqual(DIGEST_LABEL_TARGET, DIGEST_LABEL_TARGET_CONTENT);
  assert.notEqual(DIGEST_LABEL_PACKAGE, DIGEST_LABEL_TARGET_CONTENT);
});

// --- production source hygiene -------------------------------------------------

test("production module contains no filesystem/child_process/network/provider code", () => {
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("./generated-change-set-review-package.js"), "utf8");
  for (const forbidden of ["writeFile", "appendFile", "unlink(", "require(\"child_process\")", "require(\"node:child_process\")", "exec(", "spawn(", "http.request", "https.request", "fetch(", "GroqProvider", "GeminiProvider"]) {
    assert.ok(!src.includes(forbidden), `production source must not contain "${forbidden}"`);
  }
});

test("production module source contains zero NUL bytes", () => {
  const fs = require("fs");
  const buf = fs.readFileSync(require.resolve("./generated-change-set-review-package.js"));
  assert.equal(buf.filter((b) => b === 0).length, 0);
});
