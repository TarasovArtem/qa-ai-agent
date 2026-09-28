/**
 * GOV-AUTO-1 Wave 3 / 1E -- fingerprint canonicalization and hashing (design
 * section 13). Pure: no I/O, no clock.
 *
 * A fingerprint asserts sameness of a declared byte-canonical region, nothing
 * more: not correctness, not security approval, not risk acceptance. The
 * version prefix (`gov-fp-v1:`) means a canonicalization or region-framing
 * change can never silently compare equal to an old fingerprint -- a consumer
 * that recognizes the prefix knows exactly which algorithm produced it.
 *
 * Canonicalization (v1, design section 13):
 *   - decode as strict UTF-8 (invalid UTF-8 is a hard failure for the domain,
 *     never replacement-character substitution);
 *   - strip a single leading BOM (U+FEFF), if present;
 *   - normalize CRLF and lone CR to LF;
 *   - preserve everything else exactly: trailing whitespace, internal
 *     whitespace, and content order are never touched, because whitespace can
 *     be semantic inside a Markdown table or a code fence.
 *
 * Region framing: `<selectorLength>:<selector>\n<byteLength>:<bytes>\n`, where
 * both lengths are BYTE lengths (not character counts), so two different
 * selector/content splits can never concatenate to the same framed stream
 * (see the framing-collision regression test).
 */

"use strict";

const crypto = require("node:crypto");

const FINGERPRINT_VERSION = "gov-fp-v1";
const BOM = 0xfeff;

/**
 * Strict-UTF-8 decode, BOM strip, CRLF/CR -> LF normalize. Returns
 * { ok: true, bytes: Buffer } (re-encoded canonical UTF-8) or
 * { ok: false, reason: "INVALID_UTF8" }. Never substitutes U+FFFD.
 */
function canonicalizeBytes(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, reason: "INVALID_UTF8" };
  }
  if (text.length > 0 && text.charCodeAt(0) === BOM) text = text.slice(1);
  // CRLF first, then any remaining lone CR: never double-normalizes a CRLF pair to two LFs.
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return { ok: true, bytes: Buffer.from(text, "utf8") };
}

/** Byte length of a UTF-8 string, used for the framing length prefix. */
function byteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

/**
 * Frame one region as `<selectorLength>:<selector>\n<byteLength>:<bytes>\n`
 * (all lengths in bytes) so an ordered concatenation of several regions can
 * never be ambiguous between two different (selector, content) splits.
 */
function frameRegion(selector, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const head = Buffer.from(`${byteLength(selector)}:${selector}\n${body.length}:`, "utf8");
  return Buffer.concat([head, body, Buffer.from("\n", "utf8")]);
}

/** SHA-256 over the ordered concatenation of already-framed regions, versioned. */
function hashFramedRegions(framedBuffers) {
  const hash = crypto.createHash("sha256");
  for (const buf of framedBuffers) hash.update(buf);
  return `${FINGERPRINT_VERSION}:${hash.digest("hex")}`;
}

module.exports = { FINGERPRINT_VERSION, canonicalizeBytes, frameRegion, hashFramedRegions, byteLength };
