"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const principal = require("./stage4-principal");
test("OS attribution uses effective OS account, ignores env, refuses euid0 and unproven win32", () => {
  const userInfo = () => ({ username: "alice@x", uid: 1000, homedir: "/home/alice" });
  assert.deepEqual(principal.resolvePrincipal({ platform: "linux", userInfo, env: { USER: "root", HOME: "/root", USERPROFILE: "evil" } }), { method: "os-local-account-v1", principal: "os-account-v1:alice@x", uid: 1000, profileDigest: null, platform: "linux", assurance: "LOCAL_ACCOUNT_ATTRIBUTION" });
  assert.throws(() => principal.resolvePrincipal({ platform: "linux", userInfo: () => ({ username: "root", uid: 0 }) }), { code: "REVIEWER_IDENTITY_UNAVAILABLE" });
  assert.throws(() => principal.resolvePrincipal({ platform: "win32", userInfo }), { code: "REVIEWER_IDENTITY_UNAVAILABLE" });
  assert.notEqual(principal.principalKey(principal.resolvePrincipal({ platform: "linux", userInfo })), principal.principalKey(principal.resolvePrincipal({ platform: "linux", userInfo: () => ({ username: "bob", uid: 1000 }) })));
});
test("root-identity-v1 exact golden serialization and portable drive/UNC refusal", () => {
  const identity = { platform: "linux", rootPath: "/tmp/é", dev: "1", ino: "2" };
  const reference = require("node:crypto").createHash("sha256").update('qa-ai-agent:repository-root-binding:v1:{"dev":"1","identityVersion":1,"ino":"2","platform":"linux","rootPath":"/tmp/\\u00e9"}', "ascii").digest("hex");
  assert.equal(principal.rootDigest(identity), `sha256:${reference}`);
  assert.equal(reference, "23082e5b682ef90dba3c14c993239e65bdc1e435d52d21e7189453e211f604f3");
  assert.equal(principal.canonicalRootPath("c:\\Repo\\", "win32"), "C:/Repo");
  for (const s of ["\\\\server\\share", "\\\\?\\C:\\x", "\\\\.\\x"]) assert.throws(() => principal.canonicalRootPath(s, "win32"), { code: "REPOSITORY_BINDING_MISMATCH" });
});
