# QA AI Agent

![Cypress E2E Tests](https://github.com/TarasovArtem/qa-ai-agent/actions/workflows/cypress.yml/badge.svg?branch=main)

QA AI Agent is a framework-portable, AI-assisted failure-triage system with production integration for **two** E2E frameworks - Cypress and Playwright. It deterministically aggregates cross-browser and cross-framework test evidence, performs one centralized AI analysis through a provider-neutral abstraction (Mock / Groq / Gemini), validates the model's output by hand, applies a deterministic application-level safety policy on top of the model's recommendation, and protects its own behavior over time with an offline evaluation/regression suite. The AI is **assistive, not authoritative**: it never decides whether a CI run passes, and it never files a bug on its own recommendation alone.

See [TEST_CASES.md](TEST_CASES.md) for the full list of manual test cases covered by the Cypress suite, with preconditions, steps, and expected results for each.

## Key capabilities

- Two production E2E frameworks: Cypress (Chrome / Edge / Firefox) and Playwright (Chromium), each with its own framework adapter and its own CI job(s)
- One logical AI analysis per failing workflow, never one call per browser or per framework
- Deterministic, code-computed evidence correlation: `browserCorrelation` (same-framework, cross-browser) and `frameworkCorrelation` (cross-framework, workflow-level outcomes only) - kept explicitly separate, no LLM involved in computing either
- Framework-scoped, project-scoped flaky-test History, derived from prior GitHub Actions run/job evidence (not a custom durable database - GitHub Actions' own records are the durable substrate)
- Evidence-grounded model reasoning (observed fact vs. supported inference vs. unknown - enforced by prompt contract)
- Deterministic `shouldCreateBug` safety policy the model cannot override; no automatic GitHub issue creation
- Provider abstraction across three real backends: Mock / Groq / Gemini, swappable with zero core changes; no automatic cross-provider fallback
- Machine-readable provider provenance (attempt count, first-attempt error) and bounded transport retry
- Curated, schema-validated, offline Knowledge Layer selected before the model is ever called
- Versioned, frozen offline evaluation/regression datasets (v1-v5) that protect 15 behavioral dimensions per sample
- Repo-local, canonical-path, cross-platform (Windows/POSIX) attachment and source-evidence containment
- GitHub Actions CI with authoritative Cypress/Playwright pass/fail, independent of AI outcome

## Security and AI data governance

See [SECURITY.md](SECURITY.md) for the full data-governance contract: what data can reach an external AI provider, what's explicitly excluded, credential handling, provider/retry policy, GitHub Actions artifact boundaries, and explicit known limitations. Roadmap #20 (baseline audit, trust-boundary hardening, this governance documentation, and its independent review) is implemented and independently reviewed - see [Roadmap #20](#roadmap-20--data-security--governance) below for exact stage-by-stage status and delivery via PR #85.

## Why this project exists

Cross-browser E2E failures are frequently ambiguous. A single failing test can mean:

- a real product defect,
- a broken or stale test (selector, assertion, page object),
- CI/environment instability unrelated to the app or the test,
- genuine browser-specific behavior,
- a flaky timing/synchronization issue,
- or simply not enough evidence to tell.

A raw error message or stack trace alone is usually not enough to distinguish these. This project combines several deterministic evidence sources - the current failure's own error/source context, cross-browser correlation, recent pass/fail history, and curated engineering knowledge - and hands all of it to a model in a single, tightly-scoped analysis, under an explicit contract that forbids the model from inventing facts the evidence doesn't support.

Two things are true at once by design: **the AI is doing real reasoning work**, and **Cypress remains the sole source of truth for whether the build passed**. Nothing downstream of Cypress - correlation, knowledge selection, the AI call, or application policy - can turn a failed run green, and none of it is required for Cypress's own result to be authoritative.

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
| v5 | 13 scorable + 1 historical-only | **frozen (latest, no v6 yet)** |

Core principle: **a new architecture change must never silently redefine what "correct" meant historically.** Every dataset version is additive and byte-for-byte frozen once merged; regression comparison is per-sample (not aggregate-accuracy) with an explicit "any regression anywhere wins" precedence, so an unrelated improvement can never mask a real regression on a protected dimension. Dataset v5's regression comparator protects **15 separate dimensions per sample** (classification correctness, `shouldRetry`/`shouldCreateBug` correctness, evidence-grounding quality, three cross-browser correlation-quality dimensions, and five knowledge-authority dimensions added specifically because a live experiment exposed a real gap each one closes). Full detail, including the specific historical samples and each version's design rationale, is in the [Detailed Engineering History](#detailed-engineering-history) section below.

```
npm run eval:ai:v5          # scores Dataset v5
npm run eval:regression:v5  # compares against frozen Baseline v5
```

**Verified at Roadmap #18 completion** (a historical milestone snapshot, not a permanent repository invariant - re-run `npm run test:unit` for the current count): 918 unit tests passing, including 93 provider-layer tests (27 Gemini / 17 Groq / 14 Mock / remainder shared contract-and-factory tests); Dataset/Baseline v1-v5 all `UNCHANGED`.

**Verified at Roadmap #21J-A completion** (current, most recent snapshot - again, re-run `npm run test:unit` for the up-to-date count as the suite keeps growing): 1377 unit tests passing; Dataset/Baseline v1-v5 all `UNCHANGED`; no v6 exists yet.

## Continuous Integration

GitHub Actions ([.github/workflows/cypress.yml](.github/workflows/cypress.yml)) runs on pushes to `main`, pull requests targeting `main`, and manual dispatch. Seven jobs run per trigger: `Unit tests`, `QA Agent evaluation` (offline, informational), `Cypress - chrome`, `Cypress - edge`, `Cypress - firefox`, `Playwright Chromium`, and `QA AI triage` (runs after all four E2E legs, at most once per workflow run).

**If every E2E leg (all three Cypress browsers and Playwright) passes, AI analysis is skipped entirely** (`No E2E failures detected; AI triage skipped.`) - zero provider calls happen on a green run. If any leg fails, the deterministic aggregator selects one primary failure across both frameworks, computes `browserCorrelation`/`frameworkCorrelation`, and triggers exactly one AI analysis. **AI never controls whether the workflow passes or fails** - each framework's own pass/fail is always authoritative, regardless of whether AI analysis ran, succeeded, or failed.

Required branch-protection checks are `Unit tests`, `Cypress - chrome`, and `Cypress - edge`. `Cypress - firefox`, `Playwright Chromium`, `QA Agent evaluation`, and `QA AI triage` are deliberately **not required yet** - each is informational while its real-world reliability is observed independently. (Firefox's own execution-environment split from Chrome/Edge, and CI history in general, are explained in [Detailed Engineering History](#detailed-engineering-history) below - this is normal engineering history for a live external site, not evidence of a current defect.)

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
3. **#19.7F-B4B (Firefox forensic observability) is now live-validated.** An organic occurrence of the known intermittent Firefox failure signature (`cy.wait()` timeout on the `poiTiles` route, no request ever occurring) happened naturally during this documentation PR's own CI run (GitHub Actions run `32873480322`, unrelated to and unaffected by this PR's docs-only content) - the corrected capture behavior executed and its `firefox-forensics` artifact uploaded successfully (18 files), and the sensitive-pattern scan flagged nothing. **This confirms the capture pipeline itself works live; it does not establish a root cause.** #19.7F-C's own status is unchanged by this occurrence: an earlier organic Firefox review had already confirmed this exact failure family (`poi_data_requests.cy.js`/`cy.wait("@poiTiles")`), with the root cause left inconclusive; this PR's occurrence is a second, independently-captured instance of that same known family, live-validating B4B's corrected capture path without newly resolving the underlying root cause - see [Detailed Engineering History](#detailed-engineering-history) below.

None of these affect current production behavior. See [Roadmap #19](#roadmap-19--project--framework-portability) and [Roadmap #21](#roadmap-21--production-playwright-enablement--final-hardening) below.

## Key Architecture Decisions

- **One logical AI analysis per failing workflow, not one per browser.** Avoids duplicate/racing analyses, keeps cost and rate-limit exposure bounded, and gives the model real cross-browser evidence in a single call instead of splintering it across several.
- **The LLM never owns the final `shouldCreateBug` decision.** Action-triggering decisions must stay deterministic and auditable; a model recommendation is an input to policy, never the policy itself.
- **Knowledge is guidance, never evidence.** Curated engineering knowledge can broaden a hypothesis but is structurally forbidden from manufacturing a fact about the current run - this boundary is enforced by prompt contract and tested behaviorally, not just documented.
- **Evaluation baselines are frozen once merged.** A regression target that can move is not a regression target - new evidence becomes a new, additive dataset version, never a retroactive edit to what "passing" used to mean.
- **Provider adapters, not a provider-aware core.** Transport, auth, and vendor-native envelopes live entirely in `scripts/ai/providers/`; adding Gemini as a second real vendor required zero changes to prompt, policy, knowledge, or evaluation code - proving the boundary is real, not aspirational.
- **No automatic provider fallback.** A misconfigured or failing provider fails the analysis honestly rather than silently substituting a different provider or a fabricated result - hidden fallback would also hide cost, semantics, and observability changes a human should see.
- **A synthetic portability proof came before any real second-framework integration.** Roadmap #19 proved the `NormalizedFailure` abstraction and a second adapter (`playwrightAdapter`) entirely offline, against official-shape synthetic fixtures, before ever considering a real Playwright integration - so the question "does the abstraction actually work" was never conflated with "did I map one specific framework's reporter API correctly."

## What this project demonstrates

QA automation architecture and Cypress E2E engineering; GitHub Actions CI orchestration; deterministic cross-browser failure correlation; deterministic policy design constraining LLM output; AI provider abstraction proven across two structurally different vendors; offline AI evaluation/regression infrastructure; evidence-grounded prompt engineering; curated knowledge selection; and incremental, evidence-driven architecture refactoring (each roadmap item shipped independently, verified, and regression-checked against frozen history before the next one started).

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

**Status: technical implementation and evidence work COMPLETE. Formal closure (this documentation, #21J-B) requires independent review and a standard merge - see [Roadmap closure state](#roadmap-closure-state) at the end of this document for the exact current status.**

Roadmap #21 took Roadmap #19's offline-proven adapter/portability architecture into real, production GitHub Actions CI - the single largest architectural change since the original pipeline shipped.

- **#21A-#21C - Playwright production groundwork.** Real, installed `@playwright/test` configuration (single Chromium project, one worker, zero retries), a real-installed-reporter proof of Playwright's actual JSON report shape (superseding the #19.8 synthetic-fixture model), and a framework-aware `relevantFiles` source-evidence policy (`RELEVANT_FILES_POLICIES`) giving Playwright its own independent allowlist alongside Cypress's.
- **#21D - Path/attachment security hardening (R1/R2/R3).** Repo-local, canonical-path (realpath-based) containment for reporter-derived spec paths and attachment locality, closing the out-of-root/absolute-path gaps #19's own boundary list had flagged. Windows canonical-path case-sensitivity was later found and closed (D21D-3, #21I-A) using segment-aware `path.win32`/`path.posix` semantics - never a naive lowercase-prefix check.
- **#21E - Runtime framework selector.** `scripts/ai/runtime-framework-selector.js`: `QA_FRAMEWORK=playwright` selects `playwrightAdapter`; absent/unset defaults to `cypressAdapter`; any other value fails closed with a bounded configuration error - hardened (D21E-2) against non-string selector values (arrays, objects, a crafted `toString()`) that could otherwise coerce into an accidental selection.
- **#21F-#21G - Real Playwright CI + centralized triage integration.** A real `Playwright Chromium` GitHub Actions job, wired into the same centralized `QA AI triage` job Cypress already used - `browserCorrelation` and the new, separate `frameworkCorrelation` (Roadmap #21G-C1) were split apart after an independent review found the original design risked treating an independent framework's outcome as same-test browser corroboration.
- **#21H - Production Playwright History.** `collect-history.js` parameterized to target Playwright's own GitHub Actions job name and framework identity, with zero change to Cypress's own byte-identical default behavior; the pre-existing project+framework History isolation gates (from #19.9B) required no changes at all.
- **#21I - Independent controlled Playwright failure proof.** A single, deliberate, deterministic test-side assertion failure, executed exactly once via a natural GitHub Actions `pull_request` run on a dedicated, permanently unmerged evidence branch/PR, live-proving the entire evidence pipeline end to end for a real Playwright failure - see [Evidence maturity](#evidence-maturity) above for exactly what this did and did not prove. Also closed D21D-3 (Windows canonical containment) beforehand, as a prerequisite.
- **#21J - Final residual hardening + documentation.** Closed two low-severity, non-exploitable-in-production residual observations (D21H-1: framework-identity ABSENT-vs-INVALID distinction; D21H-2: bounded History-metric validation) and produced this documentation update (#21J-B).

Every stage above was independently reviewed before merging, following the same pattern used throughout this project's history: implement → validate → independent review → standard merge → natural post-merge CI verification.

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

    ./scripts/ai/evaluation/dataset.json ... dataset-v5.json
    ./scripts/ai/evaluation/baseline-v1.json ... baseline-v5.json

## Commands for running tests

#### Installation

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

#### QA Agent / evaluation commands

    npm run ai:collect          # build reports/ai/context.json from the last Cypress run
    npm run ai:analyze          # run AI failure analysis (AI_PROVIDER=mock by default)
    npm run test:unit           # scripts/ai/ unit tests (offline, no network)
    npm run eval:ai:v5          # score Dataset v5
    npm run eval:regression:v5  # compare against frozen Baseline v5

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

Required branch-protection checks are `Unit tests`, `Cypress - chrome`, and `Cypress - edge`. `Cypress - firefox`, `Playwright Chromium`, `QA Agent evaluation`, and `QA AI triage` are deliberately not required yet - each is informational only while its real-world CI reliability is observed independently, the same treatment already applied to Firefox since Roadmap #14C.

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
- **`QA Agent evaluation` (the CI check) is currently informational.** A `REGRESSED` comparison does **not** fail the job or block a merge today - only a technical failure (invalid dataset/baseline, a runtime crash) does. It is **not** a required branch-protection check.

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

**Status: complete.** Implemented `scripts/ai/adapters/playwright-adapter.js`, a second, fully independent adapter proving the `{id, collect()}` contract generalizes: it parses official Playwright JSON-reporter-shaped evidence (`suites[].specs[].tests[].results[]`) and normalizes it into the same generic `{testResults, failedTests, warnings}` shape Cypress produces. The critical design decision: Playwright's *logical* outcome (`test.status` - `expected`/`unexpected`/`flaky`/`skipped`) is the sole classification authority, never an individual attempt's `result.status` - so an intentionally-expected failure (`test.fail()`) or a flaky-then-passed retry never leaks into `failedTests`, and a retried-but-still-failing test produces exactly one normalized failure, from the final attempt. Proven by 36 offline fixture tests using inline, official-shape synthetic reports - no Playwright package, browser, or CI involved. Not wired into production: `collect-context.js` still imports only `cypressAdapter`.

### Roadmap #19.9 — Offline Framework Orchestration + History Framework Namespace

**Status: complete.** Gave the generic collector a minimal dependency-injection seam - `main({adapter = cypressAdapter, adapterOptions})` - so either adapter's evidence can traverse the same generic pipeline offline, with `context.metadata.framework` unconditionally sourced from the active adapter's own `.id`. The zero-argument production call is unchanged and byte-identical to pre-#19.9 behavior (proven by a dedicated default-vs-explicit-injection equivalence test). Closed the History cross-framework gap #19.8 exposed: `analyze-failure.js`'s `readHistory()` now requires **project AND framework** eligibility (`isHistoryFrameworkEligible()`, mirroring #19.3C's project-identity classifier), and `collect-history.js` stamps every newly written, available Cypress History record with `framework: cypressAdapter.id`. A legacy pre-#19.9 record with no `framework` field remains eligible only for a current Cypress analysis, never Playwright - no old History file was rewritten; the compatibility rule lives entirely in the reader.

### Roadmap #19.10 — Final Portability Review + Documentation Closure

**Status: #19.10A (read-only architecture/evidence audit) complete - found zero runtime blockers to closing the offline portability milestone. #19.10D (this documentation update) in progress.** The audit's one substantive finding was that this README itself had fallen materially behind #19.5-#19.9's shipped work (describing the adapter boundary as a future concept after it had already merged) - #19.10D exists specifically to correct that, with no source, test, workflow, package, or evaluation-data changes.

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
| #21J-B - Final documentation closure (this update) | READY_FOR_INDEPENDENT_REVIEW |

**Next:** #21J-B's independent review (#21J-B-R), then a standard merge and post-merge verification, formally closes Roadmap #21 - see [Roadmap closure state](#roadmap-closure-state) below. After that, the next locked stage is **#22/23-F0 (Shared QA Generation Foundation)**, which will define/freeze shared versioned generation contracts before two parallel streams diverge: **#22 (AI Test Design)** and **#23 (AI Test Automation)**. None of #22/23-F0, #22, or #23 has been started or designed yet - they are named here only as the next locked roadmap stage, not as implemented or in-progress work.

**Planned / future work** (not implemented yet): Controlled Correlation Re-validation (Roadmap #8, Phases 2-3, still outstanding); cross-run failure fingerprinting (correlation is currently scoped to a single workflow run only); a genuine second production project (only offline-proven today); API/database/performance testing integration; confidence-based policy refinements; structured provider output-schema improvements; human-approved action flow / automatic GitHub Issue creation from `shouldCreateBug`; automatic multi-provider fallback (explicitly not implemented - today's provider selection is single, static, and manual); human feedback loop into evaluation; #22/23-F0, #22, and #23 (see above).

## Roadmap closure state

- **`ROADMAP_21_TECHNICAL_WORK`: COMPLETE** - every #21A-#21J-A stage is implemented, independently reviewed, and merged to `main`, including one real, independently-reviewed, controlled Playwright failure proof.
- **`ROADMAP_21_DOCUMENTATION`: READY_FOR_FINAL_REVIEW** - this documentation update (#21J-B) is open for independent review (#21J-B-R) as of this writing; it changes no runtime code, workflow, or test.
- **`ROADMAP_21_FORMAL_CLOSURE`: PENDING #21J-B-R AND MERGE** - Roadmap #21 is not yet formally `COMPLETE_ON_MAIN` until #21J-B's independent review passes, its PR is standard-merged, and natural post-merge CI is verified on the exact merge commit.

## Roadmap #22/23-F0 — Shared QA Generation Foundation

A shared, versioned, strictly validated `RequirementModel` / `TestCaseModel` /
`AutomationCandidate` / `AutomationPlan` v1 contract layer
(`scripts/ai/generation/`), frozen before the two future streams named above
(`#22 AI Test Design`, `#23 AI Test Automation`) begin, so neither can
independently invent an incompatible data model. See
[docs/qa-generation-contracts-v1.md](docs/qa-generation-contracts-v1.md) for
the full design: grounding/provenance, project isolation, cross-model
reference validation, safe repository paths, and the v1 freeze policy. This
foundation defines data contracts only - it calls no AI provider, runs no
browser, and performs no filesystem mutation; it does not itself implement
requirements ingestion, test design, or test automation.
