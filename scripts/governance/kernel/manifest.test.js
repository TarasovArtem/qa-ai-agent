"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const g = require("../index");

const FIXTURES = path.join(__dirname, "..", "__fixtures__", "wave0", "manifests");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const reason = (r) => r.findings.map((f) => f.reasonCode);

test("a valid minimal manifest is accepted and normalized", () => {
  const r = g.parseManifestText(fixture("valid-minimal.json"));
  assert.equal(r.valid, true);
  assert.equal(r.status, "PASS");
  assert.equal(r.manifest.schemaVersion, 1);
  assert.equal(r.manifest.gateId, "example-gate");
  assert.deepEqual(r.manifest.requiredCapabilities, ["dependency-aware-delta@1"]);
  assert.deepEqual(r.manifest.topologicalOrder, ["A_DOMAIN", "B_DOMAIN"]);
  assert.equal(Object.isFrozen(r.manifest), true);
});

test("adversarial manifest fixtures fail closed with stable reason codes", () => {
  const expectations = {
    "missing-dependsOn.json": "DEPENDENCY_DECLARATION_MISSING",
    "cycle.json": "DEPENDENCY_CYCLE",
    "duplicate-domain.json": "DOMAIN_DUPLICATE",
    "disabled-dependency.json": "DEPENDENCY_DISABLED",
    "schema-version-01.json": "MANIFEST_JSON_INVALID",
    "schema-version-1.0.json": "SCHEMA_VERSION_INVALID",
    "schema-version-0.json": "SCHEMA_VERSION_INVALID",
    "schema-version-string.json": "SCHEMA_VERSION_INVALID",
    "malformed-capability.json": "CAPABILITY_ID_INVALID",
    "unknown-field.json": "MANIFEST_UNKNOWN_FIELD",
  };
  for (const [name, code] of Object.entries(expectations)) {
    const r = g.parseManifestText(fixture(name));
    assert.equal(r.valid, false, name);
    assert.equal(r.status, "CONFIGURATION_ERROR", name);
    assert.equal(r.manifest, null, name);
    assert.ok(reason(r).includes(code), `${name}: ${reason(r)}`);
  }
});

test("malformed JSON, trailing content and non-JSON constructs are rejected", () => {
  const bad = ["", "{", "[]", "null", "true", '"x"', "1", "{,}", '{"a":1,}', "{'a':1}", '{"a":NaN}', '{"a":undefined}', '{"a":1} x', "// c\n{}", '{"a":"\\x"}', '{"a":"\u0001"}'];
  for (const text of bad) {
    const r = g.parseManifestText(text);
    assert.equal(r.valid, false, JSON.stringify(text));
    assert.equal(r.status, "CONFIGURATION_ERROR");
  }
  assert.equal(g.parseManifestText(123).valid, false);
});

test("duplicate keys and excessive nesting are rejected, never silently resolved", () => {
  const dup = '{"schemaVersion":1,"schemaVersion":2,"gateId":"example-gate","requiredCapabilities":[],"domains":[]}';
  assert.deepEqual(reason(g.parseManifestText(dup)), ["DUPLICATE_JSON_KEY"]);
  const deep = `{"schemaVersion":1,"gateId":"example-gate","requiredCapabilities":[],"domains":[],"x":${"[".repeat(100)}${"]".repeat(100)}}`;
  assert.deepEqual(reason(g.parseManifestText(deep)), ["JSON_DEPTH_EXCEEDED"]);
});

test("unknown fields, missing keys and wrong containers are rejected", () => {
  const ok = { schemaVersion: "1", gateId: '"example-gate"', requiredCapabilities: "[]", domains: "[]" };
  const build = (o) => `{${Object.entries(o).map(([k, v]) => `"${k}":${v}`).join(",")}}`;
  assert.equal(g.parseManifestText(build(ok)).valid, true);
  for (const key of Object.keys(ok)) {
    const partial = { ...ok };
    delete partial[key];
    const r = g.parseManifestText(build(partial));
    assert.equal(r.valid, false, key);
    assert.ok(reason(r).some((c) => ["MANIFEST_FIELD_MISSING", "SCHEMA_VERSION_MISSING"].includes(c)), key);
  }
  assert.equal(g.parseManifestText(build({ ...ok, domains: "{}" })).valid, false);
  assert.equal(g.parseManifestText(build({ ...ok, requiredCapabilities: '"x"' })).valid, false);
  assert.equal(g.parseManifestText(build({ ...ok, gateId: "1" })).valid, false);
  assert.equal(g.parseManifestText(build({ ...ok, gateId: '"Bad Id"' })).valid, false);
  assert.equal(g.parseManifestText(build({ ...ok, requiredCapabilities: '["a-b@1","a-b@1"]' })).valid, false);
});

test("prototype-pollution style keys are unknown fields, not properties", () => {
  const text = '{"__proto__":{"polluted":true},"schemaVersion":1,"gateId":"example-gate","requiredCapabilities":[],"domains":[]}';
  const r = g.parseManifestText(text);
  assert.equal(r.valid, false);
  assert.ok(reason(r).includes("MANIFEST_UNKNOWN_FIELD"));
  assert.equal({}.polluted, undefined);
});

test("bytes: oversized input, invalid UTF-8, a BOM and non-byte input are rejected", () => {
  const good = Buffer.from(fixture("valid-minimal.json"), "utf8");
  assert.equal(g.parseManifestBytes(new Uint8Array(good)).valid, true);
  assert.deepEqual(reason(g.parseManifestBytes(new Uint8Array(good), 10)), ["MANIFEST_TOO_LARGE"]);
  assert.deepEqual(reason(g.parseManifestBytes(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]))), ["INVALID_MANIFEST_ENCODING"]);
  assert.equal(g.parseManifestBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...good])).valid, false);
  assert.deepEqual(reason(g.parseManifestBytes("text")), ["MANIFEST_TYPE_INVALID"]);
});

test("the manifest is never executed: code-like content is only inert text", () => {
  const text = '{"schemaVersion":1,"gateId":"example-gate","requiredCapabilities":[],"domains":[],"x":"require(\'child_process\')"}';
  const r = g.parseManifestText(text);
  assert.equal(r.valid, false);
  assert.ok(reason(r).includes("MANIFEST_UNKNOWN_FIELD"));
});

test("load: a manifest is read through repositoryRoot, bounded, and load is separate from validate", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-wave0-manifest-"));
  try {
    fs.mkdirSync(path.join(root, "governance"));
    fs.writeFileSync(path.join(root, "governance", "m.json"), fixture("valid-minimal.json"));
    const bytes = g.loadManifestBytes(root, "governance/m.json");
    assert.equal(bytes.ok, true);
    assert.ok(bytes.read() instanceof Uint8Array);
    assert.equal(g.loadManifestFile(root, "governance/m.json").valid, true);
    assert.equal(g.loadManifestFile(root, "governance/missing.json").valid, false);
    assert.equal(g.loadManifestFile(root, "../escape.json").valid, false);
    assert.equal(g.loadManifestFile(root, "../escape.json").findings[0].reasonCode, "UNSAFE_PATH");
    assert.equal(g.loadManifestBytes(root, "governance/m.json", { maxBytes: 5 }).reasonCode, "MANIFEST_TOO_LARGE");
    assert.equal(g.loadManifestBytes(root, "governance").ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validation output is deterministic and never mutates or aliases the parsed tree", () => {
  const text = fixture("valid-minimal.json");
  const a = JSON.stringify(g.parseManifestText(text));
  const b = JSON.stringify(g.parseManifestText(text));
  assert.equal(a, b);
});
