"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { createGitAdapter } = require("./git-adapter");
const { GIT, createTempRepo, basePolicy, prContext, postMergeContext, gitOptions } = require("../../test-support-git");
const { validateResultRecord } = require("../../kernel/results");

const WORKFLOW = ".github/workflows/ci.yml";
const rec = (result, id) => result.records.find((r) => r.checkId === id);
const state = (result, id) => {
  const r = rec(result, id);
  return r ? `${r.status}/${r.reasonCode}` : "MISSING";
};
const policyJson = (overrides) => JSON.stringify(basePolicy(overrides));

/**
 * PR scenario: main has the base commit; `feature` has the head commit. Optional
 * `mainAfter` adds a commit to main after the branch point (the target advanced).
 */
function prScenario({ policy = policyJson(), baseFiles = {}, headFiles = { "docs/a.md": "# A\n" }, mainAfter = null } = {}) {
  const repo = createTempRepo();
  const files = { "README.md": "readme\n", [WORKFLOW]: "name: ci\n", ...baseFiles };
  if (policy !== null) files["governance/base.json"] = policy;
  const base = repo.commit("base", files);
  repo.checkout("feature", true);
  const head = repo.commit("head", headFiles);
  let tip = base;
  if (mainAfter) {
    repo.checkout("main");
    tip = repo.commit("main advanced", mainAfter);
    repo.checkout("feature");
  }
  const ctx = (overrides = {}) => prContext(head, { workflow: { path: WORKFLOW, sha: head }, ...overrides });
  const run = (extra = {}, overrides = {}) => g.getGitIdentity({ trustedContext: ctx(overrides), ...gitOptions(repo), ...extra });
  return { repo, base, head, tip, ctx, run };
}

test("W1 1A identity: a valid PR_REVIEW identity is established from Git and every record is Wave 0 valid", async () => {
  const s = prScenario();
  try {
    const r = await s.run();
    assert.equal(r.established, true);
    assert.equal(r.outcome, null);
    assert.equal(r.mode, "PR_REVIEW");
    assert.deepEqual({ ...r.subject.range }, { mode: "PR_REVIEW", from: s.base, to: s.head });
    assert.equal(r.subject.head, s.head);
    assert.equal(r.subject.tree, s.repo.tree(s.head));
    assert.equal(r.subject.base, s.base);
    assert.equal(r.identity.targetTip, s.base);
    assert.equal(r.identity.rootTip, s.base);
    assert.deepEqual([...r.identity.parents], [s.base]);
    for (const record of r.records) {
      assert.equal(validateResultRecord(record).ok, true, record.checkId);
      assert.equal(record.ownerStage, "1A");
      assert.deepEqual(record.subject, r.subject);
    }
    const notPass = r.records.filter((x) => !["PASS", "NOT_APPLICABLE"].includes(x.status));
    assert.deepEqual(notPass.map((x) => x.checkId), [], "a fully anchored, current, protected PR has no non-passing identity record");
    assert.equal(r.policy.source, "ROOT_POLICY");
    assert.match(r.policy.digest, /^[0-9a-f]{64}$/);
    assert.equal(Object.isFrozen(r), true);
    assert.equal(Object.isFrozen(r.identity.parents), true);
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: identity records aggregate through the Wave 0 kernel without RESULT_RECORD_INVALID", async () => {
  const s = prScenario();
  try {
    const r = await s.run();
    const agg = g.aggregate(r.records);
    assert.equal(agg.kernelRecords.some((k) => k.reasonCode === "RESULT_RECORD_INVALID"), false);
    assert.equal(agg.overallStatus, "PASS");
    assert.equal(agg.readiness.state, "READY");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: malformed or abbreviated trusted input never establishes an identity", async () => {
  const s = prScenario();
  try {
    for (const bad of [{ headSha: s.head.slice(0, 12) }, { headSha: s.head.toUpperCase() }, { headSha: "not-a-sha" }, { suppliedTargetSha: "abc" }, { targetRefName: "main*" }, { mode: "MERGE" }, { provider: "" }]) {
      const r = await s.run({}, bad);
      assert.equal(r.established, false, JSON.stringify(bad));
      assert.equal(r.subject, null);
      assert.deepEqual([...r.records], []);
      assert.equal(r.outcome.status, "INCOMPLETE");
      assert.equal(r.outcome.reasonCode, "TRUSTED_CONTEXT_INVALID");
    }
    for (const input of [null, undefined, "x", {}, { trustedContext: null }]) assert.equal((await g.getGitIdentity(input)).established, false);
    assert.equal((await g.getGitIdentity({ trustedContext: s.ctx() })).established, false, "no Git adapter supplied");
    assert.equal((await g.getGitIdentity({ trustedContext: s.ctx(), repositoryRoot: s.repo.root, gitExecutable: "git" })).established, false, "a bare executable is never PATH-resolved");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: local HEAD must equal the platform-authenticated head", async () => {
  const s = prScenario();
  try {
    s.repo.checkout("main");
    const r = await s.run();
    assert.equal(r.established, false);
    assert.equal(r.outcome.reasonCode, "HEAD_MISMATCH");
    const unknown = await s.run({}, { headSha: "1".repeat(40) });
    assert.equal(unknown.established, false);
    assert.equal(unknown.outcome.reasonCode, "HEAD_MISMATCH");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: an unresolvable target tip or default branch is INCOMPLETE with no fallback", async () => {
  const s = prScenario();
  try {
    const noRemote = await s.run({ remoteResolver: () => null });
    assert.equal(noRemote.established, false);
    assert.equal(noRemote.outcome.reasonCode, "TARGET_TIP_UNAVAILABLE");
    const missingTarget = await s.run({}, { targetRefName: "no-such-branch" });
    assert.equal(missingTarget.outcome.reasonCode, "TARGET_TIP_UNAVAILABLE");
    const missingDefault = await s.run({}, { defaultBranchName: "no-default" });
    assert.equal(missingDefault.established, false);
    assert.equal(missingDefault.outcome.reasonCode, "DEFAULT_BRANCH_UNAVAILABLE");
    assert.equal(missingDefault.outcome.status, "INCOMPLETE");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: a supplied target SHA is an assertion only; the resolved tip is used", async () => {
  const s = prScenario({ mainAfter: { "later.txt": "l\n" } });
  try {
    const forged = await s.run({}, { suppliedTargetSha: s.base }); // a stale tip, as after a benign race
    assert.equal(forged.established, true);
    assert.equal(state(forged, "1A.IDENTITY.TARGET_TIP"), "INCOMPLETE/TARGET_TIP_MISMATCH");
    assert.equal(forged.identity.targetTip, s.tip, "the independently resolved tip is used, never the supplied one");
    assert.equal(rec(forged, "1A.IDENTITY.TARGET_TIP").observed.resolvedTargetTip, s.tip);
    const honest = await s.run({}, { suppliedTargetSha: s.tip });
    assert.equal(state(honest, "1A.IDENTITY.TARGET_TIP"), "PASS/OK");
    assert.equal(g.aggregate(forged.records).readiness.state, "NOT_READY");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: the base is the merge base of the head and the RESOLVED tip, even after the target advanced", async () => {
  const s = prScenario({ mainAfter: { "later.txt": "l\n" } });
  try {
    const r = await s.run();
    assert.equal(r.established, true);
    assert.equal(r.subject.base, s.base, "base is the branch point, not the advanced target tip");
    assert.equal(r.identity.targetTip, s.tip);
    assert.notEqual(s.tip, s.base);
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: zero or multiple merge bases are BASE_NOT_ESTABLISHED (INCOMPLETE), never guessed", async () => {
  const repo = createTempRepo();
  try {
    repo.commit("root", { "a.txt": "1\n" });
    repo.checkout("a", true);
    repo.commit("a1", { "a.txt": "a\n" });
    repo.checkout("main");
    repo.checkout("b", true);
    repo.commit("b1", { "b.txt": "b\n" });
    repo.checkout("a");
    repo.checkout("x", true);
    repo.git("merge", "--no-ff", "-q", "-m", "x", "b");
    const x = repo.sha("HEAD");
    repo.checkout("b");
    repo.checkout("y", true);
    repo.git("merge", "--no-ff", "-q", "-m", "y", "a");
    const y = repo.sha("HEAD");
    // Target `y` (a criss-cross partner of the head `x`): two merge bases.
    repo.checkout("x");
    const multiple = await g.getGitIdentity({ trustedContext: prContext(x, { targetRefName: "y", defaultBranchName: "y" }), ...gitOptions(repo) });
    assert.equal(multiple.established, false);
    assert.deepEqual({ status: multiple.outcome.status, reason: multiple.outcome.reasonCode }, { status: "INCOMPLETE", reason: "BASE_NOT_ESTABLISHED" });
    // Unrelated histories: zero merge bases.
    repo.git("checkout", "-q", "--orphan", "orphan");
    repo.git("rm", "-rf", "-q", ".");
    const orphan = repo.commit("orphan", { "o.txt": "o\n" });
    const zero = await g.getGitIdentity({ trustedContext: prContext(orphan), ...gitOptions(repo) });
    assert.equal(zero.established, false);
    assert.equal(zero.outcome.reasonCode, "BASE_NOT_ESTABLISHED");
    assert.ok(y && x);
  } finally {
    repo.cleanup();
  }
});

test("W1 1A identity: base == head or a head already on the target is DEGENERATE_RANGE, never an empty passing diff", async () => {
  const s = prScenario();
  try {
    // Head equal to the target tip.
    s.repo.checkout("main");
    const same = await g.getGitIdentity({ trustedContext: prContext(s.base), ...gitOptions(s.repo) });
    assert.equal(same.established, true);
    assert.equal(state(same, "1A.IDENTITY.RANGE"), "INCOMPLETE/DEGENERATE_RANGE");
    assert.equal(g.aggregate(same.records).readiness.state, "NOT_READY");
    // Head is an ancestor of the (advanced) target tip.
    s.repo.checkout("main");
    s.repo.commit("advance", { "z.txt": "z\n" });
    s.repo.checkout("feature");
    s.repo.git("branch", "-f", "old-head", s.base);
    s.repo.checkout("old-head");
    const ancestor = await g.getGitIdentity({ trustedContext: prContext(s.base), ...gitOptions(s.repo) });
    assert.equal(ancestor.established, true);
    assert.equal(state(ancestor, "1A.IDENTITY.RANGE"), "INCOMPLETE/DEGENERATE_RANGE");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: expectedBase is an assertion compared with the derived base, never authority", async () => {
  const s = prScenario();
  try {
    const equal = await s.run({ manifestAssertions: { expectedBase: s.base } });
    assert.equal(state(equal, "1A.IDENTITY.EXPECTED_BASE"), "PASS/OK");
    const forged = await s.run({ manifestAssertions: { expectedBase: s.head } });
    assert.equal(forged.established, true);
    assert.equal(state(forged, "1A.IDENTITY.EXPECTED_BASE"), "FAIL/BASE_MISMATCH");
    assert.equal(forged.subject.base, s.base, "the derived base is unchanged by the assertion");
    for (const bad of ["abc", 5, "A".repeat(40)]) {
      const malformed = await s.run({ manifestAssertions: { expectedBase: bad } });
      assert.equal(state(malformed, "1A.IDENTITY.EXPECTED_BASE"), "CONFIGURATION_ERROR/MANIFEST_TYPE_INVALID", String(bad));
    }
    assert.equal(state(await s.run(), "1A.IDENTITY.EXPECTED_BASE"), "NOT_APPLICABLE/OK");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: an operator-supplied invocation is HUMAN_REVIEW_REQUIRED and never READY", async () => {
  const s = prScenario();
  try {
    const r = await s.run({}, { invocationTrust: "OPERATOR_SUPPLIED", eventType: "manual", workflow: null });
    assert.equal(r.established, true);
    assert.equal(state(r, "1A.IDENTITY.INVOCATION"), "HUMAN_REVIEW_REQUIRED/OPERATOR_INVOCATION");
    assert.equal(state(r, "1A.IDENTITY.WORKFLOW_ANCHOR"), "NOT_APPLICABLE/OK");
    assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: protected targets come from the governance-root policy (bootstrap fallback only when none exists)", async () => {
  const s = prScenario();
  try {
    s.repo.checkout("main");
    s.repo.git("branch", "release", s.base);
    s.repo.checkout("feature");
    const stacked = await s.run({}, { targetRefName: "release" });
    assert.equal(stacked.established, true);
    assert.equal(state(stacked, "1A.TARGET.PROTECTED"), "HUMAN_REVIEW_REQUIRED/TARGET_NOT_PROTECTED");
    assert.equal(state(await s.run(), "1A.TARGET.PROTECTED"), "PASS/OK");
  } finally {
    s.repo.cleanup();
  }
  const bootstrap = prScenario({ policy: null });
  try {
    const r = await bootstrap.run();
    assert.equal(r.policy.source, "BUILTIN_MINIMUM");
    assert.equal(state(r, "1A.POLICY.ROOT"), "NOT_APPLICABLE/OK");
    assert.equal(state(r, "1A.POLICY.ANCHOR"), "HUMAN_REVIEW_REQUIRED/NO_BASE_TRUST_ANCHOR");
    assert.equal(state(r, "1A.POLICY.CURRENT"), "NOT_APPLICABLE/OK");
    assert.equal(state(r, "1A.TARGET.PROTECTED"), "PASS/OK", "the platform default branch is protected under the built-in minimum");
    assert.deepEqual([...r.policy.policy.protectedTargetRefs], ["main"]);
    bootstrap.repo.checkout("main");
    bootstrap.repo.git("branch", "other", bootstrap.base);
    bootstrap.repo.checkout("feature");
    const other = await bootstrap.run({}, { targetRefName: "other" });
    assert.equal(state(other, "1A.TARGET.PROTECTED"), "HUMAN_REVIEW_REQUIRED/TARGET_NOT_PROTECTED", "no fallback beyond the default branch");
    assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
  } finally {
    bootstrap.repo.cleanup();
  }
});

test("W1 1A identity: a present but broken root policy disables the fallback (CONFIGURATION_ERROR, never a weaker main)", async () => {
  const cases = {
    "protectedTargetRefs absent": (p) => { delete p.protectedTargetRefs; return p; },
    "protectedTargetRefs empty": (p) => ({ ...p, protectedTargetRefs: [] }),
    "protectedTargetRefs null": (p) => ({ ...p, protectedTargetRefs: null }),
    "protectedTargetRefs string": (p) => ({ ...p, protectedTargetRefs: "main" }),
    "protectedTargetRefs duplicate": (p) => ({ ...p, protectedTargetRefs: ["main", "main"] }),
    "protectedTargetRefs wildcard": (p) => ({ ...p, protectedTargetRefs: ["ma*"] }),
    "protectedTargetRefs control": (p) => ({ ...p, protectedTargetRefs: ["ma\tin"] }),
    "protectedTargetRefs whitespace": (p) => ({ ...p, protectedTargetRefs: [" main"] }),
    "unknown field": (p) => ({ ...p, sneaky: true }),
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const s = prScenario({ policy: JSON.stringify(mutate(basePolicy())) });
    try {
      const r = await s.run();
      assert.equal(r.established, true, label);
      assert.equal(r.policy.source, "NONE", label);
      assert.equal(r.policy.policy, null, label);
      assert.equal(state(r, "1A.POLICY.ROOT"), "CONFIGURATION_ERROR/POLICY_INVALID", label);
      assert.equal(rec(r, "1A.TARGET.PROTECTED").status, "CONFIGURATION_ERROR", `${label}: target protection is not evaluated against a fallback`);
      assert.notEqual(state(r, "1A.TARGET.PROTECTED"), "PASS/OK", label);
    } finally {
      s.repo.cleanup();
    }
  }
  const unparseable = prScenario({ policy: "{ not json" });
  try {
    assert.equal(state(await unparseable.run(), "1A.POLICY.ROOT"), "CONFIGURATION_ERROR/POLICY_INVALID");
  } finally {
    unparseable.repo.cleanup();
  }
  const asDirectory = prScenario({ policy: null, baseFiles: { "governance/base.json/inner.txt": "x\n" } });
  try {
    assert.equal(state(await asDirectory.run(), "1A.POLICY.ROOT"), "CONFIGURATION_ERROR/POLICY_INVALID", "a directory at the policy path is not a policy");
  } finally {
    asDirectory.repo.cleanup();
  }
});

test("W1 1A identity: a base older than the governance-root policy is POLICY_OUTDATED (rebase required)", async () => {
  const s = prScenario();
  try {
    s.repo.checkout("main");
    s.repo.commit("root policy advances", { "governance/base.json": policyJson({ protectedTargetRefs: ["main", "release"] }) });
    s.repo.checkout("feature");
    const r = await s.run();
    assert.equal(r.established, true);
    assert.equal(state(r, "1A.POLICY.CURRENT"), "INCOMPLETE/POLICY_OUTDATED");
    assert.deepEqual([...r.policy.policy.protectedTargetRefs], ["main", "release"], "the effective protected policy is always the root-tip policy");
    assert.equal(g.aggregate(r.records).readiness.state, "NOT_READY");
    assert.notEqual(rec(r, "1A.POLICY.CURRENT").observed.rootPolicyDigest, rec(r, "1A.POLICY.CURRENT").observed.basePolicyDigest);
  } finally {
    s.repo.cleanup();
  }
  const introduced = prScenario({ policy: null });
  try {
    introduced.repo.checkout("main");
    introduced.repo.commit("policy introduced after the branch point", { "governance/base.json": policyJson() });
    introduced.repo.checkout("feature");
    assert.equal(state(await introduced.run(), "1A.POLICY.CURRENT"), "INCOMPLETE/POLICY_OUTDATED");
  } finally {
    introduced.repo.cleanup();
  }
});

test("W1 1A identity: a head-edited base policy can never change the effective policy or the protected targets", async () => {
  const s = prScenario({ headFiles: { "governance/base.json": policyJson({ protectedTargetRefs: ["main", "attacker-branch"], scope: { allowedPathDomains: ["**"], forbiddenPathDomains: [], protectedPaths: [] } }) } });
  try {
    const r = await s.run();
    assert.deepEqual([...r.policy.policy.protectedTargetRefs], ["main"]);
    assert.deepEqual([...r.policy.policy.scope.allowedPathDomains], ["docs/**", "src/**", "README.md"]);
    assert.equal(state(r, "1A.POLICY.CURRENT"), "PASS/OK", "currency compares the BASE and the root, never the head");
    s.repo.checkout("main");
    s.repo.git("branch", "attacker-branch", s.base);
    s.repo.checkout("feature");
    assert.equal(state(await s.run({}, { targetRefName: "attacker-branch" }), "1A.TARGET.PROTECTED"), "HUMAN_REVIEW_REQUIRED/TARGET_NOT_PROTECTED", "the head cannot add its own protected branch");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: workflow anchoring compares the invoking workflow blob with the base, independent of the diff", async () => {
  const s = prScenario();
  try {
    assert.equal(state(await s.run(), "1A.IDENTITY.WORKFLOW_ANCHOR"), "PASS/OK");
    assert.equal(state(await s.run({}, { workflow: null }), "1A.IDENTITY.WORKFLOW_ANCHOR"), "INCOMPLETE/WORKFLOW_IDENTITY_UNAVAILABLE");
    assert.equal(state(await s.run({}, { workflow: { path: WORKFLOW, sha: "9".repeat(40) } }), "1A.IDENTITY.WORKFLOW_ANCHOR"), "INCOMPLETE/WORKFLOW_IDENTITY_UNAVAILABLE", "a run commit that is not available cannot be anchored");
    assert.equal(state(await s.run({}, { workflow: { path: ".github/workflows/none.yml", sha: s.head } }), "1A.IDENTITY.WORKFLOW_ANCHOR"), "INCOMPLETE/WORKFLOW_IDENTITY_UNAVAILABLE");
  } finally {
    s.repo.cleanup();
  }
  const changed = prScenario({ headFiles: { [WORKFLOW]: "name: tampered\non: pull_request\n" } });
  try {
    const r = await changed.run();
    assert.equal(state(r, "1A.IDENTITY.WORKFLOW_ANCHOR"), "HUMAN_REVIEW_REQUIRED/INVOCATION_NOT_ANCHORED");
    assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
  } finally {
    changed.repo.cleanup();
  }
  const added = prScenario({ headFiles: { ".github/workflows/new.yml": "name: new\n" } });
  try {
    const r = await added.run({}, { workflow: { path: ".github/workflows/new.yml", sha: added.head } });
    assert.equal(state(r, "1A.IDENTITY.WORKFLOW_ANCHOR"), "HUMAN_REVIEW_REQUIRED/INVOCATION_NOT_ANCHORED", "a head-selected new workflow is never anchored");
  } finally {
    added.repo.cleanup();
  }
});

test("W1 1A identity: gate manifest anchoring (no base anchor / missing / removed / present / invalid gate)", async () => {
  const gate = (o = {}) => ({ gateId: "wave-gate", ...o });
  const path = "governance/manifests/wave-gate.json";
  const fresh = prScenario({ headFiles: { [path]: "{}\n" } });
  try {
    assert.equal(state(await fresh.run({ gate: gate() }), "1A.POLICY.GATE_ANCHOR"), "HUMAN_REVIEW_REQUIRED/NO_BASE_GATE_ANCHOR");
    assert.equal(state(await fresh.run(), "1A.POLICY.GATE_ANCHOR"), "NOT_APPLICABLE/OK");
    assert.equal(state(await fresh.run({ gate: { gateId: "Bad Gate" } }), "1A.POLICY.GATE_ANCHOR"), "CONFIGURATION_ERROR/MANIFEST_TYPE_INVALID");
    assert.equal(state(await fresh.run({ gate: "wave-gate" }), "1A.POLICY.GATE_ANCHOR"), "CONFIGURATION_ERROR/MANIFEST_TYPE_INVALID");
  } finally {
    fresh.repo.cleanup();
  }
  const missing = prScenario();
  try {
    assert.equal(state(await missing.run({ gate: gate({ requiresManifest: true }) }), "1A.POLICY.GATE_ANCHOR"), "CONFIGURATION_ERROR/GATE_MANIFEST_MISSING");
    assert.equal(state(await missing.run({ gate: gate() }), "1A.POLICY.GATE_ANCHOR"), "NOT_APPLICABLE/OK");
  } finally {
    missing.repo.cleanup();
  }
  const anchored = prScenario({ baseFiles: { [path]: "{}\n" }, headFiles: { [path]: '{"a":1}\n' } });
  try {
    assert.equal(state(await anchored.run({ gate: gate() }), "1A.POLICY.GATE_ANCHOR"), "PASS/OK");
  } finally {
    anchored.repo.cleanup();
  }
  const removed = prScenario({ baseFiles: { [path]: "{}\n" }, headFiles: { [path]: null } });
  try {
    assert.equal(state(await removed.run({ gate: gate() }), "1A.POLICY.GATE_ANCHOR"), "HUMAN_REVIEW_REQUIRED/GOVERNANCE_CONFIG");
  } finally {
    removed.repo.cleanup();
  }
});

test("W1 1A identity: a policy requiring an unlisted capability is CAPABILITY_UNAVAILABLE_ON_TARGET (lag, not a pass)", async () => {
  const s = prScenario({ policy: policyJson({ requiredCapabilities: ["repository-preflight@1", "future-capability@1"] }) });
  try {
    const r = await s.run();
    assert.equal(state(r, "1A.POLICY.CAPABILITIES"), "INCOMPLETE/CAPABILITY_UNAVAILABLE_ON_TARGET");
    assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: the result is frozen and independent of later caller mutation", async () => {
  const s = prScenario();
  try {
    const ctx = s.ctx();
    const r = await g.getGitIdentity({ trustedContext: ctx, ...gitOptions(s.repo) });
    const snapshot = JSON.stringify(r);
    ctx.headSha = "0".repeat(40);
    ctx.targetRefName = "evil";
    assert.equal(JSON.stringify(r), snapshot);
    assert.throws(() => { r.subject.head = "x"; }, TypeError);
    assert.throws(() => { r.records.push({}); }, TypeError);
    assert.throws(() => { r.identity.parents.push("x"); }, TypeError);
    assert.throws(() => { r.records[0].status = "PASS"; }, TypeError);
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: an injected adapter is used instead of any real Git (offline testability seam)", async () => {
  const sha = (c) => c.repeat(40);
  const calls = [];
  const fake = new Proxy({}, { get: () => undefined });
  const adapter = {
    localHead: async () => ({ ok: true, value: sha("a") }),
    commitInfo: async (c) => (calls.push(["commitInfo", c]), { ok: true, value: { sha: c, tree: sha("t").replace(/t/g, "b"), parents: [sha("c")] } }),
    resolveTargetTip: async () => ({ ok: true, value: sha("d") }),
    mergeBases: async () => ({ ok: true, value: [sha("c")] }),
    isAncestor: async () => ({ ok: true, value: false }),
    diffNames: async () => ({ ok: false, detail: "n/a" }),
    treeEntry: async () => ({ ok: true, value: { absent: true } }),
    readBlob: async () => ({ ok: true, value: { kind: "absent" } }),
    listTree: async () => ({ ok: true, value: { paths: [], invalid: 0 } }),
    firstParentContains: async () => ({ ok: true, value: true }),
  };
  const r = await g.getGitIdentity({ trustedContext: prContext(sha("a")), git: adapter });
  assert.equal(r.established, true);
  assert.equal(r.subject.base, sha("c"));
  assert.equal(r.policy.source, "BUILTIN_MINIMUM");
  assert.ok(calls.length > 0);
  assert.equal(fake.anything, undefined);
});

// ------------------------------------------------------------------------ POST_MERGE

/** Build a POST_MERGE scenario; `kind` selects the topology. */
function mergeScenario(kind, { policy = policyJson() } = {}) {
  const repo = createTempRepo();
  const base = repo.commit("base", { "README.md": "r\n", "governance/base.json": policy });
  repo.checkout("feature", true);
  const head = repo.commit("head", { "docs/a.md": "a\n" });
  repo.checkout("main");
  let merge;
  let prHead = head;
  if (kind === "twoParent") {
    repo.git("merge", "--no-ff", "-q", "-m", "Merge PR", "feature");
    merge = repo.sha("HEAD");
  } else if (kind === "fastForward") {
    repo.git("merge", "--ff-only", "-q", "feature");
    merge = repo.sha("HEAD");
  } else if (kind === "squash") {
    repo.git("merge", "--squash", "-q", "feature");
    repo.git("commit", "-q", "-m", "squashed");
    merge = repo.sha("HEAD");
  } else if (kind === "octopus") {
    repo.checkout("f2", true);
    repo.commit("f2", { "f2.txt": "2\n" });
    repo.checkout("main");
    repo.checkout("f3", true);
    repo.commit("f3", { "f3.txt": "3\n" });
    repo.checkout("main");
    repo.git("merge", "-q", "-m", "octopus", "feature", "f2", "f3");
    merge = repo.sha("HEAD");
  } else if (kind === "offTarget") {
    repo.checkout("side", true);
    repo.git("merge", "--no-ff", "-q", "-m", "Merge PR on a side branch", "feature");
    merge = repo.sha("HEAD");
    repo.checkout("main");
  } else if (kind === "firstParentOffHistory") {
    // main later merges `feature2`, whose first-parent chain contains the merge commit:
    // the merge is reachable from main but its first parent is not on main's first-parent history.
    repo.checkout("feature");
    repo.checkout("branch-two", true);
    repo.commit("bt", { "bt.txt": "b\n" });
    repo.checkout("feature");
    repo.git("merge", "--no-ff", "-q", "-m", "Merge inside feature", "branch-two");
    merge = repo.sha("HEAD");
    prHead = repo.sha("branch-two");
    repo.checkout("main");
    repo.git("merge", "--no-ff", "-q", "-m", "Merge feature into main", "feature");
  }
  repo.checkout(kind === "offTarget" ? "side" : "main");
  if (kind === "firstParentOffHistory") repo.git("checkout", "-q", merge);
  const ctx = (overrides = {}) => postMergeContext(merge, prHead, overrides);
  const run = (extra = {}, overrides = {}) => g.getGitIdentity({ trustedContext: ctx(overrides), ...gitOptions(repo), ...extra });
  return { repo, base, head, merge, prHead, ctx, run };
}

test("W1 1A identity: POST_MERGE accepts a standard two-parent merge and binds the range first-parent..merge", async () => {
  const s = mergeScenario("twoParent");
  try {
    const r = await s.run();
    assert.equal(r.established, true);
    assert.deepEqual({ ...r.subject.range }, { mode: "POST_MERGE", from: s.base, to: s.merge });
    assert.equal(r.subject.base, s.base);
    assert.equal(r.subject.head, s.merge);
    assert.equal(r.subject.tree, s.repo.tree(s.merge));
    for (const id of ["1A.IDENTITY.MERGE_ON_TARGET", "1A.IDENTITY.TOPOLOGY", "1A.IDENTITY.BASE", "1A.IDENTITY.MERGED_HEAD", "1A.TARGET.PROTECTED"]) assert.equal(state(r, id), "PASS/OK", id);
    assert.equal(state(r, "1A.POLICY.CURRENT"), "NOT_APPLICABLE/OK", "POLICY_OUTDATED does not apply post-merge");
    assert.equal(r.policy.source, "POLICY_AT_FIRST_PARENT");
    assert.equal(rec(r, "1A.IDENTITY.INVOCATION").observed.mode, "POST_MERGE");
    for (const record of r.records) assert.equal(validateResultRecord(record).ok, true, record.checkId);
    assert.equal(rec(r, "1A.IDENTITY.TARGET_TIP"), undefined, "no PR-only records in POST_MERGE");
    assert.equal(rec(r, "1A.IDENTITY.WORKFLOW_ANCHOR"), undefined);
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: POST_MERGE fast-forward, squash and octopus topologies are FAIL (TOPOLOGY_UNEXPECTED)", async () => {
  for (const kind of ["fastForward", "squash", "octopus"]) {
    const s = mergeScenario(kind);
    try {
      const r = await s.run();
      assert.equal(r.established, true, kind);
      assert.equal(state(r, "1A.IDENTITY.TOPOLOGY"), "FAIL/TOPOLOGY_UNEXPECTED", kind);
      assert.equal(g.aggregate(r.records).overallStatus, "FAIL", kind);
    } finally {
      s.repo.cleanup();
    }
  }
});

test("W1 1A identity: POST_MERGE second parent must equal the platform-recorded merged PR head", async () => {
  const s = mergeScenario("twoParent");
  try {
    const wrong = await s.run({}, { mergedPrHeadSha: s.base });
    assert.equal(state(wrong, "1A.IDENTITY.MERGED_HEAD"), "FAIL/MERGED_HEAD_MISMATCH");
    const forgedHead = await s.run({}, { mergedPrHeadSha: "1".repeat(40) });
    assert.equal(state(forgedHead, "1A.IDENTITY.MERGED_HEAD"), "FAIL/MERGED_HEAD_MISMATCH");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: POST_MERGE requires the merge on the target and the first parent on the target's first-parent history", async () => {
  const off = mergeScenario("offTarget");
  try {
    const r = await off.run();
    assert.equal(state(r, "1A.IDENTITY.MERGE_ON_TARGET"), "FAIL/MERGE_NOT_ON_TARGET");
  } finally {
    off.repo.cleanup();
  }
  const history = mergeScenario("firstParentOffHistory");
  try {
    const r = await history.run();
    assert.equal(state(r, "1A.IDENTITY.MERGE_ON_TARGET"), "PASS/OK", "the merge is reachable from the target tip");
    assert.equal(state(r, "1A.IDENTITY.BASE"), "FAIL/BASE_NOT_ON_TARGET_HISTORY");
  } finally {
    history.repo.cleanup();
  }
});

test("W1 1A identity: POST_MERGE on an unprotected or unresolvable target fails closed", async () => {
  const s = mergeScenario("twoParent");
  try {
    s.repo.git("branch", "release", s.merge);
    const unprotected = await s.run({}, { targetRefName: "release" });
    assert.equal(state(unprotected, "1A.TARGET.PROTECTED"), "FAIL/TARGET_NOT_PROTECTED", "a certification claim on an unprotected branch is contradicted, not deferred");
    const noTip = await s.run({ remoteResolver: () => null });
    assert.equal(noTip.established, false);
    assert.equal(noTip.outcome.reasonCode, "TARGET_TIP_UNAVAILABLE");
    const missingHead = await g.getGitIdentity({ trustedContext: postMergeContext("7".repeat(40), s.head), ...gitOptions(s.repo) });
    assert.equal(missingHead.established, false);
    assert.equal(missingHead.outcome.reasonCode, "HEAD_MISMATCH");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: POST_MERGE uses the policy at the FIRST PARENT with protectedTargetRefs from the root tip", async () => {
  const s = mergeScenario("twoParent", { policy: policyJson({ scope: { allowedPathDomains: ["docs/**"], forbiddenPathDomains: [], protectedPaths: [] } }) });
  try {
    s.repo.checkout("main");
    s.repo.commit("root advances after the merge", { "governance/base.json": policyJson({ protectedTargetRefs: ["main", "release"], scope: { allowedPathDomains: ["src/**"], forbiddenPathDomains: [], protectedPaths: [] } }) });
    s.repo.git("checkout", "-q", s.merge); // verify the merge commit itself, as a push event does
    const r = await s.run();
    assert.equal(r.established, true);
    assert.deepEqual([...r.policy.policy.scope.allowedPathDomains], ["docs/**"], "the scope policy is the pre-merge (first-parent) one");
    assert.deepEqual([...r.policy.policy.protectedTargetRefs], ["main", "release"], "protected targets come from the governance-root tip");
    assert.equal(state(r, "1A.POLICY.CURRENT"), "NOT_APPLICABLE/OK");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 1A identity: POST_MERGE identity is shared facts only (no merge-gate residue is produced)", async () => {
  const s = mergeScenario("twoParent");
  try {
    const r = await s.run();
    const text = JSON.stringify(r).toLowerCase();
    for (const forbidden of ["pack_diff", "branch_protection", "safe_to_merge", "merge_authoriz", "tree_match", "ci_exact_sha"]) assert.equal(text.includes(forbidden), false, forbidden);
  } finally {
    s.repo.cleanup();
  }
});
