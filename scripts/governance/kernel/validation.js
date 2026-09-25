/**
 * GOV-AUTO-1 Wave 0 -- runtime validation primitives (design sections 15-18,
 * 20 of the merged design's schema/capability contracts).
 *
 * Pure functions only: no I/O, no clock, no mutation of caller input. Static
 * typing is never relied on; every value is checked at run time and nothing is
 * coerced (a string is never turned into an integer, `null` is never a default).
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("./contracts");

/**
 * An integer whose lexical (raw JSON token) form was preserved by the strict
 * JSON parser. A plain parsed JavaScript number cannot distinguish `1` from
 * `1.0`, so lexical validation is only possible for values that carry their raw
 * token.
 */
class RawNumber {
  constructor(raw) {
    this.raw = raw;
    Object.freeze(this);
  }
}

function isRawNumber(value) {
  return value instanceof RawNumber;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isRawNumber(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Positive base-10 integer token, minimum 1, no sign / leading zero / decimal /
// exponent / whitespace (design: manifest schemaVersion contract).
const INTEGER_TOKEN = /^[1-9][0-9]{0,8}$/;
const MAX_TYPED_INTEGER = 999999999;

/**
 * Validate a positive integer.
 *  - RawNumber: the raw token must match INTEGER_TOKEN (lexical validation
 *    before numeric normalization).
 *  - typed number (only when allowTypedNumber): an in-process typed constant is
 *    accepted only as a safe integer within [1, 999999999] (the equivalent
 *    integer-type check for metadata that never existed as JSON text).
 * Everything else (strings, null, booleans, arrays, objects, floats) is invalid.
 */
function parsePositiveInteger(value, options = {}) {
  if (isRawNumber(value)) {
    if (typeof value.raw === "string" && INTEGER_TOKEN.test(value.raw)) {
      return { ok: true, value: Number(value.raw) };
    }
    return { ok: false };
  }
  if (options.allowTypedNumber === true && typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 1 && value <= MAX_TYPED_INTEGER) {
      return { ok: true, value };
    }
  }
  return { ok: false };
}

/** Manifest schemaVersion: lexical only (RawNumber required). */
function validateSchemaVersion(value) {
  if (value === undefined) {
    return deepFreeze({ ok: false, status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.SCHEMA_VERSION_MISSING });
  }
  const parsed = parsePositiveInteger(value, { allowTypedNumber: false });
  if (!parsed.ok) {
    return deepFreeze({ ok: false, status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.SCHEMA_VERSION_INVALID });
  }
  return deepFreeze({ ok: true, value: parsed.value });
}

const CAPABILITY_ID = /^([a-z][a-z0-9-]{1,63})@([1-9][0-9]{0,3})$/;

/** capability-id@major, exact identity; no trimming, no minor/patch. */
function validateCapabilityId(value) {
  if (typeof value !== "string") {
    return deepFreeze({ ok: false, reasonCode: REASON.CAPABILITY_ID_INVALID });
  }
  const match = CAPABILITY_ID.exec(value);
  if (!match) return deepFreeze({ ok: false, reasonCode: REASON.CAPABILITY_ID_INVALID });
  return deepFreeze({ ok: true, id: value, name: match[1], major: Number(match[2]) });
}

/**
 * supportedSchemaVersions of the target framework: an object with exactly
 * minSupported and maxSupported, each a positive integer, min <= max. Absent is
 * INCOMPLETE/TARGET_SCHEMA_RANGE_UNAVAILABLE; any present-but-invalid shape,
 * bound or ordering is INCOMPLETE/TARGET_SCHEMA_RANGE_INVALID (never a manifest
 * CONFIGURATION_ERROR: the data belongs to trusted target metadata). Precedence
 * is deterministic: container type, then unexpected fields, then absent bounds,
 * then bound validity, then ordering. Nothing is defaulted, swapped or coerced.
 */
function validateSupportedSchemaVersions(input) {
  const unavailable = { ok: false, status: STATUS.INCOMPLETE, reasonCode: REASON.TARGET_SCHEMA_RANGE_UNAVAILABLE };
  const invalid = { ok: false, status: STATUS.INCOMPLETE, reasonCode: REASON.TARGET_SCHEMA_RANGE_INVALID };
  if (input === undefined) return deepFreeze({ ...unavailable });
  if (!isPlainObject(input)) return deepFreeze({ ...invalid });
  const keys = Object.keys(input);
  if (keys.some((k) => k !== "minSupported" && k !== "maxSupported")) return deepFreeze({ ...invalid });
  if (!Object.hasOwn(input, "minSupported") || !Object.hasOwn(input, "maxSupported")) return deepFreeze({ ...unavailable });
  const min = parsePositiveInteger(input.minSupported, { allowTypedNumber: true });
  const max = parsePositiveInteger(input.maxSupported, { allowTypedNumber: true });
  if (!min.ok || !max.ok) return deepFreeze({ ...invalid });
  if (min.value > max.value) return deepFreeze({ ...invalid });
  return deepFreeze({ ok: true, range: { minSupported: min.value, maxSupported: max.value } });
}

const FRAMEWORK_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * Framework metadata contract: frameworkVersion, supportedCapabilities[] and
 * supportedSchemaVersions. Data-contract validation only; nothing here fetches
 * or inspects a repository or a target branch.
 */
function validateFrameworkMetadata(input) {
  const findings = [];
  if (!isPlainObject(input)) {
    return deepFreeze({
      ok: false,
      findings: [{ reasonCode: REASON.FRAMEWORK_METADATA_INVALID, path: "$", detail: "metadata must be an object" }],
    });
  }
  const allowed = new Set(["frameworkVersion", "supportedCapabilities", "supportedSchemaVersions"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) findings.push({ reasonCode: REASON.FRAMEWORK_METADATA_INVALID, path: `$.${key}`, detail: "unknown field" });
  }
  if (typeof input.frameworkVersion !== "string" || !FRAMEWORK_VERSION.test(input.frameworkVersion)) {
    findings.push({ reasonCode: REASON.FRAMEWORK_METADATA_INVALID, path: "$.frameworkVersion", detail: "invalid frameworkVersion" });
  }
  const capabilities = [];
  if (!Array.isArray(input.supportedCapabilities)) {
    findings.push({ reasonCode: REASON.FRAMEWORK_METADATA_INVALID, path: "$.supportedCapabilities", detail: "must be an array" });
  } else {
    const seen = new Set();
    input.supportedCapabilities.forEach((entry, index) => {
      const parsed = validateCapabilityId(entry);
      if (!parsed.ok) {
        findings.push({ reasonCode: REASON.CAPABILITY_ID_INVALID, path: `$.supportedCapabilities[${index}]`, detail: "invalid capability identity" });
      } else if (seen.has(parsed.id)) {
        findings.push({ reasonCode: REASON.FRAMEWORK_METADATA_INVALID, path: `$.supportedCapabilities[${index}]`, detail: "duplicate capability identity" });
      } else {
        seen.add(parsed.id);
        capabilities.push(parsed.id);
      }
    });
  }
  const range = validateSupportedSchemaVersions(input.supportedSchemaVersions);
  if (!range.ok) findings.push({ reasonCode: range.reasonCode, path: "$.supportedSchemaVersions", detail: "target schema range not usable" });
  if (findings.length > 0) return deepFreeze({ ok: false, findings });
  return deepFreeze({
    ok: true,
    metadata: {
      frameworkVersion: input.frameworkVersion,
      supportedCapabilities: capabilities,
      supportedSchemaVersions: range.range,
    },
  });
}

/**
 * Compare a manifest schemaVersion with the target range in the mandated order:
 * the target range is validated first and the manifest is never compared against
 * an unvalidated range. Accepted versions are never upgraded or converted.
 */
function classifySchemaCompatibility(rangeResult, schemaResult) {
  if (!rangeResult || rangeResult.ok !== true) {
    const reasonCode = rangeResult && rangeResult.reasonCode ? rangeResult.reasonCode : REASON.TARGET_SCHEMA_RANGE_INVALID;
    return deepFreeze({ status: STATUS.INCOMPLETE, reasonCode });
  }
  if (!schemaResult || schemaResult.ok !== true) {
    const reasonCode = schemaResult && schemaResult.reasonCode ? schemaResult.reasonCode : REASON.SCHEMA_VERSION_INVALID;
    return deepFreeze({ status: STATUS.CONFIGURATION_ERROR, reasonCode });
  }
  const { minSupported, maxSupported } = rangeResult.range;
  if (schemaResult.value < minSupported) {
    return deepFreeze({ status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.SCHEMA_VERSION_BELOW_MINIMUM });
  }
  if (schemaResult.value > maxSupported) {
    return deepFreeze({ status: STATUS.INCOMPLETE, reasonCode: REASON.CAPABILITY_UNAVAILABLE_ON_TARGET });
  }
  return deepFreeze({ status: STATUS.PASS, reasonCode: REASON.OK, acceptedSchemaVersion: schemaResult.value });
}

module.exports = {
  RawNumber,
  isRawNumber,
  isPlainObject,
  parsePositiveInteger,
  validateSchemaVersion,
  validateCapabilityId,
  validateSupportedSchemaVersions,
  validateFrameworkMetadata,
  classifySchemaCompatibility,
};
