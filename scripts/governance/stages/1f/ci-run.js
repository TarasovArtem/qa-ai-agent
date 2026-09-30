/**
 * GOV-AUTO-1 Wave 4 / 1F -- CI run evidence: injectable retrieval boundary and
 * runtime schema (design sections 17, 20, 24).
 *
 * This module never decides whether a CI failure was harmless and never
 * classifies anything (see ./ci-classify.js for that layer, which consumes
 * only the validated shape this module produces). It has exactly one job:
 * retrieve a completed workflow run's evidence through an injectable adapter
 * and validate every field before anything downstream may trust it.
 *
 * Adapter contract (the same "{ ok: true, value } | { ok: false, detail }"-style
 * shape and injection seam every other stage already uses -- see
 * stages/1a/git-adapter.js#resolveGitAdapter -- narrow, test-fixture-replaceable,
 * no network code lives in the caller):
 *   fetchRun({ repository, workflowPath, headSha, event })
 *     -> Promise<{ ok: true, run: <raw provider shape> } | { ok: false, reason }>
 *
 * The deterministic suite never touches the network: it always injects a
 * fixture adapter satisfying the contract above. CORRECTIVE C6 (W4-C4R-INFO-4):
 * this module does NOT implement or provide a live GitHub adapter today --
 * there is no `createGithubCliAdapter()` (or equivalent) anywhere in this
 * repository, and no network call, subprocess invocation or GitHub-specific
 * code exists in `stages/1f/**` (see `wave4.test.js`'s own source-grep check
 * for this). `isGithubCiAdapter()`/`resolveGithubCiAdapter()` below only
 * define and resolve the INJECTABLE contract; an adapter satisfying it is
 * exactly as trustworthy as whatever constructed it, and nothing here proves
 * -- or claims -- that any given adapter is genuinely backed by an
 * authenticated GitHub connection. A real, operational live adapter is a
 * separately authorized, separately reviewed implementation (see the design's
 * D5 deferral and the Wave 4 corrective reports' own "D4/D5 live provider:
 * DEFERRED" disclosures); its future existence must not be inferred from this
 * comment or from the presence of the injection seam itself.
 *
 * CORRECTIVE C7 (W4-C6R-DEV-L1): a fetch-failure `reason` used to be
 * published verbatim from whatever an injected adapter returned (`fetched.reason`,
 * any string, any length) -- an untrusted-shaped value with no bound and no
 * canonical form, which `stages/1f/report.js`'s own, stricter Shape A
 * validation (Corrective C6) would then reject if it were empty or over 200
 * characters, leaving the collector able to publish a record the report
 * builder disagreed with. `normalizeFetchFailureReason()` below now maps
 * every adapter-supplied reason to a bounded, canonical-code-shaped value
 * (or a fixed fallback) BEFORE it is ever returned -- never an uncaught
 * exception, never unbounded text, and never treated as authoritative
 * platform identity: the four `WRONG_*` reasons remain exclusively internal
 * (produced only by the identity comparisons below, never derived from
 * adapter text), so normalizing the adapter's own `reason` string can never
 * manufacture one.
 */

"use strict";

const { isPlainObject } = require("../../kernel/validation");

const SHA40 = /^[0-9a-f]{40}$/;
const REPOSITORY_ID = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const EVENTS = new Set(["pull_request", "push"]);
const RUN_STATUS = new Set(["completed", "in_progress", "queued", "waiting"]);
const JOB_CONCLUSIONS = new Set(["success", "failure", "cancelled", "timed_out", "skipped", "neutral", "action_required", "stale", null]);
const MAX_JOBS = 256;
const MAX_ATTEMPTS = 64;
const MAX_ATTEMPT_NUMBER = 1000;
// Every reason this module or its caller may ever need to represent already
// takes this exact shape (MALFORMED_REQUEST, NO_ADAPTER_AVAILABLE,
// ADAPTER_THREW, MALFORMED_RUN_SHAPE, AMBIGUOUS_JOB_IDENTITY, WRONG_*,
// SOURCE_UNREACHABLE): an uppercase code, bounded well under 200 chars (the
// downstream Shape A bound). An adapter-supplied reason that does not match
// this shape is untrusted, unbounded free text and is normalized to the
// fixed fallback rather than published as-is.
const FETCH_FAILURE_REASON_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const DEFAULT_FETCH_FAILURE_REASON = "SOURCE_UNREACHABLE";

/**
 * Corrective C7 (W4-C6R-DEV-L1): the ONE place an adapter-supplied reason
 * string is ever accepted -- always bounded, always canonical-code-shaped,
 * deterministic, never a caller-text echo beyond the fixed pattern above.
 *
 * It also rejects any adapter-supplied reason that happens to start with
 * `WRONG_`, falling back to the default instead of passing it through: an
 * adapter reporting `{ok: false, reason: "WRONG_SHA"}` (a genuine fetch
 * failure, never having reached the identity comparisons below) would
 * otherwise pass canonical-shape validation and be published verbatim,
 * letting adapter-chosen text impersonate the four WRONG_* codes this
 * function's own callers reserve exclusively for an internally PROVEN
 * identity mismatch (a successfully fetched, fully validated run whose
 * fields were actually compared against the request). Without this
 * exclusion, that adapter text would reach `stages/1f/ci-evidence.js`'s
 * `reason.startsWith("WRONG_")` classification check and be reported as
 * FAIL ("CI definitively ran against the wrong commit") when the truth is
 * merely "the run could not be fetched at all" (INCOMPLETE) -- the record's
 * meaning would misrepresent what was actually established.
 */
function normalizeFetchFailureReason(reason) {
  if (typeof reason !== "string" || !FETCH_FAILURE_REASON_PATTERN.test(reason)) return DEFAULT_FETCH_FAILURE_REASON;
  if (reason.startsWith("WRONG_")) return DEFAULT_FETCH_FAILURE_REASON;
  return reason;
}

function isGithubCiAdapter(adapter) {
  return isPlainObject(adapter) && typeof adapter.fetchRun === "function";
}

/**
 * resolveGithubCiAdapter(input) -- same resolution SEAM
 * stages/1a/git-adapter.js#resolveGitAdapter() establishes for its own stage,
 * narrowed to what this module actually implements: an already-valid
 * injected adapter wins; otherwise resolution fails (`{ok:false}`) and the
 * caller reports `NO_ADAPTER_AVAILABLE` / INCOMPLETE (never fabricates
 * evidence). Corrective C7 (W4-C6R-INFO-2): there is no "otherwise a real
 * one is built from trusted config" branch -- unlike `resolveGitAdapter()`,
 * this function never constructs a live adapter from configuration, because
 * no live GitHub adapter implementation exists in this module (see the file
 * header).
 */
function resolveGithubCiAdapter(input) {
  if (isPlainObject(input) && isGithubCiAdapter(input.githubCi)) return { ok: true, adapter: input.githubCi };
  return { ok: false };
}

function isValidJob(job) {
  if (!isPlainObject(job)) return false;
  const keys = Object.keys(job).sort().join(",");
  if (keys !== "conclusion,name,status") return false;
  if (typeof job.name !== "string" || job.name.length === 0 || job.name.length > 200) return false;
  if (!RUN_STATUS.has(job.status) && job.status !== "completed") return false;
  return job.conclusion === null || (typeof job.conclusion === "string" && JOB_CONCLUSIONS.has(job.conclusion));
}

function isValidAttemptHistoryEntry(entry) {
  if (!isPlainObject(entry)) return false;
  const keys = Object.keys(entry).sort().join(",");
  if (keys !== "attempt,conclusion,failedJobs") return false;
  if (!Number.isInteger(entry.attempt) || entry.attempt < 1 || entry.attempt > MAX_ATTEMPT_NUMBER) return false;
  if (typeof entry.conclusion !== "string" || entry.conclusion.length === 0 || entry.conclusion.length > 32) return false;
  return Array.isArray(entry.failedJobs) && entry.failedJobs.length <= MAX_JOBS && entry.failedJobs.every((j) => typeof j === "string" && j.length > 0 && j.length <= 200);
}

/**
 * Validate a raw run object against the exact schema this module requires.
 * Returns { ok, run, reason }; `reason` is a fixed label (INCOMPLETE-class,
 * never a caller-text echo), matching design section 20's "unexpected shape
 * is INCOMPLETE, never coerced" rule.
 */
function validateRunEvidence(raw) {
  if (!isPlainObject(raw)) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  const keys = Object.keys(raw).sort().join(",");
  if (keys !== "attempt,attemptHistory,event,headSha,jobs,repository,runId,status,workflowPath") return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (typeof raw.repository !== "string" || !REPOSITORY_ID.test(raw.repository)) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (typeof raw.workflowPath !== "string" || raw.workflowPath.length === 0 || raw.workflowPath.length > 300) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (typeof raw.runId !== "string" || raw.runId.length === 0 || raw.runId.length > 64) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (!EVENTS.has(raw.event)) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (typeof raw.headSha !== "string" || !SHA40.test(raw.headSha)) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (!Number.isInteger(raw.attempt) || raw.attempt < 1 || raw.attempt > MAX_ATTEMPT_NUMBER) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (!RUN_STATUS.has(raw.status)) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (!Array.isArray(raw.jobs) || raw.jobs.length > MAX_JOBS || !raw.jobs.every(isValidJob)) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  if (!Array.isArray(raw.attemptHistory) || raw.attemptHistory.length > MAX_ATTEMPTS || !raw.attemptHistory.every(isValidAttemptHistoryEntry)) return { ok: false, reason: "MALFORMED_RUN_SHAPE" };
  // Duplicate job names within one run are themselves an ambiguity the caller
  // must not silently resolve (matching the C1/C2 duplicate-identity precedent
  // elsewhere in this framework): report it, never pick a winner here.
  const names = raw.jobs.map((j) => j.name);
  if (new Set(names).size !== names.length) return { ok: false, reason: "AMBIGUOUS_JOB_IDENTITY" };
  return {
    ok: true,
    run: {
      repository: raw.repository, workflowPath: raw.workflowPath, runId: raw.runId, event: raw.event,
      headSha: raw.headSha, attempt: raw.attempt, status: raw.status,
      jobs: raw.jobs.map((j) => ({ name: j.name, status: j.status, conclusion: j.conclusion })),
      attemptHistory: raw.attemptHistory.map((a) => ({ attempt: a.attempt, conclusion: a.conclusion, failedJobs: [...a.failedJobs] })),
    },
  };
}

/**
 * fetchValidatedRun({ adapter | githubCi, repository, workflowPath, headSha, event })
 *   -> Promise<{ ok: true, run } | { ok: false, reason }>
 *
 * The single entry point every later WP uses. Resolves the INJECTED adapter
 * (Corrective C7, W4-C6R-INFO-2: there is no "or real" branch -- see
 * resolveGithubCiAdapter()'s own doc comment), calls it, and validates the
 * result -- never returns an unvalidated shape to a caller. Every `reason`
 * this function can return is either produced internally (a fixed,
 * canonical label) or the adapter's own reason string passed through
 * normalizeFetchFailureReason() -- never raw, unbounded adapter text.
 */
async function fetchValidatedRun(input) {
  if (!isPlainObject(input)) return { ok: false, reason: "MALFORMED_REQUEST" };
  if (typeof input.repository !== "string" || !REPOSITORY_ID.test(input.repository)) return { ok: false, reason: "MALFORMED_REQUEST" };
  if (typeof input.workflowPath !== "string" || input.workflowPath.length === 0) return { ok: false, reason: "MALFORMED_REQUEST" };
  if (typeof input.headSha !== "string" || !SHA40.test(input.headSha)) return { ok: false, reason: "MALFORMED_REQUEST" };
  if (!EVENTS.has(input.event)) return { ok: false, reason: "MALFORMED_REQUEST" };
  const resolved = isGithubCiAdapter(input.adapter) ? { ok: true, adapter: input.adapter } : resolveGithubCiAdapter(input);
  if (!resolved.ok) return { ok: false, reason: "NO_ADAPTER_AVAILABLE" };
  let fetched;
  try {
    fetched = await resolved.adapter.fetchRun({ repository: input.repository, workflowPath: input.workflowPath, headSha: input.headSha, event: input.event });
  } catch {
    return { ok: false, reason: "ADAPTER_THREW" };
  }
  if (!isPlainObject(fetched) || fetched.ok !== true) {
    const rawReason = isPlainObject(fetched) ? fetched.reason : undefined;
    return { ok: false, reason: normalizeFetchFailureReason(rawReason) };
  }
  const validated = validateRunEvidence(fetched.run);
  if (!validated.ok) return validated;
  // Wrong-repository, wrong-SHA, wrong-event or wrong-workflow evidence is
  // never silently accepted as if it were the requested run (design section
  // 25 rule 3): the adapter is asked for a specific run, but nothing here
  // trusts that it actually returned it.
  if (validated.run.repository !== input.repository) return { ok: false, reason: "WRONG_REPOSITORY" };
  if (validated.run.headSha !== input.headSha) return { ok: false, reason: "WRONG_SHA" };
  if (validated.run.event !== input.event) return { ok: false, reason: "WRONG_EVENT" };
  if (validated.run.workflowPath !== input.workflowPath) return { ok: false, reason: "WRONG_WORKFLOW" };
  return validated;
}

module.exports = { isGithubCiAdapter, resolveGithubCiAdapter, validateRunEvidence, fetchValidatedRun, normalizeFetchFailureReason };
