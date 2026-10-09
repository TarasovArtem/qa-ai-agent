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

function generateContentBody(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
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
        body: { candidates: [{ content: { parts: [{ text: "hello " }, { text: "world" }] } }] },
      }),
  });
  const result = await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(result, "hello world");
});

test("GeminiProvider.analyze: a non-text part (e.g. a future function-call-shaped part) is skipped, not coerced to a string", async () => {
  const p = provider({
    fetchImpl: async () =>
      fakeResponse({
        body: { candidates: [{ content: { parts: [{ functionCall: { name: "x" } }, { text: "the actual text" }] } }] },
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
  const p = provider({ fetchImpl: async () => fakeResponse({ body: { candidates: [{ content: { parts: [] } }] } }) });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }), (err) => {
    assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    return true;
  });
});

test("GeminiProvider: a candidate whose parts contain no usable text (non-text parts only) throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({
    fetchImpl: async () => fakeResponse({ body: { candidates: [{ content: { parts: [{ functionCall: { name: "x" } }] } } ] } }),
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
