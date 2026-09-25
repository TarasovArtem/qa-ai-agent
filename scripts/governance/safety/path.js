/**
 * GOV-AUTO-1 Wave 0 -- repository path safety (design section 24).
 *
 * `repositoryRoot` is the sole filesystem authority: every later repository file
 * operation must resolve its path through this module. Repository-relative input
 * is checked lexically (no absolute, drive-letter, UNC, `..`, `.`, empty, control,
 * ADS-style or trailing-dot/space segments, so no Windows normalization can turn
 * an innocent-looking segment into `..`) and containment is decided with
 * path.relative, never a string prefix (so `/repo` cannot be confused with
 * `/repo-evil`). Symlinks are handled fail-closed: every component below the root
 * is inspected with lstat and any symlink/junction (dangling or not) is refused,
 * and the deepest existing ancestor is additionally resolved with realpath and
 * must remain inside the real root. A component that does not exist yet (a future
 * output path) is allowed. This is a point-in-time check: a concurrent filesystem
 * writer can still race any later use of the path, so callers that read files
 * must harden the open itself (see io/manifest-loader.js).
 */

"use strict";

const nodePath = require("node:path");
const nodeFs = require("node:fs");
const { REASON, GovernanceSafetyError } = require("./../kernel/contracts");

const MAX_PATH_LENGTH = 4096;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE_LETTER = /^[A-Za-z]:/;
const FORBIDDEN_SEGMENT_CHARS = /[<>:"|?*]/;

function unsafe(detail) {
  return new GovernanceSafetyError(REASON.UNSAFE_PATH, detail);
}

/** True when `target` equals `root` or is inside it (relative-path decision). */
function isWithin(root, target, pathImpl = nodePath) {
  const rel = pathImpl.relative(root, target);
  if (rel === "") return true;
  if (rel === ".." || rel.startsWith(`..${pathImpl.sep}`)) return false;
  return !pathImpl.isAbsolute(rel);
}

/**
 * Pure lexical resolution of a repository-relative path under `root` using the
 * given path implementation (path.posix / path.win32 for cross-platform tests).
 * Returns { absolute, relative } or throws GovernanceSafetyError(UNSAFE_PATH).
 */
function lexicalResolveWithin(root, relativePath, pathImpl = nodePath) {
  if (typeof root !== "string" || root.length === 0 || CONTROL.test(root) || !pathImpl.isAbsolute(root)) {
    throw unsafe("repositoryRoot must be an absolute path");
  }
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.length > MAX_PATH_LENGTH) {
    throw unsafe("path must be a non-empty bounded string");
  }
  if (CONTROL.test(relativePath)) throw unsafe("path contains control characters");
  if (
    nodePath.posix.isAbsolute(relativePath) || nodePath.win32.isAbsolute(relativePath) ||
    DRIVE_LETTER.test(relativePath) || relativePath.startsWith("\\") || relativePath.startsWith("//")
  ) {
    throw unsafe("absolute, drive-letter or UNC paths are not allowed");
  }
  const segments = relativePath.replace(/\\/g, "/").split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") throw unsafe("empty, current or parent path segment");
    if (FORBIDDEN_SEGMENT_CHARS.test(segment)) throw unsafe("segment contains a forbidden character");
    if (segment.endsWith(".") || segment.endsWith(" ")) throw unsafe("segment ends with a dot or space");
  }
  const absolute = pathImpl.resolve(root, ...segments);
  if (absolute === pathImpl.resolve(root) || !isWithin(root, absolute, pathImpl)) throw unsafe("path escapes repositoryRoot");
  return Object.freeze({ absolute, relative: segments.join("/") });
}

/**
 * Resolve a repository-relative path on the real filesystem, fail-closed. The
 * deepest existing ancestor (following symlinks) must stay inside the real root.
 */
function resolveWithinRoot(repositoryRoot, relativePath, options = {}) {
  const fs = options.fs || nodeFs;
  const lexical = lexicalResolveWithin(repositoryRoot, relativePath, nodePath);
  let realRoot;
  try {
    realRoot = fs.realpathSync(repositoryRoot);
  } catch {
    throw unsafe("repositoryRoot cannot be resolved");
  }
  // Walk the components below the root with lstat (which never follows a link). A
  // symlink or junction component or leaf, dangling or not, is refused outright:
  // it is never treated as a nonexistent normal path. The first missing component
  // ends the walk (a future output path); everything above it was inspected.
  let probe = repositoryRoot;
  let parentIsDirectory = true;
  for (const segment of lexical.relative.split("/")) {
    const next = nodePath.join(probe, segment);
    let stat;
    try {
      stat = fs.lstatSync(next);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        if (!parentIsDirectory) throw unsafe("path continues below a non-directory");
        break;
      }
      throw unsafe("path component cannot be inspected");
    }
    if (stat.isSymbolicLink()) throw unsafe("path contains a symlink component");
    parentIsDirectory = stat.isDirectory();
    probe = next;
  }
  let realProbe;
  try {
    realProbe = fs.realpathSync(probe);
  } catch {
    throw unsafe("path cannot be resolved");
  }
  if (!isWithin(realRoot, realProbe, nodePath)) throw unsafe("path resolves outside repositoryRoot through a symlink");
  return lexical;
}

module.exports = { lexicalResolveWithin, resolveWithinRoot, isWithin };
