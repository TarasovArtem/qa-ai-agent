/**
 * Stage 3 artifact loading and runtime validation - the single place where
 * every design/plan/generate trust boundary is checked, both for fresh
 * generator output coming back from the generative child process and for
 * persisted run artifacts re-read by a later command (untrusted at reload,
 * TSB-F01/F03 posture).
 *
 * Only existing validators are composed here; nothing is re-implemented:
 *
 *   requirements   loadRequirementsFromFile (RTI-2) ->
 *                  ingestRequirementArtifactsAsEvidence (#22B, ACG-A3)
 *   design         validateGenerationChain (frozen F0 cross-model rules),
 *                  checkCanonicalProvenance (#22C), validateFrameworkAuthorization
 *                  + validateEvidenceProvenance (#22E-R1), one candidate per
 *                  test case in TestCaseModel order
 *   plan           validateGenerationChain incl. plans, one plan per AUTOMATE
 *                  candidate, config framework; the repository context is
 *                  rebuilt from the live repository (#23B) and must equal the
 *                  persisted one exactly; target paths satisfy PPI-1 per plan
 *                  and are collision-free across all plans (OD-265-A1)
 *   generate       validateGeneratedChangeSet (#23D, TSB-F01) per plan, and
 *                  the review package rebuilt with
 *                  buildGeneratedChangeSetReviewPackage (#23E) must equal the
 *                  persisted one exactly; PPI-1 precedes package construction
 *
 * Validators return closed-vocabulary reason codes only (never validator
 * messages or paths, which can quote model-chosen key names). No module
 * reachable from here reads an approval record or calls an approval gate
 * (DC-F02-1..3).
 */

"use strict";

const { loadRequirementsFromFile } = require("../requirements-file");
const { ingestRequirementArtifactsAsEvidence } = require("../generative-test-design/evidence-ingestion");
const { checkCanonicalProvenance } = require("../generative-test-design/requirement-model-generator");
const { validateFrameworkAuthorization, validateEvidenceProvenance, buildTrustedEvidenceRegistry } = require("../generative-test-design/automation-candidate-generator");
const { validateGenerationChain } = require("../generation/cross-model-validation");
const { ERROR_CODES } = require("../generation/errors");
const { PROVIDER_ERROR_CODES } = require("../providers/provider-error");
const { buildAutomationRepositoryContext } = require("../test-automation/automation-repository-context");
const { validateGeneratedChangeSet } = require("../test-automation/generated-change-set");
const { buildGeneratedChangeSetReviewPackage, recomputeReviewPackageDigest } = require("../test-automation/generated-change-set-review-package");
const { configError, inputRefused } = require("./errors");
const { assertPathIdentity, asciiFold } = require("./path-identity");
const store = require("./run-store");

const { requirementsDigest, canonicalJson } = store;

const KNOWN_CODES = new Set([...Object.values(ERROR_CODES), ...Object.values(PROVIDER_ERROR_CODES)]);
const MAX_REPORTED_CODES = 8;

function codesOf(errors) {
  const out = [];
  for (const e of Array.isArray(errors) ? errors : []) {
    const code = e && KNOWN_CODES.has(e.code) ? e.code : "UNKNOWN";
    if (!out.includes(code)) out.push(code);
    if (out.length >= MAX_REPORTED_CODES) break;
  }
  return out;
}

function sanitizeCodes(codes) {
  const out = [];
  for (const code of Array.isArray(codes) ? codes : []) {
    const safe = KNOWN_CODES.has(code) ? code : "UNKNOWN";
    if (!out.includes(safe)) out.push(safe);
    if (out.length >= MAX_REPORTED_CODES) break;
  }
  return out.length > 0 ? out : ["UNKNOWN"];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ordinal(i) {
  return String(i + 1).padStart(4, "0");
}

// --- requirements -> evidence ------------------------------------------------------

// The requirements file is digested before and after it is loaded; a change
// in between is refused, so the evidence and the run projection describe the
// same bytes.
function loadEvidence(root, config) {
  const before = requirementsDigest(root, config);
  let artifacts;
  try {
    artifacts = loadRequirementsFromFile({ repositoryRoot: root.realRoot, filePath: config.requirements.path });
  } catch (err) {
    throw inputRefused("REQUIREMENTS_INPUT_REFUSED", (err && err.message) || "the requirements input was refused.");
  }
  if (requirementsDigest(root, config) !== before) {
    throw inputRefused("REQUIREMENTS_CHANGED_DURING_READ", "the requirements file changed while it was being read.");
  }
  const ingested = ingestRequirementArtifactsAsEvidence({ projectId: config.projectProfile.id, artifacts }, { expectedProjectId: config.projectProfile.id });
  if (!ingested.ok) {
    throw inputRefused("REQUIREMENTS_EVIDENCE_REFUSED", `the requirements cannot be represented as design evidence (reason codes: ${codesOf(ingested.errors).join(", ")}).`);
  }
  return { evidenceBundle: ingested.bundle, requirementsDigest: before, requirementCount: artifacts.length };
}

function frameworkCapability(config) {
  return { projectId: config.projectProfile.id, supportedFrameworks: [config.framework] };
}

// --- design ---------------------------------------------------------------------------

function validateDesign({ requirementModel, testCaseModel, automationCandidates }, { evidenceBundle, projectId, framework }) {
  if (!Array.isArray(automationCandidates) || automationCandidates.length === 0) return [ERROR_CODES.MISSING_FIELD];
  const chain = validateGenerationChain({ requirementModel, testCaseModel, automationCandidates }, { expectedProjectId: projectId });
  if (!chain.ok) return codesOf(chain.errors);

  const errors = [];
  const registry = new Map(evidenceBundle.evidenceItems.map((item) => [item.evidenceRef.id, item.evidenceRef]));
  errors.push(...checkCanonicalProvenance(requirementModel.evidenceRefs, registry));

  if (automationCandidates.length !== testCaseModel.testCases.length) errors.push({ code: ERROR_CODES.INVALID_REFERENCE });
  const ids = new Set();
  const trusted = buildTrustedEvidenceRegistry(requirementModel);
  automationCandidates.forEach((candidate, i) => {
    const testCase = testCaseModel.testCases[i];
    if (!testCase || candidate.testCaseId !== testCase.id) errors.push({ code: ERROR_CODES.INVALID_REFERENCE });
    if (ids.has(candidate.id)) errors.push({ code: ERROR_CODES.DUPLICATE_ID });
    ids.add(candidate.id);
    errors.push(...validateFrameworkAuthorization(candidate, [framework]));
    errors.push(...validateEvidenceProvenance(candidate, trusted));
  });
  return codesOf(errors);
}

function automateCandidates(automationCandidates) {
  return automationCandidates.filter((c) => c.decision === "AUTOMATE");
}

// OD-265-B1: the planning scope of each AUTOMATE candidate, in candidate
// order, resolved by exact id equality only: candidate.testCaseId -> the one
// TestCase with that id -> its requirementIds -> the one Requirement with
// each id (first occurrence; a repeated id is listed once). Never by
// candidate position or id format. Only the provider-visible fields are
// copied, plus candidateId for the child's binding check. An unresolved
// (INVALID_REFERENCE) or ambiguous (DUPLICATE_ID) reference refuses the run
// as an invalid persisted design before any child exists; after
// validateDesign that is unreachable (defense in depth).
function buildPlanScopes({ requirementModel, testCaseModel }, automate) {
  const errors = [];
  const index = (items) => {
    const byId = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const id = item && typeof item === "object" ? item.id : undefined;
      if (byId.has(id)) errors.push({ code: ERROR_CODES.DUPLICATE_ID });
      else byId.set(id, item);
    }
    return byId;
  };
  const testCases = index(testCaseModel && testCaseModel.testCases);
  const requirements = index(requirementModel && requirementModel.requirements);
  const scopes = automate.map((candidate) => {
    const testCase = typeof candidate.testCaseId === "string" ? testCases.get(candidate.testCaseId) : undefined;
    if (!testCase || !Array.isArray(testCase.requirementIds)) {
      errors.push({ code: ERROR_CODES.INVALID_REFERENCE });
      return null;
    }
    const ids = [...new Set(testCase.requirementIds)];
    const referenced = ids.map((id) => requirements.get(id));
    if (referenced.includes(undefined)) errors.push({ code: ERROR_CODES.INVALID_REFERENCE });
    return {
      candidateId: candidate.id,
      testCase: { id: testCase.id, title: testCase.title, objective: testCase.objective },
      requirements: referenced.filter(Boolean).map((r) => ({ id: r.id, text: r.text })),
    };
  });
  if (errors.length > 0) throw persistedInvalid("design", codesOf(errors));
  return scopes;
}

// --- plan -------------------------------------------------------------------------------

function buildLiveRepositoryContext(root, config) {
  const r = buildAutomationRepositoryContext({ repoRoot: root.realRoot, projectProfile: config.projectProfile, framework: config.framework, relevantFiles: [] });
  if (!r.ok) {
    throw inputRefused(
      "REPOSITORY_CONTEXT_REFUSED",
      `the repository context could not be built: the framework config (cypress.config.js / playwright.config.js) and a package.json with a "scripts" object are required at the root (reason codes: ${codesOf(r.errors).join(", ")}).`
    );
  }
  return r.context;
}

function validatePlans({ requirementModel, testCaseModel, automationCandidates, automationPlans }, { projectId, framework }) {
  const automate = automateCandidates(automationCandidates);
  if (!Array.isArray(automationPlans) || automationPlans.length !== automate.length) return [ERROR_CODES.INVALID_REFERENCE];
  const chain = validateGenerationChain({ requirementModel, testCaseModel, automationCandidates, automationPlans }, { expectedProjectId: projectId });
  if (!chain.ok) return codesOf(chain.errors);
  const errors = [];
  const ids = new Set();
  automationPlans.forEach((plan, i) => {
    if (plan.automationCandidateId !== automate[i].id) errors.push({ code: ERROR_CODES.INVALID_REFERENCE });
    if (plan.framework !== framework) errors.push({ code: ERROR_CODES.INVARIANT_VIOLATION });
    if (ids.has(plan.id)) errors.push({ code: ERROR_CODES.DUPLICATE_ID });
    ids.add(plan.id);
    // Schema/chain validation above owns shape; canonical PPI-1 owns path
    // acceptance. Return validation codes so fresh/persisted callers retain
    // their distinct provider-output (6) and invalid-input (4) mappings.
    try {
      assertPathIdentity(plan.plannedChanges.map(change => change.path), framework);
    } catch (error) {
      if (!error || error.code !== "PATH_IDENTITY_REFUSED") throw error;
      errors.push({ code: ERROR_CODES.INVALID_PATH });
    }
  });
  if (errors.length > 0) return codesOf(errors);
  // The run-wide rule is evaluated only over a set every plan of which is
  // already individually valid, so earlier refusals keep their exact codes.
  return crossPlanPathCodes(automationPlans.map((plan) => plan.plannedChanges.map((change) => change.path)));
}

const PLAN_PATH_CHARSET = /^[A-Za-z0-9._/-]+$/;

// OD-265-A1: run-wide target identity across every AutomationPlan of one
// plan stage. The identity key is the PPI-1 key (ASCII case-fold of the exact
// path), so exact and case-fold duplicates collide whatever the operations
// (CREATE/CREATE, CREATE/MODIFY, MODIFY/MODIFY) -> DUPLICATE_ID; a key that is
// a proper "/"-segment prefix of another (file vs directory, either order) ->
// INVARIANT_VIOLATION. Nothing is normalized, renamed or merged. The code
// list has a fixed order (INVARIANT_VIOLATION before DUPLICATE_ID), so it does
// not depend on plan order. Segments are held in a Map trie: linear in the
// total path length, and segment names such as __proto__ cannot collide with
// object keys. An entry outside the PPI-1 alphabet or with an empty, "." or
// ".." segment is reported as INVALID_PATH and never registered; it is
// unreachable after the per-plan PPI-1 check (defense in depth).
function crossPlanPathCodes(pathLists) {
  const root = { file: false, children: new Map() };
  let invalid = false, prefix = false, duplicate = false;
  for (const paths of pathLists) {
    for (const p of paths) {
      const segments = typeof p === "string" && p.length <= 300 && PLAN_PATH_CHARSET.test(p) ? asciiFold(p).split("/") : null;
      if (!segments || segments.some((s) => s === "" || s === "." || s === "..")) {
        invalid = true;
        continue;
      }
      let node = root;
      for (const segment of segments) {
        if (node.file) prefix = true;
        let next = node.children.get(segment);
        if (!next) {
          next = { file: false, children: new Map() };
          node.children.set(segment, next);
        }
        node = next;
      }
      if (node.file) duplicate = true;
      if (node.children.size > 0) prefix = true;
      node.file = true;
    }
  }
  const codes = [];
  if (invalid) codes.push(ERROR_CODES.INVALID_PATH);
  if (prefix) codes.push(ERROR_CODES.INVARIANT_VIOLATION);
  if (duplicate) codes.push(ERROR_CODES.DUPLICATE_ID);
  return codes;
}

function sameContext(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

// --- generate --------------------------------------------------------------------------

// Validates the change sets against their plans/context and returns the
// review packages rebuilt from them (the only way a review package is ever
// produced). `persistedPackages`, when given, must equal the rebuild.
function validateGenerated({ automationPlans, repositoryContext, generatedChangeSets, persistedPackages }, { projectId }) {
  if (!Array.isArray(generatedChangeSets) || generatedChangeSets.length !== automationPlans.length) return { codes: [ERROR_CODES.INVALID_REFERENCE] };
  if (persistedPackages !== undefined && (!Array.isArray(persistedPackages) || persistedPackages.length !== automationPlans.length)) return { codes: [ERROR_CODES.INVALID_REFERENCE] };
  const reviewPackages = [];
  for (let i = 0; i < automationPlans.length; i++) {
    const automationPlan = automationPlans[i];
    const generatedChangeSet = generatedChangeSets[i];
    if (!isPlainObject(generatedChangeSet) || generatedChangeSet.automationPlanId !== automationPlan.id) return { codes: [ERROR_CODES.INVALID_REFERENCE] };
    const valid = validateGeneratedChangeSet({ automationPlan, repositoryContext, generatedChangeSet, expectedProjectId: projectId });
    if (!valid.ok) return { codes: codesOf(valid.errors) };
    // #23D guarantees complete 1:1 plan/change path binding. Re-run PPI-1
    // independently here, before any review package is built or accepted.
    try {
      assertPathIdentity(generatedChangeSet.changes.map(change => change.path), automationPlan.framework);
    } catch (error) {
      if (!error || error.code !== "PATH_IDENTITY_REFUSED") throw error;
      return { codes: [ERROR_CODES.INVALID_PATH] };
    }
    const built = buildGeneratedChangeSetReviewPackage({ automationPlan, repositoryContext, generatedChangeSet, expectedProjectId: projectId });
    if (!built.ok) return { codes: codesOf(built.errors) };
    if (persistedPackages !== undefined) {
      const persisted = persistedPackages[i];
      if (!isPlainObject(persisted) || recomputeReviewPackageDigest(persisted) !== persisted.packageDigest || canonicalJson(persisted) !== canonicalJson(built.reviewPackage)) {
        return { codes: [ERROR_CODES.INVARIANT_VIOLATION] };
      }
    }
    reviewPackages.push(built.reviewPackage);
  }
  return { codes: [], reviewPackages };
}

// --- persisted stage loading -------------------------------------------------------------

function byKind(loaded, kind) {
  return loaded.filter((a) => a.kind === kind).map((a) => a.value);
}

function persistedInvalid(stage, codes) {
  return inputRefused("RUN_ARTIFACT_INVALID", `the persisted ${stage} artifacts of this run failed validation (reason codes: ${sanitizeCodes(codes).join(", ")}).`);
}

function exactlyOne(values, stage) {
  if (values.length !== 1) throw inputRefused("RUN_MANIFEST_INVALID", `the run manifest does not record exactly one artifact of each required ${stage} kind.`);
  return values[0];
}

function readDesign(loaded, evidence, config) {
  const design = {
    requirementModel: exactlyOne(byKind(loaded, "RequirementModel"), "design"),
    testCaseModel: exactlyOne(byKind(loaded, "TestCaseModel"), "design"),
    automationCandidates: byKind(loaded, "AutomationCandidate"),
  };
  const codes = validateDesign(design, { evidenceBundle: evidence.evidenceBundle, projectId: config.projectProfile.id, framework: config.framework });
  if (codes.length > 0) throw persistedInvalid("design", codes);
  return design;
}

function readPlan(loaded, design, config) {
  const plan = { repositoryContext: exactlyOne(byKind(loaded, "AutomationRepositoryContext"), "plan"), automationPlans: byKind(loaded, "AutomationPlan") };
  const codes = validatePlans({ ...design, automationPlans: plan.automationPlans }, { projectId: config.projectProfile.id, framework: config.framework });
  if (codes.length > 0) throw persistedInvalid("plan", codes);
  return plan;
}

function readGenerate(loaded, design, plan, config) {
  const generatedChangeSets = byKind(loaded, "GeneratedChangeSet");
  const persistedPackages = byKind(loaded, "GeneratedChangeSetReviewPackage");
  const r = validateGenerated({ automationPlans: plan.automationPlans, repositoryContext: plan.repositoryContext, generatedChangeSets, persistedPackages }, { projectId: config.projectProfile.id });
  if (r.codes.length > 0) throw persistedInvalid("generate", r.codes);
  return { generatedChangeSets, reviewPackages: r.reviewPackages };
}

// --- opening an existing run ------------------------------------------------------------

function requireRequirements(config) {
  if (!config.requirements) {
    throw configError("REQUIREMENTS_NOT_CONFIGURED", "qa-agent.config.json has no requirements section (requirements.source / requirements.path).");
  }
}

// Requirements -> evidence, current projection, run directory, manifest
// shape + binding and (unless `stage` is null) the stage gate.
function openRun(ctx, stage) {
  const { root, config, runId, protectedPaths, product } = ctx;
  const evidence = loadEvidence(root, config);
  const projection = store.computeProjection(config, evidence.requirementsDigest);
  const runDirRel = store.runDirectoryRel(config, runId);
  const runDirReal = store.openRunDirectory(root, runDirRel, protectedPaths);
  const { manifest, digest } = store.loadManifest(runDirReal);
  store.verifyManifestBinding(manifest, { runId, product, projection });
  if (stage !== null) store.assertStageReady(manifest, stage);
  return { evidence, runDirRel, runDirReal, manifest, digest };
}

function loadDesignStage(run, config) {
  return readDesign(store.loadStageArtifacts(run.runDirReal, run.manifest, "design"), run.evidence, config);
}

function loadPlanStage(run, design, config) {
  return readPlan(store.loadStageArtifacts(run.runDirReal, run.manifest, "plan"), design, config);
}

function loadGenerateStage(run, design, plan, config) {
  return readGenerate(store.loadStageArtifacts(run.runDirReal, run.manifest, "generate"), design, plan, config);
}

module.exports = {
  requireRequirements,
  openRun,
  loadDesignStage,
  loadPlanStage,
  loadGenerateStage,
  ordinal,
  codesOf,
  sanitizeCodes,
  loadEvidence,
  frameworkCapability,
  validateDesign,
  automateCandidates,
  buildPlanScopes,
  buildLiveRepositoryContext,
  validatePlans,
  crossPlanPathCodes,
  sameContext,
  validateGenerated,
  readDesign,
  readPlan,
  readGenerate,
};
