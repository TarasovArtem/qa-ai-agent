/**
 * Production framework runtime selector (Roadmap #21E).
 *
 * Decides which adapter object the CLI/production entrypoint
 * (collect-context.js's own `if (require.main === module)` block) passes
 * into main({ adapter }) - and nothing else. Framework selection here is
 * explicit, deterministic, and fail-closed: it never inspects installed
 * packages, report files, repository layout, or browser availability, and
 * it never sets context.metadata.framework directly - that identity
 * continues to come only from the selected adapter's own `.id` (see
 * collect-context.js's getMetadata()), so this module can never become a
 * second, independent source of framework identity.
 *
 * Deliberately separate from main()'s own `adapter = cypressAdapter`
 * default parameter (collect-context.js, unchanged by this file) -
 * programmatic/test callers of main({ adapter }) never go through this
 * module at all, so an explicitly injected adapter is always authoritative
 * regardless of QA_FRAMEWORK. This mirrors the existing
 * config.js/providers/index.js split in this repository: config.js/here
 * only resolve a name from the environment, a separate static-map factory
 * (createProvider()/selectRuntimeAdapter() below) turns a resolved name
 * into the real object, and an unrecognized name is a configuration
 * mistake to fail loudly on, never silently coerced to a default.
 */

"use strict";

const cypressAdapter = require("./adapters/cypress-adapter");
const playwrightAdapter = require("./adapters/playwright-adapter");

class RuntimeFrameworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuntimeFrameworkError";
  }
}

const DEFAULT_FRAMEWORK = "cypress";

// Closed, static map - the only mechanism by which a resolved framework id
// ever becomes an adapter object. Never a dynamic
// `require(`./adapters/${value}-adapter`)`: an unrecognized key is simply
// absent here, by construction, so there is no path from user-controlled
// text to a filesystem/module path (Roadmap #21E security invariant).
const ADAPTERS = Object.freeze({
  cypress: cypressAdapter,
  playwright: playwrightAdapter,
});

// Pure: normalizes and validates a raw selector value into one of the
// closed set of canonical framework ids this repository supports - never
// touches the filesystem, network, environment, or any adapter itself.
// Absent (undefined/null) input is treated as "no explicit selection" and
// resolves to DEFAULT_FRAMEWORK; a genuinely supplied, non-empty,
// unrecognized value is a configuration error, never silently coerced to
// a supported one, and never falls back to any framework (including
// DEFAULT_FRAMEWORK itself).
//
// D21E-2 (pre-#21G hardening): the input contract is exactly {undefined,
// null, string} - anything else (array, plain object, number, boolean,
// symbol, function, thenable, ...) is rejected outright, BEFORE any
// String() coercion is attempted. This module used to call
// `String(rawValue).trim()` unconditionally, which silently turned e.g.
// `[]` into `""` (empty -> the Cypress default, exactly as if no selector
// had been supplied at all) and `["playwright"]` into `"playwright"` (an
// accidental, never-intended selection route driven by Array.prototype's
// own toString() rather than a real string the caller supplied). Neither
// outcome is safe: both let a non-string, non-configuration value quietly
// pick a real adapter through JS's implicit coercion rules instead of
// failing closed like any other malformed selector.
function resolveFrameworkId(rawValue) {
  if (rawValue === undefined || rawValue === null) return DEFAULT_FRAMEWORK;

  if (typeof rawValue !== "string") {
    // Never String()-coerces or otherwise echoes the rejected value itself
    // - only its typeof - so an object's own toString()/Symbol.toPrimitive
    // can never influence the error text, and no object content is
    // reflected back to the caller.
    throw new RuntimeFrameworkError(
      `QA_FRAMEWORK selector must be a string (or absent). Received type: ${typeof rawValue}.`
    );
  }

  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return DEFAULT_FRAMEWORK;

  const normalized = trimmed.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ADAPTERS, normalized)) return normalized;

  // Never echoes the raw untrusted value into the error - only the fixed,
  // safe list of values this repository actually supports.
  throw new RuntimeFrameworkError(`Unsupported QA_FRAMEWORK value. Allowed values: ${Object.keys(ADAPTERS).join(", ")}.`);
}

// The only function that ever turns a resolved framework id into an
// actual adapter object - a static lookup against the closed ADAPTERS map
// above, never a registry, plugin system, or filesystem probe. Exactly one
// adapter object is ever returned per call.
function selectRuntimeAdapter(rawValue) {
  const frameworkId = resolveFrameworkId(rawValue);
  return ADAPTERS[frameworkId];
}

module.exports = {
  DEFAULT_FRAMEWORK,
  ADAPTERS,
  RuntimeFrameworkError,
  resolveFrameworkId,
  selectRuntimeAdapter,
};
