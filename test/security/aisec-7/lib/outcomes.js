/**
 * AISEC-7 harness-local evidence outcome model.
 *
 * Harness-internal only: never exported through scripts/ai/index.js or any
 * package entrypoint, never a new public API. It exists so a security
 * verification OUTCOME can never be collapsed into a node:test PASS.
 *
 * Two different questions are kept apart on purpose:
 *   - test execution result: did the harness code run and observe what it
 *     expected to observe? (node:test pass/fail)
 *   - security verification outcome: what does that observation establish
 *     about the security property? (one of OUTCOMES below)
 * A characterization test that successfully reproduces a known gap is a
 * passing test whose security outcome is FAIL.
 *
 * Scopes:
 *   CURRENT_BEHAVIOR    - an executed observation of the current repository
 *                         code at a deterministic seam. Its outcome is PASS
 *                         (the narrow control held), FAIL (the gap/violation
 *                         was reproduced), or OWNER_DISPOSITION_REQUIRED when
 *                         no owner-approved oracle exists to judge it.
 *   TARGET_ARCHITECTURE - an AISEC-6 target property (SADR-01..12). It can
 *                         only become PASS through an executed observation
 *                         of an independently verified authentic enforcing
 *                         seam. No such seam exists at this baseline, so
 *                         every target row resolves to its blocked class.
 */

"use strict";

const OUTCOMES = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
  OWNER_DISPOSITION_REQUIRED: "OWNER_DISPOSITION_REQUIRED",
  IMPLEMENTATION_BLOCKED: "IMPLEMENTATION_BLOCKED",
  ARCHITECTURE_BLOCKED: "ARCHITECTURE_BLOCKED",
});

const SCOPES = Object.freeze({
  CURRENT_BEHAVIOR: "CURRENT_BEHAVIOR",
  TARGET_ARCHITECTURE: "TARGET_ARCHITECTURE",
});

// AISEC-6 section 22 dependency classes and the outcome each one forces on a
// target-architecture row. OWNER_DECISION_BLOCKED is the AISEC-6 name; its
// evidence outcome is OWNER_DISPOSITION_REQUIRED.
const BLOCKED_BY = Object.freeze({
  IMPLEMENTATION_BLOCKED: OUTCOMES.IMPLEMENTATION_BLOCKED,
  ARCHITECTURE_BLOCKED: OUTCOMES.ARCHITECTURE_BLOCKED,
  OWNER_DECISION_BLOCKED: OUTCOMES.OWNER_DISPOSITION_REQUIRED,
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Derive the security outcome of one evidence record. Fields that carry no
 * verification weight (trustLabel, schemaValid, testPassed, reviewerName, ...)
 * are deliberately never read, so supplying them cannot change the result.
 *
 * Rules, in order:
 *   1. Anything malformed or unknown -> INSUFFICIENT_EVIDENCE.
 *   2. TARGET_ARCHITECTURE: a declared blocker wins; otherwise PASS needs an
 *      executed, complete observation of an authentic enforcing seam that
 *      held, and no open owner disposition. Anything less is not PASS.
 *   3. CURRENT_BEHAVIOR: not executed or incomplete -> INSUFFICIENT_EVIDENCE.
 *      controlHeld === false -> FAIL, even if a policy question is also open
 *      (a policy dependency never erases a technical FAIL).
 *      controlHeld === null (no approved oracle) -> OWNER_DISPOSITION_REQUIRED
 *      when ownerDispositionRequired is set, else INSUFFICIENT_EVIDENCE.
 *      controlHeld === true -> PASS for that narrow current control only. A
 *      current deterministic refusal may be PASS even though the target
 *      architecture stays incomplete; the target gap and any open policy
 *      question are separate rows, never folded into this one.
 */
function deriveSecurityOutcome(evidence) {
  if (!isRecord(evidence)) return OUTCOMES.INSUFFICIENT_EVIDENCE;
  const { scope, executed, evidenceComplete, controlHeld, blockedBy, ownerDispositionRequired, authenticSeamVerified } = evidence;

  if (scope === SCOPES.TARGET_ARCHITECTURE) {
    if (blockedBy !== undefined && blockedBy !== null) {
      return Object.prototype.hasOwnProperty.call(BLOCKED_BY, blockedBy) ? BLOCKED_BY[blockedBy] : OUTCOMES.INSUFFICIENT_EVIDENCE;
    }
    if (ownerDispositionRequired === true) return OUTCOMES.OWNER_DISPOSITION_REQUIRED;
    if (executed !== true || evidenceComplete !== true || authenticSeamVerified !== true) return OUTCOMES.INSUFFICIENT_EVIDENCE;
    if (controlHeld === true) return OUTCOMES.PASS;
    if (controlHeld === false) return OUTCOMES.FAIL;
    return OUTCOMES.INSUFFICIENT_EVIDENCE;
  }

  if (scope === SCOPES.CURRENT_BEHAVIOR) {
    if (executed !== true || evidenceComplete !== true) return OUTCOMES.INSUFFICIENT_EVIDENCE;
    if (controlHeld === false) return OUTCOMES.FAIL;
    if (controlHeld === true) return OUTCOMES.PASS;
    if (controlHeld === null && ownerDispositionRequired === true) return OUTCOMES.OWNER_DISPOSITION_REQUIRED;
    return OUTCOMES.INSUFFICIENT_EVIDENCE;
  }

  return OUTCOMES.INSUFFICIENT_EVIDENCE;
}

/** Shorthand for an executed, complete CURRENT_BEHAVIOR observation. */
function observed(controlHeld, { ownerDispositionRequired = false } = {}) {
  return deriveSecurityOutcome({
    scope: SCOPES.CURRENT_BEHAVIOR,
    executed: true,
    evidenceComplete: true,
    controlHeld,
    ownerDispositionRequired,
  });
}

module.exports = { OUTCOMES, SCOPES, BLOCKED_BY, deriveSecurityOutcome, observed };
