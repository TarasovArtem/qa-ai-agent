"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../index");
const { record, domainRecord, SUBJECT } = require("../test-support");

test("every valid status is an accepted record status and the enum is authoritative", () => {
  for (const status of Object.values(g.STATUS)) {
    const observed = status === "NOT_APPLICABLE" ? { applicabilityProof: "mode-mismatch" } : {};
    const r = g.validateResultRecord(record({ status, observed, reasonCode: "SOME_REASON" }));
    assert.equal(r.ok, true, status);
    assert.equal(r.record.status, status);
    assert.equal("success" in r.record, false);
  }
});

test("invalid status, owner stage, subject and reason code are rejected without coercion", () => {
  for (const bad of [
    record({ status: "SUCCESS" }),
    record({ status: "pass" }),
    record({ status: true }),
    record({ ownerStage: "1G" }),
    record({ ownerStage: "2A" }),
    record({ subject: { head: "x" } }),
    record({ subject: { ...SUBJECT, head: "A".repeat(40) } }),
    record({ subject: { ...SUBJECT, range: { mode: "MANUAL", from: SUBJECT.base, to: SUBJECT.head } } }),
    record({ reasonCode: "" }),
    record({ reasonCode: "lowercase" }),
    record({ observed: undefined }),
    record({ observed: () => 1 }),
    record({ evidenceRefs: [1] }),
    record({ extra: 1 }),
    null,
    [],
    "record",
  ]) {
    const r = g.validateResultRecord(bad);
    assert.equal(r.ok, false);
    assert.equal(r.reasonCode, "RESULT_RECORD_INVALID");
  }
  const missing = record();
  delete missing.reasonCode;
  assert.equal(g.validateResultRecord(missing).ok, false);
});

test("all PASS -> READY", () => {
  const out = g.aggregate([record(), record({ checkId: "1A.TREE_MATCH" })]);
  assert.equal(out.overallStatus, "PASS");
  assert.equal(out.readiness.state, "READY");
  assert.equal(out.notAuthorization, true);
});

test("HUMAN_REVIEW_REQUIRED -> HUMAN_REVIEW_REQUIRED, never READY", () => {
  const out = g.aggregate([record(), record({ checkId: "1C.X", status: "HUMAN_REVIEW_REQUIRED", reasonCode: "NEEDS_JUDGMENT" })]);
  assert.equal(out.readiness.state, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(out.humanReviewRequired, ["1C.X"]);
});

test("INCOMPLETE, FAIL and CONFIGURATION_ERROR -> NOT_READY", () => {
  for (const status of ["INCOMPLETE", "FAIL", "CONFIGURATION_ERROR"]) {
    const out = g.aggregate([record(), record({ checkId: "1A.Z", status, reasonCode: "SOME_REASON" })]);
    assert.equal(out.readiness.state, "NOT_READY", status);
    assert.equal(out.overallStatus, status);
  }
});

test("precedence is CONFIGURATION_ERROR > FAIL > INCOMPLETE > HUMAN_REVIEW_REQUIRED > PASS and no record is hidden", () => {
  const records = [
    record({ checkId: "c.1", status: "PASS" }),
    record({ checkId: "c.2", status: "HUMAN_REVIEW_REQUIRED", reasonCode: "R_ONE" }),
    record({ checkId: "c.3", status: "INCOMPLETE", reasonCode: "R_TWO" }),
    record({ checkId: "c.4", status: "FAIL", reasonCode: "R_THREE" }),
  ];
  assert.equal(g.aggregate(records).overallStatus, "FAIL");
  const withConfig = [...records, record({ checkId: "c.5", status: "CONFIGURATION_ERROR", reasonCode: "R_FOUR" })];
  const out = g.aggregate(withConfig);
  assert.equal(out.overallStatus, "CONFIGURATION_ERROR");
  assert.equal(out.records.length, 5);
  assert.deepEqual(out.humanReviewRequired, ["c.2"]);
  assert.equal(out.counts.PASS, 1);
  assert.equal(out.counts.FAIL, 1);
  assert.equal(g.aggregate(records.slice(0, 3)).overallStatus, "INCOMPLETE");
});

test("NOT_APPLICABLE is neutral, requires a proof, and never equals PASS", () => {
  const na = record({ checkId: "1B.NA", status: "NOT_APPLICABLE", observed: { applicabilityProof: "no markdown changed" }, reasonCode: "NOT_APPLICABLE" });
  const ready = g.aggregate([record(), na]);
  assert.equal(ready.readiness.state, "READY");
  const onlyNa = g.aggregate([na]);
  assert.equal(onlyNa.readiness.state, "NOT_READY");
  assert.ok(onlyNa.kernelRecords.some((r) => r.reasonCode === "NO_PASSING_EVIDENCE"));
  const noProof = g.aggregate([record(), record({ checkId: "1B.NA", status: "NOT_APPLICABLE", observed: null, reasonCode: "NOT_APPLICABLE" })]);
  assert.equal(noProof.readiness.state, "NOT_READY");
  assert.ok(noProof.kernelRecords.some((r) => r.reasonCode === "APPLICABILITY_NOT_PROVEN"));
});

test("invalid, duplicate-id and mixed-subject records are surfaced, never dropped or repaired", () => {
  const bad = g.aggregate([record(), { nonsense: true }]);
  assert.equal(bad.readiness.state, "NOT_READY");
  assert.ok(bad.kernelRecords.some((r) => r.reasonCode === "RESULT_RECORD_INVALID"));
  const dup = g.aggregate([record(), record()]);
  assert.ok(dup.kernelRecords.some((r) => r.reasonCode === "DUPLICATE_CHECK_ID"));
  assert.equal(dup.readiness.state, "NOT_READY");
  const other = record({ checkId: "1A.OTHER", subject: { ...SUBJECT, head: "d".repeat(40) } });
  const mixed = g.aggregate([record(), other]);
  assert.ok(mixed.kernelRecords.some((r) => r.reasonCode === "SUBJECT_MISMATCH"));
  assert.equal(mixed.overallStatus, "FAIL");
  assert.equal(g.aggregate("nope").readiness.state, "NOT_READY");
  assert.equal(g.aggregate([]).readiness.state, "NOT_READY");
});

test("readiness is pure, deterministic and reproducible from records alone", () => {
  const records = [record(), record({ checkId: "1A.B", status: "HUMAN_REVIEW_REQUIRED", reasonCode: "R_ONE" })];
  const a = JSON.stringify(g.aggregate(records));
  const b = JSON.stringify(g.aggregate(JSON.parse(JSON.stringify(records))));
  assert.equal(a, b);
  assert.equal(g.exitCodeFor("PASS"), 0);
  assert.equal(g.exitCodeFor("FAIL"), 1);
  assert.equal(g.exitCodeFor("CONFIGURATION_ERROR"), 2);
  assert.equal(g.exitCodeFor("HUMAN_REVIEW_REQUIRED"), 3);
  assert.equal(g.exitCodeFor("INCOMPLETE"), 4);
});

test("caller input is not mutated and the output is frozen", () => {
  const records = [record(), record({ checkId: "1A.B" })];
  const before = JSON.stringify(records);
  const out = g.aggregate(records);
  assert.equal(JSON.stringify(records), before);
  assert.equal(Object.isFrozen(out), true);
  assert.equal(Object.isFrozen(out.records[0]), true);
  assert.notEqual(out.records[0], records[0]);
});

test("domain result completeness: exact set passes; missing, duplicate and unknown are reported", () => {
  const ok = g.aggregate([record(), domainRecord("A_DOMAIN"), domainRecord("B_DOMAIN")], { expectedDomainIds: ["A_DOMAIN", "B_DOMAIN"] });
  assert.equal(ok.readiness.state, "READY");
  const missing = g.aggregate([record(), domainRecord("A_DOMAIN")], { expectedDomainIds: ["A_DOMAIN", "B_DOMAIN"] });
  assert.ok(missing.kernelRecords.some((r) => r.reasonCode === "DOMAIN_RESULT_MISSING" && r.status === "INCOMPLETE"));
  assert.equal(missing.readiness.state, "NOT_READY");
  const dupRecords = [record(), domainRecord("A_DOMAIN"), domainRecord("A_DOMAIN", "DEEP_REVIEW_REQUIRED")];
  const dup = g.checkDomainResultCompleteness(dupRecords.slice(1), ["A_DOMAIN"], undefined, null);
  assert.ok(dup.some((r) => r.reasonCode === "DOMAIN_RESULT_DUPLICATE" && r.status === "CONFIGURATION_ERROR"));
  const unknown = g.aggregate([record(), domainRecord("A_DOMAIN"), domainRecord("Z_DOMAIN")], { expectedDomainIds: ["A_DOMAIN"] });
  assert.ok(unknown.kernelRecords.some((r) => r.reasonCode === "DOMAIN_RESULT_UNKNOWN"));
});

test("a domain-level HUMAN_REVIEW_REQUIRED reaches readiness through records[]", () => {
  const out = g.aggregate([record(), domainRecord("A_DOMAIN", "HUMAN_REVIEW_REQUIRED")], { expectedDomainIds: ["A_DOMAIN"] });
  assert.equal(out.readiness.state, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(out.humanReviewRequired, ["1E.DOMAIN.A_DOMAIN"]);
});

test("a domains[] projection that differs from the records is reported; a matching one is accepted", () => {
  const records = [record(), domainRecord("A_DOMAIN", "DEEP_REVIEW_REQUIRED")];
  const good = [{ domainId: "A_DOMAIN", effectiveLevel: "DEEP_REVIEW_REQUIRED", reasons: [], fingerprint: null }];
  assert.equal(g.aggregate(records, { expectedDomainIds: ["A_DOMAIN"], domainsProjection: good }).readiness.state, "READY");
  const bad = [{ domainId: "A_DOMAIN", effectiveLevel: "PRESERVATION_CHECK_ONLY", reasons: [], fingerprint: null }];
  const out = g.aggregate(records, { expectedDomainIds: ["A_DOMAIN"], domainsProjection: bad });
  assert.ok(out.kernelRecords.some((r) => r.reasonCode === "DOMAIN_PROJECTION_MISMATCH"));
  assert.equal(out.readiness.state, "NOT_READY");
});

test("a domain result whose status contradicts its effective level is invalid", () => {
  const forged = domainRecord("A_DOMAIN", "HUMAN_REVIEW_REQUIRED", { status: "PASS" });
  assert.equal(g.validateResultRecord(forged).ok, false);
  const badLevel = domainRecord("A_DOMAIN");
  badLevel.domain.effectiveLevel = "MAYBE";
  assert.equal(g.validateResultRecord(badLevel).ok, false);
});

test("unknown status injected at runtime becomes a CONFIGURATION_ERROR kernel record", () => {
  const out = g.aggregate([record(), { ...record({ checkId: "1A.Q" }), status: "GREEN" }]);
  assert.equal(out.readiness.state, "NOT_READY");
  assert.equal(out.overallStatus, "CONFIGURATION_ERROR");
});
