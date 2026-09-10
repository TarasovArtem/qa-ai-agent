"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  id,
  collect,
  loadReports,
  walkSuite,
  resolveScreenshotPath,
  extractFailedTests,
  summarizeTestResults,
  truncateText,
} = require("./adapters/cypress-adapter");
const { normalizeSpecPath } = require("./context-utils");
const { validateNormalizedFailure } = require("./normalized-failure");

const ROOT = path.resolve(__dirname, "..", "..");
// Roadmap FPI-2: extractFailedTests()/summarizeTestResults()/
// resolveScreenshotPath()/collect() no longer derive their own target
// repository root from this module's __dirname - every call site below
// now supplies an explicit `root: { lexicalRoot, realRoot }` boundary
// (see scripts/ai/repository-root.js), matching production's own
// collect-context.js wiring. This repository's own checkout is used as
// the fixture target repository throughout this file.
const TEST_ROOT = Object.freeze({ lexicalRoot: ROOT, realRoot: fs.realpathSync(ROOT) });
const CYPRESS_SCREENSHOTS_DIR = path.join(ROOT, "cypress", "screenshots");
// Roadmap FPI-2 Corrective C1 (FPI2-R-1): mochawesome's own `file` field
// is always a genuine absolute path from the real local test run - this
// fixture's placeholder value must therefore genuinely resolve inside
// TEST_ROOT too (a bare "/cypress/e2e/tests/x.cy.js"-style literal is
// treated as a real, but unrelated/out-of-root, absolute path since
// normalizeSpecPath() now requires actual segment-wise containment, never
// a leading-slash-only heuristic).
const FIXTURE_SPEC_FILE = path.join(ROOT, "cypress", "e2e", "tests", "x.cy.js");

// --- id ----------------------------------------------------------------

test("id: is exactly the stable lowercase 'cypress' identity", () => {
  assert.equal(id, "cypress");
});

// --- extractFailedTests (moved from collect-context.test.js, Roadmap #19.6B) --

test("extractFailedTests: walks nested suites and collects only failed tests", () => {
  const reports = [
    {
      results: [
        {
          file: FIXTURE_SPEC_FILE,
          suites: [
            {
              title: "Outer",
              suites: [
                {
                  title: "Inner",
                  suites: [],
                  tests: [
                    { title: "passes", state: "passed" },
                    {
                      title: "fails",
                      state: "failed",
                      duration: 42,
                      err: { message: "boom", estack: "boom\n  at x" },
                    },
                  ],
                },
              ],
              tests: [],
            },
          ],
        },
      ],
    },
  ];

  const failed = extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].title, "fails");
  assert.equal(failed[0].suite, "Outer > Inner");
  assert.equal(failed[0].specFile, "cypress/e2e/tests/x.cy.js");
  assert.equal(failed[0].duration, 42);
  assert.equal(failed[0].error.message, "boom");
  assert.equal(failed[0].error.stack, "boom\n  at x");
});

test("extractFailedTests: truncates a very long stack trace but never the error message itself", () => {
  const hugeStack = "at frame\n".repeat(2000); // well over MAX_STACK_CHARS
  const criticalMessage = "AssertionError: this exact sentence must survive untouched";
  const reports = [
    {
      results: [
        {
          file: FIXTURE_SPEC_FILE,
          suites: [
            {
              title: "Suite",
              suites: [],
              tests: [{ title: "fails", state: "failed", duration: 1, err: { message: criticalMessage, estack: hugeStack } }],
            },
          ],
        },
      ],
    },
  ];

  const [failed] = extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed.error.message, criticalMessage, "the message must never be truncated");
  assert.ok(failed.error.stack.length < hugeStack.length, "the stack must be truncated");
  assert.match(failed.error.stack, /truncated/);
});

// --- extractFailedTests: status semantics edge coverage (Roadmap #19.6B) --

test("extractFailedTests: recognizes the test.fail===true && !test.pending fallback, not just test.state==='failed'", () => {
  const reports = [
    {
      results: [
        {
          file: FIXTURE_SPEC_FILE,
          suites: [{ title: "Suite", suites: [], tests: [{ title: "fails via fail flag", fail: true, pending: false, err: { message: "m" } }] }],
        },
      ],
    },
  ];
  const failed = extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].title, "fails via fail flag");
});

test("extractFailedTests: a pending test is never classified as failed, even if fail===true", () => {
  const reports = [
    {
      results: [
        {
          file: FIXTURE_SPEC_FILE,
          suites: [
            {
              title: "Suite",
              suites: [],
              tests: [
                { title: "pending one", state: "pending" },
                { title: "pending with fail flag", fail: true, pending: true, err: { message: "m" } },
              ],
            },
          ],
        },
      ],
    },
  ];
  const failed = extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed.length, 0);
});

test("extractFailedTests: prefers err.estack, falls back to err.stack when estack is absent", () => {
  const reports = [
    {
      results: [
        {
          file: FIXTURE_SPEC_FILE,
          suites: [{ title: "Suite", suites: [], tests: [{ title: "fails", state: "failed", err: { message: "m", stack: "plain stack only" } }] }],
        },
      ],
    },
  ];
  const [failed] = extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed.error.stack, "plain stack only");
});

test("extractFailedTests: duration is null when absent or non-numeric", () => {
  const reports = [
    {
      results: [
        {
          file: FIXTURE_SPEC_FILE,
          suites: [{ title: "Suite", suites: [], tests: [{ title: "fails", state: "failed", err: { message: "m" } }] }],
        },
      ],
    },
  ];
  const [failed] = extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed.duration, null);
});

test("extractFailedTests: aggregates failures across multiple report objects", () => {
  const reports = [
    { results: [{ file: path.join(ROOT, "a.cy.js"), suites: [{ title: "S", suites: [], tests: [{ title: "t1", state: "failed", err: { message: "m1" } }] }] }] },
    { results: [{ file: path.join(ROOT, "b.cy.js"), suites: [{ title: "S", suites: [], tests: [{ title: "t2", state: "failed", err: { message: "m2" } }] }] }] },
  ];
  const failed = extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed.length, 2);
  assert.deepEqual(failed.map((f) => f.specFile).sort(), ["a.cy.js", "b.cy.js"]);
});

test("extractFailedTests: every emitted failure satisfies validateNormalizedFailure()", () => {
  const reports = [
    {
      results: [
        {
          file: FIXTURE_SPEC_FILE,
          suites: [
            {
              title: "Suite",
              suites: [],
              tests: [
                { title: "fails", state: "failed", duration: 5, err: { message: "m", estack: "s" } },
                { title: "fails via fallback", fail: true, pending: false, err: { message: "m2" } },
              ],
            },
          ],
        },
      ],
    },
  ];
  const failed = extractFailedTests(reports, undefined, TEST_ROOT);
  assert.equal(failed.length, 2);
  for (const failure of failed) {
    const result = validateNormalizedFailure(failure);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  }
});

// --- summarizeTestResults (moved from collect-context.test.js) ---------

test("summarizeTestResults: aggregates totals across multiple spec reports", () => {
  const reports = [
    { stats: { tests: 3, passes: 2, failures: 1, pending: 0, duration: 100 }, results: [{ file: "/a.cy.js", suites: [] }] },
    { stats: { tests: 2, passes: 2, failures: 0, pending: 0, duration: 50 }, results: [{ file: "/b.cy.js", suites: [] }] },
  ];
  const summary = summarizeTestResults(reports, TEST_ROOT);
  assert.equal(summary.found, true);
  assert.deepEqual(summary.totals, { tests: 5, passed: 4, failed: 1, pending: 0, duration: 150 });
  assert.equal(summary.specs.length, 2);
});

// --- resolveScreenshotPath (moved from collect-context.test.js) --------

test("resolveScreenshotPath: matches only the exact '(failed)' filename, never a same-prefix guess", (t) => {
  const specDir = path.join(ROOT, "cypress", "screenshots", "fixture.cy.js");
  fs.mkdirSync(specDir, { recursive: true });
  // Roadmap #19.7H-B: resolveScreenshotPath() only ever reads its own
  // spec-named subdirectory (see the adapter's own implementation), never
  // sibling content - so cleanup is scoped to exactly this test's own
  // "fixture.cy.js" subdirectory, never the shared cypress/screenshots/
  // parent, which other concurrently-running test files (e.g.
  // cypress-equivalence.test.js's s1_mixed.cy.js/s5_screens.cy.js) may be
  // using at the same time.
  t.after(() => fs.rmSync(specDir, { recursive: true, force: true }));

  // A screenshot for an unrelated test whose title happens to start the
  // same way as ours - must never be picked up by a loose prefix match.
  fs.writeFileSync(path.join(specDir, "Suite -- my test extra long title (failed).png"), "");
  fs.writeFileSync(path.join(specDir, "Suite -- my test.png"), ""); // no (failed) suffix - not our test's failure shot

  const noMatch = resolveScreenshotPath("cypress/e2e/tests/fixture.cy.js", ["Suite"], "my test", CYPRESS_SCREENSHOTS_DIR, TEST_ROOT);
  assert.equal(noMatch, null, "must not match on prefix alone or a non-failed screenshot");

  fs.writeFileSync(path.join(specDir, "Suite -- my test (failed).png"), "");
  const match = resolveScreenshotPath("cypress/e2e/tests/fixture.cy.js", ["Suite"], "my test", CYPRESS_SCREENSHOTS_DIR, TEST_ROOT);
  assert.equal(match, "cypress/screenshots/fixture.cy.js/Suite -- my test (failed).png");
});

test("resolveScreenshotPath: with multiple attempts, picks the highest-numbered one", (t) => {
  const specDir = path.join(ROOT, "cypress", "screenshots", "fixture2.cy.js");
  fs.mkdirSync(specDir, { recursive: true });
  // Roadmap #19.7H-B: same scoped-cleanup reasoning as the test above -
  // this test owns only its own "fixture2.cy.js" subdirectory.
  t.after(() => fs.rmSync(specDir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(specDir, "Suite -- flaky test (failed) (1).png"), "");
  fs.writeFileSync(path.join(specDir, "Suite -- flaky test (failed) (2).png"), "");

  const match = resolveScreenshotPath("cypress/e2e/tests/fixture2.cy.js", ["Suite"], "flaky test", CYPRESS_SCREENSHOTS_DIR, TEST_ROOT);
  assert.equal(match, "cypress/screenshots/fixture2.cy.js/Suite -- flaky test (failed) (2).png");
});

test("resolveScreenshotPath: returns null when the spec's screenshot directory doesn't exist", () => {
  assert.equal(resolveScreenshotPath("cypress/e2e/tests/never_ran.cy.js", ["Suite"], "test", CYPRESS_SCREENSHOTS_DIR, TEST_ROOT), null);
});

test("resolveScreenshotPath: an overridden screenshotsDir is honored without touching the real cypress/screenshots directory", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-screenshots-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  const specDir = path.join(tmpRoot, "isolated.cy.js");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, "Suite -- isolated test (failed).png"), "");

  const match = resolveScreenshotPath("cypress/e2e/tests/isolated.cy.js", ["Suite"], "isolated test", tmpRoot, TEST_ROOT);
  assert.equal(match, normalizeSpecPath(path.join(specDir, "Suite -- isolated test (failed).png"), TEST_ROOT));
});

// --- loadReports (moved from collect-context.test.js) ------------------

// Roadmap #19.7H-B: unlike resolveScreenshotPath (scoped to one spec
// subdirectory), loadReports(reportsDir) reads its ENTIRE directory's
// contents as one atomic unit - two test files both exercising the real
// canonical reports/cypress default (this one, and collect-context.test.js's
// own real-path main() tests, which already document themselves as the
// sole intended owner of that exact pattern) cannot safely share it, no
// matter how uniquely either names its own fixture files, because
// loadReports() would see the OTHER file's fixtures too. The warning-text
// algorithm under test here is identical regardless of which directory is
// passed in, so these two tests use an isolated temp root via the
// existing `reportsDir` override - collect-context.test.js remains the
// sole test file that exercises the literal default-parameter/real-path
// wiring end to end.
test("loadReports: reports a clear warning and returns no reports when reports/cypress is missing", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-reports-missing-"));
  fs.rmSync(tmpRoot, { recursive: true, force: true }); // directory itself must not exist
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const { reports, warnings } = loadReports(tmpRoot);
  assert.equal(reports.length, 0);
  assert.ok(warnings.some((w) => w.includes("No report directory")));
});

test("loadReports: skips an unparseable JSON file with a warning instead of throwing", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-reports-broken-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "broken.json"), "{ not json");

  const { reports, warnings } = loadReports(tmpRoot);
  assert.equal(reports.length, 0);
  assert.ok(warnings.some((w) => w.includes("Could not parse")));
});

test("loadReports: an isolated reportsDir with no JSON files warns and returns no reports", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-reports-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "notes.txt"), "not a report");

  const { reports, warnings } = loadReports(tmpRoot);
  assert.equal(reports.length, 0);
  assert.ok(warnings.some((w) => w.includes("contains no JSON report files")));
});

test("loadReports: an isolated reportsDir reads every JSON file when no merged report.json is present", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-reports-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "a.json"), JSON.stringify({ stats: { tests: 1 }, results: [] }));
  fs.writeFileSync(path.join(tmpRoot, "b.json"), JSON.stringify({ stats: { tests: 2 }, results: [] }));

  const { reports, warnings } = loadReports(tmpRoot);
  assert.equal(reports.length, 2);
  assert.deepEqual(warnings, []);
});

test("loadReports: prefers a single merged report.json over per-spec files when present", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-reports-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "per-spec.json"), JSON.stringify({ stats: { tests: 1 }, results: [] }));
  fs.writeFileSync(path.join(tmpRoot, "report.json"), JSON.stringify({ stats: { tests: 99 }, results: [] }));

  const { reports } = loadReports(tmpRoot);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].stats.tests, 99);
});

// --- collect() (Roadmap #19.6B new thin sequencing entrypoint) ---------

test("collect: with no reports directory returns found:false testResults, empty failedTests, and the discovery warning", (t) => {
  // Roadmap FPI-2 Corrective C1 (FPI2-R-2): reportsDir is a location hint
  // INSIDE the trusted repository, never an independent filesystem
  // authority - this isolated fixture path is therefore created (and
  // then deleted, to prove the "missing directory" path) underneath
  // TEST_ROOT itself, not an unrelated OS-temp directory.
  const tmpRoot = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "cypress-adapter-collect-"));
  fs.rmSync(tmpRoot, { recursive: true, force: true }); // directory itself must not exist
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const result = collect({ root: TEST_ROOT, reportsDir: tmpRoot });
  assert.deepEqual(result.testResults, { found: false });
  assert.deepEqual(result.failedTests, []);
  assert.ok(result.warnings.some((w) => w.includes("No report directory")));
});

test("collect: with a real report, returns testResults/failedTests/warnings derived from it", (t) => {
  // Roadmap FPI-2 Corrective C1 (FPI2-R-2): both overrides must resolve
  // inside TEST_ROOT - isolated fixture directories under
  // reports/ai/ preserve this test's original isolation intent
  // (never touching the real reports/cypress directory) without using an
  // unrelated OS-temp location.
  const tmpReportsDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "cypress-adapter-collect-reports-"));
  const tmpScreenshotsDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "cypress-adapter-collect-screens-"));
  t.after(() => {
    fs.rmSync(tmpReportsDir, { recursive: true, force: true });
    fs.rmSync(tmpScreenshotsDir, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(tmpReportsDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 10 },
      results: [
        {
          file: FIXTURE_SPEC_FILE,
          suites: [{ title: "Suite", suites: [], tests: [{ title: "fails", state: "failed", duration: 10, err: { message: "m", estack: "s" } }] }],
        },
      ],
    })
  );

  const result = collect({ root: TEST_ROOT, reportsDir: tmpReportsDir, screenshotsDir: tmpScreenshotsDir });
  assert.equal(result.testResults.found, true);
  assert.equal(result.testResults.totals.failed, 1);
  assert.equal(result.failedTests.length, 1);
  assert.equal(result.failedTests[0].title, "fails");
  assert.equal(result.failedTests[0].screenshot, null, "no screenshot exists in the isolated screenshotsDir");
  assert.deepEqual(result.warnings, []);
});

// --- walkSuite / truncateText: exercised indirectly above via ----------
// --- extractFailedTests(), matching this repo's existing convention of --
// --- not testing the internal generator/helper separately from its ------
// --- only caller (see collect-context.test.js pre-#19.6B - walkSuite was --
// --- never tested directly either). --------------------------------------
test("truncateText: leaves short text untouched", () => {
  assert.equal(truncateText("short", 100), "short");
});

test("truncateText: caps long text with a visible marker", () => {
  const long = "x".repeat(200);
  const result = truncateText(long, 50);
  assert.equal(result.startsWith("x".repeat(50)), true);
  assert.match(result, /truncated/);
  assert.ok(result.length < long.length);
});

test("truncateText: passes through non-string input unchanged (e.g. null)", () => {
  assert.equal(truncateText(null, 50), null);
});

test("walkSuite: yields nothing for a null/undefined suite", () => {
  assert.deepEqual([...walkSuite(null, [])], []);
});

// =========================================================================
// Roadmap FPI-2 Corrective C1 (independent adversarial review of PR #123,
// findings FPI2-R-1/FPI2-R-2) - adapter-level override containment and
// symlink-escape closure.
// =========================================================================

test("FPI2-R-2: collect() rejects an out-of-root reportsDir override with a bounded ADAPTER_PATH_OUTSIDE_REPOSITORY error, never enumerating it", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-c1-outside-reports-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(outsideDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 1 },
      results: [{ file: "/outside/OUTSIDE_ROOT_MARKER.cy.js", suites: [{ title: "S", suites: [], tests: [{ title: "OUTSIDE_ROOT_EVIDENCE_MARKER", state: "failed", err: { message: "m" } }] }] }],
    })
  );

  assert.throws(() => collect({ root: TEST_ROOT, reportsDir: outsideDir }), /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
});

test("FPI2-R-2: collect() rejects an out-of-root screenshotsDir override the same way", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-c1-outside-shots-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  assert.throws(() => collect({ root: TEST_ROOT, screenshotsDir: outsideDir }), /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
});

test("FPI2-R-2/#24: loadReports rejects an individually-discovered report file that is a symlink escaping the repository, even when reportsDir itself is safe", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-c1-symreport-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const secretReport = path.join(outsideDir, "secret-report.json");
  fs.writeFileSync(secretReport, JSON.stringify({ stats: {}, results: [{ file: "x", suites: [{ title: "S", suites: [], tests: [{ title: "SYMLINK_ESCAPE_MARKER", state: "failed" }] }] }] }));

  const insideReportsDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "cypress-adapter-c1-symreport-inside-"));
  t.after(() => fs.rmSync(insideReportsDir, { recursive: true, force: true }));

  let symlinkSupported = true;
  try {
    fs.symlinkSync(secretReport, path.join(insideReportsDir, "report.json"), "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const { reports, warnings } = loadReports(insideReportsDir, TEST_ROOT);
  assert.deepEqual(reports, []);
  assert.ok(warnings.some((w) => w.includes("escapes the repository boundary")));
});

test("FPI2-R-2/#25: resolveScreenshotPath rejects a discovered screenshot that is a symlink escaping the repository, never surfacing a raw absolute path", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-c1-symshot-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const secretShot = path.join(outsideDir, "secret.png");
  fs.writeFileSync(secretShot, "OUTSIDE_SCREENSHOT_BYTES");

  const insideShotsDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "cypress-adapter-c1-symshot-inside-"));
  t.after(() => fs.rmSync(insideShotsDir, { recursive: true, force: true }));
  const specDir = path.join(insideShotsDir, "spec.cy.js");
  fs.mkdirSync(specDir);

  let symlinkSupported = true;
  try {
    fs.symlinkSync(secretShot, path.join(specDir, "Suite -- test (failed).png"), "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const result = resolveScreenshotPath("spec.cy.js", ["Suite"], "test", insideShotsDir, TEST_ROOT);
  assert.equal(result, null);
});

test("FPI2-R-2: a relative reportsDir override still works correctly (safe overrides inside the repository are not broken by the new containment check)", (t) => {
  const relativeDirName = "cypress-adapter-c1-relative-reports";
  const absoluteDir = path.join(ROOT, relativeDirName);
  fs.mkdirSync(absoluteDir, { recursive: true });
  t.after(() => fs.rmSync(absoluteDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(absoluteDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 1 },
      results: [{ file: FIXTURE_SPEC_FILE, suites: [{ title: "S", suites: [], tests: [{ title: "IN_ROOT_RELATIVE_OVERRIDE", state: "failed", err: { message: "m" } }] }] }],
    })
  );

  const result = collect({ root: TEST_ROOT, reportsDir: relativeDirName });
  assert.equal(result.failedTests.length, 1);
  assert.equal(result.failedTests[0].title, "IN_ROOT_RELATIVE_OVERRIDE");
});

// =========================================================================
// Roadmap FPI-2 Corrective C2 (independent adversarial review of PR #123,
// finding FPI2-R-6) - the DEFAULT reportsDir/screenshotsDir conventions
// must be proven repository-local BEFORE any filesystem enumeration, the
// same way an explicit override already is.
// =========================================================================

function makeTargetRepoC2(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, root: { lexicalRoot: dir, realRoot: fs.realpathSync(dir) } };
}

test("FPI2-R-6: a symlinked DEFAULT reports/cypress directory is rejected BEFORE any outside enumeration - no filename leak", (t) => {
  const { dir: target, root } = makeTargetRepoC2("cypress-adapter-c2-r6-reports-target-");
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-c2-r6-reports-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(outsideDir, "PRIVATE_OUTSIDE_FILENAME_R6.json"),
    JSON.stringify({ stats: {}, results: [{ file: "x", suites: [{ title: "S", suites: [], tests: [{ title: "SHOULD_NOT_LEAK", state: "failed" }] }] }] })
  );

  fs.mkdirSync(path.join(target, "reports"), { recursive: true });
  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideDir, path.join(target, "reports", "cypress"), "dir");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const originalReaddirSync = fs.readdirSync;
  const enumerated = [];
  fs.readdirSync = (p, ...args) => {
    enumerated.push(p);
    return originalReaddirSync.call(fs, p, ...args);
  };
  let threw = false;
  let thrownMessage = null;
  try {
    collect({ root });
  } catch (err) {
    threw = true;
    thrownMessage = err.message;
  } finally {
    fs.readdirSync = originalReaddirSync;
  }

  assert.equal(threw, true, "collect() must reject a symlinked default reportsDir");
  assert.match(thrownMessage, /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
  assert.equal(
    enumerated.some((p) => path.resolve(p) === path.resolve(path.join(target, "reports", "cypress"))),
    false,
    "the outside directory must never have been enumerated (readdirSync) at all"
  );
  assert.equal(thrownMessage.includes("PRIVATE_OUTSIDE_FILENAME_R6"), false, "the outside filename must never appear in the thrown error");
});

test("FPI2-R-6: a symlinked DEFAULT cypress/screenshots directory is rejected BEFORE any outside enumeration", (t) => {
  const { dir: target, root } = makeTargetRepoC2("cypress-adapter-c2-r6-shots-target-");
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const outsideShots = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-adapter-c2-r6-shots-outside-"));
  t.after(() => fs.rmSync(outsideShots, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, "cypress"), { recursive: true });
  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideShots, path.join(target, "cypress", "screenshots"), "dir");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const originalReaddirSync = fs.readdirSync;
  const enumerated = [];
  fs.readdirSync = (p, ...args) => {
    enumerated.push(p);
    return originalReaddirSync.call(fs, p, ...args);
  };
  let threw = false;
  try {
    collect({ root });
  } catch (err) {
    threw = true;
    assert.match(err.message, /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }

  assert.equal(threw, true, "collect() must reject a symlinked default screenshotsDir");
  assert.equal(
    enumerated.some((p) => path.resolve(p).startsWith(path.resolve(path.join(target, "cypress", "screenshots")))),
    false,
    "the outside screenshots directory must never have been enumerated at all"
  );
});

test("FPI2-R-6: a safe in-root symlinked default reports/cypress directory (pointing elsewhere inside the SAME repository) remains functional", (t) => {
  const { dir: target, root } = makeTargetRepoC2("cypress-adapter-c2-r6-safe-symlink-");
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const realInternalDir = path.join(target, "internal", "cypress-reports");
  fs.mkdirSync(realInternalDir, { recursive: true });
  fs.writeFileSync(
    path.join(realInternalDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 1 },
      results: [{ file: path.join(target, "cypress", "e2e", "x.cy.js"), suites: [{ title: "S", suites: [], tests: [{ title: "SAFE_IN_ROOT_SYMLINK", state: "failed", err: { message: "m" } }] }] }],
    })
  );
  fs.mkdirSync(path.join(target, "reports"), { recursive: true });
  let symlinkSupported = true;
  try {
    fs.symlinkSync(realInternalDir, path.join(target, "reports", "cypress"), "dir");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const result = collect({ root });
  assert.equal(result.failedTests.length, 1);
  assert.equal(result.failedTests[0].title, "SAFE_IN_ROOT_SYMLINK");
});

test("FPI2-R-6: an absent default reports/cypress directory still yields the existing graceful found:false + bounded warning, never a throw", (t) => {
  const { dir: target, root } = makeTargetRepoC2("cypress-adapter-c2-r6-absent-");
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = collect({ root });
  assert.deepEqual(result.testResults, { found: false });
  assert.deepEqual(result.failedTests, []);
  assert.ok(result.warnings.some((w) => w.includes("No report directory")));
});

test("FPI2-R-6: an absent default cypress/screenshots directory still yields screenshot:null, never a throw", (t) => {
  const { dir: target, root } = makeTargetRepoC2("cypress-adapter-c2-r6-absent-shots-");
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const reportsDir = path.join(target, "reports", "cypress");
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 1 },
      results: [{ file: path.join(target, "cypress", "e2e", "x.cy.js"), suites: [{ title: "S", suites: [], tests: [{ title: "t", state: "failed", err: { message: "m" } }] }] }],
    })
  );

  const result = collect({ root });
  assert.equal(result.failedTests[0].screenshot, null);
});

test("FPI2-R-6: ordinary (non-symlinked) default reportsDir/screenshotsDir continue to work exactly as before", (t) => {
  const { dir: target, root } = makeTargetRepoC2("cypress-adapter-c2-r6-ordinary-");
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  fs.mkdirSync(path.join(target, "reports", "cypress"), { recursive: true });
  fs.mkdirSync(path.join(target, "cypress", "screenshots", "ordinary.cy.js"), { recursive: true });
  fs.writeFileSync(path.join(target, "cypress", "screenshots", "ordinary.cy.js", "Suite -- t (failed).png"), "");
  fs.writeFileSync(
    path.join(target, "reports", "cypress", "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 1 },
      results: [{ file: path.join(target, "cypress", "e2e", "ordinary.cy.js"), suites: [{ title: "Suite", suites: [], tests: [{ title: "t", state: "failed", err: { message: "m" } }] }] }],
    })
  );

  const result = collect({ root });
  assert.equal(result.failedTests[0].title, "t");
  assert.equal(result.failedTests[0].screenshot, "cypress/screenshots/ordinary.cy.js/Suite -- t (failed).png");
});
