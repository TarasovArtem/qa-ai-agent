"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { makeSubject } = require("../../test-support-git");

const subject = makeSubject();
const doc = (path, text) => ({ path, structure: g.parseMarkdown({ path, text }) });
const rec = (result, id) => result.records.find((r) => r.checkId === id);
const state = (result, id) => {
  const r = rec(result, id);
  return r ? `${r.status}/${r.reasonCode}` : "MISSING";
};

const baseConfig = () => ({
  schemaVersion: 1,
  countRules: [{ filePatterns: ["docs/*.md"], countedMatchColumn: "Severity", groupByColumn: "Severity", totalsLabelColumn: "Level", totalsValueColumn: "Count", dependsOnEvidence: false, evidenceIdColumn: null }],
  taxonomyRules: [{ filePatterns: ["docs/*.md"], matchColumn: "Severity", allowedValues: ["LOW", "MEDIUM", "HIGH"] }],
  methodRules: [{ filePatterns: ["docs/*.md"], matchColumn: "Method", methodValues: ["STATIC_ANALYSIS", "READ_ONLY_OBSERVATION", "WRITE_SIDE_EXPERIMENT"], textColumn: "Note", contradictions: [{ method: "STATIC_ANALYSIS", forbiddenWords: ["executed", "ran the command"] }, { method: "READ_ONLY_OBSERVATION", forbiddenWords: ["deleted", "mutated"] }], ambiguousMarkers: ["may have", "possibly"] }],
});

const riskDoc = (rows, totals) => {
  const risk = "| ID | Severity |\n|---|---|\n" + rows.map((r) => `| ${r.id} | ${r.sev} |`).join("\n") + "\n\n";
  const tot = "| Level | Count |\n|---|---|\n" + totals.map((t) => `| ${t.level} | ${t.count} |`).join("\n") + "\n";
  return doc("docs/a.md", risk + tot);
};
const methodDoc = (rows) => doc("docs/a.md", "| ID | Method | Note |\n|---|---|---|\n" + rows.map((r) => `| ${r.id} | ${r.method} | ${r.note || ""} |`).join("\n") + "\n");
const runRisk = (rows, totals, configOverrides = {}) => g.checkConsistency({ subject, documents: [riskDoc(rows, totals)], config: { ...baseConfig(), ...configOverrides } });
const runMethod = (rows, configOverrides = {}) => g.checkConsistency({ subject, documents: [methodDoc(rows)], config: { ...baseConfig(), ...configOverrides } });

// ---------------------------------------------------------------- config

test("W2 1D config: exact-key schema, at least one rule required", () => {
  const bad = (over) => g.checkConsistency({ subject, documents: [], config: { ...baseConfig(), ...over } });
  assert.equal(state(bad({ countRules: [], taxonomyRules: [], methodRules: [] }), "1D.CONSISTENCY.CONFIG"), "CONFIGURATION_ERROR/CONSISTENCY_CONFIG_INVALID");
  assert.equal(state(bad({ countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: null }] }), "1D.CONSISTENCY.CONFIG"), "CONFIGURATION_ERROR/CONSISTENCY_CONFIG_INVALID");
  assert.equal(state(bad({ methodRules: [{ ...baseConfig().methodRules[0], contradictions: [{ method: "NOT_DECLARED", forbiddenWords: ["x"] }] }] }), "1D.CONSISTENCY.CONFIG"), "CONFIGURATION_ERROR/CONSISTENCY_CONFIG_INVALID");
});

test("W2 1D: invalid input rejected before config is read", () => {
  assert.equal(g.checkConsistency({}).outcome.reasonCode, "CONSISTENCY_INPUT_INVALID");
  assert.equal(state(g.checkConsistency({ subject, documents: [{ path: "docs/a.md" }], config: null }), "1D.CONSISTENCY.CONFIG"), "CONFIGURATION_ERROR/CONSISTENCY_CONFIG_INVALID");
});

// ---------------------------------------------------------------- counts

test("W2 1D: correct totals and correct grouped totals all PASS", () => {
  const r = runRisk([{ id: "R1", sev: "HIGH" }, { id: "R2", sev: "HIGH" }, { id: "R3", sev: "MEDIUM" }], [{ level: "HIGH", count: 2 }, { level: "MEDIUM", count: 1 }]);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "PASS/OK");
  assert.equal(g.aggregate(r.records).readiness.state, "READY");
});

test("W2 1D: a declared total that differs from the actual counted rows is a deterministic mismatch", () => {
  const r = runRisk([{ id: "R1", sev: "HIGH" }, { id: "R2", sev: "HIGH" }], [{ level: "HIGH", count: 3 }]);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "FAIL/CONSISTENCY_COUNT_MISMATCH");
});

test("W2 1D: a counted group with no declared total row is a mismatch, not a silent PASS", () => {
  const r = runRisk([{ id: "R1", sev: "HIGH" }], [{ level: "MEDIUM", count: 0 }]);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "FAIL/CONSISTENCY_COUNT_MISMATCH");
});

test("W2 1D: an ungrouped (single-summary) count rule sums all declared totals against the whole counted table", () => {
  const config = { ...baseConfig(), countRules: [{ ...baseConfig().countRules[0], groupByColumn: null }] };
  const ok = g.checkConsistency({ subject, documents: [riskDoc([{ id: "R1", sev: "HIGH" }, { id: "R2", sev: "MEDIUM" }], [{ level: "Total", count: 2 }])], config });
  assert.equal(state(ok, "1D.CONSISTENCY.COUNTS"), "PASS/OK");
  const bad = g.checkConsistency({ subject, documents: [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "Total", count: 5 }])], config });
  assert.equal(state(bad, "1D.CONSISTENCY.COUNTS"), "FAIL/CONSISTENCY_COUNT_MISMATCH");
});

test("W2 1D: a malformed declared numeric total is never treated as matching", () => {
  const r = runRisk([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: "12abc" }]);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "FAIL/CONSISTENCY_NUMERIC_INVALID");
});

test("W2 1D: rejects overflow, decimal, negative and exponent forms as malformed, never permissively parsed", () => {
  for (const bad of ["1e3", "-1", "3.5", "999999999999", "+3", "0x10"]) {
    const r = runRisk([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: bad }]);
    assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "FAIL/CONSISTENCY_NUMERIC_INVALID", bad);
  }
});

test("W2 1D: a missing counted or totals table is INCOMPLETE, never a fabricated PASS", () => {
  const r = g.checkConsistency({ subject, documents: [doc("docs/a.md", "no tables here\n")], config: baseConfig() });
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
});

// ---------------------------------------------------------------- evidence dependency (1C consumption)

test("W2 1D: a count rule marked dependsOnEvidence downgrades to 1C's worst status, and is INCOMPLETE with no 1C result supplied", () => {
  const config = { ...baseConfig(), countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const noEvidence = g.checkConsistency({ subject, documents, config });
  assert.equal(state(noEvidence, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");

  const passingEvidence = { subject, records: [{ checkId: "1C.EVIDENCE.STRUCTURE", ownerStage: "1C", status: "PASS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] }], outcome: null };
  const clean = g.checkConsistency({ subject, documents, config, evidenceResult: passingEvidence });
  assert.equal(state(clean, "1D.CONSISTENCY.COUNTS"), "PASS/OK");

  const hrrEvidence = { subject, records: [{ checkId: "1C.EVIDENCE.PROMOTION_WORDING", ownerStage: "1C", status: "HUMAN_REVIEW_REQUIRED", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] }], outcome: null };
  const downgraded = g.checkConsistency({ subject, documents, config, evidenceResult: hrrEvidence });
  assert.equal(state(downgraded, "1D.CONSISTENCY.COUNTS"), "HUMAN_REVIEW_REQUIRED/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "1D never strengthens 1C's own finding");

  const wrongSubjectEvidence = { subject: { ...subject, head: "d".repeat(40) }, records: [], outcome: null };
  const mismatched = g.checkConsistency({ subject, documents, config, evidenceResult: wrongSubjectEvidence });
  assert.equal(state(mismatched, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "a 1C result for a different subject is never consumed");
});

// ---------------------------------------------------------------- taxonomy

test("W2 1D: an unknown taxonomy value on an otherwise-consistent table is a deterministic FAIL", () => {
  const r = runRisk([{ id: "R1", sev: "CRITICAL" }], [{ level: "CRITICAL", count: 1 }]);
  assert.equal(state(r, "1D.CONSISTENCY.TAXONOMY"), "FAIL/CONSISTENCY_TAXONOMY_UNKNOWN");
});

// ---------------------------------------------------------------- method

test("W2 1D: an obvious method contradiction is FAIL; the same wording with an ambiguity marker is HUMAN_REVIEW_REQUIRED", () => {
  const obvious = runMethod([{ id: "M1", method: "STATIC_ANALYSIS", note: "we executed the script and observed the result" }]);
  assert.equal(state(obvious, "1D.CONSISTENCY.METHOD"), "FAIL/CONSISTENCY_METHOD_CONTRADICTION");
  const nuanced = runMethod([{ id: "M1", method: "STATIC_ANALYSIS", note: "we may have executed it once during setup" }]);
  assert.equal(state(nuanced, "1D.CONSISTENCY.METHOD"), "HUMAN_REVIEW_REQUIRED/CONSISTENCY_METHOD_CONTRADICTION");
});

test("W2 1D: a consistent method declaration is PASS, and 1D never judges method adequacy", () => {
  const r = runMethod([{ id: "M1", method: "READ_ONLY_OBSERVATION", note: "observed the running system without changing it" }]);
  assert.equal(state(r, "1D.CONSISTENCY.METHOD"), "PASS/OK");
  assert.equal(/insufficient|inadequate|not enough/i.test(rec(r, "1D.CONSISTENCY.METHOD").detail), false);
});

test("W2 1D: risk severity acceptability is never judged -- only internal count consistency is", () => {
  // Three HIGH-severity risks, correctly counted: 1D has no opinion on whether HIGH is the "right" severity.
  const r = runRisk([{ id: "R1", sev: "HIGH" }, { id: "R2", sev: "HIGH" }, { id: "R3", sev: "HIGH" }], [{ level: "HIGH", count: 3 }]);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "PASS/OK");
});

// ---------------------------------------------------------------- bounds / hostile input / safety

test("W2 1D: the row bound fails closed, never silently truncated", () => {
  const rows = Array.from({ length: 5001 }, (_, i) => ({ id: `R${i}`, sev: "HIGH" }));
  const r = runRisk(rows, [{ level: "HIGH", count: 5001 }]);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_BOUND_EXCEEDED");
});

test("W2 1D: hostile control/bidi text in a note never reaches the result raw", () => {
  const r = runMethod([{ id: "M1", method: "STATIC_ANALYSIS", note: "x\u0000\u001b[31mexecuted‮" }]);
  for (const rr of r.records) assert.equal(/[\u0000-\u001f\u007f‮]/.test(JSON.stringify(rr.observed) + rr.detail), false, rr.checkId);
});

test("W2 1D: deterministic ordering and immutability", () => {
  const rows = [{ id: "R1", sev: "HIGH" }];
  const totals = [{ level: "HIGH", count: 9 }];
  const a = runRisk(rows, totals);
  const b = runRisk(rows, totals);
  assert.deepEqual(a, b);
  assert.equal(Object.isFrozen(a.records), true);
  assert.throws(() => {
    a.records[0].status = "PASS";
  });
});

test("W2 1D: no internal helper is exported through the public governance interface", () => {
  for (const name of ["validateConsistencyConfig", "findTable", "worseStatus", "parseCount"]) assert.equal(name in g, false, name);
});
