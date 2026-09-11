"use strict";

/**
 * Roadmap ID-2 (External-Repository Installation Proof): the terminal
 * installation proof - a genuinely external repository (physically
 * outside the qa-ai-agent checkout, created via mkdtempSync) installs the
 * REAL `npm pack` artifact via a REAL `npm install <tarball>`, then
 * exercises all four generic CI-triage pipeline stages through nothing
 * but `require("qa-ai-agent")`'s public API (Roadmap ID-1), with its own
 * target-owned ProjectProfile/repositoryRoot/FrameworkRuntimeConfig/
 * ProjectKnowledgeConfig.
 *
 * Deliberately placed outside scripts/ai/** (never shipped with the
 * distributed package - see package.json's own `files` boundary) and
 * outside scripts/targets/** (this is an installation proof, not a
 * target-owned fixture like Targomo/Project B).
 *
 * CRITICAL DESIGN NOTE - why a real child process, not an in-process
 * absolute-path require(): `require("<abs path>/node_modules/qa-ai-agent")`
 * from THIS test file's own process would still correctly load the
 * installed files (Node treats an absolute directory argument via its
 * "main" field, never through the source checkout), but it would NOT
 * exercise package.json's `exports` field at all - Node's exports-map
 * encapsulation only activates for BARE SPECIFIER resolution
 * (`require("qa-ai-agent")`), which requires module resolution to
 * actually start from a file physically located inside the external
 * repository. This file therefore writes one small, ephemeral runner
 * script INTO the external repository itself and executes it as a real
 * child process (`node <externalRepo>/id2-runner.js`) - the only way to
 * prove the real end-consumer resolution path, including `exports`
 * encapsulation, end to end.
 *
 * Offline and deterministic throughout: no npm registry access (the
 * tarball is a local file), no live GitHub (collect-history's fetch is
 * mocked inside the runner script), no live AI provider (AI_PROVIDER
 * defaults to "mock").
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, execSync } = require("node:child_process");

// Windows: `npm` resolves to `npm.cmd`, which execFileSync (unlike
// execSync) does not locate without shell involvement - matching the
// exact fix already established in scripts/ai/package-boundary.test.js.
// A double-quoted string command handles paths containing spaces (this
// checkout's own directory name is "Claude Code").
function npm(args, cwd) {
  return execSync(`npm ${args}`, { cwd, encoding: "utf8" });
}

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// --- Minimal, safe child-process environment (Roadmap ID-2 §40: environment
// isolation) - built fresh per spawn, never inherits the outer test
// process's own AI_API_KEY/NODE_PATH/QA_FRAMEWORK/etc. Only PATH and the
// handful of Windows-required system variables are carried through so
// `node` itself can actually launch; every QA-agent-relevant variable is
// then set explicitly and intentionally per scenario.
function minimalEnv(overrides) {
  const base = {
    PATH: process.env.PATH,
    Path: process.env.Path, // Windows is case-insensitive but Node's env object is not
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  for (const key of Object.keys(base)) {
    if (base[key] === undefined) delete base[key];
  }
  return { ...base, ...overrides };
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Recursive content-hash manifest of a directory - Roadmap ID-2 §23
// (package immutability): a stronger proof than a shallow file-count
// check, since it also catches in-place content modification of an
// existing file, not only added/removed files.
function hashManifest(dir) {
  const manifest = {};
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(dir, full).split(path.sep).join("/");
        manifest[rel] = sha256(fs.readFileSync(full));
      }
    }
  }
  walk(dir);
  return manifest;
}

const RUNNER_SCRIPT = `
"use strict";
const fs = require("fs");
const path = require("path");

const planPath = process.argv[2];
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const result = { steps: {}, errors: {} };

function tryStep(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((value) => { result.steps[name] = { ok: true }; })
    .catch((err) => { result.steps[name] = { ok: false }; result.errors[name] = (err && err.message) ? err.message : String(err); });
}

async function main() {
  // Bare specifier resolution - this is the whole point of this runner
  // running as its own child process rooted inside the external repo:
  // this is EXACTLY what a real external consumer's own code would write.
  const api = require("qa-ai-agent");
  result.resolvedPath = require.resolve("qa-ai-agent");
  result.apiKeys = Object.keys(api).sort();
  result.collectContextKeys = Object.keys(api.collectContext).sort();

  try {
    require("qa-ai-agent/scripts/ai/context-utils");
    result.deepImportBlocked = false;
  } catch (err) {
    result.deepImportBlocked = err.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
  }

  if (plan.historyMock) {
    result.requestedUrls = [];
    global.fetch = async (url) => {
      result.requestedUrls.push(url);
      const runsMatch = url.match(/\\/actions\\/workflows\\/([^/]+)\\/runs/);
      if (runsMatch) {
        const wf = decodeURIComponent(runsMatch[1]);
        const entry = plan.historyMock[wf];
        if (!entry) return { ok: false, status: 404, statusText: "Not Found" };
        return { ok: true, json: async () => ({ workflow_runs: [{ id: entry.runId, run_attempt: 1 }] }) };
      }
      const jobsMatch = url.match(/\\/actions\\/runs\\/(\\d+)\\/jobs/);
      if (jobsMatch) {
        const runId = Number(jobsMatch[1]);
        for (const wf of Object.keys(plan.historyMock)) {
          if (plan.historyMock[wf].runId === runId) {
            return { ok: true, json: async () => ({ jobs: plan.historyMock[wf].jobs }) };
          }
        }
        return { ok: false, status: 404, statusText: "Not Found" };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    };
  }

  if (plan.mode === "combined") {
    await tryStep("collectHistory", () =>
      api.collectHistory.main({ profile: plan.profile, repositoryRoot: plan.repositoryRoot, frameworkRuntimeConfig: plan.frameworkRuntimeConfig })
    );
    await tryStep("collectContext", () =>
      api.collectContext.runCli({ profile: plan.profile, repositoryRoot: plan.repositoryRoot, adapterOptions: { frameworkRuntimeConfig: plan.frameworkRuntimeConfig } })
    );
    await tryStep("analyzeFailure", () =>
      api.analyzeFailure.main({ projectProfile: plan.profile, repositoryRoot: plan.repositoryRoot, projectKnowledgeConfig: plan.projectKnowledgeConfig })
    );
    await tryStep("aggregateBrowserContext", () =>
      api.aggregateBrowserContext.main({ repositoryRoot: plan.repositoryRoot })
    );
  } else if (plan.mode === "wrongProjectKnowledge" || plan.mode === "outsideRootKnowledge") {
    await tryStep("analyzeFailure", () =>
      api.analyzeFailure.main({ projectProfile: plan.profile, repositoryRoot: plan.repositoryRoot, projectKnowledgeConfig: plan.projectKnowledgeConfig })
    );
  } else if (plan.mode === "wrongFramework") {
    await tryStep("collectContext", () =>
      api.collectContext.runCli({ profile: plan.profile, repositoryRoot: plan.repositoryRoot, adapterOptions: { frameworkRuntimeConfig: plan.frameworkRuntimeConfig } })
    );
  }

  fs.writeFileSync(plan.resultPath, JSON.stringify(result, null, 2));
}

main().catch((err) => {
  fs.writeFileSync(plan.resultPath, JSON.stringify({ fatalError: (err && err.message) ? err.message : String(err) }, null, 2));
  process.exitCode = 1;
});
`;

function playwrightReport(specTitle, errorMessage) {
  return {
    suites: [
      {
        title: "external.spec.js",
        file: "external.spec.js",
        specs: [
          {
            title: specTitle,
            file: "external.spec.js",
            tests: [
              {
                status: "unexpected",
                results: [{ status: "failed", duration: 10, error: { message: errorMessage, stack: `Error: ${errorMessage}` } }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function knowledgeUnit(id, overrides = {}) {
  return Object.assign(
    {
      id,
      category: "PROJECT",
      sourceType: "CURATED_INTERNAL",
      source: null,
      verifiedAt: "2026-01-01",
      tags: [`tag-${id}`],
      appliesTo: { browsers: null, frameworks: null, projects: null },
      statement: `Statement for ${id}.`,
      priority: 1,
    },
    overrides
  );
}

function writeJson(dir, relPath, obj) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj, null, 2));
}

function readJson(full) {
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

// Roadmap ID-2: `exitCode`/`stderr` are captured alongside the runner's own
// result.json because analyze-failure.js's main() has its own established,
// pre-existing fail-closed convention (see scripts/ai/analyze-failure.js's
// own fail() function): a configuration error there is logged via
// console.error and converted to `process.exitCode = 1` WITHOUT ever
// rejecting the returned promise (unlike collect-context.js's main(),
// which lets an adapter's FrameworkRuntimeConfig validation error
// propagate as a real thrown/rejected error). A test asserting on
// analyzeFailure specifically must therefore check the child process's own
// exit code and stderr, never assume `steps.analyzeFailure.ok === false`.
function runPlan(externalRepoDir, plan, env) {
  const planPath = path.join(externalRepoDir, `id2-plan-${crypto.randomBytes(4).toString("hex")}.json`);
  const resultPath = path.join(externalRepoDir, `id2-result-${crypto.randomBytes(4).toString("hex")}.json`);
  writeJson(externalRepoDir, path.basename(planPath), { ...plan, resultPath });
  let exitCode = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [path.join(externalRepoDir, "id2-runner.js"), planPath], {
      cwd: externalRepoDir,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Expected for the negative-control scenarios - never a hard test
    // failure by itself; the captured exit code / stderr / result.json
    // content are the actual sources of truth, asserted on by each test.
    exitCode = typeof err.status === "number" ? err.status : 1;
    stderr = err.stderr ? err.stderr.toString() : "";
  }
  const result = readJson(resultPath);
  fs.rmSync(planPath, { force: true });
  fs.rmSync(resultPath, { force: true });
  return { ...result, __exitCode: exitCode, __stderr: stderr };
}

// --- Module-level fixtures (built once in before(), reused across tests) ---

let tarballPath;
let scratchDir;
let externalRepoDir;
let preInstallManifest;

before(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "id2-scratch-"));
  const packOutput = npm(`pack --json --pack-destination "${scratchDir}"`, REPO_ROOT);
  const packed = JSON.parse(packOutput)[0];
  tarballPath = path.join(scratchDir, packed.filename);
  assert.ok(fs.existsSync(tarballPath), "npm pack must produce a real tarball file");

  externalRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "id2-external-repo-"));
  npm("init -y", externalRepoDir);
  npm(`install --no-audit --no-fund "${tarballPath}"`, externalRepoDir);

  fs.writeFileSync(path.join(externalRepoDir, "id2-runner.js"), RUNNER_SCRIPT);

  preInstallManifest = hashManifest(path.join(externalRepoDir, "node_modules", "qa-ai-agent"));
});

after(() => {
  if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
  if (externalRepoDir) fs.rmSync(externalRepoDir, { recursive: true, force: true });
});

// --- 1. Physical externality --------------------------------------------

test("ID-2: the external repository is physically outside the qa-ai-agent checkout", () => {
  const qaRoot = fs.realpathSync(REPO_ROOT);
  const extRoot = fs.realpathSync(externalRepoDir);
  assert.notEqual(extRoot, qaRoot);
  assert.equal(extRoot.startsWith(qaRoot + path.sep), false);
  assert.ok(fs.existsSync(path.join(externalRepoDir, "node_modules", "qa-ai-agent")));
});

// --- 2. The combined, multi-dimensional, all-four-stages E2E proof -------

test("ID-2 COMBINED PROOF: all four pipeline stages execute end to end from the installed package, with zero source-checkout dependency", () => {
  const PROFILE = Object.freeze({
    id: "external-install-proof-target",
    displayName: "ID-2 External Install Proof Target",
    knownProjectConstraints: Object.freeze(["ID-2 is a genuinely external, npm-installed second target."]),
  });
  const FRAMEWORK_RUNTIME_CONFIG = {
    schemaVersion: 1,
    projectId: PROFILE.id,
    framework: "playwright",
    frameworkConfigPath: "external-playwright.config.js",
    testSourceRoot: "external-e2e",
    reports: { reportFile: "external-artifacts/playwright/result.json" },
    historyWorkflowFile: "external-proof-ci.yml",
  };
  const PROJECT_KNOWLEDGE_CONFIG = {
    projectId: PROFILE.id,
    projectKnowledgeUnitsDir: "external-project-knowledge",
  };

  // Legacy-default decoy - must never be consumed once a valid config is supplied.
  writeJson(externalRepoDir, "reports/playwright/report.json", playwrightReport("EXTERNAL_LEGACY_DECOY", "EXTERNAL_LEGACY_DECOY_MUST_NOT_APPEAR"));
  // The externally-configured report location.
  writeJson(
    externalRepoDir,
    FRAMEWORK_RUNTIME_CONFIG.reports.reportFile,
    playwrightReport("EXTERNAL_INSTALL_PROOF_TEST", "job isolation externalinstallprooftag - EXTERNAL_CONFIG_SELECTED")
  );
  // The externally-configured, target-owned project knowledge.
  writeJson(
    externalRepoDir,
    path.join(PROJECT_KNOWLEDGE_CONFIG.projectKnowledgeUnitsDir, "unit.json"),
    knowledgeUnit("external-install-proof-unit", {
      tags: ["externalinstallprooftag"],
      statement: "EXTERNAL_PROJECT_KNOWLEDGE_SENTINEL",
      appliesTo: { browsers: null, frameworks: null, projects: [PROFILE.id] },
    })
  );

  const plan = {
    mode: "combined",
    profile: PROFILE,
    repositoryRoot: externalRepoDir,
    frameworkRuntimeConfig: FRAMEWORK_RUNTIME_CONFIG,
    projectKnowledgeConfig: PROJECT_KNOWLEDGE_CONFIG,
    historyMock: {
      [FRAMEWORK_RUNTIME_CONFIG.historyWorkflowFile]: { runId: 4242, jobs: [{ name: "External Proof - chromium", conclusion: "failure" }] },
      "cypress.yml": { runId: 1, jobs: [{ name: "Cypress - chrome", conclusion: "success" }] },
    },
  };

  const env = minimalEnv({
    QA_FRAMEWORK: "playwright",
    GITHUB_TOKEN: "id2-token",
    GITHUB_REPOSITORY: "o/external-install-proof",
    TEST_BROWSER: "chromium",
    HISTORY_JOB_NAME: "External Proof - chromium",
  });

  const result = runPlan(externalRepoDir, plan, env);

  // --- Source-checkout independence -----------------------------------
  assert.equal(result.fatalError, undefined, JSON.stringify(result));
  assert.ok(result.resolvedPath.includes(externalRepoDir) || fs.realpathSync(result.resolvedPath).startsWith(fs.realpathSync(externalRepoDir)));
  assert.equal(result.resolvedPath.toLowerCase().includes("desktop\\claude code") || result.resolvedPath.toLowerCase().includes("desktop/claude code"), false);
  assert.deepEqual(result.apiKeys, [
    "aggregateBrowserContext",
    "analyzeFailure",
    "assertValidFrameworkRuntimeConfig",
    "assertValidProjectKnowledgeConfig",
    "assertValidProjectProfile",
    "assertValidRepositoryRoot",
    "collectContext",
    "collectHistory",
  ]);
  assert.deepEqual(result.collectContextKeys, ["main", "runCli"]);
  assert.equal(result.deepImportBlocked, true, "a deep import into an unsupported internal path must be blocked by the exports field");

  // --- All four stages succeeded ---------------------------------------
  assert.equal(result.steps.collectHistory.ok, true, JSON.stringify(result.errors));
  assert.equal(result.steps.collectContext.ok, true, JSON.stringify(result.errors));
  assert.equal(result.steps.analyzeFailure.ok, true, JSON.stringify(result.errors));
  assert.equal(result.steps.aggregateBrowserContext.ok, true, JSON.stringify(result.errors));

  // --- History: configured workflow requested, legacy never requested --
  assert.ok(result.requestedUrls.some((u) => u.includes(`/actions/workflows/${FRAMEWORK_RUNTIME_CONFIG.historyWorkflowFile}/runs`)));
  assert.equal(result.requestedUrls.some((u) => u.includes("/actions/workflows/cypress.yml/runs")), false);

  // --- Outputs, read directly (safe: no module resolution involved) ----
  const context = readJson(path.join(externalRepoDir, "reports", "ai", "context.json"));
  assert.equal(context.metadata.projectId, PROFILE.id);
  assert.equal(context.metadata.framework, "playwright");
  assert.equal(context.failedTests[0].title, "EXTERNAL_INSTALL_PROOF_TEST");
  assert.ok(context.failedTests[0].error.message.includes("EXTERNAL_CONFIG_SELECTED"));
  assert.equal(context.failedTests[0].error.message.includes("EXTERNAL_LEGACY_DECOY"), false);

  const history = readJson(path.join(externalRepoDir, "reports", "ai", "history.json"));
  assert.equal(history.available, true);
  assert.equal(history.failures, 1);

  const report = readJson(path.join(externalRepoDir, "reports", "ai", "ai-report.json"));
  assert.equal(report.sourceContext.projectId, PROFILE.id);
  assert.notEqual(report.history, null);

  const relevantKnowledgeIds = report.sourceContext.relevantKnowledge.map((u) => u.id);
  assert.ok(relevantKnowledgeIds.includes("external-install-proof-unit"), "target-owned project knowledge (loaded from the EXTERNAL repositoryRoot) must be present");
  assert.ok(
    relevantKnowledgeIds.includes("ci-job-isolation-runner-state"),
    "package-owned core knowledge (loaded from inside node_modules/qa-ai-agent) must be present alongside it - " + JSON.stringify(relevantKnowledgeIds)
  );

  // --- All outputs live under the external repositoryRoot, never inside node_modules
  for (const outFile of ["reports/ai/context.json", "reports/ai/history.json", "reports/ai/ai-report.json"]) {
    const full = path.join(externalRepoDir, outFile);
    assert.ok(fs.existsSync(full));
    assert.equal(full.includes("node_modules"), false);
  }

  // --- Package immutability: content-hash manifest of the installed package
  const postManifest = hashManifest(path.join(externalRepoDir, "node_modules", "qa-ai-agent"));
  assert.deepEqual(postManifest, preInstallManifest, "the installed package tree must be byte-identical before and after running the full pipeline");
});

// --- 3. Security: wrong-project ProjectKnowledgeConfig fails closed ------

test("ID-2 SECURITY: a mismatched ProjectKnowledgeConfig.projectId fails closed from the installed package, no fallback", () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "id2-target-wrongproj-"));
  try {
    const profile = { id: "id2-wrongproj-target", displayName: "d", knownProjectConstraints: ["c"] };
    writeJson(targetRoot, "reports/ai/context.json", {
      generatedAt: new Date().toISOString(),
      metadata: { projectId: profile.id, framework: "playwright", repository: "o/r", commit: "c", branch: "m", runId: null, event: null, browser: "chromium", ci: false },
      testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 1 }, specs: [] },
      failedTests: [{ title: "t", specFile: "f", suite: "s", status: "failed", duration: 1, error: { message: "x", stack: "x" }, screenshot: null }],
      relevantFiles: {},
      knownProjectConstraints: [],
      warnings: [],
    });

    const plan = {
      mode: "wrongProjectKnowledge",
      profile,
      repositoryRoot: targetRoot,
      projectKnowledgeConfig: { projectId: "a-completely-different-project", projectKnowledgeUnitsDir: "nope" },
    };
    const result = runPlan(externalRepoDir, plan, minimalEnv({}));

    // analyzeFailure.main() never rejects for this class of error (see
    // runPlan()'s own comment) - the fail-closed signal is the non-zero
    // child exit code plus the logged reason, not a caught exception.
    assert.notEqual(result.__exitCode, 0);
    assert.match(result.__stderr, /PROJECT_KNOWLEDGE_CONFIG_PROJECT_MISMATCH/);
    assert.equal(fs.existsSync(path.join(targetRoot, "reports", "ai", "ai-report.json")), false, "no report may be written when config validation fails closed");
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

// --- 4. Security: wrong-framework config fails closed ---------------------

test("ID-2 SECURITY: a Cypress-shaped FrameworkRuntimeConfig under a Playwright runtime fails closed from the installed package", () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "id2-target-wrongfw-"));
  try {
    const profile = { id: "id2-wrongfw-target", displayName: "d", knownProjectConstraints: ["c"] };
    const cypressShapedConfig = {
      schemaVersion: 1,
      projectId: profile.id,
      framework: "cypress",
      frameworkConfigPath: "cypress.config.js",
      testSourceRoot: "cypress",
      reports: { reportsDir: "reports/cypress", screenshotsDir: "cypress/screenshots" },
      historyWorkflowFile: "cypress.yml",
    };
    const plan = { mode: "wrongFramework", profile, repositoryRoot: targetRoot, frameworkRuntimeConfig: cypressShapedConfig };
    const result = runPlan(externalRepoDir, plan, minimalEnv({ QA_FRAMEWORK: "playwright" }));

    assert.equal(result.steps.collectContext.ok, false);
    assert.match(result.errors.collectContext, /PLAYWRIGHT_RUNTIME_CONFIG_FRAMEWORK_MISMATCH/);
    assert.equal(fs.existsSync(path.join(targetRoot, "reports", "ai", "context.json")), false);
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

// --- 5. Security: outside-root project-knowledge escape fails closed -----

test("ID-2 SECURITY: a project-knowledge directory symlinked outside the external repositoryRoot fails closed, sentinel never leaks", () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "id2-target-outside-"));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "id2-outside-secret-"));
  try {
    writeJson(outsideDir, "secret.json", knowledgeUnit("ID2_OUTSIDE_UNIT", { statement: "EXTERNAL_INSTALL_OUTSIDE_SECRET" }));

    const profile = { id: "id2-outside-target", displayName: "d", knownProjectConstraints: ["c"] };
    writeJson(targetRoot, "reports/ai/context.json", {
      generatedAt: new Date().toISOString(),
      metadata: { projectId: profile.id, framework: "playwright", repository: "o/r", commit: "c", branch: "m", runId: null, event: null, browser: "chromium", ci: false },
      testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 1 }, specs: [] },
      failedTests: [{ title: "t", specFile: "f", suite: "s", status: "failed", duration: 1, error: { message: "x", stack: "x" }, screenshot: null }],
      relevantFiles: {},
      knownProjectConstraints: [],
      warnings: [],
    });

    let symlinkSupported = true;
    try {
      fs.symlinkSync(outsideDir, path.join(targetRoot, "escaped-knowledge"), "dir");
    } catch {
      symlinkSupported = false;
    }
    if (!symlinkSupported) return;

    const plan = {
      mode: "outsideRootKnowledge",
      profile,
      repositoryRoot: targetRoot,
      projectKnowledgeConfig: { projectId: profile.id, projectKnowledgeUnitsDir: "escaped-knowledge" },
    };
    const result = runPlan(externalRepoDir, plan, minimalEnv({}));

    // See the previous test's own comment: analyzeFailure.main() never
    // rejects for this class of error - check the child's own exit
    // status/stderr instead.
    assert.notEqual(result.__exitCode, 0);
    assert.match(result.__stderr, /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
    assert.equal(result.__stderr.includes("EXTERNAL_INSTALL_OUTSIDE_SECRET"), false);
    assert.equal(fs.existsSync(path.join(targetRoot, "reports", "ai", "ai-report.json")), false);
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
