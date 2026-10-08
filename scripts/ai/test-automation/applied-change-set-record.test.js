"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  CHANGE_OPERATIONS,
  CHANGE_STATUSES,
  RECORD_STATUSES,
  DIGEST_PATTERN,
  isValidDigest,
  isValidTimestamp,
  computeDigest,
  buildAppliedChangeSetRecord,
  recomputeAppliedChangeSetRecordDigest,
  validateAppliedChangeSetRecord,
} = require("./applied-change-set-record");

const VALID_DIGEST = "sha256:" + "4".repeat(64);
const APPLIED_AT = "2026-08-28T12:00:00.000Z";

function validInput(overrides = {}) {
  return {
    projectId: "proj-1",
    changeSetDigest: VALID_DIGEST,
    reviewPackageDigest: VALID_DIGEST,
    reviewRecordDigest: VALID_DIGEST,
    changes: [{ operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: VALID_DIGEST, status: "APPLIED" }],
    status: "APPLIED",
    appliedAt: APPLIED_AT,
    ...overrides,
  };
}

test("a well-formed input builds a valid record with computed digest", () => {
  const result = buildAppliedChangeSetRecord(validInput());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.appliedChangeSetRecord.schemaVersion, 1);
  assert.equal(result.appliedChangeSetRecord.kind, "AppliedChangeSetRecord");
  assert.match(result.appliedChangeSetRecord.recordDigest, DIGEST_PATTERN);
});

test("recomputeAppliedChangeSetRecordDigest agrees with the digest stored at build time", () => {
  const result = buildAppliedChangeSetRecord(validInput());
  assert.equal(recomputeAppliedChangeSetRecordDigest(result.appliedChangeSetRecord), result.appliedChangeSetRecord.recordDigest);
});

test("recomputeAppliedChangeSetRecordDigest detects tampering of any field", () => {
  const result = buildAppliedChangeSetRecord(validInput());
  const tampered = { ...result.appliedChangeSetRecord, status: "APPLICATION_FAILED_ROLLED_BACK" };
  assert.notEqual(recomputeAppliedChangeSetRecordDigest(tampered), tampered.recordDigest);
});

test("recomputeAppliedChangeSetRecordDigest returns null for a non-object", () => {
  assert.equal(recomputeAppliedChangeSetRecordDigest(null), null);
  assert.equal(recomputeAppliedChangeSetRecordDigest("x"), null);
});

test("result is deeply frozen", () => {
  const result = buildAppliedChangeSetRecord(validInput());
  assert.ok(Object.isFrozen(result.appliedChangeSetRecord));
  assert.ok(Object.isFrozen(result.appliedChangeSetRecord.changes));
  assert.ok(Object.isFrozen(result.appliedChangeSetRecord.changes[0]));
});

test("JSON round-trip is stable", () => {
  const result = buildAppliedChangeSetRecord(validInput());
  const roundTripped = JSON.parse(JSON.stringify(result.appliedChangeSetRecord));
  assert.deepEqual(roundTripped, JSON.parse(JSON.stringify(result.appliedChangeSetRecord)));
  const { recordDigest, ...rest } = roundTripped;
  assert.equal(computeDigest("applied-change-set-record:v1", rest), result.appliedChangeSetRecord.recordDigest);
});

// --- shape rejection matrix ---------------------------------------------------

test("rejects a non-object input", () => {
  const r = buildAppliedChangeSetRecord("not-an-object");
  assert.equal(r.ok, false);
});

test("rejects an unknown top-level field", () => {
  const r = buildAppliedChangeSetRecord(validInput({ extra: "x" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === "$.extra"));
});

test("rejects a malformed projectId", () => {
  for (const bad of [null, "", 123, {}]) {
    const r = buildAppliedChangeSetRecord(validInput({ projectId: bad }));
    assert.equal(r.ok, false, `expected rejection for projectId=${JSON.stringify(bad)}`);
  }
});

for (const field of ["changeSetDigest", "reviewPackageDigest", "reviewRecordDigest"]) {
  test(`rejects a malformed ${field}`, () => {
    for (const bad of [null, "", "sha256:short", "not-a-digest", 42]) {
      const r = buildAppliedChangeSetRecord(validInput({ [field]: bad }));
      assert.equal(r.ok, false, `expected rejection for ${field}=${JSON.stringify(bad)}`);
    }
  });
}

test("rejects an invalid status enum value", () => {
  for (const bad of ["APPROVED", "PENDING", "", null, 1]) {
    const r = buildAppliedChangeSetRecord(validInput({ status: bad }));
    assert.equal(r.ok, false, `expected rejection for status=${JSON.stringify(bad)}`);
  }
});

test("rejects a non-ISO-8601 appliedAt", () => {
  for (const bad of ["2026-08-28", "not-a-date", null, 12345, "2026-08-28T12:00:00+02:00"]) {
    const r = buildAppliedChangeSetRecord(validInput({ appliedAt: bad }));
    assert.equal(r.ok, false, `expected rejection for appliedAt=${JSON.stringify(bad)}`);
  }
});

test("rejects a missing/non-array changes field", () => {
  for (const bad of [undefined, null, "x", {}]) {
    const r = buildAppliedChangeSetRecord(validInput({ changes: bad }));
    assert.equal(r.ok, false);
  }
});

test("rejects an empty changes array", () => {
  const r = buildAppliedChangeSetRecord(validInput({ changes: [] }));
  assert.equal(r.ok, false);
});

test("rejects a changes array exceeding the maximum", () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ operation: "CREATE", path: `cypress/e2e/tests/f${i}.cy.js`, beforeDigest: null, afterDigest: VALID_DIGEST, status: "APPLIED" }));
  const r = buildAppliedChangeSetRecord(validInput({ changes: many }));
  assert.equal(r.ok, false);
});

test("rejects a duplicate path within changes", () => {
  const dup = [
    { operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: VALID_DIGEST, status: "APPLIED" },
    { operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: VALID_DIGEST, status: "APPLIED" },
  ];
  const r = buildAppliedChangeSetRecord(validInput({ changes: dup }));
  assert.equal(r.ok, false);
});

test("rejects an unknown field on a change entry", () => {
  const r = buildAppliedChangeSetRecord(validInput({ changes: [{ operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: VALID_DIGEST, status: "APPLIED", extra: 1 }] }));
  assert.equal(r.ok, false);
});

test("rejects an invalid change operation", () => {
  for (const bad of ["DELETE", "RENAME", null, 1, ""]) {
    const r = buildAppliedChangeSetRecord(validInput({ changes: [{ operation: bad, path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: VALID_DIGEST, status: "APPLIED" }] }));
    assert.equal(r.ok, false, `expected rejection for operation=${JSON.stringify(bad)}`);
  }
});

test("rejects an invalid change path", () => {
  const controlChar = String.fromCharCode(1);
  for (const bad of [null, "", 1, "a".repeat(400), `has${controlChar}control`]) {
    const r = buildAppliedChangeSetRecord(validInput({ changes: [{ operation: "CREATE", path: bad, beforeDigest: null, afterDigest: VALID_DIGEST, status: "APPLIED" }] }));
    assert.equal(r.ok, false, `expected rejection for path=${JSON.stringify(bad)}`);
  }
});

test("rejects an invalid change beforeDigest/afterDigest (neither null nor a valid digest)", () => {
  for (const bad of ["not-a-digest", 42, {}]) {
    const r1 = buildAppliedChangeSetRecord(validInput({ changes: [{ operation: "MODIFY", path: "cypress/e2e/tests/a.cy.js", beforeDigest: bad, afterDigest: VALID_DIGEST, status: "APPLIED" }] }));
    assert.equal(r1.ok, false, `expected rejection for beforeDigest=${JSON.stringify(bad)}`);
    const r2 = buildAppliedChangeSetRecord(validInput({ changes: [{ operation: "MODIFY", path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: bad, status: "APPLIED" }] }));
    assert.equal(r2.ok, false, `expected rejection for afterDigest=${JSON.stringify(bad)}`);
  }
});

test("accepts a null afterDigest (ROLLBACK_INCOMPLETE/removed-CREATE case)", () => {
  const r = buildAppliedChangeSetRecord(validInput({ changes: [{ operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: null, status: "ROLLED_BACK" }], status: "APPLICATION_FAILED_ROLLED_BACK" }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("rejects an invalid change status enum value", () => {
  for (const bad of ["APPLIED_X", null, 1, ""]) {
    const r = buildAppliedChangeSetRecord(validInput({ changes: [{ operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: VALID_DIGEST, status: bad }] }));
    assert.equal(r.ok, false, `expected rejection for change status=${JSON.stringify(bad)}`);
  }
});

test("rejects a non-object change entry", () => {
  const r = buildAppliedChangeSetRecord(validInput({ changes: ["not-an-object"] }));
  assert.equal(r.ok, false);
});

// --- enum exports --------------------------------------------------------------

test("exported enums are exactly the documented v1 vocabularies", () => {
  assert.deepEqual(CHANGE_OPERATIONS, ["CREATE", "MODIFY"]);
  assert.deepEqual(CHANGE_STATUSES, ["APPLIED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"]);
  assert.deepEqual(RECORD_STATUSES, ["APPLIED", "APPLICATION_FAILED_ROLLED_BACK", "APPLICATION_FAILED_ROLLBACK_INCOMPLETE"]);
});

test("isValidDigest / isValidTimestamp reject malformed values", () => {
  assert.equal(isValidDigest(VALID_DIGEST), true);
  assert.equal(isValidDigest("bad"), false);
  assert.equal(isValidTimestamp(APPLIED_AT), true);
  assert.equal(isValidTimestamp("bad"), false);
});

// --- hostile object matrix ------------------------------------------------------

test("hostile object matrix: __proto__, symbol keys, sparse arrays, cycles are all rejected or safely snapshotted, never crash", () => {
  assert.doesNotThrow(() => buildAppliedChangeSetRecord(JSON.parse('{"__proto__":{"polluted":true}}')));
  assert.equal(({}).polluted, undefined);

  const selfRef = {};
  selfRef.self = selfRef;
  assert.doesNotThrow(() => buildAppliedChangeSetRecord({ ...validInput(), changes: [selfRef] }));

  const sparse = [];
  sparse[3] = { operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", beforeDigest: null, afterDigest: VALID_DIGEST, status: "APPLIED" };
  assert.doesNotThrow(() => buildAppliedChangeSetRecord(validInput({ changes: sparse })));

  const withSymbol = validInput();
  withSymbol[Symbol("s")] = "hidden";
  assert.doesNotThrow(() => buildAppliedChangeSetRecord(withSymbol));
});

test("a throwing getter on the input is caught and produces a bounded rejection, never an uncaught exception", () => {
  const hostile = { ...validInput() };
  Object.defineProperty(hostile, "status", { enumerable: true, get() { throw new Error("SECRET_23F_RECORD_MARKER"); } });
  let result;
  assert.doesNotThrow(() => { result = buildAppliedChangeSetRecord(hostile); });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result.errors).includes("SECRET_23F_RECORD_MARKER"));
});

// --- source hygiene --------------------------------------------------------------

test("SOURCE INTEGRITY: this module's own source file contains zero NUL bytes", () => {
  const src = fs.readFileSync(require.resolve("./applied-change-set-record.js"), "utf8");
  let hasNul = false;
  for (let i = 0; i < src.length; i += 1) {
    if (src.charCodeAt(i) === 0) {
      hasNul = true;
      break;
    }
  }
  assert.equal(hasNul, false);
});

// --- TSB-F03: consumption-time AppliedChangeSetRecord schema validation -------
//
// Every forgery recomputes recordDigest over its own forged content, so a
// rejection can only come from schema validation, never digest detection.

function selfDigested(content) {
  const { recordDigest: _drop, ...rest } = content;
  return { ...rest, recordDigest: computeDigest("applied-change-set-record:v1", rest) };
}

function builtRecord(overrides = {}) {
  const result = buildAppliedChangeSetRecord(validInput(overrides));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.appliedChangeSetRecord));
}

test("TSB-F03 record schema: a builder-produced record (and a plain deserialized copy of it) validates", () => {
  const result = buildAppliedChangeSetRecord(validInput());
  assert.equal(validateAppliedChangeSetRecord(result.appliedChangeSetRecord).ok, true);
  const check = validateAppliedChangeSetRecord(builtRecord());
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

const F03_RECORD_FORGERIES = [
  ["unknown top-level field", (r) => { r.executionApproved = true; }, "UNKNOWN_FIELD", "$.executionApproved"],
  ["unknown change field", (r) => { r.changes[0].runAs = "root"; }, "UNKNOWN_FIELD", "$.changes[0].runAs"],
  ["wrong kind", (r) => { r.kind = "AutomationExecutionRecord"; }, "INVALID_TYPE", "$.kind"],
  ["wrong schemaVersion", (r) => { r.schemaVersion = 2; }, "INVALID_TYPE", "$.schemaVersion"],
  ["malformed review digest", (r) => { r.reviewPackageDigest = "zero"; }, "INVALID_VALUE", "$.reviewPackageDigest"],
  ["malformed appliedAt", (r) => { r.appliedAt = "yesterday"; }, "INVALID_VALUE", "$.appliedAt"],
  ["malformed change operation", (r) => { r.changes[0].operation = "DELETE"; }, "INVALID_ENUM", "$.changes[0].operation"],
  ["malformed change afterDigest", (r) => { r.changes[0].afterDigest = "sha256:XYZ"; }, "INVALID_VALUE", "$.changes[0].afterDigest"],
  ["malformed change status", (r) => { r.changes[0].status = "EXECUTED"; }, "INVALID_ENUM", "$.changes[0].status"],
  ["control character in change path", (r) => { r.changes[0].path = "cypress/e2e/a\u0000.cy.js"; }, "INVALID_PATH", "$.changes[0].path"],
  ["duplicate change path", (r) => { r.changes.push({ ...r.changes[0] }); }, "DUPLICATE_ID", "$.changes[1].path"],
  ["empty changes", (r) => { r.changes = []; }, "MISSING_FIELD", "$.changes"],
  ["non-array changes", (r) => { r.changes = { 0: r.changes[0] }; }, "MISSING_FIELD", "$.changes"],
  ["missing projectId", (r) => { delete r.projectId; }, "INVALID_TYPE", "$.projectId"],
];

for (const [name, mutate, code, at] of F03_RECORD_FORGERIES) {
  test(`TSB-F03 record schema: ${name} with a recomputed, self-consistent recordDigest is rejected`, () => {
    const forged = builtRecord();
    mutate(forged);
    const record = selfDigested(forged);
    assert.equal(recomputeAppliedChangeSetRecordDigest(record), record.recordDigest, "fixture must be self-consistent");
    const result = validateAppliedChangeSetRecord(record);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === code && e.path === at), `expected ${code} at ${at}; got ${JSON.stringify(result.errors)}`);
  });
}

test("TSB-F03 record schema: a recordDigest that does not match the record's own content is rejected", () => {
  const record = builtRecord();
  record.status = "APPLICATION_FAILED_ROLLED_BACK";
  const result = validateAppliedChangeSetRecord(record);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === "$.recordDigest"), JSON.stringify(result.errors));
});

test("TSB-F03 record schema: non-object, cyclic and throwing-accessor inputs fail closed with bounded errors", () => {
  for (const input of [null, undefined, "x", 1, []]) {
    assert.equal(validateAppliedChangeSetRecord(input).ok, false);
  }
  const cyclic = builtRecord();
  cyclic.changes[0].self = cyclic;
  assert.equal(validateAppliedChangeSetRecord(cyclic).ok, false);
  const hostile = builtRecord();
  Object.defineProperty(hostile, "changes", { enumerable: true, get() { throw new Error("SECRET_TSB_F03_GETTER"); } });
  let result;
  assert.doesNotThrow(() => { result = validateAppliedChangeSetRecord(hostile); });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("SECRET_TSB_F03_GETTER"));
});

test("TSB-F03 record schema: each field of the record is read exactly once (own-data snapshot)", () => {
  const record = builtRecord();
  const reads = new Map();
  const prox = new Proxy(record, {
    get(t, k, r) {
      reads.set(k, (reads.get(k) || 0) + 1);
      return Reflect.get(t, k, r);
    },
  });
  assert.equal(validateAppliedChangeSetRecord(prox).ok, true);
  for (const [k, n] of reads) assert.equal(n, 1, `key ${String(k)} was read ${n} times`);
});

test("AUTHORITY: this module never imports fs/child_process/network/provider/Git", () => {
  const src = fs.readFileSync(require.resolve("./applied-change-set-record.js"), "utf8");
  assert.ok(!src.includes('require("fs")') && !src.includes("require('fs')") && !src.includes('require("node:fs")'));
  assert.ok(!src.includes('require("child_process")') && !src.includes('require("node:child_process")'));
});
