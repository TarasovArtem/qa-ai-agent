/**
 * GOV-AUTO-1 Wave 0 -- manifest schema validation (design sections 14, 15, 20).
 *
 * load / validate / use are separate steps:
 *   - load:     bytes from a file (io/manifest-loader.js, bounded);
 *   - decode + parse: `parseManifestBytes` / `parseManifestText` (strict UTF-8,
 *     strict JSON, duplicate keys and depth rejected, raw number tokens kept);
 *   - validate: `validateManifest` is pure over the parsed tree;
 *   - use:      callers consume only the frozen, normalized `manifest`.
 * The manifest is repository input and untrusted: unknown fields, wrong types
 * and a non-lexical schemaVersion are rejected, nothing is coerced or defaulted,
 * and the manifest is never executed, imported or sourced.
 *
 * Wave 0 defines only the kernel-level manifest fields. Later waves extend the
 * (versioned) schema with repository-specific fields.
 */

"use strict";

const { REASON, STATUS, LIMITS, deepFreeze } = require("./contracts");
const { isPlainObject, validateSchemaVersion, validateCapabilityId } = require("./validation");
const { validateGraph } = require("./graph");
const { parseStrictJson } = require("./json-strict");

const MANIFEST_KEYS = ["schemaVersion", "gateId", "requiredCapabilities", "domains"];
const GATE_ID = /^[a-z][a-z0-9-]{1,63}$/;

function finding(reasonCode, path, detail) {
  return { reasonCode, path, detail };
}

/** Pure validation of a tree produced by the strict parser. */
function validateManifest(tree) {
  const findings = [];
  if (!isPlainObject(tree)) {
    findings.push(finding(REASON.MANIFEST_TYPE_INVALID, "$", "manifest must be an object"));
    return deepFreeze({ valid: false, status: STATUS.CONFIGURATION_ERROR, findings, manifest: null });
  }
  for (const key of Object.keys(tree)) {
    if (!MANIFEST_KEYS.includes(key)) findings.push(finding(REASON.MANIFEST_UNKNOWN_FIELD, `$.${key}`, "unknown field"));
  }

  const version = validateSchemaVersion(tree.schemaVersion);
  if (!version.ok) findings.push(finding(version.reasonCode, "$.schemaVersion", "schemaVersion is missing or not a positive integer token"));

  if (!Object.hasOwn(tree, "gateId")) findings.push(finding(REASON.MANIFEST_FIELD_MISSING, "$.gateId", "gateId is required"));
  else if (typeof tree.gateId !== "string" || !GATE_ID.test(tree.gateId)) findings.push(finding(REASON.MANIFEST_TYPE_INVALID, "$.gateId", "invalid gateId"));

  const capabilities = [];
  if (!Object.hasOwn(tree, "requiredCapabilities")) {
    findings.push(finding(REASON.MANIFEST_FIELD_MISSING, "$.requiredCapabilities", "requiredCapabilities is required (use an explicit [])"));
  } else if (!Array.isArray(tree.requiredCapabilities) || tree.requiredCapabilities.length > LIMITS.maxArrayLength) {
    findings.push(finding(REASON.MANIFEST_TYPE_INVALID, "$.requiredCapabilities", "requiredCapabilities must be a bounded array"));
  } else {
    const seen = new Set();
    tree.requiredCapabilities.forEach((entry, i) => {
      const parsed = validateCapabilityId(entry);
      if (!parsed.ok) findings.push(finding(REASON.CAPABILITY_ID_INVALID, `$.requiredCapabilities[${i}]`, "invalid capability identity"));
      else if (seen.has(parsed.id)) findings.push(finding(REASON.MANIFEST_TYPE_INVALID, `$.requiredCapabilities[${i}]`, "duplicate capability identity"));
      else {
        seen.add(parsed.id);
        capabilities.push(parsed.id);
      }
    });
  }

  let graph = null;
  if (!Object.hasOwn(tree, "domains")) {
    findings.push(finding(REASON.MANIFEST_FIELD_MISSING, "$.domains", "domains is required"));
  } else {
    graph = validateGraph(tree.domains);
    for (const f of graph.findings) findings.push({ ...f, path: `$.domains${f.path === "$" ? "" : f.path.slice(1)}` });
  }

  if (findings.length > 0) return deepFreeze({ valid: false, status: STATUS.CONFIGURATION_ERROR, findings, manifest: null });
  return deepFreeze({
    valid: true,
    status: STATUS.PASS,
    findings: [],
    manifest: {
      schemaVersion: version.value,
      gateId: tree.gateId,
      requiredCapabilities: capabilities,
      domains: graph.domains,
      topologicalOrder: graph.topologicalOrder,
    },
  });
}

function invalidResult(reasonCode, detail) {
  return deepFreeze({ valid: false, status: STATUS.CONFIGURATION_ERROR, findings: [finding(reasonCode, "$", detail)], manifest: null });
}

/** Parse strict JSON text and validate the result. */
function parseManifestText(text) {
  const parsed = parseStrictJson(text);
  if (!parsed.ok) return invalidResult(parsed.reasonCode, "manifest is not acceptable JSON");
  return validateManifest(parsed.value);
}

/** Decode bounded, strictly valid UTF-8 bytes (a BOM is not accepted) and validate. */
function parseManifestBytes(bytes, maxBytes = LIMITS.maxManifestBytes) {
  if (!(bytes instanceof Uint8Array)) return invalidResult(REASON.MANIFEST_TYPE_INVALID, "manifest input must be bytes");
  if (bytes.length > maxBytes) return invalidResult(REASON.MANIFEST_TOO_LARGE, "manifest exceeds the size limit");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return invalidResult(REASON.INVALID_MANIFEST_ENCODING, "manifest is not valid UTF-8");
  }
  return parseManifestText(text);
}

module.exports = { validateManifest, parseManifestText, parseManifestBytes };
