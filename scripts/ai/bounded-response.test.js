"use strict";

// TSB-F06 + ADV-01: the shared bounded remote-response reader. Every
// response here is a local, in-memory Web Response / ReadableStream - no
// network access anywhere in this file.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readBoundedResponseText, readBoundedResponseJson, BoundedResponseError, BOUNDED_RESPONSE_FAILURES } = require("./bounded-response");

const encoder = new TextEncoder();

function streamOf(chunks, { onCancel } = {}) {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(typeof chunks[i] === "string" ? encoder.encode(chunks[i]) : chunks[i]);
        i += 1;
      } else {
        controller.close();
      }
    },
    cancel() {
      if (onCancel) onCancel();
    },
  });
}

// A body that never produces another chunk once `chunks` are exhausted -
// the stream is neither closed nor errored, so only the deadline can end it.
function stallingStream(chunks = [], { onCancel } = {}) {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
        return undefined;
      }
      return new Promise(() => {});
    },
    cancel() {
      if (onCancel) onCancel();
    },
  });
}

// Never-ending: always has another chunk ready.
function infiniteStream(chunk, { onCancel, counter } = {}) {
  const bytes = encoder.encode(chunk);
  return new ReadableStream({
    pull(controller) {
      if (counter) counter.pulls += 1;
      controller.enqueue(bytes);
    },
    cancel() {
      if (onCancel) onCancel();
    },
  });
}

function response(body, headers = {}) {
  return new Response(body, { status: 200, headers });
}

// AbortSignal.timeout() - the same primitive production passes - plus a
// ref'd companion timer. Its own timer is unref'd by design, and an
// in-memory stalled stream holds no I/O handle, so without the companion
// the test runner's event loop can drain before the deadline fires (Node
// 20/22: "Promise resolution is still pending but the event loop has
// already resolved"). In production the open socket keeps the loop alive.
function deadline(ms) {
  const signal = AbortSignal.timeout(ms);
  const hold = setTimeout(() => {}, ms + 50);
  signal.addEventListener("abort", () => clearTimeout(hold), { once: true });
  return signal;
}

function liveSignal() {
  return new AbortController().signal;
}

async function rejectsWith(promise, reason) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof BoundedResponseError, `expected BoundedResponseError, got ${err && err.name}`);
    assert.equal(err.reason, reason);
    return true;
  });
}

// --- argument contract ---------------------------------------------------

test("bounded-response: maxBytes must be a positive safe integer", async () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, "10", null, undefined, 2 ** 53]) {
    await assert.rejects(readBoundedResponseText(response("x"), { maxBytes: bad, signal: liveSignal(), label: "T" }), TypeError);
  }
});

test("bounded-response: a signal is mandatory (no unbounded body read is expressible)", async () => {
  await assert.rejects(readBoundedResponseText(response("x"), { maxBytes: 10, label: "T" }), TypeError);
  await assert.rejects(readBoundedResponseText(response("x"), { maxBytes: 10, signal: {}, label: "T" }), TypeError);
});

// --- byte boundary ---------------------------------------------------------

test("bounded-response: a body of exactly maxBytes is accepted", async () => {
  const text = await readBoundedResponseText(response("a".repeat(16)), { maxBytes: 16, signal: liveSignal(), label: "T" });
  assert.equal(text, "a".repeat(16));
});

test("bounded-response: maxBytes + 1 is rejected as TOO_LARGE", async () => {
  await rejectsWith(readBoundedResponseText(response("a".repeat(17)), { maxBytes: 16, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

test("bounded-response: an empty body yields an empty string (and invalid JSON for the JSON reader)", async () => {
  assert.equal(await readBoundedResponseText(response(""), { maxBytes: 4, signal: liveSignal(), label: "T" }), "");
  assert.equal(await readBoundedResponseText(new Response(null, { status: 200 }), { maxBytes: 4, signal: liveSignal(), label: "T" }), "");
  await rejectsWith(readBoundedResponseJson(response(""), { maxBytes: 4, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.INVALID_JSON);
});

test("bounded-response: the cap counts UTF-8 bytes, not UTF-16 code units", async () => {
  // "é" is 1 code unit / 2 bytes; "😀" is 2 code units / 4 bytes.
  const body = "é😀"; // 3 code units, 6 bytes
  assert.equal(await readBoundedResponseText(response(body), { maxBytes: 6, signal: liveSignal(), label: "T" }), body);
  await rejectsWith(readBoundedResponseText(response(body), { maxBytes: 5, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

test("bounded-response: a multibyte character split across chunk boundaries decodes correctly", async () => {
  const bytes = encoder.encode('{"v":"😀é"}');
  const chunks = Array.from(bytes, (b) => new Uint8Array([b])); // 1-byte chunks
  const parsed = await readBoundedResponseJson(response(streamOf(chunks)), { maxBytes: bytes.length, signal: liveSignal(), label: "T" });
  assert.deepEqual(parsed, { v: "😀é" });
});

test("bounded-response: a multibyte character crossing the byte cap is rejected, not truncated", async () => {
  const bytes = encoder.encode("ab😀"); // 6 bytes; the emoji occupies bytes 3..6
  await rejectsWith(readBoundedResponseText(response(streamOf([bytes])), { maxBytes: 4, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

test("bounded-response: malformed UTF-8 within the cap fails closed", async () => {
  await rejectsWith(
    readBoundedResponseText(response(streamOf([new Uint8Array([0x7b, 0xff, 0x7d])])), { maxBytes: 10, signal: liveSignal(), label: "T" }),
    BOUNDED_RESPONSE_FAILURES.INVALID_UTF8
  );
});

test("bounded-response: a leading UTF-8 BOM is stripped exactly as Response.json() does", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('{"a":1}')]);
  assert.deepEqual(await readBoundedResponseJson(response(streamOf([bytes])), { maxBytes: 10, signal: liveSignal(), label: "T" }), { a: 1 });
});

// --- JSON ------------------------------------------------------------------

test("bounded-response: valid JSON within the cap parses", async () => {
  assert.deepEqual(await readBoundedResponseJson(response('{"a":[1,2]}'), { maxBytes: 64, signal: liveSignal(), label: "T" }), { a: [1, 2] });
});

test("bounded-response: malformed JSON within the cap is INVALID_JSON with no body content in the message", async () => {
  const secretish = "<html>SECRET-BODY-CONTENT</html>";
  await assert.rejects(readBoundedResponseJson(response(secretish), { maxBytes: 64, signal: liveSignal(), label: "T" }), (err) => {
    assert.equal(err.reason, BOUNDED_RESPONSE_FAILURES.INVALID_JSON);
    assert.ok(!err.message.includes("SECRET"), err.message);
    assert.ok(!err.message.includes("html"), err.message);
    assert.equal(err.cause, undefined, "the SyntaxError (which quotes body text) is never attached");
    return true;
  });
});

test("bounded-response: valid JSON whose closing delimiter arrives after the cap is rejected before any parse", async () => {
  const head = '{"items":[' + '"x",'.repeat(10);
  await rejectsWith(readBoundedResponseJson(response(streamOf([head, '"y"]}'])), { maxBytes: head.length, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

// --- Content-Length -------------------------------------------------------

test("bounded-response: an oversized declared Content-Length fails early without reading the body", async () => {
  let cancelled = false;
  const counter = { pulls: 0 };
  const body = infiniteStream("x", { counter, onCancel: () => (cancelled = true) });
  const pullsBefore = counter.pulls; // ReadableStream may pre-pull to its high-water mark
  await rejectsWith(readBoundedResponseText(response(body, { "content-length": "1000000" }), { maxBytes: 10, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
  assert.ok(counter.pulls <= pullsBefore + 1, "no body consumption after the early Content-Length rejection");
  assert.equal(cancelled, true, "the body is cancelled");
});

test("bounded-response: a lying (too small) Content-Length is not trusted - the stream cap still applies", async () => {
  await rejectsWith(readBoundedResponseText(response(streamOf(["a".repeat(8), "b".repeat(8)]), { "content-length": "2" }), { maxBytes: 10, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

test("bounded-response: an absent Content-Length still enforces the stream cap", async () => {
  await rejectsWith(readBoundedResponseText(response(streamOf(["a".repeat(8), "b".repeat(8)])), { maxBytes: 10, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

test("bounded-response: a malformed Content-Length is ignored as authority (accepted when the real body fits, capped when not)", async () => {
  for (const cl of ["abc", "-5", "1e9", "12, 12", "0x10", "+3", "1.5"]) {
    const ok = await readBoundedResponseText(response(streamOf(["abcd"]), { "content-length": cl }), { maxBytes: 10, signal: liveSignal(), label: "T" });
    assert.equal(ok, "abcd", `content-length ${JSON.stringify(cl)}`);
    await rejectsWith(readBoundedResponseText(response(streamOf(["a".repeat(11)]), { "content-length": cl }), { maxBytes: 10, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
  }
});

// --- streaming hostility -----------------------------------------------

test("bounded-response: a never-ending stream is cut off at the cap and cancelled", async () => {
  let cancelled = false;
  const counter = { pulls: 0 };
  await rejectsWith(readBoundedResponseText(response(infiniteStream("abcd", { counter, onCancel: () => (cancelled = true) })), { maxBytes: 1024, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
  assert.equal(cancelled, true);
  assert.ok(counter.pulls <= 1024 / 4 + 2, `bounded consumption (pulls=${counter.pulls})`);
});

test("bounded-response: one giant chunk over the cap is rejected", async () => {
  await rejectsWith(readBoundedResponseText(response(streamOf([new Uint8Array(5 * 1024 * 1024)])), { maxBytes: 1024, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

test("bounded-response: 1-byte chunks up to exactly the cap are accepted; one more byte is rejected", async () => {
  const exact = Array.from({ length: 32 }, () => "z");
  assert.equal(await readBoundedResponseText(response(streamOf(exact)), { maxBytes: 32, signal: liveSignal(), label: "T" }), "z".repeat(32));
  await rejectsWith(readBoundedResponseText(response(streamOf([...exact, "z"])), { maxBytes: 32, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

test("bounded-response: a non-byte chunk from a non-conforming stream fails closed", async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue("not-bytes");
      c.close();
    },
  });
  await rejectsWith(readBoundedResponseText({ headers: new Headers(), body }, { maxBytes: 64, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.READ_FAILED);
});

test("bounded-response: an object with no readable body stream fails closed (never falls back to .json())", async () => {
  let jsonCalled = false;
  const fake = { headers: new Headers(), json: async () => ((jsonCalled = true), {}) };
  await rejectsWith(readBoundedResponseText(fake, { maxBytes: 64, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.READ_FAILED);
  assert.equal(jsonCalled, false);
});

test("bounded-response: a stream error mid-body is READ_FAILED", async () => {
  let n = 0;
  const body = new ReadableStream({
    pull(c) {
      n += 1;
      if (n === 1) c.enqueue(encoder.encode("{"));
      else c.error(new Error("socket hang up"));
    },
  });
  await rejectsWith(readBoundedResponseText(response(body), { maxBytes: 64, signal: liveSignal(), label: "T" }), BOUNDED_RESPONSE_FAILURES.READ_FAILED);
});

// --- time bound (ADV-01) ---------------------------------------------------

test("bounded-response: a body that never produces a first chunk ends at the deadline (ABORTED) and is cancelled", async () => {
  let cancelled = false;
  const started = Date.now();
  await rejectsWith(readBoundedResponseText(response(stallingStream([], { onCancel: () => (cancelled = true) })), { maxBytes: 64, signal: deadline(50), label: "T" }), BOUNDED_RESPONSE_FAILURES.ABORTED);
  assert.ok(Date.now() - started < 2000);
  assert.equal(cancelled, true);
});

test("bounded-response: a body that stalls after some chunks ends at the deadline", async () => {
  let cancelled = false;
  await rejectsWith(readBoundedResponseText(response(stallingStream(['{"a":', "1"], { onCancel: () => (cancelled = true) })), { maxBytes: 64, signal: deadline(50), label: "T" }), BOUNDED_RESPONSE_FAILURES.ABORTED);
  assert.equal(cancelled, true);
});

test("bounded-response: a slow-drip body under the byte cap is still ended by the deadline (per-request, not per-chunk)", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    async pull(c) {
      await new Promise((r) => setTimeout(r, 10));
      c.enqueue(encoder.encode(" "));
    },
    cancel() {
      cancelled = true;
    },
  });
  const started = Date.now();
  await rejectsWith(readBoundedResponseText(response(body), { maxBytes: 1024 * 1024, signal: deadline(120), label: "T" }), BOUNDED_RESPONSE_FAILURES.ABORTED);
  assert.ok(Date.now() - started < 2000);
  assert.equal(cancelled, true);
});

test("bounded-response: the byte cap wins when exceeded before the deadline", async () => {
  await rejectsWith(readBoundedResponseText(response(infiniteStream("x".repeat(256))), { maxBytes: 1024, signal: deadline(1000), label: "T" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
});

test("bounded-response: the deadline wins when it fires before the byte cap", async () => {
  await rejectsWith(readBoundedResponseText(response(stallingStream(["x"])), { maxBytes: 1024, signal: deadline(30), label: "T" }), BOUNDED_RESPONSE_FAILURES.ABORTED);
});

test("bounded-response: an already-aborted signal rejects without reading and cancels the body", async () => {
  let cancelled = false;
  const counter = { pulls: 0 };
  const controller = new AbortController();
  controller.abort();
  const body = infiniteStream("x", { counter, onCancel: () => (cancelled = true) });
  const pullsBefore = counter.pulls;
  await rejectsWith(readBoundedResponseText(response(body), { maxBytes: 64, signal: controller.signal, label: "T" }), BOUNDED_RESPONSE_FAILURES.ABORTED);
  assert.ok(counter.pulls <= pullsBefore + 1);
  assert.equal(cancelled, true);
});

test("bounded-response: an abort during the body read rejects promptly", async () => {
  const controller = new AbortController();
  const pending = readBoundedResponseText(response(stallingStream(["{"])), { maxBytes: 64, signal: controller.signal, label: "T" });
  setTimeout(() => controller.abort(), 10);
  await rejectsWith(pending, BOUNDED_RESPONSE_FAILURES.ABORTED);
});

test("bounded-response: a stream whose cancel() never settles still cannot hang the reader", async () => {
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      return new Promise(() => {});
    },
  });
  await rejectsWith(readBoundedResponseText(response(body), { maxBytes: 64, signal: deadline(30), label: "T" }), BOUNDED_RESPONSE_FAILURES.ABORTED);
});

test("bounded-response: the abort listener is removed after a successful read", async () => {
  const controller = new AbortController();
  let added = 0;
  let removed = 0;
  const signal = controller.signal;
  const origAdd = signal.addEventListener.bind(signal);
  const origRemove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...a) => ((added += 1), origAdd(...a));
  signal.removeEventListener = (...a) => ((removed += 1), origRemove(...a));
  await readBoundedResponseText(response("ok"), { maxBytes: 64, signal, label: "T" });
  assert.equal(added, removed);
});

// --- diagnostics -----------------------------------------------------------

test("bounded-response: diagnostics carry only the label, the reason and the numeric cap - never body content", async () => {
  const hostile = "AUTHORIZATION: Bearer sk-live-SECRET " + "A".repeat(100);
  for (const [promise, reason] of [
    [readBoundedResponseText(response(hostile), { maxBytes: 16, signal: liveSignal(), label: "Example API" }), BOUNDED_RESPONSE_FAILURES.TOO_LARGE],
    [readBoundedResponseJson(response(hostile.slice(0, 15)), { maxBytes: 16, signal: liveSignal(), label: "Example API" }), BOUNDED_RESPONSE_FAILURES.INVALID_JSON],
  ]) {
    await assert.rejects(promise, (err) => {
      assert.equal(err.reason, reason);
      assert.ok(err.message.startsWith("Example API response body"), err.message);
      assert.ok(!/SECRET|Bearer|AUTHORIZATION|AAAA/.test(err.message), err.message);
      return true;
    });
  }
});

test("bounded-response: the label itself is bounded and control-character free in diagnostics", async () => {
  await assert.rejects(readBoundedResponseText(response("a".repeat(20)), { maxBytes: 4, signal: liveSignal(), label: "X\nY".repeat(200) }), (err) => {
    assert.ok(!/[\r\n]/.test(err.message));
    assert.ok(err.message.length < 300);
    return true;
  });
});
