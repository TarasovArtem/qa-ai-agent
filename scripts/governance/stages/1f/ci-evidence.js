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
 * `HUMAN_REVIEW_REQUIRED` (`CI_UNEXPLAINED_RERUN`) with no accepted
 * determination evidence. This is safe fail-closed behavior, not an
 * operational D4-A provider.
 *
 * CORRECTIVE C3 (W4-C2R-DEV-M2): design section 25a requires every externally
 * mutable source a report relies on to be captured and later revalidated. The
 * CI run itself is exactly such a source (its attempt/job/status data can
 * change under a rerun), so a successfully collected, completed run now
 * always contributes exactly one canonical CI-run `externalEvidence[]` entry
 * -- `ciRunSourceObjectId()`/`computeCiRunDigest()` below define its identity
 * and content digest, always `immutability: "MUTABLE"` (never claimed
 * provider- or crypto-verified merely because it came through an adapter or
 * was SHA-256-hashed). This is distinct from, and never a substitute for, an
 * accepted human-determination entry (which remains impossible in this
 * configuration per Corrective C2).
 */

"use strict";

const crypto = require("node:crypto");
const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { validateResultRecord, canonicalJson } = require("../../kernel/results");
const { isValidSubject, safe } = require("../common");
const { fetchValidatedRun } = require("./ci-run");
const { checkRequiredJobs, validateRequiredJobsPolicy } = require("./required-jobs");
const { qualifyDetermination, resolveDeterminationAdapter } = require("./determination");
const { classifyCiEvidence, CLASSIFICATION_CONTRACT } = require("./ci-classify");

const CI_RUN_SOURCE_PREFIX = "ci-run:";

function invalidInput(subject, detail) {
  return deepFreeze({ subject: subject || null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.RESULT_RECORD_INVALID, detail }, externalEvidence: [] });
}

/**
 * ciRunSourceObjectId({repository, runId}) -- the canonical, deterministic,
 * bounded identity of a CI run as an externally mutable evidence source.
 * `runId` is unique within `repository` in this framework's model (the same
 * granularity `stages/1f/determination.js#checkBindings()` already relies on
 * for run identity), so the pair is sufficient and stays well under the
 * report schema's 300-character `sourceObjectId` bound. The `ci-run:` prefix
 * keeps this namespace unambiguous against a determination's own
 * `channelObjectId` (design section 25a: two evidence sources must never
 * share an ambiguous identity).
 */
function ciRunSourceObjectId({ repository, runId }) {
  return `${CI_RUN_SOURCE_PREFIX}${repository}:${runId}`;
}

/** True when `sourceObjectId` was produced by ciRunSourceObjectId() -- used to map a report's externalEvidence[] entries to the CI-run revalidation adapter. */
function isCiRunSourceObjectId(sourceObjectId) {
  return typeof sourceObjectId === "string" && sourceObjectId.startsWith(CI_RUN_SOURCE_PREFIX);
}

/**
 * sourceTypeForExternalEvidenceEntry(entry) -- the deterministic, unambiguous
 * mapping a trusted caller uses to build kernel/revalidation.js#revalidateEvidence()'s
 * `items[]` from a report's `externalEvidence[]` (design section 25a: the
 * canonical entry carries no `sourceType` field itself). Returns `"CI_RUN"`
 * for a CI-run entry, else `null` -- an unrecognized entry must never be
 * silently dropped when a caller constructs `items[]`; `null` is the caller's
 * explicit signal to fail closed (e.g. INCOMPLETE) rather than ignore it.
 */
function sourceTypeForExternalEvidenceEntry(entry) {
  return isPlainObject(entry) && isCiRunSourceObjectId(entry.sourceObjectId) ? "CI_RUN" : null;
}

/**
 * computeCiRunDigest({repository, workflowPath, runId, event, headSha,
 * attempt, status, requiredJobs, missing, failed, pending, skipped,
 * attemptHistory}) -- SHA-256 of the canonical JSON
 * (`kernel/results.js#canonicalJson()`, the same convention
 * `stages/1a/policy.js#policyDigest()` and
 * `stages/1f/determination.js#computeDeterminationDigest()` already use) over
 * every field that can change what the run's classification means: identity
 * (repository/workflowPath/runId/event/headSha/attempt/status), the
 * base-anchored required-job list and each required job's outcome category
 * (missing/failed/pending/skipped -- "required jobs and their relevant
 * conclusions"; a non-required job cannot change classification and is
 * intentionally excluded), and the full attempt history. Never the arbitrary
 * raw provider response, and never a digest an adapter supplies -- this
 * function always computes it. Its inputs are exactly the fields
 * `collectCiEvidence()` already stores in a `1F.CI` record's `observed`
 * payload (plus `subject.head` for `headSha`), so `stages/1f/report.js` can
 * recompute the SAME digest from an already-collected record alone, with no
 * second, independently-shaped copy of the run evidence.
 */
function computeCiRunDigest({ repository, workflowPath, runId, event, headSha, attempt, status, requiredJobs, missing, failed, pending, skipped, attemptHistory }) {
  const body = {
    repository, workflowPath, runId, event, headSha, attempt, status,
    requiredJobs: [...requiredJobs].sort(),
    missing: [...missing].sort(), failed: [...failed].sort(), pending: [...pending].sort(), skipped: [...skipped].sort(),
    attemptHistory: [...attemptHistory].map((a) => ({ attempt: a.attempt, conclusion: a.conclusion, failedJobs: [...a.failedJobs].sort() })).sort((a, b) => a.attempt - b.attempt),
  };
  return crypto.createHash("sha256").update(canonicalJson(body)).digest("hex");
}

/**
 * collectedAtOf(now) -- design section 25a requires a trusted or explicitly
 * injected collection clock, never a live, non-deterministic default (the
 * same convention `stages/1a/secrets.js#todayOf()` already uses for
 * suppression-expiry evaluation). `now` must be a `Date` or a non-empty
 * bounded string; anything else fails resolution (`null`), which the caller
 * below turns into CONFIGURATION_ERROR rather than fabricating a timestamp.
 */
function collectedAtOf(now) {
  if (now instanceof Date && Number.isFinite(now.getTime())) return now.toISOString();
  if (typeof now === "string" && now.length > 0 && now.length <= 64) return now;
  return null;
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
 *   now                     Corrective C3 (W4-C2R-DEV-M2): a `Date` or bounded ISO
 *                           string collection clock, required once a completed run
 *                           is being recorded as CI-run evidence -- see collectedAtOf().
 *
 * Output: { subject, records: [<one 1F.CI record>], outcome, externalEvidence }.
 * For a successfully collected, completed run, `externalEvidence` always carries
 * exactly one canonical CI-run entry (design section 25a) -- see
 * ciRunSourceObjectId()/computeCiRunDigest() -- in addition to any accepted
 * determination's own entry (always empty in this configuration, Corrective C2).
 * For every other path (fetch failure, wrong identity, in-progress run, or a
 * malformed call), `externalEvidence` is empty: there is no completed run to pin.
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

  // Corrective C6 (W4-C4R-INFO-2): the collector's own boundary check used to
  // accept anything checkRequiredJobs() would later reject as a malformed
  // policy (too many entries, non-string names, empty names, oversized
  // names, duplicates) -- letting execution continue to classify (INCOMPLETE)
  // and build a full CI-run record and externalEvidence entry that
  // stages/1f/report.js's own, stricter run-evidence validation would then
  // reject as malformed. The collector and the report builder must agree
  // about the same record's validity; reusing required-jobs.js's own policy
  // validator (rather than a second, potentially divergent check here) keeps
  // that agreement structural, not coincidental.
  //
  // CORRECTIVE C7 (W4-C6R-DEV-L2): `policyCheck.requiredJobs` is now a
  // FROZEN SNAPSHOT `validateRequiredJobsPolicy()` took by a single read of
  // the caller's array -- every use below reads ONLY this snapshot, never
  // `input.requiredJobs` again. Without this, a caller-held reference to the
  // original array (or a getter-backed element) could be mutated during the
  // `await resolvedAdapter.adapter.fetchDetermination()` call further below
  // (reachable whenever the run shows a rerun), so the job set actually
  // checked against the run (via checkRequiredJobs(), synchronously right
  // after validation) could differ from the job set later stored in the
  // record and hashed into the CI-run evidence digest -- a classification
  // computed against one job set, published against another.
  const policyCheck = validateRequiredJobsPolicy(input.requiredJobs);
  if (!policyCheck.ok) {
    return invalidInput(subject, `requiredJobs must be a valid, base-anchored policy list: ${policyCheck.reason}`);
  }
  const requiredJobs = policyCheck.requiredJobs;
  // Corrective C3 (W4-C2R-DEV-M2): from this point on a completed, validated run
  // always contributes a canonical CI-run externalEvidence entry (design section
  // 25a), which requires a trusted collection clock -- never a fabricated or
  // non-deterministic default.
  const collectedAt = collectedAtOf(input.now);
  if (collectedAt === null) return invalidInput(subject, "now (a Date or bounded ISO string collection clock) is required to record CI-run evidence");
  const requiredJobCheck = checkRequiredJobs({ run, requiredJobs });

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

  const missing = requiredJobCheck.ok ? [...requiredJobCheck.missing].sort() : [];
  const failed = requiredJobCheck.ok ? [...requiredJobCheck.failed].sort() : [];
  const pending = requiredJobCheck.ok ? [...requiredJobCheck.pending].sort() : [];
  const skipped = requiredJobCheck.ok ? [...requiredJobCheck.skipped].sort() : [];
  const requiredJobsSorted = [...requiredJobs].sort();

  const record = ciRecord(subject, classified, {
    classification: classified.classification, repository: run.repository, workflowPath: input.workflowPath, runId: run.runId,
    event: run.event, attempt: run.attempt, status: run.status, requiredJobs: requiredJobsSorted,
    missing, failed, pending, skipped, attemptHistory: run.attemptHistory,
  });

  // Corrective C3 (W4-C2R-DEV-M2): the CI run itself is an externally mutable
  // source the classification above relied on -- it is captured here,
  // unconditionally, for every completed-and-validated run, regardless of
  // classification (CLEAN_FIRST_PASS, FAIL, INCOMPLETE or HUMAN_REVIEW_REQUIRED),
  // never only for a passing outcome. It is never an accepted-determination
  // substitute and is always MUTABLE (never VERIFIED_PROVIDER/VERIFIED_CRYPTO
  // merely because it came through an adapter or was SHA-256-hashed).
  const ciRunEvidence = {
    sourceObjectId: ciRunSourceObjectId({ repository: run.repository, runId: run.runId }),
    sourceVersion: String(run.attempt),
    contentDigest: computeCiRunDigest({
      repository: run.repository, workflowPath: input.workflowPath, runId: run.runId, event: run.event, headSha: run.headSha,
      attempt: run.attempt, status: run.status, requiredJobs: requiredJobsSorted, missing, failed, pending, skipped, attemptHistory: run.attemptHistory,
    }),
    collectedAt,
    immutability: "MUTABLE",
  };

  return deepFreeze({ subject, records: [record], outcome: null, externalEvidence: deepFreeze([ciRunEvidence]) });
}

module.exports = {
  collectCiEvidence, ciRunSourceObjectId, isCiRunSourceObjectId, sourceTypeForExternalEvidenceEntry, computeCiRunDigest,
};
