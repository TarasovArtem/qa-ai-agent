"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FINGERPRINT_VERSION, canonicalizeBytes, frameRegion, hashFramedRegions } = require("./fingerprint");

test("fingerprint version prefix is gov-fp-v1", () => {
  assert.equal(FINGERPRINT_VERSION, "gov-fp-v1");
  const h = hashFramedRegions([frameRegion("s", Buffer.from("x"))]);
  assert.ok(h.startsWith("gov-fp-v1:"));
  assert.match(h, /^gov-fp-v1:[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------- canonicalization (tests 19-23, 68-70, 77)

test("CRLF and lone CR normalize to LF", () => {
  const crlf = canonicalizeBytes(Buffer.from("a\r\nb\r\nc"));
  const lf = canonicalizeBytes(Buffer.from("a\nb\nc"));
  const cr = canonicalizeBytes(Buffer.from("a\rb\rc"));
  assert.equal(crlf.ok, true);
  assert.deepEqual(crlf.bytes, lf.bytes);
  assert.deepEqual(cr.bytes, lf.bytes);
});

test("CRLF-only difference produces the same fingerprint; an additional content change produces a different one", () => {
  const crlf = canonicalizeBytes(Buffer.from("line one\r\nline two\r\n"));
  const lf = canonicalizeBytes(Buffer.from("line one\nline two\n"));
  const h1 = hashFramedRegions([frameRegion("file:a.md", crlf.bytes)]);
  const h2 = hashFramedRegions([frameRegion("file:a.md", lf.bytes)]);
  assert.equal(h1, h2);
  const changed = canonicalizeBytes(Buffer.from("line one\nline TWO\n"));
  const h3 = hashFramedRegions([frameRegion("file:a.md", changed.bytes)]);
  assert.notEqual(h1, h3);
});

test("a single leading BOM is stripped; content is otherwise identical", () => {
  const withBom = canonicalizeBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello\n")]));
  const withoutBom = canonicalizeBytes(Buffer.from("hello\n"));
  assert.deepEqual(withBom.bytes, withoutBom.bytes);
});

test("a BOM-like sequence in the middle of the file is ordinary content, not stripped", () => {
  const middle = canonicalizeBytes(Buffer.concat([Buffer.from("x\n"), Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("y\n")]));
  assert.equal(middle.ok, true);
  assert.ok(middle.bytes.includes(0xef));
});

test("trailing whitespace is preserved and changes the fingerprint", () => {
  const a = canonicalizeBytes(Buffer.from("hello   \n"));
  const b = canonicalizeBytes(Buffer.from("hello\n"));
  assert.notEqual(hashFramedRegions([frameRegion("s", a.bytes)]), hashFramedRegions([frameRegion("s", b.bytes)]));
});

test("internal whitespace inside a table-like line is preserved and changes the fingerprint", () => {
  const a = canonicalizeBytes(Buffer.from("| A | B |\n"));
  const b = canonicalizeBytes(Buffer.from("| A  | B |\n"));
  assert.notEqual(hashFramedRegions([frameRegion("s", a.bytes)]), hashFramedRegions([frameRegion("s", b.bytes)]));
});

test("invalid UTF-8 fails closed, never replacement-character substitution", () => {
  const invalid = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
  const result = canonicalizeBytes(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "INVALID_UTF8");
});

test("valid multi-byte UTF-8 (non-ASCII) round-trips unchanged", () => {
  const text = "café ééé 中文\n";
  const result = canonicalizeBytes(Buffer.from(text, "utf8"));
  assert.equal(result.ok, true);
  assert.equal(result.bytes.toString("utf8"), text);
});

test("Unicode content is not normalized (no NFC/NFD folding)", () => {
  // "e" + combining acute (NFD) vs precomposed "é" (NFC) must stay distinct.
  const nfd = canonicalizeBytes(Buffer.from("é\n", "utf8"));
  const nfc = canonicalizeBytes(Buffer.from("é\n", "utf8"));
  assert.notEqual(hashFramedRegions([frameRegion("s", nfd.bytes)]), hashFramedRegions([frameRegion("s", nfc.bytes)]));
});

// ---------------------------------------------------------------- framing (region ambiguity, test 71)

test("framing prevents ambiguous concatenation between two different selector/content splits", () => {
  // ("ab", "cd") vs ("a", "bcd") would concatenate identically under naive
  // concatenation; the length-prefixed framing must keep them distinct.
  const framedA = frameRegion("ab", Buffer.from("cd"));
  const framedB = frameRegion("a", Buffer.from("bcd"));
  assert.notEqual(hashFramedRegions([framedA]), hashFramedRegions([framedB]));
});

test("selector order changes the ordered-sequence hash", () => {
  const r1 = frameRegion("file:a.md", Buffer.from("A"));
  const r2 = frameRegion("file:b.md", Buffer.from("B"));
  assert.notEqual(hashFramedRegions([r1, r2]), hashFramedRegions([r2, r1]));
});

test("hashing is deterministic across repeated calls with identical input", () => {
  const framed = [frameRegion("file:a.md", Buffer.from("hello")), frameRegion("file:b.md", Buffer.from("world"))];
  assert.equal(hashFramedRegions(framed), hashFramedRegions(framed));
});

test("multi-byte selector length is counted in bytes, not characters", () => {
  // A selector containing a multi-byte character must use its BYTE length in
  // the frame, or two different (unicode-selector, content) pairs whose char
  // lengths coincidentally match while byte lengths differ could collide.
  const framed = frameRegion("file:é.md", Buffer.from("x"));
  const text = framed.toString("utf8");
  const selectorByteLen = Buffer.byteLength("file:é.md", "utf8");
  assert.ok(text.startsWith(`${selectorByteLen}:file:é.md\n`));
});
