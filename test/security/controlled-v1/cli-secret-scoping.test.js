"use strict";

/**
 * Controlled-v1 CLI adversarial secret scoping (mission §15, §26;
 * SEC-PROD-L03): sentinel secrets and hostile Node/npm variables planted in
 * the CLI's ambient environment must never appear in stdout, stderr,
 * reports, child argv, or the environment of a stage that does not need
 * them - and NODE_OPTIONS/NODE_PATH must not reach any child at all.
 *
 * Every run uses real isolated stage children (mock provider, offline-safe);
 * spawn calls are recorded (and still really executed) to inspect the exact
 * argv/env handed to each child.
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { cleanupScratch, baseConfig, makeRoot, hermeticEnv, runCli, spawnRecorder } = require("../../helpers/qa-agent-cli");

after(cleanupScratch);

const SENTINEL_ENV = Object.freeze({
  AI_API_KEY: "SENTINEL_AI_SECRET",
  AI_MODEL: "SENTINEL_AI_MODEL",
  GITHUB_TOKEN: "SENTINEL_GITHUB_SECRET",
  NODE_OPTIONS: "--require ./SENTINEL_NODE_OPTIONS_does_not_exist.js",
  NODE_PATH: "SENTINEL_NODE_PATH",
  NODE_DEBUG: "SENTINEL_NODE_DEBUG",
  npm_config_userconfig: "SENTINEL_NPM_CONFIG",
  UNRELATED_TOKEN: "SENTINEL_UNRELATED",
});
const SENTINEL_PATTERN = /SENTINEL_/;

function allFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function assertNoSentinelAnywhere(result, root, label) {
  assert.doesNotMatch(result.stdout, SENTINEL_PATTERN, `${label}: stdout`);
  assert.doesNotMatch(result.stderr, SENTINEL_PATTERN, `${label}: stderr`);
  for (const file of allFiles(root)) {
    if (path.basename(file) === "qa-agent.config.json") continue;
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), SENTINEL_PATTERN, `${label}: ${path.relative(root, file)}`);
  }
}

test("SEC: triage run with hostile NODE_OPTIONS/NODE_PATH and sentinel secrets succeeds - proving none is inherited - and leaks nothing", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true } }), { playwrightReport: true });
  const spy = spawnRecorder();
  const r = await runCli(["triage", "run", "--root", root, "--json"], { env: hermeticEnv(SENTINEL_ENV), spawnImpl: spy.impl });
  assert.equal(r.code, 0, `a child inheriting NODE_OPTIONS would have crashed: ${r.stderr}`);
  assert.equal(spy.calls.length, 2);
  for (const call of spy.calls) {
    assert.doesNotMatch(call.args.join(" "), SENTINEL_PATTERN, "child argv");
    for (const [key, value] of Object.entries(call.options.env)) {
      assert.doesNotMatch(key, /^(NODE_OPTIONS|NODE_PATH|NODE_DEBUG)$|^npm_|^UNRELATED/i, `child env key ${key}`);
      assert.doesNotMatch(value, SENTINEL_PATTERN, `child env ${key} carries a sentinel (mock provider needs no secret)`);
    }
  }
  assertNoSentinelAnywhere(r, root, "triage run");
});

test("SEC: --offline triage passes neither secret family to any stage", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true } }), { playwrightReport: true });
  const spy = spawnRecorder();
  const r = await runCli(["triage", "run", "--offline", "--root", root, "--json"], { env: hermeticEnv(SENTINEL_ENV), spawnImpl: spy.impl });
  assert.equal(r.code, 0, r.stderr);
  for (const call of spy.calls) {
    for (const key of ["AI_API_KEY", "AI_MODEL", "GITHUB_TOKEN"]) assert.equal(call.options.env[key], undefined, `${call.args[1]}: ${key}`);
  }
  assertNoSentinelAnywhere(r, root, "offline triage");
});

test("SEC: an allowed network provider receives AI_API_KEY only in the analyze stage, never GITHUB_TOKEN; collect receives neither", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true }, providers: { allow: ["groq"] } }), { playwrightReport: true });
  const spy = spawnRecorder({ fake: true });
  const r = await runCli(["triage", "run", "--root", root, "--json"], { env: hermeticEnv({ ...SENTINEL_ENV, AI_PROVIDER: "groq" }), spawnImpl: spy.impl });
  assert.equal(r.code, 0, r.stderr);
  const byStage = Object.fromEntries(spy.calls.map((c) => [c.args[1], c.options.env]));
  assert.equal(byStage.collect.AI_API_KEY, undefined);
  assert.equal(byStage.collect.GITHUB_TOKEN, undefined);
  assert.equal(byStage.analyze.AI_API_KEY, "SENTINEL_AI_SECRET");
  assert.equal(byStage.analyze.GITHUB_TOKEN, undefined);
  assert.doesNotMatch(r.stdout + r.stderr, SENTINEL_PATTERN);
});

test("SEC: the History stage receives GITHUB_TOKEN but never the AI secret family", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true } }));
  const spy = spawnRecorder({ fake: true });
  const r = await runCli(["triage", "history", "--root", root, "--json"], { env: hermeticEnv(SENTINEL_ENV), spawnImpl: spy.impl });
  assert.equal(r.code, 0, r.stderr);
  const env = spy.calls[0].options.env;
  assert.equal(env.GITHUB_TOKEN, "SENTINEL_GITHUB_SECRET");
  assert.equal(env.AI_API_KEY, undefined);
  assert.equal(env.AI_MODEL, undefined);
});

test("SEC: refusals and errors never echo secrets (provider not allowed, offline contradiction, credential missing)", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true } }));
  const cases = [
    { ...SENTINEL_ENV, AI_PROVIDER: "groq" },
    { ...SENTINEL_ENV, AI_PROVIDER: "SENTINEL_PROVIDER_NAME" },
  ];
  for (const env of cases) {
    for (const extra of [[], ["--offline"]]) {
      const r = await runCli(["triage", "analyze", "--root", root, "--json", ...extra], { env: hermeticEnv({ ...env, QA_AI_INVOCATION_MODE: "local-v1", QA_AI_INVOCATION_ID: "a".repeat(32) }) });
      assert.notEqual(r.code, 0);
      assert.doesNotMatch(r.stdout + r.stderr, SENTINEL_PATTERN, JSON.stringify(extra));
    }
  }
});

test("SEC: a secret-like value placed in the config is refused and never echoed", async () => {
  const root = makeRoot({ ...baseConfig(), apiKey: "SENTINEL_CONFIG_SECRET" });
  for (const argv of [["config", "validate"], ["info"], ["triage", "run"]]) {
    const r = await runCli([...argv, "--root", root, "--json"]);
    assert.equal(r.code, 3, argv.join(" "));
    assert.equal(r.json.errors[0].code, "CONFIG_SCHEMA_INVALID");
    assert.doesNotMatch(r.stdout + r.stderr, SENTINEL_PATTERN);
  }
});

test("SEC: the requirements check report never contains environment values", async () => {
  const root = makeRoot(baseConfig({ requirements: { source: "file", path: "qa/requirements.json" } }));
  fs.mkdirSync(path.join(root, "qa"));
  fs.writeFileSync(
    path.join(root, "qa", "requirements.json"),
    JSON.stringify({ schemaVersion: 1, requirements: [{ id: "REQ-1", type: "requirement", title: "T", content: "When X is submitted, Y is returned." }] })
  );
  const r = await runCli(["requirements", "check", "--root", root, "--json"], { env: hermeticEnv(SENTINEL_ENV) });
  assert.equal(r.code, 0, r.stderr);
  assertNoSentinelAnywhere(r, root, "requirements check");
});

test("SEC: the CLI parent never serializes or copies process.env (static)", () => {
  const dir = path.join(__dirname, "..", "..", "..", "scripts", "ai", "cli");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /JSON\.stringify\(\s*(process\.)?env\b/, file);
    assert.doesNotMatch(src, /\.\.\.\s*process\.env|Object\.assign\([^)]*process\.env/, file);
    if (file !== "qa-agent.js") assert.doesNotMatch(src, /process\.env/, `${file} must receive env explicitly`);
  }
});
