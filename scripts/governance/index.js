/**
 * GOV-AUTO-1 Wave 0 -- public kernel interface.
 *
 * Internal governance infrastructure; deliberately NOT part of the supported npm
 * package surface (package.json `files` publishes only scripts/ai). Only the
 * interfaces named in docs/gov-auto-1-design-reconciliation-v1.md section 21 are
 * exported: no parser, tokenizer, Git command builder or matcher internals. Wave 0
 * is the shared kernel; Wave 1 adds the six stage interfaces named for 1A and 1B in
 * section 18 (getGitIdentity, getChangedFiles, checkScope, scanSecrets,
 * parseMarkdown, checkReferences). There is still no CI-evidence, delta-review or
 * report-writing code (1C..1G are not implemented).
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
const { validateManifest, parseManifestText, parseManifestBytes } = require("./kernel/manifest");
const { lexicalResolveWithin, resolveWithinRoot } = require("./safety/path");
const { createProcessRunner, describeProcessResult } = require("./safety/process");
const { redactString, redactValue } = require("./safety/redaction");
const { loadManifestBytes, loadManifestFile } = require("./io/manifest-loader");
const { getGitIdentity } = require("./stages/1a/identity");
const { getChangedFiles } = require("./stages/1a/changed-files");
const { checkScope } = require("./stages/1a/scope");
const { scanSecrets } = require("./stages/1a/secrets");

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
});
