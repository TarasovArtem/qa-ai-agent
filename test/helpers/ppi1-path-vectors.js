"use strict";
// Hostile inputs shared with the canonical validator tests, not path policy.
const hostilePathSets = [
  ...[
    "cypress\\e2e\\a.cy.js", "/cypress/a.cy.js", "C:/x", "C:\\x",
    "//server/share/a.cy.js", "\\\\server\\share\\a.cy.js",
    "cypress/../a", "cypress/./a", "cypress/.hidden/a",
    "cypress/a.cy.js.", "cypress/a.cy.js ", "cypress/a .cy.js",
    "cypress/a.cy.js:stream", "cypress/NODE~1/a", "cypress/node_modules./a",
    "cypress/NODE_MODULES/a", "cypress/.env.local", "Cypress/a.cy.js",
    "playwright/a.spec.js", "cypress/a\u202e.cy.js", "cypress/a\u200b.cy.js",
    "cypress/\ufeffa.cy.js", "cypress/a\u00a0.cy.js", "cypress/а.cy.js",
    "cypress/é.cy.js", "cypress/e\u0301.cy.js", "cypress/a\u2028.cy.js",
    "cypress/" + "a".repeat(101),
    "cypress/" + ["a".repeat(98), "b".repeat(98), "c".repeat(96)].join("/"),
    "cypress//a", "cypress/a/", "cypress", "cypress/secrets/a",
    "cypress/credentials/a", "cypress/package.json", "cypress/PACKAGE-LOCK.JSON",
    "cypress/.git/a", "cypress/.github/a", "cypress/a?b", "cypress/a\u0000b",
  ].map(p => [p]),
  ...["CON", "PRN", "AUX", "NUL",
    ...Array.from({ length: 10 }, (_, i) => `COM${i}`),
    ...Array.from({ length: 10 }, (_, i) => `LPT${i}`),
  ].flatMap(device => [[`cypress/e2e/generated/${device}.cy.js`], [`cypress/${device.toLowerCase()}/a.cy.js`]]),
  ["cypress/a.cy.js", "cypress/A.cy.js"],
];
module.exports = { hostilePathSets };
