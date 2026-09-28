"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSelector, extractRegion } = require("./regions");

function reader(files) {
  return {
    async read(path, maxBytes) {
      if (!(path in files)) return { kind: "absent" };
      const bytes = Buffer.from(files[path], "utf8");
      if (bytes.length > maxBytes) return { kind: "too-large", size: bytes.length };
      return { kind: "blob", bytes };
    },
    async stat(path) { return path in files ? { kind: "file" } : { kind: "absent" }; },
    async list() { return { ok: true, paths: Object.keys(files) }; },
  };
}

// ---------------------------------------------------------------- selector parsing

test("parseSelector: file: kind", () => {
  const r = parseSelector("file:docs/a.md");
  assert.deepEqual(r, { ok: true, kind: "file", path: "docs/a.md" });
});

test("parseSelector: heading: kind", () => {
  const r = parseSelector("heading:docs/a.md#My Section");
  assert.equal(r.ok, true);
  assert.equal(r.kind, "heading");
  assert.equal(r.path, "docs/a.md");
  assert.equal(r.heading, "My Section");
});

test("parseSelector: table-rows: kind with orderIndependent flag", () => {
  const r1 = parseSelector("table-rows:docs/a.md#Findings");
  assert.equal(r1.ok, true);
  assert.equal(r1.orderIndependent, false);
  const r2 = parseSelector("table-rows:docs/a.md#Findings!orderIndependent");
  assert.equal(r2.ok, true);
  assert.equal(r2.orderIndependent, true);
  assert.equal(r2.heading, "Findings");
});

test("parseSelector: unknown prefix, missing #, empty heading, path traversal, control chars, oversized all rejected", () => {
  for (const s of [
    "unknown:docs/a.md",
    "heading:docs/a.md",
    "heading:docs/a.md#",
    "file:../escape.md",
    "file:/absolute.md",
    "heading:docs/a.md#x\u0000y",
    "",
    "file:" + "x".repeat(600),
  ]) {
    const r = parseSelector(s);
    assert.equal(r.ok, false, s);
  }
});

test("parseSelector: never throws on hostile input", () => {
  for (const s of [null, undefined, 42, {}, [], "file:"]) {
    assert.doesNotThrow(() => parseSelector(s));
  }
});

// ---------------------------------------------------------------- file: extraction

test("extractRegion file: whole canonical content", async () => {
  const r = reader({ "a.md": "hello\r\nworld\r\n" });
  const region = await extractRegion({ kind: "file", path: "a.md" }, r);
  assert.equal(region.ok, true);
  assert.equal(region.kind, "single");
  assert.equal(region.bytes.toString("utf8"), "hello\nworld\n");
});

test("extractRegion file: missing file -> REGION_MISSING, never an empty-region fingerprint", async () => {
  const r = reader({});
  const region = await extractRegion({ kind: "file", path: "missing.md" }, r);
  assert.equal(region.ok, false);
  assert.equal(region.reason, "REGION_MISSING");
});

test("extractRegion: invalid UTF-8 content fails closed", async () => {
  const r = { async read() { return { kind: "blob", bytes: Buffer.from([0xff, 0xfe]) }; }, async stat() { return { kind: "file" }; }, async list() { return { ok: true, paths: [] }; } };
  const region = await extractRegion({ kind: "file", path: "a.md" }, r);
  assert.equal(region.ok, false);
  assert.equal(region.reason, "INVALID_UTF8");
});

// ---------------------------------------------------------------- heading: extraction

test("extractRegion heading: locates the section up to the next same-or-higher-level heading", async () => {
  const doc = "# Title\n\n## Section A\ncontent A line 1\ncontent A line 2\n\n## Section B\ncontent B\n";
  const r = reader({ "a.md": doc });
  const region = await extractRegion({ kind: "heading", path: "a.md", heading: "Section A" }, r);
  assert.equal(region.ok, true);
  assert.equal(region.kind, "single");
  const text = region.bytes.toString("utf8");
  assert.ok(text.startsWith("## Section A"));
  assert.ok(text.includes("content A line 1"));
  assert.ok(!text.includes("Section B"));
});

test("extractRegion heading: a subsection heading (deeper level) stays inside the parent region", async () => {
  const doc = "## Section A\ntop\n### Sub\nnested\n## Section B\nother\n";
  const r = reader({ "a.md": doc });
  const region = await extractRegion({ kind: "heading", path: "a.md", heading: "Section A" }, r);
  const text = region.bytes.toString("utf8");
  assert.ok(text.includes("### Sub"));
  assert.ok(text.includes("nested"));
  assert.ok(!text.includes("Section B"));
});

test("extractRegion heading: last section runs to end of file", async () => {
  const doc = "## Only Section\ncontent\nmore content\n";
  const r = reader({ "a.md": doc });
  const region = await extractRegion({ kind: "heading", path: "a.md", heading: "Only Section" }, r);
  assert.equal(region.bytes.toString("utf8"), doc);
});

test("extractRegion heading: missing heading -> REGION_MISSING, never an empty region", async () => {
  const r = reader({ "a.md": "## Present\ncontent\n" });
  const region = await extractRegion({ kind: "heading", path: "a.md", heading: "Absent" }, r);
  assert.equal(region.ok, false);
  assert.equal(region.reason, "REGION_MISSING");
});

test("extractRegion heading: multiple matches at the requested text fail closed (never take the first)", async () => {
  const doc = "## Dup\nfirst\n## Dup\nsecond\n";
  const r = reader({ "a.md": doc });
  const region = await extractRegion({ kind: "heading", path: "a.md", heading: "Dup" }, r);
  assert.equal(region.ok, false);
  assert.equal(region.reason, "MULTIPLE_REGION_MATCH");
});

// ---------------------------------------------------------------- table-rows: extraction (order sensitivity)

const tableDoc = (rows) => `## Findings\n| ID | Value |\n|---|---|\n${rows.map((r) => `| ${r.id} | ${r.value} |`).join("\n")}\n`;

test("extractRegion table-rows: header and alignment rows are excluded; data rows carry an id", async () => {
  const doc = tableDoc([{ id: "R1", value: "a" }, { id: "R2", value: "b" }]);
  const r = reader({ "a.md": doc });
  const region = await extractRegion({ kind: "table-rows", path: "a.md", heading: "Findings", orderIndependent: false }, r);
  assert.equal(region.ok, true);
  assert.equal(region.kind, "recordSet");
  assert.equal(region.rows.length, 2);
  assert.equal(region.rows[0].id, "R1");
  assert.equal(region.rows[1].id, "R2");
});

test("extractRegion table-rows: orderIndependent=true, row reorder alone -> same fingerprint set (same rows, different order)", async () => {
  const docA = reader({ "a.md": tableDoc([{ id: "R1", value: "a" }, { id: "R2", value: "b" }]) });
  const docB = reader({ "a.md": tableDoc([{ id: "R2", value: "b" }, { id: "R1", value: "a" }]) });
  const a = await extractRegion({ kind: "table-rows", path: "a.md", heading: "Findings", orderIndependent: true }, docA);
  const b = await extractRegion({ kind: "table-rows", path: "a.md", heading: "Findings", orderIndependent: true }, docB);
  const idsA = a.rows.map((r) => r.id).sort();
  const idsB = b.rows.map((r) => r.id).sort();
  assert.deepEqual(idsA, idsB);
});

test("extractRegion table-rows: duplicate record ID under orderIndependent fails closed", async () => {
  const doc = tableDoc([{ id: "R1", value: "a" }, { id: "R1", value: "b" }]);
  const r = reader({ "a.md": doc });
  const region = await extractRegion({ kind: "table-rows", path: "a.md", heading: "Findings", orderIndependent: true }, r);
  assert.equal(region.ok, false);
  assert.equal(region.reason, "DUPLICATE_RECORD_ID");
});

test("extractRegion table-rows: duplicate id is tolerated when NOT orderIndependent (order itself is authoritative)", async () => {
  const doc = tableDoc([{ id: "R1", value: "a" }, { id: "R1", value: "b" }]);
  const r = reader({ "a.md": doc });
  const region = await extractRegion({ kind: "table-rows", path: "a.md", heading: "Findings", orderIndependent: false }, r);
  assert.equal(region.ok, true);
  assert.equal(region.rows.length, 2);
});

test("extractRegion table-rows: two separate tables in one heading region each get their own header/separator skip", async () => {
  const doc = "## Findings\n| ID | V |\n|---|---|\n| R1 | a |\n\nsome prose\n\n| ID | V |\n|---|---|\n| R2 | b |\n";
  const r = reader({ "a.md": doc });
  const region = await extractRegion({ kind: "table-rows", path: "a.md", heading: "Findings", orderIndependent: false }, r);
  assert.equal(region.ok, true);
  assert.deepEqual(region.rows.map((x) => x.id), ["R1", "R2"]);
});
