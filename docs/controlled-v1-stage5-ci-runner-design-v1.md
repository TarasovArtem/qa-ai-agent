# Controlled-v1 Stage 5 CI-runner execution design v1 — S0 PROPOSED DESIGN

Authority: `OD-CONTROLLED-V1-STAGE5-CI-RUNNER-S0 — APPROVED` (authoring only).

Status: **PROPOSED DESIGN — NOT APPROVED.** Independent Architecture and
Security reviews: **NOT STARTED**. Implementation: **NOT AUTHORIZED**.
`execute`: **DISABLED** (reserved fixed refusal, exit 5). Controlled Release:
**NOT APPROVED**. Merge: **NOT AUTHORIZED**.

Date: 2026-10-18.

This document is a self-contained proposal for one candidate Controlled-v1
execution path: protected handoff of locally approved and applied Stage 4
evidence to standard GitHub-hosted Linux VMs, followed by independent trusted
verification. Owner approval of S0 *authoring* does not approve this design,
does not accept any disposition proposed here, does not supersede OD-06, and
does not close, waive, re-rate or accept any finding.

Evidence vocabulary used throughout:

| Label | Meaning in this document |
|---|---|
| `VERIFIED` | Observed directly at the baseline in repository source or documents, in read-only GitHub repository configuration (2026-10-18), or quoted from GitHub's published documentation (fetched 2026-10-18). A documentation quote is evidence of what GitHub states, not proof of runtime behavior |
| `PROPOSED` | Design content of this S0 proposal; no authority until independently reviewed and owner-approved |
| `NOT PROVEN` | A required property for which no adequate evidence exists; needs the named proof |
| `PO DECISION REQUIRED` | A product, security-acceptance or contract change that only the Product Owner can make |

Qualification-matrix statuses (§7) are restricted to `PROVEN`, `NOT_PROVEN`
and `BLOCKED`. No gate in this document is `PROVEN`.

---

## 1. Identity, lifecycle and scope

### 1.1 Identity

| Fact | Value |
|---|---|
| Repository | `TarasovArtem/qa-ai-agent` (repository id 541475998, public, default branch `main`) — `VERIFIED` |
| Branch | `design/controlled-v1-stage5-ci-runner-s0`, created by PM; initial remote HEAD equal to main — `VERIFIED` |
| Base main HEAD | `52e23acf0f7e5d2f7fce2b406a27de51ae1af68c` — `VERIFIED` |
| Base main TREE | `176960ba98b1e7babfee553729200c49d748d7ca` — `VERIFIED` |
| Historical PR #256 | `CLOSED / NOT MERGED`, head `619e5dcc9f1f1d6dbfa7c3709b3c8cf7ad6d196d` — `VERIFIED` |
| Changed-file allowlist | this document only |
| Open PR inventory at preflight | Dependabot #243/#250/#251/#252, historical proof #132; no competing engineering PR observed (an inventory observation, not proof that no other machine has work) |

### 1.2 Lifecycle position

```text
OD-06 execution design (self-hosted broker)   COMPLETE_ON_MAIN / POST-MERGE CERTIFIED (historical design, unchanged)
Stage 5 (execute)                             READY / NOT AUTHORIZED
PR #256 (Stage 5 design-gap proposal)         CLOSED / NOT MERGED — not an approved contract
D3 CI-runner feasibility                      research input: CI_RUNNER_DESIGN_DIRECTION_VIABLE — CONDITIONAL
R3/R5/R6/R6-C1 systemd research               research inputs for OD-06 only; not authority here
S0 (this document)                            PROPOSED DESIGN → exact-head CI → independent Architecture
                                              → independent Security → PO decisions (§10) → separately
                                              authorized slices (§11) → separate activation decision
```

### 1.3 Scope

In scope: a proposed contract for executing exactly the Stage 4 approved and
applied Cypress/Playwright specs of one package on GitHub-hosted Linux VMs,
with trusted verification before and after; its trust boundaries, lifecycle,
evidence, CLI/config deltas, qualification gates, OD-06 supersession mapping,
threat/residual register, owner decisions and serial implementation slices.

Out of scope (unchanged and not authorized): any source, test, workflow,
package, export, configuration, ruleset, environment, secret, tag or README/
ROADMAP/SECURITY change; workflow dispatch; live qualification; Stage 4
`review record`/`apply` semantics; OD-06 revocation; release.

### 1.4 What this design does not claim

- It does **not** claim the flow is secure because V, X and R run on separate
  VMs. VM separation is a provider property (§4.3) and separates jobs from
  one another; it does not make the code inside X trustworthy, nor make
  anything X reports authentic.
- It does **not** claim human-approval authenticity in CI (§5.1.2).
- It does **not** claim a malicious-test sandbox, network isolation or SUT
  secret confidentiality against approved or dependency code (§5.2.6).

---

## 2. Canonical baseline and source inventory

### 2.1 Canonical inputs read at the baseline

| Source | Role here | Key facts used (`VERIFIED`) |
|---|---|---|
| `docs/controlled-v1-release-model-owner-decision-v1.md` | Release model | RC-01..RC-12 (§4); prerequisite 6 "explicitly supported, independently assessed execution environment … Linux/isolated-runner-first v1.0 is acceptable"; opt-in/removable/minimally invasive principles (§5); Docker/Kubernetes not a mandatory user-facing requirement (§2); not risk acceptance (§6) |
| `docs/controlled-v1-productization-contract-v1.md` | Product surface | exit taxonomy 0/1/2/3/4/5/6/7/8/10 (§10.7); `execute` permitted after OD-06 only on runner classes it names (§10.9); maximum mandatory footprint "one dependency line (+ lockfile) and one JSON file", workflow file optional/target-owned (§12); RC-08 "OD-06 BLOCKS ENABLEMENT" (§19); demo interface (§20) |
| `docs/controlled-v1-execution-contract-v1.md` (OD-06) | Certified historical execution design | runner matrix: self-hosted provisioned Linux initial candidate, **GitHub-hosted Linux DEFERRED**, Windows REFUSED (§3); process-lifecycle containment only (§3, §19.1); §8.1 gate-free binding; §8.2 closed adapters/fingerprint; §9.1 fresh env; §9.3 decision precedence and exits; §9.4 report contract; §11 closed schemas; R-1..R-5 execute impact (§11.4); 7 LOW + 5 INFO carried debt L1–L7/I1–I5 (§19.1) |
| `docs/controlled-v1-approval-apply-contract-v1.md` (OD-04) | Stage 4 authority | whole-package single decision; TAP-2/CRS-1/PPI-1; `os-local-account-v1` principal (§14); `root-identity-v1` = platform + native realpath + dev/ino, relocation invalidates approval, "No Git identity is used: the product does not require Git" (§17.2); single-use consumption (§20); CI refusal is policy, not a boundary; no GitHub-based approval may be added in Controlled-v1 (§23); R-1..R-5 ACCEPTED under OD-04 (§30.2) |
| `docs/qa-agent-cli-v1.md` | Implemented surface | `execute` reserved, exit 5 before any input read; 7/8/10 reserved for `execute`; `info` reports `executeDecision: "PENDING_OD_06"` |
| `docs/security-architecture-decision-record-v1.md` (AISEC-6) | Security architecture | SADR-08 explicit execution/host envelope; SADR-11 capability dossier; ODR-06 host isolation/platforms; ODR-07 deployed principals/credentials/CI configuration ("editable workflow requests are not external permission ceilings") |
| `docs/aisec-7-adversarial-security-test-harness-v1.md` | Verification harness | AISEC-7 COMPLETE_ON_MAIN; a harness does not turn a missing control into PASS (release model §3 item 1) |
| `ROADMAP.md` | Canonical sequence | Stage 5 `READY / NOT AUTHORIZED`; OD-06 `COMPLETE_ON_MAIN / POST-MERGE CERTIFIED` |
| `package.json` | Package | Node `22.x`; one bin `qa-agent`; five export keys; no runtime dependencies; devDependencies `cypress ^15.21.1`, `@playwright/test ^1.63.0` |
| `scripts/ai/cli/args.js`, `policy.js`, `cli.js`, `errors.js`, `terminal-session.js` | Code | `execute: { kind: "reserved", ownerDecision: "OD-06" }`; `RELEASE_CAPABILITIES.execute.enabled = false`; Stage 4 CI refusal on `GITHUB_ACTIONS=true` or truthy `CI` |
| `scripts/ai/test-automation/applied-change-set-record.js` | Code | per-change `{operation, path, beforeDigest, afterDigest, status}`, digests `sha256:<64 hex>`; `afterDigest` verified by re-reading written bytes |
| `.github/workflows/cypress.yml` | Existing CI | `setup-node` with `cache: "npm"`; Cypress job container image bundles Cypress 15.5.0 while `npm ci` installs 15.21.1, so "Cypress transparently downloads the matching 15.21.1 binary at run time"; earlier observed bundled-Node drift to 24.20.0 (CRW1-B comment) |

S0 restates no existing hash domain and defines **no new hash domain**.
Where a digest or identifier needs a new canonical definition, this document
marks it `PO DECISION REQUIRED / DESIGN SLICE S2`.

### 2.2 Research inputs (not authority)

| Input | Use | Limitation |
|---|---|---|
| D3 CI-runner feasibility (2026-10-18) | Candidate V/X/R shape, candidate tag ledger, `run_attempt == 1` gating, list of conflicts | Verdict `VIABLE — CONDITIONAL` is a research narrative; nothing in §7 is credited from it |
| R6-C1 manager-identity verification | Confirms the systemd-manager identity line of PR #256 is `R6_IDENTITY_PROOF_BLOCKED` | Relevant only to the self-hosted broker; motivates, but does not justify, the CI-runner alternative |
| PR #256 (closed) | Its §20.0.1/§20.3.6 proposed narrowing GitHub-hosted Linux to **REFUSED** for execute because the "runner account has generic passwordless sudo" | Not merged; not canonical; S0 neither adopts nor rejects it (PO decision 2, §10) |

### 2.3 Read-only GitHub configuration of this repository (`VERIFIED`, 2026-10-18)

| Setting | Observed value | Relevance |
|---|---|---|
| Rulesets | one branch ruleset `main`, `enforcement: disabled`; no tag ruleset | Q1/Q3 ledger and protected-ref policy absent |
| Classic protection on `main` | required checks (5 contexts), `required_approving_review_count: 0`, `enforce_admins: true`, `required_signatures: false`, force-push/deletion disabled | A single writer can change workflow definitions through a PR without independent review |
| Default workflow token permissions | `write`; `can_approve_pull_request_reviews: true` | Workflows not declaring `permissions` receive write tokens |
| Allowed actions | `all`, `sha_pinning_required: false` | No platform-enforced pinning |
| Environments | none | No branch-restricted secret scope exists |
| `TarasovArtem/qa-agent-demo` | not resolvable with the current credentials | External demo repository does not exist (or is not accessible); RC-08 demo proof has no target yet |

These describe the *product development* repository. The execution path
targets a *consumer* repository (§5.4); its configuration is consumer-owned
and must be qualified per consumer (§5.2.8).

### 2.4 GitHub platform facts (`VERIFIED` as documentation statements)

| ID | Fact (quoted or closely paraphrased) | Source |
|---|---|---|
| GH-01 | "each GitHub-hosted runner is a new virtual machine (VM) hosted by GitHub" | docs: GitHub-hosted runners reference |
| GH-02 | "The Linux and macOS virtual machines both run using passwordless `sudo`." | same |
| GH-03 | The `ubuntu-slim` single-CPU runner's container "runs in unprivileged mode" with "hypervisor level 2 isolation" | same |
| GH-04 | No runner-side egress/firewall control is described; runner IP ranges are not recommended as allowlists | same |
| GH-05 | `-latest` labels are "the latest stable images"; image-update cadence and an image-identity attestation are not described | same |
| GH-06 | `GITHUB_TOKEN` "expires when the job finishes or after its effective maximum lifetime"; at most 6 hours on GitHub-hosted runners | docs: GITHUB_TOKEN |
| GH-07 | Events created with `GITHUB_TOKEN` do not start new runs, except `workflow_dispatch`/`repository_dispatch` (and approval-required PR events) | same |
| GH-08 | `permissions: {}` disables all listed scopes; scopes include `actions`, `attestations`, `contents`, `id-token` ("requires `id-token: write`") | docs: workflow syntax |
| GH-09 | `cache-mode` (`read`/`write`/`write-only`/`none`, workflow- or job-level) "controls the cache access granted to the job's token, and it is enforced with scoped cache tokens"; default `write` for trusted triggers including `push`, `workflow_dispatch`, `repository_dispatch`, `schedule` | docs: dependency caching |
| GH-10 | Runs restore caches from the current branch or the default branch; not from sibling/child branches or other tag names; existing cache contents cannot be changed; entries unused 7 days are removed; 10 GB default per repository | same |
| GH-11 | Job outputs: maximum 1 MB per job, 50 MB per run | docs: workflow syntax |
| GH-12 | Each job can run up to 6 hours on GitHub-hosted runners | docs: limits |
| GH-13 | Re-runs "use the privileges of the actor who initially triggered the workflow", "the same `GITHUB_SHA` … and `GITHUB_REF`"; possible up to 30 days; at most 50 re-runs including subset re-runs. The effect of re-running failed/single jobs on dependants and on outputs of successful jobs is **not documented** there | docs: re-run workflows |
| GH-14 | Tag ruleset rules: restrict creations / updates / deletions; "only users with bypass permissions" may perform them; bypass actors "can be users with certain roles, specific teams, or GitHub Apps". Whether GitHub Actions/`GITHUB_TOKEN` can be a bypass actor is **not documented** there | docs: available rules for rulesets |
| GH-15 | `upload-artifact@v4`: "Artifacts … are immutable"; names unique; `overwrite: true` means "an artifact with a matching name will be deleted before a new one is uploaded"; output `artifact-digest` "SHA-256 digest of an Artifact" (what it covers is not stated); ≤500 artifacts per job; retention 1..90 days | actions/upload-artifact README |
| GH-16 | `download-artifact` `digest-mismatch` default `error`; by default scoped to the current workflow run | actions/download-artifact README |
| GH-17 | Workflow-job `conclusion` enum includes `success`, `failure`, `cancelled`, `skipped`, `timed_out`, `action_required`, `neutral`, `null`; fields include `run_attempt`, `runner_name`, `labels`, `started_at`, `completed_at`, `head_sha` | REST: workflow jobs |
| GH-18 | Environment: "All deployment protection rules must pass before a job referencing the environment is sent to a runner" | docs: workflow syntax |

Every behavior relied on beyond these statements is `NOT PROVEN` (§7).

---

## 3. Release Contract compatibility

| RC | Requirement | Effect of this proposal | Status |
|---|---|---|---|
| RC-01 | External installation | Unchanged npm install of `qa-ai-agent` as exact devDependency; CI phases run the installed `qa-agent` bin | PRESERVED (proposal) |
| RC-02..RC-06 | Ingestion → analysis → design → plan → generate | Unchanged, local | PRESERVED |
| RC-07 | Human approval | Remains local Stage 4 (`review record`/`apply`); never in CI; CI cannot strengthen or create approval | PRESERVED — with the B1 evidence-transport caveat (§5.1.2) |
| RC-08 | Controlled execution | Proposed execution environment changes from OD-06's self-hosted broker to GitHub-hosted VMs; whether this satisfies "explicitly supported, independently assessed execution environment" is not decided here | `PO DECISION REQUIRED` (decision 12) |
| RC-09 | Reporting/evidence | Durable evidence moves from root-owned host journal to a repository ledger + run evidence (§5.3) | REPLACED — NEW PROOF REQUIRED |
| RC-10 | Repeatability | Product-mechanics repeatability retained; runtime identity on hosted images is not exact-tuple reproducible (Q7) | `NOT PROVEN` |
| RC-11 | Security/governance | Requires SADR-11 dossier for the CI path, ODR-06/07 dispositions, AISEC-7 scope binding for the new surfaces | REQUIRES NEW WORK |
| RC-12 | Versioned release/install/upgrade | Adds a target-owned workflow example and config delta (§5.4); no published Action, no new export | PROPOSED |

RC-01..RC-12 text is unchanged. Release-model §4 notes the normative RC
acceptance text is not yet a tracked canonical artifact; this design adds no
acceptance criteria.

---

## 4. Architecture and trust-boundary diagram

### 4.1 Flow

```text
 LOCAL (developer machine; existing Stage 4; unchanged)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ requirements → design → plan → generate → review record (TAP-2, human)   │
 │ → apply (#23F, same OS principal)  ⇒ run dir evidence + applied files    │
 │ HUMAN: commit applied files + exported evidence bundle; push to a ref     │
 └──────────────────────────────────────────────────────────────────────────┘
                     │  (B1 trust transfer: unkeyed evidence + Git objects)
                     ▼
 GITHUB (consumer repository; provider-trusted platform)
   workflow_dispatch on protected default branch (writer action; NOT approval)
                     │
  ┌──────────────────┴──────────────────┐
  │ Job V  (trusted; fresh VM #1)        │  product code only; no target code,
  │  verify historical Stage 4 evidence  │  no lifecycle scripts, no npm ci
  │  bind exact Git objects + bytes      │  of target deps
  │  admit + reserve + consume (ledger)  │──► ledger ref create (atomic?) Q1
  │  emit handoff via job outputs        │
  └──────────────────┬──────────────────┘
                     │ needs.V.outputs (service-held; X cannot rewrite)
  ┌──────────────────┴──────────────────┐
  │ Job X  (UNTRUSTED after first target │  permissions: {}, cache-mode: none,
  │  code instruction; fresh VM #2)      │  no OIDC, SUT_* only (environment)
  │  pre-target trusted prelude:         │
  │   run_attempt==1, materialize bytes, │
  │   re-hash, drop to non-sudo uid      │
  │  execute exact specs (Cypress/PW)    │  ← approved specs + UNAPPROVED config,
  │  upload bounded report artifact      │    dependencies, lifecycle scripts
  └──────────────────┬──────────────────┘
                     │ artifact (X-controlled bytes) + Jobs API facts
  ┌──────────────────┴──────────────────┐
  │ Job R  (trusted; fresh VM #3)        │  product code only; parses data;
  │  re-verify V facts, query Jobs API   │  never executes report content
  │  validate artifact structurally      │
  │  deterministic verdict               │──► ledger result record (write-once?)
  │  durable evidence                    │
  └─────────────────────────────────────┘
```

### 4.2 Trust boundaries

| # | Boundary | Trusted side | Untrusted side | What crosses | Authentication available |
|---|---|---|---|---|---|
| TB-A | Local Stage 4 → repository | Stage 4 product on the approving machine | Every Git writer of the ref | Applied files; evidence bundle | **None** beyond unkeyed digests and Git commit authorship (not human proof) |
| TB-B | Dispatcher → workflow | GitHub service | Any user with permission to dispatch | Inputs (`runId`, `package`) | GitHub authenticates the actor; not TAP-2 approval |
| TB-C | Workflow definition → jobs | Protected ref policy (if configured) | Writers of the workflow file | Job steps, product version pin | Only as strong as consumer branch/ruleset policy (Q3) |
| TB-D | V → X | V job outputs held by service | — | Bound handoff descriptor | Service-held outputs; X cannot rewrite V's outputs (`NOT PROVEN` as a guarantee, §7 Q5) |
| TB-E | X prelude → target code | Product prelude (before first target instruction) | Approved specs, config, dependencies | Process tree | In-VM uid separation only, if implemented (`NOT PROVEN`) |
| TB-F | X → R | R | Everything X produced | Report artifact, X job outputs, logs | **None** for content; Jobs API facts are service-reported but partly runner-reported |
| TB-G | Jobs → ledger | Ref-creation identity | Other writers/admins | Consumption and result records | Ruleset bypass identity; bounded by admin trust (Q1) |
| TB-H | Provider → everything | — | GitHub-hosted VM image, hypervisor, Actions service | All of the above | Externally trusted provider dependency; not verified by this product (Q9) |

### 4.3 Provider trust statement

GitHub-hosted VM isolation, image contents, Actions service integrity, job
output storage, artifact storage, cache token scoping and ref-update
atomicity are **externally trusted provider dependencies**. This design treats
them as assumptions to be named in the SADR-11 dossier and qualified where
possible, never as a source-code sandbox proven by this product.

---

## 5. Detailed contracts and findings (B1–B6)

### 5.1 B1 — Approved/applied bytes binding

#### 5.1.1 Authority chain (as it exists today, `VERIFIED`)

```text
TAP-2 session (interactive controlling process, os-local-account-v1 principal P, root R)
  → GeneratedChangeSetReviewRecord v2 (APPROVE, whole package, notAfter = decidedAt + 24 h)
  → apply by the same principal key P on the same root R (fresh confirmation)
  → O_EXCL attempt file (consumption) → #23F → AppliedChangeSetRecord + QaAgentApplyOutcome
  → APPLIED: approved afterDigest bytes present in R's working tree
```

Assurance level: `LOCAL ACCOUNT ATTRIBUTION`; records unkeyed (R-3); same-
principal automation indistinguishable (R-1).

#### 5.1.2 What cannot be transported (findings)

| Finding | Statement | Consequence |
|---|---|---|
| **B1-F01** | `root-identity-v1` binds platform, native realpath and dev/ino; §17.2 states relocation "intentionally invalidates every pending approval" | A CI checkout is a different root. Historical root digests can be checked only for **internal consistency** among the records, never re-derived from the CI workspace |
| **B1-F02** | The `os-local-account-v1` principal key of review/apply cannot be resolved on a runner | The OD-06 "same principal executes" recheck cannot exist in CI; the dispatcher's GitHub identity is a different identity class |
| **B1-F03** | Every Stage 4 record field is computable from run files (OD-04 §27) | Anyone able to write the ref that carries the evidence bundle can forge a self-consistent bundle. Today R-3 is bounded to "actors able to write the run directory" on one machine; in CI it becomes **every writer of the ref**. This is a widening of an accepted residual, not a new mitigation |
| **B1-F04** | A Git commit, a GitHub writer identity, a dispatch, a merged PR or a stored `APPROVED`/`APPLIED` status is not human approval | None of these may be treated as approval evidence; OD-04 §23 forbids GitHub-based approval in Controlled-v1 |
| **B1-F05** | The run directory lives under `output.dir` (default `reports/qa-agent`, recommended `.gitignore` entry) | Transport requires a new explicit export/commit step; committed evidence becomes readable by every repository reader (public repositories: everyone), including model-generated text — a SADR-04/ODR-03 audience transition |
| **B1-F06** | The product "does not require Git" (§17.2) | A Git/GitHub-dependent execution path is a product dependency change (PO decision 3) |

Therefore the design separates two verifications that OD-06 performed
together.

#### 5.1.3 Part 1 — Historical Stage 4 evidence verification (`PROPOSED`)

Purpose: decide whether a transported evidence bundle is a complete,
internally consistent, gate-free-reconstructable record of one successful
Stage 4 apply of one package. It establishes **consistency, not origin**.

Inputs (all untrusted data): the exported bundle (manifest v2, design/plan/
generate artifacts, review records, ledger claims, `apply/attempt-*`,
`apply/applied-*`, `apply/outcome-*` for the package), the committed
`qa-agent.config.json`, the committed requirements file, at the bound commit.

Rules, adapted from OD-06 §8.1 items 1–5 (each failure refuses; first failure
decides):

| # | Rule | Adaptation versus OD-06 §8.1 |
|---|---|---|
| H1 | Bounded strict read of the complete bundle inventory; reject redirects, orphan claims, temporary ledger files, ambiguity, quarantine, multiple attempts for the package | Unchanged; read from Git blobs, not a live run directory (§5.1.4 G-rules) |
| H2 | Gate-free rebuild of design/plan/change set/review package with existing canonical primitives; recompute projection, runId/ordinal, artifact hashes, plan/context/change-set/package digests, CRS-1/TAP-2 subject, PPI-1 paths; exact installed product version must equal the manifest product version | Unchanged except the projection inputs are the committed config/requirements blobs at the bound commit |
| H3 | Locate exactly one successful apply attempt/outcome with matching ledger review record; APPLIED outcome; exact applied-record SHA-256; `appliedAt` within `decidedAt..notAfter` | Unchanged. Expiry *now* neither renews nor revokes a consumed apply |
| H4 | Gate-free v1 core rebuild; exactly one APPROVE per rebuilt operation/path/targetDigest | Unchanged |
| H5 | Applied record schema/digest and its `projectId`, `changeSetDigest`, `reviewPackageDigest`, `reviewRecordDigest` equal the rebuilt chain; successful overall and per-change outcomes; approved `afterDigest` for ALL changes incl. helpers | Unchanged |
| H6 | Root and principal: the root digest and principal key recorded in the review record, apply claim/outcome and applied chain must be **mutually equal**; no live re-derivation | **REPLACED.** OD-06 §8.1 item 6 live root recheck and item 4 caller-principal recheck cannot run (B1-F01/F02). `PO DECISION REQUIRED` (decision 5) |
| H7 | The verifier never calls `assertState`/`selectedRecord` for authority, approval gates, `apply.js` or #23F | Unchanged (TSB-F02 constraint, §5.1.7) |

Part 1 result is a frozen data descriptor `HistoricalApplyEvidence` with the
recomputed identities: projectId, runId, packageOrdinal, reviewRecordId,
applyRecordId, reviewRecordDigest, packageDigest, changeSetDigest,
automationPlanDigest, repositoryContextDigest, projectionDigest,
appliedRecordSha256, historical rootDigest and principal key, product
name/version, framework, and the approved target set `{path, operation,
afterDigest}` for ALL changes. Field names reuse OD-06 §11.1 binding names;
no new canonical encoding is defined in S0.

#### 5.1.4 Part 2 — CI-time execution binding (`PROPOSED`)

Purpose: bind the historical approved bytes to exact Git objects and to the
bytes that X will execute, at one commit.

Git object rules (V, read-only, through Git plumbing — never through a
working-tree checkout that applies filters):

| # | Rule |
|---|---|
| G1 | The commit is resolved by full object id from the service-provided `GITHUB_SHA` of the dispatch; V records commit id, tree id and the repository object format |
| G2 | For every approved change path: the tree entry exists at exactly that PPI-1 path; mode is `100644`; not `120000` (symlink), not `100755` (executable), not `160000` (gitlink/submodule); no ancestor tree entry is a gitlink or symlink |
| G3 | The blob's raw object bytes are read without smudge/clean/eol/LFS filters; `SHA-256(blob bytes)` must equal the approved `afterDigest` under the existing `afterDigest` definition of AppliedChangeSetRecord v1 (S0 does not restate it; slice S2 must prove equivalence by test vectors). An LFS pointer, CRLF-converted or filtered blob therefore mismatches and refuses |
| G4 | `.gitattributes` entries (at any level) that apply a filter, `eol`, `text`, `working-tree-encoding` or `export-subst` to any bound path refuse (they would make working-tree bytes differ from blob bytes) |
| G5 | `.gitmodules` presence is recorded; a gitlink anywhere on a path that the framework adapter or config selection could reach refuses (exact rule: slice S2) |
| G6 | Executable target set = exactly the applied Cypress `cypress/e2e/**/*.cy.js`-shaped or Playwright `playwright/**/*.spec.js`-shaped specs of the package (OD-06 §8.1 last paragraph); helper/config-only packages refuse; no subset, suite fallback, grep or extra target |
| G7 | Other spec files present in the commit are **not executed**; adapter argv selects only the bound set (OD-06 §8.2 rules carried). A config that adds specs beyond the selection is detected by report bijection (§9.4 OD-06) and yields error, never PASS |
| G8 | Dependency/config inputs are bound **by digest and recorded**, not approved: framework config file(s), root `package.json`, `package-lock.json`, framework package metadata. Proposed additional rule: config and `package.json` bytes must equal those captured in the plan-time `automation-repository-context` (`repositoryContextDigest`); otherwise refuse `CHANGED_SINCE_PLAN`-class input mismatch (reason code naming: `PO DECISION REQUIRED`) |
| G9 | Lockfile bytes are bound by digest; install is from that lockfile only (`npm ci` in X, §5.2.4). No dependency is approved by Stage 4; dependency code is untrusted target code |

Materialization rules (X prelude, before any target-controlled instruction):

| # | Rule |
|---|---|
| M1 | Fetch the exact commit by id; check out with `core.autocrlf=false`, no LFS smudge, no hooks, no submodule update |
| M2 | Re-hash every bound path in the working tree; bytes must equal G3 digests; must be regular, non-symlink, link count 1 |
| M3 | Re-hash G8/G9 inputs; must equal V's recorded digests |
| M4 | Any mismatch: X does not start target code and reports a prelude refusal (non-authoritative; R decides, §5.3) |

M2–M4 are valid only up to the first target-controlled instruction. After
that, X state is untrusted (R-4 class widened to VM authority, §5.2.3).

#### 5.1.5 Identity

| Identity | Proposed source | Notes |
|---|---|---|
| Stage 4 identities | Part 1 recomputation | Unchanged grammars (runId `yyyymmddThhmmssZ-<16 hex>`, ordinal `NNNN` ≠ `0000`) |
| Repository | service-provided `repository_id` (numeric), never the owner/name string alone | Renames/transfers keep id |
| Commit/tree | G1 | — |
| Consumption key | over (repository_id, historical rootDigest, runId, ordinal) **and** (repository_id, packageDigest, applyRecordId), mirroring OD-06 §11.2 keys with `repository_id` added and **commit excluded** so the same input under another commit is a replay | Encoding/hash domain: `PO DECISION REQUIRED / S2` |
| executionId | Options: (a) 128-bit CSPRNG generated by V and recorded in the ledger (OD-06 style); (b) deterministic derivation from the consumption key (D3 proposal) | (b) requires a new hash domain → not defined here; recommendation (a) |
| Execution record identity | executionId + GitHub `run_id` + `run_attempt` + job ids of V/X/R | job ids from Jobs API (GH-17) |

#### 5.1.6 Workflow and verifier provenance

| Element | Binding proposed | Limitation |
|---|---|---|
| Verifier code | The exact `qa-ai-agent` version recorded in the bundle's manifest, installed in V/R **alone** from the lockfile entry's `resolved` + `integrity`, with `--ignore-scripts`, without installing other target dependencies | The lockfile is target-owned; integrity proves registry tarball identity, not that the target chose an honest verifier version |
| Workflow definition | V records `github.workflow_ref`, `github.workflow_sha`, `event_name`, `ref`, `sha`, `run_id`, `run_attempt`, `actor`, `triggering_actor` (service context) | The workflow file at that commit decides which steps run; a writer who edits it can remove every check. Provenance is only as strong as the consumer's protected-ref policy (TB-C, Q3) |
| Required ref | `event_name == workflow_dispatch` and `ref == refs/heads/<default branch>`, and `workflow_ref` points to the same default-branch workflow path | Self-checks inside a workflow cannot prove the workflow was not edited; they detect misconfiguration only |
| Third-party actions | Allowed only in V/R if pinned by full commit SHA; X uses no third-party action after the prelude (proposed) | `sha_pinning_required` is consumer configuration (§2.3 shows `false` here) |

#### 5.1.7 Deterministic acceptance/refusal and invariant preservation

V admits iff H1–H7, G1–G9 all pass, the consumption key is absent from the
ledger, the gating rules of §5.2.7 pass, and the ledger reservation succeeds
(§5.3). Any other outcome refuses before X is scheduled, with exit mapping in
§5.4.5.

| Invariant | Disposition |
|---|---|
| approved-bytes == applied-bytes | PRESERVED within Part 1 (H5) and extended to approved-bytes == committed-blob-bytes == executed-working-tree-bytes at prelude time (G3, M2) |
| TSB-F02 (`OPEN / LOW / CONDITIONAL`) | Part 1 is a new consumer of `review-record-v2.validateRecord` and `validateAppliedChangeSetRecord` in a **historical mode without live root/principal**. The proposed graph adds no gate or #23F edge, but it is a changed consumer: proposed trigger = **INDETERMINATE until slice S2 static proof**. STOP if TRUE or INDETERMINATE at implementation |
| TAP-2 / CRS-1 / PPI-1 | PRESERVED; unchanged and still local |
| R-1..R-5 | Not weakened silently: R-3 widening (B1-F03) and principal replacement (B1-F02) are `PO DECISION REQUIRED` (decisions 5, 6) |
| Single-use apply | PRESERVED (Stage 4 unchanged). Execution single-use is a separate consumption (§5.3) |

---

### 5.2 B2 — CI security and authority

#### 5.2.1 Candidate jobs

| | V — verify and consume | X — execute | R — evaluate and publish |
|---|---|---|---|
| Authoritative inputs | Service context; Git objects at `GITHUB_SHA`; evidence bundle (untrusted data); ledger state | V job outputs (handoff descriptor); Git objects; SUT environment values | V job outputs; Jobs API facts for X; X artifact (untrusted data); ledger state |
| Code origin | Installed `qa-ai-agent` exact version only (§5.1.6); runner image tools (`git`, `node`) as provider dependency | Prelude: same product version; then **target-controlled**: framework packages, config, approved specs, all dependencies and lifecycle scripts | Same as V |
| Target code executed | **Never** (no `npm ci`/`npm install` of target deps, no lifecycle scripts, no `require` of target JS, no framework config load) | Yes, after prelude | **Never** |
| `permissions` | `contents: read`, `actions: read` only if needed; ledger write capability per §5.3 via a separately scoped credential, not `contents: write` on `GITHUB_TOKEN` (`PO DECISION REQUIRED`, decision 9) | `permissions: {}` | `contents: read`, `actions: read` (Jobs/artifacts API); ledger write as V |
| OIDC | none, unless the PO selects attestation (§5.3.4) | **forbidden** (`id-token` absent) | optional attestation only (`PO DECISION REQUIRED`) |
| Credentials | none beyond above | only `SUT_*` values from an environment restricted to the default branch (§5.2.8); no AI/provider secret, no GitHub write credential | ledger credential only |
| Cache | `cache-mode: none` (GH-09) | `cache-mode: none` | `cache-mode: none` |
| Outputs | job outputs ≤1 MB (GH-11): closed handoff descriptor; no artifact used for V→X/R authority | one bounded report artifact (untrusted); job outputs ignored by R for authority | ledger result record; bounded evidence artifact (copy, non-authoritative) |
| Failure handling | any refusal before reservation: no ledger write, X/R skipped by `needs` | any failure: R still runs (`if: always()`); X self-reports are non-authoritative | crash before ledger publication: §5.3.6 |

#### 5.2.2 Why `permissions: {}` is insufficient

`permissions: {}` sets the `GITHUB_TOKEN` scopes to none (GH-08). It does not
establish that no other credential is reachable inside the job:

- The Actions runtime credential used by artifact and cache clients
  (commonly exposed to actions as `ACTIONS_RUNTIME_TOKEN`) is a different
  credential from `GITHUB_TOKEN`; its scopes, lifetime and enforcement are
  not documented in the sources inspected (Q8). Its existence and the exact
  variable names are `NOT PROVEN` from documentation in this S0 and are stated
  here as a working hypothesis to be confirmed by slice S1.
- Passwordless `sudo` (GH-02) gives code in X the VM's full authority,
  including access to runner processes' memory and environment, the runner's
  files, and the ability to alter later steps of the same job.
- Therefore: any credential present anywhere on X's VM at any time after the
  first target instruction must be assumed **obtainable by target code**.

#### 5.2.3 X authority analysis (finding)

**B2-F01 (SECURITY BLOCKER).** On a standard GitHub-hosted Linux VM, target
code in X (approved specs, unapproved config/dependencies/lifecycle scripts)
runs with VM-level authority through passwordless sudo (GH-02). Consequences:

1. It can forge any X-produced report, artifact, log line, step output and
   self-measured process fact (exit code, signal, local timeout).
2. It can obtain any in-VM credential (§5.2.2), and use it within that
   credential's server-enforced scope and lifetime.
3. It can affect what X uploads, including deleting and re-creating an
   artifact under an existing name (`overwrite`, GH-15), within the run's
   artifact scope.

OD-06 relied on a root broker *outside* the workload as the authoritative
observer. No equivalent observer exists in X. R's only non-X facts are Jobs
API fields (GH-17), part of which originate from the X runner itself.

Proposed hardening (all `NOT PROVEN`; slice S1 qualification required):

| ID | Hardening | Purpose | Open proof |
|---|---|---|---|
| XH-1 | Prelude creates an unprivileged account without sudo, transfers the workspace to it, removes it from privileged groups, and launches the framework as that account under a fresh cgroup with a hard deadline using the VM's own service manager | Remove sudo from target code; make the prelude/runner the observer | That the runner image allows this; that no sudo/polkit/docker-group/writable runner path re-grants authority; local privilege escalation remains a residual |
| XH-2 | Install target dependencies (`npm ci` incl. lifecycle scripts) **as that account after the drop** | Lifecycle scripts never run with sudo | Cypress binary/Playwright browser provisioning under the unprivileged account; cache folders |
| XH-3 | Egress policy for that account (owner-match firewall rules) limited to the SUT and the package registry | Reduce SUT secret exfiltration | DNS/IP resolution of SUT, registry and browser download endpoints; GH-04 says runner IPs are not allowlists — this is the reverse direction and still unproven |
| XH-4 | Evaluate `ubuntu-slim` (unprivileged container, GH-03) for X | Remove sudo at the platform level | Single CPU, browser feasibility, nested-container behavior; the repository's own workflow notes Firefox-in-Docker hangs |
| XH-5 | X runs on a VM whose job holds no ledger, OIDC or write credential (already in §5.2.1) | Bound what forged authority can reach | Q8 runtime-credential scope |

Even with XH-1..XH-5, the X observer (prelude/runner) and the workload share
one kernel. Their separation is ordinary Linux user separation, not the
OD-06 root-broker boundary. R must still treat every X-produced byte as
untrusted. A PASS verdict can at most mean "the bound bytes were materialized
in a VM; a structurally complete report consistent with the service-reported
job facts was produced". If XH-1 is not qualified, PASS also implies the
assumption that target code did not forge the report. Accepting that is
`PO DECISION REQUIRED` (decision 6). Until then **SB-01** blocks activation
(§9).

#### 5.2.4 Dependency poisoning and lifecycle scripts

- V and R never install target dependencies (§5.2.1). They install only the
  product tarball by lockfile `integrity`, with `--ignore-scripts`.
- X installs target dependencies from the bound lockfile (G9). Registry
  compromise, malicious transitive packages and install-time downloads
  (Cypress binary, Playwright browsers) are target-code risk inside X.
- Cypress binary download at run time is `VERIFIED` repository behavior
  (§2.1). It is an unpinned native input unless the prelude pins the binary
  by version and digest (Q7).

#### 5.2.5 Cache isolation

- GH-09/GH-10: `workflow_dispatch` runs default to *write* access to
  default-branch-scoped caches, which every branch can restore. A job left on
  the default cache mode, with code that can use its cache token, could
  therefore create default-branch cache entries consumed by other workflows.
  An example is this repository's own `setup-node` `cache: "npm"` jobs.
- Proposed: `cache-mode: none` on V, X and R at job level (GH-09 states
  enforcement through scoped cache tokens, so it should hold against X's
  VM-level code). Whether `none` actually yields a token that the cache
  service refuses for save and restore is `NOT PROVEN` (Q6).
- No `actions/cache`, `setup-node` cache or tool cache restore in any job.
- Residual: the consumer's other workflows remain consumer-owned; this design
  cannot fix their cache use.

#### 5.2.6 Network egress and SUT secrets (finding)

**B2-F02.** GitHub-hosted runners have no documented egress control (GH-04).
X needs SUT credentials (if any) to test the SUT. Approved specs or any
dependency can send those values, or anything else readable in X, to any
destination. OD-06 classified harmful-test authority as R-5 territory
(§11.4, §19.1). On a hosted VM with sudo the reachable authority is larger:
VM-wide rather than one account. Options: XH-3 (unproven); restrict
`SUT_*` to non-production, low-value test credentials as a consumer
operating rule (not enforceable); accept as residual (`PO DECISION
REQUIRED`, decision 6). No secret confidentiality claim is made.

#### 5.2.7 Dispatch, triggers and gating

- `workflow_dispatch` authenticates *who* dispatched (GitHub actor). It is
  **not TAP-2 human approval** and adds no approval. Authorization to execute
  is: valid historical evidence (Part 1) ∧ CI binding (Part 2) ∧ not consumed
  ∧ dispatched on the protected default branch. Mapping "who may dispatch" to
  the Stage 4 principal is `PO DECISION REQUIRED` (decision 5).
- No human approval inside CI: environment *required reviewers* or other
  deployment protection rules that wait for a person are **not used** (they
  would be a CI approval, forbidden by OD-04 §23 and this mission).
  Environment *deployment branch* restriction is used (§5.2.8).
- Gating checks in V **and** in X's prelude **and** in R (each independently,
  from service context): `event_name == "workflow_dispatch"`, ref is the
  default branch, `run_attempt == 1`. X checks `run_attempt` itself because
  re-running a failed X may not re-run V (GH-13 leaves this undocumented).

Disallowed triggers (the workflow must declare only `workflow_dispatch`):
`pull_request`, `pull_request_target`, `push`, `schedule`, `workflow_run`,
`workflow_call` (as an entry point), `repository_dispatch`, `issue_comment`
and every other event. Self-hosted runners, larger runners with custom images,
`-latest` image labels and container jobs are excluded from this candidate
(Q7/Q9).

#### 5.2.8 Minimum supported consumer GitHub configuration (`PROPOSED`, fail-closed)

| # | Requirement | Verified by V? |
|---|---|---|
| C1 | GitHub.com repository; Actions enabled; standard GitHub-hosted Linux VM pinned by explicit version label (not `-latest`) | label recorded; image identity not verifiable (Q9) |
| C2 | Default workflow permissions `read` | read via API if accessible; otherwise refuse (`PO`: whether unreadable = refuse) |
| C3 | Default-branch ruleset: PRs required, ≥1 approving review by someone other than the last pusher, workflow-path changes require code-owner review, force-push/deletion blocked, enforcement active | read via API where permitted; a self-check is detection, not proof |
| C4 | Tag (or ref) ruleset for the ledger namespace: restrict creations, updates, deletions; bypass list contains only the ledger-writer identity | read via API where permitted |
| C5 | Environment for SUT secrets with deployment branches restricted to the default branch and **no required reviewers** | read via API |
| C6 | Actions allowed only when SHA-pinned | read via API |
| C7 | Fork pull-request workflows cannot reach environment secrets (default platform behavior; the execution workflow has no PR trigger anyway) | trigger list check |

These settings are consumer-administered; any repository admin can change
them after V checks them. Admin trust is therefore part of the trust root
(PO decision 9). Proposed qualification rule: V refuses (`INELIGIBLE`-class,
exit 5) when any check that the API exposes fails or cannot be read.

---

### 5.3 B3 — Lifecycle, result and recovery

#### 5.3.1 Closed state machine (`PROPOSED` design-state labels)

The labels below are design states for review. They are **not** product
status or reason values and are not persisted under these names without a
PO decision. Terminal product statuses reuse OD-06's closed set
`PASSED`/`TEST_FAILED`/`TIMED_OUT`/`EXECUTION_ERROR`/`QUARANTINED`.

| State | Durable backing | Entered by | Allowed successors |
|---|---|---|---|
| S-REFUSED | none (nothing reserved) | V refusal before reservation | end |
| S-RESERVED | ledger consumption ref created (atomic create, Q1) | V | S-DISPATCHED, S-INCOMPLETE |
| S-DISPATCHED | V job completed `success` with handoff outputs (service-held) | service | S-EXECUTED, S-INCOMPLETE |
| S-EXECUTED | X job reached `completed` (any conclusion) per Jobs API | service | S-DECIDED, S-INCOMPLETE |
| S-DECIDED | R computed verdict in memory | R | S-FINAL, S-INCOMPLETE |
| S-FINAL | ledger result ref created (atomic create) with the record | R | end (terminal; immutable; never retried) |
| S-INCOMPLETE | consumption ref exists, no result ref | any loss after S-RESERVED | S-FINAL only through the recovery evaluation of §5.3.7, whose terminal is never `PASSED`/`TEST_FAILED` |

Rules:

- Reservation is consumption (as Stage 4 §20.2 and OD-06 §7): once
  S-RESERVED exists, the input is consumed regardless of outcome; no retry,
  reset or resurrection.
- Exactly one terminal record per consumption key; a second result-ref create
  fails, and the existing record stands.
- Unknown or incomplete state is never PASS.

#### 5.3.2 Ledger proposal and its limits

Candidate: consumption and result markers as Git refs in a reserved namespace
(e.g. `refs/tags/qa-agent/exec/<key>/consumed` and `.../result`; names
illustrative, not normative), each pointing to a commit object whose tree
contains one canonical record blob.

| Property | Assessment |
|---|---|
| Content immutability | Git objects are content-addressed: the record blob's bytes are fixed by its object id. `VERIFIED` (Git object model) |
| Ref immutability | Not intrinsic. A ref can be moved or deleted unless a ruleset restricts updates/deletions (GH-14); rulesets can be edited or disabled by repository administrators and bypassed by listed actors. **A ref pointing at a commit is not by itself an immutable record store** |
| Write-once creation | Requires "restrict creations" with a bypass list containing only the ledger writer. If creations are unrestricted, **any writer can pre-create a forged consumption or result ref** (pre-emption/forgery). Whether `GITHUB_TOKEN`/GitHub Actions can be a bypass actor is undocumented (GH-14); a GitHub App credential scoped to an environment would be a new privilege (PO decision 9) |
| Atomicity | That two concurrent creates of the same new ref result in exactly one success is `NOT PROVEN` (Q1) |
| Retention | Refs persist until deleted; artifacts and run logs expire/are deleted with the run (GH-15, workflow-artifacts docs). The ledger, not artifacts, is the durable evidence |
| Audience | Ledger contents are readable by every repository reader (B1-F05) |
| Authentication | A record is authenticated only as "created under the ledger-writer identity permitted by the ruleset at that time". Unkeyed. Optional artifact attestation (§5.3.4) |

#### 5.3.3 Result record content (`PROPOSED` field groups; closed schema in slice S2)

| Group | Source | Trust |
|---|---|---|
| binding | V Part 1 + Part 2 identities (§5.1.5) | recomputed by R from Git objects (R re-runs Part 1/2 read-only; V's outputs must equal R's recomputation) |
| platform | V/X/R `run_id`, `run_attempt`, job ids, `runner_name`, `labels`, `started_at`, `completed_at`, `head_sha`, X `conclusion` (Jobs API, GH-17); self-reported image version string labelled *self-reported* | service-reported facts; runner-originated parts and the image string are not authenticated |
| result | R's normalized result from the X report under OD-06 §9.3/§9.4 rules (closed JUnit vocabulary, bijection, counts) | **untrusted origin** (B2-F01); structural validity only |
| capture | report count/bytes/SHA-256 of each report file as read by R | R-computed over X-controlled bytes |
| verdict | status + reason (OD-06 vocabulary) + exit | R |
| digests | record digest | hash domain `PO DECISION REQUIRED / S2` |

#### 5.3.4 Verdict rules (`PROPOSED`, deterministic, first match wins)

No result is PASS solely because a job reports `success` or an artifact
contains passing data.

1. Binding: R's recomputation ≠ V outputs, or ledger consumption missing →
   `QUARANTINED`-class (state inconsistency).
2. Gating: any job with `run_attempt ≠ 1`, wrong event/ref → `EXECUTION_ERROR`
   (never executed authority) — exact reason `PO DECISION REQUIRED`.
3. X platform conclusion `cancelled`, `timed_out`, `skipped`, `null`, or X
   absent → `EXECUTION_ERROR` (see §5.3.5 for the timeout question).
4. X conclusion `failure`/`success` with missing, duplicated, extra,
   oversize, malformed or non-bijective report → `EXECUTION_ERROR`
   `RESULT_INVALID`.
5. Complete report: all specs executed, total failed 0, every spec
   passed > 0, X conclusion `success` → `PASSED` 0 — **subject to PO
   decision 6 on forged-output residual**.
6. Complete report with failed > 0 and X conclusion `failure` →
   `TEST_FAILED` 10.
7. Any other combination (e.g. `success` with failures, `failure` with zero
   failures, all-skipped) → `EXECUTION_ERROR` `RESULT_INVALID`.

Optional record authentication: R may create a Sigstore-backed artifact
attestation over the record bytes using `id-token: write` and
`attestations: write` (GH-08 scopes). This authenticates "produced by this
workflow identity", not result truth, and adds OIDC to R (`PO DECISION
REQUIRED`, decision 9).

#### 5.3.5 Timeout versus cancellation (finding)

**B3-F01.** OD-06 exit 8 requires an exact manager deadline plus empty proof.
In CI, the candidates are (a) a job `timeout-minutes` breach reported by the
service, or (b) an in-VM deadline enforced by the X prelude (XH-1).

- (a) GH-17 lists `timed_out` as a conclusion value, but the inspected
  sources do not state that a `timeout-minutes` breach yields `timed_out`
  rather than `cancelled`; user cancellation also yields `cancelled`. `NOT
  PROVEN`.
- (b) is X-produced and not authenticated (B2-F01).

Proposed: until Q4 is `PROVEN`, every timeout-like outcome maps to
`EXECUTION_ERROR` 7. Exit 8 is unreachable in the CI path. Whether that is
acceptable is `PO DECISION REQUIRED` (decision 8).

#### 5.3.6 Failure and recovery matrix (`PROPOSED`)

| Scenario | Durable state | Outcome | Retry? |
|---|---|---|---|
| Concurrent dispatch, same key | ≤1 consumption ref (if Q1 proven) | Loser V refuses `REPLAY`-class, exit 5 | No |
| Full workflow re-run | consumption ref exists; `run_attempt = 2` | V refuses (`run_attempt`, ledger) | No |
| Partial re-run of X (or X+R) | V outputs from attempt 1 may be reused (undocumented, GH-13) | X prelude refuses on `run_attempt ≠ 1` before target code; R records `EXECUTION_ERROR` if no final record exists, or does nothing if one exists | No |
| Same input under another commit | consumption key excludes commit | V refuses replay | No |
| Duplicate/replayed ref (copied evidence into another repository) | separate ledger (`repository_id` differs) | **Executes in the other repository** — cross-repository replay is not prevented because Stage 4 evidence carries no repository binding. Finding B3-F02, `PO DECISION REQUIRED` (decision 3) | — |
| Timeout vs cancellation | Jobs API conclusion | §5.3.5: `EXECUTION_ERROR` 7 | No |
| Runner loss | X conclusion `failure`/`cancelled`/absent | `EXECUTION_ERROR` 7 | No |
| Artifact missing / duplicated / overwritten / malformed | R enumeration of run artifacts by name and id | `EXECUTION_ERROR` `RESULT_INVALID`; overwrite (new id) is indistinguishable from honest upload — X-controlled either way | No |
| V complete, X absent (skipped/never scheduled) | S-DISPATCHED | R (if run) → `EXECUTION_ERROR`; if R absent → S-INCOMPLETE | No |
| X complete, R absent | S-EXECUTED, no result ref | S-INCOMPLETE → recovery evaluation (§5.3.7) | No re-execution |
| R crash before verdict publication | S-DECIDED not durable | S-INCOMPLETE → recovery evaluation | No |
| Incomplete consumed execution | consumption ref, no result ref | recovery evaluation; terminal never `PASSED`/`TEST_FAILED` | No |
| Output forged by VM-level code | indistinguishable | Residual (B2-F01) | — |

#### 5.3.7 Operator recovery without unapproved replay

Proposed: a recovery evaluation (a new R-only dispatch with an explicit
`executionId`) may only **finalize** an S-INCOMPLETE execution. It reads the
ledger and Jobs API facts of the original run. It never schedules X, never
creates a consumption ref, and its terminal outcome is `EXECUTION_ERROR` or
`QUARANTINED` — never `PASSED`/`TEST_FAILED`, even if a valid-looking
artifact still exists. This mirrors OD-06 reconcile ("reconcile never yields
PASS/TEST_FAILED"). Whether such a recovery path, its reason codes and its
dispatch identity are acceptable is a new product contract:
**`PO DECISION REQUIRED`** (decision 8). A new execution of the same package
always requires a new Stage 4 run and approval (unchanged OD-04 policy).

---

### 5.4 B4 — CLI and product compatibility

#### 5.4.1 Product surface

The npm package and the `qa-agent` bin remain the only supported surface.
No published GitHub Action, no reusable-workflow product, no new export, no
programmatic API. The consumer workflow is a **documented example** copied
into the target repository (productization §12 already lists such a file as
optional and target-owned).

#### 5.4.2 Proposed `execute` grammar (`PROPOSED`; all of it is a CLI contract change)

```text
qa-agent execute export   --run <id> --package <NNNN> --out <dir>   (local; writes evidence bundle)
qa-agent execute verify   --run <id> --package <NNNN> --json        (V)
qa-agent execute prelude  --handoff <file>                          (X, before target code)
qa-agent execute evaluate --handoff <file> --report-dir <dir> --json (R)
qa-agent execute recover  --execution <id> --json                    (R-only recovery, §5.3.7)
```

- `export` is new local behavior: it copies, never modifies, the package's
  Stage 4 evidence into a target-owned directory for committing. It does not
  create, read for authority or change approval state. Whether it also
  refuses under the Stage 4 CI policy is `PO DECISION REQUIRED`.
- `verify`/`prelude`/`evaluate`/`recover` refuse when not run inside the
  supported CI mode. Detection via `GITHUB_ACTIONS` is a policy refusal, not
  a security boundary (OD-04 §23 principle carried).
- Until activation: every `execute` form stays the existing reserved fixed
  refusal, exit 5, reading no input (`RELEASE_CAPABILITIES.execute` unchanged).
- Alternative rejected: one `execute` command that infers its phase from the
  environment (ambient-state authority).

#### 5.4.3 Target-owned config (`PROPOSED`; config schema change)

An `execute` block in `qa-agent.config.json` using OD-06's proposed shape
`{ timeoutMs, sutEnvironmentNames }` (`timeoutMs` 1000..600000, default
600000; ≤32 names matching `SUT_[A-Z][A-Z0-9_]{0,59}`), plus a runner
selection field naming the CI-runner mode. Config v1 is closed (unknown keys
refused), so this is a schema revision: version number, migration and
`config validate` behavior are `PO DECISION REQUIRED` (decision 7).
`capabilities.execute` remains the target opt-in; the release gate still
decides.

#### 5.4.4 Versioning, installation, framework selection

- Exact product version pinned in the target lockfile; V/R install that exact
  version alone by integrity (§5.1.6); the bundle's manifest product version
  must equal it (H2).
- Framework = config `framework` (sole authority), must agree with plan and
  package (OD-06 §8.1 item 7). Adapters reuse OD-06 §8.2 argv shapes
  (Cypress `--posix-exit-codes`, JUnit reporters; Playwright JUnit, chromium
  project) as data. The native/browser provisioning differs (Q7).

#### 5.4.5 Status, reason and exit mapping (`PROPOSED`)

| Phase | Outcome | Exit |
|---|---|---|
| any | usage | 2 |
| any | config | 3 |
| verify | evidence/binding mismatch (H*, G*) | 4 |
| verify | not eligible (configuration checks C1–C7, gating), replay/consumed | 5 |
| prelude | refusal (non-authoritative; R decides) | 4 or 5 per class |
| evaluate | `PASSED` | 0 |
| evaluate | `TEST_FAILED` | 10 |
| evaluate | `EXECUTION_ERROR` (incl. all timeout-like outcomes until Q4) | 7 |
| evaluate | `QUARANTINED` | 7 |
| evaluate | `TIMED_OUT` | 8 — unreachable until Q4 `PROVEN` and PO decision 8 |
| any | internal bug | 1 |

No new exit code. Existing reason codes from OD-06 §11.3 are reused where
their meaning is unchanged; any new reason code (e.g. for G8 or gating) is
`PO DECISION REQUIRED`. The X job's own exit code is never the verdict.

#### 5.4.6 Reporting and demo

- R prints the closed record (`--json`) and uploads a non-authoritative copy;
  the ledger record is the evidence of record.
- `info` currently reports `executeDecision: "PENDING_OD_06"`; any change of
  that wording is a CLI contract change tied to activation (unchanged now).
- External demo (`qa-agent-demo`, currently not resolvable, §2.3): install the
  released tarball, run Stage 4 locally by a human, `execute export`, commit,
  push, dispatch, observe the ledger record — final slice S8.

#### 5.4.7 Changes to existing contracts (inventory)

| Contract | Change | Authority |
|---|---|---|
| CLI grammar | `execute` subcommands, `--handoff`, `--report-dir`, `--execution`, `--out` | PO decision 7 |
| Config v1 | `execute` block, runner field → schema revision | PO decision 7 |
| Stage 4 §17.2 "product does not require Git" | Execution path requires Git and GitHub | PO decision 3 |
| Stage 4 CI policy | unchanged for `review record`/`apply`; `execute export` CI behavior | PO decision 7 |
| OD-06 runner matrix (GitHub-hosted DEFERRED) | proposed CI-runner mode | PO decision 1/2 |
| Execution record v2 (OD-06 §11.3) | controller group replaced by platform group; cleanup proof replaced | PO decision 2, new proof |
| Exit 8 semantics | unreachable in CI path | PO decision 8 |
| RC-08 interpretation | CI-runner execution | PO decision 12 |

---

### 5.5 B5 — OD-06 supersession matrix

Each OD-06 guarantee is mapped to exactly one category. No historical finding
is closed or accepted by this mapping, and D1/D2 are not revoked by it.

| # | OD-06 guarantee (section) | Category | Justification / required proof |
|---|---|---|---|
| 1 | Approval/apply evidence binding, gate-free reconstruction (§8.1 items 1–5) | PRESERVED | Part 1 H1–H5, H7 |
| 2 | Immutable apply binding: fresh exact approved bytes of ALL changes (§8.1 item 5) | REPLACED — NEW PROOF REQUIRED | Replaced by Git blob + working-tree re-hash (G3/M2); needs S2 equivalence vectors |
| 3 | OS-principal recheck (§8.1 item 4) | PO DECISION REQUIRED | Cannot exist on a runner (B1-F02) |
| 4 | Root realpath/dev/inode recheck, enrolled root, non-overlap (§5.5, §8.1 item 6) | PO DECISION REQUIRED | Not transportable (B1-F01); repository_id + commit is a different identity |
| 5 | Native/framework fingerprint `od06-files-v1`, profileDigest (§8.2) | REPLACED — NEW PROOF REQUIRED | Digest recording G8/G9; no operator qualification profile; hosted image drift (Q7) |
| 6 | Closed adapters/argv (§8.2) | PRESERVED | Same argv shapes as data; qualification per hosted image |
| 7 | Fresh environment and SUT-only names (§9.1) | REPLACED — NEW PROOF REQUIRED | Prelude-built env as unprivileged account (XH-1); not root-broker memfd envelope |
| 8 | Privileged broker, sudo, systemd transient unit (§4–§6) | NOT APPLICABLE — JUSTIFIED | No operator host; the provider VM replaces the host. The *security function* (an observer outside the workload) is **not** replaced (B2-F01) |
| 9 | Durable root-owned journal, claims, tombstones (§7, §11.2) | REPLACED — NEW PROOF REQUIRED | Ledger refs (§5.3.2); Q1/Q2 |
| 10 | Process termination / whole-tree empty proof (§6.3) | REPLACED — NEW PROOF REQUIRED | VM discard at job end (provider) + optional in-VM cgroup (XH-1); no authenticated empty proof; results are read after job completion, so late writes cannot race R |
| 11 | Output/report validation (§9.2–§9.4) | PRESERVED | Same JUnit vocabulary, bijection, bounds; R parses as non-executing data consumer |
| 12 | Broker-authoritative report accounting (§9.4) | REPLACED — NEW PROOF REQUIRED | R computes accounting over X-controlled bytes; authority lost (B2-F01) |
| 13 | Timeout exit 8 with manager deadline (§6.3, §9.3) | PO DECISION REQUIRED | Q4; §5.3.5 |
| 14 | Error/quarantine taxonomy and precedence (§9.3, §11.3) | PRESERVED | Statuses reused; reasons partly not applicable (e.g. `MISSING_UNIT_PROOF`) — mapping in slice S2 |
| 15 | Same-boot / reexec recovery, Cases A–H (§7) | NOT APPLICABLE — JUSTIFIED | No persistent host manager; replaced by S-INCOMPLETE recovery (§5.3.7), itself `PO DECISION REQUIRED` |
| 16 | No retry / single consumption (§7) | PRESERVED | §5.3.1 |
| 17 | Compatibility pair npm/broker (§5.4) | NOT APPLICABLE — JUSTIFIED | No broker artifact; product version pin (§5.4.4) |
| 18 | Workload storage bound (§5.6.3) | REPLACED — NEW PROOF REQUIRED | VM disk; bounded reads in R only |
| 19 | Namespace/filesystem trust (§5.6.1–2) | NOT APPLICABLE — JUSTIFIED | Provider VM; qualification of image (Q7/Q9) |
| 20 | TSB-F02 proposed trigger FALSE (§10) | REPLACED — NEW PROOF REQUIRED | Historical-mode consumer → INDETERMINATE until S2 proof |
| 21 | R-1..R-5 execute impact (§11.4) | PO DECISION REQUIRED | R-3 widening, R-5 VM-wide authority, principal replacement |
| 22 | Carried debt L1–L7, I1–I5 (§19.1) | PO DECISION REQUIRED | Mapping in §9.2; none closed |
| 23 | Windows REFUSED (§3) | PRESERVED | CI path is Linux-only |
| 24 | Self-hosted provisioned Linux as initial candidate (§3) | PO DECISION REQUIRED | Whether CI-runner mode replaces, coexists or is refused (decision 1/2) |

---

### 5.6 B6 — Minimum implementation to R1

See §11 for the serial slices, tests and STOP conditions.

---

## 6. Closed lifecycle / state / error proposal (summary)

```text
            ┌──────────┐ refuse (exit 2/3/4/5; nothing written)
 dispatch → │    V     │──────────────────────────────────────► S-REFUSED
            └────┬─────┘
                 │ ledger consumption create (atomic? Q1)
                 ▼
            S-RESERVED ──(V lost after create)──────────────┐
                 │ V success + outputs                       │
                 ▼                                           │
            S-DISPATCHED ──(X absent/cancelled/lost)─────────┤
                 │ X completed (any conclusion)              │
                 ▼                                           ▼
            S-EXECUTED ──(R absent/crash)──────────────► S-INCOMPLETE
                 │ R evaluates                                │ recovery (R-only):
                 ▼                                            │ EXECUTION_ERROR | QUARANTINED
            S-DECIDED ──(publish fails)───────────────────────┤
                 │ ledger result create                       │
                 ▼                                            ▼
            S-FINAL {PASSED 0 | TEST_FAILED 10 | EXECUTION_ERROR 7 | QUARANTINED 7 | (TIMED_OUT 8: unreachable)}
```

Error classes: usage 2 → config 3 → authority/eligibility 5 and input 4 in the
existing pipeline order → execution 7/10 (8 unreachable). No new exit code.

---

## 7. Q1–Q9 qualification matrix

Format per gate: ASSERTION → EVIDENCE → STATUS → FAILURE MODE → REQUIRED ACTION → PO AUTHORITY.
No live test, ruleset/tag/environment mutation or dispatch was performed.

### Q1 — Atomic and enforceable write-once consumption/result ledger

- **Assertion:** Consumption and result records can be created exactly once,
  never updated or deleted, and only by the ledger-writer identity.
- **Evidence:** GH-14 (restrict creations/updates/deletions exist; bypass
  actors are roles/teams/Apps; Actions/`GITHUB_TOKEN` as bypass actor
  undocumented); Git object immutability; §2.3 shows no tag ruleset and the
  only ruleset disabled in this repository. Concurrent-create atomicity not
  documented.
- **Status:** `NOT_PROVEN`
- **Failure mode:** Writers pre-create or move refs (forged consumption/
  result); admins edit/disable rulesets; concurrent creates both "succeed";
  deletion re-enables replay.
- **Required action:** In a disposable sandbox repository: configure a tag
  ruleset; test create/update/delete by the writer identity, other writers,
  admin and `GITHUB_TOKEN`; concurrent same-name creates (N≥50); ruleset
  disable/bypass audit visibility. Needs repository-admin permission on the
  sandbox and dispatch authority.
- **PO authority:** sandbox creation + ruleset mutation + workflow dispatch
  authorization; ledger-writer identity (decision 9); admin-trust acceptance.

### Q2 — Authoritative prevention of rerun, partial rerun, replay and duplicate execution

- **Assertion:** No input executes more than once across new dispatches,
  re-runs, partial re-runs, other commits or copied evidence.
- **Evidence:** GH-13 (re-runs keep SHA/ref and original actor privileges;
  30 days; 50 re-runs; dependant/outputs behavior undocumented); design
  checks `run_attempt` in V, X prelude and R; ledger key excludes commit.
  Cross-repository replay not prevented (B3-F02).
- **Status:** `NOT_PROVEN`
- **Failure mode:** Partial re-run executes X again with reused V outputs;
  `run_attempt` semantics differ from assumption; replay in another
  repository.
- **Required action:** Sandbox tests of full, failed-only and single-job
  re-runs (observe `run_attempt` in each job, output reuse, X prelude
  refusal); duplicate dispatch; same input at two commits; ledger dependency
  on Q1. PO decision on cross-repository replay.
- **PO authority:** dispatch/re-run authorization in sandbox; decision 3.

### Q3 — Authenticated dispatch and execution authorization independent of spoofable environment

- **Assertion:** Execution starts only through a dispatch on the protected
  default branch, under the protected workflow definition, and authorization
  derives only from service context and verified evidence, never from env
  values that target code can set.
- **Evidence:** V/R run no target code, so their service context is not
  target-influenced (design); workflow file integrity depends on consumer
  protected-ref policy (TB-C); §2.3 shows 0 required reviews, disabled
  ruleset, default write token in this repository; GH-07.
- **Status:** `NOT_PROVEN`
- **Failure mode:** A writer edits the workflow to skip V or alter R; a
  non-default-branch workflow is dispatched; dispatch identity mistaken for
  approval.
- **Required action:** Specify and test C1–C7 self-checks; sandbox tests:
  dispatch from non-default ref, modified workflow on a branch, workflow
  edits via PR under the required ruleset. PO decision on the identity that
  may dispatch.
- **PO authority:** decisions 5 and 9; sandbox authority.

### Q4 — Authenticated timeout/cancellation classification

- **Assertion:** A real execution timeout is distinguishable, from authenticated
  facts, from cancellation, runner loss and target-forged timing.
- **Evidence:** GH-17 lists `timed_out`; no inspected source states it is
  produced for a `timeout-minutes` breach; GH-12 6 h job limit; in-VM
  deadlines are X-produced (B2-F01).
- **Status:** `NOT_PROVEN`
- **Failure mode:** Timeout reported as cancellation or vice versa; target
  code fakes an early or late exit.
- **Required action:** Sandbox tests: `timeout-minutes` breach, manual
  cancel, `cancel-in-progress` concurrency cancel, VM loss simulation; record
  Jobs API conclusions. Until proven, map to `EXECUTION_ERROR` 7.
- **PO authority:** sandbox authority; decision 8.

### Q5 — Artifact identity, immutability, completeness and validation

- **Assertion:** R can bind the evaluated report bytes to the X job of this
  run attempt and detect substitution, duplication and incompleteness.
- **Evidence:** GH-15 (v4 immutable but `overwrite` deletes and re-creates
  with a new id; digest coverage not stated); GH-16 (download digest check,
  run-scoped); artifacts carry no authenticated producing-job identity in the
  inspected sources; X has VM authority and the runtime credential (B2-F01,
  Q8).
- **Status:** `BLOCKED`
- **Failure mode:** X-authority code uploads, deletes or replaces artifacts
  with forged content; R cannot distinguish them from honest output.
- **Required action:** Design-level: no artifact can be an authority channel
  from X. Proceed only if the PO accepts the forged-output residual
  (decision 6) or a qualified XH-1/XH-4 observer is designed and proven.
  Still test count/name/id/digest enforcement in the sandbox.
- **PO authority:** decision 6.

### Q6 — Cache poisoning and cross-workflow trust isolation

- **Assertion:** No V/X/R job can read or write any Actions cache, and
  execution cannot poison other workflows.
- **Evidence:** GH-09 (`cache-mode`, scoped cache tokens; `workflow_dispatch`
  defaults to write); GH-10 (default-branch caches restorable by all
  branches; immutable entries; 7-day eviction); repository workflows use
  `setup-node` npm cache.
- **Status:** `NOT_PROVEN`
- **Failure mode:** X with VM authority saves default-branch cache entries
  under keys that other workflows restore; `cache-mode: none` not enforced as
  documented.
- **Required action:** Sandbox: X with `cache-mode: none` attempts direct
  cache save/restore with any reachable credential; verify refusal; verify no
  default-branch entry created; confirm evicted-key re-creation impossible.
- **PO authority:** sandbox authority; decision 6.

### Q7 — Reproducible Node/framework/browser/native/runtime identity incl. image drift

- **Assertion:** The executed Node, framework, browser and native binaries are
  identified exactly and match a qualified profile.
- **Evidence:** GH-05 (image update cadence/identity not documented);
  repository evidence of runtime Cypress binary download and earlier Node
  drift (§2.1); identity values read inside the VM are self-reported.
- **Status:** `NOT_PROVEN`
- **Failure mode:** Silent image update changes browser/Node; binary download
  substitution; result not reproducible.
- **Required action:** Pin runner image label; prelude installs Node 22 by
  exact version and digest, Cypress binary/Playwright browser by version and
  digest, before target code; record all digests; qualify the profile per
  image version; refuse unqualified combinations. The OD-06 exact-tuple
  qualification is replaced by "pinned-input + recorded-image" — `PO DECISION
  REQUIRED` (decision 4).
- **PO authority:** decision 4.

### Q8 — Actions runtime-token authority, reachability, lifetime and abuse paths

- **Assertion:** Every credential reachable by X target code is known, scoped
  to harmless operations and expires with the job.
- **Evidence:** GH-02 (sudo ⇒ every in-VM credential is reachable); GH-06
  (`GITHUB_TOKEN` lifetime ≤ job/6 h); runtime-credential scope and lifetime
  undocumented in the inspected sources; with `permissions: {}`, `GITHUB_TOKEN`
  has no scopes (GH-08).
- **Status:** `NOT_PROVEN`
- **Failure mode:** Runtime credential permits artifact deletion/forgery in
  the run, cache writes, log tampering, or survives the job.
- **Required action:** Sandbox inventory of credentials visible to a sudo
  process in X (names only, never values persisted); test each against
  artifact, cache and results endpoints during and after the job; then
  re-run with XH-1 to prove the unprivileged account cannot reach them.
- **PO authority:** sandbox authority; decision 6.

### Q9 — Independently verifiable GitHub-hosted runner environment identity

- **Assertion:** R can verify, independently of X, which VM image and
  hardware isolation executed X.
- **Evidence:** GH-01/GH-05; Jobs API gives `runner_name` and `labels`
  only; image-version strings are produced inside the VM; no attestation
  mechanism for hosted-runner identity is documented in the inspected
  sources.
- **Status:** `BLOCKED`
- **Failure mode:** Execution environment cannot be named in the SADR-11
  dossier beyond "a GitHub-hosted VM with label L".
- **Required action:** None technical in this design. The PO either accepts
  provider-trusted environment identity (decision 4) or the CI-runner mode is
  refused (decision 1).
- **PO authority:** decisions 1 and 4.

### Summary

| Gate | Status |
|---|---|
| Q1 | NOT_PROVEN |
| Q2 | NOT_PROVEN |
| Q3 | NOT_PROVEN |
| Q4 | NOT_PROVEN |
| Q5 | BLOCKED |
| Q6 | NOT_PROVEN |
| Q7 | NOT_PROVEN |
| Q8 | NOT_PROVEN |
| Q9 | BLOCKED |

---

## 8. OD-06 supersession matrix

The mapping is §5.5. S0 **proposes** that the CI-runner mode could supersede
OD-06's runner matrix for Controlled-v1. It cannot enact that. OD-06 remains
`COMPLETE_ON_MAIN / POST-MERGE CERTIFIED` historical design until a separate
owner decision and its canonical synchronization.

---

## 9. Security threat and residual register

### 9.1 Blockers and findings (unresolved; none hidden)

| ID | Severity proposal (for independent Security review) | Statement | Gate/decision |
|---|---|---|---|
| SB-01 | BLOCKER | Target code in X has VM authority (passwordless sudo); every X output, including PASS evidence, is forgeable; no authoritative observer outside the workload | B2-F01, Q5, Q8; decision 6 |
| SB-02 | BLOCKER | Stage 4 approval cannot be authenticated in CI; the forgery class widens from run-directory writer to ref writer; principal/root rechecks lost | B1-F01..F04; decisions 5, 6 |
| SB-03 | HIGH | Workflow/verifier provenance is bounded by consumer branch policy and admin trust; this repository currently has 0 required reviews, disabled ruleset, default write token | Q3; decision 9 |
| SB-04 | HIGH | Ledger write-once depends on rulesets, an undocumented bypass identity and undocumented create atomicity | Q1; decision 9 |
| SB-05 | HIGH | Partial re-run semantics undocumented; duplicate execution possible if `run_attempt` gating fails | Q2 |
| SB-06 | MEDIUM | Unrestricted egress; SUT secret exfiltration by approved or dependency code with VM authority | B2-F02; decision 6 |
| SB-07 | MEDIUM | Default-branch cache poisoning from `workflow_dispatch` jobs unless `cache-mode: none` holds | Q6 |
| SB-08 | MEDIUM | Runtime identity drift / self-reported image identity | Q7, Q9; decision 4 |
| SB-09 | MEDIUM | Timeout not authenticatable; exit 8 unreachable | Q4; decision 8 |
| SB-10 | MEDIUM | Committed evidence publishes model text and records to all repository readers | B1-F05; decision 3 |
| SB-11 | LOW | Cross-repository replay of copied evidence | B3-F02; decision 3 |
| SB-12 | CONDITIONAL | TSB-F02 trigger INDETERMINATE for the historical-mode verifier | §5.1.7; slice S2 |

Severity labels are proposals for the independent review, not ratings.

### 9.2 Carried OD-06 debt L1–L7 / I1–I5

None is closed, waived or accepted here.

| ID | Proposed applicability to the CI-runner mode |
|---|---|
| L1 root P0 parser hardening | NOT APPLICABLE to a root broker; the analogous requirement applies to R's report/record parsers (memory-safe bounded parsing, fuzzing) — PO decision 10 |
| L2 CREATE with enrollment disabled | NOT APPLICABLE (no enrollment); analogous: `capabilities.execute=false` / config ineligibility refuses in V |
| L3 P0 grammar-only boundary | Analogous: V input grammar checks before evidence reads |
| L4 same-account authority, ptrace scope | APPLICABLE in stronger form: SB-01 (VM authority) |
| L5 workload-storage backing | NOT APPLICABLE (provider VM disk) — justification subject to review |
| L6 inode floor | NOT APPLICABLE as above |
| L7 global broker concurrency cap | Analogous: ledger/key concurrency and dispatch rate; Q1/Q2 |
| I1 refusal-reason tabulation | APPLICABLE to V refusals |
| I2 initial-namespace defence-in-depth | NOT APPLICABLE |
| I3 WorkingDirectory/argv substitution (R-4) | APPLICABLE in stronger form (VM authority after prelude) |
| I4 sudo `use_pty`/pipe semantics | NOT APPLICABLE (no sudo broker); XH-1 introduces its own sudo-drop semantics needing qualification |
| I5 account-writable `/tmp`, `/dev/shm`, repository (R-5) | APPLICABLE in stronger form |

The mapping itself is `PO DECISION REQUIRED` (decision 10).

### 9.3 Residuals that would remain even if every gate were PROVEN

| Residual | Notes |
|---|---|
| R-1 | Same-principal automation can complete Stage 4 locally; unchanged |
| R-2 | Local-account attribution; unchanged |
| R-3 (widened) | Any ref writer can forge self-consistent Stage 4 evidence |
| R-4 (widened) | Post-prelude mutation by target code at VM or account level |
| R-5 (widened) | Harmful tests and dependencies keep network/SUT authority on the VM |
| P-1 (provider) | GitHub-hosted VM/image/service trust (§4.3) |
| A-1 (admin) | Consumer repository administrators can change rulesets/environments |

No new residual is accepted by this document.

---

## 10. PO Decision Register

None of these dispositions is adopted. Each requires an explicit owner
decision identified by its own ID. Owner approval of S0 authoring does not
accept them.

| # | Subject | Proposed disposition | Evidence | Consequences | Required authority |
|---|---|---|---|---|---|
| 1 | Runner platform support boundary | Keep OD-06 self-hosted design certified; add "GitHub-hosted standard Linux VM, CI-runner mode" as a **candidate** only, remaining DEFERRED for execute until SB-01/SB-02 are dispositioned | OD-06 §3 DEFERRED; GH-02; PR #256 REFUSED proposal | Either path remains possible; no support statement changes | PO decision naming the supported runner classes for RC-08 |
| 2 | PR #256 and historical OD-06 treatment | PR #256 stays closed and non-canonical; OD-06 stays certified history; supersession only by a later canonical sync after S0 approval | §1.2 | No silent revocation of D1/D2 | PO decision + canonical ROADMAP/contract sync lifecycle |
| 3 | Git/GitHub execution dependency, portability, evidence audience | Execution path only (not product-wide) requires Git + GitHub.com; evidence bundle committed to the consumer repository; cross-repository replay acknowledged | B1-F05/F06, B3-F02 | Changes OD-04 §17.2 statement for the execute path; public exposure of run evidence | PO decision; ODR-03/ODR-05 audience disposition |
| 4 | Platform/VM trust and image drift | Treat VM/image as provider-trusted; replace exact-tuple qualification with pinned inputs + recorded image label/version | Q7, Q9 | Weaker environment identity in the SADR-11 dossier | PO + Security acceptance; ODR-06 |
| 5 | Replacement of same-principal execution identity | Replace by: valid historical evidence + dispatch by a repository writer on the protected default branch; record GitHub actor ids | B1-F02 | Execution authority = repository write authority | PO decision; ODR-01/ODR-07 |
| 6 | R-3/R-4/R-5, cache/runtime-token residuals, forged output | Do not accept now; require S1 qualification of XH-1/XH-4 and Q5/Q6/Q8 results first, then decide | SB-01, SB-02, SB-06, SB-07 | Activation blocked until decided | PO + independent Security; new residual acceptance only by explicit decision |
| 7 | CLI and config changes | Adopt the §5.4.2 grammar and config `execute` block as proposals for slice design | §5.4.7 | CLI/config contract revisions; documentation | PO decision on contract revision and versioning |
| 8 | Timeout / exit-8 and recovery semantics | Exit 8 unreachable until Q4 PROVEN; R-only recovery finalizes S-INCOMPLETE as error/quarantine only | §5.3.5, §5.3.7 | Users see 7 for timeouts | PO decision |
| 9 | Consumer workflow, ledger refs, rules/environment footprint | Target-owned copied workflow; tag ruleset; environment for SUT secrets (branch-restricted, no reviewers); ledger writer = dedicated credential (e.g. GitHub App) — new privilege | §5.2.8, §5.3.2 | Footprint grows beyond "one dependency line + one JSON file" for execute users; admin trust root | PO decision; ODR-07 |
| 10 | L1–L7 / I1–I5 mapping | Adopt §9.2 as the review baseline | §9.2 | None closed | PO + Security |
| 11 | Independent S0 Architecture/Security review gate | HEAVY Architecture then HEAVY Security on the exact S0 HEAD before any decision 1–10, 12 | Governance §7 release model | Serial WIP=1 | PO/governance |
| 12 | RC-08 CI execution interpretation | Whether a GitHub-hosted, provider-trusted execution with the §9.3 residuals satisfies "explicitly supported, independently assessed execution environment" | Release model §3 item 6 | Determines whether this path can ever satisfy RC-08 | PO decision |

Additional subjects raised by S0 (not in D3's list): reason-code additions
(G8, gating), new hash domains for consumption key/record digest
(slice S2), and whether `execute export` is permitted under CI policy.

---

## 11. Serial implementation slices and test plan (NOT AUTHORIZED)

All slices are strictly serial under WIP=1; each needs its own authority,
exact-head CI and independent review. None changes `RELEASE_CAPABILITIES`.

| Slice | Input → output contract | Prerequisite proof | Allowed future surfaces | Mandatory positive / negative tests | Review class | Lifecycle boundary | Exit / STOP |
|---|---|---|---|---|---|---|---|
| S1 Platform qualification spikes | Sandbox repository + throwaway workflows → evidence report for Q1, Q2, Q4, Q5, Q6, Q8 and XH-1/XH-4 | S0 reviewed; PO decisions 1, 6 (scope), sandbox authority | Separate sandbox repository only; no product code | Q1 concurrent creates, bypass/admin cases; Q2 re-run matrix; Q4 timeout/cancel conclusions; Q6 cache with `cache-mode: none`; Q8 credential inventory (names only); XH-1 sudo-drop escape attempts | HEAVY Security | research evidence only | STOP if any of Q1/Q2/Q5/Q8 fails without a PO-accepted alternative |
| S2 Contract specification | S1 evidence → closed schemas (handoff, record), hash domains, reason codes, TSB-F02 static graph proof | S1; decisions 3, 5, 7, 8 | docs only | Canonical vectors; G3 afterDigest equivalence vectors (LF/CRLF/LFS/symlink/gitlink/exec bit) | HEAVY Architecture + Security | design | STOP if TSB-F02 TRUE/INDETERMINATE |
| S3 Historical evidence verifier (Part 1) | bundle → `HistoricalApplyEvidence` or refusal | S2 | private module(s) under `scripts/ai/cli/`; tests | Every H-rule positive/negative; forged self-consistent bundle accepted (documents R-3); principal/root inconsistency refused; no gate/#23F edge (static graph) | HEAVY | implementation, release-disabled | STOP on any gate/#23F import edge |
| S4 Git binding verifier (Part 2) + `execute export` | commit + evidence → binding or refusal | S3 | private modules; tests | G1–G9 incl. symlink, gitlink, mode 100755, `.gitattributes` filters, LFS pointer, extra specs, config change since plan | HEAVY | release-disabled | — |
| S5 Ledger client | binding → consumption/result refs | S1 Q1 PROVEN or PO alternative; decision 9 | private module; workflow example (docs) | Concurrent create, replay, duplicate, missing, pre-created forged ref refused | HEAVY Security | release-disabled | STOP if write-once cannot be configured |
| S6 X prelude + adapters | handoff → materialized bytes, unprivileged execution, bounded artifact | S1 XH-1/XH-4 outcome; decision 6 | private modules; tests | M1–M4; `run_attempt ≠ 1` refusal; sudo unreachable from workload; secrets not in argv/logs | HEAVY Security | release-disabled | STOP if workload regains VM authority and PO has not accepted SB-01 |
| S7 R evaluator + CLI wiring | handoff + artifact + Jobs API → verdict/record; `execute verify/prelude/evaluate/recover` grammar | S3–S6 | CLI parser/handler private routes; tests | §5.3.4 precedence table; every §5.3.6 row; report bijection (OD-06 §9.4 vectors); forged PASS artifact analysis documented | HEAVY | release-disabled | — |
| S8 External installed-consumer E2E | released tarball in `qa-agent-demo` → full chain evidence | S7; demo repository created under authority | `qa-agent-demo` only | Human Stage 4 locally; export; dispatch; PASS and TEST_FAILED cases; replay refused; re-run refused; recovery path | HEAVY + release dossier | qualification evidence | Activation remains a separate PO decision |

Activation (`RELEASE_CAPABILITIES.execute`, `info` wording, ROADMAP/README/
SECURITY sync, SADR-11 dossier, release grant) is **not** a slice here.

---

## 12. STOP conditions and review requirements

### 12.1 STOP conditions (for any later work)

1. Any proposal that treats a Git commit, GitHub identity, dispatch, PR
   approval, environment reviewer or stored status as human approval.
2. V or R executing target-controlled code, installing target dependencies or
   running lifecycle scripts.
3. X receiving write credentials, OIDC, AI/provider secrets or ledger
   authority.
4. PASS derived from a job conclusion or an artifact alone.
5. TSB-F02 TRUE or INDETERMINATE at implementation.
6. Any Q-gate reported `PROVEN` without live evidence produced under explicit
   authority.
7. A required live test, ruleset/environment/tag mutation or new privilege
   without explicit authority.
8. Silent closure, waiver or acceptance of SB-*, L*/I*, R-*, AT-07/TB-01,
   XI-* or FUTURE guards.
9. Remote identity drift, competing engineering WIP or unauthorized file
   changes during any lifecycle step.

### 12.2 Review requirements

- Exact-head CI on the S0 PR using existing workflows (no new workflow).
- Independent HEAVY Architecture review of the exact S0 HEAD, then independent
  HEAVY Security review of the same HEAD (decision 11).
- Author completion is not approval. Review approval is not merge
  authorization. Merge is not canonical closure. None authorizes Stage 5
  implementation or activation.

### 12.3 Author statement

```text
DESIGN_APPROVED: NO
INDEPENDENT_REVIEWS: NOT_STARTED
IMPLEMENTATION: NOT_AUTHORIZED
EXECUTE: DISABLED
CONTROLLED_RELEASE: NOT_APPROVED
MERGE: NOT_AUTHORIZED
```
