/**
 * AISEC-7 evidence matrix: the declared security outcome of every harness
 * case, grouped by the AISEC-6 section 22 handoff rows H-01..H-12.
 *
 * Harness-internal data, never a public API. Every CURRENT_BEHAVIOR case is
 * bound to an executable test that derives its outcome from what it actually
 * observed and asserts it equals `outcome` here (see confirmCase()). If the
 * repository's behavior changes - for example a future authorized XI-01 fix -
 * that test fails until this matrix and the AISEC-7 document are updated, so
 * stale evidence can never silently stay green. TARGET_ARCHITECTURE cases are
 * the AISEC-6 target properties; at this baseline each one resolves to its
 * blocked class and can never be PASS (see harness-invariants.test.js).
 *
 * `outcome` is a security verification outcome, never a node:test result.
 */

"use strict";

const assert = require("node:assert/strict");
const { OUTCOMES, SCOPES, deriveSecurityOutcome } = require("./outcomes");

const { PASS, FAIL, INSUFFICIENT_EVIDENCE, OWNER_DISPOSITION_REQUIRED, IMPLEMENTATION_BLOCKED, ARCHITECTURE_BLOCKED } = OUTCOMES;
const C = SCOPES.CURRENT_BEHAVIOR;
const T = SCOPES.TARGET_ARCHITECTURE;

const H_ROWS = Object.freeze([
  { id: "H-01", sadr: "SADR-01", invariants: "SAI-01/02/03", threat: "Forged or missing principal/project/repository/root/provider/destination identity join", classification: "IMPLEMENTATION_BLOCKED (FI-01)", owner: "PO / trusted host (ODR-01)" },
  { id: "H-02", sadr: "SADR-02", invariants: "SAI-05/06", threat: "Forged, expired or replayed approval", classification: "OWNER_DECISION_BLOCKED (ODR-02) + implementation dependency (FI-02)", owner: "PO / review host (ODR-02)" },
  { id: "H-03", sadr: "SADR-03", invariants: "SAI-05/06", threat: "Split or substituted review presentation", classification: "IMPLEMENTATION_BLOCKED (FI-03)", owner: "Review host" },
  { id: "H-04", sadr: "SADR-04", invariants: "SAI-11", threat: "Cause / raw output / sink disclosure", classification: "OWNER_DECISION_BLOCKED (ODR-03/05); diagnostic propagation subcase ready", owner: "Data / prompt / log owners (ODR-03/05)" },
  { id: "H-05", sadr: "SADR-05", invariants: "SAI-04/09", threat: "XI-01 copied persisted triage context", classification: "IMPLEMENTATION_BLOCKED (FI-01/05); current-gap characterization ready", owner: "Triage boundary owner after PO disposition" },
  { id: "H-06", sadr: "SADR-05", invariants: "SAI-04", threat: "XI-02 embedded-history fallback", classification: "IMPLEMENTATION_BLOCKED (FI-05)", owner: "Triage history / prompt owner after PO disposition" },
  { id: "H-07", sadr: "SADR-06", invariants: "SAI-04/09", threat: "Shared, import-time or replayed state trusted across scopes", classification: "ARCHITECTURE_BLOCKED (concrete import/replay protocol; ODR-05 first)", owner: "Invocation / store host (ODR-01/04/05)" },
  { id: "H-08", sadr: "SADR-07", invariants: "SAI-07/10", threat: "Hostile but schema-valid model output", classification: "READY_AS_VERIFICATION_INPUT (current deterministic gates); FI-07 for expanded target", owner: "Tool / apply owner" },
  { id: "H-09", sadr: "SADR-08", invariants: "SAI-10/16", threat: "Launch / host / descendant abuse", classification: "Launcher READY_AS_VERIFICATION_INPUT; host OWNER_DECISION_BLOCKED (ODR-06), FI-08", owner: "Host / runtime / security (ODR-06/07)" },
  { id: "H-10", sadr: "SADR-09", invariants: "SAI-12/16", threat: "Wrong source/target, redirect, duplicate or unknown remote outcome", classification: "Current branches READY_AS_VERIFICATION_INPUT; mapping/outcome OWNER_DECISION_BLOCKED (ODR-04/09), FI-09", owner: "Integration / publisher (ODR-04/09)" },
  { id: "H-11", sadr: "SADR-10", invariants: "SAI-06/09", threat: "Fake trust / CI / self-certification / comment identity", classification: "Current structure/comment characterization READY_AS_VERIFICATION_INPUT; authentic adapter FI-10 IMPLEMENTATION_BLOCKED", owner: "PM / platform / review host (ODR-05/07)" },
  { id: "H-12", sadr: "SADR-11/12", invariants: "SAI-13/14/15", threat: "Enablement bypass / autonomy inheritance", classification: "OWNER_DECISION_BLOCKED (release/expansion); FI-11/12", owner: "Release / package owners; future phase owners" },
]);

function c(id, h, scope, outcome, title, extra) {
  return Object.freeze({ id, h, scope, outcome, title, ...extra });
}

// effect: the side effect the case intercepts (or "none - not executed").
// file: the harness test file holding the executable evidence.
const CASES = Object.freeze([
  // H-01 -----------------------------------------------------------------
  c("H01-C1", "H-01", C, PASS, "Analyzer refuses a Project B profile with a root holding Project A context (Triage Boundary XI-01 ProjectProfile binding) before any provider transfer; no report (label/freshness binding only, not authentication)", { effect: "provider call (MockProvider.analyze wrapped; none observed)", file: "triage-cross-project.test.js", related: "XI-01, TB-04/09" }),
  c("H01-C2", "H-01", C, FAIL, "An approved Project A change set applies into a different checkout carrying the same base bytes; no checkout/root authorization", { effect: "filesystem writes confined to synthetic temp roots", file: "review-apply-execute.test.js", related: "TB-02/09, SVR-008" }),
  c("H01-C3", "H-01", C, PASS, "Project-label mismatch between caller expectation and approved chain is refused with zero writes (label consistency only, not authentication)", { effect: "filesystem writes (none observed)", file: "review-apply-execute.test.js" }),
  c("H01-T", "H-01", T, IMPLEMENTATION_BLOCKED, "Authenticated, authorized principal -> project -> repository -> root -> provider -> destination join (FV-01)", { blockedBy: "IMPLEMENTATION_BLOCKED", effect: "none - no enforcing seam exists", file: "harness-invariants.test.js" }),

  // H-02 -----------------------------------------------------------------
  c("H02-C1", "H-02", C, FAIL, "Hand-constructed review record (fabricated reviewer, recomputed unkeyed digest) passes the approval gate and drives a real apply", { effect: "filesystem writes confined to a synthetic temp root", file: "review-apply-execute.test.js", related: "TB-01, AT-07 (existing, unchanged)" }),
  c("H02-C2", "H-02", C, PASS, "Approval for old content is refused after the generated content changes (stale-approval protection), zero writes", { effect: "filesystem writes (none observed)", file: "review-apply-execute.test.js" }),
  c("H02-C3", "H-02", C, OWNER_DISPOSITION_REQUIRED, "An approval dated decades before apply is accepted; no lifetime/expiry contract exists (oracle is ODR-02, not invented here)", { effect: "filesystem writes confined to a synthetic temp root", file: "review-apply-execute.test.js", related: "ODR-02" }),
  c("H02-C4", "H-02", C, OWNER_DISPOSITION_REQUIRED, "The same approval is consumed twice after the base state is restored (restored-base replay); no consumption state exists (oracle is ODR-02)", { effect: "filesystem writes confined to a synthetic temp root", file: "review-apply-execute.test.js", related: "TB-03 (existing, unchanged)" }),
  c("H02-C5", "H-02", C, FAIL, "Execution consumes only the self-digested applied record, so a forged approval reaches the launcher; no execute-time approval re-check", { effect: "child_process.spawn intercepted (never launched)", file: "review-apply-execute.test.js", related: "TB-01/TB-18 (existing, unchanged)" }),
  c("H02-T", "H-02", T, OWNER_DISPOSITION_REQUIRED, "Authentic eligible actor, exact subject and one-operation approval with lifetime/consumption (FV-02)", { blockedBy: "OWNER_DECISION_BLOCKED", effect: "none - no enforcing seam exists", file: "harness-invariants.test.js" }),

  // H-03 -----------------------------------------------------------------
  c("H03-C1", "H-03", C, PASS, "Self-digested review package that keeps genuine bytes but forges purpose/before-state/plan metadata/security claims is refused before any filesystem access (N-21 rebuild-and-compare)", { effect: "filesystem access (fs spy observed none)", file: "review-apply-execute.test.js" }),
  c("H03-C2", "H-03", C, PASS, "System-like persuasive text in a planned purpose grants no authority: a REQUEST_CHANGES decision still blocks apply", { effect: "filesystem writes (none observed)", file: "review-apply-execute.test.js" }),
  c("H03-T", "H-03", T, IMPLEMENTATION_BLOCKED, "Displayed representation bound to record and apply (FV-03); review package and record carry no display/renderer binding", { blockedBy: "IMPLEMENTATION_BLOCKED", effect: "none - no renderer exists", file: "review-apply-execute.test.js" }),

  // H-04 -----------------------------------------------------------------
  c("H04-C1", "H-04", C, PASS, "Provider error message and cause canaries never reach the terminal AnalyzerError or persisted firstAttemptError (fixed allowlist)", { effect: "provider call (scripted fake)", file: "triage-cross-project.test.js" }),
  c("H04-C2", "H-04", C, PASS, "Prompt projection drops metadata projectId/repository/runId canaries; unlisted failure/error extras are rejected by the closed persisted-context contract before any provider call", { effect: "provider call (scripted fake)", file: "triage-cross-project.test.js" }),
  c("H04-C3", "H-04", C, OWNER_DISPOSITION_REQUIRED, "Failure error.message/stack canaries are forwarded verbatim to the provider prompt (content transfer whose audience is undecided, ODR-03)", { effect: "provider call (scripted fake)", file: "triage-cross-project.test.js", related: "ODR-03" }),
  c("H04-C4", "H-04", C, PASS, "Requirements loader outer error omits a remote queryType canary", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js" }),
  c("H04-C5", "H-04", C, OWNER_DISPOSITION_REQUIRED, "Remote queryType canary is preserved verbatim in error.cause (by design); whether cause may reach logs/UI/persistence is ODR-03/05", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js", related: "ODR-03/05" }),
  c("H04-T", "H-04", T, OWNER_DISPOSITION_REQUIRED, "Sink-specific audience, diagnostic and retention contracts at every transition (FV-04)", { blockedBy: "OWNER_DECISION_BLOCKED", effect: "none - policy undecided", file: "harness-invariants.test.js" }),

  // H-05 -----------------------------------------------------------------
  c("H05-C1", "H-05", C, PASS, "XI-01: Project A context copied into Project B's root (and the same context relabelled as B with A's constraints) is refused through the public analyzeFailure.main before any provider transfer or report write", { effect: "provider call (MockProvider.analyze wrapped; none observed); no report write", file: "triage-cross-project.test.js", related: "XI-01 OPEN / MEDIUM (control implemented; closure not performed)" }),
  c("H05-C2", "H-05", C, PASS, "XI-01: stale/foreign context relabelled with B's project id is refused in both invocation modes - another local-v1 invocation id; another GitHub Actions repository, commit, run or run attempt - while the same-run, same-attempt context is analyzed", { effect: "provider call (MockProvider.analyze wrapped)", file: "triage-cross-project.test.js", related: "XI-01 OPEN / MEDIUM (control implemented; closure not performed)" }),
  c("H05-T", "H-05", T, IMPLEMENTATION_BLOCKED, "Authenticated producer/project/root/run join before provider request or trusted output (FV-05)", { blockedBy: "IMPLEMENTATION_BLOCKED", effect: "none - no enforcing seam exists", file: "harness-invariants.test.js" }),

  // H-06 -----------------------------------------------------------------
  c("H06-C1", "H-06", C, PASS, "XI-02: an embedded context.history canary is rejected at the persisted-context boundary for every separate-history state (absent, unavailable, malformed, wrong-project, wrong-framework, invalid counters); ineligible separate history is null", { effect: "provider call (MockProvider.analyze wrapped)", file: "triage-cross-project.test.js", related: "XI-02 OPEN / MEDIUM (control implemented; closure not performed)" }),
  c("H06-C2", "H-06", C, PASS, "XI-02: prompt-visible and report-visible History are the same validated projection in every separate-history state", { effect: "provider call + report write in temp root", file: "triage-cross-project.test.js", related: "XI-02 OPEN / MEDIUM (control implemented; closure not performed)" }),
  c("H06-C3", "H-06", C, PASS, "Eligible separate history replaces the embedded field with exactly four counters; canary absent", { effect: "provider call (MockProvider.analyze wrapped)", file: "triage-cross-project.test.js" }),
  c("H06-C4", "H-06", C, PASS, "Unavailable separate history is reported as null, never as fabricated zero counters", { effect: "report write in temp root", file: "triage-cross-project.test.js" }),
  c("H06-T", "H-06", T, IMPLEMENTATION_BLOCKED, "Nested history eligibility and bounded projection at the final prompt consumer (FV-05)", { blockedBy: "IMPLEMENTATION_BLOCKED", effect: "none - no enforcing seam exists", file: "harness-invariants.test.js" }),

  // H-07 -----------------------------------------------------------------
  c("H07-C1", "H-07", C, PASS, "Interleaved A/B analyses with separate roots/providers do not cross-contaminate through module state (narrow; not namespace isolation)", { effect: "provider calls (two scripted fakes)", file: "triage-cross-project.test.js" }),
  c("H07-C2", "H-07", C, OWNER_DISPOSITION_REQUIRED, "Provider/model/key selection is fixed at import time for the whole process; a later per-invocation change is ignored, so A and B share one provider account (ODR-07)", { effect: "none - module configuration read only", file: "triage-cross-project.test.js", related: "ODR-07" }),
  c("H07-T", "H-07", T, ARCHITECTURE_BLOCKED, "Scoped state, import, replay, freshness and revocation protocol (FV-06); no concrete protocol is selected", { blockedBy: "ARCHITECTURE_BLOCKED", effect: "none - no protocol exists", file: "harness-invariants.test.js" }),

  // H-08 -----------------------------------------------------------------
  c("H08-C1", "H-08", C, PASS, "Provider-proposed paths outside the reviewed plan (workflow, script, unplanned spec) are rejected after bounded attempts; no write path exists", { effect: "provider calls counted (scripted fake)", file: "hostile-model-output.test.js" }),
  c("H08-C2", "H-08", C, PASS, "Provider-supplied authority-looking fields (approved, status, reviewer, baseContentDigest) are rejected as unknown keys", { effect: "provider calls counted (scripted fake)", file: "hostile-model-output.test.js" }),
  c("H08-C3", "H-08", C, PASS, "Protected-scope paths (.env, node_modules, secrets, credentials, .github, package.json) never become a generated change set", { effect: "provider calls counted (scripted fake)", file: "hostile-model-output.test.js" }),
  c("H08-C4", "H-08", C, PASS, "Invented reference: MODIFY of a path absent from the bound repository context is rejected", { effect: "provider calls counted (scripted fake)", file: "hostile-model-output.test.js" }),
  c("H08-C5", "H-08", C, PASS, "Approval-looking prose inside schema-valid content yields only an unapproved proposal; apply without a decision record writes nothing", { effect: "filesystem writes (none observed)", file: "hostile-model-output.test.js" }),
  c("H08-C6", "H-08", C, OWNER_DISPOSITION_REQUIRED, "Hostile-looking but schema-valid code inside an allowed path is accepted as a proposal; semantic safety is not deterministically judged (ODR-08 human review); content is never executed here", { effect: "none - proposal data only; spawn interceptor armed", file: "hostile-model-output.test.js", related: "ODR-08" }),
  c("H08-C7", "H-08", C, PASS, "Triage: model shouldCreateBug for a non-PRODUCT_BUG class is overridden; a model-supplied policy field is rejected by the closed provider-result contract (TSB-F04), no report", { effect: "provider call (scripted fake)", file: "hostile-model-output.test.js" }),
  c("H08-C8", "H-08", C, PASS, "Plan generator: provider plans outside the authorized framework tree or for a foreign candidate are rejected", { effect: "provider calls counted (scripted fake)", file: "hostile-model-output.test.js" }),
  c("H08-T", "H-08", T, IMPLEMENTATION_BLOCKED, "Expanded deterministic capability enforcement at each effect, independent of semantic grades (FI-07)", { blockedBy: "IMPLEMENTATION_BLOCKED", effect: "none - expanded target not implemented", file: "harness-invariants.test.js" }),

  // H-09 -----------------------------------------------------------------
  c("H09-C1", "H-09", C, PASS, "Allowed target: exact argv, shell:false, cwd=realpath(root), allowlisted env without dummy secrets", { effect: "child_process.spawn intercepted (never launched)", file: "review-apply-execute.test.js" }),
  c("H09-C2", "H-09", C, PASS, "Recognized but unsafe target path refuses the whole run; zero spawn", { effect: "child_process.spawn intercepted (zero calls)", file: "review-apply-execute.test.js" }),
  c("H09-C3", "H-09", C, PASS, "No recognized executable target (support-only change) refuses the run; zero spawn", { effect: "child_process.spawn intercepted (zero calls)", file: "review-apply-execute.test.js" }),
  c("H09-C4", "H-09", C, PASS, "Applied bytes changed after apply (stale chain) are detected before launch; zero spawn", { effect: "child_process.spawn intercepted (zero calls)", file: "review-apply-execute.test.js" }),
  c("H09-C5", "H-09", C, OWNER_DISPOSITION_REQUIRED, "Allowlisted HOME/USERPROFILE/APPDATA values are passed to launched code, so ambient credential files remain reachable (TB-14; ODR-06)", { effect: "child_process.spawn intercepted (never launched)", file: "review-apply-execute.test.js", related: "TB-14, ODR-06" }),
  c("H09-T", "H-09", T, OWNER_DISPOSITION_REQUIRED, "Host isolation, descendant/network/resource containment for launched code (FV-08) - REQUIRES_ISOLATED_HOST; not executed on the operator host", { blockedBy: "OWNER_DECISION_BLOCKED", effect: "none - hostile execution prohibited on ordinary host", file: "harness-invariants.test.js" }),

  // H-10 -----------------------------------------------------------------
  c("H10-C1", "H-10", C, PASS, "Valid 2xx create: exactly one POST to the fixed https host for the configured org/project, redirect:manual, dummy token never echoed in the result", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js" }),
  c("H10-C2", "H-10", C, OWNER_DISPOSITION_REQUIRED, "Wrong but valid destination project is published to without any source->destination mapping check (ODR-04)", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js", related: "ODR-04, AT-04" }),
  c("H10-C3", "H-10", C, PASS, "Destination redirect is not followed; batch stops; one request", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js" }),
  c("H10-C4", "H-10", C, OWNER_DISPOSITION_REQUIRED, "Invalid 2xx is item-local ('remote creation may have occurred') and the batch continues with the next create (ODR-09)", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js", related: "ODR-09" }),
  c("H10-C5", "H-10", C, PASS, "Transport failure/timeout yields OUTCOME_UNKNOWN, no retry, remaining items NOT_ATTEMPTED", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js" }),
  c("H10-C6", "H-10", C, PASS, "5xx yields OUTCOME_UNKNOWN, no retry, batch stops", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js" }),
  c("H10-C7", "H-10", C, OWNER_DISPOSITION_REQUIRED, "Re-invoking the same batch creates again; no idempotency key or durable ledger (ODR-09)", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js", related: "TB-19, ODR-09" }),
  c("H10-C8", "H-10", C, PASS, "Requirements source redirect is refused, not followed; one request", { effect: "fetch stubbed (no socket)", file: "source-destination.test.js" }),
  c("H10-T", "H-10", T, OWNER_DISPOSITION_REQUIRED, "Authorized source/provider/destination mapping and unknown-outcome reconciliation (FV-09)", { blockedBy: "OWNER_DECISION_BLOCKED", effect: "none - mapping policy undecided", file: "harness-invariants.test.js" }),

  // H-11 -----------------------------------------------------------------
  c("H11-C1", "H-11", C, PASS, "CI run evidence for the wrong HEAD, event, workflow or repository is refused with an internal WRONG_* reason", { effect: "fake CI adapter (no network)", file: "trust-evidence.test.js" }),
  c("H11-C2", "H-11", C, PASS, "Adapter-supplied WRONG_* reason text cannot impersonate an internally proven mismatch", { effect: "fake CI adapter (no network)", file: "trust-evidence.test.js" }),
  c("H11-C3", "H-11", C, PASS, "Omitted, skipped or pending required jobs never count as complete success", { effect: "none - pure evaluation", file: "trust-evidence.test.js" }),
  c("H11-C4", "H-11", C, PASS, "Trusted invocation context with an event that does not match its mode/trust is rejected", { effect: "none - pure evaluation", file: "trust-evidence.test.js" }),
  c("H11-C5", "H-11", C, PASS, "Self-certification refused: a determiner who is a contributor cannot act as SEPARATE_PERSON", { effect: "none - pure evaluation", file: "trust-evidence.test.js" }),
  c("H11-C6", "H-11", C, PASS, "The only adapter bridge never accepts a determination: every response yields UNMET_TRUST_PREREQUISITES", { effect: "none - pure evaluation", file: "trust-evidence.test.js" }),
  c("H11-C7", "H-11", C, INSUFFICIENT_EVIDENCE, "Run evidence has no TREE or actual-checkout field (a run carrying one is malformed), so wrong-TREE/wrong-checkout cannot be detected", { effect: "fake CI adapter (no network)", file: "trust-evidence.test.js" }),
  c("H11-C8", "H-11", C, FAIL, "Comment upsert updates a foreign-author comment that carries the marker (no author gate)", { effect: "fake GitHub client (no network)", file: "trust-evidence.test.js", related: "TB-08 (existing, unchanged)" }),
  c("H11-C9", "H-11", C, FAIL, "Marker comment beyond the first page is not found; a duplicate comment is created", { effect: "fake GitHub client (no network)", file: "trust-evidence.test.js", related: "TB-08 (existing, unchanged)" }),
  c("H11-T", "H-11", T, IMPLEMENTATION_BLOCKED, "Authenticated evidence collector; a caller-supplied PLATFORM_AUTHENTICATED label is shape-valid only (ASSERTED, never AUTHENTICATED) (FV-10)", { blockedBy: "IMPLEMENTATION_BLOCKED", effect: "none - no authentic collector exists", file: "trust-evidence.test.js" }),

  // H-12 -----------------------------------------------------------------
  c("H12-C1", "H-12", C, PASS, "Public barrel exports exactly the documented symbols; no private #22/#23 generation/apply/execute function", { effect: "none - static module probe", file: "enablement-surface.test.js" }),
  c("H12-C2", "H-12", C, PASS, "Package exports map refuses deep private subpaths and files list excludes private #22/#23 trees (manifest only, not installed-package proof)", { effect: "none - resolver/manifest probe", file: "enablement-surface.test.js" }),
  c("H12-C3", "H-12", C, OWNER_DISPOSITION_REQUIRED, "XI-affected capability analyzeFailure.main is exported with no disable/constraint switch; enablement scope is a release decision (SADR-11)", { effect: "none - static module probe", file: "enablement-surface.test.js", related: "XI-01/XI-02 immutable disposition" }),
  c("H12-C4", "H-12", C, PASS, "Unsupported environment has no shell fallback: the launcher always spawns with shell:false", { effect: "child_process.spawn intercepted (never launched)", file: "enablement-surface.test.js" }),
  c("H12-C5", "H-12", T, ARCHITECTURE_BLOCKED, "Future memory/retrieval/learning/autonomy claim: no such capability exists and no assurance is inherited (SADR-12, FI-12)", { blockedBy: "ARCHITECTURE_BLOCKED", effect: "none - not started", file: "enablement-surface.test.js" }),
  c("H12-T", "H-12", T, OWNER_DISPOSITION_REQUIRED, "Capability-specific release dossier and verified disabled-path inventory (FV-11)", { blockedBy: "OWNER_DECISION_BLOCKED", effect: "none - release not authorized", file: "harness-invariants.test.js" }),
]);

const CASES_BY_ID = new Map(CASES.map((entry) => [entry.id, entry]));

function getCase(id) {
  const entry = CASES_BY_ID.get(id);
  assert.ok(entry, `unknown AISEC-7 case ${id}`);
  return entry;
}

/**
 * Binds an executed observation to its declared matrix row: derives the
 * security outcome from `controlHeld` and asserts it equals the declared one.
 *   controlHeld true  - the narrow current control held
 *   controlHeld false - the gap/violation was reproduced
 *   controlHeld null  - observed, but no approved oracle exists to judge it
 */
function confirmCase(id, controlHeld) {
  const entry = getCase(id);
  assert.equal(entry.scope, SCOPES.CURRENT_BEHAVIOR, `${id} is not a current-behavior case`);
  const outcome = deriveSecurityOutcome({
    scope: SCOPES.CURRENT_BEHAVIOR,
    executed: true,
    evidenceComplete: true,
    controlHeld,
    ownerDispositionRequired: entry.outcome === OWNER_DISPOSITION_REQUIRED,
  });
  assert.equal(outcome, entry.outcome, `${id}: observed security outcome ${outcome} differs from the declared ${entry.outcome}`);
  return outcome;
}

/** Derives a target-architecture row's outcome from its declared blocker. */
function targetOutcome(id) {
  const entry = getCase(id);
  assert.equal(entry.scope, SCOPES.TARGET_ARCHITECTURE, `${id} is not a target-architecture case`);
  return deriveSecurityOutcome({ scope: SCOPES.TARGET_ARCHITECTURE, blockedBy: entry.blockedBy });
}

module.exports = { H_ROWS, CASES, getCase, confirmCase, targetOutcome };
