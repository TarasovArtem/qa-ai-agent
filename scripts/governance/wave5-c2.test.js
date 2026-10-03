"use strict";

// GOV-AUTO-1 Wave 5 / Stage 1G -- Corrective C2 hostile regressions for the three
// residual findings confirmed against C1:
//   R1  kernel aggregate() could be READY without any completeness context;
//   R2  a policy-defined 1B.REFERENCES.<family> result could disappear (dropped, or
//       1B run against a narrowed policy) while buildReport() stayed READY;
//   R3  caller-supplied framework metadata was labelled TARGET_TIP, and trustedContext
//       target-tip / execution / metadata claims were not bound to what 1A established.
// Every group runs the real 1A -> 1F stages on a real Git repository and keeps one
// positive control, so a fix can never pass by making READY unreachable.

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("./index");
const { createTempRepo, basePolicy, prContext, platformList, gitOptions, makeSubject } = require("./test-support-git");
const { record, domainRecord } = require("./test-support");
const { FRAMEWORK_METADATA } = require("./framework-metadata");
const { REQUIRED_CHECK_IDS } = require("./stages/1f/report");
const { resolveFrameworkMetadata } = require("./stages/1a/policy");

const WORKFLOW = ".github/workflows/ci.yml";
const NOW = "2026-06-01";
const REPO_ID = "owner/repo";
const TB = { family: "TB", prefix: "TB-", segments: [{ minDigits: 2, maxDigits: 3 }], separator: "-", definitionSources: ["docs/**"], definitionContexts: ["HEADING", "TABLE_FIRST_CELL"], ignoreContexts: ["FENCED_CODE", "INLINE_CODE"] };
const FAMILY_POLICY = basePolicy({ markdown: { filePatterns: ["**/*.md"], idFamilies: [TB] } });

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
const TABLES_HEAD = "| ID | Class | Premises | Conclusion |\n|---|---|---|---|\n| A1 | DIRECT_DOC |  |  |\n| A2 | DERIVED_INFERENCE | A1 |  |\n\n| Level | Count |\n|---|---|\n| Total | 2 |\n";
const DOC_BASE = "# A\n\n| ID | Class | Premises | Conclusion |\n|---|---|---|---|\n| A1 | DIRECT_DOC |  |  |\n\n| Level | Count |\n|---|---|\n| Total | 1 |\n";
const DOC_CLEAN = `# A\n\n${TABLES_HEAD}`;
const DOC_FAMILY_OK = `# A\n\n## TB-01 Item\n\nSee TB-01.\n\n${TABLES_HEAD}`;
const DOC_FAMILY_DANGLING = `# A\n\nSee TB-99.\n\n${TABLES_HEAD}`;
const dom = (id, deps, protectedInputs) => ({ domainId: id, enabled: true, ownerStage: "1E", dependsOn: deps, derivedFrom: [], protectedInputs, reviewModes: ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"] });
const GRAPH = [dom("DOMAIN_A", [], ["file:docs/a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "REFERENCE" }], ["file:README.md"])];

/**
 * Every executable stage on a real repository.
 *   policy          governance/base.json at the base (and target tip)
 *   docHead         docs/a.md at the head
 *   executedFrom    where the platform run metadata says the run executed ("TARGET_TIP" | "HEAD")
 *   markdownPolicy  (hostile) the policy handed to 1B instead of 1A's effective policy
 */
async function run({ policy = basePolicy(), docHead = DOC_CLEAN, executedFrom = "TARGET_TIP", markdownPolicy } = {}) {
  const repo = createTempRepo();
  try {
    const tip = repo.commit("base", { "README.md": "# Readme\n", [WORKFLOW]: "name: ci\n", "governance/base.json": JSON.stringify(policy), "docs/a.md": DOC_BASE });
    repo.checkout("feature", true);
    const head = repo.commit("head", { "docs/a.md": docHead });
    const executed = executedFrom === "TARGET_TIP" ? tip : head;
    const common = gitOptions(repo);
    const trustedContext = prContext(head, { workflow: { path: WORKFLOW, sha: executed }, platformFiles: platformList(["docs/a.md"]) });
    const identity = await g.getGitIdentity({ trustedContext, ...common });
    assert.equal(identity.established, true);
    const subject = identity.subject;
    const effective = identity.policy.policy;
    const changed = await g.getChangedFiles({ subject, identity, platformFiles: trustedContext.platformFiles, ...common });
    const scope = g.checkScope({ subject, changedFiles: changed, policy: effective });
    const secrets = await g.scanSecrets({ subject, changedFiles: changed, policy: effective, now: NOW, ...common });
    const markdown = await g.checkReferences({ subject, changedFiles: changed, policy: markdownPolicy === undefined ? effective : markdownPolicy, ...common });
    const documents = [{ path: "docs/a.md", structure: g.parseMarkdown({ path: "docs/a.md", text: docHead }) }];
    const evidence = g.checkEvidenceModel({ subject, documents, config: evidenceConfig });
    const consistency = g.checkConsistency({ subject, documents, config: consistencyConfig, evidenceResult: evidence });
    const stageRecords = [...markdown.records, ...evidence.records, ...consistency.records];
    const delta = await g.computeDeltaReview({ subject, headGraph: g.validateGraph(GRAPH), baseGraph: g.validateGraph(GRAPH), records: stageRecords, ...common });
    const ciRun = { repository: REPO_ID, workflowPath: WORKFLOW, runId: "77", event: "pull_request", headSha: head, attempt: 1, status: "completed", jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }], attemptHistory: [] };
    const ci = await g.collectCiEvidence({ subject, repository: REPO_ID, workflowPath: WORKFLOW, event: "pull_request", requiredJobs: ["Unit tests"], now: NOW, adapter: { fetchRun: async () => ({ ok: true, run: ciRun }) } });
    const records = [...identity.records, ...changed.records, ...scope.records, ...secrets.records, ...stageRecords, ...delta.records, ...ci.records];
    const reportContext = {
      mode: "PR_REVIEW", invocationTrust: "PLATFORM_AUTHENTICATED", provider: "github", repositoryId: REPO_ID, eventType: "pull_request",
      targetRefName: "main", resolvedTargetTip: identity.identity.targetTip, suppliedTargetSha: null, headSha: subject.head, base: subject.base,
      baseDerivation: "merge-base", workflowIdentity: WORKFLOW, workflowBlobSha: null, baseWorkflowBlobSha: null, defaultBranch: "main",
      rootTip: identity.identity.rootTip, rootPolicyDigest: identity.policy.digest, basePolicyDigest: identity.policy.digest,
      executedFrom, frameworkVersion: FRAMEWORK_METADATA.frameworkVersion, targetSupportedCapabilities: [...FRAMEWORK_METADATA.supportedCapabilities],
      targetSupportedSchemaVersions: { ...FRAMEWORK_METADATA.supportedSchemaVersions }, requiredCapabilities: [...effective.requiredCapabilities], phase: 2,
      collectorRunId: "collector-77", executedCommit: executed,
    };
    const input = {
      subject, tool: { name: "gov-auto-1", version: FRAMEWORK_METADATA.frameworkVersion }, trustedContext: reportContext, externalEvidence: [...ci.externalEvidence],
      manifest: { gatePath: "governance/manifests/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null, baseAnchor: "ABSENT", protectedProposals: [] },
      reviewClass: "HEAVY", changedFiles: [...changed.files], records, parents: [...identity.identity.parents], branch: "feature",
    };
    return { tip, head, subject, identity, records, input, repo, common, trustedContext };
  } finally {
    repo.cleanup();
  }
}

const withRecords = (input, records) => ({ ...input, records });
const withContext = (input, overrides) => ({ ...input, trustedContext: { ...input.trustedContext, ...overrides } });
const without = (records, ...ids) => records.filter((r) => !ids.includes(r.checkId));
const rec = (records, id) => records.find((r) => r.checkId === id);
const reasonsOf = (report) => report.records.filter((r) => r.status !== "PASS" && r.status !== "NOT_APPLICABLE").map((r) => `${r.checkId}:${r.reasonCode}`);
/** The mandatory plan buildReport() hands the kernel for a PR_REVIEW run with these reference families. */
const reportPlan = (families = []) => [...REQUIRED_CHECK_IDS.COMMON, ...REQUIRED_CHECK_IDS.PR_REVIEW, ...families.map((f) => `1B.REFERENCES.${f}`)];
const anyPass = (checkId = "X.ANY") => ({ checkId, ownerStage: "1A", status: "PASS", subject: makeSubject(), observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });

const cache = new Map();
/** Each distinct scenario runs the real pipeline once. */
function scenario(name, options) {
  if (!cache.has(name)) cache.set(name, run(options));
  return cache.get(name);
}

// =================================================================== R1: kernel completeness

test("C2 R1: aggregate([arbitrary PASS]) without completeness context is never READY", () => {
  const out = g.aggregate([anyPass()]);
  assert.equal(out.readiness.state, "NOT_READY");
  assert.equal(out.overallStatus, "INCOMPLETE");
  assert.deepEqual(out.kernelRecords.map((k) => `${k.checkId}:${k.status}:${k.reasonCode}`).sort(), [
    "KERNEL.EXPECTED_DOMAINS:INCOMPLETE:COMPLETENESS_CONTEXT_MISSING",
    "KERNEL.REQUIRED_CHECKS:INCOMPLETE:COMPLETENESS_CONTEXT_MISSING",
  ]);
  assert.deepEqual([...out.readiness.reasons], ["COMPLETENESS_CONTEXT_MISSING"]);
  // Each half of the context alone is still incomplete: neither is ever assumed to be empty.
  assert.equal(g.aggregate([anyPass()], { expectedDomainIds: [] }).readiness.state, "NOT_READY");
  assert.equal(g.aggregate([anyPass()], { requiredCheckIds: ["X.ANY"] }).readiness.state, "NOT_READY");
  assert.equal(g.aggregate([anyPass()], { expectedDomainIds: undefined, requiredCheckIds: undefined }).readiness.state, "NOT_READY");
  for (const options of [undefined, null, "plan", 7]) assert.equal(g.aggregate([anyPass()], options).readiness.state, "NOT_READY", String(options));
});

test("C2 R1: an explicit plan is honoured exactly -- a missing planned result is INCOMPLETE, a malformed plan is CONFIGURATION_ERROR", () => {
  const missing = g.aggregate([anyPass()], { expectedDomainIds: [], requiredCheckIds: ["X.ANY", "1A.SECRETS.SCAN"] });
  assert.equal(missing.readiness.state, "NOT_READY");
  assert.deepEqual(missing.kernelRecords.map((k) => `${k.checkId}:${k.reasonCode}`), ["KERNEL.REQUIRED_RESULT.1A.SECRETS.SCAN:REQUIRED_RESULT_MISSING"]);
  for (const bad of ["X.ANY", ["X.ANY", "X.ANY"], ["bad id"], [7], ["x".repeat(106)], Array.from({ length: 1025 }, (_, i) => `X.${i}`)]) {
    const out = g.aggregate([anyPass()], { expectedDomainIds: [], requiredCheckIds: bad });
    assert.equal(out.overallStatus, "CONFIGURATION_ERROR", JSON.stringify(bad).slice(0, 40));
  }
  // An invalid supplied record never satisfies a planned ID.
  const invalid = g.aggregate([{ ...anyPass("1A.SECRETS.SCAN"), status: "GREEN" }], { expectedDomainIds: [], requiredCheckIds: ["1A.SECRETS.SCAN"] });
  assert.ok(invalid.kernelRecords.some((k) => k.checkId === "KERNEL.REQUIRED_RESULT.1A.SECRETS.SCAN"));
  // The plan is the caller's explicit statement: stating it is what makes READY possible.
  assert.equal(g.aggregate([anyPass()], { expectedDomainIds: [], requiredCheckIds: ["X.ANY"] }).readiness.state, "READY");
});

test("C2 R1: a duplicate domain result fails closed through aggregate()", () => {
  const records = [record(), domainRecord("A_DOMAIN"), domainRecord("A_DOMAIN", "DEEP_REVIEW_REQUIRED")];
  const out = g.aggregate(records, { expectedDomainIds: ["A_DOMAIN"], requiredCheckIds: [record().checkId] });
  assert.equal(out.overallStatus, "CONFIGURATION_ERROR");
  assert.ok(out.kernelRecords.some((k) => k.reasonCode === "DOMAIN_RESULT_DUPLICATE" || k.reasonCode === "DUPLICATE_CHECK_ID"));
});

test("C2 R1: real stage records with domain results or 1E.DELTA.DOMAIN_SET removed are never READY, with or without a plan", async () => {
  const p = await scenario("clean", {});
  const plan = { expectedDomainIds: ["DOMAIN_A", "DOMAIN_B"], requiredCheckIds: reportPlan() };
  assert.equal(g.aggregate(p.records, plan).readiness.state, "READY", "positive control: the complete canonical input with its canonical plan");
  const removals = {
    "one domain result": without(p.records, "1E.DOMAIN.DOMAIN_B"),
    "every domain result": p.records.filter((r) => !Object.hasOwn(r, "domain")),
    "the domain-set record": without(p.records, "1E.DELTA.DOMAIN_SET"),
    "domain results and the domain set": p.records.filter((r) => !Object.hasOwn(r, "domain") && r.checkId !== "1E.DELTA.DOMAIN_SET"),
  };
  for (const [name, records] of Object.entries(removals)) {
    assert.equal(g.aggregate(records, plan).readiness.state, "NOT_READY", `${name} (with plan)`);
    assert.equal(g.aggregate(records).readiness.state, "NOT_READY", `${name} (no plan)`);
  }
  // The C1 residual probe R1-c: re-aggregating raw stage records minus a mandatory one, without the plan.
  assert.equal(g.aggregate(without(p.records, "1C.EVIDENCE.STRUCTURE")).readiness.state, "NOT_READY");
});

test("C2 R1: buildReport() and kernel aggregation agree -- the report's own records re-aggregate to the same readiness", async () => {
  const p = await scenario("clean", {});
  const full = g.buildReport(p.input);
  assert.equal(full.ok, true, full.reason);
  assert.equal(full.report.readiness.state, "READY");
  const plan = { expectedDomainIds: full.report.domains.map((d) => d.domainId), requiredCheckIds: reportPlan() };
  assert.deepEqual(g.aggregate(full.report.records, plan).readiness, full.report.readiness);
  const partial = g.buildReport(withRecords(p.input, without(p.records, "1C.EVIDENCE.PREMISES")));
  assert.equal(partial.report.readiness.state, "NOT_READY");
  assert.ok(reasonsOf(partial.report).includes("KERNEL.REQUIRED_RESULT.1C.EVIDENCE.PREMISES:REQUIRED_RESULT_MISSING"));
  assert.equal(g.aggregate(partial.report.records, plan).readiness.state, partial.report.readiness.state);
  assert.equal(g.aggregate(partial.report.records).readiness.state, "NOT_READY");
});

// =================================================================== R2: dynamic reference-family completeness

test("C2 R2: positive control -- a validated family with full coverage is READY", async () => {
  const p = await scenario("family-ok", { policy: FAMILY_POLICY, docHead: DOC_FAMILY_OK });
  assert.equal(rec(p.records, "1B.REFERENCES.TB").status, "PASS");
  assert.deepEqual([...rec(p.records, "1A.POLICY.EFFECTIVE").observed.referenceFamilies], ["TB"]);
  assert.equal(rec(p.records, "1B.MARKDOWN.POLICY").observed.policyFingerprint, rec(p.records, "1A.POLICY.EFFECTIVE").observed.policyFingerprint);
  const r = g.buildReport(p.input);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(reasonsOf(r.report), []);
  assert.equal(r.report.readiness.state, "READY");
});

test("C2 R2: a dangling reference fails, and dropping its 1B.REFERENCES.<family> record is never READY", async () => {
  const p = await scenario("family-dangling", { policy: FAMILY_POLICY, docHead: DOC_FAMILY_DANGLING });
  const tb = rec(p.records, "1B.REFERENCES.TB");
  assert.equal(`${tb.status}/${tb.reasonCode}`, "FAIL/REFERENCE_DANGLING");
  const full = g.buildReport(p.input);
  assert.equal(full.report.readiness.state, "NOT_READY");
  const dropped = g.buildReport(withRecords(p.input, without(p.records, "1B.REFERENCES.TB")));
  assert.equal(dropped.ok, true, dropped.reason);
  assert.equal(dropped.report.readiness.state, "NOT_READY");
  assert.deepEqual(reasonsOf(dropped.report), ["KERNEL.REQUIRED_RESULT.1B.REFERENCES.TB:REQUIRED_RESULT_MISSING"]);
});

test("C2 R2: dropping either policy statement is a missing required result, never READY", async () => {
  const p = await scenario("family-ok", { policy: FAMILY_POLICY, docHead: DOC_FAMILY_OK });
  for (const id of ["1A.POLICY.EFFECTIVE", "1B.MARKDOWN.POLICY"]) {
    const r = g.buildReport(withRecords(p.input, without(p.records, id)));
    assert.equal(r.ok, true, `${id}: ${r.reason}`);
    assert.equal(r.report.readiness.state, "NOT_READY", id);
    assert.ok(reasonsOf(r.report).includes(`KERNEL.REQUIRED_RESULT.${id}:REQUIRED_RESULT_MISSING`), id);
  }
  // Dropping 1A's statement AND the family result together still cannot hide the family:
  // 1B's own statement names the family and must match a 1A statement that is now missing.
  const both = g.buildReport(withRecords(p.input, without(p.records, "1A.POLICY.EFFECTIVE", "1B.REFERENCES.TB")));
  assert.notEqual(both.ok && both.report.readiness.state, "READY");
});

test("C2 R2: reference checking run with a narrowed or substituted policy fails closed", async () => {
  const effective = (await scenario("family-dangling", { policy: FAMILY_POLICY, docHead: DOC_FAMILY_DANGLING })).identity.policy.policy;
  const substitutes = {
    "families removed": { ...effective, markdown: { ...effective.markdown, idFamilies: [] } },
    "no Markdown file selected": { ...effective, markdown: { ...effective.markdown, filePatterns: [] } },
    "another field changed, families kept": { ...effective, suppressionPolicy: { maxExpiryDays: 30 } },
  };
  for (const [name, markdownPolicy] of Object.entries(substitutes)) {
    const p = await scenario(`narrowed:${name}`, { policy: FAMILY_POLICY, docHead: DOC_FAMILY_DANGLING, markdownPolicy });
    const r = g.buildReport(p.input);
    assert.equal(r.ok, false, name);
    assert.match(r.reason, /1B checked references against a different policy than 1A's effective policy/, name);
  }
});

test("C2 R2: a forged 1B policy statement or a foreign family record cannot stand in for the real family result", async () => {
  const effective = (await scenario("family-dangling", { policy: FAMILY_POLICY, docHead: DOC_FAMILY_DANGLING })).identity.policy.policy;
  const p = await scenario("narrowed:families removed", { policy: FAMILY_POLICY, docHead: DOC_FAMILY_DANGLING, markdownPolicy: { ...effective, markdown: { ...effective.markdown, idFamilies: [] } } });
  assert.equal(rec(p.records, "1B.REFERENCES.TB"), undefined, "the narrowed 1B run never checked TB");
  // Forge 1B's statement to copy 1A's: the TB result is still required and still missing.
  const stated = rec(p.records, "1A.POLICY.EFFECTIVE").observed;
  const forgedStatement = p.records.map((r) => (r.checkId === "1B.MARKDOWN.POLICY" ? { ...r, observed: { policyFingerprint: stated.policyFingerprint, referenceFamilies: [...stated.referenceFamilies] } } : r));
  const r = g.buildReport(withRecords(p.input, forgedStatement));
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.ok(reasonsOf(r.report).includes("KERNEL.REQUIRED_RESULT.1B.REFERENCES.TB:REQUIRED_RESULT_MISSING"));
  // A family result for a family the effective policy does not define is rejected, not counted.
  const q = await scenario("family-dangling", { policy: FAMILY_POLICY, docHead: DOC_FAMILY_DANGLING });
  const renamed = q.records.map((x) => (x.checkId === "1B.REFERENCES.TB" ? { ...x, checkId: "1B.REFERENCES.ZZ", status: "PASS", reasonCode: "OK" } : x));
  const foreign = g.buildReport(withRecords(q.input, renamed));
  assert.equal(foreign.ok, false);
  assert.match(foreign.reason, /family the effective policy does not define/);
});

test("C2 R2: a duplicate family result fails closed", async () => {
  const p = await scenario("family-ok", { policy: FAMILY_POLICY, docHead: DOC_FAMILY_OK });
  const r = g.buildReport(withRecords(p.input, [...p.records, rec(p.records, "1B.REFERENCES.TB")]));
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.ok(reasonsOf(r.report).includes("KERNEL.CHECK_ID.1B.REFERENCES.TB:DUPLICATE_CHECK_ID"));
});

// =================================================================== R3: target framework metadata provenance

const NEED = "foreign-capability@1";
const FORGED = { frameworkVersion: "9.9.9", supportedCapabilities: [...FRAMEWORK_METADATA.supportedCapabilities, NEED], supportedSchemaVersions: { minSupported: 1, maxSupported: 1 } };

test("C2 R3: caller-supplied metadata is never labelled TARGET_TIP; a forged claim fails closed", () => {
  assert.equal(resolveFrameworkMetadata(FORGED).ok, false);
  assert.equal(resolveFrameworkMetadata(FORGED).reasonCode, "TARGET_METADATA_UNPROVEN");
  for (const value of [undefined, null, FRAMEWORK_METADATA, JSON.parse(JSON.stringify(FRAMEWORK_METADATA))]) {
    const r = resolveFrameworkMetadata(value);
    assert.equal(r.ok, true);
    assert.equal(r.source, "EXECUTING_FRAMEWORK", "only 1A's execution-identity binding ever yields TARGET_TIP");
  }
});

test("C2 R3: forged metadata with an otherwise unsupported capability never yields PASS or READY", async () => {
  const repo = createTempRepo();
  try {
    const tip = repo.commit("base", { "README.md": "# Readme\n", [WORKFLOW]: "name: ci\n", "governance/base.json": JSON.stringify(basePolicy({ requiredCapabilities: [NEED] })), "docs/a.md": DOC_BASE });
    repo.checkout("feature", true);
    const head = repo.commit("head", { "docs/a.md": DOC_CLEAN });
    for (const executed of [head, tip]) {
      const trustedContext = prContext(head, { workflow: { path: WORKFLOW, sha: executed }, platformFiles: platformList(["docs/a.md"]) });
      const forged = await g.getGitIdentity({ trustedContext, ...gitOptions(repo), targetFrameworkMetadata: FORGED });
      assert.equal(forged.established, false);
      assert.equal(forged.outcome.reasonCode, "TARGET_METADATA_UNPROVEN");
      const honest = await g.getGitIdentity({ trustedContext, ...gitOptions(repo) });
      assert.equal(`${rec(honest.records, "1A.POLICY.CAPABILITIES").status}/${rec(honest.records, "1A.POLICY.CAPABILITIES").reasonCode}`, "INCOMPLETE/CAPABILITY_UNAVAILABLE_ON_TARGET");
    }
  } finally {
    repo.cleanup();
  }
  const p = await scenario("needs-foreign", { policy: basePolicy({ requiredCapabilities: [NEED] }) });
  assert.equal(rec(p.records, "1A.POLICY.CAPABILITIES").status, "INCOMPLETE");
  const asIs = g.buildReport(p.input);
  assert.equal(asIs.report.readiness.state, "NOT_READY");
  // Restating the forged list in trustedContext is a contradiction with 1A, never support.
  const claimed = g.buildReport(withContext(p.input, { targetSupportedCapabilities: FORGED.supportedCapabilities }));
  assert.equal(claimed.ok, false);
  assert.match(claimed.reason, /target framework metadata differs/);
});

test("C2 R3: trustedContext target metadata or required capabilities inconsistent with 1A's proven metadata fail closed", async () => {
  const p = await scenario("clean", {});
  assert.equal(g.buildReport(p.input).report.readiness.state, "READY", "positive control");
  const cases = {
    "an extra target capability": { targetSupportedCapabilities: [...FRAMEWORK_METADATA.supportedCapabilities, NEED] },
    "a missing target capability": { targetSupportedCapabilities: FRAMEWORK_METADATA.supportedCapabilities.slice(1) },
    "a widened schema range": { targetSupportedSchemaVersions: { minSupported: 1, maxSupported: 2 } },
    "another frameworkVersion": { frameworkVersion: "9.9.9" },
    "required capabilities the policy does not state": { requiredCapabilities: [NEED] },
  };
  for (const [name, overrides] of Object.entries(cases)) assert.equal(g.buildReport(withContext(p.input, overrides)).ok, false, name);
});

test("C2 R3: a fake resolvedTargetTip + executedCommit pair that only agree with each other is never READY", async () => {
  const p = await scenario("clean", {});
  const fake = "f".repeat(40);
  const r = g.buildReport(withContext(p.input, { resolvedTargetTip: fake, executedCommit: fake }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /resolvedTargetTip differs from the target tip 1A resolved/);
  // The capability provenance binds the tip on its own -- POST_MERGE has no 1A.IDENTITY.TARGET_TIP record.
  const noTipRecord = g.buildReport({ ...withContext(p.input, { resolvedTargetTip: fake, executedCommit: fake }), records: without(p.records, "1A.IDENTITY.TARGET_TIP") });
  assert.equal(noTipRecord.ok, false);
  assert.match(noTipRecord.reason, /resolvedTargetTip differs from the target tip 1A resolved/);
  // A forged 1A provenance record must still be internally consistent to be read at all.
  const forgedCaps = p.records.map((x) => (x.checkId === "1A.POLICY.CAPABILITIES" ? { ...x, observed: { ...x.observed, executedCommit: fake } } : x));
  assert.equal(g.buildReport(withRecords(p.input, forgedCaps)).ok, false);
});

test("C2 R3: head-executed framework metadata can never substitute for target-tip metadata", async () => {
  const p = await scenario("head-executed", { executedFrom: "HEAD" });
  const caps = rec(p.records, "1A.POLICY.CAPABILITIES");
  assert.equal(caps.observed.frameworkMetadataSource, "EXECUTING_FRAMEWORK");
  assert.equal(caps.observed.targetMetadata, null);
  const advisory = g.buildReport(p.input);
  assert.equal(advisory.ok, true, advisory.reason);
  assert.equal(advisory.report.readiness.state, "NOT_READY");
  // Claiming target-tip execution for this run -- even with the real tip -- is rejected.
  const claim = g.buildReport(withContext(p.input, { executedFrom: "TARGET_TIP", executedCommit: p.input.trustedContext.resolvedTargetTip }));
  assert.equal(claim.ok, false);
  // And a run 1A saw execute from the tip cannot be relabelled as head-executed either.
  const q = await scenario("clean", {});
  assert.equal(g.buildReport(withContext(q.input, { executedFrom: "HEAD", executedCommit: q.subject.head })).ok, false);
  // A head-executed run requiring a capability the executing code supports still cannot PASS it.
  const needs = await scenario("head-needs-d15", { executedFrom: "HEAD", policy: basePolicy({ requiredCapabilities: ["markdown-reference-integrity@1"] }) });
  assert.equal(`${rec(needs.records, "1A.POLICY.CAPABILITIES").status}/${rec(needs.records, "1A.POLICY.CAPABILITIES").reasonCode}`, "INCOMPLETE/CAPABILITY_UNAVAILABLE_ON_TARGET");
});

test("C2 R3: real target-tip metadata preserves a legitimate capability PASS and READY", async () => {
  const required = ["markdown-reference-integrity@1", "repository-preflight@1"];
  const p = await scenario("tip-needs-d15", { policy: basePolicy({ requiredCapabilities: required }) });
  const caps = rec(p.records, "1A.POLICY.CAPABILITIES");
  assert.equal(`${caps.status}/${caps.reasonCode}`, "PASS/OK");
  assert.equal(caps.observed.frameworkMetadataSource, "TARGET_TIP");
  assert.equal(caps.observed.targetTip, p.tip);
  assert.equal(caps.observed.executedCommit, p.tip);
  assert.deepEqual([...caps.observed.targetMetadata.supportedCapabilities], [...FRAMEWORK_METADATA.supportedCapabilities]);
  const r = g.buildReport(p.input);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(reasonsOf(r.report), []);
  assert.equal(r.report.readiness.state, "READY");
});
