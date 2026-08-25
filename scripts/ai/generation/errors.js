/**
 * Shared, bounded validation-result shape for the QA generation contracts
 * (Roadmap #22/23-F0).
 *
 * Every validator in scripts/ai/generation/ returns { ok: true, errors: [] }
 * or { ok: false, errors: [{ path, code, message }, ...] } - never the raw
 * rejected input, never a stack trace derived from user/model content, and
 * never a free-form string list. `code` is drawn from the fixed,
 * provider-neutral-style vocabulary below (the same "small closed error-code
 * set, never raw underlying text" posture scripts/ai/providers/provider-error.js
 * already uses for provider failures) - a caller can branch on `code`
 * without parsing `message`.
 */

"use strict";

const ERROR_CODES = Object.freeze({
  MISSING_FIELD: "MISSING_FIELD",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_VALUE: "INVALID_VALUE",
  INVALID_ENUM: "INVALID_ENUM",
  INVALID_VERSION: "INVALID_VERSION",
  DUPLICATE_ID: "DUPLICATE_ID",
  INVALID_REFERENCE: "INVALID_REFERENCE",
  PROJECT_MISMATCH: "PROJECT_MISMATCH",
  INVALID_PATH: "INVALID_PATH",
  INVARIANT_VIOLATION: "INVARIANT_VIOLATION",
});

// `message` must always be a short, fixed/templated diagnostic built only
// from field paths and allowlisted enum/limit values - never the rejected
// value itself (a hostile string/object could otherwise smuggle arbitrary
// content into a persisted validation report).
function err(path, code, message) {
  return { path, code, message };
}

function ok() {
  return { ok: true, errors: [] };
}

function fail(errors) {
  return { ok: false, errors };
}

module.exports = { ERROR_CODES, err, ok, fail };
