/**
 * Project B target-owned FrameworkRuntimeConfig producer (Roadmap FPI-4A).
 *
 * Roadmap FPI-1 introduced FrameworkRuntimeConfig as a pure contract;
 * FPI-3A/FPI-3B/FPI-3C wired real CONSUMERS for it (cypress-adapter.js,
 * playwright-adapter.js, collect-history.js) - but until this file, no
 * production-shaped code anywhere actually CONSTRUCTED one; every existing
 * example lived only inside test bodies (see the FPI-4 planning report's
 * own producer/consumer matrix). This is the first real target-owned
 * producer, mirroring scripts/targets/targomo/project-profile.js's own
 * "frozen constant, self-checked against the generic validator at module
 * load" shape - the same pattern applied to a second FPI-1 contract.
 *
 * Deliberately Playwright, not Cypress: Targomo's own production path
 * defaults to Cypress (scripts/ai/adapters/cypress-adapter.js, selected
 * whenever QA_FRAMEWORK is unset) and has never supplied a
 * FrameworkRuntimeConfig at all - every field below is chosen to differ
 * materially from BOTH Targomo's framework choice and its historical
 * hardcoded defaults, proving genuine per-target divergence rather than a
 * renamed fixture (see the FPI-4A mission's own "must not be a
 * string-rename test" requirement).
 */

"use strict";

const { assertValidFrameworkRuntimeConfig } = require("../../ai/framework-runtime-config");
const { PROJECT_B_PROJECT_PROFILE } = require("./project-profile");

const PROJECT_B_FRAMEWORK_RUNTIME_CONFIG = Object.freeze({
  schemaVersion: 1,
  projectId: PROJECT_B_PROJECT_PROFILE.id,
  framework: "playwright",
  frameworkConfigPath: "project-b-playwright.config.js",
  testSourceRoot: "project-b-e2e",
  reports: Object.freeze({ reportFile: "artifacts/project-b/browser-results/report.json" }),
  historyWorkflowFile: "project-b-ci.yml",
});

// Self-check at module load, matching project-profile.js's own
// established convention: a Project B config that somehow failed the
// generic FPI-1 validator must fail loudly here, never surface later as a
// confusing consumer-side error.
assertValidFrameworkRuntimeConfig(
  PROJECT_B_FRAMEWORK_RUNTIME_CONFIG,
  "scripts/targets/project-b/framework-runtime-config.js self-check"
);

module.exports = { PROJECT_B_FRAMEWORK_RUNTIME_CONFIG };
