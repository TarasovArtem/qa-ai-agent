"use strict";

/**
 * Roadmap ID-1 (Package Boundary / Public Programmatic API): proves the
 * public barrel module (scripts/ai/index.js) exposes exactly the intended
 * minimal surface - explicit presence assertions for every required
 * symbol, explicit absence assertions for internals that were deliberately
 * NOT exported (see index.js's own docstring for the evidence-backed
 * rationale for each exclusion). Deliberately not a single snapshot
 * assertion on the whole object - a snapshot would silently accept a
 * future accidental addition; explicit per-symbol checks make every
 * intentional inclusion/exclusion independently reviewable.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const api = require("./index");

test("ID-1 public API: exposes exactly the four namespaced pipeline entrypoints", () => {
  assert.deepEqual(Object.keys(api).sort(), [
    "aggregateBrowserContext",
    "analyzeFailure",
    "assertValidFrameworkRuntimeConfig",
    "assertValidProjectKnowledgeConfig",
    "assertValidProjectProfile",
    "assertValidRepositoryRoot",
    "collectContext",
    "collectHistory",
  ]);
});

test("ID-1 public API: collectContext exposes exactly {main, runCli}, both callable", () => {
  assert.deepEqual(Object.keys(api.collectContext).sort(), ["main", "runCli"]);
  assert.equal(typeof api.collectContext.main, "function");
  assert.equal(typeof api.collectContext.runCli, "function");
});

test("ID-1 public API: collectHistory exposes exactly {main}, callable", () => {
  assert.deepEqual(Object.keys(api.collectHistory).sort(), ["main"]);
  assert.equal(typeof api.collectHistory.main, "function");
});

test("ID-1 public API: analyzeFailure exposes exactly {main}, callable", () => {
  assert.deepEqual(Object.keys(api.analyzeFailure).sort(), ["main"]);
  assert.equal(typeof api.analyzeFailure.main, "function");
});

test("ID-1 public API: aggregateBrowserContext exposes exactly {main}, callable", () => {
  assert.deepEqual(Object.keys(api.aggregateBrowserContext).sort(), ["main"]);
  assert.equal(typeof api.aggregateBrowserContext.main, "function");
});

test("ID-1 public API: all four FPI-1/FPI-2 validators are present and callable", () => {
  assert.equal(typeof api.assertValidProjectProfile, "function");
  assert.equal(typeof api.assertValidFrameworkRuntimeConfig, "function");
  assert.equal(typeof api.assertValidProjectKnowledgeConfig, "function");
  assert.equal(typeof api.assertValidRepositoryRoot, "function");
});

test("ID-1 public API: exported main() functions are the exact same function references as the internal modules' own exports (no wrapping)", () => {
  assert.equal(api.collectContext.main, require("./collect-context").main);
  assert.equal(api.collectContext.runCli, require("./collect-context").runCli);
  assert.equal(api.collectHistory.main, require("./collect-history").main);
  assert.equal(api.analyzeFailure.main, require("./analyze-failure").main);
  assert.equal(api.aggregateBrowserContext.main, require("./aggregate-browser-context").main);
  assert.equal(api.assertValidProjectProfile, require("./project-profile").assertValidProjectProfile);
  assert.equal(api.assertValidFrameworkRuntimeConfig, require("./framework-runtime-config").assertValidFrameworkRuntimeConfig);
  assert.equal(api.assertValidProjectKnowledgeConfig, require("./project-knowledge-config").assertValidProjectKnowledgeConfig);
  assert.equal(api.assertValidRepositoryRoot, require("./repository-root").assertValidRepositoryRoot);
});

// --- Deliberate exclusions (see index.js's own docstring for rationale) ----

test("ID-1 public API: adapters and the runtime framework selector are NOT part of the public surface", () => {
  assert.equal("cypressAdapter" in api, false);
  assert.equal("playwrightAdapter" in api, false);
  assert.equal("selectRuntimeAdapter" in api, false);
  assert.equal("adapters" in api, false);
});

test("ID-1 public API: internal implementation helpers are NOT part of the public surface", () => {
  const forbidden = [
    "buildRelevantFiles",
    "isPathAllowed",
    "readFileSafe",
    "resolveLocalImports",
    "runProviderAnalysis",
    "buildFailureReport",
    "computeRelevantKnowledge",
    "readHistory",
    "aggregateHistory",
    "fetchJson",
    "aggregateBrowserInputs",
    "validateProjectProfile",
    "validateFrameworkRuntimeConfig",
    "validateProjectKnowledgeConfig",
    "validateRepositoryRoot",
  ];
  for (const name of forbidden) {
    assert.equal(name in api, false, `"${name}" must not be part of the public surface`);
    assert.equal(name in api.collectContext, false, `"${name}" must not be part of collectContext's public surface`);
    assert.equal(name in api.collectHistory, false, `"${name}" must not be part of collectHistory's public surface`);
    assert.equal(name in api.analyzeFailure, false, `"${name}" must not be part of analyzeFailure's public surface`);
    assert.equal(name in api.aggregateBrowserContext, false, `"${name}" must not be part of aggregateBrowserContext's public surface`);
  }
});

test("ID-1 public API: no Targomo or Project B target data is part of the public surface", () => {
  const serialized = JSON.stringify(Object.keys(api));
  assert.equal(serialized.includes("targomo"), false);
  assert.equal(serialized.toLowerCase().includes("project-b"), false);
  assert.equal("TARGOMO_PROJECT_PROFILE" in api, false);
  assert.equal("PROJECT_B_PROJECT_PROFILE" in api, false);
});

test("ID-1 public API: the barrel module introduces no new filesystem write authority (source-text audit)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.equal(/writeFileSync|mkdirSync|appendFileSync|resolveSafeRepositoryWritePath/.test(source), false);
});
