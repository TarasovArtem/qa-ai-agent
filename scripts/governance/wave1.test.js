"use strict";

// GOV-AUTO-1 Wave 1 (1A + 1B): cross-stage integration and boundary tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const g = require("./index");
const { createTempRepo, basePolicy, prContext, postMergeContext, platformList, gitOptions } = require("./test-support-git");

const WORKFLOW = ".github/workflows/ci.yml";
const NOW = "2026-06-01";
const GH = "gh" + "p_" + "K".repeat(36);
const rec = (records, id) => records.find((r) => r.checkId === id);
const state = (records, id) => {
  const r = rec(records, id);
  return r ? `${r.status}/${r.reasonCode}` : "MISSING";
};

const POLICY = basePolicy({
  scope: { allowedPathDomains: ["docs/**", "src/**", "README.md"], forbiddenPathDomains: ["secrets/**"], protectedPaths: ["governance/**", "scripts/governance/**", ".github/workflows/**"] },
  markdown: { filePatterns: ["**/*.md"], idFamilies: [{ family: "TB", prefix: "TB-", segments: [{ minDigits: 2, maxDigits: 3 }], separator: "-", definitionSources: ["docs/**"], definitionContexts: ["HEADING", "TABLE_FIRST_CELL"], ignoreContexts: ["FENCED_CODE", "INLINE_CODE"] }] },
});

/** Full pipeline: 1A identity -> changed files -> scope -> secrets, then 1B on the SAME frozen changed-file set. */
async function pipeline(repo, head, { ctx = {}, extra = {}, scopeProposal, headSuppressions } = {}) {
  const files = (list) => list;
  const common = gitOptions(repo);
  const trustedContext = prContext(head, { workflow: { path: WORKFLOW, sha: head }, ...ctx });
  const identity = await g.getGitIdentity({ trustedContext, ...common, ...extra });
  assert.equal(identity.established, true);
  const changed = await g.getChangedFiles({ subject: identity.subject, invocationTrust: trustedContext.invocationTrust, platformFiles: trustedContext.platformFiles, ...common });
  const scope = g.checkScope({ subject: identity.subject, changedFiles: changed, policy: identity.policy.policy, headProposal: scopeProposal });
  const secrets = await g.scanSecrets({ subject: identity.subject, changedFiles: changed, policy: identity.policy.policy, headSuppressions, now: NOW, ...common });
  const markdown = await g.checkReferences({ subject: identity.subject, changedFiles: changed, policy: identity.policy.policy, ...common });
  const records = files([...identity.records, ...changed.records, ...scope.records, ...secrets.records, ...markdown.records]);
  return { identity, changed, scope, secrets, markdown, records, aggregate: g.aggregate(records) };
}

function scenario(headFiles, { baseFiles = {}, platform = true } = {}) {
  const repo = createTempRepo();
  const base = repo.commit("base", { "README.md": "# Readme\n", [WORKFLOW]: "name: ci\n", "governance/base.json": JSON.stringify(POLICY), "docs/ids.md": "# IDs\n\n| ID | Meaning |\n|---|---|\n| TB-01 | first |\n", "docs/b.md": "# Other\n", ...baseFiles });
  repo.checkout("feature", true);
  const head = repo.commit("head", headFiles);
  const changedPaths = Object.keys(headFiles);
  const ctx = platform ? { platformFiles: platformList(changedPaths) } : {};
  return { repo, base, head, ctx };
}

test("W1 integration: a clean, in-scope PR passes every 1A and 1B check and is READY from the kernel's point of view", async () => {
  const s = scenario({ "docs/a.md": "# A\n\nSee [b](b.md#other) and TB-01.\n\n| x | y |\n|---|---|\n| 1 | 2 |\n" });
  try {
    const p = await pipeline(s.repo, s.head, { ctx: s.ctx });
    const bad = p.records.filter((r) => !["PASS", "NOT_APPLICABLE"].includes(r.status));
    assert.deepEqual(bad.map((r) => `${r.checkId}:${r.status}`), []);
    assert.equal(p.aggregate.overallStatus, "PASS");
    assert.equal(p.aggregate.readiness.state, "READY");
    assert.deepEqual([...p.changed.files], ["docs/a.md"]);
    for (const r of p.records) assert.deepEqual(r.subject, p.identity.subject, r.checkId);
    assert.equal(new Set(p.records.map((r) => r.checkId)).size, p.records.length);
    assert.equal(p.markdown.records.length, 7);
  } finally {
    s.repo.cleanup();
  }
});

test("W1 integration: a defective PR surfaces every deterministic fact separately and is FAIL", async () => {
  const s = scenario({
    "docs/a.md": "# A\n\n[missing](nope.md) [bad anchor](#nowhere) TB-77\n\n| x | y |\n|---|---|\n| 1 | 2 | 3 |\n\n```\nunclosed\n",
    "docs/s.md": `leaked ${GH}\n`,
    "secrets/x.txt": "x\n",
    "tools/build.sh": "echo\n",
  });
  try {
    const p = await pipeline(s.repo, s.head, { ctx: s.ctx });
    assert.equal(state(p.records, "1A.SCOPE.FORBIDDEN"), "FAIL/SCOPE_FORBIDDEN_PATH");
    assert.equal(state(p.records, "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED");
    assert.equal(state(p.records, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND");
    assert.equal(state(p.records, "1B.MARKDOWN.FENCES"), "FAIL/MARKDOWN_STRUCTURE_INVALID");
    assert.equal(state(p.records, "1B.MARKDOWN.TABLES"), "FAIL/MARKDOWN_STRUCTURE_INVALID");
    assert.equal(state(p.records, "1B.MARKDOWN.ANCHORS"), "FAIL/ANCHOR_DANGLING");
    assert.equal(state(p.records, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
    assert.equal(state(p.records, "1B.REFERENCES.TB"), "FAIL/REFERENCE_DANGLING");
    assert.equal(p.aggregate.overallStatus, "FAIL");
    assert.equal(p.aggregate.readiness.state, "NOT_READY");
    assert.equal(JSON.stringify(p).includes(GH), false, "the secret never appears anywhere in the output");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 integration: 1A and 1B share ONE changed-file fact (1B parses only files 1A reported)", async () => {
  const s = scenario({ "docs/a.md": "# A\n[x](missing.md)\n" });
  try {
    // A Markdown file that exists at the head but was NOT changed carries a defect; it must not be reported.
    s.repo.checkout("main");
    s.repo.commit("unchanged defect", { "docs/untouched.md": "[y](also-missing.md)\n" });
    s.repo.git("checkout", "-q", "feature");
    s.repo.git("rebase", "-q", "main");
    const head = s.repo.sha("HEAD");
    const p = await pipeline(s.repo, head, { ctx: { platformFiles: platformList(["docs/a.md"]) } });
    assert.deepEqual([...p.changed.files], ["docs/a.md"]);
    const findings = rec(p.markdown.records, "1B.MARKDOWN.LINKS").observed.findings;
    assert.equal(findings.length, 1);
    assert.match(findings[0], /^docs\/a\.md:2: /);
    assert.equal(JSON.stringify(p.markdown).includes("untouched"), false);
  } finally {
    s.repo.cleanup();
  }
});

test("W1 integration: a head that changes governance/framework files is HUMAN_REVIEW_REQUIRED and can never self-certify READY", async () => {
  const s = scenario({
    "governance/base.json": JSON.stringify(basePolicy({ scope: { allowedPathDomains: ["**"], forbiddenPathDomains: [], protectedPaths: [] }, protectedTargetRefs: ["main", "attacker"] })),
    "scripts/governance/index.js": "// a new capability that would certify itself\n",
    ".github/workflows/ci.yml": "name: tampered\n",
    "docs/a.md": "# A\n",
  });
  try {
    const p = await pipeline(s.repo, s.head, { ctx: s.ctx });
    assert.equal(state(p.records, "1A.SCOPE.PROTECTED"), "HUMAN_REVIEW_REQUIRED/GOVERNANCE_CONFIG");
    assert.equal(state(p.records, "1A.IDENTITY.WORKFLOW_ANCHOR"), "HUMAN_REVIEW_REQUIRED/INVOCATION_NOT_ANCHORED");
    assert.deepEqual([...p.identity.policy.policy.protectedTargetRefs], ["main"], "the head's own policy edit is not applied");
    assert.equal(state(p.records, "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED", "the head widening its own scope changes nothing: the changed governance/scripts paths are outside the BASE allowed domains");
    assert.notEqual(p.aggregate.readiness.state, "READY");
    assert.equal(p.aggregate.readiness.state, "NOT_READY");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 integration: a head-added suppression or scope widening cannot turn a hit or a violation into a PASS", async () => {
  const s = scenario({ "docs/s.md": `example ${GH}\n`, "tools/x.sh": "x\n" });
  try {
    const { fingerprintOf } = require("./stages/1a/secrets");
    const proposal = { ruleId: "GITHUB_TOKEN", path: "docs/s.md", lineStart: null, lineEnd: null, classification: "DOCUMENTED_PLACEHOLDER", reason: "documented placeholder", reviewRef: "PR #1", fingerprint: fingerprintOf("GITHUB_TOKEN", "docs/s.md", GH), expires: "2026-08-01" };
    const p = await pipeline(s.repo, s.head, { ctx: s.ctx, headSuppressions: [proposal], scopeProposal: { allowedPathDomains: ["**"] } });
    assert.equal(state(p.records, "1A.SECRETS.SCAN"), "HUMAN_REVIEW_REQUIRED/SUPPRESSION_PROPOSED");
    assert.equal(state(p.records, "1A.SCOPE.PROPOSAL"), "HUMAN_REVIEW_REQUIRED/SCOPE_LOOSENING_PROPOSED");
    assert.equal(state(p.records, "1A.SCOPE.ALLOWED"), "FAIL/SCOPE_OUTSIDE_ALLOWED");
    assert.notEqual(p.aggregate.readiness.state, "READY");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 integration: a stale platform list, a forged expected base and a moved target each keep the run out of READY", async () => {
  const s = scenario({ "docs/a.md": "# A\n" });
  try {
    const stale = await pipeline(s.repo, s.head, { ctx: { platformFiles: platformList(["docs/other.md"]) } });
    assert.equal(state(stale.records, "1A.DIFF.PLATFORM_AGREEMENT"), "INCOMPLETE/DIFF_PATHS_MISMATCH");
    assert.equal(stale.changed.complete, false);
    assert.equal(state(stale.markdown.records, "1B.MARKDOWN.FILES"), "INCOMPLETE/CHANGED_FILES_INPUT_INVALID", "1B refuses a changed-file set that 1A could not confirm");
    assert.notEqual(stale.aggregate.readiness.state, "READY");
    const forged = await pipeline(s.repo, s.head, { ctx: s.ctx, extra: { manifestAssertions: { expectedBase: s.head } } });
    assert.equal(state(forged.records, "1A.IDENTITY.EXPECTED_BASE"), "FAIL/BASE_MISMATCH");
    assert.equal(forged.identity.subject.base, s.base);
    const moved = await pipeline(s.repo, s.head, { ctx: { ...s.ctx, suppliedTargetSha: s.head } });
    assert.equal(state(moved.records, "1A.IDENTITY.TARGET_TIP"), "INCOMPLETE/TARGET_TIP_MISMATCH");
  } finally {
    s.repo.cleanup();
  }
});

test("W1 integration: the whole pipeline is read-only (no ref, index, config, working-tree or FETCH_HEAD change)", async () => {
  const s = scenario({ "docs/a.md": "# A\n[b](b.md)\n" });
  try {
    const snapshot = () => ({ refs: s.repo.git("for-each-ref"), status: s.repo.git("status", "--porcelain"), config: s.repo.git("config", "--local", "--list"), head: s.repo.sha("HEAD"), index: s.repo.git("ls-files", "--stage"), reflog: s.repo.git("reflog").split("\n").length, tree: fs.readdirSync(s.repo.root).sort().join(",") });
    const before = snapshot();
    await pipeline(s.repo, s.head, { ctx: s.ctx });
    await pipeline(s.repo, s.head, { ctx: s.ctx });
    assert.deepEqual(snapshot(), before);
    assert.equal(fs.existsSync(nodePath.join(s.repo.root, ".git", "FETCH_HEAD")), false);
  } finally {
    s.repo.cleanup();
  }
});

test("W1 integration: results are deterministic (byte-equivalent as data) across runs", async () => {
  const s = scenario({ "docs/a.md": "# A\n[m](nope.md) TB-99\n", "docs/z.md": "# Z\n", "docs/é.md": "# E\n" });
  try {
    const a = await pipeline(s.repo, s.head, { ctx: { platformFiles: platformList(["docs/z.md", "docs/é.md", "docs/a.md"]) } });
    const b = await pipeline(s.repo, s.head, { ctx: { platformFiles: platformList(["docs/a.md", "docs/é.md", "docs/z.md"]) } });
    assert.equal(JSON.stringify(a.records), JSON.stringify(b.records));
    assert.deepEqual([...a.changed.files], ["docs/a.md", "docs/z.md", "docs/é.md"]);
  } finally {
    s.repo.cleanup();
  }
});

test("W1 integration: POST_MERGE identity feeds the same 1A/1B functions (first parent..merge range)", async () => {
  const repo = createTempRepo();
  try {
    repo.commit("base", { "README.md": "r\n", [WORKFLOW]: "w\n", "governance/base.json": JSON.stringify(POLICY), "docs/b.md": "# B\n" });
    repo.checkout("feature", true);
    const head = repo.commit("head", { "docs/a.md": "# A\n[b](b.md) [gone](gone.md)\n" });
    repo.checkout("main");
    repo.git("merge", "--no-ff", "-q", "-m", "Merge PR", "feature");
    const merge = repo.sha("HEAD");
    const common = gitOptions(repo);
    const identity = await g.getGitIdentity({ trustedContext: postMergeContext(merge, head), ...common });
    assert.equal(identity.established, true);
    const changed = await g.getChangedFiles({ subject: identity.subject, ...common });
    assert.deepEqual([...changed.files], ["docs/a.md"]);
    const markdown = await g.checkReferences({ subject: identity.subject, changedFiles: changed, policy: identity.policy.policy, ...common });
    assert.equal(state(markdown.records, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
    for (const r of [...identity.records, ...changed.records, ...markdown.records]) assert.deepEqual(r.range === undefined ? r.subject.range : null, { mode: "POST_MERGE", from: identity.subject.base, to: merge });
  } finally {
    repo.cleanup();
  }
});

test("W1 integration: error text never carries secrets, raw Git output or hostile caller strings", async () => {
  const s = scenario({ "docs/a.md": "# A\n" });
  try {
    const hostile = `${GH}\nsecret-branch\u0000${"X".repeat(400)}`;
    const results = [
      await g.getGitIdentity({ trustedContext: prContext(s.head, { targetRefName: hostile, provider: hostile, repositoryId: hostile }), ...gitOptions(s.repo) }),
      await g.getGitIdentity({ trustedContext: prContext(s.head), ...gitOptions(s.repo), remoteResolver: () => hostile }),
      await g.getGitIdentity({ trustedContext: prContext("0".repeat(40)), ...gitOptions(s.repo) }),
    ];
    for (const r of results) {
      const text = JSON.stringify(r);
      assert.equal(text.includes(GH), false);
      assert.equal(text.includes("secret-branch"), false);
      assert.equal(/fatal:|error:|usage:/i.test(text), false, "no raw Git output");
      assert.ok(r.outcome === null || r.outcome.detail.length <= 320);
    }
  } finally {
    s.repo.cleanup();
  }
});

// ----------------------------------------------------------------- boundaries

test("W1 boundary: the public surface adds exactly the six design-named interfaces and exposes no internals", () => {
  for (const name of ["getGitIdentity", "getChangedFiles", "checkScope", "scanSecrets", "parseMarkdown", "checkReferences"]) assert.equal(typeof g[name], "function", name);
  const internals = ["createGitAdapter", "isGitAdapter", "resolveGitAdapter", "createHeadReader", "parseDocument", "scanInline", "splitTableRow", "compileFamily", "extractFamily", "slugify", "createSlugger", "validateBasePolicy", "parseBasePolicyBytes", "parseSuppression", "policyDigest", "resolveFrameworkMetadata", "fingerprintOf", "TOKEN_RULES", "FRAMEWORK_METADATA", "validateTrustedContext", "isValidBranchName", "parsePathPattern", "matchPathPattern", "patternCovers", "validateRepoRelativePath", "compareBytewise", "createRecordFactory", "detectLineHits", "tokenHits", "classifyDestination"];
  for (const name of internals) assert.equal(name in g, false, name);
  assert.equal(Object.isFrozen(g), true);
});

test("W1 boundary: no later-wave or GOV-VERIFY residue capability exists (1C..1G, CI evidence, merge-gate facts)", () => {
  for (const name of ["checkEvidenceModel", "checkConsistency", "computeDeltaReview", "collectCiEvidence", "buildReport", "computeFingerprints", "verifyMergeGate", "getBranchProtection", "computePackDiff"]) assert.equal(name in g, false, name);
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js") && !entry.name.startsWith("test-support")) sources.push(full);
    }
  };
  walk(nodePath.join(__dirname, "stages"));
  const text = sources.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const marker of ["gh api", "api.github.com", "fetch(", "https.request", "http.request", "workflow_run", "check-runs", "actions/runs", "branch-protection", "PACK_DIFF", "SAFE_TO_MERGE"]) {
    assert.equal(text.includes(marker), false, `no ${marker} in stage code`);
  }
  assert.equal(/require\(["']node:(net|http|https|dgram|tls)["']\)/.test(text), false, "no network module is required by stage code");
  assert.equal(/require\(["']node:child_process["']\)/.test(text), false, "stage code spawns nothing directly: only the certified process runner does");
  // (?<![.\w]) excludes method calls such as RegExp#exec(...): only process-spawning / eval forms count.
  assert.equal(/(?<![.\w])(exec|execSync|execFile|execFileSync|spawn|spawnSync)\(|shell:\s*true|(?<![.\w])eval\(|new Function\(/.test(text), false);
});

test("W1 boundary: every Git command line is built only in the Git adapter (argument arrays, no shell string)", () => {
  const adapterSource = fs.readFileSync(nodePath.join(__dirname, "stages", "1a", "git-adapter.js"), "utf8");
  assert.match(adapterSource, /createProcessRunner/);
  assert.match(adapterSource, /"--literal-pathspecs"/);
  const others = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && !entry.name.includes("test") && entry.name !== "git-adapter.js") others.push(full);
    }
  };
  walk(nodePath.join(__dirname, "stages"));
  for (const file of others) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(/["'`]git["'`]|\bgit\s+(diff|log|show|rev-parse|merge-base|ls-tree|cat-file|fetch)\b/.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), false, `${nodePath.basename(file)} does not build Git commands`);
  }
});

test("W1 boundary: the package surface is unchanged (governance is not published or exported)", () => {
  const pkg = JSON.parse(fs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8"));
  assert.equal(pkg.files.some((f) => f.includes("governance")), false);
  assert.equal(JSON.stringify(pkg.exports).includes("governance"), false);
  assert.equal(pkg.main, "scripts/ai/index.js");
  assert.equal(pkg.engines.node, "22.x");
  assert.deepEqual(Object.keys(pkg.exports).sort(), [".", "./destinations/azure-devops", "./package.json", "./providers/azure-devops", "./providers/jira"]);
});

test("W1 boundary: framework capability metadata lists exactly the Wave 1 capabilities on top of the Wave 0 kernel", () => {
  const { FRAMEWORK_METADATA, CAPABILITY_REPOSITORY_PREFLIGHT, CAPABILITY_MARKDOWN_REFERENCE_INTEGRITY } = require("./framework-metadata");
  assert.deepEqual([...FRAMEWORK_METADATA.supportedCapabilities], [CAPABILITY_REPOSITORY_PREFLIGHT, CAPABILITY_MARKDOWN_REFERENCE_INTEGRITY]);
  assert.equal(g.validateFrameworkMetadata(FRAMEWORK_METADATA).ok, true);
  for (const id of FRAMEWORK_METADATA.supportedCapabilities) assert.equal(g.validateCapabilityId(id).ok, true, id);
});

test("W1 boundary: new Wave 1 reason codes are unique, well-formed and free of synonyms", () => {
  const values = Object.values(g.REASON);
  assert.equal(new Set(values).size, values.length);
  for (const [key, value] of Object.entries(g.REASON)) assert.equal(key, value);
  for (const code of ["TARGET_TIP_MISMATCH", "BASE_NOT_ESTABLISHED", "DEGENERATE_RANGE", "PLATFORM_FILE_LIST_INCOMPLETE", "PLATFORM_FILE_LIST_ANOMALY", "DIFF_PATHS_MISMATCH", "DIFF_EMPTY_UNEXPECTED", "EMPTY_DIFF_CONFIRMED", "POLICY_OUTDATED", "BASE_MISMATCH", "INVOCATION_NOT_ANCHORED", "TARGET_NOT_PROTECTED", "MERGE_NOT_ON_TARGET", "TOPOLOGY_UNEXPECTED", "BASE_NOT_ON_TARGET_HISTORY", "OPERATOR_INVOCATION", "GOVERNANCE_CONFIG", "SECRET_FOUND", "SUPPRESSION_INVALID", "MARKDOWN_STRUCTURE_INVALID", "REFERENCE_DANGLING", "REFERENCE_DUPLICATE", "REFERENCE_MALFORMED", "NO_BASE_TRUST_ANCHOR", "NO_BASE_GATE_ANCHOR", "DEFAULT_BRANCH_UNAVAILABLE"]) assert.equal(g.REASON[code], code, code);
  assert.match(values.join(","), /^[A-Z0-9_,]+$/);
});
