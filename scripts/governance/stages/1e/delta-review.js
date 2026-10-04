/**
 * GOV-AUTO-1 Wave 3 / 1E -- delta review: domain change model, transitive
 * dependency-aware invalidation, `PRESERVATION_CHECK_ONLY` eligibility, and
 * fingerprints (design sections 10-13). Public interface: `computeDeltaReview()`.
 *
 * 1E consumes, and never recomputes: the validated domain graph (Wave 0
 * `kernel/graph.js#validateGraph()`), `1A` Git identity and the changed-file
 * set, `1B`-`1D` result records, and Git object content through the same
 * `1A`-owned reader primitive `1B` already uses (`stages/head-reader.js`,
 * built on `stages/1a/git-adapter.js`). It does not derive Git identity, does
 * not re-parse Markdown for semantic integrity, does not re-run evidence or
 * consistency logic, and never lowers the review class copied into its input.
 *
 * A fingerprint match means UNCHANGED, never correct, safe, secure or
 * approved. `PRESERVATION_CHECK_ONLY` and `DEEP_REVIEW_REQUIRED` both map to
 * record status `PASS` (they scope reviewer effort, not a verdict);
 * `HUMAN_REVIEW_REQUIRED` is an unresolved human determination the report
 * never marks resolved. No field here is, or ever will be, a merge-authority
 * verdict (`safeToMerge` and similar are never introduced).
 *
 * Trust boundary (avoids repeating the Wave 2 C1/C2 gap): `computeDeltaReview()`
 * is a public internal framework interface a caller can construct input for by
 * hand. Every input is runtime-validated before use -- the graphs, the
 * consumed 1B-1D records (each individually checked for shape, ownerStage and
 * exact subject match before its status is trusted; an unrecognized status
 * fails closed), and the reader. A caller can never assert a domain's
 * `changed` flag, fingerprint equality or effective level directly: every one
 * of those is computed here from Git object content and the validated graphs,
 * never accepted as an input.
 */

"use strict";

const { REASON, STATUS, EFFECTIVE_LEVELS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { validateResultRecord, statusForEffectiveLevel, cloneJson } = require("../../kernel/results");
const { graphFingerprint } = require("../../kernel/graph-fingerprint");
const crypto = require("node:crypto");
const { parseManifestBytes } = require("../../kernel/manifest");
const { gateManifestPath } = require("../1a/policy");
const { isValidSubject, sameSubject, sample, safe } = require("../common");
const { isHeadReader, createHeadReader } = require("../head-reader");
const { resolveGitAdapter } = require("../1a/git-adapter");
const { FINGERPRINT_VERSION, frameRegion, hashFramedRegions } = require("./fingerprint");
const { parseSelector, extractRegion } = require("./regions");

const MAX_DOMAINS = 256; // matches kernel LIMITS.maxDomains; validateGraph() already enforces this on each graph
const MAX_REASONS = 32;
const MAX_EVIDENCE_REFS = 32;
const MAX_COVERING_CHECKS_PER_DOMAIN = 64;
// W3-SEC-H2 corrective C2: the pooled 1B-1D evidence array is bounded, but an
// oversized pool is now rejected outright (see computeDeltaReview()'s own
// length check, before validRecordsFor() is ever reached) -- never silently
// sliced to this prefix. A silent slice let a duplicate checkId's second
// occurrence beyond the prefix go uncounted, making the trusted outcome
// depend on which half of an oversized pool happened to fall inside the cut.
const MAX_POOLED_RECORDS = 4096;

const LEVEL_RANK = Object.fromEntries(EFFECTIVE_LEVELS.map((l, i) => [l, i]));
const maxLevel = (a, b) => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

function invalidInput(detail) {
  return deepFreeze({ subject: null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.DELTA_INPUT_INVALID, detail } });
}

/** A validateGraph()-shaped result: { valid, status, domains, topologicalOrder }. */
function isValidatedGraph(g) {
  return isPlainObject(g) && g.valid === true && Array.isArray(g.domains) && Array.isArray(g.topologicalOrder);
}

/** The enabled-domain-id set, derived only from the domain declarations themselves -- never from topologicalOrder. */
function enabledDomainIds(domains) {
  return new Set(domains.filter((d) => isPlainObject(d) && d.enabled === true && typeof d.domainId === "string").map((d) => d.domainId));
}

/**
 * Structurally verify headGraph.topologicalOrder against the domain
 * declarations and dependsOn edges (W3-SEC-H1 fix). `topologicalOrder` is a
 * value the caller supplies alongside `domains` inside a hand-constructible
 * `headGraph` object; a real `validateGraph()` result always produces a
 * genuine topological order, but nothing here re-derives or re-checks that
 * fact from `domains` before this function runs -- so it must be verified
 * independently rather than trusted because `valid === true` was claimed.
 * The enabled-domain-id set used everywhere else in this module comes from
 * `enabledDomainIds(domains)`, never from `topologicalOrder`, so a forged or
 * incomplete order can never narrow which domains are reported on or change
 * the order dependency propagation runs in without first passing here.
 * Rejects: a non-array; a non-string or duplicate entry; an entry that is
 * not an enabled domain (covers both "unknown domain" and "disabled
 * domain" in one check); a missing enabled domain; and any entry placed
 * before a `dependsOn` edge it depends on. Fails closed with a reason, never
 * silently reorders or repairs the input.
 */
function validateTopologicalOrder(headGraph) {
  const domains = headGraph.domains;
  const enabledIds = enabledDomainIds(domains);
  const order = headGraph.topologicalOrder;
  if (!Array.isArray(order)) return { ok: false, reason: "topologicalOrder must be an array" };
  const position = new Map();
  for (const id of order) {
    if (typeof id !== "string") return { ok: false, reason: "topologicalOrder entry is not a string" };
    if (position.has(id)) return { ok: false, reason: `topologicalOrder contains a duplicate entry: ${id}` };
    if (!enabledIds.has(id)) return { ok: false, reason: `topologicalOrder entry is not an enabled domain: ${id}` };
    position.set(id, position.size);
  }
  if (position.size !== enabledIds.size) return { ok: false, reason: "topologicalOrder is missing one or more enabled domains" };
  const byId = new Map(domains.map((d) => [d.domainId, d]));
  for (const id of order) {
    const domain = byId.get(id);
    for (const edge of domain.dependsOn) {
      const upstreamPos = position.get(edge.domain);
      if (upstreamPos === undefined || upstreamPos >= position.get(id)) {
        return { ok: false, reason: `topologicalOrder does not place dependency ${edge.domain} before ${id}` };
      }
    }
  }
  return { ok: true };
}

/**
 * The single non-domain record reported when the head graph fails structural
 * verification -- see validateTopologicalOrder(). `detail` here can embed
 * caller-controlled graph text (a topologicalOrder entry, a dependency edge
 * target): W3-C1-SEC-L1 fix -- it is passed through the one canonical
 * sanitizer (stages/common.js#safe()), never a bare length bound, so it can
 * carry no raw control character, bidirectional-override, zero-width or
 * secret-shaped text into the result record.
 */
function graphInconsistentRecord(subject, detail) {
  const record = {
    checkId: "1E.DELTA.GRAPH",
    ownerStage: "1E",
    status: STATUS.CONFIGURATION_ERROR,
    subject,
    observed: {},
    expected: null,
    reasonCode: REASON.DELTA_GRAPH_INCONSISTENT,
    detail: safe(detail),
    evidenceRefs: [],
  };
  const checked = validateResultRecord(record);
  if (!checked.ok) throw new Error(`internal error: invalid 1E.DELTA.GRAPH record: ${checked.problems.join("; ")}`);
  return checked.record;
}

/**
 * The single non-domain record reported when the caller-supplied pooled
 * 1B-1D evidence array exceeds MAX_POOLED_RECORDS (W3-SEC-H2 residual fix).
 * An oversized pool can never be evaluated as complete, so it is rejected
 * outright -- status INCOMPLETE (matching the stages/1c/result-contract.js
 * precedent for a bound-exceeded evidence set), never a domain result, and
 * never a silently truncated prefix treated as authoritative.
 */
function recordPoolExceededRecord(subject, count) {
  const record = {
    checkId: "1E.DELTA.RECORD_POOL",
    ownerStage: "1E",
    status: STATUS.INCOMPLETE,
    subject,
    observed: { recordCount: count, limit: MAX_POOLED_RECORDS },
    expected: null,
    reasonCode: REASON.DELTA_RECORD_POOL_LIMIT_EXCEEDED,
    detail: safe(`pooled record count (${count}) exceeds the ${MAX_POOLED_RECORDS}-record limit; the input cannot be treated as a complete evidence pool`),
    evidenceRefs: [],
  };
  const checked = validateResultRecord(record);
  if (!checked.ok) throw new Error(`internal error: invalid 1E.DELTA.RECORD_POOL record: ${checked.problems.join("; ")}`);
  return checked.record;
}

/** Deterministic canonical string for exact declaration-byte-identity comparison. */
function canonicalDeclaration(domain) {
  return JSON.stringify({
    domainId: domain.domainId,
    enabled: domain.enabled,
    ownerStage: domain.ownerStage,
    dependsOn: [...domain.dependsOn].sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0)),
    derivedFrom: domain.derivedFrom,
    protectedInputs: domain.protectedInputs,
    reviewModes: [...domain.reviewModes].sort(),
  });
}

/**
 * Runtime-validate a value claiming to be a 1B/1C/1D result record for the
 * exact subject, before any of its status is trusted. Unlike 1C/1D's
 * validateStageResult() (which validates a whole `{subject, records}` stage
 * result as one unit), 1E accepts a flat pooled array of individual records
 * from any of 1B-1D, so validation happens per record: shape, subject
 * equality, and a recognized ownerStage. A malformed or mismatched record is
 * silently excluded from the covering-check lookup -- never trusted, never a
 * crash -- which is equivalent to "no covering record found" (fail closed).
 *
 * Duplicate-checkId handling (W3-SEC-H2 fix, matching the Wave 2 C1/C2
 * precedent in stages/1c/result-contract.js): a `checkId` claimed by more
 * than one record for the same subject is never resolved by first-write-wins
 * or last-write-wins -- every occurrence becomes permanently untrusted, so a
 * later duplicate can never mask an earlier one regardless of insertion
 * order or of which status (PASS or FAIL) arrives first or last. "Claimed by
 * more than one record" is counted on the raw candidate -- checkId, a
 * recognized ownerStage, and exact subject match -- before full schema
 * validation, not after: a second, malformed record sharing a valid record's
 * checkId and subject still poisons that checkId, so an attacker cannot
 * launder a duplicate past this check merely by making one of the two
 * copies fail validateResultRecord(). A record for a different subject
 * (e.g. a stale prior head) is never "relevant" here at all -- it is
 * excluded by the subject check before it can be counted as a duplicate of
 * anything, so it can neither poison nor be poisoned by a current-subject
 * record for the same checkId.
 *
 * This function no longer bounds `records` itself (W3-SEC-H2 residual fix):
 * an oversized pool is rejected outright by computeDeltaReview() -- see
 * MAX_POOLED_RECORDS and recordPoolExceededRecord() -- before this function
 * is ever reached, so every candidate here is always considered. A silent
 * `.slice()` here previously let a duplicate checkId's second occurrence
 * beyond the slice go uncounted, making the trusted outcome depend on input
 * order; removing the slice (rather than raising its bound) removes that
 * class of gap regardless of pool size.
 */
function validRecordsFor(records, subject) {
  const out = new Map(); // checkId -> record
  if (!Array.isArray(records)) return out;
  const candidates = records;
  const isRelevant = (candidate) =>
    isPlainObject(candidate) &&
    typeof candidate.checkId === "string" &&
    ["1B", "1C", "1D"].includes(candidate.ownerStage) &&
    sameSubject(candidate.subject, subject);

  const relevantCount = new Map(); // checkId -> occurrence count among relevant candidates
  for (const candidate of candidates) {
    if (!isRelevant(candidate)) continue;
    relevantCount.set(candidate.checkId, (relevantCount.get(candidate.checkId) || 0) + 1);
  }

  for (const candidate of candidates) {
    if (!isRelevant(candidate)) continue;
    if (relevantCount.get(candidate.checkId) > 1) continue; // duplicated identity: never trusted, regardless of order
    const checked = validateResultRecord(candidate);
    if (!checked.ok) continue;
    out.set(checked.record.checkId, checked.record);
  }
  return out;
}

const MAX_PROPOSALS_REPORTED = 10;

/**
 * Corrective C1 (1G M4): the effective declaration of every domain is the
 * base-anchored declaration plus head tightening only (design section 14,
 * "effective = base protected values + head tightening + head non-protected
 * additions"; overlay table "Domain definition"), with dependency edges merged
 * per `toDomain` exactly as the design section 9 edge-merge table prescribes:
 *
 *   base K,          head K           -> K
 *   base not MEANING, head MEANING    -> MEANING (tightening)
 *   base MEANING,    head other kind  -> MEANING kept; loosening proposal
 *   base DERIVED_VALUE <-> REFERENCE  -> CONFIGURATION_ERROR (lateral change)
 *   base edge,       head absent      -> base edge kept; loosening proposal
 *   base absent,     head edge        -> head edge added (tightening)
 *
 * protectedInputs are monotone (base selectors retained, head additions
 * appended; a removed base selector is a loosening proposal), reviewModes are
 * the intersection (a head mode the base does not allow is a loosening proposal),
 * and ownerStage is the base value (a differing ownerStage is CONFIGURATION_ERROR).
 * A loosening proposal is never applied: the base value stays in force and the
 * domain is HUMAN_REVIEW_REQUIRED (GOVERNANCE_CONFIG) with the proposal recorded.
 * derivedFrom is not a protected field (section 14) and is taken from the head; a
 * head change to it is already a declaration change (DEEP_REVIEW_REQUIRED) and it
 * can only add reasons, never lower a level. A domain enabled at base but absent
 * or disabled at head keeps its existing DOMAIN_REMOVED HUMAN_REVIEW_REQUIRED
 * result, and every retained base edge to it propagates that result.
 *
 * The merged graph is re-validated once (section 9): the union of two valid DAGs
 * can contain a cycle, which is CONFIGURATION_ERROR. Returns
 * { ok, byId, proposals, order } or { ok:false, reason }.
 */
function composeDomains(headGraph, baseGraph, reportedIds, headEnabledIds) {
  const headById = new Map(headGraph.domains.map((d) => [d.domainId, d]));
  const baseById = new Map(baseGraph ? baseGraph.domains.map((d) => [d.domainId, d]) : []);
  const byId = new Map();
  const proposals = new Map();
  for (const id of [...headEnabledIds].sort()) {
    const head = headById.get(id);
    const base = baseById.get(id);
    if (!base || !base.enabled) {
      byId.set(id, head);
      proposals.set(id, []);
      continue;
    }
    if (base.ownerStage !== head.ownerStage) return { ok: false, reason: `the head changes the ownerStage of base-anchored domain ${id}` };
    const notApplied = [];
    const baseEdges = new Map(base.dependsOn.map((e) => [e.domain, e.kind]));
    const headEdges = new Map(head.dependsOn.map((e) => [e.domain, e.kind]));
    const dependsOn = [];
    for (const edge of head.dependsOn) {
      const baseKind = baseEdges.get(edge.domain);
      if (baseKind === undefined || baseKind === edge.kind || edge.kind === "MEANING") dependsOn.push({ domain: edge.domain, kind: edge.kind });
      else if (baseKind === "MEANING") {
        dependsOn.push({ domain: edge.domain, kind: "MEANING" });
        notApplied.push(`EDGE_KIND_LOWERED:${edge.domain}`);
      } else return { ok: false, reason: `the head changes the dependency kind ${id} -> ${edge.domain} laterally (${baseKind} to ${edge.kind})` };
    }
    for (const edge of base.dependsOn) {
      if (headEdges.has(edge.domain)) continue;
      dependsOn.push({ domain: edge.domain, kind: edge.kind });
      notApplied.push(`EDGE_REMOVED:${edge.domain}`);
    }
    const headInputs = new Set(head.protectedInputs);
    const baseInputs = new Set(base.protectedInputs);
    for (const selector of base.protectedInputs) if (!headInputs.has(selector)) notApplied.push(`PROTECTED_INPUT_REMOVED:${selector}`);
    const protectedInputs = [...base.protectedInputs, ...head.protectedInputs.filter((s) => !baseInputs.has(s))];
    for (const mode of head.reviewModes) if (!base.reviewModes.includes(mode)) notApplied.push(`REVIEW_MODE_ADDED:${mode}`);
    const reviewModes = base.reviewModes.filter((m) => head.reviewModes.includes(m));
    byId.set(id, { ...head, enabled: base.enabled, ownerStage: base.ownerStage, dependsOn, protectedInputs, reviewModes });
    proposals.set(id, notApplied);
  }

  // Deterministic topological order of the merged graph (Kahn, smallest id first);
  // a domain removed at head is a source (its result is fixed, see above).
  const indegree = new Map(reportedIds.map((id) => [id, 0]));
  const dependents = new Map(reportedIds.map((id) => [id, []]));
  for (const [id, domain] of byId) {
    for (const edge of domain.dependsOn) {
      if (!indegree.has(edge.domain)) return { ok: false, reason: `the merged dependency of ${id} names ${edge.domain}, which is not an enabled domain` };
      indegree.set(id, indegree.get(id) + 1);
      dependents.get(edge.domain).push(id);
    }
  }
  const ready = reportedIds.filter((id) => indegree.get(id) === 0);
  const order = [];
  while (ready.length > 0) {
    ready.sort();
    const id = ready.shift();
    order.push(id);
    for (const next of dependents.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (order.length !== reportedIds.length) return { ok: false, reason: "the merged base/head dependency graph contains a cycle" };
  return { ok: true, byId, proposals, order };
}

/** Fingerprint one domain's ordered protectedInputs (or derivedFrom-SOURCE) selectors against one reader. */
async function fingerprintSelectors(selectors, reader) {
  const framed = [];
  for (const selector of selectors) {
    const parsed = parseSelector(selector);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const region = await extractRegion(parsed, reader);
    if (!region.ok) return { ok: false, reason: region.reason };
    if (region.kind === "single") {
      framed.push(frameRegion(selector, region.bytes));
    } else {
      const rows = region.orderIndependent ? [...region.rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : region.rows;
      const inner = rows.map((r, i) => frameRegion(`${selector}#${r.id !== "" ? r.id : `row:${i}`}`, r.bytes));
      framed.push(frameRegion(selector, Buffer.concat(inner)));
    }
  }
  return { ok: true, hash: hashFramedRegions(framed) };
}

/**
 * computeDeltaReview({ subject, headGraph, baseGraph, records, coveringChecks,
 *                       recordedExtractorVersions, reader | git })
 *   subject      exact {head, tree, base, range}, already established by 1A
 *   headGraph    kernel/graph.js#validateGraph() result for the domain
 *                declarations effective at head
 *   baseGraph    the same, at base -- used only for declaration/fingerprint
 *                comparison; a domain absent here is BASE_UNAVAILABLE for that
 *                domain, never assumed unchanged
 *   records      pooled array of 1B/1C/1D result records (validated per
 *                record; see validRecordsFor())
 *   coveringChecks  optional { [domainId]: checkId[] } -- which records, if
 *                    any, "cover" a domain; an omitted map, or a domain with
 *                    no own entry (or []), has no required covering check
 *                    (vacuously satisfied); an entry naming a checkId that
 *                    resolves to no valid record, or to a non-PASS record,
 *                    prevents PRESERVATION_CHECK_ONLY. A present map that is
 *                    not a plain object is DELTA_INPUT_INVALID; a present
 *                    entry that is not an array is HUMAN_REVIEW_REQUIRED for
 *                    that domain (COVERING_CHECK_DECLARATION_INVALID)
 *   recordedExtractorVersions  optional { [domainId]: string } -- a version
 *                    recorded at a prior base comparison; a mismatch with the
 *                    current FINGERPRINT_VERSION makes the domain changed
 *                    (design section 11 condition 7). Same shape rules: a
 *                    non-plain-object map is DELTA_INPUT_INVALID; a present
 *                    non-string entry is HUMAN_REVIEW_REQUIRED for that
 *                    domain (EXTRACTOR_VERSION_INVALID)
 *   reader       { atBase, atHead } head-reader-shaped objects (test seam), or
 *   git          { repositoryRoot, gitExecutable } / an injected adapter, used
 *                to build both readers via stages/head-reader.js
 *
 * Output: the usual frozen { subject, records, outcome }. Every enabled domain
 * in headGraph (plus any domain that was enabled at base but is absent or
 * disabled at head -- see the module comment on domain removal) yields exactly
 * one `1E.DOMAIN.<domainId>` record.
 */
async function computeDeltaReview(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput("a valid subject is required");
  const subject = input.subject;
  const records = [];
  const done = () => deepFreeze({ subject, records, outcome: null });

  if (!isValidatedGraph(input.headGraph)) return invalidInput("headGraph must be a valid validateGraph() result");
  let headGraph;
  let baseSnapshot;
  try {
    // One graph snapshot before validation or awaits; the same values drive both
    // semantic identity and the entire computation, including composition.
    headGraph = cloneJson(input.headGraph);
    baseSnapshot = input.baseGraph == null ? null : cloneJson(input.baseGraph);
  } catch { return invalidInput("graph cannot be safely snapshotted"); }
  const topoCheck = validateTopologicalOrder(headGraph);
  if (!topoCheck.ok) return deepFreeze({ subject, records: [graphInconsistentRecord(subject, topoCheck.reason)], outcome: null });
  // W3-SEC-H2 residual fix: an O(1) length check on the raw pool, before any
  // reader/adapter work and before validRecordsFor() ever runs -- an
  // oversized pool is rejected outright, never silently truncated to a
  // prefix and never scanned in full just to discover it is too large.
  if (Array.isArray(input.records) && input.records.length > MAX_POOLED_RECORDS) {
    return deepFreeze({ subject, records: [recordPoolExceededRecord(subject, input.records.length)], outcome: null });
  }
  const baseGraph = isValidatedGraph(baseSnapshot) ? baseSnapshot : null;
  if (input.baseGraph !== undefined && input.baseGraph !== null && baseGraph === null) return invalidInput("baseGraph, if supplied, must be a valid validateGraph() result");
  // W3-C3-DEV-L1 fix (design section 20): an omitted container is the only
  // supported absence; a present container that is not a plain object (null,
  // an array, a string, a Map, a class instance, ...) is rejected, never
  // replaced with {} -- that silently erased every declared requirement.
  if (input.coveringChecks !== undefined && !isPlainObject(input.coveringChecks)) return invalidInput("coveringChecks, if supplied, must be a plain object");
  if (input.recordedExtractorVersions !== undefined && !isPlainObject(input.recordedExtractorVersions)) return invalidInput("recordedExtractorVersions, if supplied, must be a plain object");

  let reader;
  if (isPlainObject(input.reader) && isHeadReader(input.reader.atBase) && isHeadReader(input.reader.atHead)) {
    reader = input.reader;
  } else {
    const adapter = resolveGitAdapter(input);
    if (!adapter.ok) return invalidInput("no usable content reader was supplied");
    reader = { atBase: createHeadReader(adapter.git, subject.base), atHead: createHeadReader(adapter.git, subject.head) };
  }

  const coveringChecks = input.coveringChecks === undefined ? {} : input.coveringChecks;
  const recordedExtractorVersions = input.recordedExtractorVersions === undefined ? {} : input.recordedExtractorVersions;
  const validRecords = validRecordsFor(input.records, subject);

  const graphIdentity = {
    baseGraphFingerprint: baseGraph === null ? null : graphFingerprint(baseGraph),
    headGraphFingerprint: graphFingerprint(headGraph),
    baseGateSha256: null, headGateSha256: null,
  };
  if (graphIdentity.headGraphFingerprint === null || (baseGraph !== null && graphIdentity.baseGraphFingerprint === null)) return invalidInput("graph semantics failed canonical validation");
  // Existing records[] carries the canonical owner statement, never a new
  // caller-selected expected fingerprint argument. Only Git/reader bytes can
  // establish the consumer's source identity; graph-carried labels are ignored.
  const anchors = Array.isArray(input.records) ? input.records.filter((r) => r && r.checkId === "1A.POLICY.GATE_ANCHOR") : [];
  const anchor = anchors.length === 1 ? validateResultRecord(anchors[0]) : null;
  if (anchor && anchor.ok && anchor.record.ownerStage === "1A" && sameSubject(anchor.record.subject, subject)) {
    const path = anchor.record.observed && anchor.record.observed.path;
    const match = typeof path === "string" ? /^governance\/manifests\/([a-z][a-z0-9-]{1,63})\.json$/.exec(path) : null;
    if (match && gateManifestPath(match[1]) === path) {
      for (const [side, source] of [["base", reader.atBase], ["head", reader.atHead]]) {
        const entry = await source.read(path, 1024 * 1024);
        if (entry.kind === "blob" && parseManifestBytes(entry.bytes).valid) graphIdentity[`${side}GateSha256`] = crypto.createHash("sha256").update(entry.bytes).digest("hex");
      }
    }
  }

  const headById = new Map(headGraph.domains.map((d) => [d.domainId, d]));
  const baseById = new Map(baseGraph ? baseGraph.domains.map((d) => [d.domainId, d]) : []);
  // The set 1E reports on: every enabled head domain, plus any domain enabled
  // at base that is absent or disabled at head -- a head cannot silently drop
  // coverage of something the base protected (design section 14 monotonicity;
  // mission section 64/65: "head removes protected region selector => cannot
  // gain PRESERVATION"). No merge-layer exists yet upstream of 1E, so this
  // minimal union is 1E's own enforcement of that rule.
  const headEnabledIds = enabledDomainIds(headGraph.domains);
  const baseEnabledIds = new Set([...baseById.values()].filter((d) => d.enabled).map((d) => d.domainId));
  const reportedIds = [...new Set([...headEnabledIds, ...baseEnabledIds])].sort();
  if (reportedIds.length > MAX_DOMAINS) return invalidInput("too many domains to report on");
  const composition = composeDomains(headGraph, baseGraph, reportedIds, headEnabledIds);
  if (!composition.ok) return deepFreeze({ subject, records: [graphInconsistentRecord(subject, composition.reason)], outcome: null });

  const effective = new Map(); // domainId -> level
  const reasonsOf = new Map(); // domainId -> reason strings
  const evidenceOf = new Map(); // domainId -> evidenceRefs
  const fingerprintOf = new Map(); // domainId -> string | null

  // Domains removed at head (present+enabled at base, absent/disabled at head)
  // are processed first (no dependency ordering needed: they contribute no
  // outgoing edges in headGraph) and always resolve to HUMAN_REVIEW_REQUIRED.
  for (const id of reportedIds) {
    if (headEnabledIds.has(id)) continue;
    effective.set(id, "HUMAN_REVIEW_REQUIRED");
    reasonsOf.set(id, ["DOMAIN_REMOVED"]);
    evidenceOf.set(id, []);
    fingerprintOf.set(id, null);
  }

  for (const id of composition.order) {
    if (!headEnabledIds.has(id)) continue; // removed at head: resolved above
    // The effective (base + head tightening) declaration drives every check below;
    // the raw head declaration is used only to detect that the head changed it.
    const domain = composition.byId.get(id);
    const notApplied = composition.proposals.get(id);
    const reasons = [];
    const evidenceRefs = [];
    let ownLevel = "PRESERVATION_CHECK_ONLY";
    let fingerprint = null;
    let hardFailure = false;

    const baseDomain = baseById.get(id);
    if (!baseDomain) {
      // Condition 5 (added domain): never PRESERVATION; machine-checkable, so DEEP.
      ownLevel = "DEEP_REVIEW_REQUIRED";
      reasons.push("DOMAIN_ADDED");
    } else if (!baseDomain.enabled) {
      ownLevel = "DEEP_REVIEW_REQUIRED";
      reasons.push("DOMAIN_ADDED");
    } else if (canonicalDeclaration(headById.get(id)) !== canonicalDeclaration(baseDomain)) {
      // Condition 4: own manifest declaration differs from base. A loosening part
      // of that change is not applied (see composeDomains()) and needs a human.
      ownLevel = "DEEP_REVIEW_REQUIRED";
      if (notApplied.length > 0) {
        ownLevel = "HUMAN_REVIEW_REQUIRED";
        reasons.push("GOVERNANCE_CONFIG");
      }
      reasons.push("MANIFEST_DECLARATION_CHANGED");
    }

    // Extractor version (condition 7): checked before fingerprinting so a
    // recorded mismatch never depends on a successful extraction.
    // Only an own entry counts; an absent entry is "no recorded version". A
    // present non-string entry is handled below (after extraction, so its
    // reason never hides an extraction reason) -- never treated as absent.
    const hasRecordedVersion = Object.hasOwn(recordedExtractorVersions, id);
    const recordedVersion = hasRecordedVersion ? recordedExtractorVersions[id] : undefined;
    if (typeof recordedVersion === "string" && recordedVersion !== FINGERPRINT_VERSION) {
      ownLevel = maxLevel(ownLevel, "DEEP_REVIEW_REQUIRED");
      reasons.push("EXTRACTOR_VERSION_CHANGED");
    }

    // Own fingerprint (condition 1) + derivedFrom SOURCE selectors (condition 2).
    // Any extraction failure at either identity is a hard failure: the design's
    // "region cannot be located at head, or base version unavailable" is
    // HUMAN_REVIEW_REQUIRED, never assumed unchanged (section 11 condition 6);
    // an invalid-UTF-8 region is a canonicalization failure for that domain,
    // reconciled here to the same outcome (section 13's "FAIL for the domain"
    // has no direct effectiveLevel of its own -- HUMAN_REVIEW_REQUIRED is the
    // fail-closed effectiveLevel that best matches "the tool cannot establish
    // the fact", matching condition 6's own explicit HUMAN_REVIEW_REQUIRED
    // outcome for an unlocatable region).
    // A domain with no base declaration at all (DOMAIN_ADDED, handled above)
    // has nothing to compare against: attempting a base-side extraction would
    // either fail spuriously (escalating an already-DEEP domain all the way
    // to HUMAN_REVIEW_REQUIRED for no additional reason) or, worse, could
    // coincidentally succeed against unrelated base content at the same path
    // and be misread as a real comparison. The head fingerprint is still
    // computed (for the output `domain.fingerprint` field and for a future
    // base comparison once the domain itself is no longer new), but no
    // base-vs-head comparison is attempted.
    const compareToBase = baseDomain !== undefined;
    const sourceSelectors = domain.derivedFrom.filter((d) => d.type === "SOURCE").map((d) => d.selector);
    let fingerprintChanged = false;
    if (!hardFailure && domain.protectedInputs.length > 0) {
      const atHead = await fingerprintSelectors(domain.protectedInputs, reader.atHead);
      if (!atHead.ok) {
        hardFailure = true;
        reasons.push(headExtractionReason(atHead.reason));
      } else {
        fingerprint = atHead.hash;
        if (compareToBase) {
          const atBase = await fingerprintSelectors(domain.protectedInputs, reader.atBase);
          if (!atBase.ok) {
            hardFailure = true;
            reasons.push(baseExtractionReason(atBase.reason));
          } else if (atBase.hash !== atHead.hash) {
            fingerprintChanged = true;
            reasons.push("OWN_FINGERPRINT_CHANGED");
          }
        }
      }
    }
    if (!hardFailure && compareToBase && sourceSelectors.length > 0) {
      const atHead = await fingerprintSelectors(sourceSelectors, reader.atHead);
      if (!atHead.ok) {
        hardFailure = true;
        reasons.push(headExtractionReason(atHead.reason));
      } else {
        const atBase = await fingerprintSelectors(sourceSelectors, reader.atBase);
        if (!atBase.ok) {
          hardFailure = true;
          reasons.push(baseExtractionReason(atBase.reason));
        } else if (atBase.hash !== atHead.hash) {
          reasons.push("DERIVED_SOURCE_CHANGED");
          evidenceRefs.push(...sourceSelectors.slice(0, 4));
        }
      }
    }

    // W3-C3-DEV-L1 fix (design section 20): a present entry of the wrong type
    // is rejected for THIS domain only (hardFailure, like an unlocatable region
    // or an oversized covering declaration) -- never coerced to "no recorded
    // version" / "no covering requirement", which let a malformed declaration
    // naming a FAIL record still yield PRESERVATION. Only an own property is
    // a declaration; an absent key keeps its documented vacuous meaning. A
    // non-array is rejected here before any `length` is read, so an array-like
    // object can never pass as a declaration.
    if (hasRecordedVersion && typeof recordedVersion !== "string") {
      hardFailure = true;
      reasons.push("EXTRACTOR_VERSION_INVALID");
    }
    const rawCovering = Object.hasOwn(coveringChecks, id) ? coveringChecks[id] : [];
    if (!Array.isArray(rawCovering)) {
      hardFailure = true;
      reasons.push("COVERING_CHECK_DECLARATION_INVALID");
    }

    if (hardFailure) {
      ownLevel = "HUMAN_REVIEW_REQUIRED";
      fingerprint = null;
    } else if (fingerprintChanged) {
      ownLevel = maxLevel(ownLevel, "DEEP_REVIEW_REQUIRED");
    }

    // Covering 1B-1D checks (eligibility conditions 7/8). A missing required
    // covering record is never a green default (mission section 17): it
    // prevents PRESERVATION exactly like a non-PASS record does. Per the
    // design section 10 algorithm's own "else" bucket ("a covering 1B-1D
    // check is not PASS" is explicitly listed under the DEEP_REVIEW_REQUIRED
    // branch, not the HUMAN_REVIEW_REQUIRED branch), a non-PASS covering
    // record -- including one that is itself HUMAN_REVIEW_REQUIRED -- yields
    // DEEP_REVIEW_REQUIRED for this domain's own contribution; the covering
    // record's own HUMAN_REVIEW_REQUIRED status still independently
    // participates in the run's overall readiness aggregation.
    if (!hardFailure) {
      const declaredCovering = rawCovering; // an array: a non-array already set hardFailure above
      // W3-C2-SEC-M1 fix: the raw declared length is checked BEFORE any
      // slicing -- a declaration beyond MAX_COVERING_CHECKS_PER_DOMAIN is
      // never truncated to a trusted prefix (that let a required check past
      // index 63 be silently dropped, regardless of whether it would have
      // resolved to FAIL, HUMAN_REVIEW_REQUIRED or simply been missing). An
      // oversized declaration fails only THIS domain closed -- exactly like
      // an unlocatable region does (hardFailure) -- never the whole run, so
      // other domains with in-bound declarations are unaffected (the limit
      // is per domain, not global).
      if (declaredCovering.length > MAX_COVERING_CHECKS_PER_DOMAIN) {
        hardFailure = true;
        ownLevel = "HUMAN_REVIEW_REQUIRED";
        fingerprint = null;
        reasons.push("COVERING_CHECK_LIMIT_EXCEEDED");
      } else {
        let coveringClean = true;
        for (const checkId of declaredCovering) {
          const rec = typeof checkId === "string" ? validRecords.get(checkId) : undefined;
          if (!rec) {
            coveringClean = false;
            reasons.push("COVERING_CHECK_NOT_PASS");
            continue;
          }
          evidenceRefs.push(checkId);
          if (rec.status !== STATUS.PASS && rec.status !== STATUS.NOT_APPLICABLE) {
            coveringClean = false;
            reasons.push("COVERING_CHECK_NOT_PASS");
          }
        }
        if (!coveringClean) ownLevel = maxLevel(ownLevel, "DEEP_REVIEW_REQUIRED");

        // Eligibility condition 1: reviewModes must allow PRESERVATION_CHECK_ONLY.
        if (!domain.reviewModes.includes("PRESERVATION_CHECK_ONLY")) {
          ownLevel = maxLevel(ownLevel, "DEEP_REVIEW_REQUIRED");
          reasons.push("PRESERVATION_NOT_ALLOWED");
        }
      }
    }

    // Inherited (condition 3): worst-of over already-resolved upstream
    // effective levels, in topological order. A PRESERVATION upstream never
    // escalates; a HUMAN_REVIEW_REQUIRED upstream, or a MEANING edge whose
    // upstream is above PRESERVATION, escalates straight to
    // HUMAN_REVIEW_REQUIRED; any other above-PRESERVATION upstream escalates
    // to at least DEEP_REVIEW_REQUIRED. Never assigns PRESERVATION unless the
    // own pre-gate above already held (section 10's own invariant).
    let inherited = "PRESERVATION_CHECK_ONLY";
    for (const edge of domain.dependsOn) {
      const upstream = effective.get(edge.domain);
      if (upstream === undefined || upstream === "PRESERVATION_CHECK_ONLY") continue;
      if (upstream === "HUMAN_REVIEW_REQUIRED" || edge.kind === "MEANING") {
        inherited = "HUMAN_REVIEW_REQUIRED";
        reasons.push(edge.kind === "MEANING" ? "MEANING_DEPENDENCY_CHANGED" : "UPSTREAM_HUMAN_REVIEW");
      } else {
        inherited = maxLevel(inherited, "DEEP_REVIEW_REQUIRED");
        reasons.push("UPSTREAM_DEEP_REVIEW");
      }
      evidenceRefs.push(`1E.DOMAIN.${edge.domain}`);
    }

    const finalLevel = maxLevel(ownLevel, inherited);
    effective.set(id, finalLevel);
    reasonsOf.set(id, [...new Set(reasons)].slice(0, MAX_REASONS));
    evidenceOf.set(id, [...new Set(evidenceRefs)].slice(0, MAX_EVIDENCE_REFS));
    fingerprintOf.set(id, finalLevel === "HUMAN_REVIEW_REQUIRED" && hardFailure ? null : fingerprint);
  }

  for (const id of reportedIds) {
    const level = effective.get(id);
    const reasons = reasonsOf.get(id) || [];
    const evidenceRefs = evidenceOf.get(id) || [];
    const fingerprint = fingerprintOf.get(id) ?? null;
    const dependencyState = reasons.length > 0 ? reasons.join(",").slice(0, 64) : "NO_DEPENDENCY_ESCALATION";
    // A head loosening proposal that was not applied is recorded with the result
    // (design section 14: "the proposal is recorded"); absent when there is none.
    const notApplied = composition.proposals.get(id) || [];
    const observed = notApplied.length > 0 ? { domainId: id, notAppliedProposals: sample(notApplied, MAX_PROPOSALS_REPORTED) } : { domainId: id };
    const record = {
      checkId: `1E.DOMAIN.${id}`,
      ownerStage: "1E",
      status: statusForEffectiveLevel(level),
      subject,
      observed,
      expected: null,
      reasonCode: reasons[0] ? REASON[reasons[0]] || REASON.OK : REASON.OK,
      detail: sample([`${id}: ${level}`], 1)[0] || "",
      evidenceRefs: [],
      domain: {
        domainId: id,
        effectiveLevel: level,
        reasons: reasons.length > 0 ? reasons : ["NO_CHANGE_DETECTED"],
        evidenceRefs,
        dependencyState,
        fingerprint,
      },
    };
    const checked = validateResultRecord(record);
    if (!checked.ok) throw new Error(`internal error: invalid 1E.DOMAIN.${id} record: ${checked.problems.join("; ")}`);
    records.push(checked.record);
  }

  // Corrective C1 (1G M1): 1E is the canonical owner of "which domains this run
  // reports on", so it states that set once, as its own record. A report consumer
  // derives the required domain results from this record instead of trusting a
  // caller-supplied list, so omitting a domain result can never shrink the set.
  const domainSet = {
    checkId: "1E.DELTA.DOMAIN_SET",
    ownerStage: "1E",
    status: STATUS.PASS,
    subject,
    observed: { domainIds: reportedIds, ...graphIdentity },
    expected: null,
    reasonCode: REASON.OK,
    detail: `${reportedIds.length} domain result(s) reported`,
    evidenceRefs: [],
  };
  const checkedSet = validateResultRecord(domainSet);
  if (!checkedSet.ok) throw new Error(`internal error: invalid 1E.DELTA.DOMAIN_SET record: ${checkedSet.problems.join("; ")}`);
  records.push(checkedSet.record);

  return done();
}

// Region-extraction failure reasons (from regions.js#extractRegion) are already
// exact REASON-registry names, passed through directly for head-side failures
// so a reviewer can distinguish "missing" from "ambiguous" from "unreadable".
// A base-side failure is always reported as BASE_UNAVAILABLE regardless of the
// underlying extraction reason: design section 11 condition 6 and section 12
// condition 6 both single out "base version unavailable" as its own named
// outcome, and the domain is never assumed unchanged either way.
const HEAD_EXTRACTION_REASONS = new Set(["REGION_MISSING", "REGION_UNREADABLE", "REGION_TOO_LARGE", "MULTIPLE_REGION_MATCH", "SELECTOR_INVALID", "INVALID_UTF8", "DUPLICATE_RECORD_ID"]);
function headExtractionReason(reason) {
  return HEAD_EXTRACTION_REASONS.has(reason) ? reason : "REGION_MISSING";
}
function baseExtractionReason() {
  return "BASE_UNAVAILABLE";
}

module.exports = { computeDeltaReview };
