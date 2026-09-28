/**
 * GOV-AUTO-1 Wave 3 / 1E -- protected-region selectors and extraction (design
 * section 13; OQ-GA-6 is NON_BLOCKING_IMPLEMENTATION -- this module records the
 * chosen strategy).
 *
 * Implementation decision (OQ-GA-6): the narrowest selector language that is
 * deterministic, bounded, fails closed and can be versioned. Three kinds,
 * chosen by a fixed string prefix so a selector is self-describing and never
 * ambiguous with another kind:
 *
 *   file:<path>                  the whole canonical file content is one region
 *   heading:<path>#<heading text>  the canonical content of exactly one ATX
 *                                   Markdown heading (any level 1-6), up to but
 *                                   not including the next heading whose level
 *                                   is <= its own, or end of file
 *   table-rows:<path>#<heading text>[!orderIndependent]
 *                                   the pipe-table rows (header and separator
 *                                   rows excluded) found inside that heading's
 *                                   region; a trailing `!orderIndependent`
 *                                   marks the set as row-order-insensitive
 *                                   (design section 13 "record-set domains");
 *                                   without it, row order is significant
 *
 * Boundary detection for `heading:`/`table-rows:` is a narrow, self-contained
 * line scan over the SAME canonicalized bytes that get fingerprinted -- never
 * 1B's own parser and never reconstructed Markdown. This is a region-framing
 * concern (1E's own job), not the Markdown semantic integrity 1B owns
 * (fences/tables/links/anchors); it looks only for the ATX heading marker
 * (`^#{1,6}\s`) needed to locate byte boundaries.
 *
 * A selector that cannot resolve to EXACTLY one region -- the heading is
 * absent, or (fail closed, never "take the first match") appears more than
 * once at the same level within scope -- is an extraction failure, never an
 * empty-region fingerprint (design section 13 "missing region").
 */

"use strict";

const { validateRepoRelativePath } = require("../../safety/repo-path");
const { canonicalizeBytes } = require("./fingerprint");

const MAX_SELECTOR_LENGTH = 512;
const MAX_HEADING_TEXT_LENGTH = 300;
const MAX_REGION_BYTES = 4 * 1024 * 1024;
const MAX_ROWS_PER_TABLE = 5000;
const HEADING_LINE = /^(#{1,6})[ \t]+(.*)$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Parse a manifest-declared protectedInputs selector string. Returns
 * { ok: true, kind, path, heading?, orderIndependent? } or { ok: false, reason }.
 * Never throws on hostile input.
 */
function parseSelector(selector) {
  if (typeof selector !== "string" || selector.length === 0 || selector.length > MAX_SELECTOR_LENGTH || CONTROL.test(selector)) {
    return { ok: false, reason: "SELECTOR_INVALID" };
  }
  if (selector.startsWith("file:")) {
    const path = selector.slice("file:".length);
    if (!validateRepoRelativePath(path).ok) return { ok: false, reason: "SELECTOR_INVALID" };
    return { ok: true, kind: "file", path };
  }
  if (selector.startsWith("heading:") || selector.startsWith("table-rows:")) {
    const kind = selector.startsWith("heading:") ? "heading" : "table-rows";
    const rest = selector.slice(selector.indexOf(":") + 1);
    const hashIndex = rest.indexOf("#");
    if (hashIndex < 0) return { ok: false, reason: "SELECTOR_INVALID" };
    const path = rest.slice(0, hashIndex);
    let headingPart = rest.slice(hashIndex + 1);
    let orderIndependent = false;
    if (kind === "table-rows" && headingPart.endsWith("!orderIndependent")) {
      orderIndependent = true;
      headingPart = headingPart.slice(0, -"!orderIndependent".length);
    }
    if (!validateRepoRelativePath(path).ok) return { ok: false, reason: "SELECTOR_INVALID" };
    if (headingPart.length === 0 || headingPart.length > MAX_HEADING_TEXT_LENGTH) return { ok: false, reason: "SELECTOR_INVALID" };
    return kind === "heading"
      ? { ok: true, kind, path, heading: headingPart }
      : { ok: true, kind, path, heading: headingPart, orderIndependent };
  }
  return { ok: false, reason: "SELECTOR_INVALID" };
}

/** Split canonical (LF-only) bytes into lines, each with its own byte span [start, end) excluding the LF. */
function splitLines(canonicalBytes) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < canonicalBytes.length; i += 1) {
    if (canonicalBytes[i] === 0x0a) {
      lines.push({ start, end: i });
      start = i + 1;
    }
  }
  if (start < canonicalBytes.length) lines.push({ start, end: canonicalBytes.length });
  return lines;
}

/** Locate every ATX heading line matching `headingText` exactly (trimmed), fail-closed on ambiguity handled by the caller. */
function findHeadingLines(lines, canonicalBytes, headingText) {
  const matches = [];
  for (let i = 0; i < lines.length; i += 1) {
    const text = canonicalBytes.toString("utf8", lines[i].start, lines[i].end);
    const m = HEADING_LINE.exec(text);
    if (m && m[2].trim() === headingText) matches.push({ index: i, level: m[1].length });
  }
  return matches;
}

/** The byte span of the region starting at heading line `at` (level `level`), ending before the next heading of level <= `level`, or EOF. */
function headingRegionSpan(lines, canonicalBytes, at, level) {
  let endLine = lines.length; // exclusive, in line-index terms
  for (let i = at + 1; i < lines.length; i += 1) {
    const text = canonicalBytes.toString("utf8", lines[i].start, lines[i].end);
    const m = HEADING_LINE.exec(text);
    if (m && m[1].length <= level) {
      endLine = i;
      break;
    }
  }
  const startByte = lines[at].start;
  const endByte = endLine < lines.length ? lines[endLine].start : canonicalBytes.length;
  return { startByte, endByte };
}

/** A pipe-table data row: a line starting with `|` after trimming, excluding the header row and the `---` alignment row. */
function isTableRowLine(text) {
  return /^\s*\|/.test(text);
}
function isAlignmentRowLine(text) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(text) && /-/.test(text);
}
function firstCellId(text) {
  const trimmed = text.trim().replace(/^\|/, "");
  const cell = trimmed.split("|")[0];
  return cell.trim();
}

/**
 * Extract one protected region for a parsed selector, from bytes read via
 * `reader` (a 1A-style { read(path, maxBytes) } head reader, bound to one
 * exact Git identity). Returns:
 *   { ok: true, kind: "single", bytes: Buffer }
 *   { ok: true, kind: "recordSet", rows: [{ id, bytes }], orderIndependent }
 *   { ok: false, reason }
 * Never throws. Never fingerprints an empty region as a substitute for a
 * missing one -- absence is always a distinct failure reason.
 */
async function extractRegion(parsed, reader) {
  const got = await reader.read(parsed.path, MAX_REGION_BYTES);
  if (got.kind === "absent") return { ok: false, reason: "REGION_MISSING" };
  if (got.kind !== "blob") return { ok: false, reason: "REGION_UNREADABLE" };
  const canon = canonicalizeBytes(got.bytes);
  if (!canon.ok) return { ok: false, reason: "INVALID_UTF8" };

  if (parsed.kind === "file") return { ok: true, kind: "single", bytes: canon.bytes };

  const lines = splitLines(canon.bytes);
  const matches = findHeadingLines(lines, canon.bytes, parsed.heading);
  if (matches.length === 0) return { ok: false, reason: "REGION_MISSING" };
  if (matches.length > 1) return { ok: false, reason: "MULTIPLE_REGION_MATCH" };
  const { startByte, endByte } = headingRegionSpan(lines, canon.bytes, matches[0].index, matches[0].level);
  const regionBytes = canon.bytes.subarray(startByte, endByte);

  if (parsed.kind === "heading") return { ok: true, kind: "single", bytes: Buffer.from(regionBytes) };

  // table-rows: scan the region's own lines for pipe-table data rows. A
  // contiguous run of table-row-lines starts with a header row, then (if the
  // very next line is an alignment row) the alignment row; both are skipped.
  // Every following table-row-line in the same contiguous run is a data row;
  // a run ends at the first line that is not a table-row-line, so a new run
  // (a second table in the same region) gets its own header/separator pair.
  const regionLines = splitLines(regionBytes).map(({ start, end }) => regionBytes.toString("utf8", start, end));
  const rows = [];
  const seenIds = new Set();
  let i = 0;
  while (i < regionLines.length) {
    if (!isTableRowLine(regionLines[i])) {
      i += 1;
      continue;
    }
    // Start of a run: expect header then alignment row.
    const headerLine = i;
    const hasAlignment = headerLine + 1 < regionLines.length && isTableRowLine(regionLines[headerLine + 1]) && isAlignmentRowLine(regionLines[headerLine + 1]);
    i = hasAlignment ? headerLine + 2 : headerLine + 1;
    while (i < regionLines.length && isTableRowLine(regionLines[i])) {
      if (rows.length >= MAX_ROWS_PER_TABLE) return { ok: false, reason: "REGION_TOO_LARGE" };
      const text = regionLines[i];
      const id = firstCellId(text);
      if (parsed.orderIndependent) {
        if (id === "" || seenIds.has(id)) return { ok: false, reason: "DUPLICATE_RECORD_ID" };
        seenIds.add(id);
      }
      rows.push({ id, bytes: Buffer.from(text, "utf8") });
      i += 1;
    }
  }
  return { ok: true, kind: "recordSet", rows, orderIndependent: parsed.orderIndependent === true };
}

module.exports = { parseSelector, extractRegion, MAX_SELECTOR_LENGTH, MAX_REGION_BYTES, MAX_ROWS_PER_TABLE };
