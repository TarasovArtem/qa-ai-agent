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
 * never merges or approves anything, never bypasses the determination authority
 * to manufacture a human decision, and never treats an in-progress run as
 * finalized (a `status !== "completed"` run is INCOMPLETE, full stop).
 *
 * CORRECTIVE C1 (W4-SEC-H1): a rerun's determination candidate is no longer
 * accepted as a bare caller-supplied `determinationCandidate` object. It must
 * now come from a resolved `determinationAdapter.fetchDetermination({subject,
 * run})` call (see `./determination.js#resolveDeterminationAdapter()`), the
 * same injection-seam discipline `./ci-run.js` already uses for run evidence.
 *
 * CORRECTIVE C2 (W4-SEC-H1): an injected adapter is a structural seam, not an
 * authenticated provider, so its response is untrusted channel data. It goes
 * only through `./determination.js#qualifyDetermination()`, which never takes
 * authority (policy, determination mode, contributors, actor, history, digest)
 * from it and cannot accept any determination until a base-anchored
 * determination policy, a qualifying provider and the other prerequisites it
 * lists exist. Every rerun -- with no adapter, a throwing or malformed one, or
 * one returning fabricated "trusted" metadata -- therefore stays
 * `HUMAN_REVIEW_REQUIRED` (`CI_UNEXPLAINED_RERUN`) with no `externalEvidence`.
 * This is safe fail-closed behavior, not an operational D4-A provider.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { validateResultRecord } = require("../../kernel/results");
const { isValidSubject, safe } = require("../common");
const { fetchValidatedRun } = require("./ci-run");
const { checkRequiredJobs } = require("./required-jobs");
const { qualifyDetermination, resolveDeterminationAdapter } = require("./determination");
const { classifyCiEvidence, CLASSIFICATION_CONTRACT } = require("./ci-classify");

function invalidInput(subject, detail) {
  return deepFreeze({ subject: subject || null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.RESULT_RECORD_INVALID, detail }, externalEvidence: [] });
}

function ciRecord(subject, { classification, reasonCode, detail }, observed) {
  const record = {
    checkId: "1F.CI", ownerStage: "1F", status: Object.hasOwn(CLASSIFICATION_CONTRACT, classification) ? CLASSIFICATION_CONTRACT[classification].status : STATUS.CONFIGURATION_ERROR,
    subject, observed, expected: null, reasonCode: reasonCode || REASON.OK, detail: safe(detail || ""), evidenceRefs: [],
  };
  const checked = validateResultRecord(record);
  if (!checked.ok) throw new Error(`internal error: invalid 1F.CI record: ${checked.problems.join("; ")}`);
  return checked.record;
}

/**
 * collectCiEvidence({ subject, repository, workflowPath, event, adapter,
 *                      requiredJobs, determinationAdapter })
 *   subject                the exact run identity (from 1A)
 *   repository, workflowPath, event, adapter   passed straight to
 *                           stages/1f/ci-run.js#fetchValidatedRun()
 *   requiredJobs            base-anchored policy-derived job-name list
 *                           (stages/1f/required-jobs.js)
 *   determinationAdapter    optional injected adapter { fetchDetermination({subject, run})
 *                           -> Promise<{ok:true, candidate} | {ok:false, reason}> } --
 *                           only consulted when the run shows a rerun. It is NOT
 *                           trusted: its response is untrusted channel data passed to
 *                           stages/1f/determination.js#qualifyDetermination(), which
 *                           cannot accept a determination in this configuration (no
 *                           base-anchored determination policy, no qualifying
 *                           authenticated provider). A rerun therefore always
 *                           classifies HUMAN_REVIEW_REQUIRED, whatever the adapter
 *                           returns (Corrective C2 / W4-SEC-H1). There is no
 *                           `determinationCandidate` input; such a field is ignored.
 *
 * Output: { subject, records: [<one 1F.CI record>], outcome, externalEvidence }.
 * `externalEvidence` would carry an accepted determination's pinned digest/version
 * for a report's `externalEvidence[]` and later `kernel/revalidation.js
 * #revalidateEvidence()` calls; because no determination can be accepted in this
 * configuration, it is always empty.
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
  // Corrective C2 (W4-SEC-H1): an adapter response is untrusted channel data and
  // reaches only qualifyDetermination(), which cannot accept a determination in
  // this configuration (see its doc). `determination` therefore stays null and
  // classifyCiEvidence() turns every rerun into HUMAN_REVIEW_REQUIRED
  // (CI_UNEXPLAINED_RERUN), whatever the adapter returned.
  if (hadRerun) {
    const resolvedAdapter = resolveDeterminationAdapter(input);
    if (resolvedAdapter.ok) {
      let response;
      try {
        response = await resolvedAdapter.adapter.fetchDetermination({ subject, run });
      } catch {
        response = null;
      }
      qualifyDetermination({ response, subject, runEvidence: run });
    }
  }

  const classified = classifyCiEvidence({ requiredJobCheck, attempt: run.attempt, attemptHistory: run.attemptHistory, determination: null });

  const record = ciRecord(subject, classified, {
    classification: classified.classification, repository: run.repository, runId: run.runId, event: run.event, attempt: run.attempt,
    requiredJobs: [...input.requiredJobs].sort(),
    missing: requiredJobCheck.ok ? [...requiredJobCheck.missing].sort() : [],
    failed: requiredJobCheck.ok ? [...requiredJobCheck.failed].sort() : [],
    pending: requiredJobCheck.ok ? [...requiredJobCheck.pending].sort() : [],
    skipped: requiredJobCheck.ok ? [...requiredJobCheck.skipped].sort() : [],
  });
  return deepFreeze({ subject, records: [record], outcome: null, externalEvidence: [] });
}

module.exports = { collectCiEvidence };
