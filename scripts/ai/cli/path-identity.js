"use strict";
const { isSafeRepoRelativePath, isCanonicalPlanPath } = require("../generation/automation-plan");
const { isProtectedPath } = require("../test-automation/generated-change-set");
const { inputRefused } = require("./errors");
function asciiFold(s) { return s.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32)); }
function assertPathIdentity(paths, framework) {
  const seen = new Set();
  if (!Array.isArray(paths) || !["cypress", "playwright"].includes(framework)) throw inputRefused("PATH_IDENTITY_REFUSED", "target paths must satisfy PPI-1.");
  for (const p of paths) {
    let valid = typeof p === "string" && p.length >= 1 && p.length <= 300 && /^[A-Za-z0-9._/-]+$/.test(p) && isSafeRepoRelativePath(p) && isCanonicalPlanPath(p) && !isProtectedPath(p);
    if (valid) {
      const parts = p.split("/"); const folded = asciiFold(p);
      valid = parts.length >= 2 && parts[0] === framework && !seen.has(folded) && parts.every(s => s.length >= 1 && s.length <= 100 && /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(s) && !s.endsWith(".") && !/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/.test(s.split(".")[0].toUpperCase()) && ![".git", ".github", "node_modules", "secrets", "credentials"].includes(asciiFold(s))) && !["package.json", "package-lock.json"].includes(asciiFold(parts.at(-1))) && !isProtectedPath(folded);
      seen.add(folded);
    }
    if (!valid) throw inputRefused("PATH_IDENTITY_REFUSED", "a target path is not already in canonical PPI-1 form; no path repair is permitted.");
  }
}
module.exports = { assertPathIdentity, asciiFold };
