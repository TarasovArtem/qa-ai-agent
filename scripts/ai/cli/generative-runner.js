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
 * It is an adapter onto the existing provider-backed generators - no
 * generation or prompt logic lives here:
 *
 *   design    generateRequirementModel -> generateTestCaseModel ->
 *             generateAutomationCandidate (one per test case)
 *   plan      generateAutomationPlan (one per AUTOMATE candidate)
 *   generate  generateChangeSet (one per AutomationPlan)
 *
 * The plan step additionally performs bounded sequential coordination
 * (OD-265-B1): candidates are planned strictly in order, each call receives
 * its own parent-resolved scope and a sorted copy of the target paths of the
 * plans already accepted, and a plan's paths are reserved only after the
 * plan was accepted and passed PPI-1. That is advisory; acceptance of the
 * whole set stays with the parent's run-wide rule. It never adds a provider
 * attempt: each candidate has at most the generator's own two.
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

const crypto = require("crypto");
// config.js snapshots AI_PROVIDER at load; in this child it equals the
// parent's effective decision (buildGenerativeEnv()).
const { PROVIDER } = require("../config");
const { createProvider, bindCancelSignal } = require("../providers/index");
const { generateRequirementModel } = require("../generative-test-design/requirement-model-generator");
const { generateTestCaseModel } = require("../generative-test-design/test-case-model-generator");
const { generateAutomationCandidate } = require("../generative-test-design/automation-candidate-generator");
const { generateAutomationPlan } = require("../test-automation/automation-plan-generator");
const { generateChangeSet } = require("../test-automation/generate-change-set");
const { assertPathIdentity } = require("./path-identity");

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

// OD-265-B1: one scope per candidate, aligned by candidate id, else nothing
// is called. With no candidate there is no call to coordinate, so an absent
// list is the empty list (the pre-B1 zero-call result; the parent itself
// never plans zero candidates).
function scopesAligned(candidates, scopes) {
  if (Array.isArray(candidates) && candidates.length === 0 && scopes === undefined) return true;
  if (!Array.isArray(candidates) || !Array.isArray(scopes) || scopes.length !== candidates.length) return false;
  return scopes.every((scope, i) => scope !== null && typeof scope === "object" && candidates[i] !== null && typeof candidates[i] === "object" && typeof scope.candidateId === "string" && scope.candidateId === candidates[i].id);
}

async function runPlan(provider, p) {
  const candidates = p.automationCandidates;
  if (!scopesAligned(candidates, p.planScopes)) return stepFailure("automationPlan", { errors: [{ code: "INVALID_REFERENCE" }], providerAttempts: 0 });
  const automationPlans = [];
  const reserved = [];
  for (let i = 0; i < candidates.length; i++) {
    const coordination = { planScope: p.planScopes[i], reservedPaths: [...reserved].sort() };
    const r = await generateAutomationPlan({ automationCandidate: candidates[i], repositoryContext: p.repositoryContext, provider, expectedProjectId: p.projectId, coordination });
    if (!r.ok) return stepFailure("automationPlan", r);
    const paths = r.automationPlan.plannedChanges.map((change) => change.path);
    // PPI-1 before reservation, so no non-canonical provider string is ever
    // forwarded into a later prompt; no correction call (the generator's
    // attempts are spent).
    try {
      assertPathIdentity(paths, r.automationPlan.framework);
    } catch (error) {
      if (!error || error.code !== "PATH_IDENTITY_REFUSED") throw error;
      return stepFailure("automationPlan", { errors: [{ code: "INVALID_PATH" }], providerAttempts: r.providerAttempts });
    }
    reserved.push(...paths);
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
// SEC-C1: the existing generic stage-failure exit code - no new code.
const PARENT_LOST_EXIT_CODE = 1;
// FT0-C2: the parent's private receipt for a stored result (stage-process.js).
const RESULT_ACK_TYPE = "result-ack";
// FT0-C2: fixed bound on the whole transfer - the send and the wait for the
// parent's ACK. Not configurable.
const RESULT_ACK_DEADLINE_MS = 10000;

/**
 * SEC-C1 (OD-RATE-1 FT0, unconditional): identical to stage-runner.js's
 * guardParentLink() - parent IPC loss before the result is delivered aborts
 * the in-flight provider request (providers/index.js bindCancelSignal()) and
 * exits in the same turn, so no later generator attempt, step or result can
 * run; no signal handler is installed. `report()` owns the single result
 * transfer: running -> sending -> awaiting_ack -> delivered, or -> failed
 * from any of them. The send callback is not delivery proof (FT0-C2); only
 * the parent's ACK echoing this result's random receipt is, and parent
 * loss, a send error or no valid ACK within RESULT_ACK_DEADLINE_MS of the
 * report fails the child. Only a delivered result is followed by the
 * child's own, ignored, disconnect.
 */
function guardParentLink(proc) {
  const controller = new AbortController();
  let state = "running";
  let receipt = null;
  let deadline = null;
  const settle = (outcome) => {
    state = outcome;
    clearTimeout(deadline);
    proc.removeListener("message", onAck);
  };
  const fail = () => {
    if (state === "failed" || state === "delivered") return;
    settle("failed");
    try {
      controller.abort();
    } finally {
      proc.exit(PARENT_LOST_EXIT_CODE);
    }
  };
  // The receipt alone proves the parent read this result, so an ACK that
  // overtakes the send callback is still a delivery. Messages that reached
  // the child before report() are replayed to this listener by Node; the
  // receipt check is what keeps them from authorizing anything.
  function onAck(message) {
    if (state !== "sending" && state !== "awaiting_ack") return;
    if (!message || typeof message !== "object" || message.type !== RESULT_ACK_TYPE || message.receipt !== receipt) return;
    settle("delivered");
    // Never from inside Node's own message dispatch: on Node 22 a further
    // message from the same read would meet the already-closed channel and
    // crash the child.
    setImmediate(() => {
      if (proc.connected) proc.disconnect();
    });
  }
  proc.on("disconnect", fail);
  return {
    signal: controller.signal,
    report(message) {
      if (state !== "running") return false;
      if (!proc.connected) {
        fail();
        return false;
      }
      state = "sending";
      receipt = crypto.randomBytes(16).toString("hex");
      deadline = setTimeout(fail, RESULT_ACK_DEADLINE_MS);
      proc.on("message", onAck);
      try {
        proc.send({ ...message, receipt }, (err) => {
          if (state !== "sending") return;
          if (err || !proc.connected) {
            fail();
            return;
          }
          state = "awaiting_ack";
        });
      } catch {
        fail();
        return false;
      }
      return true;
    },
  };
}

let parentLink = null;

function finish(result) {
  if (parentLink) parentLink.report({ type: "result", ...result });
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
    parentLink = guardParentLink(process);
    bindCancelSignal(parentLink.signal);
    process.once("message", (message) => {
      runOnce(message);
    });
  }
}

module.exports = { STAGES, failureCodes, guardParentLink };
