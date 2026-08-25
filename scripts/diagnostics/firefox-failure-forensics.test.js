"use strict";

// Roadmap #19.7F-B4B correction: a behavioral (not source-text) regression
// proving reset-cypress-runtime-outputs.sh - the exact same helper
// firefox-failure-forensics.sh itself invokes at all three of its own
// "reset before the next diagnostic re-run" points - narrowly removes only
// disposable Cypress runtime output and never the forensic evidence
// directory it lives alongside. This is the real, previously-broken
// invariant: FORENSICS_ROOT (reports/firefox-forensics) must survive
// cleanup, and must remain writable afterward, even though it shares the
// same "reports/" parent as the disposable reports/cypress being cleared.
//
// Runs entirely inside an isolated OS-temp directory (never any tracked
// repository path) so this can safely use rm-equivalent cleanup without
// any risk to real repository state - no Cypress browser, no live SUT, no
// provider.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const HELPER_SCRIPT = path.join(__dirname, "reset-cypress-runtime-outputs.sh");

function buildControlledTree(root) {
  const sentinelDir = path.join(root, "reports", "firefox-forensics", "metadata");
  fs.mkdirSync(sentinelDir, { recursive: true });
  const sentinelPath = path.join(sentinelDir, "sentinel.txt");
  fs.writeFileSync(sentinelPath, "FORENSIC_SENTINEL_MUST_SURVIVE");

  const cypressReportDir = path.join(root, "reports", "cypress");
  fs.mkdirSync(cypressReportDir, { recursive: true });
  fs.writeFileSync(path.join(cypressReportDir, "fake-report.json"), "{}");

  const screenshotsDir = path.join(root, "cypress", "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.writeFileSync(path.join(screenshotsDir, "fake.png"), "");

  const videosDir = path.join(root, "cypress", "videos");
  fs.mkdirSync(videosDir, { recursive: true });
  fs.writeFileSync(path.join(videosDir, "fake.mp4"), "");

  return { sentinelPath };
}

test("reset-cypress-runtime-outputs.sh removes disposable Cypress output but never the forensic evidence directory it lives alongside", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "b4b-cleanup-regression-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const { sentinelPath } = buildControlledTree(tmpRoot);

  execFileSync("bash", [HELPER_SCRIPT], { cwd: tmpRoot, stdio: "pipe" });

  // Forensic evidence survives, byte-identical.
  assert.ok(fs.existsSync(sentinelPath), "the forensic sentinel file must survive cleanup");
  assert.equal(fs.readFileSync(sentinelPath, "utf8"), "FORENSIC_SENTINEL_MUST_SURVIVE");

  // Disposable runtime output is genuinely removed.
  assert.ok(!fs.existsSync(path.join(tmpRoot, "reports", "cypress")), "reports/cypress must be removed");
  assert.ok(!fs.existsSync(path.join(tmpRoot, "cypress", "screenshots")), "cypress/screenshots must be removed");
  assert.ok(!fs.existsSync(path.join(tmpRoot, "cypress", "videos")), "cypress/videos must be removed");

  // FORENSICS_ROOT itself, and its ability to be written into afterward
  // (proving the later same-runner-repeat/request-timeout-15s/
  // resource-trace diagnostic layers could still redirect into it), both
  // survive - this is the exact invariant the original bug violated.
  const forensicsRoot = path.join(tmpRoot, "reports", "firefox-forensics");
  assert.ok(fs.existsSync(forensicsRoot), "FORENSICS_ROOT must still exist after cleanup");
  const postCleanupLog = path.join(forensicsRoot, "metadata", "post-cleanup-write-check.txt");
  assert.doesNotThrow(() => fs.writeFileSync(postCleanupLog, "writable"));
  assert.equal(fs.readFileSync(postCleanupLog, "utf8"), "writable");
});

test("reset-cypress-runtime-outputs.sh is a no-op (never throws) when the disposable directories do not exist yet", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "b4b-cleanup-regression-empty-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  assert.doesNotThrow(() => execFileSync("bash", [HELPER_SCRIPT], { cwd: tmpRoot, stdio: "pipe" }));
});

test("firefox-failure-forensics.sh source only ever resets disposable output through the shared helper, never a bare 'rm -rf reports'", () => {
  const scriptSource = fs.readFileSync(path.join(__dirname, "firefox-failure-forensics.sh"), "utf8");
  // Only scans actual (non-comment) executable lines - this file's own
  // explanatory header comment legitimately quotes the historical buggy
  // command as prose ("used to be an inline `rm -rf reports ...`"), which
  // must not itself be mistaken for surviving buggy code.
  const executableLines = scriptSource
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));
  const bareRmMatches = executableLines.filter((line) => /rm\s+-rf\s+reports(?!\/cypress)(?![\w/-])/.test(line));
  assert.deepEqual(bareRmMatches, [], "the production script must never delete the bare 'reports' directory directly in an actual command");
  const helperCallLines = executableLines.filter((line) => line.includes("reset-cypress-runtime-outputs.sh"));
  assert.equal(helperCallLines.length, 3, "expected exactly the three known reset points (before same-runner-repeat, before the 15s timeout diagnostic, before the resource trace) to call the shared helper");
});
