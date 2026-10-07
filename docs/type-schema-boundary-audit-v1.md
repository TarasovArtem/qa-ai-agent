# Type & Schema Boundary Audit v1 — Repository-Wide

| Field | Value |
|---|---|
| Artifact | `docs/type-schema-boundary-audit-v1.md` |
| Gate | Type & Schema Boundary Audit (distinct Controlled-v1 gate; ROADMAP §7, `OD-CONTROLLED-V1-RELEASE-MODEL` §3 item 2) |
| Authority | `OD-TYPE-SCHEMA-AUDIT-START` — APPROVED; `OD-TYPE-SCHEMA-AUDIT-ARTIFACT-RECOVERY` — APPROVED |
| Issue | #226 (OPEN / ACTIVE) |
| Branch | `audit/type-schema-boundary-audit` |
| Nature | Read-only audit. No remediation, no finding closure, no risk acceptance, no release grant. |

## 1. Executive verdict

**AUDIT COMPLETE AT THE EXACT BASELINE. 7 NEW FINDINGS ARE OPEN (1 MEDIUM, 6 LOW). CONTROLLED RELEASE IS NOT APPROVED.**

- All 439 tracked files were enumerated and each has exactly one classification. 0 are `UNKNOWN — REVIEW REQUIRED`. All 180 relevant non-test files map to at least one boundary.
- **46 material trust/type boundaries:**
  - 19 `PASS`
  - 19 `PARTIAL`
  - 8 `GAP`
  - 0 `UNKNOWN`
  - 0 `NOT_APPLICABLE`
- The six LLM *generation* paths (#22/#23) are the strongest boundaries in the repository. Each one:
  - bounds the raw response before parsing;
  - parses strictly (trim, then `JSON.parse`, with no fence stripping);
  - enforces a closed, bounded schema;
  - routes through a deterministic builder that applies plan, path and protected-area policy.
- The material weakness is a recurring pattern on the **consumption** side. Contracts are enforced fully when an object is *constructed*. When the same object is later *validated or consumed*, the check is mostly self-digest equality plus a few fields. Every self-digest is unkeyed and can be recomputed by the caller (TB-01), so it cannot stand in for re-establishing the contract. The most consequential instance is **TSB-F01 (MEDIUM)**:
  - The documented deterministic protected-path and framework-prefix barrier is enforced only in `buildGeneratedChangeSet()`.
  - The validation boundary does not enforce it, and neither does `applyApprovedGeneratedChangeSet()`, the boundary that actually writes files.
  - A change set the builder would reject passed validation, review-package rebuild and application in an offline probe.
- The only *current operational* LLM path is CI failure triage (Groq, on pull requests). Its output contract is open, and it is not bound to the failed tests it describes (**TSB-F04**). Its persisted-context input is consumed without a structural or size contract (**TSB-F07**, related to but distinct from XI-01/XI-02).
- **Existing findings preserved unchanged:**
  - `XI-01` and `XI-02` stay OPEN / MEDIUM.
  - `C2-SR-01` and `C2-SR-02` stay LOW / NON-BLOCKING / UNRESOLVED.
- **Controlled-v1 blockers:** none of the new findings is an unconditional blocker. Four are `CONDITIONAL` blockers, each tied to a named capability:
  - F01: safe application;
  - F03: controlled execution;
  - F04: triage;
  - F07: triage.
- F02 and F05 are `CONDITIONAL` on narrower surface/consumer conditions.
- F06 is `NO`.

## 2. Exact baseline

```text
repository:            TarasovArtem/qa-ai-agent
branch:                audit/type-schema-boundary-audit
branch HEAD (audited): 9e09027c1973171b168ae25edbfecae79e4a2dc3
branch TREE:           d7c8c497d487c90ba3d6bcb135970aef1b8a9f35
origin/main:           9e09027c1973171b168ae25edbfecae79e4a2dc3
origin/main TREE:      d7c8c497d487c90ba3d6bcb135970aef1b8a9f35
remote audit branch:   9e09027c1973171b168ae25edbfecae79e4a2dc3 (pre-commit)
working tree:          clean at preflight
tracked files:         439 (git ls-files)
Node (authoritative):  v22.23.3 (portable official win-x64 build; SHA-256 matched its SHASUMS256.txt)
host:                  Windows 11, Git Bash
```

The fresh preflight confirmed this identity before any substantive work. Every statement in this document refers to that exact TREE.

**Prior-session inputs.** The previous session ended `STOP — ARTIFACT NOT DELIVERED`. Its numbers were treated as unreviewed leads and recomputed independently:

| Item | Prior session | This audit | Result |
|---|---|---|---|
| Tracked files | 439 | 439 | Confirmed |
| Node 22 unit suite | 5627 total / 5618 pass / 0 fail / 9 skip | 5627 / 5618 / 0 / 9, exit 0 | Confirmed |
| Boundaries | 40 | **46** | Derived fresh; not copied |
| New findings | 7 (2 MEDIUM, 5 LOW) | **7 (1 MEDIUM, 6 LOW)** | Derived fresh; not copied |

No prior finding text, ID or severity was carried over.

## 3. Methodology

1. **Inventory.** `git ls-files` was run at the exact baseline. Each path was classified deterministically by role (§4). Classifications were checked against each source file's own header docstring and against reading the code.
2. **Boundary discovery.** Every place where data crosses a trust or type boundary was located:
   - all `JSON.parse` sites;
   - all `process.env` / `process.argv` reads;
   - all `fetch`, `spawn` and `fs` write sites;
   - every exported validator (`validate*`, `assert*`, `build*`, `recompute*`);
   - the public `exports` map;
   - every workflow step that consumes a generated artifact.
3. **Per-boundary evaluation chain.** Each boundary was traced through: declared/static contract → runtime schema → structural validation → semantic validation → security/policy → provenance/authentication → authorization → fail-closed enforcement. The following were also checked:
   - nested validation and unknown fields;
   - TOCTOU and mutation (snapshot/freeze);
   - stale or replayed evidence;
   - wrong project, repository or root;
   - caller-controlled trust claims;
   - default and coercion behavior;
   - public-contract compatibility;
   - negative/adversarial evidence.
4. **Evidence standard.**
   - `PASS` requires affirmative evidence: code reading plus at least one existing passing test or AISEC-7 case. Absence of evidence was never scored as `PASS`.
   - Construction-time checks were not credited to a later consumption boundary unless that consumer re-runs them.
5. **Offline defensive probes (scratch-only, untracked).** Six probes (P-01..P-06) checked material claims directly against the baseline modules under Node 22.23.3.
   - Each probe used in-process stub providers or OS temp directories only.
   - No probe made a network call, used a runner binary, or touched the repository working tree. `git status` stayed clean.
   - Probe source is intentionally not published. Each probe is described as a property question with its observed result, and is reproducible from the cited symbols and existing test fixtures.
6. **De-duplication.** Each candidate was compared against existing `AT-*`, `PI-*`, `TB-*`, `XI-*`, AISEC-7 `H*` and `SADR-*` records. A candidate already captured there is cross-referenced, not re-raised.
7. **Tests.** `npm run test:unit` was run under Node 22.23.3 (§18). No test was added or modified.

## 4. Complete tracked-file inventory

| Classification | Files |
|---|---:|
| BOUNDARY_SURFACE | 55 |
| CONTRACT_MODEL | 47 |
| BOUNDARY_SUPPORT | 78 |
| TEST / FIXTURE | 226 |
| NO_RELEVANT_BOUNDARY | 33 |
| UNKNOWN — REVIEW REQUIRED | 0 |
| **Total (`git ls-files`)** | **439** |

Every tracked path appears exactly once below, under its single classification, grouped by directory. Paths are relative to the repository root; `(root)` means the repository root itself.

#### 4.1 BOUNDARY_SURFACE (55)

| Directory | Count | Files |
|---|---:|---|
| `.github/workflows` | 3 | `cypress.yml`, `dependency-review.yml`, `supply-chain-audit.yml` |
| `(root)` | 1 | `package.json` |
| `scripts/ai/adapters` | 2 | `cypress-adapter.js`, `playwright-adapter.js` |
| `scripts/ai` | 10 | `aggregate-browser-context.js`, `analyze-failure.js`, `collect-context.js`, `collect-history.js`, `format-pr-comment.js`, `index.js`, `pr-comment-client.js`, `requirements-file.js`, `requirements-source-provider.js`, `test-design-publishing.js` |
| `scripts/ai/destinations` | 1 | `azure-devops-test-case-destination.js` |
| `scripts/ai/evaluation` | 12 | `evaluate-v2.js`, `evaluate-v3.js`, `evaluate-v4.js`, `evaluate-v5.js`, `evaluate-v6.js`, `evaluate.js`, `regression-v2.js`, `regression-v3.js`, `regression-v4.js`, `regression-v5.js`, `regression-v6.js`, `regression.js` |
| `scripts/ai/generative-test-design` | 4 | `automation-candidate-generator.js`, `evidence-ingestion.js`, `requirement-model-generator.js`, `test-case-model-generator.js` |
| `scripts/ai/knowledge` | 1 | `loader.js` |
| `scripts/ai/providers` | 4 | `azure-devops-requirements-provider.js`, `gemini-provider.js`, `groq-provider.js`, `jira-requirements-provider.js` |
| `scripts/ai/test-automation` | 6 | `automation-plan-generator.js`, `automation-repository-context.js`, `change-set-application.js`, `controlled-execution.js`, `generate-change-set.js`, `regenerate-change-set.js` |
| `scripts/diagnostics` | 2 | `audit-drift-check.js`, `branch-inventory.js` |
| `scripts/governance` | 1 | `index.js` |
| `scripts/governance/io` | 1 | `manifest-loader.js` |
| `scripts/governance/stages/1a` | 2 | `git-adapter.js`, `trusted-context.js` |
| `scripts/governance/stages/1f` | 4 | `ci-evidence.js`, `ci-run.js`, `cli.js`, `determination.js` |
| `scripts/governance/stages` | 1 | `head-reader.js` |

#### 4.2 CONTRACT_MODEL (47)

| Directory | Count | Files |
|---|---:|---|
| `scripts/ai/evaluation` | 12 | `baseline-schema.js`, `baseline-v2-schema.js`, `baseline-v3-schema.js`, `baseline-v4-schema.js`, `baseline-v5-schema.js`, `baseline-v6-schema.js`, `dataset-schema.js`, `dataset-v2-schema.js`, `dataset-v3-schema.js`, `dataset-v4-schema.js`, `dataset-v5-schema.js`, `dataset-v6-schema.js` |
| `scripts/ai` | 7 | `framework-runtime-config.js`, `normalized-failure.js`, `project-knowledge-config.js`, `project-profile.js`, `repository-root.js`, `requirement-artifact.js`, `test-design.js` |
| `scripts/ai/generation` | 8 | `automation-candidate.js`, `automation-plan.js`, `cross-model-validation.js`, `errors.js`, `limits.js`, `primitives.js`, `requirement-model.js`, `test-case-model.js` |
| `scripts/ai/generative-test-design` | 3 | `test-design-review-canonical.js`, `test-design-review-package.js`, `test-design-review-record.js` |
| `scripts/ai/knowledge` | 1 | `schema.js` |
| `scripts/ai/providers` | 2 | `provider-contract.js`, `provider-error.js` |
| `scripts/ai/test-automation` | 6 | `applied-change-set-record.js`, `automation-execution-record.js`, `generated-change-set-review-canonical.js`, `generated-change-set-review-package.js`, `generated-change-set-review-record.js`, `generated-change-set.js` |
| `scripts/governance` | 1 | `framework-metadata.js` |
| `scripts/governance/kernel` | 6 | `contracts.js`, `graph.js`, `json-strict.js`, `manifest.js`, `results.js`, `validation.js` |
| `scripts/governance/stages/1c` | 1 | `result-contract.js` |

#### 4.3 BOUNDARY_SUPPORT (78)

| Directory | Count | Files |
|---|---:|---|
| `(root)` | 4 | `.npmrc`, `cypress.config.js`, `package-lock.json`, `playwright.config.js` |
| `scripts/ai` | 8 | `agent-policy.js`, `config.js`, `context-utils.js`, `correlation-projection.js`, `qa-agent-prompt.js`, `requirement-quality.js`, `requirement-traceability.js`, `runtime-framework-selector.js` |
| `scripts/ai/evaluation` | 7 | `execution-policy.js`, `scoring-v2.js`, `scoring-v3.js`, `scoring-v4.js`, `scoring-v5.js`, `scoring-v6.js`, `scoring.js` |
| `scripts/ai/generative-test-design` | 3 | `automation-candidate-prompt.js`, `test-case-model-prompt.js`, `test-design-prompt.js` |
| `scripts/ai/knowledge` | 1 | `selector.js` |
| `scripts/ai/knowledge/units` | 6 | `ci-job-isolation-runner-state.json`, `cross-browser-differing-signature-caution.json`, `framework-cypress-command-retry-ability-scope.json`, `framework-cypress-retry-timeout-semantics.json`, `project-firefox-execution-environment-split.json`, `qa-timeout-error-multiple-causes.json` |
| `scripts/ai/providers` | 2 | `index.js`, `mock-provider.js` |
| `scripts/ai/test-automation` | 2 | `automation-plan-prompt.js`, `generate-change-set-prompt.js` |
| `scripts/diagnostics` | 2 | `firefox-failure-forensics.sh`, `reset-cypress-runtime-outputs.sh` |
| `scripts/governance/kernel` | 4 | `completeness.js`, `graph-fingerprint.js`, `readiness.js`, `revalidation.js` |
| `scripts/governance/safety` | 5 | `path-patterns.js`, `path.js`, `process.js`, `redaction.js`, `repo-path.js` |
| `scripts/governance/stages/1a` | 5 | `changed-files.js`, `identity.js`, `policy.js`, `scope.js`, `secrets.js` |
| `scripts/governance/stages/1b` | 4 | `check.js`, `ids.js`, `markdown.js`, `slug.js` |
| `scripts/governance/stages/1c` | 2 | `config.js`, `evidence.js` |
| `scripts/governance/stages/1d` | 2 | `config.js`, `consistency.js` |
| `scripts/governance/stages/1e` | 3 | `delta-review.js`, `fingerprint.js`, `regions.js` |
| `scripts/governance/stages/1f` | 4 | `ci-classify.js`, `render-markdown.js`, `report.js`, `required-jobs.js` |
| `scripts/governance/stages` | 1 | `common.js` |
| `scripts/targets/project-b` | 7 | `aggregate-browser-context.js`, `analyze-failure.js`, `collect-context.js`, `collect-history.js`, `framework-runtime-config.js`, `project-knowledge-config.js`, `project-profile.js` |
| `scripts/targets/targomo` | 6 | `aggregate-browser-context.js`, `analyze-failure.js`, `collect-context.js`, `collect-history.js`, `project-profile.js`, `repository-root.js` |

#### 4.4 TEST / FIXTURE (226)

| Directory | Count | Files |
|---|---:|---|
| `cypress/e2e/pageObjects` | 4 | `categories.js`, `map.js`, `navigation.js`, `subCategories.js` |
| `cypress/e2e/tests` | 3 | `category_tree_behavior.cy.js`, `poi_data_requests.cy.js`, `select_group_POI.cy.js` |
| `cypress/support` | 1 | `e2e.js` |
| `playwright/tests` | 1 | `smoke.spec.js` |
| `scripts/ai/__fixtures__` | 1 | `playwright-real-report.json` |
| `scripts/ai/__fixtures__/playwright-reporter-proof` | 2 | `playwright.config.js`, `proof.spec.js` |
| `scripts/ai/adapters` | 2 | `cypress-runtime-config.test.js`, `playwright-runtime-config.test.js` |
| `scripts/ai` | 36 | `agent-policy.test.js`, `aggregate-browser-context.test.js`, `analyze-failure.test.js`, `architecture-boundary.test.js`, `collect-context-runcli.test.js`, `collect-context.test.js`, `collect-history-runtime-config.test.js`, `collect-history.test.js`, `config.test.js`, `context-utils.test.js`, `correlation-projection.test.js`, `cypress-adapter.test.js`, `cypress-equivalence.test.js`, `format-pr-comment.test.js`, `framework-runtime-config.test.js`, `index.test.js`, `normalized-failure.test.js`, `package-boundary.test.js`, `playwright-adapter.test.js`, `pr-comment-client.test.js`, `project-knowledge-config.test.js`, `project-knowledge-consumer-wiring.test.js`, `project-portability.test.js`, `project-profile.test.js`, `qa-agent-prompt.test.js`, `repository-root-portability.test.js`, `repository-root.test.js`, `requirement-artifact.test.js`, `requirement-quality.test.js`, `requirement-traceability.test.js`, `requirements-file.test.js`, `requirements-source-provider.test.js`, `runtime-framework-selector.test.js`, `test-design-publishing.test.js`, `test-design.test.js`, `write-authority.test.js` |
| `scripts/ai/destinations` | 1 | `azure-devops-test-case-destination.test.js` |
| `scripts/ai/evaluation` | 43 | `baseline-schema.test.js`, `baseline-v1.json`, `baseline-v2-schema.test.js`, `baseline-v2.json`, `baseline-v3-schema.test.js`, `baseline-v3.json`, `baseline-v4-schema.test.js`, `baseline-v4.json`, `baseline-v5-schema.test.js`, `baseline-v5.json`, `baseline-v6-schema.test.js`, `baseline-v6.json`, `dataset-schema.test.js`, `dataset-v2-schema.test.js`, `dataset-v2.json`, `dataset-v3-schema.test.js`, `dataset-v3.json`, `dataset-v4-schema.test.js`, `dataset-v4.json`, `dataset-v5-schema.test.js`, `dataset-v5.json`, `dataset-v6-schema.test.js`, `dataset-v6.json`, `dataset.json`, `evaluate-v2.test.js`, `evaluate-v3.test.js`, `evaluate-v4.test.js`, `evaluate-v5.test.js`, `evaluate-v6.test.js`, `evaluate.test.js`, `execution-policy.test.js`, `regression-v2.test.js`, `regression-v3.test.js`, `regression-v4.test.js`, `regression-v5.test.js`, `regression-v6.test.js`, `regression.test.js`, `scoring-v2.test.js`, `scoring-v3.test.js`, `scoring-v4.test.js`, `scoring-v5.test.js`, `scoring-v6.test.js`, `scoring.test.js` |
| `scripts/ai/generation` | 7 | `automation-candidate.test.js`, `automation-plan.test.js`, `cross-model-validation.test.js`, `primitives.test.js`, `requirement-model.test.js`, `security.test.js`, `test-case-model.test.js` |
| `scripts/ai/generative-test-design` | 10 | `automation-candidate-generator.test.js`, `automation-candidate-prompt.test.js`, `evidence-ingestion.test.js`, `requirement-model-generator.test.js`, `test-case-model-generator.test.js`, `test-case-model-prompt.test.js`, `test-design-prompt.test.js`, `test-design-review-canonical.test.js`, `test-design-review-package.test.js`, `test-design-review-record.test.js` |
| `scripts/ai/knowledge` | 4 | `loader-project-knowledge.test.js`, `loader.test.js`, `schema.test.js`, `selector.test.js` |
| `scripts/ai/providers` | 8 | `azure-devops-requirements-provider.test.js`, `gemini-provider.test.js`, `groq-provider.test.js`, `index.test.js`, `jira-requirements-provider.test.js`, `mock-provider.test.js`, `provider-contract.test.js`, `provider-error.test.js` |
| `scripts/ai/test-automation` | 12 | `applied-change-set-record.test.js`, `automation-execution-record.test.js`, `automation-plan-generator.test.js`, `automation-repository-context.test.js`, `change-set-application.test.js`, `controlled-execution.test.js`, `generate-change-set.test.js`, `generated-change-set-review-canonical.test.js`, `generated-change-set-review-package.test.js`, `generated-change-set-review-record.test.js`, `generated-change-set.test.js`, `regenerate-change-set.test.js` |
| `scripts/diagnostics` | 3 | `audit-drift-check.test.js`, `branch-inventory.test.js`, `firefox-failure-forensics.test.js` |
| `scripts/governance/__fixtures__/wave0/manifests` | 11 | `cycle.json`, `disabled-dependency.json`, `duplicate-domain.json`, `malformed-capability.json`, `missing-dependsOn.json`, `schema-version-0.json`, `schema-version-01.json`, `schema-version-1.0.json`, `schema-version-string.json`, `unknown-field.json`, `valid-minimal.json` |
| `scripts/governance` | 15 | `adversarial.test.js`, `test-support-git.js`, `test-support.js`, `wave1-c1.test.js`, `wave1-c2.test.js`, `wave1.test.js`, `wave2.test.js`, `wave3.test.js`, `wave4.test.js`, `wave5-c1.test.js`, `wave5-c2.test.js`, `wave5-c3.test.js`, `wave5-c4.test.js`, `wave5-c5.test.js`, `wave5-c6.test.js` |
| `scripts/governance/io` | 1 | `manifest-loader.test.js` |
| `scripts/governance/kernel` | 5 | `graph.test.js`, `manifest.test.js`, `results-readiness.test.js`, `revalidation.test.js`, `validation.test.js` |
| `scripts/governance/safety` | 4 | `path-patterns.test.js`, `path.test.js`, `process.test.js`, `redaction.test.js` |
| `scripts/governance/stages/1a` | 7 | `changed-files.test.js`, `git-adapter.test.js`, `identity.test.js`, `policy.test.js`, `scope.test.js`, `secrets.test.js`, `trusted-context.test.js` |
| `scripts/governance/stages/1b` | 2 | `check.test.js`, `markdown.test.js` |
| `scripts/governance/stages/1c` | 2 | `evidence.test.js`, `result-contract.test.js` |
| `scripts/governance/stages/1d` | 1 | `consistency.test.js` |
| `scripts/governance/stages/1e` | 3 | `delta-review.test.js`, `fingerprint.test.js`, `regions.test.js` |
| `scripts/governance/stages/1f` | 10 | `ci-classify.test.js`, `ci-evidence.test.js`, `ci-run-evidence.test.js`, `ci-run.test.js`, `cli.test.js`, `determination.test.js`, `render-markdown.test.js`, `report.test.js`, `required-jobs.test.js`, `two-phase.test.js` |
| `scripts/targets/project-b` | 1 | `project-b-portability.test.js` |
| `scripts/targets/targomo` | 7 | `aggregate-browser-context.test.js`, `analyze-failure.test.js`, `collect-context.test.js`, `collect-history.test.js`, `project-profile.test.js`, `qa-agent-prompt.test.js`, `repository-root.test.js` |
| `test/helpers` | 1 | `http-test-server.js` |
| `test/installation` | 3 | `external-repository-proof-fail-closed.test.js`, `external-repository-proof.test.js`, `package-surface.test.js` |
| `test/security/aisec-7` | 8 | `enablement-surface.test.js`, `evidence-completeness.test.js`, `harness-invariants.test.js`, `hostile-model-output.test.js`, `review-apply-execute.test.js`, `source-destination.test.js`, `triage-cross-project.test.js`, `trust-evidence.test.js` |
| `test/security/aisec-7/lib` | 7 | `evidence-manifest.js`, `evidence-reporter.js`, `evidence-run.js`, `execution-ledger.js`, `fixtures.js`, `outcomes.js`, `registry.js` |

#### 4.5 NO_RELEVANT_BOUNDARY (33)

| Directory | Count | Files |
|---|---:|---|
| `.github/ISSUE_TEMPLATE` | 3 | `bug_report.yml`, `config.yml`, `feature_request.yml` |
| `.github` | 2 | `dependabot.yml`, `pull_request_template.md` |
| `(root)` | 9 | `.gitignore`, `.nvmrc`, `LICENSE`, `PROVIDERS.md`, `PUBLISHING.md`, `README.md`, `ROADMAP.md`, `SECURITY.md`, `TEST_CASES.md` |
| `docs` | 19 | `agentic-security-verification-strategy-v1.md`, `agentic-threat-model-v1.md`, `aisec-7-adversarial-security-test-harness-v1.md`, `architecture-model-boundary-v1.md`, `architecture-model-boundary-v2.md`, `branch-inventory-v1.md`, `controlled-v1-release-model-owner-decision-v1.md`, `data-exfiltration-cross-project-isolation-v1.md`, `evaluation-execution-policy-v1.md`, `gov-auto-1-design-reconciliation-v1.md`, `governance-process-v1.md`, `governance-process-v2.md`, `governance-process-v3.md`, `package-surface-v1.md`, `package-surface-v2.md`, `prompt-indirect-injection-study-v1.md`, `qa-generation-contracts-v1.md`, `security-architecture-decision-record-v1.md`, `tool-privilege-credential-boundary-analysis-v1.md` |

#### 4.6 UNKNOWN — REVIEW REQUIRED (0)

None.

**Classification rules.**

| Class | What it covers |
|---|---|
| `BOUNDARY_SURFACE` | Modules or files where external, caller, model, provider, filesystem, environment or CI data enters, or where an authority-bearing effect is exercised: write, spawn, network, publish, PR comment. Also `package.json` (the `exports`/`files` API surface) and the workflows. |
| `CONTRACT_MODEL` | Files that define a versioned or validated data contract, schema, digest canonicalization or error vocabulary. |
| `BOUNDARY_SUPPORT` | Helpers, prompt builders, policy, selectors, target bootstraps/config instances, the runtime knowledge corpus, the runner config files, and lockfile/registry config. |
| `TEST / FIXTURE` | All `*.test.js`, `__fixtures__`, `test/**`, the governance test-support modules, the evaluation datasets/baselines, and the system-under-test suites under `cypress/` and `playwright/`. |
| `NO_RELEVANT_BOUNDARY` | Documentation, licence, templates and repository metadata with no runtime type boundary. |

## 5. File coverage map

Each relevant non-test file maps to the boundary IDs of §8. Tests and fixtures are mapped to the boundaries they substantiate in §18.

| File | Class | Boundary IDs |
|---|---|---|
| `.github/workflows/cypress.yml` | BOUNDARY_SURFACE | TSB-023, TSB-024, TSB-041, TSB-044 |
| `.github/workflows/dependency-review.yml` | BOUNDARY_SURFACE | TSB-045 |
| `.github/workflows/supply-chain-audit.yml` | BOUNDARY_SURFACE | TSB-045 |
| `.npmrc` | BOUNDARY_SUPPORT | TSB-045 |
| `cypress.config.js` | BOUNDARY_SUPPORT | TSB-012 |
| `package-lock.json` | BOUNDARY_SUPPORT | TSB-045 |
| `package.json` | BOUNDARY_SURFACE | TSB-033 |
| `playwright.config.js` | BOUNDARY_SUPPORT | TSB-012 |
| `scripts/ai/adapters/cypress-adapter.js` | BOUNDARY_SURFACE | TSB-032 |
| `scripts/ai/adapters/playwright-adapter.js` | BOUNDARY_SURFACE | TSB-032 |
| `scripts/ai/agent-policy.js` | BOUNDARY_SUPPORT | TSB-017 |
| `scripts/ai/aggregate-browser-context.js` | BOUNDARY_SURFACE | TSB-039 |
| `scripts/ai/analyze-failure.js` | BOUNDARY_SURFACE | TSB-001, TSB-017, TSB-037, TSB-038 |
| `scripts/ai/collect-context.js` | BOUNDARY_SURFACE | TSB-024, TSB-032, TSB-036 |
| `scripts/ai/collect-history.js` | BOUNDARY_SURFACE | TSB-024, TSB-038 |
| `scripts/ai/config.js` | BOUNDARY_SUPPORT | TSB-023 |
| `scripts/ai/context-utils.js` | BOUNDARY_SUPPORT | TSB-022, TSB-032, TSB-037 |
| `scripts/ai/correlation-projection.js` | BOUNDARY_SUPPORT | TSB-037, TSB-039 |
| `scripts/ai/destinations/azure-devops-test-case-destination.js` | BOUNDARY_SURFACE | TSB-031 |
| `scripts/ai/evaluation/baseline-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/baseline-v2-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/baseline-v3-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/baseline-v4-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/baseline-v5-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/baseline-v6-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/dataset-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/dataset-v2-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/dataset-v3-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/dataset-v4-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/dataset-v5-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/dataset-v6-schema.js` | CONTRACT_MODEL | TSB-044 |
| `scripts/ai/evaluation/evaluate-v2.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/evaluate-v3.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/evaluate-v4.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/evaluate-v5.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/evaluate-v6.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/evaluate.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/execution-policy.js` | BOUNDARY_SUPPORT | TSB-044 |
| `scripts/ai/evaluation/regression-v2.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/regression-v3.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/regression-v4.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/regression-v5.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/regression-v6.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/regression.js` | BOUNDARY_SURFACE | TSB-044 |
| `scripts/ai/evaluation/scoring-v2.js` | BOUNDARY_SUPPORT | TSB-044 |
| `scripts/ai/evaluation/scoring-v3.js` | BOUNDARY_SUPPORT | TSB-044 |
| `scripts/ai/evaluation/scoring-v4.js` | BOUNDARY_SUPPORT | TSB-044 |
| `scripts/ai/evaluation/scoring-v5.js` | BOUNDARY_SUPPORT | TSB-044 |
| `scripts/ai/evaluation/scoring-v6.js` | BOUNDARY_SUPPORT | TSB-044 |
| `scripts/ai/evaluation/scoring.js` | BOUNDARY_SUPPORT | TSB-044 |
| `scripts/ai/format-pr-comment.js` | BOUNDARY_SURFACE | TSB-041 |
| `scripts/ai/framework-runtime-config.js` | CONTRACT_MODEL | TSB-019 |
| `scripts/ai/generation/automation-candidate.js` | CONTRACT_MODEL | TSB-004 |
| `scripts/ai/generation/automation-plan.js` | CONTRACT_MODEL | TSB-005, TSB-008, TSB-009 |
| `scripts/ai/generation/cross-model-validation.js` | CONTRACT_MODEL | TSB-003, TSB-004 |
| `scripts/ai/generation/errors.js` | CONTRACT_MODEL | TSB-002..TSB-008 |
| `scripts/ai/generation/limits.js` | CONTRACT_MODEL | TSB-002..TSB-008 |
| `scripts/ai/generation/primitives.js` | CONTRACT_MODEL | TSB-002..TSB-008 |
| `scripts/ai/generation/requirement-model.js` | CONTRACT_MODEL | TSB-002 |
| `scripts/ai/generation/test-case-model.js` | CONTRACT_MODEL | TSB-003 |
| `scripts/ai/generative-test-design/automation-candidate-generator.js` | BOUNDARY_SURFACE | TSB-004 |
| `scripts/ai/generative-test-design/automation-candidate-prompt.js` | BOUNDARY_SUPPORT | TSB-004 |
| `scripts/ai/generative-test-design/evidence-ingestion.js` | BOUNDARY_SURFACE | TSB-002 |
| `scripts/ai/generative-test-design/requirement-model-generator.js` | BOUNDARY_SURFACE | TSB-002 |
| `scripts/ai/generative-test-design/test-case-model-generator.js` | BOUNDARY_SURFACE | TSB-003 |
| `scripts/ai/generative-test-design/test-case-model-prompt.js` | BOUNDARY_SUPPORT | TSB-003 |
| `scripts/ai/generative-test-design/test-design-prompt.js` | BOUNDARY_SUPPORT | TSB-002 |
| `scripts/ai/generative-test-design/test-design-review-canonical.js` | CONTRACT_MODEL | TSB-016 |
| `scripts/ai/generative-test-design/test-design-review-package.js` | CONTRACT_MODEL | TSB-016 |
| `scripts/ai/generative-test-design/test-design-review-record.js` | CONTRACT_MODEL | TSB-016 |
| `scripts/ai/index.js` | BOUNDARY_SURFACE | TSB-033, TSB-034, TSB-035, TSB-036 |
| `scripts/ai/knowledge/loader.js` | BOUNDARY_SURFACE | TSB-021 |
| `scripts/ai/knowledge/schema.js` | CONTRACT_MODEL | TSB-021 |
| `scripts/ai/knowledge/selector.js` | BOUNDARY_SUPPORT | TSB-021 |
| `scripts/ai/knowledge/units/ci-job-isolation-runner-state.json` | BOUNDARY_SUPPORT | TSB-021 |
| `scripts/ai/knowledge/units/cross-browser-differing-signature-caution.json` | BOUNDARY_SUPPORT | TSB-021 |
| `scripts/ai/knowledge/units/framework-cypress-command-retry-ability-scope.json` | BOUNDARY_SUPPORT | TSB-021 |
| `scripts/ai/knowledge/units/framework-cypress-retry-timeout-semantics.json` | BOUNDARY_SUPPORT | TSB-021 |
| `scripts/ai/knowledge/units/project-firefox-execution-environment-split.json` | BOUNDARY_SUPPORT | TSB-021 |
| `scripts/ai/knowledge/units/qa-timeout-error-multiple-causes.json` | BOUNDARY_SUPPORT | TSB-021 |
| `scripts/ai/normalized-failure.js` | CONTRACT_MODEL | TSB-032 |
| `scripts/ai/pr-comment-client.js` | BOUNDARY_SURFACE | TSB-041 |
| `scripts/ai/project-knowledge-config.js` | CONTRACT_MODEL | TSB-020 |
| `scripts/ai/project-profile.js` | CONTRACT_MODEL | TSB-018 |
| `scripts/ai/providers/azure-devops-requirements-provider.js` | BOUNDARY_SURFACE | TSB-029 |
| `scripts/ai/providers/gemini-provider.js` | BOUNDARY_SURFACE | TSB-027 |
| `scripts/ai/providers/groq-provider.js` | BOUNDARY_SURFACE | TSB-027 |
| `scripts/ai/providers/index.js` | BOUNDARY_SUPPORT | TSB-023, TSB-026 |
| `scripts/ai/providers/jira-requirements-provider.js` | BOUNDARY_SURFACE | TSB-028 |
| `scripts/ai/providers/mock-provider.js` | BOUNDARY_SUPPORT | TSB-026 |
| `scripts/ai/providers/provider-contract.js` | CONTRACT_MODEL | TSB-026 |
| `scripts/ai/providers/provider-error.js` | CONTRACT_MODEL | TSB-026 |
| `scripts/ai/qa-agent-prompt.js` | BOUNDARY_SUPPORT | TSB-001, TSB-018, TSB-037 |
| `scripts/ai/repository-root.js` | CONTRACT_MODEL | TSB-022 |
| `scripts/ai/requirement-artifact.js` | CONTRACT_MODEL | TSB-034 |
| `scripts/ai/requirement-quality.js` | BOUNDARY_SUPPORT | TSB-035 |
| `scripts/ai/requirement-traceability.js` | BOUNDARY_SUPPORT | TSB-035 |
| `scripts/ai/requirements-file.js` | BOUNDARY_SURFACE | TSB-034 |
| `scripts/ai/requirements-source-provider.js` | BOUNDARY_SURFACE | TSB-030 |
| `scripts/ai/runtime-framework-selector.js` | BOUNDARY_SUPPORT | TSB-024, TSB-036 |
| `scripts/ai/test-automation/applied-change-set-record.js` | CONTRACT_MODEL | TSB-010, TSB-011 |
| `scripts/ai/test-automation/automation-execution-record.js` | CONTRACT_MODEL | TSB-013 |
| `scripts/ai/test-automation/automation-plan-generator.js` | BOUNDARY_SURFACE | TSB-005 |
| `scripts/ai/test-automation/automation-plan-prompt.js` | BOUNDARY_SUPPORT | TSB-005 |
| `scripts/ai/test-automation/automation-repository-context.js` | BOUNDARY_SURFACE | TSB-005, TSB-006, TSB-018 |
| `scripts/ai/test-automation/change-set-application.js` | BOUNDARY_SURFACE | TSB-010, TSB-040 |
| `scripts/ai/test-automation/controlled-execution.js` | BOUNDARY_SURFACE | TSB-011, TSB-012 |
| `scripts/ai/test-automation/generate-change-set-prompt.js` | BOUNDARY_SUPPORT | TSB-006, TSB-007 |
| `scripts/ai/test-automation/generate-change-set.js` | BOUNDARY_SURFACE | TSB-006 |
| `scripts/ai/test-automation/generated-change-set-review-canonical.js` | CONTRACT_MODEL | TSB-014, TSB-015 |
| `scripts/ai/test-automation/generated-change-set-review-package.js` | CONTRACT_MODEL | TSB-014 |
| `scripts/ai/test-automation/generated-change-set-review-record.js` | CONTRACT_MODEL | TSB-015 |
| `scripts/ai/test-automation/generated-change-set.js` | CONTRACT_MODEL | TSB-008, TSB-009 |
| `scripts/ai/test-automation/regenerate-change-set.js` | BOUNDARY_SURFACE | TSB-007 |
| `scripts/ai/test-design-publishing.js` | BOUNDARY_SURFACE | TSB-031 |
| `scripts/ai/test-design.js` | CONTRACT_MODEL | TSB-035 |
| `scripts/diagnostics/audit-drift-check.js` | BOUNDARY_SURFACE | TSB-045 |
| `scripts/diagnostics/branch-inventory.js` | BOUNDARY_SURFACE | TSB-045 |
| `scripts/diagnostics/firefox-failure-forensics.sh` | BOUNDARY_SUPPORT | TSB-032 |
| `scripts/diagnostics/reset-cypress-runtime-outputs.sh` | BOUNDARY_SUPPORT | TSB-032 |
| `scripts/governance/framework-metadata.js` | CONTRACT_MODEL | TSB-042 |
| `scripts/governance/index.js` | BOUNDARY_SURFACE | TSB-042, TSB-043 |
| `scripts/governance/io/manifest-loader.js` | BOUNDARY_SURFACE | TSB-042 |
| `scripts/governance/kernel/completeness.js` | BOUNDARY_SUPPORT | TSB-042, TSB-043 |
| `scripts/governance/kernel/contracts.js` | CONTRACT_MODEL | TSB-042, TSB-043 |
| `scripts/governance/kernel/graph-fingerprint.js` | BOUNDARY_SUPPORT | TSB-042, TSB-043 |
| `scripts/governance/kernel/graph.js` | CONTRACT_MODEL | TSB-042, TSB-043 |
| `scripts/governance/kernel/json-strict.js` | CONTRACT_MODEL | TSB-042, TSB-043 |
| `scripts/governance/kernel/manifest.js` | CONTRACT_MODEL | TSB-042, TSB-043 |
| `scripts/governance/kernel/readiness.js` | BOUNDARY_SUPPORT | TSB-042, TSB-043 |
| `scripts/governance/kernel/results.js` | CONTRACT_MODEL | TSB-042, TSB-043 |
| `scripts/governance/kernel/revalidation.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/kernel/validation.js` | CONTRACT_MODEL | TSB-042, TSB-043 |
| `scripts/governance/safety/path-patterns.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/safety/path.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/safety/process.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/safety/redaction.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/safety/repo-path.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1a/changed-files.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1a/git-adapter.js` | BOUNDARY_SURFACE | TSB-043 |
| `scripts/governance/stages/1a/identity.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1a/policy.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1a/scope.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1a/secrets.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1a/trusted-context.js` | BOUNDARY_SURFACE | TSB-043 |
| `scripts/governance/stages/1b/check.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1b/ids.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1b/markdown.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1b/slug.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1c/config.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1c/evidence.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1c/result-contract.js` | CONTRACT_MODEL | TSB-043 |
| `scripts/governance/stages/1d/config.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1d/consistency.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1e/delta-review.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1e/fingerprint.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1e/regions.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1f/ci-classify.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1f/ci-evidence.js` | BOUNDARY_SURFACE | TSB-043 |
| `scripts/governance/stages/1f/ci-run.js` | BOUNDARY_SURFACE | TSB-043 |
| `scripts/governance/stages/1f/cli.js` | BOUNDARY_SURFACE | TSB-025, TSB-043 |
| `scripts/governance/stages/1f/determination.js` | BOUNDARY_SURFACE | TSB-043 |
| `scripts/governance/stages/1f/render-markdown.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1f/report.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/1f/required-jobs.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/common.js` | BOUNDARY_SUPPORT | TSB-043 |
| `scripts/governance/stages/head-reader.js` | BOUNDARY_SURFACE | TSB-043 |
| `scripts/targets/project-b/aggregate-browser-context.js` | BOUNDARY_SUPPORT | TSB-039 |
| `scripts/targets/project-b/analyze-failure.js` | BOUNDARY_SUPPORT | TSB-001, TSB-037 |
| `scripts/targets/project-b/collect-context.js` | BOUNDARY_SUPPORT | TSB-036 |
| `scripts/targets/project-b/collect-history.js` | BOUNDARY_SUPPORT | TSB-024, TSB-038 |
| `scripts/targets/project-b/framework-runtime-config.js` | BOUNDARY_SUPPORT | TSB-019 |
| `scripts/targets/project-b/project-knowledge-config.js` | BOUNDARY_SUPPORT | TSB-020 |
| `scripts/targets/project-b/project-profile.js` | BOUNDARY_SUPPORT | TSB-018 |
| `scripts/targets/targomo/aggregate-browser-context.js` | BOUNDARY_SUPPORT | TSB-039 |
| `scripts/targets/targomo/analyze-failure.js` | BOUNDARY_SUPPORT | TSB-001, TSB-037 |
| `scripts/targets/targomo/collect-context.js` | BOUNDARY_SUPPORT | TSB-036 |
| `scripts/targets/targomo/collect-history.js` | BOUNDARY_SUPPORT | TSB-024, TSB-038 |
| `scripts/targets/targomo/project-profile.js` | BOUNDARY_SUPPORT | TSB-018 |
| `scripts/targets/targomo/repository-root.js` | BOUNDARY_SUPPORT | TSB-022 |

Coverage check: 180 relevant non-test files (BOUNDARY_SURFACE + CONTRACT_MODEL + BOUNDARY_SUPPORT), 180 mapped to at least one boundary, 0 unmapped.

## 6. Trust-boundary inventory

| Zone | Entry examples | Default trust | Boundaries |
|---|---|---|---|
| Z1 Model/provider output | Groq/Gemini/Mock `analyze()` string | Untrusted | TSB-001..007, 026, 027 |
| Z2 External requirement sources | Jira / Azure DevOps REST payloads; caller `RequirementsSourceProvider` output | Untrusted | TSB-028..030 |
| Z3 External destinations | `TestDesignDestination.publish()` result; Azure DevOps responses | Untrusted (result); credentialed side effect | TSB-031 |
| Z4 Generated proposals and records | GeneratedChangeSet, review package/record, AppliedChangeSetRecord, AutomationExecutionRecord | Caller-constructible; self-digested (unkeyed) | TSB-008..016 |
| Z5 Filesystem / repository | `repositoryRoot`, runner reports, `relevantFiles`, knowledge units, requirements files, target files at apply time | Caller-trusted root; contents untrusted | TSB-010, 012, 021, 022, 032, 034 |
| Z6 Persisted / transported artifacts | `reports/ai/context.json`, `history.json`, cross-job browser artifacts, `ai-report.json` | Portable, caller/PR-code writable | TSB-037..041 |
| Z7 Operator configuration | ProjectProfile, FrameworkRuntimeConfig, ProjectKnowledgeConfig | Operator-owned, unauthenticated | TSB-018..020 |
| Z8 Environment / process | `AI_*`, `GITHUB_*`, `HISTORY_*`, `QA_FRAMEWORK`, `TEST_BROWSER`, CLI argv | Ambient; workflow- or operator-controlled | TSB-023..025 |
| Z9 CI / governance evidence | Workflow steps, governance manifests, CI run evidence, evaluation datasets, audit JSON, AISEC-7 ledgers | Mixed; platform claims caller-supplied | TSB-041..046 |
| Z10 Public package API | `require("qa-ai-agent")` exports and subpath exports | External caller | TSB-033..036 |

## 7. Contract-surface inventory

In the table below:

- **Closed** means unknown keys are rejected.
- **Accessor-safe** means validation reads data descriptors or a snapshot, so getters cannot change values between checks.
- **Frozen/snapshot** means the validated value is copied or frozen before use.
- **Self-digest** means the object carries a digest of its own content. Every self-digest in this repository is unkeyed.

| Contract | Validator / builder | Closed | Bounded | Accessor-safe | Frozen / snapshot | Self-digest | Public export |
|---|---|---|---|---|---|---|---|
| Triage analysis result (implicit) | `validateAnalysisItem` | **No** | **No** | n/a (`JSON.parse` output) | No | No | Via `analyzeFailure.main` output |
| ProjectProfile | `validateProjectProfile` / `assertValidProjectProfile` | **No** | **No** | **No** | **No** (returns caller object) | No | **Yes** |
| FrameworkRuntimeConfig | `validateFrameworkRuntimeConfig` | Yes | Yes | Yes | Returns caller object (data-only) | No | Yes |
| ProjectKnowledgeConfig | `validateProjectKnowledgeConfig` | Yes | Yes | Yes | Returns caller object (data-only) | No | Yes |
| repositoryRoot | `validateRepositoryRoot` | n/a | Control chars rejected | n/a | Resolved `{lexicalRoot, realRoot}` | No | Yes |
| RequirementArtifact | `validateRequirementArtifact` | Yes | Yes | Yes | Frozen by file/provider loaders | No | Yes |
| Requirements file v1 | `loadRequirementsFromFile` | Yes | Yes (5 MiB) | n/a | Frozen | No | Yes |
| TestDesignArtifact | `assertValidTestDesignArtifact` | Yes | Yes | Yes | Yes | No | Yes |
| TestDesign publish request/result | `test-design-publishing.js` | Yes | Yes | Yes | Frozen canonical copies | No | Yes |
| Knowledge unit | `validateKnowledgeUnit` | **No** | **No** | No | No (projected `{id, statement}` only) | No | No |
| RequirementModel / TestCaseModel / AutomationCandidate / AutomationPlan v1 | `generation/*.js` | Yes | Yes | Snapshot in generators | Yes (generators) | No | No |
| GeneratedChangeSet v1 | `buildGeneratedChangeSet` | Yes | Yes | Yes | Yes | Yes | No |
| GeneratedChangeSet v1 (validation) | `validateGeneratedChangeSet` | **No** | **No** | Snapshot | Snapshot | Recomputed only | No |
| GCS review package | `buildGeneratedChangeSetReviewPackage` | Derived | Yes | Yes | Yes | Yes | No |
| GCS review record | `buildGeneratedChangeSetReviewRecord` | Yes | Yes | Yes | Yes | Yes | No |
| GCS approval gate | `validateApprovedGeneratedChangeSetReview` | **No** (digest + status only) | n/a | Snapshot | Snapshot | Recomputed only | No |
| TestDesign review record / gate | `buildTestDesignReviewRecord` / `validateApprovedTestDesignReview` | Build yes; gate **no** | Yes | Build yes | Build yes | Yes | No |
| AppliedChangeSetRecord v1 | `buildAppliedChangeSetRecord` | Yes | Yes | Yes | Yes | Yes | No |
| AppliedChangeSetRecord (execution consumption) | `executeAppliedChangeSet` | **No** (digest + status + non-empty) | n/a | Snapshot | Snapshot | Recomputed only | No |
| AutomationExecutionRecord v1 | `buildAutomationExecutionRecord` | Yes | Yes (output caps) | Yes | Yes | Yes | No |
| Governance manifest | `parseStrictJson` + `validateManifest` | Yes | Yes (bytes, depth) | Null-prototype tree | Yes | Fingerprints | Internal |
| Governance CLI argv | `parseArgs` | Yes (allow-list) | Yes | n/a | n/a | n/a | Internal |
| Evaluation dataset/baseline v1–v5 | `*-schema.js` | **No** | Partial | n/a | n/a | No | No (excluded from package) |
| Evaluation dataset/baseline v6 | `dataset-v6-schema.js`, `baseline-v6-schema.js` | Yes | Yes | n/a | n/a | No | No |

## 8. Boundary matrix

The matrix is split into three tables keyed by the same IDs.

- **Status key:** `PASS` = affirmatively evidenced for the boundary's material properties. `PARTIAL` = some material property is unevidenced or absent while others are enforced. `GAP` = a declared or required material invariant is not enforced.
- **Controlled-v1 abbreviations:**
  - **RC** = Release Contract capability.
  - **APPLY** = generated-change safe application (#23F).
  - **EXEC** = controlled execution (#23G).
  - **TRIAGE** = CI failure triage / PR reporting.

### 8A. Identity, input and static contract

| ID | Boundary | Files | Symbol / module | Input / source | Caller / attacker control | Entry trust | Static contract |
|---|---|---|---|---|---|---|---|
| TSB-001 | Triage model output → report | `analyze-failure.js`, `agent-policy.js`, `qa-agent-prompt.js` | `runProviderAnalysis`, `validateAnalysisItem`, `buildFailureReport` | Provider response string | Model; prompt-influenced by failure text (PI-03/04) | Untrusted | Prompt rules + rule 7 (`:90`); no schema module |
| TSB-002 | RequirementModel generation | `requirement-model-generator.js`, `generation/requirement-model.js`, `evidence-ingestion.js`, `test-design-prompt.js` | Generator + `validateRequirementModel` | Provider string | Model | Untrusted | RequirementModel v1 |
| TSB-003 | TestCaseModel generation | `test-case-model-generator.js`, `generation/test-case-model.js`, `cross-model-validation.js` | Generator + validators | Provider string | Model | Untrusted | TestCaseModel v1 |
| TSB-004 | AutomationCandidate generation | `automation-candidate-generator.js`, `generation/automation-candidate.js` | `validateCandidateBinding` / `FrameworkAuthorization` / `EvidenceProvenance` | Provider string | Model | Untrusted | AutomationCandidate v1 |
| TSB-005 | AutomationPlan generation | `automation-plan-generator.js`, `generation/automation-plan.js` | `validateAutomationPlan`, `validatePlanBinding` | Provider string | Model | Untrusted | AutomationPlan v1 |
| TSB-006 | Change-set generation | `generate-change-set.js` | `validateProviderChangesShape` → `buildGeneratedChangeSet` | Provider string | Model | Untrusted | `{operation,path,content}[]` |
| TSB-007 | Change-set regeneration | `regenerate-change-set.js` | Same as TSB-006, plus execution-feedback prompt | Provider string; prior execution stdout/stderr | Model; test output (PI-04) | Untrusted | Same as TSB-006 |
| TSB-008 | GeneratedChangeSet construction | `generated-change-set.js` | `buildGeneratedChangeSet` (`:415`) | Plan, context, changes | Caller / generator | Untrusted until built | GeneratedChangeSet v1 |
| TSB-009 | GeneratedChangeSet validation | `generated-change-set.js` | `validateGeneratedChangeSet` (`:576`), `recomputeChangeSetDigest` (`:624`) | Stored GeneratedChangeSet object | Caller / persistence | Untrusted | Same v1 contract (docstring) |
| TSB-010 | Approved change-set application | `change-set-application.js`, `applied-change-set-record.js` | `applyApprovedGeneratedChangeSet` (`:774`) | Plan, context, change set, review package, record, root | Library caller | Untrusted objects; caller-trusted root | #23F docstring |
| TSB-011 | Applied record → execution | `controlled-execution.js`, `applied-change-set-record.js` | `executeAppliedChangeSet` (`:619`) | Plan, change set, AppliedChangeSetRecord | Library caller | Untrusted objects | #23G docstring |
| TSB-012 | Execution process boundary | `controlled-execution.js`, `cypress.config.js`, `playwright.config.js` | `deriveExecutionTargets`, `selectExecutionCommand`, `runBoundedProcess` | Applied target paths; env | Approved content; operator env | Approved / ambient | Closed classifier per framework |
| TSB-013 | Execution record output | `automation-execution-record.js` | `buildAutomationExecutionRecord` | Internal execution result | Runner output text | Untrusted text, bounded | AutomationExecutionRecord v1 |
| TSB-014 | GCS review package | `generated-change-set-review-package.js`, `-review-canonical.js` | `buildGeneratedChangeSetReviewPackage` (`:112`) | Plan, context, change set | Caller | Untrusted | ReviewPackage v1 |
| TSB-015 | GCS review record and approval gate | `generated-change-set-review-record.js` | `buildGeneratedChangeSetReviewRecord`, `validateApprovedGeneratedChangeSetReview` (`:411`) | Reviewer decisions; stored record | Any library caller (identity opaque) | Untrusted | ReviewRecord v1 |
| TSB-016 | TestDesign review gate | `test-design-review-record.js`, `-package.js`, `-canonical.js` | `validateApprovedTestDesignReview` (`:306`) | Stored package and record | Caller | Untrusted | TestDesignReviewRecord v1 |
| TSB-017 | Triage action policy | `agent-policy.js` | `applyAgentPolicy` | Validated model result | Model (classification, flags) | Untrusted recommendation | "LLM proposes, application decides" |
| TSB-018 | ProjectProfile | `project-profile.js`, `scripts/targets/*/project-profile.js` | `validateProjectProfile` (`:48`), `assertValidProjectProfile` (`:78`) | Caller object | Operator / external consumer | Operator-owned, unauthenticated | `{id, displayName, knownProjectConstraints}` |
| TSB-019 | FrameworkRuntimeConfig | `framework-runtime-config.js`, targets | `validateFrameworkRuntimeConfig` | Caller object | Operator | Operator-owned | FPI-1 closed contract |
| TSB-020 | ProjectKnowledgeConfig | `project-knowledge-config.js`, targets | `validateProjectKnowledgeConfig` | Caller object | Operator | Operator-owned | FPI-1 closed contract |
| TSB-021 | Knowledge corpus | `knowledge/schema.js`, `loader.js`, `selector.js`, `knowledge/units/*.json` | `validateKnowledgeUnit`, `loadProjectKnowledgeUnits`, `selectKnowledge` | JSON files (core plus project dir) | Repository / project authors | Repository-trusted | Knowledge unit schema |
| TSB-022 | repositoryRoot | `repository-root.js`, `context-utils.js`, `change-set-application.js` | `validateRepositoryRoot`, `resolveRepositoryRoot` | Caller path string | Caller / orchestrator | Caller-trusted | Absolute existing directory |
| TSB-023 | AI provider environment | `config.js`, `providers/index.js`, `cypress.yml` | Module-level `PROVIDER`/`MODEL`/`API_KEY` (`config.js:20`) | `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` | Operator / workflow | Ambient | Closed provider-name switch |
| TSB-024 | Collector / history environment | `collect-context.js`, `collect-history.js`, `runtime-framework-selector.js` | `getMetadata`, history `main`, `selectRuntimeAdapter` | `GITHUB_*`, `HISTORY_*`, `QA_FRAMEWORK`, `TEST_BROWSER` | Operator / workflow | Ambient | Closed framework map; clamped run count |
| TSB-025 | Governance CLI argv | `stages/1f/cli.js` | `parseArgs` | argv | Operator | Untrusted | Allow-listed flags |
| TSB-026 | Provider object contract | `provider-contract.js`, `provider-error.js`, `providers/index.js`, `mock-provider.js` | `validateProvider`, `validateProviderResponse`, `createProvider` | Provider object and return value | Provider implementation | Code-reviewed implementation | `analyze({systemPrompt,userPrompt}) → Promise<string>` |
| TSB-027 | Groq / Gemini HTTP envelope | `groq-provider.js`, `gemini-provider.js` | `analyze` (`res.json()` at `:145` / `:170`) | HTTPS response | Provider service / network | Untrusted | Vendor envelope (choices / candidates) |
| TSB-028 | Jira source adapter | `jira-requirements-provider.js` | `assertValidJiraProviderConfig`, `jiraFetch`, `normalizeIssue` | Config; REST JSON (`:627`) | Operator config; issue authors | Untrusted payload | Closed config; ADF depth ≤ 64 |
| TSB-029 | Azure DevOps source adapter | `azure-devops-requirements-provider.js` | `assertValidAzureDevOpsProviderConfig`, `azureFetch`, `normalizeWorkItem` | Config; REST JSON (`:693`, `:785`) | Operator config; work-item authors | Untrusted payload | Closed config; HTML depth ≤ 64 |
| TSB-030 | Requirements source executor | `requirements-source-provider.js` | `loadRequirementsFromProvider` | Caller provider output | Provider implementation | Untrusted | RequirementArtifact[] |
| TSB-031 | Publishing executor and destination | `test-design-publishing.js`, `azure-devops-test-case-destination.js` | `publishTestDesigns`, destination `publish` | Designs; destination result | Caller config; remote service | Untrusted result | Closed request/result |
| TSB-032 | Runner report adapters | `adapters/*.js`, `normalized-failure.js`, `context-utils.js`, `scripts/diagnostics/*.sh` | Report readers, `walkSuite` | Cypress / Playwright JSON reports, screenshots | Test and application content | Untrusted | NormalizedFailure (implicit) |
| TSB-033 | Package export surface | `package.json`, `scripts/ai/index.js` | `exports`, `files` | `require("qa-ai-agent")` | External consumer | External | 19 named exports + 3 subpaths |
| TSB-034 | Requirements file / RequirementArtifact | `requirements-file.js`, `requirement-artifact.js` | `loadRequirementsFromFile`, `assertValidRequirementArtifact` | JSON file; caller objects | Requirement authors / caller | Untrusted | RTI-1 / RTI-2 |
| TSB-035 | Test design / quality / traceability | `test-design.js`, `requirement-quality.js`, `requirement-traceability.js` | Public generators and validators | RequirementArtifact[] | Caller | Untrusted | RTI-3/4/5 |
| TSB-036 | `collectContext.main` / `runCli` options | `collect-context.js`, `runtime-framework-selector.js` | `main({adapter, adapterOptions, profile, repositoryRoot})` | Caller adapter and options | External consumer | Caller-trusted code object | `{id, collect()}` |
| TSB-037 | Persisted context → analyzer / prompt | `analyze-failure.js` (`readContext :55`), `qa-agent-prompt.js` | `readContext`, `buildUserPrompt`, `pickSourceContext` | `reports/ai/context.json` | Copier / PR code / artifact transport | Untrusted file | Implicit (collector output) |
| TSB-038 | History (separate and embedded) → prompt | `analyze-failure.js` (`readHistory`, `:668`) | `readHistory`, embedded `context.history` | `history.json`; nested field | Same as TSB-037 | Untrusted | Four-counter projection |
| TSB-039 | Cross-job browser artifacts | `aggregate-browser-context.js` | `readBrowserInputs`, `readJsonIfSafe` | `browser-result.json`, `context.json`, `history.json` | Browser jobs (PR code) | Untrusted | Implicit |
| TSB-040 | Approval / application reuse and replay | `change-set-application.js`, review record | `applyApprovedGeneratedChangeSet` | Previously valid chain | Holder of chain | Untrusted reuse | None (no nonce / lifetime) |
| TSB-041 | `ai-report.json` → PR comment | `cypress.yml` (github-script), `format-pr-comment.js`, `pr-comment-client.js` | `formatComment`, `upsertPrComment` | Report file; PR comments | Model output; PR commenters | Untrusted | Implicit report shape |
| TSB-042 | Governance manifest parsing | `kernel/json-strict.js`, `kernel/manifest.js`, `kernel/validation.js`, `io/manifest-loader.js` | `parseStrictJson`, `validateManifest`, `parseManifestBytes` | Manifest bytes | Repository authors | Untrusted | Manifest v1 |
| TSB-043 | Governance CI evidence / trust | `stages/1a/*`, `stages/1f/*`, `kernel/revalidation.js`, `head-reader.js` | `collectCiEvidence`, `trusted-context`, `determination`, `buildReport` | CI run evidence; trusted context | Injected adapter / operator | Caller-labelled | GOV-AUTO-1 design D16 |
| TSB-044 | Evaluation datasets → regression gates | `evaluation/*` | `evaluate*`, `regression*`, `*-schema.js` | Tracked datasets / baselines | Repository authors | Repository-trusted | Dataset / baseline v1–v6 |
| TSB-045 | Supply-chain audit / workflows | `audit-drift-check.js`, `branch-inventory.js`, `dependency-review.yml`, `supply-chain-audit.yml`, `.npmrc`, `package-lock.json` | `evaluateAuditReport` | `npm audit` JSON | Registry / advisory data | Untrusted | auditReportVersion 2 |
| TSB-046 | AISEC-7 evidence completeness | `test/security/aisec-7/lib/*`, `evidence-completeness.test.js` | Execution ledger, evidence manifest, evidence run | Test-runner JSONL, ledgers | Test environment / runner options | Untrusted | Manifest (child 78 / top-level 94) |

### 8B. Validation chain

| ID | Runtime / schema | Structural | Semantic | Security / policy | Provenance / authentication | Authorization | Fail-closed |
|---|---|---|---|---|---|---|---|
| TSB-001 | String / non-empty; fence-stripped `JSON.parse`; `results` array | Required field types only; **open** item, `test`, `recommendedFix`; **no** size or length bounds | Count equality only; **no** result↔`failedTests[i]` binding (rule 7 unenforced) | `applyAgentPolicy`; fixed-wait warning | Provider name label only | n/a (advisory) | Yes on parse / shape / count |
| TSB-002 | Pre-parse char bound; strict parse | Closed, bounded, `schemaVersion` | Evidence refs bound to ingested bundle | Data-labelled prompt | Deterministic evidence ownership | n/a | Yes; bounded retries |
| TSB-003 | Bound; strict parse | Closed, bounded | Cross-model reference validation | Data-labelled | Bound to validated RequirementModel | n/a | Yes |
| TSB-004 | Bound (`:676`); strict parse | Closed | Candidate / framework / evidence binding | Framework authorization | Bound to input models | n/a | Yes |
| TSB-005 | Bound (1,000,000); strict parse | Closed | Plan↔candidate binding; framework tree (H08-C8) | — | Bound to candidate | n/a | Yes |
| TSB-006 | Bound (1,200,000); strict parse | Provider keys `{operation,path,content}` only | Builder: plan correspondence, base digests | Builder: prefix + protected-path | Digests computed locally, never provider-supplied | n/a | Yes; bounded attempts (H08-C1) |
| TSB-007 | Same bound and parse | Same | Same builder | Same builder | Same | Requires new review | Yes |
| TSB-008 | Snapshot of own data | Closed keys, bounds, NUL / surrogate checks | Plan correspondence; CREATE / MODIFY vs context | Framework prefix (`:498`); `isProtectedPath` (`:502`) | Domain-separated digests | n/a | Yes |
| TSB-009 | kind / schemaVersion only | **None** on `changes[]` or top level | projectId; plan / context / self digests | **None** | Unkeyed self-digest | n/a | Fails on digest mismatch only |
| TSB-010 | Snapshots | Operation enum + safe canonical path (`:898`) | Approval binding per change (`:700`); base digest vs actual | Containment / symlink / hardlink / case; **no** prefix or protected-path re-check | Unkeyed digests; reviewer opaque | `validateApprovedGeneratedChangeSetReview` | Yes for checked properties |
| TSB-011 | Snapshots | Record: digest + status + non-empty only | Record↔change-set digest; **no** `changes[]` correspondence | On-disk digest re-check; classifier | Unkeyed; approval not re-verified (H02-C5) | Applied-record presence | Yes for checked properties |
| TSB-012 | n/a | Closed classifier; Cypress safe-char allowlist; Playwright anchored pattern | — | `shell:false`, argv array, env allowlist, timeout, output caps; **not a sandbox** | — | Upstream (TSB-011) | Yes; Windows `.cmd` spawn → `EXECUTION_ERROR` (U-01) |
| TSB-013 | Builder | Closed, bounded | — | Output truncation | Bound to record digest | n/a | Yes |
| TSB-014 | Snapshots | Derived from TSB-009 (inherits its gap) | Target digests | — | Unkeyed self-digest; no presentation binding (H03-T) | n/a | Yes, but via TSB-009 only (an out-of-plan path throws incidentally) |
| TSB-015 | Build: closed decisions, derived status | Gate: kind / version / digests / projectId / **stored** status | Gate does not re-derive status | — | `reviewerId` opaque (AT-07 / TB-01) | Status field | Yes for digest; **not** for status / decisions consistency |
| TSB-016 | Same pattern as TSB-015 | Same | Same | — | Same | Same | Same |
| TSB-017 | Pure function | Overwrites `policy` | PRODUCT_BUG ceiling | Deterministic | Ignores model `policy` | Application-owned | n/a |
| TSB-018 | Object check | Required-field types; **open**; **no** bounds or control-char rule | — | — | Unauthenticated (XI-01 / SADR-01) | — | Throws on missing / invalid required fields |
| TSB-019 | Data-descriptor reads | Closed, bounded, canonical relative paths | Framework-specific report keys | No executable data | Unauthenticated | — | Yes |
| TSB-020 | Data-descriptor reads | Closed, bounded, canonical path | projectId == profile.id at consumption | Units dir realpath-contained | Unauthenticated | — | Yes |
| TSB-021 | `JSON.parse` per file | Required fields, enums, dates; **open**; no length bound | Project-scope rule for project source type | Projection to `{id, statement}`, 5 units / 2000 chars | Duplicate-id rejection | — | Throws on invalid unit |
| TSB-022 | String / control chars / absolute / realpath / directory | — | — | Containment helpers downstream | Caller-trusted (TB-09) | — | Yes |
| TSB-023 | Enum switch on provider; `AI_MODEL` unvalidated | — | — | Provider checks own key / model | — | — | Unknown provider → CONFIGURATION error |
| TSB-024 | Closed framework map; `HISTORY_RUNS` clamped (coerces) | — | — | `GITHUB_API_URL` unpinned (TB-15) | Platform env | Job token | Mostly |
| TSB-025 | Allow-list | Pairs only; regexes | Event / phase enums | Output dir lexically contained | — | — | Yes; uncaught error → 6 |
| TSB-026 | `analyze` is a function; return is a non-empty string | — | — | Contract string-only (TB-16) | — | — | Yes |
| TSB-027 | `res.json()` with **no byte cap** | Text extraction only | finish / truncation reason not inspected (U-03) | Pinned host; timeout | TLS | API key | Yes on shape |
| TSB-028 | `response.json()` with **no byte cap** | Response / issue shape validated | ADF depth bound | https-only, no redirects; no host allowlist (TB-15) | TLS | Operator token | Yes |
| TSB-029 | `response.json()` with **no byte cap** | Shape validated; HTML ≤ 200,000 chars, depth ≤ 64 | Type map | Host constructed; no redirects | TLS | Operator PAT | Yes |
| TSB-030 | Full RequirementArtifact validation | Closed | Collision / identity model | Data-only | Provider label | — | Yes, atomic |
| TSB-031 | Closed request / result | Accessor-safe; canonical frozen copies | Result↔design correspondence | Destination host constructed | No source / destination identity cross-check (AT-04 / TB-05) | Caller credential | Yes on result; no rollback of remote effects |
| TSB-032 | `JSON.parse`; tolerant walk | Not schema-validated | — | Report path containment; stack bounded (message unbounded by design) | — | — | Warns, skips |
| TSB-033 | `exports` map; `files` excludes `#22/#23` | — | — | Private modules unreachable via exports | — | — | Install tests |
| TSB-034 | Closed, accessor-safe, bounded | Yes | Duplicate ids | 5 MiB cap; containment | `source` provenance derived internally | — | Yes, atomic |
| TSB-035 | Closed, accessor-safe | Yes | READY gate; no-invention | — | Structural provenance | — | Yes |
| TSB-036 | `adapter.id` string + `collect` function | — | — | Trusted root / `currentProjectId` override caller options (spread order) | Caller code trusted | — | Yes for checked properties |
| TSB-037 | `JSON.parse` only | **None** at consumption; fields forwarded verbatim | — | Producer caps **not** re-applied | **None** (XI-01) | — | Only on unreadable / invalid JSON |
| TSB-038 | Separate file: projection + eligibility | Separate: four counters | Separate: project / framework | — | Labels only | — | Separate: yes; embedded: **no** (XI-02) |
| TSB-039 | `JSON.parse`; outcome enum | Labels defaulted; nested context unvalidated | Signature comparison | Path containment | — | — | Skips invalid |
| TSB-040 | — | — | Base-state checks only | — | No nonce, lifetime or consumption state | Approval reused | No (H02-C3 / C4) |
| TSB-041 | `JSON.parse`; `results` array | Formatter tolerant | — | Truncation; no markdown / mention neutralization (TB-07); marker not author-bound (TB-08) | — | Job token | Skips on missing / invalid |
| TSB-042 | Strict RFC 8259; duplicate-key reject; depth bound; null prototype | Closed manifest | Graph / cycle / dependency checks | Byte bound | Fingerprints | — | Yes |
| TSB-043 | Validated records | Closed result contracts | Required-job completeness (H11-C3) | Internal `WRONG_*` reasons (H11-C1 / C2) | Caller `PLATFORM_AUTHENTICATED` shape-only (H11-T); no TREE binding (H11-C7) | Self-certification refused (H11-C5) | Yes |
| TSB-044 | Per-version schema | v6 closed; v1–v5 **open** | Scoring | — | — | — | Non-zero exit on regression |
| TSB-045 | `JSON.parse` + structure check | auditReportVersion 2 | Gated severities | — | — | — | `INFRA_ERROR` on malformed / unidentifiable |
| TSB-046 | JSONL parse; ledger | Exact count binding | Per-file ledgers | Skip / filter / exit probes rejected | — | — | Yes (SEC-01 / SEC-02 resolved) |

### 8C. Exposure, evidence, impact and status

| ID | TOCTOU / mutation | Side effect / authority | Error behavior | Tests / evidence | Public API impact | Security impact | Controlled-v1 impact | Status | Findings |
|---|---|---|---|---|---|---|---|---|---|
| TSB-001 | In-memory | Writes `ai-report.json` → PR comment | `AnalyzerError`; safe provider messages | `analyze-failure.test.js`, `agent-policy.test.js`, H08-C7; P-04 | `analyzeFailure.main` | Advisory integrity / misattribution | TRIAGE | GAP | TSB-F04, TSB-F06 |
| TSB-002 | Snapshot | None | Bounded diagnostics | `requirement-model-generator.test.js`, `generation/security.test.js` | Private | Low | RC-03 / RC-04 | PASS | — |
| TSB-003 | Snapshot | None | Bounded | `test-case-model-generator.test.js`, `cross-model-validation.test.js` | Private | Low | RC-04 | PASS | — |
| TSB-004 | Snapshot | None | Bounded | `automation-candidate-generator.test.js` | Private | Low | RC-05 | PASS | — |
| TSB-005 | Snapshot | None | Bounded | `automation-plan-generator.test.js`, H08-C8 | Private | Low | RC-05 | PASS | — |
| TSB-006 | Snapshot | None (proposal only) | Bounded | `generate-change-set.test.js`, H08-C1..C4 | Private | Low | RC-06 | PASS | — |
| TSB-007 | Snapshot | None | Bounded | `regenerate-change-set.test.js` | Private | Low (PI-04 inherited) | RC-06 | PASS | — |
| TSB-008 | Snapshot + deep freeze | None | `{path, code, message}` | `generated-change-set.test.js`, H08-C3 | Private | Low | RC-06 | PASS | — |
| TSB-009 | Snapshot | Gates TSB-010 / 014 | Single error | Digest / stale tests only (`:364-387`); P-01 | Private | **Write scope** via consumers | APPLY | GAP | **TSB-F01** |
| TSB-010 | Pre-write and final revalidation; documented TOCTOU window (TB-11) | LOCAL WRITE | Rollback; record status | `change-set-application.test.js`, H01 / H02; P-01, P-02 | Private | LOCAL WRITE outside policy scope | APPLY | GAP | **TSB-F01**; TB-01 / 02 / 03 / 11 |
| TSB-011 | On-disk digest re-check before spawn | CODE EXECUTION | No spawn on failed checks | `controlled-execution.test.js`, H02-C5 (FAIL), H09; P-03 | Private | Execution of an unreviewed in-repo target | EXEC | GAP | **TSB-F03**; TB-01 / TB-18 |
| TSB-012 | Applied bytes re-verified (H09-C4) | CODE EXECUTION (not sandboxed) | Status enum | H09-C1..C5 | Private | TB-12 / 13 / 14 inherited | EXEC (Linux-first, prerequisite 6) | PARTIAL | TB-12 / 13 / 14 |
| TSB-013 | Frozen | Evidence | — | `automation-execution-record.test.js` | Private | Low | RC-08 / RC-09 | PASS | — |
| TSB-014 | Frozen | Review presentation | Throws on undefined purpose (caught by #23F) | `generated-change-set-review-package.test.js`, H03; P-01 | Private | Inherits TSB-F01 | APPLY | PARTIAL | TSB-F01 (inherited); H03-T |
| TSB-015 | Snapshot / freeze (RP-32) | Approval | — | `generated-change-set-review-record.test.js:260-270`, H02-C1; P-02 | Private | Approval gate weaker than documented | APPLY | GAP | **TSB-F02**; AT-07, TB-01 |
| TSB-016 | Build frozen | None in-tree | — | `test-design-review-record.test.js` | Private | Latent | Only if made authority-bearing | PARTIAL | **TSB-F02** |
| TSB-017 | New object | Report flags | — | `agent-policy.test.js`, H08-C7 | Indirect | Positive control | TRIAGE | PASS | — |
| TSB-018 | **Live object returned; accessors honored** | System-prompt and generation-prompt text | Throws | `project-profile.test.js` (presence / types only); P-05 | **Exported validator** | Low (operator input) | Any profile-consuming capability | PARTIAL | **TSB-F05**; XI-01 |
| TSB-019 | Data-only | Paths into adapters | Bounded | `framework-runtime-config.test.js` | Exported | Low | RC-01 | PASS | — |
| TSB-020 | Data-only | Knowledge dir | Bounded | `project-knowledge-config.test.js`, `loader-project-knowledge.test.js` | Exported | Low | RC-01 | PASS | — |
| TSB-021 | Read once | Prompt guidance | Throws | `schema.test.js`, `loader.test.js`, `selector.test.js` | Private | Low (contained) | TRIAGE; future RAG (§24) | PARTIAL | — |
| TSB-022 | Realpath resolved once | Root of all FS authority | Throws | `repository-root.test.js` | Exported | TB-09 | All | PARTIAL | TB-09 |
| TSB-023 | Captured at import | Provider selection; credential | Fails loudly | `config.test.js`, `providers/index.test.js` | Implicit (env-only seam for `analyzeFailure.main`) | Low | TRIAGE / generation | PARTIAL | — |
| TSB-024 | Read per run | GitHub API read with job token | Retries bounded | `collect-history*.test.js` | Indirect | TB-15 | TRIAGE | PARTIAL | TB-15 |
| TSB-025 | n/a | Report write | Exit codes | `cli.test.js` | Internal | Low | Governance | PASS | — |
| TSB-026 | n/a | Provider code in-process | Normalized errors | `provider-contract.test.js` | Private | TB-16 | All provider-using | PARTIAL | TB-16 |
| TSB-027 | n/a | Network egress with key | Mapped codes | `groq-provider.test.js`, `gemini-provider.test.js` | Private | Availability | TRIAGE / generation | PARTIAL | **TSB-F06** |
| TSB-028 | n/a | Network egress with token | Mapped | `jira-requirements-provider.test.js` | Subpath export | Availability; TB-15 | RC-02 | PARTIAL | **TSB-F06**; TB-15 |
| TSB-029 | n/a | Network egress with PAT | Mapped | `azure-devops-requirements-provider.test.js` | Subpath export | Availability | RC-02 | PARTIAL | **TSB-F06** |
| TSB-030 | Frozen | None | Atomic | `requirements-source-provider.test.js` | Exported | Low | RC-02 | PASS | — |
| TSB-031 | Frozen copies | REMOTE CREATE | Partial-failure semantics | `test-design-publishing.test.js`, destination tests | Exported + subpath | AT-04 / TB-05 / TB-19 | If publishing enabled | PARTIAL | AT-04, TB-05, TB-19 |
| TSB-032 | n/a | Context content | Warnings | Adapter tests, `cypress-equivalence.test.js` | Private | Low (producer side) | TRIAGE | PARTIAL | — |
| TSB-033 | n/a | Distribution | — | `package-surface.test.js`, `package-boundary.test.js`, installation proofs | Is the API | Low | RC-01 / RC-12 | PASS | — |
| TSB-034 | Frozen | None | Atomic | `requirements-file.test.js`, `requirement-artifact.test.js` | Exported | Low | RC-02 | PASS | — |
| TSB-035 | Frozen | None | Throws | `test-design.test.js`, `requirement-quality.test.js`, `requirement-traceability.test.js` | Exported | Low | RC-03 / RC-04 | PASS | — |
| TSB-036 | n/a | Writes `context.json` | Throws | `collect-context-runcli.test.js` | Exported | Low (caller code) | TRIAGE | PARTIAL | — |
| TSB-037 | Read once | Provider egress; report | Fails on bad JSON | AISEC-7 H05 (FAIL); P-06 | `analyzeFailure.main` | Cross-project data to provider (XI-01) | TRIAGE | GAP | XI-01; **TSB-F07** |
| TSB-038 | Read once | Prompt | Null on ineligible | AISEC-7 H06 (FAIL) | Same | XI-02 | TRIAGE | GAP | XI-02 |
| TSB-039 | Read once | Aggregated context | Skips | `aggregate-browser-context.test.js` | Exported | Low | TRIAGE | PARTIAL | **TSB-F07** |
| TSB-040 | Base state re-checked | Repeat writes | — | H02-C3 / C4 | Private | TB-02 / 03 | APPLY | GAP | TB-02, TB-03 (ODR-02) |
| TSB-041 | n/a | REMOTE CREATE / UPDATE (comment) | Warn-only | `format-pr-comment.test.js`, `pr-comment-client.test.js`, H11-C8 / C9 | Workflow | TB-07 / TB-08; F04 rendering | TRIAGE | PARTIAL | **TSB-F04**; TB-07, TB-08 |
| TSB-042 | Frozen | None | Reason codes | `manifest.test.js`, `validation.test.js`, `wave*.test.js` | Internal | Low | Governance | PASS | — |
| TSB-043 | Revalidation stage | Readiness determination | Reason codes | `trust-evidence.test.js` (H11), stage tests | Internal; not CI-wired | Governance evidence | Governance prerequisite 10 | PARTIAL | H11-C7; C2-SR-01 / 02 carried |
| TSB-044 | n/a | CI gate | Exit code | `*-schema.test.js`, `regression*.test.js` | Excluded | AT-14 | RC-11 (evidence) | PARTIAL | AT-14 |
| TSB-045 | n/a | CI gate | `INFRA_ERROR` | `audit-drift-check.test.js`, `branch-inventory.test.js` | n/a | Low | RC-11 | PASS | — |
| TSB-046 | n/a | Evidence validity | Fails on incompleteness | `evidence-completeness.test.js`, `harness-invariants.test.js` | n/a | Positive control | Release prerequisite 1 | PASS | — |

**Matrix totals:** 46 boundaries — 19 PASS, 19 PARTIAL, 8 GAP, 0 UNKNOWN, 0 NOT_APPLICABLE. Every GAP and PARTIAL row names either a finding or the inherited existing item it traces to, or explains why no finding was raised (TSB-021, TSB-023, TSB-032, TSB-036: residual openness is contained or documented by design and has no authority path).

## 9. LLM / provider boundaries

**Generation paths (TSB-002..007): PASS.** All six (requirement model, test-case model, automation candidate, automation plan, change set, regeneration) share the same discipline:

1. a pre-parse character bound on the raw response;
2. `JSON.parse(response.trim())` with no fence stripping or substring extraction;
3. a closed, bounded schema;
4. binding to the validated upstream artifact;
5. for code proposals, the deterministic builder of TSB-008.

The AISEC-7 H-08 cases (C1–C4, C8) confirm that out-of-plan, protected, authority-field, invented-reference and foreign-plan outputs are refused, with zero writes and zero spawns.

**Triage path (TSB-001): GAP.** It is the outlier:

- It strips a markdown fence and has no pre-parse size bound.
- It checks per-item required types but leaves every object open.
- Its only semantic check is `results.length === failedTests.length`.

The system prompt declares the identity contract — rule 7, `qa-agent-prompt.js:90`: one result per failed test, in input order, each identified by `test` (title + specFile) matching the input. No code enforces that contract.

`applyAgentPolicy` spreads the validated result (`agent-policy.js:45`), so unknown model-supplied fields persist into `ai-report.json`. The PR-comment formatter then renders model-asserted `test.title` (not truncated), `test.specFile` and `recommendedFix.file`. None of these three fields is validated. → **TSB-F04**.

`applyAgentPolicy` itself (TSB-017) is a sound deterministic control and is a positive finding.

**Provider layer (TSB-026, TSB-027):**

- The runtime contract is "is a function / returns a non-empty string", which is enough for the string-in/string-out design. TB-16 already captures that nothing stronger is enforced at runtime.
- The Groq and Gemini adapters parse the HTTPS body without a byte cap and do not inspect `finish_reason` / `finishReason`. A truncated or safety-blocked completion therefore reaches downstream parsers as ordinary text; the downstream parsers fail closed. → **TSB-F06** (byte cap); finish-reason handling is U-03.

## 10. GeneratedChangeSet / generated-code authority

**Construction (TSB-008): PASS.** `buildGeneratedChangeSet` (`generated-change-set.js:415`):

- snapshots its inputs;
- enforces closed change keys and bounds;
- rejects NUL bytes and unpaired surrogates;
- requires one-to-one plan correspondence;
- requires the framework prefix (`:498`) and rejects protected paths (`:502`);
- computes base-content digests locally;
- emits a deep-frozen object.

**Validation / consumption (TSB-009, TSB-010): GAP.**

- `validateGeneratedChangeSet` (`:576-618`) re-verifies only kind/schemaVersion, `projectId`, plan and context digests, and the change set's own self-digest.
- `buildGeneratedChangeSetReviewPackage` (`review-package.js:127`) relies solely on that validator.
- `applyApprovedGeneratedChangeSet` (`change-set-application.js:774`) re-checks only the operation enum and safe/canonical path syntax (`:898`), then the filesystem containment properties.

None of the three re-establishes:

- closed keys (top-level or per change);
- correspondence between `changes[]` and `plannedChanges`;
- the framework prefix;
- `isProtectedPath`.

The self-digest is unkeyed and `recomputeChangeSetDigest` is exported, so a change set that the builder would reject passes every downstream check as long as its digest is self-consistent.

Probe P-01 (offline; temp directory; benign content) observed the following:

| Case | Builder | Validator | Review package | APPROVE record | Application | Write |
|---|---|---|---|---|---|---|
| Target outside the framework prefix | Rejects | Accepts | Builds | Builds | Applies | Written |
| Protected basename inside the prefix | Rejects | Accepts | Builds | Builds | Applies | Written |
| Unknown top-level and per-change fields | — | Accepts | — | — | — | — |
| Out-of-plan target (prefix and plan otherwise valid) | — | — | Throws an *incidental* `canonicalStringify` error on the undefined `purpose` | — | Fails closed via the caught exception | — |

The out-of-plan case fails closed by accident, not by a deliberate check.

Prior documentation asserts that these two layers make protected areas unreachable:

- AISEC-3 §20 ("a protected area is unreachable unless *both* layers fail");
- AISEC-2 (C6 acceptance criteria);
- SADR-07 "Current repository facts".

That assertion holds only for objects produced by the builder. → **TSB-F01**.

**Execution (TSB-011, TSB-012).** Execution binds:

- plan → change set (plan digest);
- change set → applied record (`changeSetDigest`);
- applied record → disk (`afterDigest` re-check).

It never checks that `appliedChangeSetRecord.changes[]` corresponds to `generatedChangeSet.changes[]`. It also does not schema-validate record entries beyond self-digest, `status`, and non-empty.

Probe P-03 used a temp root with no runner binary, so nothing ran. It proceeded to the process-spawn step for a target present on disk but absent from the change set, with zero-filled review digests. → **TSB-F03**. This is narrower than AISEC-7 H02-C5 (fabricated approval reaching the launcher; TB-01/TB-18), which it does not re-rate.

TSB-012 process controls are sound but explicitly not a sandbox (TB-12/13/14). On this Windows host, Node 22 refuses to spawn the `.cmd` shim under `shell:false`, so execution reports `EXECUTION_ERROR` (fail-closed; U-01). This is consistent with Controlled-v1 prerequisite 6 (Linux-first execution).

## 11. Review / approval / authorization

- **Review records (TSB-015, TSB-016).** Record *construction* is strict: closed decision entries, full `{operation, path, targetDigest}` matching, and `status` derived from decisions, never caller-supplied.
- **Approval gates.** Both `validateApprovedGeneratedChangeSetReview` (`:411`, status check `:465`) and `validateApprovedTestDesignReview` (`:306`, `:346`):
  - verify the self-digests and the project/package relations;
  - then trust the stored `status` field;
  - do not re-derive `status` from `decisions`;
  - do not re-validate `reviewerId`, `reviewedAt`, decision shape or unknown keys.

  Probe P-02 built a record with a single REJECT decision, relabelled `status` to APPROVED, added an unknown field and recomputed the self-digest. The gate returned `ok: true`. The existing test `generated-change-set-review-record.test.js:260` covers a status flip *without* digest recomputation only.
- **Current authority consumer.** #23F application independently re-requires a single APPROVE decision per change (`verifyApprovedChangeBinding`, `:700`) and refused the P-02 chain with zero writes. The weakness is therefore in the exported gate contract, not a current write bypass. → **TSB-F02 (LOW)**.
- **Reviewer identity.** `reviewerId` is an opaque string, and approval authenticity is absent. This is the existing AT-07 / TB-01 / TB-18 (SADR-02) and is not re-raised here.
- **Presentation binding.** Absent (H03-T, SADR-03). Not re-raised.
- **Replay and reuse (TSB-040).** Existing TB-02 / TB-03, AISEC-7 H02-C3 / C4, ODR-02.
- **Triage action policy (TSB-017): PASS.**

## 12. Project / configuration

- **FrameworkRuntimeConfig and ProjectKnowledgeConfig (TSB-019, TSB-020): PASS.** Both are exemplary: closed keys, own-enumerable-data-descriptor reads (getters never invoked), bounded strings, canonical relative paths, bounded diagnostics. ProjectKnowledgeConfig is also equality-bound to `projectProfile.id` at consumption (`analyze-failure.js:291-300`).
- **ProjectProfile (TSB-018): PARTIAL.** It is the public, system-prompt-bearing configuration contract, and the weakest of the three. Probe P-05 observed that `validateProjectProfile` / `assertValidProjectProfile`:
  - accept unknown fields (for example a caller-added trust label);
  - accept control characters and a 100,000-character `displayName`;
  - accept accessor-backed fields whose value changes between validation and the later prompt read;
  - return the caller's live object (`project-profile.js:86`).

  `displayName` is interpolated into the triage system prompt (`qa-agent-prompt.js:71`). `displayName` and `knownProjectConstraints` also flow into #23 repository-context projections (`automation-repository-context.js:677-685`). → **TSB-F05**. Tightening an exported validator is a public-contract change, hence an architecture decision.
- **Knowledge corpus (TSB-021): PARTIAL.** The unit schema is open and unbounded. The selector projects only `{id, statement}` within a 5-unit / 2000-character budget, and project units are realpath-contained, so no finding is raised for the current read path. §24 records the stronger requirement for future RAG.
- **repositoryRoot (TSB-022): PARTIAL.** Shape and existence validation only, by design; the root is caller-trusted (TB-09).

## 13. Environment / process inputs

- **Provider selection (TSB-023).** `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` are captured once at module import (`config.js:20`). For public `analyzeFailure.main()` this environment is the only provider-selection seam: there is no provider parameter, and provider identity in the report is a label.
  - An unknown provider fails loudly.
  - `AI_MODEL` is passed through unvalidated: as a body field for Groq, and URL-encoded in the path for Gemini.
  - Recorded as PARTIAL. No finding: the behavior is documented and has no authority path.
- **Collector and history environment (TSB-024).**
  - `QA_FRAMEWORK` resolves through a closed map.
  - `HISTORY_RUNS` is coerced via `Number()` and clamped to 1..30.
  - `HISTORY_BRANCH` and `HISTORY_JOB_NAME` are free strings used as API query values.
  - `GITHUB_API_URL` is unpinned. That gap is existing TB-15 and is not re-raised.
- **Governance CLI argv (TSB-025): PASS.** Allow-listed `--flag value` pairs, no environment fallback, an uncaught error never exits 0.

## 14. Providers / adapters

- **Requirement-source adapters (TSB-028, TSB-029).**
  - Strong configuration contracts: closed keys, https-only, no embedded credentials.
  - `redirect: "manual"`, with any 3xx treated as failure.
  - Bounded retries and rate-limit waits; ADF / HTML depth bounds; strict response-shape checks.
  - The response body is parsed with `response.json()` and no byte cap. → **TSB-F06**.
  - Jira host allowlisting is existing TB-15.
- **Source executor (TSB-030): PASS.** Atomic, fully validated normalization.
- **Publishing (TSB-031): PARTIAL.**
  - Structurally exemplary: closed, accessor-safe, frozen canonical copies; destination results are treated as untrusted.
  - The residual issues are authorization and replay: no source/destination identity cross-check (AT-04 / TB-05) and no idempotency (TB-19). These existing items are not re-raised.
- **Runner report adapters (TSB-032): PARTIAL.** Reports are parsed tolerantly and not schema-validated. This is the producer side; containment checks are present, stacks are bounded, and messages are intentionally unbounded. The consumer-side consequence is captured by TSB-F07.

## 15. Public API / package / CLI

- **Export surface (TSB-033): PASS.**
  - `package.json` `exports` exposes `.`, two provider subpaths, one destination subpath and `./package.json`.
  - `files` excludes `generation/`, `generative-test-design/`, `test-automation/`, `evaluation/` and fixtures.
  - The #22/#23 authority chain is therefore not reachable through a supported import, matching Controlled-v1 prerequisite 7.
  - Evidence: `test/installation/package-surface.test.js`, `scripts/ai/package-boundary.test.js` and the external-repository installation proofs.
- **Exported validators.**
  - PASS for RequirementArtifact, TestDesignArtifact, FrameworkRuntimeConfig and ProjectKnowledgeConfig.
  - PARTIAL for ProjectProfile (TSB-F05).
- **`collectContext.main` / `runCli` (TSB-036): PARTIAL.** The function accepts a caller adapter object, checked only for `id` and `collect`. Caller `adapterOptions` are spread *before* the trusted `root` / `currentProjectId`, so they cannot override them. The adapter is caller code by design, so no finding is raised.
- **Compatibility note.** Any corrective for TSB-F04 changes the shape of `ai-report.json`, and any corrective for TSB-F05 changes the input domain `assertValidProjectProfile` accepts. Both are therefore public-contract changes requiring versioned treatment.

## 16. Persistence / replay

No database or persistent store exists. Persistence consists of JSON artifacts under `reports/ai/` plus objects a caller may serialize between #23 stages.

- **TSB-037 (context → analyzer): GAP.** XI-01 already establishes that persisted context is not bound to the invocation. This audit additionally finds that the analyzer re-establishes *no structural or size contract* when it consumes that context:
  - `relevantFiles`, `collectorWarnings`, `knownProjectConstraints` and `history` are forwarded verbatim into the prompt (`qa-agent-prompt.js:231-242`).
  - Probe P-06: a 2 MiB `relevantFiles` entry produced a ~2.1 million-character prompt. The collector's 20 KiB per-file and 150 KiB total caps are not re-applied.
  - The same probe showed the prompt carrying the context file's `knownProjectConstraints` rather than the validated invocation profile's. This sub-observation is evidence within XI-01's scope and is cited, not re-rated.

  → **TSB-F07**.
- **TSB-038 (embedded history):** XI-02, unchanged.
- **TSB-039 (cross-job aggregation): PARTIAL.** Labels are defaulted and nested context is unvalidated. Same consumer-side contract gap → TSB-F07.
- **TSB-040 (approval reuse and replay):** existing TB-02 / TB-03, H02-C3 / C4, ODR-02.
- **#23 stage objects.** Every stage re-verifies only unkeyed self-digests (TB-01). TSB-F01 / F02 / F03 are the schema-level consequences at the three consumers that grant authority.

## 17. CI / governance evidence

- **Triage → PR comment (TSB-041): PARTIAL.**
  - The workflow parses `ai-report.json` and requires only a `results` array.
  - The upsert marker is derived from `report.sourceContext.browser`.
  - The formatter renders model-asserted fields (TSB-F04).
  - Markdown/mention neutralization (TB-07) and marker author binding (TB-08) are existing items.
  - PR code already executes in the same job before triage (TB-17 / TB-20), so artifact-level validation is not a defense against same-repository PR code. It is, however, the integrity boundary for model output.
- **Governance (TSB-042 PASS, TSB-043 PARTIAL).**
  - The GOV-AUTO-1 kernel is the strongest parser in the repository: strict RFC 8259, duplicate-key rejection, depth and byte bounds, null-prototype trees, lexical `schemaVersion`.
  - CI-evidence trust handling is evidenced by AISEC-7 H11-C1..C6. H11-C7, H11-C8 and H11-C9 confirm existing gaps: no TREE binding, and TB-08 comment-upsert behavior.
  - H11-C7 (no TREE / checkout binding) remains an existing target.
  - The governance tooling is not invoked by any tracked workflow, and no live CI-evidence adapter exists, so its operational behavior is unexercised (U-05).
  - `C2-SR-01` / `C2-SR-02` are carried unchanged (§19).
- **Evaluation (TSB-044): PARTIAL.** Dataset/baseline schemas v1–v5 do not reject unknown keys; v6 does. These gates are internal and unpublished. Covered by the existing AT-14 (evaluation / grader gaming); no new finding.
- **Supply chain (TSB-045): PASS.** `audit-drift-check.js` fails closed with `INFRA_ERROR` on malformed or unidentifiable advisory data.
- **AISEC-7 evidence completeness (TSB-046): PASS.** SEC-01 / SEC-02 are resolved on the reviewed head; per-file ledgers and exact count binding are in place.

## 18. Test / evidence coverage

**Unit suite (authoritative, Node 22.23.3, exact baseline):**

```text
npm run test:unit
tests 5627 | pass 5618 | fail 0 | cancelled 0 | skipped 9 | todo 0 | exit 0
```

The 9 skips are platform-specific:

- 2 POSIX permission-mode cases (`23F-R-3`);
- 6 Playwright exact-target cases that cannot spawn a `.cmd` under `shell:false` on Windows;
- 1 Linux-only procfs descriptor proof (`C2 SEC-L1`).

Each skip states that the ubuntu CI runner executes it. A first attempt accidentally ran under the host's Node 24 and failed on `EBADENGINE`; that run is discarded and is not evidence.

**Offline audit probes (scratch-only; not tracked; no network; temp directories only):**

| Probe | Question | Observed | Supports |
|---|---|---|---|
| P-01 | Does GeneratedChangeSet validation/consumption re-enforce the builder contract? | Out-of-prefix and protected-basename targets: builder rejects, but validation, review package and application accept and write in a temp root. Unknown fields accepted. Out-of-plan target fails only through an incidental throw. | TSB-F01 |
| P-02 | Do approval gates derive status from decisions? | Status-relabelled REJECT record with a recomputed self-digest passes the gate. #23F refuses it at per-change binding (zero writes). | TSB-F02 |
| P-03 | Is the applied record bound to the change set's changes? | A record naming an on-disk target absent from the change set, with zero-filled review digests, reaches the spawn step (`EXECUTION_ERROR` only because no runner exists). | TSB-F03 |
| P-04 | Is triage output bound to failed tests and closed? | Results with unrelated titles accepted. Unknown and non-string fields persisted. The PR comment shows the model's title, not the real test's. | TSB-F04 |
| P-05 | Is ProjectProfile closed, bounded and accessor-safe? | Accessor values change after validation; unknown keys, control characters and a 100,000-character `displayName` accepted; live object returned. Sibling ProjectKnowledgeConfig rejects an unknown key. | TSB-F05 |
| P-06 | Are producer bounds re-applied at context consumption? | ~2.1 million-character prompt from a 2 MiB `relevantFiles` entry; context-carried constraints used instead of the profile's. | TSB-F07 (and XI-01 context) |

TSB-F06 is supported directly by source (`response.json()` / `res.json()` sites in §8A) and needs no probe.

**AISEC-7 harness cross-reference.**

- PASS cases support TSB-006, TSB-008, TSB-017, TSB-043 and TSB-046.
- FAIL / target cases (H01, H02-C1 / C3 / C4 / C5, H03-T, H05, H06, H11-C7) are existing evidence for inherited items and are not re-scored.
- No existing test exercises a structurally invalid but self-consistent object at the TSB-009, TSB-011 or TSB-015 consumers, nor the triage result↔test binding. Those absences are part of the F01–F04 evidence.

## 19. Existing findings

These are preserved exactly. This audit does not close, waive, re-rate, remediate, risk-accept or absorb any of them.

```text
XI-01:    OPEN / MEDIUM / UNCHANGED
XI-02:    OPEN / MEDIUM / UNCHANGED
          disposition (both):
          IMPLEMENTATION_REQUIRED_BEFORE_CONTROLLED_RELEASE_WHEN_AFFECTED_CAPABILITY_ENABLED
C2-SR-01: LOW / NON-BLOCKING / UNRESOLVED
C2-SR-02: LOW / NON-BLOCKING / UNRESOLVED
```

**XI-01 / XI-02.** TSB-F07 shares their path (persisted context → analyzer) but records a distinct property: the structural and size contract at consumption, not provenance or project binding. It does not alter either XI disposition. Remediating TSB-F07 would not satisfy XI-01 or XI-02, and remediating XI-01 or XI-02 would not by itself satisfy TSB-F07. The P-06 observation that context-carried constraints displace the invocation profile's is evidence inside XI-01's existing scope.

**C2-SR-01 / C2-SR-02.** These are carried AISEC-7 review debt, recorded in ROADMAP (AISEC-7 closure evidence) as `LOW / NON-BLOCKING / UNRESOLVED`. Their content is not restated in the repository, and this audit does not reinterpret them.

Other existing `AT-*` / `PI-*` / `TB-*` items cited in §8–§17 keep their recorded ratings and dispositions.

## 20. New findings

### TSB-F01 — GeneratedChangeSet consumption boundaries do not re-establish the construction-time contract

| Field | Record |
|---|---|
| ID | TSB-F01 |
| SEVERITY | MEDIUM |
| BOUNDARY | TSB-009, TSB-010 (inherited by TSB-014) |
| CATEGORY | Construction-only invariant / consumption-side revalidation gap |
| FILES / SYMBOLS | `scripts/ai/test-automation/generated-change-set.js`: `validateGeneratedChangeSet` (`:576-618`), `recomputeChangeSetDigest` (`:624`), `isProtectedPath` (`:129`), prefix / protected checks only in `buildGeneratedChangeSet` (`:498`, `:502`). `generated-change-set-review-package.js`: `buildGeneratedChangeSetReviewPackage` (`:112`, `:127`). `change-set-application.js`: `applyApprovedGeneratedChangeSet` (`:774`, `:815`, `:898`). |
| CURRENT BEHAVIOR | Validation checks kind / version, `projectId`, plan / context digests and an unkeyed self-digest. Application re-checks the operation enum and safe / canonical path syntax only. Neither enforces closed keys, `changes[]`↔`plannedChanges` correspondence, the framework prefix or the protected-path denylist. |
| EXPECTED CONTRACT | Every consumer that grants authority (review-package construction and application) re-establishes the full GeneratedChangeSet v1 contract the builder enforces, independent of how the object was produced, as AISEC-3 §20, AISEC-2 C6 and SADR-07 "current repository facts" already describe. |
| SAFE EVIDENCE REFERENCE | Probe P-01 (§18): a builder-rejected target (outside `cypress/` or a protected basename), carried in a self-consistent change set, passes `validateGeneratedChangeSet`, review-package rebuild and an APPROVE record, and is written by `applyApprovedGeneratedChangeSet` into a temp root. Contrast: H08-C1 / C3 (generation path, PASS) and `generated-change-set.test.js:364-387` (digest / stale cases only). |
| SECURITY IMPACT | The deterministic, model-independent protected-area barrier is not enforced where filesystem authority is exercised. A change set that reaches review by any path other than the builder — persisted / deserialized between stages, altered in transit with a recomputed digest, or a future producer — can obtain LOCAL WRITE to repository areas outside `cypress/` / `playwright/` (for example `package.json`, workflow or config files) subject only to human review. The approval identity is itself unauthenticated (TB-01 / AT-07). |
| ARCHITECTURE / API IMPACT | Private (#23 is excluded from the package). Requires a shared consumer-side revalidation primitive reused by TSB-009 / 010 / 014. Prior AISEC documentation overstates the barrier and should be read with this finding. |
| CONTROLLED-V1 RELEASE IMPACT | `CONTROLLED_V1_BLOCKER: CONDITIONAL` — blocker when generated-change safe application (#23F; the "Safe application" step of the Controlled-v1 chain) is enabled. Not a blocker for a scope with application disabled. |
| CORRECTIVE REQUIREMENT | Consumer-side validation re-derives and enforces closed keys, plan correspondence, framework prefix and protected-path policy (a single source of truth with the builder) before any review-package construction or write, and fails closed deliberately on out-of-plan targets rather than by incidental exception. Negative tests for builder-bypassing self-consistent objects at each consumer. |
| REVIEW REQUIREMENT | Independent HEAVY Security plus Architecture review of the corrective. Fresh AISEC-7-style negative cases at all three consumers. |
| DISPOSITION | OPEN — IMPLEMENTATION REQUIRED |

### TSB-F02 — Approval gates trust the stored derived `status` and do not re-validate the record

| Field | Record |
|---|---|
| ID | TSB-F02 |
| SEVERITY | LOW |
| BOUNDARY | TSB-015, TSB-016 |
| CATEGORY | Derived-field trust / incomplete gate contract |
| FILES / SYMBOLS | `generated-change-set-review-record.js`: `validateApprovedGeneratedChangeSetReview` (`:411`, `:465`). `test-design-review-record.js`: `validateApprovedTestDesignReview` (`:306`, `:346`). |
| CURRENT BEHAVIOR | Gates verify self-digests and project / package relations, then accept on `status === "APPROVED"`. `status` is not re-derived from `decisions`; decision shape, `reviewerId`, `reviewedAt` and unknown keys are not re-validated. |
| EXPECTED CONTRACT | The gate is documented as "the single deterministic approval gate". It should re-derive `status` from `decisions` (REJECT > REQUEST_CHANGES > APPROVED) and re-validate the closed record schema the builder enforces. |
| SAFE EVIDENCE REFERENCE | Probe P-02 (§18). The existing test `generated-change-set-review-record.test.js:260` covers a status flip without digest recomputation only. #23F `verifyApprovedChangeBinding` (`change-set-application.js:700`) refused the P-02 chain with zero writes. |
| SECURITY IMPACT | No current write bypass: the only authority consumer independently requires per-change APPROVE. Latent: any consumer relying on the exported gate alone would accept a REJECTED / CHANGES_REQUESTED review relabelled as APPROVED. |
| ARCHITECTURE / API IMPACT | Private modules. Gate semantics should not depend on every consumer re-implementing decision checks. |
| CONTROLLED-V1 RELEASE IMPACT | `CONTROLLED_V1_BLOCKER: CONDITIONAL` — only if a consumer other than #23F application (including the future Controlled-v1 supported high-level surface, or a test-design publishing approval step) relies on either gate without independent per-decision checks. Otherwise NO. |
| CORRECTIVE REQUIREMENT | Gates re-derive `status`, re-validate the closed record schema, and reject inconsistency. Negative tests with recomputed self-digests. |
| REVIEW REQUIREMENT | Independent Security review. |
| DISPOSITION | OPEN — IMPLEMENTATION REQUIRED |

### TSB-F03 — Controlled execution does not bind the applied record's changes to the change set

| Field | Record |
|---|---|
| ID | TSB-F03 |
| SEVERITY | LOW |
| BOUNDARY | TSB-011 |
| CATEGORY | Cross-object binding gap / consumption-side schema |
| FILES / SYMBOLS | `controlled-execution.js`: `executeAppliedChangeSet` (`:619`, record checks `:666-686`), `revalidateAppliedState` (`:568`), `deriveExecutionTargets` (`:305`). |
| CURRENT BEHAVIOR | The record is accepted on self-digest, `changeSetDigest` equality, `projectId`, `status === "APPLIED"` and a non-empty `changes`. Execution targets are derived from `record.changes[]` without checking that each entry corresponds to `generatedChangeSet.changes[]` (path, operation, `afterDigest` of the approved content) and without schema-validating the entries. |
| EXPECTED CONTRACT | Execution targets ⊆ the approved change set's applied changes, with `afterDigest` equal to the digest of the approved content. Record entries are validated against the AppliedChangeSetRecord v1 schema at consumption. |
| SAFE EVIDENCE REFERENCE | Probe P-03 (§18): a record naming an on-disk spec absent from the change set, with zero-filled review digests, reaches the spawn step. Related existing case: H02-C5 (FAIL; TB-01 / TB-18). |
| SECURITY IMPACT | CODE EXECUTION scope can drift from the reviewed change set to any in-repository spec whose current bytes match the record. Marginal authority is low (it runs existing repository code) and requires constructing a record, which is the same precondition as TB-01. |
| ARCHITECTURE / API IMPACT | Private. Shares the consumer-revalidation primitive with TSB-F01. |
| CONTROLLED-V1 RELEASE IMPACT | `CONTROLLED_V1_BLOCKER: CONDITIONAL` — blocker when controlled execution (#23G / RC-08) is enabled. |
| CORRECTIVE REQUIREMENT | Bind record entries one-to-one to change-set changes and approved-content digests. Validate the record schema at consumption. Refuse otherwise with zero spawn. |
| REVIEW REQUIREMENT | Independent Security review together with the TSB-F01 corrective. |
| DISPOSITION | OPEN — IMPLEMENTATION REQUIRED |

### TSB-F04 — Triage model-output contract is open and not bound to the failed tests it describes

| Field | Record |
|---|---|
| ID | TSB-F04 |
| SEVERITY | LOW |
| BOUNDARY | TSB-001, TSB-041 |
| CATEGORY | Declared-but-unenforced contract / open schema on a current operational LLM path |
| FILES / SYMBOLS | `analyze-failure.js`: `runProviderAnalysis` (`:523`, `:614`), `validateAnalysisItem` (`:405`), `buildFailureReport` (`:651`, `:708`). `agent-policy.js:45` (spread). `qa-agent-prompt.js:90` (rule 7). `format-pr-comment.js:40-42`, `:78`. |
| CURRENT BEHAVIOR | Only result count and required field types are checked. Item, `test` and `recommendedFix` objects are open. `test.title` / `specFile` and `recommendedFix.file` are model-asserted and unvalidated. There are no length bounds. Unknown fields persist into `ai-report.json` and the PR comment renders model-asserted identity. |
| EXPECTED CONTRACT | The rule-7 identity contract enforced in code: result *i* corresponds to `failedTests[i]` by deterministic identity, or test identity is taken from context rather than the model. A closed, bounded result schema. Only application-validated fields reach the report and comment. |
| SAFE EVIDENCE REFERENCE | Probe P-04 (§18). No existing test asserts result↔test binding or closed-key rejection for triage. |
| SECURITY IMPACT | Integrity of advisory output on the current CI path (Groq on pull requests): a model (or injected failure text, PI-03 / 04) can attribute classification / `shouldCreateBug` / root cause to the wrong test, or to a test that does not exist, in a human-facing PR comment. No write, execute or publish authority (the policy ceiling of TSB-017 still applies). |
| ARCHITECTURE / API IMPACT | `ai-report.json` is the output contract of exported `analyzeFailure.main`. Closing the schema is a versioned output change. |
| CONTROLLED-V1 RELEASE IMPACT | `CONTROLLED_V1_BLOCKER: CONDITIONAL` — only if CI failure triage / PR reporting is part of the Controlled-v1 enabled capability set (the same capability condition that governs XI-01 / XI-02). |
| CORRECTIVE REQUIREMENT | Deterministic result↔test binding. Closed, bounded result schema. Report and comment derived only from validated fields. Pre-parse size bound (see TSB-F06). |
| REVIEW REQUIREMENT | Independent Security plus Architecture review (public output contract). |
| DISPOSITION | OPEN — IMPLEMENTATION REQUIRED |

### TSB-F05 — ProjectProfile public validator is open, unbounded, accessor-permitting and returns the live object

| Field | Record |
|---|---|
| ID | TSB-F05 |
| SEVERITY | LOW |
| BOUNDARY | TSB-018 |
| CATEGORY | Public contract strictness / TOCTOU via accessor / sibling-contract asymmetry |
| FILES / SYMBOLS | `scripts/ai/project-profile.js`: `validateProjectProfile` (`:48`), `assertValidProjectProfile` (`:78`, returns at `:86`). Consumers: `qa-agent-prompt.js:71`, `automation-repository-context.js:677-685`, `collect-context.js:474-488`. |
| CURRENT BEHAVIOR | Required-field presence / type checks only. Unknown keys, unbounded lengths, control characters and accessor properties are accepted. The caller's object is returned and read again later. |
| EXPECTED CONTRACT | Parity with FrameworkRuntimeConfig / ProjectKnowledgeConfig: closed keys, bounded control-character-free strings, own enumerable data descriptors only, and a validated snapshot used by every consumer. |
| SAFE EVIDENCE REFERENCE | Probe P-05 (§18); `project-profile.test.js` covers presence / type only. |
| SECURITY IMPACT | Low. The operator-owned value is the highest-authority prompt text (system prompt). The value validated is not guaranteed to be the value used, and unbounded or control text can enter the system prompt. No authority path. |
| ARCHITECTURE / API IMPACT | `assertValidProjectProfile` is a public export (`scripts/ai/index.js`). Tightening narrows the accepted input domain, which is a compatibility decision (versioning / deprecation). |
| CONTROLLED-V1 RELEASE IMPACT | `CONTROLLED_V1_BLOCKER: CONDITIONAL` — when ProjectProfile-consuming capabilities (triage, #23 generation context) are enabled through the Controlled-v1 supported external surface. |
| CORRECTIVE REQUIREMENT | Architecture decision on the compatibility path, then a closed, bounded, snapshotting validator used by all consumers. |
| REVIEW REQUIREMENT | Architecture review (public API) plus Security review. |
| DISPOSITION | OPEN — ARCHITECTURE DECISION REQUIRED |

### TSB-F06 — No pre-parse size bound on remote response bodies or triage model text

| Field | Record |
|---|---|
| ID | TSB-F06 |
| SEVERITY | LOW |
| BOUNDARY | TSB-001, TSB-027, TSB-028, TSB-029 |
| CATEGORY | Unbounded input before structural validation (availability) |
| FILES / SYMBOLS | `groq-provider.js:145`, `gemini-provider.js:170`, `jira-requirements-provider.js:627`, `azure-devops-requirements-provider.js:693`, `:785` (`json()` on the full body). `analyze-failure.js:614` (no response-length bound). |
| CURRENT BEHAVIOR | Bodies are buffered and parsed in full before any shape check. The six generators bound model text *after* the adapter returns; triage applies no bound at all. |
| EXPECTED CONTRACT | A byte bound before buffering / parsing at every network adapter, and a character bound on triage model text, consistent with the generators' `MAX_*_RESPONSE_CHARS` discipline. |
| SAFE EVIDENCE REFERENCE | Source references above. Contrast `generate-change-set.js` (`MAX_CHANGESET_RESPONSE_CHARS` checked before `JSON.parse`) and `automation-candidate-generator.js:676`. |
| SECURITY IMPACT | Availability only (memory / CPU of the operator or CI process) from a misbehaving or compromised endpoint. Hosts are pinned except Jira (TB-15). No integrity or authority impact. |
| ARCHITECTURE / API IMPACT | Adapter-internal; subpath-exported adapters keep their API. |
| CONTROLLED-V1 RELEASE IMPACT | `CONTROLLED_V1_BLOCKER: NO`. Hardening; may be included in the SADR-11 dossier of enabled adapters. |
| CORRECTIVE REQUIREMENT | Streamed read with a byte cap before parse; triage character cap. |
| REVIEW REQUIREMENT | Standard independent review. |
| DISPOSITION | OPEN — IMPLEMENTATION REQUIRED |

### TSB-F07 — Persisted triage context is consumed without a structural or size contract

| Field | Record |
|---|---|
| ID | TSB-F07 |
| SEVERITY | LOW |
| BOUNDARY | TSB-037, TSB-039 |
| CATEGORY | Producer-side bounds not re-established at consumption |
| FILES / SYMBOLS | `analyze-failure.js`: `readContext` (`:55`), `buildFailureReport` (`:651`). `qa-agent-prompt.js`: `buildUserPrompt` (`:231-242`). `aggregate-browser-context.js`: `readBrowserInputs`. Producer caps in `collect-context.js` (`MAX_FILE_BYTES`, `MAX_TOTAL_RELEVANT_BYTES`). |
| CURRENT BEHAVIOR | `context.json` (and aggregated browser inputs) are `JSON.parse`d. `relevantFiles`, `collectorWarnings`, `knownProjectConstraints` and `history` are forwarded verbatim into the provider prompt with no shape validation and no re-application of producer caps. |
| EXPECTED CONTRACT | The analyzer validates the context against a closed, bounded schema equal to the collector's output contract (or re-projects it) before prompt construction, independent of provenance. |
| SAFE EVIDENCE REFERENCE | Probe P-06 (§18). |
| SECURITY IMPACT | Unbounded, unvalidated content can be sent to a credentialed external provider (cost / availability, plus confidentiality amplification of the XI-01 path). Prompt size and shape depend on whoever wrote the file. |
| ARCHITECTURE / API IMPACT | Analyzer input contract of exported `analyzeFailure.main`. Distinct from XI-01 (provenance / binding) and XI-02 (embedded history eligibility), and neither re-rates nor absorbs them. |
| CONTROLLED-V1 RELEASE IMPACT | `CONTROLLED_V1_BLOCKER: CONDITIONAL` — same capability condition as XI-01 / XI-02 (triage enabled). |
| CORRECTIVE REQUIREMENT | Consumer-side closed, bounded context schema (or deterministic re-projection with caps) before any provider call. Negative tests for oversized / misshapen fields. |
| REVIEW REQUIREMENT | Independent Security review, co-ordinated with the XI-01 / XI-02 correctives (SADR-05 / FI-05). |
| DISPOSITION | OPEN — IMPLEMENTATION REQUIRED |

**New finding totals:** 7 — 1 MEDIUM (F01), 6 LOW (F02–F07). Controlled-v1 blocker classification: 0 YES, 6 CONDITIONAL (F01, F02, F03, F04, F05, F07), 1 NO (F06), 0 UNKNOWN.

## 21. Unknown / insufficient evidence

| ID | Item | Why insufficient | Effect on this audit |
|---|---|---|---|
| TSB-U01 | Controlled execution on Windows | Node 22 refuses `.cmd` under `shell:false` (EINVAL), so execution yields `EXECUTION_ERROR`; 6 unit cases skip on Windows | Platform-specific, fail-closed; consistent with Controlled-v1 prerequisite 6; no finding |
| TSB-U02 | TB-10 Windows path normalization (short names, alternate data streams, trailing characters) against `isProtectedPath` | Not empirically exercised here | Existing TB-10 unchanged; TSB-F01 makes the denylist absent at consumption regardless |
| TSB-U03 | Real-provider truncation / safety-block behavior (`finish_reason` / `finishReason`) | No live-provider testing authorized | Downstream parsers fail closed on malformed text; recorded only |
| TSB-U04 | Substance of `C2-SR-01` / `C2-SR-02` | Content not restated in tracked files | Preserved as labels and dispositions only |
| TSB-U05 | Operational behavior of governance 1F with a live CI-evidence adapter | Tooling not CI-wired; no live adapter exists | TSB-043 PARTIAL |
| TSB-U06 | POSIX-only unit cases (permission mode, procfs) | Skipped on this host; executed by ubuntu CI | No claim depends on them |

No boundary is scored `UNKNOWN`. Each item above is bounded and named.

## 22. Controlled-v1 impact

| Finding | Severity | Blocker | Exact condition |
|---|---|---|---|
| TSB-F01 | MEDIUM | CONDITIONAL | Generated-change safe application (#23F) enabled |
| TSB-F02 | LOW | CONDITIONAL | Any consumer other than #23F application relies on an approval gate without independent per-decision checks |
| TSB-F03 | LOW | CONDITIONAL | Controlled execution (#23G / RC-08) enabled |
| TSB-F04 | LOW | CONDITIONAL | CI failure triage / PR reporting in the enabled scope |
| TSB-F05 | LOW | CONDITIONAL | ProjectProfile-consuming capabilities exposed through the supported external surface |
| TSB-F06 | LOW | NO | — |
| TSB-F07 | LOW | CONDITIONAL | CI failure triage in the enabled scope (same as XI-01 / XI-02) |
| XI-01 / XI-02 | MEDIUM | Unchanged existing disposition | `IMPLEMENTATION_REQUIRED_BEFORE_CONTROLLED_RELEASE_WHEN_AFFECTED_CAPABILITY_ENABLED` |

**Path classification.**

| Category | Findings |
|---|---|
| Current operational path | F04, F07 (CI triage on pull requests); F06 for the Groq adapter |
| Supported public API | F05 (`assertValidProjectProfile`); F04 / F07 output and input contract of `analyzeFailure.main`; F06 Jira / Azure subpath adapters |
| Internal / private only (#23, not packaged) | F01, F02, F03 |
| Platform-specific | TSB-U01 |
| Future / hypothetical | F02's latent consumer case |
| Governance-only | none |

The Controlled-v1 target chain explicitly includes human approval → safe application → controlled execution (`OD-CONTROLLED-V1-RELEASE-MODEL` §1). If that chain is enabled as planned, F01 and F03 become blockers. This audit **does not approve Controlled Release**.

## 23. Remediation dependency graph

```text
SADR-07 / FI-07 (deterministic authority)            SADR-02 / AT-07 / TB-01 (approval authenticity; existing)
        |                                                        |
        v                                                        v
[R1] shared consumer-side contract revalidation  ----->  TSB-F02 gate re-derivation
        |            \                                   (independent; may land with R1)
        v             v
     TSB-F01        TSB-F03  (also needs record<->change-set binding)
        |
        v
  AISEC-7-style negative cases at TSB-009/010/011/014/015 consumers

SADR-05 / FI-05 (XI-01, XI-02; existing, separately authorized)
        |
        +--> TSB-F07 consumer-side context schema/caps  (co-design; neither satisfies the other)
        |
        +--> TSB-F04 result<->test binding + closed report schema  (versioned ai-report.json)
                    ^
                    |
              TSB-F06 triage pre-parse bound (shares the parse site); adapter byte caps independent

TSB-F05: architecture decision (public validator compatibility)  -->  closed snapshotting ProjectProfile
         --> prerequisite for any authentic profile<->root<->context join (SADR-01, XI-01)
```

Ordering constraints:

1. F01 before F03, since both share the revalidation primitive.
2. The F05 decision before any change to `assertValidProjectProfile`.
3. F04, F07 and the XI correctives are designed together, but each keeps its own acceptance evidence.

No remediation is performed or authorized by this document.

## 24. Future MEM / RAG / LEARN requirements

These are design-time requirements derived from this audit. They are not activated.

1. **Persisted state** (MEM) must be validated at every consumer against a closed, bounded schema. Producer-side validation must never be credited to a consumer. This generalizes TSB-F01, TSB-F03 and TSB-F07.
2. **Self-digests** are integrity checks only. MEM/RAG records must not use unkeyed self-digests as authenticity or authorization evidence; provenance needs an authenticated binding (SADR-01 / 02 / 06).
3. **Derived fields** (status, eligibility, scope) must be recomputed from source fields at consumption, never trusted as stored. This generalizes TSB-F02.
4. **The knowledge corpus** (the RAG seed, TSB-021) must move to a closed, bounded, versioned unit schema with per-unit provenance and project scope before any retrieval layer or learned/generated unit is introduced. The current openness is acceptable only because the units are curated, repository-committed and projected to `{id, statement}`.
5. **Identity contracts stated in prompts** (for example triage rule 7) must have deterministic enforcement before model outputs are written to memory or used for learning (TSB-F04). Otherwise mis-bound outputs become training or retrieval data (AT-10 / AT-11).
6. **Size bounds** must apply before parse at every ingestion point that feeds memory (TSB-F06 / F07).
7. **Cross-project isolation** must hold at the consumer even for same-shape data: XI-01 / XI-02 / AT-11 remain design inputs.

## 25. Explicit non-authorities

This artifact does **not**:

- remediate, close, waive, re-rate, risk-accept or absorb any finding (new or existing);
- approve Controlled Release, any SADR-11 dossier, or Full Autonomy;
- activate MEM / RAG / LEARN, any ODR disposition, or any FI / FV workstream;
- modify production / runtime code, scripts, tests, fixtures, `.github`, `package.json`, lockfiles, API / export surfaces, configuration or `ROADMAP.md`;
- authorize a merge, close Issue #226, or change any canonical ROADMAP state;
- certify itself.

Its probes were offline, scratch-only and untracked. No real secret, credential, live provider or destructive procedure was used.

## 26. Final audit disposition

```text
AUDIT:                 Type & Schema Boundary Audit v1 — repository-wide
BASELINE:              9e09027c1973171b168ae25edbfecae79e4a2dc3 / TREE d7c8c497d487c90ba3d6bcb135970aef1b8a9f35
TRACKED FILES:         439 (55 BOUNDARY_SURFACE, 47 CONTRACT_MODEL, 78 BOUNDARY_SUPPORT,
                       226 TEST / FIXTURE, 33 NO_RELEVANT_BOUNDARY, 0 UNKNOWN)
BOUNDARIES:            46 (19 PASS, 19 PARTIAL, 8 GAP, 0 UNKNOWN, 0 NOT_APPLICABLE)
UNIT TESTS (Node 22):  5627 / 5618 pass / 0 fail / 9 skip
NEW FINDINGS:          7 — TSB-F01 MEDIUM; TSB-F02..F07 LOW; all OPEN
CONTROLLED-V1:         CONDITIONAL blockers F01, F02, F03, F04, F05, F07; F06 NO
EXISTING:              XI-01 / XI-02 OPEN / MEDIUM / UNCHANGED;
                       C2-SR-01 / C2-SR-02 LOW / NON-BLOCKING / UNRESOLVED
UNKNOWN / INSUFFICIENT: TSB-U01..U06 (bounded; no boundary scored UNKNOWN)
CONTROLLED RELEASE:    NOT APPROVED
MEM / RAG / LEARN:     NOT ACTIVATED
STATUS:                ARTIFACT DELIVERED FOR GOVERNANCE VALIDATION AND INDEPENDENT REVIEW
```
