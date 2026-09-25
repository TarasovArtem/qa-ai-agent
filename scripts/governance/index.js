/**
 * GOV-AUTO-1 Wave 0 -- public kernel interface.
 *
 * Internal governance infrastructure; deliberately NOT part of the supported npm
 * package surface (package.json `files` publishes only scripts/ai). Only the
 * interfaces named in docs/gov-auto-1-design-reconciliation-v1.md section 21 are
 * exported: no parser or token helper internals. Wave 0 contains no repository-
 * specific governance check (no Git identity, diff, Markdown, CI or secret scan).
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
const { runProcess, describeProcessResult } = require("./safety/process");
const { redactString, redactValue } = require("./safety/redaction");
const { loadManifestBytes, loadManifestFile } = require("./io/manifest-loader");

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
  runProcess,
  describeProcessResult,
  redactString,
  redactValue,
});
