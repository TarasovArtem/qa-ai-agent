"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const { buildGeneratedChangeSet, computeDigest: gcsComputeDigest, LABEL_FILE_CONTENT } = require("./generated-change-set");
const { buildGeneratedChangeSetReviewPackage } = require("./generated-change-set-review-package");
const { buildGeneratedChangeSetReviewRecord } = require("./generated-change-set-review-record");
const { applyApprovedGeneratedChangeSet } = require("./change-set-application");
const { computeDigest: aerComputeDigest, DIGEST_LABEL_RECORD: AER_DIGEST_LABEL } = require("./automation-execution-record");

const {
  MAX_EXECUTION_TIMEOUT_MS,
  MAX_STDOUT_BYTES,
  MAX_STDERR_BYTES,
  ENV_ALLOWLIST,
  resolveLocalBinary,
  deriveExecutionTargets,
  escapeRegexLiteral,
  buildPlaywrightExactTargetPattern,
  CYPRESS_SAFE_TARGET_PATH,
  buildExecutionEnvironment,
  selectExecutionCommand,
  resolveExecutionTimeout,
  runBoundedProcess,
  revalidateAppliedState,
  executeAppliedChangeSet,
} = require("./controlled-execution");

const APPLIED_AT = "2026-08-28T11:00:00.000Z";
const EXECUTED_AT = "2026-08-28T12:00:00.000Z";

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "g23g-ce-test-"));
  fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
  return root;
}

function plan1() {
  return { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "x" }] };
}
function context1() {
  return { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
}

function buildChain(root, { planOverrides, contextOverrides } = {}) {
  const plan = { ...plan1(), ...planOverrides };
  const context = { ...context1(), ...contextOverrides };
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('x', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(pkgResult.ok, true, JSON.stringify(pkgResult.errors));
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  const applyResult = applyApprovedGeneratedChangeSet({
    expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context,
    generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord,
    appliedAt: APPLIED_AT,
  });
  assert.equal(applyResult.ok, true, JSON.stringify(applyResult.errors));
  return { plan, context, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord };
}

function withMockSpawn(fn) {
  const real = childProcess.spawn;
  let call = null;
  childProcess.spawn = (executable, args, options) => {
    call = { executable, args, options };
    const { EventEmitter } = require("node:events");
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from("1 passing\n"));
      child.emit("close", 0);
    });
    return child;
  };
  return fn(() => call).finally(() => {
    childProcess.spawn = real;
  });
}

// --- happy path -------------------------------------------------------------

test("valid APPLIED chain executes a TARGETED argv (--spec <exact applied path>), shell disabled, cwd = realpath(repositoryRoot), env is the minimal allowlist (never full process.env)", async () => {
  const root = makeRoot();
  const chain = buildChain(root);
  process.env.QA_23GC1_UNALLOWLISTED_SENTINEL = "must-never-reach-child-env-object";
  await withMockSpawn(async (getCall) => {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    assert.equal(res.automationExecutionRecord.status, "PASSED");
    assert.equal(res.automationExecutionRecord.exitCode, 0);
    const call = getCall();
    assert.equal(call.executable, resolveLocalBinary(fs.realpathSync(root), "cypress"));
    assert.deepEqual(call.args, ["run", "--headless", "--browser", "chrome", "--spec", "cypress/e2e/tests/new_spec.cy.js"]);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.cwd, fs.realpathSync(root));
    assert.ok(!("QA_23GC1_UNALLOWLISTED_SENTINEL" in call.options.env), "child env must never carry an unallowlisted variable, even one this test process itself has set");
    assert.notEqual(call.options.env, process.env, "child env must be a distinct, minimized object - never the orchestrator's own full process.env passed through");
  });
  delete process.env.QA_23GC1_UNALLOWLISTED_SENTINEL;
  fs.rmSync(root, { recursive: true, force: true });
});

test("playwright plan selects the playwright command", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "g23g-ce-pw-"));
  fs.mkdirSync(path.join(root, "playwright", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "playwright.config.js"), "module.exports = {};", "utf8");
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "playwright", plannedChanges: [{ path: "playwright/tests/new_spec.spec.js", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "playwright", repositoryEvidence: [{ evidenceRef: { location: "playwright.config.js" }, content: "module.exports = {};" }] };
  const changes = [{ operation: "CREATE", path: "playwright/tests/new_spec.spec.js", baseContentDigest: null, content: "test('x', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(pkgResult.ok, true, JSON.stringify(pkgResult.errors));
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  const applyResult = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  assert.equal(applyResult.ok, true, JSON.stringify(applyResult.errors));

  await withMockSpawn(async (getCall) => {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    const call = getCall();
    const realRoot = fs.realpathSync(root);
    assert.equal(call.executable, resolveLocalBinary(realRoot, "playwright"));
    assert.deepEqual(call.args, ["test", "--config=playwright.config.js", "--project=chromium", buildPlaywrightExactTargetPattern(realRoot, "playwright/tests/new_spec.spec.js")]);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("a changeset that only touches a non-executable support/helper path is rejected with NO_EXECUTABLE_TEST_TARGET, zero spawn", async () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, "cypress", "support"), { recursive: true });
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/support/commands.js", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [{ operation: "CREATE", path: "cypress/support/commands.js", baseContentDigest: null, content: "Cypress.Commands.add('x', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const applyResult = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  assert.equal(applyResult.ok, true, JSON.stringify(applyResult.errors));

  const realSpawn = childProcess.spawn;
  let spawnCalled = false;
  childProcess.spawn = () => { spawnCalled = true; throw new Error("must not spawn"); };
  try {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, false);
    assert.equal(spawnCalled, false);
    assert.ok(JSON.stringify(res.errors).includes("NO_EXECUTABLE_TEST_TARGET"));
  } finally {
    childProcess.spawn = realSpawn;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("a multi-change changeset executes ALL recognized targets, in changeset order, and excludes any non-matching support path", async () => {
  const root = makeRoot();
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [
    { path: "cypress/e2e/tests/first_spec.cy.js", operation: "CREATE", purpose: "x" },
    { path: "cypress/support/commands.js", operation: "CREATE", purpose: "y" },
    { path: "cypress/e2e/tests/second_spec.cy.js", operation: "CREATE", purpose: "z" },
  ] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  fs.mkdirSync(path.join(root, "cypress", "support"), { recursive: true });
  const changes = [
    { operation: "CREATE", path: "cypress/e2e/tests/first_spec.cy.js", baseContentDigest: null, content: "describe('first', () => {});" },
    { operation: "CREATE", path: "cypress/support/commands.js", baseContentDigest: null, content: "Cypress.Commands.add('x', () => {});" },
    { operation: "CREATE", path: "cypress/e2e/tests/second_spec.cy.js", baseContentDigest: null, content: "describe('second', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const applyResult = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  assert.equal(applyResult.ok, true, JSON.stringify(applyResult.errors));

  await withMockSpawn(async (getCall) => {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    const call = getCall();
    const specIndex = call.args.indexOf("--spec");
    assert.ok(specIndex !== -1);
    assert.equal(call.args[specIndex + 1], "cypress/e2e/tests/first_spec.cy.js,cypress/e2e/tests/second_spec.cy.js");
  });
  fs.rmSync(root, { recursive: true, force: true });
});

// Roadmap #23G-C3 (closes 23G-C2-RR-2 Section 29-32): a changeset containing
// ONE safe and ONE unsafe (but still classifier-recognized) executable
// Cypress target must be rejected WHOLE - never silently narrowed to "just
// run the safe one".
test("a changeset with one safe and one unsafe-but-recognized Cypress target is rejected whole (UNSAFE_EXECUTION_TARGET), zero spawn - never silently narrowed to just the safe one", async () => {
  const root = makeRoot();
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [
    { path: "cypress/e2e/tests/safe.cy.js", operation: "CREATE", purpose: "x" },
    { path: "cypress/e2e/tests/a+b.cy.js", operation: "CREATE", purpose: "y" },
  ] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [
    { operation: "CREATE", path: "cypress/e2e/tests/safe.cy.js", baseContentDigest: null, content: "describe('safe', () => {});" },
    { operation: "CREATE", path: "cypress/e2e/tests/a+b.cy.js", baseContentDigest: null, content: "describe('unsafe', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const applyResult = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  assert.equal(applyResult.ok, true, JSON.stringify(applyResult.errors));

  const realSpawn = childProcess.spawn;
  let spawnCalled = false;
  childProcess.spawn = () => { spawnCalled = true; throw new Error("must not spawn"); };
  try {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, false);
    assert.equal(spawnCalled, false);
    assert.ok(JSON.stringify(res.errors).includes("UNSAFE_EXECUTION_TARGET"));
  } finally {
    childProcess.spawn = realSpawn;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("a changeset with only an unsafe-but-recognized Cypress target is rejected (UNSAFE_EXECUTION_TARGET), zero spawn", async () => {
  const root = makeRoot();
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/a!(b).cy.js", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/a!(b).cy.js", baseContentDigest: null, content: "describe('unsafe', () => {});" }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const applyResult = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  assert.equal(applyResult.ok, true, JSON.stringify(applyResult.errors));

  const realSpawn = childProcess.spawn;
  let spawnCalled = false;
  childProcess.spawn = () => { spawnCalled = true; throw new Error("must not spawn"); };
  try {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, false);
    assert.equal(spawnCalled, false);
    assert.ok(JSON.stringify(res.errors).includes("UNSAFE_EXECUTION_TARGET"));
  } finally {
    childProcess.spawn = realSpawn;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("non-zero exit is reported as TEST_FAILED, still ok:true (a bounded attempt was made)", async () => {
  const root = makeRoot();
  const chain = buildChain(root);
  const real = childProcess.spawn;
  childProcess.spawn = () => {
    const { EventEmitter } = require("node:events");
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stderr.emit("data", Buffer.from("1 failing\n"));
      child.emit("close", 1);
    });
    return child;
  };
  try {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    assert.equal(res.automationExecutionRecord.status, "TEST_FAILED");
    assert.equal(res.automationExecutionRecord.exitCode, 1);
  } finally {
    childProcess.spawn = real;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// --- rejection matrix ---------------------------------------------------------

test("non-APPLIED record (hand-forged, self-consistent digest) rejected, zero process spawned", async () => {
  const root = makeRoot();
  const chain = buildChain(root);
  const { recordDigest, ...rest } = chain.appliedChangeSetRecord;
  const forged = { ...rest, status: "APPLICATION_FAILED_ROLLED_BACK" };
  forged.recordDigest = aerComputeDigest("applied-change-set-record:v1", forged);
  const realSpawn = childProcess.spawn;
  let spawnCalled = false;
  childProcess.spawn = () => { spawnCalled = true; return real_child(); };
  function real_child() { const { EventEmitter } = require("node:events"); const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); setImmediate(() => c.emit("close", 0)); return c; }
  try {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: forged, executedAt: EXECUTED_AT });
    assert.equal(res.ok, false);
    assert.equal(res.automationExecutionRecord, null);
    assert.equal(spawnCalled, false);
  } finally {
    childProcess.spawn = realSpawn;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("tampered appliedChangeSetRecord (digest mismatch) rejected", async () => {
  const root = makeRoot();
  const chain = buildChain(root);
  const tampered = { ...chain.appliedChangeSetRecord, status: "APPLICATION_FAILED_ROLLED_BACK" };
  const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: tampered, executedAt: EXECUTED_AT });
  assert.equal(res.ok, false);
  assert.equal(res.automationExecutionRecord, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("cross-project record rejected", async () => {
  const root = makeRoot();
  const chain = buildChain(root);
  const res = await executeAppliedChangeSet({ expectedProjectId: "proj-OTHER", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, executedAt: EXECUTED_AT });
  assert.equal(res.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("stale afterDigest (target changed after application) rejected before any process spawns", async () => {
  const root = makeRoot();
  const chain = buildChain(root);
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js"), "describe('TAMPERED', () => {});", "utf8");
  const realSpawn = childProcess.spawn;
  let spawnCalled = false;
  childProcess.spawn = () => { spawnCalled = true; throw new Error("must not spawn"); };
  try {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, false);
    assert.equal(spawnCalled, false);
  } finally {
    childProcess.spawn = realSpawn;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("target replaced with a symlink after application rejected, external file untouched, no spawn", async () => {
  const root = makeRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "g23g-ce-outside-"));
  const chain = buildChain(root);
  const targetAbs = path.join(root, "cypress/e2e/tests/new_spec.cy.js");
  fs.unlinkSync(targetAbs);
  const decoy = path.join(outside, "decoy.cy.js");
  fs.writeFileSync(decoy, "describe('x', () => {});", "utf8");
  try {
    fs.symlinkSync(decoy, targetAbs, "file");
  } catch (e) {
    if (e.code === "EPERM" || e.code === "EACCES") {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }
    throw e;
  }
  const realSpawn = childProcess.spawn;
  let spawnCalled = false;
  childProcess.spawn = () => { spawnCalled = true; throw new Error("must not spawn"); };
  try {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, executedAt: EXECUTED_AT });
    assert.equal(res.ok, false);
    assert.equal(spawnCalled, false);
  } finally {
    childProcess.spawn = realSpawn;
  }
  assert.equal(fs.readFileSync(decoy, "utf8"), "describe('x', () => {});");
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("target replaced with a directory after application rejected", async () => {
  const root = makeRoot();
  const chain = buildChain(root);
  const targetAbs = path.join(root, "cypress/e2e/tests/new_spec.cy.js");
  fs.unlinkSync(targetAbs);
  fs.mkdirSync(targetAbs);
  const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, executedAt: EXECUTED_AT });
  assert.equal(res.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("hardlinked target after application rejected where the host supports hard links", async () => {
  const root = makeRoot();
  const chain = buildChain(root);
  const targetAbs = path.join(root, "cypress/e2e/tests/new_spec.cy.js");
  const other = path.join(root, "cypress/e2e/tests/other-link.cy.js");
  try {
    fs.linkSync(targetAbs, other);
  } catch (e) {
    fs.rmSync(root, { recursive: true, force: true });
    return; // hardlink unavailable in this environment
  }
  const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, executedAt: EXECUTED_AT });
  assert.equal(res.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("ancestor directory replaced with a symlink after application rejected, no outside-root spawn cwd", async () => {
  const root = makeRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "g23g-ce-ancoutside-"));
  const chain = buildChain(root);
  const testsDir = path.join(root, "cypress", "e2e", "tests");
  fs.unlinkSync(path.join(testsDir, "new_spec.cy.js"));
  fs.rmdirSync(testsDir);
  try {
    fs.symlinkSync(outside, testsDir, "dir");
  } catch (e) {
    if (e.code === "EPERM" || e.code === "EACCES") {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }
    throw e;
  }
  const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: chain.plan, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, executedAt: EXECUTED_AT });
  assert.equal(res.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("unsupported framework value on an otherwise-valid plan is rejected", async () => {
  const root = makeRoot();
  // AutomationPlan validation itself already rejects an unsupported
  // framework enum value - confirming #23G's own framework binding never
  // reaches the command map with an invalid value.
  const badPlan = { ...plan1(), framework: "selenium" };
  const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: badPlan, generatedChangeSet: {}, appliedChangeSetRecord: {}, executedAt: EXECUTED_AT });
  assert.equal(res.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

function sourceAfterDocstring(filePath) {
  const src = fs.readFileSync(require.resolve(filePath), "utf8");
  const marker = '"use strict";';
  const idx = src.indexOf(marker);
  return idx === -1 ? src : src.slice(idx + marker.length);
}

test("validationPlan free-text descriptions are never read as commands - no reference to plan.validationPlan anywhere in actual code", () => {
  const code = sourceAfterDocstring("./controlled-execution.js");
  assert.ok(!code.includes("validationPlan"));
});

test("caller-supplied command-like strings cannot become argv - selectExecutionCommand's ONLY variable component is the already-derived target list", () => {
  const result = selectExecutionCommand("cypress", "C:/fake/root", ["cypress/e2e/tests/new_spec.cy.js"]);
  assert.deepEqual(result.args, ["run", "--headless", "--browser", "chrome", "--spec", "cypress/e2e/tests/new_spec.cy.js"]);
});

test("absolute/traversal repositoryRoot rejected", async () => {
  const chain = { plan: plan1() };
  for (const bad of ["relative/path", "../escape", "", null, 42]) {
    const res = await executeAppliedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: bad, automationPlan: plan1(), generatedChangeSet: {}, appliedChangeSetRecord: {}, executedAt: EXECUTED_AT });
    assert.equal(res.ok, false, `expected rejection for repositoryRoot=${JSON.stringify(bad)}`);
  }
});

// --- resolveExecutionTimeout / resolveNpmExecutable / selectExecutionCommand ------

test("resolveExecutionTimeout clamps to the hard maximum and falls back safely on invalid input", () => {
  assert.equal(resolveExecutionTimeout(undefined), MAX_EXECUTION_TIMEOUT_MS);
  assert.equal(resolveExecutionTimeout(999999999), MAX_EXECUTION_TIMEOUT_MS);
  assert.equal(resolveExecutionTimeout(-5), MAX_EXECUTION_TIMEOUT_MS);
  assert.equal(resolveExecutionTimeout(Infinity), MAX_EXECUTION_TIMEOUT_MS);
  assert.equal(resolveExecutionTimeout(NaN), MAX_EXECUTION_TIMEOUT_MS);
  assert.equal(resolveExecutionTimeout("1000"), MAX_EXECUTION_TIMEOUT_MS);
  assert.equal(resolveExecutionTimeout(1000), 1000);
});

test("resolveLocalBinary returns a fixed, repository-root-relative, platform-derived path never influenced by caller-supplied binaryName beyond the closed FRAMEWORK_BINARIES map", () => {
  const value = resolveLocalBinary("C:/fake/root", "cypress");
  assert.ok(value === path.join("C:/fake/root", "node_modules", ".bin", "cypress.cmd") || value === path.join("C:/fake/root", "node_modules", ".bin", "cypress"));
  assert.ok(value.startsWith(path.join("C:/fake/root", "node_modules", ".bin")));
});

test("selectExecutionCommand rejects an unmapped framework and rejects an empty/missing target list", () => {
  assert.equal(selectExecutionCommand("selenium", "C:/fake/root", ["x"]).ok, false);
  assert.equal(selectExecutionCommand("", "C:/fake/root", ["x"]).ok, false);
  assert.equal(selectExecutionCommand(undefined, "C:/fake/root", ["x"]).ok, false);
  assert.equal(selectExecutionCommand("cypress", "C:/fake/root", []).ok, false);
  assert.equal(selectExecutionCommand("cypress", "C:/fake/root", undefined).ok, false);
});

// --- deriveExecutionTargets / buildExecutionEnvironment direct unit tests --------

test("deriveExecutionTargets: cypress classifier accepts only cypress/e2e/**/*.cy.js, rejects support/config/other-extension paths", () => {
  const changes = [
    { path: "cypress/e2e/tests/a.cy.js" },
    { path: "cypress/support/commands.js" },
    { path: "cypress/e2e/tests/not-a-spec.js" },
    { path: "cypress.config.js" },
  ];
  assert.deepEqual(deriveExecutionTargets("cypress", changes), { executableTargets: ["cypress/e2e/tests/a.cy.js"], unsafeExecutableTargets: [] });
});

test("deriveExecutionTargets: playwright classifier accepts only playwright/**/*.spec.js, rejects fixtures/config", () => {
  const changes = [
    { path: "playwright/tests/a.spec.js" },
    { path: "playwright/fixtures/data.json" },
    { path: "playwright.config.js" },
  ];
  assert.deepEqual(deriveExecutionTargets("playwright", changes), { executableTargets: ["playwright/tests/a.spec.js"], unsafeExecutableTargets: [] });
});

test("deriveExecutionTargets: unknown framework returns empty target lists", () => {
  assert.deepEqual(deriveExecutionTargets("selenium", [{ path: "cypress/e2e/tests/a.cy.js" }]), { executableTargets: [], unsafeExecutableTargets: [] });
});

test("buildExecutionEnvironment: copies only ENV_ALLOWLIST names, case-insensitively, excludes every unlisted variable including this repository's own real secret names", () => {
  const source = { PATH: "/usr/bin", Path: "C:\\Windows", TEMP: "/tmp", AI_API_KEY: "should-be-excluded", GITHUB_TOKEN: "should-be-excluded", RANDOM_VAR: "should-be-excluded" };
  const result = buildExecutionEnvironment(source);
  assert.equal(result.PATH, "/usr/bin");
  assert.equal(result.Path, "C:\\Windows");
  assert.equal(result.TEMP, "/tmp");
  assert.ok(!("AI_API_KEY" in result));
  assert.ok(!("GITHUB_TOKEN" in result));
  assert.ok(!("RANDOM_VAR" in result));
});

test("buildExecutionEnvironment: never throws on a non-object/null/hostile source", () => {
  assert.deepEqual(buildExecutionEnvironment(null), {});
  assert.deepEqual(buildExecutionEnvironment(undefined), {});
  assert.deepEqual(buildExecutionEnvironment("not-an-object"), {});
});

test("SECRET SENTINEL: a real spawned child given buildExecutionEnvironment's output cannot see an env var this test process itself set that is not on the allowlist", async () => {
  process.env.QA_AI_AGENT_SECRET_SENTINEL = "SECRET_SENTINEL_123";
  try {
    const env = buildExecutionEnvironment(process.env);
    const r = await runBoundedProcess(process.execPath, ["-e", "process.stdout.write(process.env.QA_AI_AGENT_SECRET_SENTINEL || 'ABSENT')"], { cwd: process.cwd(), timeoutMs: 5000, env });
    assert.equal(r.stdout.text, "ABSENT");
  } finally {
    delete process.env.QA_AI_AGENT_SECRET_SENTINEL;
  }
});

// --- PLAYWRIGHT EXACT TARGET (Roadmap #23G-C2, closes 23G-C1-RR-1) ---------------
//
// Independent review empirically proved, against the actual installed
// Playwright binary, that positional test-filter arguments are unanchored
// regular expressions - the exact, correctly-derived target path
// "playwright/tests/foo.spec.js" ALSO matched an unrelated
// "playwright/tests/fooXspec.js", because the literal "." in ".spec.js"
// acted as a regex wildcard. These tests run the REAL, installed
// Playwright binary (via --list, which resolves matching test files
// without executing them - no network, no browser needed) against a
// disposable temp fixture, proving the fix holds against actual CLI
// behavior rather than only against argv-string assertions.

// The REAL repository root (three levels up from this test file) is the
// only place a working node_modules/.bin/playwright + @playwright/test
// installation actually exists. Binary resolution uses THIS root (exactly
// like selectExecutionCommand() does in real #23G usage, where
// repositoryRoot IS the application repository and already has its own
// node_modules) - and the disposable fixture is deliberately nested AS A
// DIRECT SUBDIRECTORY OF THIS ROOT (never os.tmpdir()), so that Node's own
// standard upward node_modules resolution (walking parent directories from
// the fixture's own spec files) finds the real @playwright/test install
// without any extra configuration - this is more robust than an explicit
// NODE_PATH env var, which is a legacy Node mechanism with real
// cross-platform resolution quirks (an earlier version of this test used
// NODE_PATH and passed locally on Windows but failed on Linux CI for
// exactly this reason - a real gap this test itself caught). The fixture
// root is gitignored (.g23g-test-fixtures) and always removed in a
// `finally` block; it is never committed.
const REAL_REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_PARENT_DIR = path.join(REAL_REPO_ROOT, ".g23g-test-fixtures");

function makePlaywrightFixture(specs) {
  fs.mkdirSync(FIXTURE_PARENT_DIR, { recursive: true });
  const root = fs.mkdtempSync(path.join(FIXTURE_PARENT_DIR, "pw-exact-"));
  fs.mkdirSync(path.join(root, "playwright", "tests"), { recursive: true });
  // selectExecutionCommand() always passes --project=chromium (matching
  // this repository's own real playwright.config.js) - the fixture's own
  // config must define a project by that exact name or Playwright rejects
  // the run with "Project(s) \"chromium\" not found" before ever reaching
  // target-filter matching (a real gap this test itself caught: an earlier
  // version of this fixture omitted `projects` entirely and passed
  // locally only because the Windows EINVAL limitation skipped the real
  // invocation before this would have mattered).
  fs.writeFileSync(path.join(root, "playwright.config.js"), 'module.exports = { testDir: "./playwright", projects: [{ name: "chromium" }] };', "utf8");
  for (const [name, testName] of Object.entries(specs)) {
    fs.writeFileSync(path.join(root, "playwright", "tests", name), `const { test } = require('@playwright/test');\ntest('${testName}', async () => {});\n`, "utf8");
  }
  return root;
}

function fixtureEnv() {
  return buildExecutionEnvironment(process.env);
}

// NOTE: this deliberately does NOT call selectExecutionCommand() as a
// single all-in-one step, even though mission guidance prefers exercising
// the real production command-construction path - it calls
// buildPlaywrightExactTargetPattern() (the SAME function
// selectExecutionCommand() itself calls) directly instead, and
// resolveLocalBinary() separately. This is a genuine, disclosed test-only
// necessity: selectExecutionCommand(framework, realRoot, targets) uses ONE
// `realRoot` value for BOTH binary resolution (needs to be REAL_REPO_ROOT,
// which has a real node_modules/@playwright/test install) AND target-path
// resolution (needs to be the disposable FIXTURE root, where the actual
// candidate spec files live) - these two roots are ALWAYS the same value
// in real production usage (repositoryRoot IS the application repository,
// with its own files and its own node_modules together), and only diverge
// here because a disposable fixture cannot reasonably carry its own
// multi-hundred-megabyte node_modules copy. An earlier version of this
// helper passed REAL_REPO_ROOT for both purposes, which silently
// mismatched the constructed absolute pattern against the fixture's real
// file location and made every real-binary test in this section fail with
// "No tests found" on Linux CI - not a production defect, a test-helper one,
// caught and fixed by that exact failure.
async function listPlaywrightTests(fixtureRoot, targets) {
  const executable = resolveLocalBinary(REAL_REPO_ROOT, "playwright");
  const patterns = targets.map((target) => buildPlaywrightExactTargetPattern(fixtureRoot, target));
  assert.ok(patterns.every((pattern) => pattern !== null), "pattern construction must not fail for a valid fixture target");
  const args = ["test", "--config=playwright.config.js", "--project=chromium", ...patterns, "--list"];
  const result = await runBoundedProcess(executable, args, { cwd: fixtureRoot, timeoutMs: 30000, env: fixtureEnv() });
  return result;
}

// KNOWN, PRE-EXISTING, WINDOWS-SPECIFIC LIMITATION (discovered while writing
// these tests, unrelated to the regex-collision fix they verify): Node.js
// hardened child_process.spawn() to refuse spawning a .cmd/.bat file
// directly under shell:false, throwing a synchronous EINVAL (this is where
// runBoundedProcess's own try/catch correctly reports it as spawnError:true
// rather than crashing - see controlled-execution.js). This affects EVERY
// .cmd-suffixed binary this module resolves (cypress.cmd, playwright.cmd),
// not anything specific to this test or to the C2 fix - and it was never
// caught earlier because every prior #23G/#23G-C1 test exercising argv
// construction used a MOCKED spawn, and every REAL (unmocked)
// runBoundedProcess test used process.execPath (a real .exe, not a .cmd
// file). It does not affect Linux CI, where resolveLocalBinary() resolves
// to an extensionless POSIX shebang script that the kernel executes
// directly without any shell involvement. Fixing this Windows-specific
// spawn limitation is a separate, security-sensitive change (it would mean
// conditionally re-introducing some form of shell involvement specifically
// for .cmd files on win32) intentionally left out of this narrow
// #23G-C2 pass - see the final report's own dedicated finding. This helper
// lets the tests below still run for real and assert normally everywhere
// this limitation does not apply (Linux CI, and any future Windows fix),
// while reporting a clear, specific skip - never a silent pass - on an
// affected Windows host today.
function diag(result) {
  return `exitCode=${result.exitCode} spawnError=${result.spawnError}\nSTDOUT: ${result.stdout.text}\nSTDERR: ${result.stderr.text}`;
}

function skipIfWindowsCmdSpawnLimitation(t, result) {
  if (result.spawnError && process.platform === "win32") {
    t.skip("known Windows-only limitation: Node's child_process.spawn refuses to launch a .cmd file under shell:false (EINVAL) - unrelated to the regex-collision fix under test; unaffected on Linux CI, where the resolved binary is an extensionless POSIX shebang script");
    return true;
  }
  return false;
}

test("PLAYWRIGHT EXACT TARGET: the exact intended target is selected; a path-collision decoy (differing only where the target's literal '.' sits) is excluded", async (t) => {
  const root = makePlaywrightFixture({ "foo.spec.js": "the-actual-target", "fooXspec.js": "unrelated-collision" });
  try {
    const result = await listPlaywrightTests(root, ["playwright/tests/foo.spec.js"]);
    if (skipIfWindowsCmdSpawnLimitation(t, result)) return;
    assert.ok(result.stdout.text.includes("foo.spec.js"), diag(result));
    assert.ok(!result.stdout.text.includes("fooXspec.js"), diag(result));
    assert.ok(result.stdout.text.includes("Total: 1 test in 1 file"), diag(result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PLAYWRIGHT EXACT TARGET: multiple targets select exactly that set, excluding the collision decoy and each other's near-miss variants", async (t) => {
  const root = makePlaywrightFixture({
    "foo.spec.js": "target-1",
    "second_spec.spec.js": "target-2",
    "fooXspec.js": "unrelated-collision",
  });
  try {
    const result = await listPlaywrightTests(root, ["playwright/tests/foo.spec.js", "playwright/tests/second_spec.spec.js"]);
    if (skipIfWindowsCmdSpawnLimitation(t, result)) return;
    assert.ok(result.stdout.text.includes("foo.spec.js"), diag(result));
    assert.ok(result.stdout.text.includes("second_spec.spec.js"), diag(result));
    assert.ok(!result.stdout.text.includes("fooXspec.js"), diag(result));
    assert.ok(result.stdout.text.includes("Total: 2 tests in 2 files"), diag(result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PLAYWRIGHT EXACT TARGET: a target path containing regex metacharacters (+) matches only itself, never a quantifier-expanded decoy", async (t) => {
  const root = makePlaywrightFixture({ "a+b.spec.js": "plus-target", "aaab.spec.js": "plus-decoy" });
  try {
    const result = await listPlaywrightTests(root, ["playwright/tests/a+b.spec.js"]);
    if (skipIfWindowsCmdSpawnLimitation(t, result)) return;
    assert.ok(result.stdout.text.includes("a+b.spec.js"), diag(result));
    assert.ok(!result.stdout.text.includes("aaab.spec.js"), diag(result));
    assert.ok(result.stdout.text.includes("Total: 1 test in 1 file"), diag(result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Roadmap #23G-C3 (closes 23G-C2-RR-1 for real): this is the exact,
// mandatory regression proving the independent review's central finding is
// closed - the intended target's own path is a literal PREFIX/substring of
// an unrelated, independently-valid decoy's path (a "double extension"
// filename, e.g. a careless rename or provider mistake) - which #23G-C2's
// escaped-but-UNANCHORED matcher selected as well as the real target. Both
// ends of the current pattern are anchored against the full absolute path
// specifically to close this: an unanchored escaped literal can still
// match as a substring of a longer string; a `^...$`-anchored one cannot.
test("PLAYWRIGHT EXACT TARGET (substring collision - the exact independent-review regression): the intended target is selected; a decoy whose path is a literal EXTENSION of the target's own path is excluded", async (t) => {
  const root = makePlaywrightFixture({ "foo.spec.js": "the-actual-target", "foo.spec.js.spec.js": "substring-collision" });
  try {
    const result = await listPlaywrightTests(root, ["playwright/tests/foo.spec.js"]);
    if (skipIfWindowsCmdSpawnLimitation(t, result)) return;
    assert.ok(result.stdout.text.includes("foo.spec.js"), diag(result));
    assert.ok(!result.stdout.text.includes("foo.spec.js.spec.js"), diag(result));
    assert.ok(result.stdout.text.includes("Total: 1 test in 1 file"), diag(result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PLAYWRIGHT EXACT TARGET: a fixture root directory name itself containing a regex metacharacter does not break matching - the REALROOT is escaped too, not only the target filename", async (t) => {
  fs.mkdirSync(FIXTURE_PARENT_DIR, { recursive: true });
  const root = fs.mkdtempSync(path.join(FIXTURE_PARENT_DIR, "pw-root+regex-"));
  fs.mkdirSync(path.join(root, "playwright", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "playwright.config.js"), 'module.exports = { testDir: "./playwright", projects: [{ name: "chromium" }] };', "utf8");
  fs.writeFileSync(path.join(root, "playwright/tests/foo.spec.js"), "const { test } = require('@playwright/test');\ntest('target', async () => {});\n", "utf8");
  try {
    const result = await listPlaywrightTests(root, ["playwright/tests/foo.spec.js"]);
    if (skipIfWindowsCmdSpawnLimitation(t, result)) return;
    assert.ok(result.stdout.text.includes("foo.spec.js"), diag(result));
    assert.ok(result.stdout.text.includes("Total: 1 test in 1 file"), diag(result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PLAYWRIGHT EXACT TARGET: multiple targets select exactly that set, excluding BOTH a wildcard decoy AND a substring decoy simultaneously", async (t) => {
  const root = makePlaywrightFixture({
    "A.spec.js": "target-A",
    "B.spec.js": "target-B",
    "A.spec.js.spec.js": "A-substring-decoy",
    "BXspec.js": "B-wildcard-decoy",
  });
  try {
    const result = await listPlaywrightTests(root, ["playwright/tests/A.spec.js", "playwright/tests/B.spec.js"]);
    if (skipIfWindowsCmdSpawnLimitation(t, result)) return;
    assert.ok(result.stdout.text.includes("A.spec.js"), diag(result));
    assert.ok(result.stdout.text.includes("B.spec.js"), diag(result));
    assert.ok(!result.stdout.text.includes("A.spec.js.spec.js"), diag(result));
    assert.ok(!result.stdout.text.includes("BXspec.js"), diag(result));
    assert.ok(result.stdout.text.includes("Total: 2 tests in 2 files"), diag(result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("escapeRegexLiteral escapes every JS regex metacharacter", () => {
  assert.equal(escapeRegexLiteral("a.b"), "a\\.b");
  assert.equal(escapeRegexLiteral("a+b*c?d"), "a\\+b\\*c\\?d");
  assert.equal(escapeRegexLiteral("(a|b)[c]{1}^$\\"), "\\(a\\|b\\)\\[c\\]\\{1\\}\\^\\$\\\\");
  assert.equal(escapeRegexLiteral("plain_no_metachars"), "plain_no_metachars");
});

test("buildPlaywrightExactTargetPattern anchors BOTH ends and escapes the FULL ABSOLUTE path (Roadmap #23G-C3, closes 23G-C2-RR-1 for real)", () => {
  const realRoot = process.platform === "win32" ? "C:/repo" : "/repo";
  const pattern = buildPlaywrightExactTargetPattern(realRoot, "playwright/tests/foo.spec.js");
  assert.equal(pattern, `^${realRoot}/playwright/tests/foo\\.spec\\.js$`);
});

test("buildPlaywrightExactTargetPattern escapes a regex metacharacter in the REALROOT itself, not only in the target filename", () => {
  const realRoot = process.platform === "win32" ? "C:/repo+fixture" : "/repo+fixture";
  const pattern = buildPlaywrightExactTargetPattern(realRoot, "playwright/tests/foo.spec.js");
  assert.equal(pattern, `^${realRoot.replace("+", "\\+")}/playwright/tests/foo\\.spec\\.js$`);
});

test("buildPlaywrightExactTargetPattern returns null (never throws) if the resolved target would escape realRoot - defense in depth", () => {
  const realRoot = process.platform === "win32" ? "C:/repo" : "/repo";
  assert.equal(buildPlaywrightExactTargetPattern(realRoot, "../escape/foo.spec.js"), null);
});

// --- Cypress positive safe-character allowlist (Roadmap #23G-C3, closes 23G-C2-RR-2) ---

test("CYPRESS_SAFE_TARGET_PATH: accepts this repository's own real spec-naming conventions", () => {
  for (const p of ["cypress/e2e/tests/category_tree_behavior.cy.js", "cypress/e2e/tests/map-v2.cy.js", "cypress/e2e/tests/map_v2.cy.js", "cypress/e2e/tests/map.mobile.cy.js", "cypress/e2e/tests/nested/path/map.cy.js"]) {
    assert.equal(CYPRESS_SAFE_TARGET_PATH.test(p), true, p);
  }
});

test("CYPRESS_SAFE_TARGET_PATH: rejects every character with minimatch/extglob significance, including the ones #23G-C2's denylist missed", () => {
  for (const bad of ["cypress/e2e/tests/a,b.cy.js", "cypress/e2e/tests/a*.cy.js", "cypress/e2e/tests/a?.cy.js", "cypress/e2e/tests/a[b].cy.js", "cypress/e2e/tests/a{b}.cy.js", "cypress/e2e/tests/a!(b).cy.js", "cypress/e2e/tests/a+b.cy.js", "cypress/e2e/tests/a@b.cy.js", "cypress/e2e/tests/a(b).cy.js", "cypress/e2e/tests/a|b.cy.js"]) {
    assert.equal(CYPRESS_SAFE_TARGET_PATH.test(bad), false, bad);
  }
});

test("deriveExecutionTargets: Cypress separates safe from unsafe-but-recognized executable targets, never silently drops the unsafe one", () => {
  const changes = [
    { path: "cypress/e2e/tests/normal.cy.js" },
    { path: "cypress/e2e/tests/a+b.cy.js" },
    { path: "cypress/support/commands.js" },
  ];
  assert.deepEqual(deriveExecutionTargets("cypress", changes), { executableTargets: ["cypress/e2e/tests/normal.cy.js"], unsafeExecutableTargets: ["cypress/e2e/tests/a+b.cy.js"] });
});

test("deriveExecutionTargets: Playwright never populates unsafeExecutableTargets - its own exact-match anchoring handles every character, no denylist/allowlist needed", () => {
  const changes = [{ path: "playwright/tests/a+b.spec.js" }, { path: "playwright/tests/a,b.spec.js" }, { path: "playwright/tests/a!(b).spec.js" }];
  assert.deepEqual(deriveExecutionTargets("playwright", changes), { executableTargets: ["playwright/tests/a+b.spec.js", "playwright/tests/a,b.spec.js", "playwright/tests/a!(b).spec.js"], unsafeExecutableTargets: [] });
});

// --- runBoundedProcess (real, safe child-process fixtures) ------------------------

test("runBoundedProcess: successful exit 0", async () => {
  const r = await runBoundedProcess(process.execPath, ["-e", "process.exit(0)"], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.equal(r.exitCode, 0);
  assert.equal(r.timedOut, false);
  assert.equal(r.spawnError, false);
});

test("runBoundedProcess: non-zero exit code reported exactly", async () => {
  const r = await runBoundedProcess(process.execPath, ["-e", "process.exit(3)"], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.equal(r.exitCode, 3);
});

test("runBoundedProcess: spawn failure (nonexistent executable) reported as spawnError, not a crash", async () => {
  const r = await runBoundedProcess("g23g-nonexistent-executable-xyz", [], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.equal(r.spawnError, true);
  assert.equal(r.exitCode, null);
});

test("runBoundedProcess: timeout is detected and the child is terminated well within the configured bound", async () => {
  const start = Date.now();
  const r = await runBoundedProcess(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { cwd: process.cwd(), timeoutMs: 400 });
  const elapsed = Date.now() - start;
  assert.equal(r.timedOut, true);
  assert.ok(elapsed < 10000, `timeout should fire promptly, took ${elapsed}ms`);
});

test("runBoundedProcess: stdout is captured", async () => {
  const r = await runBoundedProcess(process.execPath, ["-e", "console.log('marker-output'); process.exit(0)"], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.ok(r.stdout.text.includes("marker-output"));
  assert.equal(r.stdout.truncated, false);
});

test("runBoundedProcess: stderr is captured", async () => {
  const r = await runBoundedProcess(process.execPath, ["-e", "console.error('marker-error'); process.exit(1)"], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.ok(r.stderr.text.includes("marker-error"));
});

test("runBoundedProcess: stdout exceeding the byte bound is truncated, never grown unbounded", async () => {
  // `fs.writeSync` (a blocking syscall) is used instead of
  // `process.stdout.write()` + `process.exit()`: on POSIX platforms a
  // pipe-backed stdout write is asynchronous, so calling `process.exit()`
  // immediately afterward can terminate the child before the OS finishes
  // flushing the pipe, truncating what the parent actually receives before
  // this test's own oversized payload was even fully sent. `writeSync`
  // blocks until the write completes, making the fixture itself
  // deterministic across platforms (this bit the Linux CI runner while
  // passing locally on Windows, where pipe writes are effectively
  // synchronous).
  const r = await runBoundedProcess(process.execPath, ["-e", `require("fs").writeSync(1, "x".repeat(${MAX_STDOUT_BYTES + 50000}))`], { cwd: process.cwd(), timeoutMs: 10000 });
  assert.equal(r.stdout.truncated, true);
  assert.ok(Buffer.byteLength(r.stdout.text, "utf8") <= MAX_STDOUT_BYTES);
});

test("runBoundedProcess: stderr exceeding the byte bound is truncated", async () => {
  const r = await runBoundedProcess(process.execPath, ["-e", `require("fs").writeSync(2, "y".repeat(${MAX_STDERR_BYTES + 50000}))`], { cwd: process.cwd(), timeoutMs: 10000 });
  assert.equal(r.stderr.truncated, true);
  assert.ok(Buffer.byteLength(r.stderr.text, "utf8") <= MAX_STDERR_BYTES);
});

test("runBoundedProcess: shell metacharacters in argv are treated as literal text, never interpreted, because shell is disabled", async () => {
  // A dangerous-looking string passed as a single argv entry (never
  // concatenated into a command line) must be received by the child
  // exactly as one literal argument, never split/interpreted by a shell.
  const dangerous = "; rm -rf / && echo pwned || true $(whoami) `id` %PATH%";
  const r = await runBoundedProcess(process.execPath, ["-e", `console.log(JSON.stringify(process.argv[1]))`, dangerous], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.ok(r.stdout.text.includes(JSON.stringify(dangerous)), r.stdout.text);
});

// --- revalidateAppliedState direct unit tests -------------------------------------

test("revalidateAppliedState rejects a non-APPLIED entry in the change list", () => {
  const root = makeRoot();
  const realRoot = fs.realpathSync(root);
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", beforeDigest: null, afterDigest: "sha256:" + "1".repeat(64), status: "ROLLED_BACK" }];
  const result = revalidateAppliedState(realRoot, changes);
  assert.equal(result.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

// --- source hygiene ----------------------------------------------------------------

test("SOURCE INTEGRITY: this module's own source file contains zero NUL bytes", () => {
  const src = fs.readFileSync(require.resolve("./controlled-execution.js"), "utf8");
  let hasNul = false;
  for (let i = 0; i < src.length; i += 1) {
    if (src.charCodeAt(i) === 0) {
      hasNul = true;
      break;
    }
  }
  assert.equal(hasNul, false);
});

test("AUTHORITY: no provider/Git/GitHub/eval/Function/vm authority anywhere in this module's actual code", () => {
  const code = sourceAfterDocstring("./controlled-execution.js");
  assert.ok(!code.includes("eval(") && !code.includes("new Function") && !code.includes("vm."));
  assert.ok(!code.includes("shell: true") && !code.includes("shell:true"));
  assert.ok(!code.includes('require("child_process").exec') && !code.includes("execSync("));
  assert.ok(!code.includes('require("simple-git")') && !code.toLowerCase().includes("octokit"));
  assert.ok(!code.includes("openai") && !code.includes("anthropic") && !code.includes("groq") && !code.includes("gemini"));
  assert.ok(!code.includes(".analyze("));
});

test("AUTHORITY: process.env is read only to build the minimal buildExecutionEnvironment() allowlist output - it is never passed through wholesale as a child's env", () => {
  const code = sourceAfterDocstring("./controlled-execution.js");
  const envUses = [...code.matchAll(/process\.env(?!\s*\))/g)];
  // The only two legitimate own-code uses are: (1) the executionEnv
  // assignment inside executeAppliedChangeSet, which passes process.env
  // ONLY as the argument TO buildExecutionEnvironment(); (2) none else -
  // grepping for "env:" or "env =" assigned directly from a bare
  // "process.env" (not wrapped in buildExecutionEnvironment(...)) must
  // find zero matches.
  assert.ok(!/env\s*[:=]\s*process\.env(?!\s*\))/.test(code), "process.env must never be assigned directly as a spawn env option");
  assert.ok(code.includes("buildExecutionEnvironment(process.env)"), "the only legitimate process.env read must flow through buildExecutionEnvironment()");
});

test("AUTHORITY: no dynamic require/import of a generated path anywhere in this module", () => {
  const src = fs.readFileSync(require.resolve("./controlled-execution.js"), "utf8");
  // The only `require(` calls in this file must be static, top-of-file
  // module requires - never a runtime `require(someVariable)`.
  const dynamicRequire = /require\(\s*[a-zA-Z_$][\w$]*\s*\)/.test(src.replace(/require\("[^"]*"\)/g, "").replace(/require\('[^']*'\)/g, ""));
  assert.equal(dynamicRequire, false);
});
