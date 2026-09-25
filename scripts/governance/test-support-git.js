"use strict";

// Test-only helpers (internal; not part of the public kernel interface): temporary
// real Git repositories and a resolver for the absolute Git executable. Nothing
// here touches the network or the repository under test.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");

function findGit() {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const out = execFileSync(finder, ["git"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const exe = out.find((line) => /git(\.exe)?$/i.test(line)) || out[0];
  return fs.realpathSync.native(exe);
}

const GIT = findGit();
const IDENT = ["-c", "user.name=Gov Test", "-c", "user.email=gov@example.test", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"];

/** A throw-away repository on branch `main`; every helper returns plain data. */
function createTempRepo() {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gov-w1-repo-"));
  const git = (...args) => execFileSync(GIT, [...IDENT, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(/\r?\n$/, "");
  git("init", "-q", "-b", "main");
  const repo = {
    root,
    git,
    write(path, content) {
      const full = nodePath.join(root, ...path.split("/"));
      fs.mkdirSync(nodePath.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    },
    remove(path) {
      fs.rmSync(nodePath.join(root, ...path.split("/")), { force: true });
    },
    commit(message, files = {}) {
      for (const [path, content] of Object.entries(files)) {
        if (content === null) repo.remove(path);
        else repo.write(path, content);
      }
      git("add", "-A");
      git("commit", "-q", "--allow-empty", "-m", message);
      return git("rev-parse", "HEAD");
    },
    checkout(branch, create = false) {
      git("checkout", "-q", ...(create ? ["-b"] : []), branch);
    },
    sha: (ref) => git("rev-parse", `${ref}^{commit}`),
    tree: (ref) => git("rev-parse", `${ref}^{tree}`),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return repo;
}

/** A valid base policy (plain JSON text) used by most Wave 1 tests. */
function basePolicy(overrides = {}) {
  return {
    schemaVersion: 1,
    requiredCapabilities: [],
    protectedTargetRefs: ["main"],
    scope: {
      allowedPathDomains: ["docs/**", "src/**", "README.md"],
      forbiddenPathDomains: ["secrets/**"],
      protectedPaths: ["governance/**", "scripts/governance/**", ".github/workflows/**"],
    },
    secretRules: [],
    suppressionPolicy: { maxExpiryDays: 90 },
    suppressions: [],
    markdown: { filePatterns: ["**/*.md"], idFamilies: [] },
    ...overrides,
  };
}

module.exports = { GIT, createTempRepo, basePolicy };

// ---------------------------------------------------------------------------------
// Wave 1 builders (still test-only).

/** A valid PR_REVIEW trusted context; every field can be overridden. */
function prContext(head, overrides = {}) {
  return {
    mode: "PR_REVIEW",
    invocationTrust: "PLATFORM_AUTHENTICATED",
    provider: "github",
    repositoryId: "owner/repo",
    eventType: "pull_request",
    targetRefName: "main",
    defaultBranchName: "main",
    headSha: head,
    suppliedTargetSha: null,
    mergedPrHeadSha: null,
    workflow: null,
    platformFiles: null,
    ...overrides,
  };
}

/** A valid POST_MERGE trusted context (the merge commit is the head under verification). */
function postMergeContext(mergeSha, mergedPrHeadSha, overrides = {}) {
  return prContext(mergeSha, { mode: "POST_MERGE", eventType: "push", mergedPrHeadSha, ...overrides });
}

/** The platform changed-file list shape, complete unless overridden. */
function platformList(paths, overrides = {}) {
  return {
    entries: paths.map((p) => (typeof p === "string" ? { path: p, previousPath: null } : p)),
    reportedCount: paths.length,
    paginationExhausted: true,
    listLimit: 3000,
    ...overrides,
  };
}

/** Options that make the public functions use a real Git adapter against `repo`. */
function gitOptions(repo) {
  return { repositoryRoot: repo.root, gitExecutable: GIT, remoteResolver: () => repo.root };
}

/** An in-memory head reader over { path: string | Buffer | { kind } }. */
function fakeReader(files, { listFails = false } = {}) {
  const dirs = new Set();
  for (const p of Object.keys(files)) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    calls: { read: [], stat: [], list: 0 },
    async read(path) {
      this.calls.read.push(path);
      if (!Object.hasOwn(files, path)) return { kind: "absent" };
      const v = files[path];
      if (v !== null && typeof v === "object" && !(v instanceof Uint8Array) && !Buffer.isBuffer(v)) return v;
      return { kind: "blob", bytes: new Uint8Array(Buffer.from(v)) };
    },
    async stat(path) {
      this.calls.stat.push(path);
      if (Object.hasOwn(files, path)) {
        const v = files[path];
        return { kind: v !== null && typeof v === "object" && v.kind === "symlink" ? "symlink" : "file" };
      }
      return { kind: dirs.has(path) ? "dir" : "absent" };
    },
    async list() {
      this.calls.list += 1;
      return listFails ? { ok: false, paths: [] } : { ok: true, paths: Object.keys(files).sort() };
    },
  };
}

/** A canonical 1A changed-files result for a subject (what getChangedFiles returns). */
function changedResult(subject, files, complete = true) {
  return { subject, files: [...files], complete, emptyDiffConfirmed: false, records: [] };
}

const SUBJECT_SHA = { head: "a".repeat(40), tree: "b".repeat(40), base: "c".repeat(40) };
function makeSubject(overrides = {}) {
  return { ...SUBJECT_SHA, range: { mode: "PR_REVIEW", from: SUBJECT_SHA.base, to: SUBJECT_SHA.head }, ...overrides };
}

module.exports.prContext = prContext;
module.exports.postMergeContext = postMergeContext;
module.exports.platformList = platformList;
module.exports.gitOptions = gitOptions;
module.exports.fakeReader = fakeReader;
module.exports.changedResult = changedResult;
module.exports.makeSubject = makeSubject;
