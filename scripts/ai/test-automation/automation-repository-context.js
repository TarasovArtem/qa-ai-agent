/**
 * Deterministic automation repository context (Roadmap #23B).
 *
 * First real #23 AI Test Automation component. This module does NOT
 * generate an AutomationPlan and does NOT call a provider - it takes
 * project identity, canonical framework identity, and a bounded,
 * caller-supplied list of relevant repository file paths, and
 * deterministically assembles a small internal AutomationRepositoryContext:
 * the framework's own config file plus each accepted relevant file, read
 * read-only and bounded, alongside a positive projection of package.json's
 * scripts and ProjectProfile's guidance fields.
 *
 * This is NOT a replacement for or addition to the frozen v1
 * AutomationCandidate/AutomationPlan contracts (scripts/ai/generation/**) -
 * it is a separate, #23-owned, unversioned internal projection that a
 * future #23C provider call will consume alongside a real
 * AutomationCandidate to produce an AutomationPlan. Nothing here is placed
 * under scripts/ai/generation/, and nothing here is claimed to be frozen.
 *
 * DATA MINIMIZATION: the provider must never receive a whole-repository
 * dump. relevantFiles is a bounded, caller-selected set (selected upstream
 * by deterministic logic - this module makes no semantic relevance
 * judgement of its own); only cypress/** (+ cypress.config.js) is ever
 * readable for a cypress context, only playwright/** (+ playwright
 * .config.js) for a playwright context; package.json is exposed only as a
 * positively-projected `packageScripts` list, never as raw file content;
 * runtime-artifact and secret-shaped paths are excluded by name.
 *
 * DATA BOUNDARY: repository file content is DATA, never instructions -
 * this module performs no semantic interpretation of it, exactly the same
 * boundary scripts/ai/test-design/evidence-ingestion.js already establishes
 * for direct user requirement text and scripts/ai/qa-agent-prompt.js
 * already establishes for current-run failure evidence.
 *
 * Pure with respect to output determinism: read-only filesystem access is
 * the only side effect (no writes, no provider, no network, no child
 * process, no timestamp/random/environment-derived identity). The same
 * repoRoot + framework + relevantFiles (any order) always produces a
 * deep-equal context, independent of process.cwd().
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isBoundedText, collectUnknownKeyErrors } = require("../generation/primitives");
const { validateProjectProfile } = require("../project-profile");
const { classifyPathString, PATH_KIND, isCanonicalPathInsideRoot } = require("../context-utils");

// context-utils.js's own equivalent (resolveRealPathSafe) is a private,
// unexported helper there (that module only exports the higher-level
// resolveSafeSpecPath()/resolveSafeLocalAttachmentPath() wrappers, which
// are hardcoded to that module's own repository ROOT rather than a
// caller-supplied repoRoot - unusable for this module's explicit-repoRoot
// testability requirement). This is the same one-line try/catch shape,
// reimplemented locally rather than exporting a new surface from F0-owned
// context-utils.js merely for import convenience.
function resolveRealPathSafe(absPath) {
  try {
    return fs.realpathSync(absPath);
  } catch {
    return null;
  }
}

// Roadmap #23B-owned bounds - deliberately local to this module, never
// added to scripts/ai/generation/limits.js (that file bounds the frozen v1
// contracts, not this pre-contract context stage). Calibrated against this
// repository's real current sizes (see the real-repository smoke test in
// automation-repository-context.test.js): today's package.json has 20
// scripts, a 258-char longest command, a 1278-char aggregate; the
// framework config/spec/page-object files inspected during reconnaissance
// are all under ~3600 chars. MAX_AGGREGATE_EVIDENCE_LENGTH is deliberately
// much smaller than MAX_RELEVANT_FILES * MAX_FILE_CONTENT_LENGTH (20*8000 =
// 160000), so the per-file cap alone can never be the only bound.
const LIMITS = Object.freeze({
  MAX_RELEVANT_FILES: 20,
  MAX_FILE_CONTENT_LENGTH: 8000,
  MAX_AGGREGATE_EVIDENCE_LENGTH: 40000,
  MAX_SCRIPT_COUNT: 60,
  MAX_SCRIPT_NAME_LENGTH: 100,
  MAX_SCRIPT_COMMAND_LENGTH: 500,
  MAX_AGGREGATE_SCRIPT_TEXT_LENGTH: 6000,
});

// Closed v1 framework vocabulary, matching
// scripts/ai/generation/primitives.js's frozen SUPPORTED_FRAMEWORKS exactly
// (re-declared, not imported - a literal two-entry array is not worth a
// cross-import into frozen F0). No case-insensitive normalization: an
// already-canonical value is required.
const SUPPORTED_FRAMEWORKS = Object.freeze(["cypress", "playwright"]);

// Verified against this repository's actual layout - both configs live at
// the repository root. Always auto-included, never overridable by a
// caller.
const FRAMEWORK_CONFIG_PATH = Object.freeze({
  cypress: "cypress.config.js",
  playwright: "playwright.config.js",
});

// Verified against this repository's actual layout (cypress/e2e,
// cypress/support; playwright/tests). A cypress context can never see a
// playwright/** path and vice versa.
const FRAMEWORK_SOURCE_PREFIX = Object.freeze({
  cypress: "cypress/",
  playwright: "playwright/",
});

// Runtime-artifact subdirectories that would otherwise lexically fall
// inside an allowed framework source tree - cypress/screenshots is this
// repository's actual runtime output directory (see cypress.config.js's
// reporterOptions and the root-level cypress/screenshots/ directory);
// videos/downloads are Cypress's other conventional runtime-output
// subdirectories, excluded defensively even though not currently enabled.
// A narrow, named exclusion list - not a generic artifact/secret scanner.
const EXCLUDED_PATH_PREFIXES = Object.freeze(["cypress/screenshots/", "cypress/videos/", "cypress/downloads/"]);

// A narrow, named dotenv-shaped basename check - not a generic secret
// scanner - covering the one filename convention this repository's own
// tooling (and most Node projects) would recognize.
const ENV_FILE_BASENAME_PATTERN = /^\.env(\..+)?$/;

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze(["repoRoot", "projectProfile", "framework", "relevantFiles"]);

const EVIDENCE_KIND_REPOSITORY = "repository";
const ROLE_FRAMEWORK_CONFIG = "framework_config";
const ROLE_RELEVANT_FILE = "relevant_file";

function formatOrdinal(n) {
  return String(n).padStart(4, "0");
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

// charCode-based rather than a hex-escape regex - deliberately avoids any
// literal control-character escape sequence in this source file's own text.
function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

// A caller-supplied relevantFiles entry must be a canonical, repo-relative,
// unambiguous path string - the same "single spelling per target" posture
// scripts/ai/generation/automation-plan.js's isCanonicalPlanPath() applies
// to a proposed future plan path, independently re-implemented here (not
// imported - that helper validates a PROPOSED future write target for a
// frozen v1 contract; this validates an EXISTING file's read path for a
// separate, #23-owned concern). Reuses context-utils.js's
// classifyPathString() - the one shared primitive both genuinely have in
// common - for the security-critical absolute/UNC/URL/traversal rejection,
// then applies the same canonical-form rules as the F0 precedent: no
// leading "./", no bare "." or ".." segment, no trailing/doubled "/", no
// backslash.
function isSafeCanonicalRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (hasControlChar(value)) return false;
  if (classifyPathString(value) !== PATH_KIND.SAFE_RELATIVE) return false;
  if (value.includes("\\")) return false;
  if (value === "." || value.startsWith("./")) return false;
  if (value.endsWith("/")) return false;
  if (value.includes("//")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isExcludedPath(canonicalPath) {
  if (canonicalPath === "package.json") return true;
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => canonicalPath.startsWith(prefix))) return true;
  const basename = canonicalPath.slice(canonicalPath.lastIndexOf("/") + 1);
  return ENV_FILE_BASENAME_PATTERN.test(basename);
}

function isInFrameworkScope(canonicalPath, framework) {
  if (canonicalPath === FRAMEWORK_CONFIG_PATH[framework]) return true;
  return canonicalPath.startsWith(FRAMEWORK_SOURCE_PREFIX[framework]);
}

// Resolves `canonicalPath` (already proven safe/in-scope) against
// `realRepoRoot`, requiring the result to exist, be canonically contained
// inside the root (closing a symlink escape via context-utils.js's own
// isCanonicalPathInsideRoot(), reused read-only and parameterized by the
// caller's own repoRoot rather than that module's hardcoded ROOT, so this
// stays testable against an isolated fixture root independent of
// process.cwd()), and be an ordinary regular file. Mirrors
// context-utils.js's resolveSafeLocalAttachmentPath() policy: a repo-local
// symlink whose real target is also repo-local is accepted, but the
// canonical location reported is the TARGET's own real repo-relative path,
// never the symlink's own lexical path - an accepted evidence entry can
// never describe itself via a redirection layer. A missing file, a broken
// symlink, a symlink escaping the root, or a non-regular-file (directory,
// etc.) all fail closed to null; this function itself never throws.
function resolveContainedRegularFile(canonicalPath, repoRoot, realRepoRoot) {
  const lexicalAbs = path.join(repoRoot, canonicalPath);
  const real = resolveRealPathSafe(lexicalAbs);
  if (!real) return null;
  if (!isCanonicalPathInsideRoot({ root: realRepoRoot, candidate: real })) return null;
  let stat;
  try {
    stat = fs.statSync(real);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const canonicalLocation = path.relative(realRepoRoot, real).split(path.sep).join("/");
  return { realPath: real, canonicalLocation };
}

// Rejects likely-binary content without attempting any binary decoding - a
// raw NUL codepoint is never legitimate in real source/config text, the
// same conservative posture scripts/ai/generation/primitives.js's own
// control-character rejection already applies to bounded text fields.
// charCode-based rather than a hex-escape regex, for the same reason as
// hasControlChar() above.
function looksBinary(content) {
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 0) return true;
  }
  return false;
}

function readPackageScripts(repoRoot, errors) {
  const pkgPath = path.join(repoRoot, "package.json");
  let raw;
  try {
    raw = fs.readFileSync(pkgPath, "utf8");
  } catch {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, "package.json could not be read from repoRoot"));
    return null;
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, "package.json could not be parsed as JSON"));
    return null;
  }
  if (!isPlainObject(pkg) || !isPlainObject(pkg.scripts)) {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, "package.json scripts must be an object"));
    return null;
  }

  const names = Object.keys(pkg.scripts);
  if (names.length > LIMITS.MAX_SCRIPT_COUNT) {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, `package.json scripts exceeds the maximum of ${LIMITS.MAX_SCRIPT_COUNT}`));
    return null;
  }

  const scripts = [];
  let aggregate = 0;
  for (const name of names) {
    const command = pkg.scripts[name];
    if (
      typeof command !== "string" ||
      name.length === 0 ||
      name.length > LIMITS.MAX_SCRIPT_NAME_LENGTH ||
      command.length === 0 ||
      command.length > LIMITS.MAX_SCRIPT_COMMAND_LENGTH
    ) {
      errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, "package.json scripts entry exceeds a bounded name/command length"));
      return null;
    }
    aggregate += name.length + command.length;
    scripts.push({ name, command });
  }
  if (aggregate > LIMITS.MAX_AGGREGATE_SCRIPT_TEXT_LENGTH) {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, `package.json scripts aggregate text exceeds the maximum of ${LIMITS.MAX_AGGREGATE_SCRIPT_TEXT_LENGTH}`));
    return null;
  }

  scripts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return scripts;
}

/**
 * Validates and deterministically builds an AutomationRepositoryContext.
 *
 * `input` shape: { repoRoot, projectProfile, framework, relevantFiles }.
 *  - repoRoot: absolute path to the repository root used for containment
 *    (never inferred from process.cwd()).
 *  - projectProfile: validated via scripts/ai/project-profile.js's own
 *    validateProjectProfile() (read-only reuse); only `id` (-> the
 *    context's top-level projectId) and `displayName`/
 *    `knownProjectConstraints` (-> guidance) are ever projected - never the
 *    whole object.
 *  - framework: exactly "cypress" or "playwright".
 *  - relevantFiles: a bounded array of canonical, repo-relative path
 *    strings, selected upstream by deterministic logic - never resolved by
 *    this module itself.
 *
 * Returns { ok: true, context } or { ok: false, errors: [{path,code,
 * message}, ...] } - errors never echo file content, raw paths beyond their
 * own bounded structural position, or a raw package.json/ProjectProfile
 * object.
 */
function buildAutomationRepositoryContext(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "input must be a plain object")] };
  }

  collectUnknownKeyErrors(input, TOP_LEVEL_ALLOWED_KEYS, "$", errors);

  if (typeof input.repoRoot !== "string" || input.repoRoot.length === 0) {
    errors.push(err("$.repoRoot", ERROR_CODES.INVALID_TYPE, "$.repoRoot must be a non-empty string"));
  }

  const profileCheck = isPlainObject(input.projectProfile) ? validateProjectProfile(input.projectProfile) : { valid: false, errors: ["not an object"] };
  if (!profileCheck.valid) {
    errors.push(err("$.projectProfile", ERROR_CODES.INVALID_TYPE, "$.projectProfile must be a valid ProjectProfile"));
  }

  if (!SUPPORTED_FRAMEWORKS.includes(input.framework)) {
    errors.push(err("$.framework", ERROR_CODES.INVALID_ENUM, `$.framework must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
  }

  const framework = SUPPORTED_FRAMEWORKS.includes(input.framework) ? input.framework : null;
  const relevantFiles = input.relevantFiles;
  const acceptedRelevantPaths = [];

  if (!Array.isArray(relevantFiles)) {
    errors.push(err("$.relevantFiles", ERROR_CODES.MISSING_FIELD, "$.relevantFiles must be an array"));
  } else if (relevantFiles.length > LIMITS.MAX_RELEVANT_FILES) {
    errors.push(err("$.relevantFiles", ERROR_CODES.INVALID_VALUE, `$.relevantFiles exceeds the maximum of ${LIMITS.MAX_RELEVANT_FILES}`));
  } else if (framework) {
    const seen = new Set();
    relevantFiles.forEach((rawPath, i) => {
      const itemPath = `$.relevantFiles[${i}]`;
      if (!isSafeCanonicalRelativePath(rawPath)) {
        errors.push(err(itemPath, ERROR_CODES.INVALID_PATH, `${itemPath} must be a canonical, safe, repository-relative path`));
        return;
      }
      if (rawPath === FRAMEWORK_CONFIG_PATH[framework]) {
        errors.push(err(itemPath, ERROR_CODES.DUPLICATE_ID, `${itemPath} duplicates the automatically-included framework config`));
        return;
      }
      if (isExcludedPath(rawPath)) {
        errors.push(err(itemPath, ERROR_CODES.INVALID_PATH, `${itemPath} is not an allowed relevant-file path`));
        return;
      }
      if (!isInFrameworkScope(rawPath, framework)) {
        errors.push(err(itemPath, ERROR_CODES.INVALID_PATH, `${itemPath} is outside the ${framework} framework's allowed source scope`));
        return;
      }
      if (seen.has(rawPath)) {
        errors.push(err(itemPath, ERROR_CODES.DUPLICATE_ID, `${itemPath} duplicates another relevantFiles entry`));
        return;
      }
      seen.add(rawPath);
      acceptedRelevantPaths.push(rawPath);
    });
  }

  const packageScripts = errors.length === 0 ? readPackageScripts(input.repoRoot, errors) : null;

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const realRepoRoot = resolveRealPathSafe(input.repoRoot);
  if (!realRepoRoot) {
    return { ok: false, errors: [err("$.repoRoot", ERROR_CODES.INVALID_VALUE, "$.repoRoot does not resolve to an existing directory")] };
  }

  const sortedRelevantPaths = [...acceptedRelevantPaths].sort();

  const evidenceTargets = [
    { canonicalPath: FRAMEWORK_CONFIG_PATH[framework], role: ROLE_FRAMEWORK_CONFIG },
    ...sortedRelevantPaths.map((p) => ({ canonicalPath: p, role: ROLE_RELEVANT_FILE })),
  ];

  const repositoryEvidence = [];
  for (let i = 0; i < evidenceTargets.length; i++) {
    const { canonicalPath, role } = evidenceTargets[i];
    const resolved = resolveContainedRegularFile(canonicalPath, input.repoRoot, realRepoRoot);
    if (!resolved) {
      errors.push(
        err(
          `$.repositoryEvidence[${i}]`,
          ERROR_CODES.INVALID_REFERENCE,
          `${role === ROLE_FRAMEWORK_CONFIG ? "framework config" : "relevant file"} does not resolve to an existing, contained, regular file`
        )
      );
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(resolved.realPath, "utf8");
    } catch {
      errors.push(err(`$.repositoryEvidence[${i}]`, ERROR_CODES.INVALID_REFERENCE, "evidence file could not be read"));
      continue;
    }
    if (looksBinary(content)) {
      errors.push(err(`$.repositoryEvidence[${i}]`, ERROR_CODES.INVALID_VALUE, "evidence file content must be text, not binary"));
      continue;
    }
    if (!isBoundedText(content, LIMITS.MAX_FILE_CONTENT_LENGTH)) {
      errors.push(err(`$.repositoryEvidence[${i}]`, ERROR_CODES.INVALID_VALUE, `evidence file content exceeds the maximum of ${LIMITS.MAX_FILE_CONTENT_LENGTH} characters`));
      continue;
    }

    const ordinal = formatOrdinal(i + 1);
    const evidenceRef = { id: `repo-evidence-${ordinal}`, kind: EVIDENCE_KIND_REPOSITORY, location: resolved.canonicalLocation };
    repositoryEvidence.push({ evidenceRef, role, content });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const aggregateLength = repositoryEvidence.reduce((sum, item) => sum + item.content.length, 0);
  if (aggregateLength > LIMITS.MAX_AGGREGATE_EVIDENCE_LENGTH) {
    return {
      ok: false,
      errors: [err("$.repositoryEvidence", ERROR_CODES.INVALID_VALUE, `repositoryEvidence aggregate content exceeds the maximum of ${LIMITS.MAX_AGGREGATE_EVIDENCE_LENGTH} characters`)],
    };
  }

  const context = deepFreeze({
    projectId: input.projectProfile.id,
    framework,
    guidance: {
      displayName: input.projectProfile.displayName,
      knownProjectConstraints: input.projectProfile.knownProjectConstraints,
    },
    packageScripts,
    repositoryEvidence,
  });

  return { ok: true, context };
}

module.exports = {
  buildAutomationRepositoryContext,
  LIMITS,
  SUPPORTED_FRAMEWORKS,
  EVIDENCE_KIND_REPOSITORY,
  ROLE_FRAMEWORK_CONFIG,
  ROLE_RELEVANT_FILE,
};
