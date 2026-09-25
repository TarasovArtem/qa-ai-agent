/**
 * GOV-AUTO-1 Wave 1 -- canonical repository-relative path identity.
 *
 * Git path identity is byte-exact and case-sensitive (design section 14): there
 * is no case folding and no Unicode normalization anywhere, so normalization can
 * never create an alias between two distinct paths. A path is accepted here only
 * in its canonical form; an unsafe form is REJECTED, never repaired.
 */

"use strict";

const MAX_REPO_PATH_LENGTH = 4096;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE_LETTER = /^[A-Za-z]:/;

/**
 * Validate a canonical repository-relative path: `/`-separated, no leading `./`
 * or `/`, no empty / `.` / `..` segment, no drive letter or UNC form, no
 * backslash (it would be a Windows separator alias), no control character.
 * Returns { ok: true } or { ok: false, problem } with a fixed problem label.
 */
function validateRepoRelativePath(path) {
  if (typeof path !== "string" || path.length === 0) return { ok: false, problem: "empty" };
  if (path.length > MAX_REPO_PATH_LENGTH) return { ok: false, problem: "too long" };
  if (CONTROL.test(path)) return { ok: false, problem: "control character" };
  if (path.includes("\\")) return { ok: false, problem: "backslash" };
  if (path.startsWith("/") || DRIVE_LETTER.test(path)) return { ok: false, problem: "absolute" };
  for (const segment of path.split("/")) {
    if (segment === "") return { ok: false, problem: "empty segment" };
    if (segment === ".") return { ok: false, problem: "dot segment" };
    if (segment === "..") return { ok: false, problem: "parent segment" };
  }
  return { ok: true };
}

/** Bytewise (UTF-8) ordering: locale independent, unlike default string sort. */
function compareBytewise(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

module.exports = { validateRepoRelativePath, compareBytewise, MAX_REPO_PATH_LENGTH };
