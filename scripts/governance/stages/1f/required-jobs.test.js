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

// ---------------------------------------------------------------- Corrective C8 (W4-C7R-DEV-L1): iterator-bypass rejection
//
// Reproduction first (mission section 5): BEFORE this corrective,
// `validateRequiredJobsPolicy()` validated an array's LENGTH and DENSITY
// against its indexed/own-key view (`isDenseArray()`, `.length`), but
// captured its CONTENT via `[...requiredJobs]` -- the iterator protocol.
// These are two independently overridable views of the same object: any
// value that is `Array.isArray()`-true (a real Array, or an Array subclass)
// can carry an own or inherited `Symbol.iterator` override that yields
// entirely different values, in a different quantity, than its actual
// indexed properties. `const a = ["Unit tests"]; a[Symbol.iterator] =
// function* () {};` passed every length/density check (indexed length 1,
// dense, under the max) while `[...a]` -- and so the accepted "snapshot" --
// silently produced `[]`, an empty policy accepted as valid. The fix
// captures the snapshot via EXPLICIT INDEXED READS, never the iterator, so
// this class of override is fully inert; every test below confirms the
// snapshot reflects the array's real indexed content, ignoring whatever a
// Symbol.iterator override claims.

function withIterator(indexedValues, generator) {
  const a = [...indexedValues];
  a[Symbol.iterator] = generator;
  return a;
}

test("C8-DEV-L1-01: a custom iterator yielding zero entries does not shrink the accepted snapshot -- the real indexed content is used", () => {
  const a = withIterator(["Unit tests"], function* () {});
  const r = validateRequiredJobsPolicy(a);
  assert.equal(r.ok, true);
  assert.deepEqual(r.requiredJobs, ["Unit tests"]);
});

test("C8-DEV-L1-02: a custom iterator yielding 300 entries does not let an oversized policy bypass MAX_REQUIRED_JOBS -- the real (small) indexed content is used and the bound is checked against it", () => {
  const a = withIterator(["Unit tests"], function* () { for (let i = 0; i < 300; i++) yield `job-${i}`; });
  const r = validateRequiredJobsPolicy(a);
  assert.equal(r.ok, true);
  assert.deepEqual(r.requiredJobs, ["Unit tests"]);
});

test("C8-DEV-L1-03: a custom iterator yielding a different job name does not substitute the effective policy -- the real indexed job name is used", () => {
  const a = withIterator(["Unit tests"], function* () { yield "Totally Different Job"; });
  const r = validateRequiredJobsPolicy(a);
  assert.equal(r.ok, true);
  assert.deepEqual(r.requiredJobs, ["Unit tests"]);
});

test("C8-DEV-L1-04: a custom iterator yielding duplicate names does not manufacture a false DUPLICATE_REQUIRED_JOB_NAME rejection (or hide a real one) -- the real indexed, duplicate-free content is used and accepted", () => {
  const a = withIterator(["Unit tests", "Cypress - chrome"], function* () { yield "X"; yield "X"; });
  const r = validateRequiredJobsPolicy(a);
  assert.equal(r.ok, true);
  assert.deepEqual(r.requiredJobs, ["Unit tests", "Cypress - chrome"]);
});

test("C8-DEV-L1-05: an Array subclass overriding Symbol.iterator is treated identically -- the real indexed content is used, not the subclass's iterator", () => {
  class EvilArray extends Array {
    [Symbol.iterator]() { return (function* () { yield "SUBCLASS_JOB"; })(); }
  }
  const a = EvilArray.from(["Unit tests", "Cypress - chrome"]);
  assert.equal(Array.isArray(a), true);
  const r = validateRequiredJobsPolicy(a);
  assert.equal(r.ok, true);
  assert.deepEqual(r.requiredJobs, ["Unit tests", "Cypress - chrome"]);
});

test("C8-DEV-L1-06: an iterator that throws when invoked has no effect at all -- indexed reads never call Symbol.iterator, so a throwing iterator is simply never exercised", () => {
  const a = ["Unit tests"];
  a[Symbol.iterator] = function* () { throw new Error("iterator boom"); };
  const r = validateRequiredJobsPolicy(a);
  assert.equal(r.ok, true);
  assert.deepEqual(r.requiredJobs, ["Unit tests"]);
});

test("C8-DEV-L1-07: a sparse indexed array remains rejected (reconfirms the Corrective C7 sparse-array guard is unaffected by this corrective)", () => {
  const a = [];
  a.length = 2;
  a[1] = "Unit tests";
  const r = validateRequiredJobsPolicy(a);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MALFORMED_REQUIRED_JOB_POLICY");
});

test("C8-DEV-L1-08: getter-backed indexed entries are read exactly once", () => {
  let reads = 0;
  const a = ["Unit tests", "Cypress - chrome"];
  Object.defineProperty(a, "0", { enumerable: true, get() { reads += 1; return "Unit tests"; } });
  const r = validateRequiredJobsPolicy(a);
  assert.equal(r.ok, true);
  assert.equal(reads, 1, "index 0 must be read exactly once");
  assert.deepEqual(r.requiredJobs, ["Unit tests", "Cypress - chrome"]);
});

test("C8-DEV-L1-09: caller mutation of the original array after validation cannot change the accepted snapshot (reconfirms C7-L2-07/06 specifically against the new indexed-read path)", () => {
  const original = ["Unit tests", "Cypress - chrome"];
  const r = validateRequiredJobsPolicy(original);
  assert.equal(r.ok, true);
  original[0] = "Mutated After Validation";
  original.push("Extra After Validation");
  assert.deepEqual(r.requiredJobs, ["Unit tests", "Cypress - chrome"]);
  assert.equal(Object.isFrozen(r.requiredJobs), true);
});

test("C8-DEV-L1-10: exactly 256 valid, unique names remain accepted", () => {
  const names = Array.from({ length: 256 }, (_, i) => `job-${i}`);
  const r = validateRequiredJobsPolicy(names);
  assert.equal(r.ok, true);
  assert.equal(r.requiredJobs.length, 256);
});

test("C8-DEV-L1-11: 257 indexed entries remain rejected", () => {
  const names = Array.from({ length: 257 }, (_, i) => `job-${i}`);
  const r = validateRequiredJobsPolicy(names);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MALFORMED_REQUIRED_JOB_POLICY");
});

test("C8-DEV-L1-12: an exactly-200-character name remains accepted", () => {
  const name = "x".repeat(200);
  const r = validateRequiredJobsPolicy([name]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.requiredJobs, [name]);
});

test("C8-DEV-L1-13: a 201-character name remains rejected", () => {
  const name = "x".repeat(201);
  const r = validateRequiredJobsPolicy([name]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MALFORMED_REQUIRED_JOB_POLICY");
});

test("C8-DEV-L1-14: duplicate indexed job names (no iterator involved) remain rejected with the specific duplicate reason", () => {
  const r = validateRequiredJobsPolicy(["Unit tests", "Unit tests"]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "DUPLICATE_REQUIRED_JOB_NAME");
});

test("C8-DEV-L1-15: a throwing indexed getter fails with the canonical MALFORMED_REQUIRED_JOB_POLICY reason, never an uncaught exception", () => {
  const a = ["Unit tests", "Cypress - chrome"];
  Object.defineProperty(a, "1", { enumerable: true, get() { throw new Error("getter boom"); } });
  let r;
  assert.doesNotThrow(() => { r = validateRequiredJobsPolicy(a); });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MALFORMED_REQUIRED_JOB_POLICY");
});
