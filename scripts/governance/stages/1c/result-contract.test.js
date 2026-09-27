"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { makeSubject } = require("../../test-support-git");
const { validateEvidenceStageResult } = require("./result-contract");

const subject = makeSubject();
const doc = (path, text) => ({ path, structure: g.parseMarkdown({ path, text }) });

const baseConfig = () => ({
  schemaVersion: 1,
  evidenceClasses: ["DIRECT_DOC", "DOC_REUSABLE", "REPO_OBSERVED", "DERIVED_INFERENCE", "UNKNOWN"],
  conclusionStrengths: ["UNKNOWN", "DERIVED_INFERENCE", "DIRECTLY_SUPPORTED"],
  classToStrength: { DIRECT_DOC: "DIRECTLY_SUPPORTED", DOC_REUSABLE: "DIRECTLY_SUPPORTED", REPO_OBSERVED: "DIRECTLY_SUPPORTED", DERIVED_INFERENCE: "DERIVED_INFERENCE", UNKNOWN: "UNKNOWN" },
  promotionWords: ["documented", "confirmed", "established"],
  tables: [{ filePatterns: ["docs/*.md"], idColumn: "ID", classColumn: "Class", strengthColumn: "Strength", premisesColumn: "Premises", conclusionColumn: "Conclusion", independentColumn: "Independent" }],
});
const table = (rows) => {
  const header = "| ID | Class | Strength | Premises | Conclusion | Independent |\n|---|---|---|---|---|---|\n";
  return header + rows.map((r) => `| ${r.id} | ${r.cls} | ${r.strength || ""} | ${r.premises || ""} | ${r.conclusion || ""} | ${r.independent || ""} |`).join("\n") + "\n";
};
const run = (rows, configOverrides = {}) => g.checkEvidenceModel({ subject, documents: [doc("docs/a.md", table(rows))], config: { ...baseConfig(), ...configOverrides } });

// ---------------------------------------------------------------- section 35: full producer-path matrix
// Every genuine checkEvidenceModel() output, across every distinct code path, must be
// ACCEPTED by validateEvidenceStageResult() -- this module must never reject real output.

test("C3 producer matrix: clean PASS output is accepted", () => {
  const r = run([{ id: "A1", cls: "DIRECT_DOC" }]);
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.deepEqual([...v.rowIndex.entries()], [["A1", "PASS"]]);
});

test("C3 producer matrix: promotion-word HRR output is accepted", () => {
  const r = run([{ id: "A1", cls: "DERIVED_INFERENCE", conclusion: "this is well documented" }]);
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.deepEqual([...v.rowIndex.entries()], [["A1", "HUMAN_REVIEW_REQUIRED"]]);
});

test("C3 producer matrix: structural FAIL (unknown class) output is accepted", () => {
  const r = run([{ id: "A1", cls: "MADE_UP" }]);
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.equal(v.rowIndex, null, "no evidence row was recognized (structural failure), so no row-index projection exists");
});

test("C3 producer matrix: invalid config output is accepted", () => {
  const r = g.checkEvidenceModel({ subject, documents: [], config: { ...baseConfig(), evidenceClasses: [] } });
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.equal(v.rowIndex, null);
});

test("C3 producer matrix: dangling premise output is accepted", () => {
  const r = run([{ id: "A1", cls: "DERIVED_INFERENCE", premises: "ZZZ" }]);
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.deepEqual([...v.rowIndex.entries()], [["A1", "FAIL"]]);
});

test("C3 producer matrix: cyclic premise output is accepted", () => {
  const r = run([{ id: "A1", cls: "DERIVED_INFERENCE", premises: "A2" }, { id: "A2", cls: "DERIVED_INFERENCE", premises: "A1" }]);
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.deepEqual([...v.rowIndex.entries()], [["A1", "FAIL"], ["A2", "FAIL"]]);
});

test("C3 producer matrix: strength-overclaim (propagation FAIL) output is accepted", () => {
  const r = run([{ id: "A1", cls: "UNKNOWN" }, { id: "A2", cls: "DIRECT_DOC", premises: "A1" }]);
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.deepEqual([...v.rowIndex.entries()], [["A1", "PASS"], ["A2", "FAIL"]]);
});

test("C3 producer matrix: no applicable evidence table (NOT_APPLICABLE) output is accepted", () => {
  const r = g.checkEvidenceModel({ subject, documents: [doc("docs/a.md", "no tables here\n")], config: baseConfig() });
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.equal(v.rowIndex, null);
});

test("C3 producer matrix: an unparsed / malformed 1B structure (INCOMPLETE via CONFIG) output is accepted", () => {
  const huge = { path: "docs/a.md", structure: g.parseMarkdown({ path: "docs/a.md", text: "x".repeat(2 * 1024 * 1024) }) };
  const r = g.checkEvidenceModel({ subject, documents: [huge], config: baseConfig() });
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
});

test("C3 producer matrix: row-index projection limit exceeded (>1000 rows, ROW_INDEX INCOMPLETE) output is accepted", () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `R${i}`, cls: "DIRECT_DOC" }));
  const r = run(rows);
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.equal(v.rowIndex, null, "beyond the row-index limit, no usable projection exists, but the result-set itself is still valid");
});

test("C3 producer matrix: stage row bound exceeded (>5000 rows, STRUCTURE INCOMPLETE) output is accepted", () => {
  const rows = Array.from({ length: 5001 }, (_, i) => ({ id: `R${i}`, cls: "DIRECT_DOC" }));
  const r = run(rows);
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
  assert.equal(v.rowIndex, null);
});

test("C3 producer matrix: legitimate duplicate CONFIG records (mixed-quality documents) output is accepted", () => {
  const config = { ...baseConfig(), tables: [{ ...baseConfig().tables[0] }] };
  const docA = doc("docs/a.md", "| Class |\n|---|\n| DIRECT_DOC |\n"); // malformed: class without id column
  const docB = doc("docs/b.md", table([{ id: "R1", cls: "DIRECT_DOC" }]));
  const r = g.checkEvidenceModel({ subject, documents: [docA, docB], config });
  assert.ok(r.records.filter((x) => x.checkId === "1C.EVIDENCE.CONFIG").length >= 2, "precondition: genuine output has duplicate CONFIG here");
  const v = validateEvidenceStageResult(r, subject);
  assert.equal(v.ok, true);
});

// ---------------------------------------------------------------- adversarial / forged rejection

test("C3: the exact W2-C1-SEC-H1 minimal forgery (ROW_INDEX only) is rejected", () => {
  const forged = { subject, records: [{ checkId: "1C.EVIDENCE.ROW_INDEX", ownerStage: "1C", status: "PASS", subject, observed: { rows: [{ id: "R1", status: "PASS" }] }, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] }], outcome: null };
  const v = validateEvidenceStageResult(forged, subject);
  assert.equal(v.ok, false);
});

test("C3: duplicate ROW_INDEX records are rejected regardless of order", () => {
  const ri = (status) => ({ checkId: "1C.EVIDENCE.ROW_INDEX", ownerStage: "1C", status: "PASS", subject, observed: { rows: [{ id: "R1", status }] }, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });
  const others = ["1C.EVIDENCE.CONFIG", "1C.EVIDENCE.STRUCTURE", "1C.EVIDENCE.PREMISES", "1C.EVIDENCE.PROPAGATION", "1C.EVIDENCE.PROMOTION_WORDING"].map((c) => ({ checkId: c, ownerStage: "1C", status: "PASS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] }));
  const a = validateEvidenceStageResult({ subject, records: [...others, ri("FAIL"), ri("PASS")], outcome: null }, subject);
  const b = validateEvidenceStageResult({ subject, records: [...others, ri("PASS"), ri("FAIL")], outcome: null }, subject);
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
});

test("C3: an unknown 1C.EVIDENCE.* checkId is rejected", () => {
  const r = run([{ id: "A1", cls: "DIRECT_DOC" }]);
  const withUnknown = { ...r, records: [...r.records, { checkId: "1C.EVIDENCE.MADE_UP", ownerStage: "1C", status: "PASS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] }] };
  const v = validateEvidenceStageResult(withUnknown, subject);
  assert.equal(v.ok, false);
});

test("C3: shuffled canonical record order does not change validity", () => {
  const r = run([{ id: "A1", cls: "DIRECT_DOC" }]);
  const shuffled = { ...r, records: [...r.records].reverse() };
  const v1 = validateEvidenceStageResult(r, subject);
  const v2 = validateEvidenceStageResult(shuffled, subject);
  assert.equal(v1.ok, true);
  assert.equal(v2.ok, true);
  assert.deepEqual([...v1.rowIndex.entries()], [...v2.rowIndex.entries()]);
});

test("C3: JSON round-trip of a genuine result remains valid", () => {
  const r = run([{ id: "A1", cls: "DIRECT_DOC" }]);
  const roundTripped = JSON.parse(JSON.stringify(r));
  const v = validateEvidenceStageResult(roundTripped, subject);
  assert.equal(v.ok, true);
});

test("C3: never throws on hostile malformed input", () => {
  for (const bad of [null, undefined, "a string", 42, [], {}, { subject }, { subject, records: "not-array" }]) {
    assert.doesNotThrow(() => validateEvidenceStageResult(bad, subject));
    assert.equal(validateEvidenceStageResult(bad, subject).ok, false);
  }
});
