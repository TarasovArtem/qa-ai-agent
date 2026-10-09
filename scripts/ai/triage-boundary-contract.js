/**
 * Triage Boundary Contract v1 - the ONE internal authority for the triage
 * pipeline's trust boundaries (docs/triage-boundary-contract-decision-v1.md).
 *
 * Owns, for TSB-F04 + TSB-F07 + XI-01 + XI-02:
 *
 *   - detached, frozen plain-data snapshots of untrusted input (Proxy,
 *     accessor, inherited, symbol, sparse-array and prototype-key probes
 *     are rejected before anything is read as authority);
 *   - the trusted current invocation (exactly two modes, read only from
 *     the current process environment - never from .env files, repository
 *     configuration, ProjectProfile values, persisted artifacts, provider
 *     output or a function parameter);
 *   - PersistedTriageContextV1 (closed, bounded, byte-capped context.json);
 *   - XI-01 binding of a validated context to the validated ProjectProfile
 *     and the trusted current invocation;
 *   - the closed, bounded history.json variants and their single
 *     eligibility-checked projection (XI-02);
 *   - local failure references and the closed provider-result contract
 *     with exact result-set binding and authoritative local test identity
 *     (TSB-F04).
 *
 * INTERNAL ONLY: no root export, no package export, no package `files`
 * change (scripts/ai/ is already published as a whole) and no public CLI.
 * Besides Node built-ins it depends only on qa-agent-prompt.js (the single
 * CLASSIFICATIONS source), itself a published runtime module.
 *
 * Every diagnostic below is a fixed code plus a fixed description of WHICH
 * field failed - never the persisted, environment or provider value itself.
 * Persisted invocation fields are comparison evidence only: the expected
 * value always comes from resolveTrustedInvocation().
 */

"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { types: utilTypes } = require("node:util");
const { CLASSIFICATIONS } = require("./qa-agent-prompt");

const { isProxy } = utilTypes;
const { getOwnPropertyDescriptor, getPrototypeOf, hasOwn, freeze } = Object;
const { ownKeys } = Reflect;
const { isArray } = Array;

// --- versioned constants ------------------------------------------------------

const CONTEXT_SCHEMA_VERSION = 1;

const INVOCATION_MODES = Object.freeze({
  GITHUB_ACTIONS: "github-actions-v1",
  LOCAL: "local-v1",
});

// Measured bound (see triage-boundary-contract.test.js): a maximal-
// cardinality legitimate context - MAX_FAILED_TESTS failures with realistic
// titles, messages and a full Cypress-truncated stack, plus the complete
// 150 KiB relevantFiles budget - serializes to ~3.1 MB with the producer's
// own JSON.stringify(context, null, 2). 8 MiB leaves ~2.7x headroom for
// untruncated Playwright stacks and is the same constant collect-history.js
// already uses for its bounded GitHub API responses.
const MAX_CONTEXT_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_BYTES = 64 * 1024;

// Unchanged collector limits (collect-context.js MAX_FILE_BYTES /
// MAX_TOTAL_RELEVANT_BYTES). A truncated file carries the collector's own
// fixed truncation marker after the per-file limit.
const MAX_RELEVANT_FILE_BYTES = 20 * 1024;
const MAX_TOTAL_RELEVANT_BYTES = 150 * 1024;
const RELEVANT_FILE_TRUNCATION_MARKER = "\n/* ...truncated... */";
const MAX_RELEVANT_FILES = 512;

// One provider result per failed test must fit TSB-F06's 1,000,000-character
// raw response bound; 500 leaves ~2,000 characters per legitimate result.
const MAX_FAILED_TESTS = 500;
const MAX_SPECS = 5000;
const MAX_WARNINGS = 2000;
const MAX_WARNING_LENGTH = 4096;
const MAX_TITLE_LENGTH = 4096;
const MAX_PATH_LENGTH = 1024;
const MAX_ERROR_TEXT_LENGTH = 64 * 1024;
const MAX_LABEL_LENGTH = 256;
const MAX_METADATA_TEXT_LENGTH = 2048;
const MAX_CORRELATION_BROWSERS = 16;
const MAX_CORRELATION_FRAMEWORKS = 8;

// ProjectProfile v1 bounds (project-profile.js) - persisted constraints are
// compared against the validated profile snapshot, so they share its limits.
const MAX_PROJECT_ID_LENGTH = 128;
const MAX_CONSTRAINTS = 32;
const MAX_CONSTRAINT_LENGTH = 2048;
const MAX_AGGREGATE_CONSTRAINTS_LENGTH = 8192;

// History (collect-history.js MAX_RUNS is the producer-side ceiling).
const MAX_HISTORY_RUNS = 30;
const MAX_HISTORY_REASON_LENGTH = 1024;

// Provider result fields.
const MAX_SUMMARY_LENGTH = 4000;
const MAX_ROOT_CAUSE_LENGTH = 8000;
const MAX_EVIDENCE_ITEMS = 32;
const MAX_EVIDENCE_LENGTH = 2000;
const MAX_FIX_DESCRIPTION_LENGTH = 8000;

// Generic snapshot budget (defense against deep/huge structures that are
// still inside the byte cap).
const MAX_SNAPSHOT_DEPTH = 32;
const MAX_SNAPSHOT_NODES = 250000;

// --- grammars -----------------------------------------------------------------

// owner (GitHub user/org: alphanumeric or hyphen, 1-39) "/" repository
// (alphanumeric, ".", "_", "-", 1-100; "." and ".." are rejected separately).
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const GITHUB_SHA_PATTERN = /^[0-9a-f]{40}$/;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]{0,15}$/;
const LOCAL_INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const FAILURE_REF_PATTERN = /^fr-[0-9a-f]{24}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;
const SAFE_KEY_LABEL = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const ERROR_CODES = Object.freeze({
  INVOCATION_MODE_REQUIRED: "TRIAGE_INVOCATION_MODE_REQUIRED",
  INVOCATION_MODE_UNKNOWN: "TRIAGE_INVOCATION_MODE_UNKNOWN",
  INVOCATION_MODE_CONFLICT: "TRIAGE_INVOCATION_MODE_CONFLICT",
  INVOCATION_GITHUB_INVALID: "TRIAGE_INVOCATION_GITHUB_INVALID",
  INVOCATION_LOCAL_INVALID: "TRIAGE_INVOCATION_LOCAL_INVALID",
  ARTIFACT_TOO_LARGE: "TRIAGE_ARTIFACT_TOO_LARGE",
  ARTIFACT_UNREADABLE: "TRIAGE_ARTIFACT_UNREADABLE",
  ARTIFACT_MALFORMED: "TRIAGE_ARTIFACT_MALFORMED",
  CONTEXT_INVALID: "TRIAGE_CONTEXT_INVALID",
  CONTEXT_EMBEDDED_HISTORY: "TRIAGE_CONTEXT_EMBEDDED_HISTORY",
  CONTEXT_PROJECT_MISMATCH: "TRIAGE_CONTEXT_PROJECT_MISMATCH",
  CONTEXT_CONSTRAINTS_MISMATCH: "TRIAGE_CONTEXT_CONSTRAINTS_MISMATCH",
  CONTEXT_INVOCATION_MISMATCH: "TRIAGE_CONTEXT_INVOCATION_MISMATCH",
  HISTORY_INVALID: "TRIAGE_HISTORY_INVALID",
  PROVIDER_RESULT_INVALID: "TRIAGE_PROVIDER_RESULT_INVALID",
  PROVIDER_RESULT_BINDING: "TRIAGE_PROVIDER_RESULT_BINDING",
});

class TriageBoundaryError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "TriageBoundaryError";
    this.code = code;
  }
}

function fail(code, detail) {
  throw new TriageBoundaryError(code, detail);
}

// --- detached plain-data snapshots ---------------------------------------------

function childKeyLabel(path, key) {
  return SAFE_KEY_LABEL.test(key) ? `${path}.${key}` : `${path}[<key>]`;
}

function snapshotNode(value, path, depth, budget, code) {
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_NODES) fail(code, `${path} exceeds the maximum structure size`);

  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) fail(code, `${path} must be a finite number`);
      return value;
    case "object":
      break;
    default:
      fail(code, `${path} has an unsupported value type`);
  }

  if (depth >= MAX_SNAPSHOT_DEPTH) fail(code, `${path} exceeds the maximum nesting depth`);
  if (isProxy(value)) fail(code, `${path} must not be a Proxy`);

  if (isArray(value)) {
    if (getPrototypeOf(value) !== Array.prototype) fail(code, `${path} must be a plain Array`);
    const { value: length } = getOwnPropertyDescriptor(value, "length");
    if (length > MAX_SNAPSHOT_NODES) fail(code, `${path} exceeds the maximum structure size`);
    for (const key of ownKeys(value)) {
      if (typeof key === "symbol") fail(code, `${path} must not have symbol keys`);
      if (key !== "length" && !(CANONICAL_INDEX.test(key) && Number(key) < length)) {
        fail(code, `${path} must not have non-index properties`);
      }
    }
    const out = [];
    for (let i = 0; i < length; i += 1) {
      const descriptor = getOwnPropertyDescriptor(value, String(i));
      if (descriptor === undefined) fail(code, `${path}[${i}] is missing (sparse arrays are not allowed)`);
      if (!hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
        fail(code, `${path}[${i}] must be an enumerable data property`);
      }
      out.push(snapshotNode(descriptor.value, `${path}[${i}]`, depth + 1, budget, code));
    }
    return freeze(out);
  }

  const prototype = getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code, `${path} must be a plain object`);
  const out = {};
  for (const key of ownKeys(value)) {
    if (typeof key === "symbol") fail(code, `${path} must not have symbol keys`);
    if (FORBIDDEN_KEYS.has(key)) fail(code, `${path} has a forbidden property name`);
    const descriptor = getOwnPropertyDescriptor(value, key);
    const keyPath = childKeyLabel(path, key);
    if (!hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      fail(code, `${keyPath} must be an enumerable data property`);
    }
    out[key] = snapshotNode(descriptor.value, keyPath, depth + 1, budget, code);
  }
  return freeze(out);
}

// Returns a newly allocated, deeply frozen copy built only from captured
// own enumerable data properties. Downstream code must read the snapshot,
// never the caller's object again.
function snapshotPlainData(value, label, code) {
  return snapshotNode(value, label, 0, { nodes: 0 }, code);
}

// --- field checks (operate on snapshots only) ----------------------------------

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !isArray(value);
}

function expectRecord(value, path, required, optional, code) {
  if (!isPlainRecord(value)) fail(code, `${path} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${path} has an unknown property`);
  }
  for (const key of required) {
    if (!hasOwn(value, key)) fail(code, `${path}.${key} is required`);
  }
  return value;
}

function expectString(value, path, code, { max, nullable = false, nonBlank = false, noControl = false, pattern } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "string") fail(code, `${path} must be a string${nullable ? " or null" : ""}`);
  if (value.length > max) fail(code, `${path} exceeds ${max} UTF-16 code units`);
  if (nonBlank && value.trim().length === 0) fail(code, `${path} must contain a non-whitespace character`);
  if (noControl && CONTROL_CHARACTER.test(value)) fail(code, `${path} must not contain control characters`);
  if (pattern && !pattern.test(value)) fail(code, `${path} is not in the required format`);
  return value;
}

function expectCount(value, path, code, { nullable = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null && nullable) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    fail(code, `${path} must be a non-negative safe integer${max < Number.MAX_SAFE_INTEGER ? ` <= ${max}` : ""}${nullable ? " or null" : ""}`);
  }
  return value;
}

function expectDuration(value, path, code, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    fail(code, `${path} must be a finite non-negative number${nullable ? " or null" : ""}`);
  }
  return value;
}

function expectBoolean(value, path, code, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "boolean") fail(code, `${path} must be a boolean${nullable ? " or null" : ""}`);
  return value;
}

function expectArray(value, path, code, max) {
  if (!isArray(value)) fail(code, `${path} must be an array`);
  if (value.length > max) fail(code, `${path} exceeds ${max} entries`);
  return value;
}

function expectEnum(value, path, code, allowed) {
  if (!allowed.includes(value)) fail(code, `${path} is not an allowed value`);
  return value;
}

// --- trusted current invocation (XI-01) ---------------------------------------

function readEnv(name) {
  const descriptor = getOwnPropertyDescriptor(process.env, name);
  return descriptor === undefined ? undefined : process.env[name];
}

function isCanonicalPositiveDecimal(value) {
  return typeof value === "string" && POSITIVE_DECIMAL_PATTERN.test(value) && Number(value) <= Number.MAX_SAFE_INTEGER;
}

function isGitHubRepository(value) {
  if (typeof value !== "string" || !GITHUB_REPOSITORY_PATTERN.test(value)) return false;
  const name = value.slice(value.indexOf("/") + 1);
  return name !== "." && name !== "..";
}

function isLocalInvocationId(value) {
  return typeof value === "string" && LOCAL_INVOCATION_ID_PATTERN.test(value);
}

// Selects exactly one trusted invocation mode from the CURRENT process
// environment, read once into locals, and returns a frozen
// TrustedInvocationV1. There is deliberately no parameter: no caller can
// supply or elevate the trusted value, and nothing is loaded from .env files,
// repository configuration, ProjectProfile values or persisted artifacts.
//
//   GITHUB_ACTIONS === "true"  -> github-actions-v1 (full tuple required;
//                                 any QA_AI_INVOCATION_* variable present is
//                                 contradictory state and fails closed)
//   otherwise                  -> local-v1 only via QA_AI_INVOCATION_MODE
//                                 = "local-v1" + a valid QA_AI_INVOCATION_ID
//
// Stray GITHUB_REPOSITORY/GITHUB_SHA/GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT values
// without GITHUB_ACTIONS === "true" never create CI authority. There is no
// third mode and no fallback between modes. Only the GRAMMAR of the local id
// is validated - its entropy and freshness are the orchestrator's obligation.
function resolveTrustedInvocation() {
  const githubActions = readEnv("GITHUB_ACTIONS");
  const localMode = readEnv("QA_AI_INVOCATION_MODE");
  const localId = readEnv("QA_AI_INVOCATION_ID");

  if (githubActions === "true") {
    if (localMode !== undefined || localId !== undefined) {
      fail(
        ERROR_CODES.INVOCATION_MODE_CONFLICT,
        "QA_AI_INVOCATION_MODE/QA_AI_INVOCATION_ID must not be set when GITHUB_ACTIONS is \"true\" (contradictory invocation state)"
      );
    }
    const repository = readEnv("GITHUB_REPOSITORY");
    const sha = readEnv("GITHUB_SHA");
    const runId = readEnv("GITHUB_RUN_ID");
    const runAttempt = readEnv("GITHUB_RUN_ATTEMPT");
    if (!isGitHubRepository(repository)) {
      fail(ERROR_CODES.INVOCATION_GITHUB_INVALID, "GITHUB_REPOSITORY is missing or is not a canonical owner/repository value");
    }
    if (typeof sha !== "string" || !GITHUB_SHA_PATTERN.test(sha)) {
      fail(ERROR_CODES.INVOCATION_GITHUB_INVALID, "GITHUB_SHA is missing or is not 40 lowercase hexadecimal characters");
    }
    if (!isCanonicalPositiveDecimal(runId)) {
      fail(ERROR_CODES.INVOCATION_GITHUB_INVALID, "GITHUB_RUN_ID is missing or is not a canonical positive decimal integer");
    }
    if (!isCanonicalPositiveDecimal(runAttempt)) {
      fail(ERROR_CODES.INVOCATION_GITHUB_INVALID, "GITHUB_RUN_ATTEMPT is missing or is not a canonical positive decimal integer");
    }
    return freeze({ mode: INVOCATION_MODES.GITHUB_ACTIONS, repository, sha, runId, runAttempt, localInvocationId: null });
  }

  if (localMode === undefined) {
    fail(
      ERROR_CODES.INVOCATION_MODE_REQUIRED,
      "no trusted invocation mode: set GITHUB_ACTIONS=true (GitHub Actions) or QA_AI_INVOCATION_MODE=local-v1 with a fresh QA_AI_INVOCATION_ID"
    );
  }
  if (localMode !== INVOCATION_MODES.LOCAL) {
    fail(ERROR_CODES.INVOCATION_MODE_UNKNOWN, "QA_AI_INVOCATION_MODE is not a supported invocation mode (supported: local-v1)");
  }
  if (!isLocalInvocationId(localId)) {
    fail(ERROR_CODES.INVOCATION_LOCAL_INVALID, "QA_AI_INVOCATION_ID is missing or is not exactly 32 lowercase hexadecimal characters");
  }
  return freeze({ mode: INVOCATION_MODES.LOCAL, repository: null, sha: null, runId: null, runAttempt: null, localInvocationId: localId });
}

// The invocation evidence a producer persists into context.metadata. In
// github-actions-v1 repository/commit/runId come from the trusted tuple
// itself (overriding any git-derived fallback); in local-v1 only the
// invocation id is authoritative and the other metadata stays the
// producer's ordinary best-effort evidence.
function invocationEvidence(invocation) {
  if (invocation.mode === INVOCATION_MODES.GITHUB_ACTIONS) {
    return {
      invocationMode: invocation.mode,
      repository: invocation.repository,
      commit: invocation.sha,
      runId: invocation.runId,
      runAttempt: invocation.runAttempt,
      localInvocationId: null,
    };
  }
  return { invocationMode: invocation.mode, runAttempt: null, localInvocationId: invocation.localInvocationId };
}

// --- bounded artifact reads ------------------------------------------------------

const UTF8 = new TextDecoder("utf-8", { fatal: true });

// Reads at most maxBytes + 1 bytes from an already containment-checked
// absolute path, BEFORE any complete buffering or JSON parsing, rejecting
// an over-bound file instead of truncating it. Invalid UTF-8 and malformed
// JSON fail closed with fixed messages (never the parser's own text).
function readBoundedJsonFile(absPath, maxBytes, label) {
  let fd;
  let raw;
  try {
    fd = fs.openSync(absPath, "r");
    if (!fs.fstatSync(fd).isFile()) fail(ERROR_CODES.ARTIFACT_UNREADABLE, `${label} is not a regular file`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const read = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (read === 0) break;
      total += read;
    }
    if (total > maxBytes) fail(ERROR_CODES.ARTIFACT_TOO_LARGE, `${label} exceeds the maximum of ${maxBytes} bytes`);
    raw = buffer.subarray(0, total);
  } catch (err) {
    if (err instanceof TriageBoundaryError) throw err;
    fail(ERROR_CODES.ARTIFACT_UNREADABLE, `${label} could not be read`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  let text;
  try {
    text = UTF8.decode(raw);
  } catch {
    fail(ERROR_CODES.ARTIFACT_MALFORMED, `${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(ERROR_CODES.ARTIFACT_MALFORMED, `${label} is not valid JSON`);
  }
  return undefined;
}

// --- PersistedTriageContextV1 (TSB-F07) ------------------------------------------

const CONTEXT_REQUIRED = Object.freeze([
  "schemaVersion",
  "generatedAt",
  "metadata",
  "testResults",
  "failedTests",
  "relevantFiles",
  "knownProjectConstraints",
  "warnings",
]);
const CONTEXT_OPTIONAL = Object.freeze(["browserCorrelation", "frameworkCorrelation"]);
const METADATA_REQUIRED = Object.freeze([
  "projectId",
  "framework",
  "invocationMode",
  "repository",
  "commit",
  "branch",
  "runId",
  "runAttempt",
  "localInvocationId",
  "event",
  "browser",
  "ci",
]);
// Required: the generic normalized-failure minimum every adapter emits
// (normalized-failure.js). Optional: the exact extras today's Cypress and
// Playwright adapters attach - validated when present; any other key is
// rejected (closed shape).
const FAILURE_REQUIRED = Object.freeze(["title", "fullTitle", "specFile", "error"]);
const FAILURE_OPTIONAL = Object.freeze(["suite", "status", "duration", "screenshot", "projectId", "projectName"]);
const COUNT_FIELDS = Object.freeze(["tests", "passed", "failed", "pending"]);

function validateMetadata(metadata) {
  const code = ERROR_CODES.CONTEXT_INVALID;
  const p = "context.metadata";
  expectRecord(metadata, p, METADATA_REQUIRED, [], code);
  expectString(metadata.projectId, `${p}.projectId`, code, { max: MAX_PROJECT_ID_LENGTH, nonBlank: true, noControl: true });
  // Any adapter's own stable identity (framework equality is never derived
  // from an implicit Cypress default - design section 8).
  expectString(metadata.framework, `${p}.framework`, code, { max: MAX_LABEL_LENGTH, nonBlank: true, noControl: true });
  expectEnum(metadata.invocationMode, `${p}.invocationMode`, code, [INVOCATION_MODES.GITHUB_ACTIONS, INVOCATION_MODES.LOCAL]);
  for (const key of ["repository", "commit", "branch", "runId", "event", "browser"]) {
    expectString(metadata[key], `${p}.${key}`, code, { max: MAX_METADATA_TEXT_LENGTH, nullable: true, noControl: true });
  }
  expectBoolean(metadata.ci, `${p}.ci`, code);

  if (metadata.invocationMode === INVOCATION_MODES.GITHUB_ACTIONS) {
    if (!isGitHubRepository(metadata.repository)) fail(code, `${p}.repository is not a canonical owner/repository value`);
    expectString(metadata.commit, `${p}.commit`, code, { max: 40, pattern: GITHUB_SHA_PATTERN });
    if (!isCanonicalPositiveDecimal(metadata.runId)) fail(code, `${p}.runId is not a canonical positive decimal integer`);
    if (!isCanonicalPositiveDecimal(metadata.runAttempt)) fail(code, `${p}.runAttempt is not a canonical positive decimal integer`);
    if (metadata.localInvocationId !== null) fail(code, `${p}.localInvocationId must be null in github-actions-v1`);
  } else {
    if (!isLocalInvocationId(metadata.localInvocationId)) {
      fail(code, `${p}.localInvocationId is not exactly 32 lowercase hexadecimal characters`);
    }
    if (metadata.runAttempt !== null) fail(code, `${p}.runAttempt must be null in local-v1`);
  }
}

function validateTestResults(testResults) {
  const code = ERROR_CODES.CONTEXT_INVALID;
  const p = "context.testResults";
  if (!isPlainRecord(testResults)) fail(code, `${p} must be an object`);
  if (testResults.found === false) {
    expectRecord(testResults, p, ["found"], [], code);
    return;
  }
  expectRecord(testResults, p, ["found", "totals", "specs"], [], code);
  if (testResults.found !== true) fail(code, `${p}.found must be a boolean`);
  expectRecord(testResults.totals, `${p}.totals`, [...COUNT_FIELDS, "duration"], [], code);
  for (const key of COUNT_FIELDS) expectCount(testResults.totals[key], `${p}.totals.${key}`, code);
  expectDuration(testResults.totals.duration, `${p}.totals.duration`, code);
  expectArray(testResults.specs, `${p}.specs`, code, MAX_SPECS);
  testResults.specs.forEach((spec, i) => {
    const sp = `${p}.specs[${i}]`;
    expectRecord(spec, sp, ["specFile", ...COUNT_FIELDS, "duration"], [], code);
    expectString(spec.specFile, `${sp}.specFile`, code, { max: MAX_PATH_LENGTH, nullable: true });
    // Cypress per-spec stats are legitimately nullable (mochawesome stats
    // may be absent); Playwright always supplies numbers.
    for (const key of COUNT_FIELDS) expectCount(spec[key], `${sp}.${key}`, code, { nullable: true });
    expectDuration(spec.duration, `${sp}.duration`, code, { nullable: true });
  });
}

function validateFailure(failure, i) {
  const code = ERROR_CODES.CONTEXT_INVALID;
  const p = `context.failedTests[${i}]`;
  expectRecord(failure, p, FAILURE_REQUIRED, FAILURE_OPTIONAL, code);
  expectString(failure.title, `${p}.title`, code, { max: MAX_TITLE_LENGTH, nullable: true });
  expectString(failure.fullTitle, `${p}.fullTitle`, code, { max: MAX_TITLE_LENGTH, nullable: true });
  expectString(failure.specFile, `${p}.specFile`, code, { max: MAX_PATH_LENGTH, nullable: true });
  expectRecord(failure.error, `${p}.error`, ["message", "stack"], [], code);
  expectString(failure.error.message, `${p}.error.message`, code, { max: MAX_ERROR_TEXT_LENGTH, nullable: true });
  expectString(failure.error.stack, `${p}.error.stack`, code, { max: MAX_ERROR_TEXT_LENGTH, nullable: true });
  if (hasOwn(failure, "suite")) expectString(failure.suite, `${p}.suite`, code, { max: MAX_TITLE_LENGTH, nullable: true });
  if (hasOwn(failure, "status") && failure.status !== "failed") fail(code, `${p}.status must be "failed"`);
  if (hasOwn(failure, "duration")) expectDuration(failure.duration, `${p}.duration`, code, { nullable: true });
  if (hasOwn(failure, "screenshot")) expectString(failure.screenshot, `${p}.screenshot`, code, { max: MAX_PATH_LENGTH, nullable: true });
  // Playwright's own per-execution project (e.g. "chromium") - unrelated
  // to ProjectProfile.id; present only when the adapter emitted it.
  if (hasOwn(failure, "projectId")) {
    expectString(failure.projectId, `${p}.projectId`, code, { max: MAX_LABEL_LENGTH, nonBlank: true });
  }
  if (hasOwn(failure, "projectName")) {
    expectString(failure.projectName, `${p}.projectName`, code, { max: MAX_LABEL_LENGTH, nonBlank: true });
  }
}

function validateRelevantFiles(relevantFiles) {
  const code = ERROR_CODES.CONTEXT_INVALID;
  const p = "context.relevantFiles";
  if (!isPlainRecord(relevantFiles)) fail(code, `${p} must be an object`);
  const keys = Object.keys(relevantFiles);
  if (keys.length > MAX_RELEVANT_FILES) fail(code, `${p} exceeds ${MAX_RELEVANT_FILES} entries`);
  let aggregate = 0;
  keys.forEach((key, i) => {
    const ep = `${p}[${i}]`;
    expectString(key, `${ep} path`, code, { max: MAX_PATH_LENGTH, nonBlank: true, noControl: true });
    const entry = relevantFiles[key];
    expectRecord(entry, ep, ["content", "truncated"], [], code);
    expectBoolean(entry.truncated, `${ep}.truncated`, code);
    const max = entry.truncated ? MAX_RELEVANT_FILE_BYTES + RELEVANT_FILE_TRUNCATION_MARKER.length : MAX_RELEVANT_FILE_BYTES;
    expectString(entry.content, `${ep}.content`, code, { max });
    aggregate += entry.content.length;
  });
  if (aggregate > MAX_TOTAL_RELEVANT_BYTES) fail(code, `${p} aggregate content exceeds ${MAX_TOTAL_RELEVANT_BYTES}`);
}

function validateConstraints(constraints) {
  const code = ERROR_CODES.CONTEXT_INVALID;
  const p = "context.knownProjectConstraints";
  expectArray(constraints, p, code, MAX_CONSTRAINTS);
  let aggregate = 0;
  constraints.forEach((entry, i) => {
    expectString(entry, `${p}[${i}]`, code, { max: MAX_CONSTRAINT_LENGTH, nonBlank: true, noControl: true });
    aggregate += entry.length;
  });
  if (aggregate > MAX_AGGREGATE_CONSTRAINTS_LENGTH) fail(code, `${p} aggregate length exceeds ${MAX_AGGREGATE_CONSTRAINTS_LENGTH}`);
}

function validateBrowserList(value, path) {
  const code = ERROR_CODES.CONTEXT_INVALID;
  expectArray(value, path, code, MAX_CORRELATION_BROWSERS);
  value.forEach((entry, i) => expectString(entry, `${path}[${i}]`, code, { max: MAX_LABEL_LENGTH, nonBlank: true, noControl: true }));
}

function validateBrowserCorrelation(value) {
  if (value === null) return;
  const code = ERROR_CODES.CONTEXT_INVALID;
  const p = "context.browserCorrelation";
  expectRecord(
    value,
    p,
    ["browsers", "failedBrowsers", "passedBrowsers", "primaryBrowser", "additionalFailedBrowsers", "failureScope", "sameFailureSignature"],
    [],
    code
  );
  for (const key of ["browsers", "failedBrowsers", "passedBrowsers", "additionalFailedBrowsers"]) validateBrowserList(value[key], `${p}.${key}`);
  expectString(value.primaryBrowser, `${p}.primaryBrowser`, code, { max: MAX_LABEL_LENGTH, nullable: true, noControl: true });
  expectEnum(value.failureScope, `${p}.failureScope`, code, ["single-browser", "multi-browser"]);
  expectBoolean(value.sameFailureSignature, `${p}.sameFailureSignature`, code, { nullable: true });
}

function validateFrameworkCorrelation(value) {
  if (value === null) return;
  const code = ERROR_CODES.CONTEXT_INVALID;
  const p = "context.frameworkCorrelation";
  expectRecord(value, p, ["primaryFramework", "outcomes"], [], code);
  expectString(value.primaryFramework, `${p}.primaryFramework`, code, { max: MAX_LABEL_LENGTH, nullable: true, noControl: true });
  expectArray(value.outcomes, `${p}.outcomes`, code, MAX_CORRELATION_FRAMEWORKS);
  value.outcomes.forEach((outcome, i) => {
    const op = `${p}.outcomes[${i}]`;
    expectRecord(outcome, op, ["framework", "outcome"], [], code);
    expectString(outcome.framework, `${op}.framework`, code, { max: MAX_LABEL_LENGTH, nonBlank: true, noControl: true });
    expectEnum(outcome.outcome, `${op}.outcome`, code, ["success", "failure"]);
  });
}

// Validates PersistedTriageContextV1 and returns its detached, deeply frozen
// snapshot. Embedded `history` is rejected with its own XI-02 code before
// the generic closed-shape check, so History can only ever come from a
// separately validated history.json.
function validatePersistedContext(input) {
  const code = ERROR_CODES.CONTEXT_INVALID;
  const context = snapshotPlainData(input, "context", code);
  if (!isPlainRecord(context)) fail(code, "context must be an object");
  if (hasOwn(context, "history")) {
    fail(ERROR_CODES.CONTEXT_EMBEDDED_HISTORY, "context.history is not an accepted History source; History comes only from a separately validated history.json");
  }
  expectRecord(context, "context", CONTEXT_REQUIRED, CONTEXT_OPTIONAL, code);
  if (context.schemaVersion !== CONTEXT_SCHEMA_VERSION) fail(code, `context.schemaVersion must be ${CONTEXT_SCHEMA_VERSION}`);
  expectString(context.generatedAt, "context.generatedAt", code, { max: 64, pattern: ISO_TIMESTAMP_PATTERN });
  validateMetadata(context.metadata);
  validateTestResults(context.testResults);
  expectArray(context.failedTests, "context.failedTests", code, MAX_FAILED_TESTS);
  context.failedTests.forEach(validateFailure);
  validateRelevantFiles(context.relevantFiles);
  validateConstraints(context.knownProjectConstraints);
  expectArray(context.warnings, "context.warnings", code, MAX_WARNINGS);
  context.warnings.forEach((w, i) => expectString(w, `context.warnings[${i}]`, code, { max: MAX_WARNING_LENGTH }));
  if (hasOwn(context, "browserCorrelation")) validateBrowserCorrelation(context.browserCorrelation);
  if (hasOwn(context, "frameworkCorrelation")) validateFrameworkCorrelation(context.frameworkCorrelation);
  return context;
}

function readPersistedContext(absPath, label = "reports/ai/context.json") {
  return validatePersistedContext(readBoundedJsonFile(absPath, MAX_CONTEXT_BYTES, label));
}

// --- XI-01 binding ------------------------------------------------------------------

function sameStringArray(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// Binds a VALIDATED context snapshot to the validated ProjectProfile
// snapshot and the trusted current invocation. Expected values always come
// from `profile` / `invocation`; the persisted fields are evidence only and
// are never echoed into the diagnostic. Zero-failure contexts are not
// exempt (they may only keep the producer's legitimate empty constraints).
function bindContextToInvocation(context, profile, invocation) {
  const m = context.metadata;
  if (m.projectId !== profile.id) {
    fail(ERROR_CODES.CONTEXT_PROJECT_MISMATCH, "context.metadata.projectId does not match the validated ProjectProfile");
  }
  const constraints = context.knownProjectConstraints;
  const constraintsMatch =
    sameStringArray(constraints, profile.knownProjectConstraints) || (context.failedTests.length === 0 && constraints.length === 0);
  if (!constraintsMatch) {
    fail(ERROR_CODES.CONTEXT_CONSTRAINTS_MISMATCH, "context.knownProjectConstraints do not match the validated ProjectProfile");
  }
  return bindContextToCurrentInvocation(context, invocation);
}

// The invocation-freshness half of the XI-01 binding, usable where no
// ProjectProfile exists (aggregate-browser-context.js defense-in-depth).
// The analyzer always applies the full bindContextToInvocation().
function bindContextToCurrentInvocation(context, invocation) {
  const m = context.metadata;
  if (m.invocationMode !== invocation.mode) {
    fail(ERROR_CODES.CONTEXT_INVOCATION_MISMATCH, "context.metadata.invocationMode does not match the trusted current invocation mode");
  }
  if (invocation.mode === INVOCATION_MODES.GITHUB_ACTIONS) {
    const pairs = [
      ["repository", m.repository, invocation.repository],
      ["commit", m.commit, invocation.sha],
      ["runId", m.runId, invocation.runId],
      ["runAttempt", m.runAttempt, invocation.runAttempt],
    ];
    for (const [field, persisted, trusted] of pairs) {
      if (persisted !== trusted) {
        fail(ERROR_CODES.CONTEXT_INVOCATION_MISMATCH, `context.metadata.${field} does not match the trusted current GitHub Actions invocation`);
      }
    }
  } else if (m.localInvocationId !== invocation.localInvocationId) {
    fail(ERROR_CODES.CONTEXT_INVOCATION_MISMATCH, "context.metadata.localInvocationId does not match the trusted current local-v1 invocation");
  }
  return context;
}

// --- History (XI-02) ------------------------------------------------------------------

const HISTORY_AVAILABLE_KEYS = Object.freeze([
  "available",
  "projectId",
  "framework",
  "browser",
  "branch",
  "runsConsidered",
  "passes",
  "failures",
  "retryPasses",
  "generatedAt",
]);

// Closed history.json variants: an available record (bounded, arithmetically
// consistent) or an unavailable marker with bounded reason text. Returns a
// detached frozen snapshot; anything else throws HISTORY_INVALID.
function validateHistoryRecord(input) {
  const code = ERROR_CODES.HISTORY_INVALID;
  const record = snapshotPlainData(input, "history", code);
  if (!isPlainRecord(record)) fail(code, "history must be an object");
  if (record.available === false) {
    expectRecord(record, "history", ["available", "reason"], [], code);
    expectString(record.reason, "history.reason", code, { max: MAX_HISTORY_REASON_LENGTH });
    return record;
  }
  expectRecord(record, "history", HISTORY_AVAILABLE_KEYS, [], code);
  if (record.available !== true) fail(code, "history.available must be a boolean");
  expectString(record.projectId, "history.projectId", code, { max: MAX_PROJECT_ID_LENGTH, nonBlank: true, noControl: true });
  expectString(record.framework, "history.framework", code, { max: MAX_LABEL_LENGTH, nonBlank: true, noControl: true });
  expectString(record.browser, "history.browser", code, { max: MAX_LABEL_LENGTH, nonBlank: true, noControl: true });
  expectString(record.branch, "history.branch", code, { max: MAX_METADATA_TEXT_LENGTH, nonBlank: true, noControl: true });
  expectString(record.generatedAt, "history.generatedAt", code, { max: 64, pattern: ISO_TIMESTAMP_PATTERN });
  if (!isValidHistoryMetrics(record)) fail(code, "history metrics are not bounded, non-negative and arithmetically consistent");
  return record;
}

// Non-negative safe integers within the producer's run ceiling, with
// passes + failures === runsConsidered and retryPasses <= passes.
function isValidHistoryMetrics(record) {
  const fields = [record.runsConsidered, record.passes, record.failures, record.retryPasses];
  if (!fields.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_HISTORY_RUNS)) return false;
  if (record.passes + record.failures !== record.runsConsidered) return false;
  if (record.retryPasses > record.passes) return false;
  return true;
}

// The ONE provider-/report-visible History projection. null means "no
// usable history" (unavailable, wrong project, wrong framework) and is
// never converted into fabricated zero counters; a legitimate record with
// zero counts stays distinguishable. History is deliberately cross-run, so
// it is not bound to the current run/invocation id.
function projectHistory(record, contextMetadata) {
  if (!record || record.available !== true) return null;
  if (record.projectId !== contextMetadata.projectId) return null;
  if (record.framework !== contextMetadata.framework) return null;
  return freeze({
    runsConsidered: record.runsConsidered,
    passes: record.passes,
    failures: record.failures,
    retryPasses: record.retryPasses,
  });
}

// For an injected (non-file) History value: accepts only null or exactly the
// four-counter projection shape, returning a detached frozen copy.
function validateHistoryProjection(input) {
  if (input === null || input === undefined) return null;
  const code = ERROR_CODES.HISTORY_INVALID;
  const value = snapshotPlainData(input, "history", code);
  expectRecord(value, "history", ["runsConsidered", "passes", "failures", "retryPasses"], [], code);
  if (!isValidHistoryMetrics(value)) fail(code, "history metrics are not bounded, non-negative and arithmetically consistent");
  return value;
}

// --- failure references + provider results (TSB-F04) -------------------------------------

function failureIdentity(failure) {
  const identity = {
    title: failure.title,
    fullTitle: failure.fullTitle,
    specFile: failure.specFile,
    suite: hasOwn(failure, "suite") ? failure.suite : null,
  };
  if (hasOwn(failure, "projectId")) identity.projectId = failure.projectId;
  if (hasOwn(failure, "projectName")) identity.projectName = failure.projectName;
  return freeze(identity);
}

// One deterministic, opaque local reference per current failed test, built
// from the authoritative snapshot BEFORE any provider call. The local index
// is part of the hashed material, so two failures with identical content
// still receive distinct references. A reference only proves set membership
// and correlation - never the correctness of the model's reasoning.
function buildFailureReferences(failedTests) {
  const seen = new Set();
  return freeze(
    failedTests.map((failure, index) => {
      const identity = failureIdentity(failure);
      const material = JSON.stringify([index, identity, failure.error.message, failure.error.stack]);
      const failureRef = `fr-${crypto.createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
      if (seen.has(failureRef)) fail(ERROR_CODES.PROVIDER_RESULT_BINDING, "failure reference collision");
      seen.add(failureRef);
      return freeze({ failureRef, index, identity });
    })
  );
}

const RESULT_REQUIRED = Object.freeze([
  "failureRef",
  "test",
  "classification",
  "confidence",
  "summary",
  "rootCause",
  "evidence",
  "recommendedFix",
  "shouldCreateBug",
  "shouldRetry",
]);

function validateProviderResult(item, i) {
  const code = ERROR_CODES.PROVIDER_RESULT_INVALID;
  const p = `results[${i}]`;
  expectRecord(item, p, RESULT_REQUIRED, [], code);
  expectString(item.failureRef, `${p}.failureRef`, code, { max: 64, pattern: FAILURE_REF_PATTERN });
  // Echoed for readability only - never authoritative test identity.
  expectRecord(item.test, `${p}.test`, ["title"], ["specFile"], code);
  expectString(item.test.title, `${p}.test.title`, code, { max: MAX_TITLE_LENGTH });
  if (hasOwn(item.test, "specFile")) expectString(item.test.specFile, `${p}.test.specFile`, code, { max: MAX_PATH_LENGTH, nullable: true });
  if (!CLASSIFICATIONS.includes(item.classification)) fail(code, `${p}.classification must be one of ${CLASSIFICATIONS.join(", ")}`);
  if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
    fail(code, `${p}.confidence must be a number between 0 and 1`);
  }
  expectString(item.summary, `${p}.summary`, code, { max: MAX_SUMMARY_LENGTH, nonBlank: true });
  expectString(item.rootCause, `${p}.rootCause`, code, { max: MAX_ROOT_CAUSE_LENGTH, nonBlank: true });
  expectArray(item.evidence, `${p}.evidence`, code, MAX_EVIDENCE_ITEMS);
  item.evidence.forEach((e, j) => expectString(e, `${p}.evidence[${j}]`, code, { max: MAX_EVIDENCE_LENGTH }));
  if (item.recommendedFix !== null) {
    // `file` is advisory model output, never authoritative provenance.
    expectRecord(item.recommendedFix, `${p}.recommendedFix`, ["description"], ["file"], code);
    expectString(item.recommendedFix.description, `${p}.recommendedFix.description`, code, { max: MAX_FIX_DESCRIPTION_LENGTH });
    if (hasOwn(item.recommendedFix, "file")) {
      expectString(item.recommendedFix.file, `${p}.recommendedFix.file`, code, { max: MAX_PATH_LENGTH, nullable: true });
    }
  }
  expectBoolean(item.shouldCreateBug, `${p}.shouldCreateBug`, code);
  expectBoolean(item.shouldRetry, `${p}.shouldRetry`, code);
}

// Validates the parsed provider envelope (closed: exactly `results`) and
// returns its detached frozen result array.
function validateProviderEnvelope(parsed) {
  const code = ERROR_CODES.PROVIDER_RESULT_INVALID;
  const envelope = snapshotPlainData(parsed, "response", code);
  expectRecord(envelope, "response", ["results"], [], code);
  expectArray(envelope.results, "response.results", code, MAX_FAILED_TESTS);
  envelope.results.forEach(validateProviderResult);
  return envelope.results;
}

// Exact result-set binding: exactly one result per expected reference, no
// unknown/duplicate/missing reference and exact cardinality. Returns results
// in local failure order with `test` reconstructed from the authoritative
// local snapshot (the model's own title/spec text is discarded) and
// `failureRef` dropped (internal, never a persisted report field).
function bindProviderResults(results, references) {
  const code = ERROR_CODES.PROVIDER_RESULT_BINDING;
  if (results.length !== references.length) {
    fail(code, `provider returned ${results.length} result(s) for ${references.length} failed test(s)`);
  }
  const expected = new Map(references.map((ref) => [ref.failureRef, ref]));
  const byRef = new Map();
  results.forEach((item, i) => {
    if (!expected.has(item.failureRef)) fail(code, `results[${i}].failureRef does not reference a current failed test`);
    if (byRef.has(item.failureRef)) fail(code, `results[${i}].failureRef duplicates another result`);
    byRef.set(item.failureRef, item);
  });
  return references.map((ref) => {
    const item = byRef.get(ref.failureRef);
    if (!item) fail(code, "a current failed test has no provider result");
    return {
      test: { ...ref.identity },
      classification: item.classification,
      confidence: item.confidence,
      summary: item.summary,
      rootCause: item.rootCause,
      evidence: [...item.evidence],
      recommendedFix: item.recommendedFix === null ? null : { ...item.recommendedFix },
      shouldCreateBug: item.shouldCreateBug,
      shouldRetry: item.shouldRetry,
    };
  });
}

module.exports = {
  CONTEXT_SCHEMA_VERSION,
  INVOCATION_MODES,
  ERROR_CODES,
  MAX_CONTEXT_BYTES,
  MAX_HISTORY_BYTES,
  MAX_RELEVANT_FILE_BYTES,
  MAX_TOTAL_RELEVANT_BYTES,
  RELEVANT_FILE_TRUNCATION_MARKER,
  MAX_FAILED_TESTS,
  MAX_HISTORY_RUNS,
  MAX_HISTORY_REASON_LENGTH,
  MAX_EVIDENCE_ITEMS,
  MAX_SUMMARY_LENGTH,
  TriageBoundaryError,
  snapshotPlainData,
  resolveTrustedInvocation,
  invocationEvidence,
  readBoundedJsonFile,
  validatePersistedContext,
  readPersistedContext,
  bindContextToInvocation,
  bindContextToCurrentInvocation,
  validateHistoryRecord,
  isValidHistoryMetrics,
  projectHistory,
  validateHistoryProjection,
  buildFailureReferences,
  validateProviderEnvelope,
  bindProviderResults,
};
