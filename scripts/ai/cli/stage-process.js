/**
 * Isolated child-process launcher for triage stages (ARCH-PROD-C1-m02,
 * contract §10.4.5 architecture B).
 *
 * Every provider-consuming or env-reading triage stage runs in its own child:
 *
 *   executable   process.execPath (the running Node binary - never a
 *                PATH-resolved `node`, never `npm run`)
 *   entrypoint   STAGE_RUNNER_PATH, resolved package-relatively from this
 *                module (never from PATH, cwd, config or env)
 *   argv         [STAGE_RUNNER_PATH, <stage>] - an array, shell: false
 *   env          the closed per-stage object from child-env.js
 *   input        the validated config snapshot values, sent over the IPC
 *                channel (the child never re-reads qa-agent.config.json)
 *
 * The child's stdout/stderr are captured with a hard bound and forwarded to
 * the CLI's stderr as diagnostics (stdout is reserved for the CLI result),
 * with every known secret value redacted.
 */

"use strict";

const childProcess = require("child_process");

const STAGE_RUNNER_PATH = require.resolve("./stage-runner.js");
const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_FORWARD_BYTES = 64 * 1024;
const MIN_REDACTION_LENGTH = 4;

function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= MIN_REDACTION_LENGTH) out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

function capture(stream) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  stream.on("data", (chunk) => {
    if (size >= MAX_CAPTURE_BYTES) {
      truncated = true;
      return;
    }
    const room = MAX_CAPTURE_BYTES - size;
    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (chunk.length > room) truncated = true;
    chunks.push(piece);
    size += piece.length;
  });
  return () => ({ text: Buffer.concat(chunks).toString("utf8"), truncated });
}

/**
 * @returns {Promise<{ spawnError: boolean, exitCode: number|null, signal: string|null,
 *   result: object|null, stdout: string, stderr: string }>}
 */
function runStageProcess({ stage, payload, env, cwd, secrets = [], spawnImpl = childProcess.spawn, diagnostics }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(process.execPath, [STAGE_RUNNER_PATH, stage], {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
    } catch {
      resolve({ spawnError: true, exitCode: null, signal: null, result: null, stdout: "", stderr: "" });
      return;
    }

    const readStdout = capture(child.stdout);
    const readStderr = capture(child.stderr);
    let result = null;
    let settled = false;

    child.on("message", (message) => {
      if (message && typeof message === "object" && message.type === "result" && result === null) result = message;
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      resolve({ spawnError: true, exitCode: null, signal: null, result: null, stdout: "", stderr: "" });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      const out = readStdout();
      const err = readStderr();
      const stdout = redact(out.text, secrets);
      const stderr = redact(err.text, secrets);
      if (diagnostics) {
        const forwarded = `${stdout}${stderr}`;
        const bounded = forwarded.length > MAX_FORWARD_BYTES ? `${forwarded.slice(0, MAX_FORWARD_BYTES)}\n[qa-agent] stage diagnostics truncated\n` : forwarded;
        if (bounded.length > 0) diagnostics(bounded.endsWith("\n") ? bounded : `${bounded}\n`);
        if (out.truncated || err.truncated) diagnostics("[qa-agent] stage output exceeded the capture bound and was truncated\n");
      }
      resolve({ spawnError: false, exitCode, signal, result, stdout, stderr });
    });

    try {
      child.send({ type: "payload", stage, payload });
    } catch {
      // The child exits without a result; reported as a stage failure.
    }
  });
}

module.exports = { STAGE_RUNNER_PATH, MAX_CAPTURE_BYTES, MAX_FORWARD_BYTES, redact, runStageProcess };
