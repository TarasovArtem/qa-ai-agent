/**
 * Regression comparison + CLI for Test Design Quality Evaluation v6
 * (Roadmap #22G, hardened in #22G-C1). Mirrors regression-v5.js's shape/
 * conventions (per-sample, per-dimension comparison against a committed
 * baseline; `not_applicable` sits outside the pass/partial/fail ordering).
 *
 * V6 POLICY (Roadmap #22G-C1, closes G-2 - read before changing this):
 * v6 is a STRICT REVIEWED-BASELINE DRIFT GATE, not merely "regressions
 * fail CI while improvements pass freely." The committed baseline-v6.json
 * represents an exact, human-reviewed semantic expectation for every
 * scorable case. ANY divergence from that expectation - in either
 * direction - means the evaluator's actual behavior no longer matches
 * what was last reviewed, and requires a human to look at it before it
 * can be trusted again:
 *
 *   UNCHANGED         -> exitCode 0  (actual output exactly matches the
 *                                      reviewed baseline)
 *   REGRESSED         -> exitCode 1  (a dimension got worse)
 *   IMPROVED          -> exitCode 1  (a dimension got better - NOT
 *                                      necessarily bad, but it means the
 *                                      evaluator's real behavior no longer
 *                                      matches what was committed as
 *                                      "reviewed", and the only way to
 *                                      make it green again is an explicit,
 *                                      human-reviewed baseline-v6.json
 *                                      update in a normal, diff-visible
 *                                      commit - never an automatic rewrite)
 *   BASELINE_MISMATCH -> exitCode 1  (case set/schema itself diverged)
 *
 * This directly replaces #22G's original, narrower policy (only
 * `REGRESSED` exited 1) after independent review (finding G-2) proved
 * every one of the six critical dimension scorers could be silently
 * broken - via an "always return the best possible status" mutation - and
 * still exit 0, either because no negative sentinel existed for that
 * dimension (status stayed `UNCHANGED`) or because breaking the sentinel's
 * own expected weak status happened to read as an "improvement" (which the
 * old policy treated as a free pass). Under the new policy, both of those
 * mutation shapes now exit 1: `directional status` (REGRESSED/IMPROVED/
 * UNCHANGED/BASELINE_MISMATCH) remains available in the report for
 * diagnosis, but only `UNCHANGED` is safe to merge without a human
 * re-reviewing and re-committing the baseline.
 *
 * `baselineMatched` (on the returned comparison object) is the
 * unambiguous boolean form of this: `true` iff `status === "UNCHANGED"`.
 * There is no automatic baseline-rewrite mechanism anywhere in this
 * module or evaluate-v6.js - updating baseline-v6.json to accept an
 * intentional, reviewed improvement is always a manual, human-authored,
 * normally-diffed Git commit.
 *
 * v1-v5's own historical policy (regression.js/regression-v2..v5.js -
 * always exit 0, fully informational) is completely unchanged by this -
 * #22G-C1 touches v6 only.
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

// Boolean mirror of compareQualityTernary, for qualityGatePassed - same
// true/false-only pattern v1-v5 already use for shouldRetryCorrect/
// shouldCreateBugCorrect (Roadmap #22G-C1, closes G-1's baseline-tracking
// requirement).
function compareGateStatus(baselineValue, currentValue) {
  if (baselineValue === true && currentValue === false) return "regression";
  if (baselineValue === false && currentValue === true) return "improvement";
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
      baselineMatched: false,
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

    const gateChange = compareGateStatus(baselineSample.qualityGatePassed, currentSample.qualityGatePassed);
    tally(gateChange);

    const dimensionsOut = {};
    for (const dimension of DIMENSIONS) {
      dimensionsOut[dimension] = { baseline: baselineSample[dimension], current: currentSample.dimensions[dimension].status, change: dimensionChanges[dimension] };
    }

    samples.push({
      id: currentSample.id,
      dimensions: dimensionsOut,
      qualityGatePassed: { baseline: baselineSample.qualityGatePassed, current: currentSample.qualityGatePassed, change: gateChange },
    });
  }

  // Directional status remains available for diagnostics - see this
  // module's own header comment for why BOTH "REGRESSED" and "IMPROVED"
  // now require review (exitCode 1) under the strict drift policy.
  const status = regressions > 0 ? "REGRESSED" : improvements > 0 ? "IMPROVED" : "UNCHANGED";

  return { status, baselineMatched: status === "UNCHANGED", summary: { improvements, regressions, unchanged, informational }, samples };
}

function formatRegressionReportV6(comparison) {
  const lines = ["Test Design Quality Regression Check — Baseline v6", ""];

  if (comparison.status === "BASELINE_MISMATCH") {
    lines.push("Status: BASELINE_MISMATCH", "", "Errors:");
    for (const error of comparison.errors) lines.push(`  - ${error}`);
    return lines.join("\n");
  }

  lines.push(
    `Status: ${comparison.status}`,
    `Baseline matched (exact reviewed expectation): ${comparison.baselineMatched}`,
    "",
    "Improvements:",
    `  ${comparison.summary.improvements}`,
    "",
    "Regressions:",
    `  ${comparison.summary.regressions}`
  );

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
    const gate = sample.qualityGatePassed;
    if (gate.change === "regression") regressionDetails.push(`${sample.id} qualityGatePassed`);
    if (gate.change === "improvement") improvementDetails.push(`${sample.id} qualityGatePassed`);
  }

  if (regressionDetails.length > 0) {
    lines.push("", "Regression details:");
    for (const detail of regressionDetails) lines.push(`  - ${detail}`);
  }
  if (improvementDetails.length > 0) {
    lines.push("", "Improvement details (still requires a reviewed baseline update - see this module's own header comment):");
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

  // Strict drift policy (Roadmap #22G-C1, closes G-2): only an exact
  // match to the committed, reviewed baseline is safe - see this module's
  // own header comment.
  const exitCode = comparison.baselineMatched ? 0 : 1;
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

module.exports = { compareEvaluationToBaselineV6, formatRegressionReportV6, run, compareQualityTernary, compareGateStatus };
