/**
 * GOV-AUTO-1 Wave 1 / 1A -- narrow Git adapter (design sections 18, 24).
 *
 * This is the ONLY module that builds Git command lines; command builders are
 * private to 1A and are not part of the public interface. Every command goes
 * through the certified Wave 0 process runner (argument arrays, no shell, pinned
 * absolute Git executable, bounded time and output, allow-listed environment).
 * Nothing here mutates the working tree, the index, refs, branches or
 * configuration: every command is read-only, and the one network operation
 * (resolving the protected target tip) writes neither a ref nor FETCH_HEAD.
 *
 * Contract: every method returns a frozen { ok: true, value } or
 * { ok: false, detail } where `detail` is a fixed, redacted, bounded label. No
 * method throws for a Git failure and none returns raw Git output as a message.
 * Tests replace this adapter with fixtures; the same shape is the injection seam.
 *
 * Determinism: only machine formats are parsed (NUL-delimited, fixed --format),
 * never human-oriented output, and locale is pinned by the runner (LC_ALL=C).
 * Paths are exact bytes: they are returned only when they are valid UTF-8.
 */

"use strict";

const { createProcessRunner } = require("../../safety/process");
const { validateRepoRelativePath } = require("../../safety/repo-path");
const { deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { isValidBranchName } = require("./trusted-context");

const SHA40 = /^[0-9a-f]{40}$/;
const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const MAX_FIRST_PARENT_BYTES = 4 * 1024 * 1024;
// --literal-pathspecs: a repository path is data, never pathspec magic (`:(glob)`, wildcards).
const GLOBAL_ARGS = ["--no-pager", "--no-optional-locks", "--literal-pathspecs"];
const ADAPTER_METHODS = ["localHead", "commitInfo", "resolveTargetTip", "mergeBases", "isAncestor", "diffNames", "treeEntry", "readBlob", "listTree", "firstParentContains"];

const ok = (value) => deepFreeze({ ok: true, value });
// A typed array cannot be deep-frozen; blob bytes are internal to 1A/1B and never part of a public result.
const okBytes = (kind, bytes) => Object.freeze({ ok: true, value: Object.freeze({ kind, bytes }) });
const fail = (detail) => deepFreeze({ ok: false, detail: String(detail).slice(0, 240) });

/** True when `adapter` exposes the complete injected-adapter surface. */
function isGitAdapter(adapter) {
  return adapter !== null && typeof adapter === "object" && ADAPTER_METHODS.every((m) => typeof adapter[m] === "function");
}

/** Default remote derivation: framework code, never local `origin` or a manifest. */
function defaultRemoteResolver(provider, repositoryId) {
  return provider === "github" && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repositoryId) ? `https://github.com/${repositoryId}.git` : null;
}

function splitNul(buffer) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0) {
      parts.push(buffer.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < buffer.length) parts.push(buffer.subarray(start));
  return parts;
}

function decodePaths(buffer) {
  const paths = [];
  let invalid = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const part of splitNul(buffer)) {
    try {
      paths.push(decoder.decode(part));
    } catch {
      invalid += 1;
    }
  }
  return { paths, invalid };
}

/**
 * Create the concrete adapter. `gitExecutable` must be an absolute path chosen by
 * trusted framework code (it is pinned by the runner policy; a bare `git` is
 * rejected). `remoteResolver(provider, repositoryId)` derives the fetch URL from
 * the trusted repository identity.
 */
function createGitAdapter({ repositoryRoot, gitExecutable, remoteResolver = defaultRemoteResolver, timeoutMs = 30000, networkTimeoutMs = 120000 } = {}) {
  const runner = createProcessRunner({ repositoryRoot, allowedExecutables: [gitExecutable] });

  async function git(args, { binary = false, maxStdoutBytes = 1024 * 1024, network = false, okExit = [0] } = {}) {
    let result;
    try {
      result = await runner.run({
        file: gitExecutable,
        args: [...GLOBAL_ARGS, ...args],
        timeoutMs: network ? networkTimeoutMs : timeoutMs,
        maxStdoutBytes,
        maxStderrBytes: 16 * 1024,
        stdoutEncoding: binary ? "base64" : "utf8",
      });
    } catch {
      return { ok: false, detail: `git ${args[0]} could not be started` };
    }
    if (result.outcome !== "EXITED") return { ok: false, detail: `git ${args[0]} ${result.outcome.toLowerCase()}` };
    // Fixed label only: raw (even redacted) stderr never becomes part of a message.
    if (!okExit.includes(result.exitCode)) return { ok: false, exitCode: result.exitCode, detail: `git ${args[0]} failed (exit ${result.exitCode})` };
    return { ok: true, exitCode: result.exitCode, stdout: binary ? Buffer.from(result.stdout, "base64") : result.stdout };
  }

  const sha = (value) => typeof value === "string" && SHA40.test(value);

  async function localHead() {
    const r = await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    const line = r.ok ? r.stdout.trim() : "";
    return sha(line) ? ok(line) : fail(r.ok ? "HEAD is not a commit" : r.detail);
  }

  async function commitInfo(commit) {
    if (!sha(commit)) return fail("not a full commit SHA");
    const r = await git(["show", "--no-patch", "--no-show-signature", "--format=%H%n%T%n%P", `${commit}^{commit}`]);
    if (!r.ok) return fail(r.detail);
    const lines = r.stdout.split("\n");
    const parents = lines[2] ? lines[2].trim().split(" ").filter(Boolean) : [];
    if (lines[0] !== commit || !sha(lines[1]) || parents.length > 16 || !parents.every(sha)) return fail("unexpected commit metadata");
    return ok({ sha: commit, tree: lines[1], parents });
  }

  async function resolveTargetTip(provider, repositoryId, refName) {
    if (!isValidBranchName(refName)) return fail("invalid target ref name");
    const url = remoteResolver(provider, repositoryId);
    if (typeof url !== "string" || url.length === 0 || url.length > 512 || url.startsWith("-") || /[\u0000-\u001f\u007f\s]/.test(url)) {
      return fail("the remote could not be derived from the trusted repository identity");
    }
    const ref = `refs/heads/${refName}`;
    const listing = await git(["ls-remote", "--exit-code", "--refs", "--", url, ref], { network: true });
    if (!listing.ok) return fail(listing.detail);
    const rows = listing.stdout.split("\n").filter(Boolean);
    const [tip, name] = rows.length === 1 ? rows[0].split("\t") : [];
    if (!sha(tip) || name !== ref) return fail("target ref did not resolve to exactly one commit");
    // Obtain the objects without writing any ref or FETCH_HEAD; an object that is
    // already present locally is sufficient, so a failed fetch alone is not fatal.
    await git(["fetch", "--no-tags", "--no-write-fetch-head", "--quiet", "--", url, ref], { network: true });
    const info = await commitInfo(tip);
    return info.ok ? ok(tip) : fail("the resolved target tip is not available locally");
  }

  async function mergeBases(a, b) {
    if (!sha(a) || !sha(b)) return fail("not a full commit SHA");
    const r = await git(["merge-base", "--all", a, b], { okExit: [0, 1] });
    if (!r.ok) return fail(r.detail);
    const lines = r.stdout.split("\n").filter(Boolean);
    return lines.every(sha) && lines.length <= 16 ? ok([...new Set(lines)].sort()) : fail("unexpected merge-base output");
  }

  async function isAncestor(ancestor, descendant) {
    if (!sha(ancestor) || !sha(descendant)) return fail("not a full commit SHA");
    const r = await git(["merge-base", "--is-ancestor", ancestor, descendant], { okExit: [0, 1] });
    return r.ok ? ok(r.exitCode === 0) : fail(r.detail);
  }

  async function diffNames(from, to) {
    if (!sha(from) || !sha(to)) return fail("not a full commit SHA");
    // --ignore-submodules=none is explicit: submodule.<name>.ignore in a head-controlled
    // .gitmodules (or local config) must never hide a gitlink addition, removal or pointer move.
    const r = await git(["diff", "--name-only", "-z", "--no-renames", "--ignore-submodules=none", "--no-ext-diff", "--no-textconv", "--no-color", from, to, "--"], { binary: true, maxStdoutBytes: MAX_LISTING_BYTES });
    if (!r.ok) return fail(r.detail);
    return ok(decodePaths(r.stdout));
  }

  async function treeEntry(commit, path) {
    if (!sha(commit) || !validateRepoRelativePath(path).ok) return fail("invalid commit or path");
    const r = await git(["ls-tree", "-z", commit, "--", path], { binary: true });
    if (!r.ok) return fail(r.detail);
    const entries = splitNul(r.stdout).map((b) => b.toString("utf8"));
    if (entries.length === 0) return ok({ absent: true });
    const match = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40})\t(.*)$/s.exec(entries[0]);
    if (!match || match[4] !== path || entries.length !== 1) return fail("unexpected tree entry");
    return ok({ absent: false, mode: match[1], type: match[2], sha: match[3] });
  }

  async function readBlob(commit, path, maxBytes) {
    if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > 16 * 1024 * 1024) return fail("invalid size bound");
    const entry = await treeEntry(commit, path);
    if (!entry.ok) return fail(entry.detail);
    if (entry.value.absent) return ok({ kind: "absent" });
    if (entry.value.mode === "120000") return ok({ kind: "symlink" });
    if (entry.value.type === "tree") return ok({ kind: "tree" });
    if (entry.value.type !== "blob") return ok({ kind: "submodule" });
    const size = await git(["cat-file", "-s", entry.value.sha]);
    const bytes = size.ok && /^[0-9]{1,10}\n?$/.test(size.stdout) ? Number(size.stdout) : -1;
    if (bytes < 0) return fail("blob size could not be established");
    if (bytes > maxBytes) return ok({ kind: "too-large", size: bytes });
    const body = await git(["cat-file", "blob", entry.value.sha], { binary: true, maxStdoutBytes: Math.max(1, bytes) });
    if (!body.ok) return fail(body.detail);
    if (body.stdout.length !== bytes) return fail("blob length mismatch");
    return okBytes("blob", new Uint8Array(body.stdout));
  }

  async function listTree(commit) {
    if (!sha(commit)) return fail("not a full commit SHA");
    const r = await git(["ls-tree", "-r", "-z", "--name-only", commit], { binary: true, maxStdoutBytes: MAX_LISTING_BYTES });
    if (!r.ok) return fail(r.detail);
    return ok(decodePaths(r.stdout));
  }

  async function firstParentContains(tip, commit) {
    if (!sha(tip) || !sha(commit)) return fail("not a full commit SHA");
    const r = await git(["rev-list", "--first-parent", tip], { maxStdoutBytes: MAX_FIRST_PARENT_BYTES });
    if (!r.ok) return fail(r.detail);
    return ok(r.stdout.split("\n").includes(commit));
  }

  return Object.freeze({ localHead, commitInfo, resolveTargetTip, mergeBases, isAncestor, diffNames, treeEntry, readBlob, listTree, firstParentContains });
}

/**
 * Resolve the adapter a public 1A/1B function should use: an injected adapter (the
 * test seam) or one built from { repositoryRoot, gitExecutable }. Anything else
 * is rejected; a caller cannot smuggle an arbitrary object past the shape check.
 */
function resolveGitAdapter(input) {
  if (isPlainObject(input) && isGitAdapter(input.git)) return { ok: true, git: input.git };
  if (isPlainObject(input) && typeof input.repositoryRoot === "string" && typeof input.gitExecutable === "string") {
    try {
      return { ok: true, git: createGitAdapter({ repositoryRoot: input.repositoryRoot, gitExecutable: input.gitExecutable, remoteResolver: input.remoteResolver || undefined }) };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

module.exports = { createGitAdapter, isGitAdapter, resolveGitAdapter, ADAPTER_METHODS };
