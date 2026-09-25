"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { createTempRepo, basePolicy, prContext, postMergeContext, platformList, gitOptions, fakeAdapter, makeSubject } = require("../../test-support-git");
const { validateResultRecord } = require("../../kernel/results");

const subject = makeSubject();
const rec = (result, id) => result.records.find((r) => r.checkId === id);
const state = (result, id) => {
  const r = rec(result, id);
  return r ? `${r.status}/${r.reasonCode}` : "MISSING";
};
const listing = (paths, invalid = 0) => fakeAdapter({ diffNames: async () => ({ ok: true, value: { paths, invalid } }) });
const changed = (paths, extra = {}, adapter = listing(paths)) => g.getChangedFiles({ subject, git: adapter, invocationTrust: "PLATFORM_AUTHENTICATED", platformFiles: platformList(paths), ...extra });

test("W1 1A diff: equal Git and platform SETS agree and the result is frozen, sorted and Wave 0 valid", async () => {
  const r = await changed(["b.md", "a.md", "docs/c.md"]);
  assert.deepEqual([...r.files], ["a.md", "b.md", "docs/c.md"]);
  assert.equal(r.complete, true);
  assert.equal(r.emptyDiffConfirmed, false);
  assert.equal(state(r, "1A.DIFF.CHANGED_FILES"), "PASS/OK");
  assert.equal(state(r, "1A.DIFF.PLATFORM_AGREEMENT"), "PASS/OK");
  assert.deepEqual(r.subject, subject);
  for (const record of r.records) assert.equal(validateResultRecord(record).ok, true, record.checkId);
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.files), true);
  assert.throws(() => r.files.push("x"), TypeError);
  assert.equal(g.aggregate(r.records.map((x) => x)).kernelRecords.some((k) => k.reasonCode === "RESULT_RECORD_INVALID"), false);
});

test("W1 1A diff: ordering is bytewise (UTF-8), independent of locale and of Git's listing order", async () => {
  const astral = "\u{1F600}.md";
  const bmp = "\uFF5E.md";
  const r = await changed([astral, bmp, "b", "B", "a", "é", "e"], { platformFiles: platformList([bmp, astral, "e", "é", "a", "B", "b"]) });
  assert.deepEqual([...r.files], ["B", "a", "b", "e", "é", bmp, astral]);
  assert.equal(state(r, "1A.DIFF.PLATFORM_AGREEMENT"), "PASS/OK");
});

test("W1 1A diff: paths keep Git's byte-exact, case-sensitive, non-normalized identity (aliases stay distinct and mismatch)", async () => {
  const nfc = "\u00e9.md";
  const nfd = "e\u0301.md";
  const r = await changed(["A.md", "a.md", nfc, nfd], { platformFiles: platformList(["A.md", "a.md", nfc, nfd]) });
  assert.deepEqual([...r.files], ["A.md", "a.md", "e\u0301.md", "\u00e9.md"]);
  assert.equal(r.complete, true, "four distinct paths, no normalization");
  const aliasMismatch = await changed(["a.md"], { platformFiles: platformList(["A.md"]) });
  assert.equal(state(aliasMismatch, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/DIFF_PATHS_MISMATCH", "case-only difference is a mismatch, never folded");
  const normMismatch = await changed([nfc], { platformFiles: platformList([nfd]) });
  assert.equal(state(normMismatch, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/DIFF_PATHS_MISMATCH", "normalization-form difference is a mismatch, never normalized");
  assert.equal(normMismatch.complete, false);
});

test("W1 1A diff: equal COUNTS with different paths are never agreement", async () => {
  const r = await changed(["a.md", "b.md"], { platformFiles: platformList(["a.md", "c.md"]) });
  assert.equal(state(r, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/DIFF_PATHS_MISMATCH");
  assert.equal(r.complete, false);
  const obs = rec(r, "1A.DIFF.PLATFORM_AGREEMENT").observed;
  assert.deepEqual([...obs.onlyInGit], ["b.md"]);
  assert.deepEqual([...obs.onlyInPlatform], ["c.md"]);
  assert.equal(g.aggregate(r.records).readiness.state, "NOT_READY");
});

test("W1 1A diff: an incomplete platform list is proven incomplete BEFORE any comparison and is never compared", async () => {
  const paths = ["a.md", "b.md"];
  const cases = {
    "pagination not exhausted": [platformList(paths, { paginationExhausted: false }), "PLATFORM_FILE_LIST_INCOMPLETE"],
    "received fewer than reported": [platformList(paths, { reportedCount: 3 }), "PLATFORM_FILE_LIST_INCOMPLETE"],
    "received more than reported": [platformList(paths, { reportedCount: 1 }), "PLATFORM_FILE_LIST_INCOMPLETE"],
    "documented list limit reached": [platformList(paths, { listLimit: 2 }), "PLATFORM_FILE_LIST_INCOMPLETE"],
    "limit exceeded": [platformList(paths, { listLimit: 1 }), "PLATFORM_FILE_LIST_INCOMPLETE"],
    "duplicate path entry": [platformList(["a.md", "a.md", "b.md"]), "PLATFORM_FILE_LIST_ANOMALY"],
  };
  for (const [label, [platform, reason]] of Object.entries(cases)) {
    const r = await changed(paths, { platformFiles: platform });
    assert.equal(state(r, "1A.DIFF.PLATFORM_AGREEMENT"), `INCOMPLETE/${reason}`, label);
    assert.equal(r.complete, false, label);
    assert.equal(rec(r, "1A.DIFF.PLATFORM_AGREEMENT").observed.onlyInGit, undefined, `${label}: a partial list is never compared`);
  }
  // A truncated list that happens to be a subset must not pass either.
  const subset = await changed(["a.md", "b.md", "c.md"], { platformFiles: platformList(["a.md", "b.md"], { reportedCount: 3 }) });
  assert.equal(state(subset, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/PLATFORM_FILE_LIST_INCOMPLETE");
});

test("W1 1A diff: a duplicate provider path is an anomaly and is never normalized away by a set conversion", async () => {
  const r = await changed(["a.md"], { platformFiles: platformList(["a.md", "a.md"]) });
  assert.equal(state(r, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/PLATFORM_FILE_LIST_ANOMALY");
  assert.deepEqual([...rec(r, "1A.DIFF.PLATFORM_AGREEMENT").observed.duplicates], ["a.md"]);
});

test("W1 1A diff: a rename contributes BOTH paths on both sides (the provider previous path is added to the platform set)", async () => {
  const renamed = { path: "docs/new.md", previousPath: "docs/old.md" };
  const ok = await changed(["docs/new.md", "docs/old.md"], { platformFiles: platformList([renamed]) });
  assert.equal(state(ok, "1A.DIFF.PLATFORM_AGREEMENT"), "PASS/OK");
  const missingPrev = await changed(["docs/new.md", "docs/old.md"], { platformFiles: platformList([{ path: "docs/new.md", previousPath: null }]) });
  assert.equal(state(missingPrev, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/DIFF_PATHS_MISMATCH", "a provider that omits the previous path disagrees with Git");
});

test("W1 1A diff: an empty diff is confirmed only when the COMPLETE platform list is also empty", async () => {
  const both = await changed([], { platformFiles: platformList([]) });
  assert.equal(state(both, "1A.DIFF.PLATFORM_AGREEMENT"), "PASS/EMPTY_DIFF_CONFIRMED");
  assert.equal(both.emptyDiffConfirmed, true);
  assert.equal(both.complete, true);
  assert.deepEqual([...both.files], []);
  const gitEmpty = await changed([], { platformFiles: platformList(["a.md"]) });
  assert.equal(state(gitEmpty, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/DIFF_EMPTY_UNEXPECTED");
  assert.equal(gitEmpty.complete, false);
  const platformEmpty = await changed(["a.md"], { platformFiles: platformList([]) });
  assert.equal(state(platformEmpty, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/DIFF_PATHS_MISMATCH");
  const incompleteEmpty = await changed([], { platformFiles: platformList([], { paginationExhausted: false }) });
  assert.equal(state(incompleteEmpty, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/PLATFORM_FILE_LIST_INCOMPLETE");
  const noPlatformEmpty = await changed([], { platformFiles: null });
  assert.equal(state(noPlatformEmpty, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/DIFF_EMPTY_UNEXPECTED", "an empty Git diff cannot be confirmed without the platform list");
  assert.equal(g.aggregate(gitEmpty.records).readiness.state, "NOT_READY");
});

test("W1 1A diff: a missing platform list is INCOMPLETE for a platform run and not applicable for a non-empty operator run", async () => {
  const platformRun = await changed(["a.md"], { platformFiles: null });
  assert.equal(state(platformRun, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/PLATFORM_FILE_LIST_INCOMPLETE");
  assert.equal(platformRun.complete, false);
  const operator = await changed(["a.md"], { platformFiles: null, invocationTrust: "OPERATOR_SUPPLIED" });
  assert.equal(state(operator, "1A.DIFF.PLATFORM_AGREEMENT"), "NOT_APPLICABLE/OK");
  assert.equal(operator.complete, true);
  const malformed = await changed(["a.md"], { platformFiles: { entries: "nope" } });
  assert.equal(state(malformed, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/PLATFORM_FILE_LIST_ANOMALY");
});

test("W1 1A diff: non-canonical paths are CONFIGURATION_ERROR and are rejected, never repaired", async () => {
  for (const bad of ["../escape.md", "a/../../x", "/etc/passwd", "./leading.md", "a//b", "dir/", "a\\b.md", "a\u0000b", "a\nb", "C:/x", "c:\\x", "\u007f"]) {
    const r = await changed(["ok.md", bad], { platformFiles: null, invocationTrust: "OPERATOR_SUPPLIED" });
    assert.equal(state(r, "1A.DIFF.CHANGED_FILES"), "CONFIGURATION_ERROR/CHANGED_PATH_INVALID", JSON.stringify(bad));
    assert.deepEqual([...r.files], [], "no partially-trusted file list is returned");
    assert.equal(r.complete, false);
  }
  const nonUtf8 = await changed([], { platformFiles: null, invocationTrust: "OPERATOR_SUPPLIED" }, listing(["a.md"], 1));
  assert.equal(state(nonUtf8, "1A.DIFF.CHANGED_FILES"), "CONFIGURATION_ERROR/CHANGED_PATH_INVALID", "an invalid UTF-8 path is rejected");
  const platformBad = await changed(["a.md"], { platformFiles: platformList(["a.md", "../x"]) });
  assert.equal(state(platformBad, "1A.DIFF.PLATFORM_AGREEMENT"), "CONFIGURATION_ERROR/CHANGED_PATH_INVALID");
  const previousBad = await changed(["a.md"], { platformFiles: platformList([{ path: "a.md", previousPath: "/abs" }]) });
  assert.equal(state(previousBad, "1A.DIFF.PLATFORM_AGREEMENT"), "CONFIGURATION_ERROR/CHANGED_PATH_INVALID");
});

test("W1 1A diff: mode, from and to are explicit inputs that must equal the subject range", async () => {
  const mismatches = [{ mode: "POST_MERGE" }, { from: "d".repeat(40) }, { to: "d".repeat(40) }, { mode: "NOPE" }];
  for (const m of mismatches) {
    const r = await changed(["a.md"], m);
    assert.equal(state(r, "1A.DIFF.CHANGED_FILES"), "CONFIGURATION_ERROR/TRUSTED_CONTEXT_INVALID", JSON.stringify(m));
    assert.deepEqual([...r.files], []);
  }
  const explicit = await changed(["a.md"], { mode: "PR_REVIEW", from: subject.range.from, to: subject.range.to });
  assert.equal(explicit.complete, true);
});

test("W1 1A diff: an invalid subject, a Git failure or an unusable adapter fail closed", async () => {
  for (const bad of [null, {}, { ...subject, head: "abc" }, { ...subject, range: { mode: "PR_REVIEW", from: "x", to: "y" } }, { head: subject.head }]) {
    const r = await g.getChangedFiles({ subject: bad, git: listing([]) });
    assert.equal(r.subject, null);
    assert.deepEqual([...r.records], []);
    assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
    assert.equal(r.complete, false);
  }
  assert.equal((await g.getChangedFiles(null)).complete, false);
  const failing = await g.getChangedFiles({ subject, git: fakeAdapter(), platformFiles: platformList([]) });
  assert.equal(state(failing, "1A.DIFF.CHANGED_FILES"), "INCOMPLETE/DIFF_COMPUTATION_FAILED");
  const noAdapter = await g.getChangedFiles({ subject });
  assert.equal(state(noAdapter, "1A.DIFF.CHANGED_FILES"), "INCOMPLETE/DIFF_COMPUTATION_FAILED");
  const tooMany = await g.getChangedFiles({ subject, git: listing(Array.from({ length: 100_001 }, (_, i) => `f/${i}.md`)), platformFiles: null, invocationTrust: "OPERATOR_SUPPLIED" });
  assert.equal(state(tooMany, "1A.DIFF.CHANGED_FILES"), "INCOMPLETE/DIFF_COMPUTATION_FAILED");
});

test("W1 1A diff: POST_MERGE computes first-parent..merge and compares no platform list", async () => {
  const mergeSubject = makeSubject({ range: { mode: "POST_MERGE", from: subject.base, to: subject.head } });
  const r = await g.getChangedFiles({ subject: mergeSubject, git: listing(["z.md", "a.md"]) });
  assert.deepEqual([...r.files], ["a.md", "z.md"]);
  assert.equal(state(r, "1A.DIFF.PLATFORM_AGREEMENT"), "NOT_APPLICABLE/OK");
  assert.equal(r.complete, true);
  assert.equal(rec(r, "1A.DIFF.CHANGED_FILES").observed.mode, "POST_MERGE");
});

test("W1 1A diff: against a real repository the set is computed once from Git for the exact range (renames, spaces, Unicode)", async () => {
  const repo = createTempRepo();
  try {
    repo.commit("base", { "README.md": "r\n", "governance/base.json": JSON.stringify(basePolicy()), "docs/old name.md": "o\n", "docs/keep.md": "k\n" });
    repo.checkout("feature", true);
    repo.git("mv", "docs/old name.md", "docs/new name.md");
    repo.write("é/ü.md", "u\n");
    repo.write("docs/keep.md", "k2\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "head");
    const head = repo.sha("HEAD");
    const identity = await g.getGitIdentity({ trustedContext: prContext(head), ...gitOptions(repo) });
    assert.equal(identity.established, true);
    const files = await g.getChangedFiles({ subject: identity.subject, invocationTrust: "PLATFORM_AUTHENTICATED", platformFiles: platformList(["docs/keep.md", { path: "docs/new name.md", previousPath: "docs/old name.md" }, "é/ü.md"]), ...gitOptions(repo) });
    assert.deepEqual([...files.files], ["docs/keep.md", "docs/new name.md", "docs/old name.md", "é/ü.md"]);
    assert.equal(files.complete, true);
    assert.equal(state(files, "1A.DIFF.PLATFORM_AGREEMENT"), "PASS/OK");
  } finally {
    repo.cleanup();
  }
});

test("W1 1A diff: against a real repository POST_MERGE lists exactly the merged PR's files", async () => {
  const repo = createTempRepo();
  try {
    repo.commit("base", { "README.md": "r\n", "governance/base.json": JSON.stringify(basePolicy()) });
    repo.checkout("feature", true);
    const head = repo.commit("head", { "docs/a.md": "a\n", "docs/b.md": "b\n" });
    repo.checkout("main");
    repo.git("merge", "--no-ff", "-q", "-m", "merge", "feature");
    const merge = repo.sha("HEAD");
    const identity = await g.getGitIdentity({ trustedContext: postMergeContext(merge, head), ...gitOptions(repo) });
    assert.equal(identity.established, true);
    const files = await g.getChangedFiles({ subject: identity.subject, ...gitOptions(repo) });
    assert.deepEqual([...files.files], ["docs/a.md", "docs/b.md"]);
  } finally {
    repo.cleanup();
  }
});
