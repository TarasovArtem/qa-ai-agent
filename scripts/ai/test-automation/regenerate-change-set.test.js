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
  redactSecrets,
  buildFailureEvidenceErrors,
  regenerateAfterExecutionFailure,
} = require("./regenerate-change-set");

const APPLIED_AT = "2026-08-28T11:00:00.000Z";
const EXECUTED_AT_START = "2026-08-28T12:00:00.000Z";
const EXECUTED_AT_END = "2026-08-28T12:01:00.000Z";

// Roadmap #23G-C1 (closes 23G-RV-1): a CREATE-based plan/changeset is no
// longer regeneration-eligible under ANY repositoryContext - see the
// dedicated "CREATE regeneration" test group below. Every OTHER test in
// this file (provider-call governance, adversarial provider responses,
// digest bindings, old-approval-replay) is orthogonal to the CREATE/MODIFY
// distinction, so the shared fixture below is MODIFY-based - the only
// operation regeneration still supports - with BOTH a stale (pre-A) and a
// fresh (accurately post-A) repositoryContext returned, so each test can
// pick whichever it actually needs to exercise.

function modifyPlan1() {
  return { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "x" }] };
}
const ORIGINAL_CONTENT = "describe('original', () => {});";
const APPLIED_A_CONTENT = "describe('bad-new', () => {});";
function staleContext1() {
  return { projectId: "proj-1", framework: "cypress", repositoryEvidence: [
    { evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" },
    { evidenceRef: { location: "cypress/e2e/tests/existing_spec.cy.js" }, content: ORIGINAL_CONTENT },
  ] };
}
function freshContext1() {
  return { projectId: "proj-1", framework: "cypress", repositoryEvidence: [
    { evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" },
    { evidenceRef: { location: "cypress/e2e/tests/existing_spec.cy.js" }, content: APPLIED_A_CONTENT },
  ] };
}

// `keepRoot: true` skips deleting the temp directory - required by the real
// second-#23F-application end-to-end test below, which needs the actual
// filesystem to still exist. Every other caller lets this clean up after
// itself, since it only needs the returned in-memory objects.
function buildChain({ keepRoot } = {}) {
  const plan = modifyPlan1();
  const staleContext = staleContext1();
  const freshContext = freshContext1();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "g23g-regen-test-"));
  fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), ORIGINAL_CONTENT, "utf8");
  const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: gcsComputeDigest(LABEL_FILE_CONTENT, ORIGINAL_CONTENT), content: APPLIED_A_CONTENT }];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: staleContext, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: staleContext, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(pkgResult.ok, true, JSON.stringify(pkgResult.errors));
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  const applyResult = applyApprovedGeneratedChangeSet({
    expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: staleContext,
    generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord,
    appliedAt: APPLIED_AT,
  });
  assert.equal(applyResult.ok, true, JSON.stringify(applyResult.errors));
  if (!keepRoot) fs.rmSync(root, { recursive: true, force: true });
  return { plan, context: staleContext, freshContext, root: keepRoot ? root : null, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord };
}

// Roadmap #23G-C1 (closes 23G-RV-1): a minimal CREATE-based fixture,
// dedicated to the CREATE-regeneration test group - kept structurally
// separate from the MODIFY-based buildChain() above since CREATE is no
// longer regeneration-eligible under ANY repositoryContext.
function buildCreateChain() {
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "x" }] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "g23g-regen-create-test-"));
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
  // A "fresh" context for CREATE also reflects the file now existing.
  const freshContext = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [
    { evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" },
    { evidenceRef: { location: "cypress/e2e/tests/new_spec.cy.js" }, content: fs.readFileSync(path.join(root, "cypress/e2e/tests/new_spec.cy.js"), "utf8") },
  ] };
  fs.rmSync(root, { recursive: true, force: true });
  return { plan, context, freshContext, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord };
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

// --- provider-boundary redaction (Roadmap #23G-C1, closes 23G-RV-4B) -------------

test("redactSecrets: Authorization/Bearer headers, *_TOKEN/*_SECRET/*_PASSWORD/*_API_KEY assignments, and URL-embedded credentials are all redacted", () => {
  const SECRET = "VERY_SECRET_SENTINEL_987";
  assert.ok(!redactSecrets(`Authorization: Bearer ${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`OPENAI_API_KEY=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`AI_API_KEY=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`GITHUB_TOKEN: ${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`DB_PASSWORD=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`SESSION_SECRET=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`https://user:${SECRET}@example.com/path`).includes(SECRET));
  assert.equal(redactSecrets("plain assertion text with no secrets at all"), "plain assertion text with no secrets at all");
});

// --- bare-name redaction (Roadmap #23G-C2, closes 23G-C1-RR-2) -------------------

test("redactSecrets: bare (unprefixed) TOKEN/SECRET/PASSWORD/API_KEY assignments are redacted - the exact gap independent review found", () => {
  const SECRET = "VERY_SECRET_SENTINEL_987";
  assert.ok(!redactSecrets(`TOKEN=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`SECRET=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`PASSWORD=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`API_KEY=${SECRET}`).includes(SECRET));
  // The mission's own literal required reproduction sentinel.
  assert.ok(!redactSecrets(`PASSWORD=SECRET_PASS_444`).includes("SECRET_PASS_444"));
});

test("redactSecrets: bare-name assignment forms (spaced, colon-separated, JSON-quoted) are all redacted", () => {
  const SECRET = "VERY_SECRET_SENTINEL_987";
  assert.ok(!redactSecrets(`TOKEN = ${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`TOKEN: ${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`"API_KEY":"${SECRET}"`).includes(SECRET));
  assert.ok(!redactSecrets(`'PASSWORD':'${SECRET}'`).includes(SECRET));
});

test("redactSecrets: prefixed forms still work after the bare-name widening (no regression)", () => {
  const SECRET = "VERY_SECRET_SENTINEL_987";
  assert.ok(!redactSecrets(`OPENAI_API_KEY=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`MY_TOKEN=${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`Authorization: Bearer ${SECRET}`).includes(SECRET));
  assert.ok(!redactSecrets(`https://user:${SECRET}@example.com/`).includes(SECRET));
});

test("redactSecrets: ordinary prose merely containing 'password'/'token'/'secret' with no assignment syntax is never redacted (false-positive check)", () => {
  const prose = [
    "the password validation test passed",
    "tokenizer test failed",
    "secret-management UI visible",
  ];
  for (const line of prose) {
    assert.equal(redactSecrets(line), line, line);
  }
});

test("buildFailureEvidenceErrors applies redaction before embedding stdout/stderr, and does not mutate the caller's record", () => {
  const SECRET = "VERY_SECRET_SENTINEL_987";
  const record = { status: "TEST_FAILED", exitCode: 1, stdout: { text: `1 failing\nAuthorization: Bearer ${SECRET}` }, stderr: { text: `OPENAI_API_KEY=${SECRET}` } };
  const evidence = buildFailureEvidenceErrors(record);
  assert.ok(!JSON.stringify(evidence).includes(SECRET));
  assert.ok(JSON.stringify(evidence).includes("[REDACTED]"));
  // the caller's own record object must be untouched.
  assert.ok(record.stdout.text.includes(SECRET));
  assert.ok(record.stderr.text.includes(SECRET));
});

test("PROVIDER-PROMPT SECRET SENTINEL: an eligible MODIFY regeneration with secret-laden execution evidence never sends the raw secret to the provider", async () => {
  const chain = buildChain();
  const SECRET = "VERY_SECRET_SENTINEL_987";
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('corrected', () => {});" }]));
  let capturedPrompt = null;
  const spyProvider = { analyze: async ({ userPrompt }) => { capturedPrompt = userPrompt; return provider.analyze(); } };
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: `1 failing\nAuthorization: Bearer ${SECRET}`, stderrText: `OPENAI_API_KEY=${SECRET}`, appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider: spyProvider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.ok(capturedPrompt !== null);
  assert.ok(!capturedPrompt.includes(SECRET), "the raw secret must never reach the provider prompt");
  assert.ok(capturedPrompt.includes("[REDACTED]"));
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
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('FIXED', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing\nAssertionError: expected 1 to equal 2", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
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
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.regeneratedChangeSet, null);
  assert.equal(res.providerCallCount, 1);
  assert.equal(provider.calls(), 1);
});

test("provider oversized response rejected without ever reaching JSON.parse", async () => {
  const chain = buildChain();
  const huge = JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "x".repeat(2_000_000) }]);
  const provider = fixedProvider(huge);
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(provider.calls(), 1);
});

test("provider throws -> bounded rejection, providerCallCount 1, no raw error leaked", async () => {
  const chain = buildChain();
  const provider = { analyze: async () => { throw new Error("SECRET_23G_PROVIDER_MARKER"); } };
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.providerCallCount, 1);
  assert.ok(!JSON.stringify(res.errors).includes("SECRET_23G_PROVIDER_MARKER"));
});

test("provider tries unknown fields on a change entry -> rejected (reuses #23D's own strict shape check)", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "x", extraField: "unexpected" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
});

test("provider proposes a path outside the plan's own plannedChanges -> rejected (never expands write scope)", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/UNAUTHORIZED.cy.js", content: "describe('x', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
});

test("provider proposes a protected file path -> rejected", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "package.json", content: "{}" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  // "package.json" is not even one of chain.plan's own plannedChanges paths,
  // so this is rejected at the plan-path-binding check - confirming the
  // SAME real buildGeneratedChangeSet() rule is what rejects it, not a
  // #23G-local reimplementation, regardless of which specific rule fires.
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
});

// --- regenerated proposal validity / governance ---------------------------------

test("regenerated proposal is a normal, fully valid GeneratedChangeSet v1 (passes the real #23D validator independently)", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('FIXED', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const { validateGeneratedChangeSet } = require("./generated-change-set");
  const independentCheck = validateGeneratedChangeSet({ automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: res.regeneratedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(independentCheck.ok, true, JSON.stringify(independentCheck.errors));
});

test("regenerated proposal has a DIFFERENT changeSetDigest from the original when content differs", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('DIFFERENT CONTENT', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.notEqual(res.regeneratedChangeSet.changeSetDigest, chain.generatedChangeSet.changeSetDigest);
});

test("GOVERNANCE (adversarial regression): the OLD approved ReviewRecord A can NEVER authorize a NEW review package built from the regenerated ChangeSet B", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('REGENERATED B', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));

  const pkgB = buildGeneratedChangeSetReviewPackage({ automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: res.regeneratedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(pkgB.ok, true, JSON.stringify(pkgB.errors));

  const gate = validateApprovedGeneratedChangeSetReview(pkgB.reviewPackage, chain.reviewRecord, { expectedProjectId: "proj-1" });
  assert.equal(gate.ok, false, "old ReviewRecord A must never authorize package B");
});

// --- CREATE regeneration (Roadmap #23G-C1, closes 23G-RV-1) ----------------------

test("CREATE-origin changeset: stale context -> REQUIRES_NEW_PLAN, zero provider calls, no doomed proposal", async () => {
  const chain = buildCreateChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", content: "describe('FIXED', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.regeneratedChangeSet, null);
  assert.equal(res.providerCallCount, 0);
  assert.equal(provider.calls(), 0);
  assert.ok(JSON.stringify(res.errors).includes("REQUIRES_NEW_PLAN"));
});

test("CREATE-origin changeset: fresh (accurately post-application) context -> STILL REQUIRES_NEW_PLAN, zero provider calls", async () => {
  const chain = buildCreateChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", content: "describe('FIXED', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.providerCallCount, 0);
  assert.equal(provider.calls(), 0);
  assert.ok(JSON.stringify(res.errors).includes("REQUIRES_NEW_PLAN"));
});

test("a mixed CREATE+MODIFY changeset is refused whole for the same reason - never partially regenerated", async () => {
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-mixed", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [
    { path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "x" },
    { path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "y" },
  ] };
  const context = { projectId: "proj-1", framework: "cypress", repositoryEvidence: [
    { evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" },
    { evidenceRef: { location: "cypress/e2e/tests/existing_spec.cy.js" }, content: ORIGINAL_CONTENT },
  ] };
  const changes = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('new', () => {});" },
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: gcsComputeDigest(LABEL_FILE_CONTENT, ORIGINAL_CONTENT), content: APPLIED_A_CONTENT },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  const decisions = pkgResult.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "g23g-regen-mixed-"));
  fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
  fs.writeFileSync(path.join(root, "cypress/e2e/tests/existing_spec.cy.js"), ORIGINAL_CONTENT, "utf8");
  const applyResult = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: root, automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage, reviewRecord: recResult.reviewRecord, appliedAt: APPLIED_AT });
  assert.equal(applyResult.ok, true, JSON.stringify(applyResult.errors));
  fs.rmSync(root, { recursive: true, force: true });

  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('fixed', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: applyResult.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, appliedChangeSetRecord: applyResult.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(provider.calls(), 0, "the provider must never be asked to guess which change caused the failure");
  assert.ok(JSON.stringify(res.errors).includes("REQUIRES_NEW_PLAN"));
});

// --- MODIFY repositoryContext freshness (Roadmap #23G-C1, closes 23G-RV-3) -------

test("MODIFY-origin changeset: stale (pre-application) context -> rejected before any provider call", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('corrected', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.context, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.providerCallCount, 0);
  assert.equal(provider.calls(), 0);
  assert.ok(JSON.stringify(res.errors).toLowerCase().includes("stale"));
});

test("MODIFY-origin changeset: fresh (accurately post-application) context -> provider called, B.baseContentDigest === A.afterDigest", async () => {
  const chain = buildChain();
  const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('corrected', () => {});" }]));
  const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
  const res = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(provider.calls(), 1);
  const appliedEntry = chain.appliedChangeSetRecord.changes.find((c) => c.path === "cypress/e2e/tests/existing_spec.cy.js");
  assert.equal(res.regeneratedChangeSet.changes[0].baseContentDigest, appliedEntry.afterDigest);
});

// --- real second #23F application end-to-end (Roadmap #23G-C1 Section 9/64) ------

test("REAL second #23F application of a fresh-context-regenerated MODIFY proposal succeeds end-to-end", async () => {
  const chain = buildChain({ keepRoot: true });
  try {
    const provider = fixedProvider(JSON.stringify([{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", content: "describe('corrected', () => {});" }]));
    const failRecord = makeExecutionRecord({ status: "TEST_FAILED", exitCode: 1, stdoutText: "1 failing", appliedChangeSetRecordDigest: chain.appliedChangeSetRecord.recordDigest });
    const regen = await regenerateAfterExecutionFailure({ expectedProjectId: "proj-1", automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: chain.generatedChangeSet, appliedChangeSetRecord: chain.appliedChangeSetRecord, automationExecutionRecord: failRecord, provider, regenerationAttempt: 1 });
    assert.equal(regen.ok, true, JSON.stringify(regen.errors));

    const pkgB = buildGeneratedChangeSetReviewPackage({ automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: regen.regeneratedChangeSet, expectedProjectId: "proj-1" });
    assert.equal(pkgB.ok, true, JSON.stringify(pkgB.errors));
    const decisionsB = pkgB.reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
    const recB = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkgB.reviewPackage, reviewerId: "reviewer-2", reviewedAt: "2026-08-28T13:00:00.000Z", decisions: decisionsB });
    assert.equal(recB.ok, true, JSON.stringify(recB.errors));

    const applyB = applyApprovedGeneratedChangeSet({ expectedProjectId: "proj-1", repositoryRoot: chain.root, automationPlan: chain.plan, repositoryContext: chain.freshContext, generatedChangeSet: regen.regeneratedChangeSet, reviewPackage: pkgB.reviewPackage, reviewRecord: recB.reviewRecord, appliedAt: "2026-08-28T14:00:00.000Z" });
    assert.equal(applyB.ok, true, JSON.stringify(applyB.errors));
    assert.equal(applyB.appliedChangeSetRecord.status, "APPLIED");
    const finalContent = fs.readFileSync(path.join(chain.root, "cypress/e2e/tests/existing_spec.cy.js"), "utf8");
    assert.equal(finalContent, "describe('corrected', () => {});");
  } finally {
    fs.rmSync(chain.root, { recursive: true, force: true });
  }
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
