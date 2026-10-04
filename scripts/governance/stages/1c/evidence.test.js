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
  evidenceClasses: ["DIRECT_DOC", "DOC_REUSABLE", "REPO_OBSERVED", "DERIVED_INFERENCE", "UNKNOWN"],
  conclusionStrengths: ["UNKNOWN", "DERIVED_INFERENCE", "DIRECTLY_SUPPORTED"],
  classToStrength: {
    DIRECT_DOC: "DIRECTLY_SUPPORTED",
    DOC_REUSABLE: "DIRECTLY_SUPPORTED",
    REPO_OBSERVED: "DIRECTLY_SUPPORTED",
    DERIVED_INFERENCE: "DERIVED_INFERENCE",
    UNKNOWN: "UNKNOWN",
  },
  promotionWords: ["documented", "confirmed", "established", "proven", "settled", "resolved"],
  tables: [{ filePatterns: ["docs/*.md"], idColumn: "ID", classColumn: "Class", strengthColumn: "Strength", premisesColumn: "Premises", conclusionColumn: "Conclusion", independentColumn: "Independent" }],
});

const table = (rows) => {
  const header = "| ID | Class | Strength | Premises | Conclusion | Independent |\n|---|---|---|---|---|---|\n";
  return header + rows.map((r) => `| ${r.id} | ${r.cls} | ${r.strength || ""} | ${r.premises || ""} | ${r.conclusion || ""} | ${r.independent || ""} |`).join("\n") + "\n";
};
const run = (rows, configOverrides = {}) => g.checkEvidenceModel({ subject, documents: [doc("docs/a.md", table(rows))], config: { ...baseConfig(), ...configOverrides } });

// ---------------------------------------------------------------- config

test("W2 1C config: exact-key schema, bounded taxonomy, classToStrength coverage", () => {
  const bad = (over) => g.checkEvidenceModel({ subject, documents: [], config: { ...baseConfig(), ...over } });
  assert.equal(state(bad({ evidenceClasses: [] }), "1C.EVIDENCE.CONFIG"), "CONFIGURATION_ERROR/EVIDENCE_CONFIG_INVALID");
  assert.equal(state(bad({ classToStrength: { DIRECT_DOC: "DIRECTLY_SUPPORTED" } }), "1C.EVIDENCE.CONFIG"), "CONFIGURATION_ERROR/EVIDENCE_CONFIG_INVALID");
  assert.equal(state(bad({ classToStrength: { ...baseConfig().classToStrength, DIRECT_DOC: "NOT_A_STRENGTH" } }), "1C.EVIDENCE.CONFIG"), "CONFIGURATION_ERROR/EVIDENCE_CONFIG_INVALID");
  assert.equal(state(bad({ tables: [{ ...baseConfig().tables[0], idColumn: "Class" }] }), "1C.EVIDENCE.CONFIG"), "CONFIGURATION_ERROR/EVIDENCE_CONFIG_INVALID");
  assert.equal(state(bad({ unknown: 1 }), "1C.EVIDENCE.CONFIG"), "CONFIGURATION_ERROR/EVIDENCE_CONFIG_INVALID");
  const r = g.checkEvidenceModel({ subject, documents: [], config: null });
  assert.equal(r.established, undefined);
  assert.equal(r.outcome, null);
  assert.equal(rec(r, "1C.EVIDENCE.CONFIG").status, "CONFIGURATION_ERROR");
});

test("W2 1C: invalid input (subject / documents) is rejected before any config is read", () => {
  assert.equal(g.checkEvidenceModel({}).outcome.reasonCode, "EVIDENCE_INPUT_INVALID");
  assert.equal(g.checkEvidenceModel({ subject, documents: "not-array", config: baseConfig() }).outcome.reasonCode, "EVIDENCE_INPUT_INVALID");
  assert.equal(g.checkEvidenceModel({ subject, documents: [{ path: "../x", structure: {} }], config: baseConfig() }).outcome.reasonCode, "EVIDENCE_INPUT_INVALID");
});

// ---------------------------------------------------------------- positive

test("W2 1C: one valid row, multiple valid rows, all PASS with the exact six records", () => {
  const r = run([
    { id: "A1", cls: "DIRECT_DOC", conclusion: "the page states X" },
    { id: "A2", cls: "REPO_OBSERVED", conclusion: "observed in the repository" },
    { id: "A3", cls: "DERIVED_INFERENCE", premises: "A1, A2", conclusion: "follows from A1 and A2" },
  ]);
  assert.deepEqual(r.records.map((x) => x.checkId), ["1C.EVIDENCE.CONFIG", "1C.EVIDENCE.STRUCTURE", "1C.EVIDENCE.PREMISES", "1C.EVIDENCE.PROPAGATION", "1C.EVIDENCE.PROMOTION_WORDING", "1C.EVIDENCE.ROW_INDEX"]);
  for (const rr of r.records) assert.equal(rr.status, "PASS", rr.checkId);
});

test("W2 1C: a derived conclusion with a compatible weakest premise is not an overclaim", () => {
  const r = run([
    { id: "A1", cls: "DIRECT_DOC" },
    { id: "A2", cls: "DERIVED_INFERENCE", premises: "A1" },
  ]);
  assert.equal(state(r, "1C.EVIDENCE.PROPAGATION"), "PASS/OK");
});

test("W2 1C: independent evidence, only when it references a real, resolvable, sufficiently strong row, allows a strong conclusion despite a weak premise", () => {
  const weak = run([
    { id: "A1", cls: "UNKNOWN" },
    { id: "A2", cls: "DIRECT_DOC", premises: "A1" },
  ]);
  assert.equal(state(weak, "1C.EVIDENCE.PROPAGATION"), "FAIL/EVIDENCE_STRENGTH_OVERCLAIM");
  // A2 cites A3 (itself DIRECT_DOC, strong) as independent evidence: that alone justifies A2's strength.
  const declared = run([
    { id: "A1", cls: "UNKNOWN" },
    { id: "A3", cls: "DIRECT_DOC" },
    { id: "A2", cls: "DIRECT_DOC", premises: "A1", independent: "A3" },
  ]);
  assert.equal(state(declared, "1C.EVIDENCE.PROPAGATION"), "PASS/OK");
});

test("W2 1C corrective C1 / W2-SEC-M2: independentColumn is never a bare boolean marker -- it must reference real, resolvable, sufficiently strong evidence", () => {
  // A bare non-empty marker with no such row is a dangling reference, not an escape hatch.
  const arbitraryMarker = run([{ id: "A1", cls: "UNKNOWN" }, { id: "A2", cls: "DIRECT_DOC", premises: "A1", independent: "yes" }]);
  assert.equal(state(arbitraryMarker, "1C.EVIDENCE.PREMISES"), "FAIL/EVIDENCE_PREMISE_DANGLING");
  assert.equal(state(arbitraryMarker, "1C.EVIDENCE.PROPAGATION"), "FAIL/EVIDENCE_STRENGTH_OVERCLAIM", "a dangling independent reference grants no authority");
  // Weak independent evidence does not rescue a weak premise: still an overclaim.
  const weakIndependent = run([
    { id: "A1", cls: "UNKNOWN" },
    { id: "A4", cls: "UNKNOWN" },
    { id: "A2", cls: "DIRECT_DOC", premises: "A1", independent: "A4" },
  ]);
  assert.equal(state(weakIndependent, "1C.EVIDENCE.PROPAGATION"), "FAIL/EVIDENCE_STRENGTH_OVERCLAIM");
  // A row cannot cite itself as independent evidence.
  const selfRef = run([{ id: "A1", cls: "DIRECT_DOC", independent: "A1" }]);
  assert.equal(state(selfRef, "1C.EVIDENCE.PREMISES"), "FAIL/EVIDENCE_PREMISE_CYCLE");
});

test("W2 1C: promotion wording on the strongest configured strength is not flagged", () => {
  const r = run([{ id: "A1", cls: "DIRECT_DOC", conclusion: "this is a well documented and confirmed fact" }]);
  assert.equal(state(r, "1C.EVIDENCE.PROMOTION_WORDING"), "PASS/OK");
});

// ---------------------------------------------------------------- negative / adversarial

test("W2 1C: zero, two and unknown evidence classes", () => {
  assert.equal(state(run([{ id: "A1", cls: "" }]), "1C.EVIDENCE.STRUCTURE"), "FAIL/EVIDENCE_CLASS_MISSING");
  assert.equal(state(run([{ id: "A1", cls: "DIRECT_DOC, DERIVED_INFERENCE" }]), "1C.EVIDENCE.STRUCTURE"), "FAIL/EVIDENCE_CLASS_MULTIPLE");
  assert.equal(state(run([{ id: "A1", cls: "MADE_UP" }]), "1C.EVIDENCE.STRUCTURE"), "FAIL/EVIDENCE_CLASS_UNKNOWN");
});

test("W2 1C: unknown or multiple declared strength", () => {
  assert.equal(state(run([{ id: "A1", cls: "DIRECT_DOC", strength: "SUPER_SURE" }]), "1C.EVIDENCE.STRUCTURE"), "FAIL/EVIDENCE_STRENGTH_UNKNOWN");
  assert.equal(state(run([{ id: "A1", cls: "DIRECT_DOC", strength: "DIRECTLY_SUPPORTED, UNKNOWN" }]), "1C.EVIDENCE.STRUCTURE"), "FAIL/EVIDENCE_STRENGTH_MULTIPLE");
});

test("W2 1C: malformed and duplicate evidence ids", () => {
  assert.equal(state(run([{ id: "", cls: "DIRECT_DOC" }]), "1C.EVIDENCE.STRUCTURE"), "FAIL/EVIDENCE_ID_MISSING");
  assert.equal(state(run([{ id: "A1", cls: "DIRECT_DOC" }, { id: "A1", cls: "DIRECT_DOC" }]), "1C.EVIDENCE.STRUCTURE"), "FAIL/EVIDENCE_ID_DUPLICATE");
});

test("W2 1C: dangling premise reference", () => {
  const r = run([{ id: "A1", cls: "DERIVED_INFERENCE", premises: "ZZZ" }]);
  assert.equal(state(r, "1C.EVIDENCE.PREMISES"), "FAIL/EVIDENCE_PREMISE_DANGLING");
  assert.equal(state(r, "1C.EVIDENCE.PROPAGATION"), "FAIL/EVIDENCE_STRENGTH_OVERCLAIM", "a dangling premise resolves to rank 0, so any non-UNKNOWN class overclaims");
});

test("W2 1C: a cyclic premise relationship is rejected, never silently resolved", () => {
  const r = run([
    { id: "A1", cls: "DERIVED_INFERENCE", premises: "A2" },
    { id: "A2", cls: "DERIVED_INFERENCE", premises: "A1" },
  ]);
  assert.equal(state(r, "1C.EVIDENCE.PREMISES"), "FAIL/EVIDENCE_PREMISE_CYCLE");
  assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
});

test("W2 1C: derived inference or unknown evidence using promotion wording is HUMAN_REVIEW_REQUIRED, never FAIL", () => {
  const derived = run([{ id: "A1", cls: "DERIVED_INFERENCE", conclusion: "this is now a documented fact" }]);
  assert.equal(state(derived, "1C.EVIDENCE.PROMOTION_WORDING"), "HUMAN_REVIEW_REQUIRED/EVIDENCE_PROMOTION_WORDING");
  const unknown = run([{ id: "A1", cls: "UNKNOWN", conclusion: "this has been established beyond doubt" }]);
  assert.equal(state(unknown, "1C.EVIDENCE.PROMOTION_WORDING"), "HUMAN_REVIEW_REQUIRED/EVIDENCE_PROMOTION_WORDING");
});

test("W2 1C: no substantive truth judgment -- 1C never emits FAIL for promotion wording and never asserts a claim is false", () => {
  const r = run([{ id: "A1", cls: "DERIVED_INFERENCE", conclusion: "documented" }]);
  assert.notEqual(rec(r, "1C.EVIDENCE.PROMOTION_WORDING").status, "FAIL");
  assert.equal(/false|incorrect|wrong/i.test(rec(r, "1C.EVIDENCE.PROMOTION_WORDING").detail), false);
});

test("W2 1C: a malformed or unconfigured evidence table is a distinct, deterministic failure", () => {
  const noId = "| Class |\n|---|\n| DIRECT_DOC |\n";
  const r = g.checkEvidenceModel({ subject, documents: [doc("docs/a.md", noId)], config: baseConfig() });
  assert.equal(state(r, "1C.EVIDENCE.CONFIG"), "FAIL/EVIDENCE_TABLE_MALFORMED");
  const none = g.checkEvidenceModel({ subject, documents: [doc("docs/a.md", "no tables here\n")], config: baseConfig() });
  assert.equal(state(none, "1C.EVIDENCE.CONFIG"), "NOT_APPLICABLE/OK");
  assert.equal(state(none, "1C.EVIDENCE.STRUCTURE"), "NOT_APPLICABLE/OK");
});

test("W2 1C: a document 1B could not parse is INCOMPLETE, never treated as clean", () => {
  const huge = { path: "docs/a.md", structure: g.parseMarkdown({ path: "docs/a.md", text: "x".repeat(2 * 1024 * 1024) }) };
  const r = g.checkEvidenceModel({ subject, documents: [huge], config: baseConfig() });
  assert.equal(rec(r, "1C.EVIDENCE.CONFIG").status, "INCOMPLETE");
});

// ---------------------------------------------------------------- bounds / hostile input

test("W2 1C: hostile control/bidi text in an evidence row is sanitized in the result, never raw", () => {
  const hostile = "docs/‮evil​.md";
  const r = g.checkEvidenceModel({ subject, documents: [doc(hostile, table([{ id: "A1", cls: "DIRECT_DOC", conclusion: "x\u0000\u001b[31mY" }]))], config: baseConfig() });
  for (const rr of r.records) for (const v of [JSON.stringify(rr.observed), JSON.stringify(rr.expected), rr.detail]) assert.equal(/[\u0000-\u001f\u007f‮]/.test(v), false, rr.checkId);
});

test("W2 1C: the evidence-row bound fails closed (INCOMPLETE), never silently truncated to a partial PASS", () => {
  const rows = Array.from({ length: 5001 }, (_, i) => ({ id: `R${i}`, cls: "DIRECT_DOC" }));
  const r = run(rows);
  assert.equal(state(r, "1C.EVIDENCE.STRUCTURE"), "INCOMPLETE/EVIDENCE_BOUND_EXCEEDED");
  assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
});

test("W2 1C: a wide premise fan-out and a deep premise chain complete in bounded time", () => {
  const wideRows = [{ id: "root", cls: "DERIVED_INFERENCE", premises: Array.from({ length: 32 }, (_, i) => `L${i}`).join(",") }];
  for (let i = 0; i < 32; i += 1) wideRows.push({ id: `L${i}`, cls: "DIRECT_DOC" });
  const t0 = Date.now();
  const wide = run(wideRows);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(state(wide, "1C.EVIDENCE.PROPAGATION"), "PASS/OK");

  const deepRows = [];
  for (let i = 0; i < 400; i += 1) deepRows.push({ id: `D${i}`, cls: i === 0 ? "DIRECT_DOC" : "DERIVED_INFERENCE", premises: i === 0 ? "" : `D${i - 1}` });
  const t1 = Date.now();
  const deep = run(deepRows);
  assert.ok(Date.now() - t1 < 2000);
  assert.equal(rec(deep, "1C.EVIDENCE.PREMISES").status, "PASS");
});

test("W2 1C: a repeated-reference premise (diamond) is resolved once, not exponentially", () => {
  // Each layer's rows all cite every id in the previous layer: without memoization this blows up.
  const rows = [{ id: "L0-0", cls: "DIRECT_DOC" }];
  let prev = ["L0-0"];
  for (let layer = 1; layer <= 12; layer += 1) {
    const cur = [];
    for (let i = 0; i < 4; i += 1) {
      const id = `L${layer}-${i}`;
      cur.push(id);
      rows.push({ id, cls: "DERIVED_INFERENCE", premises: prev.join(",") });
    }
    prev = cur;
  }
  const t0 = Date.now();
  const r = run(rows);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
  assert.equal(rec(r, "1C.EVIDENCE.PREMISES").status, "PASS");
});

test("W2 1C: prototype-pollution-shaped ids and classes are treated as ordinary strings", () => {
  const r = run([
    { id: "__proto__", cls: "DIRECT_DOC" },
    { id: "constructor", cls: "DERIVED_INFERENCE", premises: "__proto__" },
  ]);
  assert.equal(({}).polluted, undefined);
  assert.equal(rec(r, "1C.EVIDENCE.PREMISES").status, "PASS");
});

test("W2 1C: deterministic ordering and immutability", () => {
  const rows = [
    { id: "A1", cls: "DIRECT_DOC" },
    { id: "A2", cls: "MADE_UP" },
  ];
  const a = run(rows);
  const b = run(rows);
  assert.deepEqual(a, b);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(a.records), true);
  assert.throws(() => {
    a.records[0].status = "PASS";
  });
});

test("W2 1C: no internal helper is exported through the public governance interface", () => {
  for (const name of ["validateEvidenceModelConfig", "resolve", "checkEvidenceModel_internal", "escapeRegExp"]) assert.equal(name in g, false, name);
});

// ---------------------------------------------------------------- corrective C1 regressions

test("W2-SEC-M1: every non-null column role must be pairwise distinct; every collision is rejected", () => {
  const t = baseConfig().tables[0];
  const pairs = [
    ["idColumn", "classColumn"], ["idColumn", "strengthColumn"], ["idColumn", "premisesColumn"], ["idColumn", "conclusionColumn"], ["idColumn", "independentColumn"],
    ["classColumn", "strengthColumn"], ["classColumn", "premisesColumn"], ["classColumn", "conclusionColumn"], ["classColumn", "independentColumn"],
    ["strengthColumn", "premisesColumn"], ["strengthColumn", "conclusionColumn"], ["strengthColumn", "independentColumn"],
    ["premisesColumn", "conclusionColumn"], ["premisesColumn", "independentColumn"], ["conclusionColumn", "independentColumn"],
  ];
  for (const [a, b] of pairs) {
    const collided = { ...t, [b]: t[a] };
    const r = g.checkEvidenceModel({ subject, documents: [], config: { ...baseConfig(), tables: [collided] } });
    assert.equal(state(r, "1C.EVIDENCE.CONFIG"), "CONFIGURATION_ERROR/EVIDENCE_CONFIG_INVALID", `${a} === ${b}`);
  }
});

test("W2-SEC-M1 regression: the exact collision that previously defeated propagation (independentColumn === classColumn) is now rejected outright, not silently exploitable", () => {
  const t = { ...baseConfig().tables[0], independentColumn: baseConfig().tables[0].classColumn };
  const text = table([{ id: "A1", cls: "UNKNOWN" }, { id: "A2", cls: "DIRECT_DOC", premises: "A1" }]);
  const r = g.checkEvidenceModel({ subject, documents: [doc("docs/a.md", text)], config: { ...baseConfig(), tables: [t] } });
  assert.equal(state(r, "1C.EVIDENCE.CONFIG"), "CONFIGURATION_ERROR/EVIDENCE_CONFIG_INVALID");
});

test("W2-SEC-L2: overlapping selectors are both tried; a document is not limited to the first matching selector", () => {
  const overlapping = {
    ...baseConfig(),
    tables: [
      { filePatterns: ["docs/*.md"], idColumn: "RiskID", classColumn: "RiskClass", strengthColumn: null, premisesColumn: null, conclusionColumn: null, independentColumn: null },
      baseConfig().tables[0],
    ],
  };
  const text = "| RiskID | RiskClass |\n|---|---|\n| R1 | DIRECT_DOC |\n\n" + table([{ id: "A1", cls: "" }]);
  const r = g.checkEvidenceModel({ subject, documents: [doc("docs/a.md", text)], config: overlapping });
  assert.equal(rec(r, "1C.EVIDENCE.CONFIG").observed.tables, 2, "both tables were recognized under their own selector");
  assert.equal(state(r, "1C.EVIDENCE.STRUCTURE"), "FAIL/EVIDENCE_CLASS_MISSING", "the second table's own defect is still caught");
});

test("W2-DEV-L2: the primary reasonCode for coexisting structural defects is deterministic, independent of row order", () => {
  const forward = run([{ id: "A1", cls: "" }, { id: "A2", cls: "MADE_UP" }]);
  const backward = run([{ id: "A2", cls: "MADE_UP" }, { id: "A1", cls: "" }]);
  assert.equal(rec(forward, "1C.EVIDENCE.STRUCTURE").reasonCode, rec(backward, "1C.EVIDENCE.STRUCTURE").reasonCode);
  assert.equal(rec(forward, "1C.EVIDENCE.STRUCTURE").reasonCode, "EVIDENCE_CLASS_UNKNOWN", "class-unknown outranks class-missing in the fixed precedence, regardless of row order");
});

test("W2 corrective C1: a cycle spanning both a premise edge and an independent-evidence edge is still detected", () => {
  // A1 --premise--> A2 --independent--> A1
  const r = run([
    { id: "A1", cls: "DERIVED_INFERENCE", premises: "A2" },
    { id: "A2", cls: "DERIVED_INFERENCE", independent: "A1" },
  ]);
  assert.equal(state(r, "1C.EVIDENCE.PREMISES"), "FAIL/EVIDENCE_PREMISE_CYCLE");
  assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
});

// ---------------------------------------------------------------- corrective C2 (row-index trust boundary)

test("W2-DEV-M2 / W2-SEC-L1: checkEvidenceModel() emits a canonical 1C.EVIDENCE.ROW_INDEX record binding every recognized row to its worst structural/premise/propagation status", () => {
  const r = run([
    { id: "A1", cls: "DIRECT_DOC" },
    { id: "A2", cls: "UNKNOWN" },
    { id: "A3", cls: "DIRECT_DOC", premises: "A2" }, // overclaims
  ]);
  assert.equal(r.rowIndex, undefined, "there is no separate top-level rowIndex field");
  const rowIndexRecord = rec(r, "1C.EVIDENCE.ROW_INDEX");
  assert.equal(rowIndexRecord.status, "PASS");
  assert.equal(Object.isFrozen(rowIndexRecord.observed.rows), true);
  const byId = Object.fromEntries(rowIndexRecord.observed.rows.map((x) => [x.id, x.status]));
  assert.deepEqual(byId, { A1: "PASS", A2: "PASS", A3: "FAIL" });
  assert.deepEqual(rowIndexRecord.observed.rows.map((x) => x.id), ["A1", "A2", "A3"], "rows are sorted by id");
});

test("W2-C1-SEC-H1 corrective C2: no evidence row means the ROW_INDEX record is NOT_APPLICABLE, not a fabricated PASS", () => {
  const r = g.checkEvidenceModel({ subject, documents: [doc("docs/a.md", "no tables here\n")], config: baseConfig() });
  assert.equal(state(r, "1C.EVIDENCE.ROW_INDEX"), "NOT_APPLICABLE/OK");
});

test("W2-C1-SEC-H1 corrective C2: every early-exit path (bound exceeded, cycle work budget) still emits a ROW_INDEX record, never silently omitting it", () => {
  const rows = Array.from({ length: 5001 }, (_, i) => ({ id: `R${i}`, cls: "DIRECT_DOC" }));
  const r = run(rows);
  assert.equal(state(r, "1C.EVIDENCE.ROW_INDEX"), "INCOMPLETE/EVIDENCE_BOUND_EXCEEDED");
});

test("W2-C1-SEC-H1 corrective C2: beyond the row-index projection bound, ROW_INDEX degrades to INCOMPLETE even though STRUCTURE/PREMISES/PROPAGATION can still resolve", () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `R${i}`, cls: "DIRECT_DOC" }));
  const r = run(rows);
  assert.equal(state(r, "1C.EVIDENCE.PROPAGATION"), "PASS/OK");
  assert.equal(state(r, "1C.EVIDENCE.ROW_INDEX"), "INCOMPLETE/EVIDENCE_BOUND_EXCEEDED");
});
