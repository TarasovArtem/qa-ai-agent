"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { slugify, createSlugger } = require("./slug");
const { parseDocument, splitTableRow, scanInline } = require("./markdown");

const parse = (text, path = "doc.md") => g.parseMarkdown({ path, text });
const ok = (text) => {
  const s = parse(text);
  assert.equal(s.ok, true, JSON.stringify(text).slice(0, 60));
  return s;
};
const dests = (s) => s.links.map((l) => `${l.kind}:${l.destination}`);

// ------------------------------------------------------------------- slugs

test("W1 1B slug: anchors match GitHub's github-slugger for representative headings", () => {
  const cases = {
    "Hello, World!": "hello-world",
    "9. AISEC — Agentic Trust": "9-aisec--agentic-trust",
    "foo_bar": "foo_bar",
    "Über uns": "über-uns",
    "日本語 テスト": "日本語-テスト",
    "Привет мир": "привет-мир",
    "A  B": "a--b",
    "Emoji 😀 test": "emoji--test",
    "What's new?": "whats-new",
    "C++ & C#": "c--c",
    "1.2.3 Release": "123-release",
    "kebab-case-title": "kebab-case-title",
    "  padded  ": "--padded--".replace("--padded--", "--padded--"),
    "Ünïcödé Mîxed": "ünïcödé-mîxed",
  };
  for (const [heading, slug] of Object.entries(cases)) assert.equal(slugify(heading), slug, heading);
});

test("W1 1B slug: duplicate headings get -1, -2 suffixes and suffix collisions are skipped (github-slugger)", () => {
  const s = createSlugger();
  assert.deepEqual(["a", "a", "a", "b", "a-1", "a"].map((h) => s.slug(h)), ["a", "a-1", "a-2", "b", "a-1-1", "a-3"]);
  const collide = createSlugger();
  assert.deepEqual(["a", "a-1", "a"].map((h) => collide.slug(h)), ["a", "a-1", "a-2"]);
});

// ---------------------------------------------------------------- headings

test("W1 1B headings: ATX headings of every level are extracted with rendered text and anchors", () => {
  const s = ok("# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n####### Seven\n#NoSpace\n");
  assert.deepEqual(s.headings.map((h) => `${h.level}:${h.text}`), ["1:One", "2:Two", "3:Three", "4:Four", "5:Five", "6:Six"]);
  assert.deepEqual([...s.anchors], ["one", "two", "three", "four", "five", "six"]);
});

test("W1 1B headings: closing hashes, empty headings, indentation and trailing spaces", () => {
  const s = ok("## Closed ##\n#\n   ### Three spaces  \n    #### four spaces is not a heading\n## Tail # not closing\n");
  assert.deepEqual(s.headings.map((h) => h.text), ["Closed", "", "Three spaces", "Tail # not closing"]);
  assert.equal(s.headings.some((h) => h.text.includes("four spaces")), false);
});

test("W1 1B headings: rendered text drives the anchor (code spans, links, emphasis, entities, escapes)", () => {
  const s = ok("# `foo_bar` baz\n# See [the docs](x.md) now\n# **Bold** and _italic_ words\n# snake_case_name here\n# Q&amp;A time\n# Escaped \\_ underscore\n# A `b` c\n");
  assert.deepEqual([...s.anchors], ["foo_bar-baz", "see-the-docs-now", "bold-and-italic-words", "snake_case_name-here", "qa-time", "escaped-_-underscore", "a-b-c"]);
});

test("W1 1B headings: duplicate headings keep GitHub's suffix numbering in document order", () => {
  const s = ok("# Intro\n## Details\n## Details\n# Intro\n## Details\n");
  assert.deepEqual([...s.anchors], ["intro", "details", "details-1", "intro-1", "details-2"]);
});

test("W1 1B headings: headings inside fences, comments and indented-four-space text are not structure", () => {
  const s = ok("# Real\n```\n# Not a heading\n```\n<!--\n# Hidden\n-->\n~~~\n## also not\n~~~\n# Real Two\n");
  assert.deepEqual(s.headings.map((h) => h.text), ["Real", "Real Two"]);
});

// ------------------------------------------------------------------- fences

test("W1 1B fences: balanced backtick and tilde fences with info strings", () => {
  const s = ok("```js\ncode\n```\n\n~~~python title\nmore\n~~~\n");
  assert.deepEqual(s.fences.map((f) => ({ marker: f.marker, length: f.length, info: f.info, closed: f.closed, line: f.line, endLine: f.endLine })), [
    { marker: "`", length: 3, info: "js", closed: true, line: 1, endLine: 3 },
    { marker: "~", length: 3, info: "python title", closed: true, line: 5, endLine: 7 },
  ]);
});

test("W1 1B fences: an unclosed fence is reported and swallows the rest of the document", () => {
  const s = ok("# Title\n```js\nnever closed\n# Swallowed heading\n| a | b |\n|---|---|\n[x](y.md)\n");
  assert.deepEqual(s.fences.map((f) => ({ closed: f.closed, line: f.line, endLine: f.endLine })), [{ closed: false, line: 2, endLine: null }]);
  assert.deepEqual(s.headings.map((h) => h.text), ["Title"]);
  assert.equal(s.tables.length, 0);
  assert.equal(s.links.length, 0);
});

test("W1 1B fences: closing rules (same char, at least as long, only whitespace after, shorter/other markers do not close)", () => {
  const long = ok("````\n```\ninner shorter fence\n```\n````\nafter\n");
  assert.deepEqual(long.fences.map((f) => `${f.length}:${f.closed}:${f.line}-${f.endLine}`), ["4:true:1-5"]);
  const mixed = ok("~~~\n```\n~~\n~~~\n");
  assert.deepEqual(mixed.fences.map((f) => `${f.marker}:${f.closed}`), ["~:true"], "a backtick fence and a shorter tilde run do not close a tilde fence");
  const trailing = ok("```\ntext\n``` not a close\n```\n");
  assert.deepEqual(trailing.fences.map((f) => `${f.closed}:${f.endLine}`), ["true:4"], "a fence line with trailing text is content, not a closer");
  const longerClose = ok("```\nx\n``````\n");
  assert.equal(longerClose.fences[0].closed, true, "a longer closing fence closes");
});

test("W1 1B fences: an info string with a backtick is not a backtick fence; fence-like text in another block stays inert", () => {
  const s = ok("```a`b\ntext\n");
  assert.equal(s.fences.length, 0, "not a fence");
  const nested = ok("~~~\n```js\nstill inside the tilde fence\n```\n~~~\n");
  assert.deepEqual(nested.fences.map((f) => `${f.marker}:${f.closed}`), ["~:true"]);
  const comment = ok("<!--\n```\n-->\ntext\n");
  assert.equal(comment.fences.length, 0, "a fence marker inside an HTML comment is not a fence");
});

test("W1 1B fences: fences nested in list items (any indentation) are fences", () => {
  const s = ok("- item\n\n    ```sh\n    # comment\n    ```\n- next\n");
  assert.deepEqual(s.fences.map((f) => f.closed), [true]);
  assert.equal(s.headings.length, 0, "the # comment line is code");
});

// ------------------------------------------------------------------- tables

test("W1 1B tables: a well-formed table with alignments, leading/trailing pipes, empty cells and Unicode", () => {
  const s = ok("| Name | Value | Ünï |\n|:---|:---:|---:|\n| a | 1 | é |\n| b |  |  |\nno pipes row? no\n");
  const t = s.tables[0];
  assert.equal(t.columns, 3);
  assert.deepEqual(t.header, ["Name", "Value", "Ünï"]);
  assert.deepEqual(t.alignments, [":---", ":---:", "---:"]);
  assert.deepEqual(t.rows[1].cells, ["b", "", ""], "empty cells are cells");
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.problems.map((p) => `${p.line}:${p.kind}`), ["5:CARDINALITY"], "the paragraph directly after a table becomes a one-cell row, as GitHub renders it");
});

test("W1 1B tables: pipes inside inline code and escaped pipes do not split cells", () => {
  const s = ok("| a | b |\n|---|---|\n| `x|y` | z |\n| p\\|q | r |\n| ``a|b`c`` | s |\n");
  const t = s.tables[0];
  assert.deepEqual(t.rows.map((r) => r.cells), [["`x|y`", "z"], ["p\\|q", "r"], ["``a|b`c``", "s"]]);
  assert.deepEqual(t.problems, []);
  assert.deepEqual(splitTableRow("| a | `b|c` | d\\|e |"), ["a", "`b|c`", "d\\|e"]);
  assert.deepEqual(splitTableRow("a | b"), ["a", "b"], "no leading/trailing pipe");
  assert.deepEqual(splitTableRow("| a | b |"), ["a", "b"]);
  assert.deepEqual(splitTableRow("| a | b | |"), ["a", "b", ""], "a trailing empty cell before the closing pipe counts");
  assert.deepEqual(splitTableRow("| `unterminated | b |"), ["`unterminated", "b"], "an unmatched backtick is literal and does not swallow the row");
});

test("W1 1B tables: malformed cardinality and delimiter width are deterministic problems; a non-alignment 'delimiter' is not a table", () => {
  const s = ok("| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| only |\n\n| c | d |\n|---|\n| 1 | 2 |\n\n| e | f |\n|--|xx|\n| 1 | 2 |\n");
  assert.deepEqual(s.tables.map((t) => t.problems.map((p) => `${p.line}:${p.kind}:${p.expected}/${p.actual}`)), [
    ["3:CARDINALITY:2/3", "4:CARDINALITY:2/1"],
    ["7:DELIMITER:2/1"],
  ], "the third block has no valid delimiter row (xx is not an alignment marker), so it is plain text");
});

test("W1 1B tables: a blank line, a heading, a fence or a blockquote ends the table; a pipe-less line is not a table", () => {
  const s = ok("| a | b |\n|---|---|\n| 1 | 2 |\n\ntext | not table\n\n| c | d |\n|---|---|\n| 3 | 4 |\n# Heading ends it\n| e | f |\n|---|---|\n```\nfence\n```\n");
  assert.deepEqual(s.tables.map((t) => `${t.line}-${t.endLine}`), ["1-3", "7-9", "11-12"]);
  assert.equal(s.tables.every((t) => t.problems.length === 0), true);
  assert.equal(ok("just text\n---\nmore text\n").tables.length, 0, "a thematic break is not a delimiter row");
  assert.equal(ok("a | b\n---\n").tables.length, 0, "a delimiter row without a pipe is not a table");
});

test("W1 1B tables: a table inside a fence or a comment is not parsed; a single-column table works", () => {
  assert.equal(ok("```\n| a | b |\n|---|---|\n```\n").tables.length, 0);
  assert.equal(ok("<!--\n| a | b |\n|---|---|\n-->\n").tables.length, 0);
  const single = ok("| only |\n|---|\n| x |\n").tables[0];
  assert.deepEqual({ columns: single.columns, problems: single.problems.length }, { columns: 1, problems: 0 });
});

test("W1 1B tables: a fenced block adjacent to a table is a separate block", () => {
  const s = ok("| a | b |\n|---|---|\n| 1 | 2 |\n```\ncode | with | pipes\n```\n");
  assert.equal(s.tables[0].rows.length, 1);
  assert.equal(s.tables[0].problems.length, 0);
  assert.equal(s.fences.length, 1);
});

// -------------------------------------------------------------------- links

test("W1 1B links: inline, image, reference, collapsed reference, definition and autolink forms are extracted", () => {
  const s = ok("[a](one.md) ![img](pic.png) [full][ref] [collapsed][] <https://example.test/x>\n\n[ref]: two.md\n[collapsed]: <three four.md> \"title\"\n");
  assert.deepEqual(dests(s), ["inline:one.md", "image:pic.png", "reference:null", "reference:null", "autolink:https://example.test/x"]);
  assert.deepEqual(s.links.filter((l) => l.kind === "reference").map((l) => l.label), ["ref", "collapsed"]);
  assert.deepEqual(s.definitions.map((d) => `${d.label}=${d.destination}`), ["ref=two.md", "collapsed=three four.md"]);
});

test("W1 1B links: balanced brackets and parentheses, angle destinations, titles, escapes", () => {
  const s = ok("[a [nested] b](x.md) [p](a(b)c.md) [s](<with space.md>) [t](y.md \"Title (x)\") \\[not](link.md) [u](z.md 'single') ![alt [x]](i.png)\n");
  assert.deepEqual(dests(s), ["inline:x.md", "inline:a(b)c.md", "inline:with space.md", "inline:y.md", "inline:z.md", "image:i.png"]);
});

test("W1 1B links: link text and destinations may wrap across source lines within a paragraph", () => {
  const s = ok("see [the closure\nevidence](#closure-evidence) and\n[another\nlink](b.md)\n");
  assert.deepEqual(dests(s), ["inline:#closure-evidence", "inline:b.md"]);
  assert.deepEqual(s.links.map((l) => l.line), [1, 3], "a link is reported at the line where it starts");
});

test("W1 1B links: code spans of any backtick-run length protect link syntax; unmatched backticks are literal", () => {
  const s = ok("`[a](one.md)` ``[b](two.md) `` and ```[c](three.md)``` then `unclosed [d](four.md)\n");
  assert.deepEqual(dests(s), ["inline:four.md"], "only the link after an unmatched backtick is real");
  assert.deepEqual(dests(ok("``a`b`` [e](five.md)\n")), ["inline:five.md"]);
});

test("W1 1B links: unsupported and malformed forms are not extracted (shortcut references, unbalanced brackets, broken targets)", () => {
  const s = ok("[shortcut] [unclosed(x.md) [broken](unbalanced(paren.md [ok](fine.md) [t](x.md \"unterminated) plain ]] text\n");
  assert.deepEqual(dests(s), ["inline:fine.md"]);
});

test("W1 1B links: links inside fences, comments and headings/tables are handled per structure", () => {
  const s = ok("# Head [h](h.md)\n```\n[f](f.md)\n```\n<!-- [c](c.md) -->\n[p](p.md)\n\n| a | b |\n|---|---|\n| [t](t.md) | x |\n");
  assert.deepEqual(dests(s).sort(), ["inline:h.md", "inline:p.md", "inline:t.md"], "fenced code and HTML comments (inline or block) hide their links");
  assert.deepEqual(dests(ok("a <!-- [x](x.md) --> b [y](y.md) <!-- one --> <!-- [z](z.md) -->\n")), ["inline:y.md"]);
});

test("W1 1B links: multi-line HTML comment blocks hide their content", () => {
  const s = ok("before\n<!--\n[hidden](h.md)\n# hidden heading\n-->\n[shown](s.md)\n");
  assert.deepEqual(dests(s), ["inline:s.md"]);
  assert.deepEqual(s.headings, []);
});

test("W1 1B links: a list item starts a new paragraph so a bracket never pairs across two items", () => {
  const s = ok("- item with [open bracket\n- item with close](x.md)\n");
  assert.deepEqual(dests(s), []);
});

// ------------------------------------------------------------- input handling

test("W1 1B input: valid UTF-8 (with or without BOM, LF or CRLF) parses; invalid UTF-8 is a distinct failure", () => {
  const withBom = g.parseMarkdown({ path: "a.md", bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Title\r\n\r\ntext [a](b.md)\r\n")]) });
  assert.equal(withBom.ok, true);
  assert.deepEqual(withBom.headings.map((h) => h.text), ["Title"], "the BOM does not break the first heading");
  assert.equal(withBom.links.length, 1);
  const invalid = g.parseMarkdown({ path: "a.md", bytes: Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]) });
  assert.deepEqual({ ok: invalid.ok, reason: invalid.reasonCode }, { ok: false, reason: "MARKDOWN_ENCODING_INVALID" });
  const truncated = g.parseMarkdown({ path: "a.md", bytes: Buffer.from([0xe2, 0x82]) });
  assert.equal(truncated.reasonCode, "MARKDOWN_ENCODING_INVALID");
  for (const bad of [null, undefined, "text", 5, {}, { path: "a.md" }, { path: "a.md", bytes: "string" }, { path: "a.md", bytes: [35, 32] }]) assert.equal(g.parseMarkdown(bad).ok, false, JSON.stringify(bad));
});

test("W1 1B input: size, line, line-length, heading and link bounds fail closed (never truncate silently)", () => {
  assert.equal(g.parseMarkdown({ path: "a.md", bytes: Buffer.alloc(1024 * 1024 + 1, 0x61) }).reasonCode, "MARKDOWN_BOUND_EXCEEDED");
  assert.equal(parse("x\n".repeat(50_001)).reasonCode, "MARKDOWN_BOUND_EXCEEDED");
  assert.equal(parse("a".repeat(32_769)).reasonCode, "MARKDOWN_BOUND_EXCEEDED");
  assert.equal(parse("# h\n".repeat(5001)).reasonCode, "MARKDOWN_BOUND_EXCEEDED");
  assert.equal(parse("[a](b.md) ".repeat(20_001)).reasonCode, "MARKDOWN_BOUND_EXCEEDED");
  assert.equal(parse("| a | b |\n|---|---|\n\n".repeat(2001)).reasonCode, "MARKDOWN_BOUND_EXCEEDED");
  assert.equal(parse("").ok, true);
  assert.equal(parse("   \n\n").ok, true);
});

test("W1 1B input: the public structure is frozen plain data with no raw document text", () => {
  const s = ok("# Title\n\n| a | b |\n|---|---|\n| SECRET-DOC-BODY | x |\n\n[l](a.md)\n");
  assert.equal(Object.isFrozen(s), true);
  assert.equal(Object.isFrozen(s.headings), true);
  assert.equal(Object.isFrozen(s.tables[0]), true);
  assert.equal(Object.isFrozen(s.links), true);
  assert.throws(() => s.headings.push({}), TypeError);
  assert.equal("lines" in s, false);
  assert.equal("kinds" in s, false);
  assert.deepEqual(Object.keys(s).sort(), ["anchors", "definitions", "fences", "headings", "lineCount", "links", "ok", "path", "tables"]);
  const bytes = Buffer.from("# A\n");
  const before = Buffer.from(bytes);
  g.parseMarkdown({ path: "a.md", bytes });
  assert.deepEqual(bytes, before, "input bytes are never mutated");
});

test("W1 1B input: parsing is deterministic and independent of the path and prior calls", () => {
  const text = "# T\n\n[a](b.md)\n\n```\nx\n```\n";
  assert.equal(JSON.stringify(parse(text)), JSON.stringify(parse(text)));
  assert.notEqual(JSON.stringify(parse(text, "other.md")), JSON.stringify(parse(text)), "only the reported path differs");
  const a = parse(text, "x.md");
  const b = parse(text, "x.md");
  assert.deepEqual(a, b);
});

test("W1 1B input: Markdown is data only (executable-looking content is inert text)", () => {
  const s = ok("# `require('child_process').execSync('x')`\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) ![p](data:text/html;base64,AAAA)\n\n```js\nprocess.exit(1)\n```\n");
  assert.equal(s.ok, true);
  assert.deepEqual(dests(s), ["inline:javascript:alert(1)", "image:data:text/html;base64,AAAA"]);
});

// ------------------------------------------------------------ adversarial cost

test("W1 1B adversarial: pathological inputs stay linear and bounded (no catastrophic backtracking)", () => {
  const cases = {
    "100k open brackets": "[".repeat(30_000),
    "nested brackets with no close": "[a".repeat(10_000),
    "many unmatched backticks": "`".repeat(30_000),
    "alternating backtick runs": "`` ` ".repeat(6_000),
    "long unclosed link target": "[a](" + "(".repeat(20_000),
    "many pipes": "|".repeat(30_000),
    "table with huge row": "| a | b |\n|---|---|\n" + "| x ".repeat(6_000) + "|\n",
    "many angle brackets": "<a ".repeat(10_000),
    "long info string": "```" + "x".repeat(30_000) + "\n",
    "deep parens": "[a](" + "(a)".repeat(5_000) + ")",
  };
  const timings = [];
  for (const [name, text] of Object.entries(cases)) {
    const started = Date.now();
    const r = parse(text);
    const elapsed = Date.now() - started;
    timings.push(`${name}=${elapsed}ms`);
    assert.equal(typeof r.ok, "boolean", name);
    assert.ok(elapsed < 2000, `${name} took ${elapsed} ms`);
  }
  console.log(`# markdown parser timings: ${timings.join(", ")}`);
});

test("W1 1B adversarial: many small structures scale linearly", () => {
  const started = Date.now();
  const doc = Array.from({ length: 4000 }, (_, i) => `## Heading ${i}\n\ntext [l](f${i}.md) \`c\`\n`).join("\n");
  const r = parse(doc);
  assert.equal(r.ok, true);
  assert.equal(r.headings.length, 4000);
  assert.ok(Date.now() - started < 3000);
  assert.equal(r.anchors.length, new Set(r.anchors).size, "every generated anchor is unique");
});

test("W1 1B internal: the inline scanner reports rendered text, spans and links consistently", () => {
  const r = scanInline("A `code` and [link](x.md) with **bold** _it_ &amp; more");
  assert.equal(r.plain, "A code and link with **bold** it & more");
  assert.deepEqual(r.codeSpans, [{ start: 2, end: 8 }]);
  assert.equal(r.links.length, 1);
  const doc = parseDocument({ path: "a.md", text: "# T\n```\ncode\n```" });
  assert.deepEqual(doc.kinds, ["TEXT", "FENCED_CODE", "FENCED_CODE", "FENCED_CODE"]);
  assert.equal(doc.lines.length, 4);
});

test("W1 1B adversarial: a full 1 MiB paragraph cannot make bracket or code-span searches quadratic (linear, or fail closed)", () => {
  const megabyte = 1024 * 1024 - 8;
  const lineOf = (unit, width = 32_000) => `${unit.repeat(Math.floor(width / unit.length))}\n`;
  const paragraph = (unit) => lineOf(unit).repeat(Math.floor(megabyte / 32_001));
  const distinctRuns = (() => {
    let out = "";
    for (let k = 1; out.length < megabyte && k < 1500; k += 1) out += `${"`".repeat(k)} x\n`;
    return out.slice(0, megabyte);
  })();
  const cases = { "1 MiB of [": paragraph("["), "1 MiB of [a": paragraph("[a"), "1 MiB of ![": paragraph("!["), "distinct backtick-run lengths": distinctRuns, "1 MiB of [`": paragraph("[`") };
  const timings = [];
  for (const [name, text] of Object.entries(cases)) {
    const started = Date.now();
    const r = parse(text);
    const elapsed = Date.now() - started;
    timings.push(`${name}=${elapsed}ms`);
    assert.ok(elapsed < 3000, `${name} took ${elapsed} ms`);
    if (!r.ok) assert.equal(r.reasonCode, "MARKDOWN_BOUND_EXCEEDED", `${name}: exhaustion fails closed, it never drops links silently`);
  }
  console.log(`# markdown 1 MiB adversarial timings: ${timings.join(", ")}`);
});

test("W1 1B adversarial: a paragraph with very many links maps them to lines in O(n log n)", () => {
  const started = Date.now();
  const text = Array.from({ length: 20_000 }, (_, i) => `[l${i}](f${i}.md)`).join("\n");
  const r = parse(text);
  assert.equal(r.ok, true);
  assert.equal(r.links.length, 20_000);
  assert.deepEqual(r.links.slice(0, 3).map((l) => l.line), [1, 2, 3]);
  assert.equal(r.links[19_999].line, 20_000);
  assert.ok(Date.now() - started < 3000);
});
