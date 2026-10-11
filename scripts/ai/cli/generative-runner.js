/**
 * Internal Stage 3 generative entrypoint - spawned ONLY by stage-process.js
 * as `process.execPath generative-runner.js <design|plan|generate>` with the
 * closed environment of child-env.js buildGenerativeEnv(). Not a supported
 * entrypoint: it is not in `exports` or `bin`.
 *
 * Contract §10.4.5 architecture B: the env-snapshotting provider modules
 * (scripts/ai/config.js via providers/index.js) are first loaded here, in a
 * process whose environment already equals the parent's effective decision.
 *
 * It is a thin adapter onto the existing provider-backed generators - no
 * generation, validation or prompt logic lives here:
 *
 *   design    generateRequirementModel -> generateTestCaseModel ->
 *             generateAutomationCandidate (one per test case)
 *   plan      generateAutomationPlan (one per AUTOMATE candidate)
 *   generate  generateChangeSet (one per AutomationPlan)
 *
 * Its inputs are values the parent already validated; its outputs are
 * re-validated by the parent before anything is written. It never touches
 * the filesystem, never builds a review package or reads an approval
 * artifact, and never applies or executes anything. Defense in depth: a
 * non-generative AI_PROVIDER (mock or anything else) is refused before a
 * provider object exists.
 *
 * Confidentiality: a failure is reported ONLY as the failing step, the
 * provider-attempt count and closed-vocabulary reason codes - never a
 * provider response, a validator message/path (which can quote
 * model-chosen key names), a prompt or a stack.
 */

"use strict";

// config.js snapshots AI_PROVIDER at load; in this child it equals the
// parent's effective decision (buildGenerativeEnv()).
const { PROVIDER } = require("../config");
const { createProvider } = require("../providers/index");
const { generateRequirementModel } = require("../generative-test-design/requirement-model-generator");
const { generateTestCaseModel } = require("../generative-test-design/test-case-model-generator");
const { generateAutomationCandidate } = require("../generative-test-design/automation-candidate-generator");
const { generateAutomationPlan } = require("../test-automation/automation-plan-generator");
const { generateChangeSet } = require("../test-automation/generate-change-set");

const GENERATIVE_PROVIDERS = Object.freeze(["groq", "gemini"]);
const CODE_PATTERN = /^[A-Z][A-Z_]{0,63}$/;
const MAX_CODES = 8;

function failureCodes(errors) {
  const codes = [];
  for (const e of Array.isArray(errors) ? errors : []) {
    const code = e && typeof e.code === "string" && CODE_PATTERN.test(e.code) ? e.code : "UNKNOWN";
    if (!codes.includes(code)) codes.push(code);
    if (codes.length >= MAX_CODES) break;
  }
  return codes;
}

function stepFailure(step, result) {
  return {
    ok: false,
    failure: { kind: "generation", step, providerAttempts: Number.isInteger(result.providerAttempts) ? result.providerAttempts : 0, codes: failureCodes(result.errors) },
  };
}

async function runDesign(provider, p) {
  const rm = await generateRequirementModel({ evidenceBundle: p.evidenceBundle, provider, expectedProjectId: p.projectId });
  if (!rm.ok) return stepFailure("requirementModel", rm);
  const tcm = await generateTestCaseModel({ requirementModel: rm.requirementModel, provider, expectedProjectId: p.projectId });
  if (!tcm.ok) return stepFailure("testCaseModel", tcm);
  const automationCandidates = [];
  for (const testCase of tcm.testCaseModel.testCases) {
    const ac = await generateAutomationCandidate({
      requirementModel: rm.requirementModel,
      testCaseModel: tcm.testCaseModel,
      testCaseId: testCase.id,
      frameworkCapability: p.frameworkCapability,
      provider,
      expectedProjectId: p.projectId,
      projectProfile: p.projectProfile,
    });
    if (!ac.ok) return stepFailure("automationCandidate", ac);
    automationCandidates.push(ac.automationCandidate);
  }
  return { ok: true, artifacts: { requirementModel: rm.requirementModel, testCaseModel: tcm.testCaseModel, automationCandidates } };
}

async function runPlan(provider, p) {
  const automationPlans = [];
  for (const automationCandidate of p.automationCandidates) {
    const r = await generateAutomationPlan({ automationCandidate, repositoryContext: p.repositoryContext, provider, expectedProjectId: p.projectId });
    if (!r.ok) return stepFailure("automationPlan", r);
    automationPlans.push(r.automationPlan);
  }
  return { ok: true, artifacts: { automationPlans } };
}

async function runGenerate(provider, p) {
  const generatedChangeSets = [];
  for (const automationPlan of p.automationPlans) {
    const r = await generateChangeSet({ automationPlan, repositoryContext: p.repositoryContext, provider, expectedProjectId: p.projectId });
    if (!r.ok) return stepFailure("generatedChangeSet", r);
    generatedChangeSets.push(r.generatedChangeSet);
  }
  return { ok: true, artifacts: { generatedChangeSets } };
}

const STAGES = Object.freeze({ design: runDesign, plan: runPlan, generate: runGenerate });

function finish(result) {
  const done = () => {
    if (process.connected) process.disconnect();
  };
  if (typeof process.send === "function" && process.connected) process.send({ type: "result", ...result }, done);
  else process.exitCode = result.ok ? 0 : 1;
}

async function runOnce(message) {
  const stage = process.argv[2];
  if (!message || message.type !== "payload" || message.stage !== stage || !Object.prototype.hasOwnProperty.call(STAGES, stage)) {
    process.exitCode = 1;
    finish({ ok: false, failure: { kind: "payload", code: "STAGE_PAYLOAD_INVALID" } });
    return;
  }
  if (!GENERATIVE_PROVIDERS.includes(PROVIDER)) {
    process.exitCode = 1;
    finish({ ok: false, failure: { kind: "authority", code: "CAPABILITY_REQUIRES_GENERATIVE_PROVIDER" } });
    return;
  }
  let provider;
  try {
    provider = createProvider(PROVIDER);
  } catch (err) {
    process.exitCode = 1;
    const code = err && typeof err.code === "string" && CODE_PATTERN.test(err.code) ? err.code : "UNKNOWN";
    finish({ ok: false, failure: { kind: "provider-configuration", code } });
    return;
  }
  try {
    const result = await STAGES[stage](provider, message.payload || {});
    if (!result.ok) process.exitCode = 1;
    finish(result);
  } catch {
    process.exitCode = 1;
    finish({ ok: false, failure: { kind: "internal", code: "GENERATIVE_STAGE_FAILED" } });
  }
}

if (require.main === module) {
  if (typeof process.send !== "function") {
    process.stderr.write("generative-runner.js is an internal qa-agent entrypoint and must be started by the qa-agent CLI.\n");
    process.exitCode = 1;
  } else {
    process.once("message", (message) => {
      runOnce(message);
    });
  }
}

module.exports = { STAGES, failureCodes };
