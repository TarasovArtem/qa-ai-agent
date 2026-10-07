/**
 * AISEC-7 outer completeness verifier (SEC-02).
 *
 * Harness-internal only. It runs the complete AISEC-7 evidence-file manifest
 * in ONE supervised Node child process and accepts the run only when the
 * runner's structured output proves complete mandatory execution. Exit code 0
 * and "0 failed / 0 skipped" are necessary but never sufficient.
 *
 * Safe child process contract:
 *   - executable: process.execPath only, shell: false, fixed argv;
 *   - targets: the exact evidence files from the execution manifest; the
 *     verifier file itself can never be launched (no recursion);
 *   - environment: a minimal allowlist of OS location variables plus the
 *     AISEC7_EVIDENCE_CHILD marker. NODE_OPTIONS, NODE_TEST_CONTEXT, AI_*,
 *     tokens and every other variable are not inherited;
 *   - finite timeout with SIGKILL, bounded output buffer, output captured.
 * The child only runs AISEC-7 tests, which stub every network, provider and
 * process effect themselves (see fixtures.js).
 */

"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");
const url = require("node:url");

const fx = require("./fixtures");
const manifest = require("./evidence-manifest");
const { LEDGER_DIAGNOSTIC } = require("./execution-ledger");

const HARNESS_DIR = path.resolve(__dirname, "..");
const REPORTER = url.pathToFileURL(path.join(__dirname, "evidence-reporter.js")).href;
const CHILD_MARKER = "AISEC7_EVIDENCE_CHILD";
const CHILD_TIMEOUT_MS = 180000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const INHERITED_ENV = Object.freeze(["SystemRoot", "windir", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]);
const COUNT_FIELDS = Object.freeze(["tests", "passed", "failed", "cancelled", "skipped", "todo"]);
const DIAGNOSTIC_COUNTS = Object.freeze({ tests: "tests", pass: "passed", fail: "failed", cancelled: "cancelled", skipped: "skipped", todo: "todo" });

function evidenceFilePaths() {
  return manifest.EVIDENCE_FILES.map((file) => path.join(HARNESS_DIR, file));
}

/** Minimal child environment; `overrides` exists only for adversarial probes. */
function childEnvironment(parentEnv, overrides = {}) {
  const wanted = new Set(INHERITED_ENV.map((n) => n.toUpperCase()));
  const env = {};
  for (const [name, value] of Object.entries(parentEnv)) {
    if (wanted.has(name.toUpperCase()) && typeof value === "string") env[name] = value;
  }
  return { ...env, [CHILD_MARKER]: "1", ...overrides };
}

function samePath(a, b) {
  const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

/**
 * Launches one evidence child. Low level: it applies no filter policy, so
 * probes can show that a filtered child is rejected by verifyEvidenceRun().
 */
function launchEvidenceRun({ files, env, execArgv = [], timeoutMs = CHILD_TIMEOUT_MS }) {
  for (const file of files) {
    if (path.basename(file) === manifest.VERIFIER_FILE) throw new Error("AISEC-7 outer verifier: refusing to launch itself (recursion)");
  }
  if (!env || env[CHILD_MARKER] !== "1") throw new Error("AISEC-7 outer verifier: the child environment must be built by childEnvironment()");
  const args = [...execArgv, "--test", `--test-reporter=${REPORTER}`, "--test-reporter-destination=stdout", ...files.map((f) => f.split(path.sep).join("/"))];
  const res = childProcess.spawnSync(process.execPath, args, {
    cwd: fx.REPO_ROOT,
    env,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return { files: [...files], status: res.status, signal: res.signal, error: res.error ? String(res.error.message) : null, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/** Parses reporter output; throws on anything that is not complete JSONL. */
function parseEvidenceOutput(stdout) {
  if (typeof stdout !== "string" || stdout.length === 0) throw new Error("no runner output");
  if (!stdout.endsWith("\n")) throw new Error("runner output is truncated (no final newline)");
  return stdout.slice(0, -1).split("\n").map((line, i) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1} is not JSON`);
    }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") throw new Error(`line ${i + 1} is not a runner event`);
    return event;
  });
}

const flagged = (value) => value !== undefined && value !== null && value !== false;

function checkCounts(label, counts, expected, problems) {
  if (!counts || typeof counts !== "object") {
    problems.push(`${label}: no counts`);
    return;
  }
  const want = { tests: expected, passed: expected, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  for (const field of COUNT_FIELDS) {
    if (counts[field] !== want[field]) problems.push(`${label}: ${field} ${counts[field]} != ${want[field]}`);
  }
}

function sameList(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function verifyFile(file, resolved, events, problems) {
  const expected = manifest.expectedTests(file);
  const own = events.filter((e) => e.file !== undefined && samePath(e.file, resolved));

  const summaries = own.filter((e) => e.type === "test:summary");
  if (summaries.length !== 1) problems.push(`${file}: ${summaries.length} per-file summaries (incomplete or premature termination)`);
  else {
    checkCounts(`${file} summary`, summaries[0].counts, expected.length, problems);
    if (summaries[0].success !== true) problems.push(`${file}: summary is not successful`);
  }

  const results = own.filter((e) => e.type === "test:pass" || e.type === "test:fail");
  const keys = [];
  for (const e of results) {
    const key = manifest.testKey(String(e.name));
    if (flagged(e.skip)) problems.push(`${file}: "${e.name}" skipped`);
    if (flagged(e.todo)) problems.push(`${file}: "${e.name}" todo`);
    if (e.nesting !== 0 || e.detailsType !== "test") problems.push(`${file}: unexpected nested or non-test result "${e.name}"`);
    if (!expected.includes(key)) problems.push(`${file}: unexpected result "${e.name}"`);
    keys.push(key);
  }
  if (new Set(keys).size !== keys.length) problems.push(`${file}: duplicate test results`);
  const missing = expected.filter((k) => !keys.includes(k));
  if (missing.length) problems.push(`${file}: tests missing from the run: ${missing.join(", ")}`);

  const ledgers = own.filter((e) => e.type === "test:diagnostic" && typeof e.message === "string" && e.message.startsWith(LEDGER_DIAGNOSTIC));
  if (ledgers.length !== 1) {
    problems.push(`${file}: ${ledgers.length} execution ledgers`);
    return { file, tests: keys.length, confirmed: [] };
  }
  let ledger;
  try {
    ledger = JSON.parse(ledgers[0].message.slice(LEDGER_DIAGNOSTIC.length));
  } catch {
    problems.push(`${file}: ledger is not JSON`);
    return { file, tests: keys.length, confirmed: [] };
  }
  const want = {
    file,
    filters: [],
    tests: expected,
    confirmed: manifest.requiredConfirmations(file),
    controls: manifest.requiredControls(file),
    targets: manifest.ownTestTargets(file),
  };
  if (ledger.file !== file) problems.push(`${file}: ledger names ${ledger.file}`);
  for (const field of ["filters", "tests", "confirmed", "controls", "targets"]) {
    if (!Array.isArray(ledger[field]) || !sameList(ledger[field], want[field])) {
      const got = Array.isArray(ledger[field]) ? ledger[field] : [];
      const absent = want[field].filter((x) => !got.includes(x));
      const extra = got.filter((x) => !want[field].includes(x));
      problems.push(`${file}: ledger ${field} mismatch${absent.length ? `; missing ${absent.join(", ")}` : ""}${extra.length ? `; unexpected ${extra.join(", ")}` : ""}`);
    }
  }
  return { file, tests: keys.length, confirmed: Array.isArray(ledger.confirmed) ? ledger.confirmed : [] };
}

/**
 * Decides whether one child run is complete AISEC-7 evidence. Fails closed:
 * any doubt, parse error or exception is a problem, and only a run with no
 * problem at all is accepted.
 */
function verifyEvidenceRun(run) {
  const problems = [];
  const perFile = [];
  let finalCounts = null;
  try {
    if (run.error) problems.push(`child process error: ${run.error}`);
    if (run.signal) problems.push(`child terminated by ${run.signal}`);
    if (run.status !== 0) problems.push(`child exit status ${run.status}`);

    const launched = run.files.map((f) => path.basename(f));
    if (!sameList(launched, manifest.EVIDENCE_FILES) || new Set(launched).size !== launched.length) {
      problems.push(`launched files ${JSON.stringify(launched.sort())} != manifest ${JSON.stringify(manifest.EVIDENCE_FILES)}`);
    }

    let events = [];
    try {
      events = parseEvidenceOutput(run.stdout);
    } catch (err) {
      problems.push(`runner output rejected: ${err.message}`);
    }

    // Results are attributed to the file that called test(); a failing ledger
    // hook is attributed to the ledger library. Any such result is invalid,
    // and every failure is reported with its message wherever it came from.
    const foreign = new Set();
    for (const e of events) {
      if (e.file !== undefined && !run.files.some((f) => samePath(f, e.file))) foreign.add(e.file);
      if (e.type === "test:fail") problems.push(`${e.file ? path.basename(e.file) : "run"}: "${e.name}" failed${e.error ? `: ${e.error}` : ""}`);
    }
    for (const file of foreign) problems.push(`events from an unlaunched file: ${file}`);

    const expectedTotal = manifest.evidenceChildTotal();
    const runSummaries = events.filter((e) => e.type === "test:summary" && e.file === undefined);
    if (runSummaries.length !== 1) problems.push(`${runSummaries.length} terminal run summaries`);
    else if (events[events.length - 1] !== runSummaries[0]) problems.push("terminal run summary is not the last event (truncated or reordered output)");
    else {
      finalCounts = runSummaries[0].counts;
      checkCounts("run summary", finalCounts, expectedTotal, problems);
      if (runSummaries[0].success !== true) problems.push("run summary is not successful");
    }

    const diagnosticCounts = {};
    for (const e of events.filter((x) => x.type === "test:diagnostic" && x.file === undefined)) {
      const m = /^(tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(String(e.message));
      if (m) {
        if (diagnosticCounts[DIAGNOSTIC_COUNTS[m[1]]] !== undefined) problems.push(`repeated terminal count "${m[1]}"`);
        diagnosticCounts[DIAGNOSTIC_COUNTS[m[1]]] = Number(m[2]);
      }
    }
    for (const field of COUNT_FIELDS) {
      if (diagnosticCounts[field] === undefined) problems.push(`terminal count "${field}" missing`);
      else if (finalCounts && diagnosticCounts[field] !== finalCounts[field]) problems.push(`terminal count "${field}" ${diagnosticCounts[field]} contradicts the run summary ${finalCounts[field]}`);
    }

    const allResults = events.filter((e) => e.type === "test:pass" || e.type === "test:fail");
    if (allResults.length !== expectedTotal) problems.push(`${allResults.length} test results != expected ${expectedTotal}`);

    for (const file of manifest.EVIDENCE_FILES) {
      const resolved = run.files.find((f) => path.basename(f) === file);
      if (!resolved) {
        problems.push(`${file}: not launched`);
        continue;
      }
      perFile.push(verifyFile(file, resolved, events, problems));
    }
  } catch (err) {
    problems.push(`verifier error: ${err && err.message}`);
  }
  return { accepted: problems.length === 0, problems, counts: finalCounts, perFile };
}

/**
 * The gate entry: refuses a recursive or filtered invocation, then runs the
 * complete manifest in a sanitized child and verifies it.
 */
function runCompleteEvidence({ parentEnv = process.env, parentExecArgv = process.execArgv } = {}) {
  if (parentEnv[CHILD_MARKER] === "1") throw new Error("AISEC-7 outer verifier: refusing to run inside an evidence child (recursion)");
  const filters = manifest.selectionFilters({ execArgv: parentExecArgv, nodeOptions: parentEnv.NODE_OPTIONS });
  if (filters.length > 0) {
    return { accepted: false, refused: true, problems: [`test-selection options configured for this AISEC-7 run: ${filters.join(" ")}`], counts: null, perFile: [] };
  }
  const run = launchEvidenceRun({ files: evidenceFilePaths(), env: childEnvironment(parentEnv) });
  return { run, ...verifyEvidenceRun(run) };
}

module.exports = {
  HARNESS_DIR,
  CHILD_MARKER,
  CHILD_TIMEOUT_MS,
  INHERITED_ENV,
  evidenceFilePaths,
  childEnvironment,
  launchEvidenceRun,
  parseEvidenceOutput,
  verifyEvidenceRun,
  runCompleteEvidence,
};
