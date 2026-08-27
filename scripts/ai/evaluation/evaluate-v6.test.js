"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { run, formatPercentage } = require("./evaluate-v6");

const DATASET_PATH = path.join(__dirname, "dataset-v6.json");

test("run() on the real dataset succeeds with exitCode 0", () => {
  const result = run(DATASET_PATH, {});
  assert.equal(result.exitCode, 0);
  assert.ok(result.output.includes("Test Design Quality Evaluation"));
});

test("run() with --json produces valid, parseable JSON metrics", () => {
  const result = run(DATASET_PATH, { json: true });
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.output);
  assert.equal(parsed.totalSamples, 9);
  assert.equal(parsed.invalidInputCount, 0);
});

test("run() reports non-zero exitCode and a bounded error list on a schema-invalid dataset file", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const tmpPath = path.join(os.tmpdir(), `dataset-v6-invalid-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify({ version: 999, samples: [] }));
  t.after(() => fs.unlinkSync(tmpPath));

  const result = run(tmpPath, {});
  assert.equal(result.exitCode, 1);
  assert.ok(result.output.includes("failed validation"));
});

test("formatPercentage: null -> N/A, never throws on 0", () => {
  assert.equal(formatPercentage(null), "N/A");
  assert.equal(formatPercentage(0), "0.0%");
  assert.equal(formatPercentage(1), "100.0%");
});

test("run() output never contains a raw stack trace or provider/environment content", () => {
  const result = run(DATASET_PATH, {});
  assert.ok(!/at Object\.<anonymous>/.test(result.output));
  assert.ok(!/GROQ_API_KEY|AI_API_KEY/.test(result.output));
});
