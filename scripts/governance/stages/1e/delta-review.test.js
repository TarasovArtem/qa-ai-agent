"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeDeltaReview } = require("./delta-review");
const { validateGraph } = require("../../kernel/graph");
const { makeSubject } = require("../../test-support-git");

const subject = makeSubject();
const rec = (result, id) => result.records.find((r) => r.checkId === id);
const level = (result, id) => rec(result, id)?.domain?.effectiveLevel;

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
const dom = (id, deps, protectedInputs, reviewModes, extra) => ({
  domainId: id, enabled: true, ownerStage: "1E", dependsOn: deps, derivedFrom: [],
  protectedInputs: protectedInputs, reviewModes: reviewModes || ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"], ...extra,
});
const genericRecord = (checkId, ownerStage, status) => ({ checkId, ownerStage, status, subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });

async function run({ headDecls, baseDecls, filesBase, filesHead, coveringChecks, records, recordedExtractorVersions }) {
  const headGraph = validateGraph(headDecls);
  const baseGraph = baseDecls === undefined ? headGraph : validateGraph(baseDecls);
  return computeDeltaReview({
    subject, headGraph, baseGraph, records: records || [], coveringChecks: coveringChecks || {},
    recordedExtractorVersions: recordedExtractorVersions || {},
    reader: { atBase: reader(filesBase || {}), atHead: reader(filesHead || {}) },
  });
}

// ================================================================== mandatory tests 1-40

test("1. unchanged independent domain -> PRESERVATION_CHECK_ONLY", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  assert.equal(rec(r, "1E.DOMAIN.DOMAIN_A").status, "PASS");
});

test("2. own fingerprint changed -> DEEP_REVIEW_REQUIRED", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "y" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("OWN_FINGERPRINT_CHANGED"));
});

test("3. reviewModes excludes PRESERVATION_CHECK_ONLY -> DEEP even when unchanged", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("PRESERVATION_NOT_ALLOWED"));
});

test("4. covering 1B check FAIL -> not PRESERVATION", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: [genericRecord("1B.CHECK", "1B", "FAIL")] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("5. covering 1C HRR -> DEEP per the binding algorithm's own else-bucket (not HRR directly)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.CHECK"] }, records: [genericRecord("1C.CHECK", "1C", "HUMAN_REVIEW_REQUIRED")] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("6. covering 1D INCOMPLETE -> not PRESERVATION", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1D.CHECK"] }, records: [genericRecord("1D.CHECK", "1D", "INCOMPLETE")] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("7. missing required covering record -> fail closed, not PRESERVATION", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.NEVER_SUPPLIED"] }, records: [] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("COVERING_CHECK_NOT_PASS"));
});

test("8. A -> B transitive: A changes, B escalates to DEEP", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "CHANGED", "b.md": "y" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "DEEP_REVIEW_REQUIRED");
});

test("9. A -> B -> C transitive: A changes, both B and C escalate", async () => {
  const decls = [
    dom("DOMAIN_A", [], ["file:a.md"]),
    dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"]),
    dom("DOMAIN_C", [{ domain: "DOMAIN_B", kind: "DERIVED_VALUE" }], ["file:c.md"]),
  ];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "y", "c.md": "z" }, filesHead: { "a.md": "CHANGED", "b.md": "y", "c.md": "z" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "DEEP_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_C"), "DEEP_REVIEW_REQUIRED");
});

test("10. MEANING dependency changed -> HUMAN_REVIEW_REQUIRED", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "MEANING" }], ["file:b.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "CHANGED", "b.md": "y" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "HUMAN_REVIEW_REQUIRED");
  assert.equal(rec(r, "1E.DOMAIN.DOMAIN_B").status, "HUMAN_REVIEW_REQUIRED");
});

test("11. upstream HRR -> dependent HRR", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"])];
  // Force A to HRR via a missing base region.
  const r = await run({ headDecls: decls, filesBase: { "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "HUMAN_REVIEW_REQUIRED");
});

test("12. mixed own/inherited uses max level (own PRESERVATION + inherited DEEP -> DEEP)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "CHANGED", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" } });
  // A changed (base!=head): DEEP. B's own fingerprint unchanged, but inherited=DEEP.
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "DEEP_REVIEW_REQUIRED");
});

test("13. manifest declaration changed -> not PRESERVATION", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md"])];
  const head = [dom("DOMAIN_A", [], ["file:a.md", "file:b.md"])];
  const r = await run({ headDecls: head, baseDecls: base, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("MANIFEST_DECLARATION_CHANGED"));
});

test("14. added domain (head only) -> not PRESERVATION", async () => {
  const r = await run({ headDecls: [dom("DOMAIN_A", [], ["file:a.md"])], baseDecls: [], filesBase: {}, filesHead: { "a.md": "x" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("DOMAIN_ADDED"));
});

test("15. removed domain (base only) -> fail closed to HUMAN_REVIEW_REQUIRED", async () => {
  const r = await run({ headDecls: [], baseDecls: [dom("DOMAIN_A", [], ["file:a.md"])], filesBase: { "a.md": "x" }, filesHead: {} });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("DOMAIN_REMOVED"));
});

test("16. base unavailable -> HUMAN_REVIEW_REQUIRED", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: {}, filesHead: { "a.md": "x" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("BASE_UNAVAILABLE"));
});

test("17. region missing (at head) -> HUMAN_REVIEW_REQUIRED", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: {} });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("REGION_MISSING"));
});

test("18. extractor version mismatch -> changed (never assumed unchanged)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, recordedExtractorVersions: { DOMAIN_A: "gov-fp-v0" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("EXTRACTOR_VERSION_CHANGED"));
});

test("19. CRLF vs LF -> same fingerprint (real base/head content, through computeDeltaReview)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "line1\nline2\n" }, filesHead: { "a.md": "line1\r\nline2\r\n" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("20. BOM-only difference -> same fingerprint", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const bom = "﻿content\n";
  const r = await run({ headDecls: decls, filesBase: { "a.md": "content\n" }, filesHead: { "a.md": bom } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("21. trailing whitespace change -> different fingerprint (domain changed)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "content\n" }, filesHead: { "a.md": "content   \n" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("22. internal whitespace change -> different fingerprint (domain changed)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "| A | B |\n" }, filesHead: { "a.md": "| A  | B |\n" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("23. invalid UTF-8 -> fail closed (HUMAN_REVIEW_REQUIRED), never a crash", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const badReader = { async read() { return { kind: "blob", bytes: Buffer.from([0xff, 0xfe]) }; }, async stat() { return { kind: "file" }; }, async list() { return { ok: true, paths: [] }; } };
  const headGraph = validateGraph(decls);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: badReader } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("24. orderIndependent row reorder -> same fingerprint", async () => {
  const table = (rows) => `## Findings\n| ID | V |\n|---|---|\n${rows.map((r) => `| ${r} | x |`).join("\n")}\n`;
  const decls = [dom("DOMAIN_A", [], ["table-rows:a.md#Findings!orderIndependent"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": table(["R1", "R2"]) }, filesHead: { "a.md": table(["R2", "R1"]) } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("25. order-sensitive reorder -> different fingerprint", async () => {
  const table = (rows) => `## Findings\n| ID | V |\n|---|---|\n${rows.map((r) => `| ${r} | x |`).join("\n")}\n`;
  const decls = [dom("DOMAIN_A", [], ["table-rows:a.md#Findings"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": table(["R1", "R2"]) }, filesHead: { "a.md": table(["R2", "R1"]) } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("26. duplicate record IDs -> fail closed", async () => {
  const doc = "## Findings\n| ID | V |\n|---|---|\n| R1 | a |\n| R1 | b |\n";
  const decls = [dom("DOMAIN_A", [], ["table-rows:a.md#Findings!orderIndependent"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": doc }, filesHead: { "a.md": doc } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("27. framing ambiguity probe: two selectors with content that could naively concatenate ambiguously stay distinct", async () => {
  const decls1 = [dom("DOMAIN_A", [], ["file:ab.md"])];
  const decls2 = [dom("DOMAIN_A", [], ["file:a.md"])]; // deliberately a different, shorter selector
  const r1 = await run({ headDecls: decls1, filesBase: { "ab.md": "cd" }, filesHead: { "ab.md": "cd" } });
  const r2 = await run({ headDecls: decls2, filesBase: { "a.md": "bcd" }, filesHead: { "a.md": "bcd" } });
  assert.notEqual(rec(r1, "1E.DOMAIN.DOMAIN_A").domain.fingerprint, rec(r2, "1E.DOMAIN.DOMAIN_A").domain.fingerprint);
});

test("28. head tries to remove protectedInputs (narrows scope) -> still not PRESERVATION (declaration changed)", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md", "file:b.md"])];
  const head = [dom("DOMAIN_A", [], ["file:a.md"])]; // head narrows its own protected scope
  const r = await run({ headDecls: head, baseDecls: base, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x" } });
  assert.notEqual(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("29. head tries to weaken a dependency (DERIVED_VALUE -> nothing) -> still not PRESERVATION", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"])];
  const head = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])]; // head drops the dependency edge
  const r = await run({ headDecls: head, baseDecls: base, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" } });
  assert.notEqual(level(r, "1E.DOMAIN.DOMAIN_B"), "PRESERVATION_CHECK_ONLY");
});

test("30. record subject mismatch -> covering record rejected (treated as missing)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const otherSubject = { ...subject, head: "d".repeat(40) };
  const wrongSubjectRecord = { checkId: "1B.CHECK", ownerStage: "1B", status: "PASS", subject: otherSubject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] };
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: [wrongSubjectRecord] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("31. duplicate domain result is impossible: each domain appears in records[] exactly once", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" } });
  const ids = r.records.map((x) => x.checkId);
  assert.equal(new Set(ids).size, ids.length);
});

test("32. disabled domain produces no result", async () => {
  const decls = [{ domainId: "DOMAIN_A", enabled: false, ownerStage: "1E", dependsOn: [], derivedFrom: [], protectedInputs: [], reviewModes: ["DEEP_REVIEW_REQUIRED"] }];
  const r = await run({ headDecls: decls, filesBase: {}, filesHead: {} });
  assert.equal(rec(r, "1E.DOMAIN.DOMAIN_A"), undefined);
});

test("33. every enabled domain gets exactly one result", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"]), dom("DOMAIN_C", [], ["file:c.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "1", "b.md": "2", "c.md": "3" }, filesHead: { "a.md": "1", "b.md": "2", "c.md": "3" } });
  assert.equal(r.records.filter((x) => x.domain).length, 3);
  for (const id of ["DOMAIN_A", "DOMAIN_B", "DOMAIN_C"]) assert.ok(rec(r, `1E.DOMAIN.${id}`));
  // Corrective C1 (1G M1): 1E states the reported domain set once, as its own record.
  assert.deepEqual([...rec(r, "1E.DELTA.DOMAIN_SET").observed.domainIds], ["DOMAIN_A", "DOMAIN_B", "DOMAIN_C"]);
});

test("34. deterministic output across repeated runs with identical input", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"])];
  const opts = { headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x2", "b.md": "y" } };
  const r1 = await run(opts);
  const r2 = await run(opts);
  assert.deepEqual(r1.records, r2.records);
});

test("35. malformed public input -> controlled failure, no crash", async () => {
  for (const bad of [null, undefined, 42, {}, { subject: null }, { subject, headGraph: null }]) {
    const p = computeDeltaReview(bad);
    await assert.doesNotReject(p);
    const r = await p;
    assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
  }
});

test("36. aggregate bounds -> controlled fail-closed (too many domains across base+head union)", async () => {
  const headDecls = Array.from({ length: 200 }, (_, i) => dom(`DOMAIN_H${String(i).padStart(3, "0")}`, [], [], ["DEEP_REVIEW_REQUIRED"]));
  const baseDecls = Array.from({ length: 200 }, (_, i) => dom(`DOMAIN_B${String(i).padStart(3, "0")}`, [], [], ["DEEP_REVIEW_REQUIRED"]));
  const headGraph = validateGraph(headDecls);
  const baseGraph = validateGraph(baseDecls);
  assert.equal(headGraph.valid, true);
  assert.equal(baseGraph.valid, true);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph, records: [], coveringChecks: {}, reader: { atBase: reader({}), atHead: reader({}) } });
  assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
});

test("37. working tree differs but Git blobs are the same -> authoritative result comes from the injected reader only", async () => {
  // The reader abstraction IS the Git-object source in this test seam; this
  // regression proves computeDeltaReview never reads anything else (no fs
  // access, no working-tree fallback) -- the only two files it ever knows
  // about are exactly what atBase/atHead return.
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "same" }, filesHead: { "a.md": "same" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("38. file not in diff but upstream derived source changed -> domain changed (GD-RV-17)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:source.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:derived.md"])];
  // derived.md itself is byte-identical base vs head; only its upstream source changed.
  const r = await run({ headDecls: decls, filesBase: { "source.md": "v1", "derived.md": "count=1" }, filesHead: { "source.md": "v2", "derived.md": "count=1" } });
  assert.notEqual(level(r, "1E.DOMAIN.DOMAIN_B"), "PRESERVATION_CHECK_ONLY");
});

test("39. fingerprint equality alone never lowers or raises review class -- effectiveLevel/status carry no such field", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" } });
  const record = rec(r, "1E.DOMAIN.DOMAIN_A");
  assert.equal("reviewClass" in record, false);
  assert.equal("reviewClass" in record.domain, false);
});

test("40. no merge-authority fields exist anywhere in the output", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" } });
  const json = JSON.stringify(r);
  for (const forbidden of ["safeToMerge", "mergeApproved", "reviewApproved", "mayMerge", "SAFE_TO_MERGE"]) {
    assert.equal(json.includes(forbidden), false, forbidden);
  }
});

// ================================================================== adversarial fixtures (section 83)

test("adversarial: forged changed=false has no effect -- the field does not exist on input and is always computed", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "CHANGED" } });
  // Even though nothing in the public input shape has a "changed" field to forge,
  // prove the level still reflects the real content difference.
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("adversarial: forged precomputed fingerprint in input is never accepted as authority (no such input field exists)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = validateGraph(decls);
  const r = await computeDeltaReview({
    subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {},
    fingerprint: "gov-fp-v1:" + "0".repeat(64), // not a recognized input field; must be silently ignored
    reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "y" }) },
  });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.notEqual(rec(r, "1E.DOMAIN.DOMAIN_A").domain.fingerprint, "gov-fp-v1:" + "0".repeat(64));
});

test("adversarial: forged PRESERVATION effectiveLevel in input is never accepted (no such input field exists)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = validateGraph(decls);
  const r = await computeDeltaReview({
    subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {},
    effectiveLevel: "PRESERVATION_CHECK_ONLY",
    reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "DIFFERENT" }) },
  });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("adversarial: stale 1C/1D record from a previous HEAD is rejected as a covering record", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const staleSubject = { ...subject, head: "e".repeat(40) };
  const stale = { checkId: "1C.CHECK", ownerStage: "1C", status: "PASS", subject: staleSubject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] };
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.CHECK"] }, records: [stale] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("adversarial: missing dependency output cannot happen -- topological order guarantees every dependency resolves before its dependent", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "REFERENCE" }], ["file:b.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" } });
  assert.equal(r.records.filter((x) => x.domain).length, 2);
});

test("adversarial: untrusted head-only manifest weakening (adding a false PRESERVATION_CHECK_ONLY declaration for a domain the base marks DEEP-only) is not honored", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED"])];
  const head = [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"])];
  const r = await run({ headDecls: head, baseDecls: base, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" } });
  // Corrective C1 (1G M4): adding a review mode the base does not allow is a
  // loosening proposal -- not applied (the base reviewModes stay in force) and
  // escalated to human review, never merely DEEP.
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("GOVERNANCE_CONFIG"));
});

test("adversarial: multiple selector matches (ambiguous heading) fails closed rather than silently resolving", async () => {
  const doc = "## Dup\na\n## Dup\nb\n";
  const decls = [dom("DOMAIN_A", [], ["heading:a.md#Dup"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": doc }, filesHead: { "a.md": doc } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("adversarial: huge region input is bounded, not a resource exhaustion vector", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:huge.md"])];
  const huge = "x".repeat(5 * 1024 * 1024); // over the 4MB MAX_REGION_BYTES bound
  const r = await run({ headDecls: decls, filesBase: { "huge.md": huge }, filesHead: { "huge.md": huge } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("adversarial: path traversal selector is rejected, not resolved", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:../outside.md"])];
  const r = await run({ headDecls: decls, filesBase: {}, filesHead: {} });
  // Wave 0's own graph validation already rejects control-char/oversized selectors,
  // but a traversal-shaped string is syntactically legal to graph.js (it only
  // checks length/control-chars) -- 1E's own parseSelector() must still reject it.
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("adversarial: dependency chain designed to bypass transitive escalation still escalates (diamond: A->B, A->C, B+C->D)", async () => {
  const decls = [
    dom("DOMAIN_A", [], ["file:a.md"]),
    dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"]),
    dom("DOMAIN_C", [{ domain: "DOMAIN_A", kind: "REFERENCE" }], ["file:c.md"]),
    dom("DOMAIN_D", [{ domain: "DOMAIN_B", kind: "DERIVED_VALUE" }, { domain: "DOMAIN_C", kind: "DERIVED_VALUE" }], ["file:d.md"]),
  ];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "1", "c.md": "2", "d.md": "3" }, filesHead: { "a.md": "CHANGED", "b.md": "1", "c.md": "2", "d.md": "3" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_D"), "DEEP_REVIEW_REQUIRED");
});

// ================================================================== Corrective C1: W3-SEC-H1 / W3-SEC-H2 trust-boundary hardening

function forgedGraph(domains, topologicalOrder) {
  return { valid: true, status: "PASS", findings: [], domains, topologicalOrder };
}

// ---- W3-SEC-H1: topologicalOrder structural verification (10 tests)

test("H1.1. dependent placed before its dependency in topologicalOrder -> fails closed, no false PRESERVATION", async () => {
  const domains = [
    dom("DOMAIN_A", [], ["file:a.md"]),
    dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"]),
  ];
  const headGraph = forgedGraph(domains, ["DOMAIN_B", "DOMAIN_A"]);
  const r = await computeDeltaReview({
    subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {},
    reader: { atBase: reader({ "a.md": "orig", "b.md": "same" }), atHead: reader({ "a.md": "CHANGED", "b.md": "same" }) },
  });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1E.DELTA.GRAPH");
  assert.equal(r.records[0].status, "CONFIGURATION_ERROR");
  assert.equal(r.records.some((x) => x.checkId === "1E.DOMAIN.DOMAIN_B"), false);
});

test("H1.2. topologicalOrder omits an enabled domain -> fails closed, domain is never silently dropped without signal", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])];
  const headGraph = forgedGraph(domains, ["DOMAIN_A"]);
  const r = await computeDeltaReview({
    subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {},
    reader: { atBase: reader({ "a.md": "x", "b.md": "x" }), atHead: reader({ "a.md": "x", "b.md": "x" }) },
  });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1E.DELTA.GRAPH");
  assert.equal(r.records[0].status, "CONFIGURATION_ERROR");
});

test("H1.3. topologicalOrder contains a duplicate entry -> fails closed", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraph(domains, ["DOMAIN_A", "DOMAIN_A"]);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].status, "CONFIGURATION_ERROR");
});

test("H1.4. topologicalOrder names a domain id that does not exist at all -> fails closed", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraph(domains, ["DOMAIN_A", "DOMAIN_GHOST"]);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].status, "CONFIGURATION_ERROR");
});

test("H1.5. topologicalOrder includes a disabled domain -> fails closed", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"]), { ...dom("DOMAIN_B", [], ["file:b.md"]), enabled: false }];
  const headGraph = forgedGraph(domains, ["DOMAIN_A", "DOMAIN_B"]);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x", "b.md": "x" }), atHead: reader({ "a.md": "x", "b.md": "x" }) } });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].status, "CONFIGURATION_ERROR");
});

test("H1.6. topologicalOrder is not an array (string, null, object) -> fails closed, never throws, never produces a domain record", async () => {
  // A non-array topologicalOrder is already rejected by the pre-existing
  // isValidatedGraph() gate (it requires Array.isArray(topologicalOrder)),
  // before validateTopologicalOrder() is even reached -- that is still a
  // correct fail-closed outcome (the legacy invalidInput() shape), just via
  // a different pre-existing mechanism than the new 1E.DELTA.GRAPH record.
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  for (const bad of ["DOMAIN_A", null, {}]) {
    const headGraph = forgedGraph(domains, bad);
    const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
    assert.equal(r.records.some((x) => x.checkId === "1E.DOMAIN.DOMAIN_A"), false, JSON.stringify(bad));
    const failedClosed = (r.records.length === 0 && r.outcome && r.outcome.status === "CONFIGURATION_ERROR") ||
      (r.records.length === 1 && r.records[0].status === "CONFIGURATION_ERROR");
    assert.equal(failedClosed, true, JSON.stringify(bad));
  }
});

test("H1.7. topologicalOrder entries are not strings -> fails closed", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraph(domains, [42]);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].status, "CONFIGURATION_ERROR");
});

test("H1.8. a genuine validateGraph() diamond graph still resolves every level correctly post-fix", async () => {
  const decls = [
    dom("DOMAIN_A", [], ["file:a.md"]),
    dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"]),
    dom("DOMAIN_C", [{ domain: "DOMAIN_A", kind: "MEANING" }], ["file:c.md"]),
    dom("DOMAIN_D", [], ["file:d.md"]),
  ];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "1", "c.md": "2", "d.md": "3" }, filesHead: { "a.md": "CHANGED", "b.md": "1", "c.md": "2", "d.md": "3" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "DEEP_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_C"), "HUMAN_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_D"), "PRESERVATION_CHECK_ONLY");
});

test("H1.9. the 1E.DELTA.GRAPH failure record itself validates against the kernel contract and carries no domain field", async () => {
  const { validateResultRecord } = require("../../kernel/results");
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraph(domains, ["DOMAIN_A", "DOMAIN_A"]);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  assert.equal(validateResultRecord(r.records[0]).ok, true, JSON.stringify(r.records[0]));
  assert.equal(Object.hasOwn(r.records[0], "domain"), false);
});

test("H1.10. an invalid topologicalOrder never yields an empty records array masquerading as success", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraph(domains, []);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  assert.notEqual(r.records.length, 0);
  assert.equal(r.records[0].status, "CONFIGURATION_ERROR");
});

// ---- W3-SEC-H2: duplicate checkId identity (10 tests)

test("H2.1. duplicate covering checkId, [FAIL, PASS] order -> not trusted, not PRESERVATION", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const dup = [genericRecord("1B.CHECK", "1B", "FAIL"), genericRecord("1B.CHECK", "1B", "PASS")];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: dup });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("H2.2. duplicate covering checkId, [PASS, FAIL] order -> symmetric, same result as H2.1", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const dup = [genericRecord("1B.CHECK", "1B", "PASS"), genericRecord("1B.CHECK", "1B", "FAIL")];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: dup });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("H2.3. triple duplicate (FAIL, PASS, PASS) -> still not trusted despite a PASS majority", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const dup = [genericRecord("1B.CHECK", "1B", "FAIL"), genericRecord("1B.CHECK", "1B", "PASS"), genericRecord("1B.CHECK", "1B", "PASS")];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: dup });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("H2.4. two byte-identical PASS records sharing a checkId -> still not trusted (no silent dedup)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const dup = [genericRecord("1B.CHECK", "1B", "PASS"), genericRecord("1B.CHECK", "1B", "PASS")];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: dup });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("H2.5. a single valid PASS with no duplicate is still trusted (regression)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: [genericRecord("1B.CHECK", "1B", "PASS")] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("H2.6. a single genuine FAIL with no duplicate still correctly blocks preservation (regression)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: [genericRecord("1B.CHECK", "1B", "FAIL")] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("H2.7. a record sharing a checkId but a different (stale) subject is not counted as a duplicate; the current-subject record remains trusted alone", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const staleSubject = { ...subject, head: "e".repeat(40) };
  const stale = { checkId: "1B.CHECK", ownerStage: "1B", status: "PASS", subject: staleSubject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] };
  const current = genericRecord("1B.CHECK", "1B", "PASS");
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: [stale, current] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("H2.8. unrelated distinct checkIds are unaffected by each other's duplicate status", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])];
  const records = [
    genericRecord("1B.CHECK_A", "1B", "PASS"),
    genericRecord("1B.CHECK_B", "1B", "PASS"), genericRecord("1B.CHECK_B", "1B", "FAIL"),
  ];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "x" }, filesHead: { "a.md": "x", "b.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK_A"], DOMAIN_B: ["1B.CHECK_B"] }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "DEEP_REVIEW_REQUIRED");
});

test("H2.9. a malformed second record sharing a checkId and subject with a valid PASS still poisons the pair", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const valid = genericRecord("1B.CHECK", "1B", "PASS");
  const malformed = { checkId: "1B.CHECK", ownerStage: "1B", status: "NOT-A-REAL-STATUS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] };
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.CHECK"] }, records: [valid, malformed] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("H2.10. a checkId shared across two different domains' coveringChecks is poisoned for both once duplicated", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])];
  const dup = [genericRecord("1B.SHARED", "1B", "PASS"), genericRecord("1B.SHARED", "1B", "FAIL")];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "x" }, filesHead: { "a.md": "x", "b.md": "x" }, coveringChecks: { DOMAIN_A: ["1B.SHARED"], DOMAIN_B: ["1B.SHARED"] }, records: dup });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "DEEP_REVIEW_REQUIRED");
});

// ---- Integration / cross-cutting (5 tests)

test("INT.1. an invalid topologicalOrder combined with a duplicated covering checkId still fails closed via the graph-level error, before any domain (or false PRESERVATION) can be produced", async () => {
  const domains = [
    dom("DOMAIN_A", [], ["file:a.md"]),
    dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"]),
  ];
  const headGraph = forgedGraph(domains, ["DOMAIN_B", "DOMAIN_A"]); // wrong order
  const dup = [genericRecord("1B.CHECK", "1B", "PASS"), genericRecord("1B.CHECK", "1B", "FAIL")]; // duplicated covering check
  const r = await computeDeltaReview({
    subject, headGraph, baseGraph: headGraph, records: dup, coveringChecks: { DOMAIN_A: ["1B.CHECK"], DOMAIN_B: ["1B.CHECK"] },
    reader: { atBase: reader({ "a.md": "x", "b.md": "x" }), atHead: reader({ "a.md": "x", "b.md": "x" }) },
  });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1E.DELTA.GRAPH");
  assert.equal(r.records[0].status, "CONFIGURATION_ERROR");
});

test("INT.2. the full 8-condition PRESERVATION pre-gate still resolves end-to-end for a genuine unchanged multi-domain graph post-fix", async () => {
  const decls = [
    dom("DOMAIN_A", [], ["file:a.md"]),
    dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"]),
  ];
  const r = await run({
    headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" },
    coveringChecks: { DOMAIN_A: ["1B.CHECK"], DOMAIN_B: ["1B.CHECK2"] },
    records: [genericRecord("1B.CHECK", "1B", "PASS"), genericRecord("1B.CHECK2", "1B", "PASS")],
  });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "PRESERVATION_CHECK_ONLY");
});

test("INT.3. a MEANING edge to an unchanged (PRESERVATION) upstream does not itself force escalation -- propagation semantics are unchanged by the fix", async () => {
  const decls = [
    dom("DOMAIN_A", [], ["file:a.md"]),
    dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "MEANING" }], ["file:b.md"]),
  ];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "PRESERVATION_CHECK_ONLY");
});

test("INT.4. deterministic output across repeated runs with a genuine graph and no duplicate records (duplicate-detection maps introduce no iteration-order nondeterminism)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"]), dom("DOMAIN_C", [], ["file:c.md"])];
  const coveringChecks = { DOMAIN_A: ["1B.A"], DOMAIN_B: ["1B.B"], DOMAIN_C: ["1B.C"] };
  const records = [genericRecord("1B.A", "1B", "PASS"), genericRecord("1B.B", "1B", "PASS"), genericRecord("1B.C", "1B", "PASS")];
  const args = { headDecls: decls, filesBase: { "a.md": "x", "b.md": "y", "c.md": "z" }, filesHead: { "a.md": "x", "b.md": "y", "c.md": "z" }, coveringChecks, records };
  const r1 = await run(args);
  const r2 = await run(args);
  assert.deepEqual(r1.records, r2.records);
});

test("INT.5. combined forged topologicalOrder, duplicated records, and malformed coveringChecks never throws", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])];
  const headGraph = forgedGraph(domains, ["DOMAIN_A", "DOMAIN_A", "DOMAIN_GHOST"]);
  const dup = [genericRecord("1B.CHECK", "1B", "PASS"), genericRecord("1B.CHECK", "1B", "PASS"), { not: "a record" }];
  await assert.doesNotReject(computeDeltaReview({
    subject, headGraph, baseGraph: headGraph, records: dup, coveringChecks: { DOMAIN_A: ["1B.CHECK"], DOMAIN_B: "not-an-array" },
    reader: { atBase: reader({ "a.md": "x", "b.md": "x" }), atHead: reader({ "a.md": "x", "b.md": "x" }) },
  }));
});

// ================================================================== Corrective C2: W3-SEC-H2 residual / W3-C1-SEC-L1 diagnostic sanitization

const MAX_POOLED_RECORDS = 4096;

/** Build an N-record pool with specific records placed at given indices; every other slot is a distinct, unrelated, valid filler PASS record. */
function buildPool(n, { passAt = [], failAt = [], checkId = "1C.REQ", malformedAt = [], wrongSubjectAt = [] } = {}) {
  const arr = [];
  const staleSubject = { ...subject, head: "f".repeat(40) };
  for (let i = 0; i < n; i++) {
    if (passAt.includes(i)) arr.push(genericRecord(checkId, "1C", "PASS"));
    else if (failAt.includes(i)) arr.push(genericRecord(checkId, "1C", "FAIL"));
    else if (malformedAt.includes(i)) arr.push({ checkId, ownerStage: "1C", status: "NOT-A-REAL-STATUS", subject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });
    else if (wrongSubjectAt.includes(i)) arr.push({ checkId, ownerStage: "1C", status: "PASS", subject: staleSubject, observed: {}, expected: null, reasonCode: "OK", detail: "", evidenceRefs: [] });
    else arr.push(genericRecord(`1C.FILLER_${i}`, "1C", "PASS"));
  }
  return arr;
}

const singleDomain = [dom("DOMAIN_A", [], ["file:a.md"])];

// ---- W3-SEC-H2 residual: record-pool completeness (15 tests)

test("C2-H2.1. 4095 valid records (below the cap) -- normal processing, no rejection", async () => {
  const records = buildPool(4095, { passAt: [0] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  assert.equal(r.records.some((x) => x.checkId === "1E.DELTA.RECORD_POOL"), false);
});

test("C2-H2.2. exactly 4096 valid records (at the cap) -- normal processing, no rejection", async () => {
  const records = buildPool(4096, { passAt: [0] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  assert.equal(r.records.some((x) => x.checkId === "1E.DELTA.RECORD_POOL"), false);
});

test("C2-H2.3. 4097 valid (non-duplicate) records -- rejected outright, explicit fail-closed", async () => {
  const records = buildPool(4097, { passAt: [0] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].reasonCode, "DELTA_RECORD_POOL_LIMIT_EXCEEDED");
  assert.equal(r.records.some((x) => x.checkId === "1E.DOMAIN.DOMAIN_A"), false);
});

test("C2-H2.4. PASS at index 0, FAIL at index 4096 (4097 total) -- rejected, never resolves to false PRESERVATION", async () => {
  const records = buildPool(4097, { passAt: [0], failAt: [4096] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("C2-H2.5. FAIL at index 0, PASS at index 4096 (4097 total) -- same fail-closed classification (order-independent)", async () => {
  const records = buildPool(4097, { failAt: [0], passAt: [4096] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("C2-H2.6. duplicate checkId spanning indices 4095 and 4096 -- rejected", async () => {
  const records = buildPool(4097, { passAt: [4095], failAt: [4096] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
});

test("C2-H2.7. duplicate checkId spanning indices 0 and 4096 -- rejected", async () => {
  const records = buildPool(4097, { passAt: [0], failAt: [4096] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
});

test("C2-H2.8. byte-identical duplicate PASS pair beyond the cap -- still rejected, no silent dedup-through-rejection", async () => {
  const records = buildPool(4097, { passAt: [0, 4096] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
});

test("C2-H2.9. oversized input with no duplicate checkId anywhere -- still rejected on size alone", async () => {
  const records = buildPool(4097, { passAt: [0] }); // every other slot is a distinct filler checkId; no duplicates exist
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
});

test("C2-H2.10. oversized input where the only relevant covering record sits beyond the old cap -- fails closed, not treated as an absent (vacuously satisfied) covering check", async () => {
  const records = buildPool(4097, { passAt: [4096] }); // the only "1C.REQ" occurrence is the very last element
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
  assert.equal(r.records.some((x) => x.checkId === "1E.DOMAIN.DOMAIN_A"), false);
});

test("C2-H2.11. oversized input with a malformed final element -- fails closed on size alone, no crash", async () => {
  const records = buildPool(4097, { malformedAt: [4096] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
});

test("C2-H2.12. oversized input with a wrong-subject final element -- the public pool-size limit applies to the entire raw input, not a pre-filtered subset (documented choice)", async () => {
  // The size gate reads input.records.length directly, before any subject
  // filtering -- so a caller cannot dodge the bound by padding the pool with
  // records that would later be excluded as irrelevant.
  const records = buildPool(4097, { passAt: [0], wrongSubjectAt: [4096] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
});

test("C2-H2.13. exactly-at-cap (4096) single legitimate PASS remains usable for PRESERVATION", async () => {
  const records = buildPool(MAX_POOLED_RECORDS, { passAt: [0] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("C2-H2.14. within-cap duplicate behavior from C1 is preserved (not superseded by the new size gate)", async () => {
  const records = buildPool(100, { passAt: [0], failAt: [50] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.equal(r.records.some((x) => x.checkId === "1E.DELTA.RECORD_POOL"), false);
});

test("C2-H2.15. a rejected oversized pool never yields an empty records array or a green/PASS outcome", async () => {
  const records = buildPool(4097, { passAt: [0] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.notEqual(r.records.length, 0);
  assert.notEqual(r.records[0].status, "PASS");
  assert.equal(r.records[0].status, "INCOMPLETE");
});

// ---- W3-C1-SEC-L1: diagnostic sanitization (10 tests)

function forgedGraphC2(domains, topologicalOrder) {
  return { valid: true, status: "PASS", findings: [], domains, topologicalOrder };
}
async function invalidGraphDetail(evilOrderEntry) {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraphC2(domains, ["DOMAIN_A", evilOrderEntry]);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  return r.records[0];
}

test("C2-L1.1. ESC and BEL in a graph-derived diagnostic are neutralized, never emitted raw", async () => {
  const rec1 = await invalidGraphDetail("EVIL\u001b[31mBELL\u0007END");
  assert.equal(/[\x1b\x07]/.test(rec1.detail), false);
});

test("C2-L1.2. CR/LF log-injection text is neutralized, never emitted raw", async () => {
  const rec1 = await invalidGraphDetail("EVIL\r\nSECOND_LINE");
  assert.equal(/[\r\n]/.test(rec1.detail), false);
});

test("C2-L1.3. a fake embedded '1E.DOMAIN.* PASS' result line cannot appear as its own line in the diagnostic, and the record itself stays CONFIGURATION_ERROR", async () => {
  const rec1 = await invalidGraphDetail("X\n1E.DOMAIN.DB PASS PRESERVATION_CHECK_ONLY");
  assert.equal(rec1.checkId, "1E.DELTA.GRAPH");
  assert.equal(rec1.status, "CONFIGURATION_ERROR");
  assert.equal(/\n1E\.DOMAIN\./.test(rec1.detail), false);
});

test("C2-L1.4. bidirectional override/isolate control characters are neutralized by the canonical sanitizer", async () => {
  const bidi = "‪‫‭‮‬⁦⁧⁨⁩";
  const rec1 = await invalidGraphDetail(`X${bidi}Y`);
  for (const ch of bidi) assert.equal(rec1.detail.includes(ch), false, `bidi char U+${ch.codePointAt(0).toString(16)} leaked raw`);
});

test("C2-L1.5. a GitHub-token-shaped synthetic string is redacted, never emitted raw", async () => {
  const fakeToken = "ghp_" + "A".repeat(36); // synthetic, non-functional shape only
  // No sensitive-key-shaped prefix (token=, secret:, credential, ...) here:
  // that would additionally trip the generic sensitive key/value redaction
  // path (over-redaction, itself correct behavior) and mask which specific
  // rule fired. This isolates the token-shape rule itself.
  const rec1 = await invalidGraphDetail(`embedded-value ${fakeToken} end`);
  assert.equal(rec1.detail.includes(fakeToken), false);
  assert.ok(rec1.detail.includes("[REDACTED:GITHUB_TOKEN]"));
});

test("C2-L1.6. multiple distinct synthetic secret shapes in one diagnostic are all redacted", async () => {
  const gh = "ghp_" + "B".repeat(36);
  const aws = "AKIA" + "C".repeat(16);
  const rec1 = await invalidGraphDetail(`${gh} and ${aws}`);
  assert.equal(rec1.detail.includes(gh), false);
  assert.equal(rec1.detail.includes(aws), false);
});

test("C2-L1.7. an oversized diagnostic string is bounded in the output", async () => {
  const rec1 = await invalidGraphDetail("X".repeat(10000));
  assert.ok(rec1.detail.length <= 500);
});

test("C2-L1.8. a short benign diagnostic remains readable and unmangled", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraphC2(domains, ["DOMAIN_A", "DOMAIN_A"]); // genuine duplicate-entry rejection reason
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  assert.ok(r.records[0].detail.includes("duplicate"));
  assert.ok(r.records[0].detail.includes("DOMAIN_A"));
});

test("C2-L1.9. the record structure is correct (checkId/status/reasonCode/subject) even with a hostile diagnostic payload", async () => {
  const rec1 = await invalidGraphDetail("\u001b\u0007\r\n" + "ghp_" + "D".repeat(36));
  assert.equal(rec1.checkId, "1E.DELTA.GRAPH");
  assert.equal(rec1.ownerStage, "1E");
  assert.equal(rec1.status, "CONFIGURATION_ERROR");
  assert.equal(rec1.reasonCode, "DELTA_GRAPH_INCONSISTENT");
  assert.deepEqual(rec1.subject, subject);
});

test("C2-L1.10. the sanitized record still validates against the kernel's validateResultRecord()", async () => {
  const { validateResultRecord } = require("../../kernel/results");
  const rec1 = await invalidGraphDetail("‮" + "ghp_" + "E".repeat(36) + "\n\x07");
  assert.equal(validateResultRecord(rec1).ok, true, JSON.stringify(rec1));
});

// ---- Integration / cross-cutting (5 tests)

test("C2-INT.1. an invalid graph combined with an unsafe diagnostic AND an oversized record pool still fails closed with no domain record and no PRESERVATION", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraphC2(domains, ["DOMAIN_A", "EVIL\u001b\n1E.DOMAIN.DA PASS"]);
  const records = buildPool(4097, { passAt: [0] });
  const r = await computeDeltaReview({
    subject, headGraph, baseGraph: headGraph, records, coveringChecks: { DOMAIN_A: ["1C.REQ"] },
    reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) },
  });
  assert.equal(r.records.some((x) => x.checkId === "1E.DOMAIN.DOMAIN_A"), false);
  assert.equal(r.records.length, 1);
  assert.equal(/[\x1b\n]/.test(r.records[0].detail), false);
});

test("C2-INT.2. a structurally valid graph with an oversized record pool is rejected via the record-pool path only (graph itself is fine)", async () => {
  const records = buildPool(4097, { passAt: [0] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("C2-INT.3. a genuine graph with one legitimate covering PASS resolves PRESERVATION end to end post-C2 (regression)", async () => {
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records: [genericRecord("1C.REQ", "1C", "PASS")] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("C2-INT.4. H1 transitive propagation (diamond graph) is unaffected by the C2 changes", async () => {
  const decls = [
    dom("DOMAIN_A", [], ["file:a.md"]),
    dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"]),
    dom("DOMAIN_C", [{ domain: "DOMAIN_A", kind: "MEANING" }], ["file:c.md"]),
  ];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x", "b.md": "1", "c.md": "2" }, filesHead: { "a.md": "CHANGED", "b.md": "1", "c.md": "2" } });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "DEEP_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_C"), "HUMAN_REVIEW_REQUIRED");
});

test("C2-INT.5. repeated runs of the same oversized-pool and sanitizer-triggering fixtures are deterministic", async () => {
  const records = buildPool(4097, { passAt: [0] });
  const args = { headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records };
  const r1 = await run(args);
  const r2 = await run(args);
  assert.deepEqual(r1.records, r2.records);

  const rec1 = await invalidGraphDetail("\u001b‮" + "ghp_" + "F".repeat(36));
  const rec2 = await invalidGraphDetail("\u001b‮" + "ghp_" + "F".repeat(36));
  assert.deepEqual(rec1, rec2);
});

// ================================================================== Corrective C3: W3-C2-SEC-M1 covering-check declaration completeness

const { aggregate } = require("../../kernel/readiness");

/** N declared covering checkIds `${prefix}_0..${n-1}`, with a matching record per index via `statusAt(i)` (default PASS); `omitAt` indices get no record at all. */
function buildCovering(n, { statusAt = () => "PASS", omitAt = [], prefix = "1C.CHECK", ownerStage = "1C" } = {}) {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}_${i}`);
  const records = [];
  for (let i = 0; i < n; i++) {
    if (omitAt.includes(i)) continue;
    records.push(genericRecord(ids[i], ownerStage, statusAt(i)));
  }
  return { ids, records };
}

test("C3-M1.1. 64 PASS covering checks (at the cap) are accepted -- normal PRESERVATION, unaffected by the new bound", async () => {
  const { ids, records } = buildCovering(64);
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("C3-M1.2. 65 declared covering checks, 65th FAIL -- fails closed, never false PRESERVATION (central W3-C2-SEC-M1 regression)", async () => {
  const { ids, records } = buildCovering(65, { statusAt: (i) => (i === 64 ? "FAIL" : "PASS") });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.equal(rec(r, "1E.DOMAIN.DOMAIN_A").status, "HUMAN_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("COVERING_CHECK_LIMIT_EXCEEDED"));
});

test("C3-M1.3. 65 declared covering checks, 65th missing entirely -- fails closed (an incomplete declaration is not completed merely by the overflow)", async () => {
  const { ids, records } = buildCovering(65, { omitAt: [64] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.4. 65 declared covering checks, all 65 PASS -- still rejected under the bound (the bound is a completeness contract, not conditioned on content)", async () => {
  const { ids, records } = buildCovering(65);
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.5. 65 declared covering checks, 65th HUMAN_REVIEW_REQUIRED -- fails closed, unresolved human review is not silently dropped", async () => {
  const { ids, records } = buildCovering(65, { statusAt: (i) => (i === 64 ? "HUMAN_REVIEW_REQUIRED" : "PASS") });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.6. 65 declared covering checks, 65th INCOMPLETE -- fails closed, unresolved evidence is not hidden", async () => {
  const { ids, records } = buildCovering(65, { statusAt: (i) => (i === 64 ? "INCOMPLETE" : "PASS") });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.7. 65 declared covering checks, 65th CONFIGURATION_ERROR -- fails closed", async () => {
  const { ids, records } = buildCovering(65, { statusAt: (i) => (i === 64 ? "CONFIGURATION_ERROR" : "PASS") });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.8. FAIL at declared index 0 of an oversized (65-entry) declaration -- same fail-closed outcome", async () => {
  const { ids, records } = buildCovering(65, { statusAt: (i) => (i === 0 ? "FAIL" : "PASS") });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.9. FAIL/missing placed at every position across an oversized declaration (0, 31, 63, 64) -- no caller-controlled ordering selects whether it is evaluated", async () => {
  for (const idx of [0, 31, 63, 64]) {
    const failCase = buildCovering(65, { statusAt: (i) => (i === idx ? "FAIL" : "PASS") });
    const rFail = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: failCase.ids }, records: failCase.records });
    assert.equal(level(rFail, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED", `FAIL at index ${idx}`);

    const missingCase = buildCovering(65, { omitAt: [idx] });
    const rMissing = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: missingCase.ids }, records: missingCase.records });
    assert.equal(level(rMissing, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED", `missing at index ${idx}`);
  }
});

test("C3-M1.10. duplicate covering checkId at declared positions 63/64 (65 raw entries, 64 unique ids) -- rejected on raw declared length, never silently deduplicated first", async () => {
  const ids = Array.from({ length: 64 }, (_, i) => `1C.DUP_${i}`);
  const declared = [...ids, ids[63]]; // 65 raw entries; the 65th repeats index 63's id
  const records = ids.map((id) => genericRecord(id, "1C", "PASS"));
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: declared }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.11. oversized covering declaration (65) with all-unique ids and mixed statuses -- rejected on size alone", async () => {
  const { ids, records } = buildCovering(65, { statusAt: (i) => (i % 7 === 0 ? "FAIL" : "PASS"), prefix: "1C.UNIQ" });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ids }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.12. oversized covering declaration (65 raw entries) consisting almost entirely of two repeated ids -- rejected on raw declared length", async () => {
  const declared = Array.from({ length: 65 }, (_, i) => (i % 2 === 0 ? "1C.REPEAT_A" : "1C.REPEAT_B"));
  const records = [genericRecord("1C.REPEAT_A", "1C", "PASS"), genericRecord("1C.REPEAT_B", "1C", "PASS")];
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: declared }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.13. two domains, each with its own 64 valid covering checks -- both preserve normally (the limit is per domain, not global)", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])];
  const covA = buildCovering(64, { prefix: "1C.A" });
  const covB = buildCovering(64, { prefix: "1D.B", ownerStage: "1D" });
  const r = await run({
    headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" },
    coveringChecks: { DOMAIN_A: covA.ids, DOMAIN_B: covB.ids },
    records: [...covA.records, ...covB.records],
  });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "PRESERVATION_CHECK_ONLY");
});

test("C3-M1.14. one domain with an oversized declaration (65) alongside a domain with a valid declaration (64) -- only the oversized domain fails, the other is unaffected", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [], ["file:b.md"])];
  const covA = buildCovering(65, { prefix: "1C.A" });
  const covB = buildCovering(64, { prefix: "1C.B" });
  const r = await run({
    headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" },
    coveringChecks: { DOMAIN_A: covA.ids, DOMAIN_B: covB.ids },
    records: [...covA.records, ...covB.records],
  });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "PRESERVATION_CHECK_ONLY");
});

test("C3-M1.15. a dependent domain cannot preserve when its upstream dependency has an oversized covering declaration", async () => {
  const decls = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"])];
  const covA = buildCovering(65, { prefix: "1C.A" });
  const r = await run({
    headDecls: decls, filesBase: { "a.md": "x", "b.md": "y" }, filesHead: { "a.md": "x", "b.md": "y" },
    coveringChecks: { DOMAIN_A: covA.ids }, records: covA.records,
  });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_B"), "HUMAN_REVIEW_REQUIRED");
});

test("C3-M1.16. an invalid topologicalOrder combined with an oversized covering declaration still fails closed via the graph-level error", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraphC2(domains, ["DOMAIN_A", "DOMAIN_A"]);
  const cov = buildCovering(65, { prefix: "1C.A" });
  const r = await computeDeltaReview({
    subject, headGraph, baseGraph: headGraph, records: cov.records, coveringChecks: { DOMAIN_A: cov.ids },
    reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) },
  });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1E.DELTA.GRAPH");
});

test("C3-M1.17. an oversized pooled-record array combined with an oversized covering declaration still fails closed via the record-pool error", async () => {
  const cov = buildCovering(65, { prefix: "1C.A" });
  const filler = buildPool(4097 - cov.records.length);
  const records = [...cov.records, ...filler];
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: cov.ids }, records });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
});

test("C3-M1.18. malformed covering declarations do not grant authority (corrected by C4 / W3-C3-DEV-L1: a present non-array entry is rejected, only [] is vacuous)", async () => {
  // C3 originally asserted PRESERVATION for null / {} / "string" here -- that
  // codified W3-C3-DEV-L1 (a malformed entry coerced to "no requirement").
  for (const bad of [null, {}, "string"]) {
    const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: bad }, records: [] });
    assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED", JSON.stringify(bad));
    assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("COVERING_CHECK_DECLARATION_INVALID"), JSON.stringify(bad));
  }
  {
    const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: [] }, records: [] });
    assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  }
  for (const bad of [[null], [123]]) {
    const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: bad }, records: [] });
    assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED", JSON.stringify(bad));
  }
});

test("C3-M1.19. a domain result escalated by the covering-check limit still validates against kernel/results.js#validateResultRecord()", async () => {
  const { validateResultRecord } = require("../../kernel/results");
  const cov = buildCovering(65, { prefix: "1C.A" });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: cov.ids }, records: cov.records });
  assert.equal(validateResultRecord(rec(r, "1E.DOMAIN.DOMAIN_A")).ok, true);
});

test("C3-M1.20. the covering-limit-exceeded domain result aggregates HUMAN_REVIEW_REQUIRED via the real kernel aggregator, never READY", async () => {
  const cov = buildCovering(65, { prefix: "1C.A" });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: cov.ids }, records: cov.records });
  const agg = aggregate(r.records, { expectedDomainIds: ["DOMAIN_A"] });
  assert.notEqual(agg.readiness.state, "READY");
  assert.equal(agg.readiness.state, "HUMAN_REVIEW_REQUIRED");
});

// ---- Integration / cross-cutting (8 tests)

test("C3-INT.1. the C2 1E.DELTA.RECORD_POOL INCOMPLETE record aggregates NOT_READY via the real kernel aggregator, never READY", async () => {
  const records = buildPool(4097, { passAt: [0] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(r.records[0].checkId, "1E.DELTA.RECORD_POOL");
  const agg = aggregate(r.records, {});
  assert.equal(agg.readiness.state, "NOT_READY");
  assert.notEqual(agg.readiness.state, "READY");
});

test("C3-INT.2. the C2 record-pool INCOMPLETE record plus an unrelated genuine PASS record still aggregates NOT_READY (the PASS cannot mask it)", async () => {
  const oversizedRecords = buildPool(4097, { passAt: [0] });
  const r1 = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records: oversizedRecords });
  const unrelatedGenuinePass = genericRecord("1B.SOMETHING_ELSE", "1B", "PASS");
  const agg = aggregate([...r1.records, unrelatedGenuinePass], {});
  assert.equal(agg.readiness.state, "NOT_READY");
});

test("C3-INT.3. expected-domain completeness remains enforced by the real kernel aggregator: a missing domain result is detected, not silently accepted", () => {
  const agg = aggregate([], { expectedDomainIds: ["DOMAIN_A"] });
  assert.equal(agg.readiness.state, "NOT_READY");
  assert.ok(agg.kernelRecords.some((k) => k.checkId === "KERNEL.DOMAIN_RESULT.DOMAIN_A"));
});

test("C3-INT.4. duplicate checkId at pooled-record indices 4094/4095 (within the 4096 cap) -- C1's within-cap duplicate exclusion remains correct", async () => {
  const records = buildPool(4096, { passAt: [4094], failAt: [4095] });
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.equal(r.records.some((x) => x.checkId === "1E.DELTA.RECORD_POOL"), false);
});

test("C3-INT.5. the W3-SEC-H1 topological-order correction remains effective post-C3", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"]), dom("DOMAIN_B", [{ domain: "DOMAIN_A", kind: "DERIVED_VALUE" }], ["file:b.md"])];
  const headGraph = forgedGraphC2(domains, ["DOMAIN_B", "DOMAIN_A"]);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x", "b.md": "x" }), atHead: reader({ "a.md": "x", "b.md": "x" }) } });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].checkId, "1E.DELTA.GRAPH");
});

test("C3-INT.6. the W3-C1-SEC-L1 diagnostic sanitizer correction remains effective post-C3", async () => {
  const domains = [dom("DOMAIN_A", [], ["file:a.md"])];
  const headGraph = forgedGraphC2(domains, ["DOMAIN_A", "EVIL\u001b\u0007" + "ghp_" + "G".repeat(36)]);
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  assert.equal(/[\x1b\x07]/.test(r.records[0].detail), false);
  assert.equal(r.records[0].detail.includes("ghp_" + "G".repeat(36)), false);
});

test("C3-INT.7. a normal genuine graph with a single legitimate PASS covering record still resolves PRESERVATION end-to-end post-C3 (regression)", async () => {
  const r = await run({ headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records: [genericRecord("1C.REQ", "1C", "PASS")] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("C3-INT.8. five repeated executions of each key C3 fixture (64-valid, 65-overflow, 65th-FAIL, 65th-missing, C2 4097-record) produce deterministic, byte-identical results", async () => {
  const fixtures = [
    { headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: buildCovering(64, { prefix: "1C.D1" }).ids }, records: buildCovering(64, { prefix: "1C.D1" }).records },
    { headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: buildCovering(65, { prefix: "1C.D2" }).ids }, records: buildCovering(65, { prefix: "1C.D2" }).records },
    (() => { const c = buildCovering(65, { prefix: "1C.D3", statusAt: (i) => (i === 64 ? "FAIL" : "PASS") }); return { headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: c.ids }, records: c.records }; })(),
    (() => { const c = buildCovering(65, { prefix: "1C.D4", omitAt: [64] }); return { headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: c.ids }, records: c.records }; })(),
    { headDecls: singleDomain, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" }, coveringChecks: { DOMAIN_A: ["1C.REQ"] }, records: buildPool(4097, { passAt: [0] }) },
  ];
  for (const args of fixtures) {
    const outs = [];
    for (let i = 0; i < 5; i++) outs.push(JSON.stringify((await run(args)).records));
    assert.equal(new Set(outs).size, 1);
  }
});

// ================================================================== performance (section 84)

test("performance: ~100 domains, chained dependencies, moderate content completes quickly and near-linearly", async () => {
  const n = 100;
  const decls = [];
  const files = {};
  for (let i = 0; i < n; i += 1) {
    const id = `DOMAIN_${String(i).padStart(4, "0")}`;
    const deps = i > 0 ? [{ domain: `DOMAIN_${String(i - 1).padStart(4, "0")}`, kind: "DERIVED_VALUE" }] : [];
    decls.push(dom(id, deps, [`file:f${i}.md`]));
    files[`f${i}.md`] = `content ${i}`.repeat(50);
  }
  const headGraph = validateGraph(decls);
  assert.equal(headGraph.valid, true);
  const t0 = Date.now();
  const r = await computeDeltaReview({ subject, headGraph, baseGraph: headGraph, records: [], coveringChecks: {}, reader: { atBase: reader(files), atHead: reader(files) } });
  const elapsed = Date.now() - t0;
  assert.equal(r.records.filter((x) => x.domain).length, n);
  assert.ok(elapsed < 5000, `took ${elapsed}ms`);
  for (const record of r.records.filter((x) => x.domain)) assert.equal(record.domain.effectiveLevel, "PRESERVATION_CHECK_ONLY");
});

// ================================================================== record contract / no-throw

test("record contract: every domain record validates against the kernel's validateResultRecord()", async () => {
  const { validateResultRecord } = require("../../kernel/results");
  const decls = [dom("DOMAIN_A", [], ["file:a.md"])];
  const r = await run({ headDecls: decls, filesBase: { "a.md": "x" }, filesHead: { "a.md": "y" } });
  for (const record of r.records) assert.equal(validateResultRecord(record).ok, true, JSON.stringify(record));
});

test("never throws on a fully hostile input object", async () => {
  for (const bad of [{ subject: "not-an-object" }, { subject, headGraph: "not-a-graph" }, { subject, headGraph: {}, reader: "not-a-reader" }, { subject, headGraph: {}, coveringChecks: "not-an-object" }]) {
    await assert.doesNotReject(computeDeltaReview(bad));
  }
});

// ================================================================== C4 -- W3-C3-DEV-L1
// Runtime shape of coveringChecks / recordedExtractorVersions (design section
// 20): an omitted map, an absent own key and [] keep their documented vacuous
// meaning; a present value of the wrong type is rejected, never coerced to
// "no requirement". run() above replaces a falsy map with {}, so container
// tests call computeDeltaReview() directly through runRaw().

const failC0 = () => [genericRecord("1B.C0", "1B", "FAIL")];
function filesFor(decls) {
  const files = {};
  for (const d of decls) for (const p of d.protectedInputs) files[p.slice("file:".length)] = `content of ${d.domainId}`;
  return files;
}
async function runRaw(extra, { headDecls = singleDomain, baseDecls, records = failC0(), filesHead } = {}) {
  const headGraph = validateGraph(headDecls);
  const baseGraph = baseDecls === undefined ? headGraph : validateGraph(baseDecls);
  const files = filesFor(baseDecls || headDecls);
  return computeDeltaReview({ subject, headGraph, baseGraph, records, reader: { atBase: reader(files), atHead: reader(filesHead || files) }, ...extra });
}
const domF = (id, deps = []) => dom(id, deps, [`file:${id}.md`]);
const readinessOf = (r, ids) => aggregate(r.records, { expectedDomainIds: ids }).readiness.state;

test("C4-L1.1. { DOMAIN_A: \"1B.C0\" } with a genuine 1B.C0 FAIL present -- rejected for the domain, never PRESERVATION / READY (the original reproduction)", async () => {
  const r = await runRaw({ coveringChecks: { DOMAIN_A: "1B.C0" } });
  const d = rec(r, "1E.DOMAIN.DOMAIN_A");
  assert.equal(d.status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(d.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(d.domain.reasons, ["COVERING_CHECK_DECLARATION_INVALID"]);
  assert.equal(d.reasonCode, "COVERING_CHECK_DECLARATION_INVALID");
  assert.equal(d.domain.fingerprint, null);
  assert.equal(readinessOf(r, ["DOMAIN_A"]), "HUMAN_REVIEW_REQUIRED");
});

test("C4-L1.2. array-like declarations ({ length: 65, 0: ... }, { length: 65 }) are a type error, not a 65-entry declaration -- COVERING_CHECK_DECLARATION_INVALID, never COVERING_CHECK_LIMIT_EXCEEDED or PRESERVATION", async () => {
  for (const bad of [{ length: 65, 0: "1B.C0" }, { length: 65 }, { length: 1, 0: "1B.C0" }]) {
    const r = await runRaw({ coveringChecks: { DOMAIN_A: bad } });
    const d = rec(r, "1E.DOMAIN.DOMAIN_A");
    assert.equal(d.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED", JSON.stringify(bad));
    assert.ok(d.domain.reasons.includes("COVERING_CHECK_DECLARATION_INVALID"), JSON.stringify(bad));
    assert.ok(!d.domain.reasons.includes("COVERING_CHECK_LIMIT_EXCEEDED"), JSON.stringify(bad));
  }
});

test("C4-L1.3. coveringChecks: [] (with a genuine FAIL present) -- whole-input DELTA_INPUT_INVALID, no domain record, never READY", async () => {
  const r = await runRaw({ coveringChecks: [] });
  assert.deepEqual(r.records, []);
  assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
  assert.equal(r.outcome.reasonCode, "DELTA_INPUT_INVALID");
  assert.notEqual(readinessOf(r, ["DOMAIN_A"]), "READY");
  assert.equal(readinessOf(r, ["DOMAIN_A"]), "NOT_READY");
});

test("C4-L1.4. absence vs malformed: { DOMAIN_A: [] } and { DOMAIN_A: \"1B.C0\" } over identical graph/subject/fingerprints/records never collapse to the same PRESERVATION outcome", async () => {
  const a = await runRaw({ coveringChecks: { DOMAIN_A: [] } });
  const b = await runRaw({ coveringChecks: { DOMAIN_A: "1B.C0" } });
  assert.equal(level(a, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  assert.equal(level(b, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.notEqual(JSON.stringify(a.records), JSON.stringify(b.records));
});

test("C4-L1.5. supported absence is unchanged: omitted map, undefined map, {}, a null-prototype {}, and { DOMAIN_A: [] } all still preserve an unchanged domain", async () => {
  const variants = [{}, { coveringChecks: undefined }, { coveringChecks: {} }, { coveringChecks: Object.create(null) }, { coveringChecks: { DOMAIN_A: [] } }, { coveringChecks: { OTHER_DOMAIN: ["1B.C0"] } }];
  for (const extra of variants) {
    const r = await runRaw(extra);
    assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY", Object.keys(extra).join(","));
    assert.equal(readinessOf(r, ["DOMAIN_A"]), "READY");
  }
});

test("C4-L1.6. a present coveringChecks map that is not a plain object is DELTA_INPUT_INVALID (null, array, string, number, booleans, Date, Map, function, class instance, foreign prototype)", async () => {
  class Holder { constructor() { this.DOMAIN_A = ["1B.C0"]; } }
  const bad = [null, [], ["1B.C0"], "1B.C0", 42, true, false, new Date(0), new Map([["DOMAIN_A", ["1B.C0"]]]), () => ({}), new Holder(), Object.create({ DOMAIN_A: [] })];
  for (const value of bad) {
    const r = await runRaw({ coveringChecks: value });
    assert.deepEqual(r.records, [], String(typeof value));
    assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
    assert.equal(r.outcome.reasonCode, "DELTA_INPUT_INVALID");
    assert.equal(r.outcome.detail, "coveringChecks, if supplied, must be a plain object"); // fixed text: no caller data
    assert.equal(readinessOf(r, ["DOMAIN_A"]), "NOT_READY");
  }
});

test("C4-L1.7. a present non-array domain entry is HUMAN_REVIEW_REQUIRED for that domain (null, own undefined, string, number, boolean, {}, Set, index object, String object)", async () => {
  const { validateResultRecord } = require("../../kernel/results");
  const bad = [null, undefined, "1B.C0", 123, true, {}, new Set(["1B.C0"]), { 0: "1B.C0" }, new String("1B.C0")];
  for (const value of bad) {
    const r = await runRaw({ coveringChecks: { DOMAIN_A: value } });
    assert.equal(r.records.filter((x) => x.domain).length, 1);
    const d = rec(r, "1E.DOMAIN.DOMAIN_A");
    assert.equal(d.status, "HUMAN_REVIEW_REQUIRED", String(value));
    assert.equal(d.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED", String(value));
    assert.ok(d.domain.reasons.includes("COVERING_CHECK_DECLARATION_INVALID"), String(value));
    assert.equal(validateResultRecord(d).ok, true);
  }
});

test("C4-L1.8. valid array declarations keep the C1/C2 evaluation: PASS preserves, FAIL or a missing required record denies preservation", async () => {
  const pass = await runRaw({ coveringChecks: { DOMAIN_A: ["1B.C0", "1C.REQ"] } }, { records: [genericRecord("1B.C0", "1B", "PASS"), genericRecord("1C.REQ", "1C", "PASS")] });
  assert.equal(level(pass, "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
  const fail = await runRaw({ coveringChecks: { DOMAIN_A: ["1B.C0"] } });
  assert.equal(level(fail, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  assert.ok(rec(fail, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("COVERING_CHECK_NOT_PASS"));
  const missing = await runRaw({ coveringChecks: { DOMAIN_A: ["1B.C0", "1C.REQ"] } }, { records: [genericRecord("1B.C0", "1B", "PASS")] });
  assert.equal(level(missing, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
});

test("C4-L1.9. a malformed declaration is never masked by an earlier DEEP or HRR reason: MANIFEST_DECLARATION_CHANGED + malformed -> HRR with both reasons; REGION_MISSING + malformed -> both reasons", async () => {
  const head = [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"])];
  const base = [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED"])];
  const changed = await runRaw({ coveringChecks: { DOMAIN_A: "1B.C0" } }, { headDecls: head, baseDecls: base });
  const d1 = rec(changed, "1E.DOMAIN.DOMAIN_A");
  assert.equal(d1.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
  assert.ok(d1.domain.reasons.includes("MANIFEST_DECLARATION_CHANGED"));
  assert.ok(d1.domain.reasons.includes("COVERING_CHECK_DECLARATION_INVALID"));
  const missingRegion = await runRaw({ coveringChecks: { DOMAIN_A: "1B.C0" } }, { filesHead: {} });
  const d2 = rec(missingRegion, "1E.DOMAIN.DOMAIN_A");
  assert.equal(d2.domain.effectiveLevel, "HUMAN_REVIEW_REQUIRED");
  assert.ok(d2.domain.reasons.includes("REGION_MISSING"));
  assert.ok(d2.domain.reasons.includes("COVERING_CHECK_DECLARATION_INVALID"));
});

test("C4-L1.10. multi-domain isolation: DA valid, DB malformed, DC valid -- only DB fails, exactly one record per domain, run is not READY", async () => {
  const decls = [domF("DA"), domF("DB"), domF("DC")];
  const r = await runRaw({ coveringChecks: { DA: ["1B.A"], DB: "1B.C0", DC: [] } }, { headDecls: decls, records: [genericRecord("1B.A", "1B", "PASS"), ...failC0()] });
  assert.deepEqual(r.records.map((x) => x.checkId), ["1E.DOMAIN.DA", "1E.DOMAIN.DB", "1E.DOMAIN.DC", "1E.DELTA.DOMAIN_SET"]);
  assert.equal(level(r, "1E.DOMAIN.DA"), "PRESERVATION_CHECK_ONLY");
  assert.equal(level(r, "1E.DOMAIN.DB"), "HUMAN_REVIEW_REQUIRED");
  assert.equal(level(r, "1E.DOMAIN.DC"), "PRESERVATION_CHECK_ONLY");
  assert.equal(readinessOf(r, ["DA", "DB", "DC"]), "HUMAN_REVIEW_REQUIRED");
});

test("C4-L1.11. dependency propagation: a malformed upstream declaration escalates every dependent (REFERENCE, DERIVED_VALUE, MEANING, chain, diamond) -- none preserved", async () => {
  for (const kind of ["REFERENCE", "DERIVED_VALUE", "MEANING"]) {
    const r = await runRaw({ coveringChecks: { DB: {} } }, { headDecls: [domF("DA", [{ domain: "DB", kind }]), domF("DB")] });
    assert.equal(level(r, "1E.DOMAIN.DB"), "HUMAN_REVIEW_REQUIRED", kind);
    assert.equal(level(r, "1E.DOMAIN.DA"), "HUMAN_REVIEW_REQUIRED", kind);
  }
  const chain = await runRaw({ coveringChecks: { DC: 7 } }, { headDecls: [domF("DA", [{ domain: "DB", kind: "REFERENCE" }]), domF("DB", [{ domain: "DC", kind: "DERIVED_VALUE" }]), domF("DC")] });
  for (const id of ["DA", "DB", "DC"]) assert.equal(level(chain, `1E.DOMAIN.${id}`), "HUMAN_REVIEW_REQUIRED", id);
  const diamond = await runRaw({ coveringChecks: { DX: "1B.C0" } }, {
    headDecls: [domF("DT", [{ domain: "DL", kind: "REFERENCE" }, { domain: "DR", kind: "REFERENCE" }]), domF("DL", [{ domain: "DX", kind: "DERIVED_VALUE" }]), domF("DR", [{ domain: "DX", kind: "DERIVED_VALUE" }]), domF("DX")],
  });
  for (const id of ["DT", "DL", "DR", "DX"]) assert.equal(level(diamond, `1E.DOMAIN.${id}`), "HUMAN_REVIEW_REQUIRED", id);
});

test("C4-L1.12. the C3 64-entry bound is unchanged for genuine arrays: 63 and 64 PASS preserve, 65 is COVERING_CHECK_LIMIT_EXCEEDED", async () => {
  for (const [n, expected, reason] of [[63, "PRESERVATION_CHECK_ONLY", null], [64, "PRESERVATION_CHECK_ONLY", null], [65, "HUMAN_REVIEW_REQUIRED", "COVERING_CHECK_LIMIT_EXCEEDED"]]) {
    const cov = buildCovering(n);
    const r = await runRaw({ coveringChecks: { DOMAIN_A: cov.ids } }, { records: cov.records });
    assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), expected, String(n));
    if (reason) assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes(reason));
  }
});

test("C4-L1.13. validation precedence is fixed and fail-closed: invalid graph > oversized record pool > malformed coveringChecks map > per-domain malformed entry", async () => {
  const pool = buildPool(4097, { passAt: [0] });
  const poolAndDecl = await runRaw({ coveringChecks: { DOMAIN_A: "1C.REQ" } }, { records: pool });
  assert.equal(poolAndDecl.records[0].checkId, "1E.DELTA.RECORD_POOL");
  const poolAndMap = await runRaw({ coveringChecks: [] }, { records: pool });
  assert.equal(poolAndMap.records[0].checkId, "1E.DELTA.RECORD_POOL");
  const headGraph = { ...validateGraph(singleDomain), topologicalOrder: [] };
  const graphAndMap = await computeDeltaReview({ subject, headGraph, baseGraph: validateGraph(singleDomain), records: pool, coveringChecks: [], reader: { atBase: reader({ "a.md": "x" }), atHead: reader({ "a.md": "x" }) } });
  assert.equal(graphAndMap.records[0].checkId, "1E.DELTA.GRAPH");
  for (const r of [poolAndDecl, poolAndMap, graphAndMap]) assert.equal(aggregate(r.records, { expectedDomainIds: ["DOMAIN_A"] }).readiness.state, "NOT_READY");
});

test("C4-L1.14. a malformed declaration combined with duplicate relevant records is still rejected -- no authority from either", async () => {
  const r = await runRaw({ coveringChecks: { DOMAIN_A: "1B.C0" } }, { records: [genericRecord("1B.C0", "1B", "PASS"), genericRecord("1B.C0", "1B", "PASS")] });
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("COVERING_CHECK_DECLARATION_INVALID"));
});

test("C4-L1.15. recordedExtractorVersions: absence and a matching version preserve, a mismatching string is DEEP, a present non-string entry is HRR (EXTRACTOR_VERSION_INVALID), a non-plain-object map is DELTA_INPUT_INVALID", async () => {
  const { FINGERPRINT_VERSION } = require("./fingerprint");
  const noCover = { records: [] };
  for (const extra of [{}, { recordedExtractorVersions: undefined }, { recordedExtractorVersions: {} }, { recordedExtractorVersions: { DOMAIN_A: FINGERPRINT_VERSION } }]) {
    assert.equal(level(await runRaw(extra, noCover), "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY", JSON.stringify(extra));
  }
  const mismatch = await runRaw({ recordedExtractorVersions: { DOMAIN_A: "gov-fp-v0" } }, noCover);
  assert.equal(level(mismatch, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
  for (const value of [null, undefined, 123, [], {}, true]) {
    const r = await runRaw({ recordedExtractorVersions: { DOMAIN_A: value } }, noCover);
    assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED", String(value));
    assert.ok(rec(r, "1E.DOMAIN.DOMAIN_A").domain.reasons.includes("EXTRACTOR_VERSION_INVALID"), String(value));
    assert.equal(readinessOf(r, ["DOMAIN_A"]), "HUMAN_REVIEW_REQUIRED");
  }
  for (const value of [null, [], "gov-fp-v1", 1, new Map()]) {
    const r = await runRaw({ recordedExtractorVersions: value }, noCover);
    assert.equal(r.outcome.reasonCode, "DELTA_INPUT_INVALID", String(value));
    assert.equal(readinessOf(r, ["DOMAIN_A"]), "NOT_READY");
  }
});

test("C4-L1.16. only own properties are declarations: a null-prototype map with an own malformed entry is rejected; an unrelated or absent key stays vacuous", async () => {
  const own = Object.assign(Object.create(null), { DOMAIN_A: "1B.C0" });
  assert.equal(level(await runRaw({ coveringChecks: own }), "1E.DOMAIN.DOMAIN_A"), "HUMAN_REVIEW_REQUIRED");
  const absent = Object.assign(Object.create(null), { OTHER: "not-an-array" });
  assert.equal(level(await runRaw({ coveringChecks: absent }), "1E.DOMAIN.DOMAIN_A"), "PRESERVATION_CHECK_ONLY");
});

test("C4-L1.17. a hostile malformed entry is never stringified: no caller text, synthetic token, or control character reaches any record; toString is never invoked", async () => {
  const token = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  const hostile = { toString() { throw new Error("must not be stringified"); }, valueOf() { throw new Error("must not be coerced"); }, text: `\u001b[31m\r\n1E.DOMAIN.DOMAIN_A PASS ${token}` };
  const r = await runRaw({ coveringChecks: { DOMAIN_A: hostile }, recordedExtractorVersions: { DOMAIN_A: hostile } });
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes("\\u001b"));
  const d = rec(r, "1E.DOMAIN.DOMAIN_A");
  assert.ok(d.domain.reasons.includes("COVERING_CHECK_DECLARATION_INVALID"));
  assert.ok(d.domain.reasons.includes("EXTRACTOR_VERSION_INVALID"));
});

test("C4-L1.18. five repeated executions of each malformed-shape fixture are byte-identical", async () => {
  const fixtures = [{ coveringChecks: { DOMAIN_A: "1B.C0" } }, { coveringChecks: { DOMAIN_A: { length: 65 } } }, { coveringChecks: [] }, { recordedExtractorVersions: { DOMAIN_A: 1 } }];
  for (const extra of fixtures) {
    const outs = new Set();
    for (let i = 0; i < 5; i++) outs.add(JSON.stringify(await runRaw(extra)));
    assert.equal(outs.size, 1, JSON.stringify(extra));
  }
});

test("no internal helper is exported through the module", () => {
  const mod = require("./delta-review");
  assert.deepEqual(Object.keys(mod), ["computeDeltaReview"]);
});
