/**
 * GOV-AUTO-1 Wave 4 -- kernel-owned evidence revalidation (design section
 * 25a). Ownership is explicit in the binding design: "the kernel's
 * `revalidateEvidence()` re-fetches every externally mutable source and
 * compares the current version and digest with the report." It is a
 * dependency-driven kernel extension first needed by Wave 4 / 1F, added
 * here the same way every 1E corrective (C1-C4) added purely additive
 * kernel/contracts.js reason codes from within a later wave's own PR
 * without that being "reopening Wave 0".
 *
 * `revalidateEvidence()` establishes only whether externally mutable
 * evidence a finalized report relied on is still current. It never:
 *   - approves a merge or authorizes anything;
 *   - authenticates a human from a self-declared name (identity in a
 *     determination record is validated by the caller before this
 *     function ever sees the record; this function only re-checks that
 *     the accepted digest/version has not silently changed underneath);
 *   - reclassifies a CI failure as harmless;
 *   - mutates the evidence it examines or the report it was given;
 *   - alters the reviewed HEAD;
 *   - bypasses `aggregate()` -- it returns one more result record for a
 *     caller to fold into the SAME aggregation every other check already
 *     uses, never a parallel readiness computation;
 *   - converts missing or unfetchable evidence into PASS.
 *
 * Follows the same public-interface shape every other stage function
 * already uses (`{subject, records, outcome}`), not a bespoke shape: a
 * malformed call returns `outcome` (matching 1C/1E's own `invalidInput()`
 * convention); a normal call returns exactly one `KERNEL.REVALIDATION`
 * record for the caller to add to its records array before aggregating.
 *
 * Dependency injection (design section 24, offline testability): source
 * re-fetching is never done by this module directly. A caller supplies
 * `adapters`, one per `sourceType`, each a narrow `{ fetch(sourceObjectId) }`
 * the deterministic suite replaces with a fixture; this function contains
 * no network code and no GitHub-specific knowledge.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("./contracts");
const { isPlainObject } = require("./validation");
const { validateResultRecord, canonicalJson, cloneJson } = require("./results");

const MAX_EXTERNAL_EVIDENCE_ITEMS = 256;
const IMMUTABILITY_VALUES = new Set(["MUTABLE", "VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]);
const SHA40 = /^[0-9a-f]{40}$/;
// The report-format versions this consumer understands (design section 23:
// "consumers reject any value they do not list as supported").
const SUPPORTED_REPORT_SCHEMA_VERSIONS = [1];

function isValidSubject(subject) {
  const probe = { checkId: "KERNEL.REVALIDATION.PROBE", ownerStage: "KERNEL", status: STATUS.PASS, subject, observed: {}, expected: null, reasonCode: REASON.OK, detail: "", evidenceRefs: [] };
  return validateResultRecord(probe).ok === true;
}

function invalidInput(detail) {
  return deepFreeze({ subject: null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.RESULT_RECORD_INVALID, detail } });
}

/** A single externalEvidence[] entry (design section 23): exactly the five canonical report fields, nothing more. */
function isValidEvidenceEntry(entry) {
  if (!isPlainObject(entry)) return false;
  const keys = Object.keys(entry).sort().join(",");
  if (keys !== "collectedAt,contentDigest,immutability,sourceObjectId,sourceVersion") return false;
  if (typeof entry.sourceObjectId !== "string" || entry.sourceObjectId.length === 0 || entry.sourceObjectId.length > 300) return false;
  if (typeof entry.sourceVersion !== "string" || entry.sourceVersion.length === 0 || entry.sourceVersion.length > 300) return false;
  if (typeof entry.contentDigest !== "string" || !/^[0-9a-f]{64}$/.test(entry.contentDigest)) return false;
  if (typeof entry.collectedAt !== "string" || entry.collectedAt.length === 0 || entry.collectedAt.length > 64) return false;
  return typeof entry.immutability === "string" && IMMUTABILITY_VALUES.has(entry.immutability);
}

/** One revalidation item: the canonical evidence entry plus the sourceType the caller uses to pick an adapter (an input-only concept -- never part of the canonical report schema itself). */
function isValidItem(item) {
  return isPlainObject(item) && Object.keys(item).sort().join(",") === "entry,sourceType" &&
    isValidEvidenceEntry(item.entry) && typeof item.sourceType === "string" && item.sourceType.length > 0 && item.sourceType.length <= 64;
}

/**
 * Corrective C1 (1G M3): every item is re-fetched, whatever its `immutability`
 * label. Design section 25a lets a VERIFIED_* item skip re-fetch only when the
 * immutability was positively verified "together with the verification
 * evidence"; the canonical externalEvidence[] entry has no field that can carry
 * such evidence, and no governed verification-proof contract exists yet, so a
 * VERIFIED_PROVIDER / VERIFIED_CRYPTO label is a self-assertion and is never
 * honored as a reason to skip freshness verification.
 */
async function revalidateOne(item, adapters) {
  const { entry, sourceType } = item;
  const adapter = isPlainObject(adapters) ? adapters[sourceType] : undefined;
  if (!adapter || typeof adapter.fetch !== "function") return { stale: true, reason: "NO_ADAPTER_FOR_SOURCE_TYPE" };
  let fetched;
  try {
    fetched = await adapter.fetch(entry.sourceObjectId);
  } catch {
    return { stale: true, reason: "ADAPTER_THREW" };
  }
  if (!isPlainObject(fetched) || fetched.ok !== true) return { stale: true, reason: "SOURCE_UNREACHABLE" };
  if (typeof fetched.version !== "string" || typeof fetched.digest !== "string") return { stale: true, reason: "MALFORMED_ADAPTER_RESPONSE" };
  if (fetched.version !== entry.sourceVersion || fetched.digest !== entry.contentDigest) return { stale: true, reason: "VERSION_OR_DIGEST_CHANGED" };
  return { stale: false };
}

/**
 * Corrective C1 (1G L1): the governance root is always re-resolved, and the
 * values it is compared with come from the report itself
 * (trustedContext.rootTip / trustedContext.rootPolicyDigest), never from the
 * caller. A report built without a root policy (rootPolicyDigest null, the
 * bootstrap case) is still re-checked: if a root policy has appeared since, the
 * report is stale. `resolve()` answers `{ ok: true, rootTip, digest }`, where
 * `digest` is null exactly when no governance-root policy exists.
 */
async function revalidateRootPolicy(rootPolicy, expected) {
  let resolved;
  try {
    resolved = await rootPolicy.resolve();
  } catch {
    return { stale: true, reason: "ROOT_POLICY_ADAPTER_THREW" };
  }
  if (!isPlainObject(resolved) || resolved.ok !== true) return { stale: true, reason: "ROOT_POLICY_UNREACHABLE" };
  if (typeof resolved.rootTip !== "string" || !SHA40.test(resolved.rootTip) || (resolved.digest !== null && typeof resolved.digest !== "string")) {
    return { stale: true, reason: "MALFORMED_ROOT_POLICY_RESPONSE" };
  }
  if (resolved.rootTip !== expected.rootTip || resolved.digest !== expected.rootPolicyDigest) return { stale: true, reason: "ROOT_POLICY_CHANGED" };
  return { stale: false };
}

/**
 * Validate the parts of a consumed report that revalidation is bound to
 * (design section 23; the report is hostile input when consumed). Returns the
 * bound facts, or null when the report cannot be revalidated at all.
 */
function reportBinding(report, subject) {
  if (!isPlainObject(report)) return null;
  if (!SUPPORTED_REPORT_SCHEMA_VERSIONS.includes(report.schemaVersion)) return null;
  if (report.requiresRevalidation !== true || report.notAuthorization !== true) return null;
  const gf = report.generatedFor;
  if (!isPlainObject(gf) || gf.head !== subject.head || gf.tree !== subject.tree || gf.base !== subject.base) return null;
  const tc = report.trustedContext;
  if (!isPlainObject(tc) || typeof tc.rootTip !== "string" || !SHA40.test(tc.rootTip)) return null;
  if (tc.rootPolicyDigest !== null && (typeof tc.rootPolicyDigest !== "string" || tc.rootPolicyDigest.length === 0 || tc.rootPolicyDigest.length > 128)) return null;
  const evidence = report.externalEvidence;
  if (!Array.isArray(evidence) || evidence.length > MAX_EXTERNAL_EVIDENCE_ITEMS || !evidence.every(isValidEvidenceEntry)) return null;
  return { evidence, rootTip: tc.rootTip, rootPolicyDigest: tc.rootPolicyDigest };
}

/** True when `items` carry every report evidence entry exactly once and nothing else (multiset equality). */
function coversExactly(items, evidence) {
  if (items.length !== evidence.length) return false;
  const remaining = new Map();
  for (const entry of evidence) {
    const key = canonicalJson(entry);
    remaining.set(key, (remaining.get(key) || 0) + 1);
  }
  for (const item of items) {
    const key = canonicalJson(item.entry);
    const n = remaining.get(key) || 0;
    if (n === 0) return false;
    remaining.set(key, n - 1);
  }
  return true;
}

/**
 * revalidateEvidence({ subject, report, items, adapters, rootPolicy })
 *   subject     the exact run identity every accepted record must already carry
 *   report      the consumed pre-review.json report (buildReport()'s `.report`);
 *               it must be generated for `subject` and is the only source of the
 *               evidence set and of the expected root tip and root-policy digest
 *   items       bounded array of { entry, sourceType } -- see isValidItem(); it must
 *               contain every report.externalEvidence entry exactly once and
 *               nothing else, so a caller cannot revalidate only a safe subset
 *   adapters    { [sourceType]: { fetch(sourceObjectId) -> {ok, version, digest} } }
 *   rootPolicy  required { resolve() -> {ok, rootTip, digest} } -- re-resolves the
 *               governance root tip and its policy digest (design section 25a)
 *
 * Corrective C1 (1G M3 + L1): revalidation is bound to the report. An empty or
 * partial `items` list, an omitted root-policy resolver, or a report generated for
 * another identity is malformed input, never a vacuous PASS.
 *
 * Output: the same { subject, records, outcome } shape every stage function uses.
 * `outcome` only for malformed input (never for stale evidence -- that is a normal,
 * fully-formed INCOMPLETE record, not an input-validation failure). Exactly one
 * `KERNEL.REVALIDATION` record on a well-formed call: PASS when every item and the
 * root policy are unchanged; INCOMPLETE (reasonCode STALE_EVIDENCE) otherwise.
 * Never FAIL, CONFIGURATION_ERROR or HUMAN_REVIEW_REQUIRED for a stale result:
 * staleness is an incomplete fact, not a violated invariant or a judgment call.
 */
async function revalidateEvidence(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput("a valid subject is required");
  const subject = input.subject;
  if (!isPlainObject(input.report)) return invalidInput("a valid report generated for this subject is required");
  // One bounded JSON snapshot of the consumed report and items, read once (the
  // buildReport() Corrective C3 precedent): a getter or later mutation cannot make
  // the set checked for coverage differ from the set actually re-fetched.
  let report;
  let items;
  try {
    report = cloneJson(input.report);
    items = Array.isArray(input.items) ? cloneJson(input.items) : null;
  } catch {
    return invalidInput("the report or items could not be safely snapshotted");
  }
  const binding = reportBinding(report, subject);
  if (binding === null) return invalidInput("a valid report generated for this subject is required");
  if (items === null) return invalidInput("items must be an array");
  if (items.length > MAX_EXTERNAL_EVIDENCE_ITEMS) return invalidInput("too many external evidence items to revalidate");
  for (const item of items) if (!isValidItem(item)) return invalidInput("each item must be a valid { entry, sourceType }");
  if (!coversExactly(items, binding.evidence)) return invalidInput("items must cover every report externalEvidence entry exactly once and nothing else");
  const rootPolicy = input.rootPolicy;
  if (!isPlainObject(rootPolicy) || Object.keys(rootPolicy).join(",") !== "resolve" || typeof rootPolicy.resolve !== "function") {
    return invalidInput("rootPolicy must be exactly { resolve() }: the governance root is always re-resolved");
  }

  const staleItems = [];
  for (const item of items) {
    const result = await revalidateOne(item, input.adapters);
    if (result.stale) staleItems.push({ sourceObjectId: item.entry.sourceObjectId, reason: result.reason });
  }
  const rootResult = await revalidateRootPolicy(rootPolicy, binding);
  if (rootResult.stale) staleItems.push({ sourceObjectId: "ROOT_POLICY", reason: rootResult.reason });

  const stale = staleItems.length > 0;
  const record = {
    checkId: "KERNEL.REVALIDATION",
    ownerStage: "KERNEL",
    status: stale ? STATUS.INCOMPLETE : STATUS.PASS,
    subject,
    observed: { itemCount: items.length, staleItems: staleItems.slice(0, 32) },
    expected: null,
    reasonCode: stale ? REASON.STALE_EVIDENCE : REASON.OK,
    detail: stale ? `${staleItems.length} externally mutable evidence item(s) could not be confirmed current` : "every externally mutable evidence item matched its accepted version and digest",
    evidenceRefs: [],
  };
  const checked = validateResultRecord(record);
  if (!checked.ok) throw new Error(`internal error: invalid KERNEL.REVALIDATION record: ${checked.problems.join("; ")}`);
  return deepFreeze({ subject, records: [checked.record], outcome: null });
}

module.exports = { revalidateEvidence };
