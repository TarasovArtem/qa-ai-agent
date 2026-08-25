#!/usr/bin/env node
/**
 * Browser input aggregator for the centralized QA AI triage job.
 *
 * Each Cypress browser job (cypress-tests' chrome/edge matrix legs, plus
 * the standalone firefox-tests job since Roadmap #14C) uploads its own
 * small, browser-scoped artifact (browser-result.json always; context.json/
 * history.json only when that leg actually failed - see
 * .github/workflows/cypress.yml). This script runs downstream, after every
 * browser job has finished, once their artifacts have been downloaded into
 * reports/ai/browser-inputs/<id>/:
 *
 *   read every job's result -> decide whether ANY of them failed ->
 *   if so, deterministically pick ONE primary failing job -> copy
 *   its context.json/history.json into the exact paths analyze-failure.js
 *   already reads (reports/ai/context.json, reports/ai/history.json).
 *
 * This is intentionally a "pick one, don't merge" strategy, not a
 * multi-browser reasoning layer: analyze-failure.js, qa-agent-prompt.js,
 * and the provider contract are completely unaware this file exists and
 * need zero changes - they still see exactly the single-context.json
 * shape they always have. The result is that "AI provider.analyze()" is
 * called at most once per workflow run by construction, since there is
 * now exactly one place (this script, feeding the unmodified
 * analyze-failure.js) where that can happen at all - not because of any
 * new locking/dedup logic.
 *
 * Other jobs that also failed are not silently dropped - they're logged
 * (this script's own stdout) so a human reading CI logs can see "chrome
 * was analyzed, edge also failed" - and, since PR #33, also summarized as
 * deterministic "browserCorrelation" metadata (which browsers ran, which
 * failed/passed, single- vs multi-browser scope, and whether failed
 * browsers share the same evidence signature) attached to the primary
 * browser's context.json before analyze-failure.js ever runs.
 *
 * Roadmap #21G-C1 (evidence-semantics correction): browserCorrelation was
 * originally designed, and its own sameFailureSignature comparison only
 * makes sense, for the SAME test suite executed across multiple browser
 * engines of the SAME framework (Cypress's own cypress/e2e/** run on
 * chrome/edge/firefox) - an independent framework's job (Playwright's own,
 * unrelated smoke) is not a valid member of that comparison: its PASS does
 * not mean "the same test passed in another browser", and its FAIL does
 * not mean "the same failure occurred in another browser" (#21G-R found
 * this could be represented in a way that risked over-weighting an
 * unrelated framework's outcome as same-kind browser corroboration).
 * Every input now carries an explicit, trusted `framework` field (never
 * inferred by parsing a browser name - see .github/workflows/cypress.yml's
 * "Record browser result"/"Record Playwright browser result" steps, which
 * write it as a static literal known to the workflow itself). Two
 * separate, independently-scoped outputs now exist:
 *
 *   - browserCorrelation: restricted to inputs sharing the SELECTED
 *     primary's own framework only (buildBrowserCorrelation() itself is
 *     completely unchanged - callers now simply pass it an already
 *     same-framework-filtered array, so byte-for-byte output for any
 *     Cypress-only input set, including every pre-#21G-C1 test, is
 *     unaffected by construction).
 *   - frameworkCorrelation: a small, separate, explicitly-named
 *     workflow-level rollup (see buildFrameworkCorrelation()) truthfully
 *     stating which frameworks ran and whether each one's jobs, as a
 *     whole, passed or failed - never same-test evidence, never fed into
 *     sameFailureSignature, never merged into browserCorrelation.
 *
 * Still a "pick one context, don't merge results" strategy, not a
 * multi-browser (or multi-framework) reasoning layer of its own: both
 * correlation objects are computed here, deterministically, from the CI's
 * own recorded outcomes - never by an LLM - and are handed to the model as
 * evidence alongside the primary failure, never as a second analysis
 * target. "AI provider.analyze()" is still called at most once per
 * workflow run, by the same construction as before (this script feeds one
 * context object to the unmodified analyze-failure.js).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_BROWSER_INPUTS_DIR = path.join(ROOT, "reports", "ai", "browser-inputs");
const CONTEXT_FILE = path.join(ROOT, "reports", "ai", "context.json");
const HISTORY_FILE = path.join(ROOT, "reports", "ai", "history.json");

// Matches the CI browsers declared in .github/workflows/cypress.yml
// (cypress-tests' matrix: [chrome, edge], plus firefox-tests since
// Roadmap #14C, plus playwright-tests since Roadmap #21G) - also doubles
// as the default priority order used to deterministically pick a primary
// browser when more than one failed, so the same input always yields the
// same choice. This is also the list readBrowserInputs() below actually
// looks for artifact directories under when main() calls it with no
// arguments (the real production path) - a browser missing from this list
// is invisible to aggregation entirely, not just deprioritized, regardless
// of whether that browser's job and artifact upload actually ran.
//
// Roadmap #21G: "playwright-chromium" is deliberately last - Cypress
// remains the zero-configuration/default framework (Roadmap #21E), so if
// Cypress AND Playwright both fail in the same run, a Cypress browser is
// still selected as primary, exactly as adding firefox last did not
// change chrome/edge's own relative priority. Playwright's failure is
// never silently dropped when it isn't primary - it is always represented
// truthfully in the deterministic browserCorrelation metadata below (see
// buildBrowserCorrelation()), the same "pick one, don't merge" contract
// that already applies to any two Cypress browsers both failing. This
// entry is not a real browser name - it is this workflow's own stable,
// self-documenting identity for the single Playwright Chromium CI job
// (never confused with a hypothetical future Cypress "chromium" entry,
// and distinct from metadata.framework/metadata.browser, which are set
// independently by the framework-neutral collector - see
// collect-context.js's getMetadata()).
const DEFAULT_BROWSER_PRIORITY = ["chrome", "edge", "firefox", "playwright-chromium"];

function log(message) {
  process.stdout.write(`[ai:aggregate] ${message}\n`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Reads every known browser's downloaded input directory. A browser whose
// browser-result.json is missing or unreadable (artifact never uploaded,
// download failed, etc.) is simply left out of the returned list rather
// than treated as a failure or a crash - the decision functions below only
// ever reason about browsers we actually have a real outcome for.
//
// Roadmap #21G-C1: `framework` is read straight from the trusted
// browser-result.json the workflow itself writes (a static literal known
// to the workflow, never inferred by parsing `browser`/the directory
// name - see the module comment). Its absence defaults to "cypress" only
// for backward compatibility with the pre-#21G-C1 browser-result.json
// shape (browser+outcome only, no framework field) - every job this
// workflow actually runs today writes it explicitly, so this default is
// never the source of truth in production, only a compatibility fallback.
function readBrowserInputs(baseDir = DEFAULT_BROWSER_INPUTS_DIR, browsers = DEFAULT_BROWSER_PRIORITY) {
  const inputs = [];

  for (const id of browsers) {
    const dir = path.join(baseDir, id);
    const result = readJsonIfExists(path.join(dir, "browser-result.json"));
    if (!result || (result.outcome !== "success" && result.outcome !== "failure")) continue;

    inputs.push({
      browser: result.browser || id,
      framework: result.framework || "cypress",
      outcome: result.outcome,
      context: readJsonIfExists(path.join(dir, "context.json")),
      history: readJsonIfExists(path.join(dir, "history.json")),
    });
  }

  return inputs;
}

// Pure decision: is there any E2E failure at all across the browsers we
// have data for? Never uses an LLM to answer this - it's a plain boolean
// derived from Cypress's own recorded outcome.
function shouldRunAiTriage(browserInputs) {
  return browserInputs.some((b) => b.outcome === "failure");
}

// Deterministically picks ONE failing browser to actually analyze,
// following priorityOrder. Falls back to the first failing browser found
// if none of the failing browsers are in priorityOrder (e.g. a matrix
// entry added later that this list hasn't been updated for yet) - failing
// open to "still run triage" rather than silently skipping it.
function selectPrimaryFailure(browserInputs, priorityOrder = DEFAULT_BROWSER_PRIORITY) {
  for (const browser of priorityOrder) {
    const match = browserInputs.find((b) => b.browser === browser && b.outcome === "failure");
    if (match) return match;
  }
  return browserInputs.find((b) => b.outcome === "failure") || null;
}

// Stable, array-based ordering: known browsers first (in priorityOrder),
// then any unrecognized ones alphabetically - so a future browser added to
// the matrix before this list is updated still sorts deterministically
// instead of depending on artifact-download/filesystem enumeration order.
function orderByPriority(browsers, priorityOrder) {
  const prioritized = priorityOrder.filter((b) => browsers.includes(b));
  const rest = browsers.filter((b) => !priorityOrder.includes(b)).sort();
  return [...prioritized, ...rest];
}

// error.message normalization only - deliberately NOT fuzzy/AI matching,
// just enough to avoid a trivial whitespace difference producing a false
// "different signature". Case and wording are otherwise compared exactly.
function normalizeForSignature(text) {
  return typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
}

// One browser's failure "signature": the sorted set of
// spec+test+normalized-error-message triples for every test it reported as
// failed. null (not an empty array) when that browser has no usable
// context/failedTests at all, so the caller can tell "no failures" apart
// from "we have no evidence to compare".
function buildFailureSignatureSet(browserContext) {
  const failedTests = (browserContext && browserContext.failedTests) || [];
  if (failedTests.length === 0) return null;

  return failedTests
    .map((t) => `${t.specFile || ""}::${t.fullTitle || t.title || ""}::${normalizeForSignature(t.error && t.error.message)}`)
    .sort();
}

function sameSignatureSet(a, b) {
  return a.length === b.length && a.every((sig, i) => sig === b[i]);
}

// Deterministic cross-browser comparison, scoped to THIS workflow run only
// (no persistent/cross-run fingerprint storage - see the module comment).
// Returns true/false only when every failed browser has comparable
// evidence; null ("unknown") whenever there are fewer than two failed
// browsers to compare, or any of them is missing usable failedTests data -
// never forced to false for lack of evidence.
function computeSameFailureSignature(browserInputs, failedBrowsers) {
  if (failedBrowsers.length < 2) return null;

  const signatureSets = failedBrowsers.map((browser) => {
    const input = browserInputs.find((b) => b.browser === browser);
    return buildFailureSignatureSet(input && input.context);
  });

  if (signatureSets.some((set) => set === null)) return null;

  const [first, ...rest] = signatureSets;
  return rest.every((set) => sameSignatureSet(first, set));
}

// Deterministic application-logic correlation metadata (see PR #33): built
// entirely from Cypress's own recorded per-browser outcomes, never by an
// LLM. Array-based throughout so this naturally extends to a future third
// (or Nth) browser without any chrome/edge-specific branching - only
// DEFAULT_BROWSER_PRIORITY's *ordering* still favors chrome/edge today.
function buildBrowserCorrelation(browserInputs, primary, priorityOrder = DEFAULT_BROWSER_PRIORITY) {
  const browsers = orderByPriority(browserInputs.map((b) => b.browser), priorityOrder);
  const failedBrowsers = orderByPriority(
    browserInputs.filter((b) => b.outcome === "failure").map((b) => b.browser),
    priorityOrder
  );
  const passedBrowsers = orderByPriority(
    browserInputs.filter((b) => b.outcome === "success").map((b) => b.browser),
    priorityOrder
  );
  const primaryBrowser = primary ? primary.browser : null;
  const additionalFailedBrowsers = failedBrowsers.filter((b) => b !== primaryBrowser);

  return {
    browsers,
    failedBrowsers,
    passedBrowsers,
    primaryBrowser,
    additionalFailedBrowsers,
    failureScope: failedBrowsers.length > 1 ? "multi-browser" : "single-browser",
    sameFailureSignature: computeSameFailureSignature(browserInputs, failedBrowsers),
  };
}

// Roadmap #21G-C1: the priority order for frameworks themselves (which
// framework's rollup appears first in frameworkCorrelation.outcomes) -
// deliberately separate from DEFAULT_BROWSER_PRIORITY (which orders
// individual browser/job entries within one framework's own
// browserCorrelation). Cypress first, matching its own established
// zero-configuration/default status (Roadmap #21E) everywhere else in
// this codebase.
const FRAMEWORK_PRIORITY = ["cypress", "playwright"];

// Workflow-level, cross-framework rollup - deliberately NOT same-test
// evidence (see the module comment's Roadmap #21G-C1 section). For each
// distinct framework actually present in browserInputs, states only
// whether ANY of that framework's jobs failed - never which test, never
// an error message, never a path. Consumed by qa-agent-prompt.js under an
// explicit rule instructing the model this is workflow-level evidence
// only, never proof of equivalent test coverage.
function buildFrameworkCorrelation(browserInputs, primaryFramework) {
  const byFramework = new Map();
  for (const input of browserInputs) {
    const framework = input.framework || "cypress";
    if (!byFramework.has(framework)) byFramework.set(framework, []);
    byFramework.get(framework).push(input);
  }

  const orderedFrameworks = orderByPriority([...byFramework.keys()], FRAMEWORK_PRIORITY);
  const outcomes = orderedFrameworks.map((framework) => ({
    framework,
    outcome: byFramework.get(framework).some((i) => i.outcome === "failure") ? "failure" : "success",
  }));

  return { primaryFramework, outcomes };
}

// Roadmap #21H (D21G-2): the workflow's own trusted framework descriptor
// (primary.framework - a static literal a workflow step writes because it
// KNOWS which framework that job runs, see .github/workflows/cypress.yml's
// "Record browser result"/"Record Playwright browser result" steps) and
// the adapter-derived runtime identity (primary.context.metadata.framework
// - set by getMetadata() from the SELECTED adapter's own .id, see
// collect-context.js) are two INDEPENDENTLY DERIVED statements about the
// exact same job's framework identity, not two competing canonical
// sources a caller may pick between. In the current, correctly-wired
// workflow they can never actually disagree, because both are authored
// together for the same job block - but #21G-R2 demonstrated that nothing
// in this file's own code enforced that, so a future editing mistake
// (e.g. a job's QA_FRAMEWORK env var updated without also updating its
// "framework" literal) could silently produce a context.json whose
// metadata.framework and frameworkCorrelation.primaryFramework disagree.
// This is a fail-closed consistency check, not a resolution/precedence
// rule: when a genuinely comparable context exists and its adapter-
// derived identity disagrees with the trusted descriptor, this is a
// workflow/evidence contract violation, and the caller must refuse to
// treat that evidence as analyzable - never silently prefer one identity
// over the other.
// Roadmap #21J-A (D21H-1): mirrors analyze-failure.js's own
// classifyFrameworkId() ABSENT/INVALID/VALID vocabulary for the exact same
// context.metadata.framework field (own-property check, never a bare
// truthy/typeof check that would also swallow an explicitly-set falsy
// value like 0/false/""). ABSENT means the property genuinely was never
// set at all - nothing to compare, legacy-compatible. INVALID means the
// property IS present but is not a usable non-empty string (e.g. 0, true,
// {}, [], "") - this is comparable-but-untrustworthy evidence, never
// "nothing to compare": #21G-R2/#21H's own check previously collapsed
// both cases toward absent, meaning a present-but-malformed
// metadata.framework was silently treated as if it agreed with whatever
// the descriptor said, rather than as an unresolvable contradiction.
function classifyContextFrameworkValue(metadata) {
  const hasProperty = Boolean(metadata) && Object.prototype.hasOwnProperty.call(metadata, "framework");
  if (!hasProperty) return { state: "absent", value: null };

  const raw = metadata.framework;
  if (typeof raw !== "string" || raw.trim().length === 0) return { state: "invalid", rawType: typeof raw };

  return { state: "valid", value: raw };
}

function checkFrameworkIdentityConsistency(primary) {
  if (!primary) {
    return { consistent: true, descriptorFramework: null, contextFramework: null };
  }

  const descriptorFramework = primary.framework || "cypress";

  // A framework-level failure can genuinely have no analyzable context at
  // all (a setup/report failure before any test ran - see the existing
  // "no usable context.json" path in main()). That is absent evidence,
  // not contradictory evidence - nothing to compare, so this is never
  // treated as a mismatch.
  const classification = classifyContextFrameworkValue(primary.context && primary.context.metadata);

  if (classification.state === "absent") {
    return { consistent: true, descriptorFramework, contextFramework: null };
  }

  if (classification.state === "invalid") {
    // Present but unusable evidence must never be treated as consistent -
    // that would let a malformed adapter/context value silently pass as if
    // it agreed with the trusted descriptor. contextFramework is
    // deliberately a bounded type description here, never the raw value
    // itself, so a crafted object/long string can never be echoed into
    // this result and therefore into main()'s own bounded log line.
    return { consistent: false, descriptorFramework, contextFramework: `<invalid:${classification.rawType}>` };
  }

  return { consistent: descriptorFramework === classification.value, descriptorFramework, contextFramework: classification.value };
}

// Composes the decisions above into the one result main() (and tests)
// actually need: whether to run at all, which browser is primary, which
// other SAME-FRAMEWORK browsers also failed (logged only - never
// separately analyzed), the deterministic same-framework browser
// correlation metadata, and the separate cross-framework rollup - to
// attach to the primary context before it reaches the AI provider.
//
// Roadmap #21G-C1: browserCorrelation is built from ONLY the inputs that
// share the selected primary's own framework - buildBrowserCorrelation()
// itself is unchanged; it simply never sees a cross-framework entry, so
// its sameFailureSignature/failureScope computations can never compare or
// count across frameworks. frameworkCorrelation is built from the FULL,
// unfiltered browserInputs, independently.
//
// Roadmap #21H (D21G-2): a detected identity mismatch (see
// checkFrameworkIdentityConsistency() above) fails closed by returning
// primary: null with identityMismatch populated - main() below already
// refuses to write context.json or run analysis whenever primary (or its
// context) is null, the exact same safe branch a genuinely-missing
// context already takes, so this can never reach the AI provider. No new
// call site, no new bypassable check - the existing "cannot run AI
// triage" guard is what actually enforces this.
function aggregateBrowserInputs(browserInputs, priorityOrder = DEFAULT_BROWSER_PRIORITY) {
  if (!shouldRunAiTriage(browserInputs)) {
    return { shouldRun: false, primary: null, otherFailedBrowsers: [], correlation: null, frameworkCorrelation: null, identityMismatch: null };
  }

  const primary = selectPrimaryFailure(browserInputs, priorityOrder);
  const identity = checkFrameworkIdentityConsistency(primary);

  if (!identity.consistent) {
    return {
      shouldRun: true,
      primary: null,
      otherFailedBrowsers: [],
      correlation: null,
      frameworkCorrelation: null,
      identityMismatch: { descriptorFramework: identity.descriptorFramework, contextFramework: identity.contextFramework },
    };
  }

  const primaryFramework = primary ? primary.framework || "cypress" : null;
  const sameFrameworkInputs = browserInputs.filter((b) => (b.framework || "cypress") === primaryFramework);

  const otherFailedBrowsers = sameFrameworkInputs
    .filter((b) => b.outcome === "failure" && (!primary || b.browser !== primary.browser))
    .map((b) => b.browser);
  const correlation = buildBrowserCorrelation(sameFrameworkInputs, primary, priorityOrder);
  const frameworkCorrelation = buildFrameworkCorrelation(browserInputs, primaryFramework);

  return { shouldRun: true, primary, otherFailedBrowsers, correlation, frameworkCorrelation, identityMismatch: null };
}

function main() {
  const browserInputs = readBrowserInputs();
  const { shouldRun, primary, otherFailedBrowsers, correlation, frameworkCorrelation, identityMismatch } = aggregateBrowserInputs(browserInputs);

  if (!shouldRun) {
    log("No E2E failures detected; AI triage skipped.");
    return;
  }

  // Roadmap #21H (D21G-2): a bounded, framework-name-only log line - never
  // the full context, paths, test errors, or environment - distinguishing
  // this fail-closed case from the generic "no usable context.json" one
  // below for anyone reading CI logs. The actual safety guarantee (no
  // context.json written, no analysis, no provider call) already comes
  // from primary being null here, which the very next guard below already
  // catches - this branch only exists for a clearer diagnostic message.
  if (identityMismatch) {
    log(
      `Framework identity mismatch detected (workflow descriptor said '${identityMismatch.descriptorFramework}', ` +
        `but the collected context's own metadata.framework said '${identityMismatch.contextFramework}') - refusing to treat this as analyzable evidence.`
    );
    return;
  }

  if (!primary || !primary.context) {
    log(
      `A browser reported failure (${browserInputs
        .filter((b) => b.outcome === "failure")
        .map((b) => b.browser)
        .join(", ") || "unknown"}) but no usable context.json was found for it - cannot run AI triage.`
    );
    return;
  }

  // Still "pick one context" (primary.context's failedTests/relevantFiles/
  // etc. are untouched) - only two new fields are added, so
  // analyze-failure.js/qa-agent-prompt.js only need to opt into reading
  // them, never to change how they read everything else already on
  // context.json. browserCorrelation (same-framework only, see above) and
  // frameworkCorrelation (cross-framework rollup, see above) are
  // deliberately separate fields - never merged into one structure.
  const contextWithCorrelation = { ...primary.context, browserCorrelation: correlation, frameworkCorrelation };

  fs.mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(contextWithCorrelation, null, 2));
  if (primary.history) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(primary.history, null, 2));
  }

  const otherNote = otherFailedBrowsers.length
    ? ` Also failed: ${otherFailedBrowsers.join(", ")} (not separately analyzed in this run).`
    : "";
  log(`Selected '${primary.browser}' as the primary failing browser for AI triage.${otherNote}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  readBrowserInputs,
  shouldRunAiTriage,
  selectPrimaryFailure,
  classifyContextFrameworkValue,
  checkFrameworkIdentityConsistency,
  aggregateBrowserInputs,
  buildBrowserCorrelation,
  buildFrameworkCorrelation,
  DEFAULT_BROWSER_PRIORITY,
  FRAMEWORK_PRIORITY,
};
