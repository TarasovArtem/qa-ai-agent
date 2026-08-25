const { defineConfig, devices } = require("@playwright/test");

// Roadmap #21F: real production Playwright runtime configuration.
//
// testDir MUST stay exactly "./playwright" (never a deeper path such as
// "./playwright/tests") - this is the explicit, binding contract locked by
// Roadmap #21C-C1 in scripts/ai/collect-context.js's own
// RELEVANT_FILES_POLICIES.playwright comment: under this setting, the real
// reporter emits spec.file relative to playwright/ itself (e.g.
// "tests/smoke.spec.js"), which collect-context.js's
// resolveSpecCandidates() re-roots under playwright/ to find the real
// source file. Changing testDir here without updating that policy would
// silently break Roadmap #21C's RelevantFiles source resolution (R1).
//
// The JSON reporter's outputFile is deliberately identical to
// scripts/ai/adapters/playwright-adapter.js's own DEFAULT_REPORT_FILE
// (reports/playwright/report.json) - the production collect-context CLI
// therefore needs no new Playwright-specific adapterOptions wiring at all;
// QA_FRAMEWORK=playwright already finds this exact file via the adapter's
// existing default.
module.exports = defineConfig({
  testDir: "./playwright",
  outputDir: "reports/playwright/test-results",

  // A single representative smoke flow against a public external SUT -
  // never parallelized, never retried, never run across multiple browsers.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: [
    ["line"],
    ["json", { outputFile: "reports/playwright/report.json" }],
  ],

  use: {
    baseURL: "https://poi.targomo.com",
    // Repo-local by construction (outputDir above) - never OS temp, never
    // an absolute user-specific directory. Only captured on failure, and
    // this stage does not intentionally produce one (see the smoke spec).
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
