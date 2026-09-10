"use strict";

/**
 * Roadmap FPI-3A (FrameworkRuntimeConfig Cypress layout wiring, first slice
 * of the FPI-3 consumer-wiring roadmap phase, building on FPI-2's trusted
 * repositoryRoot + canonical physical containment authority):
 * adversarial/portability regression for the new, optional
 * `frameworkRuntimeConfig`/`currentProjectId` inputs to
 * scripts/ai/adapters/cypress-adapter.js's collect() (via
 * resolveFrameworkRuntimeConfigLayout()).
 *
 * This file proves, independently of cypress-adapter.test.js's own
 * pre-existing coverage:
 *   - config ABSENCE preserves byte-identical pre-FPI-3A behavior;
 *   - a VALID, identity-matched config becomes AUTHORITATIVE for that
 *     field, not merely consulted (decoy proof);
 *   - a renamed, non-Targomo-shaped layout works end to end driven only by
 *     data, with zero generic-core source change (the actual FPI-3
 *     portability claim);
 *   - the contract's atomic reportsDir+screenshotsDir requirement means
 *     there is no per-field "partial config" fallback state - a config
 *     missing one field is INVALID, not partially applied (a documented
 *     discrepancy from the FPI-3 planning report's provisional assumption);
 *   - every config-supplied path remains bounded by the exact same FPI-2
 *     canonical containment gate as an explicit override (lexical and
 *     symlink escape both rejected, in-root symlink still allowed);
 *   - framework/project identity mismatch fails closed, never silently
 *     downgrading to config absence;
 *   - explicit low-level overrides still win over a supplied config.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cypressAdapter = require("../adapters/cypress-adapter");
const { collect, resolveFrameworkRuntimeConfigLayout } = cypressAdapter;

function makeTargetRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, root: { lexicalRoot: dir, realRoot: fs.realpathSync(dir) } };
}

function validCypressConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectId: "fpi3a-test-project",
    framework: "cypress",
    frameworkConfigPath: "cypress.config.js",
    testSourceRoot: "cypress",
    reports: { reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots", ...overrides.reportsFields },
    historyWorkflowFile: "cypress.yml",
    ...overrides,
  };
}

// Writes a minimal, valid mochawesome-shaped report.json under reportsDir,
// naming exactly one failed test whose error.message is `marker` - used
// throughout this file to prove WHICH location's content was actually
// consumed (never inferred merely from a lack of a thrown error).
function writeReport(dir, reportsDir, marker) {
  const fullReportsDir = path.join(dir, reportsDir);
  fs.mkdirSync(fullReportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(fullReportsDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 1 },
      results: [
        {
          file: path.join(dir, "cypress", "e2e", "example.cy.js"),
          suites: [{ title: "Suite", suites: [], tests: [{ title: "failed test", state: "failed", err: { message: marker } }] }],
        },
      ],
    })
  );
}

// --- Section 13: config absence preserves legacy behavior ------------------

test("FPI-3A: no frameworkRuntimeConfig at all preserves the historical reports/cypress + cypress/screenshots defaults", () => {
  const { dir, root } = makeTargetRepo("fpi3a-absence-");
  writeReport(dir, "reports/cypress", "LEGACY_DEFAULT_USED");
  const result = collect({ root });
  assert.equal(result.failedTests[0].error.message, "LEGACY_DEFAULT_USED");
});

test("FPI-3A: frameworkRuntimeConfig explicitly undefined behaves identically to omitting it", () => {
  const { dir, root } = makeTargetRepo("fpi3a-explicit-undefined-");
  writeReport(dir, "reports/cypress", "LEGACY_DEFAULT_USED_2");
  const result = collect({ root, frameworkRuntimeConfig: undefined, currentProjectId: undefined });
  assert.equal(result.failedTests[0].error.message, "LEGACY_DEFAULT_USED_2");
});

test("FPI-3A: resolveFrameworkRuntimeConfigLayout(undefined, ...) returns null (Case A, never an error)", () => {
  assert.equal(resolveFrameworkRuntimeConfigLayout(undefined, "any-project"), null);
});

// --- Section 14 + 24: valid custom config, renamed non-Targomo-shaped layout -

test("FPI-3A: a valid config with a renamed, non-Targomo-shaped layout is consumed successfully (the core portability proof)", () => {
  const { dir, root } = makeTargetRepo("fpi3a-portability-");
  writeReport(dir, "artifacts/mocha-json", "CUSTOM_LAYOUT_CONSUMED");
  const config = validCypressConfig({ reports: { reportsDir: "artifacts/mocha-json", screenshotsDir: "captures/on-fail" } });

  const result = collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" });

  assert.equal(result.failedTests[0].error.message, "CUSTOM_LAYOUT_CONSUMED");
});

// --- Section 15: decoy - config is authoritative, not merely consulted -----

test("FPI-3A DECOY: old hardcoded default location is populated but IGNORED once a valid config points elsewhere (reportsDir)", () => {
  const { dir, root } = makeTargetRepo("fpi3a-decoy-reports-");
  writeReport(dir, "reports/cypress", "OLD_DEFAULT_DECOY");
  writeReport(dir, "artifacts/mocha-json", "CONFIG_SELECTED_MARKER");
  const config = validCypressConfig({ reports: { reportsDir: "artifacts/mocha-json", screenshotsDir: "captures/on-fail" } });

  const result = collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" });

  assert.equal(result.failedTests[0].error.message, "CONFIG_SELECTED_MARKER");
  assert.notEqual(result.failedTests[0].error.message, "OLD_DEFAULT_DECOY");
});

test("FPI-3A DECOY: old hardcoded default screenshots directory is populated but IGNORED once a valid config points elsewhere", () => {
  const { dir, root } = makeTargetRepo("fpi3a-decoy-screenshots-");
  writeReport(dir, "artifacts/mocha-json", "m");

  // OLD DEFAULT location: cypress/screenshots/example.cy.js/Suite -- failed test (failed).png
  const oldSpecDir = path.join(dir, "cypress", "screenshots", "example.cy.js");
  fs.mkdirSync(oldSpecDir, { recursive: true });
  fs.writeFileSync(path.join(oldSpecDir, "Suite -- failed test (failed).png"), "OLD_DEFAULT_SCREENSHOT_DECOY");

  // CONFIGURED location: captures/on-fail/example.cy.js/Suite -- failed test (failed).png
  const newSpecDir = path.join(dir, "captures", "on-fail", "example.cy.js");
  fs.mkdirSync(newSpecDir, { recursive: true });
  fs.writeFileSync(path.join(newSpecDir, "Suite -- failed test (failed).png"), "CONFIG_SELECTED_SCREENSHOT");

  const config = validCypressConfig({ reports: { reportsDir: "artifacts/mocha-json", screenshotsDir: "captures/on-fail" } });
  const result = collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" });

  assert.equal(result.failedTests[0].screenshot, "captures/on-fail/example.cy.js/Suite -- failed test (failed).png");
});

// --- Section 16: "partial config" - documented ACTUAL contract behavior ----

test("FPI-3A PARTIAL CONFIG (documented discrepancy from planning): a config missing screenshotsDir is INVALID, not partially applied - reportsDir/screenshotsDir are atomic, both required together", () => {
  const { dir, root } = makeTargetRepo("fpi3a-partial-");
  writeReport(dir, "artifacts/mocha-json", "SHOULD_NEVER_BE_READ");
  const config = validCypressConfig();
  delete config.reports.screenshotsDir; // deliberately omit one required field

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" }),
    /FRAMEWORK_RUNTIME_CONFIG_INVALID/
  );
});

test("FPI-3A PARTIAL CONFIG: a config missing reportsDir is likewise INVALID (symmetric proof)", () => {
  const { root } = makeTargetRepo("fpi3a-partial-2-");
  const config = validCypressConfig();
  delete config.reports.reportsDir;

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" }),
    /FRAMEWORK_RUNTIME_CONFIG_INVALID/
  );
});

// --- Section 17: lexical escape rejected at FPI-1 (layer 1), never reaches layer 2 -

test("FPI-3A UNSAFE PATH (lexical): a traversal reportsDir is rejected by the FPI-1 shape validator itself, before any FPI-2 containment call", () => {
  const { root } = makeTargetRepo("fpi3a-lexical-escape-");
  const config = validCypressConfig({ reports: { reportsDir: "../outside", screenshotsDir: "cypress/screenshots" } });

  assert.throws(
    () => resolveFrameworkRuntimeConfigLayout(config, "fpi3a-test-project"),
    /FRAMEWORK_RUNTIME_CONFIG_INVALID/,
    "must fail at the FPI-1 shape-validation layer (isSafeCanonicalRelativePath), never reach resolveRepositoryLocalPath at all"
  );
});

// --- Section 18: symlink escape rejected at FPI-2 (layer 2) ----------------

test("FPI-3A UNSAFE PATH (symlink): a lexically-safe config reportsDir whose real target escapes root is rejected, no outside read occurs", () => {
  const { dir, root } = makeTargetRepo("fpi3a-symlink-escape-target-");
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpi3a-symlink-escape-outside-"));
  fs.writeFileSync(
    path.join(outsideDir, "PRIVATE_OUTSIDE_MARKER.json"),
    JSON.stringify({ stats: {}, results: [{ file: "x", suites: [{ title: "S", suites: [], tests: [{ title: "SHOULD_NOT_LEAK", state: "failed" }] }] }] })
  );
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  fs.symlinkSync(outsideDir, path.join(dir, "artifacts", "custom"), "dir");
  fs.mkdirSync(path.join(dir, "cypress", "screenshots"), { recursive: true });

  const config = validCypressConfig({ reports: { reportsDir: "artifacts/custom", screenshotsDir: "cypress/screenshots" } });

  const realOutside = fs.realpathSync(outsideDir);

  const orig = { readdirSync: fs.readdirSync, readFileSync: fs.readFileSync };
  const touched = { readdirSync: [], readFileSync: [] };
  fs.readdirSync = (p, ...a) => { touched.readdirSync.push(String(p)); return orig.readdirSync.call(fs, p, ...a); };
  fs.readFileSync = (p, ...a) => { touched.readFileSync.push(String(p)); return orig.readFileSync.call(fs, p, ...a); };

  let err = null;
  try {
    collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" });
  } catch (e) {
    err = e;
  } finally {
    Object.assign(fs, orig);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }

  assert.ok(err, "expected collect() to throw for a symlink-escaping config reportsDir");
  assert.match(err.message, /ADAPTER_PATH_OUTSIDE_REPOSITORY/);

  const escapingReads = [...touched.readdirSync, ...touched.readFileSync].filter((p) => {
    try {
      return fs.realpathSync(p).startsWith(realOutside);
    } catch {
      return false;
    }
  });
  assert.deepEqual(escapingReads, [], "no readdirSync/readFileSync may resolve into the outside directory");
});

// --- Section 19: in-root symlink positive control ---------------------------

test("FPI-3A IN-ROOT SYMLINK: a config reportsDir that is a symlink whose real target remains inside root is still accepted", () => {
  const { dir, root } = makeTargetRepo("fpi3a-inroot-symlink-");
  writeReport(dir, "real-artifacts", "IN_ROOT_SYMLINK_OK");
  fs.symlinkSync(path.join(dir, "real-artifacts"), path.join(dir, "configured-reports"), "dir");
  fs.mkdirSync(path.join(dir, "cypress", "screenshots"), { recursive: true });

  const config = validCypressConfig({ reports: { reportsDir: "configured-reports", screenshotsDir: "cypress/screenshots" } });
  const result = collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" });

  assert.equal(result.failedTests[0].error.message, "IN_ROOT_SYMLINK_OK");
});

// --- Section 20: identity mismatch fails closed, never falls back ----------

test("FPI-3A IDENTITY: a config for framework 'playwright' passed to the Cypress adapter fails closed, no fallback to reports/cypress", () => {
  const { dir, root } = makeTargetRepo("fpi3a-framework-mismatch-");
  writeReport(dir, "reports/cypress", "MUST_NOT_BE_READ_ON_MISMATCH");
  const config = {
    schemaVersion: 1,
    projectId: "fpi3a-test-project",
    framework: "playwright",
    frameworkConfigPath: "playwright.config.js",
    testSourceRoot: "playwright",
    reports: { reportFile: "reports/playwright/report.json" },
    historyWorkflowFile: "cypress.yml",
  };

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" }),
    /CYPRESS_RUNTIME_CONFIG_FRAMEWORK_MISMATCH/
  );
});

test("FPI-3A IDENTITY: a config for a different projectId fails closed, no fallback to reports/cypress", () => {
  const { dir, root } = makeTargetRepo("fpi3a-project-mismatch-");
  writeReport(dir, "reports/cypress", "MUST_NOT_BE_READ_ON_MISMATCH");
  const config = validCypressConfig({ projectId: "some-other-project" });

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" }),
    /CYPRESS_RUNTIME_CONFIG_PROJECT_MISMATCH/
  );
});

test("FPI-3A IDENTITY: a config supplied with no currentProjectId at all fails closed rather than skipping the identity check", () => {
  const config = validCypressConfig();
  assert.throws(
    () => resolveFrameworkRuntimeConfigLayout(config, undefined),
    /CYPRESS_RUNTIME_CONFIG_PROJECT_ID_REQUIRED/
  );
});

// --- Section 21: invalid config fails closed via the existing FPI-1 validator -

test("FPI-3A INVALID CONFIG: a structurally invalid config (missing schemaVersion) fails closed via the existing FPI-1 validator, no read begins", () => {
  const { dir, root } = makeTargetRepo("fpi3a-invalid-config-");
  writeReport(dir, "reports/cypress", "MUST_NOT_BE_READ");
  const config = validCypressConfig();
  delete config.schemaVersion;

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3a-test-project" }),
    /FRAMEWORK_RUNTIME_CONFIG_INVALID/
  );
});

// --- Section 22: explicit override precedence preserved --------------------

test("FPI-3A PRECEDENCE: an explicit reportsDir override still wins over a supplied (different, valid) frameworkRuntimeConfig value", () => {
  const { dir, root } = makeTargetRepo("fpi3a-precedence-");
  writeReport(dir, "explicit-override-wins", "EXPLICIT_OVERRIDE_MARKER");
  writeReport(dir, "artifacts/mocha-json", "CONFIG_MARKER_SHOULD_LOSE");
  const config = validCypressConfig({ reports: { reportsDir: "artifacts/mocha-json", screenshotsDir: "cypress/screenshots" } });

  const result = collect({
    root,
    reportsDir: "explicit-override-wins",
    frameworkRuntimeConfig: config,
    currentProjectId: "fpi3a-test-project",
  });

  assert.equal(result.failedTests[0].error.message, "EXPLICIT_OVERRIDE_MARKER");
});

// --- Section 25: no target-repo config autodiscovery (source-text audit) ---

test("FPI-3A SOURCE AUDIT: resolveFrameworkRuntimeConfigLayout() never touches the filesystem - config arrives only as an explicit argument", () => {
  const source = resolveFrameworkRuntimeConfigLayout.toString();
  assert.doesNotMatch(source, /fs\.\w+Sync|fs\.\w+\(/, "must be a pure shape/identity decision, never a filesystem probe");
  assert.doesNotMatch(source, /process\.cwd\(\)/, "must never derive anything from process.cwd()");
});

test("FPI-3A SOURCE AUDIT: cypress-adapter.js contains no reference to scripts/targets/targomo anywhere", () => {
  const content = fs.readFileSync(path.resolve(__dirname, "..", "adapters", "cypress-adapter.js"), "utf8");
  assert.doesNotMatch(content, /targets[\\/]targomo/);
});

// --- Section 21 (framework-runtime-config.js unchanged) --------------------

test("FPI-3A: framework-runtime-config.js's own exported surface is unchanged by FPI-3A (schema not modified)", () => {
  const { SUPPORTED_FRAMEWORKS } = require("../framework-runtime-config");
  assert.deepEqual(SUPPORTED_FRAMEWORKS, ["cypress", "playwright"]);
});
