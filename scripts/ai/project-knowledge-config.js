/**
 * ProjectKnowledgeConfig - stable, data-only, per-PROJECT contract for an
 * optional project-owned Knowledge corpus location (Roadmap FPI-1, Full
 * Project Independence).
 *
 * Cardinality is explicitly per logical project, never per framework:
 * scripts/ai/knowledge/schema.js's own `appliesTo` shape already scopes
 * every Knowledge unit across `projects`, `frameworks`, and `browsers` as
 * three INDEPENDENT, orthogonal list fields - a single unit (e.g. this
 * repository's own project-firefox-execution-environment-split.json,
 * which applies with `frameworks: ["cypress"]` but is fundamentally a
 * project-scoped fact) is never owned by one framework integration.
 * Nesting a project's Knowledge directory inside a per-framework
 * FrameworkRuntimeConfig (see scripts/ai/framework-runtime-config.js)
 * would force either duplicating the same directory reference across
 * every framework a project exercises (drift risk) or arbitrarily
 * picking one framework to "own" it (semantically wrong) - so this stays
 * its own minimal, project-wide contract instead.
 *
 * This module owns ONLY the optional location of a project's own
 * additive Knowledge units. It owns nothing else:
 *
 *  - no project identity/guidance text (ProjectProfile's job - see
 *    scripts/ai/project-profile.js, untouched by this module; `projectId`
 *    here is only a reference string, never a duplicate of ProjectProfile's
 *    content)
 *  - no framework/layout data (FrameworkRuntimeConfig's job)
 *  - no environment-specific repository root (a per-invocation, trusted-
 *    orchestration-supplied value, never repo-committed config data - see
 *    scripts/ai/framework-runtime-config.js's own module docstring for the
 *    full rationale, unchanged here)
 *  - no Knowledge-unit schema/content/sourceType/priority semantics
 *    (scripts/ai/knowledge/schema.js's job, entirely untouched)
 *
 * A project with no additional project-owned Knowledge may simply omit
 * `projectKnowledgeUnitsDir`, or a future orchestration layer may choose
 * not to supply a ProjectKnowledgeConfig at all for that project - this
 * module never requires the directory field to be present.
 *
 * This module is a pure, dependency-free contract validator - it makes
 * no filesystem call, reads no environment variable, and is not consumed
 * by any production runtime path yet.
 */

"use strict";

// Matching scripts/ai/framework-runtime-config.js's own bound exactly -
// generous enough for any realistic project id/path, still a real,
// finite bound.
const MAX_STRING_LENGTH = 200;

const ALLOWED_KEYS = Object.freeze(["projectId", "projectKnowledgeUnitsDir"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedString(value) {
  return isNonEmptyString(value) && value.length <= MAX_STRING_LENGTH;
}

// charCode-based, matching scripts/ai/framework-runtime-config.js's own
// hasControlChar() convention exactly (itself matching
// automation-repository-context.js's established style).
function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

// A small, dependency-free, local duplicate of the same canonical-
// relative-path safety rules scripts/ai/framework-runtime-config.js's
// own isSafeCanonicalRelativePath() uses - deliberately re-declared
// rather than shared, matching this repository's existing "small
// duplicated primitives over premature shared abstraction" convention
// (see that module's own docstring for the full rationale: no filesystem
// call, no cross-module dependency).
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

// Lightweight, dependency-free shape check - matching
// scripts/ai/project-profile.js's validateProjectProfile() convention.
function validateProjectKnowledgeConfig(config) {
  const errors = [];

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { valid: false, errors: ["config must be an object"] };
  }

  for (const key of Object.keys(config)) {
    if (!ALLOWED_KEYS.includes(key)) {
      errors.push(`unknown key "${key}" is not permitted`);
    }
  }

  if (!isBoundedString(config.projectId)) {
    errors.push("projectId must be a non-empty, bounded string");
  }

  if (config.projectKnowledgeUnitsDir !== undefined) {
    if (!isSafeCanonicalRelativePath(config.projectKnowledgeUnitsDir)) {
      errors.push("projectKnowledgeUnitsDir must be a safe, canonical, repository-relative directory path when supplied");
    }
  }

  return { valid: errors.length === 0, errors };
}

// Roadmap FPI-1: shared fail-closed helper, matching
// scripts/ai/project-profile.js's assertValidProjectProfile() and
// scripts/ai/framework-runtime-config.js's assertValidFrameworkRuntimeConfig()
// convention exactly.
function assertValidProjectKnowledgeConfig(config, callerLabel) {
  if (config === undefined || config === null) {
    throw new Error(
      `PROJECT_KNOWLEDGE_CONFIG_REQUIRED: ${callerLabel} requires an explicit ProjectKnowledgeConfig; none was supplied.`
    );
  }
  const { valid, errors } = validateProjectKnowledgeConfig(config);
  if (!valid) {
    throw new Error(
      `PROJECT_KNOWLEDGE_CONFIG_INVALID: ${callerLabel} received an invalid ProjectKnowledgeConfig (${errors.join("; ")}).`
    );
  }
  return config;
}

module.exports = {
  validateProjectKnowledgeConfig,
  assertValidProjectKnowledgeConfig,
};
