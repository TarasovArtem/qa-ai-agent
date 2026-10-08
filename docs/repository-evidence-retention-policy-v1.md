# Repository Evidence and Branch Retention Policy v1

Status: CURRENT

This versioned document preserves the repository evidence/branch-retention policy that previously lived only in the root README. Moving it here changes location only; it does **not** change governance semantics.

## Classification authority

This repository accumulates branches and pull requests beyond ordinary merged implementation history: deliberately non-merged controlled-failure experiments, evidence probes, infrastructure spikes, and diagnostic investigations.

A branch name or prefix (`experiment/*`, `evidence/*`, `diagnostic/*`, `spike/*`, `stabilization/*`, `feature/*`, and similar) is a hint only and is never sufficient classification authority by itself. Classification must be based on actual provenance: PR association and disposition, ancestry relative to `main`, unique commits, durable references elsewhere in the repository, and the branch's roadmap/evidentiary role.

Likewise, **non-ancestor status does not mean disposable** — controlled evidence is often deliberately kept unmerged — and **ancestor status does not automatically mean safe to delete** — a merged branch can still carry provenance value.

## Seven retention classes

Every branch/PR is expected to fall into one of seven classes:

1. **ACTIVE** — unfinished or currently in-progress repository work (for example an open implementation PR or active corrective work). Default: retain; deletion is forbidden while active. Not every open PR is ACTIVE: a deliberately open evidence or spike PR is not unfinished work.

2. **MERGED_IMPLEMENTATION** — ordinary completed implementation whose substance is represented in certified `main`. A branch becomes a cleanup candidate only once its PR is merged, its approved source provenance is on record, the merge commit is present on `main`, post-merge certification is complete, no unique branch-only evidence remains, and no active work still depends on it. Candidate eligibility is not deletion authorization.

3. **LOAD_BEARING_EVIDENCE** — evidence whose removal would materially weaken a current reproducibility, controlled-failure, CI, security, architecture, or evaluation claim. Default: retain. Deletion remains prohibited unless equivalent provenance — purpose, ground truth, exact commit SHA, associated PR, workflow run, result, and any supersession relationship — has first been durably migrated to another artifact (for example a versioned evaluation fixture, historical-observation record, permanent documentation, or evidence manifest) and that migration has itself been independently reviewed.

4. **HISTORICAL_REFERENCE** — useful provenance that is no longer the sole load-bearing proof, typically because equivalent durable evidence already exists elsewhere and no current reproducibility claim depends on the live ref. Default: retain. It may become a future cleanup candidate only after independent review confirms the durable substitute is sufficient; age by itself is never sufficient justification.

5. **DIAGNOSTIC_DISPOSABLE** — a closed temporary investigation whose findings are captured elsewhere (permanent documentation, a merged fix, or a superseding permanent solution), with no active roadmap dependency, no unique required reproducer, no load-bearing evidence role, and no relevant open PR. Candidate eligibility: yes. Immediate deletion: no; the separate cleanup lifecycle below still applies.

6. **ORPHAN** — no PR, issue, roadmap, documentation, workflow/evaluation role, and no unique required history. This classification requires strong positive evidence of absence of any role. Insufficient investigation must never be resolved into ORPHAN merely to permit deletion.

7. **UNRESOLVED** — the mandatory fail-safe classification whenever available evidence is insufficient to reach one of the above with confidence. Default: retain; deletion is forbidden until the branch is resolved into a defensible class.

## Controlled-failure branches

Controlled-failure branches deliberately contain an intentional defect or failing assertion to prove a pipeline or investigate a defect. They are evidence, not broken implementation work, and **must not be merged into `main`** unless a later, separately approved task explicitly transforms or removes the controlled failure and goes through normal independent source review and approval.

Today this is enforced by project policy, explicit PR title/body wording such as `DO NOT MERGE` / `MUST NEVER BE MERGED`, and review discipline. There is currently no generic technical merge guard that automatically blocks every recognized controlled-failure marker. Such a guard would be future hardening, not current capability.

## Evidence PR lifecycle

A deliberately non-merged evidence or spike PR may be either:

- **KEEP_OPEN_AS_EVIDENCE** — justified only when the open state itself serves an active current purpose such as continuing observation or an active experiment. It must never be retained open from inertia or solely because an older PR body once said so.
- **CLOSE_UNMERGED_AND_RETAIN_BRANCH** — once evidence capture and observation are complete and the branch must never merge, the PR may be closed while retaining its branch, exact tip SHA, body, comments, and workflow-run references. Closing without merging does not delete the PR body, comments, timeline, or branch.

A PR's open/closed state is mutable external metadata, not source. Changing it therefore requires its own separately authorized lifecycle step and must never be silently bundled with an unrelated source change.

## Cleanup is a separate lifecycle

Classification and retention-policy approval establish eligibility only; they are never deletion authorization, regardless of class — including MERGED_IMPLEMENTATION, DIAGNOSTIC_DISPOSABLE, and ORPHAN.

Any future destructive branch cleanup must use its own sequence:

1. candidate selection;
2. independent exact-ref review;
3. explicit cleanup authorization;
4. exact-ref deletion execution;
5. post-deletion verification.

Any deletion must be bound to a single exact branch name and its exact expected tip SHA, and must refuse to proceed if the current tip differs from the approved tip.

**No wildcard, prefix-wide, or age-only deletion is ever authorized.** Examples of forbidden bulk rules include deleting all `experiment/*`, all merged branches, or everything older than a given age. Every deletion is a single, named, exact-ref decision.

## Governance boundary

This document is normative for repository evidence/branch-retention semantics. It does not itself authorize any branch deletion, PR closure, merge, lifecycle closure, or other repository mutation.
