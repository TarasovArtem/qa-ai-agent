"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../index");
const { RawNumber } = require("./validation");

function manifestText(schemaToken) {
  return `{"schemaVersion":${schemaToken},"gateId":"example-gate","requiredCapabilities":[],"domains":[]}`;
}

test("schemaVersion: positive base-10 integer tokens are accepted lexically", () => {
  for (const token of ["1", "2", "10", "123", "999999999"]) {
    const r = g.parseManifestText(manifestText(token));
    assert.equal(r.valid, true, token);
    assert.equal(r.manifest.schemaVersion, Number(token));
  }
});

test("schemaVersion: malformed lexical forms are rejected before any numeric use", () => {
  const cases = ["0", "-1", "+1", "01", "1.0", "1.2.3", "1e0", "1E2", "10000000000", '"2"', '"02"', '"2foo"', '" 2"', '"2 "', '"v2"', "null", "true", "[]", "{}", "1.5", "-0"];
  for (const token of cases) {
    const r = g.parseManifestText(manifestText(token));
    assert.equal(r.valid, false, token);
    assert.equal(r.status, "CONFIGURATION_ERROR", token);
    assert.ok(["SCHEMA_VERSION_INVALID", "MANIFEST_JSON_INVALID"].includes(r.findings[0].reasonCode), `${token}: ${r.findings[0].reasonCode}`);
  }
});

test("schemaVersion: a plain JavaScript number cannot be lexically validated and is rejected", () => {
  assert.equal(g.validateSchemaVersion(1).ok, false);
  assert.equal(g.validateSchemaVersion(new RawNumber("1")).ok, true);
  assert.equal(g.validateSchemaVersion(new RawNumber("1.0")).ok, false);
  assert.equal(g.validateSchemaVersion(new RawNumber("01")).ok, false);
  assert.equal(g.validateSchemaVersion(undefined).reasonCode, "SCHEMA_VERSION_MISSING");
});

test("supportedSchemaVersions: a valid range is exposed frozen and unchanged", () => {
  const r = g.validateSupportedSchemaVersions({ minSupported: 1, maxSupported: 3 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.range, { minSupported: 1, maxSupported: 3 });
  assert.equal(Object.isFrozen(r.range), true);
  assert.equal(g.validateSupportedSchemaVersions({ minSupported: 3, maxSupported: 3 }).ok, true);
  assert.equal(g.validateSupportedSchemaVersions({ minSupported: new RawNumber("2"), maxSupported: new RawNumber("5") }).ok, true);
});

test("supportedSchemaVersions: absent container or bound is INCOMPLETE/UNAVAILABLE", () => {
  for (const input of [undefined, {}, { minSupported: 1 }, { maxSupported: 3 }]) {
    const r = g.validateSupportedSchemaVersions(input);
    assert.equal(r.ok, false);
    assert.equal(r.status, "INCOMPLETE");
    assert.equal(r.reasonCode, "TARGET_SCHEMA_RANGE_UNAVAILABLE");
  }
});

test("supportedSchemaVersions: wrong container, wrong fields, bad bounds and min > max are INCOMPLETE/INVALID", () => {
  const inputs = [
    null, "1..3", [], 3, true,
    { minSupported: 1, maxSupported: 3, extra: 1 },
    { minSupported: 1, maximumSupported: 3 },
    { minSupported: 0, maxSupported: 3 },
    { minSupported: -1, maxSupported: 3 },
    { minSupported: 1.5, maxSupported: 3 },
    { minSupported: "1", maxSupported: 3 },
    { minSupported: null, maxSupported: 3 },
    { minSupported: 1, maxSupported: true },
    { minSupported: 1, maxSupported: [] },
    { minSupported: 1, maxSupported: {} },
    { minSupported: NaN, maxSupported: 3 },
    { minSupported: 1, maxSupported: 10000000000 },
    { minSupported: new RawNumber("1.0"), maxSupported: 3 },
    { minSupported: 5, maxSupported: 2 },
  ];
  for (const input of inputs) {
    const r = g.validateSupportedSchemaVersions(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.equal(r.status, "INCOMPLETE");
    assert.equal(r.reasonCode, "TARGET_SCHEMA_RANGE_INVALID", JSON.stringify(input));
  }
});

test("schema compatibility: the target range is validated first and never compared when invalid", () => {
  const version = (n) => g.validateSchemaVersion(new RawNumber(String(n)));
  const range = g.validateSupportedSchemaVersions({ minSupported: 1, maxSupported: 3 });
  assert.deepEqual(g.classifySchemaCompatibility(range, version(2)), { status: "PASS", reasonCode: "OK", acceptedSchemaVersion: 2 });
  assert.equal(g.classifySchemaCompatibility(range, version(4)).reasonCode, "CAPABILITY_UNAVAILABLE_ON_TARGET");
  assert.equal(g.classifySchemaCompatibility(range, version(4)).status, "INCOMPLETE");
  const narrow = g.validateSupportedSchemaVersions({ minSupported: 2, maxSupported: 3 });
  assert.equal(g.classifySchemaCompatibility(narrow, version(1)).status, "CONFIGURATION_ERROR");
  assert.equal(g.classifySchemaCompatibility(narrow, version(1)).reasonCode, "SCHEMA_VERSION_BELOW_MINIMUM");
  assert.equal(g.classifySchemaCompatibility(range, g.validateSchemaVersion(undefined)).reasonCode, "SCHEMA_VERSION_MISSING");
  assert.equal(g.classifySchemaCompatibility(range, g.validateSchemaVersion(new RawNumber("01"))).reasonCode, "SCHEMA_VERSION_INVALID");
  // min = 5, max = 2, manifest = 3 must stop at the invalid range.
  const reversed = g.validateSupportedSchemaVersions({ minSupported: 5, maxSupported: 2 });
  const outcome = g.classifySchemaCompatibility(reversed, version(3));
  assert.equal(outcome.status, "INCOMPLETE");
  assert.equal(outcome.reasonCode, "TARGET_SCHEMA_RANGE_INVALID");
  const missing = g.classifySchemaCompatibility(g.validateSupportedSchemaVersions(undefined), version(1));
  assert.equal(missing.reasonCode, "TARGET_SCHEMA_RANGE_UNAVAILABLE");
});

test("capability identities: capability-id@major, exact, no coercion", () => {
  for (const id of ["dependency-aware-delta@1", "ab@9999", "ci-post-run-evidence@12"]) {
    const r = g.validateCapabilityId(id);
    assert.equal(r.ok, true, id);
  }
  assert.equal(g.validateCapabilityId("dependency-aware-delta@1").major, 1);
  const bad = [
    "foo", "foo@", "@1", "foo@unknown", "foo@0", "foo@01", "foo@1.5", "foo@10000", "Foo@1", "foo bar@1", " foo@1", "foo@1 ", "f@1",
    "foo@1@2", "foo_bar@1", "1foo@1", "foo@-1", 1, null, undefined, {}, [], "a".repeat(70) + "@1",
  ];
  for (const id of bad) assert.equal(g.validateCapabilityId(id).ok, false, String(id));
  assert.notEqual(g.validateCapabilityId("foo-bar@1").id, g.validateCapabilityId("foo-bar@2").id);
});

test("framework metadata: a complete valid contract is accepted and frozen", () => {
  const meta = { frameworkVersion: "0.1.0", supportedCapabilities: ["dependency-aware-delta@1"], supportedSchemaVersions: { minSupported: 1, maxSupported: 1 } };
  const r = g.validateFrameworkMetadata(meta);
  assert.equal(r.ok, true);
  assert.equal(Object.isFrozen(r.metadata), true);
  assert.deepEqual(r.metadata.supportedSchemaVersions, { minSupported: 1, maxSupported: 1 });
});

test("framework metadata: every malformed shape is rejected fail-closed", () => {
  const base = { frameworkVersion: "0.1.0", supportedCapabilities: [], supportedSchemaVersions: { minSupported: 1, maxSupported: 2 } };
  const variants = [
    null, [], "x",
    { ...base, extra: 1 },
    { ...base, frameworkVersion: "v1" },
    { ...base, frameworkVersion: 1 },
    { ...base, supportedCapabilities: "foo@1" },
    { ...base, supportedCapabilities: ["foo"] },
    { ...base, supportedCapabilities: ["foo@1", "foo@1"] },
    { ...base, supportedSchemaVersions: undefined },
    { ...base, supportedSchemaVersions: { minSupported: 3, maxSupported: 1 } },
  ];
  for (const meta of variants) assert.equal(g.validateFrameworkMetadata(meta).ok, false, JSON.stringify(meta));
  const missingRange = g.validateFrameworkMetadata({ frameworkVersion: "0.1.0", supportedCapabilities: [] });
  assert.ok(missingRange.findings.some((f) => f.reasonCode === "TARGET_SCHEMA_RANGE_UNAVAILABLE"));
});

test("validation does not mutate caller input", () => {
  const meta = { frameworkVersion: "0.1.0", supportedCapabilities: ["foo-bar@1"], supportedSchemaVersions: { minSupported: 1, maxSupported: 2 } };
  const before = JSON.stringify(meta);
  g.validateFrameworkMetadata(meta);
  assert.equal(JSON.stringify(meta), before);
  assert.equal(Object.isFrozen(meta), false);
});
