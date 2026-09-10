"use strict";

/**
 * Roadmap FPI-3B (FrameworkRuntimeConfig Playwright layout wiring, second
 * slice of the FPI-3 consumer-wiring roadmap phase, applying the
 * independently-approved FPI-3A pattern - see
 * scripts/ai/adapters/cypress-runtime-config.test.js - to Playwright):
 * adversarial/portability regression for the new, optional
 * `frameworkRuntimeConfig`/`currentProjectId` inputs to
 * scripts/ai/adapters/playwright-adapter.js's collect() (via
 * resolveFrameworkRuntimeConfigReportFile()).
 *
 * Mirrors cypress-runtime-config.test.js's structure and coverage,
 * narrowed to Playwright's single `reports.reportFile` field (there is no
 * Cypress-style multi-field atomicity concern for Playwright's own
 * `reports` shape, since PLAYWRIGHT_REPORTS_ALLOWED_KEYS has only one
 * entry - but the whole FrameworkRuntimeConfig object is still validated
 * atomically by the shared FPI-1 validator).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const playwrightAdapter = require("../adapters/playwright-adapter");
const { collect, resolveFrameworkRuntimeConfigReportFile } = playwrightAdapter;

function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, root: { lexicalRoot: dir, realRoot: fs.realpathSync(dir) } };
}

function validPlaywrightConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectId: "fpi3b-test-project",
    framework: "playwright",
    frameworkConfigPath: "playwright.config.js",
    testSourceRoot: "playwright",
    reports: { reportFile: "reports/playwright/report.json", ...overrides.reportsFields },
    historyWorkflowFile: "cypress.yml",
    ...overrides,
  };
}

// Writes a minimal, valid Playwright official-JSON-reporter-shaped
// report at the given absolute reportFile path, naming exactly one
// "unexpected" (failed) test whose error.message is `marker` - used
// throughout this file to prove WHICH location's content was actually
// consumed.
function writeReport(reportFile, marker) {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(
    reportFile,
    JSON.stringify({
      config: {},
      errors: [],
      stats: {},
      suites: [
        {
          title: "example.spec.ts",
          file: "example.spec.ts",
          line: 1,
          column: 1,
          specs: [
            {
              title: "failing test",
              ok: false,
              tags: [],
              id: "id-1",
              file: "example.spec.ts",
              line: 1,
              column: 1,
              tests: [
                {
                  timeout: 30000,
                  annotations: [],
                  expectedStatus: "passed",
                  status: "unexpected",
                  results: [
                    {
                      workerIndex: 0,
                      parallelIndex: 0,
                      status: "failed",
                      duration: 1,
                      retry: 0,
                      steps: [],
                      startTime: "2026-01-01T00:00:00.000Z",
                      annotations: [],
                      attachments: [],
                      error: { message: marker, stack: null },
                    },
                  ],
                },
              ],
            },
          ],
          suites: [],
        },
      ],
    })
  );
}

// --- Section: config absence preserves legacy behavior ---------------------

test("FPI-3B: no frameworkRuntimeConfig at all preserves the historical reports/playwright/report.json default", () => {
  const { dir, root } = fresh("fpi3b-absence-");
  writeReport(path.join(dir, "reports", "playwright", "report.json"), "LEGACY_DEFAULT_USED");
  const result = collect({ root });
  assert.equal(result.failedTests[0].error.message, "LEGACY_DEFAULT_USED");
});

test("FPI-3B: frameworkRuntimeConfig explicitly undefined behaves identically to omitting it", () => {
  const { dir, root } = fresh("fpi3b-explicit-undefined-");
  writeReport(path.join(dir, "reports", "playwright", "report.json"), "LEGACY_DEFAULT_USED_2");
  const result = collect({ root, frameworkRuntimeConfig: undefined, currentProjectId: undefined });
  assert.equal(result.failedTests[0].error.message, "LEGACY_DEFAULT_USED_2");
});

test("FPI-3B: resolveFrameworkRuntimeConfigReportFile(undefined, ...) returns null (Case A, never an error)", () => {
  assert.equal(resolveFrameworkRuntimeConfigReportFile(undefined, "any-project"), null);
});

// --- Central portability proof ----------------------------------------------

test("FPI-3B: a valid config with a renamed, non-Targomo-shaped reportFile is consumed successfully (the core portability proof)", () => {
  const { dir, root } = fresh("fpi3b-portability-");
  writeReport(path.join(dir, "custom-output", "pw", "result-artifact.json"), "CUSTOM_LAYOUT_CONSUMED");
  const config = validPlaywrightConfig({ reports: { reportFile: "custom-output/pw/result-artifact.json" } });

  const result = collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" });

  assert.equal(result.failedTests[0].error.message, "CUSTOM_LAYOUT_CONSUMED");
  assert.equal(fs.existsSync(path.join(dir, "reports", "playwright")), false, "the legacy default directory must never have been required");
});

// --- Decoy: config is authoritative, not merely consulted ------------------

test("FPI-3B DECOY: old hardcoded default report.json is populated but IGNORED once a valid config points elsewhere", () => {
  const { dir, root } = fresh("fpi3b-decoy-");
  writeReport(path.join(dir, "reports", "playwright", "report.json"), "PLAYWRIGHT_LEGACY_DECOY");
  writeReport(path.join(dir, "custom-output", "pw", "result-artifact.json"), "PLAYWRIGHT_CONFIG_SELECTED");
  const config = validPlaywrightConfig({ reports: { reportFile: "custom-output/pw/result-artifact.json" } });

  const result = collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" });

  assert.equal(result.failedTests[0].error.message, "PLAYWRIGHT_CONFIG_SELECTED");
  assert.notEqual(result.failedTests[0].error.message, "PLAYWRIGHT_LEGACY_DECOY");
});

// --- Explicit override precedence (3-way) -----------------------------------

test("FPI-3B PRECEDENCE: an explicit reportFile override still wins over both a supplied config AND the legacy default", () => {
  const { dir, root } = fresh("fpi3b-precedence-");
  const overridePath = path.join(dir, "explicit-override-report.json");
  const configPath = path.join(dir, "custom-output", "pw", "result-artifact.json");
  const legacyPath = path.join(dir, "reports", "playwright", "report.json");
  writeReport(overridePath, "PLAYWRIGHT_OVERRIDE_SHOULD_WIN");
  writeReport(configPath, "PLAYWRIGHT_CONFIG_SHOULD_LOSE");
  writeReport(legacyPath, "PLAYWRIGHT_LEGACY_SHOULD_LOSE");
  const config = validPlaywrightConfig({ reports: { reportFile: "custom-output/pw/result-artifact.json" } });

  const result = collect({
    root,
    reportFile: overridePath,
    frameworkRuntimeConfig: config,
    currentProjectId: "fpi3b-test-project",
  });

  assert.equal(result.failedTests[0].error.message, "PLAYWRIGHT_OVERRIDE_SHOULD_WIN");
});

// --- Invalid config fails closed, no fallback -------------------------------

test("FPI-3B INVALID CONFIG: a structurally invalid config (missing schemaVersion) fails closed via the existing FPI-1 validator, no read begins", () => {
  const { dir, root } = fresh("fpi3b-invalid-config-");
  writeReport(path.join(dir, "reports", "playwright", "report.json"), "MUST_NOT_BE_READ");
  const config = validPlaywrightConfig();
  delete config.schemaVersion;

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" }),
    /FRAMEWORK_RUNTIME_CONFIG_INVALID/
  );
});

test("FPI-3B INVALID CONFIG: a config missing reports.reportFile fails closed", () => {
  const { root } = fresh("fpi3b-invalid-config-missing-reportfile-");
  const config = validPlaywrightConfig();
  delete config.reports.reportFile;

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" }),
    /FRAMEWORK_RUNTIME_CONFIG_INVALID/
  );
});

// --- Framework/project identity mismatch fails closed, never falls back ----

test("FPI-3B IDENTITY: a config for framework 'cypress' passed to the Playwright adapter fails closed, no fallback to reports/playwright/report.json", () => {
  const { dir, root } = fresh("fpi3b-framework-mismatch-");
  writeReport(path.join(dir, "reports", "playwright", "report.json"), "MUST_NOT_BE_READ_FRAMEWORK_MISMATCH");
  const config = {
    schemaVersion: 1,
    projectId: "fpi3b-test-project",
    framework: "cypress",
    frameworkConfigPath: "cypress.config.js",
    testSourceRoot: "cypress",
    reports: { reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots" },
    historyWorkflowFile: "cypress.yml",
  };

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" }),
    /PLAYWRIGHT_RUNTIME_CONFIG_FRAMEWORK_MISMATCH/
  );
});

test("FPI-3B IDENTITY: a config for a different projectId fails closed, no fallback to reports/playwright/report.json", () => {
  const { dir, root } = fresh("fpi3b-project-mismatch-");
  writeReport(path.join(dir, "reports", "playwright", "report.json"), "MUST_NOT_BE_READ_PROJECT_MISMATCH");
  const config = validPlaywrightConfig({ projectId: "some-other-project" });

  assert.throws(
    () => collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" }),
    /PLAYWRIGHT_RUNTIME_CONFIG_PROJECT_MISMATCH/
  );
});

test("FPI-3B IDENTITY: a config supplied with no currentProjectId at all fails closed rather than skipping the identity check", () => {
  const config = validPlaywrightConfig();
  assert.throws(
    () => resolveFrameworkRuntimeConfigReportFile(config, undefined),
    /PLAYWRIGHT_RUNTIME_CONFIG_PROJECT_ID_REQUIRED/
  );
});

// --- Lexical escape rejected at FPI-1 layer, never reaches FPI-2 -----------

test("FPI-3B UNSAFE PATH (lexical): a traversal reportFile is rejected by the FPI-1 shape validator itself, before any FPI-2 containment call", () => {
  const config = validPlaywrightConfig({ reports: { reportFile: "../outside/report.json" } });

  assert.throws(
    () => resolveFrameworkRuntimeConfigReportFile(config, "fpi3b-test-project"),
    /FRAMEWORK_RUNTIME_CONFIG_INVALID/,
    "must fail at the FPI-1 shape-validation layer (isSafeCanonicalRelativePath), never reach resolveRepositoryLocalPath at all"
  );
});

// --- Physical symlink escape rejected at FPI-2 layer ------------------------

test("FPI-3B UNSAFE PATH (symlink): a lexically-safe config reportFile whose real target escapes root is rejected, no outside content consumed", () => {
  const { dir, root } = fresh("fpi3b-symlink-escape-target-");
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpi3b-symlink-escape-outside-"));
  writeReport(path.join(outsideDir, "private-report.json"), "INDEPENDENT_OUTSIDE_SECRET");
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  fs.symlinkSync(path.join(outsideDir, "private-report.json"), path.join(dir, "artifacts", "pw-report.json"), "file");

  const config = validPlaywrightConfig({ reports: { reportFile: "artifacts/pw-report.json" } });

  const orig = { readFileSync: fs.readFileSync };
  const touched = [];
  fs.readFileSync = (p, ...a) => { touched.push(String(p)); return orig.readFileSync.call(fs, p, ...a); };

  let err = null;
  try {
    collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" });
  } catch (e) {
    err = e;
  } finally {
    Object.assign(fs, orig);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }

  assert.ok(err, "expected collect() to throw for a symlink-escaping config reportFile");
  assert.match(err.message, /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
  assert.deepEqual(
    touched.filter((p) => p.includes("private-report.json")),
    [],
    "the outside report content must never be read"
  );
});

// --- In-root symlink positive control ---------------------------------------

test("FPI-3B IN-ROOT SYMLINK: a config reportFile that is a symlink whose real target remains inside root is still accepted", () => {
  const { dir, root } = fresh("fpi3b-inroot-symlink-");
  const realReportPath = path.join(dir, "real", "playwright-report.json");
  writeReport(realReportPath, "IN_ROOT_SYMLINK_OK");
  fs.mkdirSync(path.dirname(path.join(dir, "configured-report.json")), { recursive: true });
  fs.symlinkSync(realReportPath, path.join(dir, "configured-report.json"), "file");

  const config = validPlaywrightConfig({ reports: { reportFile: "configured-report.json" } });
  const result = collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" });

  assert.equal(result.failedTests[0].error.message, "IN_ROOT_SYMLINK_OK");
});

// --- Source audits: no autodiscovery, no Targomo dependency ----------------

test("FPI-3B SOURCE AUDIT: resolveFrameworkRuntimeConfigReportFile() never touches the filesystem - config arrives only as an explicit argument", () => {
  const source = resolveFrameworkRuntimeConfigReportFile.toString();
  assert.doesNotMatch(source, /fs\.\w+Sync|fs\.\w+\(/, "must be a pure shape/identity decision, never a filesystem probe");
  assert.doesNotMatch(source, /process\.cwd\(\)/, "must never derive anything from process.cwd()");
});

test("FPI-3B SOURCE AUDIT: playwright-adapter.js contains no reference to scripts/targets/targomo anywhere", () => {
  const content = fs.readFileSync(path.resolve(__dirname, "..", "adapters", "playwright-adapter.js"), "utf8");
  assert.doesNotMatch(content, /targets[\\/]targomo/);
});

// --- Attachment/screenshot containment non-regression -----------------------

test("FPI-3B ATTACHMENT NON-REGRESSION: a screenshot attachment outside the repository is still rejected when the report itself was config-selected", () => {
  const { dir, root } = fresh("fpi3b-attachment-nonregression-");
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpi3b-attachment-outside-"));
  fs.writeFileSync(path.join(outsideDir, "shot.png"), "OUTSIDE_SCREENSHOT_BYTES");
  const config = validPlaywrightConfig({ reports: { reportFile: "custom-output/pw/result-artifact.json" } });

  const reportFile = path.join(dir, "custom-output", "pw", "result-artifact.json");
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(
    reportFile,
    JSON.stringify({
      config: {},
      errors: [],
      stats: {},
      suites: [
        {
          title: "example.spec.ts",
          file: "example.spec.ts",
          line: 1,
          column: 1,
          specs: [
            {
              title: "failing test",
              ok: false,
              tags: [],
              id: "id-1",
              file: "example.spec.ts",
              line: 1,
              column: 1,
              tests: [
                {
                  timeout: 30000,
                  annotations: [],
                  expectedStatus: "passed",
                  status: "unexpected",
                  results: [
                    {
                      workerIndex: 0,
                      parallelIndex: 0,
                      status: "failed",
                      duration: 1,
                      retry: 0,
                      steps: [],
                      startTime: "2026-01-01T00:00:00.000Z",
                      annotations: [],
                      attachments: [{ name: "screenshot", contentType: "image/png", path: path.join(outsideDir, "shot.png") }],
                      error: { message: "m", stack: null },
                    },
                  ],
                },
              ],
            },
          ],
          suites: [],
        },
      ],
    })
  );

  const result = collect({ root, frameworkRuntimeConfig: config, currentProjectId: "fpi3b-test-project" });
  fs.rmSync(outsideDir, { recursive: true, force: true });

  assert.equal(result.failedTests[0].screenshot, null, "an out-of-root attachment must still be rejected regardless of where the report itself came from");
});
