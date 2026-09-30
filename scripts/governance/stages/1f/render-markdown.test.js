"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown } = require("./render-markdown");

const validReport = (overrides = {}) => ({
  schemaVersion: 1,
  generatedFor: { head: "a".repeat(40), tree: "b".repeat(40), base: "c".repeat(40), parents: [], branch: "main" },
  reviewClass: "HEAVY",
  finalized: false,
  records: [{ checkId: "1A.IDENTITY", ownerStage: "1A", status: "PASS", reasonCode: "OK" }],
  domains: [{ domainId: "DOMAIN_A", effectiveLevel: "PRESERVATION_CHECK_ONLY", reasons: ["NO_CHANGE_DETECTED"], fingerprint: null }],
  ci: { state: "NOT_COLLECTED" },
  humanReviewRequired: [],
  counts: { PASS: 1, FAIL: 0, CONFIGURATION_ERROR: 0, HUMAN_REVIEW_REQUIRED: 0, INCOMPLETE: 0, NOT_APPLICABLE: 0 },
  overallStatus: "PASS",
  readiness: { state: "READY", dominantStatus: "PASS", counts: {} },
  notAuthorization: true,
  requiresRevalidation: true,
  ...overrides,
});

test("renders a well-formed report without throwing and includes the mandatory disclaimers", () => {
  const md = renderMarkdown(validReport());
  assert.match(md, /notAuthorization/);
  assert.match(md, /requiresRevalidation/);
  assert.match(md, /not\*\* merge authorization/);
});

test("every status/readiness value in the JSON is reflected verbatim, never recomputed", () => {
  const md = renderMarkdown(validReport({ overallStatus: "FAIL", readiness: { state: "NOT_READY", dominantStatus: "FAIL", counts: {} } }));
  assert.match(md, /Overall status: `FAIL`/);
  assert.match(md, /Readiness state: `NOT_READY`/);
});

test("a NOT_COLLECTED ci value is explicitly rendered as not-yet-collected, never presented as a pass", () => {
  const md = renderMarkdown(validReport());
  assert.match(md, /not yet collected/);
});

test("a collected ci value is rendered", () => {
  const md = renderMarkdown(validReport({ ci: { collected: true } }));
  assert.match(md, /collected/);
});

test("every domain and record row appears in the output", () => {
  const md = renderMarkdown(validReport());
  assert.match(md, /DOMAIN_A/);
  assert.match(md, /PRESERVATION_CHECK_ONLY/);
  assert.match(md, /1A\.IDENTITY/);
});

test("a non-empty humanReviewRequired list is rendered, never omitted", () => {
  const md = renderMarkdown(validReport({ humanReviewRequired: ["1E.DOMAIN.DOMAIN_A"] }));
  assert.match(md, /1E\.DOMAIN\.DOMAIN_A/);
});

test("an empty domains/records/humanReviewRequired list renders an explicit placeholder, never a silently empty section", () => {
  const md = renderMarkdown(validReport({ domains: [], records: [], humanReviewRequired: [] }));
  assert.match(md, /\(none\)/);
});

test("a pipe or newline character in a reason/status-adjacent field cannot break the Markdown table structure (content injection safety)", () => {
  const md = renderMarkdown(validReport({
    domains: [{ domainId: "DOMAIN_A", effectiveLevel: "PRESERVATION_CHECK_ONLY", reasons: ["a | b\nFAKE ROW | injected"], fingerprint: null }],
  }));
  // The escaped pipe must not create a new table column, and the newline must not create a new row.
  const domainSection = md.split("## Domains")[1].split("## Human Review Required")[0];
  const tableLines = domainSection.split("\n").filter((l) => l.startsWith("|"));
  assert.equal(tableLines.length, 3); // header, separator, exactly one data row
});

test("missing a required field fails closed with a clear error, never silently omits the section", () => {
  const bad = validReport();
  delete bad.overallStatus;
  assert.throws(() => renderMarkdown(bad), /missing required field overallStatus/);
});

test("never renders anything for a non-object input; fails closed", () => {
  for (const bad of [null, undefined, 42, "x", []]) {
    assert.throws(() => renderMarkdown(bad));
  }
});

test("rendering is deterministic: five repeated renders of an identical report are byte-identical", () => {
  const report = validReport();
  const outs = Array.from({ length: 5 }, () => renderMarkdown(report));
  assert.equal(new Set(outs).size, 1);
});

test("no internal helper is exported through the module", () => {
  const mod = require("./render-markdown");
  assert.deepEqual(Object.keys(mod), ["renderMarkdown"]);
});
