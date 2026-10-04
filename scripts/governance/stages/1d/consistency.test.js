"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { stagePlan } = require("../../test-support");
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
  assert.equal(countOnly.records.every((record) => ["PASS", "NOT_APPLICABLE"].includes(record.status)), true);
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

// A complete, canonical 1C result-set matching exactly what a genuine checkEvidenceModel()
// call emits (corrective C3, Wave 2 C2 re-review, closing W2-C1-SEC-H1): CONFIG, STRUCTURE,
// PREMISES, PROPAGATION and PROMOTION_WORDING each exactly once, plus the ROW_INDEX
// projection -- not an arbitrary bag of individually well-formed records. `rows` is the
// ROW_INDEX record's own row-status list; `rowIndexOverrides` may perturb that one record
// (status, observed shape) to test ROW_INDEX-specific rejection while keeping the rest of
// the set genuinely complete, isolating "ROW_INDEX content is bad" from "the set is incomplete".
const genericRecord = (checkId, status, observed = {}) => ({ checkId, ownerStage: "1C", status, subject, observed, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });
const rowIndexRecord = (rows, overrides = {}) => ({ ...genericRecord("1C.EVIDENCE.ROW_INDEX", "PASS", { rows }), ...overrides });
const fullEvidenceResult = (rows, rowIndexOverrides = {}) => ({
  subject,
  records: [
    genericRecord("1C.EVIDENCE.CONFIG", "PASS", { tables: 1 }),
    genericRecord("1C.EVIDENCE.STRUCTURE", "PASS"),
    genericRecord("1C.EVIDENCE.PREMISES", "PASS"),
    genericRecord("1C.EVIDENCE.PROPAGATION", "PASS"),
    genericRecord("1C.EVIDENCE.PROMOTION_WORDING", "NOT_APPLICABLE"),
    rowIndexRecord(rows, rowIndexOverrides),
  ],
  outcome: null,
});
// The deliberately-INCOMPLETE shape the C2 re-review forged: only a ROW_INDEX record, no
// other canonical check -- this must now be rejected by the C3 completeness contract.
const rowIndexOnly = (rows) => ({ subject, records: [rowIndexRecord(rows)], outcome: null });

test("W2 1D corrective C1+C2+C3 / W2-DEV-M2 / W2-SEC-L1: dependsOnEvidence binds each counted row to its OWN 1C.EVIDENCE.ROW_INDEX entry (evidenceIdColumn), not the whole 1C result", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const noEvidence = g.checkConsistency({ subject, documents, config });
  assert.equal(state(noEvidence, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");

  const clean = g.checkConsistency({ subject, documents, config, evidenceResult: fullEvidenceResult([{ id: "R1", status: "PASS" }]) });
  assert.equal(state(clean, "1D.CONSISTENCY.COUNTS"), "PASS/OK");

  const downgraded = g.checkConsistency({ subject, documents, config, evidenceResult: fullEvidenceResult([{ id: "R1", status: "HUMAN_REVIEW_REQUIRED" }]) });
  assert.equal(state(downgraded, "1D.CONSISTENCY.COUNTS"), "HUMAN_REVIEW_REQUIRED/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "1D never strengthens 1C's own per-row finding");

  const unresolvedId = g.checkConsistency({ subject, documents, config, evidenceResult: fullEvidenceResult([{ id: "SOME_OTHER_ID", status: "PASS" }]) });
  assert.equal(state(unresolvedId, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "a counted row whose own evidence id is unresolvable is never silently counted clean");

  const wrongSubjectEvidence = { ...fullEvidenceResult([{ id: "R1", status: "PASS" }]), subject: { ...subject, head: "d".repeat(40) } };
  const mismatched = g.checkConsistency({ subject, documents, config, evidenceResult: wrongSubjectEvidence });
  assert.equal(state(mismatched, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "a 1C result for a different subject is never consumed, even if otherwise complete and well-formed");

  const forgedStatus = g.checkConsistency({ subject, documents, config, evidenceResult: fullEvidenceResult([], { observed: { rows: [{ id: "R1", status: "SUPER_PASS" }] } }) });
  assert.doesNotThrow(() => g.checkConsistency({ subject, documents, config, evidenceResult: fullEvidenceResult([], { observed: { rows: [{ id: "R1", status: "SUPER_PASS" }] } }) }));
  assert.equal(state(forgedStatus, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "an unrecognized status anywhere in a supplied 1C result makes the whole result untrusted, never a crash or a silent pass");
});

// ---------------------------------------------------------------- corrective C2 (row-index trust boundary)

test("W2-C1-SEC-H1 corrective C2: a forged evidenceResult with an empty records array and no ROW_INDEX record is never trusted, even if it carries a stray rowIndex-shaped field", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  // The pre-C2 exploit: zero real 1C computation (empty records), plus a hand-authored
  // top-level rowIndex claiming PASS. That field no longer means anything to 1D.
  const forged = { subject, records: [], rowIndex: [{ id: "R1", status: "PASS" }], outcome: null };
  const r = g.checkConsistency({ subject, documents, config, evidenceResult: forged });
  assert.notEqual(state(r, "1D.CONSISTENCY.COUNTS"), "PASS/OK", "a forged rowIndex field must never produce a clean PASS");
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");
});

test("W2-C1-SEC-M1 corrective C2: a malformed ROW_INDEX entry (missing id, or an unrecognized status) rejects the whole projection, never a partial one", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  for (const badRows of [
    [{ status: "PASS" }], // missing id
    [{ id: "R1", status: "NOT_A_REAL_STATUS" }],
    [{ id: 42, status: "PASS" }],
  ]) {
    const r = g.checkConsistency({ subject, documents, config, evidenceResult: fullEvidenceResult(badRows) });
    assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", JSON.stringify(badRows));
  }
});

test("W2-C1-SEC-M1 corrective C2: a duplicate id inside ROW_INDEX rejects the whole projection, symmetrically regardless of insertion order", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const failThenPass = g.checkConsistency({ subject, documents, config, evidenceResult: fullEvidenceResult([{ id: "R1", status: "FAIL" }, { id: "R1", status: "PASS" }]) });
  const passThenFail = g.checkConsistency({ subject, documents, config, evidenceResult: fullEvidenceResult([{ id: "R1", status: "PASS" }, { id: "R1", status: "FAIL" }]) });
  assert.equal(state(failThenPass, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "a later, more convenient entry never silently wins over an earlier one");
  assert.equal(state(passThenFail, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");
  assert.equal(state(failThenPass, "1D.CONSISTENCY.COUNTS"), state(passThenFail, "1D.CONSISTENCY.COUNTS"), "no order dependence");
});

test("W2-C1-SEC-H1 corrective C2: a ROW_INDEX record that is not itself PASS (e.g. INCOMPLETE) is never treated as a trustworthy projection", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const incompleteRowIndex = fullEvidenceResult([{ id: "R1", status: "PASS" }], { status: "INCOMPLETE" });
  const r = g.checkConsistency({ subject, documents, config, evidenceResult: incompleteRowIndex });
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");
});

// ---------------------------------------------------------------- corrective C3 (canonical result-set integrity)

test("W2-C1-SEC-H1 corrective C3 CLOSURE: the exact C2-review forged object (ROW_INDEX only, R1=PASS, zero other 1C computation) never produces a dependent PASS", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const forged = { subject, records: [rowIndexRecord([{ id: "R1", status: "PASS" }])], outcome: null };
  assert.doesNotThrow(() => g.checkConsistency({ subject, documents, config, evidenceResult: forged }));
  const r = g.checkConsistency({ subject, documents, config, evidenceResult: forged });
  assert.notEqual(state(r, "1D.CONSISTENCY.COUNTS"), "PASS/OK");
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");
});

test("W2-C2-SEC-M1 corrective C3 CLOSURE: two canonical ROW_INDEX records are rejected as a whole, symmetrically regardless of which one (FAIL or PASS) comes first", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const base = fullEvidenceResult([{ id: "R1", status: "PASS" }]);
  const nonRowIndex = base.records.filter((r) => r.checkId !== "1C.EVIDENCE.ROW_INDEX");
  const failThenPass = { subject, records: [...nonRowIndex, rowIndexRecord([{ id: "R1", status: "FAIL" }]), rowIndexRecord([{ id: "R1", status: "PASS" }])], outcome: null };
  const passThenFail = { subject, records: [...nonRowIndex, rowIndexRecord([{ id: "R1", status: "PASS" }]), rowIndexRecord([{ id: "R1", status: "FAIL" }])], outcome: null };
  const r1 = g.checkConsistency({ subject, documents, config, evidenceResult: failThenPass });
  const r2 = g.checkConsistency({ subject, documents, config, evidenceResult: passThenFail });
  assert.notEqual(state(r1, "1D.CONSISTENCY.COUNTS"), "PASS/OK", "duplicate ROW_INDEX records must never be order-authoritative");
  assert.equal(state(r1, "1D.CONSISTENCY.COUNTS"), state(r2, "1D.CONSISTENCY.COUNTS"), "no order dependence between the two duplicate-order variants");
  assert.equal(state(r1, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");
});

test("W2-C1-SEC-H1 corrective C3: partial canonical check-sets are rejected -- missing any one required singleton check invalidates the whole result", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const full = fullEvidenceResult([{ id: "R1", status: "PASS" }]);
  // A: ROW_INDEX only.
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: rowIndexOnly([{ id: "R1", status: "PASS" }]) }), "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "A: ROW_INDEX only");
  // B: CONFIG + ROW_INDEX only.
  const configOnly = full.records.filter((r) => r.checkId === "1C.EVIDENCE.CONFIG" || r.checkId === "1C.EVIDENCE.ROW_INDEX");
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: { subject, records: configOnly, outcome: null } }), "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "B: CONFIG + ROW_INDEX only");
  // C: STRUCTURE + ROW_INDEX only (no CONFIG at all).
  const structureOnly = full.records.filter((r) => r.checkId === "1C.EVIDENCE.STRUCTURE" || r.checkId === "1C.EVIDENCE.ROW_INDEX");
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: { subject, records: structureOnly, outcome: null } }), "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", "C: STRUCTURE + ROW_INDEX only, missing CONFIG");
  // D/E/F: remove exactly one required singleton check from an otherwise-complete set.
  for (const missing of ["1C.EVIDENCE.STRUCTURE", "1C.EVIDENCE.PREMISES", "1C.EVIDENCE.PROPAGATION", "1C.EVIDENCE.PROMOTION_WORDING", "1C.EVIDENCE.CONFIG"]) {
    const partial = { subject, records: full.records.filter((r) => r.checkId !== missing), outcome: null };
    assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: partial }), "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", `missing ${missing}`);
  }
});

test("W2-C1-SEC-H1 corrective C3: duplicate NON-ROW_INDEX canonical checks (STRUCTURE, PREMISES, PROPAGATION, PROMOTION_WORDING, CONFIG) are also rejected as a whole", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const full = fullEvidenceResult([{ id: "R1", status: "PASS" }]);
  // CONFIG duplication is legitimate in real output (one per bad document/table, plus a
  // summary) -- but STRUCTURE/PREMISES/PROPAGATION/PROMOTION_WORDING must always be singletons.
  for (const checkId of ["1C.EVIDENCE.STRUCTURE", "1C.EVIDENCE.PREMISES", "1C.EVIDENCE.PROPAGATION", "1C.EVIDENCE.PROMOTION_WORDING"]) {
    const duplicated = full.records.find((r) => r.checkId === checkId);
    const withDuplicate = { subject, records: [...full.records, { ...duplicated }], outcome: null };
    assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: withDuplicate }), "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED", `duplicate ${checkId}`);
  }
});

test("W2-C1-SEC-H1 corrective C3: legitimate duplicate CONFIG records (one real producer path) are still accepted -- CONFIG is the one canonical check that is NOT a required singleton", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const full = fullEvidenceResult([{ id: "R1", status: "PASS" }]);
  const extraConfig = genericRecord("1C.EVIDENCE.CONFIG", "FAIL", { path: "docs/other.md" });
  const withExtraConfig = { subject, records: [...full.records, extraConfig], outcome: null };
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: withExtraConfig }), "1D.CONSISTENCY.COUNTS"), "PASS/OK");
});

test("W2-C1-SEC-H1 corrective C3: an unknown 1C.EVIDENCE.* check id anywhere in the set invalidates the whole result", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const full = fullEvidenceResult([{ id: "R1", status: "PASS" }]);
  const withUnknown = { subject, records: [...full.records, genericRecord("1C.EVIDENCE.MADE_UP", "PASS")], outcome: null };
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: withUnknown }), "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED");
});

test("W2-C1-SEC-H1 corrective C3: a legitimate STRUCTURE=FAIL result (one bad row, one clean row) still lets 1D trust the CLEAN row's own projection -- no blanket cross-record poisoning", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const mixedQuality = { subject, records: [genericRecord("1C.EVIDENCE.CONFIG", "PASS"), genericRecord("1C.EVIDENCE.STRUCTURE", "FAIL"), genericRecord("1C.EVIDENCE.PREMISES", "PASS"), genericRecord("1C.EVIDENCE.PROPAGATION", "PASS"), genericRecord("1C.EVIDENCE.PROMOTION_WORDING", "NOT_APPLICABLE"), rowIndexRecord([{ id: "R1", status: "PASS" }])], outcome: null };
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: mixedQuality }), "1D.CONSISTENCY.COUNTS"), "PASS/OK");
});

test("W2-C1-SEC-H1 corrective C3: shuffled canonical record order does not change validity or outcome (the set is order-independent)", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const full = fullEvidenceResult([{ id: "R1", status: "PASS" }]);
  const reversed = { subject, records: [...full.records].reverse(), outcome: null };
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: full }), "1D.CONSISTENCY.COUNTS"), state(g.checkConsistency({ subject, documents, config, evidenceResult: reversed }), "1D.CONSISTENCY.COUNTS"));
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: reversed }), "1D.CONSISTENCY.COUNTS"), "PASS/OK");
});

test("W2-C1-SEC-H1 corrective C3: a genuine result survives a JSON round-trip", () => {
  const config = { ...baseConfig(), taxonomyRules: [], methodRules: [], countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: true, evidenceIdColumn: "ID" }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const roundTripped = JSON.parse(JSON.stringify(fullEvidenceResult([{ id: "R1", status: "PASS" }])));
  assert.equal(state(g.checkConsistency({ subject, documents, config, evidenceResult: roundTripped }), "1D.CONSISTENCY.COUNTS"), "PASS/OK");
});

test("W2-C1-SEC-H1 corrective C3: non-evidence-dependent 1D checks are unaffected by a malformed or incomplete evidenceResult", () => {
  const config = { ...baseConfig(), countRules: [{ ...baseConfig().countRules[0], dependsOnEvidence: false, evidenceIdColumn: null }] };
  const documents = [riskDoc([{ id: "R1", sev: "HIGH" }], [{ level: "HIGH", count: 1 }])];
  const forged = rowIndexOnly([{ id: "R1", status: "PASS" }]);
  const r = g.checkConsistency({ subject, documents, config, evidenceResult: forged });
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "PASS/OK", "a count rule with dependsOnEvidence: false must not be affected by an untrustworthy evidenceResult");
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

// ---------------------------------------------------------------- W2-C1-SEC-M2 (aggregate structure bound)
// Safe synthetic sizes only (max ~50,000 row objects, ~4000 tables) -- never anywhere
// near the pathological 80,000,000-row product the corrective closes.

const severityTable = (sevs) => ({ line: 1, header: ["Severity"], rows: sevs.map((s, i) => ({ line: i + 2, cells: [s] })) });
const levelCountTable = (entries) => ({ line: 1_000_000, header: ["Level", "Count"], rows: entries.map((e, i) => ({ line: 1_000_000 + i + 1, cells: [e.level, String(e.count)] })) });
const dummyTable = (n, offset) => ({ line: 2_000_000 + offset, header: [`Col${offset}`], rows: Array.from({ length: n }, (_, i) => ({ line: i + 1, cells: ["x"] })) });
const structureOf = (tables) => ({ ok: true, path: "docs/synthetic.md", headings: [], anchors: [], links: [], definitions: [], tables });
const runStructure = (structure) => g.checkConsistency({ subject, documents: [{ path: "docs/a.md", structure }], config: { ...baseConfig(), taxonomyRules: [], methodRules: [] } });

test("W2-C1-SEC-M2 corrective C2: many small tables well under the aggregate row bound validate normally and the count rule still resolves", () => {
  const dummies = Array.from({ length: 100 }, (_, i) => dummyTable(5, i));
  const r = runStructure(structureOf([...dummies, severityTable(["HIGH"]), levelCountTable([{ level: "HIGH", count: 1 }])]));
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "PASS/OK");
});

test("W2-C1-SEC-M2 corrective C2: a structure at exactly the aggregate row bound (50,000) is still valid", () => {
  const structure = structureOf([dummyTable(20_000, 1), dummyTable(20_000, 2), dummyTable(9_998, 3), severityTable(["HIGH"]), levelCountTable([{ level: "HIGH", count: 1 }])]);
  const r = runStructure(structure);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "PASS/OK");
});

test("W2-C1-SEC-M2 corrective C2: one row beyond the aggregate row bound (50,001) is rejected as an invalid structure, never accepted", () => {
  const structure = structureOf([dummyTable(20_000, 1), dummyTable(20_000, 2), dummyTable(9_999, 3), severityTable(["HIGH"]), levelCountTable([{ level: "HIGH", count: 1 }])]);
  const r = runStructure(structure);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
});

test("W2-C1-SEC-M2 corrective C2: a single table beyond the per-table row bound is rejected even though the aggregate total alone would be small", () => {
  const r = runStructure(structureOf([dummyTable(20_001, 1)]));
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
});

test("W2-C1-SEC-M2 corrective C2: exactly 4000 tables with small row counts is valid and completes quickly", () => {
  const dummies = Array.from({ length: 3998 }, (_, i) => dummyTable(1, i));
  const structure = structureOf([...dummies, severityTable(["HIGH"]), levelCountTable([{ level: "HIGH", count: 1 }])]);
  const t0 = Date.now();
  const r = runStructure(structure);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "PASS/OK");
});

test("W2-C1-SEC-M2 corrective C2: one table beyond the table-count bound is rejected regardless of row counts", () => {
  const dummies = Array.from({ length: 3999 }, (_, i) => dummyTable(1, i));
  const structure = structureOf([...dummies, severityTable(["HIGH"]), levelCountTable([{ level: "HIGH", count: 1 }])]);
  const r = runStructure(structure);
  assert.equal(state(r, "1D.CONSISTENCY.COUNTS"), "INCOMPLETE/CONSISTENCY_INPUT_INVALID");
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
