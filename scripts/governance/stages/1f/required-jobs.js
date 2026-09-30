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
 *
 * CORRECTIVE C6 (W4-C4R-INFO-2): `validateRequiredJobsPolicy()` below is the
 * ONE canonical validator of the policy list itself (bounds, string shape,
 * duplicates), factored out of `checkRequiredJobs()` so a caller that needs
 * to reject a malformed policy BEFORE it has a run to check it against --
 * `stages/1f/ci-evidence.js#collectCiEvidence()`, at its own input boundary
 * -- can reuse the exact same rule set rather than re-implementing a second,
 * potentially divergent one. `checkRequiredJobs()`'s own behavior and return
 * shape are unchanged; it now simply calls the extracted function.
 *
 * CORRECTIVE C7 (W4-C6R-DEV-L2): `Array.prototype.every()` SKIPS holes in a
 * sparse array -- `const a = []; a.length = 2; a[1] = "Unit tests";` has
 * `a.every(...)` visit only index 1 and report `true`, never inspecting the
 * absent index 0. `validateRequiredJobsPolicy()` now explicitly rejects any
 * sparse array (`Object.keys(v).length !== v.length`, the standard sparse-
 * array detector: a hole has no own enumerable key, but an explicit
 * `undefined`/`null` entry does and was already correctly rejected by the
 * per-entry check below) before any per-entry validation runs. It also now
 * takes its OWN single read of every entry before validating or returning
 * it, and returns that frozen snapshot -- never the original, still-mutable/
 * still-getter-backed array -- so a caller cannot validate one array state
 * and later consume a different one (the array could be mutated, or backed
 * by getters, between this call and a later `await` in the caller).
 *
 * CORRECTIVE C8 (W4-C7R-DEV-L1): the C7 fix's own single read used
 * `[...requiredJobs]` -- the SPREAD/ITERATOR protocol, i.e. whatever
 * `requiredJobs[Symbol.iterator]` produces. `isDenseArray()` and the
 * `.length`/`MAX_REQUIRED_JOBS` bound checks above it, however, inspect the
 * array's own INDEXED properties (`Object.keys()`, `.length`) -- a
 * completely different, independently overridable view for any object that
 * is `Array.isArray()`-true (a real Array, or an Array subclass) but carries
 * an own or inherited `Symbol.iterator` override. `const a = ["Unit tests"];
 * a[Symbol.iterator] = function* () {};` passes every indexed check (dense,
 * length 1, under the max) while `[...a]` -- and therefore the OLD
 * snapshot -- silently yields `[]`: an empty, "valid" policy. The same
 * technique can make the iterator yield MORE entries (bypassing
 * `MAX_REQUIRED_JOBS` against the true indexed length), FEWER entries, or an
 * entirely different job list than the one the length/density bound checks
 * just validated -- letting a required job disappear from the effective
 * policy without ever failing a single check. `validateRequiredJobsPolicy()`
 * now captures the snapshot by EXPLICIT INDEXED READS
 * (`requiredJobs[0..length-1]`), never via the iterator/spread protocol, so
 * a `Symbol.iterator` override -- own-property or inherited via a subclass
 * -- cannot substitute a different job set than the one already validated
 * for density and length. A throwing indexed accessor (a getter that
 * throws) is caught and mapped to the same canonical
 * `MALFORMED_REQUIRED_JOB_POLICY` rejection every other malformed-input case
 * already returns, never an uncaught exception. Each index is still read
 * EXACTLY ONCE, preserving the C7 single-read/TOCTOU-closing property for
 * getter-backed arrays.
 *
 * CORRECTIVE C9 (W4-C8R-DEV-L1): the C8 validator still read
 * `requiredJobs.length` FOUR times -- inside `isDenseArray()`, in the
 * `=== 0` check, in the `> MAX_REQUIRED_JOBS` check, and once more to size
 * the snapshot. A real Array's `length` cannot change between those reads,
 * but a Proxy is `Array.isArray()`-true and its `get` trap can return a
 * different `length` on every read: validated as 3 (including a job the run
 * never ran), captured as 2 -- the hidden job silently vanished from the
 * checked, published and digested policy and the run reached a false
 * CLEAN_FIRST_PASS/READY; captured as 0 or 300, the collector published
 * evidence the report builder then rejected. A throwing Proxy trap
 * (`ownKeys`, `getOwnPropertyDescriptor`, `get`) also escaped the collector
 * as an uncaught exception. `validateRequiredJobsPolicy()` now reads
 * `length` exactly ONCE, and that one captured value is the only length
 * used by every bound check, the own-key count check, snapshot allocation
 * and the read loop. Every index `0..length-1` must be an OWN property of
 * the input (an inherited indexed property can no longer fill a hole), is
 * then read exactly once, and every input-inspection step --
 * `Array.isArray()` (throws on a revoked Proxy), the `length` read,
 * `Object.keys()`, the own-index checks and the indexed reads -- sits inside
 * one fail-closed boundary that maps any exception to
 * `MALFORMED_REQUIRED_JOB_POLICY`. The caller's `Symbol.iterator` is still
 * never invoked.
 */

"use strict";

const { isPlainObject } = require("../../kernel/validation");

const MAX_REQUIRED_JOBS = 256;
const SUCCESS_LIKE = new Set(["success"]);
const SKIPPED_LIKE = new Set(["skipped"]);

function isDenseArray(v) {
  return Array.isArray(v) && Object.keys(v).length === v.length;
}

/**
 * validateRequiredJobsPolicy(requiredJobs) -- the policy-list-only half of
 * checkRequiredJobs()'s validation: a DENSE (no holes, every index an own
 * property) array, non-empty, bounded (<=256, checked against a single read
 * of `length`), every entry a non-empty string (<=200 chars), no
 * duplicates. Never inspects a run and never throws: any exception while
 * inspecting the input is MALFORMED_REQUIRED_JOB_POLICY. Returns
 * `{ok:true, requiredJobs}` -- an isolated, frozen SNAPSHOT taken by ONE
 * read of each index, not the original
 * reference -- or `{ok:false, reason}` with the exact same reason strings
 * `checkRequiredJobs()` has always returned for these cases
 * (`MALFORMED_REQUIRED_JOB_POLICY`, `DUPLICATE_REQUIRED_JOB_NAME`).
 */
function validateRequiredJobsPolicy(requiredJobs) {
  const malformed = { ok: false, reason: "MALFORMED_REQUIRED_JOB_POLICY" };
  // Corrective C9 (W4-C8R-DEV-L1): ONE fail-closed boundary around every
  // inspection of the caller's value, and ONE read of `length` -- the same
  // captured value drives every bound check, the own-key count, snapshot
  // allocation and the read loop (see the module note above). Corrective C8
  // (W4-C7R-DEV-L1): explicit indexed reads, never the iterator/spread
  // protocol.
  let snapshot;
  try {
    if (!Array.isArray(requiredJobs)) return malformed;
    const length = requiredJobs.length;
    if (typeof length !== "number" || !Number.isInteger(length) || length < 1 || length > MAX_REQUIRED_JOBS) return malformed;
    // Corrective C7 (W4-C6R-DEV-L2) density rule, now against the captured
    // length: exactly `length` own enumerable keys ...
    if (Object.keys(requiredJobs).length !== length) return malformed;
    snapshot = new Array(length);
    for (let i = 0; i < length; i++) {
      // ... and every index an OWN property, so an inherited indexed
      // property can never fill a hole. hasOwnProperty() inspects the
      // descriptor without invoking an accessor, so each index is still
      // READ exactly once, on the next line.
      if (!Object.prototype.hasOwnProperty.call(requiredJobs, i)) return malformed;
      snapshot[i] = requiredJobs[i];
    }
  } catch {
    return malformed;
  }
  if (!snapshot.every((n) => typeof n === "string" && n.length > 0 && n.length <= 200)) {
    return { ok: false, reason: "MALFORMED_REQUIRED_JOB_POLICY" };
  }
  if (new Set(snapshot).size !== snapshot.length) return { ok: false, reason: "DUPLICATE_REQUIRED_JOB_NAME" };
  return { ok: true, requiredJobs: Object.freeze(snapshot) };
}

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
  const policy = validateRequiredJobsPolicy(input.requiredJobs);
  if (!policy.ok) return policy;
  const requiredJobs = policy.requiredJobs;

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

module.exports = { checkRequiredJobs, validateRequiredJobsPolicy, MAX_REQUIRED_JOBS, isDenseArray };
