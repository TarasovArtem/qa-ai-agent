"use strict";

/**
 * CRW2-B4 (Fail-closed test-infrastructure verification/corrective):
 * real-runner proof for external-repository-proof.test.js's own bootstrap
 * fail-closed contract.
 *
 * Discovery: external-repository-proof.test.js built its shared fixture
 * (a real `npm pack` + `npm install` into a temp external repo) in a
 * `before()` hook. Reproduced against pre-fix content: when that hook
 * throws, every one of the 14 dependent tests in the file independently
 * reports FAILED with the exact same raw npm/fs stack trace repeated 14
 * times - still fail-closed (exit code non-zero, nothing silently passes
 * or skips), but the report reads as "14 independent product/test
 * defects" instead of the true "1 infrastructure/fixture-build failure
 * blocked 14 unrelated-looking checks", which is misleading test
 * evidence (not a false-green defect - see the file's own corrective
 * comment for the full analysis).
 *
 * Fix (in external-repository-proof.test.js itself): the fixture now
 * builds inside one explicit "ID-2 bootstrap" test instead of a hook, and
 * every dependent test is registered through a local `test()` wrapper
 * (shadowing node:test's own) that fails closed on a bootstrap failure
 * with a short TEST_INFRA_SETUP_FAILED message pointing back at the
 * bootstrap test's own failure, instead of re-deriving the raw error 14
 * times.
 *
 * This file proves that FIX PATTERN with a real `node --test` child
 * process against a fast, deterministic, synthetic fixture (not the real,
 * slow npm pack/install) - the pattern under test is generic (bootstrap
 * test + local `test()` wrapper + dependent tests), not the specific
 * npm/fs mechanics, so a synthetic fixture proves the same fail-closed/
 * evidence-clarity contract without the ~5s real npm round-trip. No
 * network access; only a temp file written and removed within this
 * process's own scratch directory.
 *
 * Every child spawn pins `--test-reporter=tap` explicitly: node:test's
 * default reporter auto-selects "spec" (✔/✖ symbols) or "tap" (plain
 * "ok"/"not ok" lines) depending on the running process's own
 * environment - observed to actually differ between a local Node 24 run
 * and this repository's CI runner's Node 22, for reasons outside this
 * file's control. Pinning the reporter removes that ambiguity so the
 * assertions below are deterministic everywhere, not just locally.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// The exact shape applied to external-repository-proof.test.js: a bootstrap
// test that either succeeds or fails per `SHOULD_FAIL`, plus dependent
// tests registered through a local `test()` wrapper that guards on the
// bootstrap's own recorded error.
function harnessSource(shouldFail) {
  return `
"use strict";
const { test: nodeTest } = require("node:test");

let bootstrapError = null;

nodeTest("bootstrap: builds the shared fixture", () => {
  try {
    if (${shouldFail}) {
      throw new Error("SYNTHETIC_REQUIRED_FIXTURE_BUILD_FAILURE");
    }
  } catch (err) {
    bootstrapError = err;
    throw err;
  }
});

function test(name, fn) {
  return nodeTest(name, () => {
    if (bootstrapError) {
      throw new Error(
        \`TEST_INFRA_SETUP_FAILED: the shared "bootstrap" fixture failed to build - see that test's own failure for the real root cause (\${bootstrapError.message})\`,
      );
    }
    return fn();
  });
}

test("dependent A", () => {});
test("dependent B", () => {});
test("dependent C", () => {});
`;
}

// This file itself runs under `node --test`, which sets NODE_TEST_CONTEXT/
// NODE_TEST_WORKER_ID in its own process.env for internal worker
// coordination. execFileSync inherits process.env by default, so a naive
// child `node --test` spawn here silently inherits those variables and
// Node's runner then treats it as an already-coordinated recursive worker
// ("node:test run() is being called recursively within a test file.
// skipping running files.") - it exits 0 having run nothing at all, which
// would make every assertion below observe an empty, misleadingly
// "successful" result instead of the child harness's real behavior. Every
// child spawn below therefore explicitly strips NODE_TEST_* from the
// child's environment so it starts as a genuinely independent test run.
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST_")) delete env[key];
  }
  return env;
}

// node:test's default reporter auto-selects "spec" (✔/✖ symbols) or "tap"
// (plain "ok"/"not ok" lines) depending on the running process's own
// stdout/environment - observed to differ between a local run and this
// repository's own CI runner (Node 22 vs Node 24), independently of
// anything this file controls. Every child spawn below pins
// `--test-reporter=tap` explicitly so its output format is deterministic
// regardless of the outer environment, instead of relying on ambient
// auto-detection.
const TAP_ARGS = ["--test", "--test-reporter=tap"];

function tapOk(output, name) {
  return new RegExp(`^ok \\d+ - ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(output);
}
function tapNotOk(output, name) {
  return new RegExp(`^not ok \\d+ - ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(output);
}

function runHarness(shouldFail) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b4-fail-closed-harness-"));
  const file = path.join(dir, "harness.test.js");
  fs.writeFileSync(file, harnessSource(shouldFail));
  try {
    let exitCode = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [...TAP_ARGS, file], { encoding: "utf8", env: childEnv() });
    } catch (err) {
      exitCode = typeof err.status === "number" ? err.status : 1;
      output = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
    }
    return { exitCode, output };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("CRW2-B4 pre-fix reproduction: a throwing before()-style setup makes every dependent test fail with the identical raw error (real runner, real process)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b4-prefix-harness-"));
  const file = path.join(dir, "harness.test.js");
  fs.writeFileSync(
    file,
    `
"use strict";
const { test, before } = require("node:test");
before(() => { throw new Error("SYNTHETIC_REQUIRED_FIXTURE_BUILD_FAILURE"); });
test("dependent A", () => {});
test("dependent B", () => {});
test("dependent C", () => {});
`,
  );
  try {
    let exitCode = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [...TAP_ARGS, file], { encoding: "utf8", env: childEnv() });
    } catch (err) {
      exitCode = typeof err.status === "number" ? err.status : 1;
      output = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
    }
    assert.notEqual(exitCode, 0, "a throwing before() hook must still exit non-zero (fail-closed on exit code)");
    const occurrences = output.split("SYNTHETIC_REQUIRED_FIXTURE_BUILD_FAILURE").length - 1;
    // The real defect, confirmed against Node's actual before()-hook
    // behavior: the identical raw root-cause text is independently
    // duplicated once per dependent test (3 dependents here = 3
    // occurrences) - each looks like its own distinct failure.
    assert.equal(occurrences, 3, `expected the raw error duplicated once per dependent test (got ${occurrences} occurrences)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CRW2-B4 post-fix: bootstrap-test + local test() wrapper pattern still exits non-zero on required setup failure (real runner, real process)", () => {
  const { exitCode, output } = runHarness(true);
  assert.notEqual(exitCode, 0, "a failed bootstrap must still exit non-zero");
  assert.ok(tapNotOk(output, "bootstrap: builds the shared fixture"), "bootstrap test must report not ok");
  assert.match(output, /SYNTHETIC_REQUIRED_FIXTURE_BUILD_FAILURE/, "the real root cause must appear in the bootstrap test's own failure");
  assert.ok(tapNotOk(output, "dependent A"));
  assert.ok(tapNotOk(output, "dependent B"));
  assert.ok(tapNotOk(output, "dependent C"));
});

test("CRW2-B4 post-fix: dependent test failures carry the short TEST_INFRA_SETUP_FAILED marker, not a re-derived raw error each time (evidence-clarity proof)", () => {
  const { output } = runHarness(true);
  const markerOccurrences = output.split("TEST_INFRA_SETUP_FAILED").length - 1;
  assert.equal(markerOccurrences, 3, "exactly the 3 dependent tests should carry the short, clearly-labeled marker");
});

test("CRW2-B4 post-fix: no dependent test can silently PASS or SKIP when the bootstrap fixture failed (fail-closed, never a false green)", () => {
  const { exitCode, output } = runHarness(true);
  assert.notEqual(exitCode, 0);
  assert.equal(tapOk(output, "dependent A"), false, "no dependent test may report ok when its required bootstrap fixture failed");
  assert.equal(tapOk(output, "dependent B"), false);
  assert.equal(tapOk(output, "dependent C"), false);
  assert.doesNotMatch(output, /# skipped [1-9]|ℹ skipped [1-9]/, "no dependent test may be silently skipped instead of failing closed");
});

test("CRW2-B4 positive path: a succeeding bootstrap lets every dependent test run and pass normally, exit 0 (real runner, real process)", () => {
  const { exitCode, output } = runHarness(false);
  assert.equal(exitCode, 0);
  assert.ok(tapOk(output, "bootstrap: builds the shared fixture"));
  assert.ok(tapOk(output, "dependent A"));
  assert.ok(tapOk(output, "dependent B"));
  assert.ok(tapOk(output, "dependent C"));
  assert.doesNotMatch(output, /TEST_INFRA_SETUP_FAILED/);
});
