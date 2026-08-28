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
 *   - TWO-LAYER AUTHORITY MODEL (Roadmap #23G-C1, closes 23G-RV-6 - read
 *     this distinction carefully, it is the single most important fact in
 *     this file): the ORCHESTRATOR (this module's own code, up to and
 *     including the `spawn()` call) has NO shell authority, NO Git/GitHub
 *     authority, NO network authority, NO provider authority, and NO
 *     repository-source-write authority. But the CODE THIS MODULE LAUNCHES
 *     - any Node-side test/support/plugin file the selected framework loads
 *     (a Playwright test body always; a Cypress support/plugin file always;
 *     see EXECUTION_TARGET_CLASSIFIERS below for exactly which applied
 *     paths this module will ever pass to the runner as a direct target) -
 *     runs as ordinary Node.js code with the FULL filesystem-read,
 *     filesystem-write, network, and `child_process` (hence, transitively,
 *     shell/git/gh-invocation) authority of the OS process it runs in,
 *     bounded only by whatever environment this module chooses to grant it
 *     (see EXECUTION ENVIRONMENT below). GENERATED CODE IS UNTRUSTED: even
 *     though #23E already required a human to review it, this module does
 *     NOT provide an OS sandbox, and never describes itself as one -
 *     "controlled execution" means (a) exactly which reviewed/applied bytes
 *     are eligible, (b) which trusted, repository-owned runner may be
 *     invoked, (c) under what resource bounds, and (d) under what reduced
 *     environment - it does NOT mean the launched code's own capabilities
 *     are contained.
 *   - EXECUTION-TIME APPLIED-STATE REVALIDATION: files may change between
 *     #23F's own application and this module's later execution attempt.
 *     Before ever spawning a process, every `appliedChangeSetRecord.changes[]`
 *     entry with `status: "APPLIED"` is independently re-inspected against
 *     ACTUAL current filesystem state (never merely trusting #23F's earlier
 *     observation) - same ancestor-symlink/target-type/hardlink/digest
 *     discipline #23F itself established (Roadmap #23F-C1), reusing its
 *     own exported, already-reviewed primitives rather than a second,
 *     weaker reimplementation.
 *   - EXECUTION IS TARGET-SCOPED (Roadmap #23G-C1, closes 23G-RV-2): this
 *     module never runs "the whole suite". The exact set of files passed to
 *     the runner as direct targets is derived ONLY from the already
 *     execution-time-revalidated `appliedChangeSetRecord.changes[]` paths,
 *     filtered through a closed, framework-specific, repository-convention
 *     classifier (EXECUTION_TARGET_CLASSIFIERS) that recognizes only real
 *     executable spec-file paths for that framework - never an unrelated
 *     pre-existing spec, and never a caller-supplied path. A changeset with
 *     zero recognized executable targets (e.g. one that only touches a
 *     support/helper file) is rejected before any spawn - it never silently
 *     falls back to running everything.
 *   - EXECUTION FRAMEWORK IS A CLOSED VOCABULARY: the framework is derived
 *     ONLY from an already-validated AutomationPlan (via a fixed,
 *     repository-owned {framework -> local CLI binary} mapping) - never
 *     from a caller-supplied free-form framework name, never from
 *     `AutomationPlan.validationPlan`'s own descriptive text (which is
 *     human-readable prose, never a shell command), and never from any
 *     GeneratedChangeSet/provider/execution-failure content. The runner
 *     binary itself is resolved directly from this repository's own
 *     `node_modules/.bin/` (never via a package.json script whose own
 *     baked-in arguments could otherwise ambiguously interact with a
 *     caller-appended target flag) - see resolveLocalBinary() below.
 *   - NO SHELL: every child process is spawned with `shell: false` and a
 *     fixed executable + argument array - no caller/provider-controlled
 *     text is ever concatenated into command syntax. This applies to the
 *     ORCHESTRATOR's own spawn call only - see TWO-LAYER AUTHORITY MODEL.
 *   - EXECUTION ENVIRONMENT IS A CLOSED ALLOWLIST (Roadmap #23G-C1, closes
 *     23G-RV-4): the child process is never given this module's own full
 *     `process.env`. Only a small, explicitly justified, OS/runtime-level
 *     allowlist (PATH-like/temp/home/profile/CI variables the runner and
 *     browser genuinely need to start) is copied - see ENV_ALLOWLIST below.
 *     Every application-level secret this repository itself defines
 *     (`AI_API_KEY`, `GITHUB_TOKEN`, etc. - see scripts/ai/config.js and
 *     scripts/ai/collect-history.js) is excluded by construction, because
 *     the allowlist is POSITIVE (only listed names are ever copied), not a
 *     denylist of known secret names. This is defense-in-depth alongside
 *     the provider-side redaction regenerate-change-set.js itself applies -
 *     neither is a complete guarantee against a launched process choosing
 *     to read and exfiltrate one of the few variables it IS given (e.g.
 *     PATH is not secret, but nothing stops generated code from reading
 *     files it can already reach given its own full filesystem authority).
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
 *   - No Git read or write of any kind, no GitHub call of any kind, BY THIS
 *     MODULE'S OWN ORCHESTRATOR CODE - see TWO-LAYER AUTHORITY MODEL above
 *     for what the code it launches may still be able to do on its own.
 *   - No standalone execution of generated source (no `require`/`import`/
 *     `eval`/`new Function`/`vm.runIn...` of a generated path) - only a
 *     fixed, repository-owned test-framework binary may ever be spawned,
 *     targeted only at the exact revalidated applied file(s).
 *   - No arbitrary command execution of any kind - the runner and its base
 *     arguments are selected from a closed, hardcoded map, never
 *     caller-supplied text; only the already-validated target path(s) vary.
 *   - No repository source write authority BY THIS MODULE - child test
 *     frameworks may still write their own runtime artifacts
 *     (screenshots/videos/reports) per their own EXISTING, unmodified
 *     configuration, and (per TWO-LAYER AUTHORITY MODEL) generated Node-side
 *     code loaded by the runner has its own, separate, full filesystem
 *     authority this module does not and cannot constrain beyond the
 *     environment it is launched with.
 *   - No OS sandbox, no process-tree containment beyond best-effort direct-
 *     child termination on timeout, no secret-detection guarantee (the
 *     environment allowlist and provider-side redaction are both
 *     best-effort defense-in-depth, never a claimed complete DLP control).
 */

"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");

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

// Roadmap #23G-C1 Section 12: the closed vocabulary of local runner
// binaries - each resolved directly from this repository's own
// `node_modules/.bin/`, never via PATH and never via a package.json script
// (whose own baked-in `--spec 'cypress/e2e/**'`/similar arguments could
// otherwise ambiguously interact with a caller-appended target flag -
// closes 23G-RV-2 at the command-construction level, not merely at the
// target-selection level). Adding a framework/binary here is itself a
// reviewed source change, never a runtime decision.
const FRAMEWORK_BINARIES = Object.freeze({
  cypress: "cypress",
  playwright: "playwright",
});

// Roadmap #23G-C1 (closes 23G-RV-2): which already execution-time-
// revalidated applied paths are ever passed to the runner as a direct
// target, derived from this repository's OWN real, established test-file
// conventions (verified directly - see cypress.config.js's implicit
// default spec pattern and the repository's actual cypress/e2e/tests/*.cy.js
// files; and playwright.config.js's locked `testDir: "./playwright"`
// contract from Roadmap #21C-C1 plus this repository's actual
// playwright/tests/*.spec.js file) - never a guess, never a caller-supplied
// pattern. A support/plugin/config/fixture file that happens to live under
// the same framework directory intentionally does NOT match either
// classifier below, and is therefore never a direct runner target (it may
// still be naturally imported/loaded by a matching spec file, exactly as
// it would be if a human ran the suite locally).
// Roadmap #23G-C2 (23G-C1-RR-3, DEFERRED/NON-BLOCKING - explicitly, not
// silently): this classifier is deliberately NARROWER than both (a)
// Cypress's own actual default specPattern, which also matches
// .cy.jsx/.cy.ts/.cy.tsx, and (b) what #23C/#23D's generation pipeline is
// technically unconstrained to produce (grepped the entire
// automation-plan-prompt.js/generate-change-set-prompt.js prompt-building
// layer - no naming-convention guidance exists anywhere upstream). This is
// the explicit, documented v1 execution contract, not an oversight: a
// legitimately generated/reviewed/applied CREATE or MODIFY whose path does
// not end in exactly ".cy.js" (Cypress) or ".spec.js" (Playwright) will be
// rejected at THIS stage with NO_EXECUTABLE_TEST_TARGET - safely (no
// execution occurs) but with reduced coverage relative to the underlying
// framework's own broader capability. Broadening this classifier, or
// constraining #23C's own plan-generation stage to only ever produce
// classifier-recognized names, is intentionally left for a future pass -
// see FUTURE_TARGET_CLASSIFIER_COVERAGE_GUARD. Do not broaden this map
// without re-verifying framework target-selection semantics for every
// added extension the same way Roadmap #23G-C2 empirically verified the
// two entries already here.
const EXECUTION_TARGET_CLASSIFIERS = Object.freeze({
  cypress: (relPath) => relPath.startsWith("cypress/e2e/") && relPath.endsWith(".cy.js"),
  playwright: (relPath) => relPath.startsWith("playwright/") && relPath.endsWith(".spec.js"),
});

// Roadmap #23G-C1 (closes 23G-RV-4A): a POSITIVE allowlist only - nothing
// not explicitly named here is ever copied into the child's environment,
// regardless of what this process's own env otherwise contains. This
// necessarily and by construction excludes every application-level secret
// this repository defines (AI_API_KEY/AI_PROVIDER/AI_MODEL - see
// scripts/ai/config.js; GITHUB_TOKEN - see scripts/ai/collect-history.js),
// since none of those names appear below. Matched case-insensitively when
// copying (Windows environment-block key casing is inconsistent across
// hosts - e.g. "Path" vs "PATH" - while POSIX env is case-sensitive and
// canonically uppercase; a case-insensitive match is therefore strictly
// more permissive than exact-case matching and never less safe, since the
// allowlist is still a fixed, closed set of NAMES). Every entry exists for
// a concrete, documented reason a locally-installed Cypress/Playwright/
// Chromium launch actually needs:
//   PATH        - resolving `node` itself from the npm-generated .bin shim
//                 (a Windows .cmd shim / POSIX shebang script both need
//                 this), and any OS-level browser-discovery Cypress/
//                 Playwright perform internally.
//   SystemRoot,
//   windir      - required by many Win32 APIs/child processes on Windows;
//                 commonly needed by Node/Chrome internals even when not
//                 obviously so.
//   TEMP, TMP   - Cypress/Playwright/Chromium all write scratch/profile
//                 data to the OS temp directory.
//   HOME,
//   USERPROFILE - some npm/Node/Chrome internals resolve caches or profile
//                 defaults relative to the user home directory.
//   APPDATA,
//   LOCALAPPDATA - Chrome/Edge profile and cache locations on Windows.
//   CI          - a non-secret boolean-ish flag; Cypress/Playwright both
//                 branch minor behavior (report verbosity, auto-open) on
//                 its presence, and it carries no application secret.
const ENV_ALLOWLIST = Object.freeze([
  "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CI",
]);

// Roadmap #23G-C1 (closes 23G-RV-4A): builds a NEW, minimal environment
// object from `sourceEnv` - only names on ENV_ALLOWLIST (matched
// case-insensitively) are ever copied, each under its ORIGINAL key casing
// and value. `sourceEnv` is read via `Object.keys`/own-property access only
// (never trusts a caller-supplied object's own iteration/getter behavior
// beyond that).
function buildExecutionEnvironment(sourceEnv) {
  const result = {};
  if (typeof sourceEnv !== "object" || sourceEnv === null) return result;
  for (const key of Object.keys(sourceEnv)) {
    if (ENV_ALLOWLIST.includes(key.toUpperCase())) {
      result[key] = sourceEnv[key];
    }
  }
  return result;
}

// Roadmap #23G-C1 Section 13: `shell:false` always; resolves a runner
// binary directly from THIS repository's own `node_modules/.bin/` (never
// PATH, never a package.json script) - a fixed, repository-root-relative,
// platform-derived (never caller-derived) path. On Windows, npm generates a
// `.cmd` shim there (Node's non-shell spawn cannot resolve an extensionless
// POSIX shebang script via PATHEXT the way a real shell would); on POSIX,
// the extensionless shebang script itself is directly executable.
function resolveLocalBinary(realRoot, binaryName) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  return path.join(realRoot, "node_modules", ".bin", `${binaryName}${ext}`);
}

// Roadmap #23G-C3 (closes 23G-C2-RR-2): Cypress's own --spec value is
// matched via minimatch glob semantics (not a literal filename comparison),
// and #23D/#23C's own path-safety rules (isSafeRepoRelativePath/
// isCanonicalPlanPath) do NOT reject glob/extglob-special characters in a
// path segment. #23G-C2 tried to DENYLIST the dangerous characters
// (*, ?, [, ], {, }, ,) but independent review proved this incomplete:
// minimatch (the exact version installed in this repository's own
// dependency tree) treats !, +, @, (, ), | as extglob syntax under DEFAULT
// options too (independently confirmed: minimatch("other.cy.js",
// "!(foo).cy.js") -> true; minimatch("a.cy.js", "+(a|b).cy.js") -> true).
// A denylist is fundamentally fragile here (it can only ever be as
// complete as whatever was enumerated), so this is a POSITIVE ALLOWLIST
// instead: a Cypress target path is safe to pass to --spec ONLY if it
// contains nothing but the characters this repository's own real spec
// files already use (letters, digits, ".", "_", "/", "-") - anything else
// is unsafe BY DEFAULT, never individually re-litigated character by
// character. This is provable by construction (no character outside this
// set ever reaches Cypress's spec matcher), not by empirical Cypress-CLI
// verification (the local Cypress binary remains broken on this dev
// machine, independent of #23G's own changes).
const CYPRESS_SAFE_TARGET_PATH = /^[A-Za-z0-9._/-]+$/;

// Roadmap #23G-C3 (closes 23G-C2-RR-2 Section 29-32): a RECOGNIZED
// executable target (one that matches EXECUTION_TARGET_CLASSIFIERS) whose
// path fails the safe-character allowlist is NOT silently dropped from
// execution the way a non-matching support/helper file is (#23G-C2's own
// bug) - it is returned separately as `unsafeExecutableTargets`, which
// executeAppliedChangeSet() below treats as a hard, whole-execution
// rejection (zero spawn) rather than quietly running only the safe
// remainder. A changeset containing one safe spec and one unsafe spec must
// never execute "just the safe one" - that would silently narrow the
// reviewed/applied scope the AppliedChangeSetRecord actually represents.
function deriveExecutionTargets(framework, changes) {
  const classifier = EXECUTION_TARGET_CLASSIFIERS[framework];
  if (!classifier) return { executableTargets: [], unsafeExecutableTargets: [] };
  const recognized = changes.filter((change) => classifier(change.path));
  if (framework !== "cypress") {
    // Playwright's own exact-match construction (see
    // buildPlaywrightExactTargetPattern() below) escapes and anchors the
    // FULL absolute path, which is a complete, provably-exhaustive
    // operation over every possible character - unlike Cypress's
    // minimatch-based matching, there is no "unsafe character" category
    // here to separately reject.
    return { executableTargets: recognized.map((change) => change.path), unsafeExecutableTargets: [] };
  }
  const executableTargets = [];
  const unsafeExecutableTargets = [];
  for (const change of recognized) {
    if (CYPRESS_SAFE_TARGET_PATH.test(change.path)) executableTargets.push(change.path);
    else unsafeExecutableTargets.push(change.path);
  }
  return { executableTargets, unsafeExecutableTargets };
}

// Roadmap #23G-C2 (closes 23G-C1-RR-1): escapes every JavaScript regex
// metacharacter in a literal string so it can be embedded in a regex
// pattern and match only itself. Standard, well-established idiom (the
// same 12-character class MDN documents) - not reimplemented per-use, and
// deliberately not sourced from a dependency for a 1-line pure function.
function escapeRegexLiteral(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Roadmap #23G-C3 (closes 23G-C2-RR-1 for real): builds an anchored,
// fully-escaped exact-match pattern for one target, against the FULL
// ABSOLUTE file path - not the repository-relative path #23G-C1/#23G-C2
// both used. ROOT CAUSE, established empirically this pass (see this
// project's own natural Linux CI log, and not merely reasoned about):
// Playwright's positional test-filter arguments are regular expressions
// matched against the candidate file's full absolute path, not any
// repository- or testDir-relative form. An anchored REPOSITORY-RELATIVE
// pattern (`^playwright/tests/foo\.spec\.js$`) can therefore never match
// ANY real file on ANY platform, because the string it is actually
// compared against always begins with the filesystem's own absolute root,
// never with "playwright/" - #23G-C2's own anchored-relative attempt
// appeared to work on a Windows dev-machine manual run but failed with
// "No tests found" on this exact project's natural Linux CI, and a
// dedicated, disposable, non-permanent diagnostic test (never committed to
// this pass's final history) proved conclusively, side-by-side on the same
// real Linux CI job, that only an ANCHORED ABSOLUTE pattern selects the
// intended file while an anchored repository-relative or testDir-relative
// pattern selects nothing.
//
// `realRoot` MUST be the already execution-time-revalidated, already
// symlink/containment-checked real repository root (resolveRepositoryRoot's
// own output) - never a caller-supplied raw string - and
// `canonicalTargetPath` MUST be an already-classified, already-revalidated
// applied path. This function performs one additional, cheap containment
// sanity check of its own (the resolved absolute path must still be
// realRoot itself or a path under it) as defense in depth, even though
// upstream #23D/#23F/#23G validation already guarantees this - returning
// `null` (never throwing) if that invariant is somehow violated, which the
// caller treats as a hard command-construction failure.
function buildPlaywrightExactTargetPattern(realRoot, canonicalTargetPath) {
  const normalizedRoot = realRoot.split(path.sep).join("/").replace(/\/+$/, "");
  const absoluteTarget = path.resolve(realRoot, canonicalTargetPath).split(path.sep).join("/");
  if (absoluteTarget !== normalizedRoot && !absoluteTarget.startsWith(`${normalizedRoot}/`)) {
    return null;
  }
  return `^${escapeRegexLiteral(absoluteTarget)}$`;
}

// Roadmap #23G-C1 (closes 23G-RV-2): the SOLE command-selection function -
// takes only an already-validated framework enum value, the resolved real
// repository root, and the already-derived, already-revalidated target path
// list, and returns a fixed executable + argument array whose ONLY variable
// component is that exact target list. Never accepts or interpolates any
// caller/provider-supplied string into the returned command.
function selectExecutionCommand(framework, realRoot, targets) {
  if (!FRAMEWORK_BINARIES[framework]) return { ok: false };
  if (!Array.isArray(targets) || targets.length === 0) return { ok: false, noTargets: true };

  const executable = resolveLocalBinary(realRoot, FRAMEWORK_BINARIES[framework]);
  if (framework === "cypress") {
    return {
      ok: true,
      executable,
      // Cypress's own documented multi-spec syntax is a single
      // comma-joined --spec value - still exactly ONE argv entry, so this
      // remains a plain data value passed to spawn() with shell:false,
      // never a concatenated shell command.
      args: ["run", "--headless", "--browser", "chrome", "--spec", targets.join(",")],
      // Bounded, human-readable evidence string only - never re-parsed or
      // re-executed from this text; the actual argv array above is what
      // spawn() receives. A short count-only summary keeps this comfortably
      // within automation-execution-record.js's own MAX_COMMAND_LENGTH
      // regardless of how many/how long the real target paths are.
      commandLabel: `cypress run (${targets.length} target${targets.length === 1 ? "" : "s"})`,
    };
  }
  // playwright: positional arguments are regular expressions matched
  // against the candidate file's FULL ABSOLUTE path, never a literal
  // filename (Roadmap #23G-C3, closes 23G-C2-RR-1 for real - see
  // buildPlaywrightExactTargetPattern()'s own docstring for the empirical
  // evidence) - each target is converted to its own anchored, fully-escaped
  // absolute-path pattern, never the raw repo-relative path, and passed as
  // its own argv entry (Playwright ORs multiple positional patterns
  // together - independently verified against the real installed binary).
  const patterns = targets.map((target) => buildPlaywrightExactTargetPattern(realRoot, target));
  if (patterns.some((pattern) => pattern === null)) {
    // Containment sanity check failed (see buildPlaywrightExactTargetPattern's
    // own docstring) - defense in depth against an invariant upstream
    // validation should already guarantee; fails closed, zero spawn.
    return { ok: false };
  }
  return {
    ok: true,
    executable,
    args: ["test", "--config=playwright.config.js", "--project=chromium", ...patterns],
    commandLabel: `playwright test (${targets.length} target${targets.length === 1 ? "" : "s"})`,
  };
}

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
 *
 * `env`, when supplied, REPLACES (never merges with) the child's
 * environment - the real orchestrator below always supplies the closed
 * buildExecutionEnvironment() allowlist output, never this module's own
 * full `process.env` (Roadmap #23G-C1, closes 23G-RV-4A). When omitted
 * (e.g. by a direct unit test), Node's own default applies.
 */
function runBoundedProcess(executable, args, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    let child;
    try {
      const spawnOptions = { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] };
      if (env !== undefined) spawnOptions.env = env;
      child = childProcess.spawn(executable, args, spawnOptions);
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

  // 6. Target derivation - Roadmap #23G-C1, closes 23G-RV-2. Derived ONLY
  // from the already execution-time-revalidated applied paths, filtered
  // through the framework's own closed classifier. Zero executable targets
  // is a precondition rejection, never a silent whole-suite fallback.
  //
  // Roadmap #23G-C3 (closes 23G-C2-RR-2 Section 29-32): a RECOGNIZED
  // executable target whose path fails the Cypress safe-character
  // allowlist is a HARD, WHOLE-EXECUTION rejection - never silently
  // dropped while the remaining safe targets execute anyway. A changeset
  // containing one safe spec and one unsafe spec must never narrow to "just
  // run the safe one"; that would silently execute less than what the
  // AppliedChangeSetRecord actually represents.
  const derivedTargets = deriveExecutionTargets(planSnapshot.framework, recordSnapshot.changes);
  if (derivedTargets.unsafeExecutableTargets.length > 0) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.changes", ERROR_CODES.INVARIANT_VIOLATION, "one or more applied executable test targets are not safe to pass to the framework's own target-selection CLI (UNSAFE_EXECUTION_TARGET)")], automationExecutionRecord: null };
  }
  const targets = derivedTargets.executableTargets;
  if (targets.length === 0) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.changes", ERROR_CODES.INVARIANT_VIOLATION, "no applied change matches a recognized executable test-file path for this framework (NO_EXECUTABLE_TEST_TARGET)")], automationExecutionRecord: null };
  }

  // 7. Framework/command selection - closed vocabulary only, targeted only
  // at the exact paths derived above.
  const selected = selectExecutionCommand(planSnapshot.framework, rootResult.realRoot, targets);
  if (!selected.ok) {
    return { ok: false, errors: [err("$.automationPlan.framework", ERROR_CODES.INVALID_ENUM, `no execution command is mapped for framework "${planSnapshot.framework}"`)], automationExecutionRecord: null };
  }

  // 8. Bounded, environment-minimized child-process execution - Roadmap
  // #23G-C1, closes 23G-RV-4A.
  const startedAt = executedAt;
  const effectiveTimeoutMs = resolveExecutionTimeout(timeoutMs);
  const executionEnv = buildExecutionEnvironment(process.env);
  const result = await runBoundedProcess(selected.executable, selected.args, { cwd: rootResult.realRoot, timeoutMs: effectiveTimeoutMs, env: executionEnv });
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
  FRAMEWORK_BINARIES,
  EXECUTION_TARGET_CLASSIFIERS,
  ENV_ALLOWLIST,
  MAX_EXECUTION_TIMEOUT_MS,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  MAX_STDOUT_BYTES,
  MAX_STDERR_BYTES,
  resolveLocalBinary,
  deriveExecutionTargets,
  escapeRegexLiteral,
  buildPlaywrightExactTargetPattern,
  CYPRESS_SAFE_TARGET_PATH,
  buildExecutionEnvironment,
  selectExecutionCommand,
  resolveExecutionTimeout,
  runBoundedProcess,
  revalidateAppliedState,
  executeAppliedChangeSet,
};
