"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { GroqProvider } = require("./groq-provider");
const { ProviderError, PROVIDER_ERROR_CODES } = require("./provider-error");

// Fakes global fetch's Response shape just enough for GroqProvider - no
// real network access anywhere in this file.
// TSB-F06: a real Web Response (status-derived `ok`, a real body stream),
// since the adapter now reads the body through the bounded stream reader
// rather than calling `.json()`.
function fakeResponse({ status = 200, body }) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function chatCompletionBody(content) {
  return { choices: [{ message: { content } }] };
}

function provider(overrides = {}) {
  return new GroqProvider({
    apiKey: "test-key",
    model: "openai/gpt-oss-120b",
    fetchImpl: async () => fakeResponse({ body: chatCompletionBody('{"results":[]}') }),
    ...overrides,
  });
}

test("GroqProvider: name is 'groq'", () => {
  assert.equal(provider().name, "groq");
});

// --- success ---------------------------------------------------------------

test("GroqProvider.analyze: returns the model content as a string", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: chatCompletionBody('{"results":[]}') }) });
  const result = await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(result, '{"results":[]}');
});

test("GroqProvider.analyze: sends the configured model, both prompts, and the expected headers", async () => {
  let capturedUrl;
  let capturedInit;
  const fetchImpl = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return fakeResponse({ body: chatCompletionBody("ok") });
  };
  const p = new GroqProvider({ apiKey: "my-key", model: "openai/gpt-oss-120b", fetchImpl });

  await p.analyze({ systemPrompt: "SYSTEM", userPrompt: "USER" });

  assert.equal(capturedUrl, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers.Authorization, "Bearer my-key");
  assert.equal(capturedInit.headers["Content-Type"], "application/json");

  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "openai/gpt-oss-120b");
  assert.deepEqual(body.messages, [
    { role: "system", content: "SYSTEM" },
    { role: "user", content: "USER" },
  ]);
});

// --- configuration -----------------------------------------------------

test("GroqProvider: missing API key throws CONFIGURATION, non-retryable", () => {
  assert.throws(
    () => new GroqProvider({ apiKey: null, model: "openai/gpt-oss-120b", fetchImpl: async () => {} }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.CONFIGURATION);
      assert.equal(err.retryable, false);
      return true;
    }
  );
});

test("GroqProvider: missing model throws CONFIGURATION, non-retryable", () => {
  assert.throws(
    () => new GroqProvider({ apiKey: "key", model: null, fetchImpl: async () => {} }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.CONFIGURATION);
      assert.equal(err.retryable, false);
      return true;
    }
  );
});

// --- HTTP error mapping ------------------------------------------------

async function analyzeExpectingError(status) {
  const p = provider({ fetchImpl: async () => fakeResponse({ status }) });
  try {
    await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
    assert.fail(`expected HTTP ${status} to throw`);
  } catch (err) {
    return err;
  }
}

test("GroqProvider: HTTP 401 maps to AUTH, non-retryable", async () => {
  const err = await analyzeExpectingError(401);
  assert.ok(err instanceof ProviderError);
  assert.equal(err.code, PROVIDER_ERROR_CODES.AUTH);
  assert.equal(err.retryable, false);
});

test("GroqProvider: HTTP 403 maps to AUTH, non-retryable", async () => {
  const err = await analyzeExpectingError(403);
  assert.equal(err.code, PROVIDER_ERROR_CODES.AUTH);
  assert.equal(err.retryable, false);
});

test("GroqProvider: HTTP 429 maps to RATE_LIMIT, retryable", async () => {
  const err = await analyzeExpectingError(429);
  assert.equal(err.code, PROVIDER_ERROR_CODES.RATE_LIMIT);
  assert.equal(err.retryable, true);
});

test("GroqProvider: HTTP 408 maps to TIMEOUT, retryable", async () => {
  const err = await analyzeExpectingError(408);
  assert.equal(err.code, PROVIDER_ERROR_CODES.TIMEOUT);
  assert.equal(err.retryable, true);
});

test("GroqProvider: HTTP 500 is retryable", async () => {
  const err = await analyzeExpectingError(500);
  assert.equal(err.retryable, true);
});

test("GroqProvider: HTTP 503 is retryable", async () => {
  const err = await analyzeExpectingError(503);
  assert.equal(err.retryable, true);
});

test("GroqProvider: an unmapped 4xx (e.g. 400) is not retryable", async () => {
  const err = await analyzeExpectingError(400);
  assert.equal(err.retryable, false);
});

// --- network / timeout --------------------------------------------------

test("GroqProvider: a network-level fetch failure maps to NETWORK, retryable, with cause preserved", async () => {
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

test("GroqProvider: an AbortController timeout maps to TIMEOUT, retryable - deterministic, no real waiting", async () => {
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

// --- malformed response ---------------------------------------------------

test("GroqProvider: HTTP 200 with no message content throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: { choices: [] } }) });
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

test("GroqProvider: HTTP 200 with an empty content string throws INVALID_RESPONSE, non-retryable", async () => {
  const p = provider({ fetchImpl: async () => fakeResponse({ body: chatCompletionBody("") }) });
  await assert.rejects(() => p.analyze({ systemPrompt: "sys", userPrompt: "user" }), (err) => {
    assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    return true;
  });
});

test("GroqProvider: HTTP 200 with an unparseable JSON body throws INVALID_RESPONSE, non-retryable", async () => {
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

// --- TSB-F06 + ADV-01: bounded response body / body-read time -------------

const { MAX_RESPONSE_BYTES } = require("./groq-provider");

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
  const base = Buffer.byteLength(JSON.stringify(chatCompletionBody("")));
  const text = "a".repeat(n - base);
  const json = JSON.stringify(chatCompletionBody(text));
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

test("GroqProvider: MAX_RESPONSE_BYTES is 32 MiB", () => {
  assert.equal(MAX_RESPONSE_BYTES, 32 * 1024 * 1024);
});

test("GroqProvider: a response body of exactly MAX_RESPONSE_BYTES is accepted unchanged", async () => {
  const { json, text } = envelopeOfExactBytes(MAX_RESPONSE_BYTES);
  const p = provider({ fetchImpl: async () => new Response(json, { status: 200 }) });
  const result = await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  assert.equal(result.length, text.length);
});

test("GroqProvider: a response body one byte over MAX_RESPONSE_BYTES is INVALID_RESPONSE, non-retryable, and never reaches the caller", async () => {
  const { json } = envelopeOfExactBytes(MAX_RESPONSE_BYTES + 1);
  const p = provider({ fetchImpl: async () => new Response(json, { status: 200 }) });
  await assert.rejects(
    () => p.analyze({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, PROVIDER_ERROR_CODES.INVALID_RESPONSE);
      assert.equal(err.retryable, false);
      assert.equal(err.message, "Groq API response body exceeded the maximum of 33554432 bytes");
      assert.equal(err.cause, undefined);
      return true;
    }
  );
});

test("GroqProvider: a never-ending 200 body is cut off at the byte cap (no Content-Length)", async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(0x61);
  const body = new ReadableStream({
    pull(c) {
      c.enqueue(chunk);
    },
  });
  const p = provider({ fetchImpl: async () => new Response(body, { status: 200 }) });
  await expectProviderError(p, PROVIDER_ERROR_CODES.INVALID_RESPONSE, false);
});

test("GroqProvider: an oversized declared Content-Length is rejected before the body is read", async () => {
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

test("GroqProvider: a 200 body that never produces a first chunk ends at timeoutMs as TIMEOUT, retryable (ADV-01)", SAFE_STALL_TEST, async () => {
  const p = provider({ fetchImpl: async () => new Response(stallingBody(), { status: 200 }), timeoutMs: 50 });
  await expectProviderError(p, PROVIDER_ERROR_CODES.TIMEOUT, true);
});

test("GroqProvider: a 200 body that stalls after a partial chunk ends at timeoutMs as TIMEOUT (ADV-01)", SAFE_STALL_TEST, async () => {
  const p = provider({ fetchImpl: async () => new Response(stallingBody('{"partial":'), { status: 200 }), timeoutMs: 50 });
  await expectProviderError(p, PROVIDER_ERROR_CODES.TIMEOUT, true);
});

test("GroqProvider: a slow-drip 200 body is bounded by one per-request deadline, not reset per chunk (ADV-01)", SAFE_STALL_TEST, async () => {
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

test("GroqProvider: the request deadline spans headers + body - time spent before headers counts against the body read", SAFE_STALL_TEST, async () => {
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

test("GroqProvider: after a successful bounded read the deadline is cleared (the signal never fires later)", async () => {
  let captured;
  const p = provider({
    fetchImpl: async (url, init) => {
      captured = init.signal;
      return fakeResponse({ body: chatCompletionBody("ok") });
    },
    timeoutMs: 20,
  });
  await p.analyze({ systemPrompt: "sys", userPrompt: "user" });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(captured.aborted, false);
});

test("GroqProvider: a huge hostile error body is never read - the HTTP status mapping is unchanged", SAFE_STALL_TEST, async () => {
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

test("GroqProvider: malformed UTF-8 in a 200 body is INVALID_RESPONSE (fail closed)", async () => {
  const p = provider({ fetchImpl: async () => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 }) });
  await expectProviderError(p, PROVIDER_ERROR_CODES.INVALID_RESPONSE, false);
});

test("GroqProvider: an invalid-JSON body error message never echoes body content", async () => {
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

test("GroqProvider / GeminiProvider: MAX_RESPONSE_BYTES covers every practical downstream pre-parse character bound at worst-case 6-byte JSON escaping", () => {
  const { MAX_RESPONSE_BYTES: GEMINI_MAX } = require("./gemini-provider");
  const { MAX_TRIAGE_RESPONSE_CHARS } = require("../analyze-failure");
  const { MAX_REQUIREMENT_MODEL_RESPONSE_CHARS } = require("../generative-test-design/requirement-model-generator");
  const { MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS } = require("../generative-test-design/automation-candidate-generator");
  const { MAX_TEST_CASE_MODEL_RESPONSE_CHARS } = require("../generative-test-design/test-case-model-generator");
  const { LIMITS: PLAN_LIMITS } = require("../test-automation/automation-plan-generator");
  const { LIMITS: CHANGESET_LIMITS } = require("../test-automation/generate-change-set");
  assert.equal(GEMINI_MAX, MAX_RESPONSE_BYTES);
  const practical = [
    MAX_TRIAGE_RESPONSE_CHARS,
    MAX_REQUIREMENT_MODEL_RESPONSE_CHARS,
    MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS,
    PLAN_LIMITS.MAX_AUTOMATION_PLAN_RESPONSE_CHARS,
    CHANGESET_LIMITS.MAX_CHANGESET_RESPONSE_CHARS,
  ];
  for (const chars of practical) assert.ok(6 * chars < MAX_RESPONSE_BYTES, `6 x ${chars} must fit under ${MAX_RESPONSE_BYTES}`);
  // Documented exception: the test-case-model bound is a schema-derived
  // theoretical worst case (~308 M chars) far beyond any provider's output;
  // for that generator the transport cap is the effective outer bound.
  assert.ok(MAX_TEST_CASE_MODEL_RESPONSE_CHARS > MAX_RESPONSE_BYTES);
});
