/**
 * Internal triage stage entrypoint - spawned ONLY by stage-process.js as
 * `process.execPath stage-runner.js <stage>` with a closed environment.
 * Not a supported entrypoint: it is not in `exports` or `bin`.
 *
 * It is a thin adapter onto the existing, certified public triage API
 * (scripts/ai/index.js) - no triage business logic lives here. All XI-01,
 * XI-02, TSB-F04/F06/F07 enforcement stays inside those stage functions.
 * Its inputs are the parent's validated config snapshot values, received
 * over IPC; it never reads qa-agent.config.json. Provider/config modules
 * (which snapshot AI_* at module load) are first loaded here, in a process
 * whose environment already equals the parent's effective decision.
 */

"use strict";

const crypto = require("crypto");
const api = require("../index");
const { bindCancelSignal } = require("../providers/index");

const STAGES = Object.freeze({
  collect: (p) =>
    api.collectContext.runCli({
      profile: p.projectProfile,
      repositoryRoot: p.repositoryRoot,
      adapterOptions: p.frameworkRuntime ? { frameworkRuntimeConfig: p.frameworkRuntime } : undefined,
    }),
  history: (p) =>
    api.collectHistory.main({
      profile: p.projectProfile,
      repositoryRoot: p.repositoryRoot,
      frameworkRuntimeConfig: p.frameworkRuntime || undefined,
    }),
  aggregate: (p) => api.aggregateBrowserContext.main({ repositoryRoot: p.repositoryRoot }),
  analyze: (p) =>
    api.analyzeFailure.main({
      projectProfile: p.projectProfile,
      repositoryRoot: p.repositoryRoot,
      projectKnowledgeConfig: p.knowledge || undefined,
    }),
});

const MAX_RESULT_MESSAGE = 1024;
// SEC-C1: the existing generic stage-failure exit code - no new code.
const PARENT_LOST_EXIT_CODE = 1;
// FT0-C2: the parent's private receipt for a stored result (stage-process.js).
const RESULT_ACK_TYPE = "result-ack";
// FT0-C2: fixed bound on the whole transfer - the send and the wait for the
// parent's ACK. Not configurable.
const RESULT_ACK_DEADLINE_MS = 10000;

/**
 * SEC-C1 (OD-RATE-1 FT0, unconditional): losing the parent's IPC channel
 * before this child's result has been delivered is a terminal failure. In
 * that one turn the signal aborts (an in-flight provider request is aborted
 * at its transport - providers/index.js bindCancelSignal()) and the process
 * exits, so no pending wait, retry, provider call or later stage work can
 * run afterwards. No signal handler is installed: a user signal still
 * terminates the child natively.
 *
 * `report()` claims the single right to send the result and owns its
 * transfer: running -> sending -> awaiting_ack -> delivered, or -> failed
 * from any of them. The send callback is not delivery proof (FT0-C2): Node
 * reports an IPC write as complete once it reaches the pipe, whether or not
 * the parent ever reads it. The result carries a fresh random receipt, and
 * only the parent's ACK echoing that receipt - which it sends after storing
 * the result - delivers it. Parent loss, a send error, or no valid ACK
 * within RESULT_ACK_DEADLINE_MS of the report fails the child; malformed,
 * unrelated or duplicate ACKs are ignored. Only once delivered does the
 * child disconnect itself, and that expected disconnect is ignored. Every
 * outcome is reached at most once, and each one clears the deadline and the
 * ACK listener.
 */
function guardParentLink(proc) {
  const controller = new AbortController();
  let state = "running";
  let receipt = null;
  let deadline = null;
  const settle = (outcome) => {
    state = outcome;
    clearTimeout(deadline);
    proc.removeListener("message", onAck);
  };
  const fail = () => {
    if (state === "failed" || state === "delivered") return;
    settle("failed");
    try {
      controller.abort();
    } finally {
      proc.exit(PARENT_LOST_EXIT_CODE);
    }
  };
  // The receipt alone proves the parent read this result, so an ACK that
  // overtakes the send callback is still a delivery. Messages that reached
  // the child before report() are replayed to this listener by Node; the
  // receipt check is what keeps them from authorizing anything.
  function onAck(message) {
    if (state !== "sending" && state !== "awaiting_ack") return;
    if (!message || typeof message !== "object" || message.type !== RESULT_ACK_TYPE || message.receipt !== receipt) return;
    settle("delivered");
    // Never from inside Node's own message dispatch: on Node 22 a further
    // message from the same read would meet the already-closed channel and
    // crash the child.
    setImmediate(() => {
      if (proc.connected) proc.disconnect();
    });
  }
  proc.on("disconnect", fail);
  return {
    signal: controller.signal,
    report(message) {
      if (state !== "running") return false;
      if (!proc.connected) {
        fail();
        return false;
      }
      state = "sending";
      receipt = crypto.randomBytes(16).toString("hex");
      deadline = setTimeout(fail, RESULT_ACK_DEADLINE_MS);
      proc.on("message", onAck);
      try {
        proc.send({ ...message, receipt }, (err) => {
          if (state !== "sending") return;
          if (err || !proc.connected) {
            fail();
            return;
          }
          state = "awaiting_ack";
        });
      } catch {
        fail();
        return false;
      }
      return true;
    },
  };
}

let parentLink = null;

function finish(result) {
  if (parentLink) parentLink.report({ type: "result", ...result });
}

async function runOnce(message) {
  const stage = process.argv[2];
  if (!message || message.type !== "payload" || message.stage !== stage || !Object.prototype.hasOwnProperty.call(STAGES, stage)) {
    process.exitCode = 1;
    finish({ ok: false, message: "STAGE_PAYLOAD_INVALID: the stage payload did not match the requested stage." });
    return;
  }
  try {
    await STAGES[stage](message.payload || {});
    // analyze-failure/collect-history report some failures through
    // process.exitCode rather than a rejection.
    if (process.exitCode && process.exitCode !== 0) {
      finish({ ok: false, message: null });
      return;
    }
    finish({ ok: true });
  } catch (err) {
    process.exitCode = 1;
    const text = String((err && err.message) || "stage failed");
    finish({ ok: false, message: text.length > MAX_RESULT_MESSAGE ? `${text.slice(0, MAX_RESULT_MESSAGE)}...` : text });
  }
}

if (require.main === module) {
  if (typeof process.send !== "function") {
    process.stderr.write("stage-runner.js is an internal qa-agent entrypoint and must be started by the qa-agent CLI.\n");
    process.exitCode = 1;
  } else {
    parentLink = guardParentLink(process);
    bindCancelSignal(parentLink.signal);
    process.once("message", (message) => {
      runOnce(message);
    });
  }
}

module.exports = { STAGES, guardParentLink };
