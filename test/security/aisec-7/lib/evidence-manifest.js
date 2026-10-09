/**
 * AISEC-7 complete-execution manifest (SEC-02).
 *
 * Harness-internal only. The reviewed source of truth for WHICH evidence files
 * must run, WHICH tests each one must execute and HOW MANY tests a complete run
 * contains. The per-file execution ledgers (execution-ledger.js) and the outer
 * completeness verifier (evidence-run.js, evidence-completeness.test.js) both
 * bind to it, so a run that loses a file, a test or a confirmation cannot
 * match it.
 *
 * Derivation, not magic numbers:
 *   - evidence files      = every distinct `file` in the registry;
 *   - tests per file      = one test per registry row mapped to the file
 *                           (target rows mapped to harness-invariants.test.js
 *                           have no own test: one invariant evaluates them all)
 *                           + the harness tests named below;
 *   - confirmations       = every CURRENT_BEHAVIOR registry row of the file
 *                           (+ declared non-vacuity controls).
 * REVIEWED_COUNTS pins the totals this derivation must produce. Adding,
 * removing or renaming a test therefore fails until this manifest, the
 * reviewed counts and the AISEC-7 document are updated together.
 *
 * This is execution metadata only. It never changes a security outcome:
 * node:test pass/fail and the security verification outcome stay separate.
 */

"use strict";

const { CASES } = require("./registry");
const { SCOPES } = require("./outcomes");

const VERIFIER_FILE = "evidence-completeness.test.js";
const INVARIANTS_FILE = "harness-invariants.test.js";
const TRIAGE_FILE = "triage-cross-project.test.js";

// Node 22 test-selection options. Any of them can remove mandatory tests
// without counting them as skipped, so none may shape an evidence run.
const SELECTION_FLAGS = Object.freeze(["--test-name-pattern", "--test-skip-pattern", "--test-only", "--test-shard"]);

const EVIDENCE_FILES = Object.freeze([...new Set(CASES.map((c) => c.file))].sort());

// Executable tests that are not registry rows: non-vacuity controls,
// regressions, harness invariants and the outer verifier itself.
const HARNESS_TESTS = Object.freeze({
  [TRIAGE_FILE]: Object.freeze([
    "harness control: the wrapped MockProvider observes a same-project analysis (interception is not vacuous)",
    "SEC-01 regression: with AI_PROVIDER=aisec7-probe-nonexistent every mock-only mandatory case fails closed before any provider, network or process effect; none skips",
  ]),
  [INVARIANTS_FILE]: Object.freeze([
    "coverage: H-01..H-12 are all represented, in order, with no extra rows",
    "coverage: every H row has at least one case and at least one target-architecture row; case ids are unique",
    "coverage: every executable current-behavior case is confirmed by a test in its declared file",
    "evidence integrity (SEC-03): evidence files contain no static skip, todo or only construct (defense in depth, not execution proof)",
    "false-PASS: missing or incomplete evidence never becomes PASS",
    "false-PASS: a blocked dependency never becomes PASS, whatever the observation claims",
    "false-PASS: an open owner disposition never becomes PASS",
    "false-PASS: synthetic trust labels and schema validity do not change any outcome",
    "false-PASS: a current deterministic refusal may be PASS while its target architecture stays blocked",
    "false-PASS: a successful reproduction test keeps a FAIL security outcome, and policy dependencies do not erase it",
    "false-PASS: no current-behavior case reports PASS for a property that is a declared FAIL, and FAIL cases exist",
    "finding preservation: XI cases keep XI-01/XI-02 OPEN / MEDIUM and never claim closure",
    "documentation: every H row and every case appears in the AISEC-7 document with its declared outcome",
    "safety: harness temp roots live under the OS temp directory",
    "safety: the harness makes no direct network or process call and names no real endpoint",
    "safety: the harness reads no real secret value from the environment",
  ]),
  [VERIFIER_FILE]: Object.freeze([
    "SEC-02 manifest: evidence files derive from the registry, exclude the outer verifier and match the harness directory",
    "SEC-02 count model: the evidence-child and top-level totals derive from the registry and the declared harness tests",
    "SEC-02 parser: malformed, truncated, summary-less, contradictory, skipped, failed and off-by-one runs are rejected",
    "SEC-02 runner-filter guard: selection options in execArgv or NODE_OPTIONS are refused and never reach the child",
    "SEC-02 recursion guard: the outer verifier never launches itself and refuses to run inside an evidence child",
    "SEC-02 NORMAL: a complete evidence child run is accepted with the exact manifest, counts and confirmations",
    "SEC-02 DIRECT_SKIP_PATTERN: --test-skip-pattern=H09 is invalid evidence",
    "SEC-02 NODE_OPTIONS_SKIP_PATTERN: NODE_OPTIONS=--test-skip-pattern=H09 is invalid evidence",
    "SEC-02 NAME_PATTERN: --test-name-pattern is invalid evidence",
    "SEC-02 TEST_ONLY: --test-only is invalid evidence",
    "SEC-02 WHOLE_FILE_REMOVAL: a run without one evidence file is invalid evidence",
    "SEC-02 PROBE_CONTROL: an unmutated temporary copy is accepted, so the mutation probes are not vacuous",
    "SEC-02 NON_TRIAGE_EARLY_RETURN: a case returning before confirmCase() fails its file ledger and is invalid evidence",
    "SEC-02 DYNAMIC_SKIP: a { skip: expression } registration is invalid evidence",
    "SEC-02 PREMATURE_EXIT_0: process.exit(0) inside an evidence file exits 0 but is invalid evidence",
    "SEC-02 SEC01_NON_MOCK_PROVIDER: AI_PROVIDER=aisec7-probe-nonexistent fails closed in the child and is invalid evidence",
  ]),
});

// Non-vacuity controls that must reach confirmation like a case.
const CONTROLS = Object.freeze({ [TRIAGE_FILE]: Object.freeze(["harness-control"]) });

// The reviewed totals the derivation must reproduce (see the AISEC-7 document,
// section 14a): 57 current-behavior cases + 3 target rows with their own test
// + 2 triage harness tests + 16 invariants = 78 in the evidence child, plus
// the 16 outer-verifier tests = 94 for the top-level AISEC-7 suite.
const REVIEWED_COUNTS = Object.freeze({ evidenceChild: 78, topLevel: 94 });

function assertKnownFile(file) {
  if (!EVIDENCE_FILES.includes(file) && file !== VERIFIER_FILE) {
    throw new Error(`AISEC-7 execution manifest: ${file} is not a reviewed AISEC-7 test file`);
  }
}

/** Registry rows that have their own executable test in `file`. */
function rowsWithOwnTest(file) {
  if (file === INVARIANTS_FILE) return [];
  return CASES.filter((c) => c.file === file).map((c) => c.id);
}

/** Current-behavior case ids that must reach confirmCase() in `file`. */
function requiredConfirmations(file) {
  return CASES.filter((c) => c.file === file && c.scope === SCOPES.CURRENT_BEHAVIOR).map((c) => c.id);
}

/** Target-architecture rows of `file` that are evaluated by their own test. */
function ownTestTargets(file) {
  if (file === INVARIANTS_FILE) return [];
  return CASES.filter((c) => c.file === file && c.scope === SCOPES.TARGET_ARCHITECTURE).map((c) => c.id);
}

function requiredControls(file) {
  return [...(CONTROLS[file] || [])];
}

/** The identity of one test: its registry id, or its exact name for a harness test. */
function testKey(name) {
  const match = /^(H\d{2}-(?:C\d+|T))[: ]/.exec(name);
  return match ? match[1] : name;
}

/** Every test key `file` must execute, in declaration order. */
function expectedTests(file) {
  assertKnownFile(file);
  return [...rowsWithOwnTest(file), ...(HARNESS_TESTS[file] || [])];
}

function evidenceChildTotal() {
  return EVIDENCE_FILES.reduce((sum, file) => sum + expectedTests(file).length, 0);
}

function topLevelTotal() {
  return evidenceChildTotal() + expectedTests(VERIFIER_FILE).length;
}

/** Test-selection options present in an argv list or a NODE_OPTIONS string. */
function selectionFilters({ execArgv = [], nodeOptions = "" } = {}) {
  const tokens = [...execArgv, ...String(nodeOptions || "").split(/\s+/)].filter(Boolean);
  return tokens.filter((token) => SELECTION_FLAGS.some((flag) => token === flag || token.startsWith(`${flag}=`)));
}

module.exports = {
  VERIFIER_FILE,
  INVARIANTS_FILE,
  TRIAGE_FILE,
  SELECTION_FLAGS,
  EVIDENCE_FILES,
  HARNESS_TESTS,
  CONTROLS,
  REVIEWED_COUNTS,
  rowsWithOwnTest,
  requiredConfirmations,
  ownTestTargets,
  requiredControls,
  testKey,
  expectedTests,
  evidenceChildTotal,
  topLevelTotal,
  selectionFilters,
};
