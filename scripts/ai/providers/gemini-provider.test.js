"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { GeminiProvider } = require("./gemini-provider");
const { ProviderError, PROVIDER_ERROR_CODES } = require("./provider-error");

// Fakes global fetch's Response shape just enough for GeminiProvider - no
// real network access anywhere in this file.
// TSB-F06: a real Web Response (status-derived `ok`, a real body stream),
// since the adapter now reads the body through the bounded stream reader
// rather than calling `.json()`.
function fakeResponse({ status = 200, body }) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

// TPR-G1-PD1: a normally finished response carries finishReason "STOP" and
// valid usageMetadata (output 100 + 20 thought tokens, well under the cap).
const OK_USAGE = Object.freeze({ promptTokenCount: 50, candidatesTokenCount: 100, thoughtsTokenCount: 20, totalTokenCount: 170 });

// An option passed explicitly as `undefined` means "omit the field" - it must
// never fall back to the normal value, or a missing-field test would pass
// for the wrong reason.
function partsBody(parts, options = {}) {
  const finishReason = Object.hasOwn(options, "finishReason") ? options.finishReason : "STOP";
  const usageMetadata = Object.hasOwn(options, "usageMetadata") ? options.usageMetadata : OK_USAGE;
  const candidate = { content: { parts } };
  if (finishReason !== undefined) candidate.finishReason = finishReason;
  const body = { candidates: [candidate] };
  if (usageMetadata !== undefined) body.usageMetadata = usageMetadata;
  return body;
}

function generateContentBody(text, options) {
  return partsBody([{ text }], options);
}

function provider(overrides = {}) {
  return new GeminiProvider({
    apiKey: "test-key",
    model: "gemini-3.6-flash",
    fetchImpl: async () => fakeResponse({ body: generateContentBody('{"results":[]}') }),
    ...overrides,
  });
}

test("GeminiProvider: name is 'gemini'", () => {
  assert.equal(provider().name, "gemini");
});

// --- success -----------------------------------------------------------

test("GeminiProvider.analyze: returns the model content as a string", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: generateContentBody('{"results":[]}') }) });
  const result = await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(result, '{"results":[]}');
  assert.equal(typeof result, "string");
});

test("GeminiProvider.analyze: sends the configured model in the URL, the expected headers, and both prompts mapped correctly", async () => {
  let capturedUrl;
  let capturedInit;
  const fetchImpl = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return fakeResponse({ body: generateContentBody("ok") });
  };
  const p = new GeminiProvider({ apiKey: "my-key", model: "gemini-3.6-flash", fetchImpl });

  await p.analyze({ systemPrompt: "SYSTEM", userPrompt: "USER" });

  assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers["x-goog-api-key"], "my-key");
  assert.equal(capturedInit.headers["Content-Type"], "application/json");

  const body = JSON.parse(capturedInit.body);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: "SYSTEM" }] });
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "USER" }] }]);
});

test("GeminiProvider.analyze: a different configured model changes the URL - the model is never hardcoded", async () => {
  let capturedUrl;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return fakeResponse({ body: generateContentBody("ok") });
  };
  const p = new GeminiProvider({ apiKey: "key", model: "gemini-2.5-pro", fetchImpl });
  await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent");
});

test("GeminiProvider.analyze: concatenates multiple text parts deterministically, in order", async () => {
  const p = provider({
    fetchImpl: async () =>
      fakeResponse({
        body: partsBody([{ text: "hello " }, { text: "world" }]),
      }),
  });
  const result = await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(result, "hello world");
});

test("GeminiProvider.analyze: a non-text part (e.g. a future function-call-shaped part) is skipped, not coerced to a string", async () => {
  const p = provider({
    fetchImpl: async () =>
      fakeResponse({
        body: partsBody([{ functionCall: { name: "x" } }, { text: "the actual text" }]),
      }),
  });
  const result = await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(result, "the actual text");
});

// --- configuration -------------------------------------------------------

test("GeminiProvider: missing API key throws CONFIGURATION, non-retryable", () => {
  assert.throws(
    () => new GeminiProvider({ apiKey: null, model: "gemini-3.6-flash", fetchImpl: async () => {} }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.CONFIGURATION);
      assert.equal(err.retryable, false);
      return true;
    }
  );
});

test("GeminiProvider: missing model throws CONFIGURATION, non-retryable", () => {
  assert.throws(
    () => new GeminiProvider({ apiKey: "key", model: null, fetchImpl: async () => {} }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.CONFIGURATION);
      assert.equal(err.retryable, false);
      return true;
    }
  );
});

// --- HTTP error mapping ----------------------------------------------------

async function analyzeExpectingError(status) {
  const p = provider({ fetchImpl: async () => fakeResponse({ status }) });
  try {
    await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
    assert.fail(`expected HTTP ${status} to throw`);
  } catch (err) {
    return err;
  }
}

test("GeminiProvider: HTTP 401 maps to AUTH, non-retryable", async () => {
  const err = await analyzeExpectingError(401);
  assert.ok(err instanceof ProviderError);
  assert.equal(err.code, PROVIDER_ERROR_CODES.AUTH);
  assert.equal(err.retryable, false);
});

test("GeminiProvider: HTTP 403 maps to AUTH, non-retryable", async () => {
  const err = await analyzeExpectingError(403);
  assert.equal(err.code, PROVIDER_ERROR_CODES.AUTH);
  assert.equal(err.retryable, false);
});

test("GeminiProvider: HTTP 429 maps to RATE_LIMIT, retryable", async () => {
  const err = await analyzeExpectingError(429);
  assert.equal(err.code, PROVIDER_ERROR_CODES.RATE_LIMIT);
  assert.equal(err.retryable, true);
});

test("GeminiProvider: HTTP 500 is UNKNOWN, retryable", async () => {
  const err = await analyzeExpectingError(500);
  assert.equal(err.code, PROVIDER_ERROR_CODES.UNKNOWN);
  assert.equal(err.retryable, true);
});

test("GeminiProvider: HTTP 503 is UNKNOWN, retryable", async () => {
  const err = await analyzeExpectingError(503);
  assert.equal(err.code, PROVIDER_ERROR_CODES.UNKNOWN);
  assert.equal(err.retryable, true);
});

test("GeminiProvider: HTTP 504 is UNKNOWN, retryable (Gemini documents this as a 5xx gateway timeout, not a 408)", async () => {
  const err = await analyzeExpectingError(504);
  assert.equal(err.code, PROVIDER_ERROR_CODES.UNKNOWN);
  assert.equal(err.retryable, true);
});

test("GeminiProvider: an unmapped 4xx (e.g. 400 or 404) is UNKNOWN, not retryable", async () => {
  const err400 = await analyzeExpectingError(400);
  assert.equal(err400.code, PROVIDER_ERROR_CODES.UNKNOWN);
  assert.equal(err400.retryable, false);
  const err404 = await analyzeExpectingError(404);
  assert.equal(err404.retryable, false);
});

// --- network / timeout ------------------------------------------------------

test("GeminiProvider: a network-level fetch failure maps to NETWORK, retryable, with cause preserved", async () => {
  const networkError = new Error("network down");
  const p = provider({
    fetchImpl: async () => {
      throw networkError;
    },
  });

  await assert.rejects(
    () => p.analyze({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.NETWORK);
      assert.equal(err.retryable, true);
      assert.equal(err.cause, networkError);
      return true;
    }
  );
});

test("GeminiProvider: an AbortController timeout maps to TIMEOUT, retryable - deterministic, no real waiting", async () => {
  // fetchImpl honors the AbortSignal exactly like a real fetch would,
  // rejecting with a DOMException-shaped AbortError as soon as the
  // provider's own short timeoutMs fires - no real 30s wait in this test.
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "AbortError";
        reject(abortErr);
      });
    });

  const p = provider({ fetchImpl, timeoutMs: 10 });

  await assert.rejects(
    () => p.analyze({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.TIMEOUT);
      assert.equal(err.retryable, true);
      return true;
    }
  );
});

test("GeminiProvider.analyze: the fetch call receives an AbortSignal", async () => {
  let capturedInit;
  const fetchImpl = async (url, init) => {
    capturedInit = init;
    return fakeResponse({ body: generateContentBody("ok") });
  };
  const p = provider({ fetchImpl });
  await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.ok(capturedInit.signal instanceof AbortSignal);
});

// --- malformed / missing response content -----------------------------------

test("GeminiProvider: HTTP 200 with an unparseable JSON body throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({
    fetchImpl: async () => new Response("not json {", { status: 200 }),
  });
  await assert.rejects(
    () => p.analyze({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
      assert.equal(err.retryable, false);
      return true;
    }
  );
});

test("GeminiProvider: missing candidates array throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: {} }) });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }), (err) => {
    assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    assert.equal(err.retryable, false);
    return true;
  });
});

test("GeminiProvider: an empty candidates array throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: { candidates: [] } }) });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }), (err) => {
    assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    return true;
  });
});

test("GeminiProvider: a candidate with missing content throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: { candidates: [{ finishReason: "SAFETY" }] } }) });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }), (err) => {
    assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    return true;
  });
});

test("GeminiProvider: a candidate with empty parts throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: partsBody([]) }) });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }), (err) => {
    assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    return true;
  });
});

test("GeminiProvider: a candidate whose parts contain no usable text (non-text parts only) throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({
    fetchImpl: async () => fakeResponse({ body: partsBody([{ functionCall: { name: "x" } }]) }),
  });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }), (err) => {
    assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    return true;
  });
});

test("GeminiProvider: a candidate with an empty-string text part throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: generateContentBody("") }) });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }), (err) => {
    assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    return true;
  });
});

// --- one-call invariant ------------------------------------------------------

test("GeminiProvider.analyze: exactly one fetchImpl call per analyze() call - no internal retry on a retryable-shaped failure", async () => {
  let calls = 0;
  const p = provider({
    fetchImpl: async () => {
      calls += 1;
      return fakeResponse({ status: 429 });
    },
  });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }));
  assert.equal(calls, 1, "GeminiProvider must never retry internally - core owns all retry logic");
});

test("GeminiProvider.analyze: exactly one fetchImpl call on success", async () => {
  let calls = 0;
  const p = provider({
    fetchImpl: async () => {
      calls += 1;
      return fakeResponse({ body: generateContentBody("ok") });
    },
  });
  await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(calls, 1);
});

// --- TSB-F06 + ADV-01: bounded response body / body-read time -------------

const { MAX_RESPONSE_BYTES } = require("./gemini-provider");

const SAFE_STALL_TEST = { timeout: 5000 };

function stallingBody(prefix = "") {
  const bytes = new TextEncoder().encode(prefix);
  let sent = false;
  return new ReadableStream({
    pull(c) {
      if (!sent && bytes.length > 0) {
        sent = true;
        c.enqueue(bytes);
        return undefined;
      }
      return new Promise(() => {});
    },
  });
}

// A valid envelope whose serialized UTF-8 size is exactly `n` bytes.
function envelopeOfExactBytes(n) {
  const base = Buffer.byteLength(JSON.stringify(generateContentBody("")));
  const text = "a".repeat(n - base);
  const json = JSON.stringify(generateContentBody(text));
  assert.equal(Buffer.byteLength(json), n);
  return { json, text };
}

async function expectProviderError(p, code, retryable) {
  return assert.rejects(
    () => p.analyze({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, code);
      assert.equal(err.retryable, retryable);
      return true;
    }
  );
}

test("GeminiProvider: MAX_RESPONSE_BYTES is 32 MiB", () => {
  assert.equal(MAX_RESPONSE_BYTES, 32 * 1024 * 1024);
});

test("GeminiProvider: a response body of exactly MAX_RESPONSE_BYTES is accepted unchanged", async () => {
  const { json, text } = envelopeOfExactBytes(MAX_RESPONSE_BYTES);
  const p = provider({ fetchImpl: async () => new Response(json, { status: 200 }) });
  const result = await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(result.length, text.length);
});

test("GeminiProvider: a response body one byte over MAX_RESPONSE_BYTES is INVALID_RESPONSE, non-retryable, and never reaches the caller", async () => {
  const { json } = envelopeOfExactBytes(MAX_RESPONSE_BYTES + 1);
  const p = provider({ fetchImpl: async () => new Response(json, { status: 200 }) });
  await assert.rejects(
    () => p.analyze({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
      assert.equal(err.retryable, false);
      assert.equal(err.message, "Gemini API response body exceeded the maximum of 33554432 bytes");
      assert.equal(err.cause, undefined);
      return true;
    }
  );
});

test("GeminiProvider: a never-ending 200 body is cut off at the byte cap (no Content-Length)", async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(0x61);
  const body = new ReadableStream({
    pull(c) {
      c.enqueue(chunk);
    },
  });
  const p = provider({ fetchImpl: async () => new Response(body, { status: 200 }) });
  await expectProviderError(p, PROVIDER_ERROR_CODES.INVALID_RESPONSE, false);
});

test("GeminiProvider: an oversized declared Content-Length is rejected before the body is read", async () => {
  let pulls = 0;
  const body = new ReadableStream({
    pull(c) {
      pulls += 1;
      c.enqueue(new Uint8Array(16));
    },
  });
  const p = provider({
    fetchImpl: async () => new Response(body, { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }),
  });
  await expectProviderError(p, PROVIDER_ERROR_CODES.INVALID_RESPONSE, false);
  assert.ok(pulls <= 1, `pulls=${pulls}`);
});

test("GeminiProvider: a 200 body that never produces a first chunk ends at timeoutMs as TIMEOUT, retryable (ADV-01)", SAFE_STALL_TEST, async () => {
  const p = provider({ fetchImpl: async () => new Response(stallingBody(), { status: 200 }), timeoutMs: 50 });
  await expectProviderError(p, PROVIDER_ERROR_CODES.TIMEOUT, true);
});

test("GeminiProvider: a 200 body that stalls after a partial chunk ends at timeoutMs as TIMEOUT (ADV-01)", SAFE_STALL_TEST, async () => {
  const p = provider({ fetchImpl: async () => new Response(stallingBody('{"partial":'), { status: 200 }), timeoutMs: 50 });
  await expectProviderError(p, PROVIDER_ERROR_CODES.TIMEOUT, true);
});

test("GeminiProvider: a slow-drip 200 body is bounded by one per-request deadline, not reset per chunk (ADV-01)", SAFE_STALL_TEST, async () => {
  const body = new ReadableStream({
    async pull(c) {
      await new Promise((r) => setTimeout(r, 5));
      c.enqueue(new Uint8Array([0x20]));
    },
  });
  const started = Date.now();
  const p = provider({ fetchImpl: async () => new Response(body, { status: 200 }), timeoutMs: 80 });
  await expectProviderError(p, PROVIDER_ERROR_CODES.TIMEOUT, true);
  assert.ok(Date.now() - started < 2000);
});

test("GeminiProvider: the request deadline spans headers + body - time spent before headers counts against the body read", SAFE_STALL_TEST, async () => {
  const p = provider({
    fetchImpl: async () => {
      await new Promise((r) => setTimeout(r, 40));
      return new Response(stallingBody(), { status: 200 });
    },
    timeoutMs: 60,
  });
  const started = Date.now();
  await expectProviderError(p, PROVIDER_ERROR_CODES.TIMEOUT, true);
  assert.ok(Date.now() - started < 1000);
});

test("GeminiProvider: after a successful bounded read the deadline is cleared (the signal never fires later)", async () => {
  let captured;
  const p = provider({
    fetchImpl: async (url, init) => {
      captured = init.signal;
      return fakeResponse({ body: generateContentBody("ok") });
    },
    timeoutMs: 20,
  });
  await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(captured.aborted, false);
});

test("GeminiProvider: a huge hostile error body is never read - the HTTP status mapping is unchanged", SAFE_STALL_TEST, async () => {
  let pulls = 0;
  const body = new ReadableStream({
    pull(c) {
      pulls += 1;
      c.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const p = provider({ fetchImpl: async () => new Response(body, { status: 503 }) });
  await expectProviderError(p, PROVIDER_ERROR_CODES.UNKNOWN, true);
  assert.ok(pulls <= 1, `pulls=${pulls}`);
});

test("GeminiProvider: malformed UTF-8 in a 200 body is INVALID_RESPONSE (fail closed)", async () => {
  const p = provider({ fetchImpl: async () => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 }) });
  await expectProviderError(p, PROVIDER_ERROR_CODES.INVALID_RESPONSE, false);
});

// --- TPR-G1-PD1: output control ------------------------------------------

const { MAX_OUTPUT_TOKENS, MODEL_OUTPUT_TOKEN_LIMIT, THINKING_LEVEL } = require("./gemini-provider");
const { runProviderAnalysis } = require("../analyze-failure");

function countingProvider(body, overrides = {}) {
  const state = { calls: 0, init: null };
  const p = provider({
    fetchImpl: async (url, init) => {
      state.calls += 1;
      state.init = init;
      return fakeResponse({ body });
    },
    ...overrides,
  });
  return { p, state };
}

async function expectStop(body, overrides = {}) {
  const { p, state } = countingProvider(body, overrides);
  let caught;
  await assert.rejects(
    () => p.analyze({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
      assert.equal(err.retryable, false);
      caught = err;
      return true;
    }
  );
  assert.equal(state.calls, 1);
  return caught;
}

test("PD-1: approved limits are 8192 output tokens, a 65536 model limit and thinking level MINIMAL", () => {
  assert.equal(MAX_OUTPUT_TOKENS, 8192);
  assert.equal(MODEL_OUTPUT_TOKEN_LIMIT, 65536);
  assert.equal(THINKING_LEVEL, "MINIMAL");
});

test("PD-1: every request carries exactly the approved generationConfig, with prompts and endpoint unchanged", async () => {
  const { p, state } = countingProvider(generateContentBody("ok"));
  await p.analyze({ systemPrompt: "SYSTEM", userPrompt: "USER" });
  const body = JSON.parse(state.init.body);
  assert.deepEqual(Object.keys(body), ["systemInstruction", "contents", "generationConfig"]);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: "SYSTEM" }] });
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "USER" }] }]);
  assert.deepEqual(body.generationConfig, { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "MINIMAL" } });
  assert.ok(!state.init.body.includes("thinkingBudget"));
  assert.ok(!state.init.body.includes("includeThoughts"));
});

test("PD-1: a valid constructor override (1 and 65536) is the limit that is sent", async () => {
  for (const limit of [1, 65536]) {
    const { p, state } = countingProvider(generateContentBody("ok", { usageMetadata: { promptTokenCount: 5, totalTokenCount: 6 } }), {
      maxOutputTokens: limit,
    });
    await p.analyze({ systemPrompt: "s", userPrompt: "u" });
    assert.equal(JSON.parse(state.init.body).generationConfig.maxOutputTokens, limit);
  }
});

test("PD-1: an invalid maxOutputTokens is CONFIGURATION, non-retryable, before any fetch", () => {
  for (const bad of [0, -1, 1.5, "8192", NaN, Infinity, 65537, 2 ** 53, null, true, {}]) {
    let calls = 0;
    assert.throws(
      () =>
        new GeminiProvider({
          apiKey: "k",
          model: "m",
          maxOutputTokens: bad,
          fetchImpl: async () => {
            calls += 1;
          },
        }),
      (err) => {
        assert.ok(err instanceof ProviderError, String(bad));
        assert.equal(err.code, PROVIDER_ERROR_CODES.CONFIGURATION);
        assert.equal(err.retryable, false);
        return true;
      }
    );
    assert.equal(calls, 0);
  }
});

test("PD-1: finishReason MAX_TOKENS, CONTINUATION, SAFETY or missing is a non-retryable STOP, even with valid text", async () => {
  const maxTokens = await expectStop(generateContentBody('{"partial":', { finishReason: "MAX_TOKENS" }));
  assert.match(maxTokens.message, /cut off at the output token limit \(maxOutputTokens 8192\)/);
  for (const reason of ["CONTINUATION", "SAFETY"]) {
    const err = await expectStop(generateContentBody("{}", { finishReason: reason }));
    assert.match(err.message, new RegExp(`finishReason: ${reason}\\)`));
  }
  const missing = await expectStop(generateContentBody("{}", { finishReason: undefined }));
  assert.match(missing.message, /finishReason: missing or unrecognized/);
});

test("PD-1: an unknown or non-canonical finishReason is a STOP whose message never echoes provider text", async () => {
  for (const reason of ["stop", "SECRET-UPSTREAM-TEXT", 1, null]) {
    const err = await expectStop(generateContentBody("{}", { finishReason: reason }));
    assert.match(err.message, /finishReason: missing or unrecognized/);
    assert.ok(!err.message.includes("SECRET"));
  }
});

test("PD-1: missing or invalid usageMetadata is a non-retryable STOP", async () => {
  const cases = [
    undefined,
    null,
    [],
    "170",
    {},
    { totalTokenCount: 170 },
    { promptTokenCount: 50 },
    { promptTokenCount: -1, totalTokenCount: 170 },
    { promptTokenCount: 1.5, totalTokenCount: 170 },
    { promptTokenCount: "50", totalTokenCount: 170 },
    { promptTokenCount: 50, totalTokenCount: Number.MAX_SAFE_INTEGER + 1 },
    { promptTokenCount: 50, totalTokenCount: 170, toolUsePromptTokenCount: -1 },
    { promptTokenCount: 50, totalTokenCount: 170, candidatesTokenCount: "100" },
    { promptTokenCount: 50, totalTokenCount: 170, thoughtsTokenCount: null },
  ];
  for (const usageMetadata of cases) {
    const body = generateContentBody("{}");
    if (usageMetadata === undefined) delete body.usageMetadata;
    else body.usageMetadata = usageMetadata;
    const err = await expectStop(body);
    assert.match(err.message, /usage metadata/, JSON.stringify(usageMetadata));
  }
});

test("PD-1: output exactly at the cap passes; one token over is a STOP", async () => {
  const at = [
    { promptTokenCount: 50, totalTokenCount: 150 },
    { promptTokenCount: 50, toolUsePromptTokenCount: 10, totalTokenCount: 160 },
    { promptTokenCount: 50, candidatesTokenCount: 80, thoughtsTokenCount: 20, totalTokenCount: 150 },
  ];
  for (const usageMetadata of at) {
    const { p } = countingProvider(generateContentBody("ok", { usageMetadata }), { maxOutputTokens: 100 });
    assert.equal(await p.analyze({ systemPrompt: "s", userPrompt: "u" }), "ok");
  }
  const over = [
    { promptTokenCount: 50, totalTokenCount: 151 },
    { promptTokenCount: 50, toolUsePromptTokenCount: 10, totalTokenCount: 161 },
    // thought tokens are counted through totalTokenCount even when thoughtsTokenCount is absent
    { promptTokenCount: 50, candidatesTokenCount: 40, totalTokenCount: 151 },
    // the separately reported counters are checked too
    { promptTokenCount: 50, candidatesTokenCount: 90, thoughtsTokenCount: 11, totalTokenCount: 150 },
  ];
  for (const usageMetadata of over) {
    const err = await expectStop(generateContentBody("ok", { usageMetadata }), { maxOutputTokens: 100 });
    assert.match(err.message, /more output tokens than the limit \(maxOutputTokens 100\)/);
  }
});

test("PD-1: a negative derived output token count is a STOP", async () => {
  for (const usageMetadata of [
    { promptTokenCount: 50, totalTokenCount: 49 },
    { promptTokenCount: 50, toolUsePromptTokenCount: 10, totalTokenCount: 59 },
  ]) {
    const err = await expectStop(generateContentBody("ok", { usageMetadata }));
    assert.match(err.message, /negative output token count/);
  }
});

test("PD-1: thought parts are excluded from the returned text", async () => {
  const { p } = countingProvider(partsBody([{ text: "REASONING-TEXT", thought: true }, { text: "answer" }, { text: "MORE-REASONING", thought: true }]));
  const result = await p.analyze({ systemPrompt: "s", userPrompt: "u" });
  assert.equal(result, "answer");
});

test("PD-1: a response with only thought parts has no usable content - non-retryable STOP", async () => {
  const err = await expectStop(partsBody([{ text: "REASONING-TEXT", thought: true }]));
  assert.match(err.message, /did not include any model content/);
  assert.ok(!err.message.includes("REASONING"));
});

test("PD-1: HTTP 400 (e.g. an unsupported thinking configuration) stays UNKNOWN, non-retryable, one call", async () => {
  let calls = 0;
  const p = provider({
    fetchImpl: async () => {
      calls += 1;
      return fakeResponse({ status: 400, body: { error: { message: "thinking level not supported" } } });
    },
  });
  await expectProviderError(p, PROVIDER_ERROR_CODES.UNKNOWN, false);
  assert.equal(calls, 1);
});

// Triage shares GeminiProvider: its retry loop (analyze-failure.js
// runProviderAnalysis) must stop after one call on a PD-1 rejection.
const TRIAGE_PROFILE = Object.freeze({ id: "synthetic-project", displayName: "PD-1", knownProjectConstraints: Object.freeze(["PD1_CONSTRAINT"]) });
const TRIAGE_CONTEXT = Object.freeze({
  schemaVersion: 1,
  generatedAt: "2026-10-09T00:00:00.000Z",
  metadata: {
    projectId: "synthetic-project",
    framework: "cypress",
    invocationMode: "local-v1",
    repository: "o/r",
    commit: "abc123",
    branch: "main",
    runId: null,
    runAttempt: null,
    localInvocationId: "0123456789abcdef0123456789abcdef",
    event: null,
    browser: "chrome",
    ci: false,
  },
  testResults: { found: true, totals: { tests: 1, passed: 0, failed: 1, pending: 0, duration: 100 }, specs: [] },
  failedTests: [
    {
      title: "fails",
      fullTitle: "Suite fails",
      specFile: "cypress/e2e/tests/example.cy.js",
      suite: "Suite",
      status: "failed",
      duration: 10,
      error: { message: "AssertionError: ...", stack: "AssertionError: ...\n  at ..." },
      screenshot: null,
    },
  ],
  relevantFiles: {},
  knownProjectConstraints: [],
  warnings: [],
});

test("PD-1 triage regression: a MAX_TOKENS or missing-usage Gemini response ends triage after one call, no backoff", async () => {
  for (const body of [
    generateContentBody('{"results":[', { finishReason: "MAX_TOKENS" }),
    generateContentBody('{"results":[]}', { usageMetadata: undefined }),
  ]) {
    const { p, state } = countingProvider(body);
    const delays = [];
    await assert.rejects(
      runProviderAnalysis(p, TRIAGE_CONTEXT, { projectProfile: TRIAGE_PROFILE, sleep: async (ms) => delays.push(ms) }),
      /AI provider request failed \(INVALID_RESPONSE\)/
    );
    assert.equal(state.calls, 1, "no second paid call");
    assert.deepEqual(delays, []);
  }
});

test("PD-1 triage regression: a retryable Gemini failure still uses the unchanged triage retry loop", async () => {
  let calls = 0;
  const p = provider({
    fetchImpl: async () => {
      calls += 1;
      return fakeResponse({ status: 503 });
    },
  });
  const delays = [];
  await assert.rejects(
    runProviderAnalysis(p, TRIAGE_CONTEXT, { projectProfile: TRIAGE_PROFILE, sleep: async (ms) => delays.push(ms) }),
    /AI provider request failed \(UNKNOWN\)/
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1500]);
});

test("GeminiProvider: an invalid-JSON body error message never echoes body content", async () => {
  const p = provider({ fetchImpl: async () => new Response("<html>SECRET-UPSTREAM-PAGE</html>", { status: 200 }) });
  await assert.rejects(
    () => p.analyze({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
      assert.ok(!err.message.includes("SECRET"), err.message);
      return true;
    }
  );
});
