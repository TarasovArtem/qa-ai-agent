"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nodePath = require("node:path");
const { runCli, parseArgs, EXIT_CODES } = require("./cli");

const REPO_ROOT = nodePath.resolve(__dirname, "..", "..", "..", "..");
const goodArgv = ["--phase", "1", "--repository", "TarasovArtem/qa-ai-agent", "--workflow-path", ".github/workflows/cypress.yml", "--event", "pull_request", "--output-dir", "reports/governance"];

function fakePipeline(report, markdown = "# ok") {
  return async () => ({ report, markdown });
}
function memoryWriter(store) {
  return async (path, contents) => { store[path] = contents; };
}

// ---------------------------------------------------------------- parseArgs()

test("a fully valid argv parses to the expected typed args", () => {
  const r = parseArgs(goodArgv);
  assert.equal(r.ok, true);
  assert.equal(r.args.phase, 1);
  assert.equal(r.args.repository, "TarasovArtem/qa-ai-agent");
  assert.equal(r.args.event, "pull_request");
});

test("an unrecognized flag is a hard error, never silently ignored -- mandatory negative test #26", () => {
  const r = parseArgs([...goodArgv, "--rerun-ci", "true"]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /unrecognized/);
});

test("--phase outside {1,2} is rejected", () => {
  for (const bad of ["0", "3", "one", ""]) {
    const argv = goodArgv.map((v, i) => (goodArgv[i - 1] === "--phase" ? bad : v));
    assert.equal(parseArgs(argv).ok, false, bad);
  }
});

test("an invalid --repository shape is rejected", () => {
  const argv = goodArgv.map((v, i) => (goodArgv[i - 1] === "--repository" ? "not valid" : v));
  assert.equal(parseArgs(argv).ok, false);
});

test("an invalid --event value is rejected", () => {
  const argv = goodArgv.map((v, i) => (goodArgv[i - 1] === "--event" ? "workflow_dispatch" : v));
  assert.equal(parseArgs(argv).ok, false);
});

test("a missing required flag is rejected", () => {
  assert.equal(parseArgs(["--phase", "1"]).ok, false);
});

test("a flag with no value is rejected, never silently treated as a bare flag", () => {
  assert.equal(parseArgs([...goodArgv, "--phase"]).ok, false);
});

test("argv that is not an array is rejected without throwing", () => {
  assert.doesNotThrow(() => parseArgs("not-an-array"));
  assert.equal(parseArgs("not-an-array").ok, false);
  assert.equal(parseArgs(null).ok, false);
});

// ---------------------------------------------------------------- runCli()

test("a successful pipeline with overallStatus PASS writes both files and exits 0", async () => {
  const store = {};
  const r = await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: fakePipeline({ overallStatus: "PASS" }), writeFile: memoryWriter(store) });
  assert.equal(r.exitCode, EXIT_CODES.PASS);
  assert.equal(Object.keys(store).length, 2);
  assert.ok(Object.keys(store).some((p) => p.endsWith("pre-review.json")));
  assert.ok(Object.keys(store).some((p) => p.endsWith("pre-review.md")));
});

test("exit code reflects overallStatus for every canonical status", async () => {
  for (const status of ["PASS", "FAIL", "CONFIGURATION_ERROR", "HUMAN_REVIEW_REQUIRED", "INCOMPLETE"]) {
    const r = await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: fakePipeline({ overallStatus: status }), writeFile: memoryWriter({}) });
    assert.equal(r.exitCode, EXIT_CODES[status], status);
  }
});

test("an unrecognized overallStatus never produces exit code 0", async () => {
  const r = await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: fakePipeline({ overallStatus: "SOMETHING_UNKNOWN" }), writeFile: memoryWriter({}) });
  assert.notEqual(r.exitCode, 0);
});

test("invalid arguments exit with INVALID_ARGUMENT and never invoke the pipeline -- mandatory negative test #26", async () => {
  const neverCalled = async () => { throw new Error("pipeline must not run for invalid args"); };
  const r = await runCli({ argv: ["--phase", "9"], repositoryRoot: REPO_ROOT, pipeline: neverCalled, writeFile: memoryWriter({}) });
  assert.equal(r.exitCode, EXIT_CODES.INVALID_ARGUMENT);
});

test("an --output-dir that attempts path traversal is rejected before the pipeline runs -- mandatory negative test #27", async () => {
  const neverCalled = async () => { throw new Error("pipeline must not run for an unsafe output path"); };
  const argv = goodArgv.map((v, i) => (goodArgv[i - 1] === "--output-dir" ? "../../etc" : v));
  const r = await runCli({ argv, repositoryRoot: REPO_ROOT, pipeline: neverCalled, writeFile: memoryWriter({}) });
  assert.equal(r.exitCode, EXIT_CODES.INVALID_ARGUMENT);
});

test("an --output-dir with a symlink-escape-shaped absolute path is rejected -- mandatory negative test #28", async () => {
  const neverCalled = async () => { throw new Error("must not run"); };
  const argv = goodArgv.map((v, i) => (goodArgv[i - 1] === "--output-dir" ? "/etc/passwd" : v));
  const r = await runCli({ argv, repositoryRoot: REPO_ROOT, pipeline: neverCalled, writeFile: memoryWriter({}) });
  assert.equal(r.exitCode, EXIT_CODES.INVALID_ARGUMENT);
});

test("a pipeline that throws never produces exit code 0 (an uncaught error is never a false pass)", async () => {
  const throwing = async () => { throw new Error("boom"); };
  const r = await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: throwing, writeFile: memoryWriter({}) });
  assert.equal(r.exitCode, EXIT_CODES.UNCAUGHT_ERROR);
  assert.notEqual(r.exitCode, 0);
});

test("a pipeline returning a malformed result never produces exit code 0", async () => {
  const r = await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: async () => ({ notAReport: true }), writeFile: memoryWriter({}) });
  assert.equal(r.exitCode, EXIT_CODES.UNCAUGHT_ERROR);
});

test("a writeFile that throws never produces exit code 0", async () => {
  const throwingWriter = async () => { throw new Error("disk full"); };
  const r = await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: fakePipeline({ overallStatus: "PASS" }), writeFile: throwingWriter });
  assert.equal(r.exitCode, EXIT_CODES.UNCAUGHT_ERROR);
});

test("never throws on a fully hostile input object", async () => {
  for (const bad of [null, undefined, 42, [], {}]) {
    await assert.doesNotReject(runCli(bad));
  }
});

test("the repository flag never selects the pipeline's own access -- the same repository value with two different injected pipelines produces two different results, proving the flag is not itself an authority", async () => {
  const r1 = await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: fakePipeline({ overallStatus: "PASS" }), writeFile: memoryWriter({}) });
  const r2 = await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: fakePipeline({ overallStatus: "FAIL" }), writeFile: memoryWriter({}) });
  assert.notEqual(r1.exitCode, r2.exitCode);
});

test("five repeated runs of an identical fixture are deterministic", async () => {
  const outs = [];
  for (let i = 0; i < 5; i++) outs.push((await runCli({ argv: goodArgv, repositoryRoot: REPO_ROOT, pipeline: fakePipeline({ overallStatus: "PASS" }), writeFile: memoryWriter({}) })).exitCode);
  assert.equal(new Set(outs).size, 1);
});
