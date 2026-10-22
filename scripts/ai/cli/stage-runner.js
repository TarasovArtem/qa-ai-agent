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

/**
 * SEC-C1 (OD-RATE-1 FT0, unconditional): losing the parent's IPC channel
 * before this child has started reporting its result is a terminal
 * cancellation. In that one listener turn the signal aborts (an in-flight
 * provider request is aborted at its transport - providers/index.js
 * bindCancelSignal()) and the process exits, so no pending wait, retry,
 * provider call or later stage work can run afterwards. The child's own
 * process.disconnect() after a completed result is the expected disconnect
 * and is ignored. No signal handler is installed: a user signal still
 * terminates the child natively.
 *
 * `complete()` claims the single right to report a result; it is refused
 * once cancelled, so a child never reports both outcomes.
 */
function guardParentLink(proc) {
  const controller = new AbortController();
  let state = "running";
  proc.on("disconnect", () => {
    if (state !== "running") return;
    state = "cancelled";
    try {
      controller.abort();
    } finally {
      proc.exit(PARENT_LOST_EXIT_CODE);
    }
  });
  return {
    signal: controller.signal,
    complete() {
      if (state !== "running") return false;
      state = "completing";
      return true;
    },
  };
}

let parentLink = null;

function finish(result) {
  if (parentLink && !parentLink.complete()) return;
  const send = () => {
    if (process.connected) process.disconnect();
  };
  if (typeof process.send === "function" && process.connected) process.send({ type: "result", ...result }, send);
  else process.exitCode = result.ok ? 0 : 1;
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
