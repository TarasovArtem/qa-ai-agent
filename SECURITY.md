# Security, Privacy, and AI Data Governance

This document describes the security, privacy, and AI-data-governance controls that exist in this repository's QA Agent **today**, as verified directly against the current source. It does not describe aspirational controls, and it does not claim protections that are not actually implemented.

It is written for a new maintainer who needs to answer, without reading every file first: what data can reach an external AI provider, what is excluded, what stays local/CI-only, how credentials are handled, and what this system deliberately does not guarantee.

## 1. Purpose and scope

This document covers the QA Agent pipeline under `scripts/ai/` - context collection, the AI prompt/provider boundary, History and Knowledge, and the artifacts GitHub Actions persists around a CI run. It does not cover the Cypress E2E suite's own behavior against the external SUT, and it does not cover GitHub's or any AI provider's own platform security - both are outside this repository's technical enforcement boundary (see [§18](#18-provider-side-retention)).

Everything here reflects Roadmap #20A (baseline audit), #20B (model-visible trust-boundary hardening), and #20C (independent review) - already implemented and independently verified. This document does not introduce any new runtime control.

## 2. Trust model

Every value that reaches the AI pipeline falls into one of these categories. "Trusted" here describes **instruction/control provenance** - i.e. whether application code treats a value as something it may act on structurally - never a guarantee that the value is free of secrets or sensitive content.

| Category | Meaning | Examples |
|---|---|---|
| `TRUSTED_STATIC_CONFIG` | Fixed, repository-defined values application code trusts structurally | `PROMPT_METADATA_ALLOWLIST`, `ProjectProfile`, provider configuration keys |
| `TRUSTED_REPOSITORY_CODE` | Code and committed config this repository owns and controls the shape of | `cypress.config.js`, `package.json`, spec/page-object source read into `relevantFiles` |
| `UNTRUSTED_TEST_RUNTIME_DATA` | Data produced by a test run - error messages, stack traces, screenshots | Cypress/Playwright failure output |
| `UNTRUSTED_EXTERNAL_SUT_DATA` | Content originating from the external application under test | Anything the SUT renders/returns that ends up embedded in an error, DOM assertion, or screenshot |
| `UNTRUSTED_PROVIDER_OUTPUT` | The AI provider's own response text | The raw string `provider.analyze()` resolves with, before validation |
| `SECRET` | Values that must never appear in a prompt, report, or log | `AI_API_KEY`, `GITHUB_TOKEN`/`GROQ_API_KEY` |

**Repository code being "trusted" does not mean it cannot contain a secret.** A committed file under `cypress/` (an allowed `relevantFiles` path) is trusted as *instruction-free data*, but nothing scans its content for an accidentally committed credential before it becomes model-visible - see [§6](#6-sourcerelevant-file-evidence) and [§16](#16-known-limitations--non-goals).

## 3. What is sent to AI providers

A provider only ever receives `provider.analyze({ systemPrompt, userPrompt })` (`scripts/ai/providers/*`). `userPrompt` is a single JSON payload built by `buildUserPrompt()` (`scripts/ai/qa-agent-prompt.js`) containing, at most:

- **Allowlisted metadata**: `browser`, `ci`, `commit`, `branch`, `event`, `framework` - nothing else, even if `context.metadata` carries other fields (see [§4](#4-what-is-explicitly-excluded)).
- **`testResults`** - aggregate pass/fail counts and per-spec stats, never full test source.
- **`failedTests`** - positively projected per-failure evidence (see [§5](#5-model-visible-failure-evidence)).
- **`relevantFiles`** - allowlisted, size-capped source content (see [§6](#6-sourcerelevant-file-evidence)).
- **`collectorWarnings`** - short diagnostic strings the collector emitted about its own run (e.g. a missing report directory), never file content.
- **`history`** - four aggregate counters, never raw run data (see [§7](#7-history-and-knowledge-minimization)).
- **`knownProjectConstraints`** - short, static, human-written facts from `ProjectProfile` (see [§8](#8-project-and-ci-provenance)).
- **`browserCorrelation`** - deterministic, code-computed **same-framework** metadata (which browsers of the primary's own framework failed/passed, whether their failures share a signature) - explicitly re-projected field-by-field (`correlation-projection.js`, Roadmap #21H, D21G-3), never a bulk spread of the underlying object.
- **`frameworkCorrelation`** - a separate, smaller, deterministic, code-computed object stating only whether each framework present in the workflow's jobs, as a whole, passed or failed (`{primaryFramework, outcomes: [{framework, outcome}]}`) - **workflow-level evidence only, never same-test evidence**; likewise explicitly re-projected field-by-field, never a bulk spread.
- **`relevantKnowledge`** - curated `{id, statement}` pairs (see [§7](#7-history-and-knowledge-minimization)).

`systemPrompt` (`buildSystemPrompt()`) is a fixed persona/instruction template parameterized only by `ProjectProfile.displayName` and the current framework id - it never embeds runtime evidence.

## 4. What is explicitly excluded

The following are deliberately **not** part of any model-visible payload, even though they exist elsewhere in this repository's data:

- **`projectId`, `repository`, `runId`** - present on `context.metadata` and persisted to `context.json`/`ai-report.json`'s `sourceContext`, but excluded from `PROMPT_METADATA_ALLOWLIST` and therefore never sent to a provider.
- **Unknown `failedTests` extras** - any field an adapter attaches beyond `title`/`fullTitle`/`specFile`/`error`/`duration`/`screenshot` (e.g. Cypress's `suite`/`status`, Playwright's `projectId`/`projectName`) is dropped at the prompt-projection boundary (`projectPromptFailure()`), never sent - see [§5](#5-model-visible-failure-evidence).
- **Unknown nested `error` extras** - `projectPromptError()` reads only `message`/`stack`; any other property on a failure's `error` object is dropped.
- **Credentials** - `AI_API_KEY`, `GITHUB_TOKEN`/`GROQ_API_KEY` are never placed into `systemPrompt`, `userPrompt`, or any persisted report field.
- **History's internal bookkeeping** - `available`, `reason`, `projectId`, `framework`, `branch`, `generatedAt` are read from `history.json` but stripped before `context.history` is set; only the four aggregate counters survive (see [§7](#7-history-and-knowledge-minimization)).
- **Screenshot binaries** - only a screenshot's file *path* can appear in `failedTests[].screenshot`; the image itself is never read into the request (path field: [§5](#5-model-visible-failure-evidence); artifact persistence of the actual image: [§14](#14-github-actions-artifacts)).

## 5. Model-visible failure evidence

`buildUserPrompt()` maps every entry in `context.failedTests` through `projectPromptFailure()` (`scripts/ai/qa-agent-prompt.js`) instead of serializing the raw adapter object. This is a **positive projection**: only named fields are ever read into a new object - no spread, no `Object.assign`, no JSON round-trip of the source object.

Allowed top-level fields: `title`, `fullTitle`, `specFile`, `error` - plus `duration`/`screenshot` **only when the source object genuinely has that own property** (an own-property check, not a truthiness check, so `duration: 0` and `screenshot: null` are preserved with their real semantics, never silently dropped).

Allowed nested `error` fields: `message`, `stack`.

Adapter-added extras (Cypress's `suite`/`status`; Playwright's `projectId`/`projectName`) are **not deleted from the underlying data** - they remain on `context.failedTests`, in `context.json`, and in any GitHub Actions artifact that includes it. They are excluded only from the model-visible projection. This distinction matters for anyone adding a new adapter field in the future - see [§17](#17-requirements-for-future-integrations).

## 6. Source/relevant-file evidence

`collect-context.js`'s `buildRelevantFiles()` applies a **framework-aware allowlist** (`RELEVANT_FILES_POLICIES`, Roadmap #21C) - the active framework's own policy is selected by `context.metadata.framework`, never a single global allowlist:

- **Cypress**: only files under `cypress/`, plus exactly `cypress.config.js` and `package.json`.
- **Playwright**: only files under `playwright/`, plus exactly `playwright.config.js` and `package.json`.
- **Filename/path denylist** (both policies): any path matching `/(^|[\\/])\.env|secret|credential|\.pem$|\.key$|token/i` is rejected, even if it would otherwise be under an allowed directory.
- **Per-file size cap**: 20 KB (`MAX_FILE_BYTES`); larger files are truncated with a trailing marker, never silently expanded.
- **Total-payload size cap**: 150 KB (`MAX_TOTAL_RELEVANT_BYTES`) across all `relevantFiles` combined; once reached, further files are skipped with a recorded warning rather than exceeding the cap.
- **Canonical, realpath-based containment**: a candidate path (Cypress spec path, or a Playwright reporter-provided spec path re-rooted under `playwright/` per the policy's `resolveSpecCandidates()`) is re-verified against its real, symlink-resolved on-disk location before being read - a symlink pointing outside its allowed directory is rejected, never silently followed (Roadmap #21D, R1). This containment check uses segment-aware, platform-appropriate path semantics (case-insensitive on Windows, case-sensitive on POSIX) - never a naive lowercase-prefix string comparison, which cannot distinguish a genuine child directory from a same-prefix sibling (Roadmap #21I-A, D21D-3).

**There is no general content-based secret scanner for `relevantFiles`.** The allowlist/denylist above are path- and filename-based only - they do not inspect file *content* for a credential-shaped string. Consequently: **no secret may be committed into any file under an allowed path (for either framework)**, since anything there can legitimately become model-visible. This is a repository-discipline requirement, not something this pipeline enforces technically.

## 6a. Attachment (screenshot) evidence

A reporter-supplied attachment path (currently: Playwright's own failure screenshot) is usable only when it names a real, ordinary, canonically-repository-local file (`scripts/ai/context-utils.js`'s `resolveSafeLocalAttachmentPath()`, Roadmap #21D, R3):

- A URL, UNC path, `file:` scheme, traversal-like path, or foreign-OS absolute path is rejected outright - never resolved against the filesystem.
- The candidate is resolved to its real, symlink-following on-disk location and re-verified as canonically inside the repository - a repo-local-looking symlink whose real target escapes the repository is rejected; a repo-local symlink to another repo-local file is accepted, but the value recorded is the **target's** own canonical path, never the symlink's own lexical path.
- Only an existing, ordinary regular file is accepted - a missing path fails safely (treated as "no attachment," not an error); a directory is rejected.
- **No remote fetch, no attachment-body decoding, and no out-of-root materialization or copy ever happens.** Only a bounded, repo-relative path *string* is ever produced - never the file's binary content read into the request (see [§5](#5-model-visible-failure-evidence) and [§4](#4-what-is-explicitly-excluded) for what that string is, and is not, used for downstream).

## 7. History and Knowledge minimization

**History** (`collect-history.js` → `readHistory()` in `analyze-failure.js`): the only fields that ever reach `context.history` (and therefore the prompt) are `runsConsidered`, `passes`, `failures`, `retryPasses` - four integers, each independently validated (`isValidHistoryMetrics()`, Roadmap #21J-A, D21H-2) as a finite non-negative integer, with `passes + failures === runsConsidered` and `retryPasses <= passes` - invariants the real collector already guarantees structurally, enforced again at this boundary as defense-in-depth. A record failing validation is treated as unavailable (`null`), the same outcome as a missing file or an `available:false` marker - never synthesized as a fabricated zero-history object. The full `history.json` record (including `projectId`, `framework`, `branch`, `generatedAt`, `available`) is read for eligibility checks (project/framework namespace matching, so History from a different project or framework can never influence an unrelated analysis) but never itself serialized into the prompt.

History is **framework-scoped as well as project-scoped**: `collect-history.js` runs for both Cypress (targeting each browser's own `Cypress - <browser>` GitHub Actions job) and Playwright (targeting the `Playwright Chromium` job), each writing an explicit `framework` field sourced from the active adapter's own `.id` - never a duplicated literal. A legacy pre-framework-namespace record (no `framework` field at all) remains usable only for a current Cypress analysis; a Playwright analysis can never inherit it.

**Knowledge** (`scripts/ai/knowledge/`): a static, repository-committed, schema-validated corpus (`scripts/ai/knowledge/units/*.json`). Selection (`selectKnowledge()`) is deterministic, offline, and pre-provider - it never calls a model. Only `{id, statement}` is ever surfaced to the prompt for a selected unit; every other field on a unit (`category`, `sourceType`, `source`, `tags`, `appliesTo`, `priority`) stays internal selection machinery. There is no external Knowledge fetching of any kind.

## 8. Project and CI provenance

`ProjectProfile` (`scripts/ai/project-profile.js`) owns exactly `id`, `displayName`, `knownProjectConstraints`:

- `displayName` **is** model-visible - it fills the system prompt's persona sentence.
- `knownProjectConstraints` **is** model-visible - short, static background facts, sent as guidance only (never current-run evidence, per the system prompt's own rule 9).
- `id` (the internal, stable project namespace) is **not** model-visible through the metadata prompt boundary. It is retained for local/CI provenance: `context.metadata.projectId`, `ai-report.json`'s `sourceContext.projectId`, and `history.json`'s `projectId` (used only for the eligibility gate described in [§7](#7-history-and-knowledge-minimization)).

This is the same **provider-visible data vs. local/CI audit provenance** distinction that applies throughout this document: a field's presence in `context.json` or `ai-report.json` does not imply it was ever sent to a provider.

## 9. Credentials and provider authentication

| Variable | Used by | Purpose |
|---|---|---|
| `AI_API_KEY` | `scripts/ai/config.js` → provider constructors | Generic, provider-neutral credential input at the **configuration** layer only. `config.js` never reads an endpoint URL, request format, or auth header/scheme - it only resolves this value from `process.env` and hands it to whichever provider is selected. The actual HTTP authentication **transport** is decided entirely by that provider's own implementation, and is not uniform across providers - see the Groq/Gemini rows below. |
| `AI_MODEL` / `AI_PROVIDER` | `scripts/ai/config.js` | Configuration, not secret - safe to log |
| `GITHUB_TOKEN` | `scripts/ai/collect-history.js` | Separate GitHub API credential, unrelated to `AI_API_KEY` - sent as an `Authorization: Bearer <token>` header for read-only GitHub Actions history API calls |
| `GROQ_API_KEY` (GitHub Actions secret) | `.github/workflows/cypress.yml` | The GitHub Actions repository secret backing the current Groq CI path only - not itself the generic provider-contract variable. The workflow maps it to `AI_API_KEY` (`AI_API_KEY: ${{ secrets.GROQ_API_KEY }}`) before `GroqProvider` ever sees it; application code never references Groq's name directly |

**`AI_API_KEY`'s actual HTTP authentication mechanism is provider-specific, not universal:**

- **Groq** (`groq-provider.js`) sends it as `Authorization: Bearer <apiKey>`.
- **Gemini** (`gemini-provider.js`) sends it as `x-goog-api-key: <apiKey>` - a materially different header, **not** `Authorization: Bearer`. No `GEMINI_API_KEY` repository secret or workflow step exists today; Gemini receives the same generic `AI_API_KEY` value as Groq would, through the same configuration layer, whenever `AI_PROVIDER=gemini` is set locally.
- A future third provider is free to use yet another mechanism - the configuration layer (`AI_API_KEY`) never dictates or constrains it.

All of the above are read from `process.env` and used exclusively as HTTP header values in their own dedicated request. None of them is intentionally written into `systemPrompt`, `userPrompt`, `context.json`, `ai-report.json`, `history.json`, or any `console.log`/`console.error` call in this codebase - `analyze-failure.js`'s own module comment states this as an explicit rule ("Never add `AI_API_KEY` ... to this or any other log line in this file"). This is a code-review-enforced convention, not a runtime secret-scanner - see [§16](#16-known-limitations--non-goals).

A missing/invalid `AI_API_KEY` fails a real provider's construction with a `CONFIGURATION`-coded error (no silent fallback to `MockProvider`); this is why a fork PR (which never receives `GROQ_API_KEY`) shows "AI analysis unavailable" rather than a fabricated result.

## 10. Provider selection and retry governance

`provider.analyze({ systemPrompt, userPrompt }) → Promise<string>` (`scripts/ai/providers/provider-contract.js`) is the entire boundary. A provider implementation owns transport/auth/vendor envelope only; it must never independently gather repository or CI context beyond what it is handed.

Supported implementations today: `MockProvider` (no network, used for local dev and all tests), `GroqProvider` (the only provider currently wired into GitHub Actions), `GeminiProvider` (implemented and real-API-verified, **not** CI-wired - no repository secret exists for it). The default (`AI_PROVIDER` unset) is `mock`.

One provider is selected once per logical analysis (`createProvider()`). `runProviderAnalysis()` retries up to **3 attempts** (`maxAttempts`, the current source default) against that **same** provider, only when the failure is marked `retryable`. **There is no cross-provider fallback anywhere in this codebase** - a misconfigured or failing provider fails the analysis honestly.

**Governance implication, stated plainly**: a retryable transport failure means the same evidence (the same `systemPrompt`/`userPrompt`) may be transmitted more than once to the same provider within one logical analysis. This is not hidden by the retry mechanism, and is an inherent consequence of retrying at all.

## 11. Prompt-injection trust boundary

The system prompt contains an explicit, dedicated section instructing the model that everything under `failedTests`, `relevantFiles`, `testResults`, `history`, `knownProjectConstraints`, `browserCorrelation`, `frameworkCorrelation`, `relevantKnowledge`, and any error/stack/DOM/source text is **DATA, not instructions** - including text that looks like an instruction (e.g. a fixture saying "ignore previous instructions"). This boundary was unchanged by Roadmap #20B; `frameworkCorrelation` was added to the explicit list when that field itself was introduced (Roadmap #21G-C1), following the same "every field the model reasons over must be explicitly named here" convention.

This is a **defensive instruction that reduces risk**. It does **not** eliminate the inherent prompt-injection risk of handing an LLM untrusted text, and this document makes no claim that prompt injection is solved or structurally impossible.

## 11a. Framework identity consistency and error-evidence boundaries

**Framework identity fail-closed check** (`checkFrameworkIdentityConsistency()` in `aggregate-browser-context.js`, Roadmap #21H/#21J-A, D21G-2/D21H-1): the workflow's own trusted framework descriptor (a static literal each job block writes, e.g. `"framework": "playwright"`) and the adapter-derived runtime identity (`context.metadata.framework`, sourced from `adapter.id`) are two independently-derived statements about the same job's framework identity. If a genuinely comparable context exists and the two disagree - including when the adapter-derived value is present but malformed (non-string, empty, or otherwise unusable, distinct from a genuinely-absent value) - this fails closed: no primary context is selected, no `context.json` is written, and the provider is never called. This is a consistency check, never a resolution rule; neither identity is ever silently preferred over the other. In real production, both values are drawn from a small, hardcoded, closed set (`cypress`/`playwright` workflow literals; `cypressAdapter.id`/`playwrightAdapter.id` via a frozen adapter map) - a genuinely unsupported framework string reaching either side has no real production code path today.

**`error.stack` is deliberately model-visible failure evidence.** `projectPromptError()` (`qa-agent-prompt.js`) projects `error.message` and `error.stack` verbatim, by design - this is the same explicit, positive-projection boundary described in [§5](#5-model-visible-failure-evidence), and it deliberately allows `message`/`stack` content while excluding any unknown error-object extra. A real stack trace can contain a standard, deterministic hosted-CI-runner absolute source path (e.g. GitHub Actions' own `/home/runner/work/<repo>/<repo>/...` convention) - **this is not a secret, a credential, or a real person's home directory**; it is a fixed, public convention identical for every run on a public repository, and it has directly contributed to correct failure-classification grounding (an exact source line reference) in real, independently-reviewed evidence. This document makes **no claim** that all absolute paths are stripped or sanitized before a provider sees `error.stack` - that would be false. This is accepted under the existing error-stack contract as a deliberate, documented boundary, not an oversight; a future stack-sanitization change, if ever pursued, would be a dedicated design effort, not an incidental patch (see [§16](#16-known-limitations--non-goals)).

## 12. Provider-output validation and policy enforcement

A provider's raw response string is never trusted directly. Before anything is written to `ai-report.json`:

1. **Contract validation** (`provider-contract.js`) - the response must be a non-empty string.
2. **JSON parsing** (with defensive code-fence stripping) - a non-parsing response is a validation failure, not a transport failure, and is not retried.
3. **Structural/field validation** (`validateAnalysisItem()`) - `classification` must be one of the fixed enum values; `confidence` must be a finite number in `[0, 1]`; `summary`/`rootCause` must be non-empty strings; `evidence` must be an array of strings; `recommendedFix` must be `null` or an object with a string `description`; `shouldCreateBug`/`shouldRetry` must be booleans.
4. **Deterministic policy** (`scripts/ai/agent-policy.js`) - only a `PRODUCT_BUG` classification may keep a model-recommended `shouldCreateBug: true`; every other classification is forced to `false`, regardless of what the model returned.

**This repository does not automatically create external bugs/issues from a model recommendation.** `shouldCreateBug` is a field a human reads and acts on; the only automated GitHub write this pipeline performs is upserting a single PR comment (`pr-comment-client.js` uses only the comments API, never issue creation).

## 13. Logs and persisted artifacts

Application code does not intentionally log prompt content, file contents, or any credential to a normal AI status log line (`[ai:analyze]`/`[ai:collect]`/`[ai:policy]` messages log only provider/model names, counts, and file paths). This is a statement about what the code intentionally does, not a guarantee that no dependency or platform log could ever capture more.

Three JSON artifacts matter, and they are **not equally sensitive**:

- **`reports/ai/context.json`** - the *full* internal collector output: complete `failedTests` objects (including every adapter-added extra), full `relevantFiles` content, and full metadata (including `projectId`/`repository`/`runId`). This is **more sensitive than the provider-visible prompt** - it is report-only provenance, never itself sent to a provider wholesale.
- **`reports/ai/history.json`** - the full History aggregate, including `projectId`/`framework`/`branch`, before the four-counter reduction described in [§7](#7-history-and-knowledge-minimization).
- **`reports/ai/ai-report.json`** - the final report: validated/policed model results plus `sourceContext` (includes `projectId`/`repository`/`runId`/`branch`/`commit`) and provenance (`providerAttempts`, sanitized `firstAttemptError`).

**Provider privacy is not the same guarantee as artifact privacy.** A field excluded from the prompt can still be present in these files, and these files are uploaded as CI artifacts (see [§14](#14-github-actions-artifacts)).

## 14. GitHub Actions artifacts

Per `.github/workflows/cypress.yml`, uploaded artifact categories are:

- `cypress-screenshots-<browser>` (on failure only)
- `cypress-videos-<browser>` (always)
- `cypress-report-<browser>` (on failure only) - raw Cypress/Mochawesome JSON
- `qa-triage-input-<browser>` (always) - `reports/ai/` (context/history/browser-result) for the triage job to consume
- `playwright-report` (always) - the raw Playwright JSON reporter output plus `test-results/` (including any failure screenshot), uploaded directly by the `Playwright Chromium` job
- `ai-report` (when any leg failed) - the final `context.json`/`history.json`/`ai-report.json` for the selected primary failure, across either framework
- `firefox-forensics` (Firefox failures only) - see [§15](#15-firefox-forensics)

None of these except `firefox-forensics` sets an explicit `retention-days` value in the workflow. **Retention for every other artifact category follows this repository/organization's platform-level default configuration and is not itself governed by this AI module.** Do not assume a specific number of days without checking the repository's own Actions settings.

## 15. Firefox forensics

The temporary `scripts/diagnostics/firefox-failure-forensics.sh` (Roadmap #19.7F-B4B, active while Firefox's intermittent `poi_data_requests.cy.js` failure signature remains under investigation) generates diagnostic files, then runs a dedicated pass that scans **every file it itself generated** for a sensitive-pattern regex (`authorization|bearer|token|apikey|api_key|secret|cookie|set-cookie`) and deletes any flagged file before the `firefox-forensics` artifact is uploaded. `firefox-forensics` sets an explicit `retention-days: 7`.

**This content-level scan is scoped to the Firefox forensics artifact only.** It does not apply to `cypress-screenshots-*`, `cypress-videos-*`, `cypress-report-*`, or any `ai-report`/`context.json` content - do not generalize this one protection to the rest of the pipeline's artifacts (see [§16](#16-known-limitations--non-goals)).

Firefox's underlying root cause remains **under investigation, not solved**: observability (`#19.7F-B4B`) is active on `main` and has now been live-validated by one organic occurrence (captured during a documentation PR's own CI run, `32873480322` - the corrected capture pipeline uploaded its `firefox-forensics` artifact cleanly, with nothing flagged by the sensitive-pattern scan). This validates forensic **capture**, not root-cause **determination**: `#19.7F-C`'s established status - this exact failure family (`poi_data_requests.cy.js`/`cy.wait("@poiTiles")`) confirmed by an earlier organic review, root cause left inconclusive - is unchanged by this new occurrence, which is a second instance of that same known family rather than a first-ever analysis. This document makes no root-cause claim.

## 16. Known limitations / non-goals

Stated plainly, as transparency, not as reopened defects:

- **No general PII detector.** No component in this pipeline identifies or redacts personal data before it becomes model-visible or is persisted.
- **No full content-level DLP.** Path/filename allowlisting and size caps ([§6](#6-sourcerelevant-file-evidence)) are not a substitute for scanning file *content* for sensitive data.
- **`error.stack` may contain a standard hosted-runner absolute source path.** This is deliberate, documented model-visible evidence, not sanitized - see [§11a](#11a-framework-identity-consistency-and-error-evidence-boundaries). No secret, credential, or real user identity has been found in it.
- **A theoretical, structurally-unreachable framework-identity edge case exists.** The identity-consistency check ([§11a](#11a-framework-identity-consistency-and-error-evidence-boundaries)) validates agreement between two values, not membership in a canonical `{cypress, playwright}` set - in principle, two equal-but-unsupported framework strings could pass it. Every real production producer of either value is a small, hardcoded, closed set today, so this has no real production code path; it is recorded here for transparency, not as an open vulnerability.
- **No perfect prompt-injection guarantee.** The defensive system-prompt instruction ([§11](#11-prompt-injection-trust-boundary)) reduces risk; it does not eliminate the inherent risk of handing an LLM untrusted text.
- **No global assembled-prompt size ceiling.** `relevantFiles` has its own per-file and total caps, but the fully assembled `userPrompt` (metadata + testResults + failedTests + relevantFiles + history + knowledge + correlation) has no single combined byte/character limit today.
- **Provider-side data retention is not technically controlled by this repository** - see [§18](#18-provider-side-retention).
- **GitHub Actions artifacts may contain test/SUT/source evidence** beyond what any provider ever saw - see [§13](#13-logs-and-persisted-artifacts).
- **`relevantFiles` relies on repository discipline, not automated enforcement**, to keep credentials out of files under its allowed paths - see [§6](#6-sourcerelevant-file-evidence).
- **Future framework/provider integrations require a renewed boundary review** before enabling anything new in production - see [§17](#17-requirements-for-future-integrations).

## 17. Requirements for future integrations

**The single most important governance invariant this document states:**

> Adding a field to an internal adapter result does not make it provider-visible. Provider-visible evidence must be explicitly added at the prompt-projection boundary (`projectPromptFailure()`/`pickPromptMetadata()`), never inferred from what an adapter happens to attach.

A new adapter (framework collector) may attach any internal-only extra field it needs - that is explicitly allowed (`normalized-failure.js` accepts unknown extras by design) - but that field stays internal until someone deliberately extends the projection functions above to include it.

### Future provider rule

A new provider implementation must preserve the `analyze({systemPrompt, userPrompt}) → Promise<string>` contract exactly and must not independently gather repository/CI context beyond what it is handed. Authentication data stays transport-only, scoped to that provider's own request. Cross-provider fallback must never be introduced silently - any change to single-provider-per-analysis behavior is a deliberate, documented decision, not an incidental side effect.

### Playwright production enablement - resolved

`scripts/ai/adapters/playwright-adapter.js` is now wired into real production CI (Roadmap #21), reviewed by the same standard implement → independent-review → merge process as every other stage. Every residual the earlier version of this section pointed to has been addressed: `relevantFiles` is now framework-aware (a Playwright failure reaches the model with real page-object/spec context - [§6](#6-sourcerelevant-file-evidence)); out-of-root/absolute path handling is canonical, realpath-based, and cross-platform ([§6](#6-sourcerelevant-file-evidence), [§6a](#6a-attachment-screenshot-evidence)); attachment locality/materialization is explicit and tested; and real (non-fixture) Playwright JSON-reporter compatibility was proven both by a real-installed-reporter fixture and by one independently-reviewed, real, controlled Playwright failure in natural GitHub Actions CI. This section is kept as a historical pointer to what that enablement effort actually closed, not as an open item.

### Future third-framework/provider integrations

Any future framework or provider addition should be reviewed against the same standard this document already applies to Cypress/Playwright and Mock/Groq/Gemini: explicit adapter boundary, explicit provider-visible projection, no silent fallback, and a dedicated security/privacy review pass before production enablement - not a generic promise that "the architecture is extensible" substitutes for that review.

## 18. Provider-side retention

**Provider-side (or GitHub-platform-side) storage, logging, or retention of data this repository sends is outside this repository's technical enforcement boundary.** This codebase controls what it sends and what it persists locally/in CI artifacts; it does not and cannot control what a selected AI provider or GitHub itself subsequently does with that data. Any retention/deletion guarantee would depend on the specific provider, account, and service terms in effect at call time - none of that is verified or asserted here.

## 19. Provider error sanitization

Both the persisted `firstAttemptError` (in `ai-report.json`) and the terminal, console-surfaced `AnalyzerError` thrown after retry exhaustion route through the same function, `summarizeProviderError()` (`scripts/ai/analyze-failure.js`) - a single, fixed lookup table keyed by a small provider-neutral error-code vocabulary (`AUTH`/`RATE_LIMIT`/`TIMEOUT`/`NETWORK`/`INVALID_RESPONSE`/`CONFIGURATION`/`UNKNOWN`). An unrecognized/unknown code falls back to the same fixed `"Unknown provider error"` message rather than ever touching the underlying error's raw `message` text. This means a raw provider/transport error string - which could otherwise embed request/response detail - is never propagated to either destination, whether or not its code is one this table happens to recognize.

This is not a general-purpose DLP layer over provider network traffic; it is a fixed, closed-set sanitization policy specific to the provider-error path described above.

## 20. Current security roadmap status

| Stage | Status |
|---|---|
| #20A - Security/privacy/governance baseline audit | COMPLETE |
| #20B - Model-visible trust-boundary hardening | COMPLETE |
| #20C - Independent security review | COMPLETE |
| #20D/#20E - Governance documentation + independent review | COMPLETE |
| #21D - Path/attachment security hardening (R1/R2/R3), incl. D21D-3 Windows containment | COMPLETE_ON_MAIN |
| #21G-C1 - browserCorrelation/frameworkCorrelation evidence-semantics separation (D21G-2/D21G-3) | COMPLETE_ON_MAIN |
| #21H/#21J-A - Framework-identity fail-closed hardening (D21G-2, D21H-1), bounded History-metric validation (D21H-2) | COMPLETE_ON_MAIN |
| #21I - Independent controlled Playwright failure evidence proof | COMPLETE (immutable, unmerged evidence PR) |
| #21J-B - This documentation update | READY FOR INDEPENDENT REVIEW (docs-only, pending PR merge) |

This document consolidates controls already implemented and independently verified through #20A-#21J-A. It does not add DLP, PII detection, new secret scanning, provider-retention enforcement, error-stack sanitization, or new prompt-injection controls - see [§16](#16-known-limitations--non-goals) for what remains explicitly out of scope.
