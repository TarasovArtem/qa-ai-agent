# Stage 4A security corrective S1 — SEC-S4A-01

S1 continues PR #247 from HEAD
`096cf0b4d9474a683cc6f2ea36f1a50b195d8120`, tree
`a7d25f17f86583a3fc2b716cfd64fee70eb9616c`, with base
`606631c343a2f823a23000e2b1d52cfd3998690c`. Pre-flight fetched origin and
verified the open, unmerged PR, identical local/remote heads, unchanged base,
and clean working tree. No rebase, amendment or force push is part of S1.

## Acceptance boundary

`run-artifacts.validatePlans` applies the existing canonical
`path-identity.assertPathIdentity` to every plan's target list after the
generation-chain schema/semantic validation. `validateGenerated` applies
the same validator after #23D semantic validation and before constructing
any review package. #23D already requires complete, exact 1:1 binding of
planned targets and generated changes, so checking the generated path list
also covers the plan targets at this boundary. PPI-1 policy itself is unchanged.

Only `PATH_IDENTITY_REFUSED` is translated to the existing generation
validation code `INVALID_PATH`; unexpected failures propagate. This avoids
leaking paths or remapping the canonical validator's later-boundary errors.

| Acceptance path | Shared validator | Existing refusal mapping |
| --- | --- | --- |
| Fresh `plan`: generative child output, before `commitStage` | `validatePlans` | `PROVIDER_OUTPUT_REFUSED / 6` |
| Persisted plan: `loadPlanStage` → `readPlan`, before generate provider invocation | `validatePlans` | `RUN_ARTIFACT_INVALID / 4` |
| Fresh `generate`: generative child output, before package construction and `commitStage` | `validateGenerated` | `PROVIDER_OUTPUT_REFUSED / 6` |
| Persisted generated/package input: `loadGenerateStage` → `readGenerate` | `validateGenerated` | `RUN_ARTIFACT_INVALID / 4` |

The generative child still uses the existing #23C/#23D generators and returns
proposals to the parent. Parent validation precedes accepted product state.
`review show` and the private release-disabled Stage 4 review/apply routes
load plan and generated stages through these same readers. Persisted review
packages must still have valid digests and equal the canonical rebuild.
No CLI acceptance route bypasses these validators. Low-level private model
builders keep their existing contracts; no public export changes.

## Regression and reproduction evidence

`security-s4a-s1.test.js` shares hostile input vectors with the canonical
PPI-1 tests, through the repository-only `ppi1-path-vectors.js` helper.
The tests call canonical PPI-1, without reproducing its decision logic.
They cover all Windows device families (COM0–9/LPT0–9 included), device
components and extensions, absolute/drive/UNC paths, traversal and dot
segments, backslashes, colon/ADS, trailing dot/space, protected components,
Unicode/bidi/zero-width/normalization identities, component/path limits,
framework identity, malformed separators, and ASCII-folded collisions.
Every vector is checked at fresh and persisted plan/generated boundaries.

Otherwise valid #23D artifacts are built and packaged using the existing
builders. Their digests remain valid; PPI-1 refusal is then independently
required. Inputs already rejected by a preceding schema/semantic check are
also checked for fail-closed behavior, with recomputed self-digests.

Real CLI orchestration uses the existing test-only provider preload with
the real generative child and real generators. It proves that a fresh
`CON.cy.js` plan is refused with exit 6 without plan artifacts or a manifest
change. A hostile generate response against a valid plan is rejected by the
child's existing plan-binding validation (`PROVIDER_FAILURE / 6`), without
generated artifacts or a review package. The original coherent plan/generate
exploit is now stopped earlier: a legacy persisted CON plan exits 4 before
provider invocation. Direct generated-boundary tests isolate PPI-1 there
using a fully valid legacy CON plan/change set/review package, and require
exit 4 on reload. A fully rebound persisted hostile chain is refused by the
real `review show` command with no spawn or writes.

Positive coverage includes normal and nested Cypress CREATE proposals
through real plan/generate/review-show orchestration, plus Cypress and
Playwright CREATE/MODIFY at both shared acceptance boundaries. MODIFY uses
bound repository evidence, because the current CLI context collector supplies
no relevant target files; S1 does not change that collector. A leading hyphen
remains accepted by canonical PPI-1. The older bidi-target acceptance test
now requires early refusal; content/purpose presentation escaping remains
covered by the existing Stage 3 tests.

## Preserved boundaries and handoff

The later Stage 4 PPI-1 gate and #23F mutation/path checks remain intact.
Stage 4A remains release-disabled (`reviewRecord: false`, `apply: false`).
There is no change to TAP-2, CRS-1, PPI-1 semantics, ReviewRecord/Manifest v2,
state derivation, claim/ledger, durability operations or D-REPLACE commit
point, supersession, single-use/same-principal enforcement, binding versus
precondition classification, manifest capacity, critical-section bounds,
clock tolerance, package minimality, or Win32 fail-closed behavior.

The new dependency is the existing gate-free path validator. DC-F02 must
continue to prove that Stage 3 reaches no approval gate and #23F remains the
sole supported gate consumer. TSB-F02 remains OPEN / LOW / CONDITIONAL;
trigger FALSE. S1 does not remediate F02. R-1..R-5 remain accepted;
AT-07/TB-01 remain residual. Presentation-binding, reviewer-identity and
human-decision provenance future guards remain OPEN. No stronger authenticity
assurance is claimed.

Required verification includes focused S1/Stage 3 tests, existing PPI-1/path
and #23F suites, Stage 4 suites, installation proofs, DC-F02 and AISEC
enablement-surface tests, the full supported Linux Node 22 unit suite, and
`git diff --check`. Exact corrective-head CI evidence is reported in the
mission handoff after the consolidated corrective commit.

Per the selected mission endpoint, S1 stops at readiness for a fresh
independent heavy Architecture / Software Engineering exact-head re-review.
The previous Architecture approval applies only to the pre-S1 head. Security
re-review has not started and must follow a fresh Architecture APPROVED
verdict. Merge and Stage 4B remain unauthorized and unperformed.
