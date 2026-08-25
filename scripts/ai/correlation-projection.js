/**
 * Roadmap #21H (D21G-3): explicit, bounded, field-by-field projection for
 * the two correlation evidence objects aggregate-browser-context.js
 * produces (browserCorrelation, frameworkCorrelation) - the single shared
 * definition of "what is actually allowed to become model/report-visible"
 * for both, used identically by analyze-failure.js's pickSourceContext()
 * and qa-agent-prompt.js's buildUserPrompt() so the two consumers can
 * never drift apart on what they consider safe.
 *
 * Before this file existed, both consumers read the producer's object with
 * a bare `context.browserCorrelation ?? null` / `context.frameworkCorrelation
 * ?? null` passthrough - safe in practice only because the real producer
 * (aggregate-browser-context.js) always constructs a bounded object from
 * scratch, never because the boundary itself enforced anything (#21G-R2
 * demonstrated a hand-crafted context.json could smuggle arbitrary extra
 * properties straight through to the model and the final report). This
 * file is that enforcement: every field is explicitly re-typed here: never
 * a bulk object/array spread of untrusted input.
 */

"use strict";

// Roadmap #21G-C1's own closed trusted vocabulary (see
// aggregate-browser-context.js's FRAMEWORK_PRIORITY / DEFAULT_BROWSER_PRIORITY
// and collect-context.js's adapter identities) - the only framework/outcome
// values the real producer ever actually emits.
const ALLOWED_FRAMEWORKS = new Set(["cypress", "playwright"]);
const ALLOWED_OUTCOMES = new Set(["success", "failure"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Bounded projection for one frameworkCorrelation.outcomes[] entry - only
// {framework, outcome}, and only from the closed vocabulary above. An
// entry with an unrecognized framework/outcome, wrong types, or extra
// properties is dropped from the array entirely rather than partially
// forwarded - a malformed/tampered entry should never leak unbounded
// content into the prompt just because some of its fields happened to
// validate.
function projectFrameworkOutcome(raw) {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.framework !== "string" || !ALLOWED_FRAMEWORKS.has(raw.framework)) return null;
  if (typeof raw.outcome !== "string" || !ALLOWED_OUTCOMES.has(raw.outcome)) return null;
  return { framework: raw.framework, outcome: raw.outcome };
}

// Bounded projection for the top-level frameworkCorrelation object -
// exactly {primaryFramework, outcomes}, nothing else. primaryFramework
// must itself be one of the closed trusted framework values, or null (the
// shouldRun:false/no-primary case) - never an arbitrary string. outcomes
// must be an array; each entry is independently re-validated via
// projectFrameworkOutcome() above, never a bulk spread of the input array.
function projectFrameworkCorrelation(raw) {
  if (!isPlainObject(raw)) return null;

  const primaryFramework =
    raw.primaryFramework === null || (typeof raw.primaryFramework === "string" && ALLOWED_FRAMEWORKS.has(raw.primaryFramework))
      ? raw.primaryFramework
      : null;

  const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes.map(projectFrameworkOutcome).filter((o) => o !== null) : [];

  return { primaryFramework, outcomes };
}

// Bounded projection for the top-level browserCorrelation object - the
// exact same field set buildBrowserCorrelation() has always produced
// (browsers/failedBrowsers/passedBrowsers/primaryBrowser/
// additionalFailedBrowsers/failureScope/sameFailureSignature), re-typed
// explicitly rather than spread wholesale. Browser-name arrays/strings are
// only ever validated for SHAPE/TYPE here (plain strings), never against a
// closed enum like framework/outcome above - real browser names are a
// deliberately open set (chrome/edge/firefox today, a future browser
// tomorrow), so a closed vocabulary would be the wrong kind of boundary
// for this field.
function projectBrowserCorrelation(raw) {
  if (!isPlainObject(raw)) return null;

  const stringArray = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  const stringOrNull = (value) => (typeof value === "string" ? value : null);
  const failureScope = raw.failureScope === "multi-browser" || raw.failureScope === "single-browser" ? raw.failureScope : null;
  // Roadmap #21D-style tri-state preserved explicitly: true/false are
  // genuine comparison results, null means "no comparison could be made" -
  // never conflate an absent/malformed value with false.
  const sameFailureSignature = typeof raw.sameFailureSignature === "boolean" ? raw.sameFailureSignature : null;

  return {
    browsers: stringArray(raw.browsers),
    failedBrowsers: stringArray(raw.failedBrowsers),
    passedBrowsers: stringArray(raw.passedBrowsers),
    primaryBrowser: stringOrNull(raw.primaryBrowser),
    additionalFailedBrowsers: stringArray(raw.additionalFailedBrowsers),
    failureScope,
    sameFailureSignature,
  };
}

module.exports = {
  ALLOWED_FRAMEWORKS,
  ALLOWED_OUTCOMES,
  projectFrameworkOutcome,
  projectFrameworkCorrelation,
  projectBrowserCorrelation,
};
