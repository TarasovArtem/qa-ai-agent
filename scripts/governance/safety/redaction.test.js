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

// ---- Corrective C2: SEC-M1 (quoted/structured values), C1-SEC-L1 (glued Bearer),
// ---- C1-SEC-L2 (key=value grammar) ------------------------------------------------

const SENSITIVE_KEYS = ["password", "passwd", "secret", "token", "api_key", "api-key", "authorization", "credential"];
// Key syntaxes: [prefix before the value, closer after a quoted value]
const KEY_FORMS = [
  { name: "key=value", open: (k) => `${k}=` },
  { name: "key: value", open: (k) => `${k}: ` },
  { name: '"key":"value"', open: (k) => `"${k}":` },
  { name: '"key": "value"', open: (k) => `"${k}": ` },
  { name: "'key':'value'", open: (k) => `'${k}':` },
];
// Marker fragments that must never survive: every word of every value carries "QQ".
const NO_QQ = (out, label) => assert.equal(/QQ/.test(out), false, `${label}: ${out.slice(0, 120)}`);

// A quoted value with spaces, comma, semicolon, colon, equals and a newline.
const QUOTED_VALUES = [
  (q) => `${q}QQ1 QQ2,QQ3;QQ4:QQ5=QQ6\nQQ7 QQ8${q}`,
  (q) => `${q}QQ1 QQ2 QQ3 QQ4 QQ5 QQ6${q}`,
  (q) => `${q}QQ1${q}`,
];

test("C2 SEC-M1: every sensitive key and syntax fully redacts a quoted value (no boundary)", () => {
  for (const key of SENSITIVE_KEYS) {
    for (const form of KEY_FORMS) {
      for (const q of ['"', "'"]) {
        for (const value of QUOTED_VALUES) {
          const out = g.redactString(`before ${form.open(key)}${value(q)} after`);
          NO_QQ(out, `${key} ${form.name} ${q}`);
          assert.match(out, /REDACTED:SENSITIVE_VALUE/);
          assert.equal(out.startsWith("before "), true);
        }
      }
    }
  }
});

test("C2 SEC-M1: a quoted sensitive value crossing the input bound never leaks its continuation", () => {
  for (const key of SENSITIVE_KEYS) {
    for (const form of KEY_FORMS) {
      for (const q of ['"', "'"]) {
        for (const before of [1, 8, 16, 30, 48]) {
          for (const earlier of ["", SHRINKERS]) {
            const secret = `${form.open(key)}${q}QQ1 QQ2,QQ3;QQ4:QQ5=QQ6\nQQ7 QQ8 QQ9 QQ10${q}`;
            const out = g.redactString(straddle(secret, before, earlier), OPTIONS);
            NO_QQ(out, `${key} ${form.name} ${q} before=${before} ${earlier ? "shrunk" : ""}`);
          }
        }
      }
    }
  }
});

test("C2 SEC-M1: the original quoted counterexample (alpha bravo charlie ...) no longer leaks at any offset", () => {
  const secret = 'password="alpha bravo charlie delta echo foxtrot"';
  for (const q of ['"', "'"]) {
    const value = secret.replace(/"/g, q);
    for (let before = 1; before <= 50; before += 1) {
      const out = g.redactString(straddle(value, before, SHRINKERS), OPTIONS);
      for (const word of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]) assert.equal(out.includes(word), false, `${word} at ${before}`);
    }
  }
});

test("C2 SEC-M1: an unquoted value with commas, semicolons and colons crossing the input bound leaks nothing", () => {
  for (const key of SENSITIVE_KEYS) {
    for (const form of ["key=value", "key: value"]) {
      for (const before of [1, 8, 16, 30, 48]) {
        const open = form === "key=value" ? `${key}=` : `${key}: `;
        const secret = `${open}QQ1,QQ2;QQ3:QQ4=QQ5/QQ6`;
        const out = g.redactString(straddle(secret, before, SHRINKERS), OPTIONS);
        NO_QQ(out, `${key} ${form} before=${before}`);
      }
    }
  }
});

test("C2 C1-SEC-L2: unquoted values are consumed to whitespace, commas semicolons and colons included", () => {
  for (const key of SENSITIVE_KEYS) {
    for (const open of [`${key}=`, `${key}: `, `${key} = `]) {
      const out = g.redactString(`x ${open}QQ1,QQ2;QQ3:QQ4 tail`);
      NO_QQ(out, open);
      // An authorization value is opaque and runs to the end of the line (C3), so only
      // other keys keep the text that follows the value on the same line.
      if (key !== "authorization") assert.equal(out.endsWith(" tail"), true, "text after the value is preserved");
    }
  }
});

test("C2 C1-SEC-L2: JSON-style keys redact string and scalar values but keep neighbouring fields", () => {
  const a = g.redactString('{"password":"hunter2","user":"bob"}');
  assert.equal(a.includes("hunter2"), false);
  assert.match(a, /"user":"bob"/);
  const b = g.redactString('{"api_key": "abcdef123456", "note": "ok"}');
  assert.equal(b.includes("abcdef123456"), false);
  assert.match(b, /"note": "ok"/);
  const c = g.redactString('{"token":12345,"user":"bob"}');
  assert.equal(c.includes("12345"), false);
  assert.match(c, /"user":"bob"/);
  const d = g.redactString("{'secret':'p q r','user':'bob'}");
  assert.equal(d.includes("p q r"), false);
  assert.match(d, /'user':'bob'/);
  const e = g.redactString('{"credential": true, "n": 1}');
  assert.equal(e.includes("true"), false);
  assert.match(e, /"n": 1/);
});

test("C2 C1-SEC-L2: an unterminated quoted sensitive value fails closed to the end of the text", () => {
  for (const q of ['"', "'"]) {
    const out = g.redactString(`start password=${q}QQ1 QQ2 QQ3,QQ4`);
    NO_QQ(out, q);
    assert.equal(out.startsWith("start password="), true);
  }
});

test("C2 C1-SEC-L2: escaped quotes inside a quoted value do not end it early; multiline values are consumed", () => {
  const escaped = g.redactString('password="QQ1 \\"QQ2 QQ3" tail');
  NO_QQ(escaped, "escaped");
  assert.equal(escaped.endsWith(" tail"), true);
  const multiline = g.redactString('secret: "QQ1\nQQ2\nQQ3" after');
  NO_QQ(multiline, "multiline");
  assert.equal(multiline.endsWith(" after"), true);
});

test("C2 C1-SEC-L2: an authorization scheme word takes the credential that follows it", () => {
  for (const text of ["Authorization: Bearer QQshort", "authorization=Basic QQdXNlcjpwYXNz", '{"authorization": "Bearer QQx y"}']) {
    NO_QQ(g.redactString(text), text);
  }
});

test("C2 C1-SEC-L2: prose that merely mentions a sensitive word is preserved", () => {
  for (const text of ["the token is valid for one hour", "rotate the secret regularly", "password policy: see the wiki", "credentials were rejected"]) {
    const out = g.redactString(text);
    assert.equal(out.length > 0, true);
  }
  assert.equal(g.redactString("the token is valid for one hour"), "the token is valid for one hour");
  assert.equal(g.redactString("rotate the secret regularly"), "rotate the secret regularly");
});

test("C2 C1-SEC-L2: markers left by the token rules are not re-read as key names", () => {
  const out = g.redactString(`github_token: ${GH} and ${JWT}`);
  assert.equal(out.includes("BBBB"), false);
  assert.equal(out.includes("FFFF"), false);
  assert.equal(g.redactString(g.redactString(`x ${GH} y`)), g.redactString(`x ${GH} y`), "redaction is idempotent on its own output");
});

test("C2 C1-SEC-L1: a Bearer credential is redacted however it is glued to neighbouring text", () => {
  const body = "Z".repeat(30);
  for (const prefix of ["", "x", "prefix", "Authorization:", "(", "\n", "\t", "=", '"', "'", "-", "_", "9"]) {
    for (const scheme of ["Bearer", "bearer", "BEARER"]) {
      for (const suffix of ["", ")", ",", '"', "\n", " tail"]) {
        const out = g.redactString(`${prefix}${scheme} ${body}${suffix}`);
        assert.equal(out.includes("ZZZZ"), false, JSON.stringify(`${prefix}${scheme} ...${suffix}`));
      }
    }
  }
  assert.equal(g.redactString(`Bearer\n${body}`).includes("ZZZZ"), false, "newline between scheme and token");
  assert.equal(g.redactString(`Bearer   ${body}`).includes("ZZZZ"), false);
});

test("C2 C1-SEC-L1: a glued Bearer credential crossing the input bound leaks no prefix", () => {
  for (const glue of ["", "x", "prefix", "("]) {
    for (const before of [1, 3, 8, 16, 30, 45]) {
      const out = g.redactString(straddle(`${glue}Bearer ${"Z".repeat(30)}`, before, SHRINKERS), OPTIONS);
      assert.equal(out.includes("ZZZZ"), false, `${glue} before=${before}`);
    }
  }
});

test("C2: every token rule, including Slack, still redacts when it crosses the input bound", () => {
  const SLACK = "xox" + "b-" + "1234567890-abcdefghij";
  for (const [secret, fragments] of [[SLACK, ["xoxb", "1234567", "abcdef"]], [PAT, ["github_", "CCCC"]], [PEM, ["MIIBVQ"]]]) {
    for (const before of [1, 8, 16, 30, 48]) {
      const out = g.redactString(straddle(secret, before, SHRINKERS), OPTIONS);
      for (const fragment of fragments) assert.equal(out.includes(fragment), false, `${fragment} before=${before}`);
    }
  }
});

test("C2: ordinary text with sensitive-looking words near the bound is only truncated, not destroyed", () => {
  const prose = "the token is valid and the secret is rotated regularly; ".repeat(1500);
  const out = g.redactString(prose, OPTIONS);
  assert.ok(out.startsWith("the token is valid and the secret is rotated regularly; the token"));
  assert.ok(out.length > 55000);
  assert.match(out, /\.\.\.\[truncated \d+\]$/);
});

test("C2: redaction stays linear and bounded on pathological input (timings recorded)", () => {
  const cases = {
    "64k near-match bearer strings": "Bearer aaaaaaaaaaa ".repeat(3500),
    "many sensitive-key prefixes": "password ".repeat(7000),
    "key with long whitespace then no separator": "token" + " ".repeat(60000) + "x",
    "many unmatched quotes": 'password="'.repeat(6000),
    "many unmatched single quotes": "secret:'".repeat(8000),
    "punctuation run": ",;:=\"'".repeat(10000),
    "long unbroken string": "A".repeat(500000),
    "private-key-like data": "-----BEGIN " + "PRIVATE KEY-----" + ("QQ".repeat(40) + "\n").repeat(1500),
    "keyword pile": "tokenpasswordsecretapi_keycredentialauthorization".repeat(1300),
    "escape run": 'password="' + "\\".repeat(60000),
  };
  const timings = [];
  for (const [name, input] of Object.entries(cases)) {
    const started = Date.now();
    const out = g.redactString(input, OPTIONS);
    const elapsed = Date.now() - started;
    timings.push(`${name}=${elapsed}ms`);
    assert.ok(out.length <= 60100, `${name}: output bounded (${out.length})`);
    assert.ok(elapsed < 1500, `${name} took ${elapsed} ms`);
  }
  console.log(`# redaction timings: ${timings.join(", ")}`);
});

// ---- Corrective C3: C1-SEC-L2 (structured JSON values) and C2-SEC-L1 (Authorization) ----

// Every leaf carries "QQ" so any surviving fragment is detectable.
const structured = (label, text, publicTail) => {
  const out = g.redactString(text);
  NO_QQ(out, label);
  if (publicTail) assert.ok(out.includes(publicTail), `${label}: sibling field kept: ${out}`);
  return out;
};

test("C3 C1-SEC-L2: arrays under sensitive keys are redacted as one unit", () => {
  structured("tokens", '{"tokens":["QQ1","QQ2","QQ3"],"n":1}', '"n":1');
  structured("api_keys", '{"api_keys":["QQ1","QQ2"]}');
  structured("api_keys spaced", '{"api_keys": [ "QQ1", "QQ2" ]}');
  const numeric = g.redactString('{"passwords":[1,2,3],"ok":true}');
  assert.equal(numeric, '{"passwords":[REDACTED:SENSITIVE_VALUE],"ok":true}',"the whole numeric array is one redacted value");
});

test("C3 C1-SEC-L2: objects under sensitive keys are redacted as one unit", () => {
  structured("credentials", '{"credentials":{"user":"QQ1","pass":"QQ2"},"n":1}', '"n":1');
  structured("token object", '{"token":{"access":"QQ1","refresh":"QQ2"},"public":"ok"}', '"public":"ok"');
});

test("C3 C1-SEC-L2: nested structures, mixed brackets and structures inside structures", () => {
  structured("nested users", '{"credentials":{"users":[{"u":"QQ1"},{"u":"QQ2"}]},"public":"ok"}', '"public":"ok"');
  structured("nested arrays", '{"tokens":[["QQ1"],["QQ2"]],"public":"ok"}', '"public":"ok"');
  structured("object in array in object", '{"secrets":[{"a":{"b":["QQ1",{"c":"QQ2"}]}}],"public":"ok"}', '"public":"ok"');
  structured("unquoted key", "tokens=[QQ1,[QQ2,{a:QQ3}]] tail", " tail");
  structured("single-quoted python-style", "{'credentials': {'user': 'QQ1', 'pass': 'QQ2'}, 'public': 'ok'}", "'public': 'ok'");
});

test("C3 C1-SEC-L2: brackets and braces inside quoted strings do not end the structure", () => {
  structured("] inside string", '{"tokens":["QQ]1","QQ2"],"public":"ok"}', '"public":"ok"');
  structured("} inside string", '{"credentials":{"x":"QQ}1","y":"QQ2"},"public":"ok"}', '"public":"ok"');
  structured("[ inside string", '{"tokens":["QQ[1","QQ{2"],"public":"ok"}', '"public":"ok"');
});

test("C3 C1-SEC-L2: escaped quotes inside a structure do not end its strings early", () => {
  structured("escaped quote", '{"tokens":["QQ1\\"]","QQ2"],"public":"ok"}', '"public":"ok"');
  structured("escaped backslash", '{"tokens":["QQ1\\\\","QQ2"],"public":"ok"}', '"public":"ok"');
});

test("C3 C1-SEC-L2: an unbalanced, mismatched or too deeply nested structure fails closed to the end of the text", () => {
  for (const text of [
    '{"tokens":["QQ1","QQ2"',
    '{"credentials":{"user":"QQ1"',
    '{"tokens":["QQ1","QQ2"} tail QQ3',
    '{"tokens":{"a":["QQ1"}}',
    '{"tokens":["QQ1","unterminated QQ2',
    "tokens: [QQ1, QQ2",
  ]) {
    const out = structured(text, text);
    assert.equal(out.includes("QQ"), false);
  }
  const deep = `{"tokens":${"[".repeat(200)}"QQ1"${"]".repeat(200)},"public":"QQ2"}`;
  const out = g.redactString(deep);
  NO_QQ(out, "depth limit");
  assert.equal(out.includes("public"), false, "beyond the depth limit everything to the end is redacted");
  const within = `{"tokens":${"[".repeat(30)}"QQ1"${"]".repeat(30)},"public":"ok"}`;
  assert.ok(g.redactString(within).includes('"public":"ok"'), "a structure within the depth limit resumes normally");
});

test("C3 C1-SEC-L2: after a balanced structure closes, scanning resumes and later sensitive fields are redacted too", () => {
  const out = g.redactString('{"tokens":["QQ1"],"public":"ok","password":"QQ2","note":"fine"}');
  NO_QQ(out, "resume");
  assert.match(out, /"public":"ok"/);
  assert.match(out, /"note":"fine"/);
});

test("C3 C1-SEC-L2: sensitive-key matching stays substring based (plural and compound names)", () => {
  for (const key of ["token", "tokens", "api_key", "api_keys", "api-keys", "credential", "credentials", "secret", "secrets", "passwords", "githubToken", "clientSecret"]) {
    structured(key, `{"${key}":["QQ1","QQ2"],"public":"ok"}`, '"public":"ok"');
  }
});

test("C3 C1-SEC-L2: a structure crossing the input bound never leaks a fragment", () => {
  const shapes = [
    (k) => `{"${k}":["QQ1","QQ2","QQ3","QQ4","QQ5","QQ6"]}`,
    (k) => `{"${k}":{"a":"QQ1","b":["QQ2",{"c":"QQ3"}],"d":"QQ4"}}`,
    (k) => `${k}=[QQ1,QQ2,[QQ3,QQ4]]`,
    // Whitespace-separated shapes: the trailing whitespace-free run is only the last
    // element, so the structure itself must fail closed rather than be dropped whole.
    (k) => `{"${k}": ["QQ1", "QQ2", "QQ3", "QQ4", "QQ5", "QQ6", "QQ7"]}`,
    (k) => `{ "${k}": { "a": "QQ1", "b": [ "QQ2", { "c": "QQ3" } ], "d": "QQ4" } }`,
  ];
  for (const key of ["tokens", "api_keys", "credentials", "secret"]) {
    for (const shape of shapes) {
      for (const before of [1, 8, 16, 30, 48]) {
        for (const earlier of ["", SHRINKERS]) {
          const out = g.redactString(straddle(shape(key), before, earlier), OPTIONS);
          NO_QQ(out, `${key} before=${before} ${earlier ? "shrunk" : ""}`);
        }
      }
    }
  }
});

const AUTH_LINES = [
  "Bearer QQabc",
  "Basic QQabc",
  "Token QQabc",
  "token QQ0123456789abcdef0123456789abcdef01234567",
  'Digest username="QQu", response="QQr"',
  "NTLM QQabc",
  "Negotiate QQabc",
  "AWS4-HMAC-SHA256 Credential=QQA, SignedHeaders=QQB, Signature=QQC",
  "CustomScheme QQabc QQdef QQghi",
  "QQ-scheme-less-credential",
];

test("C3 C2-SEC-L1: an Authorization value is redacted whole whatever the scheme", () => {
  for (const key of ["Authorization", "authorization", "AUTHORIZATION", "Proxy-Authorization", "x_authorization"]) {
    for (const value of AUTH_LINES) {
      for (const sep of [": ", ":", "=", " : "]) {
        const out = g.redactString(`GET /x\n${key}${sep}${value}\nHost: example.test`);
        NO_QQ(out, `${key}${sep}${value}`);
        assert.ok(out.startsWith("GET /x\n"), "earlier lines are kept");
        assert.ok(out.endsWith("\nHost: example.test"), "the next line is kept");
      }
    }
  }
});

test("C3 C2-SEC-L1: CRLF and end-of-text terminate the Authorization line; quoted forms are consumed whole", () => {
  assert.equal(g.redactString("Authorization: Digest QQa, QQb\r\nHost: h"), "Authorization: [REDACTED:SENSITIVE_VALUE]\r\nHost: h");
  assert.equal(g.redactString("Authorization: Token QQabc"), "Authorization: [REDACTED:SENSITIVE_VALUE]");
  NO_QQ(g.redactString('{"authorization":"Bearer QQabc","n":1}'), "quoted value");
  assert.match(g.redactString('{"authorization":"Bearer QQabc","n":1}'), /"n":1/);
  NO_QQ(g.redactString("{'authorization': 'Token QQa QQb', 'n': 1}"), "single quoted");
  NO_QQ(g.redactString('{"authorization":{"scheme":"QQ1","cred":"QQ2"},"n":1}'), "structured authorization");
  assert.match(g.redactString('{"authorization":{"scheme":"QQ1","cred":"QQ2"},"n":1}'), /"n":1/);
});

test("C3 C2-SEC-L1: an Authorization line crossing the input bound leaks nothing", () => {
  for (const value of AUTH_LINES) {
    for (const before of [1, 8, 16, 30, 48]) {
      for (const earlier of ["", SHRINKERS]) {
        const out = g.redactString(straddle(`Authorization: ${value}`, before, earlier), OPTIONS);
        NO_QQ(out, `${value} before=${before} ${earlier ? "shrunk" : ""}`);
      }
    }
  }
});

test("C3 C2-SEC-L1: an Authorization credential already masked by a token rule does not expose the rest of the line", () => {
  const out = g.redactString(`Authorization: Bearer ${"Z".repeat(30)} QQextra`);
  NO_QQ(out, "after token rule");
  assert.equal(out.includes("ZZZZ"), false);
});

test("C3: prose and unrelated uses of scheme words are preserved", () => {
  for (const text of [
    "This is a basic usage example",
    "digest the log lines",
    "ntlm support is planned",
    "the token bucket algorithm is documented",
    "Authorization is checked by the gateway",
    "use bearer auth for the API",
  ]) {
    assert.equal(g.redactString(text), text, text);
  }
});

test("C3: standalone Bearer detection (glued, boundary, case) still works", () => {
  for (const prefix of ["", "x", "prefix", "(", "\n"]) {
    assert.equal(g.redactString(`${prefix}Bearer ${"Z".repeat(30)}`).includes("ZZZZ"), false, prefix);
    assert.equal(g.redactString(`${prefix}bearer ${"Z".repeat(30)}`).includes("ZZZZ"), false, prefix);
  }
});

test("C3: redaction of structured and authorization input stays linear and bounded (timings recorded)", () => {
  const cases = {
    "deeply nested structured value": `{"tokens":${"[".repeat(60000)}`,
    "many nested arrays and objects": `{"credentials":${'{"a":['.repeat(4000)}${"]}".repeat(4000)}}`,
    "many braces inside strings": `{"tokens":["${"}]{[".repeat(15000)}"]}`,
    "many escaped quotes": `{"secret":["${'\\"'.repeat(30000)}"]}`,
    "64k structured input": `{"tokens":[${'"QQ",'.repeat(11000)}"QQ"]}`,
    "64k authorization line": `Authorization: ${"QQ ".repeat(22000)}`,
    "many authorization lines": "Authorization: Token QQ\n".repeat(2700),
    "many structured pairs": '{"tokens":["a"]}'.repeat(4000),
    "many sensitive pairs": "password=a ".repeat(6000),
    "unbalanced closers": `tokens: ${"]}".repeat(30000)}`,
  };
  const timings = [];
  for (const [name, input] of Object.entries(cases)) {
    const started = Date.now();
    const out = g.redactString(input, OPTIONS);
    const elapsed = Date.now() - started;
    timings.push(`${name}=${elapsed}ms`);
    assert.ok(out.length <= 60100, `${name}: output bounded (${out.length})`);
    assert.ok(elapsed < 1500, `${name} took ${elapsed} ms`);
  }
  console.log(`# redaction C3 timings: ${timings.join(", ")}`);
});
