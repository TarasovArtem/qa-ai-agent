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
 *     "steps": [ "hang" | "hang-body" | { "status": <n>, "body"?: "hang" } | { "content": "<model text>" } ],
 *     "resultSend"?: "hold" | "hold-error" | "hold-ok" | "observe",
 *     "recordExit"?: true }
 *
 * fetch call i uses steps[min(i, last)]:
 *   hang       never resolves; rejects with an AbortError when its signal aborts
 *   hang-body  resolves 200 at once; the body never produces a chunk
 *   status     resolves with that HTTP status and an empty JSON body; with
 *              body "hang" the body never finishes instead, and its
 *              cancellation ("body-cancelled") and the request signal's abort
 *              ("request-aborted") are recorded
 *   content    resolves 200 with a Groq- and Gemini-shaped body carrying content
 *
 * resultSend (FT0-C1 M01) holds the runner's result message - it is never
 * written to the channel - and reports "result-held":
 *   hold        its callback never runs
 *   hold-error  once the channel has closed, its callback receives an error
 *   hold-ok     once the channel has closed, its callback receives null, as
 *               Node's own async IPC write completion does whatever the
 *               write's status
 *   observe     (FT0-C2) the result IS written, unchanged, to the real
 *               channel; "result-sent" is recorded just before the write
 *
 * recordExit (FT0-C2) records the child's own exit code as event "exit"
 * with the code as its index, so a test that is not the child's parent can
 * still tell a success exit from a failure.
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

if (script.resultSend && typeof process.send === "function") {
  const send = process.send.bind(process);
  process.send = function heldResultSend(message, ...rest) {
    if (!message || message.type !== "result") return send(message, ...rest);
    if (script.resultSend === "observe") {
      record("result-sent", 0);
      return send(message, ...rest);
    }
    record("result-held", 0);
    const callback = rest.find((a) => typeof a === "function");
    if (callback && script.resultSend !== "hold") {
      process.once("disconnect", () => setImmediate(() => callback(script.resultSend === "hold-error" ? new Error("channel closed") : null)));
    }
    return true;
  };
}

if (script.recordExit) {
  process.on("exit", (code) => fs.appendFileSync(script.log, `${JSON.stringify({ event: "exit", index: code })}\n`));
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

  if (typeof step.status === "number" && step.body === "hang") {
    const body = new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        record("body-cancelled", index);
      },
    });
    onAbort(init.signal, index, "request-aborted");
    return Promise.resolve(new Response(body, { status: step.status }));
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
