/**
 * GOV-AUTO-1 Wave 2 / 1C -- evidence and provenance validation (design section 18:
 * "Evidence/provenance validation (class vs strength, one class per row, promotion
 * wording, weakest premise)"; non-goal "Semantic sufficiency stays human"). Corrective
 * C1 (Wave 2 HEAVY re-review) hardened this module; see the commit and PR history.
 *
 * checkEvidenceModel() consumes ONLY the public, already-parsed 1B structure
 * (parseMarkdown()'s frozen output) for each supplied document: it never reads a
 * file, never calls Git and never re-parses Markdown. A table is an EVIDENCE
 * TABLE when its header contains the configured id and class column names for a
 * matching document path; every configured selector matching a document is tried
 * (not only the first), and the same physical table is never double-processed
 * under two selectors.
 *
 * It validates exactly four structural invariants and nothing else:
 *   1. every evidence row declares exactly one known evidence class and, if a
 *      strength is declared, exactly one known conclusion strength;
 *   2. every declared premise or independent-evidence reference resolves to
 *      exactly one row, and the combined support graph (premises AND
 *      independent-evidence edges together) is acyclic;
 *   3. a row's declared strength never exceeds what its own evidence class,
 *      its required premises (AND: the weakest wins) and its explicitly
 *      referenced independent evidence (OR: the strongest resolvable reference
 *      wins) can support -- an independent-evidence cell must reference a real,
 *      resolvable row; arbitrary non-empty prose grants no authority by itself;
 *   4. promotion wording (a manifest-declared literal word list) on a row whose
 *      resolved strength is not already the strongest configured value is
 *      flagged for human review -- 1C never decides whether the wording is
 *      actually false.
 * It never judges whether an inference is substantively correct: that is a
 * human, and later-wave, decision.
 *
 * Result shape: the usual frozen { subject, records, outcome } -- nothing else.
 * checked(1D)'s need to bind a specific counted row to a specific 1C fact (design
 * section 18) is met entirely INSIDE `records`: the canonical `1C.EVIDENCE.ROW_INDEX`
 * record carries the bounded per-row projection (one { id, status } entry per
 * recognized row, in `observed.rows`) -- the worst of that row's own structural
 * validity, premise/independent-evidence resolution, propagation and promotion-
 * wording facts. Corrective C1 (W2-DEV-M2 / W2-SEC-L1) first added this projection as
 * a separate top-level `rowIndex` field; corrective C2 (Wave 2 C1 re-review,
 * W2-C1-SEC-H1/M1) removed that field and folded it into this one canonical,
 * validateResultRecord()-validated record instead, because a second, independently
 * suppliable field let a caller assert a row's evidence status with NO corresponding
 * 1C computation at all (an empty `records` array plus a hand-authored `rowIndex`).
 * There is now exactly one place row data can come from. A consumer still cannot
 * cryptographically prove who called checkEvidenceModel() -- nothing here invents
 * provenance the runtime cannot establish -- but it can no longer be handed two
 * disagreeing sources and asked to trust the more convenient one.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { matchPathPattern } = require("../../safety/path-patterns");
const { validateRepoRelativePath } = require("../../safety/repo-path");
const { createRecordFactory, isValidSubject, sample, worseStatus, isValidMarkdownStructure } = require("../common");
const { validateEvidenceModelConfig } = require("./config");

const MAX_ROWS = 5000;
// The compact per-row projection must fit inside ONE canonical result record's `observed`
// (the kernel's bounded-JSON contract caps every array at 1024 entries): 1000 leaves
// headroom for the wrapping object. Structural/premise checking itself still scales to
// MAX_ROWS; only the ROW_INDEX projection has this smaller, separately-reported bound
// (corrective C2, Wave 2 C1 re-review).
const ROW_INDEX_LIMIT = 1000;
const MAX_REFS_PER_ROW = 32;
const MAX_DEPTH = 500;
const BASE_BUDGET = 200_000;
const MAX_CELL_LENGTH = 2000;
const MAX_ID_LENGTH = 64;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Fixed precedence for the STRUCTURE record's representative reasonCode, independent of
// document/row iteration order (corrective C1, W2-DEV-L2): the same set of defects always
// reports the same primary reasonCode, whichever row happens to appear first in the file.
const STRUCTURE_REASON_PRECEDENCE = [
  REASON.EVIDENCE_ID_DUPLICATE,
  REASON.EVIDENCE_ID_MISSING,
  REASON.EVIDENCE_CLASS_MULTIPLE,
  REASON.EVIDENCE_CLASS_UNKNOWN,
  REASON.EVIDENCE_CLASS_MISSING,
  REASON.EVIDENCE_STRENGTH_MULTIPLE,
  REASON.EVIDENCE_STRENGTH_UNKNOWN,
];
const primaryReasonOf = (findings) => STRUCTURE_REASON_PRECEDENCE.find((code) => findings.some((f) => f.code === code)) || findings[0].code;

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
 *              output for that path (runtime-validated here, never re-parsed)
 *   config     a raw evidence-model config (validated here; see ./config.js)
 */
function checkEvidenceModel(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput("a valid subject is required");
  const subject = input.subject;
  const out = createRecordFactory(subject, "1C");
  const { add, notApplicable } = out;
  const done = () => deepFreeze({ subject, records: out.records, outcome: null });
  /**
   * The row-level projection lives ONLY inside this one canonical, validateResultRecord()-
   * validated record -- there is no separate top-level field a caller could supply on its
   * own and have trusted independently (corrective C2 closes W2-C1-SEC-H1/M1: a forged
   * `evidenceResult` can no longer assert a row status with zero corresponding 1C
   * computation, because there is only one place row data can come from). A consumer
   * (1D) still cannot cryptographically prove who called checkEvidenceModel(); the
   * documented trust model is that a structurally valid, internally self-consistent,
   * same-subject 1C result is accepted as internal composition input (design section 18;
   * no stronger provenance is invented).
   */
  function emitRowIndex(complete) {
    if (!complete) return add("1C.EVIDENCE.ROW_INDEX", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "the per-row projection could not be established for every recognized row", { checked: rowsById.size });
    if (rowsById.size === 0) return notApplicable("1C.EVIDENCE.ROW_INDEX", "no evidence row was recognized");
    if (rowsById.size > ROW_INDEX_LIMIT) return add("1C.EVIDENCE.ROW_INDEX", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "the number of recognized rows exceeds the row-index projection bound", { checked: rowsById.size });
    const rows = [...rowsById.keys()].sort().map((id) => ({ id, status: rowIssue.get(id) || STATUS.PASS }));
    add("1C.EVIDENCE.ROW_INDEX", STATUS.PASS, REASON.OK, "one row-status entry per recognized evidence row", { rows });
  }

  if (!Array.isArray(input.documents) || !input.documents.every((d) => isPlainObject(d) && validateRepoRelativePath(d.path).ok)) {
    return invalidInput("documents must be an array of { path, structure } with canonical paths");
  }

  const validated = validateEvidenceModelConfig(input.config);
  if (!validated.ok) {
    add("1C.EVIDENCE.CONFIG", validated.status, validated.reasonCode, "the evidence-model configuration is invalid", {});
    for (const id of ["STRUCTURE", "PREMISES", "PROPAGATION", "PROMOTION_WORDING", "ROW_INDEX"]) notApplicable(`1C.EVIDENCE.${id}`, "no usable evidence-model configuration");
    return done();
  }
  const config = validated.config;
  const topRank = config.conclusionStrengths.length - 1;

  // ---- Select evidence tables: EVERY selector matching a document path is tried (not only
  // the first), and the same physical table object is never recognized twice.
  const recognized = []; // { selector, path, table }
  const claimedTables = new Set();
  for (const doc of input.documents) {
    const matchingSelectors = config.tables.filter((s) => s.filePatterns.some((p) => matchPathPattern(p, doc.path)));
    if (matchingSelectors.length === 0) continue;
    if (!isValidMarkdownStructure(doc.structure)) {
      add("1C.EVIDENCE.CONFIG", STATUS.INCOMPLETE, REASON.EVIDENCE_INPUT_INVALID, "a matching document was not successfully parsed by 1B: evidence cannot be established", { path: doc.path });
      continue;
    }
    for (const table of doc.structure.tables) {
      if (claimedTables.has(table)) continue;
      const selector = matchingSelectors.find((s) => table.header.includes(s.idColumn) || table.header.includes(s.classColumn));
      if (!selector) continue;
      const hasId = table.header.includes(selector.idColumn);
      const hasClass = table.header.includes(selector.classColumn);
      if (hasClass && !hasId) {
        add("1C.EVIDENCE.CONFIG", STATUS.FAIL, REASON.EVIDENCE_TABLE_MALFORMED, "a table declares the class column without the configured id column", { path: doc.path, line: table.line });
        claimedTables.add(table);
        continue;
      }
      if (hasId && !hasClass) continue; // an id-only table is not an evidence table under this selector
      claimedTables.add(table);
      recognized.push({ selector, path: doc.path, table });
    }
  }
  if (recognized.length === 0) {
    notApplicable("1C.EVIDENCE.CONFIG", "no changed document matches a configured evidence-table selector");
    for (const id of ["STRUCTURE", "PREMISES", "PROPAGATION", "PROMOTION_WORDING", "ROW_INDEX"]) notApplicable(`1C.EVIDENCE.${id}`, "no evidence table was recognized");
    return done();
  }
  if (out.records.some((r) => r.status === STATUS.FAIL || r.status === STATUS.INCOMPLETE)) {
    add("1C.EVIDENCE.CONFIG", STATUS.FAIL, REASON.EVIDENCE_TABLE_MALFORMED, "one or more evidence tables or documents could not be used", {});
  } else add("1C.EVIDENCE.CONFIG", STATUS.PASS, REASON.OK, "every matching document parsed and every recognized evidence table is well-formed", { tables: recognized.length });

  // ---- Structural pass: id, class, strength, premises, independent-evidence references.
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
        emitRowIndex(false);
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
      const premises = premisesText === null ? [] : splitTokens(premisesText).slice(0, MAX_REFS_PER_ROW + 1);
      const independentText = cell(independentI);
      const independentRefs = independentText === null ? [] : splitTokens(independentText).slice(0, MAX_REFS_PER_ROW + 1);
      if (premises.length > MAX_REFS_PER_ROW || independentRefs.length > MAX_REFS_PER_ROW) {
        add("1C.EVIDENCE.STRUCTURE", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "a row declares more premise or independent-evidence references than the supported bound", { path, line: row.line });
        for (const id of ["PREMISES", "PROPAGATION", "PROMOTION_WORDING"]) notApplicable(`1C.EVIDENCE.${id}`, "the reference-count bound was exceeded");
        emitRowIndex(false);
        return done();
      }
      const conclusionText = conclusionI >= 0 ? row.cells[conclusionI] || "" : "";
      rowsById.set(idText, { path, line: row.line, class: cls, ownRank: config.conclusionStrengths.indexOf(config.classToStrength[cls]), declaredRank: config.conclusionStrengths.indexOf(declaredStrength), premises, independentRefs, conclusionText });
    }
  }

  if (structureFindings.length > 0) add("1C.EVIDENCE.STRUCTURE", STATUS.FAIL, primaryReasonOf(structureFindings), `${structureFindings.length} finding(s); see observed.findings`, { count: structureFindings.length, findings: sample(structureFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else add("1C.EVIDENCE.STRUCTURE", STATUS.PASS, REASON.OK, "every recognized evidence row declares exactly one known class and, where declared, exactly one known strength", { checked: rowsById.size });

  // ---- Combined support-graph resolution: premises (AND, weakest wins) and independent-
  // evidence references (OR, strongest RESOLVABLE reference wins -- never a bare marker; see
  // corrective C1, W2-SEC-M2). One shared work budget covers the whole call (Wave 1 H1
  // precedent: no nested branch resets it).
  const budget = { steps: BASE_BUDGET + 8 * totalRows };
  const spend = (n = 1) => {
    budget.steps -= n;
    return budget.steps > 0;
  };
  const danglingFindings = [];
  const cycleFindings = [];
  const overclaimFindings = [];
  const rowIssue = new Map(); // id -> worst STATUS contributed by PREMISES/PROPAGATION (not promotion wording)
  const downgrade = (id, status) => rowIssue.set(id, worseStatus(rowIssue.get(id) || STATUS.PASS, status));
  const state = new Map(); // id -> "VISITING" | "DONE"
  const memo = new Map(); // id -> { rank, cycle, exhausted }
  let exhausted = false;

  const EXHAUSTED = { rank: 0, cycle: false, exhausted: true };

  /** kind: "premise" (AND / min, own rank is the starting ceiling) or "independent" (OR /
   * max over resolvable references only -- an unresolvable reference contributes nothing,
   * so it can never grant authority; see the module comment). Returns { value, cycle }. */
  function resolveRefs(refs, row, depth, kind) {
    let combined = kind === "premise" ? row.ownRank : -1;
    let cycle = false;
    for (const refId of refs) {
      if (!spend()) return { value: combined, cycle, exhausted: true };
      if (!rowsById.has(refId)) {
        const label = kind === "premise" ? "premise" : "independent-evidence reference";
        danglingFindings.push({ id: null, path: row.path, line: row.line, message: `${label} ${refId} does not resolve to a known evidence row` });
        if (kind === "premise") combined = 0;
        continue;
      }
      if (state.get(refId) === "VISITING") {
        cycle = true;
        if (kind === "premise") combined = 0;
        continue;
      }
      const sub = resolve(refId, depth + 1);
      if (sub.exhausted) return { value: combined, cycle, exhausted: true };
      if (sub.cycle) cycle = true;
      combined = kind === "premise" ? Math.min(combined, sub.rank) : Math.max(combined, sub.rank);
    }
    return { value: combined, cycle, exhausted: false };
  }

  function resolve(id, depth) {
    if (exhausted) return EXHAUSTED;
    if (memo.has(id)) return memo.get(id);
    if (depth > MAX_DEPTH || !spend()) {
      exhausted = true;
      return EXHAUSTED;
    }
    const row = rowsById.get(id);
    state.set(id, "VISITING");
    const premises = resolveRefs(row.premises, row, depth, "premise");
    if (premises.exhausted) {
      exhausted = true;
      return EXHAUSTED;
    }
    const independent = resolveRefs(row.independentRefs, row, depth, "independent");
    if (independent.exhausted) {
      exhausted = true;
      return EXHAUSTED;
    }
    state.set(id, "DONE");
    const result = { rank: Math.max(premises.value, independent.value), cycle: premises.cycle || independent.cycle, exhausted: false };
    memo.set(id, result);
    return result;
  }

  for (const [id, row] of rowsById) {
    if (exhausted) break;
    const result = resolve(id, 0);
    if (result.exhausted) break;
    for (const f of danglingFindings) if (f.id === null && f.path === row.path && f.line === row.line) f.id = id;
    if (result.cycle) {
      cycleFindings.push({ path: row.path, line: row.line, message: `${id} participates in a cyclic evidence-support relationship` });
      downgrade(id, STATUS.FAIL);
    } else if (row.declaredRank > result.rank) {
      overclaimFindings.push({ path: row.path, line: row.line, message: `${id} declares a stronger conclusion than its premises and independent evidence support` });
      downgrade(id, STATUS.FAIL);
    }
  }
  for (const f of danglingFindings) if (f.id) downgrade(f.id, STATUS.FAIL);

  if (exhausted) {
    add("1C.EVIDENCE.PREMISES", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "premise/independent-evidence resolution exceeded its work bound", {});
    notApplicable("1C.EVIDENCE.PROPAGATION", "premise resolution did not complete");
    notApplicable("1C.EVIDENCE.PROMOTION_WORDING", "premise resolution did not complete");
    emitRowIndex(false);
    return done();
  }

  const premiseFindings = [...danglingFindings, ...cycleFindings];
  if (premiseFindings.length > 0) add("1C.EVIDENCE.PREMISES", STATUS.FAIL, danglingFindings.length > 0 ? REASON.EVIDENCE_PREMISE_DANGLING : REASON.EVIDENCE_PREMISE_CYCLE, `${premiseFindings.length} finding(s); see observed.findings`, { count: premiseFindings.length, findings: sample(premiseFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else if (rowsById.size === 0) notApplicable("1C.EVIDENCE.PREMISES", "no evidence row was recognized");
  else add("1C.EVIDENCE.PREMISES", STATUS.PASS, REASON.OK, "every declared premise and independent-evidence reference resolves to exactly one acyclic evidence row", { checked: rowsById.size });

  if (overclaimFindings.length > 0) add("1C.EVIDENCE.PROPAGATION", STATUS.FAIL, REASON.EVIDENCE_STRENGTH_OVERCLAIM, `${overclaimFindings.length} finding(s); see observed.findings`, { count: overclaimFindings.length, findings: sample(overclaimFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
  else if (rowsById.size === 0) notApplicable("1C.EVIDENCE.PROPAGATION", "no evidence row was recognized");
  else add("1C.EVIDENCE.PROPAGATION", STATUS.PASS, REASON.OK, "no row exceeds what its own evidence class, premises and independent evidence can support", { checked: rowsById.size });

  // ---- Promotion wording: never a semantic judgment, only ever HUMAN_REVIEW_REQUIRED. It DOES
  // downgrade the affected row's own ROW_INDEX entry (via downgrade() below, to HRR): a per-row
  // consumer must see that row's evidence as unresolved, never clean, purely because of wording
  // that a human still needs to judge -- promotion wording is about wording, not evidentiary
  // support, but a flagged row is still a flagged row (corrective C2, W2-C2-DEV-INFO1: this
  // comment previously claimed the opposite).
  const promotionFindings = [];
  if (config.promotionWords.length > 0) {
    const pattern = new RegExp(`\\b(?:${config.promotionWords.map(escapeRegExp).join("|")})\\b`, "i");
    for (const [id, row] of rowsById) {
      if (!spend()) {
        add("1C.EVIDENCE.PROMOTION_WORDING", STATUS.INCOMPLETE, REASON.EVIDENCE_BOUND_EXCEEDED, "promotion-wording scanning exceeded its work bound", {});
        emitRowIndex(false);
        return done();
      }
      const text = String(row.conclusionText).slice(0, MAX_CELL_LENGTH);
      if (row.declaredRank < topRank && pattern.test(text)) {
        promotionFindings.push({ path: row.path, line: row.line, message: `${id} uses promotion wording for a conclusion that is not the strongest configured strength` });
        downgrade(id, STATUS.HUMAN_REVIEW_REQUIRED); // a per-row consumer (1D) must see this row's own evidence as unresolved, never clean
      }
    }
    if (promotionFindings.length > 0) add("1C.EVIDENCE.PROMOTION_WORDING", STATUS.HUMAN_REVIEW_REQUIRED, REASON.EVIDENCE_PROMOTION_WORDING, `${promotionFindings.length} finding(s); a human must judge the wording, never the machine; see observed.findings`, { count: promotionFindings.length, findings: sample(promotionFindings.map((f) => `${f.path}:${f.line}: ${f.message}`), 20) });
    else if (rowsById.size === 0) notApplicable("1C.EVIDENCE.PROMOTION_WORDING", "no evidence row was recognized");
    else add("1C.EVIDENCE.PROMOTION_WORDING", STATUS.PASS, REASON.OK, "no non-strongest conclusion uses configured promotion wording", { checked: rowsById.size });
  } else notApplicable("1C.EVIDENCE.PROMOTION_WORDING", "no promotion word is configured");

  emitRowIndex(true);
  return done();
}

module.exports = { checkEvidenceModel };
