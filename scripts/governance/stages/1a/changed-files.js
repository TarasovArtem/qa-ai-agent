/**
 * GOV-AUTO-1 Wave 1 / 1A -- canonical changed-file set (design sections 6, 14).
 *
 * 1A is the single owner of "which files changed". The set is computed once, here,
 * from Git (NUL-delimited, no rename detection, so a rename contributes its old and
 * new path) for the exact range 1A established, and every consumer (1B now; 1E,
 * 1F and GOV-VERIFY-1 later) reads it through this function's frozen result and
 * never runs its own diff.
 *
 * Path identity is Git's: byte-exact and case-sensitive, no case folding, no
 * Unicode normalization, bytewise ordering. A non-canonical path (absolute, `..`,
 * leading `./`, backslash, control character, invalid UTF-8) is a
 * CONFIGURATION_ERROR: it is rejected, never repaired.
 *
 * For a PR_REVIEW run the Git set is compared with the platform changed-file list
 * as SETS, and only after that list is proven complete (pagination exhausted,
 * received count equal to the reported count, documented limit not reached, no
 * duplicate path). Equal counts with different paths are never agreement, and a
 * known-partial list is never compared and passed.
 */

"use strict";

const { REASON, STATUS, RANGE_MODES, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { validateRepoRelativePath, compareBytewise } = require("../../safety/repo-path");
const { resolveGitAdapter } = require("./git-adapter");
const { createRecordFactory, isValidSubject, sample } = require("../common");

const MAX_CHANGED_FILES = 100_000;

function result(subject, files, complete, emptyDiffConfirmed, records) {
  return deepFreeze({ subject, files, complete, emptyDiffConfirmed, records });
}

/** Normalize a list of candidate paths; returns { paths (sorted, unique), invalid }. */
function normalizePaths(candidates) {
  let invalid = 0;
  const seen = new Set();
  for (const path of candidates) {
    if (!validateRepoRelativePath(path).ok) invalid += 1;
    else seen.add(path);
  }
  return { paths: [...seen].sort(compareBytewise), invalid };
}

/** Prove the platform list complete, then return its normalized set (or the failure). */
function evaluatePlatformList(platformFiles) {
  const fail = (status, reasonCode, detail, observed = {}) => ({ ok: false, status, reasonCode, detail, observed });
  if (!platformFiles.paginationExhausted) return fail(STATUS.INCOMPLETE, REASON.PLATFORM_FILE_LIST_INCOMPLETE, "the platform changed-file list has unresolved pagination", { received: platformFiles.entries.length });
  if (platformFiles.entries.length !== platformFiles.reportedCount) return fail(STATUS.INCOMPLETE, REASON.PLATFORM_FILE_LIST_INCOMPLETE, "the number of received paths differs from the platform-reported changed-file count", { received: platformFiles.entries.length, reported: platformFiles.reportedCount });
  if (platformFiles.reportedCount >= platformFiles.listLimit) return fail(STATUS.INCOMPLETE, REASON.PLATFORM_FILE_LIST_INCOMPLETE, "the platform's documented changed-file list limit has been reached", { reported: platformFiles.reportedCount, listLimit: platformFiles.listLimit });
  const seen = new Set();
  const duplicates = [];
  for (const entry of platformFiles.entries) {
    if (seen.has(entry.path)) duplicates.push(entry.path);
    seen.add(entry.path);
  }
  if (duplicates.length > 0) return fail(STATUS.INCOMPLETE, REASON.PLATFORM_FILE_LIST_ANOMALY, "a path appears more than once in the platform list", { duplicates: sample(duplicates) });
  const candidates = [];
  for (const entry of platformFiles.entries) {
    candidates.push(entry.path);
    if (entry.previousPath !== null) candidates.push(entry.previousPath); // a rename contributes both paths
  }
  const normalized = normalizePaths(candidates);
  if (normalized.invalid > 0) return fail(STATUS.CONFIGURATION_ERROR, REASON.CHANGED_PATH_INVALID, "the platform list contains a non-canonical path", { invalidCount: normalized.invalid });
  return { ok: true, paths: normalized.paths };
}

/**
 * getChangedFiles({ subject, git | { repositoryRoot, gitExecutable }, platformFiles,
 *                   invocationTrust, from?, to?, mode? })
 * `subject` is the run identity established by getGitIdentity(); `from`, `to` and
 * `mode` are optional assertions that must equal subject.range (the mode is an
 * explicit input, never hard-coded to base..head).
 */
async function getChangedFiles(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) {
    return deepFreeze({ subject: null, files: [], complete: false, emptyDiffConfirmed: false, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.TRUSTED_CONTEXT_INVALID, detail: "a valid subject from getGitIdentity() is required" } });
  }
  const subject = input.subject;
  const out = createRecordFactory(subject, "1A");
  const { add, notApplicable } = out;
  const finish = (files, complete, emptyDiffConfirmed) => result(subject, files, complete, emptyDiffConfirmed, out.records);

  const mode = input.mode === undefined ? subject.range.mode : input.mode;
  const from = input.from === undefined ? subject.range.from : input.from;
  const to = input.to === undefined ? subject.range.to : input.to;
  if (!RANGE_MODES.includes(mode) || mode !== subject.range.mode || from !== subject.range.from || to !== subject.range.to) {
    add("1A.DIFF.CHANGED_FILES", STATUS.CONFIGURATION_ERROR, REASON.TRUSTED_CONTEXT_INVALID, "mode, from and to must equal the subject range", {});
    return finish([], false, false);
  }
  const adapter = resolveGitAdapter(input);
  if (!adapter.ok) {
    add("1A.DIFF.CHANGED_FILES", STATUS.INCOMPLETE, REASON.DIFF_COMPUTATION_FAILED, "no usable Git adapter was supplied", {});
    return finish([], false, false);
  }

  const listed = await adapter.git.diffNames(from, to);
  if (!listed.ok) {
    add("1A.DIFF.CHANGED_FILES", STATUS.INCOMPLETE, REASON.DIFF_COMPUTATION_FAILED, "the changed-file listing could not be computed from Git", { mode });
    return finish([], false, false);
  }
  const normalized = normalizePaths(listed.value.paths);
  if (listed.value.invalid > 0 || normalized.invalid > 0) {
    add("1A.DIFF.CHANGED_FILES", STATUS.CONFIGURATION_ERROR, REASON.CHANGED_PATH_INVALID, "a changed path is not canonical (non-UTF-8, absolute, `..`, `./`, backslash or control character)", { invalidCount: listed.value.invalid + normalized.invalid });
    return finish([], false, false);
  }
  if (normalized.paths.length > MAX_CHANGED_FILES) {
    add("1A.DIFF.CHANGED_FILES", STATUS.INCOMPLETE, REASON.DIFF_COMPUTATION_FAILED, "the changed-file set exceeds the supported bound", { count: normalized.paths.length });
    return finish([], false, false);
  }
  const files = normalized.paths;
  add("1A.DIFF.CHANGED_FILES", STATUS.PASS, REASON.OK, "changed-file set computed from Git", { count: files.length, mode, from, to });

  // Platform agreement (PR_REVIEW only).
  if (mode === "POST_MERGE") {
    notApplicable("1A.DIFF.PLATFORM_AGREEMENT", "post-merge identity compares no platform changed-file list");
    return finish(files, true, false);
  }
  const trust = input.invocationTrust === "OPERATOR_SUPPLIED" ? "OPERATOR_SUPPLIED" : "PLATFORM_AUTHENTICATED";
  const platform = input.platformFiles === undefined ? null : input.platformFiles;
  if (platform === null) {
    if (trust === "OPERATOR_SUPPLIED" && files.length > 0) {
      notApplicable("1A.DIFF.PLATFORM_AGREEMENT", "an operator invocation has no platform-authenticated changed-file list");
      return finish(files, true, false);
    }
    add("1A.DIFF.PLATFORM_AGREEMENT", STATUS.INCOMPLETE, files.length === 0 ? REASON.DIFF_EMPTY_UNEXPECTED : REASON.PLATFORM_FILE_LIST_INCOMPLETE, files.length === 0 ? "an empty diff cannot be confirmed without the platform list" : "the platform did not supply a changed-file list", { gitCount: files.length });
    return finish(files, false, false);
  }
  if (!isPlainObject(platform) || !Array.isArray(platform.entries)) {
    add("1A.DIFF.PLATFORM_AGREEMENT", STATUS.INCOMPLETE, REASON.PLATFORM_FILE_LIST_ANOMALY, "the platform changed-file list has an unexpected shape", {});
    return finish(files, false, false);
  }
  const proven = evaluatePlatformList(platform);
  if (!proven.ok) {
    add("1A.DIFF.PLATFORM_AGREEMENT", proven.status, proven.reasonCode, proven.detail, proven.observed);
    return finish(files, false, false);
  }
  if (files.length === 0 && proven.paths.length === 0) {
    add("1A.DIFF.PLATFORM_AGREEMENT", STATUS.PASS, REASON.EMPTY_DIFF_CONFIRMED, "the Git diff and the complete platform list are both empty", { gitCount: 0, platformCount: 0 });
    return finish(files, true, true);
  }
  if (files.length === 0) {
    add("1A.DIFF.PLATFORM_AGREEMENT", STATUS.INCOMPLETE, REASON.DIFF_EMPTY_UNEXPECTED, "the Git diff is empty but the complete platform list is not", { gitCount: 0, platformCount: proven.paths.length });
    return finish(files, false, false);
  }
  const git = new Set(files);
  const plat = new Set(proven.paths);
  const onlyGit = files.filter((p) => !plat.has(p));
  const onlyPlatform = proven.paths.filter((p) => !git.has(p));
  if (onlyGit.length === 0 && onlyPlatform.length === 0) {
    add("1A.DIFF.PLATFORM_AGREEMENT", STATUS.PASS, REASON.OK, "the Git changed-path set equals the complete platform set", { count: files.length });
    return finish(files, true, false);
  }
  add("1A.DIFF.PLATFORM_AGREEMENT", STATUS.INCOMPLETE, REASON.DIFF_PATHS_MISMATCH, "the Git and platform changed-path SETS differ (counts are never agreement)", { gitCount: files.length, platformCount: proven.paths.length, onlyInGit: sample(onlyGit), onlyInPlatform: sample(onlyPlatform), onlyInGitTotal: onlyGit.length, onlyInPlatformTotal: onlyPlatform.length });
  return finish(files, false, false);
}

module.exports = { getChangedFiles };
