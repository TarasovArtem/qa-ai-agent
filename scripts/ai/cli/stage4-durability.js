"use strict";
const fs = require("fs");
const path = require("path");
const { resolveSafeRepositoryWritePath, isCanonicalPathInsideRoot } = require("../context-utils");
const { pathsOverlap, toPosixRelative } = require("./paths");
const { CliError, inputRefused } = require("./errors");
function durabilityError(cause, facts = {}) {
  const e = new CliError(1, "INTERNAL_ERROR", "Stage 4 evidence durability could not be confirmed.");
  e.causeCode = cause && cause.code; Object.assign(e, facts); return e;
}
// Unsupported internal dependency-injection seam. The installed CLI always
// constructs this with the real filesystem and root-anchored authorization.
function createDurableStore({ root, runDirReal, protectedPaths = [], io = fs.promises, authorize } = {}) {
  function safe(name) {
    if (typeof name !== "string" || !/^(?:review\/|apply\/)?[a-zA-Z0-9.-]+$/.test(name) || name.includes("..")) throw inputRefused("RUN_STATE_INCONSISTENT", "invalid evidence path.");
    const target = path.join(runDirReal, ...name.split("/"));
    if (authorize) { authorize(target); return target; }
    if (!root || !root.realRoot) throw new Error("missing repository root");
    let current = root.realRoot;
    const segments = path.relative(root.realRoot, path.dirname(target)).split(path.sep);
    if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: target })) throw new Error("outside root");
    for (const segment of segments) {
      current = path.join(current, segment); const st = fs.lstatSync(current);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("redirected evidence directory");
    }
    const parent = fs.realpathSync.native(path.dirname(target));
    if (!isCanonicalPathInsideRoot({ root: runDirReal, candidate: parent }) || protectedPaths.some(p => pathsOverlap(toPosixRelative(root.realRoot, parent), p))) throw new Error("unsafe evidence directory");
    return resolveSafeRepositoryWritePath(target, root, "Stage 4 evidence");
  }
  async function flushDirectory(dir) {
    const h = await io.open(dir, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0));
    try { await h.sync(); } finally { await h.close(); }
  }
  async function create(name, bytes, { directoryFlush = true } = {}) {
    let created = false, h;
    try {
      const target = safe(name);
      h = await io.open(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      created = true;
      const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8"); let offset = 0;
      while (offset < b.length) { const r = await h.write(b, offset, b.length - offset, null); if (!Number.isInteger(r.bytesWritten) || r.bytesWritten <= 0) throw new Error("short write"); offset += r.bytesWritten; }
      await h.sync(); const closing = h; h = undefined; await closing.close();
      if (directoryFlush) await flushDirectory(path.dirname(target));
      return { created: true };
    } catch (cause) {
      if (h) try { await h.close(); } catch {}
      throw durabilityError(cause, { created });
    }
  }
  async function ensureDirectory(name) {
    if (!["review", "apply"].includes(name)) throw new Error("invalid evidence directory");
    // Authorize the existing run root before creating its direct child.
    safe("manifest.json");
    const dir = path.join(runDirReal, name);
    try {
      try { await io.mkdir(dir, { mode: 0o700 }); }
      catch (e) { if (e.code !== "EEXIST") throw e; }
      const st = await io.lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink() || await io.realpath(dir) !== dir) throw new Error("invalid evidence directory kind");
      safe(`${name}/probe.json`); // verifies actual directory kind/containment
      // Visibility is not durability: a concurrent creator may not yet have
      // flushed the parent entry, or may have failed doing so. Every user
      // establishes D-DIR before writing authority evidence in this child.
      await flushDirectory(runDirReal);
    } catch (e) { throw durabilityError(e); }
  }
  async function replace(bytes, ledgerIndex, { expectedDigest } = {}) {
    let renamed = false;
    try {
      if (!Number.isInteger(ledgerIndex) || ledgerIndex < 1 || ledgerIndex > 9999) throw new Error("ledger capacity");
      const name = `manifest.next-${String(ledgerIndex).padStart(4, "0")}.json`;
      await create(name, bytes, { directoryFlush: false });
      if (typeof expectedDigest === "string") {
        const current = await io.readFile(safe("manifest.json"));
        const actual = require("./run-store").sha256(current);
        if (actual !== expectedDigest) throw Object.assign(new Error("manifest changed before replacement"), { code: "RUN_CHANGED_DURING_COMMAND" });
      }
      // Atomic rename is the visible commit point. A subsequent directory
      // flush confirms durability; it cannot be rolled back or retried.
      await io.rename(safe(name), safe("manifest.json")); renamed = true;
      await flushDirectory(runDirReal);
      return { sectionOutcome: "COMMITTED", renamed: true };
    } catch (cause) { throw durabilityError(cause, { sectionOutcome: renamed ? "ORPHANED" : "PRE_RENAME_FAILED", renamed }); }
  }
  return { create, replace, ensureDirectory };
}
module.exports = { createDurableStore };
