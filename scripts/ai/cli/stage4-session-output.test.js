"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { capture } = require("../../../test/helpers/stage4-session-goldens");
const { cleanupScratch } = require("../../../test/helpers/qa-agent-cli");
after(cleanupScratch);
for (const kind of ["approve", "apply", "reject", "warning"]) test(`ARCH-S4A-04 whole-session golden/adversarial ${kind}`, async () => {
  const result = await capture(kind);
  // JSON line arrays preserve the contract's significant trailing spaces
  // (including an empty content row) without source whitespace exceptions.
  assert.equal(result.golden, JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../test/fixtures/stage4-session-${kind}.json`), "utf8")).join("\n"));
  for (const { stdout, stderr } of result.physical) for (const text of [stdout, stderr]) for (const row of text.split("\n").filter(Boolean)) {
    assert.match(row, /^@Q2:[HTFBCcfPEXIRAMS] /);
    assert.match(row, /^[\x20-\x7e]+$/); assert.ok(row.length <= 100, row); assert.equal((row.match(/@/g) || []).length, 1, row);
    if (row.startsWith("@Q2:T ")) assert.match(row, /^@Q2:T === TARGET 1\/1: CREATE cypress\/e2e\/generated\/login\.cy\.js$/);
    if (row.startsWith("@Q2:X ")) assert.match(row, /^@Q2:X (?:context \(not part of the presentation digest\):|repository root: |repository root binding: |reviewer principal: |approval policy: |operating rule: )/);
  }
  assert.ok(result.golden.includes("\\u0040Q2:T"));
  assert.ok(result.golden.includes("\\u202e\\u0001"));
  if (kind === "warning") assert.doesNotMatch(result.physical.at(-1).stdout, /apply completed/);
});
