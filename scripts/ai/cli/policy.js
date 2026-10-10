/**
 * Provider, offline and capability policy of the Controlled-v1 CLI
 * (docs/controlled-v1-productization-contract-v1.md §10.4; mission §10-§12).
 *
 * Everything here is pure: it reads only the validated config snapshot and
 * the ambient environment values it is handed, and it never loads a
 * provider or the env-snapshotting scripts/ai/config.js module. Provider
 * modules are only ever loaded inside an isolated child stage process whose
 * environment already equals the decision made here (child-env.js).
 *
 * Product-owned facts (never target-editable):
 *   - provider vocabulary and which providers are network providers;
 *   - which capabilities the installed release enables;
 *   - which commands consume a provider.
 */

"use strict";

const { readEnv, hasNonEmpty } = require("./env");
const { configError, authorityRefused } = require("./errors");
const { KNOWN_PROVIDERS, CAPABILITY_KEYS } = require("./config-file");

const DEFAULT_PROVIDER = "mock";
const NETWORK_PROVIDERS = Object.freeze(["groq", "gemini"]);

// Release enablement is a property of this installed build. Stage 1-2 ships
// triage only; everything else is reserved behind an owner decision.
const RELEASE_CAPABILITIES = Object.freeze({
  triage: Object.freeze({ enabled: true, reason: null }),
  design: Object.freeze({ enabled: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE", ownerDecision: "OD-02" }),
  plan: Object.freeze({ enabled: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE", ownerDecision: "OD-02" }),
  generate: Object.freeze({ enabled: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE", ownerDecision: "OD-02" }),
  reviewRecord: Object.freeze({ enabled: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE", ownerDecision: "OD-04" }),
  apply: Object.freeze({ enabled: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE", ownerDecision: "OD-04" }),
  execute: Object.freeze({ enabled: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE", ownerDecision: "OD-06" }),
});

// Effective provider facts for one invocation. Never contains a credential
// value - only presence booleans.
function resolveProvider({ env, platform, offline, allow }) {
  const raw = readEnv(env, "AI_PROVIDER", platform);
  const requested = raw === undefined || raw === "" ? DEFAULT_PROVIDER : raw;
  const known = KNOWN_PROVIDERS.includes(requested);
  const network = NETWORK_PROVIDERS.includes(requested);
  // Under --offline only `mock` is admissible; any other explicit selection
  // is a contradiction that is refused, never silently replaced.
  const offlineContradiction = Boolean(offline) && requested !== DEFAULT_PROVIDER;
  return Object.freeze({
    requested: known ? requested : null,
    effective: known && !offlineContradiction ? requested : null,
    known,
    network,
    offline: Boolean(offline),
    offlineContradiction,
    allowed: known && allow.includes(requested),
    allowList: Object.freeze([...allow]),
    credentialPresent: network ? hasNonEmpty(env, "AI_API_KEY", platform) : false,
    modelPresent: network ? hasNonEmpty(env, "AI_MODEL", platform) : false,
  });
}

// Step 6 (offline mode resolution).
function enforceOffline(provider) {
  if (provider.offlineContradiction) {
    throw authorityRefused(
      "OFFLINE_PROVIDER_CONTRADICTION",
      "--offline admits only the mock provider, but AI_PROVIDER selects another provider; refusing instead of choosing one."
    );
  }
}

// Steps 7-10 for a command that consumes a provider.
function enforceProviderForConsumer(provider) {
  if (!provider.known) {
    throw configError("PROVIDER_CONFIGURATION_INVALID", `AI_PROVIDER is not a supported provider (supported: ${KNOWN_PROVIDERS.join(", ")}).`);
  }
  if (!provider.allowed) {
    throw authorityRefused("PROVIDER_NOT_ALLOWED", `provider "${provider.requested}" is not in providers.allow of qa-agent.config.json.`);
  }
  // Step 9 (command/provider compatibility): every shipped provider,
  // including mock, implements the triage contract - the only
  // provider-consuming capability enabled in this release.
  if (provider.network && (!provider.credentialPresent || !provider.modelPresent)) {
    throw configError("PROVIDER_CONFIGURATION_INVALID", `provider "${provider.requested}" requires AI_API_KEY and AI_MODEL to be set.`);
  }
}

function capabilityStatus(config, key) {
  const requested = Boolean(config && config.capabilities && config.capabilities[key]);
  const release = RELEASE_CAPABILITIES[key];
  if (!release.enabled) return Object.freeze({ requested, available: false, reason: release.reason });
  if (!requested) return Object.freeze({ requested, available: false, reason: "CAPABILITY_NOT_REQUESTED" });
  return Object.freeze({ requested, available: true });
}

function capabilityReport(config) {
  const out = {};
  for (const key of CAPABILITY_KEYS) out[key] = capabilityStatus(config, key);
  return Object.freeze(out);
}

// Step 11 (release capability authorization).
function enforceCapability(config, key) {
  const status = capabilityStatus(config, key);
  if (status.available) return;
  if (status.reason === "CAPABILITY_NOT_REQUESTED") {
    throw authorityRefused("CAPABILITY_NOT_REQUESTED", `capability "${key}" is not requested in qa-agent.config.json (capabilities.${key}).`);
  }
  throw authorityRefused(status.reason, `capability "${key}" is not enabled in this release.`);
}

module.exports = {
  DEFAULT_PROVIDER,
  NETWORK_PROVIDERS,
  RELEASE_CAPABILITIES,
  resolveProvider,
  enforceOffline,
  enforceProviderForConsumer,
  capabilityStatus,
  capabilityReport,
  enforceCapability,
};
