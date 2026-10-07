"use strict";

/**
 * AISEC-7 H-01 (triage), H-04 (triage), H-05 (XI-01), H-06 (XI-02), H-07.
 *
 * The XI cases drive the SUPPORTED public entry `require("scripts/ai").
 * analyzeFailure.main` against synthetic temp roots. The provider it creates
 * is MockProvider (no network, ever); the harness wraps
 * MockProvider.prototype.analyze for the duration of one call to observe the
 * exact prompt at the actual consumer. These tests only run when config.js
 * resolved AI_PROVIDER to "mock" at import time, so a real provider host can
 * never be reached from here.
 *
 * XI-01 and XI-02 remain OPEN / MEDIUM / UNCHANGED. These tests reproduce
 * the gaps; they do not remediate, close, re-rate or waive anything.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const fx = require("./lib/fixtures");
const { confirmCase } = require("./lib/registry");

const publicApi = require(path.join(fx.AI, "index.js"));
const config = require(path.join(fx.AI, "config.js"));
const { MockProvider } = require(path.join(fx.AI, "providers", "mock-provider.js"));
const { ProviderError, PROVIDER_ERROR_CODES } = require(path.join(fx.AI, "providers", "provider-error.js"));
const { buildFailureReport, runProviderAnalysis } = require(path.join(fx.AI, "analyze-failure.js"));
const { createProvider } = require(path.join(fx.AI, "providers", "index.js"));

const PROJECT_A = "aisec7-project-a";
const PROJECT_B = "aisec7-project-b";

test.after(() => fx.cleanupRoots());

function skipUnlessMockProvider(t) {
  if (config.PROVIDER !== "mock") {
    t.skip(`AI_PROVIDER resolved to "${config.PROVIDER}", not "mock"; public-main XI cases would reach a real provider and are not run (INSUFFICIENT_EVIDENCE for this run)`);
    return true;
  }
  return false;
}

// Runs the supported public analyzer entry with a wrapped MockProvider and
// returns every prompt it sent plus the report it wrote under the temp root.
async function runPublicMain({ profileId, root }) {
  const calls = [];
  const original = MockProvider.prototype.analyze;
  const savedExitCode = process.exitCode;
  MockProvider.prototype.analyze = async function wrapped(args) {
    calls.push(args);
    return original.call(this, args);
  };
  let exitCode;
  try {
    await publicApi.analyzeFailure.main({ projectProfile: fx.projectProfile(profileId), repositoryRoot: root });
  } finally {
    MockProvider.prototype.analyze = original;
    exitCode = process.exitCode;
    process.exitCode = savedExitCode;
  }
  assert.notEqual(exitCode, 1, "the analyzer run itself must succeed for the observation to be valid");
  return { calls, report: fx.readJson(root, "reports/ai/ai-report.json") };
}

// --- harness non-vacuity control ----------------------------------------------

test("harness control: the wrapped MockProvider observes a same-project analysis (interception is not vacuous)", async (t) => {
  if (skipUnlessMockProvider(t)) return;
  const root = fx.makeTempRoot("same-project");
  const marker = fx.canary("SAME_PROJECT");
  fx.writeJson(root, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_B, errorMessage: marker }));
  const { calls, report } = await runPublicMain({ profileId: PROJECT_B, root });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].userPrompt.includes(marker));
  assert.equal(report.sourceContext.projectId, PROJECT_B);
});

// --- H-01 / H-05: XI-01 -----------------------------------------------------------

test("H01-C1: a Project B invocation pointed at a root holding Project A context transfers A evidence to the provider (no identity join)", async (t) => {
  if (skipUnlessMockProvider(t)) return;
  const rootA = fx.makeTempRoot("project-a-root");
  const marker = fx.canary("H01_PROJECT_A_EVIDENCE");
  fx.writeJson(rootA, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_A, errorMessage: marker }));

  const { calls, report } = await runPublicMain({ profileId: PROJECT_B, root: rootA });

  const refused = calls.length === 0;
  assert.equal(calls.length, 1, "exactly one provider transfer observed");
  assert.ok(calls[0].userPrompt.includes(marker), "Project A evidence reached the provider under Project B");
  assert.ok(calls[0].systemPrompt.includes(`Synthetic ${PROJECT_B}`), "the provider was framed with Project B's profile");
  assert.equal(report.sourceContext.projectId, PROJECT_A);
  confirmCase("H01-C1", refused);
});

test("H05-C1 XI-01: Project A context copied into Project B's root is analyzed under B through the public main; A canary reaches the provider and A provenance lands in B's report", async (t) => {
  if (skipUnlessMockProvider(t)) return;
  const rootB = fx.makeTempRoot("project-b-root");
  const marker = fx.canary("XI01_PROJECT_A_CONTEXT");
  fx.writeJson(rootB, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_A, errorMessage: marker, metadata: { repository: "synthetic/project-a", runId: "a-run-1" } }));

  const { calls, report } = await runPublicMain({ profileId: PROJECT_B, root: rootB });

  const refused = calls.length === 0;
  assert.equal(calls.length, 1, "provider called exactly once");
  assert.ok(calls[0].userPrompt.includes(marker), "Project A canary is in the exact provider payload");
  assert.equal(report.sourceContext.projectId, PROJECT_A, "B's report carries A's project provenance");
  assert.equal(report.sourceContext.repository, "synthetic/project-a");
  assert.equal(report.results.length, 1, "a trusted-looking report was produced");
  confirmCase("H05-C1", refused);
});

test("H05-C2 XI-01: stale, foreign-run context relabelled with B's project id is accepted (no freshness or origin binding)", async (t) => {
  if (skipUnlessMockProvider(t)) return;
  const rootB = fx.makeTempRoot("project-b-stale");
  const marker = fx.canary("XI01_STALE_CONTEXT");
  fx.writeJson(rootB, "reports/ai/context.json", fx.triageContext({
    projectId: PROJECT_B,
    errorMessage: marker,
    generatedAt: "2001-01-01T00:00:00.000Z",
    metadata: { repository: "synthetic/foreign-repository", runId: "foreign-run-999", commit: "f".repeat(40) },
  }));

  const { calls, report } = await runPublicMain({ profileId: PROJECT_B, root: rootB });

  const refused = calls.length === 0;
  assert.equal(calls.length, 1);
  assert.ok(calls[0].userPrompt.includes(marker));
  assert.equal(report.sourceContext.contextGeneratedAt, "2001-01-01T00:00:00.000Z");
  assert.equal(report.sourceContext.runId, "foreign-run-999");
  confirmCase("H05-C2", refused);
});

// --- H-06: XI-02 ----------------------------------------------------------------------

const ELIGIBLE_COUNTERS = { runsConsidered: 10, passes: 8, failures: 2, retryPasses: 1 };

const SEPARATE_HISTORY_VARIANTS = [
  { name: "absent", write: null },
  { name: "unavailable", write: { available: false, reason: "synthetic" } },
  { name: "malformed JSON", write: "{ this is not json" },
  { name: "wrong project", write: { available: true, projectId: PROJECT_A, framework: "cypress", ...ELIGIBLE_COUNTERS } },
  { name: "wrong framework", write: { available: true, projectId: PROJECT_B, framework: "playwright", ...ELIGIBLE_COUNTERS } },
  { name: "invalid counters", write: { available: true, projectId: PROJECT_B, framework: "cypress", runsConsidered: 10, passes: 3, failures: 3, retryPasses: 0 } },
];

function embeddedHistory(marker) {
  return { runsConsidered: 10, passes: 3, failures: 7, retryPasses: 0, injectedNote: marker };
}

async function runXi02Variant(variant) {
  const root = fx.makeTempRoot(`xi02-${variant.name.replace(/\W+/g, "-")}`);
  const marker = fx.canary("XI02_EMBEDDED_HISTORY");
  fx.writeJson(root, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_B, embeddedHistory: embeddedHistory(marker) }));
  if (variant.write !== null) fx.writeJson(root, "reports/ai/history.json", variant.write);
  const run = await runPublicMain({ profileId: PROJECT_B, root });
  return { ...run, marker };
}

test("H06-C1 XI-02: embedded history canary reaches the provider for every ineligible separate-history state", async (t) => {
  if (skipUnlessMockProvider(t)) return;
  const reproduced = [];
  for (const variant of SEPARATE_HISTORY_VARIANTS) {
    const { calls, marker } = await runXi02Variant(variant);
    assert.equal(calls.length, 1, variant.name);
    const sent = fx.promptPayload(calls[0].userPrompt).history;
    if (sent && sent.injectedNote === marker) reproduced.push(variant.name);
  }
  assert.deepEqual(reproduced, SEPARATE_HISTORY_VARIANTS.map((v) => v.name), "the embedded field survived in every variant");
  confirmCase("H06-C1", reproduced.length === 0);
});

test("H06-C2 XI-02: the report says history is null while the prompt carried embedded history (prompt/report divergence)", async (t) => {
  if (skipUnlessMockProvider(t)) return;
  const { calls, report, marker } = await runXi02Variant({ name: "absent", write: null });
  const sent = fx.promptPayload(calls[0].userPrompt).history;
  assert.equal(report.history, null, "report records no history");
  assert.equal(sent.injectedNote, marker, "prompt carried the embedded history");
  const consistent = report.history !== null || sent === null;
  confirmCase("H06-C2", consistent);
});

test("H06-C3: eligible separate history replaces the embedded field with exactly the four counters", async (t) => {
  if (skipUnlessMockProvider(t)) return;
  const { calls, report, marker } = await runXi02Variant({ name: "eligible", write: { available: true, projectId: PROJECT_B, framework: "cypress", ...ELIGIBLE_COUNTERS } });
  const sent = fx.promptPayload(calls[0].userPrompt).history;
  assert.deepEqual(sent, ELIGIBLE_COUNTERS);
  assert.deepEqual(report.history, ELIGIBLE_COUNTERS);
  confirmCase("H06-C3", !calls[0].userPrompt.includes(marker));
});

test("H06-C4: unavailable separate history is reported as null, never fabricated zero counters", async (t) => {
  if (skipUnlessMockProvider(t)) return;
  const { report } = await runXi02Variant({ name: "unavailable", write: { available: false } });
  confirmCase("H06-C4", report.history === null);
});

// --- H-04: triage disclosure ----------------------------------------------------------

test("H04-C1: provider error message and cause canaries never reach the terminal AnalyzerError or firstAttemptError", async () => {
  const messageMarker = fx.canary("PROVIDER_ERROR_MESSAGE");
  const causeMarker = fx.canary("PROVIDER_ERROR_CAUSE");
  const retryable = new ProviderError(`transport said ${messageMarker}`, { code: PROVIDER_ERROR_CODES.NETWORK, retryable: true, cause: new Error(causeMarker) });
  const terminal = new ProviderError(`auth said ${messageMarker}`, { code: PROVIDER_ERROR_CODES.AUTH, retryable: false, cause: new Error(causeMarker) });

  // Retryable failure then success: the persisted provenance uses the fixed summary.
  const recovered = fx.scriptedProvider([retryable, fx.triageEchoResponse]);
  const ok = await runProviderAnalysis(recovered.provider, fx.triageContext({ projectId: PROJECT_B }), { sleep: async () => {}, projectProfile: fx.projectProfile(PROJECT_B) });
  const persisted = JSON.stringify(ok.firstAttemptError);

  // Terminal failure: the thrown message uses the fixed summary.
  const failing = fx.scriptedProvider([terminal]);
  const thrown = await runProviderAnalysis(failing.provider, fx.triageContext({ projectId: PROJECT_B }), { sleep: async () => {}, projectProfile: fx.projectProfile(PROJECT_B) }).then(() => null, (e) => e);
  assert.ok(thrown, "terminal provider failure must throw");

  const leaked = [persisted, thrown.message, String(thrown.cause || "")].some((s) => s.includes(messageMarker) || s.includes(causeMarker));
  assert.equal(ok.firstAttemptError.message, "Provider network request failed");
  assert.match(thrown.message, /Provider authentication failed/);
  confirmCase("H04-C1", !leaked);
});

async function promptFor(context) {
  const scripted = fx.scriptedProvider([fx.triageEchoResponse]);
  await buildFailureReport(context, { provider: scripted.provider, history: null, relevantKnowledge: [], projectProfile: fx.projectProfile(PROJECT_B) });
  assert.equal(scripted.calls.length, 1);
  return scripted.calls[0].userPrompt;
}

test("H04-C2: unlisted failure extras and projectId/repository/runId metadata canaries are projected out of the prompt", async () => {
  const extra = fx.canary("FAILURE_EXTRA");
  const projectId = fx.canary("PROJECT_ID");
  const repository = fx.canary("REPOSITORY");
  const runId = fx.canary("RUN_ID");
  const prompt = await promptFor(fx.triageContext({ projectId, extras: { adapterExtra: extra, error: { message: "m", stack: "s", hiddenErrorExtra: extra } }, metadata: { repository, runId } }));
  const leaked = [extra, projectId, repository, runId].filter((m) => prompt.includes(m));
  confirmCase("H04-C2", leaked.length === 0);
});

test("H04-C3: failure error message and stack canaries are forwarded verbatim to the provider (audience undecided, ODR-03)", async () => {
  const messageMarker = fx.canary("ERROR_MESSAGE");
  const stackMarker = fx.canary("ERROR_STACK");
  const prompt = await promptFor(fx.triageContext({ projectId: PROJECT_B, extras: { error: { message: `boom ${messageMarker}`, stack: `at ${stackMarker}` } } }));
  assert.ok(prompt.includes(messageMarker) && prompt.includes(stackMarker), "free-text failure evidence is transferred unredacted");
  confirmCase("H04-C3", null);
});

// --- H-07: shared / interleaved state --------------------------------------------------

test("H07-C1: interleaved A/B analyses with separate roots and providers do not cross-contaminate through module state", async () => {
  const markerA = fx.canary("INTERLEAVE_A");
  const markerB = fx.canary("INTERLEAVE_B");
  let releaseA;
  const gate = new Promise((resolve) => { releaseA = resolve; });
  const providerA = fx.scriptedProvider([async (args) => { await gate; return fx.triageEchoResponse(args.userPrompt); }]);
  const providerB = fx.scriptedProvider([async (args) => { releaseA(); return fx.triageEchoResponse(args.userPrompt); }]);
  const rootA = fx.makeTempRoot("interleave-a");
  const rootB = fx.makeTempRoot("interleave-b");

  const [reportA, reportB] = await Promise.all([
    buildFailureReport(fx.triageContext({ projectId: PROJECT_A, errorMessage: markerA }), { provider: providerA.provider, root: { lexicalRoot: rootA, realRoot: rootA }, history: null, relevantKnowledge: [], projectProfile: fx.projectProfile(PROJECT_A) }),
    buildFailureReport(fx.triageContext({ projectId: PROJECT_B, errorMessage: markerB }), { provider: providerB.provider, root: { lexicalRoot: rootB, realRoot: rootB }, history: null, relevantKnowledge: [], projectProfile: fx.projectProfile(PROJECT_B) }),
  ]);

  const promptA = providerA.calls[0].userPrompt + providerA.calls[0].systemPrompt;
  const promptB = providerB.calls[0].userPrompt + providerB.calls[0].systemPrompt;
  const isolated = promptA.includes(markerA) && !promptA.includes(markerB) && !promptA.includes(PROJECT_B)
    && promptB.includes(markerB) && !promptB.includes(markerA) && !promptB.includes(PROJECT_A)
    && reportA.sourceContext.projectId === PROJECT_A && reportB.sourceContext.projectId === PROJECT_B;
  confirmCase("H07-C1", isolated);
});

test("H07-C2: provider and credential selection is fixed at import time; a later per-invocation change is ignored", async (t) => {
  // Only currently-unset names are touched, so no real credential is read or replaced.
  const fields = { AI_PROVIDER: "PROVIDER", AI_MODEL: "MODEL", AI_API_KEY: "API_KEY" };
  const injected = fx.unsetEnvNames(Object.keys(fields));
  if (injected.length === 0) {
    t.skip("every AI_* selector is already set in this environment; not overriding real configuration (INSUFFICIENT_EVIDENCE for this run)");
    return;
  }
  const before = Object.fromEntries(injected.map((n) => [n, config[fields[n]]]));
  for (const n of injected) process.env[n] = n === "AI_API_KEY" ? fx.DUMMY_TOKEN : "aisec7-invocation-b-selection";
  try {
    const reloaded = require(path.join(fx.AI, "config.js"));
    for (const n of injected) assert.equal(reloaded[fields[n]], before[n], `${n} did not follow the invocation`);
    if (config.PROVIDER === "mock") assert.equal(createProvider().name, "mock", "default factory still returns the import-time provider");
  } finally {
    for (const n of injected) delete process.env[n];
  }
  confirmCase("H07-C2", null);
});
