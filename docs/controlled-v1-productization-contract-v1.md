# Controlled-v1 Productization Contract v1

Lifecycle: **Controlled-v1 supported package/API/CLI/productization boundary**

Authority: `OD-CONTROLLED-V1-PRODUCTIZATION-DESIGN — APPROVED`

State: **DESIGN ACTIVE / SOLE WIP** (`WIP = 1`)

Document type: **architecture / contract design + repository discovery.** This
document changes no runtime code, test, workflow, package manifest, export, CLI
or version. Implementation is **NOT AUTHORIZED**. Merge is **NOT AUTHORIZED**.
Controlled Release is **NOT APPROVED**.

Date: 2026-10-10

Revision: **C1 design corrective** (resolves Architecture review `ARCH-PROD-M01`
and `ARCH-PROD-m01..m07` against rejected head `1c6376f3`; see §26).

---

## 1. Executive decision

| Decision | Result |
|---|---|
| Primary installation model | **npm package** (`npm install` of a versioned `qa-ai-agent` tarball as a `devDependency` of the target repository) |
| Secondary integration | **Documented, target-owned GitHub Actions workflow example** that invokes the packaged CLI. No published GitHub Action / reusable workflow, no Docker/OCI image, no Kubernetes in Controlled-v1 |
| Controlled-v1 CLI | **`CONTROLLED-V1 CLI = REQUIRED`** — one package binary, `qa-agent`, with a closed, narrow command set |
| Public programmatic API | **Unchanged.** The existing 19 root names and 5 `exports` keys remain the supported API, byte-for-byte. **No new root export, no new subpath.** The `#22`/`#23` generative chain is exposed **only** through the CLI |
| Configuration | One target-owned, non-executable, versioned JSON file: `qa-agent.config.json` (`schemaVersion: 1`). Secrets are never in it |
| Generative chain exposure | The private `#22`/`#23` trees would become **shipped private runtime dependencies** of the CLI — shipped but **not exported / unsupported for consumer import** — only after the Product Owner dispositions OD-02 (physical distribution change reversing A-1 exclusion, §22) |
| Generative provider requirement | `design` / `plan` / `generate` require an allowed provider capable of the generative contract. The shipped `MockProvider` is a **triage** mock, not a generative engine: with `mock` or `--offline` these commands **fail closed** before generation (`CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`, §10.4) |
| `--offline` | Network/provider-disabled execution mode for commands with a real deterministic/offline implementation. **Not** a promise of offline AI generation |
| Human control | Preserved. No autonomous commit, push, PR, review approval, merge or release. Approval recording and application are human-gated and disabled by default |
| `TSB-F02` trigger | **`TSB-F02 TRIGGER = FALSE`**, under binding design constraints DC-F02-1..DC-F02-5 (§18) |
| Full Project Independence | **`FULL PROJECT INDEPENDENCE = PRESERVED`** (§20) |

The productized surface is:

```text
target repository
  ├── package.json            devDependency: qa-ai-agent@<exact version>
  ├── qa-agent.config.json    target-owned declarative config (schemaVersion 1)
  └── (optional) .github/workflows/<team-named>.yml   target-owned, copied example
        ↓  npx qa-agent <command>      (supported CLI)
        ↓  require("qa-ai-agent")      (supported 19-name API, unchanged)
QA AI Agent supported product surface (installed package, node_modules/)
        ↓
private internal implementation (shipped but not exported / unsupported for consumer import)
```

"Not exported" is a **supported-surface** statement, not filesystem isolation:
Node `exports` blocks resolution of unlisted subpaths through package
specifiers (`require("qa-ai-agent/scripts/...")` → `ERR_PACKAGE_PATH_NOT_EXPORTED`),
but every shipped file remains technically addressable through an absolute
`node_modules/...` path. Such access is **unsupported and outside the public
contract**. Likewise, capability gating (§10.4.4) is a supported-surface
control, **not a security isolation boundary**: code running in the consumer's
process with the consumer's privileges can bypass it.

---

## 2. Scope

This design defines, for Controlled-v1 only:

1. the repository-grounded inventory of the current product surface (§5, §6);
2. the installation model (§7, §8);
3. the public package contract (§9);
4. the CLI decision and contract (§10);
5. the configuration contract (§11);
6. the maximum target-repository footprint (§12);
7. six target-user journeys (§13);
8. the artifact/output contract (§14);
9. version, upgrade, rollback and uninstall rules (§15);
10. preservation of existing security/trust boundaries for every proposed surface (§16);
11. the human-control matrix (§17);
12. the mandatory `TSB-F02` trigger analysis (§18);
13. the RC-01..RC-12 mapping (§19);
14. the interface a later `qa-agent-demo` consumes (§20);
15. the C1 corrective record (§26).

## 3. Non-scope

This design does **not**:

- implement anything, or authorize implementation;
- change `scripts/**`, `test/**`, `.github/workflows/**`, `package.json`,
  `package-lock.json`, exports, `files`, `bin`, version, tags or releases;
- create `qa-agent-demo`;
- publish any package or choose a registry account;
- design Full Autonomy, MEM, RAG or LEARN;
- remediate `TSB-F02`, `AT-07`/`TB-01`, `FUTURE_WINDOWS_EXECUTION_CAPABILITY_GUARD`
  or any other finding;
- decide approval authenticity (`ODR-02`), host isolation (`ODR-06`/`ODR-07`)
  or any other `ODR-*` disposition;
- design signing or key management;
- change `ROADMAP.md` (`NO ROADMAP CHANGE`, §25.2).

## 4. Certified baseline

```text
repository:  TarasovArtem/qa-ai-agent
main:        af1c922f4e5d8d4dbe1bc3718ab314739c4c664f
tree:        89cbbbf6431ceb477ea6a1376692a13b9cdf9d8a
certified:   workflow #629, run 38046291592, event push, completed/success, 7/7 jobs
branch:      design/controlled-v1-productization-boundary (parent = main above)
```

Pre-edit verification performed: `git fetch origin`; `origin/main` equals the
baseline; the branch head equals the baseline; working tree clean; the
unrelated `stash@{0}` preserved untouched.

---

## 5. Repository inventory

All facts below were read from the baseline tree.

### 5.1 Package manifest (`package.json`)

| Field | Value at baseline | Consequence |
|---|---|---|
| `name` | `qa-ai-agent` | registry availability unverified (§22 OD-03) |
| `version` | `1.0.0` | no tag/release/publication exists; the number is not a release claim |
| `type` | **absent** → CommonJS | `require()` is the supported module system |
| `engines` | `node: "22.x"` | Node 22 is the only supported runtime |
| `main` | `scripts/ai/index.js` | |
| `exports` | `.`, `./providers/jira`, `./providers/azure-devops`, `./destinations/azure-devops`, `./package.json` | deep imports blocked (`ERR_PACKAGE_PATH_NOT_EXPORTED`) |
| `bin` | **absent** | no supported executable today |
| `dependencies` | **absent** — zero runtime dependencies | installs add nothing transitive |
| `devDependencies` | `@playwright/test`, `cypress`, `mochawesome` | repository-only; not installed for consumers |
| `files` | `scripts/ai` minus tests, `__fixtures__`, `evaluation`, `generation`, `generative-test-design`, `test-automation`, and three CI helpers | the `#22`/`#23` generative chain is physically **not shipped** |
| `scripts` | Cypress/Playwright runners, `ai:collect`/`ai:history`/`ai:analyze` (Targomo-bound), `eval:*` v1..v6, `test:unit` | all repository-development scripts; none is a consumer contract |
| `license` | MIT | |

Publication assumptions: none encoded. No `publishConfig`, no `private` flag,
no `prepublishOnly`/`prepack` hook. `ID-3` (ROADMAP §12) owns the still-open
publication decision.

### 5.2 `npm pack --dry-run` (actual, at baseline)

```text
package:        qa-ai-agent@1.0.0
filename:       qa-ai-agent-1.0.0.tgz
total files:    47
package size:   224.3 kB
unpacked size:  755.6 kB
shasum:         92cfdeb0e6271ca9540c4c2f7675c536f7ecf4e4
```

Shipped surface (47): `LICENSE`, `README.md`, `package.json`, and 44 files
under `scripts/ai/`:

```text
adapters/cypress-adapter.js            adapters/playwright-adapter.js
agent-policy.js                        aggregate-browser-context.js
analyze-failure.js                     bounded-response.js
collect-context.js                     collect-history.js
config.js                              context-utils.js
correlation-projection.js              destinations/azure-devops-test-case-destination.js
framework-runtime-config.js            index.js
knowledge/loader.js                    knowledge/schema.js
knowledge/selector.js                  knowledge/units/*.json (6 data files)
project-knowledge-config.js            project-profile.js
providers/azure-devops-requirements-provider.js
providers/gemini-provider.js           providers/groq-provider.js
providers/index.js                     providers/jira-requirements-provider.js
providers/mock-provider.js             providers/provider-contract.js
providers/provider-error.js            qa-agent-prompt.js
repository-root.js                     requirement-artifact.js
requirement-quality.js                 requirement-traceability.js
requirements-file.js                   requirements-source-provider.js
runtime-framework-selector.js          test-design-publishing.js
test-design.js                         triage-boundary-contract.js
```

Classification of shipped internals: every shipped `.js` file other than
`index.js` and the three subpath targets is a **shipped private runtime
dependency** (`SHIPPED_PRIVATE_RUNTIME_DEPENDENCY`, `docs/package-surface-v2.md`).
Shipping a module does **not** make it public; it is reachable only through a
supported entrypoint. The closure/minimality invariants are enforced on the
real tarball by `test/installation/package-surface.test.js`.

Not shipped: `scripts/ai/generation/**`, `scripts/ai/generative-test-design/**`,
`scripts/ai/test-automation/**`, `scripts/ai/evaluation/**`,
`scripts/ai/__fixtures__/**`, `scripts/ai/**/*.test.js`,
`scripts/ai/format-pr-comment.js`, `scripts/ai/normalized-failure.js`,
`scripts/ai/pr-comment-client.js`, `scripts/targets/**`,
`scripts/governance/**`, `scripts/diagnostics/**`, `test/**`, workflows.

### 5.3 Public API (actual)

Root entrypoint `scripts/ai/index.js` — 19 names (verified by reading the
module and by `test/installation/package-surface.test.js`):

| Name(s) | Source module | Classification |
|---|---|---|
| `collectContext.{main,runCli}`, `collectHistory.main`, `analyzeFailure.main`, `aggregateBrowserContext.main` | triage pipeline | **PUBLIC / SUPPORTED** |
| `assertValidProjectProfile` | `project-profile.js` | **PUBLIC / SUPPORTED** (v3 strict snapshot, `docs/package-surface-v3.md`) |
| `assertValidFrameworkRuntimeConfig`, `assertValidProjectKnowledgeConfig`, `assertValidRepositoryRoot` | config/root validators | **PUBLIC / SUPPORTED** |
| `assertValidRequirementArtifact`, `loadRequirementsFromFile`, `loadRequirementsFromProvider` | RTI-1/2/6 | **PUBLIC / SUPPORTED** |
| `analyzeRequirementQuality`, `analyzeRequirementsQuality` | RTI-3 (deterministic) | **PUBLIC / SUPPORTED** |
| `generateTestDesign`, `generateTestDesigns`, `assertValidTestDesignArtifact` | RTI-4 (deterministic) | **PUBLIC / SUPPORTED** |
| `buildRequirementTraceability`, `analyzeRequirementsCoverage` | RTI-5 | **PUBLIC / SUPPORTED** |
| `publishTestDesigns` | RTI-8B | **PUBLIC / SUPPORTED** |

Subpaths: `./providers/jira`, `./providers/azure-devops`,
`./destinations/azure-devops` — **PUBLIC / SUPPORTED**.

Other classes:

| Surface | Classification | Evidence |
|---|---|---|
| `validateProjectProfile`, `inspectProjectProfile`, adapters, `selectRuntimeAdapter`, `context-utils`, knowledge loader/selector/schema, provider implementations (`mock`/`groq`/`gemini`), `createProvider`, `triage-boundary-contract` | **INTERNAL / SHIPPED** | `scripts/ai/index.js` "DELIBERATELY NOT EXPORTED"; `docs/package-surface-v3.md` |
| `#22` `generative-test-design/**`, `#23` `test-automation/**`, `generation/**` | **INTERNAL / NOT SHIPPED** (`REPOSITORY_ONLY_PRIVATE`, A-1 `PRIVATE_GENERATIVE_SURFACE`) | `package.json` `files`; `docs/package-surface-v2.md` |
| `format-pr-comment.js`, `normalized-failure.js`, `pr-comment-client.js` | **INTERNAL / NOT SHIPPED** (`REPOSITORY_ONLY_CI_HELPER`) | `docs/package-surface-v2.md` |
| `scripts/ai/evaluation/**`, `__fixtures__`, `*.test.js`, `test/**`, `test/helpers/**` | **TEST-ONLY** | `package.json` `files`, `test:unit` |
| `scripts/targets/targomo/**`, `scripts/targets/project-b/**` and the `ai:*` npm scripts | **LEGACY / UNSUPPORTED** as a consumer surface (dogfood targets of this repository) | `scripts/ai/index.js` docstring; `scripts/targets/targomo/analyze-failure.js` |

Consumer documentation: `README.md` (developer quick start, `local-v1`
triage), `PUBLISHING.md` (destination authoring), `docs/package-surface-v2.md`
/ `-v3.md`. There is no end-user install/configure/run guide for an external
team.

### 5.4 Existing CLI / executable surface (actual)

| Surface | Invocation | Supported end-user CLI? |
|---|---|---|
| `package.json` `bin` | none | — |
| `npm run ai:collect` / `ai:history` / `ai:analyze` | `node scripts/targets/targomo/*.js` (shebang `#!/usr/bin/env node`, Targomo-bound profile/root) | **No** — repository dogfood bootstraps; not shipped |
| `npm run eval:*`, `test:unit`, Cypress/Playwright scripts | repository development | **No** |
| `collectContext.runCli(...)` | programmatic function, env-driven framework selection (`QA_FRAMEWORK`) | API, not a CLI |
| `scripts/diagnostics/*.sh`, `scripts/governance/**` | repository maintenance | **No** |
| GitHub workflow `.github/workflows/cypress.yml` | `npm ci` then `npm run ai:collect` / `ai:history` / `ai:analyze`, with `QA_FRAMEWORK`, `TEST_BROWSER`, `HISTORY_JOB_NAME`, `GITHUB_TOKEN`, `AI_PROVIDER`/`AI_MODEL`/`AI_API_KEY` | **No** — repository CI wiring |

Exit-code assumptions: target bootstraps set `process.exitCode = 1` on any
thrown error and write `[ai:analyze] Error: …` to stderr; there is no exit-code
taxonomy. **Conclusion: no supported end-user CLI exists today.**

### 5.5 Configuration inputs (actual)

| Input | Where read | Owner class |
|---|---|---|
| `ProjectProfile` v1 (`id`, `displayName`, `knownProjectConstraints`) | passed by caller to `*.main()`; strict snapshot | **target-owned** |
| `repositoryRoot` (absolute, real directory) | passed by caller; `assertValidRepositoryRoot` (lexical + real root) | **target-owned / trusted orchestration input** |
| `FrameworkRuntimeConfig`, `ProjectKnowledgeConfig` | passed by caller | **target-owned** |
| `AI_PROVIDER` (`mock` default, `groq`, `gemini`), `AI_MODEL`, `AI_API_KEY` | env, read at module load by `scripts/ai/config.js` | provider selection **operator/environment-owned**; key is a **secret** |
| `QA_FRAMEWORK`, `TEST_BROWSER`/`BROWSER`/`CYPRESS_BROWSER` | env | **invocation** |
| `QA_AI_INVOCATION_MODE=local-v1`, `QA_AI_INVOCATION_ID` | env (`triage-boundary-contract.js`) | **invocation identity (trusted runtime)** |
| `GITHUB_ACTIONS`, `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_*` | env | **platform-provided invocation identity** |
| `GITHUB_TOKEN`, `HISTORY_RUNS`, `HISTORY_BRANCH`, `HISTORY_JOB_NAME` | env (`collect-history.js`) | token is a **secret**; others invocation |
| Jira / Azure DevOps credentials and selectors | provider/destination constructor options | target-owned selectors; credentials are **secrets** |
| `reports/ai/context.json`, `history.json`, `ai-report.json`, `browser-inputs/**` | fixed paths under `repositoryRoot` | **runtime / transient evidence** |
| `#22`/`#23` artifacts (RequirementModel, TestCaseModel, AutomationCandidate, AutomationPlan, GeneratedChangeSet, review package/record, AppliedChangeSetRecord, AutomationExecutionRecord) | in-memory objects today; no persisted product location | **runtime evidence** (no product contract yet) |

Separation:

- **Product-owned configuration:** provider implementations and their
  vocabulary, schema versions, size bounds, invocation-mode vocabulary,
  protected-path policy, framework path prefixes, execution env allowlist.
  None of it is target-editable.
- **Target-repository-owned configuration:** ProjectProfile, framework choice,
  runtime/knowledge config, requirements source, capability enablement,
  output directory. Today supplied as code (bootstrap scripts); proposed as one
  JSON file (§11).
- **Runtime/transient evidence:** everything under `reports/ai/**` and the
  proposed `reports/qa-agent/**`; invocation ids; provider responses.

### 5.6 External installation (actual)

`test/installation/external-repository-proof.test.js` (with
`external-repository-proof-fail-closed.test.js` and `package-surface.test.js`):

1. **Install:** runs real `npm pack` in the checkout, creates an external
   directory with `fs.mkdtempSync` outside the checkout, and runs real
   `npm install <tarball>` there.
2. **Configure:** writes an ephemeral runner script *into the external
   repository* that constructs its own ProjectProfile, repositoryRoot,
   FrameworkRuntimeConfig and ProjectKnowledgeConfig in code.
3. **Execute:** runs `node <externalRepo>/id2-runner.js` as a child process so
   that bare `require("qa-ai-agent")` resolves through `exports`; exercises the
   four triage stages; asserts the deep import is blocked and the root export
   set is exactly 19.
4. **Invocation identity:** the orchestrating test generates one fresh
   `QA_AI_INVOCATION_ID` (16 CSPRNG bytes, 32 hex) and sets
   `QA_AI_INVOCATION_MODE=local-v1` in a minimal child environment; it never
   sets `GITHUB_ACTIONS`.
5. **Outputs:** artifacts are written under the external root at
   `reports/ai/*.json`; package immutability is asserted by a content-hash
   manifest of the installed package.

Source-checkout assumptions: **only in the test harness** (it packs from the
checkout to obtain the tarball). The consumer side needs no checkout, no
source-relative path, no test helper and no unpublished module. **Gap:** an
external team must write its own runner script, because no CLI exists; and the
`#22`/`#23` chain cannot be reached at all from an installed package.

### 5.7 Approval-gate consumers (actual, for §18)

| Gate | Defined in | Production call sites |
|---|---|---|
| `validateApprovedGeneratedChangeSetReview` | `scripts/ai/test-automation/generated-change-set-review-record.js` | **only** `applyApprovedGeneratedChangeSet` (`scripts/ai/test-automation/change-set-application.js`), which additionally runs `verifyApprovedChangeBinding` (single `APPROVE` per change, bound to recomputed target digests) |
| `validateApprovedTestDesignReview` | `scripts/ai/generative-test-design/test-design-review-record.js` | **none** (docstring references in `test-design-review-package.js`, `scoring-v6.js`, `regenerate-change-set.js` are comments only; tests and `test/security/aisec-7/review-apply-execute.test.js` are test-only) |

Neither gate is exported from the package, and neither module is shipped.
`scripts/ai/test-automation/controlled-execution.js` does not call either gate
(it consumes `AppliedChangeSetRecord`, bound by the closed `TSB-F03` corrective).

---

## 6. Current product surface — summary

- **Installable:** yes, from a local tarball (ID-2 proof). No registry release.
- **Supported API:** 19 root names + 3 vendor subpaths — triage pipeline,
  config/root validators, deterministic requirements (load, quality,
  test-design, traceability), generic provider/destination executors.
- **Supported CLI:** none.
- **Generative chain (`#22`/`#23`: AI test design → automation plan → generated
  change set → review → apply → execute):** implemented and tested in the
  repository; **not shipped, not exported**. Every `#22`/`#23` generator
  receives a dependency-injected provider; the only shipped offline provider
  (`MockProvider`) implements the triage response shape only and cannot
  produce `#22`/`#23` generative outputs.
- **Invocation identity:** `github-actions-v1` and `local-v1` contracts exist
  and are enforced for triage (XI-01).
- **Configuration:** code-only (consumer writes bootstrap JS); provider by env.

---

## 7. Installation-model analysis

| Criterion | A — npm package | B — GitHub Action / reusable workflow | C — OCI/Docker wrapper |
|---|---|---|---|
| Portability | Any host with Node 22; matches existing proof | GitHub only | Any host with a container runtime |
| Versioning | semver + lockfile integrity (`sha512`) | tag/SHA pin; separate from package version unless it wraps the package | image tag/digest; second version stream |
| Repository footprint | one `devDependency` + one config file | one workflow file (+ config) | none in repo, or a compose/workflow file |
| Local execution | native (`npx qa-agent`) | **gap** — no local run; needs `act` or a second model | possible, but heavy; Windows/macOS file-mount semantics differ |
| CI execution | any CI via `npm ci` + `npx` | native on GitHub | native where container steps exist |
| Upgrade model | change version, `npm install`, lockfile diff reviewable | bump pin | bump tag/digest |
| Ease of adoption | moderate (needs config) | high on GitHub | moderate |
| Lock-in | none | GitHub | runtime |
| Secret handling | env vars set by the caller; never in config | GitHub secrets → env | env into container |
| Execution-model fit | `#23G` resolves the target's **own** local `cypress`/`playwright` binary (`resolveLocalBinary`) from the target's `node_modules` — requires running in the target's Node environment | same as A when it wraps A | container must also contain the target's browsers, framework and `node_modules`; duplicates the target toolchain |
| Cold start / maintenance | lowest; zero runtime dependencies | low, but a second artifact to version and review | image build, base-image patching, registry, scanning |
| Repository evidence | **proven** (`external-repository-proof.test.js`) | none | none |

Kubernetes: **NOT REQUIRED FOR CONTROLLED-V1** (also excluded as a mandatory
requirement by `OD-CONTROLLED-V1-RELEASE-MODEL` §2).

## 8. Selected installation model

**Primary (sole mandatory): Option A — npm package**, installed as an
exact-pinned `devDependency` of the target repository.

**Secondary (optional, non-mandatory): documented GitHub Actions usage** — a
copyable example workflow in consumer documentation that runs
`npm ci` + `npx qa-agent …`. It is target-owned once copied. No separately
published Action or reusable workflow is introduced in Controlled-v1 (that would
create a second versioned artifact and a second review surface without evidence
of need; revisit after `qa-agent-demo`).

**Rejected for Controlled-v1:** Option C (Docker/OCI). It adds a second
version stream, duplicates the target's own framework/browser toolchain that
`#23G` must use, and the release-model decision forbids making it mandatory. It
may be reconsidered as an optional isolation wrapper by the separate
execution-environment assessment (release prerequisite 6), not here.

Package source (distribution channel) remains an open owner decision
(§22 OD-01). The model works identically for a registry package and a
versioned release tarball.

---

## 9. Public package contract

| Surface | Current state | Proposed v1 state | Classification | Reason |
|---|---|---|---|---|
| Root `require("qa-ai-agent")` — 19 names | supported | **unchanged** (same names, same signatures, same behavior) | PUBLIC / SUPPORTED | no breaking change needed; compatibility preserved |
| `./providers/jira`, `./providers/azure-devops`, `./destinations/azure-devops` | supported | unchanged | PUBLIC / SUPPORTED | |
| `./package.json` export | supported | unchanged; `version` field is the canonical product-version query | PUBLIC / SUPPORTED | |
| Package binary `qa-agent` | absent | **added** (`bin`), not listed in `exports` (executable entrypoint only; requiring it is unsupported) | CLI — **NEW PUBLIC CONTRACT DECISION** | §10 |
| `qa-agent.config.json` schema v1 | absent | **added** | CONFIGURATION CONTRACT — **NEW PUBLIC CONTRACT DECISION** | §11 |
| Product artifacts under `reports/qa-agent/` (manifest + typed records) | absent | **added**, versioned | ARTIFACT CONTRACT — **NEW PUBLIC CONTRACT DECISION** | §14 |
| Triage artifacts `reports/ai/context.json`, `history.json`, `ai-report.json` | produced by supported API | unchanged location and schemas; documented as artifact contract | ARTIFACT CONTRACT | already the output contract of exported triage functions |
| `#22` generative modules (`requirement-model-generator`, `test-case-model-generator`, `automation-candidate-generator`, `evidence-ingestion`, review package/record) | repository-only private | **only after OD-02:** shipped but not exported / unsupported for consumer import; supported reachability only through `qa-agent` | INTERNAL / NOT SUPPORTED | prerequisite 7: high-level surface only; physical change = OD-02 |
| `#23` modules (`automation-repository-context`, `automation-plan-generator`, `generate-change-set`, `generated-change-set*`, `change-set-application`, `controlled-execution`, records) | repository-only private | **only after OD-02:** shipped but not exported / unsupported for consumer import; supported reachability only through `qa-agent` | INTERNAL / NOT SUPPORTED | same |
| `generation/**` (shared primitives/limits/errors/models) | repository-only private | **only after OD-02:** shipped as a transitive dependency of the above | INTERNAL / NOT SUPPORTED | closure invariant |
| `regenerate-change-set.js` | repository-only private | **not** reachable from any v1 command; remains unshipped unless closure requires it | INTERNAL / NOT SUPPORTED | outside the RC chain; minimality |
| Both approval gates (`validateApproved*Review`) | private, unexported | **never** exported, never CLI-exposed (DC-F02-1..5) | INTERNAL / NOT SUPPORTED | §18 |
| `format-pr-comment.js`, `pr-comment-client.js`, `normalized-failure.js` | repository CI helpers | unchanged (not shipped); **no PR commenting in the product** | INTERNAL / NOT SUPPORTED | outward write authority kept out of v1 |
| Provider selection env (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`) | de facto | documented as part of the configuration contract | CONFIGURATION CONTRACT | already the only selection mechanism |
| Invocation env (`QA_AI_INVOCATION_MODE`, `QA_AI_INVOCATION_ID`, `GITHUB_*`) | supported (triage) | unchanged; the CLI becomes the orchestrator that sets the local pair (§10.6) | CONFIGURATION CONTRACT | XI-01 |
| `scripts/targets/**`, `ai:*`/`eval:*` npm scripts | repository-only | unchanged; explicitly not product surface | INTERNAL / NOT SUPPORTED | dogfood |
| Programmatic access to the generative chain | none | **none in Controlled-v1** | — | smallest viable surface; a high-level programmatic API is a later decision (OD-07) |

Net change to the public programmatic API: **zero**. Net new public contracts:
**three** (CLI, configuration file, product artifacts), all marked
`NEW PUBLIC CONTRACT DECISION`.

### 9.1 Supported entrypoints and package minimality (implementation requirement)

Once `bin` exists, the package-surface invariants must define:

```text
supported entrypoints = exports ∪ bin
```

not `exports` alone. Closure and minimality are computed from that union, so
every shipped file must be reachable from a supported export **or** from the
`qa-agent` binary, and nothing else may be shipped. Future tests (not modified
in this design) must cover:

- exact tarball inventory (closed list, not a subset check);
- exact `exports` map (unchanged five keys);
- `bin` presence and exact target;
- deep-import denial through package specifiers for every shipped non-entry
  file, including every newly shipped `#22`/`#23`/`generation` file;
- CLI resolution from an **installed tarball** (`npx qa-agent` in an external
  directory, no checkout);
- no accidental public subpath (no new `exports` key, no wildcard pattern).

Deep-import denial proves the supported-surface property only; per §1 it does
not prove, and must not be described as, filesystem isolation.

---

## 10. CLI decision and contract

```text
CONTROLLED-V1 CLI = REQUIRED
```

Why: (1) the `#22`/`#23` chain must be reachable through a supported
high-level surface (release prerequisite 7) and the CLI achieves that with zero
new programmatic API; (2) without a CLI every adopting team must write and
maintain bootstrap code (the current Targomo pattern), which contradicts
"minimally invasive / declarative"; (3) the CLI is the natural owner of the
`local-v1` "orchestrating process" obligation (XI-01); (4) the same command line
serves local and GitHub Actions usage.

### 10.1 Binary and placement

- Binary name: **`qa-agent`** (`package.json` `bin`), invoked as
  `npx qa-agent …` from the target root.
- The binary file is **not** in `exports`; requiring it is unsupported.
- The binary is a Node script with a `#!/usr/bin/env node` shebang; npm
  generates platform shims for `bin` entries. Cross-platform packaging
  behavior of the shim is an implementation verification item (§21), and
  platform **support** is a Product Owner decision (§22 OD-06), not implied by
  the shim existing.
- No global install is required or documented.

### 10.2 Command hierarchy (closed set)

| Command | Purpose | RC | Authority class | Provider requirement | `--offline` | Side effects |
|---|---|---|---|---|---|---|
| `qa-agent --version` | print product version | RC-12 | **baseline** (always available) | none | valid | none |
| `qa-agent --help`, `qa-agent <command> --help` | usage | — | baseline | none | valid | none |
| `qa-agent info [--json]` | version, schema versions, requested vs available capabilities, effective provider resolution (no network call), detected invocation mode, platform decision status | RC-01, RC-11 | baseline | none | valid | none |
| `qa-agent config validate` | validate `qa-agent.config.json` and every embedded contract with the existing fail-closed validators | RC-01 | baseline | none | valid | none |
| `qa-agent requirements check` | deterministic: load file requirements → quality analysis → deterministic test designs → traceability/coverage | RC-02, RC-03, RC-04 (deterministic) | **baseline** — deterministic, no provider, no repository mutation; **not** capability-gated | none | valid | writes artifacts under `output.dir` only |
| `qa-agent design` | AI-assisted `#22`: evidence ingestion → RequirementModel → TestCaseModel → AutomationCandidate | RC-04 | gated: `capabilities.design` | **generative-capable provider required** | **refused** (exit 5) | provider call; run artifacts |
| `qa-agent plan` | `#23B/C`: repository context → AutomationPlan for `AUTOMATE` candidates | RC-05 | gated: `capabilities.plan` | generative-capable provider required | refused (exit 5) | provider call; run artifacts |
| `qa-agent generate` | `#23D/E`: GeneratedChangeSet + GeneratedChangeSetReviewPackage (proposal only, no repository write) | RC-06 | gated: `capabilities.generate` | generative-capable provider required | refused (exit 5) | provider call; run artifacts |
| `qa-agent review show --run <id>` | render the review package (targets, before/after, digests) for a human; **non-authoritative**; never calls an approval gate and never prints an approval verdict | RC-07 (presentation) | gated: `capabilities.generate` (it only presents `generate` output) | none | valid | none |
| `qa-agent review record --run <id>` | **reserved** Controlled-v1 surface | RC-07 | gated: `capabilities.reviewRecord`; **release-disabled until OD-04** | none | — | **fixed refusal only** (exit 5, `CAPABILITY_NOT_ENABLED_IN_RELEASE`); no input is read |
| `qa-agent apply --run <id>` | **reserved**; future `#23F` `applyApprovedGeneratedChangeSet` — the **only** consumer of the approval gate | RC-07 → application | gated: `capabilities.apply`; **release-disabled until OD-04** | none | — | fixed refusal only (exit 5) |
| `qa-agent execute --run <id>` | **reserved**; future `#23G` `executeAppliedChangeSet` | RC-08 | gated: `capabilities.execute`; **release-disabled until OD-06** | none | — | fixed refusal only (exit 5) |
| `qa-agent triage run` | local one-process triage: collect → analyze (optional history) | RC-09 (failure evidence) | gated: `capabilities.triage` | any allowed provider; `mock` supported (triage is the contract it implements) | valid without history; requesting the history stage under `--offline` is refused (exit 5) | provider call unless `mock`; `reports/ai/**` |
| `qa-agent triage collect \| history \| aggregate \| analyze` | per-stage triage for multi-job CI | RC-09 | gated: `capabilities.triage` | `analyze`: any allowed provider incl. `mock`; others: none | valid except `history` (GitHub History API = network) | as today |

**Authority classes.** *Baseline* commands are always available, take no
capability flag, call no provider and mutate nothing outside `output.dir`.
`requirements check` is deliberately baseline (the smallest authority model:
it exposes only already-public deterministic API functions). *Gated* commands
require their capability to be both requested by config and enabled in the
installed release (§10.4.4). *Reserved* commands exist in the command taxonomy
so the surface shape is stable, but before their owner decision their only
implementation is a fixed refusal: `review record`/`apply` before OD-04,
`execute` before OD-06. No design text here implies that approval recording,
application or controlled execution is product-ready.

No other command is supported. In particular there is **no** `commit`, `push`,
`pr`, `merge`, `publish`, `release`, `review verify`/`review status`, or
`regenerate` command in Controlled-v1. Test-design publishing to external
systems (`publishTestDesigns`) and remote requirements providers stay
**API-only** in v1.

### 10.3 Config lookup and repository-root selection

- Repository root = `--root <dir>` if given, otherwise `process.cwd()`. **No
  upward directory search** (prevents silently binding to a parent repository).
- The root is validated with the existing `assertValidRepositoryRoot`
  (absolute, real, directory; lexical + canonical boundaries).
- Config = `<root>/qa-agent.config.json` exactly, or `--config <path>` which
  must resolve canonically **inside** the root. Missing/invalid config →
  exit 3, no side effects.
- The root is **never** derived from config content, AI output, artifact
  content or environment other than the explicit flag / cwd.

### 10.4 Authority precedence: mode, provider, framework, capabilities

All authority is resolved **once, before any provider/config module is
loaded and before any side effect**, in this fixed order. The first failing
step decides the exit code (§10.7). No step may be satisfied by a later
step, and no contradiction is resolved by silently preferring one source.

#### 10.4.1 `--offline` semantics

`--offline` is a **network/provider-disabled execution mode**:

- it is valid for commands with a real deterministic/offline implementation
  (all *baseline* commands, `review show`, `triage collect`/`aggregate`, and
  `triage analyze`/`triage run` with `mock`);
- it disables every external network integration (AI providers and the GitHub
  History API);
- it is **not** a promise of offline AI generation. No current shipped
  provider can produce `#22`/`#23` generative outputs offline.

#### 10.4.2 Effective provider resolution

1. **Mode.** If `--offline` is set, the only admissible provider is `mock`.
   If `AI_PROVIDER` is also set to a network provider, that is a contradiction
   → refuse (exit 5, `OFFLINE_PROVIDER_CONTRADICTION`); the CLI does not pick
   one silently.
2. **Requested provider.** `AI_PROVIDER` from the supported environment, or
   `mock` if unset (the existing `scripts/ai/config.js` default). An
   unrecognized name → exit 3 (`PROVIDER_CONFIGURATION_INVALID`). There is no
   `--provider` flag.
3. **Config ceiling.** The requested (or offline-forced) provider must appear
   in validated `providers.allow` (default `["mock"]`); otherwise → exit 5
   (`PROVIDER_NOT_ALLOWED`) before any network call. This applies to `mock`
   too: config can forbid it.
4. **Capability fit.** The effective provider must implement the contract the
   command needs:
   - triage commands: any allowed provider, including `mock` (its documented
     purpose is the triage contract);
   - `design` / `plan` / `generate`: a **generative-capable provider** — in
     Controlled-v1 only the shipped network providers (`groq`, `gemini`), each
     subject to the existing provider contract. If the effective provider is
     `mock`, or `--offline` is active, the command refuses **before
     generation** with exit 5 and reason code
     `CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`. It never fabricates output and
     never falls back to `MockProvider`.
5. **Provider configuration.** Missing `AI_MODEL`/`AI_API_KEY` for the
   selected network provider (the existing `ProviderError`
   `CONFIGURATION` path at provider creation) → exit 3, still before any
   network call.

There is no automatic cross-provider fallback at any step. Whether a given
provider/model actually yields output that passes the `#22`/`#23` closed
validators is **not** guaranteed by selecting it; output that fails validation
is a provider failure (exit 6), never a success.

A deterministic generative provider (fixture/replay engine able to drive
`design → plan → generate` offline) is **not** part of Controlled-v1 and is
not designed here: `NEW OWNER/DESIGN DECISION REQUIRED`.

#### 10.4.3 Framework authority

- `qa-agent.config.json` `framework` is the **sole supported authority** for
  framework selection.
- `QA_FRAMEWORK` is legacy/internal behavior (read today by
  `collectContext.runCli` and `collectHistory.main`). It must not silently
  override config. The CLI translates validated config into the underlying
  call contract explicitly: it selects the adapter from `framework` and passes
  it to `collectContext.main({ adapter, … })` (existing supported parameter),
  and, for stages that still read `QA_FRAMEWORK` internally
  (`collectHistory.main`), sets `QA_FRAMEWORK` to the config value in the
  constructed stage environment (§10.4.5).
- If the ambient environment sets `QA_FRAMEWORK` to a value different from the
  config `framework` → refuse (exit 3, `FRAMEWORK_AUTHORITY_CONTRADICTION`).
  Equal values are accepted. No config-vs-env ambiguity remains.

#### 10.4.4 Capability semantics

Two separate questions, answered separately:

| Question | Answered by | Failure |
|---|---|---|
| **Config schema validity** — is the file well-formed? | strict parse + closed schema: `capabilities` keys are the closed known set, values boolean | unknown key / non-boolean → exit 3 |
| **Runtime capability authorization** — may this invocation run this capability? | `requested (config = true)` **AND** `enabled in the installed release` **AND** any capability-specific prerequisite (e.g. OD-06 platform decision for `execute`) | → exit 5 (`CAPABILITY_NOT_REQUESTED` or `CAPABILITY_NOT_ENABLED_IN_RELEASE`) |

- Every gated capability defaults to **false**.
- Config **may** request a known-but-release-disabled capability (e.g.
  `"apply": true`). That config remains **schema-valid**: `config validate`
  exits 0 and reports the capability as `requested: true, available: false`
  with its reason (stdout/`--json` warning). Invocation of that capability
  returns the authority refusal. Rationale: a release later enabling the
  capability must not require a config edit, and a config must not flip
  between valid and invalid across product versions for reasons outside its
  own content.
- Release enablement is a property of the installed product build, never of
  config, env or flags. Nothing in config can raise it.
- Baseline commands (§10.2) are outside capability gates.

#### 10.4.5 Provider module-load environment (mandatory implementation condition)

Existing modules snapshot provider env **at module load**: `scripts/ai/config.js`
reads `AI_PROVIDER`/`AI_MODEL`/`AI_API_KEY` once; `providers/index.js`,
`groq-provider.js`, `gemini-provider.js` and `analyze-failure.js` import those
constants; `analyzeFailure.main` has **no** provider parameter (its provider
comes from `createProvider()` → the snapshot). Therefore the effective
provider decision of §10.4.2 must be established **before** any of those
modules is loaded, and the env they see must equal that decision.

Allowed architectures:

- **A.** In-process lazy `require` of provider/config modules only after
  resolution, with `process.env` sanitized to the effective values first;
- **B.** Each provider-consuming stage runs in an **isolated child process**
  whose environment is explicitly constructed from a closed allowlist
  (effective `AI_PROVIDER`; `AI_MODEL`/`AI_API_KEY` only for the effective
  network provider and omitted entirely under `--offline`/`mock`; config-derived
  `QA_FRAMEWORK`; the XI-01 invocation pair; required platform `GITHUB_*`).

**Preferred: B.** Repository evidence: the ID-2 external proof already runs
consumers as child processes with a minimal constructed environment, and the
XI-01 `local-v1` contract already models the CLI as an orchestrating parent.
B makes "snapshot equals decision" structural rather than dependent on require
ordering (any earlier transitive `require("qa-ai-agent")` in-process would load
`config.js` prematurely under A). A is permitted only if a test proves no
env-snapshotting module is loaded before resolution.

This design adds **no** provider parameter to `analyzeFailure.main` (that
would change public API and needs separate authorization).

### 10.5 Run identity and run binding

Commands of the generative chain share a **run directory**
`<output.dir>/runs/<runId>/`. `design` (or `plan`, if started there) creates
`runId` = UTC timestamp + 64 random bits; later commands take `--run <id>`.

A run is bound to a **run-semantic configuration projection**, not to a
digest of the whole config file:

```text
RunSemanticProjection v1 (projectionVersion: 1) =
  projectProfile snapshot (id, displayName, knownProjectConstraints)
  framework
  frameworkRuntime (validated snapshot)
  knowledge (validated snapshot)
  requirements.source, requirements.path, digest of the requirements file read
```

Explicitly **excluded** (they do not alter what a run's artifacts mean):
`capabilities`, `providers.allow`, `output.dir`, and any future field not
listed in the projection version. Enabling a capability later therefore never
invalidates a historical run. The effective provider name/model used by each
stage is recorded per stage in the manifest's command history (provenance),
not bound across stages.

The manifest persists `projectionVersion`, the projection digest
(SHA-256 over a canonical serialization), product version and artifact schema
versions. Later commands recompute the projection from the current validated
config and refuse a mismatch of projection digest, projection version, product
version or schema versions → exit 4 (`RUN_BINDING_MISMATCH`). Changing the
projection's content is a new `projectionVersion`.

Persisted artifacts are **untrusted at reload** and re-validated by the
existing consumer-side validators (TSB-F01/F03 posture).

**Integrity scope.** Manifest and per-file digests provide corruption
detection, stale/mismatch detection and binding between artifacts of one run.
They do **not** provide authenticity: an actor able to rewrite both an
artifact and its recorded digest is not detected. Run digests are not
tamper-proof or tamper-authenticated, and no authority (in particular no
approval) is derived from them.

### 10.6 Invocation identity (XI-01)

- If `GITHUB_ACTIONS === "true"`: the CLI sets nothing; `github-actions-v1`
  applies with the platform tuple. The CLI refuses `QA_AI_INVOCATION_MODE`
  being set alongside it (existing contradiction rule).
- Otherwise, for `triage run`, the CLI **is** the orchestrating process: it
  generates one fresh 128-bit CSPRNG id and sets
  `QA_AI_INVOCATION_MODE=local-v1` / `QA_AI_INVOCATION_ID` for all stages of
  that single invocation, never persisting it outside `context.json`.
- For per-stage local commands (`triage collect`/`analyze` separately), the
  caller supplies the pair, exactly as today; the CLI never invents a
  replacement id after context exists.
- The CLI never sets `GITHUB_ACTIONS`.

### 10.7 Exit-code taxonomy

| Code | Meaning |
|---:|---|
| 0 | success (for `execute`: `PASSED`) |
| 1 | unexpected internal error (product bug / invariant violation) |
| 2 | usage error |
| 3 | configuration error — config file **or** provider/framework environment configuration |
| 4 | input refused — non-provider inputs |
| 5 | authority refused |
| 6 | provider failure — anything originating in a provider call or its response |
| 7 | execution infrastructure error (`EXECUTION_ERROR`) |
| 8 | execution timeout (`TIMED_OUT`) |
| 10 | tests ran and **failed** (`TEST_FAILED`) |

Normative mapping (each failure class has exactly one code):

| Failure class | Exit code | Example |
|---|---:|---|
| Usage | 2 | unknown command/flag, missing `--run`, non-interactive prompt needed |
| Config file missing / unparseable / schema-invalid / embedded validator refusal / path containment | 3 | unknown config key, invalid `projectProfile`, `output.dir` inside `cypress/` |
| Provider configuration error | 3 | unrecognized `AI_PROVIDER`; `ProviderError` code `CONFIGURATION` at creation (missing `AI_MODEL`/`AI_API_KEY`) |
| Framework authority contradiction | 3 | `QA_FRAMEWORK=cypress` with config `framework: "playwright"` |
| Authority refusal | 5 | capability not requested / not enabled in release; `PROVIDER_NOT_ALLOWED`; `OFFLINE_PROVIDER_CONTRADICTION`; `CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`; reserved-command fixed refusal; CI refusal; platform decision pending (OD-06); invalid invocation identity; write target refused |
| Input refusal (non-provider input) | 4 | requirements file invalid; persisted artifact/context fails schema or digest; `RUN_BINDING_MISMATCH`; run created by another product version |
| Provider / network / runtime failure | 6 | network error, HTTP error, rate limit, provider bounded-time exceeded, `ProviderError` codes other than `CONFIGURATION` |
| Malformed / untrusted model output | 6 | provider response fails the closed `#22`/`#23`/triage result contract after the allowed attempts (e.g. non-canonical evidence ref, TSB-F04 identity mismatch) |
| Test failure | 10 | `AutomationExecutionRecord.status = TEST_FAILED` |
| Execution timeout | 8 | `AutomationExecutionRecord.status = TIMED_OUT` |
| Execution infrastructure / runtime error | 7 | `AutomationExecutionRecord.status = EXECUTION_ERROR` (spawn failure, binary not resolvable; `exitCode` null) |
| Internal error | 1 | uncaught exception not classified above |

Disambiguation rules:

- **Origin decides 4 vs 6:** a defect in content that came from a provider in
  the current invocation is always 6; a defect in content read from disk
  (including artifacts that a provider produced in an *earlier* invocation and
  were persisted) is always 4.
- **Pipeline order decides ties:** checks run in the fixed order usage (2) →
  config (3) → authority (5) → input (4) → provider (6) → execution
  (7/8/10). The first failing stage determines the code.
- Codes 7/8/10 are emitted only by `execute`, which is reserved and refused
  (5) until OD-06; they are defined now so the taxonomy is complete.
- `--json` `errors[].code` carries the stable machine-readable reason
  (e.g. `CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`); reason codes are part of
  the CLI contract, not implementation error-class names.

Codes and reason codes are a stable contract within a CLI major version.

### 10.8 Output rules

- **stdout:** only the command result. Human-readable by default; `--json`
  emits exactly one JSON object (`{ "schemaVersion": 1, "command", "ok",
  "exitCode", "runId", "artifacts": [relative paths], "errors": [{code,
  message}] }`).
- **stderr:** diagnostics and progress; bounded; never secrets, API keys,
  tokens, raw provider responses, prompts or full stack traces.
- Paths in output are repository-relative.
- Error messages reuse the existing bounded diagnostic conventions.

### 10.9 Non-interactive / CI behavior

- The CLI never prompts. If a command would need human input it fails with
  exit 2 or 5.
- `review record` and `apply` are reserved fixed refusals until OD-04; even
  after OD-04 they refuse when `CI=true` or `GITHUB_ACTIONS=true` (approval
  and repository mutation are not CI actions in Controlled-v1).
- `execute` is a reserved fixed refusal until OD-06. After OD-06 it is
  permitted only on the runner classes and OS that decision names as
  supported; otherwise exit 5.
- Colour/TTY features are off when stdout is not a TTY.

---

## 11. Configuration contract

### 11.1 File

| Property | Value |
|---|---|
| Name / location | `qa-agent.config.json` at the target repository root |
| Owner | adopting team (target repository) |
| Format | JSON (strict parse). **Not** JS/TS/YAML — config must not be executable |
| Schema identity | `"schemaVersion": 1` (required, integer) |
| Size bound | ≤ 64 KiB file; closed schema; unknown keys rejected |
| Secrets | **forbidden**. Keys/tokens come only from environment / CI secrets |

### 11.2 Schema v1

```json
{
  "schemaVersion": 1,
  "projectProfile": {
    "id": "acme-web",
    "displayName": "Acme web storefront",
    "knownProjectConstraints": ["Checkout requires a seeded test account."]
  },
  "framework": "playwright",
  "frameworkRuntime": { },
  "knowledge": { },
  "requirements": { "source": "file", "path": "qa/requirements.json" },
  "capabilities": {
    "triage": true,
    "design": false,
    "plan": false,
    "generate": false,
    "reviewRecord": false,
    "apply": false,
    "execute": false
  },
  "providers": { "allow": ["mock", "groq"] },
  "output": { "dir": "reports/qa-agent" }
}
```

| Field | Mandatory | Validation |
|---|---|---|
| `schemaVersion` | yes | exactly `1` |
| `projectProfile` | yes | existing `assertValidProjectProfile` (strict v1 snapshot) |
| `framework` | yes | `"cypress"` \| `"playwright"`; sole supported framework authority (§10.4.3) |
| `frameworkRuntime` | no | existing `assertValidFrameworkRuntimeConfig` |
| `knowledge` | no | existing `assertValidProjectKnowledgeConfig` |
| `requirements` | required for `requirements`/`design` commands | `source` closed to `"file"` in v1; `path` repository-relative, canonical containment inside root; file validated by `loadRequirementsFromFile` |
| `capabilities` | no (every capability defaults to **false**) | closed known key set, boolean values. Requesting a known-but-release-disabled capability (`reviewRecord`/`apply`/`execute` today) is **schema-valid**; invocation is refused at runtime (§10.4.4). `requirements check` and other baseline commands have no capability key |
| `providers.allow` | no (default `["mock"]`) | closed vocabulary of shipped providers; a ceiling only — it never selects a provider (§10.4.2) |
| `output.dir` | no (default `reports/qa-agent`) | repository-relative; canonical containment; must not equal or contain a framework source prefix (`cypress/`, `playwright/`), `.git`, `node_modules` or the config file |

Every capability defaults to **disabled**: adoption is opt-in per capability.

### 11.3 Validation

`qa-agent config validate` and every command start by: strict JSON parse →
closed schema → embedded validators → path containment. Failure is exit 3
with a bounded message and zero side effects. Runtime capability
authorization and provider resolution (§10.4) follow as a separate step and
fail with exit 5; `config validate` reports their outcome but does not turn a
schema-valid config into an invalid one. Validation
never reads artifact or requirement content beyond what the command needs.

---

## 12. Target-repository footprint

| File / object | Mandatory? | Owner | Generated? | Purpose |
|---|---|---|---|---|
| `package.json` `devDependencies["qa-ai-agent"]` (exact version) + lockfile entry | **yes** | target team | by `npm install` | install/pin the product |
| `qa-agent.config.json` | **yes** | target team | written by the team (example in docs) | declarative config |
| `qa/requirements.json` (any path the config names) | only for requirements/design | target team | no | requirements input |
| `.github/workflows/<name>.yml` | no | target team (copied example) | no | CI usage |
| `reports/qa-agent/**` | no (created on demand) | runtime | **yes** | product artifacts (§14); recommended `.gitignore` entry |
| `reports/ai/**` | no (created on demand by triage) | runtime | **yes** | triage artifacts (unchanged location) |
| `cypress/**` / `playwright/**` spec files written by `apply` | no | target team **after** human approval | proposed by AI, approved by human, written by `apply` | generated E2E tests; ordinary target code once committed by a human |
| CI secrets (`AI_API_KEY`, optional `GITHUB_TOKEN` use) | only for real providers/history | target team / platform | no | provider and History API access |
| QA AI Agent core code | **never** | — | — | stays in `node_modules/` |

Maximum mandatory footprint: **one dependency line (+ lockfile) and one JSON
file.** Nothing is copied from the product into the target repository.

---

## 13. User journeys

### Journey A — Install

- Prerequisites: Node.js **22.x** and npm (matches `engines`); a Git
  repository is **not** required by the product (the ID-2 proof root is not a
  Git checkout); for `execute`, the target's own `cypress` or
  `@playwright/test` installed locally and a supported execution environment.
- Mechanism: `npm install --save-dev --save-exact qa-ai-agent@<version>` from
  the chosen distribution channel (OD-01; a versioned tarball URL/file works
  identically).
- Secrets: none for install, baseline commands or `mock` triage.
  `AI_API_KEY` is required for any generative command (`design`/`plan`/
  `generate`), because those require a network provider (§10.4.2).
- Target repository changes: the dependency line and lockfile.
- Docker: not required.

### Journey B — Initialize / configure

- The team creates `qa-agent.config.json` from the documented example (§11.2).
  No `init` command is proposed in v1 (it would only write the same example;
  OD-08 may revisit).
- `npx qa-agent config validate` → exit 0 or a bounded error.
- Provider: environment only; config can only narrow the allowed set.
- Invocation settings: none in the file (identity is runtime-only by design).

### Journey C — Discover capabilities

`npx qa-agent --version` and `npx qa-agent info --json` report:

```json
{
  "schemaVersion": 1,
  "product": { "name": "qa-ai-agent", "version": "<semver>" },
  "contracts": { "config": 1, "cliOutput": 1, "runManifest": 1, "persistedTriageContext": 1 },
  "capabilities": {
    "triage":   { "requested": true,  "available": true },
    "design":   { "requested": true,  "available": false, "reason": "CAPABILITY_REQUIRES_GENERATIVE_PROVIDER" },
    "apply":    { "requested": true,  "available": false, "reason": "CAPABILITY_NOT_ENABLED_IN_RELEASE" },
    "execute":  { "requested": false, "available": false, "reason": "CAPABILITY_NOT_ENABLED_IN_RELEASE" }
  },
  "provider": { "effective": "mock", "allowed": ["mock"], "offline": false, "credentialPresent": false, "generativeCapable": false },
  "invocation": { "mode": "local-v1-orchestrated" },
  "platform": { "os": "linux", "executeDecision": "PENDING_OD_06" }
}
```

`credentialPresent` is a boolean only; the key value is never read into output.
No network call is made. `info` reports platform **decision status**, never a
claim that `execute` is supported before OD-06.

### Journey D — Controlled run

Local, deterministic requirements path (baseline, valid with `--offline`):

```text
npx qa-agent requirements check --offline  # RC-02/03/04 deterministic → exit 0/3/4
```

Local, generative chain (each capability explicitly requested **and** a
configured, allowed generative-capable provider; `--offline`/`mock` → exit 5
`CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`):

```text
AI_PROVIDER=groq AI_MODEL=<model> AI_API_KEY=<secret> \
npx qa-agent design                          # → runId
npx qa-agent plan      --run <runId>         # same provider env
npx qa-agent generate  --run <runId>         # proposal only, no repository write
npx qa-agent review show   --run <runId>     # human reads targets/diffs (no provider)
```

Reserved in Controlled-v1 (fixed refusal, exit 5, until their owner decision):

```text
npx qa-agent review record --run <runId>     # until OD-04 (approval authenticity)
npx qa-agent apply     --run <runId>         # until OD-04
npx qa-agent execute   --run <runId>         # until OD-06 (platform / runner matrix)
```

- Inputs: config, requirements file, environment provider settings, prior run
  artifacts.
- Outputs: artifacts under `reports/qa-agent/runs/<runId>/` (§14); exit code
  (§10.7); optional `--json` summary.
- Human approvals: `review record` (decision; reserved until OD-04 — its input
  and authenticity mechanism are **unresolved** and not invented here) and the
  human's own later `git add`/commit/PR of written specs.
- Write permissions: `apply` writes only under the configured framework prefix
  inside the root; every other command writes only under `output.dir` or
  `reports/ai/`.
- GitHub Actions: `requirements check`, `design`, `plan`, `generate`,
  `review show` and `triage *` may run in CI and upload `reports/**` as
  workflow artifacts. `review record` and `apply` never run in CI in
  Controlled-v1; `execute` only per OD-06.
- Example CI step (consumer docs, target-owned):

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@<pinned-sha>
  - uses: actions/setup-node@<pinned-sha>
    with: { node-version: 22 }
  - run: npm ci
  - run: npx qa-agent requirements check --offline --json
  - run: npx qa-agent design --json   # needs a real generative provider
    env:
      AI_PROVIDER: groq
      AI_MODEL: ${{ vars.QA_AGENT_MODEL }}
      AI_API_KEY: ${{ secrets.QA_AGENT_AI_API_KEY }}
```

### Journey E — Evidence / reports

See §14. Each command writes its typed artifacts plus an updated run
`manifest.json`; triage writes the existing `reports/ai/*.json`.

### Journey F — Remove

1. `npm uninstall qa-ai-agent` (removes the dependency line and lockfile entry).
2. Delete `qa-agent.config.json`.
3. Delete any copied QA-agent workflow file.
4. Delete `reports/qa-agent/` and `reports/ai/` (generated; usually
   git-ignored).
5. Remove CI secrets/variables created for the product (`QA_AGENT_AI_API_KEY`
   etc.) and revoke the provider key.
6. Generated spec files already committed by the team are ordinary target test
   code; they import only the target's own framework, never `qa-ai-agent`, so
   keeping or deleting them is a normal team decision. **No mandatory core
   coupling remains.**

---

## 14. Artifact / output contract

All new product artifacts carry `kind` and `schemaVersion` and are written only
through the existing root-anchored safe-write path.

| Artifact | Producer | Consumer | Location | Schema | Stability | Supported? | Authority |
|---|---|---|---|---|---|---|---|
| CLI `--json` result | every command | CI scripts, demo | stdout | `cliOutput` v1 | stable within CLI major | yes | advisory summary |
| `manifest.json` (run manifest: runId, product version, `projectionVersion` + run-semantic projection digest (§10.5), artifact schema versions, per-stage command history incl. effective provider/model, artifact list + digests) | chain commands | later chain commands, humans, demo | `reports/qa-agent/runs/<runId>/` | `QaAgentRunManifest` v1 (new) | stable | yes | binding for run continuity only; never approval |
| requirements check report (artifacts, quality, test designs, coverage) | `requirements check` | humans, demo | `reports/qa-agent/requirements/` | existing RTI-1/3/4/5 object contracts wrapped in `RequirementsCheckReport` v1 | stable | yes | advisory |
| RequirementModel, TestCaseModel, AutomationCandidate | `design` | `plan`, humans | run dir | existing `#22` v1 contracts | stable as **artifacts** (file shape), not as API | yes (read-only) | advisory (AI-generated) |
| AutomationRepositoryContext, AutomationPlan | `plan` | `generate`, `apply`, `execute` | run dir | existing `#23` v1 | as above | yes (read-only) | advisory |
| GeneratedChangeSet, GeneratedChangeSetReviewPackage | `generate` | `review`, `apply` | run dir | existing `#23D/E` v1 | as above | yes (read-only) | proposal |
| GeneratedChangeSetReviewRecord | `review record` (human) | `apply` only | run dir | existing `#23E` v1 | as above | yes | **authoritative only as consumed by `apply` (#23F)** |
| AppliedChangeSetRecord | `apply` | `execute`, humans | run dir | existing v1 | as above | yes | authoritative record of what was written |
| AutomationExecutionRecord | `execute` | humans, demo | run dir | existing v1 | as above | yes | authoritative record of PASS/FAIL |
| `context.json` | triage collect | triage analyze | `reports/ai/` | `PersistedTriageContextV1` | stable (existing) | yes | evidence (bound to invocation) |
| `history.json` | triage history | triage analyze | `reports/ai/` | closed variants (XI-02) | stable | yes | advisory |
| `ai-report.json` | triage analyze | humans, CI | `reports/ai/` | existing (TSB-F04 closed schema) | stable | yes | **advisory**; does not decide CI pass/fail |

Rules: artifacts are untrusted on reload and fully re-validated; an artifact
whose bytes no longer match the manifest digest, or that fails its schema, is
refused (exit 4). This detects corruption, staleness and accidental or
inconsistent edits; it does **not** authenticate artifacts against an actor who
rewrites both artifact and digest (§10.5 integrity scope). Artifacts never
contain secrets; artifact schemas evolve only per §15. Rows for
`GeneratedChangeSetReviewRecord`, `AppliedChangeSetRecord` and
`AutomationExecutionRecord` describe the reserved surface; no command produces
them before OD-04 / OD-06.

---

## 15. Version / upgrade / rollback / uninstall contract

### 15.1 Version relationships

| Versioned item | Carrier | Rule |
|---|---|---|
| Product version | `package.json` `version` (semver) | single product version; CLI, bundled providers and internal modules share it |
| CLI contract | product **major** | commands, flags, exit codes, `--json` shape: breaking change ⇒ major |
| Config schema | `schemaVersion` integer | a product major may support several schema versions; dropping one ⇒ major |
| ProjectProfile | v1 strict (package-surface-v3) | change ⇒ new schema version + major |
| Artifacts | per-artifact `schemaVersion` | additive fields are **not** allowed in closed schemas ⇒ any change is a new schema version; reading older versions is either supported or refused fail-closed (never coerced) |
| Provider contracts | internal; env vocabulary public | adding a provider = minor; removing/renaming = major |
| Root API (19 names) | product major | existing compatibility commitment (`docs/package-surface-v2.md`) |
| Workflow integration | documented example per product version | target-owned once copied; no product-side version pin |

### 15.2 Compatibility and breaking changes

- Breaking (major): removing/renaming a root export, subpath, CLI command/flag
  or exit code; dropping a config schema version; changing an artifact schema
  without a new version; narrowing accepted input of a supported function
  (except governed security corrections, which follow the package-surface-v3
  precedent and are recorded explicitly).
- Minor: new command, new optional config field **in a new schema version**,
  new capability defaulting to disabled, new provider.
- Patch: fixes with no contract change.
- Engines: dropping Node 22 is major.

### 15.3 Upgrade

1. Read release notes for the target version.
2. `npm install --save-dev --save-exact qa-ai-agent@<new>`.
3. `npx qa-agent config validate` (exit 3 if the config schema is no longer
   supported).
4. Start new runs; in-flight runs created by an older version are **refused**
   (manifest version mismatch, exit 4) — finish or discard them first.

**No automatic config or artifact migration is promised.** Any migration
tooling requires its own later design.

### 15.4 Rollback

Reinstall the previous exact version (lockfile revert). Configs written for the
newer schema version are refused by the older product (fail-closed) — keep the
config at the oldest schema version both support during evaluation. Runs
created by the newer version are refused by the older one.

### 15.5 Uninstall

Journey F (§13). No residual mandatory coupling.

---

## 16. Security / trust boundaries

Preserved invariants (unchanged by productization):

- **ProjectProfile validation** — config `projectProfile` goes through
  `assertValidProjectProfile` and only the snapshot is used.
- **XI-01** — CLI respects both invocation modes and only orchestrates
  `local-v1` for single-process runs (§10.6).
- **XI-02** — History variants and boundary unchanged.
- **TSB-F04** — model-result↔test identity enforced in `analyzeFailure.main`;
  CLI adds no rendering of model-asserted fields beyond `ai-report.json`.
- **TSB-F07** — persisted triage context contract unchanged.
- **TSB-F06** — size/time bounds unchanged; config/file inputs get explicit
  size bounds (§11.1).
- **Repository-root safety** — explicit root, no upward search, both lexical
  and canonical containment for every path (config, requirements, output dir,
  apply targets).
- **Write authority** — only `apply` writes outside output dirs, only approved
  bytes, only under framework prefixes, never protected paths (single source of
  truth with the builder, TSB-F01 closed).
- **Human approval** — §17; disabled by default; never in CI.
- **GOV-AUTO** — this design changes no governance tooling or rules.
- **Full Project Independence** — §20.
- **Telemetry** — **Controlled-v1 defines no telemetry collection.** Network
  access is limited to explicitly configured/supported external integrations
  (AI providers per `AI_PROVIDER`/`providers.allow`, and the GitHub History API
  for `triage history`) according to their existing contracts; `--offline`
  disables all of them.
- **Surface vs isolation** — `exports` denial and capability gating are
  supported-surface controls, not security isolation boundaries (§1).

Per surface:

| Surface | Trusted inputs | Untrusted inputs | Runtime validation boundary | Authorization boundary | Side effects |
|---|---|---|---|---|---|
| `info`, `--version`, `--help` | installed package metadata, env presence flags | config (if read) | config validators | none | none |
| `config validate` | `--root`/cwd | config file content | strict parse + closed schema + existing validators | none | none |
| `requirements check` | root, config | requirements file | `loadRequirementsFromFile`, RTI validators | capability check | writes under `output.dir` |
| `design` / `plan` / `generate` | root, config, env provider selection | requirements content, repository files read for context, **all provider output**, prior run artifacts | existing `#22`/`#23` validators, closed schemas, digest recomputation, run-semantic projection binding | capability + `providers.allow` + generative-capable provider (refused for `mock`/`--offline`) | provider network call; artifacts under run dir |
| `review show` | root, run id | review package | digest recomputation for display integrity; **no gate** | capability | none |
| `review record` (reserved) | **unresolved** — human decision input and its authenticity are OD-04/`ODR-02`; not designed here | — | before OD-04: none (fixed refusal reads no input) | release-disabled until OD-04; after OD-04 also refuses CI | before OD-04: none |
| `apply` (reserved) | future: root, config | future: change set, plan, context, review package, review record (all persisted ⇒ untrusted) | future: `#23F` full revalidation incl. `validateApprovedGeneratedChangeSetReview` + `verifyApprovedChangeBinding`, N-21 package rebuild, live-filesystem revalidation | release-disabled until OD-04 and release prerequisites 4/5; refuses CI | before OD-04: none. Future: writes approved bytes under framework prefix; rollback on failure |
| `execute` (reserved) | future: root, config | future: applied record, change set, plan | future: `#23G` binding (TSB-F03 closed), closed argv/env allowlist, `shell:false`, bounded output/time | release-disabled until OD-06 (platform/runner matrix) and prereq 6. **No Windows execution guard exists today** (`FUTURE_WINDOWS_EXECUTION_CAPABILITY_GUARD` is a tracked future item); until OD-06 the refusal is the reserved-command refusal on every OS | before OD-06: none |
| `triage *` | root, config, invocation identity (platform tuple or CLI-generated local id) | test reports, repository files, history API data, provider output, persisted context | existing triage boundary contract (XI-01/02, TSB-F04/F07) | capability | provider call; `reports/ai/**` |
| Root API (19 names) | unchanged | unchanged | unchanged | unchanged | unchanged |

Open security items that remain release blockers for the capabilities that use
them (recorded, not changed): `AT-07`/`TB-01` (approval provenance, CRITICAL)
→ `review record`/`apply`; `ODR-01`/`SADR-01` (principal/project/root join) →
`apply`/`execute`; `ODR-06`/`ODR-07` (host isolation) → `execute`;
`FUTURE_WINDOWS_EXECUTION_CAPABILITY_GUARD` (not implemented; tracked) →
`execute` on Windows, subject to OD-06. The design keeps those capabilities
disabled-by-default and release-disabled (fixed refusal) until their owner
decisions and prerequisites are satisfied, matching `OD-CONTROLLED-V1-RELEASE-MODEL`
§6 (disabled-path evidence across all supported entrypoints will be required
by the release dossier).

---

## 17. Human-control matrix

| Action | AI may propose | AI may execute | Human approval required | Repo write authority required |
|---|---:|---:|---:|---:|
| Requirements analysis (deterministic) | n/a | yes (deterministic code) | no | no (output dir only) |
| Requirements/test model generation (AI) | yes | yes (advisory artifact) | no (advisory) | no |
| Test case generation | yes | yes (advisory artifact) | no (advisory) | no |
| Automation-plan generation | yes | yes (advisory artifact) | no (advisory) | no |
| E2E generation (change-set proposal) | yes | yes (proposal artifact only) | no to generate; **yes to apply** | no |
| Review decision (approve/reject per change) | no | **no** | **yes — the decision itself** | no |
| Repository file mutation (`apply`) | yes (the bytes) | only after a human APPROVE bound to exact bytes, invoked by a human | **yes** | **yes** (local working tree, framework prefix only) |
| Test execution (`execute`) | no | yes, only on approved+applied specs, invoked by a human/allowed runner | yes (indirectly: requires prior approval + explicit invocation) | no |
| Report generation | yes | yes | no | no (output dir only) |
| Commit | no | **no** | yes (human performs it) | yes (human) |
| PR creation | no | **no** | yes (human performs it) | yes (human) |
| Review approval (code review) | no | **no** | yes (human) | — |
| Merge | no | **no** | yes (human) | yes (human) |
| Release / publish | no | **no** | yes (Product Owner release grant) | yes (maintainer) |

There is no implicit autonomous merge, commit, push or publish authority
anywhere in the product surface. The review-decision, `apply` and `execute`
rows describe the reserved surface; before OD-04 / OD-06 those commands are
fixed refusals, so human control fails closed by construction.

---

## 18. TSB-F02 trigger analysis

Canonical definition (`docs/type-schema-boundary-audit-v1.md`, TSB-F02):
gates `validateApprovedGeneratedChangeSetReview` and
`validateApprovedTestDesignReview` accept on stored `status === "APPROVED"`
without re-deriving it from `decisions`. Controlled-v1 impact:
"`CONTROLLED_V1_BLOCKER: CONDITIONAL` — only if a consumer other than #23F
application (including the future Controlled-v1 supported high-level surface,
or a test-design publishing approval step) relies on either gate without
independent per-decision checks." ROADMAP: trigger not met;
`OPEN / LOW / CONDITIONAL`.

Repository evidence (§5.7): the generated-change-set gate's only production
consumer is `#23F`, which re-requires a single `APPROVE` per change via
`verifyApprovedChangeBinding`; the test-design gate has no production consumer;
`publishTestDesigns` does not consume either gate.

**1. Does the proposed product surface consume an affected approval/review
gate?** Only **indirectly**: `qa-agent apply` invokes `#23F`
`applyApprovedGeneratedChangeSet`, which internally calls
`validateApprovedGeneratedChangeSetReview` **and** `verifyApprovedChangeBinding`.
No proposed surface calls either gate directly; `review show` explicitly does
not; the test-design gate is consumed by nothing.

**2. Is that consumer newly supported/public?** The `apply` **command** is
newly supported; the gate-consuming code inside it is the existing `#23F`
consumer, unchanged. No gate is exported or newly callable.

**3. Is it part of Controlled-v1?** Yes, as a capability that is disabled by
default and refused until its own release prerequisites are satisfied.

**4. Does this satisfy the canonical trigger?** **No.** The trigger requires a
consumer *other than #23F application* that relies on a gate *without
independent per-decision checks*. The only consumer remains `#23F` with
independent per-decision checks.

```text
TSB-F02 TRIGGER = FALSE
```

Binding design constraints (any implementation that violates one makes the
trigger TRUE and must STOP for the `TSB-F02` owner disposition):

- **DC-F02-1** No supported surface (CLI, API, workflow, artifact) may call
  `validateApprovedGeneratedChangeSetReview` or
  `validateApprovedTestDesignReview` except through
  `applyApprovedGeneratedChangeSet`.
- **DC-F02-2** No command may report an approval verdict derived from either
  gate or from a stored `status` field (no `review verify`/`review status`).
- **DC-F02-3** The test-design review record/gate is not part of the
  Controlled-v1 supported surface; no step of `design`/`plan`/`generate` is
  conditioned on it.
- **DC-F02-4** Neither gate nor its module is exported (root or subpath).
- **DC-F02-5** `apply` must call `#23F` without bypassing or replacing
  `verifyApprovedChangeBinding`.

`TSB-F02` remains **`OPEN / LOW / CONDITIONAL`**.

C1 re-evaluation: the C1 corrective changes provider resolution, offline
semantics, capability authorization, run binding and exit mapping. It does
**not** change the proposed call graph around either gate: `apply` is still the
only path to `#23F`, and before OD-04 `apply` and `review record` are fixed
refusals that load neither gate module. `TSB-F02 TRIGGER = FALSE` stands under
DC-F02-1..5. Any later change that alters this call graph →
`STOP — TSB-F02 TRIGGER MUST BE RE-EVALUATED`.

Recommended future enforcement (Architecture recommendation; implementation
item, not authorized here): a **static import-graph test** proving that no
shipped non-test module other than the canonical `#23F` consumer
(`scripts/ai/test-automation/change-set-application.js`) imports
`generated-change-set-review-record.js`, and that no shipped non-test module
imports `test-design-review-record.js`.

---

## 19. RC-01..RC-12 mapping

Release Contract provenance: RC-01..RC-12 are the Product Owner-approved
working baseline (`OD-CONTROLLED-V1-RELEASE-MODEL` §4); their normative
acceptance text is not yet a canonical repository artifact. This mapping adds
no acceptance criteria.

| RC | Capability | Classification | Evidence / reason |
|---|---|---|---|
| RC-01 | External installation | **PROVEN WITH LOCAL PACKED TARBALL / PRODUCT DISTRIBUTION CHANNEL PENDING OD-01** | package installability is proven (ID-2 real `npm pack` + `npm install` into an external directory); a released, consumer-facing distribution is **not** yet established (no channel, no release, no CLI). Public/external distribution is not called supported before OD-01 and productization are complete |
| RC-02 | Requirements ingestion | **SUPPORTED NOW** | `loadRequirementsFromFile`, `loadRequirementsFromProvider`, Jira/Azure DevOps subpaths |
| RC-03 | Requirements analysis | **SUPPORTED NOW** | `analyzeRequirementQuality(ies)` (deterministic) |
| RC-04 | Test case/design generation | **EXPOSED BY PRODUCTIZATION** (after OD-02) | deterministic `generateTestDesigns` is public now; the chain-capable `#22` TestCaseModel/AutomationCandidate path is private and becomes reachable only via `qa-agent design`, which requires a configured generative-capable provider (not `mock`/`--offline`) |
| RC-05 | Automation planning | **EXPOSED BY PRODUCTIZATION** (after OD-02) | `#23` `generateAutomationPlan` via `qa-agent plan`; generative provider required |
| RC-06 | E2E generation | **EXPOSED BY PRODUCTIZATION** (after OD-02) | `#23` `generateChangeSet` + review package via `qa-agent generate`; generative provider required |
| RC-07 | Human approval | **REQUIRES LATER CONTROLLED-V1 WORK** — **OD-04 BLOCKS ENABLEMENT** | `review show` designed; `review record`/`apply` reserved as fixed refusals. Enablement requires OD-04 / the approval-authenticity contract (`AT-07`/`TB-01`, `ODR-02`/`FI-02`/`FV-02`, release prerequisite 4); `review record` input/authenticity is unresolved and not invented here |
| RC-08 | Controlled execution | **REQUIRES LATER CONTROLLED-V1 WORK** — **OD-06 BLOCKS ENABLEMENT** | `execute` reserved as a fixed refusal. Enablement requires the OD-06 platform/runner-matrix decision and the independently assessed execution environment (prerequisite 6, `ODR-06`). Not product-ready |
| RC-09 | Reporting/evidence | **EXPOSED BY PRODUCTIZATION** | run manifest + typed artifacts + `--json` (§14); triage reports already supported |
| RC-10 | Repeatability | **REQUIRES LATER CONTROLLED-V1 WORK** | Two distinct properties. **Product-mechanics repeatability** (designed here): exact package version, exact config, explicit effective provider identity/model recorded per stage, versioned artifact contracts, run manifest with run-semantic projection digest, deterministic validation/orchestration, and deterministic baseline commands (`--offline`). **Model-output determinism**: **not guaranteed** for external generative providers unless the provider/model itself offers such a guarantee; `MockProvider` supplies **no** generative repeatability. Evidence requires `qa-agent-demo` external validation and reproducibility evidence |
| RC-11 | Security/governance readiness | **REQUIRES LATER CONTROLLED-V1 WORK** | SADR-11 capability dossier, AISEC-7 scope binding, disabled-path evidence |
| RC-12 | Versioned release/install/upgrade | **EXPOSED BY PRODUCTIZATION** | §15 contract; distribution channel = OD-01; actual release/publication is separately authorized |

No RC item is `OUTSIDE THIS DESIGN`. No Release Contract conflict was found.

---

## 20. Demo interface (for later `qa-agent-demo`; not created here)

The later demo must use only:

1. **Install:** `npm install --save-dev --save-exact qa-ai-agent@<version>`
   from the released distribution channel (no sibling checkout, no `file:`
   link to a source tree).
2. **Configure:** commit `qa-agent.config.json` (schema v1) and a requirements
   file; `npx qa-agent config validate` → exit 0.
3. **Invoke:** the §13 Journey D command sequence with `--json`. `--offline`
   is used **only** for deterministic/offline-safe capabilities (`info`,
   `config validate`, `requirements check`, `review show`, `mock` triage).
   The generative chain `design → plan → generate` uses a **configured,
   allowed, generative-capable provider** (secret supplied via environment).
   The entire demo **cannot** run deterministically offline with the current
   `MockProvider`; a deterministic generative provider would require a
   separate, not-yet-taken owner/design decision.
4. **Inputs:** config, requirements file, environment provider settings.
5. **Outputs:** exit codes per §10.7; `reports/qa-agent/runs/<runId>/manifest.json`
   listing every artifact with digests and the effective provider/model per
   stage; `ai-report.json` if triage is enabled; `AppliedChangeSetRecord` /
   `AutomationExecutionRecord` only once OD-04 / OD-06 have enabled
   `apply` / `execute`.
6. **What the demo must demonstrate:**
   1. deterministic setup and config validation (`--offline`, repeatable);
   2. a real configured generative provider for the generation stages;
   3. the human-controlled review/apply lifecycle (review presentation now;
      record/apply only after OD-04);
   4. reproducible evidence through manifests/digests (product-mechanics
      repeatability, §19 RC-10), without claiming model-output determinism.
7. **Success evidence:** `info --json` shows the exact product version; each
   enabled stage exits 0; manifest digests verify; the demo's lockfile shows
   only the released package; no `require` of any non-exported path occurs.

This design does not create the demo.

### FULL PROJECT INDEPENDENCE

The proposed design requires **no** QA AI Agent source checkout, **no**
source-relative path, **no** test helper, **no** unpublished module, **no**
developer machine state, and **no** manual copying of runtime core. Every
consumer step uses the installed package's binary, its supported root API, a
target-owned config file and environment variables. The newly shipped `#22`/`#23`
modules are published with the package, not copied.

```text
FULL PROJECT INDEPENDENCE = PRESERVED
```

---

## 21. Implementation impact forecast (NOT AUTHORIZED, nothing changed)

Likely later changes, each requiring separate authorization and HEAVY review:

| Area | Likely change |
|---|---|
| `package.json` | `bin: { "qa-agent": … }`; `files` expansion to ship the CLI; **only after OD-02:** `files` expansion to ship `generation/**`, `generative-test-design/**` (subset), `test-automation/**` (subset); version per OD-05 |
| New CLI module(s) | a new, not-yet-existing entry module (location decided at implementation, e.g. under `bin/` or `scripts/ai/`): argument parsing, config loader/validator, run manifest, exit codes, `--json` writer |
| New config/manifest validators | `qa-agent.config.json` v1 and `QaAgentRunManifest` v1 closed schemas (internal, not exported) |
| Artifact persistence | safe write/read of `#22`/`#23` artifacts under the run dir using existing root-anchored primitives |
| `test/installation/*` | extend the external proof to the CLI path; manifest/minimality invariants for the larger tarball; deep-import denial for every newly shipped module |
| New tests | CLI contract (commands, exit codes, stdout/stderr discipline, non-interactive refusal), config schema adversarial matrix, DC-F02-1..5 static/dynamic checks, disabled-capability refusal on every entrypoint |
| Docs | consumer install/configure/run/remove guide; `SECURITY.md` sync |
| `docs/package-surface-v4.md` (new record) | records `bin`, entrypoint definition `exports ∪ bin`, the new tarball inventory and the classification of newly shipped files |
| A-1 re-disposition evidence | explicit record, after OD-02, that A-1 `PRIVATE_GENERATIVE_SURFACE` physical exclusion is reversed (and to what subset), cited by package-surface-v4 |
| Package-minimality invariant | `test/installation/package-surface.test.js` closure/minimality over `exports ∪ bin` (§9.1) |
| CLI executable packaging | shebang, npm `bin` shim behavior, installed-tarball resolution checks on each OS class OD-06 names |
| `SECURITY.md` | platform support statement and `execute` refusal documentation (reserved command, OD-06), no-telemetry statement |
| DC-F02 enforcement | static import-graph test (§18) |
| Provider resolution / module-load tests | §10.4.2 resolution order and refusals; proof that env-snapshotting modules see exactly the effective decision (§10.4.5) |
| Platform matrix tests | once OD-06 is resolved: per-OS behavior of non-execute commands and `execute` refusal/support |
| Workflows | none mandatory; repository CI may add a CLI smoke job |
| `ROADMAP.md` | lifecycle sync at closure only |

### 21.1 Implementation phasing (advisory Architecture recommendation — NOT AUTHORIZED)

1. CLI shell + config + `info` / `config validate` / `requirements check`; no
   private generative shipping.
2. Triage commands and XI-01 local orchestration.
3. Only after OD-02: private shipping + run manifest + `design` / `plan` /
   `generate` / `review show`.
4. Only after OD-04: `review record` / `apply`.
5. Only after OD-06: `execute`.
6. Only after OD-01 / OD-03 / OD-05 and remaining release prerequisites:
   release enablement.

WIP remains serial (`WIP = 1`). Each stage needs its own authorization and
review; this list authorizes none of them.

## 22. Open decisions

| ID | Decision | Owner | Recommendation |
|---|---|---|---|
| OD-01 | Distribution channel: npm public registry vs GitHub Release tarball vs GitHub Packages | Product Owner (`ID-3`) | **pre-release decision.** Recommendation: versioned GitHub Release tarball for Controlled-v1; registry later |
| OD-02 | Physical distribution change: ship the `#22`/`#23`/`generation` subsets as private runtime dependencies | Product Owner + Architecture | **`OWNER DECISION REQUIRED`.** Shipping these subsets **reverses the existing physical exclusion property of A-1** (`PRIVATE_GENERATIVE_SURFACE`); the API stays private. Before any implementation stage changes package `files` to include them, the Product Owner must explicitly disposition OD-02. This design neither implements nor dispositions it |
| OD-03 | Package/binary names (`qa-ai-agent` / `qa-agent`); registry name availability | Product Owner | **resolve before publication**; provisional names may be used in implementation and tests |
| OD-04 | Approval-recording mechanism and reviewer authenticity | `ODR-02` owner | **blocks RC-07 enablement.** `review record`/`apply` are reserved fixed refusals until decided; `review record` input/authenticity is not invented here. If it requires signing/key management, that lifecycle STOPs for its own design |
| OD-05 | First productized version number | Product Owner | **pre-release decision.** The current manifest `1.0.0` is **not** a release claim. Recommendation: reserve `1.0.0` for the Controlled Release; pre-release identifiers before it |
| OD-06 | **Platform / runner matrix** (extended in C1): (a) OS support for non-execute CLI commands; (b) OS support for controlled `execute`; (c) which CI runner classes count as the supported execution environment (local Linux, GitHub-hosted Linux, self-hosted isolated, others) | Product Owner, informed by the separate execution-environment assessment | **blocks `execute` enablement; platform matrix decision required.** Repository-proven constraints only: authoritative CI is Linux (`ubuntu-latest`); controlled execution on Windows resolves a `.cmd` shim under `shell:false` and is known to fail (`EINVAL`); **no** explicit CLI/platform guard exists today. Before OD-06 disposition `execute` is disabled on every OS. Support or non-support of other platforms is **not** decided here |
| OD-07 | Whether a high-level programmatic API for the chain is ever offered | Product Owner + Architecture | not in Controlled-v1 |
| OD-08 | `qa-agent init` convenience command | Product Owner | not in v1 |
| OD-09 | Requirements sources in the CLI beyond `file` (Jira/Azure DevOps) | Product Owner | API-only in v1 |

OD-07 / OD-08 / OD-09 remain deferred.

Not an open decision of this design: a deterministic generative provider
(offline fixture/replay engine for `design`/`plan`/`generate`). It is not
current Controlled-v1 behavior: `NEW OWNER/DESIGN DECISION REQUIRED` if ever
desired.

## 23. Risks

| Risk | Impact | Mitigation in this design |
|---|---|---|
| `AT-07`/`TB-01` approval provenance (CRITICAL, open) | RC-07 cannot be enabled | capabilities disabled by default and product-refused; CI refusal; dossier evidence |
| Shipping `#22`/`#23` widens the distributed attack/maintenance surface | more shipped code, more deep-import candidates | `exports` unchanged; deep-import denial tests for every new file; minimality invariant |
| Windows execution fails today (`.cmd` + `shell:false`), no guard exists | `execute` would fail for Windows users | `execute` reserved and refused on every OS until OD-06; `info` reports decision status; guard/support is OD-06 |
| Provider env snapshotted at module load (`scripts/ai/config.js`) | effective provider could diverge from the resolved decision; key present in-process | mandatory condition §10.4.5 (preferred: isolated child process with constructed env; key omitted under `--offline`/`mock`); `credentialPresent` boolean only; no logging |
| Users expect `--offline` / `mock` to run generation | misleading demo or CI results | generative commands fail closed with `CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`; documented in §10.4.1 and §20 |
| Two artifact roots (`reports/ai` legacy, `reports/qa-agent` new) | minor confusion | documented; moving triage output would be a breaking change |
| Run artifacts edited between commands | inconsistent input to later stages | untrusted-at-reload; schema + digest + projection-binding revalidation detects corruption/staleness/mismatch; **not** authenticity against an actor rewriting artifact and digest (§10.5) |
| Package name collision on a public registry | install confusion | OD-01/OD-03 |
| Release Contract normative text not canonical | mapping cannot certify release | mapping marked as working baseline only |
| `engines: 22.x` only | narrow adoption | explicit prerequisite; widening is a later minor |
| ROADMAP §14 A-1 text names `scripts/ai/test-design/` while the excluded directory is `scripts/ai/generative-test-design/` (the D-2 rename) | documentation-only inconsistency | INFO; `docs/package-surface-v2.md` is authoritative and correct; not changed here |

## 24. Review requirements

- Review class: **HEAVY**.
- Next: **independent HEAVY Architecture C1 re-review** of the C1 head (the
  rejected-head review of `1c6376f3` is superseded by the new head).
- Then: separate **Security review** lifecycle step (unless the Governance
  Coordinator directs otherwise).
- The author does not self-review. Any corrective commit creates a new review
  identity.
- Approval of this design does not authorize implementation, merge,
  publication or release.

## 25. STOP conditions

### 25.1 Evaluated in this mission

| Condition | Result |
|---|---|
| main baseline changed before branch work | not met (verified) |
| `TSB-F02` trigger TRUE / undeterminable | not met — FALSE (§18) |
| public API incompatible break required | not met — zero API change |
| mandatory Docker/Kubernetes coupling required | not met |
| FULL PROJECT INDEPENDENCE cannot be preserved | not met — PRESERVED |
| human approval boundary must be weakened | not met (§17) |
| Full Autonomy functionality required | not met |
| another unresolved finding requires remediation **by this design** | not met — `AT-07`/`TB-01`, execution environment and Windows guard remain pre-existing release prerequisites for specific capabilities, not remediated or required here |
| signing/key-management design necessary | not met here (deferred to `ODR-02`, OD-04) |
| irreversible target-repository coupling required | not met (§13 Journey F) |
| Release Contract conflict | not found |
| repository reality contradicts canonical governance/design assumptions | not found (one INFO path-name inconsistency, §23) |

### 25.2 ROADMAP

`NO ROADMAP CHANGE`. The lifecycle remains DESIGN ACTIVE; implementation is
not started.

### 25.3 Future STOP triggers (for the implementation lifecycle)

- any violation of DC-F02-1..DC-F02-5;
- any need for a new root export, subpath or exported-function parameter;
- any need for executable configuration, upward root search, or reading
  secrets from config;
- any need for the product to commit, push, open PRs, approve, merge or
  publish;
- enabling `review record`/`apply`/`execute` before their release
  prerequisites are satisfied;
- any consumer step requiring the source checkout;
- changing package `files` to ship `#22`/`#23`/`generation` before an explicit
  OD-02 disposition;
- any generative command producing output with `mock`, under `--offline`, or
  via silent fallback to `MockProvider`;
- loading an env-snapshotting provider/config module before effective
  provider resolution (§10.4.5);
- any change to the gate call graph of §18 →
  `STOP — TSB-F02 TRIGGER MUST BE RE-EVALUATED`.

---

## 26. C1 corrective record

Rejected head: `1c6376f3414759cbd31495d7ea3944b66a9637ba` (tree
`e78b2f7dffa61c2aac7d02c205e073b20b97ad77`), Architecture review **REJECTED**.
This corrective changes only this document.

| Finding | Resolution | Where |
|---|---|---|
| `ARCH-PROD-M01` — mock / `--offline` cannot drive `#22`/`#23` | `--offline` redefined as network/provider-disabled mode, not offline AI generation; `design`/`plan`/`generate` require a generative-capable provider and fail closed (`CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`, exit 5) with `mock`/`--offline`; no fallback, no fixture provider (`NEW OWNER/DESIGN DECISION REQUIRED`); demo and RC-10 corrected | §1, §6, §10.2, §10.4.1–2, §13 D, §19 RC-10, §20 |
| `ARCH-PROD-m01` — private shipping language | "shipped but not exported / unsupported for consumer import"; `exports` is not filesystem isolation; capability gating is not a security boundary; entrypoints = `exports ∪ bin` with required future tests | §1, §9, §9.1, §16 |
| `ARCH-PROD-m02` — authority precedence | fixed resolution order (mode → requested provider → `providers.allow` ceiling → capability fit → provider configuration); config `framework` is sole framework authority, `QA_FRAMEWORK` contradiction refused; schema validity vs runtime authorization separated; `requirements check` is a baseline (ungated) command | §10.2, §10.4.2–4, §11 |
| `ARCH-PROD-m03` — run binding / integrity | versioned run-semantic configuration projection replaces whole-config digest; capability/allow-list changes do not invalidate runs; digests detect corruption/staleness/mismatch only, not authenticity | §10.5, §14, §23 |
| `ARCH-PROD-m04` — exit taxonomy | normative failure-class table; `TIMED_OUT` → 8, `EXECUTION_ERROR` → 7, `TEST_FAILED` → 10; origin rule separates 4 vs 6; fixed pipeline order resolves ties | §10.7 |
| `ARCH-PROD-m05` — platform matrix | OD-06 extended to OS support (non-execute, execute) and CI runner classes; no existing Windows guard claimed; `execute` disabled on every OS before OD-06 | §13 C, §16, §22 OD-06, §23 |
| `ARCH-PROD-m06` — RC-01 wording | `PROVEN WITH LOCAL PACKED TARBALL / PRODUCT DISTRIBUTION CHANNEL PENDING OD-01` | §19 |
| `ARCH-PROD-m07` — module-load env | mandatory implementation condition; preferred architecture B (isolated child process with constructed env); no new `analyzeFailure.main` parameter | §10.4.5, §23 |

Also recorded: OD-02 reversal of A-1 physical exclusion requires explicit PO
disposition before any `files` change; OD-04 blocks RC-07 enablement; OD-06
blocks `execute`; OD-01/OD-05 pre-release, OD-03 before publication;
OD-07..09 deferred; no telemetry; reserved commands; implementation-impact
additions and advisory phasing (§21, §21.1); `TSB-F02` unchanged
(`OPEN / LOW / CONDITIONAL`, trigger FALSE) with a recommended static
import-graph test (§18).

Preserved unchanged: npm package as sole mandatory install model; CLI
REQUIRED; programmatic API unchanged; FULL PROJECT INDEPENDENCE; minimal
mandatory footprint; no Docker/Kubernetes requirement; no autonomous
commit/push/PR/merge/release authority.

---

`IMPLEMENTATION NOT AUTHORIZED` · `MERGE NOT AUTHORIZED` · Controlled Release
`NOT APPROVED`.
