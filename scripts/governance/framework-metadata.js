/**
 * GOV-AUTO-1 -- framework capability metadata (design section 14, "Framework
 * availability", and design decision D15). This describes what THIS checkout of
 * the framework supports. It is meaningful as a statement about the protected
 * target only when read from the target tip: a reviewed head can never use its
 * own copy of this file to claim capability for itself (no self-validation).
 *
 * D15 fixes the canonical stage capability identities (one per executable stage
 * 1A-1F, all major @1, listed in stage order; 1G has none) and the framework
 * release identity "0.5.0" for the implemented 1A-1F framework. frameworkVersion
 * is a human-governed release identity only: compatibility is decided solely by
 * exact `capability-id@major` membership in supportedCapabilities[] together with
 * the separately validated supportedSchemaVersions range, never by comparing
 * versions. A breaking semantic change mints a new major through a reviewed
 * design decision (the constants below are then a governed, human-reviewed
 * change).
 */

"use strict";

const { deepFreeze } = require("./kernel/contracts");

const CAPABILITY_REPOSITORY_PREFLIGHT = "repository-preflight@1";
const CAPABILITY_MARKDOWN_REFERENCE_INTEGRITY = "markdown-reference-integrity@1";
const CAPABILITY_EVIDENCE_PROVENANCE_VALIDATION = "evidence-provenance-validation@1";
const CAPABILITY_RISK_SOURCE_METHOD_CONSISTENCY = "risk-source-method-consistency@1";
const CAPABILITY_DEPENDENCY_AWARE_DELTA = "dependency-aware-delta@1";
const CAPABILITY_CI_EVIDENCE_REPORTING = "ci-evidence-reporting@1";

const FRAMEWORK_METADATA = deepFreeze({
  frameworkVersion: "0.5.0",
  supportedCapabilities: [
    CAPABILITY_REPOSITORY_PREFLIGHT,
    CAPABILITY_MARKDOWN_REFERENCE_INTEGRITY,
    CAPABILITY_EVIDENCE_PROVENANCE_VALIDATION,
    CAPABILITY_RISK_SOURCE_METHOD_CONSISTENCY,
    CAPABILITY_DEPENDENCY_AWARE_DELTA,
    CAPABILITY_CI_EVIDENCE_REPORTING,
  ],
  // Schema range of the repository base policy (governance/base.json) and of the
  // gate manifest. Unchanged by D15 (schemaVersion 1 only).
  supportedSchemaVersions: { minSupported: 1, maxSupported: 1 },
});

module.exports = {
  FRAMEWORK_METADATA,
  CAPABILITY_REPOSITORY_PREFLIGHT,
  CAPABILITY_MARKDOWN_REFERENCE_INTEGRITY,
  CAPABILITY_EVIDENCE_PROVENANCE_VALIDATION,
  CAPABILITY_RISK_SOURCE_METHOD_CONSISTENCY,
  CAPABILITY_DEPENDENCY_AWARE_DELTA,
  CAPABILITY_CI_EVIDENCE_REPORTING,
};
