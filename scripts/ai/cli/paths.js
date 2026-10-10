/**
 * Path rules for config-supplied repository-relative paths
 * (requirements.path, output.dir) - mission §9.
 *
 * Two layers, both required:
 *   lexical   - isSafeRelativePath(): POSIX form only, no absolute/drive
 *               prefix, no backslash, no ':' (drive letters, alternate data
 *               streams), no empty/'.'/'..' segment, no control characters;
 *   canonical - assertCanonicallyContained(): the deepest existing ancestor
 *               (and the full path when it exists) must realpath inside the
 *               repository root, so a symlink/junction cannot redirect a
 *               read or write outside it, and (for output.dir) the canonical
 *               location must still not overlap a protected prefix.
 *
 * The root itself is never discovered upward: it is --root or the process
 * working directory, validated by assertValidRepositoryRoot().
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { isCanonicalPathInsideRoot } = require("../context-utils");
const { configError } = require("./errors");

const MAX_RELATIVE_PATH_LENGTH = 512;

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RELATIVE_PATH_LENGTH) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  if (value.includes("\\") || value.includes(":") || value.startsWith("/")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

// Case-insensitive on purpose: a protected prefix must not be reachable
// through a differently-cased spelling on a case-insensitive filesystem.
function segmentsOf(relPath) {
  return relPath
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}

function pathsOverlap(a, b) {
  const sa = segmentsOf(a);
  const sb = segmentsOf(b);
  if (sa.length === 0 || sb.length === 0) return true;
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function toPosixRelative(base, target) {
  return path.relative(base, target).split(path.sep).join("/");
}

// Realpath of the full path if it exists, otherwise of its deepest existing
// ancestor joined with the remaining (not yet existing) segments.
function canonicalize(root, relPath) {
  const segments = relPath.split("/");
  let existing = root.realRoot;
  let i = 0;
  for (; i < segments.length; i++) {
    const next = path.join(existing, segments[i]);
    let real;
    try {
      real = fs.realpathSync(next);
    } catch {
      break;
    }
    if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) return null;
    existing = real;
  }
  return path.join(existing, ...segments.slice(i));
}

function assertCanonicallyContained(root, relPath, label, { protectedPaths = [] } = {}) {
  if (!isSafeRelativePath(relPath)) {
    throw configError("CONFIG_PATH_INVALID", `${label} must be a safe repository-relative POSIX path.`);
  }
  const lexical = path.resolve(root.realRoot, relPath);
  if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: lexical }) || lexical === root.realRoot) {
    throw configError("CONFIG_PATH_OUTSIDE_ROOT", `${label} must stay inside the repository root.`);
  }
  const canonical = canonicalize(root, relPath);
  if (!canonical || !isCanonicalPathInsideRoot({ root: root.realRoot, candidate: canonical }) || canonical === root.realRoot) {
    throw configError("CONFIG_PATH_OUTSIDE_ROOT", `${label} resolves outside the repository root (symbolic link or junction escape).`);
  }
  const canonicalRel = toPosixRelative(root.realRoot, canonical);
  for (const protectedPath of protectedPaths) {
    if (pathsOverlap(canonicalRel, protectedPath)) {
      throw configError("CONFIG_PATH_INVALID", `${label} resolves into a protected location.`);
    }
  }
  return { relPath, canonical, canonicalRel };
}

module.exports = {
  MAX_RELATIVE_PATH_LENGTH,
  isSafeRelativePath,
  pathsOverlap,
  toPosixRelative,
  assertCanonicallyContained,
};
