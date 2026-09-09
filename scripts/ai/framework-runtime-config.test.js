"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SUPPORTED_FRAMEWORKS,
  validateFrameworkRuntimeConfig,
  assertValidFrameworkRuntimeConfig,
} = require("./framework-runtime-config");

// Roadmap FPI-1: this is a generic core contract - every test below uses
// synthetic values, never the real Targomo target. Real Targomo
// integration proof belongs to a later FPI phase's target-owned tests
// (scripts/targets/targomo/**), not here.

function validCypressConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectId: "external-poi-sut",
    framework: "cypress",
    frameworkConfigPath: "cypress.config.js",
    testSourceRoot: "cypress",
    reports: { reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots" },
    historyWorkflowFile: "cypress.yml",
    ...overrides,
  };
}

function validPlaywrightConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectId: "external-poi-sut",
    framework: "playwright",
    frameworkConfigPath: "playwright.config.js",
    testSourceRoot: "playwright",
    reports: { reportFile: "reports/playwright/report.json" },
    historyWorkflowFile: "cypress.yml",
    ...overrides,
  };
}

// --- SUPPORTED_FRAMEWORKS -------------------------------------------------

test("SUPPORTED_FRAMEWORKS: is the closed, frozen two-entry cypress/playwright vocabulary", () => {
  assert.deepEqual(SUPPORTED_FRAMEWORKS, ["cypress", "playwright"]);
  assert.equal(Object.isFrozen(SUPPORTED_FRAMEWORKS), true);
});

// --- valid configs ---------------------------------------------------------

test("validateFrameworkRuntimeConfig: accepts a well-formed synthetic Cypress config", () => {
  const { valid, errors } = validateFrameworkRuntimeConfig(validCypressConfig());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateFrameworkRuntimeConfig: accepts a well-formed synthetic Playwright config", () => {
  const { valid, errors } = validateFrameworkRuntimeConfig(validPlaywrightConfig());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

// --- multi-framework model (Section 36) ------------------------------------

test("multi-framework model: the same projectId supports one Cypress and one Playwright FrameworkRuntimeConfig independently", () => {
  const cypressConfig = validCypressConfig({ projectId: "shared-project" });
  const playwrightConfig = validPlaywrightConfig({ projectId: "shared-project" });

  const cypressResult = validateFrameworkRuntimeConfig(cypressConfig);
  const playwrightResult = validateFrameworkRuntimeConfig(playwrightConfig);

  assert.equal(cypressResult.valid, true);
  assert.equal(playwrightResult.valid, true);
  assert.equal(cypressConfig.projectId, playwrightConfig.projectId);
  // Two distinct config objects, one shared projectId reference - no
  // single object is asked to represent both framework integrations.
  assert.notEqual(cypressConfig, playwrightConfig);
});

// --- second synthetic project (Section 37) ----------------------------------

test("validateFrameworkRuntimeConfig: accepts a second, genuinely different synthetic project's config (contract test only, not a portability proof)", () => {
  const { valid, errors } = validateFrameworkRuntimeConfig({
    schemaVersion: 1,
    projectId: "shop-demo",
    framework: "playwright",
    frameworkConfigPath: "qa/playwright.e2e.config.js",
    testSourceRoot: "tests/e2e",
    reports: { reportFile: "artifacts/e2e/results.json" },
    historyWorkflowFile: "ui-tests.yml",
  });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

// --- schemaVersion (Section 38) ---------------------------------------------

test("validateFrameworkRuntimeConfig: rejects a missing schemaVersion", () => {
  const config = validCypressConfig();
  delete config.schemaVersion;
  assert.equal(validateFrameworkRuntimeConfig(config).valid, false);
});

test("validateFrameworkRuntimeConfig: rejects schemaVersion 0", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ schemaVersion: 0 })).valid, false);
});

test("validateFrameworkRuntimeConfig: rejects schemaVersion 2", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ schemaVersion: 2 })).valid, false);
});

test('validateFrameworkRuntimeConfig: rejects schemaVersion as the string "1"', () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ schemaVersion: "1" })).valid, false);
});

// --- framework (Section 39) -------------------------------------------------

test("validateFrameworkRuntimeConfig: rejects an unsupported framework value", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ framework: "selenium" })).valid, false);
});

test("validateFrameworkRuntimeConfig: rejects a case-mismatched framework value (no normalization)", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ framework: "Cypress" })).valid, false);
  assert.equal(validateFrameworkRuntimeConfig(validPlaywrightConfig({ framework: "PLAYWRIGHT" })).valid, false);
});

test("validateFrameworkRuntimeConfig: rejects an empty or missing framework", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ framework: "" })).valid, false);
  const config = validCypressConfig();
  delete config.framework;
  assert.equal(validateFrameworkRuntimeConfig(config).valid, false);
});

// --- outer unknown keys (Section 40) ----------------------------------------

test("validateFrameworkRuntimeConfig: rejects a repositoryRoot outer key", () => {
  const { valid, errors } = validateFrameworkRuntimeConfig(validCypressConfig({ repositoryRoot: "/tmp/whatever" }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("repositoryRoot")));
});

test("validateFrameworkRuntimeConfig: rejects a runnerBinary outer key", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ runnerBinary: "node_modules/.bin/cypress" })).valid, false);
});

test("validateFrameworkRuntimeConfig: rejects a regex outer key", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ regex: ".*" })).valid, false);
});

// --- report discrimination (Section 41) -------------------------------------

test("validateFrameworkRuntimeConfig: rejects Cypress config with a Playwright-shaped reports object", () => {
  assert.equal(
    validateFrameworkRuntimeConfig(validCypressConfig({ reports: { reportFile: "reports/playwright/report.json" } })).valid,
    false
  );
});

test("validateFrameworkRuntimeConfig: rejects Cypress config missing screenshotsDir", () => {
  assert.equal(
    validateFrameworkRuntimeConfig(validCypressConfig({ reports: { reportsDir: "reports/cypress" } })).valid,
    false
  );
});

test("validateFrameworkRuntimeConfig: rejects Playwright config with a Cypress-shaped reports object", () => {
  assert.equal(
    validateFrameworkRuntimeConfig(
      validPlaywrightConfig({ reports: { reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots" } })
    ).valid,
    false
  );
});

test("validateFrameworkRuntimeConfig: rejects Playwright config missing reportFile", () => {
  assert.equal(validateFrameworkRuntimeConfig(validPlaywrightConfig({ reports: {} })).valid, false);
});

test("validateFrameworkRuntimeConfig: rejects an unknown nested reports key", () => {
  assert.equal(
    validateFrameworkRuntimeConfig(
      validCypressConfig({ reports: { reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots", extra: "x" } })
    ).valid,
    false
  );
});

test("validateFrameworkRuntimeConfig: rejects a Playwright reportFile without a .json suffix", () => {
  assert.equal(
    validateFrameworkRuntimeConfig(validPlaywrightConfig({ reports: { reportFile: "reports/playwright/report.xml" } })).valid,
    false
  );
});

// --- path safety (Section 42) -----------------------------------------------

const INVALID_RELATIVE_PATHS = [
  ["absolute POSIX", "/etc/passwd"],
  ["Windows drive absolute", "C:\\tests"],
  ["UNC", "\\\\server\\share"],
  ["traversal", "../secrets"],
  ["embedded traversal", "cypress/../../../etc/passwd"],
  ["./ prefix", "./cypress"],
  ["trailing slash", "cypress/"],
  ["backslash separator", "cypress\\e2e"],
  ["empty segment", "cypress//e2e"],
  ["empty string", ""],
  ["control character", "cypress\u0000"],
];

for (const [label, value] of INVALID_RELATIVE_PATHS) {
  test(`validateFrameworkRuntimeConfig: rejects frameworkConfigPath - ${label}`, () => {
    assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ frameworkConfigPath: value })).valid, false);
  });

  test(`validateFrameworkRuntimeConfig: rejects testSourceRoot - ${label}`, () => {
    assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: value })).valid, false);
  });
}

test("validateFrameworkRuntimeConfig: accepts a multi-segment repository-relative testSourceRoot", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: "tests/e2e" })).valid, true);
});

// --- workflow file safety (Section 43) --------------------------------------

test("validateFrameworkRuntimeConfig: accepts a bare .yml/.yaml workflow filename", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ historyWorkflowFile: "cypress.yml" })).valid, true);
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ historyWorkflowFile: "e2e.yaml" })).valid, true);
});

const INVALID_WORKFLOW_FILES = [
  ["full workflows-path form", ".github/workflows/cypress.yml"],
  ["traversal", "../cypress.yml"],
  ["nested path", "foo/cypress.yml"],
  ["wrong extension", "cypress.txt"],
  ["empty", ""],
  ["control character", "cypress\u0000.yml"],
];

for (const [label, value] of INVALID_WORKFLOW_FILES) {
  test(`validateFrameworkRuntimeConfig: rejects historyWorkflowFile - ${label}`, () => {
    assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ historyWorkflowFile: value })).valid, false);
  });
}

// --- null/non-object input --------------------------------------------------

test("validateFrameworkRuntimeConfig: rejects null/non-object input without throwing", () => {
  assert.equal(validateFrameworkRuntimeConfig(null).valid, false);
  assert.equal(validateFrameworkRuntimeConfig(undefined).valid, false);
  assert.equal(validateFrameworkRuntimeConfig("cypress").valid, false);
  assert.equal(validateFrameworkRuntimeConfig([]).valid, false);
});

// --- validator purity (Section 45) ------------------------------------------

test("validateFrameworkRuntimeConfig: does not mutate a frozen valid input", () => {
  const frozen = Object.freeze(
    Object.assign(validCypressConfig(), { reports: Object.freeze(validCypressConfig().reports) })
  );
  const { valid } = validateFrameworkRuntimeConfig(frozen);
  assert.equal(valid, true);
});

// --- assertValidFrameworkRuntimeConfig --------------------------------------

test("assertValidFrameworkRuntimeConfig: returns the config unchanged when valid", () => {
  const config = validCypressConfig();
  assert.equal(assertValidFrameworkRuntimeConfig(config, "test caller"), config);
});

test("assertValidFrameworkRuntimeConfig: throws FRAMEWORK_RUNTIME_CONFIG_REQUIRED for undefined", () => {
  assert.throws(
    () => assertValidFrameworkRuntimeConfig(undefined, "test caller"),
    /FRAMEWORK_RUNTIME_CONFIG_REQUIRED: test caller/
  );
});

test("assertValidFrameworkRuntimeConfig: throws FRAMEWORK_RUNTIME_CONFIG_REQUIRED for null", () => {
  assert.throws(
    () => assertValidFrameworkRuntimeConfig(null, "test caller"),
    /FRAMEWORK_RUNTIME_CONFIG_REQUIRED: test caller/
  );
});

test("assertValidFrameworkRuntimeConfig: throws FRAMEWORK_RUNTIME_CONFIG_UNSUPPORTED_VERSION for a present-but-wrong schemaVersion", () => {
  assert.throws(
    () => assertValidFrameworkRuntimeConfig(validCypressConfig({ schemaVersion: 2 }), "test caller"),
    /FRAMEWORK_RUNTIME_CONFIG_UNSUPPORTED_VERSION: test caller/
  );
});

test("assertValidFrameworkRuntimeConfig: throws FRAMEWORK_RUNTIME_CONFIG_INVALID for a malformed non-null config, naming the caller and reason", () => {
  assert.throws(
    () => assertValidFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: "" }), "test caller"),
    /FRAMEWORK_RUNTIME_CONFIG_INVALID: test caller.*testSourceRoot/
  );
});

test("assertValidFrameworkRuntimeConfig: throws FRAMEWORK_RUNTIME_CONFIG_INVALID for an empty object", () => {
  assert.throws(() => assertValidFrameworkRuntimeConfig({}, "test caller"), /FRAMEWORK_RUNTIME_CONFIG_INVALID: test caller/);
});

test("assertValidFrameworkRuntimeConfig: bounded error never reflects unrelated large/nested caller data", () => {
  const longSecret = "x".repeat(5000);
  let thrown;
  try {
    assertValidFrameworkRuntimeConfig(
      { ...validCypressConfig(), framework: "selenium", secretPayload: longSecret },
      "test caller"
    );
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown);
  assert.equal(thrown.message.includes(longSecret), false);
  assert.ok(thrown.message.length < 2000);
});
