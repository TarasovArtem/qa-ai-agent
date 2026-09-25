"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");
const g = require("../index");

const unsafe = (fn) => assert.throws(fn, (e) => e instanceof g.GovernanceSafetyError && e.reasonCode === "UNSAFE_PATH");

test("normal repository-relative paths resolve inside the root (posix and win32)", () => {
  const posix = g.lexicalResolveWithin("/repo", "docs/a/b.md", nodePath.posix);
  assert.equal(posix.absolute, "/repo/docs/a/b.md");
  assert.equal(posix.relative, "docs/a/b.md");
  const win = g.lexicalResolveWithin("C:\\repo", "docs\\a\\b.md", nodePath.win32);
  assert.equal(win.absolute, "C:\\repo\\docs\\a\\b.md");
  assert.equal(win.relative, "docs/a/b.md");
});

test("traversal, nested traversal and separator tricks are rejected", () => {
  for (const p of [
    "../x", "..", "a/../../x", "a/../b", "./a", "a/./b", "a//b", "a/", "..\\x", "a\\..\\..\\x", "a/..\\b", "docs/%2e%2e/x".replace("%2e%2e", ".."),
  ]) {
    unsafe(() => g.lexicalResolveWithin("/repo", p, nodePath.posix));
    unsafe(() => g.lexicalResolveWithin("C:\\repo", p, nodePath.win32));
  }
});

test("absolute, drive-letter and UNC-like inputs are rejected", () => {
  for (const p of ["/etc/passwd", "\\windows\\x", "C:\\x", "c:/x", "C:x", "\\\\server\\share\\x", "//server/share/x", "/repo/docs/a.md"]) {
    unsafe(() => g.lexicalResolveWithin("/repo", p, nodePath.posix));
    unsafe(() => g.lexicalResolveWithin("C:\\repo", p, nodePath.win32));
  }
});

test("empty, non-string, control-character and alternate-stream style paths are rejected", () => {
  for (const p of ["", " ", null, undefined, 5, {}, "a\0b", "a\nb", "a:stream", "a?b", "a*b", "a|b", 'a"b', "a<b", "trailing.", "trailing ", "a/b .", "x".repeat(5000)]) {
    unsafe(() => g.lexicalResolveWithin("/repo", p, nodePath.posix));
  }
  unsafe(() => g.lexicalResolveWithin("relative/root", "a", nodePath.posix));
  unsafe(() => g.lexicalResolveWithin("", "a", nodePath.posix));
  unsafe(() => g.lexicalResolveWithin("/repo", "", nodePath.posix));
});

test("sibling-prefix confusion (/repo vs /repo-evil) cannot pass containment", () => {
  unsafe(() => g.lexicalResolveWithin("/repo", "../repo-evil/x", nodePath.posix));
  unsafe(() => g.lexicalResolveWithin("C:\\repo", "..\\repo-evil\\x", nodePath.win32));
  const ok = g.lexicalResolveWithin("/repo", "repo-evil/x", nodePath.posix);
  assert.equal(ok.absolute, "/repo/repo-evil/x");
  assert.equal(g.lexicalResolveWithin("/repo", "..a/b", nodePath.posix).absolute, "/repo/..a/b");
});

test("resolveWithinRoot works on a real temp directory and is confined to it", () => {
  const base = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gov-wave0-path-"));
  const root = nodePath.join(base, "repo");
  const sibling = nodePath.join(base, "repo-evil");
  try {
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);
    fs.mkdirSync(nodePath.join(root, "docs"));
    fs.writeFileSync(nodePath.join(root, "docs", "a.md"), "x");
    fs.writeFileSync(nodePath.join(sibling, "secret.txt"), "x");
    assert.equal(g.resolveWithinRoot(root, "docs/a.md").absolute, nodePath.join(root, "docs", "a.md"));
    assert.equal(g.resolveWithinRoot(root, "docs/new/deeper.md").absolute, nodePath.join(root, "docs", "new", "deeper.md"));
    unsafe(() => g.resolveWithinRoot(root, "../repo-evil/secret.txt"));
    unsafe(() => g.resolveWithinRoot(root, "docs/../../repo-evil/secret.txt"));
    unsafe(() => g.resolveWithinRoot(nodePath.join(base, "does-not-exist"), "a"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a symlink that points outside the root fails closed (where symlinks are permitted)", (t) => {
  const base = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gov-wave0-link-"));
  const root = nodePath.join(base, "repo");
  const outside = nodePath.join(base, "outside");
  try {
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(nodePath.join(outside, "secret.txt"), "x");
    try {
      fs.symlinkSync(outside, nodePath.join(root, "link"), "junction");
    } catch {
      t.skip("symlinks are not permitted in this environment");
      return;
    }
    unsafe(() => g.resolveWithinRoot(root, "link/secret.txt"));
    unsafe(() => g.resolveWithinRoot(root, "link/new.txt"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("error messages are bounded and do not echo the offending path", () => {
  const evil = "../" + "SECRET-VALUE-".repeat(20);
  try {
    g.lexicalResolveWithin("/repo", evil, nodePath.posix);
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error.message.length < 120);
    assert.equal(error.message.includes("SECRET-VALUE"), false);
  }
});

// ---- Corrective C1 / SEC-L2: symlink components are never equivalent to missing paths ----

function withLinkFixture(t, body) {
  const base = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gov-wave0-c1-link-"));
  const root = nodePath.join(base, "repo");
  const outside = nodePath.join(base, "outside");
  try {
    fs.mkdirSync(root);
    fs.mkdirSync(nodePath.join(root, "docs"));
    fs.mkdirSync(outside);
    fs.writeFileSync(nodePath.join(outside, "secret.txt"), "x");
    fs.writeFileSync(nodePath.join(root, "docs", "real.md"), "x");
    const link = (target, at, type) => fs.symlinkSync(target, nodePath.join(root, at), type);
    body({ root, outside, base, link });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function symlinksAllowed(t, link) {
  try {
    link();
    return true;
  } catch {
    t.skip("symlinks are not permitted in this environment");
    return false;
  }
}

test("SEC-L2: a dangling leaf symlink pointing outside the root is rejected", (t) => {
  withLinkFixture(t, ({ root, base, link }) => {
    if (!symlinksAllowed(t, () => link(nodePath.join(base, "missing-outside"), "dangling", "dir"))) return;
    unsafe(() => g.resolveWithinRoot(root, "dangling"));
    unsafe(() => g.resolveWithinRoot(root, "dangling/child.txt"));
  });
});

test("SEC-L2: a dangling leaf symlink nominally pointing inside the root is rejected too", (t) => {
  withLinkFixture(t, ({ root, link }) => {
    if (!symlinksAllowed(t, () => link(nodePath.join(root, "docs", "not-yet.md"), "docs/soon.md", "file"))) return;
    unsafe(() => g.resolveWithinRoot(root, "docs/soon.md"));
  });
});

test("SEC-L2: an intermediate dangling symlink is rejected", (t) => {
  withLinkFixture(t, ({ root, base, link }) => {
    if (!symlinksAllowed(t, () => link(nodePath.join(base, "nowhere"), "docs/mid", "dir"))) return;
    unsafe(() => g.resolveWithinRoot(root, "docs/mid/deeper/file.md"));
  });
});

test("SEC-L2: an existing symlink to outside is rejected, leaf or intermediate", (t) => {
  withLinkFixture(t, ({ root, outside, link }) => {
    if (!symlinksAllowed(t, () => link(outside, "escape", "junction"))) return;
    unsafe(() => g.resolveWithinRoot(root, "escape"));
    unsafe(() => g.resolveWithinRoot(root, "escape/secret.txt"));
    unsafe(() => g.resolveWithinRoot(root, "escape/new/file.txt"));
  });
});

test("SEC-L2: an existing symlink to a location inside the root is rejected consistently", (t) => {
  withLinkFixture(t, ({ root, link }) => {
    if (!symlinksAllowed(t, () => link(nodePath.join(root, "docs"), "alias", "junction"))) return;
    unsafe(() => g.resolveWithinRoot(root, "alias"));
    unsafe(() => g.resolveWithinRoot(root, "alias/real.md"));
  });
});

test("SEC-L2: a normal nonexistent leaf under a valid parent is still allowed", (t) => {
  withLinkFixture(t, ({ root }) => {
    assert.equal(g.resolveWithinRoot(root, "docs/future.md").absolute, nodePath.join(root, "docs", "future.md"));
    assert.equal(g.resolveWithinRoot(root, "new-dir/deeper/future.md").absolute, nodePath.join(root, "new-dir", "deeper", "future.md"));
    assert.equal(g.resolveWithinRoot(root, "docs/real.md").absolute, nodePath.join(root, "docs", "real.md"));
  });
});

test("SEC-L2: a path below a regular file is rejected rather than treated as absent", (t) => {
  withLinkFixture(t, ({ root }) => {
    unsafe(() => g.resolveWithinRoot(root, "docs/real.md/child.txt"));
  });
});
