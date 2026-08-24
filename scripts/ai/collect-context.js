#!/usr/bin/env node
/**
 * Failure Context Collector
 *
 * Reads the mochawesome JSON report(s) produced by `cypress run` (via the
 * Cypress adapter, see scripts/ai/adapters/cypress-adapter.js), extracts
 * failed tests, and writes a single small, LLM-safe JSON file to
 * reports/ai/context.json describing what failed and the minimal source
 * needed to reason about it.
 *
 * No network calls. No AI API calls. No secrets are read.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const { normalizeSpecPath } = require("./context-utils");
const cypressAdapter = require("./adapters/cypress-adapter");

const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(ROOT, "reports", "ai");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "context.json");

// Keeps the collected context small and safe to hand to an LLM later.
const MAX_FILE_BYTES = 20 * 1024;
const MAX_TOTAL_RELEVANT_BYTES = 150 * 1024;

// This repository's single production project (see
// scripts/ai/project-profile.js, Roadmap #19.2). Stable project
// identity and known-constraint text are owned by that module, not here -
// this file only consumes it (project identity/constraints, never a
// classification shortcut - see qa-agent-prompt.js rule 9).
const PROJECT_PROFILE = TARGOMO_PROJECT_PROFILE;

// Never read these, even if something inside an allowed policy directory
// somehow imports them (e.g. a future cypress.env.json or a stray .env in
// cypress/). Framework-neutral - the same denylist applies to every policy
// below, and no policy may bypass it.
const DENYLIST_PATTERN = /(^|[\\/])\.env|secret|credential|\.pem$|\.key$|token/i;

// Roadmap #21C: RelevantFiles source policy is now selected by the active
// framework's own canonical identity (adapter.id / context.metadata.framework
// - see main() below), never a single global Cypress-only allowlist. This
// stays a small, closed, positive-allowlist map keyed by frameworkId - not a
// plugin/registry/config-driven system - the same "only what is explicitly
// named here is ever eligible" posture qa-agent-prompt.js's
// PROMPT_METADATA_ALLOWLIST already established for the prompt-projection
// boundary. An unrecognized frameworkId gets no policy at all (see
// getRelevantFilesPolicy()) - it is never silently treated as Cypress, and
// it never falls back to scanning the repository generically.
//
// `allowedDirs`: only files under these repo-relative roots (or exactly
// matching one of `alwaysCollectFiles`) are ever read into relevantFiles,
// even if an import resolves elsewhere - a defensive boundary, not just a
// convenience filter (unchanged in spirit from the pre-#21C single
// ALLOWED_DIRS/ALLOWED_FILES pair).
//
// `alwaysCollectFiles`: unconditionally attempted regardless of whether any
// test actually failed inside that framework's own directory - baseline
// project context (config/deps), exactly like the pre-#21C behavior for
// Cypress, but now scoped to the framework that actually produced this run's
// evidence rather than being hardcoded for every framework.
//
// `resolveSpecCandidates(specRelPath)`: given one already-adapter-normalized
// failedTests[].specFile value, returns the ordered list of repo-relative
// paths to try reading as that failure's own spec source. Cypress's own
// adapter always normalizes specFile to an already repo-relative path (it
// starts from an absolute on-disk path under ROOT), so no re-rooting is ever
// needed. Playwright is different: Roadmap #21B's real-installed-@playwright/
// test 1.62.1 reporter proof empirically observed spec.file reported
// relative to Playwright's own testDir ("proof.spec.js", no directory at
// all) rather than repo-relative - so a Playwright specFile that isn't
// already inside the explicit playwright/ source root is also tried
// re-rooted under it. Every candidate this function returns is still fully
// re-verified by isPathAllowed()'s resolved-absolute-path containment check
// below before anything is ever read - this can never grant a broader read
// than the explicit playwright/ directory, regardless of what a candidate
// string looks like (a "../" segment anywhere in specRelPath, however it
// entered failedTests, is resolved away and rejected there, never trusted
// here).
const RELEVANT_FILES_POLICIES = Object.freeze({
  cypress: Object.freeze({
    allowedDirs: Object.freeze(["cypress"]),
    alwaysCollectFiles: Object.freeze(["cypress.config.js", "package.json"]),
    resolveSpecCandidates: (specRelPath) => [specRelPath],
  }),
  playwright: Object.freeze({
    allowedDirs: Object.freeze(["playwright"]),
    alwaysCollectFiles: Object.freeze(["playwright.config.js", "package.json"]),
    resolveSpecCandidates: (specRelPath) => {
      const candidates = [specRelPath];
      if (specRelPath !== "playwright" && !specRelPath.startsWith("playwright/")) {
        candidates.push(`playwright/${specRelPath}`);
      }
      return candidates;
    },
  }),
});

// Never a partial match, never a default - a frameworkId absent from
// RELEVANT_FILES_POLICIES (including one that predates this map, or one this
// repository has simply never defined a source policy for) gets null,
// handled explicitly and fail-closed by buildRelevantFiles() below.
function getRelevantFilesPolicy(frameworkId) {
  return RELEVANT_FILES_POLICIES[frameworkId] || null;
}

function log(message) {
  process.stdout.write(`[ai:collect] ${message}\n`);
}

function runGit(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// Roadmap #19.9B: frameworkId is now a parameter (defaulting to the
// Cypress adapter's own identity, exactly the pre-#19.9B behavior for
// every existing zero-argument caller) rather than a hardcoded reference
// to cypressAdapter.id inline - main() passes the ACTIVE adapter's own
// id here, so metadata.framework always reflects whichever adapter
// actually produced this run's evidence, never a second, independently-
// derived framework guess. One active adapter, one framework identity.
function getMetadata(frameworkId = cypressAdapter.id) {
  const lifecycleEvent = process.env.npm_lifecycle_event || "";
  const browserFromLifecycle = ["chrome", "firefox", "edge"].includes(lifecycleEvent)
    ? lifecycleEvent
    : null;

  return {
    // Stable, machine-readable project identity (Roadmap #19.2) - always
    // this repository's single production project today; see
    // scripts/ai/project-profile.js for the single source of
    // truth this value is read from.
    projectId: PROJECT_PROFILE.id,
    framework: frameworkId,
    repository: process.env.GITHUB_REPOSITORY || runGit(["remote", "get-url", "origin"]) || null,
    commit: process.env.GITHUB_SHA || runGit(["rev-parse", "HEAD"]) || null,
    branch:
      process.env.GITHUB_HEAD_REF ||
      process.env.GITHUB_REF_NAME ||
      runGit(["rev-parse", "--abbrev-ref", "HEAD"]) ||
      null,
    runId: process.env.GITHUB_RUN_ID || null,
    event: process.env.GITHUB_EVENT_NAME || null,
    // No GitHub Actions env var carries the Cypress --browser flag, so the
    // workflow sets TEST_BROWSER from matrix.browser explicitly; BROWSER/
    // CYPRESS_BROWSER and the npm script name are best-effort fallbacks
    // for local runs.
    browser:
      process.env.TEST_BROWSER || process.env.BROWSER || process.env.CYPRESS_BROWSER || browserFromLifecycle || null,
    ci: process.env.CI === "true" || process.env.CI === "1",
  };
}

// Resolved-absolute-path containment check, not a string-prefix check on
// the normalized relative form - immune to a "../" segment anywhere in the
// input that would otherwise still superficially start with an allowed
// directory's own name as a literal string. path.resolve() collapses any
// ".." before the comparison ever runs, so an out-of-policy path can never
// pass merely because its un-resolved string happens to begin the same way.
function isUnderAllowedDir(absPath, allowedDirs) {
  const resolved = path.resolve(absPath);
  return allowedDirs.some((dir) => {
    const dirAbs = path.resolve(ROOT, dir);
    return resolved === dirAbs || resolved.startsWith(dirAbs + path.sep);
  });
}

// `policy` is required (see getRelevantFilesPolicy()) - a missing/falsy
// policy fails closed (false), it is never treated as "no restriction."
function isPathAllowed(absPath, policy) {
  if (!policy) return false;
  const rel = normalizeSpecPath(absPath);
  if (!rel) return false;
  if (DENYLIST_PATTERN.test(rel)) return false;

  const resolved = path.resolve(absPath);
  if (policy.alwaysCollectFiles.some((file) => path.resolve(ROOT, file) === resolved)) return true;

  return isUnderAllowedDir(absPath, policy.allowedDirs);
}

function readFileSafe(absPath, policy) {
  try {
    if (!isPathAllowed(absPath, policy)) return null;
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;

    const buffer = fs.readFileSync(absPath);
    const truncated = buffer.length > MAX_FILE_BYTES;
    const content = truncated
      ? `${buffer.subarray(0, MAX_FILE_BYTES).toString("utf8")}\n/* ...truncated... */`
      : buffer.toString("utf8");

    return { content, truncated };
  } catch {
    return null;
  }
}

// Best-effort static import resolver for the two module styles used in
// this repo's page objects/specs: ES `import ... from '...'` and CommonJS
// `require('...')`. Only relative imports are followed (bare/package
// imports like "cypress" are irrelevant to failure context).
function resolveLocalImports(sourceCode, fromDir) {
  const importPattern = /(?:from\s+|require\()\s*['"](\.[^'"]+)['"]/g;
  const resolved = new Set();
  let match;

  while ((match = importPattern.exec(sourceCode)) !== null) {
    const specifier = match[1];
    const base = path.resolve(fromDir, specifier);
    const candidates = [base, `${base}.js`, path.join(base, "index.js")];

    const found = candidates.find((candidate) => {
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });

    if (found) resolved.add(found);
  }

  return [...resolved];
}

// `frameworkId` is the same canonical identity metadata.framework already
// carries (adapter.id - see main() below), never independently re-derived
// from a file extension, report path, or other heuristic (Roadmap #21C
// Phase 8). A frameworkId with no defined policy yields an empty
// relevantFiles and a bounded, path-free warning - fail-closed for source
// evidence, never a silent fallback to Cypress's own policy or a generic
// repository scan.
function buildRelevantFiles(failedTests, warnings, frameworkId) {
  const policy = getRelevantFilesPolicy(frameworkId);
  if (!policy) {
    warnings.push(`No relevantFiles source policy exists for framework "${frameworkId}"; relevantFiles will be empty.`);
    return {};
  }

  const files = {};
  let totalBytes = 0;

  const addFile = (absPath) => {
    const rel = normalizeSpecPath(absPath);
    if (!rel || files[rel]) return;

    if (totalBytes >= MAX_TOTAL_RELEVANT_BYTES) {
      warnings.push(`relevantFiles size cap reached; skipped ${rel}.`);
      return;
    }

    const result = readFileSafe(absPath, policy);
    if (!result) return;

    files[rel] = result;
    totalBytes += result.content.length;
  };

  // Test runner config and package.json give the AI step baseline project
  // context (browser/base URL config, available scripts/deps) - scoped to
  // whichever framework actually produced this run's evidence.
  for (const configFile of policy.alwaysCollectFiles) {
    addFile(path.join(ROOT, configFile));
  }

  const specPaths = new Set(failedTests.map((t) => t.specFile).filter(Boolean));

  for (const specRelPath of specPaths) {
    let specResult = null;
    let specAbsPath = null;
    for (const candidate of policy.resolveSpecCandidates(specRelPath)) {
      const candidateAbsPath = path.join(ROOT, candidate);
      const candidateResult = readFileSafe(candidateAbsPath, policy);
      if (candidateResult) {
        specResult = candidateResult;
        specAbsPath = candidateAbsPath;
        break;
      }
    }
    if (!specResult) {
      warnings.push(`Failed spec source not found on disk: ${specRelPath}`);
      continue;
    }
    addFile(specAbsPath);

    const imports = resolveLocalImports(specResult.content, path.dirname(specAbsPath));
    for (const importedAbsPath of imports) {
      addFile(importedAbsPath);
    }
  }

  return files;
}

// Roadmap #19.9B: main() now accepts an optional, explicitly injected
// adapter - production's own zero-argument call (see require.main===module
// below) and every existing caller keep getting exactly the Cypress
// adapter's own defaults, byte/semantically unchanged. This is dependency
// injection only, never a framework registry/selector/environment switch:
// there is no string-keyed lookup anywhere, just one opaque adapter object
// passed straight through to its own collect(). adapterOptions is never
// inspected here - framework-specific option names (reportsDir/
// screenshotsDir for Cypress, reportFile for Playwright) stay entirely
// inside each adapter's own contract, never known to this generic
// collector. Exactly one adapter is ever invoked per call - there is no
// mechanism here for two adapters to run within one context.
function main({ adapter = cypressAdapter, adapterOptions } = {}) {
  if (typeof adapter.id !== "string" || adapter.id.length === 0 || typeof adapter.collect !== "function") {
    throw new Error("main(): adapter must have a non-empty string id and a collect() function");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const metadata = getMetadata(adapter.id);
  const adapterResult = adapter.collect(adapterOptions);
  const { testResults, failedTests } = adapterResult;
  // Copied, not mutated in place - Roadmap #19.6B: the adapter's returned
  // result is treated as an immutable contract, even though the resulting
  // warnings *values*/order below are identical to the pre-#19.6B
  // behavior of pushing directly onto loadReports()'s own array.
  const warnings = [...adapterResult.warnings];

  let relevantFiles = {};
  let knownProjectConstraints = [];

  if (failedTests.length > 0) {
    relevantFiles = buildRelevantFiles(failedTests, warnings, adapter.id);
    knownProjectConstraints = PROJECT_PROFILE.knownProjectConstraints;
  }

  const context = {
    generatedAt: new Date().toISOString(),
    metadata,
    testResults,
    failedTests,
    relevantFiles,
    knownProjectConstraints,
    warnings,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(context, null, 2));

  log(
    `wrote ${path.relative(ROOT, OUTPUT_FILE)} ` +
      `(${failedTests.length} failed test(s), ${Object.keys(relevantFiles).length} relevant file(s))`
  );
  for (const warning of warnings) {
    log(`warning: ${warning}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  isPathAllowed,
  readFileSafe,
  resolveLocalImports,
  buildRelevantFiles,
  getMetadata,
  getRelevantFilesPolicy,
  RELEVANT_FILES_POLICIES,
  main,
};
