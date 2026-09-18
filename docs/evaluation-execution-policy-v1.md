# Evaluation Execution Policy v1

CRW2-A2, addressing conformance finding A-2.

## Why this exists

A conformance analysis flagged `A-2`: *"whether all evaluation/regression
dimensions strictly block merges is not yet formally decided/enforced."*
That is precise wording, and it matters: the finding is not "v1-v5's
non-blocking behavior is a bug that must be made strict." It is "this
repository has not yet written down, in one place, which evaluation/
regression dimensions block CI and why."

This document is that record. It exists so a future reader - human or
another coding-agent mission - never again has to re-derive the policy split
from six separate files' inline comments, and never mistakes deliberate
INFORMATIONAL behavior for an unfinished TODO.

**This document does not implement anything.** The runtime enforcement of
the decision recorded here lives in
[`scripts/ai/evaluation/execution-policy.js`](../scripts/ai/evaluation/execution-policy.js)
- specifically its `VERSION_POLICY` table and `resolveExitCode()` function.
If this decision ever changes, update both this document and that table
together.

## The formal decision

| Version | Subject | Policy | REGRESSED | IMPROVED | UNCHANGED | BASELINE_MISMATCH |
|---|---|---|---|---|---|---|
| v1 | QA-failure-triage: classification / shouldRetry / shouldCreateBug | `INFORMATIONAL` | exit 0 | exit 0 | exit 0 | exit 1 |
| v2 | Same as v1 + correlation-quality dimensions | `INFORMATIONAL` | exit 0 | exit 0 | exit 0 | exit 1 |
| v3 | Structurally identical to v2 (new dataset, no new dimension) | `INFORMATIONAL` | exit 0 | exit 0 | exit 0 | exit 1 |
| v4 | Structurally identical to v3 (new dataset, no new dimension) | `INFORMATIONAL` | exit 0 | exit 0 | exit 0 | exit 1 |
| v5 | Structurally derived from v4 + knowledge-grounding dimensions | `INFORMATIONAL` | exit 0 | exit 0 | exit 0 | exit 1 |
| v6 | Test Design pipeline quality (Roadmap #22G) - a different subject entirely | `STRICT` | exit 1 | exit 1 | exit 0 | exit 1 |

`BASELINE_MISMATCH` (the current sample set doesn't match the committed
baseline's sample set) is a **structural failure**, not a regression/
improvement verdict - it blocks under every policy, because the comparison
itself could not safely run.

## Why v1-v5 are INFORMATIONAL

This is a **positive, evidenced decision**, not an unaddressed default:

- v1-v5 score **QA-failure-triage classification accuracy** against
  frozen, hand-curated datasets - `scoring-v6.js`'s own header comment
  describes v1-v5 as scoring "frozen, hand-curated QA-failure-triage
  records." Curation of what counts as the "correct" classification for an
  ambiguous or borderline failure is itself a judgment call, not a ground
  truth with the same stability as a committed, reviewed artifact.
- The pre-existing implementation already documented this explicitly before
  this policy was centralized: `regression.js`'s own comment read *"Phase 3
  is offline/informational only... A later CI integration may map REGRESSED
  to a non-zero exit; that mapping is deliberately not made yet"*, and
  `regression-v2.js`'s: *"Informational only, same as v1: even REGRESSED
  exits 0 here."*
- `.github/workflows/cypress.yml`'s own `qa-agent-evaluation` job comment
  (pre-existing, unchanged by CRW2-A2) states the operational reasoning
  directly: *"For v1-v5 (QA-failure-triage evaluation), a REGRESSED result
  is informational only... and must not fail this job."* Blocking merges on
  every classification-accuracy fluctuation on a curated-judgment dataset
  would be actively harmful - it would train contributors to treat CI red
  as noise, or to game the curated dataset rather than fix real triage
  behavior.
- No v1-v5 dataset currently has an established, reviewed baseline-update
  governance process equivalent to v6's (see below) - promoting them to
  `STRICT` today would mean blocking merges against a baseline nobody has a
  defined process for updating.

**INFORMATIONAL does not mean "not reviewed" or "not visible."** Every
`regression*.js` run still computes and truthfully reports `REGRESSED` /
`IMPROVED` / `UNCHANGED` in its output, and (as of CRW2-A2) an explicit
`Execution policy: INFORMATIONAL` / `Blocking decision: NON-BLOCKING` line -
nothing is silently relabeled as `PASS`.

## Why v6 is STRICT

Also a positive, evidenced decision, for the opposite reason:

- v6 evaluates a **different subject**: the quality of the `#22` Test
  Design pipeline (`RequirementModel` → `TestCaseModel` →
  `AutomationCandidate` → `TestDesignReviewPackage`), against a
  **human-reviewed, committed baseline** (`baseline-v6.json`), not a
  hand-curated dataset of historical failures.
- `regression-v6.js`'s own pre-existing comment (Roadmap `#22G-C1`, closing
  finding `G-2`) explains why *both* directions of drift block: *"only an
  exact match to the committed, reviewed baseline is safe... an
  always-pass scorer mutation can look identical to a genuine content
  improvement from the comparator's own point of view."* An `IMPROVED`
  verdict is not automatically trusted - it still requires a human to
  review and explicitly commit an updated baseline, in a normal, diffed
  commit. That is what makes a strict gate appropriate here and not for
  v1-v5: the baseline-update path is itself reviewed and deliberate.

## Runtime authority

- **Status → exit code**: `scripts/ai/evaluation/execution-policy.js`'s
  `resolveExitCode(status, policy)` - the single place any `REGRESSED` /
  `IMPROVED` / `UNCHANGED` / `BASELINE_MISMATCH` verdict becomes a process
  exit code, for every version.
- **Version → policy**: the same file's `VERSION_POLICY` table plus
  `resolvePolicyForVersion(version)` - the single declarative assignment
  table this document's own decision matrix mirrors. An unrecognized
  version throws rather than silently defaulting to either policy.
- Both fail closed: an unrecognized `status`, `policy`, or `version` never
  silently resolves to a passing (`exitCode: 0`) result.

## Future policy-change rule

`INFORMATIONAL` is not permanent for any given version by default, and this
document is not a promise that v1-v5 will stay that way forever. A version
may be promoted to `STRICT` only when **all** of the following hold, and the
change is made explicitly (updating `VERSION_POLICY` in
`execution-policy.js` **and** this document's decision matrix together, in
a reviewed PR that cites this criteria list):

1. The dataset has a **stable, reviewed baseline** with an established,
   documented update process (comparable to v6's).
2. The metric's semantics are actually suitable for merge-blocking - i.e.
   a `REGRESSED` verdict reliably indicates a real behavioral regression,
   not curated-judgment noise.
3. The false-positive / curated-judgment risk has been evaluated and judged
   acceptable by whoever owns that decision.
4. Reviewers and CI maintainers are prepared for the version to actually
   block merges once promoted - this is not a passive default, it is an
   active operational commitment.

Until a version explicitly satisfies all four and its `VERSION_POLICY`
entry is updated accordingly, it remains `INFORMATIONAL`.

## What this document does not do

- It does not claim `B-4` (fail-closed test-infrastructure verification) is
  closed. `A-2`'s own fail-closed unknown-status/policy/version behavior is
  a local property of this evaluator, not a global `B-4` closure.
- It does not claim `B-6` (versioned governance/process knowledge) is
  closed. This is one narrow, A-2-scoped policy record, not a general
  governance-documentation framework.
- It does not touch `D-1` (duplicate evaluation engines, deferred) - v1-v6
  remain six separate scoring/comparison engines; only their exit-code
  *policy* assignment is centralized here.
- It does not claim all supply-chain, security, or correctness properties
  of the evaluation pipeline are proven - only that the blocking-vs-
  informational decision is now explicit, evidenced, and enforced by one
  runtime authority.
