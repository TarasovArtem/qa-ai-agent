/**
 * GOV-AUTO-1 Wave 1 / 1B -- identifier-family reference integrity (design section 6).
 *
 * An ID family is DECLARATIVE data from the validated base policy: a letter prefix,
 * 1..3 digit segments with bounded widths, and a separator. The matcher for a
 * family is built here from those validated parts (escaped prefix, bounded
 * quantifiers, fixed character classes), so a repository can never inject a
 * pattern and the cost of scanning is linear. 1B checks STRUCTURE only: it never
 * infers what an ID means.
 *
 * Contexts are explicit. A candidate inside a fenced block or an inline code span
 * is skipped ONLY when the family lists that context in `ignoreContexts`; there is
 * no global "ignore code". A DEFINITION is an ID that opens a heading
 * (HEADING) or is the whole first cell of a table body row (TABLE_FIRST_CELL);
 * every other well-formed occurrence is a REFERENCE. An occurrence that starts
 * like the family but does not match its grammar is MALFORMED.
 */

"use strict";

const { insideCodeSpan, scanInline, newBudget } = require("./markdown");

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compileFamily(family) {
  const prefix = escapeRegExp(family.prefix);
  const sep = escapeRegExp(family.separator);
  const segment = (s) => `[0-9]{${s.minDigits},${s.maxDigits}}`;
  const grammar = `${prefix}${family.segments.map(segment).join(sep)}`;
  return {
    name: family.family,
    ignoreContexts: new Set(family.ignoreContexts),
    definitionContexts: new Set(family.definitionContexts),
    // A candidate: the family prefix, a digit, then id-like characters (a separator
    // only counts when an alphanumeric follows, so sentence punctuation is not consumed).
    candidate: new RegExp(`(?<![A-Za-z0-9_])${prefix}[0-9](?:[0-9A-Za-z_]|[-.](?=[0-9A-Za-z_]))*`, "g"),
    full: new RegExp(`^${grammar}$`),
  };
}

/**
 * Per-document scan context: ONE work budget shared by every code-span computation for
 * the document (all families, all lines), and the spans cached per line so they are
 * computed at most once and only for lines that actually contain a candidate.
 */
const contexts = new WeakMap();
function contextOf(doc) {
  let ctx = contexts.get(doc);
  if (!ctx) {
    ctx = { budget: newBudget(doc.lines.reduce((n, l) => n + l.length + 1, 0)), spans: new Map() };
    contexts.set(doc, ctx);
  }
  return ctx;
}
function spansOf(ctx, key, text) {
  if (!ctx.spans.has(key)) ctx.spans.set(key, scanInline(text, 0, ctx.budget).codeSpans);
  return ctx.spans.get(key);
}

/** All candidate occurrences on a line: { id, wellFormed, index, context }. */
function scanLine(compiled, line, kind, ctx, key) {
  const found = [];
  let spans = null;
  compiled.candidate.lastIndex = 0;
  for (const match of line.matchAll(compiled.candidate)) {
    if (kind !== "FENCED_CODE" && spans === null) spans = spansOf(ctx, key, line);
    const context = kind === "FENCED_CODE" ? "FENCED_CODE" : insideCodeSpan(spans, match.index) ? "INLINE_CODE" : "TEXT";
    if (compiled.ignoreContexts.has(context)) continue;
    found.push({ token: match[0], wellFormed: compiled.full.test(match[0]), index: match.index, context });
  }
  return found;
}

const stripWrappers = (cell) => cell.replace(/^[\s`*_]+|[\s`*_]+$/g, "");

/**
 * Extract definitions, references and malformed tokens for one family from a
 * parsed document (the internal parseDocument result). Returns plain arrays of
 * { path, line, id | token }.
 */
function extractFamily(compiled, doc, path) {
  const definitions = [];
  const references = [];
  const malformed = [];
  const definedAt = new Set(); // "line:index" of occurrences that ARE definitions
  const ctx = contextOf(doc);

  if (compiled.definitionContexts.has("HEADING")) {
    for (const h of doc.headingsRaw) {
      const text = stripWrappers(h.raw);
      const found = scanLine(compiled, text, "TEXT", ctx, "h" + h.line).find((f) => f.index === 0);
      if (found && found.wellFormed) {
        definitions.push({ path, line: h.line, id: found.token });
        definedAt.add(`${h.line}:heading`);
      }
    }
  }
  if (compiled.definitionContexts.has("TABLE_FIRST_CELL")) {
    for (const table of doc.structure.tables) {
      for (const row of table.rows) {
        const cell = stripWrappers(row.cells[0] || "");
        if (cell !== "" && compiled.full.test(cell)) {
          definitions.push({ path, line: row.line, id: cell });
          definedAt.add(`${row.line}:cell`);
        }
      }
    }
  }
  const headingLines = new Set(doc.structure.headings.map((h) => h.line));
  const definitionCellLines = new Set();
  for (const table of doc.structure.tables) for (const row of table.rows) if (definedAt.has(`${row.line}:cell`)) definitionCellLines.add(row.line);

  const consumed = new Set(); // a defining occurrence is skipped once per line, never more
  for (let i = 0; i < doc.lines.length; i += 1) {
    const kind = doc.kinds[i];
    if (kind === "COMMENT") continue;
    const lineNo = i + 1;
    for (const occurrence of scanLine(compiled, doc.lines[i], kind, ctx, i)) {
      if (!occurrence.wellFormed) {
        malformed.push({ path, line: lineNo, token: occurrence.token.slice(0, 64) });
        continue;
      }
      // The defining occurrence itself is not a reference.
      const isHeadingDefinition = headingLines.has(lineNo) && definedAt.has(`${lineNo}:heading`) && doc.lines[i].replace(/^ {0,3}#{1,6}[ \t]+/, "").replace(/^[`*_\s]+/, "").startsWith(occurrence.token);
      const isCellDefinition = definitionCellLines.has(lineNo) && stripWrappers((doc.lines[i].split("|")[1] || "")) === occurrence.token;
      if ((isHeadingDefinition || isCellDefinition) && !consumed.has(lineNo)) {
        consumed.add(lineNo);
        continue;
      }
      references.push({ path, line: lineNo, id: occurrence.token });
    }
  }
  return { definitions, references, malformed, exhausted: ctx.budget.exhausted };
}

module.exports = { compileFamily, extractFamily };
