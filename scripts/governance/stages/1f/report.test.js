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
  // Corrective C2: the 1F.CI record must now be a valid CI evidence record (a bare
  // record with empty `observed` is exactly the malformed input W4-C1-DEV-M1 rejects).
  const ciEvidence = { ...genericRecord("1F.CI", "1F", "PASS"), observed: { classification: "CLEAN_FIRST_PASS" } };
  const r = buildReport(baseInput({ ci: undefined, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), ciEvidence] }));
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

// Corrective C2: this test used to assert that a caller-supplied
// PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN record -- with no externalEvidence entry at all --
// is projected into a finalized, READY-capable report. That was W4-C1-DEV-M1. Even a
// fully consistent record (matching externalEvidence) is now rejected, because
// collectCiEvidence() cannot accept any determination in this configuration, so such a
// record cannot have come from it (determination.js#UNMET_TRUST_PREREQUISITES).
test("DEV-C1-03/09 (corrected by C2): a PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN record is rejected -- without evidence as W4-C1-DEV-M1, and even when fully consistent with externalEvidence, because no determination can be accepted in this configuration", () => {
  const observed = {
    classification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN",
    authenticatedActor: { provider: "github", accountId: "555", accountType: "User" },
    determinationMode: "SEPARATE_PERSON", contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1",
  };
  const records = [genericRecord("1A.IDENTITY", "1A", "PASS"), ciRecord(observed)];
  const withoutEvidence = buildReport(baseInput({ ci: undefined, records }));
  assert.equal(withoutEvidence.ok, false);
  assert.match(withoutEvidence.reason, /exactly one externalEvidence entry/);
  const evidence = { sourceObjectId: "comment-1", sourceVersion: "v1", contentDigest: "d".repeat(64), collectedAt: "t", immutability: "MUTABLE" };
  const consistent = buildReport(baseInput({ ci: undefined, records, externalEvidence: [evidence] }));
  assert.equal(consistent.ok, false);
  assert.match(consistent.reason, /cannot be produced by collectCiEvidence\(\) in this configuration/);
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

// Corrective C2: this test used to accept a finalized report with
// ci = { collected: true, classification: null } -- which, with the record's PASS status,
// reached READY with no classification at all (W4-C1-DEV-M1). It is now rejected.
test("DEV-C1-12/13 (corrected by C2): a 1F.CI record with no classification is rejected, never projected as { collected: true, classification: null }", () => {
  const record = ciRecord({ somethingElse: true });
  const r = buildReport(baseInput({ ci: undefined, records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /classification is missing or not one of the canonical classifications/);
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

// ---------------------------------------------------------------- Corrective C2 (W4-C1-DEV-M1): 1F.CI runtime validation at the report boundary
//
// The C1 re-review showed buildReport() projecting malformed or contradictory 1F.CI
// records into finalized reports, several reaching READY. The record a finalized ci is
// projected from is now validated against the canonical classification contract
// (ci-classify.js#CLASSIFICATION_CONTRACT) before aggregation or projection.

const { renderMarkdown } = require("./render-markdown");

const identity = () => genericRecord("1A.IDENTITY", "1A", "PASS");
const finalize = (ciRecords, extra = {}) => buildReport(baseInput({ ci: undefined, records: [identity(), ...ciRecords], ...extra }));
const acceptedDetermination = (overrides = {}) => ({
  classification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN",
  authenticatedActor: { provider: "github", accountId: "555", accountType: "User" },
  determinationMode: "SEPARATE_PERSON", contentDigest: "d".repeat(64), channelObjectId: "comment-1", version: "v1", ...overrides,
});
const evidenceEntry = (overrides = {}) => ({ sourceObjectId: "comment-1", sourceVersion: "v1", contentDigest: "d".repeat(64), collectedAt: "t", immutability: "MUTABLE", ...overrides });
const ownerAttested = () => ({ classification: "HUMAN_REVIEW_REQUIRED", rerunObserved: true, attestationMode: "OWNER_ATTESTED", candidateClassification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN" });
const hrr = { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "CI_UNEXPLAINED_RERUN" };

function assertRejected(r, pattern, label) {
  assert.equal(r.ok, false, label);
  assert.equal(r.report, null, label);
  if (pattern) assert.match(r.reason, pattern, label);
}

test("DEV-C2-01/02/03: missing, null and non-canonical (SAFE_TO_MERGE) classifications are rejected", () => {
  for (const observed of [{}, { classification: null }, { classification: "SAFE_TO_MERGE" }, { classification: "clean_first_pass" }]) {
    assertRejected(finalize([ciRecord(observed)]), /classification is missing or not one of the canonical classifications/, JSON.stringify(observed));
  }
});

test("DEV-C2-04/05: a classification whose record status contradicts it is rejected (HUMAN_REVIEW_REQUIRED or FAIL with PASS)", () => {
  assertRejected(finalize([ciRecord({ classification: "HUMAN_REVIEW_REQUIRED" })]), /status PASS contradicts classification HUMAN_REVIEW_REQUIRED/);
  assertRejected(finalize([ciRecord({ classification: "FAIL" })]), /status PASS contradicts classification FAIL/);
  assertRejected(finalize([ciRecord({ classification: "CLEAN_FIRST_PASS" }, { status: "FAIL", reasonCode: "CI_REQUIRED_JOB_FAILED" })]), /status FAIL contradicts classification CLEAN_FIRST_PASS/);
});

test("DEV-C2-06: OWNER_ATTESTED metadata with PASS status is rejected, whatever the claimed classification", () => {
  assertRejected(finalize([ciRecord(ownerAttested())]), /status PASS contradicts/);
  assertRejected(finalize([ciRecord({ ...ownerAttested(), classification: "CLEAN_FIRST_PASS" })]), /OWNER_ATTESTED metadata requires HUMAN_REVIEW_REQUIRED/);
});

test("DEV-C2-07/08/09/10: a justified rerun with no, or a mismatched, externalEvidence entry is rejected", () => {
  const record = ciRecord(acceptedDetermination());
  assertRejected(finalize([record]), /exactly one externalEvidence entry/, "07 empty");
  assertRejected(finalize([record], { externalEvidence: [evidenceEntry({ contentDigest: "e".repeat(64) })] }), /digest or version differs/, "08 digest");
  assertRejected(finalize([record], { externalEvidence: [evidenceEntry({ sourceVersion: "v2" })] }), /digest or version differs/, "09 version");
  assertRejected(finalize([record], { externalEvidence: [evidenceEntry({ sourceObjectId: "comment-2" })] }), /exactly one externalEvidence entry/, "10 object ID");
  assertRejected(finalize([record], { externalEvidence: [evidenceEntry(), evidenceEntry({ collectedAt: "t2" })] }), /exactly one externalEvidence entry/, "duplicate entries");
});

test("DEV-C2-11: rejected-determination metadata cannot appear as accepted on a non-justified record", () => {
  const { classification, ...fields } = acceptedDetermination();
  assert.equal(classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
  assertRejected(finalize([ciRecord({ classification: "HUMAN_REVIEW_REQUIRED", ...fields }, hrr)], { externalEvidence: [evidenceEntry()] }), /did not accept a determination/);
  assertRejected(finalize([ciRecord({ classification: "CLEAN_FIRST_PASS", ...fields })], { externalEvidence: [evidenceEntry()] }), /did not accept a determination/);
});

test("DEV-C2-12/13: malformed authenticatedActor and unknown or non-SEPARATE_PERSON determinationMode are rejected", () => {
  for (const actor of ["attacker", null, { provider: "github", accountId: "1" }, { provider: "github", accountId: "1", accountType: "User", extra: true }, { provider: "", accountId: "1", accountType: "User" }]) {
    assertRejected(finalize([ciRecord(acceptedDetermination({ authenticatedActor: actor }))], { externalEvidence: [evidenceEntry()] }), /authenticatedActor is malformed/, JSON.stringify(actor));
  }
  for (const mode of ["SUPER_ADMIN", "OWNER_ATTESTED", null]) {
    assertRejected(finalize([ciRecord(acceptedDetermination({ determinationMode: mode }))], { externalEvidence: [evidenceEntry()] }), /only a SEPARATE_PERSON determination/, String(mode));
  }
  assertRejected(finalize([ciRecord({ classification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN", authenticatedActor: { provider: "github", accountId: "1", accountType: "User" } })]), /accepted-determination metadata is incomplete/, "partial");
});

test("DEV-C2-14/15/16: duplicate, cross-HEAD and mixed Phase 1/Phase 2 CI records never produce a valid finalized report", () => {
  const clean = ciRecord({ classification: "CLEAN_FIRST_PASS" });
  assertRejected(finalize([clean, ciRecord({ classification: "FAIL" }, { status: "FAIL", reasonCode: "CI_REQUIRED_JOB_FAILED" })]), /more than one 1F.CI record/, "14 duplicate");
  assertRejected(finalize([ciRecord({ classification: "CLEAN_FIRST_PASS" }, { subject: { ...subject, head: "b".repeat(40) } })]), /subject differs/, "15 cross-HEAD");
  const phase1Shaped = ciRecord({ collected: false }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" });
  assertRejected(finalize([phase1Shaped, clean]), /more than one 1F.CI record/, "16 mixed pool");
  assertRejected(finalize([phase1Shaped]), /classification is missing/, "16 phase-1-shaped record as phase 2");
  assertRejected(buildReport(baseInput({ ci: { state: "NOT_COLLECTED" }, records: [identity(), clean] })), /mixed-phase input is rejected/, "16 phase-1 marker plus collected record");
});

test("DEV-C2-17: a valid first-pass record produces the canonical CI projection and is the only path to READY", () => {
  const r = finalize([ciRecord({ classification: "CLEAN_FIRST_PASS", repository: "o/r", runId: "1" })]);
  assert.equal(r.ok, true);
  assert.equal(r.report.finalized, true);
  assert.deepEqual(r.report.ci, { classification: "CLEAN_FIRST_PASS" });
  assert.equal(r.report.readiness.state, "READY");
});

test("DEV-C2-18: a valid OWNER_ATTESTED record keeps its transparency fields and the authority cap (never READY)", () => {
  const r = finalize([ciRecord(ownerAttested(), { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" })]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.ci, ownerAttested());
  assert.equal(r.report.readiness.state, "HUMAN_REVIEW_REQUIRED");
  assertRejected(finalize([ciRecord({ classification: "HUMAN_REVIEW_REQUIRED" }, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" })]), /requires the OWNER_ATTESTED metadata/, "reason without metadata");
  assertRejected(finalize([ciRecord({ ...ownerAttested(), attestationMode: "SEPARATE_PERSON" }, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" })]), /OWNER_ATTESTED metadata is malformed/, "wrong mode");
  assertRejected(finalize([ciRecord(ownerAttested(), hrr)]), /OWNER_ATTESTED metadata requires/, "wrong reasonCode");
});

test("DEV-C2-19: JSON and Markdown stay consistent for every valid finalized CI projection", () => {
  const cases = [
    finalize([ciRecord({ classification: "CLEAN_FIRST_PASS" })]),
    finalize([ciRecord(ownerAttested(), { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" })]),
    finalize([ciRecord({ classification: "HUMAN_REVIEW_REQUIRED" }, hrr)]),
  ];
  for (const r of cases) {
    assert.equal(r.ok, true);
    const md = renderMarkdown(r.report);
    assert.match(md, new RegExp(`Readiness state: \`${r.report.readiness.state}\``));
    assert.ok(md.includes(r.report.ci.classification));
    if (r.report.ci.attestationMode) assert.ok(md.includes("OWNER_ATTESTED"));
  }
});

test("DEV-C2-20: no malformed finalized CI evidence produces a READY report", () => {
  const malformed = [
    ciRecord({}), ciRecord({ classification: null }), ciRecord({ classification: "SAFE_TO_MERGE" }),
    ciRecord({ classification: "HUMAN_REVIEW_REQUIRED" }), ciRecord({ classification: "INCOMPLETE" }),
    ciRecord({ classification: "CLEAN_FIRST_PASS" }, { reasonCode: "CI_UNEXPLAINED_RERUN" }),
    ciRecord(ownerAttested()), ciRecord({ ...ownerAttested(), classification: "CLEAN_FIRST_PASS" }),
    ciRecord(acceptedDetermination()), ciRecord(acceptedDetermination({ authenticatedActor: "attacker" })),
    ciRecord({ classification: "CLEAN_FIRST_PASS", authenticatedActor: { provider: "github", accountId: "1", accountType: "User" } }),
    ciRecord({ classification: "CLEAN_FIRST_PASS", rerunObserved: true }),
    ciRecord({ classification: "CLEAN_FIRST_PASS" }, { ownerStage: "1A" }),
    ciRecord("not-an-object"),
    { ...ciRecord({ classification: "CLEAN_FIRST_PASS" }), extraField: true },
  ];
  for (const record of malformed) {
    for (const externalEvidence of [[], [evidenceEntry()]]) {
      const r = finalize([record], { externalEvidence });
      assert.ok(!(r.ok && r.report.readiness.state === "READY"), JSON.stringify(record.observed));
      assert.equal(r.ok, false, JSON.stringify(record.observed));
    }
  }
});
