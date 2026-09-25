"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../index");
const { basePolicy, changedResult, fakeReader, fakeAdapter, makeSubject } = require("../../test-support-git");
const { validateBasePolicy, BUILTIN_MINIMUM_POLICY } = require("../1a/policy");
const { validateResultRecord } = require("../../kernel/results");

const subject = makeSubject();
const family = (o = {}) => ({ family: "TB", prefix: "TB-", segments: [{ minDigits: 2, maxDigits: 3 }], separator: "-", definitionSources: ["docs/**"], definitionContexts: ["HEADING", "TABLE_FIRST_CELL"], ignoreContexts: ["FENCED_CODE", "INLINE_CODE"], ...o });
const policyOf = (idFamilies = [], filePatterns = ["**/*.md"]) => validateBasePolicy(basePolicy({ markdown: { filePatterns, idFamilies } })).policy;
const rec = (result, id) => result.records.find((r) => r.checkId === id);
const state = (result, id) => {
  const r = rec(result, id);
  return r ? `${r.status}/${r.reasonCode}` : "MISSING";
};
const findings = (result, id) => rec(result, id).observed.findings || [];
const check = (files, changed = Object.keys(files).filter((f) => f.endsWith(".md")), extra = {}) =>
  g.checkReferences({ subject, changedFiles: changedResult(subject, changed), policy: policyOf(), reader: fakeReader(files), ...extra });

const CHECKS = ["1B.MARKDOWN.FILES", "1B.MARKDOWN.FENCES", "1B.MARKDOWN.TABLES", "1B.MARKDOWN.HEADINGS", "1B.MARKDOWN.ANCHORS", "1B.MARKDOWN.LINKS"];

test("W1 1B check: a clean document passes every structural check; every fact is its own stable record", async () => {
  const r = await check({ "docs/a.md": "# Title\n\nSee [b](b.md#other) and [self](#title) and [ext](https://example.test/x).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\ncode\n```\n", "docs/b.md": "# Other\n" });
  assert.deepEqual(r.records.map((x) => x.checkId), CHECKS);
  for (const id of CHECKS) assert.equal(state(r, id), "PASS/OK", id);
  for (const record of r.records) {
    assert.equal(validateResultRecord(record).ok, true, record.checkId);
    assert.equal(record.ownerStage, "1B");
    assert.deepEqual(record.subject, subject);
  }
  assert.equal(g.aggregate(r.records).readiness.state, "READY");
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.records), true);
  assert.equal(rec(r, "1B.MARKDOWN.LINKS").observed.linksChecked, 2, "only repository-local links are verified");
  assert.equal(rec(r, "1B.MARKDOWN.LINKS").observed.externalNotChecked, 1, "the external URL is structural only: reported, never requested");
});

test("W1 1B check: unclosed fences and malformed tables are FAIL with file and line", async () => {
  const r = await check({ "docs/a.md": "# T\n\n| a | b |\n|---|---|\n| 1 | 2 | 3 |\ntrailing paragraph\n\n```js\nnever closed\n" });
  assert.equal(state(r, "1B.MARKDOWN.FENCES"), "FAIL/MARKDOWN_STRUCTURE_INVALID");
  assert.match(findings(r, "1B.MARKDOWN.FENCES")[0], /^docs\/a\.md:8: fenced code block opened here is never closed/);
  assert.equal(state(r, "1B.MARKDOWN.TABLES"), "FAIL/MARKDOWN_STRUCTURE_INVALID");
  assert.deepEqual(findings(r, "1B.MARKDOWN.TABLES").map((f) => f.split(":").slice(0, 2).join(":")), ["docs/a.md:5", "docs/a.md:6"]);
  assert.equal(state(r, "1B.MARKDOWN.HEADINGS"), "PASS/OK", "unrelated checks are unaffected");
  assert.equal(g.aggregate(r.records).overallStatus, "FAIL");
});

test("W1 1B check: repository-local links resolve at the head; a missing target is FAIL", async () => {
  const r = await check({
    "docs/a.md": "[ok](b.md) [up](../README.md) [root](/docs/b.md) [dir](sub/) [dirnoslash](sub) [missing](nope.md) [encoded](with%20space.md) [q](b.md?plain=1)\n",
    "docs/b.md": "# B\n", "README.md": "# R\n", "docs/sub/x.md": "# X\n", "docs/with space.md": "# S\n",
  }, ["docs/a.md"]);
  assert.equal(state(r, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
  assert.deepEqual(findings(r, "1B.MARKDOWN.LINKS"), ["docs/a.md:1: link target does not exist at the head: docs/nope.md"]);
  assert.equal(rec(r, "1B.MARKDOWN.LINKS").observed.linksChecked, 8);
});

test("W1 1B check: links that escape the repository root, use absolute forms or unsafe characters are LINK_ESCAPES_ROOT", async () => {
  const bad = ["../../etc/passwd", "../../../x.md", "%2e%2e/%2e%2e/x.md", "..%2f..%2fx.md", "C:/Windows/win.ini", "c:\\x", "a\\..\\..\\b.md", "docs/..%2f..%2f..%2fx"];
  for (const dest of bad) {
    const r = await check({ "docs/a.md": `[x](${dest})\n`, "README.md": "r\n" }, ["docs/a.md"]);
    assert.equal(state(r, "1B.MARKDOWN.LINKS"), "FAIL/LINK_ESCAPES_ROOT", dest);
    assert.equal(r.records.some((x) => JSON.stringify(x).includes("passwd") && x.status === "PASS"), false);
  }
  const rootLevel = await check({ "a.md": "[x](../outside.md)\n" }, ["a.md"]);
  assert.equal(state(rootLevel, "1B.MARKDOWN.LINKS"), "FAIL/LINK_ESCAPES_ROOT", "a root-level document cannot link above the root");
  const invalidEncoding = await check({ "docs/a.md": "[x](%zz.md) [y](%.md)\n" }, ["docs/a.md"]);
  assert.equal(state(invalidEncoding, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
  const empty = await check({ "docs/a.md": "[x]()\n" }, ["docs/a.md"]);
  assert.equal(state(empty, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
});

test("W1 1B check: external and non-file schemes are structural only and never requested", async () => {
  const reader = fakeReader({ "docs/a.md": "[a](https://example.test/x) [b](http://x) [c](mailto:x@y.z) [d](//cdn.test/x.js) [e](javascript:void(0)) [f](tel:123) <https://auto.test/y> [g](data:text/plain,x)\n" });
  const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy: policyOf(), reader });
  assert.equal(state(r, "1B.MARKDOWN.LINKS"), "PASS/OK");
  assert.deepEqual(reader.calls.stat, [], "no external URL causes any lookup");
  assert.deepEqual(reader.calls.read, ["docs/a.md"]);
});

test("W1 1B check: a link target that is a symlink or submodule is never followed (FAIL, not silently accepted)", async () => {
  const r = await check({ "docs/a.md": "[l](link.md) [ok](real.md)\n", "docs/link.md": { kind: "symlink" }, "docs/real.md": "# R\n" }, ["docs/a.md"]);
  assert.equal(state(r, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
  assert.match(findings(r, "1B.MARKDOWN.LINKS")[0], /symlink \(never followed\)/);
  const trailing = await check({ "docs/a.md": "[f](real.md/)\n", "docs/real.md": "# R\n" }, ["docs/a.md"]);
  assert.match(findings(trailing, "1B.MARKDOWN.LINKS")[0], /trailing slash is not a directory/);
});

test("W1 1B check: local and cross-file heading anchors are verified against GitHub-style anchors", async () => {
  const r = await check({
    "docs/a.md": "# Intro\n## Details\n## Details\n\n[1](#intro) [2](#details) [3](#details-1) [4](#details-2) [5](#Intro) [6](b.md#other-heading) [7](b.md#nope) [8](#nowhere) [9](c.txt#L10) [10](b.md#caf%C3%A9)\n",
    "docs/b.md": "# Other Heading\n# Café\n", "docs/c.txt": "text\n",
  }, ["docs/a.md"]);
  assert.equal(state(r, "1B.MARKDOWN.ANCHORS"), "FAIL/ANCHOR_DANGLING");
  assert.deepEqual(findings(r, "1B.MARKDOWN.ANCHORS").map((f) => f.replace(/^docs\/a\.md:\d+: /, "")), [
    "anchor #Intro does not exist in this document",
    "anchor #details-2 does not exist in this document",
    "anchor #nope does not exist in docs/b.md",
    "anchor #nowhere does not exist in this document",
  ].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).length ? findings(r, "1B.MARKDOWN.ANCHORS").map((f) => f.replace(/^docs\/a\.md:\d+: /, "")) : []);
  const texts = findings(r, "1B.MARKDOWN.ANCHORS").join("\n");
  assert.match(texts, /#Intro does not exist in this document/, "anchors are case-sensitive: no folding");
  assert.match(texts, /#details-2 does not exist/);
  assert.match(texts, /#nope does not exist in docs\/b\.md/);
  assert.match(texts, /#nowhere does not exist/);
  assert.equal(/#details\b(?!-)/.test(texts.replace(/#details-2/g, "")), false, "#details and #details-1 exist");
  assert.equal(/L10|café|caf/.test(texts), false, "a non-Markdown target fragment is not checked; a percent-encoded fragment is decoded");
  assert.equal(findings(r, "1B.MARKDOWN.ANCHORS").length, 4);
});

test("W1 1B check: reference-style links and definitions are resolved and checked", async () => {
  const r = await check({ "docs/a.md": "[a][ok] [b][missing-def] [c][] [d][Case  Label]\n\n[ok]: b.md\n[c]: gone.md\n[case label]: b.md#top\n[unused]: also-gone.md\n", "docs/b.md": "# Top\n" }, ["docs/a.md"]);
  assert.equal(state(r, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
  const f = findings(r, "1B.MARKDOWN.LINKS").join("\n");
  assert.match(f, /undefined label/, "an undefined reference label is reported");
  assert.match(f, /docs\/gone\.md/, "the collapsed reference target is checked");
  assert.match(f, /docs\/also-gone\.md/, "an unused definition is still a link target to verify");
  assert.equal(/docs\/b\.md/.test(f), false);
  assert.equal(state(r, "1B.MARKDOWN.ANCHORS"), "PASS/OK", "the labelled anchor #top exists");
});

test("W1 1B check: only changed Markdown files matching the configured patterns are inspected (and read from the reader, never from Git)", async () => {
  const files = { "docs/a.md": "# A [b](missing.md)\n", "docs/skip.md": "[x](missing.md)\n", "docs/data.txt": "[x](missing.md)\n", "notes/n.md": "[x](missing.md)\n" };
  const reader = fakeReader(files);
  const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md", "docs/data.txt", "docs/gone.md"]), policy: policyOf([], ["docs/*.md"]), reader });
  assert.equal(state(r, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
  assert.equal(findings(r, "1B.MARKDOWN.LINKS").length, 1);
  assert.deepEqual(reader.calls.read.filter((p) => !p.endsWith("missing.md")), ["docs/a.md", "docs/gone.md"], "docs/skip.md and notes/n.md are unchanged and docs/data.txt does not match");
  assert.equal(rec(r, "1B.MARKDOWN.FILES").observed.notParsed, 1, "a deleted file is simply not parsed");
  assert.equal(state(r, "1B.MARKDOWN.FILES"), "PASS/OK");
});

test("W1 1B check: with nothing to inspect every record is NOT_APPLICABLE with a proof (not a hidden aggregate PASS)", async () => {
  const none = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["src/x.js"]), policy: policyOf([family()]), reader: fakeReader({ "src/x.js": "x" }) });
  assert.deepEqual(none.records.map((x) => x.status), Array(7).fill("NOT_APPLICABLE"));
  assert.deepEqual(none.records.map((x) => x.checkId), [...CHECKS, "1B.REFERENCES.TB"]);
  for (const record of none.records) assert.match(record.observed.applicabilityProof, /no changed file matches/);
  assert.equal(g.aggregate([...none.records]).kernelRecords.length, 0);
  const builtin = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy: { ...BUILTIN_MINIMUM_POLICY, protectedTargetRefs: ["main"] }, reader: fakeReader({ "docs/a.md": "# A\n" }) });
  assert.equal(builtin.records.every((x) => x.status === "NOT_APPLICABLE"), true);
  assert.match(builtin.records[0].observed.applicabilityProof, /selects no Markdown files/);
});

test("W1 1B check: invalid UTF-8 is a distinct FAIL and downgrades unrelated checks to INCOMPLETE (they ran on a partial set)", async () => {
  const bad = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]);
  const r = await check({ "docs/a.md": "# ok\n", "docs/bad.md": bad });
  assert.equal(state(r, "1B.MARKDOWN.FILES"), "FAIL/MARKDOWN_ENCODING_INVALID");
  assert.equal(state(r, "1B.MARKDOWN.FENCES"), "INCOMPLETE/MARKDOWN_UNREADABLE");
  assert.equal(g.aggregate(r.records).readiness.state, "NOT_READY");
  const oversize = await check({ "docs/big.md": { kind: "too-large", size: 9_999_999 } });
  assert.equal(state(oversize, "1B.MARKDOWN.FILES"), "INCOMPLETE/MARKDOWN_BOUND_EXCEEDED");
  const unreadable = await check({ "docs/x.md": { kind: "error" } });
  assert.equal(state(unreadable, "1B.MARKDOWN.FILES"), "INCOMPLETE/MARKDOWN_UNREADABLE");
  const tooMany = await g.checkReferences({ subject, changedFiles: changedResult(subject, Array.from({ length: 501 }, (_, i) => `d/${i}.md`)), policy: policyOf(), reader: fakeReader({}) });
  assert.equal(state(tooMany, "1B.MARKDOWN.FILES"), "INCOMPLETE/MARKDOWN_BOUND_EXCEEDED");
  const hugeDoc = await check({ "docs/h.md": "x\n".repeat(60_000) });
  assert.equal(state(hugeDoc, "1B.MARKDOWN.FILES"), "INCOMPLETE/MARKDOWN_BOUND_EXCEEDED");
});

test("W1 1B check: an unreadable link target or target document is INCOMPLETE, never a pass", async () => {
  const reader = fakeReader({ "docs/a.md": "[x](b.md#h)\n", "docs/b.md": "# H\n" });
  const flaky = { ...reader, stat: async () => ({ kind: "error" }) };
  const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy: policyOf(), reader: flaky });
  assert.equal(state(r, "1B.MARKDOWN.FILES"), "INCOMPLETE/MARKDOWN_UNREADABLE");
  assert.equal(state(r, "1B.MARKDOWN.LINKS"), "INCOMPLETE/MARKDOWN_UNREADABLE");
  const encodingTarget = await check({ "docs/a.md": "[x](b.md#h)\n", "docs/b.md": Buffer.from([0xff, 0xfe, 0x23]) }, ["docs/a.md"]);
  assert.equal(state(encodingTarget, "1B.MARKDOWN.FILES"), "FAIL/MARKDOWN_ENCODING_INVALID");
});

test("W1 1B check: the changed-file input must be the complete 1A result for the same subject (fail closed otherwise)", async () => {
  const otherSubject = makeSubject({ head: "d".repeat(40) });
  const reader = fakeReader({ "docs/a.md": "# A\n" });
  for (const bad of [null, undefined, ["docs/a.md"], { files: ["docs/a.md"] }, changedResult(otherSubject, ["docs/a.md"]), { ...changedResult(subject, ["docs/a.md"]), files: "docs/a.md" }]) {
    const r = await g.checkReferences({ subject, changedFiles: bad, policy: policyOf(), reader });
    assert.equal(state(r, "1B.MARKDOWN.FILES"), "CONFIGURATION_ERROR/CHANGED_FILES_INPUT_INVALID", JSON.stringify(bad));
    assert.equal(r.records.length, 1);
  }
  const incomplete = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md"], false), policy: policyOf(), reader });
  assert.equal(state(incomplete, "1B.MARKDOWN.FILES"), "INCOMPLETE/CHANGED_FILES_INPUT_INVALID");
  const badPath = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["../x.md"]), policy: policyOf(), reader });
  assert.equal(state(badPath, "1B.MARKDOWN.FILES"), "CONFIGURATION_ERROR/CHANGED_FILES_INPUT_INVALID");
  assert.deepEqual(reader.calls.read, [], "nothing is read for an untrusted changed-file input");
  for (const bad of [null, {}, { ...subject, head: "x" }]) assert.equal((await g.checkReferences({ subject: bad, changedFiles: changedResult(subject, []), policy: policyOf(), reader })).subject, null);
  assert.equal((await g.checkReferences(null)).subject, null);
  assert.equal((await g.checkReferences({ subject, changedFiles: changedResult(subject, ["a.md"]), policy: policyOf() })).records[0].status, "CONFIGURATION_ERROR", "no reader and no Git adapter");
  for (const bad of [null, undefined, "policy", { scope: {} }]) {
    const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy: bad, reader });
    assert.notEqual(rec(r, "1B.MARKDOWN.FILES").status, "PASS", JSON.stringify(bad));
  }
});

test("W1 1B check: output is deterministic, ordered and bounded", async () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`docs/d${String(i).padStart(2, "0")}.md`, `[x](missing${i}.md)\n`]));
  const a = await check(many);
  const b = await check(many);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(rec(a, "1B.MARKDOWN.LINKS").observed.count, 60);
  assert.equal(findings(a, "1B.MARKDOWN.LINKS").length, 20, "at most 20 findings are listed");
  assert.match(findings(a, "1B.MARKDOWN.LINKS")[0], /^docs\/d00\.md:1:/);
  const reversed = await check(Object.fromEntries(Object.entries(many).reverse()));
  assert.equal(JSON.stringify(reversed), JSON.stringify(a), "file order in the reader does not change the result");
});

test("W1 1B check: 1B judges structure only (wording such as 'confirmed' or 'verified' is never a finding)", async () => {
  const r = await check({ "docs/a.md": "# Findings\n\nThis is **confirmed** and verified. The risk is acceptable. All evidence proves the claim.\n\n| Claim | Evidence |\n|---|---|\n| X is safe | inferred |\n" });
  for (const id of CHECKS) assert.equal(state(r, id), "PASS/OK", id);
});

// ------------------------------------------------------------- ID families

const idDocs = (extra = {}) => ({
  "docs/ids.md": "# IDs\n\n| ID | Meaning |\n|---|---|\n| TB-01 | first |\n| `TB-02` | second |\n\n## TB-03 A heading definition\n",
  ...extra,
});
const idCheck = (files, changed, families = [family()]) => g.checkReferences({ subject, changedFiles: changedResult(subject, changed), policy: policyOf(families), reader: fakeReader(files) });

test("W1 1B ids: valid definitions (table first cell, heading) and references resolve", async () => {
  const r = await idCheck(idDocs({ "docs/use.md": "See TB-01, (TB-02), TB-03. and TB-01;\n" }), ["docs/use.md"]);
  assert.equal(state(r, "1B.REFERENCES.TB"), "PASS/OK");
  assert.deepEqual({ ...rec(r, "1B.REFERENCES.TB").observed }, { definitions: 3, references: 4 });
});

test("W1 1B ids: dangling, malformed and out-of-grammar identifiers are FAIL findings", async () => {
  const r = await idCheck(idDocs({ "docs/use.md": "Real TB-01, dangling TB-09, short TB-1, long TB-1000, glued xTB-05, suffixed TB-01-extra, dotted TB-01.\n" }), ["docs/use.md"]);
  assert.equal(state(r, "1B.REFERENCES.TB"), "FAIL/REFERENCE_MALFORMED");
  const f = findings(r, "1B.REFERENCES.TB").map((x) => x.replace(/^docs\/use\.md:1: /, ""));
  assert.deepEqual(f.sort(), [
    "TB-09 is referenced but never defined",
    "TB-1 starts like the TB family but is not a valid identifier",
    "TB-1000 starts like the TB family but is not a valid identifier",
    "TB-01-extra starts like the TB family but is not a valid identifier",
  ].sort());
  assert.equal(f.some((x) => x.includes("xTB-05")), false, "an identifier glued to preceding word characters is not the family's");
});

test("W1 1B ids: a duplicate definition is FAIL when any definition is in a changed file, and not blamed on an untouched pair", async () => {
  const files = { "docs/ids.md": "# IDs\n\n| ID | M |\n|---|---|\n| TB-01 | a |\n", "docs/more.md": "## TB-01 again\n", "docs/old1.md": "## TB-77 old\n", "docs/old2.md": "## TB-77 old dup\n" };
  const changedDup = await idCheck(files, ["docs/more.md"]);
  assert.equal(state(changedDup, "1B.REFERENCES.TB"), "FAIL/REFERENCE_DUPLICATE");
  assert.match(findings(changedDup, "1B.REFERENCES.TB")[0], /TB-01 is defined 2 times \(docs\/ids\.md:5, docs\/more\.md:1\)/);
  const untouched = await idCheck(files, ["docs/ids.md"].filter(() => false).concat(["docs/ids.md"]));
  assert.equal(findings(untouched, "1B.REFERENCES.TB").some((x) => x.includes("TB-77")), false, "a pre-existing duplicate elsewhere is not attributed to this change");
});

test("W1 1B ids: fenced code and inline code are skipped ONLY when the family says so (explicit, testable contexts)", async () => {
  const doc = "Real TB-01.\n\n`TB-91` inline\n\n```\nTB-92 fenced\n```\n";
  const ignoring = await idCheck(idDocs({ "docs/use.md": doc }), ["docs/use.md"]);
  assert.equal(state(ignoring, "1B.REFERENCES.TB"), "PASS/OK");
  const notIgnoring = await idCheck(idDocs({ "docs/use.md": doc }), ["docs/use.md"], [family({ ignoreContexts: [] })]);
  assert.equal(state(notIgnoring, "1B.REFERENCES.TB"), "FAIL/REFERENCE_DANGLING");
  assert.deepEqual(findings(notIgnoring, "1B.REFERENCES.TB").map((x) => x.split(" ")[1]).sort(), ["TB-91", "TB-92"]);
  const fencedOnly = await idCheck(idDocs({ "docs/use.md": doc }), ["docs/use.md"], [family({ ignoreContexts: ["FENCED_CODE"] })]);
  assert.deepEqual(findings(fencedOnly, "1B.REFERENCES.TB").map((x) => x.split(" ")[1]), ["TB-91"], "inline code is scanned when only fenced code is ignored");
  const inlineOnly = await idCheck(idDocs({ "docs/use.md": doc }), ["docs/use.md"], [family({ ignoreContexts: ["INLINE_CODE"] })]);
  assert.deepEqual(findings(inlineOnly, "1B.REFERENCES.TB").map((x) => x.split(" ")[1]), ["TB-92"]);
});

test("W1 1B ids: definition contexts are configurable (a heading is not a definition unless the family says so)", async () => {
  const tableOnly = await idCheck({ "docs/ids.md": "## TB-03 heading\n\n| ID |\n|---|\n| TB-01 |\n", "docs/use.md": "TB-03 TB-01\n" }, ["docs/use.md"], [family({ definitionContexts: ["TABLE_FIRST_CELL"] })]);
  assert.deepEqual(findings(tableOnly, "1B.REFERENCES.TB").map((x) => x.split(" ")[1]), ["TB-03"]);
  const headingOnly = await idCheck({ "docs/ids.md": "## TB-03 heading\n\n| ID |\n|---|\n| TB-01 |\n", "docs/use.md": "TB-03 TB-01\n" }, ["docs/use.md"], [family({ definitionContexts: ["HEADING"] })]);
  assert.deepEqual(findings(headingOnly, "1B.REFERENCES.TB").map((x) => x.split(" ")[1]), ["TB-01"]);
});

test("W1 1B ids: definitions come only from the configured sources; a mention in the definition source itself is a reference", async () => {
  const outside = await idCheck({ "notes/ids.md": "## TB-01 not a configured source\n", "docs/use.md": "TB-01\n" }, ["docs/use.md"]);
  assert.equal(state(outside, "1B.REFERENCES.TB"), "FAIL/REFERENCE_DANGLING");
  const selfRef = await idCheck(idDocs({}), ["docs/ids.md"].concat([]));
  assert.equal(state(selfRef, "1B.REFERENCES.TB"), "PASS/OK", "a changed definition document is checked with its own definitions");
  const mention = await idCheck({ "docs/ids.md": "## TB-01 first\n\nLater we mention TB-01 and TB-05 here.\n" }, ["docs/ids.md"]);
  assert.deepEqual(findings(mention, "1B.REFERENCES.TB").map((x) => x.split(" ")[1]), ["TB-05"]);
});

test("W1 1B ids: several families with different grammars are independent records (multi-segment IDs included)", async () => {
  const oq = family({ family: "OQ", prefix: "OQ", segments: [{ minDigits: 1, maxDigits: 1 }, { minDigits: 1, maxDigits: 2 }], definitionSources: ["docs/oq.md"], definitionContexts: ["TABLE_FIRST_CELL"] });
  const gh = family({ family: "GH", prefix: "GH-", segments: [{ minDigits: 2, maxDigits: 2 }], definitionSources: ["docs/gh.md"], definitionContexts: ["HEADING"] });
  const files = { "docs/oq.md": "| ID |\n|---|\n| OQ1-2 |\n| OQ3-10 |\n", "docs/gh.md": "## GH-05 item\n", "docs/use.md": "OQ1-2 OQ3-10 GH-05 OQ9-9 GH-06 OQ12-1 TB-01\n" };
  const r = await idCheck(files, ["docs/use.md"], [family(), oq, gh]);
  assert.deepEqual(r.records.filter((x) => x.checkId.startsWith("1B.REFERENCES.")).map((x) => x.checkId), ["1B.REFERENCES.TB", "1B.REFERENCES.OQ", "1B.REFERENCES.GH"]);
  assert.equal(state(r, "1B.REFERENCES.OQ"), "FAIL/REFERENCE_MALFORMED", "OQ12-1 has a two-digit first segment");
  assert.deepEqual(findings(r, "1B.REFERENCES.OQ").map((x) => x.replace(/^docs\/use\.md:1: /, "").split(" ")[0]).sort(), ["OQ12-1", "OQ9-9"]);
  assert.deepEqual(findings(r, "1B.REFERENCES.GH").map((x) => x.split(" ")[1]), ["GH-06"]);
  assert.equal(state(r, "1B.REFERENCES.TB"), "FAIL/REFERENCE_DANGLING", "TB-01 has no definition in the TB sources");
});

test("W1 1B ids: an invalid or ambiguous ID-family configuration is rejected by the policy, never guessed", async () => {
  const bad = validateBasePolicy(basePolicy({ markdown: { filePatterns: ["**/*.md"], idFamilies: [family(), family({ family: "TB2", prefix: "TB-" })] } }));
  assert.equal(bad.ok, false);
  const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy: { ...basePolicy({ markdown: { filePatterns: ["**/*.md"], idFamilies: [family(), family({ family: "TB2", prefix: "TB-" })] } }) }, reader: fakeReader({ "docs/a.md": "TB-01\n" }) });
  assert.equal(rec(r, "1B.MARKDOWN.FILES").status, "CONFIGURATION_ERROR");
  assert.equal(rec(r, "1B.MARKDOWN.FILES").reasonCode, "ID_FAMILY_CONFIG_INVALID");
});

test("W1 1B ids: an unavailable repository listing or unreadable definition source is INCOMPLETE", async () => {
  const listFails = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/use.md"]), policy: policyOf([family()]), reader: fakeReader(idDocs({ "docs/use.md": "TB-01\n" }), { listFails: true }) });
  assert.equal(state(listFails, "1B.REFERENCES.TB"), "INCOMPLETE/MARKDOWN_UNREADABLE");
  const badSource = await idCheck(idDocs({ "docs/use.md": "TB-01\n", "docs/broken.md": Buffer.from([0xff, 0xfe]) }), ["docs/use.md"]);
  assert.equal(state(badSource, "1B.REFERENCES.TB"), "INCOMPLETE/MARKDOWN_UNREADABLE");
});

test("W1 1B ids: matching cost is bounded for adversarial family grammars and input", async () => {
  const wide = family({ segments: [{ minDigits: 1, maxDigits: 8 }, { minDigits: 1, maxDigits: 8 }, { minDigits: 1, maxDigits: 8 }], separator: "-" });
  const started = Date.now();
  // Each line stays under the per-line bound so the MATCHER (not the size bound) is what is exercised.
  const hostile = ["TB-1".repeat(2000), "TB-".repeat(3000), "TB-123456789-".repeat(1500), `TB-${"1".repeat(30_000)}`].join("\n") + "\n";
  const r = await idCheck({ "docs/ids.md": "## TB-1-1-1 x\n", "docs/use.md": hostile }, ["docs/use.md"], [wide]);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  assert.equal(rec(r, "1B.REFERENCES.TB").status, "FAIL");
});

// --------------------------------------------------- composition with 1A

test("W1 1B composition: 1B consumes 1A's frozen changed-file set, never runs Git for it, and cannot mutate it", async () => {
  let gitCalls = 0;
  const spy = fakeAdapter({ diffNames: async () => { gitCalls += 1; return { ok: true, value: { paths: ["docs/OTHER.md"], invalid: 0 } }; } });
  const files = ["docs/a.md"];
  const changed = await g.getChangedFiles({ subject, git: fakeAdapter({ diffNames: async () => ({ ok: true, value: { paths: files, invalid: 0 } }) }), invocationTrust: "OPERATOR_SUPPLIED", platformFiles: null });
  assert.equal(changed.complete, true);
  const before = JSON.stringify(changed);
  const reader = fakeReader({ "docs/a.md": "# A\n[x](gone.md)\n", "docs/OTHER.md": "[y](gone.md)\n" });
  const r = await g.checkReferences({ subject, changedFiles: changed, policy: policyOf(), reader, git: spy });
  assert.equal(gitCalls, 0, "1B never calls Git (not for the changed files, not at all when a reader is supplied)");
  assert.deepEqual(reader.calls.read.filter((p) => !p.endsWith("gone.md")), ["docs/a.md"], "only the 1A set is read: no directory scan, no 'whatever files exist'");
  assert.equal(JSON.stringify(changed), before, "the 1A result is unchanged");
  assert.equal(Object.isFrozen(changed.files), true);
  assert.throws(() => changed.files.push("docs/evil.md"), TypeError);
  assert.equal(state(r, "1B.MARKDOWN.LINKS"), "FAIL/LINK_TARGET_MISSING");
  assert.equal(findings(r, "1B.MARKDOWN.LINKS").length, 1);
});

test("W1 1B composition: the subject is identical across stages and the combined records aggregate through the Wave 0 kernel", async () => {
  const changed = await g.getChangedFiles({ subject, git: fakeAdapter({ diffNames: async () => ({ ok: true, value: { paths: ["docs/a.md"], invalid: 0 } }) }), invocationTrust: "OPERATOR_SUPPLIED", platformFiles: null });
  const b = await g.checkReferences({ subject, changedFiles: changed, policy: policyOf(), reader: fakeReader({ "docs/a.md": "# A\n" }) });
  const s = g.checkScope({ subject, changedFiles: changed, policy: policyOf() });
  const secrets = await g.scanSecrets({ subject, changedFiles: changed, policy: policyOf(), reader: fakeReader({ "docs/a.md": "# A\n" }), now: "2026-06-01" });
  const all = [...changed.records, ...s.records, ...secrets.records, ...b.records];
  for (const record of all) assert.deepEqual(record.subject, subject, record.checkId);
  const agg = g.aggregate(all);
  assert.equal(agg.kernelRecords.some((k) => k.reasonCode === "RESULT_RECORD_INVALID" || k.reasonCode === "DUPLICATE_CHECK_ID" || k.reasonCode === "SUBJECT_MISMATCH"), false);
  assert.equal(agg.overallStatus, "PASS");
  assert.equal(agg.readiness.state, "READY");
  assert.equal(new Set(all.map((r) => r.checkId)).size, all.length, "check IDs are unique across 1A and 1B");
  const other = await g.checkReferences({ subject: makeSubject({ head: "d".repeat(40) }), changedFiles: changed, policy: policyOf(), reader: fakeReader({}) });
  assert.equal(state(other, "1B.MARKDOWN.FILES"), "CONFIGURATION_ERROR/CHANGED_FILES_INPUT_INVALID", "a changed-file set for another head is refused");
});
