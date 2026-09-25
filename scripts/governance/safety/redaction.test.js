"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../index");

// Secret-like samples are assembled at run time so this file never contains a
// contiguous secret-shaped literal. None of them is a real credential.
const GH = "gh" + "p_" + "B".repeat(36);
const PAT = "github_" + "pat_" + "C".repeat(30);
const AWS = "AK" + "IA" + "D".repeat(16);
const SK = "s" + "k-" + "E".repeat(24);
const JWT = ["ey" + "J" + "F".repeat(12), "G".repeat(12), "H".repeat(12)].join(".");
const PEM = "-----BEGIN " + "PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASC\nAAAAAAAA\n-----END " + "PRIVATE KEY-----";

test("token-like values are masked and never emitted, not even partially", () => {
  for (const secret of [GH, PAT, AWS, SK, JWT]) {
    const out = g.redactString(`prefix ${secret} suffix`);
    assert.equal(out.includes(secret), false);
    assert.equal(out.includes(secret.slice(0, 6)), false);
    assert.match(out, /\[REDACTED:[A-Z_]+\]/);
  }
  assert.equal(g.redactString(`Authorization: Bearer ${"Z".repeat(24)}`).includes("ZZZZ"), false);
});

test("private-key-like material is never emitted raw", () => {
  const out = g.redactString(`before\n${PEM}\nafter`);
  assert.equal(out.includes("MIIBVQ"), false);
  assert.equal(out.includes("PRIVATE KEY-----\nMII"), false);
  assert.match(out, /PRIVATE_KEY_BLOCK/);
  const unterminated = g.redactString("-----BEGIN " + "PRIVATE KEY-----\nSECRETBODY-NEVER-SHOWN");
  assert.equal(unterminated.includes("SECRETBODY"), false);
});

test("values under sensitive key names are masked in text and structures", () => {
  assert.equal(g.redactString("password=hunter2 next").includes("hunter2"), false);
  assert.equal(g.redactString('api_key: "abc123secretvalue"').includes("abc123secretvalue"), false);
  const structured = g.redactValue({ user: "bob", nested: { apiToken: "x", list: [{ password: "p" }, `see ${GH}`] }, count: 3, ok: true, none: null });
  assert.equal(structured.user, "bob");
  assert.equal(structured.nested.apiToken, "[REDACTED:SENSITIVE_KEY]");
  assert.equal(structured.nested.list[0].password, "[REDACTED:SENSITIVE_KEY]");
  assert.equal(JSON.stringify(structured).includes(GH), false);
  assert.equal(structured.count, 3);
  assert.equal(structured.ok, true);
  assert.equal(structured.none, null);
});

test("commit-SHA-like hex values and ordinary text are preserved", () => {
  const sha = "a".repeat(40);
  assert.equal(g.redactString(`head ${sha} ok`), `head ${sha} ok`);
  assert.equal(g.redactString("plain text"), "plain text");
});

test("output is bounded, deterministic, and redaction happens before truncation", () => {
  const long = "x".repeat(5000);
  const out = g.redactString(long, { maxLength: 100 });
  assert.ok(out.length < 200);
  assert.match(out, /truncated 4900/);
  assert.equal(g.redactString(long, { maxLength: 100 }), out);
  const split = "y".repeat(90) + GH;
  const cut = g.redactString(split, { maxLength: 100 });
  assert.equal(cut.includes("ghp_"), false);
  const huge = g.redactString("z".repeat(300000), { maxLength: 10000000 });
  assert.ok(huge.length <= 60100);
});

test("redactValue does not mutate its input and bounds recursion depth", () => {
  const input = { a: { b: { c: `secret ${GH}` } } };
  const before = JSON.stringify(input);
  const out = g.redactValue(input);
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(out, input);
  let deep = { v: "leaf" };
  for (let i = 0; i < 30; i += 1) deep = { n: deep };
  assert.match(JSON.stringify(g.redactValue(deep)), /DEPTH_LIMIT/);
});

test("pathological input does not cause catastrophic matching time", () => {
  const started = Date.now();
  g.redactString("a".repeat(60000) + "=" + "b".repeat(1000));
  g.redactString("-----BEGIN " + "PRIVATE KEY-----" + "\n".repeat(50000));
  assert.ok(Date.now() - started < 3000);
});
