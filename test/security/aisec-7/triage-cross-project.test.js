"use strict";

/**
 * AISEC-7 H-01 (triage), H-04 (triage), H-05 (XI-01), H-06 (XI-02), H-07.
 *
 * The XI cases drive the SUPPORTED public entry `require("scripts/ai").
 * analyzeFailure.main` against synthetic temp roots. The provider it creates
 * is MockProvider (no network, ever); the harness wraps
 * MockProvider.prototype.analyze for the duration of one call to observe the
 * exact prompt at the actual consumer. These cases require config.js to have
 * resolved AI_PROVIDER to "mock" at import time. Any other value FAILS them
 * before a provider is constructed or called (SEC-01): a real provider host can
 * never be reached from here, and a mandatory case can never skip while the run
 * stays green. The shared execution ledger (lib/execution-ledger.js, SEC-02)
 * then fails this file unless every mandatory test, case and control in it
 * reached completion or confirmation.
 *
 * Triage Boundary Contract v1 (TSB-F04 + TSB-F07 + XI-01 + XI-02
 * implementation): the XI cases now observe the implemented controls holding.
 * XI-01 and XI-02 remain OPEN / MEDIUM: this evidence does not close, re-rate
 * or waive anything - closure is a separate, separately authorized step.
 *
 * Every test runs under an explicitly set, fresh local-v1 invocation with all
 * GitHub Actions variables cleared and restored afterwards (hermetic: the same
 * trust mode locally and in CI); H05-C2 switches to github-actions-v1
 * explicitly for its GitHub Actions half.
 */

const nodeTest = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fx = require("./lib/fixtures");
const { createEvidenceLedger } = require("./lib/execution-ledger");

const ledger = createEvidenceLedger(__filename);
const { confirmCase, confirmControl } = ledger;

// Registered from this file so node:test attributes every result to it; the
// ledger records completion and refuses test options (SEC-02).
function test(name, fn) {
  return nodeTest(name, ledger.track(name, fn));
}
test.after = nodeTest.after;

fx.invocationEnv.useHermeticLocalInvocation({ beforeEach: nodeTest.beforeEach, afterEach: nodeTest.afterEach });

const publicApi = require(path.join(fx.AI, "index.js"));
const config = require(path.join(fx.AI, "config.js"));
const { MockProvider } = require(path.join(fx.AI, "providers", "mock-provider.js"));
const { ProviderError, PROVIDER_ERROR_CODES } = require(path.join(fx.AI, "providers", "provider-error.js"));
const { buildFailureReport, runProviderAnalysis } = require(path.join(fx.AI, "analyze-failure.js"));
const { createProvider } = require(path.join(fx.AI, "providers", "index.js"));

const PROJECT_A = "aisec7-project-a";
const PROJECT_B = "aisec7-project-b";

test.after(() => fx.cleanupRoots());

// --- SEC-01 evidence integrity --------------------------------------------------------

const EVIDENCE_INTEGRITY = "AISEC-7 evidence integrity (SEC-01)";
const HARNESS_CONTROL = "harness-control";
const SEC01_PROBE = "aisec7-probe-nonexistent";

// Fails, never skips: a skipped mandatory case is invalid evidence.
function requireMockProvider(resolvedProvider) {
  assert.ok(resolvedProvider === "mock", `${EVIDENCE_INTEGRITY}: AI_PROVIDER resolved to "${resolvedProvider}", not "mock". This mandatory case would reach a non-mock provider, so it is not executed and the AISEC-7 run FAILS`);
}

async function runMockEvidence(resolvedProvider, body, t) {
  requireMockProvider(resolvedProvider);
  return body(t);
}

// Cases that need the repository MockProvider, registered through one guarded
// runner so the SEC-01 regression below drives the same bodies.
const MOCK_EVIDENCE = [];
function mockEvidenceTest(id, name, body) {
  MOCK_EVIDENCE.push({ id, body });
  test(name, (t) => runMockEvidence(config.PROVIDER, body, t));
}

// Runs the supported public analyzer entry with a wrapped MockProvider and
// returns every prompt it sent, the analyzer's exit status, its error lines
// and the report it wrote under the temp root (null when none was written).
async function runPublicMain({ profileId, root }) {
  requireMockProvider(config.PROVIDER);
  const calls = [];
  const errors = [];
  const original = MockProvider.prototype.analyze;
  const originalError = console.error;
  const savedExitCode = process.exitCode;
  process.exitCode = undefined;
  MockProvider.prototype.analyze = async function wrapped(args) {
    calls.push(args);
    return original.call(this, args);
  };
  console.error = (...args) => errors.push(args.join(" "));
  let exitCode;
  try {
    await publicApi.analyzeFailure.main({ projectProfile: fx.projectProfile(profileId), repositoryRoot: root });
  } finally {
    MockProvider.prototype.analyze = original;
    console.error = originalError;
    exitCode = process.exitCode;
    process.exitCode = savedExitCode;
  }
  const reportFile = path.join(root, "reports", "ai", "ai-report.json");
  return { calls, errors, exitCode, report: fs.existsSync(reportFile) ? fx.readJson(root, "reports/ai/ai-report.json") : null };
}

// A successful analysis: exit status clean and a report written.
async function runPublicMainOk(args) {
  const run = await runPublicMain(args);
  assert.notEqual(run.exitCode, 1, `the analyzer run itself must succeed for the observation to be valid: ${run.errors.join(" | ")}`);
  assert.ok(run.report, "a report was written");
  return run;
}

// A fail-closed refusal: non-zero exit, the expected fixed reason code, no
// provider call and no report. Returns true only when all of that held.
function refusedBeforeProvider(run, code, canaries = []) {
  const reasonLogged = run.errors.some((line) => line.includes(code));
  const canaryEchoed = run.errors.some((line) => canaries.some((c) => line.includes(c)));
  return run.exitCode === 1 && reasonLogged && !canaryEchoed && run.calls.length === 0 && run.report === null;
}

// --- harness non-vacuity control ----------------------------------------------

mockEvidenceTest(HARNESS_CONTROL, "harness control: the wrapped MockProvider observes a same-project analysis (interception is not vacuous)", async () => {
  const root = fx.makeTempRoot("same-project");
  const marker = fx.canary("SAME_PROJECT");
  fx.writeJson(root, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_B, errorMessage: marker }));
  const { calls, report } = await runPublicMainOk({ profileId: PROJECT_B, root });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].userPrompt.includes(marker));
  assert.equal(report.sourceContext.projectId, PROJECT_B);
  confirmControl(HARNESS_CONTROL);
});

// --- H-01 / H-05: XI-01 -----------------------------------------------------------
//
// Triage Boundary Contract v1: the public analyzer binds the persisted
// context to the validated ProjectProfile and to the trusted current
// invocation before any provider transfer or report write. These cases now
// observe the control holding (PASS); XI-01 itself stays OPEN until its
// separately authorized closure.

mockEvidenceTest("H01-C1", "H01-C1: a Project B invocation pointed at a root holding Project A context is refused before any provider transfer (XI-01 ProjectProfile binding)", async () => {
  const rootA = fx.makeTempRoot("project-a-root");
  const marker = fx.canary("H01_PROJECT_A_EVIDENCE");
  fx.writeJson(rootA, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_A, errorMessage: marker }));

  const run = await runPublicMain({ profileId: PROJECT_B, root: rootA });

  assert.equal(run.calls.length, 0, "no provider transfer");
  assert.equal(run.report, null, "no report written");
  confirmCase("H01-C1", refusedBeforeProvider(run, "TRIAGE_CONTEXT_PROJECT_MISMATCH", [marker, PROJECT_A]));
});

mockEvidenceTest("H05-C1", "H05-C1 XI-01: Project A context copied into Project B's root is refused through the public main; no A canary reaches the provider and no report is written", async () => {
  const rootB = fx.makeTempRoot("project-b-root");
  const marker = fx.canary("XI01_PROJECT_A_CONTEXT");
  fx.writeJson(rootB, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_A, errorMessage: marker, metadata: { repository: "synthetic/project-a", runId: "a-run-1" } }));
  const projectRefused = refusedBeforeProvider(await runPublicMain({ profileId: PROJECT_B, root: rootB }), "TRIAGE_CONTEXT_PROJECT_MISMATCH", [marker]);

  // Relabelling the copied context with B's projectId but keeping A's
  // constraints is refused by the exact constraints binding.
  const relabelled = fx.triageContext({ projectId: PROJECT_B, errorMessage: marker });
  relabelled.knownProjectConstraints = [...fx.projectProfile(PROJECT_A).knownProjectConstraints];
  fx.writeJson(rootB, "reports/ai/context.json", relabelled);
  const constraintsRefused = refusedBeforeProvider(await runPublicMain({ profileId: PROJECT_B, root: rootB }), "TRIAGE_CONTEXT_CONSTRAINTS_MISMATCH", [marker]);

  assert.equal(projectRefused, true, "copied Project A context refused");
  assert.equal(constraintsRefused, true, "foreign constraints refused");
  confirmCase("H05-C1", projectRefused && constraintsRefused);
});

mockEvidenceTest("H05-C2", "H05-C2 XI-01: stale, foreign-run context relabelled with B's project id is refused in both invocation modes (local-v1 invocation id; GitHub Actions repository/SHA/run/run attempt)", async () => {
  const rootB = fx.makeTempRoot("project-b-stale");
  const marker = fx.canary("XI01_STALE_CONTEXT");
  const outcomes = {};

  // local-v1: a context persisted under a PRIOR local invocation (another
  // valid id) and relabelled as B, under the current invocation.
  const staleLocal = fx.triageContext({ projectId: PROJECT_B, errorMessage: marker, generatedAt: "2001-01-01T00:00:00.000Z", metadata: { localInvocationId: fx.invocationEnv.freshLocalInvocationId() } });
  fx.writeJson(rootB, "reports/ai/context.json", staleLocal);
  outcomes.staleLocal = refusedBeforeProvider(await runPublicMain({ profileId: PROJECT_B, root: rootB }), "TRIAGE_CONTEXT_INVOCATION_MISMATCH", [marker]);

  // github-actions-v1: the same run tuple except ONE field each - another
  // repository, commit, run, or another attempt of the same run.
  const current = fx.invocationEnv.githubInvocationEnv({ GITHUB_RUN_ATTEMPT: "2" });
  await fx.invocationEnv.withInvocationEnv(current, async () => {
    for (const [name, field, value] of [
      ["foreignRepository", "repository", "synthetic-owner/foreign-repository"],
      ["staleCommit", "commit", "f".repeat(40)],
      ["foreignRun", "runId", "999"],
      ["priorAttempt", "runAttempt", "1"],
    ]) {
      fx.writeJson(rootB, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_B, errorMessage: marker, metadata: { [field]: value } }));
      outcomes[name] = refusedBeforeProvider(await runPublicMain({ profileId: PROJECT_B, root: rootB }), "TRIAGE_CONTEXT_INVOCATION_MISMATCH", [marker]);
    }
    // Non-vacuity: the exact same-run, same-attempt context is analyzed.
    fx.writeJson(rootB, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_B, errorMessage: marker }));
    const sameAttempt = await runPublicMainOk({ profileId: PROJECT_B, root: rootB });
    assert.equal(sameAttempt.calls.length, 1, "same-run, same-attempt GitHub Actions context is analyzed");
  });

  assert.deepEqual(outcomes, { staleLocal: true, foreignRepository: true, staleCommit: true, foreignRun: true, priorAttempt: true });
  confirmCase("H05-C2", Object.values(outcomes).every(Boolean));
});

// --- H-06: XI-02 ----------------------------------------------------------------------

const ELIGIBLE_COUNTERS = { runsConsidered: 10, passes: 8, failures: 2, retryPasses: 1 };

const SEPARATE_HISTORY_VARIANTS = [
  { name: "absent", write: null },
  { name: "unavailable", write: { available: false, reason: "synthetic" } },
  { name: "malformed JSON", write: "{ this is not json" },
  { name: "wrong project", write: fx.historyRecord({ projectId: PROJECT_A, ...ELIGIBLE_COUNTERS }) },
  { name: "wrong framework", write: fx.historyRecord({ projectId: PROJECT_B, framework: "playwright", ...ELIGIBLE_COUNTERS }) },
  { name: "invalid counters", write: fx.historyRecord({ projectId: PROJECT_B, runsConsidered: 10, passes: 3, failures: 3, retryPasses: 0 }) },
];

function embeddedHistory(marker) {
  return { runsConsidered: 10, passes: 3, failures: 7, retryPasses: 0, injectedNote: marker };
}

// One public analysis for `variant`'s separate history.json, with or without
// an embedded context.history canary.
async function runXi02Variant(variant, { embedded = true } = {}) {
  const root = fx.makeTempRoot(`xi02-${variant.name.replace(/\W+/g, "-")}`);
  const marker = fx.canary("XI02_EMBEDDED_HISTORY");
  fx.writeJson(root, "reports/ai/context.json", fx.triageContext({ projectId: PROJECT_B, embeddedHistory: embedded ? embeddedHistory(marker) : undefined }));
  if (variant.write !== null) fx.writeJson(root, "reports/ai/history.json", variant.write);
  const run = await runPublicMain({ profileId: PROJECT_B, root });
  return { ...run, marker };
}

mockEvidenceTest("H06-C1", "H06-C1 XI-02: an embedded context.history canary is rejected at the persisted-context boundary for every separate-history state; it never reaches the provider", async () => {
  const reproduced = [];
  for (const variant of SEPARATE_HISTORY_VARIANTS) {
    const run = await runXi02Variant(variant);
    if (!refusedBeforeProvider(run, "TRIAGE_CONTEXT_EMBEDDED_HISTORY", [run.marker])) reproduced.push(variant.name);
    // Without the embedded field, an ineligible separate history is "no
    // usable history" - never a fabricated or substituted value.
    const clean = await runXi02Variant(variant, { embedded: false });
    assert.equal(clean.calls.length, 1, variant.name);
    if (fx.promptPayload(clean.calls[0].userPrompt).history !== null) reproduced.push(`${variant.name} (separate)`);
  }
  assert.deepEqual(reproduced, [], "embedded History never survives and ineligible separate History is null");
  confirmCase("H06-C1", reproduced.length === 0);
});

mockEvidenceTest("H06-C2", "H06-C2 XI-02: prompt-visible and report-visible History derive from the same validated projection in every separate-history state", async () => {
  const diverged = [];
  for (const variant of [...SEPARATE_HISTORY_VARIANTS, { name: "eligible", write: fx.historyRecord({ projectId: PROJECT_B, ...ELIGIBLE_COUNTERS }) }]) {
    const { calls, report } = await runXi02Variant(variant, { embedded: false });
    const sent = fx.promptPayload(calls[0].userPrompt).history;
    if (JSON.stringify(sent) !== JSON.stringify(report.history)) diverged.push(variant.name);
  }
  assert.deepEqual(diverged, [], "prompt and report History are identical");
  confirmCase("H06-C2", diverged.length === 0);
});

mockEvidenceTest("H06-C3", "H06-C3: eligible separate history replaces the embedded field with exactly the four counters", async () => {
  const eligible = { name: "eligible", write: fx.historyRecord({ projectId: PROJECT_B, ...ELIGIBLE_COUNTERS }) };
  // The embedded field can no longer be "replaced": the context carrying it
  // is refused outright, so only the separate projection can ever be sent.
  const embeddedRun = await runXi02Variant(eligible);
  assert.equal(embeddedRun.calls.length, 0);
  const { calls, report } = await runXi02Variant(eligible, { embedded: false });
  const sent = fx.promptPayload(calls[0].userPrompt).history;
  assert.deepEqual(sent, ELIGIBLE_COUNTERS);
  assert.deepEqual(report.history, ELIGIBLE_COUNTERS);
  confirmCase("H06-C3", !calls[0].userPrompt.includes(embeddedRun.marker));
});

mockEvidenceTest("H06-C4", "H06-C4: unavailable separate history is reported as null, never fabricated zero counters", async () => {
  const { report } = await runXi02Variant({ name: "unavailable", write: { available: false, reason: "synthetic" } }, { embedded: false });
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
  const ok = await runProviderAnalysis(recovered.provider, fx.withFailureRefs(fx.triageContext({ projectId: PROJECT_B })), { sleep: async () => {}, projectProfile: fx.projectProfile(PROJECT_B) });
  const persisted = JSON.stringify(ok.firstAttemptError);

  // Terminal failure: the thrown message uses the fixed summary.
  const failing = fx.scriptedProvider([terminal]);
  const thrown = await runProviderAnalysis(failing.provider, fx.withFailureRefs(fx.triageContext({ projectId: PROJECT_B })), { sleep: async () => {}, projectProfile: fx.projectProfile(PROJECT_B) }).then(() => null, (e) => e);
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
  // Metadata canaries: a valid context, projected out of the prompt (the
  // constraints are B's, so the projectId canary appears only in metadata).
  const constraints = fx.projectProfile(PROJECT_B).knownProjectConstraints;
  const prompt = await promptFor(fx.triageContext({ projectId, metadata: { repository, runId }, knownProjectConstraints: constraints }));
  const leaked = [projectId, repository, runId].filter((m) => prompt.includes(m));
  // Unlisted failure/error extras: the closed context contract rejects the
  // context before any provider call, without echoing the extra.
  const scripted = fx.scriptedProvider([fx.triageEchoResponse]);
  const rejected = await buildFailureReport(fx.triageContext({ projectId, knownProjectConstraints: constraints, extras: { adapterExtra: extra, error: { message: "m", stack: "s", hiddenErrorExtra: extra } } }), { provider: scripted.provider, history: null, relevantKnowledge: [], projectProfile: fx.projectProfile(PROJECT_B) }).then(() => null, (e) => e);
  const extraRefused = rejected !== null && /TRIAGE_CONTEXT_INVALID/.test(rejected.message) && !rejected.message.includes(extra) && scripted.calls.length === 0;
  confirmCase("H04-C2", leaked.length === 0 && extraRefused);
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

mockEvidenceTest("H07-C2", "H07-C2: provider and credential selection is fixed at import time; a later per-invocation change is ignored", async () => {
  // Only currently-unset names are touched, so no real credential is read or replaced.
  const fields = { AI_PROVIDER: "PROVIDER", AI_MODEL: "MODEL", AI_API_KEY: "API_KEY" };
  const injected = fx.unsetEnvNames(Object.keys(fields));
  assert.ok(injected.length > 0, `${EVIDENCE_INTEGRITY}: every AI_* selector is already set; real configuration is never overridden, so H07-C2 is not executed and the AISEC-7 run FAILS`);
  const before = Object.fromEntries(injected.map((n) => [n, config[fields[n]]]));
  for (const n of injected) process.env[n] = n === "AI_API_KEY" ? fx.DUMMY_TOKEN : "aisec7-invocation-b-selection";
  try {
    const reloaded = require(path.join(fx.AI, "config.js"));
    for (const n of injected) assert.equal(reloaded[fields[n]], before[n], `${n} did not follow the invocation`);
    assert.equal(createProvider().name, "mock", "default factory still returns the import-time provider");
  } finally {
    for (const n of injected) delete process.env[n];
  }
  confirmCase("H07-C2", null);
});

// --- SEC-01 regression ------------------------------------------------------------------

// What config.js resolves AI_PROVIDER to when the variable holds `value`. The
// module is re-evaluated in isolation and the cached copy the analyzer uses is
// restored. A set AI_PROVIDER is never overridden; it then already resolves to
// "mock" (any other value fails every guarded case), and the literal is used.
function providerResolvedUnder(value) {
  const configPath = require.resolve(path.join(fx.AI, "config.js"));
  if (fx.unsetEnvNames(["AI_PROVIDER"]).length === 0) return value;
  const cached = require.cache[configPath];
  process.env.AI_PROVIDER = value;
  delete require.cache[configPath];
  try {
    return require(configPath).PROVIDER;
  } finally {
    delete process.env.AI_PROVIDER;
    require.cache[configPath] = cached;
  }
}

test("SEC-01 regression: with AI_PROVIDER=aisec7-probe-nonexistent every mock-only mandatory case fails closed before any provider, network or process effect; none skips", async () => {
  const resolved = providerResolvedUnder(SEC01_PROBE);
  assert.equal(resolved, SEC01_PROBE, "the probe value reaches the provider selection");
  assert.deepEqual(MOCK_EVIDENCE.map((e) => e.id), [HARNESS_CONTROL, "H01-C1", "H05-C1", "H05-C2", "H06-C1", "H06-C2", "H06-C3", "H06-C4", "H07-C2"]);

  const analyze = MockProvider.prototype.analyze;
  let providerCalls = 0;
  MockProvider.prototype.analyze = async function counted(...args) {
    providerCalls += 1;
    return analyze.apply(this, args);
  };
  try {
    await fx.withFetchStub(null, (fetchCalls) => fx.withSpawnInterceptor(async (spawnCalls) => {
      for (const entry of MOCK_EVIDENCE) {
        let entered = false;
        const skipped = [];
        // A stub context that records any skip request instead of skipping.
        const context = {};
        context.skip = (message) => skipped.push(message);
        await assert.rejects(
          runMockEvidence(resolved, async (t) => { entered = true; return entry.body(t); }, context),
          (error) => error.message.includes(EVIDENCE_INTEGRITY) && error.message.includes(SEC01_PROBE),
          `${entry.id} must fail with an evidence-integrity error`,
        );
        assert.equal(entered, false, `${entry.id}: evidence body must not start`);
        assert.deepEqual(skipped, [], `${entry.id}: must not skip`);
      }
      assert.equal(fetchCalls.length, 0, "no network call");
      assert.equal(spawnCalls.length, 0, "no process spawn");
    }));
  } finally {
    MockProvider.prototype.analyze = analyze;
  }
  assert.equal(providerCalls, 0, "no provider call");
});
