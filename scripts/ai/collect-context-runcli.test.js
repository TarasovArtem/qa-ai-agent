"use strict";

/**
 * Roadmap ID-1 (Package Boundary / Public Programmatic API): dedicated
 * regression for collect-context.js's runCli() - specifically its new,
 * optional `adapterOptions` parameter, and (mandatory per the ID-1
 * mission) proof that every existing zero/one-argument caller sees
 * byte-identical pre-ID-1 behavior.
 *
 * runCli() had no direct test coverage before this file - every existing
 * collect-context test exercises main() directly. This closes that gap
 * while also proving the one real API change this roadmap stage makes.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runCli } = require("./collect-context");

const SYNTHETIC_TEST_PROFILE = Object.freeze({
  id: "id1-runcli-test-project",
  displayName: "ID-1 runCli Test Project",
  knownProjectConstraints: Object.freeze(["ID-1 runCli synthetic constraint."]),
});

function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return dir;
}

function withEnv(vars, fn) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}

function playwrightReport(specTitle, errorMessage) {
  return {
    suites: [
      {
        title: "id1.spec.js",
        file: "id1.spec.js",
        specs: [
          {
            title: specTitle,
            file: "id1.spec.js",
            tests: [
              {
                status: "unexpected",
                results: [{ status: "failed", duration: 10, error: { message: errorMessage, stack: `Error: ${errorMessage}` } }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function writeJson(dir, relPath, obj) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj, null, 2));
}

function readContext(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "reports", "ai", "context.json"), "utf8"));
}

// --- Backward compatibility: adapterOptions omitted -------------------------

test("ID-1 runCli(): omitting adapterOptions preserves the historical default report location (Playwright, no config)", (t) => {
  const dir = fresh("id1-runcli-no-options");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  writeJson(dir, "reports/playwright/report.json", playwrightReport("ID1_HISTORICAL_DEFAULT_TEST", "ID1_HISTORICAL_DEFAULT_SENTINEL"));

  withEnv({ QA_FRAMEWORK: "playwright" }, () => {
    runCli({ profile: SYNTHETIC_TEST_PROFILE, repositoryRoot: dir });
  });

  const context = readContext(dir);
  assert.equal(context.metadata.framework, "playwright");
  assert.equal(context.failedTests[0].title, "ID1_HISTORICAL_DEFAULT_TEST");
  assert.ok(context.failedTests[0].error.message.includes("ID1_HISTORICAL_DEFAULT_SENTINEL"));
});

test("ID-1 runCli(): an explicit call with no third options object at all still works exactly as before ID-1", (t) => {
  const dir = fresh("id1-runcli-two-arg-call");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeJson(dir, "reports/playwright/report.json", playwrightReport("ID1_TWO_ARG_TEST", "ID1_TWO_ARG_SENTINEL"));

  // Deliberately the exact pre-ID-1 call shape: { profile, repositoryRoot } only.
  withEnv({ QA_FRAMEWORK: "playwright" }, () => {
    runCli({ profile: SYNTHETIC_TEST_PROFILE, repositoryRoot: dir });
  });

  const context = readContext(dir);
  assert.equal(context.failedTests[0].title, "ID1_TWO_ARG_TEST");
});

// --- New behavior: adapterOptions supplied -----------------------------------

test("ID-1 runCli(): a supplied adapterOptions.frameworkRuntimeConfig is honored, historical default location is ignored", (t) => {
  const dir = fresh("id1-runcli-with-options");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  writeJson(dir, "reports/playwright/report.json", playwrightReport("ID1_LEGACY_DECOY", "ID1_LEGACY_DECOY_MUST_NOT_APPEAR"));
  writeJson(dir, "id1-configured/report.json", playwrightReport("ID1_CONFIGURED_TEST", "ID1_CONFIGURED_SENTINEL"));

  const frameworkRuntimeConfig = {
    schemaVersion: 1,
    projectId: SYNTHETIC_TEST_PROFILE.id,
    framework: "playwright",
    frameworkConfigPath: "id1-playwright.config.js",
    testSourceRoot: "id1-e2e",
    reports: { reportFile: "id1-configured/report.json" },
    historyWorkflowFile: "id1-ci.yml",
  };

  withEnv({ QA_FRAMEWORK: "playwright" }, () => {
    runCli({ profile: SYNTHETIC_TEST_PROFILE, repositoryRoot: dir, adapterOptions: { frameworkRuntimeConfig } });
  });

  const context = readContext(dir);
  assert.equal(context.failedTests[0].title, "ID1_CONFIGURED_TEST");
  assert.ok(context.failedTests[0].error.message.includes("ID1_CONFIGURED_SENTINEL"));
  assert.equal(context.failedTests[0].error.message.includes("ID1_LEGACY_DECOY"), false);
});

test("ID-1 runCli(): adapterOptions does not bypass FrameworkRuntimeConfig identity validation - a project-mismatched config still fails closed", (t) => {
  const dir = fresh("id1-runcli-mismatch");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const mismatchedConfig = {
    schemaVersion: 1,
    projectId: "some-other-project",
    framework: "playwright",
    frameworkConfigPath: "id1-playwright.config.js",
    testSourceRoot: "id1-e2e",
    reports: { reportFile: "id1-configured/report.json" },
    historyWorkflowFile: "id1-ci.yml",
  };

  assert.throws(
    () =>
      withEnv({ QA_FRAMEWORK: "playwright" }, () =>
        runCli({ profile: SYNTHETIC_TEST_PROFILE, repositoryRoot: dir, adapterOptions: { frameworkRuntimeConfig: mismatchedConfig } })
      ),
    /PLAYWRIGHT_RUNTIME_CONFIG_PROJECT_MISMATCH/
  );
});
