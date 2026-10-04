"use strict";

// GOV-AUTO-1 Wave 4 / 1F WP11: an explicit end-to-end demonstration that the
// two-phase model (design section 17) actually composes correctly across
// buildReport() and collectCiEvidence() -- not just that each module is
// individually correct in isolation (already covered by their own suites).

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport } = require("./report");
const { collectCiEvidence, ciRunSourceObjectId, computeCiRunDigest } = require("./ci-evidence");
const { renderMarkdown } = require("./render-markdown");
const { revalidateEvidence } = require("../../kernel/revalidation");
const { makeSubject, reportContext, requiredRecords } = require("../../test-support-git");

const subject = makeSubject();
const REPO = "TarasovArtem/qa-ai-agent";
const WORKFLOW = ".github/workflows/cypress.yml";
const REQUIRED = ["Unit tests"];

// D16: reportContext deliberately models an operator invocation. It can carry
// valid evidence and classifications, but it cannot authenticate READY.
const trustedContext = (phase) => reportContext(subject, { repositoryId: REPO, phase });
// Corrective C1 (1G L1): revalidation always re-resolves the governance root and
// compares it with the report's own values; this resolver reports them unchanged.
const rootOf = (report) => ({ resolve: async () => ({ ok: true, rootTip: report.trustedContext.rootTip, digest: report.trustedContext.rootPolicyDigest }) });
const manifest = () => ({ gatePath: "governance/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] });
const NOW = "2026-09-30T00:00:00.000Z";

// Corrective C3 (W4-C2R-DEV-M2): a completed, validated run always contributes
// exactly one canonical CI-run externalEvidence entry now -- distinct from,
// and never containing, any accepted-determination entry.
function assertOnlyCiRunEvidence(externalEvidence) {
  assert.equal(externalEvidence.length, 1);
  assert.equal(externalEvidence[0].sourceObjectId.startsWith("ci-run:"), true);
}
function assertOperatorBoundary(report, additionalReason) {
  assert.equal(report.readiness.state, "NOT_READY");
  for (const reason of ["EXECUTION_NOT_FROM_TARGET_TIP", "OPERATOR_INVOCATION", "PLATFORM_PROVENANCE_UNAVAILABLE"]) {
    assert.ok(report.readiness.reasons.includes(reason), `${reason}: ${JSON.stringify(report.readiness)}`);
  }
  if (additionalReason) assert.ok(report.readiness.reasons.includes(additionalReason), `${additionalReason}: ${JSON.stringify(report.readiness)}`);
}
const genericRecord = (checkId, ownerStage, status) => ({ checkId, ownerStage, status, subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });
// Corrective C1 (1G M1): every result a report requires, so only CI decides readiness here.
const phase1Records = requiredRecords(subject);

function reportInput(overrides = {}) {
  return { subject, tool: { name: "gov-auto-1", version: "0.0.0" }, trustedContext: trustedContext(1), externalEvidence: [], manifest: manifest(), reviewClass: "HEAVY", changedFiles: [], records: phase1Records, ci: { state: "NOT_COLLECTED" }, ...overrides };
}

function cleanRunAdapter() {
  return {
    fetchRun: async () => ({
      ok: true,
      run: { repository: REPO, workflowPath: WORKFLOW, runId: "1", event: "pull_request", headSha: subject.head, attempt: 1, status: "completed", jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }], attemptHistory: [] },
    }),
  };
}
function failingRunAdapter() {
  return {
    fetchRun: async () => ({
      ok: true,
      run: { repository: REPO, workflowPath: WORKFLOW, runId: "1", event: "pull_request", headSha: subject.head, attempt: 1, status: "completed", jobs: [{ name: "Unit tests", status: "completed", conclusion: "failure" }], attemptHistory: [] },
    }),
  };
}

test("Phase 1: a report built with ci=NOT_COLLECTED is never READY, even when every other record is PASS", () => {
  const r = buildReport(reportInput());
  assert.equal(r.ok, true);
  assert.equal(r.report.finalized, false);
  assert.deepEqual(r.report.ci, { state: "NOT_COLLECTED" });
  assert.notEqual(r.report.readiness.state, "READY");
  assert.equal(r.report.readiness.state, "NOT_READY");
});

test("Phase 2: collectCiEvidence() output, folded into a second buildReport() call, finalizes the clean report while the operator boundary prevents READY", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: cleanRunAdapter(), requiredJobs: REQUIRED, now: NOW });
  assert.equal(ci.records[0].status, "PASS");
  assertOnlyCiRunEvidence(ci.externalEvidence);

  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  assert.equal(finalReport.ok, true);
  assert.equal(finalReport.report.finalized, true);
  assert.equal(finalReport.report.overallStatus, "INCOMPLETE");
  assertOperatorBoundary(finalReport.report);
  assert.equal(finalReport.report.ci.classification, "CLEAN_FIRST_PASS");
});

test("Phase 2 with a failing required CI job: the 1F.CI record alone prevents READY even though every 1A-1E record is PASS -- the CI record genuinely participates in aggregation, not decoration", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: failingRunAdapter(), requiredJobs: REQUIRED, now: NOW });
  assert.equal(ci.records[0].status, "FAIL");

  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  assert.equal(finalReport.ok, true);
  assert.equal(finalReport.report.finalized, true);
  assert.notEqual(finalReport.report.readiness.state, "READY");
  assert.equal(finalReport.report.overallStatus, "FAIL");
});

test("the Phase 1 and Phase 2 reports for the SAME subject share the identical generatedFor identity -- no cross-phase subject drift", async () => {
  const p1 = buildReport(reportInput());
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: cleanRunAdapter(), requiredJobs: REQUIRED, now: NOW });
  const p2 = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  assert.deepEqual(p1.report.generatedFor, p2.report.generatedFor);
});

test("rendering the finalized Phase 2 report to Markdown never disagrees with its own JSON readiness value", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: cleanRunAdapter(), requiredJobs: REQUIRED, now: NOW });
  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  const md = renderMarkdown(finalReport.report);
  assert.match(md, new RegExp(`Readiness state: \`${finalReport.report.readiness.state}\``));
});

// ---------------------------------------------------------------- Corrective C1 (W4-SEC-H1 + W4-DEV-M1): full rerun composition through the real adapter seam

function rerunRunAdapter() {
  return {
    fetchRun: async () => ({
      ok: true,
      run: { repository: REPO, workflowPath: WORKFLOW, runId: "2", event: "pull_request", headSha: subject.head, attempt: 2, status: "completed", jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }], attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }] },
    }),
  };
}
function acceptedDeterminationAdapter() {
  return {
    fetchDetermination: async () => ({
      ok: true,
      candidate: {
        record: { repository: REPO, headSha: subject.head, runId: "2", failedAttempts: [1], finalAttempt: 2, failedJobs: ["Unit tests"], failureSignature: "sig", reviewer: "x", decisionRef: "issue-comment:1", category: "KNOWN_CI_RELIABILITY_SIGNATURE", justification: "known symptom" },
        authenticatedActor: { provider: "github", accountId: "555", accountType: "User" },
        contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1", collectedAt: "2026-09-28T00:00:00Z",
        policy: { authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "SEPARATE_PERSON" },
        contributors: { accountIds: ["github:111"], hasUnresolved: false },
      },
    }),
  };
}

// Corrective C2 (W4-SEC-H1): this test used to assert that the adapter below -- whose
// actor, self-authorizing policy and contributors are all its own claims -- carries a
// Phase 2 report to READY. That was the reproduced exploit end to end. The same
// composition must now stay HUMAN_REVIEW_REQUIRED, with JSON and Markdown agreeing.
test("DEV-C1-11 (corrected by C2): Phase 2 with a fabricated adapter-mediated SEPARATE_PERSON determination stays HUMAN_REVIEW_REQUIRED end to end -- never READY -- and Markdown agrees with the JSON", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: rerunRunAdapter(), requiredJobs: REQUIRED, determinationAdapter: acceptedDeterminationAdapter(), now: NOW });
  assert.equal(ci.records[0].status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(ci.records[0].reasonCode, "CI_UNEXPLAINED_RERUN");
  assertOnlyCiRunEvidence(ci.externalEvidence);

  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  assert.equal(finalReport.ok, true);
  assert.equal(finalReport.report.finalized, true);
  assertOperatorBoundary(finalReport.report, "CI_UNEXPLAINED_RERUN");
  assert.deepEqual(finalReport.report.ci, { classification: "HUMAN_REVIEW_REQUIRED" });

  const md = renderMarkdown(finalReport.report);
  assert.match(md, new RegExp(`Readiness state: \`${finalReport.report.readiness.state}\``));
  assert.doesNotMatch(md, /PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN/);
});

test("SEC-C2-18: forged evidence plus a forged revalidation response never establishes initial authentication -- revalidation checks freshness only, and the forged justified record is refused at the report boundary", async () => {
  const forgedEntry = { sourceObjectId: "comment-1", sourceVersion: "v1", contentDigest: "d".repeat(64), collectedAt: "2026-09-30T00:00:00Z", immutability: "MUTABLE" };
  const forgedReport = {
    schemaVersion: 1, requiresRevalidation: true, notAuthorization: true,
    generatedFor: { head: subject.head, tree: subject.tree, base: subject.base },
    trustedContext: { rootTip: "c".repeat(40), rootPolicyDigest: null },
    records: [{
      checkId: "1A.POLICY.ROOT", ownerStage: "1A", status: "NOT_APPLICABLE", subject,
      observed: { rootTip: "c".repeat(40), rootPolicyDigest: null, applicabilityProof: "no root policy applies to this fixture" },
      expected: null, reasonCode: "NOT_APPLICABLE", detail: "", evidenceRefs: [],
    }],
    externalEvidence: [forgedEntry],
  };
  const revalidation = await revalidateEvidence({ subject, report: forgedReport, rootPolicy: rootOf(forgedReport), items: [{ entry: forgedEntry, sourceType: "comment" }], adapters: { comment: { fetch: async () => ({ ok: true, version: "v1", digest: "d".repeat(64) }) } } });
  assert.equal(revalidation.records[0].status, "PASS", "the forged source is 'fresh' -- freshness is all revalidation establishes");

  const forgedCi = {
    checkId: "1F.CI", ownerStage: "1F", status: "PASS", subject, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [],
    observed: { classification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN", authenticatedActor: { provider: "github", accountId: "attacker-1", accountType: "User" }, determinationMode: "SEPARATE_PERSON", contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1" },
  };
  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, forgedCi, ...revalidation.records], externalEvidence: [forgedEntry], ci: undefined }));
  assert.equal(finalReport.ok, false);
  assert.match(finalReport.reason, /cannot be produced by collectCiEvidence\(\) in this configuration/);
});

test("SEC-C2-22: an OWNER_ATTESTED CI record never lets a Phase 2 report reach READY", () => {
  // Corrective C4 (W4-C2R-DEV-M2): a genuinely valid OWNER_ATTESTED record is
  // always a completed-run rerun record too -- the sparse fixture this test
  // used to rely on is rejected outright now (proven separately elsewhere);
  // here the fixture carries the full CI-run evidence contract so the test
  // actually exercises the OWNER_ATTESTED authority cap, not just shape rejection.
  const ownerObserved = {
    classification: "HUMAN_REVIEW_REQUIRED", repository: REPO, workflowPath: WORKFLOW, runId: "3", event: "pull_request",
    attempt: 2, status: "completed", requiredJobs: REQUIRED, missing: [], failed: [], pending: [], skipped: [],
    attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }],
    rerunObserved: true, attestationMode: "OWNER_ATTESTED", candidateClassification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN",
  };
  const owner = {
    checkId: "1F.CI", ownerStage: "1F", status: "HUMAN_REVIEW_REQUIRED", subject, expected: null, reasonCode: "OWNER_SELF_DETERMINATION", detail: "", evidenceRefs: [],
    observed: ownerObserved,
  };
  const ownerEvidence = {
    sourceObjectId: ciRunSourceObjectId({ repository: ownerObserved.repository, runId: ownerObserved.runId }), sourceVersion: String(ownerObserved.attempt),
    contentDigest: computeCiRunDigest({
      repository: ownerObserved.repository, workflowPath: ownerObserved.workflowPath, runId: ownerObserved.runId, event: ownerObserved.event,
      headSha: subject.head, attempt: ownerObserved.attempt, status: ownerObserved.status, requiredJobs: ownerObserved.requiredJobs,
      missing: ownerObserved.missing, failed: ownerObserved.failed, pending: ownerObserved.pending, skipped: ownerObserved.skipped, attemptHistory: ownerObserved.attemptHistory,
    }),
    collectedAt: "t", immutability: "MUTABLE",
  };
  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, owner], externalEvidence: [ownerEvidence], ci: undefined }));
  assert.equal(finalReport.ok, true);
  assertOperatorBoundary(finalReport.report, "OWNER_SELF_DETERMINATION");
  assertNeverPromoted(finalReport.report);
  assert.equal(buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, { ...owner, status: "PASS" }], ci: undefined })).ok, false);
});

function assertNeverPromoted(report) {
  assert.notEqual(report.readiness.state, "READY");
  assert.notEqual(report.ci.classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
}

test("a rerun with NO determinationAdapter injected reaches Phase 2 HUMAN_REVIEW_REQUIRED, never READY, through the full real composition", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: rerunRunAdapter(), requiredJobs: REQUIRED, now: NOW });
  assert.equal(ci.records[0].status, "HUMAN_REVIEW_REQUIRED");

  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  assert.equal(finalReport.ok, true);
  assert.notEqual(finalReport.report.readiness.state, "READY");
  assertOperatorBoundary(finalReport.report, "CI_UNEXPLAINED_RERUN");
});

// ======================================================================
// Corrective C3 (W4-C2R-DEV-M2 section 13): end-to-end decision-time
// staleness reproduction, using only the real production functions
// (collectCiEvidence, buildReport, kernel/revalidation.js#revalidateEvidence,
// sourceTypeForExternalEvidenceEntry) offline.
// ======================================================================

const { sourceTypeForExternalEvidenceEntry } = require("./ci-evidence");

test("a CLEAN_FIRST_PASS operator report stays NOT_READY, decision-time revalidation against the SAME run PASSes (freshness only, never authentication), then a later attempt with a failed job makes the ORIGINAL report's evidence STALE -- the original report is not reusable, and this is never treated as an authorized human rerun (no PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN)", async () => {
  // Initial state: repository R, HEAD H, run RUN-1, attempt 1, required job succeeds.
  const ci1 = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: cleanRunAdapter(), requiredJobs: REQUIRED, now: NOW });
  assert.equal(ci1.records[0].status, "PASS");
  const report1 = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci1.records], externalEvidence: ci1.externalEvidence, ci: undefined }));
  assert.equal(report1.ok, true);
  assertOperatorBoundary(report1.report);
  const pinnedEntry = report1.report.externalEvidence[0];

  // First decision-time revalidation: the adapter returns the SAME run evidence -> PASS.
  const sameRunAdapter = { fetch: async () => ({ ok: true, version: pinnedEntry.sourceVersion, digest: pinnedEntry.contentDigest }) };
  const items1 = report1.report.externalEvidence.map((entry) => ({ entry, sourceType: sourceTypeForExternalEvidenceEntry(entry) }));
  assert.ok(items1.every((i) => i.sourceType !== null), "every pinned entry must map to a known sourceType, never silently dropped");
  const revalidation1 = await revalidateEvidence({ subject, report: report1.report, rootPolicy: rootOf(report1.report), items: items1, adapters: { CI_RUN: sameRunAdapter } });
  assert.equal(revalidation1.records[0].status, "PASS");

  // Same repository, same HEAD, same run ID, a NEW attempt (2) with a failed required job.
  // Corrective C4 (W4-C3R-INFO-1): the changed run's current version/digest are not
  // hardcoded -- they are DERIVED from the real production collector, run through the
  // exact same collectCiEvidence() -> computeCiRunDigest() path as the original pinned
  // evidence, so this genuinely composes producer and revalidator rather than merely
  // asserting an arbitrary adapter response.
  const changedRunAdapterFetch = {
    fetchRun: async () => ({
      ok: true,
      run: { repository: REPO, workflowPath: WORKFLOW, runId: "1", event: "pull_request", headSha: subject.head, attempt: 2, status: "completed", jobs: [{ name: "Unit tests", status: "completed", conclusion: "failure" }], attemptHistory: [{ attempt: 1, conclusion: "success", failedJobs: [] }] },
    }),
  };
  const changedCollection = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: changedRunAdapterFetch, requiredJobs: REQUIRED, now: NOW });
  assert.equal(changedCollection.records[0].status, "FAIL");
  const changedEntry = changedCollection.externalEvidence[0];
  assert.equal(changedEntry.sourceObjectId, pinnedEntry.sourceObjectId, "same repository/run -- same source identity, only the version/digest changed");
  assert.notEqual(changedEntry.contentDigest, pinnedEntry.contentDigest, "the digest must actually differ once a required job's conclusion changes");
  const changedRunAdapter = { fetch: async () => ({ ok: true, version: changedEntry.sourceVersion, digest: changedEntry.contentDigest }) };
  const revalidation2 = await revalidateEvidence({ subject, report: report1.report, rootPolicy: rootOf(report1.report), items: items1, adapters: { CI_RUN: changedRunAdapter } });
  assert.equal(revalidation2.records[0].status, "INCOMPLETE");
  assert.equal(revalidation2.records[0].reasonCode, "STALE_EVIDENCE");

  // Also test: same attempt number, but a changed required-job conclusion --
  // this alone must still change the digest and produce STALE_EVIDENCE.
  const sameAttemptChangedConclusionAdapter = {
    fetchRun: async () => ({
      ok: true,
      run: { repository: REPO, workflowPath: WORKFLOW, runId: "1", event: "pull_request", headSha: subject.head, attempt: 1, status: "completed", jobs: [{ name: "Unit tests", status: "completed", conclusion: "failure" }], attemptHistory: [] },
    }),
  };
  const sameAttemptChanged = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: sameAttemptChangedConclusionAdapter, requiredJobs: REQUIRED, now: NOW });
  const sameAttemptChangedEntry = sameAttemptChanged.externalEvidence[0];
  assert.equal(sameAttemptChangedEntry.sourceVersion, pinnedEntry.sourceVersion, "attempt number alone is unchanged");
  assert.notEqual(sameAttemptChangedEntry.contentDigest, pinnedEntry.contentDigest, "the digest must differ purely from the changed job conclusion");
  const sameAttemptAdapter = { fetch: async () => ({ ok: true, version: sameAttemptChangedEntry.sourceVersion, digest: sameAttemptChangedEntry.contentDigest }) };
  const revalidation3 = await revalidateEvidence({ subject, report: report1.report, rootPolicy: rootOf(report1.report), items: items1, adapters: { CI_RUN: sameAttemptAdapter } });
  assert.equal(revalidation3.records[0].status, "INCOMPLETE");
  assert.equal(revalidation3.records[0].reasonCode, "STALE_EVIDENCE");

  // The original READY report is not reusable: folding the revalidation record into
  // its own record pool turns readiness away from READY. Corrective C1 (1G M1/M2):
  // the pool is the report's stage inputs; the report's own 1F.CONTEXT.* records
  // are buildReport()'s to add, and 1F.CONTEXT.* / 1F.COMPLETENESS.* are refused as input.
  const foldedRecords = [...phase1Records, ...ci1.records, ...revalidation2.records];
  const notReusable = buildReport(reportInput({ trustedContext: trustedContext(2), records: foldedRecords, externalEvidence: ci1.externalEvidence, ci: undefined }));
  assert.equal(notReusable.ok, true);
  assert.notEqual(notReusable.report.readiness.state, "READY");

  // This is never treated as an authorized human rerun: nothing here can or does
  // produce PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN -- only a fresh collectCiEvidence()
  // call against the changed run could ever re-establish evidence, and (per Corrective
  // C2) even that would stay HUMAN_REVIEW_REQUIRED with no accepted determination.
  //
  // Honest disclosure: `changedRunAdapterFetch`/`sameAttemptChangedConclusionAdapter`
  // above are deterministic OFFLINE fixtures (the same injection seam every other test
  // in this suite uses), not a real GitHub provider -- this proves the producer/
  // revalidator COMPOSITION is correct, not operational GitHub-provider authenticity
  // (which remains UNVERIFIED/DEFERRED per the Corrective C1/C2 reports).
  assert.notEqual(notReusable.report.overallStatus, "PASS");
});

// ======================================================================
// Corrective C4 (W4-C3R-DEV-L2): the real collector's pre-completion output
// is representable as an incomplete Phase 2 report -- end to end, through
// the actual collectCiEvidence() -> buildReport() composition, not an
// isolated report.js fixture.
// ======================================================================

function notCompletedRunAdapter(status) {
  return { fetchRun: async () => ({ ok: true, run: { repository: REPO, workflowPath: WORKFLOW, runId: "9", event: "pull_request", headSha: subject.head, attempt: 1, status, jobs: [], attemptHistory: [] } }) };
}

for (const status of ["queued", "waiting", "in_progress"]) {
  test(`C4-L2: the real collector's ${status} output composes into an INCOMPLETE, NOT_READY Phase 2 report -- never rejected as malformed completed-run evidence, never fabricated as PASS`, async () => {
    const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: notCompletedRunAdapter(status), requiredJobs: REQUIRED, now: NOW });
    assert.equal(ci.records[0].status, "INCOMPLETE");
    assert.deepEqual(ci.records[0].observed, { classification: "INCOMPLETE", collected: true, status });
    assert.deepEqual(ci.externalEvidence, []); // no completed run to pin

    const report = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
    assert.equal(report.ok, true, status);
    assert.equal(report.report.overallStatus, "INCOMPLETE", status);
    assert.equal(report.report.readiness.state, "NOT_READY", status);
    assert.equal(report.report.finalized, true, status); // Phase 2 was genuinely attempted; it just could not complete
    assert.equal(report.report.ci.classification, "INCOMPLETE", status);
  });
}

// ======================================================================
// Corrective C6 (W4-C4R-INFO-3): every real collector-produced shape A and
// shape B record remains compatible with buildReport() -- exercised through
// the actual collectCiEvidence() -> buildReport() composition, not a
// report.js-only fixture, so the shape-A/B semantic guards added by this
// corrective cannot silently reject an authentic collector output.
// ======================================================================

function fetchFailureAdapter(reason) {
  return { fetchRun: async () => ({ ok: false, reason }) };
}

for (const reason of ["SOURCE_UNREACHABLE", "NOT_FOUND", "MALFORMED_RUN_SHAPE"]) {
  test(`C6-INFO3-19: the real collector's fetch-failure output (${reason}) composes into a valid, NOT_READY Phase 2 report`, async () => {
    const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: fetchFailureAdapter(reason), requiredJobs: REQUIRED, now: NOW });
    assert.equal(ci.records[0].status, "INCOMPLETE");
    assert.deepEqual(ci.externalEvidence, []);
    const report = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
    assert.equal(report.ok, true, reason);
    assert.notEqual(report.report.readiness.state, "READY", reason);
  });
}

test("C6-INFO3-19b: the real collector's wrong-identity fetch-failure output (FAIL) composes into a valid, NOT_READY Phase 2 report", async () => {
  const wrongRepoAdapter = { fetchRun: async () => ({ ok: true, run: { repository: "someone-else/other-repo", workflowPath: WORKFLOW, runId: "1", event: "pull_request", headSha: subject.head, attempt: 1, status: "completed", jobs: [], attemptHistory: [] } }) };
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: wrongRepoAdapter, requiredJobs: REQUIRED, now: NOW });
  assert.equal(ci.records[0].status, "FAIL");
  const report = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  assert.equal(report.ok, true);
  assert.notEqual(report.report.readiness.state, "READY");
});

for (const status of ["queued", "waiting", "in_progress"]) {
  test(`C6-INFO3-20: the real collector's ${status} output composes into a valid, NOT_READY Phase 2 report (reconfirms C4-L2 under the C6-INFO3 numbering, now against the added shape-B semantic guard)`, async () => {
    const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: notCompletedRunAdapter(status), requiredJobs: REQUIRED, now: NOW });
    assert.equal(ci.records[0].status, "INCOMPLETE");
    const report = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
    assert.equal(report.ok, true, status);
    assert.equal(report.report.readiness.state, "NOT_READY", status);
  });
}
