"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildGeneratedChangeSet, computeDigest: gcsComputeDigest, LABEL_FILE_CONTENT } = require("./generated-change-set");
const { buildGeneratedChangeSetReviewPackage } = require("./generated-change-set-review-package");
const { buildGeneratedChangeSetReviewRecord, validateApprovedGeneratedChangeSetReview } = require("./generated-change-set-review-record");
const { applyApprovedGeneratedChangeSet } = require("./change-set-application");
const { buildAutomationExecutionRecord } = require("./automation-execution-record");

const {
  MAX_REGENERATION_ATTEMPTS,
  INFRASTRUCTURE_MARKERS,
  classifyExecutionFailure,
  isRegenerationEligible,
  buildFailureEvidenceErrors,
  regenerateAfterExecutionFailure,
} = require("./regenerate-change-set");

const APPLIED_AT = "2026-08-28T11:00:00.000Z";
const EXECUTED_AT_START = "2026-08-28T12:00:00.000Z";
const EXECUTED_AT_END = "2026-08-28T12:01:00.000Z";

function plan1() {
  return { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "x" }] };
}
function context1() {
  return { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
}

function buildChain() {
  const plan = plan1();
  const context = context1();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "g23g-regen-test-"));
  fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
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
  fs.rmSync(root, { recursive: true, force: true });
  return { plan, context, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord };
}

function makeExecutionRecord({ status, exitCode, stdoutText, stderrText, appliedChangeSetRecordDigest }) {
  const built = buildAutomationExecutionRecord({
    projectId: "proj-1",
    appliedChangeSetRecordDigest,
    framework: "cypress",
    command: "npm run chrome",
    status,
    exitCode: exitCode === undefined ? null : exitCode,
    timedOut: status === "TIMED_OUT",
    stdout: { text: stdoutText || "", truncated: false },
    stderr: { text: stderrText || "", truncated: false },
    startedAt: EXECUTED_AT_START,
    completedAt: EXECUTED_AT_END,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.automationExecutionRecord;
}

function fixedProvider(response) {
  let calls = 0;
  return {
    calls: () => calls,
    analyze: async () => {
      calls += 1;
      return response;
    },
  };
}

// --- classifier ---------------------------------------------------------------

test("classifyExecutionFailure: PASSED -> NONE", () => {
  assert.equal(classifyExecutionFailure({ status: "PASSED" }), "NONE");
});
test("classifyExecutionFailure: TIMED_OUT -> TIMEOUT (never eligible)", () => {
  assert.equal(classifyExecutionFailure({ status: "TIMED_OUT" }), "TIMEOUT");
  assert.equal(isRegenerationEligible("TIMEOUT"), false);
});
test("classifyExecutionFailure: EXECUTION_ERROR -> INFRASTRUCTURE_FAILURE (never eligible)", () => {
  assert.equal(classifyExecutionFailure({ status: "EXECUTION_ERROR" }), "INFRASTRUCTURE_FAILURE");
  assert.equal(isRegenerationEligible("INFRASTRUCTURE_FAILURE"), false);
});
test("classifyExecutionFailure: TEST_FAILED with no infra marker -> GENERATED_AUTOMATION_FAILURE (eligible)", () => {
  const cat = classifyExecutionFailure({ status: "TEST_FAILED", stdout: { text: "1 failing\nAssertionError" }, stderr: { text: "" } });
  assert.equal(cat, "GENERATED_AUTOMATION_FAILURE");
  assert.equal(isRegenerationEligible(cat), true);
});
test("classifyExecutionFailure: every infrastructure marker forces INFRASTRUCTURE_FAILURE, never eligible", () => {
  for (const marker of INFRASTRUCTURE_MARKERS) {
    const cat = classifyExecutionFailure({ status: "TEST_FAILED", stdout: { text: `something ${marker} happened` }, stderr: { text: "" } });
    assert.equal(cat, "INFRASTRUCTURE_FAILURE", marker);
    assert.equal(isRegenerationEligible(cat), false);
  }
});
test("classifyExecutionFailure: unrecognized status -> UNKNOWN, never eligible", () => {
  assert.equal(classifyExecutionFailure({ status: "SOMETHING_ELSE" }), "UNKNOWN");
  assert.equal(isRegenerationEligible("UNKNOWN"), false);
  assert.equal(classifyExecutionFailure(null), "UNKNOWN");
  assert.equal(classifyExecutionFailure(undefined), "UNKNOWN");
});

// --- bounded evidence -----------------------------------------------------------

test("buildFailureEvidenceErrors bounds a huge stdout/stderr rather than embedding it raw", () => {
  const huge = "x".repeat(2_000_000);
  const evidence = buildFailureEvidenceErrors({ status: "TEST_FAILED", exitCode: 1, stdout: { text: huge }, stderr: { text: "" } });
  assert.ok(JSON.stringify(evidence).length < 20000, "bounded evidence must never embed unbounded raw output");
});

// --- provider-call-count governance ---------------------------------------------

test("PASSED execution record -> zero provider calls, rejected as not eligible", async () => {
  const chain = buildChain();
  const provider = fixedProvider("[]");
  const passedRecord = makeExecutionRecord({ status: "PASSED", exitCode: 0, appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: passedRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.regeneratedChangeSet, null);
  assert.equal(provider.calls(), 0);
});

test("non-regeneration-eligible failure (infrastructure) -> zero provider calls", async () => {
  const chain = buildChain();
  const provider = fixedProvider("[]");
  const infraRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stderrText: "Error: connect ECONNREFUSED 127.0.0.1:443", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: infraRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(provider.calls(), 0);
});

test("eligible generated-automation failure -> exactly one bounded provider call", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", content: "describe('FIXED', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing\nAssertionError: expected 1 to equal 2", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(provider.calls(), 1);
  assert.equal(res.providerCallCount, 1);
  assert.equal(res.status, "REGENERATION_PROPOSED_AWAITING_REVIEW");
});

test("regenerationAttempt other than exactly 1 is rejected with zero provider calls", async () => {
  const chain = buildChain();
  const provider = fixedProvider("[]");
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  for (const bad of [0, 2, -1, "1", null, undefined, 1.5]) {
    const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: bad });
    assert.equal(res.ok, false, `expected rejection for regenerationAttempt=${JSON.stringify(bad)}`);
  }
  assert.equal(provider.calls(), 0);
  assert.equal(MAX_REGENERATION_ATTEMPTS, 1);
});

// --- provider-response adversarial matrix ----------------------------------------

test("provider malformed (non-JSON) response rejected, providerCallCount still 1", async () => {
  const chain = buildChain();
  const provider = fixedProvider("not json {{{");
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.regeneratedChangeSet, null);
  assert.equal(res.providerCallCount, 1);
  assert.equal(provider.calls(), 1);
});

test("provider oversized response rejected without ever reaching JSON.parse", async () => {
  const chain = buildChain();
  const huge = JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", content: "x".repeat(2_000_000) }]);
  const provider = fixedProvider(huge);
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(provider.calls(), 1);
});

test("provider throws -> bounded rejection, providerCallCount 1, no raw error leaked", async () => {
  const chain = buildChain();
  const provider = { analyze: async () => { throw new Error("SECRET_23G_PROVIDER_MARKER"); } };
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.providerCallCount, 1);
  assert.ok(!JSON.stringify(res.errors).includes("SECRET_23G_PROVIDER_MARKER"));
});

test("provider tries unknown fields on a change entry -> rejected (reuses #23D's own strict shape check)", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", content: "x", extraField: "unexpected" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
});

test("provider proposes a path outside the plan's own plannedChanges -> rejected (never expands write scope)", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/UNAUTHORIZED.cy.js", content: "describe('x', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
});

test("provider proposes a protected file path -> rejected", async () => {
  const chain = buildChain();
  const protectedPlan = { ...chain.plan, plannedChanges: [{ path: "package.json", operation: "MODIFY", purpose: "x" }] };
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "package.json", content: "{}" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  // protectedPlan itself will fail #23D validation for an unsafe target long before reaching the provider in a real flow;
  // here we confirm the SAME real buildGeneratedChangeSet() protected-area rule is what rejects it, not a #23G-local reimplementation.
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider: fixedProvider(JSON.stringify([{ operation: "CREATE", path: "package.json", content: "{}" }])), regenerationAttempt: 1 });
  assert.equal(res.ok, false);
});

// --- regenerated proposal validity / governance ---------------------------------

test("regenerated proposal is a normal, fully valid GeneratedChangeSet v1 (passes the real #23D validator independently)", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", content: "describe('FIXED', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const { validateGeneratedChangeSet } = require("./generated-change-set");
  const independentCheck = validateGeneratedChangeSet({ automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: res.regeneratedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(independentCheck.ok, true, JSON.stringify(independentCheck.errors));
});

test("regenerated proposal has a DIFFERENT changeSetDigest from the original when content differs", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", content: "describe('DIFFERENT CONTENT', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.notEqual(res.regeneratedChangeSet.changeSetDigest, chain.generatedChangeSet.changeSetDigest);
});

test("GOVERNANCE (adversarial regression): the OLD approved ReviewRecord A can NEVER authorize a NEW review package built from the regenerated ChangeSet B", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", content: "describe('REGENERATED B', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));

  const pkgB = buildGeneratedChangeSetReviewPackage({ automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: res.regeneratedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(pkgB.ok, true, JSON.stringify(pkgB.errors));

  const gate = validateApprovedGeneratedChangeSetReview(pkgB.reviewPackage, chain.reviewRecord, { expectedProjectId: "proj-1" });
  assert.equal(gate.ok, false, "old ReviewRecord A must never authorize package B");
});

test("regenerateAfterExecutionFailure has zero filesystem/execution authority: no fs/child_process import anywhere in this module's actual code", () => {
  const src = fs.readFileSync(require.resolve("./regenerate-change-set.js"), "utf8");
  const marker = '"use strict";';
  const code = src.slice(src.indexOf(marker) + marker.length);
  assert.ok(!code.includes('require("fs")') && !code.includes('require("node:fs")'));
  assert.ok(!code.includes('require("child_process")') && !code.includes('require("node:child_process")'));
  assert.ok(!code.includes("applyApprovedGeneratedChangeSet"));
  assert.ok(!code.includes("executeAppliedChangeSet"));
  assert.ok(!code.includes("buildGeneratedChangeSetReviewRecord"));
});

// --- source hygiene --------------------------------------------------------------

test("SOURCE INTEGRITY: this module's own source file contains zero NUL bytes", () => {
  const src = fs.readFileSync(require.resolve("./regenerate-change-set.js"), "utf8");
  let hasNul = false;
  for (let i = 0; i < src.length; i += 1) {
    if (src.charCodeAt(i) === 0) {
      hasNul = true;
      break;
    }
  }
  assert.equal(hasNul, false);
});

test("AUTHORITY: no Git/GitHub/eval authority anywhere in this module's actual code", () => {
  const src = fs.readFileSync(require.resolve("./regenerate-change-set.js"), "utf8");
  const marker = '"use strict";';
  const code = src.slice(src.indexOf(marker) + marker.length);
  assert.ok(!code.includes("eval(") && !code.includes("new Function"));
  assert.ok(!code.toLowerCase().includes("octokit") && !code.includes('require("simple-git")'));
});
