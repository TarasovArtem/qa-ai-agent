"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("./index");
const { graphFingerprint } = require("./kernel/graph-fingerprint");
const { FRAMEWORK_METADATA } = require("./framework-metadata");
const { createTempRepo, basePolicy, prContext, platformList, gitOptions, reportContext } = require("./test-support-git");

const PATH = "governance/manifests/review-gate.json";
const domain = (id, extra = {}) => ({ domainId: id, enabled: true, ownerStage: "1E", dependsOn: [], derivedFrom: [], protectedInputs: ["file:docs/a.md"], reviewModes: ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"], ...extra });
const declarations = [domain("DOMAIN_A"), domain("DOMAIN_B", { dependsOn: [{ domain: "DOMAIN_A", kind: "REFERENCE" }] })];
const graph = () => g.validateGraph(declarations);
const rec = (rs, id) => rs.find((r) => r.checkId === id);
const copy = (x) => JSON.parse(JSON.stringify(x));

let fixturePromise;
async function fixture() {
  if (!fixturePromise) fixturePromise = (async () => {
    const repo = createTempRepo();
    const bytes = JSON.stringify({ schemaVersion: 1, gateId: "review-gate", requiredCapabilities: [], domains: declarations });
    const tip = repo.commit("base", { "governance/base.json": JSON.stringify(basePolicy()), [PATH]: bytes, "docs/a.md": "# Base\n", ".github/workflows/ci.yml": "name: ci\n" });
    repo.checkout("feature", true);
    const head = repo.commit("head", { "docs/a.md": "# Changed\n" });
    const common = gitOptions(repo);
    const context = prContext(head, { workflow: { path: ".github/workflows/ci.yml", sha: tip }, platformFiles: platformList(["docs/a.md"]) });
    const identity = await g.getGitIdentity({ ...common, trustedContext: context, gate: { gateId: "review-gate", requiresManifest: true } });
    assert.equal(identity.established, true);
    const subject = identity.subject;
    const changed = await g.getChangedFiles({ ...common, subject, identity, platformFiles: context.platformFiles });
    const policy = identity.policy.policy;
    const scope = g.checkScope({ subject, changedFiles: changed, policy });
    const secrets = await g.scanSecrets({ ...common, subject, changedFiles: changed, policy, now: "2026-10-03" });
    const markdown = await g.checkReferences({ ...common, subject, changedFiles: changed, policy });
    return { repo, tip, head, common, context, identity, subject, records: [...identity.records, ...changed.records, ...scope.records, ...secrets.records, ...markdown.records] };
  })();
  return fixturePromise;
}
test.after(async () => { if (fixturePromise) (await fixturePromise).repo.cleanup(); });

async function delta(headGraph = graph(), baseGraph = graph(), records) {
  const f = await fixture();
  return g.computeDeltaReview({ ...f.common, subject: f.subject, records: records || f.records, headGraph, baseGraph });
}
async function aggregateDelta(result, records) {
  const f = await fixture();
  return g.aggregate([...(records || f.records), ...result.records]);
}
const mismatch = (a) => a.kernelRecords.some((r) => r.reasonCode === "GRAPH_PROVENANCE_MISMATCH");

test("C3 control: real Git owner bytes and actual consumer semantics bind without pretending platform authentication", async () => {
  const f = await fixture();
  const d = await delta();
  const owner = rec(f.records, "1A.POLICY.GATE_ANCHOR").observed;
  const used = rec(d.records, "1E.DELTA.DOMAIN_SET").observed;
  for (const key of ["baseGateSha256", "headGateSha256", "baseGraphFingerprint", "headGraphFingerprint"]) {
    assert.match(owner[key], /^[0-9a-f]{64}$/);
    assert.equal(used[key], owner[key]);
  }
  const a = await aggregateDelta(d);
  assert.equal(mismatch(a), false);
  assert.deepEqual(rec(a.kernelRecords, "KERNEL.COMPLETENESS").observed.domainIds, ["DOMAIN_A", "DOMAIN_B"]);
  assert.notEqual(a.readiness.state, "READY");
});

for (const [id, fields] of [
  ["M1-A", ["baseGateSha256", "headGateSha256"]],
  ["M1-B", ["baseGraphFingerprint", "headGraphFingerprint"]],
  ["M1-C", ["expectedGraphFingerprint"]],
  ["M1-I", ["baseGateSha256", "headGateSha256", "headGraphFingerprint"]],
  ["M1-J", ["baseGateSha256", "headGateSha256", "baseGraphFingerprint", "headGraphFingerprint"]],
]) test(`C3 ${id}: copied/expected provenance labels cannot authenticate a different valid graph`, async () => {
  const f = await fixture();
  const wrong = copy(graph());
  wrong.domains[0].protectedInputs = ["file:README.md"];
  const owner = rec(f.records, "1A.POLICY.GATE_ANCHOR").observed;
  for (const key of fields) wrong[key] = key === "expectedGraphFingerprint" ? graphFingerprint(wrong) : owner[key];
  assert.equal(g.validateGraph(wrong.domains).valid, true);
  const d = await delta(wrong);
  const used = rec(d.records, "1E.DELTA.DOMAIN_SET").observed;
  assert.notEqual(used.headGraphFingerprint, owner.headGraphFingerprint);
  const a = await aggregateDelta(d);
  assert.equal(mismatch(a), true);
  assert.equal(a.readiness.state, "NOT_READY");
  assert.notEqual(rec(a.kernelRecords, "KERNEL.COMPLETENESS").status, "PASS");
});

test("C3 M1-D: a present base manifest cannot be treated as an absent base graph", async () => {
  const a = await aggregateDelta(await delta(graph(), null));
  assert.ok(a.kernelRecords.some((r) => r.reasonCode === "BASE_GRAPH_UNBOUND"));
  assert.equal(a.readiness.state, "NOT_READY");
});

test("C3 M1-E: missing owner graph provenance remains mandatory and cannot produce READY", async () => {
  const f = await fixture();
  const records = f.records.filter((r) => r.checkId !== "1A.POLICY.GATE_ANCHOR");
  const a = await aggregateDelta(await delta(graph(), graph(), records), records);
  assert.ok(a.kernelRecords.some((r) => r.checkId === "KERNEL.REQUIRED_RESULT.1A.POLICY.GATE_ANCHOR"));
  assert.notEqual(rec(a.kernelRecords, "KERNEL.COMPLETENESS").status, "PASS");
  assert.equal(a.readiness.state, "NOT_READY");
});

test("C3 M1-F: semantics changed after owner validation are recomputed from the graph consumed", async () => {
  await fixture();
  const changed = copy(graph());
  changed.domains[1].dependsOn[0].kind = "MEANING";
  const a = await aggregateDelta(await delta(changed));
  assert.equal(mismatch(a), true);
  assert.equal(a.readiness.state, "NOT_READY");
});

test("C3 consumption snapshot: mutation across an await cannot change validated graph semantics", async () => {
  const f = await fixture();
  const mutable = copy(graph());
  const before = graphFingerprint(mutable);
  const pending = g.computeDeltaReview({ ...f.common, subject: f.subject, records: f.records, headGraph: mutable, baseGraph: graph() });
  mutable.domains[0].protectedInputs = ["file:README.md"];
  const d = await pending;
  assert.equal(rec(d.records, "1E.DELTA.DOMAIN_SET").observed.headGraphFingerprint, before);
  assert.equal(mismatch(await aggregateDelta(d)), false);
});

test("C3 M1-G: every review-relevant graph semantic affects identity; only semantic sets ignore order", () => {
  const original = graph();
  const fingerprint = graphFingerprint(original);
  const alterations = [
    (d) => { d[1].dependsOn = []; },
    (d) => { d[1].dependsOn[0].kind = "MEANING"; },
    (d) => { d[0].derivedFrom = [{ type: "SOURCE", selector: "file:docs/a.md" }]; },
    (d) => { d[0].protectedInputs = ["file:README.md"]; },
    (d) => { d[0].reviewModes = ["DEEP_REVIEW_REQUIRED"]; },
    (d) => { d[0].ownerStage = "1B"; },
    (d) => { d[1].enabled = false; },
  ];
  for (const alter of alterations) {
    const changed = copy(original); alter(changed.domains);
    assert.equal(g.validateGraph(changed.domains).valid, true);
    assert.notEqual(graphFingerprint(changed), fingerprint);
  }
  const reordered = copy(original); reordered.domains.reverse();
  for (const d of reordered.domains) d.reviewModes.reverse();
  assert.equal(graphFingerprint(reordered), fingerprint);
  const labelled = { ...original, headGraphFingerprint: "f".repeat(64), expectedGraphFingerprint: "0".repeat(64), headGateSha256: "1".repeat(64) };
  assert.equal(graphFingerprint(labelled), fingerprint);
});

test("C3 M1-H: a narrow graph cannot narrow canonical completeness, even with a caller plan", async () => {
  const wrong = g.validateGraph([declarations[0]]);
  const d = await delta(wrong, wrong);
  const f = await fixture();
  const a = g.aggregate([...f.records, ...d.records], { expectedDomainIds: ["DOMAIN_A"], requiredCheckIds: [] });
  assert.equal(mismatch(a), true);
  assert.ok(a.kernelRecords.some((r) => r.reasonCode === "COMPLETENESS_PLAN_NARROWED"));
  assert.equal(a.readiness.state, "NOT_READY");
});

test("C3 M2-A: genuine workflow metadata under OPERATOR_SUPPLIED is rejected, not authenticated", async () => {
  const f = await fixture();
  const r = await g.getGitIdentity({ ...f.common, trustedContext: { ...f.context, invocationTrust: "OPERATOR_SUPPLIED", eventType: "manual" } });
  assert.equal(r.established, false);
  assert.equal(r.outcome.status, "INCOMPLETE");
  const manual = await g.getGitIdentity({ ...f.common, trustedContext: { ...f.context, invocationTrust: "OPERATOR_SUPPLIED", eventType: "manual", workflow: null } });
  assert.equal(rec(manual.records, "1A.IDENTITY.INVOCATION").status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(rec(manual.records, "1A.POLICY.CAPABILITIES").observed.executedCommit, null);
  assert.notEqual(g.aggregate(manual.records).readiness.state, "READY");
});

test("C3 M2-B/C/D/I: real values, serialization and a caller-selected enum cannot mint platform authority", async () => {
  const f = await fixture();
  for (const raw of [f.context, copy(f.context), { ...f.context, suppliedTargetSha: f.tip }]) {
    const r = await g.getGitIdentity({ ...f.common, trustedContext: raw });
    const invocation = rec(r.records, "1A.IDENTITY.INVOCATION");
    assert.equal(invocation.status, "INCOMPLETE");
    assert.equal(invocation.reasonCode, "PLATFORM_PROVENANCE_UNAVAILABLE");
    assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
  }
});

test("C3 M2-E/F: raw callers cannot establish TARGET_TIP, executedCommit or authoritative capability PASS", async () => {
  const f = await fixture();
  const o = rec(f.identity.records, "1A.POLICY.CAPABILITIES");
  assert.equal(o.status, "INCOMPLETE");
  assert.equal(o.reasonCode, "PLATFORM_PROVENANCE_UNAVAILABLE");
  assert.equal(o.observed.frameworkMetadataSource, "EXECUTING_FRAMEWORK");
  assert.equal(o.observed.executedCommit, null);
  assert.equal(o.observed.targetMetadata, null);
  assert.equal(rec(f.identity.records, "1A.IDENTITY.WORKFLOW_ANCHOR").status, "INCOMPLETE");
});

test("C3 M2-G/H: a schema-valid raw report context cannot establish finalized authoritative evidence or READY", async () => {
  const f = await fixture();
  const r = g.buildReport({ subject: f.subject, tool: { name: "gov-auto-1", version: FRAMEWORK_METADATA.frameworkVersion }, trustedContext: reportContext(f.subject, { invocationTrust: "PLATFORM_AUTHENTICATED", eventType: "pull_request", resolvedTargetTip: f.tip }) });
  assert.equal(r.ok, false);
  assert.equal(r.report, null);
  assert.match(r.reason, /PLATFORM_PROVENANCE_UNAVAILABLE/);
});

test("C3 combined failures: missing mandatory results and raw platform provenance remain observable", async () => {
  const f = await fixture();
  const invocation = rec(f.identity.records, "1A.IDENTITY.INVOCATION");
  assert.equal(invocation.reasonCode, "PLATFORM_PROVENANCE_UNAVAILABLE");
  const aggregated = g.aggregate([invocation]);
  assert.equal(aggregated.readiness.state, "NOT_READY");
  assert.ok(aggregated.kernelRecords.some((r) => r.reasonCode === "REQUIRED_RESULT_MISSING"));
  assert.ok(aggregated.readiness.reasons.includes("REQUIRED_RESULT_MISSING"));
  assert.ok(aggregated.readiness.reasons.includes("PLATFORM_PROVENANCE_UNAVAILABLE"));
});

test("C3 invariants: no new public export, metadata identity or schema range", () => {
  assert.equal(Object.hasOwn(g, "graphFingerprint"), false);
  assert.equal(Object.hasOwn(g, "semanticGraph"), false);
  assert.equal(FRAMEWORK_METADATA.frameworkVersion, "0.5.0");
  assert.equal(FRAMEWORK_METADATA.supportedCapabilities.length, 6);
  assert.ok(FRAMEWORK_METADATA.supportedCapabilities.every((c) => c.endsWith("@1")));
  assert.deepEqual(FRAMEWORK_METADATA.supportedSchemaVersions, { minSupported: 1, maxSupported: 1 });
});

test("C3 source bytes are audit identity independently of equal graph semantics", async () => {
  const f = await fixture();
  const { fakeReader } = require("./test-support-git");
  const bytes = JSON.stringify({schemaVersion:1, gateId:"review-gate", requiredCapabilities:[], domains:declarations}, null, 2);
  const d = await g.computeDeltaReview({subject:f.subject, records:f.records, headGraph:graph(), baseGraph:graph(), reader:{atBase:fakeReader({[PATH]:bytes,"docs/a.md":"# Base\n"}), atHead:fakeReader({[PATH]:bytes,"docs/a.md":"# Changed\n"})}});
  assert.equal(rec(d.records, "1E.DELTA.DOMAIN_SET").observed.headGraphFingerprint, rec(f.records,"1A.POLICY.GATE_ANCHOR").observed.headGraphFingerprint);
  const a = await aggregateDelta(d);
  assert.equal(mismatch(a), true);
  assert.notEqual(a.readiness.state, "READY");
});

test("C3 root revalidation cannot accept missing, malformed or forged owner binding", async () => {
  const f=await fixture();
  const owner=rec(f.records,"1A.POLICY.ROOT");
  const report={schemaVersion:1,requiresRevalidation:true,notAuthorization:true,generatedFor:{head:f.subject.head,tree:f.subject.tree,base:f.subject.base},trustedContext:{rootTip:owner.observed.rootTip,rootPolicyDigest:owner.observed.rootPolicyDigest},externalEvidence:[],records:[owner]};
  const call=(r)=>g.revalidateEvidence({subject:f.subject,report:r,items:[],adapters:{},rootPolicy:{resolve:async()=>({ok:true,rootTip:r.trustedContext.rootTip,digest:r.trustedContext.rootPolicyDigest})}});
  assert.equal((await call(report)).records[0].status,"PASS");
  for(const r of [{...report,records:[]},{...report,records:[{...owner,observed:{rootTip:owner.observed.rootTip,rootPolicyDigest:"bad"}}]},{...report,trustedContext:{...report.trustedContext,rootPolicyDigest:null}}]){
    const out=await call(r);
    assert.equal(out.records[0].status,"INCOMPLETE");
    assert.equal(out.records[0].reasonCode,"STALE_EVIDENCE");
    assert.equal(out.records[0].observed.staleItems[0].reason,"ROOT_OWNER_BINDING_INVALID");
  }
});
