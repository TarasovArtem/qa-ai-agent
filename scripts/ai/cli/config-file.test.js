"use strict";

/**
 * Controlled-v1 qa-agent.config.json v1 contract (TDD step 1): bounded,
 * open-once read; BOM and duplicate-key refusal; closed schema; embedded
 * validators; detached frozen snapshot; root/path containment.
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { assertValidRepositoryRoot } = require("../repository-root");
const { EXIT_CODES } = require("./errors");
const { CONFIG_FILE_NAME, MAX_CONFIG_BYTES, loadConfig, readConfigText, parseConfigText, validateConfig } = require("./config-file");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "qa-agent-config-"));
after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

let counter = 0;
function makeRoot() {
  const dir = path.join(SCRATCH, `root-${++counter}`);
  fs.mkdirSync(dir);
  return dir;
}

function baseConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectProfile: { id: "acme-web", displayName: "Acme web storefront", knownProjectConstraints: ["Checkout needs a seeded account."] },
    framework: "playwright",
    ...overrides,
  };
}

function writeConfig(dir, value, name = CONFIG_FILE_NAME) {
  const text = typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2);
  fs.writeFileSync(path.join(dir, name), text);
}

function load(dir, configPath) {
  return loadConfig({ root: assertValidRepositoryRoot(dir, "test"), configPath });
}

function expectCode(fn, code, exitCode = EXIT_CODES.CONFIGURATION) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `expected ${code} to be thrown`);
  assert.equal(caught.code, code, `got ${caught.code}: ${caught.message}`);
  assert.equal(caught.exitCode, exitCode);
  return caught;
}

function canSymlink() {
  const probe = path.join(SCRATCH, `symlink-probe-${++counter}`);
  try {
    fs.symlinkSync(SCRATCH, probe, "dir");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
const SYMLINKS = canSymlink();

// --- happy path ----------------------------------------------------------------

test("config v1: a minimal valid config yields a frozen, detached snapshot with documented defaults", () => {
  const dir = makeRoot();
  writeConfig(dir, baseConfig());
  const { config, configRelPath } = load(dir);
  assert.equal(configRelPath, CONFIG_FILE_NAME);
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.framework, "playwright");
  assert.deepEqual(config.capabilities, { triage: false, design: false, plan: false, generate: false, reviewRecord: false, apply: false, execute: false });
  assert.deepEqual(config.providers.allow, ["mock"]);
  assert.equal(config.output.dir, "reports/qa-agent");
  assert.equal(config.requirements, null);
  assert.equal(config.frameworkRuntime, null);
  assert.equal(config.knowledge, null);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.projectProfile));
  assert.ok(Object.isFrozen(config.projectProfile.knownProjectConstraints));
  assert.ok(Object.isFrozen(config.capabilities));
  assert.ok(Object.isFrozen(config.providers.allow));
  assert.throws(() => {
    "use strict";
    config.framework = "cypress";
  }, TypeError);
});

test("config v1: a fully populated config validates every embedded contract", () => {
  const dir = makeRoot();
  writeConfig(
    dir,
    baseConfig({
      frameworkRuntime: {
        schemaVersion: 1,
        projectId: "acme-web",
        framework: "playwright",
        frameworkConfigPath: "playwright.config.js",
        testSourceRoot: "e2e",
        reports: { reportFile: "reports/playwright/results.json" },
        historyWorkflowFile: "e2e.yml",
      },
      knowledge: { projectId: "acme-web", projectKnowledgeUnitsDir: "qa/knowledge" },
      requirements: { source: "file", path: "qa/requirements.json" },
      capabilities: { triage: true, apply: true },
      providers: { allow: ["mock", "groq"] },
      output: { dir: "out/qa-agent" },
    })
  );
  const { config } = load(dir);
  assert.equal(config.frameworkRuntime.testSourceRoot, "e2e");
  assert.equal(config.knowledge.projectKnowledgeUnitsDir, "qa/knowledge");
  assert.deepEqual({ ...config.requirements }, { source: "file", path: "qa/requirements.json" });
  assert.equal(config.capabilities.triage, true);
  assert.equal(config.capabilities.apply, true, "a known-but-release-disabled capability is schema-valid");
  assert.deepEqual([...config.providers.allow], ["mock", "groq"]);
  assert.equal(config.output.dir, "out/qa-agent");
});

test("config v1: providers.allow may be empty (a ceiling that forbids every provider)", () => {
  const dir = makeRoot();
  writeConfig(dir, baseConfig({ providers: { allow: [] } }));
  assert.deepEqual([...load(dir).config.providers.allow], []);
});

// --- size bound (open once, bounded read) ---------------------------------------

test("config v1 size: a file of exactly 64 KiB is accepted", () => {
  const dir = makeRoot();
  const json = JSON.stringify(baseConfig());
  const padded = json + " ".repeat(MAX_CONFIG_BYTES - Buffer.byteLength(json));
  assert.equal(Buffer.byteLength(padded), MAX_CONFIG_BYTES);
  writeConfig(dir, padded);
  assert.equal(load(dir).config.framework, "playwright");
});

test("config v1 size: a file of 64 KiB + 1 byte is refused before parsing", () => {
  const dir = makeRoot();
  const json = JSON.stringify(baseConfig());
  writeConfig(dir, json + " ".repeat(MAX_CONFIG_BYTES + 1 - Buffer.byteLength(json)));
  expectCode(() => load(dir), "CONFIG_TOO_LARGE");
});

test("config v1 size: a much larger file is refused and its content never reaches the message", () => {
  const dir = makeRoot();
  writeConfig(dir, `{"x":"${"SENTINEL_BIG_CONFIG".repeat(10000)}"}`);
  const err = expectCode(() => load(dir), "CONFIG_TOO_LARGE");
  assert.doesNotMatch(err.message, /SENTINEL_BIG_CONFIG/);
});

// --- encoding / BOM / parse ---------------------------------------------------------

test("config v1 encoding: a UTF-8 BOM is refused (one deterministic rule: never stripped)", () => {
  const dir = makeRoot();
  writeConfig(dir, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(baseConfig()))]));
  expectCode(() => load(dir), "CONFIG_BOM_REFUSED");
});

test("config v1 encoding: a UTF-16 BOM is refused", () => {
  const dir = makeRoot();
  writeConfig(dir, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(baseConfig()), "utf16le")]));
  expectCode(() => load(dir), "CONFIG_BOM_REFUSED");
});

test("config v1 encoding: invalid UTF-8 is refused", () => {
  const dir = makeRoot();
  writeConfig(dir, Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d]));
  expectCode(() => load(dir), "CONFIG_ENCODING_INVALID");
});

test("config v1 parse: malformed JSON is refused without echoing content", () => {
  const dir = makeRoot();
  writeConfig(dir, '{"schemaVersion": 1, "SENTINEL_MALFORMED": }');
  const err = expectCode(() => load(dir), "CONFIG_PARSE_ERROR");
  assert.doesNotMatch(err.message, /SENTINEL_MALFORMED/);
});

test("config v1 parse: non-standard JSON (comments, trailing commas, single quotes, NaN) is refused", () => {
  for (const text of ['{"a":1,}', "{'a':1}", '{"a":1} // c', '{"a":NaN}', '{"a":01}', '{"a":"\t"}', "", "   ", '{"a":1} {"b":2}']) {
    assert.throws(() => parseConfigText(text), (err) => err.code === "CONFIG_PARSE_ERROR", JSON.stringify(text));
  }
});

test("config v1 parse: duplicate keys are refused at every depth", () => {
  for (const text of [
    '{"schemaVersion":1,"schemaVersion":1}',
    '{"projectProfile":{"id":"a","id":"b"}}',
    '{"capabilities":{"triage":true,"triage":false}}',
    '{"a":[{"k":1,"k":2}]}',
  ]) {
    assert.throws(() => parseConfigText(text), (err) => err.code === "CONFIG_DUPLICATE_KEY", text);
  }
});

test("config v1 parse: duplicate-key detection compares decoded key text", () => {
  assert.throws(() => parseConfigText('{"framework":"a","fr\\u0061mework":"b"}'), (err) => err.code === "CONFIG_DUPLICATE_KEY");
});

test("config v1 parse: prototype-sensitive keys are refused before any object is built", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    assert.throws(() => parseConfigText(`{"${key}":{"polluted":true}}`), (err) => err.code === "CONFIG_FORBIDDEN_KEY", key);
  }
  assert.equal({}.polluted, undefined);
});

test("config v1 parse: nesting beyond the bound is refused", () => {
  assert.throws(() => parseConfigText(`${"[".repeat(100)}${"]".repeat(100)}`), (err) => err.code === "CONFIG_PARSE_ERROR");
});

// --- closed schema --------------------------------------------------------------------

test("config v1 schema: unknown top-level property is refused", () => {
  const dir = makeRoot();
  writeConfig(dir, baseConfig({ telemetry: true }));
  const err = expectCode(() => load(dir), "CONFIG_SCHEMA_INVALID");
  assert.match(err.message, /telemetry/);
});

test("config v1 schema: a secret-like unexpected property is refused and its value never echoed", () => {
  const dir = makeRoot();
  writeConfig(dir, baseConfig({ apiKey: "SENTINEL_CONFIG_SECRET", providers: { allow: ["mock"], token: "SENTINEL_CONFIG_TOKEN" } }));
  const err = expectCode(() => load(dir), "CONFIG_SCHEMA_INVALID");
  assert.doesNotMatch(err.message, /SENTINEL_CONFIG_SECRET|SENTINEL_CONFIG_TOKEN/);
});

test("config v1 schema: hostile key text is never echoed verbatim", () => {
  const out = expectCode(() => validateConfig(parseConfigText(`{"schemaVersion":1,"${"K".repeat(500)}\\u0007":1}`), {}), "CONFIG_SCHEMA_INVALID");
  assert.ok(out.message.length <= 600);
  assert.doesNotMatch(out.message, /K{100}/);
});

test("config v1 schema: schemaVersion must be exactly the integer 1", () => {
  for (const schemaVersion of [2, "1", 1.5, null, true]) {
    assert.throws(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ schemaVersion }))), {}), (err) => err.code === "CONFIG_SCHEMA_INVALID");
  }
  const missing = baseConfig();
  delete missing.schemaVersion;
  assert.throws(() => validateConfig(parseConfigText(JSON.stringify(missing)), {}), (err) => err.code === "CONFIG_SCHEMA_INVALID");
});

test("config v1 schema: the top level must be an object", () => {
  for (const text of ["[]", "1", '"x"', "null"]) {
    assert.throws(() => validateConfig(parseConfigText(text), {}), (err) => err.code === "CONFIG_SCHEMA_INVALID", text);
  }
});

test("config v1 schema: framework is required and closed to cypress|playwright", () => {
  for (const framework of [undefined, "selenium", "Cypress", ""]) {
    const value = baseConfig({ framework });
    if (framework === undefined) delete value.framework;
    assert.throws(() => validateConfig(parseConfigText(JSON.stringify(value)), {}), (err) => err.code === "CONFIG_SCHEMA_INVALID", String(framework));
  }
});

test("config v1 schema: projectProfile is validated by the existing strict ProjectProfile contract", () => {
  const bad = baseConfig({ projectProfile: { id: "acme-web", displayName: "x", knownProjectConstraints: [], extra: 1 } });
  const err = expectCode(() => validateConfig(parseConfigText(JSON.stringify(bad)), {}), "CONFIG_EMBEDDED_CONTRACT_INVALID");
  assert.match(err.message, /PROJECT_PROFILE_INVALID/);
  const missing = baseConfig();
  delete missing.projectProfile;
  expectCode(() => validateConfig(parseConfigText(JSON.stringify(missing)), {}), "CONFIG_SCHEMA_INVALID");
});

test("config v1 schema: frameworkRuntime/knowledge use the existing validators and must bind to the config's project and framework", () => {
  const runtime = {
    schemaVersion: 1,
    projectId: "acme-web",
    framework: "playwright",
    frameworkConfigPath: "playwright.config.js",
    testSourceRoot: "playwright",
    reports: { reportFile: "r.json" },
    historyWorkflowFile: "e2e.yml",
  };
  expectCode(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ frameworkRuntime: {} }))), {}), "CONFIG_EMBEDDED_CONTRACT_INVALID");
  expectCode(
    () => validateConfig(parseConfigText(JSON.stringify(baseConfig({ frameworkRuntime: { ...runtime, projectId: "other" } }))), {}),
    "CONFIG_SEMANTIC_INVALID"
  );
  expectCode(
    () =>
      validateConfig(
        parseConfigText(JSON.stringify(baseConfig({ frameworkRuntime: { ...runtime, framework: "cypress", reports: { reportsDir: "r", screenshotsDir: "s" } } }))),
        {}
      ),
    "CONFIG_SEMANTIC_INVALID"
  );
  expectCode(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ knowledge: { projectId: "other" } }))), {}), "CONFIG_SEMANTIC_INVALID");
  expectCode(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ knowledge: { projectId: "acme-web", x: 1 } }))), {}), "CONFIG_EMBEDDED_CONTRACT_INVALID");
});

test("config v1 schema: capabilities are a closed set of booleans", () => {
  expectCode(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ capabilities: { autonomy: true } }))), {}), "CONFIG_SCHEMA_INVALID");
  expectCode(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ capabilities: { triage: "yes" } }))), {}), "CONFIG_SCHEMA_INVALID");
  expectCode(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ capabilities: [] }))), {}), "CONFIG_SCHEMA_INVALID");
});

test("config v1 schema: providers.allow is a closed, duplicate-free vocabulary of shipped providers", () => {
  for (const allow of [["openai"], ["mock", "mock"], "mock", [1], ["MOCK"]]) {
    assert.throws(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ providers: { allow } }))), {}), (err) => err.code === "CONFIG_SCHEMA_INVALID", JSON.stringify(allow));
  }
});

test("config v1 schema: requirements.source is closed to file and requirements.path is a safe repository-relative .json path", () => {
  for (const requirements of [
    { source: "jira", path: "r.json" },
    { source: "file" },
    { source: "file", path: "../r.json" },
    { source: "file", path: "/abs/r.json" },
    { source: "file", path: "C:\\r.json" },
    { source: "file", path: "a\\..\\..\\r.json" },
    { source: "file", path: "r.yaml" },
    { source: "file", path: "./r.json" },
    { source: "file", path: "a//r.json" },
    { source: "file", path: "r.json", extra: 1 },
  ]) {
    assert.throws(
      () => validateConfig(parseConfigText(JSON.stringify(baseConfig({ requirements }))), {}),
      (err) => err.code === "CONFIG_SCHEMA_INVALID" || err.code === "CONFIG_PATH_INVALID",
      JSON.stringify(requirements)
    );
  }
});

test("config v1 schema: output.dir must not overlap .git, node_modules, framework source prefixes or the config file", () => {
  const configRelPath = "qa-agent.config.json";
  for (const dir of [".", "", ".git", ".git/x", "node_modules", "node_modules/qa", "cypress", "cypress/out", "playwright", "Playwright/out", "qa-agent.config.json", "..", "../out", "/tmp/out", "a/../b", "e2e/out"]) {
    assert.throws(
      () =>
        validateConfig(
          parseConfigText(
            JSON.stringify(
              baseConfig({
                output: { dir },
                frameworkRuntime: {
                  schemaVersion: 1,
                  projectId: "acme-web",
                  framework: "playwright",
                  frameworkConfigPath: "playwright.config.js",
                  testSourceRoot: "e2e",
                  reports: { reportFile: "r.json" },
                  historyWorkflowFile: "e2e.yml",
                },
              })
            )
          ),
          { configRelPath }
        ),
      (err) => err.code === "CONFIG_PATH_INVALID" || err.code === "CONFIG_SCHEMA_INVALID",
      dir
    );
  }
  assert.throws(() => validateConfig(parseConfigText(JSON.stringify(baseConfig({ output: { dir: "cfg" } }))), { configRelPath: "cfg/qa-agent.config.json" }), (err) => err.code === "CONFIG_PATH_INVALID");
  assert.equal(validateConfig(parseConfigText(JSON.stringify(baseConfig({ output: { dir: "reports/qa" } }))), { configRelPath }).output.dir, "reports/qa");
});

// --- file object / containment ----------------------------------------------------------

test("config v1 file: a missing config file is a configuration error", () => {
  expectCode(() => load(makeRoot()), "CONFIG_NOT_FOUND");
});

test("config v1 file: a directory in place of the config file is refused", () => {
  const dir = makeRoot();
  fs.mkdirSync(path.join(dir, CONFIG_FILE_NAME));
  expectCode(() => load(dir), "CONFIG_NOT_REGULAR_FILE");
});

test("config v1 file: --config outside the root is refused lexically", () => {
  const dir = makeRoot();
  const outside = makeRoot();
  writeConfig(outside, baseConfig());
  expectCode(() => load(dir, path.join(outside, CONFIG_FILE_NAME)), "CONFIG_OUTSIDE_ROOT");
  expectCode(() => load(dir, `../${path.basename(outside)}/${CONFIG_FILE_NAME}`), "CONFIG_OUTSIDE_ROOT");
});

test("config v1 file: --config inside the root is honored", () => {
  const dir = makeRoot();
  fs.mkdirSync(path.join(dir, "cfg"));
  writeConfig(path.join(dir, "cfg"), baseConfig(), "custom.json");
  const { configRelPath } = load(dir, "cfg/custom.json");
  assert.equal(configRelPath, "cfg/custom.json");
});

test("config v1 file: a symlinked config leaf is refused even when it points inside the root", (t) => {
  if (!SYMLINKS) return t.skip("symlinks unavailable on this host");
  const dir = makeRoot();
  writeConfig(dir, baseConfig(), "real.json");
  fs.symlinkSync(path.join(dir, "real.json"), path.join(dir, CONFIG_FILE_NAME), "file");
  expectCode(() => load(dir), "CONFIG_SYMLINK_REFUSED");
});

test("config v1 file: a config replaced by a symlink to an outside file is refused and the outside file is never read", (t) => {
  if (!SYMLINKS) return t.skip("symlinks unavailable on this host");
  const dir = makeRoot();
  const outside = makeRoot();
  writeConfig(outside, { SENTINEL_OUTSIDE: true }, "victim.json");
  writeConfig(dir, baseConfig());
  fs.rmSync(path.join(dir, CONFIG_FILE_NAME));
  fs.symlinkSync(path.join(outside, "victim.json"), path.join(dir, CONFIG_FILE_NAME), "file");
  const err = expectCode(() => load(dir), "CONFIG_SYMLINK_REFUSED");
  assert.doesNotMatch(err.message, /SENTINEL_OUTSIDE/);
});

test("config v1 file: a config reached through a symlinked directory escaping the root is refused", (t) => {
  if (!SYMLINKS) return t.skip("symlinks unavailable on this host");
  const dir = makeRoot();
  const outside = makeRoot();
  writeConfig(outside, baseConfig(), "c.json");
  fs.symlinkSync(outside, path.join(dir, "linked"), "dir");
  expectCode(() => load(dir, "linked/c.json"), "CONFIG_OUTSIDE_ROOT");
});

test("config v1 file: readConfigText returns the exact decoded content read from one handle", () => {
  const dir = makeRoot();
  writeConfig(dir, '{"schemaVersion":1}');
  const { text, configRelPath } = readConfigText({ root: assertValidRepositoryRoot(dir, "test") });
  assert.equal(text, '{"schemaVersion":1}');
  assert.equal(configRelPath, CONFIG_FILE_NAME);
});

test("config v1 file: the config loader never uses a stat-then-read sequence on the path (static)", () => {
  const src = fs.readFileSync(path.join(__dirname, "config-file.js"), "utf8");
  assert.doesNotMatch(src, /readFileSync\s*\(/, "the config must be read from the opened descriptor, never re-opened by path");
  assert.match(src, /openSync\s*\(/);
  assert.match(src, /readSync\s*\(/);
  assert.match(src, /fstatSync\s*\(/);
});
