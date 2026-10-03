"use strict";

// GOV-AUTO-1 Wave 2 (1C + 1D) cross-stage integration and boundary tests: the four
// canonical interaction cases (design section 18), Wave 0/1 preservation, and the
// non-goal invariants (no later-wave residue, no GOV-VERIFY residue, no public
// internals, package surface unchanged).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const g = require("./index");
const { stagePlan } = require("./test-support");
const { basePolicy, changedResult, fakeReader, makeSubject } = require("./test-support-git");

const subject = makeSubject();
const doc = (path, text) => ({ path, structure: g.parseMarkdown({ path, text }) });
const isPlainObjectLike = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const evidenceConfig = {
  schemaVersion: 1,
  evidenceClasses: ["DIRECT_DOC", "DERIVED_INFERENCE", "UNKNOWN"],
  conclusionStrengths: ["UNKNOWN", "DERIVED_INFERENCE", "DIRECTLY_SUPPORTED"],
  classToStrength: { DIRECT_DOC: "DIRECTLY_SUPPORTED", DERIVED_INFERENCE: "DERIVED_INFERENCE", UNKNOWN: "UNKNOWN" },
  promotionWords: ["documented", "confirmed"],
  tables: [{ filePatterns: ["docs/*.md"], idColumn: "ID", classColumn: "Class", strengthColumn: null, premisesColumn: "Premises", conclusionColumn: "Conclusion", independentColumn: null }],
};
const consistencyConfig = {
  schemaVersion: 1,
  countRules: [{ filePatterns: ["docs/*.md"], countedMatchColumn: "Class", groupByColumn: null, totalsLabelColumn: "Level", totalsValueColumn: "Count", dependsOnEvidence: true, evidenceIdColumn: "ID" }],
  taxonomyRules: [],
  methodRules: [],
};
const evidenceTable = (rows) => "| ID | Class | Premises | Conclusion |\n|---|---|---|---|\n" + rows.map((r) => `| ${r.id} | ${r.cls} | ${r.premises || ""} | ${r.conclusion || ""} |`).join("\n") + "\n";
const totalsTable = (count) => `\n| Level | Count |\n|---|---|\n| Total | ${count} |\n`;

test("W2 interaction Case A: 1C PASS + 1D PASS -> combined READY", () => {
  const text = evidenceTable([{ id: "A1", cls: "DIRECT_DOC" }, { id: "A2", cls: "DERIVED_INFERENCE", premises: "A1" }]) + totalsTable(2);
  const documents = [doc("docs/a.md", text)];
  const evidence = g.checkEvidenceModel({ subject, documents, config: evidenceConfig });
  const consistency = g.checkConsistency({ subject, documents, config: consistencyConfig, evidenceResult: evidence });
  for (const r of [...evidence.records, ...consistency.records]) assert.equal(r.status === "PASS" || r.status === "NOT_APPLICABLE", true, r.checkId);
  assert.equal(g.aggregate([...evidence.records, ...consistency.records], stagePlan([...evidence.records, ...consistency.records])).readiness.state, "READY");
});

test("W2 interaction Case B: 1C HUMAN_REVIEW_REQUIRED (promotion wording) -> a dependent 1D count check also becomes HUMAN_REVIEW_REQUIRED, never a fabricated PASS", () => {
  const text = evidenceTable([{ id: "A1", cls: "DERIVED_INFERENCE", conclusion: "this is now documented" }]) + totalsTable(1);
  const documents = [doc("docs/a.md", text)];
  const evidence = g.checkEvidenceModel({ subject, documents, config: evidenceConfig });
  assert.ok(evidence.records.some((r) => r.status === "HUMAN_REVIEW_REQUIRED"));
  const consistency = g.checkConsistency({ subject, documents, config: consistencyConfig, evidenceResult: evidence });
  assert.equal(consistency.records.find((r) => r.checkId === "1D.CONSISTENCY.COUNTS").status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(g.aggregate([...evidence.records, ...consistency.records], stagePlan([...evidence.records, ...consistency.records])).readiness.state, "HUMAN_REVIEW_REQUIRED");
});

test("W2 interaction Case C: 1C FAIL (class missing) + 1D independent FAIL (unrelated taxonomy) -> both preserved, aggregate FAIL/NOT_READY", () => {
  const text = evidenceTable([{ id: "A1", cls: "NOT_A_TAXONOMY_VALUE" }]) + totalsTable(1);
  const documents = [doc("docs/a.md", text)];
  const evidence = g.checkEvidenceModel({ subject, documents, config: evidenceConfig });
  assert.equal(evidence.records.find((r) => r.checkId === "1C.EVIDENCE.STRUCTURE").status, "FAIL");
  const taxonomyConfig = { ...consistencyConfig, countRules: [], taxonomyRules: [{ filePatterns: ["docs/*.md"], matchColumn: "Class", allowedValues: ["DIRECT_DOC"] }] };
  const consistency = g.checkConsistency({ subject, documents, config: taxonomyConfig });
  assert.equal(consistency.records.find((r) => r.checkId === "1D.CONSISTENCY.TAXONOMY").status, "FAIL");
  const combined = [...evidence.records, ...consistency.records];
  assert.equal(g.aggregate(combined).readiness.state, "NOT_READY");
  assert.equal(combined.filter((r) => r.status === "FAIL").length >= 2, true, "both FAIL records are preserved, not collapsed into one");
});

test("W2 interaction Case D: 1C INCOMPLETE (unparsed document) -> a dependent 1D check is INCOMPLETE, never fabricated PASS", () => {
  const huge = { path: "docs/a.md", structure: g.parseMarkdown({ path: "docs/a.md", text: "x".repeat(2 * 1024 * 1024) }) };
  const evidence = g.checkEvidenceModel({ subject, documents: [huge], config: evidenceConfig });
  assert.ok(evidence.records.some((r) => r.status === "INCOMPLETE"));
  const consistency = g.checkConsistency({ subject, documents: [doc("docs/a.md", evidenceTable([{ id: "A1", cls: "DIRECT_DOC" }]) + totalsTable(1))], config: consistencyConfig, evidenceResult: evidence });
  assert.equal(consistency.records.find((r) => r.checkId === "1D.CONSISTENCY.COUNTS").status, "INCOMPLETE");
  assert.notEqual(g.aggregate([...evidence.records, ...consistency.records]).readiness.state, "READY");
});

test("W2: 1C and 1D never call Git, read a file or independently re-parse Markdown (search production source)", () => {
  for (const file of ["stages/1c/config.js", "stages/1c/evidence.js", "stages/1d/config.js", "stages/1d/consistency.js"]) {
    const text = fs.readFileSync(nodePath.join(__dirname, file), "utf8");
    assert.equal(/require\(["']\.\.\/1a\/git-adapter["']\)|require\(["']\.\.\/head-reader["']\)|require\(["']fs["']\)|require\(["']node:fs["']\)|child_process|require\(["']https?["']\)/.test(text), false, file);
    assert.equal(/split\(["']\|["']\)|scanInline\(|parseDocument\(/.test(text), false, `${file}: must consume 1B's public structure, never re-implement its parser`);
  }
});

test("W2: no 1G or GOV-VERIFY-1 residue capability exists (merge-gate facts) -- computeDeltaReview/collectCiEvidence/buildReport are intentionally excluded: Wave 3 (1E) and Wave 4 (1F) add them; see wave3.test.js for the Wave 3 boundary", () => {
  for (const name of ["computeFingerprints", "verifyMergeGate", "getBranchProtection", "computePackDiff"]) assert.equal(name in g, false, name);
  for (const file of ["stages/1c/config.js", "stages/1c/evidence.js", "stages/1d/config.js", "stages/1d/consistency.js"]) {
    const text = fs.readFileSync(nodePath.join(__dirname, file), "utf8");
    assert.equal(/PRESERVATION_CHECK_ONLY|DEEP_REVIEW_REQUIRED|PACK_DIFF|BRANCH_PROTECTION|SAFE_TO_MERGE|CI_EXACT_SHA|chooseReviewClass/.test(text), false, file);
  }
});

test("W2: exactly checkEvidenceModel and checkConsistency are the new public interfaces; no internal is exported", () => {
  assert.equal(typeof g.checkEvidenceModel, "function");
  assert.equal(typeof g.checkConsistency, "function");
  for (const name of ["validateEvidenceModelConfig", "validateConsistencyConfig"]) assert.equal(name in g, false, name);
});

test("W2 preservation: Wave 0 aggregation, Wave 1 1A/1B behavior are unaffected by Wave 2", () => {
  // 1A: invalid UTF-8 still never a clean PASS (the corrected Wave 1 behavior).
  const bad = Buffer.from("fffd808190c328a0", "hex");
  return g.scanSecrets({ subject, changedFiles: changedResult(subject, ["k/x.bin"]), policy: basePolicy(), reader: fakeReader({ "k/x.bin": bad }), now: "2026-09-25" }).then((r) => {
    assert.equal(r.records[0].status, "INCOMPLETE");
    assert.equal(r.records[0].reasonCode, "SECRET_CONTENT_UNSCANNABLE");
  });
});

test("W2 preservation: 1B parser bound behavior is unaffected (nested brackets still fail closed quickly)", () => {
  const t0 = Date.now();
  const parsed = g.parseMarkdown({ path: "a.md", text: "[".repeat(1000) + "]".repeat(1000) + "\n" });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reasonCode, "MARKDOWN_BOUND_EXCEEDED");
});

test("W2: the new REASON codes are unique, well-formed and additive (no synonym of an existing code)", () => {
  const names = Object.keys(g.REASON);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[A-Z][A-Z0-9_]*$/);
  for (const name of ["EVIDENCE_CONFIG_INVALID", "EVIDENCE_CLASS_MISSING", "EVIDENCE_CLASS_MULTIPLE", "EVIDENCE_STRENGTH_OVERCLAIM", "EVIDENCE_PROMOTION_WORDING", "EVIDENCE_PREMISE_DANGLING", "EVIDENCE_PREMISE_CYCLE", "CONSISTENCY_CONFIG_INVALID", "CONSISTENCY_COUNT_MISMATCH", "CONSISTENCY_TAXONOMY_UNKNOWN", "CONSISTENCY_METHOD_CONTRADICTION"]) assert.ok(names.includes(name), name);
});

test("W2: the package surface is unchanged (governance is not published or exported)", () => {
  const pkg = JSON.parse(fs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8"));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  assert.equal(files.some((f) => /governance/.test(f)), false);
  const exportsMap = isPlainObjectLike(pkg.exports) ? pkg.exports : {};
  assert.equal(Object.entries(exportsMap).some(([, v]) => /governance/.test(String(v))), false, "package.json exports must not expose governance");
});
