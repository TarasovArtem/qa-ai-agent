/**
 * Controlled-v1 `qa-agent` CLI (Stages 1-2: CLI shell, configuration,
 * baseline commands, supported triage integration).
 *
 * NORMATIVE VALIDATION ORDER (resolves ARCH-PROD-C1-m01). Each command runs
 * the steps that apply to it, strictly in this order; the first failing step
 * decides the exit code and nothing later runs:
 *
 *    1. CLI syntax / usage                                    -> 2
 *       (reserved commands stop here with a fixed refusal     -> 5;
 *        they read no root, config or other input)
 *    2. root resolution (--root or cwd; no upward search)     -> 3
 *    3. bounded config load (open once, <= 64 KiB)            -> 3
 *    4. config structural + semantic validation               -> 3
 *       (+ QA_FRAMEWORK vs config framework for triage)
 *    5. path containment (requirements.path, output.dir)      -> 3
 *    6. offline mode resolution                               -> 5
 *    7. effective provider selection (AI_PROVIDER | mock)     -> 3
 *    8. providers.allow ceiling                               -> 5
 *    9. command/provider compatibility                        -> 5
 *   10. provider credential/model presence (consumers only)   -> 3
 *   11. release capability authorization                      -> 5
 *   12. invocation trust setup (XI-01)                        -> 5
 *   13. only then: child spawn / provider construction /
 *       network / write
 *
 * Steps 7-10 apply only to commands that consume a provider (triage analyze,
 * triage run). Step 6 is enforced for every command that does work
 * (requirements check, triage *); `info` and `config validate` report it.
 *
 * stdout carries only the result (with --json: exactly one JSON object);
 * stderr carries bounded diagnostics - never secrets, raw provider payloads,
 * prompts or stack traces. The CLI never prompts.
 *
 * Parent-process module graph: this file never loads scripts/ai/config.js,
 * a provider module, or a triage stage module - those are loaded only inside
 * isolated stage children (static proof in the CLI tests).
 */

"use strict";

const path = require("path");

const pkg = require("../../../package.json");
const { assertValidRepositoryRoot } = require("../repository-root");
const { CONTEXT_SCHEMA_VERSION } = require("../triage-boundary-contract");
const { parseArgs, COMMANDS } = require("./args");
const { CliError, EXIT_CODES, configError, authorityRefused, boundMessage } = require("./errors");
const { readEnv } = require("./env");
const { CONFIG_FILE_NAME, CONFIG_SCHEMA_VERSION, PROTECTED_OUTPUT_PREFIXES, readConfigText, parseConfigText, validateConfig } = require("./config-file");
const { assertCanonicallyContained } = require("./paths");
const policy = require("./policy");
const { runRequirementsCheck, REPORT_SCHEMA_VERSION } = require("./requirements-check");
const triage = require("./triage");

const CLI_OUTPUT_SCHEMA_VERSION = 1;
const PRODUCT = Object.freeze({ name: pkg.name, version: pkg.version });

function helpText(command) {
  if (command && COMMANDS[command]) {
    const spec = COMMANDS[command];
    if (spec.kind === "reserved") {
      return `qa-agent ${command}\n\n  ${spec.summary}\n  Not enabled in this release (pending ${spec.ownerDecision}); always exits 5 with CAPABILITY_NOT_ENABLED_IN_RELEASE.\n`;
    }
    const options = spec.flags
      .filter((f) => f !== "help")
      .map((f) => (f === "root" || f === "config" ? `--${f} <path>` : `--${f}`))
      .join(" ");
    return `qa-agent ${command} [${options}]\n\n  ${spec.summary}\n`;
  }
  const lines = [
    "Usage: qa-agent <command> [options]",
    "",
    "Commands:",
    ...Object.entries(COMMANDS)
      .filter(([, s]) => s.kind !== "reserved")
      .map(([name, s]) => `  ${name.padEnd(20)} ${s.summary}`),
    "",
    "Reserved (not enabled in this release; exit 5):",
    ...Object.entries(COMMANDS)
      .filter(([, s]) => s.kind === "reserved")
      .map(([name, s]) => `  ${name.padEnd(20)} ${s.summary} [${s.ownerDecision}]`),
    "",
    "Options:",
    "  --root <dir>       repository root (default: current directory; no upward search)",
    `  --config <path>    configuration file inside the root (default: ${CONFIG_FILE_NAME})`,
    "  --offline          network-disabled mode (only the mock provider; no History API)",
    "  --json             print exactly one JSON object on stdout",
    "  --history          (triage run) include the GitHub History stage",
    "  --help, --version",
    "",
    "Provider: AI_PROVIDER (default mock), AI_MODEL, AI_API_KEY - environment only; never in config.",
    "Exit codes: 0 ok, 1 internal, 2 usage, 3 configuration, 4 input refused, 5 authority refused, 6 provider failure.",
  ];
  return `${lines.join("\n")}\n`;
}

function envelope(command, exitCode, extra = {}) {
  return {
    schemaVersion: CLI_OUTPUT_SCHEMA_VERSION,
    command,
    ok: exitCode === EXIT_CODES.OK,
    exitCode,
    runId: null,
    artifacts: [],
    errors: [],
    ...extra,
  };
}

// --- steps 2-5 ------------------------------------------------------------------

function resolveRoot(flags, cwd) {
  const requested = flags.root === undefined ? cwd : path.resolve(cwd, flags.root);
  try {
    return assertValidRepositoryRoot(requested, "qa-agent");
  } catch {
    throw configError("ROOT_INVALID", "the repository root must be an existing directory (--root or the current directory).");
  }
}

function loadValidatedConfig(root, flags, { allowMissing = false } = {}) {
  let read;
  try {
    read = readConfigText({ root, configPath: flags.config });
  } catch (err) {
    if (allowMissing && err.code === "CONFIG_NOT_FOUND" && flags.config === undefined) return { config: null, configRelPath: CONFIG_FILE_NAME };
    throw err;
  }
  const config = validateConfig(parseConfigText(read.text), { configRelPath: read.configRelPath });
  return { config, configRelPath: read.configRelPath };
}

function checkContainment(root, config, configRelPath) {
  const protectedPaths = [...PROTECTED_OUTPUT_PREFIXES, configRelPath];
  if (config.frameworkRuntime) protectedPaths.push(config.frameworkRuntime.testSourceRoot);
  assertCanonicallyContained(root, config.output.dir, "output.dir", { protectedPaths });
  if (config.requirements) assertCanonicallyContained(root, config.requirements.path, "requirements.path");
}

function checkFrameworkAuthority(config, env, platform) {
  const raw = readEnv(env, "QA_FRAMEWORK", platform);
  if (raw === undefined || raw.trim() === "") return;
  if (raw.trim().toLowerCase() !== config.framework) {
    throw configError("FRAMEWORK_AUTHORITY_CONTRADICTION", "QA_FRAMEWORK differs from the framework in qa-agent.config.json (config is the sole framework authority).");
  }
}

// --- commands -------------------------------------------------------------------

function providerReport(provider) {
  return {
    effective: provider.effective,
    requested: provider.requested,
    known: provider.known,
    allowed: provider.allowList,
    selectionAllowed: provider.allowed,
    offline: provider.offline,
    offlineContradiction: provider.offlineContradiction,
    credentialPresent: provider.credentialPresent,
    generativeCapable: false,
  };
}

function capabilityWarnings(capabilities) {
  return Object.entries(capabilities)
    .filter(([, s]) => s.requested && !s.available)
    .map(([key, s]) => ({ code: s.reason, message: `capability "${key}" is requested but not available (${s.reason}).` }));
}

function invocationReport(env, platform) {
  if (readEnv(env, "GITHUB_ACTIONS", platform) === "true") return { mode: "github-actions-v1" };
  const pair = readEnv(env, "QA_AI_INVOCATION_MODE", platform) !== undefined || readEnv(env, "QA_AI_INVOCATION_ID", platform) !== undefined;
  return { mode: "local-v1-orchestrated", callerSuppliedLocalPairPresent: pair };
}

function commandInfo(ctx) {
  const root = resolveRoot(ctx.flags, ctx.cwd);
  const { config, configRelPath } = loadValidatedConfig(root, ctx.flags, { allowMissing: true });
  if (config) checkContainment(root, config, configRelPath);
  const provider = policy.resolveProvider({ env: ctx.env, platform: ctx.platform, offline: ctx.flags.offline, allow: config ? config.providers.allow : ["mock"] });
  const capabilities = policy.capabilityReport(config);
  return {
    exitCode: EXIT_CODES.OK,
    data: {
      product: PRODUCT,
      contracts: { config: CONFIG_SCHEMA_VERSION, cliOutput: CLI_OUTPUT_SCHEMA_VERSION, requirementsCheckReport: REPORT_SCHEMA_VERSION, persistedTriageContext: CONTEXT_SCHEMA_VERSION },
      config: { path: configRelPath, status: config ? "VALID" : "MISSING" },
      capabilities,
      provider: providerReport(provider),
      invocation: invocationReport(ctx.env, ctx.platform),
      platform: { os: ctx.platform, executeDecision: "PENDING_OD_06", supportStatement: "NOT_DECIDED" },
    },
    human: [
      `${PRODUCT.name} ${PRODUCT.version}`,
      `config: ${configRelPath} (${config ? "valid" : "missing"})`,
      `provider: ${provider.effective || "none"} (allowed: ${provider.allowList.join(", ") || "none"}${provider.offline ? ", offline" : ""})`,
      ...Object.entries(capabilities).map(([k, s]) => `capability ${k}: ${s.available ? "available" : `unavailable (${s.reason})`}`),
      "platform: execute support decision pending (OD-06)",
    ],
  };
}

function commandConfigValidate(ctx) {
  const root = resolveRoot(ctx.flags, ctx.cwd);
  const { config, configRelPath } = loadValidatedConfig(root, ctx.flags);
  checkContainment(root, config, configRelPath);
  const provider = policy.resolveProvider({ env: ctx.env, platform: ctx.platform, offline: ctx.flags.offline, allow: config.providers.allow });
  const capabilities = policy.capabilityReport(config);
  const warnings = capabilityWarnings(capabilities);
  return {
    exitCode: EXIT_CODES.OK,
    data: { config: { path: configRelPath, status: "VALID", schemaVersion: config.schemaVersion, framework: config.framework }, capabilities, provider: providerReport(provider), warnings },
    human: [`${configRelPath}: valid (schemaVersion ${config.schemaVersion}, framework ${config.framework})`, ...warnings.map((w) => `warning: ${w.message}`)],
  };
}

function commandRequirementsCheck(ctx) {
  const root = resolveRoot(ctx.flags, ctx.cwd);
  const { config, configRelPath } = loadValidatedConfig(root, ctx.flags);
  checkContainment(root, config, configRelPath);
  const provider = policy.resolveProvider({ env: ctx.env, platform: ctx.platform, offline: ctx.flags.offline, allow: config.providers.allow });
  policy.enforceOffline(provider);
  const { summary, artifacts } = runRequirementsCheck({ root, config, product: PRODUCT });
  return {
    exitCode: EXIT_CODES.OK,
    data: { summary },
    artifacts,
    human: [
      `requirements: ${summary.requirements} (ready: ${summary.ready}), test designs: ${summary.testDesigns}`,
      `coverage: ${Object.entries(summary.coverageStatus).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
      `report: ${artifacts[0]}`,
    ],
  };
}

async function commandTriage(ctx) {
  const stage = ctx.spec.stage;
  const root = resolveRoot(ctx.flags, ctx.cwd);
  const { config, configRelPath } = loadValidatedConfig(root, ctx.flags);
  checkFrameworkAuthority(config, ctx.env, ctx.platform);
  checkContainment(root, config, configRelPath);

  const provider = policy.resolveProvider({ env: ctx.env, platform: ctx.platform, offline: ctx.flags.offline, allow: config.providers.allow });
  policy.enforceOffline(provider);
  const usesHistory = stage === "history" || (stage === "run" && ctx.flags.history);
  if (ctx.flags.offline && usesHistory) {
    throw authorityRefused("OFFLINE_NETWORK_STAGE_REFUSED", "the History stage calls the GitHub API and is refused under --offline.");
  }
  const consumesProvider = stage === "analyze" || stage === "run";
  if (consumesProvider) policy.enforceProviderForConsumer(provider);
  policy.enforceCapability(config, "triage");
  const invocation = triage.resolveInvocation({ stage, env: ctx.env, platform: ctx.platform });

  const result = await triage.runTriage({
    stage,
    flags: ctx.flags,
    root,
    config,
    provider,
    invocation,
    env: ctx.env,
    platform: ctx.platform,
    spawnImpl: ctx.spawnImpl,
    diagnostics: ctx.diagnostics,
  });
  return {
    exitCode: EXIT_CODES.OK,
    data: {
      stages: result.stages,
      invocation: { mode: invocation.mode === "github-actions-v1" ? "github-actions-v1" : invocation.orchestrated ? "local-v1-orchestrated" : invocation.mode === "none" ? "none" : "local-v1-caller-supplied" },
      provider: consumesProvider ? { effective: provider.effective, offline: provider.offline } : undefined,
    },
    artifacts: result.artifacts,
    human: [`triage ${stage}: completed ${result.stages.join(" -> ")}`, ...result.artifacts.map((a) => `artifact: ${a}`)],
  };
}

const HANDLERS = Object.freeze({
  info: commandInfo,
  "config validate": commandConfigValidate,
  "requirements check": commandRequirementsCheck,
});

// --- entry ----------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string[]} options.argv     arguments after the executable
 * @param {object} options.env        ambient environment (read only)
 * @param {string} options.cwd
 * @param {{write(s:string):void}} options.stdout
 * @param {{write(s:string):void}} options.stderr
 * @param {string} [options.platform]
 * @param {Function} [options.spawnImpl] test seam for child_process.spawn
 * @returns {Promise<number>} exit code
 */
async function run({ argv, env = {}, cwd = process.cwd(), stdout, stderr, platform = process.platform, spawnImpl } = {}) {
  let parsed = null;
  let json = Array.isArray(argv) && argv.includes("--json");
  const label = () => (parsed && parsed.command) || null;

  const emitError = (err, extra = {}) => {
    const exitCode = err instanceof CliError ? err.exitCode : EXIT_CODES.INTERNAL;
    const code = err instanceof CliError ? err.code : "INTERNAL_ERROR";
    const message = err instanceof CliError ? err.message : "an unexpected internal error occurred.";
    stderr.write(`qa-agent: error [${code}]: ${boundMessage(message)}\n`);
    if (json) {
      stdout.write(`${JSON.stringify(envelope(label(), exitCode, { errors: [{ code, message: boundMessage(message) }], ...extra }))}\n`);
    }
    return exitCode;
  };

  try {
    parsed = parseArgs(argv);
    json = parsed.flags.json;
    const { command, spec, flags } = parsed;

    if (spec && spec.kind === "reserved") {
      if (flags.help) {
        stdout.write(helpText(command));
        return EXIT_CODES.OK;
      }
      throw authorityRefused("CAPABILITY_NOT_ENABLED_IN_RELEASE", `"${command}" is reserved and not enabled in this release (pending ${spec.ownerDecision}).`);
    }
    if (flags.version) {
      stdout.write(`${PRODUCT.version}\n`);
      return EXIT_CODES.OK;
    }
    if (flags.help) {
      stdout.write(helpText(command));
      return EXIT_CODES.OK;
    }

    const ctx = { command, spec, flags, env, cwd, platform, spawnImpl, diagnostics: (text) => stderr.write(text) };
    const outcome = spec.kind === "triage" ? await commandTriage(ctx) : HANDLERS[command](ctx);
    if (json) {
      stdout.write(`${JSON.stringify(envelope(command, outcome.exitCode, { artifacts: outcome.artifacts || [], ...outcome.data }))}\n`);
    } else {
      stdout.write(`${outcome.human.join("\n")}\n`);
    }
    return outcome.exitCode;
  } catch (err) {
    const extra = {};
    if (err && Array.isArray(err.artifacts)) extra.artifacts = err.artifacts;
    if (err && Array.isArray(err.completedStages)) extra.stages = err.completedStages;
    return emitError(err, extra);
  }
}

module.exports = { run, helpText, CLI_OUTPUT_SCHEMA_VERSION, PRODUCT };
