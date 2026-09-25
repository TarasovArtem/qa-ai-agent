"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { basePolicy, changedResult, makeSubject } = require("../../test-support-git");
const { validateBasePolicy, BUILTIN_MINIMUM_POLICY } = require("./policy");
const { validateResultRecord } = require("../../kernel/results");

const subject = makeSubject();
const policy = validateBasePolicy(basePolicy()).policy; // allowed: docs/**, src/**, README.md ; forbidden: secrets/** ; protected: governance/**, scripts/governance/**, .github/workflows/**
const rec = (result, id) => result.records.find((r) => r.checkId === id);
const state = (result, id) => {
  const r = rec(result, id);
  return r ? `${r.status}/${r.reasonCode}` : "MISSING";
};
const scope = (files, extra = {}) => g.checkScope({ subject, changedFiles: changedResult(subject, files), policy, ...extra });

test("W1 1A scope: an in-scope change passes every scope check and the records are Wave 0 valid", () => {
  const r = scope(["docs/a.md", "src/x/y.js", "README.md"]);
  assert.equal(r.outcome, null);
  for (const id of ["1A.SCOPE.FORBIDDEN", "1A.SCOPE.ALLOWED", "1A.SCOPE.PROTECTED"]) assert.equal(state(r, id), "PASS/OK", id);
  assert.equal(state(r, "1A.SCOPE.PROPOSAL"), "NOT_APPLICABLE/OK");
  for (const record of r.records) {
    assert.equal(validateResultRecord(record).ok, true, record.checkId);
    assert.equal(record.ownerStage, "1A");
  }
  assert.equal(g.aggregate(r.records).readiness.state, "READY");
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.records), true);
});

test("W1 1A scope: a forbidden path is FAIL and is reported with the path", () => {
  const r = scope(["docs/a.md", "secrets/key.txt"]);
  assert.equal(state(r, "1A.SCOPE.FORBIDDEN"), "FAIL/SCOPE_FORBIDDEN_PATH");
  assert.deepEqual([...rec(r, "1A.SCOPE.FORBIDDEN").observed.paths], ["secrets/key.txt"]);
  assert.equal(g.aggregate(r.records).overallStatus, "FAIL");
});

test("W1 1A scope: a path outside every allowed domain is FAIL (unmatched paths are never silently ignored)", () => {
  const r = scope(["docs/a.md", "tools/build.sh", "other.txt"]);
  assert.equal(state(r, "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED");
  assert.deepEqual([...rec(r, "1A.SCOPE.ALLOWED").observed.paths].sort(), ["other.txt", "tools/build.sh"]);
  assert.equal(rec(r, "1A.SCOPE.ALLOWED").observed.count, 2);
});

test("W1 1A scope: matching is case-sensitive and segment-exact (no folding, no prefix confusion)", () => {
  assert.equal(state(scope(["readme.md"]), "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED");
  assert.equal(state(scope(["Docs/a.md"]), "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED");
  assert.equal(state(scope(["docsx/a.md"]), "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED");
  assert.equal(state(scope(["docs"]), "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED", "docs/** needs a further segment");
  assert.equal(state(scope(["secrets"]), "1A.SCOPE.FORBIDDEN"), "PASS/OK", "the forbidden domain secrets/** does not match the bare name");
});

test("W1 1A scope: a protected governance/framework path is HUMAN_REVIEW_REQUIRED (GOVERNANCE_CONFIG), even with a permissive allowed scope", () => {
  const permissive = validateBasePolicy(basePolicy({ scope: { allowedPathDomains: ["**"], forbiddenPathDomains: [], protectedPaths: [] } })).policy;
  for (const path of ["governance/base.json", "governance/manifests/x.json", "scripts/governance/index.js", ".github/workflows/ci.yml"]) {
    const r = g.checkScope({ subject, changedFiles: changedResult(subject, [path]), policy: permissive });
    assert.equal(state(r, "1A.SCOPE.PROTECTED"), "HUMAN_REVIEW_REQUIRED/GOVERNANCE_CONFIG", path);
    assert.equal(state(r, "1A.SCOPE.ALLOWED"), "PASS/OK", path);
    assert.equal(g.aggregate(r.records).readiness.state, "HUMAN_REVIEW_REQUIRED", path);
  }
  const custom = validateBasePolicy(basePolicy({ scope: { allowedPathDomains: ["**"], forbiddenPathDomains: [], protectedPaths: ["docs/design.md"] } })).policy;
  assert.equal(state(g.checkScope({ subject, changedFiles: changedResult(subject, ["docs/design.md"]), policy: custom }), "1A.SCOPE.PROTECTED"), "HUMAN_REVIEW_REQUIRED/GOVERNANCE_CONFIG");
});

test("W1 1A scope: the built-in protected paths are tighten-only (a policy cannot remove them)", () => {
  const r = g.checkScope({ subject, changedFiles: changedResult(subject, ["scripts/governance/kernel/x.js"]), policy });
  assert.equal(state(r, "1A.SCOPE.PROTECTED"), "HUMAN_REVIEW_REQUIRED/GOVERNANCE_CONFIG");
  const noProtected = validateBasePolicy(basePolicy({ scope: { allowedPathDomains: ["**"], forbiddenPathDomains: [], protectedPaths: [] } })).policy;
  for (const path of ["governance/base.json", ".github/workflows/ci.yml", "scripts/governance/a.js"]) {
    assert.equal(state(g.checkScope({ subject, changedFiles: changedResult(subject, [path]), policy: noProtected }), "1A.SCOPE.PROTECTED"), "HUMAN_REVIEW_REQUIRED/GOVERNANCE_CONFIG", path);
  }
});

test("W1 1A scope: a head proposal that only NARROWS scope is applied as an intersection", () => {
  const r = scope(["docs/a.md"], { headProposal: { allowedPathDomains: ["docs/**"] } });
  assert.equal(state(r, "1A.SCOPE.PROPOSAL"), "PASS/OK");
  assert.equal(state(r, "1A.SCOPE.ALLOWED"), "PASS/OK");
  const narrowed = scope(["docs/a.md", "src/x.js"], { headProposal: { allowedPathDomains: ["docs/**"] } });
  assert.equal(state(narrowed, "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED", "src/x.js is now outside the (narrowed) scope");
  assert.deepEqual([...rec(narrowed, "1A.SCOPE.ALLOWED").observed.paths], ["src/x.js"]);
  const exact = scope(["docs/a.md"], { headProposal: { allowedPathDomains: ["docs/a.md"] } });
  assert.equal(state(exact, "1A.SCOPE.PROPOSAL"), "PASS/OK");
});

test("W1 1A scope: a head proposal that WIDENS scope is not applied, is HUMAN_REVIEW_REQUIRED, and the base scope stays in force", () => {
  for (const widening of [["**"], ["docs/**", "tools/**"], ["tools/build.sh"], ["**/*.js"], ["*.md"]]) {
    const r = scope(["tools/build.sh", "docs/a.md"], { headProposal: { allowedPathDomains: widening } });
    assert.equal(state(r, "1A.SCOPE.PROPOSAL"), "HUMAN_REVIEW_REQUIRED/SCOPE_LOOSENING_PROPOSED", JSON.stringify(widening));
    assert.equal(state(r, "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED", `${JSON.stringify(widening)}: a head can never widen its own scope`);
    assert.deepEqual([...rec(r, "1A.SCOPE.ALLOWED").observed.paths], ["tools/build.sh"]);
  }
});

test("W1 1A scope: a malformed proposal is CONFIGURATION_ERROR and never applied", () => {
  for (const bad of [{ allowedPathDomains: "docs/**" }, { allowedPathDomains: ["a/**/b"] }, { allowedPathDomains: [5] }, { allowedPathDomains: Array(65).fill("docs/**") }, "docs/**", 5, {}]) {
    const r = scope(["tools/x.sh"], { headProposal: bad });
    assert.equal(rec(r, "1A.SCOPE.PROPOSAL").status, "CONFIGURATION_ERROR", JSON.stringify(bad).slice(0, 40));
    assert.equal(state(r, "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED");
  }
});

test("W1 1A scope: with no usable effective policy scope is INCOMPLETE, never a pass", () => {
  for (const bad of [null, undefined, {}, "policy", { scope: {} }, { ...policy, extra: 1 }]) {
    const r = g.checkScope({ subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy: bad });
    assert.equal(state(r, "1A.SCOPE.ALLOWED"), "INCOMPLETE/SCOPE_POLICY_UNAVAILABLE", JSON.stringify(bad));
    assert.equal(g.aggregate(r.records).readiness.state, "NOT_READY");
  }
});

test("W1 1A scope: under the built-in minimum no allowed domain exists (INCOMPLETE) but forbidden and protected paths still apply", () => {
  const builtin = { ...BUILTIN_MINIMUM_POLICY, protectedTargetRefs: ["main"] };
  const r = g.checkScope({ subject, changedFiles: changedResult(subject, ["docs/a.md", "governance/base.json"]), policy: builtin });
  assert.equal(state(r, "1A.SCOPE.ALLOWED"), "INCOMPLETE/SCOPE_POLICY_UNAVAILABLE");
  assert.equal(state(r, "1A.SCOPE.PROTECTED"), "HUMAN_REVIEW_REQUIRED/GOVERNANCE_CONFIG");
  const empty = g.checkScope({ subject, changedFiles: changedResult(subject, []), policy: builtin });
  assert.equal(state(empty, "1A.SCOPE.ALLOWED"), "PASS/OK");
  const malformedBuiltin = g.checkScope({ subject, changedFiles: changedResult(subject, ["a"]), policy: { scope: { allowedPathDomains: [], forbiddenPathDomains: ["a/**/b"], protectedPaths: [] } } });
  assert.equal(state(malformedBuiltin, "1A.SCOPE.ALLOWED"), "INCOMPLETE/SCOPE_POLICY_UNAVAILABLE");
});

test("W1 1A scope: the changed-file input must be the complete 1A result for the SAME subject", () => {
  const otherSubject = makeSubject({ head: "d".repeat(40) });
  const incomplete = g.checkScope({ subject, changedFiles: changedResult(subject, ["docs/a.md"], false), policy });
  assert.equal(state(incomplete, "1A.SCOPE.ALLOWED"), "INCOMPLETE/DIFF_COMPUTATION_FAILED");
  for (const bad of [null, undefined, ["docs/a.md"], { files: ["docs/a.md"] }, changedResult(otherSubject, ["docs/a.md"]), { ...changedResult(subject, ["docs/a.md"]), files: "docs/a.md" }, changedResult(subject, ["../x"])]) {
    const r = g.checkScope({ subject, changedFiles: bad, policy });
    assert.equal(r.subject, null, JSON.stringify(bad));
    assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
    assert.deepEqual([...r.records], []);
  }
  for (const bad of [null, {}, { ...subject, head: "x" }]) assert.equal(g.checkScope({ subject: bad, changedFiles: changedResult(subject, []), policy }).subject, null);
  assert.equal(g.checkScope(null).subject, null);
});

test("W1 1A scope: an empty change set passes; findings are deterministic and bounded", () => {
  const empty = scope([]);
  assert.equal(g.aggregate(empty.records).readiness.state, "READY");
  const many = Array.from({ length: 500 }, (_, i) => `tools/f${i}.sh`);
  const r = scope(many);
  assert.equal(rec(r, "1A.SCOPE.ALLOWED").observed.count, 500);
  assert.equal(rec(r, "1A.SCOPE.ALLOWED").observed.paths.length, 10, "at most 10 sample paths are reported");
  assert.deepEqual(JSON.stringify(scope(many)), JSON.stringify(r), "same input, same output");
});
