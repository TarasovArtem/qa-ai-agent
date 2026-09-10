"use strict";

/**
 * Roadmap FPI-3bA (ProjectKnowledgeConfig consumer wiring): unit-level
 * regression for loader.js's two new project-knowledge primitives -
 * loadProjectKnowledgeUnits() and composeKnowledgeUnits() - in isolation
 * from analyze-failure.js's own consumer wiring (see
 * scripts/ai/project-knowledge-consumer-wiring.test.js for the end-to-end
 * integration/adversarial suite).
 *
 * loadProjectKnowledgeUnits()'s own contract explicitly assumes its
 * `unitsDir` argument is ALREADY a canonically-authorized directory (see
 * its own module comment) - directory-level containment is proven at the
 * integration layer instead, since that is where resolveRepositoryLocalPath()
 * is actually called. This file focuses on what loadProjectKnowledgeUnits()
 * itself owns: reuse of the core loader's parse/schema/dedup machinery,
 * PER-FILE canonical containment (the one thing the core loader has never
 * needed, since scripts/ai/knowledge/units/ is trusted shipped content, not
 * externally-supplied target-repository data), and composeKnowledgeUnits()'s
 * additive-only, cross-boundary-duplicate-fails-closed composition policy.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  loadKnowledgeUnits,
  loadProjectKnowledgeUnits,
  composeKnowledgeUnits,
  KnowledgeLoadError,
} = require("./loader");

function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return { dir, root: { lexicalRoot: dir, realRoot: fs.realpathSync(dir) } };
}

function unit(id, overrides = {}) {
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

// --- loadProjectKnowledgeUnits(): basic behavior -------------------------

test("loadProjectKnowledgeUnits: a genuinely missing directory returns []", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-missing");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "does-not-exist");
  assert.deepEqual(loadProjectKnowledgeUnits(unitsDir, root), []);
});

test("loadProjectKnowledgeUnits: an empty existing directory returns []", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-empty");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  assert.deepEqual(loadProjectKnowledgeUnits(unitsDir, root), []);
});

test("loadProjectKnowledgeUnits: loads and validates real project units in deterministic filename order", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-happy");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  writeUnitFile(unitsDir, "b.json", unit("proj-b"));
  writeUnitFile(unitsDir, "a.json", unit("proj-a"));

  const result = loadProjectKnowledgeUnits(unitsDir, root);
  assert.deepEqual(result.map((u) => u.id), ["proj-a", "proj-b"]);
});

test("loadProjectKnowledgeUnits: a non-.json file in the directory is ignored, matching the core loader's own convention", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-nonjson");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  writeUnitFile(unitsDir, "real.json", unit("proj-real"));
  fs.writeFileSync(path.join(unitsDir, "README.md"), "not a knowledge unit");

  const result = loadProjectKnowledgeUnits(unitsDir, root);
  assert.deepEqual(result.map((u) => u.id), ["proj-real"]);
});

// --- loadProjectKnowledgeUnits(): fail-closed cases -----------------------

test("loadProjectKnowledgeUnits: malformed JSON fails closed with KnowledgeLoadError", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-malformed");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  fs.writeFileSync(path.join(unitsDir, "broken.json"), "{ not valid json");

  assert.throws(() => loadProjectKnowledgeUnits(unitsDir, root), KnowledgeLoadError);
});

test("loadProjectKnowledgeUnits: a schema-invalid unit fails closed with KnowledgeLoadError", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-schema-invalid");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  writeUnitFile(unitsDir, "bad.json", { id: "proj-bad" }); // missing every other required field

  assert.throws(() => loadProjectKnowledgeUnits(unitsDir, root), KnowledgeLoadError);
});

test("loadProjectKnowledgeUnits: a duplicate id within the project directory fails closed with KnowledgeLoadError", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-dup-within");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  writeUnitFile(unitsDir, "a.json", unit("DUPLICATE_ID"));
  writeUnitFile(unitsDir, "b.json", unit("DUPLICATE_ID"));

  assert.throws(() => loadProjectKnowledgeUnits(unitsDir, root), KnowledgeLoadError);
});

test("loadProjectKnowledgeUnits: a broken symlink (no real target) fails closed, not silently skipped", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-broken-symlink");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  let symlinkSupported = true;
  try {
    fs.symlinkSync(path.join(dir, "does-not-exist-target.json"), path.join(unitsDir, "broken.json"), "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  assert.throws(() => loadProjectKnowledgeUnits(unitsDir, root), KnowledgeLoadError);
});

// --- loadProjectKnowledgeUnits(): per-file symlink containment ------------

test("FPI3bA per-file symlink escape: an individual project unit file symlinked to an outside file fails closed and its content is never read", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-file-escape-target");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpi3ba-loader-file-escape-outside-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const outsideFile = path.join(outsideDir, "secret.json");
  fs.writeFileSync(outsideFile, JSON.stringify(unit("OUTSIDE_PROJECT_KNOWLEDGE_SECRET")));

  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  let symlinkSupported = true;
  try {
    fs.symlinkSync(outsideFile, path.join(unitsDir, "unit.json"), "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const originalReadFileSync = fs.readFileSync;
  const readPaths = [];
  fs.readFileSync = (p, ...args) => {
    readPaths.push(p);
    return originalReadFileSync.call(fs, p, ...args);
  };
  let threw = false;
  let message = null;
  try {
    loadProjectKnowledgeUnits(unitsDir, root);
  } catch (err) {
    threw = true;
    message = err.message;
  } finally {
    fs.readFileSync = originalReadFileSync;
  }

  assert.equal(threw, true, "an escaping individual unit file must fail closed");
  assert.ok(message.includes("escapes the trusted repository root"));
  assert.equal(
    readPaths.some((p) => path.resolve(p) === path.resolve(outsideFile)),
    false,
    "the outside file must never be read"
  );
});

test("FPI3bA per-file in-root symlink positive control: a project unit file symlinked to another in-root file is still accepted", (t) => {
  const { dir, root } = fresh("fpi3ba-loader-file-inroot");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const realDir = path.join(dir, "real-project-knowledge");
  fs.mkdirSync(realDir);
  const realFile = path.join(realDir, "unit.json");
  fs.writeFileSync(realFile, JSON.stringify(unit("proj-inroot")));

  const unitsDir = path.join(dir, "project-knowledge");
  fs.mkdirSync(unitsDir);
  let symlinkSupported = true;
  try {
    fs.symlinkSync(realFile, path.join(unitsDir, "unit.json"), "file");
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported) return;

  const result = loadProjectKnowledgeUnits(unitsDir, root);
  assert.deepEqual(result.map((u) => u.id), ["proj-inroot"]);
});

// --- composeKnowledgeUnits(): additive composition ------------------------

test("composeKnowledgeUnits: an empty project array returns the core array's own contents unchanged", () => {
  const coreUnits = [unit("core-1"), unit("core-2")];
  assert.deepEqual(composeKnowledgeUnits(coreUnits, []), coreUnits);
});

test("composeKnowledgeUnits: both core and project units are present in the composed result (additive, never replacing)", () => {
  const coreUnits = [unit("core-1")];
  const projectUnits = [unit("proj-1")];
  const combined = composeKnowledgeUnits(coreUnits, projectUnits);
  assert.deepEqual(combined.map((u) => u.id).sort(), ["core-1", "proj-1"]);
});

test("composeKnowledgeUnits: a duplicate id across the core/project boundary fails closed with KnowledgeLoadError, never override/shadow semantics", () => {
  const coreUnits = [unit("SHARED_ID")];
  const projectUnits = [unit("SHARED_ID")];
  assert.throws(() => composeKnowledgeUnits(coreUnits, projectUnits), KnowledgeLoadError);
});

// --- Core loader byte-compatibility (Roadmap FPI-3bA refactor) -----------

test("loadKnowledgeUnits(): the real core corpus still loads unchanged after the FPI-3bA internal refactor", () => {
  const result = loadKnowledgeUnits();
  assert.ok(Array.isArray(result));
  assert.ok(result.length > 0, "the real scripts/ai/knowledge/units/ corpus is expected to be non-empty");
});
