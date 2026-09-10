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
 *
 * Roadmap FPI-2: this module owns NO repository root of its own.
 * normalizeSpecPath(), resolveSafeSpecPath(), and
 * resolveSafeLocalAttachmentPath() are root-DEPENDENT (they anchor a
 * lexical/canonical containment decision to some repository boundary) and
 * therefore each now take an explicit `root: { lexicalRoot, realRoot }`
 * argument (see scripts/ai/repository-root.js) instead of deriving it
 * from this file's own `__dirname`. classifyPathString()/PATH_KIND/
 * isCanonicalPathInsideRoot() are root-INDEPENDENT (they already took
 * their comparison root as an explicit parameter, or take none at all)
 * and are unchanged.
 *
 * Roadmap FPI-2 Corrective C1 (FPI2-R-1/R-2/R-3, independent adversarial
 * review of PR #123): a symlinked `repositoryRoot` has TWO legitimate
 * namespaces for the SAME trusted repository - the caller-visible
 * `lexicalRoot` and its symlink-resolved `realRoot` (see
 * scripts/ai/repository-root.js). Every containment decision in this
 * file now checks BOTH namespaces via relativeToRepositoryNamespace(),
 * never a bare `candidate.startsWith(root)` string-prefix check (which
 * both mislabels a same-prefix sibling as repository-local, R-1, and
 * false-rejects a legitimate canonical-absolute path under a symlinked
 * root, R-3) and never only one of the two namespaces. This module also
 * now exports resolveRepositoryLocalPath(), the shared primitive
 * scripts/ai/adapters/*.js use to validate a caller-supplied directory/
 * file override (Cypress's reportsDir/screenshotsDir, Playwright's
 * reportFile) resolves inside this SAME trusted repository before it is
 * ever used for a filesystem read - an override is a location hint
 * inside the already-trusted repositoryRoot, never a second, independent
 * filesystem authority (R-2).
 */

"use strict";

const fs = require("fs");
const path = require("path");

function resolveRealPathSafe(absPath) {
  try {
    return fs.realpathSync(absPath);
  } catch {
    return null;
  }
}

// Roadmap FPI-2 Corrective C1 (FPI2-R-1/R-3): segment-aware containment
// against BOTH legitimate namespaces of the same validated repository -
// never a bare string-prefix check (a same-prefix sibling such as
// "<lexicalRoot>-evil" must never be accepted merely because its string
// form starts with lexicalRoot's own text), and never only one namespace
// (a symlinked repositoryRoot's canonical form must be accepted exactly
// like its lexical form, and vice versa). Returns the repo-relative form
// (forward-slash, never absolute) when `absCandidate` is contained by at
// least one namespace; null otherwise (including when absCandidate IS
// exactly one of the namespace roots itself - unchanged from this
// function's pre-C1 contract, since a spec/attachment path is never
// legitimately the repository root itself).
function relativeToRepositoryNamespace(absCandidate, root) {
  if (isCanonicalPathInsideRoot({ root: root.lexicalRoot, candidate: absCandidate })) {
    return path.relative(root.lexicalRoot, absCandidate).split(path.sep).join("/") || null;
  }
  if (isCanonicalPathInsideRoot({ root: root.realRoot, candidate: absCandidate })) {
    return path.relative(root.realRoot, absCandidate).split(path.sep).join("/") || null;
  }
  return null;
}

// Roadmap FPI-2 Corrective C1 (FPI2-R-1): a relative rawFile is passed
// through unchanged (this function's original, pre-FPI-2 contract - a
// reporter-relative spec/attachment path is never itself a containment
// decision). An absolute rawFile is now ALWAYS resolved through
// relativeToRepositoryNamespace() - it becomes repository-relative only
// when it is genuinely, segment-wise contained by the repository (either
// namespace); an absolute path that is not - a same-prefix sibling, an
// unrelated absolute path, or a genuine escape - normalizes to null,
// never to a misleadingly relative-looking string and never to the raw
// absolute string itself.
function normalizeSpecPath(rawFile, root) {
  if (!rawFile) return null;

  if (!path.isAbsolute(rawFile)) {
    const p = rawFile.replace(/\\/g, "/");
    return p.replace(/^\/+/, "") || null;
  }

  return relativeToRepositoryNamespace(path.resolve(rawFile), root);
}

// Roadmap FPI-2 Corrective C1 (FPI2-R-2): validates a caller-supplied
// directory/file OVERRIDE (Cypress's reportsDir/screenshotsDir,
// Playwright's reportFile) resolves inside the SAME trusted repository as
// `root` - either namespace, exactly like relativeToRepositoryNamespace()
// above - before the caller ever uses it for a filesystem read. An
// override is a location HINT inside the already-trusted repositoryRoot,
// never a second, independent filesystem authority: a relative override
// is always resolved against root.lexicalRoot (never process.cwd()), and
// an absolute override - wherever it points - must still resolve inside
// the repository or this throws. Canonical re-verification (mirroring
// resolveSafeSpecPath()'s own pattern) closes a symlink escape: an
// override that is lexically inside the repository but whose real target
// is not (e.g. a symlinked reportsDir pointing outside) is also rejected.
// Bounded, deterministic, path-free failures only - the raw caller-
// supplied override string is never reflected into the thrown message.
function resolveRepositoryLocalPath(rawOverride, root, callerLabel) {
  if (typeof rawOverride !== "string" || rawOverride.length === 0) {
    throw new Error(`ADAPTER_PATH_INVALID: ${callerLabel} received a non-string/empty path override.`);
  }
  if (!root || typeof root.lexicalRoot !== "string" || typeof root.realRoot !== "string") {
    throw new Error(`ADAPTER_PATH_INVALID: ${callerLabel} received a path override without a valid repository root to resolve it against.`);
  }

  const lexical = path.isAbsolute(rawOverride) ? path.resolve(rawOverride) : path.resolve(root.lexicalRoot, rawOverride);

  const insideEitherNamespace =
    isCanonicalPathInsideRoot({ root: root.lexicalRoot, candidate: lexical }) ||
    isCanonicalPathInsideRoot({ root: root.realRoot, candidate: lexical });
  if (!insideEitherNamespace) {
    throw new Error(`ADAPTER_PATH_OUTSIDE_REPOSITORY: ${callerLabel} received a path override outside the trusted repository root.`);
  }

  const real = resolveRealPathSafe(lexical);
  if (real && !isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) {
    throw new Error(`ADAPTER_PATH_OUTSIDE_REPOSITORY: ${callerLabel} received a path override whose real location escapes the trusted repository root.`);
  }

  return lexical;
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
//
// Roadmap FPI-2: `root` (`{ lexicalRoot, realRoot }`, see
// scripts/ai/repository-root.js) replaces this file's former module-level
// ROOT/REAL_ROOT constants - every containment decision below is anchored
// to the caller's own explicitly-supplied target repository boundary.
function resolveSafeSpecPath(rawSpecPath, root) {
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
    //
    // Roadmap FPI-2 Corrective C1 (FPI2-R-3): a symlinked repositoryRoot
    // has TWO legitimate namespaces for the SAME trusted repository -
    // root.lexicalRoot (the caller-visible, possibly-a-symlink path) and
    // root.realRoot (its symlink-resolved canonical form). A reporter-
    // supplied absolute path expressed via EITHER namespace must be
    // accepted consistently here - checking only root.lexicalRoot
    // previously false-rejected a legitimate canonical-absolute path
    // whenever repositoryRoot itself was a symlink.
    const lexical = path.resolve(rawSpecPath);
    const lexicallyInLexicalNamespace = isCanonicalPathInsideRoot({ root: root.lexicalRoot, candidate: lexical });
    const lexicallyInRealNamespace = isCanonicalPathInsideRoot({ root: root.realRoot, candidate: lexical });
    if (!lexicallyInLexicalNamespace && !lexicallyInRealNamespace) {
      return { value: null, rejected: true };
    }

    // Canonical re-verification closes a symlink escape (Phase 8: "if
    // symlinks are involved, canonical target must remain inside
    // repository") - but a spec path is evidence metadata, not a
    // file-read authorization (#21C's RelevantFiles policy owns that
    // bar), so unlike attachments, existence is never required: a
    // lexically-contained path that simply doesn't exist on disk (no
    // symlink could possibly have been involved) still normalizes via its
    // proven-safe lexical location - relative to whichever namespace it
    // actually matched.
    const real = resolveRealPathSafe(lexical);
    if (real) {
      if (isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) {
        const rel = path.relative(root.realRoot, real).split(path.sep).join("/");
        return { value: rel || null, rejected: false };
      }
      return { value: null, rejected: true }; // symlink escape
    }

    const relBase = lexicallyInLexicalNamespace ? root.lexicalRoot : root.realRoot;
    const rel = path.relative(relBase, lexical).split(path.sep).join("/");
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
//
// Roadmap FPI-2: `root` replaces this file's former module-level ROOT/
// REAL_ROOT constants - see resolveSafeSpecPath() above for the same
// change and rationale.
function resolveSafeLocalAttachmentPath(rawPath, root) {
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

  const candidateAbs = isAbsoluteKind ? rawPath : path.join(root.lexicalRoot, rawPath);
  const real = resolveRealPathSafe(candidateAbs);
  if (!real) return { value: null, rejected: false }; // does not exist / broken symlink

  if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) {
    return { value: null, rejected: true }; // outside repository, including via symlink
  }

  let stat;
  try {
    stat = fs.statSync(real);
  } catch {
    return { value: null, rejected: false };
  }
  if (!stat.isFile()) return { value: null, rejected: true };

  const rel = path.relative(root.realRoot, real).split(path.sep).join("/");
  return { value: rel || null, rejected: false };
}

module.exports = {
  normalizeSpecPath,
  PATH_KIND,
  classifyPathString,
  isCanonicalPathInsideRoot,
  resolveSafeSpecPath,
  resolveSafeLocalAttachmentPath,
  resolveRepositoryLocalPath,
};
