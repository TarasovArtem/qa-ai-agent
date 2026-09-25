/**
 * GOV-AUTO-1 Wave 0 -- bounded manifest file loader (the only I/O in Wave 0's
 * manifest path). Load is separate from validate and use: this module returns
 * bytes (or a stable failure) and `kernel/manifest.js` validates them. The path is
 * resolved through the repositoryRoot safety primitive, symlinked or non-regular
 * files are refused, and reading is capped so an oversized file is never fully
 * read. The manifest is never executed, imported or sourced.
 *
 * Open hardening (a path-level lstat alone is a check-then-open race):
 *   1. the leaf is opened with O_NOFOLLOW where the platform has it (POSIX), so a
 *      symlink swapped in after the check fails to open instead of being followed;
 *      O_NONBLOCK keeps a FIFO swapped in after the check from hanging the open;
 *   2. the OPENED descriptor is fstat-ed: it must be a regular file within the
 *      size bound, and (where the platform reports a meaningful inode) it must be
 *      the same object the pre-open lstat inspected;
 *   3. the read is a bounded loop, so a file that grows after fstat still cannot
 *      produce more than maxBytes + 1 bytes;
 *   4. after the read the path is lstat-ed again and must still be that object.
 * Residual limits (documented, tested where possible): Node has no openat, so a
 * swap of an INTERMEDIATE directory into a symlink between the path check and the
 * open cannot be excluded atomically; steps 2 and 4 narrow that window to an
 * attacker who restores the tree before step 4. Windows has no O_NOFOLLOW, so a
 * swapped leaf link there is caught only by the fstat identity and post-read
 * checks, never by the open itself.
 *
 * The returned payload is a read-only handle: the bytes live in a closure and
 * every read() returns a fresh copy, so no consumer can mutate another consumer's
 * data or the parser's input (a frozen typed array does not exist).
 */

"use strict";

const nodeFs = require("node:fs");
const { REASON, LIMITS, STATUS, deepFreeze } = require("../kernel/contracts");
const { resolveWithinRoot } = require("../safety/path");
const { parseManifestBytes } = require("../kernel/manifest");

function failure(reasonCode, detail) {
  return deepFreeze({ ok: false, reasonCode, detail });
}

/** Same filesystem object? Only meaningful when both sides report an inode. */
function sameObject(a, b) {
  if (a.ino === 0n || b.ino === 0n) return true;
  return a.ino === b.ino && a.dev === b.dev;
}

/** Wrap loaded bytes as an immutable, copy-on-read handle. */
function immutableBytes(bytes) {
  const held = new Uint8Array(bytes); // private copy; never handed out
  return Object.freeze({
    ok: true,
    byteLength: held.length,
    read: () => new Uint8Array(held),
  });
}

/** Read the manifest bytes under repositoryRoot; never throws for file problems. */
function loadManifestBytes(repositoryRoot, relativePath, options = {}) {
  const fs = options.fs || nodeFs;
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : LIMITS.maxManifestBytes;
  let resolved;
  try {
    resolved = resolveWithinRoot(repositoryRoot, relativePath, { fs });
  } catch (error) {
    return failure(error.reasonCode || REASON.UNSAFE_PATH, "manifest path rejected");
  }
  let before;
  try {
    before = fs.lstatSync(resolved.absolute, { bigint: true });
  } catch {
    return failure(REASON.MANIFEST_FIELD_MISSING, "manifest file not found");
  }
  if (before.isSymbolicLink() || !before.isFile()) return failure(REASON.UNSAFE_PATH, "manifest must be a regular, non-symlink file");
  if (before.size > BigInt(maxBytes)) return failure(REASON.MANIFEST_TOO_LARGE, "manifest exceeds the size limit");

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  let fd;
  try {
    fd = fs.openSync(resolved.absolute, flags);
  } catch {
    return failure(REASON.UNSAFE_PATH, "manifest could not be opened safely");
  }
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile()) return failure(REASON.UNSAFE_PATH, "opened manifest is not a regular file");
    if (opened.size > BigInt(maxBytes)) return failure(REASON.MANIFEST_TOO_LARGE, "manifest exceeds the size limit");
    if (!sameObject(before, opened)) return failure(REASON.UNSAFE_PATH, "manifest changed between check and open");

    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const read = fs.readSync(fd, buffer, total, buffer.length - total, total);
      if (read === 0) break;
      total += read;
    }
    if (total > maxBytes) return failure(REASON.MANIFEST_TOO_LARGE, "manifest exceeds the size limit");

    const after = fs.lstatSync(resolved.absolute, { bigint: true });
    if (after.isSymbolicLink() || !after.isFile() || !sameObject(after, opened)) {
      return failure(REASON.UNSAFE_PATH, "manifest changed while it was being read");
    }
    return immutableBytes(buffer.subarray(0, total));
  } catch {
    return failure(REASON.MANIFEST_JSON_INVALID, "manifest could not be read");
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* nothing left to release */
    }
  }
}

/** Convenience: load, then validate. Load failures become CONFIGURATION_ERROR results. */
function loadManifestFile(repositoryRoot, relativePath, options = {}) {
  const loaded = loadManifestBytes(repositoryRoot, relativePath, options);
  if (!loaded.ok) {
    return deepFreeze({
      valid: false,
      status: STATUS.CONFIGURATION_ERROR,
      findings: [{ reasonCode: loaded.reasonCode, path: "$", detail: loaded.detail }],
      manifest: null,
    });
  }
  return parseManifestBytes(loaded.read(), options.maxBytes);
}

module.exports = { loadManifestBytes, loadManifestFile };
