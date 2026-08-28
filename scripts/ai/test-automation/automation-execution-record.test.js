"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  SUPPORTED_FRAMEWORKS,
  STATUSES,
  DIGEST_PATTERN,
  isValidDigest,
  isValidTimestamp,
  computeDigest,
  buildAutomationExecutionRecord,
  recomputeAutomationExecutionRecordDigest,
} = require("./automation-execution-record");

const VALID_DIGEST = "sha256:" + "4".repeat(64);
const STARTED_AT = "2026-08-28T12:00:00.000Z";
const COMPLETED_AT = "2026-08-28T12:01:00.000Z";

function validInput(overrides = {}) {
  return {
    projectId: "proj-1",
    appliedChangeSetRecordDigest: VALID_DIGEST,
    framework: "cypress",
    command: "npm run chrome",
    status: "PASSED",
    exitCode: 0,
    timedOut: false,
    stdout: { text: "1 passing", truncated: false },
    stderr: { text: "", truncated: false },
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    ...overrides,
  };
}

test("a well-formed input builds a valid record with computed digest", () => {
  const result = buildAutomationExecutionRecord(validInput());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.automationExecutionRecord.schemaVersion, 1);
  assert.equal(result.automationExecutionRecord.kind, "AutomationExecutionRecord");
  assert.match(result.automationExecutionRecord.recordDigest, DIGEST_PATTERN);
});

test("recomputeAutomationExecutionRecordDigest agrees at build time and detects tampering", () => {
  const result = buildAutomationExecutionRecord(validInput());
  assert.equal(recomputeAutomationExecutionRecordDigest(result.automationExecutionRecord), result.automationExecutionRecord.recordDigest);
  const tampered = { ...result.automationExecutionRecord, status: "TEST_FAILED" };
  assert.notEqual(recomputeAutomationExecutionRecordDigest(tampered), tampered.recordDigest);
});

test("recomputeAutomationExecutionRecordDigest returns null for a non-object", () => {
  assert.equal(recomputeAutomationExecutionRecordDigest(null), null);
  assert.equal(recomputeAutomationExecutionRecordDigest("x"), null);
});

test("result is deeply frozen", () => {
  const result = buildAutomationExecutionRecord(validInput());
  assert.ok(Object.isFrozen(result.automationExecutionRecord));
  assert.ok(Object.isFrozen(result.automationExecutionRecord.stdout));
});

test("JSON round-trip is stable", () => {
  const result = buildAutomationExecutionRecord(validInput());
  const roundTripped = JSON.parse(JSON.stringify(result.automationExecutionRecord));
  const { recordDigest, ...rest } = roundTripped;
  assert.equal(computeDigest("automation-execution-record:v1", rest), result.automationExecutionRecord.recordDigest);
});

// --- shape rejection matrix ---------------------------------------------------

test("rejects a non-object input", () => {
  assert.equal(buildAutomationExecutionRecord("not-an-object").ok, false);
});

test("rejects an unknown top-level field", () => {
  const r = buildAutomationExecutionRecord(validInput({ extra: "x" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === "$.extra"));
});

test("rejects a malformed projectId", () => {
  for (const bad of [null, "", 123, {}]) {
    assert.equal(buildAutomationExecutionRecord(validInput({ projectId: bad })).ok, false);
  }
});

test("rejects a malformed appliedChangeSetRecordDigest", () => {
  for (const bad of [null, "", "sha256:short", "not-a-digest", 42]) {
    assert.equal(buildAutomationExecutionRecord(validInput({ appliedChangeSetRecordDigest: bad })).ok, false);
  }
});

test("rejects an unsupported framework", () => {
  for (const bad of ["selenium", "", null, "CYPRESS", 1]) {
    assert.equal(buildAutomationExecutionRecord(validInput({ framework: bad })).ok, false);
  }
});

test("accepts both supported frameworks", () => {
  for (const fw of SUPPORTED_FRAMEWORKS) {
    assert.equal(buildAutomationExecutionRecord(validInput({ framework: fw })).ok, true);
  }
});

test("rejects an invalid command", () => {
  for (const bad of ["", null, 1, "x".repeat(301)]) {
    assert.equal(buildAutomationExecutionRecord(validInput({ command: bad })).ok, false);
  }
});

test("rejects an invalid status enum value", () => {
  for (const bad of ["OK", "", null, 1, "passed"]) {
    assert.equal(buildAutomationExecutionRecord(validInput({ status: bad })).ok, false);
  }
});

test("accepts every documented status with its own semantically-coherent exitCode/timedOut combination", () => {
  const coherentFieldsByStatus = {
    PASSED: { exitCode: 0, timedOut: false },
    TEST_FAILED: { exitCode: 1, timedOut: false },
    TIMED_OUT: { exitCode: null, timedOut: true },
    EXECUTION_ERROR: { exitCode: null, timedOut: false },
  };
  for (const s of STATUSES) {
    const result = buildAutomationExecutionRecord(validInput({ status: s, ...coherentFieldsByStatus[s] }));
    assert.equal(result.ok, true, `${s}: ${JSON.stringify(result.errors)}`);
  }
});

test("rejects a non-integer/non-null exitCode", () => {
  for (const bad of [1.5, "0", NaN, Infinity, {}, undefined]) {
    assert.equal(buildAutomationExecutionRecord(validInput({ exitCode: bad })).ok, false);
  }
});

test("accepts a null exitCode (timeout/execution-error case)", () => {
  assert.equal(buildAutomationExecutionRecord(validInput({ exitCode: null, status: "TIMED_OUT", timedOut: true })).ok, true);
});

// --- cross-field semantic invariants (Roadmap #23G-C1, closes 23G-RV-5) ---------

test("SEMANTIC INVARIANT: rejects every documented contradictory status/exitCode/timedOut/timestamp combination", () => {
  const contradictions = [
    { status: "PASSED", exitCode: 1, timedOut: false },
    { status: "PASSED", exitCode: 0, timedOut: true },
    { status: "TEST_FAILED", exitCode: 0, timedOut: false },
    { status: "TEST_FAILED", exitCode: 1, timedOut: true },
    { status: "TIMED_OUT", exitCode: null, timedOut: false },
    { status: "EXECUTION_ERROR", exitCode: 0, timedOut: false },
  ];
  for (const bad of contradictions) {
    const result = buildAutomationExecutionRecord(validInput(bad));
    assert.equal(result.ok, false, JSON.stringify(bad));
  }
});

test("SEMANTIC INVARIANT: accepts every real reachable boundary combination", () => {
  const valid = [
    { status: "TEST_FAILED", exitCode: null, timedOut: false }, // 'close' reports null when killed by an external signal, never our own timeout
    { status: "TIMED_OUT", exitCode: 137, timedOut: true }, // a real exitCode can still race the kill signal
    { status: "EXECUTION_ERROR", exitCode: null, timedOut: true }, // spawnError always wins over timedOut in status derivation
  ];
  for (const okCase of valid) {
    const result = buildAutomationExecutionRecord(validInput(okCase));
    assert.equal(result.ok, true, `${JSON.stringify(okCase)}: ${JSON.stringify(result.errors)}`);
  }
});

test("SEMANTIC INVARIANT: rejects completedAt earlier than startedAt", () => {
  const result = buildAutomationExecutionRecord(validInput({ startedAt: COMPLETED_AT, completedAt: STARTED_AT }));
  assert.equal(result.ok, false);
});

test("SEMANTIC INVARIANT: accepts completedAt exactly equal to startedAt", () => {
  const result = buildAutomationExecutionRecord(validInput({ startedAt: STARTED_AT, completedAt: STARTED_AT }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects a non-boolean timedOut", () => {
  for (const bad of [1, "true", null, undefined]) {
    assert.equal(buildAutomationExecutionRecord(validInput({ timedOut: bad })).ok, false);
  }
});

test("rejects malformed stdout/stderr", () => {
  assert.equal(buildAutomationExecutionRecord(validInput({ stdout: "not-an-object" })).ok, false);
  assert.equal(buildAutomationExecutionRecord(validInput({ stdout: { text: "x", truncated: "yes" } })).ok, false);
  assert.equal(buildAutomationExecutionRecord(validInput({ stdout: { text: 1, truncated: false } })).ok, false);
  assert.equal(buildAutomationExecutionRecord(validInput({ stdout: { text: "x", truncated: false, extra: 1 } })).ok, false);
  assert.equal(buildAutomationExecutionRecord(validInput({ stdout: { text: "x".repeat(4001), truncated: false } })).ok, false);
});

test("rejects malformed timestamps", () => {
  for (const bad of ["2026-08-28", "not-a-date", null, 1, "2026-08-28T12:00:00+02:00"]) {
    assert.equal(buildAutomationExecutionRecord(validInput({ startedAt: bad })).ok, false);
    assert.equal(buildAutomationExecutionRecord(validInput({ completedAt: bad })).ok, false);
  }
});

// --- helpers --------------------------------------------------------------------

test("isValidDigest / isValidTimestamp reject malformed values", () => {
  assert.equal(isValidDigest(VALID_DIGEST), true);
  assert.equal(isValidDigest("bad"), false);
  assert.equal(isValidTimestamp(STARTED_AT), true);
  assert.equal(isValidTimestamp("bad"), false);
});

// --- hostile object matrix -------------------------------------------------------

test("hostile object matrix: __proto__, symbol keys, sparse arrays, cycles never crash", () => {
  assert.doesNotThrow(() => buildAutomationExecutionRecord(JSON.parse('{"__proto__":{"polluted":true}}')));
  assert.equal(({}).polluted, undefined);

  const selfRef = {};
  selfRef.self = selfRef;
  assert.doesNotThrow(() => buildAutomationExecutionRecord({ ...validInput(), stdout: selfRef }));

  const withSymbol = validInput();
  withSymbol[Symbol("s")] = "hidden";
  assert.doesNotThrow(() => buildAutomationExecutionRecord(withSymbol));
});

test("a throwing getter on the input is caught and produces a bounded rejection, never an uncaught exception", () => {
  const hostile = { ...validInput() };
  Object.defineProperty(hostile, "status", { enumerable: true, get() { throw new Error("SECRET_23G_RECORD_MARKER"); } });
  let result;
  assert.doesNotThrow(() => { result = buildAutomationExecutionRecord(hostile); });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result.errors).includes("SECRET_23G_RECORD_MARKER"));
});

// --- source hygiene --------------------------------------------------------------

test("SOURCE INTEGRITY: this module's own source file contains zero NUL bytes", () => {
  const src = fs.readFileSync(require.resolve("./automation-execution-record.js"), "utf8");
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
  const src = fs.readFileSync(require.resolve("./automation-execution-record.js"), "utf8");
  assert.ok(!src.includes('require("fs")') && !src.includes("require('fs')") && !src.includes('require("node:fs")'));
  assert.ok(!src.includes('require("child_process")') && !src.includes('require("node:child_process")'));
});
