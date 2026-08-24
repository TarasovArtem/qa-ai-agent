/**
 * Roadmap #21B - REPORTER-PROOF CONFIG ONLY.
 *
 * This is NOT a production Playwright configuration. It exists solely to
 * generate one real, actually-installed-@playwright/test JSON reporter
 * output so scripts/ai/adapters/playwright-adapter.js can be verified
 * against real reporter shape instead of synthetic fixtures alone (see
 * proof.spec.js in this same directory).
 *
 * No baseURL, no external network, no live SUT - every test in
 * proof.spec.js uses page.setContent() against fully local/inline HTML.
 *
 * Output (the JSON report and any screenshot/test-results artifacts) is
 * written under the OS temp directory, computed at run time, never a
 * literal path - nothing this config produces is intended to be committed;
 * only a hand-sanitized copy of the generated report is ever added to the
 * repository (see scripts/ai/__fixtures__/playwright-real-report.json).
 */

"use strict";

const os = require("os");
const path = require("path");

const OUTPUT_ROOT = path.join(os.tmpdir(), "qa-ai-agent-playwright-reporter-proof");

module.exports = {
  testDir: __dirname,
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [["json", { outputFile: path.join(OUTPUT_ROOT, "report.json") }]],
  outputDir: path.join(OUTPUT_ROOT, "test-results"),
  use: {
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
};
