/**
 * Bounded, provider-backed regeneration after a controlled-execution
 * failure (Roadmap #23G - "Controlled Execution + Bounded Regeneration
 * Loop").
 *
 * CORE GOVERNANCE INVARIANT (read this before wiring this into anything):
 * this module NEVER approves, applies, or executes what it proposes. It
 * returns, at most, a new, ordinarily-validated GeneratedChangeSet v1
 * "proposal" - nothing more. The proposal MUST re-enter the full existing
 * authority chain from #23E onward:
 *
 *   regenerated GeneratedChangeSet
 *           -> NEW #23E human review (a NEW GeneratedChangeSetReviewPackage
 *              + a NEW, independently-produced GeneratedChangeSetReviewRecord
 *              - an OLD ReviewRecord can never approve a regenerated
 *              proposal, because #23E's own exact-content digest binding
 *              makes that cryptographically impossible - see
 *              generated-change-set-review-record.js's own
 *              validateApprovedGeneratedChangeSetReview())
 *           -> NEW #23F safe application (a NEW AppliedChangeSetRecord)
 *           -> NEW #23G controlled execution
 *
 * This module itself contains NO code path that could call
 * applyApprovedGeneratedChangeSet() or executeAppliedChangeSet() - it has
 * no filesystem write authority and no execution authority at all.
 *
 * BOUNDED, NOT SELF-HEALING: at most ONE regeneration attempt is permitted
 * per qualifying failure (`MAX_REGENERATION_ATTEMPTS = 1`), and this module
 * makes AT MOST ONE provider call per invocation - no internal retry loop
 * of its own (unlike #23D's own generateChangeSet(), which retries up to
 * its own separate `maxAttempts` bound for STRUCTURAL/validation
 * correction within a single generation). These are two independent
 * bounds for two independent concerns; the maximum theoretical number of
 * provider calls reachable from one #23G orchestration (one execution
 * attempt + at most one regeneration attempt) is exactly 1, because this
 * module's own regeneration path never re-invokes #23D's generator - see
 * the module-level test asserting this bound directly.
 *
 * REGENERATION ELIGIBILITY IS CONSERVATIVE AND DETERMINISTIC: an execution
 * failure is regeneration-eligible ONLY when deterministic evidence
 * (status/exit shape, absence of any recognized infrastructure/SUT/network
 * failure marker in the bounded output) points at the generated automation
 * itself, never at GitHub/network/browser-installation/credential/
 * configuration/timeout/unclassified failures - see
 * classifyExecutionFailure()/isRegenerationEligible() below. A provider is
 * NEVER the authority that decides eligibility - only deterministic code
 * does.
 *
 * PROVIDER INPUT IS BOUNDED: the provider never receives the whole
 * repository, environment, or unbounded raw execution output - only the
 * SAME positive projection #23D's own generator already builds
 * (buildPositiveProjection(), reused verbatim, never a repository dump)
 * plus a small, bounded {path,code,message}-shaped summary of the
 * execution failure (reusing the identical bounding discipline #23D's own
 * generateChangeSet() already applies to its correction-prompt errors).
 *
 * ATTEMPT-COUNT TRUST NOTE (Roadmap #23G Section 39, read honestly): this
 * module has no persistence and cannot itself prevent a caller from
 * invoking it multiple times across separate process calls each claiming
 * `regenerationAttempt: 1`. `regenerationAttempt` is a self-documenting,
 * in-process misuse guard, not a cross-call/cross-process enforcement
 * mechanism - true cross-call attempt tracking would require an
 * orchestration-level persisted identity this module does not claim to
 * provide. This limitation is stated here explicitly rather than silently
 * assumed away.
 *
 * CREATE REGENERATION IS NOT SUPPORTED UNDER THE SAME PLAN (Roadmap
 * #23G-C1, closes 23G-RV-1): a GeneratedChangeSet's `changes[].operation`
 * is permanently bound to whatever `automationPlan.plannedChanges[].operation`
 * originally declared for that path (#23D's own validateChangeEntry()
 * enforces `change.operation !== planOperation` as a hard rejection, with
 * no exception this module can or should route around). A CREATE, once
 * applied, means the target now exists - so a regenerated proposal for
 * that SAME path, under that SAME plan, can only ever be proposed as
 * CREATE again, which #23D's own existence check will always reject
 * (`CREATE target already exists`), and which #23F's own real filesystem
 * check would independently reject even if #23D's context-bound check were
 * somehow bypassed. If ANY change in the original changeset was a CREATE,
 * this module refuses to call the provider at all and returns a bounded
 * `INVARIANT_VIOLATION` explaining that a NEW planning cycle (a fresh
 * AutomationRepositoryContext -> a fresh AutomationPlan authorizing MODIFY
 * against the now-existing file) is required - never a doomed
 * GeneratedChangeSet proposal that would waste a full human-review cycle
 * before failing at #23F. This module does NOT build that new plan itself
 * (that would expand #23G into #23C's own authority) - it only refuses to
 * pretend a correction is possible when it structurally is not. A mixed
 * changeset (CREATE and MODIFY together) is refused in its entirety for
 * the same reason (Roadmap #23G-C1 Section 39) - never partially
 * regenerated with the provider left to guess which change caused the
 * failure.
 *
 * REPOSITORYCONTEXT FRESHNESS IS VERIFIED, NOT TRUSTED (Roadmap #23G-C1,
 * closes 23G-RV-3): for a MODIFY-only changeset, a regenerated proposal's
 * `baseContentDigest` is mechanically derived (by generate-change-set.js's
 * own deriveChangesWithBaseDigests()) from whatever `repositoryContext` the
 * caller supplies - if that context still reflects PRE-application content
 * rather than the actually-applied `afterDigest`, the regenerated proposal
 * would pass review only to fail #23F's own optimistic-concurrency check as
 * STALE, again wasting a full human-review cycle. Before ever calling the
 * provider, this module independently verifies that `repositoryContext`'s
 * own evidence for every MODIFY target's path already matches
 * `appliedChangeSetRecord.changes[].afterDigest` exactly - a caller-
 * supplied context that does not is rejected with zero provider calls,
 * never silently accepted on faith merely because its projectId/framework
 * matched.
 *
 * PROVIDER EVIDENCE IS REDACTED, NOT JUST BOUNDED (Roadmap #23G-C1, closes
 * 23G-RV-4B): the captured stdout/stderr this module embeds into the
 * regeneration prompt passes through a conservative, best-effort
 * redactSecrets() scrub (Authorization/Bearer headers, `*_TOKEN`/`*_SECRET`/
 * `*_PASSWORD`/`*_API_KEY`-shaped assignments, URL-embedded credentials)
 * before it ever reaches buildFailureEvidenceErrors()'s output - defense in
 * depth alongside controlled-execution.js's own environment allowlist,
 * neither of which is a complete DLP guarantee. The stored
 * AutomationExecutionRecord itself is never mutated by this - redaction
 * applies only to the copy of the evidence text built for the provider
 * prompt.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isValidId } = require("../generation/primitives");
const { validateAutomationPlan } = require("../generation/automation-plan");
const {
  computeDigest: computeChangeSetDigest,
  LABEL_PLAN_BINDING,
  LABEL_FILE_CONTENT,
  recomputeChangeSetDigest,
  validateRepositoryContextSnapshot,
  buildGeneratedChangeSet,
} = require("./generated-change-set");
const {
  LIMITS: CHANGESET_LIMITS,
  buildPositiveProjection,
  validateProviderChangesShape,
  deriveChangesWithBaseDigests,
} = require("./generate-change-set");
const {
  buildGenerateChangeSetSystemPrompt,
  buildGenerateChangeSetCorrectionPrompt,
} = require("./generate-change-set-prompt");
const { recomputeAppliedChangeSetRecordDigest } = require("./applied-change-set-record");
const {
  STATUSES: EXECUTION_STATUSES,
  snapshotOwnData,
  deepFreeze,
  recomputeAutomationExecutionRecordDigest,
} = require("./automation-execution-record");

// Roadmap #23G Section 6: the sole, hard, conservative bound on the
// regeneration loop - a single orchestration flow may propose at most one
// regeneration after one qualifying execution failure. There is
// deliberately no larger value, no configurability, and no path in this
// module's own code that could invoke itself a second time.
const MAX_REGENERATION_ATTEMPTS = 1;

// Roadmap #23G Section 30/31: a closed, deterministic failure taxonomy.
// Only GENERATED_AUTOMATION_FAILURE is ever regeneration-eligible - every
// other category (including UNKNOWN) is conservatively NOT eligible.
const FAILURE_CATEGORIES = Object.freeze([
  "NONE",
  "GENERATED_AUTOMATION_FAILURE",
  "SUT_FAILURE",
  "INFRASTRUCTURE_FAILURE",
  "TIMEOUT",
  "FRAMEWORK_STARTUP_FAILURE",
  "CONFIGURATION_FAILURE",
  "UNKNOWN",
]);
const REGENERATION_ELIGIBLE_CATEGORIES = Object.freeze(["GENERATED_AUTOMATION_FAILURE"]);

// Roadmap #23G Section 31: a narrow, conservative allowlist of recognized
// infrastructure/SUT/network-failure text markers. PRESENCE of any of
// these in the bounded stdout/stderr evidence is treated as a signal that
// the failure is NOT attributable to the generated automation itself, and
// regeneration is refused - the safe direction for a false match (missing
// a genuine opportunity to regenerate) is always preferred over the unsafe
// direction (regenerating for an infrastructure/SUT problem the new
// proposal could never fix). This is deliberately narrow prose matching,
// never a provider judgment call.
const INFRASTRUCTURE_MARKERS = Object.freeze([
  "econnrefused",
  "enotfound",
  "etimedout",
  "econnreset",
  "ehostunreach",
  "enetunreach",
  "certificate",
  "browser was not found",
  "executable doesn't exist",
  "failed to launch",
  "cannot find module",
  "command not found",
  "permission denied",
  "no such file or directory",
  "npm err",
]);

function containsInfrastructureMarker(text) {
  const lower = text.toLowerCase();
  return INFRASTRUCTURE_MARKERS.some((marker) => lower.includes(marker));
}

// Roadmap #23G-C1 (closes 23G-RV-4B): a conservative, best-effort scrub
// applied ONLY to the copy of execution evidence text built for the
// provider prompt - never mutates the stored AutomationExecutionRecord.
// Explicitly documented as defense-in-depth, never a claimed complete
// secret-detection/DLP guarantee (see this module's own docstring).
const REDACTED = "[REDACTED]";
const REDACTION_PATTERNS = [
  // "Authorization: <scheme> <value>" - redact everything after the colon.
  /(authorization\s*:\s*)(\S.*?)(?=\r?\n|$)/gi,
  // A bare "Bearer <token>" occurring outside an Authorization: line.
  /\b(bearer\s+)(\S+)/gi,
  // Roadmap #23G-C2 (closes 23G-C1-RR-1's redaction sub-finding,
  // 23G-C1-RR-2): (optionally-prefixed)_TOKEN / _SECRET / _PASSWORD /
  // _API_KEY assignments (":" or "=" separated, optionally quoted on
  // either side of the operator for JSON-object-shaped evidence like
  // `"API_KEY":"xyz"`) - e.g. GITHUB_TOKEN=xyz, API_KEY: xyz, and now also
  // the BARE (unprefixed) forms TOKEN=xyz / SECRET=xyz / PASSWORD=xyz /
  // API_KEY=xyz, which the original #23G-C1 pattern required a prefix
  // segment before and therefore missed entirely (confirmed via
  // independent review: "PASSWORD=..." passed through unredacted). The
  // REQUIRED [:=] assignment operator immediately after the keyword (only
  // an optional quote character may sit between them) is what keeps this
  // from over-matching ordinary prose that merely contains one of these
  // words with no assignment syntax (e.g. "password validation failed",
  // "tokenizer test failed", "secret-management UI visible" all correctly
  // remain untouched - a permanent test proves this).
  /\b((?:[A-Z0-9][A-Z0-9_]*_)?(?:TOKEN|SECRET|PASSWORD|API_?KEY)["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi,
  // URL-embedded credentials: scheme://user:password@host
  /(:\/\/[^\s/:@]+:)([^\s/@]+)(@)/g,
];
function redactSecrets(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const pattern of REDACTION_PATTERNS) {
    out = out.replace(pattern, (...args) => {
      const groups = args.slice(1, args.length - 2);
      // Every pattern above has a 2- or 3-group {prefix, secret, suffix?}
      // shape - the secret (always the second capture group) is replaced,
      // every other captured group is preserved verbatim.
      return groups[0] + REDACTED + (groups[2] || "");
    });
  }
  return out;
}

/**
 * Deterministic, provider-free classification of one AutomationExecutionRecord.
 * Never called with a caller-supplied category - always derives it fresh
 * from the record's own bounded fields.
 */
function classifyExecutionFailure(automationExecutionRecord) {
  if (!automationExecutionRecord || typeof automationExecutionRecord !== "object") return "UNKNOWN";
  const status = automationExecutionRecord.status;
  if (status === "PASSED") return "NONE";
  if (status === "TIMED_OUT") return "TIMEOUT";
  if (status === "EXECUTION_ERROR") {
    // A process that never produced a real exit code (spawn failure, or a
    // timeout-adjacent process error) is treated as an infrastructure
    // concern, never generated-automation content.
    return "INFRASTRUCTURE_FAILURE";
  }
  if (status === "TEST_FAILED") {
    const stdoutText = (automationExecutionRecord.stdout && automationExecutionRecord.stdout.text) || "";
    const stderrText = (automationExecutionRecord.stderr && automationExecutionRecord.stderr.text) || "";
    if (containsInfrastructureMarker(stdoutText) || containsInfrastructureMarker(stderrText)) {
      return "INFRASTRUCTURE_FAILURE";
    }
    return "GENERATED_AUTOMATION_FAILURE";
  }
  return "UNKNOWN";
}

function isRegenerationEligible(category) {
  return REGENERATION_ELIGIBLE_CATEGORIES.includes(category);
}

// Roadmap #23G: mirrors generate-change-set.js's own private
// boundCorrectionErrors() bounding discipline exactly (same LIMITS
// constants, reused rather than duplicated with different numbers) -
// intentionally NOT imported (it is not exported, and #23D's own module is
// left with zero diff), but the bounding LOGIC itself is small enough that
// an independent, byte-for-byte-equivalent local copy carries negligible
// drift risk while keeping #23D untouched.
function boundEvidenceErrors(errors) {
  const bounded = errors.slice(0, CHANGESET_LIMITS.MAX_CORRECTION_ERRORS).map((e) => ({ path: e.path, code: e.code, message: e.message }));
  if (JSON.stringify(bounded).length <= CHANGESET_LIMITS.MAX_CORRECTION_DIAGNOSTIC_CHARS) return bounded;
  return [err("$", ERROR_CODES.INVALID_VALUE, `execution failure evidence omitted for size (${errors.length} item(s))`)];
}

// Roadmap #23G Section 27/33: converts BOUNDED execution-failure evidence
// (never raw unbounded output) into the same {path,code,message} error
// shape buildGenerateChangeSetCorrectionPrompt() already accepts - reusing
// the EXISTING correction-prompt framing rather than inventing a new,
// unreviewed provider-facing prompt surface.
function buildFailureEvidenceErrors(automationExecutionRecord) {
  const stdoutText = redactSecrets((automationExecutionRecord.stdout && automationExecutionRecord.stdout.text) || "");
  const stderrText = redactSecrets((automationExecutionRecord.stderr && automationExecutionRecord.stderr.text) || "");
  return boundEvidenceErrors([
    err("$.execution.status", ERROR_CODES.INVALID_VALUE, `controlled execution reported status "${automationExecutionRecord.status}" with exitCode ${automationExecutionRecord.exitCode}`),
    err("$.execution.stdout", ERROR_CODES.INVALID_VALUE, stdoutText.length > 0 ? stdoutText : "(empty)"),
    err("$.execution.stderr", ERROR_CODES.INVALID_VALUE, stderrText.length > 0 ? stderrText : "(empty)"),
  ]);
}

function isPlainObjectLike(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Proposes a bounded regeneration of a GeneratedChangeSet after a
 * qualifying controlled-execution failure. NEVER applies, approves, or
 * executes anything - returns a proposal only.
 *
 * `input` shape: { expectedProjectId, automationPlan, repositoryContext,
 * generatedChangeSet, appliedChangeSetRecord, automationExecutionRecord,
 * provider, regenerationAttempt }.
 *
 * Returns `{ ok: true, errors: [], regeneratedChangeSet, providerCallCount,
 * status: "REGENERATION_PROPOSED_AWAITING_REVIEW" }` or `{ ok: false,
 * errors, regeneratedChangeSet: null, providerCallCount }`.
 */
async function regenerateAfterExecutionFailure(input) {
  const {
    expectedProjectId,
    automationPlan,
    repositoryContext,
    generatedChangeSet,
    appliedChangeSetRecord,
    automationExecutionRecord,
    provider,
    regenerationAttempt,
  } = isPlainObjectLike(input) ? input : {};

  if (!isValidId(expectedProjectId)) {
    return { ok: false, errors: [err("$.expectedProjectId", ERROR_CODES.INVALID_TYPE, "$.expectedProjectId must be a bounded string id")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  // Roadmap #23G Section 6/39: the ONLY accepted value - never a caller
  // convenience default, so a caller can never omit this and accidentally
  // rely on an implicit bound.
  if (regenerationAttempt !== MAX_REGENERATION_ATTEMPTS) {
    return {
      ok: false,
      errors: [err("$.regenerationAttempt", ERROR_CODES.INVALID_VALUE, `$.regenerationAttempt must be exactly ${MAX_REGENERATION_ATTEMPTS}`)],
      regeneratedChangeSet: null,
      providerCallCount: 0,
    };
  }
  if (!provider || typeof provider.analyze !== "function") {
    return { ok: false, errors: [err("$.provider", ERROR_CODES.INVALID_TYPE, "provider.analyze must be a function")], regeneratedChangeSet: null, providerCallCount: 0 };
  }

  let planSnapshot;
  let contextSnapshot;
  let changeSetSnapshot;
  let appliedRecordSnapshot;
  let executionRecordSnapshot;
  try {
    planSnapshot = deepFreeze(snapshotOwnData(automationPlan));
    contextSnapshot = deepFreeze(snapshotOwnData(repositoryContext));
    changeSetSnapshot = deepFreeze(snapshotOwnData(generatedChangeSet));
    appliedRecordSnapshot = deepFreeze(snapshotOwnData(appliedChangeSetRecord));
    executionRecordSnapshot = deepFreeze(snapshotOwnData(automationExecutionRecord));
  } catch {
    return { ok: false, errors: [err("$", ERROR_CODES.INVALID_TYPE, "inputs could not be read")], regeneratedChangeSet: null, providerCallCount: 0 };
  }

  // 1. AutomationPlan + RepositoryContext must independently validate and
  // agree on project/framework - the exact same binding #23D itself
  // requires, re-verified here rather than trusted from the caller.
  const planValidation = validateAutomationPlan(planSnapshot, { expectedProjectId });
  if (!planValidation.ok) {
    return { ok: false, errors: [err("$.automationPlan", ERROR_CODES.INVALID_TYPE, "$.automationPlan is not a valid AutomationPlan v1")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  const contextErrors = [];
  if (!validateRepositoryContextSnapshot(contextSnapshot, "$.repositoryContext", contextErrors, { expectedProjectId })) {
    return { ok: false, errors: contextErrors, regeneratedChangeSet: null, providerCallCount: 0 };
  }
  if (planSnapshot.projectId !== contextSnapshot.projectId || planSnapshot.framework !== contextSnapshot.framework) {
    return { ok: false, errors: [err("$.repositoryContext", ERROR_CODES.INVALID_VALUE, "repositoryContext does not match automationPlan")], regeneratedChangeSet: null, providerCallCount: 0 };
  }

  // 2. GeneratedChangeSet must be self-consistent and bound to exactly
  // this automationPlan (same chain controlled-execution.js verifies).
  if (!isPlainObjectLike(changeSetSnapshot) || changeSetSnapshot.kind !== "GeneratedChangeSet" || changeSetSnapshot.schemaVersion !== 1) {
    return { ok: false, errors: [err("$.generatedChangeSet", ERROR_CODES.INVALID_TYPE, "$.generatedChangeSet must be a valid GeneratedChangeSet v1")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  const freshChangeSetDigest = recomputeChangeSetDigest(changeSetSnapshot);
  if (freshChangeSetDigest === null || freshChangeSetDigest !== changeSetSnapshot.changeSetDigest) {
    return { ok: false, errors: [err("$.generatedChangeSet.changeSetDigest", ERROR_CODES.INVALID_VALUE, "$.generatedChangeSet content does not match its own stored digest")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  const freshPlanDigest = computeChangeSetDigest(LABEL_PLAN_BINDING, planSnapshot);
  if (freshPlanDigest !== changeSetSnapshot.automationPlanDigest) {
    return { ok: false, errors: [err("$.generatedChangeSet.automationPlanDigest", ERROR_CODES.INVALID_REFERENCE, "$.generatedChangeSet is not bound to the exact supplied automationPlan")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  if (changeSetSnapshot.projectId !== expectedProjectId) {
    return { ok: false, errors: [err("$.generatedChangeSet.projectId", ERROR_CODES.PROJECT_MISMATCH, "$.generatedChangeSet.projectId does not match the expected project")], regeneratedChangeSet: null, providerCallCount: 0 };
  }

  // 3. AppliedChangeSetRecord must be self-consistent, bound to exactly
  // this generatedChangeSet, and APPLIED (regeneration is only grounded in
  // a genuinely successful application that then failed at execution -
  // never in a rolled-back/incomplete application).
  const freshAppliedDigest = recomputeAppliedChangeSetRecordDigest(appliedRecordSnapshot);
  if (freshAppliedDigest === null || freshAppliedDigest !== appliedRecordSnapshot.recordDigest) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.recordDigest", ERROR_CODES.INVALID_VALUE, "$.appliedChangeSetRecord content does not match its own stored digest")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  if (appliedRecordSnapshot.changeSetDigest !== changeSetSnapshot.changeSetDigest) {
    return { ok: false, errors: [err("$.appliedChangeSetRecord.changeSetDigest", ERROR_CODES.INVALID_REFERENCE, "$.appliedChangeSetRecord is not bound to the exact supplied generatedChangeSet")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  if (appliedRecordSnapshot.projectId !== expectedProjectId || appliedRecordSnapshot.status !== "APPLIED") {
    return { ok: false, errors: [err("$.appliedChangeSetRecord", ERROR_CODES.INVALID_VALUE, "$.appliedChangeSetRecord must be an APPLIED record for the expected project")], regeneratedChangeSet: null, providerCallCount: 0 };
  }

  // 4. AutomationExecutionRecord must be self-consistent and bound to
  // exactly this appliedChangeSetRecord.
  if (!isPlainObjectLike(executionRecordSnapshot) || executionRecordSnapshot.kind !== "AutomationExecutionRecord" || !EXECUTION_STATUSES.includes(executionRecordSnapshot.status)) {
    return { ok: false, errors: [err("$.automationExecutionRecord", ERROR_CODES.INVALID_TYPE, "$.automationExecutionRecord must be a valid AutomationExecutionRecord v1")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  const freshExecutionDigest = recomputeAutomationExecutionRecordDigest(executionRecordSnapshot);
  if (freshExecutionDigest === null || freshExecutionDigest !== executionRecordSnapshot.recordDigest) {
    return { ok: false, errors: [err("$.automationExecutionRecord.recordDigest", ERROR_CODES.INVALID_VALUE, "$.automationExecutionRecord content does not match its own stored digest")], regeneratedChangeSet: null, providerCallCount: 0 };
  }
  if (executionRecordSnapshot.appliedChangeSetRecordDigest !== appliedRecordSnapshot.recordDigest || executionRecordSnapshot.projectId !== expectedProjectId) {
    return { ok: false, errors: [err("$.automationExecutionRecord", ERROR_CODES.INVALID_REFERENCE, "$.automationExecutionRecord is not bound to the exact supplied appliedChangeSetRecord/project")], regeneratedChangeSet: null, providerCallCount: 0 };
  }

  // 5. Deterministic, conservative eligibility gate - the ONLY authority
  // that decides whether a provider is ever called at all.
  const category = classifyExecutionFailure(executionRecordSnapshot);
  if (!isRegenerationEligible(category)) {
    return {
      ok: false,
      errors: [err("$.automationExecutionRecord", ERROR_CODES.INVALID_VALUE, `execution failure is not regeneration-eligible (classified as ${category})`)],
      regeneratedChangeSet: null,
      providerCallCount: 0,
    };
  }

  // 5b. CREATE-origin gate (Roadmap #23G-C1, closes 23G-RV-1) - see this
  // module's own docstring for the full rationale. A changeset containing
  // ANY CREATE operation (including a mixed CREATE+MODIFY changeset) can
  // never be regenerated under the SAME AutomationPlan, because the
  // applied CREATE target now exists and the plan-bound operation for that
  // path can never legally change to MODIFY. Refused whole, before any
  // provider call - never partially regenerated.
  const hasCreateOriginChange = changeSetSnapshot.changes.some((c) => c.operation === "CREATE");
  if (hasCreateOriginChange) {
    return {
      ok: false,
      errors: [err("$.generatedChangeSet.changes", ERROR_CODES.INVARIANT_VIOLATION, "REQUIRES_NEW_PLAN: a changeset containing a CREATE operation cannot be regenerated under the same AutomationPlan, because the applied CREATE target now exists; a new planning cycle authorizing MODIFY is required")],
      regeneratedChangeSet: null,
      providerCallCount: 0,
    };
  }

  // 5c. RepositoryContext freshness gate (Roadmap #23G-C1, closes 23G-RV-3).
  // Every change here is guaranteed MODIFY (CREATE already refused above).
  // The caller-supplied repositoryContext's own evidence for each target
  // path must already reflect the ACTUALLY-applied afterDigest - never
  // merely trusted because projectId/framework matched.
  const evidenceByPath = new Map(contextSnapshot.repositoryEvidence.map((e) => [e.evidenceRef.location, e]));
  const appliedByPath = new Map(appliedRecordSnapshot.changes.map((c) => [c.path, c]));
  for (const change of changeSetSnapshot.changes) {
    const appliedChange = appliedByPath.get(change.path);
    const evidence = evidenceByPath.get(change.path);
    const currentDigest = evidence ? computeChangeSetDigest(LABEL_FILE_CONTENT, evidence.content) : null;
    if (!appliedChange || currentDigest === null || currentDigest !== appliedChange.afterDigest) {
      return {
        ok: false,
        errors: [err("$.repositoryContext", ERROR_CODES.INVARIANT_VIOLATION, `repositoryContext is stale relative to appliedChangeSetRecord for "${change.path}" - it must reflect the actually-applied content before regeneration can proceed`)],
        regeneratedChangeSet: null,
        providerCallCount: 0,
      };
    }
  }

  // 6. Exactly one bounded provider call - no internal retry loop.
  const projection = deepFreeze(buildPositiveProjection({ planSnapshot, contextSnapshot }));
  const systemPrompt = buildGenerateChangeSetSystemPrompt({ framework: planSnapshot.framework });
  const failureErrors = buildFailureEvidenceErrors(executionRecordSnapshot);
  const userPrompt = buildGenerateChangeSetCorrectionPrompt(projection, failureErrors);

  if (userPrompt.length > CHANGESET_LIMITS.MAX_OUTBOUND_PROMPT_CHARS) {
    return {
      ok: false,
      errors: [err("$.repositoryContext", ERROR_CODES.INVALID_VALUE, `provider prompt exceeds the maximum of ${CHANGESET_LIMITS.MAX_OUTBOUND_PROMPT_CHARS} characters`)],
      regeneratedChangeSet: null,
      providerCallCount: 0,
    };
  }

  let rawResponse;
  try {
    rawResponse = await provider.analyze({ systemPrompt, userPrompt });
  } catch {
    return { ok: false, errors: [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider call failed")], regeneratedChangeSet: null, providerCallCount: 1 };
  }

  if (typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
    return { ok: false, errors: [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider returned an empty or non-string response")], regeneratedChangeSet: null, providerCallCount: 1 };
  }
  if (rawResponse.length > CHANGESET_LIMITS.MAX_CHANGESET_RESPONSE_CHARS) {
    return { ok: false, errors: [err("$.provider", ERROR_CODES.INVALID_VALUE, `provider response exceeds the maximum of ${CHANGESET_LIMITS.MAX_CHANGESET_RESPONSE_CHARS} characters`)], regeneratedChangeSet: null, providerCallCount: 1 };
  }

  let parsedChanges;
  try {
    parsedChanges = JSON.parse(rawResponse.trim());
  } catch {
    return { ok: false, errors: [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider response was not valid JSON")], regeneratedChangeSet: null, providerCallCount: 1 };
  }

  const shapeErrors = validateProviderChangesShape(parsedChanges);
  if (shapeErrors.length > 0) {
    return { ok: false, errors: shapeErrors, regeneratedChangeSet: null, providerCallCount: 1 };
  }

  // 7. Construction/validation reuses #23D's OWN real, unmodified
  // buildGeneratedChangeSet() - this is what guarantees a regenerated
  // proposal can never target a path/operation outside the SAME
  // automationPlan.plannedChanges the original proposal was bound to,
  // never a protected area, and never anything #23D itself would not
  // already accept from a first-time proposal.
  const changes = deriveChangesWithBaseDigests(parsedChanges, contextSnapshot);
  const buildResult = buildGeneratedChangeSet({ automationPlan: planSnapshot, repositoryContext: contextSnapshot, changes, expectedProjectId });
  if (!buildResult.ok) {
    return { ok: false, errors: buildResult.errors, regeneratedChangeSet: null, providerCallCount: 1 };
  }

  // Roadmap #23G Section 35: the regenerated proposal's own digest is
  // computed purely from ITS OWN content by buildGeneratedChangeSet() -
  // whenever its content differs from the original, its changeSetDigest
  // necessarily differs too (a permanent regression test proves this
  // directly rather than merely asserting it here).
  return {
    ok: true,
    errors: [],
    regeneratedChangeSet: buildResult.generatedChangeSet,
    providerCallCount: 1,
    status: "REGENERATION_PROPOSED_AWAITING_REVIEW",
  };
}

module.exports = {
  MAX_REGENERATION_ATTEMPTS,
  FAILURE_CATEGORIES,
  REGENERATION_ELIGIBLE_CATEGORIES,
  INFRASTRUCTURE_MARKERS,
  classifyExecutionFailure,
  isRegenerationEligible,
  redactSecrets,
  buildFailureEvidenceErrors,
  regenerateAfterExecutionFailure,
};
