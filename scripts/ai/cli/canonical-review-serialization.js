"use strict";
// CRS-1 and TAP-2 are fixed byte contracts, independent of locale, ICU,
// platform, terminal width and resize history. This module has no gate.
const crypto = require("crypto");
const { parseStrictJson } = require("./strict-json");
const { inputRefused } = require("./errors");
const { recomputeReviewPackageDigest } = require("../test-automation/generated-change-set-review-package");
const DESCRIPTOR = Object.freeze({ presentationVersion: "TAP-2", marker: "@",
  prefixes: Object.freeze(["@Q2:H ", "@Q2:T ", "@Q2:F ", "@Q2:B ", "@Q2:C ", "@Q2:c ", "@Q2:f ", "@Q2:P ", "@Q2:E ", "@Q2:X ", "@Q2:I ", "@Q2:A ", "@Q2:R ", "@Q2:M ", "@Q2:S "]),
  escapeRule: "tap2-utf16-0040-005c-v1", layoutRule: "tap2-layout-10.3-v1", wrapRule: "tap2-greedy-whole-token-10.3.1-v1", sessionRule: "tap2-closed-session-10.3.1-v1", width: 100, minimumRows: 24, pageRows: 20 });
function unsupported() { return inputRefused("REVIEW_SERIALIZATION_UNSUPPORTED", "CRS-1/TAP-2 requires canonical supported data and versions."); }
function escapeTokens(value, { marker = true, quote = false } = {}) {
  if (typeof value !== "string") throw unsupported();
  const out = [];
  for (let i = 0; i < value.length; i++) {
    const u = value.charCodeAt(i);
    out.push(u === 92 ? "\\\\" : quote && u === 34 ? '\\"' : (u < 32 || u > 126 || marker && u === 64) ? `\\u${u.toString(16).padStart(4, "0")}` : value[i]);
  }
  return out;
}
function unescapeValue(value) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") { out += value[i]; continue; }
    if (value[i + 1] === "\\") { out += "\\"; i++; }
    else if (/^u[0-9a-f]{4}$/.test(value.slice(i + 1, i + 6))) { out += String.fromCharCode(parseInt(value.slice(i + 2, i + 6), 16)); i += 5; }
    else throw unsupported();
  }
  return out;
}
function encodeValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return '"' + escapeTokens(value, { marker: false, quote: true }).join("") + '"';
  if (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)) return String(value);
  if (!value || typeof value !== "object" || ancestors.has(value)) throw unsupported();
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw unsupported();
  if (Object.getOwnPropertySymbols(value).length) throw unsupported();
  ancestors.add(value);
  try {
    const keys = Object.keys(value);
    for (const k of keys) if (!/^[\x20-\x7e]*$/.test(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), "value")) throw unsupported();
    if (Array.isArray(value)) {
      if (keys.length !== value.length || keys.some((k, i) => k !== String(i))) throw unsupported();
      return "[" + value.map(v => encodeValue(v, ancestors)).join(",") + "]";
    }
    return "{" + keys.sort().map(k => encodeValue(k) + ":" + encodeValue(value[k], ancestors)).join(",") + "}";
  } finally { ancestors.delete(value); }
}
function digest(domain, bytes) { return `sha256:${crypto.createHash("sha256").update(domain, "ascii").update(bytes).digest("hex")}`; }
function keysEqual(v, keys) { return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)); }
function assertPackage(p) {
  if (!keysEqual(p, ["kind", "schemaVersion", "projectId", "framework", "automationPlanId", "changeSetDigest", "automationPlanDigest", "repositoryContextDigest", "reviewTargets", "packageDigest"]) || p.kind !== "GeneratedChangeSetReviewPackage" || p.schemaVersion !== 1 || !Array.isArray(p.reviewTargets) || p.reviewTargets.length < 1 || p.reviewTargets.length > 100) throw unsupported();
  for (const t of p.reviewTargets) if (!keysEqual(t, ["operation", "path", "purpose", "baseContentDigest", "existingContent", "proposedContent", "proposedContentDigest", "targetDigest"]) || !["CREATE", "MODIFY"].includes(t.operation) || typeof t.proposedContent !== "string" || t.proposedContent.length > 50000 || typeof t.purpose !== "string" || typeof t.path !== "string" || !(t.existingContent === null || typeof t.existingContent === "string" && t.existingContent.length <= 50000)) throw unsupported();
  if (recomputeReviewPackageDigest(p) !== p.packageDigest) throw inputRefused("REVIEW_PACKAGE_DIGEST_MISMATCH", "the review package digest does not match its contents.");
}
function encodeReviewPackage(p) {
  // Encode first so getters, exotic values and noncanonical keys cannot
  // participate in a subsequent digest/presentation with a different value.
  const text = encodeValue({ crsVersion: 1, kind: "CanonicalReviewSerialization", reviewPackage: p });
  assertPackage(p); return Buffer.from(text + "\n", "ascii");
}
function decodeReviewPackage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.at(-1) !== 10 || bytes.subarray(0, -1).some(b => b < 32 || b > 126)) throw unsupported();
  let d;
  try { d = parseStrictJson(bytes.toString("ascii")); } catch { throw unsupported(); }
  if (!keysEqual(d, ["crsVersion", "kind", "reviewPackage"]) || d.crsVersion !== 1 || d.kind !== "CanonicalReviewSerialization" || !encodeReviewPackage(d.reviewPackage).equals(bytes)) throw unsupported();
  return d.reviewPackage;
}
function crsDigest(bytes) { return digest("qa-ai-agent:canonical-review-serialization:v1:", bytes); }
function wrapRow(kind, tokens, number) {
  if (!DESCRIPTOR.prefixes.includes(`@Q2:${kind} `) || !Array.isArray(tokens) || tokens.some(t => typeof t !== "string" || !/^[\x20-\x7e]+$/.test(t) || t.includes("@"))) throw unsupported();
  let prefix = kind === "C" ? `@Q2:C ${number}| ` : `@Q2:${kind} `;
  const continuation = kind === "C" ? `@Q2:c ${number}+ ` : "@Q2:f      + ";
  const rows = []; let row = prefix;
  for (const token of tokens) {
    if (token.length > 87) throw unsupported();
    if (row.length + token.length > 100) { rows.push(row); row = continuation; }
    row += token;
  }
  rows.push(row); return rows;
}
// Fixed templates supply character tokens; dynamic slots supply indivisible
// escapes. A lexical scan of the finished body would split fixed legends wrong.
function rows(kind, ...parts) { return wrapRow(kind, parts.flatMap(p => Array.isArray(p) ? p : [...p])); }
function block(content, label) {
  const lines = content.split("\n"); const finalLF = content.endsWith("\n"); if (finalLF) lines.pop();
  const out = rows("B", label === "EXISTING" ? "--- EXISTING CONTENT (bound repository context) ---" : "+++ PROPOSED CONTENT (model-generated, untrusted) +++");
  lines.forEach((line, i) => out.push(...wrapRow("C", escapeTokens(line), String(i + 1).padStart(5, "0"))));
  const mark = label === "EXISTING" ? "---" : "+++";
  out.push(...rows("B", `${mark} END ${label} (lines=${lines.length}, finalLF=${finalLF ? "yes" : "no"}, codeUnits=${content.length}) ${mark}`)); return out;
}
function escapedCount(s) { if (s === null) return 0; let n = 0; for (let i = 0; i < s.length; i++) { const u = s.charCodeAt(i); if (u < 32 || u > 126 || u === 64 || u === 92) n++; } return n; }
function renderPresentation(input, { runId, ordinal, count }) {
  const bytes = encodeReviewPackage(input); const p = decodeReviewPackage(bytes); const cd = crsDigest(bytes);
  const header = rows("H", "QA-AGENT TRUSTED APPROVAL PRESENTATION TAP-2");
  const fields = [["run", runId], ["package", `${ordinal} of ${count} (generate/review-package-${ordinal}.json)`], ["project", p.projectId], ["framework", p.framework], ["automationPlanId", p.automationPlanId], ["packageDigest", p.packageDigest], ["crsDigest", cd], ["changeSetDigest", p.changeSetDigest], ["automationPlanDigest", p.automationPlanDigest], ["repositoryContextDigest", p.repositoryContextDigest], ["pathPolicy", "PPI-1"], ["targets", String(p.reviewTargets.length)]];
  for (const [label, v] of fields) header.push(...rows("H", `${label}: `, escapeTokens(v)));
  for (const legend of ["escapes: \\uXXXX = one escaped UTF-16 code unit; \\u0040 = reserved marker", "escapes: \\\\ = one literal backslash", "rows: at most 100 columns; nothing is truncated", "rows: C NNNNN| starts content; c NNNNN+ continues it; f continues a field"]) header.push(...rows("H", legend));
  const targets = p.reviewTargets.map((t, i) => {
    const out = rows("T", `=== TARGET ${i + 1}/${p.reviewTargets.length}: `, escapeTokens(t.operation), " ", escapeTokens(t.path));
    for (const [label, v] of [["purpose (model-generated, untrusted)", t.purpose], ["baseContentDigest", t.baseContentDigest || "none"], ["proposedContentDigest", t.proposedContentDigest], ["targetDigest", t.targetDigest]]) out.push(...rows("F", `${label}: `, escapeTokens(v)));
    out.push(...rows("F", `escapedCodeUnits: existing=${escapedCount(t.existingContent)} proposed=${escapedCount(t.proposedContent)}`));
    if (t.operation === "MODIFY") out.push(...block(t.existingContent, "EXISTING"));
    out.push(...block(t.proposedContent, "PROPOSED")); return out;
  });
  const packageRows = Buffer.from([...header, ...targets.flat()].join("\n") + "\n", "ascii");
  const presentationBytes = Buffer.concat([Buffer.from(encodeValue(DESCRIPTOR) + "\n", "ascii"), packageRows]);
  return { header, targets, crsDigest: cd, presentationDigest: digest("qa-ai-agent:trusted-approval-presentation:v2:", presentationBytes) };
}
module.exports = { DESCRIPTOR, encodeValue, encodeReviewPackage, decodeReviewPackage, crsDigest, renderPresentation, escapeTokens, unescapeValue, wrapRow, rows, digest };
