/**
 * `qa-agent triage collect|history|aggregate|analyze|run` - thin
 * orchestration over the existing certified triage stages, each run in an
 * isolated child (stage-process.js) with a closed environment
 * (child-env.js). No triage business logic is duplicated here.
 *
 * XI-01 invocation identity:
 *   GITHUB_ACTIONS === "true"   github-actions-v1; the platform tuple is
 *                               forwarded; the CLI sets nothing itself
 *   `triage run` (local)        the CLI is the orchestrating process: one
 *                               fresh 128-bit CSPRNG id per logical run,
 *                               passed to every stage of that run
 *   per-stage (local)           the caller supplies QA_AI_INVOCATION_MODE /
 *                               QA_AI_INVOCATION_ID exactly as today; the CLI
 *                               forwards them and never invents a
 *                               replacement id once context exists
 * Grammar/binding validation stays in the stages (triage-boundary-contract);
 * the CLI only refuses contradictory or missing identity up front.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { readEnv } = require("./env");
const { buildStageEnv } = require("./child-env");
const { runStageProcess } = require("./stage-process");
const { CliError, EXIT_CODES, authorityRefused, boundMessage } = require("./errors");

const STAGE_ARTIFACTS = Object.freeze({
  collect: Object.freeze(["reports/ai/context.json"]),
  history: Object.freeze(["reports/ai/history.json"]),
  aggregate: Object.freeze(["reports/ai/context.json", "reports/ai/history.json"]),
  analyze: Object.freeze(["reports/ai/ai-report.json"]),
});

const STAGES_USING_INVOCATION = Object.freeze(["collect", "aggregate", "analyze"]);

function stagesFor(stage, { history }) {
  if (stage === "run") return history ? ["collect", "history", "analyze"] : ["collect", "analyze"];
  return [stage];
}

// Step 12 (invocation trust setup). Pure; returns the invocation descriptor
// handed to child-env.js.
function resolveInvocation({ stage, env, platform }) {
  const githubActions = readEnv(env, "GITHUB_ACTIONS", platform);
  const localMode = readEnv(env, "QA_AI_INVOCATION_MODE", platform);
  const localId = readEnv(env, "QA_AI_INVOCATION_ID", platform);
  const localPairPresent = localMode !== undefined || localId !== undefined;

  if (githubActions === "true") {
    if (localPairPresent) {
      throw authorityRefused(
        "INVOCATION_MODE_CONFLICT",
        "QA_AI_INVOCATION_MODE/QA_AI_INVOCATION_ID must not be set when GITHUB_ACTIONS is \"true\" (contradictory invocation state)."
      );
    }
    return Object.freeze({ mode: "github-actions-v1" });
  }

  if (stage === "run") {
    if (localPairPresent) {
      throw authorityRefused(
        "INVOCATION_MODE_CONFLICT",
        "\"triage run\" generates its own local-v1 invocation id; unset QA_AI_INVOCATION_MODE/QA_AI_INVOCATION_ID or run the stages individually."
      );
    }
    return Object.freeze({ mode: "local-v1", id: crypto.randomBytes(16).toString("hex"), orchestrated: true });
  }

  if (!STAGES_USING_INVOCATION.includes(stage)) return Object.freeze({ mode: "none" });
  if (localMode === undefined || localId === undefined) {
    throw authorityRefused(
      "INVOCATION_IDENTITY_REQUIRED",
      "a per-stage local triage command requires QA_AI_INVOCATION_MODE=local-v1 and the QA_AI_INVOCATION_ID of this logical run (or use \"triage run\")."
    );
  }
  return Object.freeze({ mode: "local-v1", id: localId, orchestrated: false, modeValue: localMode });
}

// The analyzer's non-JSON diagnostic appends the JSON parser's own message,
// which quotes a fragment of the model output verbatim - newlines, quotes and
// control characters included - so its end cannot be located reliably. The
// CLI never forwards raw provider payload: everything from the diagnostic's
// separator to the end of the text is replaced by a fixed sentence. The
// analyzer prints that diagnostic as its final line before exiting, so only
// the attacker-controlled excerpt (and any stack frames) is dropped.
const RAW_PAYLOAD_MARKER = "AI provider response was not valid JSON:";
const RAW_PAYLOAD_WITHHELD = "AI provider response was not valid JSON (parser detail withheld).";

function stripProviderPayload(text) {
  const at = text.indexOf(RAW_PAYLOAD_MARKER);
  if (at === -1) return text;
  return `${text.slice(0, at)}${RAW_PAYLOAD_WITHHELD}${/\r?\n$/.test(text) ? "\n" : ""}`;
}

// Forwarded child diagnostics never carry stack frames (a crashing child
// would otherwise print one).
const STACK_FRAME_LINE = /^[ \t]+at [^\r\n]*(?:\r?\n|$)/gm;

function sanitizeDiagnostics(text) {
  return stripProviderPayload(text).replace(STACK_FRAME_LINE, "");
}

function lastAnalyzeError(stderr) {
  const lines = stderr.split(/\r?\n/).filter((l) => l.startsWith("[ai:analyze] Error: "));
  return lines.length > 0 ? lines[lines.length - 1].slice("[ai:analyze] Error: ".length) : null;
}

function classifyStageFailure(stage, outcome) {
  if (outcome.spawnError) return new CliError(EXIT_CODES.INTERNAL, "STAGE_SPAWN_FAILED", `the ${stage} stage process could not be started.`);
  const message = (outcome.result && outcome.result.message) || (stage === "analyze" ? lastAnalyzeError(outcome.stderr) : null) || `the ${stage} stage failed.`;
  const text = boundMessage(stripProviderPayload(message));
  if (/^TRIAGE_INVOCATION_/.test(text)) return new CliError(EXIT_CODES.AUTHORITY_REFUSED, "INVOCATION_IDENTITY_REFUSED", text);
  if (/^WRITE_PATH_/.test(text)) return new CliError(EXIT_CODES.AUTHORITY_REFUSED, "WRITE_TARGET_REFUSED", text);
  if (/^AI provider /.test(text)) return new CliError(EXIT_CODES.PROVIDER_FAILURE, "PROVIDER_FAILURE", text);
  if (/^(TRIAGE_|reports\/ai\/)/.test(text)) return new CliError(EXIT_CODES.INPUT_REFUSED, "TRIAGE_INPUT_REFUSED", text);
  if (/^(FRAMEWORK_RUNTIME_CONFIG_|PROJECT_KNOWLEDGE_CONFIG_|PROJECT_PROFILE_|REPOSITORY_ROOT_)/.test(text)) {
    return new CliError(EXIT_CODES.CONFIGURATION, "STAGE_CONFIGURATION_INVALID", text);
  }
  return new CliError(EXIT_CODES.INTERNAL, "STAGE_FAILED", text);
}

function freshArtifacts(root, stage, startedAtMs) {
  const out = [];
  for (const rel of STAGE_ARTIFACTS[stage]) {
    try {
      const stat = fs.lstatSync(path.join(root.realRoot, ...rel.split("/")));
      if (stat.isFile() && stat.mtimeMs >= startedAtMs - 2000) out.push(rel);
    } catch {
      // not produced by this stage
    }
  }
  return out;
}

async function runTriage({ stage, flags, root, config, provider, invocation, env, platform, spawnImpl, diagnostics }) {
  const secrets = ["AI_API_KEY", "GITHUB_TOKEN"].map((k) => readEnv(env, k, platform)).filter(Boolean);
  const payload = {
    repositoryRoot: root.realRoot,
    projectProfile: config.projectProfile,
    frameworkRuntime: config.frameworkRuntime,
    knowledge: config.knowledge,
  };
  const completed = [];
  const artifacts = [];
  for (const current of stagesFor(stage, flags)) {
    const stageEnv = buildStageEnv({
      stage: current,
      env,
      platform,
      framework: config.framework,
      invocation,
      provider: current === "analyze" ? provider : undefined,
      offline: flags.offline,
    });
    const startedAtMs = Date.now();
    const forward = diagnostics ? (text) => diagnostics(sanitizeDiagnostics(text)) : undefined;
    const outcome = await runStageProcess({ stage: current, payload, env: stageEnv, cwd: root.realRoot, secrets, spawnImpl, diagnostics: forward });
    if (!(outcome.result && outcome.result.ok === true && outcome.exitCode === 0)) {
      const error = classifyStageFailure(current, outcome);
      error.completedStages = completed.slice();
      error.artifacts = artifacts.slice();
      throw error;
    }
    completed.push(current);
    for (const rel of freshArtifacts(root, current, startedAtMs)) if (!artifacts.includes(rel)) artifacts.push(rel);
  }
  return { stages: completed, artifacts };
}

module.exports = { STAGE_ARTIFACTS, stagesFor, resolveInvocation, classifyStageFailure, stripProviderPayload, sanitizeDiagnostics, runTriage };
