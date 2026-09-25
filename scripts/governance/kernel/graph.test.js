"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../index");
const { domainDecl } = require("../test-support");

const edge = (domain, kind = "REFERENCE") => ({ domain, kind });
const reasons = (result) => result.findings.map((f) => f.reasonCode);

test("an explicit dependsOn: [] is valid and yields a stable order", () => {
  const r = g.validateGraph([domainDecl("B_DOMAIN"), domainDecl("A_DOMAIN")]);
  assert.equal(r.valid, true);
  assert.equal(r.status, "PASS");
  assert.deepEqual(r.topologicalOrder, ["A_DOMAIN", "B_DOMAIN"]);
});

test("missing dependsOn is not equivalent to [] and is a CONFIGURATION_ERROR", () => {
  const decl = domainDecl("A_DOMAIN");
  delete decl.dependsOn;
  const r = g.validateGraph([decl]);
  assert.equal(r.valid, false);
  assert.equal(r.status, "CONFIGURATION_ERROR");
  assert.deepEqual(reasons(r), ["DEPENDENCY_DECLARATION_MISSING"]);
  for (const key of ["derivedFrom", "protectedInputs", "reviewModes"]) {
    const d = domainDecl("A_DOMAIN");
    delete d[key];
    assert.equal(g.validateGraph([d]).valid, false, key);
  }
});

test("unknown domain, self dependency, duplicate domain, duplicate edge and disabled dependency fail", () => {
  assert.deepEqual(reasons(g.validateGraph([domainDecl("A_DOMAIN", { dependsOn: [edge("MISSING_DOMAIN")] })])), ["DEPENDENCY_UNKNOWN"]);
  assert.deepEqual(reasons(g.validateGraph([domainDecl("A_DOMAIN", { dependsOn: [edge("A_DOMAIN")] })])), ["DEPENDENCY_SELF"]);
  assert.ok(reasons(g.validateGraph([domainDecl("A_DOMAIN"), domainDecl("A_DOMAIN")])).includes("DOMAIN_DUPLICATE"));
  const dupEdge = g.validateGraph([domainDecl("A_DOMAIN"), domainDecl("B_DOMAIN", { dependsOn: [edge("A_DOMAIN"), edge("A_DOMAIN", "MEANING")] })]);
  assert.deepEqual(reasons(dupEdge), ["DEPENDENCY_EDGE_DUPLICATE"]);
  const disabled = g.validateGraph([domainDecl("A_DOMAIN", { enabled: false }), domainDecl("B_DOMAIN", { dependsOn: [edge("A_DOMAIN")] })]);
  assert.deepEqual(reasons(disabled), ["DEPENDENCY_DISABLED"]);
});

test("cycles of length two and three are rejected without any tolerance", () => {
  const two = g.validateGraph([domainDecl("A_DOMAIN", { dependsOn: [edge("B_DOMAIN")] }), domainDecl("B_DOMAIN", { dependsOn: [edge("A_DOMAIN")] })]);
  assert.deepEqual(reasons(two), ["DEPENDENCY_CYCLE"]);
  assert.equal(two.status, "CONFIGURATION_ERROR");
  assert.equal(two.topologicalOrder, null);
  const three = g.validateGraph([
    domainDecl("A_DOMAIN", { dependsOn: [edge("B_DOMAIN")] }),
    domainDecl("B_DOMAIN", { dependsOn: [edge("C_DOMAIN")] }),
    domainDecl("C_DOMAIN", { dependsOn: [edge("A_DOMAIN")] }),
  ]);
  assert.deepEqual(reasons(three), ["DEPENDENCY_CYCLE"]);
  assert.match(three.findings[0].detail, /A_DOMAIN,B_DOMAIN,C_DOMAIN/);
});

test("derivedFrom must be consistent with dependsOn", () => {
  const bad = g.validateGraph([domainDecl("A_DOMAIN"), domainDecl("B_DOMAIN", { derivedFrom: [{ type: "DOMAIN", domain: "A_DOMAIN" }] })]);
  assert.deepEqual(reasons(bad), ["DERIVED_FROM_NOT_IN_DEPENDS_ON"]);
  const ok = g.validateGraph([
    domainDecl("A_DOMAIN"),
    domainDecl("B_DOMAIN", { dependsOn: [edge("A_DOMAIN", "DERIVED_VALUE")], derivedFrom: [{ type: "DOMAIN", domain: "A_DOMAIN" }, { type: "SOURCE", selector: "docs/x.md#tbl" }] }),
  ]);
  assert.equal(ok.valid, true);
});

test("unknown edge kinds, fields and malformed declarations are rejected without coercion", () => {
  assert.ok(reasons(g.validateGraph([domainDecl("A_DOMAIN"), domainDecl("B_DOMAIN", { dependsOn: [edge("A_DOMAIN", "reference")] })])).includes("DEPENDENCY_KIND_INVALID"));
  const bad = [
    domainDecl("lower_case"),
    domainDecl("A_DOMAIN", { enabled: "true" }),
    domainDecl("A_DOMAIN", { ownerStage: "1G" }),
    domainDecl("A_DOMAIN", { ownerStage: "KERNEL" }),
    domainDecl("A_DOMAIN", { reviewModes: [] }),
    domainDecl("A_DOMAIN", { reviewModes: ["DEEP_REVIEW_REQUIRED", "DEEP_REVIEW_REQUIRED"] }),
    domainDecl("A_DOMAIN", { reviewModes: ["OTHER"] }),
    domainDecl("A_DOMAIN", { dependsOn: "none" }),
    domainDecl("A_DOMAIN", { dependsOn: [{ domain: "B_DOMAIN" }] }),
    domainDecl("A_DOMAIN", { extra: true }),
    domainDecl("A_DOMAIN", { protectedInputs: [], reviewModes: ["PRESERVATION_CHECK_ONLY"] }),
    domainDecl("A_DOMAIN", { protectedInputs: ["ok", "ok"] }),
    null,
    "A_DOMAIN",
  ];
  for (const decl of bad) assert.equal(g.validateGraph([decl]).valid, false, JSON.stringify(decl));
  assert.equal(g.validateGraph("nope").valid, false);
  assert.equal(g.validateGraph({}).valid, false);
});

test("an empty protectedInputs list is legal only when PRESERVATION_CHECK_ONLY is excluded", () => {
  assert.equal(g.validateGraph([domainDecl("A_DOMAIN", { protectedInputs: [], reviewModes: ["DEEP_REVIEW_REQUIRED"] })]).valid, true);
});

test("topological order is stable, deterministic and independent of declaration order", () => {
  const decls = [
    domainDecl("D_DOMAIN", { dependsOn: [edge("B_DOMAIN"), edge("C_DOMAIN")] }),
    domainDecl("C_DOMAIN", { dependsOn: [edge("A_DOMAIN")] }),
    domainDecl("B_DOMAIN", { dependsOn: [edge("A_DOMAIN")] }),
    domainDecl("A_DOMAIN"),
    domainDecl("E_DOMAIN"),
  ];
  const a = g.validateGraph(decls).topologicalOrder;
  const b = g.validateGraph([...decls].reverse()).topologicalOrder;
  assert.deepEqual(a, ["A_DOMAIN", "B_DOMAIN", "C_DOMAIN", "D_DOMAIN", "E_DOMAIN"]);
  assert.deepEqual(a, b);
  for (let i = 0; i < 3; i += 1) assert.deepEqual(g.validateGraph(decls).topologicalOrder, a);
});

test("disabled domains are excluded from the order but a disabled leaf is legal", () => {
  const r = g.validateGraph([domainDecl("A_DOMAIN"), domainDecl("OFF_DOMAIN", { enabled: false })]);
  assert.equal(r.valid, true);
  assert.deepEqual(r.topologicalOrder, ["A_DOMAIN"]);
});

test("the validator does not mutate input and returns frozen data", () => {
  const decls = [domainDecl("A_DOMAIN"), domainDecl("B_DOMAIN", { dependsOn: [edge("A_DOMAIN")] })];
  const before = JSON.stringify(decls);
  const r = g.validateGraph(decls);
  assert.equal(JSON.stringify(decls), before);
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.domains[0]), true);
  assert.notEqual(r.domains[0], decls[0]);
});
