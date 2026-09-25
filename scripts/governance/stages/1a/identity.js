/**
 * GOV-AUTO-1 Wave 1 / 1A -- Git identity and trusted invocation (design section 14).
 *
 * getGitIdentity() is the ONLY producer of the run subject (head, tree, base,
 * range). It consumes a validated trusted invocation context and Git (behind the
 * narrow adapter); it takes nothing from the manifest, the PR body, `origin`, a
 * flag or an environment variable, and it never lets the reviewed head select
 * the base, the target, the policy or the invoking workflow.
 *
 * Result shape (frozen plain data, no live handles):
 *   established   true when a subject exists. When false, `outcome` carries the
 *                 fail-closed run-level status and there are no records: a record
 *                 must be bound to a full { head, tree, base, range } subject
 *                 (Wave 0 contract) and none exists to bind to, so fabricating
 *                 one would be worse than reporting nothing.
 *   identity      the established facts (branch/ref context, head, tree, parents,
 *                 base, target tip, governance-root tip, mode).
 *   subject       the exact identity every later record is bound to.
 *   policy        the effective base policy for this run and where it came from.
 *   records       canonical 1A result records (Wave 0 validateResultRecord-valid).
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { canonicalJson } = require("../../kernel/results");
const { safe, createRecordFactory } = require("../common");
const { validateTrustedContext } = require("./trusted-context");
const { resolveGitAdapter } = require("./git-adapter");
const { BASE_POLICY_PATH, BUILTIN_MINIMUM_POLICY, gateManifestPath, parseBasePolicyBytes, policyDigest } = require("./policy");

const SHA40 = /^[0-9a-f]{40}$/;
const MAX_POLICY_BYTES = 256 * 1024;

const outcome = (status, reasonCode, detail) => deepFreeze({ established: false, mode: null, identity: null, subject: null, policy: null, records: [], outcome: { status, reasonCode, detail: safe(detail) } });

/** Read and classify the base policy at a commit. */
async function readPolicyAt(git, commit) {
  const blob = await git.readBlob(commit, BASE_POLICY_PATH, MAX_POLICY_BYTES);
  if (!blob.ok) return { state: "unavailable", detail: blob.detail };
  const kind = blob.value.kind;
  if (kind === "absent") return { state: "absent" };
  if (kind !== "blob") return { state: "invalid", status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.POLICY_INVALID, detail: "the policy path is not a regular file" };
  const parsed = parseBasePolicyBytes(blob.value.bytes);
  if (!parsed.ok) return { state: "invalid", status: parsed.status, reasonCode: parsed.reasonCode, detail: parsed.problems.join("; ") };
  return { state: "valid", policy: parsed.policy, unsupportedCapabilities: parsed.unsupportedCapabilities, digest: policyDigest(parsed.policy) };
}

function policyRecords(out, { rootTip, mode, basePolicyState, rootState, defaultBranchName }) {
  const { add, notApplicable } = out;
  // Governance root policy.
  if (rootState.state === "valid") add("1A.POLICY.ROOT", STATUS.PASS, REASON.OK, "governance-root policy validated", { rootTip, rootPolicyDigest: rootState.digest });
  else if (rootState.state === "absent") notApplicable("1A.POLICY.ROOT", "no governance-root policy exists (bootstrap): the built-in minimum policy applies");
  else if (rootState.state === "invalid") add("1A.POLICY.ROOT", rootState.status, rootState.reasonCode, `governance-root policy is unusable: ${rootState.detail}`, { rootTip });
  else add("1A.POLICY.ROOT", STATUS.INCOMPLETE, REASON.POLICY_INVALID, "the governance-root policy could not be read", { rootTip });

  // Base trust anchor.
  const bothAbsent = rootState.state === "absent" && basePolicyState.state === "absent";
  if (bothAbsent) add("1A.POLICY.ANCHOR", STATUS.HUMAN_REVIEW_REQUIRED, REASON.NO_BASE_TRUST_ANCHOR, "no policy at the governance root or the base: the built-in minimum applies and initial trust is established by human review", { builtinMinimum: true, defaultBranchName });
  else add("1A.POLICY.ANCHOR", STATUS.PASS, REASON.OK, "a policy anchor exists", { rootPolicy: rootState.state, basePolicy: basePolicyState.state });

  // Policy monotonicity: rebase required (PR_REVIEW only).
  if (mode !== "PR_REVIEW") notApplicable("1A.POLICY.CURRENT", "POLICY_OUTDATED does not apply post-merge: the root policy may legitimately have advanced");
  else if (rootState.state === "invalid" || rootState.state === "unavailable") add("1A.POLICY.CURRENT", STATUS.INCOMPLETE, REASON.POLICY_OUTDATED, "policy currency cannot be established without a usable governance-root policy", {});
  else if (bothAbsent) notApplicable("1A.POLICY.CURRENT", "no policy at the governance root or the base");
  else {
    const rootCanon = rootState.state === "valid" ? canonicalJson(rootState.policy) : null;
    const baseCanon = basePolicyState.state === "valid" ? canonicalJson(basePolicyState.policy) : null;
    if (rootCanon !== null && rootCanon === baseCanon) add("1A.POLICY.CURRENT", STATUS.PASS, REASON.OK, "the policy at the base equals the governance-root policy", { rootPolicyDigest: rootState.digest });
    else add("1A.POLICY.CURRENT", STATUS.INCOMPLETE, REASON.POLICY_OUTDATED, "the protected policy at the base differs from the governance-root policy: bring the branch up to date", { rootPolicyDigest: rootState.state === "valid" ? rootState.digest : null, basePolicyDigest: basePolicyState.state === "valid" ? basePolicyState.digest : null });
  }
}

async function readGate(git, gate, baseCommit, headCommit, out, baseLabel) {
  const { add, notApplicable } = out;
  if (gate === undefined || gate === null) return notApplicable("1A.POLICY.GATE_ANCHOR", "no gate was declared for this run");
  const path = isPlainObject(gate) ? gateManifestPath(gate.gateId) : null;
  if (path === null) return add("1A.POLICY.GATE_ANCHOR", STATUS.CONFIGURATION_ERROR, REASON.MANIFEST_TYPE_INVALID, "invalid gateId", {});
  const [atBase, atHead] = [await git.treeEntry(baseCommit, path), await git.treeEntry(headCommit, path)];
  if (!atBase.ok || !atHead.ok) return add("1A.POLICY.GATE_ANCHOR", STATUS.INCOMPLETE, REASON.NO_BASE_GATE_ANCHOR, "the gate manifest could not be read", { path });
  const inBase = !atBase.value.absent;
  const inHead = !atHead.value.absent;
  if (inBase && inHead) return add("1A.POLICY.GATE_ANCHOR", STATUS.PASS, REASON.OK, `the gate manifest exists at the ${baseLabel} and at the head`, { path });
  if (!inBase && inHead) return add("1A.POLICY.GATE_ANCHOR", STATUS.HUMAN_REVIEW_REQUIRED, REASON.NO_BASE_GATE_ANCHOR, "the head gate manifest has no base anchor: it is a proposal and cannot self-certify", { path });
  if (inBase && !inHead) return add("1A.POLICY.GATE_ANCHOR", STATUS.HUMAN_REVIEW_REQUIRED, REASON.GOVERNANCE_CONFIG, "the gate manifest exists at the base but not at the head", { path });
  if (gate.requiresManifest === true) return add("1A.POLICY.GATE_ANCHOR", STATUS.CONFIGURATION_ERROR, REASON.GATE_MANIFEST_MISSING, "the gate requires a manifest and none exists at the head", { path });
  return notApplicable("1A.POLICY.GATE_ANCHOR", "the gate declares no manifest and none exists");
}

async function workflowAnchor(git, context, base, out) {
  const { add, notApplicable } = out;
  if (context.invocationTrust === "OPERATOR_SUPPLIED") return notApplicable("1A.IDENTITY.WORKFLOW_ANCHOR", "an operator invocation has no platform-authenticated workflow");
  if (context.workflow === null) return add("1A.IDENTITY.WORKFLOW_ANCHOR", STATUS.INCOMPLETE, REASON.WORKFLOW_IDENTITY_UNAVAILABLE, "the platform did not supply the invoking workflow identity", {});
  const { path, sha } = context.workflow;
  const [atRun, atBase] = [await git.treeEntry(sha, path), await git.treeEntry(base, path)];
  if (!atRun.ok || !atBase.ok || atRun.value.absent) return add("1A.IDENTITY.WORKFLOW_ANCHOR", STATUS.INCOMPLETE, REASON.WORKFLOW_IDENTITY_UNAVAILABLE, "the invoking workflow blob could not be established", { path });
  const runBlob = atRun.value.sha;
  const baseBlob = atBase.value.absent ? null : atBase.value.sha;
  if (runBlob === baseBlob) return add("1A.IDENTITY.WORKFLOW_ANCHOR", STATUS.PASS, REASON.OK, "the invoking workflow blob equals the blob at the base", { path, blob: runBlob }, { blob: baseBlob });
  return add("1A.IDENTITY.WORKFLOW_ANCHOR", STATUS.HUMAN_REVIEW_REQUIRED, REASON.INVOCATION_NOT_ANCHORED, "the invoking workflow differs from the base version (or is new)", { path, runBlob, baseBlob });
}

async function getGitIdentity(input) {
  if (!isPlainObject(input)) return outcome(STATUS.INCOMPLETE, REASON.TRUSTED_CONTEXT_INVALID, "input must be an object");
  const checked = validateTrustedContext(input.trustedContext);
  if (!checked.ok) return outcome(STATUS.INCOMPLETE, REASON.TRUSTED_CONTEXT_INVALID, `trusted invocation context is invalid: ${checked.problems.join("; ")}`);
  const context = checked.context;
  const adapter = resolveGitAdapter(input);
  if (!adapter.ok) return outcome(STATUS.INCOMPLETE, REASON.TRUSTED_CONTEXT_INVALID, "no usable Git adapter was supplied");
  const git = adapter.git;

  const local = await git.localHead();
  if (!local.ok) return outcome(STATUS.INCOMPLETE, REASON.HEAD_UNAVAILABLE, "the local HEAD could not be resolved");
  if (local.value !== context.headSha) return outcome(STATUS.INCOMPLETE, REASON.HEAD_MISMATCH, "local HEAD does not equal the platform-authenticated head");
  const head = await git.commitInfo(context.headSha);
  if (!head.ok) return outcome(STATUS.INCOMPLETE, REASON.HEAD_UNAVAILABLE, "the head commit is not available");

  const tipResult = await git.resolveTargetTip(context.provider, context.repositoryId, context.targetRefName);
  if (!tipResult.ok) return outcome(STATUS.INCOMPLETE, REASON.TARGET_TIP_UNAVAILABLE, "the target tip could not be resolved independently");
  const targetTip = tipResult.value;
  let rootTip = targetTip;
  if (context.defaultBranchName !== context.targetRefName) {
    const rootResult = await git.resolveTargetTip(context.provider, context.repositoryId, context.defaultBranchName);
    if (!rootResult.ok) return outcome(STATUS.INCOMPLETE, REASON.DEFAULT_BRANCH_UNAVAILABLE, "the governance root (default branch tip) could not be resolved");
    rootTip = rootResult.value;
  }

  // Establish base / range identity per mode.
  let base;
  let range;
  const parents = head.value.parents;
  if (context.mode === "PR_REVIEW") {
    const bases = await git.mergeBases(context.headSha, targetTip);
    if (!bases.ok || bases.value.length !== 1) return outcome(STATUS.INCOMPLETE, REASON.BASE_NOT_ESTABLISHED, "there is not exactly one merge base of the head and the resolved target tip");
    base = bases.value[0];
    range = { mode: "PR_REVIEW", from: base, to: context.headSha };
  } else {
    if (parents.length === 0) return outcome(STATUS.FAIL, REASON.TOPOLOGY_UNEXPECTED, "the merge commit has no parent");
    base = parents[0];
    range = { mode: "POST_MERGE", from: base, to: context.headSha };
  }
  const subject = { head: context.headSha, tree: head.value.tree, base, range };
  const out = createRecordFactory(subject, "1A");
  const { add, notApplicable } = out;

  // Invocation trust.
  if (context.invocationTrust === "PLATFORM_AUTHENTICATED") add("1A.IDENTITY.INVOCATION", STATUS.PASS, REASON.OK, "the invocation is platform authenticated", { mode: context.mode, provider: context.provider });
  else add("1A.IDENTITY.INVOCATION", STATUS.HUMAN_REVIEW_REQUIRED, REASON.OPERATOR_INVOCATION, "operator-supplied invocation: at best human review, never READY", { mode: context.mode });

  add("1A.IDENTITY.HEAD", STATUS.PASS, REASON.OK, "head and tree established from Git", { head: subject.head, tree: subject.tree, parents });

  // Policies (root tip, then base / first parent).
  const rootState = await readPolicyAt(git, rootTip);
  const basePolicyState = await readPolicyAt(git, base);
  policyRecords(out, { rootTip, mode: context.mode, basePolicyState, rootState, defaultBranchName: context.defaultBranchName });

  // Effective policy and protected targets.
  let policy;
  let protectedRefs;
  if (rootState.state === "valid") {
    protectedRefs = rootState.policy.protectedTargetRefs;
    if (context.mode === "PR_REVIEW") policy = { source: "ROOT_POLICY", policy: rootState.policy, digest: rootState.digest, unsupportedCapabilities: rootState.unsupportedCapabilities };
    else if (basePolicyState.state === "valid") policy = { source: "POLICY_AT_FIRST_PARENT", policy: { ...basePolicyState.policy, protectedTargetRefs: protectedRefs }, digest: basePolicyState.digest, unsupportedCapabilities: basePolicyState.unsupportedCapabilities };
    else policy = { source: "BUILTIN_MINIMUM", policy: { ...BUILTIN_MINIMUM_POLICY, protectedTargetRefs: protectedRefs }, digest: null, unsupportedCapabilities: [] };
  } else if (rootState.state === "absent") {
    protectedRefs = [context.defaultBranchName];
    policy = { source: "BUILTIN_MINIMUM", policy: { ...BUILTIN_MINIMUM_POLICY, protectedTargetRefs: protectedRefs }, digest: null, unsupportedCapabilities: [] };
  } else {
    protectedRefs = null; // a broken root policy never yields a weaker fallback
    policy = { source: "NONE", policy: null, digest: null, unsupportedCapabilities: [] };
  }

  // Target protection.
  if (protectedRefs === null) add("1A.TARGET.PROTECTED", rootState.state === "invalid" ? rootState.status : STATUS.INCOMPLETE, REASON.POLICY_INVALID, "target protection cannot be evaluated: the governance-root policy is unusable", { targetRefName: context.targetRefName });
  else if (protectedRefs.includes(context.targetRefName)) add("1A.TARGET.PROTECTED", STATUS.PASS, REASON.OK, "the target is an authenticated, protected governance target", { targetRefName: context.targetRefName, protectedTargetRefs: protectedRefs });
  else add("1A.TARGET.PROTECTED", context.mode === "POST_MERGE" ? STATUS.FAIL : STATUS.HUMAN_REVIEW_REQUIRED, REASON.TARGET_NOT_PROTECTED, "the authenticated target is not a protected governance target", { targetRefName: context.targetRefName, protectedTargetRefs: protectedRefs });

  if (policy.unsupportedCapabilities.length > 0) add("1A.POLICY.CAPABILITIES", STATUS.INCOMPLETE, REASON.CAPABILITY_UNAVAILABLE_ON_TARGET, "the policy requires a capability this framework does not list", { unsupported: policy.unsupportedCapabilities });
  else if (policy.policy !== null) add("1A.POLICY.CAPABILITIES", STATUS.PASS, REASON.OK, "every required capability is supported", { required: policy.policy.requiredCapabilities });

  if (context.mode === "PR_REVIEW") {
    // Target tip: a supplied SHA is an assertion only; the resolved tip is always used.
    if (context.suppliedTargetSha !== null && context.suppliedTargetSha !== targetTip) add("1A.IDENTITY.TARGET_TIP", STATUS.INCOMPLETE, REASON.TARGET_TIP_MISMATCH, "the supplied target SHA differs from the independently resolved tip; the resolved tip is used", { resolvedTargetTip: targetTip }, { suppliedTargetSha: context.suppliedTargetSha });
    else add("1A.IDENTITY.TARGET_TIP", STATUS.PASS, REASON.OK, "the target tip was resolved independently", { targetRefName: context.targetRefName, resolvedTargetTip: targetTip, suppliedAssertion: context.suppliedTargetSha !== null });
    add("1A.IDENTITY.BASE", STATUS.PASS, REASON.OK, "the unique merge base of the head and the resolved target tip", { base });

    // Degenerate-range guard: an empty diff from a wrong range must never pass.
    const ancestry = await git.isAncestor(context.headSha, targetTip);
    if (base === context.headSha || !ancestry.ok || ancestry.value) {
      const detail = !ancestry.ok ? "ancestry of the head on the target could not be established" : "the head is the base or is already contained in the target tip";
      add("1A.IDENTITY.RANGE", STATUS.INCOMPLETE, REASON.DEGENERATE_RANGE, detail, { base, head: subject.head });
    } else add("1A.IDENTITY.RANGE", STATUS.PASS, REASON.OK, "the range is not degenerate", { from: base, to: subject.head });

    // expectedBase / expectedParent: an assertion, never authority.
    const asserted = isPlainObject(input.manifestAssertions) ? input.manifestAssertions.expectedBase : undefined;
    if (asserted === undefined || asserted === null) notApplicable("1A.IDENTITY.EXPECTED_BASE", "the manifest asserts no expectedBase");
    else if (typeof asserted !== "string" || !SHA40.test(asserted)) add("1A.IDENTITY.EXPECTED_BASE", STATUS.CONFIGURATION_ERROR, REASON.MANIFEST_TYPE_INVALID, "expectedBase must be a full lowercase 40-hex SHA", {});
    else if (asserted === base) add("1A.IDENTITY.EXPECTED_BASE", STATUS.PASS, REASON.OK, "the manifest expectedBase matches the derived base", { base }, { expectedBase: asserted });
    else add("1A.IDENTITY.EXPECTED_BASE", STATUS.FAIL, REASON.BASE_MISMATCH, "the manifest expectedBase contradicts the independently derived base", { base }, { expectedBase: asserted });

    await workflowAnchor(git, context, base, out);
  } else {
    // POST_MERGE: shared identity facts only (merge-gate residue stays GOV-VERIFY-1's).
    const onTarget = await git.isAncestor(context.headSha, targetTip);
    if (!onTarget.ok) add("1A.IDENTITY.MERGE_ON_TARGET", STATUS.INCOMPLETE, REASON.TARGET_TIP_UNAVAILABLE, "ancestry of the merge commit on the target could not be established", {});
    else if (!onTarget.value) add("1A.IDENTITY.MERGE_ON_TARGET", STATUS.FAIL, REASON.MERGE_NOT_ON_TARGET, "the merge commit is not an ancestor of, or equal to, the resolved target tip", { targetTip });
    else add("1A.IDENTITY.MERGE_ON_TARGET", STATUS.PASS, REASON.OK, "the merge commit is on the target", { targetTip });

    if (parents.length === 2) add("1A.IDENTITY.TOPOLOGY", STATUS.PASS, REASON.OK, "exactly two parents (standard two-parent merge)", { parents });
    else add("1A.IDENTITY.TOPOLOGY", STATUS.FAIL, REASON.TOPOLOGY_UNEXPECTED, "not a standard two-parent merge (squash, fast-forward, octopus or other topology)", { parentCount: parents.length }, { parentCount: 2 });

    const history = await git.firstParentContains(targetTip, base);
    if (!history.ok) add("1A.IDENTITY.BASE", STATUS.INCOMPLETE, REASON.BASE_NOT_ON_TARGET_HISTORY, "the target first-parent history could not be established", { base });
    else if (!history.value) add("1A.IDENTITY.BASE", STATUS.FAIL, REASON.BASE_NOT_ON_TARGET_HISTORY, "the first parent is not on the target first-parent history", { base, targetTip });
    else add("1A.IDENTITY.BASE", STATUS.PASS, REASON.OK, "the first parent is the base and lies on the target first-parent history", { base });

    if (parents.length >= 2 && parents[1] === context.mergedPrHeadSha) add("1A.IDENTITY.MERGED_HEAD", STATUS.PASS, REASON.OK, "the second parent equals the platform-recorded merged PR head", { mergedPrHead: context.mergedPrHeadSha });
    else add("1A.IDENTITY.MERGED_HEAD", STATUS.FAIL, REASON.MERGED_HEAD_MISMATCH, "the second parent does not equal the platform-recorded merged PR head", { secondParent: parents[1] || null }, { mergedPrHead: context.mergedPrHeadSha });
  }

  await readGate(git, input.gate, base, context.headSha, out, context.mode === "PR_REVIEW" ? "base" : "first parent");

  return deepFreeze({
    established: true,
    mode: context.mode,
    identity: { mode: context.mode, head: subject.head, tree: subject.tree, parents: [...parents], base, targetRefName: context.targetRefName, targetTip, rootTip, invocationTrust: context.invocationTrust },
    subject,
    policy: { source: policy.source, policy: policy.policy, digest: policy.digest },
    records: out.records,
    outcome: null,
  });
}

module.exports = { getGitIdentity };
