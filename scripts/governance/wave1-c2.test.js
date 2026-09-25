"use strict";

// GOV-AUTO-1 Wave 1 / Corrective C2: W1-SEC-M1 (residual). Content that is not PROVEN to be
// valid UTF-8 text (NUL-free binary, raw key bytes, any invalid UTF-8) must never be reported
// clean. Fixtures are deterministic (fixed bytes and a seeded generator; no runtime randomness)
// and every expected result is an explicit constant. Fails against C1 (b511667) and passes on C2.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const g = require("./index");
const { basePolicy, changedResult, fakeReader, makeSubject } = require("./test-support-git");
const { fingerprintOf } = require("./stages/1a/secrets");

const subject = makeSubject();
const NOW = "2026-06-01";
const TOKEN = "gh" + "p_" + "Q".repeat(36);
const scanFiles = (files, policy = basePolicy()) =>
  g.scanSecrets({ subject, changedFiles: changedResult(subject, Object.keys(files)), policy, reader: fakeReader(files), now: NOW });
const scanRecord = (result) => result.records.find((r) => r.checkId === "1A.SECRETS.SCAN");
const outcome = (result) => `${scanRecord(result).status}/${scanRecord(result).reasonCode}`;
const STRICT = new TextDecoder("utf-8", { fatal: true });
const isValidUtf8 = (bytes) => {
  try {
    STRICT.decode(bytes);
    return true;
  } catch {
    return false;
  }
};
const ascii = (text) => Buffer.from(text, "latin1");
const cp = (...points) => String.fromCodePoint(...points);

/** Deterministic seeded byte generator (LCG): NUL-free by construction, always contains 0xFF (never valid in UTF-8). */
function seededBlob(seed, length) {
  let state = seed >>> 0;
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = 1 + ((state >>> 24) % 255); // 1..255, never 0
  }
  out[length >> 1] = 0xff;
  return out;
}

test("W1-SEC-M1 C2: the explicit invalid-UTF-8 fixture and a raw 32-byte key are INCOMPLETE, never clean", async () => {
  const explicit = Buffer.from("fffd808190c328a0", "hex");
  const rawKey = Buffer.from("9fa1c4e2ff7b3d5a88c1d0e97263b4f1ae5c0d29ff81b6a7c3d4e5f60718293a", "hex");
  for (const [name, bytes] of Object.entries({ "ff fd 80 81 90 c3 28 a0": explicit, "raw 32-byte key": rawKey })) {
    assert.equal(bytes.includes(0), false, `${name}: NUL-free`);
    assert.equal(isValidUtf8(bytes), false, `${name}: invalid UTF-8`);
    const r = await scanFiles({ "docs/blob.bin": bytes });
    assert.equal(outcome(r), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE", name);
    assert.equal(scanRecord(r).observed.unscannable, 1);
    assert.deepEqual([...scanRecord(r).observed.unscannablePaths], ["docs/blob.bin"]);
    assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
  }
});

test("W1-SEC-M1 C2: every seeded NUL-free invalid-UTF-8 blob is INCOMPLETE (a property over many sizes)", async () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    for (const length of [2, 8, 16, 32, 64, 255, 1024]) {
      const bytes = seededBlob(seed * 7919 + length, length);
      assert.equal(bytes.includes(0), false);
      assert.equal(isValidUtf8(bytes), false);
      assert.equal(outcome(await scanFiles({ "keys/k.bin": bytes })), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE", `seed ${seed} length ${length}`);
      checked += 1;
    }
  }
  assert.equal(checked, 420);
});

test("W1-SEC-M1 C2: the Latin-1 fallback is detection only (a recognizable ASCII secret in invalid-UTF-8 bytes still FAILs)", async () => {
  const withToken = Buffer.concat([Buffer.from([0xff, 0xfe, 0x80, 0x81]), ascii(` ${TOKEN} `), Buffer.from([0xc3, 0x28, 0xa0])]);
  assert.equal(withToken.includes(0), false);
  assert.equal(isValidUtf8(withToken), false);
  const r = await scanFiles({ "docs/blob.bin": withToken });
  assert.equal(outcome(r), "FAIL/SECRET_FOUND");
  assert.equal(JSON.stringify(r).includes(TOKEN.slice(4)), false, "no raw token in any record");
  assert.equal(scanRecord(r).observed.findings[0].masked, "[REDACTED:GITHUB_TOKEN]");
  // A PEM header in invalid-UTF-8 content is found too.
  const pem = Buffer.concat([Buffer.from([0xff, 0x80]), ascii("-----BEGIN PRIVATE KEY-----"), Buffer.from([0xc3, 0x28])]);
  assert.equal(outcome(await scanFiles({ "k/x.bin": pem })), "FAIL/SECRET_FOUND");
});

test("W1-SEC-M1 C2: valid UTF-8 text is still scanned as text and can PASS (no overreach)", async () => {
  const valid = {
    "empty": Buffer.alloc(0),
    "ascii": ascii("plain ascii text\nsecond line\n"),
    "german": Buffer.from(`Gr${cp(0xfc)}${cp(0xdf)}e ${cp(0xc4, 0xd6, 0xdc)}\n`, "utf8"),
    "cyrillic": Buffer.from(cp(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442) + "\n", "utf8"),
    "japanese": Buffer.from(cp(0x65e5, 0x672c, 0x8a9e, 0x30c6, 0x30b9, 0x30c8) + "\n", "utf8"),
    "emoji": Buffer.from(cp(0x1f600, 0x1f680) + " ok\n", "utf8"),
    "combining": Buffer.from("e" + cp(0x301) + " a" + cp(0x308) + "\n", "utf8"),
    "utf8 bom": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ascii("bom text\n")]),
    "crlf": ascii("a\r\nb\r\n"),
  };
  for (const [name, bytes] of Object.entries(valid)) {
    assert.equal(isValidUtf8(bytes), true, name);
    const r = await scanFiles({ "docs/t.txt": bytes });
    assert.equal(outcome(r), "PASS/OK", name);
    assert.equal(scanRecord(r).observed.unscannable, 0, name);
    assert.equal(scanRecord(r).observed.filesScanned, 1, name);
  }
  // Valid UTF-8 with a secret still FAILs.
  const secret = Buffer.from(`${cp(0x41f, 0x440)} ${TOKEN}\n`, "utf8");
  assert.equal(outcome(await scanFiles({ "docs/t.txt": secret })), "FAIL/SECRET_FOUND");
});

test("W1-SEC-M1 C2: the C1 cases stay fail-closed (NUL and UTF-16, with and without a visible token)", async () => {
  const cases = {
    "NUL + token": [Buffer.concat([Buffer.from([0]), ascii(`\n${TOKEN}\n`)]), "FAIL/SECRET_FOUND"],
    "NUL, no token": [Buffer.from([0x68, 0x00, 0x69]), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE"],
    "UTF-16LE BOM + token": [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TOKEN, "utf16le")]), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE"],
    "UTF-16BE BOM + token": [Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(TOKEN, "utf16le").swap16()]), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE"],
    "UTF-16LE without BOM": [Buffer.from(TOKEN, "utf16le"), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE"],
    "BOM only, no NUL": [Buffer.from([0xff, 0xfe, 0x41, 0x42]), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE"],
  };
  for (const [name, [bytes, expected]] of Object.entries(cases)) assert.equal(outcome(await scanFiles({ "docs/x.bin": bytes })), expected, name);
});

test("W1-SEC-M1 C2: multi-file precedence (unscannable in any file prevents PASS; a finding dominates)", async () => {
  const clean = ascii("clean\n");
  const junk = Buffer.from("fffd808190c328a0", "hex");
  assert.equal(outcome(await scanFiles({ "a.txt": clean, "b.bin": junk })), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE");
  assert.equal(outcome(await scanFiles({ "a.bin": junk, "b.txt": ascii(`x ${TOKEN}\n`) })), "FAIL/SECRET_FOUND");
  assert.equal(outcome(await scanFiles({ "a.txt": clean, "b.txt": ascii("also clean\n") })), "PASS/OK");
  const two = await scanFiles({ "a.bin": junk, "z.bin": seededBlob(7, 40), "m.txt": clean });
  assert.equal(scanRecord(two).observed.unscannable, 2);
  assert.equal(scanRecord(two).observed.filesScanned, 1);
  // Invariant: whenever any file was not proven text, the scan status is never PASS.
  for (const files of [{ "a.bin": junk }, { "a.bin": junk, "b.txt": clean }, { "a.txt": clean, "b.bin": seededBlob(3, 8) }]) {
    const rec = scanRecord(await scanFiles(files));
    assert.ok(rec.observed.unscannable > 0);
    assert.notEqual(rec.status, "PASS");
  }
});

test("W1-SEC-M1 C2: suppression accounting is unchanged (base-anchored still PASSes its hit; a head proposal still needs review); unscannable still blocks", async () => {
  const suppression = {
    ruleId: "GITHUB_TOKEN", path: "docs/fixture.md", lineStart: null, lineEnd: null, classification: "TEST_FIXTURE", reason: "public placeholder",
    reviewRef: "PR#1", fingerprint: fingerprintOf("GITHUB_TOKEN", "docs/fixture.md", TOKEN), expires: "2026-08-01",
  };
  const policy = basePolicy({ suppressions: [suppression] });
  const fixture = ascii(`example ${TOKEN}\n`);
  assert.equal(outcome(await scanFiles({ "docs/fixture.md": fixture }, policy)), "PASS/OK", "valid base suppression applies to a text file");
  const withJunk = await scanFiles({ "docs/fixture.md": fixture, "docs/blob.bin": Buffer.from("fffd808190c328a0", "hex") }, policy);
  assert.equal(outcome(withJunk), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE", "a suppressed hit elsewhere never clears an unscannable file");
  assert.equal(scanRecord(withJunk).observed.suppressed, 1);
  const proposed = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["docs/fixture.md"]), policy: basePolicy(), reader: fakeReader({ "docs/fixture.md": fixture }), now: NOW, headSuppressions: [suppression] });
  assert.equal(outcome(proposed), "HUMAN_REVIEW_REQUIRED/SUPPRESSION_PROPOSED");
  const stale = await scanFiles({ "docs/fixture.md": ascii(`example ${TOKEN}x\n`) }, policy);
  assert.equal(scanRecord(stale).status, "FAIL");
});

test("W1-SEC-M1 C2: no raw content or hex dump appears in a result, and no 'binary skipped' clean state exists in the source", async () => {
  const junk = Buffer.from("9fa1c4e2ff7b3d5a88c1d0e97263b4f1ae5c0d29ff81b6a7c3d4e5f60718293a", "hex");
  const r = await scanFiles({ "docs/key.bin": junk });
  const text = JSON.stringify(r);
  assert.equal(text.includes("9fa1c4e2"), false, "no hex dump");
  assert.equal(text.includes(junk.toString("latin1")), false, "no raw bytes");
  assert.deepEqual(Object.keys(scanRecord(r).observed).sort(), ["filesScanned", "findings", "findingsTotal", "notFileContent", "suppressed", "unscannable", "unscannablePaths"]);
  const source = fs.readFileSync(nodePath.join(__dirname, "stages", "1a", "secrets.js"), "utf8");
  assert.equal(/binarySkipped/.test(source), false);
  assert.match(source, /fatal: true/, "strict UTF-8 validation is used");
});
