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
  // Corrective C4 (W4-C2R-DEV-M2): a sparse {classification:"CLEAN_FIRST_PASS"}
  // record (this test's original fixture) is also no longer valid on its own --
  // it must carry the complete CI-run evidence contract; see runObserved()/runEvidenceFor() below.
  const o = runObserved();
  const ciEvidence = { ...genericRecord("1F.CI", "1F", "PASS"), observed: o };
  const r = buildReport(baseInput({ ci: undefined, trustedContext: trustedContext({ phase: 2 }), records: [genericRecord("1A.IDENTITY", "1A", "PASS"), ciEvidence], externalEvidence: [runEvidenceFor(o)] }));
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

const phase2Input = (overrides = {}) => baseInput({ ci: undefined, trustedContext: trustedContext({ phase: 2 }), ...overrides });

test("DEV-C1-02: a CLEAN_FIRST_PASS finalized report's ci carries the classification, with no determination fields", () => {
  // Corrective C4 (W4-C2R-DEV-M2): the original sparse fixture is now rejected
  // outright (it is exactly the reproduced defect); a genuine CLEAN_FIRST_PASS
  // record requires the complete CI-run evidence contract.
  const o = runObserved();
  const record = ciRecord(o);
  const r = buildReport(phase2Input({ records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record], externalEvidence: [runEvidenceFor(o)] }));
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
  const withoutEvidence = buildReport(phase2Input({ records }));
  assert.equal(withoutEvidence.ok, false);
  assert.match(withoutEvidence.reason, /exactly one externalEvidence entry/);
  const evidence = { sourceObjectId: "comment-1", sourceVersion: "v1", contentDigest: "d".repeat(64), collectedAt: "t", immutability: "MUTABLE" };
  const consistent = buildReport(phase2Input({ records, externalEvidence: [evidence] }));
  assert.equal(consistent.ok, false);
  assert.match(consistent.reason, /cannot be produced by collectCiEvidence\(\) in this configuration/);
});

test("DEV-C1-04/05/06/07: an OWNER_ATTESTED-evidenced HUMAN_REVIEW_REQUIRED finalized report's ci exposes rerunObserved, attestationMode and candidateClassification, and readiness stays capped (never READY)", () => {
  // Corrective C4 (W4-C2R-DEV-M2): a real OWNER_ATTESTED collector-produced
  // record is ALWAYS a completed-run rerun record, so the test fixture must
  // carry the full identity fields too, not just the attestation ones.
  const o = runObserved({ classification: "HUMAN_REVIEW_REQUIRED", attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }],
    rerunObserved: true, attestationMode: "OWNER_ATTESTED", candidateClassification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN" });
  const record = ciRecord(o, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" });
  const r = buildReport(phase2Input({ records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record], externalEvidence: [runEvidenceFor(o)] }));
  assert.equal(r.ok, true);
  assert.equal(r.report.ci.rerunObserved, true);
  assert.equal(r.report.ci.attestationMode, "OWNER_ATTESTED");
  assert.equal(r.report.ci.candidateClassification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
  assert.notEqual(r.report.readiness.state, "READY");
  assert.equal(r.report.readiness.state, "HUMAN_REVIEW_REQUIRED");
});

test("DEV-C1-08: a record with no authenticatedActor/rerunObserved (a rejected or absent determination) never has those fields fabricated into ci", () => {
  const o = runObserved({ classification: "HUMAN_REVIEW_REQUIRED", attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }] });
  const record = ciRecord(o, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "CI_UNEXPLAINED_RERUN" });
  const r = buildReport(phase2Input({ records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record], externalEvidence: [runEvidenceFor(o)] }));
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
  const r = buildReport(phase2Input({ records: [genericRecord("1A.IDENTITY", "1A", "PASS"), record] }));
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
// Corrective C3 (W4-C2R-DEV-L1): a Phase 2 (finalized) report must declare
// trustedContext.phase === 2, or buildReport() now rejects the phase/ci
// mismatch before ever reaching aggregation.
const finalize = (ciRecords, extra = {}) => buildReport(baseInput({ ci: undefined, trustedContext: trustedContext({ phase: 2 }), records: [identity(), ...ciRecords], ...extra }));
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

// Corrective C4 (W4-C2R-DEV-M2): a genuinely valid OWNER_ATTESTED record is
// ALSO always a completed-run rerun record (see stages/1f/ci-evidence.js's
// collector) -- the bare ownerAttested() shape above is deliberately kept
// minimal for the many REJECTION-path tests above/below that never reach the
// completed-run shape check anyway; this fixture is for the genuine POSITIVE
// (accepted) cases below, which do.
const ownerAttestedComplete = () => runObserved({ attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }], ...ownerAttested() });

test("DEV-C2-17: a valid first-pass record produces the canonical CI projection and is the only path to READY", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
  assert.equal(r.report.finalized, true);
  assert.deepEqual(r.report.ci, { classification: "CLEAN_FIRST_PASS" });
  assert.equal(r.report.readiness.state, "READY");
});

test("DEV-C2-18: a valid OWNER_ATTESTED record keeps its transparency fields and the authority cap (never READY)", () => {
  const complete = ownerAttestedComplete();
  const r = finalize([ciRecord(complete, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" })], { externalEvidence: [runEvidenceFor(complete)] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.ci, ownerAttested());
  assert.equal(r.report.readiness.state, "HUMAN_REVIEW_REQUIRED");
  assertRejected(finalize([ciRecord({ classification: "HUMAN_REVIEW_REQUIRED" }, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" })]), /requires the OWNER_ATTESTED metadata/, "reason without metadata");
  assertRejected(finalize([ciRecord({ ...ownerAttested(), attestationMode: "SEPARATE_PERSON" }, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" })]), /OWNER_ATTESTED metadata is malformed/, "wrong mode");
  assertRejected(finalize([ciRecord(ownerAttested(), hrr)]), /OWNER_ATTESTED metadata requires/, "wrong reasonCode");
});

test("DEV-C2-19: JSON and Markdown stay consistent for every valid finalized CI projection", () => {
  const clean = runObserved();
  const attested = ownerAttestedComplete();
  const unexplainedRerun = runObserved({ classification: "HUMAN_REVIEW_REQUIRED", attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }] });
  const cases = [
    finalize([ciRecord(clean)], { externalEvidence: [runEvidenceFor(clean)] }),
    finalize([ciRecord(attested, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OWNER_SELF_DETERMINATION" })], { externalEvidence: [runEvidenceFor(attested)] }),
    finalize([ciRecord(unexplainedRerun, hrr)], { externalEvidence: [runEvidenceFor(unexplainedRerun)] }),
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

// ======================================================================
// Corrective C3 (W4-C2R-DEV-M1): missing-CI never reaches READY
// ======================================================================
//
// The independent C2 re-review reproduced: input.ci undefined or null,
// input.records containing no 1F.CI record -> ok:true, readiness.state:READY,
// overallStatus:PASS, finalized:false, ci:{state:"NOT_COLLECTED"}, zero 1F.CI
// records. Neither Phase 1 nor Phase 2 was actually supplied; this is now a
// configuration failure, never a successful report.

test("C3-DEV-M1-01: ci omitted and no 1F.CI record -- rejected, never a successful report", () => {
  const r = buildReport(baseInput({ ci: undefined, records: [identity()] }));
  assert.equal(r.ok, false);
  assert.equal(r.report, null);
  assert.match(r.reason, /neither was supplied/);
});

test("C3-DEV-M1-02: ci explicitly null and no 1F.CI record -- rejected the same way as omitted", () => {
  const r = buildReport(baseInput({ ci: null, records: [identity()] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /neither was supplied/);
});

test("C3-DEV-M1-03: ci omitted with otherwise-all-PASS Stage 1A-1E records still cannot reach READY -- the exact reviewer reproduction", () => {
  const r = buildReport(baseInput({
    ci: undefined,
    records: [identity(), genericRecord("1B.MARKDOWN", "1B", "PASS"), genericRecord("1E.DOMAIN.X", "1E", "PASS")],
  }));
  assert.equal(r.ok, false);
  assert.notEqual(r.ok && r.report && r.report.readiness.state, "READY");
});

test("C3-DEV-M1-04: ci null with otherwise-all-PASS records -- same rejection", () => {
  const r = buildReport(baseInput({ ci: null, records: [identity(), genericRecord("1B.MARKDOWN", "1B", "PASS")] }));
  assert.equal(r.ok, false);
});

test("C3-DEV-M1-05: explicit Phase 1 NOT_COLLECTED remains NOT_READY (unaffected by this corrective)", () => {
  const r = buildReport(baseInput({ ci: { state: "NOT_COLLECTED" }, records: [identity()] }));
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "NOT_READY");
});

test("C3-DEV-M1-06: exactly one valid Phase 2 1F.CI record is accepted, subject to all other canonical requirements", () => {
  // Corrective C4 (W4-C2R-DEV-M2): a sparse {classification:"CLEAN_FIRST_PASS"}
  // record (this test's original fixture) is no longer a valid positive case --
  // it is exactly the reproduced defect (see C4-M2-01/02 below). A genuine
  // positive Phase 2 record requires the complete CI-run evidence contract.
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "READY");
});

test("C3-DEV-M1-07: duplicate 1F.CI records are rejected (pre-existing DEV-C2-14 coverage, reconfirmed here under the DEV-M1 numbering)", () => {
  const r = finalize([ciRecord({ classification: "CLEAN_FIRST_PASS" }), ciRecord({ classification: "FAIL" }, { status: "FAIL", reasonCode: "CI_REQUIRED_JOB_FAILED" })]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /more than one 1F\.CI record/);
});

test("C3-DEV-M1-08: a Phase 1 marker plus a collected record is rejected (pre-existing DEV-C1-14 coverage, reconfirmed here)", () => {
  const r = buildReport(baseInput({ ci: { state: "NOT_COLLECTED" }, records: [identity(), ciRecord({ classification: "CLEAN_FIRST_PASS" })] }));
  assert.equal(r.ok, false);
});

test("C3-DEV-M1-09: a wrong-subject 1F.CI record is rejected", () => {
  const wrongSubject = { ...subject, head: "b".repeat(40) };
  const r = finalize([ciRecord({ classification: "CLEAN_FIRST_PASS" }, { subject: wrongSubject })]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /subject differs/);
});

test("C3-DEV-M1-10: empty records[] alone (no CI, no Phase 1 marker) never accidentally succeeds", () => {
  const r = buildReport(baseInput({ ci: undefined, records: [] }));
  assert.equal(r.ok, false);
});

// ======================================================================
// Corrective C3 (W4-C2R-DEV-M2): CI-run externalEvidence completeness
// ======================================================================

const { computeCiRunDigest, ciRunSourceObjectId } = require("./ci-evidence");

const runObserved = (overrides = {}) => ({
  classification: "CLEAN_FIRST_PASS", repository: "TarasovArtem/qa-ai-agent", workflowPath: ".github/workflows/cypress.yml",
  runId: "42", event: "pull_request", attempt: 1, status: "completed", requiredJobs: ["Unit tests"],
  missing: [], failed: [], pending: [], skipped: [], attemptHistory: [], ...overrides,
});
const runDigestOf = (o) => computeCiRunDigest({
  repository: o.repository, workflowPath: o.workflowPath, runId: o.runId, event: o.event, headSha: subject.head,
  attempt: o.attempt, status: o.status, requiredJobs: o.requiredJobs, missing: o.missing, failed: o.failed, pending: o.pending, skipped: o.skipped,
  attemptHistory: o.attemptHistory,
});
const runEvidenceFor = (o, overrides = {}) => ({
  sourceObjectId: ciRunSourceObjectId({ repository: o.repository, runId: o.runId }), sourceVersion: String(o.attempt),
  contentDigest: runDigestOf(o), collectedAt: "t", immutability: "MUTABLE", ...overrides,
});

test("C3-DEV-M2-01: a CLEAN_FIRST_PASS record with matching CI-run externalEvidence is accepted and reaches READY", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "READY");
});

test("C3-DEV-M2-02: a finalized report with full run-evidence fields but NO CI-run externalEvidence entry is rejected", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /exactly one CI-run externalEvidence entry/);
});

test("C3-DEV-M2-03: wrong-repository CI-run evidence (a different repository's ci-run: entry) is rejected", () => {
  const o = runObserved();
  const wrong = runEvidenceFor(runObserved({ repository: "someone-else/other-repo" }));
  const r = finalize([ciRecord(o)], { externalEvidence: [wrong] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /exactly one CI-run externalEvidence entry/);
});

test("C3-DEV-M2-04/05: wrong-HEAD and wrong-run CI evidence are rejected", () => {
  const o = runObserved();
  const wrongRun = runEvidenceFor(runObserved({ runId: "99" }));
  const r1 = finalize([ciRecord(o)], { externalEvidence: [wrongRun] });
  assert.equal(r1.ok, false, "wrong run");
  // "Wrong HEAD" for CI-run evidence is expressed as a digest mismatch, because
  // the digest binds to record.subject.head (there is no separate headSha field
  // in the canonical entry or the observed payload -- see report.js's comment).
  const wrongHeadDigest = { ...runEvidenceFor(o), contentDigest: "f".repeat(64) };
  const r2 = finalize([ciRecord(o)], { externalEvidence: [wrongHeadDigest] });
  assert.equal(r2.ok, false, "wrong head (digest mismatch)");
  assert.match(r2.reason, /digest does not match/);
});

test("C3-DEV-M2-06: wrong-attempt (version) evidence is rejected", () => {
  const o = runObserved();
  const wrongVersion = { ...runEvidenceFor(o), sourceVersion: "99" };
  const r = finalize([ciRecord(o)], { externalEvidence: [wrongVersion] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /version does not match the represented attempt/);
});

test("C3-DEV-M2-14: a partial/incomplete set of run-evidence observed fields is rejected outright (never silently treated as absent)", () => {
  const r = finalize([ciRecord({ classification: "CLEAN_FIRST_PASS", repository: "o/r" })]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /run-evidence fields are incomplete/);
});

test("C3-DEV-M2-16/17: a changed digest or version between the record and its externalEvidence entry is rejected (this is the report-boundary consistency half of design section 25a; decision-time revalidation itself is kernel/revalidation.js's job, exercised in two-phase.test.js)", () => {
  const o = runObserved();
  const badDigest = { ...runEvidenceFor(o), contentDigest: "0".repeat(64) };
  assert.equal(finalize([ciRecord(o)], { externalEvidence: [badDigest] }).ok, false);
});

test("C3-DEV-M2-11/12: CI-run evidence must be MUTABLE -- VERIFIED_PROVIDER or VERIFIED_CRYPTO is rejected even with an otherwise-correct entry", () => {
  const o = runObserved();
  for (const immutability of ["VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]) {
    const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o, { immutability })] });
    assert.equal(r.ok, false, immutability);
    assert.match(r.reason, /must be MUTABLE/);
  }
});

test("C3-DEV-M2-20: an accepted determination's externalEvidence entry cannot substitute for the mandatory CI-run entry (they are distinct sources, matched by distinct sourceObjectId namespaces)", () => {
  const o = runObserved();
  const determinationOnly = evidenceEntry(); // sourceObjectId "comment-1" -- not a ci-run: entry
  const r = finalize([ciRecord(o)], { externalEvidence: [determinationOnly] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /exactly one CI-run externalEvidence entry/);
});

test("C3-DEV-M2-24: two CI-run evidence entries claiming the SAME sourceObjectId (ambiguous identity) are rejected, never silently resolved by picking one", () => {
  const o = runObserved();
  const entry = runEvidenceFor(o);
  const decoy = { ...entry, contentDigest: "9".repeat(64) };
  const r = finalize([ciRecord(o)], { externalEvidence: [entry, decoy] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /exactly one CI-run externalEvidence entry/);
});

test("C3-DEV-M2-25: normal first-pass classification with correct CI-run evidence remains fully functional end to end", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
  assert.equal(r.report.overallStatus, "PASS");
});

// W4-C2R-INFO-2: CLEAN_FIRST_PASS internal-consistency check (a narrow
// sanity check on the record's own canonical fields, not a second classifier).

test("W4-C2R-INFO-2: a CLEAN_FIRST_PASS record claiming attempt > 1, a non-empty attempt history, or a non-empty missing/failed/pending list is rejected as internally inconsistent", () => {
  const attemptTwo = runObserved({ attempt: 2 });
  assert.equal(finalize([ciRecord(attemptTwo)], { externalEvidence: [runEvidenceFor(attemptTwo)] }).ok, false, "attempt 2");
  const withHistory = runObserved({ attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }] });
  assert.equal(finalize([ciRecord(withHistory)], { externalEvidence: [runEvidenceFor(withHistory)] }).ok, false, "non-empty history");
  const withFailed = runObserved({ failed: ["Unit tests"] });
  assert.equal(finalize([ciRecord(withFailed)], { externalEvidence: [runEvidenceFor(withFailed)] }).ok, false, "non-empty failed");
  const withMissing = runObserved({ missing: ["Cypress"] });
  assert.equal(finalize([ciRecord(withMissing)], { externalEvidence: [runEvidenceFor(withMissing)] }).ok, false, "non-empty missing");
});

test("a genuinely consistent CLEAN_FIRST_PASS record (attempt 1, empty history, empty missing/failed/pending) is accepted", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
});

// ======================================================================
// Corrective C7 (Shape C self-consistency): the CLEAN_FIRST_PASS-only
// internal-consistency check above (W4-C2R-INFO-2) left the other three
// completed-run classifications (FAIL, INCOMPLETE, HUMAN_REVIEW_REQUIRED)
// unchecked -- a record could, for example, declare FAIL with every job
// outcome list empty, an impossible state per ci-classify.js's own decision
// table. Extended with the identical narrow, non-classifying pattern.
// ======================================================================

function failRecord(overrides) {
  return ciRecord(runObserved({ classification: "FAIL", ...overrides }), { status: "FAIL", reasonCode: "CI_REQUIRED_JOB_FAILED" });
}
function incompleteRecord(overrides) {
  return ciRecord(runObserved({ classification: "INCOMPLETE", ...overrides }), { status: "INCOMPLETE", reasonCode: "CI_REQUIRED_JOB_INCOMPLETE" });
}
function humanReviewRecord(overrides) {
  return ciRecord(runObserved({ classification: "HUMAN_REVIEW_REQUIRED", attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "success", failedJobs: [] }], ...overrides }), { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "CI_UNEXPLAINED_RERUN" });
}

test("C7-SHAPEC-01: a genuinely consistent FAIL record (empty missing/pending, non-empty failed) is accepted", () => {
  const record = failRecord({ failed: ["Unit tests"] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, true);
});

test("C7-SHAPEC-02: a genuinely consistent FAIL record (empty missing/pending/failed, non-empty skipped) is accepted", () => {
  const record = failRecord({ skipped: ["Unit tests"] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, true);
});

test("C7-SHAPEC-03: FAIL is inconsistent with a non-empty missing-jobs list -- an incomplete run classifies INCOMPLETE, not FAIL", () => {
  const record = failRecord({ missing: ["Unit tests"] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /FAIL is inconsistent with a non-empty missing-jobs list/);
});

test("C7-SHAPEC-04: FAIL is inconsistent with a non-empty pending-jobs list -- an incomplete run classifies INCOMPLETE, not FAIL", () => {
  const record = failRecord({ pending: ["Unit tests"] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /FAIL is inconsistent with a non-empty pending-jobs list/);
});

test("C7-SHAPEC-05: FAIL with every job outcome list empty (an impossible state -- nothing failed, missing, pending or skipped) is rejected", () => {
  const record = failRecord({});
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /FAIL requires at least one failed or skipped required job/);
});

test("C7-SHAPEC-06: a genuinely consistent INCOMPLETE record (non-empty missing) is accepted", () => {
  const record = incompleteRecord({ missing: ["Unit tests"] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, true);
});

test("C7-SHAPEC-07: a genuinely consistent INCOMPLETE record (non-empty pending) is accepted", () => {
  const record = incompleteRecord({ pending: ["Unit tests"] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, true);
});

test("C7-SHAPEC-08: INCOMPLETE with every job outcome list empty (nothing actually missing or pending) is rejected", () => {
  const record = incompleteRecord({});
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /INCOMPLETE requires at least one missing or pending required job/);
});

test("C7-SHAPEC-09: a genuinely consistent HUMAN_REVIEW_REQUIRED record (rerun via attempt > 1, every job outcome list empty) is accepted", () => {
  const record = humanReviewRecord({});
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, true);
});

test("C7-SHAPEC-10: a genuinely consistent HUMAN_REVIEW_REQUIRED record (rerun via a non-empty attempt history, attempt still 1) is accepted", () => {
  const record = humanReviewRecord({ attempt: 1, attemptHistory: [{ attempt: 1, conclusion: "success", failedJobs: [] }] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, true);
});

test("C7-SHAPEC-11: HUMAN_REVIEW_REQUIRED with attempt 1 and no attempt history (no rerun occurred) is rejected", () => {
  const record = humanReviewRecord({ attempt: 1, attemptHistory: [] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /HUMAN_REVIEW_REQUIRED requires a rerun/);
});

test("C7-SHAPEC-12: HUMAN_REVIEW_REQUIRED is inconsistent with a non-empty failed-jobs list", () => {
  const record = humanReviewRecord({ failed: ["Unit tests"] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /HUMAN_REVIEW_REQUIRED is inconsistent with a non-empty failed-jobs list/);
});

test("C7-SHAPEC-13: HUMAN_REVIEW_REQUIRED is inconsistent with a non-empty missing-jobs list", () => {
  const record = humanReviewRecord({ missing: ["Unit tests"] });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(record.observed)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /HUMAN_REVIEW_REQUIRED is inconsistent with a non-empty missing-jobs list/);
});

// ======================================================================
// Corrective C3 (W4-C2R-DEV-L1): phase / finalized consistency
// ======================================================================

test("C3-DEV-L1-01: trustedContext.phase 1 with ci omitted (finalized-shaped input) is rejected", () => {
  const o = runObserved();
  const r = buildReport(baseInput({ ci: undefined, trustedContext: trustedContext({ phase: 1 }), records: [identity(), ciRecord(o)], externalEvidence: [runEvidenceFor(o)] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /Phase 1 requires the explicit/);
});

test("C3-DEV-L1-02: phase 1 with a collected CI record present (via omitted ci) is rejected -- same check, restated for the collected-record case", () => {
  const o = runObserved();
  const r = buildReport(baseInput({
    ci: undefined, trustedContext: trustedContext({ phase: 1 }), records: [identity(), ciRecord(o)], externalEvidence: [runEvidenceFor(o)],
  }));
  assert.equal(r.ok, false);
});

test("C3-DEV-L1-03: phase 1 with the explicit NOT_COLLECTED marker remains NOT_READY (the valid Phase 1 shape)", () => {
  const r = buildReport(baseInput({ ci: { state: "NOT_COLLECTED" }, trustedContext: trustedContext({ phase: 1 }), records: [identity()] }));
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "NOT_READY");
});

test("C3-DEV-L1-04: phase 2 with valid collected CI and externalEvidence is accepted", () => {
  const o = runObserved();
  const r = buildReport(baseInput({
    ci: undefined, trustedContext: trustedContext({ phase: 2 }), records: [identity(), ciRecord(o)], externalEvidence: [runEvidenceFor(o)],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "READY");
});

test("C3-DEV-L1-05: phase 2 without mandatory CI evidence cannot reach READY (restates DEV-M1 under the phase-2-declared case)", () => {
  const r = buildReport(baseInput({ ci: undefined, trustedContext: trustedContext({ phase: 2 }), records: [identity()] }));
  assert.equal(r.ok, false);
});

test("C3-DEV-L1-06: mixed-phase records (ci NOT_COLLECTED marker plus a collected record) are rejected regardless of the declared phase", () => {
  const clean = ciRecord({ classification: "CLEAN_FIRST_PASS" });
  for (const phase of [1, 2]) {
    const r = buildReport(baseInput({ ci: { state: "NOT_COLLECTED" }, trustedContext: trustedContext({ phase }), records: [identity(), clean] }));
    assert.equal(r.ok, false, `phase ${phase}`);
  }
});

test("C3-DEV-L1-07: the final report's trustedContext.phase agrees with its own finalized and ci fields for both valid shapes", () => {
  const p1 = buildReport(baseInput({ ci: { state: "NOT_COLLECTED" }, trustedContext: trustedContext({ phase: 1 }), records: [identity()] }));
  assert.equal(p1.report.trustedContext.phase, 1);
  assert.equal(p1.report.finalized, false);
  assert.deepEqual(p1.report.ci, { state: "NOT_COLLECTED" });

  const o = runObserved();
  const p2 = buildReport(baseInput({
    ci: undefined, trustedContext: trustedContext({ phase: 2 }), records: [identity(), ciRecord(o)], externalEvidence: [runEvidenceFor(o)],
  }));
  assert.equal(p2.report.trustedContext.phase, 2);
  assert.equal(p2.report.finalized, true);
  assert.equal(p2.report.ci.classification, "CLEAN_FIRST_PASS");
});

// ======================================================================
// Corrective C3 (W4-C2R-SEC-L1): single input snapshot (TOCTOU elimination)
// ======================================================================
//
// The independent C2 re-review reproduced: a 1F.CI record's `observed` object
// exposing a getter for `classification` that returns "CLEAN_FIRST_PASS" the
// first time it is read (validation) and "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN"
// the second time (projection into report.ci) -- validating one value and
// publishing another. cloneJson() at the buildReport() boundary reads every
// property exactly once, so this is no longer reachable.

function getterRecord(reads, baseObserved) {
  // Corrective C4: the record must be a genuinely valid, complete CI-run-shaped
  // record (see W4-C2R-DEV-M2) for validation to proceed far enough for a
  // getter-based TOCTOU on `classification` to matter at all -- a sparse
  // record would simply be rejected outright before either read could occur.
  const observed = { ...baseObserved };
  delete observed.classification;
  Object.defineProperty(observed, "classification", { enumerable: true, get: () => reads.shift() });
  return { checkId: "1F.CI", ownerStage: "1F", status: "PASS", subject, observed, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] };
}

test("C3-SEC-L1-01/02/03: a classification getter that would return a different, more privileged value on a second read is neutralized -- cloneJson() reads it exactly once, so the record is validated and published against the SAME (first) value", () => {
  // If this were still a two-read TOCTOU, the queue [CLEAN_FIRST_PASS, PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN]
  // would let validation see the safe value and projection see the privileged one. With a single snapshot
  // read, only the FIRST queued value is ever observed, and it alone determines both validation and ci.
  const o = runObserved();
  const reads = ["CLEAN_FIRST_PASS", "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN"];
  const r = finalize([getterRecord(reads, o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
  assert.equal(r.report.ci.classification, "CLEAN_FIRST_PASS");
  assert.equal(r.report.overallStatus, "PASS");
  // the getter must have been consulted exactly once (one value left unconsumed), proving no second read occurred
  assert.equal(reads.length, 1);
});

test("C3-SEC-L1-04: mutating a caller-held nested object (records[], externalEvidence[]) after calling buildReport() never changes the returned report", () => {
  const o = runObserved();
  const records = [identity(), ciRecord(o)];
  const externalEvidence = [runEvidenceFor(o)];
  const r = finalize(records.slice(1), { records: [identity(), ciRecord(o)], externalEvidence });
  const before = JSON.stringify(r.report);
  records[0].status = "FAIL";
  externalEvidence[0].contentDigest = "0".repeat(64);
  assert.equal(JSON.stringify(r.report), before);
});

test("C3-SEC-L1-05: a cyclic object anywhere in the input fails closed (CONFIGURATION_ERROR-shaped rejection), never a partial report", () => {
  const cyclic = { checkId: "1F.CI", ownerStage: "1F", status: "PASS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] };
  cyclic.observed.self = cyclic;
  const r = buildReport(phase2Input({ records: [identity(), cyclic] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /cyclic/);
});

test("C3-SEC-L1-06: a BigInt anywhere in a required plain-data object fails closed", () => {
  const withBigInt = { checkId: "1F.CI", ownerStage: "1F", status: "PASS", subject, observed: { classification: "CLEAN_FIRST_PASS", n: 10n }, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] };
  const r = buildReport(phase2Input({ records: [identity(), withBigInt] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /BigInt/);
});

test("C3-SEC-L1-07: a malformed toJSON() response on a supplied record cannot produce READY -- its result is validated downstream like any other shape, never trusted merely because it came from toJSON()", () => {
  const record = { toJSON: () => ({ checkId: "1F.CI", ownerStage: "1F", status: "PASS" }) }; // missing subject/observed/etc.
  const r = buildReport(phase2Input({ records: [identity(), record] }));
  assert.equal(r.ok, false);
});

test("C3-SEC-L1-08: JSON (report.records[].observed) and the projected report.ci never disagree about the accepted classification", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
  const rec = r.report.records.find((x) => x.checkId === "1F.CI");
  assert.equal(rec.observed.classification, r.report.ci.classification);
});

test("C3-SEC-L1-09: a stable, valid plain-data object (no getters, no toJSON) preserves existing behavior exactly", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "READY");
});

test("C3-SEC-L1-10: kernel aggregation consumes the validated snapshot, not the original mutable records array -- a mutation to the original array after the call never changes counts/readiness", () => {
  const records = [identity()];
  const r = buildReport(baseInput({ records }));
  const beforeCounts = JSON.stringify(r.report.counts);
  records.push(genericRecord("1B.MARKDOWN", "1B", "FAIL"));
  assert.equal(JSON.stringify(r.report.counts), beforeCounts);
});

// ======================================================================
// Corrective C4 -- mandatory regression matrix (mission section 17)
// ======================================================================
//
// Many of these properties are already exercised above (C3-DEV-M2-*,
// W4-C2R-INFO-2, C3-SEC-L1-*); this section adds the specific C4-numbered
// cases not already covered under another name, plus the four newly closed
// findings (W4-C3R-DEV-L1 malformed-type validation, W4-C3R-SEC-L1 trusted-
// context binding, W4-C3R-INFO-3 unrelated-evidence rejection).

test("C4-M2-01/02: a sparse {classification:\"CLEAN_FIRST_PASS\"} record (the exact original W4-C2R-DEV-M2 reproduction) is rejected, and can never reach READY", () => {
  const r = finalize([ciRecord({ classification: "CLEAN_FIRST_PASS" })]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /does not match a permissible shape/);
});

test("C4-M2-09: an unrelated extra CI-run externalEvidence entry (for a different run) makes the report ambiguous and is rejected, even when the correct entry is ALSO present", () => {
  const o = runObserved();
  const correct = runEvidenceFor(o);
  const unrelated = runEvidenceFor(runObserved({ runId: "999" }));
  const r = finalize([ciRecord(o)], { externalEvidence: [correct, unrelated] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /exactly one CI-run externalEvidence entry/);
});

test("C4-M2-10: an empty revalidation items list cannot be used to justify a READY report whose CI evidence was mandatory -- buildReport() itself requires the matching evidence independently of any revalidation outcome", () => {
  // revalidateEvidence({items: []}) trivially returns PASS (nothing to check) --
  // but that is a DIFFERENT, later concern (design section 25a decision-time
  // freshness) from buildReport()'s own mandatory-evidence requirement at
  // report-assembly time. A report missing its CI-run evidence is rejected by
  // buildReport() itself, regardless of what any revalidation call would say.
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /exactly one CI-run externalEvidence entry/);
});

test("C4-M2-11/12: a real completed failed run remains FAIL, and a real completed unexplained rerun remains HUMAN_REVIEW_REQUIRED, each with matching CI-run evidence", () => {
  const failed = runObserved({ classification: "FAIL", failed: ["Unit tests"] });
  const rFail = finalize([ciRecord(failed, { status: "FAIL", reasonCode: "CI_REQUIRED_JOB_FAILED" })], { externalEvidence: [runEvidenceFor(failed)] });
  assert.equal(rFail.ok, true);
  assert.equal(rFail.report.overallStatus, "FAIL");
  assert.notEqual(rFail.report.readiness.state, "READY");

  const rerun = runObserved({ classification: "HUMAN_REVIEW_REQUIRED", attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }] });
  const rRerun = finalize([ciRecord(rerun, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "CI_UNEXPLAINED_RERUN" })], { externalEvidence: [runEvidenceFor(rerun)] });
  assert.equal(rRerun.ok, true);
  assert.equal(rRerun.report.readiness.state, "HUMAN_REVIEW_REQUIRED");
});

// ---------------------------------------------------------------- C4-L1: runtime type validation before hashing (W4-C3R-DEV-L1)

test("C4-L1-01/02: requiredJobs as a number or a string fails cleanly (canonical rejection, never a thrown TypeError from computeCiRunDigest())", () => {
  for (const requiredJobs of [5, "abc"]) {
    const o = runObserved({ requiredJobs });
    assert.doesNotThrow(() => finalize([ciRecord(o)], { externalEvidence: [] }));
    const r = finalize([ciRecord(o)], { externalEvidence: [] });
    assert.equal(r.ok, false, JSON.stringify(requiredJobs));
    assert.match(r.reason, /malformed or out of bounds/);
  }
});

test("C4-L1-03: missing:null fails cleanly", () => {
  const o = runObserved({ missing: null });
  assert.doesNotThrow(() => finalize([ciRecord(o)], { externalEvidence: [] }));
  const r = finalize([ciRecord(o)], { externalEvidence: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /malformed or out of bounds/);
});

// Corrective C5 (W4-C4R-AQA-INFO-1): C4-L1-04/05/06 originally passed
// `externalEvidence: []`, so the evidence-count check rejected every case before
// computeCiRunDigest() could ever run -- removing isValidCiRunIdentity() left
// them green. Each malformed case below now carries the CI-run evidence entry of
// the VALID baseline run (same repository/runId/attempt, so sourceObjectId and
// sourceVersion match and the evidence-count check passes); only the target
// field is malformed. isValidCiRunIdentity() must therefore be the first
// substantive rejection: without it the record reaches computeCiRunDigest()
// (a thrown TypeError, or a "digest does not match" rejection), and the exact
// reason assertion below fails either way.
const baselineRunEvidence = () => runEvidenceFor(runObserved());

function assertRunEvidenceMalformedRejection(observed, label) {
  let r;
  try {
    r = finalize([ciRecord(observed)], { externalEvidence: [baselineRunEvidence()] });
  } catch (err) {
    assert.fail(`${label}: buildReport() threw instead of a canonical rejection: ${err && err.message}`);
  }
  assert.equal(r.ok, false, label);
  assert.equal(r.report, null, label);
  assert.match(r.reason, /the 1F\.CI record's run-evidence fields are malformed or out of bounds/, label);
}

test("C5 control: the baseline CI-run evidence used by the malformed-input tests is accepted for the valid run (so it never masks the target check)", () => {
  const r = finalize([ciRecord(runObserved())], { externalEvidence: [baselineRunEvidence()] });
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "READY");
});

test("C4-L1-04: attemptHistory containing null, or an entry missing failedJobs, fails cleanly", () => {
  for (const attemptHistory of [[null], [{}], [{ attempt: 1, conclusion: "failure" }]]) {
    assertRunEvidenceMalformedRejection(runObserved({ attemptHistory }), JSON.stringify(attemptHistory));
  }
});

test("C4-L1-05: a malformed failedJobs entry inside attemptHistory (non-string, non-array) fails cleanly", () => {
  for (const failedJobs of [null, "x", 5, [1, 2], [null]]) {
    assertRunEvidenceMalformedRejection(runObserved({ attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs }] }), JSON.stringify(failedJobs));
  }
});

test("C4-L1-06: an oversized nested run-evidence array (beyond the canonical bound) fails cleanly, never silently truncated", () => {
  const tooManyJobs = Array.from({ length: 300 }, (_, i) => `job-${i}`);
  assertRunEvidenceMalformedRejection(runObserved({ requiredJobs: tooManyJobs }), "requiredJobs x300");
  const tooManyAttempts = Array.from({ length: 100 }, (_, i) => ({ attempt: i + 1, conclusion: "failure", failedJobs: [] }));
  assertRunEvidenceMalformedRejection(runObserved({ attemptHistory: tooManyAttempts }), "attemptHistory x100");
  const tooManyFailedJobs = Array.from({ length: 300 }, (_, i) => `job-${i}`);
  assertRunEvidenceMalformedRejection(runObserved({ attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: tooManyFailedJobs }] }), "attemptHistory[0].failedJobs x300");
});

// ---------------------------------------------------------------- Corrective C7 (W4-C6R-DEV-L2): sparse-array rejection in isValidCiRunIdentity()
//
// Reproduction first (mission section 5): the same Array.prototype.every()
// hole-skipping bug fixed in required-jobs.js also existed independently
// here -- isJobNameArray() and the top-level attemptHistory check both used
// plain `.every()` with no density guard, so a sparse `requiredJobs`,
// `missing`/`failed`/`pending`/`skipped`, or `attemptHistory` array could
// vacuously pass isValidCiRunIdentity() and reach computeCiRunDigest(). Each
// case below carries the baseline run's matching CI-run evidence (per the
// C5 rationale above) so isValidCiRunIdentity() is the first thing that can
// reject it -- these fail (report reachable, or a thrown TypeError from
// computeCiRunDigest()) without the isDenseArray() guard added in this
// corrective.

function sparseArrayWithHole(...values) {
  const a = [];
  a.length = values.length + 1;
  values.forEach((v, i) => { a[i] = v; });
  // trailing hole at the end (a[values.length] is never assigned)
  return a;
}

test("C7-L2-09: a sparse requiredJobs array (hole at the end) is rejected, never vacuously validated", () => {
  assertRunEvidenceMalformedRejection(runObserved({ requiredJobs: sparseArrayWithHole("Unit tests") }), "sparse requiredJobs");
});

test("C7-L2-10: a sparse missing/failed/pending/skipped array (hole at the end) is rejected in each field independently", () => {
  assertRunEvidenceMalformedRejection(runObserved({ missing: sparseArrayWithHole("Unit tests") }), "sparse missing");
  assertRunEvidenceMalformedRejection(runObserved({ failed: sparseArrayWithHole("Unit tests") }), "sparse failed");
  assertRunEvidenceMalformedRejection(runObserved({ pending: sparseArrayWithHole("Unit tests") }), "sparse pending");
  assertRunEvidenceMalformedRejection(runObserved({ skipped: sparseArrayWithHole("Unit tests") }), "sparse skipped");
});

test("C7-L2-11: a sparse attemptHistory array (hole at the end, so .every() never visits the hole) is rejected", () => {
  assertRunEvidenceMalformedRejection(runObserved({ attemptHistory: sparseArrayWithHole({ attempt: 1, conclusion: "failure", failedJobs: [] }) }), "sparse attemptHistory");
});

test("C7-L2-12: a sparse failedJobs array nested inside a well-formed attemptHistory entry is rejected", () => {
  const sparseFailedJobs = sparseArrayWithHole("Unit tests");
  assertRunEvidenceMalformedRejection(runObserved({ attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: sparseFailedJobs }] }), "sparse nested failedJobs");
});

test("C7-L2-13: a dense (non-sparse) valid record with every array field populated is still accepted -- the new guard rejects only sparse shapes, not legitimate ones", () => {
  const o = runObserved({ classification: "FAIL", failed: ["Unit tests"], attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }], attempt: 2 });
  const record = ciRecord(o, { status: "FAIL", reasonCode: "CI_REQUIRED_JOB_FAILED" });
  const r = finalize([record], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------- C4-SEC: trusted-context binding (W4-C3R-SEC-L1)

test("C4-SEC-01: a completed-run record whose repository differs from trustedContext.repositoryId is rejected", () => {
  const o = runObserved({ repository: "someone-else/other-repo" });
  const r = buildReport(phase2Input({ records: [identity(), ciRecord(o)], externalEvidence: [runEvidenceFor(o)] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /repository does not match trustedContext\.repositoryId/);
});

test("C4-SEC-02: a completed-run record whose event differs from trustedContext.eventType is rejected", () => {
  const o = runObserved({ event: "push" });
  const r = buildReport(phase2Input({ records: [identity(), ciRecord(o)], externalEvidence: [runEvidenceFor(o)] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /event does not match trustedContext\.eventType/);
});

test("C4-SEC-03: a cross-HEAD 1F.CI record (subject.head differs from the report subject) is rejected (pre-existing subject-binding coverage, reconfirmed under the C4-SEC numbering)", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o, { subject: { ...subject, head: "b".repeat(40) } })], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /subject differs/);
});

test("C4-SEC-04: matching repository, event and subject are accepted when every other requirement is also met", () => {
  const o = runObserved();
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "READY");
});

// ---------------------------------------------------------------- C4-INFO: CLEAN_FIRST_PASS semantic completeness

test("C4-INFO-01: a skipped required job cannot be CLEAN_FIRST_PASS", () => {
  const o = runObserved({ skipped: ["Unit tests"] });
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /non-empty skipped-jobs list/);
});

test("C4-INFO-03: an empty requiredJobs list cannot be CLEAN_FIRST_PASS (rejected as malformed run-evidence, not silently accepted as vacuously clean)", () => {
  const o = runObserved({ requiredJobs: [] });
  const r = finalize([ciRecord(o)], { externalEvidence: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /malformed or out of bounds/);
});

test("C4-INFO-04: attempt 2 cannot be CLEAN_FIRST_PASS (pre-existing W4-C2R-INFO-2 coverage, reconfirmed under the C4-INFO numbering)", () => {
  const o = runObserved({ attempt: 2 });
  const r = finalize([ciRecord(o)], { externalEvidence: [runEvidenceFor(o)] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /attempt other than 1/);
});

// ======================================================================
// Corrective C5 (W4-C4R-AQA-L1): mutation-sensitive coverage of the
// "PASS-mapped classification requires the complete CI-run evidence contract"
// guard in validateCollectedCiRecord(). A pre-completion record whose key set
// legitimately matches shape A ({classification, collected:false, reason}) or
// shape B ({classification, collected:true, status}) passes the shape check, so
// at the time this guard was added (Corrective C4), it was the ONLY thing
// standing between a PASS claim on such a record and READY with zero CI-run
// evidence; the C4 re-review showed that deleting it alone left the whole
// suite green.
//
// CORRECTIVE C7 (AQA-INFO-3a): that "fails if removed" claim is now stale on
// its own -- Corrective C6 added a second, shape-specific classification
// guard (immediately below, in the isShapeA/isShapeB block of
// validateCollectedCiRecord()) that ALSO independently rejects a shape A/B
// CLEAN_FIRST_PASS claim, and it fires first for those shapes. Disabling
// only this older generic guard no longer fails C5-AQA-L1-01/02 by itself,
// because the newer guard still catches the same case (verified by this
// corrective's own mutation testing). `PASS_GUARD_REASON` below accepts
// either guard's rejection message for exactly this reason: these tests stay
// mutation-sensitive to EITHER guard being removed, but no single guard's
// removal is any longer guaranteed, on its own, to fail this specific test.
// ======================================================================

const stagePassRecords = () => [identity(), genericRecord("1B.MARKDOWN", "1B", "PASS"), genericRecord("1C.EVIDENCE", "1C", "PASS"), genericRecord("1D.CONSISTENCY", "1D", "PASS"), genericRecord("1E.DELTA", "1E", "PASS")];
const phase2WithStages = (ci, externalEvidence) => buildReport(phase2Input({ records: [...stagePassRecords(), ci], externalEvidence }));
// Corrective C6 (W4-C4R-INFO-3): a shape-A/B record now also carries its OWN,
// more specific classification guard (added in report.js's Shape A/B
// semantic-consistency block), which fires BEFORE the older generic
// "PASS-mapped classification requires the complete CI-run evidence
// contract" guard these tests originally asserted verbatim. Both guards
// independently prevent the exact same outcome (a pre-completion PASS claim
// reaching READY) -- the new one is a strict superset for shape A/B (it
// rejects EVERY non-FAIL/non-INCOMPLETE classification, not just PASS-mapped
// ones), so accepting either message preserves this test's mutation-killing
// property against either guard being removed while the other still stands.
const PASS_GUARD_REASON = /^invalid 1F\.CI record: (a PASS-mapped classification requires the complete CI-run evidence contract|a pre-completion fetch-failure record can only classify FAIL or INCOMPLETE|a pre-completion not-yet-completed record can only classify INCOMPLETE)$/;

function assertPassGuardRejection(observed, label) {
  let r;
  try {
    r = phase2WithStages(ciRecord(observed, { status: "PASS", reasonCode: "OK" }), []);
  } catch (err) {
    assert.fail(`${label}: buildReport() threw instead of a canonical rejection: ${err && err.message}`);
  }
  assert.equal(r.ok, false, `${label}: a pre-completion PASS claim must never produce a report (READY reachable)`);
  assert.equal(r.report, null, label);
  assert.match(r.reason, PASS_GUARD_REASON, label);
}

test("C5 control: the Phase 2 context used by C5-AQA-L1-* is otherwise valid (a complete CLEAN_FIRST_PASS reaches READY in it)", () => {
  const o = runObserved();
  const r = phase2WithStages(ciRecord(o), [runEvidenceFor(o)]);
  assert.equal(r.ok, true);
  assert.equal(r.report.trustedContext.phase, 2);
  assert.equal(r.report.readiness.state, "READY");
});

test("C5-AQA-L1-01: a pre-run/fetch-failure CI record cannot claim PASS or produce READY", () => {
  assertPassGuardRejection({ classification: "CLEAN_FIRST_PASS", collected: false, reason: "X" }, "shape A CLEAN_FIRST_PASS");
});

test("C5-AQA-L1-02: an unfinished CI run cannot claim PASS or produce READY", () => {
  for (const status of ["in_progress", "queued", "waiting"]) {
    assertPassGuardRejection({ classification: "CLEAN_FIRST_PASS", collected: true, status }, `shape B CLEAN_FIRST_PASS ${status}`);
  }
});

test("C5-AQA-L1-03 (positive control): an unfinished CI run correctly represented as INCOMPLETE is accepted as a NOT_READY Phase 2 report", () => {
  for (const status of ["in_progress", "queued", "waiting"]) {
    const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: true, status }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), []);
    assert.equal(r.ok, true, status);
    assert.equal(r.report.overallStatus, "INCOMPLETE", status);
    assert.equal(r.report.readiness.state, "NOT_READY", status);
    assert.deepEqual(r.report.externalEvidence, [], status);
    assert.deepEqual(r.report.ci, { classification: "INCOMPLETE" }, status);
    assert.equal(r.report.records.find((rec) => rec.checkId === "1F.CI").status, "INCOMPLETE", status);
  }
});

test("C5-AQA-L1-04 (positive control): a pre-run/fetch-failure CI record correctly represented as INCOMPLETE is accepted as a NOT_READY Phase 2 report", () => {
  const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: false, reason: "SOURCE_UNREACHABLE" }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), []);
  assert.equal(r.ok, true);
  assert.equal(r.report.overallStatus, "INCOMPLETE");
  assert.equal(r.report.readiness.state, "NOT_READY");
  assert.deepEqual(r.report.externalEvidence, []);
});

// ======================================================================
// Corrective C6 (W4-C4R-INFO-3): Shape A / Shape B semantic consistency.
// Matching a shape by KEY SET alone was not enough -- a record could match
// shape A or B while claiming a classification/reasonCode combination the
// real collector (stages/1f/ci-evidence.js) never produces for that shape
// (e.g. shape A + HUMAN_REVIEW_REQUIRED), or carry an unrelated CI-run
// externalEvidence entry despite representing no completed, pinned run.
// None of these could themselves reach READY (contract.status still had to
// match the classification), but they misrepresented collector semantics.
// ======================================================================

function fixedEvidenceEntry() {
  return { sourceObjectId: "ci-run:o/r:99", sourceVersion: "1", contentDigest: "a".repeat(64), collectedAt: "t", immutability: "MUTABLE" };
}

test("C6-INFO3-01: shape A with an authorized INCOMPLETE fetch-failure result is accepted as NOT_READY", () => {
  const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: false, reason: "SOURCE_UNREACHABLE" }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), []);
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "NOT_READY");
});

test("C6-INFO3-02: shape A with a valid wrong-identity FAIL result is accepted as NOT_READY", () => {
  const r = phase2WithStages(ciRecord({ classification: "FAIL", collected: false, reason: "WRONG_REPOSITORY" }, { status: "FAIL", reasonCode: "CI_NOT_COLLECTED" }), []);
  assert.equal(r.ok, true);
  assert.notEqual(r.report.readiness.state, "READY");
});

test("C6-INFO3-03: shape A with HUMAN_REVIEW_REQUIRED is rejected (the real collector never produces this shape/classification combination)", () => {
  // record.status must equal HUMAN_REVIEW_REQUIRED to satisfy the outer
  // classification-contract check and actually reach the shape-A semantic guard.
  const r = phase2WithStages(ciRecord({ classification: "HUMAN_REVIEW_REQUIRED", collected: false, reason: "SOURCE_UNREACHABLE" }, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "CI_UNEXPLAINED_RERUN" }), []);
  assert.equal(r.ok, false);
  assert.match(r.reason, /can only classify FAIL or INCOMPLETE/);
});

test("C6-INFO3-04: shape A with a malformed (non-string) reason is rejected", () => {
  const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: false, reason: 42 }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), []);
  assert.equal(r.ok, false);
  assert.match(r.reason, /fetch-failure reason is malformed/);
});

test("C6-INFO3-05: shape A with an inconsistent reasonCode (not CI_NOT_COLLECTED) is rejected", () => {
  const r = phase2WithStages(ciRecord({ classification: "FAIL", collected: false, reason: "WRONG_REPOSITORY" }, { status: "FAIL", reasonCode: "CI_REQUIRED_JOB_FAILED" }), []);
  assert.equal(r.ok, false);
  assert.match(r.reason, /must carry reasonCode CI_NOT_COLLECTED/);
});

// Corrective C7 (W4-C6R-INFO-1): the real collector
// (ci-evidence.js#collectCiEvidence()) derives shape A's classification from
// `runResult.reason.startsWith("WRONG_")` alone -- a WRONG_* reason always
// means FAIL, every other reason always means INCOMPLETE. C6-INFO3-01/02
// above already cover the two CONSISTENT pairings as positive controls; the
// four tests below cover the two INCONSISTENT pairings the real collector
// never produces, which report.js could not previously distinguish (it only
// checked "classification is FAIL or INCOMPLETE", not which one the
// specific reason implies).

test("C7-INFO1-01: shape A with a WRONG_* reason but classification INCOMPLETE is rejected -- the real collector always classifies a WRONG_* reason FAIL", () => {
  const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: false, reason: "WRONG_SHA" }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), []);
  assert.equal(r.ok, false);
  assert.match(r.reason, /a WRONG_\* fetch-failure reason can only classify FAIL/);
});

test("C7-INFO1-02: shape A with a non-WRONG_* reason but classification FAIL is rejected -- the real collector always classifies a non-WRONG_* reason INCOMPLETE", () => {
  const r = phase2WithStages(ciRecord({ classification: "FAIL", collected: false, reason: "SOURCE_UNREACHABLE" }, { status: "FAIL", reasonCode: "CI_NOT_COLLECTED" }), []);
  assert.equal(r.ok, false);
  assert.match(r.reason, /a non-WRONG_\* fetch-failure reason can only classify INCOMPLETE/);
});

test("C7-INFO1-03: shape A with each of the four internal WRONG_* reasons and classification FAIL is accepted (positive controls, all four codes)", () => {
  for (const reason of ["WRONG_REPOSITORY", "WRONG_SHA", "WRONG_EVENT", "WRONG_WORKFLOW"]) {
    const r = phase2WithStages(ciRecord({ classification: "FAIL", collected: false, reason }, { status: "FAIL", reasonCode: "CI_NOT_COLLECTED" }), []);
    assert.equal(r.ok, true, reason);
  }
});

test("C7-INFO1-04: shape A with a non-WRONG_* reason (e.g. an adapter-supplied or internally-generated fetch-failure code) and classification INCOMPLETE is accepted", () => {
  for (const reason of ["SOURCE_UNREACHABLE", "NOT_FOUND", "MALFORMED_RUN_SHAPE", "NO_ADAPTER_AVAILABLE", "ADAPTER_THREW", "AMBIGUOUS_JOB_IDENTITY"]) {
    const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: false, reason }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), []);
    assert.equal(r.ok, true, reason);
  }
});

for (const status of ["queued", "waiting", "in_progress"]) {
  test(`C6-INFO3-06/07/08: shape B ${status} + INCOMPLETE is accepted`, () => {
    const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: true, status }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), []);
    assert.equal(r.ok, true, status);
    assert.equal(r.report.readiness.state, "NOT_READY", status);
  });
}

test("C6-INFO3-09: shape B + FAIL is rejected", () => {
  const r = phase2WithStages(ciRecord({ classification: "FAIL", collected: true, status: "in_progress" }, { status: "FAIL", reasonCode: "CI_NOT_COLLECTED" }), []);
  assert.equal(r.ok, false);
  assert.match(r.reason, /can only classify INCOMPLETE/);
});

test("C6-INFO3-10: shape B + HUMAN_REVIEW_REQUIRED is rejected", () => {
  const r = phase2WithStages(ciRecord({ classification: "HUMAN_REVIEW_REQUIRED", collected: true, status: "in_progress" }, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "CI_UNEXPLAINED_RERUN" }), []);
  assert.equal(r.ok, false);
  assert.match(r.reason, /can only classify INCOMPLETE/);
});

test("C6-INFO3-11: shape B + PASS is rejected (pre-existing PASS-guard coverage, reconfirmed under the C6-INFO3 numbering)", () => {
  assertPassGuardRejection({ classification: "CLEAN_FIRST_PASS", collected: true, status: "queued" }, "shape B PASS");
});

test("C6-INFO3-12: shape B with an unsupported status is rejected (matches neither shape B nor any other permissible shape)", () => {
  const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: true, status: "cancelled" }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), []);
  assert.equal(r.ok, false);
  assert.match(r.reason, /does not match a permissible shape|run-evidence fields are incomplete/);
});

test("C6-INFO3-13: shape A with unrelated CI_RUN externalEvidence is rejected", () => {
  const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: false, reason: "SOURCE_UNREACHABLE" }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), [fixedEvidenceEntry()]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /cannot carry CI-run externalEvidence/);
});

test("C6-INFO3-14: shape B with unrelated CI_RUN externalEvidence is rejected", () => {
  const r = phase2WithStages(ciRecord({ classification: "INCOMPLETE", collected: true, status: "queued" }, { status: "INCOMPLETE", reasonCode: "CI_NOT_COLLECTED" }), [fixedEvidenceEntry()]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /cannot carry CI-run externalEvidence/);
});

test("C6-INFO3-15: a correct completed CLEAN_FIRST_PASS record continues to reach READY with its matching externalEvidence", () => {
  const o = runObserved();
  const r = phase2WithStages(ciRecord(o), [runEvidenceFor(o)]);
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "READY");
});

test("C6-INFO3-16: a completed FAIL record remains FAIL", () => {
  const o = runObserved({ classification: "FAIL", failed: ["Unit tests"] });
  const r = phase2WithStages(ciRecord(o, { status: "FAIL", reasonCode: "CI_REQUIRED_JOB_FAILED" }), [runEvidenceFor(o)]);
  assert.equal(r.ok, true);
  assert.equal(r.report.overallStatus, "FAIL");
});

test("C6-INFO3-17: a completed unexplained rerun remains HUMAN_REVIEW_REQUIRED", () => {
  const o = runObserved({ classification: "HUMAN_REVIEW_REQUIRED", attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Unit tests"] }] });
  const r = phase2WithStages(ciRecord(o, { status: "HUMAN_REVIEW_REQUIRED", reasonCode: "CI_UNEXPLAINED_RERUN" }), [runEvidenceFor(o)]);
  assert.equal(r.ok, true);
  assert.equal(r.report.readiness.state, "HUMAN_REVIEW_REQUIRED");
});

test("C6-INFO3-18: a pre-completion record with a PASS claim cannot reach READY (both shape A and shape B)", () => {
  assertPassGuardRejection({ classification: "CLEAN_FIRST_PASS", collected: false, reason: "SOURCE_UNREACHABLE" }, "shape A PASS claim");
  assertPassGuardRejection({ classification: "CLEAN_FIRST_PASS", collected: true, status: "queued" }, "shape B PASS claim");
});
