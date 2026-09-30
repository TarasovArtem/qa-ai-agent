"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRunEvidence, fetchValidatedRun, isGithubCiAdapter, resolveGithubCiAdapter, normalizeFetchFailureReason } = require("./ci-run");

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

const validRun = (overrides = {}) => ({
  repository: "TarasovArtem/qa-ai-agent", workflowPath: ".github/workflows/cypress.yml",
  runId: "123456", event: "pull_request", headSha: HEAD, attempt: 1, status: "completed",
  jobs: [{ name: "Unit tests", status: "completed", conclusion: "success" }],
  attemptHistory: [],
  ...overrides,
});

const request = (overrides = {}) => ({
  repository: "TarasovArtem/qa-ai-agent", workflowPath: ".github/workflows/cypress.yml", headSha: HEAD, event: "pull_request",
  ...overrides,
});

function adapter(runOrResult) {
  return { fetchRun: async () => (runOrResult && runOrResult.ok === false ? runOrResult : { ok: true, run: runOrResult }) };
}

// ---------------------------------------------------------------- validateRunEvidence()

test("a well-formed run validates", () => {
  const r = validateRunEvidence(validRun());
  assert.equal(r.ok, true);
  assert.equal(r.run.headSha, HEAD);
});

test("non-plain-object, missing field, or extra field is MALFORMED_RUN_SHAPE, never coerced", () => {
  for (const bad of [null, "x", 42, [], {}, { ...validRun(), extra: 1 }]) {
    assert.equal(validateRunEvidence(bad).ok, false, JSON.stringify(bad));
  }
  const missingField = validRun();
  delete missingField.attempt;
  assert.equal(validateRunEvidence(missingField).ok, false);
});

test("invalid repository identity format is rejected", () => {
  assert.equal(validateRunEvidence(validRun({ repository: "not valid" })).ok, false);
  assert.equal(validateRunEvidence(validRun({ repository: "" })).ok, false);
});

test("non-40-hex headSha is rejected", () => {
  assert.equal(validateRunEvidence(validRun({ headSha: "short" })).ok, false);
  assert.equal(validateRunEvidence(validRun({ headSha: HEAD.toUpperCase() })).ok, false);
});

test("event outside {pull_request, push} is rejected", () => {
  assert.equal(validateRunEvidence(validRun({ event: "workflow_dispatch" })).ok, false);
});

test("non-integer or out-of-range attempt is rejected", () => {
  for (const attempt of [0, -1, 1.5, "1", 100000]) assert.equal(validateRunEvidence(validRun({ attempt })).ok, false, String(attempt));
});

test("malformed job object (missing/extra field, bad conclusion) is rejected -- mandatory negative test #11", () => {
  assert.equal(validateRunEvidence(validRun({ jobs: [{ name: "x" }] })).ok, false);
  assert.equal(validateRunEvidence(validRun({ jobs: [{ name: "x", status: "completed", conclusion: "not-a-real-conclusion" }] })).ok, false);
  assert.equal(validateRunEvidence(validRun({ jobs: [{ name: "x", status: "completed", conclusion: "success", extra: 1 }] })).ok, false);
});

test("duplicate job names within one run are rejected as ambiguous, never silently resolved by picking one", () => {
  const r = validateRunEvidence(validRun({ jobs: [
    { name: "Unit tests", status: "completed", conclusion: "success" },
    { name: "Unit tests", status: "completed", conclusion: "failure" },
  ] }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "AMBIGUOUS_JOB_IDENTITY");
});

test("conflicting/malformed attempt history entries are rejected -- mandatory negative test #12", () => {
  assert.equal(validateRunEvidence(validRun({ attemptHistory: [{ attempt: 0, conclusion: "failure", failedJobs: [] }] })).ok, false);
  assert.equal(validateRunEvidence(validRun({ attemptHistory: [{ attempt: 1, conclusion: "failure" }] })).ok, false);
  assert.equal(validateRunEvidence(validRun({ attemptHistory: "not-an-array" })).ok, false);
});

test("oversized jobs or attemptHistory arrays are rejected outright, never truncated silently", () => {
  const manyJobs = Array.from({ length: 300 }, (_, i) => ({ name: `job-${i}`, status: "completed", conclusion: "success" }));
  assert.equal(validateRunEvidence(validRun({ jobs: manyJobs })).ok, false);
});

// ---------------------------------------------------------------- fetchValidatedRun()

test("a matching, well-formed run is accepted", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter(validRun()) });
  assert.equal(r.ok, true);
  assert.equal(r.run.headSha, HEAD);
});

test("wrong-SHA evidence is rejected even if otherwise well-formed -- mandatory negative test #1", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter(validRun({ headSha: OTHER_HEAD })) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "WRONG_SHA");
});

test("wrong-repository evidence is rejected -- mandatory negative test #2", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter(validRun({ repository: "someone-else/other-repo" })) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "WRONG_REPOSITORY");
});

test("correct SHA but wrong event is rejected -- mandatory negative test #3", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter(validRun({ event: "push" })) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "WRONG_EVENT");
});

test("correct head but a run object claiming a different workflow is rejected -- mandatory negative test #4", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter(validRun({ workflowPath: ".github/workflows/other.yml" })) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "WRONG_WORKFLOW");
});

test("required job missing entirely is not an error at THIS layer (job-set policy is stages/1f/required-jobs.js's job) -- run evidence with zero jobs still validates structurally", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter(validRun({ jobs: [] })) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.run.jobs, []);
});

test("API returns incomplete/malformed shape -> INCOMPLETE-class rejection, never coerced -- mandatory negative test #11", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter({ notARun: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MALFORMED_RUN_SHAPE");
});

test("adapter reports unreachable/not-found -> fails closed with the adapter's own reason", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: "NOT_FOUND" }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NOT_FOUND");
});

// ---------------------------------------------------------------- Corrective C7 (W4-C6R-DEV-L1): normalizeFetchFailureReason()
//
// Reproduction first (mission section 5): BEFORE this corrective, a
// fetch-failure `reason` was published verbatim from whatever an injected
// adapter returned -- an empty string, a 5000-character string, lowercase
// text, or non-string garbage would all reach stages/1f/report.js's Shape A
// validation (`isBoundedString(o.reason, 200)`, non-empty, <=200 chars)
// exactly as the adapter wrote them, and a value outside that bound made the
// collector produce a record report.js would then reject as malformed --
// the two modules disagreeing about the same record's validity. C7-L1-01/02
// below reproduce that exact defect against the CURRENT, fixed behavior
// (normalization now closes the gap; these are permanent regressions, not a
// one-time repro script).

test("C7-L1-01: an empty-string adapter reason (would violate report.js's non-empty Shape A bound if published verbatim) is normalized to the fixed fallback", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: "" }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "SOURCE_UNREACHABLE");
});

test("C7-L1-02: a 201-character adapter reason (would violate report.js's <=200-char Shape A bound if published verbatim) is normalized to the fixed fallback", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: "X".repeat(201) }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "SOURCE_UNREACHABLE");
});

test("C7-L1-03: a very long (5000-character) adapter reason is normalized to the fixed fallback, never echoed at length", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: "Y".repeat(5000) }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "SOURCE_UNREACHABLE");
});

test("C7-L1-04: a lowercase or mixed-case adapter reason (non-canonical shape) is normalized to the fixed fallback", async () => {
  for (const bad of ["not_found", "Not_Found", "notFound"]) {
    const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: bad }) });
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, "SOURCE_UNREACHABLE", bad);
  }
});

test("C7-L1-05: an adapter reason containing non-canonical characters (spaces, punctuation, markup) is normalized to the fixed fallback, never published as free text", async () => {
  for (const bad of ["NOT FOUND", "<script>alert(1)</script>", "rate-limited!", "NOT_FOUND.", "a".repeat(1) + " "]) {
    const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: bad }) });
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, "SOURCE_UNREACHABLE", bad);
  }
});

test("C7-L1-06: a non-string adapter reason (number, object, array, null, or a missing field entirely) is normalized to the fixed fallback, never coerced or thrown", async () => {
  for (const bad of [404, { message: "nope" }, ["NOT_FOUND"], null, undefined]) {
    const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: bad }) });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.reason, "SOURCE_UNREACHABLE", JSON.stringify(bad));
  }
  const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "SOURCE_UNREACHABLE");
});

test("C7-L1-07: a canonical, bounded, uppercase adapter reason is passed through unchanged", async () => {
  for (const good of ["NOT_FOUND", "RATE_LIMITED", "SOURCE_UNREACHABLE", "A"]) {
    const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: good }) });
    assert.equal(r.ok, false, good);
    assert.equal(r.reason, good, good);
  }
});

test("C7-L1-08: a canonical reason exactly at the 64-character pattern bound is passed through unchanged; one character over is normalized", () => {
  const atBound = "A" + "B".repeat(63);
  assert.equal(atBound.length, 64);
  assert.equal(normalizeFetchFailureReason(atBound), atBound);
  const overBound = atBound + "C";
  assert.equal(normalizeFetchFailureReason(overBound), "SOURCE_UNREACHABLE");
});

test("C7-L1-09: an adapter-supplied reason claiming one of the four internal-only WRONG_* codes in an {ok:false} response is normalized to the fixed fallback, never published verbatim", async () => {
  for (const spoofed of ["WRONG_REPOSITORY", "WRONG_SHA", "WRONG_EVENT", "WRONG_WORKFLOW"]) {
    const r = await fetchValidatedRun({ ...request(), adapter: adapter({ ok: false, reason: spoofed }) });
    assert.equal(r.ok, false, spoofed);
    assert.equal(r.reason, "SOURCE_UNREACHABLE", spoofed);
    assert.equal(normalizeFetchFailureReason(spoofed), "SOURCE_UNREACHABLE", spoofed);
  }
});

test("C7-L1-10: a genuine, internally-detected WRONG_* mismatch (a successfully fetched, fully validated run whose fields do not match the request) still produces the exact WRONG_* code -- the exclusion in normalizeFetchFailureReason() only blocks adapter-SUPPLIED text, never the internal identity-comparison codes", async () => {
  const r = await fetchValidatedRun({ ...request(), adapter: adapter(validRun({ headSha: OTHER_HEAD })) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "WRONG_SHA");
});

test("adapter throws -> fails closed, never an uncaught exception", async () => {
  const throwing = { fetchRun: async () => { throw new Error("boom"); } };
  await assert.doesNotReject(fetchValidatedRun({ ...request(), adapter: throwing }));
  const r = await fetchValidatedRun({ ...request(), adapter: throwing });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "ADAPTER_THREW");
});

test("no adapter available (neither injected nor resolvable) -> NO_ADAPTER_AVAILABLE, never silently skipped", async () => {
  const r = await fetchValidatedRun({ ...request() });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NO_ADAPTER_AVAILABLE");
});

test("malformed request (bad SHA, bad repository, bad event) fails closed before the adapter is ever called", async () => {
  const neverCalled = { fetchRun: async () => { throw new Error("must not be called for a malformed request"); } };
  for (const bad of [
    { ...request(), headSha: "short" },
    { ...request(), repository: "not valid" },
    { ...request(), event: "workflow_dispatch" },
  ]) {
    const r = await fetchValidatedRun({ ...bad, adapter: neverCalled });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "MALFORMED_REQUEST");
  }
});

test("never throws on a fully hostile input object", async () => {
  for (const bad of [null, undefined, 42, [], { adapter: {} }]) {
    await assert.doesNotReject(fetchValidatedRun(bad));
  }
});

test("isGithubCiAdapter / resolveGithubCiAdapter reject a non-adapter shape", () => {
  assert.equal(isGithubCiAdapter({}), false);
  assert.equal(isGithubCiAdapter({ fetchRun: "not-a-function" }), false);
  assert.equal(isGithubCiAdapter(adapter(validRun())), true);
  assert.equal(resolveGithubCiAdapter({}).ok, false);
  assert.equal(resolveGithubCiAdapter({ githubCi: adapter(validRun()) }).ok, true);
});

test("five repeated fetches of an identical fixture are deterministic", async () => {
  const outs = [];
  for (let i = 0; i < 5; i++) outs.push(JSON.stringify(await fetchValidatedRun({ ...request(), adapter: adapter(validRun()) })));
  assert.equal(new Set(outs).size, 1);
});

// ---------------------------------------------------------------- Corrective C6 (W4-C4R-INFO-4): no stale live-provider claim

test("W4-C4R-INFO-4: the module header no longer claims a live GitHub adapter is provided for actual use, and explicitly states none is implemented", () => {
  const fs = require("node:fs");
  const text = fs.readFileSync(__filename.replace(/\.test\.js$/, ".js"), "utf8");
  // The stale claim this corrective removes: that createGithubCliAdapter()
  // (or an equivalent) is PROVIDED / EXISTS for actual use. A mention of the
  // name in a NEGATIVE disclaimer ("there is no createGithubCliAdapter()")
  // is the corrected state, not the stale claim, so this checks the specific
  // stale phrasing is gone rather than blanket-forbidding the identifier.
  assert.equal(/is provided by .*createGithubCliAdapter/i.test(text), false);
  assert.equal(/createGithubCliAdapter\(\) for actual use/.test(text), false);
  assert.equal(/does NOT implement or provide a live GitHub adapter/.test(text), true);
});
