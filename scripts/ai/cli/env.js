/**
 * Read-only access to the CLI's ambient environment.
 *
 * The CLI never mutates or serializes its environment. On Windows
 * environment keys are case-insensitive, so lookups (and the child
 * allowlist in child-env.js) compare keys case-insensitively there; an exact
 * upper-case key wins over other spellings.
 */

"use strict";

function isWindows(platform) {
  return platform === "win32";
}

function readEnv(env, name, platform = process.platform) {
  if (!env || typeof env !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(env, name)) {
    const value = env[name];
    return typeof value === "string" ? value : undefined;
  }
  if (!isWindows(platform)) return undefined;
  const wanted = name.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === wanted && typeof env[key] === "string") return env[key];
  }
  return undefined;
}

function hasNonEmpty(env, name, platform) {
  const value = readEnv(env, name, platform);
  return typeof value === "string" && value.length > 0;
}

module.exports = { isWindows, readEnv, hasNonEmpty };
