/**
 * GOV-AUTO-1 Wave 0 -- canonical result record contract (design section 7).
 *
 * One record per check; the enum `status` is authoritative and is never modelled
 * as a boolean. Pure runtime validation: unknown statuses, owner stages,
 * malformed subjects or reason codes are rejected, never coerced.
 */

"use strict";

const { REASON, STATUS, OWNER_STAGES, EFFECTIVE_LEVELS, RANGE_MODES, LIMITS, deepFreeze } = require("./contracts");
const { isPlainObject, isRawNumber } = require("./validation");

const RECORD_KEYS = ["checkId", "ownerStage", "status", "subject", "observed", "expected", "reasonCode", "detail", "evidenceRefs", "domain"];
const REQUIRED_KEYS = RECORD_KEYS.filter((k) => k !== "domain");
const CHECK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const DOMAIN_ID = /^[A-Z][A-Z0-9_]{1,63}$/;
const STATUS_VALUES = Object.values(STATUS);
const MAX_JSON_NESTING = 8;

function isJsonValue(value, depth = 0) {
  if (depth > MAX_JSON_NESTING) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= LIMITS.maxStringLength;
  if (Array.isArray(value)) return value.length <= LIMITS.maxArrayLength && value.every((v) => isJsonValue(v, depth + 1));
  if (isPlainObject(value) && !isRawNumber(value)) {
    const keys = Object.keys(value);
    return keys.length <= LIMITS.maxArrayLength && keys.every((k) => isJsonValue(value[k], depth + 1));
  }
  return false;
}

/** Stable JSON with sorted keys (used only for equality comparison). */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateSubject(subject) {
  if (!isPlainObject(subject)) return false;
  const keys = Object.keys(subject);
  if (keys.length !== 4 || !["head", "tree", "base", "range"].every((k) => keys.includes(k))) return false;
  if (![subject.head, subject.tree, subject.base].every((s) => typeof s === "string" && SHA40.test(s))) return false;
  const range = subject.range;
  if (!isPlainObject(range) || Object.keys(range).length !== 3) return false;
  return (
    typeof range.mode === "string" && RANGE_MODES.includes(range.mode) &&
    typeof range.from === "string" && SHA40.test(range.from) &&
    typeof range.to === "string" && SHA40.test(range.to)
  );
}

function validateStringList(list, maxItems, maxLength) {
  return Array.isArray(list) && list.length <= maxItems && list.every((s) => typeof s === "string" && s.length <= maxLength);
}

/** Status is derived from the effective level by one rule (design section 7). */
function statusForEffectiveLevel(level) {
  return level === "HUMAN_REVIEW_REQUIRED" ? STATUS.HUMAN_REVIEW_REQUIRED : STATUS.PASS;
}

function validateDomainObject(domain, record, problems) {
  if (!isPlainObject(domain)) {
    problems.push("domain must be an object");
    return;
  }
  const keys = Object.keys(domain).sort().join(",");
  if (keys !== "dependencyState,domainId,effectiveLevel,evidenceRefs,fingerprint,reasons") {
    problems.push("domain has missing or unknown fields");
    return;
  }
  if (typeof domain.domainId !== "string" || !DOMAIN_ID.test(domain.domainId)) problems.push("invalid domain.domainId");
  if (typeof domain.effectiveLevel !== "string" || !EFFECTIVE_LEVELS.includes(domain.effectiveLevel)) problems.push("invalid effectiveLevel");
  if (!validateStringList(domain.reasons, 32, 200)) problems.push("invalid domain.reasons");
  if (!validateStringList(domain.evidenceRefs, LIMITS.maxEvidenceRefs, 256)) problems.push("invalid domain.evidenceRefs");
  if (typeof domain.dependencyState !== "string" || domain.dependencyState.length === 0 || domain.dependencyState.length > 64) problems.push("invalid dependencyState");
  if (domain.fingerprint !== null && (typeof domain.fingerprint !== "string" || domain.fingerprint.length > 200)) problems.push("invalid fingerprint");
  if (problems.length === 0) {
    if (record.checkId !== `1E.DOMAIN.${domain.domainId}`) problems.push("domain result checkId must be 1E.DOMAIN.<domainId>");
    if (record.ownerStage !== "1E") problems.push("domain result ownerStage must be 1E");
    if (record.status !== statusForEffectiveLevel(domain.effectiveLevel)) problems.push("status does not match the effective level");
  }
}

/**
 * Validate a result record. Returns { ok, problems, record } where `record` is
 * a frozen deep copy (the caller's object is never mutated).
 */
function validateResultRecord(input) {
  const problems = [];
  if (!isPlainObject(input)) {
    return deepFreeze({ ok: false, problems: ["record must be an object"], reasonCode: REASON.RESULT_RECORD_INVALID });
  }
  for (const key of Object.keys(input)) if (!RECORD_KEYS.includes(key)) problems.push(`unknown field ${key}`);
  for (const key of REQUIRED_KEYS) if (!Object.hasOwn(input, key)) problems.push(`missing field ${key}`);
  if (problems.length > 0) return deepFreeze({ ok: false, problems, reasonCode: REASON.RESULT_RECORD_INVALID });

  if (typeof input.checkId !== "string" || !CHECK_ID.test(input.checkId)) problems.push("invalid checkId");
  if (typeof input.ownerStage !== "string" || !OWNER_STAGES.includes(input.ownerStage)) problems.push("invalid ownerStage");
  if (typeof input.status !== "string" || !STATUS_VALUES.includes(input.status)) problems.push("invalid status");
  if (!validateSubject(input.subject)) problems.push("invalid subject");
  if (!isJsonValue(input.observed)) problems.push("observed is not a bounded JSON value");
  if (!isJsonValue(input.expected)) problems.push("expected is not a bounded JSON value");
  if (typeof input.reasonCode !== "string" || !REASON_CODE.test(input.reasonCode)) problems.push("invalid reasonCode");
  if (typeof input.detail !== "string" || input.detail.length > LIMITS.maxDetailLength) problems.push("invalid detail");
  if (!validateStringList(input.evidenceRefs, LIMITS.maxEvidenceRefs, 256)) problems.push("invalid evidenceRefs");
  if (Object.hasOwn(input, "domain")) validateDomainObject(input.domain, input, problems);
  else if (typeof input.checkId === "string" && input.checkId.startsWith("1E.DOMAIN.")) problems.push("domain result requires a domain object");

  if (problems.length > 0) return deepFreeze({ ok: false, problems, reasonCode: REASON.RESULT_RECORD_INVALID });
  return deepFreeze({ ok: true, problems: [], record: cloneJson(input) });
}

module.exports = { validateResultRecord, statusForEffectiveLevel, canonicalJson, cloneJson, isJsonValue };
