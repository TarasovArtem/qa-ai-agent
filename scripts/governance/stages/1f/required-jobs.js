/**
 * GOV-AUTO-1 Wave 4 / 1F -- required-job completeness (design section 17).
 *
 * Determines whether a validated CI run (stages/1f/ci-run.js's output --
 * already bound to the exact requested repository/SHA/event) satisfies a
 * base-anchored required-job policy. This module never decides SHA/event/
 * repository correctness (ci-run.js's job) and never classifies the overall
 * CI result (ci-classify.js's job); it establishes exactly one fact: which
 * required jobs are present, successful, failed, pending or skipped.
 *
 * The required-job list itself is never sourced from the reviewed HEAD by
 * this module -- it is an opaque input the caller must have already read
 * from a base-anchored policy (the same trust-anchor discipline
 * stages/1a/policy.js already established for the governance root/base
 * policy). This module does not hard-code any specific job set: callers
 * supply their own policy-derived list, so no particular workflow's job
 * names become permanent Stage 1F policy.
 */

"use strict";

const { isPlainObject } = require("../../kernel/validation");

const MAX_REQUIRED_JOBS = 256;
const SUCCESS_LIKE = new Set(["success"]);
const SKIPPED_LIKE = new Set(["skipped"]);

/**
 * checkRequiredJobs({ run, requiredJobs })
 *   run           a validated run object from ci-run.js#fetchValidatedRun() /
 *                 #validateRunEvidence() -- { jobs: [{name, status, conclusion}], ... }
 *   requiredJobs  a non-empty, bounded, duplicate-free array of job names,
 *                 read by the caller from a base-anchored policy
 *
 * Returns { ok: true, complete, allSucceeded, missing, failed, pending, skipped, succeeded }
 * or { ok: false, reason } for a malformed call. A required job absent from
 * `run.jobs` is `missing`, never silently treated as passing or as
 * not-applicable. A present-but-skipped required job is never counted as
 * successful (design's own "do not treat a skipped required job as
 * successful by default" rule) -- it is reported separately in `skipped`.
 * A present-but-not-yet-completed job is `pending`. Everything else
 * (failure, cancelled, timed_out, neutral, action_required, stale) is
 * `failed`. `complete` is true only when nothing is missing or pending;
 * `allSucceeded` additionally requires zero `failed` and zero `skipped`
 * entries -- a successful subset is never treated as a complete pass.
 */
function checkRequiredJobs(input) {
  if (!isPlainObject(input) || !isPlainObject(input.run) || !Array.isArray(input.run.jobs)) {
    return { ok: false, reason: "MALFORMED_RUN" };
  }
  const requiredJobs = input.requiredJobs;
  if (!Array.isArray(requiredJobs) || requiredJobs.length === 0 || requiredJobs.length > MAX_REQUIRED_JOBS) {
    return { ok: false, reason: "MALFORMED_REQUIRED_JOB_POLICY" };
  }
  if (!requiredJobs.every((n) => typeof n === "string" && n.length > 0 && n.length <= 200)) {
    return { ok: false, reason: "MALFORMED_REQUIRED_JOB_POLICY" };
  }
  if (new Set(requiredJobs).size !== requiredJobs.length) return { ok: false, reason: "DUPLICATE_REQUIRED_JOB_NAME" };

  const byName = new Map(input.run.jobs.map((j) => [j.name, j]));
  const missing = [], failed = [], pending = [], skipped = [], succeeded = [];
  for (const name of requiredJobs) {
    const job = byName.get(name);
    if (!job) { missing.push(name); continue; }
    if (job.status !== "completed") { pending.push(name); continue; }
    if (SUCCESS_LIKE.has(job.conclusion)) { succeeded.push(name); continue; }
    if (SKIPPED_LIKE.has(job.conclusion)) { skipped.push(name); continue; }
    failed.push(name);
  }
  const complete = missing.length === 0 && pending.length === 0;
  const allSucceeded = complete && failed.length === 0 && skipped.length === 0;
  return { ok: true, complete, allSucceeded, missing, failed, pending, skipped, succeeded };
}

module.exports = { checkRequiredJobs };
