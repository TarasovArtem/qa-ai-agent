"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { POLICY, VERSION_POLICY, resolvePolicyForVersion, resolveExitCode } = require("./execution-policy");

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

// --- resolvePolicyForVersion: centralized version -> policy assignment ---

test("VERSION_POLICY formally assigns v1-v5 INFORMATIONAL and v6 STRICT", () => {
  assert.deepEqual(VERSION_POLICY, {
    v1: POLICY.INFORMATIONAL,
    v2: POLICY.INFORMATIONAL,
    v3: POLICY.INFORMATIONAL,
    v4: POLICY.INFORMATIONAL,
    v5: POLICY.INFORMATIONAL,
    v6: POLICY.STRICT,
  });
});

test("resolvePolicyForVersion returns the assigned policy for each known version", () => {
  assert.equal(resolvePolicyForVersion("v1"), POLICY.INFORMATIONAL);
  assert.equal(resolvePolicyForVersion("v2"), POLICY.INFORMATIONAL);
  assert.equal(resolvePolicyForVersion("v3"), POLICY.INFORMATIONAL);
  assert.equal(resolvePolicyForVersion("v4"), POLICY.INFORMATIONAL);
  assert.equal(resolvePolicyForVersion("v5"), POLICY.INFORMATIONAL);
  assert.equal(resolvePolicyForVersion("v6"), POLICY.STRICT);
});

test("resolvePolicyForVersion fails closed (throws) on an unknown version - never defaults to INFORMATIONAL or any other policy", () => {
  assert.throws(() => resolvePolicyForVersion("v7"), /No formally assigned execution policy/);
  assert.throws(() => resolvePolicyForVersion("v0"), /No formally assigned execution policy/);
  assert.throws(() => resolvePolicyForVersion(""), /No formally assigned execution policy/);
  assert.throws(() => resolvePolicyForVersion(undefined), /No formally assigned execution policy/);
});

test("resolvePolicyForVersion does not fall back to Object.prototype properties for a version key (e.g. \"toString\", \"constructor\")", () => {
  assert.throws(() => resolvePolicyForVersion("toString"), /No formally assigned execution policy/);
  assert.throws(() => resolvePolicyForVersion("constructor"), /No formally assigned execution policy/);
});
