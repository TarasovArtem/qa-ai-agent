/**
 * GOV-AUTO-1 Wave 0 -- safe external-process primitive (design section 24).
 *
 * Argument-array execution only: `shell` is always false and there is no option
 * to enable it, so untrusted text can never become shell syntax. The executable
 * must be an exact member of the caller's allowlist. Output, runtime and the
 * child's environment are bounded, and the safety policy is taken solely from the
 * request object, never from environment variables. Child failures are returned
 * as data (never thrown) with a stable reason code; only a malformed request
 * throws. This module runs no Git or governance command by itself: later waves
 * consume it.
 */

"use strict";

const { spawn } = require("node:child_process");
const nodePath = require("node:path");
const { REASON, GovernanceSafetyError, deepFreeze } = require("./../kernel/contracts");
const { isPlainObject } = require("./../kernel/validation");
const { redactString } = require("./redaction");

const REQUEST_KEYS = ["file", "args", "cwd", "timeoutMs", "maxStdoutBytes", "maxStderrBytes", "allowedExecutables", "envAllowlist"];
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 600000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_MAX_BYTES = 16 * 1024 * 1024;
const MAX_ARGS = 256;
const MAX_ARG_LENGTH = 8192;
const DEFAULT_ENV_ALLOWLIST = Object.freeze(["PATH", "SystemRoot", "TMPDIR", "TEMP", "TMP"]);

function invalid(detail) {
  return new GovernanceSafetyError(REASON.PROCESS_INVALID_REQUEST, detail);
}

function boundedInt(value, fallback, max, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) throw invalid(`${name} must be an integer in [1, ${max}]`);
  return value;
}

function validateRequest(request) {
  if (!isPlainObject(request)) throw invalid("request must be an object");
  for (const key of Object.keys(request)) if (!REQUEST_KEYS.includes(key)) throw invalid(`unknown request field ${key}`);
  if (typeof request.file !== "string" || request.file.length === 0 || request.file.includes("\0")) throw invalid("file must be a non-empty string");
  if (
    !Array.isArray(request.allowedExecutables) || request.allowedExecutables.length === 0 ||
    !request.allowedExecutables.every((e) => typeof e === "string" && e.length > 0)
  ) {
    throw invalid("allowedExecutables must be a non-empty array of strings");
  }
  if (!request.allowedExecutables.includes(request.file)) throw invalid("executable is not in the allowlist");
  const args = request.args === undefined ? [] : request.args;
  if (!Array.isArray(args) || args.length > MAX_ARGS || !args.every((a) => typeof a === "string" && a.length <= MAX_ARG_LENGTH && !a.includes("\0"))) {
    throw invalid("args must be a bounded array of strings without NUL");
  }
  if (request.cwd !== undefined && (typeof request.cwd !== "string" || !nodePath.isAbsolute(request.cwd) || request.cwd.includes("\0"))) {
    throw invalid("cwd must be an absolute path");
  }
  const envAllowlist = request.envAllowlist === undefined ? DEFAULT_ENV_ALLOWLIST : request.envAllowlist;
  if (!Array.isArray(envAllowlist) || !envAllowlist.every((n) => typeof n === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) {
    throw invalid("envAllowlist must be an array of variable names");
  }
  return {
    file: request.file,
    args: [...args],
    cwd: request.cwd,
    timeoutMs: boundedInt(request.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, "timeoutMs"),
    maxStdoutBytes: boundedInt(request.maxStdoutBytes, DEFAULT_MAX_BYTES, MAX_MAX_BYTES, "maxStdoutBytes"),
    maxStderrBytes: boundedInt(request.maxStderrBytes, DEFAULT_MAX_BYTES, MAX_MAX_BYTES, "maxStderrBytes"),
    envAllowlist,
  };
}

function buildEnv(allowlist) {
  const env = { LC_ALL: "C" };
  for (const name of allowlist) if (typeof process.env[name] === "string") env[name] = process.env[name];
  return env;
}

/**
 * Run an allow-listed executable with an argument array. Resolves to a frozen
 * result: { outcome, reasonCode, exitCode, signal, stdout, stderr, stdoutTruncated,
 * stderrTruncated } where outcome is EXITED, TIMEOUT, OUTPUT_LIMIT or SPAWN_ERROR.
 */
function runProcess(request) {
  const req = validateRequest(request);
  return new Promise((resolve) => {
    let settled = false;
    let outcome = null;
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    let child;
    try {
      child = spawn(req.file, req.args, {
        shell: false,
        cwd: req.cwd,
        env: buildEnv(req.envAllowlist),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve(deepFreeze({ outcome: "SPAWN_ERROR", reasonCode: REASON.PROCESS_SPAWN_ERROR, exitCode: null, signal: null, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, errorCode: String(error && error.code) }));
      return;
    }

    const finish = (exitCode, signal, errorCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let reasonCode;
      let finalOutcome = outcome || "EXITED";
      if (finalOutcome === "TIMEOUT") reasonCode = REASON.PROCESS_TIMEOUT;
      else if (finalOutcome === "OUTPUT_LIMIT") reasonCode = REASON.PROCESS_OUTPUT_LIMIT;
      else if (finalOutcome === "SPAWN_ERROR") reasonCode = REASON.PROCESS_SPAWN_ERROR;
      else reasonCode = exitCode === 0 ? REASON.OK : REASON.PROCESS_FAILURE;
      resolve(
        deepFreeze({
          outcome: finalOutcome,
          reasonCode,
          exitCode: exitCode === undefined ? null : exitCode,
          signal: signal || null,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          stdoutTruncated,
          stderrTruncated,
          ...(errorCode ? { errorCode } : {}),
        })
      );
    };

    const kill = (why) => {
      if (outcome === null) outcome = why;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    };

    const timer = setTimeout(() => kill("TIMEOUT"), req.timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdoutBytes + chunk.length > req.maxStdoutBytes) {
        const room = req.maxStdoutBytes - stdoutBytes;
        if (room > 0) stdout.push(chunk.subarray(0, room));
        stdoutBytes = req.maxStdoutBytes;
        stdoutTruncated = true;
        kill("OUTPUT_LIMIT");
        return;
      }
      stdoutBytes += chunk.length;
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes + chunk.length > req.maxStderrBytes) {
        const room = req.maxStderrBytes - stderrBytes;
        if (room > 0) stderr.push(chunk.subarray(0, room));
        stderrBytes = req.maxStderrBytes;
        stderrTruncated = true;
        kill("OUTPUT_LIMIT");
        return;
      }
      stderrBytes += chunk.length;
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      if (outcome === null) outcome = "SPAWN_ERROR";
      finish(null, null, String(error && error.code));
    });
    child.on("close", (exitCode, signal) => finish(exitCode, signal));
  });
}

/** Redacted, bounded human detail for a process result (never raw stderr). */
function describeProcessResult(result) {
  const parts = [`outcome=${result.outcome}`, `reason=${result.reasonCode}`];
  if (result.exitCode !== null) parts.push(`exit=${result.exitCode}`);
  if (result.signal) parts.push(`signal=${result.signal}`);
  if (result.stderr) parts.push(`stderr=${redactString(result.stderr, { maxLength: 200 })}`);
  return parts.join(" ");
}

module.exports = { runProcess, describeProcessResult };
