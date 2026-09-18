/**
 * Single execution-policy authority for regression*.js's exit-code
 * semantics (CRW2-A2, closes A-2).
 *
 * Discovery (see the implementation PR for the full architecture map):
 * regression.js (v1) and regression-v2..v5.js all compute the exact same
 * comparison-status vocabulary - `REGRESSED` / `IMPROVED` / `UNCHANGED` /
 * `BASELINE_MISMATCH` - but decided the resulting exit code inline, in each
 * file's own run(), with an unconditional `exitCode: 0` after a successful
 * comparison (REGRESSED included). regression-v6.js instead computes
 * `exitCode = comparison.baselineMatched ? 0 : 1` (i.e. only UNCHANGED
 * exits 0; REGRESSED, IMPROVED, and BASELINE_MISMATCH all exit 1). ROADMAP's
 * own A-2 finding is precise about what was actually missing: "whether all
 * evaluation/regression dimensions strictly block merges is not yet
 * formally decided/enforced" - not that v1-v5's informational behavior was
 * itself a bug. It is a deliberate, extensively documented design decision
 * (see .github/workflows/cypress.yml's own "QA Agent evaluation" job
 * comment): v1-v5 score QA-failure-triage classification accuracy, an
 * inherently fuzzier, curated-judgment metric where blocking merges on
 * every fluctuation would be actively harmful; v6 scores Test Design
 * quality against a human-reviewed, committed baseline, where any drift -
 * in either direction - requires a deliberate, reviewed baseline update,
 * making a strict gate appropriate. This module makes that decision
 * *explicit, named, and testable* rather than leaving it implicit and
 * duplicated per file - it deliberately does not change v1-v5's or v6's
 * actual CI behavior (see each regression*.js's own updated run(), and the
 * cross-version regression matrix in this module's own test file).
 *
 * Never called for the pre-comparison validation-failure path
 * (dataset/baseline schema errors): every regression*.js already exits 1
 * there, before a comparison ever runs, independently of any policy - that
 * fail-closed behavior is unchanged and out of this module's scope.
 */

"use strict";

const POLICY = Object.freeze({
  STRICT: "STRICT",
  INFORMATIONAL: "INFORMATIONAL",
});

const KNOWN_STATUSES = new Set(["REGRESSED", "IMPROVED", "UNCHANGED", "BASELINE_MISMATCH"]);

/**
 * Maps a regression-comparison `status` plus a named execution policy to a
 * process exit code. Fails closed (non-zero) on any status or policy this
 * module does not recognize - a schema/status vocabulary change elsewhere
 * must never silently start exiting 0.
 *
 * @param {string} status - REGRESSED | IMPROVED | UNCHANGED | BASELINE_MISMATCH
 * @param {string} policy - POLICY.STRICT | POLICY.INFORMATIONAL
 * @returns {{ exitCode: number, reason: string }}
 */
function resolveExitCode(status, policy) {
  if (!KNOWN_STATUSES.has(status)) {
    return { exitCode: 1, reason: `unknown comparison status "${status}" - fails closed, never silently passes` };
  }

  // A sample-set mismatch means the comparison itself could not safely run
  // at all - this is a structural failure, not a regression/improvement
  // verdict, and blocks under every policy.
  if (status === "BASELINE_MISMATCH") {
    return { exitCode: 1, reason: "sample set does not match the baseline - cannot be safely compared" };
  }

  if (policy === POLICY.STRICT) {
    return status === "UNCHANGED"
      ? { exitCode: 0, reason: "exact match to the committed, reviewed baseline" }
      : { exitCode: 1, reason: `${status} - STRICT policy blocks on any drift from the reviewed baseline` };
  }

  if (policy === POLICY.INFORMATIONAL) {
    return { exitCode: 0, reason: `${status} - INFORMATIONAL policy reports truthfully but never blocks` };
  }

  return { exitCode: 1, reason: `unknown execution policy "${policy}" - fails closed, never silently passes` };
}

module.exports = { POLICY, resolveExitCode };
