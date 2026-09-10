"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeSpecPath,
  PATH_KIND,
  classifyPathString,
  isCanonicalPathInsideRoot,
  resolveSafeSpecPath,
  resolveSafeLocalAttachmentPath,
  resolveRepositoryLocalPath,
} = require("./context-utils");

const ROOT = path.resolve(__dirname, "..", "..");

// Roadmap FPI-2: normalizeSpecPath()/resolveSafeSpecPath()/
// resolveSafeLocalAttachmentPath() no longer derive their own root from
// this module's __dirname - every call site below now supplies an
// explicit `root: { lexicalRoot, realRoot }` boundary (see
// scripts/ai/repository-root.js), matching production's own
// collect-context.js/adapters wiring. This repository's own checkout is
// used as the fixture target repository throughout this file - a
// separate, physically-external fixture root is exercised instead in
// scripts/targets/targomo/*-repository-root proofs and the dedicated
// FPI-2 root-portability tests in collect-context.test.js.
const TEST_ROOT = Object.freeze({ lexicalRoot: ROOT, realRoot: fs.realpathSync(ROOT) });

test("normalizeSpecPath: strips the repo root and leading slashes, normalizes backslashes", () => {
  assert.equal(
    normalizeSpecPath(path.join(ROOT, "cypress", "e2e", "tests", "x.cy.js"), TEST_ROOT),
    "cypress/e2e/tests/x.cy.js"
  );
  // A genuinely relative path with backslash separators (never a leading
  // separator - that is host-absolute on Windows, see the dedicated
  // FPI2-R-1 same-prefix-sibling/out-of-root tests below for that case).
  assert.equal(normalizeSpecPath("cypress\\e2e\\tests\\x.cy.js", TEST_ROOT), "cypress/e2e/tests/x.cy.js");
  assert.equal(normalizeSpecPath(null, TEST_ROOT), null);
  assert.equal(normalizeSpecPath("", TEST_ROOT), null);
});

// --- normalizeSpecPath: FPI-2 Corrective C1 (FPI2-R-1) regression tests ---
//
// normalizeSpecPath() must never treat a same-prefix sibling, or any
// other absolute path not genuinely (segment-wise) contained by the
// repository, as though it were repository-relative - see
// scripts/ai/context-utils.js's own relativeToRepositoryNamespace().

test("normalizeSpecPath (FPI2-R-1): a same-prefix sibling absolute path is rejected, never mislabeled as repository-relative", () => {
  const root = { lexicalRoot: path.join(os.tmpdir(), "fpi2-c1-project"), realRoot: path.join(os.tmpdir(), "fpi2-c1-project") };
  assert.equal(normalizeSpecPath(path.join(os.tmpdir(), "fpi2-c1-project-evil", "spec.cy.js"), root), null);
  assert.equal(normalizeSpecPath(path.join(os.tmpdir(), "fpi2-c1-project2", "spec.cy.js"), root), null);
});

test("normalizeSpecPath (FPI2-R-1): an absolute path entirely unrelated to the repository is rejected", () => {
  const root = { lexicalRoot: path.join(os.tmpdir(), "fpi2-c1-project"), realRoot: path.join(os.tmpdir(), "fpi2-c1-project") };
  assert.equal(normalizeSpecPath(path.join(os.tmpdir(), "fpi2-c1-somewhere-else", "spec.cy.js"), root), null);
});

test("normalizeSpecPath (FPI2-R-1): a genuine child of the repository still normalizes correctly", () => {
  const root = { lexicalRoot: path.join(os.tmpdir(), "fpi2-c1-project"), realRoot: path.join(os.tmpdir(), "fpi2-c1-project") };
  assert.equal(normalizeSpecPath(path.join(os.tmpdir(), "fpi2-c1-project", "cypress", "e2e", "x.cy.js"), root), "cypress/e2e/x.cy.js");
});

// --- classifyPathString (Roadmap #21D, R2/R3) -------------------------------
// Pure string classification, deliberately host-independent (see the
// function's own doc comment in context-utils.js) - these assertions hold
// identically regardless of which OS actually runs this test file.

test("classifyPathString: a plain relative path is SAFE_RELATIVE", () => {
  assert.equal(classifyPathString("tests/foo.spec.js"), PATH_KIND.SAFE_RELATIVE);
  assert.equal(classifyPathString("proof.spec.js"), PATH_KIND.SAFE_RELATIVE);
  assert.equal(classifyPathString("playwright/tests/foo.spec.js"), PATH_KIND.SAFE_RELATIVE);
  assert.equal(classifyPathString("./proof.spec.js"), PATH_KIND.SAFE_RELATIVE);
});

test("classifyPathString: a POSIX absolute path is POSIX_ABSOLUTE", () => {
  assert.equal(classifyPathString("/tmp/foo.spec.js"), PATH_KIND.POSIX_ABSOLUTE);
  assert.equal(classifyPathString("/etc/passwd"), PATH_KIND.POSIX_ABSOLUTE);
});

test("classifyPathString: a Windows drive-letter path is WINDOWS_DRIVE_ABSOLUTE, never misclassified as URL_LIKE merely for containing a colon", () => {
  assert.equal(classifyPathString("C:\\Users\\someone\\foo.spec.js"), PATH_KIND.WINDOWS_DRIVE_ABSOLUTE);
  assert.equal(classifyPathString("C:/Users/someone/foo.spec.js"), PATH_KIND.WINDOWS_DRIVE_ABSOLUTE);
  assert.equal(classifyPathString("D:\\data\\shot.png"), PATH_KIND.WINDOWS_DRIVE_ABSOLUTE);
});

test("classifyPathString: a UNC path is WINDOWS_UNC regardless of slash direction", () => {
  assert.equal(classifyPathString("\\\\server\\share\\foo.spec.js"), PATH_KIND.WINDOWS_UNC);
  assert.equal(classifyPathString("//server/share/foo.spec.js"), PATH_KIND.WINDOWS_UNC);
});

test("classifyPathString: a plain POSIX root is never mistaken for UNC (single leading separator only)", () => {
  assert.equal(classifyPathString("/etc/passwd"), PATH_KIND.POSIX_ABSOLUTE);
});

test("classifyPathString: URL-like values are URL_LIKE, never treated as filesystem paths", () => {
  assert.equal(classifyPathString("https://example.invalid/file.png"), PATH_KIND.URL_LIKE);
  assert.equal(classifyPathString("http://example.invalid/file.png"), PATH_KIND.URL_LIKE);
  assert.equal(classifyPathString("file:///tmp/file.png"), PATH_KIND.URL_LIKE);
});

test("classifyPathString: upward-escaping traversal is TRAVERSAL_RELATIVE", () => {
  assert.equal(classifyPathString("../foo.js"), PATH_KIND.TRAVERSAL_RELATIVE);
  assert.equal(classifyPathString("../../secret.js"), PATH_KIND.TRAVERSAL_RELATIVE);
  assert.equal(classifyPathString("tests/../../../foo.js"), PATH_KIND.TRAVERSAL_RELATIVE);
});

test("classifyPathString: a relative path that dips via '..' but nets non-negative never escapes upward, and is SAFE_RELATIVE", () => {
  assert.equal(classifyPathString("tests/sub/../foo.spec.js"), PATH_KIND.SAFE_RELATIVE);
});

test("classifyPathString: non-string/empty input is INVALID", () => {
  assert.equal(classifyPathString(null), PATH_KIND.INVALID);
  assert.equal(classifyPathString(undefined), PATH_KIND.INVALID);
  assert.equal(classifyPathString(""), PATH_KIND.INVALID);
  assert.equal(classifyPathString(42), PATH_KIND.INVALID);
});

// --- D21D-2 (pre-#21G hardening): malformed file:-URI-like forms ------------
//
// URL_LIKE_PATTERN alone requires a full "scheme://" - a degenerate
// file-URI-like reporter value carrying only one or zero slashes after the
// colon used to fall all the way through to SAFE_RELATIVE (it matches
// neither the Windows-drive nor the POSIX-absolute pattern either), which
// would let it flow onward through resolveSafeSpecPath()/
// resolveSafeLocalAttachmentPath() as if it were an ordinary safe relative
// path. Every one of these forms must now classify as URL_LIKE and never
// SAFE_RELATIVE.

test("classifyPathString: malformed file:-URI-like forms (one or zero slashes) are URL_LIKE, never SAFE_RELATIVE", () => {
  assert.equal(classifyPathString("file:C:\\foo"), PATH_KIND.URL_LIKE);
  assert.equal(classifyPathString("file:/tmp/foo"), PATH_KIND.URL_LIKE);
  assert.equal(classifyPathString("FILE:C:\\foo"), PATH_KIND.URL_LIKE);
  assert.equal(classifyPathString("FILE:/tmp/foo"), PATH_KIND.URL_LIKE);
});

test("classifyPathString: well-formed file:// URI forms remain URL_LIKE regardless of scheme casing", () => {
  assert.equal(classifyPathString("file:///tmp/foo"), PATH_KIND.URL_LIKE);
  assert.equal(classifyPathString("FiLe:///tmp/foo"), PATH_KIND.URL_LIKE);
});

test("classifyPathString: legitimate Windows drive paths are unaffected by the file:-scheme hardening", () => {
  assert.equal(classifyPathString("C:\\foo"), PATH_KIND.WINDOWS_DRIVE_ABSOLUTE);
  assert.equal(classifyPathString("C:/foo"), PATH_KIND.WINDOWS_DRIVE_ABSOLUTE);
  assert.equal(classifyPathString("D:\\repo\\file.js"), PATH_KIND.WINDOWS_DRIVE_ABSOLUTE);
});

test("classifyPathString: normal relative reporter paths are unaffected by the file:-scheme hardening", () => {
  assert.equal(classifyPathString("tests/smoke.spec.js"), PATH_KIND.SAFE_RELATIVE);
  assert.equal(classifyPathString("playwright/tests/smoke.spec.js"), PATH_KIND.SAFE_RELATIVE);
  assert.equal(classifyPathString("reports/playwright/test-results/foo.png"), PATH_KIND.SAFE_RELATIVE);
});

test("D21D-2 resolveSafeSpecPath: malformed file:-URI-like values are rejected, never preserved as a spec path", () => {
  for (const raw of ["file:C:\\foo", "file:/tmp/foo", "FILE:C:\\foo", "FILE:/tmp/foo"]) {
    const result = resolveSafeSpecPath(raw, TEST_ROOT);
    assert.equal(result.value, null, `expected null value for ${raw}`);
    assert.equal(result.rejected, true, `expected rejected:true for ${raw}`);
  }
});

test("D21D-2 resolveSafeLocalAttachmentPath: malformed file:-URI-like values are rejected, never resolved against the filesystem", () => {
  for (const raw of ["file:C:\\foo", "file:/tmp/foo", "FILE:C:\\foo", "FILE:/tmp/foo"]) {
    const result = resolveSafeLocalAttachmentPath(raw, TEST_ROOT);
    assert.equal(result.value, null, `expected null value for ${raw}`);
    assert.equal(result.rejected, true, `expected rejected:true for ${raw}`);
  }
});

// --- isCanonicalPathInsideRoot (Roadmap #21I-A, D21D-3) ---------------------
//
// Deliberately host-independent: `platform` is always passed explicitly so
// every assertion below holds identically regardless of which OS actually
// runs this test file (this repository's CI runs on ubuntu-latest) - never
// `if (process.platform === "win32")`-gated, per the D21D-3 closure
// requirement that Windows path semantics must be genuinely exercised on a
// non-Windows CI host, not silently skipped there.
//
// D21D-3 background: the pre-#21I-A code compared canonical paths with a
// bare, case-sensitive `String.prototype.startsWith`. Node's
// `fs.realpathSync()` does NOT normalize case on Windows (confirmed
// empirically against a real Windows host during this fix's development -
// it preserves whatever case was supplied, it does not correct it to the
// actual on-disk casing), so a legitimate repo-local Windows path
// canonicalized with different case than REAL_ROOT's own casing was
// false-rejected. This helper fixes that by delegating the containment
// decision to `path.win32.relative()`/`path.posix.relative()` (which
// already treat Windows drive-letter/segment casing as equivalent,
// verified empirically, not assumed) and interpreting the result via the
// well-known safe idiom: outside iff the relative result starts with ".."
// or is itself absolute (no common ancestor, e.g. a different drive) -
// never a bare prefix/lowercase string comparison, which cannot
// distinguish a genuine child from a same-prefix sibling without
// separately re-deriving the separator boundary.

test("W1 isCanonicalPathInsideRoot: Windows same-case child is inside", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "C:\\Repo\\file.js", platform: "win32" }), true);
});

test("W2 isCanonicalPathInsideRoot: Windows differently-cased child is inside (the actual D21D-3 false-rejection case, now fixed)", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "c:\\repo\\file.js", platform: "win32" }), true);
});

test("W3 isCanonicalPathInsideRoot: Windows deeply-nested, fully case-mismatched child is inside", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "C:\\REPO\\Sub\\File.js", platform: "win32" }), true);
});

test("W4 isCanonicalPathInsideRoot: a same-prefix sibling directory ('Repo-evil') is outside, even case-insensitively", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "c:\\repo-evil\\file.js", platform: "win32" }), false);
});

test("W5 isCanonicalPathInsideRoot: a different drive letter is outside - no drive-letter fallback", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "D:\\Repo\\file.js", platform: "win32" }), false);
});

test("W6 isCanonicalPathInsideRoot: a longer sibling name ('Repository') is outside", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "C:\\Repository\\file.js", platform: "win32" }), false);
});

test("W7 isCanonicalPathInsideRoot: a numerically-suffixed sibling ('Repo2') is outside", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "C:\\Repo2\\file.js", platform: "win32" }), false);
});

test("W8 isCanonicalPathInsideRoot: a traversal-derived candidate (pre-resolved to its lexical target) that escapes root is outside", () => {
  const escaped = path.win32.resolve("C:\\Repo\\..\\Outside\\file.js");
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: escaped, platform: "win32" }), false);
});

test("isCanonicalPathInsideRoot: the root itself (same case or different case) is inside, matching the pre-existing 'root counts as inside' contract", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "C:\\Repo", platform: "win32" }), true);
  assert.equal(isCanonicalPathInsideRoot({ root: "C:\\Repo", candidate: "c:\\repo", platform: "win32" }), true);
});

// --- POSIX matrix (host-independent, explicit platform) ---------------------

test("P1 isCanonicalPathInsideRoot: POSIX child is inside", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "/root/repo", candidate: "/root/repo/file", platform: "linux" }), true);
});

test("P2 isCanonicalPathInsideRoot: a same-prefix POSIX sibling ('repo-evil') is outside", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "/root/repo", candidate: "/root/repo-evil/file", platform: "linux" }), false);
});

test("P3 isCanonicalPathInsideRoot: POSIX remains case-sensitive - a case-differing path is outside", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "/root/repo", candidate: "/root/Repo/file", platform: "linux" }), false);
});

test("P4 isCanonicalPathInsideRoot: an unrelated POSIX path is outside", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: "/root/repo", candidate: "/etc/passwd", platform: "linux" }), false);
});

test("P5 isCanonicalPathInsideRoot: a traversal-derived POSIX candidate (pre-resolved) that escapes root is outside", () => {
  const escaped = path.posix.resolve("/root/repo/../outside/file");
  assert.equal(isCanonicalPathInsideRoot({ root: "/root/repo", candidate: escaped, platform: "linux" }), false);
});

test("isCanonicalPathInsideRoot: non-string root/candidate fails closed to false, never thrown", () => {
  assert.equal(isCanonicalPathInsideRoot({ root: null, candidate: "/root/repo/file", platform: "linux" }), false);
  assert.equal(isCanonicalPathInsideRoot({ root: "/root/repo", candidate: undefined, platform: "linux" }), false);
  assert.equal(isCanonicalPathInsideRoot({ root: 42, candidate: "/root/repo/file", platform: "linux" }), false);
});

test("isCanonicalPathInsideRoot: defaults platform to the real running host when omitted", () => {
  // Sanity only - proves the parameter is genuinely optional and produces a
  // boolean either way; the actual cross-platform semantics are already
  // fully proven above via explicit platform injection, never relying on
  // this default in an assertion of WHICH platform's rules applied.
  const result = isCanonicalPathInsideRoot({ root: ROOT, candidate: ROOT });
  assert.equal(result, true);
});

// --- resolveSafeSpecPath (Roadmap #21D, R2; Roadmap FPI-2, explicit root) ---

test("PATH_1 resolveSafeSpecPath: a safe relative spec path is preserved, normalized to forward slashes", () => {
  assert.deepEqual(resolveSafeSpecPath("tests/foo.spec.js", TEST_ROOT), { value: "tests/foo.spec.js", rejected: false });
  assert.deepEqual(resolveSafeSpecPath("playwright\\tests\\foo.spec.js", TEST_ROOT), { value: "playwright/tests/foo.spec.js", rejected: false });
  assert.deepEqual(resolveSafeSpecPath("./proof.spec.js", TEST_ROOT), { value: "proof.spec.js", rejected: false });
});

test("PATH_2 resolveSafeSpecPath: a repo-local absolute spec path (not required to exist) becomes repo-relative, never absolute", (t) => {
  const absoluteUnderRoot = path.join(ROOT, "tests", "path-2-does-not-exist.spec.js");
  const result = resolveSafeSpecPath(absoluteUnderRoot, TEST_ROOT);
  assert.equal(result.rejected, false);
  assert.equal(result.value, "tests/path-2-does-not-exist.spec.js");
  assert.equal(path.isAbsolute(result.value), false);
});

test("PATH_2b resolveSafeSpecPath: a repo-local absolute spec path that genuinely exists resolves via its canonical location", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-path2b-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const specFile = path.join(tmpDir, "real.spec.js");
  fs.writeFileSync(specFile, "");

  const result = resolveSafeSpecPath(specFile, TEST_ROOT);
  assert.equal(result.rejected, false);
  assert.equal(path.isAbsolute(result.value), false);
  assert.equal(path.resolve(ROOT, result.value), fs.realpathSync(specFile));
});

test("PATH_3 resolveSafeSpecPath: an out-of-root absolute spec path is never preserved raw - redacted to null, marked rejected", () => {
  const outsideMarker = "OUTSIDE_PRIVATE_PATH_MARKER_21D";
  const outsidePath = path.join(os.tmpdir(), outsideMarker, "foo.spec.js");
  const result = resolveSafeSpecPath(outsidePath, TEST_ROOT);
  assert.deepEqual(result, { value: null, rejected: true });
});

test("PATH_4 resolveSafeSpecPath: traversal-relative spec paths are rejected, never preserved", () => {
  assert.deepEqual(resolveSafeSpecPath("../foo.spec.js", TEST_ROOT), { value: null, rejected: true });
  assert.deepEqual(resolveSafeSpecPath("tests/../../../foo.spec.js", TEST_ROOT), { value: null, rejected: true });
});

test("PATH_5/PATH_6 resolveSafeSpecPath: cross-platform absolute-looking paths never become an apparently-safe relative value on this host", () => {
  const posixLike = resolveSafeSpecPath("/tmp/foo.spec.js", TEST_ROOT);
  assert.equal(posixLike.value, null);
  assert.equal(posixLike.rejected, true);

  const uncBackslash = resolveSafeSpecPath("\\\\server\\share\\foo.spec.js", TEST_ROOT);
  assert.deepEqual(uncBackslash, { value: null, rejected: true });

  const uncSlash = resolveSafeSpecPath("//server/share/foo.spec.js", TEST_ROOT);
  assert.deepEqual(uncSlash, { value: null, rejected: true });

  const windowsDrive = resolveSafeSpecPath("C:\\Users\\someone\\foo.spec.js", TEST_ROOT);
  // On a genuine Windows host this drive path may lexically resolve under
  // ROOT only if ROOT itself is literally "C:\Users\someone" - in every
  // realistic case (including this repository's own checkout path) it
  // resolves outside ROOT and must be rejected exactly like every other
  // out-of-root absolute case; on a non-Windows host it is always rejected
  // as a foreign-OS absolute form. Either way, it must never leak raw.
  assert.equal(windowsDrive.value === null || path.isAbsolute(windowsDrive.value) === false, true);
  if (windowsDrive.value !== null) {
    assert.equal(windowsDrive.value.includes(":"), false, "an accepted value must never retain a drive-letter colon");
  }
});

test("PATH_7 resolveSafeSpecPath: a URL-like spec value is rejected, never dereferenced or treated as a filesystem path", () => {
  assert.deepEqual(resolveSafeSpecPath("https://example.invalid/foo.spec.js", TEST_ROOT), { value: null, rejected: true });
  assert.deepEqual(resolveSafeSpecPath("file:///tmp/foo.spec.js", TEST_ROOT), { value: null, rejected: true });
});

test("resolveSafeSpecPath: absent/empty input is null but NOT marked rejected (nothing unsafe was ever supplied)", () => {
  assert.deepEqual(resolveSafeSpecPath(null, TEST_ROOT), { value: null, rejected: false });
  assert.deepEqual(resolveSafeSpecPath("", TEST_ROOT), { value: null, rejected: false });
});

// --- resolveSafeLocalAttachmentPath (Roadmap #21D, R3; Roadmap FPI-2) -------

test("ATT_1 resolveSafeLocalAttachmentPath: a repo-local existing file is accepted as a repo-relative, never-absolute path", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-att1-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const filePath = path.join(tmpDir, "shot.png");
  fs.writeFileSync(filePath, "");

  const result = resolveSafeLocalAttachmentPath(filePath, TEST_ROOT);
  assert.equal(result.rejected, false);
  assert.equal(path.isAbsolute(result.value), false);
  assert.equal(path.resolve(ROOT, result.value), fs.realpathSync(filePath));
});

test("ATT_2 resolveSafeLocalAttachmentPath: an out-of-root existing file is rejected, never returned", () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-att2-"));
  try {
    const filePath = path.join(outsideDir, "shot.png");
    fs.writeFileSync(filePath, "");
    assert.deepEqual(resolveSafeLocalAttachmentPath(filePath, TEST_ROOT), { value: null, rejected: true });
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("ATT_3 resolveSafeLocalAttachmentPath: a repo-local symlink to an outside file is rejected via canonical (realpath) re-verification", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-att3-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const outsideFile = path.join(outsideDir, "secret.png");
  fs.writeFileSync(outsideFile, "OUTSIDE_PRIVATE_PATH_MARKER_21D");

  const insideDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-att3-inside-"));
  t.after(() => fs.rmSync(insideDir, { recursive: true, force: true }));
  const symlinkPath = path.join(insideDir, "shot.png");

  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideFile, symlinkPath, "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return; // environment cannot create filesystem symlinks - nothing to prove here

  assert.deepEqual(resolveSafeLocalAttachmentPath(symlinkPath, TEST_ROOT), { value: null, rejected: true });
});

test("ATT_4 resolveSafeLocalAttachmentPath: a repo-local symlink to another repo-local file is accepted, returning the TARGET's own canonical repo-relative path", (t) => {
  const insideDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-att4-"));
  t.after(() => fs.rmSync(insideDir, { recursive: true, force: true }));
  const realFile = path.join(insideDir, "real.png");
  fs.writeFileSync(realFile, "");
  const symlinkPath = path.join(insideDir, "link.png");

  let symlinkSupported = true;
  try {
    fs.symlinkSync(realFile, symlinkPath, "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const viaSymlink = resolveSafeLocalAttachmentPath(symlinkPath, TEST_ROOT);
  const viaRealFile = resolveSafeLocalAttachmentPath(realFile, TEST_ROOT);
  assert.equal(viaSymlink.rejected, false);
  assert.ok(viaSymlink.value);
  // The returned value represents the canonical TARGET, not the symlink's
  // own lexical path - proven by it matching what resolving the real file
  // directly produces.
  assert.equal(viaSymlink.value, viaRealFile.value);
});

test("ATT_6 resolveSafeLocalAttachmentPath: a URL-like attachment path is rejected outright, no filesystem access implied", () => {
  assert.deepEqual(resolveSafeLocalAttachmentPath("https://example.invalid/screenshot.png", TEST_ROOT), { value: null, rejected: true });
});

test("ATT_7 resolveSafeLocalAttachmentPath: a nonexistent local-looking path fails safely - null, not rejected (never existed, nothing to redact)", () => {
  const missing = path.join(os.tmpdir(), "context-utils-att7-does-not-exist", "shot.png");
  assert.deepEqual(resolveSafeLocalAttachmentPath(missing, TEST_ROOT), { value: null, rejected: false });
});

test("resolveSafeLocalAttachmentPath: absent/empty input is null but not rejected", () => {
  assert.deepEqual(resolveSafeLocalAttachmentPath(null, TEST_ROOT), { value: null, rejected: false });
  assert.deepEqual(resolveSafeLocalAttachmentPath("", TEST_ROOT), { value: null, rejected: false });
});

// =========================================================================
// D21D-1 (pre-#21G hardening): a dedicated, committed regression locking the
// specific contract that was previously only "safe by implementation/probe"
// - a genuinely relative attachment.path (the shape #21B's own real
// Playwright reporter proof never actually produced, since it always
// emitted absolute paths, but which resolveSafeLocalAttachmentPath() has
// always handled via `path.join(root.lexicalRoot, rawPath)`) is anchored to
// the caller's own explicitly-supplied `root` boundary (Roadmap FPI-2 -
// formerly this module's own module-level ROOT constant), never to
// whatever process.cwd() the caller happens to be running from - proven
// here with a real, genuinely separate child process, not an unsafe
// process.chdir() mutation shared with every other test in this file.
// =========================================================================

const { execFileSync } = require("node:child_process");

test("D21D-1 relative attachment.path resolves anchored to the caller's explicit root, accepted as canonical repo-relative text", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-d21d1-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const absoluteFixture = path.join(tmpDir, "shot.png");
  fs.writeFileSync(absoluteFixture, "");

  const relativeFromRoot = path.relative(ROOT, absoluteFixture).split(path.sep).join("/");
  const result = resolveSafeLocalAttachmentPath(relativeFromRoot, TEST_ROOT);

  assert.equal(result.rejected, false);
  assert.equal(result.value, relativeFromRoot);
  assert.equal(path.isAbsolute(result.value), false);
  assert.equal(path.resolve(ROOT, result.value), fs.realpathSync(absoluteFixture));
});

test("D21D-1 relative attachment.path resolution is independent of the caller's process.cwd() (real child process, not process.chdir())", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-d21d1-cwd-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const absoluteFixture = path.join(tmpDir, "shot.png");
  fs.writeFileSync(absoluteFixture, "");
  const relativeFromRoot = path.relative(ROOT, absoluteFixture).split(path.sep).join("/");

  // Baseline: resolved from this process, whose cwd already happens to be
  // the repo root (the standard `node --test` invocation convention this
  // repository uses throughout).
  const fromRepoRootCwd = resolveSafeLocalAttachmentPath(relativeFromRoot, TEST_ROOT);
  assert.equal(fromRepoRootCwd.rejected, false);
  assert.ok(fromRepoRootCwd.value);

  // A genuinely separate child process, with cwd deliberately set to OS
  // temp (never the repo root, never any repo subdirectory) - proves the
  // resolution is anchored to the explicitly-passed `root` argument
  // (Roadmap FPI-2), never to the invoking process's own cwd.
  const foreignCwd = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-d21d1-foreign-cwd-"));
  t.after(() => fs.rmSync(foreignCwd, { recursive: true, force: true }));
  const probeScript = `
    const { resolveSafeLocalAttachmentPath } = require(${JSON.stringify(path.join(__dirname, "context-utils.js"))});
    const root = ${JSON.stringify(TEST_ROOT)};
    process.stdout.write(JSON.stringify(resolveSafeLocalAttachmentPath(${JSON.stringify(relativeFromRoot)}, root)));
  `;
  const childOutput = execFileSync(process.execPath, ["-e", probeScript], { cwd: foreignCwd, encoding: "utf8" });
  const fromForeignCwd = JSON.parse(childOutput);

  assert.deepEqual(fromForeignCwd, fromRepoRootCwd, "resolution must be byte-identical regardless of the caller's cwd");
  assert.notEqual(process.cwd(), foreignCwd, "sanity: the child's cwd was genuinely different from this process's own cwd");
});

// =========================================================================
// Roadmap FPI-2 Corrective C1 (independent adversarial review of PR #123,
// findings FPI2-R-2/FPI2-R-3) - symlinked-root dual-namespace consistency
// and the shared resolveRepositoryLocalPath() override-containment
// primitive.
// =========================================================================

function makeSymlinkedRootFixture(t) {
  const realTarget = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-c1-real-"));
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-c1-parent-"));
  const linkPath = path.join(parentDir, "link-to-real");
  let symlinkSupported = true;
  try {
    fs.symlinkSync(realTarget, linkPath, "dir");
  } catch {
    symlinkSupported = false;
  }
  t.after(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
    fs.rmSync(realTarget, { recursive: true, force: true });
  });
  if (!symlinkSupported) return null;
  return { root: { lexicalRoot: linkPath, realRoot: fs.realpathSync(realTarget) }, realTarget, linkPath };
}

test("FPI2-R-3: resolveSafeSpecPath accepts a lexical-absolute and a canonical-absolute form of the same file identically under a symlinked repositoryRoot", (t) => {
  const fixture = makeSymlinkedRootFixture(t);
  if (!fixture) return; // environment cannot create filesystem symlinks - nothing to prove here
  const { root, linkPath, realTarget } = fixture;

  const lexicalAbs = path.join(linkPath, "cypress", "e2e", "foo.cy.js");
  const canonicalAbs = path.join(realTarget, "cypress", "e2e", "foo.cy.js");

  const viaLexical = resolveSafeSpecPath(lexicalAbs, root);
  const viaCanonical = resolveSafeSpecPath(canonicalAbs, root);

  assert.deepEqual(viaLexical, { value: "cypress/e2e/foo.cy.js", rejected: false });
  assert.deepEqual(viaCanonical, { value: "cypress/e2e/foo.cy.js", rejected: false });
  assert.deepEqual(viaLexical, viaCanonical, "both legitimate namespaces of the same symlinked root must normalize identically");
});

test("FPI2-R-3: normalizeSpecPath accepts a lexical-absolute and a canonical-absolute form of the same file identically under a symlinked repositoryRoot", (t) => {
  const fixture = makeSymlinkedRootFixture(t);
  if (!fixture) return;
  const { root, linkPath, realTarget } = fixture;

  const lexicalAbs = path.join(linkPath, "cypress", "e2e", "foo.cy.js");
  const canonicalAbs = path.join(realTarget, "cypress", "e2e", "foo.cy.js");

  assert.equal(normalizeSpecPath(lexicalAbs, root), "cypress/e2e/foo.cy.js");
  assert.equal(normalizeSpecPath(canonicalAbs, root), "cypress/e2e/foo.cy.js");
});

test("FPI2-R-3: resolveSafeSpecPath still rejects a genuine escape (outside BOTH namespaces) under a symlinked repositoryRoot", (t) => {
  const fixture = makeSymlinkedRootFixture(t);
  if (!fixture) return;
  const { root } = fixture;
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-c1-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));

  const result = resolveSafeSpecPath(path.join(outsideDir, "evil.cy.js"), root);
  assert.deepEqual(result, { value: null, rejected: true });
});

// --- resolveRepositoryLocalPath (FPI2-R-2) ---------------------------------

test("resolveRepositoryLocalPath: a relative override resolves against root.lexicalRoot, never process.cwd()", (t) => {
  const originalCwd = process.cwd();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-c1-cwd-elsewhere-"));
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
  process.chdir(elsewhere);
  try {
    const resolved = resolveRepositoryLocalPath("custom-reports", TEST_ROOT, "test-caller");
    assert.equal(resolved, path.resolve(ROOT, "custom-reports"));
  } finally {
    process.chdir(originalCwd);
  }
});

test("resolveRepositoryLocalPath: an absolute in-root override is accepted unchanged", () => {
  const resolved = resolveRepositoryLocalPath(path.join(ROOT, "reports", "cypress"), TEST_ROOT, "test-caller");
  assert.equal(resolved, path.join(ROOT, "reports", "cypress"));
});

test("resolveRepositoryLocalPath: an absolute out-of-root override throws ADAPTER_PATH_OUTSIDE_REPOSITORY, never returns", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-c1-r2-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  assert.throws(
    () => resolveRepositoryLocalPath(outsideDir, TEST_ROOT, "test-caller"),
    /ADAPTER_PATH_OUTSIDE_REPOSITORY: test-caller/
  );
});

test("resolveRepositoryLocalPath: a same-prefix sibling override is rejected, never accepted merely because it shares a string prefix", (t) => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-c1-r2-sibling-parent-"));
  t.after(() => fs.rmSync(parentDir, { recursive: true, force: true }));
  const fakeRoot = { lexicalRoot: path.join(parentDir, "project"), realRoot: path.join(parentDir, "project") };
  fs.mkdirSync(fakeRoot.lexicalRoot, { recursive: true });
  const siblingDir = path.join(parentDir, "project-evil", "reports");
  assert.throws(() => resolveRepositoryLocalPath(siblingDir, fakeRoot, "test-caller"), /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
});

test("resolveRepositoryLocalPath: an in-root override that is itself a symlink escaping the repository is rejected via canonical re-verification", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-c1-r2-symlink-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));

  const insideParent = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-c1-r2-symlink-inside-"));
  t.after(() => fs.rmSync(insideParent, { recursive: true, force: true }));
  const symlinkDir = path.join(insideParent, "linked-reports");

  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideDir, symlinkDir, "dir");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  assert.throws(() => resolveRepositoryLocalPath(symlinkDir, TEST_ROOT, "test-caller"), /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
});

test("resolveRepositoryLocalPath: never leaks the raw override path into the thrown error message", () => {
  const secretLookingOutside = path.join(os.tmpdir(), "SECRET_MARKER_SHOULD_NEVER_APPEAR");
  try {
    resolveRepositoryLocalPath(secretLookingOutside, TEST_ROOT, "test-caller");
    assert.fail("expected resolveRepositoryLocalPath to throw");
  } catch (err) {
    assert.equal(err.message.includes("SECRET_MARKER_SHOULD_NEVER_APPEAR"), false);
  }
});

test("resolveRepositoryLocalPath: non-string/empty override throws ADAPTER_PATH_INVALID", () => {
  assert.throws(() => resolveRepositoryLocalPath("", TEST_ROOT, "test-caller"), /ADAPTER_PATH_INVALID/);
  assert.throws(() => resolveRepositoryLocalPath(undefined, TEST_ROOT, "test-caller"), /ADAPTER_PATH_INVALID/);
});

// =========================================================================
// Roadmap FPI-2 Corrective C2 (independent adversarial review of PR #123,
// finding FPI2-R-5) - normalizeSpecPath() must classify reporter-supplied
// paths through the SAME vocabulary as resolveSafeSpecPath(), never a
// bare path.isAbsolute() check.
// =========================================================================

const FPI2_C2_ROOT = Object.freeze({ lexicalRoot: path.join(os.tmpdir(), "fpi2-c2-project"), realRoot: path.join(os.tmpdir(), "fpi2-c2-project") });

test("FPI2-R-5: normalizeSpecPath rejects (null) an escaping relative traversal path, never passing it through raw", () => {
  assert.equal(normalizeSpecPath("../outside.cy.js", FPI2_C2_ROOT), null);
  assert.equal(normalizeSpecPath("../../outside.cy.js", FPI2_C2_ROOT), null);
  assert.equal(normalizeSpecPath("foo/../../outside.cy.js", FPI2_C2_ROOT), null);
  assert.equal(normalizeSpecPath(String.raw`.\..\outside.cy.js`, FPI2_C2_ROOT), null);
  assert.equal(normalizeSpecPath(String.raw`foo\..\..\outside.cy.js`, FPI2_C2_ROOT), null);
});

test("FPI2-R-5: normalizeSpecPath still accepts safe relative paths, including ones that dip via '..' but never net negative", () => {
  assert.equal(normalizeSpecPath("tests/a.cy.js", FPI2_C2_ROOT), "tests/a.cy.js");
  assert.equal(normalizeSpecPath("./tests/a.cy.js", FPI2_C2_ROOT), "tests/a.cy.js");
  assert.equal(normalizeSpecPath("tests/../tests/a.cy.js", FPI2_C2_ROOT), "tests/../tests/a.cy.js");
  assert.equal(normalizeSpecPath("foo/./bar.cy.js", FPI2_C2_ROOT), "foo/./bar.cy.js");
});

test("FPI2-R-5: normalizeSpecPath rejects (null) a URL-like or file:-URI-like reporter path, never passing it through raw", () => {
  assert.equal(normalizeSpecPath("https://example.invalid/a.cy.js", FPI2_C2_ROOT), null);
  assert.equal(normalizeSpecPath("file:///tmp/a.cy.js", FPI2_C2_ROOT), null);
  assert.equal(normalizeSpecPath("file:/tmp/a.cy.js", FPI2_C2_ROOT), null);
});

test("FPI2-R-5: normalizeSpecPath rejects (null) a Windows UNC path regardless of slash direction", () => {
  assert.equal(normalizeSpecPath(String.raw`\\server\share\a.cy.js`, FPI2_C2_ROOT), null);
  assert.equal(normalizeSpecPath("//server/share/a.cy.js", FPI2_C2_ROOT), null);
});

test("FPI2-R-5: normalizeSpecPath rejects (null) a foreign-OS-looking Windows drive path even on a host where it might not parse as absolute", () => {
  // On POSIX this would classify as WINDOWS_DRIVE_ABSOLUTE (a real Windows
  // path syntax) but fail path.isAbsolute() on that host - the foreign-OS
  // guard must still reject it, never fall through to the relative branch.
  const result = normalizeSpecPath(String.raw`C:\outside\a.cy.js`, FPI2_C2_ROOT);
  if (process.platform === "win32") {
    assert.equal(result, null); // genuinely absolute here, but outside FPI2_C2_ROOT
  } else {
    assert.equal(result, null); // foreign-OS absolute form on POSIX
  }
});

test("FPI2-R-5: a genuine host-absolute path under either legitimate root namespace still normalizes correctly (R3 preserved)", () => {
  const realRoot = ROOT; // this repository's own real checkout
  const testRoot = Object.freeze({ lexicalRoot: realRoot, realRoot });
  assert.equal(normalizeSpecPath(path.join(realRoot, "cypress", "e2e", "a.cy.js"), testRoot), "cypress/e2e/a.cy.js");
});

test("FPI2-R-5: same-prefix sibling absolute path remains rejected (R1 preserved)", () => {
  assert.equal(normalizeSpecPath(FPI2_C2_ROOT.lexicalRoot + "-evil/a.cy.js", FPI2_C2_ROOT), null);
});

test("FPI2-R-5 production pipeline: a Cypress adapter fed a relative-traversal spec.file redacts it end to end, never leaking the raw string", () => {
  const cypressAdapter = require("./adapters/cypress-adapter");
  const reports = [
    {
      results: [
        {
          file: "../OUTSIDE_TRAVERSAL_MARKER.cy.js",
          suites: [{ title: "S", suites: [], tests: [{ title: "t", state: "failed", err: { message: "m" } }] }],
        },
      ],
    },
  ];
  const failed = cypressAdapter.extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed[0].specFile, null);
  const summarized = cypressAdapter.summarizeTestResults(reports, TEST_ROOT);
  assert.equal(summarized.specs[0].specFile, null); // redacted, matching Playwright's own S21D_6 "redacted end-to-end" convention
  assert.ok(!JSON.stringify(failed).includes("OUTSIDE_TRAVERSAL_MARKER"));
  assert.ok(!JSON.stringify(summarized).includes("OUTSIDE_TRAVERSAL_MARKER"));
});
