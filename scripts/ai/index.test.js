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

test("ID-1/RTI-1/RTI-2/RTI-3/RTI-4/RTI-5 public API: exposes exactly the four namespaced pipeline entrypoints, the five fail-closed validators, the RTI-2 file ingestion adapter, the RTI-3 quality analyzers, the RTI-4 test design generators, and the RTI-5 traceability/coverage functions", () => {
  assert.deepEqual(Object.keys(api).sort(), [
    "aggregateBrowserContext",
    "analyzeFailure",
    "analyzeRequirementQuality",
    "analyzeRequirementsCoverage",
    "analyzeRequirementsQuality",
    "assertValidFrameworkRuntimeConfig",
    "assertValidProjectKnowledgeConfig",
    "assertValidProjectProfile",
    "assertValidRepositoryRoot",
    "assertValidRequirementArtifact",
    "buildRequirementTraceability",
    "collectContext",
    "collectHistory",
    "generateTestDesign",
    "generateTestDesigns",
    "loadRequirementsFromFile",
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

test("RTI-1 public API: assertValidRequirementArtifact is present and callable", () => {
  assert.equal(typeof api.assertValidRequirementArtifact, "function");
});

test("RTI-2 public API: loadRequirementsFromFile is present and callable", () => {
  assert.equal(typeof api.loadRequirementsFromFile, "function");
});

test("RTI-3 public API: analyzeRequirementQuality and analyzeRequirementsQuality are present and callable", () => {
  assert.equal(typeof api.analyzeRequirementQuality, "function");
  assert.equal(typeof api.analyzeRequirementsQuality, "function");
});

test("RTI-4 public API: generateTestDesign and generateTestDesigns are present and callable", () => {
  assert.equal(typeof api.generateTestDesign, "function");
  assert.equal(typeof api.generateTestDesigns, "function");
});

test("RTI-5 public API: buildRequirementTraceability and analyzeRequirementsCoverage are present and callable", () => {
  assert.equal(typeof api.buildRequirementTraceability, "function");
  assert.equal(typeof api.analyzeRequirementsCoverage, "function");
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
  assert.equal(api.assertValidRequirementArtifact, require("./requirement-artifact").assertValidRequirementArtifact);
  assert.equal(api.loadRequirementsFromFile, require("./requirements-file").loadRequirementsFromFile);
  assert.equal(api.analyzeRequirementQuality, require("./requirement-quality").analyzeRequirementQuality);
  assert.equal(api.analyzeRequirementsQuality, require("./requirement-quality").analyzeRequirementsQuality);
  assert.equal(api.generateTestDesign, require("./test-design").generateTestDesign);
  assert.equal(api.generateTestDesigns, require("./test-design").generateTestDesigns);
  assert.equal(api.buildRequirementTraceability, require("./requirement-traceability").buildRequirementTraceability);
  assert.equal(api.analyzeRequirementsCoverage, require("./requirement-traceability").analyzeRequirementsCoverage);
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
    "validateRequirementArtifact",
    "parseAndNormalizeRequirements",
    "readRequirementsFileBytes",
    "resolveRequirementsFilePath",
    "normalizeRawRequirement",
    "runAnalysis",
    "buildAnalysisTargets",
    "deriveStatus",
    "analyzeTarget",
    "buildTestDesigns",
    "buildFromCriterion",
    "buildFromContent",
    "buildSourceRef",
    "assertNoDuplicateCriterionIds",
    "buildTraceabilityLinks",
    "assertRequirementsInput",
    "assertTestDesignsInput",
    "assertNoDuplicateRequirementOrCriterionIds",
    "readTestDesignReference",
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

test("RTI-1/RTI-2/RTI-3/RTI-4/RTI-5 public API: no external requirement-source system is coupled into the public surface or its own source text", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const forbiddenSystems = ["jira", "xray", "testrail", "azure devops", "azure-devops", "zephyr", "polarion"];
  const serializedKeys = JSON.stringify(Object.keys(api)).toLowerCase();
  for (const system of forbiddenSystems) {
    assert.equal(serializedKeys.includes(system), false, `"${system}" must not appear in the public API key list`);
  }
  const indexSource = fs.readFileSync(path.join(__dirname, "index.js"), "utf8").toLowerCase();
  const contractSource = fs.readFileSync(path.join(__dirname, "requirement-artifact.js"), "utf8").toLowerCase();
  const fileAdapterSource = fs.readFileSync(path.join(__dirname, "requirements-file.js"), "utf8").toLowerCase();
  const qualitySource = fs.readFileSync(path.join(__dirname, "requirement-quality.js"), "utf8").toLowerCase();
  const testDesignSource = fs.readFileSync(path.join(__dirname, "test-design.js"), "utf8").toLowerCase();
  const traceabilitySource = fs.readFileSync(path.join(__dirname, "requirement-traceability.js"), "utf8").toLowerCase();
  for (const system of forbiddenSystems) {
    assert.equal(indexSource.includes(system), false, `"${system}" must not appear in index.js`);
    assert.equal(contractSource.includes(system), false, `"${system}" must not appear in requirement-artifact.js`);
    assert.equal(fileAdapterSource.includes(system), false, `"${system}" must not appear in requirements-file.js`);
    assert.equal(qualitySource.includes(system), false, `"${system}" must not appear in requirement-quality.js`);
    assert.equal(testDesignSource.includes(system), false, `"${system}" must not appear in test-design.js`);
    assert.equal(traceabilitySource.includes(system), false, `"${system}" must not appear in requirement-traceability.js`);
  }
});

test("RTI-4 public API: no test-management-destination system is coupled into the public surface or its own source text", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const forbiddenDestinations = ["testrail", "xray", "zephyr", "azure devops", "azure-devops"];
  const testDesignSource = fs.readFileSync(path.join(__dirname, "test-design.js"), "utf8").toLowerCase();
  for (const dest of forbiddenDestinations) {
    assert.equal(testDesignSource.includes(dest), false, `"${dest}" must not appear in test-design.js`);
  }
});

test("RTI-5 public API: no test-management-destination system is coupled into the public surface or its own source text", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const forbiddenDestinations = ["testrail", "xray", "zephyr", "azure devops", "azure-devops"];
  const traceabilitySource = fs.readFileSync(path.join(__dirname, "requirement-traceability.js"), "utf8").toLowerCase();
  for (const dest of forbiddenDestinations) {
    assert.equal(traceabilitySource.includes(dest), false, `"${dest}" must not appear in requirement-traceability.js`);
  }
});

test("RTI-5 public API: coverage/traceability behavior does not depend on requirement.source.type (source independence)", () => {
  const { analyzeRequirementsCoverage, buildRequirementTraceability } = require("./requirement-traceability");
  const base = { id: "REQ-SRC-EQUIV-RTI5", type: "requirement", title: "T", content: "c" };
  const testDesigns = [{ id: "T-1", requirementId: base.id, source: { requirementId: base.id } }];
  const viaFile = analyzeRequirementsCoverage([{ ...base, source: { type: "file", location: "x.json" } }], testDesigns);
  const viaFutureSystem = analyzeRequirementsCoverage([{ ...base, source: { type: "future-system", location: "x" } }], testDesigns);
  assert.deepEqual(JSON.parse(JSON.stringify(viaFile)), JSON.parse(JSON.stringify(viaFutureSystem)));

  const linksViaFile = buildRequirementTraceability([{ ...base, source: { type: "file", location: "x.json" } }], testDesigns);
  const linksViaFutureSystem = buildRequirementTraceability([{ ...base, source: { type: "future-system", location: "x" } }], testDesigns);
  assert.deepEqual(JSON.parse(JSON.stringify(linksViaFile)), JSON.parse(JSON.stringify(linksViaFutureSystem)));
});

test("RTI-3 public API: quality analysis behavior does not depend on artifact.source.type (source independence)", () => {
  const { analyzeRequirementQuality } = require("./requirement-quality");
  const base = {
    id: "REQ-SRC-EQUIV",
    type: "requirement",
    title: "T",
    content: "The search results should load quickly.",
  };
  const viaFile = analyzeRequirementQuality({ ...base, source: { type: "file", location: "x.json" } });
  const viaFutureSystem = analyzeRequirementQuality({ ...base, source: { type: "future-system", location: "x" } });
  assert.deepEqual(JSON.parse(JSON.stringify(viaFile)), JSON.parse(JSON.stringify(viaFutureSystem)));
});

test("RTI-4 public API: test design generation does not depend on artifact.source.type (source independence)", () => {
  const { generateTestDesign } = require("./test-design");
  const base = {
    id: "REQ-SRC-EQUIV-TD",
    type: "requirement",
    title: "T",
    content: "Return HTTP 200.",
  };
  const viaFile = generateTestDesign({ ...base, source: { type: "file", location: "x.json" } });
  const viaFutureSystem = generateTestDesign({ ...base, source: { type: "future-system", location: "x" } });
  assert.deepEqual(JSON.parse(JSON.stringify(viaFile)), JSON.parse(JSON.stringify(viaFutureSystem)));
});
