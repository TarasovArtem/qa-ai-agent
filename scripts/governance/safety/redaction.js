/**
 * GOV-AUTO-1 Wave 0 -- deterministic redaction primitives (design sections 16,
 * 20). Used by later waves for error text, report details and any place that
 * could otherwise echo a secret-like value. This is NOT the secret scanner (that
 * belongs to 1A): it only guarantees that known secret shapes and values under
 * sensitive key names are never emitted, in a stable, bounded form.
 *
 * Output never contains any character of a matched secret (no partial prefix),
 * only a rule identifier. Redaction runs before output truncation. The one lossy
 * step that precedes matching is the input bound (MAX_INPUT_LENGTH). A cut there
 * could split a secret, so it is made safe in two ways:
 *   - token-shaped secrets contain no whitespace, so the trailing whitespace-free
 *     run at the cut is dropped before matching;
 *   - sensitive key/value pairs are handled by redactSensitivePairs(), which
 *     fails closed: an opened quote with no closing quote is redacted to the end
 *     of the processed text, so a quoted value split by the bound cannot leak its
 *     continuation.
 * Unquoted values run to the next whitespace (commas, semicolons and colons are
 * part of the value): over-redaction is the deliberate direction.
 */

"use strict";

const { LIMITS } = require("./../kernel/contracts");

const RULES = Object.freeze([
  { id: "PRIVATE_KEY_BLOCK", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  // Prefix-anchored rules deliberately have no word boundaries: a token glued to
  // neighbouring text must still be masked. Over-redaction is the safe direction.
  { id: "GITHUB_TOKEN", re: /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { id: "AWS_ACCESS_KEY", re: /(?:AKIA|ASIA)[0-9A-Z]{16}/g },
  { id: "SLACK_TOKEN", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: "API_KEY_SK", re: /sk-[A-Za-z0-9_-]{16,}/g },
  { id: "JWT", re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // No leading word boundary either: "xBearer <token>" must still be masked.
  { id: "BEARER_TOKEN", re: /bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
]);

// Sensitive key names (also matched inside longer identifiers such as githubToken).
const KEYWORD_SOURCE = "password|passwd|secret|token|api[_-]?key|authorization|credential";
const SENSITIVE_KEY = new RegExp(`(?:${KEYWORD_SOURCE})`, "i");
const KEY_CHAR = /[A-Za-z0-9_-]/;
const MAX_KEY_EXTENSION = 64;
const AUTH_SCHEMES = new Set(["bearer", "basic"]);
const MAX_REDACTION_DEPTH = 8;
// Input is bounded before pattern matching (bounded regex cost and memory). The
// output limit is kept below it. A cut at the input bound is made safe by the two
// measures in the header, not by relying on output length.
const MAX_INPUT_LENGTH = 65536;
const MAX_OUTPUT_LENGTH = 60000;

function marker(id) {
  return `[REDACTED:${id}]`;
}

const isSpace = (ch) => /\s/.test(ch);

/**
 * Replace the VALUE of every sensitive key=value / key: value pair (the key text is
 * kept). One left-to-right pass, no backtracking: O(n) in the input length, no
 * recursion, output bounded by the input plus one marker per pair.
 *
 * Key forms: name=, name:, "name":, 'name': (optional spaces around the separator).
 * Value forms:
 *   - "..." or '...': consumed whole, spaces, punctuation and newlines included,
 *     honouring backslash escapes; with no closing quote it runs to the END of the
 *     text (fail closed);
 *   - unquoted: consumed to the next whitespace, so commas, semicolons and colons
 *     belong to the value; when the key itself was quoted (JSON) the value is a
 *     scalar and also stops at , } ]. A Bearer/Basic scheme word also takes the
 *     credential that follows it.
 */
function redactSensitivePairs(text) {
  const n = text.length;
  const keyword = new RegExp(KEYWORD_SOURCE, "gi");
  let out = "";
  let last = 0;
  let match;
  while ((match = keyword.exec(text)) !== null) {
    let j = match.index + match[0].length;
    const cap = j + MAX_KEY_EXTENSION;
    while (j < n && j < cap && KEY_CHAR.test(text[j])) j += 1;
    let k = j;
    let quotedKey = false;
    if (text[k] === '"' || text[k] === "'") {
      quotedKey = true;
      k += 1;
    }
    while (k < n && (text[k] === " " || text[k] === "\t")) k += 1;
    if (text[k] !== "=" && text[k] !== ":") {
      keyword.lastIndex = j;
      continue;
    }
    k += 1;
    while (k < n && isSpace(text[k])) k += 1;
    if (k >= n) break;
    const start = k;
    let end;
    const quote = text[start];
    if (quote === '"' || quote === "'") {
      end = start + 1;
      while (end < n && text[end] !== quote) end += text[end] === "\\" ? 2 : 1;
      end = end < n ? end + 1 : n;
    } else {
      end = start;
      while (end < n && !isSpace(text[end]) && !(quotedKey && (text[end] === "," || text[end] === "}" || text[end] === "]"))) end += 1;
      if (AUTH_SCHEMES.has(text.slice(start, end).toLowerCase())) {
        let next = end;
        while (next < n && (text[next] === " " || text[next] === "\t")) next += 1;
        if (next > end && next < n && !isSpace(text[next])) {
          end = next;
          while (end < n && !isSpace(text[end])) end += 1;
        }
      }
    }
    if (end === start) {
      keyword.lastIndex = j;
      continue;
    }
    out += text.slice(last, start) + marker("SENSITIVE_VALUE");
    last = end;
    keyword.lastIndex = end;
  }
  return out + text.slice(last);
}

/** Redact secret-like content, then bound the length. */
function redactString(value, options = {}) {
  const requested = Number.isInteger(options.maxLength) && options.maxLength > 0 ? options.maxLength : LIMITS.maxDetailLength;
  const max = Math.min(requested, MAX_OUTPUT_LENGTH);
  const source = typeof value === "string" ? value : String(value);
  let text = source;
  let overflow = 0;
  if (source.length > MAX_INPUT_LENGTH) {
    // Token-shaped secrets contain no whitespace (private-key blocks are redacted
    // through an end-of-input alternative), so an incomplete token candidate can only
    // be the final whitespace-free run of the slice. Drop it entirely rather than let
    // a partial token escape the length-anchored rules. Quoted key/value secrets are
    // covered by the fail-closed unterminated-quote rule in redactSensitivePairs.
    let end = MAX_INPUT_LENGTH;
    while (end > 0 && !isSpace(source[end - 1])) end -= 1;
    text = source.slice(0, end);
    overflow = source.length - end;
  }
  for (const rule of RULES) text = text.replace(rule.re, marker(rule.id));
  text = redactSensitivePairs(text);
  if (text.length > max || overflow > 0) return `${text.slice(0, max)}...[truncated ${text.length - Math.min(text.length, max) + overflow}]`;
  return text;
}

/**
 * Structured redaction: returns a new value (the input is never mutated). String
 * leaves are redacted; values under sensitive key names are replaced entirely.
 */
function redactValue(value, options = {}, depth = 0) {
  if (typeof value === "string") return redactString(value, options);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_REDACTION_DEPTH) return marker("DEPTH_LIMIT");
  if (Array.isArray(value)) return value.map((item) => redactValue(item, options, depth + 1));
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? marker("SENSITIVE_KEY") : redactValue(value[key], options, depth + 1);
  }
  return out;
}

module.exports = { redactString, redactValue };
