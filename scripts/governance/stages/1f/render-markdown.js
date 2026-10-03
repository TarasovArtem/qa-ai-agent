/**
 * GOV-AUTO-1 Wave 4 / 1F -- deterministic pre-review.md rendering (design
 * section 23: "pre-review.md is a derived view rendered only from the
 * JSON"). This module computes nothing: every fact it prints already exists
 * on the report object buildReport() produced. It never independently
 * decides readiness, never invents a fact absent from the JSON, never hides
 * a failing record, and never omits a HUMAN_REVIEW_REQUIRED item. It also
 * never renders a value that could be mistaken for merge authorization: the
 * `notAuthorization` and `requiresRevalidation` disclaimers are always
 * printed, never conditionally suppressed.
 *
 * Determinism: fixed section order, records/domains sorted by the same key
 * the report itself already sorted them by (this module never re-sorts),
 * no timestamp anywhere in the body except the report's own `generatedAt`
 * if present (rendered verbatim, never computed here).
 */

"use strict";

const { isPlainObject } = require("../../kernel/validation");
const { cleanText } = require("../common");

/**
 * Corrective C1 (1G S-1): every value this view prints is rendered as an inert
 * Markdown code span, never as Markdown source. A value can come from Git (a
 * branch name the PR author chose) or from a caller-assembled report, so it is
 * untrusted display text:
 *   - cleanText() (the one canonical sanitizer, stages/common.js) turns every
 *     control, CR/LF, bidirectional-override and zero-width character into a
 *     visible escape, so a value can neither forge a line nor reorder the
 *     surrounding text;
 *   - the backtick fence is one longer than the longest backtick run inside the
 *     value (the CommonMark code-span rule), so a value can never close its own
 *     span and turn the rest of the line into live Markdown (bold text, links,
 *     a fake "Readiness state: READY" or "APPROVED FOR MERGE");
 *   - a pipe is escaped only inside a table cell, where GFM would otherwise
 *     split the cell even within a code span.
 * One padding space is added only where CommonMark would otherwise misread the
 * span (empty, or starting/ending with a backtick, or with spaces on both
 * sides); the renderer strips it again, so a plain value such as FAIL still
 * reads exactly `FAIL`.
 */
function codeSpan(value, { table = false } = {}) {
  let text = cleanText(String(value));
  if (table) text = text.replace(/\|/g, "\\|");
  const longestRun = (text.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const pad = text.length === 0 || text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ")) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

const cell = (value) => codeSpan(value, { table: true });

function section(title, lines) {
  return [`## ${title}`, "", ...lines, ""].join("\n");
}

/**
 * renderMarkdown(report) -> string
 *
 * `report` must be exactly a buildReport() output's `.report` value (or an
 * equally-shaped, already-validated object) -- this function does not
 * validate the full pre-review.json schema itself (buildReport() already
 * did that); it only requires the specific fields it reads to be present
 * and of the expected type, and fails closed (throws a fixed, bounded
 * error) rather than silently rendering a fact it can partially see.
 */
function renderMarkdown(report) {
  if (!isPlainObject(report)) throw new Error("renderMarkdown: report must be an object");
  for (const key of ["schemaVersion", "generatedFor", "reviewClass", "records", "domains", "ci", "humanReviewRequired", "counts", "overallStatus", "readiness", "notAuthorization", "requiresRevalidation", "finalized"]) {
    if (!Object.hasOwn(report, key)) throw new Error(`renderMarkdown: report is missing required field ${key}`);
  }

  const gf = report.generatedFor;
  const lines = [];
  lines.push("# GOV-AUTO-1 Pre-Review Report", "");
  lines.push(`> This report is **not** merge authorization, approval or risk acceptance (${codeSpan(`notAuthorization: ${report.notAuthorization}`)}). It \`requiresRevalidation\` (${codeSpan(report.requiresRevalidation)}) before any decision reuses it.`, "");

  lines.push(section("Identity", [
    `- Head: ${codeSpan(gf.head)}`,
    `- Tree: ${codeSpan(gf.tree)}`,
    `- Base: ${codeSpan(gf.base)}`,
    `- Branch: ${codeSpan(gf.branch)}`,
    `- Review class: ${codeSpan(report.reviewClass)}`,
    `- Report schema version: ${codeSpan(report.schemaVersion)}`,
    `- Finalized (Phase 2): ${codeSpan(report.finalized)}`,
  ]));

  lines.push(section("Readiness", [
    `- Overall status: ${codeSpan(report.overallStatus)}`,
    `- Readiness state: ${codeSpan(report.readiness.state)}`,
    `- Dominant status: ${codeSpan(report.readiness.dominantStatus)}`,
  ]));

  const countRows = Object.entries(report.counts).filter(([, n]) => n > 0).map(([status, n]) => `| ${cell(status)} | ${cell(n)} |`);
  lines.push(section("Counts", ["| Status | Count |", "|---|---|", ...(countRows.length > 0 ? countRows : ["| (none) | 0 |"])]));

  const ciLines = report.ci.state === "NOT_COLLECTED"
    ? ["- CI evidence: **not yet collected** (Phase 1 report; readiness cannot be final)"]
    : [`- CI evidence: ${codeSpan(JSON.stringify(report.ci).slice(0, 300))}`];
  lines.push(section("CI Evidence", ciLines));

  const domainRows = report.domains.map((d) => `| ${cell(d.domainId)} | ${cell(d.effectiveLevel)} | ${cell(d.reasons.join(", "))} |`);
  lines.push(section("Domains", ["| Domain | Effective Level | Reasons |", "|---|---|---|", ...(domainRows.length > 0 ? domainRows : ["| (none) | - | - |"])]));

  const hrrLines = report.humanReviewRequired.length > 0 ? report.humanReviewRequired.map((id) => `- ${codeSpan(id)}`) : ["- (none)"];
  lines.push(section("Human Review Required", hrrLines));

  const recordRows = report.records.map((r) => `| ${cell(r.checkId)} | ${cell(r.ownerStage)} | ${cell(r.status)} | ${cell(r.reasonCode)} |`);
  lines.push(section("Records", ["| Check ID | Owner | Status | Reason |", "|---|---|---|---|", ...(recordRows.length > 0 ? recordRows : ["| (none) | - | - | - |"])]));

  return lines.join("\n");
}

module.exports = { renderMarkdown };
