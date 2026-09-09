#!/usr/bin/env node
/**
 * Flaky-test history collector.
 *
 * Queries the GitHub Actions REST API for the last N completed runs of
 * this workflow on a reference branch (default: main), and aggregates how
 * often THIS matrix leg's job (browser) passed/failed - a cheap,
 * GitHub-native signal: no external database, no artifact downloads/unzip,
 * no new npm dependency (uses Node's built-in fetch).
 *
 * Job-level (i.e. per-browser), not per-individual-test: this repo's
 * structured test reports are only uploaded on failure (see
 * cypress-report-<browser> in the workflow), so there is nothing to parse
 * for *passing* historical runs - job conclusion is the cheapest signal
 * that is actually available for every run, pass or fail.
 *
 * Reference branch is always `main`, not the current branch: for a
 * pull_request run this deliberately looks at trunk's recent trend for
 * this browser (a stable signal), not the PR's own short-lived branch
 * (which usually has no history at all on its first run).
 *
 * Entirely optional and best-effort: no token, an API error, this being
 * the first-ever run, or anything else going wrong writes an
 * { available: false } marker and exits 0 - analyze-failure.js treats
 * history as optional input and keeps working without it.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { assertValidProjectProfile } = require("./project-profile");
const cypressAdapter = require("./adapters/cypress-adapter");
// Roadmap #21H: the exact same trusted selection mechanism collect-context.js's
// own CLI bootstrap already uses (Roadmap #21E) - QA_FRAMEWORK absent still
// resolves to cypressAdapter (DEFAULT_FRAMEWORK), so every existing Cypress
// invocation of this script (which never sets QA_FRAMEWORK) keeps writing
// framework: "cypress" exactly as before. This is never a second, independent
// framework-identity mechanism - it is the one this repository already trusts
// everywhere else.
const { selectRuntimeAdapter } = require("./runtime-framework-selector");

const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_FILE = path.join(ROOT, "reports", "ai", "history.json");

// Roadmap TI-1: this generic collector owns no concrete project identity
// of its own - main() requires an explicitly injected ProjectProfile (see
// scripts/ai/project-profile.js for the generic contract) and fails
// closed if one isn't supplied. See
// scripts/targets/targomo/collect-history.js for the target-owned
// bootstrap that supplies the real production profile.

// This script is specific to this repo's single workflow file, matching
// how other scripts/ai/*.js already hardcode repo-specific details (spec
// paths, page object locations) rather than generalizing prematurely.
const WORKFLOW_FILE = "cypress.yml";
const DEFAULT_RUNS = 10;
const DEFAULT_BRANCH = "main";
// Hard ceiling on HISTORY_RUNS regardless of what the env var requests -
// each run considered costs one extra API call (see aggregateHistory), so
// an accidental misconfiguration (e.g. HISTORY_RUNS=500) shouldn't be able
// to turn one CI step into hundreds of requests.
const MAX_RUNS = 30;

// Same retry policy as analyze-failure.js's AI provider call, for the same
// reason: rate limiting and gateway/server errors are worth one or two
// quick retries, but a 401/403/404 will just fail identically again.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(status);
}

function clampRunsWanted(rawValue) {
  return Math.min(Math.max(Number(rawValue) || DEFAULT_RUNS, 1), MAX_RUNS);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  process.stdout.write(`[ai:history] ${message}\n`);
}

function writeUnavailable(reason) {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ available: false, reason }, null, 2));
  log(`history unavailable: ${reason}`);
}

async function fetchJson(apiBase, token, urlPath, { maxAttempts = 3, retryDelaysMs = [500, 1500], sleep = defaultSleep } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res;
    try {
      res = await fetch(`${apiBase}${urlPath}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch (err) {
      // Never got a response at all (network blip, timeout) - worth retrying.
      lastErr = err;
      if (attempt === maxAttempts) break;
      await sleep(retryDelaysMs[attempt - 1] ?? retryDelaysMs[retryDelaysMs.length - 1]);
      continue;
    }

    if (res.ok) return res.json();

    lastErr = new Error(`GitHub API ${res.status} ${res.statusText} for ${urlPath}`);
    if (attempt === maxAttempts || !isRetryableStatus(res.status)) break;
    await sleep(retryDelaysMs[attempt - 1] ?? retryDelaysMs[retryDelaysMs.length - 1]);
  }

  throw lastErr;
}

// Pure aggregation step, separated from the HTTP calls so it can be unit
// tested with fake run/job data and no network access. `getJobsForRun` is
// `async (run) => [{ name, conclusion }, ...]`. Job lookups run
// concurrently (Promise.all) - same number of API calls as before, just
// not paid for serially one run at a time.
//
// Roadmap #21H: `jobName`, when explicitly provided, names the EXACT
// GitHub Actions job to match (e.g. "Playwright Chromium") - required
// because Playwright's real job name is a fixed string, not a
// `Cypress - <browser>` template. Every existing Cypress call site never
// passes it, so the historical `Cypress - ${browser}` template remains the
// exact, unchanged default - byte-identical behavior for every pre-#21H
// invocation.
async function aggregateHistory({ runs, browser, jobName, getJobsForRun }) {
  const targetJobName = jobName || `Cypress - ${browser}`;
  const lookups = await Promise.all(
    runs.map(async (run) => {
      try {
        return { run, jobs: await getJobsForRun(run) };
      } catch {
        return null; // best-effort: skip a run we couldn't inspect, don't fail the whole thing
      }
    })
  );

  let passes = 0;
  let failures = 0;
  let retryPasses = 0;
  let inspected = 0;

  for (const lookup of lookups) {
    if (!lookup) continue;
    const { run, jobs } = lookup;
    const job = (jobs || []).find((j) => j.name === targetJobName);
    if (!job) continue;

    // Only success/failure are meaningful pass/fail data points - a
    // cancelled or skipped job conclusion isn't a "this browser passed or
    // failed" result and must not be counted, or passes+failures would no
    // longer add up to runsConsidered (the schema promises they do, e.g.
    // the task's own 7 passes + 3 failures = 10 runsConsidered example).
    if (job.conclusion === "success") {
      inspected += 1;
      passes += 1;
      // A run that failed on an earlier attempt and then passed after a
      // GitHub Actions job re-run. This is NOT a Cypress-level test retry
      // (this repo doesn't configure Cypress `retries`) - it's the
      // coarser "someone/something re-ran the failed job and it passed"
      // signal, which is what run_attempt actually tracks.
      if (run.run_attempt > 1) retryPasses += 1;
    } else if (job.conclusion === "failure") {
      inspected += 1;
      failures += 1;
    }
  }

  return { passes, failures, retryPasses, inspected };
}

// Roadmap TI-1: `profile` is a required, explicitly injected
// ProjectProfile, validated FIRST - before any of the existing best-effort
// token/repository/browser degradation checks below, and before any
// writeUnavailable()/output write. A missing/invalid profile is a
// configuration failure, never downgraded to an ordinary "history
// unavailable" marker - the promise this async function returns rejects
// immediately, and the require.main===module block at the bottom of this
// file distinguishes that rejection from every other (best-effort)
// failure mode.
async function main({ profile } = {}) {
  assertValidProjectProfile(profile, "collect-history.main()");

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const browser = process.env.TEST_BROWSER;
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const branch = process.env.HISTORY_BRANCH || DEFAULT_BRANCH;
  const runsWanted = clampRunsWanted(process.env.HISTORY_RUNS);
  const currentRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null;
  // Roadmap #21H: the exact same QA_FRAMEWORK -> adapter resolution
  // collect-context.js's own CLI bootstrap uses (Roadmap #21E) - absent
  // (every existing Cypress invocation) resolves to cypressAdapter, so
  // framework identity below is unchanged for Cypress. An invalid
  // QA_FRAMEWORK value throws RuntimeFrameworkError, which the existing
  // `main().catch(...)` wrapper at the bottom of this file already
  // converts to a safe writeUnavailable() marker - no new error handling
  // needed here.
  const adapter = selectRuntimeAdapter(process.env.QA_FRAMEWORK);
  // Roadmap #21H: the exact GitHub Actions job name to match, when the
  // caller can't rely on the historical `Cypress - <browser>` template
  // (Playwright's real job name, "Playwright Chromium", is a fixed
  // string, not a per-browser template). Every existing Cypress call site
  // never sets this, so the template remains the exact, unchanged
  // default.
  const jobName = process.env.HISTORY_JOB_NAME || `Cypress - ${browser}`;

  if (!token) return writeUnavailable("GITHUB_TOKEN not set");
  if (!repo) return writeUnavailable("GITHUB_REPOSITORY not set");
  if (!browser) return writeUnavailable("TEST_BROWSER not set");

  let runsResponse;
  try {
    runsResponse = await fetchJson(
      apiBase,
      token,
      `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=${
        runsWanted + 1
      }`
    );
  } catch (err) {
    return writeUnavailable(`could not list workflow runs: ${err.message}`);
  }

  const runs = (runsResponse.workflow_runs || []).filter((r) => r.id !== currentRunId).slice(0, runsWanted);

  if (runs.length === 0) {
    return writeUnavailable(`no prior completed runs found on branch '${branch}' yet`);
  }

  const { passes, failures, retryPasses, inspected } = await aggregateHistory({
    runs,
    browser,
    jobName,
    getJobsForRun: async (run) => {
      const jobsResponse = await fetchJson(apiBase, token, `/repos/${repo}/actions/runs/${run.id}/jobs`);
      return jobsResponse.jobs || [];
    },
  });

  if (inspected === 0) {
    return writeUnavailable(`no prior '${jobName}' job history found in the last ${runs.length} run(s) on '${branch}'`);
  }

  const history = {
    available: true,
    // Stable project identity (Roadmap #19.3C) - the project this
    // aggregate was actually collected for, so a consumer analyzing a
    // different (or unknown) current project can refuse to trust it
    // rather than silently treating it as universally applicable. See
    // scripts/ai/project-profile.js for the generic contract this value
    // must satisfy.
    projectId: profile.id,
    // Roadmap #19.9B: explicit framework provenance, read from the
    // selected adapter's own stable identity constant - the exact same
    // one collect-context.js's own metadata.framework already derives
    // from (Roadmap #21E's runtime-framework-selector.js), never an
    // independently duplicated literal. A record written from this point
    // on is no longer legacy-ambiguous: analyze-failure.js's
    // isHistoryFrameworkEligible() reads this exact field to ensure a
    // Playwright analysis can never mistake a Cypress record for its own
    // history, and a Cypress analysis matches it exactly rather than
    // falling back to legacy ABSENT-framework compatibility. Roadmap
    // #21H: previously always cypressAdapter.id (this producer was
    // Cypress-only) - now the selected adapter's own id, so a
    // QA_FRAMEWORK=playwright invocation correctly writes "playwright".
    framework: adapter.id,
    browser,
    branch,
    runsConsidered: inspected,
    passes,
    failures,
    retryPasses,
    generatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(history, null, 2));
  log(
    `wrote ${path.relative(ROOT, OUTPUT_FILE)} (${passes} pass, ${failures} fail, ${retryPasses} retry-pass of ${inspected} run(s) considered)`
  );
}

// Roadmap TI-1: generic direct invocation of this file supplies no
// profile, so main() always rejects with PROJECT_PROFILE_REQUIRED here -
// that specific, deterministic failure is a configuration error and must
// exit non-zero rather than being silently downgraded into a normal
// `history unavailable` marker (see main()'s own comment above). Every
// OTHER rejection (network/API errors, etc.) keeps the pre-existing
// best-effort writeUnavailable() behavior unchanged. A target-owned
// bootstrap (see scripts/targets/targomo/collect-history.js) supplies a
// real profile and therefore never hits the first branch in production.
if (require.main === module) {
  main().catch((err) => {
    if (err && typeof err.message === "string" && err.message.startsWith("PROJECT_PROFILE_")) {
      process.stderr.write(`[ai:history] ${err.message}\n`);
      process.exitCode = 1;
      return;
    }
    writeUnavailable(`unexpected error: ${err.message}`);
  });
}

module.exports = {
  main,
  aggregateHistory,
  fetchJson,
  isRetryableStatus,
  clampRunsWanted,
  WORKFLOW_FILE,
  DEFAULT_RUNS,
  DEFAULT_BRANCH,
  MAX_RUNS,
  cypressAdapter,
  // Roadmap #21H: exported by reference (same pattern as cypressAdapter
  // above) so a test can prove main()'s `framework: adapter.id` line
  // resolves to the real, current adapter identity for a given
  // QA_FRAMEWORK value, without needing to mock the GitHub API/filesystem/
  // env just to exercise main() itself.
  selectRuntimeAdapter,
};
