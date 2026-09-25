/**
 * GOV-AUTO-1 Wave 1 / 1A -- repository base policy (design section 14).
 *
 * The base policy (`governance/base.json`, a FRAMEWORK CONSTANT path that no
 * manifest field can select) is repository input and therefore untrusted until
 * validated here: bounded, strict JSON, exact fields, no unknown field, no
 * arbitrary regular expression (path patterns use the restricted grammar of
 * safety/path-patterns.js and ID families are declarative). Every field of the
 * policy is a PROTECTED field: it is read from the governance root tip / the
 * derived base, never trusted from the head, and a head change to it is reported
 * as GOVERNANCE_CONFIG human review, never applied.
 *
 * The built-in minimum policy is hard-coded, tighten-only and fail-closed; it
 * applies only when no repository policy exists (bootstrap) and it honors no
 * suppression and defines no allowed path domain.
 */

"use strict";

const crypto = require("node:crypto");
const { REASON, STATUS, LIMITS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject, parsePositiveInteger, validateCapabilityId, classifySchemaCompatibility, validateSupportedSchemaVersions } = require("../../kernel/validation");
const { parseStrictJson } = require("../../kernel/json-strict");
const { canonicalJson } = require("../../kernel/results");
const { FRAMEWORK_METADATA } = require("../../framework-metadata");
const { parsePathPattern } = require("../../safety/path-patterns");
const { validateRepoRelativePath } = require("../../safety/repo-path");
const { redactString } = require("../../safety/redaction");
const { isValidBranchName } = require("./trusted-context");

const BASE_POLICY_PATH = "governance/base.json";
const GATE_ID = /^[a-z][a-z0-9-]{1,63}$/;
const MAX_POLICY_BYTES = 256 * 1024;
const POLICY_KEYS = ["schemaVersion", "requiredCapabilities", "protectedTargetRefs", "scope", "secretRules", "suppressionPolicy", "suppressions", "markdown"];
const SCOPE_KEYS = ["allowedPathDomains", "forbiddenPathDomains", "protectedPaths"];
const BUILTIN_SECRET_RULE_IDS = deepFreeze([
  "PRIVATE_KEY_BLOCK", "GITHUB_TOKEN", "AWS_ACCESS_KEY", "SLACK_TOKEN", "API_KEY_SK", "JWT", "BEARER_TOKEN", "SENSITIVE_VALUE",
]);
const CHARSETS = ["ALNUM", "HEX", "BASE64URL"];
const SUPPRESSION_CLASSES = ["TEST_FIXTURE", "DOCUMENTED_PLACEHOLDER"];
const DEFINITION_CONTEXTS = ["HEADING", "TABLE_FIRST_CELL"];
const IGNORE_CONTEXTS = ["FENCED_CODE", "INLINE_CODE"];
const MAX_LIST = 64;

// Paths that are protected in EVERY policy (tighten-only): a change to them is
// GOVERNANCE_CONFIG human review under any effective policy, including bootstrap.
const BUILTIN_PROTECTED_PATHS = deepFreeze(["governance/**", "scripts/governance/**", ".github/workflows/**"]);

const BUILTIN_MINIMUM_POLICY = deepFreeze({
  schemaVersion: 1,
  requiredCapabilities: [],
  protectedTargetRefs: [], // bootstrap: the platform-authenticated default branch only (runtime value)
  scope: { allowedPathDomains: [], forbiddenPathDomains: [], protectedPaths: [...BUILTIN_PROTECTED_PATHS] },
  secretRules: [],
  suppressionPolicy: { maxExpiryDays: 1 },
  suppressions: [],
  markdown: { filePatterns: [], idFamilies: [] },
});

function gateManifestPath(gateId) {
  return typeof gateId === "string" && GATE_ID.test(gateId) ? `governance/manifests/${gateId}.json` : null;
}

function isDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function exactKeys(obj, keys) {
  return isPlainObject(obj) && Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}

function int(value, min, max) {
  const parsed = parsePositiveInteger(value, { allowTypedNumber: true });
  return parsed.ok && parsed.value >= min && parsed.value <= max ? parsed.value : null;
}

function patternList(value, path, problems, { min = 0, max = MAX_LIST } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    problems.push(`${path} must be an array of ${min}..${max} path patterns`);
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !parsePathPattern(item).ok) problems.push(`${path} contains an invalid path pattern`);
    else if (seen.has(item)) problems.push(`${path} contains a duplicate pattern`);
    else {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function validateScope(scope, problems) {
  if (!exactKeys(scope, SCOPE_KEYS)) {
    problems.push("scope must have exactly allowedPathDomains, forbiddenPathDomains, protectedPaths");
    return null;
  }
  return {
    allowedPathDomains: patternList(scope.allowedPathDomains, "scope.allowedPathDomains", problems, { min: 1 }),
    forbiddenPathDomains: patternList(scope.forbiddenPathDomains, "scope.forbiddenPathDomains", problems),
    protectedPaths: patternList(scope.protectedPaths, "scope.protectedPaths", problems),
  };
}

function validateSecretRules(rules, problems) {
  if (!Array.isArray(rules) || rules.length > 32) {
    problems.push("secretRules must be an array of at most 32 rules");
    return [];
  }
  const out = [];
  const seen = new Set(BUILTIN_SECRET_RULE_IDS);
  for (const rule of rules) {
    if (!exactKeys(rule, ["ruleId", "prefix", "charset", "minLength", "maxLength"])) {
      problems.push("secretRules entry has missing or unknown fields");
      continue;
    }
    const min = int(rule.minLength, 8, 200);
    const max = int(rule.maxLength, 8, 256);
    const okId = typeof rule.ruleId === "string" && /^[A-Z][A-Z0-9_]{2,40}$/.test(rule.ruleId);
    const okPrefix = typeof rule.prefix === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(rule.prefix);
    if (!okId || !okPrefix || !CHARSETS.includes(rule.charset) || min === null || max === null || min > max) {
      problems.push("secretRules entry is invalid");
      continue;
    }
    if (seen.has(rule.ruleId)) {
      problems.push("secretRules entry duplicates a rule ID (built-in rules cannot be redefined)");
      continue;
    }
    seen.add(rule.ruleId);
    out.push({ ruleId: rule.ruleId, prefix: rule.prefix, charset: rule.charset, minLength: min, maxLength: max });
  }
  return out;
}

function validateSuppressions(list, ruleIds, problems) {
  if (!Array.isArray(list) || list.length > MAX_LIST) {
    problems.push("suppressions must be an array of at most 64 entries");
    return [];
  }
  const out = [];
  for (const s of list) {
    const parsed = parseSuppression(s, ruleIds);
    if (!parsed.ok) problems.push(`suppressions entry is invalid: ${parsed.problem}`);
    else out.push(parsed.suppression);
  }
  return out;
}

/**
 * Validate one suppression record (design section 16). It stores no secret
 * value and no value prefix: only rule, path, line range, classification,
 * reason, review reference, a full SHA-256 change-detection fingerprint and a
 * mandatory expiry. Used for base-anchored suppressions AND head proposals.
 */
function parseSuppression(s, ruleIds) {
  const keys = ["ruleId", "path", "lineStart", "lineEnd", "classification", "reason", "reviewRef", "fingerprint", "expires"];
  if (!exactKeys(s, keys)) return { ok: false, problem: "missing or unknown fields" };
  if (typeof s.ruleId !== "string" || !ruleIds.has(s.ruleId) || s.ruleId === "PRIVATE_KEY_BLOCK") return { ok: false, problem: "rule is unknown or never suppressible" };
  if (typeof s.path !== "string" || !validateRepoRelativePath(s.path).ok || s.path.includes("*")) return { ok: false, problem: "path must be one exact canonical path" };
  let lineStart = null;
  let lineEnd = null;
  if (s.lineStart !== null || s.lineEnd !== null) {
    lineStart = int(s.lineStart, 1, 1_000_000);
    lineEnd = int(s.lineEnd, 1, 1_000_000);
    if (lineStart === null || lineEnd === null || lineStart > lineEnd) return { ok: false, problem: "invalid line range" };
  }
  if (!SUPPRESSION_CLASSES.includes(s.classification)) return { ok: false, problem: "classification must be TEST_FIXTURE or DOCUMENTED_PLACEHOLDER" };
  // eslint-disable-next-line no-control-regex
  if (typeof s.reason !== "string" || s.reason.length < 1 || s.reason.length > 200 || /[\u0000-\u001f\u007f]/.test(s.reason)) return { ok: false, problem: "invalid reason" };
  if (redactString(s.reason) !== s.reason) return { ok: false, problem: "reason contains secret-like material" };
  if (typeof s.reviewRef !== "string" || !/^[A-Za-z0-9#:/._ -]{1,100}$/.test(s.reviewRef)) return { ok: false, problem: "invalid reviewRef" };
  if (typeof s.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(s.fingerprint)) return { ok: false, problem: "fingerprint must be a full SHA-256 hex digest" };
  if (!isDate(s.expires)) return { ok: false, problem: "expiry is mandatory (YYYY-MM-DD)" };
  return {
    ok: true,
    suppression: {
      ruleId: s.ruleId, path: s.path, lineStart, lineEnd, classification: s.classification,
      reason: s.reason, reviewRef: s.reviewRef, fingerprint: s.fingerprint, expires: s.expires,
    },
  };
}

function validateFamily(f, problems) {
  const keys = ["family", "prefix", "segments", "separator", "definitionSources", "definitionContexts", "ignoreContexts"];
  if (!exactKeys(f, keys)) {
    problems.push("idFamilies entry has missing or unknown fields");
    return null;
  }
  const bad = [];
  if (typeof f.family !== "string" || !/^[A-Z][A-Z0-9]{0,15}$/.test(f.family)) bad.push("family");
  if (typeof f.prefix !== "string" || !/^[A-Za-z]{1,8}-?$/.test(f.prefix)) bad.push("prefix");
  if (f.separator !== "-" && f.separator !== ".") bad.push("separator");
  const segments = [];
  if (!Array.isArray(f.segments) || f.segments.length < 1 || f.segments.length > 3) bad.push("segments");
  else {
    for (const seg of f.segments) {
      const min = exactKeys(seg, ["minDigits", "maxDigits"]) ? int(seg.minDigits, 1, 8) : null;
      const max = exactKeys(seg, ["minDigits", "maxDigits"]) ? int(seg.maxDigits, 1, 8) : null;
      if (min === null || max === null || min > max) bad.push("segments");
      else segments.push({ minDigits: min, maxDigits: max });
    }
  }
  const sources = patternList(f.definitionSources, "idFamilies.definitionSources", bad, { min: 1, max: 16 });
  const defCtx = Array.isArray(f.definitionContexts) && f.definitionContexts.length >= 1 && new Set(f.definitionContexts).size === f.definitionContexts.length && f.definitionContexts.every((c) => DEFINITION_CONTEXTS.includes(c));
  const ignCtx = Array.isArray(f.ignoreContexts) && new Set(f.ignoreContexts).size === f.ignoreContexts.length && f.ignoreContexts.every((c) => IGNORE_CONTEXTS.includes(c));
  if (!defCtx) bad.push("definitionContexts");
  if (!ignCtx) bad.push("ignoreContexts");
  if (bad.length > 0) {
    problems.push(`idFamilies entry is invalid (${[...new Set(bad)].join(", ")})`);
    return null;
  }
  return { family: f.family, prefix: f.prefix, segments, separator: f.separator, definitionSources: sources, definitionContexts: [...f.definitionContexts], ignoreContexts: [...f.ignoreContexts] };
}

function validateMarkdown(markdown, problems) {
  if (!exactKeys(markdown, ["filePatterns", "idFamilies"])) {
    problems.push("markdown must have exactly filePatterns and idFamilies");
    return null;
  }
  const filePatterns = patternList(markdown.filePatterns, "markdown.filePatterns", problems);
  const families = [];
  if (!Array.isArray(markdown.idFamilies) || markdown.idFamilies.length > 32) problems.push("markdown.idFamilies must be an array of at most 32 families");
  else {
    for (const f of markdown.idFamilies) {
      const parsed = validateFamily(f, problems);
      if (parsed) families.push(parsed);
    }
    // One family, one grammar: names unique and prefixes unambiguous.
    for (let i = 0; i < families.length; i += 1) {
      for (let j = i + 1; j < families.length; j += 1) {
        const a = families[i];
        const b = families[j];
        if (a.family === b.family) problems.push("duplicate ID family name");
        else if (a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix)) problems.push("ambiguous ID family prefixes");
      }
    }
  }
  return { filePatterns, idFamilies: families };
}

function invalid(problems, reasonCode = REASON.POLICY_INVALID, status = STATUS.CONFIGURATION_ERROR) {
  return deepFreeze({ ok: false, status, reasonCode, problems: [...new Set(problems)].slice(0, 30), policy: null });
}

/**
 * Validate a base policy tree (from parseStrictJson, or an already-normalized
 * frozen policy). Returns a frozen { ok, policy, unsupportedCapabilities } or
 * { ok:false, status, reasonCode, problems }.
 */
function validateBasePolicy(tree) {
  const problems = [];
  if (!isPlainObject(tree)) return invalid(["policy must be an object"]);
  for (const key of Object.keys(tree)) if (!POLICY_KEYS.includes(key)) problems.push("policy has an unknown field");
  for (const key of POLICY_KEYS) if (!Object.hasOwn(tree, key)) problems.push(`policy is missing ${key}`);
  if (problems.length > 0) return invalid(problems);

  const version = parsePositiveInteger(tree.schemaVersion, { allowTypedNumber: true });
  if (!version.ok) return invalid(["schemaVersion is malformed"]);
  const range = validateSupportedSchemaVersions(FRAMEWORK_METADATA.supportedSchemaVersions);
  const compat = classifySchemaCompatibility(range, { ok: true, value: version.value });
  if (compat.status === STATUS.INCOMPLETE) return invalid(["schemaVersion is newer than this framework supports"], compat.reasonCode, STATUS.INCOMPLETE);
  if (compat.status && compat.status !== STATUS.PASS) return invalid(["schemaVersion is below the supported minimum"]);

  const requiredCapabilities = [];
  const unsupportedCapabilities = [];
  if (!Array.isArray(tree.requiredCapabilities) || tree.requiredCapabilities.length > 32) problems.push("requiredCapabilities must be an array of at most 32 identities");
  else {
    for (const c of tree.requiredCapabilities) {
      const id = validateCapabilityId(c);
      if (!id.ok) problems.push("requiredCapabilities contains a malformed capability identity");
      else if (requiredCapabilities.includes(id.id)) problems.push("requiredCapabilities contains a duplicate");
      else {
        requiredCapabilities.push(id.id);
        if (!FRAMEWORK_METADATA.supportedCapabilities.includes(id.id)) unsupportedCapabilities.push(id.id);
      }
    }
  }

  const refs = tree.protectedTargetRefs;
  const protectedTargetRefs = [];
  if (!Array.isArray(refs)) problems.push("protectedTargetRefs must be an array");
  else if (refs.length === 0) problems.push("protectedTargetRefs must not be empty");
  else if (refs.length > 32) problems.push("protectedTargetRefs has too many entries");
  else {
    for (const ref of refs) {
      if (!isValidBranchName(ref)) problems.push("protectedTargetRefs contains an invalid ref name");
      else if (protectedTargetRefs.includes(ref)) problems.push("protectedTargetRefs contains a duplicate");
      else protectedTargetRefs.push(ref);
    }
  }

  const scope = validateScope(tree.scope, problems);
  const secretRules = validateSecretRules(tree.secretRules, problems);
  const ruleIds = new Set([...BUILTIN_SECRET_RULE_IDS, ...secretRules.map((r) => r.ruleId)]);
  let maxExpiryDays = null;
  if (!exactKeys(tree.suppressionPolicy, ["maxExpiryDays"])) problems.push("suppressionPolicy must be { maxExpiryDays }");
  else {
    maxExpiryDays = int(tree.suppressionPolicy.maxExpiryDays, 1, 366);
    if (maxExpiryDays === null) problems.push("suppressionPolicy.maxExpiryDays must be 1..366");
  }
  const suppressions = validateSuppressions(tree.suppressions, ruleIds, problems);
  const markdown = validateMarkdown(tree.markdown, problems);
  if (problems.length > 0) return invalid(problems);

  return deepFreeze({
    ok: true,
    problems: [],
    unsupportedCapabilities,
    policy: {
      schemaVersion: version.value,
      requiredCapabilities,
      protectedTargetRefs,
      scope,
      secretRules,
      suppressionPolicy: { maxExpiryDays },
      suppressions,
      markdown,
    },
  });
}

/** Parse + validate policy bytes (bounded, strict UTF-8, strict JSON). */
function parseBasePolicyBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) return invalid(["policy bytes are missing"]);
  if (bytes.length > MAX_POLICY_BYTES) return invalid(["policy exceeds the size limit"]);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return invalid(["policy is not valid UTF-8"]);
  }
  if (text.charCodeAt(0) === 0xfeff) return invalid(["policy has a byte-order mark"]);
  const parsed = parseStrictJson(text, { maxDepth: LIMITS.maxJsonDepth });
  if (!parsed.ok) return invalid(["policy is not strict JSON"]);
  return validateBasePolicy(parsed.value);
}

/** SHA-256 of the canonical policy (a public change-detection digest, not a secrecy control). */
function policyDigest(policy) {
  return crypto.createHash("sha256").update(canonicalJson(policy)).digest("hex");
}

module.exports = {
  BASE_POLICY_PATH, BUILTIN_MINIMUM_POLICY, BUILTIN_PROTECTED_PATHS, BUILTIN_SECRET_RULE_IDS,
  gateManifestPath, validateBasePolicy, parseBasePolicyBytes, parseSuppression, policyDigest,
};
