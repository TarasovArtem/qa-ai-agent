"use strict";

/**
 * `qa-agent triage *` through REAL isolated stage children (mock provider,
 * offline-safe): the thin orchestration reuses the certified stages and
 * preserves XI-01 (invocation identity), XI-02 (separate History artifact,
 * unavailable != zero) and TSB-F04/F06/F07 (closed provider envelope,
 * bounded persisted context) with no CLI bypass.
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { classifyStageFailure, resolveInvocation, stripProviderPayload, sanitizeDiagnostics } = require("./triage");
const { cleanupScratch, baseConfig, makeRoot, hermeticEnv, runCli } = require("../../../test/helpers/qa-agent-cli");

after(cleanupScratch);

const TRIAGE = baseConfig({ capabilities: { triage: true } });
const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);
const local = (id) => ({ QA_AI_INVOCATION_MODE: "local-v1", QA_AI_INVOCATION_ID: id });

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, ...rel.split("/")), "utf8"));
}

test("triage run --offline: collect -> analyze in isolated children with the mock provider; artifacts are the existing triage reports", async () => {
  const root = makeRoot(TRIAGE, { playwrightReport: true });
  const r = await runCli(["triage", "run", "--offline", "--root", root, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.stages, ["collect", "analyze"]);
  assert.deepEqual(r.json.artifacts, ["reports/ai/context.json", "reports/ai/ai-report.json"]);
  assert.equal(r.json.invocation.mode, "local-v1-orchestrated");
  const context = readJson(root, "reports/ai/context.json");
  assert.equal(context.metadata.invocationMode, "local-v1");
  assert.match(context.metadata.localInvocationId, /^[0-9a-f]{32}$/);
  assert.equal(context.metadata.projectId, "cli-web");
  assert.equal(context.metadata.framework, "playwright", "framework comes from config");
  assert.equal(Object.prototype.hasOwnProperty.call(context, "history"), false, "XI-02: no context.history");
  const report = readJson(root, "reports/ai/ai-report.json");
  assert.equal(report.analysis.provider, "mock");
  assert.equal(report.results.length, context.failedTests.length, "TSB-F04: one result per failed test");
  assert.match(r.stderr, /\[ai:collect\]/, "stage logs go to stderr");
  assert.doesNotMatch(r.stdout, /\[ai:/, "stdout carries only the result");
});

test("triage per-stage (XI-01): collect and analyze with the same caller-supplied id succeed", async () => {
  const root = makeRoot(TRIAGE, { playwrightReport: true });
  const collect = await runCli(["triage", "collect", "--root", root, "--json"], { env: hermeticEnv(local(ID_A)) });
  assert.equal(collect.code, 0, collect.stderr);
  assert.equal(collect.json.invocation.mode, "local-v1-caller-supplied");
  assert.equal(readJson(root, "reports/ai/context.json").metadata.localInvocationId, ID_A);
  const analyze = await runCli(["triage", "analyze", "--root", root, "--json"], { env: hermeticEnv(local(ID_A)) });
  assert.equal(analyze.code, 0, analyze.stderr);
  assert.deepEqual(analyze.json.artifacts, ["reports/ai/ai-report.json"]);
});

test("triage per-stage (XI-01): persisted context cannot be rebound to a fresh id (exit 4, no report)", async () => {
  const root = makeRoot(TRIAGE, { playwrightReport: true });
  assert.equal((await runCli(["triage", "collect", "--root", root], { env: hermeticEnv(local(ID_A)) })).code, 0);
  const r = await runCli(["triage", "analyze", "--root", root, "--json"], { env: hermeticEnv(local(ID_B)) });
  assert.equal(r.code, 4, r.stderr);
  assert.equal(r.json.errors[0].code, "TRIAGE_INPUT_REFUSED");
  assert.match(r.json.errors[0].message, /TRIAGE_CONTEXT_INVOCATION_MISMATCH/);
  assert.equal(fs.existsSync(path.join(root, "reports", "ai", "ai-report.json")), false);
});

test("triage per-stage (XI-01): the stage's own grammar check refuses an invalid caller-supplied identity (exit 5)", async () => {
  const root = makeRoot(TRIAGE, { playwrightReport: true });
  for (const env of [{ QA_AI_INVOCATION_MODE: "local-v2", QA_AI_INVOCATION_ID: ID_A }, local("not-hex")]) {
    const r = await runCli(["triage", "collect", "--root", root, "--json"], { env: hermeticEnv(env) });
    assert.equal(r.code, 5, r.stderr);
    assert.equal(r.json.errors[0].code, "INVOCATION_IDENTITY_REFUSED");
  }
  assert.equal(fs.existsSync(path.join(root, "reports", "ai", "context.json")), false);
});

test("triage (XI-01): github-actions-v1 is honored from the platform tuple and never fabricated", async () => {
  const root = makeRoot(TRIAGE, { playwrightReport: true });
  const gh = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "synthetic-owner/synthetic-repo", GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "1001", GITHUB_RUN_ATTEMPT: "1" };
  const r = await runCli(["triage", "run", "--offline", "--root", root, "--json"], { env: hermeticEnv(gh) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.invocation.mode, "github-actions-v1");
  const meta = readJson(root, "reports/ai/context.json").metadata;
  assert.equal(meta.invocationMode, "github-actions-v1");
  assert.equal(meta.runId, "1001");
  const broken = await runCli(["triage", "collect", "--root", root, "--json"], { env: hermeticEnv({ ...gh, GITHUB_SHA: "short" }) });
  assert.equal(broken.code, 5);
  assert.equal(broken.json.errors[0].code, "INVOCATION_IDENTITY_REFUSED");
});

test("triage analyze: a missing context is refused as input (exit 4)", async () => {
  const root = makeRoot(TRIAGE);
  const r = await runCli(["triage", "analyze", "--root", root, "--json"], { env: hermeticEnv(local(ID_A)) });
  assert.equal(r.code, 4, r.stderr);
  assert.equal(r.json.errors[0].code, "TRIAGE_INPUT_REFUSED");
});

test("triage analyze (XI-02): a context carrying embedded history is refused (exit 4)", async () => {
  const root = makeRoot(TRIAGE, { playwrightReport: true });
  assert.equal((await runCli(["triage", "collect", "--root", root], { env: hermeticEnv(local(ID_A)) })).code, 0);
  const file = path.join(root, "reports", "ai", "context.json");
  const context = JSON.parse(fs.readFileSync(file, "utf8"));
  context.history = { available: true, passes: 0, failures: 0 };
  fs.writeFileSync(file, JSON.stringify(context));
  const r = await runCli(["triage", "analyze", "--root", root, "--json"], { env: hermeticEnv(local(ID_A)) });
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.json.errors[0].message, /TRIAGE_CONTEXT_EMBEDDED_HISTORY/);
});

test("triage analyze (TSB-F07): an over-bound persisted context is refused before parsing (exit 4)", async () => {
  const root = makeRoot(TRIAGE);
  fs.mkdirSync(path.join(root, "reports", "ai"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports", "ai", "context.json"), Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
  const r = await runCli(["triage", "analyze", "--root", root, "--json"], { env: hermeticEnv(local(ID_A)) });
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.json.errors[0].message, /TRIAGE_ARTIFACT_TOO_LARGE/);
});

test("triage history (XI-02): without GITHUB_TOKEN it writes the bounded unavailable marker - never fabricated zero history - and makes no network call", async () => {
  const root = makeRoot(TRIAGE);
  const r = await runCli(["triage", "history", "--root", root, "--json"], { env: hermeticEnv({ TEST_BROWSER: "chromium" }) });
  assert.equal(r.code, 0, r.stderr);
  const history = readJson(root, "reports/ai/history.json");
  assert.equal(history.available, false);
  assert.equal(history.passes, undefined);
});

test("triage aggregate: with no browser inputs it is a successful no-op", async () => {
  const root = makeRoot(TRIAGE);
  const r = await runCli(["triage", "aggregate", "--root", root, "--json"], { env: hermeticEnv(local(ID_A)) });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.artifacts, []);
});

test("triage: a frameworkRuntime bound to the config flows into the collect stage (validated values only)", async () => {
  const config = baseConfig({
    capabilities: { triage: true },
    frameworkRuntime: {
      schemaVersion: 1,
      projectId: "cli-web",
      framework: "playwright",
      frameworkConfigPath: "playwright.config.js",
      testSourceRoot: "playwright",
      reports: { reportFile: "custom/pw.json" },
      historyWorkflowFile: "e2e.yml",
    },
  });
  const root = makeRoot(config);
  fs.mkdirSync(path.join(root, "custom"));
  fs.copyFileSync(require("../../../test/helpers/qa-agent-cli").PLAYWRIGHT_FIXTURE, path.join(root, "custom", "pw.json"));
  const r = await runCli(["triage", "run", "--offline", "--root", root, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(readJson(root, "reports/ai/context.json").failedTests.length > 0, "the configured report file was used");
});

// --- failure classification (pure) ---------------------------------------------------

test("classification: provider runtime and malformed model output are exit 6; stage refusals map to their classes", () => {
  const cases = [
    [{ result: null, stderr: "[ai:analyze] Error: AI provider request failed (AUTH): Provider authentication failed\n" }, 6, "PROVIDER_FAILURE"],
    [{ result: null, stderr: "x\n[ai:analyze] Error: AI provider response failed validation: TRIAGE_PROVIDER_RESULT_BINDING: ...\n" }, 6, "PROVIDER_FAILURE"],
    [{ result: null, stderr: "[ai:analyze] Error: AI provider response was not valid JSON: Unexpected token\n" }, 6, "PROVIDER_FAILURE"],
    [{ result: { ok: false, message: "TRIAGE_INVOCATION_MODE_REQUIRED: no trusted invocation mode" }, stderr: "" }, 5, "INVOCATION_IDENTITY_REFUSED"],
    [{ result: { ok: false, message: "WRITE_PATH_OUTSIDE_REPOSITORY: x" }, stderr: "" }, 5, "WRITE_TARGET_REFUSED"],
    [{ result: null, stderr: "[ai:analyze] Error: reports/ai/context.json not found.\n" }, 4, "TRIAGE_INPUT_REFUSED"],
    [{ result: { ok: false, message: "FRAMEWORK_RUNTIME_CONFIG_INVALID: x" }, stderr: "" }, 3, "STAGE_CONFIGURATION_INVALID"],
    [{ result: { ok: false, message: "something unexpected" }, stderr: "" }, 1, "STAGE_FAILED"],
    [{ spawnError: true }, 1, "STAGE_SPAWN_FAILED"],
  ];
  for (const [outcome, exitCode, code] of cases) {
    const err = classifyStageFailure("analyze", { stderr: "", ...outcome });
    assert.equal(err.exitCode, exitCode, JSON.stringify(outcome));
    assert.equal(err.code, code, JSON.stringify(outcome));
    assert.ok(err.message.length <= 515);
  }
});

test("classification: a non-JSON model response never leaks the parser's quoted payload fragment into errors[] or diagnostics", () => {
  const stderr = `[ai:analyze] Error: AI provider response was not valid JSON: Unexpected token 'S', "SENTINEL_MODEL_OUTPUT" is not valid JSON\n`;
  const err = classifyStageFailure("analyze", { result: null, stderr });
  assert.equal(err.exitCode, 6);
  assert.doesNotMatch(err.message, /SENTINEL_MODEL_OUTPUT/);
  assert.match(err.message, /^AI provider response was not valid JSON \(parser detail withheld\)\.$/);
  assert.doesNotMatch(stripProviderPayload(stderr), /SENTINEL_MODEL_OUTPUT/);
});

test("diagnostics: forwarded child output never carries stack frames", () => {
  const text = "Error: boom\n    at Object.<anonymous> (/x/y.js:1:1)\n\tat Module._compile (node:internal)\n[ai:collect] wrote reports/ai/context.json\n";
  assert.equal(sanitizeDiagnostics(text), "Error: boom\n[ai:collect] wrote reports/ai/context.json\n");
});

test("invocation resolution: triage run generates a 128-bit CSPRNG id; history needs no identity", () => {
  const run = resolveInvocation({ stage: "run", env: {}, platform: "linux" });
  assert.equal(run.mode, "local-v1");
  assert.match(run.id, /^[0-9a-f]{32}$/);
  assert.equal(resolveInvocation({ stage: "history", env: {}, platform: "linux" }).mode, "none");
});
