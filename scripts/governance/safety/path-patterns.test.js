"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePathPattern, matchPathPattern, patternCovers } = require("./path-patterns");
const { validateRepoRelativePath, compareBytewise } = require("./repo-path");

const P = (text) => {
  const parsed = parsePathPattern(text);
  assert.equal(parsed.ok, true, text);
  return parsed.pattern;
};
const matches = (pattern, path) => matchPathPattern(P(pattern), path);

test("W1 patterns: the grammar accepts only the restricted forms", () => {
  for (const ok of ["README.md", "docs/**", "**/*.md", "**", "docs/*.md", "a/b/c.txt", ".github/workflows/**", "scripts/governance/**", "src/*/index.js"]) assert.equal(parsePathPattern(ok).ok, true, ok);
  for (const bad of ["", "/abs", "a//b", "a/./b", "a/../b", "..", ".", "a/**/b", "**/a/**", "a**", "a/b**", "a?b", "a[b]", "a{b}", "a\\b", "a b", "a/", "docs/\u0000", "x".repeat(201), Array(20).fill("a").join("/")]) {
    assert.equal(parsePathPattern(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(parsePathPattern(null).ok, false);
  assert.equal(parsePathPattern(5).ok, false);
});

test("W1 patterns: matching is segment-aware, case-sensitive and never crosses a slash with *", () => {
  assert.equal(matches("docs/**", "docs/a.md"), true);
  assert.equal(matches("docs/**", "docs/a/b/c.md"), true);
  assert.equal(matches("docs/**", "docs"), false, "docs/** needs at least one more segment");
  assert.equal(matches("docs/**", "docsx/a.md"), false, "no string-prefix confusion");
  assert.equal(matches("docs/*.md", "docs/a.md"), true);
  assert.equal(matches("docs/*.md", "docs/a/b.md"), false);
  assert.equal(matches("**/*.md", "a.md"), true);
  assert.equal(matches("**/*.md", "x/y/z.md"), true);
  assert.equal(matches("**/*.md", "x/y/z.txt"), false);
  assert.equal(matches("**", "anything/at/all"), true);
  assert.equal(matches("README.md", "readme.md"), false, "no case folding");
  assert.equal(matches("a*b", "ab"), true);
  assert.equal(matches("a*b", "aXXb"), true);
  assert.equal(matches("a*b", "aXXc"), false);
  assert.equal(matches("*", ""), false);
});

test("W1 patterns: matching cost stays bounded on adversarial input", () => {
  const started = Date.now();
  const pattern = P("*a*a*a*a*a*a*a*a*a*b");
  assert.equal(matchPathPattern(pattern, "a".repeat(4000)), false);
  assert.ok(Date.now() - started < 1000);
});

test("W1 patterns: patternCovers proves subset relations conservatively", () => {
  const covers = (base, candidate) => patternCovers(P(base), P(candidate));
  assert.equal(covers("docs/**", "docs/a/**"), true);
  assert.equal(covers("docs/**", "docs/a.md"), true);
  assert.equal(covers("docs/**", "src/a.md"), false);
  assert.equal(covers("docs/**", "docs/**"), true);
  assert.equal(covers("docs/a/**", "docs/**"), false, "a wider candidate is never covered");
  assert.equal(covers("README.md", "README.md"), true);
  assert.equal(covers("README.md", "docs/**"), false);
  assert.equal(covers("**/*.md", "docs/a.md"), true);
  assert.equal(covers("**/*.md", "docs/**"), false, "unbounded on the right cannot be proven");
  assert.equal(covers("docs/*.md", "docs/a.md"), true);
  assert.equal(covers("docs/*.md", "docs/*.md"), true);
});

test("W1 repo-path: canonical repository-relative paths only; no repair", () => {
  for (const ok of ["a", "a/b", "docs/é.md", "a b/c", "日本語/x.md", ".github/workflows/x.yml"]) assert.equal(validateRepoRelativePath(ok).ok, true, ok);
  for (const bad of ["", "./a", "/a", "a/", "a//b", "../a", "a/../b", "a/./b", "C:/x", "c:\\x", "a\\b", "a\u0000b", "a\nb", "\u007f", "x".repeat(5000)]) assert.equal(validateRepoRelativePath(bad).ok, false, JSON.stringify(bad).slice(0, 40));
  assert.equal(validateRepoRelativePath(null).ok, false);
});

test("W1 repo-path: bytewise ordering is locale independent and differs from UTF-16 order for astral characters", () => {
  const astral = "\u{1F600}.md"; // UTF-8 F0 9F ... ; UTF-16 D83D ...
  const bmp = "\uFF5E.md"; // UTF-8 EF BD 9E ; UTF-16 FF5E
  assert.ok(astral > bmp === false, "UTF-16 order puts the astral path first");
  assert.ok(compareBytewise(astral, bmp) > 0, "bytewise order puts the astral path last");
  assert.deepEqual(["b", "a", "B", "A", "é", "e"].sort(compareBytewise), ["A", "B", "a", "b", "e", "é"]);
});
