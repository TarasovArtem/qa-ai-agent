/**
 * Single execution-policy authority for regression*.js's exit-code
 * semantics (CRW2-A2, addressing conformance finding A-2).
 *
 * The full formal decision - why v1-v5 are INFORMATIONAL, why v6 is STRICT,
 * the evidence behind that split, and the criteria for changing it later -
 * is recorded durably in docs/evaluation-execution-policy-v1.md. This file
 * is the *runtime enforcement* of that decision, not the decision record
 * itself; keep both in sync if the decision ever changes.
 *
 * Discovery summary: regression.js (v1) and regression-v2..v5.js all
 * compute the exact same comparison-status vocabulary - `REGRESSED` /
 * `IMPROVED` / `UNCHANGED` / `BASELINE_MISMATCH` - but originally decided
 * the resulting exit code inline, in each file's own run(), with an
 * unconditional `exitCode: 0` after a successful comparison (REGRESSED
 * included). regression-v6.js instead computed
 * `exitCode = comparison.baselineMatched ? 0 : 1` (i.e. only UNCHANGED
 * exits 0; REGRESSED, IMPROVED, and BASELINE_MISMATCH all exit 1). This
 * module makes that decision *explicit, named, centrally assigned, and
 * testable* rather than leaving it implicit and duplicated per file - it
 * deliberately does not change v1-v5's or v6's actual CI behavior (see each
 * regression*.js's own updated run(), and the cross-version regression
 * matrix in this module's own test file).
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

// Single, declarative version -> policy assignment (see
// docs/evaluation-execution-policy-v1.md for the full rationale per
// version). regression*.js's own run() no longer hardcodes its policy
// inline - each imports VERSION_POLICY.vN instead, so this table is the one
// place that assignment is made, not six.
const VERSION_POLICY = Object.freeze({
  v1: POLICY.INFORMATIONAL,
  v2: POLICY.INFORMATIONAL,
  v3: POLICY.INFORMATIONAL,
  v4: POLICY.INFORMATIONAL,
  v5: POLICY.INFORMATIONAL,
  v6: POLICY.STRICT,
});

/**
 * Looks up the formally assigned policy for a version key ("v1".."v6").
 * Fails closed (throws) on any version this table does not recognize -
 * never silently defaults an unknown version to INFORMATIONAL (or to any
 * other policy). Callers that cannot tolerate a throw should validate the
 * version key against `Object.keys(VERSION_POLICY)` first.
 *
 * @param {string} version
 * @returns {string} POLICY.STRICT | POLICY.INFORMATIONAL
 */
function resolvePolicyForVersion(version) {
  if (!Object.prototype.hasOwnProperty.call(VERSION_POLICY, version)) {
    throw new Error(`No formally assigned execution policy for version "${version}" - refusing to guess or default`);
  }
  return VERSION_POLICY[version];
}

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

module.exports = { POLICY, VERSION_POLICY, resolvePolicyForVersion, resolveExitCode };
