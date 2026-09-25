"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateTrustedContext, isValidBranchName } = require("./trusted-context");
const { prContext, postMergeContext, platformList } = require("../../test-support-git");

const H = "a".repeat(40);
const ok = (raw) => validateTrustedContext(raw);
const bad = (raw, label) => {
  const r = validateTrustedContext(raw);
  assert.equal(r.ok, false, label);
  assert.equal(r.context, null);
  return r;
};

test("W1 1A context: a complete platform PR context validates and is frozen", () => {
  const r = ok(prContext(H, { suppliedTargetSha: "b".repeat(40), workflow: { path: ".github/workflows/ci.yml", sha: "c".repeat(40) }, platformFiles: platformList(["a.md"]) }));
  assert.equal(r.ok, true);
  assert.equal(Object.isFrozen(r.context), true);
  assert.equal(r.context.mode, "PR_REVIEW");
});

test("W1 1A context: SHAs must be full lowercase 40-hex (abbreviated, uppercase and malformed rejected)", () => {
  for (const sha of ["abc1234", "A".repeat(40), "g".repeat(40), "a".repeat(39), "a".repeat(41), "", null, 5, "a".repeat(40) + "\n"]) {
    bad(prContext(sha), `headSha ${JSON.stringify(sha)}`);
    bad(prContext(H, { suppliedTargetSha: sha === null ? "x" : sha }), `suppliedTargetSha ${JSON.stringify(sha)}`);
  }
  bad(prContext(H, { workflow: { path: "w.yml", sha: "abc" } }), "workflow sha");
});

test("W1 1A context: mode, trust and event type must agree; unknown fields are rejected", () => {
  bad(prContext(H, { mode: "MERGE" }), "mode");
  bad(prContext(H, { invocationTrust: "TRUSTED" }), "trust");
  bad(prContext(H, { eventType: "push" }), "PR needs pull_request");
  bad(postMergeContext(H, H, { eventType: "pull_request" }), "post-merge needs push");
  assert.equal(ok(prContext(H, { invocationTrust: "OPERATOR_SUPPLIED", eventType: "manual" })).ok, true);
  bad(prContext(H, { eventType: "manual" }), "manual event needs operator trust");
  bad({ ...prContext(H), shell: "true" }, "unknown field");
  bad({ ...prContext(H), extra: 1 }, "unknown field 2");
  bad(null, "null");
  bad("ctx", "string");
  const missing = prContext(H);
  delete missing.provider;
  bad(missing, "missing provider");
});

test("W1 1A context: POST_MERGE requires the platform-recorded merged head; PR forbids it", () => {
  assert.equal(ok(postMergeContext(H, "b".repeat(40))).ok, true);
  bad(postMergeContext(H, null), "post-merge without merged head");
  bad(postMergeContext(H, "abc"), "post-merge with abbreviated merged head");
  bad(prContext(H, { mergedPrHeadSha: "b".repeat(40) }), "PR with merged head");
  bad(postMergeContext(H, "b".repeat(40), { platformFiles: platformList([]) }), "post-merge with platform files");
});

test("W1 1A context: branch names are exact platform names (no wildcard, whitespace, control or git-special characters)", () => {
  for (const name of ["main", "release/1.0", "feature/x-y_z", "a.b", "v1"]) assert.equal(isValidBranchName(name), true, name);
  for (const name of ["", " main", "main ", "ma in", "ma\tin", "ma\nin", "*", "release/*", "a?b", "a[b]", "a~b", "a^b", "a:b", "a\\b", "..", "a..b", "a//b", "a@{b", "-x", "/x", "x/", "x.", "x.lock", "@", "x".repeat(256), null, 5, {}]) {
    assert.equal(isValidBranchName(name), false, JSON.stringify(name));
  }
  bad(prContext(H, { targetRefName: "main*" }), "wildcard target");
  bad(prContext(H, { defaultBranchName: "" }), "empty default branch");
});

test("W1 1A context: provider and repository identity have fixed shapes", () => {
  for (const provider of ["", "GitHub", "git hub", "g", "x".repeat(40), null]) bad(prContext(H, { provider }), `provider ${provider}`);
  for (const repositoryId of ["", "owner", "owner/", "/repo", "a/b/c", "o w/r", "o/r\n", null]) bad(prContext(H, { repositoryId }), `repo ${repositoryId}`);
});

test("W1 1A context: the platform changed-file list has a strict shape", () => {
  const list = platformList(["a.md"]);
  assert.equal(ok(prContext(H, { platformFiles: list })).ok, true);
  bad(prContext(H, { platformFiles: { ...list, reportedCount: -1 } }), "negative count");
  bad(prContext(H, { platformFiles: { ...list, paginationExhausted: "yes" } }), "non-boolean pagination");
  bad(prContext(H, { platformFiles: { ...list, listLimit: 0 } }), "zero limit");
  bad(prContext(H, { platformFiles: { ...list, entries: "a.md" } }), "entries not array");
  bad(prContext(H, { platformFiles: { ...list, entries: [{ path: "a.md" }] } }), "entry without previousPath");
  bad(prContext(H, { platformFiles: { ...list, entries: [{ path: "a.md", previousPath: 5 }] } }), "entry previousPath type");
  bad(prContext(H, { platformFiles: { ...list, extra: 1 } }), "unknown platformFiles field");
  bad(prContext(H, { platformFiles: { ...list, entries: Array(5001).fill({ path: "a", previousPath: null }) } }), "too many entries");
});

test("W1 1A context: problem labels are fixed strings and never echo caller text", () => {
  const evil = "SECRET-TOKEN-VALUE\n" + "x".repeat(500);
  const r = validateTrustedContext(prContext(H, { targetRefName: evil, provider: evil, repositoryId: evil }));
  assert.equal(r.ok, false);
  const text = r.problems.join("|");
  assert.equal(text.includes("SECRET"), false);
  assert.equal(text.includes("\n"), false);
  assert.ok(text.length < 400);
});
