/**
 * Closed, per-stage child-process environment (mission §14-§15,
 * ARCH-PROD-C1-m02, SEC-PROD-L03).
 *
 * A stage environment is built from an EMPTY object - never a spread/copy of
 * process.env - and receives only the keys that stage needs:
 *
 *   every stage        platform baseline (PATH, SYSTEMROOT, WINDIR, TEMP,
 *                      TMP, HOME, USERPROFILE, APPDATA, LOCALAPPDATA, CI),
 *                      QA_FRAMEWORK (= validated config framework), the
 *                      XI-01 invocation keys of the resolved mode, TEST_BROWSER
 *   collect            + GITHUB_HEAD_REF / GITHUB_REF_NAME / GITHUB_EVENT_NAME
 *                        (github-actions-v1 provenance only)
 *   history            + GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL,
 *                        GITHUB_RUN_ID, HISTORY_RUNS/BRANCH/JOB_NAME
 *                        (never under --offline: the stage is refused first)
 *   analyze            + AI_PROVIDER (= effective provider); AI_MODEL and
 *                        AI_API_KEY only for an effective network provider
 *                        (never for mock, never under --offline)
 *
 * The AI secret family never reaches collect/history/aggregate; the GitHub
 * secret family never reaches collect/aggregate/analyze. NODE_OPTIONS,
 * NODE_PATH, NODE_DEBUG, npm_* and every other key are never copied. Key
 * lookup is case-insensitive on Windows. GITHUB_ACTIONS is only forwarded
 * when the ambient value is exactly "true" (github-actions-v1); the CLI never
 * sets it on its own.
 */

"use strict";

const { readEnv } = require("./env");

const PLATFORM_BASELINE_KEYS = Object.freeze(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CI"]);
const GITHUB_INVOCATION_KEYS = Object.freeze(["GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]);
const GITHUB_COLLECT_METADATA_KEYS = Object.freeze(["GITHUB_HEAD_REF", "GITHUB_REF_NAME", "GITHUB_EVENT_NAME"]);
const HISTORY_KEYS = Object.freeze(["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_API_URL", "GITHUB_RUN_ID", "HISTORY_RUNS", "HISTORY_BRANCH", "HISTORY_JOB_NAME"]);
const AI_SECRET_KEYS = Object.freeze(["AI_API_KEY", "AI_MODEL"]);
const GITHUB_SECRET_KEYS = Object.freeze(["GITHUB_TOKEN"]);

// Defense in depth: even if a future edit added one of these to an allowlist,
// buildStageEnv() refuses to emit it.
const NEVER_INHERITED = Object.freeze([/^NODE_OPTIONS$/i, /^NODE_PATH$/i, /^NODE_DEBUG$/i, /^NODE_REPL_EXTERNAL_MODULE$/i, /^npm_/i]);

const STAGES = Object.freeze(["collect", "history", "aggregate", "analyze"]);

function copyKeys(target, env, keys, platform) {
  for (const key of keys) {
    const value = readEnv(env, key, platform);
    if (value !== undefined) target[key] = value;
  }
}

/**
 * @param {object} options
 * @param {string} options.stage            one of STAGES
 * @param {object} options.env              the CLI's ambient environment (read only)
 * @param {string} options.platform         process.platform
 * @param {string} options.framework        validated config framework
 * @param {object} options.invocation       { mode: "github-actions-v1" } |
 *                                          { mode: "local-v1", id, modeValue? } |
 *                                          { mode: "none" } (history only)
 * @param {object} [options.provider]       resolveProvider() result (analyze only)
 * @param {boolean} options.offline
 */
function buildStageEnv({ stage, env, platform = process.platform, framework, invocation, provider, offline }) {
  if (!STAGES.includes(stage)) throw new Error(`buildStageEnv(): unknown stage "${stage}"`);
  const out = {};

  copyKeys(out, env, PLATFORM_BASELINE_KEYS, platform);
  out.QA_FRAMEWORK = framework;
  copyKeys(out, env, ["TEST_BROWSER"], platform);

  if (stage !== "history") {
    if (invocation.mode === "github-actions-v1") {
      out.GITHUB_ACTIONS = "true";
      copyKeys(out, env, GITHUB_INVOCATION_KEYS, platform);
      if (stage === "collect") copyKeys(out, env, GITHUB_COLLECT_METADATA_KEYS, platform);
    } else {
      // Caller-supplied values are forwarded verbatim (never normalized), so
      // the stage's own XI-01 grammar check decides on them.
      out.QA_AI_INVOCATION_MODE = invocation.modeValue === undefined ? "local-v1" : invocation.modeValue;
      out.QA_AI_INVOCATION_ID = invocation.id;
    }
  }

  if (stage === "history") {
    if (offline) throw new Error("buildStageEnv(): the history stage is a network stage and is never built under --offline");
    copyKeys(out, env, HISTORY_KEYS, platform);
  }

  if (stage === "analyze") {
    if (!provider || !provider.effective) throw new Error("buildStageEnv(): analyze requires a resolved effective provider");
    out.AI_PROVIDER = provider.effective;
    if (provider.network && !offline) copyKeys(out, env, AI_SECRET_KEYS, platform);
  }

  for (const key of Object.keys(out)) {
    if (NEVER_INHERITED.some((pattern) => pattern.test(key))) throw new Error("buildStageEnv(): refused a never-inherited key");
    if (typeof out[key] !== "string") delete out[key];
  }
  return Object.freeze(out);
}

module.exports = {
  PLATFORM_BASELINE_KEYS,
  GITHUB_INVOCATION_KEYS,
  GITHUB_COLLECT_METADATA_KEYS,
  HISTORY_KEYS,
  AI_SECRET_KEYS,
  GITHUB_SECRET_KEYS,
  NEVER_INHERITED,
  STAGES,
  buildStageEnv,
};
