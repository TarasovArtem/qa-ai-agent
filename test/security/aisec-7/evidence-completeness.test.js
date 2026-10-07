"use strict";

/**
 * AISEC-7 outer completeness verifier (SEC-02).
 *
 * Exit code 0, "0 failed" and "0 skipped" do not prove that mandatory
 * evidence ran: runner filters can make tests disappear, and process.exit(0)
 * can end a file before its ledger hook. This file therefore runs the complete
 * evidence-file manifest in a supervised Node child (lib/evidence-run.js) and
 * accepts it only when the structured runner output binds every expected
 * file, test, count and case confirmation.
 *
 * Recursion: the child runs only the registry-derived evidence files. This
 * file is not one of them, launchEvidenceRun() refuses it by name, and
 * runCompleteEvidence() refuses to run inside an evidence child.
 *
 * Adversarial probes run against temporary copies or child options only; no
 * tracked file is modified. Each probe must be REJECTED. A node:test pass
 * here means "the verifier rejected invalid evidence", never a product
 * security outcome.
 */

const nodeTest = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fx = require("./lib/fixtures");
const manifest = require("./lib/evidence-manifest");
const { CASES } = require("./lib/registry");
const { SCOPES } = require("./lib/outcomes");
const { createEvidenceLedger, LEDGER_DIAGNOSTIC } = require("./lib/execution-ledger");
const run = require("./lib/evidence-run");

const ledger = createEvidenceLedger(__filename);

// Registered from this file so node:test attributes every result to it; the
// ledger records completion and refuses test options (SEC-02).
function test(name, fn) {
  return nodeTest(name, ledger.track(name, fn));
}
test.after = nodeTest.after;

test.after(() => fx.cleanupRoots());

const HARNESS_DIR = __dirname;
const LIB_DIR = path.join(HARNESS_DIR, "lib");
const Y = manifest.REVIEWED_COUNTS.evidenceChild;

// Compact, reviewable record of one probe for the run log.
function brief(result) {
  const r = result.run || {};
  return JSON.stringify({ exit: r.status, signal: r.signal || null, counts: result.counts, accepted: result.accepted, problems: result.problems.slice(0, 8) });
}

function launchAndVerify({ files = run.evidenceFilePaths(), envOverrides = {}, execArgv = [] } = {}) {
  const child = run.launchEvidenceRun({ files, env: run.childEnvironment(process.env, envOverrides), execArgv });
  return { run: child, ...run.verifyEvidenceRun(child) };
}

// Writes a temporary copy of one evidence file with exactly one anchored
// source transformation. Relative lib requires are pointed back at the real
// harness so only the transformed file differs.
function mutatedCopy(file, anchor, replacement) {
  const source = fs.readFileSync(path.join(HARNESS_DIR, file), "utf8");
  assert.equal(source.split(anchor).length, 2, `probe anchor occurs exactly once in ${file}`);
  const mutated = source
    .replace(anchor, () => replacement)
    .replace(/require\("\.\/lib\/([\w-]+)"\)/g, (_, mod) => `require(${JSON.stringify(path.join(LIB_DIR, mod))})`);
  return fx.writeJson(fx.makeTempRoot("sec02-probe"), file, mutated);
}

function withSubstitute(file, copy) {
  return run.evidenceFilePaths().map((p) => (path.basename(p) === file ? copy : p));
}

const has = (result, pattern) => result.problems.some((p) => pattern.test(p));

// --- manifest and count model -------------------------------------------------------

test("SEC-02 manifest: evidence files derive from the registry, exclude the outer verifier and match the harness directory", () => {
  assert.deepEqual(manifest.EVIDENCE_FILES, [...new Set(CASES.map((c) => c.file))].sort());
  assert.ok(!manifest.EVIDENCE_FILES.includes(manifest.VERIFIER_FILE));
  const onDisk = fs.readdirSync(HARNESS_DIR).filter((n) => n.endsWith(".test.js")).sort();
  assert.deepEqual(onDisk, [...manifest.EVIDENCE_FILES, manifest.VERIFIER_FILE].sort(), "every AISEC-7 test file is either evidence or the verifier");
  assert.deepEqual(CASES.filter((c) => c.file === manifest.INVARIANTS_FILE && c.scope === SCOPES.CURRENT_BEHAVIOR), [], "no current-behavior case lives in the invariants file");
  for (const file of onDisk) {
    const source = fs.readFileSync(path.join(HARNESS_DIR, file), "utf8");
    assert.ok(source.includes("createEvidenceLedger(__filename)"), `${file} creates its execution ledger`);
    const tracked = "return nodeTest(name, ledger.track(name, fn));";
    const calls = (source.match(/\bnodeTest\(/g) || []).length;
    assert.ok(calls >= 1 && calls === source.split(tracked).length - 1, `${file} registers every test through ledger.track()`);
  }
});

test("SEC-02 count model: the evidence-child and top-level totals derive from the registry and the declared harness tests", () => {
  const current = CASES.filter((c) => c.scope === SCOPES.CURRENT_BEHAVIOR).length;
  const ownTargets = manifest.EVIDENCE_FILES.reduce((n, f) => n + manifest.ownTestTargets(f).length, 0);
  const harness = manifest.EVIDENCE_FILES.reduce((n, f) => n + (manifest.HARNESS_TESTS[f] || []).length, 0);
  const verifier = manifest.HARNESS_TESTS[manifest.VERIFIER_FILE].length;
  assert.deepEqual({ current, ownTargets, harness, verifier }, { current: 57, ownTargets: 3, harness: 18, verifier: 16 });
  assert.equal(manifest.evidenceChildTotal(), current + ownTargets + harness);
  assert.equal(manifest.evidenceChildTotal(), manifest.REVIEWED_COUNTS.evidenceChild);
  assert.equal(manifest.topLevelTotal(), manifest.REVIEWED_COUNTS.evidenceChild + verifier);
  assert.equal(manifest.topLevelTotal(), manifest.REVIEWED_COUNTS.topLevel);
  // Every manifest test is really declared in its file, so the count is the file's own.
  for (const file of [...manifest.EVIDENCE_FILES, manifest.VERIFIER_FILE]) {
    const source = fs.readFileSync(path.join(HARNESS_DIR, file), "utf8");
    for (const key of manifest.expectedTests(file)) {
      const declared = /^H\d{2}-/.test(key) ? source.includes(`"${key}:`) || source.includes(`"${key} `) : source.includes(JSON.stringify(key));
      assert.ok(declared, `${file} declares "${key}"`);
    }
  }
});

// --- parser and verifier, against synthetic runner output -------------------------------

function nameFor(key) {
  return /^H\d{2}-/.test(key) ? `${key}: synthetic` : key;
}

// A self-consistent synthetic run. `drop` removes one test (file, key);
// `extra` adds one (file, name). Both keep every count consistent, so only
// the binding to the manifest can reject them.
function syntheticEvents({ drop, extra } = {}) {
  const events = [];
  let total = 0;
  for (const p of run.evidenceFilePaths()) {
    const file = path.basename(p);
    let keys = manifest.expectedTests(file);
    if (drop && drop[0] === file) keys = keys.filter((k) => k !== drop[1]);
    const names = keys.map(nameFor);
    if (extra && extra[0] === file) names.push(extra[1]);
    for (const name of names) events.push({ type: "test:pass", file: p, name, nesting: 0, detailsType: "test" });
    const ledger = { file, filters: [], tests: keys, confirmed: manifest.requiredConfirmations(file), controls: manifest.requiredControls(file), targets: manifest.ownTestTargets(file) };
    events.push({ type: "test:diagnostic", file: p, nesting: 0, message: LEDGER_DIAGNOSTIC + JSON.stringify(ledger) });
    events.push({ type: "test:summary", file: p, counts: { tests: names.length, passed: names.length, failed: 0, cancelled: 0, skipped: 0, todo: 0 }, success: true });
    total += names.length;
  }
  for (const [label, n] of [["tests", total], ["pass", total], ["fail", 0], ["cancelled", 0], ["skipped", 0], ["todo", 0]]) {
    events.push({ type: "test:diagnostic", nesting: 0, message: `${label} ${n}` });
  }
  events.push({ type: "test:summary", counts: { tests: total, passed: total, failed: 0, cancelled: 0, skipped: 0, todo: 0 }, success: true });
  return events;
}

function syntheticRun(events, overrides = {}) {
  return { files: run.evidenceFilePaths(), status: 0, signal: null, error: null, stdout: `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, stderr: "", ...overrides };
}

function edited(edit) {
  const events = syntheticEvents();
  edit(events);
  return syntheticRun(events);
}

test("SEC-02 parser: malformed, truncated, summary-less, contradictory, skipped, failed and off-by-one runs are rejected", () => {
  assert.deepEqual(run.verifyEvidenceRun(syntheticRun(syntheticEvents())).problems, [], "a complete synthetic run is accepted (the rejections below are not vacuous)");

  const SOURCE = path.join(HARNESS_DIR, "source-destination.test.js");
  const isFile = (e, name) => e.file && path.basename(e.file) === name;
  const good = syntheticRun(syntheticEvents());
  const invalid = {
    "exit status 1": { ...good, status: 1 },
    "killed by timeout": { ...good, status: null, signal: "SIGKILL", error: "spawnSync ETIMEDOUT" },
    "no output": { ...good, stdout: "" },
    "truncated (no final newline)": { ...good, stdout: good.stdout.slice(0, -1) },
    "truncated (terminal summary lost)": { ...good, stdout: `${good.stdout.split("\n").slice(0, -2).join("\n")}\n` },
    "non-JSON line": { ...good, stdout: `ok 1 - looks like TAP\n${good.stdout}` },
    "non-event JSON line": { ...good, stdout: `42\n${good.stdout}` },
    "duplicate terminal summary": edited((ev) => ev.push(ev[ev.length - 1])),
    "terminal summary not last": edited((ev) => ev.push({ type: "test:diagnostic", nesting: 0, message: "late" })),
    "contradictory terminal count": edited((ev) => { ev.find((e) => e.message === `tests ${Y}`).message = `tests ${Y - 1}`; }),
    "missing terminal count line": edited((ev) => ev.splice(ev.findIndex((e) => e.message === "skipped 0"), 1)),
    "off-by-one: one test fewer, counts consistent": syntheticRun(syntheticEvents({ drop: ["source-destination.test.js", "H10-C3"] })),
    "off-by-one: one test more, counts consistent": syntheticRun(syntheticEvents({ extra: ["source-destination.test.js", "unreviewed extra test"] })),
    "skipped result": edited((ev) => { ev.find((e) => e.name === "H09-C1: synthetic").skip = true; }),
    "todo result": edited((ev) => { ev.find((e) => e.name === "H09-C1: synthetic").todo = "later"; }),
    "failed result": edited((ev) => { ev.find((e) => e.name === "H09-C1: synthetic").type = "test:fail"; }),
    "cancelled count": edited((ev) => { ev[ev.length - 1].counts.cancelled = 1; }),
    "nested result": edited((ev) => ev.splice(0, 0, { type: "test:pass", file: SOURCE, name: "H10-C1: synthetic", nesting: 1, detailsType: "test" })),
    "premature exit shape (file-level result, no per-file summary)": edited((ev) => {
      for (let i = ev.length - 1; i >= 0; i -= 1) if (isFile(ev[i], "trust-evidence.test.js")) ev.splice(i, 1);
      ev.splice(0, 0, { type: "test:pass", file: path.join(HARNESS_DIR, "trust-evidence.test.js"), name: path.join(HARNESS_DIR, "trust-evidence.test.js"), nesting: 0, detailsType: "test" });
    }),
    "missing ledger": edited((ev) => ev.splice(ev.findIndex((e) => isFile(e, "hostile-model-output.test.js") && e.type === "test:diagnostic"), 1)),
    "ledger missing a confirmation": edited((ev) => {
      const e = ev.find((x) => isFile(x, "hostile-model-output.test.js") && x.type === "test:diagnostic");
      const ledger = JSON.parse(e.message.slice(LEDGER_DIAGNOSTIC.length));
      ledger.confirmed = ledger.confirmed.filter((id) => id !== "H08-C4");
      e.message = LEDGER_DIAGNOSTIC + JSON.stringify(ledger);
    }),
    "ledger reports a selection filter": edited((ev) => {
      const e = ev.find((x) => isFile(x, "hostile-model-output.test.js") && x.type === "test:diagnostic");
      e.message = e.message.replace('"filters":[]', '"filters":["--test-skip-pattern=H09"]');
    }),
    "evidence file not launched": { ...good, files: good.files.filter((f) => path.basename(f) !== "source-destination.test.js") },
    "result from an unlaunched file": edited((ev) => ev.splice(0, 0, { type: "test:stdout", file: path.join(fx.REPO_ROOT, "elsewhere.test.js"), message: "x" })),
  };
  for (const [label, candidate] of Object.entries(invalid)) {
    const verdict = run.verifyEvidenceRun(candidate);
    assert.equal(verdict.accepted, false, `${label} must be rejected`);
    assert.ok(verdict.problems.length > 0, label);
  }
});

// --- runner-filter and recursion guards -----------------------------------------------

test("SEC-02 runner-filter guard: selection options in execArgv or NODE_OPTIONS are refused and never reach the child", () => {
  for (const flag of manifest.SELECTION_FLAGS) {
    assert.ok(manifest.selectionFilters({ execArgv: [`${flag}=x`] }).length > 0, `${flag}= in execArgv`);
    assert.ok(manifest.selectionFilters({ nodeOptions: `--max-old-space-size=64 ${flag} x` }).length > 0, `${flag} in NODE_OPTIONS`);
    assert.equal(run.runCompleteEvidence({ parentEnv: {}, parentExecArgv: [`${flag}=x`] }).refused, true, `${flag} refused before launch`);
    assert.equal(run.runCompleteEvidence({ parentEnv: { NODE_OPTIONS: `${flag}=x` }, parentExecArgv: [] }).refused, true, `${flag} via NODE_OPTIONS refused before launch`);
  }
  assert.deepEqual(manifest.selectionFilters({ execArgv: ["--enable-source-maps"], nodeOptions: "--max-old-space-size=64" }), []);

  const hostileParent = { NODE_OPTIONS: "--test-skip-pattern=H09", NODE_TEST_CONTEXT: "child-v8", AI_PROVIDER: "aisec7-probe-nonexistent", AI_MODEL: "x", AI_API_KEY: fx.DUMMY_TOKEN, GITHUB_TOKEN: fx.DUMMY_TOKEN, AISEC7_DUMMY_SECRET: fx.DUMMY_TOKEN, TEMP: "t", HOME: "h" };
  const env = run.childEnvironment(hostileParent);
  assert.deepEqual(Object.keys(env).sort(), ["AISEC7_EVIDENCE_CHILD", "HOME", "TEMP"], "only OS location variables and the child marker are inherited");
  assert.ok(!Object.values(env).includes(fx.DUMMY_TOKEN));
});

test("SEC-02 recursion guard: the outer verifier never launches itself and refuses to run inside an evidence child", () => {
  assert.ok(run.evidenceFilePaths().every((p) => path.basename(p) !== manifest.VERIFIER_FILE));
  assert.throws(() => run.launchEvidenceRun({ files: [__filename], env: run.childEnvironment({}) }), /refusing to launch itself/);
  assert.throws(() => run.launchEvidenceRun({ files: run.evidenceFilePaths(), env: {} }), /childEnvironment/);
  assert.throws(() => run.runCompleteEvidence({ parentEnv: { [run.CHILD_MARKER]: "1" }, parentExecArgv: [] }), /inside an evidence child/);
});

// --- supervised child runs ------------------------------------------------------------

test("SEC-02 NORMAL: a complete evidence child run is accepted with the exact manifest, counts and confirmations", (t) => {
  const result = run.runCompleteEvidence();
  t.diagnostic(`NORMAL ${brief(result)}`);
  assert.deepEqual(result.problems, []);
  assert.equal(result.accepted, true);
  assert.equal(result.run.status, 0);
  assert.equal(result.counts.tests, Y);
  assert.equal(result.counts.passed, Y);
  for (const file of manifest.EVIDENCE_FILES) {
    const seen = result.perFile.find((f) => f.file === file);
    assert.deepEqual([...seen.confirmed].sort(), [...manifest.requiredConfirmations(file)].sort(), `${file} confirmations`);
  }
  const confirmed = result.perFile.flatMap((f) => f.confirmed).sort();
  assert.deepEqual(confirmed, CASES.filter((c) => c.scope === SCOPES.CURRENT_BEHAVIOR).map((c) => c.id).sort(), "every current-behavior registry case was confirmed exactly once");
});

test("SEC-02 DIRECT_SKIP_PATTERN: --test-skip-pattern=H09 is invalid evidence", (t) => {
  assert.equal(run.runCompleteEvidence({ parentEnv: {}, parentExecArgv: ["--test-skip-pattern=H09"] }).refused, true, "refused before any launch");
  const result = launchAndVerify({ execArgv: ["--test-skip-pattern=H09"] });
  t.diagnostic(`DIRECT_SKIP_PATTERN ${brief(result)}`);
  assert.equal(result.accepted, false);
  assert.ok(has(result, /review-apply-execute\.test\.js: tests missing from the run: .*H09-C1/), "the five H09 cases are missing, not skipped");
  assert.ok(has(result, /review-apply-execute\.test\.js: ledger filters mismatch/), "the file ledger saw the filter");
});

test("SEC-02 NODE_OPTIONS_SKIP_PATTERN: NODE_OPTIONS=--test-skip-pattern=H09 is invalid evidence", (t) => {
  assert.equal(run.runCompleteEvidence({ parentEnv: { NODE_OPTIONS: "--test-skip-pattern=H09" }, parentExecArgv: [] }).refused, true, "refused before any launch");
  const result = launchAndVerify({ envOverrides: { NODE_OPTIONS: "--test-skip-pattern=H09" } });
  t.diagnostic(`NODE_OPTIONS_SKIP_PATTERN ${brief(result)}`);
  assert.equal(result.accepted, false);
  assert.ok(has(result, /review-apply-execute\.test\.js: tests missing from the run: .*H09-C1/));
  assert.ok(has(result, /ledger filters mismatch/));
});

test("SEC-02 NAME_PATTERN: --test-name-pattern is invalid evidence", (t) => {
  const result = launchAndVerify({ execArgv: ["--test-name-pattern=H0"] });
  t.diagnostic(`NAME_PATTERN ${brief(result)}`);
  assert.equal(result.accepted, false);
  assert.ok(has(result, /harness-invariants\.test\.js: tests missing from the run/));
  assert.ok(has(result, /ledger filters mismatch/));
});

test("SEC-02 TEST_ONLY: --test-only is invalid evidence", (t) => {
  const result = launchAndVerify({ execArgv: ["--test-only"] });
  t.diagnostic(`TEST_ONLY ${brief(result)}`);
  assert.equal(result.accepted, false);
  assert.ok(has(result, /tests missing from the run/));
  assert.ok(has(result, /ledger filters mismatch/));
});

test("SEC-02 WHOLE_FILE_REMOVAL: a run without one evidence file is invalid evidence", (t) => {
  const files = run.evidenceFilePaths().filter((p) => path.basename(p) !== "source-destination.test.js");
  const result = launchAndVerify({ files });
  t.diagnostic(`WHOLE_FILE_REMOVAL ${brief(result)}`);
  assert.equal(result.run.status, 0, "the reduced child itself exits 0");
  assert.equal(result.accepted, false);
  assert.ok(has(result, /source-destination\.test\.js: not launched/));
  assert.ok(has(result, new RegExp(`test results != expected ${Y}`)));
});

test("SEC-02 PROBE_CONTROL: an unmutated temporary copy is accepted, so the mutation probes are not vacuous", (t) => {
  const anchor = "const { result, calls } = await publish(() => new Response(null, { status: 302 }));";
  const copy = mutatedCopy("source-destination.test.js", anchor, anchor);
  const result = launchAndVerify({ files: withSubstitute("source-destination.test.js", copy) });
  t.diagnostic(`PROBE_CONTROL ${brief(result)}`);
  assert.deepEqual(result.problems, []);
  assert.equal(result.accepted, true);
});

test("SEC-02 NON_TRIAGE_EARLY_RETURN: a case returning before confirmCase() fails its file ledger and is invalid evidence", (t) => {
  const anchor = "const { result, calls } = await publish(() => new Response(null, { status: 302 }));";
  const copy = mutatedCopy("source-destination.test.js", anchor, `return;\n  ${anchor}`);
  const result = launchAndVerify({ files: withSubstitute("source-destination.test.js", copy) });
  t.diagnostic(`NON_TRIAGE_EARLY_RETURN ${brief(result)}`);
  assert.equal(result.accepted, false);
  assert.ok(has(result, /source-destination\.test\.js: ledger confirmed mismatch; missing H10-C3/), "the test 'passed' but its case was never confirmed");
  assert.ok(has(result, /cases not confirmed: H10-C3/), "the per-file ledger failed the file");
});

test("SEC-02 DYNAMIC_SKIP: a { skip: expression } registration is invalid evidence", (t) => {
  const anchor = 'test("H08-C4: an invented reference (MODIFY of a path absent from the bound context) is rejected", async () => {';
  const replacement = 'require("node:test")("H08-C4: an invented reference (MODIFY of a path absent from the bound context) is rejected", { skip: process.platform !== "" }, async () => {';
  const copy = mutatedCopy("hostile-model-output.test.js", anchor, replacement);
  const result = launchAndVerify({ files: withSubstitute("hostile-model-output.test.js", copy) });
  t.diagnostic(`DYNAMIC_SKIP ${brief(result)}`);
  assert.equal(result.accepted, false);
  assert.ok(has(result, /hostile-model-output\.test\.js: "H08-C4: .*" skipped/));
  assert.ok(has(result, /cases not confirmed: H08-C4/));
});

test("SEC-02 PREMATURE_EXIT_0: process.exit(0) inside an evidence file exits 0 but is invalid evidence", (t) => {
  const anchor = 'test("H11-C5: self-certification is refused - a determiner who is a contributor cannot act as SEPARATE_PERSON", () => {';
  const copy = mutatedCopy("trust-evidence.test.js", anchor, `${anchor}\n  process.exit(0);`);
  const result = launchAndVerify({ files: withSubstitute("trust-evidence.test.js", copy) });
  t.diagnostic(`PREMATURE_EXIT_0 ${brief(result)}`);
  assert.equal(result.run.status, 0, "the child process itself reports success");
  assert.equal(result.accepted, false, "exit 0 alone is never accepted");
  assert.ok(has(result, /trust-evidence\.test\.js: 0 per-file summaries/));
  assert.ok(has(result, /trust-evidence\.test\.js: 0 execution ledgers/));
});

test("SEC-02 SEC01_NON_MOCK_PROVIDER: AI_PROVIDER=aisec7-probe-nonexistent fails closed in the child and is invalid evidence", (t) => {
  const result = launchAndVerify({ envOverrides: { AI_PROVIDER: "aisec7-probe-nonexistent" } });
  t.diagnostic(`SEC01_NON_MOCK_PROVIDER ${brief(result)}`);
  assert.equal(result.accepted, false);
  assert.notEqual(result.run.status, 0, "the child fails");
  assert.ok(has(result, /triage-cross-project\.test\.js: "H05-C1 .*" failed: AISEC-7 evidence integrity \(SEC-01\)/), "guarded cases fail closed");
  assert.ok(!has(result, /" (?:skipped|todo)$/), "nothing skips");
  assert.equal(result.counts.skipped, 0);
});
