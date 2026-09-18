#!/usr/bin/env node
/**
 * Versioned branch inventory / classification authority (CRW2-B1, B-1).
 *
 * Before this file, "what branch classes exist and what do they mean" was
 * pure undocumented naming folklore: a live inventory of this repository's
 * own branches (`gh api repos/.../branches`) shows 13 distinct recurring
 * prefix conventions (`feature/`, `docs/`, `chore/`, `fix/`, `corrective/`,
 * `refactor/`, `experiment/`, `evidence/`, `independence/`, `installation/`,
 * `proof/`, `spike/`, `dependabot/`) plus `main`, none written down anywhere
 * in ROADMAP.md or README.md, and no script or workflow classifies a branch
 * name at all - `.github/workflows/*.yml` only ever filter on the literal
 * branch `main`, never on a naming pattern. This module is the single,
 * durable, fail-closed classification authority: one frozen manifest
 * (`MANIFEST`, schema-versioned) plus pure `validateManifest()` /
 * `classifyBranch()` functions a CLI or another script can reuse, so no
 * second regex/taxonomy is ever hand-maintained elsewhere.
 *
 * `main` is `main` exclusively - `MODEL C` (hybrid) is fine here because it
 * matches repository reality without maintaining a permanently-stale exact
 * roster: this repository has exactly one long-lived, GitHub-protected
 * branch (`main`, confirmed live via `gh api repos/.../branches/main/
 * protection`), so it is the only `namedBranches` entry; every other branch
 * observed is transient (created, merged, deleted) and is represented as a
 * purpose-prefix `classes` pattern instead of an exact name that would go
 * stale the moment the branch is deleted.
 *
 * Scope boundary: this is B-1-scoped governance metadata for branches, not
 * a general Git policy framework (see docs/branch-inventory-v1.md's "What
 * this does not do"). It does not close B-4 (global fail-closed
 * test-infrastructure verification - this module's own fail-closed
 * behavior is a local property, not a B-4 closure), B-6 (broader versioned
 * governance/process knowledge - this is one governance artifact, not the
 * whole layer), or GOV-VERIFY-1 (future reusable merge-evidence
 * verification - no exact-HEAD/TREE/merge authority engine is added here).
 */

"use strict";

const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

// One place this assignment is made - see docs/branch-inventory-v1.md for
// the evidenced rationale behind every class (why it exists, what it is
// for, why it is transient/automation rather than long-lived).
const MANIFEST = Object.freeze({
  schemaVersion: 1,
  defaultBranch: "main",
  namedBranches: Object.freeze({
    main: Object.freeze({
      kind: "long-lived",
      protected: true,
      purpose: "Sole integration target. Every PR merges here; nothing merges from here.",
    }),
  }),
  classes: Object.freeze({
    feature: Object.freeze({
      pattern: "^feature/",
      kind: "transient",
      protected: false,
      purpose: "New capability implementation.",
    }),
    docs: Object.freeze({
      pattern: "^docs/",
      kind: "transient",
      protected: false,
      purpose: "Documentation, canonical-record, or governance-metadata-only changes.",
    }),
    chore: Object.freeze({
      pattern: "^chore/",
      kind: "transient",
      protected: false,
      purpose: "Routine maintenance/cleanup not tied to a specific finding fix.",
    }),
    fix: Object.freeze({
      pattern: "^fix/",
      kind: "transient",
      protected: false,
      purpose: "Targeted bug fix.",
    }),
    corrective: Object.freeze({
      pattern: "^corrective/",
      kind: "transient",
      protected: false,
      purpose: "Standalone corrective work opened as its own PR/branch, distinct from a Cn corrective commit appended to an existing implementation branch.",
    }),
    refactor: Object.freeze({
      pattern: "^refactor/",
      kind: "transient",
      protected: false,
      purpose: "Internal restructuring with no behavior change and no finding closure claimed.",
    }),
    experiment: Object.freeze({
      pattern: "^experiment/",
      kind: "transient",
      protected: false,
      purpose: "Exploratory/research work (e.g. AI evaluation knowledge experiments). May carry local-only, non-pushed state (e.g. a git stash) tied to that experiment - never assume a branch in this class is disposable without checking for such state first.",
    }),
    evidence: Object.freeze({
      pattern: "^evidence/",
      kind: "transient",
      protected: false,
      purpose: "Evidence-gathering/reproduction for a specific investigation.",
    }),
    independence: Object.freeze({
      pattern: "^independence/",
      kind: "transient",
      protected: false,
      purpose: "Full Project Independence initiative work (FPI-*, TI-*).",
    }),
    installation: Object.freeze({
      pattern: "^installation/",
      kind: "transient",
      protected: false,
      purpose: "Package installability/public-API initiative work (ID-*).",
    }),
    proof: Object.freeze({
      pattern: "^proof/",
      kind: "transient",
      protected: false,
      purpose: "Standalone proof-of-concept demonstration. Not necessarily intended to merge - check the branch's own PR/description before assuming merge intent.",
    }),
    spike: Object.freeze({
      pattern: "^spike/",
      kind: "transient",
      protected: false,
      purpose: "Throwaway technical exploration, not expected to merge as-is.",
    }),
    dependabot: Object.freeze({
      pattern: "^dependabot/",
      kind: "automation",
      protected: false,
      purpose: "Bot-created dependency-update branch (npm/github-actions ecosystems). Created, merged, and deleted by Dependabot, not a human author.",
    }),
  }),
});

const MANIFEST_RESULT = Object.freeze({
  VALID: "VALID",
  INVALID: "INVALID",
});

const CLASSIFY_STATUS = Object.freeze({
  NAMED: "NAMED",
  CLASSIFIED: "CLASSIFIED",
  UNKNOWN: "UNKNOWN",
  AMBIGUOUS: "AMBIGUOUS",
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_MANIFEST: "INVALID_MANIFEST",
});

const VALID_CLASS_KINDS = new Set(["transient", "automation"]);
const VALID_NAMED_KINDS = new Set(["long-lived"]);

/**
 * Fail-closed structural + semantic validation of a branch-inventory
 * manifest. Never throws; always returns `{ result, errors }`. Any
 * unsupported schema version, missing default branch, invalid regex,
 * duplicate pattern, or contradictory attribute (e.g. a transient/
 * automation class declaring `protected: true`) is a validation failure -
 * this function is never asked to guess a safe interpretation.
 *
 * @param {unknown} manifest
 * @returns {{ result: string, errors: string[] }}
 */
function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { result: MANIFEST_RESULT.INVALID, errors: ["manifest must be a non-null, non-array object"] };
  }

  if (!SUPPORTED_SCHEMA_VERSIONS.has(manifest.schemaVersion)) {
    errors.push(`unsupported or missing schemaVersion "${manifest.schemaVersion}" - refusing to guess a compatible interpretation`);
    // Schema is the precondition for every other check below being
    // meaningful - fail closed immediately rather than reporting
    // downstream noise against an unrecognized shape.
    return { result: MANIFEST_RESULT.INVALID, errors };
  }

  if (typeof manifest.defaultBranch !== "string" || manifest.defaultBranch.length === 0) {
    errors.push("defaultBranch must be a non-empty string");
  }

  const namedBranches = manifest.namedBranches;
  if (!namedBranches || typeof namedBranches !== "object" || Array.isArray(namedBranches)) {
    errors.push("namedBranches must be a non-null, non-array object");
  } else {
    if (typeof manifest.defaultBranch === "string" && !Object.hasOwn(namedBranches, manifest.defaultBranch)) {
      errors.push(`defaultBranch "${manifest.defaultBranch}" is not represented in namedBranches`);
    }
    for (const [name, entry] of Object.entries(namedBranches)) {
      if (!entry || typeof entry !== "object") {
        errors.push(`namedBranches["${name}"] must be an object`);
        continue;
      }
      if (!VALID_NAMED_KINDS.has(entry.kind)) {
        errors.push(`namedBranches["${name}"].kind "${entry.kind}" is not a recognized kind`);
      }
      if (typeof entry.protected !== "boolean") {
        errors.push(`namedBranches["${name}"].protected must be a boolean`);
      }
    }
  }

  const classes = manifest.classes;
  if (!classes || typeof classes !== "object" || Array.isArray(classes)) {
    errors.push("classes must be a non-null, non-array object");
  } else {
    const seenPatterns = new Set();
    for (const [className, entry] of Object.entries(classes)) {
      if (!entry || typeof entry !== "object") {
        errors.push(`classes["${className}"] must be an object`);
        continue;
      }
      if (typeof entry.pattern !== "string" || entry.pattern.length === 0) {
        errors.push(`classes["${className}"].pattern must be a non-empty string`);
      } else {
        try {
          // eslint-disable-next-line no-new
          new RegExp(entry.pattern);
        } catch {
          errors.push(`classes["${className}"].pattern "${entry.pattern}" is not a valid regular expression`);
        }
        if (seenPatterns.has(entry.pattern)) {
          errors.push(`classes["${className}"].pattern "${entry.pattern}" duplicates another class's pattern`);
        }
        seenPatterns.add(entry.pattern);
        if (
          namedBranches &&
          typeof namedBranches === "object" &&
          !Array.isArray(namedBranches)
        ) {
          for (const namedBranch of Object.keys(namedBranches)) {
            let compiled;
            try {
              compiled = new RegExp(entry.pattern);
            } catch {
              compiled = null;
            }
            if (compiled && compiled.test(namedBranch)) {
              errors.push(`classes["${className}"].pattern "${entry.pattern}" matches namedBranches["${namedBranch}"] - a class pattern must never reclassify a named branch`);
            }
          }
        }
      }
      if (!VALID_CLASS_KINDS.has(entry.kind)) {
        errors.push(`classes["${className}"].kind "${entry.kind}" is not a recognized kind`);
      }
      if (typeof entry.protected !== "boolean") {
        errors.push(`classes["${className}"].protected must be a boolean`);
      } else if (entry.protected === true) {
        errors.push(`classes["${className}"] declares protected: true, but only namedBranches (long-lived branches) may be protected - a transient/automation class cannot carry a protection expectation`);
      }
    }
  }

  return errors.length === 0
    ? { result: MANIFEST_RESULT.VALID, errors: [] }
    : { result: MANIFEST_RESULT.INVALID, errors };
}

/**
 * Classifies a branch short-name against a manifest. Never throws for any
 * input shape covered by this contract - this includes a malformed
 * `manifest` argument, not just a malformed `branchName`. Precedence is
 * branch-input shape first, then manifest validity, then classification:
 *
 *   1. malformed `branchName` -> `INVALID_INPUT`
 *   2. `branchName` valid, but `manifest` fails `validateManifest()` ->
 *      `INVALID_MANIFEST` (with the validator's own `errors`) - a caller
 *      supplying a custom manifest is never trusted on the strength of its
 *      shape alone; `validateManifest()` is the single structural/semantic
 *      validation authority and this function always consumes its result
 *      rather than re-implementing a partial check.
 *   3. both valid: a name matching zero classes is `UNKNOWN`, a name
 *      matching more than one class is `AMBIGUOUS` (never silently
 *      resolved by object/iteration order) - none of these three, nor
 *      `INVALID_MANIFEST`, ever fall back to a privileged classification.
 *
 * Input contract (deliberately no hidden normalization - see
 * docs/branch-inventory-v1.md "Input contract"): `branchName` must be a
 * short branch name exactly as `git rev-parse --abbrev-ref HEAD` or
 * `git branch --format=%(refname:short)` would print it. A `refs/heads/`
 * or remote-qualified form (e.g. `origin/main`) is NOT stripped and will
 * not match `main` by design - a caller that needs to handle those forms
 * must normalize before calling this function; this function does not
 * guess a caller's intent.
 *
 * @param {unknown} branchName
 * @param {object} [manifest] - defaults to the built-in MANIFEST; any
 *   caller-supplied value is validated, never merely assumed valid
 * @returns {{ status: string, class: string|null, kind: string|null, protected: boolean|null, matches?: string[], errors?: string[] }}
 */
function classifyBranch(branchName, manifest = MANIFEST) {
  if (typeof branchName !== "string" || branchName.length === 0) {
    return { status: CLASSIFY_STATUS.INVALID_INPUT, class: null, kind: null, protected: null };
  }
  if (branchName.includes("refs/") || /\s/.test(branchName)) {
    return { status: CLASSIFY_STATUS.INVALID_INPUT, class: null, kind: null, protected: null };
  }

  const manifestCheck = validateManifest(manifest);
  if (manifestCheck.result !== MANIFEST_RESULT.VALID) {
    return { status: CLASSIFY_STATUS.INVALID_MANIFEST, class: null, kind: null, protected: null, errors: manifestCheck.errors };
  }

  const namedBranches = manifest.namedBranches;
  if (Object.hasOwn(namedBranches, branchName)) {
    const named = namedBranches[branchName];
    return { status: CLASSIFY_STATUS.NAMED, class: branchName, kind: named.kind, protected: named.protected };
  }

  const matches = [];
  for (const [className, entry] of Object.entries(manifest.classes)) {
    if (new RegExp(entry.pattern).test(branchName)) matches.push(className);
  }

  if (matches.length === 0) {
    return { status: CLASSIFY_STATUS.UNKNOWN, class: null, kind: null, protected: null };
  }
  if (matches.length > 1) {
    return { status: CLASSIFY_STATUS.AMBIGUOUS, class: null, kind: null, protected: null, matches };
  }

  const entry = manifest.classes[matches[0]];
  return { status: CLASSIFY_STATUS.CLASSIFIED, class: matches[0], kind: entry.kind, protected: entry.protected };
}

/**
 * Discovers the current branch of `repositoryRoot` via `git` itself
 * (never filesystem assumptions about `.git/` - safe under worktrees,
 * where `.git` is a file, not a directory). `repositoryRoot` is required
 * and explicit - this function never falls back to `process.cwd()`.
 * Detached HEAD is reported explicitly (`detached: true, branch: null`),
 * never silently reported as a branch named "HEAD" or "main".
 *
 * @param {string} repositoryRoot
 * @returns {{ branch: string|null, detached: boolean, error?: string }}
 */
function getCurrentBranch(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    return { branch: null, detached: false, error: "repositoryRoot is required" };
  }
  const { execFileSync } = require("node:child_process");
  let output;
  try {
    // No shell:true - git.exe resolves directly via PATH on Windows
    // without needing .cmd-shim resolution (unlike npm), matching this
    // repository's own established convention for invoking git directly
    // (scripts/ai/collect-context.js's runGit()).
    output = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
  } catch (err) {
    return { branch: null, detached: false, error: err.message };
  }
  if (output === "HEAD") {
    return { branch: null, detached: true };
  }
  return { branch: output, detached: false };
}

function main() {
  const path = require("node:path");
  const repositoryRoot = path.resolve(__dirname, "..", "..");

  const manifestCheck = validateManifest(MANIFEST);
  if (manifestCheck.result !== MANIFEST_RESULT.VALID) {
    process.stderr.write(`branch-inventory: INVALID manifest -\n${manifestCheck.errors.map((e) => `  - ${e}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`branch-inventory: VALID (schemaVersion ${MANIFEST.schemaVersion}, ${Object.keys(MANIFEST.classes).length} classes, defaultBranch "${MANIFEST.defaultBranch}")\n`);

  const current = getCurrentBranch(repositoryRoot);
  if (current.error) {
    process.stdout.write(`branch-inventory: current branch unavailable (${current.error})\n`);
  } else if (current.detached) {
    process.stdout.write("branch-inventory: current HEAD is detached - no branch classification available\n");
  } else {
    const classification = classifyBranch(current.branch, MANIFEST);
    process.stdout.write(`branch-inventory: current branch "${current.branch}" -> ${classification.status}${classification.class ? ` (${classification.class}, ${classification.kind}, protected=${classification.protected})` : ""}\n`);
  }

  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  MANIFEST,
  MANIFEST_RESULT,
  CLASSIFY_STATUS,
  validateManifest,
  classifyBranch,
  getCurrentBranch,
};
