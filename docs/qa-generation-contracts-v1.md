# QA Generation Contracts v1

Roadmap #22/23-F0 - Shared QA Generation Foundation.

## Why this exists

Roadmap #21 closed with a mature, production, reviewed failure-analysis
architecture (Cypress + Playwright, `scripts/ai/`). The next product
direction introduces two future streams that must not independently invent
incompatible data models:

- **#22 AI Test Design** - will consume requirement/source evidence and
  produce `RequirementModel` -> `TestCaseModel` -> `AutomationCandidate`.
- **#23 AI Test Automation** - will consume `AutomationCandidate` and
  produce/use `AutomationPlan`.

Before either stream is implemented, this foundation (`scripts/ai/generation/`)
freezes the shared, versioned, strictly validated contract layer both streams
must speak. It exists specifically so #22 and #23 can be built independently,
on separate branches/PRs, without silently drifting into incompatible shapes.

**This document, and the code it describes, does not implement #22 or #23.**
No requirements-ingestion agent, test-design agent, automation agent,
automation reviewer, LLM prompt, provider call, generated test, generated
Playwright/Cypress code, automatic file write, or new evaluation dataset
exists here. Those are later, separate stages.

## The four contracts and their dependency direction

```
RequirementModel
        |
        v
TestCaseModel
        |
        v
AutomationCandidate
        |
        v
AutomationPlan
```

This is a **data contract flow**, not autonomous execution: each artifact is
a plain, deterministic, JSON-serializable object a producer builds and a
validator checks - nothing in this foundation calls a provider, runs a
browser, or writes a file on an artifact's behalf.

- **`RequirementModel`** (`requirement-model.js`) - grounded requirements,
  their provenance, explicit assumptions, and explicit open questions. Never
  generated tests, automation recommendations, or implementation plans.
- **`TestCaseModel`** (`test-case-model.js`) - human-readable logical test
  cases derived from one `RequirementModel`. Never automation code,
  selectors, repository writes, branch/PR information.
- **`AutomationCandidate`** (`automation-candidate.js`) - a **recommendation**
  artifact (`AUTOMATE` / `DO_NOT_AUTOMATE` / `BLOCKED`) for one test case,
  never a requirement fact.
- **`AutomationPlan`** (`automation-plan.js`) - a **non-mutating**, descriptive
  proposed implementation plan for one candidate. Never generated code, a
  patch blob, or a filesystem-writer method.

`cross-model-validation.js` validates a full chain
(`RequirementModel -> TestCaseModel -> AutomationCandidate[] -> AutomationPlan[]`)
deterministically and offline - no provider, network, browser, or filesystem
access.

## Fact vs. assumption vs. open question vs. recommendation

These are structurally distinct throughout the foundation and must never be
conflated:

- **A requirement fact must never silently become an assumption.** A
  `requirement` entry in `RequirementModel.requirements` must cite at least
  one entry in the model's own `evidenceRefs` registry (a real source/
  evidence pointer) - a requirement with zero provenance, or a dangling
  evidence-reference id, fails validation. This is the foundation's core
  anti-hallucination invariant.
- **An assumption must never masquerade as a requirement.** Assumptions live
  in their own top-level `assumptions` array (`{id, text, rationale,
  relatedIds?}`), structurally separate from `requirements` - exact-key
  rejection means a `requirement` object can never also carry
  assumption-shaped fields.
- **Missing requirement / unspecified behavior must never be represented as
  an invented requirement.** The contract instead offers `openQuestions`
  entries typed `OPEN_QUESTION`, `AMBIGUITY`, or `MISSING_REQUIREMENT` - the
  only legitimate way to represent a gap.
- **A recommendation must never masquerade as repository evidence.**
  `AutomationCandidate.rationale` is a recommendation's own reasoning; any
  repository/project-profile fact the rationale relies on must be cited via
  `rationaleEvidenceRefIds` pointing into the candidate's own `evidenceRefs`
  registry, not asserted unsupported.

## Versioning policy - v1 is frozen once merged

Every artifact carries `schemaVersion: 1` - not a string `"1"`, not `2`, never
coerced (no `parseInt`, no truthiness, no loose equality) and never silently
defaulted when missing. **Unknown top-level and nested fields are rejected
(`UNKNOWN_FIELD`)** - this applies recursively to every nested object
(evidence references, assumptions, open questions, requirements, test cases,
steps, planned changes, validation-plan entries).

**After this foundation merges, v1 contract semantics are frozen.** Silent
contract expansion is forbidden. A bug fix may strengthen enforcement of an
*already-documented* v1 invariant, but must never silently redefine what v1
means. Any intentional, incompatible shape or meaning change requires a new
`schemaVersion: 2` and a separate v2 validator - never a v1 field added
after the fact. This exists specifically so `#22` and `#23` cannot drift
independently once they start consuming these contracts.

## Grounding / provenance

`evidenceRefs` entries (`{id, kind, sourceId?, location?}`) are **pointers**,
not raw content - `kind` is one of a closed vocabulary (`user_input`,
`document`, `repository`, `project_profile`, `knowledge`). They identify a
source; they do not embed a multi-kilobyte file body or an arbitrary payload.
Future producers/consumers retrieve bounded repository evidence separately.

## Project isolation

Every top-level artifact carries `projectId`. Every validator accepts an
optional `expectedProjectId`; when supplied, the artifact's `projectId` must
match it **exactly** - never normalized, trimmed, or case-folded into
equality. `cross-model-validation.js` additionally requires every artifact in
a chain to share the same `projectId` - any mismatch fails closed. This
mirrors the same isolation posture `scripts/ai/project-profile.js` and
`analyze-failure.js`'s History/Knowledge project gates already apply to the
failure-analysis pipeline.

## Safe repository paths (AutomationPlan)

`AutomationPlan.plannedChanges[].path` reuses
`scripts/ai/context-utils.js`'s existing, already-tested `classifyPathString()`
path classifier - only a `SAFE_RELATIVE` classification is ever accepted.
Absolute POSIX/Windows-drive/UNC paths, `http(s)://`/`file:` URLs, and
traversal (`../`) are all rejected. This is validation of a **path string
only** - `automation-plan.js` never touches the filesystem.

## No provider, browser, or filesystem behavior

Nothing under `scripts/ai/generation/` imports a provider (Groq/Gemini),
calls `fetch`, launches a browser, calls the GitHub API, or performs a
filesystem write (`fs.writeFile`/`fs.rm`/`child_process`/`git`/`gh`). The one
cross-directory import is `context-utils.js`'s pure `classifyPathString()`
string classifier, reused rather than duplicated. Contract validation itself
never depends on the current time, randomness, network, or filesystem
content - all identifiers are supplied by producers, never generated here.

## Future ownership

- **#22 (AI Test Design)** will produce and consume `RequirementModel`,
  `TestCaseModel`, and `AutomationCandidate`.
- **#23 (AI Test Automation)** will consume `AutomationCandidate` and
  produce/use `AutomationPlan`, plus a future, separately-designed dry-run/
  apply policy - not part of this foundation.
- This foundation itself generates none of the four artifacts through AI. It
  only defines what a valid v1 artifact looks like and how a chain of them is
  cross-checked.

## What this is not

This foundation does not mean AI can design tests, automate tests, or that
requirements ingestion, Playwright/Cypress code generation, self-correction,
automation review, or generation evaluation exist. It means only that the
shared, deterministic data-contract foundation those future stages will build
on now exists, is strictly validated, and is frozen at v1.
