"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRequiredJobs, validateRequiredJobsPolicy, isDenseArray } = require("./required-jobs");

const job = (name, status, conclusion) => ({ name, status, conclusion });
const run = (jobs) => ({ jobs });

test("all required jobs present and successful -> complete and allSucceeded", () => {
  const r = checkRequiredJobs({ run: run([job("Unit tests", "completed", "success"), job("Cypress - chrome", "completed", "success")]), requiredJobs: ["Unit tests", "Cypress - chrome"] });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.equal(r.allSucceeded, true);
  assert.deepEqual(r.succeeded.sort(), ["Cypress - chrome", "Unit tests"]);
});

test("extra, non-required jobs in the run do not affect the result", () => {
  const r = checkRequiredJobs({ run: run([job("Unit tests", "completed", "success"), job("Unrelated job", "completed", "failure")]), requiredJobs: ["Unit tests"] });
  assert.equal(r.allSucceeded, true);
});

test("a required job missing from the run -> reported missing, never treated as passing -- mandatory negative test #5", () => {
  const r = checkRequiredJobs({ run: run([job("Unit tests", "completed", "success")]), requiredJobs: ["Unit tests", "Cypress - chrome"] });
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);
  assert.equal(r.allSucceeded, false);
  assert.deepEqual(r.missing, ["Cypress - chrome"]);
});

test("a required job that failed -> reported failed, never masked by other successes -- mandatory negative test #6", () => {
  const r = checkRequiredJobs({ run: run([job("Unit tests", "completed", "success"), job("Cypress - chrome", "completed", "failure")]), requiredJobs: ["Unit tests", "Cypress - chrome"] });
  assert.equal(r.allSucceeded, false);
  assert.deepEqual(r.failed, ["Cypress - chrome"]);
});

test("a required job that was cancelled -> reported failed -- mandatory negative test #7", () => {
  const r = checkRequiredJobs({ run: run([job("Cypress - chrome", "completed", "cancelled")]), requiredJobs: ["Cypress - chrome"] });
  assert.equal(r.allSucceeded, false);
  assert.deepEqual(r.failed, ["Cypress - chrome"]);
});

test("a required job that timed out -> reported failed -- mandatory negative test #8", () => {
  const r = checkRequiredJobs({ run: run([job("Cypress - chrome", "completed", "timed_out")]), requiredJobs: ["Cypress - chrome"] });
  assert.deepEqual(r.failed, ["Cypress - chrome"]);
});

test("a required job still pending/in-progress -> reported pending, not complete, never a false pass -- mandatory negative test #9", () => {
  const r = checkRequiredJobs({ run: run([job("Cypress - chrome", "in_progress", null)]), requiredJobs: ["Cypress - chrome"] });
  assert.equal(r.complete, false);
  assert.deepEqual(r.pending, ["Cypress - chrome"]);
});

test("a required job that was skipped is never counted as successful by default", () => {
  const r = checkRequiredJobs({ run: run([job("Cypress - chrome", "completed", "skipped")]), requiredJobs: ["Cypress - chrome"] });
  assert.equal(r.allSucceeded, false);
  assert.deepEqual(r.skipped, ["Cypress - chrome"]);
});

test("a subset of required jobs succeeding is never treated as a complete pass", () => {
  const r = checkRequiredJobs({ run: run([job("Unit tests", "completed", "success")]), requiredJobs: ["Unit tests", "Cypress - chrome", "Playwright Chromium"] });
  assert.equal(r.allSucceeded, false);
  assert.equal(r.complete, false);
});

test("an empty run.jobs array with a non-empty required-job list reports every required job missing", () => {
  const r = checkRequiredJobs({ run: run([]), requiredJobs: ["Unit tests"] });
  assert.deepEqual(r.missing, ["Unit tests"]);
});

test("malformed run (not an object, or jobs not an array) fails closed", () => {
  for (const bad of [null, {}, { jobs: "not-an-array" }]) {
    const r = checkRequiredJobs({ run: bad, requiredJobs: ["Unit tests"] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "MALFORMED_RUN");
  }
});

test("malformed required-job policy (empty, oversized, non-string entries, duplicates) fails closed -- never a hard-coded fallback list", () => {
  assert.equal(checkRequiredJobs({ run: run([]), requiredJobs: [] }).ok, false);
  assert.equal(checkRequiredJobs({ run: run([]), requiredJobs: "not-an-array" }).ok, false);
  assert.equal(checkRequiredJobs({ run: run([]), requiredJobs: [123] }).ok, false);
  assert.equal(checkRequiredJobs({ run: run([]), requiredJobs: Array.from({ length: 300 }, (_, i) => `job-${i}`) }).ok, false);
  const dup = checkRequiredJobs({ run: run([]), requiredJobs: ["Unit tests", "Unit tests"] });
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, "DUPLICATE_REQUIRED_JOB_NAME");
});

test("never throws on a fully hostile input object", () => {
  for (const bad of [null, undefined, 42, [], { run: null, requiredJobs: null }]) {
    assert.doesNotThrow(() => checkRequiredJobs(bad));
  }
});

test("the function does not hard-code any specific job name: an arbitrary caller-supplied policy is honored exactly", () => {
  const r = checkRequiredJobs({ run: run([job("Totally Custom Job Name", "completed", "success")]), requiredJobs: ["Totally Custom Job Name"] });
  assert.equal(r.allSucceeded, true);
});

// ---------------------------------------------------------------- Corrective C7 (W4-C6R-DEV-L2): sparse-array rejection + snapshot
//
// Reproduction first (mission section 5): BEFORE this corrective,
// Array.prototype.every() silently SKIPPED holes -- `const a = []; a.length
// = 2; a[1] = "Unit tests";` has `a.every(...)` visit ONLY index 1 and
// report `true`, never inspecting the absent index 0. The OLD validation
// (`Array.isArray(v) && v.length <= max && v.every(...)`) therefore accepted
// this array as if it were a single-entry, fully-populated policy list, and
// `new Set(requiredJobs).size !== requiredJobs.length` did not catch it
// either (Set iteration treats a hole as `undefined`, giving matching
// sizes). isDenseArray() below is the fix; these tests reproduce the exact
// shapes that bypassed the old check and confirm they are now rejected.

function sparseHoleAtStart() {
  const a = [];
  a.length = 2;
  a[1] = "Unit tests";
  return a;
}
function sparseHoleInMiddle() {
  const a = ["Unit tests"];
  a.length = 3;
  a[2] = "Cypress - chrome";
  return a;
}
function sparseHoleAtEnd() {
  const a = ["Unit tests"];
  a.length = 2;
  return a;
}

test("isDenseArray() rejects every sparse shape and accepts every dense one", () => {
  assert.equal(isDenseArray(sparseHoleAtStart()), false);
  assert.equal(isDenseArray(sparseHoleInMiddle()), false);
  assert.equal(isDenseArray(sparseHoleAtEnd()), false);
  assert.equal(isDenseArray([]), true);
  assert.equal(isDenseArray(["a", "b"]), true);
  assert.equal(isDenseArray(["a", undefined, "b"]), true); // explicit undefined has an own key -- not a hole
  assert.equal(isDenseArray(["a", null, "b"]), true); // explicit null has an own key -- not a hole
  assert.equal(isDenseArray("not-an-array"), false);
  assert.equal(isDenseArray(null), false);
});

test("C7-L2-01: a sparse requiredJobs array with a hole at the start is rejected, never vacuously accepted via every()'s hole-skipping", () => {
  const r = validateRequiredJobsPolicy(sparseHoleAtStart());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MALFORMED_REQUIRED_JOB_POLICY");
});

test("C7-L2-02: a sparse requiredJobs array with a hole in the middle is rejected", () => {
  const r = validateRequiredJobsPolicy(sparseHoleInMiddle());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MALFORMED_REQUIRED_JOB_POLICY");
});

test("C7-L2-03: a sparse requiredJobs array with a trailing hole (length extended past the last real entry) is rejected", () => {
  const r = validateRequiredJobsPolicy(sparseHoleAtEnd());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MALFORMED_REQUIRED_JOB_POLICY");
});

test("C7-L2-04: the same three sparse shapes are also rejected through checkRequiredJobs() (the caller most external code actually uses)", () => {
  for (const sparse of [sparseHoleAtStart(), sparseHoleInMiddle(), sparseHoleAtEnd()]) {
    const r = checkRequiredJobs({ run: run([job("Unit tests", "completed", "success")]), requiredJobs: sparse });
    assert.equal(r.ok, false, JSON.stringify(sparse));
    assert.equal(r.reason, "MALFORMED_REQUIRED_JOB_POLICY", JSON.stringify(sparse));
  }
});

test("C7-L2-05: explicit undefined/null entries (not sparse holes -- both have an own enumerable key) are still rejected, but for their own per-entry type reason, not MALFORMED_REQUIRED_JOB_POLICY's sparse path being bypassed", () => {
  const withUndefined = ["Unit tests", undefined];
  const withNull = ["Unit tests", null];
  assert.equal(isDenseArray(withUndefined), true);
  assert.equal(isDenseArray(withNull), true);
  assert.equal(validateRequiredJobsPolicy(withUndefined).ok, false);
  assert.equal(validateRequiredJobsPolicy(withNull).ok, false);
});

test("C7-L2-06: a genuinely dense, valid requiredJobs array is accepted and returns a frozen snapshot, not the original reference", () => {
  const original = ["Unit tests", "Cypress - chrome"];
  const r = validateRequiredJobsPolicy(original);
  assert.equal(r.ok, true);
  assert.deepEqual(r.requiredJobs, original);
  assert.notEqual(r.requiredJobs, original, "must be an isolated snapshot, not the same array reference");
  assert.equal(Object.isFrozen(r.requiredJobs), true);
  assert.throws(() => { r.requiredJobs.push("extra"); });
});

test("C7-L2-07: mutating the caller's original array AFTER validateRequiredJobsPolicy() returns never changes the returned snapshot", () => {
  const original = ["Unit tests", "Cypress - chrome"];
  const r = validateRequiredJobsPolicy(original);
  assert.equal(r.ok, true);
  original.push("Late addition");
  original[0] = "Mutated";
  assert.deepEqual(r.requiredJobs, ["Unit tests", "Cypress - chrome"]);
});

test("C7-L2-08: checkRequiredJobs() evaluates the run against the SAME validated snapshot it returns evidence about, not a separately re-read copy of the input", () => {
  const original = ["Unit tests", "Cypress - chrome"];
  const r = checkRequiredJobs({ run: run([job("Unit tests", "completed", "success"), job("Cypress - chrome", "completed", "success")]), requiredJobs: original });
  assert.equal(r.ok, true);
  assert.equal(r.allSucceeded, true);
  original.push("Nonexistent job");
  assert.equal(r.missing.includes("Nonexistent job"), false, "the already-computed result must not be affected by a later mutation of the caller's original array");
});
