"use strict";

/**
 * Controlled-v1 Stage 3 external tarball proof (OD-02; docs/package-surface-v4.md):
 *
 *   real `npm pack` -> temp external repository OUTSIDE the checkout ->
 *   real `npm install <tarball>` -> the INSTALLED `qa-agent` runs
 *   design -> plan -> generate -> review show against that repository.
 *
 * The installed package is used unmodified. The only test addition is a
 * harness preloaded into the CLI parent (`node --require <harness>`) that,
 * for the generative child only, adds `--require <provider double>` - both
 * files live in a scratch directory outside the package and outside the
 * target repository. Every product module (CLI, runner, generators,
 * validators) is loaded from node_modules/qa-ai-agent, which the child's
 * own module list proves.
 *
 * Also proves: exact installed inventory; Stage 3 private files present and
 * excluded files absent; closure over the installed files; deep imports
 * denied; zero runtime dependencies; refusals through the real npx bin
 * shim; no checkout reference; installed package not mutated; and a
 * deliberately broken copy (one required private runtime file removed)
 * fails both the static closure proof and at runtime.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync, spawnSync } = require("node:child_process");

const inv = require("../helpers/package-inventory");
const fx = require("../helpers/stage3-fixtures");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DOUBLE_SOURCE = path.join(REPO_ROOT, "test", "helpers", "generative-provider-double.js");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "qa-agent-stage3-external-"));
const external = path.join(scratch, "target-repo");
const harnessDir = path.join(scratch, "harness");
let installed;
let installedPkg;
let installedHashBefore;
let targetSourceBefore;
let runId;

function minimalEnv(extra = {}) {
  const env = {};
  for (const key of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  env.npm_config_offline = "true";
  env.npm_config_update_notifier = "false";
  env.npm_config_fund = "false";
  env.npm_config_audit = "false";
  return { ...env, ...extra };
}

function parseJson(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  return lines.length === 1 ? JSON.parse(lines[0]) : null;
}

// Through the real npm bin shim (npx is npx.cmd on Windows -> shell; every
// interpolated value is a test constant).
function npx(args, env = minimalEnv()) {
  const r = spawnSync(`npx --no -- qa-agent ${args}`, { cwd: external, env, encoding: "utf8", shell: true, timeout: 120000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: args.includes("--json") ? parseJson(r.stdout) : null };
}

// The installed bin target, optionally with the test harness preloaded.
function installedCli(args, { env = minimalEnv(), responses } = {}) {
  const pre = [];
  let extra = {};
  if (responses) {
    const scriptFile = path.join(harnessDir, `script-${crypto.randomBytes(4).toString("hex")}.json`);
    const loadedLog = `${scriptFile}.loaded.json`;
    const spawnLog = `${scriptFile}.spawn.json`;
    fs.writeFileSync(scriptFile, JSON.stringify({ responses, loadedLog }));
    pre.push("--require", path.join(harnessDir, "spawn-harness.js"));
    extra = { QA_AGENT_TEST_PROVIDER_SCRIPT: scriptFile, QA_AGENT_TEST_SPAWN_LOG: spawnLog };
    const r = spawnSync(process.execPath, [...pre, path.join(installed, installedPkg.bin["qa-agent"]), ...args], { cwd: external, env: { ...env, ...extra }, encoding: "utf8", shell: false, timeout: 120000 });
    const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: parseJson(r.stdout), loaded: read(loadedLog), spawned: read(spawnLog) };
  }
  const r = spawnSync(process.execPath, [path.join(installed, installedPkg.bin["qa-agent"]), ...args], { cwd: external, env, encoding: "utf8", shell: false, timeout: 120000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: parseJson(r.stdout) };
}

function hashTree(dir, { exclude = [] } = {}) {
  const out = {};
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join("/");
      if (exclude.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (entry.isDirectory()) walk(full);
      else out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  })(dir);
  return out;
}

const HARNESS = (doublePath) => `"use strict";
// TEST-ONLY: adds the provider double to the generative child; records the
// production-built child argv/env keys before doing so.
const cp = require("child_process");
const fs = require("fs");
const original = cp.spawn;
cp.spawn = function spawn(command, args, options) {
  if (Array.isArray(args) && typeof args[0] === "string" && args[0].endsWith("generative-runner.js")) {
    fs.writeFileSync(process.env.QA_AGENT_TEST_SPAWN_LOG, JSON.stringify({ command, args, envKeys: Object.keys(options.env).sort(), shell: options.shell }));
    return original.call(this, command, ["--require", ${JSON.stringify(doublePath)}, ...args], { ...options, env: { ...options.env, QA_AGENT_TEST_PROVIDER_SCRIPT: process.env.QA_AGENT_TEST_PROVIDER_SCRIPT } });
  }
  return original.apply(this, arguments);
};
`;

before(() => {
  const packDir = path.join(scratch, "pack");
  fs.mkdirSync(packDir);
  const packed = JSON.parse(execSync(`npm pack --json --pack-destination "${packDir}"`, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, "package.json"), JSON.stringify({ name: "stage3-external-target", version: "1.0.0", private: true, scripts: { "test:e2e": "cypress run" } }, null, 2));
  execSync(`npm install --no-audit --no-fund --save-dev "${path.join(packDir, packed.filename)}"`, { cwd: external, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  installed = path.join(external, "node_modules", "qa-ai-agent");
  installedPkg = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"));

  fs.writeFileSync(path.join(external, "qa-agent.config.json"), JSON.stringify(fx.stage3Config(), null, 2));
  fs.mkdirSync(path.join(external, "qa"));
  fs.writeFileSync(path.join(external, "qa", "requirements.json"), JSON.stringify(fx.REQUIREMENTS, null, 2));
  fs.writeFileSync(path.join(external, "cypress.config.js"), "module.exports = { e2e: {} };\n");
  fs.mkdirSync(path.join(external, "cypress", "e2e"), { recursive: true });
  fs.writeFileSync(path.join(external, fx.EXISTING_SPEC), "describe('existing', () => {});\n");

  fs.mkdirSync(harnessDir);
  const doublePath = path.join(harnessDir, "generative-provider-double.js");
  fs.copyFileSync(DOUBLE_SOURCE, doublePath);
  fs.writeFileSync(path.join(harnessDir, "spawn-harness.js"), HARNESS(doublePath));

  installedHashBefore = hashTree(installed);
  targetSourceBefore = hashTree(external, { exclude: ["node_modules", "reports"] });
});

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("Stage 3 external: the installed package is a real copy outside the checkout with exactly the 89-file inventory", () => {
  const rel = path.relative(REPO_ROOT, fs.realpathSync(external));
  assert.ok(rel.startsWith("..") || path.isAbsolute(rel), "external repository must be outside the checkout");
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
  assert.deepEqual(inv.listFiles(installed), [...inv.EXPECTED_INVENTORY]);
  for (const f of inv.STAGE3_PRIVATE_RUNTIME) assert.ok(fs.existsSync(path.join(installed, f)), `${f} installed`);
  for (const f of inv.EXCLUDED_PRIVATE) assert.equal(fs.existsSync(path.join(installed, f)), false, `${f} must not be installed`);
  assert.deepEqual(installedPkg.exports, inv.EXPECTED_EXPORTS);
  assert.deepEqual(installedPkg.bin, inv.EXPECTED_BIN);
});

test("Stage 3 external: the static closure over the INSTALLED files is complete and reaches exactly the Stage 3 private closure", () => {
  const available = new Set(inv.listFiles(installed));
  const c = inv.staticClosure({ baseDir: installed, available, entries: inv.supportedEntrypoints(installedPkg) });
  assert.deepEqual(c.missing, []);
  assert.deepEqual(c.problems, []);
  assert.deepEqual([...c.reached].filter((f) => inv.PRIVATE_TREES.some((t) => f.startsWith(t))).sort(), [...inv.STAGE3_PRIVATE_RUNTIME]);
});

test("Stage 3 external: no runtime dependency is installed with the package", () => {
  assert.equal(installedPkg.dependencies, undefined);
  const entries = fs.readdirSync(path.join(external, "node_modules")).filter((e) => !e.startsWith("."));
  assert.deepEqual(entries, ["qa-ai-agent"]);
  const lock = JSON.parse(fs.readFileSync(path.join(external, "package-lock.json"), "utf8"));
  assert.deepEqual(Object.keys(lock.packages).filter((k) => k !== "").sort(), ["node_modules/qa-ai-agent"]);
});

test("Stage 3 external: through the real bin shim, mock / --offline generation and the reserved commands are refused (exit 5)", () => {
  const help = npx("--help");
  assert.equal(help.code, 0, help.stderr);
  for (const cmd of ["design", "plan", "generate", "review show"]) assert.ok(help.stdout.includes(cmd), cmd);
  const mock = npx("design --json");
  assert.equal(mock.code, 5, mock.stderr);
  assert.equal(mock.json.errors[0].code, "CAPABILITY_REQUIRES_GENERATIVE_PROVIDER");
  const offline = npx("design --offline --json");
  assert.equal(offline.code, 5);
  assert.equal(offline.json.errors[0].code, "CAPABILITY_REQUIRES_GENERATIVE_PROVIDER");
  for (const cmd of ["review record", "apply", "execute"]) {
    const r = npx(`${cmd} --json`);
    assert.equal(r.code, 5, cmd);
    assert.equal(r.json.errors[0].code, "CAPABILITY_NOT_ENABLED_IN_RELEASE");
  }
  assert.equal(fs.existsSync(path.join(external, "reports")), false, "no refusal wrote anything");
});

test("Stage 3 external: design -> plan -> generate -> review show succeed from the installed package and load only packaged private files", () => {
  const env = minimalEnv({ AI_PROVIDER: "groq", AI_MODEL: "stage3-model", AI_API_KEY: fx.SECRET });
  const design = installedCli(["design", "--json"], { env, responses: fx.RESPONSES.design() });
  assert.equal(design.code, 0, design.stderr);
  runId = design.json.runId;
  const plan = installedCli(["plan", "--run", runId, "--json"], { env, responses: fx.RESPONSES.plan() });
  assert.equal(plan.code, 0, plan.stderr);
  const generate = installedCli(["generate", "--run", runId, "--json"], { env, responses: fx.RESPONSES.generate() });
  assert.equal(generate.code, 0, generate.stderr);
  const show = installedCli(["review", "show", "--run", runId, "--json"]);
  assert.equal(show.code, 0, show.stderr);
  assert.equal(show.json.authority, "NON_AUTHORITATIVE_PRESENTATION");
  assert.equal(show.json.reviewPackages.length, 1);

  for (const r of [design, plan, generate]) {
    assert.equal(r.json.runId, runId);
    // The production-built child: process.execPath + installed runner, closed env.
    assert.equal(r.spawned.command, process.execPath);
    assert.equal(r.spawned.shell, false);
    assert.ok(fs.realpathSync(r.spawned.args[0]).startsWith(fs.realpathSync(installed)), "the runner is the installed one");
    for (const key of r.spawned.envKeys) assert.match(key, /^(AI_API_KEY|AI_MODEL|AI_PROVIDER|PATH|Path|SYSTEMROOT|SystemRoot|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|WINDIR|CI)$/, key);
    // Every product module the child loaded came from the installed package.
    const product = r.loaded.filter((p) => /qa-ai-agent|scripts[\\/]ai[\\/]/.test(p));
    assert.ok(product.length > 0);
    for (const p of product) assert.ok(fs.realpathSync(p).startsWith(fs.realpathSync(installed)), `${p} must load from the installed package`);
  }
  const rel = (p) => path.relative(installed, p).split(path.sep).join("/");
  const designLoaded = design.loaded.map(rel);
  for (const f of ["scripts/ai/generative-test-design/requirement-model-generator.js", "scripts/ai/generative-test-design/automation-candidate-generator.js", "scripts/ai/generation/cross-model-validation.js"]) {
    assert.ok(designLoaded.includes(f), `design child loaded ${f}`);
  }
  assert.ok(plan.loaded.map(rel).includes("scripts/ai/test-automation/automation-plan-generator.js"));
  assert.ok(generate.loaded.map(rel).includes("scripts/ai/test-automation/generate-change-set.js"));
  for (const r of [design, plan, generate]) for (const f of inv.EXCLUDED_PRIVATE) assert.equal(r.loaded.map(rel).includes(f), false, f);
});

test("Stage 3 external: target source is byte-identical, the proposal is never written, and nothing references the checkout", () => {
  assert.ok(runId, "the success-path test ran first");
  assert.deepEqual(hashTree(external, { exclude: ["node_modules", "reports"] }), targetSourceBefore);
  assert.equal(fs.existsSync(path.join(external, fx.GENERATED_SPEC)), false);
  const checkout = [REPO_ROOT, REPO_ROOT.split(path.sep).join("/"), JSON.stringify(REPO_ROOT).slice(1, -1)];
  const runRoot = path.join(external, "reports", "qa-agent", "runs", runId);
  for (const file of inv.listFiles(runRoot)) {
    const text = fs.readFileSync(path.join(runRoot, file), "utf8");
    for (const needle of checkout) assert.equal(text.includes(needle), false, `${file} references the checkout`);
    assert.equal(text.includes(fx.SECRET), false, `${file} contains the API key`);
  }
  const show = installedCli(["review", "show", "--run", runId]);
  for (const needle of checkout) assert.equal((show.stdout + show.stderr).includes(needle), false);
  assert.deepEqual(hashTree(installed), installedHashBefore, "installed package content unchanged");
});

test("Stage 3 external: Stage 3 and CLI modules are denied through the package specifier; the public API is intact", () => {
  const probe = path.join(external, "probe-stage3.js");
  const specs = [...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE3_CLI_FILES, ...inv.EXCLUDED_PRIVATE].map((f) => `qa-ai-agent/${f}`);
  fs.writeFileSync(
    probe,
    `const out = { root: Object.keys(require("qa-ai-agent")).sort(), subpaths: {}, deep: {} };
     for (const s of ["qa-ai-agent/providers/jira", "qa-ai-agent/providers/azure-devops", "qa-ai-agent/destinations/azure-devops", "qa-ai-agent/package.json"]) {
       try { out.subpaths[s] = Object.keys(require(s)).length > 0; } catch (e) { out.subpaths[s] = e.code; }
     }
     for (const s of ${JSON.stringify(specs)}) { try { require(s); out.deep[s] = "loaded"; } catch (e) { out.deep[s] = e.code; } }
     process.stdout.write(JSON.stringify(out));`
  );
  const r = spawnSync(process.execPath, [probe], { cwd: external, env: minimalEnv(), encoding: "utf8", shell: false });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.root.length, 19);
  for (const [s, ok] of Object.entries(out.subpaths)) assert.equal(ok, true, s);
  for (const [s, code] of Object.entries(out.deep)) assert.equal(code, "ERR_PACKAGE_PATH_NOT_EXPORTED", s);
});

test("Stage 3 external negative: removing a required private runtime file fails the closure proof and the installed CLI", () => {
  for (const removed of ["scripts/ai/generation/limits.js", "scripts/ai/test-automation/generate-change-set-prompt.js"]) {
    const broken = path.join(scratch, `broken-${path.basename(removed, ".js")}`);
    fs.cpSync(installed, broken, { recursive: true });
    fs.rmSync(path.join(broken, ...removed.split("/")));
    const available = new Set(inv.listFiles(broken));
    const c = inv.staticClosure({ baseDir: broken, available, entries: inv.supportedEntrypoints(installedPkg) });
    assert.ok(c.missing.some((m) => m.includes(path.posix.basename(removed, ".js"))), `${removed}: ${JSON.stringify(c.missing)}`);
  }
  const brokenBin = path.join(scratch, "broken-limits", installedPkg.bin["qa-agent"]);
  const r = spawnSync(process.execPath, [brokenBin, "--version"], { cwd: external, env: minimalEnv(), encoding: "utf8", shell: false });
  assert.notEqual(r.status, 0, "a package missing a required Stage 3 runtime file cannot run");
});
