"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport, isValidTrustedContext, isValidExternalEvidenceEntry, isValidManifestProvenance } = require("./report");
const { makeSubject } = require("../../test-support-git");

const subject = makeSubject();

const trustedContext = (overrides = {}) => ({
  mode: "PR_REVIEW", invocationTrust: "PLATFORM_AUTHENTICATED", provider: "github", repositoryId: "TarasovArtem/qa-ai-agent",
  eventType: "pull_request", targetRefName: "main", resolvedTargetTip: "b".repeat(40), suppliedTargetSha: null,
  headSha: subject.head, base: subject.base, baseDerivation: "merge-base", workflowIdentity: null, workflowBlobSha: null,
  baseWorkflowBlobSha: null, defaultBranch: "main", rootTip: "c".repeat(40), rootPolicyDigest: null, basePolicyDigest: null,
  executedFrom: "HEAD", frameworkVersion: "1.0.0", targetSupportedCapabilities: [], targetSupportedSchemaVersions: [1],
  requiredCapabilities: [], phase: 1, collectorRunId: "collector-1", executedCommit: subject.head,
  ...overrides,
});

const manifest = (overrides = {}) => ({
  gatePath: "governance/gate.json", schemaVersions: [1], headSha256: null, baseGateSha256: null, basePolicySha256: null,
  baseAnchor: "ABSENT", protectedProposals: [], ...overrides,
});

const genericRecord = (checkId, ownerStage, status) => ({ checkId, ownerStage, status, subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });

const baseInput = (overrides = {}) => ({
  subject, tool: { name: "gov-auto-1", version: "0.0.0" }, trustedContext: trustedContext(), externalEvidence: [],
  manifest: manifest(), reviewClass: "HEAVY", changedFiles: ["a.md"], records: [genericRecord("1A.IDENTITY", "1A", "PASS")],
  ci: { state: "NOT_COLLECTED" },
  ...overrides,
});

test("a well-formed Phase 1 input builds a schema-conformant report, but ci:NOT_COLLECTED always keeps it away from READY (design section 17) even when every other record is PASS", () => {
  const r = buildReport(baseInput());
  assert.equal(r.ok, true);
  assert.equal(r.report.schemaVersion, 1);
  assert.equal(r.report.notAuthorization, true);
  assert.equal(r.report.requiresRevalidation, true);
  assert.equal(r.report.finalized, false);
  assert.deepEqual(r.report.ci, { state: "NOT_COLLECTED" });
  assert.equal(r.report.overallStatus, "INCOMPLETE");
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.ok(r.report.records.some((rec) => rec.checkId === "1F.CI" && rec.reasonCode === "CI_NOT_COLLECTED"));
});

test("readiness is always exactly kernel.aggregate()'s own output, never independently computed", () => {
  const r1 = buildReport(baseInput({ records: [genericRecord("1A.IDENTITY", "1A", "FAIL")] }));
  assert.equal(r1.report.overallStatus, "FAIL");
  assert.equal(r1.report.readiness.state, "NOT_READY");
});

test("empty records[] never yields READY (matches the kernel's own 'nothing established' rule)", () => {
  const r = buildReport(baseInput({ records: [] }));
  assert.equal(r.ok, true);
  assert.equal(r.report.overallStatus, "INCOMPLETE");
  assert.notEqual(r.report.readiness.state, "READY");
});

test("domains[] is derived from 1E-shaped records in records[], not trusted from any caller-supplied value", () => {
  const domainRecord = {
    checkId: "1E.DOMAIN.DOMAIN_A", ownerStage: "1E", status: "PASS", subject, observed: { domainId: "DOMAIN_A" }, expected: null,
    reasonCode: "OK", detail: "", evidenceRefs: [],
    domain: { domainId: "DOMAIN_A", effectiveLevel: "PRESERVATION_CHECK_ONLY", reasons: ["NO_CHANGE_DETECTED"], evidenceRefs: [], dependencyState: "NO_DEPENDENCY_ESCALATION", fingerprint: "gov-fp-v1:" + "0".repeat(64) },
  };
  const r = buildReport(baseInput({ records: [domainRecord], expectedDomainIds: ["DOMAIN_A"] }));
  assert.equal(r.ok, true);
  assert.equal(r.report.domains.length, 1);
  assert.equal(r.report.domains[0].domainId, "DOMAIN_A");
  assert.equal(r.report.domains[0].effectiveLevel, "PRESERVATION_CHECK_ONLY");
});

test("a missing expected domain result is detected via the kernel's own completeness check, surfacing as a CONFIGURATION_ERROR/INCOMPLETE kernel record inside records[]", () => {
  const r = buildReport(baseInput({ records: [genericRecord("1A.IDENTITY", "1A", "PASS")], expectedDomainIds: ["DOMAIN_A"] }));
  assert.equal(r.ok, true);
  assert.ok(r.report.records.some((rec) => rec.checkId === "KERNEL.DOMAIN_RESULT.DOMAIN_A"));
  assert.notEqual(r.report.readiness.state, "READY");
});

test("a Phase 2 report (ci omitted, 1F.CI record present) is marked finalized", () => {
  const r = buildReport(baseInput({ ci: undefined, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), genericRecord("1F.CI", "1F", "PASS")] }));
  assert.equal(r.ok, true);
  assert.equal(r.report.finalized, true);
});

test("trustedContext.headSha must match the subject -- cross-HEAD mixing fails closed", () => {
  const r = buildReport(baseInput({ trustedContext: trustedContext({ headSha: "b".repeat(40) }) }));
  assert.equal(r.ok, false);
});

test("malformed trustedContext (missing field, extra field, bad SHA) is rejected", () => {
  assert.equal(buildReport(baseInput({ trustedContext: {} })).ok, false);
  assert.equal(buildReport(baseInput({ trustedContext: { ...trustedContext(), extra: 1 } })).ok, false);
  assert.equal(buildReport(baseInput({ trustedContext: trustedContext({ base: "not-a-sha" }) })).ok, false);
  assert.equal(buildReport(baseInput({ trustedContext: trustedContext({ invocationTrust: "SOMETHING_ELSE" }) })).ok, false);
});

test("malformed externalEvidence entries are rejected", () => {
  const r = buildReport(baseInput({ externalEvidence: [{ sourceObjectId: "x" }] }));
  assert.equal(r.ok, false);
});

test("a valid externalEvidence entry is preserved verbatim in the report", () => {
  const entry = { sourceObjectId: "comment-1", sourceVersion: "v1", contentDigest: "d".repeat(64), collectedAt: "2026-09-28T00:00:00Z", immutability: "MUTABLE" };
  const r = buildReport(baseInput({ externalEvidence: [entry] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.externalEvidence, [entry]);
});

test("malformed manifest provenance is rejected", () => {
  assert.equal(buildReport(baseInput({ manifest: {} })).ok, false);
  assert.equal(buildReport(baseInput({ manifest: manifest({ baseAnchor: "MAYBE" }) })).ok, false);
});

test("missing subject, tool, reviewClass, or changedFiles fails closed", () => {
  assert.equal(buildReport({ ...baseInput(), subject: "not-a-subject" }).ok, false);
  assert.equal(buildReport({ ...baseInput(), tool: {} }).ok, false);
  assert.equal(buildReport({ ...baseInput(), reviewClass: "" }).ok, false);
  assert.equal(buildReport({ ...baseInput(), changedFiles: "not-an-array" }).ok, false);
});

test("a malformed ci value for a Phase 1 report (anything other than exactly {state: NOT_COLLECTED}) is rejected", () => {
  assert.equal(buildReport(baseInput({ ci: { state: "READY" } })).ok, false);
  assert.equal(buildReport(baseInput({ ci: "NOT_COLLECTED" })).ok, false);
});

test("never throws on a fully hostile input object", () => {
  for (const bad of [null, undefined, 42, [], {}]) {
    assert.doesNotThrow(() => buildReport(bad));
  }
});

test("five repeated builds of an identical fixture are deterministic", () => {
  const outs = Array.from({ length: 5 }, () => JSON.stringify(buildReport(baseInput()).report));
  assert.equal(new Set(outs).size, 1);
});

test("isValidTrustedContext / isValidExternalEvidenceEntry / isValidManifestProvenance are usable standalone", () => {
  assert.equal(isValidTrustedContext(trustedContext()), true);
  assert.equal(isValidTrustedContext({}), false);
  assert.equal(isValidExternalEvidenceEntry({ sourceObjectId: "x", sourceVersion: "v", contentDigest: "d".repeat(64), collectedAt: "t", immutability: "MUTABLE" }), true);
  assert.equal(isValidManifestProvenance(manifest()), true);
});

// ---------------------------------------------------------------- Corrective C1 (W4-DEV-M1): finalized report.ci schema conformance
//
// Design section 23: `ci` must be "the 1F record with classification and,
// when a determination was accepted, {authenticatedActor, determinationMode,
// contentDigest, channelObjectId, version}", plus rerunObserved/attestationMode/
// candidateClassification under OWNER_ATTESTED -- never the bare
// `{ collected: true }` flag the original implementation produced.

const ciRecord = (observed, overrides = {}) => ({
  checkId: "1F.CI", ownerStage: "1F", status: "PASS", subject, observed, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [], ...overrides,
});

test("DEV-C1-02: a CLEAN_FIRST_PASS finalized report's ci carries the classification, with no determination fields", () => {
  const record = ciRecord({ classification: "CLEAN_FIRST_PASS" });
  const r = buildReport(baseInput({ ci: undefined, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.ci, { classification: "CLEAN_FIRST_PASS" });
});

test("DEV-C1-03/09: a PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN finalized report's ci carries the classification plus the exact authenticatedActor/determinationMode/contentDigest/channelObjectId/version design section 23 requires, agreeing exactly with the underlying record", () => {
  const observed = {
    classification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN",
    authenticatedActor: { provider: "github", accountId: "555", accountType: "User" },
    determinationMode: "SEPARATE_PERSON", contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1",
  };
  const record = ciRecord(observed);
  const r = buildReport(baseInput({ ci: undefined, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.ci, {
    classification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN",
    authenticatedActor: observed.authenticatedActor, determinationMode: "SEPARATE_PERSON",
    contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1",
  });
  assert.equal(r.report.ci.classification, record.observed.classification);
});

test("DEV-C1-04/05/06/07: an OWNER_ATTESTED-evidenced HUMAN_REVIEW_REQUIRED finalized report's ci exposes rerunObserved, attestationMode and candidateClassification, and readiness stays capped (never READY)", () => {
  const observed = {
    classification: "HUMAN_REVIEW_REQUIRED", rerunObserved: true, attestationMode: "OWNER_ATTESTED",
    candidateClassification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN",
  };
  const record = ciRecord(observed, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" });
  const r = buildReport(baseInput({ ci: undefined, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
  assert.equal(r.ok, true);
  assert.equal(r.report.ci.rerunObserved, true);
  assert.equal(r.report.ci.attestationMode, "OWNER_ATTESTED");
  assert.equal(r.report.ci.candidateClassification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
  assert.notEqual(r.report.readiness.state, "READY");
  assert.equal(r.report.readiness.state, "HUMAN_REVIEW_REQUIRED");
});

test("DEV-C1-08: a record with no authenticatedActor/rerunObserved (a rejected or absent determination) never has those fields fabricated into ci", () => {
  const record = ciRecord({ classification: "HUMAN_REVIEW_REQUIRED" }, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "CI_UNEXPLAINED_RERUN" });
  const r = buildReport(baseInput({ ci: undefined, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.ci, { classification: "HUMAN_REVIEW_REQUIRED" });
  assert.equal("authenticatedActor" in r.report.ci, false);
  assert.equal("rerunObserved" in r.report.ci, false);
});

test("DEV-C1-12/13: a 1F.CI record with a malformed observed payload (no classification) fails closed to a minimal, honest ci shape, never a fabricated one", () => {
  const record = ciRecord({ somethingElse: true });
  const r = buildReport(baseInput({ ci: undefined, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.ci, { collected: true, classification: null });
});

test("DEV-C1-14: mixed-phase input -- ci:{state:NOT_COLLECTED} together with an already-collected 1F.CI record in records[] -- is rejected, not silently resolved either way", () => {
  const record = ciRecord({ classification: "CLEAN_FIRST_PASS" });
  const r = buildReport(baseInput({ ci: { state: "NOT_COLLECTED" }, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
  assert.equal(r.ok, false);
});

test("DEV-C1-10: report.ci cannot be independently overwritten by caller-supplied content for a finalized report -- ci must be omitted or the literal Phase-1 marker, never an arbitrary object", () => {
  const record = ciRecord({ classification: "CLEAN_FIRST_PASS" });
  const r = buildReport(baseInput({ ci: { classification: "FORGED" }, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
  assert.equal(r.ok, false);
});
