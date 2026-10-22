"use strict";

/**
 * TEST-ONLY scripted transport for the SEC-C1 (OD-RATE-1 FT0) parent
 * disconnect tests.
 *
 * Loaded exclusively by tests, as `node --require <this file>
 * stage-runner.js|generative-runner.js <stage>`. Production code never
 * references this file. It replaces only globalThis.fetch inside the child,
 * BEFORE any provider is constructed (GroqProvider/GeminiProvider default
 * their fetchImpl to the global fetch at construction time), so the real
 * runner, guard, provider adapters, bounded body reader and retry loops are
 * the code under test. No socket is ever opened.
 *
 * The script is the JSON file named by SEC_C1_TRANSPORT_SCRIPT:
 *
 *   { "log": "<file: one JSON line per transport event, written synchronously>",
 *     "steps": [ "hang" | "hang-body" | { "status": <n> } | { "content": "<model text>" } ] }
 *
 * fetch call i uses steps[min(i, last)]:
 *   hang       never resolves; rejects with an AbortError when its signal aborts
 *   hang-body  resolves 200 at once; the body never produces a chunk
 *   status     resolves with that HTTP status and an empty JSON body
 *   content    resolves 200 with a Groq- and Gemini-shaped body carrying content
 *
 * Events are appended to the log synchronously (they must survive an
 * immediate process.exit) and, while the IPC channel is still up, reported
 * to the parent as { type: "sec-c1-probe", event, index } so a test can
 * synchronize on an exact transport state instead of sleeping.
 */

const fs = require("node:fs");

const script = JSON.parse(fs.readFileSync(process.env.SEC_C1_TRANSPORT_SCRIPT, "utf8"));
let calls = 0;

function record(event, index) {
  fs.appendFileSync(script.log, `${JSON.stringify({ event, index })}\n`);
  if (typeof process.send === "function" && process.connected) {
    try {
      process.send({ type: "sec-c1-probe", event, index });
    } catch {
      // channel closing - the log line above is the evidence
    }
  }
}

function abortError() {
  return new DOMException("This operation was aborted", "AbortError");
}

function onAbort(signal, index, what, then) {
  if (!signal) return;
  signal.addEventListener(
    "abort",
    () => {
      record(what, index);
      if (then) then();
    },
    { once: true }
  );
}

globalThis.fetch = function fakeFetch(url, init = {}) {
  const index = calls;
  calls += 1;
  const step = script.steps[Math.min(index, script.steps.length - 1)];
  record("fetch", index);

  if (step === "hang") {
    return new Promise((_, reject) => {
      if (init.signal && init.signal.aborted) {
        record("request-aborted", index);
        reject(abortError());
        return;
      }
      onAbort(init.signal, index, "request-aborted", () => reject(abortError()));
    });
  }

  if (step === "hang-body") {
    const body = new ReadableStream({
      pull() {
        record("body-read", index);
        return new Promise(() => {});
      },
      cancel() {
        record("body-cancelled", index);
      },
    });
    onAbort(init.signal, index, "body-aborted");
    return Promise.resolve(new Response(body, { status: 200 }));
  }

  if (typeof step.status === "number") {
    return Promise.resolve(new Response("{}", { status: step.status, headers: { "content-type": "application/json" } }));
  }

  const envelope = {
    choices: [{ message: { content: step.content } }],
    candidates: [{ content: { parts: [{ text: step.content }] } }],
  };
  return Promise.resolve(new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } }));
};
