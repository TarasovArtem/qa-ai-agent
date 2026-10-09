/**
 * Bounded remote-response body reader (TSB-F06 + ADV-01).
 *
 * The one internal place where an HTTP response body coming back from a
 * remote service is turned into text / JSON. It replaces `response.json()`
 * at every TSB-F06 enumerated site (the Groq and Gemini provider adapters,
 * collect-history.js's fetchJson, the Jira and Azure DevOps requirement
 * adapters, and the Azure DevOps test-case destination), because
 * `response.json()` buffers and parses the complete body before any caller
 * can apply a bound.
 *
 * Order of operations, always:
 *   caller has already applied its own status / redirect / retry semantics
 *   -> bounded byte acquisition (this module)
 *   -> strict UTF-8 decode
 *   -> JSON.parse
 *   -> the caller's own existing structural / semantic validation.
 *
 * SIZE: `maxBytes` bounds the bytes actually received from the body stream
 * (after any transfer/content decoding the fetch implementation performs),
 * never JavaScript string length. Chunks are counted as they arrive and the
 * read is rejected - and the stream cancelled - as soon as the running total
 * passes `maxBytes`, so an oversized body is never assembled in full. A
 * numeric `Content-Length` larger than `maxBytes` is an early-rejection
 * optimization only; a missing, malformed or understated header changes
 * nothing, since the streaming count is always enforced.
 *
 * TIME (ADV-01): `signal` is mandatory. It is the caller's own existing
 * per-attempt request deadline (an AbortController the caller times out,
 * or AbortSignal.timeout()), so the deadline that already bounds connect +
 * headers keeps running through the body read rather than ending when the
 * headers arrive. Every pending chunk read races that signal, so the read
 * ends at the deadline even if the body stream itself ignores the abort
 * (a stalled body, a slow drip, or a never-ending stream under the cap).
 * This module adds no timeout value or retry of its own - the caller's
 * existing per-attempt timeout and bounded retry loop are unchanged.
 *
 * DIAGNOSTICS: every failure is a BoundedResponseError whose message
 * carries only the caller's fixed label, a fixed reason phrase and (for
 * TOO_LARGE) the numeric cap. No body content, URL, header or underlying
 * error text is ever included or attached as `cause` (a JSON SyntaxError
 * quotes body text). Callers map `reason` onto their own existing error
 * vocabulary.
 *
 * Internal only: not re-exported from index.js and not a package subpath.
 */

"use strict";

const BOUNDED_RESPONSE_FAILURES = Object.freeze({
  TOO_LARGE: "TOO_LARGE",
  ABORTED: "ABORTED",
  READ_FAILED: "READ_FAILED",
  INVALID_UTF8: "INVALID_UTF8",
  INVALID_JSON: "INVALID_JSON",
});

const REASON_PHRASES = Object.freeze({
  [BOUNDED_RESPONSE_FAILURES.ABORTED]: "was not fully received before the request deadline",
  [BOUNDED_RESPONSE_FAILURES.READ_FAILED]: "could not be read",
  [BOUNDED_RESPONSE_FAILURES.INVALID_UTF8]: "was not valid UTF-8",
  [BOUNDED_RESPONSE_FAILURES.INVALID_JSON]: "was not valid JSON",
});

const MAX_LABEL_LENGTH = 100;
const DECIMAL_DIGITS = /^[0-9]+$/;

class BoundedResponseError extends Error {
  constructor(reason, label, maxBytes) {
    const phrase =
      reason === BOUNDED_RESPONSE_FAILURES.TOO_LARGE ? `exceeded the maximum of ${maxBytes} bytes` : REASON_PHRASES[reason];
    super(`${label} response body ${phrase}.`);
    this.name = "BoundedResponseError";
    this.reason = reason;
  }
}

function safeLabel(label) {
  // eslint-disable-next-line no-control-regex
  return String(label ?? "Remote").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_LABEL_LENGTH);
}

// Fire-and-forget: a hostile stream's cancel() may never settle, and the
// reader must not wait on it.
function cancelQuietly(target) {
  try {
    const pending = target.cancel();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {
    // already locked / errored / closed - nothing further to release
  }
}

function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * @param {Response} response a fetch Response whose status the caller has already accepted
 * @param {{maxBytes: number, signal: AbortSignal, label: string}} options
 * @returns {Promise<string>} the UTF-8 decoded body (a leading BOM stripped, as Response.text() does)
 * @throws {BoundedResponseError | TypeError}
 */
async function readBoundedResponseText(response, { maxBytes, signal, label } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("readBoundedResponseText(): maxBytes must be a positive safe integer.");
  }
  if (!(signal instanceof AbortSignal)) {
    throw new TypeError("readBoundedResponseText(): signal must be an AbortSignal.");
  }
  const name = safeLabel(label);
  const fail = (reason) => new BoundedResponseError(reason, name, maxBytes);

  const body = response ? response.body : undefined;
  if (body === null) return "";
  if (!body || typeof body.getReader !== "function") throw fail(BOUNDED_RESPONSE_FAILURES.READ_FAILED);

  if (signal.aborted) {
    cancelQuietly(body);
    throw fail(BOUNDED_RESPONSE_FAILURES.ABORTED);
  }

  const declared = response.headers && typeof response.headers.get === "function" ? response.headers.get("content-length") : null;
  if (typeof declared === "string" && DECIMAL_DIGITS.test(declared) && Number(declared) > maxBytes) {
    cancelQuietly(body);
    throw fail(BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
  }

  const reader = body.getReader();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(fail(BOUNDED_RESPONSE_FAILURES.ABORTED));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  aborted.catch(() => {});

  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      let step;
      try {
        step = await Promise.race([reader.read(), aborted]);
      } catch (err) {
        if (err instanceof BoundedResponseError) throw err;
        throw fail(signal.aborted ? BOUNDED_RESPONSE_FAILURES.ABORTED : BOUNDED_RESPONSE_FAILURES.READ_FAILED);
      }
      if (step.done) break;
      const chunk = step.value;
      if (!(chunk instanceof Uint8Array)) throw fail(BOUNDED_RESPONSE_FAILURES.READ_FAILED);
      total += chunk.byteLength;
      if (total > maxBytes) throw fail(BOUNDED_RESPONSE_FAILURES.TOO_LARGE);
      chunks.push(chunk);
    }
  } catch (err) {
    cancelQuietly(reader);
    throw err;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(concatChunks(chunks, total));
  } catch {
    throw fail(BOUNDED_RESPONSE_FAILURES.INVALID_UTF8);
  }
}

/**
 * readBoundedResponseText() followed by JSON.parse - the bounded
 * replacement for `response.json()`.
 */
async function readBoundedResponseJson(response, options) {
  const text = await readBoundedResponseText(response, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new BoundedResponseError(BOUNDED_RESPONSE_FAILURES.INVALID_JSON, safeLabel(options.label), options.maxBytes);
  }
}

module.exports = {
  readBoundedResponseText,
  readBoundedResponseJson,
  BoundedResponseError,
  BOUNDED_RESPONSE_FAILURES,
};
