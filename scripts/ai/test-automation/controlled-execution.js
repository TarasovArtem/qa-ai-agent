/**
 * Controlled execution of an already #23F-applied GeneratedChangeSet
 * (Roadmap #23G - "Controlled Execution + Bounded Regeneration Loop").
 * #23G is the next pinned roadmap stage after #23F (COMPLETE_ON_MAIN).
 *
 * This is the FIRST module in the QA AI Agent that is allowed to spawn a
 * child process. Every prior #22/#23 stage is deliberately non-executing -
 * see their own docstrings. #23G is the deliberate, narrow trust-boundary
 * transition where that changes.
 *
 * AUTHORITY SEPARATION (read this before wiring this into anything):
 *   - `AppliedChangeSetRecord.status === "APPLIED"` is EVIDENCE that #23F
 *     reached its mutation phase and structurally verified the result at
 *     THAT time - it is NECESSARY but NEVER SUFFICIENT to execute. It does
 *     NOT prove syntax validity, test correctness, runtime safety, or any
 *     execution/Git/provider/commit/push/merge authorization. This module
 *     establishes its own independent execution gate.
 *   - GENERATED CODE IS UNTRUSTED: the files this module may cause a test
 *     runner to load can, in principle, execute arbitrary JavaScript with
 *     the permissions of that runner process. The safety boundary this
 *     module provides is: (a) exactly which reviewed/applied bytes are
 *     eligible, (b) which trusted, repository-owned runner may be invoked,
 *     and (c) under what resource bounds - it is NOT a complete OS sandbox.
 *     Do not describe this as "sandboxed execution" anywhere - it is
 *     controlled, bounded, allowlisted child-process execution.
 *   - EXECUTION-TIME APPLIED-STATE REVALIDATION: files may change between
 *     #23F's own application and this module's later execution attempt.
 *     Before ever spawning a process, every `appliedChangeSetRecord.changes[]`
 *     entry with `status: "APPLIED"` is independently re-inspected against
 *     ACTUAL current filesystem state (never merely trusting #23F's earlier
 *     observation) - same ancestor-symlink/target-type/hardlink/digest
 *     discipline #23F itself established (Roadmap #23F-C1), reusing its
 *     own exported, already-reviewed primitives rather than a second,
 *     weaker reimplementation.
 *   - EXECUTION FRAMEWORK IS A CLOSED VOCABULARY: the framework and the
 *     exact command invoked are derived ONLY from an already-validated
 *     AutomationPlan (via a fixed, repository-owned {framework -> npm
 *     script} mapping) - never from a caller-supplied free-form framework
 *     name, never from `AutomationPlan.validationPlan`'s own descriptive
 *     text (which is human-readable prose, never a shell command), and
 *     never from any GeneratedChangeSet/provider/execution-failure content.
 *   - NO SHELL: every child process is spawned with `shell: false` and a
 *     fixed executable + argument array - no caller/provider-controlled
 *     text is ever concatenated into command syntax.
 *   - BOUNDED, NOT UNBOUNDED: every execution has a hard timeout and hard
 *     stdout/stderr byte bounds - the process is terminated and the result
 *     reported as TIMED_OUT/truncated rather than allowed to run or
 *     accumulate output indefinitely.
 *   - RESIDUAL TOCTOU: exactly like #23F's own honest limitation (Roadmap
 *     #23F-C1 Section 9), ordinary Node.js path-based filesystem APIs
 *     cannot make "revalidate these bytes" and "the test runner opens this
 *     same file" a single atomic kernel operation. This module narrows that
 *     window (revalidate immediately before spawning) but does not and
 *     cannot claim to eliminate it. v1's operational assumption is the same
 *     as #23F's: `repositoryRoot` is not concurrently topology-mutated by
 *     an untrusted local actor during one execution attempt.
 *
 * OUT OF SCOPE FOR #23G v1 EXECUTION (deliberately, not an oversight):
 *   - No provider/AI call of any kind (see regenerate-change-set.js for the
 *     separate, provider-backed regeneration path - never this module).
 *   - No Git read or write of any kind, no GitHub call of any kind.
 *   - No standalone execution of generated source (no `require`/`import`/
 *     `eval`/`new Function`/`vm.runIn...` of a generated path) - only a
 *     fixed, repository-owned test-framework command may ever run, exactly
 *     as an ordinary `npm run <script>` invocation already would.
 *   - No arbitrary command execution of any kind - the command is selected
 *     from a closed, hardcoded map, never caller-supplied text.
 *   - No repository source write authority (child test frameworks may
 *     write their own runtime artifacts - screenshots/videos/reports -
 *     according to their own EXISTING, unmodified configuration; this
 *     module itself writes nothing to repository source).
 */

"use strict";

const childProcess = require("node:child_process");

const { ERROR_CODES, err } = require("../generation/errors");
const { isValidId } = require("../generation/primitives");
const { validateAutomationPlan } = require("../generation/automation-plan");
const {
  computeDigest: computeChangeSetDigest,
  LABEL_PLAN_BINDING,
  recomputeChangeSetDigest,
} = require("./generated-change-set");
const {
  resolveRepositoryRoot,
  inspectApplicationTarget,
  inspectModifyTarget,
} = require("./change-set-application");
const {
  recomputeAppliedChangeSetRecordDigest,
} = require("./applied-change-set-record");
const {
  SUPPORTED_FRAMEWORKS,
  isValidTimestamp,
  snapshotOwnData,
  deepFreeze,
  buildAutomationExecutionRecord,
} = require("./automation-execution-record");

// Roadmap #23G Section 12/20/43: the ONLY execution authority this module
// grants - a fixed, repository-owned {framework -> npm script} mapping,
// verified directly against this repository's own real package.json
// scripts (never invented, never speculative). Adding a framework/command
// here is itself a reviewed source change, never a runtime decision.
const FRAMEWORK_COMMANDS = Object.freeze({
  cypress: Object.freeze({ npmScript: "chrome" }),
  playwright: Object.freeze({ npmScript: "test:e2e:playwright" }),
});

// Roadmap #23G Section 24/26: hard, non-caller-expandable bounds. A caller
// MAY supply a smaller timeout (never a larger one) - see
// resolveExecutionTimeout() below.
const MAX_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_EXECUTION_TIMEOUT_MS = MAX_EXECUTION_TIMEOUT_MS;
const MAX_STDOUT_BYTES = 200000;
const MAX_STDERR_BYTES = 200000;

function nowIso() {
  return new Date().toISOString();
}

// Roadmap #23G Section 13: `shell:false` always; on Windows, `npm` is a
// `.cmd` shim that Node's non-shell spawn cannot resolve via PATHEXT the
// way a real shell would - this is a fixed, platform-derived (never
// caller-derived) executable name selection, not a caller/provider choice.
function resolveNpmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

// Roadmap #23G Section 12/20: the SOLE command-selection function - takes
// only an already-validated framework enum value, returns a fixed
// executable + argument array. Never accepts or interpolates any
// caller/provider-supplied string into the returned command.
function selectExecutionCommand(framework) {
  const mapping = FRAMEWORK_COMMANDS[framework];
  if (!mapping) return { ok: false };
  return {
    ok: true,
    executable: resolveNpmExecutable(),
    args: ["run", mapping.npmScript],
    // Bounded, human-readable evidence string only - never re-parsed or
    // re-executed from this text; the actual argv array above is what
    // spawn() receives.
    commandLabel: `npm run ${mapping.npmScript}`,
  };
}

// Roadmap #23G Section 24: a caller MAY request a smaller timeout than the
// hard maximum (useful for tests / narrow validation runs) but can never
// expand beyond it. An invalid value fails closed to the safe maximum
// default, never to `Infinity` or an unbounded wait.
function resolveExecutionTimeout(requestedTimeoutMs) {
  if (requestedTimeoutMs === undefined) return DEFAULT_EXECUTION_TIMEOUT_MS;
  if (typeof requestedTimeoutMs !== "number" || !Number.isInteger(requestedTimeoutMs) || requestedTimeoutMs <= 0) {
    return DEFAULT_EXECUTION_TIMEOUT_MS;
  }
  return Math.min(requestedTimeoutMs, MAX_EXECUTION_TIMEOUT_MS);
}

function boundOutput(buffer, maxBytes) {
  const text = buffer.toString("utf8");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }
  // Byte-bounded, not merely character-bounded (Roadmap #23F precedent
  // applied here too - a naive character slice could still exceed the byte
  // bound for multi-byte UTF-8 content). Buffer.slice on the ORIGINAL bytes
  // guarantees an exact byte bound; a trailing partial multi-byte sequence
  // is tolerated by Node's own lossy UTF-8 decoding (replacement
  // character), which is acceptable for bounded diagnostic evidence.
  const truncatedText = buffer.subarray(0, maxBytes).toString("utf8");
  return { text: truncatedText, truncated: true };
}

/**
 * Roadmap #23G Section 61/72: the narrow, independently-testable process-
 * execution primitive - a fixed executable + argument array, a fixed cwd,
 * `shell: false` always, a hard timeout, and hard stdout/stderr byte
 * bounds. Exported for direct, deterministic unit testing against safe
 * fixture commands (e.g. `process.execPath` running a small inline
 * script) - the real orchestrator below always calls this with the
 * closed-vocabulary command `selectExecutionCommand()` itself produced,
 * never a caller-supplied executable/argv.
 *
 * Returns `{ exitCode, timedOut, stdout: {text,truncated}, stderr:
 * {text,truncated}, spawnError }` - `spawnError` is a bounded boolean, the
 * raw underlying OS error is never included.
 */
function runBoundedProcess(executable, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = childProcess.spawn(executable, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve({ exitCode: null, timedOut: false, stdout: { text: "", truncated: false }, stderr: { text: "", truncated: false }, spawnError: true });
      return;
    }

    let settled = false;
    let timedOut = false;
    let spawnError = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      // Best-effort termination only - Roadmap #23G Section 25: Windows
      // does not expose POSIX signal semantics the same way, and a process
      // spawned via `npm.cmd` may itself have started further child
      // processes this kill call does not guarantee reaping. This is an
      // honest, documented residual limitation, not a claimed guarantee.
      try {
        child.kill();
      } catch {
        // best-effort only
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdoutBytes < MAX_STDOUT_BYTES) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes < MAX_STDERR_BYTES) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });

    function finish(exitCode) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: typeof exitCode === "number" ? exitCode : null,
        timedOut,
        stdout: boundOutput(Buffer.concat(stdoutChunks), MAX_STDOUT_BYTES),
        stderr: boundOutput(Buffer.concat(stderrChunks), MAX_STDERR_BYTES),
        spawnError,
      });
    }

    // Roadmap #23G Section 61/25: a spawn failure (e.g. ENOENT for a
    // missing executable) is NOT necessarily synchronous - Node commonly
    // reports it via an asynchronous 'error' event on the child instead of
    // throwing from spawn() itself. Both paths must be captured as
    // `spawnError: true`, never silently reported as exitCode:null with no
    // classification.
    child.on("error", () => {
      spawnError = true;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

// Roadmap #23G Section 14: the execution-time equivalent of #23F's own
// Phase-7 fresh revalidation - reuses #23F's own exported, already-
// reviewed inspectApplicationTarget()/inspectModifyTarget() primitives
// (never a second, weaker reimplementation) to independently confirm, for
// EVERY applied change, that the ACTUAL current filesystem state still
// matches exactly what #23F itself recorded as `afterDigest` - a full
// ancestor-symlink walk, target regular-file/non-symlink/hardlink check,
// and exact content-digest comparison, immediately before this function's
// caller is permitted to spawn anything.
function revalidateAppliedState(realRoot, changes) {
  for (const change of changes) {
    if (change.status !== "APPLIED") {
      return { ok: false, reason: "INCOMPLETE_APPLICATION" };
    }
    const inspected = inspectApplicationTarget(realRoot, change.path);
    if (!inspected.ok) {
      return { ok: false, reason: `TARGET_UNSAFE:${inspected.reason}` };
    }
    const modifyCheck = inspectModifyTarget(inspected.targetAbs, inspected.targetLstat, change.afterDigest);
    if (!modifyCheck.ok) {
      return { ok: false, reason: `TARGET_DRIFTED:${modifyCheck.reason}` };
    }
  }
  return { ok: true };
}

function isPlainObjectLike(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Executes an already #23F-APPLIED GeneratedChangeSet through a narrowly
 * allowlisted, bounded child-process runner, after independently
 * revalidating every applied byte against ACTUAL current filesystem state.
 *
 * `input` shape: { expectedProjectId, repositoryRoot, automationPlan,
 * generatedChangeSet, appliedChangeSetRecord, timeoutMs, executedAt }.
 *
 * Minimal sufficient input (Roadmap #23G Section 16): `automationPlan` is
 * required only to obtain a validated, digest-bound `framework` (never a
 * caller-supplied free-form value); `generatedChangeSet` is required only
 * to cryptographically bind `automationPlan` to `appliedChangeSetRecord`
 * via the SAME digest chain #23D/#23F themselves already established
 * (`automationPlanDigest`, `changeSetDigest`) - neither
 * `repositoryContext`, `reviewPackage`, nor `reviewRecord` is needed at
 * execution time, since #23G trusts the SAME already-validated evidence
 * chain #23F itself produced, and adds only its own execution-time
 * filesystem revalidation on top.
 *
 * Returns one of:
 *  - `{ ok: false, errors, automationExecutionRecord: null }` - a
 *    precondition was rejected before any process was spawned (writes/
 *    execution = 0).
 *  - `{ ok: true, errors: [], automationExecutionRecord }` - the process
 *    was spawned and completed (or timed out); `automationExecutionRecord`
 *    reports the bounded outcome (`status` may still be `TEST_FAILED`/
 *    `EXECUTION_ERROR`/`TIMED_OUT` - `ok:true` here means only "a bounded
 *    execution attempt was made and evidence was produced", never "tests
 *    passed").
 */
async function executeAppliedChangeSet(input) {
  const { expectedProjectId, repositoryRoot, automationPlan, generatedChangeSet, appliedChangeSetRecord, timeoutMs, executedAt } = isPlainObjectLike(input) ? input : {};

  if (!isValidId(expectedProjectId)) {
    return { ok: false, errors: [err("$.expectedProjectId", ERROR_CODES.INVALID_TYPE, "$.expectedProjectId must be a bounded string id")], automationExecutionRecord: null };
  }
  if (!isValidTimestamp(executedAt)) {
    return { ok: false, errors: [err("$.executedAt", ERROR_CODES.INVALID_VALUE, "$.executedAt must be a UTC ISO-8601 timestamp")], automationExecutionRecord: null };
  }

  let planSnapshot;
  let changeSetSnapshot;
  let recordSnapshot;
  try {
    planSnapshot = deepFreeze(snapshotOwnData(automationPlan));
    changeSetSnapshot = deepFreeze(snapshotOwnData(generatedChangeSet));
    recordSnapshot = deepFreeze(snapshotOwnData(appliedChangeSetRecord));
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "inputs could not be read")], automationExecutionRecord: null };
  }

  // 1. AutomationPlan must be a valid, project-bound plan - this is the
  // ONLY source of the framework this module will ever execute.
  const planValidation = validateAutomationPlan(planSnapshot, { expectedProjectId });
  if (!planValidation.ok) {
    return { ok: false, errors: [err("$.automationPlan", ERROR_CODES.INVALID_TYPE, "$.automationPlan is not a valid AutomationPlan v1")], automationExecutionRecord: null };
  }

  // 2. GeneratedChangeSet must be self-consistent (its own stored digest
  // matches its own content) and bound to exactly this automationPlan.
  if (!isPlainObjectLike(changeSetSnapshot) || changeSetSnapshot.kind !== "GeneratedChangeSet" || changeSetSnapshot.schemaVersion !== 1) {
    return { ok: false, errors: [err("$.generatedChangeSet", ERROR_CODES.INVALID_TYPE, "$.generatedChangeSet must be a valid GeneratedChangeSet v1")], automationExecutionRecord: null };
  }
  const freshChangeSetDigest = recomputeChangeSetDigest(changeSetSnapshot);
  if (freshChangeSetDigest === null || freshChangeSetDigest !== changeSetSnapshot.changeSetDigest) {
    return { ok: false, errors: [err("$.generatedChangeSet.changeSetDigest", ERROR_CODES.INVALID_VALUE, "$.generatedChangeSet content does not match its own stored digest")], automationExecutionRecord: null };
  }
  const freshPlanDigest = computeChangeSetDigest(LABEL_PLAN_BINDING, planSnapshot);
  if (freshPlanDigest !== changeSetSnapshot.automationPlanDigest) {
    return { ok: false, errors: [err("$.generatedChangeSet.automationPlanDigest", ERROR_CODES.INVALID_REFERENCE, "$.generatedChangeSet is not bound to the exact supplied automationPlan")], automationExecutionRecord: null };
  }
  if (changeSetSnapshot.projectId !== expectedProjectId) {
    return { ok: false, errors: [err("$.generatedChangeSet.projectId", ERROR_CODES.PROJECT_MISMATCH, "$.generatedChangeSet.projectId does not match the expected project")], automationExecutionRecord: null };
  }

  // 3. AppliedChangeSetRecord must be self-consistent and bound to exactly
  // this generatedChangeSet, with a clean, fully-successful APPLIED status.
  const freshRecordDigest = recomputeAppliedChangeSetRecordDigest(recordSnapshot);
  if (freshRecordDigest === null || freshRecordDigest !== recordSnapshot.recordDigest) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.recordDigest", ERROR_CODES.INVALID_VALUE, "$.appliedChangeSetRecord content does not match its own stored digest")], automationExecutionRecord: null };
  }
  if (recordSnapshot.changeSetDigest !== changeSetSnapshot.changeSetDigest) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.changeSetDigest", ERROR_CODES.INVALID_REFERENCE, "$.appliedChangeSetRecord is not bound to the exact supplied generatedChangeSet")], automationExecutionRecord: null };
  }
  if (recordSnapshot.projectId !== expectedProjectId) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.projectId", ERROR_CODES.PROJECT_MISMATCH, "$.appliedChangeSetRecord.projectId does not match the expected project")], automationExecutionRecord: null };
  }
  // Roadmap #23G Section 17: ONLY a fully successful application may
  // proceed - APPLICATION_FAILED_ROLLED_BACK and
  // APPLICATION_FAILED_ROLLBACK_INCOMPLETE are both rejected here, with no
  // special-casing between them (both mean "the reviewed content is not
  // reliably present").
  if (recordSnapshot.status !== "APPLIED") {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.status", ERROR_CODES.INVALID_VALUE, "$.appliedChangeSetRecord.status must be APPLIED")], automationExecutionRecord: null };
  }
  if (!Array.isArray(recordSnapshot.changes) || recordSnapshot.changes.length === 0) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.changes", ERROR_CODES.MISSING_FIELD, "$.appliedChangeSetRecord.changes must be a non-empty array")], automationExecutionRecord: null };
  }

  // 4. repositoryRoot resolution - first real filesystem access.
  const rootResult = resolveRepositoryRoot(repositoryRoot);
  if (!rootResult.ok) {
    return { ok: false, errors: [err("$.repositoryRoot", ERROR_CODES.INVALID_VALUE, "$.repositoryRoot must be an absolute, existing, resolvable directory")], automationExecutionRecord: null };
  }

  // 5. EXECUTION_TIME_APPLIED_STATE_REVALIDATION - never trust #23F's own
  // historical observation; re-inspect ACTUAL current bytes fresh.
  const revalidation = revalidateAppliedState(rootResult.realRoot, recordSnapshot.changes);
  if (!revalidation.ok) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.changes", ERROR_CODES.INVARIANT_VIOLATION, `applied state no longer matches the actual filesystem (${revalidation.reason})`)], automationExecutionRecord: null };
  }

  // 6. Framework/command selection - closed vocabulary only.
  const selected = selectExecutionCommand(planSnapshot.framework);
  if (!selected.ok) {
    return { ok: false, errors: [err("$.automationPlan.framework", ERROR_CODES.INVALID_ENUM, `no execution command is mapped for framework "${planSnapshot.framework}"`)], automationExecutionRecord: null };
  }

  // 7. Bounded child-process execution.
  const startedAt = executedAt;
  const effectiveTimeoutMs = resolveExecutionTimeout(timeoutMs);
  const result = await runBoundedProcess(selected.executable, selected.args, { cwd: rootResult.realRoot, timeoutMs: effectiveTimeoutMs });
  const completedAt = nowIso();

  let status;
  if (result.spawnError) {
    status = "EXECUTION_ERROR";
  } else if (result.timedOut) {
    status = "TIMED_OUT";
  } else if (result.exitCode === 0) {
    status = "PASSED";
  } else {
    status = "TEST_FAILED";
  }

  const built = buildAutomationExecutionRecord({
    projectId: expectedProjectId,
    appliedChangeSetRecordDigest: recordSnapshot.recordDigest,
    framework: planSnapshot.framework,
    command: selected.commandLabel,
    status,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    startedAt,
    completedAt,
  });

  if (!built.ok) {
    return { ok: false, errors: built.errors, automationExecutionRecord: null };
  }

  return { ok: true, errors: [], automationExecutionRecord: built.automationExecutionRecord };
}

module.exports = {
  SUPPORTED_FRAMEWORKS,
  FRAMEWORK_COMMANDS,
  MAX_EXECUTION_TIMEOUT_MS,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  MAX_STDOUT_BYTES,
  MAX_STDERR_BYTES,
  resolveNpmExecutable,
  selectExecutionCommand,
  resolveExecutionTimeout,
  runBoundedProcess,
  revalidateAppliedState,
  executeAppliedChangeSet,
};
