"use strict";

/**
 * Controlled-v1 Stage 1-2 external installation proof (mission §25),
 * extending the ID-2 external-repository proof to the `qa-agent` binary:
 *
 *   real `npm pack` -> temp external repository OUTSIDE the checkout ->
 *   real `npm install <tarball>` -> `npx qa-agent ...` from that repository
 *   (cwd = external root, so the default root is exercised; no --root).
 *
 * Proves: --version, --help, config validate, info, requirements check
 * (allowed Stage 1 command), triage run --offline (supported triage route,
 * mock provider), reserved refusal, root/subpath API intact, deep package
 * imports of CLI modules rejected, no dependence on the source checkout or
 * repository-relative developer paths, installed package not mutated.
 *
 * Offline and deterministic: the tarball is local, the provider is mock,
 * the History stage is not used, no credentials exist. The npx process runs
 * with a minimal environment; npm's own npm_* variables reach the CLI but
 * (by design) never its stage children.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const FIXTURE = path.join(REPO_ROOT, "scripts", "ai", "__fixtures__", "playwright-real-report.json");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "qa-agent-external-"));
const external = path.join(scratch, "target-repo");
let installed;
let installedHashBefore;

function minimalEnv() {
  const env = {};
  for (const key of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  env.npm_config_offline = "true";
  env.npm_config_update_notifier = "false";
  env.npm_config_fund = "false";
  env.npm_config_audit = "false";
  return env;
}

// npx is npx.cmd on Windows, so a shell is required; every interpolated value
// is a test-controlled constant or temp path, quoted.
function npx(args) {
  // `--` stops npx from treating --version/--help as its own options.
  const r = spawnSync(`npx --no -- qa-agent ${args}`, { cwd: external, env: minimalEnv(), encoding: "utf8", shell: true, timeout: 120000 });
  let json = null;
  if (args.includes("--json")) {
    const lines = r.stdout.split(/\r?\n/).filter(Boolean);
    if (lines.length === 1) json = JSON.parse(lines[0]);
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function hashTree(dir) {
  const out = {};
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full).split(path.sep).join("/")] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  })(dir);
  return out;
}

before(() => {
  const packDir = path.join(scratch, "pack");
  fs.mkdirSync(packDir);
  const packed = JSON.parse(execSync(`npm pack --json --pack-destination "${packDir}"`, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, "package.json"), JSON.stringify({ name: "external-target", version: "1.0.0", private: true }));
  execSync(`npm install --no-audit --no-fund --save-dev "${path.join(packDir, packed.filename)}"`, { cwd: external, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  installed = path.join(external, "node_modules", "qa-ai-agent");

  fs.writeFileSync(
    path.join(external, "qa-agent.config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        projectProfile: { id: "external-web", displayName: "External web target", knownProjectConstraints: ["Installed from a packed tarball."] },
        framework: "playwright",
        requirements: { source: "file", path: "qa/requirements.json" },
        capabilities: { triage: true },
        providers: { allow: ["mock"] },
        output: { dir: "reports/qa-agent" },
      },
      null,
      2
    )
  );
  fs.mkdirSync(path.join(external, "qa"));
  fs.writeFileSync(
    path.join(external, "qa", "requirements.json"),
    JSON.stringify({
      schemaVersion: 1,
      requirements: [{ id: "EXT-1", type: "requirement", title: "Search", content: "When a query is submitted, matching results are listed.", acceptanceCriteria: [{ id: "AC-1", text: "Given a known query, at least one result is listed." }] }],
    })
  );
  fs.mkdirSync(path.join(external, "reports", "playwright"), { recursive: true });
  fs.copyFileSync(FIXTURE, path.join(external, "reports", "playwright", "report.json"));
  installedHashBefore = hashTree(installed);
});

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("external CLI: the target repository is outside the checkout and the package is a real installed copy (no link to the source)", () => {
  const rel = path.relative(REPO_ROOT, fs.realpathSync(external));
  assert.ok(rel.startsWith("..") || path.isAbsolute(rel), "external repository must be outside the checkout");
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
  assert.ok(fs.existsSync(path.join(installed, "scripts", "ai", "cli", "qa-agent.js")));
  assert.ok(fs.readdirSync(path.join(external, "node_modules", ".bin")).some((f) => f.startsWith("qa-agent")), "npm created the bin shim");
});

test("external CLI: npx qa-agent --version prints the packed version", () => {
  const r = npx("--version");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), pkg.version);
});

test("external CLI: npx qa-agent --help succeeds", () => {
  const r = npx("--help");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /triage run/);
});

test("external CLI: config validate succeeds against the target-owned config (default root = cwd)", () => {
  const r = npx("config validate --json");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.config.status, "VALID");
});

test("external CLI: info --json reports the installed product and capability status", () => {
  const r = npx("info --json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.product, { name: pkg.name, version: pkg.version });
  assert.deepEqual(r.json.capabilities.triage, { requested: true, available: true });
  assert.equal(r.json.provider.effective, "mock");
});

test("external CLI: requirements check --offline writes the deterministic report inside the target repository", () => {
  const r = npx("requirements check --offline --json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.artifacts, ["reports/qa-agent/requirements/requirements-check.json"]);
  const report = JSON.parse(fs.readFileSync(path.join(external, "reports", "qa-agent", "requirements", "requirements-check.json"), "utf8"));
  assert.equal(report.summary.ready, 1);
  assert.equal(report.testDesigns.length, 1);
});

test("external CLI: triage run --offline completes collect -> analyze in isolated children from the installed package", () => {
  const r = npx("triage run --offline --json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.stages, ["collect", "analyze"]);
  const report = JSON.parse(fs.readFileSync(path.join(external, "reports", "ai", "ai-report.json"), "utf8"));
  assert.equal(report.analysis.provider, "mock");
  assert.ok(report.results.length > 0);
});

test("external CLI: a reserved command is refused with exit 5 from the installed package", () => {
  const r = npx("apply --json");
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "CAPABILITY_NOT_ENABLED_IN_RELEASE");
});

test("external CLI: the public API is intact and CLI modules are not importable through the package specifier", () => {
  const runner = path.join(external, "probe.js");
  fs.writeFileSync(
    runner,
    `const out = { root: Object.keys(require("qa-ai-agent")).length, deep: {} };
     for (const s of ["qa-ai-agent/scripts/ai/cli/cli.js", "qa-ai-agent/scripts/ai/cli/qa-agent.js", "qa-ai-agent/scripts/ai/cli/stage-runner.js", "qa-ai-agent/scripts/ai/cli/config-file"]) {
       try { require(s); out.deep[s] = "loaded"; } catch (e) { out.deep[s] = e.code; }
     }
     process.stdout.write(JSON.stringify(out));`
  );
  const r = spawnSync(process.execPath, [runner], { cwd: external, env: minimalEnv(), encoding: "utf8", shell: false });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.root, 19, "exactly the 19 public root names");
  for (const [spec, code] of Object.entries(out.deep)) assert.equal(code, "ERR_PACKAGE_PATH_NOT_EXPORTED", spec);
});

test("external CLI: no output or artifact references the source checkout; the installed package was not mutated", () => {
  const checkout = [REPO_ROOT, REPO_ROOT.split(path.sep).join("/"), JSON.stringify(REPO_ROOT).slice(1, -1)];
  for (const args of ["info --json", "config validate --json", "triage run --offline --json"]) {
    const r = npx(args);
    for (const needle of checkout) assert.equal((r.stdout + r.stderr).includes(needle), false, `${args} references the checkout`);
  }
  for (const rel of ["reports/ai/context.json", "reports/ai/ai-report.json", "reports/qa-agent/requirements/requirements-check.json"]) {
    const text = fs.readFileSync(path.join(external, ...rel.split("/")), "utf8");
    for (const needle of checkout) assert.equal(text.includes(needle), false, `${rel} references the checkout`);
  }
  assert.deepEqual(hashTree(installed), installedHashBefore, "installed package content unchanged");
});
