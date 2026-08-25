/**
 * Roadmap #19.6B - tiny, dependency-free, framework-neutral path utility.
 *
 * normalizeSpecPath() is needed on both sides of the collector/adapter
 * boundary introduced by Roadmap #19.6B: collect-context.js's own
 * generic file-safety code (isPathAllowed(), buildRelevantFiles()) and
 * cypress-adapter.js's Mochawesome/screenshot parsing (extractFailedTests(),
 * summarizeTestResults(), resolveScreenshotPath()) all call it. Neither
 * file may require the other (collect-context.js requires
 * adapters/cypress-adapter.js; the reverse would be circular), so this one
 * generic primitive - unchanged from its pre-#19.6B implementation - lives
 * here instead, dependency-free and with no Cypress-specific knowledge.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

// Roadmap #21D: the real, symlink-resolved location of ROOT itself,
// computed once so every canonical containment check below is anchored to
// the same value regardless of whether the checkout path passes through a
// symlink - the same convention collect-context.js's own REAL_ROOT already
// uses for Roadmap #21C, kept as an independent constant here rather than
// imported, so this file stays dependency-free of collect-context.js (see
// the module docstring: neither file may require the other).
const REAL_ROOT = fs.realpathSync(ROOT);

function normalizeSpecPath(rawFile) {
  if (!rawFile) return null;
  let p = rawFile.replace(/\\/g, "/");
  if (p.startsWith(ROOT.replace(/\\/g, "/"))) {
    p = p.slice(ROOT.replace(/\\/g, "/").length);
  }
  p = p.replace(/^\/+/, "");
  return p || null;
}

// Roadmap #21D (R2/R3): a small, dependency-free, framework-neutral
// classification of a reporter-provided path STRING - never a
// file-read-authorization mechanism (that remains #21C's RelevantFiles
// policy, untouched here). Deliberately does not rely on path.isAbsolute()
// alone, which is host-platform dependent (a Windows drive path or UNC
// path is not "absolute" per path.posix, and a POSIX path is not
// "absolute" per path.win32) - a reporter-derived string must be
// recognized correctly regardless of which OS produced it or which OS is
// currently running.
const PATH_KIND = Object.freeze({
  SAFE_RELATIVE: "SAFE_RELATIVE",
  HOST_ABSOLUTE: "HOST_ABSOLUTE",
  POSIX_ABSOLUTE: "POSIX_ABSOLUTE",
  WINDOWS_DRIVE_ABSOLUTE: "WINDOWS_DRIVE_ABSOLUTE",
  WINDOWS_UNC: "WINDOWS_UNC",
  URL_LIKE: "URL_LIKE",
  TRAVERSAL_RELATIVE: "TRAVERSAL_RELATIVE",
  INVALID: "INVALID",
});

// Requires a real (2+ character) scheme followed by "://" - a bare
// Windows drive letter ("C:\...", "C:/...") never has a second scheme
// character before the colon, so it can never satisfy this pattern merely
// for containing a colon.
const URL_LIKE_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]+:\/\//;
// D21D-2 (pre-#21G hardening): URL_LIKE_PATTERN alone requires a full
// "scheme://" - it does not catch a malformed/degenerate file-URI-like
// reporter value carrying only one or zero slashes after the colon (e.g.
// "file:C:\foo", "file:/tmp/foo"), which used to fall all the way through
// to SAFE_RELATIVE (neither a Windows-drive nor a POSIX-absolute pattern
// matches "file:..." either). Deliberately a narrow, case-insensitive
// literal-scheme check rather than a general URI-scheme regex: a generic
// `^[a-z]+:` pattern would misclassify a genuine Windows drive path
// ("C:\foo") as scheme "C", which must keep resolving as
// WINDOWS_DRIVE_ABSOLUTE. "file:" is never a legitimate leading path
// segment anywhere in this repository's own relative paths, so this can
// never collide with a real relative reporter path.
const FILE_SCHEME_PATTERN = /^file:/i;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
// "\\server\share..." or "//server/share..." - exactly two leading
// separators followed by a non-separator character. A plain POSIX root
// ("/etc/passwd") has only one leading separator and never matches this.
const WINDOWS_UNC_PATTERN = /^(\\\\|\/\/)[^\\/]/;

function classifyPathString(raw) {
  if (typeof raw !== "string" || raw.length === 0) return PATH_KIND.INVALID;

  if (URL_LIKE_PATTERN.test(raw)) return PATH_KIND.URL_LIKE;
  if (FILE_SCHEME_PATTERN.test(raw)) return PATH_KIND.URL_LIKE;
  if (WINDOWS_UNC_PATTERN.test(raw)) return PATH_KIND.WINDOWS_UNC;
  if (WINDOWS_DRIVE_PATTERN.test(raw)) return PATH_KIND.WINDOWS_DRIVE_ABSOLUTE;
  if (raw.startsWith("/")) return PATH_KIND.POSIX_ABSOLUTE;
  if (path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw) || path.isAbsolute(raw)) return PATH_KIND.HOST_ABSOLUTE;

  const normalized = raw.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s.length > 0 && s !== ".");
  let depth = 0;
  for (const seg of segments) {
    if (seg === "..") {
      depth -= 1;
      if (depth < 0) return PATH_KIND.TRAVERSAL_RELATIVE;
    } else {
      depth += 1;
    }
  }
  return PATH_KIND.SAFE_RELATIVE;
}

function resolveRealPathSafe(absPath) {
  try {
    return fs.realpathSync(absPath);
  } catch {
    return null;
  }
}

// Roadmap #21I-A (D21D-3): segment-aware root containment for two already
// lexically/canonically resolved absolute path strings - deliberately NOT
// `candidate.toLowerCase().startsWith(root.toLowerCase())` (or any other
// bare string-prefix check), which cannot distinguish a genuine child from
// a same-prefix sibling ("C:\Repo" vs "C:\Repo-evil") without separately
// re-deriving the separator boundary. `path.win32.relative()`/
// `path.posix.relative()` already own that boundary logic correctly (and,
// on win32, already treat drive-letter and segment casing as equivalent -
// verified empirically, not assumed), so this helper only interprets their
// result: relative() returning a path outside root always either starts
// with ".." (an ancestor step was needed) or is itself absolute (root and
// candidate share no common ancestor at all, e.g. two different Windows
// drive letters - relative() can't express that as a ".."-only path, so it
// falls back to returning candidate's own absolute form).
//
// This fixes D21D-3 (a legitimate Windows repo-local path, canonicalized
// with different case than REAL_ROOT's own casing - Node's fs.realpathSync
// does NOT normalize case on Windows, confirmed empirically - was
// previously false-rejected by the old bare case-sensitive `startsWith`
// check) without weakening containment: a same-prefix sibling, a
// different drive, or a traversal-derived path are all still correctly
// classified as outside, on both platforms.
//
// `platform` defaults to the real running host (production always wants
// actual host semantics: case-insensitive segment matching on real
// Windows, case-sensitive on real POSIX) but can be overridden so this
// pure function's Windows-specific behavior is independently, genuinely
// testable on a POSIX CI host - never gated behind `process.platform ===
// "win32"` in the tests themselves.
function isCanonicalPathInsideRoot({ root, candidate, platform = process.platform }) {
  if (typeof root !== "string" || typeof candidate !== "string") return false;

  const pathModule = platform === "win32" ? path.win32 : path.posix;
  const rel = pathModule.relative(root, candidate);

  if (rel === "") return true; // candidate === root itself (existing contract: root is inside)
  if (rel === ".." || rel.startsWith(".." + pathModule.sep)) return false;
  if (pathModule.isAbsolute(rel)) return false; // no common ancestor at all (e.g. a different drive)
  return true;
}

function stripLeadingDotSlash(raw) {
  let p = raw.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p || null;
}

// Roadmap #21D (R2): reporter-derived spec paths are evidence metadata,
// not a file-read authorization mechanism - #21C's RelevantFiles policy
// independently gates what content may actually be read. This only
// decides what path STRING is safe to preserve in normalized/model-visible
// evidence. A safe relative path is preserved as normalized text (never
// required to exist - Playwright's reporter path may be relative to a
// testDir this module has no knowledge of, see playwright-adapter.js). An
// absolute path is only ever preserved (converted to repo-relative) when
// it is both absolute per the CURRENT host's own convention and
// canonically inside the repository; a foreign-OS absolute-looking string
// (e.g. a Windows drive path observed while running on POSIX, or vice
// versa) can never resolve against this host's filesystem and is always
// rejected rather than risking misinterpretation. Returns
// { value, rejected }: value is the safe string to use (null when
// unsafe/absent), rejected is true only when a genuinely unsafe value was
// supplied (never merely absent) - callers use this to decide whether a
// bounded, path-free warning is warranted.
function resolveSafeSpecPath(rawSpecPath) {
  const kind = classifyPathString(rawSpecPath);

  if (kind === PATH_KIND.INVALID) return { value: null, rejected: false };

  if (kind === PATH_KIND.SAFE_RELATIVE) {
    return { value: stripLeadingDotSlash(rawSpecPath), rejected: false };
  }

  if (kind === PATH_KIND.WINDOWS_DRIVE_ABSOLUTE || kind === PATH_KIND.POSIX_ABSOLUTE || kind === PATH_KIND.HOST_ABSOLUTE) {
    if (!path.isAbsolute(rawSpecPath)) return { value: null, rejected: true }; // foreign-OS absolute form

    // Lexical containment first (Roadmap #21C's own "lexical must still
    // gate eligibility" convention) - a path lexically outside the
    // repository is rejected immediately, no filesystem access needed.
    const lexical = path.resolve(rawSpecPath);
    if (!isCanonicalPathInsideRoot({ root: ROOT, candidate: lexical })) {
      return { value: null, rejected: true };
    }

    // Canonical re-verification closes a symlink escape (Phase 8: "if
    // symlinks are involved, canonical target must remain inside
    // repository") - but a spec path is evidence metadata, not a
    // file-read authorization (#21C's RelevantFiles policy owns that
    // bar), so unlike attachments, existence is never required: a
    // lexically-contained path that simply doesn't exist on disk (no
    // symlink could possibly have been involved) still normalizes via its
    // proven-safe lexical location.
    const real = resolveRealPathSafe(lexical);
    if (real) {
      if (isCanonicalPathInsideRoot({ root: REAL_ROOT, candidate: real })) {
        const rel = path.relative(REAL_ROOT, real).split(path.sep).join("/");
        return { value: rel || null, rejected: false };
      }
      return { value: null, rejected: true }; // symlink escape
    }

    const rel = path.relative(ROOT, lexical).split(path.sep).join("/");
    return { value: rel || null, rejected: false };
  }

  // WINDOWS_UNC, URL_LIKE, TRAVERSAL_RELATIVE - never preserved raw.
  return { value: null, rejected: true };
}

// Roadmap #21D (R3): the attachment-locality boundary. A reporter-supplied
// attachment path is usable only when it names a real, ordinary,
// canonically-repository-local file - never a URL, UNC path, foreign-OS
// absolute path, traversal-like path, or a symlink whose real target
// escapes the repository. No network fetch, no body decoding, and no
// out-of-root materialization ever happens here or anywhere else in this
// module. A repo-local symlink whose real target is also repo-local is
// deliberately accepted, but the value returned is the TARGET's own
// canonical repo-relative path, never the symlink's lexical path - this
// avoids ever describing an accepted attachment by a path that could
// itself be a redirection layer. Returns { value, rejected } with the same
// contract as resolveSafeSpecPath(): rejected is true only for a
// genuinely-unsafe supplied value (URL/UNC/traversal/foreign-absolute/
// outside-repo), never for a path that simply doesn't exist (that fails
// safely with rejected:false, matching the pre-existing
// "does not exist on disk" warning path).
function resolveSafeLocalAttachmentPath(rawPath) {
  const kind = classifyPathString(rawPath);

  if (kind === PATH_KIND.INVALID) return { value: null, rejected: false };

  if (kind === PATH_KIND.URL_LIKE || kind === PATH_KIND.WINDOWS_UNC || kind === PATH_KIND.TRAVERSAL_RELATIVE) {
    return { value: null, rejected: true };
  }

  const isAbsoluteKind =
    kind === PATH_KIND.WINDOWS_DRIVE_ABSOLUTE || kind === PATH_KIND.POSIX_ABSOLUTE || kind === PATH_KIND.HOST_ABSOLUTE;
  if (isAbsoluteKind && !path.isAbsolute(rawPath)) {
    return { value: null, rejected: true }; // foreign-OS absolute form
  }

  const candidateAbs = isAbsoluteKind ? rawPath : path.join(ROOT, rawPath);
  const real = resolveRealPathSafe(candidateAbs);
  if (!real) return { value: null, rejected: false }; // does not exist / broken symlink

  if (!isCanonicalPathInsideRoot({ root: REAL_ROOT, candidate: real })) {
    return { value: null, rejected: true }; // outside repository, including via symlink
  }

  let stat;
  try {
    stat = fs.statSync(real);
  } catch {
    return { value: null, rejected: false };
  }
  if (!stat.isFile()) return { value: null, rejected: true };

  const rel = path.relative(REAL_ROOT, real).split(path.sep).join("/");
  return { value: rel || null, rejected: false };
}

module.exports = {
  normalizeSpecPath,
  PATH_KIND,
  classifyPathString,
  isCanonicalPathInsideRoot,
  resolveSafeSpecPath,
  resolveSafeLocalAttachmentPath,
};
