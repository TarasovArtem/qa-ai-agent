"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectCiEvidence } = require("./ci-evidence");
const { validateResultRecord } = require("../../kernel/results");
const { makeSubject } = require("../../test-support-git");

const subject = makeSubject();
const REPO = "TarasovArtem/qa-ai-agent";
const WORKFLOW = ".github/workflows/cypress.yml";
const REQUIRED = ["Unit tests", "Cypress - chrome"];

const rawRun = (overrides = {}) => ({
  repository: REPO, workflowPath: WORKFLOW, runId: "42", event: "pull_request", headSha: subject.head,
  attempt: 1, status: "completed",
  jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }, { name: "Cypress - chrome", status: "completed", conclusion: "success" }],
  attemptHistory: [],
  ...overrides,
});

function adapter(runOrFailure) {
  return { fetchRun: async () => (runOrFailure && runOrFailure.ok === false ? runOrFailure : { ok: true, run: runOrFailure }) };
}

const baseInput = (overrides = {}) => ({
  subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", requiredJobs: REQUIRED, adapter: adapter(rawRun()), ...overrides,
});

test("a clean, matching, fully successful attempt-1 run produces a PASS 1F.CI record classified CLEAN_FIRST_PASS", async () => {
  const r = await collectCiEvidence(baseInput());
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1F.CI");
  assert.equal(r.records[0].ownerStage, "1F");
  assert.equal(r.records[0].status, "PASS");
  assert.equal(r.records[0].observed.classification, "CLEAN_FIRST_PASS");
  assert.deepEqual(r.records[0].subject, subject);
  assert.deepEqual(r.externalEvidence, []);
});

test("a required job that failed produces a FAIL record", async () => {
  const run = rawRun({ jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }, { name: "Cypress - chrome", status: "completed", conclusion: "failure" }] });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "FAIL");
  assert.equal(r.records[0].observed.classification, "FAIL");
  assert.deepEqual(r.records[0].observed.failed, ["Cypress - chrome"]);
});

test("a required job missing entirely produces an INCOMPLETE record, never a false pass", async () => {
  const run = rawRun({ jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }] });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.deepEqual(r.records[0].observed.missing, ["Cypress - chrome"]);
});

test("a run still in progress is INCOMPLETE, never treated as finalized", async () => {
  const run = rawRun({ status: "in_progress" });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].reasonCode, "CI_NOT_COLLECTED");
});

test("a run for the wrong SHA is rejected as FAIL, never silently accepted -- mandatory negative test #1", async () => {
  const run = rawRun({ headSha: "b".repeat(40) });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "FAIL");
});

test("a run for the wrong repository is rejected as FAIL -- mandatory negative test #2", async () => {
  const run = rawRun({ repository: "someone-else/other-repo" });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "FAIL");
});

test("wrong event is rejected as FAIL -- mandatory negative test #3", async () => {
  const run = rawRun({ event: "push" });
  const r = await collectCiEvidence(baseInput({ event: "pull_request", adapter: adapter(run) }));
  assert.equal(r.records[0].status, "FAIL");
});

test("an unreachable/malformed CI source is INCOMPLETE, never coerced to success -- mandatory negative test #10/#11", async () => {
  const r = await collectCiEvidence(baseInput({ adapter: adapter({ ok: false, reason: "SOURCE_UNREACHABLE" }) }));
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("a rerun with no determination candidate resolves to HUMAN_REVIEW_REQUIRED, never an automatic pass", async () => {
  const run = rawRun({ attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }] });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(r.externalEvidence, []);
});

test("a rerun with a valid, accepted SEPARATE_PERSON determination candidate resolves to PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN and populates externalEvidence", async () => {
  const run = rawRun({ attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }] });
  const determinationCandidate = {
    record: {
      repository: REPO, headSha: subject.head, runId: "42", failedAttempts: [1], finalAttempt: 2,
      failedJobs: ["Cypress - chrome"], failureSignature: "sig", reviewer: "x", decisionRef: "issue-comment:1",
      category: "KNOWN_CI_RELIABILITY_SIGNATURE", justification: "known symptom",
    },
    authenticatedActor: { provider: "github", accountId: "555", accountType: "User" },
    contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1", collectedAt: "2026-09-28T00:00:00Z",
    policy: { authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "SEPARATE_PERSON" },
    contributors: { accountIds: ["github:111"], hasUnresolved: false },
  };
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run), determinationCandidate }));
  assert.equal(r.records[0].status, "PASS");
  assert.equal(r.records[0].observed.classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
  assert.equal(r.externalEvidence.length, 1);
  assert.equal(r.externalEvidence[0].sourceObjectId, "comment-1");
});

test("a rerun with a REJECTED determination candidate (e.g. wrong repository binding) still resolves to HUMAN_REVIEW_REQUIRED, never silently promoted", async () => {
  const run = rawRun({ attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }] });
  const determinationCandidate = {
    record: {
      repository: "wrong/repo", headSha: subject.head, runId: "42", failedAttempts: [1], finalAttempt: 2,
      failedJobs: ["Cypress - chrome"], failureSignature: "sig", reviewer: "x", decisionRef: "issue-comment:1",
      category: "OTHER", justification: "x",
    },
    authenticatedActor: { provider: "github", accountId: "555", accountType: "User" },
    contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1", collectedAt: "2026-09-28T00:00:00Z",
    policy: { authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "SEPARATE_PERSON" },
    contributors: { accountIds: [], hasUnresolved: false },
  };
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run), determinationCandidate }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(r.externalEvidence, []);
});

test("malformed subject fails closed via outcome, never PASS", async () => {
  const r = await collectCiEvidence({ ...baseInput(), subject: "not-a-subject" });
  assert.equal(r.records.length, 0);
  assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
});

test("missing/empty requiredJobs policy fails closed via outcome", async () => {
  const r = await collectCiEvidence({ ...baseInput(), requiredJobs: [] });
  assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
});

test("never throws on a fully hostile input object", async () => {
  for (const bad of [null, undefined, 42, [], { subject }]) {
    await assert.doesNotReject(collectCiEvidence(bad));
  }
});

test("the emitted record validates against the kernel's validateResultRecord()", async () => {
  const r = await collectCiEvidence(baseInput());
  assert.equal(validateResultRecord(r.records[0]).ok, true, JSON.stringify(r.records[0]));
});

test("five repeated executions of an identical fixture are deterministic", async () => {
  const outs = [];
  for (let i = 0; i < 5; i++) outs.push(JSON.stringify((await collectCiEvidence(baseInput())).records));
  assert.equal(new Set(outs).size, 1);
});

test("untrusted determination free-text (justification, failureSignature, reviewer) never reaches the emitted record's fields, even when it contains a secret-shaped string -- mandatory negative test #29", async () => {
  const run = rawRun({ attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }] });
  const secretShaped = "ghp_" + "A".repeat(36);
  const determinationCandidate = {
    record: {
      repository: REPO, headSha: subject.head, runId: "42", failedAttempts: [1], finalAttempt: 2,
      failedJobs: ["Cypress - chrome"], failureSignature: secretShaped, reviewer: secretShaped, decisionRef: "issue-comment:1",
      category: "OTHER", justification: secretShaped,
    },
    authenticatedActor: { provider: "github", accountId: "555", accountType: "User" },
    contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1", collectedAt: "2026-09-28T00:00:00Z",
    policy: { authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "SEPARATE_PERSON" },
    contributors: { accountIds: [], hasUnresolved: false },
  };
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run), determinationCandidate }));
  const serialized = JSON.stringify(r.records[0]);
  assert.equal(serialized.includes(secretShaped), false);
});

test("no internal helper is exported through the module", () => {
  const mod = require("./ci-evidence");
  assert.deepEqual(Object.keys(mod), ["collectCiEvidence"]);
});
