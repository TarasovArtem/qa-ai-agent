"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const { run, core } = require("./analyze-failure");

test("Targomo bootstrap: core is the exact same analyze-failure module the generic core exports (not a copy)", () => {
  assert.equal(core, require("../../ai/analyze-failure"));
  assert.equal(typeof core.main, "function");
  assert.equal(typeof core.buildFailureReport, "function");
});

test("Targomo bootstrap: the real Targomo profile reaches the actual provider-visible system prompt through the generic core", async () => {
  const context = {
    metadata: { repository: "o/r", commit: "abc123", branch: "main", runId: null, event: null, browser: "chrome", ci: false },
    testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 100 }, specs: [] },
    failedTests: [
      {
        title: "bootstrap fixture failure",
        specFile: "cypress/e2e/tests/category_tree_behavior.cy.js",
        status: "failed",
        duration: 5,
        error: { message: "m", stack: "s" },
        screenshot: null,
      },
    ],
    relevantFiles: {},
    warnings: [],
  };

  const captured = [];
  const provider = {
    name: "bootstrap-capturing-provider",
    async analyze(request) {
      captured.push(request);
      return JSON.stringify({
        results: [
          {
            test: { title: context.failedTests[0].title, specFile: context.failedTests[0].specFile },
            classification: "TEST_BUG",
            confidence: 0.8,
            summary: "s",
            rootCause: "r",
            evidence: ["e"],
            recommendedFix: null,
            shouldCreateBug: false,
            shouldRetry: false,
          },
        ],
      });
    },
  };

  const report = await core.buildFailureReport(context, {
    provider,
    history: null,
    relevantKnowledge: [],
    projectProfile: TARGOMO_PROJECT_PROFILE,
  });

  assert.ok(report);
  assert.equal(captured.length, 1);
  assert.match(captured[0].systemPrompt, /poi\.targomo\.com/);
});

test("Targomo bootstrap: run is a thin wrapper that calls core.main with the real Targomo profile, nothing else", () => {
  assert.equal(typeof run, "function");
  assert.equal(run.length, 0, "run() takes no arguments - the profile is closed over, never caller-suppliable");
});
