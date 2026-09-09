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
// themselves are identical in spirit: absolute (POSIX/Windows-drive/UNC)
// forms, URL-like schemes, and any ".." traversal segment are always
// rejected; the result must be a single, canonical, forward-slash,
// no-leading-"./", no-trailing-"/" relative form.
function isSafeCanonicalRelativePath(value) {
  if (!isBoundedString(value)) return false;
  if (hasControlChar(value)) return false;
  if (value.includes("\\")) return false;
  if (value.startsWith("/")) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false; // Windows drive-absolute
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

function validateReports(reports, framework, errors) {
  if (!reports || typeof reports !== "object" || Array.isArray(reports)) {
    errors.push("reports must be an object");
    return;
  }

  if (framework === "cypress") {
    for (const key of Object.keys(reports)) {
      if (!CYPRESS_REPORTS_ALLOWED_KEYS.includes(key)) {
        errors.push(`reports.${key} is not permitted for framework "cypress"`);
      }
    }
    if (!isSafeCanonicalRelativePath(reports.reportsDir)) {
      errors.push("reports.reportsDir must be a safe, canonical, repository-relative directory path");
    }
    if (!isSafeCanonicalRelativePath(reports.screenshotsDir)) {
      errors.push("reports.screenshotsDir must be a safe, canonical, repository-relative directory path");
    }
  } else if (framework === "playwright") {
    for (const key of Object.keys(reports)) {
      if (!PLAYWRIGHT_REPORTS_ALLOWED_KEYS.includes(key)) {
        errors.push(`reports.${key} is not permitted for framework "playwright"`);
      }
    }
    if (!isSafeCanonicalRelativePath(reports.reportFile) || !reports.reportFile.endsWith(".json")) {
      errors.push("reports.reportFile must be a safe, canonical, repository-relative .json file path");
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

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { valid: false, errors: ["config must be an object"] };
  }

  for (const key of Object.keys(config)) {
    if (!OUTER_ALLOWED_KEYS.includes(key)) {
      errors.push(`unknown key "${key}" is not permitted`);
    }
  }

  if (config.schemaVersion !== 1) {
    errors.push("schemaVersion must be exactly the integer 1");
  }

  if (!isBoundedString(config.projectId)) {
    errors.push("projectId must be a non-empty, bounded string");
  }

  if (!SUPPORTED_FRAMEWORKS.includes(config.framework)) {
    errors.push(`framework must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`);
  }

  if (!isSafeCanonicalRelativePath(config.frameworkConfigPath)) {
    errors.push("frameworkConfigPath must be a safe, canonical, repository-relative file path");
  }

  if (!isSafeCanonicalRelativePath(config.testSourceRoot)) {
    errors.push("testSourceRoot must be a safe, canonical, repository-relative directory path");
  }

  validateReports(config.reports, config.framework, errors);

  if (!isSafeWorkflowFilename(config.historyWorkflowFile)) {
    errors.push("historyWorkflowFile must be a safe .yml/.yaml filename with no path segments");
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
function assertValidFrameworkRuntimeConfig(config, callerLabel) {
  if (config === undefined || config === null) {
    throw new Error(
      `FRAMEWORK_RUNTIME_CONFIG_REQUIRED: ${callerLabel} requires an explicit FrameworkRuntimeConfig; none was supplied.`
    );
  }

  if (
    typeof config === "object" &&
    !Array.isArray(config) &&
    Object.prototype.hasOwnProperty.call(config, "schemaVersion") &&
    config.schemaVersion !== 1
  ) {
    throw new Error(
      `FRAMEWORK_RUNTIME_CONFIG_UNSUPPORTED_VERSION: ${callerLabel} received a FrameworkRuntimeConfig with schemaVersion "${String(
        config.schemaVersion
      )}"; only schemaVersion 1 is supported.`
    );
  }

  const { valid, errors } = validateFrameworkRuntimeConfig(config);
  if (!valid) {
    throw new Error(
      `FRAMEWORK_RUNTIME_CONFIG_INVALID: ${callerLabel} received an invalid FrameworkRuntimeConfig (${errors.join("; ")}).`
    );
  }
  return config;
}

module.exports = {
  SUPPORTED_FRAMEWORKS,
  validateFrameworkRuntimeConfig,
  assertValidFrameworkRuntimeConfig,
};
