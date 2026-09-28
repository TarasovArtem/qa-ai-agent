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

// ---------------------------------------------------------------- Corrective C1 (W4-SEC-H1): determination adapter seam
//
// The reproduced defect: collectCiEvidence() used to accept a bare
// `determinationCandidate` object -- including `authenticatedActor` and
// `policy` -- directly from ANY caller, with no adapter-resolution boundary
// at all (unlike ci-run.js's run-evidence adapter). A caller could fabricate
// an authenticatedActor and a policy authorizing that same fabricated actor
// and receive PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN. The fix: the candidate
// must now come from a resolved `determinationAdapter.fetchDetermination()`
// call (stages/1f/determination.js#resolveDeterminationAdapter(), the same
// pattern ci-run.js already uses). These tests are numbered against the
// corrective mission's SEC-C1-xx enumeration; several scenarios collapse
// onto the same assertion because the architecture change closes them by
// the same mechanism (no adapter path reached => HUMAN_REVIEW_REQUIRED).

const rerunRun = (overrides = {}) => rawRun({ attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }], ...overrides });

function validCandidate(overrides = {}) {
  return {
    record: {
      repository: REPO, headSha: subject.head, runId: "42", failedAttempts: [1], finalAttempt: 2,
      failedJobs: ["Cypress - chrome"], failureSignature: "sig", reviewer: "x", decisionRef: "issue-comment:1",
      category: "KNOWN_CI_RELIABILITY_SIGNATURE", justification: "known symptom",
    },
    authenticatedActor: { provider: "github", accountId: "555", accountType: "User" },
    contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1", collectedAt: "2026-09-28T00:00:00Z",
    policy: { authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "SEPARATE_PERSON" },
    contributors: { accountIds: ["github:111"], hasUnresolved: false },
    ...overrides,
  };
}
function determinationAdapter(candidateOrResult) {
  return { fetchDetermination: async () => (candidateOrResult && candidateOrResult.ok === false ? candidateOrResult : { ok: true, candidate: candidateOrResult }) };
}

test("SEC-C1: a rerun with a valid, adapter-supplied, accepted SEPARATE_PERSON determination resolves to PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN and populates externalEvidence AND the record's observed determination-provenance fields (feeds the W4-DEV-M1 report.ci fix)", async () => {
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationAdapter: determinationAdapter(validCandidate()) }));
  assert.equal(r.records[0].status, "PASS");
  assert.equal(r.records[0].observed.classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
  assert.equal(r.externalEvidence.length, 1);
  assert.equal(r.externalEvidence[0].sourceObjectId, "comment-1");
  assert.deepEqual(r.records[0].observed.authenticatedActor, { provider: "github", accountId: "555", accountType: "User" });
  assert.equal(r.records[0].observed.determinationMode, "SEPARATE_PERSON");
  assert.equal(r.records[0].observed.contentDigest, "d".repeat(64));
  assert.equal(r.records[0].observed.channelObjectId, "comment-1");
  assert.equal(r.records[0].observed.version, "v1");
});

test("SEC-C1-01/02/03/04/05/13: a rerun with a REJECTED determination candidate (e.g. wrong repository binding -- a forged/mismatched record, actor, digest, channel ID or version all fail the SAME binding/authorization checks) still resolves to HUMAN_REVIEW_REQUIRED, never silently promoted", async () => {
  const r = await collectCiEvidence(baseInput({
    adapter: adapter(rerunRun()),
    determinationAdapter: determinationAdapter(validCandidate({ record: { ...validCandidate().record, repository: "wrong/repo" } })),
  }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(r.externalEvidence, []);
});

test("SEC-C1-06/24: no determinationAdapter injected at all -- the rerun resolves to HUMAN_REVIEW_REQUIRED; no privileged PASS is reachable through arbitrary public-API arguments without a resolvable adapter", async () => {
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()) }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.records[0].reasonCode, "CI_UNEXPLAINED_RERUN");
  assert.deepEqual(r.externalEvidence, []);
});

test("SEC-C1-06b: the original reproduction -- a bare `determinationCandidate` field on the public input -- is no longer read at all; it is silently ignored (not a supported field) and the rerun still resolves to HUMAN_REVIEW_REQUIRED", async () => {
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationCandidate: validCandidate() }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(r.externalEvidence, []);
});

test("SEC-C1-07: a determinationAdapter that throws is treated exactly like no adapter -- HUMAN_REVIEW_REQUIRED, never an uncaught exception", async () => {
  const throwing = { fetchDetermination: async () => { throw new Error("boom"); } };
  await assert.doesNotReject(collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationAdapter: throwing })));
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationAdapter: throwing }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
});

test("SEC-C1-07b: a malformed adapter response (ok:true but no candidate, or a non-object) never becomes an accepted record", async () => {
  for (const bad of [{ ok: true }, { ok: true, candidate: "not-an-object" }, { ok: true, candidate: null }, null, "nope", 42]) {
    const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationAdapter: { fetchDetermination: async () => bad } }));
    assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED", JSON.stringify(bad));
  }
});

test("SEC-C1-09: an adapter-supplied candidate whose actor is not on the (adapter-supplied) authorizedDeterminers list is rejected, never promoted", async () => {
  const r = await collectCiEvidence(baseInput({
    adapter: adapter(rerunRun()),
    determinationAdapter: determinationAdapter(validCandidate({ authenticatedActor: { provider: "github", accountId: "999999", accountType: "User" } })),
  }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
});

test("SEC-C1-15: OWNER_ATTESTED is never promoted to SEPARATE_PERSON/PASS through the real collectCiEvidence() call path, and the report-visible OWNER_ATTESTED evidence fields are populated on the record", async () => {
  const ownerPolicy = { authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "OWNER_ATTESTED", ownerAccountId: "555" };
  const r = await collectCiEvidence(baseInput({
    adapter: adapter(rerunRun()),
    determinationAdapter: determinationAdapter(validCandidate({ policy: ownerPolicy, contributors: { accountIds: ["github:555"], hasUnresolved: false } })),
  }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.records[0].reasonCode, "OWNER_SELF_DETERMINATION");
  assert.equal(r.records[0].observed.rerunObserved, true);
  assert.equal(r.records[0].observed.attestationMode, "OWNER_ATTESTED");
  assert.equal(r.records[0].observed.candidateClassification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
  // OWNER_ATTESTED IS accepted as an attestation (design section 17 rule 4: "the
  // owner's record is accepted as an attestation and reported explicitly"), so its
  // content digest/version are still pinned into externalEvidence[] for later
  // kernel/revalidation.js#revalidateEvidence() tamper checks -- accepted-as-evidence
  // is not the same claim as promoted-to-PASS, which the classification above proves
  // never happens.
  assert.equal(r.externalEvidence.length, 1);
  assert.equal(r.externalEvidence[0].sourceObjectId, "comment-1");
});

test("SEC-C1-16/17/18: replay across HEAD, repository or run is rejected through the real adapter-mediated call path (not merely at the isolated validateDetermination() unit level)", async () => {
  const otherHead = "b".repeat(40);
  for (const bad of [
    validCandidate({ record: { ...validCandidate().record, headSha: otherHead } }),
    validCandidate({ record: { ...validCandidate().record, repository: "someone-else/other-repo" } }),
    validCandidate({ record: { ...validCandidate().record, runId: "different-run" } }),
  ]) {
    const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationAdapter: determinationAdapter(bad) }));
    assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  }
});

test("SEC-C1-19/20: failed-job or attempt-history binding mismatch is rejected through the real call path", async () => {
  const r = await collectCiEvidence(baseInput({
    adapter: adapter(rerunRun()),
    determinationAdapter: determinationAdapter(validCandidate({ record: { ...validCandidate().record, failedJobs: ["Some Other Job"] } })),
  }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
});

test("SEC-C1-21/22: a required-job FAILURE on the current attempt is reported as FAIL regardless of any determination outcome -- a malformed/absent determination never suppresses an otherwise-valid CI failure", async () => {
  const failingRerun = rawRun({
    attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }],
    jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }, { name: "Cypress - chrome", status: "completed", conclusion: "failure" }],
  });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(failingRerun) }));
  assert.equal(r.records[0].status, "FAIL");
});

test("SEC-C1-23: normal first-pass CLEAN_FIRST_PASS classification remains fully available without any determination adapter at all", async () => {
  const r = await collectCiEvidence(baseInput());
  assert.equal(r.records[0].status, "PASS");
  assert.equal(r.records[0].observed.classification, "CLEAN_FIRST_PASS");
});

// SEC-C1-25 (mandatory disclosure): the positive-path fixture above ("a rerun with
// a valid, adapter-supplied, accepted SEPARATE_PERSON determination...") uses a
// FIXTURE adapter constructed by this test file, not a real GitHub-authenticated
// provider. What that fixture proves: validateDetermination()'s binding/authorization
// rules correctly ACCEPT a well-formed, fully-matching candidate when one is supplied
// through the adapter seam, and correctly REJECT every malformed/mismatched variant
// above. What it does NOT prove: that any `authenticatedActor` or `policy` value
// reaching this code in a real deployment actually originated from an authenticated
// GitHub API response, or that `authorizedDeterminers` is genuinely base-anchored --
// no live provider adapter and no Stage 1A policy-schema extension for
// authorizedDeterminers exist anywhere in this repository (see the Wave 4 Corrective
// C1 report). D4 operational authenticity is UNVERIFIED/DEFERRED, not proven by this
// or any other test in this suite.

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
  const secretShaped = "ghp_" + "A".repeat(36);
  const candidate = validCandidate({
    record: { ...validCandidate().record, failureSignature: secretShaped, reviewer: secretShaped, justification: secretShaped },
  });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationAdapter: determinationAdapter(candidate) }));
  const serialized = JSON.stringify(r.records[0]);
  assert.equal(serialized.includes(secretShaped), false);
});

test("no internal helper is exported through the module", () => {
  const mod = require("./ci-evidence");
  assert.deepEqual(Object.keys(mod), ["collectCiEvidence"]);
});
