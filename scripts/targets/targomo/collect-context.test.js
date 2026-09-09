"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const { run, core } = require("./collect-context");
const cypressAdapter = require("../../ai/adapters/cypress-adapter");

const ROOT = path.resolve(__dirname, "..", "..", "..");

// This file's own owned reports/cypress and reports/ai/context.json
// paths - matches scripts/ai/collect-context.test.js's own
// cleanOwnedReportPaths() convention, but scoped to this file so it
// cannot collide with that file's real-path main() usage.
function cleanOwnedReportPaths() {
  fs.rmSync(path.join(ROOT, "reports", "cypress"), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "reports", "ai", "context.json"), { force: true });
}

test("Targomo bootstrap: run() threads TARGOMO_PROJECT_PROFILE into the generic core, preserving projectId/knownProjectConstraints byte-identical to production", (t) => {
  const reportsDir = path.join(ROOT, "reports", "cypress");
  const outputFile = path.join(ROOT, "reports", "ai", "context.json");
  const savedFramework = process.env.QA_FRAMEWORK;
  delete process.env.QA_FRAMEWORK;
  cleanOwnedReportPaths();
  t.after(() => {
    cleanOwnedReportPaths();
    if (savedFramework === undefined) delete process.env.QA_FRAMEWORK;
    else process.env.QA_FRAMEWORK = savedFramework;
  });

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 5 },
      results: [
        {
          file: "cypress/e2e/tests/category_tree_behavior.cy.js",
          suites: [{ title: "Suite", suites: [], tests: [{ title: "bootstrap fixture failure", state: "failed", duration: 5, err: { message: "m", estack: "s" } }] }],
        },
      ],
    })
  );

  run();

  const written = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(written.metadata.projectId, "external-poi-sut");
  assert.equal(written.metadata.projectId, TARGOMO_PROJECT_PROFILE.id);
  assert.deepEqual(written.knownProjectConstraints, TARGOMO_PROJECT_PROFILE.knownProjectConstraints);
  assert.equal(written.metadata.framework, "cypress");
});

test("Targomo bootstrap: core is the exact same collect-context module the generic core exports (not a copy)", () => {
  assert.equal(core, require("../../ai/collect-context"));
  assert.equal(typeof core.runCli, "function");
});

// Roadmap TI-1 (supersedes the pre-TI-1 "D21E-1" scenario in
// scripts/ai/collect-context.test.js, which spawned the raw generic core
// CLI directly - that CLI now fails closed with no profile, so this
// zero-config Cypress end-to-end proof moves here, spawning the
// TARGET-owned bootstrap instead): the real, spawned, actual production
// CLI (`node scripts/targets/targomo/collect-context.js`) with
// QA_FRAMEWORK genuinely absent from the child's environment - the
// strongest possible proof that the real production entrypoint still
// selects Cypress end-to-end and still writes the real Targomo project
// identity, unchanged by TI-1.
test("spawned CLI, QA_FRAMEWORK absent: the real Targomo production entrypoint selects Cypress end-to-end and preserves project identity", () => {
  const outputFile = path.join(ROOT, "reports", "ai", "context.json");
  const reportsDir = path.join(ROOT, "reports", "cypress");
  cleanOwnedReportPaths();
  try {
    fs.mkdirSync(reportsDir, { recursive: true });
    const marker = "TI1_TARGOMO_ZERO_CONFIG_CYPRESS_MARKER";
    fs.writeFileSync(
      path.join(reportsDir, "report.json"),
      JSON.stringify({
        stats: { tests: 1, passes: 1, failures: 0, pending: 0, duration: 3 },
        results: [
          {
            file: "cypress/e2e/tests/category_tree_behavior.cy.js",
            suites: [{ title: marker, suites: [], tests: [{ title: "spawned CLI fixture test", state: "passed", duration: 3 }] }],
          },
        ],
      })
    );

    const env = { ...process.env };
    delete env.QA_FRAMEWORK;

    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "targets", "targomo", "collect-context.js")], {
      cwd: ROOT,
      env,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, "the zero-config Targomo production CLI must exit successfully");
    assert.ok(!result.stdout.includes("playwright"), "stdout must never mention Playwright for a zero-config Cypress run");

    const written = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    assert.equal(written.metadata.framework, "cypress");
    assert.equal(written.metadata.projectId, TARGOMO_PROJECT_PROFILE.id);
    assert.equal(written.testResults.totals.tests, 1);
    assert.equal(written.testResults.totals.passed, 1);
  } finally {
    cleanOwnedReportPaths();
  }
});

test("cypressAdapter re-export sanity: the generic core default adapter used by run() is the real one", () => {
  assert.equal(cypressAdapter.id, "cypress");
});
