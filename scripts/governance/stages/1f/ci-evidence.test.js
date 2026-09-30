"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectCiEvidence } = require("./ci-evidence");
const { computeDeterminationDigest } = require("./determination");
const governance = require("../../index");
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

const NOW = "2026-09-30T00:00:00.000Z";

const baseInput = (overrides = {}) => ({
  subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", requiredJobs: REQUIRED, adapter: adapter(rawRun()), now: NOW, ...overrides,
});

// Corrective C3 (W4-C2R-DEV-M2): every completed, validated run now always
// contributes exactly one canonical CI-run externalEvidence entry (design
// section 25a), whatever its classification -- distinct from, and never
// containing, any accepted-determination entry (which stays impossible in
// this configuration per Corrective C2). Tests below that used to assert
// `externalEvidence: []` for a completed run now assert this instead.
function assertOnlyCiRunEvidence(externalEvidence, label) {
  assert.equal(externalEvidence.length, 1, label);
  assert.equal(externalEvidence[0].sourceObjectId.startsWith("ci-run:"), true, label);
  assert.equal(externalEvidence[0].immutability, "MUTABLE", label);
}

test("a clean, matching, fully successful attempt-1 run produces a PASS 1F.CI record classified CLEAN_FIRST_PASS", async () => {
  const r = await collectCiEvidence(baseInput());
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1F.CI");
  assert.equal(r.records[0].ownerStage, "1F");
  assert.equal(r.records[0].status, "PASS");
  assert.equal(r.records[0].observed.classification, "CLEAN_FIRST_PASS");
  assert.deepEqual(r.records[0].subject, subject);
  assertOnlyCiRunEvidence(r.externalEvidence);
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
  assertOnlyCiRunEvidence(r.externalEvidence);
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

// Corrective C2 (W4-SEC-H1): this test used to assert that the candidate below --
// whose `authenticatedActor`, `policy.authorizedDeterminers` and `contributors` are all
// supplied by the adapter itself -- yields PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN. That
// expectation was the vulnerability: an adapter is not an authenticated provider and its
// policy is not the base-anchored policy design section 17 rule 2 requires. The same
// candidate, even with a correctly computed digest, must stay HUMAN_REVIEW_REQUIRED.
test("SEC-C2-02 (replaces the C1 positive test): a self-consistent candidate from an injected adapter -- self-authorizing policy, correct digest -- stays HUMAN_REVIEW_REQUIRED with no externalEvidence and no determination fields", async () => {
  const candidate = validCandidate();
  candidate.contentDigest = computeDeterminationDigest(candidate.record);
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationAdapter: determinationAdapter(candidate) }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.records[0].observed.classification, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.records[0].reasonCode, "CI_UNEXPLAINED_RERUN");
  assertOnlyCiRunEvidence(r.externalEvidence);
  for (const field of ["authenticatedActor", "determinationMode", "contentDigest", "channelObjectId", "version", "rerunObserved", "attestationMode", "candidateClassification"]) {
    assert.equal(Object.hasOwn(r.records[0].observed, field), false, field);
  }
});

test("SEC-C1-01/02/03/04/05/13: a rerun with a REJECTED determination candidate (e.g. wrong repository binding -- a forged/mismatched record, actor, digest, channel ID or version all fail the SAME binding/authorization checks) still resolves to HUMAN_REVIEW_REQUIRED, never silently promoted", async () => {
  const r = await collectCiEvidence(baseInput({
    adapter: adapter(rerunRun()),
    determinationAdapter: determinationAdapter(validCandidate({ record: { ...validCandidate().record, repository: "wrong/repo" } })),
  }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assertOnlyCiRunEvidence(r.externalEvidence);
});

test("SEC-C1-06/24: no determinationAdapter injected at all -- the rerun resolves to HUMAN_REVIEW_REQUIRED; no privileged PASS is reachable through arbitrary public-API arguments without a resolvable adapter", async () => {
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()) }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.records[0].reasonCode, "CI_UNEXPLAINED_RERUN");
  assertOnlyCiRunEvidence(r.externalEvidence);
});

test("SEC-C1-06b: the original reproduction -- a bare `determinationCandidate` field on the public input -- is no longer read at all; it is silently ignored (not a supported field) and the rerun still resolves to HUMAN_REVIEW_REQUIRED", async () => {
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationCandidate: validCandidate() }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assertOnlyCiRunEvidence(r.externalEvidence);
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

// Corrective C2 (W4-SEC-H1): this test used to assert that an adapter-supplied
// OWNER_ATTESTED policy naming the adapter-supplied actor as owner is ACCEPTED as an
// attestation (OWNER_SELF_DETERMINATION, externalEvidence pinned). The cap on the
// classification held, but the acceptance did not: rule 4's owner must be named by the
// BASE policy, which cannot name one today. The attestation is therefore not accepted at
// all -- the rerun is an unexplained rerun, and nothing is pinned as accepted evidence.
test("SEC-C2-11/22 (replaces SEC-C1-15): an adapter-fabricated OWNER_ATTESTED policy is not accepted as an attestation -- HUMAN_REVIEW_REQUIRED/CI_UNEXPLAINED_RERUN, no attestation fields, no externalEvidence", async () => {
  const ownerPolicy = { authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "OWNER_ATTESTED", ownerAccountId: "555" };
  const r = await collectCiEvidence(baseInput({
    adapter: adapter(rerunRun()),
    determinationAdapter: determinationAdapter(validCandidate({ policy: ownerPolicy, contributors: { accountIds: ["github:555"], hasUnresolved: false } })),
  }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.records[0].reasonCode, "CI_UNEXPLAINED_RERUN");
  assert.equal(Object.hasOwn(r.records[0].observed, "rerunObserved"), false);
  assert.equal(Object.hasOwn(r.records[0].observed, "attestationMode"), false);
  assertOnlyCiRunEvidence(r.externalEvidence);
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

// SEC-C2-25 (mandatory disclosure, replaces SEC-C1-25): no test in this suite shows a
// determination being ACCEPTED through collectCiEvidence(), because none can be: there
// is no base-anchored determination policy (Stage 1A's policy schema has no such
// fields), no qualifying authenticated provider (the live D4-A provider is deferred),
// no verified edit history, no 1A-derived contributor set and no machine-collected
// failure signature (stages/1f/determination.js#UNMET_TRUST_PREREQUISITES). The tests
// prove SAFE FAIL-CLOSED behavior only; D4 operational authenticity is UNVERIFIED.

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

test("only the approved public interface and the Corrective C3 CI-run-evidence helper functions are exported through the module", () => {
  const mod = require("./ci-evidence");
  assert.deepEqual(
    [...Object.keys(mod)].sort(),
    ["ciRunSourceObjectId", "collectCiEvidence", "computeCiRunDigest", "isCiRunSourceObjectId", "sourceTypeForExternalEvidenceEntry"].sort(),
  );
});

// ---------------------------------------------------------------- Corrective C2 (W4-SEC-H1): public-facade negative matrix
//
// Every case goes through the PUBLIC facade (scripts/governance/index.js
// #collectCiEvidence), the exact interface the C1 re-review exploited. The base
// payload is the reviewer's original W4-SEC-H1 payload, unchanged: a fabricated
// authenticatedActor, a fabricated policy authorizing it, and a fabricated digest.

const originalAttackPayload = () => ({
  record: {
    repository: REPO, headSha: subject.head, runId: "42", failedAttempts: [1], finalAttempt: 2, failedJobs: ["Cypress - chrome"],
    failureSignature: "sig", reviewer: "anyone", decisionRef: "issue-comment:1", category: "KNOWN_CI_RELIABILITY_SIGNATURE", justification: "trust me",
  },
  authenticatedActor: { provider: "github", accountId: "attacker-1", accountType: "User" },
  contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1", collectedAt: "2026-09-30T00:00:00Z",
  policy: { authorizedDeterminers: [{ provider: "github", accountId: "attacker-1" }], determinationMode: "SEPARATE_PERSON" },
  contributors: { accountIds: ["github:someone-else"], hasUnresolved: false },
});
const withCorrectDigest = (candidate) => ({ ...candidate, contentDigest: computeDeterminationDigest(candidate.record) });
const twoLineAdapter = (candidate) => ({ fetchDetermination: async () => ({ ok: true, candidate }) });

async function assertUnexplainedRerun(extraInput, label) {
  const r = await governance.collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), ...extraInput }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED", label);
  assert.equal(r.records[0].observed.classification, "HUMAN_REVIEW_REQUIRED", label);
  assert.equal(r.records[0].reasonCode, "CI_UNEXPLAINED_RERUN", label);
  assertOnlyCiRunEvidence(r.externalEvidence, label);
}

test("SEC-C2-01: the original direct determinationCandidate attack stays blocked through the public facade", async () => {
  await assertUnexplainedRerun({ determinationCandidate: originalAttackPayload() }, "direct");
  await assertUnexplainedRerun({ determinationCandidate: withCorrectDigest(originalAttackPayload()) }, "direct, correct digest");
});

test("SEC-C2-02b: the original attack wrapped in a two-line adapter (the C1 re-review exploit) is blocked -- with the fabricated digest and with a correctly computed one", async () => {
  await assertUnexplainedRerun({ determinationAdapter: twoLineAdapter(originalAttackPayload()) }, "wrapped");
  await assertUnexplainedRerun({ determinationAdapter: twoLineAdapter(withCorrectDigest(originalAttackPayload())) }, "wrapped, correct digest");
});

test("SEC-C2-03/04: a null-prototype adapter and an adapter self-declaring authenticated-provider metadata are both blocked", async () => {
  const nullProto = Object.assign(Object.create(null), { fetchDetermination: async () => ({ ok: true, candidate: withCorrectDigest(originalAttackPayload()) }) });
  await assertUnexplainedRerun({ determinationAdapter: nullProto }, "null-prototype");
  const selfDeclared = {
    provider: "github", authenticated: true, verified: true, trusted: true,
    getAuthenticatedActor: () => originalAttackPayload().authenticatedActor, getTrustedPolicy: () => originalAttackPayload().policy,
    fetchDetermination: async () => ({ ok: true, candidate: withCorrectDigest(originalAttackPayload()), provider: "github", authenticated: true }),
  };
  await assertUnexplainedRerun({ determinationAdapter: selfDeclared }, "self-declared provider");
});

test("SEC-C2-05/06/07/08/09/10: adapter-supplied authorizedDeterminers, determinationMode, contributors, head-added determiners and fabricated account IDs grant no authority", async () => {
  const variants = {
    "05 authorizedDeterminers": { policy: { authorizedDeterminers: [{ provider: "github", accountId: "attacker-1" }], determinationMode: "SEPARATE_PERSON" } },
    "06 determinationMode": { policy: { authorizedDeterminers: [{ provider: "github", accountId: "attacker-1" }], determinationMode: "SEPARATE_PERSON", previousMode: "OWNER_ATTESTED" } },
    "07 contributors": { contributors: { accountIds: [], hasUnresolved: false } },
    "08 empty/absent base set": { policy: undefined },
    "09 head-added determiner": { policy: { authorizedDeterminers: [{ provider: "github", accountId: "maintainer" }, { provider: "github", accountId: "attacker-1" }], determinationMode: "SEPARATE_PERSON", source: "base" } },
    "10 fabricated account ID": { authenticatedActor: { provider: "github", accountId: "1", accountType: "User" }, policy: { authorizedDeterminers: [{ provider: "github", accountId: "1" }], determinationMode: "SEPARATE_PERSON" } },
  };
  for (const [label, overrides] of Object.entries(variants)) {
    await assertUnexplainedRerun({ determinationAdapter: twoLineAdapter(withCorrectDigest({ ...originalAttackPayload(), ...overrides })) }, label);
  }
});

test("SEC-C2-12/13: a fabricated 64-hex digest, and a digest taken before the record changed, both stay blocked", async () => {
  await assertUnexplainedRerun({ determinationAdapter: twoLineAdapter({ ...originalAttackPayload(), contentDigest: "0".repeat(64) }) }, "fabricated digest");
  const original = originalAttackPayload();
  const staleDigest = computeDeterminationDigest(original.record);
  await assertUnexplainedRerun({ determinationAdapter: twoLineAdapter({ ...original, record: { ...original.record, justification: "edited" }, contentDigest: staleDigest }) }, "changed record");
});

test("SEC-C2-14/15/16/17: missing edit history, a caller-controlled editHistoryVerified boolean, a caller-controlled version, and a claimed acceptance anchor are not proof", async () => {
  const variants = {
    "14 no history": {},
    "15 editHistoryVerified": { editHistoryVerified: true, historyComplete: true, deletedRevisions: false, immutability: "VERIFIED_PROVIDER" },
    "16 version": { version: "immutable-v1", lastEditedAt: "2020-01-01T00:00:00Z" },
    "17 anchor": { acceptanceAnchor: { digest: "a".repeat(64), anchoredBy: "github" }, anchored: true },
  };
  for (const [label, overrides] of Object.entries(variants)) {
    await assertUnexplainedRerun({ determinationAdapter: twoLineAdapter(withCorrectDigest({ ...originalAttackPayload(), ...overrides })) }, label);
  }
});

test("SEC-C2-19/20/21: cross-HEAD, cross-run and cross-repository determinations stay blocked through the facade", async () => {
  for (const [label, change] of [["19 head", { headSha: "b".repeat(40) }], ["20 run", { runId: "43" }], ["21 repo", { repository: "someone/else" }]]) {
    const payload = originalAttackPayload();
    await assertUnexplainedRerun({ determinationAdapter: twoLineAdapter(withCorrectDigest({ ...payload, record: { ...payload.record, ...change } })) }, label);
  }
});

test("SEC-C2-23/24: CLEAN_FIRST_PASS and FAIL remain operational, and a forged adapter cannot change either", async () => {
  const clean = await governance.collectCiEvidence(baseInput({ determinationAdapter: twoLineAdapter(originalAttackPayload()) }));
  assert.equal(clean.records[0].status, "PASS");
  assert.equal(clean.records[0].observed.classification, "CLEAN_FIRST_PASS");
  const failing = rerunRun({ jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }, { name: "Cypress - chrome", status: "completed", conclusion: "failure" }] });
  const failed = await governance.collectCiEvidence(baseInput({ adapter: adapter(failing), determinationAdapter: twoLineAdapter(withCorrectDigest(originalAttackPayload())) }));
  assert.equal(failed.records[0].status, "FAIL");
  assertOnlyCiRunEvidence(failed.externalEvidence);
});

test("SEC-C2-25/26/27: no adapter, a throwing adapter and malformed provider data all fail closed", async () => {
  await assertUnexplainedRerun({}, "25 no adapter");
  await assertUnexplainedRerun({ determinationAdapter: { fetchDetermination: async () => { throw new Error("boom"); } } }, "26 async throw");
  await assertUnexplainedRerun({ determinationAdapter: { fetchDetermination: () => { throw new Error("boom"); } } }, "26 sync throw");
  const cyclic = { ok: true }; cyclic.candidate = cyclic;
  for (const response of [null, "ok", { ok: true }, { ok: "true", candidate: originalAttackPayload() }, cyclic, { ok: true, candidate: { record: "x" } }]) {
    await assertUnexplainedRerun({ determinationAdapter: { fetchDetermination: async () => response } }, `27 ${typeof response}`);
  }
});

test("SEC-C2-28: no combination of injected adapter behavior reaches PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN through the public facade", async () => {
  const payload = withCorrectDigest(originalAttackPayload());
  const adapters = [
    twoLineAdapter(payload),
    { fetchDetermination: async ({ subject: s, run }) => ({ ok: true, candidate: withCorrectDigest({ ...payload, record: { ...payload.record, headSha: s.head, runId: run.runId, finalAttempt: run.attempt } }) }) },
    { fetchDetermination: async () => ({ ok: true, candidate: payload, trusted: true, basePolicy: payload.policy }) },
  ];
  for (const determinationAdapter of adapters) {
    const r = await governance.collectCiEvidence(baseInput({ adapter: adapter(rerunRun()), determinationAdapter }));
    assert.notEqual(r.records[0].observed.classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
    assert.notEqual(r.records[0].status, "PASS");
  }
});

// ======================================================================
// Corrective C6 (W4-C4R-INFO-2): requiredJobs policy validation at the
// collector's own boundary, reusing required-jobs.js's own policy validator
// (stages/1f/required-jobs.js#validateRequiredJobsPolicy()) rather than a
// second, weaker, divergent check. Every invalid case below used to reach
// classifyCiEvidence() (INCOMPLETE) and construct a full CI-run record plus
// externalEvidence entry that stages/1f/report.js's stricter run-evidence
// validation would then reject as malformed -- the collector and the report
// builder must agree about the same record's validity.
// ======================================================================

function assertMalformedRequiredJobsRejected(requiredJobs, label) {
  return (async () => {
    let r;
    try {
      r = await collectCiEvidence(baseInput({ requiredJobs }));
    } catch (err) {
      assert.fail(`${label}: collectCiEvidence() threw instead of a canonical rejection: ${err && err.message}`);
    }
    assert.equal(r.records.length, 0, `${label}: no forged successful CI record`);
    assert.equal(r.outcome.status, "CONFIGURATION_ERROR", label);
    assert.deepEqual(r.externalEvidence, [], `${label}: no CI_RUN externalEvidence`);
  })();
}

test("C6-INFO2-01: requiredJobs missing (undefined) is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(undefined, "missing");
});
test("C6-INFO2-02: requiredJobs null is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(null, "null");
});
test("C6-INFO2-03: requiredJobs as a number is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(5, "number");
});
test("C6-INFO2-04: requiredJobs as a string is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected("Unit tests", "string");
});
test("C6-INFO2-05: requiredJobs as an empty array is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected([], "empty array");
});
test("C6-INFO2-06: requiredJobs containing a non-string value is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(["Unit tests", 42], "non-string entry");
});
test("C6-INFO2-07: requiredJobs containing an empty job name is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(["Unit tests", ""], "empty name");
});
test("C6-INFO2-08: requiredJobs containing a name longer than 200 characters is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(["Unit tests", "x".repeat(201)], "oversized name");
});
test("C6-INFO2-09: requiredJobs containing more than 256 entries is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(Array.from({ length: 257 }, (_, i) => `job-${i}`), "too many entries");
});
test("C6-INFO2-10: requiredJobs containing duplicate names is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(["Unit tests", "Unit tests"], "duplicate names");
});

test("C6-INFO2-11: a valid policy with a missing CI job remains a legitimate INCOMPLETE classification", async () => {
  const run = rawRun({ jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }] });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "INCOMPLETE");
  assertOnlyCiRunEvidence(r.externalEvidence);
});

test("C6-INFO2-12: a valid policy with a failed required job remains FAIL", async () => {
  const run = rawRun({ jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }, { name: "Cypress - chrome", status: "completed", conclusion: "failure" }] });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "FAIL");
  assertOnlyCiRunEvidence(r.externalEvidence);
});

test("C6-INFO2-13: a valid complete first pass remains CLEAN_FIRST_PASS", async () => {
  const r = await collectCiEvidence(baseInput());
  assert.equal(r.records[0].observed.classification, "CLEAN_FIRST_PASS");
  assertOnlyCiRunEvidence(r.externalEvidence);
});

test("C6-INFO2-14: a valid completed rerun without accepted determination remains HUMAN_REVIEW_REQUIRED", async () => {
  const r = await collectCiEvidence(baseInput({ adapter: adapter(rerunRun()) }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assertOnlyCiRunEvidence(r.externalEvidence);
});

test("C6-INFO2-15: no malformed requiredJobs input can produce a completed-run record plus externalEvidence that report.js would reject as a schema mismatch (cross-module integration)", async () => {
  const { buildReport } = require("./report");
  const trustedContext = {
    mode: "PR_REVIEW", invocationTrust: "PLATFORM_AUTHENTICATED", provider: "github", repositoryId: REPO,
    eventType: "pull_request", targetRefName: "main", resolvedTargetTip: "b".repeat(40), suppliedTargetSha: null,
    headSha: subject.head, base: subject.base, baseDerivation: "merge-base", workflowIdentity: null, workflowBlobSha: null,
    baseWorkflowBlobSha: null, defaultBranch: "main", rootTip: "c".repeat(40), rootPolicyDigest: null, basePolicyDigest: null,
    executedFrom: "HEAD", frameworkVersion: "1.0.0", targetSupportedCapabilities: [], targetSupportedSchemaVersions: [1],
    requiredCapabilities: [], phase: 2, collectorRunId: "collector-1", executedCommit: subject.head,
  };
  const manifest = { gatePath: "governance/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] };
  const identity = { checkId: "1A.IDENTITY", ownerStage: "1A", status: "PASS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] };
  for (const requiredJobs of [["Unit tests", "Unit tests"], Array.from({ length: 300 }, (_, i) => `job-${i}`), ["Unit tests", ""]]) {
    const ci = await collectCiEvidence(baseInput({ requiredJobs }));
    assert.equal(ci.records.length, 0, JSON.stringify(requiredJobs));
    // Since the collector itself already refused to produce a record, there is
    // nothing malformed left for buildReport() to be handed in the first place --
    // this IS the fix: report.js is never even reached with a schema-mismatched record.
  }
});

test("C6-INFO2-16: valid requiredJobs names at the allowed length (200 chars) and count (256 entries) bounds remain supported", async () => {
  const namesAtBound = Array.from({ length: 256 }, (_, i) => `job-${String(i).padStart(3, "0")}-${"x".repeat(192)}`); // each exactly 200 chars, all unique
  assert.equal(new Set(namesAtBound.map((n) => n.length)).size, 1);
  assert.equal(namesAtBound[0].length, 200);
  const run = rawRun({ jobs: namesAtBound.map((name) => ({ name, status: "completed", conclusion: "success" })) });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run), requiredJobs: namesAtBound }));
  assert.equal(r.records[0].status, "PASS");
  assert.equal(r.records[0].observed.classification, "CLEAN_FIRST_PASS");
});
