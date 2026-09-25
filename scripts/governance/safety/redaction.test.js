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

// ---- Corrective C1 / SEC-M1: an input-bound cut can never emit part of a secret ----

const INPUT_BOUND = 65536; // the internal input bound (redaction.js MAX_INPUT_LENGTH)
const OPTIONS = { maxLength: 60000 };
const BEARER_BODY = "Z".repeat(30);
const SHRINKERS = `${GH} `.repeat(1500); // ~61.5k chars that collapse to ~36k after redaction

// Text of exactly INPUT_BOUND + extra chars in which `secret` begins `before` chars
// before the input bound and continues past it. `earlier` is prepended first.
function straddle(secret, before, earlier = "") {
  const head = earlier + " ".repeat(Math.max(0, INPUT_BOUND - before - earlier.length));
  assert.ok(head.length === INPUT_BOUND - before, "fixture must place the secret at the intended offset");
  return `${head}${secret} trailing words after the secret`;
}

const CASES = [
  { name: "GitHub token", secret: GH, leak: ["ghp_", "BBBB"] },
  { name: "GitHub fine-grained token", secret: PAT, leak: ["github_", "CCCC"] },
  { name: "bearer token", secret: `Bearer ${BEARER_BODY}`, leak: ["ZZZZ"] },
  { name: "JWT", secret: JWT, leak: ["eyJF", "FFFF", "GGGG"] },
  { name: "sk- token", secret: SK, leak: ["sk-E", "EEEE"] },
  { name: "AWS access key", secret: AWS, leak: ["AKIA", "DDDD"] },
];

test("SEC-M1: the original review counterexample (earlier redactions shrink output, token straddles the bound) leaks nothing", () => {
  const input = straddle(GH, 20, SHRINKERS);
  assert.ok(input.length > INPUT_BOUND);
  const out = g.redactString(input, OPTIONS);
  assert.equal(out.includes("ghp_"), false);
  assert.equal(out.includes("BBBB"), false);
  assert.equal(/gh[pousr]_/.test(out), false);
});

for (const c of CASES) {
  for (const before of [1, 2, 5, 12, 20]) {
    for (const earlier of ["", SHRINKERS]) {
      test(`SEC-M1: ${c.name} starting ${before} chars before the input bound leaks no prefix (${earlier ? "with" : "without"} earlier redactions)`, () => {
        const out = g.redactString(straddle(c.secret, before, earlier), OPTIONS);
        for (const fragment of c.leak) assert.equal(out.includes(fragment), false, fragment);
        assert.match(out, /\.\.\.\[truncated \d+\]$/);
      });
    }
  }
}

test("SEC-M1: a token beginning exactly at or after the input bound is never emitted", () => {
  for (const before of [0, -3]) {
    const head = " ".repeat(INPUT_BOUND - before);
    const out = g.redactString(`${head}${GH} tail`, OPTIONS);
    assert.equal(out.includes("ghp_"), false);
    assert.equal(out.includes("BBBB"), false);
  }
});

test("SEC-M1: a private-key block crossing the input bound never emits its body", () => {
  for (const before of [40, 200, 2000]) {
    const pem = "-----BEGIN " + "PRIVATE KEY-----\n" + "MIIBVQIBADANBgkqhkiG9w0BAQEFAASC\n".repeat(400);
    const out = g.redactString(straddle(pem, before, SHRINKERS), OPTIONS);
    assert.equal(out.includes("MIIBVQ"), false);
    assert.equal(out.includes("AQEFAASC"), false);
  }
});

test("SEC-M1: a key=value secret crossing the input bound leaks no value characters", () => {
  const out = g.redactString(straddle("password=" + "q".repeat(40), 30, SHRINKERS), OPTIONS);
  assert.equal(out.includes("qqqq"), false);
});

test("SEC-M1: ordinary non-secret text near the bound is preserved except for the final partial word", () => {
  const words = "plain ordinary words ".repeat(4000); // ~84k chars, no secrets
  const out = g.redactString(words, OPTIONS);
  assert.ok(out.startsWith("plain ordinary words plain ordinary words"));
  assert.ok(out.length > 55000, "most of the bounded input is kept");
  assert.ok(out.length <= 60100, "output stays bounded");
  assert.match(out, /\.\.\.\[truncated \d+\]$/);
  assert.equal(g.redactString(words, OPTIONS), out, "deterministic");
});

test("SEC-M1: a single whitespace-free input larger than the bound yields only the marker, bounded and quickly", () => {
  const started = Date.now();
  const out = g.redactString("A".repeat(500000), OPTIONS);
  assert.ok(out.length < 100);
  assert.match(out, /truncated 500000\]$/);
  assert.ok(Date.now() - started < 3000);
});

test("SEC-M1: input below the bound is redacted in full and untouched by the boundary rule", () => {
  const text = "w ".repeat(20000) + GH + " " + "w ".repeat(5000);
  assert.ok(text.length < INPUT_BOUND);
  const out = g.redactString(text, OPTIONS);
  assert.equal(out.includes("ghp_"), false);
  assert.equal(out.includes("BBBB"), false);
  assert.equal(out.includes("[REDACTED:GITHUB_TOKEN]"), true);
  assert.equal(out.includes("truncated"), false);
});
