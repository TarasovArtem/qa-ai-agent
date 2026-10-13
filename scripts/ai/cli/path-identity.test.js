"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertPathIdentity } = require("./path-identity");
const { hostilePathSets } = require("../../../test/helpers/ppi1-path-vectors");
test("PPI-1 refuses every contract hostile identity without repairing it", () => {
  for (const paths of hostilePathSets) assert.throws(() => assertPathIdentity(paths, "cypress"), { code: "PATH_IDENTITY_REFUSED" }, JSON.stringify(paths));
  assertPathIdentity(["cypress/e2e/a.cy.js", "cypress/e2e/b.cy.js", "cypress/-a"], "cypress");
});
