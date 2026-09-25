/**
 * GOV-AUTO-1 Wave 0 -- deterministic redaction primitives (design sections 16,
 * 20). Used by later waves for error text, report details and any place that
 * could otherwise echo a secret-like value. This is NOT the secret scanner (that
 * belongs to 1A): it only guarantees that known secret shapes and values under
 * sensitive key names are never emitted, in a stable, bounded form.
 *
 * Output never contains any character of a matched secret (no partial prefix),
 * only a rule identifier. Redaction runs before truncation so a cut can never
 * split a secret pattern and leak its head.
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
  { id: "BEARER_TOKEN", re: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,}/g },
]);

// key=value / key: value pairs whose key name is sensitive.
const SENSITIVE_PAIR = /\b((?:[A-Za-z0-9_-]{0,64}(?:password|passwd|secret|token|api[_-]?key|authorization|credential)[A-Za-z0-9_-]{0,64}))(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SENSITIVE_KEY = /(?:password|passwd|secret|token|api[_-]?key|authorization|credential)/i;
const MAX_REDACTION_DEPTH = 8;
// Input is bounded before pattern matching (bounded regex cost); the output limit is
// kept below it so a cut at the input bound can never surface a partial secret.
const MAX_INPUT_LENGTH = 65536;
const MAX_OUTPUT_LENGTH = 60000;

function marker(id) {
  return `[REDACTED:${id}]`;
}

/** Redact secret-like content, then bound the length. */
function redactString(value, options = {}) {
  const requested = Number.isInteger(options.maxLength) && options.maxLength > 0 ? options.maxLength : LIMITS.maxDetailLength;
  const max = Math.min(requested, MAX_OUTPUT_LENGTH);
  const source = typeof value === "string" ? value : String(value);
  const overflow = Math.max(0, source.length - MAX_INPUT_LENGTH);
  let text = source.slice(0, MAX_INPUT_LENGTH);
  for (const rule of RULES) text = text.replace(rule.re, marker(rule.id));
  text = text.replace(SENSITIVE_PAIR, (_m, key, sep) => `${key}${sep}${marker("SENSITIVE_VALUE")}`);
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
