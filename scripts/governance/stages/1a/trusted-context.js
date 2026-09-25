/**
 * GOV-AUTO-1 Wave 1 / 1A -- trusted invocation context (design section 14).
 *
 * The context is DATA produced by a platform/provider adapter (or supplied by an
 * operator in manual mode). This module only validates its shape; it never reads
 * the repository, the environment or a manifest, and it never falls back to a
 * head-controlled value: a field that is missing or malformed makes the whole
 * context invalid (the caller reports INCOMPLETE). Nothing here is fetched.
 *
 * Fields and their only authoritative sources:
 *   mode, eventType            platform event metadata
 *   repositoryId, provider     platform-authenticated repository identity
 *   targetRefName              platform-authenticated PR metadata (PR_REVIEW) or
 *                              platform push metadata (POST_MERGE)
 *   defaultBranchName          platform-authenticated repository metadata
 *   headSha                    PR head from the provider (PR_REVIEW) or the merge
 *                              commit from the provider/push `after` (POST_MERGE)
 *   suppliedTargetSha          an ASSERTION only; the target tip is resolved by 1A
 *   mergedPrHeadSha            POST_MERGE only: the head recorded by the platform
 *   workflow                   platform-authenticated run metadata (path + SHA)
 *   platformFiles              platform changed-file list with completeness data
 */

"use strict";

const { RANGE_MODES, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { validateRepoRelativePath } = require("../../safety/repo-path");

const SHA40 = /^[0-9a-f]{40}$/;
const PROVIDER = /^[a-z][a-z0-9-]{1,31}$/;
const REPOSITORY_ID = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const TRUST = ["PLATFORM_AUTHENTICATED", "OPERATOR_SUPPLIED"];
const CONTEXT_KEYS = [
  "mode", "invocationTrust", "provider", "repositoryId", "eventType", "targetRefName", "defaultBranchName",
  "headSha", "suppliedTargetSha", "mergedPrHeadSha", "workflow", "platformFiles",
];
const MAX_PLATFORM_ENTRIES = 5000;
// eslint-disable-next-line no-control-regex
const BRANCH_FORBIDDEN = /[\u0000- \u007f~^:?*[\\]/;

/**
 * Exact branch/ref name as a platform reports it: 1..255 chars, no whitespace,
 * control, wildcard or Git-special characters, no `..`, `//`, `@{`, leading `-`
 * or `/`, no trailing `/`, `.` or `.lock`. Used for the target ref, the default
 * branch and every `protectedTargetRefs` entry.
 */
function isValidBranchName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (BRANCH_FORBIDDEN.test(name) || name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) return false;
  return name !== "@";
}

function validateWorkflow(workflow, problems) {
  if (workflow === null) return null;
  if (!isPlainObject(workflow) || Object.keys(workflow).sort().join(",") !== "path,sha") {
    problems.push("workflow must be null or { path, sha }");
    return null;
  }
  if (!validateRepoRelativePath(workflow.path).ok) problems.push("workflow.path is not a canonical repository path");
  if (typeof workflow.sha !== "string" || !SHA40.test(workflow.sha)) problems.push("workflow.sha must be a full lowercase 40-hex SHA");
  return { path: workflow.path, sha: workflow.sha };
}

function validatePlatformFiles(files, problems) {
  if (files === null) return null;
  const keys = isPlainObject(files) ? Object.keys(files).sort().join(",") : "";
  if (keys !== "entries,listLimit,paginationExhausted,reportedCount") {
    problems.push("platformFiles must be null or { entries, reportedCount, paginationExhausted, listLimit }");
    return null;
  }
  const okInt = (n, min) => Number.isSafeInteger(n) && n >= min && n <= 1_000_000;
  if (!okInt(files.reportedCount, 0)) problems.push("platformFiles.reportedCount must be a non-negative integer");
  if (!okInt(files.listLimit, 1)) problems.push("platformFiles.listLimit must be a positive integer");
  if (typeof files.paginationExhausted !== "boolean") problems.push("platformFiles.paginationExhausted must be a boolean");
  if (!Array.isArray(files.entries) || files.entries.length > MAX_PLATFORM_ENTRIES) {
    problems.push("platformFiles.entries must be a bounded array");
    return null;
  }
  const entries = [];
  for (const entry of files.entries) {
    if (!isPlainObject(entry) || Object.keys(entry).sort().join(",") !== "path,previousPath" ||
        typeof entry.path !== "string" || (entry.previousPath !== null && typeof entry.previousPath !== "string")) {
      problems.push("each platformFiles entry must be { path, previousPath }");
      return null;
    }
    entries.push({ path: entry.path, previousPath: entry.previousPath });
  }
  return { entries, reportedCount: files.reportedCount, paginationExhausted: files.paginationExhausted, listLimit: files.listLimit };
}

/**
 * Validate a raw trusted invocation context. Returns a frozen
 * { ok, context, problems }; problems are fixed labels (no caller text).
 */
function validateTrustedContext(raw) {
  const problems = [];
  if (!isPlainObject(raw)) return deepFreeze({ ok: false, context: null, problems: ["context must be an object"] });
  for (const key of Object.keys(raw)) if (!CONTEXT_KEYS.includes(key)) problems.push("unknown context field");
  const need = (key) => {
    if (!Object.hasOwn(raw, key)) problems.push(`missing ${key}`);
    return raw[key];
  };
  const mode = need("mode");
  if (typeof mode !== "string" || !RANGE_MODES.includes(mode)) problems.push("invalid mode");
  const trust = need("invocationTrust");
  if (typeof trust !== "string" || !TRUST.includes(trust)) problems.push("invalid invocationTrust");
  if (typeof need("provider") !== "string" || !PROVIDER.test(raw.provider)) problems.push("invalid provider");
  if (typeof need("repositoryId") !== "string" || !REPOSITORY_ID.test(raw.repositoryId)) problems.push("invalid repositoryId");
  const eventType = need("eventType");
  const expectedEvent = trust === "OPERATOR_SUPPLIED" ? "manual" : mode === "PR_REVIEW" ? "pull_request" : "push";
  if (eventType !== expectedEvent) problems.push("eventType does not match mode and invocationTrust");
  if (!isValidBranchName(need("targetRefName"))) problems.push("invalid targetRefName");
  if (!isValidBranchName(need("defaultBranchName"))) problems.push("invalid defaultBranchName");
  if (typeof need("headSha") !== "string" || !SHA40.test(raw.headSha)) problems.push("headSha must be a full lowercase 40-hex SHA");
  const supplied = Object.hasOwn(raw, "suppliedTargetSha") ? raw.suppliedTargetSha : null;
  if (supplied !== null && (typeof supplied !== "string" || !SHA40.test(supplied))) problems.push("suppliedTargetSha must be null or a full lowercase 40-hex SHA");
  const mergedHead = Object.hasOwn(raw, "mergedPrHeadSha") ? raw.mergedPrHeadSha : null;
  if (mode === "POST_MERGE") {
    if (typeof mergedHead !== "string" || !SHA40.test(mergedHead)) problems.push("POST_MERGE requires mergedPrHeadSha (full lowercase 40-hex SHA)");
  } else if (mergedHead !== null) problems.push("mergedPrHeadSha is only valid for POST_MERGE");
  const workflow = validateWorkflow(Object.hasOwn(raw, "workflow") ? raw.workflow : null, problems);
  const platformFiles = validatePlatformFiles(Object.hasOwn(raw, "platformFiles") ? raw.platformFiles : null, problems);
  if (mode === "POST_MERGE" && raw.platformFiles) problems.push("platformFiles is only valid for PR_REVIEW");

  if (problems.length > 0) return deepFreeze({ ok: false, context: null, problems: [...new Set(problems)].slice(0, 20) });
  return deepFreeze({
    ok: true,
    problems: [],
    context: {
      mode,
      invocationTrust: trust,
      provider: raw.provider,
      repositoryId: raw.repositoryId,
      eventType,
      targetRefName: raw.targetRefName,
      defaultBranchName: raw.defaultBranchName,
      headSha: raw.headSha,
      suppliedTargetSha: supplied,
      mergedPrHeadSha: mergedHead,
      workflow,
      platformFiles,
    },
  });
}

module.exports = { validateTrustedContext, isValidBranchName };
