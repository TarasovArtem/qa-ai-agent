"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const { TARGOMO_REPOSITORY_ROOT } = require("./repository-root");
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

// Roadmap FPI-2 argument-identity proof (not just "was called"): spies on
// core.main() and asserts the EXACT object identity of both the
// projectProfile and repositoryRoot arguments run() forwards. The
// original core.main is restored unconditionally, including on failure.
test("Targomo bootstrap: run() threads the exact TARGOMO_PROJECT_PROFILE and TARGOMO_REPOSITORY_ROOT values into core.main - argument identity, not merely invocation", (t) => {
  const originalMain = core.main;
  let captured = null;
  core.main = (args) => {
    captured = args;
    return "SENTINEL_RETURN_VALUE";
  };
  t.after(() => {
    core.main = originalMain;
  });

  const returned = run();

  assert.ok(captured, "core.main must have been called");
  assert.equal(captured.projectProfile, TARGOMO_PROJECT_PROFILE, "projectProfile must be the exact TARGOMO_PROJECT_PROFILE object, not a copy");
  assert.equal(captured.repositoryRoot, TARGOMO_REPOSITORY_ROOT, "repositoryRoot must be the exact TARGOMO_REPOSITORY_ROOT value, not a copy or a different root");
  assert.equal(returned, "SENTINEL_RETURN_VALUE", "run() must return core.main()'s own return value unchanged");
});
