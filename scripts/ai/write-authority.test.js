"use strict";

/**
 * Roadmap FPI-2 Corrective C4 (FPI2-R-9, independent adversarial review of
 * PR #123, terminal C3 review): caller-level regression coverage for the
 * WRITE-authority guard (resolveSafeRepositoryWritePath(), see
 * context-utils.js) across all four generic-core writers:
 *
 *   scripts/ai/collect-context.js           (context.json)
 *   scripts/ai/collect-history.js           (history.json)
 *   scripts/ai/analyze-failure.js           (ai-report.json)
 *   scripts/ai/aggregate-browser-context.js (context.json, history.json)
 *
 * A shared-helper test alone (see context-utils.test.js) does not prove all
 * four writer INTEGRATIONS are correct - each writer independently
 * constructs its own outputFile and calls the guard itself, so each one is
 * exercised here through its own real main() entrypoint, with a real
 * temporary fixture repository and real filesystem symlinks. Each test name
 * identifies the exact writer/vector under test, and no writer's coverage
 * is hidden inside an opaque shared loop - a failure here always points at
 * exactly which caller integration broke.
 *
 * Also carries the R-8 caller-level coverage (aggregate-browser-context.js's
 * main() itself, not just readBrowserInputs() in isolation) - see the R8-T*
 * tests at the end of this file.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const collectContext = require("./collect-context");
const collectHistory = require("./collect-history");
const analyzeFailure = require("./analyze-failure");
const aggregateBrowserContext = require("./aggregate-browser-context");

const SYNTHETIC_PROFILE = Object.freeze({
  id: "write-authority-test-project",
  displayName: "Write Authority Test Project",
  knownProjectConstraints: ["Synthetic test constraint."],
});

function freshRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-target-`));
  return dir;
}

function freshOutsideDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-outside-`));
}

const NOOP_ADAPTER = { id: "stub", collect: () => ({ testResults: [], failedTests: [], warnings: [] }) };

// --- R9-T: final output leaf symlink -> outside, every writer -------------

test("R9-T collect-context.js: context.json output leaf symlinked to an outside target is refused, outside target untouched", () => {
  const target = freshRepo("r9-cc-leaf");
  const outside = freshOutsideDir("r9-cc-leaf");
  const victim = path.join(outside, "victim.json");
  fs.writeFileSync(victim, "ORIGINAL");
  fs.mkdirSync(path.join(target, "reports", "ai"), { recursive: true });
  fs.symlinkSync(victim, path.join(target, "reports", "ai", "context.json"), "file");

  assert.throws(
    () => collectContext.main({ adapter: NOOP_ADAPTER, profile: SYNTHETIC_PROFILE, repositoryRoot: target }),
    /WRITE_PATH_UNSAFE/
  );
  assert.equal(fs.readFileSync(victim, "utf8"), "ORIGINAL");
});

test("R9-T collect-history.js: history.json output leaf symlinked to an outside target is refused, outside target untouched", () => {
  const target = freshRepo("r9-ch-leaf");
  const outside = freshOutsideDir("r9-ch-leaf");
  const victim = path.join(outside, "victim.json");
  fs.writeFileSync(victim, "ORIGINAL");
  fs.mkdirSync(path.join(target, "reports", "ai"), { recursive: true });
  fs.symlinkSync(victim, path.join(target, "reports", "ai", "history.json"), "file");

  const savedToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN; // forces the deterministic, network-free writeUnavailable() path
  try {
    return collectHistory
      .main({ profile: SYNTHETIC_PROFILE, repositoryRoot: target })
      .then(() => assert.fail("expected collect-history.main() to reject via the write-authority guard"))
      .catch((err) => {
        assert.match(err.message, /WRITE_PATH_UNSAFE/);
        assert.equal(fs.readFileSync(victim, "utf8"), "ORIGINAL");
      });
  } finally {
    if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedToken;
  }
});

test("R9-T analyze-failure.js: ai-report.json output leaf symlinked to an outside target is refused, outside target untouched (empty-report branch)", async () => {
  const target = freshRepo("r9-af-leaf");
  const outside = freshOutsideDir("r9-af-leaf");
  const victim = path.join(outside, "victim.json");
  fs.writeFileSync(victim, "ORIGINAL");
  fs.mkdirSync(path.join(target, "reports", "ai"), { recursive: true });
  fs.writeFileSync(path.join(target, "reports", "ai", "context.json"), JSON.stringify({ failedTests: [], metadata: {} }));
  fs.symlinkSync(victim, path.join(target, "reports", "ai", "ai-report.json"), "file");

  await assert.rejects(
    () => analyzeFailure.main({ projectProfile: SYNTHETIC_PROFILE, repositoryRoot: target }),
    /WRITE_PATH_UNSAFE/
  );
  assert.equal(fs.readFileSync(victim, "utf8"), "ORIGINAL");
});

function chromeFailureFixture(target) {
  const chromeDir = path.join(target, "reports", "ai", "browser-inputs", "chrome");
  fs.mkdirSync(chromeDir, { recursive: true });
  fs.writeFileSync(path.join(chromeDir, "browser-result.json"), JSON.stringify({ browser: "chrome", outcome: "failure", framework: "cypress" }));
  fs.writeFileSync(
    path.join(chromeDir, "context.json"),
    JSON.stringify({
      generatedAt: "2026-01-01T00:00:00.000Z",
      metadata: { framework: "cypress" },
      testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 1 }, specs: [] },
      failedTests: [{ title: "t", fullTitle: "t", specFile: "cypress/e2e/tests/x.cy.js", suite: "S", status: "failed", duration: 1, error: { message: "m", stack: null }, screenshot: null }],
      relevantFiles: {},
      knownProjectConstraints: [],
      warnings: [],
    })
  );
}

test("R9-T aggregate-browser-context.js: context.json output leaf symlinked to an outside target is refused, outside target untouched", () => {
  const target = freshRepo("r9-agg-leaf");
  const outside = freshOutsideDir("r9-agg-leaf");
  const victim = path.join(outside, "victim.json");
  fs.writeFileSync(victim, "ORIGINAL");
  chromeFailureFixture(target);
  fs.symlinkSync(victim, path.join(target, "reports", "ai", "context.json"), "file");

  assert.throws(() => aggregateBrowserContext.main({ repositoryRoot: target }), /WRITE_PATH_UNSAFE/);
  assert.equal(fs.readFileSync(victim, "utf8"), "ORIGINAL");
});

// --- R9-T: directory-level (reports/ai -> outside) -------------------------

test("R9-T aggregate-browser-context.js: reports/ai itself symlinked to an outside directory is refused before any write (C3's exact original reproduction)", () => {
  const target = freshRepo("r9-agg-dirlevel");
  const outside = freshOutsideDir("r9-agg-dirlevel");
  fs.mkdirSync(path.join(outside, "browser-inputs", "chrome"), { recursive: true });
  fs.writeFileSync(path.join(outside, "browser-inputs", "chrome", "browser-result.json"), JSON.stringify({ browser: "chrome", outcome: "failure", framework: "cypress" }));
  fs.writeFileSync(
    path.join(outside, "browser-inputs", "chrome", "context.json"),
    JSON.stringify({ failedTests: [{ specFile: "x", fullTitle: "x", error: { message: "m" } }], metadata: {} })
  );
  fs.mkdirSync(path.join(target, "reports"), { recursive: true });
  fs.symlinkSync(outside, path.join(target, "reports", "ai"), "dir");

  // main() reads its browser-inputs area through resolveRepositoryLocalPath()
  // (see main()'s own R-8 top-level gate) - an escaping "reports/ai" is
  // caught there and gracefully degraded to "no browser inputs" (mission
  // Section 4.4: this READ-side condition never needs to crash the whole
  // job), so this does not throw. The security invariant under test is:
  // no write lands anywhere under the outside directory, and no
  // context.json is fabricated from it.
  assert.doesNotThrow(() => aggregateBrowserContext.main({ repositoryRoot: target }));
  assert.equal(fs.existsSync(path.join(outside, "browser-inputs", "context.json")), false, "no write may land directly in the outside directory");
  assert.equal(fs.existsSync(path.join(target, "reports", "ai", "context.json")), false, "no context.json may be fabricated from an untrusted browser-inputs area");
});

test("R9-T collect-context.js: reports/ai itself symlinked to an outside directory is refused before any write", () => {
  const target = freshRepo("r9-cc-dirlevel");
  const outside = freshOutsideDir("r9-cc-dirlevel");
  fs.mkdirSync(path.join(target, "reports"), { recursive: true });
  fs.symlinkSync(outside, path.join(target, "reports", "ai"), "dir");

  assert.throws(
    () => collectContext.main({ adapter: NOOP_ADAPTER, profile: SYNTHETIC_PROFILE, repositoryRoot: target }),
    /WRITE_PATH_OUTSIDE_REPOSITORY/
  );
  assert.equal(fs.existsSync(path.join(outside, "context.json")), false);
});

// --- R9-T: higher ancestor (reports -> outside) -----------------------------

test("R9-T collect-context.js: a higher ancestor (reports itself) symlinked to an outside directory is refused", () => {
  const target = freshRepo("r9-cc-ancestor");
  const outside = freshOutsideDir("r9-cc-ancestor");
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(outside, path.join(target, "reports"), "dir");

  assert.throws(
    () => collectContext.main({ adapter: NOOP_ADAPTER, profile: SYNTHETIC_PROFILE, repositoryRoot: target }),
    /WRITE_PATH_OUTSIDE_REPOSITORY/
  );
  assert.equal(fs.existsSync(path.join(outside, "ai")), false);
});

// --- R9-T: fresh legitimate repository can still create its outputs -------

test("R9-T collect-context.js: a fresh repository with no reports/ directory yet can still write context.json", () => {
  const target = freshRepo("r9-cc-fresh");
  collectContext.main({ adapter: NOOP_ADAPTER, profile: SYNTHETIC_PROFILE, repositoryRoot: target });
  assert.ok(fs.existsSync(path.join(target, "reports", "ai", "context.json")));
});

test("R9-T collect-history.js: a fresh repository with no reports/ directory yet can still write history.json", async () => {
  const target = freshRepo("r9-ch-fresh");
  const savedToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    await collectHistory.main({ profile: SYNTHETIC_PROFILE, repositoryRoot: target });
    const written = JSON.parse(fs.readFileSync(path.join(target, "reports", "ai", "history.json"), "utf8"));
    assert.equal(written.available, false);
  } finally {
    if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedToken;
  }
});

test("R9-T analyze-failure.js: a fresh repository (context.json present, no ai-report.json yet) can still write ai-report.json", async () => {
  const target = freshRepo("r9-af-fresh");
  fs.mkdirSync(path.join(target, "reports", "ai"), { recursive: true });
  fs.writeFileSync(path.join(target, "reports", "ai", "context.json"), JSON.stringify({ failedTests: [], metadata: {} }));
  await analyzeFailure.main({ projectProfile: SYNTHETIC_PROFILE, repositoryRoot: target });
  assert.ok(fs.existsSync(path.join(target, "reports", "ai", "ai-report.json")));
});

test("R9-T aggregate-browser-context.js: a fresh repository with no reports/ directory yet can still write context.json", () => {
  const target = freshRepo("r9-agg-fresh");
  chromeFailureFixture(target);
  aggregateBrowserContext.main({ repositoryRoot: target });
  assert.ok(fs.existsSync(path.join(target, "reports", "ai", "context.json")));
});

// --- R9-T: existing legitimate output can still be updated (overwrite) ----

test("R9-T collect-context.js: an existing regular context.json is still updated on a repeated run (no regression)", () => {
  const target = freshRepo("r9-cc-overwrite");
  fs.mkdirSync(path.join(target, "reports", "ai"), { recursive: true });
  fs.writeFileSync(path.join(target, "reports", "ai", "context.json"), JSON.stringify({ stale: true }));
  collectContext.main({ adapter: NOOP_ADAPTER, profile: SYNTHETIC_PROFILE, repositoryRoot: target });
  const written = JSON.parse(fs.readFileSync(path.join(target, "reports", "ai", "context.json"), "utf8"));
  assert.equal(written.stale, undefined);
  assert.ok(Array.isArray(written.failedTests));
});

test("R9-T aggregate-browser-context.js: an existing regular context.json is still updated on a repeated run (no regression)", () => {
  const target = freshRepo("r9-agg-overwrite");
  fs.mkdirSync(path.join(target, "reports", "ai"), { recursive: true });
  fs.writeFileSync(path.join(target, "reports", "ai", "context.json"), JSON.stringify({ stale: true }));
  chromeFailureFixture(target);
  aggregateBrowserContext.main({ repositoryRoot: target });
  const written = JSON.parse(fs.readFileSync(path.join(target, "reports", "ai", "context.json"), "utf8"));
  assert.equal(written.stale, undefined);
  assert.ok(written.browserCorrelation);
});

// --- R8-T: aggregate-browser-context.js main() caller-level coverage ------
// (readBrowserInputs()-level coverage already lives in
// aggregate-browser-context.test.js; these prove the SAME containment holds
// through the real main() entrypoint end-to-end.)

test("R8-T1 aggregate-browser-context.js main(): browser-inputs directory symlinked to an outside directory - outside content is never consumed", () => {
  const target = freshRepo("r8-main-dirlevel");
  const outside = freshOutsideDir("r8-main-dirlevel");
  fs.mkdirSync(path.join(outside, "chrome"), { recursive: true });
  fs.writeFileSync(path.join(outside, "chrome", "browser-result.json"), JSON.stringify({ browser: "chrome", outcome: "failure", framework: "cypress" }));
  fs.writeFileSync(
    path.join(outside, "chrome", "context.json"),
    JSON.stringify({ failedTests: [{ specFile: "x", fullTitle: "x", error: { message: "PRIVATE_R8_DIRECTORY_MARKER" } }], metadata: {} })
  );
  fs.mkdirSync(path.join(target, "reports", "ai"), { recursive: true });
  fs.symlinkSync(outside, path.join(target, "reports", "ai", "browser-inputs"), "dir");

  aggregateBrowserContext.main({ repositoryRoot: target });

  assert.equal(fs.existsSync(path.join(target, "reports", "ai", "context.json")), false, "no analyzable context should have been produced from untrusted browser inputs");
});

test("R8-T2 aggregate-browser-context.js main(): an individual browser-input context.json symlinked to an outside file - outside content is never consumed", () => {
  const target = freshRepo("r8-main-filelevel");
  const outside = freshOutsideDir("r8-main-filelevel");
  fs.writeFileSync(
    path.join(outside, "private-context.json"),
    JSON.stringify({ failedTests: [{ specFile: "x", fullTitle: "x", error: { message: "PRIVATE_R8_FILE_MARKER" } }], metadata: {} })
  );
  const chromeDir = path.join(target, "reports", "ai", "browser-inputs", "chrome");
  fs.mkdirSync(chromeDir, { recursive: true });
  fs.writeFileSync(path.join(chromeDir, "browser-result.json"), JSON.stringify({ browser: "chrome", outcome: "failure", framework: "cypress" }));
  fs.symlinkSync(path.join(outside, "private-context.json"), path.join(chromeDir, "context.json"), "file");

  aggregateBrowserContext.main({ repositoryRoot: target });

  // The symlinked context.json is unusable (rejected, not consumed) -> no
  // usable primary.context -> main() logs and returns without writing.
  assert.equal(fs.existsSync(path.join(target, "reports", "ai", "context.json")), false);
});

test("R8-T3 aggregate-browser-context.js main(): normal in-root browser inputs still produce a written, analyzable context.json (positive control)", () => {
  const target = freshRepo("r8-main-positive");
  chromeFailureFixture(target);

  aggregateBrowserContext.main({ repositoryRoot: target });

  const written = JSON.parse(fs.readFileSync(path.join(target, "reports", "ai", "context.json"), "utf8"));
  assert.equal(written.failedTests.length, 1);
  assert.ok(written.browserCorrelation);
});

test("R8-T3b aggregate-browser-context.js main(): a repository-local (non-escaping) symlinked browser-inputs directory is still accepted", () => {
  const target = freshRepo("r8-main-inroot-symlink-target");
  const realBrowserInputs = path.join(target, "actual-browser-inputs");
  fs.mkdirSync(path.join(realBrowserInputs, "chrome"), { recursive: true });
  fs.writeFileSync(path.join(realBrowserInputs, "chrome", "browser-result.json"), JSON.stringify({ browser: "chrome", outcome: "failure", framework: "cypress" }));
  fs.writeFileSync(
    path.join(realBrowserInputs, "chrome", "context.json"),
    JSON.stringify({
      generatedAt: "2026-01-01T00:00:00.000Z",
      metadata: { framework: "cypress" },
      testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 1 }, specs: [] },
      failedTests: [{ title: "t", fullTitle: "t", specFile: "cypress/e2e/tests/x.cy.js", suite: "S", status: "failed", duration: 1, error: { message: "m", stack: null }, screenshot: null }],
      relevantFiles: {},
      knownProjectConstraints: [],
      warnings: [],
    })
  );
  fs.mkdirSync(path.join(target, "reports", "ai"), { recursive: true });
  fs.symlinkSync(realBrowserInputs, path.join(target, "reports", "ai", "browser-inputs"), "dir");

  aggregateBrowserContext.main({ repositoryRoot: target });

  const written = JSON.parse(fs.readFileSync(path.join(target, "reports", "ai", "context.json"), "utf8"));
  assert.equal(written.failedTests.length, 1);
});
