"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  id,
  collect,
  loadReport,
  walkReportSuites,
  classifyTestStatus,
  selectPrimaryResult,
  summarizeTestResults,
  extractFailedTests,
  DEFAULT_REPORT_FILE,
} = require("./adapters/playwright-adapter");
const { normalizeSpecPath, resolveSafeLocalAttachmentPath } = require("./context-utils");
const { validateNormalizedFailure } = require("./normalized-failure");

const ROOT = path.resolve(__dirname, "..", "..");

// --- fixture builders (official JSON-reporter-shaped, Roadmap #19.8B) -----
// Modeled from Playwright's documented JSONReport*/attachment fields (see
// playwright-adapter.js's module docstring for the exact compatibility
// caveat) - inline literals, matching this repository's existing
// convention (cypress-adapter.test.js/cypress-equivalence.test.js also
// build fixtures as inline JS objects, never external fixture files).

function report({ suites = [], errors = [] } = {}) {
  return { config: {}, suites, errors, stats: {} };
}

function fileSuite({ title, file, specs = [], suites = [] }) {
  return { title, file, line: 1, column: 1, specs, suites };
}

function describeSuite({ title, file = null, specs = [], suites = [] }) {
  return { title, file, specs, suites };
}

function spec({ title, file, tests }) {
  return { title, ok: tests.every((t) => t.status !== "unexpected"), tags: [], id: `id-${title}`, file, line: 1, column: 1, tests };
}

function logicalTest({ status, expectedStatus = "passed", projectId, projectName, results = [] }) {
  const t = { timeout: 30000, annotations: [], expectedStatus, status, results };
  if (projectId) t.projectId = projectId;
  if (projectName) t.projectName = projectName;
  return t;
}

function result({ status, duration = 0, error, errors, attachments = [], retry = 0 }) {
  const r = {
    workerIndex: 0,
    parallelIndex: 0,
    status,
    duration,
    retry,
    steps: [],
    startTime: "2026-01-01T00:00:00.000Z",
    annotations: [],
    attachments,
  };
  if (error) r.error = error;
  if (errors) r.errors = errors;
  return r;
}

function writeReportFixture(t, reportObj) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-report-"));
  const reportFile = path.join(tmpDir, "report.json");
  fs.writeFileSync(reportFile, JSON.stringify(reportObj));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  return reportFile;
}

// Roadmap #21D: a race-safe, canonically-in-repository temp workspace for
// attachment-locality tests - reports/ai/ already exists and is gitignored
// (see .gitignore), so this reuses that existing convention rather than
// introducing a new one. Only the report JSON itself may live outside the
// repository (writeReportFixture() above) - report *content* is never
// subject to the attachment-locality boundary, only attachment/screenshot
// *paths named inside* that content are. Always cleaned up via t.after().
function mkdtempInRepo(t, prefix) {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", prefix));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  return tmpDir;
}

// --- id --------------------------------------------------------------------

test("id: is exactly the stable lowercase 'playwright' identity", () => {
  assert.equal(id, "playwright");
});

test("DEFAULT_REPORT_FILE: points at the canonical reports/playwright/report.json path", () => {
  assert.equal(DEFAULT_REPORT_FILE, path.join(ROOT, "reports", "playwright", "report.json"));
});

// --- classifyTestStatus (pure) ----------------------------------------------

test("classifyTestStatus: expected and flaky both map to passed", () => {
  assert.equal(classifyTestStatus("expected"), "passed");
  assert.equal(classifyTestStatus("flaky"), "passed");
});

test("classifyTestStatus: unexpected maps to failed", () => {
  assert.equal(classifyTestStatus("unexpected"), "failed");
});

test("classifyTestStatus: skipped maps to pending", () => {
  assert.equal(classifyTestStatus("skipped"), "pending");
});

test("classifyTestStatus: an unrecognized value maps to unknown, never silently to failed", () => {
  assert.equal(classifyTestStatus("something-else"), "unknown");
  assert.equal(classifyTestStatus(undefined), "unknown");
});

// --- selectPrimaryResult (pure) ---------------------------------------------

test("selectPrimaryResult: returns the LAST result, not the first, when multiple attempts exist", () => {
  const t = logicalTest({
    status: "flaky",
    results: [result({ status: "failed", duration: 1 }), result({ status: "passed", duration: 2 })],
  });
  assert.equal(selectPrimaryResult(t).duration, 2);
});

test("selectPrimaryResult: returns null when results is empty", () => {
  assert.equal(selectPrimaryResult(logicalTest({ status: "unexpected", results: [] })), null);
});

// --- P1: single expected/pass -----------------------------------------------

test("P1 single expected/pass: not in failedTests, counted as passed", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p1.spec.ts",
          file: "tests/p1.spec.ts",
          specs: [
            spec({
              title: "loads the homepage",
              file: "tests/p1.spec.ts",
              tests: [logicalTest({ status: "expected", results: [result({ status: "passed", duration: 120 })] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.deepEqual(out.failedTests, []);
  assert.equal(out.testResults.found, true);
  assert.deepEqual(out.testResults.totals, { tests: 1, passed: 1, failed: 0, pending: 0, duration: 120 });
  assert.deepEqual(out.warnings, []);
});

// --- P2: single unexpected/failure ------------------------------------------

test("P2 single unexpected/failure: exactly one failedTests entry with error/duration from the result", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p2.spec.ts",
          file: "tests/p2.spec.ts",
          specs: [
            spec({
              title: "renders results",
              file: "tests/p2.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  expectedStatus: "passed",
                  results: [
                    result({
                      status: "failed",
                      duration: 340,
                      error: { message: "Timed out waiting for selector", stack: "Error: Timed out\n  at x" },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests.length, 1);
  const [f] = out.failedTests;
  assert.equal(f.title, "renders results");
  assert.equal(f.fullTitle, "renders results");
  assert.equal(f.specFile, "tests/p2.spec.ts");
  assert.equal(f.duration, 340);
  assert.deepEqual(f.error, { message: "Timed out waiting for selector", stack: "Error: Timed out\n  at x" });
  assert.equal(f.screenshot, null);
  assert.deepEqual(validateNormalizedFailure(f).errors, []);
});

// --- P3: nested suites / fullTitle -------------------------------------------

test("P3 nested suites: fullTitle joins describe ancestry (excluding the top-level file suite) with ' > '", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p3.spec.ts",
          file: "tests/p3.spec.ts",
          suites: [
            describeSuite({
              title: "Results page",
              specs: [
                spec({
                  title: "shows results",
                  file: "tests/p3.spec.ts",
                  tests: [logicalTest({ status: "unexpected", results: [result({ status: "failed", duration: 10 })] })],
                }),
              ],
              suites: [
                describeSuite({
                  title: "Filters",
                  specs: [
                    spec({
                      title: "applies a filter",
                      file: "tests/p3.spec.ts",
                      tests: [logicalTest({ status: "unexpected", results: [result({ status: "failed", duration: 11 })] })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests.length, 2);
  assert.equal(out.failedTests[0].fullTitle, "Results page > shows results");
  assert.equal(out.failedTests[0].suite, "Results page");
  assert.equal(out.failedTests[1].fullTitle, "Results page > Filters > applies a filter");
  assert.equal(out.failedTests[1].suite, "Results page > Filters");
});

// --- P4: mixed expected/unexpected -------------------------------------------

test("P4 mixed pass/fail: totals split correctly, failedTests contains only the unexpected one", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p4.spec.ts",
          file: "tests/p4.spec.ts",
          specs: [
            spec({
              title: "a passes",
              file: "tests/p4.spec.ts",
              tests: [logicalTest({ status: "expected", results: [result({ status: "passed", duration: 5 })] })],
            }),
            spec({
              title: "b fails",
              file: "tests/p4.spec.ts",
              tests: [logicalTest({ status: "unexpected", results: [result({ status: "failed", duration: 6 })] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.deepEqual(out.testResults.totals, { tests: 2, passed: 1, failed: 1, pending: 0, duration: 11 });
  assert.equal(out.failedTests.length, 1);
  assert.equal(out.failedTests[0].title, "b fails");
});

// --- P5: skipped ---------------------------------------------------------------

test("P5 skipped: counted as pending, never in failedTests", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p5.spec.ts",
          file: "tests/p5.spec.ts",
          specs: [
            spec({
              title: "not run on this project",
              file: "tests/p5.spec.ts",
              tests: [logicalTest({ status: "skipped", expectedStatus: "skipped", results: [] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.deepEqual(out.testResults.totals, { tests: 1, passed: 0, failed: 0, pending: 1, duration: 0 });
  assert.deepEqual(out.failedTests, []);
});

// --- P6: duration is milliseconds, passed through unmodified -----------------

test("P6 duration: passed through unchanged (ms), and totals sum per-spec exactly", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p6.spec.ts",
          file: "tests/p6.spec.ts",
          specs: [
            spec({
              title: "a",
              file: "tests/p6.spec.ts",
              tests: [logicalTest({ status: "expected", results: [result({ status: "passed", duration: 1234 })] })],
            }),
            spec({
              title: "b",
              file: "tests/p6.spec.ts",
              tests: [logicalTest({ status: "unexpected", results: [result({ status: "failed", duration: 4567 })] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].duration, 4567);
  assert.equal(out.testResults.totals.duration, 1234 + 4567);
  assert.deepEqual(out.testResults.specs, [{ specFile: "tests/p6.spec.ts", tests: 2, passed: 1, failed: 1, pending: 0, duration: 5801 }]);
});

// --- P7: single screenshot attachment -----------------------------------------

test("P7 single screenshot attachment: normalized repo-relative path returned when the file canonically exists inside the repository (Roadmap #21D)", (t) => {
  const tmpDir = mkdtempInRepo(t, "playwright-adapter-screenshot-");
  const screenshotPath = path.join(tmpDir, "shot.png");
  fs.writeFileSync(screenshotPath, "");

  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p7.spec.ts",
          file: "tests/p7.spec.ts",
          specs: [
            spec({
              title: "fails with a screenshot",
              file: "tests/p7.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [
                    result({
                      status: "failed",
                      duration: 10,
                      attachments: [{ name: "screenshot", contentType: "image/png", path: screenshotPath }],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  const expected = resolveSafeLocalAttachmentPath(screenshotPath);
  assert.equal(expected.value !== null, true, "sanity: the in-repo fixture file itself must resolve to a safe value");
  assert.equal(out.failedTests[0].screenshot, expected.value);
  assert.equal(path.isAbsolute(out.failedTests[0].screenshot), false, "an accepted screenshot value must never be absolute");
});

// --- P8: multiple attachments, deterministic screenshot selection ------------

test("P8 multiple attachments: only name==='screenshot' qualifies, and the LAST such attachment wins deterministically", (t) => {
  const tmpDir = mkdtempInRepo(t, "playwright-adapter-attachments-");
  const shotA = path.join(tmpDir, "a.png");
  const shotB = path.join(tmpDir, "b.png");
  fs.writeFileSync(shotA, "");
  fs.writeFileSync(shotB, "");

  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p8.spec.ts",
          file: "tests/p8.spec.ts",
          specs: [
            spec({
              title: "fails with several attachments",
              file: "tests/p8.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [
                    result({
                      status: "failed",
                      duration: 10,
                      attachments: [
                        { name: "video", contentType: "video/webm", path: path.join(tmpDir, "v.webm") },
                        { name: "screenshot", contentType: "image/png", path: shotA },
                        { name: "trace", contentType: "application/zip", path: path.join(tmpDir, "trace.zip") },
                        { name: "screenshot", contentType: "image/png", path: shotB },
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].screenshot, resolveSafeLocalAttachmentPath(shotB).value);
});

// --- P9: screenshot metadata without a usable path ----------------------------

test("P9 screenshot metadata without a usable path: null + warning, never a fabricated path", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p9.spec.ts",
          file: "tests/p9.spec.ts",
          specs: [
            spec({
              title: "fails with a body-only screenshot",
              file: "tests/p9.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [
                    result({
                      status: "failed",
                      duration: 10,
                      attachments: [{ name: "screenshot", contentType: "image/png", body: "base64==" }],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].screenshot, null);
  assert.ok(out.warnings.some((w) => w.includes("no usable path")));
});

test("P9b screenshot path that does not exist on disk: null + warning, path itself never leaked into the warning", (t) => {
  const missingPath = path.join(os.tmpdir(), "playwright-adapter-does-not-exist", "shot.png");

  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p9b.spec.ts",
          file: "tests/p9b.spec.ts",
          specs: [
            spec({
              title: "fails with a stale screenshot path",
              file: "tests/p9b.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [result({ status: "failed", duration: 10, attachments: [{ name: "screenshot", contentType: "image/png", path: missingPath }] })],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].screenshot, null);
  assert.ok(out.warnings.some((w) => w.includes("does not exist on disk")));
  assert.ok(!out.warnings.some((w) => w.includes(missingPath)), "the absolute temp path must never appear in a warning string");
});

// --- P10: malformed JSON --------------------------------------------------------

test("P10 malformed JSON: found:false, empty failedTests, one deterministic warning, never throws", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-report-"));
  const reportFile = path.join(tmpDir, "report.json");
  fs.writeFileSync(reportFile, "{ not valid json");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const out = collect({ reportFile });
  assert.deepEqual(out.testResults, { found: false });
  assert.deepEqual(out.failedTests, []);
  assert.ok(out.warnings.some((w) => w.includes("Could not parse")));
});

// --- P11: empty/no suites report -------------------------------------------------

test("P11 empty report (valid JSON, suites:[]): found:true with all-zero totals, not found:false", (t) => {
  const reportFile = writeReportFixture(t, report({ suites: [] }));

  const out = collect({ reportFile });
  assert.deepEqual(out.testResults, { found: true, totals: { tests: 0, passed: 0, failed: 0, pending: 0, duration: 0 }, specs: [] });
  assert.deepEqual(out.failedTests, []);
  assert.deepEqual(out.warnings, []);
});

test("missing report file: found:false with a deterministic 'no report' warning", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-missing-"));
  const reportFile = path.join(tmpDir, "report.json");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const out = collect({ reportFile });
  assert.deepEqual(out.testResults, { found: false });
  assert.deepEqual(out.failedTests, []);
  assert.ok(out.warnings.some((w) => w.includes("No Playwright JSON report found")));
});

// --- P12: flaky (failed attempt -> passed attempt) -------------------------------

test("P12 flaky: excluded from failedTests, counted as passed, exactly one logical test (not two)", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p12.spec.ts",
          file: "tests/p12.spec.ts",
          specs: [
            spec({
              title: "eventually passes",
              file: "tests/p12.spec.ts",
              tests: [
                logicalTest({
                  status: "flaky",
                  results: [
                    result({ status: "failed", duration: 200, error: { message: "flaky assertion", stack: "at x" } }),
                    result({ status: "passed", duration: 150 }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.deepEqual(out.failedTests, []);
  assert.deepEqual(out.testResults.totals, { tests: 1, passed: 1, failed: 0, pending: 0, duration: 150 });
});

// --- P13: unexpected, all retries failed -----------------------------------------

test("P13 unexpected with all retries failed: exactly one failedTests entry, built from the FINAL attempt", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p13.spec.ts",
          file: "tests/p13.spec.ts",
          specs: [
            spec({
              title: "never passes",
              file: "tests/p13.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [
                    result({ status: "failed", duration: 50, retry: 0, error: { message: "first attempt error", stack: "s1" } }),
                    result({ status: "failed", duration: 60, retry: 1, error: { message: "final attempt error", stack: "s2" } }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests.length, 1);
  assert.equal(out.failedTests[0].duration, 60);
  assert.equal(out.failedTests[0].error.message, "final attempt error");
});

// --- P14: multiple errors, deterministic primary ----------------------------------

test("P14 multiple errors on one result: uses errors[0] deterministically, never concatenates", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p14.spec.ts",
          file: "tests/p14.spec.ts",
          specs: [
            spec({
              title: "fails with multiple errors",
              file: "tests/p14.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [
                    result({
                      status: "failed",
                      duration: 20,
                      errors: [
                        { message: "first error", stack: "stack1" },
                        { message: "second error", stack: "stack2" },
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.deepEqual(out.failedTests[0].error, { message: "first error", stack: "stack1" });
});

// --- P15: path normalization -------------------------------------------------------

test("P15 path normalization: an absolute under-ROOT spec.file normalizes to a repo-relative forward-slash path", (t) => {
  const absoluteSpecFile = path.join(ROOT, "tests", "p15.spec.ts");

  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p15.spec.ts",
          file: absoluteSpecFile,
          specs: [
            spec({
              title: "uses an absolute path",
              file: absoluteSpecFile,
              tests: [logicalTest({ status: "expected", results: [result({ status: "passed", duration: 1 })] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.testResults.specs[0].specFile, "tests/p15.spec.ts");
});

// --- P16: EXPECTED FAILURE (mandatory regression protection) ----------------------

test("P16 EXPECTED FAILURE: expectedStatus=failed + result.status=failed + test.status=expected must NOT appear in failedTests", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p16.spec.ts",
          file: "tests/p16.spec.ts",
          specs: [
            spec({
              title: "asserts an intentional failure via test.fail()",
              file: "tests/p16.spec.ts",
              tests: [
                logicalTest({
                  status: "expected",
                  expectedStatus: "failed",
                  results: [result({ status: "failed", duration: 50, error: { message: "expected failure", stack: "at intentional" } })],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.deepEqual(out.failedTests, [], "an expected failure must never surface as a generic failedTests entry");
  assert.deepEqual(out.testResults.totals, { tests: 1, passed: 1, failed: 0, pending: 0, duration: 50 }, "must be counted as a logical success");
});

// --- P17: multi-project ------------------------------------------------------------

test("P17 multi-project: each JSONReportTest entry is a separate logical execution instance; only the unexpected one fails", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p17.spec.ts",
          file: "tests/p17.spec.ts",
          specs: [
            spec({
              title: "cross-project test",
              file: "tests/p17.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  projectId: "chromium",
                  projectName: "chromium",
                  results: [result({ status: "failed", duration: 30, error: { message: "chromium-only failure", stack: "s" } })],
                }),
                logicalTest({
                  status: "expected",
                  projectId: "firefox",
                  projectName: "firefox",
                  results: [result({ status: "passed", duration: 25 })],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.testResults.totals.tests, 2);
  assert.equal(out.testResults.totals.failed, 1);
  assert.equal(out.testResults.totals.passed, 1);
  assert.equal(out.failedTests.length, 1);
  assert.equal(out.failedTests[0].projectName, "chromium");
  assert.equal(out.failedTests[0].projectId, "chromium");
});

// --- P18: unknown logical test status ------------------------------------------

test("P18 unknown test.status: excluded from passed/failed/pending, excluded from failedTests, warns", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p18.spec.ts",
          file: "tests/p18.spec.ts",
          specs: [
            spec({
              title: "has an unrecognized status",
              file: "tests/p18.spec.ts",
              tests: [logicalTest({ status: "somethingElse", results: [result({ status: "passed", duration: 5 })] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.deepEqual(out.failedTests, []);
  assert.deepEqual(out.testResults.totals, { tests: 1, passed: 0, failed: 0, pending: 0, duration: 5 });
  assert.ok(out.warnings.some((w) => w.includes('Unknown Playwright test.status "somethingElse"')));
});

// --- P19: top-level global errors -------------------------------------------------

test("P19 top-level global errors: deterministic count-only warning, never fabricated as a failedTests entry", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "p19.spec.ts",
          file: "tests/p19.spec.ts",
          specs: [
            spec({
              title: "runs fine",
              file: "tests/p19.spec.ts",
              tests: [logicalTest({ status: "expected", results: [result({ status: "passed", duration: 5 })] })],
            }),
          ],
        }),
      ],
      errors: [{ message: "Global setup failed: could not start server", stack: "at globalSetup" }],
    })
  );

  const out = collect({ reportFile });
  assert.deepEqual(out.failedTests, []);
  assert.ok(out.warnings.some((w) => w.includes("1 top-level error")));
  assert.ok(!out.warnings.some((w) => w.includes("at globalSetup")), "raw global-error stacks must never be copied into a warning");
});

// --- structural robustness (Phase 5: schema guard, malformed local entries) -----

test("malformed spec entry (missing tests array) is skipped with a warning, other evidence in the same report survives", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "mixed.spec.ts",
          file: "tests/mixed.spec.ts",
          specs: [
            { title: "broken spec", file: "tests/mixed.spec.ts" }, // no tests[] at all
            spec({
              title: "healthy spec",
              file: "tests/mixed.spec.ts",
              tests: [logicalTest({ status: "expected", results: [result({ status: "passed", duration: 1 })] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.testResults.totals.tests, 1);
  assert.ok(out.warnings.some((w) => w.includes("malformed spec entry")));
});

test("an unexpected test with zero result entries still normalizes with null error/duration and a warning, never throws", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "empty-results.spec.ts",
          file: "tests/empty-results.spec.ts",
          specs: [
            spec({
              title: "unexpected with no results",
              file: "tests/empty-results.spec.ts",
              tests: [logicalTest({ status: "unexpected", results: [] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests.length, 1);
  assert.equal(out.failedTests[0].duration, null);
  assert.deepEqual(out.failedTests[0].error, { message: null, stack: null });
  assert.ok(out.warnings.some((w) => w.includes("no result entries")));
});

// --- normalized-failure contract compliance (Phase 26) ---------------------------

test("every emitted failedTests entry across every fixture in this file satisfies validateNormalizedFailure()", (t) => {
  const scenarios = [
    report({
      suites: [
        fileSuite({
          title: "all.spec.ts",
          file: "tests/all.spec.ts",
          specs: [
            spec({
              title: "fails plainly",
              file: "tests/all.spec.ts",
              tests: [logicalTest({ status: "unexpected", results: [result({ status: "failed", duration: 1, error: { message: "m", stack: "s" } })] })],
            }),
            spec({
              title: "fails with no results",
              file: "tests/all.spec.ts",
              tests: [logicalTest({ status: "unexpected", results: [] })],
            }),
          ],
        }),
      ],
    }),
  ];

  for (const reportObj of scenarios) {
    const reportFile = writeReportFixture(t, reportObj);
    const out = collect({ reportFile });
    assert.ok(out.failedTests.length > 0);
    for (const failure of out.failedTests) {
      const result_ = validateNormalizedFailure(failure);
      assert.deepEqual(result_.errors, [], `failure "${failure.title}" must satisfy the normalized-failure contract`);
      assert.equal(result_.valid, true);
    }
  }
});

// --- walkReportSuites / loadReport unit-level coverage ---------------------------

test("walkReportSuites: the top-level file-suite's own title is never folded into suiteTitles", () => {
  const entries = walkReportSuites([
    fileSuite({
      title: "should-not-appear.spec.ts",
      file: "tests/x.spec.ts",
      specs: [spec({ title: "leaf", file: "tests/x.spec.ts", tests: [] })],
    }),
  ]);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].suiteTitles, []);
});

test("loadReport: a missing file returns null report and a deterministic warning", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-loadreport-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const { report: r, warnings } = loadReport(path.join(tmpDir, "does-not-exist.json"));
  assert.equal(r, null);
  assert.ok(warnings.some((w) => w.includes("No Playwright JSON report found")));
});

test("loadReport: a top-level shape without a suites array is rejected with a warning, not thrown", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-loadreport-"));
  const reportFile = path.join(tmpDir, "report.json");
  fs.writeFileSync(reportFile, JSON.stringify({ config: {}, stats: {} }));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const { report: r, warnings } = loadReport(reportFile);
  assert.equal(r, null);
  assert.ok(warnings.some((w) => w.includes("unexpected shape")));
});

// --- default-path wiring (D21T-1: isolated from real production report state) ---
//
// The original version of this coverage asserted collect() with no argument
// returns found:false, which silently depended on reports/playwright/
// report.json being ABSENT from the real production filesystem at test-run
// time (D21T-1). A real local `npx playwright test` run - including the
// one-purposeful-run pattern this repository's own review process uses for
// Roadmap #21F/#21G - legitimately leaves that exact file behind, which
// would fail this assertion with no code defect involved. Replaced with two
// mechanisms that never depend on that file's real-world presence/absence:
// an equivalence proof (works identically whether or not the real file
// exists) and an isolated-path proof (a dedicated OS-temp path that can
// never collide with the production default). Production adapter behavior
// (collect()'s `reportFile = DEFAULT_REPORT_FILE` default parameter) is
// completely unchanged - only this test's fixture strategy changed.

test("collect(): with no argument is equivalent to collect({reportFile: DEFAULT_REPORT_FILE}) - true regardless of whether a real report currently exists on disk", () => {
  const withNoArgument = collect();
  const withExplicitDefault = collect({ reportFile: DEFAULT_REPORT_FILE });
  assert.deepEqual(withNoArgument, withExplicitDefault);
});

test("collect(): a genuinely missing report at an isolated OS-temp path (never the production default) returns found:false, empty failedTests, and the expected warning", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-collect-missing-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const missingReportFile = path.join(tmpDir, "does-not-exist.json");

  const out = collect({ reportFile: missingReportFile });
  assert.deepEqual(out.testResults, { found: false });
  assert.deepEqual(out.failedTests, []);
  assert.ok(out.warnings.some((w) => w.includes("No Playwright JSON report found")));
});

// D21T-1 adversarial proof: collect() with no argument must still resolve
// correctly - reading the real content, not silently failing or picking up
// stale state - while a legitimate reports/playwright/report.json genuinely
// exists at the real production default path. Backs up and restores any
// pre-existing real file exactly, so a developer's or CI's own leftover
// report is never destroyed by running this test suite.
test("collect(): with no argument still resolves correctly while a real report exists at the production default location (adversarial proof, exact backup/restore)", (t) => {
  const backupPath = `${DEFAULT_REPORT_FILE}.d21t1-backup`;
  const hadExisting = fs.existsSync(DEFAULT_REPORT_FILE);
  if (hadExisting) fs.renameSync(DEFAULT_REPORT_FILE, backupPath);
  t.after(() => {
    fs.rmSync(DEFAULT_REPORT_FILE, { force: true });
    if (hadExisting) fs.renameSync(backupPath, DEFAULT_REPORT_FILE);
  });

  fs.mkdirSync(path.dirname(DEFAULT_REPORT_FILE), { recursive: true });
  const marker = "D21T1_ADVERSARIAL_MARKER";
  fs.writeFileSync(
    DEFAULT_REPORT_FILE,
    JSON.stringify(
      report({
        suites: [
          fileSuite({
            title: marker,
            file: "tests/d21t1-adversarial.spec.ts",
            specs: [
              spec({
                title: "adversarial spec",
                file: "tests/d21t1-adversarial.spec.ts",
                tests: [logicalTest({ status: "expected", results: [result({ status: "passed", duration: 10 })] })],
              }),
            ],
          }),
        ],
      })
    )
  );

  const out = collect();
  assert.equal(out.testResults.found, true);
  assert.equal(out.testResults.totals.tests, 1);
  assert.equal(out.testResults.totals.passed, 1);

  // The isolated missing-report test above is unaffected by this real
  // file's presence, since it always targets its own dedicated OS-temp
  // path, never DEFAULT_REPORT_FILE - proven again here for good measure.
  const missingResult = collect({ reportFile: path.join(os.tmpdir(), "d21t1-unrelated-missing-report.json") });
  assert.deepEqual(missingResult.testResults, { found: false });
});

// --- real-reporter compatibility proof (Roadmap #21B) -----------------------
//
// Every fixture above is hand-built, modeled from Playwright's *documented*
// JSON reporter shape (see this file's own module-level context and
// playwright-adapter.js's docstring) - never actually produced by an
// installed @playwright/test runtime. scripts/ai/__fixtures__/
// playwright-real-report.json closes that gap: it is a sanitized copy of a
// REAL report.json generated by @playwright/test 1.62.1 (Chromium), running
// a small deterministic offline spec (page.setContent() only - no network,
// no live SUT) covering five logical outcomes: a normal pass, a genuine
// unexpected failure, an expected failure (test.fail()), a deterministic
// flaky test (fails on the first attempt, passes on the configured single
// retry), and a skipped test. Sanitization replaced only volatile/private
// scalar values (absolute machine paths, the local Node.js binary path, a
// wall-clock timestamp) with fixed placeholder tokens - the object
// hierarchy, key names, array structure, status values, retry structure,
// error-vs-errors shape, and attachment metadata shape are exactly what the
// real reporter produced, verified via a fingerprint comparison against the
// raw report before this file was ever written (structurally identical:
// same top-level keys, same per-spec test/result/attachment counts and
// statuses, same error/errors-key presence per result).
//
// The adapter required ZERO production changes to parse this real report
// correctly - this test proves that, not just that a file loads.

const REAL_REPORT_FIXTURE = path.join(__dirname, "__fixtures__", "playwright-real-report.json");
const REAL_SCREENSHOT_MARKER = "__FIXTURE_SCREENSHOT_PATH__";

// Roadmap #21D: `screenshotDir` decides where the fixture's real screenshot
// files are materialized - INSIDE the repository (mkdtempInRepo(), the
// production-safe/accepted case, ATT_9) or genuinely OUTSIDE it
// (os.tmpdir(), the rejected case) - so the same real-fixture shape proves
// both halves of the R2/R3 boundary against real reporter output, not just
// synthetic fixtures.
function loadRealReportWithScreenshotFilesIn(t, screenshotDir) {
  const raw = JSON.parse(fs.readFileSync(REAL_REPORT_FIXTURE, "utf8"));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-real-report-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Every screenshot attachment in the sanitized fixture carries the same
  // placeholder marker instead of the real (machine-specific, temp-directory)
  // path the live proof run actually produced - replace each occurrence with
  // its own real, existing file so the adapter's locality check is
  // exercised exactly as it would be against genuine reporter output,
  // matching this file's own P7 fixture-file convention above.
  let screenshotIndex = 0;
  function patchAttachments(node) {
    if (Array.isArray(node)) {
      node.forEach(patchAttachments);
    } else if (node && typeof node === "object") {
      if (Array.isArray(node.attachments)) {
        for (const att of node.attachments) {
          if (att && att.name === "screenshot" && att.path === REAL_SCREENSHOT_MARKER) {
            const shotPath = path.join(screenshotDir, `real-shot-${screenshotIndex}.png`);
            screenshotIndex += 1;
            fs.writeFileSync(shotPath, "");
            att.path = shotPath;
          }
        }
      }
      for (const key of Object.keys(node)) patchAttachments(node[key]);
    }
  }
  patchAttachments(raw);

  const reportFile = path.join(tmpDir, "report.json");
  fs.writeFileSync(reportFile, JSON.stringify(raw));
  return reportFile;
}

function loadRealReportWithLiveScreenshotFiles(t) {
  return loadRealReportWithScreenshotFilesIn(t, mkdtempInRepo(t, "playwright-adapter-real-shots-"));
}

test("parses sanitized JSON produced by a real installed Playwright reporter (Roadmap #21B) - correct logical status classification for every real outcome", (t) => {
  const reportFile = loadRealReportWithLiveScreenshotFiles(t);
  const out = collect({ reportFile });

  assert.deepEqual(Object.keys(out).sort(), ["failedTests", "testResults", "warnings"]);

  // Real reporter totals: 5 logical tests - 3 logically "passed" (normal
  // pass, expected failure, flaky-ending-in-pass), 1 "failed" (the genuine
  // unexpected failure), 1 "pending" (skipped).
  assert.equal(out.testResults.found, true);
  assert.deepEqual(out.testResults.totals, {
    tests: 5,
    passed: 3,
    failed: 1,
    pending: 1,
    duration: out.testResults.totals.duration, // real wall-clock duration, not asserted exactly
  });
  assert.ok(out.testResults.totals.duration > 0);

  // Exactly one failedTests entry - the genuine unexpected failure. Expected
  // failure, flaky-ending-in-pass, and skipped must all be absent, proving
  // the real reporter's test.status ("expected"/"unexpected"/"flaky"/
  // "skipped") is honored exactly as classifyTestStatus() already assumed.
  assert.equal(out.failedTests.length, 1);
  const failure = out.failedTests[0];
  assert.equal(failure.title, "P_REAL_2 unexpected failure");
  assert.equal(failure.fullTitle, "P_REAL_2 unexpected failure");
  assert.equal(failure.status, "failed");
  assert.equal(failure.specFile, normalizeSpecPath("proof.spec.js"));

  // Real error shape: buildFailureError() must have used result.error (the
  // real reporter's own "first test error" field, present alongside a
  // non-empty errors[] on this exact result) - never a concatenation, never
  // a silent null.
  assert.equal(typeof failure.error.message, "string");
  assert.ok(failure.error.message.length > 0);
  assert.equal(typeof failure.error.stack, "string");
  assert.ok(failure.error.stack.length > 0);

  // Real screenshot attachment: only name==="screenshot" ever qualifies
  // (confirmed by this fixture also carrying "error-context" attachments,
  // which must never be mistaken for a screenshot - ATT_8), and the adapter
  // must resolve it to a non-null, repo-relative, never-absolute normalized
  // path once the file genuinely exists canonically inside the repository
  // (Roadmap #21D, ATT_9).
  assert.equal(typeof failure.screenshot, "string");
  assert.ok(failure.screenshot.length > 0);
  assert.equal(path.isAbsolute(failure.screenshot), false, "an accepted screenshot value must never be absolute");
  assert.ok(!failure.screenshot.includes("\\"), "an accepted screenshot value must use forward slashes only");

  // project identity fields stay on the normalized failure object as
  // allowed extras (Roadmap #19.8B) - never required, never dropped.
  assert.equal(failure.projectId, "chromium");
  assert.equal(failure.projectName, "chromium");

  // Every emitted failure still satisfies the shared, framework-neutral
  // normalized-failure contract - real reporter output is not exempt from
  // it.
  const validation = validateNormalizedFailure(failure);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);

  assert.deepEqual(out.warnings, []);
});

test("real reporter fixture, out-of-root screenshot: the same real reporter shape is rejected when its screenshot file is genuinely outside the repository (Roadmap #21D)", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-real-report-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const reportFile = loadRealReportWithScreenshotFilesIn(t, outsideDir);

  const out = collect({ reportFile });
  assert.equal(out.failedTests.length, 1);
  assert.equal(out.failedTests[0].screenshot, null);
  assert.ok(out.warnings.some((w) => w.includes("was not a safe repository-local path")));
  assert.ok(!out.warnings.some((w) => w.includes(outsideDir)), "the outside temp directory path must never appear in a warning");
});

// --- Roadmap #21D: R2/R3 required coverage matrix, adapter-integration level ---

test("S21D_1 out-of-root screenshot: rejected end-to-end through the real adapter pipeline, bounded path-free warning", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-s21d1-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const outsideShot = path.join(outsideDir, "shot.png");
  fs.writeFileSync(outsideShot, "");

  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "s21d1.spec.ts",
          file: "tests/s21d1.spec.ts",
          specs: [
            spec({
              title: "fails with an out-of-root screenshot",
              file: "tests/s21d1.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [result({ status: "failed", duration: 10, attachments: [{ name: "screenshot", contentType: "image/png", path: outsideShot }] })],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].screenshot, null);
  assert.ok(out.warnings.some((w) => w.includes("was not a safe repository-local path")));
  assert.ok(!out.warnings.some((w) => w.includes(outsideShot)), "the raw out-of-root path must never appear in a warning");
});

test("S21D_2 screenshot symlink escape: a repository-local symlink pointing outside the repository is rejected, real content never read", (t) => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-adapter-s21d2-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const outsideShot = path.join(outsideDir, "secret.png");
  fs.writeFileSync(outsideShot, "OUTSIDE_PRIVATE_PATH_MARKER_21D");

  const insideDir = mkdtempInRepo(t, "playwright-adapter-s21d2-inside-");
  const symlinkShot = path.join(insideDir, "shot.png");

  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideShot, symlinkShot, "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return; // environment cannot create filesystem symlinks - nothing to prove here

  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "s21d2.spec.ts",
          file: "tests/s21d2.spec.ts",
          specs: [
            spec({
              title: "fails with a symlinked screenshot escaping the repository",
              file: "tests/s21d2.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [result({ status: "failed", duration: 10, attachments: [{ name: "screenshot", contentType: "image/png", path: symlinkShot }] })],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].screenshot, null);
  assert.ok(out.warnings.some((w) => w.includes("was not a safe repository-local path")));
  assert.ok(!out.warnings.some((w) => w.includes(outsideShot) || w.includes("OUTSIDE_PRIVATE_PATH_MARKER_21D")));
});

test("S21D_3 safe in-repo symlink: a repository-local symlink to a repository-local file is accepted, returning the canonical target's own repo-relative path", (t) => {
  const insideDir = mkdtempInRepo(t, "playwright-adapter-s21d3-");
  const realShot = path.join(insideDir, "real.png");
  fs.writeFileSync(realShot, "");
  const symlinkShot = path.join(insideDir, "link.png");

  let symlinkSupported = true;
  try {
    fs.symlinkSync(realShot, symlinkShot, "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "s21d3.spec.ts",
          file: "tests/s21d3.spec.ts",
          specs: [
            spec({
              title: "fails with a safe in-repo symlinked screenshot",
              file: "tests/s21d3.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [result({ status: "failed", duration: 10, attachments: [{ name: "screenshot", contentType: "image/png", path: symlinkShot }] })],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].screenshot, resolveSafeLocalAttachmentPath(realShot).value);
  assert.equal(path.isAbsolute(out.failedTests[0].screenshot), false);
});

test("S21D_4 URL screenshot: never fetched, never materialized, rejected with no network access", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "s21d4.spec.ts",
          file: "tests/s21d4.spec.ts",
          specs: [
            spec({
              title: "fails with a URL screenshot attachment",
              file: "tests/s21d4.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [
                    result({
                      status: "failed",
                      duration: 10,
                      attachments: [{ name: "screenshot", contentType: "image/png", path: "https://example.invalid/screenshot.png" }],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].screenshot, null);
  assert.ok(out.warnings.some((w) => w.includes("was not a safe repository-local path")));
});

test("S21D_5 non-image contentType named \"screenshot\" is never treated as a screenshot", (t) => {
  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "s21d5.spec.ts",
          file: "tests/s21d5.spec.ts",
          specs: [
            spec({
              title: "fails with a text attachment merely named screenshot",
              file: "tests/s21d5.spec.ts",
              tests: [
                logicalTest({
                  status: "unexpected",
                  results: [
                    result({
                      status: "failed",
                      duration: 10,
                      attachments: [{ name: "screenshot", contentType: "text/plain", path: "tests/s21d5.spec.ts" }],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].screenshot, null);
});

test("S21D_6 out-of-root spec.file: redacted end-to-end (both testResults.specs and failedTests), bounded path-free warning", (t) => {
  const outsideSpecFile = path.join(os.tmpdir(), "OUTSIDE_PRIVATE_PATH_MARKER_21D", "evil.spec.ts");

  const reportFile = writeReportFixture(
    t,
    report({
      suites: [
        fileSuite({
          title: "s21d6.spec.ts",
          file: outsideSpecFile,
          specs: [
            spec({
              title: "fails, reported under an out-of-root spec file",
              file: outsideSpecFile,
              tests: [logicalTest({ status: "unexpected", results: [result({ status: "failed", duration: 10 })] })],
            }),
          ],
        }),
      ],
    })
  );

  const out = collect({ reportFile });
  assert.equal(out.failedTests[0].specFile, null);
  assert.deepEqual(out.testResults.specs, []);
  assert.ok(out.warnings.some((w) => w.includes("was outside the repository/workspace boundary and was redacted")));
  assert.ok(!out.warnings.some((w) => w.includes(outsideSpecFile) || w.includes("OUTSIDE_PRIVATE_PATH_MARKER_21D")));
});
