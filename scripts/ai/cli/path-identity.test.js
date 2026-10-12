"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertPathIdentity } = require("./path-identity");
test("PPI-1 refuses every contract hostile identity without repairing it", () => {
  const vectors = ["cypress\\e2e\\a.cy.js", "/cypress/a.cy.js", "C:/x", "cypress/../a", "cypress/./a", "cypress/.hidden/a", "cypress/a.cy.js.", "cypress/a .cy.js", "cypress/a.cy.js:stream", "cypress/CON.cy.js", "cypress/com1/a.cy.js", "cypress/NODE~1/a", "cypress/node_modules./a", "cypress/NODE_MODULES/a", "cypress/.env.local", "Cypress/a.cy.js", "cypress/a\u202e.cy.js", "cypress/a\u200b.cy.js", "cypress/\ufeffa.cy.js", "cypress/a\u00a0.cy.js", "cypress/а.cy.js", "cypress/é.cy.js", "cypress/e\u0301.cy.js", "cypress/a\u2028.cy.js", "cypress/" + "a".repeat(101), "cypress/" + ["a".repeat(98), "b".repeat(98), "c".repeat(96)].join("/"), "cypress//a", "cypress/a/", "cypress", "cypress/secrets/a", "cypress/credentials/a", "cypress/package.json", "cypress/PACKAGE-LOCK.JSON"];
  for (const p of vectors) assert.throws(() => assertPathIdentity([p], "cypress"), { code: "PATH_IDENTITY_REFUSED" }, p);
  for (const device of ["CON", "PRN", "AUX", "NUL", ...Array.from({ length: 10 }, (_, i) => `COM${i}`), ...Array.from({ length: 10 }, (_, i) => `LPT${i}`)]) assert.throws(() => assertPathIdentity([`cypress/${device}.cy.js`], "cypress"), { code: "PATH_IDENTITY_REFUSED" });
  assert.throws(() => assertPathIdentity(["cypress/a.cy.js", "cypress/A.cy.js"], "cypress"), { code: "PATH_IDENTITY_REFUSED" });
  assertPathIdentity(["cypress/e2e/a.cy.js", "cypress/e2e/b.cy.js"], "cypress");
});
