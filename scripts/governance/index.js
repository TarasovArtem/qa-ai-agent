/**
 * GOV-AUTO-1 Wave 0 -- public kernel interface.
 *
 * Internal governance infrastructure; deliberately NOT part of the supported npm
 * package surface (package.json `files` publishes only scripts/ai). Only the
 * interfaces named in docs/gov-auto-1-design-reconciliation-v1.md section 21 are
 * exported: no parser, tokenizer, Git command builder, evidence/premise-graph or
 * matcher internals. Wave 0 is the shared kernel; Wave 1 added the six stage
 * interfaces named for 1A and 1B in section 18 (getGitIdentity, getChangedFiles,
 * checkScope, scanSecrets, parseMarkdown, checkReferences); Wave 2 adds the two
 * named for 1C and 1D (checkEvidenceModel, checkConsistency); Wave 3 adds the
 * one named for 1E (computeDeltaReview); Wave 4 adds the two named for 1F
 * (collectCiEvidence, buildReport) -- Stage 1F is merged on main (PR #196) with
 * post-merge certification evidence reported; GOV-AUTO-1 as a whole is not yet
 * complete. Stage 1G (independent framework validation) is not implemented and
 * is not code.
 */

"use strict";

const contracts = require("./kernel/contracts");
const { validateResultRecord } = require("./kernel/results");
const {
  validateSchemaVersion,
  validateCapabilityId,
  validateSupportedSchemaVersions,
  validateFrameworkMetadata,
  classifySchemaCompatibility,
} = require("./kernel/validation");
const { validateGraph } = require("./kernel/graph");
const { aggregate, checkDomainResultCompleteness, exitCodeFor } = require("./kernel/readiness");
const { revalidateEvidence } = require("./kernel/revalidation");
const { validateManifest, parseManifestText, parseManifestBytes } = require("./kernel/manifest");
const { lexicalResolveWithin, resolveWithinRoot } = require("./safety/path");
const { createProcessRunner, describeProcessResult } = require("./safety/process");
const { redactString, redactValue } = require("./safety/redaction");
const { loadManifestBytes, loadManifestFile } = require("./io/manifest-loader");
const { getGitIdentity } = require("./stages/1a/identity");
const { getChangedFiles } = require("./stages/1a/changed-files");
const { checkScope } = require("./stages/1a/scope");
const { scanSecrets } = require("./stages/1a/secrets");
const { parseMarkdown } = require("./stages/1b/markdown");
const { checkReferences } = require("./stages/1b/check");
const { checkEvidenceModel } = require("./stages/1c/evidence");
const { checkConsistency } = require("./stages/1d/consistency");
const { computeDeltaReview } = require("./stages/1e/delta-review");
const { collectCiEvidence } = require("./stages/1f/ci-evidence");
const { buildReport } = require("./stages/1f/report");

module.exports = Object.freeze({
  // shared frozen contracts
  STATUS: contracts.STATUS,
  STATUS_PRECEDENCE: contracts.STATUS_PRECEDENCE,
  OWNER_STAGES: contracts.OWNER_STAGES,
  READINESS: contracts.READINESS,
  REASON: contracts.REASON,
  GovernanceSafetyError: contracts.GovernanceSafetyError,
  // kernel
  validateResultRecord,
  aggregate,
  checkDomainResultCompleteness,
  exitCodeFor,
  revalidateEvidence,
  validateGraph,
  validateManifest,
  parseManifestText,
  parseManifestBytes,
  validateSchemaVersion,
  validateCapabilityId,
  validateSupportedSchemaVersions,
  validateFrameworkMetadata,
  classifySchemaCompatibility,
  // I/O (manifest only)
  loadManifestBytes,
  loadManifestFile,
  // safety primitives
  lexicalResolveWithin,
  resolveWithinRoot,
  createProcessRunner,
  describeProcessResult,
  redactString,
  redactValue,
  // Wave 1 / 1A repository preflight (owner of Git identity, diff scope, secret scan)
  getGitIdentity,
  getChangedFiles,
  checkScope,
  scanSecrets,
  // Wave 1 / 1B Markdown and reference integrity (single parser; consumes 1A's changed-file set)
  parseMarkdown,
  checkReferences,
  // Wave 2 / 1C evidence and provenance (consumes 1B structure; never re-parses Markdown)
  checkEvidenceModel,
  // Wave 2 / 1D risk / source / method consistency (consumes 1B structure and 1C records)
  checkConsistency,
  // Wave 3 / 1E delta review and protected-input fingerprints (consumes the graph, 1A identity, 1B-1D records)
  computeDeltaReview,
  // Wave 4 / 1F CI evidence and machine-readable reporting (consumes 1A identity and GitHub run metadata; buildReport() aggregates every stage's records via the Wave 0 kernel)
  collectCiEvidence,
  buildReport,
});
