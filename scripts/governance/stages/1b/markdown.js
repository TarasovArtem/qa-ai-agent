/**
 * GOV-AUTO-1 Wave 1 / 1B -- parser-aware Markdown structure (design sections 6, 18).
 *
 * This is the single Markdown parser: later stages (1C, 1D, 1E) consume its
 * structure and never re-parse. It is a bounded, linear, non-recursive-per-line
 * scanner for the structure the repository's integrity checks need; it is NOT a
 * full CommonMark renderer and it makes no semantic judgment about wording.
 *
 * Block structure modeled: fenced code blocks (backtick and tilde fences of any
 * length >= 3, info strings, closing-fence rules, unclosed fences), ATX headings
 * with GitHub-compatible anchors (duplicate suffixes included), GFM tables
 * (parser-aware cell splitting), link reference definitions, HTML comments.
 * Inline structure modeled: backslash escapes, code spans of any backtick-run
 * length, inline/image links with balanced brackets and parentheses, reference
 * links, autolinks.
 *
 * Deliberate, documented limits (behaviour is deterministic, never guessed):
 *   - indented code blocks and setext headings are not modeled; a fence marker at
 *     any indentation opens a fence (so fences nested in lists work);
 *   - shortcut reference links (`[label]` alone) and raw HTML links are not
 *     extracted; external URLs are structural only (no liveness);
 *   - a `|` inside a code span does NOT split a table cell (repository contract),
 *     while an escaped `\|` never does either.
 * Markdown is DATA: it is never executed, imported or interpreted as code.
 */

"use strict";

const { REASON, deepFreeze } = require("../../kernel/contracts");
const { createSlugger } = require("./slug");

const MAX_BYTES = 1024 * 1024;
const MAX_LINES = 50_000;
const MAX_HEADINGS = 5000;
const MAX_LINKS = 20_000;
const MAX_TABLES = 2000;
const MAX_LINE_LENGTH = 32_768;
const MAX_BRACKET_TEXT = 2000;
const MAX_PAREN_DEPTH = 32;

const FENCE_OPEN = /^( *)(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const DEFINITION = /^ {0,3}\[([^\]\n]{1,999})\]:[ \t]*(<[^>\n]*>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/;
// Block starts that END a table (GFM: "the table is broken at the first empty line, or
// beginning of another block-level structure"). Anything else, including a plain
// paragraph line, is still a table row.
const LIST_ITEM = /^ {0,3}(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$)/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const HTML_BLOCK_NAMES = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const HTML_BLOCK_START = new RegExp("^ {0,3}(?:<(?:script|pre|style|textarea)(?:[ \\t>]|$)|<!--|<\\?|<![A-Za-z]|<!\\[CDATA\\[|</?(?:" + HTML_BLOCK_NAMES + ")(?:[ \\t]|/?>|$))", "i");
// A complete open or closing tag alone on the line (CommonMark HTML block type 7); bounded so it stays cheap.
const HTML_LONE_TAG = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/;
const endsTable = (row) => LIST_ITEM.test(row) || THEMATIC_BREAK.test(row) || HTML_BLOCK_START.test(row) || (row.length <= 500 && HTML_LONE_TAG.test(row));
const AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/;
const HTML_TAG = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const isBlank = (line) => /^[ \t]*$/.test(line);

function decodeEntities(text) {
  return text.replace(/&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,8}));/g, (m, dec, hex, name) => {
    if (name) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : m;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const BASE_SCAN_STEPS = 1_000_000;
const STEPS_PER_CHAR = 8;

/**
 * ONE work budget for a whole parse operation. Every scanning loop (the inline
 * scan, bracket matching, code-span searches and table-row splitting) spends from the
 * SAME budget object, including the recursive scan of link text: nested constructs can
 * never restart the count, so total work is O(input) whatever the nesting. The budget
 * is internal (never exposed publicly). Exhausting it makes the document FAIL CLOSED
 * with MARKDOWN_BOUND_EXCEEDED: links are never silently dropped.
 */
function newBudget(length) {
  return { steps: BASE_SCAN_STEPS + STEPS_PER_CHAR * length, exhausted: false };
}

/** Spend `n` steps; false (and the budget is marked exhausted) once nothing is left. */
function spend(budget, n = 1) {
  budget.steps -= n;
  if (budget.steps <= 0) {
    budget.exhausted = true;
    return false;
  }
  return true;
}

/**
 * Per-text scan state: the shared budget plus a failed-code-span cache. The cache is
 * positional and therefore local to one text: a failed search is remembered by run
 * length (the smallest opener position that failed; any later opener of that length
 * must fail too), which keeps repeated failed searches linear.
 */
function newScanState(budget) {
  return { budget, failedFrom: new Map() };
}

/** Index just past a code span starting at `i` (a backtick), or null when unmatched. */
function codeSpanEnd(text, i, state) {
  let run = 0;
  while (text[i + run] === "`") run += 1;
  if (state.failedFrom.has(run) && i >= state.failedFrom.get(run)) return null;
  let j = i + run;
  while (j < text.length) {
    if (text[j] === "`") {
      let k = 0;
      while (text[j + k] === "`") k += 1;
      if (k === run) {
        if (!spend(state.budget, j + k - i)) return null;
        return { end: j + k, contentStart: i + run, contentEnd: j, run };
      }
      j += k;
    } else j += 1;
  }
  spend(state.budget, j - i);
  state.failedFrom.set(run, Math.min(i, state.failedFrom.has(run) ? state.failedFrom.get(run) : i));
  return null;
}

/** Index of the `]` matching the `[` at `open`, skipping escapes and code spans; -1 if none. */
function matchBracket(text, open, state) {
  let depth = 0;
  for (let i = open; i < text.length && i - open <= MAX_BRACKET_TEXT; i += 1) {
    if (!spend(state.budget)) return -1;
    const c = text[i];
    if (c === "\\") i += 1;
    else if (c === "`") {
      const span = codeSpanEnd(text, i, state);
      if (span) i = span.end - 1;
      else while (text[i + 1] === "`") i += 1;
    } else if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse `(destination "title")` starting at the `(`; returns { destination, end } or null. */
function parseInlineTarget(text, open) {
  let i = open + 1;
  const skip = () => {
    while (text[i] === " " || text[i] === "\t") i += 1;
  };
  skip();
  let destination = "";
  if (text[i] === "<") {
    const close = text.indexOf(">", i + 1);
    if (close < 0 || text.slice(i + 1, close).includes("<")) return null;
    destination = text.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    while (i < text.length && text[i] !== " " && text[i] !== "\t") {
      const c = text[i];
      if (c === "\\" && i + 1 < text.length && ASCII_PUNCT.test(text[i + 1])) {
        destination += text[i + 1];
        i += 2;
        continue;
      }
      if (c === "(") {
        depth += 1;
        if (depth > MAX_PAREN_DEPTH) return null;
      } else if (c === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      destination += c;
      i += 1;
    }
    if (depth !== 0) return null;
  }
  skip();
  if (text[i] === '"' || text[i] === "'" || text[i] === "(") {
    const closer = text[i] === "(" ? ")" : text[i];
    let j = i + 1;
    while (j < text.length && text[j] !== closer) j += text[j] === "\\" ? 2 : 1;
    if (j >= text.length) return null;
    i = j + 1;
    skip();
  }
  if (text[i] !== ")") return null;
  return { destination, end: i + 1 };
}

/** `_` that is an emphasis delimiter (word boundary) vanishes when rendered; intra-word `_` stays. */
function stripEmphasisUnderscores(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "_") {
      out += text[i];
      continue;
    }
    const prev = i > 0 ? text[i - 1] : " ";
    const next = i + 1 < text.length ? text[i + 1] : " ";
    const wordBefore = /[\p{L}\p{N}]/u.test(prev);
    const wordAfter = /[\p{L}\p{N}]/u.test(next);
    if (wordBefore && wordAfter) out += "_"; // intra-word
    else if (!wordBefore && !wordAfter && prev !== "_" && next !== "_") out += "_"; // isolated literal
    // else: a boundary underscore (emphasis delimiter) is dropped
  }
  return out;
}

/**
 * One inline pass: code spans, links/images, autolinks, and the RENDERED plain text
 * (used for heading anchors). `depth` bounds the recursion into link text.
 */
function scanInline(text, depth = 0, budget = null) {
  const state = newScanState(budget || newBudget(text.length));
  const links = [];
  const codeSpans = [];
  const parts = []; // { text, literal }
  let buffer = "";
  const flush = () => {
    if (buffer) parts.push({ text: buffer, literal: false });
    buffer = "";
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (!spend(state.budget)) break;
    const c = text[i];
    if (c === "\\" && i + 1 < n && ASCII_PUNCT.test(text[i + 1])) {
      flush();
      parts.push({ text: text[i + 1], literal: true });
      i += 2;
    } else if (c === "`") {
      const span = codeSpanEnd(text, i, state);
      if (span) {
        flush();
        let content = text.slice(span.contentStart, span.contentEnd).replace(/\n/g, " ");
        if (content.length > 2 && content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "") content = content.slice(1, -1);
        codeSpans.push({ start: i, end: span.end });
        parts.push({ text: content, literal: true });
        i = span.end;
      } else {
        let k = 0;
        while (text[i + k] === "`") k += 1;
        buffer += text.slice(i, i + k);
        i += k;
      }
    } else if ((c === "[" || (c === "!" && text[i + 1] === "[")) && depth < 3) {
      const isImage = c === "!";
      const open = isImage ? i + 1 : i;
      const close = matchBracket(text, open, state);
      let consumed = null;
      if (close > 0) {
        const inner = text.slice(open + 1, close);
        const sub = scanInline(inner, depth + 1, state.budget);
        if (text[close + 1] === "(") {
          const target = parseInlineTarget(text, close + 1);
          if (target) consumed = { end: target.end, kind: isImage ? "image" : "inline", destination: target.destination, label: null, plain: sub.plain };
        } else if (text[close + 1] === "[") {
          const labelEnd = text.indexOf("]", close + 2);
          if (labelEnd > 0 && labelEnd - close <= 1000) {
            const label = labelEnd === close + 2 ? inner : text.slice(close + 2, labelEnd);
            consumed = { end: labelEnd + 1, kind: isImage ? "image" : "reference", destination: null, label, plain: sub.plain };
          }
        }
      }
      if (consumed) {
        flush();
        links.push({ kind: consumed.kind, destination: consumed.destination, label: consumed.label, offset: i });
        parts.push({ text: consumed.plain, literal: false });
        i = consumed.end;
      } else {
        buffer += c;
        i += 1;
      }
    } else if (c === "<" && text.startsWith("<!--", i) && text.indexOf("-->", i + 4) >= 0) {
      flush();
      i = text.indexOf("-->", i + 4) + 3; // an inline HTML comment renders nothing
    } else if (c === "<") {
      const auto = AUTOLINK.exec(text.slice(i, i + 2100));
      if (auto) {
        flush();
        links.push({ kind: "autolink", destination: auto[1], label: null, offset: i });
        parts.push({ text: auto[1], literal: false });
        i += auto[0].length;
      } else {
        const tag = HTML_TAG.exec(text.slice(i, i + 2100));
        if (tag) i += tag[0].length; // raw inline HTML renders no text
        else {
          buffer += c;
          i += 1;
        }
      }
    } else {
      buffer += c;
      i += 1;
    }
  }
  flush();
  const plain = parts.map((p) => (p.literal ? p.text : stripEmphasisUnderscores(decodeEntities(p.text)))).join("");
  return { links, codeSpans, plain, exhausted: state.budget.exhausted };
}

/** True when `pos` lies inside one of the code spans. */
function insideCodeSpan(codeSpans, pos) {
  return codeSpans.some((s) => pos >= s.start && pos < s.end);
}

/** Split a table row on unescaped pipes outside code spans; trims cells and outer pipes. */
function splitTableRow(line, budget = null) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  const cells = [];
  const state = newScanState(budget || newBudget(text.length));
  let current = "";
  let i = 0;
  while (i < text.length) {
    if (!spend(state.budget)) break;
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      current += c + text[i + 1];
      i += 2;
    } else if (c === "`") {
      const span = codeSpanEnd(text, i, state);
      if (span) {
        current += text.slice(i, span.end);
        i = span.end;
      } else {
        current += c;
        i += 1;
      }
    } else if (c === "|") {
      cells.push(current.trim());
      current = "";
      i += 1;
    } else {
      current += c;
      i += 1;
    }
  }
  if (current.trim() !== "" || !line.trim().endsWith("|")) cells.push(current.trim());
  return cells;
}

const hasTablePipe = (line, budget) => splitTableRow(line, budget).length > 1 || (line.trim().startsWith("|") && line.trim().length > 1);

function failure(reasonCode, detail) {
  return { ok: false, reasonCode, detail };
}

/**
 * Parse into the internal document (structure + per-line data). `parseMarkdown`
 * exposes only the frozen structure; 1B's own checks also use `lines`.
 */
function parseDocument(input) {
  if (input === null || typeof input !== "object") return failure(REASON.MARKDOWN_STRUCTURE_INVALID, "input must be an object");
  let text = input.text;
  if (typeof text !== "string") {
    const bytes = input.bytes;
    if (!(bytes instanceof Uint8Array)) return failure(REASON.MARKDOWN_STRUCTURE_INVALID, "bytes or text is required");
    if (bytes.length > MAX_BYTES) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "the document exceeds the size bound");
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      return failure(REASON.MARKDOWN_ENCODING_INVALID, "the document is not valid UTF-8");
    }
  }
  if (text.length > MAX_BYTES) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "the document exceeds the size bound");
  const path = typeof input.path === "string" ? input.path : "";
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (lines.length > MAX_LINES) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "the document has too many lines");
  if (lines.some((l) => l.length > MAX_LINE_LENGTH)) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "a line exceeds the per-line bound");

  const kinds = new Array(lines.length).fill("TEXT"); // TEXT | FENCED_CODE | COMMENT
  const headings = [];
  const fences = [];
  const tables = [];
  const links = [];
  const definitions = [];
  const slugger = createSlugger();
  let fence = null;
  let comment = false;
  const budget = newBudget(text.length); // one work budget for the whole document
  // Inline structure is scanned per PARAGRAPH: link text and code spans may wrap across
  // source lines. A paragraph ends at a blank line or at any other block start.
  let para = [];
  const flushPara = () => {
    if (para.length === 0) return;
    const starts = [];
    let total = 0;
    for (const item of para) {
      starts.push(total);
      total += item.text.length + 1;
    }
    const scanned = scanInline(para.map((item) => item.text).join("\n"), 0, budget);
    for (const l of scanned.links) {
      // Binary search: the last paragraph line that starts at or before the link offset.
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= l.offset) lo = mid;
        else hi = mid - 1;
      }
      links.push({ line: para[lo].n, kind: l.kind, destination: l.destination, label: l.label });
    }
    para = [];
  };

  const addLinks = (lineNo, lineText, scanned) => {
    for (const l of scanned.links) links.push({ line: lineNo, kind: l.kind, destination: l.destination, label: l.label });
    return scanned;
  };

  const exhaustedFailure = () => failure(REASON.MARKDOWN_BOUND_EXCEEDED, "the document exceeded its parse work bound");
  for (let i = 0; i < lines.length; i += 1) {
    if (budget.exhausted || !spend(budget)) return exhaustedFailure();
    const line = lines[i];
    const lineNo = i + 1;
    if (fence) {
      kinds[i] = "FENCED_CODE";
      const close = /^( *)(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[2][0] === fence.marker[0] && close[2].length >= fence.length && close[1].length <= fence.indent + 3) {
        fence.endLine = lineNo;
        fence.closed = true;
        fences.push(fence);
        fence = null;
      }
      continue;
    }
    if (comment) {
      kinds[i] = "COMMENT";
      if (line.includes("-->")) comment = false;
      continue;
    }
    if (isBlank(line)) {
      flushPara();
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[2][0] === "`" && open[3].includes("`"))) {
      flushPara();
      kinds[i] = "FENCED_CODE";
      fence = { line: lineNo, endLine: null, marker: open[2][0], length: open[2].length, indent: open[1].length, info: open[3].trim().slice(0, 100), closed: false };
      continue;
    }
    const commentAt = line.indexOf("<!--");
    if (commentAt >= 0 && !line.slice(commentAt + 4).includes("-->")) {
      flushPara();
      kinds[i] = "COMMENT";
      comment = true;
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      flushPara();
      const rawText = (atx[2] || "").trim();
      const scanned = addLinks(lineNo, rawText, scanInline(rawText, 0, budget));
      if (headings.length >= MAX_HEADINGS) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "too many headings");
      headings.push({ line: lineNo, level: atx[1].length, text: scanned.plain, raw: rawText, anchor: slugger.slug(scanned.plain) });
      continue;
    }
    const def = DEFINITION.exec(line);
    if (def) {
      flushPara();
      const destination = def[2].startsWith("<") ? def[2].slice(1, -1) : def[2];
      definitions.push({ line: lineNo, label: def[1].trim().replace(/\s+/g, " ").toLowerCase(), destination });
      continue;
    }
    // GFM table: a header row followed by a delimiter row.
    if (i + 1 < lines.length && kinds[i + 1] === "TEXT" && DELIMITER_ROW.test(lines[i + 1]) && lines[i + 1].includes("|") && hasTablePipe(line, budget) && !isBlank(line)) {
      flushPara();
      if (tables.length >= MAX_TABLES) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "too many tables");
      const header = splitTableRow(line, budget);
      const alignments = splitTableRow(lines[i + 1], budget);
      const columns = header.length;
      const table = { line: lineNo, endLine: lineNo + 1, columns, header, alignments, rows: [], problems: [] };
      if (alignments.length !== columns) table.problems.push({ line: lineNo + 1, kind: "DELIMITER", expected: columns, actual: alignments.length });
      addLinks(lineNo, line, scanInline(line, 0, budget));
      let j = i + 2;
      while (j < lines.length) {
        const row = lines[j];
        if (isBlank(row) || FENCE_OPEN.test(row) || ATX.test(row) || /^ {0,3}>/.test(row) || endsTable(row)) break;
        const cells = splitTableRow(row, budget);
        table.rows.push({ line: j + 1, cells });
        if (cells.length !== columns) table.problems.push({ line: j + 1, kind: "CARDINALITY", expected: columns, actual: cells.length });
        addLinks(j + 1, row, scanInline(row, 0, budget));
        table.endLine = j + 1;
        j += 1;
      }
      tables.push(table);
      i = j - 1;
      if (links.length > MAX_LINKS) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "too many links");
      continue;
    }
    // A list item starts a new paragraph so a bracket never pairs across two items.
    if (/^ *(?:[-*+]|[0-9]{1,9}[.)])[ 	]/.test(line)) flushPara();
    para.push({ n: lineNo, text: line });
    if (links.length > MAX_LINKS) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "too many links");
  }
  flushPara();
  if (links.length > MAX_LINKS) return failure(REASON.MARKDOWN_BOUND_EXCEEDED, "too many links");
  if (budget.exhausted) return exhaustedFailure();
  if (fence) fences.push(fence); // unclosed: stays closed=false

  const structure = {
    ok: true,
    path,
    lineCount: lines.length,
    headings: headings.map((h) => ({ line: h.line, level: h.level, text: h.text, anchor: h.anchor })),
    anchors: headings.map((h) => h.anchor),
    fences,
    tables,
    links,
    definitions,
  };
  return { ok: true, structure, lines, kinds, headingsRaw: headings };
}

/** Public: parse Markdown bytes/text into a frozen structural model. */
function parseMarkdown(input) {
  const doc = parseDocument(input);
  if (!doc.ok) return deepFreeze({ ok: false, reasonCode: doc.reasonCode, detail: doc.detail });
  return deepFreeze(doc.structure);
}

module.exports = { parseMarkdown, parseDocument, scanInline, splitTableRow, insideCodeSpan, newBudget, MAX_BYTES };
