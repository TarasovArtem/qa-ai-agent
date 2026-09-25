"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateBasePolicy, parseBasePolicyBytes, parseSuppression, policyDigest, gateManifestPath, BUILTIN_MINIMUM_POLICY, BUILTIN_PROTECTED_PATHS, BUILTIN_SECRET_RULE_IDS } = require("./policy");
const { basePolicy } = require("../../test-support-git");
const { FRAMEWORK_METADATA } = require("../../framework-metadata");
const { validateFrameworkMetadata } = require("../../kernel/validation");

const family = (o = {}) => ({ family: "TB", prefix: "TB-", segments: [{ minDigits: 2, maxDigits: 3 }], separator: "-", definitionSources: ["docs/**"], definitionContexts: ["HEADING"], ignoreContexts: ["FENCED_CODE"], ...o });
const withMarkdown = (families) => basePolicy({ markdown: { filePatterns: ["**/*.md"], idFamilies: families } });
const invalid = (tree, label) => {
  const r = validateBasePolicy(tree);
  assert.equal(r.ok, false, label);
  assert.equal(r.policy, null);
  assert.equal(r.status, "CONFIGURATION_ERROR", label);
  return r;
};
const suppression = (o = {}) => ({ ruleId: "GITHUB_TOKEN", path: "docs/example.md", lineStart: null, lineEnd: null, classification: "DOCUMENTED_PLACEHOLDER", reason: "documented placeholder token", reviewRef: "PR #1", fingerprint: "f".repeat(64), expires: "2030-01-01", ...o });

test("W1 policy: framework metadata for Wave 1 is valid and lists exactly the two new capabilities", () => {
  const r = validateFrameworkMetadata(FRAMEWORK_METADATA);
  assert.equal(r.ok, true);
  assert.deepEqual([...FRAMEWORK_METADATA.supportedCapabilities], ["repository-preflight@1", "markdown-reference-integrity@1"]);
  assert.deepEqual({ ...FRAMEWORK_METADATA.supportedSchemaVersions }, { minSupported: 1, maxSupported: 1 });
});

test("W1 policy: a complete policy validates into a frozen normalized form", () => {
  const r = validateBasePolicy(basePolicy({ markdown: { filePatterns: ["**/*.md"], idFamilies: [family()] } }));
  assert.equal(r.ok, true);
  assert.equal(Object.isFrozen(r.policy), true);
  assert.deepEqual([...r.policy.protectedTargetRefs], ["main"]);
  assert.equal(r.policy.schemaVersion, 1);
  assert.equal(validateBasePolicy(r.policy).ok, true, "a normalized policy re-validates (runtime validation at every boundary)");
});

test("W1 policy: unknown fields, missing fields and wrong containers are CONFIGURATION_ERROR", () => {
  invalid({ ...basePolicy(), extra: 1 }, "unknown field");
  for (const key of ["schemaVersion", "requiredCapabilities", "protectedTargetRefs", "scope", "secretRules", "suppressionPolicy", "suppressions", "markdown"]) {
    const tree = basePolicy();
    delete tree[key];
    invalid(tree, `missing ${key}`);
  }
  invalid(null, "null");
  invalid([], "array");
  invalid("policy", "string");
  invalid(basePolicy({ scope: { allowedPathDomains: ["docs/**"] } }), "scope missing keys");
  invalid(basePolicy({ scope: { allowedPathDomains: ["docs/**"], forbiddenPathDomains: [], protectedPaths: [], extra: [] } }), "scope extra key");
});

test("W1 policy: protectedTargetRefs follows the design contract table (absent / empty / malformed)", () => {
  const withRefs = (protectedTargetRefs) => basePolicy({ protectedTargetRefs });
  assert.equal(validateBasePolicy(withRefs(["main", "release/1.0"])).ok, true);
  const tree = basePolicy();
  delete tree.protectedTargetRefs;
  invalid(tree, "absent");
  for (const bad of [[], null, {}, "main", ["main", "main"], [""], [" main"], ["main "], ["release/*"], ["a\tb"], ["a\nb"], [5], [null], [["main"]], ["a".repeat(256)]]) {
    invalid(withRefs(bad), JSON.stringify(bad));
  }
  invalid(withRefs(Array.from({ length: 33 }, (_, i) => `b${i}`)), "too many refs");
});

test("W1 policy: scope patterns use the restricted grammar; allowed domains must exist", () => {
  invalid(basePolicy({ scope: { allowedPathDomains: [], forbiddenPathDomains: [], protectedPaths: [] } }), "empty allowed");
  invalid(basePolicy({ scope: { allowedPathDomains: ["docs/**", "docs/**"], forbiddenPathDomains: [], protectedPaths: [] } }), "duplicate pattern");
  for (const pattern of ["a/**/b", "a?b", "../x", "/abs", "a\\b", "(a|b)+", "a|b", "x".repeat(201)]) {
    invalid(basePolicy({ scope: { allowedPathDomains: [pattern], forbiddenPathDomains: [], protectedPaths: [] } }), pattern);
  }
});

test("W1 policy: schemaVersion is lexical for JSON input and range-checked against the framework", () => {
  const encode = (obj) => Buffer.from(JSON.stringify(obj));
  assert.equal(parseBasePolicyBytes(encode(basePolicy())).ok, true);
  for (const raw of ["1.0", "01", "1e0", "0", "-1", '"1"', "null", "true", "[]", "{}"]) {
    const text = JSON.stringify(basePolicy()).replace('"schemaVersion":1', `"schemaVersion":${raw}`);
    const r = parseBasePolicyBytes(Buffer.from(text));
    assert.equal(r.ok, false, raw);
    assert.equal(r.status, "CONFIGURATION_ERROR", raw);
  }
  const newer = parseBasePolicyBytes(Buffer.from(JSON.stringify(basePolicy()).replace('"schemaVersion":1', '"schemaVersion":2')));
  assert.equal(newer.ok, false);
  assert.equal(newer.status, "INCOMPLETE");
  assert.equal(newer.reasonCode, "CAPABILITY_UNAVAILABLE_ON_TARGET");
});

test("W1 policy: policy bytes are bounded strict UTF-8 JSON (BOM, duplicates, oversize, invalid encoding rejected)", () => {
  const good = JSON.stringify(basePolicy());
  assert.equal(parseBasePolicyBytes(Buffer.from("﻿" + good)).ok, false, "BOM");
  assert.equal(parseBasePolicyBytes(Buffer.from([0xff, 0xfe, 0x00])).ok, false, "invalid UTF-8");
  assert.equal(parseBasePolicyBytes(Buffer.from(good.replace("{", '{"schemaVersion":1,'))).ok, false, "duplicate key");
  assert.equal(parseBasePolicyBytes(Buffer.from(good + " ".repeat(300 * 1024))).ok, false, "oversize");
  assert.equal(parseBasePolicyBytes(Buffer.from("{")).ok, false, "truncated");
  assert.equal(parseBasePolicyBytes("string").ok, false, "not bytes");
  assert.equal(parseBasePolicyBytes(null).ok, false, "null");
  assert.equal(parseBasePolicyBytes(Buffer.from("[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]")).ok, false, "too deep");
});

test("W1 policy: required capabilities are validated identities; an unlisted one is reported, never assumed", () => {
  const r = validateBasePolicy(basePolicy({ requiredCapabilities: ["repository-preflight@1", "future-thing@1"] }));
  assert.equal(r.ok, true);
  assert.deepEqual([...r.unsupportedCapabilities], ["future-thing@1"]);
  for (const bad of ["repository-preflight", "repository-preflight@0", "repository-preflight@unknown", "X@1", 5, null]) invalid(basePolicy({ requiredCapabilities: [bad] }), String(bad));
  invalid(basePolicy({ requiredCapabilities: ["repository-preflight@1", "repository-preflight@1"] }), "duplicate");
});

test("W1 policy: secret rules are declarative, bounded, and can never redefine a built-in rule", () => {
  const rule = { ruleId: "ACME_TOKEN", prefix: "acme_", charset: "ALNUM", minLength: 20, maxLength: 40 };
  assert.equal(validateBasePolicy(basePolicy({ secretRules: [rule] })).ok, true);
  for (const id of BUILTIN_SECRET_RULE_IDS) invalid(basePolicy({ secretRules: [{ ...rule, ruleId: id }] }), `redefines ${id}`);
  invalid(basePolicy({ secretRules: [rule, rule] }), "duplicate custom rule");
  for (const bad of [{ prefix: "" }, { prefix: "a b" }, { prefix: "x".repeat(40) }, { charset: "ANY" }, { minLength: 3 }, { minLength: 30, maxLength: 20 }, { maxLength: 5000 }, { ruleId: "lower" }, { ruleId: "A" }, { regex: ".*" }]) {
    invalid(basePolicy({ secretRules: [{ ...rule, ...bad }] }), JSON.stringify(bad));
  }
  invalid(basePolicy({ secretRules: Array.from({ length: 33 }, (_, i) => ({ ...rule, ruleId: `RULE_${i}_X` })) }), "too many rules");
});

test("W1 policy: ID families reject ambiguity, duplicates and unsafe grammar", () => {
  assert.equal(validateBasePolicy(withMarkdown([family(), family({ family: "GH", prefix: "GH-" }), family({ family: "OQ", prefix: "OQ", segments: [{ minDigits: 1, maxDigits: 1 }, { minDigits: 1, maxDigits: 2 }] })])).ok, true);
  invalid(withMarkdown([family(), family()]), "duplicate family");
  invalid(withMarkdown([family({ family: "A", prefix: "TB-" }), family({ family: "B", prefix: "TB-" })]), "identical prefixes");
  invalid(withMarkdown([family({ family: "A", prefix: "TB" }), family({ family: "B", prefix: "TB-" })]), "one prefix inside another");
  for (const bad of [{ family: "tb" }, { family: "" }, { prefix: "1-" }, { prefix: "TB--" }, { prefix: "(TB)-" }, { separator: "/" }, { segments: [] }, { segments: [{ minDigits: 0, maxDigits: 2 }] }, { segments: [{ minDigits: 3, maxDigits: 2 }] }, { segments: [{ minDigits: 1, maxDigits: 99 }] }, { segments: Array(4).fill({ minDigits: 1, maxDigits: 2 }) }, { definitionSources: [] }, { definitionSources: ["a/**/b"] }, { definitionContexts: [] }, { definitionContexts: ["ANYWHERE"] }, { ignoreContexts: ["EVERYTHING"] }, { ignoreContexts: ["FENCED_CODE", "FENCED_CODE"] }, { regex: "(a+)+" }]) {
    invalid(withMarkdown([family(bad)]), JSON.stringify(bad));
  }
});

test("W1 policy: suppression records are narrow, expiring, and carry no secret value", () => {
  const ids = new Set(BUILTIN_SECRET_RULE_IDS);
  assert.equal(parseSuppression(suppression(), ids).ok, true);
  assert.equal(parseSuppression(suppression({ lineStart: 3, lineEnd: 5 }), ids).ok, true);
  for (const bad of [
    { ruleId: "PRIVATE_KEY_BLOCK" }, { ruleId: "NO_SUCH_RULE" }, { path: "docs/*.md" }, { path: "docs/**" }, { path: "../x" }, { path: "" },
    { lineStart: 5, lineEnd: 3 }, { lineStart: 1, lineEnd: null }, { lineStart: 0, lineEnd: 2 }, { classification: "REAL_SECRET" }, { classification: "" },
    { reason: "" }, { reason: "x".repeat(201) }, { reason: "leaked ghp_" + "A".repeat(36) }, { reviewRef: "" }, { reviewRef: "PR #1\n" },
    { fingerprint: "abc" }, { fingerprint: "F".repeat(64) }, { fingerprint: "f".repeat(63) }, { expires: "" }, { expires: null }, { expires: "2030-13-01" }, { expires: "2030-02-30" }, { expires: "soon" },
  ]) {
    assert.equal(parseSuppression(suppression(bad), ids).ok, false, JSON.stringify(bad));
  }
  const withExtra = { ...suppression(), value: "not-a-real-secret" };
  assert.equal(parseSuppression(withExtra, ids).ok, false, "a record can never carry a value field");
  const missing = suppression();
  delete missing.expires;
  assert.equal(parseSuppression(missing, ids).ok, false, "expiry is mandatory");
  invalid(basePolicy({ suppressions: [suppression({ ruleId: "PRIVATE_KEY_BLOCK" })] }), "policy with private-key suppression");
  invalid(basePolicy({ suppressions: Array.from({ length: 65 }, () => suppression()) }), "too many suppressions");
  invalid(basePolicy({ suppressionPolicy: { maxExpiryDays: 0 } }), "zero expiry");
  invalid(basePolicy({ suppressionPolicy: { maxExpiryDays: 400 } }), "excess expiry");
});

test("W1 policy: the built-in minimum is fail-closed and tighten-only", () => {
  assert.deepEqual([...BUILTIN_MINIMUM_POLICY.scope.allowedPathDomains], []);
  assert.deepEqual([...BUILTIN_MINIMUM_POLICY.suppressions], []);
  assert.deepEqual([...BUILTIN_MINIMUM_POLICY.secretRules], []);
  assert.deepEqual([...BUILTIN_MINIMUM_POLICY.scope.protectedPaths], [...BUILTIN_PROTECTED_PATHS]);
  assert.ok(BUILTIN_PROTECTED_PATHS.includes("governance/**") && BUILTIN_PROTECTED_PATHS.includes("scripts/governance/**") && BUILTIN_PROTECTED_PATHS.includes(".github/workflows/**"));
  assert.equal(Object.isFrozen(BUILTIN_MINIMUM_POLICY), true);
});

test("W1 policy: the digest is deterministic, key-order independent and changes with any field", () => {
  const a = validateBasePolicy(basePolicy()).policy;
  const b = validateBasePolicy(basePolicy()).policy;
  assert.equal(policyDigest(a), policyDigest(b));
  assert.match(policyDigest(a), /^[0-9a-f]{64}$/);
  const c = validateBasePolicy(basePolicy({ protectedTargetRefs: ["main", "dev"] })).policy;
  assert.notEqual(policyDigest(a), policyDigest(c));
});

test("W1 policy: the gate manifest path is derived by a framework rule from a valid gate ID only", () => {
  assert.equal(gateManifestPath("wave-gate"), "governance/manifests/wave-gate.json");
  for (const bad of ["", "Wave", "a", "../x", "a/b", "a b", "x".repeat(70), null, 5]) assert.equal(gateManifestPath(bad), null, String(bad));
});
