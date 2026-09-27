/**
 * GOV-AUTO-1 Wave 2 / 1C -- evidence-model configuration (design section 18: "1C
 * Evidence and provenance", inputs "1B structure; manifest evidence-model config").
 *
 * The concrete schema is a Wave 2 design decision (the design doc names the
 * concept -- source class kept apart from conclusion strength, weakest-premise
 * propagation -- but not a literal manifest shape), made here the same way 1A's
 * base policy and 1B's ID families made their own concrete, project-independent
 * schemas: every class/strength/word list is declared by the caller, never
 * hard-coded to this repository's own AISEC-3 vocabulary (DIRECT_DOC, ...).
 *
 * A table is recognized as an EVIDENCE TABLE when its header row (from 1B's
 * already-parsed, normalized table structure -- never re-parsed here) contains
 * both the configured id and class column names for a matching file. Every
 * other table in that file is ignored by 1C.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject, parsePositiveInteger } = require("../../kernel/validation");
const { parsePathPattern } = require("../../safety/path-patterns");

const MAX_LIST = 32;
const MAX_WORDS = 64;
const CLASS_TOKEN = /^[A-Z][A-Z0-9_]{0,31}$/;
const WORD_TOKEN = /^[A-Za-z][A-Za-z' -]{0,31}$/;
const COLUMN_NAME = /^[A-Za-z][A-Za-z0-9 _/().'-]{0,63}$/;

function exactKeys(obj, keys) {
  return isPlainObject(obj) && Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}

function tokenList(value, pattern, problems, label, { min = 1, max = MAX_LIST } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    problems.push(`${label} must be an array of ${min}..${max} tokens`);
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !pattern.test(item)) problems.push(`${label} contains an invalid token`);
    else if (seen.has(item)) problems.push(`${label} contains a duplicate`);
    else {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
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

function optionalColumn(value, problems, label) {
  if (value === null) return null;
  if (typeof value !== "string" || !COLUMN_NAME.test(value)) {
    problems.push(`${label} must be null or a valid column name`);
    return null;
  }
  return value;
}

function validateTableSelector(t, problems) {
  const keys = ["filePatterns", "idColumn", "classColumn", "strengthColumn", "premisesColumn", "conclusionColumn", "independentColumn"];
  if (!exactKeys(t, keys)) {
    problems.push("tables entry has missing or unknown fields");
    return null;
  }
  const filePatterns = filePatternList(t.filePatterns, problems, "tables.filePatterns");
  const idColumn = typeof t.idColumn === "string" && COLUMN_NAME.test(t.idColumn) ? t.idColumn : (problems.push("tables.idColumn is invalid"), null);
  const classColumn = typeof t.classColumn === "string" && COLUMN_NAME.test(t.classColumn) ? t.classColumn : (problems.push("tables.classColumn is invalid"), null);
  const strengthColumn = optionalColumn(t.strengthColumn, problems, "tables.strengthColumn");
  const premisesColumn = optionalColumn(t.premisesColumn, problems, "tables.premisesColumn");
  const conclusionColumn = optionalColumn(t.conclusionColumn, problems, "tables.conclusionColumn");
  const independentColumn = optionalColumn(t.independentColumn, problems, "tables.independentColumn");
  if (idColumn === null || classColumn === null) return null;
  // Every configured logical column role must be a physically distinct column: a collision
  // (for example independentColumn aliasing classColumn) would silently give one cell two
  // incompatible meanings and can defeat an invariant this stage exists to enforce (Wave 2
  // corrective C1, W2-SEC-M1).
  const roles = { idColumn, classColumn, strengthColumn, premisesColumn, conclusionColumn, independentColumn };
  const named = Object.entries(roles).filter(([, v]) => v !== null);
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      if (named[i][1] === named[j][1]) problems.push(`tables.${named[i][0]} and tables.${named[j][0]} must not name the same column`);
    }
  }
  return { filePatterns, idColumn, classColumn, strengthColumn, premisesColumn, conclusionColumn, independentColumn };
}

/**
 * Validate a raw evidence-model config. Returns a frozen
 * { ok: true, config } or { ok: false, status, reasonCode, problems }.
 *
 * config.evidenceClasses / conclusionStrengths declare the whole taxonomy (no
 * repository-specific token is hard-coded anywhere in 1C production code).
 * conclusionStrengths is ordered WEAKEST FIRST: that order is the strength rank
 * used for one-class-per-row, overclaim and promotion-wording checks.
 */
function validateEvidenceModelConfig(raw) {
  const problems = [];
  const fail = (reasonCode = REASON.EVIDENCE_CONFIG_INVALID, status = STATUS.CONFIGURATION_ERROR) =>
    deepFreeze({ ok: false, status, reasonCode, problems: [...new Set(problems)].slice(0, 30) });
  const keys = ["schemaVersion", "evidenceClasses", "conclusionStrengths", "classToStrength", "promotionWords", "tables"];
  if (!isPlainObject(raw)) return fail();
  if (!exactKeys(raw, keys)) return fail(REASON.EVIDENCE_CONFIG_INVALID);

  const version = parsePositiveInteger(raw.schemaVersion, { allowTypedNumber: true });
  if (!version.ok || version.value !== 1) problems.push("schemaVersion must be 1");

  const evidenceClasses = tokenList(raw.evidenceClasses, CLASS_TOKEN, problems, "evidenceClasses");
  const conclusionStrengths = tokenList(raw.conclusionStrengths, CLASS_TOKEN, problems, "conclusionStrengths", { max: 16 });
  const promotionWords = tokenList(raw.promotionWords, WORD_TOKEN, problems, "promotionWords", { min: 0, max: MAX_WORDS });

  let classToStrength = {};
  if (!isPlainObject(raw.classToStrength)) problems.push("classToStrength must be an object");
  else {
    const declaredKeys = Object.keys(raw.classToStrength);
    if (declaredKeys.length !== evidenceClasses.length || !evidenceClasses.every((c) => Object.hasOwn(raw.classToStrength, c))) {
      problems.push("classToStrength must map every declared evidence class exactly once");
    }
    for (const [cls, strength] of Object.entries(raw.classToStrength)) {
      if (typeof strength !== "string" || !conclusionStrengths.includes(strength)) problems.push("classToStrength has a value outside conclusionStrengths");
      else classToStrength[cls] = strength;
    }
  }

  const tables = [];
  if (!Array.isArray(raw.tables) || raw.tables.length < 1 || raw.tables.length > MAX_LIST) problems.push("tables must be an array of 1..32 selectors");
  else for (const t of raw.tables) {
    const parsed = validateTableSelector(t, problems);
    if (parsed) tables.push(parsed);
  }

  if (problems.length > 0) return fail();
  return deepFreeze({
    ok: true,
    config: {
      schemaVersion: 1,
      evidenceClasses,
      conclusionStrengths,
      classToStrength: deepFreeze({ ...classToStrength }),
      promotionWords,
      tables,
    },
  });
}

module.exports = { validateEvidenceModelConfig };
