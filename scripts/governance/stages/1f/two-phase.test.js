"use strict";

// GOV-AUTO-1 Wave 4 / 1F WP11: an explicit end-to-end demonstration that the
// two-phase model (design section 17) actually composes correctly across
// buildReport() and collectCiEvidence() -- not just that each module is
// individually correct in isolation (already covered by their own suites).

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport } = require("./report");
const { collectCiEvidence } = require("./ci-evidence");
const { renderMarkdown } = require("./render-markdown");
const { makeSubject } = require("../../test-support-git");

const subject = makeSubject();
const REPO = "TarasovArtem/qa-ai-agent";
const WORKFLOW = ".github/workflows/cypress.yml";
const REQUIRED = ["Unit tests"];

const trustedContext = (phase) => ({
  mode: "PR_REVIEW", invocationTrust: "PLATFORM_AUTHENTICATED", provider: "github", repositoryId: REPO,
  eventType: "pull_request", targetRefName: "main", resolvedTargetTip: "b".repeat(40), suppliedTargetSha: null,
  headSha: subject.head, base: subject.base, baseDerivation: "merge-base", workflowIdentity: null, workflowBlobSha: null,
  baseWorkflowBlobSha: null, defaultBranch: "main", rootTip: "c".repeat(40), rootPolicyDigest: null, basePolicyDigest: null,
  executedFrom: "HEAD", frameworkVersion: "1.0.0", targetSupportedCapabilities: [], targetSupportedSchemaVersions: [1],
  requiredCapabilities: [], phase, collectorRunId: "collector-1", executedCommit: subject.head,
});
const manifest = () => ({ gatePath: "governance/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] });
const genericRecord = (checkId, ownerStage, status) => ({ checkId, ownerStage, status, subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });
const phase1Records = [genericRecord("1A.IDENTITY", "1A", "PASS"), genericRecord("1B.MARKDOWN", "1B", "PASS")];

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

test("Phase 2: collectCiEvidence() output, folded into a second buildReport() call, finalizes the report and (with a clean run) reaches READY", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: cleanRunAdapter(), requiredJobs: REQUIRED });
  assert.equal(ci.records[0].status, "PASS");

  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  assert.equal(finalReport.ok, true);
  assert.equal(finalReport.report.finalized, true);
  assert.equal(finalReport.report.overallStatus, "PASS");
  assert.equal(finalReport.report.readiness.state, "READY");
});

test("Phase 2 with a failing required CI job: the 1F.CI record alone prevents READY even though every 1A-1E record is PASS -- the CI record genuinely participates in aggregation, not decoration", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: failingRunAdapter(), requiredJobs: REQUIRED });
  assert.equal(ci.records[0].status, "FAIL");

  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], ci: undefined }));
  assert.equal(finalReport.ok, true);
  assert.equal(finalReport.report.finalized, true);
  assert.notEqual(finalReport.report.readiness.state, "READY");
  assert.equal(finalReport.report.overallStatus, "FAIL");
});

test("the Phase 1 and Phase 2 reports for the SAME subject share the identical generatedFor identity -- no cross-phase subject drift", async () => {
  const p1 = buildReport(reportInput());
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: cleanRunAdapter(), requiredJobs: REQUIRED });
  const p2 = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], ci: undefined }));
  assert.deepEqual(p1.report.generatedFor, p2.report.generatedFor);
});

test("rendering the finalized Phase 2 report to Markdown never disagrees with its own JSON readiness value", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: cleanRunAdapter(), requiredJobs: REQUIRED });
  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], ci: undefined }));
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

test("DEV-C1-11: Phase 2 with an accepted, adapter-mediated SEPARATE_PERSON rerun determination -- the report reaches READY, report.ci carries the full design section 23 determination shape, and Markdown never disagrees with the JSON", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: rerunRunAdapter(), requiredJobs: REQUIRED, determinationAdapter: acceptedDeterminationAdapter() });
  assert.equal(ci.records[0].status, "PASS");
  assert.equal(ci.records[0].observed.classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");

  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], externalEvidence: ci.externalEvidence, ci: undefined }));
  assert.equal(finalReport.ok, true);
  assert.equal(finalReport.report.readiness.state, "READY");
  assert.equal(finalReport.report.ci.classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
  assert.equal(finalReport.report.ci.determinationMode, "SEPARATE_PERSON");
  assert.equal(finalReport.report.ci.channelObjectId, "comment-1");

  const md = renderMarkdown(finalReport.report);
  assert.match(md, new RegExp(`Readiness state: \`${finalReport.report.readiness.state}\``));
  assert.match(md, /PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN/);
});

test("a rerun with NO determinationAdapter injected reaches Phase 2 HUMAN_REVIEW_REQUIRED, never READY, through the full real composition", async () => {
  const ci = await collectCiEvidence({ subject, repository: REPO, workflowPath: WORKFLOW, event: "pull_request", adapter: rerunRunAdapter(), requiredJobs: REQUIRED });
  assert.equal(ci.records[0].status, "HUMAN_REVIEW_REQUIRED");

  const finalReport = buildReport(reportInput({ trustedContext: trustedContext(2), records: [...phase1Records, ...ci.records], ci: undefined }));
  assert.equal(finalReport.ok, true);
  assert.notEqual(finalReport.report.readiness.state, "READY");
  assert.equal(finalReport.report.readiness.state, "HUMAN_REVIEW_REQUIRED");
});
