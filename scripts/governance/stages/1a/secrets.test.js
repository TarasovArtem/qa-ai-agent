"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { basePolicy, changedResult, fakeReader, makeSubject } = require("../../test-support-git");
const { validateBasePolicy, BUILTIN_MINIMUM_POLICY } = require("./policy");
const { fingerprintOf } = require("./secrets");
const { validateResultRecord } = require("../../kernel/results");

const subject = makeSubject();
const NOW = "2026-06-01";

// Secret-shaped samples are assembled at run time so this file never holds a contiguous
// secret-shaped literal. None is a real credential.
const GH = "gh" + "p_" + "Q".repeat(36);
const PAT = "github_" + "pat_" + "R".repeat(30);
const AWS = "AK" + "IA" + "S".repeat(16);
const SLACK = "xox" + "b-" + "1234567890-" + "T".repeat(12);
const SK = "s" + "k-" + "U".repeat(24);
const JWT = ["ey" + "J" + "V".repeat(12), "W".repeat(12), "X".repeat(12)].join(".");
const BEARER = "Bearer " + "Y".repeat(30);
const PEM = "-----BEGIN " + "PRIVATE KEY-----";
const SAMPLES = { GITHUB_TOKEN: GH, "GITHUB_TOKEN(pat)": PAT, AWS_ACCESS_KEY: AWS, SLACK_TOKEN: SLACK, API_KEY_SK: SK, JWT, BEARER_TOKEN: BEARER, PRIVATE_KEY_BLOCK: PEM };

const policyOf = (overrides = {}) => validateBasePolicy(basePolicy(overrides)).policy;
const scan = (files, extra = {}) =>
  g.scanSecrets({ subject, changedFiles: changedResult(subject, Object.keys(files)), policy: policyOf(), reader: fakeReader(files), now: NOW, ...extra });
const rec = (result, id) => result.records.find((r) => r.checkId === id);
const state = (result, id) => {
  const r = rec(result, id);
  return r ? `${r.status}/${r.reasonCode}` : "MISSING";
};
/** No full value, no fragment and no 4-character prefix of a secret may appear anywhere in the output. */
function assertNoLeak(result, secret) {
  const text = JSON.stringify(result);
  for (const fragment of [secret, secret.slice(0, 4), secret.slice(-6), secret.slice(4, 14)]) assert.equal(text.includes(fragment), false, `leaked ${fragment.length} chars`);
}

test("W1 1A secrets: every built-in secret family is detected as FAIL and only a mask is reported", async () => {
  for (const [label, secret] of Object.entries(SAMPLES)) {
    const r = await scan({ "docs/a.md": `line one\ncredentials here: ${secret} and more text\n` });
    assert.equal(state(r, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND", label);
    const finding = rec(r, "1A.SECRETS.SCAN").observed.findings[0];
    assert.equal(finding.path, "docs/a.md");
    assert.equal(finding.line, 2);
    assert.equal(finding.disposition, "SECRET");
    assert.match(finding.masked, /^\[REDACTED:[A-Z_]+\]$/);
    assert.equal(Object.keys(finding).sort().join(","), "disposition,line,masked,path,ruleId", "a finding carries no value, prefix or fingerprint");
    assertNoLeak(r, secret);
    for (const record of r.records) assert.equal(validateResultRecord(record).ok, true, `${label} ${record.checkId}`);
  }
});

test("W1 1A secrets: heuristic sensitive-value hits (including structured values) need human review and never leak", async () => {
  const cases = ["password=hunter2-hunter2", '{"api_key": "abcdef123456SECRETVALUE"}', 'authorization: Digest username="u", response="SECRETRESPONSEVALUE"', '{"tokens":["SECRETONE1234","SECRETTWO5678"]}'];
  for (const text of cases) {
    const r = await scan({ "docs/a.md": `${text}\n` });
    assert.equal(state(r, "1A.SECRETS.SCAN"), "HUMAN_REVIEW_REQUIRED/SECRET_HEURISTIC_HIT", text);
    assert.equal(rec(r, "1A.SECRETS.SCAN").observed.findings[0].disposition, "HEURISTIC");
    const leakless = JSON.stringify(r);
    for (const word of ["hunter2", "SECRETVALUE", "SECRETRESPONSE", "SECRETONE", "SECRETTWO", "abcdef123456"]) assert.equal(leakless.includes(word), false, word);
  }
});

test("W1 1A secrets: positions are exact (line numbers, CRLF, several hits per line) and the scan is deterministic", async () => {
  const r = await scan({ "docs/a.md": `a\r\nb ${GH}\r\nc ${SK} ${AWS}\r\n`, "docs/b.md": `${JWT}` });
  const findings = rec(r, "1A.SECRETS.SCAN").observed.findings;
  assert.deepEqual(findings.map((f) => `${f.path}:${f.line}:${f.ruleId}`), ["docs/a.md:2:GITHUB_TOKEN", "docs/a.md:3:API_KEY_SK", "docs/a.md:3:AWS_ACCESS_KEY", "docs/b.md:1:JWT"]);
  assert.equal(JSON.stringify(await scan({ "docs/a.md": `a\r\nb ${GH}\r\nc ${SK} ${AWS}\r\n`, "docs/b.md": `${JWT}` })), JSON.stringify(r));
});

test("W1 1A secrets: clean files pass; placeholders and ordinary prose do not trigger token rules", async () => {
  const r = await scan({ "docs/a.md": "# Title\n\nUse a token bucket. The word secret appears here. See password policy.\nghp_short and sk-tiny and AKIA123 are too short.\n", "README.md": "hello\n" });
  assert.equal(state(r, "1A.SECRETS.SCAN"), "PASS/OK");
  assert.equal(state(r, "1A.SECRETS.SUPPRESSIONS"), "NOT_APPLICABLE/OK");
  assert.equal(rec(r, "1A.SECRETS.SCAN").observed.filesScanned, 2);
  assert.equal(g.aggregate(r.records).readiness.state, "READY");
});

test("W1 1A secrets: base-policy rules add declarative prefixed-token rules (never a repository regex)", async () => {
  const custom = { ruleId: "ACME_TOKEN", prefix: "acme_", charset: "ALNUM", minLength: 20, maxLength: 40 };
  const secret = "acme_" + "Z".repeat(24);
  const r = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["a.txt"]), policy: policyOf({ secretRules: [custom] }), reader: fakeReader({ "a.txt": `x ${secret} y\nacme_short\n` }), now: NOW });
  assert.equal(state(r, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND");
  assert.deepEqual(rec(r, "1A.SECRETS.SCAN").observed.findings.map((f) => `${f.ruleId}:${f.line}`), ["ACME_TOKEN:1"]);
  assertNoLeak(r, secret);
  const withoutRule = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["a.txt"]), policy: policyOf(), reader: fakeReader({ "a.txt": `x ${secret} y\n` }), now: NOW });
  assert.equal(state(withoutRule, "1A.SECRETS.SCAN"), "PASS/OK", "the extra rule exists only because the base policy defines it");
  const hex = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["a.txt"]), policy: policyOf({ secretRules: [{ ...custom, ruleId: "HEX_KEY", prefix: "hk-", charset: "HEX", minLength: 16, maxLength: 16 }] }), reader: fakeReader({ "a.txt": "hk-0123456789abcdef and hk-0123456789abcdeg\n" }), now: NOW });
  assert.equal(rec(hex, "1A.SECRETS.SCAN").observed.findings.length, 1);
});

test("W1 1A secrets: only changed files that have content at the head are scanned (deleted, symlink, tree skipped; binary is never clean)", async () => {
  const reader = fakeReader({ "docs/a.md": "clean\n", "docs/link.md": { kind: "symlink" }, "bin/x.dat": Buffer.from([0x00, 0x01, 0x02, 0xff]), "docs/dir": { kind: "tree" } });
  const r = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["docs/a.md", "docs/deleted.md", "docs/link.md", "bin/x.dat", "docs/dir"]), policy: policyOf(), reader, now: NOW });
  // W1-SEC-M1: an unscannable file is INCOMPLETE, never a clean PASS.
  assert.equal(state(r, "1A.SECRETS.SCAN"), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE");
  const obs = rec(r, "1A.SECRETS.SCAN").observed;
  assert.equal(obs.filesScanned, 1);
  assert.equal(obs.unscannable, 1);
  assert.deepEqual([...obs.unscannablePaths], ["bin/x.dat"]);
  assert.equal(obs.notFileContent, 3);
  assert.deepEqual(reader.calls.read, ["docs/a.md", "docs/deleted.md", "docs/link.md", "bin/x.dat", "docs/dir"], "only the changed set is read, in order");
});

test("W1-SEC-M1 regression: NUL, UTF-16 and binary content never produces a clean PASS; an ASCII token inside still FAILs", async () => {
  const tokenBytes = Buffer.from(GH);
  const cases = {
    "NUL-prefixed UTF-8 + token": Buffer.concat([Buffer.from([0]), Buffer.from("\n"), tokenBytes, Buffer.from("\n")]),
    "NUL after a text token": Buffer.concat([Buffer.from("hello\n"), tokenBytes, Buffer.from("\n"), Buffer.from([0])]),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    const r = await scan({ "docs/a.txt": bytes });
    assert.equal(state(r, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND", name + ": the ASCII token is still found byte-for-byte");
    assert.equal(JSON.stringify(r).includes(GH.slice(4)), false, "no raw token in the result");
  }
  const unscannable = {
    "UTF-16LE BOM + token": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(GH, "utf16le")]),
    "UTF-16BE BOM + token": Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(GH, "utf16le").swap16()]),
    "UTF-16LE without BOM + token": Buffer.from(GH, "utf16le"),
    "random binary": Buffer.from([0x00, 0x8f, 0x13, 0xc2, 0xff, 0x00, 0x01, 0x7f]),
    "DER/PFX-like bytes": Buffer.from("3082010a0282010100c1b2a3", "hex"),
    "BOM only (no NUL)": Buffer.from([0xff, 0xfe, 0x41, 0x42]),
  };
  for (const [name, bytes] of Object.entries(unscannable)) {
    const r = await scan({ "docs/a.bin": bytes });
    assert.equal(state(r, "1A.SECRETS.SCAN"), "INCOMPLETE/SECRET_CONTENT_UNSCANNABLE", name);
    assert.notEqual(g.aggregate(r.records).readiness.state, "READY", name);
  }
  // Control: plain UTF-8 with the same token FAILs; clean UTF-8 (including non-ASCII) still PASSes.
  assert.equal(state(await scan({ "docs/a.txt": `x ${GH}\n` }), "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND");
  assert.equal(state(await scan({ "docs/a.txt": "caf\u00e9 \u4e2d\u6587 clean\n" }), "1A.SECRETS.SCAN"), "PASS/OK");
});

test("W1 1A secrets: bounds fail closed with INCOMPLETE (oversize file, oversize line, too many findings, too many files, read error)", async () => {
  const big = { kind: "too-large", size: 5_000_000 };
  assert.equal(state(await scan({ "docs/big.md": big }), "1A.SECRETS.SCAN"), "INCOMPLETE/SCAN_BOUND_EXCEEDED");
  assert.equal(state(await scan({ "docs/x.md": { kind: "error" } }), "1A.SECRETS.SCAN"), "INCOMPLETE/SCAN_BOUND_EXCEEDED");
  assert.equal(state(await scan({ "docs/long.md": "a".repeat(40_000) }), "1A.SECRETS.SCAN"), "INCOMPLETE/SCAN_BOUND_EXCEEDED");
  const manyHits = Array.from({ length: 250 }, () => `p ${GH}`).join("\n");
  const flooded = await scan({ "docs/many.md": manyHits });
  assert.equal(rec(flooded, "1A.SECRETS.SCAN").status, "FAIL", "a real secret still FAILs even when the findings bound is hit");
  assert.ok(rec(flooded, "1A.SECRETS.SCAN").observed.findings.length <= 50);
  const tooManyFiles = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`f/${i}.txt`, "x"]));
  assert.equal(state(await scan(tooManyFiles), "1A.SECRETS.SCAN"), "INCOMPLETE/SCAN_BOUND_EXCEEDED");
  for (const r of [await scan({ "docs/big.md": big }), flooded]) assert.equal(g.aggregate(r.records).readiness.state, "NOT_READY");
});

test("W1 1A secrets: an incomplete changed-file set or an unusable policy/reader is not scanned as if it were complete", async () => {
  const incomplete = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["a.txt"], false), policy: policyOf(), reader: fakeReader({ "a.txt": "x" }), now: NOW });
  assert.equal(state(incomplete, "1A.SECRETS.SCAN"), "INCOMPLETE/DIFF_COMPUTATION_FAILED");
  for (const bad of [null, undefined, "policy", { scope: {} }, { ...policyOf(), extra: 1 }]) {
    const r = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["a.txt"]), policy: bad, reader: fakeReader({ "a.txt": "x" }), now: NOW });
    assert.equal(state(r, "1A.SECRETS.SCAN"), "INCOMPLETE/POLICY_INVALID", JSON.stringify(bad));
  }
  for (const bad of [null, {}, { ...subject, head: "x" }]) assert.equal((await g.scanSecrets({ subject: bad, changedFiles: changedResult(subject, []), policy: policyOf(), reader: fakeReader({}) })).subject, null);
  assert.equal((await g.scanSecrets({ subject, changedFiles: null, policy: policyOf(), reader: fakeReader({}) })).outcome.reasonCode, "SCAN_INPUT_INVALID");
  assert.equal((await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["a"]), policy: policyOf() })).outcome.reasonCode, "SCAN_INPUT_INVALID", "no reader and no Git adapter");
  assert.equal((await g.scanSecrets(null)).subject, null);
});

test("W1 1A secrets: no secret value appears in any record, error, key or detail even when paths and values are hostile", async () => {
  const hostilePath = "docs/" + "x".repeat(20) + ".md";
  const r = await scan({ [hostilePath]: `k = ${GH}\nBearer ${"Y".repeat(30)}\npassword=hunter2hunter2\n` });
  const text = JSON.stringify(r);
  for (const secret of [GH, "Y".repeat(30), "hunter2hunter2"]) assert.equal(text.includes(secret), false);
  assert.equal(/ghp_|Bearer Y|hunter2/.test(text), false);
  for (const record of r.records) assert.ok(record.detail.length <= 500);
});

// -------------------------------------------------------------- suppressions

const suppress = (ruleId, path, text, overrides = {}) => ({
  ruleId, path, lineStart: null, lineEnd: null, classification: "DOCUMENTED_PLACEHOLDER", reason: "documented placeholder", reviewRef: "PR #7",
  fingerprint: fingerprintOf(ruleId, path, text), expires: "2026-08-01", ...overrides,
});

test("W1 1A secrets: a valid BASE-anchored suppression yields PASS for exactly its hit (and is reported as applied)", async () => {
  const files = { "docs/example.md": `Example token: ${GH}\n` };
  const r = await scan(files, { policy: policyOf({ suppressions: [suppress("GITHUB_TOKEN", "docs/example.md", GH)] }) });
  assert.equal(state(r, "1A.SECRETS.SCAN"), "PASS/OK");
  assert.equal(rec(r, "1A.SECRETS.SCAN").observed.suppressed, 1);
  assert.deepEqual([...rec(r, "1A.SECRETS.SCAN").observed.findings], []);
  assert.equal(state(r, "1A.SECRETS.SUPPRESSIONS"), "PASS/OK");
  assertNoLeak(r, GH);
  assert.equal(g.aggregate(r.records).readiness.state, "READY");
  // A second, unsuppressed secret in the same file still FAILs.
  const extra = await scan({ "docs/example.md": `Example token: ${GH}\nreal one: ${AWS}\n` }, { policy: policyOf({ suppressions: [suppress("GITHUB_TOKEN", "docs/example.md", GH)] }) });
  assert.equal(state(extra, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND");
  assert.deepEqual(rec(extra, "1A.SECRETS.SCAN").observed.findings.map((f) => f.ruleId), ["AWS_ACCESS_KEY"]);
});

test("W1 1A secrets: a suppression is line-bound when it says so and must match ONE hit", async () => {
  const files = { "docs/e.md": `one ${GH}\ntwo ${GH}\n` };
  const lineBound = await scan(files, { policy: policyOf({ suppressions: [suppress("GITHUB_TOKEN", "docs/e.md", GH, { lineStart: 1, lineEnd: 1 })] }) });
  assert.equal(state(lineBound, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND", "line 2 is not covered");
  assert.deepEqual(rec(lineBound, "1A.SECRETS.SCAN").observed.findings.map((f) => f.line), [2]);
  const both = await scan(files, { policy: policyOf({ suppressions: [suppress("GITHUB_TOKEN", "docs/e.md", GH, { lineStart: 1, lineEnd: 1 }), suppress("GITHUB_TOKEN", "docs/e.md", GH, { lineStart: 2, lineEnd: 2 })] }) });
  assert.equal(state(both, "1A.SECRETS.SCAN"), "PASS/OK");
  const unbounded = await scan(files, { policy: policyOf({ suppressions: [suppress("GITHUB_TOKEN", "docs/e.md", GH)] }) });
  assert.equal(state(unbounded, "1A.SECRETS.SUPPRESSIONS"), "FAIL/SUPPRESSION_INVALID", "an unbounded suppression matching two hits is FAIL");
  assert.equal(state(unbounded, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND", "and its hits stay unsuppressed");
});

test("W1 1A secrets: stale, unmatched, expired and over-limit suppressions are FAIL (never silently ignored)", async () => {
  const files = { "docs/e.md": `x ${GH}\n` };
  const cases = {
    "fingerprint no longer matches": suppress("GITHUB_TOKEN", "docs/e.md", GH.replace("Q", "P")),
    "matches nothing (rule)": suppress("AWS_ACCESS_KEY", "docs/e.md", AWS),
    "matches nothing (line)": suppress("GITHUB_TOKEN", "docs/e.md", GH, { lineStart: 9, lineEnd: 9 }),
    expired: suppress("GITHUB_TOKEN", "docs/e.md", GH, { expires: "2026-05-31" }),
    "expiry exceeds the policy maximum": suppress("GITHUB_TOKEN", "docs/e.md", GH, { expires: "2027-06-01" }),
  };
  for (const [label, s] of Object.entries(cases)) {
    const r = await scan(files, { policy: policyOf({ suppressions: [s] }) });
    assert.equal(state(r, "1A.SECRETS.SUPPRESSIONS"), "FAIL/SUPPRESSION_INVALID", label);
    assert.equal(state(r, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND", `${label}: the hit is not suppressed`);
  }
  const noClock = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["docs/e.md"]), policy: policyOf({ suppressions: [suppress("GITHUB_TOKEN", "docs/e.md", GH)] }), reader: fakeReader(files) });
  assert.equal(state(noClock, "1A.SECRETS.SUPPRESSIONS"), "FAIL/SUPPRESSION_INVALID", "no injected clock: expiry cannot be evaluated");
  const removedFile = await scan({ "docs/other.md": "clean\n", "docs/e.md": "now clean\n" }, { policy: policyOf({ suppressions: [suppress("GITHUB_TOKEN", "docs/e.md", GH)] }) });
  assert.equal(state(removedFile, "1A.SECRETS.SUPPRESSIONS"), "FAIL/SUPPRESSION_INVALID", "the suppressed value is gone from a changed file: the suppression is stale");
});

test("W1 1A secrets: a base suppression for a file this change did not touch is not evaluated (no false stale FAIL)", async () => {
  const r = await scan({ "docs/other.md": "clean\n" }, { policy: policyOf({ suppressions: [suppress("GITHUB_TOKEN", "docs/untouched.md", GH)] }) });
  assert.equal(state(r, "1A.SECRETS.SCAN"), "PASS/OK");
  assert.equal(state(r, "1A.SECRETS.SUPPRESSIONS"), "PASS/OK");
});

test("W1 1A secrets: a HEAD-ADDED suppression is only a proposal (HUMAN_REVIEW_REQUIRED) and can never PASS the hit", async () => {
  const files = { "docs/e.md": `x ${GH}\n` };
  const proposal = suppress("GITHUB_TOKEN", "docs/e.md", GH);
  const r = await scan(files, { headSuppressions: [proposal] });
  assert.equal(state(r, "1A.SECRETS.SCAN"), "HUMAN_REVIEW_REQUIRED/SUPPRESSION_PROPOSED");
  assert.equal(rec(r, "1A.SECRETS.SCAN").observed.findings[0].disposition, "SUPPRESSION_PROPOSED");
  assert.equal(state(r, "1A.SECRETS.SUPPRESSIONS"), "HUMAN_REVIEW_REQUIRED/SUPPRESSION_PROPOSED");
  assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
  assertNoLeak(r, GH);
  // A proposal never turns a FAIL into anything better for a different secret.
  const other = await scan({ "docs/e.md": `x ${GH}\ny ${AWS}\n` }, { headSuppressions: [proposal] });
  assert.equal(state(other, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND");
  // A malformed or wildcard proposal is still just a (invalid) proposal: it suppresses nothing.
  for (const bad of [{ ...proposal, path: "docs/*.md" }, { ...proposal, path: "docs/**" }, { ...proposal, classification: "REAL_SECRET" }, { ...proposal, expires: null }, { ...proposal, value: GH }, "everything", null, { ruleId: "GITHUB_TOKEN" }]) {
    const rr = await scan(files, { headSuppressions: [bad] });
    assert.equal(state(rr, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND", JSON.stringify(bad).slice(0, 50));
    assert.equal(state(rr, "1A.SECRETS.SUPPRESSIONS"), "HUMAN_REVIEW_REQUIRED/SUPPRESSION_PROPOSED");
    assertNoLeak(rr, GH);
  }
});

test("W1 1A secrets: a private key is never suppressible, base or head; an actual secret cannot be classified away", async () => {
  const files = { "docs/k.md": `${PEM}\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASC\n` };
  const head = await scan(files, { headSuppressions: [suppress("GITHUB_TOKEN", "docs/k.md", PEM, { ruleId: "PRIVATE_KEY_BLOCK" })] });
  assert.equal(state(head, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND");
  assert.equal(validateBasePolicy(basePolicy({ suppressions: [suppress("GITHUB_TOKEN", "docs/k.md", PEM, { ruleId: "PRIVATE_KEY_BLOCK" })] })).ok, false, "a base policy cannot even contain one");
  const anyReal = await scan({ "docs/e.md": `x ${GH}\n` }, { headSuppressions: [suppress("GITHUB_TOKEN", "docs/e.md", GH, { classification: "PRODUCTION_CREDENTIAL" })] });
  assert.equal(state(anyReal, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND");
});

test("W1 1A secrets: the fingerprint of an UNSUPPRESSED hit is never emitted (no unkeyed hash of a possibly low-entropy secret)", async () => {
  const r = await scan({ "docs/e.md": `pin: ${GH}\n` });
  const text = JSON.stringify(r);
  assert.equal(text.includes(fingerprintOf("GITHUB_TOKEN", "docs/e.md", GH)), false);
  assert.equal(/[0-9a-f]{64}/.test(text), false, "no SHA-256-shaped value at all");
  assert.match(fingerprintOf("GITHUB_TOKEN", "docs/e.md", GH), /^[0-9a-f]{64}$/, "the full, untruncated digest is the change-detection identifier");
  assert.notEqual(fingerprintOf("GITHUB_TOKEN", "docs/e.md", GH), fingerprintOf("GITHUB_TOKEN", "docs/f.md", GH), "the path is part of the fingerprint");
  assert.notEqual(fingerprintOf("GITHUB_TOKEN", "docs/e.md", GH), fingerprintOf("API_KEY_SK", "docs/e.md", GH), "the rule is part of the fingerprint");
});

test("W1 1A secrets: under the built-in minimum no suppression is ever honored and head proposals need human review", async () => {
  const builtin = { ...BUILTIN_MINIMUM_POLICY, protectedTargetRefs: ["main"] };
  const files = { "docs/e.md": `x ${GH}\n` };
  const plain = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["docs/e.md"]), policy: builtin, reader: fakeReader(files), now: NOW });
  assert.equal(state(plain, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND");
  const proposed = await g.scanSecrets({ subject, changedFiles: changedResult(subject, ["docs/e.md"]), policy: builtin, reader: fakeReader(files), now: NOW, headSuppressions: [suppress("GITHUB_TOKEN", "docs/e.md", GH)] });
  assert.equal(state(proposed, "1A.SECRETS.SCAN"), "HUMAN_REVIEW_REQUIRED/SUPPRESSION_PROPOSED");
  assert.equal(state(proposed, "1A.SECRETS.SUPPRESSIONS"), "HUMAN_REVIEW_REQUIRED/SUPPRESSION_PROPOSED");
});

test("W1 1A secrets: results are frozen plain data and independent of caller mutation", async () => {
  const input = { subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy: policyOf(), reader: fakeReader({ "docs/a.md": "clean\n" }), now: NOW, headSuppressions: [] };
  const r = await g.scanSecrets(input);
  const snapshot = JSON.stringify(r);
  input.changedFiles.files.push("docs/evil.md");
  input.headSuppressions.push({});
  assert.equal(JSON.stringify(r), snapshot);
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.records), true);
  assert.throws(() => { r.records[0].status = "PASS"; }, TypeError);
});

test("W1 1A secrets: a token keeps its specific rule and FAIL severity whatever precedes it (never downgraded to the heuristic)", async () => {
  for (const prefix of ["token: ", "api_key=", 'secret": "', "authorization: Bearer ", "password = ", "x "]) {
    const r = await scan({ "docs/a.md": `${prefix}${GH}\n` });
    const findings = rec(r, "1A.SECRETS.SCAN").observed.findings;
    assert.equal(state(r, "1A.SECRETS.SCAN"), "FAIL/SECRET_FOUND", JSON.stringify(prefix));
    // Overlapping token matches keep the earliest, longest one ("Bearer <token>" is one BEARER_TOKEN
    // hit); either way the hit is a token rule with FAIL severity, never the heuristic.
    const expectedRule = prefix.includes("Bearer") ? "BEARER_TOKEN" : "GITHUB_TOKEN";
    assert.ok(findings.some((f) => f.ruleId === expectedRule && f.disposition === "SECRET"), JSON.stringify(prefix));
    assert.equal(findings.some((f) => f.ruleId === "SENSITIVE_VALUE" && f.disposition === "SECRET"), false);
    assertNoLeak(r, GH);
  }
  const both = await scan({ "docs/a.md": `token: ${GH} and password=hunter2hunter2\n` });
  assert.deepEqual(rec(both, "1A.SECRETS.SCAN").observed.findings.map((f) => `${f.ruleId}:${f.disposition}`).sort(), ["GITHUB_TOKEN:SECRET", "SENSITIVE_VALUE:HEURISTIC"]);
});

test("W1 1A secrets: the built-in rule IDs are derived from the Wave 0 redaction rules (one definition of secret-shaped)", () => {
  const { TOKEN_RULES } = require("../../safety/redaction");
  const { BUILTIN_SECRET_RULE_IDS } = require("./policy");
  assert.deepEqual([...BUILTIN_SECRET_RULE_IDS], [...TOKEN_RULES.map((r) => r.id), "SENSITIVE_VALUE"]);
  assert.equal(Object.isFrozen(TOKEN_RULES), true);
  assert.equal(TOKEN_RULES.every((r) => typeof r.source === "string" && typeof r.flags === "string" && !(r.re instanceof RegExp)), true, "inert data only, no shared live RegExp state");
  assert.equal("TOKEN_RULES" in g, false, "the rule table is not part of the public governance interface");
});

test("W1 1A secrets: every built-in token family is detected under its OWN rule ID", async () => {
  const expected = { GITHUB_TOKEN: GH, AWS_ACCESS_KEY: AWS, SLACK_TOKEN: SLACK, API_KEY_SK: SK, JWT, BEARER_TOKEN: BEARER, PRIVATE_KEY_BLOCK: PEM };
  for (const [ruleId, secret] of Object.entries(expected)) {
    const r = await scan({ "docs/a.md": `value ${secret}\n` });
    assert.ok(rec(r, "1A.SECRETS.SCAN").observed.findings.some((f) => f.ruleId === ruleId), ruleId);
  }
});
