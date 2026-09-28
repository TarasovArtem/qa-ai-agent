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
 * fixture adapter. A live adapter (built on the Wave 0 process runner, argument
 * arrays only, exercised only by its own separately labeled, non-required test)
 * is provided by createGithubCliAdapter() for actual use, but nothing in this
 * module or its consumers requires it to run.
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

function isGithubCiAdapter(adapter) {
  return isPlainObject(adapter) && typeof adapter.fetchRun === "function";
}

/**
 * resolveGithubCiAdapter(input) -- same resolution pattern as
 * stages/1a/git-adapter.js#resolveGitAdapter(): an already-valid injected
 * adapter wins; otherwise a real one is built from trusted config; otherwise
 * resolution fails and the caller reports INCOMPLETE (never fabricates evidence).
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
 * The single entry point every later WP uses. Resolves the adapter (injected
 * or real), calls it, and validates the result -- never returns an
 * unvalidated shape to a caller.
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
    const reason = isPlainObject(fetched) && typeof fetched.reason === "string" ? fetched.reason : "SOURCE_UNREACHABLE";
    return { ok: false, reason };
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

module.exports = { isGithubCiAdapter, resolveGithubCiAdapter, validateRunEvidence, fetchValidatedRun };
