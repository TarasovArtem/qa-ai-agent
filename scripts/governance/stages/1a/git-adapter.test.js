"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGitAdapter, isGitAdapter, resolveGitAdapter, ADAPTER_METHODS } = require("./git-adapter");
const { GIT, createTempRepo } = require("../../test-support-git");

const SHA = /^[0-9a-f]{40}$/;

/** A repo with main (base) and feature (head) plus a symlink and a submodule entry. */
async function fixture() {
  const repo = createTempRepo();
  const base = repo.commit("base", { "README.md": "hi\n", "docs/a.md": "# A\n", "docs/b.md": "# B\n" });
  repo.checkout("feature", true);
  for (const [path, content] of Object.entries({ "docs/a.md": "# A2\n", "docs/new file.md": "# N\n", "é.md": "u\n", "\u{1F600}.md": "e\n", "docs/gone.md": "x\n" })) repo.write(path, content);
  repo.git("add", "-A");
  // A symlink (mode 120000) and a submodule (mode 160000) exist only as index entries here, so a
  // later `git add -A` must not run: they are added after the staging and committed as they are.
  const target = repo.git("hash-object", "-w", "docs/a.md");
  repo.git("update-index", "--add", "--cacheinfo", `120000,${target},docs/link.md`);
  repo.git("update-index", "--add", "--cacheinfo", `160000,${base},vendor/sub`);
  repo.git("commit", "-q", "-m", "head");
  const head = repo.sha("HEAD");
  const adapter = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT, remoteResolver: () => repo.root });
  return { repo, base, head, adapter };
}

test("W1 git adapter: exposes the complete adapter surface and rejects a bare or relative executable", () => {
  const repo = createTempRepo();
  try {
    const adapter = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT });
    assert.equal(isGitAdapter(adapter), true);
    assert.equal(Object.isFrozen(adapter), true);
    assert.deepEqual(Object.keys(adapter).sort(), [...ADAPTER_METHODS].sort());
    assert.throws(() => createGitAdapter({ repositoryRoot: repo.root, gitExecutable: "git" }), (e) => e.reasonCode === "PROCESS_INVALID_REQUEST");
    assert.throws(() => createGitAdapter({ repositoryRoot: repo.root, gitExecutable: "./git" }), (e) => e.reasonCode === "PROCESS_INVALID_REQUEST");
    assert.throws(() => createGitAdapter({ repositoryRoot: "relative", gitExecutable: GIT }));
    assert.equal(isGitAdapter({}), false);
    assert.equal(isGitAdapter(null), false);
    assert.equal(isGitAdapter({ ...adapter, mergeBases: undefined }), false);
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: resolveGitAdapter accepts an injected adapter or {repositoryRoot, gitExecutable} only", () => {
  const repo = createTempRepo();
  try {
    const adapter = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT });
    assert.equal(resolveGitAdapter({ git: adapter }).ok, true);
    assert.equal(resolveGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT }).ok, true);
    assert.equal(resolveGitAdapter({ git: { commitInfo() {} } }).ok, false);
    assert.equal(resolveGitAdapter({ repositoryRoot: repo.root, gitExecutable: "git" }).ok, false, "a bare executable is rejected, never PATH-resolved");
    assert.equal(resolveGitAdapter({}).ok, false);
    assert.equal(resolveGitAdapter(null).ok, false);
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: identity, ancestry and merge-base facts come from Git in machine formats", async () => {
  const { repo, base, head, adapter } = await fixture();
  try {
    const local = await adapter.localHead();
    assert.deepEqual({ ok: local.ok, v: local.value }, { ok: true, v: head });
    const info = await adapter.commitInfo(head);
    assert.equal(info.ok, true);
    assert.equal(info.value.sha, head);
    assert.equal(info.value.tree, repo.tree(head));
    assert.deepEqual([...info.value.parents], [base]);
    assert.deepEqual([...(await adapter.commitInfo(base)).value.parents], []);
    assert.deepEqual([...(await adapter.mergeBases(head, base)).value], [base]);
    assert.equal((await adapter.isAncestor(base, head)).value, true);
    assert.equal((await adapter.isAncestor(head, base)).value, false);
    assert.equal((await adapter.firstParentContains(head, base)).value, true);
    assert.equal((await adapter.firstParentContains(base, head)).value, false);
    const tip = await adapter.resolveTargetTip("github", "owner/repo", "main");
    assert.deepEqual({ ok: tip.ok, v: tip.value }, { ok: true, v: base });
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: every identifier is validated before it can reach a command line", async () => {
  const { repo, head, adapter } = await fixture();
  try {
    for (const sha of ["abc", "A".repeat(40), "--all", "-h", "HEAD", "main", "a".repeat(39), "", null, 5, "a".repeat(40) + " --x"]) {
      assert.equal((await adapter.commitInfo(sha)).ok, false, String(sha));
      assert.equal((await adapter.isAncestor(sha, head)).ok, false);
      assert.equal((await adapter.mergeBases(head, sha)).ok, false);
      assert.equal((await adapter.diffNames(sha, head)).ok, false);
      assert.equal((await adapter.listTree(sha)).ok, false);
      assert.equal((await adapter.firstParentContains(sha, head)).ok, false);
    }
    for (const path of ["", "../x", "/abs", "a//b", "a\\b", "./x", "a\u0000b", "-x/../y"]) {
      assert.equal((await adapter.treeEntry(head, path)).ok, false, JSON.stringify(path));
      assert.equal((await adapter.readBlob(head, path, 10)).ok, false, JSON.stringify(path));
    }
    // A path that merely LOOKS like an option is valid data and is passed after `--`: it is just absent.
    for (const optionLike of ["--help", "-x", "--exec-path=/tmp/x"]) {
      const r = await adapter.treeEntry(head, optionLike);
      assert.deepEqual({ ok: r.ok, absent: r.ok && r.value.absent }, { ok: true, absent: true }, optionLike);
    }
    for (const ref of ["--upload-pack=touch x", "-x", "a b", "a*", "..", "a..b", "", "a:b", "a~1", "a^", "a@{u}"]) {
      assert.equal((await adapter.resolveTargetTip("github", "owner/repo", ref)).ok, false, JSON.stringify(ref));
    }
    assert.equal((await adapter.readBlob(head, "README.md", -1)).ok, false);
    assert.equal((await adapter.readBlob(head, "README.md", 1.5)).ok, false);
    assert.equal((await adapter.readBlob(head, "README.md", 1e9)).ok, false);
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: paths are literal data, never pathspec magic or globs", async () => {
  const { repo, head, adapter } = await fixture();
  try {
    assert.equal((await adapter.treeEntry(head, "docs/a.md")).value.absent, false);
    for (const magic of ["docs/*.md", ":(glob)docs/*.md", ":(top)README.md", ":/README.md", "docs/[ab].md", "docs/?.md", ":(exclude)docs/a.md"]) {
      const r = await adapter.treeEntry(head, magic);
      assert.equal(r.ok, true, magic);
      assert.equal(r.value.absent, true, `${magic} must not match anything`);
    }
    assert.equal((await adapter.readBlob(head, "docs/*.md", 100)).value.kind, "absent");
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: the changed-path listing is NUL-delimited, has no rename detection and keeps exact bytes", async () => {
  const { repo, base, head, adapter } = await fixture();
  try {
    const r = await adapter.diffNames(base, head);
    assert.equal(r.ok, true);
    assert.equal(r.value.invalid, 0);
    assert.deepEqual([...r.value.paths].sort(), ["docs/a.md", "docs/gone.md", "docs/link.md", "docs/new file.md", "vendor/sub", "é.md", "\u{1F600}.md"].sort());
    // A rename contributes BOTH its old and new path (no rename detection).
    repo.checkout("rename", true);
    repo.git("mv", "docs/b.md", "docs/c.md");
    repo.git("commit", "-q", "-m", "rename"); // not `add -A`: the index-only symlink/submodule must stay
    const renamed = repo.sha("HEAD");
    const listing = await adapter.diffNames(head, renamed);
    assert.deepEqual([...listing.value.paths].sort(), ["docs/b.md", "docs/c.md"]);
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: treeEntry / readBlob classify blob, tree, symlink, submodule, absent and oversize without following anything", async () => {
  const { repo, head, adapter } = await fixture();
  try {
    const blob = await adapter.readBlob(head, "docs/a.md", 100);
    assert.equal(blob.value.kind, "blob");
    assert.equal(Buffer.from(blob.value.bytes).toString(), "# A2\n");
    assert.equal(blob.value.bytes instanceof Uint8Array, true);
    assert.equal((await adapter.readBlob(head, "docs", 100)).value.kind, "tree");
    assert.equal((await adapter.readBlob(head, "docs/link.md", 100)).value.kind, "symlink", "a symlink is reported, never followed");
    assert.equal((await adapter.readBlob(head, "vendor/sub", 100)).value.kind, "submodule");
    assert.equal((await adapter.readBlob(head, "docs/none.md", 100)).value.kind, "absent");
    assert.deepEqual({ ...(await adapter.readBlob(head, "docs/a.md", 2)).value }, { kind: "too-large", size: 5 });
    assert.equal((await adapter.treeEntry(head, "docs/link.md")).value.mode, "120000");
    repo.checkout("empty", true);
    repo.commit("empty file", { "empty.txt": "" });
    const empty = await adapter.readBlob(repo.sha("empty"), "empty.txt", 10);
    assert.equal(empty.value.kind, "blob");
    assert.equal(empty.value.bytes.length, 0);
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: raw bytes survive (invalid UTF-8 content is not silently repaired)", async () => {
  const repo = createTempRepo();
  try {
    const bytes = Buffer.from([0x66, 0xff, 0xfe, 0x00, 0x41]);
    repo.write("bin.dat", bytes);
    const commit = repo.commit("bin", {});
    const adapter = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT });
    const r = await adapter.readBlob(commit, "bin.dat", 100);
    assert.deepEqual([...r.value.bytes], [...bytes]);
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: zero and multiple merge bases are reported as data (not guessed)", async () => {
  const repo = createTempRepo();
  try {
    const root = repo.commit("root", { "a.txt": "1\n" });
    repo.checkout("a", true);
    const a1 = repo.commit("a1", { "a.txt": "a\n" });
    repo.checkout("main");
    repo.checkout("b", true);
    const b1 = repo.commit("b1", { "b.txt": "b\n" });
    repo.checkout("a");
    repo.checkout("x", true);
    repo.git("merge", "--no-ff", "-q", "-m", "x", "b");
    const x = repo.sha("HEAD");
    repo.checkout("b");
    repo.checkout("y", true);
    repo.git("merge", "--no-ff", "-q", "-m", "y", "a");
    const y = repo.sha("HEAD");
    const adapter = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT });
    assert.deepEqual([...(await adapter.mergeBases(x, y)).value].sort(), [a1, b1].sort(), "criss-cross: two merge bases");
    repo.git("checkout", "-q", "--orphan", "orphan");
    repo.git("rm", "-rf", "-q", ".");
    const orphan = repo.commit("orphan", { "o.txt": "o\n" });
    assert.deepEqual([...(await adapter.mergeBases(orphan, root)).value], [], "unrelated histories: zero merge bases");
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: the target tip is resolved from the DERIVED remote, and an unusable remote fails closed", async () => {
  const { repo, base, adapter } = await fixture();
  try {
    assert.equal((await adapter.resolveTargetTip("github", "owner/repo", "main")).value, base);
    assert.equal((await adapter.resolveTargetTip("github", "owner/repo", "no-such-branch")).ok, false);
    const noRemote = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT, remoteResolver: () => null });
    assert.equal((await noRemote.resolveTargetTip("github", "owner/repo", "main")).ok, false);
    for (const url of ["-oProxyCommand=x", "--upload-pack=x", "", "a b", "x\ny", "u".repeat(600)]) {
      const hostile = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT, remoteResolver: () => url });
      const r = await hostile.resolveTargetTip("github", "owner/repo", "main");
      assert.equal(r.ok, false, JSON.stringify(url).slice(0, 30));
    }
    // The default resolver derives a URL only for a known provider and a well-formed repository ID.
    const def = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT });
    assert.equal((await def.resolveTargetTip("unknown-provider", "owner/repo", "main")).ok, false);
    assert.equal((await def.resolveTargetTip("github", "not a repo", "main")).ok, false);
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: it is read-only (no ref, index, config or working-tree change; no FETCH_HEAD)", async () => {
  const { repo, base, head, adapter } = await fixture();
  try {
    const before = { refs: repo.git("for-each-ref"), status: repo.git("status", "--porcelain"), config: repo.git("config", "--local", "--list"), head: repo.sha("HEAD") };
    await adapter.resolveTargetTip("github", "owner/repo", "main");
    await adapter.commitInfo(head);
    await adapter.diffNames(base, head);
    await adapter.readBlob(head, "docs/a.md", 100);
    await adapter.listTree(head);
    await adapter.mergeBases(head, base);
    const after = { refs: repo.git("for-each-ref"), status: repo.git("status", "--porcelain"), config: repo.git("config", "--local", "--list"), head: repo.sha("HEAD") };
    assert.deepEqual(after, before);
    const fs = require("node:fs");
    assert.equal(fs.existsSync(`${repo.root}/.git/FETCH_HEAD`), false, "no FETCH_HEAD is written");
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: failures are fixed, redacted, bounded labels and never raw Git output", async () => {
  const repo = createTempRepo();
  try {
    const adapter = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT });
    const r = await adapter.commitInfo("0".repeat(40));
    assert.equal(r.ok, false);
    assert.ok(r.detail.length <= 240);
    assert.equal(/fatal|\n/i.test(r.detail), false, "no raw Git stderr text");
    for (const m of ["localHead"]) assert.equal((await adapter[m]()).ok, false, "no commit yet");
  } finally {
    repo.cleanup();
  }
});

test("W1 git adapter: results are frozen plain data", async () => {
  const { repo, head, adapter } = await fixture();
  try {
    const r = await adapter.commitInfo(head);
    assert.equal(Object.isFrozen(r), true);
    assert.equal(Object.isFrozen(r.value), true);
    assert.equal(Object.isFrozen(r.value.parents), true);
    assert.match(r.value.tree, SHA);
  } finally {
    repo.cleanup();
  }
});
