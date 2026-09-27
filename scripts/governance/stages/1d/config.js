/**
 * GOV-AUTO-1 Wave 2 / 1D -- consistency configuration (design section 18: "1D Risk
 * / source / method consistency"; "Totals, counts, taxonomy, research-method
 * contradiction checks"). Like 1C's evidence-model config, the concrete manifest
 * shape is a Wave 2 design decision: every column name, taxonomy and method word
 * is caller-declared, never a hard-coded repository-specific identifier.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject, parsePositiveInteger } = require("../../kernel/validation");
const { parsePathPattern } = require("../../safety/path-patterns");

const MAX_LIST = 32;
const MAX_VALUES = 64;
const MAX_WORDS = 64;
const VALUE_TOKEN = /^[A-Za-z][A-Za-z0-9_ -]{0,31}$/;
const WORD_TOKEN = /^[A-Za-z][A-Za-z' -]{0,31}$/;
const COLUMN_NAME = /^[A-Za-z][A-Za-z0-9 _/().'-]{0,63}$/;

function exactKeys(obj, keys) {
  return isPlainObject(obj) && Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}
function column(value, problems, label, { optional = false } = {}) {
  if (optional && value === null) return null;
  if (typeof value !== "string" || !COLUMN_NAME.test(value)) {
    problems.push(`${label} is invalid`);
    return null;
  }
  return value;
}
function filePatternList(value, problems, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LIST) {
    problems.push(`${label} must be an array of 1..${MAX_LIST} path patterns`);
    return [];
  }
  const out = [];
  for (const item of value) {
    const parsed = typeof item === "string" ? parsePathPattern(item) : { ok: false };
    if (!parsed.ok) problems.push(`${label} contains an invalid path pattern`);
    else out.push(parsed.pattern);
  }
  return out;
}
function valueList(value, problems, label, { min = 1, max = MAX_VALUES, pattern = VALUE_TOKEN } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    problems.push(`${label} must be an array of ${min}..${max} tokens`);
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const v of value) {
    if (typeof v !== "string" || !pattern.test(v)) problems.push(`${label} contains an invalid token`);
    else if (seen.has(v)) problems.push(`${label} contains a duplicate`);
    else {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function validateCountRule(r, problems) {
  const keys = ["filePatterns", "countedMatchColumn", "groupByColumn", "totalsLabelColumn", "totalsValueColumn", "dependsOnEvidence", "evidenceIdColumn"];
  if (!exactKeys(r, keys)) {
    problems.push("countRules entry has missing or unknown fields");
    return null;
  }
  const filePatterns = filePatternList(r.filePatterns, problems, "countRules.filePatterns");
  const countedMatchColumn = column(r.countedMatchColumn, problems, "countRules.countedMatchColumn");
  const groupByColumn = column(r.groupByColumn, problems, "countRules.groupByColumn", { optional: true });
  const totalsLabelColumn = column(r.totalsLabelColumn, problems, "countRules.totalsLabelColumn");
  const totalsValueColumn = column(r.totalsValueColumn, problems, "countRules.totalsValueColumn");
  if (typeof r.dependsOnEvidence !== "boolean") problems.push("countRules.dependsOnEvidence must be a boolean");
  const evidenceIdColumn = column(r.evidenceIdColumn, problems, "countRules.evidenceIdColumn", { optional: true });
  if (r.dependsOnEvidence === true && evidenceIdColumn === null) problems.push("countRules.evidenceIdColumn is required when dependsOnEvidence is true");
  return { filePatterns, countedMatchColumn, groupByColumn, totalsLabelColumn, totalsValueColumn, dependsOnEvidence: r.dependsOnEvidence === true, evidenceIdColumn };
}

function validateTaxonomyRule(r, problems) {
  const keys = ["filePatterns", "matchColumn", "allowedValues"];
  if (!exactKeys(r, keys)) {
    problems.push("taxonomyRules entry has missing or unknown fields");
    return null;
  }
  const filePatterns = filePatternList(r.filePatterns, problems, "taxonomyRules.filePatterns");
  const matchColumn = column(r.matchColumn, problems, "taxonomyRules.matchColumn");
  const allowedValues = valueList(r.allowedValues, problems, "taxonomyRules.allowedValues");
  return { filePatterns, matchColumn, allowedValues };
}

function validateMethodRule(r, problems) {
  const keys = ["filePatterns", "matchColumn", "methodValues", "textColumn", "contradictions", "ambiguousMarkers"];
  if (!exactKeys(r, keys)) {
    problems.push("methodRules entry has missing or unknown fields");
    return null;
  }
  const filePatterns = filePatternList(r.filePatterns, problems, "methodRules.filePatterns");
  const matchColumn = column(r.matchColumn, problems, "methodRules.matchColumn");
  const methodValues = valueList(r.methodValues, problems, "methodRules.methodValues");
  const textColumn = column(r.textColumn, problems, "methodRules.textColumn");
  // Zero ambiguity markers is a legitimate, MORE conservative configuration (every
  // contradiction for this rule is always a deterministic FAIL, with no HRR escape) --
  // corrective C1, W2-DEV-M1.
  const ambiguousMarkers = valueList(r.ambiguousMarkers, problems, "methodRules.ambiguousMarkers", { min: 0, max: MAX_WORDS, pattern: WORD_TOKEN });
  const contradictions = [];
  const seenMethods = new Set();
  if (!Array.isArray(r.contradictions) || r.contradictions.length > MAX_LIST) problems.push("methodRules.contradictions must be an array");
  else for (const c of r.contradictions) {
    if (!exactKeys(c, ["method", "forbiddenWords"])) {
      problems.push("methodRules.contradictions entry has missing or unknown fields");
      continue;
    }
    const method = typeof c.method === "string" && methodValues.includes(c.method) ? c.method : (problems.push("methodRules.contradictions.method is not a declared methodValue"), null);
    const forbiddenWords = valueList(c.forbiddenWords, problems, "methodRules.contradictions.forbiddenWords", { max: MAX_WORDS, pattern: WORD_TOKEN });
    if (method !== null) {
      // A second contradiction entry for the same method would silently overwrite the
      // first through Map construction -- reject it instead (corrective C1, W2 section 20).
      if (seenMethods.has(method)) problems.push(`methodRules.contradictions declares "${method}" more than once`);
      else {
        seenMethods.add(method);
        contradictions.push({ method, forbiddenWords });
      }
    }
  }
  return { filePatterns, matchColumn, methodValues, textColumn, contradictions, ambiguousMarkers };
}

/** Validate a raw consistency config. Returns { ok: true, config } or { ok: false, status, reasonCode, problems }. */
function validateConsistencyConfig(raw) {
  const problems = [];
  const fail = (reasonCode = REASON.CONSISTENCY_CONFIG_INVALID, status = STATUS.CONFIGURATION_ERROR) =>
    deepFreeze({ ok: false, status, reasonCode, problems: [...new Set(problems)].slice(0, 30) });
  const keys = ["schemaVersion", "countRules", "taxonomyRules", "methodRules"];
  if (!isPlainObject(raw)) return fail();
  if (!exactKeys(raw, keys)) return fail();

  const version = parsePositiveInteger(raw.schemaVersion, { allowTypedNumber: true });
  if (!version.ok || version.value !== 1) problems.push("schemaVersion must be 1");

  const countRules = [];
  if (!Array.isArray(raw.countRules) || raw.countRules.length > MAX_LIST) problems.push("countRules must be an array of at most 32 rules");
  else for (const r of raw.countRules) {
    const parsed = validateCountRule(r, problems);
    if (parsed) countRules.push(parsed);
  }
  const taxonomyRules = [];
  if (!Array.isArray(raw.taxonomyRules) || raw.taxonomyRules.length > MAX_LIST) problems.push("taxonomyRules must be an array of at most 32 rules");
  else for (const r of raw.taxonomyRules) {
    const parsed = validateTaxonomyRule(r, problems);
    if (parsed) taxonomyRules.push(parsed);
  }
  const methodRules = [];
  if (!Array.isArray(raw.methodRules) || raw.methodRules.length > MAX_LIST) problems.push("methodRules must be an array of at most 32 rules");
  else for (const r of raw.methodRules) {
    const parsed = validateMethodRule(r, problems);
    if (parsed) methodRules.push(parsed);
  }
  if (countRules.length + taxonomyRules.length + methodRules.length === 0) problems.push("at least one countRules, taxonomyRules or methodRules entry is required");

  if (problems.length > 0) return fail();
  return deepFreeze({ ok: true, config: { schemaVersion: 1, countRules, taxonomyRules, methodRules } });
}

module.exports = { validateConsistencyConfig };
