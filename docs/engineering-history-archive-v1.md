# QA AI Agent

![Cypress E2E Tests](https://github.com/TarasovArtem/qa-ai-agent/actions/workflows/cypress.yml/badge.svg?branch=main)

QA AI Agent is an AI-assisted QA engineering system spanning two production-integrated pipelines: a **reactive CI failure-triage pipeline** (Cypress + Playwright evidence → deterministic correlation → one AI analysis → deterministic policy → PR comment) and a **generative AI Test Design & Test Automation pipeline** (evidence → AI-proposed requirements/test cases → human review → AI-generated automation code → human review → safe filesystem application → controlled test execution). Both pipelines run against real GitHub Actions CI for Cypress (Chrome/Edge/Firefox) and Playwright (Chromium), share a provider-neutral AI abstraction (Mock/Groq/Gemini), and are protected by an offline evaluation/regression suite. AI is **assistive and human-gated throughout**: it never decides whether CI passes, never applies its own generated code without an explicit human approval record, and never executes generated code without that same approval already in place.

## Why this project matters

Cross-browser E2E failures are frequently ambiguous - a single failure can mean a real product defect, a stale test, environment instability, genuine browser-specific behavior, or a flaky timing issue, and a raw error message rarely settles which. Reasoning over that ambiguity is a real AI-assistance problem, but handing an AI model authority over CI results, generated code, or process execution is a real *safety* problem - one that gets strictly harder as the system's authority grows:

- **Triage is read-only.** The reactive pipeline only ever reads evidence and writes a PR comment; nothing it does can affect the repository or the CI result.
- **Generation escalates authority in controlled steps.** Proposing a test case is low-risk; writing AI-generated files to the real repository and then executing them is not. This project's #22/#23 pipeline models that escalation explicitly - proposal, human review, filesystem application, controlled execution - rather than collapsing it into one uncontrolled "AI does everything" step.
- **Cross-framework, cross-browser evidence is inherently more complex than single-run evidence**, and correlating it correctly (without letting an independent framework's outcome masquerade as same-test corroboration) is a real architecture problem, not a formatting exercise.
- **AI behavior itself needs regression protection.** A prompt or policy change that silently makes classification worse is exactly the kind of regression a human reviewer is unlikely to catch by eye - this project protects against that with a frozen, per-sample evaluation harness rather than trusting manual spot-checks.

The result is an architecture where **the AI proposes and the deterministic/human layer decides** - never the reverse - at every authority boundary in both pipelines.

## What this project demonstrates

- **Senior QA / AQA engineering** - deterministic, evidence-driven E2E test architecture across two independent frameworks
- **Cypress and Playwright** - both production-integrated into the same CI, with framework-neutral evidence normalization
- **JavaScript / Node.js** - the entire pipeline (collection, correlation, prompt construction, policy, evaluation, generation, automation) is hand-written Node, no test-generation framework dependency
- **GitHub Actions / CI-CD engineering** - a seven-job workflow with framework-aware evidence aggregation, artifact boundaries, and branch-protection design
- **AI-agent / LLM orchestration** - provider abstraction across structurally different vendor APIs (Groq's OpenAI-compatible envelope, Gemini's native envelope), with zero core changes required to add the second vendor
- **Prompt and evidence engineering** - an explicit OBSERVED FACT / SUPPORTED INFERENCE / UNKNOWN epistemic contract enforced on every model-writable field, not just a top-level classification
- **Deterministic policy design constraining LLM output** - the model's own `shouldCreateBug` recommendation can be overridden by policy, never the other way around
- **AI-assisted test generation** - requirement/test-case generation grounded in supplied evidence, schema-validated end to end
- **Human-in-the-loop authority-escalation design** - every step from "AI proposes" to "code executes" is bound to a specific, digest-sealed human review record
- **Filesystem-mutation and process-execution safety engineering** - containment/symlink/ancestor-topology defenses for applying AI-generated code, and a `shell:false`/closed-classifier/env-allowlist model for executing it
- **Offline AI evaluation and regression infrastructure** - six frozen, additive dataset/baseline versions, per-sample (never aggregate-accuracy) regression comparison
- **Governance-aware delivery** - every stage of this project has gone through an implement → independent-adversarial-review → corrective cycle before merging, evidenced in the roadmap history below

## Key capabilities

**Failure intelligence (reactive pipeline)**
- Two production E2E frameworks (Cypress: Chrome/Edge/Firefox; Playwright: Chromium), each with its own adapter and CI job(s)
- One logical AI analysis per failing workflow, never one call per browser or per framework
- Deterministic `browserCorrelation` (same-framework, cross-browser) and `frameworkCorrelation` (cross-framework, workflow-level only) - never conflated, no LLM involved in computing either
- Framework-scoped, project-scoped flaky-test History derived from GitHub Actions' own run/job records
- Evidence-grounded model reasoning (observed fact vs. supported inference vs. unknown, enforced by prompt contract)
- Deterministic `shouldCreateBug` safety policy the model cannot override; no automatic GitHub issue creation

**Test design & automation (generative pipeline)**
- AI-proposed `RequirementModel`/`TestCaseModel` generation, schema-validated, grounded in supplied evidence
- Digest-bound human review records for both the proposed test design (#22F) and the proposed generated code (#23E)
- Safe, containment-checked filesystem application of an approved, AI-generated change set (#23F)
- Controlled, `shell:false`, closed-classifier execution of the applied test with bounded environment/timeout/output and one bounded regeneration attempt on failure (#23G)

**Platform & AI architecture**
- Provider abstraction across three real backends (Mock / Groq / Gemini), swappable with zero core changes; no automatic cross-provider fallback
- Machine-readable provider provenance (attempt count, first-attempt error) and bounded transport retry
- Curated, schema-validated, offline Knowledge Layer selected before the model is ever called
- Repo-local, canonical-path, cross-platform (Windows/POSIX) attachment and source-evidence containment

**CI/CD, evaluation & governance**
- GitHub Actions CI with authoritative Cypress/Playwright pass/fail, independent of AI outcome
- Six frozen, additive offline evaluation/regression dataset versions (v1-v6) protecting 15 triage dimensions plus dedicated Test Design quality dimensions
- Every roadmap stage independently reviewed (adversarially, against source) before merging - see [Project status & maturity](#project-status--maturity) below

## Project status & maturity

| Capability | Status | Evidence / limitation |
|---|---|---|
| CI failure triage (Cypress + Playwright) | **Implemented, production** | Real GitHub Actions CI on every push/PR; one real, independently-reviewed, controlled Playwright failure exercised the full pipeline end to end |
| AI Test Design (#22) | **Implemented** | Schema-validated generation + digest-bound human review record; evaluated by Dataset v6 |
| AI Test Automation (#23) | **Implemented** | Generated-code human review, safe filesystem application, controlled execution, bounded regeneration - all independently reviewed |
| Multi-provider AI abstraction | **Implemented, one provider CI-wired** | Groq is the real CI provider; Gemini's API compatibility is proven by one controlled call but Gemini is **not** CI-wired (no repository secret) |
| Multi-framework portability | **Implemented, production** | Both Cypress and Playwright adapters run in real production CI today |
| Multi-project portability | **Proven - synthetic and real** | Isolation boundary validated against a synthetic second project (Project B, Roadmap FPI-4A) and independently re-proven against a real, independently-existing external repository with a live SUT (`TarasovArtem/TargomoPlaywright`); this repository's own production CI still runs against exactly one real project - the second project exists only as an independently-reviewed, unmerged experiment |
| Package boundary & public programmatic API | **Implemented, production** | `scripts/ai/index.js` exposes exactly 19 symbols (grown from the original 8 at Roadmap ID-1 through the Roadmap RTI-1 through RTI-8B additions - `collectContext`, `collectHistory`, `analyzeFailure`, `aggregateBrowserContext`, four `assertValid*` config validators, plus the RTI pipeline's `assertValidRequirementArtifact`, `loadRequirementsFromFile`, `analyzeRequirementQuality`/`analyzeRequirementsQuality`, `generateTestDesign`/`generateTestDesigns`, `buildRequirementTraceability`/`analyzeRequirementsCoverage`, `loadRequirementsFromProvider`, `assertValidTestDesignArtifact`, and `publishTestDesigns`) via `package.json`'s `main`/`exports`/`files`; concrete vendor providers/destinations are reachable only via package subpaths (`qa-ai-agent/providers/jira`, `qa-ai-agent/providers/azure-devops`, `qa-ai-agent/destinations/azure-devops`), never the root barrel; adapters and internal helpers are not part of the public surface - see Roadmap ID-1 below and [PROVIDERS.md](PROVIDERS.md)/[PUBLISHING.md](PUBLISHING.md) for the vendor-adapter contracts; the #22/#23 generative implementation (`scripts/ai/generation/`, `scripts/ai/generative-test-design/`, `scripts/ai/test-automation/`) is repository-private - neither exported nor physically shipped in the package (see [docs/package-surface-v2.md](docs/package-surface-v2.md)) |
| External-repository installation | **Proven** | A real `npm pack` -> `npm install <tarball>` into a physically separate, mkdtemp-isolated external repository exercised all four generic pipeline stages through the public API only, with zero `scripts/ai` production diff - see Roadmap ID-2 below |
| Real existing-repository onboarding | **Proven, independently reviewed** | A real, independently-existing, previously-unrelated GitHub repository consumed the installed package via its public API only, with target-owned config/knowledge and its own real Playwright report/workflow - see [Roadmap FPI-2 - Terminal Audit](#roadmap-fpi-2--terminal-audit--full-project-independence) below |
| Reproducible versioned acquisition | **Proven** | A fresh external consumer, with no producer checkout, no warm npm cache, no SSH keys/agent, and no GitHub token of any kind, independently and reproducibly acquired an immutable, version-addressable git-tag reference (`github:TarasovArtem/qa-ai-agent#<tag>`) over anonymous HTTPS (`codeload.github.com`) - see [Roadmap FPI-2 - Terminal Audit](#roadmap-fpi-2--terminal-audit--full-project-independence) below |
| Version upgrade transition | **Proven** | Installing version A, then upgrading to a genuinely different version B via ordinary `npm install <pkg>@<ref>`, left target-integration source byte-identical and the generic pipeline fully functional on both versions - see [Roadmap FPI-2 - Terminal Audit](#roadmap-fpi-2--terminal-audit--full-project-independence) below |
| Full project independence (fresh-clone acquisition, versioned distribution, upgrade without target rewrite) | **Proven** | Every clause of the terminal definition is independently proven: a fresh external repository can remotely acquire a version-addressable distribution without producer state or developer credentials, supply only target-owned configuration, run the generic pipeline, and upgrade without copying generic source or rewriting target integration. See [Roadmap FPI-2 - Terminal Audit](#roadmap-fpi-2--terminal-audit--full-project-independence) below for the full evidence chain. This is an architectural-independence claim only - it does **not** mean npm-published, registry-ready, or that a formal release process exists (see [Package Maturity vs. Architectural Independence](#package-maturity-vs-architectural-independence)) |
| Controlled execution on Windows | **Not supported** | `shell:false` + Windows `.cmd`-shim resolution collide (`EINVAL`); tracked as `FUTURE_WINDOWS_EXECUTION_CAPABILITY_GUARD` in `SECURITY.md`, tests explicitly skip (never silently pass) on Windows |
| Automatic GitHub issue creation | **Not implemented** | `shouldCreateBug` is a human-actionable field only |
| Cross-provider automatic fallback | **Not implemented (by design)** | A misconfigured/failing provider fails honestly rather than silently substituting another |
| Reviewer/human-decision identity authentication | **Not implemented** | Review records prove content integrity, never actor authenticity - see `SECURITY.md`'s open `FUTURE_*` guards |

## Architecture

```text
                              QA AI Agent
                                   |
                +------------------+------------------+
                |                                     |
                v                                     v
     CI Failure Triage (reactive)         AI Test Design + Automation (generative)
          Roadmaps #1-#21                          Roadmaps #22-#23
                |                                     |
   Cypress + Playwright CI failure         Evidence about desired behavior
                |                                     |
      deterministic correlation                  Test Design (#22)
                |                                     |
        one logical AI analysis            Human Review (#22F)  <-- required
                |                                     |
        deterministic policy                Automation Plan (#23B/#23C)
                |                                     |
            PR comment                      Generated Change Set (#23D/#23E-gen)
                                                       |
                                            Human Review (#23E)  <-- required
                                                       |
                                          Safe Application (#23F, filesystem write)
                                                       |
                                     Controlled Execution (#23G, shell:false child process)
                                                       |
                                    Execution Evidence + Bounded Regeneration (max 1 attempt)
```

The two pipelines are **separate runtime paths** - they share only the AI provider abstraction. Triage never writes to the repository or executes code; generation does both, but only past an explicit human-approval gate. See [SECURITY.md](SECURITY.md) for the full authority/trust model.

## CI Failure Triage Pipeline

Chrome, Edge, and Firefox each run the identical Cypress suite in their own CI job; Chromium runs Playwright's own smoke test in its own job. No browser/framework job ever calls an AI provider directly - a separate `QA AI triage` job runs after all four legs finish, aggregates every leg's result, and performs **at most one** AI analysis for the whole workflow run (never per-browser, never per-framework). On a fully green run it performs zero AI calls.

The model returns a recommendation (`classification`, `confidence`, `rootCause`, `shouldRetry`, `shouldCreateBug`, ...); a separate, pure, deterministic policy layer (`scripts/ai/agent-policy.js`) decides the only safety-relevant action: only a `PRODUCT_BUG` classification may keep a model-recommended `shouldCreateBug: true` - every other classification is forced to `false`, regardless of what the model said. **Cypress and Playwright's own pass/fail results remain authoritative regardless of what the AI concludes.**

Full detail: [How failure triage works](#how-failure-triage-works), [Deterministic safety model](#deterministic-safety-model), [Evidence grounding](#evidence-grounding), [Multi-browser and multi-framework correlation](#multi-browser-and-multi-framework-correlation), [History](#history), [Knowledge Layer](#knowledge-layer) below.

## AI Test Design Pipeline

Given evidence about desired behavior (not a CI failure), the pipeline proposes schema-validated `RequirementModel`/`TestCaseModel` artifacts, packages them for review, and requires an explicit human decision - approve, request changes, or reject - sealed into a digest-bound review record (#22F) before anything downstream can consume the design. The record proves the reviewed content wasn't altered after the decision was sealed; it does **not** prove the reviewer's identity or that a human (rather than some other actor) made the call - that limitation is stated explicitly, not hidden, in both the code and `SECURITY.md`.

Full stage-by-stage detail (#22B-#22F): [AI Test Design & Test Automation (#22/#23)](#ai-test-design--test-automation-2223) below.

## AI Test Automation Pipeline

Once a test design is approved, the pipeline generates concrete automation code (`AutomationCandidate`/`AutomationPlan` → a `GeneratedChangeSet`), which again requires an explicit human APPROVE decision (#23E) before anything is written to disk. Only after that approval:

- **#23F - Safe application**: `change-set-application.js` applies the approved change set under a containment-checked, symlink/hardlink-defended, ancestor-topology-bound writer, with rollback on partial failure.
- **#23G - Controlled execution**: `controlled-execution.js` runs the applied test via a `shell:false` child process, targeting only files matched by a closed, framework-specific classifier, with an environment allowlist, hard timeout, bounded output, and at most one automatic regeneration attempt on failure.

The orchestrator itself has no shell/Git/network authority beyond spawning that one classified process - but the framework binary it launches, and any generated test code that framework loads, runs with the full authority of the host OS process. This is explicitly **not** a sandbox; see [SECURITY.md](SECURITY.md#25-controlled-execution-authority-23g) for the precise boundary.

Full stage-by-stage detail (#23B-#23G): [AI Test Design & Test Automation (#22/#23)](#ai-test-design--test-automation-2223) below.

## Safety & Trust Model

The governing principle across both pipelines: **the AI proposes, deterministic code validates, and a human authorizes every authority escalation.** In brief:

- Every AI-generated artifact (requirement, test case, automation plan, change set) is schema-validated before a human ever sees it.
- Human decisions are sealed into SHA-256 digest-bound review records - a matching digest proves the record wasn't tampered with after sealing, but (stated explicitly, not glossed over) **does not** prove reviewer identity or actual human authorship.
- Filesystem writes (#23F) are containment-checked, symlink/hardlink-defended, and bound to the repository root's ancestor-topology identity, with rollback on partial failure and an acknowledged residual TOCTOU limitation.
- Process execution (#23G) is `shell:false`, argv-only, restricted to a closed target classifier, environment-allowlisted, timeout- and output-bounded, and never described as sandboxed.
- Regeneration after a failed execution is bounded to one attempt per call - not a durable cross-session rate limit.
- No stage in either pipeline has Git or GitHub-mutation authority (no commit, push, branch, PR, or issue creation) - the only automated GitHub write anywhere in this repository is upserting a single PR comment.

See [SECURITY.md](SECURITY.md) for the complete data-governance and authority model, including the full canonical register of open, explicitly-tracked trust-boundary limitations (`FUTURE_*` guards).

## CI/CD

GitHub Actions ([.github/workflows/cypress.yml](.github/workflows/cypress.yml)) runs seven jobs on every push to `main`, every PR targeting `main`, and manual dispatch: `Unit tests`, `QA Agent evaluation` (offline), `Cypress - chrome`, `Cypress - edge`, `Cypress - firefox`, `Playwright Chromium`, and `QA AI triage`.

Current required branch-protection checks: `Cypress - chrome`, `Cypress - edge`, `Unit tests`, `Playwright Chromium`, `QA Agent evaluation`. `Cypress - firefox` and `QA AI triage` remain informational while their real-world reliability is observed independently.

**Current repository governance profile: solo-maintainer.** A pull request is required for every change to `main`, all required checks above must pass, the branch must be up to date with `main` (strict mode), and branch-protection rules apply to the repository administrator as well (no bypass exemption) - a required *human-approving-reviewer* count is deliberately not enforced today, since this is a single-maintainer repository and that specific control cannot be satisfied honestly by a second account. Independent adversarial source review is still mandatory under this project's own delivery process (see the roadmap history below) - GitHub enforces the PR/CI/branch-freshness mechanics; the independent-review discipline itself is a project-governance practice, not a platform feature.

## Portability & Current Boundaries

Three portability axes are tracked separately and must not be conflated:

- **Framework portability - resolved in production.** Both Cypress and Playwright adapters run in real GitHub Actions CI today, normalizing into an identical generic evidence shape, with framework-scoped History/Knowledge isolation enforced by construction.
- **Project portability - proven, both synthetically and against a real external project.** The `ProjectProfile`/History/Knowledge isolation boundary was first validated end to end against a synthetic second project (Project B, Roadmap FPI-4A), then independently re-proven against a real, independently-existing external repository with a live SUT (`TarasovArtem/TargomoPlaywright`). This repository's own production CI still runs against exactly one real project; the second project exists only as an independently-reviewed, unmerged experiment branch - do not read this as "already portable to any codebase out of the box" or as "merged into a second production consumer."
- **Package/installation independence - proven, including the stricter terminal claim.** Roadmap ID-1/ID-2 proved the package can be built (`npm pack`) and installed (`npm install <tarball>`) into a physically separate external repository via its public API only, with zero production diff. **Full Project Independence** - a fresh clone remotely acquiring a *versioned* distribution without producer state or developer credentials, and later *upgrading* it without any target rewrite - is now **proven**: see [Roadmap FPI-2 - Terminal Audit](#roadmap-fpi-2--terminal-audit--full-project-independence) below for the full evidence chain. This is an architectural-independence claim only, not a release-maturity claim - see [Package Maturity vs. Architectural Independence](#package-maturity-vs-architectural-independence) below.

Full detail: [Current Multi-Framework Status](#current-multi-framework-status), [Known Architectural Boundaries](#known-architectural-boundaries), and [Roadmap FPI-2 - Terminal Audit](#roadmap-fpi-2--terminal-audit--full-project-independence) below.

## Repository Structure

    cypress/                       Cypress specs, page objects, config
    playwright/                    Playwright spec(s), config

    scripts/ai/
      adapters/                    Cypress + Playwright evidence adapters
      providers/                   Mock / Groq / Gemini AI providers (#1-23) AND
                                    RTI-7 RequirementsSourceProvider adapters
                                    (Jira, Azure DevOps) - two unrelated "provider"
                                    concepts sharing this directory, see PROVIDERS.md
      destinations/                RTI-8 TestDesignDestination adapters (Azure DevOps
                                    Test Case), see PUBLISHING.md
      evaluation/                  Dataset/Baseline v1-v6, evaluate/regression scripts
      generation/                  #22/23-F0 shared contracts (RequirementModel, TestCaseModel, ...)
      generative-test-design/      #22 AI Test Design (evidence -> reviewed design)
      test-automation/             #23 AI Test Automation (design -> controlled execution)
      *.js                         Core triage pipeline (collection, correlation, prompt, policy);
                                    also the RTI-1..RTI-6/RTI-8B generic RTI pipeline modules

    scripts/diagnostics/           CI diagnostic utilities (Firefox forensics, disposable-output reset)

    test/helpers/                  Test-only shared fixtures (e.g. the RTI-8E1 HTTP mock-server
                                    fixture) - never shipped, outside package.json's "files" allowlist

    docs/                          Frozen shared-contract design docs
    .github/workflows/             GitHub Actions CI definition
    ROADMAP.md                     Canonical current execution sequence, conformance program, owner decisions
    SECURITY.md                    Full data-governance and authority/trust model (#1-23 pipelines)
    PROVIDERS.md                   RTI-7 Requirements Source Provider authoring contract
    PUBLISHING.md                  RTI-8 Test Design Publishing / Destination authoring contract
    TEST_CASES.md                  Manual Cypress test-case reference

## Running Locally

Requires Node.js `22.x` (see [.nvmrc](.nvmrc); `nvm use` if using nvm) -
`npm install`/`npm ci` fails closed on an unsupported Node major via
`.npmrc`'s `engine-strict=true` (Roadmap CRW1-B).

    git clone https://github.com/TarasovArtem/qa-ai-agent.git
    cd qa-ai-agent
    npm install

    npm run cypress:open           # interactive Cypress GUI
    npm run test:e2e               # Cypress, default browser
    npm run chrome                 # Cypress, headless Chrome (also: firefox, edge)
    npm run test:e2e:playwright    # Playwright, Chromium

    npm run test:unit              # scripts/ai/ unit tests (offline, no network)
    npm run eval:ai:v5             # score triage Dataset v5 (see eval:ai / :v2 / :v3 / :v4 / :v6)
    npm run eval:regression:v5     # compare against frozen Baseline v5

    AI_PROVIDER=mock npm run ai:analyze   # run AI failure analysis with the offline mock provider

See [TEST_CASES.md](TEST_CASES.md) for the full manual Cypress test-case reference, and [Commands for running tests](#commands-for-running-tests) below for the complete command list including every evaluation dataset version.

---

## Technical Reference & Engineering History

Everything below this point is the detailed engineering reference and chronological history behind the current architecture summarized above - full field-level semantics, the complete roadmap-by-roadmap build history, controlled experiments, and every independent-review finding. It is not required reading to understand what the system does today, but it is where every claim above is backed by exact evidence.

## Security and AI data governance

See [SECURITY.md](SECURITY.md) for the full data-governance contract: what data can reach an external AI provider, what's explicitly excluded, credential handling, provider/retry policy, GitHub Actions artifact boundaries, and explicit known limitations. Roadmap #20 (baseline audit, trust-boundary hardening, this governance documentation, and its independent review) is implemented and independently reviewed - see [Roadmap #20](#roadmap-20--data-security--governance) below for exact stage-by-stage status and delivery via PR #85.

## High-level architecture (current)

```
Cypress (Chrome)  Cypress (Edge)  Cypress (Firefox)      Playwright (Chromium)
      │                 │                │                        │
      └────────┬────────┴────────┬───────┘                        │
               ▼                 ▼                                ▼
         cypressAdapter → per-browser failure collectors    playwrightAdapter
               │                                                   │
               └─────────────────────────┬─────────────────────────┘
                                          ▼
                runtime framework selector (QA_FRAMEWORK; default cypress)
                                          │
                                          ▼
        browser + framework aggregation  (pick ONE primary failure workflow-wide,
                              compute browserCorrelation + frameworkCorrelation)
                                          │
                                          ▼
        history (project + framework scoped) + knowledge selection  (offline, deterministic)
                                          │
                                          ▼
                                   QA prompt / context
                                          │
                                          ▼
                                   Provider Factory
                                ┌──────────┼──────────┐
                                ▼          ▼           ▼
                              Mock       Groq       Gemini
                                └──────────┼──────────┘
                                          ▼
                       raw model text (never trusted as-is)
                                          │
                                          ▼
                       validation + deterministic policy
                                          │
                                          ▼
                                triage report → PR comment
```

Every box above exists in the current codebase today and reflects the real, currently-wired production CI path. **Both Cypress and Playwright have active production browser workflows** - see [Current Multi-Framework Status](#current-multi-framework-status) below for exactly what is production-proven for each. A minimal `ProjectProfile` (Roadmap #19.2) supplies the project-specific inputs the collectors and the prompt step consume - a small, deterministic data source, not a new pipeline stage, so it isn't drawn as its own box.

`cypressAdapter` and `playwrightAdapter` are both real, shipped **framework adapter boundaries** (`scripts/ai/adapters/cypress-adapter.js`, Roadmap #19.6; `scripts/ai/adapters/playwright-adapter.js`, Roadmap #19.8): each normalizes its framework's own raw report format (Cypress/Mochawesome; Playwright's official JSON reporter) into the identical generic `{testResults, failedTests, warnings}` shape. Which adapter runs is decided by the **runtime framework selector** (`scripts/ai/runtime-framework-selector.js`, Roadmap #21E): `QA_FRAMEWORK=playwright` selects `playwrightAdapter`; an absent/unset value defaults to `cypressAdapter` (the established backward-compatible default); an unrecognized value fails closed with a configuration error - it never silently falls back to a supported framework. The architecture is extensible through this adapter boundary, but the only two adapters that actually exist and actually run in production today are Cypress and Playwright - no other framework is implemented or implied.

## How failure triage works

**Browsers and frameworks never call the AI themselves.** Chrome, Edge, and Firefox each run the identical, unmodified Cypress suite in their own CI job; Chromium runs Playwright's own independent smoke test in its own CI job. Each job only ever records its own pass/fail outcome plus (on failure) a structured failure context - no job calls an AI provider. A separate, downstream `QA AI triage` job runs after all four legs finish, aggregates every leg's result across both frameworks, and performs **at most one** real AI analysis for the whole workflow run - never one per browser and never one per framework. On a fully green run, this job still runs but performs zero AI calls.

This "one logical analysis" design is a deliberate architecture decision, not an accident of implementation:

- **Avoids duplicate/racing analyses.** Two or three browsers failing the same underlying defect would otherwise trigger two or three redundant (and possibly rate-limited) provider calls for one real problem.
- **Gives the model real cross-browser evidence.** The single call still receives deterministic correlation data (which browsers failed, whether their failures share a signature) - richer evidence than any one browser's isolated failure.
- **Keeps cost and latency bounded and predictable** - one call per failing run, regardless of how many browsers are in the matrix.
- **Produces one consistent classification/report** per incident instead of two or three that could disagree.

This is distinct from **provider transport retries**: within that one logical analysis, the provider call itself may be retried a bounded number of times (see [Provider provenance & retry](#provider-provenance--retry) below) if the *transport* fails - that is still one logical analysis, not a second one.

## Deterministic safety model

**The model proposes. The application decides.** The model returns a recommendation - `classification`, `confidence`, `rootCause`, `evidence`, `recommendedFix`, `shouldRetry`, `shouldCreateBug` - but none of it is trusted as an authoritative action decision. A separate, pure, deterministic application layer (`scripts/ai/agent-policy.js`) makes the actual call:

- Only a `PRODUCT_BUG` classification may keep a model-recommended `shouldCreateBug: true`.
- Every other classification (`TEST_BUG`, `FLAKY_TEST`, `ENVIRONMENT`, `EXTERNAL_DEPENDENCY`, `UNKNOWN`) has its `shouldCreateBug` forced to `false`, regardless of what the model suggested.

This is a **ceiling** on which classifications *may* create a bug, not a floor that automatically files one for every `PRODUCT_BUG` - there is currently no automatic GitHub Issue creation; `shouldCreateBug` is a field for a human to act on.

The final report's field shape matters and is documented precisely here (not as a simplification): each result's `shouldCreateBug` is the **final, post-policy** value, and a nested `policy` object records the raw recommendation and whether policy intervened - `policy.originalShouldCreateBug` (the model's raw value) and `policy.adjusted` (`true` only when policy actually changed the outcome; `policy.adjusted: false` means policy ran and found no override necessary, never that policy was skipped). The separate offline Evaluation Dataset schema curates the same distinction under its own flat field names (`actual.originalShouldCreateBug`, `actual.policyAdjusted`) - a deliberately different, dataset-local convention, not the live report's shape.

`agent-policy.js` itself is a pure function of `{classification, shouldCreateBug}` only - it has no awareness of the project, the framework, the browser, the provider, or the model name, which is why it required zero changes across every roadmap item to date, including adding a second real AI provider.

## Evidence grounding

The system prompt enforces an explicit epistemic contract on every field the model writes, not just a top-level classification:

- **OBSERVED FACT** - something the supplied evidence (current-run error/assertion text, source code, deterministic browser-correlation fields, history, or other explicitly supplied context) directly establishes.
- **SUPPORTED INFERENCE** - a reasonable conclusion that goes beyond what's directly observed but stays grounded in and consistent with the evidence available. Allowed, but must never be presented as an observed fact.
- **UNKNOWN / NOT ESTABLISHED** - a specific mechanism the evidence doesn't pin down. The model is explicitly told to say so plainly rather than inventing a plausible-sounding cause merely because it would explain the symptoms.

A confident, well-evidenced classification never needs an unproven mechanism to justify it - the model's certainty about *what* happened and its certainty about *why* it happened in mechanistic detail are treated as independent.

Three supporting data sources are each bounded by an explicit authority rule so none of them can manufacture a fact about the current run:

- **History** (recent pass/fail counts for this exact job, same project and same framework - see [History](#history) below) is a probabilistic signal, never proof - an intermittent pattern can support `FLAKY_TEST`, but history alone can never establish what happened in *this* run.
- **Correlation** (`browserCorrelation`/`frameworkCorrelation`, see [Multi-browser and multi-framework correlation](#multi-browser-and-multi-framework-correlation) above) is deterministic, code-computed evidence about what was actually observed - real evidence, but it never by itself proves *why* two browsers or frameworks agree or differ, and cross-framework outcomes are never same-test evidence.
- **Knowledge Layer content** (below) is guidance only - it can broaden which hypotheses the model considers, but it can never stand in for evidence, override direct evidence, override correlation, override history, or override policy.

This does not claim hallucinations are impossible; it claims the prompt contract and the surrounding evidence pipeline are deliberately engineered to make an ungrounded claim visible and structurally discouraged, and that the one dimension that matters most for safety - `shouldCreateBug` - is never decided by the model's own text at all (see [Deterministic safety model](#deterministic-safety-model) above).

## Multi-browser and multi-framework correlation

Two deterministic, code-computed correlation objects exist, deliberately kept separate because they answer different questions and must never be conflated:

### `browserCorrelation` - same-framework, cross-browser

When more than one *same-framework* browser leg fails in the same workflow run, the aggregator still analyzes only one primary failure - but it deterministically computes correlation metadata from every leg of **that same framework's** real, recorded outcome (never by an LLM) and attaches it to that one analysis:

- `failedBrowsers` / `passedBrowsers` - which browsers of the primary's own framework actually failed/passed in this run
- `primaryBrowser` - which one was selected for the single AI analysis
- `failureScope` - `single-browser` or `multi-browser`
- `sameFailureSignature` - `true`/`false` when at least two failed browsers have comparable evidence, `null` when that comparison couldn't be made (explicitly not the same as `false`)

An independent framework's job is **never** a member of this comparison: its pass does not mean "the same test passed in another browser," and its fail does not mean "the same failure occurred in another browser" - the primary's own framework is the only framework `browserCorrelation` ever reasons over.

### `frameworkCorrelation` - cross-framework, workflow-level only

A separate, smaller object states only whether each framework present in this workflow run's jobs, as a whole, passed or failed - e.g. `{primaryFramework: "playwright", outcomes: [{framework: "cypress", outcome: "success"}, {framework: "playwright", outcome: "failure"}]}`. This is **workflow-level evidence, never same-test evidence**: a Cypress pass does not disprove a Playwright failure, and vice versa - the two frameworks run entirely independent test suites against the same target application. The system prompt explicitly instructs the model never to treat `frameworkCorrelation` as equivalent-coverage or same-test evidence.

Both correlation objects matter diagnostically, but neither is a classification rule by itself: the prompt explicitly forbids collapsing either pattern into an automatic conclusion (multiple browsers or frameworks failing does not by itself prove `PRODUCT_BUG` - a shared test bug or shared environment issue produces the same pattern). Correlation is evidence to weigh, never proof.

## History

Flaky-test History is a temporal signal derived from **prior GitHub Actions run/job evidence for this repository's own workflow** (`scripts/ai/collect-history.js`) - it is not a custom durable database this project maintains; GitHub Actions' own run/job records are the durable substrate, re-queried fresh on each collection.

- **Scope**: eligible only when both **project** and **framework** match the current analysis (`readHistory()` in `scripts/ai/analyze-failure.js`) - History collected for a different project, or for the other framework, can never influence an unrelated analysis. A narrow legacy-compatibility exception exists only for pre-framework-namespace records, and only for a current Cypress analysis; a Playwright analysis can never inherit it.
- **Job targeting**: the collector matches an exact GitHub Actions job name (`Cypress - <browser>` for Cypress; `Playwright Chromium` for Playwright) over the last several completed runs on `main` - not an arbitrary browser/framework guess.
- **Model-visible fields**: exactly four integers - `runsConsidered`, `passes`, `failures`, `retryPasses` - never raw run/job data, paths, or run IDs.
- **`retryPasses` is a GitHub Actions job-rerun signal, not a test-level retry count.** It counts a run where the matched job failed on an earlier attempt and then passed after being rerun (`run_attempt > 1`) - neither Cypress nor the current Playwright configuration (`retries: 0`) has test-level retries; this metric is entirely independent of that.
- **Never a root-cause oracle**: History can strengthen or weaken a hypothesis (e.g. a consistent run of failures argues *against* `FLAKY_TEST`, not for it), but it can never manufacture an observed fact about the current run - this boundary is enforced by the same prompt-contract rule described in [Evidence grounding](#evidence-grounding) above.

## Knowledge Layer

A curated, deterministic, fully offline layer of small QA/engineering knowledge units, selected **before** the AI provider is ever called (zero embeddings, zero vector search, zero LLM-based selection - plain tag/browser/framework matching with a fixed unit-count and character budget).

**Currently instantiated production corpus: 6 units, 2 of them `CURATED_EXTERNAL`** (sourced from official Cypress and GitHub Actions documentation), the rest project- or framework-scoped internal guidance.

The schema supports a broader **source-type vocabulary** than the current corpus happens to use - this distinction matters and is kept explicit rather than blurred:

| Source type | Meaning | Currently instantiated? |
|---|---|---|
| `PROJECT_VERIFIED` | Verified true for this specific project | Yes (1 unit) |
| `CURATED_INTERNAL` | Human-authored general QA/framework guidance | Yes (3 units) |
| `CURATED_EXTERNAL` | Summarized from authoritative external docs | Yes (2 units) |
| `CONTROLLED_EXPERIMENT` | Derived from a specific controlled experiment | Supported by schema, no unit uses it today |

Design invariants, enforced by construction, not just documentation:

- **Guidance only, never current-run evidence** - a knowledge statement can broaden a hypothesis or describe known framework/project behavior, but can never by itself establish what happened in the current run, and can never override direct evidence, browser correlation, history, or the deterministic `shouldCreateBug` policy.
- **Schema-validated and loud on error** - an invalid or duplicate unit fails loudly at load time; a curated file is always human-authored, so a mistake must be visible, never silently skipped.
- **Bounded** - a hard cap on unit count and total characters, so knowledge content can never dominate the prompt.

## Provider abstraction

```js
provider.analyze({ systemPrompt, userPrompt }) → Promise<string>
```

This one contract is the entire boundary between core reasoning and any specific AI vendor. **Provider adapters own** authentication, HTTP transport, the vendor's native request envelope, and the vendor's native response extraction. **Core owns everything else**: prompt construction, context assembly, knowledge selection, retry orchestration, JSON parsing, semantic validation, application policy, and reporting. A provider hands back a raw string and nothing more - it never returns a trusted, parsed QA result, and it never asserts its own identity inside the model's JSON output (the application attaches `provider.name` to the report only after independently validating the response).

### Provider comparison

| Provider | Role | Transport | Wired into normal CI |
|---|---|---|---|
| `MockProvider` | Deterministic offline provider for local development and all unit tests | No network call | Used in tests, not applicable to live CI |
| `GroqProvider` | Current real failure-triage provider | OpenAI-compatible HTTP Chat Completions API | Yes - the only provider currently wired into GitHub Actions |
| `GeminiProvider` | Second real provider / provider-abstraction portability proof | Google's native `generateContent` REST API | **No** - implemented and real-API-verified, but not CI-wired, no repository secret |

### Why Gemini exists

Gemini was not added merely to have a second model on hand. It exists to **prove the provider abstraction is real**, not just a single-vendor wrapper with an extensibility comment. Groq (OpenAI-compatible Chat Completions) and Gemini (Google's native `generateContent` envelope) have materially different authentication headers, request shapes, and response envelopes - yet integrating Gemini required zero changes to the prompt, semantic validation, policy, knowledge selection, or evaluation layers. That is the actual proof: the abstraction absorbed a structurally different vendor without the "core" of the system noticing.

**What is and is not established about Gemini:** a single controlled, offline-triggered live API call successfully exercised the real Gemini endpoint end-to-end and produced a well-formed, correctly-policed result. **Real API compatibility was proven for that one controlled call.** That is explicitly distinct from **production validation**, which was **not** established: Gemini has never been exercised by CI, has no repository secret, and has no availability/cost/rate-limit/compliance history. Gemini is not the production default, not a fallback provider, and is not claimed to be better than Groq - see [Roadmap #20](#roadmap-20--data-security--governance) and [SECURITY.md](SECURITY.md) for the governance work a real second-provider rollout would still need.

### Provider provenance & retry

Every analysis records machine-readable provenance on the report: `analysis.provider`, `analysis.providerAttempts` (the 1-based attempt count reached within this one logical analysis), and `analysis.firstAttemptError` (a safe, allowlisted summary of the first attempt's failure, if any - never a provider's raw exception text, which could otherwise leak request/response detail into a committed artifact).

Three related concepts are kept strictly separate, on purpose:

- **Provider transport retry** - a provider adapter makes exactly one outward HTTP request per `analyze()` call; core (`runProviderAnalysis()`) owns a small, bounded retry loop *around* that call, gated on whether the failure was marked retryable. This still counts as one logical analysis, not a new one.
- **Malformed semantic response** - if the model's JSON output doesn't parse or doesn't match the expected shape, that is a validation failure, not a transport failure, and is **not** retried.
- **QA `shouldRetry`** - a field in the model's own recommendation about whether the *Cypress test* should be re-run. It has nothing to do with HTTP retries and is unrelated to `providerAttempts`.

## Evaluation & regression protection

An architecture change to the prompt, provider layer, or policy is only as trustworthy as the evidence that it didn't silently make things worse. This project protects against that with a fully offline, deterministic evaluation/regression suite scored against frozen historical ground truth - it never calls a real provider and never re-runs a live experiment.

| Dataset version | Samples | Status |
|---|---|---|
| v1 | 4 | frozen |
| v2 | 6 | frozen |
| v3 | 7 | frozen |
| v4 | 9 | frozen |
| v5 | 13 scorable + 1 historical-only | frozen |
| v6 | 11 samples | frozen - scoped to Test Design (#22F) quality, not the triage pipeline above; see below |

Core principle: **a new architecture change must never silently redefine what "correct" meant historically.** Every dataset version is additive and byte-for-byte frozen once merged; regression comparison is per-sample (not aggregate-accuracy) with an explicit "any regression anywhere wins" precedence, so an unrelated improvement can never mask a real regression on a protected dimension. Dataset v5's regression comparator protects **15 separate dimensions per sample** (classification correctness, `shouldRetry`/`shouldCreateBug` correctness, evidence-grounding quality, three cross-browser correlation-quality dimensions, and five knowledge-authority dimensions added specifically because a live experiment exposed a real gap each one closes). Full detail, including the specific historical samples and each version's design rationale, is in the [Detailed Engineering History](#detailed-engineering-history) section below.

```
npm run eval:ai:v5          # scores Dataset v5
npm run eval:regression:v5  # compares against frozen Baseline v5
npm run eval:ai:v6          # scores Dataset v6 (Test Design / #22F quality, not this pipeline)
npm run eval:regression:v6  # compares against frozen Baseline v6
```

**Dataset v6 is a different pipeline's dataset, not an addition to v1-v5's triage scope.** v1-v5 score this document's own CI failure-triage pipeline; v6 exists specifically to score Roadmap #22F's Test Design human-review-record construction (`buildTestDesignReviewPackage()`/`buildTestDesignReviewRecord()`) against labeled fixtures - see [AI Test Design & Test Automation (#22/#23)](#ai-test-design--test-automation-2223) below for what #22F is. v6 does not extend or supersede v1-v5's 15-dimension triage regression protection described above.

**Historical snapshots below are frozen at the roadmap stage named - re-run `npm run test:unit` for the current count, which has grown substantially since #21J-A with the #22/#23 pipeline and CS1-CS5A stabilization work:**

- **Roadmap #18 completion:** 918 unit tests passing, including 93 provider-layer tests (27 Gemini / 17 Groq / 14 Mock / remainder shared contract-and-factory tests); Dataset/Baseline v1-v5 all `UNCHANGED`.
- **Roadmap #21J-A completion:** 1377 unit tests passing; Dataset/Baseline v1-v5 all `UNCHANGED`; Dataset v6 did not exist at this point in the roadmap.
- **Historical CS5A-certified `main` snapshot (platform-dependent; superseded, see the certified post-RTI snapshot below):** the natural Linux CI run on the certified merge commit passed all **2,924** unit tests (0 fail, 0 skip); a Windows local run of the identical tree passes **2,916** with an expected, documented 8-test platform-specific skip set (Windows-only `child_process`/symlink-privilege/POSIX-permission-bit limitations - see `SECURITY.md`'s Windows execution-limitation section). Dataset/Baseline v1-v6 all `UNCHANGED` on both platforms.
- **Certified snapshot at `ca9bfa0`** (the RTI-1..RTI-8 + RTI Integrated Audit corrective baseline - see [ROADMAP.md](ROADMAP.md)): genuine post-merge push-event CI on the exact merge commit passed **3951** total (**3943** pass, 0 fail, 8 skip - the 8 skips are the same pre-existing, unrelated Windows-only platform-limitation set, none RTI-related), independently reproduced locally on this same commit. Test count naturally grows as the codebase grows; treat this as a point-in-time certified count tied to `ca9bfa0`, not a permanently-current number - the CI badge and each roadmap stage's own merge/post-merge proof remain the authoritative source for whatever commit is actually current.

## Continuous Integration

GitHub Actions ([.github/workflows/cypress.yml](.github/workflows/cypress.yml)) runs on pushes to `main`, pull requests targeting `main`, and manual dispatch. Seven jobs run per trigger: `Unit tests`, `QA Agent evaluation` (offline, informational), `Cypress - chrome`, `Cypress - edge`, `Cypress - firefox`, `Playwright Chromium`, and `QA AI triage` (runs after all four E2E legs, at most once per workflow run).

**If every E2E leg (all three Cypress browsers and Playwright) passes, AI analysis is skipped entirely** (`No E2E failures detected; AI triage skipped.`) - zero provider calls happen on a green run. If any leg fails, the deterministic aggregator selects one primary failure across both frameworks, computes `browserCorrelation`/`frameworkCorrelation`, and triggers exactly one AI analysis. **AI never controls whether the workflow passes or fails** - each framework's own pass/fail is always authoritative, regardless of whether AI analysis ran, succeeded, or failed.

Required branch-protection checks are `Cypress - chrome`, `Cypress - edge`, `Unit tests`, `Playwright Chromium`, and `QA Agent evaluation`. `Cypress - firefox` and `QA AI triage` are deliberately **not required** - each is informational while its real-world reliability is observed independently. (Firefox's own execution-environment split from Chrome/Edge, and CI history in general, are explained in [Detailed Engineering History](#detailed-engineering-history) below - this is normal engineering history for a live external site, not evidence of a current defect.)

**Current repository governance profile: solo-maintainer.** A pull request is required for every merge to `main`; the branch must be up to date (strict mode) and every required check above must pass; branch-protection rules apply to the repository administrator as well - there is no admin-bypass exemption. A required second-human-approving-reviewer count is deliberately not enforced, since this is a single-maintainer repository and a second qualifying reviewer does not exist; independent adversarial source review is still mandatory under this project's own delivery process before any change merges (see the roadmap history below), it is simply not the specific GitHub review-count mechanism.

## Repository Evidence and Branch Retention Policy

This repository accumulates branches and pull requests beyond ordinary merged implementation history: deliberately non-merged controlled-failure experiments, evidence probes, infrastructure spikes, and diagnostic investigations. A branch's name or prefix (`experiment/*`, `evidence/*`, `diagnostic/*`, `spike/*`, `stabilization/*`, `feature/*`, and similar) is a hint only and is never sufficient classification authority by itself; classification must be based on actual provenance (PR association and disposition, ancestry relative to `main`, unique commits, durable references elsewhere in the repository, and the branch's roadmap/evidentiary role). Likewise, **non-ancestor status does not mean disposable** - controlled evidence is often deliberately kept unmerged - and **ancestor status does not automatically mean safe to delete** - a merged branch can still carry provenance value.

Every branch/PR is expected to fall into one of seven classes:

- **ACTIVE** - unfinished or currently in-progress repository work (e.g. an open implementation PR, active corrective work). Default: retain; deletion is forbidden while active. Not every open PR is ACTIVE - a deliberately open evidence or spike PR is not unfinished work.
- **MERGED_IMPLEMENTATION** - ordinary completed implementation whose substance is represented in certified `main`. A branch becomes a *cleanup candidate* only once its PR is merged, its approved source provenance is on record, the merge commit is present on `main`, post-merge certification is complete, no unique branch-only evidence remains, and no active work still depends on it. Candidate eligibility is not the same as deletion authorization - see below.
- **LOAD_BEARING_EVIDENCE** - evidence whose removal would materially weaken a current reproducibility, controlled-failure, CI, security, architecture, or evaluation claim. Default: retain, and deletion must remain prohibited unless equivalent provenance (purpose, ground truth, exact commit SHA, associated PR, workflow run, result, and any supersession relationship) has first been durably migrated to another artifact - for example a `dataset-vN.json`/`baseline-vN.json` evaluation fixture, a `historicalObservations`-style record, permanent documentation, or a future evidence manifest - and that migration has itself been independently reviewed.
- **HISTORICAL_REFERENCE** - useful provenance that is no longer the *sole* load-bearing proof, typically because equivalent durable evidence already exists elsewhere in the repository and no current reproducibility claim depends on the live ref. Default: retain. It may become a future cleanup candidate once independent review confirms the durable substitute is sufficient - age by itself is never sufficient justification.
- **DIAGNOSTIC_DISPOSABLE** - a closed, temporary investigation whose findings are captured elsewhere (permanent documentation, a merged fix, or a superseding permanent solution), with no active roadmap dependency, no unique required reproducer, no load-bearing evidence role, and no relevant open PR. Candidate eligibility: yes. Immediate deletion: no - it still requires the separate cleanup lifecycle below.
- **ORPHAN** - no PR, issue, roadmap, documentation, or workflow/evaluation role, and no unique required history. This classification requires strong positive evidence of *absence* of any role; insufficient investigation must never be resolved into ORPHAN merely to permit deletion.
- **UNRESOLVED** - the required fail-safe classification whenever available evidence is insufficient to reach one of the above with confidence. Default: retain; deletion is forbidden until the branch is resolved into a defensible class.

**Controlled-failure branches** (deliberately containing an intentional defect or failing assertion to prove a pipeline or investigate a defect) are evidence, not broken implementation work, and must not be merged into `main` unless a later, separately-approved task explicitly transforms or removes the controlled failure and goes through normal independent source review and approval. Today this is enforced by project policy, explicit PR title/body wording (e.g. "DO NOT MERGE", "MUST NEVER BE MERGED"), and review discipline - **there is currently no generic technical merge guard** (such as an automated check that blocks merging a recognized controlled-failure marker) enforcing this. Adding one is a possible future hardening step, not current capability.

**Evidence PR lifecycle.** A deliberately non-merged evidence or spike PR may be either:

- **KEEP_OPEN_AS_EVIDENCE** - justified only when the open state itself serves an active, current purpose (continuing observation, an active experiment, or another explicit operational need still in effect) - never from inertia or because an older PR body once said so; or
- **CLOSE_UNMERGED_AND_RETAIN_BRANCH** - once evidence capture and observation are complete and the branch must never merge, closing the PR while retaining its branch, exact tip SHA, body, comments, and workflow-run references preserves the same evidence with a smaller accidental-merge surface. Closing a PR without merging does not delete its body, comments, timeline, or branch.

A PR's open/closed state is mutable external metadata, not source - just as PR-body content was under CS6. Changing it therefore requires its own separately authorized lifecycle step; it must never be silently bundled with an unrelated source change.

**Cleanup is a separate lifecycle from classification.** Classification and retention-policy approval establish eligibility only; they are never themselves a deletion authorization, regardless of class - including MERGED_IMPLEMENTATION, DIAGNOSTIC_DISPOSABLE, and ORPHAN. Any future destructive branch cleanup must proceed through its own sequence - candidate selection, independent exact-ref review, explicit cleanup authorization, exact-ref deletion execution, and post-deletion verification - and any deletion must be bound to an exact branch name and its exact expected tip SHA, refusing to proceed if the branch's current tip differs from the approved tip. **No wildcard, prefix-wide, or age-only deletion is ever authorized** (for example: deleting all of `experiment/*`, all merged branches, or everything older than some age) - every deletion is a single, named, exact-ref decision.

## Current Multi-Framework Status

This section states current reality plainly, neither overclaiming nor understating it. **Both Cypress and Playwright have active, production-integrated GitHub Actions workflows today** - this is the result of Roadmap #21 (#21A-#21J), which took Roadmap #19's offline-proven adapter architecture into real production CI, including one deliberately controlled, real Playwright failure that exercised the entire evidence pipeline end to end (see [Evidence maturity](#evidence-maturity) below for exactly what that controlled run did and did not prove).

**Today, this repository actively runs in production against one project, across two E2E frameworks:**

- Project / SUT: a single, publicly accessible third-party POI (points-of-interest) map web application. It is not part of this repository and not owned by this project - it exists only as a realistic external target for the Cypress suite and a source of real cross-browser failure evidence for the QA AI Agent to triage. Its stable identity is a `projectId` owned by the current `ProjectProfile` (see below).
- E2E framework: **Cypress** (active production runtime)
- Browsers: **Chrome, Edge, Firefox**
- AI providers: **Mock, Groq, Gemini**

Everything below matters for *introducing a second project*, not for enabling a second framework - that work is done (Roadmap #21).

**Already project/framework-neutral:**

- Provider abstraction (`providers/**`) and the `analyze()` contract
- The deterministic policy layer (`agent-policy.js`)
- The correlation *algorithms* (they reason over already-normalized evidence - `title`/`specFile`/`error.message`, or trusted `framework`/`outcome` literals - not over any framework-native shape)
- Evaluation/regression scoring semantics
- Most of the system prompt's reasoning rules (grounding, history authority, correlation authority, knowledge authority)
- Project identity *ownership* (Roadmap #19.2): a minimal, immutable `ProjectProfile` is the single source of stable project identity and project-specific context - a future second project is supplied as data, not by editing consumers
- The normalized failure contract (`title`/`fullTitle`/`specFile`/`error`, optional `duration`/`screenshot`) - proven framework-neutral by a dedicated Cypress-free test and by real, independent, **production** use from both adapters

**Resolved (project axis, Roadmap #19.2/#19.3):**

- Explicit, stable project identity (`projectId`) is emitted unconditionally by collection and carried through to the report; the prompt persona renders whichever `ProjectProfile` it is given
- `PROJECT_VERIFIED` knowledge and flaky-test History are both scoped to `projectId` - a different or missing project can no longer influence either
- Roadmap #19.4 proved this isolation boundary offline, against a fully synthetic second project - no second real project exists in production today

**Resolved (framework axis - offline foundation Roadmap #19.5-#19.9, real production enablement Roadmap #21):**

- Explicit, canonical framework identity (`context.metadata.framework`) is produced unconditionally, sourced from the active adapter's own `.id`, selected at runtime by `scripts/ai/runtime-framework-selector.js` (`QA_FRAMEWORK=playwright`, defaulting to `cypress`; an unsupported value fails closed) (#19.5, #21E)
- Failure collection no longer parses one framework's raw report format inline: `cypressAdapter` and `playwrightAdapter` each own their own report parsing behind the identical `{id, collect()}` module contract, with Cypress's own historical output protected by a frozen golden-comparison test (#19.6, #19.7)
- **Both adapters run in real production CI today** - `cypressAdapter` against Chrome/Edge/Firefox, `playwrightAdapter` against a real, installed `@playwright/test` Chromium run in its own GitHub Actions job (Roadmap #21B/#21C/#21F/#21G)
- Source-evidence discovery (`relevantFiles`) is now **framework-aware**: a `RELEVANT_FILES_POLICIES` map (`scripts/ai/collect-context.js`) gives Cypress its own allowlist (`cypress/`, `cypress.config.js`, `package.json`) and Playwright its own, independently-scoped allowlist (`playwright/`, `playwright.config.js`, `package.json`) - a real Playwright failure reaches the model with real spec-source context, not none (Roadmap #21C)
- Flaky-test History has both a **project AND framework** namespace (Roadmap #19.9) and a **real Playwright producer**: `collect-history.js` targets the exact GitHub Actions job name for either framework (`Cypress - <browser>` or `Playwright Chromium`) - a real controlled Playwright failure independently proved the Playwright History path executes naturally in CI, with counts matching independently-derived GitHub Actions ground truth (Roadmap #21H/#21I - see [Evidence maturity](#evidence-maturity) below)
- Attachment/source-path handling is canonical-path, realpath-based, and cross-platform (Windows case-insensitive drive/segment matching; POSIX case-sensitive), proven both by a deterministic adversarial test matrix and by one real controlled Playwright failure's real screenshot evidence (Roadmap #21D/#21I - see [Evidence maturity](#evidence-maturity))
- Knowledge units describing Cypress-specific behavior already declare `appliesTo.frameworks: ["cypress"]` and are excluded from a Playwright-framed analysis by the existing selector logic

**What remains (only the project axis, not the framework axis):** enabling a genuinely second project in production is not yet done - `ProjectProfile` and the isolation boundary are proven offline against a synthetic second project only (Roadmap #19.4). This repository still runs against exactly one real project.

Both project portability and framework portability now have **stable identity and enforced isolation**: `ProjectProfile.id` and `adapter.id` are each a single source of truth, and both Knowledge and History refuse to let one project's or one framework's context influence another's analysis. See [Roadmap #19](#roadmap-19--project--framework-portability) and [Roadmap #21](#roadmap-21--production-playwright-enablement--final-hardening) below for the full history.

## Evidence maturity

Not every claim in this document carries the same kind of proof. This section states, plainly, which claims have **real GitHub Actions CI evidence** versus which are **covered primarily by deterministic offline tests** versus which are **architectural/source-derived** claims never specifically exercised.

**Live-proven** (one real, controlled, natural GitHub Actions `pull_request` run - Roadmap #21I - preserved immutably on an unmerged evidence branch, never rerun):

- Real Playwright production execution: Chromium, one worker, one test, zero retries, one invocation
- Real Playwright JSON reporter output and a real failure screenshot, both from the actual run
- Real `playwrightAdapter` routing, with real framework-aware source-evidence selection (no Cypress source contaminated the analysis)
- Real, observed reporter-path normalization and real screenshot locality/containment handling (the "happy path" of R1/R2/R3 - see below)
- Real `QA_FRAMEWORK=playwright` → `metadata.framework=playwright`, with no framework fallback
- Real Playwright History execution: the History-collection step ran naturally (conditioned on the Playwright job's own failure), scoped to the real project and framework, with counts that independently matched GitHub Actions ground truth computed separately from the same API
- Real `browserCorrelation` (Playwright-only, no Cypress contamination) and real `frameworkCorrelation` (Cypress success / Playwright failure, both frameworks passed cleanly with zero organic confound on the Cypress side)
- Exactly one real, logical AI analysis (Groq, first-attempt success, no fallback)
- A real `TEST_BUG` classification with an evidence-grounded root cause, and a model-native `shouldCreateBug: false` (the deterministic policy layer was not even needed to correct it)
- No automatic GitHub issue was created

**Deterministically proven** (covered by the offline unit-test suite, not live-exercised by the one controlled run above): adversarial path-safety rejection cases - URL-like values, `file:` scheme, UNC paths, traversal, same-prefix sibling directories, a different drive letter, symlink escape, a directory masquerading as a screenshot, an attachment body never treated as filesystem evidence; malformed/invalid framework-identity fail-closed behavior for both frameworks; malformed History-metric rejection; project/framework History-isolation matrices; provider contract/error-normalization/retry behavior; evaluation regression protection.

**Not claimed:**

- Playwright's one independent smoke scenario is **not** equivalent coverage to the Cypress suite - it exercises one representative UI flow, not the same scenarios
- `frameworkCorrelation` never implies same-test equivalence between frameworks - a Cypress pass never disproves a Playwright failure, or vice versa
- The AI provider does **not** receive screenshot image bytes/pixels - only a repo-relative path/reference reaches the model (see [What is sent to AI providers](SECURITY.md#3-what-is-sent-to-ai-providers) in `SECURITY.md`)
- There is no automatic GitHub issue creation, no automatic cross-provider fallback, and no generic content-level DLP anywhere in this pipeline
- Not every adversarial security case above was live-tested against real CI - they are proven deterministically, which is a different (still strong) kind of evidence, and this document does not collapse the two

## Known Architectural Boundaries

Stated as engineering seams and deliberately deferred work, not defects. Roadmap #19.2/#19.3 resolved the project-axis boundaries that used to be listed here. Roadmap #19.5-#19.9 (offline foundation) plus Roadmap #21 (real production enablement) resolved every framework-axis boundary that used to be listed here - source-evidence discovery, production runtime/CI, real reporter compatibility, attachment/path handling, and History's producer are all now framework-aware and Playwright-proven in real CI. What remains is entirely about the *project* axis, not the framework axis:

1. **Only one real production project exists.** `ProjectProfile`/History/Knowledge project-isolation is proven offline against a synthetic second project (Roadmap #19.4) only - a genuine second project has never run through this pipeline in production.
2. **A small number of informational, non-blocking observations remain** (documented, not hidden): `error.stack` may contain a standard hosted-runner absolute source path as intentional model-visible evidence (never a secret) - see `SECURITY.md`; a theoretical, structurally-unreachable "both sides say an unsupported framework string" edge case in the framework-identity consistency check, closed off in practice by every real production producer being hardcoded to exactly `cypress`/`playwright`.
3. **#19.7F-B4B (Firefox forensic observability) is now live-validated.** An organic occurrence of the known intermittent Firefox failure signature (`cy.wait()` timeout on the `poiTiles` route, no request ever occurring) happened naturally during a documentation PR's own CI run (GitHub Actions run `32873480322`, unrelated to and unaffected by that PR's docs-only content) - the corrected capture behavior executed and its `firefox-forensics` artifact uploaded successfully (18 files), and the sensitive-pattern scan flagged nothing. **This confirms the capture pipeline itself works live; it does not establish a root cause.** #19.7F-C's own status is unchanged by this occurrence: an earlier organic Firefox review had already confirmed this exact failure family (`poi_data_requests.cy.js`/`cy.wait("@poiTiles")`), with the root cause left inconclusive; that occurrence was a second, independently-captured instance of that same known family, live-validating B4B's corrected capture path without newly resolving the underlying root cause - see [Detailed Engineering History](#detailed-engineering-history) below.

None of these affect current production behavior. See [Roadmap #19](#roadmap-19--project--framework-portability) and [Roadmap #21](#roadmap-21--production-playwright-enablement--final-hardening) below.

## Key Architecture Decisions

- **One logical AI analysis per failing workflow, not one per browser.** Avoids duplicate/racing analyses, keeps cost and rate-limit exposure bounded, and gives the model real cross-browser evidence in a single call instead of splintering it across several.
- **The LLM never owns the final `shouldCreateBug` decision.** Action-triggering decisions must stay deterministic and auditable; a model recommendation is an input to policy, never the policy itself.
- **Knowledge is guidance, never evidence.** Curated engineering knowledge can broaden a hypothesis but is structurally forbidden from manufacturing a fact about the current run - this boundary is enforced by prompt contract and tested behaviorally, not just documented.
- **Evaluation baselines are frozen once merged.** A regression target that can move is not a regression target - new evidence becomes a new, additive dataset version, never a retroactive edit to what "passing" used to mean.
- **Provider adapters, not a provider-aware core.** Transport, auth, and vendor-native envelopes live entirely in `scripts/ai/providers/`; adding Gemini as a second real vendor required zero changes to prompt, policy, knowledge, or evaluation code - proving the boundary is real, not aspirational.
- **No automatic provider fallback.** A misconfigured or failing provider fails the analysis honestly rather than silently substituting a different provider or a fabricated result - hidden fallback would also hide cost, semantics, and observability changes a human should see.
- **A synthetic portability proof came before any real second-framework integration.** Roadmap #19 proved the `NormalizedFailure` abstraction and a second adapter (`playwrightAdapter`) entirely offline, against official-shape synthetic fixtures, before ever considering a real Playwright integration - so the question "does the abstraction actually work" was never conflated with "did I map one specific framework's reporter API correctly."
- **Test design and test automation escalate authority in explicit, reviewable steps.** #22/#23 never collapse "AI proposes" and "code executes" into one step - each authority increase (design → generated code → filesystem write → process execution) has its own gate, and the two human-review gates are the only ones that can advance the pipeline.

## Roadmap #19 — Project / Framework Portability

**Status: Phase A (project portability, #19.1-#19.4) COMPLETE. Phase B (framework portability, #19.5-#19.9) COMPLETE OFFLINE. #19.10 (final portability review + documentation closure) COMPLETE. Production Playwright enablement, deferred at the time this roadmap item closed, was later completed by Roadmap #21 - see [Roadmap #21](#roadmap-21--production-playwright-enablement--final-hardening) above.**

The original #19.1 audit (summarized under [Current Multi-Framework Status](#current-multi-framework-status) and [Known Architectural Boundaries](#known-architectural-boundaries) above) identified two genuinely separate axes, deliberately not collapsed into one generic "plugin" concept:

### Phase A — Project portability

**Completed:**

- #19.1 - architecture/coupling audit (read-only; identified the gaps below)
- #19.2 - explicit project identity foundation: a minimal, immutable `ProjectProfile` now owns stable project identity (`projectId`) and stable project-specific constraints; the system prompt's persona identity is parameterized through it instead of hardcoded; `context.metadata.projectId` and the report's `sourceContext.projectId` are both populated; the production prompt output is unchanged, byte-for-byte
- #19.3 - project-scoped knowledge/history: `PROJECT_VERIFIED` knowledge now requires an explicit `appliesTo.projects` scope, and flaky-test History now carries a `ProjectProfile`-sourced `projectId`; both are checked against the current analysis's project identity before being allowed to influence it - a different, missing, or malformed project identity on either side excludes project-specific Knowledge/History rather than treating it as universally applicable
- #19.4 - a fully offline proof using a second, synthetic project - no live site, no real provider calls - validating the project-isolation boundary end to end

Phase A is complete: project identity has stable ownership (`ProjectProfile`) and enforced isolation across both Knowledge and History, proven both individually and combined.

### Phase B — Framework portability

**Completed offline (#19.5-#19.9):**

- #19.5 - explicit, canonical framework identity (`context.metadata.framework`, sourced from a single adapter-identity constant) and a formally validated `NormalizedFailure` contract (`title`/`fullTitle`/`specFile`/`error`, optional `duration`/`screenshot`) - the minimum generic shape the analysis core already depended on, now explicit and checkable
- #19.6 - Cypress/Mochawesome-specific parsing extracted behind `scripts/ai/adapters/cypress-adapter.js`, exposing a plain `{id, collect(reportsDir?, screenshotsDir?)}` module contract - no class hierarchy, no registry
- #19.7 (incl. #19.7H) - Cypress historical-equivalence protection (a frozen, byte-for-byte golden comparison proving the extraction changed no observable behavior) plus filesystem-isolation hardening for the unit-test suite itself
- #19.8 - a second, independently-implemented adapter (`scripts/ai/adapters/playwright-adapter.js`) proving the same `{id, collect()}` contract normalizes official Playwright JSON-reporter-shaped evidence into the identical generic `{testResults, failedTests, warnings}` output - built and tested entirely offline, using Playwright's own logical `test.status` (never an individual attempt's `result.status`) as the sole authority for pass/fail/flaky/skipped classification
- #19.9 - the generic collector (`collect-context.js`) now accepts either adapter through explicit dependency injection, offline; `context.metadata.framework` is unconditionally sourced from the active adapter's own `.id`; and flaky-test History gained a framework namespace (project AND framework, both required) so Cypress and Playwright evidence can never cross-contaminate each other's analysis, while legacy pre-#19.9 History (with no framework field) remains usable only as Cypress evidence

**What Phase B proved, and what it deliberately did not, at the time it shipped:** a framework-neutral evidence pipeline existed, and a second framework's adapter had been built and independently tested against it - entirely offline, with zero Playwright package, browser, or CI involved. At that point Cypress remained the only framework with an active production workflow, and the collector's zero-argument production entry point always resolved to `cypressAdapter`. **This is now historical**: real production Playwright enablement was completed by Roadmap #21 (see [Roadmap #21](#roadmap-21--production-playwright-enablement--final-hardening) above) - Phase B's offline proof is preserved here as the accurate record of what #19.5-#19.9 itself shipped, not a statement of current production capability.

**Next:**

- #19.10 - final portability review (#19.10A, read-only audit: found no runtime blockers) and documentation closure (#19.10D). This closed the offline portability milestone. Real production Playwright enablement was later delivered as Roadmap #21, a separate roadmap item, not a continuation of #19 - see [Roadmap #21](#roadmap-21--production-playwright-enablement--final-hardening) above.

### Current architecture (offline-proven framework boundary)

```
Cypress raw report                  Playwright JSON-reporter-shaped evidence
(cypress run / Mochawesome)         (official reporter shape, offline fixtures only)
        │                                       │
        ▼                                       ▼
  cypressAdapter.collect()           playwrightAdapter.collect()
        └────────────────┬──────────────────────┘
                          ▼
           { testResults, failedTests, warnings }   (identical shape, either adapter)
                          │
                          ▼
       collect-context.js  main({ adapter, adapterOptions })
         - production, zero-argument call: always cypressAdapter
         - offline dependency injection (tests only): either adapter
                          │
                          ▼
         context.metadata.framework = adapter.id
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
        History        Knowledge      relevantFiles
   (project AND       (appliesTo.    (still Cypress-
    framework          frameworks     oriented - see
    namespaced)         scoped)       Known Architectural
                                       Boundaries above)
           └──────────────┼──────────────┘
                           ▼
                   QA prompt / Provider Factory / validation / policy / report
                           (UNCHANGED - already framework-neutral)
```

**Not yet built at the time this diagram was drawn** (all since delivered by Roadmap #21, see above): a Playwright CI workflow, a Playwright History producer, a production framework selector, a framework-aware `relevantFiles` source-evidence policy, and out-of-root/attachment-locality path hardening. None of this was required for - or claimed by - the offline portability proof above; this diagram documents the offline-only state Roadmap #19 itself shipped.

## Roadmap #20 — Data Security & Governance

**Status: #20A-#20E COMPLETE - implementation and independent review are both finished. Roadmap #20 closure (this documentation landing on `main`) is delivered by PR #85.**

- **#20A - Security/privacy/governance baseline audit.** COMPLETE. A read-only audit of the existing pipeline's data-exposure surface.
- **#20B - Model-visible trust-boundary hardening.** COMPLETE. Introduced a positive-projection boundary (`projectPromptFailure()`/`projectPromptError()`) so unknown adapter-added failure/error extras can never become model-visible by construction, and unified persisted/terminal provider-error handling under one sanitized policy (`summarizeProviderError()`).
- **#20C - Independent security review.** COMPLETE. Independently re-verified #20B's claims against source and live tests, including an empirical unknown-provider-error-code fail-safe check.
- **#20D - Governance documentation.** COMPLETE. Consolidates the already-implemented, already-verified controls above into [SECURITY.md](SECURITY.md) - a docs-only change, adding no new runtime control.
- **#20E - Independent governance-documentation review.** COMPLETE. Independently verified `SECURITY.md`'s claims against current source; found and required correction of one inaccurate credential-authentication claim (`AI_API_KEY` had been described as if it universally used an `Authorization: Bearer` header, which is true for Groq but not for Gemini's `x-goog-api-key` header). The correction was applied to `SECURITY.md` and independently re-verified, with no other governance content changed.

See [SECURITY.md](SECURITY.md) for the full data-governance contract: what reaches an AI provider, what's excluded, credential handling, provider/retry policy, artifact boundaries, and explicit known limitations (no PII detector, no full content-level DLP, no global prompt-size ceiling, provider-side retention outside this repository's technical control).

## Roadmap #21 — Production Playwright Enablement + Final Hardening

**Status: COMPLETE_ON_MAIN.** Technical implementation and evidence work, and the #21J-B documentation update that closed it, are both independently reviewed, merged, and verified on `main` - see [Roadmap closure state](#roadmap-closure-state) at the end of this document for the exact stage-by-stage closure record.

Roadmap #21 took Roadmap #19's offline-proven adapter/portability architecture into real, production GitHub Actions CI - the single largest architectural change since the original pipeline shipped.

- **#21A-#21C - Playwright production groundwork.** Real, installed `@playwright/test` configuration (single Chromium project, one worker, zero retries), a real-installed-reporter proof of Playwright's actual JSON report shape (superseding the #19.8 synthetic-fixture model), and a framework-aware `relevantFiles` source-evidence policy (`RELEVANT_FILES_POLICIES`) giving Playwright its own independent allowlist alongside Cypress's.
- **#21D - Path/attachment security hardening (R1/R2/R3).** Repo-local, canonical-path (realpath-based) containment for reporter-derived spec paths and attachment locality, closing the out-of-root/absolute-path gaps #19's own boundary list had flagged. Windows canonical-path case-sensitivity was later found and closed (D21D-3, #21I-A) using segment-aware `path.win32`/`path.posix` semantics - never a naive lowercase-prefix check.
- **#21E - Runtime framework selector.** `scripts/ai/runtime-framework-selector.js`: `QA_FRAMEWORK=playwright` selects `playwrightAdapter`; absent/unset defaults to `cypressAdapter`; any other value fails closed with a bounded configuration error - hardened (D21E-2) against non-string selector values (arrays, objects, a crafted `toString()`) that could otherwise coerce into an accidental selection.
- **#21F-#21G - Real Playwright CI + centralized triage integration.** A real `Playwright Chromium` GitHub Actions job, wired into the same centralized `QA AI triage` job Cypress already used - `browserCorrelation` and the new, separate `frameworkCorrelation` (Roadmap #21G-C1) were split apart after an independent review found the original design risked treating an independent framework's outcome as same-test browser corroboration.
- **#21H - Production Playwright History.** `collect-history.js` parameterized to target Playwright's own GitHub Actions job name and framework identity, with zero change to Cypress's own byte-identical default behavior; the pre-existing project+framework History isolation gates (from #19.9B) required no changes at all.
- **#21I - Independent controlled Playwright failure proof.** A single, deliberate, deterministic test-side assertion failure, executed exactly once via a natural GitHub Actions `pull_request` run on a dedicated, permanently unmerged evidence branch/PR, live-proving the entire evidence pipeline end to end for a real Playwright failure - see [Evidence maturity](#evidence-maturity) above for exactly what this did and did not prove. Also closed D21D-3 (Windows canonical containment) beforehand, as a prerequisite.
- **#21J - Final residual hardening + documentation.** Closed two low-severity, non-exploitable-in-production residual observations (D21H-1: framework-identity ABSENT-vs-INVALID distinction; D21H-2: bounded History-metric validation) and produced this documentation update (#21J-B).

Every stage above was independently reviewed before merging, following the same pattern used throughout this project's history: implement → validate → independent review → standard merge → natural post-merge CI verification.

## Roadmap FPI-2 – Terminal Audit — Full Project Independence

**Status: FPI-2/FPI-3/FPI-4/ID-1/ID-2 all COMPLETE_ON_MAIN and independently reviewed. External-repository installation, real existing-repository onboarding, reproducible versioned acquisition, and version upgrade transition are all independently-reviewed PROVEN. The terminal claim, Full Project Independence, was audited and re-audited following independent review of the final two proofs, and is now PROVEN - see the final re-audit verdict below.**

This roadmap arc asks a single question the earlier framework/project-portability work (Roadmap #19, above) never actually tested: can this pipeline run **outside this repository at all** - as an installed dependency of a genuinely separate, external project - not just be architecturally isolated from a second project's identity while still living inside the same checkout.

### FPI-2 — Trusted repository-root injection (PR #123)

Every generic module that reads or writes target-repository artifacts (evidence, reports, History, AI output) now anchors those operations to an explicitly supplied `repositoryRoot` (`scripts/ai/repository-root.js`) rather than deriving the target repository from this generic core's own `__dirname` or `process.cwd()`. Includes Corrective C4 (closing a browser-input read-authority gap and a generic-core write-authority gap found during independent review). This is the foundational trust boundary every later stage below builds on.

### FPI-3 — Real FrameworkRuntimeConfig consumer wiring (PRs #124–#127)

`FrameworkRuntimeConfig` existed as a pure contract since Roadmap #19 but had no real consumer until this stage: #124 wired it into `cypress-adapter.js`, #125 into `playwright-adapter.js`, #126 into `collect-history.js`'s `historyWorkflowFile` handling, and #127 (FPI-3bA) into the Knowledge loader via `ProjectKnowledgeConfig`. After this stage, a target's real report layout, config path, and CI workflow filename are all genuinely data-driven, not hardcoded assumptions.

### FPI-4A — Second-Project (Project B) Onboarding Proof (PR #128)

The first empirical proof that the architecture generalizes to a materially different second project: a synthetic, offline, deterministic "Project B" target was onboarded using only `ProjectProfile`/`FrameworkRuntimeConfig`/`ProjectKnowledgeConfig`/`repositoryRoot` as data, with zero generic-core changes. This proved multi-project **architecture**, not yet installation outside this repository - Project B still lived inside this same checkout.

### ID-1 — Package Boundary / Public Programmatic API (PR #129)

Introduced `scripts/ai/index.js`, a minimal public barrel exposing exactly 8 symbols: `collectContext` (`{main, runCli}`), `collectHistory`, `analyzeFailure`, `aggregateBrowserContext` (each `{main}`), and the four `assertValid*` validators. `package.json` gained `main`/`exports`/`files` to enforce this as the *only* reachable surface - adapters (`cypressAdapter`/`playwrightAdapter`) and the runtime framework selector are deliberately not exported; a consumer selects Playwright via `QA_FRAMEWORK` plus `runCli()`'s `adapterOptions`, never a direct adapter import.

### ID-2 — External-Repository Installation Proof (PR #130)

**EXTERNAL-REPOSITORY INSTALLATION: PROVEN.** A real `npm pack` from this repository's own `main`, followed by a real `npm install <tarball>` into a physically separate, `mkdtemp`-isolated external repository (never a symlink, `npm link`, workspace, or source-relative `require`) - exercising all four generic pipeline stages through the public API only, with `require.resolve("qa-ai-agent")` resolving only inside the external repository's own `node_modules`, zero `scripts/ai` production diff, and a verified-immutable package tree (full recursive hash manifest, 0 changed files) before/after the run. This is a **deterministic** proof (synthetic fixtures, no live external system) and remains the authoritative baseline the next stage supplements rather than replaces.

### Real Existing Repository Onboarding — TarasovArtem/TargomoPlaywright

**REAL EXISTING REPOSITORY ONBOARDING: PROVEN, independently reviewed.** ID-2's deterministic proof was supplemented (never replaced) by onboarding a real, independently-existing, previously-unrelated GitHub repository with a live SUT: `TarasovArtem/TargomoPlaywright` (a real Playwright E2E suite against `https://poi.targomo.com`). On an unmerged `experiment/qa-ai-agent-integration` branch (commit `853124e`, both repositories' `main` branches left untouched), the installed package was consumed via its public API only, with a small, genuinely target-owned integration (`qa-ai-agent-integration/`: `ProjectProfile`/`FrameworkRuntimeConfig`/`ProjectKnowledgeConfig`, four bootstrap scripts, ~226 LOC) against the real Playwright report (after an additive, target-owned JSON-reporter config change alongside the pre-existing HTML one) and the real `.github/workflows/playwright.yml` history. All four pipeline stages, package immutability, source-checkout independence, and focused negative-authority controls were independently re-verified by a separate adversarial review that re-derived every claim from a fresh clone and a freshly-built tarball rather than trusting the implementation's own account - see that review's own findings below.

**What this did not change:** `scripts/ai` production diff remained zero throughout; no target-specific reference to TargomoPlaywright exists anywhere in this repository's own source.

**What the independent review additionally found**, beyond confirming the above:

- The experiment's own committed `file:../pack-out/qa-ai-agent-1.0.0.tgz` dependency does **not** survive a fresh clone or clean CI (proven empirically with an empty npm cache - a real `ENOENT`, not a hypothetical) - this became the direct evidence motivating the (since-closed) reproducible-acquisition blocker; see [ACQ-UPG](#acq-upg--reproducible-acquisition--version-upgrade-transition-proof) below for how it was closed.
- A MEDIUM-severity, non-blocking evidence-completeness gap in `collect-context.js`'s Playwright `RELEVANT_FILES_POLICIES` (below).
- The experiment branch's own committed evidence snapshots (`reports/ai/*.json`) are internally inconsistent leftovers from different, unrelated runs - an experiment-hygiene finding, not an architecture defect; every underlying claim was independently re-derived fresh and holds.

### ACQ-UPG — Reproducible Acquisition + Version Upgrade Transition Proof

**REPRODUCIBLE VERSIONED ACQUISITION: PROVEN. VERSION UPGRADE TRANSITION: PROVEN. Both independently reviewed.** Two immutable, annotated, remote git tags were created against this repository - `proof/acq-v1` (package version `1.0.0`, pointing at the approved `main` commit, zero source diff) and `proof/acq-v2` (package version `1.0.1-proof`, a dedicated proof-only commit changing nothing but the version field in `package.json`/`package-lock.json` - not a formal product release). A fresh external consumer depended on `"qa-ai-agent": "github:TarasovArtem/qa-ai-agent#proof/acq-v1"`, installed with a genuinely empty npm cache, and succeeded.

The independent review went further than the implementation's own check: it ran the acquisition again inside a fully authentication-isolated environment - an isolated `HOME` with no `.ssh` directory at all, no SSH agent, no `GH_TOKEN`/`GITHUB_TOKEN`/`NODE_AUTH_TOKEN`, and an isolated Git configuration that hid this machine's real credential helper from the install subprocess entirely - and it still succeeded. Network tracing confirmed the actual fetch as `GET https://codeload.github.com/TarasovArtem/qa-ai-agent/tar.gz/<commit>` - GitHub's public, anonymous tarball-snapshot endpoint, requiring no credentials of any kind for a public repository. **The `git+ssh://git@github.com/...` string that appears in a consumer's `package-lock.json` for this dependency is npm's own cosmetic canonical representation for `github:` shorthand deps - it does not reflect the actual transport used, which was anonymous HTTPS, and must not be read as implying SSH credentials are required.**

The upgrade was then performed via ordinary, standard npm usage - `npm install qa-ai-agent@github:TarasovArtem/qa-ai-agent#proof/acq-v2` - reported `changed 1 package`, again fetched anonymously, and left the external consumer's own target-integration source (`ProjectProfile`/`FrameworkRuntimeConfig`/`ProjectKnowledgeConfig`/bootstraps/knowledge) byte-for-byte identical to before the upgrade. The installed package tree itself changed in exactly one of 70 files (`package.json`'s version field) between the two versions. The full generic pipeline, package immutability, and focused negative-authority controls all passed identically on both versions. A second, entirely independent fresh consumer installing `proof/acq-v2` directly (never upgraded from `proof/acq-v1`) also succeeded, proving Version B is independently consumable, not merely reachable as an upgrade path.

**Open, non-blocking finding:** a bare `npm install` after only editing a git-ref dependency string in `package.json` does not reliably re-resolve the new ref (independently reproduced) - the ordinary, standard `npm install <pkg>@<ref>` command performs the upgrade correctly. This is external npm CLI/lockfile-caching ergonomics, not a qa-ai-agent defect, and does not affect the upgrade-transition proof.

`proof/acq-v1`/`proof/acq-v2` are retained permanently as reproducibility evidence for this proof chain - they are proof/evidence refs, not formal product release tags, and must not be read as such. The corresponding branch, `proof/acq-upg-version-b` (PR #132), was never merged and is not production merge material - it exists only to produce a reviewable, reconstructible commit for the version-B proof identity.

### Full Project Independence — Terminal Audit and Final Re-Audit

Terminal definition audited: *a fresh external repository can consume a versioned qa-ai-agent distribution, provide only target-owned `ProjectProfile`/`FrameworkRuntimeConfig`/`ProjectKnowledgeConfig`/`repositoryRoot` and environment inputs, execute the generic pipeline locally and/or in ordinary CI, and upgrade the agent without copying or modifying generic source.*

```text
FULL PROJECT INDEPENDENCE:
PROVEN
```

Every clause of that definition is now independently proven: a fresh external repository consuming the package (TargomoPlaywright; three further independent ACQ-UPG consumers), all four target-owned authority objects, local execution of the full generic pipeline, no generic-source copying, package immutability, generic target independence, reproducible remote versioned acquisition without producer state or developer credentials, and version upgrade without any target-integration rewrite. In-CI execution inside a target's own workflow and a production merge of the TargomoPlaywright experiment branch were both audited and found **not required** by the terminal definition's own disjunctive wording (`locally and/or in ordinary CI`) - local execution alone already satisfies that clause.

This is an **architectural-independence** claim only - see [Package Maturity vs. Architectural Independence](#package-maturity-vs-architectural-independence) below for exactly what it does and does not additionally claim.

**Playwright relevant-files gap (MEDIUM, open, non-blocking).** `collect-context.js`'s `RELEVANT_FILES_POLICIES.playwright` hardcodes an internal-dogfood-shaped assumption (`testDir: "./playwright"`, `playwright.config.js`) and never reads `FrameworkRuntimeConfig.testSourceRoot`/`frameworkConfigPath` at all - independently confirmed by direct source inspection and reproduced multiple times with real external-target failures. A real target's failed-test title, error, stack trace, and screenshot all survive intact regardless; only secondary corroborating evidence (the config file, the failed spec's own source) is silently omitted. This does not block Full Project Independence and remains open - named future corrective: **Playwright Relevant-Files Config Wiring** (wire `frameworkConfigPath` into config collection and `testSourceRoot` into failed-spec resolution; preserve the exact historical fallback when no config is supplied; no autodiscovery; no target-specific branching).

**`ID-3` classification (unchanged):** `RELEASE / VERSION OPERATIONALIZATION ONLY`, not started. Full Project Independence being proven does not begin `ID-3` - it establishes the architectural prerequisite `ID-3` can now build on. Possible future `ID-3` scope: formal version policy, production release tags, an npm-registry-publication decision, consumer install guidance, rollback/version lifecycle, a CLI/convenience surface, reusable CI integration - none of this is implemented or begun.

**Mandatory ordering:** Terminal Audit → Documentation/Roadmap Sync → Documentation Consistency Review → Documentation Merge → `ACQ-UPG` → `ACQ-UPG` Independent Review → Full Project Independence Final Re-Audit → **FPI Final Status Documentation Update (this update)** → its own independent consistency review and merge → only then `ID-3` planning. The Playwright relevant-files corrective remains legitimate, open product-quality work, schedulable before or during early `ID-3` planning, independent of this architectural verdict.

## Package Maturity vs. Architectural Independence

`FULL PROJECT INDEPENDENCE: PROVEN` is a precise, narrow architectural claim, proven exactly to the terminal definition stated above. It explicitly does **not** mean any of the following, none of which has been separately established:

- **npm-published or registry-ready** - acquisition was proven via a remote git-tag reference, never via `npm publish`; no npm registry decision has been made.
- **A formal, complete release process** - `proof/acq-v1`/`proof/acq-v2` are evidence tags for this proof only, not production release tags; there is no version policy, changelog process, or rollback lifecycle yet.
- **CLI or convenience-layer completeness** - a consumer today writes its own thin bootstrap/runner files (as every external integration in this roadmap arc has done); no dedicated CLI exists.
- **Reusable CI integration** - no packaged, reusable GitHub Actions workflow exists for consumers to adopt directly.
- **All diagnostic/quality gaps closed** - the Playwright relevant-files MEDIUM gap (above) remains open; it affects evidence *richness*, not architectural independence.
- **Production target integrations merged** - TargomoPlaywright's integration remains an independently-reviewed, unmerged experiment; the proof concerns *capability*, not a permanent deployment.

These are all legitimate, separate product-maturity and release-operationalization concerns, tracked under the future `ID-3` phase (not started) and the Playwright relevant-files corrective (open, MEDIUM). Architectural independence and production release maturity are deliberately different axes and must not be conflated.

## Roadmap RTI — Requirements & Test-Design Integration

**Status: `RTI-1` through `RTI-8` are all `COMPLETE_ON_MAIN` - the full RTI implementation arc is complete. `RTI-7`'s final documentation/closure step (`RTI-7I-B`, [PROVIDERS.md](PROVIDERS.md)) and `RTI-8`'s final documentation/closure step (`RTI-8K`, [PUBLISHING.md](PUBLISHING.md) and this documentation) were each independently reviewed and merged (`RTI-8K` required one narrow corrective, `RTI-8K-C1`, before independent re-review approved it; merged to `main` as PR #147, merge commit `fb46002`). **Implementation-complete is not the same as audited**: the mandatory **RTI Integrated Audit** subsequently ran and closed `PASS WITH DEFERRED DEBT` - it found and closed one BLOCKER (`RTIA-B01`, a `publishTestDesigns()` trust-boundary defect; corrective `RTIA-C1`, merge commit `ca9bfa0`) and one documentation inaccuracy (`RTIA-I01`), both independently reviewed and merged. **AISEC technical entry is now `APPROVED`** (RTI no longer blocks it) **but AISEC execution remains `NOT_STARTED`** - the project's current execution gate is the Conformance Remediation program, not AISEC, per an explicit owner phase-order decision. See [ROADMAP.md](ROADMAP.md) for the full current sequence, the conformance program, and that decision's record. ID-3 planning remains complete but its implementation is explicitly deferred in priority behind these gates - see below.**

A product arc, scheduled ahead of `ID-3` implementation (no conflict: `ID-3` had not begun any implementation when this decision was made). Full arc: `RTI-1` Requirement Artifact Contract → `RTI-2` File Requirements Ingestion → `RTI-3` Requirement Quality/Testability Analysis → `RTI-4` Test Design Generation → `RTI-5` Requirement↔Test Traceability/Coverage → `RTI-6` External Requirement Source Provider Contract → `RTI-7` concrete adapters for specific external issue trackers/requirements tools/test-management systems → `RTI-8` Test Case Publishing/Destinations. `RTI-1` through `RTI-7` are implemented, documented, and merged - see [PROVIDERS.md](PROVIDERS.md) for the RTI-7 Provider Authoring Contract, the durable record of what RTI-7 proved and what any future adapter (or reviewer of one) must guarantee. `RTI-8`'s implementation (generic publishing core, Azure DevOps Test Case destination, cross-vendor proof) and its own durable architectural record ([PUBLISHING.md](PUBLISHING.md)) are both complete and merged to `main` - the full `RTI-1`-`RTI-8` arc is formally closed. The mandatory **RTI Integrated Audit** (authority boundaries, security, API/backcompat, deep imports, distribution, determinism, contracts, provenance, identity, no-hallucination, side effects, failure semantics, test quality, CI, documentation truth, dead architecture, scalability, release readiness) subsequently ran against `main` and closed **`PASS WITH DEFERRED DEBT`**: it found and closed one BLOCKER (`RTIA-B01`) via a narrow corrective (`RTIA-C1`) and corrected one stale debt-table row (`RTIA-I01`), both independently reviewed, merged, and re-verified at commit `ca9bfa0`. This clears RTI as a technical blocker for the **Agentic Trust / AI Security / Memory Foundation** research track (`AISEC-1` through `AISEC-7`, then `MEM-1` through `MEM-9` - persistent autonomous agentic memory must not precede its own security architecture, and neither track has started) - `AISEC` technical entry is `APPROVED`. However, the project's current execution gate is **not** AISEC yet: a separate conformance analysis identified roadmap drift and required an owner phase-order decision, and the owner subsequently adopted a **Conformance Remediation** program (Wave 1 → Wave 2 → an Architecture Conformance Gate) to run first - see [ROADMAP.md](ROADMAP.md) for the full sequence and that decision's record. Only after those gates close does `AISEC-1` begin, followed eventually by a Full Project Strict Audit and productization planning.

### RTI-1 — Requirement Artifact Contract

Introduces `RequirementArtifact` (`scripts/ai/requirement-artifact.js`), the normalized, source-independent input model future Test Design capabilities will consume - answering "what behavior/product expectation should be tested?", deliberately separate from `ProjectKnowledgeConfig`'s "what project/domain constraints influence interpretation?". A `source` sub-object (`{type, sourceId?, location?, system?, version?}`) preserves traceability back to origin (file, issue tracker, API spec, ...) as data only - `source.location` is provenance metadata, never filesystem authority, and no production code anywhere branches on `source.type`/`source.system`. Zero coupling to any external requirement-source system (no Jira/Xray/TestRail/Azure DevOps/Zephyr/Polarion reference anywhere in production source). Zero new runtime dependencies. `assertValidRequirementArtifact` is the fifth fail-closed validator added to the public API (alongside the four existing FPI-1/FPI-2 validators), following the identical `{valid, errors}`/throwing-wrapper convention already established by `scripts/ai/framework-runtime-config.js`/`scripts/ai/project-knowledge-config.js`. The outer artifact, `source`, and each `acceptanceCriteria[]`/`relationships[]` entry all use the identical FPI-1-corrective hardening (own-enumerable-data-property certification - never an inherited, non-enumerable, or accessor-backed value, with an accessor's getter never invoked - plus own-prototype rejection and unknown-key rejection). A collection-level validator and any `RequirementSet` aggregate were deliberately deferred to `RTI-2`, once a real ingestion adapter proved the actual shape needed - no ingestion, quality analysis, test generation, or external adapter is implemented in `RTI-1` itself. Merged to `main` as `a08ab8f0714244631d5cb35281ad197a761455c8`.

### RTI-2 — File Requirements Ingestion

Introduces `loadRequirementsFromFile({ repositoryRoot, filePath })` (`scripts/ai/requirements-file.js`), the first real `RequirementArtifact[]` source adapter - the tenth public export. It reads a target-owned, explicitly-authorized JSON requirements file and returns validated, source-independent `RequirementArtifact[]`, proving the ingestion ARCHITECTURE (filesystem authority, path safety, parsing, normalization, failure semantics), never document-understanding capability: zero AI/LLM calls, zero semantic invention (acceptance criteria/priority/requirements are never synthesized from unstructured text), zero new runtime dependencies.

```javascript
const { loadRequirementsFromFile } = require("qa-ai-agent");

const artifacts = loadRequirementsFromFile({
  repositoryRoot: "/absolute/path/to/target-repo",
  filePath: "requirements/requirements.json",
});
// artifacts: RequirementArtifact[] - already passed assertValidRequirementArtifact()
```

**Format scope**: JSON only for RTI-2 - Markdown/YAML/PDF/DOCX/XLSX are explicitly deferred to future format adapters, each of which needs its own separate format-contract design; no parser dependency for any of them is introduced here.

**File schema (v1)**: `{ "schemaVersion": 1, "requirements": [ { id, type, title, content?, acceptanceCriteria?, priority?, labels?, relationships?, contentHash?, metadata? } ] }` - one canonical top-level shape, `schemaVersion` must be exactly the integer `1` (an unrecognized value fails closed), unknown top-level or per-requirement keys are rejected outright (never silently dropped into `metadata`), and an empty `requirements` array is rejected (deterministic rejection of a likely authoring mistake, not silently accepted as a valid empty ingestion result).

**Filesystem authority**: `repositoryRoot` is the sole filesystem authority - `filePath` is resolved against it, never `process.cwd()` or this module's own location, and there is no autodiscovery of `requirements.json`/`requirements/`/`docs/`/`spec/`. Path safety reuses the existing trust primitives (`scripts/ai/context-utils.js`'s `isCanonicalPathInsideRoot()`, `scripts/ai/repository-root.js`'s lexical/canonical two-namespace boundary) rather than a second filesystem trust model, mirroring `scripts/ai/knowledge/loader.js`'s `loadProjectKnowledgeUnits()` "resolve lexically, then canonically re-verify via realpath" pattern - closing traversal, absolute-outside-root, and symlink-escape vectors alike. A 5 MiB file-size bound is enforced via `fs.statSync` before any content is read.

**Source provenance is adapter-owned, never file-owned**: `source = { type: "file", sourceId: <artifact.id>, location: <repository-relative, POSIX-normalized path> }` is constructed by this module itself - a raw record supplying its own `source` is rejected as an unknown key, so file content can never impersonate a different origin.

**Collection-level rules** (`RTI-1` explicitly deferred these to "once a real ingestion adapter exists"): duplicate `RequirementArtifact.id` within one file is rejected; duplicate non-empty `acceptanceCriteria[].id` values within the SAME artifact are rejected (never required unique across unrelated artifacts). `relationships[].targetId` is deliberately validated only for shape here, never resolved against the loaded set - a single JSON file is not assumed to be a closed world, and enforcing strict internal-only resolution now would fail closed on a legitimate forward/cross-source reference once multiple ingestion results are composed in a future phase.

No AI, no document interpretation, no external requirement-source system integration, no traceability, and no `RTI-3`+ capability is implemented here.

### RTI-3 — Requirement Quality / Testability Analysis

Introduces `analyzeRequirementQuality(artifact)` and `analyzeRequirementsQuality(artifacts)` (`scripts/ai/requirement-quality.js`), the first derived-analysis layer on top of `RequirementArtifact[]` - the eleventh and twelfth public exports. It answers exactly one question - "is this requirement sufficiently specified to be trustworthy input for test design?" - never "generate tests for this requirement" (that remains `RTI-4`+).

```javascript
const { analyzeRequirementQuality } = require("qa-ai-agent");

const result = analyzeRequirementQuality({
  id: "REQ-42", type: "non-functional-requirement", title: "Search performance",
  content: "The search results should load quickly.",
  source: { type: "file", location: "requirements.json" },
});
// result: {
//   artifactId: "REQ-42",
//   status: "AMBIGUOUS",
//   issues: [{ code: "MISSING_MEASURABLE_CRITERION", severity: "error",
//              message: "Uses a quality term ... with no measurable threshold ...", field: "content" }]
// }
```

**The central invariant**: this module may identify what is missing or ambiguous, but it never fabricates the missing requirement - given the example above, it never invents "within 2 seconds." There is no field anywhere in the output for a corrected/rewritten requirement, an invented actor, an invented error condition, or a generated test case.

**Deterministic, zero AI**: no LLM/AI calls, no network, no filesystem, no environment dependence - the same `RequirementArtifact` always produces the same result. AI-assisted semantic analysis, if ever justified, belongs to a separate future analyzer, not a retrofit onto this one.

**Status model** (one primary status + multiple issue codes, since a requirement can simultaneously be ambiguous *and* missing information): `READY` (zero blocking issues), `PARTIALLY_TESTABLE` (content is clean, only some acceptance criteria are weak), `AMBIGUOUS` (content itself uses a quantifiable-but-unstated quality term, e.g. "fast"/"available", with no signal for that same dimension anywhere in the artifact - or an inherently subjective claim like "secure"/"delightful" while acceptance criteria exist elsewhere), `MISSING_INFORMATION` (an explicit placeholder marker - TBD/TODO/TBC/??? - is present), `UNTESTABLE` (content makes an inherently subjective claim, e.g. "delightful"/"secure", with no acceptance criteria at all and no measurable signal anywhere). Precedence when multiple conditions hold: `UNTESTABLE` > `MISSING_INFORMATION` > `AMBIGUOUS` > `PARTIALLY_TESTABLE` > `READY`. `CONTRADICTORY` is deliberately **not** part of this enum - reliably detecting that two natural-language statements are mutually exclusive requires semantic reasoning this deterministic module does not have and must not fake; this is a documented limitation, not an oversight, left for a future analyzer with real evidence behind it.

**Issue vocabulary** (four codes): `PLACEHOLDER_TEXT` (error), `MISSING_MEASURABLE_CRITERION` (error - a quantifiable term is dimension-scoped, not artifact-wide topic-blind: a performance term like fast/quick/responsive is only resolved by an explicit duration/latency signal anywhere in the artifact - "Search should be fast." + "95% of searches complete within 2 seconds." produces no finding at all - and an availability term like available/reliable is only resolved by an uptime/availability-percentage or failure-rate signal. `"scalable"` is deliberately its own, never-auto-resolved category - it does not share availability/reliability's evidence, since uptime says nothing about capacity or throughput under increasing load; it remains flagged until a dedicated capacity/load rule is deliberately added. An unrelated signal from a different dimension never resolves any of these: "The page should load quickly." + "Return HTTP 200 on success." (no duration signal anywhere) still reports this issue, and a technical identifier that merely contains digits (a version tag, a cloud instance type, a build tag - e.g. "g2s.large") is never mistaken for a duration either - only explicit unit words (ms/seconds/minutes/hours, and similar) are recognized, deliberately not a bare "s". This dimension-scoping, and the exclusion of "scalable" and bare "s", were added across two RTI-3 correctives after independent and adversarial red-team review found the original artifact-wide, topic-blind check - and later an over-broad duration unit and an over-broad availability category - could each let an unrelated signal silently suppress a real finding), `UNVERIFIABLE_SUBJECTIVE_CLAIM` (error - an inherently subjective term like intuitive/delightful/user-friendly/secure; never suppressed by a measurable signal elsewhere, since no number makes "delightful" - or "secure" - objectively verifiable), `VAGUE_QUALIFIER` (warning - a weaker, context-dependent term like appropriate/reasonable/sufficient; reported but never blocks `READY`).

**Scope**: single-artifact analysis only - cross-artifact contradiction/duplicate-intent detection would require a semantic graph this module does not have and is explicitly out of scope. Only `content` and `acceptanceCriteria[].text` are analyzed (not `title`, `priority`, `labels`, `metadata`, `contentHash`, or `relationships`). `assertValidRequirementArtifact()` runs before any property of the input is read, so a hostile/malformed artifact is rejected by RTI-1 before any quality rule ever executes. `artifact.source.type` never influences the result - quality analysis is source-independent by construction. The result is shallow-frozen (the top-level object only; `issues` and its entries are not deep-frozen) - stated exactly that way from the start, applying the lesson of RTI-2's own documentation corrective rather than repeating it.

No AI, no test generation, no requirement rewriting, and no cross-artifact/traceability capability is implemented here.

### RTI-4 — Test Design Generation

Introduces `generateTestDesign(artifact)` and `generateTestDesigns(artifacts)` (`scripts/ai/test-design.js`), the first deterministic layer that converts an RTI-3 `READY` `RequirementArtifact` into generic `TestDesignArtifact[]` - the thirteenth and fourteenth public exports.

```javascript
const { generateTestDesign } = require("qa-ai-agent");

const designs = generateTestDesign({
  id: "REQ-42", type: "requirement", title: "Login",
  content: "When valid credentials are supplied, the API returns HTTP 200.",
  source: { type: "file", location: "requirements.json" },
});
// designs: [{
//   id: "REQ-42::test::1", requirementId: "REQ-42", title: "Login",
//   objective: "Verify that: When valid credentials are supplied, the API returns HTTP 200.",
//   expectedResults: ["When valid credentials are supplied, the API returns HTTP 200."],
//   source: { requirementId: "REQ-42" }
// }]
```

**The central invariant**: RTI-4 may transform requirement semantics that are explicitly present in the source - it never invents a missing timeout, HTTP status, actor, negative/boundary case, or procedural UI/API step. `generateTestDesign` returns an *array*, since one requirement legitimately produces multiple test designs when acceptance criteria are present.

**RTI-3 is the sole quality authority - a hard gate, not a suggestion**: every call runs `assertValidRequirementArtifact()` (RTI-1) then `analyzeRequirementQuality()` (RTI-3) and requires `status === "READY"`; `PARTIALLY_TESTABLE`/`AMBIGUOUS`/`MISSING_INFORMATION`/`UNTESTABLE` all refuse generation with `TEST_DESIGN_REQUIREMENT_NOT_READY`, never a partial or repaired result. RTI-4 never duplicates any RTI-3 rule vocabulary (no local copy of vague-term/placeholder/measurability logic).

**Generation model**: one `TestDesignArtifact` per `acceptanceCriteria[]` entry (in array order) when criteria exist; exactly one, derived directly from `content`, when they do not. Deterministic id: `` `${requirementId}::test::${ordinal}` `` (1-based position - never `Math.random()`/a UUID/`Date.now()`). Every design carries `requirementId` and, when generated from a criterion, either its `criterionId` (when the source criterion had one) or a positional `criterionIndex` fallback - never a fabricated id - so a future RTI-5 can compute criterion coverage without parsing generated text. Two acceptance criteria sharing the same id within one artifact fail generation closed (`TEST_DESIGN_GENERATION_FAILED`) rather than emit ambiguous provenance.

**Deliberately excluded from this MVP contract** (not present-but-empty - genuinely absent, since `RequirementArtifact` has no legitimate source data for them): `steps`/`preconditions` (no structured procedural field exists in RTI-1 to extract them from - inventing steps would violate the central invariant), `testType`, translated `priority`/`labels`, and any automatically-generated negative-path, boundary-value, or equivalence-partition test. `artifact.source.type` is never read - generation is identical regardless of requirement origin. No framework coupling (no Playwright/Cypress/automation code) and no test-management-destination coupling (no TestRail/Xray/Zephyr/Azure DevOps field names) - both remain out of scope for future RTI-8. No `assertValidTestDesignArtifact` validator is exported in this MVP - unlike `RequirementArtifact`, a `TestDesignArtifact` is only ever produced in-process by this module itself, and no external untrusted-input consumer existed when RTI-4 shipped to justify one; deferred until a real caller proves the actual shape needed, matching RTI-1's own precedent for its deferred collection validator. RTI-5 (below) is that first real caller, and re-affirms the same deferral rather than introducing the validator.

### RTI-5 — Requirement ↔ Test Traceability / Coverage

Introduces `buildRequirementTraceability(requirements, testDesigns)` and `analyzeRequirementsCoverage(requirements, testDesigns)` (`scripts/ai/requirement-traceability.js`), the first structural mapping/aggregation layer between RTI-1 `RequirementArtifact[]` and RTI-4 `TestDesignArtifact[]` - the fifteenth and sixteenth public exports.

```javascript
const { generateTestDesigns, analyzeRequirementsCoverage } = require("qa-ai-agent");

const requirement = {
  id: "REQ-42", type: "requirement", title: "Login",
  content: "The system enforces access control.",
  acceptanceCriteria: [
    { id: "AC-1", text: "When valid credentials are supplied, the API returns HTTP 200." },
    { id: "AC-2", text: "When invalid credentials are supplied, the API returns HTTP 401." },
  ],
  source: { type: "file", location: "requirements.json" },
};
const testDesigns = generateTestDesigns([requirement]);
const [coverage] = analyzeRequirementsCoverage([requirement], testDesigns);
// coverage.status: "FULLY_COVERED", coverage.totalCriteria: 2, coverage.coveredCriteria: 2
```

**Ownership boundary**: RTI-5 owns structural traceability/coverage only. It never calls `analyzeRequirementQuality`/`analyzeRequirementsQuality` (RTI-3) and never calls `generateTestDesign`/`generateTestDesigns` (RTI-4) - coverage means "is this criterion structurally referenced by a test design?", never a semantic-quality or generation concern. A structurally valid `RequirementArtifact` is analyzed regardless of its RTI-3 status; **coverage != quality**.

**Two-stage, traceability-first architecture**: `buildRequirementTraceability()` produces `TraceabilityLink[]` (`{ requirementId, criterionId?, criterionIndex?, testDesignId }`) as the one canonical mapping; `analyzeRequirementsCoverage()` derives its aggregate `RequirementCoverageResult[]` from those same links - never a second, independently-maintained mapping that could drift.

**Identity/snapshot model** (no new identity layer invented): requirement identity is `RequirementArtifact.id`; criterion identity is `acceptanceCriteria[].id` when supplied, or `criterionIndex` as a **snapshot-scoped-only** positional fallback; test-design identity is `TestDesignArtifact.id`. A persistent, cross-revision test identity is deliberately **not defined** - every result is valid only for the exact `RequirementArtifact[]`/`TestDesignArtifact[]` pair supplied in that one call; if acceptance criteria are later inserted, removed, or reordered, `criterionIndex`-based coverage must be recomputed from the new snapshot, never migrated or reused.

**No text parsing, ever**: traceability is derived exclusively from `requirementId`/`source.requirementId`/`source.criterionId`/`source.criterionIndex`. A misleading test id (e.g. `"REQ-WRONG::test::999"`), a misleading `title`, or a misleading `objective` has zero effect on the computed result.

**Coverage status model** - exactly three statuses, `FULLY_COVERED`/`PARTIALLY_COVERED`/`UNCOVERED` (a fourth, `NOT_APPLICABLE`, was considered and rejected: a zero-criteria requirement's coverage is a genuinely evaluable binary fact via the separate `requirementLevelCovered` field, not an inapplicable one - `totalCriteria`/`coveredCriteria`/`uncoveredCriteria` stay `0` in that branch and carry no pass/fail meaning by themselves, deliberately avoiding a "0/0 = fully covered" bug). A test design that references a requirement with acceptance criteria but supplies neither `criterionId` nor `criterionIndex` counts toward **no** criterion's coverage - fabricating which criterion it validates would repeat the same no-hallucination violation RTI-3/RTI-4 already forbid - and is instead surfaced in that requirement's `unmappedTestDesignIds`, so it is never silently dropped.

**Referential-integrity / duplicate policy - fail closed, atomic, never a partial result**: the whole call rejects (`TRACEABILITY_INCONSISTENT_REFERENCE`/`TRACEABILITY_COLLECTION_INVALID`/`TRACEABILITY_INPUT_INVALID`) on an unknown requirement/criterion reference, a `requirementId`/`source.requirementId` mismatch, an out-of-range `criterionIndex`, a criterion reference on a zero-criteria requirement, `criterionId` and `criterionIndex` both present, or any duplicate requirement/criterion/test-design id - never a silent skip or best-effort partial output.

**Trust boundary - validator deferred, re-affirmed from RTI-4**: no exported `assertValidTestDesignArtifact` is introduced here either - no storage/network/external-import path for `TestDesignArtifact` exists yet, so RTI-5 (its first real in-process consumer) performs only narrow, purpose-built field-level checks on exactly the fields it reads, not a general-purpose schema authority. This must be revisited (and a general validator introduced, owned by RTI-4's own module) the moment `TestDesignArtifact` crosses an actual storage/network/external-import boundary - a future RTI-6/RTI-7 external test import, or an RTI-8 stored/serialized round-trip.

**Deliberately excluded**: any adequacy/sufficiency judgment (structural reference only, never "correctly tested"), a coverage percentage (counts + status only - consumers can compute a ratio if needed), a distinction between RTI-4-generated and future externally-imported test designs (the contract is provenance-agnostic by construction), and any revision/history model (out of scope until a real revision-tracking need exists).

### RTI-6 — External Requirements Source Provider Contract

Introduces `loadRequirementsFromProvider(provider)` (`scripts/ai/requirements-source-provider.js`), the generic, explicit boundary through which an arbitrary caller-supplied provider normalizes external data into validated RTI-1 `RequirementArtifact[]` - the seventeenth public export.

```javascript
const { loadRequirementsFromProvider } = require("qa-ai-agent");

const provider = {
  id: "company-tracker-prod",
  async read() {
    return [{
      id: "tracker:company-tracker-prod:PROJ-123",
      type: "requirement", title: "Login",
      content: "The system enforces access control.",
      source: { type: "issue-tracker", sourceId: "PROJ-123", system: "company-tracker-prod" },
    }];
  },
};
const requirements = await loadRequirementsFromProvider(provider);
```

**Provider contract**: `{ readonly id: string; read(): Promise<RequirementArtifact[]> | RequirementArtifact[] }`. `read()` takes no arguments - provider-specific query/filter/pagination configuration belongs entirely to provider construction, never a generic public query object, so the generic interface stays small, stable, and free of vendor query leakage. Called as `provider.read()` (never destructured) so `this` binding is preserved for class-instance providers; a getter-backed `id` is fully supported.

**`provider.id` vs `artifact.source.type` - deliberately independent, no forced equality**: `provider.id` identifies the provider *instance*/adapter configuration a caller constructed (diagnostic identity); `RequirementArtifact.source.type` (RTI-1's own field) identifies the source *family*. A single provider could legitimately normalize data drawn from more than one underlying source kind, so this module never asserts they match.

**Two distinct trust boundaries - the central architectural property of this module**: the provider *implementation* is trusted, caller-supplied executable code (ordinary property access is used to read `provider.id`/`provider.read` - deliberately not RTI-1's own-enumerable-data-property-only hardening, since a legitimate class provider's `id` may be a prototype getter). The provider's *returned data*, however, is untrusted: every returned artifact goes through RTI-1's existing hostile-getter-safe `assertValidRequirementArtifact`, unchanged.

**The core architectural principle, preserved from design through implementation**: this module never branches on a provider or source-family identity string - no vendor-name conditional anywhere in this file, no provider registry, no factory, no autodiscovery. A concrete adapter for any specific external issue tracker, requirements tool, or test-management system is simply any object satisfying the interface above; that is Roadmap RTI-7's job, not implemented here.

**Identity is provider-owned - `RequirementArtifact.id` is never generated, rewritten, or repaired here**: a `RequirementsSourceProvider` implementation must produce `id` values that are stable and collision-safe within any snapshot the caller intends to compose; when a source system's native ids are only locally unique, a well-behaved provider should use a provider-qualified id (an exact format this module never imposes). Native identity should be preserved separately via `source.sourceId` when available - never conflated with the normalized `id`. This module verifies only what it can: no duplicate `id` (or duplicate `acceptanceCriteria[].id` within one artifact) within one `read()` call's own returned collection - the same duplicate policy RTI-2/RTI-5 already apply, atomic and fail-closed. Cross-provider global uniqueness (for a caller who manually composes multiple providers' output) remains a documented provider obligation, backstopped downstream by RTI-5's own existing duplicate-id rejection - zero RTI-5 change required.

**Empty result is valid**: unlike RTI-5's own `requirements[]` input, a provider `read()` is a *query* - zero matching external requirements is legitimate information, not an error; `read()` resolving to `[]` returns a fresh, frozen empty array.

**Copy/freeze semantics, precisely**: the returned collection array is fresh and frozen, distinct from whatever array the provider itself returned; the individual `RequirementArtifact` objects inside it are the *same references* the provider returned - not deep-copied, not re-frozen beyond whatever RTI-1/the provider already established. This is not a deep-immutability guarantee.

**Error model** (five codes): `REQUIREMENTS_SOURCE_PROVIDER_REQUIRED`, `REQUIREMENTS_SOURCE_PROVIDER_INVALID`, `REQUIREMENTS_SOURCE_READ_FAILED` (wraps a throwing/rejecting `read()` via the native `{ cause }` mechanism - the original thrown value's own message/content is *never* concatenated into the outward `.message`), `REQUIREMENTS_SOURCE_OUTPUT_INVALID` (non-array output, or any structurally invalid returned artifact - the whole load rejects atomically, never a partial result), `REQUIREMENTS_SOURCE_COLLECTION_INVALID` (duplicate ids).

**`.cause` is unsanitized and potentially sensitive - read this before logging a `REQUIREMENTS_SOURCE_READ_FAILED`**: the outer `.message` is bounded and safe for routine logging, but `.cause` preserves the provider's original thrown value (an `Error`, a plain object, a string - whatever `read()` actually threw or rejected with) completely unchanged, for diagnostic fidelity. `.cause` may therefore contain credentials, access tokens, authorization headers, signed URLs, query-string secrets, cookies, provider configuration detail, PII, or raw transport payload content. Do **not** blindly `console.error(error)` or serialize the full error object in a security-sensitive environment - Node prints the entire `.cause` chain by default, which would surface whatever the provider's own failure carried. Prefer bounded fields for routine logging (`error.code`, `error.message`); treat `error.cause` as a trusted-only diagnostic channel that must be redacted or omitted before it reaches logs, telemetry, or any environment outside the caller's own direct control. This applies with equal force regardless of whether the provider threw an `Error` instance or any other value - `.cause` is never assumed to be an `Error`.

**No vendor adapters exist yet in RTI-6 itself**: this module defines the generic provider contract only. Concrete adapters for specific external systems are Roadmap RTI-7's job - see the Jira adapter immediately below, the first one implemented.

### RTI-7B — Jira Reference Requirements Provider

Introduces `JiraRequirementsProvider` (`scripts/ai/providers/jira-requirements-provider.js`), the first concrete `RequirementsSourceProvider` and RTI-7's reference implementation - a real, network-capable adapter for the Jira Cloud REST API v3. Exported only via a public subpath, never the root barrel:

**Corrective C1**: the original implementation targeted `GET /rest/api/3/search`, which Atlassian removed in August 2025. This was discovered and closed before merge - no version of this adapter ever shipped against the removed endpoint. The adapter now targets the current `POST /rest/api/3/search/jql` endpoint exclusively (JQL travels in the JSON request body, never the URL - the query can itself carry sensitive internal project detail, and a body keeps it out of server access logs / browser history / proxy URLs the way a query string would not). C1 also closed two independently discovered robustness gaps, described inline below: a silent-snapshot-truncation risk, and an unbounded ADF-recursion risk.

```javascript
const { loadRequirementsFromProvider } = require("qa-ai-agent");
const { JiraRequirementsProvider } = require("qa-ai-agent/providers/jira");

const provider = new JiraRequirementsProvider({
  id: "company-jira-prod",                    // becomes provider.id - diagnostic identity, independent of source.type
  baseUrl: "https://company.atlassian.net",    // explicit, caller-supplied, HTTPS-only authority - never discovered
  email: "bot@company.com",
  apiToken: process.env.JIRA_API_TOKEN,        // caller/environment-owned - this module never reads process.env itself
  jql: "project = PROJ AND type = Story ORDER BY key ASC",
  fieldMap: { acceptanceCriteria: "customfield_12345" }, // optional - see "Acceptance criteria" below
  maxItems: 1000,                              // optional, default 1000 - mandatory safety bound, not a soft suggestion
  timeoutMs: 10000,                            // optional, default 10000
});

const requirements = await loadRequirementsFromProvider(provider);
```

**Corrective (RTI-7I-A, Jira/Azure provider parity hardening)**: the cross-adapter architecture review that followed the Azure DevOps adapter's own hardening found two narrow gaps unique to this adapter, both closed: unknown top-level configuration keys (only `id`/`baseUrl`/`email`/`apiToken`/`jql`/`fieldMap`/`maxItems`/`timeoutMs` are recognized) are now rejected at construction, matching Azure's already-hardened behavior; and the native issue-type lookup now uses an own-property-safe guard, closing the same `Object.prototype`-leak class of defect independently discovered and fixed in the Azure adapter (a malformed/hostile issue-type value of literally `"__proto__"` can no longer produce anything but the documented `"other"` fallback).

**Identity**: `RequirementArtifact.id` is `"<provider.id>:<issue key>"` (e.g. `"company-jira-prod:PROJ-123"`) - provider-qualified even though a bare Jira issue key is already unique within one site, so the convention stays safely composable the moment a caller combines two different Jira sites' output. Native identity is preserved separately and exactly in `source.sourceId` (the bare issue key). Changing `provider.id` intentionally changes the normalized id prefix - two provider instances configured with different ids reading the same native key produce two distinct, collision-safe ids, by design. **The normalized id is opaque** - `provider.id` itself may contain `:`, so the id must never be parsed/split by callers to recover its parts; treat it as an opaque key, exactly like the `nextPageToken` below. The Jira issue key is validated as a non-empty, bounded, control-character-free string before use; when building `source.location`, the key is percent-encoded (`encodeURIComponent`) so a key containing `/`, `?`, or other URL-structural characters can never alter the resulting URL's origin, path segmentation, or query string.

**Acceptance criteria - only from explicit configuration, never heuristic**: `acceptanceCriteria` is populated only when `fieldMap.acceptanceCriteria` names a Jira field (a custom field id, or `description`) whose value is a plain string or an Atlassian Document Format object - never by scanning description text for something that looks like a criteria list. A configured field that is absent/null yields no acceptance criteria (not an error); a present-but-unrecognized-shape value fails closed. Criterion ids are never fabricated - RTI-4/RTI-5's existing `criterionIndex` snapshot fallback covers this downstream, as designed.

**Content**: deterministic Atlassian Document Format → plain-text conversion only - never raw ADF/HTML, never AI-rewritten. An issue with no description (and no populated acceptance criteria) has no `content` field at all (genuinely absent, not an invalid empty string) and correctly fails RTI-1 validation for having no requirement body - `title` alone is never treated as sufficient. `hardBreak` nodes are handled explicitly and contribute a line boundary (`"\n"`) - they are never silently dropped, which would otherwise concatenate two visually distinct lines into one run-on line.

**ADF traversal is depth-bounded (Corrective C1)**: description/acceptance-criteria ADF documents are walked recursively with an explicit, enforced maximum nesting depth (`MAX_ADF_DEPTH = 64`). A remote document nested deeper than this bound fails the read closed with a clean, descriptive error - never an uncaught `RangeError` from exhausting the call stack. This was an independently discovered gap (a real, syntactically valid but pathologically nested remote description could crash the walker) and is now covered by round-trip tests that construct the oversized document at the true HTTP/JSON boundary, not merely in-memory.

**Pagination (Corrective C1) - opaque token, sequential only**: the enhanced search endpoint replaces the old `startAt`/`total` model with an opaque `nextPageToken`. This adapter never parses, decodes, modifies, or derives meaning from the token - it is passed back to Jira exactly as received and otherwise treated as a black box. Pages are fetched strictly sequentially (one in flight at a time). Two fail-closed guards protect this loop: (1) **progress guard** - every token seen so far is tracked in a set, not just the immediately previous one, so both an immediate repeat and a longer cycle (e.g. token A → B → A) are detected and fail the read, rather than looping forever; (2) **snapshot-completeness guard** - a page that reports zero issues yet still carries a `nextPageToken` is treated as an inconsistent remote response and fails the whole read closed, rather than being silently interpreted as "done." A terminal page (no `nextPageToken`) is the only valid way a read completes, whether or not that final page carries issues.

**`maxItems` is a cumulative, fail-closed bound, not a per-page or total-derived one (Corrective C1)**: since the enhanced API exposes no authoritative result-set `total` up front, `maxItems` is checked cumulatively after each page is fetched - if the running item count would exceed the configured bound, the entire read fails closed with no partial/truncated result ever returned to the caller. For example, with `maxItems=75`, a first page of 50 items (with more pages remaining) followed by a second page of 30 items fails the whole read - it never silently returns the first 75.

**Snapshot-completeness guarantee**: across all of the above, this adapter never returns a silently truncated or partial snapshot. Any pagination inconsistency (an anomalous empty-but-not-terminal page, a repeated or cyclic token, a exceeded `maxItems` bound, or a mid-pagination request failure) fails the entire `read()` call - callers either get a complete, consistent snapshot or an error, never something silently incomplete in between.

**Network / security policy**: `baseUrl` must be an absolute `https:` URL with no embedded credentials or query/fragment - explicit trusted configuration, never discovered from environment/cwd/`source.location`. Every request sets `redirect: "manual"` (any 3xx response is a hard failure - redirects are never followed); no TLS bypass of any kind; every request is bounded via `AbortSignal.timeout`; retries are bounded (3 total attempts - 1 initial + 2 retries), apply only to `429` (honoring a numeric-seconds `Retry-After`, capped) and transient `5xx`/network errors, and never to `401`/`403`/`400`/`404`/`422` or a malformed-payload failure. Output order is always canonical Jira-key order (sorted by this module after collecting all pages), independent of the caller's own JQL - this matters because RTI-4's positional `::test::<ordinal>` ids depend on stable snapshot order.

**Error / secret safety - extends RTI-6's Corrective C1 one layer deeper**: this adapter's own thrown errors never include the configured `apiToken`, the constructed Authorization header, a raw HTTP response body, or the configured `jql` (which may itself carry sensitive internal project/field detail) - this holds whether `jql` travels in a URL or, as of this adapter's own Corrective C1, a POST JSON body. Because whatever this module throws becomes RTI-6's `.cause` - an intentionally unsanitized diagnostic channel, per C1 - this module must not put secrets into it in the first place.

**Testing**: fully offline - a local mock HTTP server plus sanitized fixtures exercise the real transport/pagination/retry/error-handling code paths with no live network dependency and no required-PR-CI dependency on Jira's own availability. **Live Jira proof: DEFERRED** (no sandbox credentials were available during this implementation) - offline correctness is not blocked on it.

**Deliberately out of scope for this adapter**: Xray, TestRail (not yet planned); a shared/generic transport abstraction with the Azure DevOps adapter (RTI-7G's cross-adapter architecture review concluded this is *not currently justified* - see [PROVIDERS.md](PROVIDERS.md#shared-production-code-decisions) for the full evidence and decision table); a provider registry or UI discoverability metadata.

### RTI-7F — Azure DevOps Requirements Provider

Introduces `AzureDevOpsRequirementsProvider` (`scripts/ai/providers/azure-devops-requirements-provider.js`), the second concrete `RequirementsSourceProvider` and RTI-7's proof that the `{id, read()}` abstraction generalizes to a materially different vendor shape than Jira - WIQL instead of JQL, a two-stage query-then-batch retrieval model instead of token pagination, numeric work-item ids instead of string keys, HTML instead of ADF, and Azure's own rate-limit semantics. Exported only via a public subpath, never the root barrel. **Scope: Azure DevOps Services only** - Azure DevOps Server/TFS (arbitrary on-prem collection URLs) is explicitly out of scope; the network authority (`https://dev.azure.com/<organization>/<project>`) is always constructed internally from validated `organization`/`project` strings, never accepted as an arbitrary `baseUrl`.

```javascript
const { loadRequirementsFromProvider } = require("qa-ai-agent");
const { AzureDevOpsRequirementsProvider } = require("qa-ai-agent/providers/azure-devops");

const provider = new AzureDevOpsRequirementsProvider({
  id: "azure-prod",                              // becomes provider.id - diagnostic identity, independent of source.type
  organization: "contoso",                        // explicit, validated, percent-encoded into the URL
  project: "MyProject",                            // may contain display-name characters (spaces etc.)
  wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug'",  // FLAT queries only - see WIQL below
  auth: { type: "pat", token: process.env.AZURE_DEVOPS_PAT },   // or { type: "bearer", token: <Entra access token> }
  fieldMap: { acceptanceCriteria: "Custom.AC" },   // optional - overrides/disables the default AC field, see below
  typeMap: { Feature: "requirement" },             // optional - merges over the built-in default type map
  maxItems: 1000,                                  // optional, default 1000, hard-capped at 20000 (see below)
  timeoutMs: 10000,                                // optional, default 10000
});

const requirements = await loadRequirementsFromProvider(provider);
```

**Auth - explicit union, no acquisition/refresh in this module**: `{ type: "pat", token }` (`Authorization: Basic base64(":"+token)`, Azure's documented PAT convention) or `{ type: "bearer", token }` (`Authorization: Bearer <token>`, compatible with a caller-acquired Microsoft Entra ID access token - the current Microsoft-recommended production auth path). This module never acquires, refreshes, or validates a token - no MSAL, no OAuth flow, no env-var discovery; a 401 mid-read fails immediately with no hidden retry. Minimum required scope: `vso.work` (read-only).

**WIQL - flat queries only**: `wiql` is caller-owned configuration, exactly parallel to Jira's `jql`. After the WIQL response returns, this module validates `queryType === "flat"` and `queryResultType === "workItem"` - a query that resolves to `tree` or `oneHop` (a different response shape entirely) fails closed with an explicit "unsupported query type" error, detected from Azure's own response, never guessed from WIQL syntax.

**Snapshot completeness - a different vendor failure mode than Jira's**: Azure's WIQL endpoint has no pagination and no completeness signal in its response at all. Worse, Microsoft's own documented object limits state that WIQL results are **hard-capped at 20,000 items and silently truncated with no error shown** when exceeded. This module therefore never uses `$top` to approximate `maxItems` (that would hide whether more results existed). Instead, the full WIQL result is validated locally before any batch call: a result of **20,000 or more items fails closed** regardless of `maxItems` (completeness cannot be verified beyond Azure's own opaque cap - even a genuine exactly-20,000-item snapshot is treated as suspect, deliberately preferring a false rejection over a silently-truncated success), and a result exceeding the configured `maxItems` fails closed with no batch retrieval attempted at all. Duplicate work-item ids within one WIQL result are themselves treated as an inconsistent vendor response and fail closed before any batch call. **Note**: because of this 20,000-item guard, `maxItems` is accepted up to 20000 by config validation but can never actually succeed at that exact value - the practical maximum size of a successful snapshot is 19,999 items.

**Batch retrieval - two-stage, sequential, atomic**: WIQL returns only work-item id references; full work items are fetched via Azure's `workitemsbatch` endpoint (vendor maximum 200 ids per request), sequentially, with `errorPolicy: "Fail"` set explicitly. This module does not trust that alone - after every batch response, the returned id set is independently reconciled against the requested id set; any missing id, extra id, or duplicate fails the whole read closed. `$expand: "Relations"` is requested on the same batch call, so relations are never fetched via a separate N+1 request. Any failed batch rejects the whole read - no partial result is ever returned. Output order is always canonical numeric work-item-id ascending, computed by this module after collecting all batches (batch-response order is not a documented Azure guarantee).

**Identity**: `RequirementArtifact.id` is `"<provider.id>:<workItem.id>"` (e.g. `"azure-prod:12345"`), opaque, never parsed - same convention as Jira. `source.sourceId` is the exact native numeric id as a string; `source.version` is `String(workItem.rev)` (Azure's own monotonic revision counter, preferred over any timestamp field); `source.location` is `https://dev.azure.com/<org>/<project>/_workitems/edit/<id>/` (organization/project percent-encoded, provenance only, never retrieval authority). Work-item ids are unique per Azure DevOps organization (not merely per-project), but the provider-qualified identity convention is used uniformly across every RTI-7 adapter regardless.

**Content - deterministic HTML → plain text, resource-bounded from day one**: `System.Description` (Azure's rich-text HTML field, this adapter's structural equivalent of Jira's ADF) is converted via a narrow, zero-dependency, single-pass iterative tokenizer (never a DOM library, never regex-only stripping) - block tags (`p`/`div`/headings/`blockquote`/`pre`/lists/`table`) produce blank-line boundaries, `<li>` and `<br>` produce single-line boundaries, `<script>`/`<style>` content is discarded entirely, a fixed set of HTML entities is decoded exactly once (unrecognized entities are left as literal text, never dropped). Unlike Jira (where the equivalent ADF-depth bound was only added reactively via a post-review corrective), this module bounds both the raw input length (`MAX_HTML_INPUT_LENGTH`) and the open-tag nesting depth (`MAX_HTML_NESTING_DEPTH = 64`) from its first implementation - a malformed or pathologically deep description fails cleanly, never with an uncaught `RangeError`. An empty/absent description yields no `content` field at all.

**Acceptance criteria - default standard field, with explicit override**: unlike Jira (no standard AC field, fully-explicit-only), Azure DevOps defines a standard reference field (`Microsoft.VSTS.Common.AcceptanceCriteria`, confirmed present on Bug/Epic/Feature/Product Backlog Item (Scrum), not confirmed universal across every process template). This module defaults to that field when present; `fieldMap.acceptanceCriteria` overrides it to a different field name, or `null` disables AC extraction entirely. Absence is "no acceptance criteria," never an error. One field value normalizes into exactly one criterion with `text` only - no fabricated `id`.

**Type mapping - built-in default, caller-extensible**: Azure's process-template variability (Agile/Scrum/CMMI/Basic/custom-inherited processes can name the same semantic work-item type differently) makes a single hardcoded table riskier than Jira's own acknowledged limitation. A small conservative built-in map (`User Story`/`Product Backlog Item` → `user-story`, `Bug` → `bug`, `Requirement` → `requirement`) is merged with an optional caller-supplied `typeMap` (every target value validated against RTI-1's fixed vocabulary at construction). Unmapped native types → `"other"`.

**Relationships - narrow, verified reference names only**: only `System.LinkTypes.Hierarchy-Reverse` → `parent` and `System.LinkTypes.Related` → `related` are mapped in this MVP. The forward/Child hierarchy direction is deliberately not mapped (RTI-1 has no `child` relationship type), and both `Dependency` directions plus any custom/remote link type are omitted, never guessed - a documented MVP limitation. `targetId` is normalized the same way as the primary identity, extracted from the relation's own `url` (validated as a positive safe integer).

**Rate-limit semantics - deliberately not copied from Jira**: a `429` is retried (bounded, honoring `Retry-After`), same spirit as Jira. But Azure also documents a distinct signal: a **successful `200` response can itself carry a `Retry-After` header**, meaning "this succeeded, but slow down before your next request." That response is accepted and processed normally - never retried - and the delay is honored only before this module's next outbound request (if any), via per-`read()`-call state, never a module-level global. `X-RateLimit-*` headers are deliberately ignored in this MVP (informational only). **Corrective C1**: `Retry-After` is honored up to `MAX_RATE_LIMIT_WAIT_MS = 35000` (35 seconds) - deliberately set above Azure's own documented normal throttling ceiling ("delays range from a few milliseconds ... up to 30 seconds"), so a legitimate value within that documented range is honored in full rather than truncated. Only a value beyond that 35-second ceiling (hours, `Infinity`, a malformed/hostile value) is capped, not honored verbatim; the original implementation capped at 5 seconds, which independent review correctly identified as sitting well within Azure's own normal operating range rather than only guarding against pathological values.

**Network / security policy**: no arbitrary `baseUrl`; every request sets `redirect: "manual"` (any 3xx is a hard failure); no TLS bypass; every request is bounded via `AbortSignal.timeout`; retries are bounded (3 total attempts), apply only to `429`/transient `5xx`/network errors, never to `401`/`403`/`400`/`404`/`422` or a malformed-payload failure.

**Error / secret safety**: this adapter's own thrown errors never include the configured PAT/Bearer token, the constructed Authorization header, a raw HTTP response body, or the configured `wiql` (which may itself carry sensitive internal project/field detail) - same discipline as Jira's RTI-6-C1-extended model.

**Testing**: fully offline - a local mock HTTP server plus a fetch-proxy exercise the real transport/WIQL-then-batch/retry/rate-limit/HTML-normalization code paths, including real-HTTP-round-trip proofs of the exact HTML nesting-depth boundary (64 succeeds, 65 fails cleanly) and the 20,000-item vendor-cap guard. **Live Azure proof: DEFERRED** (no sandbox credentials were available during this implementation) - offline correctness is not blocked on it.

**Deliberately out of scope for this adapter**: Azure DevOps Server/TFS; tree/oneHop WIQL queries; any relation type beyond the two mapped above; a shared/generic transport abstraction with Jira (RTI-7G's cross-adapter architecture review concluded this is *not currently justified* - see [PROVIDERS.md](PROVIDERS.md#shared-production-code-decisions) for the full evidence and decision table); a provider registry.

### RTI-8 — Test Case Publishing / Destinations

RTI-8 is the write-side counterpart to RTI-6/RTI-7: a generic
`TestDesignDestination` contract that publishes RTI-4's canonical
`TestDesignArtifact[]` to an external test-management/tracking system,
proved against one real concrete destination and against a genuine
cross-vendor flow. Full durable record, contract (`MUST`/`SHOULD`/`MAY`),
and carried debt: [PUBLISHING.md](PUBLISHING.md).

**Source/destination separation, stated explicitly**: `RequirementsSourceProvider`
(RTI-6) and `TestDesignDestination` (RTI-8A/8B) are independent contracts,
with independent identity (`provider.id` and `destination.id` are never
compared or assumed related), independent credentials, and independent
error domains. A Jira source does not imply a Jira destination; an Azure
source does not imply an Azure destination - `RTI-8J` (below) is the
architectural proof that a Jira-sourced pipeline reaches an Azure-shaped
destination with zero bridging code.

#### RTI-8B — Generic Publishing Core

Introduces `assertValidTestDesignArtifact(artifact, callerLabel)`
(`scripts/ai/test-design.js`) and `publishTestDesigns(destination, request)`
(`scripts/ai/test-design-publishing.js`) - the eighteenth and nineteenth
public exports. `publishTestDesigns` is the vendor-neutral boundary through
which a caller-supplied `TestDesignArtifact[]` is handed to an explicitly
caller-supplied `TestDesignDestination`:

```js
const qa = require("qa-ai-agent");

// requirements -> quality -> READY filter -> generation, all RTI-1..RTI-4
const testDesigns = qa.generateTestDesigns(readyRequirements);

const result = await qa.publishTestDesigns(destination, { testDesigns });
// result.destinationId, result.allSucceeded, result.items[] (CREATED | FAILED)
```

**Pre-side-effect validation is the one hard guarantee this module makes**:
destination shape, request shape, a `500`-item batch-size bound, every
`TestDesignArtifact` (via `assertValidTestDesignArtifact`), and duplicate-id
rejection all complete - with zero calls to `destination.publish()` - before
that call happens at all. Once `publish()` is actually invoked, no further
atomicity promise is made; an external SaaS write is not generally
transactional and this module has no way to undo a side effect that already
occurred. `CREATE_ONLY` (RTI-8A's own decision): the only two possible item
statuses are `CREATED` and `FAILED` - no `UPDATED`/`SKIPPED`/upsert
semantics exist, since `criterionIndex`'s snapshot-scoped identity gives no
stable way to recognize "the same logical test as last time."

Independently reviewed (`RTI-8C`): found one MEDIUM (a caller-supplied,
unfrozen `TestDesignArtifact`'s nested `source`/`expectedResults` could be
mutated by destination code - top-level freeze alone was insufficient),
closed by a narrow corrective (`RTI-8B-C1`: every `TestDesignArtifact` now
receives a fresh, deeply-frozen canonical copy via own-enumerable-data-property
reads before the destination ever sees it), independently re-reviewed and
approved, merged to `main` (PR #144).

#### RTI-8F — Azure DevOps Test Case Destination

Introduces `AzureDevOpsTestCaseDestination`
(`scripts/ai/destinations/azure-devops-test-case-destination.js`), the first
concrete `TestDesignDestination`, exported only via a public subpath:

```js
const { AzureDevOpsTestCaseDestination } = require("qa-ai-agent/destinations/azure-devops");

const destination = new AzureDevOpsTestCaseDestination({
  id: "azure-tests-prod",
  organization: "contoso",
  project: "MyProject",
  auth: { type: "pat", token: process.env.AZURE_DEVOPS_PAT },
  // timeoutMs is optional, default 15000, bounds [1000, 120000]
});
```

`CREATE_ONLY`, sequential, never-retried `POST` to Azure's documented Work
Item Create REST API against a fixed `https://dev.azure.com` authority
(constructed only from validated `organization`/`project` - no caller
`baseUrl`, no Azure DevOps Server/TFS support). Because Test Case creation
is `CREATE_ONLY` and non-idempotent, repeating the same publish operation or
re-running the pipeline may create duplicate remote Azure Test Cases. Maps
exactly
`TestDesignArtifact.title → System.Title` and `objective`/`expectedResults →
System.Description` (HTML-escaped) - no custom fields, and
`Microsoft.VSTS.TCM.Steps` is deliberately never populated (no grounded
action/step model exists in the canonical artifact; populating it would mean
fabricating content, which RTI-3/RTI-4 already forbid upstream). Global
short-circuit (401/403/404-target/429/redirect/ambiguous 5xx-or-transport)
vs. per-item continuation (400/409) is classified per Azure's own documented
semantics; `requirementId`/`source.requirementId`/`criterionId`/`criterionIndex`
are treated as fully opaque, never parsed or used to build an Azure
relation - this is what keeps the destination safe for a non-Azure source
(see `RTI-8J` below). Credentials live in a true private `#config` class
field - ten independent introspection vectors (`JSON.stringify`,
`Object.keys`/`values`/`entries`/`getOwnPropertyNames`/`getOwnPropertyDescriptors`,
spread, `Object.assign`, `util.inspect` with hidden properties shown) were
each independently confirmed to leak zero token bytes.

Independently reviewed (`RTI-8G`): **approved**, zero BLOCKER/MEDIUM, two
LOW/INFO findings carried as debt (see [PUBLISHING.md](PUBLISHING.md#carry-forward-debt)).
Merged to `main` (PR #146, via `RTI-8I`'s merge/post-merge proof; `RTI-8H`
was skipped since no corrective was needed).

#### RTI-8J — Cross-Vendor Integrated Proof

```text
VENDOR INDEPENDENCE:
PROVEN
```

A real `JiraRequirementsProvider` ingested a realistic native Jira payload;
the resulting `RequirementArtifact[]` passed through the real,
unmodified `analyzeRequirementsQuality`, `generateTestDesigns`, and
`publishTestDesigns`; a real `AzureDevOpsTestCaseDestination` (distinct
`destination.id`, distinct credentials from the Jira side) received the
result. The Jira-origin `requirementId` was confirmed absent from every
Azure request body; planted HTML-significant content from the real Jira
payload survived, correctly escaped, into the final Azure description;
a static audit of the entire generic core found zero "jira"/"azure"
occurrences; a fresh `npm pack`/`npm install` external-consumer proof,
using only public subpaths, reproduced the identical flow. Full evidence
chain: [PUBLISHING.md](PUBLISHING.md#cross-vendor-proof).

**This is a proof about one real cross-vendor pair, not a universal-adapter
claim** - it establishes that the architecture imposes no vendor-pairing
coupling, which is what any future additional source or destination adapter
depends on.

## Project structure

    ./cypress/e2e/tests/select_group_POI.cy.js
    ./cypress/e2e/tests/category_tree_behavior.cy.js
    ./cypress/e2e/tests/poi_data_requests.cy.js

    ./cypress/e2e/pageObjects/categories.js
    ./cypress/e2e/pageObjects/map.js
    ./cypress/e2e/pageObjects/navigation.js
    ./cypress/e2e/pageObjects/subCategories.js

    ./playwright/tests/smoke.spec.js
    ./playwright.config.js

    ./scripts/ai/agent-policy.js
    ./scripts/ai/aggregate-browser-context.js
    ./scripts/ai/analyze-failure.js
    ./scripts/ai/collect-context.js
    ./scripts/ai/collect-history.js
    ./scripts/ai/config.js
    ./scripts/ai/context-utils.js
    ./scripts/ai/correlation-projection.js
    ./scripts/ai/format-pr-comment.js
    ./scripts/ai/normalized-failure.js
    ./scripts/ai/pr-comment-client.js
    ./scripts/ai/project-profile.js
    ./scripts/ai/qa-agent-prompt.js
    ./scripts/ai/runtime-framework-selector.js

    ./scripts/ai/adapters/cypress-adapter.js
    ./scripts/ai/adapters/playwright-adapter.js

    ./scripts/ai/providers/index.js
    ./scripts/ai/providers/provider-contract.js
    ./scripts/ai/providers/provider-error.js
    ./scripts/ai/providers/mock-provider.js
    ./scripts/ai/providers/groq-provider.js
    ./scripts/ai/providers/gemini-provider.js

    ./scripts/ai/knowledge/schema.js
    ./scripts/ai/knowledge/loader.js
    ./scripts/ai/knowledge/selector.js
    ./scripts/ai/knowledge/units/*.json   # 6 curated units

    ./scripts/ai/generation/requirement-model.js
    ./scripts/ai/generation/test-case-model.js
    ./scripts/ai/generation/automation-candidate.js
    ./scripts/ai/generation/automation-plan.js

    ./scripts/ai/generative-test-design/evidence-ingestion.js
    ./scripts/ai/generative-test-design/requirement-model-generator.js
    ./scripts/ai/generative-test-design/test-case-model-generator.js
    ./scripts/ai/generative-test-design/test-design-review-package.js
    ./scripts/ai/generative-test-design/test-design-review-record.js

    ./scripts/ai/test-automation/automation-repository-context.js
    ./scripts/ai/test-automation/automation-plan-generator.js
    ./scripts/ai/test-automation/generate-change-set.js
    ./scripts/ai/test-automation/generated-change-set-review-package.js
    ./scripts/ai/test-automation/generated-change-set-review-record.js
    ./scripts/ai/test-automation/change-set-application.js
    ./scripts/ai/test-automation/controlled-execution.js
    ./scripts/ai/test-automation/regenerate-change-set.js

    ./scripts/ai/evaluation/dataset.json ... dataset-v6.json
    ./scripts/ai/evaluation/baseline-v1.json ... baseline-v6.json

    ./scripts/diagnostics/firefox-failure-forensics.sh
    ./scripts/diagnostics/reset-cypress-runtime-outputs.sh

## Commands for running tests

#### Installation

Requires Node.js `22.x` (see [.nvmrc](.nvmrc)).

    git clone https://github.com/TarasovArtem/qa-ai-agent.git
    cd qa-ai-agent
    npm install

#### Opening Cypress GUI

    npx cypress open

or

    npm run cypress:open

#### Run all tests in a specific browser (browsers must be installed locally)

    npm run chrome
    npm run firefox
    npm run edge

or, without picking a browser (uses Cypress's default):

    npm run test:e2e

#### Run the Playwright suite (Chromium, browser must be installed locally)

    npm run test:e2e:playwright

#### QA Agent / evaluation commands

    npm run ai:collect          # build reports/ai/context.json from the last Cypress run
    npm run ai:analyze          # run AI failure analysis (AI_PROVIDER=mock by default)
    npm run test:unit           # scripts/ai/ unit tests (offline, no network)
    npm run eval:ai:v5          # score Dataset v5 (also: eval:ai, :v2, :v3, :v4)
    npm run eval:regression:v5  # compare against frozen Baseline v5 (also: eval:regression, :v2, :v3, :v4)
    npm run eval:ai:v6          # score Dataset v6 (Test Design / #22F quality)
    npm run eval:regression:v6  # compare against frozen Baseline v6

## Provider configuration

`AI_PROVIDER` (default `mock`), `AI_MODEL`, and `AI_API_KEY` are generic, provider-neutral application variables read from `scripts/ai/config.js`; an unrecognized `AI_PROVIDER` value throws a clear configuration error rather than silently falling back to a real provider.

**Local development** - `AI_PROVIDER=mock`, no external API, no account, no key:

```
npm run chrome        # produces reports/cypress/*.json
npm run ai:collect     # produces reports/ai/context.json
AI_PROVIDER=mock npm run ai:analyze   # produces reports/ai/ai-report.json (mock provider, no network call)
```

**GitHub Actions** - the current real, CI-wired provider:

```yaml
AI_PROVIDER: groq
AI_MODEL: openai/gpt-oss-120b
AI_API_KEY: ${{ secrets.GROQ_API_KEY }}
```

`GROQ_API_KEY` exists only as a GitHub repository secret - never committed, never in a `.env` file, never printed to a log. The workflow maps it to the generic `AI_API_KEY` variable so application code never learns Groq's name specifically.

**Gemini (local/manual only - not wired into the GitHub Actions workflow):**

```
AI_PROVIDER=gemini
AI_MODEL=gemini-3.6-flash
AI_API_KEY=<your own Gemini API key>   # never commit a real key
```

There is no `GEMINI_API_KEY` repository secret and no Gemini step in the workflow - selecting `AI_PROVIDER=gemini` today only works locally, with your own key. See [Why Gemini exists](#why-gemini-exists) above for what has and hasn't been validated about this provider.

---

## Detailed Engineering History

The sections below are the project's chronological engineering log: every roadmap item, in the order it shipped, with the exact evidence, scenario data, and design reasoning behind it. This is reference material for understanding *how* the current architecture (described above) was arrived at and verified - it is not required reading to understand what the system does today.

### Current System Under Test

The repository currently uses a publicly accessible third-party POI (points-of-interest) map web application as its real E2E target/demo application - the Cypress suite in `cypress/` exercises that application's category-tree UI and POI-tile data requests, and the Playwright smoke test in `playwright/` independently exercises the same category-selection/map-visibility flow through a second framework. The QA Agent's failure triage is exercised against both suites' real failures.

**The external application is the current System Under Test. QA AI Agent is the project being developed in this repository.** The SUT is not part of this repository and not affiliated with it - it is used only as a realistic public target for exercising the CI and failure-triage architecture; its stable identity within this codebase is a `projectId` owned by the current `ProjectProfile` (Roadmap #19.2). See [Current Multi-Framework Status](#current-multi-framework-status) above for exactly what is and is not yet portable beyond this project.

### Architectural Invariants

These properties are enforced by design and construction, not merely by convention - most have dedicated regression tests:

- **Cypress remains authoritative.** AI analysis is a diagnostic layer on top of the real test result; nothing downstream can turn a failed Cypress run green, and nothing upstream requires AI to run at all.
- **One failing workflow → one logical AI analysis**, never one per browser - browser evidence is aggregated first, and a provider's own bounded transport retries stay inside that same one logical analysis.
- **Provider adapters are transport-only.** Authentication, endpoint, and response-envelope extraction live in `scripts/ai/providers/`; prompt construction, semantic parsing, and policy live in core and never change per provider.
- **Deterministic policy owns the final bug-creation decision** - only a `PRODUCT_BUG` classification may keep a model-recommended `shouldCreateBug: true`; every other classification is forced to `false`, regardless of what the model said.
- **Knowledge is guidance, never evidence** - curated knowledge units can broaden a hypothesis but can never manufacture a fact about the current run, override direct evidence, browser correlation, history, or policy.
- **Provider errors are normalized** to one shared, provider-neutral vocabulary (`AUTH`/`RATE_LIMIT`/`TIMEOUT`/`NETWORK`/`INVALID_RESPONSE`/`CONFIGURATION`/`UNKNOWN`) before the application reasons about a failure - never an HTTP status code or a provider name.
- **No automatic provider fallback** - a misconfigured or failing provider fails the analysis honestly rather than silently substituting another provider or a fabricated result.
- **Evaluation history is immutable once frozen** - every Dataset/Baseline version, once merged, is never rewritten; new evidence becomes a new, additive sample or a new version, never a retroactive edit.

### Continuous Integration - job detail

GitHub Actions runs seven jobs per trigger: `Unit tests` and `QA Agent evaluation` start immediately and need no browser; `Cypress - chrome` and `Cypress - edge` run in parallel inside a `cypress/included` Docker container (bundles Node/npm/browsers matching the Cypress version in `package.json`); `Cypress - firefox` runs separately; `Playwright Chromium` runs an independent, real-installed `@playwright/test` run against Chromium, in its own job; `QA AI triage` runs last, after all four E2E legs.

**Why Firefox has its own job, on the bare runner instead of the container:** Firefox previously hung during WebDriver session creation when run inside the same nested `cypress/included` container Chrome/Edge use - a container-sandboxing limitation of that specific setup, confirmed by a dedicated CI spike (Roadmap #14B): the identical, unmodified suite ran cleanly in ~80s once moved directly onto the bare `ubuntu-latest` runner, with Firefox installed explicitly via `browser-actions/setup-firefox`. This is infrastructure history, not evidence of a Firefox-specific application or test defect - the job produces the same artifact shapes and the same authoritative-failure semantics as Chrome/Edge (a failed Firefox E2E run fails this job, and nothing downstream can turn it green).

Required branch-protection checks are `Cypress - chrome`, `Cypress - edge`, `Unit tests`, `Playwright Chromium`, and `QA Agent evaluation`. `Cypress - firefox` and `QA AI triage` are deliberately not required - each is informational only while its real-world CI reliability is observed independently, the same treatment Firefox itself received since Roadmap #14C before its own required-check status changed.

### QA Agent (AI failure analysis) - full detail

The QA Agent's AI backend is a swappable **provider abstraction** (`scripts/ai/providers/`), selected at runtime via the `AI_PROVIDER` environment variable.

```
Cypress (Chrome)  Cypress (Edge)  Cypress (Firefox)   Playwright (Chromium)
   │  browser-result.json  │  browser-result.json  │  browser-result.json   │  browser-result.json
   │  context.json/history.json (on failure, each leg)                     │  (via QA AI triage, on failure)
   ▼                       ▼                        ▼                      ▼
        Browser + framework aggregation (scripts/ai/aggregate-browser-context.js)
   │  reads every leg's outcome, across both frameworks; decides whether ANY failed;
   │  deterministically picks ONE primary failing leg workflow-wide;
   │  checks framework-identity consistency (descriptor vs. adapter-derived), fails
   │  closed on any contradiction; builds browserCorrelation + frameworkCorrelation (below)
   ▼
Failure Context Collector output + browserCorrelation + frameworkCorrelation
   │  failed test names, errors, relevant spec/page-object source (framework-aware),
   │  browser, known project constraints, both correlation objects -
   │  no secrets, no full repo dump
   ▼
Knowledge selection (scripts/ai/knowledge/selector.js) - deterministic, offline, zero provider calls
   │  attaches context.relevantKnowledge (guidance only, may be [])
   ▼
QA prompt (scripts/ai/qa-agent-prompt.js)
   ▼
Provider Factory (scripts/ai/providers/) ── provider.analyze({systemPrompt, userPrompt})
   │  AI_PROVIDER=mock ──→ MockProvider    (local dev, all unit tests)
   │  AI_PROVIDER=groq ──→ GroqProvider    (CI - the only provider wired into GitHub Actions today)
   │  AI_PROVIDER=gemini → GeminiProvider  (implemented, real-API-verified, not CI-wired)
   ▼
raw model response (a string - never trusted as-is)
   ▼
validation / safeguards (scripts/ai/analyze-failure.js)
   │  JSON parsing, classification/confidence checks, arbitrary-wait guard
   ▼
application action policy (scripts/ai/agent-policy.js)
   ▼
enriched AI report (reports/ai/ai-report.json) - includes provenance (providerAttempts, firstAttemptError)
   ▼
PR comment (pull_request runs only)
```

This is a deliberate choice, not a bug: the project previously called [GitHub Models](https://docs.github.com/en/github-models), which was [fully retired by GitHub on 2026-07-30](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/) (confirmed live - its inference API returned `410 Gone` for every request). The AI layer was refactored to this provider-neutral shape first, and Groq was added as the first real provider once that abstraction existed; Gemini was added second (Roadmap #18) to prove the abstraction generalizes to a second, structurally different vendor.

The boundary is runtime-checked, not just documented: `providers/provider-contract.js` rejects a provider missing `analyze()` (or a non-empty-string response) with a clear error before it can reach `JSON.parse` or a retry loop. Provider failures are normalized to one shared `ProviderError` shape (`message`, `code` from a small provider-neutral set, `retryable`, `cause`) in `providers/provider-error.js`. Each provider also exposes a plain `provider.name` string (`"mock"`, `"groq"`, or `"gemini"`, depending on which is configured), which the application attaches to the report as `analysis.provider` *after* the model response is validated.

Since Roadmap #19.2, the "known project constraints" and project identity shown above are sourced from the current `ProjectProfile` (`scripts/ai/project-profile.js`), not hardcoded in the collector or the prompt - see [Roadmap #19.2](#roadmap-192--explicit-project-identity-foundation) below for what changed and [Current Multi-Framework Status](#current-multi-framework-status) for what that does and doesn't make portable yet.

### Controlled experiments

Before evaluation infrastructure existed, the QA Agent's real (Groq-backed) behavior was validated against four deliberately-introduced, pre-registered-ground-truth failure scenarios in CI. These four runs are now Dataset v1's only samples - historical, real model output, kept exactly as recorded, never rewritten to match a preferred answer:

| Scenario | Ground truth | Actual (model) | Interpretation |
|---|---|---|---|
| #2 Broken selector | `TEST_BUG` | `FLAKY_TEST` @ 0.78 | Classification miss - the model leaned on run history to support `FLAKY_TEST`, but Dataset v1 curates that history usage as misleading here, not corroborating |
| #3 Application-like mismatch | `PRODUCT_BUG` | `PRODUCT_BUG` @ 0.66 | Pass |
| #4 Deterministic test bug, misleading history | `TEST_BUG` | `TEST_BUG` @ 0.68 | Pass |
| #5 Real flaky test | `FLAKY_TEST` | `EXTERNAL_DEPENDENCY` @ 0.75 | Ambiguous boundary case - the controlled mechanism (a delayed/withheld HTTP response) genuinely overlaps both classifications' definitions; curated as a boundary case, not a clean model failure |

### Evaluation infrastructure (Dataset v1)

An offline, deterministic layer for scoring the QA Agent's stored historical outputs against pre-registered ground truth - it never calls Groq, never re-runs an experiment, and never changes what actually happened during a real run.

```
dataset.json (Dataset v1 - the four experiments above, frozen)
   ↓
validateDataset()
   ↓
evaluateDataset()  ── classification / shouldRetry / shouldCreateBug accuracy, qualitative aggregates
   ↓
baseline-v1.json (Baseline v1 - frozen per-sample status)
   ↓
compareEvaluationToBaseline()  ── per-sample regression comparison
   ↓
regression report (UNCHANGED / IMPROVED / REGRESSED)
```

```
npm run eval:ai           # scores Dataset v1, prints classification/shouldRetry/shouldCreateBug accuracy
npm run eval:regression   # compares the current stored evaluation against frozen Baseline v1
```

Key design points:

- **Ambiguous samples are excluded from strict classification accuracy** but remain fully scored for `shouldRetry`/`shouldCreateBug` - Experiment #5's boundary-case status doesn't get silently smoothed over into a clean pass or fail.
- **Regression comparison is per-sample, not aggregate-accuracy-based.** A sample that goes from wrong to right while a different sample goes from right to wrong leaves aggregate accuracy unchanged, but is a real regression - the comparator is built specifically not to be fooled by that.
- **`shouldCreateBug` correctness is a protected safety invariant** - any sample whose `shouldCreateBug` action goes from correct to incorrect is always a `REGRESSED` result, even if classification simultaneously improved and even for an ambiguous-classification sample.
- **`QA Agent evaluation` (the CI check) is currently informational.** A `REGRESSED` comparison does **not** fail the job or block a merge today - only a technical failure (invalid dataset/baseline, a runtime crash) does. It **is** a required branch-protection check for the job's own technical success (see [Continuous Integration](#continuous-integration) above) - what remains non-blocking is only the semantic `REGRESSED` verdict inside it.

### Multi-browser evaluation (Dataset v2, Roadmap #6)

**Dataset v1 stays exactly as it was** - it predates multi-browser correlation entirely and is never mutated. Dataset v2 is a separate, additive dataset: the same four Dataset v1 samples (migrated byte-identical) plus two new, correlation-aware samples from the real Controlled Multi-Browser Correlation Experiment:

- **Scenario A** (same-signature) - Chrome and Edge fail with an identical deterministic signature in the same workflow run.
- **Scenario B** (different-signatures) - Chrome and Edge fail the same test, but with genuinely different deterministic signatures.

Both were real, Groq-backed CI runs (PR #35 and #36, closed without merge after data collection).

Each Dataset v2 sample separates the **correlation fact** (what `browserCorrelation` actually observed) from the **correlation quality judgment** (`correlationConstruction`, `correlationTransport`, `correlationReasoning`, using the same `pass | partial | fail | not_applicable` vocabulary used throughout).

**Current Baseline v2 - the state before any prompt change:** both Scenario A and Scenario B recorded `correlationConstruction = pass`, `correlationTransport = pass`, and **`correlationReasoning = partial`** - correlation reached the model intact and the diagnosis stayed correct and safe, but the model's visible reasoning didn't cite the cross-browser evidence. This baseline exists specifically so a later, controlled prompt-improvement experiment could be measured against it (see Roadmap #8 below).

```
npm run eval:ai:v2           # scores Dataset v2 (6 samples), including correlation quality aggregates
npm run eval:regression:v2   # compares the current stored evaluation against frozen Baseline v2
```

### Correlation reasoning prompt improvement (Roadmap #8)

**Phase 1 - prompt contract improvement (implemented):** the `browserCorrelation` rule in the system prompt was strengthened to explicitly distinguish `sameFailureSignature = true`/`false`/`null` semantics, require reconciling correlation with direct evidence rather than reasoning about it in isolation, and require making correlation's diagnostic role visible when materially relevant.

**This prompt change has not yet been behaviorally validated against a live Groq run in this repository's merged history.** Dataset v2/Baseline v2 remain frozen at their pre-change state; `npm run eval:ai:v2`/`eval:regression:v2` still correctly report `UNCHANGED` at this stage - the evaluator scores stored historical output, it never calls a live model. A first controlled live re-validation was run on a separate, unmerged experiment branch and showed the target improvement with zero regressions, but that single observation was never frozen into Dataset v2/v3 directly - Roadmap #12 (below) closed the actual measurement gap this exposed.

**Phase 2/3 (controlled live re-validation, evaluation update):** not started as a merged, dataset-frozen change.

### Evidence Grounding Evaluation Protection (Roadmap #9)

A controlled experiment produced one unsupported factual root-cause claim (top-level classification/action stayed correct; one detail inside `rootCause` asserted something the evidence didn't establish) - a single controlled observation, documented because it exposed a real evaluation-infrastructure gap: `quality.fabricatedEvidence` already existed in the dataset schema but had no effect on scoring or regression.

This phase activated the existing field purely in the offline evaluation layer: `metrics.evidenceGrounding.fabricatedEvidence` now reports counts, and regression comparison now treats `false → true` as a regression and `true → false` as an improvement, following the same "any regression anywhere wins" precedence as every other dimension. No production prompt, provider, policy, Cypress, or workflow behavior changed.

### Evidence Grounding Dataset Expansion (Roadmap #10)

Dataset v3 is additive over Dataset v2 (byte-identical migration, proven by a dedicated test) plus one new sample: `experiment-41-correlation-necessary-grounding`, a genuine, deterministic test-layer locator mismatch that reproduced a same-defect-family, different-signature multi-browser failure. Top-level behavior stayed correct (`TEST_BUG`, `shouldRetry=false`, `shouldCreateBug=false`), but the curated quality assessment records a real evidence-grounding failure (`rootCause=fail`, `evidence=fail`, `fabricatedEvidence=true`, `correlationReasoning=fail`) - frozen as a known deficiency in Baseline v3, not smoothed over, specifically so a future prompt change could be measured against it.

### Evidence Grounding Prompt Improvement (Roadmap #11)

The production prompt now distinguishes OBSERVED FACT / SUPPORTED INFERENCE / UNKNOWN inside every free-text field, not only `evidence` (this is the rule now summarized under [Evidence grounding](#evidence-grounding) above). A first controlled live re-validation (unmerged experiment branch) showed `fabricatedEvidence` moving `true → false` against the improved prompt with zero regressions - one live observation, not statistical proof of general improvement, and not yet frozen into a dataset at that point (Roadmap #12, next, closed that gap).

### Qualitative Regression Protection (Roadmap #12)

Evaluation-infrastructure-only change: `rootCause`/`evidence`/`recommendedFix` were already curated per sample but never individually regression-protected. Baseline v1/v2/v3 were extended (mechanically, from already-curated fields, never re-judged) so a future change that improved one dimension while silently degrading another would now be caught. The "any regression anywhere wins" precedence now spans ten dimensions per sample.

### Additive Post-Prompt Evaluation Dataset v4 (Roadmap #13)

Dataset v4 = all 7 Dataset v3 samples (byte-for-byte migrated) + two new, fully independent, real controlled re-validations of Experiment #41's exact scenario against the merged Roadmap #11 grounding prompt (`experiment-45`, `experiment-47`). Both independently showed `fabricatedEvidence=false` with all qualitative dimensions curated `pass` after re-verification against real CI artifacts - meaningful repeatability evidence for one fixed scenario, explicitly not claimed as proof the improvement generalizes to arbitrary failures. `experiment-47` also independently exercised the `shouldCreateBug` safeguard: the raw model recommendation was `true` for a non-`PRODUCT_BUG` classification, and policy correctly forced the final result to `false`.

### QA Knowledge / Skills Layer Foundation (Roadmap #15)

Added the storage, validation, and deterministic offline-selection foundation for the Knowledge Layer, as a foundation only - not yet wired into the production prompt at this stage. Initial corpus: 4 curated units. `selector.js` uses only signals available before the provider is ever called, never anything model-generated.

### Production Knowledge Integration (Roadmap #16, #16B, #16C, #16D, #16E)

Wired Roadmap #15's subsystem into the real production prompt under an explicit guidance-only authority rule (now summarized under [Knowledge Layer](#knowledge-layer) above). An independent review found two curated tags were overly broad and corrected them (#16B/#16B.1). The exact knowledge units a given analysis received are now persisted in `ai-report.json` for reproducibility (#16C).

**Controlled Live Knowledge Validation (#16D):** five controlled, live Groq-backed observations (K1-K5) validated the knowledge-authority invariants end-to-end - each a disposable branch/PR closed without merge. K1 and K3 each surfaced one real reasoning-quality finding (a real-evidence-source-but-invalid-inference pattern).

**Dataset v5 / Baseline v5 (#16E) - status: implemented, merged, evidence lock finalized.** Dataset v5 is additive over v4 (9 samples migrated byte-identical) plus four new live samples from K1/K3/K4/K5 (13 scorable total). K2 is deliberately not scorable - its original hypothesis was falsified by legitimate dynamic selection, so it's preserved as a structurally separate historical observation. `regression-v5.js` protects 15 dimensions per sample (10 inherited + 5 new: `knowledgeSelectionCorrect`, `knowledgeUsage`, `knowledgeGrounding`, `modelShouldCreateBugCorrect`, `inferenceQuality`), each justified by a concrete K1-K5 finding.

**Final Evidence Lock Decision:** an independent review identified two optional strengthening repeats (R1/R2) that could corroborate K1/K3's `partial`-dimension findings. The decision was to **finalize without running them**: the `partial`/`fail` findings are recorded honestly as known weaknesses (not smoothed to `pass`), and K3's specific policy-safety claim already has independent corroboration from the pre-existing `experiment-47` sample. R1/R2 remain available as future, purely additive work if ever wanted.

### Curated External Knowledge (Roadmap #17)

**Status: complete, merged.** Added the first `CURATED_EXTERNAL` knowledge units - statically curated, source-verified summaries of authoritative external documentation. Three candidates were researched against primary sources only; two were accepted (`framework-cypress-command-retry-ability-scope`, sourced from official Cypress docs; `ci-job-isolation-runner-state`, sourced from three official GitHub Docs pages), one was rejected for insufficient source support - accuracy took priority over corpus size. Production corpus: 6 units total, 2 `CURATED_EXTERNAL`.

### Provider / Model Abstraction (Roadmap #18)

**Status: complete with documented limitations.** Proved the pre-existing provider abstraction generalizes to a second, structurally different real vendor and added transport-level observability - fully summarized under [Provider abstraction](#provider-abstraction) above. `GroqProvider` and `GeminiProvider` are both direct HTTP implementations (no vendor SDK), so retry ownership stays entirely inside this project's own retry loop rather than an SDK's internal behavior, and both map their failures onto the same shared `ProviderError` vocabulary.

### Roadmap #19.1 — Project / Framework Portability Audit

**Status: complete (read-only).** A source-verified architecture audit classifying every meaningful component's coupling to the current project (the external SUT) and framework (Cypress), producing the [Current Multi-Framework Status](#current-multi-framework-status) and [Known Architectural Boundaries](#known-architectural-boundaries) sections above, plus the target architecture and Phase A/Phase B plan under [Roadmap #19](#roadmap-19--project--framework-portability). No production code, tests, workflow, or dataset/baseline files were changed by this audit.

### Roadmap #19.2 — Explicit Project Identity Foundation

**Status: complete.** Introduced a minimal, immutable `ProjectProfile` (`scripts/ai/project-profile.js`) - `{ id, displayName, knownProjectConstraints }` - as the single production owner of stable project identity and stable project-specific context, resolving the two project-axis gaps #19.1 identified: `collect-context.js` no longer defines its own copy of the project constraints (it consumes the profile instead), and `qa-agent-prompt.js`'s system-prompt persona sentence no longer hardcodes the SUT's identity - it renders whichever profile it is given, defaulting to the current one for backward compatibility. `context.metadata.projectId` is now emitted unconditionally by collection, and the report's `sourceContext.projectId` carries it through (`null` for a context/fixture that predates the field, never a thrown error). The production system prompt's output is unchanged, byte-for-byte. A synthetic-profile unit test proves a second project could supply its own identity purely as data, with zero change to classification, policy, provider, knowledge, or correlation code. Framework identity (the prompt still names Cypress) is deliberately untouched - that is Phase B, not this stage.

### Roadmap #19.3 — Project-Scoped Knowledge and History

**Status: complete.** Extends Roadmap #19.2's `ProjectProfile` identity into an enforced isolation boundary for the two subsystems that could otherwise let one project's context leak into another's analysis.

**Knowledge (#19.3B):** the schema's `appliesTo` object gained a third dimension, `projects` (`string[] | null`), parallel to the existing `browsers`/`frameworks` fields. `projects: null` means project-independent (unchanged behavior for the 5 non-project-specific units in the corpus); a non-null array means the unit is eligible only when the current analysis's project matches. The one `PROJECT_VERIFIED` unit now requires a non-null `appliesTo.projects` - an unscoped or malformed `PROJECT_VERIFIED` unit fails schema validation loudly at load time, the same way any other authoring mistake in a curated unit already did. The selector reads the current project only from `context.metadata.projectId`, never a hardcoded literal, and treats a missing or malformed current identity as "no known project" - project-specific Knowledge is excluded rather than guessed into eligibility.

**History (#19.3C):** the collected History aggregate now carries a `projectId` field sourced from `ProjectProfile.id`, alongside its existing pass/fail counts. Before History can influence an analysis, its `projectId` is compared against the current analysis's project identity using three explicit states - a non-empty (trimmed) string is **valid**, a property that was never set at all is **absent**, and a present-but-null/empty/whitespace-only/non-string value is **invalid** (never treated as equivalent to absent). Matching valid identities allow History through unchanged; a mismatch, an invalid value on either side, or a valid identity paired with an absent one all exclude it. The one narrow exception is both sides genuinely absent (`ABSENT + ABSENT`) - preserved for legacy, pre-#19.3 test fixtures, and never reachable in real production traffic, since collection has unconditionally emitted both `context.metadata.projectId` (since #19.2) and `history.projectId` (since #19.3C) from the start. `projectId` itself is never serialized into the prompt payload or `report.history` - it is an internal trust gate only.

Both changes are eligibility gates, not evidence: a project match never becomes an observed fact, never implies a root cause, and never influences `agent-policy.js`'s classification-to-`shouldCreateBug` decision, which remains a pure function of `{classification, shouldCreateBug}` with no awareness of project identity. Dataset/Baseline v1-v5 are unaffected - the offline evaluation harness scores pre-recorded results and never executes the Knowledge selector or History reader live, so no fixture required migration. For the current, single production project, every existing selection/History outcome is unchanged; the boundary was proven both individually and combined, using a synthetic second project id in tests only (no second production `ProjectProfile` exists).

### Roadmap #19.4 — Synthetic Second-Project Offline Proof

**Status: complete.** Closed out Phase A by exercising #19.2/#19.3's project-isolation boundary end to end against a second, wholly synthetic `ProjectProfile` - offline, no live site, no real provider call. Confirmed Knowledge/History exclusion behaves identically for a genuinely different project id as it does for the existing single-project unit tests, with zero change to production behavior for the repository's one real project.

### Roadmap #19.5 — Framework Identity + Normalized Failure Contract

**Status: complete.** Introduced `context.metadata.framework`, sourced from a single canonical identity (at this stage still a repository constant; Roadmap #19.6 moved that source into an adapter), and threaded it through Knowledge selection (`appliesTo.frameworks`), the system prompt's persona sentence (`frameworkId`, defaulting to `"cypress"` for backward compatibility), and report provenance (`sourceContext.framework`) - each classifying VALID/ABSENT/INVALID the same way #19.3C's project-identity gate already did. Also formalized `scripts/ai/normalized-failure.js`'s `validateNormalizedFailure()`: the minimum generic failure shape (`title`/`fullTitle`/`specFile`/`error`, optional `duration`/`screenshot`) the analysis core already depended on implicitly, now explicit and checkable, and proven framework-neutral by a dedicated test using a synthetic, Cypress-free failure shape.

### Roadmap #19.6 — Cypress Adapter Extraction

**Status: complete.** Extracted all Cypress/Mochawesome-specific parsing (report loading, screenshot-path resolution, failure/status normalization) out of the generic collector and into `scripts/ai/adapters/cypress-adapter.js`, exposing a plain `{id, collect({reportsDir?, screenshotsDir?})}` module contract - deliberately no class, no registry. `collect-context.js` retained ownership of everything framework-independent (metadata, `relevantFiles`, context assembly). A behavior-preserving extraction only: no parsing/matching semantics changed.

### Roadmap #19.7 (incl. #19.7H) — Cypress Historical Equivalence + Filesystem Isolation

**Status: complete.** Added a frozen, byte-for-byte golden-comparison test suite (`cypress-equivalence.test.js`) proving the #19.6 extraction produced identical output to the pre-extraction implementation across ten historical scenarios (mixed results, nested suites, error/stack matrices, screenshot matching, malformed/missing reports, multi-report aggregation). Separately (#19.7H), diagnosed and structurally fixed a pre-existing Node `--test` cross-file filesystem race in the unit-test suite itself (concurrent test files sharing and deleting common report/screenshot directories) - replaced with per-file ownership (isolated `os.tmpdir()` roots or exact-path/exact-subdirectory cleanup), not a retry-based mitigation. Zero production code changed by #19.7H.

### Roadmap #19.8 — Offline Playwright Adapter

**Status: complete.** Implemented `scripts/ai/adapters/playwright-adapter.js`, a second, fully independent adapter proving the `{id, collect()}` contract generalizes: it parses official Playwright JSON-reporter-shaped evidence (`suites[].specs[].tests[].results[]`) and normalizes it into the same generic `{testResults, failedTests, warnings}` shape Cypress produces. The critical design decision: Playwright's *logical* outcome (`test.status` - `expected`/`unexpected`/`flaky`/`skipped`) is the sole classification authority, never an individual attempt's `result.status` - so an intentionally-expected failure (`test.fail()`) or a flaky-then-passed retry never leaks into `failedTests`, and a retried-but-still-failing test produces exactly one normalized failure, from the final attempt. Proven by 36 offline fixture tests using inline, official-shape synthetic reports - no Playwright package, browser, or CI involved. Not wired into production at this stage: `collect-context.js` still imports only `cypressAdapter` - this was later resolved by Roadmap #21, see above.

### Roadmap #19.9 — Offline Framework Orchestration + History Framework Namespace

**Status: complete.** Gave the generic collector a minimal dependency-injection seam - `main({adapter = cypressAdapter, adapterOptions})` - so either adapter's evidence can traverse the same generic pipeline offline, with `context.metadata.framework` unconditionally sourced from the active adapter's own `.id`. The zero-argument production call is unchanged and byte-identical to pre-#19.9 behavior (proven by a dedicated default-vs-explicit-injection equivalence test). Closed the History cross-framework gap #19.8 exposed: `analyze-failure.js`'s `readHistory()` now requires **project AND framework** eligibility (`isHistoryFrameworkEligible()`, mirroring #19.3C's project-identity classifier), and `collect-history.js` stamps every newly written, available Cypress History record with `framework: cypressAdapter.id`. A legacy pre-#19.9 record with no `framework` field remains eligible only for a current Cypress analysis, never Playwright - no old History file was rewritten; the compatibility rule lives entirely in the reader.

### Roadmap #19.10 — Final Portability Review + Documentation Closure

**Status: complete.** #19.10A (read-only architecture/evidence audit) found zero runtime blockers to closing the offline portability milestone. #19.10D (documentation update) corrected this README's own historical lag behind #19.5-#19.9's shipped work at the time (it had described the adapter boundary as a future concept after it had already merged), with no source, test, workflow, package, or evaluation-data changes.

### Roadmap summary

| Roadmap item | Status |
|---|---|
| #1-#14 | COMPLETE - core triage pipeline, evaluation Dataset v1-v4, correlation, evidence-grounding, Firefox matrix |
| #15 - Knowledge Layer foundation | COMPLETE |
| #16 (incl. #16B-#16E.5) - Production knowledge integration, live validation, Dataset v5 | COMPLETE |
| #17 - Curated external knowledge | COMPLETE |
| #18 - Provider / model abstraction (Gemini) | COMPLETE WITH DOCUMENTED LIMITATIONS |
| #19.1 - Project/framework portability audit | COMPLETE |
| #19.2 - Explicit project identity foundation | COMPLETE |
| #19.3 - Project-scoped knowledge/history | COMPLETE |
| #19.4 - Synthetic second-project offline proof | COMPLETE |
| #19.5 - Framework identity + normalized failure contract | COMPLETE |
| #19.6 - Cypress adapter extraction | COMPLETE |
| #19.7 (incl. #19.7H) - Cypress historical equivalence + filesystem isolation hardening | COMPLETE |
| #19.7F - Firefox CI observability | #19.7F-B4B LIVE-VALIDATED (organic occurrence captured during #21J-B's own PR CI, run 32873480322); #19.7F-C FAILURE FAMILY CONFIRMED, ROOT CAUSE INCONCLUSIVE (established by an earlier organic review, reaffirmed - not reset - by this same new occurrence) |
| #19.8 - Offline Playwright adapter | COMPLETE |
| #19.9 - Offline framework orchestration + History framework namespace | COMPLETE |
| #19.10 - Final portability review + documentation closure | COMPLETE |
| #20 - Data security & governance | #20A-#20E COMPLETE; closure delivered by PR #85 |
| #21A-#21C - Playwright production groundwork | COMPLETE_ON_MAIN |
| #21D - Path/attachment security hardening (R1/R2/R3) | COMPLETE_ON_MAIN |
| #21E - Runtime framework selector | COMPLETE_ON_MAIN |
| #21F-#21G - Real Playwright CI + centralized triage integration | COMPLETE_ON_MAIN |
| #21H - Production Playwright History | COMPLETE_ON_MAIN |
| #21I - Independent controlled Playwright failure proof + D21D-3 (Windows containment) | COMPLETE |
| #21J-A - Final residual hardening (D21H-1, D21H-2) | COMPLETE_ON_MAIN |
| #21J-B - Final documentation closure | COMPLETE_ON_MAIN |
| #22/23-F0 - Shared QA generation contracts (`RequirementModel`/`TestCaseModel`/`AutomationCandidate`/`AutomationPlan` v1) | COMPLETE |
| #22 (AI Test Design: #22B-#22F) - evidence ingestion through human review of design artifacts | COMPLETE |
| #23 (AI Test Automation: #23B-#23G) - repository-context assembly through controlled, bounded test execution | COMPLETE_ON_MAIN |
| CS1-CS4 - Core stabilization (CI-authority hardening, rollback ancestor-topology hardening, supply-chain hardening, recursive test-discovery correctness) | COMPLETE_ON_MAIN |
| CS5A - #22/#23 technical documentation reconciliation (README/SECURITY) | COMPLETE_ON_MAIN |
| SG1 - Solo-maintainer GitHub governance reconciliation | COMPLETE (current repository configuration) |
| CS5B - Recruiter-facing README optimization (this update) | IN PROGRESS |

**Next:** Roadmap #21 formally closed on `main`. Roadmap #22 (AI Test Design) and Roadmap #23 (AI Test Automation) are both implemented and merged to `main`, independently reviewed and certified through CS5A - see [AI Test Design & Test Automation (#22/#23)](#ai-test-design--test-automation-2223) below for the full stage-by-stage architecture, and [SECURITY.md](SECURITY.md) for the authority/trust model. The stabilization work that followed (CS1-CS5A: CI-authority hardening, rollback ancestor-topology hardening, supply-chain hardening, recursive test-discovery correctness, and #22/#23 documentation reconciliation) is also complete on `main`. Repository governance was reconciled to a solo-maintainer profile (SG1) after CS5A's own merge gate found the previous team-oriented review-count policy could not be honestly satisfied by a single maintainer.

**Planned / future work** (not implemented yet): Controlled Correlation Re-validation (Roadmap #8, Phases 2-3, still outstanding); cross-run failure fingerprinting (correlation is currently scoped to a single workflow run only); a genuine second production project (only offline-proven today); full project independence / installability outside this demonstration repository; future SOLO/TEAM/CORPORATE governance-profile architecture (post-independence work; today's SOLO_MAINTAINER profile is a current configuration decision, not this future architecture); API/database/performance testing integration; confidence-based policy refinements; structured provider output-schema improvements; human-approved action flow / automatic GitHub Issue creation from `shouldCreateBug`; automatic multi-provider fallback (explicitly not implemented - today's provider selection is single, static, and manual); human feedback loop into evaluation; broadening the #23G execution target classifier beyond `.cy.js`/`.spec.js`; reviewer-identity/human-decision provenance (see [SECURITY.md](SECURITY.md) for the open guards this refers to).

## Roadmap closure state

- **`ROADMAP_21_TECHNICAL_WORK`: COMPLETE** - every #21A-#21J-A stage is implemented, independently reviewed, and merged to `main`, including one real, independently-reviewed, controlled Playwright failure proof.
- **`ROADMAP_21_DOCUMENTATION`: COMPLETE_ON_MAIN** - the #21J-B documentation update was independently reviewed (#21J-B-R) and merged.
- **`ROADMAP_21_FORMAL_CLOSURE`: COMPLETE_ON_MAIN** - Roadmap #21 is formally closed: #21J-B's independent review passed, its PR was standard-merged, and natural post-merge CI was verified on the exact merge commit.
- **`ROADMAP_FPI2_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - trusted `repositoryRoot` injection and containment, including Corrective C4, independently reviewed and merged (PR #123).
- **`ROADMAP_FPI3_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - real `FrameworkRuntimeConfig`/`ProjectKnowledgeConfig` consumer wiring across the Cypress adapter, Playwright adapter, `collect-history.js`, and the Knowledge loader, independently reviewed and merged (PRs #124-#127).
- **`ROADMAP_FPI4_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - Second-Project (Project B) Onboarding Proof, independently reviewed and merged (PR #128) - architectural multi-project portability proven offline.
- **`ROADMAP_ID1_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - Package Boundary / Public Programmatic API, independently reviewed and merged (PR #129).
- **`ROADMAP_ID2_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - External-Repository Installation Proof, independently reviewed and merged (PR #130) - `EXTERNAL-REPOSITORY INSTALLATION: PROVEN`.
- **`ROADMAP_REAL_REPO_VALIDATION`: COMPLETE, INDEPENDENTLY REVIEWED** - real onboarding of `TarasovArtem/TargomoPlaywright` on an unmerged experiment branch (commit `853124e`), independently, adversarially re-verified from a fresh clone - `REAL EXISTING REPOSITORY ONBOARDING: PROVEN`.
- **`ROADMAP_FULL_PROJECT_INDEPENDENCE_TERMINAL_AUDIT`: COMPLETE - NOT YET PROVEN (historical)** - identified exactly two blockers, reproducible/versioned acquisition and version-upgrade transition; both subsequently closed by `ACQ-UPG` below. Superseded by `ROADMAP_FULL_PROJECT_INDEPENDENCE_FINAL_REAUDIT`.
- **`ROADMAP_POST_ID2_DOCUMENTATION_SYNC`: COMPLETE_ON_MAIN** - independently reviewed (approved) and merged, PR #131.
- **`ROADMAP_ACQUPG_TECHNICAL_WORK`: COMPLETE** - `proof/acq-v1`/`proof/acq-v2` immutable remote tags created; reproducible versioned acquisition and version-upgrade transition empirically demonstrated (PR #132, proof-only, not merged - see [ACQ-UPG](#acq-upg--reproducible-acquisition--version-upgrade-transition-proof) above).
- **`ROADMAP_ACQUPG_INDEPENDENT_REVIEW`: APPROVED** - independently re-verified under full authentication isolation (no SSH keys/agent, no GitHub tokens); transport independently traced to anonymous HTTPS (`codeload.github.com`) - `REPRODUCIBLE VERSIONED ACQUISITION: PROVEN`, `VERSION UPGRADE TRANSITION: PROVEN`.
- **`ROADMAP_FULL_PROJECT_INDEPENDENCE_FINAL_REAUDIT`: COMPLETE - PROVEN** - every terminal-definition clause independently proven; no architecture blocker remains - `FULL PROJECT INDEPENDENCE: PROVEN`. See [Full Project Independence — Terminal Audit and Final Re-Audit](#full-project-independence--terminal-audit-and-final-re-audit) above.
- **`ROADMAP_FPI_FINAL_STATUS_DOCUMENTATION`: COMPLETE_ON_MAIN** - independently reviewed (approved) and merged, PR #133.
- **`ROADMAP_RTI1_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - the `RequirementArtifact` contract and validator, independently reviewed (one corrective cycle: nested `acceptanceCriteria[]`/`relationships[]` entries originally used a lighter validation tier than the outer artifact/`source`, empirically permitting hostile-getter execution and an uncaught exception escaping `validateRequirementArtifact()`; a narrow corrective reused the exact same hardening primitives for nested entries with no contract/schema change, and every reviewer-discovered attack now has permanent regression coverage) and merged to `main` (PR #134, merge commit `a08ab8f0714244631d5cb35281ad197a761455c8`).
- **`ROADMAP_RTI2_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `loadRequirementsFromFile`, the first `RequirementArtifact[]` file-source adapter, independently reviewed (one documentation-only corrective: the module's own docstring originally claimed unqualified "IMMUTABLE"/"frozen object" semantics, but only the top-level artifact and its `source` are actually frozen; the docstring was corrected to describe the actual shallow-freeze behavior, no runtime code/schema/public API changed) and merged to `main` (PR #135, merge commit `e6d56bc7ea5b4fcb027e8ab56b5c87a54276ec1d`).
- **`ROADMAP_RTI3_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `analyzeRequirementQuality`/`analyzeRequirementsQuality`, the first deterministic requirement quality/testability analyzer, independently reviewed (two corrective cycles: a first closing an artifact-wide, topic-blind measurable-signal suppression defect via dimension-scoped signal patterns; a second, following a focused adversarial red-team review, closing a scalability/availability mis-correlation and a bare-`"s"` duration-unit false positive) and merged to `main` (PR #136, merge commit `830dd06a4bcf915fd4c854079689a2d09db2686b`).
- **`ROADMAP_RTI4_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `generateTestDesign`/`generateTestDesigns`, the first deterministic Test Design Generator, gated hard on RTI-3's `READY` status, independently reviewed (no corrective cycle: independent review approved the implementation as submitted, with two carried-forward LOW/INFO items - `criterionIndex` positional/snapshot-scoped identity, and the deliberate absence of an exported `assertValidTestDesignArtifact` - both re-affirmed, not resolved, by RTI-5) and merged to `main` (PR #137, merge commit `74fab2f1011aba858c8a623b62ceab158e6ad800`).
- **`ROADMAP_RTI5_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `buildRequirementTraceability`/`analyzeRequirementsCoverage`, the first structural requirement↔test-design traceability/coverage layer, derived entirely from structured provenance already present on RTI-1/RTI-4 contracts, independently reviewed (no corrective cycle: independent review approved the implementation as submitted) and merged to `main` (PR #138, merge commit `a6c732fa4a2af5e418c3933af293854ec690b970`).
- **`ROADMAP_RTI6_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `loadRequirementsFromProvider`, the generic external requirements-source provider contract and executor, deliberately containing zero concrete vendor adapters (that is Roadmap RTI-7), independently reviewed (one documentation-only corrective, C1: clarified that `.cause` is unsanitized and potentially sensitive, distinct from the bounded outer error message - no production behavior, provider contract, error codes, or public API changed) and merged to `main` (PR #139, merge commit `eee3071405dda64976342ee320d9480339b6b296`).
- **`ROADMAP_RTI7A_TECHNICAL_WORK`: COMPLETE** - the RTI-7 adapter portfolio plan: first-wave adapters (Jira as reference, Azure DevOps as the architecture-diversity second adapter), packaging (in-package, subpath exports, zero new runtime dependencies), identity/provenance/pagination/retry/security policy, and an explicit decision to defer Xray/TestRail pending their own dedicated requirements-vs-test-management semantics design. Planning only - no code.
- **`ROADMAP_RTI7B_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `JiraRequirementsProvider`, the first concrete `RequirementsSourceProvider` and RTI-7's reference adapter, implementing RTI-6's `{id, read()}` contract exactly with zero RTI-6/RTI-3/RTI-4/RTI-5 production changes. Independent review (RTI-7C) found one BLOCKER (the originally implemented search endpoint had been removed by Atlassian) and two MEDIUM findings (a silent-snapshot-truncation gap; an unbounded ADF-recursion gap), all three closed by a narrow, adapter-local corrective (C1: migration to the enhanced `POST /rest/api/3/search/jql` endpoint and opaque-token pagination, a fail-closed snapshot-completeness guard, and a bounded ADF traversal depth), independently re-reviewed and approved, merged to `main` (PR #140, merge commit `019e53dd00c7d262925ea931352de4c52061de05`). `ID-3` implementation remains explicitly deferred in priority behind the `RTI` arc.
- **`ROADMAP_RTI7C_TECHNICAL_WORK`: COMPLETE** - independent exact-head review of RTI-7B's original implementation; verdict REFUSED (one BLOCKER, two MEDIUM, detailed above), directing the narrow RTI-7B-C1 corrective, which was subsequently independently re-reviewed and approved.
- **`ROADMAP_RTI7D_TECHNICAL_WORK`: COMPLETE** - merge and post-merge exact-tree/CI certification of the approved RTI-7B-C1 corrective onto `main`.
- **`ROADMAP_RTI7E_TECHNICAL_WORK`: DESIGN COMPLETE** - Azure DevOps Services adapter architecture/contract/security/test design, independently verified against current Microsoft Learn documentation (WIQL, Work Items Batch, rate limits, auth guidance). Planning only - no code.
- **`ROADMAP_RTI7F_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `AzureDevOpsRequirementsProvider`, the second concrete `RequirementsSourceProvider`, implementing RTI-6's `{id, read()}` contract exactly with zero RTI-6/RTI-3/RTI-4/RTI-5/Jira production changes. Independent review found three narrow, adapter-local MEDIUM findings (a rate-limit wait ceiling capped well within Azure's own documented normal throttling range; an `Object.prototype` leak in two vendor-keyed map lookups when the untrusted vendor value was literally `"__proto__"`; an HTML tag-boundary scanner that mishandled a literal `>` inside a quoted attribute value), all three closed by a narrow, adapter-local corrective (C1), independently re-reviewed and approved, merged to `main` (PR #141, merge commit `55459f60b8e933f4573b3cb1858689450a0b6f72`).
- **`ROADMAP_RTI7G_TECHNICAL_WORK`: COMPLETE** - independent cross-adapter architecture review of Jira and Azure DevOps together. Concluded RTI-6's `{id, read()}` abstraction is already at the correct level and validated by both real adapters without any generic-core redesign; found no BLOCKER and no merge-preventing MEDIUM; escalated exactly one narrow Jira-local parity gap (unknown-top-level-config permissiveness and an unaudited vendor-keyed map lookup, both of which Azure's own corrective had already closed for itself) as `RTI-7I-A`. Explicitly rejected a shared retry helper and deferred both a shared safe-string-primitives extraction and a shared test-fixture extraction (see [PROVIDERS.md](PROVIDERS.md#shared-production-code-decisions) for the full evidence table) - no shared production code or shared test infrastructure was introduced. `RTI-7H` (a third adapter) classified `OPTIONAL / SKIP` - two real, materially heterogeneous adapters were judged sufficient architectural proof.
- **`ROADMAP_RTI7H_TECHNICAL_WORK`: OPTIONAL / SKIP** - a third concrete adapter was evaluated by RTI-7G and judged not architecturally necessary; Jira and Azure DevOps already constitute sufficient heterogeneous proof of the RTI-6 abstraction. Not started, and not required before RTI-8.
- **`ROADMAP_RTI7IA_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - Jira/Azure provider parity hardening: unknown top-level Jira config keys are now rejected at construction (matching Azure's already-hardened behavior), and Jira's native issue-type lookup now uses the same own-property-safe guard independently discovered and fixed in the Azure adapter. Independently reviewed and approved (no new findings - the exhaustive audit confirmed exactly one unguarded lookup existed and everything else in the file was already safe), merged to `main` (PR #142, merge commit `2978576588be9f5f5ba5b8ae6208d3b5d42cf1a3`).
- **`ROADMAP_RTI7IB_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - the RTI-7 Provider Authoring Contract persisted to [PROVIDERS.md](PROVIDERS.md), stale roadmap wording corrected throughout this README, and all RTI-7G architecture decisions and carried-forward debt formally recorded. Independently reviewed (approved) and merged to `main` (PR #143, merge commit `b16b87c`, with one documentation-only follow-up, `RTI-7I-B-C1`, correcting pre-merge roadmap-state wording).
- **`ROADMAP_RTI7_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - Roadmap RTI-7 (External Requirements Source Providers) is formally closed: two materially heterogeneous real adapters (Jira, Azure DevOps) both implement RTI-6's `{id, read()}` contract exactly, each independently reviewed, hardened where findings required it, and post-merge certified; the cross-adapter architecture review found the abstraction sound and required no generic-core redesign; the durable Provider Authoring Contract (`RTI-7I-B`) is independently reviewed and merged. `RTI-8` is ready and has itself since progressed to implementation-complete (see below).
- **`ROADMAP_RTI8A_TECHNICAL_WORK`: COMPLETE** - Publishing/Destinations architecture and contract design: the `TestDesignDestination` interface, `TestDesignPublishRequest`/`TestDesignPublishResult` shapes, `CREATE_ONLY`/no-generic-retry/sequential-processing/best-effort-per-item/global-short-circuit decisions, and the two-trust-boundary model (destination implementation trusted, destination's returned result untrusted) - refined with one round of user-provided deltas explicitly adopted (15000ms default timeout, `_links.html.href`-preferred location extraction, a distinct `AZURE_TEST_CASE_NOT_ATTEMPTED` code, 404 scoped to "target not found", 3xx added to the global-short-circuit table). Planning only - no code.
- **`ROADMAP_RTI8B_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `assertValidTestDesignArtifact`/`publishTestDesigns`, the generic publishing core implementing RTI-8A's approved contract exactly. Independent review (`RTI-8C`) found one MEDIUM (nested `TestDesignArtifact` fields mutable by destination code despite top-level freeze), closed by a narrow corrective (`RTI-8B-C1`: fresh, deeply-frozen canonical copies via own-enumerable-data-property reads), independently re-reviewed and approved, merged to `main` (PR #144, merge commit `a13e49f`). Post-merge exact-tree/CI certification: `RTI-8D`, complete.
- **`ROADMAP_RTI8E_TECHNICAL_WORK`: COMPLETE** - Azure DevOps Test Case Destination architecture/contract/security/test design, independently verified against current Microsoft Learn documentation (Work Item Create REST API, `System.Title`'s 255-character limit, JSON Patch request shape, response envelope). Planning only - no code.
- **`ROADMAP_RTI8E1_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - extraction of the shared `test/helpers/http-test-server.js` fixture (`withServer`/`respondJson`) from the Jira/Azure-provider test duplication, triggered by the Azure destination crossing RTI-8A's own carried "third network test adapter" extraction threshold. Byte-identical extraction (independently reproved against a base-`main` reconstruction), zero production diff, one genuine but pre-existing non-reentrancy hazard found, characterized, and carried as debt (never fixed). Independently reviewed (approved) and merged to `main` (PR #145, merge commit `ce2e682`).
- **`ROADMAP_RTI8F_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - `AzureDevOpsTestCaseDestination`, the first concrete `TestDesignDestination`, implementing RTI-8A/8E's approved contract exactly with zero RTI-8B/generic-core production changes. Independent review (`RTI-8G`) found zero BLOCKER/MEDIUM (two LOW/INFO findings carried as debt: a direct-`publish()` trust-model documentation gap, since closed by this documentation update, and `location` metadata checking hostname but not port), approved as submitted - `RTI-8H` (a corrective cycle) was therefore skipped. Merged to `main` (PR #146, merge commit `9c4131e`). Post-merge exact-tree/CI certification: `RTI-8I`, complete.
- **`ROADMAP_RTI8J_TECHNICAL_WORK`: COMPLETE — VENDOR INDEPENDENCE PROVEN** - the cross-vendor end-to-end integrated review: a real `JiraRequirementsProvider` ingestion feeding the real, unmodified generic quality/generation/publishing core into a real `AzureDevOpsTestCaseDestination`, with zero bridging/mapping/translation code anywhere. Review-only (zero production diff, zero committed test file - executed as in-process scratch proof); full evidence chain in [PUBLISHING.md](PUBLISHING.md#cross-vendor-proof). One honestly-carried limitation found and reported, not fabricated around: the current Jira provider yields at most one `acceptanceCriteria` entry per issue.
- **`ROADMAP_RTI8K_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - this documentation closure: the RTI-8 Publishing/Destination Authoring Contract persisted to [PUBLISHING.md](PUBLISHING.md), stale roadmap/package-surface wording corrected throughout this README (the "8 symbols" public-API description had gone stale after RTI-1 through RTI-8B grew it to 19), a canonical cross-vendor usage example added, and all RTI-8 carried-forward debt formally recorded. Independent review found two narrow LOW/INFO documentation defects (an error-taxonomy count/literal-naming inconsistency in PUBLISHING.md, and a missing package-consumer-facing duplicate-creation-risk sentence in README.md), both closed by a narrow corrective (`RTI-8K-C1`), independently re-reviewed and approved, and merged to `main` (PR #147, merge commit `fb46002`).
- **`ROADMAP_RTI8_TECHNICAL_WORK`: COMPLETE_ON_MAIN** - Roadmap RTI-8 (Test Case Publishing/Destinations) is formally closed: the generic publishing core and one real concrete destination (Azure DevOps Test Case) are both `COMPLETE_ON_MAIN`, independently reviewed, hardened where a finding required it, and post-merge certified; the cross-vendor integrated review (`RTI-8J`) proved the architecture requires no source/destination bridging code; and the durable Publishing/Destination Authoring Contract (`RTI-8K`) is independently reviewed and merged. The full `RTI-1`-`RTI-8` arc reached `COMPLETE_ON_MAIN` here, unblocking the mandatory **RTI Integrated Audit** - see the entries immediately below for its outcome.
- **`ROADMAP_RTI_INTEGRATED_AUDIT`: PASS WITH DEFERRED DEBT** - a comprehensive cross-layer audit (authority model, trust boundaries, provenance, no-hallucination, side-effect boundaries, failure semantics, package/API surface, determinism, documentation truth) ran against the full RTI-1..RTI-8 subsystem. Found exactly one BLOCKER, `RTIA-B01`: `publishTestDesigns()` read `request.testDesigns` twice (once to validate, once to canonicalize/publish), letting a getter-/Proxy-backed property diverge between the two reads and bypass `MAX_PUBLISH_BATCH_SIZE` and per-artifact/duplicate validation - reproduced adversarially (a 1-item-then-501-item getter reached `destination.publish()` with 501 items). Also found one INFO documentation inaccuracy, `RTIA-I01` (a carried-debt row describing `rawResult.allSucceeded` as still using unhardened access, when the code already hardened and cross-validated it). Both were closed by a narrow corrective, `RTIA-C1` (single-read fix + six adversarial regression tests + the doc correction), independently reviewed, merged (merge commit `ca9bfa0`), and post-merge re-proven from a fresh external package install. A subsequent targeted re-verification mission independently re-derived the exploit against the exact pre-fix base commit (confirmed it genuinely reproduced), reconfirmed the fix from first principles (static read-count proof, synchronous-trust-window proof, the full adversarial matrix, and a hunt for related-but-distinct double-read patterns elsewhere in the same file - none exploitable), and confirmed zero new defects. `RTI RELEASE READINESS: NOT READY` (architectural/audit correctness is proven; formal package release maturity is separate, unstarted `ID-3` work). `AISEC technical entry: APPROVED` as a direct result.
- **`ROADMAP_CONFORMANCE_REMEDIATION`: CURRENT EXECUTION GATE** - although RTI closure technically unblocks AISEC entry, a separate conformance analysis (dated 2026-09-16) found the project's pinned roadmap had drifted from actual repository state, was missing several tracks, and contained an unresolved phase-ordering question requiring an explicit owner decision. The owner adopted a Conformance Remediation program (Wave 1 → Wave 2 → an Architecture Conformance Gate) to run before AISEC execution begins. This program's own progress (which slice is currently active, which are complete) is tracked in [ROADMAP.md](ROADMAP.md), not duplicated here, so this entry does not need updating as individual slices land. **`AISEC` therefore remains `NOT_STARTED` by deliberate governance sequencing, not by any remaining technical blocker.**

## AI Test Design & Test Automation (#22/#23)

This repository contains **two separate AI-assisted pipelines** that must not be
confused with each other:

1. **CI failure-triage pipeline (Roadmap #1-#21)** - reactive. It runs after a
   Cypress/Playwright test *already failed* in CI, gathers evidence about that
   failure, and asks an AI provider to analyze root cause and suggest a fix.
   It never writes to the repository and never runs a test itself; its output
   is a PR comment. This is the pipeline the rest of this README (the sections
   above this one) describes.
2. **AI Test Design & Test Automation pipeline (Roadmap #22/#23)** - generative.
   Given evidence about desired behavior (not a failure), it proposes new
   requirements and test cases (#22, "AI Test Design"), then proposes,
   human-reviews, and - only after explicit human approval - safely applies
   and controlled-executes new automated test code (#23, "AI Test Automation").
   Unlike the triage pipeline, this pipeline **does** write files to the
   repository and **does** spawn a test-runner child process, but only inside
   the specific, human-gated, bounded stages described below. See
   [SECURITY.md](SECURITY.md#21-ai-test-design--test-automation-pipeline-2223)
   for the full authority/trust model.

Both pipelines share nothing at runtime except the AI provider abstraction
(`scripts/ai/providers/`); they are otherwise independent code paths.

### Shared foundation: #22/23-F0

A shared, versioned, strictly validated `RequirementModel` / `TestCaseModel` /
`AutomationCandidate` / `AutomationPlan` v1 contract layer
(`scripts/ai/generation/`), frozen before the two streams below (`#22 AI Test
Design`, `#23 AI Test Automation`) began, so neither could independently
invent an incompatible data model. See
[docs/qa-generation-contracts-v1.md](docs/qa-generation-contracts-v1.md) for
the full design: grounding/provenance, project isolation, cross-model
reference validation, safe repository paths, and the v1 freeze policy. This
foundation defines data contracts only - it calls no AI provider, runs no
browser, and performs no filesystem mutation; it does not itself implement
requirements ingestion, test design, or test automation.

### End-to-end flow

```text
Evidence  ->  Test Design (#22)  ->  Human Review (#22F)
                                          |
                                   Automation Plan (#23B/#23C)
                                          |
                              Generated Change Set (#23D/#23E-gen)
                                          |
                                Human Review (#23E)  -- reject/approve --
                                          |  approve
                              Safe Application (#23F, filesystem writes)
                                          |
                          Controlled Execution (#23G, child process, shell:false)
                                          |
                             Execution Evidence + Bounded Regeneration (#23G, max 1 attempt)
```

No stage past "Human Review" runs without an explicit prior human approval
recorded in a digest-bound review record; see
[SECURITY.md](SECURITY.md#23-human-review-boundary-22f--23e) for what that
review boundary does and does not guarantee.

### #22 - AI Test Design (evidence -> reviewed design artifacts)

| Stage | Purpose |
| --- | --- |
| #22B | Evidence ingestion - turns raw project/requirement input into a validated intake artifact |
| #22C | `RequirementModel` generation - AI-proposed, schema-validated requirements |
| #22D | `TestCaseModel` generation - AI-proposed, schema-validated test cases grounded in the requirements |
| #22E | Test-design review package/canonical assembly - deterministic, digest-bound packaging of the proposed design for human review |
| #22F | Human test-design review record - a human approves or rejects the packaged design; the decision is sealed into a digest-bound review record (see the review-boundary caveat above) |

### #23 - AI Test Automation (reviewed design -> controlled execution)

| Stage | Purpose |
| --- | --- |
| #23B | Automation repository context - read-only assembly of the target project's existing test conventions/framework identity |
| #23C | `AutomationCandidate` / `AutomationPlan` generation - AI-proposed mapping from approved test cases to concrete automation code, grounded in #23B's context |
| #23D | Generated change set - the concrete file-level diff the plan implies, not yet applied to disk |
| #23E-gen / #23E | Generated-change-set review package/canonical assembly and human review record - a human approves or rejects the proposed *code*, sealed into its own digest-bound review record |
| #23F | Safe application - once approved, applies the generated change set to the real filesystem under a constrained, containment-checked writer (see [SECURITY.md](SECURITY.md#24-filesystem-mutation-authority-23f)) |
| #23G | Controlled execution - runs the applied test(s) via a `shell:false` child process against a closed classifier map, records execution evidence, and supports one bounded regeneration attempt on failure (see [SECURITY.md](SECURITY.md#25-controlled-execution-authority-23g)) |

**Current platform limitation:** #23G's controlled execution does not run on
Windows hosts today (a `shell:false` Node `child_process` limitation when
resolving `.cmd`-shim binaries on that platform surfaces as `EINVAL`; the
affected tests are explicitly skipped on Windows, not silently passed). See
`FUTURE_WINDOWS_EXECUTION_CAPABILITY_GUARD` in
[SECURITY.md](SECURITY.md#27-windows-execution-limitation-future_windows_execution_capability_guard).
