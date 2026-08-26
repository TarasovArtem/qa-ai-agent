/**
 * Deterministic automation repository context (Roadmap #23B, hardened in
 * #23B-C1).
 *
 * First real #23 AI Test Automation component. This module does NOT
 * generate an AutomationPlan and does NOT call a provider - it takes
 * project identity, canonical framework identity, and a bounded,
 * caller-supplied list of relevant repository file paths, and
 * deterministically assembles a small internal AutomationRepositoryContext:
 * the framework's own config file plus each accepted relevant file, read
 * read-only and bounded, alongside a positive projection of package.json's
 * planning-relevant scripts and ProjectProfile's guidance fields.
 *
 * This is NOT a replacement for or addition to the frozen v1
 * AutomationCandidate/AutomationPlan contracts (scripts/ai/generation/**) -
 * it is a separate, #23-owned, unversioned internal projection. Nothing
 * here is placed under scripts/ai/generation/, and nothing here is claimed
 * to be frozen.
 *
 * #23B-C1 TRUST-BOUNDARY HARDENING: an independent adversarial review
 * (#23B-R) found that the original implementation validated a requested
 * relevantFiles path's framework scope only LEXICALLY, before symlink
 * resolution - the resolved PHYSICAL target was never re-checked. This let
 * a symlink alias inside cypress/** resolve to a physical file inside
 * playwright/** (and vice versa), let two aliases to one physical file
 * produce duplicate evidence, and let an alias duplicate the auto-included
 * framework config. It also found an overly narrow sensitive-path
 * exclusion (dotenv-only - SSH keys, credential/secrets files, and
 * Playwright auth/storage-state files all passed through), an
 * all-scripts package projection (unrelated deploy/publish/admin commands
 * leaked), and unbounded reads (both package.json and evidence files were
 * fully buffered into memory before any size check). This revision closes
 * all of those:
 *
 *   requested lexical path
 *     -> lexical validation
 *     -> lexical framework/exclusion check (cheap early rejection)
 *     -> realpath resolution
 *     -> repo-root containment
 *     -> regular-file check (single stat, reused for size)
 *     -> RESOLVED canonical repository location
 *     -> resolved framework scope check
 *     -> resolved sensitive/runtime-artifact exclusion check
 *     -> physical/canonical identity duplicate check
 *     -> pre-read byte-size bound (stat, before any read)
 *     -> read content
 *     -> post-read semantic bounds (binary, character length)
 *     -> evidence construction
 *
 * Repository-root containment alone is NEVER treated as equivalent to
 * framework-scope containment: both the lexical request and the resolved
 * physical target must independently satisfy framework scope.
 *
 * DATA BOUNDARY: repository file content is DATA, never instructions -
 * this module performs no semantic interpretation of it. Sensitive-path
 * policy takes precedence over content: a sensitive file is rejected
 * regardless of how benign its content looks.
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
// added to scripts/ai/generation/limits.js. Calibrated against this
// repository's real current sizes: today's package.json is 2105 bytes with
// 20 scripts (258-char longest command, 1278-char aggregate); framework
// config/spec/page-object files inspected during reconnaissance are all
// under ~3600 bytes.
//
// #23B-C1: MAX_FILE_BYTES and MAX_PACKAGE_JSON_BYTES are NEW pre-read byte
// bounds, deliberately distinct from the existing post-decode
// MAX_FILE_CONTENT_LENGTH character bound - a byte bound (checked via
// fs.statSync, before any read) protects against buffering a large file
// into memory at all; the character bound (checked after decoding)
// protects the semantic size of what a future provider prompt would
// receive. MAX_FILE_BYTES is set well above MAX_FILE_CONTENT_LENGTH (4x)
// to leave headroom for legitimate multi-byte UTF-8 content without ever
// assuming bytes === JS string length. MAX_PACKAGE_JSON_BYTES is generous
// for any realistic package.json (this repository's real one is ~2KB)
// while still being a real, finite bound instead of no bound at all.
const LIMITS = Object.freeze({
  MAX_RELEVANT_FILES: 20,
  MAX_FILE_BYTES: 32000,
  MAX_FILE_CONTENT_LENGTH: 8000,
  MAX_AGGREGATE_EVIDENCE_LENGTH: 40000,
  MAX_PACKAGE_JSON_BYTES: 65536,
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
// playwright/** path and vice versa - and, as of #23B-C1, this is enforced
// against the RESOLVED physical location, not only the lexically-requested
// one (see isInFrameworkScope() and its two call sites below).
const FRAMEWORK_SOURCE_PREFIX = Object.freeze({
  cypress: "cypress/",
  playwright: "playwright/",
});

// Runtime-artifact subdirectories that would otherwise lexically (and,
// after a symlink, physically) fall inside an allowed framework source
// tree. cypress/screenshots is this repository's actual runtime output
// directory; videos/downloads are Cypress's other conventional
// runtime-output subdirectories. The playwright/* entries are defensive:
// this repository's own playwright.config.js currently keeps
// reports/test-results outside playwright/**, but a context builder must
// not depend solely on today's outputDir placement - a future
// reconfiguration or a different project reusing this module could put
// them inside the allowed tree. A narrow, named exclusion list - not a
// generic artifact/secret scanner, and not a whole-repository scan.
const EXCLUDED_PATH_PREFIXES = Object.freeze([
  "cypress/screenshots/",
  "cypress/videos/",
  "cypress/downloads/",
  "playwright/test-results/",
  "playwright/playwright-report/",
  "playwright/blob-report/",
  "playwright/traces/",
]);

// #23B-C1: targeted sensitive-file policy - NOT generic DLP/content
// scanning, a deterministic deny list of specific basenames/extensions/path
// segments that must never become future provider-bound repository
// context, applied to BOTH the lexically-requested path (cheap early
// rejection) and the RESOLVED physical location (defense against a
// benign-looking alias resolving to a sensitive physical file).
const ENV_FILE_BASENAME_PATTERN = /^\.env(\..+)?$/;
const SENSITIVE_EXTENSION_PATTERN = /\.(pem|key)$/;
const SENSITIVE_EXACT_BASENAMES = new Set([
  ".npmrc",
  ".netrc",
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "credentials.yml",
  "credentials.yaml",
  "secrets.json",
  "secrets.yml",
  "secrets.yaml",
  // Playwright's own conventional authentication/session-state file names
  // (both the camelCase and kebab-case spellings Playwright's own docs and
  // ecosystem tooling use) - these commonly contain live cookies/tokens
  // and must never become provider-bound evidence merely because they sit
  // inside playwright/**.
  "storageState.json",
  "storage-state.json",
]);

function isSensitivePath(canonicalPath) {
  const segments = canonicalPath.split("/");
  const basename = segments[segments.length - 1];
  if (ENV_FILE_BASENAME_PATTERN.test(basename)) return true;
  if (SENSITIVE_EXACT_BASENAMES.has(basename)) return true;
  if (SENSITIVE_EXTENSION_PATTERN.test(basename)) return true;
  // Covers playwright/.auth/** and playwright/**/.auth/** alike - any path
  // with a ".auth" directory segment anywhere, not just directly under
  // playwright/.
  if (segments.includes(".auth")) return true;
  return false;
}

function isExcludedPath(canonicalPath) {
  if (canonicalPath === "package.json") return true;
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => canonicalPath.startsWith(prefix))) return true;
  return isSensitivePath(canonicalPath);
}

function isInFrameworkScope(canonicalPath, framework) {
  if (canonicalPath === FRAMEWORK_CONFIG_PATH[framework]) return true;
  return canonicalPath.startsWith(FRAMEWORK_SOURCE_PREFIX[framework]);
}

// #23B-C1: deterministic, name-based, framework-aware planning-relevance
// policy for package.json scripts - the correction for the original
// all-scripts projection defect. Deliberately NOT a content/command scan
// (the mission's own explicit guidance: unrelated command bodies, e.g. a
// "deploy" script, must never be included merely because bounded, and a
// script must never be included merely because its COMMAND happens to
// mention a framework word - only its NAME is examined). Verified against
// this repository's actual package.json script names (cypress:open,
// test:e2e, chrome, firefox, edge, test:e2e:playwright, plus this
// project's own ai:*/eval:*/test:unit tooling scripts, which contain
// neither a shared nor a framework-specific keyword segment and are
// therefore excluded exactly like deploy/publish/internal-admin would be).
// Script names in this repository (and standard npm convention) use ":" as
// a namespace separator; a name is planning-relevant when at least one of
// its colon-delimited segments matches a shared test-execution keyword, or
// a keyword specific to the framework this context is being built for -
// and never relevant when a segment names the OTHER framework specifically
// (so a Cypress context never sees "test:e2e:playwright", and a Playwright
// context never sees "cypress:open"/"chrome"/"firefox"/"edge").
const SHARED_PLANNING_KEYWORDS = Object.freeze(["test", "e2e"]);
const FRAMEWORK_SPECIFIC_KEYWORDS = Object.freeze({
  cypress: ["cypress", "chrome", "firefox", "edge"],
  playwright: ["playwright"],
});

function isPlanningRelevantScriptName(name, framework) {
  const segments = name.split(":");
  const otherFramework = framework === "cypress" ? "playwright" : "cypress";
  const otherFrameworkKeywords = FRAMEWORK_SPECIFIC_KEYWORDS[otherFramework];
  if (segments.some((segment) => otherFrameworkKeywords.includes(segment))) return false;
  const ownKeywords = FRAMEWORK_SPECIFIC_KEYWORDS[framework];
  return segments.some((segment) => SHARED_PLANNING_KEYWORDS.includes(segment) || ownKeywords.includes(segment));
}

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

// #23B-C1 (Phase 19): scripts/ai/generation/primitives.js's isPlainObject()
// is deliberately permissive (typeof === "object" && !Array.isArray()) -
// verified directly, not assumed from any prior report's wording - and so
// it also accepts a Date, Map, Set, an arbitrary class instance, or an
// Object.create(null) record. That permissiveness is appropriate for F0's
// own contracts (which validate every field explicitly regardless of
// prototype). This module's own top-level input, and its projectProfile
// field, are meant to be plain JSON-like records, not arbitrary class
// instances - so this local, #23-owned, stricter check is used at those
// two boundaries instead. It rejects anything whose prototype isn't
// exactly Object.prototype or null, while still accepting an ordinary {}
// literal or an Object.create(null) record. Frozen F0's own isPlainObject()
// is left untouched and is still reused as-is for the (always
// JSON.parse-produced, therefore always plain) parsed package.json shape.
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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

// charCode-based rather than a hex-escape regex - deliberately avoids any
// literal control-character escape sequence in this source file's own text
// (an earlier revision of this file was accidentally corrupted by a raw
// NUL byte entering via such an escape sequence during authoring tooling;
// this style avoids that risk entirely).
function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

// Resolves `canonicalPath` (already proven lexically safe/in-scope)
// against `realRepoRoot`, requiring the result to exist, be canonically
// contained inside the root (closing a symlink escape via context-utils
// .js's own isCanonicalPathInsideRoot(), reused read-only and
// parameterized by the caller's own repoRoot rather than that module's
// hardcoded ROOT, so this stays testable against an isolated fixture root
// independent of process.cwd()), and be an ordinary regular file. Mirrors
// context-utils.js's resolveSafeLocalAttachmentPath() policy: a repo-local
// symlink whose real target is also repo-local is accepted, but the
// canonical location reported is the TARGET's own real repo-relative path,
// never the symlink's own lexical path - an accepted evidence entry can
// never describe itself via a redirection layer. A missing file, a broken
// symlink, a symlink escaping the root, or a non-regular-file (directory,
// etc.) all fail closed to null; this function itself never throws. The
// single fs.statSync() call performed here also supplies `size`, reused by
// the caller for the pre-read byte-size bound - never a second, redundant
// stat.
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
  return { realPath: real, canonicalLocation, size: stat.size };
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

// #23B-C1: package.json is now stat'd (pre-read byte bound) before it is
// ever read, and its scripts are filtered to only the planning-relevant
// subset (per isPlanningRelevantScriptName()) BEFORE the count/name/
// command/aggregate bounds are applied - an unrelated script is simply
// never examined, rather than being bounds-checked and then discarded.
function readPackageScripts(repoRoot, framework, errors) {
  const pkgPath = path.join(repoRoot, "package.json");

  let stat;
  try {
    stat = fs.statSync(pkgPath);
  } catch {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, "package.json could not be read from repoRoot"));
    return null;
  }
  if (!stat.isFile()) {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, "package.json could not be read from repoRoot"));
    return null;
  }
  if (stat.size > LIMITS.MAX_PACKAGE_JSON_BYTES) {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, `package.json exceeds the maximum of ${LIMITS.MAX_PACKAGE_JSON_BYTES} bytes`));
    return null;
  }

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

  const relevantNames = Object.keys(pkg.scripts).filter((name) => isPlanningRelevantScriptName(name, framework));
  if (relevantNames.length > LIMITS.MAX_SCRIPT_COUNT) {
    errors.push(err("$.packageScripts", ERROR_CODES.INVALID_VALUE, `package.json scripts exceeds the maximum of ${LIMITS.MAX_SCRIPT_COUNT}`));
    return null;
  }

  const scripts = [];
  let aggregate = 0;
  for (const name of relevantNames) {
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
 *    (never inferred from process.cwd()). A trusted orchestration
 *    parameter - supplied by the calling pipeline, never derivable from
 *    provider/model output anywhere in this module.
 *  - projectProfile: validated via scripts/ai/project-profile.js's own
 *    validateProjectProfile() (read-only reuse); only `id` (-> the
 *    context's top-level projectId) and `displayName`/
 *    `knownProjectConstraints` (-> guidance, defensively copied - see
 *    Phase 18) are ever projected - never the whole object.
 *  - framework: exactly "cypress" or "playwright".
 *  - relevantFiles: a bounded array of canonical, repo-relative path
 *    strings, selected upstream by deterministic logic - never resolved by
 *    this module itself.
 *
 * Returns { ok: true, context } or { ok: false, errors: [{path,code,
 * message}, ...] } - errors never echo file content, resolved absolute
 * paths, script command text, or a raw package.json/ProjectProfile object.
 */
function buildAutomationRepositoryContext(input) {
  const errors = [];

  if (!isPlainRecord(input)) {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "input must be a plain object")] };
  }

  collectUnknownKeyErrors(input, TOP_LEVEL_ALLOWED_KEYS, "$", errors);

  if (typeof input.repoRoot !== "string" || input.repoRoot.length === 0) {
    errors.push(err("$.repoRoot", ERROR_CODES.INVALID_TYPE, "$.repoRoot must be a non-empty string"));
  }

  const profileCheck = isPlainRecord(input.projectProfile) ? validateProjectProfile(input.projectProfile) : { valid: false, errors: ["not an object"] };
  if (!profileCheck.valid) {
    errors.push(err("$.projectProfile", ERROR_CODES.INVALID_TYPE, "$.projectProfile must be a valid ProjectProfile"));
  }

  if (!SUPPORTED_FRAMEWORKS.includes(input.framework)) {
    errors.push(err("$.framework", ERROR_CODES.INVALID_ENUM, `$.framework must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
  }

  // relevantFiles shape/lexical-path validation only makes sense once
  // `framework` is itself one of the two known values.
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

  const packageScripts = errors.length === 0 ? readPackageScripts(input.repoRoot, framework, errors) : null;

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const realRepoRoot = resolveRealPathSafe(input.repoRoot);
  if (!realRepoRoot) {
    return { ok: false, errors: [err("$.repoRoot", ERROR_CODES.INVALID_VALUE, "$.repoRoot does not resolve to an existing directory")] };
  }

  // Sorted lexicographically (deterministic order) - caller order must
  // never affect the final context. The framework config always occupies
  // the first evidence ordinal, deterministically, regardless of how it
  // would sort against the caller-selected paths - it is a single fixed,
  // always-present item, never part of the variable caller-selected set.
  const sortedRelevantPaths = [...acceptedRelevantPaths].sort();

  const evidenceTargets = [
    { canonicalPath: FRAMEWORK_CONFIG_PATH[framework], role: ROLE_FRAMEWORK_CONFIG },
    ...sortedRelevantPaths.map((p) => ({ canonicalPath: p, role: ROLE_RELEVANT_FILE })),
  ];

  // #23B-C1: the resolved-identity registry. The framework config's own
  // resolved physical location is inserted first (Phase 7) - a relevant
  // file whose RESOLVED target physically collides with it, regardless of
  // how different their lexical spellings are, is rejected exactly like
  // any other physical duplicate.
  const acceptedResolvedLocations = new Set();
  const repositoryEvidence = [];

  for (let i = 0; i < evidenceTargets.length; i++) {
    const { canonicalPath, role } = evidenceTargets[i];
    const itemPath = `$.repositoryEvidence[${i}]`;
    const kindLabel = role === ROLE_FRAMEWORK_CONFIG ? "framework config" : "relevant file";

    const resolved = resolveContainedRegularFile(canonicalPath, input.repoRoot, realRepoRoot);
    if (!resolved) {
      errors.push(err(itemPath, ERROR_CODES.INVALID_REFERENCE, `${kindLabel} does not resolve to an existing, contained, regular file`));
      continue;
    }

    // #23B-C1 (Phase 4/5): the RESOLVED physical location must itself
    // satisfy framework scope - repo-root containment alone (already
    // proven above) is never treated as sufficient. This is what rejects a
    // cypress/** lexical alias that resolves to a playwright/** physical
    // file, and the reverse, and (for the config entry) a config symlink
    // resolving outside its own framework's scope.
    if (!isInFrameworkScope(resolved.canonicalLocation, framework)) {
      errors.push(err(itemPath, ERROR_CODES.INVALID_PATH, `${kindLabel} resolves outside the ${framework} framework's allowed source scope`));
      continue;
    }

    // #23B-C1 (Phase 8): sensitive/runtime-artifact exclusion re-applied to
    // the RESOLVED location - closes the case where a benign-looking alias
    // resolves to a sensitive or runtime-artifact physical file within the
    // same framework's own scope.
    if (isExcludedPath(resolved.canonicalLocation)) {
      errors.push(err(itemPath, ERROR_CODES.INVALID_PATH, `${kindLabel} resolves to a path that is not allowed as repository evidence`));
      continue;
    }

    // #23B-C1 (Phase 6/7): physical/canonical identity duplicate check -
    // never accept two evidence entries for the same resolved physical
    // file, regardless of how many differently-spelled lexical aliases
    // were used to reach it. Checked BEFORE any read, so a duplicate is
    // never even stat'd/read a second time.
    if (acceptedResolvedLocations.has(resolved.canonicalLocation)) {
      errors.push(err(itemPath, ERROR_CODES.DUPLICATE_ID, `${kindLabel} resolves to a physical file already represented by another evidence entry`));
      continue;
    }

    // #23B-C1 (Phase 14/15): pre-read byte-size bound, checked against the
    // stat already performed inside resolveContainedRegularFile() - no
    // second stat, and critically, no readFileSync call at all for an
    // oversized file.
    if (resolved.size > LIMITS.MAX_FILE_BYTES) {
      errors.push(err(itemPath, ERROR_CODES.INVALID_VALUE, `${kindLabel} exceeds the maximum of ${LIMITS.MAX_FILE_BYTES} bytes`));
      continue;
    }

    acceptedResolvedLocations.add(resolved.canonicalLocation);

    let content;
    try {
      content = fs.readFileSync(resolved.realPath, "utf8");
    } catch {
      errors.push(err(itemPath, ERROR_CODES.INVALID_REFERENCE, "evidence file could not be read"));
      continue;
    }
    if (looksBinary(content)) {
      errors.push(err(itemPath, ERROR_CODES.INVALID_VALUE, "evidence file content must be text, not binary"));
      continue;
    }
    if (!isBoundedText(content, LIMITS.MAX_FILE_CONTENT_LENGTH)) {
      errors.push(err(itemPath, ERROR_CODES.INVALID_VALUE, `evidence file content exceeds the maximum of ${LIMITS.MAX_FILE_CONTENT_LENGTH} characters`));
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
      // #23B-C1 (Phase 18): a shallow copy, never the caller's own array
      // reference - deepFreeze() below must never reach back and freeze
      // data the caller still owns and may need to mutate after this call
      // returns.
      knownProjectConstraints: [...input.projectProfile.knownProjectConstraints],
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
  isPlanningRelevantScriptName,
};
