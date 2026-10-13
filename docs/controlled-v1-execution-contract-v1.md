# Controlled-v1 OD-06 execution contract v1 — controller delivery STOP

Date: 2026-10-13 (Europe/Berlin).

Design authority: `OD-CONTROLLED-V1-OD-06-EXECUTION-DESIGN — APPROVED`.
Continuation authority: `OD-CONTROLLED-V1-OD-06-C1-RUNNER-CONTAINMENT — APPROVED`.

Mission result: **STOP — OWNER PRODUCT/DEPLOYMENT DECISION REQUIRED**.

This is the next precise STOP artifact (continuation outcome B). C1 is applied:
the process-tree authority must be a separate trusted controller using Linux
cgroup v2. The unresolved decision is controller delivery/provisioning.
Sections 1–2 preserve earlier discovery; sections 3–12 replace its old blocker.

This is **not a complete execution contract**, an OD-06 approval, an
implementation specification, a platform certification, or permission to
activate execution. The continuation stops before adopting new deployment
machinery or finalizing a controller-dependent protocol. Unfinished decisions
are explicit resumption blockers, never implementation discretion.

`execute` remains reserved and release-disabled; invocation returns exit 5.
Stage 4B remains **COMPLETE_ON_MAIN / POST-MERGE CERTIFIED**; reviewRecord/apply
remain release-enabled subject to their existing target opt-ins and gates.
Controlled Release remains **NOT APPROVED**. No ROADMAP completion state,
finding disposition, FUTURE guard, source, test, workflow or public API changes.

## 1. Certified baseline and original preflight (historical)

| Fact | Verified value |
|---|---|
| Repository | `TarasovArtem/qa-ai-agent` |
| Fetched `origin/main` | `126d105841cf404c92752ae54bb616ed710d7f53` |
| Main tree | `24f513931ac44e3fb71afb2f750616be75e112ec` |
| Existing remote design branch | `design/controlled-v1-od06-execution`, initially exactly the certified main SHA |
| Local checkout before this document | Exactly that SHA; clean |
| Later main commit | None at both fetch checks before this document |
| Branch handling | Local tracking checkout of the existing remote branch; no remote recreation, retarget, rebase or reset |
| Competing engineering WIP | None found in open PR inventory or extant additional worktree changes |

WIP=1 assignment comes from the mission authority. The open PR inventory
contained dependency-update PRs #243/#250/#251/#252 and historical proof PR
#132; no competing engineering PR. The two extant additional worktrees were
clean; two other registered worktrees were already prunable/nonexistent.
This is an inventory observation, not proof that no other machine has work.

## 2. Repository-grounded discovery

### 2.1 Installed command, config and package

The actual parser in [args.js](../scripts/ai/cli/args.js) classifies `execute`
as `kind: "reserved"`, with owner decision `OD-06`. Its trailing arguments
are not interpreted, apart from help/JSON presentation. The reserved route in
[cli.js](../scripts/ai/cli/cli.js) refuses before root/config/run reads;
`execute --help` is help-only and exits 0. There is no execution handler.

[policy.js](../scripts/ai/cli/policy.js) freezes
`RELEASE_CAPABILITIES.execute.enabled = false`. Target
`capabilities.execute = true` is schema-valid but cannot override that gate.
[errors.js](../scripts/ai/cli/errors.js) already reserves 7/8/10; their values
must not change. Provider selection cannot enable execution.

[config-file.js](../scripts/ai/cli/config-file.js) reads bounded strict JSON
once, rejects duplicate keys/invalid UTF-8/BOM/symlink leaves, and returns a
deep-frozen snapshot. Schema v1 has a closed top-level set and closed boolean
capabilities. `framework` is the target config authority (`cypress` or
`playwright`), not a provider-generated runner choice.
[FrameworkRuntimeConfig](../scripts/ai/framework-runtime-config.js) describes
data-only layout/config/report paths, not executable/argv/shell templates.
The current generative live-context builder in
[run-artifacts.js](../scripts/ai/cli/run-artifacts.js) still inspects the
conventional root `cypress.config.js`/`playwright.config.js`; configurable
layout support must not be inferred from the existence of that data schema.

[package.json](../package.json) declares Node 22.x, one `qa-agent` bin, five
export keys, and no runtime dependencies. The root barrel
[index.js](../scripts/ai/index.js) has 19 exported names and no execution API.
[Package Surface v5](package-surface-v5.md) and
[package-inventory.js](../test/helpers/package-inventory.js) establish a
103-file package inventory. The legacy execution/record/regeneration modules
are explicitly excluded. Its Stage 4A disabled review/apply annotations are
historical; [Stage 4B evidence](controlled-v1-stage4b-activation.md) owns their
subsequent activation.

The existing external proof
[controlled-v1-stage3-external-proof.test.js](../test/installation/controlled-v1-stage3-external-proof.test.js)
uses a real tarball in an external temp repository, tests private-import
denial, and checks the installed closure. Its safe test-harness `shell:true`
npx invocation is not a production execution precedent. No installation
test or framework execution was run during this design-only inspection.

### 2.2 Legacy execution is present but is not the product runner

[controlled-execution.js](../scripts/ai/test-automation/controlled-execution.js)
defines `executeAppliedChangeSet`, `runBoundedProcess`, and a closed
Cypress/Playwright mapping. It is repository-only, not shipped or routed by
the installed CLI. Actual properties:

- Framework comes from a validated plan. Cwd is the resolved repository root.
- Executable is constructed under `node_modules/.bin`; Windows selects a
  `.cmd` shim. Construction does not establish canonical package ownership,
  entrypoint authenticity, or absence of substitution/symlinks.
- Cypress argv is `run --headless --browser chrome --spec <comma-joined
  targets>`. Playwright uses `test --config=playwright.config.js
  --project=chromium <anchored escaped absolute-path regexes>`.
- Direct targets are applied `cypress/e2e/**/*.cy.js`-shaped or
  `playwright/**/*.spec.js`-shaped files. Support/helper-only changes refuse;
  there is no entire-suite fallback. Cypress target paths use a positive
  character allowlist to exclude glob/extglob syntax.
- TSB-F03 strengthening is present: closed AppliedChangeSetRecord validation,
  one-to-one change-set binding, approved-content digests, and fresh applied
  filesystem revalidation precede spawn. This is not a Stage 4 CLI
  outcome/ledger/principal integration.
- `spawn` uses `shell:false`, ignored stdin and piped stdout/stderr. No
  provider command text, npm script or free-form shell string is used.
- Timeout defaults/maxes at 600000 ms. Output constants are 200000 bytes per
  stream. Whole chunks are accumulated before final truncation; this is not
  an exact pre-allocation byte cap and no full report/disk bound exists.
- Timeout calls `child.kill()` once. There is no process-group ownership,
  SIGKILL escalation, independent watchdog, parent-death containment,
  descendant-empty proof or guaranteed bounded wait for pipe closure.
- The copied environment allowlist includes ambient PATH/HOME/profile/temp
  and CI. AI/GitHub secrets are excluded by name construction. This does
  not stop executable target code reading host files or spawning processes.
- Spawn error becomes EXECUTION_ERROR; timeout becomes TIMED_OUT; zero exit
  becomes PASSED; other outcomes become TEST_FAILED, including null-code
  signal outcomes. That legacy mapping is insufficient to distinguish the
  product's test-failure and runtime-error contract.

[automation-execution-record.js](../scripts/ai/test-automation/automation-execution-record.js)
already defines AutomationExecutionRecord **v1**, with four statuses,
applied-record digest, framework, descriptive command label, raw bounded
text/truncation flags, process exit code, timestamps and an unkeyed digest.
It has no executionId/run/package/root/principal/platform/durability binding.
Output text is limited to 4000 characters per stream in that record, which
differs from the launcher's capture limits. The builder proves shape and
integrity, not that execution occurred. It cannot silently serve as the
future installed-product authority envelope.

Repository-wide non-test search also found the CLI stage-process launcher
and a separate governance safety process launcher. Neither supplies a trusted
OS containment supervisor for the execute boundary. Searches for exec/fork
also matched regular-expression `.exec` methods and comments; those are not
child-process launches. Provider AbortController timeouts bound HTTP calls,
not test-process trees. Existing framework result adapters are triage
consumers; no installed execute result-parser contract exists.

### 2.3 Stage 4 authority integration that must be preserved

[Approval/apply contract](controlled-v1-approval-apply-contract-v1.md) remains
governing. [stage4-run.js](../scripts/ai/cli/stage4-run.js) reloads manifest
and artifacts, rebuilds canonical packages, checks PPI-1, and constructs the
CRS-1/TAP-2 subject and project/product/root binding.
[review-record-v2.js](../scripts/ai/cli/review-record-v2.js) validates a closed
v2 envelope, rebuilding its v1 per-target decisions through a gate-free
builder. The principal comes from OS-local account attribution, never env.
It is not authenticated physical-human identity.

[stage4-state.js](../scripts/ai/cli/stage4-state.js) derives package state
from fresh run-root inventory, manifest review ledger, claims, records and
external apply attempt/outcome files. APPLIED, CONSUMED, REJECTED,
QUARANTINED and INCONSISTENT must not be confused with fresh approval.
Later decisions supersede earlier approvals before consumption. Approval
is valid for 24 hours and consumed by one durable apply attempt, regardless
of the result. Ambiguous apply evidence quarantines; it does not permit retry.

[apply.js](../scripts/ai/cli/apply.js) checks the same approving OS principal,
run/project/root/package/product binding and fresh interactive confirmation;
rechecks after interaction; reserves before canonical #23F; then durably
records AppliedChangeSetRecord and QaAgentApplyOutcome. Successful APPLIED
evidence is necessary, not sufficient, to authorize execution.

Canonical mutation remains
[change-set-application.js](../scripts/ai/test-automation/change-set-application.js)
`applyApprovedGeneratedChangeSet` (#23F). It consumes the #23E gate and
independently checks exactly one APPROVE per recomputed target, exact
operation/path/content, canonical package reconstruction and live filesystem
conditions. Execution must not call #23F again to obtain fresh authority.

[stage4-principal.js](../scripts/ai/cli/stage4-principal.js) currently permits
storage eligibility only on Linux with the enumerated ext4/XFS/Btrfs/F2FS
filesystem types and successful directory fsync. Windows is explicitly
unproven/refused; macOS storage eligibility also refuses. These facts do not
certify Linux execution containment. Root binding includes platform,
canonical real path and dev/inode: relocation/copy/restore is not portable
execution authorization. Stage 4's CI/TTY policy is a supported policy
refusal, not authenticated CI-origin detection.

## 3. C1 owner disposition applied

The binding owner decision is
**OD-CONTROLLED-V1-OD-06-C1-RUNNER-CONTAINMENT — APPROVED**. It resolves the
previous OP-06-01 containment question:

- qa-agent / its Node process is **not** the trusted containment authority.
- Linux is **SUPPORTED CANDIDATE**, conditional on proof of the whole
  controller contract. Windows is **REFUSED**; macOS is **DEFERRED**.
- Every attempt needs its own execution-owned Linux cgroup v2 subtree.
  Timeout/cancellation/recovery must act on that tree.
- Direct child kill, PID lists, process groups, descendant enumeration and
  shell kill commands cannot substitute for cgroup-level termination.
- Unproven availability, ownership, containment or recovery means
  **REFUSE BEFORE SPAWN / exit 5**, with no degraded fallback.
- The controller supplies process-tree containment and lifecycle cleanup
  only; no filesystem/network/secret/malicious-code sandbox or workload
  privilege separation.

C1 does not select deployment machinery, prove a runner eligible, authorize
Stage 5, accept execution residuals or enable execute. The old options to
weaken containment or make Node the authority are superseded.

### 3.1 Continuation preflight

| Fact | Verified locally on 2026-10-13 |
|---|---|
| Repository / branch | TarasovArtem/qa-ai-agent / design/controlled-v1-od06-execution |
| Starting HEAD / tree | 76c1ce8bbafe5f0aed36507fbbc924c3a973ebb7 / 9ec6761a4a5c45e29e6975cd0f59b643471f59b4 |
| Direct parent / tree | 126d105841cf404c92752ae54bb616ed710d7f53 / 24f513931ac44e3fb71afb2f750616be75e112ec |
| Starting worktree | Clean |
| Mutation scope | This design document only |
| Local test platform/runtime | Windows / Node v24.21.0; not Linux Node 22 controller-certification evidence |
| Remote state | No fresh fetch or remote certification claimed |

The continuation commit must be a direct child of the STOP commit. C1 is
recorded in that new artifact; no separate owner-decision commit is fabricated.
The original STOP commit/tree remains unchanged.

## 4. Controller delivery feasibility and product boundary

No already-provisioned facility satisfying all fourteen obligations in
section 5 is evidenced by this repository or mission. This is an evidence
limit, not a claim that Linux or existing host facilities cannot implement it.

### 4.1 A — existing host systemd system manager

Technically viable candidate: a protected system manager starts each workload
as a service in its managed cgroup. systemd documents service-owned launches,
transient D-Bus services and a single-writer ownership rule; scopes instead
adopt externally launched processes. Delegation does not itself prove a
protected controller. These facts support investigating a system-manager
service, not launching target code first and attaching it later.
[systemd cgroup APIs](https://systemd.io/CGROUP_DELEGATION/).

The stable D-Bus API includes StartTransientUnit, but unit-state changes
require privilege authorization. API availability proves neither a runner
grant nor confinement of that grant to one attempt. Transient unit identity
does not provide a durable QA attempt ledger.
[systemd D-Bus contract](https://raw.githubusercontent.com/systemd/systemd/main/man/org.freedesktop.systemd1.xml).

RuntimeMaxSec and ExitType=cgroup provide runtime/population-related
mechanisms. The former is unlimited by default and can be extended for
notifying service types. Neither property alone detects the death of an
unrelated qa-agent client. A selected integration needs verified finite
settings and a parent-death/recovery protocol.
[systemd service contract](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.service.xml).

Inference: A may avoid a new QA binary if the existing facility satisfies
the complete contract. It still introduces mandatory system-service/
transient-unit integration, permission policy, supported host versions and
recovery/evidence responsibilities beyond the current npm installation
contract. Even a transient unit with no on-disk unit file is a deployment
prerequisite requiring owner disposition under this mission. A companion
daemon is not proven inevitable.

Same-UID systemd user manager alone is REFUSED where target code can signal,
reconfigure or stop it. A system manager also fails eligibility where the
workload account can use root/sudo, unrestricted unit management or writable
ancestor membership to defeat containment. KillMode=control-group by name
does not certify the exact host's required cgroup-v2 kill/empty/recovery
behavior.

### 4.2 B — separately installed QA companion/controller

Technically viable only as operator-provisioned trusted software outside
qa-agent's lifecycle and outside the target account's ability to kill,
replace or reconfigure it. It requires protected code, independent service
startup/restart, cgroup delegation, scoped IPC, durable journal and recovery.

This adds a binary/service and upgrade/removal contract. Admin provisioning
may be necessary; running the target as root is not a solution. A silent
npm postinstall service installation violates opt-in/removability and this
mission. **Not adopted.**

### 4.3 C — another external service/daemon

An existing administrator-managed broker may be viable if it already
provides the exact versioned local authority, pre-code placement, tree kill
and recovery contract. A remote API alone cannot control a local cgroup;
its trusted host-side agent/manager and ownership still need proof.

No named broker/protocol/provisioning evidence is present. Introducing one
adds an external-service deployment/support contract. **Not adopted.**

### 4.4 D — runner-provided supervisor

A pre-provisioned self-hosted runner may supply the controller independently
of npm. It must own each attempt's cgroup/journal, survive qa-agent/job-client
death, deny workload control over the supervisor and prove the same contract.
Job-level cancellation, an Actions runner process, a runner label or a
whole-job container is insufficient.

This could keep QA controller code out of the package/target repository,
but still introduces a mandatory versioned runner-provisioning/interface
contract. No such provider is evidenced in current workflows.
**Not adopted; potential first runner class only.**

### 4.5 Comparative deployment consequences

All viable labels are technical candidates, not support grants.

| Dimension | A: system manager | B: QA companion | C: external broker | D: runner supervisor |
|---|---|---|---|---|
| Independence | Manager independent; QA client-death link unproven | Independently supervised | Independently supervised | Outside client/job lifecycle |
| Cgroup ownership | Manager-owned units; no competing raw writer | Exclusively delegated subtree | Broker/host agent subtree | Supervisor subtree |
| Provisioning | Host version, units, grants, recovery | Protected code, service, journal | Named provider/host agent/protocol | Operator runner and proof |
| Permissions | Scoped unit authority; broad grants unsafe | Protected owner; scoped IPC | Protected local owner; scoped protocol | Protected controller; scoped client |
| Install impact | Mandatory host integration even if PID 1 exists | Extra artifact/service, possible admin installer | External service dependency | Runner setup outside npm |
| Remove impact | Revoke grants/units after drain; retain audit | Drain/revoke/uninstall | Revoke enrollment and drain | Revoke runner opt-in and drain |
| Portability | Qualified Linux/systemd | Qualified Linux/cgroup v2 | Provider-specific Linux | Qualified runner only |
| Target invasiveness | No test architecture change; host change remains | No test architecture change; host install remains | Provider integration remains | Runner integration remains |
| Opt-in/removable | Explicit administrator + target opt-in | Separate install; no npm side effect | Explicit enrollment/removal | Explicit runner enrollment/removal |
| Distribution | npm alone no longer describes prerequisites; adapter dependencies need review | Companion version/packaging/support | Protocol/support contract | Runner version/support contract |
| Security boundary | Lifecycle only | Lifecycle only | Lifecycle only | Lifecycle only |

Container runtime/OCI-image requirements are separate owner deployment
decisions; none is adopted as a bypass.

### 4.6 Exact next owner decision — OP-06-02

**OWNER PRODUCT/DEPLOYMENT DECISION REQUIRED**.
OP-06-02 is a local question identifier, not an issued owner authorization.

The owner must select and authorize one delivery/provisioning model, or keep
execute deferred, identifying:

1. Whether system-manager services/transient units and their administrative
   grants are permitted, or a named companion/broker/runner contract instead.
2. Who provisions/maintains protected controller code, cgroup ownership,
   supported versions, launch permissions and recovery evidence.
3. Whether product installation explicitly requires separately provisioned
   host/runner infrastructure beyond npm.
4. Who owns updates, revocation, drain/removal and support; which extra
   binary/service/unit/policy/image/package artifacts, if any, are authorized.
5. The intended first runner class. Provisioned self-hosted Linux is a
   candidate, not a support declaration.
6. The workload-account prerequisite: it cannot destroy/reconfigure the
   controller or migrate out of containment. This is not a new workload
   sandbox or a privilege-reduction feature supplied by QA Agent.

Recommendation for owner consideration: first assess A on an operator-
provisioned Linux host, or a named existing D provider, since each may avoid
shipping a QA companion. Neither is selected. Delivery approval alone will
not prove the technical contract.

**STOP before finalizing that model or dependent runtime protocols.**
No unit, IPC endpoint, helper, grant, installer, deployment artifact, container
requirement, package dependency or public API is added.

## 5. Cgroup v2 contract: fixed obligations and missing proof

Linux documents non-root cgroup.kill as a subtree-wide SIGKILL operation
handling concurrent forks/migrations; cgroup.events populated observes live
subtree population. Migration permissions constrain movement. Threaded
cgroups cannot use this kill interface.
[Linux cgroup v2 contract](https://docs.kernel.org/admin-guide/cgroup-v2.html).

Baseline: a dedicated non-threaded/domain execution subtree, with management
owned by the trusted controller and workload migration rights constrained.
Kernel presence or a namespace does not prove QA ownership. These rows are
mandatory acceptance obligations, **not a delivered protocol**. Provider-
specific mechanisms are blocked by OP-06-02 and must be finalized before
implementation, not left to implementer discretion.

| Decision | Fixed obligation | Unfinished provider-specific mechanism |
|---|---|---|
| 1. Creator | Trusted controller creates unique subtree for one attempt | Manager/broker API, naming/reservation |
| 2. Owner | Controller owns management; target cannot escape/replace owner | Protected owner, delegation/migration validation |
| 3. Scoped handle | Client authority bound only to its attempt; no arbitrary command/cgroup grant | Authenticated handle schema, acquisition/revocation/replay protection |
| 4. Placement | Containment before framework/config/import/dependency code; no start-then-move | Service pre-exec or trusted gated launcher acknowledgment |
| 5. Local authentication | Verify protected controller/host/contract identity; no env/name/config trust shortcut | Exact peer/manager/provisioning validation |
| 6. Timeout | Independent finite deadline and whole-tree kill | Deadline handoff, kill implementation/completion acknowledgment |
| 7. Ctrl-C/cancel | Controller kills tree even if client subsequently dies | Authenticated cancellation/escalation |
| 8. qa-agent death | Independent detection; PID reuse/spoofed liveness cannot restore authority | OS-backed death/session/lease and finite bound |
| 9. Orphan recovery | Reconcile owned claims/cgroups before more work; no re-execution | Protected registry/restart scan/unknown-owner handling |
| 10. Population | Authoritative populated=0 with admission/migration closed | Observation/race/timeout protocol |
| 11. Removal | Only exclusively owned empty tree, after durable recovery duties discharged | Drain/journal/removal acknowledgment ordering |
| 12. Cleanup failure | Retain claim/quarantine; no PASS/false timeout success | Durable blocked-owner state/operator recovery |
| 13. Evidence | Controller identity/binding/create/place/start/kill/empty/remove/time/reason facts; no secret handle/value | Protected ledger, retention, refs/fsync ordering |
| 14. Fail-closed states | Unproven ownership/placement/recovery/prior-attempt state refuses | Closed state/transition/reconciliation schema |

Controller resides outside the workload cgroup. Empty observation is invalid
if another launch can enter the tree. A privileged workload or broad grant
that defeats these invariants is ineligible.

A kill request does not prove immediate emptiness. If termination/empty/
removal evidence fails, classify EXECUTION_ERROR / exit 7 and retain
unresolved ownership. An uninterruptible process cannot be called terminated
to obtain exit 8. No controller-independence or parent-death-recovery PASS
is claimed; all unproven rows require no spawn.

## 6. Runner matrix and local/CI decision (D06-01..04)

This matrix concerns execute at this STOP, not other installed commands.

| Runner / OS | Disposition | Reason |
|---|---|---|
| Generic Linux workstation/server | DEFERRED | No guaranteed protected controller, scoped grant or recovery; cgroup/systemd presence insufficient |
| GitHub-hosted Linux | DEFERRED | ubuntu-latest workflow labels prove no versioned per-attempt ownership/death/recovery contract |
| Self-hosted Linux, including described-as-provisioned | DEFERRED | First supportable candidate, but no named authorized model/provisioning certification |
| Containerized Linux | DEFERRED | Namespace/delegation/host ownership/migration/controller survival unproven |
| Linux VM | DEFERRED | VM identity proves none of the controller contract |
| Windows, any runner | REFUSED | C1 disposition; no containment substitution |
| macOS, any runner | DEFERRED | C1 disposition; no substitute authorized |

GitHub documents passwordless sudo for its Linux VMs. This is privilege
availability, not a protected QA controller guarantee. Any concrete account
that can use that authority to defeat the selected controller must REFUSE,
regardless of the class-level DEFERRED status. No privilege restriction is
implemented or presumed.
[GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Repository evidence: [cypress.yml](../.github/workflows/cypress.yml) has
Ubuntu jobs and a Cypress container image but no trusted-controller
provisioning contract. Other workflow declarations supply no such proof.
Existing framework CI success cannot certify controlled execute.

For self-hosted candidates, the operator must provide all section 5 proofs,
exact controller/OS/kernel/runtime/contract versions, an account unable to
defeat containment, eligible durable storage and hostile-descendant/client-
death/restart qualification. Labels/writable paths/config assertions are
insufficient. Container candidates additionally need host-visible cgroup
identity, namespace/delegation/ownership proof across the boundary, with no
accessible migration or privileged controller-control escape.

**D06-03:** No local or CI execute mode is supported at STOP. Generic local
Linux and GitHub-hosted CI remain DEFERRED. Provisioned self-hosted Linux is
only a candidate after OP-06-02. Approval/apply CI/TTY prohibitions stay
unchanged; future execute-only CI cannot authorize Stage 4 CI approval.
Copied apply evidence from another root/host/principal cannot authorize a job.

**D06-04:** Cypress = DEFERRED; Playwright = DEFERRED.
Both require identical controller invariants, with no framework-specific
termination, parent-death, timeout or cancellation waiver.

## 7. Independent constraints closed for resumption

These constraints do not constitute a complete executable specification.

### 7.1 Scope and applied-state binding

Runnable scope is **only exact applied spec targets from the selected Stage 4
package**. Full-suite fallback, arbitrary spec paths/CLI args, npm scripts and
provider-selected commands are refused. Helper/config-only packages without
qualifying applied specs refuse. Broader test authority needs a separate
owner decision.

Required chain:

    canonical run and manifest-verified artifacts
    -> recomputed approved package and independent per-target decisions
    -> bound successful apply outcome + AppliedChangeSetRecord
    -> fresh exact applied filesystem state
    -> separate execute authorization + controller eligibility
    -> final pre-start recheck at controller handoff

Bind run ID, ordinal/artifact SHA-256, canonical package/change-set/plan/
context digests, TAP-2/CRS-1/PPI-1 subject, approving OS account, apply
attempt/record/outcome IDs and exact product identity. Recompute canonical
approved-content digests using existing primitives and live raw-file SHA-256.
Check every applied change, including helpers, not only runnable specs.

Root identity remains platform + canonical realpath + dev/inode as in Stage 4.
Targets bind canonical relative path, operation, PPI-1 identity, no symlink/
hardlink substitution and exact approved bytes. Existing AppliedChangeSetRecord
v1 change entries contain operation/path/beforeDigest/afterDigest/status,
not historical file dev/inode. Resumed design must decide whether fresh
path/content identity suffices within the unchanged R-4 residual or whether
a separately authorized compatible apply-evidence extension is required.
It cannot invent historical file identity from matching bytes or silently
change Stage 4 under OD-06 design authority.

Framework must agree across config/plan/package/applied evidence. Product
and framework/runtime identities must be exact. Stale/inconsistent input,
content/root/framework/product binding refuses before spawn (4); absent
authority, wrong account, quarantine or controller ineligibility refuses (5).

Post-apply changes fail closed; reverting bytes cannot cure identity/
authority ambiguity. The full config/import/dependency fingerprint and
compatibility rule remain unfinalized. Existing repository-context digest
does not prove a transitive executable snapshot. Pre-start checks cannot
freeze bytes against another same-account writer; R-4 remains unchanged.

Existing assertState rejects APPLIED, and selectedRecord depends on an active
approval that APPLIED state does not select. Neither is an unchanged execute
loader. Do not call #23F again to obtain execution authority.

### 7.2 Deterministic executable ownership

Closed alternative to npm .bin: invoke the qualified canonical Node runtime
by absolute path, with a canonical target-local package-owned JS bin as a
literal argv element and **shell=false**. No shebang interpreter lookup,
.cmd/shell shim, global/PATH/npx/npm-script fallback, install or download.

Resolve from the bound root's local dependency tree, not ancestor/global
require.resolve search. Parse bounded metadata without loading target code;
verify exact name/version/bin mapping and package/entrypoint canonical
ownership. Reject symlinked/redirected/out-of-root package or entrypoint
layouts. Links/workspaces/hoisting that fail this baseline refuse. Recheck
identity/content before start. Path ownership is not code authenticity.

Read-only local package evidence:

| Framework | Initial invocation candidate | Further actual executable boundary |
|---|---|---|
| Cypress 15.21.1 | Absolute Node + root/node_modules/cypress/bin/cypress; bin metadata matches; script loads ../dist/cli | Separate native Cypress app; JS entrypoint proof is insufficient |
| @playwright/test 1.63.0 | Absolute Node + root/node_modules/@playwright/test/cli.js; bin metadata matches; loads playwright/lib/program | Matching local playwright/playwright-core and actual native browser payload |

Versions are inspection facts, not an approved support range. The Windows
dependency tree is not Linux execution qualification.

Cypress documents a separate native download, normally in a cache outside
node_modules, with CYPRESS_RUN_BINARY as a runtime override. Default shared/
user-cache discovery cannot satisfy the closed resolver. Resumed design must
fix a canonical target-owned payload/version/digest/provisioning rule and a
product-generated override, or refuse Cypress. No native path is guessed.
[Cypress installation contract](https://docs.cypress.io/app/references/advanced-installation).

Playwright supports local browser payloads in
node_modules/playwright-core/.local-browsers using PLAYWRIGHT_BROWSERS_PATH=0.
This is a candidate ownership model, not proof of what arbitrary target
config launches. A qualified adapter must reject unsupported native/channel/
path overrides. [Playwright browser contract](https://playwright.dev/docs/browsers).

Native resolution, supported versions, closed argv and result adapters remain
BLOCKED design work. No target config is evaluated to discover executables
during preflight. Once authorized, config/dependencies remain untrusted
host-account code and can spawn other code within lifecycle containment.

### 7.3 Replay and concurrency

Baseline: **one durable execution reservation per successful applied package**.
Reservation consumes the attempt even without confirmed spawn. Replay after
PASSED, TEST_FAILED, TIMED_OUT, EXECUTION_ERROR or ORPHANED refuses (5).
A new separately approved/applied package is required; a fresh execution ID
alone grants nothing. No reset/delete-evidence retry is authorized.
Lost controller reservation history fails closed.

Require exclusive same-run/package authority and conservatively serialize
all execution in one canonical root, covering shared targets/config/reports.
Controller/cgroup ownership is exclusive per attempt. Distinct roots can
proceed only with disjoint authoritative claims. Unknown ownership refuses;
no stale-PID lock stealing. Persistence/reconciliation mechanism remains
delivery-dependent design work.

### 7.4 Environment

Construct a positive projection for the actual controller-launched workload,
never wholesale process.env copying. Persist no values or secret handles.

| Keys/class | Required policy |
|---|---|
| AI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, all product/provider credential aliases | STRIPPED; cannot be relabeled as SUT pass-through |
| GITHUB_TOKEN, GH_TOKEN and GitHub credential aliases | STRIPPED |
| NPM_TOKEN, NODE_AUTH_TOKEN, npm auth/config/package variable families | STRIPPED |
| PATH | No ambient inheritance; initial executable absolute; framework tool paths fixed by qualified provisioning/adapter |
| HOME | No ambient inheritance; exact execution-home/cache value must be fixed with controller/native provisioning |
| CI / GITHUB_ACTIONS | Product-derived supported-mode values only; no provenance authority |
| NODE_OPTIONS / NODE_PATH / loader-preload variables | STRIPPED; no target pass-through control of runtime loaders |
| Framework cache/binary/browser/reporter/config selectors | Qualified product-generated values only; no wildcard CYPRESS_* / PLAYWRIGHT_* copy |
| Target SUT credentials | Explicit bounded target-owned name allowlist; no wildcard or reserved control/provider names; runtime values not persisted |

Exact configuration grammar/HOME/tool paths remain resumption design work;
no schema expansion is adopted. Environment stripping is not generic secret
safety: target code can read account-accessible files, network and deliberately
passed SUT credentials. An empty/new HOME does not isolate the filesystem.

### 7.5 Timeout, output and result constraints

Proposed finite values for resumed assessment, not activated defaults:

- Deadline 600000 ms default, integer configuration 1000..600000 ms; enforced
  independently from authorized launch, never extended by target code.
  Bind/start acknowledgment and kill/empty budgets: 30000 ms each.
  Parent-death detection bound requires the selected trusted protocol.
- stdout/stderr retained caps: 200000 bytes each, checked before chunk copy;
  drain/discard excess with counters/truncation facts. No unbounded buffer or
  dependency on pipe EOF to finish.
- Imported framework-result evidence: at most 8 regular files, 1048576 bytes
  each, 8388608 total. No symlink, arbitrary path or recursive import;
  enforce before parse.
- Total product-managed persisted evidence: 16777216 bytes per attempt,
  including controller audit/final record/imported results. Provider audit
  quota/retention compatibility must be proven before support.
- Raw output, exception text, labels and framework artifacts may contain
  secrets. Byte caps do not authorize persistence. Final result adapter must
  persist approved bounded structural facts, not raw secret-bearing data.

These bounds do not constrain arbitrary target disk writes, memory, fork
volume or network use. Resource isolation/quota is not silently added.

TIMED_OUT / 8 requires applied controller termination semantics and confirmed
empty subtree. Failed cleanup/lost controller/spawn failure/abnormal signal/
invalid or missing result/cancellation is EXECUTION_ERROR / 7. A nonzero
framework code alone is insufficient for TEST_FAILED. PASSED requires
confirmed execution, qualified success evidence and completed cleanup;
TEST_FAILED requires a qualified actual test-failure result. Exact framework
adapters remain unfinalized.

| Result/category | Exit |
|---|---:|
| PASSED | 0 |
| TEST_FAILED | 10 |
| TIMED_OUT after confirmed tree termination | 8 |
| EXECUTION_ERROR / post-authorized infrastructure-controller failure | 7 |
| Authority / pre-spawn controller eligibility failure | 5 |
| Input/binding | 4 |
| Config | 3 |
| Usage | 2 |
| Internal | 1 |

Existing provider-failure exit 6 outside execution is unchanged. Reserved
execute still returns 5.

## 8. Durable attempt/record contract blocked explicitly

Final durable state schema is not adopted before OP-06-02.
PREPARED -> CONTROLLER_BOUND -> STARTED -> COMPLETED, with ORPHANED for
unresolved ownership/outcome, is an assessment sequence, not a finalized
serialized state machine. PREPARED reservation is non-reusable. Leader PID/
exit cannot substitute for durable controller authority; unknown/error cannot
be upgraded to PASS.

| Crash/recovery point | Mandatory behavior | Exact unfinished protocol |
|---|---|---|
| Durable attempt written | Consumed, no new reservation from missing later evidence | Client/controller reservation authority and fsync order |
| Cgroup created | Recover exact owned tree, no anonymous launch/delete | Protected create acknowledgment/registry |
| Process placed | No target code before durable bound authority; no restart | Gated placement/start handoff |
| qa-agent crashes before spawn result | May have run; ORPHANED/unknown, reconcile/terminate, no retry/PASS | Independent death detection/idempotent start |
| qa-agent crashes after spawn | Controller enforces deadline and termination/recovery | Death/cancel/lease ordering |
| Process exits before outcome persistence | Leader exit insufficient; no reconstructed PASS from code 0 | Protected result/exit facts and durable terminal acknowledgment |
| Controller remains populated | Retain claim, tree kill, block affected root/package | Finite kill/empty failure and operator recovery |
| Empty tree, incomplete record | Empty means no live workload, not success; consumed/unknown | Durable error/unknown finalization/removal ordering |

Durability failure before authorized launch means no spawn. Failure after
authorized execution means 7 for a surviving caller plus unresolved-owner
quarantine. Client death cannot promise an exit code/synchronous fsync.
Reboot stops running processes but supplies no lost outcome; missing cgroup
is not proof of prior PASS.

The eventual closed AutomationExecutionRecord must bind execution ID,
Stage 4 run/package/apply IDs/digests, every target path/content identity,
root/account/project, framework package/native/runtime identity, runner/OS,
controller identity/contract version, product identity, reservation/start/
end/cleanup timing, outcome, exit/signal/timeout/cancel reason, evidence
refs/digests and controller action facts. No env values, SUT credentials,
authority handle, free-form command text or raw secret-bearing output.
Hashes prove integrity, not human/controller authenticity.

This field inventory is not a closed schema. Exact key sets, version/types/
bounds/nullability/cross-field rules, transitions, storage grammar and
authenticated controller facts must be finalized together after OP-06-02.
Legacy AutomationExecutionRecord v1 cannot supply them silently.
Stage 4 rejects unknown execute directories; no storage/schema migration is
adopted here.

## 9. TSB-F02: current and prospective consumers distinguished

Fresh current graph from actual callsites and package inventory:

    installed qa-agent -> cli.run
      -> review record -> gate-free v2 builder/validator -> review evidence
      -> apply -> Stage 4 reservation -> canonical #23F
           -> validateApprovedGeneratedChangeSetReview
           -> independent verifyApprovedChangeBinding
           -> canonical/live checks -> application
      -> execute -> reserved exit 5 (no execution/gate load)
    validateApprovedTestDesignReview -> no supported production caller
    legacy #23G -> excluded from installed package

**CURRENT SUPPORTED SURFACE TSB-F02 TRIGGER = FALSE**.
Finding remains **OPEN / LOW / CONDITIONAL**; no closure/re-rating.

Prospective graph is incomplete:

    proposed execute
      -> canonical artifact/package rebuild
      -> consumed approval + successful apply + live applied-state verifier
           [new read-only authority consumer/import closure NOT finalized]
      -> reservation/protected controller claim
      -> qualified framework/native launch
      -> result adapter/durable execution evidence

**PROPOSED EXECUTE TSB-F02 TRIGGER = INDETERMINATE — STOP**.

Exact dependency: new applied-authorization consumer and transitive imports/
calls are not specified/proven against DC-F02-1..5. Current gate-free Stage 4
validators are not a completed APPLIED execute path. verifyApprovedChangeBinding
is private inside #23F, not an exported read-only execute validator. Calling
#23F to reach it would apply changes; directly importing either weak gate
violates DC-F02-1. Stored APPROVED/APPLIED without independent decision/
content revalidation cannot certify execution authority.

| DC-F02 constraint | Current | Proposed at STOP |
|---|---|---|
| 1. Gate only through #23F | Holds | Consumer/import closure unproven |
| 2. No gate/stored-status approval verdict | Holds | Fresh per-decision authority consumer unproven |
| 3. Test-design gate absent | Holds | Required absent; future closure incomplete |
| 4. No affected-gate public export | Holds | Unchanged; future expansion requires STOP |
| 5. Apply retains #23F independent binding | Holds | Must stay unchanged; execute cannot reapply for authority |

A fully specified gate-free read-only verifier may yield FALSE on resumption.
That verdict cannot be inherited from today's disabled route or granted by
controller selection. No gate remediation/refactor/extraction/weakening is
authorized. INDETERMINATE is a second design STOP, not a severity change or
a claim TRUE.

## 10. D06 completeness and security preservation

FIXED denotes independent proposed constraints. BLOCKED means resumed design
must finalize the decision, never that an implementer may choose it.

| ID | Continuation disposition |
|---|---|
| D06-01 | Closed STOP runner matrix; none SUPPORTED |
| D06-02 | C1 applied: Linux SUPPORTED CANDIDATE; Windows REFUSED; macOS DEFERRED |
| D06-03 | No supported local/CI mode; Stage 4 prohibitions unchanged |
| D06-04 | Both frameworks DEFERRED under identical invariants |
| D06-05 | FIXED no .bin/PATH/global/shell fallback; JS entrypoints evidenced; native ownership/version/provisioning BLOCKED |
| D06-06 | FIXED absolute Node/local JS/closed product argv/root cwd/shell false; exact adapters BLOCKED |
| D06-07 | FIXED exact applied specs only; no arbitrary args/path/suite |
| D06-08 | FIXED fresh full chain; APPLIED verifier/fingerprint/compatibility BLOCKED; section 9 |
| D06-09 | FIXED one consumed reservation; no retry after any outcome |
| D06-10 | FIXED root serialization/package/cgroup exclusivity; durable claims/locks BLOCKED |
| D06-11 | FIXED positive projection/stripped credentials/explicit SUT opt-in; grammar/HOME/tool values BLOCKED |
| D06-12 | FIXED bound canonical root/account; no copy/relocation authority |
| D06-13 | Proposed numeric budgets section 7.5; independent enforcement BLOCKED |
| D06-14 | C1 cgroup-only termination; exact controller kill/empty protocol BLOCKED |
| D06-15 | FIXED whole-tree cancel/exit 7; exact death/signal protocol BLOCKED |
| D06-16 | Proposed output/artifact/evidence caps; provider quota/result adapter BLOCKED |
| D06-17 | FIXED no generic secret claim/raw persistence by size alone |
| D06-18 | Required record bindings; closed schema/version BLOCKED |
| D06-19 | Four outcomes preserved; orphan is authority/recovery state, never PASS |
| D06-20 | Exits preserved; controller refusal 5, post-authorized infrastructure 7, confirmed timeout 8 |
| D06-21 | Eight crash cases explicit; exact durable transitions/recovery BLOCKED |
| D06-22 | Existing inventory/storage preserved; execute layout integration BLOCKED |
| D06-23 | Qualified structural adapters required; no code-zero/text-only/unknown PASS; exact result schema BLOCKED |
| D06-24 | No boolean controller trust shortcut; future narrow config schema BLOCKED |
| D06-25 | Public API/bin/exports UNCHANGED |
| D06-26 | OWNER PRODUCT/DEPLOYMENT DECISION REQUIRED |
| D06-27 | Current FALSE; proposed INDETERMINATE / STOP |
| D06-28 | TAP-2/CRS-1/PPI-1 preserved, no guard closure |
| D06-29 | R-1..R-5/AT-07/TB-01 unchanged; impact below |
| D06-30 | Execute residuals unaccepted for OD-06; no sandbox claim |

R-1..R-5 stay ACCEPTED for their existing OD-04 scope only; AT-07/TB-01 remain
RESIDUAL. TAP-2/CRS-1/PPI-1 and every FUTURE guard are preserved. No finding
is closed, re-rated or waived.

| Residual | Prospective execute impact |
|---|---|
| R-1 | Same-principal automation possible; TTY/liveness is not human proof |
| R-2 | Account attribution is not human identity or runner provenance |
| R-3 | Account evidence can be forged/deleted; hashes cannot replace protected ownership/history |
| R-4 | Pre-start/open TOCTOU and config/dependency drift persist |
| R-5 | Harmful approved code runs with runner-account permissions |
| AT-07/TB-01 | Forged apply/approval evidence may reach execute; APPLIED serialization insufficient |

Host/network/SUT-secret/dependency/output/audit/resource exposures remain
UNACCEPTED / REQUIRES OD-06 DISPOSITION. FUTURE reviewer identity, human
provenance, presentation binding, framework provenance, classifier coverage
and Windows execution guards remain OPEN.

**Controlled-v1 execute is NOT a sandbox.** Contained test processes can read/
write according to account permissions, access network, read intentionally
passed SUT credentials and execute target-owned dependency/config code.
They retain the runner account's authority unless another explicitly approved
boundary constrains it. Controller protection is a lifecycle trust
prerequisite, not a workload privilege-separation product claim.

## 11. Verification and resumption gates

This continuation changes documentation only. No provisioning/framework
execution/source/test/workflow/config/package/public-surface change or new
test. Existing static DC-F02/package-surface checks can verify the unchanged
supported graph, not Linux controllers/future execute. Local Node 24 results
must not be called supported Linux Node 22 CI.

Continuation validation: the existing DC-F02 static-graph and CLI package-
surface suites passed together: 35 tests, 35 pass, 0 fail/skip. Command:

    node --test test/security/controlled-v1/dc-f02-static-graph.test.js test/installation/controlled-v1-cli-package.test.js

These checks include real npm pack dry-run inventory, graph non-vacuity/drift
probes, public exports/bin/closure, and reserved execute/release-gate evidence.
They install nothing and launch no Cypress/Playwright workload. The result
supports only the unchanged current surface, not proposed execute PASS.

PASS requires resumed design to supply:

1. OP-06-02 owner delivery authorization and exact provider evidence.
2. All fourteen controller decisions finalized, including independent
   parent-death/timeout and protected orphan recovery.
3. Exact runner/native/argv/fingerprint/environment/lock/state/storage/
   record/result contracts and bounded evidence; no implementer discretion.
4. Completed proposed graph with explicit DC-F02 verdict. TRUE/INDETERMINATE
   still means STOP; no remediation is preauthorized.
5. Future mandatory adversarial validation matrix for escaping/forking
   descendants, client SIGKILL, controller restart/death, incomplete durable
   handoffs, native substitution, exact-spec selection, stale binding,
   secret environment projection, output/report/disk overflow, replay and
   concurrency. Cooperative framework fixtures alone cannot certify it.
6. Exact private npm inventory, unchanged API/bin, external installed-
   consumer proof and no source-checkout dependency.

No future qualification is claimed passing. Stage 5, activation, reviews,
merge and release are not authorized by this artifact.

## 12. Handoff / final-report additions

    MISSION RESULT:
    STOP — OWNER PRODUCT/DEPLOYMENT DECISION REQUIRED

    C1 OWNER DECISION:
    APPLIED

    STOP COMMIT PRESERVED:
    YES — 76c1ce8bbafe5f0aed36507fbbc924c3a973ebb7

    TRUSTED CONTROLLER MODEL:
    OWNER DECISION REQUIRED — OP-06-02 (A/B/C/D not adopted)

    CGROUP V2 CONTRACT:
    Dedicated execution-owned domain subtree; trusted owner; pre-code
    placement; cgroup-level tree kill; empty proof; protected recovery.
    Delivery-specific protocol not finalized.

    CONTROLLER LIFECYCLE INDEPENDENCE:
    UNRESOLVED

    PARENT-DEATH RECOVERY:
    Independent detection/termination/durable reconciliation mandatory;
    no provisioned provider/protocol proven.

    WHOLE-TREE TERMINATION:
    cgroup v2 required; no PID/group/shell fallback; exit 8 only after
    confirmed tree termination; cleanup failure = 7 + owner quarantine.

    RUNNER ELIGIBILITY:
    Generic Linux = DEFERRED
    GitHub-hosted Linux = DEFERRED
    Self-hosted Linux = DEFERRED (unverified provisioned candidates too)
    Containerized Linux = DEFERRED
    Linux VM = DEFERRED
    Windows = REFUSED
    macOS = DEFERRED

    DEPLOYMENT MODEL IMPACT:
    OWNER DECISION REQUIRED

    CURRENT SUPPORTED SURFACE TSB-F02 TRIGGER:
    FALSE

    PROPOSED EXECUTE TSB-F02 TRIGGER:
    INDETERMINATE — applied-authorization consumer/import closure unproven.

    IMPLEMENTATION / EXECUTE ACTIVATION:
    NOT AUTHORIZED / NOT PERFORMED

    PUSH / PR / EXACT-HEAD CI:
    NOT PERFORMED — local next-STOP artifact only

    INDEPENDENT REVIEWS / MERGE:
    NOT STARTED / NOT PERFORMED

This is an internally complete owner-disposition STOP record, not a complete
OD-06 execution contract. Report new local HEAD/tree in the delivery response
rather than a self-referential hash here. No push/PR is performed at this STOP.

On later PASS only: push branch, open PR against main, obtain exact-head CI,
then stop before review. Required sequence: **HEAVY Architecture / Software
Engineering exact-head review -> if APPROVED, HEAVY Security on the same
HEAD -> if APPROVED, Product Owner OD-06 disposition**. No merge authorized.
