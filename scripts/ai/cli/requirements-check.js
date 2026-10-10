/**
 * `qa-agent requirements check` - baseline, deterministic, provider-free.
 *
 * Composes ONLY the already-public deterministic RTI functions:
 * loadRequirementsFromFile (RTI-2) -> analyzeRequirementsQuality (RTI-3)
 * -> generateTestDesigns for the READY subset (RTI-4) ->
 * buildRequirementTraceability / analyzeRequirementsCoverage (RTI-5).
 * No provider, no #22/#23 module, no repository mutation: the single write
 * is the report under the validated output.dir, through the existing
 * root-anchored safe-write primitive.
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
const { resolveSafeRepositoryWritePath } = require("../context-utils");
const { configError, inputRefused, authorityRefused } = require("./errors");

const REPORT_KIND = "RequirementsCheckReport";
const REPORT_SCHEMA_VERSION = 1;
const REPORT_RELATIVE_PATH = "requirements/requirements-check.json";

function countBy(items, key) {
  const out = {};
  for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}

function runRequirementsCheck({ root, config, product, now = () => new Date() }) {
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
  let target;
  try {
    target = resolveSafeRepositoryWritePath(path.join(root.realRoot, ...relativeOutput.split("/")), root, "qa-agent requirements check");
  } catch (err) {
    throw authorityRefused("WRITE_TARGET_REFUSED", (err && err.message) || "the report write target was refused.");
  }
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);

  return { summary, artifacts: [relativeOutput] };
}

module.exports = { REPORT_KIND, REPORT_SCHEMA_VERSION, REPORT_RELATIVE_PATH, runRequirementsCheck };
