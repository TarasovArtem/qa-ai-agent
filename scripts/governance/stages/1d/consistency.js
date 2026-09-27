/**
 * GOV-AUTO-1 Wave 2 / 1D -- risk / source / method consistency (design section 18:
 * "Totals, counts, taxonomy, research-method contradiction checks"; non-goals
 * "never decides whether a risk is acceptable; nuanced method cases become
 * HUMAN_REVIEW_REQUIRED"). Corrective C1 (Wave 2 HEAVY re-review) hardened this
 * module; see the commit and PR history.
 *
 * checkConsistency() consumes ONLY the public 1B structure (never re-parses
 * Markdown) and, where a rule is marked dependsOnEvidence, the frozen result of
 * 1C's checkEvidenceModel() for the SAME subject (runtime-validated before any of
 * its statuses are trusted; never re-derives evidence class, strength or premise
 * facts itself -- 1C owns those). It checks three deterministic invariants:
 *   1. count consistency -- a manifest-declared "counted" table's row count (per
 *      group, if configured) matches a declared "totals" table's value. A
 *      dependsOnEvidence rule additionally binds EACH counted row to a specific
 *      1C evidence-row status (via 1C's rowIndex), so an unrelated 1C finding
 *      elsewhere never affects a count table that only counts clean rows, and a
 *      row bound to an unresolved/failing 1C fact is never silently counted;
 *   2. taxonomy consistency -- every value in a manifest-declared column belongs
 *      to the manifest-declared allowed set;
 *   3. method contradiction -- a manifest-declared method value paired, on the
 *      same row, with manifest-declared forbidden wording is flagged, unless a
 *      manifest-declared ambiguity marker is also present, in which case it is
 *      HUMAN_REVIEW_REQUIRED rather than FAIL.
 * A rule applicable to a document that cannot be evaluated (unparsed, or its
 * required table is absent) is never silently skipped into a false PASS: it
 * makes the check INCOMPLETE, whether or not some OTHER matching document was
 * clean. It never decides whether a risk is acceptable, a source is credible or
 * a method was adequate: that is a human, and later-wave, decision.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { matchPathPattern } = require("../../safety/path-patterns");
const { validateRepoRelativePath } = require("../../safety/repo-path");
const { createRecordFactory, isValidSubject, sample, worseStatus, isValidMarkdownStructure, validateStageResult } = require("../common");
const { validateConsistencyConfig } = require("./config");

const MAX_ROWS = 5000;
const MAX_TOTAL_CELLS = 200_000;
const COUNT_TOKEN = /^[0-9]{1,9}$/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

/**
 * checkConsistency({ subject, documents, config, evidenceResult? })
 *   documents      [{ path, structure }], structure = parseMarkdown()'s frozen output
 *                  (runtime-validated here, never re-parsed)
 *   config         a raw consistency config (validated here; see ./config.js)
 *   evidenceResult the frozen result of checkEvidenceModel() for the SAME subject,
 *                  runtime-validated before use; required only when a countRules
 *                  entry declares dependsOnEvidence
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

  // A forged, malformed or wrong-subject evidenceResult is never trusted: it is treated
  // exactly like no evidenceResult at all (corrective C1, W2-SEC-H3). Never throws.
  const evidenceResult = validateStageResult(input.evidenceResult, subject, "1C");
  const evidenceRowMap = evidenceResult && Array.isArray(evidenceResult.rowIndex) ? new Map(evidenceResult.rowIndex.map((r) => [r.id, r.status])) : null;
  const evidenceRowStatus = (id) => (evidenceRowMap ? evidenceRowMap.get(id) ?? null : null);

  let totalCells = 0;
  const bump = (n) => {
    totalCells += n;
    return totalCells <= MAX_TOTAL_CELLS;
  };

  // ---- Count consistency.
  const countFindings = [];
  let countChecked = 0;
  let countIncomplete = false; // any matching document that could not be fully evaluated
  let countMatchedAny = false;
  for (const rule of config.countRules) {
    for (const doc of input.documents) {
      if (!rule.filePatterns.some((p) => matchPathPattern(p, doc.path))) continue;
      countMatchedAny = true;
      if (!isValidMarkdownStructure(doc.structure)) {
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

      // Per-row 1C evidence binding (corrective C1, W2-DEV-M2 / W2-SEC-L1): each counted row,
      // not the whole 1C result, decides whether ITS OWN inclusion in the count is trustworthy.
      if (rule.dependsOnEvidence) {
        if (evidenceResult === null) countFindings.push({ path: doc.path, line: counted.line, message: "this count rule depends on 1C evidence, but no usable 1C result for this subject was supplied", code: REASON.CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED, downgrade: STATUS.INCOMPLETE });
        else {
          let rowsStatus = STATUS.PASS;
          for (const row of counted.rows) {
            const evidenceId = cellAt(counted, row, rule.evidenceIdColumn);
            const status = evidenceId === "" ? null : evidenceRowStatus(evidenceId);
            rowsStatus = worseStatus(rowsStatus, status === null ? STATUS.INCOMPLETE : status);
          }
          if (rowsStatus !== STATUS.PASS) countFindings.push({ path: doc.path, line: counted.line, message: "one or more counted rows are bound to 1C evidence that is not established (PASS)", code: REASON.CONSISTENCY_EVIDENCE_DEPENDENCY_UNRESOLVED, downgrade: rowsStatus });
        }
      }

      const groups = new Map();
      for (const row of counted.rows) {
        const key = rule.groupByColumn === null ? "" : cellAt(counted, row, rule.groupByColumn);
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      const declaredKeys = new Set();
      const duplicateKeys = new Set();
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
        if (declaredKeys.has(label)) duplicateKeys.add(label);
        declaredKeys.add(label);
        const actual = groups.get(label) || 0;
        if (actual !== value) countFindings.push({ path: doc.path, line: row.line, message: `declared total for "${label}" is ${value} but ${actual} row(s) were counted`, code: REASON.CONSISTENCY_COUNT_MISMATCH });
      }
      for (const label of duplicateKeys) countFindings.push({ path: doc.path, line: totals.line, message: `"${label}" is declared more than once in the totals table`, code: REASON.CONSISTENCY_COUNT_MISMATCH });
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
    let worst = countFindings.reduce((w, f) => worseStatus(w, f.downgrade || STATUS.FAIL), STATUS.PASS);
    if (countIncomplete) worst = worseStatus(worst, STATUS.INCOMPLETE);
    add("1D.CONSISTENCY.COUNTS", worst, code, `${countFindings.length} finding(s); see observed.findings`, { count: countFindings.length, checked: countChecked, findings: sample(countFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  } else if (countIncomplete) add("1D.CONSISTENCY.COUNTS", STATUS.INCOMPLETE, REASON.CONSISTENCY_INPUT_INVALID, "a configured counted or totals table, or the evidence it depends on, could not be established for every matching document", { checked: countChecked });
  else if (!countMatchedAny) notApplicable("1D.CONSISTENCY.COUNTS", "no changed document matches a configured count rule");
  else add("1D.CONSISTENCY.COUNTS", STATUS.PASS, REASON.OK, "every declared total matches its counted rows, for every matching document", { checked: countChecked });

  // ---- Taxonomy consistency.
  const taxonomyFindings = [];
  let taxonomyChecked = 0;
  let taxonomyIncomplete = false;
  let taxonomyMatchedAny = false;
  for (const rule of config.taxonomyRules) {
    for (const doc of input.documents) {
      if (!rule.filePatterns.some((p) => matchPathPattern(p, doc.path))) continue;
      taxonomyMatchedAny = true;
      if (!isValidMarkdownStructure(doc.structure)) {
        taxonomyIncomplete = true;
        continue;
      }
      const table = findTable(doc.structure, [rule.matchColumn]);
      if (!table) {
        taxonomyIncomplete = true;
        continue;
      }
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
  else if (taxonomyIncomplete) add("1D.CONSISTENCY.TAXONOMY", STATUS.INCOMPLETE, REASON.CONSISTENCY_INPUT_INVALID, "a configured taxonomy table could not be established for every matching document", { checked: taxonomyChecked });
  else if (!taxonomyMatchedAny) notApplicable("1D.CONSISTENCY.TAXONOMY", "no changed document matches a configured taxonomy rule");
  else add("1D.CONSISTENCY.TAXONOMY", STATUS.PASS, REASON.OK, "every value belongs to its declared taxonomy, for every matching document", { checked: taxonomyChecked });

  // ---- Method-contradiction consistency.
  const methodFindings = [];
  const methodReviewFindings = [];
  let methodChecked = 0;
  let methodIncomplete = false;
  let methodMatchedAny = false;
  for (const rule of config.methodRules) {
    if (rule.contradictions.length === 0) continue;
    const byMethod = new Map(rule.contradictions.map((c) => [c.method, c.forbiddenWords]));
    const ambiguousPattern = rule.ambiguousMarkers.length > 0 ? new RegExp(`\\b(?:${rule.ambiguousMarkers.map(escapeRegExp).join("|")})\\b`, "i") : null;
    for (const doc of input.documents) {
      if (!rule.filePatterns.some((p) => matchPathPattern(p, doc.path))) continue;
      methodMatchedAny = true;
      if (!isValidMarkdownStructure(doc.structure)) {
        methodIncomplete = true;
        continue;
      }
      const table = findTable(doc.structure, [rule.matchColumn, rule.textColumn]);
      if (!table) {
        methodIncomplete = true;
        continue;
      }
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
  if (config.methodRules.every((r) => r.contradictions.length === 0)) notApplicable("1D.CONSISTENCY.METHOD", "no method rule with a configured contradiction is present");
  else if (methodFindings.length > 0) add("1D.CONSISTENCY.METHOD", STATUS.FAIL, REASON.CONSISTENCY_METHOD_CONTRADICTION, `${methodFindings.length} finding(s); see observed.findings`, { count: methodFindings.length, checked: methodChecked, findings: sample(methodFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else if (methodReviewFindings.length > 0) add("1D.CONSISTENCY.METHOD", STATUS.HUMAN_REVIEW_REQUIRED, REASON.CONSISTENCY_METHOD_CONTRADICTION, `${methodReviewFindings.length} ambiguous finding(s); a human must judge whether this is a real contradiction; see observed.findings`, { count: methodReviewFindings.length, checked: methodChecked, findings: sample(methodReviewFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else if (methodIncomplete) add("1D.CONSISTENCY.METHOD", STATUS.INCOMPLETE, REASON.CONSISTENCY_INPUT_INVALID, "a configured method table could not be established for every matching document", { checked: methodChecked });
  else if (!methodMatchedAny) notApplicable("1D.CONSISTENCY.METHOD", "no changed document matches a configured method rule");
  else add("1D.CONSISTENCY.METHOD", STATUS.PASS, REASON.OK, "no declared method contradicts its row's own wording, for every matching document", { checked: methodChecked });

  return done();
}

module.exports = { checkConsistency };
