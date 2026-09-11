"use strict";

/**
 * Roadmap ID-1 (Package Boundary / Public Programmatic API): independently
 * inspects the ACTUAL contents `npm pack` would produce - never trusting
 * package.json's `files` glob semantics theoretically (negation patterns
 * inside `files` are real but easy to get subtly wrong, e.g. an
 * unanchored pattern matching more or less than intended). This is the
 * one authoritative packaging test: it spawns a real `npm pack --dry-run
 * --json` against this repository's own root and asserts on the actual
 * returned file list.
 *
 * Fully offline and deterministic - `npm pack --dry-run` performs no
 * network access and writes no tarball to disk (confirmed empirically
 * during implementation: no stray .tgz file is ever produced).
 *
 * This is NOT the ID-2 external-installation proof - it only proves the
 * packed ARTIFACT's shape, never that an external repository can actually
 * install and run it (see the ID-1 planning report's own explicit
 * phase boundary).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function packedFiles() {
  const raw = execSync("npm pack --dry-run --json", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const parsed = JSON.parse(raw);
  return parsed[0].files.map((f) => f.path.split(path.sep).join("/"));
}

let cachedFiles = null;
function files() {
  if (!cachedFiles) cachedFiles = packedFiles();
  return cachedFiles;
}

test("ID-1 package content: the public barrel entrypoint is included", () => {
  assert.ok(files().includes("scripts/ai/index.js"));
});

test("ID-1 package content: all four generic pipeline entrypoints are included", () => {
  const f = files();
  assert.ok(f.includes("scripts/ai/collect-context.js"));
  assert.ok(f.includes("scripts/ai/collect-history.js"));
  assert.ok(f.includes("scripts/ai/analyze-failure.js"));
  assert.ok(f.includes("scripts/ai/aggregate-browser-context.js"));
});

test("ID-1 package content: the four FPI-1/FPI-2 validator modules are included", () => {
  const f = files();
  assert.ok(f.includes("scripts/ai/project-profile.js"));
  assert.ok(f.includes("scripts/ai/framework-runtime-config.js"));
  assert.ok(f.includes("scripts/ai/project-knowledge-config.js"));
  assert.ok(f.includes("scripts/ai/repository-root.js"));
});

test("RTI-1 package content: the RequirementArtifact contract module is included", () => {
  assert.ok(files().includes("scripts/ai/requirement-artifact.js"));
});

test("ID-1 package content: adapters, providers, and context-utils (internal dependencies of the entrypoints) are included", () => {
  const f = files();
  assert.ok(f.includes("scripts/ai/adapters/cypress-adapter.js"));
  assert.ok(f.includes("scripts/ai/adapters/playwright-adapter.js"));
  assert.ok(f.includes("scripts/ai/context-utils.js"));
  assert.ok(f.some((p) => p.startsWith("scripts/ai/providers/")));
});

test("ID-1 package content: core knowledge units ship with the package", () => {
  const units = files().filter((p) => p.startsWith("scripts/ai/knowledge/units/") && p.endsWith(".json"));
  assert.ok(units.length > 0, "expected at least one core knowledge unit in the packed artifact");
});

test("ID-1 package content: LICENSE, README, and package.json are present", () => {
  const f = files();
  assert.ok(f.some((p) => /^LICENSE/i.test(p)));
  assert.ok(f.includes("README.md"));
  assert.ok(f.includes("package.json"));
});

test("ID-1 package content: no test files are packaged", () => {
  const testFiles = files().filter((p) => p.endsWith(".test.js"));
  assert.deepEqual(testFiles, []);
});

test("ID-1 package content: __fixtures__ (dev/test fixtures) are excluded", () => {
  const fixtureFiles = files().filter((p) => p.includes("__fixtures__"));
  assert.deepEqual(fixtureFiles, []);
});

test("ID-1 package content: evaluation/ (internal dev/QA tooling, not target-facing) is excluded", () => {
  const evaluationFiles = files().filter((p) => p.includes("/evaluation/"));
  assert.deepEqual(evaluationFiles, []);
});

test("ID-1 package content: Targomo and Project B (development-repository dogfood targets) are excluded", () => {
  const f = files();
  assert.equal(f.some((p) => p.startsWith("scripts/targets/")), false);
});

test("ID-1 package content: CI workflows and E2E test suites are excluded", () => {
  const f = files();
  assert.equal(f.some((p) => p.startsWith(".github/")), false);
  assert.equal(f.some((p) => p.startsWith("cypress/")), false);
});
