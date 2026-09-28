"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyCiEvidence, CLASSIFICATIONS } = require("./ci-classify");

const complete = (allSucceeded) => ({ ok: true, complete: true, allSucceeded, missing: [], failed: allSucceeded ? [] : ["X"], pending: [], skipped: [], succeeded: [] });
const incomplete = (extra = {}) => ({ ok: true, complete: false, allSucceeded: false, missing: [], failed: [], pending: [], skipped: [], succeeded: [], ...extra });

test("attempt 1, no rerun, every required job succeeded -> CLEAN_FIRST_PASS", () => {
  const r = classifyCiEvidence({ requiredJobCheck: complete(true), attempt: 1, attemptHistory: [] });
  assert.equal(r.classification, "CLEAN_FIRST_PASS");
});

test("attempt 1, a required job failed -> FAIL, never CLEAN_FIRST_PASS", () => {
  const r = classifyCiEvidence({ requiredJobCheck: complete(false), attempt: 1, attemptHistory: [] });
  assert.equal(r.classification, "FAIL");
  assert.equal(r.reasonCode, "CI_REQUIRED_JOB_FAILED");
});

test("attempt 1, a required job missing or pending -> INCOMPLETE, never a false pass", () => {
  const r = classifyCiEvidence({ requiredJobCheck: incomplete({ missing: ["X"] }), attempt: 1, attemptHistory: [] });
  assert.equal(r.classification, "INCOMPLETE");
});

test("a rerun occurred (attempt > 1), final attempt fully succeeded, no determination -> HUMAN_REVIEW_REQUIRED, never an automatic pass", () => {
  const r = classifyCiEvidence({ requiredJobCheck: complete(true), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }] });
  assert.equal(r.classification, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.reasonCode, "CI_UNEXPLAINED_RERUN");
});

test("a rerun occurred, final attempt succeeded, an accepted SEPARATE_PERSON determination -> PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN", () => {
  const r = classifyCiEvidence({
    requiredJobCheck: complete(true), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }],
    determination: { accepted: true, mode: "SEPARATE_PERSON" },
  });
  assert.equal(r.classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
});

test("a rerun occurred, final attempt succeeded, an accepted OWNER_ATTESTED determination -> capped at HUMAN_REVIEW_REQUIRED, never promoted to SEPARATE_PERSON authority", () => {
  const r = classifyCiEvidence({
    requiredJobCheck: complete(true), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }],
    determination: { accepted: true, mode: "OWNER_ATTESTED" },
  });
  assert.equal(r.classification, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.reasonCode, "OWNER_SELF_DETERMINATION");
  assert.notEqual(r.classification, "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN");
});

test("a determination that is present but not accepted is treated exactly like no determination at all", () => {
  const r = classifyCiEvidence({
    requiredJobCheck: complete(true), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }],
    determination: { accepted: false, mode: "SEPARATE_PERSON" },
  });
  assert.equal(r.classification, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.reasonCode, "CI_UNEXPLAINED_RERUN");
});

test("a determination with an unrecognized mode is never trusted", () => {
  const r = classifyCiEvidence({
    requiredJobCheck: complete(true), attempt: 2, attemptHistory: [],
    determination: { accepted: true, mode: "SOMETHING_ELSE" },
  });
  assert.equal(r.classification, "HUMAN_REVIEW_REQUIRED");
  assert.equal(r.reasonCode, "CI_UNEXPLAINED_RERUN");
});

test("attemptHistory alone signaling a rerun (attempt still reported as 1) is honored -- hadRerun is not solely attempt-number-driven", () => {
  const r = classifyCiEvidence({ requiredJobCheck: complete(true), attempt: 1, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }] });
  assert.equal(r.classification, "HUMAN_REVIEW_REQUIRED");
});

test("a rerun with the final attempt still failing -> FAIL, a determination cannot rescue a genuinely failing final attempt", () => {
  const r = classifyCiEvidence({
    requiredJobCheck: complete(false), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }],
    determination: { accepted: true, mode: "SEPARATE_PERSON" },
  });
  assert.equal(r.classification, "FAIL");
});

test("malformed requiredJobCheck (not ok) -> INCOMPLETE, never thrown, never FAIL", () => {
  const r = classifyCiEvidence({ requiredJobCheck: { ok: false }, attempt: 1, attemptHistory: [] });
  assert.equal(r.classification, "INCOMPLETE");
});

test("malformed attempt number -> INCOMPLETE", () => {
  for (const attempt of [0, -1, 1.5, "1", null, undefined]) {
    const r = classifyCiEvidence({ requiredJobCheck: complete(true), attempt, attemptHistory: [] });
    assert.equal(r.classification, "INCOMPLETE", String(attempt));
  }
});

test("malformed attemptHistory -> INCOMPLETE", () => {
  const r = classifyCiEvidence({ requiredJobCheck: complete(true), attempt: 1, attemptHistory: "not-an-array" });
  assert.equal(r.classification, "INCOMPLETE");
});

test("never throws on a fully hostile input object", () => {
  for (const bad of [null, undefined, 42, [], {}]) {
    assert.doesNotThrow(() => classifyCiEvidence(bad));
  }
});

test("every returned classification is one of the exact five canonical values", () => {
  const fixtures = [
    { requiredJobCheck: complete(true), attempt: 1, attemptHistory: [] },
    { requiredJobCheck: complete(false), attempt: 1, attemptHistory: [] },
    { requiredJobCheck: incomplete(), attempt: 1, attemptHistory: [] },
    { requiredJobCheck: complete(true), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }] },
    { requiredJobCheck: complete(true), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }], determination: { accepted: true, mode: "SEPARATE_PERSON" } },
    null,
  ];
  for (const f of fixtures) assert.ok(CLASSIFICATIONS.includes(classifyCiEvidence(f).classification), JSON.stringify(f));
});

test("five repeated classifications of an identical fixture are deterministic", () => {
  const fixture = { requiredJobCheck: complete(true), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["X"] }], determination: { accepted: true, mode: "SEPARATE_PERSON" } };
  const outs = Array.from({ length: 5 }, () => JSON.stringify(classifyCiEvidence(fixture)));
  assert.equal(new Set(outs).size, 1);
});
