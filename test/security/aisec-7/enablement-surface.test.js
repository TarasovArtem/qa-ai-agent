"use strict";

/**
 * AISEC-7 H-12: enablement bypass and autonomy inheritance (SADR-11/12).
 *
 * Static module/manifest/resolver probes of the CURRENT package surface. They
 * read package.json and resolve module specifiers; they never pack, install or
 * publish anything. Actual installed-package proof belongs to
 * test/installation/** and to the later qa-agent-demo external E2E gate.
 * Nothing here activates MEM/RAG/LEARN, runs the Type & Schema Boundary
 * Audit, or makes private #22/#23 internals a supported surface.
 */

const nodeTest = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fx = require("./lib/fixtures");
const { OUTCOMES } = require("./lib/outcomes");
const { createEvidenceLedger } = require("./lib/execution-ledger");

const ledger = createEvidenceLedger(__filename);
const { confirmCase, targetOutcome } = ledger;

// Registered from this file so node:test attributes every result to it; the
// ledger records completion and refuses test options (SEC-02).
function test(name, fn) {
  return nodeTest(name, ledger.track(name, fn));
}
test.after = nodeTest.after;

const TA = path.join(fx.AI, "test-automation");
const publicApi = require(path.join(fx.AI, "index.js"));
const analyzeFailureModule = require(path.join(fx.AI, "analyze-failure.js"));
const { applyApprovedGeneratedChangeSet } = require(path.join(TA, "change-set-application"));
const { executeAppliedChangeSet } = require(path.join(TA, "controlled-execution"));

test.after(() => fx.cleanupRoots());

const DOCUMENTED_EXPORTS = [
  "collectContext", "collectHistory", "analyzeFailure", "aggregateBrowserContext",
  "assertValidProjectProfile", "assertValidFrameworkRuntimeConfig", "assertValidProjectKnowledgeConfig", "assertValidRepositoryRoot",
  "assertValidRequirementArtifact", "loadRequirementsFromFile", "analyzeRequirementQuality", "analyzeRequirementsQuality",
  "generateTestDesign", "generateTestDesigns", "assertValidTestDesignArtifact", "buildRequirementTraceability",
  "analyzeRequirementsCoverage", "loadRequirementsFromProvider", "publishTestDesigns",
];

const PRIVATE_MODULES = [
  "test-automation/generate-change-set", "test-automation/change-set-application", "test-automation/controlled-execution",
  "test-automation/regenerate-change-set", "test-automation/automation-plan-generator", "test-automation/generated-change-set-review-record",
];

function exportedFunctions(api) {
  const out = new Set();
  for (const value of Object.values(api)) {
    if (typeof value === "function") out.add(value);
    else if (value && typeof value === "object") for (const inner of Object.values(value)) if (typeof inner === "function") out.add(inner);
  }
  return out;
}

test("H12-C1: the public barrel exports exactly the documented symbols and no private #22/#23 function", () => {
  const exported = exportedFunctions(publicApi);
  const privateFunctions = PRIVATE_MODULES.flatMap((m) => Object.values(require(path.join(TA, m.split("/")[1]))).filter((v) => typeof v === "function"));
  privateFunctions.push(analyzeFailureModule.buildFailureReport, analyzeFailureModule.runProviderAnalysis);
  const leaked = privateFunctions.filter((fn) => exported.has(fn));
  confirmCase("H12-C1", JSON.stringify(Object.keys(publicApi).sort()) === JSON.stringify([...DOCUMENTED_EXPORTS].sort()) && leaked.length === 0);
});

test("H12-C2: the package exports map refuses deep private subpaths and the files list excludes private #22/#23 trees", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(fx.REPO_ROOT, "package.json"), "utf8"));
  const resolvedRoot = require.resolve(manifest.name);
  assert.equal(resolvedRoot, path.join(fx.AI, "index.js"), "the package name resolves to the public barrel");

  const refused = PRIVATE_MODULES.concat(["analyze-failure", "config"]).map((sub) => {
    try {
      require.resolve(`${manifest.name}/scripts/ai/${sub}`);
      return false;
    } catch (err) {
      return err.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
    }
  });
  const noWildcard = Object.keys(manifest.exports).every((k) => !k.includes("*"));
  const excluded = ["!scripts/ai/test-automation", "!scripts/ai/generation", "!scripts/ai/generative-test-design", "!scripts/ai/evaluation"].every((entry) => manifest.files.includes(entry));
  confirmCase("H12-C2", refused.every(Boolean) && noWildcard && excluded);
});

test("H12-C3: the XI-affected analyzer is exported with no disable or constraint switch (enablement scope is a release decision)", () => {
  assert.equal(publicApi.analyzeFailure.main, analyzeFailureModule.main, "the supported entry is the same main that reaches XI-01/XI-02 (see H05/H06)");
  const source = fs.readFileSync(path.join(fx.AI, "analyze-failure.js"), "utf8");
  const signature = source.match(/async function main\(\{([^}]*)\}/);
  assert.ok(signature, "main signature located");
  const options = signature[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(options, ["projectProfile", "repositoryRoot", "projectKnowledgeConfig"], "no option exists to disable or constrain copied context/history consumption");
  confirmCase("H12-C3", null);
});

test("H12-C4: an unsupported environment gets no shell fallback - a refused spawn is reported once, never retried with a shell", async () => {
  const reviewed = fx.buildReviewedPackage();
  const root = fx.makeCypressRoot("h12-no-shell");
  const applied = applyApprovedGeneratedChangeSet({
    expectedProjectId: reviewed.projectId, repositoryRoot: root, automationPlan: reviewed.plan, repositoryContext: reviewed.context,
    generatedChangeSet: reviewed.generatedChangeSet, reviewPackage: reviewed.reviewPackage, reviewRecord: fx.decide(reviewed), appliedAt: "2026-10-07T01:00:00.000Z",
  });
  assert.equal(applied.ok, true, JSON.stringify(applied.errors));

  let result;
  const calls = await fx.withSpawnInterceptor(async (spawnCalls) => {
    result = await executeAppliedChangeSet({ expectedProjectId: reviewed.projectId, repositoryRoot: root, automationPlan: reviewed.plan, generatedChangeSet: reviewed.generatedChangeSet, appliedChangeSetRecord: applied.appliedChangeSetRecord, executedAt: "2026-10-07T02:00:00.000Z" });
    return spawnCalls;
  }, { onSpawn: () => { throw Object.assign(new Error("spawn EINVAL (synthetic unsupported platform)"), { code: "EINVAL" }); } });

  assert.equal(result.automationExecutionRecord.status, "EXECUTION_ERROR");
  confirmCase("H12-C4", calls.length === 1 && calls.every((c) => c.options.shell === false));
});

test("H12-C5: no memory/retrieval/learning/autonomy capability exists and none inherits assurance; the target stays ARCHITECTURE_BLOCKED", () => {
  const FUTURE_WORDS = new Set(["mem", "memory", "rag", "retrieval", "retrieve", "learn", "learning", "autonomy", "autonomous"]);
  const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const isFutureSurface = (name) => words(name).some((w) => FUTURE_WORDS.has(w));
  const entries = fs.readdirSync(fx.AI, { withFileTypes: true }).map((e) => e.name);
  assert.deepEqual(entries.filter(isFutureSurface), [], "no MEM/RAG/LEARN/autonomy module present at this baseline");
  assert.deepEqual(Object.keys(publicApi).filter(isFutureSurface), [], "no such capability in the public surface");
  const outcome = targetOutcome("H12-C5");
  assert.equal(outcome, OUTCOMES.ARCHITECTURE_BLOCKED);
  assert.notEqual(outcome, OUTCOMES.PASS);
});
