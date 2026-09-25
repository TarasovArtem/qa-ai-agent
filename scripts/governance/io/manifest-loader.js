/**
 * GOV-AUTO-1 Wave 0 -- bounded manifest file loader (the only I/O in Wave 0's
 * manifest path). Load is separate from validate and use: this module returns
 * bytes (or a stable failure) and `kernel/manifest.js` validates them. The path is
 * resolved through the repositoryRoot safety primitive, symlinked or non-regular
 * files are refused, and reading is capped so an oversized file is never fully
 * read. The manifest is never executed, imported or sourced.
 */

"use strict";

const fs = require("node:fs");
const { REASON, LIMITS, STATUS, deepFreeze } = require("../kernel/contracts");
const { resolveWithinRoot } = require("../safety/path");
const { parseManifestBytes } = require("../kernel/manifest");

function failure(reasonCode, detail) {
  return deepFreeze({ ok: false, reasonCode, detail });
}

/** Read the manifest bytes under repositoryRoot; never throws for file problems. */
function loadManifestBytes(repositoryRoot, relativePath, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : LIMITS.maxManifestBytes;
  let resolved;
  try {
    resolved = resolveWithinRoot(repositoryRoot, relativePath);
  } catch (error) {
    return failure(error.reasonCode || REASON.UNSAFE_PATH, "manifest path rejected");
  }
  let stat;
  try {
    stat = fs.lstatSync(resolved.absolute);
  } catch {
    return failure(REASON.MANIFEST_FIELD_MISSING, "manifest file not found");
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return failure(REASON.UNSAFE_PATH, "manifest must be a regular, non-symlink file");
  if (stat.size > maxBytes) return failure(REASON.MANIFEST_TOO_LARGE, "manifest exceeds the size limit");
  let fd;
  try {
    fd = fs.openSync(resolved.absolute, "r");
    const buffer = Buffer.alloc(maxBytes + 1);
    const read = fs.readSync(fd, buffer, 0, maxBytes + 1, 0);
    if (read > maxBytes) return failure(REASON.MANIFEST_TOO_LARGE, "manifest exceeds the size limit");
    // Shallow freeze: typed arrays with elements cannot be frozen.
    return Object.freeze({ ok: true, bytes: new Uint8Array(buffer.subarray(0, read)) });
  } catch {
    return failure(REASON.MANIFEST_JSON_INVALID, "manifest could not be read");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
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
  return parseManifestBytes(loaded.bytes, options.maxBytes);
}

module.exports = { loadManifestBytes, loadManifestFile };
