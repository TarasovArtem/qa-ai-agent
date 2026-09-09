/**
 * Trusted target repository root boundary (Roadmap FPI-2, Full Project
 * Independence).
 *
 * Every generic runtime module that reads or writes TARGET-repository
 * artifacts (evidence, reports, History, AI output) must anchor those
 * operations to an explicitly supplied `repositoryRoot` rather than
 * deriving the target repository from this generic core's own module
 * location (`__dirname`), the current process's working directory
 * (`process.cwd()`), or any other implicit fallback. This module is the
 * single, small, dependency-light primitive that validates a caller-
 * supplied `repositoryRoot` and produces the two-boundary object every
 * root-dependent consumer needs:
 *
 *   lexicalRoot - the resolved (but not symlink-followed) absolute path
 *                  the caller supplied, used for LEXICAL containment
 *                  checks (a string/path-arithmetic comparison, no
 *                  filesystem access);
 *   realRoot    - the fully symlink-resolved (realpath) form of the same
 *                  directory, used for CANONICAL containment checks (the
 *                  only way to close a symlink-escape gap).
 *
 * This mirrors the existing #23F/#23G trust-class precedent
 * (scripts/ai/test-automation/change-set-application.js's and
 * controlled-execution.js's own resolveRepositoryRoot(): absolute,
 * control-character-free, realpath-resolvable, an existing directory)
 * rather than inventing a new one, but additionally preserves the
 * lexical/canonical TWO-boundary distinction the reactive pipeline's own
 * existing security model (scripts/ai/context-utils.js,
 * scripts/ai/collect-context.js) already depends on - #23F/#23G only ever
 * needed the canonical form for their own mutation/execution authority,
 * but the reactive pipeline's relevant-file/reporter-path logic
 * deliberately checks BOTH a lexical boundary (no filesystem access,
 * catches "../" traversal and prefix collisions on the candidate string
 * itself) and a canonical one (catches a symlink escape) - collapsing
 * that into one value would weaken it.
 *
 * `repositoryRoot` is trusted orchestration input ONLY - see this
 * module's own callers for the enforced rule that it may never be
 * derived from AI/provider output, PR/repository content, or any other
 * untrusted source. A missing or invalid root fails closed: no fallback
 * to `process.cwd()`, `__dirname`, or any other implicit repository
 * location ever exists inside generic core.
 *
 * This module holds NO module-global mutable root state - every call
 * receives its own `repositoryRoot` argument and returns its own boundary
 * object, so the same loaded modules can safely operate against two (or
 * more) different target repositories, sequentially, within one process
 * (Roadmap FPI-2's two-root same-process proof).
 */

"use strict";

const fs = require("fs");
const path = require("path");

// charCode-based, matching the established repository convention (see
// scripts/ai/test-automation/automation-repository-context.js and
// scripts/ai/framework-runtime-config.js) - deliberately avoids any
// literal control-character escape sequence in this source file's own
// text.
function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

// Pure shape/filesystem validation - never throws, always returns a
// result object. Mirrors change-set-application.js's/controlled-
// execution.js's own resolveRepositoryRoot() trust class (absolute,
// control-character-free, realpath-resolvable, an existing directory),
// but additionally retains the lexical form alongside the canonical one -
// see the module docstring for why both are needed here.
function validateRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    return { valid: false, errors: ["repositoryRoot must be a non-empty string"] };
  }
  if (hasControlChar(repositoryRoot)) {
    return { valid: false, errors: ["repositoryRoot must not contain control characters"] };
  }
  if (!path.isAbsolute(repositoryRoot)) {
    return { valid: false, errors: ["repositoryRoot must be an absolute path"] };
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync(repositoryRoot);
  } catch {
    return { valid: false, errors: ["repositoryRoot does not resolve to an existing, resolvable path"] };
  }

  let stat;
  try {
    stat = fs.statSync(realRoot);
  } catch {
    return { valid: false, errors: ["repositoryRoot does not resolve to an existing, resolvable path"] };
  }
  if (!stat.isDirectory()) {
    return { valid: false, errors: ["repositoryRoot must resolve to a directory, not a file"] };
  }

  return {
    valid: true,
    errors: [],
    lexicalRoot: path.resolve(repositoryRoot),
    realRoot,
  };
}

// Roadmap FPI-2: shared fail-closed helper, matching the established
// assertValid*() convention (scripts/ai/project-profile.js,
// scripts/ai/framework-runtime-config.js) exactly - a plain Error with a
// stable, deterministic, bounded message prefix, never a fabricated
// partial boundary and never uncontrolled serialization of the invalid
// input. On success, returns ONLY the boundary `{ lexicalRoot, realRoot }`
// (not the `{valid, errors}` wrapper) - callers that have already reached
// this point never need to re-check `valid`.
function assertValidRepositoryRoot(repositoryRoot, callerLabel) {
  if (repositoryRoot === undefined || repositoryRoot === null) {
    throw new Error(`REPOSITORY_ROOT_REQUIRED: ${callerLabel} requires an explicit repositoryRoot; none was supplied.`);
  }
  const result = validateRepositoryRoot(repositoryRoot);
  if (!result.valid) {
    throw new Error(`REPOSITORY_ROOT_INVALID: ${callerLabel} received an invalid repositoryRoot (${result.errors.join("; ")}).`);
  }
  return { lexicalRoot: result.lexicalRoot, realRoot: result.realRoot };
}

module.exports = { validateRepositoryRoot, assertValidRepositoryRoot };
