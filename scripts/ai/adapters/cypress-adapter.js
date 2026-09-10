#!/usr/bin/env node
/**
 * Cypress Adapter (Roadmap #19.6B)
 *
 * Owns everything specific to this repository's current test framework:
 * discovering and parsing the mochawesome JSON report(s) produced by
 * `cypress run` (see reporterOptions in cypress.config.js), and matching
 * Cypress's own on-failure screenshot naming convention. Nothing outside
 * this file needs to know a mochawesome report's shape, Cypress's
 * screenshot filename convention, or any other raw Cypress artifact
 * detail - the generic collector (scripts/ai/collect-context.js) only
 * ever consumes this adapter's normalized `collect()` result.
 *
 * This is a behavior-preserving extraction (Roadmap #19.6B) of code that
 * used to live directly in collect-context.js - see that file's git
 * history for the pre-extraction version. No parsing/matching semantics
 * were changed by the move itself.
 *
 * Roadmap FPI-2: this adapter owns NO repository root of its own.
 * `collect({ root, reportsDir, screenshotsDir })` receives the caller's
 * (collect-context.js's) already-validated trusted target repository
 * boundary (`root: { lexicalRoot, realRoot }`, see
 * scripts/ai/repository-root.js) and resolves its own default report/
 * screenshot conventions ("reports/cypress", "cypress/screenshots")
 * underneath it - never underneath this generic core's own `__dirname`.
 * `reportsDir`/`screenshotsDir` remain available as explicit test/caller
 * overrides for the SAME target repository; they are a framework-
 * specific convenience, never a second, competing root authority.
 *
 * Roadmap FPI-2 Corrective C1 (FPI2-R-1/R-2, independent adversarial
 * review of PR #123): `reportsDir`/`screenshotsDir` overrides are now
 * validated via context-utils.js's resolveRepositoryLocalPath() before
 * ever being used for a filesystem read - an override is a location hint
 * inside the already-trusted `root`, never a second, independent
 * filesystem authority; a directory outside the repository (or a
 * repository-local symlink whose real target escapes it) is rejected
 * with a bounded error rather than silently enumerated.
 * loadReports() additionally re-verifies each individually DISCOVERED
 * report file's own real location, closing the narrower gap where
 * `reportsDir` itself is safe but one file inside it is a symlink to
 * somewhere else. The final screenshot value now goes through
 * context-utils.js's resolveSafeLocalAttachmentPath() (the same
 * canonical-containment/existence/file-type check Playwright's own
 * attachment handling already used) instead of the weaker
 * normalizeSpecPath() - a discovered screenshot whose real location
 * escapes the repository can no longer surface as a raw absolute path in
 * model-visible evidence.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeSpecPath, resolveSafeLocalAttachmentPath, resolveRepositoryLocalPath, isCanonicalPathInsideRoot } = require("../context-utils");

function resolveRealPathSafe(absPath) {
  try {
    return fs.realpathSync(absPath);
  } catch {
    return null;
  }
}

// Stack traces can run very long (deep call chains, webpack-wrapped
// frames); the error *message* is the critical, never-truncated part -
// only the trailing stack lines are capped.
const MAX_STACK_CHARS = 4000;

// Roadmap #19.5B/#19.6B: this adapter's own stable, canonical,
// machine-readable identity - never inferred, always this constant. The
// generic collector reads this (not a local constant of its own) to set
// context.metadata.framework.
const id = "cypress";

// Roadmap FPI-2 Corrective C1 (FPI2-R-2, section 24): `root` is optional
// here (existing direct unit tests of this function exercise its report-
// discovery/parsing behavior without needing a repository boundary at
// all), but `collect()` below always supplies it - reportsDir itself was
// already validated as repository-local by resolveRepositoryLocalPath()
// before this function is ever called from there, but an INDIVIDUAL
// discovered file could still be a symlink whose own real target escapes
// the repository; this closes that gap file-by-file, not merely
// directory-by-directory.
function loadReports(reportsDir, root) {
  const warnings = [];

  if (!fs.existsSync(reportsDir)) {
    warnings.push(
      `No report directory found at reports/cypress. Run a test script (e.g. npm run chrome) before ai:collect.`
    );
    return { reports: [], warnings };
  }

  const allJson = fs
    .readdirSync(reportsDir)
    .filter((f) => f.toLowerCase().endsWith(".json"));

  if (allJson.length === 0) {
    warnings.push(`reports/cypress exists but contains no JSON report files.`);
    return { reports: [], warnings };
  }

  // Prefer a merged report (npm run report:merge) if present; otherwise
  // fall back to reading every per-spec mochawesome file.
  const filenames = allJson.includes("report.json") ? ["report.json"] : allJson;

  const reports = [];
  for (const filename of filenames) {
    const fullPath = path.join(reportsDir, filename);

    if (root) {
      const real = resolveRealPathSafe(fullPath);
      if (real && !isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) {
        warnings.push(`Skipped ${filename}: report file escapes the repository boundary.`);
        continue;
      }
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      reports.push(parsed);
    } catch (err) {
      warnings.push(`Could not parse ${path.join("reports", "cypress", filename)}: ${err.message}`);
    }
  }

  return { reports, warnings };
}

// Recursively walks a mochawesome suite tree, yielding every test with its
// resolved ancestor suite titles attached.
function* walkSuite(suite, ancestorTitles) {
  if (!suite) return;

  const titles = suite.title ? [...ancestorTitles, suite.title] : ancestorTitles;

  for (const test of suite.tests || []) {
    yield { test, suiteTitles: titles };
  }
  for (const child of suite.suites || []) {
    yield* walkSuite(child, titles);
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveScreenshotPath(specFile, suiteTitles, testTitle, screenshotsDir, root) {
  if (!specFile) return null;
  try {
    const specDir = path.join(screenshotsDir, path.basename(specFile));
    if (!fs.existsSync(specDir)) return null;

    const baseName = [...suiteTitles, testTitle].join(" -- ");
    // Cypress's own on-failure screenshot filename is exactly
    // "<suite -- test> (failed).png", optionally suffixed with an attempt
    // number when retries are enabled (not the case in this repo's config,
    // but handled defensively): "<suite -- test> (failed) (2).png". Only
    // ever return a file we can pin down as *this* failed test's own
    // screenshot - a loose prefix match could otherwise pick up an
    // unrelated screenshot whose title happens to start the same way, or
    // (worse) a screenshot from a test that didn't actually fail.
    const failedPattern = new RegExp(`^${escapeRegExp(baseName)} \\(failed\\)( \\(\\d+\\))?\\.png$`);
    const candidates = fs.readdirSync(specDir).filter((f) => failedPattern.test(f));
    if (candidates.length === 0) return null;

    // With multiple attempts, the highest-numbered one is the most recent.
    candidates.sort();
    const failedShot = candidates[candidates.length - 1];

    // Roadmap FPI-2 Corrective C1 (FPI2-R-1/R-2): the discovered file's
    // FINAL normalized value now goes through resolveSafeLocalAttachmentPath()
    // - the same canonical-containment/existence/file-type check
    // Playwright's own attachment handling already used - rather than the
    // weaker normalizeSpecPath(). This closes two gaps at once: a
    // screenshotsDir override whose real location escapes the repository
    // (R-2) and a discovered file that is itself a symlink escaping the
    // repository, even when screenshotsDir is otherwise safe (R-1/#24).
    // Never returns a raw absolute path - a rejected/escaping candidate
    // normalizes to null, exactly like a genuinely missing screenshot.
    return resolveSafeLocalAttachmentPath(path.join(specDir, failedShot), root).value;
  } catch {
    return null;
  }
}

// Centralized truncation helper (see MAX_STACK_CHARS) - never applied to
// the error message itself, only to fields that can legitimately be huge
// without losing the actually-critical information at the start.
function truncateText(text, maxChars) {
  if (typeof text !== "string") return text;
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n/* ...truncated... */` : text;
}

function extractFailedTests(reports, screenshotsDir, root) {
  const failedTests = [];

  for (const report of reports) {
    for (const rootSuite of report.results || []) {
      const specFile = normalizeSpecPath(rootSuite.file || rootSuite.fullFile, root);

      for (const { test, suiteTitles } of walkSuite(rootSuite, [])) {
        const isFailed = test.state === "failed" || (test.fail === true && test.pending !== true);
        if (!isFailed) continue;

        failedTests.push({
          title: test.title || null,
          fullTitle: test.fullTitle || null,
          suite: suiteTitles.join(" > ") || null,
          specFile,
          status: "failed",
          duration: typeof test.duration === "number" ? test.duration : null,
          error: {
            // Never truncated: the message is the critical part.
            message: (test.err && test.err.message) || null,
            stack: truncateText((test.err && (test.err.estack || test.err.stack)) || null, MAX_STACK_CHARS),
          },
          screenshot: resolveScreenshotPath(specFile, suiteTitles, test.title || "", screenshotsDir, root),
        });
      }
    }
  }

  return failedTests;
}

function summarizeTestResults(reports, root) {
  const specs = [];
  const totals = { tests: 0, passed: 0, failed: 0, pending: 0, duration: 0 };

  for (const report of reports) {
    for (const rootSuite of report.results || []) {
      const specFile = normalizeSpecPath(rootSuite.file || rootSuite.fullFile, root);
      const stats = report.stats || {};

      specs.push({
        specFile,
        tests: stats.tests ?? null,
        passed: stats.passes ?? null,
        failed: stats.failures ?? null,
        pending: stats.pending ?? null,
        duration: stats.duration ?? null,
      });

      totals.tests += stats.tests || 0;
      totals.passed += stats.passes || 0;
      totals.failed += stats.failures || 0;
      totals.pending += stats.pending || 0;
      totals.duration += stats.duration || 0;
    }
  }

  return { found: true, totals, specs };
}

// Roadmap #19.6B: the adapter's own synchronous, thin sequencing
// entrypoint - loads reports, then derives testResults/failedTests from
// them, merging in the discovery warnings. Conceptually mirrors
// collect-context.js's pre-#19.6B main() body, but returns its result
// instead of writing a file or knowing about metadata/ProjectProfile/
// relevantFiles, all of which remain the generic collector's own
// responsibility.
//
// Roadmap FPI-2: `root` is required - the caller (collect-context.js)
// always supplies its own already-validated trusted target repository
// boundary. `reportsDir`/`screenshotsDir` default to the same
// "reports/cypress"/"cypress/screenshots" convention as before, now
// resolved underneath `root.realRoot` rather than this file's own former
// module-level ROOT constant.
//
// Roadmap FPI-2 Corrective C1 (FPI2-R-2): an explicit override is
// validated via resolveRepositoryLocalPath() before it is ever used for a
// filesystem read - it is a location hint inside the already-trusted
// `root`, never a second, independent filesystem authority. An override
// outside the repository throws a bounded ADAPTER_PATH_OUTSIDE_REPOSITORY
// error rather than being silently enumerated.
function collect({ root, reportsDir, screenshotsDir } = {}) {
  const resolvedReportsDir = reportsDir
    ? resolveRepositoryLocalPath(reportsDir, root, "cypress-adapter.collect(): reportsDir")
    : path.join(root.realRoot, "reports", "cypress");
  const resolvedScreenshotsDir = screenshotsDir
    ? resolveRepositoryLocalPath(screenshotsDir, root, "cypress-adapter.collect(): screenshotsDir")
    : path.join(root.realRoot, "cypress", "screenshots");

  const { reports, warnings } = loadReports(resolvedReportsDir, root);

  if (reports.length === 0) {
    return { testResults: { found: false }, failedTests: [], warnings };
  }

  return {
    testResults: summarizeTestResults(reports, root),
    failedTests: extractFailedTests(reports, resolvedScreenshotsDir, root),
    warnings,
  };
}

module.exports = {
  id,
  collect,
  loadReports,
  walkSuite,
  resolveScreenshotPath,
  extractFailedTests,
  summarizeTestResults,
  truncateText,
};
