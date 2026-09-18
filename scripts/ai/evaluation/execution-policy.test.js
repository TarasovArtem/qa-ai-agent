"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { POLICY, resolveExitCode } = require("./execution-policy");

// --- STRICT policy: only an exact baseline match exits 0 ---

test("STRICT + UNCHANGED -> exit 0", () => {
  const result = resolveExitCode("UNCHANGED", POLICY.STRICT);
  assert.equal(result.exitCode, 0);
});

test("STRICT + REGRESSED -> exit 1 (blocks)", () => {
  const result = resolveExitCode("REGRESSED", POLICY.STRICT);
  assert.equal(result.exitCode, 1);
});

test("STRICT + IMPROVED -> exit 1 (an improvement still requires a reviewed baseline update)", () => {
  const result = resolveExitCode("IMPROVED", POLICY.STRICT);
  assert.equal(result.exitCode, 1);
});

test("STRICT + BASELINE_MISMATCH -> exit 1", () => {
  const result = resolveExitCode("BASELINE_MISMATCH", POLICY.STRICT);
  assert.equal(result.exitCode, 1);
});

// --- INFORMATIONAL policy: reports truthfully, never blocks on a verdict ---

test("INFORMATIONAL + UNCHANGED -> exit 0", () => {
  const result = resolveExitCode("UNCHANGED", POLICY.INFORMATIONAL);
  assert.equal(result.exitCode, 0);
});

test("INFORMATIONAL + REGRESSED -> exit 0 (reported, not blocked - this is the documented v1-v5 contract)", () => {
  const result = resolveExitCode("REGRESSED", POLICY.INFORMATIONAL);
  assert.equal(result.exitCode, 0);
  assert.match(result.reason, /REGRESSED/);
  assert.match(result.reason, /never block/);
});

test("INFORMATIONAL + IMPROVED -> exit 0", () => {
  const result = resolveExitCode("IMPROVED", POLICY.INFORMATIONAL);
  assert.equal(result.exitCode, 0);
});

test("INFORMATIONAL + BASELINE_MISMATCH -> exit 1 (structural failure, not a policy choice - blocks under every policy)", () => {
  const result = resolveExitCode("BASELINE_MISMATCH", POLICY.INFORMATIONAL);
  assert.equal(result.exitCode, 1);
});

// --- fail-closed on unrecognized input: never silently PASS ---

test("unknown status fails closed with exit 1, under either policy", () => {
  assert.equal(resolveExitCode("SOMETHING_NEW", POLICY.STRICT).exitCode, 1);
  assert.equal(resolveExitCode("SOMETHING_NEW", POLICY.INFORMATIONAL).exitCode, 1);
});

test("unknown policy fails closed with exit 1, regardless of status", () => {
  assert.equal(resolveExitCode("UNCHANGED", "NOT_A_REAL_POLICY").exitCode, 1);
  assert.equal(resolveExitCode("REGRESSED", "NOT_A_REAL_POLICY").exitCode, 1);
});

test("reason strings are always present and non-empty (CI logs must not require reading source to understand an exit code)", () => {
  for (const status of ["REGRESSED", "IMPROVED", "UNCHANGED", "BASELINE_MISMATCH", "UNKNOWN"]) {
    for (const policy of [POLICY.STRICT, POLICY.INFORMATIONAL, "UNKNOWN"]) {
      const result = resolveExitCode(status, policy);
      assert.equal(typeof result.reason, "string");
      assert.ok(result.reason.length > 0);
    }
  }
});

// --- full status x policy matrix, exhaustive and explicit ---

test("full STRICT x status matrix", () => {
  assert.deepEqual(
    ["REGRESSED", "IMPROVED", "UNCHANGED", "BASELINE_MISMATCH"].map((s) => resolveExitCode(s, POLICY.STRICT).exitCode),
    [1, 1, 0, 1],
  );
});

test("full INFORMATIONAL x status matrix", () => {
  assert.deepEqual(
    ["REGRESSED", "IMPROVED", "UNCHANGED", "BASELINE_MISMATCH"].map((s) => resolveExitCode(s, POLICY.INFORMATIONAL).exitCode),
    [0, 0, 0, 1],
  );
});
