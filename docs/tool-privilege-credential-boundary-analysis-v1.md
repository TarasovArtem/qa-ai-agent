# Tool / Privilege / Credential Boundary Analysis v1

AISEC-3, the third stage of the Agentic Trust & Security Foundation
(Phase D). This is a research/architecture-input document. It refines --
never replaces -- `docs/agentic-threat-model-v1.md` (AISEC-1) and
`docs/prompt-indirect-injection-study-v1.md` (AISEC-2) with a source-grounded
analysis of three related but distinct dimensions: which components can cause
**side effects** (tools), under what **authority tier** they act
(privileges), and what **identity or secret material** they act with
(credentials).

Status: **CURRENT** (research; not an accepted security architecture -- see
[§38 Non-goals and assumptions](#38-non-goals-and-assumptions)).

## 1. Purpose / status

This document answers, with repository evidence: *which components in the
current QA Agent can cause side effects, under whose authority do they act,
what credentials or privilege context do they use, and what deterministic
boundaries prevent an untrusted or model-generated proposal from escalating
into unauthorized action?*

It is static, source-grounded analysis. It does not implement controls,
change any code, test anything against a live external system, read or record
any credential value, or start AISEC-4 through AISEC-7.

## 2. Scope

In scope: every current component in this repository that can perform,
request, or prepare a side effect -- the CI failure-triage pipeline, the RTI
deterministic pipeline (requirement sources and the publishing destination),
the `#22`/`#23` generative pipeline including its review, filesystem-write,
controlled-execution and regeneration modules, the AI provider clients, the
GitHub Actions workflows, and the maintainer diagnostics scripts.

Out of scope: implementing any control; AISEC-4's exfiltration and
cross-project isolation design; AISEC-5's verification strategy and AISEC-7's
harness (verification requirements are defined here, not implemented);
`MEM`/`RAG`/`LEARN` (all `NOT_STARTED`, treated only as future constraints);
any live call against a real external system other than the read-only GitHub
settings and Actions-history reads recorded as point-in-time observations
(section 28); GitHub's or any provider's own platform behavior beyond what this
repository's source and workflow declarations, the cited official GitHub
documentation (GH-01 to GH-21) and those observations state.

## 3. Relationship to AISEC-1 / AISEC-2

AISEC-1 handed AISEC-3 the identity, authorization and confused-deputy
questions (AT-07, AT-16, AT-04, the credential-boundary items in its §20).
AISEC-2 handed forward the authority consequences of its own findings
(PI-04, PI-06 / AT-03, its OQ-1 review-display question) and explicitly kept
reviewer *persuasion* (its scope) distinct from reviewer *authentication*
(this document's scope). This document consumes those handoffs without
treating any inherited risk as remediated, and without changing any canonical
AISEC-1 or AISEC-2 rating.

## 4. Repository baseline

```text
origin/main:                    d50883256ee3b15cce9e82a733e9373a84fce8ae
Architecture Conformance Gate:  COMPLETE_ON_MAIN
AISEC-1:                        COMPLETE_ON_MAIN (docs/agentic-threat-model-v1.md)
AISEC-2:                        COMPLETE_ON_MAIN (docs/prompt-indirect-injection-study-v1.md)
AISEC-3:                        NEXT ACTIVE GATE (roadmap designation) -- this document
AISEC-4..AISEC-7:                NOT_STARTED
MEM/RAG/LEARN:                   NOT_STARTED

Main-movement check: origin/main at mission start == baseline above.
NO_RELEVANT_OVERLAP.
```

## 5. Terminology

- **Tool** -- any component that can perform, request, or prepare a side
  effect. This includes bounded equivalents of LLM tool-calling (filesystem
  writers, subprocess launchers, network clients), not only model-selected
  tools.
- **Privilege** -- the authority tier a component can reach. This document
  reuses the established tiers: `NO SIDE EFFECT`, `READ ONLY`, `PROPOSAL`,
  `REMOTE CREATE` (including remote update), `LOCAL WRITE`, `CODE EXECUTION`.
- **Credential** -- secret or identity material used to act. **Secrecy** (the
  value stays hidden) is distinct from **use authority** (who or what can
  cause the credential to be used). A hidden credential can still be misused
  by a *confused deputy*.
- **Confused deputy** -- a trusted component holding authority acts on an
  attacker-influenced request.
- **Integrity vs authenticity** -- a digest proves content was not altered; it
  does not prove who produced it.
- **Evidence labels** -- `CURRENT` (source-verified), `PLANNED`, `INFERRED`,
  `UNKNOWN`.

## 6. Authority model

Authority increases along the generative pipeline and is exercised only by
library functions that a *caller* invokes:

```text
model output (PROPOSAL only)
   -> validators / deterministic gates (in-process, no identity)
   -> review record (data structure; reviewerId = opaque string)
   -> #23F applyApprovedGeneratedChangeSet   (LOCAL WRITE)
   -> #23G executeAppliedChangeSet           (CODE EXECUTION)
```

**Central architectural fact (CURRENT, source-verified):** no tracked code in
this repository was identified that calls `applyApprovedGeneratedChangeSet`
(#23F), `executeAppliedChangeSet` (#23G), `regenerateAfterExecutionFailure` or
the #23E `buildGeneratedChangeSetReviewRecord` outside tests (a `git grep` of
tracked files found only their definitions, and the workflows invoke only npm
scripts that do not reach them). The only non-test review-builder usage
identified is the #22F evaluation path in `scripts/ai/evaluation/scoring-v6.js`:
1 caller file with 2 call sites -- `buildTestDesignReviewPackage` (`:320`) and
`buildTestDesignReviewRecord` (`:292`) -- reached by `npm run eval:ai:v6` and
`npm run eval:regression:v6` (both call `evaluateDatasetV6`). It builds
fixture records and is an evaluation helper, not a production orchestrator,
reviewer-facing interface, or approval-collection path; no #23E review-builder
usage was identified. None of the entry points or review-record builders is exported from the
package entry point `scripts/ai/index.js`, and `package.json`'s `files` field
excludes `scripts/ai/generative-test-design` and `scripts/ai/test-automation`
from the distributed package. The `#22F`/`#23E` review records are data
structures returned by builder functions; **no in-repository production
orchestrator, reviewer-facing interface, or approval-collection path was
identified.** The acting principal for every
privileged `#22`/`#23` action is therefore *whatever external caller invokes
the library* -- a fact this document treats as the boundary, not as a gap it
can close. All analysis below is at the library-contract level and is valid
regardless of what that external orchestrator turns out to be (see OQ3-1).

## 7. Tool inventory

Independently inventoried by repository-wide search for filesystem-write APIs,
`child_process`, network clients (`fetch`), and GitHub client usage, plus a
read of every workflow file.

| # | Tool / component | Call site | Input authority | Credential context | Possible side effect | Deterministic gate | Human gate | Maximum authority | Failure mode |
|---|---|---|---|---|---|---|---|---|---|
| S1 | PR comment upsert | `pr-comment-client.js` `upsertPrComment` (Octokit injected by `actions/github-script`) | Validated AI report fields (free text unfiltered) formatted by `format-pr-comment.js` | Job `GITHUB_TOKEN`, `pull-requests: write` (triage job only) | Create/update one PR comment | Report validation + `agent-policy.js`; length truncation | None | REMOTE CREATE (comments only) | Fork PR: token read-only, call fails, logged as warning |
| S2 | GitHub Actions history read | `collect-history.js` `fetchJson` | Env: `GITHUB_REPOSITORY`, `GITHUB_API_URL`, `HISTORY_*`, `TEST_BROWSER` | Job `GITHUB_TOKEN` (`actions: read`) | HTTP GET to env-selected API base | Numeric/shape validation of result | None | READ ONLY | Any failure writes `{available:false}` and continues |
| S3 | Git metadata read | `collect-context.js` `execFileSync("git", ...)` | Fixed argv (`remote get-url origin`, `rev-parse HEAD`, `rev-parse --abbrev-ref HEAD`) | None | Read repository metadata | Fixed binary, fixed args | None | READ ONLY / fixed EXECUTE | `null` on failure |
| S4 | Report writers | `collect-context.js`, `collect-history.js`, `aggregate-browser-context.js`, `analyze-failure.js` | Collector output / validated AI report | None | Write `reports/ai/*.json` | `resolveSafeRepositoryWritePath` containment (realpath-based) | None | LOCAL WRITE (reports directory) | Unsafe output location throws (fail closed) |
| S5 | AI provider clients | `providers/groq-provider.js`, `gemini-provider.js` | System/user prompt strings built by prompt builders | `AI_API_KEY` (env) | POST prompt to provider | Hard-coded provider host; `analyze()` returns a string only | None | READ ONLY (remote inference; egress of prompt data is AISEC-4's) | Missing key: constructor `CONFIGURATION` error, no fallback |
| S6 | Requirement source providers | `providers/jira-requirements-provider.js`, `azure-devops-requirements-provider.js` | Caller-supplied config (JQL / query, base URL or org/project) | Caller-supplied Jira email+token / Azure PAT or bearer | HTTP GET of requirements | Jira: `https` only, no embedded credentials, no query/fragment; Azure: host pinned to `dev.azure.com`; both `redirect: "manual"` | None | READ ONLY | Any redirect is a hard failure |
| S7 | Test-case publishing destination | `destinations/azure-devops-test-case-destination.js` via `test-design-publishing.js` | Deterministic `TestDesignArtifact` (RTI-4, no AI) and caller config | Caller-supplied PAT/bearer | Create Azure DevOps Test Case work items | Host pinned; org/project validated; `CREATE_ONLY`; sequential; no retry; `redirect: "manual"` | None in the module | REMOTE CREATE | Ambiguous outcome stops further items; no retry |
| S8 | Review-record builders | `generative-test-design/test-design-review-record.js`, `test-automation/generated-change-set-review-record.js` (only non-test usage: `scoring-v6.js`, #22F, evaluation fixtures -- 1 caller file, 2 call sites) | Caller-supplied `reviewerId`, `reviewedAt`, `decisions`, `comment` | None | Construct approval artifact (no direct side effect) | Digest binding, completeness rules, derived `status` | Declared human decision | PROPOSAL (but the artifact *authorizes* S9) | Invalid input returns `ok:false` |
| S9 | Change-set application (`#23F`) | `test-automation/change-set-application.js` `applyApprovedGeneratedChangeSet` | Generated change set + review package/record + caller `repositoryRoot`, `expectedProjectId` | None | Create / modify files under `repositoryRoot` | Approval validation; change-set re-validation; digest match; containment + symlink/hardlink checks; base-digest optimistic concurrency; rollback | `#23E` record (identity unauthenticated) | LOCAL WRITE | Approval or validation failure: `ok:false`, zero writes; partial failure: rollback, status may be `ROLLBACK_INCOMPLETE` |
| S10 | Controlled execution (`#23G`) | `test-automation/controlled-execution.js` `executeAppliedChangeSet` | `AppliedChangeSetRecord` + plan + change set + caller `repositoryRoot` | None (env allowlist) | Spawn `node_modules/.bin/{cypress,playwright}` on derived targets | Applied-record digest + fresh byte revalidation; closed target classifier; `shell:false`; argv array; env allowlist; timeout and output bounds | None at this stage (approval consumed at S9) | CODE EXECUTION | Unknown framework / no target / unsafe target: refuse with zero spawn |
| S11 | Bounded regeneration | `test-automation/regenerate-change-set.js` | Execution record (stdout/stderr redacted) + plan + context | `AI_API_KEY` via provider | One provider call, returns a proposal | Eligibility classifier; CREATE-origin refusal; freshness gate; `buildGeneratedChangeSet` | New `#23E` review required | PROPOSAL | Ineligible: zero provider calls |
| S12 | Generative model calls | `generative-test-design/*-generator.js`, `test-automation/automation-plan-generator.js`, `generate-change-set.js` | Positive-projected prompts (AISEC-2 §8) | `AI_API_KEY` via provider | Return JSON proposals | Schema, cross-model, path, protected-area validators | `#22F` / `#23E` before any mutation | PROPOSAL | Invalid response: bounded correction attempt, then failure |
| S13 | GitHub Actions workflows | `.github/workflows/cypress.yml`, `dependency-review.yml`, `supply-chain-audit.yml` | Repository content at the triggering ref | Per-job `GITHUB_TOKEN`; `GROQ_API_KEY` in one step | Run test suites, `npm ci`, npm scripts; post a PR comment | Declared per-job `permissions`; no `pull_request_target` | NONE IDENTIFIED as a technical gate: `pull_request` and `workflow_dispatch` runs start before any review (fork PRs: Actions workflow approval for applicable contributors); PR review is a process expectation (§28) | CODE EXECUTION (CI runner) | Fork PRs receive no secrets |
| S14 | Maintainer diagnostics | `scripts/diagnostics/audit-drift-check.js`, `branch-inventory.js`, `firefox-failure-forensics.sh`, `reset-cypress-runtime-outputs.sh` | Maintainer invocation; fixed argv | None | `npm audit`, `git rev-parse` reads; temporary diagnostic file writes/removal; fixed-path `rm -rf reports/cypress cypress/screenshots cypress/videos` (disposable Cypress output only) | Fixed binaries, fixed args, fixed paths | Maintainer-run | READ ONLY / LOCAL WRITE / fixed-path local delete (diagnostic scope; never model- or caller-influenced) | n/a |

No component in this inventory exposes a general tool-calling interface to a
model. The model produces text; every action above is invoked by
deterministic code.

## 8. Credential inventory

Credential **classes** only. No value was read or recorded.

| Credential class | Source | Loader | Consumer | Scope | Lifetime | Project bound | Destination bound | Model-visible | Model-selectable | Logged | Persisted |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AI provider key (`AI_API_KEY`; CI secret `GROQ_API_KEY` mapped in one step) | Environment | `config.js` module constant `API_KEY`; provider constructor argument overrides | `GroqProvider` / `GeminiProvider` request headers | UNKNOWN (provider-side; not stated in repository) | Long-lived secret | No | Yes -- provider host is a hard-coded constant | No | No | Convention only (`analyze-failure.js` rule); no scanner | Not written to any report |
| GitHub job token (`GITHUB_TOKEN`) | `${{ github.token }}` | Step `env` (history), `actions/github-script` (comment) | `collect-history.js` `Authorization` header; Octokit | Declared per job (`contents: read`; `actions: read`; `pull-requests: write` in the triage job) | Per workflow job run | Repository-scoped by GitHub | History: **No** -- `GITHUB_API_URL` env selects the base URL; comment: bound to workflow-context repository | No | No | Convention | `actions/checkout` persists the job token for the job's git operations by default and `cypress.yml` contains 6 checkout uses and 8 exist across the three inspected workflows, and none sets `persist-credentials: false`; the exact storage location is an action implementation detail not verified for the pinned version (UNKNOWN) |
| Jira email + API token | Caller-supplied config | `JiraRequirementsProvider` constructor | `Authorization: Basic` header | Caller-defined (UNKNOWN) | Caller-defined | Per provider instance | Caller-supplied `https` base URL; no host allowlist | No | No | Never (module rule) | Not persisted (frozen client config) |
| Azure DevOps PAT / bearer (source provider) | Caller-supplied config | Provider constructor | `Authorization` header | Caller-defined (UNKNOWN) | Caller-defined | Per instance (org/project) | Yes -- host pinned | No | No | Never | No |
| Azure DevOps PAT / bearer (publishing destination) | Caller-supplied config | Destination constructor | `Authorization` header | Caller-defined (UNKNOWN) | Caller-defined | Per instance (org/project) | Yes -- host pinned | No | No | Never | No |
| Reviewer identity | Caller-supplied string | `buildGeneratedChangeSetReviewRecord` | Stored in review record | **None -- not a credential** | n/a | Via record's `projectId` | No | Only as review-record data | Not model-selectable in repository code | n/a | Inside the record |
| Child-process environment | `process.env` | `buildExecutionEnvironment` allowlist | Spawned test runner | Allowlist: `PATH`, `SYSTEMROOT`, `WINDIR`, `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `CI` | Per execution | No | No | No | No | Output bounded | Output recorded in `AutomationExecutionRecord` |
| Ambient host credentials (files under the user profile: package-manager, git, cloud-CLI, browser profile material) | Host OS | Not managed by this repository | Anything running with the process's OS identity | UNKNOWN | Host-defined | No | No | No | No | No | Host-defined |

The last row is not a credential this repository *manages*; it is included
because the `#23G` child process runs with the host user's OS identity (see
§22).

## 9. Privilege-boundary map

```text
Component            Proposes   Validates   Authorizes        Executes        Holds credential
model (S12/S11)      YES        --          --                --              (provider key held by provider client, not visible to model)
generators/validators --        YES         --                --              --
reviewer (external)  --         --          YES (asserted)    --              none (identity = string)
review-record lib    --         digest only --                --              none
#23F applicator      --         YES         (consumes record) YES (LOCAL WRITE) none
#23G executor        --         YES         (consumes record) YES (EXEC)      none (env allowlist)
publishing (S7)      --         YES         caller            YES (REMOTE)    caller-supplied token
PR comment (S1)      --         YES         --                YES (REMOTE)    job token
CI (S13)             --         --          none (see §28)    YES (EXEC)      per-job token; one step holds AI key
```

Deputy relationships are visible in the last column: the components that hold
credentials (S1, S5, S7, S13) never take *model-selected* credentials, but
S1 and S7 publish text derived from attacker-influenceable content, and S9/S10
act on artifacts the model authored (§25).

## 10. Tool-selection authority

| Path | Classification |
|---|---|
| Which pipeline stage runs after which | `DETERMINISTICALLY_SELECTED` (code-defined sequence; no model chooses the next stage) |
| Which provider is used | `CONFIG_SELECTED` (`AI_PROVIDER` env; one provider per analysis; no cross-provider fallback -- SECURITY.md §10) |
| Which framework is executed by `#23G` | `DETERMINISTICALLY_SELECTED` from the validated plan's closed-enum `framework`; the model proposes the plan, but the value is validated against `SUPPORTED_FRAMEWORKS` and cross-checked against the candidate's `targetFrameworks` (AISEC-2 §16) |
| Which binary is spawned | `DETERMINISTICALLY_SELECTED` (`node_modules/.bin/cypress` or `playwright`, from a closed map) |
| Which publishing destination is used | `CONFIG_SELECTED` (caller-supplied destination object) |
| Which credential is used | `CONFIG_SELECTED` / caller-supplied; never model-selected (§13) |
| Approve or reject | `HUMAN_SELECTED` (asserted; unauthenticated -- §16) |

**The model cannot select among tools.** It can only influence the *contents*
of proposals that deterministic code then routes.

## 11. Tool-argument authority

| Argument | Source | Can model-generated data influence it? | Barrier |
|---|---|---|---|
| Write target path (`#23F`) | Generated change set path | Yes, via the plan the model proposed | Path safety and canonicality; 1:1 binding to the bound plan; framework-directory prefix; protected-area denylist; realpath containment; symlink/hardlink checks (AISEC-2 §16) |
| Write content | Generated change set `content` | Yes -- fully | None on semantics (scope-only control) |
| Write operation | Plan `operation` | Yes, via the plan | Must equal the bound plan operation; `CREATE`/`MODIFY` only |
| `repositoryRoot` (`#23F`, `#23G`) | Caller | **No in repository code** | Absolute, control-character-free, realpath-resolved, existing directory; module rule: never derived from AI/provider/repository content (`repository-root.js`) |
| Executed binary | Closed map | No | Closed vocabulary |
| Runner argv (`#23G`) | Derived from applied change paths via closed classifier | Indirectly (path text) | Classifier (`.cy.js` under `cypress/e2e/`, `.spec.js` under `playwright/`); Cypress safe-character allowlist (unsafe target => hard whole-execution rejection); Playwright anchored, fully-escaped absolute-path regex per target; `shell:false` |
| `cwd` | Resolved `repositoryRoot` | No | -- |
| Child environment | `process.env` filtered by allowlist | No | Allowlist |
| Publish payload | `TestDesignArtifact` | Not via a model (RTI is deterministic); via requirement content | Structural validation only |
| Publish destination (org/project) | Caller config | No | Validators on org/project characters; host constant |
| PR comment body | Validated AI report | Yes (free text) | Length truncation only |
| PR comment target | Workflow context + `marker` string match | Marker text matched against comment bodies of any author | See TB-08 |
| GitHub API base URL (`collect-history.js`) | `GITHUB_API_URL` env | No (env, not model) | None in code -- trusted runner environment |

## 12. Credential visibility

| Question | Result | Evidence |
|---|---|---|
| Credentials visible to a model | **NO** for all model call sites | AISEC-2 §8 inventory (no credential in any `systemPrompt`/`userPrompt`); `SECURITY.md` §9 |
| Credential identifiers visible to a model | **NO** | `ProjectProfile.id` and `projectId` handling excluded from model-visible metadata (SECURITY.md §8; AISEC-2 §29); no credential identifier is projected into any prompt |
| Environment variable *names* visible to a model | **NO** in prompts; a system prompt may name `process.env` only inside an injection *example* (`test-design-prompt.js:61`) -- static text, not a value | Source |
| Authorization headers serialized anywhere | **Not intentionally.** Providers set headers only on their own request; `AutomationExecutionRecord` records stdout/stderr of the test runner, which the env allowlist keeps free of env-variable credentials; `redactSecrets()` scrubs credential-shaped text before regeneration prompts | Source; SECURITY.md §9/§13 |

Any claim that a credential *value* is exposed would require direct evidence;
none was found and none is asserted.

## 13. Credential-selection authority

Neither untrusted content nor model output selects a credential, an account,
a project tenant, a provider instance, or a destination in any code path this
study read. Credentials are either job-scoped (`GITHUB_TOKEN`), process-scoped
(`AI_API_KEY` read once into a module constant), or supplied per call by the
caller. **Secrecy versus use authority:** the credential *values* are kept out
of models, but the *actions performed with them* are shaped by
attacker-influenceable content in three places -- the PR comment posted with
the job token (S1), the work items published with the caller's Azure
credential (S7, content from requirement text), and the code executed after
approval (S10) -- which is the confused-deputy surface analyzed in §25.

## 14. Authorization binding matrix

`BOUND` / `NOT_BOUND` / `PARTIAL` / `UNKNOWN` / `N/A`. "Reviewer identity"
is `PARTIAL` where the identifier is integrity-covered by a digest but not
authenticated.

| Privileged action | Artifact digest | Project ID | Repository root | Target path | Command | Destination | Credential identity | Reviewer identity | Time / nonce |
|---|---|---|---|---|---|---|---|---|---|
| `#23F` apply | BOUND (`changeSetDigest` must equal the approved package's) | BOUND (string equality with caller-supplied `expectedProjectId`) | NOT_BOUND (approval artifacts contain no root; base-content digests act as an *implicit* state binding only) | BOUND (1:1 plan binding) | N/A | N/A | N/A | PARTIAL (in `recordDigest`, unauthenticated) | NOT_BOUND (`reviewedAt` is a caller string, no freshness check, no nonce) |
| `#23G` execute | PARTIAL (`AppliedChangeSetRecord` digest and fresh byte revalidation; the review record is *not* re-validated here) | BOUND | NOT_BOUND (caller-supplied; fresh byte revalidation is implicit) | BOUND (derived from applied paths) | BOUND (closed vocabulary) | N/A | N/A | NOT_BOUND (approval consumed at `#23F`; execution takes no review record) | NOT_BOUND (timeout bound only) |
| Azure publish (`S7`) | NOT_BOUND (structural validation only; no review/approval object) | NOT_BOUND (destination `project` is not cross-checked against the source artifact's project identity -- AT-04) | N/A | N/A | N/A | BOUND (host constant + config org/project) | NOT_BOUND (caller token; not verified against org/project; scope UNKNOWN) | NOT_BOUND (no review gate) | NOT_BOUND (no idempotency key) |
| PR comment upsert (`S1`) | N/A | N/A | N/A | N/A | N/A | BOUND (workflow-context repository and PR number) | BOUND (job-scoped token, declared permissions) | N/A | NOT_BOUND; **target comment is matched by marker text, author not checked** (TB-08) |
| GitHub history read (`S2`) | N/A | PARTIAL (`GITHUB_REPOSITORY` env) | N/A | N/A | N/A | NOT_BOUND (`GITHUB_API_URL` env-selected, no pinning) | BOUND (job token) | N/A | N/A |
| AI provider call (`S5`) | N/A | N/A | N/A | N/A | N/A | BOUND (hard-coded provider host) | PARTIAL (process-wide key; explicit constructor override exists) | N/A | N/A |
| Requirement read, Jira | N/A | N/A | N/A | N/A | N/A | PARTIAL (caller-supplied `https` URL; no host allowlist) | NOT_BOUND to host beyond caller intent | N/A | N/A |
| Requirement read, Azure | N/A | N/A | N/A | N/A | N/A | BOUND (host pinned; org/project from config) | NOT_BOUND (scope UNKNOWN) | N/A | N/A |

## 15. Review / approval boundary

The `#22F` and `#23E` records bind a *content digest* and a *project id
string* to a set of decisions. The record's `status` is derived, never
accepted from the caller. The exact package digest ties an approval to one
immutable snapshot: if the change set, plan or repository context changes,
the package digest changes and the old record no longer validates
(`generated-change-set-review-record.js`, "STALE-APPROVAL PROTECTION").

What is **bound**: the change-set digest, the review-package digest, the
project id string, and (inside `recordDigest`) the `reviewerId`, `reviewedAt`,
`decisions` and `comment` strings.

What is **caller-provided metadata, not authenticated**: `reviewerId`,
`reviewedAt`, `comment`, and the assertion that a human made the decision.

Content integrity (**present**) is not reviewer identity authenticity
(**absent**). Both facts are stated by the module itself in a block titled
"INTEGRITY IS NOT AUTHENTICITY".

## 16. Reviewer identity authenticity

Refines AT-07 (CRITICAL, unchanged) with source-level answers:

| Question | Answer | Evidence |
|---|---|---|
| Who can create an approval record? | Any code that can call `buildGeneratedChangeSetReviewRecord`, **or** hand-construct a record-shaped object and compute its digest | Module docstring lines 68-80 |
| What proves reviewer identity? | **Nothing.** `reviewerId` must satisfy `isValidId` (a bounded string) | `generated-change-set-review-record.js:227-229` |
| What proves the decision was made by a human? | **Nothing** (`FUTURE_HUMAN_DECISION_PROVENANCE_GUARD` open) | Module docstring; SECURITY.md §23/§28 |
| What binds reviewer identity to the content digest? | `recordDigest` covers the record's fields including `reviewerId` -- integrity only | Record digest construction (`:365-374`) |
| Is the digest keyed? | **No.** "PLAIN, UNKEYED SHA-256 -- not an HMAC, not a digital signature" | Module docstring lines 48-51 |
| Can a local process fabricate a #23E approval? | **Yes**, by direct inspection of the #23E code: the builder accepts a caller-supplied `reviewerId` (bounded string only); `recordDigest` is plain `crypto.createHash("sha256")` over canonicalized fields, with `computeDigest` and `DIGEST_LABEL_RECORD` exported; the validator checks record/package kind and schema, recomputes both unkeyed digests, requires the record's `packageDigest` to match the package, checks project identity (record, package and `expectedProjectId`), and requires `status` APPROVED -- ordinary field and integrity checks that perform no cryptographic authentication of reviewer identity or of the approval decision; no key, MAC or signature is used anywhere in this path | `generated-change-set-review-record.js:227-229, 365-374, 420-428, 458-470`; `generated-change-set-review-canonical.js:203-219, 226-234` |
| Does any repository evidence show reviewer-identity constructability? | **Yes, for #22F only.** Evaluation code builds a #22F `TestDesignReviewRecord` through the legitimate builder with a fixed fixture `reviewerId` (`v6-evaluation-fixture-reviewer`). This shows the identity field accepts an arbitrary string with no identity proof. It is **not** proof of #23E forgery or of production exploitability; the #23E conclusion rests on the direct code evidence in the row above | `scoring-v6.js:292` (#22F constructability only) |
| Can model-generated text set approval fields? | No path exists **in this repository** (fields are caller-supplied; no code routes model output into them). An external orchestrator is outside this study (OQ3-1) | Source |
| Does any interface show the reviewer the proposal? | **No reviewer-facing interface was identified**: no `bin` entry, no interactive CLI, no HTML/UI files, no renderer. The only non-test review-builder usage identified is the #22F evaluation path in `scoring-v6.js` (1 caller file; call sites `:320` package builder and `:292` record builder; reached by `npm run eval:ai:v6` and `npm run eval:regression:v6`), which builds fixture records and displays nothing to a reviewer | §6 search; `package.json` |

**Refinement of AISEC-2 OQ-1** (review-display provenance): the question
assumed review-display tooling might exist outside the modules AISEC-2 read.
This study finds that **no reviewer-facing presentation layer was identified
in this repository** (repository scope only; reviews may still occur outside
it). Whether a future or external display distinguishes
system-stated fact from model-authored rationale is therefore not verifiable
from repository source and remains an ADR-level design requirement (OQ3-6),
not a code defect.

## 17. Approval replay analysis

An approval is a digest-bound record, not a single-use token. There is no
nonce, expiry, or consumed-marker anywhere in the `#22`/`#23` record types.

| Replay target | Result | Mechanism |
|---|---|---|
| Different artifact content | **Blocked** | Package digest changes; old record does not validate |
| Different project id | **Blocked** (string equality) | `PROJECT_MISMATCH` |
| Same repository, re-application | **Mostly blocked, not by single-use** | `CREATE` fails once the target exists; `MODIFY` fails `STALE` once content differs from `baseContentDigest`. If a file is later restored to its exact base content, the same approved change set applies again |
| Different repository root, same project id | **Not blocked by the approval** | Approval carries no repository root. A second checkout whose relevant files have identical content passes the same base-digest checks (TB-02) |
| Different destination / credential | **N/A for `#23F`/`#23G`** | Publishing has no approval object at all, so no approval-based replay control exists there |
| Different execution | **Not blocked** (the same applied state can be executed repeatedly) | `AutomationExecutionRecord` binds `appliedChangeSetRecordDigest`; nothing prevents executing the same applied state repeatedly (timeout/output bounds only) |

Temporal validity is **not a defect by itself** here (integrity-bound,
state-checked); it is relevant because replay across repository copies is
otherwise closed only by incidental content differences.

## 18. Project / repository binding

| Identity | Where bound | Where not bound |
|---|---|---|
| `projectId` | Every `#22`/`#23` artifact; equality-checked against a caller-supplied `expectedProjectId` at apply, execute and regenerate | It is a caller-chosen string, not anchored to a repository or destination identity |
| `repositoryRoot` | Validated as trusted orchestration input at apply/execute; `repository-root.js` states it may never derive from AI/provider/repository content | Not part of any approval, review package, applied record, or execution record |
| Destination (Azure org/project) | Constructor config; host constant | Not cross-checked against source artifact identity |
| Credential | Per call / per job | Not bound to project or destination by code |

`repository-root.js` holds no module-global mutable root state; one process
can serve more than one root sequentially because every call takes an explicit
root. The AI key, by contrast, is a process-wide constant (§42).

## 19. Filesystem write boundary

Trace, `#23F`: `data source` -> `authority` -> `validation` -> `approval` ->
`side effect`.

1. Generated change set (model-authored content, deterministic paths) ->
   proposal only.
2. `validateApprovedGeneratedChangeSetReview` runs **first**, before the
   filesystem is touched: record digest, package digest, project id, all
   decisions `APPROVE`.
3. Change-set re-validation against plan and context (the same validator used
   at generation).
4. Exact change-set digest match against the reviewed package.
5. `resolveRepositoryRoot`: absolute, control-character-free, `realpath`
   resolved, existing directory.
6. Per-change revalidation: per-component `lstat` walk (symlink/hardlink
   defenses), canonical containment, case-collision detection, `CREATE`
   target must not exist, `MODIFY` target digest must equal
   `baseContentDigest`.
7. Batched write (`wx` flag for creates, temp file + rename for modifies) with
   rollback on partial failure, bound to ancestor-topology identity.

Authority is exercised only after both a validated approval object and a
matching digest exist. What the pipeline does **not** decide is whether the
approval object came from a real human (§16).

## 20. Protected-path boundary

Deterministic and code-defined: `isProtectedPath` in `generated-change-set.js`
(`PROTECTED_EXACT_BASENAMES` = `package.json`, `package-lock.json`;
`PROTECTED_SEGMENT_PATTERN` = `.git`, `.github`, `node_modules`, `secrets`,
`credentials`; `PROTECTED_ENV_BASENAME_PATTERN` = `.env*`). It is a fixed
in-source constant: there is no configuration input and no model-influenced
input that can alter it. A second, independent layer -- the framework-directory
prefix (`cypress/` or `playwright/`) -- sits in the same validator, so a
protected area is unreachable unless *both* layers fail. Because
`cypress.config.js`, `playwright.config.js`, `scripts/**` and `.github/**` lie
outside those prefixes, generated changes cannot target them.

Two distinctions this study preserves:

- **Path containment is not semantic safety.** Files inside `cypress/` or
  `playwright/` are still executable test code (§21, §26).
- **Denylist matching on unusual filenames** (case, Windows short names,
  alternate data streams, trailing dots) was **not empirically tested** here
  (static analysis only); the patterns are case-insensitive but normalization
  edge cases are UNKNOWN (TB-10, OQ3-2).

## 21. Controlled-execution boundary

Trace: approved+applied record -> revalidation -> classifier -> command ->
child process.

- **Who selects the command:** code. `selectExecutionCommand` maps the closed
  framework enum to `node_modules/.bin/cypress` or `playwright` resolved
  beneath the validated `repositoryRoot` (not `PATH`, not an npm script).
- **Who selects arguments:** derived from applied change paths only, through
  the closed classifier; Cypress targets must pass a safe-character allowlist
  (an unsafe recognized target rejects the *whole* execution rather than
  running a subset); Playwright receives one anchored, fully-escaped absolute
  path regex per target.
- **Shell interpretation:** none (`shell: false`, argv array).
- **`cwd`:** the resolved real root.
- **Environment:** allowlist replaces (never merges with) the child
  environment (§22).
- **Bounds:** 10-minute maximum timeout (a caller may only shorten it), 200,000
  bytes each for stdout and stderr, recorded as truncated when exceeded.
- **Exit handling:** status derived from exit code and timeout
  (`PASSED`/`TEST_FAILED`/`EXECUTION_ERROR`/`TIMED_OUT`).
- **Approval:** `executeAppliedChangeSet` does not take or re-validate a
  review record; approval is consumed at `#23F` and carried only as digests in
  the `AppliedChangeSetRecord`.

**Command-injection assessment.** `shell:false` plus an argv array removes
shell-metacharacter interpretation for this call site; it does not by itself
remove *argument* injection into the runner's own CLI or *code* injection via
the test file the runner then loads. The first is closed by the classifier
plus safe-character/anchored-pattern rules (TB-13); the second is the
explicitly documented design boundary (`SECURITY.md` §25, "not a sandbox") and
is analyzed as TB-12.

## 22. Execution environment

The child receives only: `PATH`, `SYSTEMROOT`, `WINDIR`, `TEMP`, `TMP`,
`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `CI` (names only; values not
read). Consequences:

- **CURRENT, strong:** environment-variable secrets (`AI_API_KEY`,
  `GITHUB_TOKEN`, Jira/Azure tokens) are **not** inherited by the child.
- **CURRENT, residual:** the child runs with the host user's OS identity. The
  allowlist passes `HOME`, `USERPROFILE`, `APPDATA` and `LOCALAPPDATA`
  (justified in-source as needed by Cypress/Chromium), and the launched test
  code has full filesystem and network access. Credential *files* under the
  user profile (package-manager, git, cloud-CLI, browser-profile material) are
  therefore reachable by approved-but-malicious test code (TB-14). Whether
  the pass-through variables are the *minimum* required is UNKNOWN
  (least-privilege classification in §29).
- **CURRENT, CI context:** in the GitHub Actions test jobs the same reasoning
  applies to the persisted checkout credential (§8), which is job-scoped,
  read-only in declared scope (a current configuration fact, see §28), and exists only for the job's duration.

## 23. Publishing / remote-create boundary

| Aspect | Azure test-case destination |
|---|---|
| Destination | Host constant `dev.azure.com`; `organization`/`project` from caller config, validated for scheme/path/injection characters, `encodeURIComponent`-escaped |
| Credential | Caller-supplied PAT or bearer; "no acquisition" |
| Project binding | Config `project`; **not** cross-checked against the source requirement project |
| Payload source | `TestDesignArtifact` -- deterministic RTI-4, no model involvement; text originates from requirement title/content/acceptance criteria |
| Validation | Structural (`assertValidTestDesignArtifact`) before any side effect |
| Review gate | **None** in the module (RTI is a separate, non-AI pipeline) |
| Idempotency / replay | `CREATE_ONLY`; no idempotency key; a second invocation creates duplicates |
| Retry | None; an ambiguous outcome stops further items |
| Redirects | `redirect: "manual"`; a redirect is a hard failure |
| Returned data | Treated as untrusted (validated, re-projected) |

Destination control classification: `CONFIG-BOUND` (host `STATIC`, org/project
`CALLER-CONTROLLED`). No model-influenced destination exists.

## 24. Provider / adapter boundary

- **AI providers.** The contract is `analyze({systemPrompt, userPrompt}) ->
  Promise<string>`. A provider cannot express an action, tool call, or write;
  it returns text that deterministic code validates. Provider hosts are
  hard-coded constants; keys come from the environment or a constructor
  argument. Authority reached by a provider: remote inference only (prompt
  data egress is AISEC-4's).
- **Requirement providers and destination.** Read-only providers and a
  create-only destination, each vendor-specific, each taking credentials from
  the caller. The generic RTI core (`test-design-publishing.js`) treats the
  destination as trusted executable code and its return value as untrusted
  data.
- **Adapter boundary (privilege/credential handling).** The generic core
  (`requirement-artifact.js`, `test-design-publishing.js`) never needs
  vendor credential detail: it passes a destination object through and
  validates only the vendor-neutral result shape. Vendor-native identifiers
  do not appear in generic authority decisions; `source.system` /
  `source.location` are descriptive artifact metadata. This matches the
  documented principle (`docs/architecture-model-boundary-v2.md`).

## 25. Confused-deputy analysis

Refines AT-16 (MEDIUM, unchanged). Pattern: `untrusted input -> proposal ->
deterministic system -> trusted credential or tool -> legitimate but
attacker-desired effect`. Every candidate path found:

| Path | Deputy | Untrusted influence | Effect | Barrier |
|---|---|---|---|---|
| Credential deputy, publishing | Azure destination + caller PAT | Requirement text becomes work-item title/description | Attacker-authored text created under the operator's credential | Structural validation only; no review gate (TB-06) |
| Credential deputy, comment | job `GITHUB_TOKEN` (default token; no `github-token` override in the workflow) posting under a platform-derived bot/service identity (INFERRED; not shown in repository code) | Failure text -> model report -> comment body | Attacker-influenced text posted under that identity; no markdown/`@mention` neutralization (length truncation only) | Length bound; report validation (TB-07) |
| Resource-selection deputy, comment | job token | Any commenter's text can contain the marker | Update target chosen by untrusted content; author not checked | Platform permission behavior UNKNOWN (TB-08) |
| Filesystem deputy | `#23F` writer | Model-authored file content in an allowed path | Semantically malicious content in a valid file | Scope closed (path); content unfiltered (TB-12) |
| Execution deputy | `#23G` runner | Approved test code | Arbitrary computation with the host identity | Classifier and env allowlist; not a sandbox (TB-12/TB-14) |
| CI deputy | Actions runner | Merged spec content | Code execution in test jobs (declared: no secrets, read-only job token; current configuration, see §28) | Declared job permissions (TB-17); PR review is a process expectation, not an execution gate |

**Credential-confused-deputy vs secret exfiltration.** In each row the
attacker cannot read the credential; they influence *what is done with it*.
None of the rows is closed by the fact that credentials are hidden from
models (§13).

**Filesystem, execution and publishing confused deputies** are the three
rows above marked accordingly: what can remain malicious inside a valid path
(arbitrary content), inside a permitted command (arbitrary code the runner
loads), and inside a fixed destination (attacker-authored text). Destination,
object type (`Test Case`) and project identity remain deterministic in
publishing; only the *content* is attacker-influenceable.

## 26. Privilege-escalation paths

| Path | Mandatory gates | Weakest gate |
|---|---|---|
| `PROPOSAL -> LOCAL WRITE` | Approval object (valid digest, project match) + full re-validation + containment | Approval object authenticity (§16) |
| `PROPOSAL -> LOCAL WRITE -> CODE EXECUTION` | Above + applied-record digest + fresh byte revalidation + closed classifier + `shell:false` + env allowlist | Approval authenticity again; then the semantic content of the test file |
| `PROPOSAL -> REMOTE CREATE` (comment) | Report validation + policy override; no human gate | No gate on text content |
| `RTI artifact -> REMOTE CREATE` (Azure) | Structural validation; caller config | No review gate; content is attacker-influenceable |
| `LOCAL WRITE -> CI EXECUTION` | A human commits and pushes; workflow-level `permissions` | None as a technical gate: `pull_request` and `workflow_dispatch` runs start before any review; PR review is a process expectation (§28) |
| `CODE EXECUTION -> ambient credentials` | Env allowlist blocks variables only | None for files under the user profile |

The `LOCAL WRITE -> CI EXECUTION` step is not performed by this pipeline: it
holds no git authority (SECURITY.md §22); a person must commit and push.

## 27. Scenario catalog

Source classes (mechanically countable; see the count table in §28):
`AT_REFINED` = AISEC-3 mechanism detail for a canonical AISEC-1 scenario whose
canonical rating is preserved; `COMPOUND_PRIOR` = compound of two prior
canonical risks, rated here as an AISEC-3 scenario; `SECURITY_MD_DERIVED` =
current risk documented in `SECURITY.md` with no AT/PI counterpart; `NEW` =
mechanism newly analyzed here (related canonical items, where any, are named in
the row but the scenario is not the same threat). Likelihood / Impact /
Authority Impact use the AISEC-1 methodology and the Authority Impact rule in
§28.

| ID | Name | Tool / component | Entry source | Required privilege | Credential context | Attack path | Current controls | Control limitation | Human gate | Max authority | L | I | AI | Risk | Class | Evidence | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TB-01 | Forged reviewer identity / fabricated approval record | S8, S9 | Any code able to call the library or hand-build a record | Ability to invoke the library | None | Construct record + package with unkeyed digest; pass to `#23F` | Digest integrity, project match, derived status | Digest unkeyed; `reviewerId` opaque string | Declared, unauthenticated | LOCAL WRITE -> CODE EXECUTION | Medium | High | High | CRITICAL | AT_REFINED (AT-07) | §16; #23E direct evidence: record docstring `:45-80`, `:227-229`, `:365-374`, `generated-change-set-review-canonical.js:203-219`; #22F constructability only: `scoring-v6.js:292` | AISEC-6 (design) |
| TB-02 | Approval replay across repository roots | S9 | Approved change set applied to a second checkout | Approval + a checkout of the same project id | None | Reuse record+package on another root whose files match base digests | Package/content digests; base-digest and existence checks | Approval carries no root; identical checkouts pass | Original review only | LOCAL WRITE | Low | Medium | Medium | MEDIUM | NEW | §17-§18; package binds only `projectId` | AISEC-6 |
| TB-03 | Approval re-application to the same repository | S9 | Re-run of `#23F` | Approval | None | Restore file to base content, re-apply same approved set | Optimistic concurrency (`CREATE` exists / `MODIFY` STALE) | Approval is not single-use; no nonce | Original review only | LOCAL WRITE | Low | Low | Medium | LOW | NEW | §17 | AISEC-6 |
| TB-04 | Cross-project approval reuse | S9, S10 | Artifact from project A applied as project B | Approval + control of `expectedProjectId` | None | Present an artifact whose `projectId` string matches | `PROJECT_MISMATCH` equality checks | Project id is a caller-chosen string, unanchored | Original review | LOCAL WRITE | Low | Medium | Medium | MEDIUM | NEW | §18 | AISEC-4 / AISEC-6 |
| TB-05 | Publishing destination substitution | S7 | Misconfigured or attacker-influenced caller config | Caller config control | Caller PAT/bearer | Point destination at another org/project | Host pinned; org/project syntax validation | No source/destination identity cross-check; token scope UNKNOWN | None | REMOTE CREATE | Low | Medium | Medium | MEDIUM | AT_REFINED (AT-04) | §23; destination `:153-171` | AISEC-4 |
| TB-06 | Attacker text laundered through trusted publisher | S7 (with S6 source) | Requirement content authored by a low-privilege user | Ability to author a requirement in the queried source | Operator's Azure credential | Requirement text -> deterministic artifact -> created work item | Structural validation; create-only | Content unfiltered; no review gate | None | REMOTE CREATE | Low-Med | Medium | Medium | MEDIUM | NEW | §23, §25 | AISEC-4 |
| TB-07 | Attacker-influenced text posted with the job token (platform-derived bot identity, INFERRED) | S1 | Failure output / repository text reaching the AI report | Ability to influence test failure text | Job token | Text -> model report -> comment body (markdown, links, mentions) | Length truncation; report validation | No markdown/mention neutralization | None | REMOTE CREATE (comment) | Medium | Low | Low | LOW-MED | NEW | `format-pr-comment.js` (only `truncate`) | AISEC-7 |
| TB-08 | Comment-marker hijack of the upsert target | S1 | Any PR commenter | Ability to comment on the PR | Job token | Comment containing the marker becomes the "existing" comment | First 100 comments only; marker string match | Author not checked; only the first 100 comments scanned; platform update permission behavior UNKNOWN | None | REMOTE CREATE (update) | Low-Med | Low | Low | LOW | NEW | `pr-comment-client.js:10-27` | AISEC-7 |
| TB-09 | `repositoryRoot` manipulation | S9, S10 | A future orchestrator deriving the root from untrusted input | Orchestrator flaw | None | Supply a different existing directory | Root is caller input; module rule forbids untrusted derivation; validation is shape-only | No tracked call site was identified through which the rule could be observed to be followed | Original review | LOCAL WRITE / EXECUTION in another tree | Low | High | High | MEDIUM | NEW | `repository-root.js`; §6 search | AISEC-6 |
| TB-10 | Protected-path denylist normalization bypass | S9 | Path text with unusual normalization | Approval + a crafted path | None | Windows short names / alternate streams / trailing characters vs pattern | Case-insensitive patterns; prefix layer; canonical path checks | Normalization behavior not empirically tested | Original review | LOCAL WRITE (protected-name paths inside `cypress/` or `playwright/`) | Low | High | Medium | MEDIUM | NEW (unverified) | §20; `generated-change-set.js:125-134` | AISEC-7 |
| TB-11 | Symlink / TOCTOU on write | S9 | Concurrent local actor | Local access | None | Swap path component between check and write | `lstat` walk, topology identity binding, rollback | Documented unclosed TOCTOU window | Original review | LOCAL WRITE (outside containment if the race succeeds) | Low | High | High | MEDIUM | SECURITY_MD_DERIVED (SECURITY.md §24) | `change-set-application.js:254-283` | AISEC-6 |
| TB-12 | Safe command, malicious approved code | S10 | Approved test file with malicious semantics | Approval (forged or persuaded) | Host OS identity | Approved spec runs arbitrary code in the runner | Closed classifier, `shell:false`, env allowlist, timeout | Not a sandbox; network and filesystem unrestricted | `#23E` (semantics visible, identity unauthenticated) | CODE EXECUTION | Low-Med | High | High | HIGH | SECURITY_MD_DERIVED (SECURITY.md §25) | `controlled-execution.js:240-242, 491` | AISEC-6 / AISEC-7 |
| TB-13 | Argument injection into the runner CLI | S10 | Applied path text | Approval | None | Path text interpreted as a runner flag/pattern | Closed classifier; Cypress safe-character allowlist (whole-run reject); Playwright anchored escaped regex; argv array | Depends on classifier correctness per runner | Original review | CODE EXECUTION | Low | Medium | High | MEDIUM | NEW | `controlled-execution.js:293-322, 395-420` | AISEC-7 |
| TB-14 | Ambient credential files reachable from the child | S10 | Malicious approved code | TB-12 succeeded | Host user's files | Read user-profile credential material | Env-variable secrets excluded | `HOME`/`APPDATA` passed; full FS and network | Original review | CODE EXECUTION -> credential exfiltration | Low | High | High | MEDIUM | NEW | §22; `ENV_ALLOWLIST` | AISEC-4 / AISEC-6 |
| TB-15 | Env/caller-selected credential destinations | S2, S6 | Trusted-config tampering | Control of `GITHUB_API_URL` or Jira base URL | Job token (declared: `contents: read`, `actions: read`; in the triage job also `pull-requests: write`); Jira token (scope UNKNOWN, OQ3-4) | Send credential to another host | Jira: https-only, no embedded creds, no redirects | `GITHUB_API_URL` has no pinning; Jira has no host allowlist | None | CREDENTIAL DISCLOSURE (job-token path: Medium (b) from pull-request metadata mutation (GH-17) and, while the setting stays enabled, review creation including approval; comment-body mutation alone would be Low. Jira token scope UNKNOWN -- Medium placeholder, OQ3-4) | Low | Medium | Medium | MEDIUM | NEW | `collect-history.js:113-118, 305` | AISEC-4 |
| TB-16 | AI provider authority expansion | S5 | A future provider implementation | Code review bypass (process only; `main` accepts a PR with 0 required approving reviews) | AI provider key (scope UNKNOWN, OQ3-4) in the process that runs the provider | Provider code gains side-effecting behavior and executes in-process | Contract is string-in/string-out; new provider requires review (SECURITY.md §17) | Nothing enforces the contract at runtime beyond return-type validation | Code review (process only, not a technical gate) | CODE EXECUTION in the provider process (operator host: host-ambient; triage job); the contract is read-only today | Low | Medium | High | MEDIUM | NEW (design) | `provider-contract.js` | AISEC-6 |
| TB-17 | Allowed file -> CI execution | S13 | Spec content under `cypress/` or `playwright/` executed by CI on two paths: (fork) unreviewed fork-PR code on `pull_request`, before any review; (post-merge) a spec merged to `main` through a PR, run on `push`. The same-repository pre-merge workflow-edit path is TB-20 | Fork: any GitHub user who can open a PR; post-merge: a contributor whose PR is merged | Declared job token (`contents: read`, `actions: read`) and no `secrets.*` reference in test jobs (CURRENT CONFIGURATION; fork runs are platform-capped to a read-only token without secrets) | Spec code runs in test jobs | Per-job `permissions`; no secrets in test jobs; fork PRs get read-only | Persisted checkout credential; arbitrary code in runner | Fork: Actions workflow approval (`first_time_contributors` policy, observed) -- not PR review; post-merge: PR required on `main` with required status checks; human approval not technically required (0 observed) | CODE EXECUTION (CI) | Low-Med | Medium | Medium | MEDIUM | NEW | `cypress.yml` (6 checkout uses; 8 across the three inspected workflows; none sets `persist-credentials: false`) | AISEC-6 |
| TB-18 | Reviewer persuasion + unauthenticated identity (compound) | S8, S9, S10 | Injected content (AISEC-2) reaching a reviewer | As TB-01 / PI-08 | None | Persuasive rationale -> approval by an unverified principal -> TB-12 | As TB-01 and AISEC-2 §17 | No provenance labeling in any display (no display was identified in this repository) | Human | LOCAL WRITE -> CODE EXECUTION | Low-Med | High | High | HIGH | COMPOUND_PRIOR (AT-07 + PI-08; AISEC-3 scenario rating, not an inherited canonical rating; not additive to TB-01/TB-12) | §16; AISEC-2 §17 | AISEC-6 |
| TB-19 | Publish replay / duplicate creation | S7 | Re-invocation | Caller | Caller PAT | Same request creates duplicates | Create-only, no retry | No idempotency key | None | REMOTE CREATE | Low | Medium | Medium | MEDIUM | AT_REFINED (AT-08; canonical severity preserved -- AISEC-3 adds mechanism detail: no idempotency key, no approval object) | §23 | AISEC-4 / AISEC-7 |
| TB-20 | CI secret reachable by same-repo PR code | S13 | Same-repository actor with write access: a branch PR author, or a `workflow_dispatch` invoker selecting their branch; the workflow YAML on that ref is taken to be the workflow the run uses (DERIVED_INFERENCE, see the workflow-definition provenance in section 28) | Write access | `AI_API_KEY` (`secrets.GROQ_API_KEY`) in one step; declared job token with `pull-requests: write`; under TB20-WF-INFERENCE the token's requested scopes are actor-editable and `contents: write` is reachable (personal-account repository, no organization/enterprise cap, GH-06); `GROQ_API_KEY` is the repository's only Actions secret (count observed 1, no environments) | PR-head scripts run in the secret-holding job | Step-scoped env; fork PRs receive no secrets; no `pull_request_target`; under TB20-WF-INFERENCE the declared job configuration is editable by this actor, so it is a current configuration fact, not a boundary (§28) | Platform trust model: same-repo contributors are trusted | None as a technical gate: `pull_request` and `workflow_dispatch` runs start before and independent of human review (review is a process expectation; 0 required approvals observed) | CODE EXECUTION (ephemeral CI triage job; under TB20-WF-INFERENCE the actor can request `contents: write`, so the credentials would permit repository-content mutation; if the inference fails the fallback is Medium authority with unchanged MEDIUM risk) | Low | Medium | High | MEDIUM | NEW (platform trust) | `cypress.yml:3-10, 850-858, 904-911` | AISEC-4 |

## 28. Risk register

Methodology reused verbatim from AISEC-1 §14 and AISEC-2 §26: Likelihood =
probability the path succeeds; Impact = severity of consequence; Authority
Impact = authority reached *if it succeeds*. **A preventive control reduces
Likelihood, not Authority Impact.**

### Authority Impact rule

One rule, applied to every scenario in the same steps.

**Terms.** The *scenario boundary* is the threat mechanism the scenario
names. Its *execution surface* is the set of execution contexts that are part of
its defined successful attack path. An *execution context* is a process, runner
or identity in which attacker-controlled code runs. The *successful endpoint* is
what the attacker holds when the scenario succeeds. *Credential authority* is
what the credentials present in that context permit. A *live setting* is a
point-in-time observed repository setting; a *platform invariant* is documented
GitHub behavior; *unknown external state* is anything neither of those
establishes.

**Step 0 -- scenario surface.** Define the scenario and its execution surface
(see "Scenario execution surfaces" below). Running the same artifact, module or
helper in another workflow, command, local-development path, test or operator
context does not by itself import that context into the scenario. Every
security-relevant context left outside a surface must be covered by another
scenario or stated out of scope with a reason, so partitioning hides no threat.

**Step 1 -- successful endpoint.** For each context in the scenario's execution
surface, state what an attacker holds when the scenario succeeds, **including the authority already exercised by any
attacker-controlled code the scenario requires.** A precondition is not
subtracted: if success requires attacker-controlled code already running in a
context, the scenario's Authority Impact accounts for what that code can do in
that context (the repository's method does not exclude precondition
authority, so it is included uniformly). Preventive controls are not part of
this step; they act on Likelihood.

**Step 2 -- classify by reach and context.**

- **High:** (a) arbitrary code execution in a host-ambient context (the
  operator's OS identity with its files, network and cached credentials) or in
  a context whose credentials permit durable repository-content or deployment
  mutation (for example `contents: write` or deployment secrets); (b) a write
  outside the repository containment boundary; (c) a redirect of the root or
  execution target of a privileged operation.
- **Medium:** (a) a write inside the repository root (scoped mutation),
  including inside the intended scope with attacker-influenced content; (b) a
  bounded remote create/update of a durable domain object under a trusted
  credential; (c) arbitrary code execution in an ephemeral CI context whose
  **effective** credential ceiling is KNOWN_NARROW -- read scopes, a
  provider-inference key, or write scopes bounded to pull-request comments and
  metadata -- and grants no durable repository-content or deployment mutation;
  (d) the **conservative placeholder** for a reached authority that is defined
  by an UNKNOWN external credential scope or ceiling (see the unknown-scope
  rule below).
- **Low:** (a) content-only influence (proposal, report or message text); (b) a
  non-mutating, bounded read or use of a credential whose scope is
  KNOWN_NARROW for the action; (c) a rendering or notification effect with no
  stronger privilege.

**Credential-scope states.** Every credential or credential ceiling that
defines a scenario's reached authority is labelled exactly one of:
**KNOWN_NARROW** (repository evidence proves a bounded scope relevant to the
action), **KNOWN_BROAD** (repository evidence proves broader authority), or
**UNKNOWN** (the actual scope, or the platform/repository/organization ceiling
on it, lies outside repository evidence; labelled UNKNOWN_FROM_REPOSITORY where
it depends on a setting that is neither repository-tracked nor otherwise
established by platform semantics or an observed setting). UNKNOWN is epistemic
uncertainty: it is **not** narrow (so it never satisfies Low (b) or Medium
(c)'s narrow-ceiling condition) and it is **not** automatically broad (so it
is never rated High by default).

**Unknown-scope rule (one rule, applied uniformly).** When the reached
authority is defined by the credential's scope -- disclosure or use of the
credential itself, or code that holds it -- and that scope or ceiling is
UNKNOWN, the register value is the **Medium placeholder** (Medium clause (d)).
Each such row carries an explicit upgrade/downgrade condition, an owning open
question (OQ3-4 for caller-supplied Jira/Azure tokens and the AI provider key;
OQ3-9 for change control of the observed GitHub Actions repository settings), and a risk
sensitivity check. The rule does **not** apply where the tool's own bounded
operation, not the credential's scope, defines the reached authority: the
create-only Azure work-item operation of TB-05, TB-06 and TB-19 is Medium under
the remote-write rule regardless of the caller PAT's scope. Where GitHub platform semantics or an
observed repository setting resolves a ceiling, the resolved value is used and
no placeholder is retained.

**Current configuration versus security boundary.** A workflow's declared
credential set (`permissions:`, `GITHUB_TOKEN`, `secrets.*` references,
step conditions) is a **CURRENT CONFIGURATION FACT**. It is a **security
boundary** only if the modeled attacker cannot alter it in the run being
analyzed **and** the platform or repository independently enforces the bound.
If the attacker can alter the workflow the run uses, the analysis rates on the
platform/repository ceiling instead, and an UNKNOWN ceiling falls under the
unknown-scope rule. A malicious workflow cannot necessarily grant itself
arbitrary authority, so the ceiling is analyzed separately from the request and
is neither assumed maximal nor assumed absent. For this repository the
same-repository ceiling is derived in the CI workflow assumptions section: it
includes `contents: write` under TB20-WF-INFERENCE (a derived inference, see the workflow-definition provenance).

**Multi-context scenarios.** Aggregation applies only when a scenario's
execution surface itself spans more than one context and each is a path by
which that same scenario succeeds (checked against the invocation paths, not
assumed): the register value is then the highest authority reached in any of
them, and the application-table row lists the contexts and the reason for the
maximum. It does not apply merely because the same code, module, spec or helper
can run elsewhere; those contexts belong to another scenario or are out of
scope (Step 0).

**Conditional steps.** An `if:` predicate on a credential-bearing step
reduces **Likelihood** (when the path is reachable). It does not reduce
Authority Impact once the scenario reaches the path.

**Credential disclosure.** Classified by the credential-scope state above. A
KNOWN_NARROW credential follows Low (b); an UNKNOWN scope follows the
unknown-scope rule. Disclosure is otherwise Impact, not authority, unless it is
achieved by code that reaches a tier above (Step 1).

**Remote-write rule (Medium vs Low).** A remote write is **Medium** when it
creates or mutates a durable domain object that other processes or people act
on -- a work item in a test-management system (TB-05, TB-06, TB-19). It is
**Low** when it only adds or edits message text in a bounded, already-existing
conversation thread, mutates no other state, carries no executable semantics,
and has a fixed workflow-context destination -- a PR comment (TB-07, TB-08). A
comment is a durable remote object, but its authority is bounded to message
content and notification/rendering effects. The Low classification applies to
message-only authority. Other operations a credential permits -- pull-request
metadata, labels, review creation -- are not message-only; where a scenario's
reached authority is the credential's capability (for example TB-15), they
follow Medium (b) and the credential-scope rules, and are not grouped with
comment content.

### Scenario execution surfaces

Coverage tags for excluded same-code contexts: **COVERED_BY_TB-xx** (another
scenario owns it), **OUT_OF_SCOPE_FOR_THIS_TB** (outside this scenario's defined
surface; a scope statement, not a safety finding and not a recorded risk
acceptance), **OUT_OF_SCOPE_FOR_AISEC3_WITH_RATIONALE**, **NON_SECURITY_TEST_ONLY**
and **NOT_APPLICABLE**. Not every exclusion needs another scenario ID.

| Scenario | Execution surface (defined attack path) | Same-code contexts excluded | Coverage tag and reason |
|---|---|---|---|
| TB-01 | Library caller process that accepts the forged approval and runs #23F/#23G (operator host) | None | NOT_APPLICABLE |
| TB-02 | #23F apply in the receiving checkout | Test execution of the applied files | COVERED_BY_TB-12 |
| TB-03 | #23F re-apply in the repository root | Same | COVERED_BY_TB-12 |
| TB-04 | #23F apply under another project id | Same | COVERED_BY_TB-12 |
| TB-05 | Azure work-item create call (caller process) | None | NOT_APPLICABLE |
| TB-06 | Azure work-item create call with attacker text | None | NOT_APPLICABLE |
| TB-07 | PR-comment step in the triage job | Local runs of the formatter without the job token | NOT_APPLICABLE (no credential, no remote effect) |
| TB-08 | PR-comment upsert in the triage job | Same | NOT_APPLICABLE |
| TB-09 | #23F/#23G against an attacker-chosen root (operator host) | None | NOT_APPLICABLE |
| TB-10 | #23F write inside `cypress/` or `playwright/` (operator host) | Execution of the written file | COVERED_BY_TB-12 |
| TB-11 | #23F write with a swapped path component (operator host) | Execution of the written file | COVERED_BY_TB-12 |
| TB-12 | #23G execution of an approved test file (operator host) | CI execution of the same file | COVERED_BY_TB-17 |
| TB-13 | #23G runner arguments built from crafted path text (operator host) | None | NOT_APPLICABLE |
| TB-14 | #23G-executed code reading host credential files (operator host) | None | NOT_APPLICABLE |
| TB-15 | History collector with `GITHUB_API_URL` in the test and triage jobs and in a local `npm run ai:history` when a token is in the invoking environment; the Jira provider in the caller process | Local runs without the credential | NOT_APPLICABLE (nothing to disclose) |
| TB-16 | Provider process in the operator host (`npm run ai:analyze` locally, or a caller injecting a provider into the generators) and in the triage job (`ai:analyze`) | Unit-test job (real provider module with an injected fake `fetch`); QA Agent evaluation job (evaluators import no provider) | NON_SECURITY_TEST_ONLY (unit-test job); NOT_APPLICABLE (evaluation job). The rating stands on the operational contexts |
| TB-17 | CI test jobs: fork `pull_request` run and `push` to `main` | Pipeline-driven local execution (#23G); manual maintainer invocation of local test commands (`npm run test:e2e`, `cypress:open`) | COVERED_BY_TB-12 (pipeline-driven); OUT_OF_SCOPE_FOR_THIS_TB (manual invocation): a scenario-scope statement, not assessed as safe and not recorded as an accepted risk, and no project decision on it is recorded in SECURITY.md or ROADMAP.md |
| TB-18 | As TB-01, reached through reviewer persuasion (operator host) | None | NOT_APPLICABLE |
| TB-19 | Azure work-item create call on re-invocation | None | NOT_APPLICABLE |
| TB-20 | Triage job for a same-repository actor: `pull_request` and `workflow_dispatch` | Fork runs; `push` to `main`; local `npm run ai:history`; local `npm run ai:analyze` | Fork runs and `main` push: COVERED_BY_TB-17. Local `ai:history`: COVERED_BY_TB-15 when a token is present (its mechanism is credential-destination selection; the run uses the invoker's OS principal and inherited environment), otherwise NOT_APPLICABLE. Local `ai:analyze`: COVERED_BY_TB-16 for provider behavior (the Groq endpoint is a fixed constant, so no destination selection exists); its other risks (prompt injection through test output) belong to AISEC-2 and are OUT_OF_SCOPE_FOR_THIS_TB |

**TB-16 versus TB-17.** Aggregation applies to TB-16 because the threat is
provider behavior and provider execution in the listed operational contexts is
part of the scenario definition. It does not apply to TB-17: operator-host spec
execution is not part of its CI-oriented definition, so it is not imported into
TB-17's Authority Impact (it is OUT_OF_SCOPE_FOR_THIS_TB, not accepted as safe), and TB-17 stays Medium. **TB-20** aggregates
`pull_request` and `workflow_dispatch` because both are paths by which the
same write-access actor, through the same inferred edited-workflow mechanism (TB20-WF-INFERENCE), reaches the
same triage job; the actor requirement (write access) is identical for both.

### Rule applied to every scenario

| Scenario | Successful endpoint | Context | Authority reached | AI | Why (rule clause) |
|---|---|---|---|---|---|
| TB-01 | Forged approval accepted; #23F writes, #23G runs test code | Operator host | Code execution (host-ambient) plus scoped write | High | High (a) |
| TB-02 | Approved change set applied to a second checkout of the same project id | Receiving repository root | Scoped write inside that root | Medium | Medium (a); execution is a separate follow-on (TB-12) |
| TB-03 | Same approved set re-applied after base content restored | Repository root | Scoped write | Medium | Medium (a) |
| TB-04 | Artifact for project A applied under project B's id | Repository root | Scoped write | Medium | Medium (a) |
| TB-05 | Work items created in another org/project under the caller's credential | Azure DevOps, caller PAT/bearer | Bounded remote create of durable domain objects | Medium | Remote rule: domain object |
| TB-06 | Attacker-authored text created as work items | Azure DevOps, caller PAT/bearer | Bounded remote create of durable domain objects | Medium | Remote rule: domain object |
| TB-07 | Attacker-influenced text posted in a PR comment | PR thread, job token | Message content; notification/rendering | Low | Remote rule: message-only, fixed destination |
| TB-08 | A comment containing the marker becomes the upsert target | PR thread, job token | Message edit or failed update | Low | Remote rule: message-only |
| TB-09 | Root redirected to another tree; write and run there | Operator host, attacker-chosen root | Write and code execution outside the intended repository | High | High (a), (b), (c) |
| TB-10 | Denylist normalization failure lets a write reach a path aliasing a protected name | Repository root, inside `cypress/` or `playwright/` | Scoped write inside the framework directories | Medium | Medium (a); see note below |
| TB-11 | Path component swapped so the write lands outside the repository root | Operator host | Write outside containment | High | High (b) |
| TB-12 | Approved test file runs arbitrary code | Operator host | Code execution (host-ambient) | High | High (a) |
| TB-13 | Crafted path text alters runner arguments; unreviewed code executes | Operator host | Code execution (host-ambient), outside reviewed scope | High | High (a) |
| TB-14 | Executing malicious code reads host credential files and sends them out | Operator host (precondition code counted) | Code execution (host-ambient) plus credential files | High | High (a); same endpoint as TB-12, consequence is Impact |
| TB-15 | Job token or Jira token sent to another host | Job token (declared `contents: read`, `actions: read`; triage job also `pull-requests: write`); Jira token scope UNKNOWN (OQ3-4) | Job-token path: comment-body mutation (Low), pull-request metadata mutation (Medium (b), GH-17) and review creation incl. approval while enabled (Medium (b), setting-dependent); Jira path: scope UNKNOWN | Medium | Medium (b) for the job-token path because metadata mutation is not message-only; Medium (d) unknown-scope placeholder for the Jira path; the two paths are rated separately and the job-token Medium (b) stands whatever OQ3-4 resolves |
| TB-16 | Provider code gains side effects and executes in-process | (1) Operator host, when `npm run ai:analyze` is run locally, or a caller process outside this repository injects a provider into the generators (host-ambient; AI key from the host environment); (2) triage job (`ai:analyze`, `AI_API_KEY` plus the persisted checkout credential). Excluded from the surface: the unit-test job (real provider module with an injected fake `fetch`: test execution, not an operational provider path) and the QA Agent evaluation job (evaluators import no provider) | Code execution in the provider's process | High | High (a) in context (1), the maximum under the multi-context rule; context (2) is Medium (c)/(d). The UNKNOWN AI-key scope does not lower it, today's read-only contract describes the current implementation, not the successful endpoint, and the rating does not depend on test execution |
| TB-17 | Spec content executes in a CI test job (unreviewed fork-PR run, or `push` to `main` after merge) | Ephemeral runner; declared read scopes and no `secrets.*` reference; fork runs platform-capped (read-only token, no secrets) | Code execution in a KNOWN_NARROW-ceiling context | Medium | Medium (c) on both paths (one rating covers both: each path's ceiling is Medium (c)); the fork path is capped by the platform, and a spec-only change on the post-merge path cannot alter the merged `main` workflow. Surface: fork `pull_request` CI and `push`-to-`main` CI; operator-local spec execution is outside it (see Scenario execution surfaces) |
| TB-18 | As TB-01 via reviewer persuasion | Operator host | Code execution (host-ambient) plus scoped write | High | High (a) |
| TB-19 | Duplicate work items created on re-invocation | Azure DevOps, caller PAT/bearer | Bounded remote create of durable domain objects | Medium | Remote rule: domain object |
| TB-20 | Same-repository actor's code and workflow run in the triage job (`pull_request` or `workflow_dispatch`) | Ephemeral runner; under TB20-WF-INFERENCE the actor can alter the effective workflow, so the token is what GitHub honors for a same-repository run: `contents: write` reachable (personal-account repository, no organization/enterprise cap); repository default `write` and Actions PR approval enabled (observed) | Code execution in a context whose credentials, under TB20-WF-INFERENCE, permit repository-content mutation (branches, tags, releases; `main` is protected by required checks and a required PR) | High | High (a); risk stays MEDIUM (Low / Medium / High, same triple as TB-13). High rests on TB20-WF-INFERENCE; the fallback is Medium (c)/(d) with MEDIUM risk |

**Comparison notes (auditable distinctions).**

- **TB-20 vs TB-17.** Both are arbitrary code execution in an ephemeral CI
  job; they differ by the credential ceiling the actor can reach. TB-17's
  contexts are bounded independently of the actor -- a fork `pull_request` run
  is capped by the platform to a read-only token without secrets, and a
  spec-only change on the post-merge `push` path cannot alter the merged
  `main` workflow -- Medium (c). TB-20's actor is a same-repository actor whose
  ref's workflow is taken to be the workflow the run uses (a derived inference, see the workflow-definition provenance), so the declared credentials are a
  current configuration fact, not a boundary: under TB20-WF-INFERENCE
  `contents: write` is reachable, which is High (a). Risk stays MEDIUM (Low likelihood, Medium impact, High
  authority impact -- the same triple as TB-13).
- **TB-15.** Two separately rated paths. The job-token path holds Medium (b):
  metadata mutation (GH-17) is not message-only, and review creation including
  approval is added while the Actions PR-approval setting stays enabled; only
  comment-body mutation would be Low. The Jira token's scope is UNKNOWN (OQ3-4),
  so its path is the Medium placeholder (d). Disabling Actions PR approval or
  resolving the Jira scope narrow changes one sub-path, not the aggregate (see the
  TB-15 sensitivity matrix). In CI the job-token path is dominated by TB-20 (an
  actor who can alter `GITHUB_API_URL` through the workflow can already run code
  with the token).
- **TB-16.** The successful endpoint is provider code executing in-process. The
  surface is the operator host (host-ambient) and the triage job; the maximum is
  High (a), so the AI key's UNKNOWN scope neither lowers nor raises the rating.
  Unit-test execution is documented but outside the surface. Impact is unchanged:
  it records the design-level consequence of eroding the provider contract; if
  the endpoint's consequence were rated like TB-12 (High), risk would still be
  MEDIUM.
- **TB-20 vs TB-14.** TB-14's code runs in the operator-host context
  (host-ambient files, network and cached credentials) and is High; TB-20's
  runs in an ephemeral CI context whose token the actor can, under
  TB20-WF-INFERENCE, raise to `contents: write` and is also High, for that
  different reason.
- **TB-11 vs TB-09.** Both reach a write outside the intended repository
  containment (High, clause (b)). TB-09 additionally retargets execution;
  TB-11's endpoint is the write alone. Race dependence lowers TB-11's
  Likelihood, not its Authority Impact.
- **TB-10.** The successful endpoint is a write to a path whose name aliases a
  protected entry but that still lies inside `cypress/` or `playwright/`,
  because the independent framework-prefix layer is not defeated by this
  scenario; root-level `.github/`, `package.json` and `.env*` stay
  unreachable. That is a scoped write (Medium), not High. A joint failure of
  both layers would be a different scenario and is not modeled here.
- **Remote writes.** TB-05, TB-06 and TB-19 create durable work items that
  people and processes act on (Medium); TB-07 and TB-08 change only message
  text in a fixed, already-existing PR thread (Low). TB-19 keeps its canonical
  AT-08 rating (Low / Medium / Medium, MEDIUM).

### CI workflow assumptions (CURRENT CONFIGURATION versus boundary)

Evidence: `.github/workflows/cypress.yml` (`on:` `:3-10`: `push` to `main`,
`pull_request` to `main`, `workflow_dispatch`; workflow-level `permissions:
contents: read` `:17-18`; triage job `:699-716`, `needs` `:701`, `if: always()`
`:702`; checkout `:719`). Responsibility boundary: workflow YAML is
repository-controlled configuration; event semantics belong to the GitHub
platform; repository Actions settings are external configuration.

**Authoritative platform sources and evidence classes** (official GitHub Docs;
retrieved 2026-09-24 from the `github/docs` repository source, whose paths under
`content/` map to `https://docs.github.com/en/<path>`; each page URL returned
HTTP 200 without redirect on that date). Model or fetch-tool summaries and
third-party pages are not used as evidence. One row supports one claim.
Evidence classes: **DIRECT_DOC** (the page states the claim), **DOC_REUSABLE**
(the statement lives in a reusable fragment included by the cited page),
**REPO_OBSERVED** (observed in this repository or its Actions history),
**DERIVED_INFERENCE** (follows from documented facts but is not stated
directly), **UNKNOWN** (the available evidence does not establish it).
Invariants: each evidence row states one atomic claim and carries exactly one
evidence class; a claim that needs several classes is split into premise rows
and a DERIVED_INFERENCE conclusion. **Evidence propagation rule:** a downstream
conclusion cannot carry a stronger evidence status than the weakest premise it
requires (DIRECT_DOC + DIRECT_DOC + DERIVED_INFERENCE gives DERIVED_INFERENCE);
prose, tables and ratings that depend on a derived inference say so or cite its
identifier.

| ID | Claim | Source page (title) | Section | Path under `docs.github.com/en` | Evidence class | Retrieved | Conclusion |
|---|---|---|---|---|---|---|---|
| GH-01 | For `pull_request`, `GITHUB_SHA` is the last merge commit on `GITHUB_REF`, which is `refs/pull/N/merge` | Events that trigger workflows | `pull_request` | `/actions/reference/workflows-and-actions/events-that-trigger-workflows` | DIRECT_DOC | 2026-09-24 | Event context is the PR merge ref |
| GH-02 | By default a `pull_request` workflow runs on `opened`, `synchronize` and `reopened` | Events that trigger workflows | `pull_request` (note) | same as GH-01 | DIRECT_DOC | 2026-09-24 | Runs start on PR open and update, before any review |
| GH-03 | Except for `GITHUB_TOKEN`, secrets are not passed to the runner for a workflow triggered from a forked repository | Using secrets in GitHub Actions | "Using secrets in a workflow" (note) | `/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets` | DOC_REUSABLE | 2026-09-24 | Fork runs get no repository secrets |
| GH-04 | For a fork `pull_request` run, write permissions of the `GITHUB_TOKEN` are changed to read-only unless the private-repository option "Send write tokens to workflows from pull requests" is selected | Workflow syntax for GitHub Actions | "How permissions are calculated for a workflow job"; "Using the `permissions` key for forked repositories" | `/actions/reference/workflows-and-actions/workflow-syntax` | DIRECT_DOC | 2026-09-24 | Fork token is read-only on this public repository |
| GH-05 | The `permissions` key modifies the default `GITHUB_TOKEN` permissions, adding or removing access | Workflow syntax for GitHub Actions | `permissions` (introduction; included reusable `data/reusables/actions/jobs/section-assigning-permissions-to-jobs.md`) | `/actions/reference/workflows-and-actions/workflow-syntax` | DOC_REUSABLE | 2026-09-24 | A workflow edit can change the token's requested scopes |
| GH-06 | A restricted `GITHUB_TOKEN` default set at the enterprise, organization or repository level applies to the relevant repositories | Workflow syntax for GitHub Actions | "How permissions are calculated for a workflow job" | `/actions/reference/workflows-and-actions/workflow-syntax` | DIRECT_DOC | 2026-09-24 | No organization cap applies here: the repository is owned by a personal account (owner type observed) |
| GH-07 | Workflow runs on pull requests to public repositories from some outside contributors need approval according to a repository policy; by default first-time contributors require approval | Managing GitHub Actions settings for a repository | "Controlling changes from forks to workflows in public repositories" | `/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository` | DOC_REUSABLE | 2026-09-24 | Actions workflow approval is a fork execution gate, not PR review |
| GH-08 | The fork-workflow options (read-only token with no secrets, send write tokens, send secrets) are configurable for private (and internal) repositories only | Managing GitHub Actions settings for a repository | "Enabling workflows for forks of private repositories" | same as GH-07 | DOC_REUSABLE | 2026-09-24 | Not applicable to this public repository |
| GH-09 | Whether Actions may create or approve pull requests is a repository setting | Managing GitHub Actions settings for a repository | "Preventing GitHub Actions from creating or approving pull requests" | `/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository` | DIRECT_DOC | 2026-09-24 | Observed enabled (point-in-time), so a setting, not an invariant |
| GH-10 | `workflow_dispatch` triggers a run only if the workflow file exists on the default branch | Manually running a workflow | Introduction | `/actions/how-tos/manage-workflow-runs/manually-run-a-workflow` | DIRECT_DOC | 2026-09-24 | `cypress.yml` exists on `main` |
| GH-11 | Manually running a workflow requires write access to the repository | Manually running a workflow | Introduction (permissions statement, reusable) | same as GH-10 | DOC_REUSABLE | 2026-09-24 | Actor requirement for the dispatch route |
| GH-12 | A dispatch can select a branch or tag (UI branch dropdown; `gh workflow run --ref`; REST `ref`) | Manually running a workflow | "Running a workflow"; "Running a workflow using the REST API" | same as GH-10 | DIRECT_DOC | 2026-09-24 | The actor can choose the ref that runs |
| GH-13 | For `workflow_dispatch`, `GITHUB_SHA` is the last commit on `GITHUB_REF`, the branch or tag that received the dispatch | Events that trigger workflows | `workflow_dispatch` | `/actions/reference/workflows-and-actions/events-that-trigger-workflows` | DIRECT_DOC | 2026-09-24 | Code revision is the selected ref's last commit |
| GH-14 | A `branches` filter on `push` restricts the workflow to pushes to the listed branches | Events that trigger workflows | "Running your workflow only when a push to specific branches occurs" | same as GH-01 | DIRECT_DOC | 2026-09-24 | Pushes to other branches do not start this workflow |
| GH-15 | `pull_request_target` runs in the context of the default branch of the base repository "rather than in the context of the merge commit, as the `pull_request` event does" | Events that trigger workflows | `pull_request_target` | same as GH-01 | DIRECT_DOC | 2026-09-24 | `pull_request` runs in the PR merge-commit context |
| GH-16 | A pull request can propose changes to the repository's GitHub Actions workflows | Managing GitHub Actions settings for a repository | "Controlling changes from forks to workflows in public repositories" | `/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository` | DOC_REUSABLE | 2026-09-24 | Establishes only that workflow changes can be proposed; that a proposed definition governs the run is DERIVED_INFERENCE (TB20-WF-INFERENCE) |
| GH-17 | `pull-requests: write` permits an action to add a label to a pull request | Workflow syntax for GitHub Actions | `permissions` (introduction; scope-description reusable `data/reusables/actions/github-token-scope-descriptions.md`, included through `data/reusables/actions/jobs/section-assigning-permissions-to-jobs.md`) | `/actions/reference/workflows-and-actions/workflow-syntax` | DOC_REUSABLE | 2026-09-24 | Label mutation is a documented non-comment pull-request state change under the scope; it does not by itself establish other metadata operations |
| GH-18 | The `GITHUB_TOKEN` permissions start from the enterprise, organization or repository default and are then adjusted by the workflow-level and job-level `permissions` configuration | Workflow syntax for GitHub Actions | "How permissions are calculated for a workflow job" | `/actions/reference/workflows-and-actions/workflow-syntax` | DIRECT_DOC | 2026-09-24 | Workflow-file `permissions` govern the token after the default |
| GH-19 | The `permissions` key can modify `GITHUB_TOKEN` permissions for an entire workflow or for individual jobs | Use GITHUB_TOKEN for authentication in workflows | "Modifying the permissions for the `GITHUB_TOKEN`" | `/actions/tutorials/authenticate-with-github_token` | DIRECT_DOC | 2026-09-24 | Independent source for the same modification mechanism as GH-05 |
| GH-20 | Under the first-time-contributor approval policies, a user who has had a commit or pull request merged into the repository does not require approval | Managing GitHub Actions settings for a repository | "Controlling changes from forks to workflows in public repositories" | `/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository` | DOC_REUSABLE | 2026-09-24 | Approval is not a durable gate for returning contributors |
| GH-21 | New personal-account repositories default to not allowing Actions to create or approve pull requests | Managing GitHub Actions settings for a repository | "Preventing GitHub Actions from creating or approving pull requests" | `/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository` | DIRECT_DOC | 2026-09-24 | The observed enabled value differs from the default, so it is a changed setting |
| RO-01 | This repository's Actions history contains `workflow_dispatch` runs on non-default branches (runs 31123260611, 31125713055, 34230565551) | GitHub Actions run records (REST API, read-only) | -- | -- | REPO_OBSERVED | 2026-09-24 | Ref selection is used in practice |
| RO-02 | `cypress.yml` (`:926-937`) comments that `pull_request_target` would run workflow code from the base branch against fork content, which the authors chose not to use | `.github/workflows/cypress.yml` | comment | -- | REPO_OBSERVED | 2026-09-24 | Consistent with GH-15; an author comment, not authoritative evidence |
| RO-03 | In those three runs the branch workflow's step list matched `main`'s at the time | Actions run records and git history (read-only) | -- | -- | REPO_OBSERVED | 2026-09-24 | Non-discriminating: it does not show which workflow definition a dispatch uses |

**Workflow-definition provenance (TB-20).** The threat reasoning needs four
separate answers per event, each with its own evidence class.

| Question | `pull_request`, same repository | `workflow_dispatch` |
|---|---|---|
| Event context / `GITHUB_SHA` and `GITHUB_REF` | The PR merge ref and last merge commit (GH-01, DIRECT_DOC) | The dispatched ref and its last commit (GH-13, DIRECT_DOC) |
| Which ref the actor can select or influence | The PR branch content (an ordinary PR) | Any branch or tag, with write access (GH-11, GH-12, DIRECT_DOC and DOC_REUSABLE) |
| Checked-out code revision | The merge commit (DERIVED_INFERENCE from GH-01, GH-15) | The dispatched ref's commit (DERIVED_INFERENCE from GH-13) |
| Workflow-definition (YAML) revision | The merge revision: DERIVED_INFERENCE. Documented premises: the event runs in the merge-commit context (GH-01, GH-15) and a pull request can propose workflow-file changes (GH-16). Not documented: that the proposed workflow definition governs the run (this is TB20-WF-INFERENCE) | The selected ref's file: DERIVED_INFERENCE from GH-13; no cited page states it directly, and RO-01 with RO-03 does not demonstrate it (UNKNOWN as a direct statement) |
| Attacker can modify the effective workflow / `permissions` | DERIVED_INFERENCE (TB20-WF-INFERENCE: the rows above plus GH-05, GH-18 and GH-19) | DERIVED_INFERENCE, weaker (TB20-WF-INFERENCE; depends on the row above) |

**TB20-WF-INFERENCE.** The effective workflow definition of a same-repository
`pull_request` run (Path A) or `workflow_dispatch` run (Path B) is treated as
attacker-modifiable, including its `permissions:` block and step predicates.
Path A is a DERIVED_INFERENCE from GH-01 and GH-15 (event context) and GH-16
(a PR can propose workflow-file changes), with GH-05, GH-18 and GH-19 for the
permission mechanism. Path B is a weaker DERIVED_INFERENCE from GH-12 and GH-13:
no cited page says the selected ref's file is the definition used. Under the
propagation rule, every statement that depends on attacker-modifiable workflow
YAML inherits this status; the identifier TB20-WF-INFERENCE marks those
statements.

**TB-20 paths and evidence strength.** *Path A, same-repository
`pull_request`*: the effective-workflow premise is a transparent inference from
documented facts (GH-01, GH-15, GH-16, GH-05) and is the primary basis for High.
*Path B, `workflow_dispatch`*: the same premise with weaker support (no direct
statement). The rating rests on Path A and does not depend on Path B: if the
inference failed for both paths, TB-20 would fall back to the declared
permissions (`contents: read`, `actions: read`, `pull-requests: write`, one AI
key), which is Medium (c)/(d), and the risk would remain MEDIUM. The register
therefore keeps High as the current, inference-supported rating and records this
sensitivity; a direct-doc or empirical confirmation would remove the
qualification. Mechanism confidence and risk-label robustness are separate:
the mechanism (and TB-20's High authority) depends on TB20-WF-INFERENCE, while
the MEDIUM risk label holds whether or not it does; a stable label is not
evidence for the mechanism.

**Repository settings observed** (point-in-time, 2026-09-24, read through the
GitHub REST API with the owner's authenticated CLI; not tracked in the
repository and able to change -- see OQ3-9). No secret value was read.

| Setting | Observed |
|---|---|
| Visibility / owner type / fork | public / `User` (personal account) / not a fork |
| Default workflow permissions | `write` (the workflow-level `permissions: contents: read` declaration overrides it for this workflow) |
| Actions may create/approve pull requests | enabled |
| Fork PR contributor approval policy | `first_time_contributors` |
| Classic protection on `main` | required status checks (5 contexts; "QA AI triage" is not required), required approving reviews 0, admins enforced |
| Repository ruleset `main` | present, enforcement `disabled` |
| Actions secrets / environments | 1 (`GROQ_API_KEY`) / 0 |
| Allowed actions | all |

**Event matrix (TB-17 and TB-20).**

| Event | Actor requirements | Code source | Workflow source | Workflow mutable by the actor? | Token maximum | Secrets | Pre-execution gate | Reachable by the modeled attacker? | Included in TB-20? | Reason |
|---|---|---|---|---|---|---|---|---|---|---|
| `pull_request`, same repository | Write access; open or update a PR | PR merge commit | PR merge revision (DERIVED_INFERENCE, see workflow-definition provenance) | Yes (inferred) | Under TB20-WF-INFERENCE, `contents: write` and `pull-requests: write` requestable; no organization cap | `GROQ_API_KEY` | None: the run starts on open, synchronize and reopen, before any review; review is a process expectation and 0 approvals are required | Yes | Yes (primary path) | Under TB20-WF-INFERENCE the actor edits `permissions:` and steps |
| `pull_request`, fork | Any GitHub user | PR merge commit | PR merge commit | Yes as content, capped by the platform | Read-only token | None | Actions workflow approval for first-time contributors (`first_time_contributors`, observed); not PR review | Yes | No (TB-17 fork path) | The platform cap removes secrets and write scopes; the private-repository fork options do not apply to this public repository |
| `workflow_dispatch` | Write access; the workflow exists on `main` | Selected ref | Selected ref's workflow file (DERIVED_INFERENCE; no direct statement) | Yes (inferred; pick the actor's branch) | As above | `GROQ_API_KEY` | Write access only; no PR and no review | Yes | Yes (second path; no PR record, same precondition) | The triage job's `if: always()` (`:702`) does not depend on the event; the PR-comment steps are gated on `github.event_name == 'pull_request'` (`:939`) |
| `push` to `main` | Merge a PR into protected `main` | `main` | `main` | Only through the merged change | As declared on `main` | `GROQ_API_KEY` for the triage job | PR required, required status checks, admins enforced; human approval not required (0) | Only via a merge | No (TB-17 post-merge path) | Not a direct actor route; a spec-only change cannot alter the workflow |
| `push` to another branch | Write access | n/a | n/a | n/a | n/a | n/a | n/a | No | No | `on.push.branches` lists only `main`, so no run starts |

**Gate terminology.** A **technical execution gate** is a mechanism that
prevents a workflow, job or code from running until a condition is satisfied. A
**process or governance expectation** (such as review practice) may occur but
does not technically prevent execution. For ordinary `pull_request` and
`workflow_dispatch` runs, PR review is a process expectation, not a technical
execution gate. Three things are kept distinct throughout: (1) **Actions
workflow approval** for fork contributors is an execution gate for the
contributors the policy covers (per GH-07 a contributor who already has a
commit or pull request merged does not need it); (2) **required status checks**
(5 observed on `main`) are automated merge conditions, not human review or
approval; (3) **PR review** (an approving review) is code-review governance,
and `main` currently requires 0 approving reviews. Code on `main` is
therefore described as *merged*, not *reviewed*.

**TB-17 combined rating.** The fork path (unreviewed code, read-only token, no
secrets, first-time-contributor approval policy) and the post-merge path
(spec-only content through a PR, declared `main` workflow) each reach Medium
(c), so one Authority Impact rating covers both. PR review is not counted as a
technical gate for either: on `pull_request` the run precedes review, and on
`main` no human approval is technically required.

**Step conditions and Likelihood.** The `ai:history` step runs only when the
Playwright job failed (`if: needs.playwright-tests.result == 'failure'`,
`:851`; token `:853`), and `ai:analyze` only when `has-failures` is true
(`if: steps.aggregate.outputs.has-failures == 'true'`, `:905`; key `:910`; run
`:911`). `has-failures` is set by the "Aggregate browser inputs" step
(`:875-883`): it is `true` exactly when `reports/ai/context.json` exists
after running `node scripts/targets/targomo/aggregate-browser-context.js` from
the run's checkout, so the actor's own code, not only a failing test, can
satisfy it, and, under TB20-WF-INFERENCE, a same-repository actor can also edit the predicates. The
conditions reduce how often the credential-bearing steps run in normal
operation (Likelihood in the unmodified workflow); they give no protection
against this actor and do not lower Authority Impact. TB-20's Likelihood stays
Low: it requires write access, and the change is visible in the PR diff or the
run history, even though the run precedes any review.

**`pull-requests: write` capability.** Repository-proven use: the comment
upsert only (`upsertPrComment`, called at `:975-986` through
`actions/github-script`). Platform capability (documentation-derived, GH-09): the
permission covers pull-request comments and metadata and creating pull-request
reviews. Actions PR approval is **observed enabled** (point-in-time), so an
approving review by the workflow token is currently possible; because `main`
requires 0 approving reviews, an approval does not currently gate a merge. This
is separate from `contents: write` reachability. The Low classification in the
remote-write rule applies to the authority of the comment content the repository
actually posts (TB-07, TB-08), not to everything the credential could do.

### Live-settings drift sensitivity

**Principle.** Live GitHub repository settings are point-in-time observations
(2026-09-24), not immutable properties of the repository. If a setting changes,
the affected scenario rows must be re-evaluated against the changed authority or
gate configuration. Each row below separates the **current observed rating**
(what the register states) from **if the setting changes** (hypothetical); no
current rating changes because a setting might drift later.

| Setting (observed) | Affected TB | If changed | Authority / risk sensitivity | Revalidation owner |
|---|---|---|---|---|
| Actions may create/approve PRs: enabled | TB-15 (job-token path), TB-20 | If disabled: the review-creation (approval) operation disappears from the job token | TB-15: the job-token path keeps Medium (b) because metadata mutation remains (GH-17), so the aggregate is unchanged (matrix below). TB-20: none (High comes from the inferred `contents: write` reach) | Repository administrator + AISEC-6 |
| Default workflow permission: `write` | TB-20, TB-17 | If changed to read | Limited sensitivity: the workflow declares its own `permissions` and, under TB20-WF-INFERENCE, a same-repository actor can edit them (GH-05, GH-18), so TB-20 stays High (with that qualification) and TB-17 is unaffected | Repository administrator + AISEC-6 |
| Fork PR approval policy: `first_time_contributors` | TB-17 (fork path) | If tightened or loosened | Changes Likelihood (whether a fork run starts without approval); Authority Impact stays Medium because the platform cap (read-only token, no secrets) is unchanged | Repository administrator |
| `main` required approving reviews: 0 | TB-17 (main-push path), TB-20 | If raised to 1 or more | The merge path to `main` gains a technical human-approval requirement; `pull_request` and `workflow_dispatch` runs still start before review, so TB-20 and the fork path are not made "reviewed" | Repository administrator + AISEC-6 |
| `main` required status checks: 5 | TB-17 (main-push path) | If changed | Automated merge conditions only; not a review substitute; no Authority Impact effect | Repository administrator |
| Ruleset `main`: enforcement disabled | TB-20 | If enabled | It can only add restrictions on protected refs; TB-20 stays High (under TB20-WF-INFERENCE) because `contents: write` still reaches other branches and tags | Repository administrator |
| Actions secrets: 1 (`GROQ_API_KEY`); environments: 0 | TB-20, TB-16 | If secrets or protected environments are added | More secrets raise Impact, not the authority tier; an environment protection could gate the secret-holding path and would need TB-20's surface re-derived | Repository administrator + AISEC-6 |
| Repository visibility: public | TB-17 (fork path) | If made private | The private-repository fork options (GH-08) would apply and could raise the fork ceiling; TB-17's fork path would need re-rating | Repository administrator |

**TB-15 job-token operations (kept separate).**

| Operation under `pull-requests: write` | Reachable | Repository-proven use | Setting-dependent | Authority tier |
|---|---|---|---|---|
| Comment-body create/update | Yes | Yes (`upsertPrComment`) | No | Low (message-only) |
| Pull-request metadata mutation (documented example: adding a label, GH-17) | Yes (platform capability) | No | No | Medium (b) (not message-only) |
| Review creation including approval | Only while Actions PR approval is enabled (observed) | No | Yes (point-in-time) | Medium (b) |
| Other pull-request state mutation | Not established by the cited documentation | No | -- | UNKNOWN, not relied upon |

**TB-15 sensitivity matrix.** The Jira path is rated separately from the
job-token path.

| Condition | GitHub-token subpath | Jira subpath | TB-15 aggregate Authority Impact | TB-15 risk |
|---|---|---|---|---|
| Current observed | Medium (b) | Medium (d), scope UNKNOWN | Medium | MEDIUM |
| Actions PR approval disabled | Medium (b) (metadata mutation remains) | Medium (d) | Medium | MEDIUM |
| Jira scope resolves KNOWN_NARROW | Medium (b) | Low (b) | Medium | MEDIUM |
| Both | Medium (b) | Low (b) | Medium | MEDIUM |

The aggregate would fall to Low only if the triage job's declared
`pull-requests: write` were removed -- a workflow change, not a setting drift --
and the Jira scope also resolved KNOWN_NARROW.

**Revalidation trigger and owner.** The repository administrator, with AISEC-6
(governance ADR, as in OQ3-9), revalidates the affected rows when any setting
above changes, when the workflow's triggers or `permissions` change, or when
this study is next reviewed. Repository-tracked facts (workflow YAML, code) are
re-verified from source; live settings are re-read from the GitHub API.

### Register

| ID | Likelihood | Impact | Authority Impact | Risk | Source class |
|---|---|---|---|---|---|
| TB-01 | Medium | High | High | **CRITICAL** | AT_REFINED (AT-07) |
| TB-12 | Low-Med | High | High | **HIGH** | SECURITY_MD_DERIVED |
| TB-18 | Low-Med | High | High | **HIGH** | COMPOUND_PRIOR (AT-07 + PI-08) |
| TB-02 | Low | Medium | Medium | MEDIUM | NEW |
| TB-04 | Low | Medium | Medium | MEDIUM | NEW |
| TB-05 | Low | Medium | Medium | MEDIUM | AT_REFINED (AT-04) |
| TB-06 | Low-Med | Medium | Medium | MEDIUM | NEW |
| TB-09 | Low | High | High | MEDIUM | NEW |
| TB-10 | Low | High | Medium | MEDIUM | NEW (unverified) |
| TB-11 | Low | High | High | MEDIUM | SECURITY_MD_DERIVED |
| TB-13 | Low | Medium | High | MEDIUM | NEW |
| TB-14 | Low | High | High | MEDIUM | NEW |
| TB-15 | Low | Medium | Medium | MEDIUM | NEW |
| TB-16 | Low | Medium | High | MEDIUM | NEW (design) |
| TB-17 | Low-Med | Medium | Medium | MEDIUM | NEW |
| TB-19 | Low | Medium | Medium | MEDIUM | AT_REFINED (AT-08) |
| TB-20 | Low | Medium | High | MEDIUM | NEW (platform trust) |
| TB-07 | Medium | Low | Low | LOW-MED | NEW |
| TB-03 | Low | Low | Medium | LOW | NEW |
| TB-08 | Low-Med | Low | Low | LOW | NEW |

### Counts (mechanically derivable from the register)

| Source class | Scenarios | n |
|---|---|---|
| AT_REFINED (canonical AISEC-1 scenario, rating preserved) | TB-01 (AT-07), TB-05 (AT-04), TB-19 (AT-08) | 3 |
| COMPOUND_PRIOR | TB-18 (AT-07 + PI-08) | 1 |
| SECURITY_MD_DERIVED | TB-11, TB-12 | 2 |
| NEW | TB-02, TB-03, TB-04, TB-06, TB-07, TB-08, TB-09, TB-10, TB-13, TB-14, TB-15, TB-16, TB-17, TB-20 | 14 |
| **TOTAL** | | **20** |

No scenario is a pure carry-over of a canonical scenario; the three AT_REFINED
rows preserve their canonical ratings exactly:

| Scenario | Canonical | Canonical L / I / AI | Canonical risk | Rating here |
|---|---|---|---|---|
| TB-01 | AT-07 | Medium / High / High | CRITICAL | identical |
| TB-05 | AT-04 | Low / Medium / Medium | MEDIUM | identical |
| TB-19 | AT-08 | Low / Medium / Medium | MEDIUM | identical |

Summary: **CRITICAL 1, HIGH 2, MEDIUM 14, LOW 2, LOW-MED 1 (LOW-class total 3),
total 20.** AT-16, AT-03 / PI-06 and PI-04 are carried forward below and are
not re-rated. TB-18's HIGH is an AISEC-3 compound rating, not an inherited
canonical rating. These are **system security risks**, not artifact defects.

**Consequences carried forward (not remediated by this study):**

- **PI-04** (execution stdout/stderr into the regeneration prompt, MEDIUM,
  AISEC-2): the *authority* consequence is bounded to `PROPOSAL` for the
  regenerated change set, which must clear a fresh `#23E` record. Its
  credential consequence is the reverse direction: the output text is
  produced by a child whose environment excludes variable-borne secrets, and
  `redactSecrets()` further scrubs credential-shaped strings. It does not
  remove TB-14 (file-borne credentials could still appear in output).
- **PI-06 / AT-03** (generated content re-entry, HIGH): its authority
  consequence is that a successfully propagated influence can ultimately shape
  the *content* of an approved file (TB-12) but cannot change *scope* (path)
  or *approve* anything; the approval object remains the decisive gate, which
  is exactly why TB-01 (approval authenticity) dominates the chain.

## 29. Least-privilege analysis

| Credential / tool | Classification | Basis |
|---|---|---|
| Workflow-level `GITHUB_TOKEN` | `LEAST_PRIVILEGE_CONFIRMED` (declared) | Workflow default `contents: read`; each job restates its needs; comments in the workflow justify `actions: read` and `pull-requests: write` per job |
| Triage job token (`pull-requests: write`) | `LEAST_PRIVILEGE_CONFIRMED` (declared) | Needed only to upsert one comment; no `contents: write`, no issue creation |
| `dependency-review.yml` token (`pull-requests: write`) | `LEAST_PRIVILEGE_CONFIRMED` (declared) | Stated as required by `comment-summary-in-pr: always` |
| Persisted checkout credential | `UNKNOWN` (INFERRED not required) | History collection passes the token explicitly through step `env`, suggesting the persisted copy is not needed; not proven |
| AI provider key | `UNKNOWN` | Provider-side scope is not stated in the repository; not claimed broader than required |
| Jira / Azure caller tokens | `UNKNOWN` | Scopes are supplied by callers and are not visible to the repository |
| Child-process `HOME`/`APPDATA`/`USERPROFILE`/`LOCALAPPDATA` pass-through | `UNKNOWN` | In-source justification exists; minimum requirement not verified |
| `#23F` writer authority | `LEAST_PRIVILEGE_CONFIRMED` (path-scope) | Creates/modifies only; no delete; framework prefix; protected areas |
| `#23G` executor | `NOT_APPLICABLE` as a credential question; authority is full OS-process (documented) | SECURITY.md §25 |

No claim of "broader than required" is made without evidence of actual scopes.

## 30. Fail-closed analysis

Verified from source, not assumed:

| Condition | Behavior | Class |
|---|---|---|
| Missing/invalid review record or digest mismatch (`#23F`) | `ok:false`, zero writes | **fail closed** |
| Invalid `expectedProjectId` / project mismatch | rejection (`PROJECT_MISMATCH`) | fail closed |
| Invalid or non-directory `repositoryRoot` | rejection before any write/spawn | fail closed |
| Unsafe/protected/out-of-prefix path | whole-batch rejection, zero writes | fail closed |
| Partial write failure | rollback; status `ROLLED_BACK` or `ROLLBACK_INCOMPLETE` | fail-safe **but** an incomplete-rollback state exists and is reported, not hidden |
| Unknown framework, no recognized target, unsafe target (`#23G`) | refusal, zero spawn | fail closed |
| Missing provider key | constructor `CONFIGURATION` error; no fallback to the mock | fail closed |
| GitHub history fetch failure | `{available:false}` written; run continues | **fail soft** on optional *evidence* (no authority granted) |
| PR comment failure | warning, job continues | fail soft on a non-authoritative side effect |
| Provider transport failure | up to 3 attempts against the same provider | bounded retry; no authority effect |
| Regeneration ineligible | zero provider calls | fail closed |
| Ambiguous publish outcome | stops further items; no retry | fail closed on duplication |

The one place the pipeline does **not** fail closed on an *authority* question
is unauthenticated approval (TB-01): a record-shaped, digest-valid object is
accepted as approval by construction.

## 31. Retry / replay analysis

- AI provider calls: up to 3 attempts, same provider, only for retryable
  transport failures (SECURITY.md §10).
- Structural correction loops: one bounded correction attempt per generation
  call (AISEC-2 §16).
- Regeneration: `MAX_REGENERATION_ATTEMPTS = 1` **per call**, not a
  cross-session limit (SECURITY.md §26); a regenerated proposal needs a fresh
  `#23E` record.
- Publishing: no automatic retry; no idempotency key.
- Execution: no automatic retry.
- **Approval scope:** an approval covers **one exact content snapshot**, not a
  class of future actions (package digest), but is **not single-use** and has
  **no expiry** (§17).

## 32. Auditability

| Evidence | Present | Notes |
|---|---|---|
| Review record: reviewer id, timestamp, decisions, comment | Yes | Caller-supplied, unauthenticated |
| `AppliedChangeSetRecord` | Yes | Digests of change set, review package and review record; per-change before/after digests; status; `appliedAt`. **No** reviewer id, **no** repository root |
| `AutomationExecutionRecord` | Yes | Project, applied-record digest, framework, command label, status, exit code, bounded stdout/stderr, timestamps. **No** credential class, **no** root |
| Persistence and tamper resistance | Caller's responsibility | Records are return values; digests are unkeyed |
| Credential identity/class used | Not recorded by the pipeline | GitHub Actions logs provide platform-level evidence for CI only |
| Publishing result | Yes (`CREATED`/`FAILED` items, validated) | No approver identity (the publishing path has no approval object) |

Logging is not authorization: the records prove *what content* was handled,
not *who* was authorized.

## 33. Verification requirements

Testable requirements for AISEC-5/AISEC-7 (concepts only; no harness built
here). "Expected today" states the behavior the current source would show.

| ID | Requirement | Expected today |
|---|---|---|
| VR-01 | A review record whose `reviewerId` is not an authenticated principal must be rejected | **FAILS today** (accepted) -- documents TB-01 |
| VR-02 | A record built by hand with a recomputed digest must be rejected | **FAILS today** -- documents TB-01 |
| VR-03 | A valid record for changed content must be rejected | PASSES today (digest mismatch) |
| VR-04 | An approval for project A must not apply to project B | PASSES today (string equality) |
| VR-05 | An approval must not apply to a different repository root/identity | **FAILS today** if base digests match -- documents TB-02 |
| VR-06 | A consumed approval must not apply a second time | Blocked only by state (TB-03) |
| VR-07 | Protected paths (each denylist entry and normalization variants) must be rejected | Entries PASS; variants UNKNOWN (TB-10) |
| VR-08 | Unsafe or unrecognized execution targets must refuse with zero spawn | PASSES today |
| VR-09 | The child environment must contain no allowlist-external variable | PASSES today |
| VR-10 | A credential-identity mismatch (token vs org/project) must fail | **NOT IMPLEMENTED** (no check exists) |
| VR-11 | Publishing destination must match source project identity | **NOT IMPLEMENTED** (AT-04) |
| VR-12 | Comment update must not target a comment authored by another user | UNKNOWN (TB-08, platform behavior) |
| VR-13 | Unauthenticated approval must not reach `#23G` | **FAILS today** (TB-01 chain) |

## 34. Open questions

| ID | Question | Evidence checked | Why unresolved | Owner | Blocking AISEC-3 closure? |
|---|---|---|---|---|---|
| OQ3-1 | Does a production orchestrator exist outside this repository, and how does it construct approvals and choose `repositoryRoot`? | Tracked-file search (`git grep`) for callers; package `files`/`exports` | Outside repository | AISEC-6 (ADR) + project owner | No -- all conclusions are stated at library-contract level and hold for any caller |
| OQ3-2 | How does the protected-path denylist behave for Windows short names, alternate streams, trailing dots/spaces? | Pattern source (`generated-change-set.js:125-134`) | Static analysis only; empirical test not run | AISEC-7 | No -- rated MEDIUM and marked UNVERIFIED |
| OQ3-3 | Does the GitHub API permit `updateComment` on another user's comment with `pull-requests: write`? | `pr-comment-client.js` source | Platform behavior | AISEC-7 | No -- TB-08 rated LOW with the uncertainty stated |
| OQ3-4 | What are the actual scopes of caller-supplied Jira/Azure tokens and the AI provider key? | Source and workflow declarations | Values and scopes are not in the repository | AISEC-6 (credential ownership ADR) + operator | No -- classified UNKNOWN, not claimed broad; also owns the Jira scope in TB-15 (Medium placeholder under the unknown-scope rule); the AI-key scope does not change TB-16 or TB-20, which are rated on their execution context |
| OQ3-5 | Is the persisted checkout credential intended/needed by test jobs? | `cypress.yml` (6 checkout uses; 8 across the three inspected workflows; none sets `persist-credentials: false`) | Intent not documented | AISEC-6 | No -- TB-17 states the fact without claiming it is unintended |
| OQ3-6 | Who owns the reviewer-facing display, and must it label content provenance (system / model / human)? | No display code was identified (§6, §16) | Design decision | AISEC-6 | No -- resolves AISEC-2 OQ-1 factually (no layer exists) and hands the design to the ADR |
| OQ3-7 | Should approvals bind `repositoryRoot`/repository identity and carry a nonce or expiry? | §17-§18 | Design decision | AISEC-6 | No |
| OQ3-8 | Should `#23G` re-validate the review record, not only the applied record? | §21 | Design decision | AISEC-6 | No |
| OQ3-9 | Are the observed repository Actions settings (default workflow permission `write`, Actions PR approval enabled, first-time-contributor fork approval, classic `main` protection with 0 required approving reviews, the disabled `main` ruleset) intended and under change control? | Settings read through the GitHub REST API on 2026-09-24 (point-in-time); `cypress.yml` | Settings are not versioned in the repository and can change | Repository administrator + AISEC-6 | No -- ratings use the observed values and state them as point-in-time |

**OQ3-9 scope and evidence strength.** OQ3-9 asks only about configuration governance (whether the observed settings are intended, under change control and revalidated); it does not re-open documented GitHub behavior. The cited official documentation directly establishes how `GITHUB_TOKEN` permissions are calculated and restricted (GH-06, GH-18), the fork read-only token and secret exclusion (GH-03, GH-04), that the fork-workflow options are private-repository-only (GH-08), that `workflow_dispatch` needs the workflow on the default branch, requires write access and accepts a branch or tag ref (GH-10, GH-11, GH-12, GH-13), and that a pull request can propose workflow changes (GH-16); the absence of an organization cap comes from the observed owner type of a personal account, not from documentation. It does **not** directly establish that a proposed or dispatched-ref workflow definition governs a given run. That premise (TB20-WF-INFERENCE), and with it the same-repository `contents: write` reach and the workflow-definition revision of a dispatched run, remain DERIVED_INFERENCE with the stated fallback (Authority Impact Medium, risk MEDIUM) and are not treated as settled by GitHub documentation. The study carries this as an inference with a sensitivity statement rather than as a separate open question.

| Sub-question | Repository source can answer? | GitHub docs can answer? | Needs admin evidence? | Owner | Blocking? |
|---|---|---|---|---|---|
| Is enabling Actions PR approval intended, given `main` requires 0 approving reviews? | No | No | Yes | Repository administrator | No |
| Is the `main` ruleset's disabled enforcement intentional? | No | No | Yes | Repository administrator | No |
| Should `default_workflow_permissions` remain `write`, given the workflow declares its own `permissions:`? | No | No | Yes | Repository administrator + AISEC-6 | No |

## 35. AISEC-4 handoff

Exfiltration and isolation items surfaced here: TB-14 (credential-file reach
and unrestricted network from approved code), TB-15 (env/caller-selected
credential destinations), TB-20 (secret-holding CI step runs same-repo PR
code), TB-06 (publishing as an egress/laundering channel), TB-04 (project id
is an unanchored string), the process-wide AI key (§42), and the destination
identity cross-check for TB-05 (AT-04). No exfiltration control is designed
here.

## 36. AISEC-5 / AISEC-7 handoff

The VR list (§33) is the concrete verification input, including the
deliberately failing-today cases (VR-01, VR-02, VR-05, VR-10, VR-11, VR-13)
that document current gaps rather than pass/fail regressions. Priority
fixtures: forged-approval acceptance (TB-01), cross-root replay (TB-02),
denylist normalization (TB-10), argument-injection classifier cases (TB-13),
comment-marker hijack (TB-08). Fixtures must be inert (no real credentials, no
external calls).

## 37. AISEC-6 handoff

Decisions requiring ADR treatment: (a) the reviewer identity model and how an
approval becomes authenticated (AT-07 / TB-01, TB-18), including whether the
repository's own exact-head Git review precedent can be reused; (b) approval
binding scope -- repository root/identity, destination, nonce/expiry,
single-use (TB-02/03/04, OQ3-7); (c) credential ownership and scope
documentation per credential class (OQ3-4); (d) the execution trust model --
whether "not a sandbox" is an accepted permanent posture (TB-12/14, OQ3-8);
(e) the provider privilege model (TB-16); (f) CI credential policy, including
`persist-credentials` (OQ3-5) and the same-repo PR trust assumption (TB-20);
(g) the orchestrator boundary and who the acting principal is (OQ3-1); (h) the
reviewer-display provenance requirement (OQ3-6). Future `MEM` handoff: a
memory *write* is a side effect and must be bound to the same authorization
dimensions as `#23F` (artifact, project, root/store identity, authenticated
principal, freshness); retrieval must never carry authority from storage.

## 38. Non-goals and assumptions

This document does not: implement any control; change any prompt, provider,
credential, review, write or execution code; test against a live system; read
or record any credential value; design authentication, isolation, or the
adversarial harness; implement `MEM`/`RAG`/`LEARN`.

```text
Assumptions
main SHA:                       d50883256ee3b15cce9e82a733e9373a84fce8ae
AISEC-1 / AISEC-2:              COMPLETE_ON_MAIN
AISEC-3 execution:               this document (research only) -- roadmap
                                  AISEC-3 execution NOT_STARTED before this branch
AISEC-4..AISEC-7:                NOT_STARTED
MEM/RAG/LEARN:                   NOT_STARTED
```

Conclusions must be revalidated if main advances materially before this
document merges or before `AISEC-4` begins.

## 39. Current vs planned controls

**CURRENT** (source-verified in this study): per-job declared `permissions`
and absence of `pull_request_target`; step-scoped provider key; hard-coded
provider hosts; pinned Azure host with `redirect: "manual"` on all outbound
requirement/destination requests; `CREATE_ONLY` no-retry publishing;
digest-bound approval validation with stale-approval protection and derived
status; `#23F` containment, symlink/hardlink and base-digest checks with
rollback; protected-path denylist plus framework prefix; closed execution
classifier, `shell:false`, argv array, environment allowlist, timeout and
output bounds; secret-pattern redaction of regeneration evidence.

**PLANNED / NOT IMPLEMENTED** (must not reduce any rating above):
authenticated reviewer identity and human-decision provenance
(`FUTURE_REVIEWER_IDENTITY_PROVENANCE_GUARD`,
`FUTURE_HUMAN_DECISION_PROVENANCE_GUARD`); approval nonce/expiry/repository
binding; credential-scope verification; destination/source identity
cross-check; execution sandboxing; any `MEM`/`RAG` authorization model.

## 40. Conclusions

1. **Side-effect components:** fourteen groups (§7). Model output reaches
   them only as *content* in proposals.
2. **Authority holders vs proposers:** the model, generators and validators
   propose or validate; `#23F`, `#23G`, S7 and S1 exercise authority; the
   reviewer is an external, unauthenticated assertion.
3. **Maximum authority from model content:** `CODE EXECUTION` (via
   approval), with `LOCAL WRITE` as the intermediate; never a scope change.
4. **Can the model select tools?** No (§10).
5. **Can the model influence tool arguments?** Yes, for file content and
   plan-derived paths; deterministic gates bound paths, operations and
   command construction (§11).
6. **Credential classes:** five managed credential classes (AI key, job
   token, Jira, Azure source, Azure destination) plus two derived or ambient
   contexts (child environment, host-user files) and one non-credential
   (reviewer identity string) (§8), inventoried without values.
7. **Can untrusted content or the model select credentials/destinations?**
   No in any code path read (§13).
8. **Credentials visible to models?** No (§12).
9. **What does human approval bind?** Content digest, package digest, project
   id string, and integrity-covered reviewer/time strings (§15).
10. **Is reviewer identity authenticated?** No (§16).
11. **Can approval be replayed?** Blocked across content and project;
    **not** blocked by single-use, expiry, or repository identity (§17).
12. **How are project and repository identities bound?** Project by string
    equality; repository root not at all in approvals (§18).
13. **Can allowed writes escalate into execution?** Yes, by design, once
    approved (§26, TB-12).
14. **Can execution inherit sensitive credentials?** Not through environment
    variables; credential *files* under the user profile remain reachable
    (§22, TB-14).
15. **Confused-deputy paths:** six catalogued (§25).
16. **Current vs planned:** separated (§39).
17. **Ownership of findings:** AISEC-4 (§35), AISEC-5/7 (§36), AISEC-6 (§37).

## 41. Internal-reference legend

`S1`-`S14`: tool inventory rows (§7). `TB-01`-`TB-20`: scenarios (§27).
`VR-01`-`VR-13`: verification requirements (§33). `OQ3-1`-`OQ3-9`: open
questions (§34). `AT-*`: AISEC-1 scenarios. `PI-*`: AISEC-2 scenarios.
`SEC-I*`: AISEC-1 invariants.

## 42. Cross-project credential implications

**NO CURRENT CROSS-PROJECT CREDENTIAL SEAM IDENTIFIED.** Credentials are
job-scoped or caller-supplied per call; `repository-root.js` holds no
module-global mutable root state; a search of `scripts/ai/providers`,
`scripts/ai/generative-test-design` and `scripts/ai/test-automation` found no
module-level mutable state or cache. Two hedged observations rather than
seams: (1) the AI provider key is a **process-wide** module constant read at
import time (`config.js`), so a single process serves every project it
handles with one AI key unless a constructor override is passed; (2) one
process can operate on more than one repository root sequentially, relying on
explicit per-call arguments for isolation. This becomes a real seam only if a
shared or multi-tenant execution surface is introduced (AISEC-4).

## 43. Evidence appendix

Files read for this study, in full or in the cited ranges:
`docs/agentic-threat-model-v1.md`, `docs/prompt-indirect-injection-study-v1.md`
(prior stages), `SECURITY.md`, `ROADMAP.md` (title and requirement check),
`scripts/ai/pr-comment-client.js`, `scripts/ai/format-pr-comment.js`,
`scripts/ai/collect-history.js`, `scripts/ai/collect-context.js` (calls),
`scripts/ai/config.js`, `scripts/ai/repository-root.js`,
`scripts/ai/providers/groq-provider.js`, `gemini-provider.js`,
`jira-requirements-provider.js`, `azure-devops-requirements-provider.js`
(header and network sections), `scripts/ai/destinations/azure-devops-test-case-destination.js`,
`scripts/ai/test-design-publishing.js`,
`scripts/ai/test-automation/generated-change-set-review-record.js`,
`generated-change-set-review-package.js`, `change-set-application.js`,
`controlled-execution.js`, `regenerate-change-set.js`,
`applied-change-set-record.js`, `automation-execution-record.js`,
`generated-change-set.js` (protected-path section),
`scripts/ai/generative-test-design/test-design-review-record.js`,
`scripts/ai/evaluation/scoring-v6.js` (fixture reviewer), the three workflow
files under `.github/workflows/`, `package.json`, and `scripts/ai/index.js`.
Repository-wide searches: filesystem-write APIs, `child_process`, `fetch`,
`process.env`, callers of `#23F`/`#23G`/regeneration entry points,
module-level mutable state.

No credential value was read or recorded. All adversarial examples are
descriptive and inert.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
