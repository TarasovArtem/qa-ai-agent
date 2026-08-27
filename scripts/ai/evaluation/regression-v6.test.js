"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { run, compareEvaluationToBaselineV6, compareQualityTernary } = require("./regression-v6");
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

// --- run() / exit-code policy (the deliberate v6 CI-gating enhancement) -----

test("run() on the real committed dataset/baseline exits 0", () => {
  const result = run(DATASET_PATH, BASELINE_PATH);
  assert.equal(result.exitCode, 0);
  assert.ok(result.output.includes("Status: UNCHANGED"));
});

test("run() exits 1 (not 0) when the comparison status is REGRESSED - the deliberate v6 departure from v1-v5's always-exit-0 policy", (t) => {
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
