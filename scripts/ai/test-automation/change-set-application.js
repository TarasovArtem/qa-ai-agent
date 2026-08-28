/**
 * Safe GeneratedChangeSet application (Roadmap #23F - "Application-Time
 * Revalidation + Safe Application"). #23F is a PROPOSED NEW roadmap
 * identifier, adopted by this implementation (see the #23-RD discovery
 * mission and #23F's own mission text) - it is not prior repository
 * nomenclature.
 *
 * This is the FIRST module in the QA AI Agent that is allowed to write to
 * the real repository filesystem. Every prior #22/#23 stage
 * (AutomationPlan, GeneratedChangeSet, GeneratedChangeSetReviewPackage/
 * Record) is deliberately non-mutating - see their own docstrings. #23F is
 * the deliberate, narrow trust-boundary transition where that changes.
 * Treat every function in this module as security-sensitive.
 *
 * WHAT #23F ANSWERS: "can this exact, human-reviewed, APPROVED
 * GeneratedChangeSet still be safely applied to the ACTUAL repository state
 * right now?" A valid #23E APPROVE decision is NECESSARY but never
 * SUFFICIENT - it proves a human decision was bound to exact proposal
 * content, never that the real repository is still in the state the
 * proposal assumed. This module is the sole owner of that second half:
 * FUTURE_CHANGESET_APPLICATION_REVALIDATION_GUARD.
 *
 * AUTHORITY CHAIN (no step may be skipped): AutomationPlan v1 ->
 * GeneratedChangeSet v1 -> GeneratedChangeSetReviewPackage v1 ->
 * GeneratedChangeSetReviewRecord v1 -> validateApprovedGeneratedChangeSetReview()
 * -> (this module) application-time revalidation -> safe application ->
 * AppliedChangeSetRecord v1 (applied-change-set-record.js). Every upstream
 * contract is frozen and consumed here exactly as-is - no field is ever
 * added to GeneratedChangeSet/ReviewPackage/ReviewRecord to carry
 * application-time state.
 *
 * SECURITY MODEL (read before changing anything below):
 *   - A structurally valid #23E APPROVED review is required before this
 *     module inspects the filesystem at all.
 *   - The `generatedChangeSet` supplied to applyApprovedGeneratedChangeSet()
 *     must be digest-identical (changeSetDigest) to the one the approved
 *     review package was built from - a differently-content changeset with
 *     the same id/path never reaches the mutation phase.
 *   - The ACTUAL filesystem is authoritative at apply time, never the
 *     historical AutomationRepositoryContext a plan/change-set happened to
 *     be built from (see generated-change-set.js's own "CREATE/MODIFY
 *     EXISTENCE IS CONTEXT-BOUND, NOT LIVE" warning) - this module re-reads
 *     real files and never trusts that context's own existence/content
 *     conclusions.
 *   - Lexical path validation alone is never treated as sufficient -
 *     symlinks (both the target itself and every existing ancestor
 *     directory between repositoryRoot and the target) are rejected
 *     outright, never followed. This is a deliberate, safest v1 default,
 *     not a completeness gap: a future stage could add narrow, reviewed
 *     safe-follow semantics if a real need is demonstrated.
 *   - CREATE requires the target to be genuinely absent (via lstat, which
 *     also correctly rejects a pre-existing symlink/directory/special
 *     file at that path) and is committed with an OS-level exclusive
 *     create (`wx` flag) so a target that appears between validation and
 *     write is never silently overwritten.
 *   - MODIFY requires the target to currently be an ordinary regular file,
 *     not a symlink, with exactly one hard link, whose ACTUAL current byte
 *     content digests to exactly the change's own `baseContentDigest` -
 *     any drift (including a drift that happens to end in the same
 *     proposed bytes) is rejected as stale, never silently accepted.
 *   - Every predictable precondition for EVERY change in the batch is
 *     validated BEFORE the first real target mutation (Phase 5) - one
 *     invalid target anywhere in the batch means zero writes anywhere in
 *     the batch.
 *   - MODIFY uses same-directory exclusive temp-file staging plus an
 *     atomic rename-replace, with a FINAL revalidation of the real target
 *     immediately before that rename (a residual race window remains
 *     between that check and the rename syscall - this is an honest,
 *     documented platform limitation, not a claimed guarantee).
 *   - Every write is verified by re-reading the actual resulting bytes
 *     before being reported as applied - a successful `writeFile`/`rename`
 *     call alone is never treated as proof.
 *   - If a later change in the same batch fails after earlier changes were
 *     already committed, this module attempts best-effort rollback
 *     (compensating delete for CREATE, byte-restore for MODIFY) - each
 *     compensation re-checks that the target still holds exactly what THIS
 *     application wrote before touching it again, and refuses to overwrite
 *     externally-raced content. Whole-change-set filesystem atomicity is
 *     NEVER claimed - see APPLICATION_FAILED_ROLLBACK_INCOMPLETE.
 *   - No content normalization of any kind (no formatter, no line-ending
 *     conversion, no BOM handling) - the exact approved bytes are written,
 *     because human approval was bound to those exact bytes.
 *
 * OUT OF SCOPE FOR #23F v1 (deliberately, not an oversight):
 *   - No provider/AI call of any kind.
 *   - No Git read or write of any kind (add/commit/push/checkout/branch) -
 *     application safety is derived entirely from exact artifact digests
 *     plus real target-file state, never from Git history/cleanliness.
 *   - No generated-code execution, no Cypress/Playwright run, no shell/
 *     child_process invocation of any kind.
 *   - No DELETE/RENAME/MOVE/CHMOD/SYMLINK support - only the same CREATE/
 *     MODIFY vocabulary GeneratedChangeSet v1 itself carries.
 *   - No recursive directory creation - a CREATE's parent directory must
 *     already exist on the real filesystem.
 *   - No repository-wide scan of any kind - every filesystem read this
 *     module performs is scoped to a change's own target path and its own
 *     direct parent directory, bounded by the already-bounded change count
 *     (GeneratedChangeSet v1's own MAX_CHANGES).
 *
 * #23G (not started) will own controlled execution of what this module
 * applies - AppliedChangeSetRecord v1 gives it enough identity (exact
 * paths and resulting content digests) to know what bytes now exist,
 * without this module ever running them itself.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { ERROR_CODES, err } = require("../generation/errors");
const { OPERATIONS, isSafeRepoRelativePath, isCanonicalPlanPath } = require("../generation/automation-plan");
const { isCanonicalPathInsideRoot } = require("../context-utils");
const {
  validateGeneratedChangeSet,
  computeDigest: computeContentDigest,
  LABEL_FILE_CONTENT,
} = require("./generated-change-set");
const { validateApprovedGeneratedChangeSetReview } = require("./generated-change-set-review-record");
const {
  isValidTimestamp,
  snapshotOwnData,
  deepFreeze,
  buildAppliedChangeSetRecord,
} = require("./applied-change-set-record");

const WRITE_ENCODING = "utf8";

// Roadmap #23F Section 115/116: a byte bound checked via fs.statSync/read-
// back length, BEFORE unbounded content is ever fully buffered - a stale
// repository file could otherwise be arbitrarily large. Set with the same
// "4x headroom over the character bound, for multi-byte UTF-8" rationale
// automation-repository-context.js's own MAX_FILE_BYTES already documents,
// scaled to GeneratedChangeSet v1's own MAX_FILE_CONTENT_LENGTH (50000
// characters) rather than that module's much smaller evidence bound - a
// MODIFY target's real size is expected to be in the same class as the
// change's own proposed content, never larger by an unbounded amount.
const MAX_ACTUAL_FILE_BYTES = 200000;

function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function safeLstat(absPath) {
  try {
    return fs.lstatSync(absPath);
  } catch {
    return null;
  }
}

// Roadmap #23F Section 12/28/160-164: repositoryRoot is trusted-
// orchestration mutation authority, never provider/GeneratedChangeSet-
// selected. Must be a primitive, non-empty, control-character-free,
// absolute string that resolves (via realpath, so a symlinked root is
// itself resolved exactly once) to an existing directory. No implicit
// String() coercion - a non-string (including a boxed String object) is
// rejected by the `typeof` check alone.
function resolveRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) return { ok: false };
  if (hasControlChar(repositoryRoot)) return { ok: false };
  if (!path.isAbsolute(repositoryRoot)) return { ok: false };
  let real;
  try {
    real = fs.realpathSync(repositoryRoot);
  } catch {
    return { ok: false };
  }
  let stat;
  try {
    stat = fs.statSync(real);
  } catch {
    return { ok: false };
  }
  if (!stat.isDirectory()) return { ok: false };
  return { ok: true, realRoot: real };
}

// Roadmap #23F Section 25-28/70: walks every existing ancestor directory
// component between realRoot and the target's own parent, using lstat
// (never stat/realpath, which would themselves follow a symlink) - if ANY
// component along the way is a symlink, the whole target is rejected. This
// is the safest v1 default (Section 27: "do not attempt clever safe-follow
// semantics") - a symlinked ancestor could otherwise redirect a lexically
// in-scope path to an arbitrary outside-root physical location. A missing
// ancestor also rejects (Section 29: CREATE never recursively creates
// directories - the parent must already exist). Containment is re-checked
// with context-utils.js's own segment-aware isCanonicalPathInsideRoot() -
// deliberately not a bare string-prefix check (Section 23's documented
// "/root/project-evil" sibling-prefix bug class).
function inspectApplicationTarget(realRoot, relPath) {
  const segments = relPath.split("/");
  let cumulative = realRoot;
  for (let i = 0; i < segments.length - 1; i += 1) {
    cumulative = path.join(cumulative, segments[i]);
    const lst = safeLstat(cumulative);
    if (lst === null) return { ok: false, reason: "PARENT_MISSING" };
    if (lst.isSymbolicLink()) return { ok: false, reason: "PARENT_SYMLINK" };
    if (!lst.isDirectory()) return { ok: false, reason: "PARENT_NOT_DIRECTORY" };
  }
  const parentAbs = segments.length > 1 ? path.join(realRoot, ...segments.slice(0, -1)) : realRoot;
  if (!isCanonicalPathInsideRoot({ root: realRoot, candidate: parentAbs })) {
    return { ok: false, reason: "ESCAPE" };
  }
  const targetAbs = path.join(realRoot, relPath);
  if (!isCanonicalPathInsideRoot({ root: realRoot, candidate: targetAbs })) {
    return { ok: false, reason: "ESCAPE" };
  }
  return { ok: true, parentAbs, targetAbs, targetLstat: safeLstat(targetAbs) };
}

// Roadmap #23F Section 30/84: CREATE means a genuinely absent filesystem
// entry - lstat (non-following) correctly treats an existing file,
// directory, symlink, or any other special entry at that path as "not
// absent", never merely "not a regular file".
function inspectCreateTarget(targetLstat) {
  if (targetLstat !== null) return { ok: false, reason: "EXISTS" };
  return { ok: true };
}

// Roadmap #23F Section 32-33/43/115-117/151: MODIFY requires the actual
// target to currently be an ordinary regular file (never a symlink,
// directory, or special file), with exactly one hard link (Section 43's
// chosen safest v1 policy - rejects rather than risking an unintended
// second path being affected), within the bounded actual-size envelope
// BEFORE any content is read, and whose real current bytes digest to
// EXACTLY the change's own expected `baseContentDigest` - computed with
// the identical LABEL_FILE_CONTENT/computeDigest primitive #23D itself
// used to produce that field (a fresh, independently-defined digest domain
// here could never agree with it, by design of a domain-separated hash).
function inspectModifyTarget(targetAbs, targetLstat, expectedBaseDigest) {
  if (targetLstat === null) return { ok: false, reason: "MISSING" };
  if (targetLstat.isSymbolicLink()) return { ok: false, reason: "SYMLINK" };
  if (!targetLstat.isFile()) return { ok: false, reason: "NOT_REGULAR_FILE" };
  if (targetLstat.nlink > 1) return { ok: false, reason: "HARDLINK" };
  if (targetLstat.size > MAX_ACTUAL_FILE_BYTES) return { ok: false, reason: "OVERSIZED" };
  let content;
  try {
    content = fs.readFileSync(targetAbs, WRITE_ENCODING);
  } catch {
    return { ok: false, reason: "READ_FAILED" };
  }
  // Section 117: bound re-checked after the read too (a file that grew
  // between stat and read is caught here rather than accepted merely
  // because the initial stat looked bounded).
  if (Buffer.byteLength(content, WRITE_ENCODING) > MAX_ACTUAL_FILE_BYTES) {
    return { ok: false, reason: "OVERSIZED" };
  }
  const actualDigest = computeContentDigest(LABEL_FILE_CONTENT, content);
  if (actualDigest !== expectedBaseDigest) {
    return { ok: false, reason: "STALE" };
  }
  return { ok: true, actualDigest, content };
}

// Roadmap #23F Section 38-40: a deterministic, platform-independent
// safest-default posture - two batch changes whose paths differ ONLY by
// case are always rejected, regardless of whether the CI/production host
// filesystem is actually case-sensitive. This is a conservative default
// (Section 26/27's "do not attempt clever platform-detection" posture),
// never a runtime filesystem probe.
function detectBatchCaseCollisions(changes) {
  const byLower = new Map();
  for (const c of changes) {
    const lower = c.path.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, new Set());
    byLower.get(lower).add(c.path);
  }
  for (const set of byLower.values()) {
    if (set.size > 1) return true;
  }
  return false;
}

// Roadmap #23F Section 39/94/118-120: bounded to exactly ONE direct parent
// directory listing per CREATE target (never a recursive/repository-wide
// scan) - detects a CREATE target colliding, under case-insensitive
// comparison, with an ALREADY-EXISTING sibling entry the exact-match lstat
// check above would otherwise miss on a case-sensitive host.
function detectCaseCollisionAgainstDirectory(parentAbs, targetBasename) {
  let entries;
  try {
    entries = fs.readdirSync(parentAbs);
  } catch {
    return false;
  }
  const targetLower = targetBasename.toLowerCase();
  return entries.some((name) => name !== targetBasename && name.toLowerCase() === targetLower);
}

// Roadmap #23F Section 44-46: same-parent-directory, exclusive-create,
// unpredictable-filename temp staging - `wx` guarantees the OS itself
// rejects a name collision, and same-directory placement maximizes the
// chance a later rename onto the real target is a same-filesystem atomic
// operation.
function stageTempFile(parentAbs, targetBasename, content) {
  const tempName = `.23f-tmp-${targetBasename}-${crypto.randomBytes(8).toString("hex")}`;
  const tempAbs = path.join(parentAbs, tempName);
  fs.writeFileSync(tempAbs, content, { encoding: WRITE_ENCODING, flag: "wx" });
  return tempAbs;
}

function verifyWrittenContent(targetAbs, expectedContent) {
  let actual;
  try {
    actual = fs.readFileSync(targetAbs, WRITE_ENCODING);
  } catch {
    return false;
  }
  return actual === expectedContent;
}

function cleanupTemp(tempAbs) {
  if (!tempAbs) return;
  try {
    fs.unlinkSync(tempAbs);
  } catch {
    // best-effort only - a leaked, unpredictably-named, exclusively-created
    // temp file is inert (never a valid application target itself) and is
    // not itself a security concern.
  }
}

// Roadmap #23F Section 101/107: rollback of a CREATE this SAME application
// attempt performed - never an arbitrary remove. The identity check (actual
// current bytes still equal exactly what this attempt wrote) is required
// immediately before deletion; if the target has since changed, this
// refuses to delete it and reports incomplete rollback instead (Section
// 103: never blindly destroy externally-raced content).
function rollbackCreate(targetAbs, writtenContent) {
  let actual;
  try {
    actual = fs.readFileSync(targetAbs, WRITE_ENCODING);
  } catch {
    return { ok: false };
  }
  if (actual !== writtenContent) return { ok: false };
  try {
    fs.unlinkSync(targetAbs);
  } catch {
    return { ok: false };
  }
  return { ok: true };
}

// Roadmap #23F Section 102-103: restores exactly the original bytes this
// application attempt itself captured before mutating - via the same
// exclusive-temp-plus-rename primitive used for the original commit, with
// the identical identity guard (current content must still equal exactly
// what THIS attempt wrote) before restoring.
function rollbackModify(targetAbs, writtenContent, originalContent) {
  let actual;
  try {
    actual = fs.readFileSync(targetAbs, WRITE_ENCODING);
  } catch {
    return { ok: false };
  }
  if (actual !== writtenContent) return { ok: false };
  const parentAbs = path.dirname(targetAbs);
  const basename = path.basename(targetAbs);
  let tempAbs;
  try {
    tempAbs = stageTempFile(parentAbs, basename, originalContent);
  } catch {
    return { ok: false };
  }
  try {
    fs.renameSync(tempAbs, targetAbs);
  } catch {
    cleanupTemp(tempAbs);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Applies an already #23E-APPROVED GeneratedChangeSet to the real
 * repository filesystem beneath `repositoryRoot`, after independently
 * revalidating every precondition against ACTUAL current filesystem state.
 *
 * `input` shape: { expectedProjectId, repositoryRoot, automationPlan,
 * repositoryContext, generatedChangeSet, reviewPackage, reviewRecord,
 * appliedAt }.
 *
 * Returns one of:
 *  - `{ ok: false, errors, appliedChangeSetRecord: null }` - a precondition
 *    was rejected before any real target was mutated (writes = 0). This
 *    includes an invalid/non-APPROVED review, a stale/mismatched
 *    changeSet, an invalid repositoryRoot, or ANY change in the batch
 *    failing its own real-filesystem precondition (Section 17: one invalid
 *    target means zero writes for the whole batch).
 *  - `{ ok: true, errors: [], appliedChangeSetRecord }` - every change was
 *    written and independently re-verified; `appliedChangeSetRecord.status
 *    === "APPLIED"`.
 *  - `{ ok: false, errors, appliedChangeSetRecord }` - a runtime failure
 *    occurred after at least one real target was already mutated;
 *    `appliedChangeSetRecord.status` is `"APPLICATION_FAILED_ROLLED_BACK"`
 *    (every prior mutation was verifiably compensated) or
 *    `"APPLICATION_FAILED_ROLLBACK_INCOMPLETE"` (at least one compensation
 *    could not be safely completed - the repository may be left partially
 *    mutated; this is the most severe result and is never conflated with a
 *    clean rejection).
 */
function applyApprovedGeneratedChangeSet(input) {
  const { expectedProjectId, repositoryRoot, automationPlan, repositoryContext, generatedChangeSet, reviewPackage, reviewRecord, appliedAt } = isPlainObjectLike(input) ? input : {};

  // Phase 2 (mission ordering): the #23E approval gate is the cheapest,
  // most authority-critical check - it never touches the filesystem, so it
  // runs before repositoryRoot is even inspected.
  const approval = validateApprovedGeneratedChangeSetReview(reviewPackage, reviewRecord, { expectedProjectId });
  if (!approval.ok) {
    return { ok: false, errors: approval.errors, appliedChangeSetRecord: null };
  }

  // Phase 1 (re-verify): the fresh generatedChangeSet must itself pass
  // #23D's own unmodified validation against the supplied plan/context.
  const changeSetValidation = validateGeneratedChangeSet({ automationPlan, repositoryContext, generatedChangeSet, expectedProjectId });
  if (!changeSetValidation.ok) {
    return { ok: false, errors: changeSetValidation.errors, appliedChangeSetRecord: null };
  }

  let changeSetSnapshot;
  let reviewPackageSnapshot;
  let reviewRecordSnapshot;
  try {
    changeSetSnapshot = deepFreeze(snapshotOwnData(generatedChangeSet));
    reviewPackageSnapshot = deepFreeze(snapshotOwnData(reviewPackage));
    reviewRecordSnapshot = deepFreeze(snapshotOwnData(reviewRecord));
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "inputs could not be read")], appliedChangeSetRecord: null };
  }

  // Exact-content binding (Section 81/128/129/132): the changeset about to
  // be applied must be digest-identical to the one the approved review
  // package was built from - never trust that "some approval exists" is
  // enough on its own.
  if (changeSetSnapshot.changeSetDigest !== reviewPackageSnapshot.changeSetDigest) {
    return {
      ok: false,
      errors: [err("$.generatedChangeSet.changeSetDigest", ERROR_CODES.INVALID_REFERENCE, "generatedChangeSet does not match the exact content that was reviewed and approved (stale or mismatched proposal)")],
      appliedChangeSetRecord: null,
    };
  }

  if (!isValidTimestamp(appliedAt)) {
    return { ok: false, errors: [err("$.appliedAt", ERROR_CODES.INVALID_VALUE, "$.appliedAt must be a UTC ISO-8601 timestamp")], appliedChangeSetRecord: null };
  }

  // Phase 3: resolve repositoryRoot - the first real filesystem access.
  const rootResult = resolveRepositoryRoot(repositoryRoot);
  if (!rootResult.ok) {
    return { ok: false, errors: [err("$.repositoryRoot", ERROR_CODES.INVALID_VALUE, "$.repositoryRoot must be an absolute, existing, resolvable directory")], appliedChangeSetRecord: null };
  }
  const realRoot = rootResult.realRoot;

  const changes = changeSetSnapshot.changes;

  if (detectBatchCaseCollisions(changes)) {
    return {
      ok: false,
      errors: [err("$.generatedChangeSet.changes", ERROR_CODES.INVARIANT_VIOLATION, "two or more changes resolve to the same case-insensitive path identity")],
      appliedChangeSetRecord: null,
    };
  }

  // Phase 4/5: re-read actual target filesystem state and validate EVERY
  // precondition for EVERY change before the first write anywhere.
  const plan = [];
  const precheckErrors = [];
  for (let i = 0; i < changes.length; i += 1) {
    const change = changes[i];
    const entryPath = `$.generatedChangeSet.changes[${i}]`;

    if (!OPERATIONS.includes(change.operation) || !isSafeRepoRelativePath(change.path) || !isCanonicalPlanPath(change.path)) {
      precheckErrors.push(err(`${entryPath}.path`, ERROR_CODES.INVALID_PATH, `${entryPath}.path must be a safe, canonical, repository-relative path`));
      continue;
    }

    const inspected = inspectApplicationTarget(realRoot, change.path);
    if (!inspected.ok) {
      precheckErrors.push(err(entryPath, ERROR_CODES.INVARIANT_VIOLATION, `${entryPath}: target location is not safe to apply to (${inspected.reason})`));
      continue;
    }

    if (change.operation === "CREATE") {
      const createCheck = inspectCreateTarget(inspected.targetLstat);
      if (!createCheck.ok) {
        precheckErrors.push(err(entryPath, ERROR_CODES.INVARIANT_VIOLATION, `${entryPath}: CREATE target already exists on the actual filesystem`));
        continue;
      }
      if (detectCaseCollisionAgainstDirectory(inspected.parentAbs, path.basename(change.path))) {
        precheckErrors.push(err(entryPath, ERROR_CODES.INVARIANT_VIOLATION, `${entryPath}: CREATE target collides with an existing entry under case-insensitive comparison`));
        continue;
      }
      plan.push({ kind: "CREATE", change, parentAbs: inspected.parentAbs, targetAbs: inspected.targetAbs });
    } else {
      const modifyCheck = inspectModifyTarget(inspected.targetAbs, inspected.targetLstat, change.baseContentDigest);
      if (!modifyCheck.ok) {
        precheckErrors.push(err(entryPath, ERROR_CODES.INVARIANT_VIOLATION, `${entryPath}: MODIFY target is not in the expected actual state (${modifyCheck.reason})`));
        continue;
      }
      plan.push({ kind: "MODIFY", change, parentAbs: inspected.parentAbs, targetAbs: inspected.targetAbs, beforeDigest: modifyCheck.actualDigest, beforeContent: modifyCheck.content });
    }
  }

  if (precheckErrors.length > 0) {
    return { ok: false, errors: precheckErrors, appliedChangeSetRecord: null };
  }

  // Phase 6: stage every MODIFY's temp file before any real target is
  // touched. CREATE has no separate staging step - its atomicity/
  // exclusivity comes from the OS-level `wx` flag on the real target
  // itself at commit time (Section 31), not from a temp-file dance that
  // would add complexity without reducing risk for a target with no prior
  // content to protect.
  const staged = [];
  let stagingFailed = false;
  for (const item of plan) {
    if (item.kind === "MODIFY") {
      try {
        const tempAbs = stageTempFile(item.parentAbs, path.basename(item.targetAbs), item.change.content);
        staged.push({ ...item, tempAbs });
      } catch {
        staged.push({ ...item, tempAbs: null });
        stagingFailed = true;
        break;
      }
    } else {
      staged.push({ ...item, tempAbs: null });
    }
  }

  if (stagingFailed) {
    staged.forEach((s) => cleanupTemp(s.tempAbs));
    return { ok: false, errors: [err("$", ERROR_CODES.INVARIANT_VIOLATION, "staging failed before any authoritative filesystem mutation")], appliedChangeSetRecord: null };
  }

  // Phase 7/8: commit loop - final revalidation immediately before each
  // real mutation, then the mutation itself, then post-write verification.
  const committed = [];
  let failureIndex = -1;
  let failureReason = null;

  for (let i = 0; i < staged.length; i += 1) {
    const item = staged[i];
    if (item.kind === "CREATE") {
      const finalCheck = inspectCreateTarget(safeLstat(item.targetAbs));
      if (!finalCheck.ok) {
        failureIndex = i;
        failureReason = "CREATE_RACE";
        break;
      }
      try {
        fs.writeFileSync(item.targetAbs, item.change.content, { encoding: WRITE_ENCODING, flag: "wx" });
      } catch {
        failureIndex = i;
        failureReason = "WRITE_FAILED";
        break;
      }
      if (!verifyWrittenContent(item.targetAbs, item.change.content)) {
        failureIndex = i;
        failureReason = "VERIFY_FAILED";
        break;
      }
      committed.push({ kind: "CREATE", targetAbs: item.targetAbs, change: item.change, beforeDigest: null, afterContent: item.change.content });
    } else {
      const finalCheck = inspectModifyTarget(item.targetAbs, safeLstat(item.targetAbs), item.change.baseContentDigest);
      if (!finalCheck.ok) {
        cleanupTemp(item.tempAbs);
        failureIndex = i;
        failureReason = "MODIFY_RACE";
        break;
      }
      try {
        fs.renameSync(item.tempAbs, item.targetAbs);
      } catch {
        cleanupTemp(item.tempAbs);
        failureIndex = i;
        failureReason = "WRITE_FAILED";
        break;
      }
      if (!verifyWrittenContent(item.targetAbs, item.change.content)) {
        failureIndex = i;
        failureReason = "VERIFY_FAILED";
        break;
      }
      committed.push({ kind: "MODIFY", targetAbs: item.targetAbs, change: item.change, beforeDigest: item.beforeDigest, beforeContent: item.beforeContent, afterContent: item.change.content });
    }
  }

  if (failureIndex !== -1) {
    for (let i = failureIndex + 1; i < staged.length; i += 1) {
      cleanupTemp(staged[i].tempAbs);
    }
  }

  if (failureIndex === -1) {
    const changeRecords = committed.map((c) => ({
      operation: c.kind,
      path: c.change.path,
      beforeDigest: c.kind === "MODIFY" ? c.beforeDigest : null,
      afterDigest: computeContentDigest(LABEL_FILE_CONTENT, c.afterContent),
      status: "APPLIED",
    }));
    const built = buildAppliedChangeSetRecord({
      projectId: changeSetSnapshot.projectId,
      changeSetDigest: changeSetSnapshot.changeSetDigest,
      reviewPackageDigest: reviewPackageSnapshot.packageDigest,
      reviewRecordDigest: reviewRecordSnapshot.recordDigest,
      changes: changeRecords,
      status: "APPLIED",
      appliedAt,
    });
    if (!built.ok) {
      return { ok: false, errors: built.errors, appliedChangeSetRecord: null };
    }
    return { ok: true, errors: [], appliedChangeSetRecord: built.appliedChangeSetRecord };
  }

  // A runtime failure occurred at `failureIndex`. If nothing was ever
  // actually committed to a real target (failure on the very first item),
  // this is equivalent to zero writes - no AppliedChangeSetRecord is built
  // (Section 62).
  if (committed.length === 0) {
    return { ok: false, errors: [err("$", ERROR_CODES.INVARIANT_VIOLATION, `application failed before any target was mutated (${failureReason})`)], appliedChangeSetRecord: null };
  }

  // Roll back every real mutation already committed, in reverse order.
  let rollbackAllOk = true;
  const rollbackOk = [];
  for (let i = committed.length - 1; i >= 0; i -= 1) {
    const c = committed[i];
    const result = c.kind === "CREATE" ? rollbackCreate(c.targetAbs, c.afterContent) : rollbackModify(c.targetAbs, c.afterContent, c.beforeContent);
    rollbackOk[i] = result.ok;
    if (!result.ok) rollbackAllOk = false;
  }

  const overallStatus = rollbackAllOk ? "APPLICATION_FAILED_ROLLED_BACK" : "APPLICATION_FAILED_ROLLBACK_INCOMPLETE";
  const changeRecords = committed.map((c, i) => ({
    operation: c.kind,
    path: c.change.path,
    beforeDigest: c.kind === "MODIFY" ? c.beforeDigest : null,
    afterDigest: rollbackOk[i] ? null : computeContentDigest(LABEL_FILE_CONTENT, c.afterContent),
    status: rollbackOk[i] ? "ROLLED_BACK" : "ROLLBACK_INCOMPLETE",
  }));

  const built = buildAppliedChangeSetRecord({
    projectId: changeSetSnapshot.projectId,
    changeSetDigest: changeSetSnapshot.changeSetDigest,
    reviewPackageDigest: reviewPackageSnapshot.packageDigest,
    reviewRecordDigest: reviewRecordSnapshot.recordDigest,
    changes: changeRecords,
    status: overallStatus,
    appliedAt,
  });

  if (!built.ok) {
    return {
      ok: false,
      errors: [...built.errors, err("$", ERROR_CODES.INVARIANT_VIOLATION, `application failed (${failureReason}) and rollback ${rollbackAllOk ? "succeeded" : "did not fully succeed"}, but the resulting AppliedChangeSetRecord itself could not be built`)],
      appliedChangeSetRecord: null,
    };
  }

  return { ok: false, errors: [err("$", ERROR_CODES.INVARIANT_VIOLATION, `application failed (${failureReason})`)], appliedChangeSetRecord: built.appliedChangeSetRecord };
}

function isPlainObjectLike(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

module.exports = {
  MAX_ACTUAL_FILE_BYTES,
  resolveRepositoryRoot,
  inspectApplicationTarget,
  inspectCreateTarget,
  inspectModifyTarget,
  detectBatchCaseCollisions,
  detectCaseCollisionAgainstDirectory,
  applyApprovedGeneratedChangeSet,
};
