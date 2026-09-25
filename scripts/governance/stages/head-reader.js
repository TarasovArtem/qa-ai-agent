/**
 * GOV-AUTO-1 Wave 1 -- read-only reader of repository content AT the exact head
 * commit (internal to stages 1A and 1B).
 *
 * Content is read from Git OBJECTS of the head commit, never from the working
 * tree: the bytes are the reviewed bytes, a symlink is reported as a symlink and
 * is never followed (so a link can never escape repositoryRoot), a submodule or a
 * directory is never read as a file, and a file over the caller's bound is
 * reported as too large instead of being read. Nothing here executes, imports or
 * sources content; it is data only.
 *
 * Reader contract (also the test/injection seam):
 *   read(path, maxBytes) -> { kind: "blob", bytes } | { kind: "absent" | "symlink" |
 *                            "tree" | "submodule" } | { kind: "too-large", size } |
 *                            { kind: "error" }
 *   stat(path)           -> { kind: "file" | "dir" | "symlink" | "submodule" | "absent" | "error" }
 *   list()               -> { ok, paths } every file path at the head (sorted as Git lists them)
 */

"use strict";

const { validateRepoRelativePath } = require("../safety/repo-path");
const { isPlainObject } = require("../kernel/validation");

const READER_METHODS = ["read", "stat", "list"];

function isHeadReader(reader) {
  return reader !== null && typeof reader === "object" && READER_METHODS.every((m) => typeof reader[m] === "function");
}

function createHeadReader(git, commit) {
  let listing = null;
  return Object.freeze({
    async read(path, maxBytes) {
      if (!validateRepoRelativePath(path).ok) return { kind: "error" };
      const blob = await git.readBlob(commit, path, maxBytes);
      if (!blob.ok) return { kind: "error" };
      return blob.value;
    },
    async stat(path) {
      if (!validateRepoRelativePath(path).ok) return { kind: "error" };
      const entry = await git.treeEntry(commit, path);
      if (!entry.ok) return { kind: "error" };
      const v = entry.value;
      if (v.absent) return { kind: "absent" };
      if (v.mode === "120000") return { kind: "symlink" };
      if (v.type === "tree") return { kind: "dir" };
      if (v.type === "commit") return { kind: "submodule" };
      return { kind: "file" };
    },
    async list() {
      if (listing === null) {
        const r = await git.listTree(commit);
        listing = r.ok && r.value.invalid === 0 ? { ok: true, paths: r.value.paths } : { ok: false, paths: [] };
      }
      return listing;
    },
  });
}

/** Resolve the reader for a public function: an injected reader, or Git objects at `subject.head`. */
function resolveReader(input, git, headCommit) {
  if (isPlainObject(input) && isHeadReader(input.reader)) return { ok: true, reader: input.reader };
  if (git) return { ok: true, reader: createHeadReader(git, headCommit) };
  return { ok: false };
}

module.exports = { createHeadReader, isHeadReader, resolveReader };
