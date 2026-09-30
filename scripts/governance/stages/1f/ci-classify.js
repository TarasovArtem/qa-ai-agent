/**
 * GOV-AUTO-1 Wave 4 / 1F -- CI classification decision table (design section
 * 17). Consumes only already-validated facts: a run confirmed to match the
 * requested repository/SHA/event (stages/1f/ci-run.js) and its required-job
 * completeness (stages/1f/required-jobs.js). This module never talks to
 * GitHub, never decides whether a failure was harmless, and never reruns
 * anything -- it is a pure function of validated facts to one of exactly
 * five classifications.
 *
 * The `determination` input, when present, must already be the FULLY
 * validated output of the Stage 1F determination-authority module
 * (`./determination.js`): this function does not authenticate anyone and does
 * not itself decide SEPARATE_PERSON vs OWNER_ATTESTED -- it only reads the
 * already-decided `mode` and whether the record was `accepted`. A record
 * this function was not told is accepted is never treated as accepted.
 * Correctives C1/C2 built that module's adapter-resolution
 * (`resolveDeterminationAdapter()`) and qualification (`qualifyDetermination()`)
 * layers; in the current configuration `qualifyDetermination()` never accepts
 * anything (see its own header), so `determination` reaching this function is
 * always `null` in practice -- a safe fail-closed state, not a missing module.
 */

"use strict";

const { REASON, STATUS } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");

const CLASSIFICATIONS = ["CLEAN_FIRST_PASS", "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN", "FAIL", "INCOMPLETE", "HUMAN_REVIEW_REQUIRED"];

/**
 * The canonical classification -> 1F.CI record contract (design sections 17
 * and 22), defined once here beside the decision table that produces it.
 * `status` is the record status each classification yields; `reasonCodes` are
 * every reasonCode a 1F.CI record with that classification can carry -- those
 * this table emits plus the CI_NOT_COLLECTED codes stages/1f/ci-evidence.js
 * uses when run evidence could not be established (Corrective C2 /
 * W4-C1-DEV-M1: stages/1f/report.js validates supplied records against this
 * same table instead of keeping a second copy).
 */
const CLASSIFICATION_CONTRACT = Object.freeze({
  CLEAN_FIRST_PASS: Object.freeze({ status: STATUS.PASS, reasonCodes: Object.freeze([REASON.OK]) }),
  PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN: Object.freeze({ status: STATUS.PASS, reasonCodes: Object.freeze([REASON.OK]) }),
  FAIL: Object.freeze({ status: STATUS.FAIL, reasonCodes: Object.freeze([REASON.CI_REQUIRED_JOB_FAILED, REASON.CI_NOT_COLLECTED]) }),
  INCOMPLETE: Object.freeze({ status: STATUS.INCOMPLETE, reasonCodes: Object.freeze([REASON.CI_REQUIRED_JOB_INCOMPLETE, REASON.CI_NOT_COLLECTED]) }),
  HUMAN_REVIEW_REQUIRED: Object.freeze({ status: STATUS.HUMAN_REVIEW_REQUIRED, reasonCodes: Object.freeze([REASON.CI_UNEXPLAINED_RERUN, REASON.OWNER_SELF_DETERMINATION]) }),
});

function isAcceptedDetermination(determination) {
  if (!isPlainObject(determination)) return false;
  if (determination.accepted !== true) return false;
  return determination.mode === "SEPARATE_PERSON" || determination.mode === "OWNER_ATTESTED";
}

/**
 * classifyCiEvidence({ requiredJobCheck, attempt, attemptHistory, determination })
 *   requiredJobCheck  the { ok, complete, allSucceeded, ... } output of
 *                     stages/1f/required-jobs.js#checkRequiredJobs() for the
 *                     run's current/final attempt
 *   attempt           the run's current attempt number (integer >= 1)
 *   attemptHistory    the run's validated attempt-history array (may be empty)
 *   determination     null, or an already-validated determination-authority
 *                     result: { accepted: boolean, mode: "SEPARATE_PERSON" | "OWNER_ATTESTED" }
 *
 * Returns { classification, reasonCode, detail }. `classification` is always
 * one of the five canonical values; a malformed call classifies INCOMPLETE
 * rather than throwing (the tool could not establish the fact), never FAIL
 * (FAIL means the evidence is wrong, not that the caller's request was
 * malformed) and never a silent default to CLEAN_FIRST_PASS.
 */
function classifyCiEvidence(input) {
  if (!isPlainObject(input) || !isPlainObject(input.requiredJobCheck) || input.requiredJobCheck.ok !== true) {
    return { classification: "INCOMPLETE", reasonCode: REASON.CI_REQUIRED_JOB_INCOMPLETE, detail: "required-job evidence could not be established" };
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    return { classification: "INCOMPLETE", reasonCode: REASON.CI_NOT_COLLECTED, detail: "attempt number could not be established" };
  }
  const attemptHistory = Array.isArray(input.attemptHistory) ? input.attemptHistory : null;
  if (attemptHistory === null) {
    return { classification: "INCOMPLETE", reasonCode: REASON.CI_NOT_COLLECTED, detail: "attempt history could not be established" };
  }

  const { complete, allSucceeded } = input.requiredJobCheck;
  const hadRerun = input.attempt > 1 || attemptHistory.length > 0;

  if (!complete) {
    return { classification: "INCOMPLETE", reasonCode: REASON.CI_REQUIRED_JOB_INCOMPLETE, detail: "one or more required jobs are missing or still pending" };
  }

  if (allSucceeded) {
    if (!hadRerun) return { classification: "CLEAN_FIRST_PASS", reasonCode: REASON.OK, detail: "attempt 1, every required job succeeded, no rerun" };
    if (isAcceptedDetermination(input.determination)) {
      if (input.determination.mode === "SEPARATE_PERSON") {
        return { classification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN", reasonCode: REASON.OK, detail: "same-head rerun covered by an accepted SEPARATE_PERSON determination" };
      }
      // OWNER_ATTESTED is recorded as evidence only and is never promoted to
      // PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN (design section 17 rule 4): the
      // machine cannot prove a separate human made the determination.
      return { classification: "HUMAN_REVIEW_REQUIRED", reasonCode: REASON.OWNER_SELF_DETERMINATION, detail: "same-head rerun attested by the owner only; independence cannot be proven" };
    }
    return { classification: "HUMAN_REVIEW_REQUIRED", reasonCode: REASON.CI_UNEXPLAINED_RERUN, detail: "a rerun occurred with no valid accepted determination record" };
  }

  // Required jobs are complete (no missing/pending) but not all succeeded:
  // failure, cancellation or timeout on the current/final attempt with no
  // later same-SHA success to redeem it.
  return { classification: "FAIL", reasonCode: REASON.CI_REQUIRED_JOB_FAILED, detail: "a required job did not succeed on the current attempt" };
}

module.exports = { classifyCiEvidence, CLASSIFICATIONS, CLASSIFICATION_CONTRACT };
