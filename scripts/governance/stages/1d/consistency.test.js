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
  // Isolate the count rule alone (no configured taxonomy/method table exists in this fixture,
  // so a config that also declares those rules correctly reports them INCOMPLETE, not PASS --
  // corrective C1, W2-SEC-H1; see the dedicated tests for that).
  const countOnly = runRisk([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }], { taxonomyRules: [], methodRules: [] });
  assert.equal(g.aggregate(countOnly.records).readiness.state, "READY");
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

test("W2 1D corrective C1 / W2-DEV-M2 / W2-SEC-L1: dependsOnEvidence binds each counted row to its OWN 1C rowIndex entry (evidenceIdColumn), not the whole 1C result", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const noEvidence = g.checkConsistency({ subject, documents, config });
  assert.equal(state(noEvidence, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");

  const evidenceWith = (rowIndex) => ({ subject, records: [{ checkId: "1C.EVIDENCE.STRUCTURE", ownerStage: "1C", status: "PASS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] }], rowIndex, outcome: null });
  const clean = g.checkConsistency({ subject, documents, config, evidenceResult: evidenceWith([{ id: "R1", status: "PASS" }]) });
  assert.equal(state(clean, "1D.CONSISTENCY.COUNTS"), "PASS/OK");

  const downgraded = g.checkConsistency({ subject, documents, config, evidenceResult: evidenceWith([{ id: "R1", status: "HUMAN_REVIEW_REQUIRED" }]) });
  assert.equal(state(downgraded, "1D.CONSISTENCY.COUNTS"), "HUMAN_REVIEW_REQUIRED/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "1D never strengthens 1C's own per-row finding");

  const unresolvedId = g.checkConsistency({ subject, documents, config, evidenceResult: evidenceWith([{ id: "SOME_OTHER_ID", status: "PASS" }]) });
  assert.equal(state(unresolvedId, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "a counted row whose own evidence id is unresolvable is never silently counted clean");

  const wrongSubjectEvidence = { subject: { ...subject, head: "d".repeat(40) }, records: [], rowIndex: [{ id: "R1", status: "PASS" }], outcome: null };
  const mismatched = g.checkConsistency({ subject, documents, config, evidenceResult: wrongSubjectEvidence });
  assert.equal(state(mismatched, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "a 1C result for a different subject is never consumed");

  const forgedStatus = { subject, records: [], rowIndex: [{ id: "R1", status: "SUPER_PASS" }], outcome: null };
  assert.doesNotThrow(() => g.checkConsistency({ subject, documents, config, evidenceResult: forgedStatus }));
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: forgedStatus }), "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "an unrecognized status anywhere in a supplied 1C result makes the whole result untrusted, never a crash or a silent pass");
});

test("W2 corrective C1 / W2-SEC-H3: an unrecognized status in evidenceResult never throws and never propagates into a new record", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  for (const bad of [
    { subject, records: [{ checkId: "1C.EVIDENCE.STRUCTURE", ownerStage: "1C", status: "SUPER_PASS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] }], outcome: null },
    { subject, records: [{ checkId: "1C.EVIDENCE.STRUCTURE", ownerStage: "1D", status: "PASS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] }], outcome: null },
    { subject, records: "not-an-array", outcome: null },
    null,
    "a string",
    42,
  ]) {
    assert.doesNotThrow(() => g.checkConsistency({ subject, documents, config, evidenceResult: bad }), JSON.stringify(bad));
    const r = g.checkConsistency({ subject, documents, config, evidenceResult: bad });
    for (const rec of r.records) assert.equal(["PASS", "FAIL", "CONFIGURATION_ERROR", "HUMAN_REVIEW_REQUIRED", "INCOMPLETE", "NOT_APPLICABLE"].includes(rec.status), true);
  }
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

// ---------------------------------------------------------------- corrective C1 regressions

test("W2-SEC-H1: a matching document with no matching taxonomy or method table is INCOMPLETE, never a fabricated PASS", () => {
  const noTable = doc("docs/a.md", "# just prose, no table with a Severity or Method column\n");
  const config = { ...baseConfig(), countRules: [] };
  const taxOnly = g.checkConsistency({ subject, documents: [noTable], config: { ...config, methodRules: [] } });
  assert.equal(state(taxOnly, "1D.CONSISTENCY.TAXONOMY"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
  const methodOnly = g.checkConsistency({ subject, documents: [noTable], config: { ...config, taxonomyRules: [] } });
  assert.equal(state(methodOnly, "1D.CONSISTENCY.METHOD"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
});

test("W2-SEC-H1: an unparsed matching document is INCOMPLETE for taxonomy and method, not silently skipped", () => {
  const huge = { path: "docs/a.md", structure: g.parseMarkdown({ path: "docs/a.md", text: "x".repeat(2 * 1024 * 1024) }) };
  const config = { ...baseConfig(), countRules: [] };
  const r = g.checkConsistency({ subject, documents: [huge], config });
  assert.equal(state(r, "1D.CONSISTENCY.TAXONOMY"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
  assert.equal(state(r, "1D.CONSISTENCY.METHOD"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
});

test("W2-SEC-H1: a taxonomy/method rule with genuinely zero matching documents is NOT_APPLICABLE, not INCOMPLETE (true absence is still distinguished from an unresolvable fact)", () => {
  const unrelated = doc("other/x.md", "no relevant tables\n");
  const r = g.checkConsistency({ subject, documents: [unrelated], config: { ...baseConfig(), countRules: [] } });
  assert.equal(state(r, "1D.CONSISTENCY.TAXONOMY"), "NOT_APPLICABLE/OK");
  assert.equal(state(r, "1D.CONSISTENCY.METHOD"), "NOT_APPLICABLE/OK");
});

test("W2-SEC-H2: one clean matching document plus one matching document missing its totals table entirely is INCOMPLETE, not a fabricated PASS", () => {
  const clean = riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }]);
  const missingTotals = doc("docs/b.md", "| ID | Severity |\n|---|---|\n| R2 | HIGH |\n| R3 | HIGH |\n| R4 | HIGH |\n"); // 3 HIGH rows, no totals table at all
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [] };
  const r = g.checkConsistency({ subject, documents: [clean, missingTotals], config });
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
});

test("W2-SEC-H2: a real mismatch in one document combined with an incomplete sibling document preserves the more severe status (FAIL)", () => {
  const mismatch = riskDoc([{ id: "R1", sev: "HIGH" }, { id: "R2", sev: "HIGH" }], [{ level: "HIGH", count: 3 }]);
  const missingTotals = doc("docs/b.md", "| ID | Severity |\n|---|---|\n| R3 | MEDIUM |\n");
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [] };
  const r = g.checkConsistency({ subject, documents: [mismatch, missingTotals], config });
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "FAIL/CONSISTENCY_COUNT_MISMATCH");
});

test("W2-SEC-H2: two clean matching documents both PASS; zero matching documents is NOT_APPLICABLE", () => {
  const a = riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }]);
  const b = doc("docs/b.md", "| ID | Severity |\n|---|---|\n| R2 | MEDIUM |\n\n| Level | Count |\n|---|---|\n| MEDIUM | 1 |\n");
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [] };
  assert.equal(state(g.checkConsistency({ subject, documents: [a, b], config }), "1D.CONSISTENCY.COUNTS"), "PASS/OK");
  assert.equal(state(g.checkConsistency({ subject, documents: [doc("other/x.md", "n/a\n")], config }), "1D.CONSISTENCY.COUNTS"), "NOT_APPLICABLE/OK");
});

test("W2-DEV-M1: an empty ambiguousMarkers list is a valid, more conservative configuration (every contradiction for that rule is always FAIL, never HRR)", () => {
  const valid = g.checkConsistency({ subject, documents: [], config: { ...baseConfig(), methodRules: [{ ...baseConfig().methodRules[0], ambiguousMarkers: [] }] } });
  assert.equal(state(valid, "1D.CONSISTENCY.CONFIG"), "PASS/OK");
  const r = runMethod([{ id: "M1", method: "STATIC_ANALYSIS", note: "we may have executed it once" }], { methodRules: [{ ...baseConfig().methodRules[0], ambiguousMarkers: [] }] });
  assert.equal(state(r, "1D.CONSISTENCY.METHOD"), "FAIL/CONSISTENCY_METHOD_CONTRADICTION", "with no configured ambiguity marker, the contradiction is always a deterministic FAIL");
});

test("W2 section 20: two contradiction entries declared for the same method are rejected, not silently overwritten", () => {
  const r = g.checkConsistency({ subject, documents: [], config: { ...baseConfig(), methodRules: [{ ...baseConfig().methodRules[0], contradictions: [{ method: "STATIC_ANALYSIS", forbiddenWords: ["executed"] }, { method: "STATIC_ANALYSIS", forbiddenWords: ["ran"] }] }] } });
  assert.equal(state(r, "1D.CONSISTENCY.CONFIG"), "CONFIGURATION_ERROR/CONSISTENCY_CONFIG_INVALID");
});

test("W2 section 29: duplicate declared group labels in the totals table are a deterministic FAIL, even when each individually matches", () => {
  const r = runRisk([{ id: "R1", sev: "HIGH" }, { id: "R2", sev: "HIGH" }], [{ level: "HIGH", count: 2 }, { level: "HIGH", count: 2 }], { taxonomyRules: [], methodRules: [] });
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "FAIL/CONSISTENCY_COUNT_MISMATCH");
});
