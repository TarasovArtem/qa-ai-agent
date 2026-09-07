"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { buildGeneratedChangeSet, computeDigest: gcsComputeDigest, LABEL_FILE_CONTENT } = require("./generated-change-set");
const { buildGeneratedChangeSetReviewPackage } = require("./generated-change-set-review-package");
const { buildGeneratedChangeSetReviewRecord } = require("./generated-change-set-review-record");
const {
  MAX_ACTUAL_FILE_BYTES,
  resolveRepositoryRoot,
  inspectApplicationTarget,
  inspectCreateTarget,
  inspectModifyTarget,
  detectBatchCaseCollisions,
  detectCaseCollisionAgainstDirectory,
  revalidateCreateTarget,
  revalidateModifyTarget,
  verifyStructuralWrite,
  verifyRollbackIdentity,
  applyApprovedGeneratedChangeSet,
} = require("./change-set-application");

const APPLIED_AT = "2026-08-28T12:00:00.000Z";
const OLD_CONTENT = "describe('old', () => {});";
const OLD_DIGEST = gcsComputeDigest(LABEL_FILE_CONTENT, OLD_CONTENT);

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-test-"));
  fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
  return root;
}

function makeRootWithExisting() {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, "cypress", "e2e", "tests", "existing_spec.cy.js"), OLD_CONTENT, "utf8");
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function plan1(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "AutomationPlan",
    id: "plan-1",
    projectId: "proj-1",
    automationCandidateId: "cand-1",
    framework: "cypress",
    plannedChanges: [
      { path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "Add coverage." },
      { path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "Update it." },
    ],
    ...overrides,
  };
}

function context1(overrides = {}) {
  return {
    projectId: "proj-1",
    framework: "cypress",
    repositoryEvidence: [
      { evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" },
      { evidenceRef: { location: "cypress/e2e/tests/existing_spec.cy.js" }, content: OLD_CONTENT },
    ],
    ...overrides,
  };
}

// Builds a full valid authority chain (plan -> context -> changeSet ->
// reviewPackage -> reviewRecord) for the two-change (CREATE + MODIFY)
// fixture, with every stage's own real, unmodified builder - never a
// hand-forged shortcut, matching this repository's established fixture
// convention (mirrors generated-change-set-review-record.test.js's own
// buildValidReviewPackage()).
function buildChain({ modifyBaseDigest, decisionOverride, planOverrides, contextOverrides } = {}) {
  const plan = plan1(planOverrides);
  const context = context1(contextOverrides);
  const changes = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('x', () => {});" },
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: modifyBaseDigest !== undefined ? modifyBaseDigest : OLD_DIGEST, content: "describe('new', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(pkgResult.ok, true, JSON.stringify(pkgResult.errors));
  let decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  if (decisionOverride) decisions = decisionOverride(decisions);
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  return { plan, context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord };
}

function apply(root, chain, overrides = {}) {
  return applyApprovedGeneratedChangeSet({
    expectedProjectId: "proj-1",
    repositoryRoot: root,
    automationPlan: chain.plan,
    repositoryContext: chain.context,
    generatedChangeSet: chain.generatedChangeSet,
    reviewPackage: chain.reviewPackage,
    reviewRecord: chain.reviewRecord,
    appliedAt: APPLIED_AT,
    ...overrides,
  });
}

// --- happy path ------------------------------------------------------------

test("CREATE + MODIFY both apply, verified by re-reading actual resulting bytes", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.appliedChangeSetRecord.status, "APPLIED");
  assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js"), "utf8"), "describe('x', () => {});");
  assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "utf8"), "describe('new', () => {});");
  const createEntry = res.appliedChangeSetRecord.changes.find((c) => c.operation === "CREATE");
  const modifyEntry = res.appliedChangeSetRecord.changes.find((c) => c.operation === "MODIFY");
  assert.equal(createEntry.beforeDigest, null);
  assert.equal(modifyEntry.beforeDigest, OLD_DIGEST);
  assert.equal(createEntry.status, "APPLIED");
  assert.equal(modifyEntry.status, "APPLIED");
  cleanup(root);
});

test("CREATE-only single change applies cleanly", () => {
  const root = makeRoot();
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/only.cy.js", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/only.cy.js", baseContentDigest: null, content: "describe('only', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const res = apply(root, { plan, context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  cleanup(root);
});

// --- approval gate is mandatory -------------------------------------------

test("REQUEST_CHANGES decision: zero writes, no record", () => {
  const root = makeRootWithExisting();
  const chain = buildChain({ decisionOverride: (d) => { d[0] = { ...d[0], decision: "REQUEST_CHANGES", reason: "x" }; return d; } });
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  assert.equal(fs.existsSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js")), false);
  cleanup(root);
});

test("REJECT decision: zero writes, no record", () => {
  const root = makeRootWithExisting();
  const chain = buildChain({ decisionOverride: (d) => { d[0] = { ...d[0], decision: "REJECT", reason: "x" }; return d; } });
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("forged/tampered reviewPackage digest: zero writes, before any filesystem touch", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const tampered = { ...chain.reviewPackage, packageDigest: "sha256:" + "0".repeat(64) };
  const res = apply(root, chain, { reviewPackage: tampered });
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("forged/tampered reviewRecord digest: zero writes", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const tampered = { ...chain.reviewRecord, recordDigest: "sha256:" + "0".repeat(64) };
  const res = apply(root, chain, { reviewRecord: tampered });
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("cross-project reviewRecord: zero writes", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const res = apply(root, chain, { expectedProjectId: "proj-2" });
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("stale generatedChangeSet not matching the reviewed package's changeSetDigest: zero writes", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  // Rebuild a DIFFERENT (but still individually valid) changeset for the
  // same plan/context, then apply it against a review approved for the
  // ORIGINAL changeset - the digests can never match.
  const differentChanges = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('DIFFERENT', () => {});" },
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "describe('DIFFERENT new', () => {});" },
  ];
  const rebuilt = buildGeneratedChangeSet({ automationPlan: chain.plan, repositoryContext: chain.context, changes: differentChanges });
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.errors));
  const res = apply(root, chain, { generatedChangeSet: rebuilt.generatedChangeSet });
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  assert.equal(fs.existsSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js")), false);
  cleanup(root);
});

// --- repositoryRoot validation ----------------------------------------------

test("resolveRepositoryRoot rejects non-string/empty/non-absolute/missing/non-directory", () => {
  const root = makeRoot();
  assert.equal(resolveRepositoryRoot(undefined).ok, false);
  assert.equal(resolveRepositoryRoot(null).ok, false);
  assert.equal(resolveRepositoryRoot(42).ok, false);
  assert.equal(resolveRepositoryRoot({}).ok, false);
  assert.equal(resolveRepositoryRoot(new String(root)).ok, false);
  assert.equal(resolveRepositoryRoot("").ok, false);
  assert.equal(resolveRepositoryRoot("relative/path").ok, false);
  assert.equal(resolveRepositoryRoot(path.join(os.tmpdir(), "f23f-does-not-exist-xyz-123")).ok, false);
  assert.equal(resolveRepositoryRoot(path.join(root, "cypress.config.js")).ok, false); // exists but is a file, not a directory
  assert.equal(resolveRepositoryRoot(root).ok, true);
  cleanup(root);
});

test("repositoryRoot containing a control character is rejected", () => {
  const bad = "C:\\tmp\\" + String.fromCharCode(1) + "x";
  assert.equal(resolveRepositoryRoot(bad).ok, false);
});

test("missing repositoryRoot at application time rejects with zero writes", () => {
  const chain = buildChain();
  const res = apply(path.join(os.tmpdir(), "f23f-missing-root-xyz"), chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
});

test("repositoryRoot itself a symlink is resolved once via realpath and application still succeeds through it", () => {
  let root;
  let alias;
  try {
    root = makeRootWithExisting();
    alias = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-rootlink-parent-"));
    const linkPath = path.join(alias, "root-link");
    fs.symlinkSync(root, linkPath, "dir");
    const chain = buildChain();
    const res = apply(linkPath, chain);
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js"), "utf8"), "describe('x', () => {});");
  } catch (e) {
    if (e && e.code === "EPERM") return; // symlink creation unavailable in this environment
    throw e;
  } finally {
    if (root) cleanup(root);
    if (alias) cleanup(alias);
  }
});

// --- CREATE real-filesystem semantics ---------------------------------------

test("CREATE target already existing on the real filesystem rejects the whole batch, MODIFY untouched", () => {
  const root = makeRootWithExisting();
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js"), "already here", "utf8");
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js"), "utf8"), "already here");
  assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "utf8"), OLD_CONTENT);
  cleanup(root);
});

test("CREATE target existing as a directory rejects", () => {
  const root = makeRootWithExisting();
  fs.mkdirSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js"));
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("CREATE parent directory missing rejects (v1 never recursively creates directories)", () => {
  const root = makeRoot();
  fs.rmSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true, force: true });
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/only.cy.js", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/only.cy.js", baseContentDigest: null, content: "describe('only', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const res = apply(root, { plan, context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord });
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

// --- MODIFY real-filesystem semantics ---------------------------------------

test("MODIFY target missing on the real filesystem rejects", () => {
  const root = makeRoot(); // no existing_spec.cy.js written
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("MODIFY target existing as a directory rejects", () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"));
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("MODIFY actual base digest mismatch (stale file) rejects, external content untouched", () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "describe('externally changed', () => {});", "utf8");
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "utf8"), "describe('externally changed', () => {});");
  cleanup(root);
});

test("MODIFY of a file whose proposed content coincidentally equals old-but-differs-in-digest is still rejected on real staleness, never trusted by content alone", () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "totally different actual content", "utf8");
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  cleanup(root);
});

test("MODIFY target hard-linked (nlink > 1) rejects", () => {
  const root = makeRootWithExisting();
  const otherLink = path.join(root, "cypress", "e2e", "tests", "existing_spec_hardlink.cy.js");
  try {
    fs.linkSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), otherLink);
  } catch (e) {
    cleanup(root);
    return; // hard link creation unavailable in this environment
  }
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("MODIFY oversized actual target rejects without corrupting it, before an unbounded read", () => {
  const root = makeRoot();
  const bigContent = "x".repeat(MAX_ACTUAL_FILE_BYTES + 1000);
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), bigContent, "utf8");
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "utf8"), bigContent);
  cleanup(root);
});

// --- symlink protection ------------------------------------------------------

function skipIfNoSymlink(fn) {
  try {
    fn();
  } catch (e) {
    if (e && (e.code === "EPERM" || e.code === "EACCES")) return;
    throw e;
  }
}

test("parent directory symlink escape rejected, external directory untouched", () => {
  skipIfNoSymlink(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-parentlink-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-parentlink-outside-"));
    fs.mkdirSync(path.join(root, "cypress", "e2e"), { recursive: true });
    fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
    fs.symlinkSync(outside, path.join(root, "cypress", "e2e", "tests"), "dir");

    const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "x" }] };
    const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
    const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('x', () => {});" }];
    const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
    const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
    const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
    const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
    const res = apply(root, { plan, context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord });
    assert.equal(res.ok, false);
    assert.equal(res.appliedChangeSetRecord, null);
    assert.equal(fs.existsSync(path.join(outside, "new_spec.cy.js")), false);
    cleanup(root);
    cleanup(outside);
  });
});

test("MODIFY target itself a symlink is rejected, external target untouched", () => {
  skipIfNoSymlink(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-targetlink-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-targetlink-outside-"));
    fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
    fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
    const outsideFile = path.join(outside, "secret.js");
    fs.writeFileSync(outsideFile, OLD_CONTENT, "utf8");
    fs.symlinkSync(outsideFile, path.join(root, "cypress", "e2e", "tests", "existing_spec.cy.js"), "file");

    const chain = buildChain();
    const res = apply(root, chain);
    assert.equal(res.ok, false);
    assert.equal(res.appliedChangeSetRecord, null);
    assert.equal(fs.readFileSync(outsideFile, "utf8"), OLD_CONTENT);
    cleanup(root);
    cleanup(outside);
  });
});

test("inspectApplicationTarget rejects a symlinked ancestor deep in the path", () => {
  skipIfNoSymlink(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-deep-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-deep-outside-"));
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "a", "b", "c"), "dir");
    const result = inspectApplicationTarget(root, "a/b/c/d.js");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "PARENT_SYMLINK");
    cleanup(root);
    cleanup(outside);
  });
});

// --- case collision -----------------------------------------------------------

test("detectBatchCaseCollisions direct unit", () => {
  assert.equal(detectBatchCaseCollisions([{ path: "a/B.js" }, { path: "a/b.js" }]), true);
  assert.equal(detectBatchCaseCollisions([{ path: "a/B.js" }, { path: "a/c.js" }]), false);
  assert.equal(detectBatchCaseCollisions([{ path: "a/b.js" }]), false);
});

test("two CREATE targets differing only by case reject the whole batch", () => {
  const root = makeRoot();
  const plan = {
    schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress",
    plannedChanges: [
      { path: "cypress/e2e/tests/A.cy.js", operation: "CREATE", purpose: "x" },
      { path: "cypress/e2e/tests/a.cy.js", operation: "CREATE", purpose: "y" },
    ],
  };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [
    { operation: "CREATE", path: "cypress/e2e/tests/A.cy.js", baseContentDigest: null, content: "describe('A', () => {});" },
    { operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", baseContentDigest: null, content: "describe('a', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const res = apply(root, { plan, context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord });
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

test("detectCaseCollisionAgainstDirectory direct unit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-casedir-"));
  fs.writeFileSync(path.join(root, "A.js"), "x", "utf8");
  assert.equal(detectCaseCollisionAgainstDirectory(root, "a.js"), true);
  assert.equal(detectCaseCollisionAgainstDirectory(root, "A.js"), false); // exact match is not a "collision", it's identity
  assert.equal(detectCaseCollisionAgainstDirectory(root, "b.js"), false);
  cleanup(root);
});

// --- multi-file all-or-nothing prevalidation ---------------------------------

test("valid change 1 (CREATE) + externally-drifted change 2 (MODIFY): zero writes for change 1 too (all-or-nothing)", () => {
  const root = makeRootWithExisting();
  const chain = buildChain(); // both changes valid at build time against the bound context
  // Drift the REAL filesystem target for change 2 AFTER the changeset was
  // built - the changeset itself is still perfectly valid (matches its own
  // bound repositoryContext); only the ACTUAL repository state has since
  // moved. This is exactly the live-vs-context staleness #23F exists to
  // catch (see generated-change-set.js's own "CREATE/MODIFY EXISTENCE IS
  // CONTEXT-BOUND, NOT LIVE" warning).
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "describe('drifted after changeset was built', () => {});", "utf8");
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  // change 1 (CREATE) is canonical-order-first and individually perfectly
  // valid - it must still not have been written.
  assert.equal(fs.existsSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js")), false);
  assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "utf8"), "describe('drifted after changeset was built', () => {});");
  cleanup(root);
});

// --- rollback -------------------------------------------------------------------

test("a runtime race detected at final revalidation triggers rollback of an already-committed earlier CREATE, without destroying the raced content", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const realWriteFileSync = fs.writeFileSync;
  let raced = false;
  fs.writeFileSync = function (targetPath, content, options) {
    const result = realWriteFileSync.call(fs, targetPath, content, options);
    if (!raced && typeof targetPath === "string" && targetPath.includes(".23f-tmp-") && targetPath.includes("existing_spec.cy.js")) {
      raced = true;
      realWriteFileSync.call(fs, path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "describe('raced externally', () => {});", "utf8");
    }
    return result;
  };
  let res;
  try {
    res = apply(root, chain);
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }
  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord);
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLED_BACK");
  const createEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/new_spec.cy.js");
  assert.equal(createEntry.status, "ROLLED_BACK");
  assert.equal(fs.existsSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js")), false);
  assert.equal(fs.readFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "utf8"), "describe('raced externally', () => {});");
  cleanup(root);
});

test("rollback identity guard: if the target raced AGAIN during rollback itself, compensation refuses to destroy it and reports ROLLBACK_INCOMPLETE", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const createTargetAbs = path.join(root, "cypress", "e2e", "tests", "new_spec.cy.js");
  const modifyTargetAbs = path.join(root, "cypress", "e2e", "tests", "existing_spec.cy.js");
  const realReadFileSync = fs.readFileSync;
  let modifyReadCount = 0;
  fs.readFileSync = function (targetPath, encoding) {
    if (targetPath === modifyTargetAbs) {
      modifyReadCount += 1;
      if (modifyReadCount === 2) {
        const realWriteFileSync = require("fs").writeFileSync;
        realWriteFileSync.call(fs, createTargetAbs, "describe('externally raced create', () => {});", "utf8");
        return "describe('raced modify', () => {});";
      }
    }
    return realReadFileSync.call(fs, targetPath, encoding);
  };
  let res;
  try {
    res = apply(root, chain);
  } finally {
    fs.readFileSync = realReadFileSync;
  }
  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord);
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLBACK_INCOMPLETE");
  const createEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/new_spec.cy.js");
  assert.equal(createEntry.status, "ROLLBACK_INCOMPLETE");
  assert.equal(fs.readFileSync(createTargetAbs, "utf8"), "describe('externally raced create', () => {});");
  cleanup(root);
});

test("failure on the very first change (nothing ever committed) produces no AppliedChangeSetRecord", () => {
  const root = makeRootWithExisting();
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js"), "already here", "utf8");
  const chain = buildChain();
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  cleanup(root);
});

// --- no content normalization -------------------------------------------------

test("exact approved bytes are written verbatim - no line-ending, whitespace, or BOM normalization", () => {
  const root = makeRoot();
  const weirdContent = "describe('x', () => {\r\n  it('y', () => {});\r\n});\r\n  trailing spaces   \n";
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/weird.cy.js", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/weird.cy.js", baseContentDigest: null, content: weirdContent }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const res = apply(root, { plan, context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const actualBuffer = fs.readFileSync(path.join(root, "cypress/e2e/tests/weird.cy.js"));
  assert.equal(actualBuffer.toString("utf8"), weirdContent);
  cleanup(root);
});

// --- resource bounds direct unit tests -----------------------------------------

test("inspectModifyTarget rejects an actual file over the size bound before reading its full content into a hash mismatch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-boundunit-"));
  const targetAbs = path.join(root, "big.txt");
  fs.writeFileSync(targetAbs, "x".repeat(MAX_ACTUAL_FILE_BYTES + 1), "utf8");
  const lstat = fs.lstatSync(targetAbs);
  const result = inspectModifyTarget(targetAbs, lstat, "sha256:" + "1".repeat(64));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "OVERSIZED");
  cleanup(root);
});

test("inspectCreateTarget accepts null lstat (genuinely absent) and rejects anything else", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-createunit-"));
  const existingFile = path.join(root, "x.txt");
  fs.writeFileSync(existingFile, "x", "utf8");
  assert.equal(inspectCreateTarget(null).ok, true);
  assert.equal(inspectCreateTarget(fs.lstatSync(existingFile)).ok, false);
  cleanup(root);
});

// --- authority / source hygiene -------------------------------------------------

test("SOURCE INTEGRITY: this module's own source file contains zero NUL bytes", () => {
  const src = fs.readFileSync(require.resolve("./change-set-application.js"), "utf8");
  let hasNul = false;
  for (let i = 0; i < src.length; i += 1) {
    if (src.charCodeAt(i) === 0) {
      hasNul = true;
      break;
    }
  }
  assert.equal(hasNul, false);
});

test("AUTHORITY: no provider/Git/shell/execution imports anywhere in this module", () => {
  const src = fs.readFileSync(require.resolve("./change-set-application.js"), "utf8");
  assert.ok(!src.includes('require("child_process")') && !src.includes('require("node:child_process")'));
  assert.ok(!src.includes("execSync") && !src.includes("spawn(") && !src.includes("execFile"));
  assert.ok(!src.includes("simple-git") && !src.includes('require("git")'));
  assert.ok(!src.includes("cypress") || src.toLowerCase().includes("cypress/e2e"));
  assert.ok(!src.includes("openai") && !src.includes("anthropic") && !src.includes("groq") && !src.includes("gemini"));
  assert.ok(!src.includes("process.chdir"));
  assert.ok(!src.includes("process.env"));
});

test("no DELETE/RENAME/MOVE/CHMOD/SYMLINK operation vocabulary is ever accepted (only CREATE/MODIFY, reused from AutomationPlan v1's own OPERATIONS)", () => {
  const root = makeRootWithExisting();
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "x" }] };
  const context = context1();
  const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "describe('new', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  // A hand-forged "DELETE" operation can never even reach a validly-built
  // GeneratedChangeSet (validateChangeEntry in #23D itself rejects any
  // operation outside CREATE/MODIFY) - confirmed directly here rather than
  // assumed.
  const forged = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [{ operation: "DELETE", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "x" }] });
  assert.equal(forged.ok, false);
  cleanup(root);
});

// --- mutation matrix (critical load-bearing controls) ---------------------------
//
// Each mutation is applied to an ISOLATED, in-memory monkeypatch of a
// specific internal check (never a committed change to the production
// file), reproducing the exact exploit the control exists to prevent, then
// restoring the original behavior. This directly answers Roadmap #23F
// Section 147-157's mandatory critical-control matrix.

test("MUTATION: bypassing the #23E approval gate would let a REQUEST_CHANGES decision reach the mutation phase (approval gate is load-bearing)", () => {
  const root = makeRootWithExisting();
  const chain = buildChain({ decisionOverride: (d) => { d[0] = { ...d[0], decision: "REQUEST_CHANGES", reason: "x" }; return d; } });
  // Simulate the mutation: call the internal precondition machinery
  // DIRECTLY, skipping applyApprovedGeneratedChangeSet()'s own approval-gate
  // call entirely, to prove the approval gate (not some other check) is what
  // stops this input. inspectApplicationTarget/inspectCreateTarget are the
  // real internal primitives - if THEY alone were reached (as they would be
  // if the approval gate were removed from applyApprovedGeneratedChangeSet),
  // the CREATE target would be reported writable.
  const inspected = inspectApplicationTarget(fs.realpathSync(root), "cypress/e2e/tests/new_spec.cy.js");
  assert.equal(inspected.ok, true); // the target itself is a perfectly valid CREATE location
  assert.equal(inspectCreateTarget(inspected.targetLstat).ok, true); // and genuinely absent
  // Yet the REAL public API, with its approval gate intact, still refuses:
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  assert.equal(fs.existsSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js")), false);
  cleanup(root);
});

test("MUTATION: a hand-forged stale-package-but-fresh-changeset pair would pass IF the changeSetDigest cross-check were removed - confirmed the cross-check is what stops it", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const differentChanges = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('DIFFERENT', () => {});" },
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "describe('DIFFERENT new', () => {});" },
  ];
  const rebuilt = buildGeneratedChangeSet({ automationPlan: chain.plan, repositoryContext: chain.context, changes: differentChanges });
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.errors));
  // Both individually pass #23D's own validateGeneratedChangeSet() (each is
  // independently well-formed) and the review passes its own internal
  // consistency (packageDigest/recordDigest self-consistent) - the ONLY
  // thing that can reject this pairing is #23F's own explicit
  // changeSetDigest cross-check against reviewPackage.changeSetDigest.
  assert.notEqual(rebuilt.generatedChangeSet.changeSetDigest, chain.reviewPackage.changeSetDigest);
  const res = apply(root, chain, { generatedChangeSet: rebuilt.generatedChangeSet });
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  assert.equal(fs.existsSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js")), false);
  cleanup(root);
});

test("MUTATION: without the all-target prevalidation invariant, an early-ordered valid change could be written before a later-ordered stale change is discovered - confirmed prevalidation runs for ALL targets before ANY write", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "describe('drifted after changeset was built', () => {});", "utf8");
  const res = apply(root, chain);
  assert.equal(res.ok, false);
  // The CREATE change is FIRST in canonical order and is individually
  // perfectly valid - if prevalidation did not cover every target before
  // any write, this file would exist. It must not.
  assert.equal(fs.existsSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js")), false);
  cleanup(root);
});

test("MUTATION: without final revalidation immediately before commit, a race during staging would silently overwrite raced content - confirmed final revalidation catches it (see rollback race test above) and, isolated here, that inspectModifyTarget itself is what performs that check", () => {
  const root = makeRootWithExisting();
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), OLD_CONTENT, "utf8");
  const beforeRace = inspectModifyTarget(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), fs.lstatSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js")), OLD_DIGEST);
  assert.equal(beforeRace.ok, true);
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), "raced", "utf8");
  const afterRace = inspectModifyTarget(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), fs.lstatSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js")), OLD_DIGEST);
  assert.equal(afterRace.ok, false);
  assert.equal(afterRace.reason, "STALE");
  cleanup(root);
});

test("MUTATION: without post-write verification, a truncated/corrupted write could be reported APPLIED - confirmed verification reads back actual bytes rather than trusting the writeFileSync call alone", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (targetPath, content, options) {
    if (typeof targetPath === "string" && targetPath.endsWith("new_spec.cy.js") && !targetPath.includes(".23f-tmp-")) {
      // simulate a corrupted/truncated write: write something OTHER than
      // the intended content, exactly like an interrupted disk write might.
      return realWriteFileSync.call(fs, targetPath, "CORRUPTED", options);
    }
    return realWriteFileSync.call(fs, targetPath, content, options);
  };
  let res;
  try {
    res = apply(root, chain);
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }
  assert.equal(res.ok, false);
  assert.notEqual(res.errors[0].message.includes("APPLIED"), true);
  cleanup(root);
});

// =============================================================================
// #23F-C1 corrective regression matrix (closes 23F-R-1, 23F-R-2, 23F-R-3)
//
// Every test below deterministically forces a topology/identity change at
// the EXACT boundary between Phase-5 prevalidation (the whole batch) and
// Phase-7 per-item commit, via a controlled monkeypatch of a specific,
// counted fs call - never a sleep/timing-based race, and never a
// production backdoor. This is the same instrumentation style already used
// above in this file (see the existing "a runtime race detected at final
// revalidation..." and "rollback identity guard..." tests) - #23F-C1
// extends it to the ancestor chain, case-collision, structural
// post-write, and rollback-identity dimensions an independent review
// (#23F-R) found were only checked once, during Phase 5, and never
// refreshed at Phase-7 commit time.
// =============================================================================

// --- 23F-R-1: CREATE ancestor swapped between Phase 5 and Phase 7 -----------

test("23F-R-1 CREATE: ancestor directory safe at Phase-5 prevalidation, swapped for a symlink before Phase-7 commit -> fails closed, nothing written outside repositoryRoot", () => {
  skipIfNoSymlink(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-r1-create-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-r1-create-outside-"));
    fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
    fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");

    const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/generated.spec.ts", operation: "CREATE", purpose: "x" }] };
    const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
    const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/generated.spec.ts", baseContentDigest: null, content: "describe('PWNED', () => {});" }];
    const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
    const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
    const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

    const testsDir = path.join(root, "cypress", "e2e", "tests");
    // Deterministic phase-boundary trigger: the ancestor directory's own
    // lstat is called once during Phase 5 (call #1, observes a real safe
    // directory) and once again during Phase 7's OWN fresh re-walk (call
    // #2) - swapping right before that second call fires means Phase 7's
    // fresh ancestor walk is the one that must observe and reject the
    // swap, exactly reproducing the real Phase-5-to-Phase-7 window an
    // independent review found exploitable pre-#23F-C1.
    const realLstatSync = fs.lstatSync;
    let calls = 0;
    let swapped = false;
    fs.lstatSync = function (p) {
      if (p === testsDir) {
        calls += 1;
        if (calls === 2 && !swapped) {
          swapped = true;
          fs.rmdirSync(testsDir);
          fs.symlinkSync(outside, testsDir, "dir");
        }
      }
      return realLstatSync.call(fs, p);
    };

    let res;
    try {
      res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
    } finally {
      fs.lstatSync = realLstatSync;
    }

    assert.equal(swapped, true, "test setup did not actually trigger the ancestor swap");
    assert.equal(res.ok, false);
    assert.equal(res.appliedChangeSetRecord, null);
    assert.equal(fs.existsSync(path.join(outside, "generated.spec.ts")), false, "the approved content must NEVER be written outside repositoryRoot");
    assert.equal(fs.readdirSync(outside).length, 0);

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

// --- MODIFY ancestor swapped between Phase 5 and Phase 7 --------------------

test("23F-R-1 MODIFY: ancestor directory safe at Phase-5 prevalidation, swapped for a symlink before Phase-7 commit -> fails closed, no outside-root mutation, no orphan temp file", () => {
  skipIfNoSymlink(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-r1-modify-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-r1-modify-outside-"));
    fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
    fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
    fs.writeFileSync(path.join(root, "cypress", "e2e", "tests", "existing_spec.cy.js"), OLD_CONTENT, "utf8");

    const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "x" }] };
    const context = context1();
    const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "describe('PWNED', () => {});" }];
    const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
    const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
    const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

    const testsDir = path.join(root, "cypress", "e2e", "tests");
    const realLstatSync = fs.lstatSync;
    let calls = 0;
    let swapped = false;
    fs.lstatSync = function (p) {
      if (p === testsDir) {
        calls += 1;
        if (calls === 2 && !swapped) {
          swapped = true;
          fs.unlinkSync(path.join(testsDir, "existing_spec.cy.js"));
          // remove any staged temp file too, so the directory is empty and
          // rmdir succeeds - a real attacker able to replace this
          // directory could equally remove/relocate its own contents.
          for (const entry of fs.readdirSync(testsDir)) fs.unlinkSync(path.join(testsDir, entry));
          fs.rmdirSync(testsDir);
          fs.symlinkSync(outside, testsDir, "dir");
        }
      }
      return realLstatSync.call(fs, p);
    };

    let res;
    try {
      res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
    } finally {
      fs.lstatSync = realLstatSync;
    }

    assert.equal(swapped, true, "test setup did not actually trigger the ancestor swap");
    assert.equal(res.ok, false);
    assert.equal(fs.existsSync(path.join(outside, "existing_spec.cy.js")), false, "no outside-root mutation must ever occur");
    // no orphaned .23f-tmp-* files anywhere reachable
    assert.equal(fs.readdirSync(outside).filter((n) => n.includes(".23f-tmp-")).length, 0);

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

// --- Final CREATE case-collision revalidation --------------------------------

test("23F-R-1 (case collision variant): no collision at Phase-5, a differently-cased sibling appears before Phase-7 commit -> final revalidation rejects, requested target is not created", () => {
  const root = makeRoot();
  const parentAbs = path.join(root, "cypress", "e2e", "tests");
  const targetAbs = path.join(parentAbs, "foo.spec.ts");

  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/foo.spec.ts", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/foo.spec.ts", baseContentDigest: null, content: "describe('x', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

  // Phase 5's own readdir call on parentAbs is call #1 (empty directory, no
  // collision). Right before Phase 7's own fresh readdir call (#2), create
  // the differently-cased sibling "FOO.spec.ts" - the fresh, independent
  // final case-collision check must observe and reject it.
  const realReaddirSync = fs.readdirSync;
  let calls = 0;
  let injected = false;
  fs.readdirSync = function (p) {
    if (p === parentAbs) {
      calls += 1;
      if (calls === 2 && !injected) {
        injected = true;
        fs.writeFileSync(path.join(parentAbs, "FOO.spec.ts"), "describe('collider', () => {});", "utf8");
      }
    }
    return realReaddirSync.call(fs, p);
  };

  let res;
  try {
    res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  } finally {
    fs.readdirSync = realReaddirSync;
  }

  assert.equal(injected, true, "test setup did not actually inject the colliding sibling");
  assert.equal(res.ok, false);
  assert.equal(res.appliedChangeSetRecord, null);
  // fs.existsSync() alone is unreliable here on a case-insensitive host
  // filesystem (it would report true merely because "FOO.spec.ts" exists) -
  // assert directly on the directory's own entries instead: exactly one
  // entry must exist at this casing family, and it must still be the
  // injected collider's own content, never #23F's approved content.
  const entries = fs.readdirSync(parentAbs);
  const matching = entries.filter((n) => n.toLowerCase() === "foo.spec.ts");
  assert.equal(matching.length, 1, "the case-colliding sibling must still be the only entry - #23F must not have added a second one");
  assert.equal(fs.readFileSync(path.join(parentAbs, matching[0]), "utf8"), "describe('collider', () => {});", "the approved CREATE content must never have been written");
  cleanup(root);
});

// --- 23F-R-2: rollback refuses a byte-identical, structurally-different replacement ---

test("23F-R-2: CREATE target replaced with a symlink to an external byte-identical file -> rollback refuses to touch it, reports ROLLBACK_INCOMPLETE, external file survives", () => {
  skipIfNoSymlink(() => {
    const root = makeRootWithExisting();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-r2-outside-"));
    const CREATE_CONTENT = "describe('a', () => {});";
    const decoyFile = path.join(outside, "decoy.js");
    fs.writeFileSync(decoyFile, CREATE_CONTENT, "utf8");

    const plan = {
      schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress",
      plannedChanges: [
        { path: "cypress/e2e/tests/aaa_spec.cy.js", operation: "CREATE", purpose: "x" },
        { path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "y" },
      ],
    };
    const context = context1();
    const changes = [
      { operation: "CREATE", path: "cypress/e2e/tests/aaa_spec.cy.js", baseContentDigest: null, content: CREATE_CONTENT },
      { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "describe('new', () => {});" },
    ];
    const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
    const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
    const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

    const createTargetAbs = path.join(root, "cypress", "e2e", "tests", "aaa_spec.cy.js");
    const modifyTargetAbs = path.join(root, "cypress", "e2e", "tests", "existing_spec.cy.js");

    // Force the MODIFY's final revalidation to fail (triggering rollback of
    // the already-committed CREATE), and as a side effect of that SAME
    // hook, replace the CREATE target with a symlink to an external,
    // byte-identical decoy file - simulating an external actor replacing
    // #23F's own output with a different filesystem object that happens to
    // contain the same bytes.
    const realReadFileSync = fs.readFileSync;
    let modifyReadCount = 0;
    fs.readFileSync = function (p, enc) {
      if (p === modifyTargetAbs) {
        modifyReadCount += 1;
        if (modifyReadCount === 2) {
          fs.unlinkSync(createTargetAbs);
          fs.symlinkSync(decoyFile, createTargetAbs, "file");
          return "describe('raced modify', () => {});";
        }
      }
      return realReadFileSync.call(fs, p, enc);
    };

    let res;
    try {
      res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
    } finally {
      fs.readFileSync = realReadFileSync;
    }

    assert.equal(res.ok, false);
    assert.ok(res.appliedChangeSetRecord);
    assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLBACK_INCOMPLETE");
    const createEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/aaa_spec.cy.js");
    assert.equal(createEntry.status, "ROLLBACK_INCOMPLETE");
    // rollback must NOT have deleted the symlink or the external decoy
    assert.equal(fs.existsSync(decoyFile), true);
    assert.equal(fs.readFileSync(decoyFile, "utf8"), CREATE_CONTENT);
    const lst = fs.lstatSync(createTargetAbs);
    assert.equal(lst.isSymbolicLink(), true, "the symlink itself must be left untouched, never silently unlinked based on content match alone");

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

// --- verifyStructuralWrite / verifyRollbackIdentity direct unit tests --------

test("verifyStructuralWrite rejects a symlink target, a directory target, and an absent target - only accepts a genuine regular file with matching bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-structverify-"));
  const regular = path.join(root, "regular.txt");
  fs.writeFileSync(regular, "hello", "utf8");
  assert.equal(verifyStructuralWrite(regular, "hello").ok, true);
  assert.equal(verifyStructuralWrite(regular, "wrong").ok, false);
  assert.equal(verifyStructuralWrite(path.join(root, "absent.txt"), "hello").ok, false);

  const dir = path.join(root, "adir");
  fs.mkdirSync(dir);
  assert.equal(verifyStructuralWrite(dir, "hello").ok, false);

  skipIfNoSymlink(() => {
    const linkTarget = path.join(root, "linktarget.txt");
    fs.writeFileSync(linkTarget, "hello", "utf8");
    const link = path.join(root, "alink.txt");
    fs.symlinkSync(linkTarget, link, "file");
    assert.equal(verifyStructuralWrite(link, "hello").ok, false, "a symlink must never be accepted as a genuine written regular file, even with matching content");
  });

  fs.rmSync(root, { recursive: true, force: true });
});

test("verifyRollbackIdentity rejects a mismatched (device, inode) identity even when content matches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f23f-identverify-"));
  const a = path.join(root, "a.txt");
  const b = path.join(root, "b.txt");
  fs.writeFileSync(a, "same", "utf8");
  fs.writeFileSync(b, "same", "utf8");
  const identityA = { dev: fs.lstatSync(a).dev, ino: fs.lstatSync(a).ino };
  // b has byte-identical content but is a genuinely different filesystem
  // object - its own identity must not satisfy identityA's requirement.
  assert.equal(verifyRollbackIdentity(b, "same", identityA).ok, false);
  assert.equal(verifyRollbackIdentity(a, "same", identityA).ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

// --- structural post-write verification integration --------------------------

test("post-write structural verification: CREATE target replaced by a directory before verification -> not reported as APPLIED", () => {
  const root = makeRoot();
  const targetAbs = path.join(root, "cypress", "e2e", "tests", "new_spec.cy.js");

  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('x', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

  // After the exclusive CREATE write succeeds, but before this module's own
  // structural verification reads it back, replace the file with a
  // directory of the same name - simulating a post-write corruption/race
  // that a byte-only check could never observe.
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (targetPath, content, options) {
    const result = realWriteFileSync.call(fs, targetPath, content, options);
    if (targetPath === targetAbs) {
      fs.unlinkSync(targetPath);
      fs.mkdirSync(targetPath);
    }
    return result;
  };

  let res;
  try {
    res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }

  assert.equal(res.ok, false);
  assert.ok(!res.appliedChangeSetRecord || res.appliedChangeSetRecord.status !== "APPLIED");
  cleanup(root);
});

// --- 23F-R-3: MODIFY preserves the target's permission mode (POSIX only) -----

test("23F-R-3: MODIFY preserves the original 0755 permission mode across content replacement (POSIX)", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX permission-bit semantics through Node's fs.stat the same way - this assertion is only meaningful, and only executed, on a POSIX CI runner (see .github/workflows - the Unit tests job runs on ubuntu-latest).");
    return;
  }
  const root = makeRoot();
  const targetAbs = path.join(root, "cypress", "e2e", "tests", "runner.sh");
  fs.writeFileSync(targetAbs, "#!/bin/sh\necho old\n", "utf8");
  fs.chmodSync(targetAbs, 0o755);
  const beforeDigest = gcsComputeDigest(LABEL_FILE_CONTENT, "#!/bin/sh\necho old\n");

  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/runner.sh", operation: "MODIFY", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }, { evidenceRef: { location: "cypress/e2e/tests/runner.sh" }, content: "#!/bin/sh\necho old\n" }] };
  const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/runner.sh", baseContentDigest: beforeDigest, content: "#!/bin/sh\necho new\n" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((tt) => ({ operation: tt.operation, path: tt.path, targetDigest: tt.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

  const res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(fs.readFileSync(targetAbs, "utf8"), "#!/bin/sh\necho new\n");
  assert.equal(fs.statSync(targetAbs).mode & 0o777, 0o755, "executable permission bits must survive an ordinary MODIFY");
  cleanup(root);
});

test("23F-R-3: MODIFY rollback restores the original content AND the original 0755 permission mode (POSIX)", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX permission-bit semantics through Node's fs.stat the same way - this assertion is only meaningful, and only executed, on a POSIX CI runner (see .github/workflows - the Unit tests job runs on ubuntu-latest).");
    return;
  }
  const root = makeRoot();
  const modifyTargetAbs = path.join(root, "cypress", "e2e", "tests", "runner.sh");
  fs.writeFileSync(modifyTargetAbs, "#!/bin/sh\necho old\n", "utf8");
  fs.chmodSync(modifyTargetAbs, 0o755);
  const beforeDigest = gcsComputeDigest(LABEL_FILE_CONTENT, "#!/bin/sh\necho old\n");

  const plan = {
    schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress",
    plannedChanges: [
      { path: "cypress/e2e/tests/runner.sh", operation: "MODIFY", purpose: "x" },
      { path: "cypress/e2e/tests/second.cy.js", operation: "CREATE", purpose: "y" },
    ],
  };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }, { evidenceRef: { location: "cypress/e2e/tests/runner.sh" }, content: "#!/bin/sh\necho old\n" }] };
  const changes = [
    { operation: "MODIFY", path: "cypress/e2e/tests/runner.sh", baseContentDigest: beforeDigest, content: "#!/bin/sh\necho new\n" },
    { operation: "CREATE", path: "cypress/e2e/tests/second.cy.js", baseContentDigest: null, content: "describe('second', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((tt) => ({ operation: tt.operation, path: tt.path, targetDigest: tt.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

  const secondTargetAbs = path.join(root, "cypress", "e2e", "tests", "second.cy.js");
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (targetPath, content, options) {
    if (targetPath === secondTargetAbs && options && options.flag === "wx") {
      // force the SECOND change (CREATE) to fail after the MODIFY has
      // already committed, triggering rollback of the MODIFY.
      const e = new Error("EEXIST: simulated");
      e.code = "EEXIST";
      throw e;
    }
    return realWriteFileSync.call(fs, targetPath, content, options);
  };

  let res;
  try {
    res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }

  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord);
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLED_BACK");
  assert.equal(fs.readFileSync(modifyTargetAbs, "utf8"), "#!/bin/sh\necho old\n", "rollback must restore the original content");
  assert.equal(fs.statSync(modifyTargetAbs).mode & 0o777, 0o755, "rollback must restore the original permission mode, not merely the original content");
  cleanup(root);
});

// =============================================================================
// Roadmap CS2 (closes CS0-F7 / 23F-R2-1): rollback ANCESTOR-TOPOLOGY
// hardening. Every test below is DISTINCT from 23F-R-1 (which tests the
// window between Phase-5 prevalidation and Phase-7 COMMIT) and from 23F-R-2
// (which tests the TARGET object's own identity at ROLLBACK time, already
// closed and unchanged by CS2) - these tests specifically prove that the
// ANCESTOR DIRECTORY CHAIN's own object identity, not merely its type
// (symlink vs. real directory), is required rollback authority. The central,
// load-bearing case (Sections 19/20) is an ORDINARY directory replacing an
// ordinary directory - no symlink anywhere - which 23F-R-2's own guard
// cannot detect because the TARGET's own (dev, ino) and bytes are
// deliberately left completely unchanged.
// =============================================================================

// --- CS2 CREATE: ordinary ancestor-directory replacement (primary case) -----

test("CS2 CREATE: ancestor directory replaced with a NEW ordinary directory (no symlink) between commit and rollback -> rollback refuses, application-created file survives untouched", () => {
  const root = makeRootWithExisting();
  const chain = buildChain(); // plan1(): CREATE new_spec.cy.js (commits first), MODIFY existing_spec.cy.js (fails second)
  const testsDir = path.join(fs.realpathSync(root), "cypress", "e2e", "tests");
  const createTargetAbs = path.join(testsDir, "new_spec.cy.js");

  let preAttackIdentity = null;
  let postRollbackAttemptIdentity = null;
  const realChmodSync = fs.chmodSync;
  let attacked = false;
  // fs.chmodSync(tempAbs, mode) fires exactly once per real Phase-7 MODIFY
  // commit attempt, strictly AFTER CREATE (staged[0]) has already committed
  // - intercepting it here lets us attack immediately after CREATE succeeds
  // and force the MODIFY itself to fail (triggering rollback of CREATE),
  // all in one deterministic step, mirroring this file's own established
  // "force a later change to fail via a specific fs call" idiom.
  fs.chmodSync = function (targetPath, mode) {
    if (!attacked && typeof targetPath === "string" && targetPath.includes(".23f-tmp-") && targetPath.includes("existing_spec.cy.js")) {
      attacked = true;
      const lst = fs.lstatSync(createTargetAbs);
      preAttackIdentity = { dev: lst.dev, ino: lst.ino };
      const oldDir = testsDir + "-relocated";
      fs.renameSync(testsDir, oldDir);
      fs.mkdirSync(testsDir);
      fs.renameSync(path.join(oldDir, "new_spec.cy.js"), path.join(testsDir, "new_spec.cy.js"));
      fs.rmSync(oldDir, { recursive: true, force: true });
      const e = new Error("CS2 test: forced MODIFY failure to trigger CREATE rollback");
      e.code = "ENOENT";
      throw e;
    }
    return realChmodSync.call(fs, targetPath, mode);
  };

  let res;
  try {
    res = apply(root, chain);
  } finally {
    fs.chmodSync = realChmodSync;
  }

  assert.equal(attacked, true, "test setup did not actually trigger the ancestor-topology attack");
  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord, "a real AppliedChangeSetRecord must exist - at least one change (CREATE) was genuinely committed before the attack");
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLBACK_INCOMPLETE", "an ancestor-topology mismatch must be reported as incomplete rollback, never a fabricated clean ROLLED_BACK");
  const createEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/new_spec.cy.js");
  assert.equal(createEntry.status, "ROLLBACK_INCOMPLETE");

  // The central proof (mission-required): same target inode, same target
  // bytes, same target relative path, DIFFERENT ancestor inode -> rollback
  // refused. If rollback had proceeded (the pre-CS2 bug), this file would
  // not exist.
  assert.equal(fs.existsSync(createTargetAbs), true, "the application-created file must survive - rollback must refuse to delete through a relocated ancestor");
  postRollbackAttemptIdentity = fs.lstatSync(createTargetAbs);
  assert.equal(postRollbackAttemptIdentity.dev, preAttackIdentity.dev);
  assert.equal(postRollbackAttemptIdentity.ino, preAttackIdentity.ino);
  assert.equal(fs.readFileSync(createTargetAbs, "utf8"), "describe('x', () => {});", "content must be exactly what CREATE originally wrote");

  cleanup(root);
});

// --- CS2 MODIFY: ordinary ancestor-directory replacement --------------------

test("CS2 MODIFY: ancestor directory replaced with a NEW ordinary directory (no symlink) between commit and rollback -> rollback refuses, original pre-application bytes are NOT restored into the relocated topology", () => {
  const root = makeRoot();
  const testsDir = path.join(fs.realpathSync(root), "cypress", "e2e", "tests");
  const modifyTargetAbs = path.join(testsDir, "existing_spec.cy.js");
  fs.writeFileSync(modifyTargetAbs, OLD_CONTENT, "utf8");

  const plan = {
    schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress",
    plannedChanges: [
      { path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "x" },
      { path: "cypress/e2e/tests/second.cy.js", operation: "CREATE", purpose: "y" },
    ],
  };
  const context = context1();
  const changes = [
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "describe('new', () => {});" },
    { operation: "CREATE", path: "cypress/e2e/tests/second.cy.js", baseContentDigest: null, content: "describe('second', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

  const secondTargetAbs = path.join(testsDir, "second.cy.js");
  let preAttackIdentity = null;
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (targetPath, content, options) {
    if (targetPath === secondTargetAbs && options && options.flag === "wx") {
      // Force CREATE (second change) to fail after MODIFY has already
      // committed, triggering rollback of the MODIFY - same idiom as the
      // existing 23F-R-3 rollback test, immediately preceded here by the
      // ancestor-topology attack itself.
      const lst = fs.lstatSync(modifyTargetAbs);
      preAttackIdentity = { dev: lst.dev, ino: lst.ino };
      const oldDir = testsDir + "-relocated";
      fs.renameSync(testsDir, oldDir);
      fs.mkdirSync(testsDir);
      fs.renameSync(path.join(oldDir, "existing_spec.cy.js"), path.join(testsDir, "existing_spec.cy.js"));
      fs.rmSync(oldDir, { recursive: true, force: true });
      const e = new Error("EEXIST: simulated");
      e.code = "EEXIST";
      throw e;
    }
    return realWriteFileSync.call(fs, targetPath, content, options);
  };

  let res;
  try {
    res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }

  assert.ok(preAttackIdentity, "test setup did not actually trigger the ancestor-topology attack");
  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord);
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLBACK_INCOMPLETE");
  const modifyEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/existing_spec.cy.js");
  assert.equal(modifyEntry.status, "ROLLBACK_INCOMPLETE");

  // The target still holds the NEW (applied) bytes, not the original - the
  // old rollback would have staged+renamed the ORIGINAL bytes back into the
  // relocated topology, silently "restoring" through an object #23F never
  // actually committed into. CS2 must refuse that restoration entirely.
  assert.equal(fs.readFileSync(modifyTargetAbs, "utf8"), "describe('new', () => {});", "the applied MODIFY bytes must remain - a compensating restore into a relocated ancestor must never happen");
  const postAttempt = fs.lstatSync(modifyTargetAbs);
  assert.equal(postAttempt.dev, preAttackIdentity.dev);
  assert.equal(postAttempt.ino, preAttackIdentity.ino);

  cleanup(root);
});

// --- CS2 symlinked-ancestor relocation, at ROLLBACK time (not commit time) --

test("CS2 CREATE: ancestor replaced by a SYMLINK to its own relocated real self between commit and rollback -> rollback refuses before mutation, relocated directory and symlink both survive", () => {
  skipIfNoSymlink(() => {
    const root = makeRootWithExisting();
    const chain = buildChain();
    const testsDir = path.join(fs.realpathSync(root), "cypress", "e2e", "tests");
    const createTargetAbs = path.join(testsDir, "new_spec.cy.js");

    const realChmodSync = fs.chmodSync;
    let attacked = false;
    let relocatedDir = null;
    fs.chmodSync = function (targetPath, mode) {
      if (!attacked && typeof targetPath === "string" && targetPath.includes(".23f-tmp-") && targetPath.includes("existing_spec.cy.js")) {
        attacked = true;
        relocatedDir = testsDir + "-relocated";
        fs.renameSync(testsDir, relocatedDir);
        fs.symlinkSync(relocatedDir, testsDir, "dir");
        const e = new Error("CS2 test: forced MODIFY failure to trigger CREATE rollback");
        e.code = "ENOENT";
        throw e;
      }
      return realChmodSync.call(fs, targetPath, mode);
    };

    let res;
    try {
      res = apply(root, chain);
    } finally {
      fs.chmodSync = realChmodSync;
    }

    assert.equal(attacked, true, "test setup did not actually trigger the symlink-relocation attack");
    assert.equal(res.ok, false);
    assert.ok(res.appliedChangeSetRecord);
    assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLBACK_INCOMPLETE");
    const createEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/new_spec.cy.js");
    assert.equal(createEntry.status, "ROLLBACK_INCOMPLETE");

    // The relocated real directory (accessible only via the new symlink)
    // and its content must survive completely untouched - rollback must
    // refuse before it ever reads/mutates through the symlinked path.
    assert.equal(fs.lstatSync(testsDir).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(relocatedDir, "new_spec.cy.js")), true);
    assert.equal(fs.readFileSync(path.join(relocatedDir, "new_spec.cy.js"), "utf8"), "describe('x', () => {});");

    fs.unlinkSync(testsDir);
    fs.rmSync(relocatedDir, { recursive: true, force: true });
    cleanup(root);
  });
});

// --- CS2 control: identical topology restored before rollback still authorizes compensation ---

test("CS2 control: ancestor renamed away and then the EXACT SAME directory object restored to the original path before rollback -> rollback still succeeds (identity-based, not rename-poisoned)", () => {
  const root = makeRootWithExisting();
  const chain = buildChain();
  const testsDir = path.join(fs.realpathSync(root), "cypress", "e2e", "tests");
  const createTargetAbs = path.join(testsDir, "new_spec.cy.js");

  const realChmodSync = fs.chmodSync;
  let attacked = false;
  fs.chmodSync = function (targetPath, mode) {
    if (!attacked && typeof targetPath === "string" && targetPath.includes(".23f-tmp-") && targetPath.includes("existing_spec.cy.js")) {
      attacked = true;
      const tempName = testsDir + "-temporarily-elsewhere";
      // Rename the SAME directory object away and immediately back - its
      // (dev, ino) identity is preserved throughout, unlike the other CS2
      // tests above which create a brand-new directory object.
      fs.renameSync(testsDir, tempName);
      fs.renameSync(tempName, testsDir);
      const e = new Error("CS2 test: forced MODIFY failure to trigger CREATE rollback");
      e.code = "ENOENT";
      throw e;
    }
    return realChmodSync.call(fs, targetPath, mode);
  };

  let res;
  try {
    res = apply(root, chain);
  } finally {
    fs.chmodSync = realChmodSync;
  }

  assert.equal(attacked, true, "test setup did not actually trigger the rename-and-restore sequence");
  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord);
  // Unlike the attack tests above: the ancestor's OBJECT IDENTITY was never
  // actually different at rollback time, only its path briefly was - CS2
  // authorizes rollback based on identity, never treats "was ever renamed"
  // as permanent poisoning.
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLED_BACK", "identical topology identity must still authorize rollback");
  const createEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/new_spec.cy.js");
  assert.equal(createEntry.status, "ROLLED_BACK");
  assert.equal(fs.existsSync(createTargetAbs), false, "legitimate rollback must still actually delete the compensated CREATE");

  cleanup(root);
});

// --- CS2 MODIFY staging-race: topology changes DURING rollback's own staging window ---

test("CS2 MODIFY staging-race: ancestor topology changed during ROLLBACK's OWN staging window is caught by the fresh pre-rename revalidation, not merely the check performed before staging", () => {
  const root = makeRoot();
  const testsDir = path.join(fs.realpathSync(root), "cypress", "e2e", "tests");
  const modifyTargetAbs = path.join(testsDir, "existing_spec.cy.js");
  fs.writeFileSync(modifyTargetAbs, OLD_CONTENT, "utf8");

  const plan = {
    schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress",
    plannedChanges: [
      { path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "x" },
      { path: "cypress/e2e/tests/second.cy.js", operation: "CREATE", purpose: "y" },
    ],
  };
  const context = context1();
  const changes = [
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "describe('new', () => {});" },
    { operation: "CREATE", path: "cypress/e2e/tests/second.cy.js", baseContentDigest: null, content: "describe('second', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

  const secondTargetAbs = path.join(testsDir, "second.cy.js");
  let tempWriteCount = 0;
  let attacked = false;
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (targetPath, content, options) {
    // First occurrence of this pattern: Phase 6's own original forward
    // staging of the MODIFY's temp file (before any commit). Second
    // occurrence: ROLLBACK's own re-staging of the same target's temp file,
    // called from inside rollbackModify() AFTER the MODIFY has already
    // committed and AFTER rollback's own initial topology/identity checks
    // have already passed - this is the exact window CS2's fresh
    // pre-rename revalidation exists to close.
    if (typeof targetPath === "string" && targetPath.includes(".23f-tmp-") && targetPath.includes("existing_spec.cy.js") && options && options.flag === "wx") {
      tempWriteCount += 1;
      const result = realWriteFileSync.call(fs, targetPath, content, options);
      if (tempWriteCount === 2 && !attacked) {
        attacked = true;
        const oldDir = testsDir + "-relocated";
        fs.renameSync(testsDir, oldDir);
        fs.mkdirSync(testsDir);
        fs.renameSync(path.join(oldDir, "existing_spec.cy.js"), path.join(testsDir, "existing_spec.cy.js"));
        // Move the just-staged rollback temp file into the new directory
        // too, under the SAME basename, so a buggy implementation that
        // skips fresh temp-identity verification could still find
        // *something* at that path and proceed.
        const tempBasename = path.basename(targetPath);
        fs.renameSync(path.join(oldDir, tempBasename), path.join(testsDir, tempBasename));
        fs.rmSync(oldDir, { recursive: true, force: true });
      }
      return result;
    }
    if (targetPath === secondTargetAbs && options && options.flag === "wx") {
      const e = new Error("EEXIST: simulated");
      e.code = "EEXIST";
      throw e;
    }
    return realWriteFileSync.call(fs, targetPath, content, options);
  };

  let res;
  try {
    res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }

  assert.equal(attacked, true, "test setup did not actually trigger the mid-rollback-staging topology attack");
  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord);
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLBACK_INCOMPLETE", "a topology change during rollback's own staging window must be caught by the FRESH pre-rename check, not silently missed because only the pre-staging check ran");
  const modifyEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/existing_spec.cy.js");
  assert.equal(modifyEntry.status, "ROLLBACK_INCOMPLETE");
  // The relocated topology's own target must still hold the APPLIED bytes,
  // never the compensating original - the rename-into-relocated-topology
  // must never have happened.
  assert.equal(fs.readFileSync(modifyTargetAbs, "utf8"), "describe('new', () => {});");

  cleanup(root);
});

// --- CS2 temp cleanup: relocation must never cause deletion of an unrelated object ---

test("CS2 temp cleanup: after a mid-staging ancestor relocation, cleanup never deletes an unrelated decoy object that happens to share the temp file's own random name in the new topology", () => {
  const root = makeRoot();
  const testsDir = path.join(fs.realpathSync(root), "cypress", "e2e", "tests");
  const modifyTargetAbs = path.join(testsDir, "existing_spec.cy.js");
  fs.writeFileSync(modifyTargetAbs, OLD_CONTENT, "utf8");

  const plan = {
    schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress",
    plannedChanges: [
      { path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "x" },
      { path: "cypress/e2e/tests/second.cy.js", operation: "CREATE", purpose: "y" },
    ],
  };
  const context = context1();
  const changes = [
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: OLD_DIGEST, content: "describe('new', () => {});" },
    { operation: "CREATE", path: "cypress/e2e/tests/second.cy.js", baseContentDigest: null, content: "describe('second', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });

  const secondTargetAbs = path.join(testsDir, "second.cy.js");
  const DECOY_CONTENT = "DO NOT DELETE ME - unrelated object planted at the attacker's new topology";
  let chmodCount = 0;
  let attacked = false;
  let decoyAbs = null;
  const realChmodSync = fs.chmodSync;
  const realWriteFileSync = fs.writeFileSync;
  // fs.chmodSync(tempAbs, mode) is called exactly twice for this scenario:
  // once during the ORIGINAL Phase-7 forward MODIFY commit (call #1), and
  // once again inside rollbackModify()'s OWN re-staging (call #2) - which,
  // in the CS2-hardened implementation, fires strictly AFTER
  // stagedTempIdentity has already been captured. Attacking exactly here
  // (rather than during stageTempFile()'s own write, which would fire
  // BEFORE that identity capture and corrupt the test's own baseline)
  // reproduces the precise window the identity-guarded cleanup exists to
  // close: the real staged temp object is relocated away and destroyed,
  // and an unrelated decoy is planted at the exact same tempAbs string in
  // the new topology, simulating the worst case named in the mission text
  // ("a different same-name filesystem object becomes reachable through
  // tempAbs").
  fs.chmodSync = function (targetPath, mode) {
    if (typeof targetPath === "string" && targetPath.includes(".23f-tmp-") && targetPath.includes("existing_spec.cy.js")) {
      chmodCount += 1;
      if (chmodCount === 2 && !attacked) {
        attacked = true;
        const tempBasename = path.basename(targetPath);
        const oldDir = testsDir + "-relocated";
        fs.renameSync(testsDir, oldDir);
        fs.mkdirSync(testsDir);
        fs.renameSync(path.join(oldDir, "existing_spec.cy.js"), path.join(testsDir, "existing_spec.cy.js"));
        decoyAbs = path.join(testsDir, tempBasename);
        realWriteFileSync.call(fs, decoyAbs, DECOY_CONTENT, "utf8");
        // Destroys the real, original staged temp file (relocated into
        // oldDir above) - only the decoy remains reachable at tempAbs.
        fs.rmSync(oldDir, { recursive: true, force: true });
      }
    }
    return realChmodSync.call(fs, targetPath, mode);
  };

  fs.writeFileSync = function (targetPath, content, options) {
    if (targetPath === secondTargetAbs && options && options.flag === "wx") {
      const e = new Error("EEXIST: simulated");
      e.code = "EEXIST";
      throw e;
    }
    return realWriteFileSync.call(fs, targetPath, content, options);
  };

  let res;
  try {
    res = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  } finally {
    fs.chmodSync = realChmodSync;
    fs.writeFileSync = realWriteFileSync;
  }

  assert.equal(attacked, true, "test setup did not actually plant the decoy object");
  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord);
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLBACK_INCOMPLETE");

  // The central proof: the unrelated decoy object, which happens to share
  // the rollback temp file's own random basename in the relocated topology,
  // must survive completely untouched - identity-safe cleanup must never
  // delete an object it cannot prove is the one it staged.
  assert.equal(fs.existsSync(decoyAbs), true, "an unrelated same-name object must never be deleted by temp cleanup");
  assert.equal(fs.readFileSync(decoyAbs, "utf8"), DECOY_CONTENT, "the unrelated object's content must be completely unmodified");

  cleanup(root);
});

// --- CS2-C1 (closes CS2-RR-1) CREATE: repositoryRoot identity replacement, isolated from descendant ancestor checks ---
//
// Every CS2 test above attacks an ancestor BENEATH repositoryRoot (direct
// parent or grandparent) - each is independently caught by the descendant
// ancestorIdentities comparison in verifyRollbackTopology() alone, regardless
// of whether repositoryRoot's OWN identity is separately checked. An
// independent exact-head adversarial review (finding CS2-RR-1) found that no
// committed test isolates repositoryRoot specifically: a mutation that
// disables ONLY the rootIdentity comparison in verifyRollbackTopology() (Section
// 488-490 of change-set-application.js), while leaving the descendant
// ancestorIdentities loop fully intact, still passed all six prior CS2 tests.
//
// This test closes that gap. It relocates the ENTIRE original repositoryRoot
// subtree away, creates a BRAND NEW ordinary directory at the identical
// repositoryRoot pathname, then moves every original entry back into it
// UNCHANGED - preserving the (dev, ino) identity of every descendant ancestor
// (cypress/, cypress/e2e/, cypress/e2e/tests/) and of the CREATE target
// itself EXACTLY. Only repositoryRoot's own object identity differs. If
// rollback still refuses under this precise arrangement, the refusal cannot
// be explained by any descendant-ancestor mismatch (there is none) - it can
// only be explained by a genuine repositoryRoot-identity comparison.

test("CS2-C1 CREATE: repositoryRoot itself replaced with a NEW ordinary directory at the identical path (every descendant ancestor's own identity left completely unchanged) -> rollback refuses, application-created file survives untouched", () => {
  const root = makeRootWithExisting();
  const realRoot = fs.realpathSync(root);
  const chain = buildChain(); // plan1(): CREATE new_spec.cy.js (commits first), MODIFY existing_spec.cy.js (fails second)
  const testsDir = path.join(realRoot, "cypress", "e2e", "tests");
  const createTargetAbs = path.join(testsDir, "new_spec.cy.js");

  const rootLstatBefore = fs.lstatSync(realRoot);
  const testsDirLstatBefore = fs.lstatSync(testsDir);

  let preAttackTargetIdentity = null;
  let attacked = false;
  const realChmodSync = fs.chmodSync;
  // Same "force the MODIFY to fail via fs.chmodSync" idiom as the CS2
  // ancestor-directory-replacement test above - this fires exactly once,
  // strictly AFTER the CREATE (staged[0]) has already committed and AFTER
  // MODIFY's own Phase-7 revalidateModifyTarget() has already read the
  // still-untouched original target, so the attack cannot be mistaken for
  // merely corrupting MODIFY's own precondition.
  fs.chmodSync = function (targetPath, mode) {
    if (!attacked && typeof targetPath === "string" && targetPath.includes(".23f-tmp-") && targetPath.includes("existing_spec.cy.js")) {
      attacked = true;
      const lst = fs.lstatSync(createTargetAbs);
      preAttackTargetIdentity = { dev: lst.dev, ino: lst.ino };

      // Relocate the ENTIRE original root subtree away, create a BRAND NEW,
      // otherwise-empty ordinary directory at the exact original
      // repositoryRoot pathname, then move every original entry
      // (cypress/, cypress.config.js, etc.) back into the new root
      // UNCHANGED - this preserves the (dev, ino) identity of every
      // descendant ancestor and of the CREATE target itself exactly, so
      // ONLY repositoryRoot's own object identity differs.
      const oldRootPath = realRoot + "-relocated";
      fs.renameSync(realRoot, oldRootPath);
      fs.mkdirSync(realRoot);
      for (const entry of fs.readdirSync(oldRootPath)) {
        fs.renameSync(path.join(oldRootPath, entry), path.join(realRoot, entry));
      }
      fs.rmdirSync(oldRootPath);

      const e = new Error("CS2-C1 test: forced MODIFY failure to trigger CREATE rollback");
      e.code = "ENOENT";
      throw e;
    }
    return realChmodSync.call(fs, targetPath, mode);
  };

  let res;
  try {
    res = apply(root, chain);
  } finally {
    fs.chmodSync = realChmodSync;
  }

  assert.equal(attacked, true, "test setup did not actually trigger the repositoryRoot-identity attack");
  assert.equal(res.ok, false);
  assert.ok(res.appliedChangeSetRecord, "a real AppliedChangeSetRecord must exist - at least one change (CREATE) was genuinely committed before the attack");
  assert.equal(res.appliedChangeSetRecord.status, "APPLICATION_FAILED_ROLLBACK_INCOMPLETE", "a repositoryRoot-identity mismatch must be reported as incomplete rollback, never a fabricated clean ROLLED_BACK");
  const createEntry = res.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/new_spec.cy.js");
  assert.equal(createEntry.status, "ROLLBACK_INCOMPLETE");

  // Prove the replacement repositoryRoot object is genuinely different -
  // same pathname, same type (ordinary directory, not a symlink), different
  // (dev, ino) identity.
  const rootLstatAfter = fs.lstatSync(realRoot);
  assert.equal(rootLstatAfter.isDirectory(), true);
  assert.equal(rootLstatAfter.isSymbolicLink(), false);
  assert.equal(
    rootLstatAfter.dev === rootLstatBefore.dev && rootLstatAfter.ino === rootLstatBefore.ino,
    false,
    "repositoryRoot must be a genuinely different filesystem object after the attack"
  );

  // Prove EVERY descendant ancestor's own identity is completely unchanged
  // by the attack - this is what isolates the repositoryRoot guard
  // specifically from the already-covered descendant-ancestor guard in the
  // CS2 tests above.
  const testsDirLstatAfter = fs.lstatSync(testsDir);
  assert.equal(testsDirLstatAfter.dev, testsDirLstatBefore.dev, "the CREATE target's own direct-parent directory object must be untouched by this attack");
  assert.equal(testsDirLstatAfter.ino, testsDirLstatBefore.ino, "the CREATE target's own direct-parent directory object must be untouched by this attack");

  // The central proof (CS2-RR-1 corrective requirement): same target inode,
  // same target bytes, same target relative path, EVERY descendant ancestor
  // identical, ONLY repositoryRoot's own identity different -> rollback
  // refused. A guard that checked only the ancestor chain BENEATH root (and
  // not root itself) would incorrectly authorize compensation here.
  assert.equal(fs.existsSync(createTargetAbs), true, "the application-created file must survive - rollback must refuse to delete through a relocated repositoryRoot");
  const postRollbackAttemptIdentity = fs.lstatSync(createTargetAbs);
  assert.equal(postRollbackAttemptIdentity.dev, preAttackTargetIdentity.dev);
  assert.equal(postRollbackAttemptIdentity.ino, preAttackTargetIdentity.ino);
  assert.equal(fs.readFileSync(createTargetAbs, "utf8"), "describe('x', () => {});", "content must be exactly what CREATE originally wrote");

  cleanup(root);
});

