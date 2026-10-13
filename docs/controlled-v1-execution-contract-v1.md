# Controlled-v1 OD-06 execution contract v1 — systemd authority STOP

Date: 2026-10-13 (Europe/Berlin).

Design authority: `OD-CONTROLLED-V1-OD-06-EXECUTION-DESIGN — APPROVED`.
Continuation authority: `OD-CONTROLLED-V1-OD-06-C1-RUNNER-CONTAINMENT — APPROVED`.
Controller authority: `OD-CONTROLLED-V1-OD-06-OP-06-02-SYSTEMD-CONTROLLER — APPROVED`.

Mission result: **STOP — OWNER SECURITY/DEPLOYMENT DECISION REQUIRED**.

OP-06-02 is **APPLIED**. The selected controller is the host-provided systemd
system service manager, using one transient `.service` per attempt on a
provisioned self-hosted Linux runner with cgroup v2. Selection is not reopened.
The new blocker is management authority: standard transient-unit authorization
does not enforce the closed service properties. Section 4 records the evidence.
Sections 1–2 preserve historical discovery; sections 3–13 govern this continuation.

This remains **DESIGN ONLY**, an internally complete STOP record, not a complete
implementable execution contract or runner certification. Independent design
constraints and the proposed TSB-F02 consumer graph are resolved below;
authority-dependent qualification/protocols remain explicitly blocked.
No unsafe grant, helper, daemon or broader privilege is adopted.

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

## 3. Applied decisions and continuation preflight

| Fact | Verified locally on 2026-10-13 |
|---|---|
| Repository / branch | TarasovArtem/qa-ai-agent / design/controlled-v1-od06-execution |
| Starting HEAD / tree | 0cc24cfb8cf77200eccc8d556822f1349a805eda / af6713a2190883741366162a1917d6ac5229f1d1 |
| Preserved first STOP | 76c1ce8bbafe5f0aed36507fbbc924c3a973ebb7 |
| Certified base | 126d105841cf404c92752ae54bb616ed710d7f53 |
| Starting worktree | Clean; supplied checkpoint matches |
| Exact changed-file allowlist | docs/controlled-v1-execution-contract-v1.md only |
| Host | Windows; not eligible Linux controller evidence |
| Remote state | No fresh fetch or remote certification claimed |
| Commit policy | One new direct child of starting HEAD; no amend/squash/rebase/discard |

Binding controller/runner disposition:

| Runner | Disposition |
|---|---|
| Provisioned self-hosted Linux | Initial execute candidate; eligible only after every mandatory check succeeds |
| Windows | REFUSED |
| macOS | DEFERRED |
| Generic Linux workstation/server | DEFERRED |
| GitHub-hosted Linux | DEFERRED |
| Containerized Linux | DEFERRED |
| Generic Linux VM | DEFERRED |

A provisioned self-hosted runner may physically be a VM; a generic VM is not
eligible merely because it runs Linux. Labels/config booleans are not proof.
Execute-only CI cannot weaken Stage 4 TTY/CI approval/apply prohibitions or
permit copied-root authorization.

Existing [Cypress workflow](../.github/workflows/cypress.yml) Ubuntu/container
jobs do not certify this controller or scoped grant. No workflow is changed.

The security claim is exactly:

> systemd/cgroup provides only: `process lifecycle / full process-tree containment`

It is NOT:

- filesystem sandbox;
- network sandbox;
- secret isolation;
- malicious-code sandbox;
- privilege-separation guarantee.

Immediate client-death termination is **NOT claimed**. The manager owns a
started service independently of qa-agent; finite runtime enforcement and
later durable reconciliation replace the former immediate parent-death
detection obligation. No independent QA Agent daemon is implied.

## 4. Privilege feasibility — the new mandatory STOP

### 4.1 Primary evidence

Evidence inspected on 2026-10-13: immutable systemd v256 tag and upstream
commit `195a17c59b22f5b0fa626fdb4917107cdc281bac`. These are evidence samples,
not a certified support range or a claim about every downstream patch.

| Evidence | What it establishes |
|---|---|
| [v256 transient-unit handler](https://raw.githubusercontent.com/systemd/systemd/v256/src/core/dbus-manager.c) | method_start_transient_unit authorizes manage-units before processing caller properties and auxiliary units; this version does not pass a unit name to that authorization call |
| [Pinned upstream manager](https://raw.githubusercontent.com/systemd/systemd/195a17c59b22f5b0fa626fdb4917107cdc281bac/src/core/dbus-manager.c) | The newer handler passes the requested main unit name and start verb, then applies the property array and processes auxiliary units |
| [Pinned upstream authorization](https://raw.githubusercontent.com/systemd/systemd/195a17c59b22f5b0fa626fdb4917107cdc281bac/src/core/dbus-util.c) | manage-units polkit details contain unit/verb and presentation metadata, not executable, user, timeout, kill mode, dependencies, auxiliary names or applied-package identity |
| [v256 execution contract](https://raw.githubusercontent.com/systemd/systemd/v256/man/systemd.exec.xml) | System services default to root unless another User is selected; an ordinary user manager cannot switch to a different workload user |

**Inference:** permitting a non-root account to create a name-matching system
transient service does not enforce a safe QA request. A caller can use D-Bus
directly, retain the allowed name, and change/omit User, substitute ExecStart,
omit the finite runtime, alter containment/dependencies or supply auxiliary
units. The npm client's positive property builder cannot constrain other code
running with that granted OS authority. The name proves neither workload
ownership nor approved-content execution.

A dedicated slice/root-owned namespace drop-in supplies defaults, not an
established immutable request allowlist. No verified stock policy in the
inspected evidence enforces the whole request. A separately approved, proven
host enforcement policy is not claimed impossible.

### 4.2 Alternatives and dispositions

| Authority model | Disposition / reason |
|---|---|
| Unrestricted root qa-agent | REFUSED; explicit mission STOP condition |
| Broad systemctl / manage-units grant | REFUSED; system administration and arbitrary transient properties |
| Prefix/exact-name plus start/stop polkit rule | REFUSED for creation; no property/auxiliary validation; exact names alone do not fix this |
| User manager under workload UID | REFUSED; workload can reconfigure manager/services |
| Separate unprivileged user manager | Cannot launch a different workload UID; using its own UID restores workload control |
| sudo systemd-run with arbitrary args/property wildcards | REFUSED; executable/property authority remains broader than contract |
| Restricted sudo with exact immutable requests | No complete safe dynamic-target/attempt protocol proven; no wildcard policy invented |
| Privileged request-validating helper or custom broker/daemon | OWNER SECURITY/DEPLOYMENT DECISION REQUIRED; outside authorized deployment |
| Custom MAC/patched manager enforcement | OWNER SECURITY/DEPLOYMENT DECISION REQUIRED for a named policy and qualification; not assumed present |

**OP-06-03 — MANAGEMENT AUTHORITY: OWNER SECURITY/DEPLOYMENT DECISION
REQUIRED.** This names the new question, not an approved decision.

The owner must select/authorize concrete enforcement of every transient request
field before target code, controller protection, scoped cancellation/recovery,
no uncontrolled auxiliary units and no arbitrary property updates. Any broader
authority/deployment requirement needs explicit disposition. No root/broad
admin acceptance, helper or daemon is adopted. OP-06-02 remains APPLIED;
systemd remains SELECTED.

**STOP at this boundary.** The expected no-helper/no-daemon deployment cannot
currently be established with the evidenced authority path. No grant/install
recipe or runner certification is delivered. Sections below fix independent
constraints and identify unfinished work, without treating unproven authority
as a completed implementation contract.

## 5. Eligibility and operator provisioning obligations

Every check is mandatory before framework/config/dependency code. Inspect
data/controller facts; never execute a target preflight script. Missing proof
means failure, never degraded mode.

| Check | Required evidence / refusal condition |
|---|---|
| OS / class | Linux, operator-qualified provisioned self-hosted runner; other matrix classes refuse |
| systemd baseline | Exact host build qualified for all required properties/APIs; version list BLOCKED by section 4, not guessed as >=256 |
| cgroup v2 | Active unified hierarchy, protected domain/non-threaded subtree, subtree kill/population observation; no writable migration/delegation escape |
| Reachable manager | Protected host system manager on authenticated local system bus; exact manager/boot identity; no user-manager or caller endpoint fallback |
| Transient creation | Supported service creation/property types; no scope/start-then-attach; no probe launching target code |
| Scoped authority | Enforced restrictions; no root/sudo/broad management/migration rights defeating containment; BLOCKED, section 4 |
| Namespace | Product grammar usable; no active/stale conflicts, aliases, overrides or unbound units |
| Recovery | Authorized stop/kill/read/reconcile/drain and complete durable attempts; no lost claim history |
| Storage / account | Stage 4 canonical storage/directory fsync, bound principal, durable evidence ownership; privileged workload refuses |
| Root / apply | Canonical project/root/product/run/package and exact applied bytes, section 8 |
| Framework | Target-local qualified dependency/entrypoint/runtime/native payload; no install/download/PATH fallback |
| Environment / evidence | Positive projection and finite capture/import/persistence; no secret-value persistence |

Any mandatory eligibility failure: **execute → authority refusal / exit 5
before spawn**. Malformed config remains 3; input/content mismatch remains 4.
Durability failure before start forbids start. Failure after a possibly
accepted start request is execution/controller failure 7 plus reconciliation,
not a harmless pre-spawn refusal.

Runner operator provisions outside the target repository/npm installation:

1. Qualified Linux/systemd/cgroup-v2 host, Node 22, protected manager/bus,
   durable filesystem and local framework/native dependencies; exact versions.
2. Non-root runner account without containment-defeating rights, protected
   host configuration and qualified tool/cache paths. New account separation
   required by an enforcement model needs OP-06-03 disposition.
3. Only owner-approved scoped management/recovery authority. No safe policy
   recipe is adopted. Optional slice is organization, not an authority
   boundary; its necessity belongs to the chosen enforcement model.
4. Closed QA unit namespace and durable claims/attempt storage; qualification
   of crash/restart/reboot/orphan and failed cleanup.
5. Conceptual install/enable: operator installs prerequisites/policy,
   qualifies/enrolls host, then target operator opts in. npm installation or
   execute=true cannot activate the separately gated release capability.
   qa-agent performs no automatic system provisioning/postinstall.
6. Removal/revocation: block new starts, drain owned attempts, prove empty,
   reconcile outcomes, retain consumed/quarantine history, revoke grants,
   then remove optional host artifacts. Failed drain retains quarantine.

No target test architecture change, new QA Agent service/helper, Docker, OCI
or Kubernetes requirement is adopted.

## 6. Service, identity and finite lifecycle constraints

### 6.1 Required semantics versus adapter details

Required semantics, conditional on viable section 4 authority:

- One transient `.service`, never `.scope`, contains target code before its
  first instruction. Manager remains outside the tree.
- One exact absolute executable/literal argv, canonical root cwd, explicit
  non-root workload identity, closed projected environment, disabled stdin.
- `KillMode=control-group`, `SendSIGKILL=yes`, finite runtime/start/stop
  bounds; restart disabled; no delegation/migration escape/property update.
- No shell, npm script, provider commands, arbitrary caller properties,
  auxiliary units or target ExecStartPre/Post/ExecStop hooks.
- Read back actual identity/properties before treating start as bound;
  acknowledgment is not evidence of framework success.

Candidate mapping: Type=exec, ExitType=cgroup, Restart=no, Delegate=no,
KillSignal=SIGTERM, FinalKillSignal=SIGKILL, RuntimeMaxSec=T/1000,
RuntimeRandomizedExtraSec=0, TimeoutStartSec=30, TimeoutStopSec=30,
SendSIGKILL=yes. No notify type or deadline extension. D-Bus property
names/types, complete manager-default environment suppression, enforceable
properties and exact stop/kill/empty interface are BLOCKED by section 4.
These settings do not certify that a host uses subtree cgroup.kill.

### 6.2 Unit identity

executionId: 32 lowercase hex digits from 128 bits of OS randomness, never
caller/provider text. Name: `qa-agent-exec-v1-<executionId>.service`, exactly
`^qa-agent-exec-v1-[0-9a-f]{32}\.service$`, with whole-string matching.
Run/package/project/principal live in durable attempt data, not name text.
Bind manager boot ID and unit invocation ID when available; a recreated
name is not the original unit.

Durably reserve ID/run/package/root before start. Start mode cannot replace
existing units. Collision fails and consumes the reserved attempt: do not
kill the unknown unit or choose another ID to bypass consumption. IDs/names
are never reused after cleanup/reboot. Missing units never revive authority.
Lookup: durable ID -> exact name -> manager boot/invocation binding; scan
closed namespace for unbound units. Unknown ownership quarantines the runner
until operator resolution; no wildcard kill. Protected reservation/history
enforcement remains BLOCKED.

### 6.3 Timeout and termination

Fixed proposed numeric contract, not activated defaults: integer T,
1000..600000 ms inclusive; default 600000 ms. Future closed target execute
configuration selects T; no provider/arbitrary CLI override. No zero,
infinity, negative, float or extension. These retain the earlier proposed
budget; no additional numeric owner choice is required for this artifact.

Controller runtime bound starts at service active runtime. Independent
30000 ms start and 30000 ms stop budgets bound setup/grace. Adapter binds
monotonic timeline. Surviving client observes through start + T + stop +
30000 ms confirmation, at most T+90000 ms from request, never resetting on
output/polls. Observation expiry alone is EXECUTION_ERROR / 7, not timeout 8.
Client death does not change the installed deadline. Manager restart/reboot
and deadline enforcement still require host qualification.

Cancellation/recovery/timeout closes admission, sends control-group SIGTERM,
escalates to full-tree SIGKILL within stop budget, then confirms empty within
30000 ms. Successful proof requires manager terminal/non-running state, no
pending start/restart job, and authoritative cgroup-v2 `populated=0` for the
bound subtree with admission/migration closed. Missing/inaccessible subtree
needs manager-backed removal/boot proof, not an ENOENT assumption.

Stop request success, leader exit or PID enumeration are not empty proof.
No competing raw cgroup writer is introduced. Exact authorized manager
subtree-kill/population/removal operations remain BLOCKED; no shell/PID/group
substitute. Uninterruptible tasks may outlast SIGKILL: finite escalation/
confirmation is claimed, not guaranteed physical extinction in finite time.
Failure retains claims and QUARANTINED / 7 for operator recovery.

TIMED_OUT / 8 needs durable manager timeout facts for the exact invocation,
confirmed whole-tree termination and completed durable cleanup. Local
observation expiry, signal exit or absent evidence cannot supply exit 8.

## 7. Bounded orphan state and reconciliation

Smallest justified proposed durable state set:

| State | Role / allowed successor |
|---|---|
| PREPARED | Nonterminal consumed reservation; CONTROLLER_BOUND, ORPHANED, EXECUTION_ERROR or QUARANTINED |
| CONTROLLER_BOUND | Nonterminal exact unit/submission binding, not framework-start proof; STARTED, ORPHANED, EXECUTION_ERROR or QUARANTINED |
| STARTED | Nonterminal confirmed framework launch; PASSED, TEST_FAILED, TIMED_OUT, EXECUTION_ERROR, ORPHANED or QUARANTINED |
| ORPHANED | Nonterminal unresolved ownership/outcome, no start; EXECUTION_ERROR, fully proved TIMED_OUT or QUARANTINED |
| PASSED / TEST_FAILED / TIMED_OUT / EXECUTION_ERROR | Terminal consumed outcomes after durable cleanup; no retry or outcome rewrite |
| QUARANTINED | Terminal attempt with retained recovery claim; operator may clear separate root/runner quarantine after proof, never revive this attempt |

No COMPLETED state: completion without evidence/cleanup is not an outcome.
Inconsistency discovered after terminal commit creates a separate quarantine
incident, never overwrites evidence with PASS. Atomic fsynced state writes
are required; ambiguous writes remain unresolved even if parseable. Closed
journal/schema/protected claim protocol remain BLOCKED by section 4.

Dead clients return no exit. Reconciler marks incomplete attempts ORPHANED
and checks exact manager identity. Never reconstruct incomplete PASS or
TEST_FAILED from an exit/report. Only a previously durably committed, fully
validated terminal record may be returned as its recorded result.

| Case | Finalization | Retry / quarantine | Synchronous exit / cleanup |
|---|---|---|---|
| A: incomplete + ACTIVE (including activating/deactivating jobs) | ORPHANED pending stop; EXECUTION_ERROR after empty/cleanup, or fully proven TIMED_OUT | NO retry; retain root claim; QUARANTINED if identity/stop/cleanup unproven | 7 or qualified 8; stop/kill/empty and durable finalization |
| B: incomplete + FAILED | EXECUTION_ERROR, or TIMED_OUT only with invocation deadline and empty/cleanup proof | NO retry; quarantine unproven ownership/population/cleanup | 7/qualified 8; FAILED alone is not empty proof; drain/finalize |
| C: incomplete + INACTIVE | EXECUTION_ERROR for unknown outcome; fully proven timeout may yield TIMED_OUT | NO retry; quarantine failed cleanup proof | 7/qualified 8; inspect jobs/population, persist outcome then release claim |
| D: incomplete + missing unit | EXECUTION_ERROR only with authenticated removal/reboot proof and reconciled namespace; otherwise QUARANTINED | NO retry; missing proof requires quarantine | 7; no missing-unit PASS/timeout inference; investigate identity/history |
| E: crash before framework start | ORPHANED; proven no submission/no unit ambiguity -> EXECUTION_ERROR; uncertain submission -> A–D | NO retry even without launch; ambiguity quarantines | 7; drain possibly accepted unit and finalize consumed reservation |
| F: crash after framework start | ORPHANED; manager continues lifecycle/deadline; A–D later produce error/qualified timeout | NO retry; claim until cleanup; failure quarantines | 7/qualified 8; no immediate death-termination claim |
| G: hard timeout during absence | TIMED_OUT only with exact retained timeout evidence, empty and durable cleanup; otherwise EXECUTION_ERROR/QUARANTINED | NO retry; quarantine unproven identity/cleanup | Qualified 8, otherwise 7; reconcile, never restart |
| H: cleanup/stop fails | QUARANTINED; preliminary success/failure/timeout is not normal terminal result | NO retry; quarantine root and runner if namespace/controller ownership ambiguous | 7; retain claims/evidence for operator drain |

A–G use H for failed cleanup. Reconcile before any execution affecting the
root and inspect runner-wide unknown namespace units. Empty plus unknown
outcome is error, never PASS. Restart/reboot/lost journal cannot allow replay.

## 8. Applied evidence, exact targets and executable resolution

### 8.1 Gate-free execution binding

Proposed private `execution-applied-binding.js` is read-only/refusal-only.
Uses stage4-run/run-artifacts/run-store data, review-record-v2.validateRecord
with rebuilt package and applied-change-set-record.validateAppliedChangeSetRecord.
Never calls assertState/selectedRecord (unused APPROVED only), approval gates,
apply.js or #23F. Import/call closure: section 10.

1. Reload bounded strict manifest v2 and complete Stage 4 inventories and
   manifest-verified artifacts. Reject redirects, orphan claims, temporary
   ledger, ambiguity/quarantine/multiple apply attempts for the package.
   Stored APPLIED is never execution authority.
2. Rebuild design/plan/change set/review package using existing generation
   chain/canonical primitives; recompute project/projection/runId/ordinal,
   artifact hashes, plan/context/change-set/package digests, CRS-1/TAP-2
   subject and PPI-1 paths. Bind exact installed product. Use
   rebuildSubject with live=false: the pre-apply context is historical;
   execution checks the resulting applied files independently below.
3. Locate one successful apply attempt/outcome by filename ID and matching
   ledger review record ID; recompute file hashes and exact claim/record/
   outcome references. Require APPLIED outcome with exact applied-record
   SHA-256. Require appliedAt within decidedAt..notAfter; missing temporal
   proof refuses. Expiry now neither renews authority nor invalidates a
   successfully consumed apply retroactively. Later conflicting decisions
   conservatively refuse, never resurrect a prior grant.
4. Independently rebuild v1 review core with gate-free builder and compare
   canonically: exactly one APPROVE per rebuilt operation/path/targetDigest;
   no omission/extra/duplicate/stale target. Recheck caller principal/root/
   project/product. No approval-verdict query/public command is introduced.
5. Validate applied closed schema/digest and its actual projectId,
   changeSetDigest, reviewPackageDigest and reviewRecordDigest fields against
   the rebuilt chain; plan/context digests bind through that chain, not
   invented applied-record fields. Require one-to-one operations/paths,
   successful overall and per-change outcomes, approved afterDigest and fresh exact approved
   bytes of ALL changes including helpers; bind Stage 4 successful outcome.
6. Recheck root platform/realpath/dev/inode, regular canonical files and no
   symlink/hardlink substitution. AppliedRecord v1 lacks historical file
   inode; fresh path/content identity suffices within existing R-4. Invent
   no historical identity and change no Stage 4 schema.
7. Framework agrees across config/plan/package. Freeze verified data-only
   descriptor, revalidate after reservation and immediately before submission.
   Post-apply mutation refuses before spawn, exit 4.

Only exact applied Cypress/Playwright specs from that package execute.
Helper/config-only packages refuse; no suite fallback, arbitrary target,
arbitrary framework args or provider command. Config/import/dependency code
remains untrusted inside lifecycle containment, not a transitive sandbox.
Exact transitive config/dependency fingerprint/compatibility and result
adapter remain BLOCKED qualification work. Recheck cannot freeze against
same-account writers (R-4); matching bytes do not cure authority ambiguity.

### 8.2 Closed launch resolution

Never execute node_modules/.bin: shims/shebangs/.cmd are not executable
authority. Use qualified absolute Node 22 plus canonical target-local JS
entrypoint. Read bounded package metadata as data, verifying exact name/
version/bin and canonical ownership without imports/evaluation. Reject
ancestor/global/PATH fallback, arbitrary config binary/provider selection,
links/redirects/out-of-root packages or entries; recheck before submission.

| Framework | Closed JS candidate / qualification still required |
|---|---|
| Cypress | root/node_modules/cypress/package.json name cypress, bin cypress -> bin/cypress; absolute Node + canonical bin/cypress; matching dist/cli and qualified native Cypress payload |
| Playwright | root/node_modules/@playwright/test/package.json matching name, playwright -> cli.js; absolute Node + canonical cli.js; matching local playwright/playwright-core and qualified native browser |

No npx/npm script, install/download, ambient Cypress cache, target
CYPRESS_RUN_BINARY, Playwright channel/executablePath override or global
browser fallback. Native provisioning needs closed canonical ownership,
version/digest and product-generated selectors. [Cypress native installation](https://docs.cypress.io/app/references/advanced-installation)
and [Playwright browser reference](https://playwright.dev/docs/browsers)
describe separate payloads; package-owned JS alone is insufficient.

Historical installed versions are not Linux support grants. Exact supported
framework/native versions, payload paths and literal argv adapters remain
BLOCKED at this authority STOP. Legacy Cypress chrome selector is not adopted
as it could select ambient browser. Both frameworks remain DEFERRED.

## 9. Retry, concurrency, environment and finite evidence

### 9.1 Consumption and ownership

One durable reservation per successful applied package. Retry after PASSED,
TEST_FAILED, TIMED_OUT, EXECUTION_ERROR, ORPHANED or QUARANTINED: **NO**.
Fresh executionId does not renew authority; new separately approved/applied
package required. Reservation consumes even before launch. Evidence deletion,
reboot or unit collection never resets it.

Exclusive same-ID, same-run/package and root locks. Serialize all runs in
one canonical root, covering targets/config/reports. Independent roots may
run with disjoint authoritative claims and no runner quarantine. Acquire
root -> package -> ID; conflict/ambiguous owner refuses (5), no stale-PID
stealing. Durable protected claim placement/anti-deletion history BLOCKED.

### 9.2 Environment categories

Positive projection for the actual manager-launched workload, suppressing
manager defaults/inheritance. Names carry no authority; never persist values.

| Category | Policy |
|---|---|
| REQUIRED | Product-derived PATH/HOME/CI/GITHUB_ACTIONS; qualified fixed tool directories, per-attempt home, CI=true, GITHUB_ACTIONS=false; initial executable absolute |
| ALLOWED | Product-derived LANG/LC_ALL/TMPDIR only, qualified literal locale/per-attempt temp; no ambient copy |
| STRIPPED | AI_API_KEY, Groq/Gemini/Google/all provider aliases; GITHUB_TOKEN/GH_TOKEN/GitHub credentials; npm auth/NPM_TOKEN/NODE_AUTH_TOKEN/npm config/package families; NODE_OPTIONS/NODE_PATH/loader/preload and every other ambient name |
| TARGET-OWNED PASS-THROUGH | Explicit finite SUT credential names/values from target operator runtime authority; no provider/product/GitHub/npm/loader/control names or wildcard |
| Cypress controls | Only qualified product-generated payload/cache/reporter values; no CYPRESS_* ambient/pass-through copying |
| Playwright controls | Only qualified product-generated browser/reporter values; no PLAYWRIGHT_* ambient/pass-through copying |

Proposed pass-through bounds: <=32 unique names, exact
`SUT_[A-Z][A-Z0-9_]{0,59}` with whole-string matching; values <=4096 UTF-8
bytes, no NUL; total <=65536 bytes. Adapters explicitly map SUT values when
needed; no reserved credential relabeled SUT. Exact future config/schema and
qualified PATH/HOME/native values remain BLOCKED, not current schema changes.

No generic secret protection: account-accessible files/network and deliberate
SUT values remain accessible. Empty HOME is not filesystem isolation. No
secret/handle is intentionally persisted, including manager/system logging;
raw stdout/stderr must not default to journald.

### 9.3 Evidence bounds and result taxonomy

Fixed proposed limits:

| Resource | Limit / behavior |
|---|---|
| stdout | 200000 bytes transient retention; cap before chunk copy; drain/discard excess, record truncation/counters; no unbounded concatenation |
| stderr | Independent same 200000-byte cap |
| Imported reports | <=8 regular files, <=1048576 bytes each, <=8388608 total; bounded read/parse; no symlink/recursive/arbitrary path import |
| All persisted product evidence | <=16777216 bytes per attempt including records/controller/report projections; check before write |
| Truncation | Never infer success from partial report; stream truncation is a fact, absent result proof is error |

Persist only bounded closed structural facts/counters/hashes/refs from
qualified adapters. No raw secret-bearing streams/report strings, exception
text, labels, environment values or unbounded journal. Size does not justify
raw persistence. Arbitrary target disk/network/resource use is outside these
bounds, not a quota/sandbox. Structural report grammar and safe manager
transport/retention remain BLOCKED qualification work.

PASSED needs confirmed run, qualified complete success and durable empty-tree
cleanup. TEST_FAILED needs qualified actual failed-test evidence, not nonzero
exit alone. Signal/cancel/missing report/start/controller/cleanup failure ->
EXECUTION_ERROR / 7, with quarantine for unresolved ownership/cleanup.

| Result/category | Exit |
|---|---:|
| PASSED | 0 |
| TEST_FAILED | 10 |
| TIMED_OUT with durable timeout/termination/cleanup proof | 8 |
| EXECUTION_ERROR / ORPHANED discovered synchronously / post-submission QUARANTINED | 7 |
| Authority/eligibility/replay/pre-existing quarantine before new start | 5 |
| Input/applied binding | 4 |
| Config | 3 |
| Usage | 2 |
| Internal product bug before authorized submission | 1 |

After possibly accepted submission, internal errors cannot skip recovery as
exit 1. Existing provider exit 6 outside execute remains unchanged. No new
orphan/quarantine exit. Reserved execute remains 5.

## 10. TSB-F02 — completed current and proposed consumer analysis

**CURRENT SUPPORTED SURFACE TSB-F02 TRIGGER = FALSE**.

Current supported graph, preserved:

```text
installed qa-agent -> cli.run
  -> design/plan/generate/review show -> gate-free rebuild/data consumers
  -> review record -> gate-free v2/core builder -> review evidence
  -> apply -> Stage 4 reservation -> canonical #23F
       -> validateApprovedGeneratedChangeSetReview (only approved caller)
       -> independent verifyApprovedChangeBinding -> canonical/live checks
  -> execute -> reserved exit 5 (no execution/gate load)
validateApprovedTestDesignReview -> no supported production caller
legacy #23G -> excluded from installed package
```

Normative proposed private execution graph:

```text
execute handler
  -> execution-applied-binding (section 8.1; refusal-only read consumer)
       -> stage4-run: openStage4Run/readEvidence/rebuildSubject only
            -> run-artifacts -> generation-chain/package rebuild primitives
            -> run-store -> bounded strict manifest/artifact reads
            -> stage4-state -> structural ledger/apply consistency
            -> review-record-v2 -> gate-free review-record builder/canonical
            -> canonical-review-serialization / path-identity
            -> stage4-principal -> root/OS-principal/storage binding
       -> review-record-v2.validateRecord(rebuilt package)
            -> buildGeneratedChangeSetReviewRecord (gate-free core rebuild)
       -> applied-change-set-record.validateAppliedChangeSetRecord
            -> generation primitives/errors/limits + node:crypto
       -> exact decisions/applied/live checks (section 8.1)
       -> frozen data descriptor, never public approval verdict
  -> execution-state/store -> consumed attempts/locks/reconciliation
  -> systemd adapter -> closed descriptor/lifecycle observations
  -> qualified framework-result adapter -> bounded structural facts
  -> execution-record builder -> closed durable evidence
```

New state/controller/result/record modules may import only Node built-ins,
execution-private data helpers and gate-free errors/canonical/primitives for
their described role. No apply.js, #23F, gate definer/symbol, legacy execution,
regeneration, provider code or dynamic/computed module loader. Framework/config
loading is a separate untrusted service workload, never an approval gate route.
No gate remediation/refactor/extraction is proposed or authorized.

Existing stage4-run + applied-change-set-record closures were inspected with
the repository analyzer: **38 files, no missing edges, no lexical graph
problems, no gate-symbol hits, no #23F, no legacy execute**. Existing imports
are gate-free. New modules have a closed import boundary, requiring future
installed-package static proof. This completes the proposed consumer design,
not missing runtime code or controller privilege qualification.

| Constraint | Current | Proposed execute design |
|---|---|---|
| DC-F02-1 gate only through #23F | Holds | Holds; no new gate consumer/path to #23F |
| DC-F02-2 no gate/stored-status approval verdict | Holds | Holds; per-target core rebuilt; APPLIED evidence never sufficient |
| DC-F02-3 test-design gate absent | Holds | Holds; forbidden in complete new-module closure |
| DC-F02-4 no gate public export | Holds | Holds; no public export added |
| DC-F02-5 apply retains independent binding | Holds | Holds; apply/#23F unchanged; execute cannot reapply |

**PROPOSED EXECUTE TSB-F02 TRIGGER = FALSE** for this explicit consumer graph.
The former INDETERMINATE consumer-design blocker is resolved. The independent
section 4 authority STOP remains. Finding stays **OPEN / LOW / CONDITIONAL**;
no closure/re-rating/remediation. Future import/call/authority changes require
re-evaluation, with STOP if TRUE or INDETERMINATE. Design FALSE is not runtime
certification or permission to bypass future tests.

## 11. Remaining design work, implementation boundary and security impact

Closed execution-record schema is **NOT FINALIZED at this security STOP**;
field inventories are not a schema. Proposed new identity:
AutomationExecutionRecord schemaVersion 2, separate from legacy v1. Bind
executionId; run/package/apply/review IDs/digests; project/canonical root/
principal; framework/runtime/native identities; exact target paths/operations/
content; runner/OS/boot; unit/invocation/controller contract/version; reserve/
start/end/cleanup UTC and monotonic duration; closed state/result/reason;
exit/signal/timeout proof; bounded structural refs/hashes; product version.
No command text, raw output, secrets/handles or provider material. Exact keys,
types/bounds/nullability/digest domains/cross-field rules and separate attempt
journal must be finalized with enforceable authority, not left to implementers.

| Required mission item | Disposition |
|---|---|
| 1 eligibility | Mandatory checks fixed; baseline/authority qualification BLOCKED |
| 2 provisioning | Operator install/drain/revoke duties fixed; safe grant recipe BLOCKED |
| 3 privilege | Analyzed; OP-06-03 security/deployment STOP |
| 4 service | Semantics fixed; enforced property/API qualification BLOCKED |
| 5 identity | Closed grammar/collision/non-reuse/lookup fixed |
| 6 bounded orphan | Adopted; no immediate client-death claim |
| 7 reconciliation | A–H result/retry/quarantine/exit/cleanup fixed; protected protocol BLOCKED |
| 8 state machine | Closed proposed states/transitions; serialized journal/durability BLOCKED |
| 9 timeout | Exact proposed values; independent host enforcement BLOCKED |
| 10 termination | Full-tree/empty/admission proof; authorized operations BLOCKED |
| 11 executables | JS/.bin policy fixed; native/version/literal adapters BLOCKED |
| 12 targets | Exact applied specs only, no suite fallback |
| 13 binding | Read-only algorithm/existing-evidence compatibility fixed; fingerprint BLOCKED |
| 14 retry | NO for any consumed state |
| 15 concurrency | Root/package/ID exclusivity/order; protected claims/store BLOCKED |
| 16 environment | Categories/reserved keys/SUT bounds; literal host/native/config schema BLOCKED |
| 17 evidence | Exact caps/no raw persistence; safe transport/result adapter BLOCKED |
| 18 record | Proposed v2 identity/obligations; exact closed schema BLOCKED |
| 19 exits | Fixed taxonomy, no new exit values |
| 20 TSB-F02 | Current FALSE / proposed FALSE, complete section 10 graph |
| 21 security | Existing contracts preserved, impact only |
| 22 deployment | No component adopted; compliant authority unresolved, OWNER DECISION REQUIRED |
| 23 Stage 5 | Private boundaries below; implementation/activation unauthorized |
| 24 validation | Documentation/current-surface checks; section 12; no design PASS certification |

Likely future private modules: execute.js, execution-applied-binding.js,
execution-state.js/execution-store.js, systemd adapter, Cypress/Playwright
launch/structural-result adapters, execution-record-v2.js. Possible future
integration: CLI args/routes/closed config, installed inventory/static-graph
and external consumer tests. Interfaces: verifyApplied -> frozen descriptor;
reserve -> consumed attempt; submit -> manager identity; observe/stop/reconcile
-> structural facts; normalizeResult -> qualified facts; commitOutcome ->
durable terminal evidence. Exact interfaces/schemas/storage require completed
design before Stage 5, not implementation discretion.

Forbidden now: all source/test/workflow/package/config edits. Future Stage 5
must preserve Stage 4 records/manifest/approval/apply semantics, TAP-2/CRS-1/
PPI-1, #23F, both gate implementations, FUTURE guards, public barrel/exports/
bin and legacy module exclusion. Execution storage must be outside Stage 4
run-root inventory (which rejects unknown directories), with an exact future
approved layout. No silent migration/dependency/export expansion.

Sequence: finish authority/design -> design exact-head CI -> Architecture ->
Security -> PO OD-06 -> separately authorized Stage 5 -> Linux/native/
adversarial/installed-package qualification -> separate release activation.
Design approval never flips RELEASE_CAPABILITIES.execute. Target opt-in alone
cannot enable it. Installed behavior must work in an external target from npm,
without source checkout, global framework or .bin shim.

Future adversarial requirements: direct D-Bus same-name property/auxiliary
abuse; User/ExecStart/deadline/kill-mode mutation; manager/workload account
control; migration/fork/setsid descendants; client SIGKILL around submit/start;
manager restart/reboot; stale/missing/recreated units; uninterruptible tasks/
cleanup failures; durable handoff/claim corruption; Node/framework/native/shim
substitution/downloads; exact-spec versus suite selection; content/helper/root/
product/record/decision tampering; TOCTOU; replay/concurrency; secrets in env/
journal/output; stream/report/persistence overflow; forged zero-exit/PASS and
unknown/signal outcomes. Cooperative test success cannot certify this matrix.

TAP-2/CRS-1/PPI-1 unchanged; R-1..R-5 ACCEPTED only in existing OD-04 scope;
AT-07/TB-01 RESIDUAL; every FUTURE guard OPEN. No closure/re-rating/new
residual acceptance.

| Existing residual | Execute impact only |
|---|---|
| R-1 | Same-principal automation remains; no human proof |
| R-2 | Account attribution is not human identity/runner qualification |
| R-3 | Writable evidence forgery/deletion; hashes are not origin/protected history |
| R-4 | Fresh path/content is not immutable transitive code or TOCTOU elimination |
| R-5 | Harmful approved code keeps account filesystem/network permissions |
| AT-07/TB-01 | Rebuilt bindings refuse inconsistency; forged self-consistent local evidence remains residual |

Management escalation in section 4 is not absorbed into accepted residuals.
Host/network/SUT-secret/dependency/output/resource exposures still require
OD-06 disposition. Containment remains lifecycle only.

## 12. Validation and delivery boundary

Exact allowlist: this document only. No source/test/workflow/package diff;
API/bin/exports/package surface and disabled execute preserved.

Checks: Markdown structure/fences/whitespace, relative-link destinations and
regression against starting HEAD, stale active statuses versus historical
sections 1–2, completed graph, state/exit/timeout consistency, existing DC-F02
static graph and CLI package suites, git diff --check, direct commit parent/
preserved ancestry, final clean tree. Report observed results in final response;
do not reuse the prior commit's 35-test pass. No controller/framework/system
provisioning execution. Windows Node 24 checks are not Linux Node 22 proof.

Observed pre-commit validation on Windows / Node v24.21.0:

- `node --test test/security/controlled-v1/dc-f02-static-graph.test.js test/installation/controlled-v1-cli-package.test.js`:
  **35 tests, 35 pass, 0 fail/skip**; real npm pack dry-run inventory, API,
  export/bin and current gate closure checks included.
- Read-only documentation checks: 13 numbered sections, balanced fences,
  no trailing whitespace, all 23 relative-link occurrences resolve, no removed
  baseline relative destination, historical sections 1–2 unchanged, active
  stale-status scan passes, all eight cases/all 24 mission items accounted for.
- Direct subprocess proof: `qa-agent execute --json` returns native exit 5
  and CAPABILITY_NOT_ENABLED_IN_RELEASE; no framework started.
- Proposed existing dependency closure: 38 files, no missing/problem/gate
  edges or #23F/legacy execute reachability. Future code remains untested.

One new local commit above supplied HEAD. Push/PR/exact-head CI **NOT
PERFORMED**: mission permits that path only after complete design PASS with
no STOP. Reviews NOT STARTED; merge/implementation/activation NOT AUTHORIZED.

On later PASS: push branch, open main design PR, obtain exact-head CI, stop
before review. HEAVY Architecture exact-head -> if APPROVED HEAVY Security
same HEAD -> if both APPROVED PO OD-06. No merge without separate authority.

## 13. Mandatory handoff / final-report schema

```text
MISSION RESULT:
STOP — OWNER SECURITY/DEPLOYMENT DECISION REQUIRED (OP-06-03)

C1 OWNER DECISION:
APPLIED

OP-06-02 OWNER DECISION:
APPLIED

STOP COMMIT PRESERVED:
YES — 76c1ce8bbafe5f0aed36507fbbc924c3a973ebb7

SECOND DESIGN COMMIT PRESERVED:
YES — 0cc24cfb8cf77200eccc8d556822f1349a805eda

SYSTEMD CONTROLLER / TRUSTED CONTROLLER MODEL:
SELECTED — host system manager, transient .service, cgroup v2

INITIAL RUNNER:
PROVISIONED SELF-HOSTED LINUX (candidate; authority qualification blocked)

PRIVILEGE MODEL:
Scoped creation unproven; stock name/verb polkit does not validate service
properties/auxiliary units. No root/broad grant/helper/daemon adopted.

PROVISIONING CONTRACT:
Operator host/account/framework/namespace/recovery/qualification and drain/
revocation duties fixed; safe grant/install protocol blocked.

SYSTEMD TRANSIENT SERVICE CONTRACT:
One exact service, literal executable/argv, cwd/projected env, non-root,
control-group kill, finite bounds, restart/delegation off, no arbitrary
properties/shell/auxiliary units; authority enforcement blocked.

UNIT IDENTITY:
qa-agent-exec-v1-<32 lowercase hex executionId>.service; OS-random 128-bit
ID; boot/invocation binding; collision fails; no reuse; durable lookup.

CGROUP V2 CONTRACT / WHOLE-TREE TERMINATION PROOF:
Protected domain subtree before code; admission closed; controller tree
stop/SIGKILL; populated=0 and no start/restart; removal proof; 30000 ms
confirmation; failure QUARANTINED / 7. Authorized API proof blocked.

CONTROLLER LIFECYCLE INDEPENDENCE / BOUNDED ORPHAN MODEL:
Selected manager outlives client; finite deadline; incomplete attempt
reconciles, never PASS; no immediate client-death termination claim.

PARENT-DEATH RECOVERY:
Bounded orphan/deadline plus later reconciliation, not immediate detection.

RECONCILIATION:
A–H section 7; no retries; unknown -> error; failed cleanup -> quarantine;
timeout 8 only with durable exact deadline and empty/cleanup proof.

TIMEOUT:
Proposed T default 600000 ms, min 1000/max 600000 integer; target config
only; RuntimeMaxSec=T/1000; 30000 ms start/stop/confirmation budgets;
observation <=T+90000 from request; host qualification blocked.

RUNNER ELIGIBILITY:
Provisioned self-hosted Linux initial candidate; Windows REFUSED;
macOS/generic Linux/GitHub-hosted/containerized/generic VM DEFERRED;
failed mandatory checks -> 5 before spawn, no degraded mode.

DEPLOYMENT IMPACT / DEPLOYMENT MODEL IMPACT:
OWNER DECISION REQUIRED — npm + host systemd remain selected goal;
NO new QA Agent service/helper adopted; NO Docker/OCI/Kubernetes.

CURRENT SUPPORTED SURFACE TSB-F02 TRIGGER:
FALSE

PROPOSED EXECUTE TSB-F02 TRIGGER:
FALSE — completed gate-free applied-binding consumer graph.

DESIGN COMPLETENESS:
STOP artifact complete; implementable contract incomplete. Safe authority,
host/native qualification, fingerprint, claims/store, closed record/journal/
config/result schemas and exact controller APIs remain blocked.

IMPLEMENTATION / EXECUTE ACTIVATION:
NOT AUTHORIZED / NOT PERFORMED

PUSH / PR / EXACT-HEAD CI:
NOT PERFORMED — local security STOP artifact only

INDEPENDENT REVIEWS / MERGE:
NOT STARTED / NOT PERFORMED
```

Report new local HEAD/tree, observed validation and unchanged API/source scope
in delivery response, not self-referential hashes in this document.
