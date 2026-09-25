/**
 * GOV-AUTO-1 -- framework capability metadata (design section 14, "Framework
 * availability"). This describes what THIS checkout of the framework supports.
 * It is meaningful as a statement about the protected target only when read from
 * the target tip: a reviewed head can never use its own copy of this file to
 * claim capability for itself (no self-validation). Wave 1 adds two capabilities
 * on top of the Wave 0 kernel; it introduces no new manifest schema major.
 *
 * Capability identity is `capability-id@major`; a breaking semantic change mints
 * a new major (the constants below are then a governed, human-reviewed change).
 */

"use strict";

const { deepFreeze } = require("./kernel/contracts");

const CAPABILITY_REPOSITORY_PREFLIGHT = "repository-preflight@1";
const CAPABILITY_MARKDOWN_REFERENCE_INTEGRITY = "markdown-reference-integrity@1";

const FRAMEWORK_METADATA = deepFreeze({
  frameworkVersion: "0.2.0",
  supportedCapabilities: [CAPABILITY_REPOSITORY_PREFLIGHT, CAPABILITY_MARKDOWN_REFERENCE_INTEGRITY],
  // Schema range of the repository base policy (governance/base.json) and of the
  // gate manifest. The Wave 0 gate manifest schema is unchanged (schemaVersion 1).
  supportedSchemaVersions: { minSupported: 1, maxSupported: 1 },
});

module.exports = { FRAMEWORK_METADATA, CAPABILITY_REPOSITORY_PREFLIGHT, CAPABILITY_MARKDOWN_REFERENCE_INTEGRITY };
