/**
 * GOV-AUTO-1 Wave 0 -- shared kernel contracts (constants, reason codes, errors).
 *
 * Binding source: docs/gov-auto-1-design-reconciliation-v1.md (sections 6, 7,
 * 22). This module holds only frozen data and one error class; it performs no
 * I/O and inspects no repository. Wave 0 contains no repository-specific check.
 */

"use strict";

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const STATUS = deepFreeze({
  PASS: "PASS",
  FAIL: "FAIL",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  INCOMPLETE: "INCOMPLETE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

// Aggregation precedence, highest first (design section 22). NOT_APPLICABLE is
// neutral and is deliberately absent: it never outranks or equals PASS.
const STATUS_PRECEDENCE = deepFreeze([
  STATUS.CONFIGURATION_ERROR,
  STATUS.FAIL,
  STATUS.INCOMPLETE,
  STATUS.HUMAN_REVIEW_REQUIRED,
  STATUS.PASS,
]);

// Executable ownership. 1G is independent validation, not an owner (design 18).
const OWNER_STAGES = deepFreeze(["KERNEL", "1A", "1B", "1C", "1D", "1E", "1F"]);

const READINESS = deepFreeze({
  READY: "READY",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  NOT_READY: "NOT_READY",
});

const EDGE_KINDS = deepFreeze(["DERIVED_VALUE", "REFERENCE", "MEANING"]);
const REVIEW_MODES = deepFreeze(["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"]);
const EFFECTIVE_LEVELS = deepFreeze([
  "PRESERVATION_CHECK_ONLY",
  "DEEP_REVIEW_REQUIRED",
  "HUMAN_REVIEW_REQUIRED",
]);
const RANGE_MODES = deepFreeze(["PR_REVIEW", "POST_MERGE"]);

// Stable machine-readable reason codes needed by the Wave 0 kernel only.
const REASON = deepFreeze({
  OK: "OK",
  // manifest / JSON
  INVALID_MANIFEST_ENCODING: "INVALID_MANIFEST_ENCODING",
  MANIFEST_TOO_LARGE: "MANIFEST_TOO_LARGE",
  MANIFEST_JSON_INVALID: "MANIFEST_JSON_INVALID",
  DUPLICATE_JSON_KEY: "DUPLICATE_JSON_KEY",
  JSON_DEPTH_EXCEEDED: "JSON_DEPTH_EXCEEDED",
  MANIFEST_UNKNOWN_FIELD: "MANIFEST_UNKNOWN_FIELD",
  MANIFEST_FIELD_MISSING: "MANIFEST_FIELD_MISSING",
  MANIFEST_TYPE_INVALID: "MANIFEST_TYPE_INVALID",
  // schema / capability metadata
  SCHEMA_VERSION_MISSING: "SCHEMA_VERSION_MISSING",
  SCHEMA_VERSION_INVALID: "SCHEMA_VERSION_INVALID",
  SCHEMA_VERSION_BELOW_MINIMUM: "SCHEMA_VERSION_BELOW_MINIMUM",
  CAPABILITY_UNAVAILABLE_ON_TARGET: "CAPABILITY_UNAVAILABLE_ON_TARGET",
  TARGET_SCHEMA_RANGE_UNAVAILABLE: "TARGET_SCHEMA_RANGE_UNAVAILABLE",
  TARGET_SCHEMA_RANGE_INVALID: "TARGET_SCHEMA_RANGE_INVALID",
  CAPABILITY_ID_INVALID: "CAPABILITY_ID_INVALID",
  FRAMEWORK_METADATA_INVALID: "FRAMEWORK_METADATA_INVALID",
  // domain / dependency graph
  DOMAIN_DECLARATION_INVALID: "DOMAIN_DECLARATION_INVALID",
  DEPENDENCY_DECLARATION_MISSING: "DEPENDENCY_DECLARATION_MISSING",
  DEPENDENCY_UNKNOWN: "DEPENDENCY_UNKNOWN",
  DEPENDENCY_DISABLED: "DEPENDENCY_DISABLED",
  DEPENDENCY_SELF: "DEPENDENCY_SELF",
  DEPENDENCY_KIND_INVALID: "DEPENDENCY_KIND_INVALID",
  DEPENDENCY_EDGE_DUPLICATE: "DEPENDENCY_EDGE_DUPLICATE",
  DEPENDENCY_CYCLE: "DEPENDENCY_CYCLE",
  DERIVED_FROM_NOT_IN_DEPENDS_ON: "DERIVED_FROM_NOT_IN_DEPENDS_ON",
  DOMAIN_DUPLICATE: "DOMAIN_DUPLICATE",
  // safety primitives
  UNSAFE_PATH: "UNSAFE_PATH",
  PROCESS_INVALID_REQUEST: "PROCESS_INVALID_REQUEST",
  PROCESS_TIMEOUT: "PROCESS_TIMEOUT",
  PROCESS_FAILURE: "PROCESS_FAILURE",
  PROCESS_OUTPUT_LIMIT: "PROCESS_OUTPUT_LIMIT",
  PROCESS_SPAWN_ERROR: "PROCESS_SPAWN_ERROR",
  // result records / aggregation
  RESULT_RECORD_INVALID: "RESULT_RECORD_INVALID",
  DUPLICATE_CHECK_ID: "DUPLICATE_CHECK_ID",
  SUBJECT_MISMATCH: "SUBJECT_MISMATCH",
  DOMAIN_RESULT_MISSING: "DOMAIN_RESULT_MISSING",
  DOMAIN_RESULT_DUPLICATE: "DOMAIN_RESULT_DUPLICATE",
  DOMAIN_RESULT_UNKNOWN: "DOMAIN_RESULT_UNKNOWN",
  DOMAIN_PROJECTION_MISMATCH: "DOMAIN_PROJECTION_MISMATCH",
  APPLICABILITY_NOT_PROVEN: "APPLICABILITY_NOT_PROVEN",
  NO_PASSING_EVIDENCE: "NO_PASSING_EVIDENCE",
});

/**
 * Raised only for a programming/usage error against a safety primitive (an
 * unsafe path or a malformed process request). The message is bounded and never
 * embeds caller-supplied values verbatim beyond a short redacted excerpt.
 */
class GovernanceSafetyError extends Error {
  constructor(reasonCode, message) {
    super(`${reasonCode}: ${message}`);
    this.name = "GovernanceSafetyError";
    this.reasonCode = reasonCode;
  }
}

const LIMITS = deepFreeze({
  maxManifestBytes: 1024 * 1024,
  maxJsonDepth: 32,
  maxStringLength: 4096,
  maxArrayLength: 1024,
  maxDomains: 256,
  maxDetailLength: 500,
  maxEvidenceRefs: 32,
});

module.exports = {
  deepFreeze,
  STATUS,
  STATUS_PRECEDENCE,
  OWNER_STAGES,
  READINESS,
  EDGE_KINDS,
  REVIEW_MODES,
  EFFECTIVE_LEVELS,
  RANGE_MODES,
  REASON,
  LIMITS,
  GovernanceSafetyError,
};
