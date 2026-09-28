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

function escapeMd(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

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
  lines.push(`> This report is **not** merge authorization, approval or risk acceptance (\`notAuthorization: ${report.notAuthorization}\`). It \`requiresRevalidation\` (\`${report.requiresRevalidation}\`) before any decision reuses it.`, "");

  lines.push(section("Identity", [
    `- Head: \`${escapeMd(gf.head)}\``,
    `- Tree: \`${escapeMd(gf.tree)}\``,
    `- Base: \`${escapeMd(gf.base)}\``,
    `- Branch: \`${escapeMd(gf.branch)}\``,
    `- Review class: \`${escapeMd(report.reviewClass)}\``,
    `- Report schema version: ${report.schemaVersion}`,
    `- Finalized (Phase 2): ${report.finalized}`,
  ]));

  lines.push(section("Readiness", [
    `- Overall status: \`${escapeMd(report.overallStatus)}\``,
    `- Readiness state: \`${escapeMd(report.readiness.state)}\``,
    `- Dominant status: \`${escapeMd(report.readiness.dominantStatus)}\``,
  ]));

  const countRows = Object.entries(report.counts).filter(([, n]) => n > 0).map(([status, n]) => `| ${escapeMd(status)} | ${n} |`);
  lines.push(section("Counts", ["| Status | Count |", "|---|---|", ...(countRows.length > 0 ? countRows : ["| (none) | 0 |"])]));

  const ciLines = report.ci.state === "NOT_COLLECTED"
    ? ["- CI evidence: **not yet collected** (Phase 1 report; readiness cannot be final)"]
    : [`- CI evidence: \`${JSON.stringify(report.ci).slice(0, 300)}\``];
  lines.push(section("CI Evidence", ciLines));

  const domainRows = report.domains.map((d) => `| ${escapeMd(d.domainId)} | ${escapeMd(d.effectiveLevel)} | ${escapeMd(d.reasons.join(", "))} |`);
  lines.push(section("Domains", ["| Domain | Effective Level | Reasons |", "|---|---|---|", ...(domainRows.length > 0 ? domainRows : ["| (none) | - | - |"])]));

  const hrrLines = report.humanReviewRequired.length > 0 ? report.humanReviewRequired.map((id) => `- \`${escapeMd(id)}\``) : ["- (none)"];
  lines.push(section("Human Review Required", hrrLines));

  const recordRows = report.records.map((r) => `| ${escapeMd(r.checkId)} | ${escapeMd(r.ownerStage)} | ${escapeMd(r.status)} | ${escapeMd(r.reasonCode)} |`);
  lines.push(section("Records", ["| Check ID | Owner | Status | Reason |", "|---|---|---|---|", ...(recordRows.length > 0 ? recordRows : ["| (none) | - | - | - |"])]));

  return lines.join("\n");
}

module.exports = { renderMarkdown };
