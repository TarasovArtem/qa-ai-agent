/**
 * qa-agent.config.json v1 - the one target-owned, non-executable,
 * declarative configuration file of the Controlled-v1 CLI
 * (docs/controlled-v1-productization-contract-v1.md §11).
 *
 * Read hardening (mission §8): the file is opened ONCE and read through that
 * descriptor with a hard bound of MAX_CONFIG_BYTES + 1 bytes; the exact bytes
 * read are the bytes parsed. There is no stat-for-size-then-read-by-path
 * sequence. A symlinked leaf is refused (deterministic rule, independent of
 * O_NOFOLLOW availability), the canonical location must stay inside the
 * repository root, and the descriptor's identity must equal the lstat'ed
 * leaf, so a swap between the checks and the open is refused. A BOM is
 * refused (never stripped), invalid UTF-8 is refused, and duplicate keys are
 * refused by the strict parser.
 *
 * Validation returns a detached, deeply frozen snapshot. Every later step -
 * including child stage processes, which receive validated values and never
 * re-read this file - uses only that snapshot.
 *
 * Config schema validity is separate from runtime capability authorization:
 * a known capability that the installed release does not enable (e.g.
 * `apply`) is schema-valid here and refused only when invoked (policy.js).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { assertValidProjectProfile } = require("../project-profile");
const { assertValidFrameworkRuntimeConfig } = require("../framework-runtime-config");
const { assertValidProjectKnowledgeConfig } = require("../project-knowledge-config");
const { isCanonicalPathInsideRoot } = require("../context-utils");
const { configError } = require("./errors");
const { parseStrictJson } = require("./strict-json");
const { isSafeRelativePath, pathsOverlap, toPosixRelative } = require("./paths");

const CONFIG_FILE_NAME = "qa-agent.config.json";
const CONFIG_SCHEMA_VERSION = 1;
const MAX_CONFIG_BYTES = 64 * 1024;

const SUPPORTED_FRAMEWORKS = Object.freeze(["cypress", "playwright"]);
const KNOWN_PROVIDERS = Object.freeze(["mock", "groq", "gemini"]);
const CAPABILITY_KEYS = Object.freeze(["triage", "design", "plan", "generate", "reviewRecord", "apply", "execute"]);
const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "projectProfile",
  "framework",
  "frameworkRuntime",
  "knowledge",
  "requirements",
  "capabilities",
  "providers",
  "output",
]);
const REQUIRED_TOP_LEVEL_KEYS = Object.freeze(["schemaVersion", "projectProfile", "framework"]);
const DEFAULT_PROVIDERS_ALLOW = Object.freeze(["mock"]);
const DEFAULT_OUTPUT_DIR = "reports/qa-agent";

// output.dir must never overlap repository metadata, installed dependencies
// or test-automation source (product-owned, not target-editable).
const PROTECTED_OUTPUT_PREFIXES = Object.freeze([".git", "node_modules", "cypress", "playwright"]);

const UTF8 = new TextDecoder("utf-8", { fatal: true });

// --- read (open once, bounded) ---------------------------------------------------

function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function insideRoot(root, candidate) {
  return isCanonicalPathInsideRoot({ root: root.lexicalRoot, candidate }) || isCanonicalPathInsideRoot({ root: root.realRoot, candidate });
}

function relativeForDisplay(root, lexical) {
  const base = isCanonicalPathInsideRoot({ root: root.lexicalRoot, candidate: lexical }) ? root.lexicalRoot : root.realRoot;
  return toPosixRelative(base, lexical);
}

function readConfigText({ root, configPath } = {}) {
  const requested = configPath === undefined ? CONFIG_FILE_NAME : configPath;
  if (typeof requested !== "string" || requested.length === 0 || requested.length > 1024 || hasControlChar(requested)) {
    throw configError("CONFIG_PATH_INVALID", "the configuration path is not a valid path string.");
  }

  const lexical = path.resolve(root.lexicalRoot, requested);
  if (!insideRoot(root, lexical) || lexical === root.lexicalRoot || lexical === root.realRoot) {
    throw configError("CONFIG_OUTSIDE_ROOT", "the configuration file must be inside the repository root.");
  }

  let leaf;
  try {
    leaf = fs.lstatSync(lexical, { bigint: true });
  } catch {
    throw configError("CONFIG_NOT_FOUND", `no configuration file found at ${relativeForDisplay(root, lexical)}.`);
  }
  if (leaf.isSymbolicLink()) {
    throw configError("CONFIG_SYMLINK_REFUSED", "the configuration file must be a regular file, not a symbolic link.");
  }
  if (!leaf.isFile()) {
    throw configError("CONFIG_NOT_REGULAR_FILE", "the configuration path does not name a regular file.");
  }

  let real;
  try {
    real = fs.realpathSync(lexical);
  } catch {
    throw configError("CONFIG_NOT_FOUND", "the configuration file could not be resolved.");
  }
  if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) {
    throw configError("CONFIG_OUTSIDE_ROOT", "the configuration file resolves outside the repository root.");
  }

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd;
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | noFollow);
  } catch (err) {
    if (err && err.code === "ELOOP") {
      throw configError("CONFIG_SYMLINK_REFUSED", "the configuration file must be a regular file, not a symbolic link.");
    }
    throw configError("CONFIG_UNREADABLE", "the configuration file could not be opened.");
  }

  let total = 0;
  const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile()) {
      throw configError("CONFIG_NOT_REGULAR_FILE", "the configuration path does not name a regular file.");
    }
    if (opened.dev !== leaf.dev || opened.ino !== leaf.ino) {
      throw configError("CONFIG_CHANGED_DURING_READ", "the configuration file changed while it was being opened.");
    }
    while (total < buffer.length) {
      const n = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (n === 0) break;
      total += n;
    }
  } catch (err) {
    if (err && err.name === "CliError") throw err;
    throw configError("CONFIG_UNREADABLE", "the configuration file could not be read.");
  } finally {
    fs.closeSync(fd);
  }

  if (total > MAX_CONFIG_BYTES) {
    throw configError("CONFIG_TOO_LARGE", `the configuration file exceeds the maximum of ${MAX_CONFIG_BYTES} bytes.`);
  }
  const bytes = buffer.subarray(0, total);
  if (
    (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)))
  ) {
    throw configError("CONFIG_BOM_REFUSED", "the configuration file must be UTF-8 without a byte-order mark.");
  }

  let text;
  try {
    text = UTF8.decode(bytes);
  } catch {
    throw configError("CONFIG_ENCODING_INVALID", "the configuration file is not valid UTF-8.");
  }
  return { text, configRelPath: relativeForDisplay(root, lexical) };
}

function parseConfigText(text) {
  return parseStrictJson(text);
}

// --- validation -------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function safeKey(key) {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(key) ? `"${key}"` : "<unprintable key>";
}

function expectClosedObject(value, label, allowed) {
  if (!isPlainObject(value)) throw configError("CONFIG_SCHEMA_INVALID", `${label} must be a JSON object.`);
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    const shown = unknown.slice(0, 4).map(safeKey).join(", ");
    throw configError("CONFIG_SCHEMA_INVALID", `${label} contains unknown key(s): ${shown}${unknown.length > 4 ? ", ..." : ""}.`);
  }
}

function embedded(label, fn) {
  try {
    return fn();
  } catch (err) {
    throw configError("CONFIG_EMBEDDED_CONTRACT_INVALID", `${label}: ${(err && err.message) || "invalid"}`);
  }
}

// Detached deep copy of validated plain JSON data, frozen at every level.
function freezeCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = freezeCopy(value[key]);
    return Object.freeze(out);
  }
  return value;
}

function validateRequirements(value) {
  expectClosedObject(value, "requirements", ["source", "path"]);
  if (value.source !== "file") throw configError("CONFIG_SCHEMA_INVALID", 'requirements.source must be "file" (the only v1 source).');
  if (!isSafeRelativePath(value.path) || !value.path.toLowerCase().endsWith(".json")) {
    throw configError("CONFIG_PATH_INVALID", "requirements.path must be a safe repository-relative POSIX path to a .json file.");
  }
  return { source: "file", path: value.path };
}

function validateCapabilities(value) {
  const out = {};
  for (const key of CAPABILITY_KEYS) out[key] = false;
  if (value === undefined) return out;
  expectClosedObject(value, "capabilities", CAPABILITY_KEYS);
  for (const key of Object.keys(value)) {
    if (typeof value[key] !== "boolean") throw configError("CONFIG_SCHEMA_INVALID", `capabilities.${key} must be a boolean.`);
    out[key] = value[key];
  }
  return out;
}

function validateProviders(value) {
  if (value === undefined) return { allow: [...DEFAULT_PROVIDERS_ALLOW] };
  expectClosedObject(value, "providers", ["allow"]);
  const allow = value.allow;
  if (!Array.isArray(allow) || allow.length > KNOWN_PROVIDERS.length) {
    throw configError("CONFIG_SCHEMA_INVALID", `providers.allow must be an array of at most ${KNOWN_PROVIDERS.length} provider names.`);
  }
  const seen = new Set();
  for (const name of allow) {
    if (typeof name !== "string" || !KNOWN_PROVIDERS.includes(name)) {
      throw configError("CONFIG_SCHEMA_INVALID", `providers.allow entries must be one of: ${KNOWN_PROVIDERS.join(", ")}.`);
    }
    if (seen.has(name)) throw configError("CONFIG_SCHEMA_INVALID", "providers.allow must not contain duplicates.");
    seen.add(name);
  }
  return { allow: [...allow] };
}

function validateOutput(value, { configRelPath, testSourceRoot }) {
  let dir = DEFAULT_OUTPUT_DIR;
  if (value !== undefined) {
    expectClosedObject(value, "output", ["dir"]);
    dir = value.dir;
  }
  if (!isSafeRelativePath(dir)) {
    throw configError("CONFIG_PATH_INVALID", "output.dir must be a safe repository-relative POSIX directory path.");
  }
  const protectedPaths = [...PROTECTED_OUTPUT_PREFIXES];
  if (testSourceRoot) protectedPaths.push(testSourceRoot);
  if (configRelPath) protectedPaths.push(configRelPath);
  for (const protectedPath of protectedPaths) {
    if (pathsOverlap(dir, protectedPath)) {
      throw configError("CONFIG_PATH_INVALID", "output.dir must not overlap .git, node_modules, framework source directories or the configuration file.");
    }
  }
  return { dir };
}

function validateConfig(parsed, { configRelPath } = {}) {
  if (!isPlainObject(parsed)) throw configError("CONFIG_SCHEMA_INVALID", "the configuration must be a JSON object.");
  expectClosedObject(parsed, "configuration", TOP_LEVEL_KEYS);
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) throw configError("CONFIG_SCHEMA_INVALID", `configuration is missing required key "${key}".`);
  }
  if (parsed.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw configError("CONFIG_SCHEMA_INVALID", `schemaVersion must be exactly the integer ${CONFIG_SCHEMA_VERSION}.`);
  }
  if (!SUPPORTED_FRAMEWORKS.includes(parsed.framework)) {
    throw configError("CONFIG_SCHEMA_INVALID", `framework must be one of: ${SUPPORTED_FRAMEWORKS.join(", ")}.`);
  }

  const projectProfile = embedded("projectProfile", () => assertValidProjectProfile(parsed.projectProfile, "qa-agent.config.json"));

  let frameworkRuntime = null;
  if (parsed.frameworkRuntime !== undefined) {
    embedded("frameworkRuntime", () => assertValidFrameworkRuntimeConfig(parsed.frameworkRuntime, "qa-agent.config.json"));
    if (parsed.frameworkRuntime.projectId !== projectProfile.id) {
      throw configError("CONFIG_SEMANTIC_INVALID", "frameworkRuntime.projectId must equal projectProfile.id.");
    }
    if (parsed.frameworkRuntime.framework !== parsed.framework) {
      throw configError("CONFIG_SEMANTIC_INVALID", "frameworkRuntime.framework must equal framework (config framework is the sole framework authority).");
    }
    frameworkRuntime = parsed.frameworkRuntime;
  }

  let knowledge = null;
  if (parsed.knowledge !== undefined) {
    embedded("knowledge", () => assertValidProjectKnowledgeConfig(parsed.knowledge, "qa-agent.config.json"));
    if (parsed.knowledge.projectId !== projectProfile.id) {
      throw configError("CONFIG_SEMANTIC_INVALID", "knowledge.projectId must equal projectProfile.id.");
    }
    knowledge = parsed.knowledge;
  }

  const requirements = parsed.requirements === undefined ? null : validateRequirements(parsed.requirements);
  const capabilities = validateCapabilities(parsed.capabilities);
  const providers = validateProviders(parsed.providers);
  const output = validateOutput(parsed.output, { configRelPath, testSourceRoot: frameworkRuntime && frameworkRuntime.testSourceRoot });

  return freezeCopy({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    projectProfile: {
      id: projectProfile.id,
      displayName: projectProfile.displayName,
      knownProjectConstraints: [...projectProfile.knownProjectConstraints],
    },
    framework: parsed.framework,
    frameworkRuntime,
    knowledge,
    requirements,
    capabilities,
    providers,
    output,
  });
}

function loadConfig({ root, configPath } = {}) {
  const { text, configRelPath } = readConfigText({ root, configPath });
  const config = validateConfig(parseConfigText(text), { configRelPath });
  return { config, configRelPath };
}

module.exports = {
  CONFIG_FILE_NAME,
  CONFIG_SCHEMA_VERSION,
  MAX_CONFIG_BYTES,
  SUPPORTED_FRAMEWORKS,
  KNOWN_PROVIDERS,
  CAPABILITY_KEYS,
  PROTECTED_OUTPUT_PREFIXES,
  DEFAULT_OUTPUT_DIR,
  readConfigText,
  parseConfigText,
  validateConfig,
  loadConfig,
};
