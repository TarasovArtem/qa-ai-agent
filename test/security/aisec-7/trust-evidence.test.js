"use strict";

/**
 * AISEC-7 H-11: trust labels, CI evidence binding, self-certification and
 * comment identity (SADR-10).
 *
 * Every platform object here is a fake fixture: a fake CI adapter and a fake
 * GitHub client with no network. These fixtures exercise the CURRENT
 * deterministic evidence checks only; they do not and cannot prove real
 * GitHub authentication, real run provenance or real comment permissions.
 */

const nodeTest = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const fx = require("./lib/fixtures");
const { OUTCOMES, SCOPES, deriveSecurityOutcome } = require("./lib/outcomes");
const { createEvidenceLedger } = require("./lib/execution-ledger");

const ledger = createEvidenceLedger(__filename);
const { confirmCase, targetOutcome } = ledger;

// Registered from this file so node:test attributes every result to it; the
// ledger records completion and refuses test options (SEC-02).
function test(name, fn) {
  return nodeTest(name, ledger.track(name, fn));
}
test.after = nodeTest.after;

const F1 = path.join(fx.GOVERNANCE, "stages", "1f");
const { fetchValidatedRun, validateRunEvidence } = require(path.join(F1, "ci-run.js"));
const { checkRequiredJobs } = require(path.join(F1, "required-jobs.js"));
const { validateDetermination, resolveDeterminationMode, qualifyDetermination, computeDeterminationDigest, UNMET_TRUST_PREREQUISITES } = require(path.join(F1, "determination.js"));
const { validateTrustedContext } = require(path.join(fx.GOVERNANCE, "stages", "1a", "trusted-context.js"));
const { upsertPrComment } = require(path.join(fx.AI, "pr-comment-client.js"));

const REPO = "synthetic-owner/aisec7-repo";
const WORKFLOW = ".github/workflows/aisec7.yml";
const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

function run(overrides = {}) {
  return { repository: REPO, workflowPath: WORKFLOW, runId: "7001", event: "pull_request", headSha: HEAD, attempt: 1, status: "completed", jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }], attemptHistory: [], ...overrides };
}

function fakeCi(result) {
  return { fetchRun: async () => result };
}

function request(adapter) {
  return { adapter, repository: REPO, workflowPath: WORKFLOW, headSha: HEAD, event: "pull_request" };
}

// --- CI run binding ---------------------------------------------------------------

test("H11-C1: CI evidence for the wrong HEAD, event, workflow or repository is refused with an internal WRONG_* reason", async () => {
  const control = await fetchValidatedRun(request(fakeCi({ ok: true, run: run() })));
  assert.equal(control.ok, true, "matching evidence is accepted, so refusals are not vacuous");
  const cases = [
    [{ headSha: OTHER }, "WRONG_SHA"],
    [{ event: "push" }, "WRONG_EVENT"],
    [{ workflowPath: ".github/workflows/other.yml" }, "WRONG_WORKFLOW"],
    [{ repository: "synthetic-owner/other-repo" }, "WRONG_REPOSITORY"],
  ];
  const reasons = [];
  for (const [override, expected] of cases) {
    const res = await fetchValidatedRun(request(fakeCi({ ok: true, run: run(override) })));
    reasons.push(res.ok === false && res.reason === expected);
  }
  confirmCase("H11-C1", reasons.every(Boolean));
});

test("H11-C2: adapter-supplied WRONG_* reason text cannot impersonate an internally proven mismatch", async () => {
  const forged = await fetchValidatedRun(request(fakeCi({ ok: false, reason: "WRONG_SHA" })));
  const unbounded = await fetchValidatedRun(request(fakeCi({ ok: false, reason: `free text ${fx.canary("ADAPTER_REASON")}` })));
  confirmCase("H11-C2", forged.reason === "SOURCE_UNREACHABLE" && unbounded.reason === "SOURCE_UNREACHABLE");
});

test("H11-C3: omitted, skipped or pending required jobs never count as complete success", () => {
  const job = (name, status, conclusion) => ({ name, status, conclusion });
  const required = ["Unit tests", "Security"];
  const omitted = checkRequiredJobs({ run: { jobs: [job("Unit tests", "completed", "success")] }, requiredJobs: required });
  const skipped = checkRequiredJobs({ run: { jobs: [job("Unit tests", "completed", "success"), job("Security", "completed", "skipped")] }, requiredJobs: required });
  const pending = checkRequiredJobs({ run: { jobs: [job("Unit tests", "completed", "success"), job("Security", "in_progress", null)] }, requiredJobs: required });
  const control = checkRequiredJobs({ run: { jobs: [job("Unit tests", "completed", "success"), job("Security", "completed", "success")] }, requiredJobs: required });
  assert.equal(control.allSucceeded, true);
  confirmCase("H11-C3", [omitted, skipped, pending].every((r) => r.ok === true && r.allSucceeded === false) && omitted.complete === false && pending.complete === false);
});

test("H11-C7: run evidence has no TREE or checkout field, so wrong-TREE/wrong-checkout cannot be detected", () => {
  const carryingTree = validateRunEvidence({ ...run(), tree: OTHER });
  const withoutTree = validateRunEvidence(run());
  assert.equal(carryingTree.ok, false, "a run cannot even carry a TREE");
  assert.equal(withoutTree.ok, true);
  assert.ok(!Object.keys(withoutTree.run).some((k) => /tree|checkout/i.test(k)), "accepted evidence binds HEAD only");
  confirmCase("H11-C7", null);
});

// --- trusted invocation context --------------------------------------------------------

function trustedContext(overrides = {}) {
  return { mode: "PR_REVIEW", invocationTrust: "PLATFORM_AUTHENTICATED", provider: "github", repositoryId: REPO, eventType: "pull_request", targetRefName: "main", defaultBranchName: "main", headSha: HEAD, suppliedTargetSha: null, workflow: null, platformFiles: null, ...overrides };
}

test("H11-C4: a trusted context whose event does not match its mode/trust is rejected", () => {
  assert.equal(validateTrustedContext(trustedContext()).ok, true);
  const wrongEvent = validateTrustedContext(trustedContext({ eventType: "push" }));
  const operatorWorkflow = validateTrustedContext(trustedContext({ invocationTrust: "OPERATOR_SUPPLIED", eventType: "manual", workflow: { path: WORKFLOW, sha: HEAD } }));
  confirmCase("H11-C4", wrongEvent.ok === false && operatorWorkflow.ok === false);
});

test("H11-T: a caller-supplied PLATFORM_AUTHENTICATED label is shape-valid only; it never becomes an authenticated or PASS outcome", () => {
  const supplied = validateTrustedContext(trustedContext({ invocationTrust: "PLATFORM_AUTHENTICATED" }));
  assert.equal(supplied.ok, true, "shape validation accepts the asserted label from any caller");
  assert.equal(supplied.context.invocationTrust, "PLATFORM_AUTHENTICATED");
  const withLabel = deriveSecurityOutcome({ scope: SCOPES.TARGET_ARCHITECTURE, blockedBy: "IMPLEMENTATION_BLOCKED", trustLabel: supplied.context.invocationTrust, schemaValid: true });
  assert.equal(withLabel, OUTCOMES.IMPLEMENTATION_BLOCKED);
  assert.equal(targetOutcome("H11-T"), OUTCOMES.IMPLEMENTATION_BLOCKED);
});

// --- self-certification and determination ------------------------------------------------

const actor = { provider: "github", accountId: "555", accountType: "User" };
const policy = { authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "SEPARATE_PERSON" };
const record = { repository: REPO, headSha: HEAD, runId: "7001", failedAttempts: [1], finalAttempt: 2, failedJobs: ["Unit tests"], failureSignature: "sig-1", reviewer: "aisec7-display-name", decisionRef: "issue-comment:1", category: "KNOWN_CI_RELIABILITY_SIGNATURE", justification: "synthetic" };
const runEvidence = { repository: REPO, headSha: HEAD, runId: "7001", attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }], failureSignature: "sig-1" };

test("H11-C5: self-certification is refused - a determiner who is a contributor cannot act as SEPARATE_PERSON", () => {
  const selfCertified = resolveDeterminationMode({ actor, contributors: { accountIds: ["github:555"], hasUnresolved: false }, policy });
  const unresolved = resolveDeterminationMode({ actor, contributors: { accountIds: ["github:111"], hasUnresolved: true }, policy });
  const bundle = (accountIds) => ({ subject: { head: HEAD }, record, authenticatedActor: actor, contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "2026-10-07T00:00:00Z", collectedAt: "2026-10-07T00:01:00Z", runEvidence, policy, contributors: { accountIds, hasUnresolved: false } });
  const full = validateDetermination(bundle(["github:555", "github:111"]));
  // Control: a non-contributor is accepted. The pure validator trusts the
  // caller-supplied authenticatedActor as given - authenticity stays H11-T.
  assert.equal(validateDetermination(bundle(["github:111"])).accepted, true);
  confirmCase("H11-C5", selfCertified.reason === "DETERMINER_IS_A_CONTRIBUTOR" && unresolved.ok === false && full.accepted === false && full.reason === "DETERMINER_IS_A_CONTRIBUTOR");
});

test("H11-C6: the only adapter bridge never accepts a determination; every response yields UNMET_TRUST_PREREQUISITES", () => {
  const wellFormed = qualifyDetermination({ response: { ok: true, candidate: { record, contentDigest: computeDeterminationDigest(record), authenticatedActor: actor, policy } }, subject: { head: HEAD }, runEvidence });
  const malformed = qualifyDetermination({ response: { ok: true, candidate: { record: { forged: true } } }, subject: { head: HEAD }, runEvidence });
  const neverAccepted = wellFormed.accepted === false && malformed.accepted === false && UNMET_TRUST_PREREQUISITES.every((r) => wellFormed.reasons.includes(r));
  confirmCase("H11-C6", neverAccepted);
});

// --- comment identity ---------------------------------------------------------------------

const MARKER = "<!-- aisec7-synthetic-marker -->";

function fakeGithub(pages) {
  const log = { list: [], update: [], create: [] };
  const github = {
    rest: {
      issues: {
        listComments: async (params) => { log.list.push(params); return { data: pages[(params.page || 1) - 1] || [] }; },
        updateComment: async (params) => { log.update.push(params); return { data: {} }; },
        createComment: async (params) => { log.create.push(params); return { data: { id: 9999 } }; },
      },
    },
  };
  return { github, log };
}

const upsert = (github) => upsertPrComment({ github, owner: "synthetic-owner", repo: "aisec7-repo", issueNumber: 1, marker: MARKER, body: `${MARKER} synthetic report` });

test("H11-C8: comment upsert updates a foreign-author comment that carries the marker (no author gate)", async () => {
  const { github, log } = fakeGithub([[{ id: 42, user: { login: "aisec7-foreign-actor", type: "User" }, body: `${MARKER} planted by another author` }]]);
  const res = await upsert(github);
  assert.equal(res.action, "updated");
  assert.equal(log.update[0].comment_id, 42, "the planted foreign comment was selected as the target");
  confirmCase("H11-C8", log.update.length === 0);
});

test("H11-C9: a marker comment beyond the first page is not found and a duplicate is created", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, user: { login: "someone", type: "User" }, body: `unrelated ${i}` }));
  const page2 = [{ id: 500, user: { login: "github-actions[bot]", type: "Bot" }, body: `${MARKER} original report` }];
  const { github, log } = fakeGithub([page1, page2]);
  const res = await upsert(github);
  assert.equal(log.list.length, 1, "only the first page is read");
  assert.equal(res.action, "created");
  confirmCase("H11-C9", log.create.length === 0);
});
