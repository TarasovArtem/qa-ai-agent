"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateAuditReport,
  ACCEPTED_HIGH_CRITICAL_BASELINE,
  RESULT,
} = require("./audit-drift-check");

function fixture(high, critical) {
  return JSON.stringify({
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 1,
        moderate: 1,
        high,
        critical,
        total: 2 + high + critical,
      },
    },
  });
}

// --- positive proof: expected/clean states must PASS ---

test("PASS when high+critical is exactly at the accepted baseline", () => {
  const evaluation = evaluateAuditReport(fixture(ACCEPTED_HIGH_CRITICAL_BASELINE, 0));
  assert.equal(evaluation.result, RESULT.PASS);
  assert.equal(evaluation.highCriticalCount, ACCEPTED_HIGH_CRITICAL_BASELINE);
});

test("PASS when there are zero high/critical findings", () => {
  const evaluation = evaluateAuditReport(fixture(0, 0));
  assert.equal(evaluation.result, RESULT.PASS);
});

// --- negative proof: real drift must VIOLATION, for the intended reason ---

test("VIOLATION when high+critical exceeds the accepted baseline by one", () => {
  const evaluation = evaluateAuditReport(fixture(ACCEPTED_HIGH_CRITICAL_BASELINE + 1, 0));
  assert.equal(evaluation.result, RESULT.VIOLATION);
  assert.match(evaluation.reason, /exceeds the accepted baseline/);
});

test("VIOLATION when a new critical finding appears even with high at baseline", () => {
  const evaluation = evaluateAuditReport(fixture(ACCEPTED_HIGH_CRITICAL_BASELINE, 1));
  assert.equal(evaluation.result, RESULT.VIOLATION);
});

// --- negative proof: scanner failure must never be silently treated as PASS ---

test("INFRA_ERROR when npm audit output is not valid JSON (e.g. a registry failure message)", () => {
  const evaluation = evaluateAuditReport("npm ERR! network timeout");
  assert.equal(evaluation.result, RESULT.INFRA_ERROR);
});

test("INFRA_ERROR when JSON is valid but has no usable vulnerabilities summary", () => {
  const evaluation = evaluateAuditReport(JSON.stringify({ error: { code: "ENOAUDIT" } }));
  assert.equal(evaluation.result, RESULT.INFRA_ERROR);
});

test("INFRA_ERROR when the vulnerabilities summary is missing the high/critical fields", () => {
  const evaluation = evaluateAuditReport(
    JSON.stringify({ metadata: { vulnerabilities: { total: 4 } } }),
  );
  assert.equal(evaluation.result, RESULT.INFRA_ERROR);
});
