"use strict";

/**
 * SEC-C1 (OD-RATE-1 FT0): parent IPC disconnect safety for the isolated,
 * provider-consuming stage children (stage-runner.js / generative-runner.js).
 *
 * Invariant: unexpected loss of the parent's IPC channel aborts pending
 * waits and in-flight provider requests, no further provider call starts,
 * and the child terminates. The child's own disconnect after a completed
 * result is not a cancellation.
 *
 * Child-process tests run the REAL runners with the REAL Groq/Gemini
 * adapters over a scripted fake transport (test/helpers/sec-c1-fake-transport.js
 * replaces globalThis.fetch in the child - no socket, no credential, no real
 * provider). The test process plays the parent: child.disconnect() closes
 * the IPC channel exactly as parent loss does. Synchronization is on
 * transport probes, never on sleeps; every wait is bounded so a regression
 * fails instead of hanging.
 *
 * Race tests (T08/T09) are in-process: the runner's own guard over a fake
 * process emitter whose exit() is recorded but does not terminate, so the
 * cooperative layer (provider refusal + non-retryable cancellation) is
 * proven on its own, independent of process termination.
 *
 * FT0-C1 (corrective for FT0-R2-M01/M02): the result transfer is covered
 * both in-process over a fake that models Node's IPC lifecycle (ipcProcess)
 * and in the real child with the result write withheld; unsuccessful HTTP
 * responses are covered with bodies that never finish, checking EVERY
 * request signal and body, not only the latest.
 *
 * FT0-C2 (Parent ACK, corrective for FT0-R2-M01): a result is delivered only
 * once the parent has stored it and returned its private receipt. The
 * decisive cases run the REAL runners under the REAL runStageProcess() over
 * native IPC, including a parent whose event loop is blocked so the
 * result's bytes reach the pipe but are never read.
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter, getEventListeners } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { GroqProvider } = require("../providers/groq-provider");
const { GeminiProvider } = require("../providers/gemini-provider");
const { ProviderError, PROVIDER_ERROR_CODES } = require("../providers/provider-error");
const { runProviderAnalysis, summarizeProviderError } = require("../analyze-failure");
const { generateRequirementModel } = require("../generative-test-design/requirement-model-generator");
const { ingestRequirementEvidence } = require("../generative-test-design/evidence-ingestion");
const { buildFailureReferences } = require("../triage-boundary-contract");
const stageRunner = require("./stage-runner");
const generativeRunner = require("./generative-runner");
const { runStageProcess } = require("./stage-process");
const { localInvocationEnv, withInvocationEnv, contextForCurrentInvocation, defaultFailure } = require("../../../test/helpers/triage-invocation-env");

const FAKE_TRANSPORT = path.resolve(__dirname, "..", "..", "..", "test", "helpers", "sec-c1-fake-transport.js");
const RUNNERS = Object.freeze({
  triage: require.resolve("./stage-runner.js"),
  generative: require.resolve("./generative-runner.js"),
});
const SECRET = "SEC_C1_SENTINEL_API_KEY_5d0e";
const PROBE_TIMEOUT_MS = 15000;
const CLOSE_TIMEOUT_MS = 10000;
const PROFILE = Object.freeze({ id: "sec-c1-project", displayName: "SEC-C1", knownProjectConstraints: Object.freeze(["SEC_C1_CONSTRAINT"]) });

// --- child-process harness --------------------------------------------------------

function baseEnv(extra) {
  const env = {};
  for (const key of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return { ...env, AI_API_KEY: SECRET, AI_MODEL: "sec-c1-model", ...extra };
}

function scratchDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-c1-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A triage `analyze` invocation whose context is bound to a fresh local-v1
// invocation, so the real analyzer reaches the provider call.
function triageCase(t) {
  const dir = scratchDir(t);
  const invocation = localInvocationEnv();
  const failure = defaultFailure();
  const ctx = withInvocationEnv(invocation, () => contextForCurrentInvocation({ profile: PROFILE, failedTests: [failure] }));
  fs.mkdirSync(path.join(dir, "reports", "ai"), { recursive: true });
  fs.writeFileSync(path.join(dir, "reports", "ai", "context.json"), JSON.stringify(ctx));
  const failureRef = buildFailureReferences(ctx.failedTests)[0].failureRef;
  const validContent = JSON.stringify({
    results: [
      {
        failureRef,
        test: { title: failure.title, specFile: failure.specFile },
        classification: "TEST_BUG",
        confidence: 0.8,
        summary: "Summary.",
        rootCause: "Root cause.",
        evidence: ["err.message: AssertionError: synthetic"],
        recommendedFix: { file: failure.specFile, description: "Assert on a stable condition instead." },
        shouldCreateBug: false,
        shouldRetry: false,
      },
    ],
  });
  return {
    dir,
    runner: "triage",
    stage: "analyze",
    env: { ...invocation, AI_PROVIDER: "groq" },
    payload: { projectProfile: PROFILE, repositoryRoot: dir },
    validContent,
  };
}

// A Stage 3 `design` invocation with a valid canonical evidence bundle, so
// the real requirement-model generator reaches the provider call.
function generativeCase(t) {
  const dir = scratchDir(t);
  const ingested = ingestRequirementEvidence({ projectId: PROFILE.id, sources: [{ text: "Invalid credentials show an error on the login page." }] });
  assert.equal(ingested.ok, true);
  return {
    dir,
    runner: "generative",
    stage: "design",
    env: { AI_PROVIDER: "gemini" },
    payload: { evidenceBundle: ingested.bundle, projectId: PROFILE.id, projectProfile: PROFILE, frameworkCapability: null },
  };
}

// A Stage 3 `plan` invocation with no candidates: the generative runner
// reaches a successful result without any provider call.
function generativeSuccessCase(t) {
  const dir = scratchDir(t);
  return {
    dir,
    runner: "generative",
    stage: "plan",
    env: { AI_PROVIDER: "gemini" },
    payload: { automationCandidates: [], repositoryContext: null, projectId: PROFILE.id },
  };
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Spawns the real runner exactly as stage-process.js does (execPath, argv
// [runner, stage], shell:false, stdio with ipc) plus the test-only transport
// preload. Never sends the payload by itself. `extra` adds transport-script
// options (resultSend). Like the real parent (FT0-C2), it ACKs the first
// result it receives unless `autoAck` is false.
function startChild(t, testCase, steps, extra = {}, { autoAck = true } = {}) {
  const log = path.join(testCase.dir, "transport.log");
  const scriptFile = path.join(testCase.dir, "transport.json");
  fs.writeFileSync(scriptFile, JSON.stringify({ ...extra, log, steps }));
  fs.writeFileSync(log, "");
  const child = childProcess.spawn(process.execPath, ["--require", FAKE_TRANSPORT, RUNNERS[testCase.runner], testCase.stage], {
    cwd: testCase.dir,
    env: baseEnv({ ...testCase.env, SEC_C1_TRANSPORT_SCRIPT: scriptFile }),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  const messages = [];
  const waiters = [];
  child.on("message", (m) => {
    messages.push(m);
    if (autoAck && m && m.type === "result" && results(messages).length === 1) child.send({ type: "result-ack", receipt: m.receipt }, () => {});
    for (const w of [...waiters]) {
      if (w.match(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  // 'exit' plus both stdio streams, not 'close': after a parent-side
  // child.disconnect() Node never emits the aggregate 'close' event (the
  // IPC slot is not counted as closed), although the child has exited.
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const streamClosed = (s) => new Promise((resolve) => s.on("close", resolve));
  const closed = Promise.all([exited, streamClosed(child.stdout), streamClosed(child.stderr)]).then(([status]) => status);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  return {
    child,
    messages,
    sendPayload() {
      child.send({ type: "payload", stage: testCase.stage, payload: testCase.payload });
    },
    probe(event, index) {
      return this.message((m) => m && m.type === "sec-c1-probe" && m.event === event && m.index === index, `transport probe ${event}#${index}`);
    },
    message(match, what = "a matching child message") {
      const seen = messages.find(match);
      if (seen) return Promise.resolve(seen);
      const p = new Promise((resolve) => waiters.push({ match, resolve }));
      return withTimeout(p, PROBE_TIMEOUT_MS, what);
    },
    closed: () => withTimeout(closed, CLOSE_TIMEOUT_MS, "child termination"),
    events() {
      return fs
        .readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    },
    get output() {
      return output;
    },
  };
}

const fetchCount = (events) => events.filter((e) => e.event === "fetch").length;
const results = (messages) => messages.filter((m) => m && m.type === "result");

// --- in-process harness -----------------------------------------------------------

// A process stand-in: a real EventEmitter whose exit() is recorded only.
function fakeProcess() {
  const proc = new EventEmitter();
  proc.exits = [];
  proc.exit = (code) => proc.exits.push(code);
  return proc;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const okContent = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

const TRIAGE_CONTEXT = withInvocationEnv(localInvocationEnv(), () => contextForCurrentInvocation({ profile: PROFILE }));

// ===================================================================================
// T01 / T02 - existing retry classification and policy (regression guards)
// ===================================================================================

test("T01 [regression] HTTP 429 stays RATE_LIMIT, retryable - with and without a bound (not aborted) cancel signal", async () => {
  for (const Provider of [GroqProvider, GeminiProvider]) {
    for (const cancelSignal of [undefined, new AbortController().signal]) {
      const provider = new Provider({ apiKey: SECRET, model: "m", fetchImpl: async () => new Response("{}", { status: 429 }), cancelSignal });
      await assert.rejects(provider.analyze({ systemPrompt: "s", userPrompt: "u" }), (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, PROVIDER_ERROR_CODES.RATE_LIMIT);
        assert.equal(err.retryable, true);
        return true;
      });
    }
  }
});

test("T02 [regression] triage retry policy unchanged without disconnect: 3 attempts, delays 500ms then 1500ms", async () => {
  const delays = [];
  let calls = 0;
  const provider = {
    async analyze() {
      calls += 1;
      throw new ProviderError("rate", { code: PROVIDER_ERROR_CODES.RATE_LIMIT, retryable: true });
    },
  };
  await assert.rejects(runProviderAnalysis(provider, TRIAGE_CONTEXT, { projectProfile: PROFILE, sleep: async (ms) => delays.push(ms) }), /RATE_LIMIT/);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1500]);
});

test("T02 [regression] generator retry policy unchanged without disconnect: 2 immediate attempts on a retryable error", async () => {
  let calls = 0;
  const provider = {
    async analyze() {
      calls += 1;
      throw new ProviderError("rate", { code: PROVIDER_ERROR_CODES.RATE_LIMIT, retryable: true });
    },
  };
  const ingested = ingestRequirementEvidence({ projectId: PROFILE.id, sources: [{ text: "A requirement." }] });
  const r = await generateRequirementModel({ evidenceBundle: ingested.bundle, provider, expectedProjectId: PROFILE.id });
  assert.equal(r.ok, false);
  assert.equal(r.providerAttempts, 2);
  assert.equal(calls, 2);
});

test("T02 [regression] triage child with the parent connected: three 429s -> exactly three transport calls and a failure result", async (t) => {
  const c = triageCase(t);
  const h = startChild(t, c, [{ status: 429 }]);
  h.sendPayload();
  const { code } = await withTimeout(h.closed(), CLOSE_TIMEOUT_MS, "child");
  assert.equal(fetchCount(h.events()), 3);
  assert.equal(code, 1);
  const [result] = results(h.messages);
  assert.equal(result.ok, false);
});

// ===================================================================================
// T03 - disconnect before the initial payload
// ===================================================================================

for (const make of [triageCase, generativeCase]) {
  test(`T03 [${make.name}] disconnect before the payload: no provider is started and the child terminates via the SEC-C1 path`, async (t) => {
    const c = make(t);
    const h = startChild(t, c, ["hang"]);
    h.child.disconnect();
    const { code, signal } = await h.closed();
    assert.equal(fetchCount(h.events()), 0, "no provider call");
    assert.equal(signal, null);
    assert.equal(code, 1, "parent loss is a terminal failure of the child, never a silent success");
    assert.deepEqual(results(h.messages), []);
  });
}

// ===================================================================================
// T04 / T07 / T11 / T15 - disconnect during an active provider request
// ===================================================================================

for (const make of [triageCase, generativeCase]) {
  test(`T04/T07/T11 [${make.name}] disconnect during an in-flight request aborts the transport, starts no other call, and the child exits promptly`, async (t) => {
    const c = make(t);
    const h = startChild(t, c, ["hang"]);
    h.sendPayload();
    await h.probe("fetch", 0);
    h.child.disconnect();
    const { code, signal } = await h.closed();
    const events = h.events();
    assert.deepEqual(
      events.map((e) => `${e.event}#${e.index}`),
      ["fetch#0", "request-aborted#0"],
      "the one in-flight request is aborted at the transport and no other request is made"
    );
    assert.equal(signal, null);
    assert.equal(code, 1);
    assert.deepEqual(results(h.messages), [], "no result after parent loss");
  });
}

test("T07/T15 [generativeCase] disconnect during the immediate generator retry's request: exactly the two pre-disconnect calls, the second aborted", async (t) => {
  const c = generativeCase(t);
  const h = startChild(t, c, [{ status: 503 }, "hang"]);
  h.sendPayload();
  await h.probe("fetch", 1);
  h.child.disconnect();
  const { code } = await h.closed();
  assert.deepEqual(
    h.events().map((e) => `${e.event}#${e.index}`),
    ["fetch#0", "fetch#1", "request-aborted#1"]
  );
  assert.equal(code, 1);
});

// Real parent death (not a parent-side disconnect): an intermediate parent
// spawns the runner exactly like startChild(), forwards the payload, reports
// the runner's pid once the request is in flight, and is then SIGKILLed.
const INTERMEDIATE_PARENT = `
const cp = require("node:child_process");
const [runner, stage, preload, envJson, payloadJson] = process.argv.slice(1);
const child = cp.spawn(process.execPath, ["--require", preload, runner, stage], {
  env: JSON.parse(envJson), shell: false, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
});
child.on("message", (m) => {
  if (m && m.type === "sec-c1-probe" && m.event === "fetch" && m.index === 0) process.stdout.write("PID " + child.pid + "\\n");
});
child.send({ type: "payload", stage, payload: JSON.parse(payloadJson) });
`;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Bounded condition polling (the grandchild is not ours to await).
async function until(predicate, what) {
  const deadline = Date.now() + CLOSE_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

for (const make of [triageCase, generativeCase]) {
  test(`T04/T11/T15 [${make.name}] real parent death (SIGKILL) mid-request: the orphaned child aborts the request and terminates`, async (t) => {
    const c = make(t);
    const log = path.join(c.dir, "transport.log");
    const scriptFile = path.join(c.dir, "transport.json");
    fs.writeFileSync(scriptFile, JSON.stringify({ log, steps: ["hang"] }));
    fs.writeFileSync(log, "");
    const env = baseEnv({ ...c.env, SEC_C1_TRANSPORT_SCRIPT: scriptFile });
    const parent = childProcess.spawn(process.execPath, ["-e", INTERMEDIATE_PARENT, RUNNERS[c.runner], c.stage, FAKE_TRANSPORT, JSON.stringify(env), JSON.stringify(c.payload)], {
      cwd: c.dir,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let pid = null;
    t.after(() => {
      if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
      if (pid !== null && processAlive(pid)) process.kill(pid, "SIGKILL");
    });
    let out = "";
    pid = await withTimeout(
      new Promise((resolve) =>
        parent.stdout.on("data", (chunk) => {
          out += chunk;
          const m = out.match(/PID (\d+)\n/);
          if (m) resolve(Number(m[1]));
        })
      ),
      PROBE_TIMEOUT_MS,
      "the runner's in-flight request"
    );
    parent.kill("SIGKILL");
    await until(() => !processAlive(pid), "the orphaned runner to terminate");
    const events = fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((e) => `${e.event}#${e.index}`);
    if (process.platform === "win32") {
      // libuv assigns every spawned child to a kill-on-close job object, so
      // the OS hard-kills the orphan with its parent: it terminates and no
      // further request starts, but no in-process abort can be observed.
      assert.deepEqual(events.filter((e) => e.startsWith("fetch#")), ["fetch#0"]);
    } else {
      // POSIX orphans survive their parent (reparented); SEC-C1 itself must
      // abort the request and end the process.
      assert.deepEqual(events, ["fetch#0", "request-aborted#0"]);
    }
  });
}

// ===================================================================================
// T05 - disconnect while the provider response body is being read
// ===================================================================================

for (const make of [triageCase, generativeCase]) {
  test(`T05 [${make.name}] disconnect during the response-body read aborts the read and starts no other call`, async (t) => {
    const c = make(t);
    const h = startChild(t, c, ["hang-body"]);
    h.sendPayload();
    await h.probe("body-read", 0);
    h.child.disconnect();
    const { code } = await h.closed();
    const events = h.events();
    assert.ok(
      events.some((e) => e.event === "body-aborted" && e.index === 0),
      `the body read's signal must be aborted: ${JSON.stringify(events)}`
    );
    assert.equal(fetchCount(events), 1);
    assert.equal(code, 1);
  });
}

// ===================================================================================
// T06 - disconnect during the triage retry backoff
// ===================================================================================

test("T06 [triageCase] disconnect during the retry backoff ends the wait: the next attempt never starts", async (t) => {
  const c = triageCase(t);
  const h = startChild(t, c, [{ status: 429 }, "hang"]);
  h.sendPayload();
  // fetch#0 resolves 429 within the same turn, so by the time the child
  // processes the disconnect it is inside the 500ms backoff.
  await h.probe("fetch", 0);
  h.child.disconnect();
  const { code } = await h.closed();
  assert.deepEqual(
    h.events().map((e) => `${e.event}#${e.index}`),
    ["fetch#0"],
    "no attempt after the backoff that the disconnect interrupted"
  );
  assert.equal(code, 1);
});

// ===================================================================================
// T07 - no provider call once cancelled (cooperative layer, in-process)
// ===================================================================================

test("T07 [new] a provider bound to an aborted cancel signal never touches the transport and fails non-retryably", async () => {
  for (const Provider of [GroqProvider, GeminiProvider]) {
    const controller = new AbortController();
    controller.abort();
    let transportCalls = 0;
    const provider = new Provider({
      apiKey: SECRET,
      model: "m",
      fetchImpl: async () => {
        transportCalls += 1;
        return okContent("x");
      },
      cancelSignal: controller.signal,
    });
    await assert.rejects(provider.analyze({ systemPrompt: "s", userPrompt: "u" }), (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.retryable, false, "cancellation is never retryable");
      assert.notEqual(err.code, PROVIDER_ERROR_CODES.RATE_LIMIT);
      assert.notEqual(err.code, PROVIDER_ERROR_CODES.TIMEOUT);
      assert.notEqual(err.code, PROVIDER_ERROR_CODES.NETWORK);
      return true;
    });
    assert.equal(transportCalls, 0);
  }
});

// ===================================================================================
// T08 / T09 - races (deterministic, in-process; exit() recorded, not performed)
// ===================================================================================

for (const [name, runner] of [
  ["stage-runner", stageRunner],
  ["generative-runner", generativeRunner],
]) {
  for (const order of ["timer-then-disconnect", "disconnect-then-timer"]) {
    test(`T08 [${name}] race ${order}: no retry attempt starts after the disconnect`, async () => {
      const proc = fakeProcess();
      const link = runner.guardParentLink(proc);
      let transportCalls = 0;
      const provider = new GroqProvider({
        apiKey: SECRET,
        model: "m",
        fetchImpl: async () => {
          transportCalls += 1;
          return new Response("{}", { status: 429 });
        },
        cancelSignal: link.signal,
      });
      const backoff = deferred();
      let sleeping;
      const asleep = new Promise((r) => (sleeping = r));
      const run = runProviderAnalysis(provider, TRIAGE_CONTEXT, {
        projectProfile: PROFILE,
        sleep: () => {
          sleeping();
          return backoff.promise;
        },
      });
      await asleep;
      // Both happen in the same synchronous turn, in either order.
      if (order === "timer-then-disconnect") {
        backoff.resolve();
        proc.emit("disconnect");
      } else {
        proc.emit("disconnect");
        backoff.resolve();
      }
      await assert.rejects(run, (err) => {
        assert.doesNotMatch(err.message, /RATE_LIMIT|TIMEOUT|NETWORK/, "cancellation is not reported as a retryable provider event");
        return true;
      });
      assert.equal(transportCalls, 1, "only the pre-disconnect attempt reached the transport");
      assert.deepEqual(proc.exits, [1]);
    });
  }

  for (const outcome of ["resolve-success", "resolve-429", "reject-network"]) {
    test(`T09 [${name}] race: disconnect in the same turn as the provider ${outcome} -> no success, no retry`, async () => {
      const proc = fakeProcess();
      const link = runner.guardParentLink(proc);
      const pending = deferred();
      let transportCalls = 0;
      const provider = new GeminiProvider({
        apiKey: SECRET,
        model: "m",
        fetchImpl: (url, init) => {
          transportCalls += 1;
          if (transportCalls > 1) return Promise.resolve(okContent("late"));
          init.signal.addEventListener("abort", () => pending.reject(new DOMException("aborted", "AbortError")), { once: true });
          return pending.promise;
        },
        cancelSignal: link.signal,
      });
      const delays = [];
      const run = runProviderAnalysis(provider, TRIAGE_CONTEXT, { projectProfile: PROFILE, sleep: async (ms) => delays.push(ms) });
      await new Promise((r) => setImmediate(r));
      assert.equal(transportCalls, 1);
      if (outcome === "resolve-success") {
        pending.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 }));
      } else if (outcome === "resolve-429") {
        pending.resolve(new Response("{}", { status: 429 }));
      } else {
        pending.reject(new TypeError("fetch failed"));
      }
      proc.emit("disconnect");
      await assert.rejects(run, (err) => {
        assert.match(err.message, /AI provider request failed \(UNKNOWN\)/, "the cancellation itself ends the run - never a success, a validation outcome or a retryable code");
        return true;
      });
      assert.equal(transportCalls, 1, "no second provider call");
      assert.deepEqual(delays, [], "no backoff is entered for a cancellation");
      assert.equal(link.report({ type: "result", ok: true }), false, "a cancelled child can never report a result");
      assert.deepEqual(proc.exits, [1]);
    });
  }
}

// ===================================================================================
// T10 / T12 - idempotency and the normal intentional disconnect
// ===================================================================================

for (const [name, runner] of [
  ["stage-runner", stageRunner],
  ["generative-runner", generativeRunner],
]) {
  test(`T10 [${name}] repeated disconnects are one terminal transition: one abort, one exit, completion refused`, () => {
    const proc = fakeProcess();
    const link = runner.guardParentLink(proc);
    let aborts = 0;
    link.signal.addEventListener("abort", () => (aborts += 1));
    proc.emit("disconnect");
    proc.emit("disconnect");
    proc.emit("disconnect");
    assert.equal(aborts, 1);
    assert.equal(link.signal.aborted, true);
    assert.deepEqual(proc.exits, [1]);
    assert.equal(link.report({ type: "result", ok: true }), false);
    assert.equal(link.report({ type: "result", ok: false }), false);
  });

  test(`T12 [${name}] the child's own disconnect after a delivered result is not a cancellation`, async () => {
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    assert.equal(link.report({ type: "result", ok: true }), true, "the first completion may report");
    assert.equal(link.report({ type: "result", ok: true }), false, "a result is reported at most once");
    proc.sent[0].callback(null);
    proc.ack();
    await tick();
    assert.equal(proc.selfDisconnects, 1);
    assert.equal(link.signal.aborted, false);
    assert.deepEqual(proc.exits, []);
  });

  test(`T10/T11 [${name}] the guard registers exactly one disconnect listener and no signal handlers`, () => {
    const proc = fakeProcess();
    runner.guardParentLink(proc);
    assert.equal(proc.listenerCount("disconnect"), 1);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) assert.equal(proc.listenerCount(sig), 0, sig);
  });
}

test("T11 [new] a provider removes its cancel listener after every request (no listener accumulation)", async () => {
  for (const Provider of [GroqProvider, GeminiProvider]) {
    const controller = new AbortController();
    const responses = [okContent("ok"), new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }), new Response("{}", { status: 500 })];
    let i = 0;
    const provider = new Provider({ apiKey: SECRET, model: "m", fetchImpl: async () => responses[i++ % responses.length], cancelSignal: controller.signal });
    for (let n = 0; n < 3; n += 1) await provider.analyze({ systemPrompt: "s", userPrompt: "u" }).catch(() => {});
    assert.equal(getEventListeners(controller.signal, "abort").length, 0, Provider.name);
  }
});

test("T12 [triageCase] normal completion: result delivered, exit 0, no false cancellation", async (t) => {
  const c = triageCase(t);
  const h = startChild(t, c, [{ content: c.validContent }]);
  h.sendPayload();
  const { code, signal } = await h.closed();
  assert.equal(signal, null);
  assert.equal(code, 0, h.output);
  assert.deepEqual(results(h.messages).map((r) => r.ok), [true]);
  assert.equal(fetchCount(h.events()), 1);
  assert.ok(fs.existsSync(path.join(c.dir, "reports", "ai", "ai-report.json")));
});

test("T12/T15 [generativeCase] a completed failure result is delivered unchanged with the parent connected", async (t) => {
  const c = generativeCase(t);
  const h = startChild(t, c, [{ status: 400 }]);
  h.sendPayload();
  const { code } = await h.closed();
  assert.equal(code, 1);
  const [result] = results(h.messages);
  assert.deepEqual(result.failure, { kind: "generation", step: "requirementModel", providerAttempts: 1, codes: ["UNKNOWN"] });
  assert.equal(fetchCount(h.events()), 1);
});

// ===================================================================================
// T13 - native user-signal termination is preserved (PD-R6)
// ===================================================================================

for (const sig of ["SIGTERM", "SIGINT"]) {
  test(`T13 [triageCase] ${sig} during a provider request still terminates the child natively by signal (no handler, no invented exit code)`, async (t) => {
    const c = triageCase(t);
    const h = startChild(t, c, ["hang"]);
    h.sendPayload();
    await h.probe("fetch", 0);
    h.child.kill(sig);
    const { code, signal } = await h.closed();
    assert.equal(signal, sig);
    assert.equal(code, null);
    assert.deepEqual(results(h.messages), []);
  });
}

// ===================================================================================
// T14 - safe reporting of the cancellation path
// ===================================================================================

test("T14 [new] a cancelled request's error carries no credential, transport text or cause, and sanitizes to the fixed message", async () => {
  for (const Provider of [GroqProvider, GeminiProvider]) {
    const controller = new AbortController();
    const provider = new Provider({
      apiKey: SECRET,
      model: "m",
      fetchImpl: (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error(`socket closed for key ${SECRET} body {"secret":1}`)), { once: true });
        }),
      cancelSignal: controller.signal,
    });
    const run = provider.analyze({ systemPrompt: "s", userPrompt: "u" });
    controller.abort();
    await assert.rejects(run, (err) => {
      assert.equal(err.message.includes(SECRET), false);
      assert.equal(err.message.includes("secret"), false);
      assert.equal(err.cause, undefined, "the raw transport error is not attached");
      assert.deepEqual(summarizeProviderError(err), { code: PROVIDER_ERROR_CODES.UNKNOWN, message: "Unknown provider error", retryable: false });
      return true;
    });
  }
});

test("T14 [triageCase] a disconnected child writes no credential to its output", async (t) => {
  const c = triageCase(t);
  const h = startChild(t, c, ["hang"]);
  h.sendPayload();
  await h.probe("fetch", 0);
  h.child.disconnect();
  await h.closed();
  assert.equal(h.output.includes(SECRET), false);
});

// ===================================================================================
// FT0-C1 M01 - result-transfer lifecycle: parent loss while the result is being sent
// ===================================================================================

// Node's IPC lifecycle, as the guard sees it: disconnect() clears `connected`
// at once and emits 'disconnect' on a later tick; send() on a closed channel
// reports ERR_IPC_CHANNEL_CLOSED to its callback on a later tick; an async
// write's callback is held by the test (proc.sent) and released explicitly.
function ipcProcess() {
  const proc = fakeProcess();
  proc.connected = true;
  proc.sent = [];
  proc.selfDisconnects = 0;
  proc.send = (message, callback) => {
    if (!proc.connected) {
      process.nextTick(callback, Object.assign(new Error("Channel closed"), { code: "ERR_IPC_CHANNEL_CLOSED" }));
      return false;
    }
    proc.sent.push({ message, callback });
    return true;
  };
  const close = () => {
    proc.connected = false;
    process.nextTick(() => proc.emit("disconnect"));
  };
  proc.disconnect = () => {
    proc.selfDisconnects += 1;
    close();
  };
  proc.parentLost = close;
  // FT0-C2: the parent's receipt for the result sent first.
  proc.ack = () => proc.emit("message", { type: "result-ack", receipt: proc.sent[0].message.receipt });
  return proc;
}

const tick = () => new Promise((r) => setImmediate(r));

for (const [name, runner] of [
  ["stage-runner", stageRunner],
  ["generative-runner", generativeRunner],
]) {
  const RESULT = Object.freeze({ type: "result", ok: true });

  test(`C1-M01 [${name}] parent lost before the result is sent (event still pending): nothing is sent, one failed exit`, async () => {
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    proc.parentLost();
    assert.equal(link.report(RESULT), false);
    assert.equal(proc.sent.length, 0);
    await tick();
    assert.equal(link.signal.aborted, true);
    assert.deepEqual(proc.exits, [1]);
  });

  test(`C1-M01 [${name}] parent lost while the send callback is delayed: failed exit, a late callback changes nothing`, async () => {
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    assert.equal(link.report(RESULT), true);
    proc.parentLost();
    await tick();
    assert.deepEqual(proc.exits, [1], "a pending send is not a completed delivery");
    assert.equal(link.signal.aborted, true);
    proc.sent[0].callback(null);
    proc.sent[0].callback(new Error("late"));
    await tick();
    assert.deepEqual(proc.exits, [1]);
    assert.equal(proc.selfDisconnects, 0);
  });

  test(`C1-M01 [${name}] the send callback receives an error: failed exit, never a success`, async () => {
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    link.report(RESULT);
    proc.sent[0].callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    await tick();
    assert.deepEqual(proc.exits, [1]);
    assert.equal(proc.selfDisconnects, 0);
  });

  test(`C1-M01 [${name}] callback null after the channel closed but before its 'disconnect' event: failed exit (Node reports null whatever the write status)`, async () => {
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    link.report(RESULT);
    proc.parentLost();
    proc.sent[0].callback(null);
    assert.deepEqual(proc.exits, [1]);
    await tick();
    assert.deepEqual(proc.exits, [1], "the later 'disconnect' event is not a second outcome");
    assert.equal(proc.selfDisconnects, 0);
  });

  test(`C1-M01 [${name}] callback then the parent's ACK, before the child's own disconnect: delivered, no cancellation`, async () => {
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    assert.equal(link.report(RESULT), true);
    const { receipt, ...sent } = proc.sent[0].message;
    assert.deepEqual(sent, RESULT);
    assert.match(receipt, /^[0-9a-f]{32}$/);
    proc.sent[0].callback(null);
    assert.equal(proc.selfDisconnects, 0, "FT0-C2: a send callback is not a delivery");
    proc.ack();
    await tick();
    assert.equal(proc.selfDisconnects, 1);
    await tick();
    proc.emit("disconnect");
    assert.deepEqual(proc.exits, []);
    assert.equal(link.signal.aborted, false);
  });

  for (const order of ["callback-then-loss", "loss-then-callback"]) {
    test(`C1-M01 [${name}] same-turn race ${order}: exactly one terminal outcome`, async () => {
      const proc = ipcProcess();
      const link = runner.guardParentLink(proc);
      link.report(RESULT);
      if (order === "callback-then-loss") {
        proc.sent[0].callback(null);
        proc.parentLost();
      } else {
        proc.parentLost();
        proc.sent[0].callback(null);
      }
      await tick();
      await tick();
      // FT0-C2: with no ACK, neither order is a delivery.
      assert.equal(proc.selfDisconnects, 0);
      assert.deepEqual(proc.exits, [1], "a write the parent never acknowledged is never a success");
      assert.equal(link.signal.aborted, true);
    });
  }

  test(`C1-M01 [${name}] repeated disconnects while sending: one abort, one exit`, async () => {
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    let aborts = 0;
    link.signal.addEventListener("abort", () => (aborts += 1));
    link.report(RESULT);
    proc.parentLost();
    await tick();
    proc.emit("disconnect");
    proc.emit("disconnect");
    proc.sent[0].callback(new Error("late"));
    await tick();
    assert.equal(aborts, 1);
    assert.deepEqual(proc.exits, [1]);
  });

  test(`C1-M01 [${name}] a result is reported at most once`, () => {
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    assert.equal(link.report(RESULT), true);
    assert.equal(link.report({ type: "result", ok: false }), false);
    assert.equal(proc.sent.length, 1);
  });

  test(`C1-M01 [${name}] a send that throws synchronously is a failed delivery`, () => {
    const proc = ipcProcess();
    proc.send = () => {
      throw new TypeError("could not serialize");
    };
    const link = runner.guardParentLink(proc);
    assert.equal(link.report(RESULT), false);
    assert.deepEqual(proc.exits, [1]);
  });
}

// Child-process M01 probes: the REAL runner, the REAL Node IPC channel; the
// transport preload only withholds the result write (resultSend).
for (const mode of ["hold", "hold-error", "hold-ok"]) {
  for (const [label, make, steps] of [
    ["triage success", (t) => triageCase(t), (c) => [{ content: c.validContent }]],
    ["generative success", (t) => generativeSuccessCase(t), () => ["hang"]],
    ["triage error result", (t) => triageCase(t), () => [{ status: 400 }]],
  ]) {
    test(`C1-M01 [${label}] result send ${mode} then parent disconnect: exit 1, never a false success, no result`, async (t) => {
      const c = make(t);
      const h = startChild(t, c, steps(c), { resultSend: mode });
      h.sendPayload();
      await h.probe("result-held", 0);
      h.child.disconnect();
      const { code, signal } = await h.closed();
      assert.equal(signal, null);
      assert.equal(code, 1, `a result that was never delivered is a failed child: ${h.output}`);
      assert.deepEqual(results(h.messages), []);
    });
  }
}

test("C1-M01 [generative success] normal result transmission is unchanged: delivered, exit 0, zero provider calls", async (t) => {
  const c = generativeSuccessCase(t);
  const h = startChild(t, c, ["hang"]);
  h.sendPayload();
  const { code, signal } = await h.closed();
  assert.equal(signal, null);
  assert.equal(code, 0, h.output);
  assert.deepEqual(results(h.messages).map((r) => r.ok), [true]);
  assert.equal(fetchCount(h.events()), 0);
});

// ===================================================================================
// FT0-C1 M02 - an unsuccessful HTTP response never leaves its body or request active
// ===================================================================================

// A body that never finishes, recording its cancellation.
function unfinishedBody(log, index) {
  return new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      log.push(`body-cancelled#${index}`);
    },
  });
}

for (const Provider of [GroqProvider, GeminiProvider]) {
  for (const [status, code] of [
    [429, PROVIDER_ERROR_CODES.RATE_LIMIT],
    [500, PROVIDER_ERROR_CODES.UNKNOWN],
    [503, PROVIDER_ERROR_CODES.UNKNOWN],
  ]) {
    test(`C1-M02 [${Provider.name}] HTTP ${status} with an unfinished body: mapping unchanged, body cancelled and request signal aborted`, async () => {
      const log = [];
      const signals = [];
      const provider = new Provider({
        apiKey: SECRET,
        model: "m",
        fetchImpl: async (url, init) => {
          signals.push(init.signal);
          return new Response(unfinishedBody(log, 0), { status });
        },
        cancelSignal: new AbortController().signal,
      });
      await assert.rejects(provider.analyze({ systemPrompt: "s", userPrompt: "u" }), (err) => {
        assert.equal(err.code, code);
        assert.equal(err.retryable, true);
        return true;
      });
      assert.deepEqual(log, ["body-cancelled#0"]);
      assert.deepEqual(signals.map((s) => s.aborted), [true]);
    });
  }

  test(`C1-M02 [${Provider.name}] two-request signal probe: parent loss during the retry leaves no earlier request active`, async () => {
    const cancel = new AbortController();
    const log = [];
    const signals = [];
    let started;
    const secondStarted = new Promise((r) => (started = r));
    const provider = new Provider({
      apiKey: SECRET,
      model: "m",
      fetchImpl: (url, init) => {
        const index = signals.length;
        signals.push(init.signal);
        if (index === 0) return Promise.resolve(new Response(unfinishedBody(log, 0), { status: 429 }));
        started();
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      },
      cancelSignal: cancel.signal,
    });
    const delays = [];
    const run = runProviderAnalysis(provider, TRIAGE_CONTEXT, { projectProfile: PROFILE, sleep: async (ms) => delays.push(ms) });
    await secondStarted;
    cancel.abort();
    await assert.rejects(run, /AI provider request failed \(UNKNOWN\)/);
    assert.deepEqual(signals.map((s) => s.aborted), [true, true], "every request signal, not only the latest");
    assert.deepEqual(log, ["body-cancelled#0"]);
    assert.deepEqual(delays, [500]);
  });

  test(`C1-M02 [${Provider.name}] parent loss after the HTTP error, before the retry: the failed request is already released, no retry`, async () => {
    const cancel = new AbortController();
    const log = [];
    const signals = [];
    const backoff = deferred();
    let sleeping;
    const asleep = new Promise((r) => (sleeping = r));
    const provider = new Provider({
      apiKey: SECRET,
      model: "m",
      fetchImpl: async (url, init) => {
        signals.push(init.signal);
        return new Response(unfinishedBody(log, signals.length - 1), { status: 429 });
      },
      cancelSignal: cancel.signal,
    });
    const run = runProviderAnalysis(provider, TRIAGE_CONTEXT, {
      projectProfile: PROFILE,
      sleep: () => {
        sleeping();
        return backoff.promise;
      },
    });
    await asleep;
    assert.deepEqual(signals.map((s) => s.aborted), [true], "released before the backoff, not by the disconnect");
    assert.deepEqual(log, ["body-cancelled#0"]);
    cancel.abort();
    backoff.resolve();
    await assert.rejects(run);
    assert.equal(signals.length, 1, "no post-disconnect provider call");
  });

  test(`C1-M02 [${Provider.name}] retry semantics without cancellation: 3 attempts, 500/1500ms, every failed request released`, async () => {
    const log = [];
    const signals = [];
    const provider = new Provider({
      apiKey: SECRET,
      model: "m",
      fetchImpl: async (url, init) => {
        signals.push(init.signal);
        return new Response(unfinishedBody(log, signals.length - 1), { status: 429 });
      },
      cancelSignal: new AbortController().signal,
    });
    const delays = [];
    await assert.rejects(runProviderAnalysis(provider, TRIAGE_CONTEXT, { projectProfile: PROFILE, sleep: async (ms) => delays.push(ms) }), /RATE_LIMIT/);
    assert.deepEqual(delays, [500, 1500]);
    assert.deepEqual(signals.map((s) => s.aborted), [true, true, true]);
    assert.deepEqual(log, ["body-cancelled#0", "body-cancelled#1", "body-cancelled#2"]);
  });

  for (const failure of ["throws", "rejects", "never-settles", "no-body"]) {
    test(`C1-M02 [${Provider.name}] body cleanup that ${failure}: still RATE_LIMIT, retryable, promptly, request signal aborted`, async () => {
      let signal;
      const body = {
        throws: {
          cancel() {
            throw new Error(`cleanup ${SECRET}`);
          },
        },
        rejects: { cancel: () => Promise.reject(new Error(`cleanup ${SECRET}`)) },
        "never-settles": { cancel: () => new Promise(() => {}) },
        "no-body": null,
      }[failure];
      const provider = new Provider({
        apiKey: SECRET,
        model: "m",
        fetchImpl: async (url, init) => {
          signal = init.signal;
          return { ok: false, status: 429, body };
        },
      });
      await withTimeout(
        assert.rejects(provider.analyze({ systemPrompt: "s", userPrompt: "u" }), (err) => {
          assert.equal(err.code, PROVIDER_ERROR_CODES.RATE_LIMIT);
          assert.equal(err.retryable, true);
          assert.equal(err.message.includes(SECRET), false);
          assert.equal(err.cause, undefined);
          return true;
        }),
        1000,
        "the HTTP error mapping"
      );
      assert.equal(signal.aborted, true);
    });
  }
}

// Child-process M02 probes: the REAL runners and adapters, an HTTP 429 whose
// body never finishes, then parent loss.
for (const make of [triageCase, generativeCase]) {
  test(`C1-M02 [${make.name}] disconnect during the retry after a 429 with an unfinished body: both requests released, no third call`, async (t) => {
    const c = make(t);
    const h = startChild(t, c, [{ status: 429, body: "hang" }, "hang"]);
    h.sendPayload();
    await h.probe("fetch", 1);
    h.child.disconnect();
    const { code } = await h.closed();
    const events = h.events().map((e) => `${e.event}#${e.index}`);
    assert.equal(code, 1);
    assert.equal(fetchCount(h.events()), 2, JSON.stringify(events));
    const second = events.indexOf("fetch#1");
    assert.ok(events.indexOf("body-cancelled#0") > -1 && events.indexOf("body-cancelled#0") < second, `the 429 body is cancelled before the retry: ${JSON.stringify(events)}`);
    assert.ok(events.indexOf("request-aborted#0") > -1 && events.indexOf("request-aborted#0") < second, `the 429 request is aborted before the retry: ${JSON.stringify(events)}`);
    assert.ok(events.includes("request-aborted#1"), JSON.stringify(events));
  });
}

test("C1-M02 [triageCase] disconnect in the backoff after a 429 with an unfinished body: the 429 request is already released, no retry", async (t) => {
  const c = triageCase(t);
  const h = startChild(t, c, [{ status: 429, body: "hang" }, "hang"]);
  h.sendPayload();
  await h.probe("fetch", 0);
  h.child.disconnect();
  const { code } = await h.closed();
  const events = h.events().map((e) => `${e.event}#${e.index}`);
  assert.equal(code, 1);
  assert.deepEqual(events.filter((e) => e.startsWith("fetch#")), ["fetch#0"]);
  assert.ok(events.includes("body-cancelled#0") && events.includes("request-aborted#0"), JSON.stringify(events));
});

// ===================================================================================
// FT0-C2 - Parent ACK: a result is delivered only on the parent's private receipt
// ===================================================================================

const ACK_DEADLINE_MS = 10000;
const RECEIPT = /^[0-9a-f]{32}$/;
const STAGE_PROCESS = require.resolve("./stage-process.js");
const RETURN_KEYS = ["spawnError", "exitCode", "signal", "result", "stdout", "stderr"];

function transportScript(testCase, steps, extra = {}) {
  const log = path.join(testCase.dir, "transport.log");
  const scriptFile = path.join(testCase.dir, "transport.json");
  fs.writeFileSync(scriptFile, JSON.stringify({ ...extra, log, steps }));
  fs.writeFileSync(log, "");
  return { log, scriptFile };
}

const readEvents = (log) =>
  fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((e) => `${e.event}#${e.index}`);
const fetches = (events) => events.filter((e) => e.startsWith("fetch#")).length;

// Each runner, reaching a successful result (triage: one provider call;
// generative: none) and an error result (one HTTP 400).
const C2_RUNNERS = [
  {
    name: "triage",
    success: (t) => {
      const c = triageCase(t);
      return { c, steps: [{ content: c.validContent }], calls: 1 };
    },
    error: (t) => ({ c: triageCase(t), steps: [{ status: 400 }] }),
  },
  {
    name: "generative",
    success: (t) => ({ c: generativeSuccessCase(t), steps: ["hang"], calls: 0 }),
    error: (t) => ({ c: generativeCase(t), steps: [{ status: 400 }] }),
  },
];

// --- the REAL runStageProcess() over the REAL runner and native IPC ------------------

// What becomes of the parent's ACK on its way to the child.
const ACK_ROUTES = Object.freeze({
  pass: (child, send, message, rest) => send(message, ...rest),
  twice: (child, send, message, rest) => {
    send(message);
    return send(message, ...rest);
  },
  withhold: () => true,
  throw: () => {
    throw new Error("ACK send failed");
  },
  "callback-error": (child, send, message, rest) => {
    const callback = rest.find((a) => typeof a === "function");
    process.nextTick(callback, Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    return false;
  },
  // Every one is sent; none may authorize delivery. Then nothing.
  malformed: (child, send, message) => {
    for (const bad of [
      { type: "result-ack" },
      { type: "result-ack", receipt: "0".repeat(32) },
      { type: "result-ack", receipt: message.receipt.toUpperCase() },
      { type: "result-ack", receipt: [message.receipt] },
      { type: "result-ack ", receipt: message.receipt },
      { type: "ack", receipt: message.receipt },
      { type: "result", receipt: message.receipt },
      { receipt: message.receipt },
      "result-ack",
      [message.receipt],
    ]) {
      send(bad);
    }
    return true;
  },
  // Parent loss after the result is stored, before its ACK.
  disconnect: (child) => {
    child.disconnect();
    return true;
  },
});

function launch(t, c, steps, { ack = "pass" } = {}) {
  const { log, scriptFile } = transportScript(c, steps);
  const acks = [];
  let ackSeen;
  const ackAttempted = new Promise((r) => (ackSeen = r));
  let child = null;
  const spawnImpl = (command, args, options) => {
    child = childProcess.spawn(command, ["--require", FAKE_TRANSPORT, ...args], options);
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    const send = child.send.bind(child);
    child.send = (message, ...rest) => {
      if (!message || message.type !== "result-ack") return send(message, ...rest);
      acks.push({ message, at: Date.now() });
      ackSeen();
      return ACK_ROUTES[ack](child, send, message, rest);
    };
    return child;
  };
  const outcome = runStageProcess({ stage: c.stage, payload: c.payload, env: baseEnv({ ...c.env, SEC_C1_TRANSPORT_SCRIPT: scriptFile }), cwd: c.dir, runner: c.runner, spawnImpl });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal, at: Date.now() })));
  return {
    child,
    acks,
    outcome: (ms = CLOSE_TIMEOUT_MS) => withTimeout(outcome, ms, "runStageProcess()"),
    exited: (ms = CLOSE_TIMEOUT_MS) => withTimeout(exited, ms, "child exit"),
    ackAttempted: () => withTimeout(ackAttempted, PROBE_TIMEOUT_MS, "the parent's ACK"),
    events: () => readEvents(log),
  };
}

for (const r of C2_RUNNERS) {
  test(`C2 [${r.name}] normal result: the parent stores it, ACKs it once, the child exits 0; return shape unchanged`, async (t) => {
    const { c, steps, calls } = r.success(t);
    const run = launch(t, c, steps);
    const outcome = await run.outcome();
    assert.deepEqual(Object.keys(outcome), RETURN_KEYS);
    assert.equal(outcome.spawnError, false);
    assert.equal(outcome.signal, null);
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.equal(outcome.result.type, "result");
    assert.equal(outcome.result.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(outcome.result, "receipt"), false, "the private receipt is not part of the stored result");
    assert.equal(run.acks.length, 1);
    assert.match(run.acks[0].message.receipt, RECEIPT);
    assert.deepEqual(Object.keys(run.acks[0].message).sort(), ["receipt", "type"]);
    assert.equal(fetches(run.events()), calls);
  });

  test(`C2 [${r.name}] error result: ACKed once, the existing failure exit 1 is preserved`, async (t) => {
    const { c, steps } = r.error(t);
    const run = launch(t, c, steps);
    const outcome = await run.outcome();
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.signal, null);
    assert.equal(outcome.result.ok, false);
    assert.equal(run.acks.length, 1);
    if (r.name === "generative") assert.deepEqual(outcome.result.failure, { kind: "generation", step: "requirementModel", providerAttempts: 1, codes: ["UNKNOWN"] });
  });

  // Both ACKs arrive in one read; on Node 22 a self-disconnect from inside
  // the first one's dispatch crashed the child on the second.
  test(`C2 [${r.name}] duplicate ACK: one delivery, exit 0, no crash`, async (t) => {
    const { c, steps } = r.success(t);
    const run = launch(t, c, steps, { ack: "twice" });
    const outcome = await run.outcome();
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.equal(outcome.result.ok, true);
    assert.doesNotMatch(outcome.stderr, /TypeError|kPendingMessages/);
  });

  test(`C2 [${r.name}] parent loss after storing the result, before its ACK: exit 1, no further provider call`, async (t) => {
    const { c, steps, calls } = r.success(t);
    const run = launch(t, c, steps, { ack: "disconnect" });
    const { code, signal } = await run.exited();
    assert.equal(signal, null);
    assert.equal(code, 1, "a result the parent never acknowledged is never a success");
    assert.equal(fetches(run.events()), calls);
  });

  for (const sig of ["SIGTERM", "SIGINT"]) {
    test(`C2 [${r.name}] ${sig} while awaiting the ACK still terminates the child natively by signal`, async (t) => {
      const { c, steps } = r.success(t);
      const run = launch(t, c, steps, { ack: "withhold" });
      await run.ackAttempted();
      run.child.kill(sig);
      const outcome = await run.outcome();
      assert.equal(outcome.signal, sig);
      assert.equal(outcome.exitCode, null);
      assert.equal(outcome.result.ok, true, "the stored result does not make a signalled child a success");
    });
  }
}

// The 10-second ACK deadline, natively; these wait it out, so they overlap.
describe("C2 ACK deadline (native IPC, real runStageProcess())", { concurrency: true }, () => {
  const deadlineCases = [];
  for (const r of C2_RUNNERS) {
    for (const ack of ["withhold", "malformed", "throw", "callback-error"]) deadlineCases.push([r, ack]);
  }

  for (const [r, ack] of deadlineCases) {
    test(`C2 [${r.name}] ACK ${ack}: the child fails closed at the 10s deadline - exit 1, never a success, never a spawn error`, async (t) => {
      const { c, steps, calls } = r.success(t);
      const run = launch(t, c, steps, { ack });
      const outcome = await run.outcome(ACK_DEADLINE_MS + 15000);
      const { at } = await run.exited();
      assert.deepEqual(Object.keys(outcome), RETURN_KEYS);
      assert.equal(outcome.spawnError, false);
      assert.equal(outcome.signal, null);
      assert.equal(outcome.exitCode, 1);
      assert.equal(outcome.result.ok, true, "the result was stored; only the missing ACK fails the child");
      assert.equal(run.acks.length, 1, "the parent ACKs at most once");
      const waited = at - run.acks[0].at;
      assert.ok(waited >= ACK_DEADLINE_MS - 1500 && waited <= ACK_DEADLINE_MS + 5000, `deadline ~${ACK_DEADLINE_MS}ms, observed ${waited}ms`);
      assert.equal(fetches(run.events()), calls);
    });
  }
});

// --- FT0-R2-M01 reproducer: a parent whose event loop is blocked -------------------
//
// The intermediate parent runs the REAL runStageProcess(), then blocks its
// event loop: the child's result reaches this end of the pipe, the child's
// send callback runs with null, and nothing is read. Then the parent closes
// the channel (close), dies (die), or resumes and reads normally (read).

const BLOCKED_PARENT = `
const cp = require("node:child_process");
const fs = require("node:fs");
const [stageProcess, runner, stage, preload, envJson, payloadJson, log, mode] = process.argv.slice(1);
const { runStageProcess } = require(stageProcess);
let child;
const run = runStageProcess({
  stage, payload: JSON.parse(payloadJson), env: JSON.parse(envJson), cwd: process.cwd(), runner,
  spawnImpl: (command, args, options) => (child = cp.spawn(command, ["--require", preload, ...args], options)),
});
const received = [];
child.on("message", (m) => received.push(m && m.type));
const cell = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 15000;
while (!fs.readFileSync(log, "utf8").includes('"result-sent"')) {
  if (Date.now() > deadline) { process.stdout.write(JSON.stringify({ error: "no result-sent" }) + "\\n"); process.exit(3); }
  Atomics.wait(cell, 0, 0, 10);
}
Atomics.wait(cell, 0, 0, 750);
const exitedWhileBlocked = fs.readFileSync(log, "utf8").includes('"exit"');
const report = (o) => process.stdout.write(JSON.stringify({ pid: child.pid, exitedWhileBlocked, received, ...o }) + "\\n");
if (mode === "close") {
  child.disconnect();
  child.on("exit", (code, signal) => report({ code, signal }));
} else if (mode === "die") {
  report({});
  process.exit(0);
} else {
  run.then((o) => report({ code: o.exitCode, signal: o.signal, result: o.result }));
}
`;

async function blockedParent(t, c, steps, mode) {
  const { log, scriptFile } = transportScript(c, steps, { resultSend: "observe", recordExit: true });
  const env = baseEnv({ ...c.env, SEC_C1_TRANSPORT_SCRIPT: scriptFile });
  const parent = childProcess.spawn(
    process.execPath,
    ["-e", BLOCKED_PARENT, STAGE_PROCESS, c.runner, c.stage, FAKE_TRANSPORT, JSON.stringify(env), JSON.stringify(c.payload), log, mode],
    { cwd: c.dir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  let out = "";
  let err = "";
  parent.stdout.on("data", (chunk) => (out += chunk));
  parent.stderr.on("data", (chunk) => (err += chunk));
  let pid = null;
  t.after(() => {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
    if (pid !== null && processAlive(pid)) process.kill(pid, "SIGKILL");
  });
  await withTimeout(new Promise((resolve) => parent.on("close", resolve)), PROBE_TIMEOUT_MS + CLOSE_TIMEOUT_MS, "the blocked parent");
  const line = out.trim().split("\n").pop();
  assert.ok(line, `blocked parent produced no report: ${err}`);
  const report = JSON.parse(line);
  assert.equal(report.error, undefined, `${report.error}: ${err}`);
  pid = report.pid;
  await until(() => !processAlive(pid), "the runner to terminate");
  return { report, events: readEvents(log) };
}

for (const r of C2_RUNNERS) {
  test(`C2-M01 RED/GREEN [${r.name}] result written, callback null, parent closes the channel unread: exit 1, never a false success`, async (t) => {
    const { c, steps } = r.success(t);
    const { report, events } = await blockedParent(t, c, steps, "close");
    assert.equal(report.received.includes("result"), false, "precondition: the parent never received the result");
    assert.equal(report.exitedWhileBlocked, false, `the child must not finish on its send callback alone: ${JSON.stringify(events)}`);
    assert.equal(report.signal, null);
    assert.equal(report.code, 1, "an unread result is a failed child");
    assert.ok(events.includes("result-sent#0") && events.includes("exit#1"), JSON.stringify(events));
    assert.equal(events.includes("exit#0"), false);
  });

  test(`C2-M01 RED/GREEN [${r.name}] result written, callback null, parent dies unread: the child never exits 0`, async (t) => {
    const { c, steps } = r.success(t);
    const { report, events } = await blockedParent(t, c, steps, "die");
    assert.equal(report.exitedWhileBlocked, false, JSON.stringify(events));
    assert.equal(events.includes("exit#0"), false, `never a success after parent death: ${JSON.stringify(events)}`);
    // Windows hard-kills the orphan with its parent (job object), so no exit
    // is recorded there; a POSIX orphan must fail itself.
    if (process.platform !== "win32") assert.ok(events.includes("exit#1"), JSON.stringify(events));
  });

  test(`C2-M01 [${r.name}] send callback succeeds before the parent reads the result: the child waits, then the parent reads, ACKs and the child exits 0`, async (t) => {
    const { c, steps } = r.success(t);
    const { report, events } = await blockedParent(t, c, steps, "read");
    assert.equal(report.exitedWhileBlocked, false, `no delivery before the parent read the result: ${JSON.stringify(events)}`);
    assert.equal(report.code, 0);
    assert.equal(report.signal, null);
    assert.equal(report.result.ok, true);
    assert.equal(report.result.receipt, undefined);
    assert.ok(events.includes("exit#0"), JSON.stringify(events));
  });
}

test("C2 [triageCase] unsolicited ACKs before the result never authorize a later delivery", async (t) => {
  const c = triageCase(t);
  const h = startChild(t, c, [{ status: 429 }, { content: c.validContent }], {}, { autoAck: false });
  h.sendPayload();
  await h.probe("fetch", 0);
  // In the retry backoff: running, nothing reported yet.
  h.child.send({ type: "result-ack", receipt: "0".repeat(32) });
  h.child.send({ type: "result-ack", receipt: "f".repeat(32) });
  h.child.send({ type: "result-ack" });
  const result = await h.message((m) => m && m.type === "result", "the result");
  assert.match(result.receipt, RECEIPT);
  assert.equal(result.ok, true);
  h.child.disconnect();
  const { code, signal } = await h.closed();
  assert.equal(signal, null);
  assert.equal(code, 1, "only the receipt of THIS result could have authorized a delivery");
  assert.equal(fetchCount(h.events()), 2);
});

// --- the child guard, in-process (exit() recorded, not performed; mocked deadline) --

for (const [name, runner] of [
  ["stage-runner", stageRunner],
  ["generative-runner", generativeRunner],
]) {
  const RESULT = Object.freeze({ type: "result", ok: true });
  const receiptOf = (proc) => proc.sent[0].message.receipt;
  const settledListeners = (proc) => assert.equal(proc.listenerCount("message"), 0, "the ACK listener is removed on every terminal path");

  test(`C2 [${name}] a successful send callback is not a delivery; the parent's ACK is`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    assert.equal(proc.listenerCount("message"), 0, "nothing listens for an ACK before a result is reported");
    assert.equal(link.report(RESULT), true);
    assert.match(receiptOf(proc), RECEIPT);
    assert.equal(proc.listenerCount("message"), 1);
    proc.sent[0].callback(null);
    await tick();
    assert.equal(proc.selfDisconnects, 0);
    assert.deepEqual(proc.exits, []);
    proc.ack();
    assert.equal(proc.selfDisconnects, 0, "the self-disconnect never runs inside Node's message dispatch");
    assert.equal(proc.connected, true);
    settledListeners(proc);
    await tick();
    assert.equal(proc.selfDisconnects, 1);
    assert.equal(link.signal.aborted, false);
    t.mock.timers.tick(ACK_DEADLINE_MS * 2);
    assert.deepEqual(proc.exits, [], "the deadline is cleared on delivery");
  });

  test(`C2 [${name}] the ACK arriving before the send callback still delivers; the late callback changes nothing`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    runner.guardParentLink(proc).report(RESULT);
    proc.ack();
    await tick();
    assert.equal(proc.selfDisconnects, 1);
    proc.sent[0].callback(new Error("late"));
    await tick();
    assert.deepEqual(proc.exits, []);
    assert.equal(proc.selfDisconnects, 1);
  });

  test(`C2 [${name}] unsolicited ACKs before the result is reported are never seen and authorize nothing`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    for (const receipt of ["0".repeat(32), undefined]) proc.emit("message", { type: "result-ack", receipt });
    assert.equal(proc.selfDisconnects, 0);
    link.report(RESULT);
    proc.sent[0].callback(null);
    proc.emit("message", { type: "result-ack", receipt: "0".repeat(32) });
    assert.equal(proc.selfDisconnects, 0);
    t.mock.timers.tick(ACK_DEADLINE_MS);
    assert.deepEqual(proc.exits, [1]);
    const other = ipcProcess();
    runner.guardParentLink(other).report(RESULT);
    assert.notEqual(receiptOf(other), receiptOf(proc), "every result carries its own receipt");
  });

  test(`C2 [${name}] malformed and unrelated ACKs are ignored; the deadline then fails closed, once`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    link.report(RESULT);
    proc.sent[0].callback(null);
    const receipt = receiptOf(proc);
    for (const bad of [
      null,
      undefined,
      "result-ack",
      [receipt],
      {},
      { type: "result-ack" },
      { type: "result-ack", receipt: "0".repeat(32) },
      { type: "result-ack", receipt: receipt.toUpperCase() },
      { type: "result-ack", receipt: [receipt] },
      { type: "result-ack", receipt: { toString: () => receipt } },
      { type: "ack", receipt },
      { type: "result", receipt },
      { type: "sec-c1-probe", event: "fetch", index: 0 },
      { receipt },
    ]) {
      proc.emit("message", bad);
    }
    assert.equal(proc.selfDisconnects, 0);
    assert.deepEqual(proc.exits, []);
    t.mock.timers.tick(ACK_DEADLINE_MS);
    assert.deepEqual(proc.exits, [1]);
    assert.equal(link.signal.aborted, true);
    settledListeners(proc);
  });

  test(`C2 [${name}] duplicate ACK in the same dispatch: one delivery, one self-disconnect`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    runner.guardParentLink(proc).report(RESULT);
    proc.sent[0].callback(null);
    proc.ack();
    proc.ack();
    await tick();
    assert.equal(proc.selfDisconnects, 1);
    assert.deepEqual(proc.exits, []);
  });

  test(`C2 [${name}] the 10s deadline bounds the wait for the ACK: 9999ms nothing, 10000ms one failed exit`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    link.report(RESULT);
    proc.sent[0].callback(null);
    t.mock.timers.tick(ACK_DEADLINE_MS - 1);
    assert.deepEqual(proc.exits, []);
    t.mock.timers.tick(1);
    assert.deepEqual(proc.exits, [1]);
    assert.equal(link.signal.aborted, true);
    settledListeners(proc);
    t.mock.timers.tick(ACK_DEADLINE_MS * 2);
    assert.deepEqual(proc.exits, [1]);
  });

  test(`C2 [${name}] a send that never completes is inside the same 10s bound`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    link.report(RESULT);
    t.mock.timers.tick(ACK_DEADLINE_MS);
    assert.deepEqual(proc.exits, [1]);
    assert.equal(link.signal.aborted, true);
  });

  test(`C2 [${name}] a late ACK after the deadline changes nothing`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    runner.guardParentLink(proc).report(RESULT);
    proc.sent[0].callback(null);
    t.mock.timers.tick(ACK_DEADLINE_MS);
    proc.ack();
    await tick();
    assert.deepEqual(proc.exits, [1]);
    assert.equal(proc.selfDisconnects, 0);
  });

  test(`C2 [${name}] parent loss while awaiting the ACK: one failed exit, no provider call, a later ACK and the deadline change nothing`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const proc = ipcProcess();
    const link = runner.guardParentLink(proc);
    let transportCalls = 0;
    const provider = new GroqProvider({
      apiKey: SECRET,
      model: "m",
      fetchImpl: async () => {
        transportCalls += 1;
        return okContent("x");
      },
      cancelSignal: link.signal,
    });
    link.report(RESULT);
    proc.sent[0].callback(null);
    proc.parentLost();
    await tick();
    assert.deepEqual(proc.exits, [1]);
    assert.equal(link.signal.aborted, true);
    settledListeners(proc);
    proc.ack();
    t.mock.timers.tick(ACK_DEADLINE_MS * 2);
    assert.deepEqual(proc.exits, [1]);
    assert.equal(proc.selfDisconnects, 0);
    await assert.rejects(provider.analyze({ systemPrompt: "s", userPrompt: "u" }));
    assert.equal(transportCalls, 0);
  });

  test(`C2 [${name}] a send that throws or a send-callback error: one failed exit, deadline and listener cleared`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const throwing = ipcProcess();
    throwing.send = () => {
      throw new TypeError("could not serialize");
    };
    assert.equal(runner.guardParentLink(throwing).report(RESULT), false);
    const failing = ipcProcess();
    runner.guardParentLink(failing).report(RESULT);
    failing.sent[0].callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    await tick();
    for (const proc of [throwing, failing]) {
      assert.deepEqual(proc.exits, [1]);
      settledListeners(proc);
    }
    t.mock.timers.tick(ACK_DEADLINE_MS * 2);
    assert.deepEqual(throwing.exits, [1]);
    assert.deepEqual(failing.exits, [1]);
  });
}

// --- the parent launcher, over a scripted child (supplementary) --------------------

function scriptedChild({ onAck } = {}) {
  const { PassThrough } = require("node:stream");
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.sent = [];
  child.send = (message, callback) => {
    child.sent.push(message);
    if (message && message.type === "result-ack" && onAck) return onAck(child, callback);
    return true;
  };
  child.finish = (code) => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code, null);
  };
  return child;
}

function launchScripted(options) {
  const child = scriptedChild(options);
  const outcome = runStageProcess({ stage: "plan", payload: {}, env: {}, cwd: process.cwd(), runner: "generative", spawnImpl: () => child });
  return { child, outcome };
}

const acksOf = (child) => child.sent.filter((m) => m && m.type === "result-ack");

test("C2 [stage-process] only the expected result is ACKed, exactly once; probes, diagnostics and later results never are", async () => {
  const { child, outcome } = launchScripted();
  const first = "a".repeat(32);
  for (const m of [{ type: "sec-c1-probe", event: "fetch", index: 0 }, { type: "result-ack", receipt: first }, { type: "diagnostic", receipt: first }, { type: "payload", receipt: first }, "result", null, [first], { receipt: first }]) {
    child.emit("message", m);
  }
  assert.deepEqual(acksOf(child), []);
  child.emit("message", { type: "result", ok: true, receipt: first });
  child.emit("message", { type: "result", ok: false, receipt: "b".repeat(32) });
  child.emit("message", { type: "result", ok: true, receipt: first });
  assert.deepEqual(acksOf(child), [{ type: "result-ack", receipt: first }]);
  child.finish(0);
  const o = await outcome;
  assert.deepEqual(Object.keys(o), RETURN_KEYS);
  assert.deepEqual(o.result, { type: "result", ok: true }, "the first result, stored without its receipt");
});

test("C2 [stage-process] the result is stored before its ACK is sent", async () => {
  const { child, outcome } = launchScripted({
    onAck: (c) => {
      c.finish(0);
      return true;
    },
  });
  child.emit("message", { type: "result", ok: true, receipt: "c".repeat(32) });
  const o = await withTimeout(outcome, 1000, "the ACK that ends the scripted child");
  assert.deepEqual(o.result, { type: "result", ok: true });
  assert.equal(o.exitCode, 0);
});

for (const receipt of [undefined, "", "x", "0".repeat(31), "0".repeat(33), "G".repeat(32), "A".repeat(32), 123, { toString: () => "0".repeat(32) }, ["0".repeat(32)]]) {
  test(`C2 [stage-process] a result with an invalid receipt (${JSON.stringify(receipt)}) is stored but never ACKed`, async () => {
    const { child, outcome } = launchScripted();
    child.emit("message", { type: "result", ok: true, receipt });
    assert.deepEqual(acksOf(child), []);
    child.finish(1);
    const o = await outcome;
    assert.deepEqual(o.result, { type: "result", ok: true });
    assert.equal(o.exitCode, 1);
  });
}

for (const [label, onAck] of [
  [
    "throws",
    () => {
      throw new Error("channel closed");
    },
  ],
  [
    "reports an async error",
    (c, callback) => {
      const err = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      // Node: with a callback the error goes to it; without one it is emitted as 'error'.
      if (typeof callback === "function") process.nextTick(callback, err);
      else process.nextTick(() => c.emit("error", err));
      return false;
    },
  ],
]) {
  test(`C2 [stage-process] an ACK send that ${label} is never a spawn error or a success; the child's exit decides`, async () => {
    const { child, outcome } = launchScripted({ onAck });
    child.emit("message", { type: "result", ok: true, receipt: "d".repeat(32) });
    await tick();
    child.finish(1);
    const o = await outcome;
    assert.equal(o.spawnError, false);
    assert.equal(o.exitCode, 1);
    assert.deepEqual(o.result, { type: "result", ok: true });
  });
}
