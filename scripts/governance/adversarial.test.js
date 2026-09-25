"use strict";

/**
 * GOV-AUTO-1 Wave 0 -- deliberate adversarial negative fixtures. Each case names
 * the fail-closed behavior it demonstrates. No fixture contains a real secret.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const g = require("./index");
const { record, domainRecord } = require("./test-support");

const MANIFESTS = nodePath.join(__dirname, "__fixtures__", "wave0", "manifests");
const load = (name) => g.parseManifestText(fs.readFileSync(nodePath.join(MANIFESTS, name), "utf8"));
const codes = (result) => result.findings.map((f) => f.reasonCode);

test("fixture 1: manifest missing dependsOn is a CONFIGURATION_ERROR (not an implicit [])", () => {
  assert.deepEqual(codes(load("missing-dependsOn.json")), ["DEPENDENCY_DECLARATION_MISSING"]);
});

test("fixture 2: manifest with a graph cycle is rejected", () => {
  assert.deepEqual(codes(load("cycle.json")), ["DEPENDENCY_CYCLE"]);
});

test("fixture 3: duplicate domain IDs are rejected", () => {
  assert.ok(codes(load("duplicate-domain.json")).includes("DOMAIN_DUPLICATE"));
});

test("fixture 4: dependency on a disabled domain is rejected", () => {
  assert.deepEqual(codes(load("disabled-dependency.json")), ["DEPENDENCY_DISABLED"]);
});

test("fixture 5: malformed schemaVersion tokens are rejected lexically", () => {
  for (const name of ["schema-version-01.json", "schema-version-1.0.json", "schema-version-0.json"]) {
    const r = load(name);
    assert.equal(r.valid, false, name);
    assert.equal(r.status, "CONFIGURATION_ERROR");
  }
});

test("fixture 6: schemaVersion as a string is rejected (no coercion)", () => {
  assert.deepEqual(codes(load("schema-version-string.json")), ["SCHEMA_VERSION_INVALID"]);
});

test("fixture 7: an invalid supported schema range is INCOMPLETE and never used for comparison", () => {
  const range = g.validateSupportedSchemaVersions({ minSupported: 4, maxSupported: 2 });
  assert.equal(range.ok, false);
  const outcome = g.classifySchemaCompatibility(range, g.validateSchemaVersion(undefined));
  assert.deepEqual({ status: outcome.status, reasonCode: outcome.reasonCode }, { status: "INCOMPLETE", reasonCode: "TARGET_SCHEMA_RANGE_INVALID" });
});

test("fixture 8: a malformed capability identity is rejected", () => {
  assert.deepEqual(codes(load("malformed-capability.json")), ["CAPABILITY_ID_INVALID"]);
  assert.equal(g.validateCapabilityId("dependency-aware-delta").ok, false);
});

test("fixture 9: a ../ path escape is rejected", () => {
  assert.throws(() => g.lexicalResolveWithin("/repo", "../etc/passwd", nodePath.posix), (e) => e.reasonCode === "UNSAFE_PATH");
});

test("fixture 10: a Windows path escape is rejected", () => {
  for (const p of ["..\\..\\Windows\\System32", "C:\\Windows\\win.ini", "\\\\server\\share\\x"]) {
    assert.throws(() => g.lexicalResolveWithin("C:\\repo", p, nodePath.win32), (e) => e.reasonCode === "UNSAFE_PATH", p);
  }
});

test("fixture 11: a shell-metacharacter argument stays inert data", async () => {
  const payload = "x; rm -rf / && echo pwned | tee /tmp/x `id` $(id)";
  const runner = g.createProcessRunner({ repositoryRoot: process.cwd(), allowedExecutables: [process.execPath] });
  const r = await runner.run({ file: process.execPath, args: ["-e", "process.stdout.write(process.argv[1])", payload] });
  assert.equal(r.stdout, payload);
});

test("fixture 12: oversized external command output is cut off and reported", async () => {
  const runner = g.createProcessRunner({ repositoryRoot: process.cwd(), allowedExecutables: [process.execPath] });
  const r = await runner.run({
    file: process.execPath,
    args: ["-e", "process.stdout.write('A'.repeat(3000000))"],
    maxStdoutBytes: 2048,
  });
  assert.equal(r.reasonCode, "PROCESS_OUTPUT_LIMIT");
  assert.ok(r.stdout.length <= 2048);
});

test("fixture 13: a duplicate domain-result record is never silently deduplicated", () => {
  const dups = [domainRecord("A_DOMAIN"), domainRecord("A_DOMAIN", "DEEP_REVIEW_REQUIRED")];
  const out = g.checkDomainResultCompleteness(dups, ["A_DOMAIN"], undefined, null);
  assert.ok(out.some((r) => r.reasonCode === "DOMAIN_RESULT_DUPLICATE" && r.status === "CONFIGURATION_ERROR"));
  const full = g.aggregate([record(), ...dups], { expectedDomainIds: ["A_DOMAIN"] });
  assert.equal(full.readiness.state, "NOT_READY");
  assert.ok(full.kernelRecords.some((r) => r.reasonCode === "DUPLICATE_CHECK_ID"));
});

test("fixture 14: an unknown status injected at runtime never becomes PASS or READY", () => {
  for (const status of ["OK", "SUCCESS", "GREEN", "pass", "", null, undefined, 1, true]) {
    const out = g.aggregate([record(), { ...record({ checkId: "1A.INJECTED" }), status }]);
    assert.equal(out.readiness.state, "NOT_READY", String(status));
    assert.equal(out.overallStatus, "CONFIGURATION_ERROR", String(status));
  }
});

test("end to end: manifest -> graph -> domain results -> aggregation stays fail-closed", () => {
  const manifest = load("valid-minimal.json");
  assert.equal(manifest.valid, true);
  const expected = manifest.manifest.domains.filter((d) => d.enabled).map((d) => d.domainId);
  const complete = g.aggregate([record(), domainRecord("A_DOMAIN"), domainRecord("B_DOMAIN")], { expectedDomainIds: expected });
  assert.equal(complete.readiness.state, "READY");
  const partial = g.aggregate([record(), domainRecord("A_DOMAIN")], { expectedDomainIds: expected });
  assert.equal(partial.readiness.state, "NOT_READY");
});

test("public API boundary: internals are not exported and the surface is frozen", () => {
  assert.equal(Object.isFrozen(g), true);
  for (const internal of ["parseStrictJson", "RawNumber", "isRawNumber", "deepFreeze", "canonicalJson", "cloneJson", "isJsonValue", "parsePositiveInteger"]) {
    assert.equal(internal in g, false, internal);
  }
  for (const pub of ["validateManifest", "validateGraph", "aggregate", "validateResultRecord", "resolveWithinRoot", "createProcessRunner", "redactString"]) {
    assert.equal(typeof g[pub], "function", pub);
  }
  assert.equal("runProcess" in g, false, "the request-authorized runner was replaced by the policy-bound runner");
});

test("package surface: governance code is not published and package exports are unchanged", () => {
  const pkg = JSON.parse(fs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8"));
  assert.equal(pkg.files.some((f) => f.includes("governance")), false);
  assert.equal(JSON.stringify(pkg.exports).includes("governance"), false);
  assert.equal(pkg.main, "scripts/ai/index.js");
});
