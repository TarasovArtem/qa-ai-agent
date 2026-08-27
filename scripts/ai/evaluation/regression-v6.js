/**
 * Regression comparison + CLI for Test Design Quality Evaluation v6
 * (Roadmap #22G). Mirrors regression-v5.js's shape/conventions (per-sample,
 * per-dimension comparison against a committed baseline; a single
 * regression anywhere outweighs any number of simultaneous improvements;
 * `not_applicable` sits outside the pass/partial/fail ordering).
 *
 * DELIBERATE DEVIATION FROM v1-v5's EXIT-CODE POLICY (read before changing
 * this): regression.js/regression-v2..v5.js always exit 0 even when
 * `status === "REGRESSED"` - explicitly documented there as informational-
 * only, with "a later CI integration may map REGRESSED to a non-zero exit;
 * that mapping is deliberately not made yet." #22G is that later
 * integration, for the Test Design domain specifically: `run()` below
 * returns `exitCode: 1` when `status === "REGRESSED"`, so a genuine
 * regression fails natural PR CI (Roadmap #22G Section 51/134 - "v6 should
 * fail CI when actual evaluator result != committed expected regression
 * result... Diagnose... Fix only with evidence", never silently rewrite the
 * baseline to turn CI green). This does NOT fail CI for an intentionally
 * negative sentinel scoring poorly - a sentinel's committed baseline
 * already records its expected fail/partial status, so its "unchanged"
 * comparison contributes zero regressions (Roadmap #22G Section 49/169-170,
 * "qualityGatePassed" vs "regressionPassed" are deliberately distinct - see
 * scoring-v6.js's own qualityGatePassed, which the sentinel legitimately
 * fails while regressionPassed here stays true).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { validateDatasetV6 } = require("./dataset-v6-schema");
const { validateBaselineV6 } = require("./baseline-v6-schema");
const { evaluateDatasetV6, DIMENSIONS } = require("./scoring-v6");

const DEFAULT_DATASET_PATH = path.join(__dirname, "dataset-v6.json");
const DEFAULT_BASELINE_PATH = path.join(__dirname, "baseline-v6.json");

// Shared ordering for every v6 dimension (all seven use the same
// QUALITY_TERNARY_VALUES vocabulary - unlike v5's mix of booleans and
// ternaries, so a single comparator suffices here): fail(0) < partial(1) <
// pass(2). not_applicable sits outside the ordering.
const QUALITY_RANK = { fail: 0, partial: 1, pass: 2 };

function compareQualityTernary(baselineValue, currentValue) {
  if (baselineValue === "not_applicable" && currentValue === "not_applicable") return "unchanged";
  if (baselineValue === "not_applicable" || currentValue === "not_applicable") return "informational";
  const baselineRank = QUALITY_RANK[baselineValue];
  const currentRank = QUALITY_RANK[currentValue];
  if (currentRank > baselineRank) return "improvement";
  if (currentRank < baselineRank) return "regression";
  return "unchanged";
}

function compareEvaluationToBaselineV6(currentEvaluation, baseline) {
  const baselineIds = Object.keys(baseline.samples).sort();
  const scorableCurrentSamples = currentEvaluation.samples.filter((s) => !s.invalidInput);
  const currentIds = scorableCurrentSamples.map((s) => s.id).sort();
  const sameSampleSet = baselineIds.length === currentIds.length && baselineIds.every((id, index) => id === currentIds[index]);

  const invalidInputSamples = currentEvaluation.samples.filter((s) => s.invalidInput);

  if (!sameSampleSet || invalidInputSamples.length > 0) {
    const missingFromCurrent = baselineIds.filter((id) => !currentIds.includes(id));
    const missingFromBaseline = currentIds.filter((id) => !baselineIds.includes(id));
    return {
      status: "BASELINE_MISMATCH",
      errors: [
        ...missingFromCurrent.map((id) => `sample "${id}" is in the baseline but missing from the current (scorable) evaluation`),
        ...missingFromBaseline.map((id) => `sample "${id}" is in the current evaluation but missing from the baseline`),
        ...invalidInputSamples.map((s) => `sample "${s.id}" failed real #22F validation (INVALID_EVALUATION_INPUT) and cannot be regression-compared`),
      ],
      summary: null,
      samples: [],
    };
  }

  const samples = [];
  let regressions = 0;
  let improvements = 0;
  let unchanged = 0;
  let informational = 0;

  const tally = (change) => {
    if (change === "regression") regressions += 1;
    else if (change === "improvement") improvements += 1;
    else if (change === "informational") informational += 1;
    else unchanged += 1;
  };

  for (const currentSample of scorableCurrentSamples) {
    const baselineSample = baseline.samples[currentSample.id];
    const dimensionChanges = {};
    for (const dimension of DIMENSIONS) {
      dimensionChanges[dimension] = compareQualityTernary(baselineSample[dimension], currentSample.dimensions[dimension].status);
      tally(dimensionChanges[dimension]);
    }

    const dimensionsOut = {};
    for (const dimension of DIMENSIONS) {
      dimensionsOut[dimension] = { baseline: baselineSample[dimension], current: currentSample.dimensions[dimension].status, change: dimensionChanges[dimension] };
    }

    samples.push({ id: currentSample.id, dimensions: dimensionsOut });
  }

  // Precedence identical to v1-v5: any single regression anywhere
  // outweighs any number of simultaneous improvements.
  const status = regressions > 0 ? "REGRESSED" : improvements > 0 ? "IMPROVED" : "UNCHANGED";

  return { status, summary: { improvements, regressions, unchanged, informational }, samples };
}

function formatRegressionReportV6(comparison) {
  const lines = ["Test Design Quality Regression Check — Baseline v6", ""];

  if (comparison.status === "BASELINE_MISMATCH") {
    lines.push("Status: BASELINE_MISMATCH", "", "Errors:");
    for (const error of comparison.errors) lines.push(`  - ${error}`);
    return lines.join("\n");
  }

  lines.push(`Status: ${comparison.status}`, "", "Improvements:", `  ${comparison.summary.improvements}`, "", "Regressions:", `  ${comparison.summary.regressions}`);

  const regressionDetails = [];
  const improvementDetails = [];
  const knownWeaknesses = [];

  for (const sample of comparison.samples) {
    for (const dimension of DIMENSIONS) {
      const entry = sample.dimensions[dimension];
      if (entry.change === "regression") regressionDetails.push(`${sample.id} ${dimension}`);
      if (entry.change === "improvement") improvementDetails.push(`${sample.id} ${dimension}`);
      if (entry.change === "unchanged" && entry.baseline !== "pass" && entry.baseline !== "not_applicable") {
        knownWeaknesses.push(`${sample.id} ${dimension} (${entry.baseline})`);
      }
    }
  }

  if (regressionDetails.length > 0) {
    lines.push("", "Regression details:");
    for (const detail of regressionDetails) lines.push(`  - ${detail}`);
  }
  if (improvementDetails.length > 0) {
    lines.push("", "Improvement details:");
    for (const detail of improvementDetails) lines.push(`  - ${detail}`);
  }
  if (knownWeaknesses.length > 0) {
    lines.push("", "Known/labeled weaknesses (unchanged from baseline - expected on negative sentinels):");
    for (const detail of knownWeaknesses) lines.push(`  - ${detail}`);
  }

  return lines.join("\n");
}

function run(datasetPath, baselinePath) {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const datasetValidation = validateDatasetV6(dataset);
  if (!datasetValidation.valid) {
    const output = ["Dataset v6 failed validation:", ...datasetValidation.errors.map((e) => `  - ${e}`)].join("\n");
    return { exitCode: 1, output };
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const baselineValidation = validateBaselineV6(baseline);
  if (!baselineValidation.valid) {
    const output = ["Baseline v6 failed validation:", ...baselineValidation.errors.map((e) => `  - ${e}`)].join("\n");
    return { exitCode: 1, output };
  }

  const currentEvaluation = evaluateDatasetV6(dataset);
  const comparison = compareEvaluationToBaselineV6(currentEvaluation, baseline);

  if (comparison.status === "BASELINE_MISMATCH") {
    return { exitCode: 1, output: formatRegressionReportV6(comparison) };
  }

  // Deliberate v6 enhancement over v1-v5's informational-only policy - see
  // this module's own header comment.
  const exitCode = comparison.status === "REGRESSED" ? 1 : 0;
  return { exitCode, output: formatRegressionReportV6(comparison) };
}

function main() {
  const result = run(DEFAULT_DATASET_PATH, DEFAULT_BASELINE_PATH);
  if (result.exitCode === 0) {
    console.log(result.output);
  } else {
    console.error(result.output);
  }
  process.exitCode = result.exitCode;
}

if (require.main === module) {
  main();
}

module.exports = { compareEvaluationToBaselineV6, formatRegressionReportV6, run, compareQualityTernary };
