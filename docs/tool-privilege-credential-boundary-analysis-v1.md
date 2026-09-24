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
any live call against a real external system; GitHub's or any provider's own
platform behavior beyond what this repository's source and workflow
declarations state.

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

**Central architectural fact (CURRENT, source-verified):** no code in this
repository calls `applyApprovedGeneratedChangeSet`,
`executeAppliedChangeSet` or `regenerateAfterExecutionFailure` outside tests
(a search of `scripts/` found only their definitions, and the workflows
invoke only npm scripts that do not reach them), none of those
functions or any review-record builder is exported from the package entry
point `scripts/ai/index.js`, and `package.json`'s `files` field excludes
`scripts/ai/generative-test-design` and `scripts/ai/test-automation` from the
distributed package. The `#22F`/`#23E` review records are data structures
returned by builder functions; **there is no in-repository orchestrator, review
interface, or approval-collection path.** The acting principal for every
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
| S8 | Review-record builders | `generative-test-design/test-design-review-record.js`, `test-automation/generated-change-set-review-record.js` | Caller-supplied `reviewerId`, `reviewedAt`, `decisions`, `comment` | None | Construct approval artifact (no direct side effect) | Digest binding, completeness rules, derived `status` | Declared human decision | PROPOSAL (but the artifact *authorizes* S9) | Invalid input returns `ok:false` |
| S9 | Change-set application (`#23F`) | `test-automation/change-set-application.js` `applyApprovedGeneratedChangeSet` | Generated change set + review package/record + caller `repositoryRoot`, `expectedProjectId` | None | Create / modify files under `repositoryRoot` | Approval validation; change-set re-validation; digest match; containment + symlink/hardlink checks; base-digest optimistic concurrency; rollback | `#23E` record (identity unauthenticated) | LOCAL WRITE | Approval or validation failure: `ok:false`, zero writes; partial failure: rollback, status may be `ROLLBACK_INCOMPLETE` |
| S10 | Controlled execution (`#23G`) | `test-automation/controlled-execution.js` `executeAppliedChangeSet` | `AppliedChangeSetRecord` + plan + change set + caller `repositoryRoot` | None (env allowlist) | Spawn `node_modules/.bin/{cypress,playwright}` on derived targets | Applied-record digest + fresh byte revalidation; closed target classifier; `shell:false`; argv array; env allowlist; timeout and output bounds | None at this stage (approval consumed at S9) | CODE EXECUTION | Unknown framework / no target / unsafe target: refuse with zero spawn |
| S11 | Bounded regeneration | `test-automation/regenerate-change-set.js` | Execution record (stdout/stderr redacted) + plan + context | `AI_API_KEY` via provider | One provider call, returns a proposal | Eligibility classifier; CREATE-origin refusal; freshness gate; `buildGeneratedChangeSet` | New `#23E` review required | PROPOSAL | Ineligible: zero provider calls |
| S12 | Generative model calls | `generative-test-design/*-generator.js`, `test-automation/automation-plan-generator.js`, `generate-change-set.js` | Positive-projected prompts (AISEC-2 §8) | `AI_API_KEY` via provider | Return JSON proposals | Schema, cross-model, path, protected-area validators | `#22F` / `#23E` before any mutation | PROPOSAL | Invalid response: bounded correction attempt, then failure |
| S13 | GitHub Actions workflows | `.github/workflows/cypress.yml`, `dependency-review.yml`, `supply-chain-audit.yml` | Repository content at the triggering ref | Per-job `GITHUB_TOKEN`; `GROQ_API_KEY` in one step | Run test suites, `npm ci`, npm scripts; post a PR comment | Declared per-job `permissions`; no `pull_request_target` | Repository PR review | CODE EXECUTION (CI runner) | Fork PRs receive no secrets |
| S14 | Maintainer diagnostics | `scripts/diagnostics/audit-drift-check.js`, `branch-inventory.js`, `firefox-failure-forensics.sh`, `reset-cypress-runtime-outputs.sh` | Maintainer invocation; fixed argv | None | `npm audit`, `git rev-parse` reads; temporary diagnostic file writes/removal; fixed-path `rm -rf reports/cypress cypress/screenshots cypress/videos` (disposable Cypress output only) | Fixed binaries, fixed args, fixed paths | Maintainer-run | READ ONLY / LOCAL WRITE / fixed-path local delete (diagnostic scope; never model- or caller-influenced) | n/a |

No component in this inventory exposes a general tool-calling interface to a
model. The model produces text; every action above is invoked by
deterministic code.

## 8. Credential inventory

Credential **classes** only. No value was read or recorded.

| Credential class | Source | Loader | Consumer | Scope | Lifetime | Project bound | Destination bound | Model-visible | Model-selectable | Logged | Persisted |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AI provider key (`AI_API_KEY`; CI secret `GROQ_API_KEY` mapped in one step) | Environment | `config.js` module constant `API_KEY`; provider constructor argument overrides | `GroqProvider` / `GeminiProvider` request headers | UNKNOWN (provider-side; not stated in repository) | Long-lived secret | No | Yes -- provider host is a hard-coded constant | No | No | Convention only (`analyze-failure.js` rule); no scanner | Not written to any report |
| GitHub job token (`GITHUB_TOKEN`) | `${{ github.token }}` | Step `env` (history), `actions/github-script` (comment) | `collect-history.js` `Authorization` header; Octokit | Declared per job (`contents: read`; `actions: read`; `pull-requests: write` in the triage job) | Per workflow job run | Repository-scoped by GitHub | History: **No** -- `GITHUB_API_URL` env selects the base URL; comment: bound to workflow-context repository | No | No | Convention | `actions/checkout` persists the job token for the job's git operations by default and none of the 6 checkouts sets `persist-credentials: false`; the exact storage location is an action implementation detail not verified for the pinned version (UNKNOWN) |
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
CI (S13)             --         --          repo PR review    YES (EXEC)      per-job token; one step holds AI key
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
| Can a local process fabricate approval metadata? | **Yes**, by the module's own statement; the repository's own evaluation code already constructs a record with a fixed fixture reviewer id (`v6-evaluation-fixture-reviewer`) | `scoring-v6.js:292` |
| Can model-generated text set approval fields? | No path exists **in this repository** (fields are caller-supplied; no code routes model output into them). An external orchestrator is outside this study (OQ3-1) | Source |
| Does any interface show the reviewer the proposal? | **No reviewer-facing interface was found**: no `bin` entry, no npm script, no non-test caller of any review builder | §6 search; `package.json` |

**Refinement of AISEC-2 OQ-1** (review-display provenance): the question
assumed review-display tooling might exist outside the modules AISEC-2 read.
This study finds that **no reviewer-facing presentation layer exists anywhere
in this repository.** Whether a future or external display distinguishes
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
| Different destination / credential | N/A for `#23F`/`#23G`; publishing has no approval object at all |
| Different execution | `AutomationExecutionRecord` binds `appliedChangeSetRecordDigest`; nothing prevents executing the same applied state repeatedly (timeout/output bounds only) |

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
  read-only in declared scope, and exists only for the job's duration.

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
| Credential deputy, comment | job `GITHUB_TOKEN` posting as the workflow bot | Failure text -> model report -> comment body | Attacker-influenced text posted as the bot; no markdown/`@mention` neutralization (length truncation only) | Length bound; report validation (TB-07) |
| Resource-selection deputy, comment | job token | Any commenter's text can contain the marker | Update target chosen by untrusted content; author not checked | Platform permission behavior UNKNOWN (TB-08) |
| Filesystem deputy | `#23F` writer | Model-authored file content in an allowed path | Semantically malicious content in a valid file | Scope closed (path); content unfiltered (TB-12) |
| Execution deputy | `#23G` runner | Approved test code | Arbitrary computation with the host identity | Classifier and env allowlist; not a sandbox (TB-12/TB-14) |
| CI deputy | Actions runner | Merged spec content | Code execution in test jobs (no secrets; read-only job token) | PR review; declared job permissions (TB-17) |

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
| `LOCAL WRITE -> CI EXECUTION` | A human commits and pushes; PR review; workflow-level `permissions` | The human PR review (outside this pipeline) |
| `CODE EXECUTION -> ambient credentials` | Env allowlist blocks variables only | None for files under the user profile |

The `LOCAL WRITE -> CI EXECUTION` step is not performed by this pipeline: it
holds no git authority (SECURITY.md §22); a person must commit and push.

## 27. Scenario catalog

`INH` = inherited (canonical rating unchanged), `REF` = refined mechanism of
an inherited item, `NEW` = mechanism newly analyzed here. Likelihood /
Impact / Authority Impact use the AISEC-1 methodology (§28).

| ID | Name | Tool / component | Entry source | Required privilege | Credential context | Attack path | Current controls | Control limitation | Human gate | Max authority | L | I | AI | Risk | Class | Evidence | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TB-01 | Forged reviewer identity / fabricated approval record | S8, S9 | Any code able to call the library or hand-build a record | Ability to invoke the library | None | Construct record + package with unkeyed digest; pass to `#23F` | Digest integrity, project match, derived status | Digest unkeyed; `reviewerId` opaque string | Declared, unauthenticated | LOCAL WRITE -> CODE EXECUTION | Medium | High | High | CRITICAL | INH (=AT-07) | §16; record docstring `:45-80`; `scoring-v6.js:292` | AISEC-6 (design) |
| TB-02 | Approval replay across repository roots | S9 | Approved change set applied to a second checkout | Approval + a checkout of the same project id | None | Reuse record+package on another root whose files match base digests | Package/content digests; base-digest and existence checks | Approval carries no root; identical checkouts pass | Original review only | LOCAL WRITE | Low | Medium | Medium | MEDIUM | NEW | §17-§18; package binds only `projectId` | AISEC-6 |
| TB-03 | Approval re-application to the same repository | S9 | Re-run of `#23F` | Approval | None | Restore file to base content, re-apply same approved set | Optimistic concurrency (`CREATE` exists / `MODIFY` STALE) | Approval is not single-use; no nonce | Original review only | LOCAL WRITE | Low | Low | Medium | LOW | NEW | §17 | AISEC-6 |
| TB-04 | Cross-project approval reuse | S9, S10 | Artifact from project A applied as project B | Approval + control of `expectedProjectId` | None | Present an artifact whose `projectId` string matches | `PROJECT_MISMATCH` equality checks | Project id is a caller-chosen string, unanchored | Original review | LOCAL WRITE | Low | Medium | Medium | MEDIUM | NEW | §18 | AISEC-4 / AISEC-6 |
| TB-05 | Publishing destination substitution | S7 | Misconfigured or attacker-influenced caller config | Caller config control | Caller PAT/bearer | Point destination at another org/project | Host pinned; org/project syntax validation | No source/destination identity cross-check; token scope UNKNOWN | None | REMOTE CREATE | Low | Medium | Medium | MEDIUM | INH (=AT-04, REF) | §23; destination `:153-171` | AISEC-4 |
| TB-06 | Attacker text laundered through trusted publisher | S7 (with S6 source) | Requirement content authored by a low-privilege user | Ability to author a requirement in the queried source | Operator's Azure credential | Requirement text -> deterministic artifact -> created work item | Structural validation; create-only | Content unfiltered; no review gate | None | REMOTE CREATE | Low-Med | Medium | Medium | MEDIUM | NEW | §23, §25 | AISEC-4 |
| TB-07 | Attacker-influenced text posted under the bot identity | S1 | Failure output / repository text reaching the AI report | Ability to influence test failure text | Job token | Text -> model report -> comment body (markdown, links, mentions) | Length truncation; report validation | No markdown/mention neutralization | None | REMOTE CREATE (comment) | Medium | Low | Low | LOW-MED | NEW | `format-pr-comment.js` (only `truncate`) | AISEC-7 |
| TB-08 | Comment-marker hijack of the upsert target | S1 | Any PR commenter | Ability to comment on the PR | Job token | Comment containing the marker becomes the "existing" comment | First 100 comments only; marker string match | Author not checked; only the first 100 comments scanned; platform update permission behavior UNKNOWN | None | REMOTE CREATE (update) | Low-Med | Low | Low | LOW | NEW | `pr-comment-client.js:10-27` | AISEC-7 |
| TB-09 | `repositoryRoot` manipulation | S9, S10 | A future orchestrator deriving the root from untrusted input | Orchestrator flaw | None | Supply a different existing directory | Root is caller input; module rule forbids untrusted derivation; validation is shape-only | No in-repository call site exists to verify the rule is followed | Original review | LOCAL WRITE / EXECUTION in another tree | Low | High | High | MEDIUM | NEW | `repository-root.js`; §6 search | AISEC-6 |
| TB-10 | Protected-path denylist normalization bypass | S9 | Path text with unusual normalization | Approval + a crafted path | None | Windows short names / alternate streams / trailing characters vs pattern | Case-insensitive patterns; prefix layer; canonical path checks | Normalization behavior not empirically tested | Original review | LOCAL WRITE (protected area) | Low | High | Medium | MEDIUM | NEW (unverified) | §20; `generated-change-set.js:125-134` | AISEC-7 |
| TB-11 | Symlink / TOCTOU on write | S9 | Concurrent local actor | Local access | None | Swap path component between check and write | `lstat` walk, topology identity binding, rollback | Documented unclosed TOCTOU window | Original review | LOCAL WRITE | Low | High | Medium | MEDIUM | INH (SECURITY.md §24) | `change-set-application.js:254-283` | AISEC-6 |
| TB-12 | Safe command, malicious approved code | S10 | Approved test file with malicious semantics | Approval (forged or persuaded) | Host OS identity | Approved spec runs arbitrary code in the runner | Closed classifier, `shell:false`, env allowlist, timeout | Not a sandbox; network and filesystem unrestricted | `#23E` (semantics visible, identity unauthenticated) | CODE EXECUTION | Low-Med | High | High | HIGH | REF (SECURITY.md §25) | AISEC-6 / AISEC-7 |
| TB-13 | Argument injection into the runner CLI | S10 | Applied path text | Approval | None | Path text interpreted as a runner flag/pattern | Closed classifier; Cypress safe-character allowlist (whole-run reject); Playwright anchored escaped regex; argv array | Depends on classifier correctness per runner | Original review | CODE EXECUTION | Low | Medium | Medium | MEDIUM | NEW | `controlled-execution.js:395-420` | AISEC-7 |
| TB-14 | Ambient credential files reachable from the child | S10 | Malicious approved code | TB-12 succeeded | Host user's files | Read user-profile credential material | Env-variable secrets excluded | `HOME`/`APPDATA` passed; full FS and network | Original review | CODE EXECUTION -> credential exfiltration | Low | High | Medium | MEDIUM | NEW | §22; `ENV_ALLOWLIST` | AISEC-4 / AISEC-6 |
| TB-15 | Env/caller-selected credential destinations | S2, S6 | Trusted-config tampering | Control of `GITHUB_API_URL` or Jira base URL | Job token / Jira token | Send credential to another host | Jira: https-only, no embedded creds, no redirects | `GITHUB_API_URL` has no pinning; Jira has no host allowlist | None | READ ONLY (credential disclosure) | Low | Medium | Low | LOW | NEW | `collect-history.js:113-118, 305` | AISEC-4 |
| TB-16 | AI provider authority expansion | S5 | A future provider implementation | Code review bypass | Provider key | Provider adds side-effecting behavior | Contract is string-in/string-out; new provider requires review (SECURITY.md §17) | Nothing enforces the contract at runtime beyond return-type validation | Code review | READ ONLY today | Low | Medium | Low | LOW | NEW (design) | `provider-contract.js` | AISEC-6 |
| TB-17 | Allowed file -> CI execution | S13 | Merged spec under `cypress/` or `playwright/` | Human commit + PR review | Job token (read-only scopes); no secrets in test jobs | Spec code runs in test jobs | Per-job `permissions`; no secrets in test jobs; fork PRs get read-only | Persisted checkout credential; arbitrary code in runner | Repository PR review | CODE EXECUTION (CI) | Low-Med | Medium | Medium | MEDIUM | NEW | `cypress.yml` (6 checkouts, no `persist-credentials: false`) | AISEC-6 |
| TB-18 | Reviewer persuasion + unauthenticated identity (compound) | S8, S9, S10 | Injected content (AISEC-2) reaching a reviewer | As TB-01 / PI-08 | None | Persuasive rationale -> approval by an unverified principal -> TB-12 | As TB-01 and AISEC-2 §17 | No provenance labeling in any display (none exists) | Human | LOCAL WRITE -> CODE EXECUTION | Low-Med | High | High | HIGH | INH (compound of AT-07 + PI-08; not additive) | §16; AISEC-2 §17 | AISEC-6 |
| TB-19 | Publish replay / duplicate creation | S7 | Re-invocation | Caller | Caller PAT | Same request creates duplicates | Create-only, no retry | No idempotency key | None | REMOTE CREATE | Medium | Low | Medium | LOW-MED | INH (=AT-08, REF) | §23 | AISEC-4 / AISEC-7 |
| TB-20 | CI secret reachable by same-repo PR code | S13 | Same-repository PR author | Push access | `AI_API_KEY` in one step | PR-head scripts run in the secret-holding job | Step-scoped env; fork PRs receive no secrets; no `pull_request_target` | Platform trust model: same-repo contributors are trusted | PR review | Credential use | Low | Medium | Low | LOW | NEW (platform trust) | `cypress.yml:904-911` | AISEC-4 |

## 28. Risk register

Methodology reused verbatim from AISEC-1 §14 and AISEC-2 §26: Likelihood =
probability the path succeeds; Impact = severity of consequence; Authority
Impact = authority reached *if it succeeds*. **A preventive control reduces
Likelihood, not Authority Impact.**

| ID | Likelihood | Impact | Authority Impact | Risk | Class |
|---|---|---|---|---|---|
| TB-01 | Medium | High | High | **CRITICAL** | INH (AT-07, unchanged) |
| TB-12 | Low-Med | High | High | **HIGH** | REF |
| TB-18 | Low-Med | High | High | **HIGH** | INH (compound; not additive to TB-01/TB-12) |
| TB-02 | Low | Medium | Medium | MEDIUM | NEW |
| TB-04 | Low | Medium | Medium | MEDIUM | NEW |
| TB-05 | Low | Medium | Medium | MEDIUM | INH (AT-04) |
| TB-06 | Low-Med | Medium | Medium | MEDIUM | NEW |
| TB-09 | Low | High | High | MEDIUM | NEW |
| TB-10 | Low | High | Medium | MEDIUM | NEW (unverified) |
| TB-11 | Low | High | Medium | MEDIUM | INH |
| TB-13 | Low | Medium | Medium | MEDIUM | NEW |
| TB-14 | Low | High | Medium | MEDIUM | NEW |
| TB-17 | Low-Med | Medium | Medium | MEDIUM | NEW |
| TB-07 | Medium | Low | Low | LOW-MED | NEW |
| TB-19 | Medium | Low | Medium | LOW-MED | INH (AT-08) |
| TB-03 | Low | Low | Medium | LOW | NEW |
| TB-08 | Low-Med | Low | Low | LOW | NEW |
| TB-15 | Low | Medium | Low | LOW | NEW |
| TB-16 | Low | Medium | Low | LOW | NEW (design) |
| TB-20 | Low | Medium | Low | LOW | NEW (platform trust) |

Summary: **CRITICAL 1, HIGH 2, MEDIUM 10, LOW 7 (including the two LOW-MED
rows), total 20.** Of these, 6 are inherited or refinements of AISEC-1 /
AISEC-2 / SECURITY.md items (TB-01, TB-05, TB-11, TB-12, TB-18, TB-19) and 14
are newly analyzed mechanisms. No inherited canonical rating was changed.
These are **system security risks**, not artifact defects.

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
| Publishing result | Yes (`CREATED`/`FAILED` items, validated) | No approver identity (none exists) |

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
| OQ3-1 | Does a production orchestrator exist outside this repository, and how does it construct approvals and choose `repositoryRoot`? | Repository-wide search for callers; package `files`/`exports` | Outside repository | AISEC-6 (ADR) + project owner | No -- all conclusions are stated at library-contract level and hold for any caller |
| OQ3-2 | How does the protected-path denylist behave for Windows short names, alternate streams, trailing dots/spaces? | Pattern source (`generated-change-set.js:125-134`) | Static analysis only; empirical test not run | AISEC-7 | No -- rated MEDIUM and marked UNVERIFIED |
| OQ3-3 | Does the GitHub API permit `updateComment` on another user's comment with `pull-requests: write`? | `pr-comment-client.js` source | Platform behavior | AISEC-7 | No -- TB-08 rated LOW with the uncertainty stated |
| OQ3-4 | What are the actual scopes of caller-supplied Jira/Azure tokens and the AI provider key? | Source and workflow declarations | Values and scopes are not in the repository | AISEC-6 (credential ownership ADR) + operator | No -- classified UNKNOWN, not claimed broad |
| OQ3-5 | Is the persisted checkout credential intended/needed by test jobs? | `cypress.yml` (6 checkouts, no `persist-credentials: false`) | Intent not documented | AISEC-6 | No -- TB-17 states the fact without claiming it is unintended |
| OQ3-6 | Who owns the reviewer-facing display, and must it label content provenance (system / model / human)? | No display code exists (§6, §16) | Design decision | AISEC-6 | No -- resolves AISEC-2 OQ-1 factually (no layer exists) and hands the design to the ADR |
| OQ3-7 | Should approvals bind `repositoryRoot`/repository identity and carry a nonce or expiry? | §17-§18 | Design decision | AISEC-6 | No |
| OQ3-8 | Should `#23G` re-validate the review record, not only the applied record? | §21 | Design decision | AISEC-6 | No |

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
`VR-01`-`VR-13`: verification requirements (§33). `OQ3-1`-`OQ3-8`: open
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
