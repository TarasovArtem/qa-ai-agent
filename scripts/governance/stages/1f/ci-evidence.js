/**
 * GOV-AUTO-1 Wave 4 / 1F -- collectCiEvidence() (design sections 17, 18): the
 * approved public interface composing run retrieval (ci-run.js),
 * required-job completeness (required-jobs.js), rerun-determination
 * authority (determination.js) and classification (ci-classify.js) into one
 * canonical `1F.CI` result record plus the `externalEvidence[]` entries a
 * report must carry.
 *
 * This is Phase 2 only (design section 17): it is never called from inside
 * the workflow run it is evidence for (that would be self-observation,
 * which this function has no way to detect and therefore never attempts to
 * guard against -- the caller's own invocation discipline is what prevents
 * it, exactly as design section 17 requires of the collector's caller).
 * `collectCiEvidence()` never triggers a workflow, never reruns a job,
 * never merges or approves anything, never bypasses `validateDetermination()`
 * to manufacture a human decision, and never treats an in-progress run as
 * finalized (a `status !== "completed"` run is INCOMPLETE, full stop).
 *
 * CORRECTIVE C1 (W4-SEC-H1): a rerun's determination candidate is no longer
 * accepted as a bare caller-supplied `determinationCandidate` object. It must
 * now come from a resolved `determinationAdapter.fetchDetermination({subject,
 * run})` call (see `./determination.js#resolveDeterminationAdapter()`), the
 * same injection-seam discipline `./ci-run.js` already uses for run evidence.
 * No adapter is ever built into this repository, so a rerun with no injected
 * adapter -- or an adapter that throws, or returns a malformed/rejected
 * response -- always leaves `determination` at `null`, which
 * `classifyCiEvidence()` turns into `HUMAN_REVIEW_REQUIRED`
 * (`CI_UNEXPLAINED_RERUN`), never a silent `PASS`.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { validateResultRecord } = require("../../kernel/results");
const { isValidSubject, safe } = require("../common");
const { fetchValidatedRun } = require("./ci-run");
const { checkRequiredJobs } = require("./required-jobs");
const { validateDetermination, resolveDeterminationAdapter } = require("./determination");
const { classifyCiEvidence } = require("./ci-classify");

const CLASSIFICATION_STATUS = {
  CLEAN_FIRST_PASS: STATUS.PASS,
  PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN: STATUS.PASS,
  FAIL: STATUS.FAIL,
  INCOMPLETE: STATUS.INCOMPLETE,
  HUMAN_REVIEW_REQUIRED: STATUS.HUMAN_REVIEW_REQUIRED,
};

function invalidInput(subject, detail) {
  return deepFreeze({ subject: subject || null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.RESULT_RECORD_INVALID, detail }, externalEvidence: [] });
}

function ciRecord(subject, { classification, reasonCode, detail }, observed) {
  const record = {
    checkId: "1F.CI", ownerStage: "1F", status: CLASSIFICATION_STATUS[classification] || STATUS.CONFIGURATION_ERROR,
    subject, observed, expected: null, reasonCode: reasonCode || REASON.OK, detail: safe(detail || ""), evidenceRefs: [],
  };
  const checked = validateResultRecord(record);
  if (!checked.ok) throw new Error(`internal error: invalid 1F.CI record: ${checked.problems.join("; ")}`);
  return checked.record;
}

/**
 * collectCiEvidence({ subject, repository, workflowPath, event, adapter,
 *                      requiredJobs, determinationCandidate })
 *   subject                the exact run identity (from 1A)
 *   repository, workflowPath, event, adapter   passed straight to
 *                           stages/1f/ci-run.js#fetchValidatedRun()
 *   requiredJobs            base-anchored policy-derived job-name list
 *                           (stages/1f/required-jobs.js)
 *   determinationAdapter    optional injected adapter { fetchDetermination({subject, run})
 *                           -> Promise<{ok:true, candidate} | {ok:false, reason}> } --
 *                           only consulted when the run shows a rerun; the
 *                           `candidate` shape is exactly stages/1f/determination.js
 *                           #validateDetermination()'s input (minus subject/runEvidence,
 *                           which this function supplies). No adapter, an adapter that
 *                           throws, or a malformed/rejected response leaves the
 *                           classification at HUMAN_REVIEW_REQUIRED -- this is the
 *                           fail-closed default (Corrective C1 / W4-SEC-H1); a bare
 *                           caller-supplied candidate object is no longer accepted.
 *
 * Output: { subject, records: [<one 1F.CI record>], outcome, externalEvidence }.
 * `externalEvidence` carries the accepted determination's pinned digest/version
 * (empty when none was accepted) for a report's own `externalEvidence[]` field
 * and for later `kernel/revalidation.js#revalidateEvidence()` calls.
 */
async function collectCiEvidence(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput(null, "a valid subject is required");
  const subject = input.subject;

  const runResult = await fetchValidatedRun({
    repository: input.repository, workflowPath: input.workflowPath, headSha: subject.head, event: input.event, adapter: input.adapter,
  });
  if (!runResult.ok) {
    const status = runResult.reason && runResult.reason.startsWith("WRONG_") ? STATUS.FAIL : STATUS.INCOMPLETE;
    const classification = status === STATUS.FAIL ? "FAIL" : "INCOMPLETE";
    const record = ciRecord(subject, { classification, reasonCode: REASON.CI_NOT_COLLECTED, detail: `CI evidence could not be established: ${runResult.reason}` }, { classification, collected: false, reason: runResult.reason });
    return deepFreeze({ subject, records: [record], outcome: null, externalEvidence: [] });
  }
  const run = runResult.run;

  if (run.status !== "completed") {
    const record = ciRecord(subject, { classification: "INCOMPLETE", reasonCode: REASON.CI_NOT_COLLECTED, detail: "the run has not completed" }, { classification: "INCOMPLETE", collected: true, status: run.status });
    return deepFreeze({ subject, records: [record], outcome: null, externalEvidence: [] });
  }

  if (!Array.isArray(input.requiredJobs) || input.requiredJobs.length === 0) {
    return invalidInput(subject, "requiredJobs must be a non-empty, base-anchored policy list");
  }
  const requiredJobCheck = checkRequiredJobs({ run, requiredJobs: input.requiredJobs });

  const hadRerun = run.attempt > 1 || run.attemptHistory.length > 0;
  let determination = null;
  const externalEvidence = [];
  // Corrective C1 (W4-SEC-H1): the candidate bundle must come from a resolved,
  // injected adapter -- never from a bare `input.determinationCandidate` field
  // supplied directly by the caller. No adapter, a throwing adapter, or a
  // malformed/rejected response all leave `determination` at `null`, which
  // classifyCiEvidence() turns into HUMAN_REVIEW_REQUIRED, never a silent PASS.
  if (hadRerun) {
    const resolvedAdapter = resolveDeterminationAdapter(input);
    if (resolvedAdapter.ok) {
      let fetched;
      try {
        fetched = await resolvedAdapter.adapter.fetchDetermination({ subject, run });
      } catch {
        fetched = null;
      }
      if (isPlainObject(fetched) && fetched.ok === true && isPlainObject(fetched.candidate)) {
        const result = validateDetermination({ ...fetched.candidate, subject, runEvidence: run });
        if (result.accepted) {
          determination = { accepted: true, mode: result.mode, actor: fetched.candidate.authenticatedActor };
          externalEvidence.push(result.externalEvidenceEntry);
        }
      }
    }
  }

  const classified = classifyCiEvidence({ requiredJobCheck, attempt: run.attempt, attemptHistory: run.attemptHistory, determination });

  // Corrective C1 (W4-DEV-M1): the report's finalized `ci` field (design
  // section 23) must be derivable from this SAME record, never recomputed
  // independently -- so every field design section 23 requires is captured
  // here, once, at the single point classification is actually decided.
  let determinationDetail = {};
  if (determination && determination.accepted && determination.mode === "SEPARATE_PERSON" && externalEvidence.length === 1) {
    const evidence = externalEvidence[0];
    determinationDetail = {
      authenticatedActor: determination.actor, determinationMode: determination.mode,
      contentDigest: evidence.contentDigest, channelObjectId: evidence.sourceObjectId, version: evidence.sourceVersion,
    };
  } else if (determination && determination.mode === "OWNER_ATTESTED") {
    determinationDetail = { rerunObserved: true, attestationMode: "OWNER_ATTESTED", candidateClassification: "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN" };
  }

  const record = ciRecord(subject, classified, {
    classification: classified.classification, repository: run.repository, runId: run.runId, event: run.event, attempt: run.attempt,
    requiredJobs: [...input.requiredJobs].sort(),
    missing: requiredJobCheck.ok ? [...requiredJobCheck.missing].sort() : [],
    failed: requiredJobCheck.ok ? [...requiredJobCheck.failed].sort() : [],
    pending: requiredJobCheck.ok ? [...requiredJobCheck.pending].sort() : [],
    skipped: requiredJobCheck.ok ? [...requiredJobCheck.skipped].sort() : [],
    ...determinationDetail,
  });
  return deepFreeze({ subject, records: [record], outcome: null, externalEvidence: deepFreeze(externalEvidence) });
}

module.exports = { collectCiEvidence };
