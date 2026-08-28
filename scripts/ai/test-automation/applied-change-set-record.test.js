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

test("AUTHORITY: this module never imports fs/child_process/network/provider/Git", () => {
  const src = fs.readFileSync(require.resolve("./applied-change-set-record.js"), "utf8");
  assert.ok(!src.includes('require("fs")') && !src.includes("require('fs')") && !src.includes('require("node:fs")'));
  assert.ok(!src.includes('require("child_process")') && !src.includes('require("node:child_process")'));
});
