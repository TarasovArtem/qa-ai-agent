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

function finish(result) {
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
    process.once("message", (message) => {
      runOnce(message);
    });
  }
}

module.exports = { STAGES };
