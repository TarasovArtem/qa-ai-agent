#!/usr/bin/env node
/**
 * QA Failure Analyzer
 *
 * reports/ai/context.json -> AI provider -> reports/ai/ai-report.json
 *
 * Provider-neutral orchestration only:
 *
 *   read failure context -> build QA prompt -> get provider ->
 *   provider.analyze() -> parse JSON -> validate result ->
 *   apply QA-specific safeguards -> write ai-report.json
 *
 * This file never knows an API endpoint URL, request/header format, or
 * auth scheme for any AI provider - that all lives behind the
 * provider.analyze({systemPrompt, userPrompt}) contract in
 * scripts/ai/providers/ (MockProvider for local dev/tests, GroqProvider in
 * GitHub Actions - see scripts/ai/providers/index.js). Swapping which
 * provider is used, or adding another one, is a scripts/ai/providers/
 * change, not an analyze-failure.js change.
 *
 * Security:
 *  - Any provider credential is that provider implementation's own
 *    responsibility to read/validate/never-log - this file never handles
 *    one directly.
 *  - Makes at most one provider call, with exactly the contents of
 *    context.json (already scoped/size-capped by
 *    scripts/ai/collect-context.js).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { MODEL, PROVIDER } = require("./config");
const { buildSystemPrompt, buildUserPrompt } = require("./qa-agent-prompt");
const { createProvider } = require("./providers");
const { PROVIDER_ERROR_CODES, normalizeProviderError } = require("./providers/provider-error");
const { validateProvider, validateProviderResponse } = require("./providers/provider-contract");
const { applyAgentPolicy } = require("./agent-policy");
const { assertValidProjectProfile, inspectProjectProfile } = require("./project-profile");
const { assertValidRepositoryRoot } = require("./repository-root");
const { assertValidProjectKnowledgeConfig } = require("./project-knowledge-config");
const {
  resolveSafeRepositoryWritePath,
  resolveRepositoryLocalPath,
  resolveSafeLocalAttachmentPath,
} = require("./context-utils");
const { loadKnowledgeUnits, loadProjectKnowledgeUnits, composeKnowledgeUnits } = require("./knowledge/loader");
const { selectKnowledge } = require("./knowledge/selector");
const { projectBrowserCorrelation, projectFrameworkCorrelation } = require("./correlation-projection");
const {
  MAX_HISTORY_BYTES,
  TriageBoundaryError,
  snapshotPlainData,
  resolveTrustedInvocation,
  readBoundedJsonFile,
  validatePersistedContext,
  readPersistedContext,
  bindContextToInvocation,
  validateHistoryRecord,
  isValidHistoryMetrics,
  projectHistory,
  validateHistoryProjection,
  buildFailureReferences,
  validateProviderEnvelope,
  bindProviderResults,
} = require("./triage-boundary-contract");

class AnalyzerError extends Error {}

const CONTEXT_REL_PATH = "reports/ai/context.json";
const HISTORY_REL_PATH = "reports/ai/history.json";

// Roadmap FPI-2: `root` (the caller's already-validated
// `{ lexicalRoot, realRoot }` boundary, see scripts/ai/repository-root.js)
// replaces this file's former module-level ROOT/CONTEXT_FILE constants -
// context.json is always read from underneath the TARGET repository,
// never this generic core's own `__dirname`.
//
// Triage Boundary Contract v1 (TSB-F07): the file must canonically resolve
// inside the repository root (symlink escapes are refused), is read with a
// hard byte cap BEFORE complete buffering/parsing, and is returned only as
// the detached, frozen PersistedTriageContextV1 snapshot - never the raw
// parsed object. Diagnostics never quote file content or parser text.
function readContext(root) {
  const { value, rejected } = resolveSafeLocalAttachmentPath(CONTEXT_REL_PATH, root);
  if (rejected) {
    throw new AnalyzerError(`${CONTEXT_REL_PATH} does not resolve to a regular file inside the repository root.`);
  }
  if (!value) {
    throw new AnalyzerError(`${CONTEXT_REL_PATH} not found. Run "npm run ai:collect" (after a test run) first.`);
  }
  return readPersistedContext(path.join(root.realRoot, value), CONTEXT_REL_PATH);
}

// Roadmap #19.5B: classifies context.metadata.framework's presence/
// well-formedness the same way the former classifyProjectId() did for
// project identity - ABSENT (never set) vs. INVALID (present but
// malformed: null/""/whitespace/non-string) vs. VALID (normalized: trim +
// lowercase, matching the declared FrameworkId contract). Deliberately a
// separate local copy from knowledge/selector.js's own classifyFrameworkId()
// - not a shared module - following this repository's existing "small
// duplicated primitives, not a shared refactor" convention (see that
// module's own comment). Both classifiers must still agree on what counts
// as VALID/ABSENT/INVALID so every consumer (Knowledge eligibility here vs.
// the actual provider-visible systemPrompt/userPrompt/report provenance in
// this file) represents one coherent canonical framework identity - only
// each consumer's handling of the non-VALID states differs.
function classifyFrameworkId(metadata) {
  const hasProperty = Boolean(metadata) && Object.prototype.hasOwnProperty.call(metadata, "framework");
  if (!hasProperty) return { state: "ABSENT", value: null };

  const raw = metadata.framework;
  if (typeof raw !== "string" || raw.trim().length === 0) return { state: "INVALID", value: null };

  return { state: "VALID", value: raw.trim().toLowerCase() };
}

// XI-02: optional by design (see collect-history.js) - a missing file, an
// over-bound/unreadable/malformed file, an { available: false } marker, a
// record outside the closed bounded History variants (including the legacy
// shapes without projectId/framework), or History collected for a
// different project or framework all mean "no usable history" (null) -
// never an error and never fabricated zero counters, so "no history" and
// "history says 0 failures" stay distinguishable. History is deliberately
// cross-run: it is NOT bound to the current run/invocation id, only to the
// validated context's project and framework. The returned four-counter
// projection is the ONE History value both the prompt and the report use.
//
// `currentMetadata` must be the VALIDATED context snapshot's metadata
// (production calls this only after context validation and XI-01 binding).
function readHistory(currentMetadata, root) {
  const { value } = resolveSafeLocalAttachmentPath(HISTORY_REL_PATH, root);
  if (!value) return null;

  let record;
  try {
    record = validateHistoryRecord(readBoundedJsonFile(path.join(root.realRoot, value), MAX_HISTORY_BYTES, HISTORY_REL_PATH));
  } catch {
    return null;
  }

  return projectHistory(record, currentMetadata || {});
}

// Deterministic, offline QA Knowledge selection (Roadmap #16A) - reuses
// Roadmap #15's loader/selector directly rather than duplicating their
// logic. Adds zero provider/network calls: loadKnowledgeUnits() is local
// filesystem-only (throws loudly on a malformed curated unit - see
// knowledge/loader.js - never silently skips one), selectKnowledge() is a
// pure, synchronous, in-memory function - see scripts/ai/knowledge/. Named
// and exported (like readHistory() below) so tests can inject a fixed
// result instead of touching the real scripts/ai/knowledge/units/ corpus.
//
// Roadmap FPI-3bA: `projectKnowledgeConfig` is an OPTIONAL, additive
// second source, wired the same way FPI-3A/B wire frameworkRuntimeConfig -
// absence is not an error (byte-identical to pre-FPI-3bA: core corpus
// only), while a SUPPLIED config is validated and, on any problem, fails
// closed rather than silently collapsing into "no config" behavior. This
// mirrors cypress-adapter.js's own resolveFrameworkRuntimeConfigLayout()
// exactly: shape validation, then identity-consistency validation, then -
// only for a config that also supplies the optional directory field -
// directory-level containment via context-utils.js's own
// resolveRepositoryLocalPath(), before any project unit is ever read.
//
// `root` (ProjectProfile.id's filesystem counterpart) is required only
// when actually needed to resolve a configured directory - a config with
// only `projectId` (no `projectKnowledgeUnitsDir`) never touches `root` at
// all, matching ProjectKnowledgeConfig's own "the directory field is
// genuinely optional" contract.
function computeRelevantKnowledge(context, { root, projectProfile, projectKnowledgeConfig } = {}) {
  const coreUnits = loadKnowledgeUnits();

  if (projectKnowledgeConfig === undefined) {
    return selectKnowledge(context, coreUnits);
  }

  // Structurally invalid config - fails closed via the existing FPI-1
  // validator; never silently treated as absence.
  const config = assertValidProjectKnowledgeConfig(
    projectKnowledgeConfig,
    "analyze-failure.computeRelevantKnowledge(): projectKnowledgeConfig"
  );

  // Identity mismatch - fails closed. A config for the wrong project is a
  // configuration error, never silently downgraded to "no config" or
  // silently substituted for the mismatched project's own knowledge.
  // TSB-F05-D1-C1: the profile crosses the central boundary here and only
  // its snapshot id is compared - no local, weaker ProjectProfile check.
  const profileResult = inspectProjectProfile(projectProfile);
  if (!profileResult.valid) {
    throw new Error(
      "PROJECT_KNOWLEDGE_CONFIG_PROJECT_PROFILE_REQUIRED: analyze-failure.computeRelevantKnowledge() received a projectKnowledgeConfig but no valid projectProfile to validate it against."
    );
  }
  if (config.projectId !== profileResult.snapshot.id) {
    throw new Error(
      "PROJECT_KNOWLEDGE_CONFIG_PROJECT_MISMATCH: analyze-failure.computeRelevantKnowledge() received a ProjectKnowledgeConfig for a different project than the current invocation."
    );
  }

  // The optional directory field genuinely absent (or explicitly
  // `undefined`) - a valid config with only `projectId` - contributes no
  // project units, matching the exact same core-only behavior as no
  // config at all.
  if (config.projectKnowledgeUnitsDir === undefined) {
    return selectKnowledge(context, coreUnits);
  }

  if (!root || typeof root.lexicalRoot !== "string" || typeof root.realRoot !== "string") {
    throw new Error(
      "PROJECT_KNOWLEDGE_CONFIG_ROOT_REQUIRED: analyze-failure.computeRelevantKnowledge() received a projectKnowledgeConfig with projectKnowledgeUnitsDir but no repositoryRoot to resolve it against."
    );
  }

  const unitsDir = resolveRepositoryLocalPath(
    config.projectKnowledgeUnitsDir,
    root,
    "analyze-failure.computeRelevantKnowledge(): projectKnowledgeConfig.projectKnowledgeUnitsDir"
  );
  const projectUnits = loadProjectKnowledgeUnits(unitsDir, root);
  const combinedUnits = composeKnowledgeUnits(coreUnits, projectUnits);
  return selectKnowledge(context, combinedUnits);
}

function pickSourceContext(context) {
  const m = context.metadata || {};
  // Roadmap #19.5B: classified, not read raw - a present-but-malformed
  // context.metadata.framework (whitespace/number/object/array) must never
  // be persisted verbatim into report provenance, only a genuinely VALID,
  // normalized identity or null (covering both ABSENT and INVALID alike,
  // since neither represents a trustworthy canonical value).
  const frameworkClassification = classifyFrameworkId(m);
  return {
    // Stable, machine-readable project identity (Roadmap #19.2) - read
    // straight off context.metadata.projectId (set by
    // scripts/ai/collect-context.js from scripts/ai/project-profile.js),
    // never recomputed or re-derived here. null for a context that
    // predates this field or wasn't produced by the collector (e.g. a
    // hand-built test fixture).
    projectId: m.projectId ?? null,
    // Roadmap #19.5B: canonical test-framework identity, derived from
    // context.metadata.framework (set by collect-context.js) via
    // classifyFrameworkId(), never derived from specFile/workflow/Knowledge
    // defaults here. null for a context that predates this field, and
    // equally null for a present-but-malformed value - additive provenance
    // only, exactly like projectId's own null legacy fallback above.
    framework: frameworkClassification.state === "VALID" ? frameworkClassification.value : null,
    repository: m.repository ?? null,
    commit: m.commit ?? null,
    branch: m.branch ?? null,
    runId: m.runId ?? null,
    event: m.event ?? null,
    browser: m.browser ?? null,
    ci: m.ci ?? null,
    contextGeneratedAt: context.generatedAt || null,
    // Deterministic cross-browser correlation metadata (see PR #33's
    // aggregate-browser-context.js) - carried through onto ai-report.json,
    // the same way it was already carried into the prompt (see
    // qa-agent-prompt.js), purely for observability: future
    // evaluation/tooling can tell single- from multi-browser failures
    // without re-deriving it. null for contexts that weren't produced by
    // the aggregator (e.g. a local run). Roadmap #21G-C1: restricted to
    // the primary failure's own framework only - see aggregate-browser-
    // context.js's own module comment. Roadmap #21H (D21G-3): explicitly
    // re-projected through correlation-projection.js rather than passed
    // through wholesale - see that file's own module comment for why a
    // bare `context.browserCorrelation ?? null` passthrough was no longer
    // sufficient once History added another framework-sensitive evidence
    // dimension.
    browserCorrelation: projectBrowserCorrelation(context.browserCorrelation),
    // Roadmap #21G-C1: the separate cross-framework rollup (see
    // aggregate-browser-context.js's buildFrameworkCorrelation() and
    // qa-agent-prompt.js's rule 10b) - carried through for the same
    // observability reason as browserCorrelation above. Deliberately never
    // merged with browserCorrelation: this is workflow-level evidence,
    // never same-test evidence. Roadmap #21H (D21G-3): same explicit
    // bounded re-projection as browserCorrelation above.
    frameworkCorrelation: projectFrameworkCorrelation(context.frameworkCorrelation),
    // The EXACT QA Knowledge units this analysis's provider call actually
    // received (Roadmap #16C) - read directly off context.relevantKnowledge
    // (already attached in buildFailureReport(), before runProviderAnalysis
    // ever ran), never recomputed via a second selectKnowledge() call here.
    // Recomputing would risk drifting from what the model actually saw if
    // the corpus changed between analysis and report-building, however
    // unlikely - reading the same value already threaded through the
    // prompt is the only way to guarantee this field is truthful. Always
    // an array (never omitted): [] is a meaningful, intentional signal
    // that no curated knowledge matched this run, not an absence of data.
    relevantKnowledge: context.relevantKnowledge ?? [],
  };
}

// --- response validation --------------------------------------------------
// No structured-output schema is enforced on the provider call - not
// every provider is guaranteed to honor one identically. So the
// provider's JSON shape is NOT trusted: TSB-F04's closed, bounded result
// contract (triage-boundary-contract.js validateProviderEnvelope() /
// bindProviderResults()) validates every value and binds every result to
// exactly one local failure reference before ai-report.json is written.

// Defense-in-depth against the one recommendation style the agent is
// explicitly told not to make. The prompt is the primary control; this is
// a non-blocking safety net that surfaces a warning instead of silently
// trusting the provider.
const ARBITRARY_WAIT_PATTERN = /\bcy\.wait\(\s*\d+\s*\)|waitForTimeout\(\s*\d+\s*\)/i;

function recommendsArbitraryWait(item) {
  const text = (item.recommendedFix && item.recommendedFix.description) || "";
  return ARBITRARY_WAIT_PATTERN.test(text);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// TSB-F06: pre-parse bound on the raw provider model text, checked BEFORE
// any fence stripping or JSON.parse - the same discipline as the
// generators' MAX_*_RESPONSE_CHARS (e.g. generate-change-set.js), counted
// the same way: String length, i.e. UTF-16 code units. The value is the
// automation-plan generator's own bound (MAX_AUTOMATION_PLAN_RESPONSE_CHARS).
// Triage output has no closed size schema to derive a tighter worst case
// from (that is TSB-F04's corrective, not this one); one result per failed
// test is a handful of short prose fields, so 1,000,000 characters is far
// above any legitimate triage response. Oversized text fails closed with
// no retry - exactly like invalid JSON here - and no report is written.
const MAX_TRIAGE_RESPONSE_CHARS = 1000000;

// Providers occasionally wrap JSON in a markdown code fence despite being
// told not to (see the OUTPUT FORMAT instruction in qa-agent-prompt.js).
// Strip that defensively rather than failing outright - the prompt is the
// primary control, this is the fallback. Provider-neutral: not specific
// to any one provider's response format.
function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

// Fixed, allowlisted messages for persisted provider-error provenance
// (Roadmap #18.3, hardened) - keyed on PROVIDER_ERROR_CODES, the same
// generic vocabulary the retry loop already reasons about. Deliberately
// NOT derived from any underlying err.message/err.cause: a provider's own
// message (e.g. GroqProvider's NETWORK-path text, which embeds whatever
// the underlying fetch() exception says) or a future provider adapter's
// raw SDK exception text is not guaranteed to be free of request/response
// detail, so none of it may reach a persisted artifact - only which fixed,
// pre-approved category occurred. err.code itself (not this map) remains
// the precise machine-readable diagnostic.
const SAFE_PROVIDER_ERROR_MESSAGES = {
  [PROVIDER_ERROR_CODES.AUTH]: "Provider authentication failed",
  [PROVIDER_ERROR_CODES.RATE_LIMIT]: "Provider rate limit exceeded",
  [PROVIDER_ERROR_CODES.TIMEOUT]: "Provider request timed out",
  [PROVIDER_ERROR_CODES.NETWORK]: "Provider network request failed",
  [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: "Provider returned an invalid response",
  [PROVIDER_ERROR_CODES.CONFIGURATION]: "Provider configuration error",
  [PROVIDER_ERROR_CODES.UNKNOWN]: "Unknown provider error",
};

// Safe, provider-neutral summary of a ProviderError - code/message/
// retryable only, message looked up from the fixed allowlist above rather
// than copied from the error itself. An unrecognized code (should never
// happen given PROVIDER_ERROR_CODES is the only vocabulary ProviderError
// uses, but checked defensively) falls back to the same fixed UNKNOWN
// message rather than ever touching err.message. Roadmap #20B: this is
// the ONE sanitization policy used everywhere a provider error becomes
// visible outside the live ProviderError instance itself - both the
// persisted ai-report.json's firstAttemptError AND the terminal
// AnalyzerError thrown below (which fail()/console.error ultimately
// surfaces in CI logs) route through this exact same lookup, so a raw
// provider/network error message (which could otherwise contain request
// detail an underlying transport library's own error text happens to
// include) is never propagated to either destination.
function summarizeProviderError(err) {
  if (!err) return null;
  return {
    code: err.code,
    message: SAFE_PROVIDER_ERROR_MESSAGES[err.code] || SAFE_PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.UNKNOWN],
    retryable: err.retryable,
  };
}

// Bounded retry around a single provider.analyze() call. Providers signal
// "this specific failure is worth retrying" via ProviderError's
// `retryable` flag (see providers/provider-error.js) - this orchestration
// layer never inspects an HTTP status code or any other provider-specific
// detail, only that one generic, provider-neutral signal. Any exception a
// provider throws - whether it's already a ProviderError or an ordinary
// Error escaping a buggy implementation - is normalized to a ProviderError
// before that decision is made, so this loop only ever has one error shape
// to reason about. `sleep` is injectable for testing.
async function runProviderAnalysis(
  provider,
  context,
  { maxAttempts = 3, retryDelaysMs = [500, 1500], sleep = defaultSleep, projectProfile } = {}
) {
  // A provider missing analyze() (or not an object at all) can never
  // succeed on retry - fail once, clearly, before spending any attempts.
  validateProvider(provider);

  // Roadmap #19.4S: orchestration wiring only - buildSystemPrompt() has
  // accepted an optional projectProfile since Roadmap #19.2 (see
  // qa-agent-prompt.js), but no caller of this function ever threaded one
  // through, so the ACTUAL provider-visible system prompt always used the
  // production default regardless of which project a context described.
  // `projectProfile` is `undefined` for every existing caller (production
  // main() never passes one), so buildSystemPrompt(undefined) falls
  // through to its own existing default parameter exactly as before -
  // this line changes no existing behavior, only what a future explicit
  // caller can opt into.
  //
  // Roadmap #19.5B: frameworkId is derived from context.metadata.framework
  // (the same canonical location report provenance and Knowledge selection
  // both already read) via classifyFrameworkId(), rather than the raw
  // property value - a raw, unvalidated pass-through would let a
  // malformed value (whitespace/number/object/array) render as literal
  // garbage inside the persona sentence (e.g. "current test framework:
  // [object Object]"), which is never acceptable model input. ABSENT
  // (undefined) still falls through to buildSystemPrompt()'s own existing
  // "cypress" default parameter, exactly the same no-behavior-change-for-
  // legacy pattern projectProfile already uses. INVALID (present but
  // malformed) deliberately does NOT fall through to that same default -
  // silently mapping a genuinely malformed value to "cypress" would
  // misrepresent it as the ordinary legacy case - so it renders the
  // explicit, deterministic "unknown" label instead.
  const frameworkClassification = classifyFrameworkId(context && context.metadata);
  const frameworkId =
    frameworkClassification.state === "VALID"
      ? frameworkClassification.value
      : frameworkClassification.state === "INVALID"
        ? "unknown"
        : undefined;
  const systemPrompt = buildSystemPrompt(projectProfile, frameworkId);
  const userPrompt = buildUserPrompt(context);

  let raw;
  let lastErr;
  // Roadmap #18.3 provenance - purely additive bookkeeping alongside the
  // existing loop, never influencing retry/break decisions (those still
  // depend only on `attempt`/`lastErr.retryable`, exactly as before).
  // `providerAttempts` is the 1-based attempt count reached so far;
  // `firstErr` captures only the FIRST catch's normalized error and is
  // never overwritten by a later attempt's error, so a multi-attempt
  // sequence's provenance always points at what actually went wrong first.
  let providerAttempts = 0;
  let firstErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    providerAttempts = attempt;
    try {
      const response = await provider.analyze({ systemPrompt, userPrompt });
      validateProviderResponse(response);
      raw = response;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = normalizeProviderError(err);
      if (!firstErr) firstErr = lastErr;
      if (attempt === maxAttempts || !lastErr.retryable) break;
      await sleep(retryDelaysMs[attempt - 1] ?? retryDelaysMs[retryDelaysMs.length - 1]);
    }
  }

  if (lastErr) {
    // Roadmap #20B: routed through the same summarizeProviderError()
    // allowlist the persisted firstAttemptError already uses - never
    // lastErr.message directly, which could otherwise carry an
    // underlying transport/network library's own raw error text (not a
    // credential today, in this repo's own providers, but never
    // guaranteed for any error that reaches this generic retry loop)
    // into a terminal, console-logged CI message. Deliberately surfaces
    // only code + the fixed safe message - never the raw provider
    // error/request object (or its .cause), which could otherwise leak
    // request metadata (e.g. an Authorization header a real provider
    // set) into CI logs.
    const code = lastErr.code ? ` (${lastErr.code})` : "";
    const safeMessage = summarizeProviderError(lastErr).message;
    throw new AnalyzerError(`AI provider request failed${code}: ${safeMessage}`);
  }

  if (raw.length > MAX_TRIAGE_RESPONSE_CHARS) {
    throw new AnalyzerError(`AI provider response exceeds the maximum of ${MAX_TRIAGE_RESPONSE_CHARS} characters.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch (err) {
    throw new AnalyzerError(`AI provider response was not valid JSON: ${err.message}`);
  }

  // TSB-F04: closed envelope (exactly `results`) and closed, bounded result
  // objects, returned as a detached frozen snapshot. The diagnostic names
  // only the failing field - never a provider-controlled value or key.
  let results;
  try {
    results = validateProviderEnvelope(parsed);
  } catch (err) {
    throw new AnalyzerError(`AI provider response failed validation: ${err.message}`);
  }

  return {
    results,
    providerAttempts,
    firstAttemptError: summarizeProviderError(firstErr),
  };
}

// Builds the full ai-report.json object for a context that has at least
// one failed test - the one piece of orchestration logic worth testing
// independently of file I/O (see analyze-failure.test.js's pipeline test).
// `provider`/`history` are injectable so a test can supply a MockProvider
// and a fixed history value without touching process.env or the real
// reports/ai/history.json file; production (main(), below) always lets
// both default to their real implementations.
//
// Roadmap FPI-3bA: `relevantKnowledge` is deliberately NOT computed as a
// default-parameter expression (unlike `history` above, which may safely
// reference `root` - already bound earlier in this same destructuring
// pattern). computeRelevantKnowledge() now also needs `projectProfile` and
// `projectKnowledgeConfig`, both of which are destructured LATER in this
// parameter list - a default-parameter expression can only see
// already-bound earlier names, so computing it eagerly here would silently
// run with `projectProfile`/`projectKnowledgeConfig` unavailable. Computed
// explicitly inside the function body instead (below), after every
// parameter is bound. An explicitly supplied `relevantKnowledge` (e.g. from
// a test) is preserved exactly as before - "supplied" is decided via
// `!== undefined`, so no additional knowledge loading/composition ever runs
// in that case.
//
// Triage Boundary Contract v1: `context` crosses validatePersistedContext()
// here (closed PersistedTriageContextV1, embedded History rejected) and only
// the detached snapshot is read from then on - the caller's object is never
// mutated or re-read. An injected `history` must be null or exactly the
// four-counter projection; otherwise History comes only from the separately
// validated history.json. XI-01 invocation binding is main()'s gate (this
// function is an internal, non-exported building block).
async function buildFailureReport(
  context,
  { provider = createProvider(), root, history, relevantKnowledge, projectProfile: inputProfile, projectKnowledgeConfig } = {}
) {
  // TSB-F05-D1-C1: crosses the central boundary FIRST - before any
  // ProjectProfile-derived context mutation, Knowledge selection, or
  // provider call - and only the resulting snapshot is threaded below.
  const projectProfile = assertValidProjectProfile(inputProfile, "analyze-failure.buildFailureReport()");
  const validContext = validatePersistedContext(context);
  const generatedAt = new Date().toISOString();

  // XI-02: the ONE History projection - the same frozen value reaches the
  // prompt and the report (H06-C2).
  const historyProjection = history !== undefined ? validateHistoryProjection(history) : readHistory(validContext.metadata, root);

  // TSB-F04: one opaque local reference per authoritative failed test,
  // created before any provider call.
  const references = buildFailureReferences(validContext.failedTests);

  // Deterministic QA Knowledge selection (Roadmap #16A), computed from the
  // validated snapshot only. Always an array (selectKnowledge() never
  // returns null).
  const knowledge =
    relevantKnowledge !== undefined
      ? snapshotPlainData(relevantKnowledge, "relevantKnowledge", "RELEVANT_KNOWLEDGE_INVALID")
      : computeRelevantKnowledge(validContext, { root, projectProfile, projectKnowledgeConfig });

  // A new enriched object for prompt building - never a mutation of the
  // validated snapshot. Each prompt-visible failure carries its reference.
  const promptContext = {
    ...validContext,
    failedTests: validContext.failedTests.map((failure, i) => ({ ...failure, failureRef: references[i].failureRef })),
    history: historyProjection,
    relevantKnowledge: knowledge,
  };

  // Roadmap #19.4S: threaded through to runProviderAnalysis's own
  // system-prompt profile selection only - see the comment there. Never
  // read anywhere else in this function: it does not touch context,
  // history, relevantKnowledge, or report provenance, all of which stay
  // exactly the explicit, caller-supplied data channels Roadmap
  // #19.2/#19.3 already established.
  const { results: providerResults, providerAttempts, firstAttemptError } = await runProviderAnalysis(provider, promptContext, {
    projectProfile,
  });

  // TSB-F04: exact result-set binding, then authoritative identity
  // reconstructed from the local snapshot (never the model's title/spec).
  let results;
  try {
    results = bindProviderResults(providerResults, references);
  } catch (err) {
    if (!(err instanceof TriageBoundaryError)) throw err;
    throw new AnalyzerError(`AI provider response failed validation: ${err.message}`);
  }

  // LLM proposes, application policy decides (see scripts/ai/agent-policy.js):
  // only after this point do "results" reflect what the application
  // actually decided is allowed, not just what the provider recommended.
  // Applied to every result, not just the first - a report can cover more
  // than one failed test. Logged here (not inside the pure policy module
  // itself) only when an intervention actually happened, to avoid noise.
  const policySafeResults = results.map(applyAgentPolicy);
  policySafeResults.forEach((item, i) => {
    if (item.policy.adjusted) {
      console.log(`[ai:policy] Overrode shouldCreateBug=true for classification ${item.classification} (results[${i}]).`);
    }
  });

  const warnings = [];
  policySafeResults.forEach((item, i) => {
    if (recommendsArbitraryWait(item)) {
      warnings.push(
        `results[${i}] (${(item.test && item.test.title) || "unknown test"}) recommends a fixed-duration wait; review before applying - prefer deterministic synchronization.`
      );
    }
  });

  return {
    generatedAt,
    model: MODEL,
    // Application-attributed metadata about the analysis run itself -
    // added here, after the model response has already been validated,
    // never inside the LLM-generated JSON schema (a provider has no
    // business asserting its own name; the application already knows it).
    // Kept as its own object rather than replacing the existing top-level
    // generatedAt/model fields so format-pr-comment.js's existing
    // `report.model` read keeps working unchanged. providerAttempts/
    // firstAttemptError (Roadmap #18.3) are the same values
    // runProviderAnalysis already computed internally - surfaced here
    // rather than recomputed, and only ever present for a report that
    // reaches this point at all (a terminal provider failure throws
    // before buildFailureReport ever returns, so there is no report to
    // attach this provenance to in that case - see runProviderAnalysis).
    analysis: { provider: provider.name || "unknown", generatedAt, providerAttempts, firstAttemptError },
    sourceContext: pickSourceContext({ ...validContext, relevantKnowledge: knowledge }),
    // Same compact counts the provider saw (the identical projection
    // object), kept on the report for traceability - not the raw per-run
    // data (there isn't any to keep; collect-history.js never persists
    // more than these aggregates).
    history: historyProjection,
    results: policySafeResults,
    warnings,
  };
}

function fail(message) {
  console.error(`[ai:analyze] Error: ${message}`);
  process.exitCode = 1;
}

// Roadmap TI-1: `projectProfile` is required and validated FIRST - before
// readContext(), before the output directory is created, and before the
// zero-failed-tests early-return's own artifact write below. A generic,
// target-aware runtime invocation must never produce ANY report artifact
// (empty or otherwise) under an unknown/invalid target identity. A
// target-owned bootstrap (see scripts/targets/targomo/analyze-failure.js)
// supplies the real production profile; this function's own rejection on
// a missing/invalid one is caught by the same require.main===module
// handler at the bottom of this file that already handles every other
// main() failure, so no separate error path is needed here.
//
// Roadmap FPI-2: `repositoryRoot` is validated immediately after
// `projectProfile` - also before readContext(), before the output
// directory is created, and before the zero-failed-tests early-return's
// own artifact write. context.json/history.json/ai-report.json are all
// resolved from this single validated `root` boundary, never from this
// generic core's own `__dirname`.
//
// Roadmap FPI-3bA: `projectKnowledgeConfig` is OPTIONAL and passed through
// unvalidated at this point - a target-owned bootstrap that omits it sees
// byte-identical pre-FPI-3bA behavior (core-corpus-only Knowledge
// selection). When supplied, it is validated lazily inside
// computeRelevantKnowledge() (via buildFailureReport() below), the same
// point that already computes relevantKnowledge - matching the
// zero-failed-tests early return below, which already never invoked
// Knowledge selection at all before this change either.
//
// TSB-F05-D1-C1: the caller's profile crosses the central boundary once,
// here; only the resulting snapshot (`profile`) is passed on to
// buildFailureReport() - `projectProfile` is never read again.
//
// Triage Boundary Contract v1 - this function is the authoritative XI-01
// gate. Before ANY provider call or report write, in this order:
// ProjectProfile and repository root (above), exactly one trusted current
// invocation mode from the process environment (github-actions-v1 /
// local-v1 - never a parameter of this function), the byte-capped closed
// PersistedTriageContextV1 snapshot, and its exact binding to the profile
// and the trusted invocation. A missing/contradictory mode, a malformed or
// stale/copied context (another project, repository, commit, run, run
// attempt or local invocation) fails closed and writes no report - the
// zero-failure path included.
async function main({ projectProfile, repositoryRoot, projectKnowledgeConfig } = {}) {
  const profile = assertValidProjectProfile(projectProfile, "analyze-failure.main()");
  const root = assertValidRepositoryRoot(repositoryRoot, "analyze-failure.main()");
  const outputFile = path.join(root.realRoot, "reports", "ai", "ai-report.json");

  let context;
  try {
    const invocation = resolveTrustedInvocation();
    context = bindContextToInvocation(readContext(root), profile, invocation);
  } catch (err) {
    fail(err.message);
    return;
  }

  if (context.failedTests.length === 0) {
    const emptyReport = {
      generatedAt: new Date().toISOString(),
      model: MODEL,
      analysis: null,
      sourceContext: pickSourceContext(context),
      history: null,
      results: [],
      warnings: [],
      note: "No failed tests were present in reports/ai/context.json; nothing to analyze.",
    };
    // Roadmap FPI-2 Corrective C4 (FPI2-R-9): validated as close as
    // reasonably possible to the actual write - see
    // resolveSafeRepositoryWritePath()'s own documentation (context-utils.js).
    const safeOutputFile = resolveSafeRepositoryWritePath(outputFile, root, "analyze-failure.main(): ai-report.json (empty)");
    fs.writeFileSync(safeOutputFile, JSON.stringify(emptyReport, null, 2));
    console.log(`[ai:analyze] No failed tests to analyze. Wrote ${path.relative(root.realRoot, outputFile)}.`);
    return;
  }

  // Safe to log: provider/model are configuration, never a credential.
  // Never add AI_API_KEY (or anything derived from it) to this or any
  // other log line in this file.
  console.log(`[ai:analyze] AI provider: ${PROVIDER} · model: ${MODEL || "not configured"}`);

  let report;
  try {
    report = await buildFailureReport(context, { projectProfile: profile, root, projectKnowledgeConfig });
  } catch (err) {
    fail(err.message);
    return;
  }

  // Roadmap FPI-2 Corrective C4 (FPI2-R-9): re-validated here, immediately
  // before this write (not hoisted above the `await buildFailureReport`
  // call above) - see resolveSafeRepositoryWritePath()'s own documentation
  // (context-utils.js) for why validation should happen as close as
  // reasonably possible to the protected write, especially across an
  // await boundary.
  const safeOutputFile = resolveSafeRepositoryWritePath(outputFile, root, "analyze-failure.main(): ai-report.json");
  fs.writeFileSync(safeOutputFile, JSON.stringify(report, null, 2));
  console.log(`[ai:analyze] wrote ${path.relative(root.realRoot, outputFile)} (${report.results.length} result(s)).`);
  for (const w of report.warnings) console.log(`[ai:analyze] warning: ${w}`);
}

if (require.main === module) {
  main().catch((err) => {
    fail((err && err.message) || String(err));
  });
}

module.exports = {
  main,
  runProviderAnalysis,
  buildFailureReport,
  recommendsArbitraryWait,
  stripCodeFences,
  summarizeProviderError,
  pickSourceContext,
  readHistory,
  classifyFrameworkId,
  isValidHistoryMetrics,
  computeRelevantKnowledge,
  MAX_TRIAGE_RESPONSE_CHARS,
  MODEL,
};
