"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectCiEvidence } = require("./ci-evidence");
const { computeDeterminationDigest } = require("./determination");
const governance = require("../../index");
const { validateResultRecord } = require("../../kernel/results");
const { makeSubject, reportContext, requiredRecords } = require("../../test-support-git");

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

// Corrective C7 (W4-C6R-DEV-L1, end-to-end): a buggy or malicious adapter
// cannot manufacture the FAIL-mapped outcome the three tests above establish
// for a GENUINE wrong-identity run by simply claiming a WRONG_* reason
// string in an ordinary fetch-failure response -- ci-run.js's
// normalizeFetchFailureReason() (Corrective C7) strips exactly that
// impersonation before this module ever sees the reason, so the classifier's
// own `reason.startsWith("WRONG_")` test can never be fooled by adapter text.
test("C7-L1: an adapter claiming a spoofed WRONG_SHA reason in an ordinary fetch-failure response (never having actually fetched or compared a run) is classified INCOMPLETE, not FAIL -- the WRONG_* signal cannot be manufactured by adapter text", async () => {
  const r = await collectCiEvidence(baseInput({ adapter: adapter({ ok: false, reason: "WRONG_SHA" }) }));
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].observed.reason, "SOURCE_UNREACHABLE");
});

test("a rerun with no determination candidate resolves to HUMAN_REVIEW_REQUIRED, never an automatic pass", async () => {
  const run = rawRun({ attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }] });
  const r = await collectCiEvidence(baseInput({ adapter: adapter(run) }));
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assertOnlyCiRunEvidence(r.externalEvidence);
});

// Corrective C7 (W4-C6R-DEV-L2, end-to-end TOCTOU reproduction): BEFORE this
// corrective, `input.requiredJobs` was read once (synchronously) to run
// checkRequiredJobs() against the fetched run, then read AGAIN (after the
// conditional `await resolvedAdapter.adapter.fetchDetermination()` a rerun
// triggers) to build the stored record and the CI-run evidence digest. A
// caller whose `requiredJobs` was a getter -- or who held a mutable
// reference and mutated it during that await window -- could make the job
// set actually CHECKED against the run differ from the job set actually
// PUBLISHED and hashed. This test uses a getter that returns a fresh copy
// each time and counts invocations: a fix that re-reads the input after the
// await calls the getter twice; the current single-snapshot fix
// (validateRequiredJobsPolicy() takes ONE read and every later use consumes
// that same frozen snapshot) calls it exactly once.
test("C7-L2: requiredJobs is read exactly ONCE by collectCiEvidence(), even when a rerun forces an await (fetchDetermination) between the required-job check and the record/digest construction -- no re-read TOCTOU window", async () => {
  let reads = 0;
  const input = baseInput({
    adapter: adapter(rerunRun()),
    determinationAdapter: { fetchDetermination: async () => { await Promise.resolve(); return { ok: false }; } },
  });
  Object.defineProperty(input, "requiredJobs", {
    enumerable: true,
    get() { reads += 1; return [...REQUIRED]; },
  });
  const r = await collectCiEvidence(input);
  assert.equal(reads, 1, "requiredJobs must be read exactly once, before the await, never re-read after it");
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(r.records[0].observed.requiredJobs, [...REQUIRED].sort());
});

// ---------------------------------------------------------------- Corrective C8 (W4-C7R-DEV-L1): iterator-bypass, end to end
//
// Reproduces the mission's exact scenario: a completed run whose ACTUAL
// required-job policy (indexed content) includes a job the run never ran,
// but whose Symbol.iterator override hides that job from anything that
// still trusted the iterator. Before this corrective's fix (Symbol
// required-jobs.js), the collector's own boundary check used the iterator's
// (short, satisfied-only) view to build the snapshot, so the missing job
// never appeared anywhere -- collectCiEvidence() produced a false
// CLEAN_FIRST_PASS record, and buildReport() then reached a false READY on
// zero real evidence of the missing job. This test asserts the fixed
// behavior: the indexed policy (including the hidden job) is what is
// actually checked, published and digested; the iterator's substitute
// content has no effect anywhere in the pipeline.
test("C8-DEV-L1: a requiredJobs array whose Symbol.iterator hides a real, indexed-only required job cannot produce a false CLEAN_FIRST_PASS or false READY (producer/consumer integration, collectCiEvidence -> buildReport)", async () => {
  const { buildReport } = require("./report");
  const indexedPolicy = [...REQUIRED, "Missing Job Hidden By Iterator"];
  const maliciousArray = [...indexedPolicy];
  maliciousArray[Symbol.iterator] = function* () { for (const name of REQUIRED) yield name; };

  const r = await collectCiEvidence(baseInput({ requiredJobs: maliciousArray }));
  assert.equal(r.records[0].observed.classification, "INCOMPLETE", "the hidden job must not be silently satisfied");
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.deepEqual(r.records[0].observed.missing, ["Missing Job Hidden By Iterator"]);
  assert.deepEqual(r.records[0].observed.requiredJobs, [...indexedPolicy].sort(), "the PUBLISHED policy must be the real indexed one, not the iterator's substitute");

  // Corrective C1 (1G M2/L3): an authoritative target-tip Phase 2 context.
  const trustedContext = reportContext(subject, { repositoryId: REPO });
  const manifest = { gatePath: "governance/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] };
  // Corrective C1 (1G M1): every result a report requires, so CI alone decides readiness.
  const identity = requiredRecords(subject);
  const report = buildReport({
    subject, tool: { name: "gov-auto-1", version: "0.0.0" }, trustedContext, externalEvidence: r.externalEvidence,
    manifest, reviewClass: "HEAVY", changedFiles: [], records: [...identity, ...r.records],
  });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.notEqual(report.report.readiness.state, "READY", "a hidden missing job must never reach READY");
  assert.equal(report.report.readiness.state, "NOT_READY");
  assert.equal(report.report.ci.classification, "INCOMPLETE");
});

test("C8-DEV-L1: a requiredJobs array whose Symbol.iterator differs from its indexed content, but whose REAL indexed policy is fully satisfied, still composes into an accepted CLEAN_FIRST_PASS report under the operator boundary (positive control)", async () => {
  const { buildReport } = require("./report");
  const decoyArray = [...REQUIRED];
  decoyArray[Symbol.iterator] = function* () { yield "Some Other Job Entirely"; };

  const r = await collectCiEvidence(baseInput({ requiredJobs: decoyArray }));
  assert.equal(r.records[0].observed.classification, "CLEAN_FIRST_PASS");
  assert.deepEqual(r.records[0].observed.requiredJobs, [...REQUIRED].sort());

  // D16: this fixture is intentionally operator-supplied and cannot mint READY.
  const trustedContext = reportContext(subject, { repositoryId: REPO });
  const manifest = { gatePath: "governance/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] };
  // Corrective C1 (1G M1): every result a report requires, so CI alone decides readiness.
  const identity = requiredRecords(subject);
  const report = buildReport({
    subject, tool: { name: "gov-auto-1", version: "0.0.0" }, trustedContext, externalEvidence: r.externalEvidence,
    manifest, reviewClass: "HEAVY", changedFiles: [], records: [...identity, ...r.records],
  });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.report.readiness.state, "NOT_READY");
  assert.ok(report.report.readiness.reasons.includes("OPERATOR_INVOCATION"));
  assert.equal(report.report.ci.classification, "CLEAN_FIRST_PASS");
});

// Corrective C8 (mission section 11: preserve C7 TOCTOU hardening against the
// NEW indexed-read fix). Reproduces the original C7 getter scenario, but now
// with getter-backed INDEXED ELEMENTS (not just a getter-backed
// `requiredJobs` property) to prove the new explicit-index-read loop still
// reads each element exactly once, still uses the same validated snapshot
// for both the required-job check and the published record/digest across
// the rerun/determination await, and is unaffected by a caller mutating the
// original array's elements after validation.
test("C8-DEV-L1: getter-backed INDEXED ELEMENTS of requiredJobs are each read exactly once, the same validated snapshot is used across the rerun/determination await, and post-validation mutation of the original array has no effect", async () => {
  let reads = 0;
  const original = [...REQUIRED];
  const trackedArray = [...REQUIRED];
  REQUIRED.forEach((name, i) => {
    Object.defineProperty(trackedArray, i, { enumerable: true, configurable: true, get() { reads += 1; return name; } });
  });

  const input = baseInput({
    requiredJobs: trackedArray,
    adapter: adapter(rerunRun()),
    determinationAdapter: { fetchDetermination: async () => { await Promise.resolve(); return { ok: false }; } },
  });
  const r = await collectCiEvidence(input);
  assert.equal(reads, REQUIRED.length, "each indexed element must be read exactly once, even across the rerun await");
  assert.equal(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(r.records[0].observed.requiredJobs, [...original].sort());

  // Mutate the caller's original array after validation -- must have no effect.
  // (index 0 is a getter-only accessor property; redefine it via
  // defineProperty, since a plain assignment to a getter-only property
  // throws in strict mode rather than silently mutating anything.)
  Object.defineProperty(trackedArray, 0, { enumerable: true, configurable: true, get() { return "Mutated After Validation"; } });
  assert.deepEqual(r.records[0].observed.requiredJobs, [...original].sort());
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

// Corrective C7 (AQA-INFO-3c): this helper used to assert only the generic
// outcome.status ("CONFIGURATION_ERROR") -- which every one of these cases
// already shares, so it could not distinguish "rejected for the right
// reason" from "rejected for ANY reason, including a wrong one, or an
// unrelated later failure that happens to share the same status". It now
// also asserts the SPECIFIC canonical reason code
// (required-jobs.js#validateRequiredJobsPolicy()'s own
// MALFORMED_REQUIRED_JOB_POLICY / DUPLICATE_REQUIRED_JOB_NAME) appears in
// outcome.detail, so each test actually proves the boundary check fired for
// the case it claims to cover.
function assertMalformedRequiredJobsRejected(requiredJobs, expectedReason, label) {
  return (async () => {
    let r;
    try {
      r = await collectCiEvidence(baseInput({ requiredJobs }));
    } catch (err) {
      assert.fail(`${label}: collectCiEvidence() threw instead of a canonical rejection: ${err && err.message}`);
    }
    assert.equal(r.records.length, 0, `${label}: no forged successful CI record`);
    assert.equal(r.outcome.status, "CONFIGURATION_ERROR", label);
    assert.match(r.outcome.detail, new RegExp(expectedReason), `${label}: expected reason ${expectedReason}, got: ${r.outcome.detail}`);
    assert.deepEqual(r.externalEvidence, [], `${label}: no CI_RUN externalEvidence`);
  })();
}

test("C6-INFO2-01: requiredJobs missing (undefined) is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(undefined, "MALFORMED_REQUIRED_JOB_POLICY", "missing");
});
test("C6-INFO2-02: requiredJobs null is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(null, "MALFORMED_REQUIRED_JOB_POLICY", "null");
});
test("C6-INFO2-03: requiredJobs as a number is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(5, "MALFORMED_REQUIRED_JOB_POLICY", "number");
});
test("C6-INFO2-04: requiredJobs as a string is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected("Unit tests", "MALFORMED_REQUIRED_JOB_POLICY", "string");
});
test("C6-INFO2-05: requiredJobs as an empty array is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected([], "MALFORMED_REQUIRED_JOB_POLICY", "empty array");
});
test("C6-INFO2-06: requiredJobs containing a non-string value is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(["Unit tests", 42], "MALFORMED_REQUIRED_JOB_POLICY", "non-string entry");
});
test("C6-INFO2-07: requiredJobs containing an empty job name is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(["Unit tests", ""], "MALFORMED_REQUIRED_JOB_POLICY", "empty name");
});
test("C6-INFO2-08: requiredJobs containing a name longer than 200 characters is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(["Unit tests", "x".repeat(201)], "MALFORMED_REQUIRED_JOB_POLICY", "oversized name");
});
test("C6-INFO2-09: requiredJobs containing more than 256 entries is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(Array.from({ length: 257 }, (_, i) => `job-${i}`), "MALFORMED_REQUIRED_JOB_POLICY", "too many entries");
});
test("C6-INFO2-10: requiredJobs containing duplicate names is rejected at the collector boundary", async () => {
  await assertMalformedRequiredJobsRejected(["Unit tests", "Unit tests"], "DUPLICATE_REQUIRED_JOB_NAME", "duplicate names");
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

// Corrective C7 (AQA-INFO-3b): this test's name promises a "cross-module
// integration" check, but originally only asserted the collector-side
// precondition (0 records) for the malformed cases -- it imported
// buildReport() and never called it, so it never actually demonstrated
// report.js's side of the agreement. It now does both: the malformed cases
// still assert that the collector itself already refuses to produce a
// record (so there is nothing malformed left for buildReport() to be handed
// in the first place -- report.js is never even reached with a schema-
// mismatched record), AND a positive control feeds a VALID collector output
// through buildReport() end to end, confirming the two modules actually do
// agree on what a legitimate record looks like, not merely that the negative
// path never reaches the second module.
test("C6-INFO2-15: no malformed requiredJobs input can produce a completed-run record plus externalEvidence that report.js would reject as a schema mismatch (cross-module integration)", async () => {
  const { buildReport } = require("./report");
  // D16: this fixture is intentionally operator-supplied and cannot mint READY.
  const trustedContext = reportContext(subject, { repositoryId: REPO });
  const manifest = { gatePath: "governance/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] };
  // Corrective C1 (1G M1): every result a report requires, so CI alone decides readiness.
  const identity = requiredRecords(subject);

  // Negative cases: the collector's own boundary rejects the malformed
  // policy before any record or externalEvidence exists -- buildReport()
  // is never reached with a schema-mismatched record because it is never
  // reached at all.
  for (const requiredJobs of [["Unit tests", "Unit tests"], Array.from({ length: 300 }, (_, i) => `job-${i}`), ["Unit tests", ""]]) {
    const ci = await collectCiEvidence(baseInput({ requiredJobs }));
    assert.equal(ci.records.length, 0, JSON.stringify(requiredJobs));
    assert.deepEqual(ci.externalEvidence, [], JSON.stringify(requiredJobs));
  }

  // Positive control: a VALID collector output, folded into buildReport()
  // alongside the other required Phase 2 records, is accepted while the
  // operator boundary keeps readiness capped -- proving report.js accepts exactly what the collector legitimately
  // produces, not merely that malformed input never gets that far.
  const ci = await collectCiEvidence(baseInput());
  assert.equal(ci.records[0].observed.classification, "CLEAN_FIRST_PASS");
  const report = buildReport({
    subject, tool: { name: "gov-auto-1", version: "0.0.0" }, trustedContext, externalEvidence: ci.externalEvidence,
    manifest, reviewClass: "HEAVY", changedFiles: [], records: [...identity, ...ci.records],
  });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.report.readiness.state, "NOT_READY");
  assert.ok(report.report.readiness.reasons.includes("OPERATOR_INVOCATION"));
  assert.equal(report.report.ci.classification, "CLEAN_FIRST_PASS");
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

// ---------------------------------------------------------------- Corrective C9 (W4-C8R-DEV-L1): Proxy-safe policy snapshot, end to end
//
// The reproduced defect (C8 HEAD 6be0521): a Proxy-wrapped requiredJobs whose
// `length` read answered 3 during validation and 2 when the snapshot was
// sized dropped "Hidden Job" from the effective policy -- collectCiEvidence()
// produced CLEAN_FIRST_PASS and buildReport() reached READY although the run
// never ran that job. Answering 1 then 0 / 1 then 300 made the collector
// publish completed-run evidence buildReport() then rejected (a collector/
// report schema mismatch), and a throwing ownKeys trap escaped
// collectCiEvidence() as an uncaught exception. These tests drive the real
// collectCiEvidence() -> buildReport() composition.

const { computeCiRunDigest } = require("./ci-evidence");

// Answers the FIRST `length` read with the real length and every later read
// with `later` (and any index past the real end with a phantom name), so a
// validator that reads `length` more than once is observable.
function c9LengthProxy(target, later) {
  let lengthReads = 0;
  return new Proxy(target, {
    get(t, k, r) {
      if (k === "length") { lengthReads += 1; return lengthReads === 1 ? t.length : later; }
      if (typeof k === "string" && /^\d+$/.test(k) && Number(k) >= t.length) return `phantom-${k}`;
      return Reflect.get(t, k, r);
    },
  });
}

function c9Report(collected) {
  const { buildReport } = require("./report");
  // D16: this fixture is intentionally operator-supplied and cannot mint READY.
  const trustedContext = reportContext(subject, { repositoryId: REPO });
  const manifest = { gatePath: "governance/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] };
  // Corrective C1 (1G M1): every result a report requires, so CI alone decides readiness.
  const identity = requiredRecords(subject);
  return buildReport({
    subject, tool: { name: "gov-auto-1", version: "0.0.0" }, trustedContext, externalEvidence: collected.externalEvidence,
    manifest, reviewClass: "HEAVY", changedFiles: [], records: [...identity, ...collected.records],
  });
}

// The published job set and the CI-run digest must describe the same policy.
function assertPublishedMatchesDigest(collected, expectedRequiredJobs, label) {
  const o = collected.records[0].observed;
  assert.deepEqual(o.requiredJobs, [...expectedRequiredJobs].sort(), `${label}: published requiredJobs`);
  assert.equal(collected.externalEvidence.length, 1, label);
  const expectedDigest = computeCiRunDigest({
    repository: o.repository, workflowPath: o.workflowPath, runId: o.runId, event: o.event, headSha: subject.head,
    attempt: o.attempt, status: o.status, requiredJobs: o.requiredJobs, missing: o.missing, failed: o.failed,
    pending: o.pending, skipped: o.skipped, attemptHistory: o.attemptHistory,
  });
  assert.equal(collected.externalEvidence[0].contentDigest, expectedDigest, `${label}: digest describes the published job set`);
}

test("C9-E2E-01 [mandatory false-READY regression, W4-C8R-DEV-L1 P1]: a Proxy answering length 3 then 2 cannot drop a missing required job -- INCOMPLETE and NOT_READY, never CLEAN_FIRST_PASS/READY", async () => {
  const indexedPolicy = ["Unit tests", "Cypress - chrome", "Hidden Job"];
  const r = await collectCiEvidence(baseInput({ requiredJobs: c9LengthProxy([...indexedPolicy], 2) }));
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].observed.classification, "INCOMPLETE");
  assert.deepEqual(r.records[0].observed.missing, ["Hidden Job"]);
  assertPublishedMatchesDigest(r, indexedPolicy, "P1");

  const report = c9Report(r);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.report.readiness.state, "NOT_READY");
  assert.equal(report.report.ci.classification, "INCOMPLETE");
});

test("C9-E2E-02 [collector/report agreement, P2]: a Proxy answering length 1 then 0 yields the one-job policy the collector validated, and buildReport() accepts the collector's own record", async () => {
  const r = await collectCiEvidence(baseInput({ requiredJobs: c9LengthProxy(["Hidden Job"], 0) }));
  assert.equal(r.records[0].observed.classification, "INCOMPLETE");
  assert.deepEqual(r.records[0].observed.missing, ["Hidden Job"]);
  assertPublishedMatchesDigest(r, ["Hidden Job"], "P2");
  const report = c9Report(r);
  assert.equal(report.ok, true, `the report builder must accept the collector's own output: ${JSON.stringify(report)}`);
  assert.equal(report.report.readiness.state, "NOT_READY");
});

test("C9-E2E-03 [collector/report agreement, P3]: a Proxy answering length 1 then 300 yields the one-job policy the collector validated (never 300 entries), and buildReport() accepts the collector's own record", async () => {
  const r = await collectCiEvidence(baseInput({ requiredJobs: c9LengthProxy(["Unit tests"], 300) }));
  assert.equal(r.records[0].observed.requiredJobs.length, 1);
  assertPublishedMatchesDigest(r, ["Unit tests"], "P3");
  const report = c9Report(r);
  assert.equal(report.ok, true, `the report builder must accept the collector's own output: ${JSON.stringify(report)}`);
  // the real one-job policy is fully satisfied by the run, so this is a genuine pass on that policy
  assert.equal(report.report.ci.classification, "CLEAN_FIRST_PASS");
  assert.equal(report.report.readiness.state, "NOT_READY");
  assert.ok(report.report.readiness.reasons.includes("OPERATOR_INVOCATION"));
});

test("C9-E2E-04 [fail-closed collector boundary, P4 + traps]: throwing Proxy traps (ownKeys, getOwnPropertyDescriptor, length, indexed get) and an inherited-hole policy are a canonical CONFIGURATION_ERROR with zero records and zero CI_RUN evidence, never an uncaught exception", async () => {
  const thrower = (trap) => () => { throw new Error(`${trap} boom`); };
  const proto = Object.create(Array.prototype);
  proto[1] = "Inherited Job";
  const inherited = ["Unit tests"]; inherited.length = 2; Object.setPrototypeOf(inherited, proto);
  const cases = [
    ["ownKeys", new Proxy([...REQUIRED], { ownKeys: thrower("ownKeys") })],
    ["getOwnPropertyDescriptor", new Proxy([...REQUIRED], { getOwnPropertyDescriptor: thrower("gopd") })],
    ["length get", new Proxy([...REQUIRED], { get(t, k, rc) { if (k === "length") throw new Error("length boom"); return Reflect.get(t, k, rc); } })],
    ["indexed get", new Proxy([...REQUIRED], { get(t, k, rc) { if (k === "1") throw new Error("index boom"); return Reflect.get(t, k, rc); } })],
    ["inherited hole", inherited],
  ];
  for (const [label, requiredJobs] of cases) {
    await assertMalformedRequiredJobsRejected(requiredJobs, "MALFORMED_REQUIRED_JOB_POLICY", label);
  }
});

test("C9-PROXY-20 [TOCTOU across the async determination path]: mutating the caller's array and the Proxy's answers during the rerun await cannot change the checked, published or digested job set", async () => {
  const target = [...REQUIRED, "Hidden Job"];
  let phase = "validate";
  const proxied = new Proxy(target, {
    get(t, k, rc) {
      if (phase !== "validate" && k === "length") return 2;
      if (phase !== "validate" && k === "2") return "Unit tests";
      return Reflect.get(t, k, rc);
    },
  });
  const input = baseInput({
    requiredJobs: proxied,
    adapter: adapter(rerunRun()),
    determinationAdapter: {
      fetchDetermination: async () => {
        phase = "mutated";
        target.length = 0;
        target.push("Replacement Job");
        await Promise.resolve();
        return { ok: false };
      },
    },
  });
  const r = await collectCiEvidence(input);
  assert.equal(phase, "mutated", "the determination await must actually have run");
  // a missing required job (INCOMPLETE) outranks the unexplained rerun
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.deepEqual(r.records[0].observed.missing, ["Hidden Job"], "the job set checked before the await is the one reported");
  assertPublishedMatchesDigest(r, [...REQUIRED, "Hidden Job"], "after async mutation");
  const report = c9Report(r);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.notEqual(report.report.readiness.state, "READY");
});
