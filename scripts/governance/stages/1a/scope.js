/**
 * GOV-AUTO-1 Wave 1 / 1A -- diff scope (design sections 6, 14).
 *
 * checkScope() applies the EFFECTIVE base policy to the canonical changed-file set:
 *   - a changed path matching a forbidden domain is FAIL;
 *   - a changed path outside every allowed domain is FAIL (nothing unmatched is
 *     silently ignored);
 *   - a changed protected governance/framework path is HUMAN_REVIEW_REQUIRED
 *     (GOVERNANCE_CONFIG): a human must review a change to the governance itself,
 *     and that review happens under the OLD configuration;
 *   - a head proposal may TIGHTEN (a subset of a base allowed domain) and is then
 *     applied as an intersection; a proposal that would WIDEN scope is a loosening
 *     proposal: it is not applied, the base scope stays in force and the proposal
 *     is reported HUMAN_REVIEW_REQUIRED. A head can never widen its own scope.
 * The built-in protected paths are always in force and can only be added to.
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { parsePathPattern, matchPathPattern, patternCovers } = require("../../safety/path-patterns");
const { validateRepoRelativePath } = require("../../safety/repo-path");
const { createRecordFactory, isValidSubject, sameSubject, sample } = require("../common");
const { BUILTIN_PROTECTED_PATHS, validateBasePolicy, resolveFrameworkMetadata } = require("./policy");

/** Metadata deciding schema/capability support: the caller-supplied target-tip metadata when valid. */
const metadataOf = (input) => {
  const r = resolveFrameworkMetadata(input.targetFrameworkMetadata);
  return r.ok ? r.metadata : { supportedCapabilities: [], supportedSchemaVersions: { minSupported: 1, maxSupported: 0 } };
};

const MAX_PROPOSED = 64;

function compile(patterns) {
  return patterns.map((p) => parsePathPattern(p).pattern);
}

function invalidInput(detail) {
  return deepFreeze({ subject: null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.CHANGED_FILES_INPUT_INVALID, detail } });
}

/**
 * checkScope({ subject, changedFiles, policy, headProposal? })
 *   changedFiles  the frozen result of getChangedFiles() for the same subject
 *   policy        the effective policy from getGitIdentity() (a validated base policy
 *                 object, or the built-in minimum); it is re-validated here
 *   headProposal  optional { allowedPathDomains: [patterns] } proposed by the head
 */
function checkScope(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput("a valid subject is required");
  const subject = input.subject;
  const changed = input.changedFiles;
  if (!isPlainObject(changed) || !Array.isArray(changed.files) || !sameSubject(changed.subject, subject)) return invalidInput("changedFiles must be the getChangedFiles() result for the same subject");
  const out = createRecordFactory(subject, "1A");
  const { add, notApplicable } = out;

  if (changed.complete !== true) {
    add("1A.SCOPE.ALLOWED", STATUS.INCOMPLETE, REASON.DIFF_COMPUTATION_FAILED, "scope cannot be evaluated: the changed-file set is not complete", {});
    return deepFreeze({ subject, records: out.records, outcome: null });
  }
  const files = changed.files;
  if (!files.every((p) => validateRepoRelativePath(p).ok)) return invalidInput("changedFiles contains a non-canonical path");

  // Effective policy: a usable validated policy, or the built-in minimum (no allowed domain).
  const supplied = input.policy;
  let policy = null;
  if (isPlainObject(supplied)) {
    const isBuiltin = supplied.scope && Array.isArray(supplied.scope.allowedPathDomains) && supplied.scope.allowedPathDomains.length === 0;
    if (isBuiltin) {
      const forbiddenList = Array.isArray(supplied.scope.forbiddenPathDomains) ? supplied.scope.forbiddenPathDomains : [];
      const protectedList = Array.isArray(supplied.scope.protectedPaths) ? supplied.scope.protectedPaths : [];
      const wellFormed = [...forbiddenList, ...protectedList].every((p) => typeof p === "string" && parsePathPattern(p).ok);
      if (wellFormed) policy = { scope: { allowedPathDomains: [], forbiddenPathDomains: [...forbiddenList], protectedPaths: [...new Set([...BUILTIN_PROTECTED_PATHS, ...protectedList])] } };
    } else {
      const validated = validateBasePolicy(supplied, metadataOf(input));
      if (validated.ok) policy = { scope: validated.policy.scope };
    }
  }
  if (policy === null) {
    add("1A.SCOPE.ALLOWED", STATUS.INCOMPLETE, REASON.SCOPE_POLICY_UNAVAILABLE, "no usable effective policy: scope cannot be evaluated", {});
    return deepFreeze({ subject, records: out.records, outcome: null });
  }
  const scope = policy.scope;
  const protectedPatterns = compile([...new Set([...BUILTIN_PROTECTED_PATHS, ...scope.protectedPaths])]);
  const forbidden = compile(scope.forbiddenPathDomains);
  let allowed = compile(scope.allowedPathDomains);

  // Head proposal: tighten (subset of a base domain) is applied; loosen is not.
  const proposal = input.headProposal;
  if (proposal === undefined || proposal === null) notApplicable("1A.SCOPE.PROPOSAL", "the head proposes no scope change");
  else if (!isPlainObject(proposal) || !Array.isArray(proposal.allowedPathDomains) || proposal.allowedPathDomains.length > MAX_PROPOSED) {
    add("1A.SCOPE.PROPOSAL", STATUS.CONFIGURATION_ERROR, REASON.SCOPE_LOOSENING_PROPOSED, "the head scope proposal is malformed", {});
  } else {
    const parsed = proposal.allowedPathDomains.map((p) => parsePathPattern(p));
    const malformed = parsed.some((p) => !p.ok);
    const proposed = parsed.filter((p) => p.ok).map((p) => p.pattern);
    const loosening = proposed.filter((p) => allowed.length > 0 && !allowed.some((b) => patternCovers(b, p)));
    if (malformed) add("1A.SCOPE.PROPOSAL", STATUS.CONFIGURATION_ERROR, REASON.SCOPE_LOOSENING_PROPOSED, "the head scope proposal contains an invalid path pattern", {});
    else if (allowed.length === 0 || loosening.length > 0) add("1A.SCOPE.PROPOSAL", STATUS.HUMAN_REVIEW_REQUIRED, REASON.SCOPE_LOOSENING_PROPOSED, "the head proposes a scope wider than the base domains: not applied, the base scope stays in force", { notApplied: sample(loosening.map((p) => p.text).concat(allowed.length === 0 ? proposed.map((p) => p.text) : [])) });
    else {
      allowed = proposed; // every proposed pattern is provably inside a base domain: tightening
      add("1A.SCOPE.PROPOSAL", STATUS.PASS, REASON.OK, "the head proposal only narrows the base scope and is applied as an intersection", { applied: proposed.map((p) => p.text) });
    }
  }

  const forbiddenHits = files.filter((f) => forbidden.some((p) => matchPathPattern(p, f)));
  if (forbiddenHits.length > 0) add("1A.SCOPE.FORBIDDEN", STATUS.FAIL, REASON.SCOPE_FORBIDDEN_PATH, "a changed path matches a forbidden path domain", { count: forbiddenHits.length, paths: sample(forbiddenHits) });
  else add("1A.SCOPE.FORBIDDEN", STATUS.PASS, REASON.OK, "no changed path matches a forbidden path domain", { checked: files.length });

  if (allowed.length === 0) add("1A.SCOPE.ALLOWED", files.length === 0 ? STATUS.PASS : STATUS.INCOMPLETE, files.length === 0 ? REASON.OK : REASON.SCOPE_POLICY_UNAVAILABLE, files.length === 0 ? "no changed path to check" : "the effective policy defines no allowed path domain (built-in minimum): scope cannot be judged", { checked: files.length });
  else {
    const outside = files.filter((f) => !allowed.some((p) => matchPathPattern(p, f)));
    if (outside.length > 0) add("1A.SCOPE.ALLOWED", STATUS.FAIL, REASON.SCOPE_OUTSIDE_ALLOWED, "a changed path is outside every allowed path domain", { count: outside.length, paths: sample(outside) });
    else add("1A.SCOPE.ALLOWED", STATUS.PASS, REASON.OK, "every changed path is inside an allowed path domain", { checked: files.length });
  }

  const protectedHits = files.filter((f) => protectedPatterns.some((p) => matchPathPattern(p, f)));
  if (protectedHits.length > 0) add("1A.SCOPE.PROTECTED", STATUS.HUMAN_REVIEW_REQUIRED, REASON.GOVERNANCE_CONFIG, "a protected governance/framework path changed: human review under the base configuration is required", { count: protectedHits.length, paths: sample(protectedHits) });
  else add("1A.SCOPE.PROTECTED", STATUS.PASS, REASON.OK, "no protected governance/framework path changed", { checked: files.length });

  return deepFreeze({ subject, records: out.records, outcome: null });
}

module.exports = { checkScope };
