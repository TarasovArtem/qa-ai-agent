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
function countingAdapter(version, digest) {
  const adapter = { calls: 0, fetch: async () => { adapter.calls += 1; return { ok: true, version, digest }; } };
  return adapter;
}

// Corrective C1 (1G M3 + L1): revalidation is bound to the consumed report. These
// helpers build that report from the same entries the items carry (so the items
// cover it exactly) and an unchanged governance-root resolver; individual tests
// override either to probe the binding itself.
const ROOT_TIP = "c".repeat(40);
const ROOT_DIGEST = "d".repeat(64);
const reportFor = (items, overrides = {}) => ({
  schemaVersion: 1, requiresRevalidation: true, notAuthorization: true,
  generatedFor: { head: subject.head, tree: subject.tree, base: subject.base, parents: [], branch: "" },
  trustedContext: { rootTip: ROOT_TIP, rootPolicyDigest: ROOT_DIGEST },
  externalEvidence: Array.isArray(items) ? items.map((i) => (i && i.entry) || i) : [],
  ...overrides,
});
const rootResolver = (rootTip = ROOT_TIP, digest = ROOT_DIGEST) => ({ resolve: async () => ({ ok: true, rootTip, digest }) });
const revalidate = (args) => revalidateEvidence({ subject, report: reportFor(args.items), rootPolicy: rootResolver(), ...args });

test("unchanged MUTABLE evidence, matching version and digest -> PASS", async () => {
  const r = await revalidate({ items: [item()], adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
  assert.equal(r.records[0].status, "PASS");
  assert.equal(r.records[0].reasonCode, "OK");
});

test("changed digest -> INCOMPLETE / STALE_EVIDENCE", async () => {
  const r = await revalidate({ items: [item()], adapters: { CI_RUN: okAdapter("v1", DIGEST_B) } });
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].reasonCode, "STALE_EVIDENCE");
});

test("changed version -> INCOMPLETE / STALE_EVIDENCE", async () => {
  const r = await revalidate({ items: [item()], adapters: { CI_RUN: okAdapter("v2", DIGEST_A) } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("deleted/unreachable evidence -> STALE, never PASS", async () => {
  const r = await revalidate({ items: [item()], adapters: { CI_RUN: unreachableAdapter() } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("adapter throws -> STALE, never an uncaught exception", async () => {
  await assert.doesNotReject(revalidate({ items: [item()], adapters: { CI_RUN: throwingAdapter() } }));
  const r = await revalidate({ items: [item()], adapters: { CI_RUN: throwingAdapter() } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("malformed adapter response (non-string version/digest) -> STALE, never coerced to a match", async () => {
  const r = await revalidate({ items: [item()], adapters: { CI_RUN: malformedAdapter() } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("no adapter registered for the item's sourceType -> STALE, never silently skipped", async () => {
  const r = await revalidate({ items: [item()], adapters: {} });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("Corrective C1 (1G M3): VERIFIED_PROVIDER / VERIFIED_CRYPTO labels never skip re-fetch -- a relabelled stale entry is STALE", async () => {
  for (const immutability of ["VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]) {
    const changed = countingAdapter("v2", DIGEST_B);
    const stale = await revalidate({ items: [item({ immutability })], adapters: { CI_RUN: changed } });
    assert.equal(changed.calls, 1, immutability);
    assert.equal(stale.records[0].status, "INCOMPLETE", immutability);
    const same = countingAdapter("v1", DIGEST_A);
    const fresh = await revalidate({ items: [item({ immutability })], adapters: { CI_RUN: same } });
    assert.equal(same.calls, 1, immutability);
    assert.equal(fresh.records[0].status, "PASS", immutability);
    const absent = await revalidate({ items: [item({ immutability })], adapters: {} });
    assert.equal(absent.records[0].status, "INCOMPLETE", immutability);
  }
});

test("an unrecognized immutability value is treated as MUTABLE (always re-fetched, never trusted by default)", async () => {
  // isValidItem() rejects an unrecognized literal outright (fail closed at the input boundary).
  const r = await revalidate({ items: [item({ immutability: "SOMETHING_ELSE" })], adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
  assert.equal(r.outcome.status, "CONFIGURATION_ERROR");
});

test("rootPolicy unchanged (compared with the report's own rootTip / rootPolicyDigest) -> PASS", async () => {
  const r = await revalidate({ items: [], adapters: {} });
  assert.equal(r.records[0].status, "PASS");
});

test("rootPolicy changed -> STALE", async () => {
  const r = await revalidate({ items: [], adapters: {}, rootPolicy: rootResolver(ROOT_TIP, "e".repeat(64)) });
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].observed.staleItems[0].reason, "ROOT_POLICY_CHANGED");
});

test("rootPolicy unresolvable -> STALE, never assumed unchanged", async () => {
  const r = await revalidate({ items: [], adapters: {}, rootPolicy: { resolve: async () => ({ ok: false }) } });
  assert.equal(r.records[0].status, "INCOMPLETE");
});

test("Corrective C1 (1G L1): an omitted or caller-anchored rootPolicy is malformed input, never a vacuous PASS", async () => {
  for (const rootPolicy of [undefined, null, {}, { rootTip: ROOT_TIP, rootPolicyDigest: ROOT_DIGEST, resolve: rootResolver().resolve }]) {
    const r = await revalidateEvidence({ subject, report: reportFor([item()]), items: [item()], adapters: { CI_RUN: okAdapter("v1", DIGEST_A) }, rootPolicy });
    assert.equal(r.outcome && r.outcome.status, "CONFIGURATION_ERROR", JSON.stringify(rootPolicy));
  }
});

test("Corrective C1 (1G M3): no items for a report that relied on external evidence is malformed input, never a vacuous PASS", async () => {
  const r = await revalidateEvidence({ subject, report: reportFor([item()]), items: [], adapters: {}, rootPolicy: rootResolver() });
  assert.equal(r.outcome && r.outcome.status, "CONFIGURATION_ERROR");
  const empty = await revalidate({ items: [], adapters: {} });
  assert.equal(empty.records[0].status, "PASS", "a report with no external evidence still re-checks the root policy");
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
  const r = await revalidate({ items, adapters });
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.equal(r.records[0].domain, undefined);
  assert.equal(r.records[0].observed.staleItems.length, 1);
  assert.equal(r.records[0].observed.staleItems[0].sourceObjectId, "c");
});

test("duplicate external evidence entries (same sourceObjectId twice) are each independently revalidated, not deduplicated away", async () => {
  const items = [item({ sourceObjectId: "dup" }), item({ sourceObjectId: "dup", contentDigest: DIGEST_B })];
  const adapters = { CI_RUN: okAdapter("v1", DIGEST_A) };
  const r = await revalidate({ items, adapters });
  assert.equal(r.records[0].status, "INCOMPLETE"); // the DIGEST_B entry will not match the adapter's DIGEST_A
});

test("oversized items array is rejected outright, never partially processed", async () => {
  const items = Array.from({ length: 300 }, (_, i) => item({ sourceObjectId: `id-${i}` }));
  const r = await revalidate({ items, adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
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
  const pass = await revalidate({ items: [item()], adapters: { CI_RUN: okAdapter("v1", DIGEST_A) } });
  assert.equal(validateResultRecord(pass.records[0]).ok, true);
  const stale = await revalidate({ items: [item()], adapters: { CI_RUN: unreachableAdapter() } });
  assert.equal(validateResultRecord(stale.records[0]).ok, true);
});

test("the checkId, ownerStage and subject are exactly what a caller would fold into aggregate() alongside every other record", async () => {
  const r = await revalidate({ items: [], adapters: {} });
  assert.equal(r.records[0].checkId, "KERNEL.REVALIDATION");
  assert.equal(r.records[0].ownerStage, "KERNEL");
  assert.deepEqual(r.records[0].subject, subject);
});

test("five repeated executions of the same fixture produce byte-identical results (no adapter-call-order nondeterminism)", async () => {
  const items = [item({ sourceObjectId: "x" }), item({ sourceObjectId: "y" })];
  const adapters = { CI_RUN: okAdapter("v1", DIGEST_A) };
  const outs = [];
  for (let i = 0; i < 5; i++) outs.push(JSON.stringify((await revalidate({ items, adapters })).records));
  assert.equal(new Set(outs).size, 1);
});

test("a stale result is INCOMPLETE, never FAIL, CONFIGURATION_ERROR or HUMAN_REVIEW_REQUIRED: staleness is an unestablished fact, not a violated invariant or a judgment call", async () => {
  const r = await revalidate({ items: [item()], adapters: { CI_RUN: unreachableAdapter() } });
  assert.equal(r.records[0].status, "INCOMPLETE");
  assert.notEqual(r.records[0].status, "FAIL");
  assert.notEqual(r.records[0].status, "CONFIGURATION_ERROR");
  assert.notEqual(r.records[0].status, "HUMAN_REVIEW_REQUIRED");
});

test("no internal helper is exported through the module", () => {
  const mod = require("./revalidation");
  assert.deepEqual(Object.keys(mod), ["revalidateEvidence"]);
});
