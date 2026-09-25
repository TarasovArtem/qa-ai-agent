/**
 * GOV-AUTO-1 Wave 0 -- safe external-process primitive (design section 24).
 *
 * Trust model. Authority is split between a TRUSTED POLICY and a per-call REQUEST:
 *   - the policy ({ repositoryRoot, allowedExecutables }) is fixed once by trusted
 *     framework code through createProcessRunner(); a request cannot supply,
 *     extend or override it, so a caller cannot authorize its own executable;
 *   - allowedExecutables are absolute paths compared by canonical (realpath)
 *     identity, and the process that is executed is the resolved canonical path,
 *     never a name looked up on PATH. A bare name, a relative path, or the same
 *     basename at a different location is rejected. Neither PATH nor the cwd can
 *     change which binary runs;
 *   - cwd is a repository-relative path resolved through the repositoryRoot safety
 *     primitive (no traversal, no symlink escape) and must be an existing
 *     directory; when omitted the child runs in repositoryRoot itself.
 * Residual limit: the executable and cwd are validated immediately before spawn,
 * not held open; a writer able to replace an allowlisted binary between validation
 * and exec is outside this primitive's threat model (allowlisted paths must be
 * trusted, non-writable locations).
 *
 * Argument-array execution only: `shell` is always false and there is no option
 * to enable it, so untrusted text can never become shell syntax. Output, runtime
 * and the child's environment are bounded, and the safety policy is taken solely
 * from the policy and request objects, never from environment variables. Child
 * failures are returned as data (never thrown) with a stable reason code; only a
 * malformed policy or request throws, with fixed messages that never echo caller
 * text. This module runs no Git or governance command by itself: later waves
 * consume it.
 */

"use strict";

const { spawn } = require("node:child_process");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { REASON, GovernanceSafetyError, deepFreeze } = require("./../kernel/contracts");
const { isPlainObject } = require("./../kernel/validation");
const { redactString } = require("./redaction");
const { resolveWithinRoot } = require("./path");

const POLICY_KEYS = ["repositoryRoot", "allowedExecutables"];
const REQUEST_KEYS = ["file", "args", "cwd", "timeoutMs", "maxStdoutBytes", "maxStderrBytes", "envAllowlist"];
const MAX_PATH_LENGTH = 4096;
const MAX_ALLOWED_EXECUTABLES = 64;
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

const isAbsolutePath = (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_PATH_LENGTH && !v.includes("\0") && nodePath.isAbsolute(v);
const identityKey = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

function canonicalPath(fs, p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/** Validate the trusted policy once. Messages are fixed; no caller text is echoed. */
function validatePolicy(policy, fs) {
  if (!isPlainObject(policy)) throw invalid("policy must be an object");
  for (const key of Object.keys(policy)) if (!POLICY_KEYS.includes(key)) throw invalid("policy contains an unknown field");
  if (!isAbsolutePath(policy.repositoryRoot)) throw invalid("policy.repositoryRoot must be an absolute path");
  if (canonicalPath(fs, policy.repositoryRoot) === null) throw invalid("policy.repositoryRoot cannot be resolved");
  const list = policy.allowedExecutables;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_ALLOWED_EXECUTABLES || !list.every(isAbsolutePath)) {
    throw invalid("policy.allowedExecutables must be a bounded non-empty array of absolute paths");
  }
  return Object.freeze({ repositoryRoot: policy.repositoryRoot, allowedExecutables: Object.freeze([...list]) });
}

/**
 * Pin the executable identity: the requested absolute path must have the same
 * canonical identity as an allowlisted absolute path. Returns the canonical path
 * to execute, or { missing: true } when it is allowlisted but does not exist.
 */
function pinExecutable(policy, file, fs) {
  if (!isAbsolutePath(file)) throw invalid("file must be an absolute executable path");
  const canonical = canonicalPath(fs, file);
  if (canonical === null) {
    const wanted = identityKey(nodePath.resolve(file));
    if (!policy.allowedExecutables.some((e) => identityKey(nodePath.resolve(e)) === wanted)) throw invalid("executable is not in the allowlist");
    return { missing: true };
  }
  const allowed = new Set();
  for (const entry of policy.allowedExecutables) {
    const resolved = canonicalPath(fs, entry);
    if (resolved !== null) allowed.add(identityKey(resolved));
  }
  if (!allowed.has(identityKey(canonical))) throw invalid("executable is not in the allowlist");
  let stat;
  try {
    stat = fs.statSync(canonical);
  } catch {
    throw invalid("executable cannot be inspected");
  }
  if (!stat.isFile()) throw invalid("executable must be a regular file");
  return { path: canonical };
}

/** cwd is repository-relative and resolved through the path-safety primitive. */
function resolveCwd(policy, cwd, fs) {
  if (cwd === undefined) return policy.repositoryRoot;
  if (typeof cwd !== "string") throw invalid("cwd must be a repository-relative path");
  const resolved = resolveWithinRoot(policy.repositoryRoot, cwd, { fs }).absolute;
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw invalid("cwd must be an existing directory");
  }
  if (!stat.isDirectory()) throw invalid("cwd must be an existing directory");
  return resolved;
}

function validateRequest(policy, request, fs) {
  if (!isPlainObject(request)) throw invalid("request must be an object");
  for (const key of Object.keys(request)) if (!REQUEST_KEYS.includes(key)) throw invalid("request contains an unknown field");
  const executable = pinExecutable(policy, request.file, fs);
  const args = request.args === undefined ? [] : request.args;
  if (!Array.isArray(args) || args.length > MAX_ARGS || !args.every((a) => typeof a === "string" && a.length <= MAX_ARG_LENGTH && !a.includes("\0"))) {
    throw invalid("args must be a bounded array of strings without NUL");
  }
  const cwd = resolveCwd(policy, request.cwd, fs);
  const envAllowlist = request.envAllowlist === undefined ? DEFAULT_ENV_ALLOWLIST : request.envAllowlist;
  if (!Array.isArray(envAllowlist) || !envAllowlist.every((n) => typeof n === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) {
    throw invalid("envAllowlist must be an array of variable names");
  }
  return {
    executable,
    args: [...args],
    cwd,
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

const spawnErrorResult = (errorCode) =>
  deepFreeze({ outcome: "SPAWN_ERROR", reasonCode: REASON.PROCESS_SPAWN_ERROR, exitCode: null, signal: null, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, errorCode });

/**
 * Create a runner bound to a trusted policy. run(request) executes an allow-listed
 * executable with an argument array and resolves to a frozen result:
 * { outcome, reasonCode, exitCode, signal, stdout, stderr, stdoutTruncated,
 * stderrTruncated } where outcome is EXITED, TIMEOUT, OUTPUT_LIMIT or SPAWN_ERROR.
 */
function createProcessRunner(policyInput, options = {}) {
  const fs = options.fs || nodeFs;
  const policy = validatePolicy(policyInput, fs);
  return Object.freeze({
    run(request) {
      const req = validateRequest(policy, request, fs);
      if (req.executable.missing) return Promise.resolve(spawnErrorResult("ENOENT"));
      return execute(req);
    },
  });
}

function execute(req) {
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
      child = spawn(req.executable.path, req.args, {
        shell: false,
        cwd: req.cwd,
        env: buildEnv(req.envAllowlist),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve(spawnErrorResult(String(error && error.code)));
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

module.exports = { createProcessRunner, describeProcessResult };
