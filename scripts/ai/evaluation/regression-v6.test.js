"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { run, compareEvaluationToBaselineV6, compareQualityTernary, compareGateStatus } = require("./regression-v6");
const { evaluateDatasetV6 } = require("./scoring-v6");

const DATASET_PATH = path.join(__dirname, "dataset-v6.json");
const BASELINE_PATH = path.join(__dirname, "baseline-v6.json");

// --- compareQualityTernary ---------------------------------------------------

test("compareQualityTernary: fail -> pass is an improvement, pass -> fail is a regression", () => {
  assert.equal(compareQualityTernary("fail", "pass"), "improvement");
  assert.equal(compareQualityTernary("pass", "fail"), "regression");
});

test("compareQualityTernary: both not_applicable is unchanged; one-sided not_applicable is informational, never a regression", () => {
  assert.equal(compareQualityTernary("not_applicable", "not_applicable"), "unchanged");
  assert.equal(compareQualityTernary("pass", "not_applicable"), "informational");
  assert.equal(compareQualityTernary("not_applicable", "fail"), "informational");
});

test("compareQualityTernary: same value is unchanged (including two fails - a pre-existing deficiency is not a NEW regression)", () => {
  assert.equal(compareQualityTernary("fail", "fail"), "unchanged");
  assert.equal(compareQualityTernary("pass", "pass"), "unchanged");
});

// --- compareEvaluationToBaselineV6 -------------------------------------------

test("the real committed dataset/baseline pair compares as UNCHANGED with zero regressions", () => {
  const dataset = require("./dataset-v6.json");
  const baseline = require("./baseline-v6.json");
  const evaluation = evaluateDatasetV6(dataset);
  const comparison = compareEvaluationToBaselineV6(evaluation, baseline);
  assert.equal(comparison.status, "UNCHANGED");
  assert.equal(comparison.summary.regressions, 0);
});

test("a genuine regression (baseline says pass, current computes only partial) is detected", () => {
  const dataset = require("./dataset-v6.json");
  const baseline = JSON.parse(JSON.stringify(require("./baseline-v6.json")));
  // TD-V6-005's real, freshly-computed traceability status is "partial" -
  // recording a stronger committed baseline ("pass") than what the
  // evaluator now actually computes is exactly a genuine regression.
  baseline.samples["TD-V6-005"].traceability = "pass";
  const evaluation = evaluateDatasetV6(dataset);
  const comparison = compareEvaluationToBaselineV6(evaluation, baseline);
  assert.equal(comparison.status, "REGRESSED");
  assert.ok(comparison.summary.regressions >= 1);
});

test("a negative sentinel's committed weak baseline does not itself count as a regression (unchanged from its own committed expectation)", () => {
  const dataset = require("./dataset-v6.json");
  const baseline = require("./baseline-v6.json");
  const evaluation = evaluateDatasetV6(dataset);
  const comparison = compareEvaluationToBaselineV6(evaluation, baseline);
  const td005 = comparison.samples.find((s) => s.id === "TD-V6-005");
  assert.equal(td005.dimensions.traceability.change, "unchanged");
  assert.equal(td005.dimensions.traceability.current, "partial");
});

test("sample-set mismatch (baseline references an id absent from the dataset) is BASELINE_MISMATCH, exitCode 1", () => {
  const dataset = require("./dataset-v6.json");
  const baseline = JSON.parse(JSON.stringify(require("./baseline-v6.json")));
  baseline.samples["TD-V6-DOES-NOT-EXIST"] = baseline.samples["TD-V6-001"];
  const evaluation = evaluateDatasetV6(dataset);
  const comparison = compareEvaluationToBaselineV6(evaluation, baseline);
  assert.equal(comparison.status, "BASELINE_MISMATCH");
  assert.ok(comparison.errors.some((e) => e.includes("TD-V6-DOES-NOT-EXIST")));
});

test("a sample missing from the baseline (present only in the dataset) is BASELINE_MISMATCH", () => {
  const dataset = require("./dataset-v6.json");
  const baseline = JSON.parse(JSON.stringify(require("./baseline-v6.json")));
  delete baseline.samples["TD-V6-001"];
  const evaluation = evaluateDatasetV6(dataset);
  const comparison = compareEvaluationToBaselineV6(evaluation, baseline);
  assert.equal(comparison.status, "BASELINE_MISMATCH");
});

test("an invalidInput sample (failed real #22F validation) is excluded from scorable comparison and reported as a mismatch, never silently scored", () => {
  const dataset = require("./dataset-v6.json");
  const baseline = require("./baseline-v6.json");
  const evaluation = evaluateDatasetV6(dataset);
  evaluation.samples[0] = { ...evaluation.samples[0], invalidInput: true, errors: [{ message: "synthetic" }] };
  const comparison = compareEvaluationToBaselineV6(evaluation, baseline);
  assert.equal(comparison.status, "BASELINE_MISMATCH");
});

// --- compareGateStatus (qualityGatePassed baseline tracking, closes G-1) ---

test("compareGateStatus: true -> false is a regression, false -> true is an improvement, same value is unchanged", () => {
  assert.equal(compareGateStatus(true, false), "regression");
  assert.equal(compareGateStatus(false, true), "improvement");
  assert.equal(compareGateStatus(true, true), "unchanged");
  assert.equal(compareGateStatus(false, false), "unchanged");
});

test("qualityGatePassed is tracked per-sample in the comparison output, alongside the seven dimensions", () => {
  const dataset = require("./dataset-v6.json");
  const baseline = require("./baseline-v6.json");
  const evaluation = evaluateDatasetV6(dataset);
  const comparison = compareEvaluationToBaselineV6(evaluation, baseline);
  const td005 = comparison.samples.find((s) => s.id === "TD-V6-005");
  assert.equal(td005.qualityGatePassed.current, false);
  assert.equal(td005.qualityGatePassed.baseline, false);
  assert.equal(td005.qualityGatePassed.change, "unchanged");
});

// --- baselineMatched / strict drift policy (Roadmap #22G-C1, closes G-2) ---
//
// v6 is a strict reviewed-baseline drift gate: UNCHANGED is the only
// status considered "matched" - REGRESSED, IMPROVED, and BASELINE_MISMATCH
// all require a human to look at it (see regression-v6.js's own header
// comment for the full rationale, including why an "IMPROVED" scorer
// mutation must NOT be a free pass).

test("baselineMatched is true only for UNCHANGED, false for every other status", () => {
  const dataset = require("./dataset-v6.json");
  const cleanBaseline = require("./baseline-v6.json");
  const cleanComparison = compareEvaluationToBaselineV6(evaluateDatasetV6(dataset), cleanBaseline);
  assert.equal(cleanComparison.status, "UNCHANGED");
  assert.equal(cleanComparison.baselineMatched, true);

  const improvedBaseline = JSON.parse(JSON.stringify(cleanBaseline));
  improvedBaseline.samples["TD-V6-005"].traceability = "fail"; // real evaluator computes "partial" - an improvement over "fail"
  const improvedComparison = compareEvaluationToBaselineV6(evaluateDatasetV6(dataset), improvedBaseline);
  assert.equal(improvedComparison.status, "IMPROVED");
  assert.equal(improvedComparison.baselineMatched, false, "an IMPROVED status must still be treated as baseline drift requiring review, not a free pass");

  const regressedBaseline = JSON.parse(JSON.stringify(cleanBaseline));
  regressedBaseline.samples["TD-V6-005"].traceability = "pass"; // real evaluator computes "partial" - a regression from "pass"
  const regressedComparison = compareEvaluationToBaselineV6(evaluateDatasetV6(dataset), regressedBaseline);
  assert.equal(regressedComparison.status, "REGRESSED");
  assert.equal(regressedComparison.baselineMatched, false);
});

// --- run() / exit-code policy (Roadmap #22G-C1: strict baseline-drift gate) -

test("run() on the real committed, clean baseline exits 0 (UNCHANGED)", () => {
  const result = run(DATASET_PATH, BASELINE_PATH);
  assert.equal(result.exitCode, 0);
  assert.ok(result.output.includes("Status: UNCHANGED"));
  assert.ok(result.output.includes("Baseline matched (exact reviewed expectation): true"));
});

test("run() exits 1 when the comparison status is REGRESSED", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  baseline.samples["TD-V6-005"].traceability = "pass"; // real evaluator computes "partial" here
  const tmpPath = path.join(os.tmpdir(), `baseline-v6-regressed-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(baseline));
  t.after(() => fs.unlinkSync(tmpPath));

  const result = run(DATASET_PATH, tmpPath);
  assert.equal(result.exitCode, 1);
  assert.ok(result.output.includes("Status: REGRESSED"));
});

test("run() ALSO exits 1 when the comparison status is IMPROVED - the deliberate v6-C1 hardening that closes G-2 (an always-pass scorer mutation must not exit 0 merely because it happens to 'improve' a negative sentinel's committed weak status)", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  baseline.samples["TD-V6-005"].traceability = "fail"; // real evaluator computes "partial" - an improvement over "fail"
  const tmpPath = path.join(os.tmpdir(), `baseline-v6-improved-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(baseline));
  t.after(() => fs.unlinkSync(tmpPath));

  const result = run(DATASET_PATH, tmpPath);
  assert.equal(result.exitCode, 1, "IMPROVED must exit non-zero under the strict baseline-drift policy");
  assert.ok(result.output.includes("Status: IMPROVED"));
  assert.ok(result.output.includes("Baseline matched (exact reviewed expectation): false"));
});

test("run() exits 1 on BASELINE_MISMATCH (unexpected case id)", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  baseline.samples["TD-V6-DOES-NOT-EXIST"] = baseline.samples["TD-V6-001"];
  const tmpPath = path.join(os.tmpdir(), `baseline-v6-mismatch-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(baseline));
  t.after(() => fs.unlinkSync(tmpPath));

  const result = run(DATASET_PATH, tmpPath);
  assert.equal(result.exitCode, 1);
  assert.ok(result.output.includes("Status: BASELINE_MISMATCH"));
});

test("run() exits 1 on a schema-invalid baseline file, with a bounded error message", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const tmpPath = path.join(os.tmpdir(), `baseline-v6-invalid-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify({ version: 999, datasetVersion: 6, samples: {} }));
  t.after(() => fs.unlinkSync(tmpPath));

  const result = run(DATASET_PATH, tmpPath);
  assert.equal(result.exitCode, 1);
  assert.ok(result.output.includes("failed validation"));
});

test("determinism: two independent run() invocations on the same files produce byte-identical output", () => {
  const a = run(DATASET_PATH, BASELINE_PATH);
  const b = run(DATASET_PATH, BASELINE_PATH);
  assert.equal(a.output, b.output);
  assert.equal(a.exitCode, b.exitCode);
});
