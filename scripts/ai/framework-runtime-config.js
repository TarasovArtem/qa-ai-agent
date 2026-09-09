/**
 * FrameworkRuntimeConfig - stable, data-only, per-(project, framework)
 * repository layout contract (Roadmap FPI-1, Full Project Independence).
 *
 * Cardinality is explicitly per (projectId, framework) pair, never
 * per-project alone: a single project may exercise more than one
 * certified framework (this repository's own Targomo project already
 * does - Cypress AND Playwright - see project-portability.test.js and
 * collect-history.js's independent projectId/framework history fields
 * for the existing evidence this cardinality is built from). A project
 * that exercises both frameworks is represented as TWO
 * FrameworkRuntimeConfig instances sharing the same `projectId`, never
 * one object trying to describe both integrations at once.
 *
 * This module owns ONLY stable, repository-relative UI framework layout
 * conventions (which config file, which source root, where reports land,
 * which CI workflow file drives History collection). It owns nothing
 * else:
 *
 *  - no project identity/guidance text (that is ProjectProfile's job -
 *    see scripts/ai/project-profile.js, untouched by this module;
 *    `projectId` here is only a reference string a future consumer must
 *    equality-check against ProjectProfile.id, never a duplicate of its
 *    content)
 *  - no environment-specific repository root (repositoryRoot is a
 *    per-invocation, trusted-orchestration-supplied value - see
 *    scripts/ai/test-automation/change-set-application.js and
 *    controlled-execution.js for the existing precedent this repository
 *    already uses for that exact trust class - and is never valid data
 *    for a repo-committed contract like this one)
 *  - no project-wide Knowledge location (Knowledge already scopes
 *    independently across projects/frameworks/browsers on each unit -
 *    see scripts/ai/knowledge/schema.js's appliesTo shape - so its
 *    corpus location is a per-PROJECT fact, not a per-framework one; see
 *    scripts/ai/project-knowledge-config.js instead)
 *  - no CI provider, package manager, runner binary/args, or executable
 *    matcher/regex - this contract supplies DATA (a testSourceRoot
 *    string) that a future consumer deterministically builds a closed,
 *    security-reviewed classifier from; it never carries executable
 *    matching logic itself
 *
 * This module is a pure, dependency-free contract validator - it makes
 * no filesystem call, reads no environment variable, and is not consumed
 * by any production runtime path yet. Physical path existence/canonical
 * containment against a trusted repositoryRoot is a later consumption-
 * time concern (Roadmap FPI-2/FPI-3), never validated here.
 *
 * INPUT TRUST MODEL (Roadmap FPI-1 corrective hardening, closing
 * FPI1-R-1/R-2/R-3/R-4 from the strict independent adversarial review):
 * a valid config represents plain, operator-owned, JSON-like data - every
 * valid instance must remain valid after a JSON.parse(JSON.stringify(...))
 * round-trip, and conversely nothing that ISN'T representable as ordinary
 * JSON (a value living only on a prototype, a class instance, a Map/Date/
 * RegExp/etc.) may satisfy this contract. Concretely: the top-level config
 * and its nested `reports` object must both be plain data objects (see
 * isPlainDataObject() below), and every required field must be that
 * object's OWN property, never one merely inherited through a prototype
 * chain - Object.keys()-based unknown-key scanning already only sees own
 * enumerable keys, so without an equivalent own-property gate on the
 * REQUIRED-field reads, an object with zero own properties (e.g.
 * Object.create(aFullyValidConfig)) could satisfy every requirement
 * through inheritance alone. Diagnostics are bounded regardless of
 * caller-supplied key/value size (see safeKeyDisplay()/
 * MAX_REPORTED_UNKNOWN_KEYS/boundedDetail() below) - an attacker/author
 * mistake supplying a huge or numerous unknown key, or a schemaVersion
 * value with a hostile toString(), must never produce an unbounded or
 * uncontrolled thrown error.
 */

"use strict";

// Closed v1 framework vocabulary. Re-declared here rather than imported
// from scripts/ai/test-automation/automation-repository-context.js's own
// SUPPORTED_FRAMEWORKS - that module already re-declares it independently
// rather than cross-importing a literal two-entry array, and this module
// follows the same convention: no dependency on that (or any other)
// production module.
const SUPPORTED_FRAMEWORKS = Object.freeze(["cypress", "playwright"]);

// Generous enough for any realistic project id/path/filename, while still
// being a real, finite bound rather than no bound at all - matching the
// bounded-but-generous convention scripts/ai/test-automation/
// automation-repository-context.js's own LIMITS already uses.
const MAX_STRING_LENGTH = 200;

// Roadmap FPI-1 corrective (FPI1-R-2): bounds on how an unknown-key
// diagnostic may reflect caller-supplied key names, regardless of how
// long or how numerous those keys are.
const MAX_UNKNOWN_KEY_DISPLAY_LENGTH = 80;
const MAX_REPORTED_UNKNOWN_KEYS = 8;

// Roadmap FPI-1 corrective (FPI1-R-2): a final defensive cap on the
// human-readable detail portion of a thrown validation error - the
// stable `FRAMEWORK_RUNTIME_CONFIG_INVALID:` prefix itself is never
// truncated, only the joined per-field detail that follows it.
const MAX_VALIDATION_DETAIL_LENGTH = 1024;

const OUTER_ALLOWED_KEYS = Object.freeze([
  "schemaVersion",
  "projectId",
  "framework",
  "frameworkConfigPath",
  "testSourceRoot",
  "reports",
  "historyWorkflowFile",
]);

const CYPRESS_REPORTS_ALLOWED_KEYS = Object.freeze(["reportsDir", "screenshotsDir"]);
const PLAYWRIGHT_REPORTS_ALLOWED_KEYS = Object.freeze(["reportFile"]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// Roadmap FPI-1 corrective (FPI1-R-1): a valid config (and its nested
// `reports` object) must be plain, JSON-like data - a literal `{}`, an
// Object.create(null) record, or anything else whose prototype is
// exactly Object.prototype or null. This rejects Object.create(x) for
// any non-plain x, class instances, and built-ins with their own
// prototype (Date, Map, Set, RegExp, Error, ...) - none of these can be
// produced by JSON.parse(), and none are the "operator-owned, static,
// repo-committed data" this contract is meant to model.
function isPlainDataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedString(value) {
  return isNonEmptyString(value) && value.length <= MAX_STRING_LENGTH;
}

// charCode-based rather than a hex-escape regex - deliberately avoids any
// literal control-character escape sequence in this source file's own
// text (matching automation-repository-context.js's own established
// convention and its stated reason: avoids a NUL-byte-via-escape-sequence
// authoring-tooling risk entirely).
function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

// A small, dependency-free, local duplicate of the canonical-relative-
// path safety rules already established by context-utils.js's
// classifyPathString()/PATH_KIND and automation-repository-context.js's
// isSafeCanonicalRelativePath() - deliberately NOT imported from either:
// context-utils.js performs a real filesystem call (fs.realpathSync) at
// module load time to compute its own REAL_ROOT constant, which this
// module must never trigger (Roadmap FPI-1 is filesystem-free by
// design), and automation-repository-context.js is a #23-owned module
// this generic contract has no reason to depend on. The safety rules
// themselves are identical in spirit: absolute (POSIX/Windows-drive/
// drive-relative/UNC) forms, URL-like schemes, and any ".." traversal
// segment are always rejected; the result must be a single, canonical,
// forward-slash, no-leading-"./", no-trailing-"/" relative form.
//
// Roadmap FPI-1 corrective (FPI1-R-4): the Windows drive check now
// rejects ANY leading "<letter>:" prefix, not only one immediately
// followed by a separator - "C:foo" (drive-RELATIVE, meaning "relative
// to whatever the current directory happens to be on drive C") is just
// as unsafe to treat as an ordinary repo-relative path as "C:\foo" is;
// only the drive-designator prefix itself is rejected, an ordinary
// mid-string colon (e.g. "foo:") is unaffected.
function isSafeCanonicalRelativePath(value) {
  if (!isBoundedString(value)) return false;
  if (hasControlChar(value)) return false;
  if (value.includes("\\")) return false;
  if (value.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(value)) return false; // Windows drive-absolute or drive-relative
  if (/^(\\\\|\/\/)/.test(value)) return false; // UNC / doubled-leading-slash
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return false; // URL-like scheme
  if (value === "." || value.startsWith("./")) return false;
  if (value.endsWith("/")) return false;
  if (value.includes("//")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

// A workflow file is a bare filename, never a path - no "/" or "\\" of
// any kind is permitted, matching the exact filename form
// collect-history.js's own current WORKFLOW_FILE constant already uses
// ("cypress.yml"), not a ".github/workflows/"-prefixed form.
function isSafeWorkflowFilename(value) {
  if (!isBoundedString(value)) return false;
  if (hasControlChar(value)) return false;
  if (value.includes("/") || value.includes("\\")) return false;
  if (value === "." || value === "..") return false;
  return /^[A-Za-z0-9._-]+\.ya?ml$/.test(value);
}

// Roadmap FPI-1 corrective (FPI1-R-2): a bounded, deterministic display
// form for a possibly-hostile key name - never reflects more than
// MAX_UNKNOWN_KEY_DISPLAY_LENGTH characters, and never reflects a raw
// control character, into a diagnostic.
function safeKeyDisplay(key) {
  let display = "";
  const limit = Math.min(key.length, MAX_UNKNOWN_KEY_DISPLAY_LENGTH);
  for (let i = 0; i < limit; i++) {
    const code = key.charCodeAt(i);
    display += code < 32 || code === 127 ? "?" : key[i];
  }
  if (key.length > MAX_UNKNOWN_KEY_DISPLAY_LENGTH) display += "...";
  return display;
}

// Roadmap FPI-1 corrective (FPI1-R-2): reports at most
// MAX_REPORTED_UNKNOWN_KEYS individual unknown-key errors (each itself
// bounded via safeKeyDisplay()), plus one fixed summary line if more
// were present - regardless of how many unknown keys `object` actually
// carries or how long their names are. `describe(displayKey)` builds the
// exact per-key message text for the caller's context (outer config vs.
// a specific framework's `reports` shape).
function pushUnknownKeyErrors(object, allowedKeys, errors, describe) {
  const unknown = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  const shown = unknown.slice(0, MAX_REPORTED_UNKNOWN_KEYS);
  for (const key of shown) {
    errors.push(describe(safeKeyDisplay(key)));
  }
  const omitted = unknown.length - shown.length;
  if (omitted > 0) {
    errors.push(`${omitted} additional unknown key(s) omitted`);
  }
}

// Roadmap FPI-1 corrective (FPI1-R-2): the final defensive cap on the
// joined per-field detail text used inside a thrown Error - independent
// of (and in addition to) the per-key/per-count bounds already applied
// while the `errors` array itself was built.
function boundedDetail(errors) {
  const joined = errors.join("; ");
  if (joined.length <= MAX_VALIDATION_DETAIL_LENGTH) return joined;
  return `${joined.slice(0, MAX_VALIDATION_DETAIL_LENGTH)}...`;
}

function validateReports(reports, framework, errors) {
  if (!isPlainDataObject(reports)) {
    errors.push("reports must be a plain object");
    return;
  }

  if (framework === "cypress") {
    pushUnknownKeyErrors(
      reports,
      CYPRESS_REPORTS_ALLOWED_KEYS,
      errors,
      (key) => `reports.${key} is not permitted for framework "cypress"`
    );
    if (!hasOwn(reports, "reportsDir") || !isSafeCanonicalRelativePath(reports.reportsDir)) {
      errors.push("reports.reportsDir must be a safe, canonical, repository-relative own directory path");
    }
    if (!hasOwn(reports, "screenshotsDir") || !isSafeCanonicalRelativePath(reports.screenshotsDir)) {
      errors.push("reports.screenshotsDir must be a safe, canonical, repository-relative own directory path");
    }
  } else if (framework === "playwright") {
    pushUnknownKeyErrors(
      reports,
      PLAYWRIGHT_REPORTS_ALLOWED_KEYS,
      errors,
      (key) => `reports.${key} is not permitted for framework "playwright"`
    );
    if (
      !hasOwn(reports, "reportFile") ||
      !isSafeCanonicalRelativePath(reports.reportFile) ||
      !reports.reportFile.endsWith(".json")
    ) {
      errors.push("reports.reportFile must be a safe, canonical, repository-relative own .json file path");
    }
  } else {
    // framework itself is already invalid and separately reported by the
    // caller - reports can't be meaningfully framework-discriminated
    // against an unknown framework, so this is reported once, generically.
    errors.push("reports could not be validated because framework is not a supported value");
  }
}

// Lightweight, dependency-free shape check - deliberately not a shared
// schema library, matching the "small duplicated primitives" convention
// scripts/ai/project-profile.js's own validateProjectProfile() already
// established (itself matching scripts/ai/knowledge/schema.js and
// scripts/ai/evaluation/*-schema.js).
function validateFrameworkRuntimeConfig(config) {
  const errors = [];

  if (!isPlainDataObject(config)) {
    return { valid: false, errors: ["config must be a plain, JSON-like object"] };
  }

  pushUnknownKeyErrors(config, OUTER_ALLOWED_KEYS, errors, (key) => `unknown key "${key}" is not permitted`);

  if (!hasOwn(config, "schemaVersion") || config.schemaVersion !== 1) {
    errors.push("schemaVersion must be exactly the integer 1 as an own property");
  }

  if (!hasOwn(config, "projectId") || !isBoundedString(config.projectId)) {
    errors.push("projectId must be a non-empty, bounded own string property");
  }

  if (!hasOwn(config, "framework") || !SUPPORTED_FRAMEWORKS.includes(config.framework)) {
    errors.push(`framework must be an own property equal to one of ${SUPPORTED_FRAMEWORKS.join(", ")}`);
  }

  if (!hasOwn(config, "frameworkConfigPath") || !isSafeCanonicalRelativePath(config.frameworkConfigPath)) {
    errors.push("frameworkConfigPath must be a safe, canonical, repository-relative own file path");
  }

  if (!hasOwn(config, "testSourceRoot") || !isSafeCanonicalRelativePath(config.testSourceRoot)) {
    errors.push("testSourceRoot must be a safe, canonical, repository-relative own directory path");
  }

  if (!hasOwn(config, "reports")) {
    errors.push("reports must be present as an own property");
  } else {
    validateReports(config.reports, config.framework, errors);
  }

  if (!hasOwn(config, "historyWorkflowFile") || !isSafeWorkflowFilename(config.historyWorkflowFile)) {
    errors.push("historyWorkflowFile must be a safe .yml/.yaml own filename with no path segments");
  }

  return { valid: errors.length === 0, errors };
}

// Roadmap FPI-1: shared fail-closed helper, matching
// scripts/ai/project-profile.js's assertValidProjectProfile() convention
// exactly - a plain Error with a stable, deterministic, bounded message
// prefix, never a fabricated/partial config and never uncontrolled
// serialization of the invalid input. A present-but-unsupported
// schemaVersion is reported as its own distinct, more specific error
// ahead of the general validator (future callers may want to react to a
// version mismatch differently from an ordinary shape error); a MISSING
// schemaVersion is an ordinary shape defect and falls through to the
// general INVALID path below instead.
//
// Roadmap FPI-1 corrective (FPI1-R-3): the unsupported-version message
// never includes the received schemaVersion value itself - stringifying
// an arbitrary caller-supplied value (via String(...), which invokes the
// value's own toString()) let a hostile/malformed schemaVersion (a
// throwing toString(), or one returning an enormous string) replace this
// deterministic error with an uncontrolled one. The fixed message text
// below is sufficient for an operator to diagnose the mismatch without
// ever evaluating attacker/author-supplied code.
function assertValidFrameworkRuntimeConfig(config, callerLabel) {
  if (config === undefined || config === null) {
    throw new Error(
      `FRAMEWORK_RUNTIME_CONFIG_REQUIRED: ${callerLabel} requires an explicit FrameworkRuntimeConfig; none was supplied.`
    );
  }

  if (isPlainDataObject(config) && hasOwn(config, "schemaVersion") && config.schemaVersion !== 1) {
    throw new Error(
      `FRAMEWORK_RUNTIME_CONFIG_UNSUPPORTED_VERSION: ${callerLabel} received a FrameworkRuntimeConfig with an unsupported schemaVersion; only schemaVersion 1 is supported.`
    );
  }

  const { valid, errors } = validateFrameworkRuntimeConfig(config);
  if (!valid) {
    throw new Error(
      `FRAMEWORK_RUNTIME_CONFIG_INVALID: ${callerLabel} received an invalid FrameworkRuntimeConfig (${boundedDetail(errors)}).`
    );
  }
  return config;
}

module.exports = {
  SUPPORTED_FRAMEWORKS,
  validateFrameworkRuntimeConfig,
  assertValidFrameworkRuntimeConfig,
};
