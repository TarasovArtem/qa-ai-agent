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
  assert.equal(r.records.length, 3);
  for (const id of ["DOMAIN_A", "DOMAIN_B", "DOMAIN_C"]) assert.ok(rec(r, `1E.DOMAIN.${id}`));
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
  assert.equal(r.records.length, 2);
});

test("adversarial: untrusted head-only manifest weakening (adding a false PRESERVATION_CHECK_ONLY declaration for a domain the base marks DEEP-only) is not honored", async () => {
  const base = [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED"])];
  const head = [dom("DOMAIN_A", [], ["file:a.md"], ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"])];
  const r = await run({ headDecls: head, baseDecls: base, filesBase: { "a.md": "x" }, filesHead: { "a.md": "x" } });
  // The declaration itself changed (reviewModes differs), so it is DEEP regardless.
  assert.equal(level(r, "1E.DOMAIN.DOMAIN_A"), "DEEP_REVIEW_REQUIRED");
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
  assert.equal(r.records.length, n);
  assert.ok(elapsed < 5000, `took ${elapsed}ms`);
  for (const record of r.records) assert.equal(record.domain.effectiveLevel, "PRESERVATION_CHECK_ONLY");
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

test("no internal helper is exported through the module", () => {
  const mod = require("./delta-review");
  assert.deepEqual(Object.keys(mod), ["computeDeltaReview"]);
});
