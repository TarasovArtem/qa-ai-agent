"use strict";

/**
 * Roadmap FPI-3C (FrameworkRuntimeConfig historyWorkflowFile consumer
 * wiring, third slice of the FPI-3 consumer-wiring roadmap phase,
 * applying the semantics FPI-3A/FPI-3B independently established to a
 * GitHub Actions workflow filename rather than a local filesystem path):
 * adversarial/portability regression for the new, optional
 * `frameworkRuntimeConfig` input to scripts/ai/collect-history.js's
 * main() (via resolveFrameworkRuntimeConfigWorkflowFile()).
 *
 * Unlike FPI-3A/FPI-3B, this field is never routed through FPI-2's
 * filesystem containment primitives (resolveRepositoryLocalPath() /
 * resolveSafeLocalAttachmentPath() / resolveSafeRepositoryWritePath()) -
 * it is a GitHub REST API URL path segment, validated once by the shared
 * FPI-1 validator (whose isSafeWorkflowFilename() charset already
 * excludes every URL-structural character) and never touched again
 * before being interpolated into the existing fetchJson() URL template.
 *
 * This file independently proves:
 *   - no config preserves the historical "cypress.yml" default;
 *   - a valid, identity-matched config is AUTHORITATIVE for the workflow
 *     filename, not merely consulted (decoy proof against a real, fully
 *     mocked two-call GitHub API sequence: workflow-runs list + per-run
 *     jobs);
 *   - Cypress and Playwright configs can independently select distinct
 *     workflow filenames without any further generic-core change;
 *   - a structurally invalid, framework-mismatched, or project-mismatched
 *     config fails closed via this file's OWN existing writeUnavailable()
 *     degrade-gracefully convention (never an uncaught throw, and never a
 *     GitHub API call using the historical default);
 *   - traversal/slash/URL-like/query/fragment-shaped workflow filenames
 *     are rejected before any GitHub API call, at the FPI-1 validation
 *     layer;
 *   - a valid config whose named workflow simply doesn't exist remotely
 *     (404) still produces the pre-existing graceful
 *     "could not list workflow runs" unavailable marker, never treated
 *     as a configuration error.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { main, resolveFrameworkRuntimeConfigWorkflowFile, WORKFLOW_FILE } = require("./collect-history");

const PROFILE = Object.freeze({ id: "fpi3c-test-project", displayName: "FPI-3C Test Project", knownProjectConstraints: ["x"] });

function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return { dir, root: { lexicalRoot: dir, realRoot: fs.realpathSync(dir) } };
}

function validCypressConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectId: "fpi3c-test-project",
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
    projectId: "fpi3c-test-project",
    framework: "playwright",
    frameworkConfigPath: "playwright.config.js",
    testSourceRoot: "playwright",
    reports: { reportFile: "reports/playwright/report.json" },
    historyWorkflowFile: "cypress.yml",
    ...overrides,
  };
}

// A minimal, real, two-call-shape GitHub Actions API mock: the first call
// lists workflow runs for a given workflow filename (captured verbatim
// from the URL), the second lists jobs for a given run id. `workflows` is
// { [workflowFilename]: { runId, jobs: [{name, conclusion}] } } - a single
// completed run per workflow is enough to prove which workflow's data
// reached aggregateHistory().
function mockGithubApi(workflows) {
  const requestedUrls = [];
  const fn = async (url) => {
    requestedUrls.push(url);
    const runsMatch = url.match(/\/actions\/workflows\/([^/]+)\/runs/);
    if (runsMatch) {
      const wf = decodeURIComponent(runsMatch[1]);
      const entry = workflows[wf];
      if (!entry) return { ok: false, status: 404, statusText: "Not Found" };
      return { ok: true, json: async () => ({ workflow_runs: [{ id: entry.runId, run_attempt: 1 }] }) };
    }
    const jobsMatch = url.match(/\/actions\/runs\/(\d+)\/jobs/);
    if (jobsMatch) {
      const runId = Number(jobsMatch[1]);
      for (const wf of Object.keys(workflows)) {
        if (workflows[wf].runId === runId) {
          return { ok: true, json: async () => ({ jobs: workflows[wf].jobs }) };
        }
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    }
    return { ok: false, status: 404, statusText: "Not Found" };
  };
  return { fn, requestedUrls };
}

function withEnv(vars, fn) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env = saved;
    });
}

function withFetch(fetchFn, fn) {
  const original = global.fetch;
  global.fetch = fetchFn;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = original;
    });
}

function readHistory(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "reports", "ai", "history.json"), "utf8"));
}

// --- no config preserves legacy behavior ------------------------------------

test("FPI-3C: no frameworkRuntimeConfig at all requests the historical cypress.yml workflow", async () => {
  const { dir, root } = fresh("fpi3c-absence");
  const { fn, requestedUrls } = mockGithubApi({
    "cypress.yml": { runId: 1, jobs: [{ name: "Cypress - chrome", conclusion: "failure" }] },
  });

  await withFetch(fn, () =>
    withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chrome", QA_FRAMEWORK: undefined, GITHUB_RUN_ID: undefined }, () =>
      main({ profile: PROFILE, repositoryRoot: dir })
    )
  );

  assert.ok(requestedUrls.some((u) => u.includes("/actions/workflows/cypress.yml/runs")));
  const history = readHistory(dir);
  assert.equal(history.available, true);
});

test("FPI-3C: resolveFrameworkRuntimeConfigWorkflowFile(undefined, ...) returns null (Case A, never an error)", () => {
  assert.equal(resolveFrameworkRuntimeConfigWorkflowFile(undefined, "cypress", "any-project"), null);
});

// --- valid config is authoritative, proven against a legacy decoy ----------

test("FPI-3C DECOY: a valid config selecting a custom workflow is authoritative - cypress.yml decoy data is never consumed", async () => {
  const { dir, root } = fresh("fpi3c-decoy");
  const { fn, requestedUrls } = mockGithubApi({
    "cypress.yml": { runId: 1, jobs: [{ name: "Cypress - chrome", conclusion: "success" }] }, // LEGACY_HISTORY_DECOY equivalent: all-pass
    "qa-e2e.yml": { runId: 2, jobs: [{ name: "Cypress - chrome", conclusion: "failure" }] }, // CONFIG_HISTORY_SELECTED equivalent: failure
  });
  const config = validCypressConfig({ historyWorkflowFile: "qa-e2e.yml" });

  await withFetch(fn, () =>
    withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chrome", QA_FRAMEWORK: undefined, GITHUB_RUN_ID: undefined }, () =>
      main({ profile: PROFILE, repositoryRoot: dir, frameworkRuntimeConfig: config })
    )
  );

  assert.ok(requestedUrls.some((u) => u.includes("/actions/workflows/qa-e2e.yml/runs")), "must request the configured workflow");
  assert.ok(!requestedUrls.some((u) => u.includes("/actions/workflows/cypress.yml/runs")), "must never request the legacy default once a valid config was supplied");
  const history = readHistory(dir);
  assert.equal(history.failures, 1, "must reflect qa-e2e.yml's data (1 failure), never cypress.yml's (0 failures)");
});

// --- Cypress vs Playwright can select distinct workflow filenames ----------

test("FPI-3C: a Cypress config and a Playwright config can independently select distinct workflow filenames", async () => {
  {
    const { dir, root } = fresh("fpi3c-framework-cypress");
    const { fn, requestedUrls } = mockGithubApi({
      "cypress-e2e.yml": { runId: 10, jobs: [{ name: "Cypress - chrome", conclusion: "failure" }] },
    });
    const config = validCypressConfig({ historyWorkflowFile: "cypress-e2e.yml" });
    await withFetch(fn, () =>
      withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chrome", QA_FRAMEWORK: undefined, GITHUB_RUN_ID: undefined }, () =>
        main({ profile: PROFILE, repositoryRoot: dir, frameworkRuntimeConfig: config })
      )
    );
    assert.ok(requestedUrls.some((u) => u.includes("cypress-e2e.yml")));
    assert.equal(readHistory(dir).framework, "cypress");
  }
  {
    const { dir, root } = fresh("fpi3c-framework-playwright");
    const { fn, requestedUrls } = mockGithubApi({
      "playwright-e2e.yml": { runId: 20, jobs: [{ name: "Playwright Chromium", conclusion: "failure" }] },
    });
    const config = validPlaywrightConfig({ historyWorkflowFile: "playwright-e2e.yml" });
    await withFetch(fn, () =>
      withEnv(
        { GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chromium", QA_FRAMEWORK: "playwright", HISTORY_JOB_NAME: "Playwright Chromium", GITHUB_RUN_ID: undefined },
        () => main({ profile: PROFILE, repositoryRoot: dir, frameworkRuntimeConfig: config })
      )
    );
    assert.ok(requestedUrls.some((u) => u.includes("playwright-e2e.yml")));
    assert.equal(readHistory(dir).framework, "playwright");
  }
});

// --- invalid/mismatched config fails closed, never silently uses cypress.yml -

test("FPI-3C INVALID CONFIG: a structurally invalid config (missing schemaVersion) never requests cypress.yml, writes a bounded unavailable reason", async () => {
  const { dir, root } = fresh("fpi3c-invalid");
  const { fn, requestedUrls } = mockGithubApi({
    "cypress.yml": { runId: 1, jobs: [{ name: "Cypress - chrome", conclusion: "failure" }] },
  });
  const config = validCypressConfig();
  delete config.schemaVersion;

  await withFetch(fn, () =>
    withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chrome", QA_FRAMEWORK: undefined, GITHUB_RUN_ID: undefined }, () =>
      main({ profile: PROFILE, repositoryRoot: dir, frameworkRuntimeConfig: config })
    )
  );

  assert.deepEqual(requestedUrls, [], "no GitHub API call of any kind may occur");
  const history = readHistory(dir);
  assert.equal(history.available, false);
  assert.match(history.reason, /FRAMEWORK_RUNTIME_CONFIG_INVALID/);
});

test("FPI-3C FRAMEWORK MISMATCH: a Playwright config supplied to a Cypress invocation fails closed, never requests cypress.yml", async () => {
  const { dir, root } = fresh("fpi3c-framework-mismatch");
  const { fn, requestedUrls } = mockGithubApi({
    "cypress.yml": { runId: 1, jobs: [{ name: "Cypress - chrome", conclusion: "failure" }] },
  });
  const config = validPlaywrightConfig();

  await withFetch(fn, () =>
    withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chrome", QA_FRAMEWORK: undefined, GITHUB_RUN_ID: undefined }, () =>
      main({ profile: PROFILE, repositoryRoot: dir, frameworkRuntimeConfig: config })
    )
  );

  assert.deepEqual(requestedUrls, []);
  const history = readHistory(dir);
  assert.equal(history.available, false);
  assert.match(history.reason, /HISTORY_RUNTIME_CONFIG_FRAMEWORK_MISMATCH/);
});

test("FPI-3C PROJECT MISMATCH: a config for a different projectId fails closed, never requests cypress.yml", async () => {
  const { dir, root } = fresh("fpi3c-project-mismatch");
  const { fn, requestedUrls } = mockGithubApi({
    "cypress.yml": { runId: 1, jobs: [{ name: "Cypress - chrome", conclusion: "failure" }] },
  });
  const config = validCypressConfig({ projectId: "some-other-project" });

  await withFetch(fn, () =>
    withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chrome", QA_FRAMEWORK: undefined, GITHUB_RUN_ID: undefined }, () =>
      main({ profile: PROFILE, repositoryRoot: dir, frameworkRuntimeConfig: config })
    )
  );

  assert.deepEqual(requestedUrls, []);
  const history = readHistory(dir);
  assert.equal(history.available, false);
  assert.match(history.reason, /HISTORY_RUNTIME_CONFIG_PROJECT_MISMATCH/);
});

test("FPI-3C: a config supplied with no currentProjectId at all fails closed rather than skipping the identity check", () => {
  const config = validCypressConfig();
  assert.throws(
    () => resolveFrameworkRuntimeConfigWorkflowFile(config, "cypress", undefined),
    /HISTORY_RUNTIME_CONFIG_PROJECT_ID_REQUIRED/
  );
});

// --- URL / path-segment integrity: rejected before any GitHub API call -----

for (const badWorkflow of ["../outside.yml", "foo/bar.yml", "https://evil.example/workflow.yml", "workflow.yml?x=1", "workflow.yml#fragment", "not-a-workflow.txt", ""]) {
  test(`FPI-3C URL INTEGRITY: an unsafe workflow filename (${JSON.stringify(badWorkflow)}) is rejected before any GitHub API call`, async () => {
    const { dir, root } = fresh("fpi3c-url-integrity");
    const { fn, requestedUrls } = mockGithubApi({
      "cypress.yml": { runId: 1, jobs: [{ name: "Cypress - chrome", conclusion: "failure" }] },
    });
    const config = validCypressConfig({ historyWorkflowFile: badWorkflow });

    await withFetch(fn, () =>
      withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chrome", QA_FRAMEWORK: undefined, GITHUB_RUN_ID: undefined }, () =>
        main({ profile: PROFILE, repositoryRoot: dir, frameworkRuntimeConfig: config })
      )
    );

    assert.deepEqual(requestedUrls, [], "an unsafe workflow filename must never reach any GitHub API call");
    const history = readHistory(dir);
    assert.equal(history.available, false);
    assert.match(history.reason, /FRAMEWORK_RUNTIME_CONFIG_INVALID/);
  });
}

// --- valid config, workflow genuinely missing remotely: graceful, not an error -

test("FPI-3C: a valid config naming a workflow that does not exist remotely (404) preserves the existing graceful history-unavailable behavior", async () => {
  const { dir, root } = fresh("fpi3c-missing-remote");
  const { fn, requestedUrls } = mockGithubApi({
    "cypress.yml": { runId: 1, jobs: [{ name: "Cypress - chrome", conclusion: "failure" }] },
  });
  const config = validCypressConfig({ historyWorkflowFile: "does-not-exist.yml" });

  await withFetch(fn, () =>
    withEnv({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", TEST_BROWSER: "chrome", QA_FRAMEWORK: undefined, GITHUB_RUN_ID: undefined }, () =>
      main({ profile: PROFILE, repositoryRoot: dir, frameworkRuntimeConfig: config })
    )
  );

  assert.ok(requestedUrls.some((u) => u.includes("does-not-exist.yml")), "the real (valid, config-selected) workflow filename must have been requested");
  const history = readHistory(dir);
  assert.equal(history.available, false);
  assert.match(history.reason, /could not list workflow runs/, "must use the EXISTING remote-failure reason, never a configuration-error reason");
  assert.doesNotMatch(history.reason, /FRAMEWORK_RUNTIME_CONFIG|HISTORY_RUNTIME_CONFIG/, "a remote 404 must never be mislabeled as a configuration error");
});

// --- source audit: no autodiscovery, no filesystem containment reuse -------

test("FPI-3C SOURCE AUDIT: resolveFrameworkRuntimeConfigWorkflowFile() never touches the filesystem or process.cwd()", () => {
  const source = resolveFrameworkRuntimeConfigWorkflowFile.toString();
  assert.doesNotMatch(source, /fs\.\w+Sync|fs\.\w+\(/, "must be a pure shape/identity decision, never a filesystem probe");
  assert.doesNotMatch(source, /process\.cwd\(\)/, "must never derive anything from process.cwd()");
  assert.doesNotMatch(source, /resolveRepositoryLocalPath|resolveSafeLocalAttachmentPath|resolveSafeRepositoryWritePath/, "a workflow filename is a GitHub API path segment, never a local filesystem path - it must never be routed through FPI-2's filesystem containment primitives");
});

// Matches architecture-boundary.test.js's own FORBIDDEN_PATTERNS convention:
// a require() dependency on the target-owned tree is forbidden; a plain-text
// documentation mention (e.g. "see scripts/targets/targomo/collect-history.js
// for the target-owned bootstrap") is not - that distinction already exists
// and is deliberate (see project-profile.js's own docstring for the same
// precedent).
test("FPI-3C SOURCE AUDIT: collect-history.js has no require() dependency on scripts/targets/targomo", () => {
  const content = fs.readFileSync(path.resolve(__dirname, "collect-history.js"), "utf8");
  assert.doesNotMatch(content, /require\(["'][^"']*targets[\\/]targomo[^"']*["']\)/);
});

test("FPI-3C: the historical WORKFLOW_FILE constant is unchanged (\"cypress.yml\")", () => {
  assert.equal(WORKFLOW_FILE, "cypress.yml");
});
