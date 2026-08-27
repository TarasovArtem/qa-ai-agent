/**
 * Thin CLI wrapper around scoring-v6.js: loads dataset-v6.json from disk,
 * validates it with dataset-v6-schema.js, scores it, and prints a
 * human-readable (or, with --json, machine-readable) report.
 *
 * Mirrors evaluate-v5.js's shape exactly, on purpose - the only file in
 * scripts/ai/evaluation/ that touches the filesystem or process.exit/
 * console for Dataset v6, and evaluateDatasetV6() itself stays pure (aside
 * from calling the real, already-pure #22F production functions) so it can
 * be unit tested without any I/O.
 *
 * Roadmap #22G: unlike v1-v5 (which re-score frozen QA-failure-triage
 * fixtures, never touching scripts/ai/generation or scripts/ai/test-design
 * at all), v6 DOES call real #22F production code -
 * buildTestDesignReviewPackage()/buildTestDesignReviewRecord() - but only
 * ever with the dataset's own committed fixture artifacts, never a live AI
 * provider, never the network, never the filesystem beyond reading
 * dataset-v6.json itself. Deliberately does not import GroqProvider/
 * MockProvider/createProvider and never reads AI_API_KEY/GROQ_API_KEY.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { validateDatasetV6 } = require("./dataset-v6-schema");
const { evaluateDatasetV6, DIMENSIONS } = require("./scoring-v6");

const DEFAULT_DATASET_PATH = path.join(__dirname, "dataset-v6.json");

function formatPercentage(value) {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function formatDimensionLine(dimension, counts) {
  return `  ${dimension}: pass=${counts.pass} partial=${counts.partial} fail=${counts.fail} not_applicable=${counts.not_applicable}`;
}

function formatEvaluationSummaryV6({ metrics, samples }) {
  const lines = [];

  lines.push("Test Design Quality Evaluation — Dataset v6");
  lines.push("");
  lines.push("Samples");
  lines.push(`  Total: ${metrics.totalSamples}`);
  lines.push(`  Invalid input (failed real #22F validation, not scored): ${metrics.invalidInputCount}`);
  lines.push(`  Scorable: ${metrics.scorableCount}`);
  lines.push("");
  lines.push("Quality gate (all CRITICAL dimensions pass/not_applicable)");
  lines.push(`  Passed: ${metrics.qualityGate.passed}`);
  lines.push(`  Failed: ${metrics.qualityGate.failed}`);
  lines.push("");
  lines.push("Dimensions");
  for (const dimension of DIMENSIONS) lines.push(formatDimensionLine(dimension, metrics.dimensions[dimension]));
  lines.push("");
  lines.push("Automation decision confusion matrix (rows=expected, cols=actual)");
  for (const expected of Object.keys(metrics.automationDecisionConfusionMatrix)) {
    const row = metrics.automationDecisionConfusionMatrix[expected];
    lines.push(`  ${expected}: ` + Object.entries(row).map(([actual, count]) => `${actual}=${count}`).join(" "));
  }
  lines.push("");
  lines.push("Negative-sentinel weakness detection (self-check against each sample's own metadata.expectedWeakDimensions)");
  lines.push(`  Labeled: ${metrics.weaknessDetection.labeled}`);
  lines.push(`  Detected: ${metrics.weaknessDetection.detected}`);
  lines.push(`  Detection rate: ${formatPercentage(metrics.weaknessDetection.rate)}`);
  lines.push("");
  lines.push(`False positives on positive-kind cases (unexpected fail/partial dimension where none was labeled): ${metrics.falsePositives}`);

  const invalidSamples = samples.filter((s) => s.invalidInput);
  if (invalidSamples.length > 0) {
    lines.push("");
    lines.push("Invalid evaluation input (excluded from all quality/regression tallies)");
    for (const sample of invalidSamples) lines.push(`  - ${sample.id}: ${sample.errors.map((e) => e.message).join("; ")}`);
  }

  return lines.join("\n");
}

function run(datasetPath, options) {
  const json = Boolean(options && options.json);

  const raw = fs.readFileSync(datasetPath, "utf8");
  const dataset = JSON.parse(raw);

  const validation = validateDatasetV6(dataset);
  if (!validation.valid) {
    const output = ["Dataset v6 failed validation:", ...validation.errors.map((e) => `  - ${e}`)].join("\n");
    return { exitCode: 1, output };
  }

  const evaluation = evaluateDatasetV6(dataset);
  const output = json ? JSON.stringify(evaluation.metrics, null, 2) : formatEvaluationSummaryV6(evaluation);

  return { exitCode: 0, output };
}

function main() {
  const json = process.argv.includes("--json");
  const result = run(DEFAULT_DATASET_PATH, { json });
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

module.exports = { formatEvaluationSummaryV6, formatPercentage, run };
