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
  ["Windows drive-relative (FPI1-R-4)", "C:foo"],
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

// --- Roadmap FPI-1 corrective hardening (FPI1-R-1/R-2/R-3/R-4) -------------
//
// Regression coverage for the independent strict adversarial review's
// exact reproduced findings. Each test below documents the OLD (rejected)
// behavior it replaces, so a future regression that reintroduces any of
// these defects fails loudly.

// FPI1-R-1: prototype-inheritance validation bypass -------------------------

test("FPI1-R-1: an object with ZERO own properties that inherits every required field is REJECTED (was: ACCEPTED)", () => {
  const hostile = Object.create(validCypressConfig());
  assert.deepEqual(Object.keys(hostile), []);
  assert.equal(hostile.schemaVersion, 1); // inherited, not own
  assert.equal(validateFrameworkRuntimeConfig(hostile).valid, false);
});

test("FPI1-R-1: a reports object with ZERO own properties that inherits reportsDir/screenshotsDir is REJECTED (was: ACCEPTED)", () => {
  const hostileReports = Object.create({ reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots" });
  assert.deepEqual(Object.keys(hostileReports), []);
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ reports: hostileReports })).valid, false);
});

test("FPI1-R-1: a Playwright reports object inheriting reportFile is REJECTED", () => {
  const hostileReports = Object.create({ reportFile: "reports/playwright/report.json" });
  assert.equal(validateFrameworkRuntimeConfig(validPlaywrightConfig({ reports: hostileReports })).valid, false);
});

test("FPI1-R-1: a config with every field own EXCEPT schemaVersion (inherited) is REJECTED", () => {
  const proto = { schemaVersion: 1 };
  const config = Object.create(proto, {
    projectId: { value: "x", enumerable: true },
    framework: { value: "cypress", enumerable: true },
    frameworkConfigPath: { value: "cypress.config.js", enumerable: true },
    testSourceRoot: { value: "cypress", enumerable: true },
    reports: { value: { reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots" }, enumerable: true },
    historyWorkflowFile: { value: "cypress.yml", enumerable: true },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(config, "schemaVersion"), false);
  assert.equal(validateFrameworkRuntimeConfig(config).valid, false);
});

test("FPI1-R-1: a class instance is REJECTED as a config object", () => {
  class HostileConfig {}
  const instance = Object.assign(new HostileConfig(), validCypressConfig());
  assert.equal(validateFrameworkRuntimeConfig(instance).valid, false);
});

test("FPI1-R-1: a Date/Map/RegExp is REJECTED as a config object", () => {
  assert.equal(validateFrameworkRuntimeConfig(new Date()).valid, false);
  assert.equal(validateFrameworkRuntimeConfig(new Map(Object.entries(validCypressConfig()))).valid, false);
  assert.equal(validateFrameworkRuntimeConfig(new RegExp("x")).valid, false);
});

test("FPI1-R-1: Object.create(null) with all required OWN fields is ACCEPTED (null-prototype plain data)", () => {
  const config = Object.assign(Object.create(null), validCypressConfig());
  assert.equal(Object.getPrototypeOf(config), null);
  assert.equal(validateFrameworkRuntimeConfig(config).valid, true);
});

test("FPI1-R-1: an ordinary plain-object literal remains valid after JSON round-trip (JSON.parse(JSON.stringify(...)))", () => {
  const roundTripped = JSON.parse(JSON.stringify(validCypressConfig()));
  assert.equal(validateFrameworkRuntimeConfig(roundTripped).valid, true);
  const roundTrippedPw = JSON.parse(JSON.stringify(validPlaywrightConfig()));
  assert.equal(validateFrameworkRuntimeConfig(roundTrippedPw).valid, true);
});

// FPI1-R-2: unbounded unknown-key diagnostics --------------------------------

test("FPI1-R-2: a single 100,000-character unknown outer key produces a bounded validate() result and a bounded assert() message (was: ~100KB each)", () => {
  const config = validCypressConfig();
  config["X".repeat(100000)] = "irrelevant";

  const { valid, errors } = validateFrameworkRuntimeConfig(config);
  assert.equal(valid, false);
  assert.ok(errors.join("; ").length < 500, `expected a bounded joined message, got length ${errors.join("; ").length}`);

  let thrown;
  try {
    assertValidFrameworkRuntimeConfig(config, "probe");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown);
  assert.ok(thrown.message.length < 1500, `expected a bounded assert message, got length ${thrown.message.length}`);
  assert.ok(thrown.message.startsWith("FRAMEWORK_RUNTIME_CONFIG_INVALID:"));
});

test("FPI1-R-2: 500 unknown outer keys produce a bounded validate() result and a bounded assert() message (was: ~23KB)", () => {
  const config = validCypressConfig();
  for (let i = 0; i < 500; i++) config["unknownKey" + i] = i;

  const { errors } = validateFrameworkRuntimeConfig(config);
  assert.ok(errors.length <= 9, `expected at most 8 reported unknown keys + 1 summary line, got ${errors.length}`);

  let thrown;
  try {
    assertValidFrameworkRuntimeConfig(config, "probe");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown.message.length < 1500, `expected a bounded assert message, got length ${thrown.message.length}`);
});

test("FPI1-R-2: a huge unknown key inside the nested Cypress reports object is bounded", () => {
  const config = validCypressConfig({
    reports: { reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots", ["X".repeat(100000)]: "x" },
  });
  const { valid, errors } = validateFrameworkRuntimeConfig(config);
  assert.equal(valid, false);
  assert.ok(errors.join("; ").length < 500);
});

test("FPI1-R-2: a huge unknown key inside the nested Playwright reports object is bounded", () => {
  const config = validPlaywrightConfig({
    reports: { reportFile: "reports/playwright/report.json", ["X".repeat(100000)]: "x" },
  });
  const { valid, errors } = validateFrameworkRuntimeConfig(config);
  assert.equal(valid, false);
  assert.ok(errors.join("; ").length < 500);
});

// FPI1-R-3: schemaVersion coercion side effect -------------------------------

test("FPI1-R-3: a schemaVersion with a throwing toString() produces the stable UNSUPPORTED_VERSION error, never the coercion side effect (was: uncontrolled thrown exception)", () => {
  const evilVersion = {
    toString() {
      throw new Error("COERCION_SIDE_EFFECT");
    },
  };
  let thrown;
  try {
    assertValidFrameworkRuntimeConfig(validCypressConfig({ schemaVersion: evilVersion }), "probe");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown);
  assert.ok(thrown.message.startsWith("FRAMEWORK_RUNTIME_CONFIG_UNSUPPORTED_VERSION:"));
  assert.equal(thrown.message.includes("COERCION_SIDE_EFFECT"), false);
});

test("FPI1-R-3: a schemaVersion whose toString() returns a huge string is never reflected into the error (was: ~100KB message)", () => {
  const hugeVersion = {
    toString() {
      return "X".repeat(100000);
    },
  };
  let thrown;
  try {
    assertValidFrameworkRuntimeConfig(validCypressConfig({ schemaVersion: hugeVersion }), "probe");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown);
  assert.ok(thrown.message.length < 500, `expected a bounded message, got length ${thrown.message.length}`);
  assert.ok(thrown.message.startsWith("FRAMEWORK_RUNTIME_CONFIG_UNSUPPORTED_VERSION:"));
});

// FPI1-R-4: Windows drive-relative path --------------------------------------

test("FPI1-R-4: Windows drive-relative paths (no separator after the drive letter) are REJECTED in frameworkConfigPath and testSourceRoot (was: ACCEPTED)", () => {
  for (const value of ["C:foo", "c:foo", "Z:tests/e2e"]) {
    assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: value })).valid, false, value);
    assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ frameworkConfigPath: value })).valid, false, value);
  }
});

test("FPI1-R-4: Windows drive-absolute and UNC paths remain REJECTED (unchanged)", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: "C:/foo" })).valid, false);
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: "C:\\foo" })).valid, false);
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: "\\\\server\\share" })).valid, false);
});

test("FPI1-R-4: ordinary repository-relative paths remain ACCEPTED (unchanged)", () => {
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: "cypress" })).valid, true);
  assert.equal(validateFrameworkRuntimeConfig(validCypressConfig({ testSourceRoot: "tests/e2e" })).valid, true);
});
