/**
 * Loader for QA Knowledge units (scripts/ai/knowledge/units/*.json).
 *
 * Its responsibility is ONLY: locate knowledge-unit JSON files, parse them,
 * validate each one through schema.js, and return the validated units in a
 * deterministic order. Nothing about selection, relevance scoring, prompt
 * formatting, or provider interaction lives here - see Roadmap #15A's
 * architecture (selection is a separate, later component: selector.js,
 * not part of this task). No network calls, no external knowledge
 * retrieval - purely local filesystem I/O.
 *
 * Failure semantics are deliberately loud, not silent (unlike
 * aggregate-browser-context.js's readBrowserInputs(), which intentionally
 * treats a missing/unparseable *browser* input as "no data for that
 * browser" because a browser job can legitimately never upload one). A
 * curated knowledge unit is different: every file under units/ is
 * something a human deliberately committed, so invalid JSON, a
 * schema-invalid unit, or a duplicate id is a real authoring mistake that
 * must be visible during CI/test execution, not quietly skipped - see
 * Roadmap #15's Phase 7.
 *
 * Roadmap FPI-3bA (ProjectKnowledgeConfig consumer wiring): this module
 * also owns the OPTIONAL, additive, project-owned Knowledge corpus a
 * target repository may supply via
 * ProjectKnowledgeConfig.projectKnowledgeUnitsDir (see
 * scripts/ai/project-knowledge-config.js). loadKnowledgeUnits()/
 * DEFAULT_UNITS_DIR remain entirely unchanged and root-independent - the
 * core corpus is this generic core's OWN shipped resource
 * (__dirname-relative), never target-repository configuration.
 * loadProjectKnowledgeUnits() is the new, separate, root-DEPENDENT sibling
 * for the target-owned corpus - see its own comment below for the
 * additional per-file containment re-check it performs that the core
 * loader has never needed (the core units/ directory is trusted shipped
 * content, not externally-supplied target-repository data).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { validateKnowledgeUnit } = require("./schema");
const { isCanonicalPathInsideRoot } = require("../context-utils");

const DEFAULT_UNITS_DIR = path.join(__dirname, "units");

class KnowledgeLoadError extends Error {}

// Only files with a .json extension are treated as knowledge units - the
// same convention collect-context.js's own loadReports() already uses for
// reading a directory of report files. This is an explicit, documented
// loader rule: it lets a non-JSON file (e.g. a future README.md or a
// .gitkeep placeholder keeping the otherwise-empty units/ directory
// tracked by git) sit alongside real units without being mistaken for one.
function isKnowledgeUnitFile(filename) {
  return filename.toLowerCase().endsWith(".json");
}

// Sorted alphabetically by filename so the same directory contents always
// produce the same returned order, regardless of the operating system's or
// filesystem's own directory-enumeration order (the same determinism
// concern DEFAULT_BROWSER_PRIORITY/orderByPriority() solve for browsers in
// aggregate-browser-context.js, applied here to files instead).
function listKnowledgeUnitFiles(unitsDir) {
  if (!fs.existsSync(unitsDir)) return [];
  return fs
    .readdirSync(unitsDir)
    .filter(isKnowledgeUnitFile)
    .sort();
}

// Shared by loadKnowledgeUnits() and loadProjectKnowledgeUnits() below:
// reads one file at an already-resolved absolute path, parses it as JSON,
// and validates it against schema.js. `filename` is only used for
// diagnostics (bounded, path-free - never the full resolved path).
function readKnowledgeUnitFile(fullPath, filename, fileLabel) {
  let raw;
  try {
    raw = fs.readFileSync(fullPath, "utf8");
  } catch (err) {
    throw new KnowledgeLoadError(`Could not read ${fileLabel} file "${filename}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new KnowledgeLoadError(`${fileLabel} file "${filename}" is not valid JSON: ${err.message}`);
  }

  const { valid, errors } = validateKnowledgeUnit(parsed);
  if (!valid) {
    throw new KnowledgeLoadError(
      `${fileLabel} file "${filename}" failed schema validation:\n  - ${errors.join("\n  - ")}`
    );
  }

  return parsed;
}

// Reads every *.json file directly under unitsDir (default:
// scripts/ai/knowledge/units/), validates each one, and returns the
// validated unit objects in deterministic filename order. A missing or
// empty units directory returns [] - not an error, since "no curated
// knowledge exists yet" is an expected, valid state (see Roadmap #15's
// Phase 9: this task deliberately does not ship a production corpus).
// Anything else wrong - unreadable file, invalid JSON, a schema-invalid
// unit, or a duplicate id across two files - throws a KnowledgeLoadError
// immediately rather than skipping the offending file.
//
// Externally observable behavior is byte-identical to before Roadmap
// FPI-3bA's refactor - only the per-file read/parse/validate body moved
// into the shared readKnowledgeUnitFile() helper above.
function loadKnowledgeUnits(unitsDir = DEFAULT_UNITS_DIR) {
  const filenames = listKnowledgeUnitFiles(unitsDir);
  const units = [];
  const seenIds = new Map(); // id -> filename it was first seen in

  for (const filename of filenames) {
    const fullPath = path.join(unitsDir, filename);
    const parsed = readKnowledgeUnitFile(fullPath, filename, "Knowledge unit");

    if (seenIds.has(parsed.id)) {
      throw new KnowledgeLoadError(
        `Duplicate knowledge unit id "${parsed.id}": defined in both "${seenIds.get(parsed.id)}" and "${filename}"`
      );
    }
    seenIds.set(parsed.id, filename);

    units.push(parsed);
  }

  return units;
}

// Roadmap FPI-3bA: loads the OPTIONAL, additive, project-owned Knowledge
// corpus named by a validated ProjectKnowledgeConfig.projectKnowledgeUnitsDir
// candidate. `unitsDir` MUST already be a canonically-authorized absolute
// directory path - see context-utils.js's resolveRepositoryLocalPath(),
// which the caller (analyze-failure.js) applies BEFORE calling this
// function, exactly mirroring cypress-adapter.js's own
// resolveFrameworkRuntimeConfigLayout()/collect() division of labor
// (identity/shape resolved by the caller, directory-level containment via
// the shared context-utils.js primitive, per-file containment here).
//
// Unlike the core corpus (this generic core's own shipped, non-root-
// relative resource), this directory lives inside the externally-supplied,
// untrusted target repository, so every discovered file gets an
// additional canonical containment re-check against root.realRoot before
// it is ever read - the same "a validated parent directory does not
// authorize an unverified child" rule cypress-adapter.js's own R-7/R-8
// lesson already established for report/attachment discovery. A missing
// `unitsDir` (resolveRepositoryLocalPath() already allows a
// lexically-contained candidate that simply doesn't exist yet) naturally
// returns [] here via listKnowledgeUnitFiles()'s own existing
// fs.existsSync() guard - "declared but not yet created" is not an error.
function loadProjectKnowledgeUnits(unitsDir, root) {
  const filenames = listKnowledgeUnitFiles(unitsDir);
  const units = [];
  const seenIds = new Map();

  for (const filename of filenames) {
    const fullPath = path.join(unitsDir, filename);

    let real;
    try {
      real = fs.realpathSync(fullPath);
    } catch (err) {
      throw new KnowledgeLoadError(`Could not read project knowledge unit file "${filename}": ${err.message}`);
    }
    if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) {
      throw new KnowledgeLoadError(
        `Project knowledge unit file "${filename}" escapes the trusted repository root.`
      );
    }

    const parsed = readKnowledgeUnitFile(real, filename, "Project knowledge unit");

    if (seenIds.has(parsed.id)) {
      throw new KnowledgeLoadError(
        `Duplicate project knowledge unit id "${parsed.id}": defined in both "${seenIds.get(parsed.id)}" and "${filename}"`
      );
    }
    seenIds.set(parsed.id, filename);

    units.push(parsed);
  }

  return units;
}

// Roadmap FPI-3bA: composes the core corpus with an OPTIONAL, additive
// project-owned corpus returned by loadProjectKnowledgeUnits() - never a
// replacement (see ProjectKnowledgeConfig's own "additive" contract,
// project-knowledge-config.js). A knowledge unit id present in BOTH
// sources is a real authoring mistake, not a shadow/override - this
// extends loadKnowledgeUnits()'s own existing within-directory duplicate-id
// policy across the core/project boundary, using the same loud
// KnowledgeLoadError convention.
function composeKnowledgeUnits(coreUnits, projectUnits) {
  if (projectUnits.length === 0) return coreUnits;

  const coreIdOwners = new Map(coreUnits.map((unit) => [unit.id, unit]));
  for (const unit of projectUnits) {
    if (coreIdOwners.has(unit.id)) {
      throw new KnowledgeLoadError(
        `Duplicate knowledge unit id "${unit.id}": defined in both the core knowledge corpus and the project knowledge corpus`
      );
    }
  }

  return [...coreUnits, ...projectUnits];
}

module.exports = {
  loadKnowledgeUnits,
  loadProjectKnowledgeUnits,
  composeKnowledgeUnits,
  KnowledgeLoadError,
  DEFAULT_UNITS_DIR,
};
