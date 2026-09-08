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
| #21J-B - Roadmap #21 documentation closure | COMPLETE_ON_MAIN |

This document consolidates controls already implemented and independently verified through #20A-#21J-A. It does not add DLP, PII detection, new secret scanning, provider-retention enforcement, error-stack sanitization, or new prompt-injection controls - see [§16](#16-known-limitations--non-goals) for what remains explicitly out of scope. **§21-§29 below cover a separate pipeline (Roadmap #22/#23) with its own, materially different authority model - filesystem mutation and child-process execution, neither of which the controls above address.**

## 21. AI Test Design & Test Automation pipeline (#22/#23)

Everything above this section (§1-§20) describes the **CI failure-triage pipeline** (Roadmap #1-#21): reactive, read-only with respect to the repository, and bounded to producing a PR comment. It never writes a file and never spawns a test-runner process.

This section and §22-§29 describe a **separate, later pipeline** - Roadmap #22 (AI Test Design) and Roadmap #23 (AI Test Automation), implemented in `scripts/ai/test-design/`, `scripts/ai/generation/`, and `scripts/ai/test-automation/`. Unlike the triage pipeline, this pipeline is generative: starting from evidence about desired behavior, it proposes new requirements and test cases (#22), and - only after an explicit human approval step - proposes, and then safely applies and controlled-executes, new automated test code (#23). Two authorities are new to this pipeline and did not exist in the codebase before it:

- **Filesystem-mutation authority (#23F)** - `change-set-application.js` is the first and only module in the codebase permitted to write to the repository filesystem. See [§24](#24-filesystem-mutation-authority-23f).
- **Generated-test-execution authority (#23G)** - `controlled-execution.js` is the first and only module permitted to spawn a child process whose target file is influenced by AI-generated, human-reviewed content. This is distinct from a narrower, pre-existing, read-only use of `child_process` in the older triage pipeline (`collect-context.js`, `execFileSync("git", ...)`, fixed binary and fixed arguments, no AI-influenced input, no execution of generated code) - see [§25](#25-controlled-execution-authority-23g) for the precise distinction.

See [README.md](README.md#ai-test-design--test-automation-2223) for the stage-by-stage functional description; this document covers only the security-relevant authority and trust boundaries.

## 22. Authority escalation model

Authority increases monotonically along the pipeline and only two transitions require a human decision:

| Stage | Authority | Human gate before proceeding? |
|---|---|---|
| #22B-#22E, #23B-#23D | Read evidence/repository context, propose data (`RequirementModel`/`TestCaseModel`/`AutomationPlan`/generated change set) | No - proposal only, no mutation |
| #22F | Human reviews proposed test **design** | **Yes** - digest-bound review record required before #23 can consume it |
| #23E-gen / #23E | Human reviews proposed **generated code** (the concrete change set) | **Yes** - digest-bound review record required before #23F can apply it |
| #23F | Apply the approved change set to the real filesystem | No further human gate - approval already granted at #23E |
| #23G | Execute the applied test via a child process, capture evidence, optionally regenerate once | No further human gate - approval already granted at #23E |

No stage in this pipeline has git or GitHub authority (no commit, push, branch, or PR/issue mutation capability) - confirmed by the absence of any such call in `scripts/ai/test-automation/` and by that module's own negative-assertion tests.

## 23. Human review boundary (#22F / #23E)

Both human-review records (`scripts/ai/test-design/test-design-review-record.js` for #22F, `scripts/ai/test-automation/generated-change-set-review-record.js` for #23E) bind the reviewed artifact and the reviewer's decision into a SHA-256 content digest, and both carry the same explicit self-documented limitation, verbatim in both files: **"INTEGRITY IS NOT AUTHENTICITY."**

A matching digest proves only that the record's own fields were not altered after being sealed. It does **not** prove:
- that the named reviewer is who they claim to be (no identity/authentication check backs the reviewer field) - tracked as `FUTURE_REVIEWER_IDENTITY_PROVENANCE_GUARD`;
- that a human actually made the decision, as opposed to the field being populated some other way - tracked as `FUTURE_HUMAN_DECISION_PROVENANCE_GUARD`.

Both guards remain **open**; see [§28](#28-open-future_-guard-register) for the canonical register. Any claim that this pipeline "requires human approval" should be read as "requires a digest-sealed review record asserting approval," not as a claim of verified human/reviewer identity.

## 24. Filesystem mutation authority (#23F)

`scripts/ai/test-automation/change-set-application.js` is the only module in this repository authorized to write an approved generated change set to the real filesystem. It only runs after an approved #23E review record is supplied, and its writer enforces (per the source, independently re-derivable by reading that file):

- **Containment**: every target path is resolved and re-checked to remain inside the target project root; no write may escape it.
- **Symlink/hardlink defenses**: target paths are checked against symlink/hardlink indirection before the write, not trusted at face value.
- **Repository-root identity binding**: the writer's authority is bound to the ancestor-topology identity of the target repository root (hardened by Roadmap CS2, `stabilization/cs2-rollback-ancestor-topology`), not merely to a target path string - a target-identity-only check would be spoofable by directory-structure manipulation.
- **CREATE/MODIFY-only mutation set**: the change-set contract does not carry a delete/rename operation; the writer applies only file creation and content modification.
- **Rollback on partial failure**: if application of a multi-file change set fails partway through, already-applied files are rolled back, using the same ancestor-topology-bound identity check as the forward application (not just a target-path match) so a rollback cannot be redirected to a different repository sharing a similar path.
- **Residual limitation (explicitly not eliminated)**: a TOCTOU (time-of-check/time-of-use) window between a path's containment/symlink check and the actual write is a known, unclosed limitation of any filesystem-mutation authority of this shape; it is mitigated by the checks above but not eliminated by them.

## 25. Controlled execution authority (#23G)

`scripts/ai/test-automation/controlled-execution.js` is the only module authorized to spawn a child process to run an approved, generated test target. (A separate, pre-existing, narrower use of `child_process` exists in the older triage pipeline - `collect-context.js`'s `execFileSync("git", args, ...)` - invoking only a fixed `git` binary with fixed, read-only arguments for repository metadata; it never executes generated code and has no relation to #23G's authority.) Controlled-execution's controls, per source:

- **`shell:false` always** - the child process is never spawned through a shell, closing the shell-metacharacter-injection class of risk for this call site.
- **Explicit argv construction** - the command and its arguments are built as a discrete array, never a concatenated/interpolated shell string.
- **Closed execution-target classifier map** (`EXECUTION_TARGET_CLASSIFIERS`) - only file patterns the map explicitly recognizes (currently `.cy.js`/`.spec.js`-shaped Cypress/Playwright test files) can be selected for execution; anything else is rejected rather than passed through. The map's coverage is intentionally narrow today - tracked as the open `FUTURE_TARGET_CLASSIFIER_COVERAGE_GUARD` (see [§28](#28-open-future_-guard-register)).
- **Environment allowlist** (`ENV_ALLOWLIST`) - the spawned process does not inherit the full parent environment; only an explicit, closed set of environment variables is passed through.
- **Timeout and output bounds** - execution is bounded by an explicit timeout, and captured stdout/stderr is bounded in size, so neither a hung nor a runaway-output test process can exhaust the caller indefinitely.
- **Two-layer authority model - explicitly NOT a sandbox**: the orchestrator module (`controlled-execution.js`) itself has no shell, git, or network authority beyond spawning the one classified process. But the test framework binary it launches (Cypress or Playwright), and any generated test/support code that framework subsequently loads and runs, executes with the **full authority of the host OS process** - the same authority any locally-run `npx cypress run` would have. Constraining *what* gets launched (the classifier map) and *how* (argv/env/shell:false) does not constrain what a framework or generated test does once it is running. This is a deliberate, explicitly-documented design boundary, not an oversight.
- **Bounded regeneration** - see [§26](#26-bounded-regeneration).

## 26. Bounded regeneration

`scripts/ai/test-automation/regenerate-change-set.js` allows exactly one automatic regeneration attempt (`MAX_REGENERATION_ATTEMPTS = 1`) when a controlled execution (#23G) fails. This bound is enforced **per call**, not across sessions or process restarts - re-invoking the pipeline from scratch (e.g., in a new run) is a new call and is not itself blocked by a prior attempt. Do not read this constant as a durable, cross-session rate limit; it bounds retry behavior within a single automation attempt only.

## 27. Windows execution limitation (`FUTURE_WINDOWS_EXECUTION_CAPABILITY_GUARD`)

Controlled execution (#23G, [§25](#25-controlled-execution-authority-23g)) does not run on Windows hosts today. The `shell:false` requirement in §25 is deliberate and load-bearing for security, but on Windows it collides with a Node.js `child_process` limitation: resolving a `.cmd`-shim binary (how locally-installed Cypress/Playwright executables are exposed on Windows) without a shell surfaces as an `EINVAL` spawn error. The affected automated tests are explicitly **skipped** on Windows (not silently passed, and not falsely reported as green) while this remains unresolved.

This limitation is tracked under the canonical guard name **`FUTURE_WINDOWS_EXECUTION_CAPABILITY_GUARD`**. It is open. Closing it would require either a Windows-safe way to resolve/execute the shimmed binary without reintroducing shell interpretation, or an explicit, reviewed decision to accept a narrower `shell:true` surface on Windows only with compensating controls - neither has been implemented or decided as of this writing.

## 28. Open `FUTURE_*` guard register

This is the canonical list of open (unresolved) forward-looking guards referenced by name elsewhere in this pipeline's source and in this document. A guard listed here has no closing implementation yet; do not treat any of them as resolved based on prose elsewhere.

| Guard | Concern | Where referenced |
|---|---|---|
| `FUTURE_REVIEWER_IDENTITY_PROVENANCE_GUARD` | No authenticated reviewer identity behind #22F/#23E review records | [§23](#23-human-review-boundary-22f--23e); `test-design-review-record.js`, `generated-change-set-review-record.js` |
| `FUTURE_HUMAN_DECISION_PROVENANCE_GUARD` | No proof a human (vs. some other actor) made the #22F/#23E decision | [§23](#23-human-review-boundary-22f--23e); `test-design-review-record.js`, `generated-change-set-review-record.js` |
| `FUTURE_TARGET_CLASSIFIER_COVERAGE_GUARD` | `EXECUTION_TARGET_CLASSIFIERS` covers only `.cy.js`/`.spec.js`-shaped files today | [§25](#25-controlled-execution-authority-23g); `controlled-execution.js` |
| `FUTURE_WINDOWS_EXECUTION_CAPABILITY_GUARD` | Controlled execution (#23G) does not run on Windows | [§27](#27-windows-execution-limitation-future_windows_execution_capability_guard) |
| `FUTURE_FRAMEWORK_CAPABILITY_PROVENANCE_GUARD` | Framework capability is a trusted, unverified caller declaration (see below) | `generated-change-set.js`, `scoring-v6.js` |

**`FUTURE_FRAMEWORK_CAPABILITY_PROVENANCE_GUARD` (open):** the framework identity/capability an `AutomationRepositoryContext` carries (e.g. `repositoryContext.framework`, and the labeled `frameworkCapability` fixture `scoring-v6.js`'s evaluator scores against) is supplied to and validated for structural consistency by the pipeline, and constrains what #23C/#23D can generate against - **currently guaranteed**. It is **not** independently authenticated against the real repository/runtime environment - **not guaranteed**: a caller could in principle supply a framework declaration the actual project doesn't back, and nothing in #22/#23 objectively verifies it against live repository state. This is deferred for the same reason `FUTURE_REVIEWER_IDENTITY_PROVENANCE_GUARD` is deferred: closing it requires a dedicated provenance/authentication design, not an incidental patch. It would be triggered by the same future orchestration work that would close the reviewer-identity and human-decision guards above.

A small number of guards named in earlier design discussion for this pipeline (covering generated-change-set review-package structure and change-set re-validation) were closed by the #23E/#23F implementations themselves and are intentionally omitted from this open register; they are not tracked here because there is no remaining open concern to point a reader at.

## 29. #22/#23 security roadmap status

| Stage | Status |
|---|---|
| #22/23-F0 - Shared generation contracts (`scripts/ai/generation/`) | COMPLETE |
| #22B-#22F - AI Test Design, incl. human review boundary | COMPLETE |
| #23B-#23E - Automation planning, generated change set, human review boundary | COMPLETE |
| #23F - Safe filesystem application (containment, symlink defense, ancestor-topology identity binding, rollback) | COMPLETE_ON_MAIN |
| #23G - Controlled execution (`shell:false`, closed classifier map, env allowlist, bounded regeneration) | COMPLETE_ON_MAIN (Windows execution unsupported - see [§27](#27-windows-execution-limitation-future_windows_execution_capability_guard)) |
| CS1-CS4 - Post-#23G stabilization (CI-authority hardening, rollback ancestor-topology hardening, supply-chain hardening, recursive test-discovery correctness) | COMPLETE_ON_MAIN |

This section reflects the state of the #22/#23 pipeline as of this document's own reconciliation pass. It carries the same limitation as §20: it does not add DLP, PII detection, new secret scanning, provider-retention enforcement, or new prompt-injection controls beyond what §1-§19 already establish for the shared provider-abstraction layer.
