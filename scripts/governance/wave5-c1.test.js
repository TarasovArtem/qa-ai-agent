"use strict";

// GOV-AUTO-1 Wave 5 / Stage 1G -- consolidated Corrective C1 regressions.
//
// One hostile regression group per approved finding (M1, M2, M3, M4, L1, L2, L3,
// L4, S1), plus one real-Git end-to-end run of every executable stage
// (1A -> 1B -> 1C -> 1D -> 1E -> 1F) into buildReport() and revalidateEvidence().
// The end-to-end run is the positive control: it proves the mandatory result set
// buildReport() now requires is exactly what the real stages emit, so READY stays
// reachable for a genuinely complete, target-tip, platform-authenticated run.

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("./index");
const { createTempRepo, basePolicy, prContext, platformList, gitOptions, makeSubject, fakeReader } = require("./test-support-git");
const { sourceTypeForExternalEvidenceEntry } = require("./stages/1f/ci-evidence");
const { renderMarkdown } = require("./stages/1f/render-markdown");
const { FRAMEWORK_METADATA } = require("./framework-metadata");
const { validateBasePolicy, resolveFrameworkMetadata } = require("./stages/1a/policy");

const WORKFLOW = ".github/workflows/ci.yml";
const NOW = "2026-06-01";
const REPO_ID = "owner/repo";
const D15_CAPABILITIES = [
  "repository-preflight@1",
  "markdown-reference-integrity@1",
  "evidence-provenance-validation@1",
  "risk-source-method-consistency@1",
  "dependency-aware-delta@1",
  "ci-evidence-reporting@1",
];

const evidenceConfig = {
  schemaVersion: 1,
  evidenceClasses: ["DIRECT_DOC", "DERIVED_INFERENCE", "UNKNOWN"],
  conclusionStrengths: ["UNKNOWN", "DERIVED_INFERENCE", "DIRECTLY_SUPPORTED"],
  classToStrength: { DIRECT_DOC: "DIRECTLY_SUPPORTED", DERIVED_INFERENCE: "DERIVED_INFERENCE", UNKNOWN: "UNKNOWN" },
  promotionWords: ["documented", "confirmed"],
  tables: [{ filePatterns: ["docs/*.md"], idColumn: "ID", classColumn: "Class", strengthColumn: null, premisesColumn: "Premises", conclusionColumn: "Conclusion", independentColumn: null }],
};
const consistencyConfig = {
  schemaVersion: 1,
  countRules: [{ filePatterns: ["docs/*.md"], countedMatchColumn: "Class", groupByColumn: null, totalsLabelColumn: "Level", totalsValueColumn: "Count", dependsOnEvidence: true, evidenceIdColumn: "ID" }],
  taxonomyRules: [],
  methodRules: [],
};
const DOC_HEAD = "# A\n\n| ID | Class | Premises | Conclusion |\n|---|---|---|---|\n| A1 | DIRECT_DOC |  |  |\n| A2 | DERIVED_INFERENCE | A1 |  |\n\n| Level | Count |\n|---|---|\n| Total | 2 |\n";
const DOC_BASE = "# A\n\n| ID | Class | Premises | Conclusion |\n|---|---|---|---|\n| A1 | DIRECT_DOC |  |  |\n\n| Level | Count |\n|---|---|\n| Total | 1 |\n";
const dom = (id, deps, protectedInputs, reviewModes = ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"], extra = {}) => ({
  domainId: id, enabled: true, ownerStage: "1E", dependsOn: deps, derivedFrom: [], protectedInputs, reviewModes, ...extra,
});
const GRAPH = [dom("DOMAIN_A", [], ["file:docs/a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "REFERENCE" }], ["file:README.md"])];

// ------------------------------------------------------------------ real-Git end-to-end pipeline

/**
 * Every executable stage, in order, on a real repository; returns the inputs buildReport() needs.
 * `executedFrom` is where the platform-authenticated run metadata says the run executed
 * (Corrective C2, 1G R3): a phase-2 run executes from the resolved target tip ("TARGET_TIP",
 * the default); "HEAD" is a head-executed (advisory) run.
 */
async function endToEnd({ executedFrom = "TARGET_TIP" } = {}) {
  const repo = createTempRepo();
  const tip = repo.commit("base", { "README.md": "# Readme\n", [WORKFLOW]: "name: ci\n", "governance/base.json": JSON.stringify(basePolicy()), "docs/a.md": DOC_BASE });
  repo.checkout("feature", true);
  const head = repo.commit("head", { "docs/a.md": DOC_HEAD });
  const common = gitOptions(repo);
  const executed = executedFrom === "TARGET_TIP" ? tip : head;
  const trustedContext = prContext(head, { workflow: { path: WORKFLOW, sha: executed }, platformFiles: platformList(["docs/a.md"]) });
  const identity = await g.getGitIdentity({ trustedContext, ...common, targetFrameworkMetadata: FRAMEWORK_METADATA });
  assert.equal(identity.established, true);
  const subject = identity.subject;
  const policy = identity.policy.policy;
  const changed = await g.getChangedFiles({ subject, identity, platformFiles: trustedContext.platformFiles, ...common });
  const scope = g.checkScope({ subject, changedFiles: changed, policy });
  const secrets = await g.scanSecrets({ subject, changedFiles: changed, policy, now: NOW, ...common });
  const markdown = await g.checkReferences({ subject, changedFiles: changed, policy, ...common });
  const documents = [{ path: "docs/a.md", structure: g.parseMarkdown({ path: "docs/a.md", text: DOC_HEAD }) }];
  const evidence = g.checkEvidenceModel({ subject, documents, config: evidenceConfig });
  const consistency = g.checkConsistency({ subject, documents, config: consistencyConfig, evidenceResult: evidence });
  const stageRecords = [...markdown.records, ...evidence.records, ...consistency.records];
  const delta = await g.computeDeltaReview({ subject, headGraph: g.validateGraph(GRAPH), baseGraph: g.validateGraph(GRAPH), records: stageRecords, ...common });
  const run = { repository: REPO_ID, workflowPath: WORKFLOW, runId: "77", event: "pull_request", headSha: head, attempt: 1, status: "completed", jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }], attemptHistory: [] };
  const ci = await g.collectCiEvidence({ subject, repository: REPO_ID, workflowPath: WORKFLOW, event: "pull_request", requiredJobs: ["Unit tests"], now: NOW, adapter: { fetchRun: async () => ({ ok: true, run }) } });
  const records = [...identity.records, ...changed.records, ...scope.records, ...secrets.records, ...stageRecords, ...delta.records, ...ci.records];
  const reportContext = {
    mode: "PR_REVIEW", invocationTrust: "PLATFORM_AUTHENTICATED", provider: "github", repositoryId: REPO_ID, eventType: "pull_request",
    targetRefName: "main", resolvedTargetTip: identity.identity.targetTip, suppliedTargetSha: null, headSha: subject.head, base: subject.base,
    baseDerivation: "merge-base", workflowIdentity: WORKFLOW, workflowBlobSha: null, baseWorkflowBlobSha: null, defaultBranch: "main",
    rootTip: identity.identity.rootTip, rootPolicyDigest: identity.policy.digest, basePolicyDigest: identity.policy.digest,
    executedFrom, frameworkVersion: FRAMEWORK_METADATA.frameworkVersion, targetSupportedCapabilities: [...FRAMEWORK_METADATA.supportedCapabilities],
    targetSupportedSchemaVersions: { ...FRAMEWORK_METADATA.supportedSchemaVersions }, requiredCapabilities: [], phase: 2, collectorRunId: "collector-77",
    executedCommit: executed,
  };
  assert.equal(executedFrom !== "TARGET_TIP" || executed === identity.identity.targetTip, true, "the fixture's target-tip run executes from the tip 1A resolved");
  const input = {
    subject, tool: { name: "gov-auto-1", version: FRAMEWORK_METADATA.frameworkVersion }, trustedContext: reportContext, externalEvidence: [...ci.externalEvidence],
    manifest: { gatePath: "governance/manifests/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] },
    reviewClass: "HEAVY", changedFiles: [...changed.files], records, parents: [...identity.identity.parents], branch: "feature",
  };
  return { repo, subject, identity, changed, delta, input, records };
}

const withRecords = (input, records) => ({ ...input, records });
const withContext = (input, overrides) => ({ ...input, trustedContext: { ...input.trustedContext, ...overrides } });
const without = (records, checkId) => records.filter((r) => r.checkId !== checkId);
const reasonsOf = (report) => report.records.filter((r) => r.status !== "PASS" && r.status !== "NOT_APPLICABLE").map((r) => `${r.checkId}:${r.reasonCode}`);

let shared = null;
async function pipeline() {
  if (shared === null) shared = await endToEnd();
  return shared;
}
let sharedHead = null;
async function headPipeline() {
  if (sharedHead === null) sharedHead = await endToEnd({ executedFrom: "HEAD" });
  return sharedHead;
}
test.after(() => {
  if (shared !== null) shared.repo.cleanup();
  if (sharedHead !== null) sharedHead.repo.cleanup();
});

test("C1 positive control: a complete, platform-authenticated, target-tip Phase 2 run of every real stage is READY", async () => {
  const p = await pipeline();
  const r = g.buildReport(p.input);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(reasonsOf(r.report), []);
  assert.equal(r.report.readiness.state, "READY");
  assert.deepEqual([...r.report.readiness.reasons], []);
  assert.equal(r.report.finalized, true);
  assert.equal(r.report.notAuthorization, true);
  assert.ok(r.report.records.some((x) => x.checkId === "1F.CONTEXT.EXECUTION" && x.status === "PASS"));
  assert.ok(!r.report.records.some((x) => x.checkId.startsWith("KERNEL.REQUIRED_RESULT.")), "the real stages emit every required result");
  assert.deepEqual(r.report.domains.map((d) => d.domainId), ["DOMAIN_A", "DOMAIN_B"]);
});

// ------------------------------------------------------------------ M1: mandatory completeness

test("C1 M1: identity + CI only (no stage or domain results) is never READY; each missing result is an explicit INCOMPLETE record", async () => {
  const p = await pipeline();
  const minimal = p.records.filter((r) => r.checkId === "1A.IDENTITY.HEAD" || r.checkId === "1F.CI");
  const r = g.buildReport(withRecords(p.input, minimal));
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.report.readiness.state, "NOT_READY");
  const missing = r.report.records.filter((x) => x.reasonCode === "REQUIRED_RESULT_MISSING").map((x) => x.checkId.slice("KERNEL.REQUIRED_RESULT.".length));
  for (const id of ["1A.SECRETS.SCAN", "1B.MARKDOWN.FILES", "1C.EVIDENCE.CONFIG", "1D.CONSISTENCY.CONFIG", "1E.DELTA.DOMAIN_SET", "1A.IDENTITY.WORKFLOW_ANCHOR"]) assert.ok(missing.includes(id), id);
  assert.ok(r.report.readiness.reasons.includes("REQUIRED_RESULT_MISSING"));
});

test("C1 M1: a missing enabled-domain result fails closed even when the caller supplies no expectedDomainIds", async () => {
  const p = await pipeline();
  const r = g.buildReport(withRecords(p.input, without(p.records, "1E.DOMAIN.DOMAIN_B")));
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.ok(reasonsOf(r.report).includes("KERNEL.DOMAIN_RESULT.DOMAIN_B:DOMAIN_RESULT_MISSING"));
});

test("C1 M1: a caller cannot narrow the required domain set with expectedDomainIds", async () => {
  const p = await pipeline();
  const r = g.buildReport({ ...withRecords(p.input, without(p.records, "1E.DOMAIN.DOMAIN_B")), expectedDomainIds: ["DOMAIN_A"] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /expectedDomainIds differs from the 1E-reported domain set/);
  const same = g.buildReport({ ...p.input, expectedDomainIds: ["DOMAIN_B", "DOMAIN_A"] });
  assert.equal(same.ok, true, same.reason);
  assert.equal(same.report.readiness.state, "READY");
});

test("C1 M1: omitting the 1E domain-set record itself is a missing required result", async () => {
  const p = await pipeline();
  const r = g.buildReport(withRecords(p.input, without(p.records, "1E.DELTA.DOMAIN_SET")));
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.ok(reasonsOf(r.report).includes("KERNEL.REQUIRED_RESULT.1E.DELTA.DOMAIN_SET:REQUIRED_RESULT_MISSING"));
});

test("C1 M1: a missing mandatory stage result fails closed (one per stage)", async () => {
  const p = await pipeline();
  for (const id of ["1A.SECRETS.SCAN", "1A.DIFF.PLATFORM_AGREEMENT", "1B.MARKDOWN.LINKS", "1C.EVIDENCE.PREMISES", "1D.CONSISTENCY.COUNTS", "1A.IDENTITY.RANGE"]) {
    const r = g.buildReport(withRecords(p.input, without(p.records, id)));
    assert.equal(r.ok, true, `${id}: ${r.reason}`);
    assert.equal(r.report.readiness.state, "NOT_READY", id);
    assert.ok(reasonsOf(r.report).includes(`KERNEL.REQUIRED_RESULT.${id}:REQUIRED_RESULT_MISSING`), id);
  }
});

test("C1 M1: a duplicated mandatory result fails closed (never deduplicated)", async () => {
  const p = await pipeline();
  const dup = p.records.find((r) => r.checkId === "1A.SCOPE.ALLOWED");
  const r = g.buildReport(withRecords(p.input, [...p.records, dup]));
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.ok(reasonsOf(r.report).includes("KERNEL.CHECK_ID.1A.SCOPE.ALLOWED:DUPLICATE_CHECK_ID"));
});

test("C1 M1: NOT_APPLICABLE satisfies completeness only as a real record with an applicability proof", async () => {
  const p = await pipeline();
  const swap = (proof) => p.records.map((r) => (r.checkId === "1C.EVIDENCE.PROMOTION_WORDING" ? { ...r, status: "NOT_APPLICABLE", observed: proof === null ? {} : { applicabilityProof: proof } } : r));
  const proven = g.buildReport(withRecords(p.input, swap("no promotion wording applies")));
  assert.equal(proven.report.readiness.state, "READY");
  const unproven = g.buildReport(withRecords(p.input, swap(null)));
  assert.equal(unproven.report.readiness.state, "NOT_READY");
  assert.ok(reasonsOf(unproven.report).includes("KERNEL.APPLICABILITY.1C.EVIDENCE.PROMOTION_WORDING:APPLICABILITY_NOT_PROVEN"));
});

test("C1 M1: a caller cannot pre-empt the completeness or execution-context records", async () => {
  const p = await pipeline();
  const forged = { ...p.records[0], checkId: "1F.COMPLETENESS.1A.SECRETS.SCAN", ownerStage: "1F", status: "PASS", reasonCode: "OK", observed: {} };
  assert.equal(g.buildReport(withRecords(p.input, [...without(p.records, "1A.SECRETS.SCAN"), forged])).ok, false);
  const context = { ...forged, checkId: "1F.CONTEXT.EXECUTION" };
  assert.equal(g.buildReport(withRecords(p.input, [...p.records, context])).ok, false);
});

// ------------------------------------------------------------------ M2: execution-context authority

test("C1 M2: HEAD-executed output is advisory and never READY", async () => {
  const p = await headPipeline();
  const r = g.buildReport(p.input);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.ok(reasonsOf(r.report).includes("1F.CONTEXT.EXECUTION:EXECUTION_NOT_FROM_TARGET_TIP"));
});

test("C1 M2: an OPERATOR_SUPPLIED invocation is at best HUMAN_REVIEW_REQUIRED, never READY", async () => {
  const p = await pipeline();
  const r = g.buildReport(withContext(p.input, { invocationTrust: "OPERATOR_SUPPLIED", eventType: "manual" }));
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.report.readiness.state, "HUMAN_REVIEW_REQUIRED");
  assert.ok(r.report.humanReviewRequired.includes("1F.CONTEXT.EXECUTION"));
});

test("C1 M2: Phase 1 is never READY, even from the target tip", async () => {
  const p = await pipeline();
  const phase1 = { ...withRecords(withContext(p.input, { phase: 1 }), without(p.records, "1F.CI")), ci: { state: "NOT_COLLECTED" }, externalEvidence: [] };
  const r = g.buildReport(phase1);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.equal(r.report.finalized, false);
});

test("C1 M2: contradictory execution claims are rejected, never reported", async () => {
  const p = await pipeline();
  const other = "f".repeat(40);
  const cases = {
    "TARGET_TIP but executedCommit is not the resolved tip": { executedFrom: "TARGET_TIP", executedCommit: p.subject.head },
    "TARGET_TIP with an arbitrary executed commit": { executedCommit: other },
    "HEAD but executedCommit is not the head": { executedFrom: "HEAD", executedCommit: p.input.trustedContext.resolvedTargetTip },
    "mode differs from the subject range": { mode: "POST_MERGE", eventType: "push" },
    "base differs from the subject": { base: other },
    "headSha differs from the subject": { headSha: other },
  };
  for (const [name, overrides] of Object.entries(cases)) assert.equal(g.buildReport(withContext(p.input, overrides)).ok, false, name);
});

// ------------------------------------------------------------------ M3 + L1: report-bound revalidation

async function finalReport() {
  const p = await pipeline();
  const extra = { sourceObjectId: "attestation-1", sourceVersion: "v1", contentDigest: "e".repeat(64), collectedAt: NOW, immutability: "VERIFIED_PROVIDER" };
  const r = g.buildReport({ ...p.input, externalEvidence: [...p.input.externalEvidence, extra] });
  assert.equal(r.ok, true, r.reason);
  return { p, report: r.report, extra };
}
const sourceType = (entry) => sourceTypeForExternalEvidenceEntry(entry) || "ATTESTATION";
const fullItems = (report) => report.externalEvidence.map((entry) => ({ entry, sourceType: sourceType(entry) }));
const unchanged = (report) => Object.fromEntries(report.externalEvidence.map((e) => [sourceType(e), { fetch: async (id) => { const hit = report.externalEvidence.find((x) => x.sourceObjectId === id); return { ok: true, version: hit.sourceVersion, digest: hit.contentDigest }; } }]));
const sameRoot = (report) => ({ resolve: async () => ({ ok: true, rootTip: report.trustedContext.rootTip, digest: report.trustedContext.rootPolicyDigest }) });

test("C1 M3/L1 control: revalidating the complete report against unchanged sources and root policy is PASS", async () => {
  const { p, report } = await finalReport();
  const r = await g.revalidateEvidence({ subject: p.subject, report, items: fullItems(report), adapters: unchanged(report), rootPolicy: sameRoot(report) });
  assert.equal(r.outcome, null);
  assert.equal(r.records[0].status, "PASS");
});

test("C1 M3: a VERIFIED_* label never skips re-fetch -- relabelled stale evidence is STALE_EVIDENCE", async () => {
  const { p, report, extra } = await finalReport();
  let fetched = false;
  const adapters = { ...unchanged(report), ATTESTATION: { fetch: async () => { fetched = true; return { ok: true, version: "v2", digest: "f".repeat(64) }; } } };
  const r = await g.revalidateEvidence({ subject: p.subject, report, items: fullItems(report), adapters, rootPolicy: sameRoot(report) });
  assert.equal(fetched, true);
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.deepEqual(r.records[0].observed.staleItems, [{ sourceObjectId: extra.sourceObjectId, reason: "VERSION_OR_DIGEST_CHANGED" }]);
  for (const immutability of ["VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]) {
    const labelled = { ...report, externalEvidence: report.externalEvidence.map((e) => ({ ...e, immutability })) };
    const noAdapters = await g.revalidateEvidence({ subject: p.subject, report: labelled, items: fullItems(labelled), adapters: {}, rootPolicy: sameRoot(labelled) });
    assert.equal(noAdapters.records[0].status, "INCOMPLETE", immutability);
  }
});

test("C1 M3: a caller cannot revalidate only a safe subset of the report's evidence", async () => {
  const { p, report } = await finalReport();
  const items = fullItems(report);
  const call = (list) => g.revalidateEvidence({ subject: p.subject, report, items: list, adapters: unchanged(report), rootPolicy: sameRoot(report) });
  for (const [name, list] of Object.entries({ empty: [], subset: items.slice(0, 1), duplicate: [items[0], items[0]], foreign: [items[0], { entry: { ...items[1].entry, contentDigest: "0".repeat(64) }, sourceType: "ATTESTATION" }], extra: [...items, items[0]] })) {
    const r = await call(list);
    assert.equal(r.outcome && r.outcome.status, "CONFIGURATION_ERROR", name);
    assert.deepEqual([...r.records], [], name);
  }
});

test("C1 M3: revalidation is bound to the report's own subject and schema", async () => {
  const { p, report } = await finalReport();
  const base = { items: fullItems(report), adapters: unchanged(report), rootPolicy: sameRoot(report) };
  assert.equal((await g.revalidateEvidence({ ...base, subject: makeSubject(), report })).outcome.status, "CONFIGURATION_ERROR");
  assert.equal((await g.revalidateEvidence({ ...base, subject: p.subject })).outcome.status, "CONFIGURATION_ERROR");
  assert.equal((await g.revalidateEvidence({ ...base, subject: p.subject, report: { ...report, schemaVersion: 2 } })).outcome.status, "CONFIGURATION_ERROR");
  assert.equal((await g.revalidateEvidence({ ...base, subject: p.subject, report: { ...report, requiresRevalidation: false } })).outcome.status, "CONFIGURATION_ERROR");
});

test("C1 L1: the root policy is always re-resolved and compared with the report's own values", async () => {
  const { p, report } = await finalReport();
  const call = (rootPolicy, rep = report) => g.revalidateEvidence({ subject: p.subject, report: rep, items: fullItems(rep), adapters: unchanged(rep), rootPolicy });
  assert.equal((await call(undefined)).outcome.status, "CONFIGURATION_ERROR");
  assert.equal((await call(null)).outcome.status, "CONFIGURATION_ERROR");
  // Expected values come from the report, never from the caller.
  assert.equal((await call({ rootTip: report.trustedContext.rootTip, rootPolicyDigest: "x", resolve: sameRoot(report).resolve })).outcome.status, "CONFIGURATION_ERROR");
  const changedDigest = await call({ resolve: async () => ({ ok: true, rootTip: report.trustedContext.rootTip, digest: "0".repeat(64) }) });
  assert.equal(changedDigest.records[0].status, "INCOMPLETE");
  assert.equal(changedDigest.records[0].observed.staleItems[0].reason, "ROOT_POLICY_CHANGED");
  const movedTip = await call({ resolve: async () => ({ ok: true, rootTip: "9".repeat(40), digest: report.trustedContext.rootPolicyDigest }) });
  assert.equal(movedTip.records[0].status, "INCOMPLETE");
  const unreachable = await call({ resolve: async () => ({ ok: false }) });
  assert.equal(unreachable.records[0].status, "INCOMPLETE");
  const malformed = await call({ resolve: async () => ({ ok: true, rootTip: "tip", digest: 7 }) });
  assert.equal(malformed.records[0].status, "INCOMPLETE");
  // A report produced with no root policy is stale once a root policy exists.
  const bootstrap = { ...report, trustedContext: { ...report.trustedContext, rootPolicyDigest: null } };
  const appeared = await call({ resolve: async () => ({ ok: true, rootTip: report.trustedContext.rootTip, digest: "1".repeat(64) }) }, bootstrap);
  assert.equal(appeared.records[0].status, "INCOMPLETE");
  const stillAbsent = await call({ resolve: async () => ({ ok: true, rootTip: report.trustedContext.rootTip, digest: null }) }, bootstrap);
  assert.equal(stillAbsent.records[0].status, "PASS");
});

// ------------------------------------------------------------------ M4: base/head tighten-only composition

const FILES_BASE = { "a.md": "A old\n", "b.md": "B same\n", "c.md": "C same\n" };
const FILES_A_CHANGED = { "a.md": "A NEW\n", "b.md": "B same\n", "c.md": "C same\n" };
async function delta(baseDecls, headDecls, filesHead = FILES_A_CHANGED) {
  return g.computeDeltaReview({
    subject: makeSubject(), headGraph: g.validateGraph(headDecls), baseGraph: g.validateGraph(baseDecls), records: [], coveringChecks: {},
    reader: { atBase: fakeReader(FILES_BASE), atHead: fakeReader(filesHead) },
  });
}
const domainOf = (r, id) => r.records.find((x) => x.checkId === `1E.DOMAIN.${id}`);
const BASE_MEANING = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "MEANING" }], ["file:b.md"])];

test("C1 M4: removing a base MEANING edge is not applied -- the dependent stays HUMAN_REVIEW_REQUIRED with the proposal recorded", async () => {
  for (const filesHead of [FILES_A_CHANGED, FILES_BASE]) {
    const r = await delta(BASE_MEANING, [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])], filesHead);
    const b = domainOf(r, "DOMAIN_B");
    assert.equal(b.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
    assert.equal(b.status, "HUMAN_REVIEW_REQUIRED");
    assert.ok(b.domain.reasons.includes("GOVERNANCE_CONFIG"));
    assert.deepEqual([...b.observed.notAppliedProposals], ["EDGE_REMOVED:DOMAIN_A"]);
  }
  const changed = await delta(BASE_MEANING, [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])]);
  assert.ok(domainOf(changed, "DOMAIN_B").domain.reasons.includes("MEANING_DEPENDENCY_CHANGED"), "the retained base edge still propagates");
});

test("C1 M4: lowering a MEANING edge kind is not applied", async () => {
  const r = await delta(BASE_MEANING, [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "REFERENCE" }], ["file:b.md"])]);
  const b = domainOf(r, "DOMAIN_B");
  assert.equal(b.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
  assert.ok(b.domain.reasons.includes("MEANING_DEPENDENCY_CHANGED"));
  assert.deepEqual([...b.observed.notAppliedProposals], ["EDGE_KIND_LOWERED:DOMAIN_A"]);
});

test("C1 M4: a lateral DERIVED_VALUE <-> REFERENCE change is CONFIGURATION_ERROR (design section 9)", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"])];
  const r = await delta(base, [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "REFERENCE" }], ["file:b.md"])]);
  assert.deepEqual(r.records.map((x) => `${x.checkId}:${x.status}:${x.reasonCode}`), ["1E.DELTA.GRAPH:CONFIGURATION_ERROR:DELTA_GRAPH_INCONSISTENT"]);
});

test("C1 M4: disabling or removing a base domain stays HUMAN_REVIEW_REQUIRED and propagates through retained base edges", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_C", [], ["file:c.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_C", kind: "REFERENCE" }], ["file:b.md"])];
  const disabled = await delta(base, [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_C", [], ["file:c.md"], undefined, { enabled: false }), dom("DOMAIN_B", [], ["file:b.md"])], FILES_BASE);
  const removed = await delta(base, [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])], FILES_BASE);
  for (const r of [disabled, removed]) {
    assert.equal(domainOf(r, "DOMAIN_C").domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
    assert.ok(domainOf(r, "DOMAIN_C").domain.reasons.includes("DOMAIN_REMOVED"));
    assert.equal(domainOf(r, "DOMAIN_B").domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
    assert.ok(domainOf(r, "DOMAIN_B").domain.reasons.includes("UPSTREAM_HUMAN_REVIEW"));
  }
});

test("C1 M4: narrowing protected inputs is not applied -- the base selector is still fingerprinted", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md", "file:c.md"])];
  const r = await delta(base, [dom("DOMAIN_A", [], ["file:c.md"])]);
  const a = domainOf(r, "DOMAIN_A");
  assert.equal(a.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
  assert.ok(a.domain.reasons.includes("OWN_FINGERPRINT_CHANGED"), "a change in the removed base region is still detected");
  assert.deepEqual([...a.observed.notAppliedProposals], ["PROTECTED_INPUT_REMOVED:file:a.md"]);
});

test("C1 M4: widening review modes is not applied", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED"])];
  const r = await delta(base, [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"])], FILES_BASE);
  assert.equal(domainOf(r, "DOMAIN_A").domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual([...domainOf(r, "DOMAIN_A").observed.notAppliedProposals], ["REVIEW_MODE_ADDED:PRESERVATION_CHECK_ONLY"]);
});

test("C1 M4: head tightening is applied -- a stricter or added dependency escalates without a loosening proposal", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "REFERENCE" }], ["file:b.md"]), dom("DOMAIN_C", [], ["file:c.md"])];
  const r = await delta(base, [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "MEANING" }], ["file:b.md"]), dom("DOMAIN_C", [{ domain: "DOMAIN_A", kind: "MEANING" }], ["file:c.md"])]);
  for (const id of ["DOMAIN_B", "DOMAIN_C"]) {
    const d = domainOf(r, id);
    assert.equal(d.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED", id);
    assert.ok(d.domain.reasons.includes("MEANING_DEPENDENCY_CHANGED"), id);
    assert.ok(!d.domain.reasons.includes("GOVERNANCE_CONFIG"), id);
    assert.equal(d.observed.notAppliedProposals, undefined, id);
  }
});

test("C1 M4: an ownerStage change or a cycle created by merging base and head edges is CONFIGURATION_ERROR", async () => {
  const stage = await delta([dom("DOMAIN_A", [], ["file:a.md"])], [dom("DOMAIN_A", [], ["file:a.md"], undefined, { ownerStage: "1B" })]);
  assert.equal(stage.records[0].reasonCode, "DELTA_GRAPH_INCONSISTENT");
  const cycle = await delta(
    [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "REFERENCE" }], ["file:b.md"])],
    [dom("DOMAIN_A", [{ domain: "DOMAIN_B", kind: "REFERENCE" }], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])],
  );
  assert.deepEqual(cycle.records.map((x) => `${x.status}:${x.reasonCode}`), ["CONFIGURATION_ERROR:DELTA_GRAPH_INCONSISTENT"]);
});

test("C1 M4: identical base and head declarations are deterministic, apply no proposal and report the domain set", async () => {
  const one = await delta(BASE_MEANING, BASE_MEANING);
  const two = await delta(BASE_MEANING, BASE_MEANING);
  assert.deepEqual(one, two);
  assert.ok(one.records.every((x) => !x.observed || x.observed.notAppliedProposals === undefined));
  assert.deepEqual([...one.records.find((x) => x.checkId === "1E.DELTA.DOMAIN_SET").observed.domainIds], ["DOMAIN_A", "DOMAIN_B"]);
});

test("C1 M4: a head cannot remove a base-required capability -- required capabilities come only from the root/base policy", async () => {
  const repo = createTempRepo();
  try {
    const policy = basePolicy({ requiredCapabilities: ["ci-evidence-reporting@2"] });
    repo.commit("base", { "README.md": "# R\n", "governance/base.json": JSON.stringify(policy), "docs/a.md": "# A\n" });
    repo.checkout("feature", true);
    const head = repo.commit("head drops the requirement", { "governance/base.json": JSON.stringify(basePolicy()), "docs/a.md": "# A2\n" });
    const identity = await g.getGitIdentity({ trustedContext: prContext(head), ...gitOptions(repo), targetFrameworkMetadata: FRAMEWORK_METADATA });
    const capabilities = identity.records.find((x) => x.checkId === "1A.POLICY.CAPABILITIES");
    assert.equal(capabilities.status, "INCOMPLETE");
    assert.equal(capabilities.reasonCode, "CAPABILITY_UNAVAILABLE_ON_TARGET");
    assert.deepEqual([...identity.policy.policy.requiredCapabilities], ["ci-evidence-reporting@2"]);
  } finally {
    repo.cleanup();
  }
});

// ------------------------------------------------------------------ L2: changed-file trust binding

test("C1 L2: changed-file trust is bound to the 1A identity, never a separate caller flag", async () => {
  const p = await pipeline();
  const common = gitOptions(p.repo);
  const flag = await g.getChangedFiles({ subject: p.subject, invocationTrust: "OPERATOR_SUPPLIED", ...common });
  assert.deepEqual(flag.records.map((r) => `${r.checkId}:${r.status}:${r.reasonCode}`), ["1A.DIFF.CHANGED_FILES:CONFIGURATION_ERROR:TRUSTED_CONTEXT_INVALID"]);
  assert.equal(flag.complete, false);
  const bothFlagAndIdentity = await g.getChangedFiles({ subject: p.subject, identity: p.identity, invocationTrust: "PLATFORM_AUTHENTICATED", ...common });
  assert.equal(bothFlagAndIdentity.records[0].status, "CONFIGURATION_ERROR");
  // A platform-authenticated identity without the platform list can never skip the comparison.
  const noList = await g.getChangedFiles({ subject: p.subject, identity: p.identity, ...common });
  assert.equal(noList.records.find((r) => r.checkId === "1A.DIFF.PLATFORM_AGREEMENT").status, "INCOMPLETE");
  const noIdentity = await g.getChangedFiles({ subject: p.subject, ...common });
  assert.equal(noIdentity.records.find((r) => r.checkId === "1A.DIFF.PLATFORM_AGREEMENT").status, "INCOMPLETE");
  // An identity for another subject, or a forged downgrade of a real identity, is rejected.
  const foreign = await g.getChangedFiles({ subject: makeSubject(), identity: p.identity, git: { ...common } });
  assert.equal(foreign.records[0].status, "CONFIGURATION_ERROR");
  const downgraded = { ...p.identity, identity: { ...p.identity.identity, invocationTrust: "ROOT" } };
  assert.equal((await g.getChangedFiles({ subject: p.subject, identity: downgraded, ...common })).records[0].status, "CONFIGURATION_ERROR");
});

test("C1 L2: an operator-trust changed-file comparison cannot be reported under a platform-authenticated context", async () => {
  const p = await pipeline();
  const operatorIdentity = { ...p.identity, identity: { ...p.identity.identity, invocationTrust: "OPERATOR_SUPPLIED" } };
  const changed = await g.getChangedFiles({ subject: p.subject, identity: operatorIdentity, ...gitOptions(p.repo) });
  const agreement = changed.records.find((r) => r.checkId === "1A.DIFF.PLATFORM_AGREEMENT");
  assert.equal(agreement.status, "NOT_APPLICABLE");
  assert.equal(agreement.observed.invocationTrust, "OPERATOR_SUPPLIED");
  const records = p.records.map((r) => (r.checkId === "1A.DIFF.PLATFORM_AGREEMENT" ? agreement : r));
  const r = g.buildReport(withRecords(p.input, records));
  assert.equal(r.ok, false);
  assert.match(r.reason, /different invocation trust/);
});

// ------------------------------------------------------------------ L3: report / trustedContext validation

test("C1 L3: contradictory or malformed trusted-context and report fields are rejected", async () => {
  const p = await pipeline();
  const contexts = {
    "unknown mode": { mode: "TOTALLY_MADE_UP" },
    "event does not match mode": { eventType: "push" },
    "event does not match operator trust": { invocationTrust: "OPERATOR_SUPPLIED" },
    "malformed capability": { targetSupportedCapabilities: ["not a capability"] },
    "unknown capability major": { targetSupportedCapabilities: ["x@unknown"] },
    "duplicate capability": { targetSupportedCapabilities: ["repository-preflight@1", "repository-preflight@1"] },
    "malformed required capability": { requiredCapabilities: ["repository-preflight"] },
    "duplicate required capability": { requiredCapabilities: ["repository-preflight@1", "repository-preflight@1"] },
    "range as an array": { targetSupportedSchemaVersions: [1] },
    "empty range array": { targetSupportedSchemaVersions: [] },
    "reversed range": { targetSupportedSchemaVersions: { minSupported: 2, maxSupported: 1 } },
    "range with an extra field": { targetSupportedSchemaVersions: { minSupported: 1, maxSupported: 1, extra: 1 } },
    "malformed frameworkVersion": { frameworkVersion: "v0.5" },
  };
  for (const [name, overrides] of Object.entries(contexts)) assert.equal(g.buildReport(withContext(p.input, overrides)).ok, false, name);
  const fields = {
    "malformed parents": { parents: ["not-a-sha", { evil: 1 }] },
    "branch with whitespace": { branch: "feature x" },
    "unknown review class": { reviewClass: "NONE" },
    "empty review class": { reviewClass: "" },
  };
  for (const [name, overrides] of Object.entries(fields)) assert.equal(g.buildReport({ ...p.input, ...overrides }).ok, false, name);
});

test("C1 L3: push-event CI evidence cannot finalize a PR_REVIEW report", async () => {
  const p = await pipeline();
  const ci = p.records.find((r) => r.checkId === "1F.CI");
  const records = p.records.map((r) => (r === ci ? { ...ci, observed: { ...ci.observed, event: "push" } } : r));
  const r = g.buildReport(withRecords(p.input, records));
  assert.equal(r.ok, false);
});

test("C1 L3: readiness carries the canonical reasons[] (empty only when READY)", async () => {
  const p = await pipeline();
  const ready = g.buildReport(p.input).report.readiness;
  assert.deepEqual(Object.keys(ready).sort(), ["counts", "dominantStatus", "reasons", "state"]);
  assert.deepEqual([...ready.reasons], []);
  const notReady = g.buildReport((await headPipeline()).input).report.readiness;
  assert.deepEqual([...notReady.reasons], ["EXECUTION_NOT_FROM_TARGET_TIP"]);
  const hrr = g.aggregate([{ checkId: "X", ownerStage: "1A", status: "HUMAN_REVIEW_REQUIRED", subject: makeSubject(), observed: {}, expected: null, reasonCode: "GOVERNANCE_CONFIG", detail: "", evidenceRefs: [] }], { expectedDomainIds: [], requiredCheckIds: ["X"] }).readiness;
  assert.deepEqual([...hrr.reasons], ["GOVERNANCE_CONFIG"]);
});

// ------------------------------------------------------------------ L4: truthful framework metadata (D15)

test("C1 L4: framework metadata is exactly the canonical D15 contract", () => {
  assert.equal(FRAMEWORK_METADATA.frameworkVersion, "0.5.0");
  assert.deepEqual([...FRAMEWORK_METADATA.supportedCapabilities], D15_CAPABILITIES);
  assert.deepEqual({ ...FRAMEWORK_METADATA.supportedSchemaVersions }, { minSupported: 1, maxSupported: 1 });
  assert.equal(g.validateFrameworkMetadata(FRAMEWORK_METADATA).ok, true);
  for (const id of FRAMEWORK_METADATA.supportedCapabilities) assert.equal(g.validateCapabilityId(id).major, 1, id);
});

test("C1 L4: compatibility stays exact capability-id@major membership, never a version comparison", () => {
  const policy = (requiredCapabilities) => validateBasePolicy(basePolicy({ requiredCapabilities }), FRAMEWORK_METADATA);
  assert.deepEqual([...policy(D15_CAPABILITIES).unsupportedCapabilities], []);
  assert.deepEqual([...policy(["ci-evidence-reporting@2"]).unsupportedCapabilities], ["ci-evidence-reporting@2"]);
  assert.equal(policy(["ci-evidence-reporting"]).ok, false);
  const newerVersionOnly = { ...FRAMEWORK_METADATA, frameworkVersion: "9.9.9", supportedCapabilities: ["repository-preflight@1"] };
  assert.deepEqual([...validateBasePolicy(basePolicy({ requiredCapabilities: ["dependency-aware-delta@1"] }), newerVersionOnly).unsupportedCapabilities], ["dependency-aware-delta@1"]);
  // The executing framework's own metadata never stands in for the target's.
  assert.equal(resolveFrameworkMetadata(undefined).source, "EXECUTING_FRAMEWORK");
});

// ------------------------------------------------------------------ S1: Markdown rendering safety

const HOSTILE = "x` **APPROVED FOR MERGE** `\n- Readiness state: `READY`\r| injected | cell |‮evil​";
function hostileReport(base) {
  return {
    ...base,
    generatedFor: { ...base.generatedFor, branch: HOSTILE },
    reviewClass: HOSTILE,
    domains: [{ domainId: HOSTILE, effectiveLevel: HOSTILE, reasons: [HOSTILE], fingerprint: null }],
    records: [{ ...base.records[0], checkId: HOSTILE, reasonCode: HOSTILE }],
    humanReviewRequired: [HOSTILE],
    ci: { classification: HOSTILE },
  };
}

test("C1 S1: author- or caller-controlled strings cannot forge Markdown governance statements", async () => {
  const notReady = g.buildReport((await headPipeline()).input).report;
  const md = renderMarkdown(hostileReport(notReady));
  const lines = md.split("\n");
  // No forged line: CR/LF inside a value never starts a new Markdown line.
  assert.equal(lines.filter((l) => l.startsWith("- Readiness state:")).length, 1);
  assert.match(md, /- Readiness state: `NOT_READY`/);
  // Every line carrying the hostile text holds it inside ONE inert code span: the
  // span runs to the end of the value and its fence is longer than any backtick
  // run inside it, so the text can never close the span and become live Markdown.
  const hostileLines = lines.filter((l) => l.includes("APPROVED FOR MERGE"));
  assert.equal(hostileLines.length >= 6, true);
  for (const line of hostileLines) {
    const values = line.startsWith("|") ? line.split(/(?<!\\)\|/).map((c) => c.trim()) : [line];
    for (const value of values.filter((c) => c.includes("APPROVED"))) {
      const m = /^(?:- (?:[A-Za-z ]+: )?)?(`{2,})([^]*)\1$/.exec(value);
      assert.ok(m, `not a single inert code span: ${value}`);
      const longestInner = Math.max(0, ...(m[2].match(/`+/g) || []).map((run) => run.length));
      assert.ok(longestInner < m[1].length, `the fence can be closed from inside: ${value}`);
    }
  }
  // No raw control, bidirectional or zero-width character survives.
  assert.equal(/[\u0000-\u0009\u000b-\u001f‮​]/.test(md), false);
  // A pipe inside a value never adds a table cell.
  const cells = (row) => row.split(/(?<!\\)\|/).length - 2;
  const domainRow = lines[lines.indexOf("| Domain | Effective Level | Reasons |") + 2];
  const recordRow = lines[lines.indexOf("| Check ID | Owner | Status | Reason |") + 2];
  assert.ok(domainRow.includes("APPROVED") && recordRow.includes("APPROVED"));
  assert.equal(cells(domainRow), 3);
  assert.equal(cells(recordRow), 4);
});

test("C1 S1: a valid but hostile Git branch name (backticks are legal in refs) renders inert", async () => {
  const p = await pipeline();
  const r = g.buildReport({ ...p.input, branch: "feature`x`READY" });
  assert.equal(r.ok, true, r.reason);
  const branch = renderMarkdown(r.report).split("\n").find((l) => l.startsWith("- Branch: "));
  assert.equal(branch, "- Branch: ``feature`x`READY``");
});
