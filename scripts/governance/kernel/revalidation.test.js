"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { revalidateEvidence } = require("./revalidation");
const { validateResultRecord } = require("./results");
const { makeSubject } = require("../test-support-git");

const subject = makeSubject();
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

const entry = (overrides = {}) => ({
  sourceObjectId: "issue-comment:123", sourceVersion: "v1", contentDigest: DIGEST_A,
  collectedAt: "2026-09-28T00:00:00Z", immutability: "MUTABLE", ...overrides,
});
const item = (entryOverrides = {}, sourceType = "CI_RUN") => ({ entry: entry(entryOverrides), sourceType });

function okAdapter(version, digest) {
  return { fetch: async () => ({ ok: true, version, digest }) };
}
function unreachableAdapter() {
  return { fetch: async () => ({ ok: false }) };
}
function throwingAdapter() {
  return { fetch: async () => { throw new Error("boom"); } };
}
function malformedAdapter() {
  return { fetch: async () => ({ ok: true, version: 123, digest: null }) };
}
function neverCalledAdapter() {
  return { fetch: async () => { throw new Error("must not be called for a VERIFIED_* item"); } };
}

test("unchanged MUTABLE evidence, matching version and digest -> PASS", async () => {
  const r = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
  assert.equal(r.records[0].status, "PASS");
  assert.equal(r.records[0].reasonCode, "OK");
});

test("changed digest -> INCOMPLETE / STALE_EVIDENCE", async () => {
  const r = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: okAdapter("v1", DIGEST_B) } });
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].reasonCode, "STALE_EVIDENCE");
});

test("changed version -> INCOMPLETE / STALE_EVIDENCE", async () => {
  const r = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: okAdapter("v2", DIGEST_A) } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("deleted/unreachable evidence -> STALE, never PASS", async () => {
  const r = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: unreachableAdapter() } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("adapter throws -> STALE, never an uncaught exception", async () => {
  await assert.doesNotReject(revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: throwingAdapter() } }));
  const r = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: throwingAdapter() } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("malformed adapter response (non-string version/digest) -> STALE, never coerced to a match", async () => {
  const r = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: malformedAdapter() } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("no adapter registered for the item's sourceType -> STALE, never silently skipped", async () => {
  const r = await revalidateEvidence({ subject, items: [item()], adapters: {} });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("VERIFIED_PROVIDER and VERIFIED_CRYPTO items skip re-fetch entirely (adapter never called)", async () => {
  for (const immutability of ["VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]) {
    const r = await revalidateEvidence({ subject, items: [item({ immutability })], adapters: { CI_RUN: neverCalledAdapter() } });
    assert.equal(r.records[0].status, "PASS", immutability);
  }
});

test("an unrecognized immutability value is treated as MUTABLE (always re-fetched, never trusted by default)", async () => {
  // isValidItem() rejects an unrecognized literal outright (fail closed at the input boundary).
  const r = await revalidateEvidence({ subject, items: [item({ immutability: "SOMETHING_ELSE" })], adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
  assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
});

test("rootPolicy unchanged -> PASS", async () => {
  const rootPolicy = { rootTip: "r1", rootPolicyDigest: "d1", resolve: async () => ({ ok: true, rootTip: "r1", digest: "d1" }) };
  const r = await revalidateEvidence({ subject, items: [], adapters: {}, rootPolicy });
  assert.equal(r.records[0].status, "PASS");
});

test("rootPolicy changed -> STALE", async () => {
  const rootPolicy = { rootTip: "r1", rootPolicyDigest: "d1", resolve: async () => ({ ok: true, rootTip: "r1", digest: "d2" }) };
  const r = await revalidateEvidence({ subject, items: [], adapters: {}, rootPolicy });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("rootPolicy unresolvable -> STALE, never assumed unchanged", async () => {
  const rootPolicy = { rootTip: "r1", rootPolicyDigest: "d1", resolve: async () => ({ ok: false }) };
  const r = await revalidateEvidence({ subject, items: [], adapters: {}, rootPolicy });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("rootPolicy omitted entirely -> vacuously satisfied, not an error", async () => {
  const r = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
  assert.equal(r.records[0].status, "PASS");
});

test("no items and no rootPolicy -> PASS (vacuous, nothing external to revalidate)", async () => {
  const r = await revalidateEvidence({ subject, items: [], adapters: {} });
  assert.equal(r.records[0].status, "PASS");
});

test("one stale item among several unchanged ones -> overall STALE, all stale entries reported", async () => {
  const items = [
    item({ sourceObjectId: "a" }),
    item({ sourceObjectId: "b" }),
    { entry: entry({ sourceObjectId: "c", contentDigest: DIGEST_A }), sourceType: "DETERMINATION" },
  ];
  const adapters = {
    CI_RUN: { fetch: async (id) => ({ ok: true, version: "v1", digest: DIGEST_A }) },
    DETERMINATION: { fetch: async () => ({ ok: true, version: "v1", digest: DIGEST_B }) }, // wrong digest
  };
  const r = await revalidateEvidence({ subject, items, adapters });
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].domain, undefined);
  assert.equal(r.records[0].observed.staleItems.length, 1);
  assert.equal(r.records[0].observed.staleItems[0].sourceObjectId, "c");
});

test("duplicate external evidence entries (same sourceObjectId twice) are each independently revalidated, not deduplicated away", async () => {
  const items = [item({ sourceObjectId: "dup" }), item({ sourceObjectId: "dup", contentDigest: DIGEST_B })];
  const adapters = { CI_RUN: okAdapter("v1", DIGEST_A) };
  const r = await revalidateEvidence({ subject, items, adapters });
  assert.equal(r.records[0].status, "INCOMPLETE"); // the DIGEST_B entry will not match the adapter's DIGEST_A
});

test("oversized items array is rejected outright, never partially processed", async () => {
  const items = Array.from({ length: 300 }, (_, i) => item({ sourceObjectId: `id-${i}` }));
  const r = await revalidateEvidence({ subject, items, adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
  assert.equal(r.records.length, 0);
  assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
});

test("malformed input: invalid subject, non-array items, malformed item shape all fail closed via outcome, never PASS", async () => {
  for (const bad of [
    { subject: "not-a-subject", items: [], adapters: {} },
    { subject, items: "not-an-array", adapters: {} },
    { subject, items: [{ entry: {}, sourceType: "X" }], adapters: {} },
    { subject, items: [{ entry: entry(), sourceType: "" }], adapters: {} },
    { subject, items: [{ entry: entry({ contentDigest: "not-hex" }), sourceType: "CI_RUN" }], adapters: {} },
  ]) {
    const r = await revalidateEvidence(bad);
    assert.equal(r.records.length, 0, JSON.stringify(bad));
    assert.equal(r.outcome.status, "CONFIGURATION_ERROR", JSON.stringify(bad));
  }
});

test("never throws on a fully hostile input object", async () => {
  for (const bad of [null, undefined, 42, [], { subject: null }, { subject, items: null }]) {
    await assert.doesNotReject(revalidateEvidence(bad));
  }
});

test("the PASS and STALE records both validate against the kernel's validateResultRecord()", async () => {
  const pass = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
  assert.equal(validateResultRecord(pass.records[0]).ok, true);
  const stale = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: unreachableAdapter() } });
  assert.equal(validateResultRecord(stale.records[0]).ok, true);
});

test("the checkId, ownerStage and subject are exactly what a caller would fold into aggregate() alongside every other record", async () => {
  const r = await revalidateEvidence({ subject, items: [], adapters: {} });
  assert.equal(r.records[0].checkId, "KERNEL.REVALIDATION");
  assert.equal(r.records[0].ownerStage, "KERNEL");
  assert.deepEqual(r.records[0].subject, subject);
});

test("five repeated executions of the same fixture produce byte-identical results (no adapter-call-order nondeterminism)", async () => {
  const items = [item({ sourceObjectId: "x" }), item({ sourceObjectId: "y" })];
  const adapters = { CI_RUN: okAdapter("v1", DIGEST_A) };
  const outs = [];
  for (let i = 0; i < 5; i++) outs.push(JSON.stringify((await revalidateEvidence({ subject, items, adapters })).records));
  assert.equal(new Set(outs).size, 1);
});

test("a stale result is INCOMPLETE, never FAIL, CONFIGURATION_ERROR or HUMAN_REVIEW_REQUIRED: staleness is an unestablished fact, not a violated invariant or a judgment call", async () => {
  const r = await revalidateEvidence({ subject, items: [item()], adapters: { CI_RUN: unreachableAdapter() } });
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.notEqual(r.records[0].status, "FAIL");
  assert.notEqual(r.records[0].status, "CONFIGURATION_ERROR");
  assert.notEqual(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
});

test("no internal helper is exported through the module", () => {
  const mod = require("./revalidation");
  assert.deepEqual(Object.keys(mod), ["revalidateEvidence"]);
});
