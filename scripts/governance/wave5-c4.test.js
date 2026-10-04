"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("./index");
const { canonicalRecords } = require("./test-support");
const { createTempRepo, basePolicy, prContext, platformList, gitOptions, changedResult, makeSubject } = require("./test-support-git");
const { policyDigest } = require("./stages/1a/policy");
const rec = (out, id) => out.records.find((r) => r.checkId === id);
let pending;
function fixture() {
  if (!pending) pending = (async () => {
    const repo = createTempRepo();
    repo.commit("base", { "governance/base.json": JSON.stringify(basePolicy()), "docs/a.md": "# Base\n" });
    repo.checkout("feature", true);
    const head = repo.commit("head", { "docs/a.md": "[broken](missing.md)\n" });
    const common = gitOptions(repo);
    const context = prContext(head, { invocationTrust: "OPERATOR_SUPPLIED", eventType: "manual", workflow: null });
    const identity = await g.getGitIdentity({ ...common, trustedContext: context });
    assert.equal(identity.established, true);
    const subject = identity.subject;
    const changed = await g.getChangedFiles({ ...common, subject, identity });
    return { repo, common, context, identity, subject, changed, policy: identity.policy.policy };
  })();
  return pending;
}
test.after(async () => { if (pending) (await pending).repo.cleanup(); });

for (const kind of ["getter", "proxy"]) test(`C4 M1: ${kind} cannot separate consumed policy and fingerprint`, async () => {
  const f = await fixture();
  const honest = await g.checkReferences({ ...f.common, subject: f.subject, changedFiles: f.changed, policy: f.policy });
  assert.equal(rec(honest, "1B.MARKDOWN.LINKS").reasonCode, "LINK_TARGET_MISSING");
  let reads = 0;
  const next = () => ++reads === 1 ? { filePatterns: [], idFamilies: [] } : f.policy.markdown;
  const raw = { ...f.policy };
  const hostile = kind === "getter" ? Object.defineProperty(raw, "markdown", { enumerable: true, get: next })
    : new Proxy(raw, { get(target, key) { return key === "markdown" ? next() : Reflect.get(target, key); } });
  const out = await g.checkReferences({ ...f.common, subject: f.subject, changedFiles: f.changed, policy: hostile });
  assert.equal(reads, 1);
  const used = rec(out, "1B.MARKDOWN.POLICY");
  assert.notEqual(used.observed.policyFingerprint, rec(f.identity, "1A.POLICY.EFFECTIVE").observed.policyFingerprint);
  const aggregate = g.aggregate([...f.identity.records, ...out.records]);
  assert.ok(aggregate.kernelRecords.some((r) => r.reasonCode === "POLICY_BINDING_MISMATCH"));
  assert.equal(aggregate.readiness.state, "NOT_READY");
});

const subject = makeSubject();
for (const [name, changed, policy, reason] of [
  ["invalid changed shape", {}, basePolicy(), "CHANGED_FILES_INPUT_INVALID"],
  ["subject mismatch", changedResult({ ...subject, head: "d".repeat(40) }, []), basePolicy(), "CHANGED_FILES_INPUT_INVALID"],
  ["incomplete changed files", changedResult(subject, ["docs/a.md"], false), basePolicy(), "CHANGED_FILES_INPUT_INVALID"],
  ["noncanonical path", changedResult(subject, ["../escape.md"]), basePolicy(), "CHANGED_FILES_INPUT_INVALID"],
  ["missing policy", changedResult(subject, []), undefined, "POLICY_INVALID"],
  ["invalid policy", changedResult(subject, []), { scope: {} }, "ID_FAMILY_CONFIG_INVALID"],
  ["snapshot failure", changedResult(subject, []), Object.defineProperty({}, "markdown", { enumerable: true, get() { throw new Error("hostile"); } }), "POLICY_INVALID"],
  ["no selected Markdown", changedResult(subject, ["src/a.js"]), basePolicy(), "OK"],
  ["selected file bound", changedResult(subject, Array.from({ length: 501 }, (_, i) => `docs/${i}.md`)), basePolicy(), "MARKDOWN_BOUND_EXCEEDED"],
]) test(`C4 L2: policy statement survives ${name}`, async () => {
  const out = await g.checkReferences({ subject, changedFiles: changed, policy });
  const statement = rec(out, "1B.MARKDOWN.POLICY");
  assert.ok(statement);
  assert.equal(out.records.filter((r) => r.checkId === statement.checkId).length, 1);
  assert.equal(rec(out, "1B.MARKDOWN.FILES").reasonCode, reason);
  if (["missing policy", "invalid policy", "snapshot failure"].includes(name)) assert.notEqual(statement.status, "PASS");
  else {
    assert.equal(statement.status, "PASS");
    assert.equal(statement.observed.policyFingerprint, policyDigest(policy));
  }
  if (["missing policy", "snapshot failure"].includes(name)) assert.equal(statement.observed.policyFingerprint, null);
});

test("C4 L2: policy failure does not mask an independent changed-file failure", async () => {
  const out = await g.checkReferences({ subject, changedFiles: changedResult(subject, [], false) });
  assert.notEqual(rec(out, "1B.MARKDOWN.POLICY").status, "PASS");
  assert.equal(rec(out, "1B.MARKDOWN.FILES").status, "INCOMPLETE");
});

test("C4 M1: caller mutation during content I/O cannot change the policy snapshot", async () => {
  const f = await fixture();
  const mutable = JSON.parse(JSON.stringify(f.policy));
  const call = g.checkReferences({ ...f.common, subject: f.subject, changedFiles: f.changed, policy: mutable });
  mutable.markdown.filePatterns.length = 0;
  const out = await call;
  assert.equal(rec(out, "1B.MARKDOWN.LINKS").reasonCode, "LINK_TARGET_MISSING");
  assert.equal(rec(out, "1B.MARKDOWN.POLICY").observed.policyFingerprint, policyDigest(f.policy));
});

test("C4 M2: legacy operator input preserves real diagnostic Git files", async () => {
  const f = await fixture();
  const out = await g.getChangedFiles({ ...f.common, subject: f.subject, invocationTrust: "OPERATOR_SUPPLIED" });
  assert.deepEqual([...out.files], ["docs/a.md"]);
  assert.equal(out.complete, true);
  assert.equal(rec(out, "1A.DIFF.PLATFORM_AGREEMENT").status, "NOT_APPLICABLE");
  assert.ok(rec(out, "1A.DIFF.PLATFORM_AGREEMENT").observed.applicabilityProof);
  assert.equal(rec(out, "1A.IDENTITY.INVOCATION"), undefined);
  assert.notEqual(g.aggregate(out.records).readiness.state, "READY");
});

for (const [name, legacy, accepted] of [["matching", "OPERATOR_SUPPLIED", true], ["conflicting", "PLATFORM_AUTHENTICATED", false], ["invalid", "ROOT", false]]) {
  test(`C4 M2: identity plus ${name} legacy assertion`, async () => {
    const f = await fixture();
    const out = await g.getChangedFiles({ ...f.common, subject: f.subject, identity: f.identity, invocationTrust: legacy });
    assert.equal(out.complete, accepted);
    if (!accepted) assert.equal(rec(out, "1A.DIFF.CHANGED_FILES").status, "CONFIGURATION_ERROR");
  });
}
test("C4 M2: raw platform enum selects strict comparison but cannot authenticate", async () => {
  const f = await fixture();
  for (const invocationTrust of [undefined, "PLATFORM_AUTHENTICATED"]) {
    const extra = invocationTrust === undefined ? {} : { invocationTrust };
    const strict = await g.getChangedFiles({ ...f.common, subject: f.subject, ...extra });
    assert.equal(strict.complete, false);
    const compared = await g.getChangedFiles({ ...f.common, subject: f.subject, ...extra, platformFiles: platformList(["docs/a.md"]) });
    assert.equal(compared.complete, true);
    assert.equal(rec(compared, "1A.IDENTITY.INVOCATION"), undefined);
    const identity = await g.getGitIdentity({ ...f.common, trustedContext: { ...f.context, invocationTrust: "PLATFORM_AUTHENTICATED", eventType: "pull_request" } });
    assert.equal(rec(identity, "1A.IDENTITY.INVOCATION").reasonCode, "PLATFORM_PROVENANCE_UNAVAILABLE");
    assert.equal(rec(identity, "1A.POLICY.CAPABILITIES").observed.executedCommit, null);
    assert.equal(rec(identity, "1A.POLICY.CAPABILITIES").observed.targetMetadata, null);
    assert.notEqual(g.aggregate([...identity.records, ...compared.records]).readiness.state, "READY");
  }
  const invalid = await g.getChangedFiles({ ...f.common, subject: f.subject, invocationTrust: "ROOT" });
  assert.equal(rec(invalid, "1A.DIFF.CHANGED_FILES").status, "CONFIGURATION_ERROR");
});
test("C4 L1: empty valid input is incomplete; real configuration errors retain precedence", () => {
  const empty = g.aggregate([]);
  assert.equal(empty.overallStatus, "INCOMPLETE");
  assert.equal(empty.readiness.state, "NOT_READY");
  assert.equal(g.exitCodeFor(empty.overallStatus), g.exitCodeFor("INCOMPLETE"));
  for (const out of [g.aggregate([{}]), g.aggregate("invalid"), g.aggregate([], { requiredCheckIds: [7] }), g.aggregate([], { expectedDomainIds: ["UNKNOWN"] }), g.aggregate(canonicalRecords(), { requiredCheckIds: [] }), g.aggregate(canonicalRecords({ overrides: { "1A.POLICY.EFFECTIVE": { observed: {} } } }))]) {
    assert.equal(out.overallStatus, "CONFIGURATION_ERROR");
  }
});
