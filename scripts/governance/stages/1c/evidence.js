/**
 * GOV-AUTO-1 Wave 2 / 1C -- evidence and provenance validation (design section 18:
 * "Evidence/provenance validation (class vs strength, one class per row, promotion
 * wording, weakest premise)"; non-goal "Semantic sufficiency stays human").
 *
 * checkEvidenceModel() consumes ONLY the public, already-parsed 1B structure
 * (parseMarkdown()'s frozen output) for each supplied document: it never reads a
 * file, never calls Git and never re-parses Markdown. A table is an EVIDENCE
 * TABLE when its header contains the configured id and class column names for a
 * matching document path; every other table is ignored.
 *
 * It validates exactly four structural invariants and nothing else:
 *   1. every evidence row declares exactly one known evidence class and, if a
 *      strength is declared, exactly one known conclusion strength;
 *   2. every declared premise reference resolves to exactly one row, and the
 *      premise relationship is acyclic;
 *   3. a row's declared strength never exceeds what its own evidence class and
 *      its premises' resolved strengths can support (the weakest-premise
 *      propagation rule), unless the row explicitly declares independent
 *      evidence (independentColumn);
 *   4. promotion wording (a manifest-declared literal word list) on a row whose
 *      resolved strength is not already the strongest configured value is
 *      flagged for human review -- 1C never decides whether the wording is
 *      actually false.
 * It never judges whether an inference is substantively correct: that is a
 * human, and later-wave, decision.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { matchPathPattern } = require("../../safety/path-patterns");
const { validateRepoRelativePath } = require("../../safety/repo-path");
const { createRecordFactory, isValidSubject, sample } = require("../common");
const { validateEvidenceModelConfig } = require("./config");

const MAX_ROWS = 5000;
const MAX_PREMISES_PER_ROW = 32;
const MAX_DEPTH = 500;
const BASE_BUDGET = 200_000;
const MAX_CELL_LENGTH = 2000;
const MAX_ID_LENGTH = 64;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isParsedDocument(structure) {
  return isPlainObject(structure) && structure.ok === true && Array.isArray(structure.tables) && Array.isArray(structure.headings);
}

/** Non-empty, bounded, control-character-free cell text (already 1B-normalized). */
function cleanCell(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (value === "" || value.length > MAX_CELL_LENGTH || CONTROL.test(value)) return null;
  return value;
}

function splitTokens(text) {
  return text.split(/[,;/]+/).map((t) => t.trim()).filter((t) => t !== "");
}

function invalidInput(detail) {
  return deepFreeze({ subject: null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.EVIDENCE_INPUT_INVALID, detail } });
}

/**
 * checkEvidenceModel({ subject, documents, config })
 *   documents  [{ path, structure }], structure = parseMarkdown()'s frozen public
 *              output for that path (never re-parsed)
 *   config     a raw evidence-model config (validated here; see ./config.js)
 */
function checkEvidenceModel(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput("a valid subject is required");
  const subject = input.subject;
  const out = createRecordFactory(subject, "1C");
  const { add, notApplicable } = out;
  const done = () => deepFreeze({ subject, records: out.records, outcome: null });

  if (!Array.isArray(input.documents) || !input.documents.every((d) => isPlainObject(d) && validateRepoRelativePath(d.path).ok)) {
    return invalidInput("documents must be an array of { path, structure } with canonical paths");
  }

  const validated = validateEvidenceModelConfig(input.config);
  if (!validated.ok) {
    add("1C.EVIDENCE.CONFIG", validated.status, validated.reasonCode, "the evidence-model configuration is invalid", {});
    for (const id of ["STRUCTURE", "PREMISES", "PROPAGATION", "PROMOTION_WORDING"]) notApplicable(`1C.EVIDENCE.${id}`, "no usable evidence-model configuration");
    return done();
  }
  const config = validated.config;
  const topRank = config.conclusionStrengths.length - 1;

  // ---- Select evidence tables: a table is recognized when its header contains
  // the configured id and class columns for a selector matching this document path.
  const recognized = []; // { selector, path, table }
  for (const doc of input.documents) {
    const selector = config.tables.find((s) => s.filePatterns.some((p) => matchPathPattern(p, doc.path)));
    if (!selector) continue;
    if (!isParsedDocument(doc.structure)) {
      add("1C.EVIDENCE.CONFIG", STATUS.INCOMPLETE, REASON.EVIDENCE_INPUT_INVALID, "a matching document was not successfully parsed by 1B: evidence cannot be established", { path: doc.path });
      continue;
    }
    for (const table of doc.structure.tables) {
      const hasId = table.header.includes(selector.idColumn);
      const hasClass = table.header.includes(selector.classColumn);
      if (!hasId && !hasClass) continue; // not an evidence table at all
      if (hasClass && !hasId) {
        add("1C.EVIDENCE.CONFIG", STATUS.FAIL, REASON.EVIDENCE_TABLE_MALFORMED, "a table declares the class column without the configured id column", { path: doc.path, line: table.line });
        continue;
      }
      if (hasId && !hasClass) continue; // an id-only table is not an evidence table under this selector
      recognized.push({ selector, path: doc.path, table });
    }
  }
  if (recognized.length === 0) {
    notApplicable("1C.EVIDENCE.CONFIG", "no changed document matches a configured evidence-table selector");
    for (const id of ["STRUCTURE", "PREMISES", "PROPAGATION", "PROMOTION_WORDING"]) notApplicable(`1C.EVIDENCE.${id}`, "no evidence table was recognized");
    return done();
  }
  if (out.records.some((r) => r.status === STATUS.FAIL || r.status === STATUS.INCOMPLETE)) {
    add("1C.EVIDENCE.CONFIG", STATUS.FAIL, REASON.EVIDENCE_TABLE_MALFORMED, "one or more evidence tables or documents could not be used", {});
  } else add("1C.EVIDENCE.CONFIG", STATUS.PASS, REASON.OK, "every matching document parsed and every recognized evidence table is well-formed", { tables: recognized.length });

  // ---- Structural pass: id, class, strength, premises per row.
  let totalRows = 0;
  const structureFindings = [];
  const rowsById = new Map(); // id -> row fact
  const seenIds = new Set();
  for (const { selector, path, table } of recognized) {
    const idx = (name) => (name === null ? -1 : table.header.indexOf(name));
    const idI = idx(selector.idColumn);
    const classI = idx(selector.classColumn);
    const strengthI = idx(selector.strengthColumn);
    const premisesI = idx(selector.premisesColumn);
    const conclusionI = idx(selector.conclusionColumn);
    const independentI = idx(selector.independentColumn);
    for (const row of table.rows) {
      totalRows += 1;
      if (totalRows > MAX_ROWS) {
        add("1C.EVIDENCE.STRUCTURE", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "the number of evidence rows exceeds the supported bound", { checked: totalRows });
        for (const id of ["PREMISES", "PROPAGATION", "PROMOTION_WORDING"]) notApplicable(`1C.EVIDENCE.${id}`, "the evidence-row bound was exceeded");
        return done();
      }
      const cell = (i) => (i >= 0 ? cleanCell(row.cells[i]) : null);
      const idText = cell(idI);
      if (idText === null || idText.length > MAX_ID_LENGTH) {
        structureFindings.push({ path, line: row.line, message: "missing or malformed evidence id", code: REASON.EVIDENCE_ID_MISSING });
        continue;
      }
      if (seenIds.has(idText)) {
        structureFindings.push({ path, line: row.line, message: `duplicate evidence id ${idText}`, code: REASON.EVIDENCE_ID_DUPLICATE });
        continue;
      }
      seenIds.add(idText);

      const classText = cell(classI);
      const classTokens = classText === null ? [] : splitTokens(classText);
      if (classTokens.length === 0) {
        structureFindings.push({ path, line: row.line, message: `${idText}: no evidence class declared`, code: REASON.EVIDENCE_CLASS_MISSING });
        continue;
      }
      if (classTokens.length > 1) {
        structureFindings.push({ path, line: row.line, message: `${idText}: more than one evidence class declared`, code: REASON.EVIDENCE_CLASS_MULTIPLE });
        continue;
      }
      const cls = classTokens[0];
      if (!config.evidenceClasses.includes(cls)) {
        structureFindings.push({ path, line: row.line, message: `${idText}: unknown evidence class ${cls}`, code: REASON.EVIDENCE_CLASS_UNKNOWN });
        continue;
      }

      const strengthText = cell(strengthI);
      let declaredStrength = config.classToStrength[cls];
      if (strengthText !== null) {
        const strengthTokens = splitTokens(strengthText);
        if (strengthTokens.length > 1) {
          structureFindings.push({ path, line: row.line, message: `${idText}: more than one conclusion strength declared`, code: REASON.EVIDENCE_STRENGTH_MULTIPLE });
          continue;
        }
        if (strengthTokens.length === 1) {
          if (!config.conclusionStrengths.includes(strengthTokens[0])) {
            structureFindings.push({ path, line: row.line, message: `${idText}: unknown conclusion strength ${strengthTokens[0]}`, code: REASON.EVIDENCE_STRENGTH_UNKNOWN });
            continue;
          }
          declaredStrength = strengthTokens[0];
        }
      }

      const premisesText = cell(premisesI);
      const premises = premisesText === null ? [] : splitTokens(premisesText).slice(0, MAX_PREMISES_PER_ROW + 1);
      if (premises.length > MAX_PREMISES_PER_ROW) {
        add("1C.EVIDENCE.STRUCTURE", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "a row declares more premises than the supported bound", { path, line: row.line });
        for (const id of ["PREMISES", "PROPAGATION", "PROMOTION_WORDING"]) notApplicable(`1C.EVIDENCE.${id}`, "the premise-count bound was exceeded");
        return done();
      }
      const independent = independentI >= 0 && cell(independentI) !== null;
      const conclusionText = conclusionI >= 0 ? row.cells[conclusionI] || "" : "";
      rowsById.set(idText, { path, line: row.line, class: cls, ownRank: config.conclusionStrengths.indexOf(config.classToStrength[cls]), declaredRank: config.conclusionStrengths.indexOf(declaredStrength), premises, independent, conclusionText });
    }
  }

  if (structureFindings.length > 0) add("1C.EVIDENCE.STRUCTURE", STATUS.FAIL, structureFindings[0].code, `${structureFindings.length} finding(s); see observed.findings`, { count: structureFindings.length, findings: sample(structureFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else add("1C.EVIDENCE.STRUCTURE", STATUS.PASS, REASON.OK, "every recognized evidence row declares exactly one known class and, where declared, exactly one known strength", { checked: rowsById.size });

  // ---- Premise resolution: dangling references, cycles, weakest-premise propagation.
  const budget = { steps: BASE_BUDGET + 8 * totalRows };
  const spend = (n = 1) => {
    budget.steps -= n;
    return budget.steps > 0;
  };
  const danglingFindings = [];
  const cycleFindings = [];
  const overclaimFindings = [];
  const state = new Map(); // id -> "VISITING" | "DONE"
  const memo = new Map(); // id -> { rank, cycle, exhausted }
  let exhausted = false;

  function resolve(id, depth) {
    if (exhausted) return { rank: 0, cycle: false, exhausted: true };
    if (memo.has(id)) return memo.get(id);
    if (depth > MAX_DEPTH || !spend()) {
      exhausted = true;
      return { rank: 0, cycle: false, exhausted: true };
    }
    const row = rowsById.get(id);
    state.set(id, "VISITING");
    let rank = row.ownRank;
    let cycle = false;
    if (!row.independent) {
      for (const premiseId of row.premises) {
        if (!spend()) {
          exhausted = true;
          break;
        }
        if (!rowsById.has(premiseId)) {
          danglingFindings.push({ path: row.path, line: row.line, message: `premise ${premiseId} does not resolve to a known evidence row` });
          rank = 0;
          continue;
        }
        if (state.get(premiseId) === "VISITING") {
          cycle = true;
          rank = 0;
          continue;
        }
        const sub = resolve(premiseId, depth + 1);
        if (sub.exhausted) {
          exhausted = true;
          break;
        }
        if (sub.cycle) cycle = true;
        rank = Math.min(rank, sub.rank);
      }
    }
    state.set(id, "DONE");
    const result = { rank, cycle, exhausted: false };
    memo.set(id, result);
    return result;
  }

  for (const [id, row] of rowsById) {
    if (exhausted) break;
    const result = resolve(id, 0);
    if (result.exhausted) break;
    if (result.cycle) cycleFindings.push({ path: row.path, line: row.line, message: `${id} participates in a cyclic premise relationship` });
    else if (row.declaredRank > result.rank) overclaimFindings.push({ path: row.path, line: row.line, message: `${id} declares a stronger conclusion than its weakest required premise supports (no independent evidence declared)` });
  }

  if (exhausted) {
    add("1C.EVIDENCE.PREMISES", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "premise resolution exceeded its work bound", {});
    notApplicable("1C.EVIDENCE.PROPAGATION", "premise resolution did not complete");
    notApplicable("1C.EVIDENCE.PROMOTION_WORDING", "premise resolution did not complete");
    return done();
  }

  const premiseFindings = [...danglingFindings, ...cycleFindings];
  if (premiseFindings.length > 0) add("1C.EVIDENCE.PREMISES", STATUS.FAIL, danglingFindings.length > 0 ? REASON.EVIDENCE_PREMISE_DANGLING : REASON.EVIDENCE_PREMISE_CYCLE, `${premiseFindings.length} finding(s); see observed.findings`, { count: premiseFindings.length, findings: sample(premiseFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else if (rowsById.size === 0) notApplicable("1C.EVIDENCE.PREMISES", "no evidence row was recognized");
  else add("1C.EVIDENCE.PREMISES", STATUS.PASS, REASON.OK, "every declared premise resolves to exactly one acyclic evidence row", { checked: rowsById.size });

  if (overclaimFindings.length > 0) add("1C.EVIDENCE.PROPAGATION", STATUS.FAIL, REASON.EVIDENCE_STRENGTH_OVERCLAIM, `${overclaimFindings.length} finding(s); see observed.findings`, { count: overclaimFindings.length, findings: sample(overclaimFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else if (rowsById.size === 0) notApplicable("1C.EVIDENCE.PROPAGATION", "no evidence row was recognized");
  else add("1C.EVIDENCE.PROPAGATION", STATUS.PASS, REASON.OK, "no row exceeds what its own evidence class and premises can support", { checked: rowsById.size });

  // ---- Promotion wording: never a semantic judgment, only ever HUMAN_REVIEW_REQUIRED.
  const promotionFindings = [];
  if (config.promotionWords.length > 0) {
    const pattern = new RegExp(`\\b(?:${config.promotionWords.map(escapeRegExp).join("|")})\\b`, "i");
    for (const [id, row] of rowsById) {
      if (!spend()) {
        add("1C.EVIDENCE.PROMOTION_WORDING", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "promotion-wording scanning exceeded its work bound", {});
        return done();
      }
      const text = String(row.conclusionText).slice(0, MAX_CELL_LENGTH);
      if (row.declaredRank < topRank && pattern.test(text)) promotionFindings.push({ path: row.path, line: row.line, message: `${id} uses promotion wording for a conclusion that is not the strongest configured strength` });
    }
    if (promotionFindings.length > 0) add("1C.EVIDENCE.PROMOTION_WORDING", STATUS.HUMAN_REVIEW_REQUIRED, REASON.EVIDENCE_PROMOTION_WORDING, `${promotionFindings.length} finding(s); a human must judge the wording, never the machine; see observed.findings`, { count: promotionFindings.length, findings: sample(promotionFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
    else if (rowsById.size === 0) notApplicable("1C.EVIDENCE.PROMOTION_WORDING", "no evidence row was recognized");
    else add("1C.EVIDENCE.PROMOTION_WORDING", STATUS.PASS, REASON.OK, "no non-strongest conclusion uses configured promotion wording", { checked: rowsById.size });
  } else notApplicable("1C.EVIDENCE.PROMOTION_WORDING", "no promotion word is configured");

  return done();
}

module.exports = { checkEvidenceModel };
