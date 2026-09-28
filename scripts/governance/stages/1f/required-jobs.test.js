"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRequiredJobs } = require("./required-jobs");

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
