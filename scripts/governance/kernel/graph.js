/**
 * GOV-AUTO-1 Wave 0 -- domain declaration schema and dependency graph
 * validation (design sections 8, 9). Pure: no I/O, no clock, no input mutation.
 *
 * The graph must be a DAG. Cycles are a CONFIGURATION_ERROR (no justification
 * mechanism, no fixpoint). Every declaration key is mandatory, and an explicit
 * empty array is the only way to declare "no dependencies": absence is never
 * defaulted to []. Transitive invalidation itself belongs to Wave 3 (1E); this
 * module only validates the graph and exposes a stable topological order.
 */

"use strict";

const {
  REASON,
  STATUS,
  OWNER_STAGES,
  EDGE_KINDS,
  REVIEW_MODES,
  LIMITS,
  deepFreeze,
} = require("./contracts");
const { isPlainObject } = require("./validation");

const DOMAIN_ID = /^[A-Z][A-Z0-9_]{1,63}$/;
const DOMAIN_KEYS = ["domainId", "enabled", "ownerStage", "dependsOn", "derivedFrom", "protectedInputs", "reviewModes"];
const EXECUTABLE_STAGES = OWNER_STAGES.filter((s) => s !== "KERNEL");

function finding(reasonCode, path, detail, domainId) {
  const f = { reasonCode, path, detail };
  if (domainId !== undefined) f.domainId = domainId;
  return f;
}

function hasControlChars(value) {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(value);
}

/** Validate one declaration; returns a normalized copy or null (findings pushed). */
function validateDomain(entry, index, findings) {
  const path = `$[${index}]`;
  if (!isPlainObject(entry)) {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, path, "domain declaration must be an object"));
    return null;
  }
  const before = findings.length;
  const label = typeof entry.domainId === "string" && DOMAIN_ID.test(entry.domainId) ? entry.domainId : undefined;
  for (const key of Object.keys(entry)) {
    if (!DOMAIN_KEYS.includes(key)) findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.${key}`, "unknown field", label));
  }
  if (typeof entry.domainId !== "string" || !DOMAIN_ID.test(entry.domainId)) {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.domainId`, "invalid domainId"));
  }
  if (typeof entry.enabled !== "boolean") {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.enabled`, "enabled must be a boolean", label));
  }
  if (typeof entry.ownerStage !== "string" || !EXECUTABLE_STAGES.includes(entry.ownerStage)) {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.ownerStage`, "invalid ownerStage", label));
  }

  // dependsOn: mandatory; an explicit [] is valid, absence is not.
  const edges = [];
  if (!Object.hasOwn(entry, "dependsOn")) {
    findings.push(finding(REASON.DEPENDENCY_DECLARATION_MISSING, `${path}.dependsOn`, "dependsOn is required (use an explicit [])", label));
  } else if (!Array.isArray(entry.dependsOn) || entry.dependsOn.length > LIMITS.maxArrayLength) {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.dependsOn`, "dependsOn must be a bounded array", label));
  } else {
    const targets = new Set();
    entry.dependsOn.forEach((edge, i) => {
      const ePath = `${path}.dependsOn[${i}]`;
      if (!isPlainObject(edge) || Object.keys(edge).some((k) => k !== "domain" && k !== "kind")) {
        findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, ePath, "edge must be exactly {domain, kind}", label));
        return;
      }
      if (typeof edge.domain !== "string" || !DOMAIN_ID.test(edge.domain)) {
        findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${ePath}.domain`, "invalid dependency domainId", label));
        return;
      }
      if (typeof edge.kind !== "string" || !EDGE_KINDS.includes(edge.kind)) {
        findings.push(finding(REASON.DEPENDENCY_KIND_INVALID, `${ePath}.kind`, "unknown dependency kind", label));
        return;
      }
      if (edge.domain === entry.domainId) {
        findings.push(finding(REASON.DEPENDENCY_SELF, ePath, "self-dependency", label));
        return;
      }
      if (targets.has(edge.domain)) {
        findings.push(finding(REASON.DEPENDENCY_EDGE_DUPLICATE, ePath, "duplicate edge to the same domain", label));
        return;
      }
      targets.add(edge.domain);
      edges.push({ domain: edge.domain, kind: edge.kind });
    });
  }

  // derivedFrom: mandatory; domain-typed selectors must also be in dependsOn.
  const derived = [];
  if (!Object.hasOwn(entry, "derivedFrom")) {
    findings.push(finding(REASON.DEPENDENCY_DECLARATION_MISSING, `${path}.derivedFrom`, "derivedFrom is required (use an explicit [])", label));
  } else if (!Array.isArray(entry.derivedFrom) || entry.derivedFrom.length > LIMITS.maxArrayLength) {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.derivedFrom`, "derivedFrom must be a bounded array", label));
  } else {
    entry.derivedFrom.forEach((src, i) => {
      const sPath = `${path}.derivedFrom[${i}]`;
      if (isPlainObject(src) && src.type === "DOMAIN" && Object.keys(src).length === 2 && typeof src.domain === "string" && DOMAIN_ID.test(src.domain)) {
        if (!edges.some((e) => e.domain === src.domain)) {
          findings.push(finding(REASON.DERIVED_FROM_NOT_IN_DEPENDS_ON, sPath, "derivedFrom domain is not declared in dependsOn", label));
        }
        derived.push({ type: "DOMAIN", domain: src.domain });
      } else if (
        isPlainObject(src) && src.type === "SOURCE" && Object.keys(src).length === 2 &&
        typeof src.selector === "string" && src.selector.length > 0 && src.selector.length <= 512 && !hasControlChars(src.selector)
      ) {
        derived.push({ type: "SOURCE", selector: src.selector });
      } else {
        findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, sPath, "derivedFrom entry must be {type:DOMAIN,domain} or {type:SOURCE,selector}", label));
      }
    });
  }

  // protectedInputs / reviewModes.
  const inputs = [];
  if (!Object.hasOwn(entry, "protectedInputs")) {
    findings.push(finding(REASON.DEPENDENCY_DECLARATION_MISSING, `${path}.protectedInputs`, "protectedInputs is required", label));
  } else if (!Array.isArray(entry.protectedInputs) || entry.protectedInputs.length > LIMITS.maxArrayLength) {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.protectedInputs`, "protectedInputs must be a bounded array", label));
  } else {
    const seen = new Set();
    entry.protectedInputs.forEach((sel, i) => {
      if (typeof sel !== "string" || sel.length === 0 || sel.length > 512 || hasControlChars(sel) || seen.has(sel)) {
        findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.protectedInputs[${i}]`, "invalid or duplicate selector", label));
      } else {
        seen.add(sel);
        inputs.push(sel);
      }
    });
  }
  const modes = [];
  if (!Object.hasOwn(entry, "reviewModes")) {
    findings.push(finding(REASON.DEPENDENCY_DECLARATION_MISSING, `${path}.reviewModes`, "reviewModes is required", label));
  } else if (!Array.isArray(entry.reviewModes) || entry.reviewModes.length === 0 || entry.reviewModes.length > REVIEW_MODES.length) {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.reviewModes`, "reviewModes must be a non-empty subset", label));
  } else {
    const seen = new Set();
    entry.reviewModes.forEach((mode, i) => {
      if (typeof mode !== "string" || !REVIEW_MODES.includes(mode) || seen.has(mode)) {
        findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.reviewModes[${i}]`, "invalid or duplicate review mode", label));
      } else {
        seen.add(mode);
        modes.push(mode);
      }
    });
    if (modes.includes("PRESERVATION_CHECK_ONLY") && Array.isArray(entry.protectedInputs) && entry.protectedInputs.length === 0) {
      findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, `${path}.reviewModes`, "PRESERVATION_CHECK_ONLY requires non-empty protectedInputs", label));
    }
  }

  if (findings.length > before) return null;
  return {
    domainId: entry.domainId,
    enabled: entry.enabled,
    ownerStage: entry.ownerStage,
    dependsOn: edges,
    derivedFrom: derived,
    protectedInputs: inputs,
    reviewModes: modes,
  };
}

/** Tarjan strongly connected components over the given adjacency (sorted ids). */
function stronglyConnectedComponents(ids, adjacency) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  function visit(v) {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) || []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component.sort());
    }
  }
  for (const id of ids) if (!index.has(id)) visit(id);
  return components;
}

/** Deterministic Kahn ordering (ties broken by domainId), dependencies first. */
function topologicalOrder(enabledIds, dependenciesOf) {
  const remaining = new Map(enabledIds.map((id) => [id, new Set(dependenciesOf.get(id).filter((d) => enabledIds.includes(d)))]));
  const order = [];
  while (remaining.size > 0) {
    const ready = [...remaining.keys()].filter((id) => remaining.get(id).size === 0).sort();
    if (ready.length === 0) return null;
    const next = ready[0];
    order.push(next);
    remaining.delete(next);
    for (const deps of remaining.values()) deps.delete(next);
  }
  return order;
}

/**
 * Validate the domain declarations as a graph. Returns a frozen result:
 * { valid, status, findings, domains, topologicalOrder }. Every violation is a
 * CONFIGURATION_ERROR finding; nothing is silently repaired or deduplicated.
 */
function validateGraph(input) {
  const findings = [];
  if (!Array.isArray(input) || input.length > LIMITS.maxDomains) {
    findings.push(finding(REASON.DOMAIN_DECLARATION_INVALID, "$", "domains must be a bounded array"));
    return deepFreeze({ valid: false, status: STATUS.CONFIGURATION_ERROR, findings, domains: [], topologicalOrder: null });
  }
  const normalized = [];
  input.forEach((entry, index) => {
    const domain = validateDomain(entry, index, findings);
    if (domain) normalized.push(domain);
  });

  const byId = new Map();
  const duplicated = new Set();
  for (const d of normalized) {
    if (byId.has(d.domainId)) duplicated.add(d.domainId);
    else byId.set(d.domainId, d);
  }
  for (const id of [...duplicated].sort()) findings.push(finding(REASON.DOMAIN_DUPLICATE, "$", "duplicate domainId", id));

  for (const d of normalized) {
    if (duplicated.has(d.domainId)) continue;
    for (const edge of d.dependsOn) {
      const target = byId.get(edge.domain);
      if (!target) {
        findings.push(finding(REASON.DEPENDENCY_UNKNOWN, "$", `unknown dependency ${edge.domain}`, d.domainId));
      } else if (d.enabled && !target.enabled) {
        findings.push(finding(REASON.DEPENDENCY_DISABLED, "$", `dependency on disabled domain ${edge.domain}`, d.domainId));
      }
    }
  }

  const ids = [...byId.keys()].sort();
  const adjacency = new Map(ids.map((id) => [id, byId.get(id).dependsOn.map((e) => e.domain).filter((t) => byId.has(t)).sort()]));
  for (const component of stronglyConnectedComponents(ids, adjacency)) {
    if (component.length >= 2) findings.push(finding(REASON.DEPENDENCY_CYCLE, "$", `dependency cycle among ${component.join(",")}`, component[0]));
  }

  let order = null;
  if (findings.length === 0) {
    const enabledIds = ids.filter((id) => byId.get(id).enabled);
    order = topologicalOrder(enabledIds, adjacency);
  }
  const valid = findings.length === 0;
  return deepFreeze({
    valid,
    status: valid ? STATUS.PASS : STATUS.CONFIGURATION_ERROR,
    findings,
    domains: valid ? normalized : [],
    topologicalOrder: valid ? order : null,
  });
}

module.exports = { validateGraph, DOMAIN_ID };
