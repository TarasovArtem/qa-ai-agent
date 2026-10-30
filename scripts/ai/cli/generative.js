/**
 * `qa-agent design | plan | generate` - Controlled-v1 Stage 3 orchestration
 * (OD-02; contract §10.2, §10.4.5, §10.5, §14).
 *
 * Runs after cli.js has completed validation steps 1-11 (usage, root,
 * config, containment, offline, generative provider, providers.allow,
 * credentials, capability). Per command:
 *
 *   1. input      requirements -> evidence; for plan/generate: the run
 *                 manifest + binding + stage order + every upstream artifact
 *                 (digest, schema, semantics) - all before any provider
 *                 call; refusals exit 4
 *   2. authorize  the run-directory write target (exit 5 on a protected or
 *                 escaping redirect) - still before any provider call
 *   3. generate   the existing provider-backed generators, in an isolated
 *                 child (generative-runner.js) whose environment is the
 *                 closed buildGenerativeEnv() object
 *   4. validate   the child's output with the same validators used on reload
 *                 (run-artifacts.js); review packages are built here, in
 *                 the parent, from validated data only
 *   5. commit     safe writes of the artifacts, then the manifest
 *
 * Proposal only: nothing here writes outside the run directory, modifies a
 * target source file, applies a GeneratedChangeSet, executes anything,
 * touches Git or GitHub, records or reads an approval, or calls an approval
 * gate. Child diagnostics are never forwarded (provider output
 * confidentiality); failures surface as fixed messages with closed-vocabulary
 * reason codes.
 */

"use strict";

const { readEnv } = require("./env");
const { buildGenerativeEnv } = require("./child-env");
const { runStageProcess } = require("./stage-process");
const { CliError, EXIT_CODES, configError, inputRefused, authorityRefused, providerFailure } = require("./errors");
const store = require("./run-store");
const artifacts = require("./run-artifacts");

const STEP_LABELS = Object.freeze({
  requirementModel: "RequirementModel",
  testCaseModel: "TestCaseModel",
  automationCandidate: "AutomationCandidate",
  automationPlan: "AutomationPlan",
  generatedChangeSet: "GeneratedChangeSet",
});

// --- child process ------------------------------------------------------------------

function classifyChildFailure(stage, outcome) {
  if (outcome.spawnError) return new CliError(EXIT_CODES.INTERNAL, "STAGE_SPAWN_FAILED", `the ${stage} generation process could not be started.`);
  const failure = outcome.result && outcome.result.failure;
  if (!failure || typeof failure !== "object") return new CliError(EXIT_CODES.INTERNAL, "STAGE_FAILED", `the ${stage} generation process ended without a result.`);
  if (failure.kind === "authority") return authorityRefused("CAPABILITY_REQUIRES_GENERATIVE_PROVIDER", "the generation process refused a non-generative provider.");
  if (failure.kind === "provider-configuration") return configError("PROVIDER_CONFIGURATION_INVALID", "the generative provider could not be configured (check AI_MODEL / AI_API_KEY).");
  if (failure.kind === "generation") {
    const step = Object.prototype.hasOwnProperty.call(STEP_LABELS, failure.step) ? STEP_LABELS[failure.step] : "generation";
    const attempts = Number.isInteger(failure.providerAttempts) && failure.providerAttempts >= 0 ? failure.providerAttempts : 0;
    const codes = artifacts.sanitizeCodes(failure.codes).join(", ");
    // OD-265-B1-C1: providerAttempts counts only the failing call. The plan
    // step makes one coordinated call per candidate, so earlier candidates
    // may already have called the provider.
    if (attempts === 0 && failure.step === "automationPlan") {
      return inputRefused("GENERATION_INPUT_REFUSED", `the ${step} step refused one candidate's input before any provider call for that candidate (reason codes: ${codes}); earlier candidates of this step may already have called the provider; nothing was written.`);
    }
    if (attempts === 0) return inputRefused("GENERATION_INPUT_REFUSED", `the ${step} step refused its input before any provider call (reason codes: ${codes}).`);
    return providerFailure("PROVIDER_FAILURE", `the ${step} step failed after ${attempts} provider attempt(s) (reason codes: ${codes}); provider output is withheld.`);
  }
  return new CliError(EXIT_CODES.INTERNAL, "STAGE_FAILED", `the ${stage} generation process failed.`);
}

async function runGenerativeChild(stage, payload, { root, env, platform, provider, spawnImpl, diagnostics }) {
  const childEnv = buildGenerativeEnv({ env, platform, provider });
  const secrets = [readEnv(env, "AI_API_KEY", platform)].filter(Boolean);
  let withheld = 0;
  const outcome = await runStageProcess({
    stage,
    payload,
    env: childEnv,
    cwd: root.realRoot,
    secrets,
    spawnImpl,
    runner: "generative",
    diagnostics: (text) => {
      withheld += text.length;
    },
  });
  if (withheld > 0 && diagnostics) diagnostics(`[qa-agent] ${withheld} characters of ${stage} process diagnostics withheld (provider output is never forwarded)\n`);
  if (!(outcome.result && outcome.result.ok === true && outcome.exitCode === 0)) throw classifyChildFailure(stage, outcome);
  const out = outcome.result.artifacts;
  if (!out || typeof out !== "object" || Array.isArray(out)) throw providerOutputRefused(stage, ["INVALID_TYPE"]);
  return out;
}

function providerOutputRefused(stage, codes) {
  return providerFailure("PROVIDER_OUTPUT_REFUSED", `the ${stage} output failed runtime validation (reason codes: ${artifacts.sanitizeCodes(codes).join(", ")}); nothing was written.`);
}

// --- shared steps ----------------------------------------------------------------------

const { requireRequirements, openRun, loadDesignStage, loadPlanStage } = artifacts;

function relArtifacts(runDirRel, manifest, stage) {
  return manifest.stages.find((s) => s.stage === stage).artifacts.map((a) => `${runDirRel}/${a.path}`);
}

function providerProvenance(ctx) {
  return { provider: ctx.provider.effective, model: readEnv(ctx.env, "AI_MODEL", ctx.platform) };
}

// --- design ---------------------------------------------------------------------------

async function runDesign(ctx) {
  const { root, config, protectedPaths, product } = ctx;
  const projectId = config.projectProfile.id;
  const evidence = artifacts.loadEvidence(root, config);
  const projection = store.computeProjection(config, evidence.requirementsDigest);
  const runId = store.newRunId(ctx.now());
  const runDirRel = store.runDirectoryRel(config, runId);
  store.createRunDirectory(root, runDirRel, protectedPaths);

  const out = await runGenerativeChild(
    "design",
    { evidenceBundle: evidence.evidenceBundle, projectId, projectProfile: config.projectProfile, frameworkCapability: artifacts.frameworkCapability(config) },
    ctx
  );
  const design = { requirementModel: out.requirementModel, testCaseModel: out.testCaseModel, automationCandidates: out.automationCandidates };
  const codes = artifacts.validateDesign(design, { evidenceBundle: evidence.evidenceBundle, projectId, framework: config.framework });
  if (codes.length > 0) throw providerOutputRefused("design", codes);

  const files = [
    { path: "design/requirement-model.json", kind: "RequirementModel", value: design.requirementModel },
    { path: "design/test-case-model.json", kind: "TestCaseModel", value: design.testCaseModel },
    ...design.automationCandidates.map((value, i) => ({ path: `design/automation-candidate-${artifacts.ordinal(i)}.json`, kind: "AutomationCandidate", value })),
  ];
  const now = ctx.now();
  const manifest = store.commitStage(root, runDirRel, protectedPaths, {
    manifest: store.newManifest({ runId, product, projection, createdAt: now.toISOString() }),
    previousDigest: null,
    stage: "design",
    files,
    ...providerProvenance(ctx),
    now,
  });

  const decisions = {};
  for (const c of design.automationCandidates) decisions[c.decision] = (decisions[c.decision] || 0) + 1;
  const summary = {
    requirements: design.requirementModel.requirements.length,
    testCases: design.testCaseModel.testCases.length,
    automationCandidates: design.automationCandidates.length,
    decisions,
  };
  return {
    runId,
    summary,
    artifacts: [`${runDirRel}/${store.MANIFEST_FILE_NAME}`, ...relArtifacts(runDirRel, manifest, "design")],
    human: [
      `design: run ${runId}`,
      `requirements: ${summary.requirements}, test cases: ${summary.testCases}, automation candidates: ${summary.automationCandidates} (${Object.entries(decisions).map(([k, v]) => `${k}=${v}`).join(", ")})`,
      `artifacts: ${runDirRel}/`,
      `next: qa-agent plan --run ${runId}`,
    ],
  };
}

// --- plan -------------------------------------------------------------------------------

async function runPlan(ctx) {
  const { root, config, protectedPaths } = ctx;
  const projectId = config.projectProfile.id;
  const run = openRun(ctx, "plan");
  const design = loadDesignStage(run, config);
  const automate = artifacts.automateCandidates(design.automationCandidates);
  if (automate.length === 0) throw inputRefused("NO_AUTOMATE_CANDIDATE", "the design stage of this run produced no AUTOMATE candidate; there is nothing to plan.");
  // OD-265-B1: each candidate's exact TestCase/Requirement scope for the
  // child's coordinated planning; the run-wide rule below stays the gate.
  const planScopes = artifacts.buildPlanScopes(design, automate);
  const repositoryContext = artifacts.buildLiveRepositoryContext(root, config);

  const out = await runGenerativeChild("plan", { automationCandidates: automate, planScopes, repositoryContext, projectId }, ctx);
  const codes = artifacts.validatePlans({ ...design, automationPlans: out.automationPlans }, { projectId, framework: config.framework });
  if (codes.length > 0) throw providerOutputRefused("plan", codes);

  const files = [
    { path: "plan/automation-repository-context.json", kind: "AutomationRepositoryContext", value: repositoryContext },
    ...out.automationPlans.map((value, i) => ({ path: `plan/automation-plan-${artifacts.ordinal(i)}.json`, kind: "AutomationPlan", value })),
  ];
  const manifest = store.commitStage(root, run.runDirRel, protectedPaths, {
    manifest: run.manifest,
    previousDigest: run.digest,
    stage: "plan",
    files,
    ...providerProvenance(ctx),
    now: ctx.now(),
  });
  const summary = { automationPlans: out.automationPlans.length, plannedChanges: out.automationPlans.reduce((n, p) => n + p.plannedChanges.length, 0) };
  return {
    runId: ctx.runId,
    summary,
    artifacts: [`${run.runDirRel}/${store.MANIFEST_FILE_NAME}`, ...relArtifacts(run.runDirRel, manifest, "plan")],
    human: [
      `plan: run ${ctx.runId}`,
      `automation plans: ${summary.automationPlans}, planned changes: ${summary.plannedChanges} (proposal only; nothing written to the repository)`,
      `next: qa-agent generate --run ${ctx.runId}`,
    ],
  };
}

// --- generate -----------------------------------------------------------------------------

async function runGenerate(ctx) {
  const { root, config, protectedPaths } = ctx;
  const projectId = config.projectProfile.id;
  const run = openRun(ctx, "generate");
  const design = loadDesignStage(run, config);
  const plan = loadPlanStage(run, design, config);
  if (!artifacts.sameContext(plan.repositoryContext, artifacts.buildLiveRepositoryContext(root, config))) {
    throw inputRefused("REPOSITORY_CONTEXT_STALE", "the repository changed since \"plan\" built its context (framework config or package.json scripts); start a new run.");
  }

  const out = await runGenerativeChild("generate", { automationPlans: plan.automationPlans, repositoryContext: plan.repositoryContext, projectId }, ctx);
  const checked = artifacts.validateGenerated(
    { automationPlans: plan.automationPlans, repositoryContext: plan.repositoryContext, generatedChangeSets: out.generatedChangeSets },
    { projectId }
  );
  if (checked.codes.length > 0) throw providerOutputRefused("generate", checked.codes);

  const files = [];
  out.generatedChangeSets.forEach((value, i) => {
    files.push({ path: `generate/generated-change-set-${artifacts.ordinal(i)}.json`, kind: "GeneratedChangeSet", value });
    files.push({ path: `generate/review-package-${artifacts.ordinal(i)}.json`, kind: "GeneratedChangeSetReviewPackage", value: checked.reviewPackages[i] });
  });
  const manifest = store.commitStage(root, run.runDirRel, protectedPaths, {
    manifest: run.manifest,
    previousDigest: run.digest,
    stage: "generate",
    files,
    ...providerProvenance(ctx),
    now: ctx.now(),
  });
  const summary = {
    generatedChangeSets: out.generatedChangeSets.length,
    reviewPackages: checked.reviewPackages.length,
    reviewTargets: checked.reviewPackages.reduce((n, p) => n + p.reviewTargets.length, 0),
  };
  return {
    runId: ctx.runId,
    summary,
    artifacts: [`${run.runDirRel}/${store.MANIFEST_FILE_NAME}`, ...relArtifacts(run.runDirRel, manifest, "generate")],
    human: [
      `generate: run ${ctx.runId}`,
      `change sets: ${summary.generatedChangeSets}, review packages: ${summary.reviewPackages}, review targets: ${summary.reviewTargets}`,
      "proposal only: no file was applied; review record / apply remain disabled in this release",
      `next: qa-agent review show --run ${ctx.runId}`,
    ],
  };
}

const RUNNERS = Object.freeze({ design: runDesign, plan: runPlan, generate: runGenerate });

/**
 * @param {object} ctx { stage, runId, root, config, protectedPaths, provider,
 *   env, platform, spawnImpl, diagnostics, product, now }
 */
async function runGenerativeCommand(ctx) {
  requireRequirements(ctx.config);
  return RUNNERS[ctx.stage]({ now: () => new Date(), ...ctx });
}

module.exports = { runGenerativeCommand, classifyChildFailure };
