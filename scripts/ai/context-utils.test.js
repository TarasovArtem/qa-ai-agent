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
  resolveSafeSpecPath,
  resolveSafeLocalAttachmentPath,
} = require("./context-utils");

const ROOT = path.resolve(__dirname, "..", "..");

test("normalizeSpecPath: strips the repo root and leading slashes, normalizes backslashes", () => {
  assert.equal(
    normalizeSpecPath(path.join(ROOT, "cypress", "e2e", "tests", "x.cy.js")),
    "cypress/e2e/tests/x.cy.js"
  );
  assert.equal(normalizeSpecPath("\\cypress\\e2e\\tests\\x.cy.js"), "cypress/e2e/tests/x.cy.js");
  assert.equal(normalizeSpecPath(null), null);
  assert.equal(normalizeSpecPath(""), null);
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

// --- resolveSafeSpecPath (Roadmap #21D, R2) ---------------------------------

test("PATH_1 resolveSafeSpecPath: a safe relative spec path is preserved, normalized to forward slashes", () => {
  assert.deepEqual(resolveSafeSpecPath("tests/foo.spec.js"), { value: "tests/foo.spec.js", rejected: false });
  assert.deepEqual(resolveSafeSpecPath("playwright\\tests\\foo.spec.js"), { value: "playwright/tests/foo.spec.js", rejected: false });
  assert.deepEqual(resolveSafeSpecPath("./proof.spec.js"), { value: "proof.spec.js", rejected: false });
});

test("PATH_2 resolveSafeSpecPath: a repo-local absolute spec path (not required to exist) becomes repo-relative, never absolute", (t) => {
  const absoluteUnderRoot = path.join(ROOT, "tests", "path-2-does-not-exist.spec.js");
  const result = resolveSafeSpecPath(absoluteUnderRoot);
  assert.equal(result.rejected, false);
  assert.equal(result.value, "tests/path-2-does-not-exist.spec.js");
  assert.equal(path.isAbsolute(result.value), false);
});

test("PATH_2b resolveSafeSpecPath: a repo-local absolute spec path that genuinely exists resolves via its canonical location", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-path2b-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const specFile = path.join(tmpDir, "real.spec.js");
  fs.writeFileSync(specFile, "");

  const result = resolveSafeSpecPath(specFile);
  assert.equal(result.rejected, false);
  assert.equal(path.isAbsolute(result.value), false);
  assert.equal(path.resolve(ROOT, result.value), fs.realpathSync(specFile));
});

test("PATH_3 resolveSafeSpecPath: an out-of-root absolute spec path is never preserved raw - redacted to null, marked rejected", () => {
  const outsideMarker = "OUTSIDE_PRIVATE_PATH_MARKER_21D";
  const outsidePath = path.join(os.tmpdir(), outsideMarker, "foo.spec.js");
  const result = resolveSafeSpecPath(outsidePath);
  assert.deepEqual(result, { value: null, rejected: true });
});

test("PATH_4 resolveSafeSpecPath: traversal-relative spec paths are rejected, never preserved", () => {
  assert.deepEqual(resolveSafeSpecPath("../foo.spec.js"), { value: null, rejected: true });
  assert.deepEqual(resolveSafeSpecPath("tests/../../../foo.spec.js"), { value: null, rejected: true });
});

test("PATH_5/PATH_6 resolveSafeSpecPath: cross-platform absolute-looking paths never become an apparently-safe relative value on this host", () => {
  const posixLike = resolveSafeSpecPath("/tmp/foo.spec.js");
  assert.equal(posixLike.value, null);
  assert.equal(posixLike.rejected, true);

  const uncBackslash = resolveSafeSpecPath("\\\\server\\share\\foo.spec.js");
  assert.deepEqual(uncBackslash, { value: null, rejected: true });

  const uncSlash = resolveSafeSpecPath("//server/share/foo.spec.js");
  assert.deepEqual(uncSlash, { value: null, rejected: true });

  const windowsDrive = resolveSafeSpecPath("C:\\Users\\someone\\foo.spec.js");
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
  assert.deepEqual(resolveSafeSpecPath("https://example.invalid/foo.spec.js"), { value: null, rejected: true });
  assert.deepEqual(resolveSafeSpecPath("file:///tmp/foo.spec.js"), { value: null, rejected: true });
});

test("resolveSafeSpecPath: absent/empty input is null but NOT marked rejected (nothing unsafe was ever supplied)", () => {
  assert.deepEqual(resolveSafeSpecPath(null), { value: null, rejected: false });
  assert.deepEqual(resolveSafeSpecPath(""), { value: null, rejected: false });
});

// --- resolveSafeLocalAttachmentPath (Roadmap #21D, R3) ----------------------

test("ATT_1 resolveSafeLocalAttachmentPath: a repo-local existing file is accepted as a repo-relative, never-absolute path", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-att1-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const filePath = path.join(tmpDir, "shot.png");
  fs.writeFileSync(filePath, "");

  const result = resolveSafeLocalAttachmentPath(filePath);
  assert.equal(result.rejected, false);
  assert.equal(path.isAbsolute(result.value), false);
  assert.equal(path.resolve(ROOT, result.value), fs.realpathSync(filePath));
});

test("ATT_2 resolveSafeLocalAttachmentPath: an out-of-root existing file is rejected, never returned", () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-att2-"));
  try {
    const filePath = path.join(outsideDir, "shot.png");
    fs.writeFileSync(filePath, "");
    assert.deepEqual(resolveSafeLocalAttachmentPath(filePath), { value: null, rejected: true });
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

  assert.deepEqual(resolveSafeLocalAttachmentPath(symlinkPath), { value: null, rejected: true });
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

  const viaSymlink = resolveSafeLocalAttachmentPath(symlinkPath);
  const viaRealFile = resolveSafeLocalAttachmentPath(realFile);
  assert.equal(viaSymlink.rejected, false);
  assert.ok(viaSymlink.value);
  // The returned value represents the canonical TARGET, not the symlink's
  // own lexical path - proven by it matching what resolving the real file
  // directly produces.
  assert.equal(viaSymlink.value, viaRealFile.value);
});

test("ATT_6 resolveSafeLocalAttachmentPath: a URL-like attachment path is rejected outright, no filesystem access implied", () => {
  assert.deepEqual(resolveSafeLocalAttachmentPath("https://example.invalid/screenshot.png"), { value: null, rejected: true });
});

test("ATT_7 resolveSafeLocalAttachmentPath: a nonexistent local-looking path fails safely - null, not rejected (never existed, nothing to redact)", () => {
  const missing = path.join(os.tmpdir(), "context-utils-att7-does-not-exist", "shot.png");
  assert.deepEqual(resolveSafeLocalAttachmentPath(missing), { value: null, rejected: false });
});

test("resolveSafeLocalAttachmentPath: absent/empty input is null but not rejected", () => {
  assert.deepEqual(resolveSafeLocalAttachmentPath(null), { value: null, rejected: false });
  assert.deepEqual(resolveSafeLocalAttachmentPath(""), { value: null, rejected: false });
});

// =========================================================================
// D21D-1 (pre-#21G hardening): a dedicated, committed regression locking the
// specific contract that was previously only "safe by implementation/probe"
// - a genuinely relative attachment.path (the shape #21B's own real
// Playwright reporter proof never actually produced, since it always
// emitted absolute paths, but which resolveSafeLocalAttachmentPath() has
// always handled via `path.join(ROOT, rawPath)`) is anchored to the
// repository ROOT constant, never to whatever process.cwd() the caller
// happens to be running from - proven here with a real, genuinely
// separate child process, not an unsafe process.chdir() mutation shared
// with every other test in this file.
// =========================================================================

const { execFileSync } = require("node:child_process");

test("D21D-1 relative attachment.path resolves anchored to repository ROOT, accepted as canonical repo-relative text", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "context-utils-d21d1-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const absoluteFixture = path.join(tmpDir, "shot.png");
  fs.writeFileSync(absoluteFixture, "");

  const relativeFromRoot = path.relative(ROOT, absoluteFixture).split(path.sep).join("/");
  const result = resolveSafeLocalAttachmentPath(relativeFromRoot);

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
  const fromRepoRootCwd = resolveSafeLocalAttachmentPath(relativeFromRoot);
  assert.equal(fromRepoRootCwd.rejected, false);
  assert.ok(fromRepoRootCwd.value);

  // A genuinely separate child process, with cwd deliberately set to OS
  // temp (never the repo root, never any repo subdirectory) - proves the
  // resolution is anchored to context-utils.js's own ROOT constant
  // (path.resolve(__dirname, "..", "..")), never to the invoking
  // process's own cwd.
  const foreignCwd = fs.mkdtempSync(path.join(os.tmpdir(), "context-utils-d21d1-foreign-cwd-"));
  t.after(() => fs.rmSync(foreignCwd, { recursive: true, force: true }));
  const probeScript = `
    const { resolveSafeLocalAttachmentPath } = require(${JSON.stringify(path.join(__dirname, "context-utils.js"))});
    process.stdout.write(JSON.stringify(resolveSafeLocalAttachmentPath(${JSON.stringify(relativeFromRoot)})));
  `;
  const childOutput = execFileSync(process.execPath, ["-e", probeScript], { cwd: foreignCwd, encoding: "utf8" });
  const fromForeignCwd = JSON.parse(childOutput);

  assert.deepEqual(fromForeignCwd, fromRepoRootCwd, "resolution must be byte-identical regardless of the caller's cwd");
  assert.notEqual(process.cwd(), foreignCwd, "sanity: the child's cwd was genuinely different from this process's own cwd");
});
