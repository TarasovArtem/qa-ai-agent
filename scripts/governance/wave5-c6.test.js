"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("./index");
const { record, canonicalRecords, domainRecord } = require("./test-support");

const MODES = ["PR_REVIEW", "POST_MERGE"];
const clone = (value) => JSON.parse(JSON.stringify(value));
function complete(mode) {
  const subject = {
    head: "a".repeat(40), tree: "b".repeat(40), base: "c".repeat(40),
    range: { mode, from: "c".repeat(40), to: "a".repeat(40) },
  };
  return canonicalRecords({ subject });
}

// The C5 Senior reproduction: validation sees a valid status, but a later
// observation changes it. Setup never evaluates the hostile property. The
// corrected boundary must read it once, regardless of validation internals.
function changingStatus(source, kind, first = "HUMAN_REVIEW_REQUIRED") {
  let accesses = 0;
  const next = () => ++accesses <= 2 ? first : "UNVALIDATED_STATUS";
  const hostile = kind === "getter"
    ? Object.defineProperty(source, "status", { enumerable: true, configurable: true, get: next })
    : new Proxy(source, { get(target, key, receiver) {
      return key === "status" ? next() : Reflect.get(target, key, receiver);
    } });
  return { hostile, accesses: () => accesses };
}

for (const kind of ["getter", "proxy"]) {
  test(`C6: changing status ${kind} is observed once and returns the validated snapshot`, () => {
    const source = record({ status: "HUMAN_REVIEW_REQUIRED", reasonCode: "OPERATOR_INVOCATION" });
    const changing = changingStatus(source, kind);
    const checked = g.validateResultRecord(changing.hostile);
    assert.equal(checked.ok, true);
    assert.equal(changing.accesses(), 1);
    assert.equal(checked.record.status, "HUMAN_REVIEW_REQUIRED");
    assert.equal(g.validateResultRecord(checked.record).ok, true);
    assert.equal(Object.isFrozen(checked.record), true);
    assert.equal(Object.getOwnPropertyDescriptor(checked.record, "status").value, "HUMAN_REVIEW_REQUIRED");
    // Later caller observations can change without changing accepted evidence.
    void changing.hostile.status;
    void changing.hostile.status;
    assert.equal(checked.record.status, "HUMAN_REVIEW_REQUIRED");
  });

  for (const mode of MODES) {
    test(`C6 ${mode}: Senior changing status ${kind} cannot produce false PASS/READY`, () => {
      const records = complete(mode);
      const index = records.findIndex((r) => r.checkId === "1A.IDENTITY.INVOCATION");
      const changing = changingStatus(records[index], kind);
      records[index] = changing.hostile;
      const out = g.aggregate(records);
      assert.equal(out.overallStatus, "HUMAN_REVIEW_REQUIRED");
      assert.equal(out.readiness.state, "HUMAN_REVIEW_REQUIRED");
      assert.equal(changing.accesses(), 1);
      assert.deepEqual(out.readiness.reasons, ["OPERATOR_INVOCATION"]);
      assert.equal(out.kernelRecords.find((r) => r.checkId === "KERNEL.COMPLETENESS").status, "PASS");
      assert.equal(out.records.find((r) => r.checkId === "1A.IDENTITY.INVOCATION").status, "HUMAN_REVIEW_REQUIRED");
    });
  }
}

for (const mode of MODES) {
  for (const [status, reasonCode, observed] of [
    ["PASS", "OK", { invocationTrust: "PLATFORM_AUTHENTICATED" }],
    ["NOT_APPLICABLE", "NOT_APPLICABLE", { applicabilityProof: "caller exemption" }],
  ]) {
    test(`C6 ${mode}: snapshot ${status} invocation retains the C5 no-adapter guard`, () => {
      const records = complete(mode);
      const index = records.findIndex((r) => r.checkId === "1A.IDENTITY.INVOCATION");
      const changing = changingStatus({ ...records[index], reasonCode, observed }, "getter", status);
      records[index] = changing.hostile;
      const out = g.aggregate(records);
      assert.equal(changing.accesses(), 1);
      assert.equal(out.overallStatus, "INCOMPLETE");
      assert.equal(out.readiness.state, "NOT_READY");
      assert.ok(out.readiness.reasons.includes("PLATFORM_PROVENANCE_UNAVAILABLE"));
      assert.equal(out.records.find((r) => r.checkId === "1A.IDENTITY.INVOCATION").status, status);
    });
  }

  test(`C6 ${mode}: a legitimate non-invocation N/A remains neutral`, () => {
    const records = complete(mode);
    Object.assign(records.find((r) => r.checkId === "1B.MARKDOWN.FILES"), {
      status: "NOT_APPLICABLE", reasonCode: "NOT_APPLICABLE",
      observed: { applicabilityProof: "no changed Markdown files" },
    });
    const out = g.aggregate(records);
    assert.equal(out.readiness.state, "HUMAN_REVIEW_REQUIRED");
    assert.deepEqual(out.readiness.reasons, ["OPERATOR_INVOCATION"]);
    assert.deepEqual(out.kernelRecords.map((r) => r.checkId), ["KERNEL.COMPLETENESS"]);
  });
}

const failures = [
  ["throwing getter", () => {
    let attempts = 0;
    const hostile = Object.defineProperty(record(), "status", { enumerable: true, get() {
      attempts++; throw new Error("caller-controlled error text");
    } });
    return { hostile, attempts: () => attempts };
  }],
  ...["get", "ownKeys", "getOwnPropertyDescriptor"].map((trap) => [`throwing Proxy ${trap}`, () => {
    let attempts = 0;
    const hostile = new Proxy(record(), { [trap]() {
      attempts++; throw new Error("caller-controlled error text");
    } });
    return { hostile, attempts: () => attempts };
  }]),
  ["cyclic record", () => {
    const hostile = record();
    hostile.observed = hostile;
    return { hostile };
  }],
  ["BigInt", () => ({ hostile: record({ observed: { value: 1n } }) })],
  ["nested throwing accessor", () => {
    let attempts = 0;
    const observed = Object.defineProperty({}, "value", { enumerable: true, get() {
      attempts++; throw new Error("caller-controlled error text");
    } });
    return { hostile: record({ observed }), attempts: () => attempts };
  }],
  ["throwing toJSON", () => {
    let attempts = 0;
    const hostile = Object.defineProperty(record(), "toJSON", { value() {
      attempts++; throw new Error("caller-controlled error text");
    } });
    return { hostile, attempts: () => attempts };
  }],
  ["root serializes to undefined", () => {
    let attempts = 0;
    const hostile = Object.defineProperty(record(), "toJSON", { value() { attempts++; return undefined; } });
    return { hostile, attempts: () => attempts };
  }],
];
for (const [name, make] of failures) {
  test(`C6: ${name} fails closed without retry or uncaught exception`, () => {
    const direct = make();
    let checked;
    assert.doesNotThrow(() => { checked = g.validateResultRecord(direct.hostile); });
    assert.equal(checked.ok, false);
    assert.equal(checked.reasonCode, "RESULT_RECORD_INVALID");
    assert.deepEqual(checked.problems, ["record could not be safely snapshotted"]);
    assert.ok(!JSON.stringify(checked).includes("caller-controlled error text"));
    if (direct.attempts) assert.equal(direct.attempts(), 1);
    for (const mode of MODES) {
      const fresh = make();
      const records = complete(mode);
      const index = records.findIndex((r) => r.checkId === "1A.IDENTITY.INVOCATION");
      records[index] = fresh.hostile;
      let out;
      assert.doesNotThrow(() => { out = g.aggregate(records); });
      assert.equal(out.overallStatus, "CONFIGURATION_ERROR");
      assert.equal(out.readiness.state, "NOT_READY");
      assert.ok(out.readiness.reasons.includes("RESULT_RECORD_INVALID"));
      if (fresh.attempts) assert.equal(fresh.attempts(), 1);
    }
  });
}

test("C6: identity-bearing checkId getter is snapshotted once before validation", () => {
  let accesses = 0;
  const hostile = Object.defineProperty(record(), "checkId", { enumerable: true, get() {
    return ++accesses === 1 ? "1A.HEAD_MATCH" : "1E.DOMAIN.UNVALIDATED";
  } });
  const checked = g.validateResultRecord(hostile);
  assert.equal(checked.ok, true);
  assert.equal(accesses, 1);
  assert.equal(checked.record.checkId, "1A.HEAD_MATCH");
});

test("C6: caller mutation cannot change the detached, recursively frozen domain record", () => {
  const source = domainRecord("REVIEW_DOMAIN");
  const expected = clone(source);
  const checked = g.validateResultRecord(source);
  assert.equal(checked.ok, true);
  source.status = "FAIL";
  source.subject.head = "d".repeat(40);
  source.observed.changed = true;
  source.evidenceRefs.push("caller");
  source.domain.effectiveLevel = "HUMAN_REVIEW_REQUIRED";
  source.domain.reasons.push("caller");
  assert.deepEqual(checked.record, expected);
  for (const value of [checked.record, checked.record.subject, checked.record.subject.range,
    checked.record.observed, checked.record.evidenceRefs, checked.record.domain, checked.record.domain.reasons]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.isFrozen(source), false);
  assert.throws(() => { checked.record.domain.reasons.push("mutation"); }, TypeError);
});

test("C6: one toJSON snapshot is validated as data, never serialized again on success", () => {
  let calls = 0;
  const serialized = record();
  const hostile = Object.defineProperty({}, "toJSON", { value() {
    calls++; return calls === 1 ? serialized : record({ status: "UNVALIDATED_STATUS" });
  } });
  const checked = g.validateResultRecord(hostile);
  assert.equal(checked.ok, true);
  assert.equal(calls, 1);
  assert.deepEqual(checked.record, serialized);
  assert.notEqual(checked.record, serialized);
});

test("C6: snapshot data still rejects malformed records and every existing contract bound", () => {
  const tooDeep = {}; let cursor = tooDeep;
  for (let i = 0; i < 10; i++) { cursor.next = {}; cursor = cursor.next; }
  const missing = record(); delete missing.observed;
  for (const invalid of [
    undefined, null, [], "record", true, 7, () => {},
    missing, record({ extra: true }), record({ checkId: "bad id" }),
    record({ checkId: "a".repeat(129) }), record({ ownerStage: "1G" }),
    record({ status: "UNVALIDATED_STATUS" }), record({ subject: { head: "invalid" } }),
    record({ observed: tooDeep }), record({ expected: "x".repeat(4097) }),
    record({ observed: Array(1025).fill(null) }), record({ reasonCode: "invalid" }),
    record({ detail: "x".repeat(501) }), record({ evidenceRefs: Array(33).fill("ref") }),
    record({ evidenceRefs: ["x".repeat(257)] }), record({ evidenceRefs: [1] }),
    domainRecord("REVIEW_DOMAIN", "HUMAN_REVIEW_REQUIRED", { status: "PASS" }),
    domainRecord("REVIEW_DOMAIN", "PRESERVATION_CHECK_ONLY", { ownerStage: "1B" }),
    domainRecord("REVIEW_DOMAIN", "PRESERVATION_CHECK_ONLY", { checkId: "1E.DOMAIN.OTHER" }),
  ]) {
    const checked = g.validateResultRecord(invalid);
    assert.equal(checked.ok, false);
    assert.equal(checked.reasonCode, "RESULT_RECORD_INVALID");
  }
});
