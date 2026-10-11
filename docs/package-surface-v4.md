# Package Surface v4 — Controlled-v1 Stage 3 private runtime shipping

Authority: `OD-CONTROLLED-V1-STAGE-3-IMPLEMENTATION — APPROVED`;
upstream owner disposition `OD-CONTROLLED-V1-OD-02 — APPROVED / DISPOSITIONED`.

Document type: **evidence record**, not a new public API contract. The public
programmatic API, the `exports` map and the `qa-agent` binary are unchanged.
Supersedes nothing: [`package-surface-v2.md`](package-surface-v2.md) (A-1) and
[`package-surface-v3.md`](package-surface-v3.md) (ProjectProfile v1 snapshot)
stay authoritative for what they record; this document records how OD-02
narrows A-1's physical exclusion.

Governing design: [`controlled-v1-productization-contract-v1.md`](controlled-v1-productization-contract-v1.md)
§9, §9.1, §10.2, §10.4.5, §18, §21.

## 1. Baseline

```text
repository:  TarasovArtem/qa-ai-agent
base HEAD:   6700a3451b928f19620a1c934f5de85dbf78cc05
base TREE:   801347fc9d9a8b4034e506285d8b18851c339ce9
branch:      feature/controlled-v1-productization-stage-3
lifecycle:   CONTROLLED-V1 PRODUCTIZATION STAGES 1–2 = COMPLETE_ON_MAIN / POST-MERGE CERTIFIED
base tarball: 61 files (47 certified baseline + 14 Stage 1–2 CLI modules)
```

## 2. Public surface — unchanged

| Surface | State |
|---|---|
| `exports` | **unchanged** — `.`, `./providers/jira`, `./providers/azure-devops`, `./destinations/azure-devops`, `./package.json`; same targets, same order, no wildcard |
| Root API | **unchanged** — the same 19 names; no Stage 3 function is reachable through it |
| `bin` | **unchanged** — `qa-agent` → `scripts/ai/cli/qa-agent.js` (not exported) |
| Package name / version | **unchanged** — `qa-ai-agent` / `1.0.0` (not a release claim) |
| Dependencies | **unchanged** — no `dependencies`, `optionalDependencies`, `peerDependencies`, `bundleDependencies` or `overrides`; `package-lock.json` unchanged |
| Supported entrypoints | `exports ∪ bin` (unchanged definition, contract §9.1) |

The only `package.json` change is the `files` list: the three private
directories stay excluded as directories (`!scripts/ai/generation`,
`!scripts/ai/generative-test-design`, `!scripts/ai/test-automation`), followed
by **23 explicit, non-glob file re-includes** — exactly the Stage 3 private
runtime closure (§4). A file added to those directories later is not shipped
unless it is added to `files` by name.

## 3. Packed inventory — 89 files (closed list)

`npm pack --dry-run` at the implementation head; enforced as an exact list by
`test/installation/controlled-v1-cli-package.test.js` and, on a real installed
tarball, by `test/installation/controlled-v1-stage3-external-proof.test.js`.

```text
LICENSE
README.md
package.json
scripts/ai/adapters/cypress-adapter.js
scripts/ai/adapters/playwright-adapter.js
scripts/ai/agent-policy.js
scripts/ai/aggregate-browser-context.js
scripts/ai/analyze-failure.js
scripts/ai/bounded-response.js
scripts/ai/cli/args.js
scripts/ai/cli/child-env.js
scripts/ai/cli/cli.js
scripts/ai/cli/config-file.js
scripts/ai/cli/env.js
scripts/ai/cli/errors.js
scripts/ai/cli/generative-runner.js          (new, Stage 3 CLI)
scripts/ai/cli/generative.js                 (new, Stage 3 CLI)
scripts/ai/cli/paths.js
scripts/ai/cli/policy.js
scripts/ai/cli/qa-agent.js
scripts/ai/cli/requirements-check.js
scripts/ai/cli/review-show.js                (new, Stage 3 CLI)
scripts/ai/cli/run-artifacts.js              (new, Stage 3 CLI)
scripts/ai/cli/run-store.js                  (new, Stage 3 CLI)
scripts/ai/cli/stage-process.js
scripts/ai/cli/stage-runner.js
scripts/ai/cli/strict-json.js
scripts/ai/cli/triage.js
scripts/ai/collect-context.js
scripts/ai/collect-history.js
scripts/ai/config.js
scripts/ai/context-utils.js
scripts/ai/correlation-projection.js
scripts/ai/destinations/azure-devops-test-case-destination.js
scripts/ai/framework-runtime-config.js
scripts/ai/generation/automation-candidate.js                         (new, private)
scripts/ai/generation/automation-plan.js                              (new, private)
scripts/ai/generation/cross-model-validation.js                       (new, private)
scripts/ai/generation/errors.js                                       (new, private)
scripts/ai/generation/limits.js                                       (new, private)
scripts/ai/generation/primitives.js                                   (new, private)
scripts/ai/generation/requirement-model.js                            (new, private)
scripts/ai/generation/test-case-model.js                              (new, private)
scripts/ai/generative-test-design/automation-candidate-generator.js   (new, private)
scripts/ai/generative-test-design/automation-candidate-prompt.js      (new, private)
scripts/ai/generative-test-design/evidence-ingestion.js               (new, private)
scripts/ai/generative-test-design/requirement-model-generator.js      (new, private)
scripts/ai/generative-test-design/test-case-model-generator.js        (new, private)
scripts/ai/generative-test-design/test-case-model-prompt.js           (new, private)
scripts/ai/generative-test-design/test-design-prompt.js               (new, private)
scripts/ai/index.js
scripts/ai/knowledge/loader.js
scripts/ai/knowledge/schema.js
scripts/ai/knowledge/selector.js
scripts/ai/knowledge/units/ci-job-isolation-runner-state.json
scripts/ai/knowledge/units/cross-browser-differing-signature-caution.json
scripts/ai/knowledge/units/framework-cypress-command-retry-ability-scope.json
scripts/ai/knowledge/units/framework-cypress-retry-timeout-semantics.json
scripts/ai/knowledge/units/project-firefox-execution-environment-split.json
scripts/ai/knowledge/units/qa-timeout-error-multiple-causes.json
scripts/ai/project-knowledge-config.js
scripts/ai/project-profile.js
scripts/ai/providers/azure-devops-requirements-provider.js
scripts/ai/providers/gemini-provider.js
scripts/ai/providers/groq-provider.js
scripts/ai/providers/index.js
scripts/ai/providers/jira-requirements-provider.js
scripts/ai/providers/mock-provider.js
scripts/ai/providers/provider-contract.js
scripts/ai/providers/provider-error.js
scripts/ai/qa-agent-prompt.js
scripts/ai/repository-root.js
scripts/ai/requirement-artifact.js
scripts/ai/requirement-quality.js
scripts/ai/requirement-traceability.js
scripts/ai/requirements-file.js
scripts/ai/requirements-source-provider.js
scripts/ai/runtime-framework-selector.js
scripts/ai/test-automation/automation-plan-generator.js               (new, private)
scripts/ai/test-automation/automation-plan-prompt.js                  (new, private)
scripts/ai/test-automation/automation-repository-context.js           (new, private)
scripts/ai/test-automation/generate-change-set-prompt.js              (new, private)
scripts/ai/test-automation/generate-change-set.js                     (new, private)
scripts/ai/test-automation/generated-change-set-review-canonical.js   (new, private)
scripts/ai/test-automation/generated-change-set-review-package.js     (new, private)
scripts/ai/test-automation/generated-change-set.js                    (new, private)
scripts/ai/test-design-publishing.js
scripts/ai/test-design.js
scripts/ai/triage-boundary-contract.js
```

61 baseline + 5 new CLI modules + 23 newly shipped private files = **89**.
Tarball checksums are head-specific and are recorded with the CI evidence of
the exact head, not here.

## 4. Newly shipped private files and why each is required

Classification of every file below: **INTERNAL / SHIPPED PRIVATE RUNTIME
DEPENDENCY** — shipped, not exported, unsupported for direct consumer import,
reachable only through the supported `qa-agent` CLI. "Parent" = the CLI
process; "child" = the isolated generative child (`generative-runner.js`).

| File | Required by | Why |
|---|---|---|
| `generation/errors.js` | parent + child | shared `{path, code, message}` error vocabulary; the CLI reports only these closed codes |
| `generation/limits.js` | parent + child | shared v1 bounds used by every validator |
| `generation/primitives.js` | parent + child | shared id/text/evidence-ref primitives of the frozen F0 contracts |
| `generation/requirement-model.js` | parent + child | RequirementModel v1 validator (design output; reload by plan/generate/review show) |
| `generation/test-case-model.js` | parent + child | TestCaseModel v1 validator |
| `generation/automation-candidate.js` | parent + child | AutomationCandidate v1 validator |
| `generation/automation-plan.js` | parent + child | AutomationPlan v1 validator + path classifiers used by GeneratedChangeSet |
| `generation/cross-model-validation.js` | parent + child | `validateGenerationChain` — cross-artifact lineage (RM → TCM → AC → plan) at every boundary |
| `generative-test-design/evidence-ingestion.js` | parent | requirements file → canonical evidence bundle (#22B/ACG-A3), the only owner of EvidenceRefs |
| `generative-test-design/test-design-prompt.js` | child (statically also parent) | RequirementModel prompt (dependency of the generator module) |
| `generative-test-design/requirement-model-generator.js` | child: generate RM; parent: `checkCanonicalProvenance` | #22C provider-backed RM generation; its provenance check is reused for runtime validation |
| `generative-test-design/test-case-model-prompt.js` | child | TestCaseModel prompt |
| `generative-test-design/test-case-model-generator.js` | child | #22D provider-backed TCM generation |
| `generative-test-design/automation-candidate-prompt.js` | child (statically also parent) | AutomationCandidate prompt |
| `generative-test-design/automation-candidate-generator.js` | child: generate ACs; parent: framework-authorization + evidence-provenance validators | #22E generation and its exported #22E-R1 validators |
| `test-automation/automation-repository-context.js` | parent | #23B deterministic, read-only repository context (built in the parent, re-built by generate/review show to detect staleness) |
| `test-automation/automation-plan-prompt.js` | child | AutomationPlan prompt |
| `test-automation/automation-plan-generator.js` | child | #23C provider-backed plan generation |
| `test-automation/generate-change-set-prompt.js` | child | change-set prompt |
| `test-automation/generate-change-set.js` | child | #23D provider-backed GeneratedChangeSet generation (proposal only) |
| `test-automation/generated-change-set.js` | parent + child | GeneratedChangeSet v1 builder/validator (TSB-F01); immutability and digest rules |
| `test-automation/generated-change-set-review-canonical.js` | parent | canonical snapshot/digest primitive of the review package |
| `test-automation/generated-change-set-review-package.js` | parent | #23E review package builder (built by `generate`, re-derived by `review show`) |

The 5 new CLI modules (`generative.js`, `generative-runner.js`,
`review-show.js`, `run-artifacts.js`, `run-store.js`) are Stage 3 orchestration
and share the same INTERNAL / NOT EXPORTED classification as the Stage 1–2 CLI
modules.

## 5. Runtime closure per command

Static analysis over the shipped files (`require` edges; `require.resolve`
edges for spawned children), from
`test/helpers/package-inventory.js` `staticClosure()`.

The CLI parent loads every command handler, so all commands share **one parent
closure**; it contains these 17 private files: `generation/*` (8),
`evidence-ingestion`, `requirement-model-generator`, `test-design-prompt`,
`automation-candidate-generator`, `automation-candidate-prompt`,
`automation-repository-context`, `generated-change-set`,
`generated-change-set-review-canonical`, `generated-change-set-review-package`.
In the parent they are used only for pure validation/building; no provider
object exists there. The parent never loads `config.js`, any provider
implementation, the triage stage modules, the stage runners or the
provider-calling generators (static + runtime proof,
`controlled-v1-cli-package.test.js`).

| Command | Parent work (private modules exercised) | Generative child | Provider |
|---|---|---|---|
| `design` | requirements → `evidence-ingestion`; validates child output with `cross-model-validation` + `requirement-model-generator.checkCanonicalProvenance` + `automation-candidate-generator` validators; writes run | `generative-runner` → `requirement-model-generator`, `test-case-model-generator`, `automation-candidate-generator` (+ their prompts, `generation/*`) | groq / gemini only |
| `plan` | re-validates design artifacts (as above); builds `automation-repository-context`; validates plans with `cross-model-validation` | `generative-runner` → `automation-plan-generator` (+ prompt) | groq / gemini only |
| `generate` | re-validates design + plan; rebuilds context (staleness); validates change sets with `generated-change-set`; builds review packages with `generated-change-set-review-package` | `generative-runner` → `generate-change-set` (+ prompt, `generated-change-set`) | groq / gemini only |
| `review show` | re-validates design + plan + generate; re-derives each review package; read only | **none** — no child, no provider, no write | none |

Generative child closure (all three generative commands; one runner):
`generative-runner.js`, `config.js`, `providers/{index,groq-provider,gemini-provider,mock-provider,provider-contract,provider-error}.js`,
`bounded-response.js`, `qa-agent-prompt.js`, `correlation-projection.js`,
`context-utils.js`, `project-profile.js`, `requirement-artifact.js`, and 21 of
the 23 private files — all except `generated-change-set-review-canonical.js`
and `generated-change-set-review-package.js`, which only the parent uses
(`evidence-ingestion.js` is in the child closure only because the RM generator
imports its bounds). `mock-provider.js` is loaded by the provider
factory but never constructed: the runner refuses any `AI_PROVIDER` other than
`groq`/`gemini` before creating a provider.

`review show` static closure (from `review-show.js`): the CLI support modules
`args`, `errors`, `paths`, `run-artifacts`, `run-store`, `strict-json`, the
RTI loaders, `context-utils`, `project-profile`, `provider-contract`/
`provider-error` (pure), and the 17 parent private files — **no** runner, no
`config.js`, no provider implementation, no approval module.

## 6. A-1 state

```text
A-1 (PRIVATE_GENERATIVE_SURFACE):  SHIPPED PRIVATE / NOT EXPORTED
```

OD-02 reverses A-1's **physical** exclusion for exactly the 23 files of §4.
The **API** exclusion is unchanged: no file of the three private trees is
exported, and every one — shipped or not — is denied through the package
specifier (`ERR_PACKAGE_PATH_NOT_EXPORTED`). As before (contract §1),
"not exported" is a supported-surface statement, not filesystem isolation: a
shipped file is technically addressable by absolute `node_modules/...` path;
such use is unsupported and outside the public contract.

## 7. Explicitly excluded (still unshipped)

| File | Reason |
|---|---|
| `generative-test-design/test-design-review-record.js` | #22F approval record + `validateApprovedTestDesignReview` gate (DC-F02-3/4) |
| `generative-test-design/test-design-review-package.js`, `test-design-review-canonical.js` | #22F review surface; not part of Stage 3 |
| `test-automation/generated-change-set-review-record.js` | #23E approval record + `validateApprovedGeneratedChangeSetReview` gate (DC-F02-1/4) |
| `test-automation/change-set-application.js`, `applied-change-set-record.js` | #23F apply — reserved until OD-04 (DC-F02-5) |
| `test-automation/controlled-execution.js`, `automation-execution-record.js` | #23G execute — reserved until OD-06 |
| `test-automation/regenerate-change-set.js` | outside the Stage 3 chain (minimality) |
| `scripts/ai/**/*.test.js`, `__fixtures__`, `evaluation/**` | tests / fixtures / evaluation |
| `format-pr-comment.js`, `normalized-failure.js`, `pr-comment-client.js` | repository-only CI helpers (unchanged) |
| `scripts/targets/**`, `scripts/governance/**`, `scripts/diagnostics/**`, `test/**`, workflows | repository-only |

None of these is reachable from `exports ∪ bin`; the closure test fails if one
becomes reachable, and the minimality test fails if one is shipped.

## 8. Deep-import denial

Proven twice: in the checkout (package self-reference) and in a real external
install of the packed tarball, for every CLI module, every newly shipped
private file and every excluded private file (both `.js` and extension-less
specifiers in the checkout proof): `ERR_PACKAGE_PATH_NOT_EXPORTED`. This
proves the supported-surface property only, not isolation.

## 9. Consumer runtime dependencies

None. The external proof installs the tarball into an empty repository and
asserts that `node_modules` contains only `qa-ai-agent` and the lockfile
contains no other package. The Stage 3 commands use only Node built-ins
(`crypto`, `fs`, `path`, `child_process`) and package-local modules.

## 10. Minimality and negative proofs

- every shipped `.js` file is reachable from `exports ∪ bin`;
- the private trees contribute exactly the 23 files of §4 (no more, no fewer);
- every non-test file in the private trees is classified as shipped (§4) or
  excluded (§7) — nothing unclassified;
- removing any of the 23 private files, or any of the 5 new CLI modules, from
  the available set makes the closure proof report a missing edge;
- a copy of the **installed** package with one required file removed fails the
  same closure proof and fails to run.

## 11. What this document does not do

It defines no new public API, export, binary or programmatic entrypoint, makes
no release or publication claim, and changes no ROADMAP lifecycle state.
`review record`, `apply` and `execute` remain fixed refusals; approval
authenticity (OD-04) and execution platform support (OD-06) are not entered.
