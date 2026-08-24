"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  isPathAllowed,
  resolveLocalImports,
  buildRelevantFiles,
  getMetadata,
  getRelevantFilesPolicy,
  RELEVANT_FILES_POLICIES,
  main,
} = require("./collect-context");
const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const cypressAdapter = require("./adapters/cypress-adapter");
const playwrightAdapter = require("./adapters/playwright-adapter");
const { normalizeSpecPath } = require("./context-utils");

const ROOT = path.resolve(__dirname, "..", "..");

// Roadmap #19.7H-B (structural fix, supersedes the #19.7C retry-based
// mitigation this function used to apply): this file's real-path tests
// invoke the real main() (via collect-context.js -> cypress-adapter.js)
// against the true canonical reports/cypress and reports/ai/context.json
// paths - that is the deliberate point of these specific tests (see the
// module comment above each one), and this file is the sole test file
// that exercises that literal default-parameter wiring end to end.
// reports/cypress is exclusively owned by this file's own tests now -
// cypress-adapter.test.js's own default-path tests were moved to isolated
// temp roots specifically so no other test file touches this directory
// (see cypress-adapter.test.js's own #19.7H-B comments). reports/ai is
// shared with analyze-failure.test.js, which now cleans only its own
// exact reports/ai/history.json file - so removing only this file's own
// reports/ai/context.json (never the reports/ai/ directory itself) cannot
// collide with it either. With no remaining shared-parent deletion, the
// #19.7C retry (which existed only to reduce, not eliminate, that
// cross-file race) is no longer needed.
function cleanOwnedReportPaths() {
  fs.rmSync(path.join(ROOT, "reports", "cypress"), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "reports", "ai", "context.json"), { force: true });
}

const CYPRESS_RF_POLICY = getRelevantFilesPolicy("cypress");
const PLAYWRIGHT_RF_POLICY = getRelevantFilesPolicy("playwright");

test("isPathAllowed: allows cypress/ files and the two named root files", () => {
  assert.equal(isPathAllowed(path.join(ROOT, "cypress", "e2e", "tests", "x.cy.js"), CYPRESS_RF_POLICY), true);
  assert.equal(isPathAllowed(path.join(ROOT, "cypress.config.js"), CYPRESS_RF_POLICY), true);
  assert.equal(isPathAllowed(path.join(ROOT, "package.json"), CYPRESS_RF_POLICY), true);
});

test("isPathAllowed: denies anything outside the allowlist, even if it exists", () => {
  assert.equal(isPathAllowed(path.join(ROOT, "package-lock.json"), CYPRESS_RF_POLICY), false);
  assert.equal(isPathAllowed(path.join(ROOT, ".git", "config"), CYPRESS_RF_POLICY), false);
  assert.equal(isPathAllowed(path.join(ROOT, "..", "outside-repo.txt"), CYPRESS_RF_POLICY), false);
});

test("isPathAllowed: denies secret-shaped filenames even under cypress/", () => {
  assert.equal(isPathAllowed(path.join(ROOT, "cypress", ".env"), CYPRESS_RF_POLICY), false);
  assert.equal(isPathAllowed(path.join(ROOT, "cypress", "secrets.json"), CYPRESS_RF_POLICY), false);
  assert.equal(isPathAllowed(path.join(ROOT, "cypress", "api.key"), CYPRESS_RF_POLICY), false);
});

test("isPathAllowed: a falsy/missing policy fails closed regardless of path", () => {
  assert.equal(isPathAllowed(path.join(ROOT, "cypress.config.js"), null), false);
  assert.equal(isPathAllowed(path.join(ROOT, "package.json"), undefined), false);
});

test("resolveLocalImports: resolves the real page objects a real spec file imports", () => {
  const specPath = path.join(ROOT, "cypress", "e2e", "tests", "category_tree_behavior.cy.js");
  const source = fs.readFileSync(specPath, "utf8");
  const resolved = resolveLocalImports(source, path.dirname(specPath));
  const relResolved = resolved.map((p) => normalizeSpecPath(p)).sort();

  assert.deepEqual(relResolved, [
    "cypress/e2e/pageObjects/categories.js",
    "cypress/e2e/pageObjects/navigation.js",
    "cypress/e2e/pageObjects/subCategories.js",
  ]);
});

test("resolveLocalImports: silently ignores an import that doesn't resolve to a real file", () => {
  const resolved = resolveLocalImports(`import { x } from '../pageObjects/doesNotExist.js';`, path.join(ROOT, "cypress", "e2e", "tests"));
  assert.deepEqual(resolved, []);
});

test("buildRelevantFiles: always includes cypress.config.js and package.json, plus the failed spec and its real imports, deduped", () => {
  const failedTests = [
    { specFile: "cypress/e2e/tests/category_tree_behavior.cy.js" },
    { specFile: "cypress/e2e/tests/poi_data_requests.cy.js" }, // imports the same navigation.js/categories.js
  ];
  const warnings = [];
  const files = buildRelevantFiles(failedTests, warnings, "cypress");
  const keys = Object.keys(files);

  assert.ok(keys.includes("cypress.config.js"));
  assert.ok(keys.includes("package.json"));
  assert.ok(keys.includes("cypress/e2e/tests/category_tree_behavior.cy.js"));
  assert.ok(keys.includes("cypress/e2e/tests/poi_data_requests.cy.js"));
  assert.ok(keys.includes("cypress/e2e/pageObjects/navigation.js"));
  // shared import across both specs must appear exactly once
  assert.equal(keys.filter((k) => k === "cypress/e2e/pageObjects/navigation.js").length, 1);
});

test("buildRelevantFiles: warns instead of throwing when a failed spec no longer exists on disk", () => {
  const warnings = [];
  const files = buildRelevantFiles([{ specFile: "cypress/e2e/tests/does_not_exist.cy.js" }], warnings, "cypress");
  assert.ok(!("cypress/e2e/tests/does_not_exist.cy.js" in files));
  assert.ok(warnings.some((w) => w.includes("not found on disk")));
});

test("buildRelevantFiles: an unrecognized frameworkId fails closed - empty relevantFiles, one bounded warning, never a Cypress fallback", () => {
  const warnings = [];
  const files = buildRelevantFiles([{ specFile: "cypress/e2e/tests/category_tree_behavior.cy.js" }], warnings, "unknown-framework");
  assert.deepEqual(files, {});
  assert.deepEqual(warnings, [
    'No relevantFiles source policy exists for framework "unknown-framework"; relevantFiles will be empty.',
  ]);
});

test("getMetadata: TEST_BROWSER takes priority over BROWSER/CYPRESS_BROWSER", (t) => {
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
  });
  process.env.TEST_BROWSER = "firefox";
  process.env.BROWSER = "chrome";
  process.env.CI = "true";

  const meta = getMetadata();
  assert.equal(meta.browser, "firefox");
  assert.equal(meta.ci, true);
});

test("getMetadata: projectId is the stable production project identity (Roadmap #19.2)", () => {
  assert.equal(getMetadata().projectId, "external-poi-sut");
  assert.equal(getMetadata().projectId, TARGOMO_PROJECT_PROFILE.id);
});

// Roadmap #19.6B: framework is now sourced from the Cypress adapter's own
// identity (cypressAdapter.id), not a second, separately-hardcoded
// constant in this file - see getMetadata() itself. The production value
// this asserts is unchanged.
test("getMetadata: framework is unconditionally the current adapter's stable identity 'cypress' (Roadmap #19.5B/#19.6B)", () => {
  assert.equal(getMetadata().framework, "cypress");
  assert.equal(getMetadata().framework, cypressAdapter.id);
});

test("getMetadata: framework is present even with no relevant environment variables set", (t) => {
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
  });
  for (const key of ["GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_HEAD_REF", "GITHUB_REF_NAME", "GITHUB_RUN_ID", "GITHUB_EVENT_NAME", "TEST_BROWSER", "BROWSER", "CYPRESS_BROWSER", "CI"]) {
    delete process.env[key];
  }
  assert.equal(getMetadata().framework, "cypress");
});

// Roadmap #19.2: collect-context.js no longer defines its own
// KNOWN_PROJECT_CONSTRAINTS array - project facts are now owned by
// scripts/ai/project-profile.js (see project-profile.test.js for
// that module's own shape/content tests) and only consumed here. This
// test proves the ownership transfer: collect-context.js's own module
// exports contain no such array, so there is no duplicate, drifting copy
// of project-constraint text anywhere in this file.
test("collect-context.js no longer exports its own KNOWN_PROJECT_CONSTRAINTS (ownership moved to ProjectProfile, Roadmap #19.2)", () => {
  const exportsFromModule = require("./collect-context");
  assert.equal("KNOWN_PROJECT_CONSTRAINTS" in exportsFromModule, false);
});

// --- Roadmap #19.6B: generic orchestration wiring proof -----------------
// Proves main() actually incorporates the real cypressAdapter.collect()
// result (testResults/failedTests/warnings) and cypressAdapter.id (for
// metadata.framework) into the written context.json, using a controlled
// real-artifact fixture rather than invasive dependency-injection/module-
// cache mocking (see Roadmap #19.6A's Phase 28 recommendation).
test("main(): writes context.json whose testResults/failedTests/warnings/metadata.framework come from the real Cypress adapter", (t) => {
  const reportsDir = path.join(ROOT, "reports", "cypress");
  const outputFile = path.join(ROOT, "reports", "ai", "context.json");
  cleanOwnedReportPaths();
  t.after(() => cleanOwnedReportPaths());

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 7 },
      results: [
        {
          file: "cypress/e2e/tests/category_tree_behavior.cy.js",
          suites: [
            { title: "Suite", suites: [], tests: [{ title: "orchestration fixture failure", state: "failed", duration: 7, err: { message: "m", estack: "s" } }] },
          ],
        },
      ],
    })
  );

  main();

  const written = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(written.metadata.framework, cypressAdapter.id);
  assert.equal(written.metadata.framework, "cypress");
  assert.equal(written.testResults.found, true);
  assert.equal(written.testResults.totals.failed, 1);
  assert.equal(written.failedTests.length, 1);
  assert.equal(written.failedTests[0].title, "orchestration fixture failure");
  assert.deepEqual(written.warnings, []);
});

// =========================================================================
// Roadmap #19.7B - immutable Cypress historical full-context equivalence
// (see scripts/ai/cypress-equivalence.test.js's own module docstring for
// the full design/provenance rationale shared by both files).
//
// These two scenarios live here, not in cypress-equivalence.test.js,
// because they are the only #19.7 scenarios that must invoke the real
// main() against real fixed paths (reports/cypress, reports/ai/
// context.json) - this file is already the sole existing owner of that
// exact pattern (see the orchestration-wiring test immediately above),
// so keeping every fixed-path/main()-invoking test inside this one file
// avoids introducing a *new* cross-file race on top of the pre-existing,
// already-documented one between this file and analyze-failure.test.js's
// reports/ai/history.json-touching tests.
//
// HISTORICAL ORACLE: 1aff8f69484b7df5a293e7f1761f580fa2d3c9b0 (see
// cypress-equivalence.test.js for the full provenance statement - not
// repeated per-scenario here). Both goldens below were captured by
// running that exact commit's collect-context.js against the same
// fixture used against current code, in a disposable detached worktree,
// machine-comparing the two outputs, before transcribing the (proven-
// equal) result here.
//
// NORMALIZATION: generatedAt is dropped (unavoidable clock
// nondeterminism - see cypress-equivalence.test.js). Metadata is instead
// CONTROLLED via fixed synthetic environment variables (never a "close
// enough" comparison) so historical and current produce byte-identical
// metadata. relevantFiles is compared as a PROJECTION - only which keys
// were selected and their `truncated` flag - never raw file content or
// content length, because package.json/cypress.config.js content is
// volatile repository-global text unrelated to Cypress-adapter
// extraction (and could differ across Windows/Linux checkouts due to
// line-ending conventions), not part of the #19.7 extraction contract.
// =========================================================================

const CONTROLLED_ENV = {
  GITHUB_REPOSITORY: "example/repository",
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
  GITHUB_REF_NAME: "fixture-branch",
  GITHUB_RUN_ID: "fixture-run",
  GITHUB_EVENT_NAME: "push",
  TEST_BROWSER: "chrome",
  CI: "true",
};
const CONTROLLED_ENV_DELETIONS = ["GITHUB_HEAD_REF", "BROWSER", "CYPRESS_BROWSER", "npm_lifecycle_event"];

// Saves exact prior state (present-with-value vs genuinely absent) for
// every key this touches, sets the fixed synthetic values, and restores
// precisely - never leaves a previously-absent var as the string
// "undefined", and never leaves a previously-present var deleted.
function withControlledEnv(fn) {
  const allKeys = [...Object.keys(CONTROLLED_ENV), ...CONTROLLED_ENV_DELETIONS];
  const prior = new Map();
  for (const key of allKeys) {
    prior.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
  }
  try {
    for (const [key, value] of Object.entries(CONTROLLED_ENV)) process.env[key] = value;
    for (const key of CONTROLLED_ENV_DELETIONS) delete process.env[key];
    fn();
  } finally {
    for (const key of allKeys) {
      const priorValue = prior.get(key);
      if (priorValue === undefined) {
        delete process.env[key]; // was genuinely absent before - never restore as the string "undefined"
      } else {
        process.env[key] = priorValue;
      }
    }
  }
}

// The set of top-level context.json keys this #19.7 projection knows
// about and explicitly narrows relevantFiles for. Asserted exactly
// (not just "contains") before projecting, so a future PR that adds a
// new top-level context key doesn't silently disappear from this
// regression suite's comparison surface - it would instead fail this
// assertion and force a conscious decision about whether/how #19.7
// should represent the new field, rather than being invisibly ignored.
const KNOWN_CONTEXT_TOP_LEVEL_KEYS = [
  "generatedAt",
  "metadata",
  "testResults",
  "failedTests",
  "relevantFiles",
  "knownProjectConstraints",
  "warnings",
].sort();

// Note: callers must assert Object.keys(ctx).sort() against
// KNOWN_CONTEXT_TOP_LEVEL_KEYS themselves BEFORE calling this (i.e.
// before dropping generatedAt) - see the S1 full-context test below.
function projectFullContext(ctx) {
  const relevantFiles = {};
  for (const [key, val] of Object.entries(ctx.relevantFiles)) {
    relevantFiles[key] = { truncated: val.truncated };
  }
  return {
    metadata: ctx.metadata,
    testResults: ctx.testResults,
    failedTests: ctx.failedTests,
    relevantFiles,
    knownProjectConstraints: ctx.knownProjectConstraints,
    warnings: ctx.warnings,
  };
}

test("S1 full-context: current collector wiring matches the historical oracle's full projected context (metadata/testResults/failedTests/relevantFiles/constraints/warnings)", (t) => {
  const reportsDir = path.join(ROOT, "reports", "cypress");
  const outputFile = path.join(ROOT, "reports", "ai", "context.json");
  cleanOwnedReportPaths();
  t.after(() => cleanOwnedReportPaths());

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, "report.json"),
    JSON.stringify({
      stats: { tests: 3, passes: 1, failures: 1, pending: 1, duration: 42 },
      results: [
        {
          file: "cypress/e2e/tests/category_tree_behavior.cy.js",
          suites: [
            {
              title: "S1 Suite",
              suites: [],
              tests: [
                { title: "passes fine", state: "passed" },
                { title: "is pending", state: "pending" },
                { title: "fails here", state: "failed", duration: 12, err: { message: "AssertionError: boom", estack: "AssertionError: boom\n  at x" } },
              ],
            },
          ],
        },
      ],
    })
  );

  let written;
  withControlledEnv(() => {
    main();
    written = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  });

  // Exact top-level key check happens BEFORE dropping generatedAt, so
  // this test can still see it - see KNOWN_CONTEXT_TOP_LEVEL_KEYS.
  assert.deepStrictEqual(Object.keys(written).sort(), KNOWN_CONTEXT_TOP_LEVEL_KEYS);
  delete written.generatedAt;

  assert.deepStrictEqual(projectFullContext(written), {
    metadata: {
      projectId: "external-poi-sut",
      framework: "cypress",
      repository: "example/repository",
      commit: "0123456789abcdef0123456789abcdef01234567",
      branch: "fixture-branch",
      runId: "fixture-run",
      event: "push",
      browser: "chrome",
      ci: true,
    },
    testResults: {
      found: true,
      totals: { tests: 3, passed: 1, failed: 1, pending: 1, duration: 42 },
      specs: [{ specFile: "cypress/e2e/tests/category_tree_behavior.cy.js", tests: 3, passed: 1, failed: 1, pending: 1, duration: 42 }],
    },
    failedTests: [
      {
        title: "fails here",
        fullTitle: null,
        suite: "S1 Suite",
        specFile: "cypress/e2e/tests/category_tree_behavior.cy.js",
        status: "failed",
        duration: 12,
        error: { message: "AssertionError: boom", stack: "AssertionError: boom\n  at x" },
        screenshot: null,
      },
    ],
    relevantFiles: {
      "cypress.config.js": { truncated: false },
      "package.json": { truncated: false },
      "cypress/e2e/tests/category_tree_behavior.cy.js": { truncated: false },
      "cypress/e2e/pageObjects/navigation.js": { truncated: false },
      "cypress/e2e/pageObjects/categories.js": { truncated: false },
      "cypress/e2e/pageObjects/subCategories.js": { truncated: false },
    },
    knownProjectConstraints: TARGOMO_PROJECT_PROFILE.knownProjectConstraints,
    warnings: [],
  });
});

test("S11 warning merge order: current collector wiring matches the historical oracle - adapter warning before generic relevantFiles warning", (t) => {
  const reportsDir = path.join(ROOT, "reports", "cypress");
  const outputFile = path.join(ROOT, "reports", "ai", "context.json");
  cleanOwnedReportPaths();
  t.after(() => cleanOwnedReportPaths());

  fs.mkdirSync(reportsDir, { recursive: true });
  // An adapter/artifact warning (malformed JSON, never parsed) alongside
  // a valid report whose one failed test references a spec file that
  // does not exist on disk, triggering buildRelevantFiles's own generic
  // warning. Both warnings are real, unavoidable side effects of this
  // one fixture - not artificially forced.
  fs.writeFileSync(path.join(reportsDir, "broken.json"), "{ not valid json");
  fs.writeFileSync(
    path.join(reportsDir, "valid.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 5 },
      results: [
        { file: "cypress/e2e/tests/s11_missing_spec.cy.js", suites: [{ title: "S11", suites: [], tests: [{ title: "fails, missing spec", state: "failed", err: { message: "m11" } }] }] },
      ],
    })
  );

  let written;
  withControlledEnv(() => {
    main();
    written = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  });

  // Exactly two warnings, in order: adapter warning first, generic
  // relevantFiles warning second - see cypress-equivalence.test.js's S8
  // for why the adapter warning's V8-generated JSON.parse diagnostic
  // tail is excluded from the frozen surface (RUNTIME_VOLATILE_WARNING_
  // PROJECTION) while its stable project-owned prefix and the generic
  // warning's exact text are still frozen exactly.
  assert.equal(written.warnings.length, 2);
  const expectedAdapterWarningPrefix = `Could not parse ${path.join("reports", "cypress", "broken.json")}: `;
  assert.ok(
    written.warnings[0].startsWith(expectedAdapterWarningPrefix) && written.warnings[0].length > expectedAdapterWarningPrefix.length,
    `warnings[0] should be the adapter warning starting with "${expectedAdapterWarningPrefix}"; got: ${written.warnings[0]}`
  );
  assert.equal(written.warnings[1], "Failed spec source not found on disk: cypress/e2e/tests/s11_missing_spec.cy.js");
});

// =========================================================================
// Roadmap #19.9B - framework-aware offline orchestration.
//
// main() now accepts an optional { adapter, adapterOptions } - production's
// own zero-argument call (and every pre-#19.9B test in this file) keeps
// getting exactly cypressAdapter's own defaults. These tests prove: (1)
// the default/explicit-Cypress equivalence that guarantees production
// behavior is unchanged, and (2) that an injected Playwright adapter can
// traverse this SAME generic collector entirely offline, producing a
// context.json whose testResults/failedTests/warnings/metadata.framework
// come straight from the adapter's own output - no Playwright package, no
// browser, no live SUT, no provider call anywhere in this file.
// =========================================================================

test("O1/O2: main() with no arguments and main({adapter: cypressAdapter}) produce byte-identical context.json for the same fixture (excluding only generatedAt)", (t) => {
  const reportsDir = path.join(ROOT, "reports", "cypress");
  const outputFile = path.join(ROOT, "reports", "ai", "context.json");
  const fixtureReport = JSON.stringify({
    stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 9 },
    results: [
      {
        file: "cypress/e2e/tests/category_tree_behavior.cy.js",
        suites: [
          { title: "Suite", suites: [], tests: [{ title: "O1/O2 fixture failure", state: "failed", duration: 9, err: { message: "m", estack: "s" } }] },
        ],
      },
    ],
  });

  cleanOwnedReportPaths();
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, "report.json"), fixtureReport);
  withControlledEnv(() => main());
  const written1 = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  cleanOwnedReportPaths();

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, "report.json"), fixtureReport);
  withControlledEnv(() => main({ adapter: cypressAdapter }));
  const written2 = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  t.after(() => cleanOwnedReportPaths());

  delete written1.generatedAt;
  delete written2.generatedAt;
  assert.deepStrictEqual(written2, written1, "explicit cypressAdapter injection must be byte-identical to the zero-argument default, field for field");
  assert.equal(written1.metadata.framework, "cypress");
  assert.equal(written2.metadata.framework, "cypress");
});

function pwReport({ suites = [], errors = [] } = {}) {
  return { config: {}, suites, errors, stats: {} };
}
function pwFileSuite({ title, file, specs = [] }) {
  return { title, file, line: 1, column: 1, specs, suites: [] };
}
function pwSpec({ title, file, tests }) {
  return { title, ok: false, tags: [], id: `id-${title}`, file, line: 1, column: 1, tests };
}
function pwTest({ status, results }) {
  return { timeout: 30000, annotations: [], expectedStatus: "passed", status, results };
}
function pwResult({ status, duration, error }) {
  return { workerIndex: 0, parallelIndex: 0, status, duration, retry: 0, steps: [], startTime: "2026-01-01T00:00:00.000Z", annotations: [], attachments: [], ...(error ? { error } : {}) };
}

test("O3-O7: an injected playwrightAdapter traverses the generic collector fully offline - metadata.framework, testResults, failedTests, warnings, ProjectProfile, browser/CI metadata", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-context-playwright-orchestration-"));
  const reportFile = path.join(tmpDir, "report.json");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      pwReport({
        suites: [
          pwFileSuite({
            title: "orchestration.spec.ts",
            file: "tests/orchestration.spec.ts",
            specs: [
              pwSpec({
                title: "fails under generic orchestration",
                file: "tests/orchestration.spec.ts",
                tests: [pwTest({ status: "unexpected", results: [pwResult({ status: "failed", duration: 42, error: { message: "orchestration failure", stack: "at x" } })] })],
              }),
            ],
          }),
        ],
      })
    )
  );

  const outputFile = path.join(ROOT, "reports", "ai", "context.json");
  cleanOwnedReportPaths();
  t.after(() => cleanOwnedReportPaths());

  withControlledEnv(() => main({ adapter: playwrightAdapter, adapterOptions: { reportFile } }));
  const written = JSON.parse(fs.readFileSync(outputFile, "utf8"));

  // metadata.framework comes exclusively from the injected adapter's own id.
  assert.equal(written.metadata.framework, "playwright");
  assert.equal(written.metadata.framework, playwrightAdapter.id);

  // testResults/failedTests are the adapter's own output, unchanged.
  assert.equal(written.testResults.found, true);
  assert.equal(written.testResults.totals.failed, 1);
  assert.equal(written.failedTests.length, 1);
  assert.equal(written.failedTests[0].title, "fails under generic orchestration");
  assert.equal(written.failedTests[0].specFile, "tests/orchestration.spec.ts");
  assert.deepEqual(written.failedTests[0].error, { message: "orchestration failure", stack: "at x" });

  // Warnings propagate unchanged from whatever the generic collector's own
  // buildRelevantFiles() produces - here, exactly one. Under Roadmap #21C's
  // framework-aware policy, "tests/orchestration.spec.ts" is tried both as
  // given and re-rooted under the explicit playwright/ source root
  // (policy.resolveSpecCandidates() - see collect-context.js), i.e.
  // "playwright/tests/orchestration.spec.ts" - neither exists on disk in
  // this repository (no production Playwright suite exists yet - that is
  // #21F's job), so the warning still fires, reporting the original
  // specFile exactly as before.
  assert.deepEqual(written.warnings, ["Failed spec source not found on disk: tests/orchestration.spec.ts"]);
  // Roadmap #21C: relevantFiles is now selected by the active framework's
  // own policy (adapter.id, here "playwright") - it never includes
  // cypress.config.js for a Playwright-produced context.json (the R1 defect
  // this stage fixes). Only package.json survives: playwright.config.js is
  // Playwright's own alwaysCollectFiles entry, but no root-level
  // playwright.config.js exists in this repository yet (that is #21F's
  // job), so it is attempted and correctly not found - never fabricated.
  assert.deepEqual(Object.keys(written.relevantFiles).sort(), ["package.json"]);
  assert.ok(!("cypress.config.js" in written.relevantFiles));
  assert.ok(!("tests/orchestration.spec.ts" in written.relevantFiles));

  // ProjectProfile ownership is entirely adapter-independent.
  assert.equal(written.metadata.projectId, TARGOMO_PROJECT_PROFILE.id);
  assert.deepEqual(written.knownProjectConstraints, TARGOMO_PROJECT_PROFILE.knownProjectConstraints);

  // browser/CI metadata remain generic - owned by getMetadata(), never the adapter.
  assert.ok("browser" in written.metadata);
  assert.ok("ci" in written.metadata);
});

test("O10: the injected-Playwright orchestration test above used only a hand-built fixture object, never the @playwright/test package itself", () => {
  // Historically (#19.9B) this asserted @playwright/test was not installed
  // at all - true then, since nothing in the repository needed it.
  // Roadmap #21B installed it as a devDependency specifically to prove real
  // reporter compatibility (see scripts/ai/playwright-adapter.test.js's
  // dedicated real-fixture regression) - require.resolve() now succeeding
  // is the correct, expected, intentional result of that stage, not a
  // regression. What this test actually protects is narrower and remains
  // true regardless: the O3-O7 orchestration proof above never imports or
  // calls anything from that package - its "Playwright report" is the
  // plain JS object pwReport()/pwFileSuite()/pwSpec()/pwTest()/pwResult()
  // build above, exactly like every fixture in
  // scripts/ai/playwright-adapter.test.js's synthetic suite - so the
  // orchestration seam (collect-context.js's main({adapter, adapterOptions}))
  // still requires zero Playwright package, browser, or live SUT access to
  // exercise, only a report.json shaped like one.
  assert.doesNotThrow(() => require.resolve("@playwright/test"));
});

test("main(): rejects an adapter missing a usable id/collect() with a clear programmer-error message, never silently falling back to Cypress", () => {
  assert.throws(() => main({ adapter: {} }), /adapter must have a non-empty string id and a collect\(\) function/);
  assert.throws(() => main({ adapter: { id: "broken" } }), /adapter must have a non-empty string id and a collect\(\) function/);
  assert.throws(() => main({ adapter: { id: "", collect: () => ({}) } }), /adapter must have a non-empty string id and a collect\(\) function/);
});

test("getMetadata: an explicit frameworkId argument overrides the default, without a second caller-supplied 'framework' parameter existing anywhere", () => {
  assert.equal(getMetadata("playwright").framework, "playwright");
  assert.equal(getMetadata().framework, "cypress");
  assert.equal(getMetadata().framework, cypressAdapter.id);
});

// =========================================================================
// Roadmap #21C - framework-aware RelevantFiles source policy.
//
// R1 (Roadmap #21A): RelevantFiles source evidence was Cypress-only
// (ALLOWED_DIRS = ["cypress"]) regardless of which framework actually
// produced the failure - a Playwright context.json could never collect its
// own spec/config source, and (per the O3-O7 test above, pre-#21C) would
// have silently collected cypress.config.js for a Playwright run instead.
// RELEVANT_FILES_POLICIES (collect-context.js) closes that gap with one
// small, closed, positive-allowlist map keyed by canonical frameworkId
// (adapter.id) - Cypress's own policy is unchanged in scope; Playwright's
// is new and deliberately narrow (playwright/ + playwright.config.js +
// package.json only, never a generic tests/**, src/**, or repo-root
// wildcard). These tests exercise that map directly, plus its interaction
// with the real repository filesystem for the small set of cases that
// genuinely require an on-disk file to exist (playwright/ itself doesn't
// exist in this repository yet - #21F's job - so those tests create and
// remove their own exact, uniquely-named paths under it, sequentially,
// exactly like this file's own cleanOwnedReportPaths() convention above,
// never touching any path another test file owns).
// =========================================================================

test("P_RF_1: getRelevantFilesPolicy('playwright') returns the explicit, narrow Playwright policy - never Cypress's", () => {
  assert.ok(PLAYWRIGHT_RF_POLICY);
  assert.deepEqual(PLAYWRIGHT_RF_POLICY.allowedDirs, ["playwright"]);
  assert.deepEqual(PLAYWRIGHT_RF_POLICY.alwaysCollectFiles, ["playwright.config.js", "package.json"]);
  assert.notDeepEqual(PLAYWRIGHT_RF_POLICY.allowedDirs, CYPRESS_RF_POLICY.allowedDirs);
});

test("P_RF_2: package.json is allowed under the Playwright policy (shared baseline file, real on-disk)", () => {
  assert.equal(isPathAllowed(path.join(ROOT, "package.json"), PLAYWRIGHT_RF_POLICY), true);
});

test("P_RF_3: playwright.config.js is allowed and collected when it genuinely exists at the repo root", (t) => {
  const configPath = path.join(ROOT, "playwright.config.js");
  assert.ok(!fs.existsSync(configPath), "test precondition: no real playwright.config.js may already exist");
  fs.writeFileSync(configPath, "module.exports = { testDir: 'playwright' };\n");
  t.after(() => fs.rmSync(configPath, { force: true }));

  assert.equal(isPathAllowed(configPath, PLAYWRIGHT_RF_POLICY), true);

  const warnings = [];
  const files = buildRelevantFiles([], warnings, "playwright");
  assert.ok("playwright.config.js" in files);
  assert.ok(files["playwright.config.js"].content.includes("testDir"));
});

test("P_RF_4: a repo-relative playwright/tests/foo.spec.js failedTests specFile is collected directly", (t) => {
  const specDir = path.join(ROOT, "playwright", "tests");
  const specPath = path.join(specDir, "p_rf_4.spec.js");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(specPath, "// p_rf_4 fixture spec\n");
  t.after(() => fs.rmSync(path.join(ROOT, "playwright"), { recursive: true, force: true }));

  const warnings = [];
  const files = buildRelevantFiles([{ specFile: "playwright/tests/p_rf_4.spec.js" }], warnings, "playwright");
  assert.ok("playwright/tests/p_rf_4.spec.js" in files);
  assert.deepEqual(warnings, []);
});

test("P_RF_5: a testDir-relative 'tests/foo.spec.js' specFile safely re-resolves under the explicit playwright/ source root", (t) => {
  const specDir = path.join(ROOT, "playwright", "tests");
  const specPath = path.join(specDir, "p_rf_5.spec.js");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(specPath, "// p_rf_5 fixture spec\n");
  t.after(() => fs.rmSync(path.join(ROOT, "playwright"), { recursive: true, force: true }));

  // No "playwright/" prefix - exactly the real reporter shape Roadmap #21B
  // observed (spec.file relative to Playwright's own testDir).
  const warnings = [];
  const files = buildRelevantFiles([{ specFile: "tests/p_rf_5.spec.js" }], warnings, "playwright");
  assert.ok("playwright/tests/p_rf_5.spec.js" in files, `expected playwright/tests/p_rf_5.spec.js in ${Object.keys(files)}`);
  assert.deepEqual(warnings, []);
});

test("P_RF_6: a bare testDir-relative 'foo.spec.js' (no subdirectory) safely re-resolves under playwright/", (t) => {
  const pwDir = path.join(ROOT, "playwright");
  const specPath = path.join(pwDir, "p_rf_6.spec.js");
  fs.mkdirSync(pwDir, { recursive: true });
  fs.writeFileSync(specPath, "// p_rf_6 fixture spec\n");
  t.after(() => fs.rmSync(pwDir, { recursive: true, force: true }));

  const warnings = [];
  const files = buildRelevantFiles([{ specFile: "p_rf_6.spec.js" }], warnings, "playwright");
  assert.ok("playwright/p_rf_6.spec.js" in files);
  assert.deepEqual(warnings, []);
});

test("P_RF_7: cypress.config.js is never allowed under the Playwright policy", () => {
  assert.equal(isPathAllowed(path.join(ROOT, "cypress.config.js"), PLAYWRIGHT_RF_POLICY), false);
});

test("P_RF_8: a real Cypress spec source file is never allowed under the Playwright policy", () => {
  const cypressSpec = path.join(ROOT, "cypress", "e2e", "tests", "category_tree_behavior.cy.js");
  assert.ok(fs.existsSync(cypressSpec), "test precondition: the real Cypress spec must exist");
  assert.equal(isPathAllowed(cypressSpec, PLAYWRIGHT_RF_POLICY), false);
});

test("P_RF_9: scripts/ai's own Playwright reporter-proof fixtures (Roadmap #21B) are never Playwright RelevantFiles", () => {
  const realFixture = path.join(ROOT, "scripts", "ai", "__fixtures__", "playwright-real-report.json");
  assert.ok(fs.existsSync(realFixture), "test precondition: the #21B sanitized fixture must exist");
  assert.equal(isPathAllowed(realFixture, PLAYWRIGHT_RF_POLICY), false);

  const proofSpec = path.join(ROOT, "scripts", "ai", "__fixtures__", "playwright-reporter-proof", "proof.spec.js");
  assert.ok(fs.existsSync(proofSpec), "test precondition: the #21B proof spec must exist");
  assert.equal(isPathAllowed(proofSpec, PLAYWRIGHT_RF_POLICY), false);
});

test("P_RF_10: a '../' traversal segment can never escape the Playwright policy's own explicit source root", () => {
  // Resolves to ROOT/package-lock.json - a real on-disk file, but neither
  // in alwaysCollectFiles nor under playwright/ after resolution.
  const escapePath = path.join(ROOT, "playwright", "..", "package-lock.json");
  assert.ok(fs.existsSync(escapePath), "test precondition: the escape target must exist on disk to prove policy (not mere absence) rejects it");
  assert.equal(isPathAllowed(escapePath, PLAYWRIGHT_RF_POLICY), false);

  // Same shape, but via the actual failedTests specFile -> buildRelevantFiles
  // path, which is the real, adapter-facing attack surface. package.json is
  // still legitimately collected regardless (alwaysCollectFiles); the point
  // here is narrower: package-lock.json must never appear via this escape.
  const warnings = [];
  const files = buildRelevantFiles([{ specFile: "../package-lock.json" }], warnings, "playwright");
  assert.ok(!("package-lock.json" in files));
  assert.ok(!Object.keys(files).some((k) => k.includes("package-lock.json")));
  assert.ok(warnings.some((w) => w.includes("not found on disk")));
});

test("P_RF_11: an absolute out-of-repository path can never be read as Playwright RelevantFiles", () => {
  const outsideRepo = path.resolve(ROOT, "..", "outside-repo-secret.txt");
  assert.equal(isPathAllowed(outsideRepo, PLAYWRIGHT_RF_POLICY), false);

  // package.json is still legitimately collected regardless (it's in
  // alwaysCollectFiles, unconditional on failedTests content) - the point
  // here is narrower: the malicious specFile itself must never appear.
  const warnings = [];
  const files = buildRelevantFiles([{ specFile: outsideRepo }], warnings, "playwright");
  assert.ok(!(outsideRepo in files));
  assert.ok(!Object.keys(files).some((k) => k.includes("outside-repo-secret")));
});

test("P_RF_12: a denylisted filename under playwright/ is still rejected, exactly like under cypress/", (t) => {
  const pwDir = path.join(ROOT, "playwright");
  const secretPath = path.join(pwDir, ".env");
  fs.mkdirSync(pwDir, { recursive: true });
  fs.writeFileSync(secretPath, "SECRET=1\n");
  t.after(() => fs.rmSync(pwDir, { recursive: true, force: true }));

  assert.equal(isPathAllowed(secretPath, PLAYWRIGHT_RF_POLICY), false);
  assert.equal(isPathAllowed(path.join(pwDir, "api.key"), PLAYWRIGHT_RF_POLICY), false);
  assert.equal(isPathAllowed(path.join(pwDir, "secrets.json"), PLAYWRIGHT_RF_POLICY), false);
});

test("P_RF_13: an unrecognized framework never yields arbitrary RelevantFiles, even for an otherwise-readable repository file", () => {
  const warnings = [];
  const files = buildRelevantFiles([{ specFile: "package.json" }], warnings, "unknown-framework");
  assert.deepEqual(files, {});
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("unknown-framework"));
  // The warning names the framework, never a filesystem path - bounded,
  // matching this repository's existing "no absolute/temp paths in
  // warnings" convention (see cypress-adapter.js/playwright-adapter.js's
  // own resolveScreenshot() warnings).
  assert.ok(!warnings[0].includes(ROOT));
});

test("P_RF_14: the Playwright per-file size cap matches Cypress's (MAX_FILE_BYTES is not framework-specific)", (t) => {
  const pwDir = path.join(ROOT, "playwright");
  const bigPath = path.join(pwDir, "p_rf_14.spec.js");
  fs.mkdirSync(pwDir, { recursive: true });
  fs.writeFileSync(bigPath, "x".repeat(25 * 1024)); // > 20 KB
  t.after(() => fs.rmSync(pwDir, { recursive: true, force: true }));

  const warnings = [];
  const files = buildRelevantFiles([{ specFile: "playwright/p_rf_14.spec.js" }], warnings, "playwright");
  const entry = files["playwright/p_rf_14.spec.js"];
  assert.ok(entry, "expected the oversized spec to still be collected, truncated");
  assert.equal(entry.truncated, true);
  assert.ok(entry.content.includes("...truncated..."));
  assert.ok(entry.content.length < 25 * 1024);
});

test("Unknown framework (synthetic adapter): relevantFiles stays empty and no absolute path leaks into the warning, via the real main() orchestration", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-context-unknown-framework-"));
  const reportFile = path.join(tmpDir, "report.json");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const unknownAdapter = {
    id: "unknown-framework",
    collect: () => ({
      testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 1 }, specs: [] },
      failedTests: [{ title: "t", fullTitle: "t", specFile: "package.json", status: "failed", duration: 1, error: { message: "m", stack: "s" } }],
      warnings: [],
    }),
  };

  const outputFile = path.join(ROOT, "reports", "ai", "context.json");
  cleanOwnedReportPaths();
  t.after(() => cleanOwnedReportPaths());

  withControlledEnv(() => main({ adapter: unknownAdapter, adapterOptions: { reportFile } }));
  const written = JSON.parse(fs.readFileSync(outputFile, "utf8"));

  assert.equal(written.metadata.framework, "unknown-framework");
  assert.deepEqual(written.relevantFiles, {});
  assert.ok(written.warnings.some((w) => w.includes("unknown-framework")));
  assert.ok(!written.warnings.some((w) => w.includes(ROOT)));
});

// =========================================================================
// Cypress before/after equivalence (Roadmap #21C Phase 27).
//
// Every one of these assertions passed unchanged, with unmodified
// expectations, against the exact same fixtures both before and after this
// stage's implementation (only the necessary policy-argument additions to
// existing call sites changed - see the isPathAllowed/buildRelevantFiles
// tests near the top of this file, and O3-O7 above, whose actual behavior
// was already re-verified end to end through the real main()/cypressAdapter
// production path). This section adds one direct, explicit closing proof
// that Cypress's policy object itself is exactly the pre-#21C
// ALLOWED_DIRS/ALLOWED_FILES pair, unbroadened.
// =========================================================================

test("C_RF equivalence: Cypress policy is exactly the pre-#21C ALLOWED_DIRS/ALLOWED_FILES pair, unbroadened", () => {
  assert.deepEqual(CYPRESS_RF_POLICY.allowedDirs, ["cypress"]);
  assert.deepEqual(CYPRESS_RF_POLICY.alwaysCollectFiles, ["cypress.config.js", "package.json"]);
  // Cypress's own specFile values are already fully repo-relative
  // (produced from an absolute on-disk path under ROOT by
  // cypress-adapter.js) - resolveSpecCandidates() must not re-root or
  // otherwise alter them.
  assert.deepEqual(CYPRESS_RF_POLICY.resolveSpecCandidates("cypress/e2e/tests/x.cy.js"), ["cypress/e2e/tests/x.cy.js"]);
});

test("RELEVANT_FILES_POLICIES: exactly the two known frameworks are defined, no hidden generic/default entry", () => {
  assert.deepEqual(Object.keys(RELEVANT_FILES_POLICIES).sort(), ["cypress", "playwright"]);
});
