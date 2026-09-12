/**
 * qa-ai-agent public programmatic API (Roadmap ID-1, Package Boundary /
 * Public Programmatic API).
 *
 * This is the ONE supported entrypoint external consumers should import -
 * `require("qa-ai-agent")` once this package is actually installed
 * (Roadmap ID-2 proves that; this module only establishes the boundary
 * itself). It is a thin barrel: it re-exports an intentionally minimal
 * set of pre-existing, already-validated, already-root-injected symbols,
 * unchanged in behavior - it adds no business logic, no target detection,
 * no config discovery, and no new filesystem authority of its own.
 *
 * SCOPE OF THIS EXPORT LIST (deliberately minimal - every symbol below is
 * a future compatibility commitment):
 *
 *   collectContext / collectHistory / analyzeFailure /
 *   aggregateBrowserContext - the four generic CI-triage pipeline
 *   entrypoints (each already accepts explicit, validated, root-anchored
 *   input per Roadmap FPI-2/FPI-3/FPI-4 - see each module's own
 *   docstring). Namespaced by module (matching the exact shape a target
 *   already gets from `require("../../ai/<module>")` today - see
 *   scripts/targets/targomo/**, scripts/targets/project-b/**, both
 *   unchanged by this roadmap stage) rather than flattened, since all four
 *   modules export a function literally named `main`.
 *
 *   assertValidProjectProfile / assertValidFrameworkRuntimeConfig /
 *   assertValidProjectKnowledgeConfig / assertValidRepositoryRoot - the
 *   four FPI-1/FPI-2 fail-closed validators a target needs to construct
 *   its own ProjectProfile/FrameworkRuntimeConfig/ProjectKnowledgeConfig/
 *   repositoryRoot safely (see e.g. scripts/targets/project-b/*.js's own
 *   "self-check at module load" convention, unchanged by this roadmap
 *   stage) - never redefined or wrapped here, just re-exported by
 *   reference.
 *
 *   assertValidRequirementArtifact - the RTI-1 fail-closed validator for
 *   the normalized, source-independent RequirementArtifact contract (see
 *   scripts/ai/requirement-artifact.js's own docstring). Added by Roadmap
 *   RTI-1; this is the target's construction/validation seam for a future
 *   consumer, exactly mirroring the existing four validators' own role.
 *
 *   loadRequirementsFromFile - the RTI-2 file-source adapter: reads a
 *   target-owned, explicitly-authorized JSON requirements file and returns
 *   validated RequirementArtifact[] (see scripts/ai/requirements-file.js's
 *   own docstring for the full file schema and filesystem-authority
 *   contract). Added by Roadmap RTI-2; no other source adapter (Markdown,
 *   YAML, PDF, DOCX, or any external issue-tracker integration) is exported
 *   here yet.
 *
 * DELIBERATELY NOT EXPORTED (internal implementation detail, never a
 * target-facing need - see the ID-1 planning report's own public-API
 * audit for the evidence this is based on):
 *
 *   - adapters (cypressAdapter/playwrightAdapter) and
 *     runtime-framework-selector.js's selectRuntimeAdapter() - a target
 *     that wants explicit (non-QA_FRAMEWORK-env-driven) framework
 *     selection already has that seam via collectContext.main({ adapter,
 *     ... }) internally-selected defaults, or via QA_FRAMEWORK +
 *     collectContext.runCli({ ..., adapterOptions }) (Roadmap ID-1 closed
 *     the one real gap that previously forced a bypass here - see
 *     collect-context.js's own runCli() docstring). Exposing the raw
 *     adapter objects/selector was evaluated and rejected: it would only
 *     ever be needed to hand-pick an adapter object, which runCli()'s own
 *     QA_FRAMEWORK-driven selection (the SAME mechanism collect-history.js
 *     already exclusively relies on) already covers without any new
 *     public surface.
 *   - context-utils.js / write-authority internals, knowledge loader/
 *     selector/schema internals, provider implementation modules,
 *     report-builder internals (buildFailureReport, runProviderAnalysis,
 *     etc.), evaluation/ tooling, test helpers, fixtures - all remain
 *     private implementation detail a target never needs to import
 *     directly.
 *   - Targomo/Project B's own concrete ProjectProfile/FrameworkRuntimeConfig/
 *     ProjectKnowledgeConfig instances - those are THIS development
 *     repository's own dogfood targets, never part of the distributed
 *     product (see scripts/targets/targomo/**, scripts/targets/project-b/**,
 *     both untouched by this roadmap stage).
 */

"use strict";

const collectContext = require("./collect-context");
const collectHistory = require("./collect-history");
const analyzeFailure = require("./analyze-failure");
const aggregateBrowserContext = require("./aggregate-browser-context");
const { assertValidProjectProfile } = require("./project-profile");
const { assertValidFrameworkRuntimeConfig } = require("./framework-runtime-config");
const { assertValidProjectKnowledgeConfig } = require("./project-knowledge-config");
const { assertValidRepositoryRoot } = require("./repository-root");
const { assertValidRequirementArtifact } = require("./requirement-artifact");
const { loadRequirementsFromFile } = require("./requirements-file");

module.exports = {
  collectContext: { main: collectContext.main, runCli: collectContext.runCli },
  collectHistory: { main: collectHistory.main },
  analyzeFailure: { main: analyzeFailure.main },
  aggregateBrowserContext: { main: aggregateBrowserContext.main },
  assertValidProjectProfile,
  assertValidFrameworkRuntimeConfig,
  assertValidProjectKnowledgeConfig,
  assertValidRepositoryRoot,
  assertValidRequirementArtifact,
  loadRequirementsFromFile,
};
