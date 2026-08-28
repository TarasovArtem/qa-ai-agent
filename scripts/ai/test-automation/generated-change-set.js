/**
 * GeneratedChangeSet v1 (Roadmap #23D).
 *
 * A PROPOSAL for repository text-file changes, bound to one exact validated
 * AutomationPlan and one exact validated AutomationRepositoryContext. It
 * describes what CREATE/MODIFY changes would implement the plan - it never
 * applies them. This module performs ZERO filesystem access, ZERO Git
 * operations, ZERO shell execution, and never mutates the repository.
 *
 * PROPOSAL, NOT AUTHORIZATION (read this before wiring this into anything):
 * a structurally valid GeneratedChangeSet means the proposed changes
 * satisfy this deterministic contract and are bound to the exact validated
 * plan/context supplied - NOTHING MORE. It does NOT mean the changes are
 * human-approved, may be written to disk, may be committed/pushed, are
 * correct or executable, or may bypass any future review gate. See
 * FUTURE_CHANGESET_APPLICATION_REVALIDATION_GUARD and
 * FUTURE_GENERATED_CHANGESET_REVIEW_GUARD below - #23D does not implement
 * either. There is no `approved`/`humanApproved`/`authorized` field
 * anywhere in this contract, by design (unknown fields are rejected).
 *
 * SCOPE IS NEVER PROVIDER-DEFINED: every change's `{path, operation}` must
 * exactly match one entry in the already-validated `automationPlan.plannedChanges`
 * (see buildChangeIndex()/matchChangesToPlan() below) - a provider/caller
 * cannot invent a target path, only supply content for a path the plan
 * itself already committed to before this module ever saw it. On top of
 * that 1:1 binding, every path is independently re-validated for safety
 * (reusing the frozen AutomationPlan v1 path classifiers) and for a fixed
 * set of protected repository areas (`.git`, `.github`, `node_modules`,
 * `.env*`, `package.json`, `package-lock.json`, `secrets`, `credentials`)
 * that AutomationPlan v1 itself has no authorization vocabulary to exempt -
 * so no plan, however it was produced, can route around them.
 *
 * V1 OPERATIONS: CREATE and MODIFY only. No DELETE/RENAME/MOVE/CHMOD/
 * SYMLINK - reducing blast radius and stale-context validation complexity
 * is a deliberate v1 scope decision, not an oversight (Roadmap #23D
 * Section 15). AutomationPlan v1 itself already only supports CREATE/MODIFY
 * (see automation-plan.js's own OPERATIONS), so this is not even a new
 * restriction - it is the same one, re-enforced here independently.
 *
 * CREATE/MODIFY EXISTENCE IS CONTEXT-BOUND, NOT LIVE (read before trusting
 * this for anything beyond what it proves): "does this path already exist"
 * is answered ONLY against the supplied AutomationRepositoryContext's own
 * `repositoryEvidence` snapshot - a bounded sample of files that context
 * happened to read, never a live or exhaustive filesystem listing. An
 * absent entry does not prove a file does not exist in the real
 * repository; it only proves the supplied context did not vouch for it.
 * See FUTURE_CHANGESET_APPLICATION_REVALIDATION_GUARD - a future
 * application stage MUST re-check actual current repository state before
 * ever writing, never trust this module's CREATE/MODIFY conclusions as a
 * live-repository guarantee.
 *
 * DIGESTS ARE CONTENT IDENTITY, NOT AUTHORIZATION (do not repeat the S-2
 * mistake): `automationPlanDigest`/`repositoryContextDigest`/
 * `changeSetDigest` are plain, unkeyed SHA-256 - they prove the artifact
 * is bound to and unchanged from exactly the supplied plan/context/own
 * content, and make stale reuse (a plan or context that has since drifted)
 * detectable. They do NOT prove which model produced the change set, do
 * NOT constitute a signature, and a caller with access to this module's
 * own exported digest primitives can trivially recompute a self-consistent
 * digest for hand-assembled content (exactly like #22F's own
 * recordDigest) - the actual security boundary is the independent,
 * non-digest enforcement this module performs on every validation call
 * (plan binding, context binding, path scope, protected areas, operation
 * semantics, base-content digest) - never the digest alone. See Roadmap
 * #23D Section 151/152.
 *
 * H1-F1 (carried forward, not solved here): `repositoryContext.framework`
 * is a trusted caller declaration, not an objectively verified real-world
 * framework capability. FUTURE_FRAMEWORK_CAPABILITY_PROVENANCE_GUARD
 * remains open at the orchestration level.
 */

"use strict";

const crypto = require("node:crypto");

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId, collectUnknownKeyErrors } = require("../generation/primitives");
const { LIMITS: GENERATION_LIMITS } = require("../generation/limits");
const { validateAutomationPlan, OPERATIONS, isSafeRepoRelativePath, isCanonicalPlanPath } = require("../generation/automation-plan");
// Roadmap #23D-C1 (closes 23D-R-1): repositoryEvidence bound parity with
// this module's own real producible output - read-only reuse of the same
// exported LIMITS object automation-plan-generator.js's own
// validateRepositoryContextSnapshot() already derives its
// MAX_REPOSITORY_EVIDENCE_ITEMS/MAX_EVIDENCE_CONTENT_LENGTH/
// MAX_AGGREGATE_EVIDENCE_LENGTH from - never a separately-maintained
// duplicate that could silently drift out of parity (the exact class of
// gap #23D-R-1 found: this module's own context validator previously
// enforced no bound at all).
const { LIMITS: REPO_CONTEXT_LIMITS } = require("./automation-repository-context");

const KIND = "GeneratedChangeSet";
const SCHEMA_VERSION = 1;

// Roadmap #23D: bounded, documented, centralized limits - never invisible
// magic numbers. Path/change-count bounds mirror the frozen
// AutomationPlan v1's own LIMITS.MAX_PLANNED_CHANGES/SHORT_TEXT_MAX_LENGTH
// (a change set can never legitimately exceed the plan's own bounds,
// since every change is 1:1 bound to a planned change) - content-size
// bounds are new to #23D since AutomationPlan itself carries no file
// content at all.
const LIMITS = Object.freeze({
  MAX_CHANGES: GENERATION_LIMITS.MAX_PLANNED_CHANGES,
  MAX_PATH_LENGTH: GENERATION_LIMITS.SHORT_TEXT_MAX_LENGTH,
  MAX_FILE_CONTENT_LENGTH: 50000,
  MAX_TOTAL_CONTENT_LENGTH: 1000000,
  // Roadmap #23D-C1 (closes 23D-R-1): +1 accounts for the single, always-
  // present framework-config evidence entry automation-repository-
  // context.js's own buildAutomationRepositoryContext() unconditionally
  // prepends (never more than one, never zero for a successfully-built
  // context) - identical derivation to automation-plan-generator.js's own
  // MAX_REPOSITORY_EVIDENCE_ITEMS.
  MAX_REPOSITORY_EVIDENCE_ITEMS: REPO_CONTEXT_LIMITS.MAX_RELEVANT_FILES + 1,
  MAX_EVIDENCE_CONTENT_LENGTH: REPO_CONTEXT_LIMITS.MAX_FILE_CONTENT_LENGTH,
  MAX_AGGREGATE_EVIDENCE_LENGTH: REPO_CONTEXT_LIMITS.MAX_AGGREGATE_EVIDENCE_LENGTH,
});

const FRAMEWORK_PATH_PREFIX = Object.freeze({ cypress: "cypress/", playwright: "playwright/" });

const CHANGE_ALLOWED_KEYS = Object.freeze(["operation", "path", "baseContentDigest", "content"]);

// Roadmap #23D Section 36: repository areas AutomationPlan v1 has no
// authorization vocabulary to exempt, and #23D never invents one - these
// are rejected regardless of what any plan (however produced) proposes.
const PROTECTED_EXACT_BASENAMES = Object.freeze(["package.json", "package-lock.json"]);
const PROTECTED_SEGMENT_PATTERN = /^(\.git|\.github|node_modules|secrets|credentials)$/i;
const PROTECTED_ENV_BASENAME_PATTERN = /^\.env(\..+)?$/i;

function isProtectedPath(canonicalPath) {
  const segments = canonicalPath.split("/");
  const basename = segments[segments.length - 1];
  if (PROTECTED_EXACT_BASENAMES.includes(basename.toLowerCase())) return true;
  if (PROTECTED_ENV_BASENAME_PATTERN.test(basename)) return true;
  return segments.some((segment) => PROTECTED_SEGMENT_PATTERN.test(segment));
}

// --- canonical snapshot / digest primitives -------------------------------
//
// Roadmap #23D: #23 has no existing snapshot/canonicalization/digest
// module of its own (confirmed by source discovery - #22F's
// test-design-review-canonical.js is never imported anywhere in
// scripts/ai/test-automation/ or scripts/ai/generation/), so this section
// is a freshly, independently written #23D-local implementation of the
// SAME hardened pattern #22F established (Object.create(null) +
// Object.defineProperty record snapshotting, manual-indexed dense-array
// copying, explicit `ancestors`-based cycle rejection - never reliance on
// stack-depth exhaustion), matching the repository's own "small duplicated
// primitives, not a shared refactor" convention (already followed
// independently by #22D/#22E/#23C's own reused snapshot mechanisms) -
// never imported from #22F, so a future #22F change can never silently
// affect #23D's trust boundary and vice versa.

const DOMAIN_PREFIX = "qa-ai-agent:";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const LABEL_FILE_CONTENT = "generated-change-set-file-content:v1";
const LABEL_PLAN_BINDING = "generated-change-set-plan-binding:v1";
const LABEL_CONTEXT_BINDING = "generated-change-set-context-binding:v1";
const LABEL_CHANGESET = "generated-change-set:v1";

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function defineOwnSnapshotProperty(out, key, value) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

const CYCLE = Symbol("qa-ai-agent:generated-change-set:cycle-detected");

function snapshotValue(value, ancestors) {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return CYCLE;

  if (Array.isArray(value)) {
    ancestors.add(value);
    const length = value.length;
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
      ancestors.delete(value);
      return null;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      ancestors.delete(value);
      return null;
    }
    const ownKeys = Object.keys(value);
    if (ownKeys.length !== length) {
      ancestors.delete(value);
      return null;
    }
    for (let i = 0; i < length; i += 1) {
      if (ownKeys[i] !== String(i)) {
        ancestors.delete(value);
        return null;
      }
    }
    const out = new Array(length);
    for (let i = 0; i < length; i += 1) {
      const key = String(i);
      const snapshotted = snapshotValue(value[key], ancestors);
      if (snapshotted === CYCLE) {
        ancestors.delete(value);
        return CYCLE;
      }
      defineOwnSnapshotProperty(out, key, snapshotted);
    }
    ancestors.delete(value);
    return out;
  }

  if (!isPlainRecord(value)) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;

  ancestors.add(value);
  const out = Object.create(null);
  for (const key of Object.keys(value)) {
    const snapshotted = snapshotValue(value[key], ancestors);
    if (snapshotted === CYCLE) {
      ancestors.delete(value);
      return CYCLE;
    }
    defineOwnSnapshotProperty(out, key, snapshotted);
  }
  ancestors.delete(value);
  return out;
}

function snapshotOwnData(value) {
  try {
    const result = snapshotValue(value, new Set());
    return result === CYCLE ? null : result;
  } catch {
    return null;
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

function canonicalStringify(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalStringify: non-finite number is not valid digest input");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
  }
  throw new Error("canonicalStringify: unsupported value type for digest input");
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function computeDigest(label, value) {
  return `sha256:${sha256Hex(`${DOMAIN_PREFIX}${label}:${canonicalStringify(value)}`)}`;
}

function isValidDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

// Roadmap #23D Section 77: a digest computed over a JS string that
// contains an unpaired UTF-16 surrogate would silently disagree with a
// digest computed over the UTF-8 bytes a future writer actually produces
// (both directions of that conversion are lossy for unpaired surrogates,
// converging two distinct original strings onto the same byte sequence).
// Round-tripping through UTF-8 and comparing catches this deterministically
// - content that fails this check is rejected outright, never repaired.
function isValidUnicodeText(value) {
  return typeof value === "string" && Buffer.from(value, "utf8").toString("utf8") === value;
}

// --- repository-context shape check (Roadmap #23D-local, mirrors the
// established #23 idiom of a local, non-exported context-shape check
// rather than importing automation-plan-generator.js's private one -
// AutomationRepositoryContext itself exports no separate validator) ------

function validateRepositoryContextSnapshot(context, path, errors, { expectedProjectId } = {}) {
  if (!isPlainRecord(context)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return false;
  }
  let valid = true;
  if (!isValidId(context.projectId)) {
    errors.push(err(`${path}.projectId`, ERROR_CODES.INVALID_TYPE, `${path}.projectId must be a bounded string id`));
    valid = false;
  } else if (expectedProjectId !== undefined && context.projectId !== expectedProjectId) {
    errors.push(err(`${path}.projectId`, ERROR_CODES.PROJECT_MISMATCH, `${path}.projectId does not match the expected project`));
    valid = false;
  }
  if (!["cypress", "playwright"].includes(context.framework)) {
    errors.push(err(`${path}.framework`, ERROR_CODES.INVALID_ENUM, `${path}.framework must be one of cypress, playwright`));
    valid = false;
  }
  if (!Array.isArray(context.repositoryEvidence)) {
    errors.push(err(`${path}.repositoryEvidence`, ERROR_CODES.MISSING_FIELD, `${path}.repositoryEvidence must be an array`));
    return false;
  }
  // Roadmap #23D-C1 (closes 23D-R-1): array-length bound checked BEFORE any
  // per-item content is ever read - a grossly oversized array is rejected
  // in O(1) without ever touching a single item's content, matching
  // automation-plan-generator.js's own "fail fast before doing O(n) work"
  // structure for the identical attack shape (Roadmap #23C-R's forged
  // 25-item x 5MB-each context).
  if (context.repositoryEvidence.length > LIMITS.MAX_REPOSITORY_EVIDENCE_ITEMS) {
    errors.push(err(`${path}.repositoryEvidence`, ERROR_CODES.INVALID_VALUE, `${path}.repositoryEvidence exceeds the maximum of ${LIMITS.MAX_REPOSITORY_EVIDENCE_ITEMS} items`));
    return false;
  }
  // Roadmap #23D-C1 (closes 23D-R-2): evidenceRef.location is this
  // context's identity key for CREATE/MODIFY existence and
  // baseContentDigest lookups (see evidenceByPath in
  // buildGeneratedChangeSet()/generate-change-set.js) - a repeated
  // location is ambiguous (which content is authoritative?) and is
  // rejected outright, fail-closed. Never first-write-wins, never
  // last-write-wins: identical rejection regardless of whether the
  // duplicate pair has the same or different content, and regardless of
  // array order (the same unordered Set-membership check either way).
  const seenLocations = new Set();
  // Roadmap #23D-C1 (closes 23D-R-1): aggregate content length,
  // accumulated only from items whose own shape/per-item-bound/duplicate
  // checks already passed - mirrors automation-plan-generator.js's own
  // "per-item bound first, aggregate bound second" structure.
  let aggregateLength = 0;
  context.repositoryEvidence.forEach((entry, i) => {
    const entryPath = `${path}.repositoryEvidence[${i}]`;
    if (!isPlainRecord(entry) || !isPlainRecord(entry.evidenceRef) || typeof entry.evidenceRef.location !== "string" || typeof entry.content !== "string") {
      errors.push(err(entryPath, ERROR_CODES.INVALID_TYPE, `${entryPath} must be {evidenceRef:{location:string,...}, content:string, ...}`));
      valid = false;
      return;
    }
    if (entry.content.length > LIMITS.MAX_EVIDENCE_CONTENT_LENGTH) {
      errors.push(err(`${entryPath}.content`, ERROR_CODES.INVALID_VALUE, `${entryPath}.content exceeds the maximum of ${LIMITS.MAX_EVIDENCE_CONTENT_LENGTH} characters`));
      valid = false;
      return;
    }
    if (seenLocations.has(entry.evidenceRef.location)) {
      errors.push(err(`${entryPath}.evidenceRef.location`, ERROR_CODES.DUPLICATE_ID, `${entryPath}.evidenceRef.location is a duplicate within repositoryEvidence`));
      valid = false;
      return;
    }
    seenLocations.add(entry.evidenceRef.location);
    aggregateLength += entry.content.length;
  });
  if (aggregateLength > LIMITS.MAX_AGGREGATE_EVIDENCE_LENGTH) {
    errors.push(err(`${path}.repositoryEvidence`, ERROR_CODES.INVALID_VALUE, `${path}.repositoryEvidence aggregate content exceeds the maximum of ${LIMITS.MAX_AGGREGATE_EVIDENCE_LENGTH} characters`));
    valid = false;
  }
  return valid;
}

// --- plan <-> change binding -----------------------------------------------

// Builds a Map from canonical plannedChanges path -> its operation - the
// SOLE source of write-scope authority (Roadmap #23D Section 24/26): a
// change set entry is only ever in scope because the already-validated
// plan itself already committed to that exact {path, operation} pair
// before this module ever ran.
function buildPlanChangeIndex(plan) {
  const index = new Map();
  for (const change of plan.plannedChanges) index.set(change.path, change.operation);
  return index;
}

function validateChangeEntry(change, planOperation, path, errors) {
  if (!isPlainRecord(change)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(change, CHANGE_ALLOWED_KEYS, path, errors);

  if (change.operation !== planOperation) {
    errors.push(err(`${path}.operation`, ERROR_CODES.INVALID_VALUE, `${path}.operation must exactly match the bound plannedChanges operation`));
  } else if (!OPERATIONS.includes(change.operation)) {
    errors.push(err(`${path}.operation`, ERROR_CODES.INVALID_ENUM, `${path}.operation must be one of ${OPERATIONS.join(", ")}`));
  }

  if (typeof change.content !== "string" || change.content.length === 0) {
    errors.push(err(`${path}.content`, ERROR_CODES.MISSING_FIELD, `${path}.content must be a non-empty string`));
  } else if (change.content.length > LIMITS.MAX_FILE_CONTENT_LENGTH) {
    errors.push(err(`${path}.content`, ERROR_CODES.INVALID_VALUE, `${path}.content exceeds the maximum of ${LIMITS.MAX_FILE_CONTENT_LENGTH} characters`));
  } else if (change.content.includes("\u0000")) {
    errors.push(err(`${path}.content`, ERROR_CODES.INVALID_VALUE, `${path}.content must not contain a NUL byte - GeneratedChangeSet v1 is text-only`));
  } else if (!isValidUnicodeText(change.content)) {
    errors.push(err(`${path}.content`, ERROR_CODES.INVALID_VALUE, `${path}.content contains an unpaired Unicode surrogate and cannot be safely digested/written`));
  }
}

/**
 * Deterministically builds one GeneratedChangeSet v1 from an already-
 * validated AutomationPlan, an already-validated AutomationRepositoryContext,
 * and a caller-supplied `changes` array (typically produced by
 * generate-change-set.js's provider-backed generator, but this function
 * itself never calls a provider and never trusts caller declarations
 * beyond what it independently re-verifies here).
 *
 * Returns `{ ok: true, generatedChangeSet }` or `{ ok: false, errors }`.
 */
function buildGeneratedChangeSet({ automationPlan, repositoryContext, changes, expectedProjectId } = {}) {
  let planSnapshot;
  let contextSnapshot;
  let changesSnapshot;
  try {
    planSnapshot = snapshotOwnData(automationPlan);
    contextSnapshot = deepFreeze(snapshotOwnData(repositoryContext));
    changesSnapshot = snapshotOwnData(changes);
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "inputs could not be read")] };
  }

  const errors = [];

  const planValidation = validateAutomationPlan(planSnapshot, { expectedProjectId });
  if (!planValidation.ok) {
    return { ok: false, errors: planValidation.errors.map((e) => err(`$.automationPlan${e.path.slice(1)}`, e.code, e.message)) };
  }
  planSnapshot = deepFreeze(planSnapshot);

  if (!validateRepositoryContextSnapshot(contextSnapshot, "$.repositoryContext", errors, { expectedProjectId })) {
    return { ok: false, errors };
  }

  if (planSnapshot.projectId !== contextSnapshot.projectId) {
    errors.push(err("$.repositoryContext.projectId", ERROR_CODES.PROJECT_MISMATCH, "$.repositoryContext.projectId does not match $.automationPlan.projectId"));
  }
  if (planSnapshot.framework !== contextSnapshot.framework) {
    errors.push(err("$.repositoryContext.framework", ERROR_CODES.INVALID_VALUE, "$.repositoryContext.framework does not match $.automationPlan.framework"));
  }
  if (errors.length > 0) return { ok: false, errors };

  if (!Array.isArray(changesSnapshot)) {
    return { ok: false, errors: [err("$.changes", ERROR_CODES.MISSING_FIELD, "$.changes must be an array")] };
  }
  if (changesSnapshot.length > LIMITS.MAX_CHANGES) {
    return { ok: false, errors: [err("$.changes", ERROR_CODES.INVALID_VALUE, `$.changes exceeds the maximum of ${LIMITS.MAX_CHANGES}`)] };
  }

  const planIndex = buildPlanChangeIndex(planSnapshot);
  const seenPaths = new Set();
  changesSnapshot.forEach((change, i) => {
    const entryPath = `$.changes[${i}]`;
    const changePath = isPlainRecord(change) ? change.path : undefined;
    if (typeof changePath !== "string" || !planIndex.has(changePath)) {
      errors.push(err(`${entryPath}.path`, ERROR_CODES.INVALID_REFERENCE, `${entryPath}.path must exactly match one entry in automationPlan.plannedChanges`));
      return;
    }
    if (seenPaths.has(changePath)) {
      errors.push(err(`${entryPath}.path`, ERROR_CODES.DUPLICATE_ID, `${entryPath}.path is a duplicate within this change set`));
      return;
    }
    seenPaths.add(changePath);
    validateChangeEntry(change, planIndex.get(changePath), entryPath, errors);
  });
  if (errors.length > 0) return { ok: false, errors };

  // Completeness: every plannedChanges entry requires exactly one
  // corresponding change (Roadmap #23D Section 47/48 - target
  // completeness/plan traceability).
  const missing = planSnapshot.plannedChanges.filter((c) => !seenPaths.has(c.path));
  if (missing.length > 0) {
    return { ok: false, errors: [err("$.changes", ERROR_CODES.MISSING_FIELD, "every automationPlan.plannedChanges entry requires exactly one corresponding change; at least one is missing")] };
  }

  // Path safety, framework scope, and protected-area enforcement - applied
  // to every change independently of plan content, since AutomationPlan v1
  // has no vocabulary to exempt a protected area (Roadmap #23D Section
  // 26/36).
  const frameworkPrefix = FRAMEWORK_PATH_PREFIX[planSnapshot.framework];
  const evidenceByPath = new Map(contextSnapshot.repositoryEvidence.map((e) => [e.evidenceRef.location, e]));

  changesSnapshot.forEach((change, i) => {
    const entryPath = `$.changes[${i}]`;
    const p = change.path;
    if (p.length > LIMITS.MAX_PATH_LENGTH) {
      errors.push(err(`${entryPath}.path`, ERROR_CODES.INVALID_PATH, `${entryPath}.path exceeds the maximum length`));
      return;
    }
    if (!isSafeRepoRelativePath(p) || !isCanonicalPlanPath(p)) {
      errors.push(err(`${entryPath}.path`, ERROR_CODES.INVALID_PATH, `${entryPath}.path must be a safe, canonical, repository-relative path`));
      return;
    }
    if (!p.startsWith(frameworkPrefix)) {
      errors.push(err(`${entryPath}.path`, ERROR_CODES.INVALID_PATH, `${entryPath}.path must be within the "${frameworkPrefix}" framework directory`));
      return;
    }
    if (isProtectedPath(p)) {
      errors.push(err(`${entryPath}.path`, ERROR_CODES.INVALID_PATH, `${entryPath}.path targets a protected repository area`));
      return;
    }

    const existing = evidenceByPath.get(p);
    if (change.operation === "CREATE") {
      if (existing) {
        errors.push(err(entryPath, ERROR_CODES.INVARIANT_VIOLATION, `${entryPath}: CREATE target already exists in the bound repository context`));
      }
      if (change.baseContentDigest !== null && change.baseContentDigest !== undefined) {
        errors.push(err(`${entryPath}.baseContentDigest`, ERROR_CODES.INVALID_VALUE, `${entryPath}.baseContentDigest must be absent/null for CREATE`));
      }
    } else {
      // MODIFY
      if (!existing) {
        errors.push(err(entryPath, ERROR_CODES.INVARIANT_VIOLATION, `${entryPath}: MODIFY target does not exist in the bound repository context`));
        return;
      }
      const expectedBaseDigest = computeDigest(LABEL_FILE_CONTENT, existing.content);
      if (change.baseContentDigest !== expectedBaseDigest) {
        errors.push(err(`${entryPath}.baseContentDigest`, ERROR_CODES.INVALID_VALUE, `${entryPath}.baseContentDigest does not match the bound repository context's current content (stale)`));
        return;
      }
      if (change.content === existing.content) {
        errors.push(err(entryPath, ERROR_CODES.INVARIANT_VIOLATION, `${entryPath}: MODIFY content is identical to the existing bound content (no-op)`));
      }
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const totalContentLength = changesSnapshot.reduce((sum, c) => sum + c.content.length, 0);
  if (totalContentLength > LIMITS.MAX_TOTAL_CONTENT_LENGTH) {
    return { ok: false, errors: [err("$.changes", ERROR_CODES.INVALID_VALUE, `total change content exceeds the maximum of ${LIMITS.MAX_TOTAL_CONTENT_LENGTH} characters`)] };
  }

  // Canonical order = plannedChanges order, never caller/provider array
  // order (Roadmap #23D Section 45/82/83 - deterministic, order-independent
  // digest).
  const changesByPath = new Map(changesSnapshot.map((c) => [c.path, c]));
  const orderedChanges = planSnapshot.plannedChanges.map((planned) => {
    const c = changesByPath.get(planned.path);
    return { operation: c.operation, path: c.path, baseContentDigest: c.baseContentDigest === undefined ? null : c.baseContentDigest, content: c.content };
  });

  const automationPlanDigest = computeDigest(LABEL_PLAN_BINDING, planSnapshot);
  const repositoryContextDigest = computeDigest(LABEL_CONTEXT_BINDING, contextSnapshot);

  const changeSetContent = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    projectId: planSnapshot.projectId,
    automationPlanId: planSnapshot.id,
    automationPlanDigest,
    repositoryContextDigest,
    changes: orderedChanges,
  };

  const changeSetDigest = computeDigest(LABEL_CHANGESET, changeSetContent);

  return { ok: true, generatedChangeSet: deepFreeze({ ...changeSetContent, changeSetDigest }) };
}

/**
 * Independently re-validates an already-serialized GeneratedChangeSet
 * against FRESH AutomationPlan/AutomationRepositoryContext inputs -
 * recomputing every binding digest and the change-set's own digest rather
 * than trusting any stored value. Used by any future stage that consumes
 * a GeneratedChangeSet produced earlier (this module never assumes the
 * artifact it is asked to validate was actually produced by
 * buildGeneratedChangeSet() in this same process).
 *
 * Returns `{ ok: true }` or `{ ok: false, errors }`.
 */
function validateGeneratedChangeSet({ automationPlan, repositoryContext, generatedChangeSet, expectedProjectId } = {}) {
  if (!isPlainRecord(generatedChangeSet) || generatedChangeSet.kind !== KIND || generatedChangeSet.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, errors: [err("$.generatedChangeSet", ERROR_CODES.INVALID_TYPE, "$.generatedChangeSet must be a valid GeneratedChangeSet v1")] };
  }

  let planSnapshot;
  let contextSnapshot;
  try {
    planSnapshot = snapshotOwnData(automationPlan);
    contextSnapshot = snapshotOwnData(repositoryContext);
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "inputs could not be read")] };
  }

  const planValidation = validateAutomationPlan(planSnapshot, { expectedProjectId });
  if (!planValidation.ok) {
    return { ok: false, errors: [err("$.automationPlan", ERROR_CODES.INVALID_TYPE, "$.automationPlan is not a valid AutomationPlan v1")] };
  }
  const contextErrors = [];
  if (!validateRepositoryContextSnapshot(contextSnapshot, "$.repositoryContext", contextErrors, { expectedProjectId })) {
    return { ok: false, errors: contextErrors };
  }

  if (expectedProjectId !== undefined && generatedChangeSet.projectId !== expectedProjectId) {
    return { ok: false, errors: [err("$.generatedChangeSet.projectId", ERROR_CODES.PROJECT_MISMATCH, "does not match the expected project")] };
  }

  const freshPlanDigest = computeDigest(LABEL_PLAN_BINDING, planSnapshot);
  if (freshPlanDigest !== generatedChangeSet.automationPlanDigest) {
    return { ok: false, errors: [err("$.generatedChangeSet.automationPlanDigest", ERROR_CODES.INVALID_REFERENCE, "does not match the current automationPlan content (stale or mismatched plan)")] };
  }
  const freshContextDigest = computeDigest(LABEL_CONTEXT_BINDING, contextSnapshot);
  if (freshContextDigest !== generatedChangeSet.repositoryContextDigest) {
    return { ok: false, errors: [err("$.generatedChangeSet.repositoryContextDigest", ERROR_CODES.INVALID_REFERENCE, "does not match the current repositoryContext content (stale or mismatched context)")] };
  }

  const recomputed = recomputeChangeSetDigest(generatedChangeSet);
  if (recomputed === null || recomputed !== generatedChangeSet.changeSetDigest) {
    return { ok: false, errors: [err("$.generatedChangeSet.changeSetDigest", ERROR_CODES.INVALID_VALUE, "$.generatedChangeSet content does not match its own stored digest")] };
  }

  return { ok: true, errors: [] };
}

/**
 * Recomputes a change set's own digest from its content (excluding the
 * stored digest field itself) - never trusts the stored value.
 */
function recomputeChangeSetDigest(generatedChangeSet) {
  if (!isPlainObject(generatedChangeSet)) return null;
  const { changeSetDigest, ...rest } = generatedChangeSet;
  try {
    return computeDigest(LABEL_CHANGESET, rest);
  } catch {
    return null;
  }
}

module.exports = {
  KIND,
  SCHEMA_VERSION,
  LIMITS,
  FRAMEWORK_PATH_PREFIX,
  DIGEST_PATTERN,
  LABEL_FILE_CONTENT,
  LABEL_PLAN_BINDING,
  LABEL_CONTEXT_BINDING,
  LABEL_CHANGESET,
  isProtectedPath,
  isValidUnicodeText,
  isValidDigest,
  computeDigest,
  snapshotOwnData,
  deepFreeze,
  validateRepositoryContextSnapshot,
  buildGeneratedChangeSet,
  validateGeneratedChangeSet,
  recomputeChangeSetDigest,
};
