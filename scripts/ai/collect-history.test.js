"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  main,
  aggregateHistory,
  fetchJson,
  isRetryableStatus,
  clampRunsWanted,
  DEFAULT_RUNS,
  MAX_RUNS,
  cypressAdapter,
  selectRuntimeAdapter,
} = require("./collect-history");
const realCypressAdapter = require("./adapters/cypress-adapter");
const realPlaywrightAdapter = require("./adapters/playwright-adapter");
const realSelectRuntimeAdapter = require("./runtime-framework-selector").selectRuntimeAdapter;

function run({ id, run_attempt = 1 }) {
  return { id, run_attempt };
}

// Roadmap TI-1: this generic collector owns no concrete project identity
// of its own - main() now requires an explicitly injected ProjectProfile
// and fails closed without one. Targomo's own production identity
// ("external-poi-sut") is proven by
// scripts/targets/targomo/collect-history.test.js instead.
test("main(): fails closed with PROJECT_PROFILE_REQUIRED when no profile is supplied", async () => {
  await assert.rejects(() => main(), /PROJECT_PROFILE_REQUIRED/);
});

test("main(): fails closed with PROJECT_PROFILE_INVALID for a malformed profile", async () => {
  await assert.rejects(() => main({ profile: {} }), /PROJECT_PROFILE_INVALID/);
});

test("main(): a missing profile is rejected before any GITHUB_TOKEN/GITHUB_REPOSITORY/TEST_BROWSER check - configuration failure, not ordinary unavailable history", async (t) => {
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
  });
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.TEST_BROWSER;
  // If profile validation ran AFTER the token/repo/browser checks, this
  // would resolve normally (writeUnavailable's best-effort path) instead
  // of rejecting - proving the check order matters, not just its presence.
  await assert.rejects(() => main(), /PROJECT_PROFILE_REQUIRED/);
});

// Roadmap #19.9B:
// main()'s own `framework: cypressAdapter.id` line is not otherwise
// unit-testable without mocking the GitHub API/filesystem/env (this file
// deliberately never does that - see every other test here), so proving
// this module reads the real, current Cypress adapter identity BY
// REFERENCE is the strongest available proof that a newly written history
// record's `framework` field will always be "cypress", never an
// independently duplicated literal that could silently drift from the
// adapter's own id.
test("cypressAdapter: collect-history.js sources framework identity from the same Cypress adapter as the rest of the pipeline, not a duplicated/hardcoded literal", () => {
  assert.equal(cypressAdapter, realCypressAdapter, "must be the exact same object reference, not a copy");
  assert.equal(cypressAdapter.id, "cypress");
});

// Roadmap #21H: mirrors the cypressAdapter test above - main() no longer
// unconditionally writes `framework: cypressAdapter.id`, it writes
// `framework: adapter.id` where `adapter = selectRuntimeAdapter(process.env.
// QA_FRAMEWORK)`. Proving this module's selectRuntimeAdapter is the exact
// same function reference as runtime-framework-selector.js's own (Roadmap
// #21E), and that it resolves to the real Cypress/Playwright adapters by
// reference, is the strongest available proof that a QA_FRAMEWORK=playwright
// invocation will write framework: "playwright" and every existing
// QA_FRAMEWORK-absent Cypress invocation keeps writing framework: "cypress" -
// without needing to mock the GitHub API/filesystem/env just to exercise
// main() itself.
test("selectRuntimeAdapter: collect-history.js sources framework resolution from the same mechanism collect-context.js uses, not a duplicated/independent one", () => {
  assert.equal(selectRuntimeAdapter, realSelectRuntimeAdapter, "must be the exact same function reference, not a copy");
  assert.equal(selectRuntimeAdapter(undefined), realCypressAdapter, "QA_FRAMEWORK absent must still resolve to the real cypressAdapter");
  assert.equal(selectRuntimeAdapter(undefined).id, "cypress");
  assert.equal(selectRuntimeAdapter("playwright"), realPlaywrightAdapter, "QA_FRAMEWORK=playwright must resolve to the real playwrightAdapter");
  assert.equal(selectRuntimeAdapter("playwright").id, "playwright");
});

test("aggregateHistory: counts passes and failures per browser from job conclusions", async () => {
  const runs = [run({ id: 1 }), run({ id: 2 }), run({ id: 3 }), run({ id: 4 }), run({ id: 5 })];
  const jobsByRun = {
    1: [{ name: "Cypress - chrome", conclusion: "success" }],
    2: [{ name: "Cypress - chrome", conclusion: "success" }],
    3: [{ name: "Cypress - chrome", conclusion: "success" }],
    4: [{ name: "Cypress - chrome", conclusion: "failure" }],
    5: [{ name: "Cypress - chrome", conclusion: "success" }],
  };

  const result = await aggregateHistory({
    runs,
    browser: "chrome",
    getJobsForRun: async (r) => jobsByRun[r.id],
  });

  assert.deepEqual(result, { passes: 4, failures: 1, retryPasses: 0, inspected: 5 });
});

test("aggregateHistory: is browser-specific - only matches this browser's job name", async () => {
  const runs = [run({ id: 1 })];
  const jobsByRun = {
    1: [
      { name: "Cypress - chrome", conclusion: "success" },
      { name: "Cypress - edge", conclusion: "failure" },
    ],
  };

  const chromeResult = await aggregateHistory({ runs, browser: "chrome", getJobsForRun: async (r) => jobsByRun[r.id] });
  const edgeResult = await aggregateHistory({ runs, browser: "edge", getJobsForRun: async (r) => jobsByRun[r.id] });

  assert.equal(chromeResult.passes, 1);
  assert.equal(chromeResult.failures, 0);
  assert.equal(edgeResult.passes, 0);
  assert.equal(edgeResult.failures, 1);
});

test("aggregateHistory: counts retryPasses only when the job succeeded on a re-run (run_attempt > 1)", async () => {
  const runs = [run({ id: 1, run_attempt: 1 }), run({ id: 2, run_attempt: 2 }), run({ id: 3, run_attempt: 3 })];
  const jobsByRun = {
    1: [{ name: "Cypress - chrome", conclusion: "success" }], // first-attempt pass, not a retry
    2: [{ name: "Cypress - chrome", conclusion: "success" }], // passed after a re-run
    3: [{ name: "Cypress - chrome", conclusion: "failure" }], // failed even after a re-run
  };

  const result = await aggregateHistory({ runs, browser: "chrome", getJobsForRun: async (r) => jobsByRun[r.id] });
  assert.equal(result.retryPasses, 1);
  assert.equal(result.passes, 2);
  assert.equal(result.failures, 1);
});

test("aggregateHistory: ignores conclusions other than success/failure (e.g. cancelled) without crashing", async () => {
  const runs = [run({ id: 1 }), run({ id: 2 })];
  const jobsByRun = {
    1: [{ name: "Cypress - chrome", conclusion: "cancelled" }],
    2: [{ name: "Cypress - chrome", conclusion: "success" }],
  };

  const result = await aggregateHistory({ runs, browser: "chrome", getJobsForRun: async (r) => jobsByRun[r.id] });
  assert.equal(result.passes, 1);
  assert.equal(result.failures, 0);
  assert.equal(result.inspected, 1, "the cancelled run should not count toward runsConsidered");
});

test("aggregateHistory: skips a run whose job lookup fails, without throwing", async () => {
  const runs = [run({ id: 1 }), run({ id: 2 })];

  const result = await aggregateHistory({
    runs,
    browser: "chrome",
    getJobsForRun: async (r) => {
      if (r.id === 1) throw new Error("network error");
      return [{ name: "Cypress - chrome", conclusion: "success" }];
    },
  });

  assert.equal(result.inspected, 1);
  assert.equal(result.passes, 1);
});

test("aggregateHistory: a job matching a different browser name is not counted at all", async () => {
  const runs = [run({ id: 1 })];
  const jobsByRun = { 1: [{ name: "Some other job", conclusion: "success" }] };

  const result = await aggregateHistory({ runs, browser: "chrome", getJobsForRun: async (r) => jobsByRun[r.id] });
  assert.equal(result.inspected, 0);
});

test("aggregateHistory: no runs at all -> zeroed-out result, no crash", async () => {
  const result = await aggregateHistory({ runs: [], browser: "chrome", getJobsForRun: async () => [] });
  assert.deepEqual(result, { passes: 0, failures: 0, retryPasses: 0, inspected: 0 });
});

// Roadmap #21H: Playwright's real GitHub Actions job name ("Playwright
// Chromium") is a fixed string, not a `Cypress - <browser>` template, so
// collect-history.js must be able to match it via an explicit jobName
// override rather than deriving it from `browser`.
test("aggregateHistory: an explicit jobName matches that exact job, independent of the browser value (Playwright case)", async () => {
  const runs = [run({ id: 1 }), run({ id: 2 }), run({ id: 3 })];
  const jobsByRun = {
    1: [{ name: "Playwright Chromium", conclusion: "success" }],
    2: [{ name: "Playwright Chromium", conclusion: "failure" }],
    3: [{ name: "Playwright Chromium", conclusion: "success" }],
  };

  const result = await aggregateHistory({
    runs,
    browser: "playwright-chromium",
    jobName: "Playwright Chromium",
    getJobsForRun: async (r) => jobsByRun[r.id],
  });

  assert.deepEqual(result, { passes: 2, failures: 1, retryPasses: 0, inspected: 3 });
});

test("aggregateHistory: an explicit jobName takes precedence over the `Cypress - <browser>` default template", async () => {
  const runs = [run({ id: 1 })];
  const jobsByRun = {
    1: [
      { name: "Cypress - chrome", conclusion: "failure" },
      { name: "Playwright Chromium", conclusion: "success" },
    ],
  };

  // browser is "chrome" here (arbitrary/unused for matching), but jobName
  // explicitly names the Playwright job - only that job may be counted.
  const result = await aggregateHistory({
    runs,
    browser: "chrome",
    jobName: "Playwright Chromium",
    getJobsForRun: async (r) => jobsByRun[r.id],
  });

  assert.deepEqual(result, { passes: 1, failures: 0, retryPasses: 0, inspected: 1 });
});

test("aggregateHistory: omitting jobName falls back to the exact, unchanged `Cypress - <browser>` template (backward compatibility)", async () => {
  const runs = [run({ id: 1 })];
  const jobsByRun = { 1: [{ name: "Cypress - edge", conclusion: "success" }] };

  const withoutJobName = await aggregateHistory({ runs, browser: "edge", getJobsForRun: async (r) => jobsByRun[r.id] });
  const withUndefinedJobName = await aggregateHistory({
    runs,
    browser: "edge",
    jobName: undefined,
    getJobsForRun: async (r) => jobsByRun[r.id],
  });

  assert.deepEqual(withoutJobName, { passes: 1, failures: 0, retryPasses: 0, inspected: 1 });
  assert.deepEqual(withUndefinedJobName, { passes: 1, failures: 0, retryPasses: 0, inspected: 1 });
});

test("clampRunsWanted: falls back to the default when unset, non-numeric, or zero", () => {
  assert.equal(clampRunsWanted(undefined), DEFAULT_RUNS);
  assert.equal(clampRunsWanted("not-a-number"), DEFAULT_RUNS);
  assert.equal(clampRunsWanted("0"), DEFAULT_RUNS, "0 is falsy, so it's treated the same as unset");
});

test("clampRunsWanted: a negative value clamps up to the minimum of 1", () => {
  assert.equal(clampRunsWanted("-5"), 1);
});

test("clampRunsWanted: honors a reasonable explicit value", () => {
  assert.equal(clampRunsWanted("5"), 5);
});

test("clampRunsWanted: never exceeds MAX_RUNS regardless of what's requested", () => {
  assert.equal(clampRunsWanted("500"), MAX_RUNS);
  assert.ok(MAX_RUNS < 500, "sanity check that the test is actually exercising the clamp");
});

test("isRetryableStatus: 429 and 5xx are retryable, 4xx auth/lookup errors are not", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(403), false);
  assert.equal(isRetryableStatus(404), false);
});

test("fetchJson: retries a transient 503 and succeeds on a later attempt", async (t) => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    if (calls < 3) return { ok: false, status: 503, statusText: "Service Unavailable" };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await fetchJson("https://api.github.com", "tok", "/repos/o/r/actions/runs/1/jobs", {
    sleep: async () => {},
  });
  assert.equal(calls, 3);
  assert.deepEqual(result, { ok: true });
});

test("fetchJson: never retries a 404 - fails on the first attempt", async (t) => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    return { ok: false, status: 404, statusText: "Not Found" };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  await assert.rejects(() =>
    fetchJson("https://api.github.com", "tok", "/repos/o/r/actions/runs/1/jobs", { sleep: async () => {} })
  );
  assert.equal(calls, 1);
});

test("fetchJson: gives up after maxAttempts on a persistent transient error", async (t) => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    return { ok: false, status: 500, statusText: "Internal Server Error" };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  await assert.rejects(() =>
    fetchJson("https://api.github.com", "tok", "/x", { maxAttempts: 3, sleep: async () => {} })
  );
  assert.equal(calls, 3);
});
