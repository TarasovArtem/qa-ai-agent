"use strict";

/**
 * Child environment allowlist (mission §14-§15) and child isolation
 * (ARCH-PROD-C1-m02): closed per-stage env built from {}, secret families
 * scoped per stage, never-inherited keys, Windows case-insensitive lookup,
 * and the exact spawn shape (process.execPath, fixed package-relative
 * entrypoint, argv array, shell:false, no npm).
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildStageEnv, PLATFORM_BASELINE_KEYS } = require("./child-env");
const { STAGE_RUNNER_PATH, redact } = require("./stage-process");
const { resolveProvider } = require("./policy");
const { cleanupScratch, baseConfig, makeRoot, hermeticEnv, runCli, spawnRecorder } = require("../../../test/helpers/qa-agent-cli");

after(cleanupScratch);

const SENTINELS = {
  AI_API_KEY: "SENTINEL_AI_SECRET",
  AI_MODEL: "sentinel-model",
  GITHUB_TOKEN: "SENTINEL_GITHUB_SECRET",
  NODE_OPTIONS: "--require /nonexistent/SENTINEL_NODE_OPTIONS.js",
  NODE_PATH: "/nonexistent/SENTINEL_NODE_PATH",
  NODE_DEBUG: "SENTINEL_NODE_DEBUG",
  npm_config_registry: "https://SENTINEL_NPM.invalid",
  npm_lifecycle_event: "chrome",
  UNRELATED_SECRET: "SENTINEL_UNRELATED",
};

const AMBIENT = {
  PATH: "/usr/bin",
  HOME: "/home/u",
  TEMP: "/tmp",
  CI: "true",
  TEST_BROWSER: "chromium",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_API_URL: "https://api.github.example",
  HISTORY_RUNS: "5",
  ...SENTINELS,
};

const LOCAL = Object.freeze({ mode: "local-v1", id: "a".repeat(32) });
const GH = Object.freeze({ mode: "github-actions-v1" });

function provider(name, { offline = false } = {}) {
  return resolveProvider({ env: { AI_PROVIDER: name, AI_API_KEY: "k", AI_MODEL: "m" }, platform: "linux", offline, allow: ["mock", "groq", "gemini"] });
}

test("child env: collect receives only the platform baseline, QA_FRAMEWORK, TEST_BROWSER and the local-v1 pair", () => {
  const env = buildStageEnv({ stage: "collect", env: AMBIENT, platform: "linux", framework: "playwright", invocation: LOCAL, offline: false });
  assert.deepEqual(Object.keys(env).sort(), ["CI", "HOME", "PATH", "QA_AI_INVOCATION_ID", "QA_AI_INVOCATION_MODE", "QA_FRAMEWORK", "TEMP", "TEST_BROWSER"]);
  assert.equal(env.QA_FRAMEWORK, "playwright");
  assert.ok(Object.isFrozen(env));
});

test("child env: no stage ever receives NODE_OPTIONS / NODE_PATH / NODE_DEBUG / npm_* / unrelated keys", () => {
  for (const stage of ["collect", "history", "aggregate", "analyze"]) {
    const env = buildStageEnv({ stage, env: AMBIENT, platform: "linux", framework: "cypress", invocation: LOCAL, provider: provider("groq"), offline: false });
    for (const key of Object.keys(env)) {
      assert.doesNotMatch(key, /^(NODE_OPTIONS|NODE_PATH|NODE_DEBUG)$|^npm_|^UNRELATED/i, `${stage}: ${key}`);
    }
    const values = Object.values(env).join("\n");
    assert.doesNotMatch(values, /SENTINEL_NODE|SENTINEL_NPM|SENTINEL_UNRELATED/, stage);
  }
});

test("child env (SEC-PROD-L03): the AI secret family reaches only analyze with a network provider", () => {
  for (const stage of ["collect", "history", "aggregate"]) {
    const env = buildStageEnv({ stage, env: AMBIENT, platform: "linux", framework: "cypress", invocation: LOCAL, provider: provider("groq"), offline: false });
    assert.equal(env.AI_API_KEY, undefined, stage);
    assert.equal(env.AI_MODEL, undefined, stage);
    assert.equal(env.AI_PROVIDER, undefined, stage);
  }
  const groq = buildStageEnv({ stage: "analyze", env: AMBIENT, platform: "linux", framework: "cypress", invocation: LOCAL, provider: provider("groq"), offline: false });
  assert.equal(groq.AI_PROVIDER, "groq");
  assert.equal(groq.AI_API_KEY, "SENTINEL_AI_SECRET");
  assert.equal(groq.AI_MODEL, "sentinel-model");
  const mock = buildStageEnv({ stage: "analyze", env: AMBIENT, platform: "linux", framework: "cypress", invocation: LOCAL, provider: provider("mock"), offline: false });
  assert.equal(mock.AI_PROVIDER, "mock");
  assert.equal(mock.AI_API_KEY, undefined, "mock never receives the key");
  assert.equal(mock.AI_MODEL, undefined);
  const offline = buildStageEnv({ stage: "analyze", env: AMBIENT, platform: "linux", framework: "cypress", invocation: LOCAL, provider: provider("mock", { offline: true }), offline: true });
  assert.equal(offline.AI_API_KEY, undefined, "offline never receives the key");
});

test("child env (SEC-PROD-L03): the GitHub secret family reaches only the History stage, never offline", () => {
  for (const stage of ["collect", "aggregate", "analyze"]) {
    const env = buildStageEnv({ stage, env: AMBIENT, platform: "linux", framework: "cypress", invocation: LOCAL, provider: provider("mock"), offline: false });
    assert.equal(env.GITHUB_TOKEN, undefined, stage);
  }
  const history = buildStageEnv({ stage: "history", env: AMBIENT, platform: "linux", framework: "cypress", invocation: LOCAL, offline: false });
  assert.equal(history.GITHUB_TOKEN, "SENTINEL_GITHUB_SECRET");
  assert.equal(history.GITHUB_REPOSITORY, "o/r");
  assert.equal(history.HISTORY_RUNS, "5");
  assert.equal(history.QA_AI_INVOCATION_ID, undefined, "History is not bound to the invocation");
  assert.throws(() => buildStageEnv({ stage: "history", env: AMBIENT, platform: "linux", framework: "cypress", invocation: LOCAL, offline: true }));
});

test("child env (XI-01): github-actions-v1 forwards the platform tuple; local-v1 never carries GITHUB_ACTIONS", () => {
  const ambient = { ...AMBIENT, GITHUB_ACTIONS: "true", GITHUB_SHA: "f".repeat(40), GITHUB_RUN_ID: "7", GITHUB_RUN_ATTEMPT: "1", GITHUB_REF_NAME: "main" };
  const gh = buildStageEnv({ stage: "collect", env: ambient, platform: "linux", framework: "cypress", invocation: GH, offline: false });
  assert.equal(gh.GITHUB_ACTIONS, "true");
  assert.equal(gh.GITHUB_SHA, "f".repeat(40));
  assert.equal(gh.GITHUB_REF_NAME, "main");
  assert.equal(gh.QA_AI_INVOCATION_MODE, undefined);
  const local = buildStageEnv({ stage: "collect", env: ambient, platform: "linux", framework: "cypress", invocation: LOCAL, offline: false });
  assert.equal(local.GITHUB_ACTIONS, undefined);
  assert.equal(local.GITHUB_SHA, undefined);
  assert.equal(local.QA_AI_INVOCATION_ID, "a".repeat(32));
});

test("child env (XI-01): a caller-supplied local mode value is forwarded verbatim, never normalized", () => {
  const env = buildStageEnv({ stage: "analyze", env: AMBIENT, platform: "linux", framework: "cypress", invocation: { mode: "local-v1", id: "zz", modeValue: "bogus" }, provider: provider("mock"), offline: false });
  assert.equal(env.QA_AI_INVOCATION_MODE, "bogus");
  assert.equal(env.QA_AI_INVOCATION_ID, "zz");
});

test("child env: on Windows keys are matched case-insensitively (Path, node_options)", () => {
  const ambient = { Path: "C:\\Windows", SystemRoot: "C:\\Windows", node_options: "--require x", Ai_Api_Key: "SENTINEL_AI_SECRET", AI_MODEL: "m" };
  const env = buildStageEnv({ stage: "analyze", env: ambient, platform: "win32", framework: "cypress", invocation: LOCAL, provider: provider("groq"), offline: false });
  assert.equal(env.PATH, "C:\\Windows");
  assert.equal(env.SYSTEMROOT, "C:\\Windows");
  assert.equal(env.AI_API_KEY, "SENTINEL_AI_SECRET");
  assert.ok(!Object.keys(env).some((k) => k.toUpperCase() === "NODE_OPTIONS"));
  const linux = buildStageEnv({ stage: "collect", env: { Path: "/x" }, platform: "linux", framework: "cypress", invocation: LOCAL, offline: false });
  assert.equal(linux.PATH, undefined, "POSIX lookups stay case-sensitive");
});

test("child env: the platform baseline is exactly the documented list", () => {
  assert.deepEqual([...PLATFORM_BASELINE_KEYS], ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CI"]);
});

test("child env: the builder never copies process.env (static)", () => {
  const src = fs.readFileSync(path.join(__dirname, "child-env.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /process\.env/);
  assert.doesNotMatch(src, /\.\.\.\s*env\b|Object\.assign\(\s*\{\}\s*,\s*env/);
});

// --- spawn shape ------------------------------------------------------------------

test("child isolation: every stage is spawned as process.execPath + fixed package-relative entrypoint, argv array, shell:false, IPC, closed env", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true }, providers: { allow: ["mock", "groq"] } }));
  const spy = spawnRecorder({ fake: true });
  const env = hermeticEnv({ ...SENTINELS, AI_PROVIDER: "groq" });
  const r = await runCli(["triage", "run", "--root", root, "--json"], { env, spawnImpl: spy.impl });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(spy.calls.length, 2);
  assert.deepEqual(spy.calls.map((c) => c.args[1]), ["collect", "analyze"]);
  for (const call of spy.calls) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.args.length, 2);
    assert.equal(call.args[0], STAGE_RUNNER_PATH);
    assert.equal(path.isAbsolute(call.args[0]), true);
    assert.equal(path.dirname(call.args[0]), __dirname, "entrypoint resolved package-relatively");
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe", "ipc"]);
    assert.equal(call.options.cwd, fs.realpathSync(root));
    assert.ok(!/npm|npx|cmd\.exe|\/bin\/sh/i.test(`${call.command} ${call.args.join(" ")}`));
    for (const key of Object.keys(call.options.env)) assert.doesNotMatch(key, /^(NODE_OPTIONS|NODE_PATH|NODE_DEBUG)$|^npm_|^UNRELATED/i);
    assert.equal(call.args.join(" ").includes("SENTINEL"), false, "no secret in child argv");
  }
  const [collect, analyze] = spy.calls.map((c) => c.options.env);
  assert.equal(collect.AI_API_KEY, undefined);
  assert.equal(collect.GITHUB_TOKEN, undefined);
  assert.equal(analyze.AI_API_KEY, "SENTINEL_AI_SECRET", "the key reaches only the provider-consuming stage");
  assert.equal(analyze.GITHUB_TOKEN, undefined);
  assert.equal(collect.QA_AI_INVOCATION_ID, analyze.QA_AI_INVOCATION_ID, "one invocation id per logical run");
  assert.match(collect.QA_AI_INVOCATION_ID, /^[0-9a-f]{32}$/);
  assert.equal(collect.GITHUB_ACTIONS, undefined, "the CLI never sets GITHUB_ACTIONS");
});

test("child isolation: each triage run generates a fresh invocation id", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true } }));
  const ids = new Set();
  for (let i = 0; i < 3; i++) {
    const spy = spawnRecorder({ fake: true });
    await runCli(["triage", "run", "--root", root], { env: hermeticEnv(), spawnImpl: spy.impl });
    ids.add(spy.calls[0].options.env.QA_AI_INVOCATION_ID);
  }
  assert.equal(ids.size, 3);
});

test("child isolation: the stage runner refuses to run outside the CLI (no IPC channel)", () => {
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(process.execPath, [STAGE_RUNNER_PATH, "collect"], { env: hermeticEnv(), encoding: "utf8", shell: false });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /internal qa-agent entrypoint/);
});

test("redaction: known secret values are removed from forwarded diagnostics", () => {
  assert.equal(redact("token SENTINEL_GITHUB_SECRET and SENTINEL_AI_SECRET", ["SENTINEL_GITHUB_SECRET", "SENTINEL_AI_SECRET", "", "ab"]), "token [REDACTED] and [REDACTED]");
});
