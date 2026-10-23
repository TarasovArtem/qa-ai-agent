/**
 * Provider factory.
 *
 * createProvider() is the only thing analyze-failure.js imports from this
 * directory - it never touches mock-provider.js (or a real provider file
 * added later) directly. Adding a new provider means adding a new file
 * here plus one new `case` below; nothing outside scripts/ai/providers/
 * needs to change.
 */

"use strict";

const { MockProvider } = require("./mock-provider");
const { GroqProvider } = require("./groq-provider");
const { GeminiProvider } = require("./gemini-provider");
const { ProviderError, PROVIDER_ERROR_CODES } = require("./provider-error");
const { validateProvider } = require("./provider-contract");
const { PROVIDER: RESOLVED_AI_PROVIDER } = require("../config");

// SEC-C1 (OD-RATE-1 FT0): the parent-link cancellation signal of an isolated
// stage child (cli/stage-runner.js, cli/generative-runner.js), bound once at
// child startup, before any provider exists. Every network provider created
// afterwards aborts its in-flight request and refuses new ones once it
// fires. Process-scoped by design - parent loss ends the whole child - and
// never bound anywhere else, so in-process callers and tests see no change.
let cancelSignal = null;

function bindCancelSignal(signal) {
  if (!(signal instanceof AbortSignal)) throw new TypeError("bindCancelSignal(): signal must be an AbortSignal.");
  if (cancelSignal !== null && cancelSignal !== signal) throw new Error("bindCancelSignal(): a different cancel signal is already bound.");
  cancelSignal = signal;
}

// `providerName` defaults to config.js's resolved AI_PROVIDER (itself
// already defaulting to "mock" when unset) - passing it explicitly is
// mainly for tests, so they don't need to mutate process.env.
function createProvider(providerName = RESOLVED_AI_PROVIDER) {
  let provider;

  switch (providerName) {
    case "mock":
      provider = new MockProvider();
      break;
    case "groq":
      // Reads AI_API_KEY/AI_MODEL from config.js by default (see
      // groq-provider.js's constructor) - a missing key/model surfaces as
      // a ProviderError right here, at creation time, not on the first
      // analyze() call.
      provider = new GroqProvider({ cancelSignal });
      break;
    case "gemini":
      // Same generic-config pattern as "groq" above (see
      // gemini-provider.js's constructor) - a missing key/model surfaces
      // as a ProviderError right here, at creation time.
      provider = new GeminiProvider({ cancelSignal });
      break;
    default:
      // No silent fallback to a real provider for an unrecognized name -
      // that would hide a configuration mistake behind a call that looks
      // like it's using one provider while actually using another.
      throw new ProviderError(`Unsupported AI provider: ${providerName}`, {
        code: PROVIDER_ERROR_CODES.CONFIGURATION,
        retryable: false,
      });
  }

  // Guards against a future `case` here returning something that doesn't
  // actually implement the provider contract (e.g. a real provider class
  // with a typo'd method name) - fails at creation time with a clear
  // message instead of a confusing crash the first time it's called.
  validateProvider(provider);
  return provider;
}

module.exports = { createProvider, bindCancelSignal };
