/**
 * GroqProvider - talks to Groq's OpenAI-compatible Chat Completions API.
 *
 * Scope is deliberately narrow: configuration -> HTTP request -> Groq API
 * -> HTTP/network error mapping -> extract the model's raw text output.
 * Nothing here parses that text as JSON, validates a classification, or
 * knows anything about the QA report schema - that stays in
 * analyze-failure.js, exactly as it does for MockProvider. This file is
 * the only place in the project that knows Groq's endpoint URL, request
 * shape, or auth header.
 *
 * No response_format / JSON mode is requested: Groq JSON-mode support
 * varies by model and isn't something to guess at without calling the
 * real API, which this stage intentionally does not do. The system prompt
 * (qa-agent-prompt.js) already demands raw JSON, and analyze-failure.js
 * already strips an accidental markdown fence - both provider-neutral
 * fallbacks that work whether or not a future model change adds JSON mode.
 */

"use strict";

const { ProviderError, PROVIDER_ERROR_CODES } = require("./provider-error");
const { API_KEY, MODEL } = require("../config");
const { readBoundedResponseJson, BOUNDED_RESPONSE_FAILURES } = require("../bounded-response");

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30000;
// TSB-F06: byte cap on the response envelope, enforced while the body
// streams in and before any JSON parse. Sized so that no generator's
// pre-parse MAX_*_RESPONSE_CHARS bound of practical size (the largest is
// automation-candidate-generator.js's 3,369,016 characters) can be falsely
// rejected here even if every UTF-16 code unit of the model text arrived
// JSON-escaped as a 6-byte \uXXXX sequence (6 x 3,369,016 = 20,214,096
// bytes), with the remainder left for the envelope itself.
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

// HTTP status -> generic ProviderError code/retryable. Deliberately no
// Groq-specific codes (e.g. "GROQ_RATE_LIMIT") - only the shared,
// provider-neutral PROVIDER_ERROR_CODES vocabulary analyze-failure.js
// already understands.
function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return new ProviderError(`Groq API authentication failed (HTTP ${status})`, {
      code: PROVIDER_ERROR_CODES.AUTH,
      retryable: false,
    });
  }
  if (status === 429) {
    return new ProviderError(`Groq API rate limit exceeded (HTTP ${status})`, {
      code: PROVIDER_ERROR_CODES.RATE_LIMIT,
      retryable: true,
    });
  }
  if (status === 408) {
    return new ProviderError(`Groq API request timed out (HTTP ${status})`, {
      code: PROVIDER_ERROR_CODES.TIMEOUT,
      retryable: true,
    });
  }
  if (status >= 500 && status <= 599) {
    return new ProviderError(`Groq API server error (HTTP ${status})`, {
      code: PROVIDER_ERROR_CODES.UNKNOWN,
      retryable: true,
    });
  }
  // Any other 4xx: a request-shape problem that will fail identically on
  // retry (not authentication, not rate limiting, not a 408).
  return new ProviderError(`Groq API request failed (HTTP ${status})`, {
    code: PROVIDER_ERROR_CODES.UNKNOWN,
    retryable: false,
  });
}

// TSB-F06 + ADV-01: bounded body-read failure -> the existing generic
// codes. The deadline firing mid-body is the same TIMEOUT (retryable) the
// request itself already reports; an oversized body is INVALID_RESPONSE,
// like any other unusable envelope. Every other failure keeps the
// pre-existing "not valid JSON" mapping. No cause is attached: the
// reader's own errors never carry body content and are fully described by
// the code and message.
function mapBodyReadError(err, timeoutMs) {
  if (err && err.reason === BOUNDED_RESPONSE_FAILURES.ABORTED) {
    return new ProviderError(`Groq API request timed out after ${timeoutMs}ms`, {
      code: PROVIDER_ERROR_CODES.TIMEOUT,
      retryable: true,
    });
  }
  if (err && err.reason === BOUNDED_RESPONSE_FAILURES.TOO_LARGE) {
    return new ProviderError(`Groq API response body exceeded the maximum of ${MAX_RESPONSE_BYTES} bytes`, {
      code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
      retryable: false,
    });
  }
  return new ProviderError("Groq API returned a response that was not valid JSON", {
    code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
    retryable: false,
  });
}

class GroqProvider {
  name = "groq";

  // Dependency injection, not environment reads inside analyze(): lets
  // unit tests construct a fully offline GroqProvider (fake fetchImpl, a
  // throwaway key/model, a short timeoutMs) with no process.env
  // manipulation and no real network access. Production (createProvider(),
  // see providers/index.js) calls `new GroqProvider()` with no arguments,
  // which falls back to this project's existing generic config (AI_API_KEY,
  // AI_MODEL) - GroqProvider never introduces a GROQ_-prefixed env var of
  // its own.
  constructor({ apiKey = API_KEY, model = MODEL, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!apiKey) {
      throw new ProviderError('AI_API_KEY is required for provider "groq"', {
        code: PROVIDER_ERROR_CODES.CONFIGURATION,
        retryable: false,
      });
    }
    if (!model) {
      throw new ProviderError('AI_MODEL is required for provider "groq"', {
        code: PROVIDER_ERROR_CODES.CONFIGURATION,
        retryable: false,
      });
    }

    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async analyze({ systemPrompt, userPrompt }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await this.fetchImpl(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // AbortController firing (our own timeout) vs. any other fetch
      // failure (DNS, connection reset, TLS, etc.) are different generic
      // codes even though both surface as a thrown error from fetch() -
      // only the timeout case is a controller.abort() we triggered
      // ourselves.
      if (err && err.name === "AbortError") {
        throw new ProviderError(`Groq API request timed out after ${this.timeoutMs}ms`, {
          code: PROVIDER_ERROR_CODES.TIMEOUT,
          retryable: true,
          cause: err,
        });
      }
      throw new ProviderError(`Groq API request failed: ${(err && err.message) || "network error"}`, {
        code: PROVIDER_ERROR_CODES.NETWORK,
        retryable: true,
        cause: err,
      });
    }

    if (!res.ok) {
      clearTimeout(timer);
      throw mapHttpError(res.status);
    }

    // TSB-F06 + ADV-01: the same per-request deadline stays armed through
    // the body read, so a stalled or slow-drip body ends as the same
    // TIMEOUT a slow response would; the body is never read past
    // MAX_RESPONSE_BYTES and is parsed only once fully acquired.
    let body;
    try {
      body = await readBoundedResponseJson(res, { maxBytes: MAX_RESPONSE_BYTES, signal: controller.signal, label: "Groq API" });
    } catch (err) {
      throw mapBodyReadError(err, this.timeoutMs);
    } finally {
      clearTimeout(timer);
    }

    // Only checking that the envelope actually contains textual model
    // output - not what that text says. Whether it's valid JSON, a QA
    // report, or nonsense is analyze-failure.js's job to determine next.
    const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new ProviderError("Groq API response did not include any model content", {
        code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
        retryable: false,
      });
    }

    return content;
  }
}

module.exports = { GroqProvider, MAX_RESPONSE_BYTES };
