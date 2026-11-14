/**
 * GeminiProvider - talks to Google's native Gemini REST API
 * (generateContent), not the Google GenAI SDK.
 *
 * Scope is deliberately narrow, mirroring groq-provider.js exactly:
 * configuration -> HTTP request -> Gemini API -> HTTP/network error mapping
 * -> extract the model's raw text output. Nothing here parses that text as
 * JSON, validates a classification, or knows anything about the QA report
 * schema - that stays in analyze-failure.js, exactly as it does for
 * GroqProvider/MockProvider. This file is the only place in the project
 * that knows Gemini's endpoint URL, request shape, or auth header.
 *
 * No responseMimeType/responseSchema (Gemini's native structured-output
 * mode) is requested: the system prompt (qa-agent-prompt.js) already
 * demands raw JSON, and analyze-failure.js already strips an accidental
 * markdown fence - the same provider-neutral fallbacks Groq relies on,
 * kept identical here so both real providers exercise the exact same core
 * parsing path (Roadmap #18.5/#18.6).
 */

"use strict";

const { ProviderError, PROVIDER_ERROR_CODES } = require("./provider-error");
const { API_KEY, MODEL } = require("../config");
const { readBoundedResponseJson, BOUNDED_RESPONSE_FAILURES } = require("../bounded-response");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 30000;
// TSB-F06: byte cap on the response envelope - identical value and
// derivation to groq-provider.js's MAX_RESPONSE_BYTES (no generator's
// practical pre-parse MAX_*_RESPONSE_CHARS bound, at worst-case 6-byte
// JSON escaping per UTF-16 code unit, can be falsely rejected).
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

// TPR-G1-PD1: output control, sent on every request. MAX_OUTPUT_TOKENS is a
// fixed constant, NOT configuration - no environment variable exists for it,
// so the closed stage-child environment (cli/child-env.js) is unchanged. The
// constructor accepts an override for tests only, validated against
// MODEL_OUTPUT_TOKEN_LIMIT (Gemini 3.5 Flash-Lite's documented output token
// limit). THINKING_LEVEL is the documented default level for that model,
// sent explicitly so a changed provider default cannot widen it silently.
// thinkingBudget/includeThoughts are deliberately never sent.
//
// What this does NOT guarantee: Google documents maxOutputTokens as
// including thought tokens only for its Interactions API, not for
// generateContent. The usage check in checkUsage() below is therefore
// retrospective - it detects an over-cap call after the provider has
// produced (and billed) it, and stops the run there. It is not a hard
// monetary cap.
const MAX_OUTPUT_TOKENS = 8192;
const MODEL_OUTPUT_TOKEN_LIMIT = 65536;
const THINKING_LEVEL = "MINIMAL";

// finishReason values named verbatim in an error message. Anything else is
// reported as "missing or unrecognized", so no free-form provider text ever
// reaches an error message.
const NAMED_FINISH_REASONS = new Set(["MAX_TOKENS", "CONTINUATION", "SAFETY"]);

// HTTP status -> generic ProviderError code/retryable. Deliberately no
// Gemini-specific codes - only the shared, provider-neutral
// PROVIDER_ERROR_CODES vocabulary analyze-failure.js already understands,
// exactly mirroring groq-provider.js's mapHttpError() structure. Gemini's
// documented status codes (400/401/403/404/409/416/429/499/500/501/503/504)
// fold into the same four buckets Groq's own mapping already uses - no new
// TIMEOUT-via-HTTP-status case is introduced (Gemini does not document a
// 408; TIMEOUT here only ever comes from this adapter's own AbortController,
// same as Groq).
function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return new ProviderError(`Gemini API authentication failed (HTTP ${status})`, {
      code: PROVIDER_ERROR_CODES.AUTH,
      retryable: false,
    });
  }
  if (status === 429) {
    return new ProviderError(`Gemini API rate limit exceeded (HTTP ${status})`, {
      code: PROVIDER_ERROR_CODES.RATE_LIMIT,
      retryable: true,
    });
  }
  if (status >= 500 && status <= 599) {
    return new ProviderError(`Gemini API server error (HTTP ${status})`, {
      code: PROVIDER_ERROR_CODES.UNKNOWN,
      retryable: true,
    });
  }
  // Any other 4xx (400/404/409/416/499): a request-shape problem that will
  // fail identically on retry.
  return new ProviderError(`Gemini API request failed (HTTP ${status})`, {
    code: PROVIDER_ERROR_CODES.UNKNOWN,
    retryable: false,
  });
}

// SEC-C1 (OD-RATE-1 FT0-C1): exactly mirroring groq-provider.js's
// releaseErrorResponse() - an unsuccessful response's never-read body is
// cancelled and its request aborted at once, fire-and-forget.
function releaseErrorResponse(res, controller) {
  try {
    const pending = res.body && typeof res.body.cancel === "function" ? res.body.cancel() : null;
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {
    // already locked / errored / closed - nothing further to release
  }
  controller.abort();
}

// TSB-F06 + ADV-01: bounded body-read failure -> the existing generic
// codes, exactly mirroring groq-provider.js's mapBodyReadError().
function mapBodyReadError(err, timeoutMs) {
  if (err && err.reason === BOUNDED_RESPONSE_FAILURES.ABORTED) {
    return new ProviderError(`Gemini API request timed out after ${timeoutMs}ms`, {
      code: PROVIDER_ERROR_CODES.TIMEOUT,
      retryable: true,
    });
  }
  if (err && err.reason === BOUNDED_RESPONSE_FAILURES.TOO_LARGE) {
    return new ProviderError(`Gemini API response body exceeded the maximum of ${MAX_RESPONSE_BYTES} bytes`, {
      code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
      retryable: false,
    });
  }
  return new ProviderError("Gemini API returned a response that was not valid JSON", {
    code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
    retryable: false,
  });
}

// SEC-C1 (OD-RATE-1 FT0): exactly mirroring groq-provider.js's
// cancelledError() - parent loss is never retryable, never a new code, and
// carries no cause.
function cancelledError() {
  return new ProviderError("Gemini API request cancelled: the parent process disconnected", {
    code: PROVIDER_ERROR_CODES.UNKNOWN,
    retryable: false,
  });
}

// Gemini's response splits model output across zero or more "parts" inside
// a single candidate's content - in ordinary (non-tool, non-thinking)
// text-only usage there is normally exactly one text part, but the
// envelope always allows more than one. Deterministic, documented-shape
// strategy: concatenate every part that carries a `text` string, in the
// array's own order, with no separator - the parts together represent one
// continuous response, not separate messages. A part without a `text`
// field (a future non-text part type this adapter never requests, e.g. a
// function call) is simply skipped, never coerced into a string. Returns
// null (not "") when there is no usable text at all, so the caller can
// distinguish "no text" from "empty text" without extra bookkeeping.
//
// TPR-G1-PD1: a part marked `thought: true` is the model's reasoning, never
// its answer, and is skipped exactly like a non-text part (includeThoughts is
// never requested, so none is expected - this is defense in depth).
function extractText(body) {
  const candidate = firstCandidate(body);
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const textParts = parts.filter((p) => p && typeof p.text === "string" && p.thought !== true).map((p) => p.text);
  if (textParts.length === 0) return null;
  const joined = textParts.join("");
  return joined.trim().length > 0 ? joined : null;
}

function firstCandidate(body) {
  return body && Array.isArray(body.candidates) ? body.candidates[0] : undefined;
}

function invalidResponse(message) {
  return new ProviderError(message, { code: PROVIDER_ERROR_CODES.INVALID_RESPONSE, retryable: false });
}

// TPR-G1-PD1: only a candidate that finished normally is usable. A response
// cut off at maxOutputTokens (MAX_TOKENS), an incomplete one (CONTINUATION),
// a blocked one (SAFETY) or one with no/an unknown finishReason is rejected
// as non-retryable: a retry would repeat the same cost, and a truncated JSON
// answer must never reach a generator's validation-correction retry.
// Returns a ProviderError, or null when the candidate finished with STOP.
function checkFinishReason(body, maxOutputTokens) {
  const candidate = firstCandidate(body);
  const reason = candidate && typeof candidate === "object" ? candidate.finishReason : undefined;
  if (reason === "STOP") return null;
  if (reason === "MAX_TOKENS") {
    return invalidResponse(`Gemini API response was cut off at the output token limit (maxOutputTokens ${maxOutputTokens})`);
  }
  const named = typeof reason === "string" && NAMED_FINISH_REASONS.has(reason) ? reason : "missing or unrecognized";
  return invalidResponse(`Gemini API response did not finish normally (finishReason: ${named})`);
}

function isTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// TPR-G1-PD1: retrospective output-consumption check from usageMetadata.
// Output = totalTokenCount - promptTokenCount - toolUsePromptTokenCount
// (Google documents totalTokenCount as prompt + tool-use prompt + thoughts +
// response candidates), so thought tokens are counted even if the separate
// thoughtsTokenCount field is absent. When candidatesTokenCount or
// thoughtsTokenCount is present it must be a valid count too, and their sum
// is checked against the cap as well. Missing or invalid counters, a negative
// derived output, or output above maxOutputTokens are all non-retryable.
// Returns a ProviderError, or null.
function checkUsage(body, maxOutputTokens) {
  const usage = body ? body.usageMetadata : undefined;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return invalidResponse("Gemini API response did not include valid usage metadata");
  }
  const { promptTokenCount, totalTokenCount, toolUsePromptTokenCount, candidatesTokenCount, thoughtsTokenCount } = usage;
  if (!isTokenCount(promptTokenCount) || !isTokenCount(totalTokenCount)) {
    return invalidResponse("Gemini API response did not include valid usage metadata");
  }
  for (const optional of [toolUsePromptTokenCount, candidatesTokenCount, thoughtsTokenCount]) {
    if (optional !== undefined && !isTokenCount(optional)) {
      return invalidResponse("Gemini API response did not include valid usage metadata");
    }
  }
  const output = totalTokenCount - promptTokenCount - (toolUsePromptTokenCount ?? 0);
  if (output < 0) {
    return invalidResponse("Gemini API response usage metadata is inconsistent (negative output token count)");
  }
  const reportedOutput = (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0);
  if (output > maxOutputTokens || reportedOutput > maxOutputTokens) {
    return invalidResponse(`Gemini API response used more output tokens than the limit (maxOutputTokens ${maxOutputTokens})`);
  }
  return null;
}

class GeminiProvider {
  name = "gemini";

  // Dependency injection, not environment reads inside analyze(): lets unit
  // tests construct a fully offline GeminiProvider (fake fetchImpl, a
  // throwaway key/model, a short timeoutMs) with no process.env
  // manipulation and no real network access - identical pattern to
  // GroqProvider. Production (createProvider(), see providers/index.js)
  // passes no credential/model/transport arguments, so it falls back to
  // this project's existing generic config (AI_API_KEY, AI_MODEL) -
  // GeminiProvider never introduces a GEMINI_-prefixed env var of its own.
  // `cancelSignal` (SEC-C1) is identical to GroqProvider's.
  //
  // `maxOutputTokens` (TPR-G1-PD1) is a test-only override of
  // MAX_OUTPUT_TOKENS - production never passes it. It must be an integer in
  // 1..MODEL_OUTPUT_TOKEN_LIMIT; anything else is CONFIGURATION, thrown here,
  // so no request is ever sent with an invalid or missing limit.
  constructor({
    apiKey = API_KEY,
    model = MODEL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cancelSignal = null,
    maxOutputTokens = MAX_OUTPUT_TOKENS,
  } = {}) {
    if (!apiKey) {
      throw new ProviderError('AI_API_KEY is required for provider "gemini"', {
        code: PROVIDER_ERROR_CODES.CONFIGURATION,
        retryable: false,
      });
    }
    if (!model) {
      throw new ProviderError('AI_MODEL is required for provider "gemini"', {
        code: PROVIDER_ERROR_CODES.CONFIGURATION,
        retryable: false,
      });
    }
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > MODEL_OUTPUT_TOKEN_LIMIT) {
      throw new ProviderError(`maxOutputTokens for provider "gemini" must be an integer from 1 to ${MODEL_OUTPUT_TOKEN_LIMIT}`, {
        code: PROVIDER_ERROR_CODES.CONFIGURATION,
        retryable: false,
      });
    }

    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cancelSignal = cancelSignal;
    this.maxOutputTokens = maxOutputTokens;
  }

  // SEC-C1: identical to GroqProvider.analyze() - no request after parent
  // loss, and parent loss aborts the in-flight one via the same controller.
  async analyze({ systemPrompt, userPrompt }) {
    if (this.cancelSignal && this.cancelSignal.aborted) throw cancelledError();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onCancel = () => controller.abort();
    if (this.cancelSignal) this.cancelSignal.addEventListener("abort", onCancel, { once: true });
    try {
      return await this.#exchange(controller, timer, systemPrompt, userPrompt);
    } catch (err) {
      if (this.cancelSignal && this.cancelSignal.aborted) throw cancelledError();
      throw err;
    } finally {
      clearTimeout(timer);
      if (this.cancelSignal) this.cancelSignal.removeEventListener("abort", onCancel);
    }
  }

  async #exchange(controller, timer, systemPrompt, userPrompt) {
    // Model belongs in the URL path (Gemini's own REST convention), never
    // hardcoded - always the configured this.model, so a future AI_MODEL
    // change requires no adapter change.
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(this.model)}:generateContent`;

    let res;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // systemPrompt/userPrompt stay semantically separate, exactly as
          // core (qa-agent-prompt.js) built them - no rewriting, no
          // merging into a single blob. systemInstruction is Gemini's own
          // dedicated field for this, not a message role.
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          // TPR-G1-PD1: output and thinking control (see MAX_OUTPUT_TOKENS).
          generationConfig: {
            maxOutputTokens: this.maxOutputTokens,
            thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // AbortController firing (our own timeout) vs. any other fetch
      // failure (DNS, connection reset, TLS, etc.) are different generic
      // codes even though both surface as a thrown error from fetch() -
      // identical distinction to GroqProvider.
      if (err && err.name === "AbortError") {
        throw new ProviderError(`Gemini API request timed out after ${this.timeoutMs}ms`, {
          code: PROVIDER_ERROR_CODES.TIMEOUT,
          retryable: true,
          cause: err,
        });
      }
      throw new ProviderError(`Gemini API request failed: ${(err && err.message) || "network error"}`, {
        code: PROVIDER_ERROR_CODES.NETWORK,
        retryable: true,
        cause: err,
      });
    }

    if (!res.ok) {
      clearTimeout(timer);
      releaseErrorResponse(res, controller);
      throw mapHttpError(res.status);
    }

    // TSB-F06 + ADV-01: identical to GroqProvider - the per-request
    // deadline stays armed through the bounded body read.
    let body;
    try {
      body = await readBoundedResponseJson(res, { maxBytes: MAX_RESPONSE_BYTES, signal: controller.signal, label: "Gemini API" });
    } catch (err) {
      throw mapBodyReadError(err, this.timeoutMs);
    } finally {
      clearTimeout(timer);
    }

    // Covers every "no usable text" shape uniformly (missing candidates,
    // empty candidates array, missing content, empty parts, parts with no
    // text field - e.g. a safety block or any other non-text-only
    // response) - the caller does not need to know *why* there is no text,
    // only that there isn't any.
    //
    // TPR-G1-PD1: finishReason, then usage, then text - every failure is a
    // non-retryable INVALID_RESPONSE.
    const finishError = checkFinishReason(body, this.maxOutputTokens);
    if (finishError) throw finishError;
    const usageError = checkUsage(body, this.maxOutputTokens);
    if (usageError) throw usageError;

    const content = extractText(body);
    if (content === null) {
      throw new ProviderError("Gemini API response did not include any model content", {
        code: PROVIDER_ERROR_CODES.INVALID_RESPONSE,
        retryable: false,
      });
    }

    return content;
  }
}

module.exports = { GeminiProvider, MAX_RESPONSE_BYTES, MAX_OUTPUT_TOKENS, MODEL_OUTPUT_TOKEN_LIMIT, THINKING_LEVEL };
