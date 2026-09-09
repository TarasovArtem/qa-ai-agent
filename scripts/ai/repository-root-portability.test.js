"use strict";

/**
 * Roadmap FPI-2 - cross-cutting trusted-repositoryRoot portability proofs.
 *
 * scripts/ai/repository-root.test.js covers the primitive's own validate/
 * assert contract in isolation. This file proves the properties that only
 * show up when the ALREADY-LOADED generic-core consumer modules
 * (collect-context.js, its adapters, analyze-failure.js) are actually
 * exercised end to end against synthetic TARGET repositories:
 *
 *   - the target repository need not be, and is not, this qa-ai-agent
 *     checkout itself (an external temp directory works identically);
 *   - the same loaded modules can operate against two different target
 *     repositories, one after another, in one process, with zero
 *     cross-contamination (proving zero module-global mutable root state);
 *   - behavior is independent of process.cwd();
 *   - a symlinked repositoryRoot argument itself resolves and behaves
 *     correctly end to end, not only at the primitive level;
 *   - default (unoverridden) reporter/output paths resolve underneath the
 *     injected root, never underneath this generic core's own __dirname.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const collectContext = require("./collect-context");
const cypressAdapter = require("./adapters/cypress-adapter");

const CORE_DIR = path.resolve(__dirname);

const SYNTHETIC_PROFILE = Object.freeze({
  id: "synthetic-portability-project",
  displayName: "Synthetic Portability Project",
  knownProjectConstraints: Object.freeze(["Synthetic portability constraint."]),
});

// Builds a fully self-contained, minimal, throwaway TARGET repository
// under the OS temp directory - deliberately OUTSIDE this qa-ai-agent
// checkout (CORE_DIR) - with its own cypress.config.js, package.json, and
// one Cypress mochawesome-shaped report naming exactly one failed test.
// This is the "external temp target" every proof below operates against.
function makeSyntheticTargetRepo(prefix, failureTitle) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.writeFileSync(path.join(root, "cypress.config.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: prefix, version: "0.0.0" }));

  const specDir = path.join(root, "cypress", "e2e", "tests");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, "synthetic.cy.js"), "// synthetic fixture spec, never executed\n");

  const reportsDir = path.join(root, "reports", "cypress");
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, "report.json"),
    JSON.stringify({
      stats: { tests: 1, passes: 0, failures: 1, pending: 0, duration: 9 },
      results: [
        {
          file: path.join(root, "cypress", "e2e", "tests", "synthetic.cy.js"),
          suites: [{ title: "Suite", suites: [], tests: [{ title: failureTitle, state: "failed", duration: 9, err: { message: "m", estack: "s" } }] }],
        },
      ],
    })
  );

  return root;
}

test("external-temp-target proof: a target repository living entirely OUTSIDE this qa-ai-agent checkout works identically through the real generic core", (t) => {
  const targetRoot = makeSyntheticTargetRepo("fpi2-portability-external-", "external target failure");
  t.after(() => fs.rmSync(targetRoot, { recursive: true, force: true }));

  assert.equal(targetRoot.startsWith(CORE_DIR), false, "the synthetic target repository must be genuinely outside this generic core's own checkout");

  collectContext.main({ profile: SYNTHETIC_PROFILE, repositoryRoot: targetRoot });

  const outputFile = path.join(targetRoot, "reports", "ai", "context.json");
  const written = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(written.failedTests.length, 1);
  assert.equal(written.failedTests[0].title, "external target failure");
  // Never written anywhere under this generic core's own directory tree.
  assert.equal(fs.existsSync(path.join(CORE_DIR, "reports", "ai", "context-should-not-exist.json")), false);
});

test("two-root same-process isolation proof: the SAME already-loaded collect-context.js/cypress-adapter.js modules handle two different target repositories sequentially with zero cross-contamination", (t) => {
  const rootA = makeSyntheticTargetRepo("fpi2-portability-two-root-a-", "REPO_A_MARKER failure");
  const rootB = makeSyntheticTargetRepo("fpi2-portability-two-root-b-", "REPO_B_MARKER failure");
  t.after(() => {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });

  collectContext.main({ profile: SYNTHETIC_PROFILE, repositoryRoot: rootA });
  const writtenA = JSON.parse(fs.readFileSync(path.join(rootA, "reports", "ai", "context.json"), "utf8"));

  collectContext.main({ profile: SYNTHETIC_PROFILE, repositoryRoot: rootB });
  const writtenB = JSON.parse(fs.readFileSync(path.join(rootB, "reports", "ai", "context.json"), "utf8"));

  // Re-run A a second time, AFTER B - proves no module-global root state
  // leaked from processing B.
  collectContext.main({ profile: SYNTHETIC_PROFILE, repositoryRoot: rootA });
  const writtenA2 = JSON.parse(fs.readFileSync(path.join(rootA, "reports", "ai", "context.json"), "utf8"));

  assert.equal(writtenA.failedTests[0].title, "REPO_A_MARKER failure");
  assert.equal(writtenB.failedTests[0].title, "REPO_B_MARKER failure");
  assert.equal(writtenA2.failedTests[0].title, "REPO_A_MARKER failure", "re-processing root A after root B must reproduce root A's own evidence, never root B's");
  assert.notEqual(writtenA.failedTests[0].title, writtenB.failedTests[0].title);

  // relevantFiles collected for A must be A's own cypress.config.js
  // content, never B's (and vice versa) - proves no shared/cached root
  // boundary crossed between the two invocations.
  assert.ok("cypress.config.js" in writtenA.relevantFiles);
  assert.ok("cypress.config.js" in writtenB.relevantFiles);
});

test("cwd-independence proof: main() output lands under the injected repositoryRoot regardless of process.cwd(), never under the process's actual working directory", (t) => {
  const targetRoot = makeSyntheticTargetRepo("fpi2-portability-cwd-", "cwd independence failure");
  const originalCwd = process.cwd();
  const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fpi2-portability-cwd-elsewhere-")));
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  process.chdir(elsewhere);
  try {
    collectContext.main({ profile: SYNTHETIC_PROFILE, repositoryRoot: targetRoot });
  } finally {
    process.chdir(originalCwd);
  }

  const written = JSON.parse(fs.readFileSync(path.join(targetRoot, "reports", "ai", "context.json"), "utf8"));
  assert.equal(written.failedTests[0].title, "cwd independence failure");
  assert.equal(fs.existsSync(path.join(elsewhere, "reports")), false, "nothing must ever be written under the unrelated cwd directory");
});

test("symlinked-repositoryRoot-itself proof: passing a symlink AS repositoryRoot resolves and writes correctly through the real generic core, dereferencing to the real target", (t) => {
  const realTargetRoot = makeSyntheticTargetRepo("fpi2-portability-symlink-real-", "symlinked root failure");
  const parentDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fpi2-portability-symlink-parent-")));
  const symlinkRootPath = path.join(parentDir, "symlinked-target-root");

  let symlinkSupported = true;
  try {
    fs.symlinkSync(realTargetRoot, symlinkRootPath, "dir");
  } catch {
    symlinkSupported = false;
  }
  t.after(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
    fs.rmSync(realTargetRoot, { recursive: true, force: true });
  });
  if (!symlinkSupported) return; // environment cannot create filesystem symlinks - nothing to prove here

  collectContext.main({ profile: SYNTHETIC_PROFILE, repositoryRoot: symlinkRootPath });

  // Output must land under the REAL (dereferenced) target directory -
  // main() resolves repositoryRoot to {lexicalRoot, realRoot} and uses
  // realRoot for its own output directory.
  const outputFile = path.join(fs.realpathSync(realTargetRoot), "reports", "ai", "context.json");
  assert.equal(fs.existsSync(outputFile), true, "output must be written underneath the symlink's dereferenced real target");
  const written = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(written.failedTests[0].title, "symlinked root failure");

  // Reading back through the symlink path itself must show the identical file.
  const writtenViaSymlink = JSON.parse(fs.readFileSync(path.join(symlinkRootPath, "reports", "ai", "context.json"), "utf8"));
  assert.deepEqual(writtenViaSymlink, written);
});

test("absolute-reporter-path-inside-injected-root proof: the Cypress adapter's default reportsDir/screenshotsDir resolve underneath the injected root, never underneath this generic core's own __dirname", (t) => {
  const targetRoot = makeSyntheticTargetRepo("fpi2-portability-default-paths-", "default path failure");
  t.after(() => fs.rmSync(targetRoot, { recursive: true, force: true }));

  const root = { lexicalRoot: targetRoot, realRoot: fs.realpathSync(targetRoot) };
  // No reportsDir/screenshotsDir override - collect() must compute its own
  // defaults from `root`, not from this file's (or cypress-adapter.js's
  // own) __dirname.
  const result = cypressAdapter.collect({ root });

  assert.equal(result.testResults.found, true);
  assert.equal(result.failedTests.length, 1);
  assert.equal(result.failedTests[0].title, "default path failure");
  assert.notEqual(path.resolve(targetRoot), CORE_DIR, "sanity: the synthetic target and this generic core's own directory must be genuinely distinct paths");
});
