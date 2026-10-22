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
 */

const { test } = require("node:test");
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

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Spawns the real runner exactly as stage-process.js does (execPath, argv
// [runner, stage], shell:false, stdio with ipc) plus the test-only transport
// preload. Never sends the payload by itself.
function startChild(t, testCase, steps) {
  const log = path.join(testCase.dir, "transport.log");
  const scriptFile = path.join(testCase.dir, "transport.json");
  fs.writeFileSync(scriptFile, JSON.stringify({ log, steps }));
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
      const match = (m) => m && m.type === "sec-c1-probe" && m.event === event && m.index === index;
      const seen = messages.find(match);
      if (seen) return Promise.resolve(seen);
      const p = new Promise((resolve) => waiters.push({ match, resolve }));
      return withTimeout(p, PROBE_TIMEOUT_MS, `transport probe ${event}#${index}`);
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
      assert.equal(link.complete(), false, "a cancelled child can never report a result");
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
    assert.equal(link.complete(), false);
    assert.equal(link.complete(), false);
  });

  test(`T12 [${name}] the child's own disconnect after a completed result is not a cancellation`, () => {
    const proc = fakeProcess();
    const link = runner.guardParentLink(proc);
    assert.equal(link.complete(), true, "the first completion may report");
    assert.equal(link.complete(), false, "a result is reported at most once");
    proc.emit("disconnect");
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
