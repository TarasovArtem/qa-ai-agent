/**
 * GOV-AUTO-1 Wave 2 / 1D -- risk / source / method consistency (design section 18:
 * "Totals, counts, taxonomy, research-method contradiction checks"; non-goals
 * "never decides whether a risk is acceptable; nuanced method cases become
 * HUMAN_REVIEW_REQUIRED").
 *
 * checkConsistency() consumes ONLY the public 1B structure (never re-parses
 * Markdown) and, where a rule is marked dependsOnEvidence, the frozen result of
 * 1C's checkEvidenceModel() for the SAME subject (never recomputes evidence class,
 * strength or premise facts itself: 1C owns those). It checks three deterministic
 * invariants and nothing else:
 *   1. count consistency -- a manifest-declared "counted" table's row count (per
 *      group, if configured) matches a declared "totals" table's value;
 *   2. taxonomy consistency -- every value in a manifest-declared column belongs
 *      to the manifest-declared allowed set;
 *   3. method contradiction -- a manifest-declared method value paired, on the
 *      same row, with manifest-declared forbidden wording is flagged, unless an
 *      manifest-declared ambiguity marker is also present, in which case it is
 *      HUMAN_REVIEW_REQUIRED rather than FAIL.
 * It never decides whether a risk is acceptable, a source is credible or a
 * method was adequate: that is a human, and later-wave, decision.
 */

"use strict";

const { REASON, STATUS, STATUS_PRECEDENCE, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { matchPathPattern } = require("../../safety/path-patterns");
const { validateRepoRelativePath } = require("../../safety/repo-path");
const { createRecordFactory, isValidSubject, sameSubject, sample } = require("../common");
const { validateConsistencyConfig } = require("./config");

const MAX_ROWS = 5000;
const MAX_TOTAL_CELLS = 200_000;
const COUNT_TOKEN = /^[0-9]{1,9}$/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isParsedDocument(structure) {
  return isPlainObject(structure) && structure.ok === true && Array.isArray(structure.tables);
}
function invalidInput(detail) {
  return deepFreeze({ subject: null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.CONSISTENCY_INPUT_INVALID, detail } });
}
function findTable(structure, requiredColumns) {
  for (const table of structure.tables) if (requiredColumns.every((c) => table.header.includes(c))) return table;
  return null;
}
function cellAt(table, row, column) {
  const i = table.header.indexOf(column);
  const v = i >= 0 ? row.cells[i] : undefined;
  return typeof v === "string" ? v.trim() : "";
}
function parseCount(text) {
  return COUNT_TOKEN.test(text) ? Number(text) : null;
}
/** Worse of two Wave 0 statuses (NOT_APPLICABLE is neutral: it never wins). */
function worseStatus(a, b) {
  if (a === STATUS.NOT_APPLICABLE) return b;
  if (b === STATUS.NOT_APPLICABLE) return a;
  return STATUS_PRECEDENCE.indexOf(a) <= STATUS_PRECEDENCE.indexOf(b) ? a : b;
}

/**
 * checkConsistency({ subject, documents, config, evidenceResult? })
 *   documents      [{ path, structure }], structure = parseMarkdown()'s frozen output
 *   config         a raw consistency config (validated here; see ./config.js)
 *   evidenceResult the frozen result of checkEvidenceModel() for the SAME subject,
 *                  required only when a countRules entry declares dependsOnEvidence
 */
function checkConsistency(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput("a valid subject is required");
  const subject = input.subject;
  const out = createRecordFactory(subject, "1D");
  const { add, notApplicable } = out;
  const done = () => deepFreeze({ subject, records: out.records, outcome: null });

  if (!Array.isArray(input.documents) || !input.documents.every((d) => isPlainObject(d) && validateRepoRelativePath(d.path).ok)) {
    return invalidInput("documents must be an array of { path, structure } with canonical paths");
  }

  const validated = validateConsistencyConfig(input.config);
  if (!validated.ok) {
    add("1D.CONSISTENCY.CONFIG", validated.status, validated.reasonCode, "the consistency configuration is invalid", {});
    for (const id of ["COUNTS", "TAXONOMY", "METHOD"]) notApplicable(`1D.CONSISTENCY.${id}`, "no usable consistency configuration");
    return done();
  }
  const config = validated.config;
  add("1D.CONSISTENCY.CONFIG", STATUS.PASS, REASON.OK, "the consistency configuration is valid", { countRules: config.countRules.length, taxonomyRules: config.taxonomyRules.length, methodRules: config.methodRules.length });

  const evidenceStatus = (() => {
    if (!isPlainObject(input.evidenceResult) || !Array.isArray(input.evidenceResult.records)) return null;
    if (!sameSubject(input.evidenceResult.subject, subject)) return null;
    let worst = STATUS.NOT_APPLICABLE;
    for (const r of input.evidenceResult.records) worst = worseStatus(worst, r.status);
    return worst;
  })();

  let totalCells = 0;
  const bump = (n) => {
    totalCells += n;
    return totalCells <= MAX_TOTAL_CELLS;
  };

  // ---- Count consistency.
  const countFindings = [];
  let countChecked = 0;
  let countDependencyUnresolved = false;
  let countIncomplete = false;
  for (const rule of config.countRules) {
    for (const doc of input.documents) {
      if (!rule.filePatterns.some((p) => matchPathPattern(p, doc.path))) continue;
      if (!isParsedDocument(doc.structure)) {
        countIncomplete = true;
        continue;
      }
      const counted = findTable(doc.structure, rule.groupByColumn === null ? [rule.countedMatchColumn] : [rule.countedMatchColumn, rule.groupByColumn]);
      const totals = findTable(doc.structure, [rule.totalsLabelColumn, rule.totalsValueColumn]);
      if (!counted || !totals || counted === totals) {
        countIncomplete = true;
        continue;
      }
      if (!bump(counted.rows.length + totals.rows.length)) {
        add("1D.CONSISTENCY.COUNTS", STATUS.INCOMPLETE, REASON.CONSISTENCY_BOUND_EXCEEDED, "count consistency exceeded its work bound", {});
        for (const id of ["TAXONOMY", "METHOD"]) notApplicable(`1D.CONSISTENCY.${id}`, "the resource bound was exceeded");
        return done();
      }
      if (counted.rows.length > MAX_ROWS || totals.rows.length > MAX_ROWS) {
        add("1D.CONSISTENCY.COUNTS", STATUS.INCOMPLETE, REASON.CONSISTENCY_BOUND_EXCEEDED, "a table exceeds the supported row bound", { path: doc.path });
        for (const id of ["TAXONOMY", "METHOD"]) notApplicable(`1D.CONSISTENCY.${id}`, "the resource bound was exceeded");
        return done();
      }
      countChecked += 1;
      if (rule.dependsOnEvidence) {
        if (evidenceStatus === null) countDependencyUnresolved = true;
        else if (evidenceStatus !== STATUS.PASS && evidenceStatus !== STATUS.NOT_APPLICABLE) countFindings.push({ path: doc.path, line: counted.line, message: "counted table depends on 1C evidence that is not established (PASS)", code: REASON.CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED, downgrade: evidenceStatus });
      }
      const groups = new Map();
      for (const row of counted.rows) {
        const key = rule.groupByColumn === null ? "" : cellAt(counted, row, rule.groupByColumn);
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      const declaredKeys = new Set();
      let declaredSumWhenUngrouped = 0;
      for (const row of totals.rows) {
        const label = cellAt(totals, row, rule.totalsLabelColumn);
        const raw = cellAt(totals, row, rule.totalsValueColumn);
        const value = parseCount(raw);
        if (value === null) {
          countFindings.push({ path: doc.path, line: row.line, message: `declared total "${raw}" is not a valid non-negative integer`, code: REASON.CONSISTENCY_NUMERIC_INVALID });
          continue;
        }
        if (rule.groupByColumn === null) {
          declaredSumWhenUngrouped += value;
          continue;
        }
        declaredKeys.add(label);
        const actual = groups.get(label) || 0;
        if (actual !== value) countFindings.push({ path: doc.path, line: row.line, message: `declared total for "${label}" is ${value} but ${actual} row(s) were counted`, code: REASON.CONSISTENCY_COUNT_MISMATCH });
      }
      if (rule.groupByColumn === null) {
        const actual = counted.rows.length;
        if (declaredSumWhenUngrouped !== actual) countFindings.push({ path: doc.path, line: totals.line, message: `declared total is ${declaredSumWhenUngrouped} but ${actual} row(s) were counted`, code: REASON.CONSISTENCY_COUNT_MISMATCH });
      } else {
        for (const [key, actual] of groups) if (!declaredKeys.has(key) && actual > 0) countFindings.push({ path: doc.path, line: counted.line, message: `"${key}" has ${actual} counted row(s) but no declared total`, code: REASON.CONSISTENCY_COUNT_MISMATCH });
      }
    }
  }
  if (config.countRules.length === 0) notApplicable("1D.CONSISTENCY.COUNTS", "no count rule is configured");
  else if (countFindings.length > 0) {
    const code = countFindings.some((f) => f.code === REASON.CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED) ? REASON.CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED : countFindings[0].code;
    const dependencyOnly = countFindings.every((f) => f.code === REASON.CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED);
    const worst = dependencyOnly ? countFindings.reduce((w, f) => worseStatus(w, f.downgrade), STATUS.PASS) : STATUS.FAIL;
    add("1D.CONSISTENCY.COUNTS", worst, code, `${countFindings.length} finding(s); see observed.findings`, { count: countFindings.length, checked: countChecked, findings: sample(countFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  } else if (countDependencyUnresolved) add("1D.CONSISTENCY.COUNTS", STATUS.INCOMPLETE, REASON.CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED, "a count rule depends on 1C evidence, but no 1C result for this subject was supplied", { checked: countChecked });
  else if (countIncomplete && countChecked === 0) add("1D.CONSISTENCY.COUNTS", STATUS.INCOMPLETE, REASON.CONSISTENCY_INPUT_INVALID, "a configured counted or totals table could not be found or parsed", {});
  else add("1D.CONSISTENCY.COUNTS", STATUS.PASS, REASON.OK, "every declared total matches its counted rows", { checked: countChecked });

  // ---- Taxonomy consistency.
  const taxonomyFindings = [];
  let taxonomyChecked = 0;
  for (const rule of config.taxonomyRules) {
    for (const doc of input.documents) {
      if (!rule.filePatterns.some((p) => matchPathPattern(p, doc.path))) continue;
      if (!isParsedDocument(doc.structure)) continue;
      const table = findTable(doc.structure, [rule.matchColumn]);
      if (!table) continue;
      if (!bump(table.rows.length) || table.rows.length > MAX_ROWS) {
        add("1D.CONSISTENCY.TAXONOMY", STATUS.INCOMPLETE, REASON.CONSISTENCY_BOUND_EXCEEDED, "taxonomy consistency exceeded its work bound", {});
        notApplicable("1D.CONSISTENCY.METHOD", "the resource bound was exceeded");
        return done();
      }
      for (const row of table.rows) {
        taxonomyChecked += 1;
        const value = cellAt(table, row, rule.matchColumn);
        if (value !== "" && !rule.allowedValues.includes(value)) taxonomyFindings.push({ path: doc.path, line: row.line, message: `"${value}" is not a declared taxonomy value`, code: REASON.CONSISTENCY_TAXONOMY_UNKNOWN });
      }
    }
  }
  if (config.taxonomyRules.length === 0) notApplicable("1D.CONSISTENCY.TAXONOMY", "no taxonomy rule is configured");
  else if (taxonomyFindings.length > 0) add("1D.CONSISTENCY.TAXONOMY", STATUS.FAIL, REASON.CONSISTENCY_TAXONOMY_UNKNOWN, `${taxonomyFindings.length} finding(s); see observed.findings`, { count: taxonomyFindings.length, checked: taxonomyChecked, findings: sample(taxonomyFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else add("1D.CONSISTENCY.TAXONOMY", STATUS.PASS, REASON.OK, "every value belongs to its declared taxonomy", { checked: taxonomyChecked });

  // ---- Method-contradiction consistency.
  const methodFindings = [];
  const methodReviewFindings = [];
  let methodChecked = 0;
  for (const rule of config.methodRules) {
    if (rule.contradictions.length === 0) continue;
    const byMethod = new Map(rule.contradictions.map((c) => [c.method, c.forbiddenWords]));
    const ambiguousPattern = rule.ambiguousMarkers.length > 0 ? new RegExp(`\\b(?:${rule.ambiguousMarkers.map(escapeRegExp).join("|")})\\b`, "i") : null;
    for (const doc of input.documents) {
      if (!rule.filePatterns.some((p) => matchPathPattern(p, doc.path))) continue;
      if (!isParsedDocument(doc.structure)) continue;
      const table = findTable(doc.structure, [rule.matchColumn, rule.textColumn]);
      if (!table) continue;
      if (!bump(table.rows.length) || table.rows.length > MAX_ROWS) {
        add("1D.CONSISTENCY.METHOD", STATUS.INCOMPLETE, REASON.CONSISTENCY_BOUND_EXCEEDED, "method consistency exceeded its work bound", {});
        return done();
      }
      for (const row of table.rows) {
        methodChecked += 1;
        const method = cellAt(table, row, rule.matchColumn);
        const forbiddenWords = byMethod.get(method);
        if (!forbiddenWords || forbiddenWords.length === 0) continue;
        const text = cellAt(table, row, rule.textColumn).slice(0, 2000);
        const forbiddenPattern = new RegExp(`\\b(?:${forbiddenWords.map(escapeRegExp).join("|")})\\b`, "i");
        if (forbiddenPattern.test(text)) {
          const finding = { path: doc.path, line: row.line, message: `"${method}" is declared alongside wording that contradicts it` };
          if (ambiguousPattern && ambiguousPattern.test(text)) methodReviewFindings.push(finding);
          else methodFindings.push(finding);
        }
      }
    }
  }
  if (config.methodRules.length === 0) notApplicable("1D.CONSISTENCY.METHOD", "no method rule is configured");
  else if (methodFindings.length > 0) add("1D.CONSISTENCY.METHOD", STATUS.FAIL, REASON.CONSISTENCY_METHOD_CONTRADICTION, `${methodFindings.length} finding(s); see observed.findings`, { count: methodFindings.length, checked: methodChecked, findings: sample(methodFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else if (methodReviewFindings.length > 0) add("1D.CONSISTENCY.METHOD", STATUS.HUMAN_REVIEW_REQUIRED, REASON.CONSISTENCY_METHOD_CONTRADICTION, `${methodReviewFindings.length} ambiguous finding(s); a human must judge whether this is a real contradiction; see observed.findings`, { count: methodReviewFindings.length, checked: methodChecked, findings: sample(methodReviewFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else add("1D.CONSISTENCY.METHOD", STATUS.PASS, REASON.OK, "no declared method contradicts its row's own wording", { checked: methodChecked });

  return done();
}

module.exports = { checkConsistency };
