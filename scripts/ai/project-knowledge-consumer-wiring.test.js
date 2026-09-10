"use strict";

/**
 * Roadmap FPI-3bA (ProjectKnowledgeConfig consumer wiring, the FPI-3b slice
 * of the FPI-3 consumer-wiring roadmap phase): end-to-end
 * integration/adversarial regression for analyze-failure.js's new optional
 * `projectKnowledgeConfig` input, threaded through
 * computeRelevantKnowledge()/buildFailureReport() (and, in production,
 * main()).
 *
 * See scripts/ai/knowledge/loader-project-knowledge.test.js for the
 * lower-level loadProjectKnowledgeUnits()/composeKnowledgeUnits() unit
 * tests - this file focuses on the CONSUMER seam itself: config
 * validation, project-identity consistency (ProjectProfile.id vs.
 * ProjectKnowledgeConfig.projectId), directory-level containment (via
 * context-utils.js's resolveRepositoryLocalPath()), and the fail-closed
 * failure model this file's own pre-existing `fail()`/hard-exit
 * architecture requires (see analyze-failure.js's own module comment for
 * why this deliberately does NOT mirror collect-history.js's
 * writeUnavailable() graceful-degrade convention).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { computeRelevantKnowledge, buildFailureReport } = require("./analyze-failure");
const { loadKnowledgeUnits } = require("./knowledge/loader");
const { selectKnowledge } = require("./knowledge/selector");

const PROFILE_A = Object.freeze({ id: "fpi3ba-test-project", displayName: "FPI-3bA Test Project", knownProjectConstraints: ["x"] });
const PROFILE_B = Object.freeze({ id: "fpi3ba-other-project", displayName: "FPI-3bA Other Project", knownProjectConstraints: ["x"] });

function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return { dir, root: { lexicalRoot: dir, realRoot: fs.realpathSync(dir) } };
}

function baseContext(signal = "generic failure") {
  return {
    metadata: { projectId: PROFILE_A.id, repository: "o/r", commit: "c", branch: "main", runId: null, event: null, browser: "chrome", ci: false },
    testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 10 }, specs: [] },
    failedTests: [
      {
        title: "t",
        specFile: "f.cy.js",
        suite: "s",
        status: "failed",
        duration: 1,
        error: { message: signal, stack: signal },
        screenshot: null,
      },
    ],
    relevantFiles: {},
    warnings: [],
  };
}

function projectUnit(id, overrides = {}) {
  return {
    id,
    category: "GENERAL_QA",
    sourceType: "CURATED_INTERNAL",
    source: null,
    verifiedAt: "2026-01-01",
    tags: [`tag-${id}`],
    appliesTo: { browsers: null, frameworks: null, projects: null },
    statement: `Statement for ${id}.`,
    priority: 1,
    ...overrides,
  };
}

function writeUnitFile(dir, filename, unitObj) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(unitObj));
}

// --- Backward compatibility -----------------------------------------------

test("computeRelevantKnowledge: no projectKnowledgeConfig preserves exact pre-FPI-3bA core-only behavior", () => {
  const context = baseContext();
  const expected = selectKnowledge(context, loadKnowledgeUnits());

  assert.deepEqual(computeRelevantKnowledge(context), expected);
  assert.deepEqual(computeRelevantKnowledge(context, { projectProfile: PROFILE_A }), expected);
});

test("computeRelevantKnowledge: a config with only projectId (no directory) preserves core-only behavior", () => {
  const context = baseContext();
  const result = computeRelevantKnowledge(context, {
    projectProfile: PROFILE_A,
    projectKnowledgeConfig: { projectId: PROFILE_A.id },
  });
  assert.deepEqual(result, selectKnowledge(context, loadKnowledgeUnits()));
});

// --- Fail-closed: invalid config -------------------------------------------

test("computeRelevantKnowledge: a structurally invalid projectKnowledgeConfig (missing projectId) fails closed", () => {
  assert.throws(
    () => computeRelevantKnowledge(baseContext(), { projectProfile: PROFILE_A, projectKnowledgeConfig: { projectKnowledgeUnitsDir: "x" } }),
    /PROJECT_KNOWLEDGE_CONFIG_INVALID/
  );
});

test("computeRelevantKnowledge: an unsafe projectKnowledgeUnitsDir value fails closed at the FPI-1 validation layer, before any filesystem access", () => {
  assert.throws(
    () =>
      computeRelevantKnowledge(baseContext(), {
        projectProfile: PROFILE_A,
        projectKnowledgeConfig: { projectId: PROFILE_A.id, projectKnowledgeUnitsDir: "../outside" },
      }),
    /PROJECT_KNOWLEDGE_CONFIG_INVALID/
  );
});

// --- Fail-closed: projectId mismatch ---------------------------------------

test("computeRelevantKnowledge: a projectId mismatch fails closed - a decoy project unit is never enumerated", (t) => {
  const { dir, root } = fresh("fpi3ba-mismatch");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  writeUnitFile(unitsDir, "decoy.json", projectUnit("DECOY_UNIT", { tags: ["decoy-tag"], statement: "DECOY_STATEMENT_SHOULD_NEVER_LEAK" }));

  const originalReaddirSync = fs.readdirSync;
  const enumerated = [];
  fs.readdirSync = (p, ...args) => {
    enumerated.push(p);
    return originalReaddirSync.call(fs, p, ...args);
  };
  let threw = false;
  let message = null;
  try {
    computeRelevantKnowledge(baseContext(), {
      root,
      projectProfile: PROFILE_A,
      projectKnowledgeConfig: { projectId: PROFILE_B.id, projectKnowledgeUnitsDir: "project-knowledge" },
    });
  } catch (err) {
    threw = true;
    message = err.message;
  } finally {
    fs.readdirSync = originalReaddirSync;
  }

  assert.equal(threw, true);
  assert.match(message, /PROJECT_KNOWLEDGE_CONFIG_PROJECT_MISMATCH/);
  assert.equal(
    enumerated.some((p) => path.resolve(String(p)) === path.resolve(unitsDir)),
    false,
    "the configured directory must never be enumerated on a projectId mismatch"
  );
});

// --- Missing directory: graceful degrade -----------------------------------

test("computeRelevantKnowledge: a syntactically valid but non-existent configured directory contributes [] gracefully, core still loads", (t) => {
  const { dir, root } = fresh("fpi3ba-missing-dir");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const context = baseContext();
  const result = computeRelevantKnowledge(context, {
    root,
    projectProfile: PROFILE_A,
    projectKnowledgeConfig: { projectId: PROFILE_A.id, projectKnowledgeUnitsDir: "does-not-exist" },
  });
  assert.deepEqual(result, selectKnowledge(context, loadKnowledgeUnits()));
});

// --- Fail-closed: directory-level symlink escape ---------------------------

test("computeRelevantKnowledge: a configured directory symlinked outside the repository fails closed before any enumeration", (t) => {
  const { dir, root } = fresh("fpi3ba-dir-escape-target");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpi3ba-dir-escape-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  writeUnitFile(outsideDir, "secret.json", projectUnit("OUTSIDE_PROJECT_KNOWLEDGE_SECRET", { statement: "OUTSIDE_PROJECT_KNOWLEDGE_SENTINEL" }));

  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideDir, path.join(dir, "project-knowledge"), "dir");
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
  let message = null;
  try {
    computeRelevantKnowledge(baseContext(), {
      root,
      projectProfile: PROFILE_A,
      projectKnowledgeConfig: { projectId: PROFILE_A.id, projectKnowledgeUnitsDir: "project-knowledge" },
    });
  } catch (err) {
    threw = true;
    message = err.message;
  } finally {
    fs.readdirSync = originalReaddirSync;
  }

  assert.equal(threw, true);
  assert.match(message, /ADAPTER_PATH_OUTSIDE_REPOSITORY/);
  assert.equal(
    enumerated.some((p) => path.resolve(String(p)) === path.resolve(path.join(dir, "project-knowledge"))),
    false,
    "the escaping directory must never be enumerated"
  );
  assert.equal(message.includes("OUTSIDE_PROJECT_KNOWLEDGE"), false, "the outside sentinel must never appear in the thrown message");
});

// --- In-root symlink positive control ---------------------------------------

test("computeRelevantKnowledge: a repository-local (non-escaping) symlinked configured directory is still accepted", (t) => {
  const { dir, root } = fresh("fpi3ba-dir-inroot");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const realDir = path.join(dir, "real-project-knowledge");
  fs.mkdirSync(realDir);
  const tag = "zzfpi3bainroottag";
  writeUnitFile(realDir, "unit.json", projectUnit("proj-inroot", { tags: [tag], statement: "PROJECT_INROOT_STATEMENT" }));

  let symlinkSupported = true;
  try {
    fs.symlinkSync(realDir, path.join(dir, "project-knowledge"), "dir");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const result = computeRelevantKnowledge(baseContext(tag), {
    root,
    projectProfile: PROFILE_A,
    projectKnowledgeConfig: { projectId: PROFILE_A.id, projectKnowledgeUnitsDir: "project-knowledge" },
  });
  assert.ok(result.some((u) => u.id === "proj-inroot"));
});

// --- Composition, project-only contribution, and portability proof ---------

test("computeRelevantKnowledge: core + project composition - a real core unit and a project-owned unit are both selected for the same context (synthetic non-conventional layout, portability proof)", (t) => {
  const { dir, root } = fresh("fpi3ba-portability");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // "project-ai-knowledge" matches no Targomo convention and no core
  // DEFAULT_UNITS_DIR convention - the central FPI-3b portability proof.
  const unitsDir = path.join(dir, "project-ai-knowledge");
  fs.mkdirSync(unitsDir);
  const projectTag = "zzfpi3baportabilitytag";
  writeUnitFile(
    unitsDir,
    "custom-project-unit.json",
    projectUnit("proj-portability", { tags: [projectTag], statement: "PROJECT_ONLY_CONTRIBUTION_SENTINEL", priority: 10 })
  );

  // "job isolation" is the real, unique tag of the real core unit
  // ci-job-isolation-runner-state (scripts/ai/knowledge/units/) - included
  // alongside our own unique project tag so BOTH sources score > 0 for the
  // same context.
  const context = baseContext(`job isolation ${projectTag}`);

  const result = computeRelevantKnowledge(context, {
    root,
    projectProfile: PROFILE_A,
    projectKnowledgeConfig: { projectId: PROFILE_A.id, projectKnowledgeUnitsDir: "project-ai-knowledge" },
  });

  const ids = result.map((u) => u.id);
  assert.ok(ids.includes("ci-job-isolation-runner-state"), "the real core corpus must still be present, not replaced");
  assert.ok(ids.includes("proj-portability"), "the project-owned unit must be reachable with zero generic-core source change");
});

// --- Fail-closed: cross-core/project duplicate id ---------------------------

test("computeRelevantKnowledge: a project unit id colliding with a real core unit id fails closed, never override/shadow", (t) => {
  const { dir, root } = fresh("fpi3ba-dup-core-project");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  const [existingCoreUnit] = loadKnowledgeUnits();
  writeUnitFile(unitsDir, "collide.json", projectUnit(existingCoreUnit.id));

  assert.throws(
    () =>
      computeRelevantKnowledge(baseContext(), {
        root,
        projectProfile: PROFILE_A,
        projectKnowledgeConfig: { projectId: PROFILE_A.id, projectKnowledgeUnitsDir: "project-knowledge" },
      }),
    (err) => err.message.includes("Duplicate knowledge unit id") && err.message.includes(existingCoreUnit.id)
  );
});

// --- buildFailureReport(): explicit relevantKnowledge override -------------

test("buildFailureReport: an explicit relevantKnowledge override bypasses project-knowledge loading entirely, even with an otherwise mismatched config", async () => {
  const provider = {
    analyze: async () =>
      JSON.stringify({
        results: [
          {
            test: { title: "t", specFile: "f.cy.js" },
            classification: "TEST_BUG",
            confidence: 0.5,
            summary: "s",
            rootCause: "r",
            evidence: ["e"],
            recommendedFix: { file: "f.cy.js", description: "d" },
            shouldCreateBug: false,
            shouldRetry: false,
          },
        ],
      }),
  };

  // config.projectId deliberately mismatches PROFILE_A.id - if
  // computeRelevantKnowledge() were invoked despite the explicit override,
  // this would throw PROJECT_KNOWLEDGE_CONFIG_PROJECT_MISMATCH.
  const report = await buildFailureReport(baseContext(), {
    provider,
    history: null,
    projectProfile: PROFILE_A,
    relevantKnowledge: [{ id: "explicit-override", statement: "EXPLICIT_OVERRIDE_STATEMENT" }],
    projectKnowledgeConfig: { projectId: "MISMATCHED_PROJECT_ID_WOULD_THROW_IF_EVALUATED" },
  });

  assert.deepEqual(report.sourceContext.relevantKnowledge, [{ id: "explicit-override", statement: "EXPLICIT_OVERRIDE_STATEMENT" }]);
});

// --- §33: outside-sentinel end-to-end leakage (mandatory) -------------------

test("FPI3bA outside-sentinel end-to-end leakage: buildFailureReport() never reaches the provider when the configured directory escapes root - zero leakage surface", async (t) => {
  const { dir, root } = fresh("fpi3ba-e2e-escape-target");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpi3ba-e2e-escape-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  writeUnitFile(outsideDir, "secret.json", projectUnit("OUTSIDE_SENTINEL_UNIT", { statement: "OUTSIDE_PROJECT_KNOWLEDGE_SENTINEL" }));

  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideDir, path.join(dir, "project-knowledge"), "dir");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  let providerCalled = false;
  const provider = {
    analyze: async () => {
      providerCalled = true;
      return JSON.stringify({ results: [] });
    },
  };

  await assert.rejects(() =>
    buildFailureReport(baseContext(), {
      provider,
      history: null,
      root,
      projectProfile: PROFILE_A,
      projectKnowledgeConfig: { projectId: PROFILE_A.id, projectKnowledgeUnitsDir: "project-knowledge" },
    })
  );

  assert.equal(providerCalled, false, "the provider must never be invoked - the outside sentinel must never reach a prompt or report");
});
