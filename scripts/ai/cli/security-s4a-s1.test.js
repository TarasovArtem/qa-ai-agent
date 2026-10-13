"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const artifacts = require("./run-artifacts");
const { assertPathIdentity } = require("./path-identity");
const { hostilePathSets } = require("../../../test/helpers/ppi1-path-vectors");
const fx = require("../../../test/helpers/stage3-fixtures");
const { cleanupScratch, runCli, generativeDoubleSpawn, scratch, spawnRecorder } = require("../../../test/helpers/qa-agent-cli");
const { buildGeneratedChangeSet, computeDigest, LABEL_PLAN_BINDING, LABEL_FILE_CONTENT, recomputeChangeSetDigest } = require("../test-automation/generated-change-set");
const { buildGeneratedChangeSetReviewPackage, recomputeReviewPackageDigest } = require("../test-automation/generated-change-set-review-package");

after(cleanupScratch);
const scriptDir = scratch("qa-agent-security-s1-scripts-");
const options = { projectId: fx.PROJECT_ID, framework: fx.FRAMEWORK };
const config = fx.stage3Config();
const design = { requirementModel: fx.requirementModel(), testCaseModel: fx.testCaseModel(), automationCandidates: [fx.candidate("tc-1", "AUTOMATE", "ac-1"), fx.candidate("tc-2", "DO_NOT_AUTOMATE", "ac-2")] };
const entry = (kind, value) => ({ kind, value });
const planFor = (paths, operation = "CREATE", framework = "cypress") => fx.automationPlan({ framework, plannedChanges: paths.map(p => ({ path: p, operation, purpose: "Cover the login flow." })) });
const context = { projectId: fx.PROJECT_ID, framework: "cypress", repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] };

function build(plan, repositoryContext = context, changes = plan.plannedChanges.map(c => ({ path: c.path, operation: c.operation, content: fx.GENERATED_CONTENT, baseContentDigest: null }))) {
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext, changes, expectedProjectId: fx.PROJECT_ID });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const packaged = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext, generatedChangeSet: result.generatedChangeSet });
  assert.equal(packaged.ok, true, JSON.stringify(packaged.errors));
  return { generatedChangeSet: result.generatedChangeSet, reviewPackage: packaged.reviewPackage };
}

const valid = build(planFor([fx.GENERATED_SPEC]));

for (const paths of hostilePathSets) {
  test(`SEC-S4A-01: canonical hostile targets fail fresh and persisted plan/generate: ${JSON.stringify(paths)}`, () => {
    assert.throws(() => assertPathIdentity(paths, "cypress"), { code: "PATH_IDENTITY_REFUSED" });
    const plan = planFor(paths);
    assert.ok(artifacts.validatePlans({ ...design, automationPlans: [plan] }, options).length > 0);
    assert.throws(() => artifacts.readPlan([entry("AutomationRepositoryContext", context), entry("AutomationPlan", plan)], design, config), { code: "RUN_ARTIFACT_INVALID", exitCode: 4 });

    // Rebind all digests. CON and other paths permitted by #23D have a
    // fully canonical package, so digest/schema rejection cannot mask S1.
    const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: paths.map(p => ({ path: p, operation: "CREATE", content: fx.GENERATED_CONTENT, baseContentDigest: null })) });
    let cs, rp;
    if (built.ok) {
      cs = built.generatedChangeSet;
      rp = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: cs }).reviewPackage;
      assert.ok(rp);
    } else {
      cs = { ...valid.generatedChangeSet, automationPlanDigest: computeDigest(LABEL_PLAN_BINDING, plan), changes: paths.map(p => ({ ...valid.generatedChangeSet.changes[0], path: p })) };
      cs.changeSetDigest = recomputeChangeSetDigest(cs);
      rp = { ...valid.reviewPackage, changeSetDigest: cs.changeSetDigest, reviewTargets: paths.map(p => ({ ...valid.reviewPackage.reviewTargets[0], path: p })) };
      rp.packageDigest = recomputeReviewPackageDigest(rp);
    }
    assert.equal(recomputeChangeSetDigest(cs), cs.changeSetDigest);
    assert.equal(recomputeReviewPackageDigest(rp), rp.packageDigest);
    const input = { automationPlans: [plan], repositoryContext: context, generatedChangeSets: [cs] };
    const fresh = artifacts.validateGenerated(input, options);
    assert.ok(fresh.codes.length > 0);
    assert.equal(fresh.reviewPackages, undefined, "no accepted package on refusal");
    if (built.ok) assert.deepEqual(fresh.codes, ["INVALID_PATH"], "canonical PPI-1 must refuse otherwise valid generated artifacts");
    assert.throws(() => artifacts.readGenerate([entry("GeneratedChangeSet", cs), entry("GeneratedChangeSetReviewPackage", rp)], design, { automationPlans: [plan], repositoryContext: context }, config), { code: "RUN_ARTIFACT_INVALID", exitCode: 4 });
  });
}

for (const framework of ["cypress", "playwright"]) for (const operation of ["CREATE", "MODIFY"]) {
  test(`SEC-S4A-01: valid nested ${framework} ${operation} survives fresh/persisted validation`, () => {
    const target = framework === "cypress" ? fx.GENERATED_SPEC : "playwright/tests/nested/login.spec.js";
    const plan = planFor([target], operation, framework);
    const oldContent = "describe('old', () => {});\n";
    const repositoryContext = { ...context, framework, repositoryEvidence: operation === "MODIFY" ? [{ evidenceRef: { location: target }, content: oldContent }] : [] };
    const { generatedChangeSet: cs, reviewPackage: rp } = build(plan, repositoryContext, [{ operation, path: target, content: fx.GENERATED_CONTENT, baseContentDigest: operation === "MODIFY" ? computeDigest(LABEL_FILE_CONTENT, oldContent) : null }]);
    const aligned = { ...design, automationCandidates: design.automationCandidates.map(c => ({ ...c, targetFrameworks: [framework] })) };
    const opts = { ...options, framework }, cfg = { ...config, framework };
    assert.deepEqual(artifacts.validatePlans({ ...aligned, automationPlans: [plan] }, opts), []);
    assert.equal(artifacts.readPlan([entry("AutomationRepositoryContext", repositoryContext), entry("AutomationPlan", plan)], aligned, cfg).automationPlans[0], plan);
    assert.deepEqual(artifacts.validateGenerated({ automationPlans: [plan], repositoryContext, generatedChangeSets: [cs], persistedPackages: [rp] }, opts), { codes: [], reviewPackages: [rp] });
    assert.deepEqual(artifacts.readGenerate([entry("GeneratedChangeSet", cs), entry("GeneratedChangeSetReviewPackage", rp)], aligned, { automationPlans: [plan], repositoryContext }, cfg).reviewPackages, [rp]);
  });
}

function runDir(root, runId) { return path.join(root, "reports/qa-agent/runs", runId); }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function stage(command, root, responses, runId) {
  const spawn = generativeDoubleSpawn(fx.writeScript(scriptDir, responses));
  const r = await runCli([command, ...(runId ? ["--run", runId] : []), "--root", root, "--json"], { env: fx.generativeEnv(), spawnImpl: spawn.impl });
  return { ...r, calls: spawn.calls };
}
async function designed() {
  const root = fx.makeStage3Root();
  const r = await stage("design", root, fx.RESPONSES.design());
  assert.equal(r.code, 0, r.stderr);
  return { root, runId: r.json.runId };
}
function rewrite(root, runId, rel, value) {
  const dir = runDir(root, runId), bytes = Buffer.from(JSON.stringify(value) + "\n");
  fs.writeFileSync(path.join(dir, rel), bytes);
  const manifest = read(path.join(dir, "manifest.json"));
  for (const s of manifest.stages) for (const a of s.artifacts) if (a.path === rel) a.sha256 = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest) + "\n");
}
function refused(r, code, reason) {
  assert.equal(r.code, code, r.stderr);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.errors[0].code, reason);
  assert.equal((r.stdout + r.stderr).includes("CON.cy.js"), false, "hostile path is withheld");
}

test("SEC-S4A-01: real plan hostile CON provider output exits 6 before plan persistence", async () => {
  const { root, runId } = await designed(), dir = runDir(root, runId);
  const before = fs.readFileSync(path.join(dir, "manifest.json"));
  const r = await stage("plan", root, [fx.json(planFor(["cypress/e2e/generated/CON.cy.js"]))], runId);
  refused(r, 6, "PROVIDER_OUTPUT_REFUSED");
  assert.equal(r.calls.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(dir, "manifest.json")), before);
  assert.equal(fs.existsSync(path.join(dir, "plan")), false);
});

test("SEC-S4A-01: real generate hostile CON provider response exits 6 without accepted generated/package output", async () => {
  const { root, runId } = await designed(), dir = runDir(root, runId);
  assert.equal((await stage("plan", root, fx.RESPONSES.plan(), runId)).code, 0);
  const before = fs.readFileSync(path.join(dir, "manifest.json"));
  const r = await stage("generate", root, [fx.json(fx.changeSetResponse({ path: "cypress/e2e/generated/CON.cy.js" }))], runId);
  refused(r, 6, "PROVIDER_FAILURE");
  assert.equal(r.calls.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(dir, "manifest.json")), before);
  assert.equal(fs.existsSync(path.join(dir, "generate")), false);
});

test("SEC-S4A-01: digest-consistent persisted CON plan exits 4 before generate provider spawn", async () => {
  const { root, runId } = await designed();
  assert.equal((await stage("plan", root, fx.RESPONSES.plan(), runId)).code, 0);
  rewrite(root, runId, "plan/automation-plan-0001.json", planFor(["cypress/e2e/generated/CON.cy.js"]));
  const before = fx.snapshotTree(root, { exclude: [] });
  const r = await stage("generate", root, [fx.json(fx.changeSetResponse({ path: "cypress/e2e/generated/CON.cy.js" }))], runId);
  refused(r, 4, "RUN_ARTIFACT_INVALID");
  assert.deepEqual(r.calls, []);
  assert.deepEqual(fx.snapshotTree(root, { exclude: [] }), before);
});

test("SEC-S4A-01: persisted CON generated/package input exits 4 with no writes or spawn", async () => {
  const { root, runId } = await designed(), dir = runDir(root, runId);
  assert.equal((await stage("plan", root, fx.RESPONSES.plan(), runId)).code, 0);
  assert.equal((await stage("generate", root, fx.RESPONSES.generate(), runId)).code, 0);
  const plan = planFor(["cypress/e2e/generated/CON.cy.js"]);
  const liveContext = read(path.join(dir, "plan/automation-repository-context.json"));
  const { generatedChangeSet: cs, reviewPackage: rp } = build(plan, liveContext);
  // Isolate persisted-generated validation from the earlier plan gate.
  assert.throws(() => artifacts.readGenerate([entry("GeneratedChangeSet", cs), entry("GeneratedChangeSetReviewPackage", rp)], design, { automationPlans: [plan], repositoryContext: liveContext }, config), { exitCode: 4, code: "RUN_ARTIFACT_INVALID" });
  for (const [rel, value] of [["plan/automation-plan-0001.json", plan], ["generate/generated-change-set-0001.json", cs], ["generate/review-package-0001.json", rp]]) rewrite(root, runId, rel, value);
  const before = fx.snapshotTree(root, { exclude: [] }), rec = spawnRecorder();
  const r = await runCli(["review", "show", "--root", root, "--run", runId, "--json"], { spawnImpl: rec.impl });
  refused(r, 4, "RUN_ARTIFACT_INVALID");
  assert.deepEqual(rec.calls, []);
  assert.deepEqual(fx.snapshotTree(root, { exclude: [] }), before);
});

test("SEC-S4A-01: real positive plan/generate accepts normal and nested CREATE proposals without source writes", async () => {
  for (const target of [fx.GENERATED_SPEC, "cypress/e2e/generated/nested/login.cy.js"]) {
    const { root, runId } = await designed(), before = fx.snapshotTree(root);
    const p = await stage("plan", root, [fx.json(planFor([target]))], runId);
    assert.equal(p.code, 0, p.stderr);
    const g = await stage("generate", root, [fx.json(fx.changeSetResponse({ path: target }))], runId);
    assert.equal(g.code, 0, g.stderr);
    const r = await runCli(["review", "show", "--root", root, "--run", runId, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.reviewPackages[0].reviewPackage.reviewTargets[0].path, target);
    assert.deepEqual(fx.snapshotTree(root), before);
  }
});
