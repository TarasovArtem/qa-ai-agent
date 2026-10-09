"use strict";

/**
 * Triage Boundary Contract v1 (docs/triage-boundary-contract-decision-v1.md)
 * - TSB-F04 + TSB-F07 + XI-01 + XI-02 adversarial evidence.
 *
 * Hermetic (ARCH-C2-m02 / SEC-C2-m03): every test starts from an explicitly
 * set local-v1 invocation with all GitHub Actions variables cleared, and any
 * test that needs another mode sets ALL seven invocation variables itself.
 * The environment is restored after every test, so the same trust mode is
 * exercised locally and in a GitHub Actions job.
 */

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const contract = require("./triage-boundary-contract");
const analyzeFailure = require("./analyze-failure");
const collectContext = require("./collect-context");
const collectHistory = require("./collect-history");
const aggregateBrowserContext = require("./aggregate-browser-context");
const publicApi = require("./index");
const { MockProvider } = require("./providers/mock-provider");
const {
  INVOCATION_ENV_KEYS,
  freshLocalInvocationId,
  localInvocationEnv,
  githubInvocationEnv,
  setInvocationEnv,
  withInvocationEnv,
  useHermeticLocalInvocation,
  defaultFailure,
  contextForCurrentInvocation,
  promptFailedTests,
} = require("../../test/helpers/triage-invocation-env");

const { ERROR_CODES: E, INVOCATION_MODES } = contract;

const invocationState = useHermeticLocalInvocation({ beforeEach, afterEach });

const PROFILE = Object.freeze({
  id: "tbc-project",
  displayName: "Triage Boundary Contract Project",
  knownProjectConstraints: Object.freeze(["TBC constraint one.", "TBC constraint two."]),
});
const OTHER_PROFILE = Object.freeze({
  id: "tbc-other-project",
  displayName: "Other Project",
  knownProjectConstraints: Object.freeze(["Other constraint."]),
});

const ORIGINAL_ANALYZE = MockProvider.prototype.analyze;

function errorCode(code) {
  return (err) => {
    assert.equal(err.code, code, err.message);
    return true;
  };
}

function tempRoot(t, prefix = "tbc") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "reports", "ai"), { recursive: true });
  return dir;
}

function writeArtifact(dir, name, value) {
  fs.writeFileSync(path.join(dir, "reports", "ai", name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function reportPath(dir) {
  return path.join(dir, "reports", "ai", "ai-report.json");
}

// Runs the real analyzer main() with the real MockProvider (observed, never
// replaced) and returns every provider request, error line, exit status and
// the report (null when none was written).
async function runAnalyzer(root, { profile = PROFILE, extra = {} } = {}) {
  const calls = [];
  const errors = [];
  const savedLog = console.log;
  const savedError = console.error;
  const savedExitCode = process.exitCode;
  process.exitCode = undefined;
  MockProvider.prototype.analyze = async function observed(args) {
    calls.push(args);
    return ORIGINAL_ANALYZE.call(this, args);
  };
  console.log = () => {};
  console.error = (...args) => errors.push(args.join(" "));
  let exitCode;
  try {
    await analyzeFailure.main({ projectProfile: profile, repositoryRoot: root, ...extra });
  } finally {
    MockProvider.prototype.analyze = ORIGINAL_ANALYZE;
    console.log = savedLog;
    console.error = savedError;
    exitCode = process.exitCode;
    process.exitCode = savedExitCode;
  }
  const report = fs.existsSync(reportPath(root)) ? JSON.parse(fs.readFileSync(reportPath(root), "utf8")) : null;
  return { calls, errors, exitCode, report };
}

function assertRefused(run, code, canaries = []) {
  assert.equal(run.exitCode, 1, "fails closed with a non-zero exit");
  assert.ok(run.errors.some((line) => line.includes(code)), `expected ${code} in: ${run.errors.join(" | ")}`);
  assert.equal(run.calls.length, 0, "no provider call");
  assert.equal(run.report, null, "no report written");
  for (const canary of canaries) assert.ok(!run.errors.join(" ").includes(canary), "the diagnostic never echoes persisted/env values");
}

// =============================================================================
// 1. Invocation modes - the full truth table (XI-01)
// =============================================================================

const VALID_GITHUB = githubInvocationEnv({
  GITHUB_REPOSITORY: "TarasovArtem/qa-ai-agent",
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
  GITHUB_RUN_ID: "37958667400",
  GITHUB_RUN_ATTEMPT: "2",
});

test("mode 1: GITHUB_ACTIONS=true + complete valid tuple -> github-actions-v1 (frozen, exact values)", () => {
  const invocation = withInvocationEnv(VALID_GITHUB, () => contract.resolveTrustedInvocation());
  assert.deepEqual(invocation, {
    mode: INVOCATION_MODES.GITHUB_ACTIONS,
    repository: "TarasovArtem/qa-ai-agent",
    sha: "0123456789abcdef0123456789abcdef01234567",
    runId: "37958667400",
    runAttempt: "2",
    localInvocationId: null,
  });
  assert.ok(Object.isFrozen(invocation));
});

for (const missing of ["GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) {
  test(`mode 2-5: GITHUB_ACTIONS=true + missing ${missing} -> fail closed, never local fallback`, () => {
    const env = { ...VALID_GITHUB, [missing]: undefined };
    assert.throws(() => withInvocationEnv(env, () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_GITHUB_INVALID));
  });
}

test("mode 6: GITHUB_ACTIONS=true + any malformed tuple element -> fail closed, value never echoed", () => {
  const malformed = {
    GITHUB_REPOSITORY: ["owner", "a/b/c", "o /r", "o/..", "o/.", "-o/r", "o/r\n", "", `${"o".repeat(40)}/r`, `o/${"r".repeat(101)}`, "o/r?x=1"],
    GITHUB_SHA: ["0123456789ABCDEF0123456789ABCDEF01234567", "0".repeat(39), "0".repeat(41), "g".repeat(40), ` ${"0".repeat(40)}`, ""],
    GITHUB_RUN_ID: ["0", "01", "-1", "+1", " 1", "1 ", "1.0", "1e3", "9007199254740992", "12345678901234567", ""],
    GITHUB_RUN_ATTEMPT: ["0", "01", "-1", "+1", "1.5", "two", "9007199254740993", ""],
  };
  // Each diagnostic is a fixed string per variable - never the value itself.
  const fixed = {
    GITHUB_REPOSITORY: "GITHUB_REPOSITORY is missing or is not a canonical owner/repository value",
    GITHUB_SHA: "GITHUB_SHA is missing or is not 40 lowercase hexadecimal characters",
    GITHUB_RUN_ID: "GITHUB_RUN_ID is missing or is not a canonical positive decimal integer",
    GITHUB_RUN_ATTEMPT: "GITHUB_RUN_ATTEMPT is missing or is not a canonical positive decimal integer",
  };
  for (const [key, values] of Object.entries(malformed)) {
    for (const value of [...values, `CANARY_${key}_VALUE`]) {
      assert.throws(
        () => withInvocationEnv({ ...VALID_GITHUB, [key]: value }, () => contract.resolveTrustedInvocation()),
        (err) => {
          assert.equal(err.code, E.INVOCATION_GITHUB_INVALID, `${key}=${JSON.stringify(value)}`);
          assert.equal(err.message, `${E.INVOCATION_GITHUB_INVALID}: ${fixed[key]}`, `${key}: fixed diagnostic only`);
          return true;
        }
      );
    }
  }
});

test("mode 7: GITHUB_ACTIONS=true + local-v1 variables present -> contradictory state fails closed (canonical design 7.1, SEC-C2-m02)", () => {
  // Design section 7.1: "contradictory GITHUB_ACTIONS=true + local-v1 fails
  // closed"; SEC-C2-m02: any QA_AI_INVOCATION_* while GITHUB_ACTIONS=true
  // fails closed. The stricter canonical rule is implemented.
  for (const local of [localInvocationEnv(), { QA_AI_INVOCATION_MODE: "local-v1" }, { QA_AI_INVOCATION_ID: freshLocalInvocationId() }, { QA_AI_INVOCATION_MODE: "" }]) {
    assert.throws(() => withInvocationEnv({ ...VALID_GITHUB, ...local }, () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_MODE_CONFLICT));
  }
});

test("mode 8: GITHUB_ACTIONS !== true + QA_AI_INVOCATION_MODE=local-v1 + valid id -> local-v1", () => {
  const id = freshLocalInvocationId();
  const invocation = withInvocationEnv(localInvocationEnv(id), () => contract.resolveTrustedInvocation());
  assert.deepEqual(invocation, { mode: INVOCATION_MODES.LOCAL, repository: null, sha: null, runId: null, runAttempt: null, localInvocationId: id });
  assert.ok(Object.isFrozen(invocation));
});

test("mode 9: local-v1 + missing id -> fail closed", () => {
  assert.throws(() => withInvocationEnv({ QA_AI_INVOCATION_MODE: "local-v1" }, () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_LOCAL_INVALID));
});

test("mode 10: local-v1 + malformed id (grammar: exactly 32 lowercase hex) -> fail closed; UUIDv4 is not accepted", () => {
  const id = freshLocalInvocationId();
  for (const bad of [id.toUpperCase(), id.slice(1), `${id}0`, `${id.slice(0, 31)}g`, "4f8c1e2a-9b3d-4c5e-8f6a-7b8c9d0e1f2a", crypto_uuid(), ` ${id}`, ""]) {
    assert.throws(() => withInvocationEnv(localInvocationEnv(bad), () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_LOCAL_INVALID), JSON.stringify(bad));
  }
});

function crypto_uuid() {
  return require("node:crypto").randomUUID();
}

test("mode 11: unknown invocation mode -> fail closed (no implicit third mode)", () => {
  for (const mode of ["local-v2", "LOCAL-V1", "github-actions-v1", "ci", " local-v1", ""]) {
    assert.throws(
      () => withInvocationEnv({ QA_AI_INVOCATION_MODE: mode, QA_AI_INVOCATION_ID: freshLocalInvocationId() }, () => contract.resolveTrustedInvocation()),
      errorCode(E.INVOCATION_MODE_UNKNOWN),
      JSON.stringify(mode)
    );
  }
});

test("mode 12: no trusted invocation mode -> fail closed", () => {
  assert.throws(() => withInvocationEnv({}, () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_MODE_REQUIRED));
  assert.throws(() => withInvocationEnv({ QA_AI_INVOCATION_ID: freshLocalInvocationId() }, () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_MODE_REQUIRED));
});

test("mode 13: stray GITHUB_* values without GITHUB_ACTIONS=\"true\" never create CI authority", () => {
  const stray = { ...VALID_GITHUB, GITHUB_ACTIONS: undefined };
  assert.throws(() => withInvocationEnv(stray, () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_MODE_REQUIRED));
  for (const notTrue of ["TRUE", "True", "1", "yes", "false", " true", ""]) {
    assert.throws(() => withInvocationEnv({ ...VALID_GITHUB, GITHUB_ACTIONS: notTrue }, () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_MODE_REQUIRED), notTrue);
  }
  // With a valid local-v1 contract they stay mere evidence: mode is local-v1.
  const local = withInvocationEnv({ ...stray, ...localInvocationEnv() }, () => contract.resolveTrustedInvocation());
  assert.equal(local.mode, INVOCATION_MODES.LOCAL);
  assert.equal(local.repository, null);
});

test("trust source: an inherited (prototype-polluted) GITHUB_ACTIONS never creates CI authority", () => {
  withInvocationEnv({}, () => {
    Object.prototype.GITHUB_ACTIONS = "true"; // eslint-disable-line no-extend-native
    Object.prototype.QA_AI_INVOCATION_MODE = "local-v1"; // eslint-disable-line no-extend-native
    try {
      assert.throws(() => contract.resolveTrustedInvocation(), errorCode(E.INVOCATION_MODE_REQUIRED));
    } finally {
      delete Object.prototype.GITHUB_ACTIONS;
      delete Object.prototype.QA_AI_INVOCATION_MODE;
    }
  });
});

test("trust source: a .env file in the working directory is never loaded as a trust source", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tbc-dotenv-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, ".env"), `QA_AI_INVOCATION_MODE=local-v1\nQA_AI_INVOCATION_ID=${freshLocalInvocationId()}\nGITHUB_ACTIONS=true\n`);
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.throws(() => withInvocationEnv({}, () => contract.resolveTrustedInvocation()), errorCode(E.INVOCATION_MODE_REQUIRED));
  } finally {
    process.chdir(cwd);
  }
});

test("trust source: resolveTrustedInvocation() takes no parameter - a caller cannot supply or elevate the trusted value", () => {
  assert.equal(contract.resolveTrustedInvocation.length, 0);
  const forged = { mode: "github-actions-v1", repository: "x/y", sha: "a".repeat(40), runId: "1", runAttempt: "1" };
  const invocation = withInvocationEnv(localInvocationEnv(), () => contract.resolveTrustedInvocation(forged));
  assert.equal(invocation.mode, INVOCATION_MODES.LOCAL);
});

test("hermeticity: every test starts with exactly a local-v1 invocation and no ambient GitHub Actions authority", () => {
  for (const key of ["GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(process.env, key), false, key);
  }
  assert.equal(process.env.QA_AI_INVOCATION_MODE, "local-v1");
  assert.equal(process.env.QA_AI_INVOCATION_ID, invocationState.id);
  assert.equal(contract.resolveTrustedInvocation().localInvocationId, invocationState.id);
  assert.equal(INVOCATION_ENV_KEYS.length, 7);
});

test("hermeticity: setInvocationEnv() clears and restores all seven variables exactly (simulated ambient CI)", () => {
  const ambient = setInvocationEnv(VALID_GITHUB);
  try {
    const restore = setInvocationEnv(localInvocationEnv());
    assert.equal(process.env.GITHUB_ACTIONS, undefined, "ambient CI state is cleared, not inherited");
    restore();
    assert.equal(process.env.GITHUB_ACTIONS, "true", "restored afterwards");
    assert.equal(process.env.QA_AI_INVOCATION_MODE, undefined);
  } finally {
    ambient();
  }
});

// =============================================================================
// 2. PersistedTriageContextV1 (TSB-F07)
// =============================================================================

function v1(overrides = {}) {
  return contextForCurrentInvocation({ profile: PROFILE, ...overrides });
}

test("TSB-F07 variants: real Cypress shape (nullable per-spec stats, suite/status/screenshot) is accepted", () => {
  const ctx = v1({
    testResults: {
      found: true,
      totals: { tests: 3, passed: 1, failed: 1, pending: 1, duration: 42 },
      specs: [
        { specFile: "cypress/e2e/a.cy.js", tests: 3, passed: 1, failed: 1, pending: 1, duration: 42 },
        { specFile: null, tests: null, passed: null, failed: null, pending: null, duration: null },
      ],
    },
    failedTests: [defaultFailure({ fullTitle: null, duration: null, screenshot: "cypress/screenshots/a (failed).png" })],
    relevantFiles: { "cypress.config.js": { content: "module.exports = {};", truncated: false } },
    warnings: ["Failed spec source not found on disk: x"],
  });
  const snapshot = contract.validatePersistedContext(ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), ctx);
});

test("TSB-F07 variants: real Playwright shape (optional projectId/projectName, playwright framework) is accepted - never forced to Cypress", () => {
  const ctx = v1({
    framework: "playwright",
    failedTests: [defaultFailure({ projectId: "chromium", projectName: "chromium", error: { message: "\u001b[31mError:\u001b[39m expect(locator)", stack: null } })],
  });
  const snapshot = contract.validatePersistedContext(ctx);
  assert.equal(snapshot.metadata.framework, "playwright");
  assert.equal(snapshot.failedTests[0].projectName, "chromium");
});

test("TSB-F07 variants: {found:false} zero-failure context with knownProjectConstraints: [] and the normalized-failure minimum are accepted", () => {
  assert.doesNotThrow(() => contract.validatePersistedContext(v1({ testResults: { found: false }, failedTests: [], knownProjectConstraints: [] })));
  const minimal = { title: null, fullTitle: null, specFile: null, error: { message: null, stack: null } };
  assert.doesNotThrow(() => contract.validatePersistedContext(v1({ failedTests: [minimal] })));
});

test("TSB-F07 variants: aggregator correlations (and null correlations) are accepted", () => {
  const browserCorrelation = { browsers: ["chrome", "edge"], failedBrowsers: ["chrome"], passedBrowsers: ["edge"], primaryBrowser: "chrome", additionalFailedBrowsers: [], failureScope: "single-browser", sameFailureSignature: null };
  const frameworkCorrelation = { primaryFramework: "cypress", outcomes: [{ framework: "cypress", outcome: "failure" }, { framework: "playwright", outcome: "success" }] };
  assert.doesNotThrow(() => contract.validatePersistedContext(v1({ extra: { browserCorrelation, frameworkCorrelation } })));
  assert.doesNotThrow(() => contract.validatePersistedContext(v1({ extra: { browserCorrelation: null, frameworkCorrelation: null } })));
});

test("TSB-F07 rejects: unknown top-level key, unknown nested keys, wrong types and wrong schemaVersion - without echoing values", () => {
  const canary = "TSB_F07_CANARY_VALUE";
  const cases = [
    ["unknown top-level", { ...v1(), injected: canary }],
    ["schemaVersion 2", { ...v1(), schemaVersion: 2 }],
    ["schemaVersion missing", (() => { const c = v1(); delete c.schemaVersion; return c; })()],
    ["metadata unknown", v1({ metadata: { extraField: canary } })],
    ["failure unknown", v1({ failedTests: [defaultFailure({ adapterExtra: canary })] })],
    ["error unknown", v1({ failedTests: [defaultFailure({ error: { message: "m", stack: null, hidden: canary } })] })],
    ["totals unknown", v1({ testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 1, x: 1 }, specs: [] } })],
    ["found:false extra", v1({ testResults: { found: false, totals: {} } })],
    ["relevant file unknown", v1({ relevantFiles: { "cypress.config.js": { content: "", truncated: false, mode: canary } } })],
    ["correlation unknown", v1({ extra: { frameworkCorrelation: { primaryFramework: "cypress", outcomes: [], x: canary } } })],
    ["status not failed", v1({ failedTests: [defaultFailure({ status: "passed" })] })],
    ["title wrong type", v1({ failedTests: [defaultFailure({ title: 42 })] })],
    ["ci wrong type", v1({ metadata: { ci: "true" } })],
    ["negative count", v1({ testResults: { found: true, totals: { tests: -1, passed: 0, failed: 1, pending: 0, duration: 1 }, specs: [] } })],
    ["unsafe integer", v1({ testResults: { found: true, totals: { tests: 2 ** 53, passed: 0, failed: 1, pending: 0, duration: 1 }, specs: [] } })],
    ["non-finite duration", v1({ failedTests: [defaultFailure({ duration: Infinity })] })],
    ["generatedAt format", { ...v1(), generatedAt: "yesterday" }],
    ["projectId missing", (() => { const c = v1(); delete c.metadata.projectId; return c; })()],
    ["framework blank", v1({ metadata: { framework: "   " } })],
    ["invocationMode unknown", v1({ metadata: { invocationMode: "ci" } })],
    ["local-v1 with runAttempt", v1({ metadata: { runAttempt: "1" } })],
    ["local-v1 malformed id", v1({ metadata: { localInvocationId: "ABC" } })],
  ];
  for (const [name, ctx] of cases) {
    assert.throws(() => contract.validatePersistedContext(ctx), (err) => {
      assert.equal(err.code, E.CONTEXT_INVALID, `${name}: ${err.message}`);
      assert.ok(!err.message.includes(canary), `${name}: value echoed`);
      return true;
    }, name);
  }
});

test("TSB-F07 rejects: github-actions-v1 evidence must carry the canonical tuple and a null local id", () => {
  withInvocationEnv(VALID_GITHUB, () => {
    const good = v1();
    assert.doesNotThrow(() => contract.validatePersistedContext(good));
    for (const [field, value] of [["localInvocationId", freshLocalInvocationId()], ["runAttempt", null], ["runAttempt", "01"], ["commit", "ABC"], ["repository", "not a repo"], ["runId", null]]) {
      assert.throws(() => contract.validatePersistedContext(v1({ metadata: { [field]: value } })), errorCode(E.CONTEXT_INVALID), `${field}=${value}`);
    }
  });
});

test("TSB-F07 rejects: sparse arrays and oversized arrays/strings", () => {
  const sparse = v1();
  sparse.warnings = ["a", , "c"]; // eslint-disable-line no-sparse-arrays
  assert.throws(() => contract.validatePersistedContext(sparse), errorCode(E.CONTEXT_INVALID));
  assert.throws(() => contract.validatePersistedContext(v1({ failedTests: Array.from({ length: contract.MAX_FAILED_TESTS + 1 }, () => defaultFailure()) })), /exceeds 500 entries/);
  assert.doesNotThrow(() => contract.validatePersistedContext(v1({ failedTests: Array.from({ length: contract.MAX_FAILED_TESTS }, () => defaultFailure()) })));
  assert.throws(() => contract.validatePersistedContext(v1({ warnings: Array.from({ length: 2001 }, () => "w") })), /exceeds 2000 entries/);
  assert.throws(() => contract.validatePersistedContext(v1({ failedTests: [defaultFailure({ title: "t".repeat(4097) })] })), /title exceeds 4096/);
  assert.throws(() => contract.validatePersistedContext(v1({ failedTests: [defaultFailure({ error: { message: "m".repeat(64 * 1024 + 1), stack: null } })] })), /message exceeds 65536/);
  assert.throws(() => contract.validatePersistedContext(v1({ knownProjectConstraints: Array.from({ length: 33 }, () => "c") })), errorCode(E.CONTEXT_INVALID));
});

test("TSB-F07 relevant files: 20 KiB per file (plus the collector's own truncation marker) and 150 KiB aggregate, never silently truncated", () => {
  const max = contract.MAX_RELEVANT_FILE_BYTES;
  const marker = contract.RELEVANT_FILE_TRUNCATION_MARKER;
  assert.doesNotThrow(() => contract.validatePersistedContext(v1({ relevantFiles: { "cypress/a.js": { content: "a".repeat(max), truncated: false } } })));
  assert.throws(() => contract.validatePersistedContext(v1({ relevantFiles: { "cypress/a.js": { content: "a".repeat(max + 1), truncated: false } } })), /content exceeds 20480/);
  assert.doesNotThrow(() => contract.validatePersistedContext(v1({ relevantFiles: { "cypress/a.js": { content: "a".repeat(max) + marker, truncated: true } } })));
  assert.throws(() => contract.validatePersistedContext(v1({ relevantFiles: { "cypress/a.js": { content: "a".repeat(max) + marker + "x", truncated: true } } })), /content exceeds/);

  const atAggregate = {};
  let total = 0;
  for (let i = 0; total < contract.MAX_TOTAL_RELEVANT_BYTES; i += 1) {
    const size = Math.min(max, contract.MAX_TOTAL_RELEVANT_BYTES - total);
    atAggregate[`cypress/f${i}.js`] = { content: "x".repeat(size), truncated: false };
    total += size;
  }
  assert.doesNotThrow(() => contract.validatePersistedContext(v1({ relevantFiles: atAggregate })), "exactly the aggregate bound");
  assert.throws(() => contract.validatePersistedContext(v1({ relevantFiles: { ...atAggregate, "cypress/one-more.js": { content: "x", truncated: false } } })), /aggregate content exceeds 153600/);
});

test("TSB-F07 producer: buildRelevantFiles() never lets the aggregate exceed 150 KiB (a file that would cross it is skipped with a warning)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tbc-relevant-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const testsDir = path.join(dir, "cypress", "e2e");
  fs.mkdirSync(testsDir, { recursive: true });
  const imports = [];
  for (let i = 0; i < 9; i += 1) {
    fs.writeFileSync(path.join(testsDir, `helper${i}.js`), `// ${"h".repeat(19 * 1024)}`);
    imports.push(`import h${i} from './helper${i}';`);
  }
  fs.writeFileSync(path.join(testsDir, "big.cy.js"), imports.join("\n"));
  const root = { lexicalRoot: dir, realRoot: fs.realpathSync(dir) };
  const warnings = [];
  const files = collectContext.buildRelevantFiles([{ specFile: "cypress/e2e/big.cy.js" }], warnings, "cypress", root);
  const aggregate = Object.values(files).reduce((sum, f) => sum + f.content.length, 0);
  assert.ok(aggregate <= contract.MAX_TOTAL_RELEVANT_BYTES, `aggregate ${aggregate}`);
  assert.ok(warnings.some((w) => /relevantFiles size cap reached/.test(w)));
});

test("TSB-F07 byte bound: a measured maximal-cardinality legitimate context fits well inside MAX_CONTEXT_BYTES", () => {
  const files = {};
  let total = 0;
  const source = fs.readFileSync(path.join(__dirname, "collect-context.js"), "utf8");
  for (let i = 0; total < contract.MAX_TOTAL_RELEVANT_BYTES; i += 1) {
    const content = source.slice(0, Math.min(contract.MAX_RELEVANT_FILE_BYTES, contract.MAX_TOTAL_RELEVANT_BYTES - total));
    files[`cypress/f${i}.js`] = { content, truncated: false };
    total += content.length;
  }
  const failure = defaultFailure({
    title: "t".repeat(120),
    fullTitle: "s".repeat(240),
    suite: "s".repeat(120),
    error: { message: "AssertionError: expected ".repeat(40), stack: `${"    at Context.eval (webpack://x/cypress/e2e/tests/x.cy.js:12:34)\n".repeat(60).slice(0, 4000)}${contract.RELEVANT_FILE_TRUNCATION_MARKER}` },
  });
  const ctx = v1({ failedTests: Array.from({ length: contract.MAX_FAILED_TESTS }, () => failure), relevantFiles: files });
  assert.doesNotThrow(() => contract.validatePersistedContext(ctx));
  const bytes = Buffer.byteLength(JSON.stringify(ctx, null, 2));
  assert.ok(bytes < contract.MAX_CONTEXT_BYTES / 2, `measured ${bytes} bytes against the ${contract.MAX_CONTEXT_BYTES}-byte bound`);
  assert.equal(contract.MAX_CONTEXT_BYTES, 8 * 1024 * 1024);
});

test("TSB-F07 byte bound: exactly MAX_CONTEXT_BYTES is read; MAX_CONTEXT_BYTES + 1 is rejected before JSON parsing", (t) => {
  const dir = tempRoot(t);
  const file = path.join(dir, "reports", "ai", "context.json");
  const body = JSON.stringify(v1());
  const exact = body.slice(0, -1) + " ".repeat(contract.MAX_CONTEXT_BYTES - Buffer.byteLength(body)) + "}";
  assert.equal(Buffer.byteLength(exact), contract.MAX_CONTEXT_BYTES);
  fs.writeFileSync(file, exact);
  assert.doesNotThrow(() => contract.readPersistedContext(file));

  fs.writeFileSync(file, exact + " ");
  const parse = t.mock.method(JSON, "parse");
  assert.throws(() => contract.readPersistedContext(file), errorCode(E.ARTIFACT_TOO_LARGE));
  assert.equal(parse.mock.callCount(), 0, "never parsed");
});

test("TSB-F07 malformed artifacts: invalid JSON and invalid UTF-8 fail closed with fixed messages (no content echo)", (t) => {
  const dir = tempRoot(t);
  const file = path.join(dir, "reports", "ai", "context.json");
  fs.writeFileSync(file, '{"schemaVersion": 1, "SECRET_CANARY": ');
  assert.throws(() => contract.readPersistedContext(file), (err) => err.code === E.ARTIFACT_MALFORMED && !err.message.includes("SECRET_CANARY"));
  fs.writeFileSync(file, Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]));
  assert.throws(() => contract.readPersistedContext(file), errorCode(E.ARTIFACT_MALFORMED));
});

// =============================================================================
// 3. Snapshot / TOCTOU / parser hardening (SEC-C2-m05)
// =============================================================================

test("snapshot: validators return detached, deeply frozen snapshots - later input mutation (including reused nested arrays) cannot reach them", () => {
  const input = v1();
  const sharedConstraints = input.knownProjectConstraints;
  const snapshot = contract.validatePersistedContext(input);
  input.metadata.projectId = "MUTATED";
  input.failedTests[0].title = "MUTATED";
  sharedConstraints.push("MUTATED");
  input.failedTests.push(defaultFailure({ title: "MUTATED" }));
  assert.equal(snapshot.metadata.projectId, PROFILE.id);
  assert.equal(snapshot.failedTests.length, 1);
  assert.equal(snapshot.failedTests[0].title, "synthetic failing test");
  assert.deepEqual(snapshot.knownProjectConstraints, [...PROFILE.knownProjectConstraints]);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.metadata) && Object.isFrozen(snapshot.failedTests) && Object.isFrozen(snapshot.failedTests[0].error));
  assert.notEqual(snapshot.knownProjectConstraints, sharedConstraints);
});

test("snapshot: Proxy inputs (top-level and nested) are rejected before any trap runs", () => {
  let trapped = 0;
  const handler = { get(target, key, receiver) { trapped += 1; return Reflect.get(target, key, receiver); }, ownKeys(target) { trapped += 1; return Reflect.ownKeys(target); }, getOwnPropertyDescriptor(target, key) { trapped += 1; return Reflect.getOwnPropertyDescriptor(target, key); }, getPrototypeOf(target) { trapped += 1; return Reflect.getPrototypeOf(target); } };
  assert.throws(() => contract.validatePersistedContext(new Proxy(v1(), handler)), /must not be a Proxy/);
  const nested = v1();
  nested.metadata = new Proxy(nested.metadata, handler);
  assert.throws(() => contract.validatePersistedContext(nested), /must not be a Proxy/);
  const nestedArray = v1();
  nestedArray.failedTests = new Proxy(nestedArray.failedTests, handler);
  assert.throws(() => contract.validatePersistedContext(nestedArray), /must not be a Proxy/);
  assert.equal(trapped, 0);
});

test("snapshot: accessor properties are rejected without invoking the getter (no time-of-check/time-of-use switch)", () => {
  let getterCalls = 0;
  const ctx = v1();
  let first = true;
  Object.defineProperty(ctx.metadata, "projectId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      const value = first ? PROFILE.id : "SWITCHED";
      first = false;
      return value;
    },
  });
  assert.throws(() => contract.validatePersistedContext(ctx), /must be an enumerable data property/);
  assert.equal(getterCalls, 0);
});

test("snapshot: inherited properties never satisfy required fields; custom prototypes, symbols and non-enumerable own properties are rejected", () => {
  const base = v1();
  const { schemaVersion, ...withoutVersion } = base;
  assert.equal(schemaVersion, 1);
  Object.prototype.schemaVersion = 1; // eslint-disable-line no-extend-native
  try {
    assert.throws(() => contract.validatePersistedContext(withoutVersion), /context\.schemaVersion is required/);
  } finally {
    delete Object.prototype.schemaVersion;
  }
  assert.throws(() => contract.validatePersistedContext(Object.assign(Object.create({ inherited: true }), base)), /must be a plain object/);
  class Sub extends Array {}
  const sub = v1();
  sub.warnings = Sub.from(["w"]);
  assert.throws(() => contract.validatePersistedContext(sub), /must be a plain Array/);
  const sym = v1();
  sym.metadata[Symbol("x")] = 1;
  assert.throws(() => contract.validatePersistedContext(sym), /symbol keys/);
  const hidden = v1();
  Object.defineProperty(hidden.metadata, "hidden", { value: 1, enumerable: false });
  assert.throws(() => contract.validatePersistedContext(hidden), /enumerable data property/);
});

test("parser hardening: __proto__, prototype and constructor keys are rejected wherever they appear, and never pollute Object.prototype", () => {
  for (const json of [
    `{"__proto__": {"polluted": true}, "schemaVersion": 1}`,
    JSON.stringify(v1()).replace('"metadata":{', '"metadata":{"__proto__":{"polluted":true},'),
    JSON.stringify(v1()).replace('"error":{', '"error":{"constructor":{"prototype":{"polluted":true}},'),
    JSON.stringify(v1()).replace('"relevantFiles":{}', '"relevantFiles":{"prototype":{"content":"","truncated":false}}'),
  ]) {
    assert.throws(() => contract.validatePersistedContext(JSON.parse(json)), /forbidden property name/);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => contract.validateProviderEnvelope(JSON.parse(`{"results": [], "__proto__": {"x": 1}}`)), /forbidden property name/);
  assert.throws(() => contract.validateHistoryRecord(JSON.parse(`{"available": false, "reason": "r", "__proto__": {}}`)), /forbidden property name/);
});

test("snapshot: deep nesting and huge structures are bounded", () => {
  let deep = "leaf";
  for (let i = 0; i < 40; i += 1) deep = [deep];
  assert.throws(() => contract.snapshotPlainData(deep, "x", "CODE"), /maximum nesting depth/);
  assert.throws(() => contract.snapshotPlainData(new Array(300000).fill(0), "x", "CODE"), /maximum structure size/);
});

// =============================================================================
// 4. XI-01 binding through the authoritative analyzer gate
// =============================================================================

test("XI-01 local-v1: the current invocation's context is analyzed and the report is written", async (t) => {
  const root = tempRoot(t);
  writeArtifact(root, "context.json", v1());
  const run = await runAnalyzer(root);
  assert.notEqual(run.exitCode, 1, run.errors.join(" | "));
  assert.equal(run.calls.length, 1);
  assert.equal(run.report.results.length, 1);
});

test("XI-01 local-v1: a stale context from a prior local invocation is refused (copied/edited projectId and constraints do not help)", async (t) => {
  const root = tempRoot(t);
  const prior = freshLocalInvocationId();
  writeArtifact(root, "context.json", v1({ metadata: { localInvocationId: prior } }));
  assertRefused(await runAnalyzer(root), E.CONTEXT_INVOCATION_MISMATCH, [prior]);
});

test("XI-01: wrong projectId, a context copied from another ProjectProfile and constraint mismatch are refused before any provider call", async (t) => {
  const root = tempRoot(t);
  writeArtifact(root, "context.json", contextForCurrentInvocation({ profile: OTHER_PROFILE }));
  assertRefused(await runAnalyzer(root), E.CONTEXT_PROJECT_MISMATCH, [OTHER_PROFILE.id]);

  writeArtifact(root, "context.json", v1({ knownProjectConstraints: [...OTHER_PROFILE.knownProjectConstraints] }));
  assertRefused(await runAnalyzer(root), E.CONTEXT_CONSTRAINTS_MISMATCH);

  writeArtifact(root, "context.json", v1({ knownProjectConstraints: [PROFILE.knownProjectConstraints[0]] }));
  assertRefused(await runAnalyzer(root), E.CONTEXT_CONSTRAINTS_MISMATCH);
});

test("XI-01: missing, malformed, unknown, partial and mixed invocation state at analysis time is refused before reading the context", async (t) => {
  const root = tempRoot(t);
  writeArtifact(root, "context.json", v1());
  const cases = [
    [{}, E.INVOCATION_MODE_REQUIRED],
    [{ QA_AI_INVOCATION_MODE: "local-v1" }, E.INVOCATION_LOCAL_INVALID],
    [localInvocationEnv("not-a-valid-id"), E.INVOCATION_LOCAL_INVALID],
    [{ QA_AI_INVOCATION_MODE: "local-v9", QA_AI_INVOCATION_ID: invocationState.id }, E.INVOCATION_MODE_UNKNOWN],
    [{ ...VALID_GITHUB, GITHUB_RUN_ATTEMPT: undefined }, E.INVOCATION_GITHUB_INVALID],
    [{ ...VALID_GITHUB, ...localInvocationEnv(invocationState.id) }, E.INVOCATION_MODE_CONFLICT],
    [{ ...VALID_GITHUB, GITHUB_ACTIONS: undefined }, E.INVOCATION_MODE_REQUIRED],
  ];
  for (const [env, code] of cases) {
    const run = await withInvocationEnv(env, () => runAnalyzer(root));
    assertRefused(run, code);
  }
});

test("XI-01: a persisted invocation mode never selects the trusted mode (github evidence under a local invocation is refused)", async (t) => {
  const root = tempRoot(t);
  const githubContext = withInvocationEnv(VALID_GITHUB, () => v1());
  writeArtifact(root, "context.json", githubContext);
  assertRefused(await runAnalyzer(root), E.CONTEXT_INVOCATION_MISMATCH);
});

test("XI-01: a caller-controlled trust label passed to main() is ignored - no parameter can elevate trust", async (t) => {
  const root = tempRoot(t);
  const prior = freshLocalInvocationId();
  writeArtifact(root, "context.json", v1({ metadata: { localInvocationId: prior } }));
  const forged = { mode: "local-v1", localInvocationId: prior, invocation: { localInvocationId: prior }, trusted: true };
  assertRefused(await runAnalyzer(root, { extra: forged }), E.CONTEXT_INVOCATION_MISMATCH);
});

test("XI-01 github-actions-v1: the same repository/SHA/run/run attempt is analyzed (positive same-attempt compatibility)", async (t) => {
  const root = tempRoot(t);
  await withInvocationEnv(VALID_GITHUB, async () => {
    writeArtifact(root, "context.json", v1());
    const run = await runAnalyzer(root);
    assert.notEqual(run.exitCode, 1, run.errors.join(" | "));
    assert.equal(run.calls.length, 1);
  });
});

test("XI-01 github-actions-v1: another attempt of the same run, a prior run, another repository or another SHA is refused", async (t) => {
  const root = tempRoot(t);
  const persistedUnder = (overrides) => withInvocationEnv({ ...VALID_GITHUB, ...overrides }, () => v1());
  for (const [name, overrides] of [
    ["prior attempt", { GITHUB_RUN_ATTEMPT: "1" }],
    ["later attempt", { GITHUB_RUN_ATTEMPT: "3" }],
    ["prior run", { GITHUB_RUN_ID: "37958667399" }],
    ["other repository", { GITHUB_REPOSITORY: "someone-else/qa-ai-agent" }],
    ["stale SHA", { GITHUB_SHA: "f".repeat(40) }],
  ]) {
    writeArtifact(root, "context.json", persistedUnder(overrides));
    const run = await withInvocationEnv(VALID_GITHUB, () => runAnalyzer(root));
    assertRefused(run, E.CONTEXT_INVOCATION_MISMATCH);
    assert.ok(name);
  }
});

test("XI-01 zero-failure path: a stale or malformed zero-failure context writes no report; the bound one writes the empty report", async (t) => {
  const root = tempRoot(t);
  writeArtifact(root, "context.json", v1({ failedTests: [], testResults: { found: false }, metadata: { localInvocationId: freshLocalInvocationId() } }));
  assertRefused(await runAnalyzer(root), E.CONTEXT_INVOCATION_MISMATCH);

  writeArtifact(root, "context.json", { failedTests: [], metadata: {} });
  assertRefused(await runAnalyzer(root), E.CONTEXT_INVALID);

  writeArtifact(root, "context.json", contextForCurrentInvocation({ profile: OTHER_PROFILE, failedTests: [], testResults: { found: false } }));
  assertRefused(await runAnalyzer(root), E.CONTEXT_PROJECT_MISMATCH);

  writeArtifact(root, "context.json", v1({ failedTests: [], testResults: { found: false } }));
  const ok = await runAnalyzer(root);
  assert.notEqual(ok.exitCode, 1, ok.errors.join(" | "));
  assert.equal(ok.calls.length, 0, "no provider call for zero failures");
  assert.deepEqual(ok.report.results, []);
});

test("XI-01: an over-bound or symlink-escaping context.json is refused before parsing", async (t) => {
  const root = tempRoot(t);
  const body = JSON.stringify(v1());
  writeArtifact(root, "context.json", body + " ".repeat(contract.MAX_CONTEXT_BYTES));
  assertRefused(await runAnalyzer(root), E.ARTIFACT_TOO_LARGE);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tbc-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "context.json"), body);
  fs.rmSync(path.join(root, "reports", "ai", "context.json"));
  try {
    fs.symlinkSync(path.join(outside, "context.json"), path.join(root, "reports", "ai", "context.json"), "file");
  } catch {
    return; // symlinks unavailable on this host
  }
  const run = await runAnalyzer(root);
  assert.equal(run.exitCode, 1);
  assert.equal(run.calls.length, 0);
  assert.equal(run.report, null);
});

// =============================================================================
// 5. XI-02 History contract
// =============================================================================

function historyRecord(overrides = {}) {
  return { available: true, projectId: PROFILE.id, framework: "cypress", browser: "chrome", branch: "main", runsConsidered: 10, passes: 7, failures: 3, retryPasses: 1, generatedAt: "2026-10-09T00:00:00.000Z", ...overrides };
}

test("XI-02 closed variants: available records and bounded unavailable markers; legitimate zero History stays distinct from unavailable", () => {
  const zero = contract.validateHistoryRecord(historyRecord({ runsConsidered: 0, passes: 0, failures: 0, retryPasses: 0 }));
  assert.deepEqual(contract.projectHistory(zero, { projectId: PROFILE.id, framework: "cypress" }), { runsConsidered: 0, passes: 0, failures: 0, retryPasses: 0 });
  const unavailable = contract.validateHistoryRecord({ available: false, reason: "no prior runs" });
  assert.equal(contract.projectHistory(unavailable, { projectId: PROFILE.id, framework: "cypress" }), null);
  for (const bad of [
    historyRecord({ extra: 1 }),
    historyRecord({ passes: 8 }),
    historyRecord({ retryPasses: 8 }),
    historyRecord({ runsConsidered: 31, passes: 31, failures: 0, retryPasses: 0 }),
    historyRecord({ runsConsidered: 2 ** 53, passes: 2 ** 53, failures: 0, retryPasses: 0 }),
    historyRecord({ branch: "b".repeat(2049) }),
    historyRecord({ available: "true" }),
    { available: false, reason: "r".repeat(contract.MAX_HISTORY_REASON_LENGTH + 1) },
    { available: false },
  ]) {
    assert.throws(() => contract.validateHistoryRecord(bad), errorCode(E.HISTORY_INVALID));
  }
});

test("XI-02 eligibility: wrong project, wrong framework and cross-project replay are 'no usable history'", () => {
  const record = contract.validateHistoryRecord(historyRecord());
  assert.equal(contract.projectHistory(record, { projectId: OTHER_PROFILE.id, framework: "cypress" }), null);
  assert.equal(contract.projectHistory(record, { projectId: PROFILE.id, framework: "playwright" }), null);
  assert.ok(Object.isFrozen(contract.projectHistory(record, { projectId: PROFILE.id, framework: "cypress" })));
});

test("XI-02: History is cross-run - a record from another run is still eligible (not bound to the current run/invocation)", async (t) => {
  const root = tempRoot(t);
  writeArtifact(root, "context.json", v1());
  writeArtifact(root, "history.json", historyRecord());
  const run = await runAnalyzer(root);
  assert.deepEqual(run.report.history, { runsConsidered: 10, passes: 7, failures: 3, retryPasses: 1 });
  assert.deepEqual(JSON.parse(run.calls[0].userPrompt.match(/```json\s*([\s\S]*?)\s*```/)[1]).history, run.report.history, "prompt and report History are the same projection");
});

test("XI-02: embedded context.history is rejected at the analyzer boundary - before History, enrichment or provider", async (t) => {
  const root = tempRoot(t);
  writeArtifact(root, "context.json", v1({ extra: { history: { runsConsidered: 1, passes: 1, failures: 0, retryPasses: 0 } } }));
  writeArtifact(root, "history.json", historyRecord());
  assertRefused(await runAnalyzer(root), E.CONTEXT_EMBEDDED_HISTORY);
  assert.throws(() => contract.validatePersistedContext(v1({ extra: { history: null } })), errorCode(E.CONTEXT_EMBEDDED_HISTORY));
});

test("XI-02: an injected History value must be exactly the four-counter projection (or null)", () => {
  assert.equal(contract.validateHistoryProjection(null), null);
  assert.deepEqual(contract.validateHistoryProjection({ runsConsidered: 2, passes: 1, failures: 1, retryPasses: 0 }), { runsConsidered: 2, passes: 1, failures: 1, retryPasses: 0 });
  assert.throws(() => contract.validateHistoryProjection({ runsConsidered: 2, passes: 1, failures: 1, retryPasses: 0, injectedNote: "x" }), errorCode(E.HISTORY_INVALID));
  assert.throws(() => contract.validateHistoryProjection({ runsConsidered: 2, passes: 2, failures: 2, retryPasses: 0 }), errorCode(E.HISTORY_INVALID));
});

test("XI-02 producer: collect-history bounds an unavailable reason so the marker always conforms", async (t) => {
  const root = tempRoot(t);
  const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, TEST_BROWSER: process.env.TEST_BROWSER, GITHUB_API_URL: process.env.GITHUB_API_URL };
  process.env.GITHUB_TOKEN = "tbc-dummy-token";
  process.env.TEST_BROWSER = "chrome";
  process.env.GITHUB_REPOSITORY = "o/r";
  process.env.GITHUB_API_URL = "http://127.0.0.1:9";
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error(`network down ${"x".repeat(5000)}`);
  });
  try {
    await collectHistory.main({ profile: PROFILE, repositoryRoot: root });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const written = JSON.parse(fs.readFileSync(path.join(root, "reports", "ai", "history.json"), "utf8"));
  assert.equal(written.available, false);
  assert.ok(written.reason.length <= contract.MAX_HISTORY_REASON_LENGTH);
  assert.doesNotThrow(() => contract.validateHistoryRecord(written));
});

// =============================================================================
// 6. TSB-F04 provider-result contract and exact binding
// =============================================================================

function result(failureRef, overrides = {}) {
  return {
    failureRef,
    test: { title: "model title", specFile: "model/spec.cy.js" },
    classification: "UNKNOWN",
    confidence: 0.5,
    summary: "s",
    rootCause: "r",
    evidence: [],
    recommendedFix: null,
    shouldCreateBug: false,
    shouldRetry: false,
    ...overrides,
  };
}

function refsFor(failedTests) {
  return contract.buildFailureReferences(contract.validatePersistedContext(v1({ failedTests })).failedTests);
}

function bind(results, references) {
  return contract.bindProviderResults(contract.validateProviderEnvelope({ results }), references);
}

test("TSB-F04 references: deterministic, opaque, and distinct for two failures with identical content", () => {
  const same = defaultFailure();
  const refs = refsFor([same, { ...same }]);
  assert.equal(refs.length, 2);
  assert.notEqual(refs[0].failureRef, refs[1].failureRef);
  for (const ref of refs) assert.match(ref.failureRef, /^fr-[0-9a-f]{24}$/);
  assert.deepEqual(refsFor([same, { ...same }]).map((r) => r.failureRef), refs.map((r) => r.failureRef), "deterministic");
});

test("TSB-F04 binding: a valid result set binds in local order with authoritative local identity", () => {
  const refs = refsFor([defaultFailure({ title: "first" }), defaultFailure({ title: "second" })]);
  const bound = bind([result(refs[1].failureRef, { classification: "TEST_BUG" }), result(refs[0].failureRef, { classification: "ENVIRONMENT" })], refs);
  assert.deepEqual(bound.map((r) => [r.test.title, r.classification]), [["first", "ENVIRONMENT"], ["second", "TEST_BUG"]]);
  for (const r of bound) assert.equal("failureRef" in r, false);
});

test("TSB-F04 binding: missing, extra, duplicate, unknown and stale references and cardinality mismatches are rejected", () => {
  const refs = refsFor([defaultFailure({ title: "a" }), defaultFailure({ title: "b" })]);
  const stale = refsFor([defaultFailure({ title: "from another context" })])[0].failureRef;
  const [a, b] = refs.map((r) => r.failureRef);
  const cases = [
    ["missing result", [result(a)]],
    ["extra result", [result(a), result(b), result(b)]],
    ["duplicate ref", [result(a), result(a)]],
    ["unknown ref", [result(a), result(`fr-${"0".repeat(24)}`)]],
    ["stale ref", [result(a), result(stale)]],
    ["zero results", []],
  ];
  for (const [name, results] of cases) {
    assert.throws(() => bind(results, refs), errorCode(E.PROVIDER_RESULT_BINDING), name);
  }
  assert.throws(() => bind([result(a), result(b)], [refs[0]]), errorCode(E.PROVIDER_RESULT_BINDING), "multiple results for one failure");
});

test("TSB-F04 closed result contract: malformed fields, unknown properties and oversized values are rejected without echoing them", () => {
  const [ref] = refsFor([defaultFailure()]).map((r) => r.failureRef);
  const canary = "TSB_F04_CANARY";
  const cases = [
    ["classification", result(ref, { classification: canary })],
    ["confidence string", result(ref, { confidence: "0.5" })],
    ["confidence range", result(ref, { confidence: -0.1 })],
    ["unknown result property", result(ref, { approvedBy: canary })],
    ["unknown test property", result(ref, { test: { title: "t", specFile: null, suite: canary } })],
    ["missing failureRef", (() => { const r = result(ref); delete r.failureRef; return r; })()],
    ["malformed failureRef", result(`${ref}x`)],
    ["summary blank", result(ref, { summary: "   " })],
    ["summary oversized", result(ref, { summary: "s".repeat(contract.MAX_SUMMARY_LENGTH + 1) })],
    ["evidence too many", result(ref, { evidence: Array.from({ length: contract.MAX_EVIDENCE_ITEMS + 1 }, () => "e") })],
    ["evidence item oversized", result(ref, { evidence: ["e".repeat(2001)] })],
    ["evidence non-string", result(ref, { evidence: [{ text: canary }] })],
    ["recommendedFix string", result(ref, { recommendedFix: canary })],
    ["recommendedFix missing description", result(ref, { recommendedFix: { file: "f" } })],
    ["recommendedFix unknown", result(ref, { recommendedFix: { description: "d", command: canary } })],
    ["shouldRetry type", result(ref, { shouldRetry: "false" })],
  ];
  for (const [name, item] of cases) {
    assert.throws(() => contract.validateProviderEnvelope({ results: [item] }), (err) => {
      assert.equal(err.code, E.PROVIDER_RESULT_INVALID, `${name}: ${err.message}`);
      assert.ok(!err.message.includes(canary), `${name}: value echoed`);
      return true;
    });
  }
  assert.throws(() => contract.validateProviderEnvelope({ results: [], note: canary }), errorCode(E.PROVIDER_RESULT_INVALID));
  assert.throws(() => contract.validateProviderEnvelope([]), errorCode(E.PROVIDER_RESULT_INVALID));
});

test("TSB-F04 identity: a valid failureRef with a changed title/spec never renames the authoritative failed test; recommendedFix.file stays advisory", async () => {
  const ctx = v1({ failedTests: [defaultFailure({ title: "authoritative title", specFile: "cypress/e2e/real.cy.js", suite: "Real suite" })] });
  const provider = {
    name: "renaming",
    analyze: async (args) => {
      const [failed] = promptFailedTests(args);
      return JSON.stringify({ results: [result(failed.failureRef, { test: { title: "RENAMED BY MODEL", specFile: "evil/other.cy.js" }, recommendedFix: { file: "evil/other.cy.js", description: "d" } })] });
    },
  };
  const report = await analyzeFailure.buildFailureReport(ctx, { provider, history: null, relevantKnowledge: [], projectProfile: PROFILE });
  assert.deepEqual(report.results[0].test, { title: "authoritative title", fullTitle: ctx.failedTests[0].fullTitle, specFile: "cypress/e2e/real.cy.js", suite: "Real suite" });
  assert.equal(report.results[0].recommendedFix.file, "evil/other.cy.js", "advisory model output is kept as-is, never used as provenance");
  assert.ok(!JSON.stringify(report).includes("RENAMED BY MODEL"));
  assert.ok(!JSON.stringify(report).includes("failureRef"));
});

test("TSB-F04: two identical failures receive distinct references and both bind end to end", async () => {
  const same = defaultFailure();
  const ctx = v1({ failedTests: [same, { ...same }] });
  const provider = { analyze: async (args) => JSON.stringify({ results: promptFailedTests(args).map((f) => result(f.failureRef)) }) };
  const report = await analyzeFailure.buildFailureReport(ctx, { provider, history: null, relevantKnowledge: [], projectProfile: PROFILE });
  assert.equal(report.results.length, 2);
});

test("TSB-F04 fail-closed ordering: a provider-result failure through main() writes no report", async (t) => {
  const root = tempRoot(t);
  writeArtifact(root, "context.json", v1());
  MockProvider.prototype.analyze = async () => JSON.stringify({ results: [result(`fr-${"1".repeat(24)}`)] });
  let run;
  try {
    const errors = [];
    const savedError = console.error;
    const savedLog = console.log;
    const savedExit = process.exitCode;
    console.error = (...a) => errors.push(a.join(" "));
    console.log = () => {};
    try {
      await analyzeFailure.main({ projectProfile: PROFILE, repositoryRoot: root });
      run = { exitCode: process.exitCode, errors };
    } finally {
      console.error = savedError;
      console.log = savedLog;
      process.exitCode = savedExit;
    }
  } finally {
    MockProvider.prototype.analyze = ORIGINAL_ANALYZE;
  }
  assert.equal(run.exitCode, 1);
  assert.ok(run.errors.some((l) => l.includes(E.PROVIDER_RESULT_BINDING)));
  assert.equal(fs.existsSync(reportPath(root)), false);
});

test("TSB-F04 + SEC-F06-I1 preserved: malformed provider JSON still fails closed with the unchanged parse diagnostic", async () => {
  const provider = { analyze: async () => "not json" };
  await assert.rejects(analyzeFailure.buildFailureReport(v1(), { provider, history: null, relevantKnowledge: [], projectProfile: PROFILE }), /^Error: AI provider response was not valid JSON: /);
});

// =============================================================================
// 7. Producers and the aggregator (defense in depth)
// =============================================================================

const NO_REPORT_ADAPTER = { id: "cypress", collect: () => ({ testResults: { found: false }, failedTests: [], warnings: [] }) };

test("producer: collect-context fails closed without a trusted invocation and writes nothing", (t) => {
  const root = tempRoot(t);
  withInvocationEnv({}, () => {
    assert.throws(() => collectContext.main({ adapter: NO_REPORT_ADAPTER, profile: PROFILE, repositoryRoot: root }), errorCode(E.INVOCATION_MODE_REQUIRED));
  });
  assert.equal(fs.existsSync(path.join(root, "reports", "ai", "context.json")), false);
});

test("producer: in github-actions-v1 collect-context persists the trusted tuple (incl. run attempt) and the analyzer binds it; another attempt is refused", async (t) => {
  const root = tempRoot(t);
  await withInvocationEnv(VALID_GITHUB, async () => {
    collectContext.main({ adapter: NO_REPORT_ADAPTER, profile: PROFILE, repositoryRoot: root });
    const ctx = JSON.parse(fs.readFileSync(path.join(root, "reports", "ai", "context.json"), "utf8"));
    assert.equal(ctx.schemaVersion, 1);
    assert.deepEqual(
      { mode: ctx.metadata.invocationMode, repository: ctx.metadata.repository, commit: ctx.metadata.commit, runId: ctx.metadata.runId, runAttempt: ctx.metadata.runAttempt, id: ctx.metadata.localInvocationId },
      { mode: "github-actions-v1", repository: "TarasovArtem/qa-ai-agent", commit: VALID_GITHUB.GITHUB_SHA, runId: "37958667400", runAttempt: "2", id: null }
    );
    const same = await runAnalyzer(root);
    assert.notEqual(same.exitCode, 1, same.errors.join(" | "));
    assert.deepEqual(same.report.results, []);
  });
  fs.rmSync(reportPath(root));
  const rerun = await withInvocationEnv({ ...VALID_GITHUB, GITHUB_RUN_ATTEMPT: "3" }, () => runAnalyzer(root));
  assertRefused(rerun, E.CONTEXT_INVOCATION_MISMATCH);
});

test("producer: in local-v1 the same QA_AI_INVOCATION_ID spans collect-context and analyze-failure", async (t) => {
  const root = tempRoot(t);
  collectContext.main({ adapter: NO_REPORT_ADAPTER, profile: PROFILE, repositoryRoot: root });
  const ctx = JSON.parse(fs.readFileSync(path.join(root, "reports", "ai", "context.json"), "utf8"));
  assert.equal(ctx.metadata.localInvocationId, invocationState.id);
  const run = await runAnalyzer(root);
  assert.notEqual(run.exitCode, 1, run.errors.join(" | "));

  fs.rmSync(reportPath(root));
  const nextInvocation = await withInvocationEnv(localInvocationEnv(), () => runAnalyzer(root));
  assertRefused(nextInvocation, E.CONTEXT_INVOCATION_MISMATCH);
});

function browserInputs(root, browser, { context, history } = {}) {
  const dir = path.join(root, "reports", "ai", "browser-inputs", browser);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "browser-result.json"), JSON.stringify({ browser, outcome: "failure", framework: "cypress" }));
  if (context) fs.writeFileSync(path.join(dir, "context.json"), JSON.stringify(context));
  if (history) fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(history));
}

test("aggregator: forwards only a validated, invocation-bound snapshot (plus correlations); the analyzer accepts it", async (t) => {
  const root = tempRoot(t);
  browserInputs(root, "chrome", { context: v1(), history: historyRecord() });
  aggregateBrowserContext.main({ repositoryRoot: root });
  const written = JSON.parse(fs.readFileSync(path.join(root, "reports", "ai", "context.json"), "utf8"));
  assert.ok(written.browserCorrelation && written.frameworkCorrelation);
  assert.doesNotThrow(() => contract.validatePersistedContext(written));
  const run = await runAnalyzer(root);
  assert.notEqual(run.exitCode, 1, run.errors.join(" | "));
  assert.deepEqual(run.report.history, { runsConsidered: 10, passes: 7, failures: 3, retryPasses: 1 });
});

test("aggregator: a stale, malformed or embedded-History browser context is never forwarded; invalid history.json is dropped", (t) => {
  for (const context of [v1({ metadata: { localInvocationId: freshLocalInvocationId() } }), { failedTests: [defaultFailure()], metadata: {} }, v1({ extra: { history: null } })]) {
    const root = tempRoot(t);
    browserInputs(root, "chrome", { context });
    aggregateBrowserContext.main({ repositoryRoot: root });
    assert.equal(fs.existsSync(path.join(root, "reports", "ai", "context.json")), false);
  }
  const root = tempRoot(t);
  browserInputs(root, "chrome", { context: v1(), history: { ...historyRecord(), injected: "x" } });
  aggregateBrowserContext.main({ repositoryRoot: root });
  assert.ok(fs.existsSync(path.join(root, "reports", "ai", "context.json")));
  assert.equal(fs.existsSync(path.join(root, "reports", "ai", "history.json")), false);
});

test("aggregator: in github-actions-v1 a context from another attempt of the same run is not forwarded", (t) => {
  const root = tempRoot(t);
  const otherAttempt = withInvocationEnv({ ...VALID_GITHUB, GITHUB_RUN_ATTEMPT: "1" }, () => v1());
  browserInputs(root, "chrome", { context: otherAttempt });
  withInvocationEnv(VALID_GITHUB, () => aggregateBrowserContext.main({ repositoryRoot: root }));
  assert.equal(fs.existsSync(path.join(root, "reports", "ai", "context.json")), false);
});

// =============================================================================
// 8. Public / package surface
// =============================================================================

test("public surface: the contract is internal - no root export, exported signatures unchanged", () => {
  assert.deepEqual(Object.keys(publicApi.analyzeFailure), ["main"]);
  assert.deepEqual(Object.keys(publicApi.collectContext).sort(), ["main", "runCli"]);
  assert.deepEqual(Object.keys(publicApi.aggregateBrowserContext), ["main"]);
  const exported = JSON.stringify(Object.keys(publicApi));
  for (const name of Object.keys(contract)) assert.ok(!exported.includes(`"${name}"`), name);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
  assert.equal(JSON.stringify(manifest.exports).includes("triage-boundary-contract"), false);
  assert.ok(manifest.files.includes("scripts/ai"), "the internal module ships with scripts/ai without a files change");
  assert.equal(manifest.files.some((f) => f.includes("triage-boundary-contract")), false);
});
