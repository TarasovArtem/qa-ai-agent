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
const inv = require("../../helpers/package-inventory");
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

// Manifest-level `files` probe (ARCH-S3-m03). Since Controlled-v1 Stage 3
// (OD-02) the private #22/#23 trees are excluded as directories and only the
// exact Stage 3 private runtime closure is re-included file by file; every
// authority-bearing private module (approval gates / review records,
// application, execution, regeneration) must stay excluded. Returns the
// violations of that rule for a `files` list; the canonical lists come from
// test/helpers/package-inventory.js (no second inventory). The physical
// tarball proof stays in test/installation/**.
function privateFilesViolations(files) {
  const violations = [];
  const trees = inv.PRIVATE_TREES.map((t) => t.replace(/\/$/, ""));
  for (const tree of trees) if (!files.includes(`!${tree}`)) violations.push(`missing directory exclusion !${tree}`);
  files.forEach((entry, index) => {
    if (entry.startsWith("!")) return;
    if (/[*?[\]{}]/.test(entry)) {
      violations.push(`glob include ${entry}`);
      return;
    }
    const clean = entry.replace(/\/$/, "");
    for (const tree of trees) {
      if (clean === tree || clean.startsWith(`${tree}/`)) {
        if (!inv.STAGE3_PRIVATE_RUNTIME.includes(clean) && !inv.STAGE4_PRIVATE_RUNTIME.includes(clean)) violations.push(`re-includes ${clean}, which is not in the approved Stage 3/Stage 4A private runtime closures`);
      } else if (tree.startsWith(`${clean}/`)) {
        // A parent include (e.g. "scripts/ai") is safe only when the tree's
        // exclusion comes after it.
        const exclusion = files.indexOf(`!${tree}`);
        if (exclusion < index) violations.push(`${clean} is included after the !${tree} exclusion`);
      }
    }
  });
  for (const excluded of inv.EXCLUDED_PRIVATE) if (files.includes(excluded) || files.includes(`./${excluded}`)) violations.push(`re-includes excluded ${excluded}`);
  return violations;
}

test("H12-C2: private Stage 3/4A files stay unexported and only their exact private runtime closures ship", () => {
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

  // The authority-bearing modules this case is about are all in the
  // canonical excluded list, except the newly approved Stage 4A review gate
  // and apply implementation, which ship privately and remain unexported.
  for (const required of [
    "scripts/ai/generative-test-design/test-design-review-record.js",
    "scripts/ai/test-automation/controlled-execution.js",
    "scripts/ai/test-automation/regenerate-change-set.js",
  ]) {
    assert.ok(inv.EXCLUDED_PRIVATE.includes(required), `${required} is canonically excluded`);
  }
  for (const shipped of [
    "scripts/ai/test-automation/generated-change-set-review-record.js",
    "scripts/ai/test-automation/change-set-application.js",
  ]) assert.ok(inv.STAGE4_PRIVATE_RUNTIME.includes(shipped), `${shipped} is in the private Stage 4A closure`);
  const privateIncludes = manifest.files.filter((f) => !f.startsWith("!") && (inv.PRIVATE_TREES.some((t) => f.startsWith(t)) || inv.STAGE4_PRIVATE_RUNTIME.includes(f)));
  const exactClosure = JSON.stringify([...privateIncludes].sort()) === JSON.stringify([...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE4_PRIVATE_RUNTIME].sort());
  const current = privateFilesViolations(manifest.files);
  assert.deepEqual(current, [], "the current files list");
  assert.ok(exactClosure, "the only private re-includes are exactly the Stage 3 and Stage 4A private runtime closures");

  // Non-vacuity: each injected re-include of an authority-bearing module, a
  // whole private tree, a glob, or a parent include after the exclusions is
  // refused.
  const injections = [
    ...inv.EXCLUDED_PRIVATE.map((f) => [...manifest.files, f]),
    [...manifest.files, "scripts/ai/test-automation"],
    [...manifest.files, "scripts/ai/test-automation/*.js"],
    [...manifest.files, "scripts/ai/generative-test-design/**"],
    manifest.files.filter((f) => f !== "!scripts/ai/test-automation"),
    [...manifest.files, "scripts/ai"],
  ];
  const injectionsRefused = injections.every((files) => privateFilesViolations(files).length > 0);
  assert.ok(injectionsRefused, "every injected forbidden re-include is detected");

  confirmCase("H12-C2", refused.every(Boolean) && noWildcard && current.length === 0 && exactClosure && injectionsRefused);
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
