#!/usr/bin/env node
/**
 * Playwright Adapter (Roadmap #19.8B - offline only)
 *
 * Normalizes Playwright's official JSON reporter output into this
 * repository's existing generic collection contract - the same
 * { testResults, failedTests, warnings } shape produced by
 * scripts/ai/adapters/cypress-adapter.js - so the generic collector/AI
 * pipeline never needs to know which framework produced the evidence.
 *
 * OFFLINE ONLY (Roadmap #19.8B): this file is not wired into
 * collect-context.js's production runtime, which still imports and calls
 * only the Cypress adapter (see scripts/ai/collect-context.js). This
 * module and its tests prove that an official JSON-reporter-shaped report
 * can be normalized through the same generic contract as Cypress -
 * nothing more. No Playwright package is installed or required to parse
 * these fixtures; the shape here is modeled from Playwright's documented
 * JSONReport/JSONReportSuite/JSONReportSpec/JSONReportTest/
 * JSONReportTestResult/JSONReportAttachment fields, not verified against
 * an installed package or a real captured report (see #19.8A/#19.8B
 * roadmap notes for the exact compatibility-claim boundary).
 *
 * CRITICAL logical-outcome rule (the reason this file exists in its
 * current form rather than a naive "last result wins" implementation):
 * Playwright's authoritative LOGICAL outcome for one test is
 * JSONReportTest.status ("expected" | "unexpected" | "flaky" | "skipped"),
 * which is distinct from JSONReportTestResult.status on an individual
 * attempt ("passed" | "failed" | "timedOut" | "skipped" | "interrupted").
 * A test can have expectedStatus: "failed" and a final attempt status of
 * "failed" while test.status is still "expected" (e.g. test.fail() -
 * an assertion that is SUPPOSED to fail) - that must never surface as a
 * generic failure. Likewise a "flaky" test (failed, then passed on
 * retry) must never surface as a generic failure just because an earlier
 * attempt failed. Only test.status === "unexpected" produces a
 * failedTests entry, and exactly one per logical test, built from the
 * FINAL (last) result as primary evidence.
 *
 * Roadmap FPI-2: this adapter owns NO repository root of its own.
 * `collect({ root, reportFile })` receives the caller's (collect-
 * context.js's) already-validated trusted target repository boundary
 * (`root: { lexicalRoot, realRoot }`, see scripts/ai/repository-root.js)
 * and resolves its default report location ("reports/playwright/
 * report.json") underneath it - never underneath this generic core's
 * own `__dirname`. `reportFile` remains available as an explicit test/
 * caller override for the SAME target repository.
 *
 * Roadmap FPI-2 Corrective C1 (FPI2-R-2, independent adversarial review
 * of PR #123): an explicit `reportFile` override is now validated via
 * context-utils.js's resolveRepositoryLocalPath() before it is ever read
 * - a location hint inside the already-trusted `root`, never a second,
 * independent filesystem authority (this also closes the narrower
 * report-file-symlink-escape case: a nominally in-root reportFile whose
 * real target escapes the repository is rejected the same way).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { resolveSafeSpecPath, resolveSafeLocalAttachmentPath, resolveRepositoryLocalPath, isCanonicalPathInsideRoot } = require("../context-utils");
const { assertValidFrameworkRuntimeConfig } = require("../framework-runtime-config");

// Roadmap #19.8A/#19.8B: this adapter's own stable, canonical,
// machine-readable identity - never inferred, always this constant.
const id = "playwright";

// Roadmap FPI-2 Corrective C1 (FPI2-R-2, section 23): `root` is optional
// here (existing direct unit tests of this function exercise its report-
// loading/parsing behavior without needing a repository boundary at
// all), but `collect()` below always supplies it. An explicit `reportFile`
// override is already validated as repository-local by
// resolveRepositoryLocalPath() before this function is ever called from
// there - but the DEFAULT report location is not an override, so this
// re-verifies the real (symlink-resolved) target of whichever path was
// ultimately used stays inside the repository, closing the gap where the
// report file itself (default or override) is a symlink to somewhere
// else. Never reads file content before this check.
function loadReport(reportFile, root) {
  const warnings = [];

  if (!fs.existsSync(reportFile)) {
    // Fixed canonical-path text, not the actual (possibly overridden/temp)
    // reportFile argument - matches cypress-adapter.js's loadReports()
    // convention of never leaking an overridden/temp path into a warning
    // string (see its "No report directory found at reports/cypress."
    // message, which is identical regardless of the reportsDir argument).
    warnings.push(
      `No Playwright JSON report found at reports/playwright/report.json. Run a Playwright test script before ai:collect.`
    );
    return { report: null, warnings };
  }

  if (root) {
    let real;
    try {
      real = fs.realpathSync(reportFile);
    } catch {
      real = null;
    }
    if (real && !isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) {
      warnings.push(`Skipped the Playwright report file: it escapes the repository boundary.`);
      return { report: null, warnings };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  } catch (err) {
    warnings.push(`Could not parse reports/playwright/report.json: ${err.message}`);
    return { report: null, warnings };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.suites)) {
    warnings.push(`reports/playwright/report.json has an unexpected shape (missing a top-level "suites" array).`);
    return { report: null, warnings };
  }

  return { report: parsed, warnings };
}

// Recursively walks the official suites[]/suites[].suites[] hierarchy,
// yielding one entry per spec with its resolved describe-block ancestry
// (suiteTitles) and resolved spec file. The top-level suite in
// report.suites[] represents a *file*, not a describe block - its own
// title is deliberately never folded into suiteTitles (see buildFailure's
// fullTitle construction), only nested suite.suites[] entries are.
function walkReportSuites(suites, warnings = [], root) {
  const entries = [];
  for (const fileSuite of Array.isArray(suites) ? suites : []) {
    if (!fileSuite || typeof fileSuite !== "object") continue;
    const fileHint = typeof fileSuite.file === "string" && fileSuite.file ? fileSuite.file : null;
    walkGroup(fileSuite, [], fileHint, entries, warnings, root);
  }
  return entries;
}

function walkGroup(suite, ancestorTitles, fileHint, entries, warnings, root) {
  for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
    if (!spec || typeof spec !== "object") continue;
    // Roadmap #19.8B Phase 9: spec.file is preferred; the nearest
    // enclosing suite's file is only a fallback. Roadmap #21D: the raw
    // value is a reporter-derived PATH STRING, not a file-read
    // authorization (that remains #21C's RelevantFiles policy) -
    // resolveSafeSpecPath() (context-utils.js) classifies and either
    // normalizes or safely redacts it before it ever becomes
    // model-visible; a genuinely-supplied-but-unsafe value produces one
    // bounded, path-free warning, never the raw string.
    const specFileRaw = (typeof spec.file === "string" && spec.file) || fileHint || null;
    const { value: specFile, rejected } = resolveSafeSpecPath(specFileRaw, root);
    if (rejected) {
      warnings.push(
        `Playwright spec path for "${typeof spec.title === "string" ? spec.title : "(untitled)"}" was outside the repository/workspace boundary and was redacted.`
      );
    }
    entries.push({ spec, suiteTitles: ancestorTitles, specFile });
  }
  for (const child of Array.isArray(suite.suites) ? suite.suites : []) {
    if (!child || typeof child !== "object") continue;
    const childFileHint = (typeof child.file === "string" && child.file) || fileHint;
    const childTitles = typeof child.title === "string" && child.title ? [...ancestorTitles, child.title] : ancestorTitles;
    walkGroup(child, childTitles, childFileHint, entries, warnings, root);
  }
}

// The single authoritative mapping from Playwright's LOGICAL test.status
// to this repository's generic pass/fail/pending vocabulary. Never reads
// an individual result's status - see the module docstring.
function classifyTestStatus(status) {
  if (status === "expected" || status === "flaky") return "passed";
  if (status === "unexpected") return "failed";
  if (status === "skipped") return "pending";
  return "unknown";
}

// The FINAL attempt is the only one ever used as normalized evidence
// (duration/error/attachments) - one logical test always yields at most
// one normalized failure, never one per retry attempt.
function selectPrimaryResult(test) {
  const results = Array.isArray(test.results) ? test.results : [];
  return results.length > 0 ? results[results.length - 1] : null;
}

// Prefers result.error (Playwright's own "first test error" field);
// falls back to result.errors[0] only when structurally valid. Never
// concatenates multiple errors into one synthetic message/stack.
function buildFailureError(primary) {
  if (!primary) return { message: null, stack: null };

  const source =
    primary.error && typeof primary.error === "object"
      ? primary.error
      : Array.isArray(primary.errors) && primary.errors.length > 0 && primary.errors[0] && typeof primary.errors[0] === "object"
        ? primary.errors[0]
        : null;

  return {
    message: source && typeof source.message === "string" ? source.message : null,
    stack: source && typeof source.stack === "string" ? source.stack : null,
  };
}

// Screenshot mapping is entirely adapter-local (Roadmap #19.8A Phase 15):
// only the PRIMARY (final) result's attachments are ever inspected, only
// an attachment explicitly named "screenshot" with an image/* contentType
// ever qualifies (Roadmap #21D: this also keeps a non-image attachment
// merely renamed "screenshot" from ever being treated as one), and among
// several such attachments the last one wins deterministically. A
// body-only attachment (no `path`) never becomes a screenshot - no
// attachment body is ever decoded, written, or otherwise materialized
// anywhere in this module (Roadmap #19.8B / #21D R3). Roadmap #21D (R2):
// the candidate path is never trusted as-is - resolveSafeLocalAttachmentPath()
// (context-utils.js) additionally requires it to name a real, ordinary
// file that is canonically inside the repository/workspace boundary
// (rejecting URLs, UNC paths, foreign-OS absolute paths, traversal, and
// symlink escapes) before it can ever become the normalized screenshot
// value - and even then returns a repo-relative path, never an absolute
// one.
function resolveScreenshot(primary, title, warnings, root) {
  if (!primary || !Array.isArray(primary.attachments)) return null;

  const screenshotAttachments = primary.attachments.filter(
    (a) => a && typeof a === "object" && a.name === "screenshot" && typeof a.contentType === "string" && a.contentType.startsWith("image/")
  );
  if (screenshotAttachments.length === 0) return null;

  const chosen = screenshotAttachments[screenshotAttachments.length - 1];

  if (typeof chosen.path !== "string" || !chosen.path) {
    warnings.push(`Screenshot attachment for test "${title || "(untitled)"}" has no usable path.`);
    return null;
  }

  const { value, rejected } = resolveSafeLocalAttachmentPath(chosen.path, root);
  if (value) return value;

  // Never interpolates the actual (possibly absolute/temp/remote) path
  // into the warning string - only the test title, matching the
  // no-absolute-temp-paths-in-warnings policy this adapter has always
  // followed, now also covering the out-of-root/URL/UNC/symlink-escape
  // rejection case introduced by Roadmap #21D.
  if (rejected) {
    warnings.push(`Screenshot attachment path for test "${title || "(untitled)"}" was not a safe repository-local path and was redacted.`);
  } else {
    warnings.push(`Screenshot attachment path for test "${title || "(untitled)"}" does not exist on disk.`);
  }
  return null;
}

// Mirrors cypress-adapter.js's summarizeTestResults() shape exactly:
// { found, totals: {tests,passed,failed,pending,duration}, specs: [...] }.
// found is always true here - this function is only ever called once a
// report has already loaded successfully (see collect()); an empty
// suites[] array (or a report with zero logical tests) still yields
// found:true with all-zero totals, exactly like the Cypress adapter
// treats a successfully parsed report with zero results.
function summarizeTestResults(entries, warnings) {
  const specStats = new Map();
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalPending = 0;
  let totalDuration = 0;

  for (const { spec, specFile } of entries) {
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.tests)) {
      warnings.push(`Skipped a malformed spec entry (missing a "tests" array)${spec && typeof spec.title === "string" ? ` for "${spec.title}"` : ""}.`);
      continue;
    }

    for (const test of spec.tests) {
      if (!test || typeof test !== "object" || typeof test.status !== "string") {
        warnings.push(`Skipped a malformed test entry under spec "${spec.title || "(untitled)"}".`);
        continue;
      }

      const bucket = classifyTestStatus(test.status);
      if (bucket === "unknown") {
        warnings.push(
          `Unknown Playwright test.status "${test.status}" for test "${spec.title || "(untitled)"}"; treated conservatively as neither pass nor fail.`
        );
      }

      const primary = selectPrimaryResult(test);
      const duration = primary && Number.isFinite(primary.duration) ? primary.duration : 0;

      totalTests += 1;
      if (bucket === "passed") totalPassed += 1;
      else if (bucket === "failed") totalFailed += 1;
      else if (bucket === "pending") totalPending += 1;
      totalDuration += duration;

      if (specFile) {
        if (!specStats.has(specFile)) specStats.set(specFile, { tests: 0, passed: 0, failed: 0, pending: 0, duration: 0 });
        const s = specStats.get(specFile);
        s.tests += 1;
        if (bucket === "passed") s.passed += 1;
        else if (bucket === "failed") s.failed += 1;
        else if (bucket === "pending") s.pending += 1;
        s.duration += duration;
      }
    }
  }

  return {
    found: true,
    totals: { tests: totalTests, passed: totalPassed, failed: totalFailed, pending: totalPending, duration: totalDuration },
    specs: [...specStats.entries()].map(([specFile, s]) => ({ specFile, ...s })),
  };
}

// Emits exactly one normalized failure per logical test whose
// test.status === "unexpected" - never per retry attempt (Roadmap #19.8B
// Phase 13/14). Every emitted object satisfies
// scripts/ai/normalized-failure.js's validateNormalizedFailure() contract
// unchanged; projectId/projectName are preserved as allowed extra fields
// (Roadmap #19.8B Phase 19), never required by the generic validator.
function extractFailedTests(entries, warnings, root) {
  const failedTests = [];

  for (const { spec, suiteTitles, specFile } of entries) {
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.tests)) continue; // already warned in summarizeTestResults
    for (const test of spec.tests) {
      if (!test || typeof test !== "object" || typeof test.status !== "string") continue; // already warned
      if (classifyTestStatus(test.status) !== "failed") continue;

      const primary = selectPrimaryResult(test);
      if (!primary) {
        warnings.push(
          `Test "${typeof spec.title === "string" ? spec.title : "(untitled)"}" is unexpected (failed) but has no result entries; error evidence unavailable.`
        );
      }

      const title = typeof spec.title === "string" ? spec.title : null;
      const fullTitle = title ? (suiteTitles.length > 0 ? [...suiteTitles, title].join(" > ") : title) : null;
      const duration = primary && Number.isFinite(primary.duration) ? primary.duration : null;

      const failure = {
        title,
        fullTitle,
        specFile,
        suite: suiteTitles.join(" > ") || null,
        status: "failed",
        duration,
        error: buildFailureError(primary),
        screenshot: resolveScreenshot(primary, title, warnings, root),
      };
      if (typeof test.projectId === "string" && test.projectId) failure.projectId = test.projectId;
      if (typeof test.projectName === "string" && test.projectName) failure.projectName = test.projectName;

      failedTests.push(failure);
    }
  }

  return failedTests;
}

// Roadmap FPI-3B (FrameworkRuntimeConfig Playwright layout wiring):
// resolves an OPTIONAL, orchestration-supplied FrameworkRuntimeConfig
// into a candidate `reportFile` string - or returns null when no config
// was supplied at all (Case A: config ABSENCE, never itself an error).
// Mirrors cypress-adapter.js's own resolveFrameworkRuntimeConfigLayout()
// exactly, narrowed to Playwright's single `reports.reportFile` field
// (framework-runtime-config.js's PLAYWRIGHT_REPORTS_ALLOWED_KEYS has only
// this one field - there is no Cypress-style multi-field atomicity
// concern here, but the WHOLE config object - schemaVersion, projectId,
// framework, frameworkConfigPath, testSourceRoot, reports,
// historyWorkflowFile - is still validated atomically by the shared FPI-1
// validator; a config missing any required field is rejected as a whole).
// A SUPPLIED config is a fundamentally different state from absence: it
// is either fully valid and identity-matched, in which case it becomes
// the candidate source, or it fails closed via a thrown, bounded error -
// there is no silent fallback to the historical default once a config
// was actually supplied.
//
// Only a shape/identity decision - never a filesystem check. The
// returned candidate string is exactly as untrusted as an explicit
// reportFile override already is: it still flows through
// resolveRepositoryLocalPath() below before ever being used for a read.
function resolveFrameworkRuntimeConfigReportFile(frameworkRuntimeConfig, currentProjectId) {
  if (frameworkRuntimeConfig === undefined) return null; // Case A: absence - not an error

  // Case C: structurally invalid (including a config missing/malformed
  // reports.reportFile) - fails closed via the existing FPI-1 validator;
  // never silently treated as absence.
  const config = assertValidFrameworkRuntimeConfig(
    frameworkRuntimeConfig,
    "playwright-adapter.collect(): frameworkRuntimeConfig"
  );

  // Case E: identity mismatch - fails closed. A config for the wrong
  // framework or the wrong project is a configuration error, never
  // silently downgraded to "no config."
  if (config.framework !== id) {
    throw new Error(
      `PLAYWRIGHT_RUNTIME_CONFIG_FRAMEWORK_MISMATCH: playwright-adapter.collect() received a FrameworkRuntimeConfig for a different framework than "${id}".`
    );
  }
  if (typeof currentProjectId !== "string" || currentProjectId.length === 0) {
    throw new Error(
      "PLAYWRIGHT_RUNTIME_CONFIG_PROJECT_ID_REQUIRED: playwright-adapter.collect() received a frameworkRuntimeConfig but no currentProjectId to validate it against."
    );
  }
  if (config.projectId !== currentProjectId) {
    throw new Error(
      "PLAYWRIGHT_RUNTIME_CONFIG_PROJECT_MISMATCH: playwright-adapter.collect() received a FrameworkRuntimeConfig for a different project than the current invocation."
    );
  }

  return config.reports.reportFile;
}

// Roadmap #19.8B: thin synchronous sequencing entrypoint, mirroring
// cypress-adapter.js's own collect(). Framework-specific INPUT
// (reportFile, a single JSON report path) is intentionally different
// from Cypress's reportsDir/screenshotsDir - the generic OUTPUT contract
// is identical.
//
// Roadmap FPI-2: `root` is required - the caller (collect-context.js)
// always supplies its own already-validated trusted target repository
// boundary. `reportFile` defaults to the same "reports/playwright/
// report.json" convention as before, now resolved underneath
// `root.realRoot` rather than this file's own former module-level ROOT
// constant.
//
// Roadmap FPI-2 Corrective C1 (FPI2-R-2): an explicit `reportFile`
// override is validated via resolveRepositoryLocalPath() before it is
// ever read - it is a location hint inside the already-trusted `root`,
// never a second, independent filesystem authority. An override outside
// the repository (or whose real target escapes it) throws a bounded
// ADAPTER_PATH_OUTSIDE_REPOSITORY error rather than being silently read.
//
// Roadmap FPI-3B: an optional `frameworkRuntimeConfig` (plus the
// `currentProjectId` collect-context.js's main() already threads into
// EVERY adapter alongside `root`, unconditionally, since Roadmap FPI-3A -
// no collect-context.js change was needed for this) adds ONE new
// precedence tier, BETWEEN an explicit override and the historical
// hardcoded default:
//
//   explicit reportFile override (unchanged, highest)
//   → frameworkRuntimeConfig.reports.reportFile, if a config was supplied
//   → historical hardcoded default ("reports/playwright/report.json")
//
// A caller that supplies no frameworkRuntimeConfig at all sees byte-
// identical pre-FPI-3B behavior - resolveFrameworkRuntimeConfigReportFile()
// returns null immediately and the ternary/fallback below resolves
// exactly as it already did. The config candidate string is never
// treated as filesystem authority itself - it flows through the SAME
// resolveRepositoryLocalPath() canonical containment gate an explicit
// override already uses, unchanged below.
function collect({ root, reportFile, frameworkRuntimeConfig, currentProjectId } = {}) {
  const configReportFile = resolveFrameworkRuntimeConfigReportFile(frameworkRuntimeConfig, currentProjectId);
  const effectiveReportFile = reportFile || configReportFile;

  const resolvedReportFile = effectiveReportFile
    ? resolveRepositoryLocalPath(effectiveReportFile, root, "playwright-adapter.collect(): reportFile")
    : path.join(root.realRoot, "reports", "playwright", "report.json");
  const { report, warnings } = loadReport(resolvedReportFile, root);

  if (!report) {
    return { testResults: { found: false }, failedTests: [], warnings };
  }

  const entries = walkReportSuites(report.suites, warnings, root);
  const testResults = summarizeTestResults(entries, warnings);
  const failedTests = extractFailedTests(entries, warnings, root);

  // Top-level errors[] are not attached to any individual test (e.g. a
  // global setup failure) - never fabricated into a fake failedTests
  // entry; only a deterministic, count-only warning, never raw stacks.
  if (Array.isArray(report.errors) && report.errors.length > 0) {
    warnings.push(`Playwright report contains ${report.errors.length} top-level error(s) not attached to any individual test.`);
  }

  return { testResults, failedTests, warnings };
}

module.exports = {
  id,
  collect,
  loadReport,
  walkReportSuites,
  classifyTestStatus,
  selectPrimaryResult,
  summarizeTestResults,
  extractFailedTests,
  resolveFrameworkRuntimeConfigReportFile,
};
