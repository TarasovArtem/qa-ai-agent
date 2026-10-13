"use strict";
const os = require("os");
const fs = require("fs");
const { isValidId } = require("../generation/primitives");
const { encodeValue, escapeTokens, digest } = require("./canonical-review-serialization");
const { authorityRefused, inputRefused } = require("./errors");
// No Windows + Node combination has the required real OS evidence. This
// list is product-owned, never configured or inferred from an environment.
const PROVEN_WIN32_NODE_MAJORS = Object.freeze([]);
function unavailable() { return authorityRefused("REVIEWER_IDENTITY_UNAVAILABLE", "the OS account or Stage 4 filesystem configuration is not eligible."); }
function resolvePrincipal({ platform = process.platform, userInfo = os.userInfo } = {}) {
  if (platform === "win32") throw unavailable();
  let u; try { u = userInfo(); } catch { throw unavailable(); }
  if (!u || typeof u.username !== "string" || !Number.isSafeInteger(u.uid) || u.uid < 1) throw unavailable();
  const principal = "os-account-v1:" + escapeTokens(u.username, { marker: false }).join("");
  if (!isValidId(principal)) throw unavailable();
  return { method: "os-local-account-v1", principal, uid: u.uid, profileDigest: null, platform, assurance: "LOCAL_ACCOUNT_ATTRIBUTION" };
}
function principalKey(p) { return encodeValue(p.platform === "win32" ? [p.platform, p.principal, p.profileDigest] : [p.platform, p.uid, p.principal]); }
function canonicalRootPath(native, platform) {
  if (platform !== "win32") return native;
  if (!/^[A-Za-z]:\\/.test(native)) throw inputRefused("REPOSITORY_BINDING_MISMATCH", "UNC and device-namespace repository roots are not eligible.");
  const p = native[0].toUpperCase() + native.slice(1).replace(/\\/g, "/"); return p.length > 3 && p.endsWith("/") ? p.slice(0, -1) : p;
}
function rootDigest({ platform, rootPath, dev, ino }) { return digest("qa-ai-agent:repository-root-binding:v1:", Buffer.from(encodeValue({ identityVersion: 1, platform, rootPath, dev, ino }), "ascii")); }
function repositoryRootBinding(realRoot, platform = process.platform) {
  try {
    const native = fs.realpathSync.native(realRoot);
    const st = fs.lstatSync(native, { bigint: true });
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("kind");
    return { method: "root-identity-v1", digest: rootDigest({ platform, rootPath: canonicalRootPath(native, platform), dev: st.dev.toString(10), ino: st.ino.toString(10) }) };
  } catch { throw inputRefused("REPOSITORY_BINDING_MISMATCH", "the repository root identity is unavailable or mismatched."); }
}
function assertStorageEligibility(realRoot, platform = process.platform) {
  // A filesystem-type primitive rejects remote/unknown filesystems rather
  // than probing atomicity with a race and treating one success as proof.
  // Directory fsync must actually succeed. Lying storage remains R-3.
  if (platform !== "linux") throw unavailable();
  let fd;
  try {
    const type = fs.statfsSync(realRoot, { bigint: true }).type;
    if (![0xef53n, 0x58465342n, 0x9123683en, 0xf2f52010n].includes(type)) throw new Error("filesystem");
    fd = fs.openSync(realRoot, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0));
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
  } catch { if (fd !== undefined) try { fs.closeSync(fd); } catch {} throw unavailable(); }
}
module.exports = { PROVEN_WIN32_NODE_MAJORS, resolvePrincipal, principalKey, canonicalRootPath, rootDigest, repositoryRootBinding, assertStorageEligibility };
