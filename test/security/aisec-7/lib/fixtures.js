/**
 * AISEC-7 harness-local fixtures. Safe synthetic verification only:
 *   - every filesystem mutation happens under a fresh os.tmpdir() root
 *     created here and removed by cleanupRoots();
 *   - globalThis.fetch is replaced by a scripted stub that never opens a
 *     socket; an unscripted call throws instead of reaching a network;
 *   - child_process.spawn is replaced by an interceptor that records the
 *     call and returns an inert fake child; nothing is ever launched;
 *   - identities, tokens and canaries are inert dummy strings.
 * Production modules are only required and called, never modified.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const AI = path.join(REPO_ROOT, "scripts", "ai");
const GOVERNANCE = path.join(REPO_ROOT, "scripts", "governance");

// Triage Boundary Contract v1 invocation-environment helpers (shared test
// helper; set/clear/restore only - it reads no secret).
const invocationEnv = require(path.join(REPO_ROOT, "test", "helpers", "triage-invocation-env.js"));
const { buildFailureReferences } = require(path.join(AI, "triage-boundary-contract.js"));

/** Inert, run-unique canary. Never a real secret. */
function canary(label) {
  return `AISEC7_CANARY_${label}_${crypto.randomBytes(6).toString("hex")}`;
}

const DUMMY_TOKEN = "aisec7-dummy-token-not-a-secret";

/** Names from `names` that are currently unset - the only ones the harness may set. */
function unsetEnvNames(names) {
  return names.filter((n) => !Object.prototype.hasOwnProperty.call(process.env, n));
}

// --- synthetic temp roots ---------------------------------------------------

const createdRoots = new Set();

function makeTempRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aisec7-${label}-`));
  createdRoots.add(root);
  return root;
}

function cleanupRoots() {
  for (const root of createdRoots) fs.rmSync(root, { recursive: true, force: true });
  createdRoots.clear();
}

function writeJson(root, relPath, value) {
  if (!createdRoots.has(root)) throw new Error("AISEC-7 fixtures: refusing to write outside a harness-created temp root");
  const file = path.join(root, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf8");
  return file;
}

function readJson(root, relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relPath.split("/")), "utf8"));
}

/** Lists every file under `root` as sorted repo-relative paths. */
function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

// --- fetch stub ---------------------------------------------------------------

/**
 * Replaces globalThis.fetch for the duration of `fn` with a scripted stub.
 * `respond(call, index)` returns a Response, or throws to simulate a
 * transport failure. Every call (url, method, headers, redirect, body) is
 * recorded. The original fetch is always restored.
 */
async function withFetchStub(respond, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method, headers: { ...(init.headers || {}) }, redirect: init.redirect, body: init.body };
    calls.push(call);
    if (typeof respond !== "function") throw new Error("AISEC-7 fetch stub: unscripted network call refused");
    return respond(call, calls.length - 1);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// --- spawn interceptor ----------------------------------------------------------

/**
 * Replaces child_process.spawn for the duration of `fn`. Nothing is launched:
 * each call is recorded and answered by an inert fake child that exits with
 * `exitCode`, or `onSpawn` may throw to simulate a spawn failure.
 */
async function withSpawnInterceptor(fn, { exitCode = 0, onSpawn } = {}) {
  const original = childProcess.spawn;
  const calls = [];
  childProcess.spawn = (executable, args, options) => {
    calls.push({ executable, args: [...args], options: { ...options, env: options && options.env ? { ...options.env } : options && options.env } });
    if (onSpawn) onSpawn();
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    setImmediate(() => child.emit("close", exitCode));
    return child;
  };
  try {
    return await fn(calls);
  } finally {
    childProcess.spawn = original;
  }
}

// --- providers ----------------------------------------------------------------

/** Scripted fake provider: answers in order, records every prompt. */
function scriptedProvider(responses) {
  const calls = [];
  return {
    calls,
    provider: {
      name: "aisec7-scripted",
      async analyze(args) {
        calls.push(args);
        const response = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (typeof response === "function") return response(args);
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}

/**
 * Echo provider for the triage analyzer: one valid UNKNOWN result per failed
 * test, echoing each prompt-visible failureRef (TSB-F04). Accepts the
 * analyze() args object or the bare user prompt.
 */
function triageEchoResponse(input) {
  const userPrompt = typeof input === "string" ? input : input.userPrompt;
  const match = userPrompt.match(/```json\s*([\s\S]*?)\s*```/);
  const payload = JSON.parse(match[1]);
  return JSON.stringify({
    results: payload.failedTests.map((t) => ({
      failureRef: t.failureRef,
      test: { title: t.title, specFile: t.specFile },
      classification: "UNKNOWN",
      confidence: 0.1,
      summary: "synthetic",
      rootCause: "synthetic",
      evidence: [],
      recommendedFix: null,
      shouldCreateBug: false,
      shouldRetry: false,
    })),
  });
}

/** Extracts the JSON payload the triage prompt actually sent. */
function promptPayload(userPrompt) {
  const match = userPrompt.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(match[1]);
}

// --- triage fixtures ---------------------------------------------------------------

function projectProfile(id) {
  return { id, displayName: `Synthetic ${id}`, knownProjectConstraints: [`Synthetic constraint for ${id}.`] };
}

// A PersistedTriageContextV1 for `projectId`, carrying the invocation
// evidence of the CURRENT (test-set) trusted invocation - i.e. what the real
// collector would persist right now. `metadata` overrides are applied last,
// so a test can forge stale/foreign invocation evidence explicitly.
function triageContext({ projectId, framework = "cypress", errorMessage = "synthetic failure", extras = {}, metadata = {}, embeddedHistory, generatedAt, knownProjectConstraints } = {}) {
  const context = invocationEnv.contextForCurrentInvocation({
    profile: projectProfile(projectId),
    knownProjectConstraints,
    framework,
    failedTests: [{ title: "synthetic test", fullTitle: "synthetic suite synthetic test", specFile: "cypress/e2e/tests/synthetic.cy.js", error: { message: errorMessage, stack: "at synthetic (synthetic.cy.js:1:1)" }, ...extras }],
    metadata: { browser: "chrome", ci: true, branch: "main", event: "push", ...metadata },
  });
  if (generatedAt) context.generatedAt = generatedAt;
  if (embeddedHistory !== undefined) context.history = embeddedHistory;
  return context;
}

// The context as the analyzer hands it to runProviderAnalysis(): each failed
// test carries its opaque local failureRef.
function withFailureRefs(context) {
  const refs = buildFailureReferences(context.failedTests);
  return { ...context, failedTests: context.failedTests.map((f, i) => ({ ...f, failureRef: refs[i].failureRef })) };
}

// A complete, closed history.json record (XI-02).
function historyRecord(overrides = {}) {
  return { available: true, projectId: "unset", framework: "cypress", browser: "chrome", branch: "main", runsConsidered: 10, passes: 8, failures: 2, retryPasses: 1, generatedAt: "2026-10-07T00:00:00.000Z", ...overrides };
}

// --- #23D-#23F chain fixtures -----------------------------------------------------------

const {
  buildGeneratedChangeSet,
  computeDigest: gcsDigest,
  LABEL_FILE_CONTENT,
} = require(path.join(AI, "test-automation", "generated-change-set"));
const { buildGeneratedChangeSetReviewPackage } = require(path.join(AI, "test-automation", "generated-change-set-review-package"));
const { buildGeneratedChangeSetReviewRecord } = require(path.join(AI, "test-automation", "generated-change-set-review-record"));

const OLD_CONTENT = "describe('aisec7 existing', () => {});";
const OLD_DIGEST = gcsDigest(LABEL_FILE_CONTENT, OLD_CONTENT);
const NEW_SPEC = "cypress/e2e/tests/aisec7_new.cy.js";
const EXISTING_SPEC = "cypress/e2e/tests/aisec7_existing.cy.js";

function makeCypressRoot(label, { withExisting = true } = {}) {
  const root = makeTempRoot(label);
  fs.mkdirSync(path.join(root, "cypress", "e2e", "tests"), { recursive: true });
  fs.mkdirSync(path.join(root, "cypress", "support"), { recursive: true });
  fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};", "utf8");
  if (withExisting) fs.writeFileSync(path.join(root, ...EXISTING_SPEC.split("/")), OLD_CONTENT, "utf8");
  return root;
}

function chainPlan(projectId, plannedChanges, purposeOverride) {
  return {
    schemaVersion: 1,
    kind: "AutomationPlan",
    id: "aisec7-plan",
    projectId,
    automationCandidateId: "aisec7-candidate",
    framework: "cypress",
    plannedChanges: plannedChanges.map((p) => ({ ...p, purpose: purposeOverride || p.purpose })),
  };
}

function chainContext(projectId, { withExisting = true } = {}) {
  const repositoryEvidence = [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }];
  if (withExisting) repositoryEvidence.push({ evidenceRef: { location: EXISTING_SPEC }, content: OLD_CONTENT });
  return { projectId, framework: "cypress", repositoryEvidence };
}

/**
 * Builds plan -> context -> change set -> review package with the real
 * builders. `changes` defaults to one CREATE + one MODIFY.
 */
function buildReviewedPackage({ projectId = "aisec7-project-a", changes, purpose, newContent = "describe('aisec7 new', () => {});" } = {}) {
  const effective = changes || [
    { operation: "CREATE", path: NEW_SPEC, baseContentDigest: null, content: newContent },
    { operation: "MODIFY", path: EXISTING_SPEC, baseContentDigest: OLD_DIGEST, content: "describe('aisec7 modified', () => {});" },
  ];
  const plan = chainPlan(projectId, effective.map((ch) => ({ path: ch.path, operation: ch.operation, purpose: "Add synthetic coverage." })), purpose);
  const context = chainContext(projectId, { withExisting: effective.some((ch) => ch.operation === "MODIFY") });
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: effective });
  if (!built.ok) throw new Error(`fixture change set invalid: ${JSON.stringify(built.errors)}`);
  const pkg = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: projectId });
  if (!pkg.ok) throw new Error(`fixture review package invalid: ${JSON.stringify(pkg.errors)}`);
  return { projectId, plan, context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkg.reviewPackage };
}

/** Records one decision per target through the real record builder. */
function decide(reviewed, decision = "APPROVE", { reviewedAt = "2026-10-07T00:00:00.000Z", reviewerId = "aisec7-reviewer" } = {}) {
  const decisions = reviewed.reviewPackage.reviewTargets.map((t) => ({
    operation: t.operation,
    path: t.path,
    targetDigest: t.targetDigest,
    decision,
    ...(decision === "APPROVE" ? {} : { reason: "synthetic" }),
  }));
  const rec = buildGeneratedChangeSetReviewRecord({ reviewPackage: reviewed.reviewPackage, reviewerId, reviewedAt, decisions });
  if (!rec.ok) throw new Error(`fixture review record invalid: ${JSON.stringify(rec.errors)}`);
  return rec.reviewRecord;
}

module.exports = {
  REPO_ROOT,
  AI,
  GOVERNANCE,
  DUMMY_TOKEN,
  unsetEnvNames,
  canary,
  makeTempRoot,
  cleanupRoots,
  writeJson,
  readJson,
  listFiles,
  withFetchStub,
  jsonResponse,
  withSpawnInterceptor,
  scriptedProvider,
  triageEchoResponse,
  promptPayload,
  projectProfile,
  triageContext,
  withFailureRefs,
  historyRecord,
  invocationEnv,
  OLD_CONTENT,
  OLD_DIGEST,
  NEW_SPEC,
  EXISTING_SPEC,
  makeCypressRoot,
  buildReviewedPackage,
  decide,
};
