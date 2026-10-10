"use strict";

/**
 * Test-only helpers for the Triage Boundary Contract v1 invocation
 * environment (ARCH-C2-m02 / SEC-C2-m03 hermeticity).
 *
 * Every test that depends on the trusted invocation mode explicitly sets AND
 * clears all seven invocation variables and restores the previous values
 * afterwards, so a test exercises the same trust mode locally and in a
 * GitHub Actions job (where GITHUB_ACTIONS=true and the run tuple are
 * ambient) - nothing is inherited by accident.
 */

const crypto = require("node:crypto");
const path = require("node:path");

const { resolveTrustedInvocation, invocationEvidence, CONTEXT_SCHEMA_VERSION } = require(path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "ai",
  "triage-boundary-contract.js"
));

const INVOCATION_ENV_KEYS = Object.freeze([
  "GITHUB_ACTIONS",
  "GITHUB_REPOSITORY",
  "GITHUB_SHA",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "QA_AI_INVOCATION_MODE",
  "QA_AI_INVOCATION_ID",
]);

// The documented generation obligation for a local-v1 id: 16 CSPRNG bytes.
function freshLocalInvocationId() {
  return crypto.randomBytes(16).toString("hex");
}

function localInvocationEnv(id = freshLocalInvocationId()) {
  return { QA_AI_INVOCATION_MODE: "local-v1", QA_AI_INVOCATION_ID: id };
}

function githubInvocationEnv(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "synthetic-owner/synthetic-repo",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "1001",
    GITHUB_RUN_ATTEMPT: "1",
    ...overrides,
  };
}

// Clears all seven invocation variables, then applies `values` (a value of
// undefined leaves that key cleared). Returns a restore() function.
function setInvocationEnv(values = {}) {
  const prior = new Map(INVOCATION_ENV_KEYS.map((key) => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]));
  for (const key of INVOCATION_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  return function restore() {
    for (const key of INVOCATION_ENV_KEYS) {
      const value = prior.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

// Runs fn (sync or async) under exactly `values`, always restoring.
function withInvocationEnv(values, fn) {
  const restore = setInvocationEnv(values);
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
}

// Installs beforeEach/afterEach hooks giving every test in the file a fresh
// local-v1 invocation (and no GitHub Actions authority), restored afterwards.
function useHermeticLocalInvocation({ beforeEach, afterEach }) {
  let restore = null;
  const state = { id: null };
  beforeEach(() => {
    state.id = freshLocalInvocationId();
    restore = setInvocationEnv(localInvocationEnv(state.id));
  });
  afterEach(() => {
    if (restore) restore();
    restore = null;
  });
  return state;
}

function defaultFailure(overrides = {}) {
  return {
    title: "synthetic failing test",
    fullTitle: "synthetic suite synthetic failing test",
    suite: "synthetic suite",
    specFile: "cypress/e2e/tests/synthetic.cy.js",
    status: "failed",
    duration: 100,
    error: { message: "AssertionError: synthetic", stack: "AssertionError: synthetic\n    at synthetic (synthetic.cy.js:1:1)" },
    screenshot: null,
    ...overrides,
  };
}

// A PersistedTriageContextV1 bound to the invocation trusted under the
// CURRENT environment (exactly what collect-context.js would persist).
// `profile` supplies projectId and, for failure-bearing contexts, the
// constraints the analyzer compares against.
function contextForCurrentInvocation({
  profile,
  framework = "cypress",
  failedTests = [defaultFailure()],
  metadata = {},
  relevantFiles = {},
  warnings = [],
  testResults,
  knownProjectConstraints,
  extra = {},
} = {}) {
  const invocation = resolveTrustedInvocation();
  const failed = failedTests.length;
  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    generatedAt: "2026-10-09T00:00:00.000Z",
    metadata: {
      projectId: profile.id,
      framework,
      repository: null,
      commit: null,
      branch: "main",
      runId: null,
      event: null,
      browser: "chrome",
      ci: false,
      ...invocationEvidence(invocation),
      ...metadata,
    },
    testResults: testResults || { found: true, totals: { tests: failed, passed: 0, failed, pending: 0, duration: 100 }, specs: [] },
    failedTests,
    relevantFiles,
    knownProjectConstraints: knownProjectConstraints || (failed > 0 ? [...profile.knownProjectConstraints] : []),
    warnings,
    ...extra,
  };
}

// Echo provider for the analyzer: one valid UNKNOWN result per failed test,
// echoing each failureRef (accepts analyze() args or the bare user prompt).
function promptFailedTests(input) {
  const userPrompt = typeof input === "string" ? input : input.userPrompt;
  const match = userPrompt.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(match[1]).failedTests;
}

module.exports = {
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
};
