"use strict";
// The one clock/environment-free authority derivation. Inputs are a fresh,
// complete root inventory and manifest-verified evidence. No UI verdict,
// persisted status or process-local completion overrides this function.
const { closed, timestamp, HASH, ORDINAL } = require("./review-record-v2");
const CLAIM = /^claim-([0-9]{4})\.json$/;
const RECORD = /^record-([0-9]{4})-([0-9a-f]{32})\.json$/;
const APPLY = /^(attempt|applied|outcome)-([0-9]{4})-([0-9a-f]{32})\.json$/;
const RESULTS = Object.freeze(["NOT_ENTERED", "REFUSED_NO_WRITE", "APPLIED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE", "UNKNOWN"]);
function state(name, reason, active) { return { state: name, ...(reason ? { reason } : {}), ...(active ? { active } : {}) }; }
function validOutcome(o) {
  if (!closed(o, ["kind", "schemaVersion", "packageOrdinal", "recordId", "result", "appliedRecordSha256", "completedAt"]) || o.kind !== "QaAgentApplyOutcome" || o.schemaVersion !== 1 || !ORDINAL.test(o.packageOrdinal) || !/^[0-9a-f]{32}$/.test(o.recordId) || !RESULTS.includes(o.result) || !(o.appliedRecordSha256 === null || typeof o.appliedRecordSha256 === "string" && HASH.test(o.appliedRecordSha256)) || !timestamp(o.completedAt)) return false;
  if (["APPLIED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"].includes(o.result)) return o.appliedRecordSha256 !== null;
  if (["NOT_ENTERED", "REFUSED_NO_WRITE"].includes(o.result)) return o.appliedRecordSha256 === null;
  return true;
}
function inspectEvidence(n, evidence) {
  const invalid = () => ({ valid: false });
  if (!evidence || !ORDINAL.test(n)) return invalid();
  const { runRootInventory, ledger, stages, reviewEntries, applyEntries } = evidence;
  if (![runRootInventory, ledger, stages, reviewEntries, applyEntries].every(Array.isArray) || ledger.length > 9999 || stages.length < 1 || stages.length > 3 || stages.some((s, i) => s !== ["design", "plan", "generate"][i])) return invalid();
  const names = new Set(); let hasTemp = false;
  for (const e of runRootInventory) {
    if (!e || typeof e.name !== "string" || names.has(e.name) || e.readable === false) return invalid(); names.add(e.name);
    if (["design", "plan", "generate", "review", "apply"].includes(e.name)) { if (e.kind !== "directory") return invalid(); }
    else if (e.name === "manifest.json") { if (e.kind !== "file") return invalid(); }
    else {
      const m = /^manifest\.next-([0-9]{4})\.json$/.exec(e.name);
      if (!m || m[0].length !== e.name.length || e.kind !== "file" || hasTemp || !ORDINAL.test(m[1]) || Number(m[1]) !== ledger.length + 1) return invalid();
      hasTemp = true;
    }
  }
  if (!names.has("manifest.json") || stages.some(s => !names.has(s)) || ledger.length && !names.has("review") || reviewEntries.length && !names.has("review") || applyEntries.length && !names.has("apply")) return invalid();
  const claims = new Map(), records = new Map(); let orphan = false; const reviewNames = new Set();
  for (const e of reviewEntries) {
    if (!e || e.kind !== "file" || e.readable === false || reviewNames.has(e.name)) return invalid(); reviewNames.add(e.name);
    let m = CLAIM.exec(e.name);
    if (m && m[0].length === e.name.length && ORDINAL.test(m[1])) {
      const index = Number(m[1]); claims.set(index, e.value); if (index > ledger.length) orphan = true;
    } else {
      m = RECORD.exec(e.name); if (!m || m[0].length !== e.name.length || !ORDINAL.test(m[1])) return invalid(); records.set(e.name, e);
    }
  }
  const ids = new Set();
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    if (!closed(e, ["ledgerIndex", "packageOrdinal", "recordPath", "recordSha256", "recordId", "decision", "decidedAt"]) || e.ledgerIndex !== i + 1 || !ORDINAL.test(e.packageOrdinal) || !/^[0-9a-f]{32}$/.test(e.recordId) || ids.has(e.recordId) || !["APPROVE", "REJECT"].includes(e.decision) || !HASH.test(e.recordSha256) || !timestamp(e.decidedAt) || e.recordPath !== `review/record-${e.packageOrdinal}-${e.recordId}.json`) return invalid(); ids.add(e.recordId);
    const claim = claims.get(i + 1), record = records.get(e.recordPath.slice(7));
    if (!closed(claim, ["ledgerIndex", "packageOrdinal", "recordId"]) || claim.ledgerIndex !== e.ledgerIndex || claim.packageOrdinal !== e.packageOrdinal || claim.recordId !== e.recordId || !record || record.sha256 !== e.recordSha256 || record.recordValid !== true) return invalid();
  }
  // An unreferenced record can occur only in an incomplete claim section.
  if (!orphan && [...records.keys()].some(name => !ledger.some(e => e.recordPath === `review/${name}`))) return invalid();
  const attempts = new Set(), outcomes = [], applyNames = new Set(), applied = new Map();
  for (const e of applyEntries) {
    if (!e || e.kind !== "file" || e.readable === false || applyNames.has(e.name)) return invalid(); applyNames.add(e.name);
    const m = APPLY.exec(e.name); if (!m || m[0].length !== e.name.length || !ORDINAL.test(m[2])) return invalid();
    const key = `${m[2]}-${m[3]}`;
    if (m[1] === "attempt") attempts.add(key); // bytes deliberately irrelevant
    if (m[1] === "applied") applied.set(key, e);
    if (m[1] === "outcome") outcomes.push({ key, ordinal: m[2], id: m[3], value: e.value });
  }
  for (const o of outcomes) {
    if (!attempts.has(o.key)) return invalid();
    if (validOutcome(o.value) && (o.value.packageOrdinal !== o.ordinal || o.value.recordId !== o.id || o.value.appliedRecordSha256 !== null && (!applied.has(o.key) || applied.get(o.key).sha256 !== o.value.appliedRecordSha256))) return invalid();
  }
  for (const key of applied.keys()) if (!attempts.has(key)) return invalid();
  return { valid: true, ledger, claims, records, orphan, hasTemp, attempts, outcomes, applied };
}
function validatePostReservationFence(n, evidence, { ledgerLength, recordId } = {}) {
  const facts = inspectEvidence(n, evidence);
  if (!facts.valid || facts.ledger.length !== ledgerLength || !facts.attempts.has(`${n}-${recordId}`)) return { ok: false, code: "RUN_STATE_INCONSISTENT" };
  if (facts.orphan || facts.hasTemp) return { ok: false, code: "APPROVAL_NOT_FOUND" };
  return { ok: true };
}
function derivePackageState(n, evidence) {
  const facts = inspectEvidence(n, evidence);
  if (!facts.valid) return state("INCONSISTENT", "RUN_STATE_INCONSISTENT");
  const { ledger, attempts, outcomes, applied, orphan, hasTemp } = facts;
  if (orphan || hasTemp) return state("QUARANTINED", "LEDGER_INCOMPLETE");
  const packageAttempts = [...attempts].filter(k => k.startsWith(`${n}-`));
  const packageOutcomes = outcomes.filter(o => o.ordinal === n);
  if (packageAttempts.some(k => !packageOutcomes.some(o => o.key === k))) return state("QUARANTINED", "UNKNOWN_OUTCOME");
  if (packageOutcomes.some(o => !validOutcome(o.value) || ["ROLLBACK_INCOMPLETE", "UNKNOWN"].includes(o.value.result))) return state("QUARANTINED", "UNKNOWN_OUTCOME");
  if (packageOutcomes.some(o => o.value.result === "APPLIED")) return state("APPLIED");
  const active = ledger.filter(e => e.packageOrdinal === n).at(-1);
  if (!active) return state("UNREVIEWED");
  if (attempts.has(`${n}-${active.recordId}`)) return state("CONSUMED");
  if (active.decision === "REJECT") return state("REJECTED", undefined, active);
  return state("APPROVED", undefined, active);
}
module.exports = { derivePackageState, validatePostReservationFence, validOutcome, RESULTS };
