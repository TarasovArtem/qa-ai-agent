/**
 * `qa-agent requirements check` - baseline, deterministic, provider-free.
 *
 * Composes ONLY the already-public deterministic RTI functions:
 * loadRequirementsFromFile (RTI-2) -> analyzeRequirementsQuality (RTI-3)
 * -> generateTestDesigns for the READY subset (RTI-4) ->
 * buildRequirementTraceability / analyzeRequirementsCoverage (RTI-5).
 * No provider, no #22/#23 module, no repository mutation: the single write
 * is the report under the validated output.dir, through the existing
 * root-anchored safe-write primitive, after the effective report directory
 * itself is authorized against the protected-path policy.
 *
 * Runs in-process: none of these modules (nor their dependencies) reads the
 * provider environment (static proof in the CLI tests).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { loadRequirementsFromFile } = require("../requirements-file");
const { analyzeRequirementsQuality } = require("../requirement-quality");
const { generateTestDesigns } = require("../test-design");
const { buildRequirementTraceability, analyzeRequirementsCoverage } = require("../requirement-traceability");
const { resolveSafeRepositoryWritePath, isCanonicalPathInsideRoot } = require("../context-utils");
const { assertCanonicallyContained, pathsOverlap, toPosixRelative } = require("./paths");
const { configError, inputRefused, authorityRefused } = require("./errors");

const REPORT_KIND = "RequirementsCheckReport";
const REPORT_SCHEMA_VERSION = 1;
const REPORT_DIRECTORY = "requirements";
const REPORT_FILE_NAME = "requirements-check.json";
const REPORT_RELATIVE_PATH = `${REPORT_DIRECTORY}/${REPORT_FILE_NAME}`;

function countBy(items, key) {
  const out = {};
  for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}

function redirectRefused() {
  return authorityRefused(
    "WRITE_TARGET_REFUSED",
    "the report directory resolves outside the repository root or into a protected location (symbolic link or junction redirect)."
  );
}

// Validating output.dir alone is not enough: <output.dir>/requirements can
// itself be a symlink/junction into .git, node_modules, a framework source
// root or the config location. The effective destination is authorized with
// the same canonical containment and protected prefixes as output.dir:
//   1. before any directory is created, every EXISTING component of
//      <output.dir>/requirements must realpath inside the root and outside
//      every protected prefix, so a missing directory can only be created
//      beneath an authorized canonical location, never through a
//      pre-existing redirect;
//   2. the root-anchored safe-write primitive creates missing directories
//      one at a time and refuses a symlinked or non-file leaf;
//   3. immediately before the write, the realpath of the directory actually
//      written to is re-checked (root containment + protected prefixes).
// A redirect planted by a concurrent local writer after step 3 remains the
// pre-existing residual of every path-based write; it is not widened here.
function authorizeReportTarget(root, outputDir, protectedPaths) {
  if (!Array.isArray(protectedPaths) || protectedPaths.length === 0) throw redirectRefused();
  const relativeDir = `${outputDir}/${REPORT_DIRECTORY}`;
  try {
    assertCanonicallyContained(root, relativeDir, "the report directory", { protectedPaths });
  } catch {
    throw redirectRefused();
  }

  let target;
  try {
    target = resolveSafeRepositoryWritePath(path.join(root.realRoot, ...relativeDir.split("/"), REPORT_FILE_NAME), root, "qa-agent requirements check");
  } catch (err) {
    throw authorityRefused("WRITE_TARGET_REFUSED", (err && err.message) || "the report write target was refused.");
  }

  let parent;
  try {
    parent = fs.realpathSync(path.dirname(target));
  } catch {
    throw redirectRefused();
  }
  if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: parent }) || parent === root.realRoot) throw redirectRefused();
  const parentRel = toPosixRelative(root.realRoot, parent);
  if (protectedPaths.some((protectedPath) => pathsOverlap(parentRel, protectedPath))) throw redirectRefused();
  return path.join(parent, path.basename(target));
}

function runRequirementsCheck({ root, config, product, protectedPaths, now = () => new Date() }) {
  if (!config.requirements) {
    throw configError("REQUIREMENTS_NOT_CONFIGURED", "qa-agent.config.json has no requirements section (requirements.source / requirements.path).");
  }

  let requirements;
  let quality;
  let testDesigns;
  let traceability;
  let coverage;
  try {
    requirements = loadRequirementsFromFile({ repositoryRoot: root.realRoot, filePath: config.requirements.path });
    quality = analyzeRequirementsQuality(requirements);
    const ready = requirements.filter((_, i) => quality[i].status === "READY");
    testDesigns = generateTestDesigns(ready);
    traceability = buildRequirementTraceability(requirements, testDesigns);
    coverage = analyzeRequirementsCoverage(requirements, testDesigns);
  } catch (err) {
    throw inputRefused("REQUIREMENTS_INPUT_REFUSED", (err && err.message) || "the requirements input was refused.");
  }

  const summary = {
    requirements: requirements.length,
    qualityStatus: countBy(quality, "status"),
    ready: quality.filter((q) => q.status === "READY").length,
    testDesigns: testDesigns.length,
    coverageStatus: countBy(coverage, "status"),
  };

  const report = {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    product,
    source: { source: "file", path: config.requirements.path },
    summary,
    requirements,
    quality,
    testDesigns,
    traceability,
    coverage,
  };

  const relativeOutput = `${config.output.dir}/${REPORT_RELATIVE_PATH}`;
  const target = authorizeReportTarget(root, config.output.dir, protectedPaths);
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);

  return { summary, artifacts: [relativeOutput] };
}

module.exports = { REPORT_KIND, REPORT_SCHEMA_VERSION, REPORT_RELATIVE_PATH, runRequirementsCheck };
