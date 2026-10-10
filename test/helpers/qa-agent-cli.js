"use strict";

/**
 * Test-only helpers for the Controlled-v1 `qa-agent` CLI: temporary target
 * roots, a hermetic base environment (never the ambient one, so a GitHub
 * Actions job's GITHUB_ACTIONS/GITHUB_* values cannot leak into a test), and
 * an in-process runner that captures stdout/stderr.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const { run } = require(path.join(REPO_ROOT, "scripts", "ai", "cli", "cli.js"));
const PLAYWRIGHT_FIXTURE = path.join(REPO_ROOT, "scripts", "ai", "__fixtures__", "playwright-real-report.json");

const scratchDirs = [];

function scratch(prefix = "qa-agent-cli-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function cleanupScratch() {
  while (scratchDirs.length > 0) fs.rmSync(scratchDirs.pop(), { recursive: true, force: true });
}

function baseConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectProfile: { id: "cli-web", displayName: "CLI test web", knownProjectConstraints: ["Synthetic CLI test target."] },
    framework: "playwright",
    ...overrides,
  };
}

function makeRoot(config = baseConfig(), { playwrightReport = false } = {}) {
  const root = scratch();
  if (config !== null) fs.writeFileSync(path.join(root, "qa-agent.config.json"), typeof config === "string" ? config : JSON.stringify(config, null, 2));
  if (playwrightReport) {
    fs.mkdirSync(path.join(root, "reports", "playwright"), { recursive: true });
    fs.copyFileSync(PLAYWRIGHT_FIXTURE, path.join(root, "reports", "playwright", "report.json"));
  }
  return root;
}

// Only what a Node child needs to launch on this host - nothing QA-agent
// related and nothing from a CI job's ambient environment.
function hermeticEnv(overrides = {}) {
  const env = {};
  for (const key of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function sink() {
  let text = "";
  return {
    write(chunk) {
      text += String(chunk);
      return true;
    },
    get text() {
      return text;
    },
  };
}

async function runCli(argv, { env = hermeticEnv(), cwd, spawnImpl, platform } = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await run({ argv, env, cwd: cwd || os.tmpdir(), stdout, stderr, spawnImpl, platform });
  let json = null;
  if (argv.includes("--json")) {
    const lines = stdout.text.split("\n").filter((l) => l.length > 0);
    if (lines.length === 1) json = JSON.parse(lines[0]);
  }
  return { code, stdout: stdout.text, stderr: stderr.text, json };
}

// Records every spawn call; delegates to the real spawn unless `fake` is set,
// in which case a minimal fake child reports a successful stage result.
function spawnRecorder({ fake = false } = {}) {
  const calls = [];
  const impl = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options, env: { ...options.env } } });
    if (!fake) return childProcess.spawn(command, args, options);
    const { EventEmitter } = require("node:events");
    const { PassThrough } = require("node:stream");
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.send = () => {
      setImmediate(() => {
        child.emit("message", { type: "result", ok: true });
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0, null);
      });
      return true;
    };
    return child;
  };
  return { impl, calls };
}

module.exports = { REPO_ROOT, PLAYWRIGHT_FIXTURE, scratch, cleanupScratch, baseConfig, makeRoot, hermeticEnv, runCli, spawnRecorder };
