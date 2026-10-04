"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const g = require("./index");
const { REQUIRED_CHECK_IDS } = require("./kernel/completeness");
const { graphFingerprint } = require("./kernel/graph-fingerprint");
const { canonicalRecords } = require("./test-support");

// Independent complete public input: no test helper can exempt invocation, and
// no mocked aggregate/derivation or synthetic platform adapter is involved.
function completeRecords(mode, invocation) {
  const subject = {
    head: "a".repeat(40), tree: "b".repeat(40), base: "c".repeat(40),
    range: { mode, from: "c".repeat(40), to: "a".repeat(40) },
  };
  const declarations = [{
    domainId: "REVIEW_DOMAIN", enabled: true, ownerStage: "1B",
    dependsOn: [], derivedFrom: [], protectedInputs: ["file:docs/review.md"],
    reviewModes: ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"],
  }];
  const semantic = graphFingerprint(g.validateGraph(declarations));
  const source = crypto.createHash("sha256").update(JSON.stringify({ schemaVersion: 1, gateId: "review-gate", requiredCapabilities: [], domains: declarations })).digest("hex");
  const graph = { baseGateSha256: source, headGateSha256: source, baseGraphFingerprint: semantic, headGraphFingerprint: semantic };
  const policyFingerprint = "d".repeat(64);
  const make = (checkId, observed = {}) => ({
    checkId, ownerStage: checkId.split(".")[0], status: "PASS", subject,
    observed, expected: null, reasonCode: "OK", detail: "C5 public aggregate fixture", evidenceRefs: [],
  });
  const records = [...REQUIRED_CHECK_IDS.COMMON, ...REQUIRED_CHECK_IDS[mode]].map((id) => make(id));
  const replace = (id, fields) => Object.assign(records.find((r) => r.checkId === id), fields);
  replace("1A.POLICY.EFFECTIVE", { observed: { source: "ROOT_POLICY", policyFingerprint, referenceFamilies: [] } });
  for (const id of ["1A.SCOPE.POLICY", "1A.SECRETS.POLICY", "1B.MARKDOWN.POLICY"]) {
    replace(id, { observed: { policyFingerprint, ...(id === "1B.MARKDOWN.POLICY" ? { referenceFamilies: [] } : {}) } });
  }
  replace("1A.POLICY.GATE_ANCHOR", { observed: graph });
  replace("1E.DELTA.DOMAIN_SET", { observed: { ...graph, domainIds: ["REVIEW_DOMAIN"] } });
  const operator = {
    mode, invocationTrust: "OPERATOR_SUPPLIED", provider: "github",
    repositoryId: "owner/repo", eventType: "manual",
  };
  replace("1A.IDENTITY.INVOCATION", {
    status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OPERATOR_INVOCATION", observed: operator, ...invocation,
  });
  records.push({
    ...make("1E.DOMAIN.REVIEW_DOMAIN", { domainId: "REVIEW_DOMAIN" }),
    domain: {
      domainId: "REVIEW_DOMAIN", effectiveLevel: "DEEP_REVIEW_REQUIRED", reasons: [],
      evidenceRefs: [], dependencyState: "NO_DEPENDENCY_ESCALATION", fingerprint: null,
    },
  });
  return records;
}

function aggregateComplete(mode, invocation) {
  const out = g.aggregate(completeRecords(mode, invocation));
  const completeness = out.kernelRecords.find((r) => r.checkId === "KERNEL.COMPLETENESS");
  assert.equal(completeness.status, "PASS", "all policy/graph/domain and mandatory-result bindings must succeed");
  assert.deepEqual(completeness.observed.domainIds, ["REVIEW_DOMAIN"]);
  assert.ok(!out.readiness.reasons.includes("REQUIRED_RESULT_MISSING"));
  assert.ok(!out.readiness.reasons.includes("DOMAIN_RESULT_MISSING"));
  return out;
}

function assertUnavailable(out) {
  assert.notEqual(out.readiness.state, "READY");
  assert.ok(out.readiness.reasons.includes("PLATFORM_PROVENANCE_UNAVAILABLE"));
  assert.ok(out.kernelRecords.some((r) => r.checkId === "KERNEL.INVOCATION_PROVENANCE" &&
    r.status === "INCOMPLETE" && r.reasonCode === "PLATFORM_PROVENANCE_UNAVAILABLE"));
}

for (const mode of ["PR_REVIEW", "POST_MERGE"]) {
  for (const [name, proof] of [
    ["arbitrary", "caller says invocation does not apply"],
    ["plausible", "pure kernel aggregation fixture has no invocation boundary"],
    ["empty", ""],
  ]) test(`C5 ${mode}: complete input cannot exempt invocation with ${name} applicability proof`, () => {
    const out = aggregateComplete(mode, {
      status: "NOT_APPLICABLE", reasonCode: "NOT_APPLICABLE",
      observed: { applicabilityProof: proof, invocationTrust: "PLATFORM_AUTHENTICATED" },
    });
    assertUnavailable(out);
    assert.equal(out.overallStatus, "INCOMPLETE");
    assert.equal(out.readiness.state, "NOT_READY");
    if (proof === "") assert.ok(out.readiness.reasons.includes("APPLICABILITY_NOT_PROVEN"));
    else assert.deepEqual(out.readiness.reasons, ["PLATFORM_PROVENANCE_UNAVAILABLE"]);
    // A persisted diagnostic must neither disappear nor multiply on reconsumption.
    const again = g.aggregate([...out.records, ...out.kernelRecords]);
    assert.deepEqual(again.readiness, out.readiness);
    assert.equal(again.records.filter((r) => r.checkId === "KERNEL.INVOCATION_PROVENANCE").length, 1);
    assert.equal(again.kernelRecords.filter((r) => r.checkId === "KERNEL.INVOCATION_PROVENANCE").length, 0);
  });

  test(`C5 ${mode}: caller PASS cannot mint platform authority`, () => {
    const out = aggregateComplete(mode, { status: "PASS", reasonCode: "OK" });
    assertUnavailable(out);
    assert.equal(out.overallStatus, "INCOMPLETE");
    assert.equal(out.readiness.state, "NOT_READY");
  });

  test(`C5 ${mode}: legitimate operator invocation retains its ceiling`, () => {
    const out = aggregateComplete(mode);
    assert.equal(out.overallStatus, "HUMAN_REVIEW_REQUIRED");
    assert.equal(out.readiness.state, "HUMAN_REVIEW_REQUIRED");
    assert.deepEqual(out.readiness.reasons, ["OPERATOR_INVOCATION"]);
  });

  test(`C5 ${mode}: raw platform INCOMPLETE remains NOT_READY`, () => {
    const out = aggregateComplete(mode, {
      status: "INCOMPLETE", reasonCode: "PLATFORM_PROVENANCE_UNAVAILABLE",
      observed: { mode, invocationTrust: "PLATFORM_AUTHENTICATED", provider: "github", repositoryId: "owner/repo", eventType: mode === "PR_REVIEW" ? "pull_request" : "push" },
    });
    assert.equal(out.overallStatus, "INCOMPLETE");
    assert.equal(out.readiness.state, "NOT_READY");
    assert.deepEqual(out.readiness.reasons, ["PLATFORM_PROVENANCE_UNAVAILABLE"]);
  });

  for (const status of ["FAIL", "CONFIGURATION_ERROR", "INCOMPLETE", "HUMAN_REVIEW_REQUIRED"]) {
    test(`C5 ${mode}: existing ${status} invocation evidence is never downgraded`, () => {
      const out = aggregateComplete(mode, { status, reasonCode: "TRUSTED_CONTEXT_INVALID" });
      assert.equal(out.overallStatus, status);
      assert.notEqual(out.readiness.state, "READY");
      assert.ok(out.readiness.reasons.includes("TRUSTED_CONTEXT_INVALID"));
      assert.equal(out.records.find((r) => r.checkId === "1A.IDENTITY.INVOCATION").status, status);
    });
  }

  test(`C5 ${mode}: legitimate other NOT_APPLICABLE checks remain neutral`, () => {
    const records = completeRecords(mode);
    Object.assign(records.find((r) => r.checkId === "1B.MARKDOWN.FILES"), {
      status: "NOT_APPLICABLE", reasonCode: "NOT_APPLICABLE", observed: { applicabilityProof: "no changed Markdown files" },
    });
    const out = g.aggregate(records);
    assert.equal(out.overallStatus, "HUMAN_REVIEW_REQUIRED");
    assert.equal(out.readiness.state, "HUMAN_REVIEW_REQUIRED");
    assert.deepEqual(out.readiness.reasons, ["OPERATOR_INVOCATION"]);
    assert.equal(out.counts.NOT_APPLICABLE, 1);
    assert.deepEqual(out.kernelRecords.map((r) => r.checkId), ["KERNEL.COMPLETENESS"]);
  });
}

test("C5: shared canonical fixtures model a current operator invocation without an exemption", () => {
  for (const mode of ["PR_REVIEW", "POST_MERGE"]) {
    const subject = { head: "a".repeat(40), tree: "b".repeat(40), base: "c".repeat(40), range: { mode, from: "c".repeat(40), to: "a".repeat(40) } };
    const records = canonicalRecords({ subject });
    const invocation = records.find((r) => r.checkId === "1A.IDENTITY.INVOCATION");
    assert.equal(invocation.status, "HUMAN_REVIEW_REQUIRED");
    assert.equal(invocation.reasonCode, "OPERATOR_INVOCATION");
    assert.equal(invocation.observed.invocationTrust, "OPERATOR_SUPPLIED");
    assert.equal(invocation.observed.mode, mode);
    assert.equal(Object.hasOwn(invocation.observed, "applicabilityProof"), false);
    assert.equal(g.aggregate(records).readiness.state, "HUMAN_REVIEW_REQUIRED");
  }
});
