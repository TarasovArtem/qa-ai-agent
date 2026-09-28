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
const { validateResultRecord } = require("./results");

const MAX_EXTERNAL_EVIDENCE_ITEMS = 256;
const VERIFIED_IMMUTABILITY = new Set(["VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]);
const IMMUTABILITY_VALUES = new Set(["MUTABLE", "VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]);

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

async function revalidateOne(item, adapters) {
  const { entry, sourceType } = item;
  // Only a VERIFIED_* item may skip re-fetch (design section 25a); MUTABLE, and any
  // unrecognized value, is always re-fetched -- an unknown or unverifiable source is MUTABLE.
  if (VERIFIED_IMMUTABILITY.has(entry.immutability)) return { stale: false };
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

async function revalidateRootPolicy(rootPolicy) {
  if (rootPolicy === null || rootPolicy === undefined) return { stale: false };
  if (!isPlainObject(rootPolicy) || typeof rootPolicy.resolve !== "function" || typeof rootPolicy.rootTip !== "string" || typeof rootPolicy.rootPolicyDigest !== "string") {
    return { stale: true, reason: "MALFORMED_ROOT_POLICY_INPUT" };
  }
  let resolved;
  try {
    resolved = await rootPolicy.resolve();
  } catch {
    return { stale: true, reason: "ROOT_POLICY_ADAPTER_THREW" };
  }
  if (!isPlainObject(resolved) || resolved.ok !== true) return { stale: true, reason: "ROOT_POLICY_UNREACHABLE" };
  if (resolved.rootTip !== rootPolicy.rootTip || resolved.digest !== rootPolicy.rootPolicyDigest) return { stale: true, reason: "ROOT_POLICY_CHANGED" };
  return { stale: false };
}

/**
 * revalidateEvidence({ subject, items, adapters, rootPolicy })
 *   subject     the exact run identity every accepted record must already carry
 *   items       bounded array of { entry, sourceType } -- see isValidItem()
 *   adapters    { [sourceType]: { fetch(sourceObjectId) -> {ok, version, digest} } }
 *   rootPolicy  optional { rootTip, rootPolicyDigest, resolve() } -- re-resolves the
 *               governance root tip and compares rootPolicyDigest (design section 25a)
 *
 * Output: the same { subject, records, outcome } shape every stage function uses.
 * `outcome` only for malformed input (never for stale evidence -- that is a normal,
 * fully-formed INCOMPLETE record, not an input-validation failure). Exactly one
 * `KERNEL.REVALIDATION` record on a well-formed call: PASS when every item and the
 * root policy (if supplied) are unchanged; INCOMPLETE (reasonCode STALE_EVIDENCE)
 * otherwise. Never FAIL, CONFIGURATION_ERROR or HUMAN_REVIEW_REQUIRED for a stale
 * result: staleness is an incomplete fact, not a violated invariant or a judgment call.
 */
async function revalidateEvidence(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput("a valid subject is required");
  const subject = input.subject;
  if (!Array.isArray(input.items)) return invalidInput("items must be an array");
  if (input.items.length > MAX_EXTERNAL_EVIDENCE_ITEMS) return invalidInput("too many external evidence items to revalidate");
  for (const item of input.items) if (!isValidItem(item)) return invalidInput("each item must be a valid { entry, sourceType }");

  const staleItems = [];
  for (const item of input.items) {
    const result = await revalidateOne(item, input.adapters);
    if (result.stale) staleItems.push({ sourceObjectId: item.entry.sourceObjectId, reason: result.reason });
  }
  const rootResult = await revalidateRootPolicy(input.rootPolicy);
  if (rootResult.stale) staleItems.push({ sourceObjectId: "ROOT_POLICY", reason: rootResult.reason });

  const stale = staleItems.length > 0;
  const record = {
    checkId: "KERNEL.REVALIDATION",
    ownerStage: "KERNEL",
    status: stale ? STATUS.INCOMPLETE : STATUS.PASS,
    subject,
    observed: { itemCount: input.items.length, staleItems: staleItems.slice(0, 32) },
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
