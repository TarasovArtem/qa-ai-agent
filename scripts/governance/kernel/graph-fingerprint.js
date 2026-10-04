"use strict";

// Internal D16 semantic identity. Provenance is deliberately outside this input.
const crypto = require("node:crypto");
const { validateGraph } = require("./graph");
const { canonicalJson } = require("./results");

function semanticGraph(graph) {
  if (!graph || graph.valid !== true || !Array.isArray(graph.domains)) return null;
  const checked = validateGraph(graph.domains);
  if (!checked.valid) return null;
  return checked;
}

function graphFingerprint(graph) {
  const checked = semanticGraph(graph);
  if (checked === null) return null;
  const domains = checked.domains.map((d) => ({
    domainId: d.domainId, enabled: d.enabled, ownerStage: d.ownerStage,
    dependsOn: [...d.dependsOn].sort((a, b) => a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0),
    derivedFrom: d.derivedFrom,
    // Region framing consumes these in declaration order (section 13).
    protectedInputs: d.protectedInputs,
    reviewModes: [...d.reviewModes].sort(),
  })).sort((a, b) => a.domainId < b.domainId ? -1 : a.domainId > b.domainId ? 1 : 0);
  return crypto.createHash("sha256").update(canonicalJson(domains)).digest("hex");
}

module.exports = { graphFingerprint, semanticGraph };
