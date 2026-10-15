# Controlled-v1 OD-06 execution contract v1 — scoped controller broker design

Date: 2026-10-13 (Europe/Berlin).

Design authority: OD-CONTROLLED-V1-OD-06-EXECUTION-DESIGN — APPROVED.
Continuation: OD-CONTROLLED-V1-OD-06-C1-RUNNER-CONTAINMENT — APPROVED.
Controller: OD-CONTROLLED-V1-OD-06-OP-06-02-SYSTEMD-CONTROLLER — APPROVED.
Broker: OD-CONTROLLED-V1-OD-06-OP-06-03-SCOPED-CONTROLLER-BROKER — APPROVED.
Architecture corrective: OD-CONTROLLED-V1-OD-06-ARCH-C1 — APPROVED.
Architecture corrective: OD-CONTROLLED-V1-OD-06-ARCH-C2 — APPROVED.
Security corrective: OD-CONTROLLED-V1-OD-06-SEC-C3 — APPROVED.
Architecture corrective: OD-CONTROLLED-V1-OD-06-ARCH-C4 — APPROVED.
Architecture corrective: OD-CONTROLLED-V1-OD-06-ARCH-C5 — APPROVED.
Canonical closure: OD-CONTROLLED-V1-OD-06-CANONICAL-CLOSURE — APPROVED;
OD-CONTROLLED-V1-OD-06-CANONICAL-CLOSURE-C1-SCOPE — APPROVED.

Current lifecycle overlay (2026-10-14): OD-06 **COMPLETE_ON_MAIN / POST-MERGE
CERTIFIED** (PR #254, merge 22ceb0682f9b56c2fbefdbad35273b7c21225d89; §19).
Stage 5 **READY / NOT AUTHORIZED**; execute **DISABLED**; Controlled Release
**NOT APPROVED**. Process-lifecycle containment only (§19). The authoring
paragraphs below are the historical PR #254 review chronology; sections 3–18
remain the approved normative design, unchanged.

Stage 5 design-gap overlay (2026-10-15): the authorized Stage 5
implementation preflight STOPPED before code on four design gaps (DG-1
fingerprint handoff, DG-2 caller authentication, DG-3 native broker/build/
distribution/host, DG-4 execute CLI/config). §20 is the **PROPOSED** closed
resolution under OD-CONTROLLED-V1-STAGE5-DESIGN-GAP-RESOLUTION. It is not
approved until independent exact-head HEAVY Architecture and Security review
and Product Owner acceptance; even then it authorizes no Stage 5
implementation, which needs a new separate authorization. Execute stays
**DISABLED**; Controlled Release **NOT APPROVED**.

Historical authoring result: **DESIGN COMPLETE — READY FOR DELIVERY / EXACT-HEAD CI /
INDEPENDENT HEAVY ARCHITECTURE REVIEW**. Author completion is not independent
approval, runner certification, PO OD-06 acceptance or release approval.
Independent HEAVY Architecture review of 61aeb27236ce346f93a9dfb1cfe4aed4518f1693
returned CHANGES REQUIRED (3 MAJOR / 3 MINOR); section 14 records the C1
corrective. Independent HEAVY Architecture re-review of the C1 HEAD
12c6a589d3d456914e28be09d7c032fc44e8c6c4 returned CHANGES REQUIRED
(0 MAJOR / 3 MINOR); section 15 records the C2 corrective. Independent HEAVY
Architecture re-review of the C2 HEAD 5c1f2311786fadb060fb45af52cb5afeb86f7e8d
returned APPROVED; independent HEAVY Security review of the same HEAD returned
CHANGES REQUIRED (3 MEDIUM); section 16 records the C3 Security corrective.
Independent HEAVY Architecture re-review of the C3 HEAD
987b99cee788b31005ca217a6b05d18099203278 returned CHANGES REQUIRED
(0 MAJOR / 1 MINOR); section 17 records the C4 corrective. Independent
HEAVY Architecture re-review of the C4 HEAD
91943036d885e94760762e277120e174c397e9b5 returned CHANGES REQUIRED
(0 MAJOR / 1 MINOR); section 18 records the C5 corrective. C5 corrective
changes are completed and ready for independent re-review; no prior
exact-head review covers the C5 HEAD. Subsequently, independent HEAVY
Architecture and Security re-reviews of the C5 HEAD both returned APPROVED,
and PR #254 merged and was post-merge certified (§19).

OP-06-03 is APPLIED. Host systemd, transient .service and cgroup v2 remain
selected. Sole privileged mediation boundary: root-owned, operator-installed,
one-shot execution controller broker. Runner gets no direct manage-units,
generic sudo, systemctl or systemd-run authority. Only OP-06-02's privileged
helper prohibition is superseded; custom daemon prohibition remains.
Sections 1–2 preserve historical discovery; sections 3–18 govern this proposal.

**DESIGN ONLY**: no broker/source/test/workflow/package/export implementation,
execute activation, Stage 5, release or merge. Normal product remains npm.
Exactly one new host provisioning executable artifact; its fixed policy,
configuration and durable state are operator-managed controller contract
parts, never target-repository components or permanent QA Agent services.

Execute stays reserved (exit 5), RELEASE_CAPABILITIES.execute disabled.
Stage 4B COMPLETE_ON_MAIN / POST-MERGE CERTIFIED; reviewRecord/apply semantics
and target opt-ins unchanged. TSB-F02 OPEN / LOW / CONDITIONAL; TAP-2/CRS-1/
PPI-1, R-1..R-5, AT-07/TB-01 unchanged; FUTURE guards OPEN.
Controlled Release NOT APPROVED. Canonical closure state: §19.

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

| Fact | Verified on 2026-10-13 |
|---|---|
| Repository / branch | TarasovArtem/qa-ai-agent / design/controlled-v1-od06-execution |
| Authorized starting HEAD / tree | 8a697ba2c825d0b88c945eeb6d2c38ba03f5c1e0 / ce6c93f9c6e11fcf4169271f6c552c9cc3d0e1d9 |
| Preserved first STOP | 76c1ce8bbafe5f0aed36507fbbc924c3a973ebb7 |
| Preserved second design STOP | 0cc24cfb8cf77200eccc8d556822f1349a805eda |
| Preserved authority STOP | 8a697ba2c825d0b88c945eeb6d2c38ba03f5c1e0 |
| Certified base / fetched origin/main | 126d105841cf404c92752ae54bb616ed710d7f53 |
| Remote design branch before delivery | Same certified base; push preserves local STOP ancestry by fast-forward |
| Starting worktree | Clean; supplied checkpoint matches |
| Changed-file allowlist | docs/controlled-v1-execution-contract-v1.md only |
| Host | Windows; not Linux controller evidence |
| Open PR inventory | Dependency #243/#250/#251/#252, historical proof #132; no competing engineering PR observed |
| Commit policy | One direct child of supplied HEAD; no amend/squash/rebase/reset/force-push |

| Runner | Execute disposition |
|---|---|
| Provisioned self-hosted Linux | Initial candidate; eligible only with exact qualified profile and all mandatory checks |
| Windows | REFUSED |
| macOS / generic Linux / GitHub-hosted Linux / containerized Linux / generic VM | DEFERRED |

A qualified self-hosted runner may physically be a VM; labels/config booleans
do not prove eligibility. Non-execute commands retain current per-command
OS/storage/TTY/CI gates; no new platform support. Execute CI cannot bypass
Stage 4 approval/apply prohibitions or copied-root refusal.
Existing [Cypress workflow](../.github/workflows/cypress.yml) unchanged.

Claim: controlled privileged management and process lifecycle / full
process-tree containment. No malicious-code sandbox, filesystem/network/
target-secret isolation, or general intra-account privilege isolation.
Tests retain runner-account authority subject to explicit controls below.
No immediate client-death termination: manager deadline and later durable
reconciliation bound orphans; broker is not a daemon.

## 4. Scoped authority and closed broker interface

### 4.1 Enforcement and evidence

Historical STOP evidence remains valid: name-limited Polkit does not enforce
complete transient properties. See [v256 manager](https://raw.githubusercontent.com/systemd/systemd/v256/src/core/dbus-manager.c),
[pinned manager](https://raw.githubusercontent.com/systemd/systemd/195a17c59b22f5b0fa626fdb4917107cdc281bac/src/core/dbus-manager.c)
and [authorization](https://raw.githubusercontent.com/systemd/systemd/195a17c59b22f5b0fa626fdb4917107cdc281bac/src/core/dbus-util.c).
OP-06-03 resolves authority through broker validation, not broader Polkit.

Fixed native artifact: /usr/local/libexec/qa-agent-controller-v1,
contractVersion="qa-agent-controller-v1", request/response/journal version 1.
Root entry accepts zero argv, one bounded request, exits after that operation.
Create may remain attached within its finite lifecycle budget. No listener/
scheduler/background service/custom daemon. No privileged Node/shell/npm/
target config/framework/library import or privileged child command.

The same immutable artifact has fixed --workload-v1 mode, used only as the
broker-built service executable under explicit non-root systemd User/Group.
It refuses root/unexpected UID/GID, clears inherited environment, consumes
broker-created memory-only launch envelope, closes control FDs, sets stdin
to /dev/null and execs qualified Node once. No controller authority; this
is a mode of the single artifact, not another helper.

### 4.2 Minimal closed request

Wire: u32 big-endian length + exactly that many strict UTF-8 JSON bytes;
<=262144 bytes/depth<=12/intake<=5000 ms. No BOM/duplicate keys/invalid
Unicode/NUL/trailing JSON. All §4–11 schemas recursively closed/all keys
required; unknown/coercion/default merging refused, null explicit only.
Create stdin carries exactly the request frame and, only after the EXITED
frame, one result-proposal frame (§7.2); any other client frame is a protocol
violation (§7.2), never a second channel.

| Operation | Exact top-level keys |
|---|---|
| create | schemaVersion, contractVersion, operation, executionId, root, subject, framework, targets, timeoutMs, environment |
| reconcile | schemaVersion, contractVersion, operation, executionId |

schemaVersion=1, contractVersion literal above. executionId=32 lowercase hex
OS-random 128 bits generated by client; broker independently validates
grammar/non-reuse (identity handoff §7.1). Create starts/observes one
attempt through the closed §7.2 frames; reconcile combines
inspect/stop incomplete/cleanup exact protected attempt. Cancellation calls
reconcile from another one-shot invocation. No generic inspect/kill/restart/
update API. No command string/shell/raw properties/unit file/executable/argv/
cwd/user/group/slice/kill/restart/manager endpoint/request path/caller FDs.

| Create record | Exact keys / types |
|---|---|
| root | platform="linux", path=canonical absolute, dev=decimal string, ino=decimal string, digest=H matching Stage 4 root-identity-v1 |
| subject | runId, packageOrdinal, applyRecordId, packageDigest=H, appliedRecordSha256=H, bindingDigest=H, product={name:"qa-ai-agent",version:exact enrolled version} |
| targets[] | path=canonical PPI-1 relative executable spec, operation="CREATE"/"MODIFY", afterDigest=H |
| environment[] | name=§9 SUT grammar, value=bounded UTF-8 string |

H=sha256: +64 lowercase hex. Whole-string regexes: ID ^[0-9a-f]{32}$;
runId ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$; ordinal ^(?!0000)[0-9]{4}$.
Root path<=4096 UTF-8 bytes/no controls/'%' specifier; dev/ino 1..20 decimal
digits/no sign/leading zero except "0". No path repair. Targets 1..100
unique/sorted ASCII, exactly ALL executable specs in applied package, no
subset/suite fallback. Framework cypress/playwright agrees with enrolled
config/plan/package; timeout integer 1000..600000. Environment SUT data only,
no secret file/handle references; no provider execution facts.

Current config v1 unchanged. Later separately approved config revision uses
closed execute={timeoutMs,sutEnvironmentNames}, default T=600000, <=32
unique names subset of root enrollment. Runtime values only these named
caller environment entries, no wholesale inherit; missing refuses/empty
allowed. No new CLI option authorized by this design.

### 4.3 Independent broker validation boundary

Before privileged action broker independently checks:

1. Artifact/config/state integrity, protocol/schema/version, effective root,
   zero argv and authenticated enrolled caller UID/GID/account. No identity
   from request/ordinary caller environment. Exact §5.4 compatibility record
   match; request values are compared, never used to select a pair.
   Order (§5.6.4): everything in this item except the §5.4 match and
   protected-state integrity is the C1a gate, first in P1 immediately after
   P0 and before any enrollment- or caller-dependent operation; RECONCILE
   runs it as R1a before any caller ownership or protected attempt lookup.
   Protected-state integrity is F2 (C3/R3) plus transaction recovery
   (C5/R4); the §5.4 match runs only at CREATE C7 and never gates RECONCILE.
2. Literal operator-enrolled canonical root/dev/inode/digest/account and live
   storage trust (§5.6.2; no enrolled or requested storage claim);
   descriptor-relative no-follow/beneath/no-mount-crossing opens of fixed
   data locations; no wildcard ancestor/home or caller evidence pathname.
   Root must be a runner-owned repository below a literal operator workspace,
   never /, a system directory or an ancestor of controller artifacts. The
   workspace anchor is the single root-protected enrollment workspace (§5.2);
   enrolling root/home itself is forbidden. Every root is reached from the
   anchor without crossing a mount and is not itself a mount root (§5.5).
   Enrolled roots are pairwise non-overlapping (§5.5); any persisted overlap
   or mount violation makes the runner ineligible for every create.
3. Enrolled config/bounded Stage 4 data, request successful apply outcome/
   record/chain identities/framework, approved afterDigest of ALL changes/
   fresh canonical bytes and exact specs. Client still performs §8.1 full
   gate-free reconstruction; broker reconstructs §11 launch/security
   binding from fixed data and compares bindingDigest, imports no target JS.
4. Exact qualified Node/framework/native/fingerprint/adapter; metadata as
   bounded data; recheck canonical files immediately before submission.
5. Timeout/SUT enrolled names/bounds; constructs complete launch envelope
   and systemd payload; no raw caller property/privilege semantics.
6. Protected claims/consumption, reconciliation and unit namespace; collisions/
   unbound units; manager/boot/cgroup/property/non-root UID/nonprivileged
   group identity, absence of direct manager/sudo/delegation escape rights.
   Qualification excludes caller-accessible user managers/schedulers/agents
   that can launch requested descendants outside the owned service; config
   labels or clearing DBUS_SESSION_BUS_ADDRESS cannot prove this absence.
7. Durable SUBMITTING before D-Bus; actual property/InvocationID/cgroup
   readback and durable CONTROLLER_BOUND before returning bound observation.
8. Host kernel mount/cgroup namespace identity with PID1, trusted local
   filesystem types and the bounded workload-storage mount (§5.6), in the
   normative order of §5.6.4. For CREATE: the descriptor-independent checks
   (N1–N6, F2, W1, W2, W4, the W3 size bound and the W5 structural part)
   MUST run in P1 immediately after the item-1 gate (C1a),
   before items 2–7 and any protected-store write, §5.5 walk, manager call
   or cgroup read; F1 MUST run on the workspace/root descriptors produced by
   the item-2 §5.5 M1/M3 walk, before any protected-store write and before
   reservation/start; the W3 free-space and W5 binding parts MUST run after
   pre-create recovery/reconciliation and before the reservation commit.
   All are repeated in the P1S recheck (§6.4). RECONCILE applies only the
   §5.6.4 reconcile subset; F1, the §5.5 workspace/root eligibility of item
   2 and the create inputs of items 3–5 never gate RECONCILE.

Unknown/unsupported property/default/identity REFUSE before start.
Possible accepted start -> error/scoped recovery, no fallback. Mismatch
terminated only with proved protected ownership, otherwise operator quarantine.
Namespace necessary, never sufficient.

Root controller history prevents consumption deletion/replay, not approval
authenticity: forged self-consistent account-writable Stage 4/result evidence
remains R-3/AT-07/TB-01. Same-account TOCTOU/dynamic imports remain R-4.
Neither residual permits target root execution/arbitrary management.

## 5. Invocation, provisioning and artifact integrity

### 5.1 Narrow invocation

Operator-owned sudo rule shape (not installed by this mission):

    qa_runner ALL=(root:root) NOPASSWD: NOSETENV: NOLOG_INPUT: NOLOG_OUTPUT: /usr/local/libexec/qa-agent-controller-v1 ""

qa_runner substituted once as literal enrolled account. Empty argument
specifier forbids argv; omission permits arguments, as [upstream sudoers](https://raw.githubusercontent.com/sudo-project/sudo/main/docs/sudoers.man.in)
documents. No command/argument wildcard/generic sudo/shell/systemctl/
systemd-run/caller-selected privileged executable.

Operator visudo/effective policy qualification: env_reset, fixed secure_path,
no caller cwd/chroot/env preservation/setenv/PAM loader injection, no payload
I/O/debug/core logging. Sudo must supply/overwrite authentication metadata
unforgeably under allowed options; broker uses that qualified context,
never ordinary SUDO_UID as account proof. Absent/ambiguous/direct-root
context refuses; spoofed SUDO_* and all sudo options are negative tests.
Broker safe fixed cwd, closes FDs>2, ignores other ambient env.

Client launches absolute qualified sudo with fixed
["-n","--","/usr/local/libexec/qa-agent-controller-v1"], shell:false, framed
stdin. Command accounting may retain fixed executable name only; no stdin/
env/stdout/stderr/proposal logs. Runner gets no direct
org.freedesktop.systemd1.manage-units/equivalent create/update/stop/migration.

**If narrowly enforceable invocation/authentication unavailable:
STOP — OWNER SECURITY DECISION REQUIRED.** No broader fallback. A bad host
fails qualification; a different mechanism needs owner decision.

### 5.2 Integrity and exact qualification

| Component | Owner / expected permissions |
|---|---|
| Broker | root:root 0755, regular/non-symlink/no setuid or file capability, protected ancestors/libraries |
| /etc/qa-agent-controller-v1 / enrollment.json | root:root 0700 / 0600, no runner-writable includes |
| /usr/local/share/qa-agent-controller-v1 / compatibility.json | root:root 0755 / 0644, regular/non-symlink, protected ancestors; non-secret §5.4 record |
| sudoers.d exact rule | root:root 0440, protected parent |
| /var/lib/qa-agent-controller-v1 | root:root 0700, journal/claims/tombstones 0600, durable fsync filesystem whose live type is in the §5.6.2 allowlist |
| /var/lib/qa-agent-workload-v1 (mount root B, §5.6.3) | Dedicated operator-provisioned size-bounded mount; root:root 0755, not runner-writable |
| B/workloads (leaf parent) | root:root 0711, traversable but non-writable/non-listable by runner; descriptor-anchored workload leaf runner-owned 0700 |

Runner-controlled/replaced broker/config invalid. Enrollment strict JSON
<=1048576 bytes exact keys {schemaVersion,enabled,compatibilityDigest,caller,
workspace,roots,qualification}; version1/boolean/H digest of the §5.4 record.
caller={uid,gid,account}, IDs integer1..4294967294, account<=64 ASCII
[A-Za-z0-9_-]+. workspace={path,dev,ino}: exactly one operator anchor per
runner, canonical absolute path<=4096 bytes (§4.2 path rules), never "/",
a system directory, a home directory or an ancestor of controller
artifacts; root:root, not group/other-writable, protected ancestors; dev/ino
decimal strings (§4.2) of the anchor directory. It is the trusted base of the
§5.5 mount rule; no caller or target value selects it.
roots<=64 exact {root,projectId,outputDir,framework,sutNames,
fingerprint}, §4 root/existing project ID grammar/configured canonical
relative outputDir<=300 bytes safe segments/no '..'/framework literal/
<=32 SUT names/§8 fingerprint.
qualification={profileVersion,osBuild,kernelBuild,systemdBuild,sudoBuild,
nodePath,nodeVersion,nodeSha256,brokerBuild,frameworkProfiles,
workloadStorage};
profileVersion="od06-linux-v1", builds<=256 ASCII/no controls, nodePath
absolute canonical<=4096, nodeVersion exact22.x.y/hash H.
frameworkProfiles<=2 unique {framework,packageVersion,packageSha256,nativePath,
nativeVersion,nativeSha256,browserPath,browserVersion,browserSha256,adapterVersion};
paths<=4096 absolute/versions<=256/hashes H, adapters od06-cypress-v1/
od06-playwright-v1. workloadStorage exactly {fsType,maxBytes,minFreeBytes}:
fsType "ext4"/"xfs"/"f2fs", maxBytes integer 1073741824..1099511627776,
minFreeBytes integer 67108864..maxBytes (§5.6.3); no path key (the mount
point is a compiled literal). profileDigest hashes qualification (§11), no templates;
it is carried only inside the §5.4 compatibility record.

Later product-owned release-approved compatibility manifest lists exact tested
§5.4 records (product version, broker digest, contract, profile). Enrollment
cannot qualify unlisted builds or pairs; no >=version/floating latest/distro
label inference. Empty manifest refuses all.
No Linux tuple certified in Windows session. Real evidence populates future
Stage 5 outputs, not an unresolved controller design choice.

Every check before target code: exact qualified Linux/self-hosted/account/
OS/kernel/systemd/sudo/Node/broker/storage/bus; host mount/cgroup namespace
identity, trusted filesystem types and bounded workload storage (§5.6);
cgroup v2 protected domain,
no runner migration/delegation; fixed property/FD/stop/kill support; no
namespace aliases/drop-ins/hooks/unbound units; durable crash/boot history;
canonical root/apply/framework/native/env/capture/result bounds. No target
preflight script. Pre-start authority exit5/input4/config3; post-submit
uncertainty controller7/reconciliation.

### 5.3 Install, compatibility, upgrade and revocation

Operator installs single digest-identified broker/rule/config, qualifies
host, then target opts in. Npm does no root install/postinstall/upgrade or
target system config. Distribution/signature/release packaging and which
exact npm/broker pairs are allowed require later release approval; this
design fixes only the §5.4 representation and fail-closed enforcement, not
a publication channel/new exports.

Upgrade: disable creates, reconcile/drain/prove empty/fsync outcomes/history,
revoke invocation during atomic verified root-owned replacement, requalify,
operator reenables. No ABI fallback/consumption reset/silent journal migration.
Removal: disable creates; retain reconcile until empty/durable; revoke rule/
broker; retain consumed/quarantine history; safe runtime cleanup. Failed
drain retains quarantine; emergency revocation is not stop proof. Lost/
restored history/re-enrollment cannot manufacture fresh consumption.
Cleanup descriptor-anchored/no symlink/mount traversal/root recursive target
deletion. No permanent QA Agent service, Docker/OCI/Kubernetes requirement.

### 5.4 Closed product/broker compatibility identity

One authoritative closed record, exactly one per runner enrollment, no list
and no fallback entry:

| Key | Value / trusted source |
|---|---|
| schemaVersion | 1 |
| product | exactly {name:"qa-ai-agent",version}; version exact semver string<=64 ASCII, no range/tag |
| contractVersion | "qa-agent-controller-v1"; must equal the literal compiled into the broker artifact |
| brokerSha256 | H of the installed broker artifact bytes |
| profileDigest | H of enrollment qualification (§5.2/§11.1 domain) |

compatibilityDigest = H with domain "qa-ai-agent:execution-compatibility:v1:"
over this record (§11.1 encoding). Release approval (future, separate)
decides which records may exist; this design approves no pair.

Authority and persistence: the operator copies one release-approved record
into compatibility.json (§5.2 table) and its digest into enrollment
compatibilityDigest, as part of install/upgrade/requalification (§5.3).
Npm never writes either. Lookup key: none; the single record is read from
the fixed path and is the only candidate.

Broker validation (authoritative, before reservation, at §5.6.4 step C7,
after the C1a integrity/authentication gate has established enrollment and
artifact integrity): canonical record bytes
match enrollment compatibilityDigest; record contractVersion equals the
compiled literal; brokerSha256 equals the digest the broker computes over
its own fixed installed artifact (descriptor-opened, no-follow, §5.2 owner
checks); profileDigest equals the digest recomputed over the current
enrollment qualification; live host builds equal qualification. Then request
contractVersion and subject.product.{name,version} must equal the record
exactly. Trusted only from installed artifacts: compiled contract literal,
broker artifact digest, root-owned record/enrollment. Never trusted from the
request: broker digest, profile, qualification state, pair selection or any
"compatible" assertion; request carries only the two compared values.

Client check (early, advisory, not authority): before building the request,
the client opens the same fixed 0644 record, requires its own installed
package name/version and its compiled contract literal to match, and uses
record profileDigest when deriving bindingDigest (§11.1). It may hash the
0755 broker file for an early digest refusal. Client mismatch refuses before
broker invocation; a bypassed client check is still refused by the broker.

| Case | Outcome |
|---|---|
| Newer npm + older broker | product.version or contractVersion mismatch: client refuses; else broker REFUSED/INCOMPATIBLE, exit 5, before reservation |
| Older npm + newer broker | Same; no older-protocol mode |
| Wrong broker digest | Broker self-digest != record: every create REFUSED/INCOMPATIBLE; runner requalification |
| Wrong contractVersion | Record != compiled literal: runner ineligible; request != record: REFUSED/INCOMPATIBLE |
| Stale qualification | Recomputed profileDigest != record, or live builds != qualification: REFUSED/INELIGIBLE |
| Downgrade (npm or broker) | Pair mismatch refuses; only an operator re-enrollment of a release-approved record via §5.3 drain/requalify changes the pair; protected journal/tombstones written under a newer journal/contract version are not readable by an older broker: runner quarantine, never silent migration or consumption reset |

Every mismatch refuses before spawn; nothing is reserved or consumed, so the
request may be retried after operator remediation. Reconcile of existing
attempts uses the stored binding (§7) and is not blocked by a pair change
or by current workspace/root eligibility (§5.6.4).

### 5.5 Enrolled root non-overlap invariant

Canonical root identity = enrolled canonical absolute path after all §4.2/
§4.3 normalization (descriptor walk from "/", no symlink component, no '.'/
'..'/empty segment, no trailing slash) plus dev/ino of the root and of each
ancestor directory.

Mount invariant (W = enrollment workspace anchor, §5.2). Mount ID below is
the live statx(2) STATX_MNT_ID of the object as reached through the walk;
STATX_ATTR_MOUNT_ROOT marks a mount root. Mount IDs are never persisted,
because they are not stable across remounts or boots; each check compares
live values taken in the same broker invocation. For every enrolled root R:

M1. W's live path, dev and ino equal enrollment workspace; W is root-owned
    and not group/other-writable.
M2. R's canonical path is W + "/" + one or more segments; R != W.
M3. A descriptor walk from W to R, one segment at a time with no-follow and
    no-cross-mount resolution (openat2 RESOLVE_NO_SYMLINKS|RESOLVE_NO_XDEV
    or a qualified equivalent), succeeds. Every directory on the walk,
    including R, has the same mount ID as W; R does not carry
    STATX_ATTR_MOUNT_ROOT.
M4. R's live dev/ino equal its enrolled dev/ino, and R's dev equals W's dev.

Qualification requires the kernel to supply STATX_MNT_ID and
STATX_ATTR_MOUNT_ROOT plus no-cross-mount resolution. A host lacking any of
them is ineligible; there is no path-only or dev-only fallback.

Consequence: all enrolled roots of one runner are ordinary directories
inside the single mount that contains W. Within one mount, a directory has
exactly one path relative to the mount (Linux forbids directory hardlinks),
and any alias of a directory (bind mount, FUSE/bindfs, overlay or other
mount, including a mount placed on R itself) is a different mount and fails
M3. So two roots whose W-relative paths are not prefix-related denote
disjoint physical directory trees. Roots that need another filesystem need
a separately enrolled runner (with its own anchor); they never get a second
anchor here.

Roots A and B overlap iff any holds:

1. same canonical path bytes;
2. A + "/" is a byte prefix of B (A ancestor of B), or the converse;
3. A dev/ino equals B dev/ino or any ancestor dev/ino of B, or the converse
   (exact alias of the same directory; under M1–M4 this is redundant
   defence in depth).

Canonical comparison procedure, run at enrollment/requalification for the
candidate against every existing root, and run in P1 of every CREATE over
the whole persisted roots[] (<=64 roots, <=2016 pairs) before any create
eligibility decision and before any protected-store write (§5.6.4 step C4):
(a) M1 once, retaining the workspace descriptor dW it produces, then F1(W)
on dW (§5.6.2); (b) M2–M4 for each root, live, retaining the root
descriptor dR produced by its M3 walk, then F1(R) on dR; (c) overlap rules
1–3 pairwise on canonical path bytes and live dev/ino. Any failure is a
violation. dW and every dR are retained for the rest of the invocation;
all later workspace/root access is openat-relative to them, with no path
re-resolution; the P1S M1–M4 re-walk (§5.6.4) is a check-only comparison,
never access. RECONCILE does not run this procedure (§5.6.4). Two enrolled roots MUST NOT overlap or violate
M1–M4. A violating candidate is REFUSED at enrollment, with no coexistence
or priority rule. A persisted violation (overlap, mount alias, mount-root
root, changed anchor, or a live identity no longer matching enrollment) makes
runner qualification fail closed: every create REFUSED/INELIGIBLE exit 5,
nothing reserved, no root silently selected. Operator remediation edits
enrollment and requalifies. A violation never gates RECONCILE: reconcile of
existing attempts remains permitted under their stored binding (§7,
§5.6.4) and never creates reservation/start authority.

Target identity = (rootDigest, canonical PPI-1 relative path) plus live
dev/ino. Execution opens beneath the retained root descriptor dR with no
symlink and no mount crossing (§4.3 item 2), and targets/fingerprint files
require regular files
with link count 1 (§8.1 item 6). So a mount placed inside a root after
enrollment and a hardlink both refuse, and neither can expose one physical
file under two roots. PPI-1 canonical form admits one spelling per path.
With M1–M4 and disjoint roots, root claims (one active attempt per root) and
consumed keys (§11.2, both over rootDigest) refer to disjoint physical
subtrees. One physical spec therefore cannot obtain two independent
execution/root claims or two consumption identities through two enrolled
roots.

### 5.6 Host namespace, filesystem and workload-storage trust (C3)

Terminology: elsewhere in §§4–7 "namespace" means the systemd unit-name
namespace qa-agent-exec-v1-*; this section concerns Linux kernel namespaces.
Every check here is a live broker-side check. No request field, enrollment
claim, caller environment or client result supplies or relaxes it, and none
has a fallback. Order and applicability are normative in §5.6.4. Every
check here runs after the §4.3 item 1 integrity/authentication gate (C1a
for CREATE, R1a for RECONCILE); W2 depends on the integrity-checked
enrollment fsType. For
CREATE, all of N1–N6, F1–F4 and W1–W6 MUST pass before the reservation
commit, in this order: the descriptor-independent checks (N1–N6, F2, W1,
W2, W4, the W3 size bound and the W5 structural part) precede any
protected-store write, §5.5
walk, manager call or cgroup read; F1 is not descriptor-independent and runs
on the descriptors produced by the §5.5 M1/M3 walk, before any
protected-store write; the W3 free-space part and the journal-dependent W5
binding part run after recovery/reconciliation and still precede the
reservation commit. All are repeated in the P1S recheck (§6.4). For
RECONCILE only N1–N6, F2 and the leaf-access subset of §5.6.3 (W1, W2, W4)
apply; F1, W3, W5 and the §5.5 procedure do not. CREATE failure before the
reservation commit is REFUSED/INELIGIBLE exit 5 with nothing reserved or
spawned. RECONCILE failure of N1–N6 or F2 is REFUSED/INELIGIBLE with no
journal write or manager action, leaving the attempt for a later reconcile.
Failure inside P1S is the consumed EXECUTION_ERROR PRESUBMIT_FAILURE exit 7
of §6.4.

#### 5.6.1 Mount and cgroup namespace identity

N1. PID1 anchor. The broker opens /proc descriptor-anchored, no-follow. It
    must be procfs (fstatfs PROC_SUPER_MAGIC) and a mount root. The
    authenticated host manager (§4.3 item 6; owner of org.freedesktop.systemd1
    on the system bus) must be PID 1 in the broker's PID namespace: the bus
    connection credentials' process identity (a pidfd where the qualified bus
    supplies one, or an equivalently qualified kernel primitive) resolves to
    PID 1 in the broker's view, and /proc/self/ns/pid and /proc/1/ns/pid have
    equal nsfs inode identity. A container or child-namespace init cannot
    serve as the anchor.
N2. Broker mount namespace == PID1 mount namespace: /proc/self/ns/mnt and
    /proc/1/ns/mnt, both opened beneath the N1 descriptor, have equal st_dev
    and st_ino (nsfs inode identity), or an equivalently qualified kernel
    primitive proves the same identity.
N3. Broker cgroup namespace == PID1 cgroup namespace: the same comparison
    for /proc/self/ns/cgroup and /proc/1/ns/cgroup.
N4. The broker never calls setns, unshare, chroot, pivot_root or mount, so
    N1–N3 hold for the rest of the invocation; they are still re-run in the
    P1S recheck.
N5. Authenticated cgroup-v2 anchor = the cgroup2 hierarchy as seen from the
    initial (PID1) cgroup namespace. After N2/N3 the broker opens
    /sys/fs/cgroup once per invocation, descriptor-anchored and no-follow,
    and requires fstatfs CGROUP2_SUPER_MAGIC, STATX_ATTR_MOUNT_ROOT,
    root:root ownership, and /proc/1/cgroup and /proc/self/cgroup each
    consisting of exactly one unified "0::" line (no v1 or hybrid hierarchy).
    The manager-derived ControlGroup (§11.1 cgroupPath) is interpreted only
    beneath this anchor descriptor. Every cgroup.events read (§6.3/§7.3) and
    the cgroupDev/cgroupIno readback are openat2 from that one descriptor
    with RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_XDEV, so validation
    and use share one view. Within an invocation, a later read whose live
    dev/ino differs from the recorded controller cgroupDev/cgroupIno is an
    identity failure (§7.3 controller failure / QUARANTINED), never empty
    proof.
N6. Mismatch, or a missing nsfs, pidfd-equivalent, procfs or cgroup2
    primitive: INELIGIBLE. No path-only, PID-number-only, mountinfo-only,
    environment or "assume host" fallback. Qualification requires these
    primitives.

Consequence: §5.5 walks, §5.6.2/§5.6.3 checks, manager calls and empty proofs
all use the host (PID1) mount and cgroup views. A broker started inside a
private mount or cgroup namespace is refused before reservation, so it
cannot produce a false populated=0, mount or filesystem proof. Future Stage 5
vectors are in §12 (C3).

#### 5.6.2 Trusted local filesystem

Allowlist L is the project's existing Stage 4 storage allowlist
([stage4-principal.js](../scripts/ai/cli/stage4-principal.js)
assertStorageEligibility), by statfs f_type: ext4 0xEF53, XFS 0x58465342,
Btrfs 0x9123683E, F2FS 0xF2F52010. This design does not extend it. Every
other type is ineligible, including FUSE, NFS, CIFS/SMB, 9p, overlay, tmpfs
and any unknown or remote type.

F1. Workspace anchor W: fstatfs on the workspace descriptor dW produced by
    the §5.5 M1 step is in L. Each enrolled root R, which is on W's mount by
    M3, has an fstatfs type, taken on the root descriptor dR produced by its
    §5.5 M3 walk, equal to W's. F1 therefore runs inside the §5.5 procedure
    (§5.6.4 step C4), never before it. It MUST pass for every CREATE before
    any protected-store write and before reservation/start; RECONCILE does
    not evaluate it.
F2. Controller durable state /var/lib/qa-agent-controller-v1: fstatfs on the
    descriptor opened for the protected store is in L, in addition to the
    existing directory-fsync durability requirement. It is checked before any
    protected-store read is trusted or any write is made.
F3. Timing: at enrollment/requalification; in P1 of every CREATE (F2 at
    §5.6.4 step C3, F1 at step C4) and of every RECONCILE (F2 only, step R3),
    before reservation or any journal write; and again in the CREATE P1S
    recheck together with §5.5. Each check uses the same descriptor as the
    subsequent openat-relative use (dW/dR for F1, the protected-store
    descriptor for F2), with no path re-resolution between check and use;
    the P1S §5.5 re-walk is check-only substitution detection (§5.6.4) and
    its descriptors are never used.
F4. No caller-controlled trust: enrollment carries no filesystem-type claim
    for W or the state location, the request carries none, and §4.3 item 2
    "storage" denotes F1–F2. A live W or root type outside L (F1) makes
    every CREATE INELIGIBLE until operator remediation and requalification
    and never blocks RECONCILE; a live state type outside L (F2) makes CREATE
    and RECONCILE INELIGIBLE. F2 failure permits no protected-store write.

f_type identifies the filesystem driver, not the honesty of the backing
device; that is the same limit as Stage 4 storage eligibility (lying storage
remains R-3), not a new acceptance.

#### 5.6.3 Bounded workload storage

This replaces the former workload-writable shared /run parent; there is no
fallback to /run. Mount point B = /var/lib/qa-agent-workload-v1, a literal
compiled into the broker and never selected by enrollment, request or
environment. Leaf parent B/workloads; attempt leaf `B/workloads/<executionId>`.

Provisioning (operator, root-owned, §5.3; npm never provisions): a dedicated
filesystem used only for QA Agent workload storage (partition, logical volume
or fully preallocated image), of a type in L restricted to ext4, XFS or F2FS
(Btrfs is excluded because subvolume/pool accounting cannot prove a dedicated
bound). It is mounted at B read-write with nosuid,nodev. B is root:root 0755;
B/workloads is root:root 0711; B contains no entries other than workloads and,
for ext4 only, a root-owned 0700 lost+found. The operator records
qualification.workloadStorage (§5.2), which profileDigest and the §5.4
record cover; any change requires requalification.

Live qualification proof, run by the broker at enrollment, in CREATE P1
before reservation and again in P1S before leaf creation (RECONCILE applies
only the leaf-access subset below, §5.6.4):

W1. Identity: B opened descriptor-anchored and no-follow carries
    STATX_ATTR_MOUNT_ROOT. The host mount table, read under §5.6.1 (equal
    mount namespace), has exactly one mount of B's filesystem (major:minor),
    with root "/" and mount point B: no bind/subtree alias, and not exposed at
    another path. B's st_dev differs from that of "/", W and the controller
    durable-state location.
W2. Type: fstatfs f_type equals the magic of the enrolled fsType and is in L.
W3. Size: 0 < f_blocks × f_frsize <= maxBytes (explicit finite bound), and
    f_bavail × f_frsize >= minFreeBytes.
W4. Options: f_flags include ST_NOSUID and ST_NODEV, and not ST_RDONLY.
W5. Ownership and purpose: B and B/workloads owners/modes and B's entries
    exactly as above. B/workloads holds <=512 entries, each a 32-hex
    executionId directory bound to a protected attempt; an unknown or unbound
    entry is INELIGIBLE and is never deleted on sight. Normative ordering
    exceptions: the binding part of W5 needs the protected journal, and the
    W3 free-space part MUST observe space freed by pre-create
    reconciliation, so both MUST run after F2, protected-store recovery and
    the §7 pre-create reconciliations (§5.6.4 step C6) and MUST still
    precede the reservation commit; all other checks of this section (W1,
    W2, W4, W3 size bound and the W5 structural part: owners, modes, B
    entries, leaf count and names) MUST precede any protected-store read
    (step C3).
W6. Any failure, including B unmounted (an empty underlying directory):
    INELIGIBLE before reservation (PRESUBMIT_FAILURE in P1S). There is no
    fallback to /run, /tmp, HOME, W or any other location.

Write access: the broker creates the leaf (runner-owned 0700) and its home,
tmp and reports subdirectories (runner-owned 0700) with mkdirat/fchownat
relative to the B/workloads descriptor, using RESOLVE_BENEATH|
RESOLVE_NO_SYMLINKS|RESOLVE_NO_XDEV. The runner can write only inside its own
leaf; B and B/workloads are neither writable nor listable by it. HOME, TMPDIR
and reportsDir are leaf/home, leaf/tmp and leaf/reports. Broker-built paths
and broker operations never leave B, and a mount below B refuses
(RESOLVE_NO_XDEV).

Cleanup and quarantine: P6 removes a leaf only after terminal commit and
empty proof, descriptor-anchored, no-follow, never crossing out of B, with a
bounded amount of work per invocation. Removal not finished within P6 (or
the remaining A of a later P1) leaves the leaf for the next P1; claim rules
are unchanged. Quarantined or unproven-empty attempts keep their leaf until
operator incident resolution. Retained leaves can consume only B; once W3
free space fails, every create is INELIGIBLE until operator remediation.
Leaf count is bounded by W5 and the §7 limit of 256 incomplete attempts.
RECONCILE does not evaluate W3 or W5 (it is how space is recovered); before
accessing or removing an existing leaf it MUST pass W1, W2 and W4, and if
they fail it finalizes the attempt without accessing or removing the leaf,
which stays for operator remediation (§5.6.4 step R6).
Exhausting B makes the affected attempt's writes fail (EXECUTION_ERROR or
RESULT_INVALID, never PASS); it cannot consume host /run, the root
filesystem, W or the protected state.

The §9.2/§9.4 report, path and accounting limits are unchanged; B's bound is
an additional host-resource bound, not a product quota. The design grants no
writable location outside B. Host locations the runner account can already
write independently of this design (for example world-writable /tmp or
/dev/shm) remain the account's pre-existing authority under R-5, not
design-granted workload storage.

#### 5.6.4 CREATE and RECONCILE check order (C4, normative)

This subsection is the single normative order for §4.3 items 1 and 8,
§5.4 broker validation, §5.5, §5.6 and §6.4; other sections refer to it and
MUST NOT be read as reordering it.

CREATE (P1, then P1S):

C1. P0 intake succeeds (§6.4).
C1a. §4.3 item 1 integrity/authentication gate, first step of P1 and
    before any enrollment-dependent or caller-dependent operation: broker
    artifact integrity, enrollment and compatibility.json integrity
    (descriptor-opened, no-follow, §5.2 owners/modes, strict enrollment
    schema), effective root, zero argv and the authenticated caller from
    the qualified sudo context (§5.1) equal to enrollment caller
    {uid,gid,account}. It is read-only: no protected-store read or write, §5.5 walk,
    manager call or cgroup read. Nothing from enrollment (caller,
    workspace, roots, qualification, workloadStorage, profileDigest) and no
    caller ownership is trusted before C1a passes. The protected-state
    integrity part of item 1 is F2 (C3) plus transaction recovery (C5); the
    §5.4 compatibility/pair part of item 1 is C7.
C2. N1–N6 (§5.6.1).
C3. Descriptor-independent storage checks: F2 on the protected-store
    descriptor before any protected-store read is trusted; W1, W2, W4, the
    W3 size bound and the W5 structural part on the B descriptor.
C4. §5.5 comparison procedure over workspace and roots[] of the
    enrollment integrity-checked at C1a (§4.3 item 1, §5.2): M1 produces dW, then
    F1(W) on dW; M2–M4 for each root, M3 producing dR, then F1(R) on dR;
    overlap rules 1–3. dW and every dR are retained; all later
    workspace/root access (§4.3 item 2,
    §8.1 target and fingerprint opens) is openat-relative to them with no
    path re-resolution.
C5. Protected-store transaction recovery, the §7 pre-create reconciliations
    (each with the RECONCILE semantics R4–R7 below) and the unit-namespace
    scan.
C6. W3 free-space part and W5 binding part.
C7. Locks/claims, only the §5.4 compatibility/pair part of §4.3 item 1
    (record bytes vs enrollment compatibilityDigest, compiled contract
    literal, broker self-digest, recomputed profileDigest, request
    contractVersion/product; C1a is not repeated here), §4.3 items 3–6,
    qualification, launch-size checks, remaining-A check and the
    reservation commit (item 7 belongs to P2).
P1S. N1–N5, F2, W1–W5; the §5.5 M1–M4 re-walk, whose results MUST equal the
    retained dW/dR by dev/ino and mount ID; F1 on the retained dW/dR; then
    the remaining §6.4 P1S steps. The re-walk is an intentional check-only
    path re-resolution that detects workspace/root substitution since C4;
    its descriptors are used only for that comparison and then closed.
    The no-path-re-resolution rule of C4/§5.5/F3 governs authoritative
    use: target, fingerprint and every other workspace/root access keeps
    using the retained dW/dR, never the re-walk results.

Any failure in C1a is REFUSED before reservation with the existing
pre-start outcome for that check (§5.2 authority exit 5/input 4/config 3;
§5.1 absent/ambiguous/direct-root context refuses), with no protected-store
read or write, manager call or cgroup read.
Any failure in C2–C4 is REFUSED/INELIGIBLE exit 5 with no protected-store
write: no recovery, reconciliation, journal entry, claim or tombstone, and
nothing reserved, spawned or consumed. Failure in C5–C7 is REFUSED before
the reservation commit (§6.4); reconciliations already committed in C5
stand. Failure in P1S is the consumed PRESUBMIT_FAILURE exit 7.

RECONCILE (separate invocation, rule (a)): reconcile is recovery and
finalization of an existing attempt, never new execution authorization.

R1. P0 intake succeeds.
R1a. The C1a §4.3 item 1 integrity/authentication gate, without the §5.4
    compatibility/pair part and without the enrollment enabled flag (§5.4,
    §7: a pair change or disabled enrollment never blocks reconcile):
    broker artifact, enrollment and compatibility.json integrity, effective
    root, zero argv and the authenticated caller equal to enrollment caller
    {uid,gid,account}. Read-only; failure is REFUSED as in C1a with no
    protected-store read or write, journal write or manager action,
    leaving the attempt for a later reconcile. No caller identity, caller
    ownership, attempt ownership, enrollment identity or protected attempt
    lookup is used before R1a passes.
R2. N1–N6. Failure: REFUSED/INELIGIBLE, no journal write, no manager action.
R3. F2 on the protected-store descriptor. Failure: as R2.
R4. Protected-store transaction recovery; the attempt for the requested
    executionId is read from the protected journal; the caller authenticated
    at R1a must own it (§7). The immutable stored attempt and controller binding (rootDigest,
    unit name, invocation, boot, cgroup identity, leaf executionId) is the
    only source of identity. No current enrollment workspace/root value is
    consulted to identify, select or widen it.
R5. §7 Cases A–H against the host manager and the N5 cgroup anchor.
R6. Leaf: before accessing or removing `B/workloads/<executionId>`, W1, W2
    and W4 MUST pass on the B descriptor, and the leaf is opened relative to
    the B/workloads descriptor with RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|
    RESOLVE_NO_XDEV. On failure the attempt is finalized without accessing or
    removing the leaf, which stays for operator remediation.
R7. Terminal commit and claim release per §7.

RECONCILE opens no workspace or root descriptor and does not evaluate F1,
the §5.5 procedure, W3, W5 or §4.3 items 3–5. It never writes a reservation, new claim, PREPARED or SUBMITTING entry and never
calls StartTransientUnit; it cannot grant reservation/start authority, and
any later create needs the complete CREATE order. Its outcome is a function
of the protected journal, the stored binding and live manager/cgroup/leaf
facts only, so current workspace/root validity cannot change it.

| Current condition | CREATE | RECONCILE of an existing attempt |
|---|---|---|
| §4.3 item 1 gate fails (artifact/enrollment/compatibility.json integrity, effective root, argv, caller authentication) | REFUSED at C1a before reservation; no protected-store read or write | REFUSED at R1a; no protected-store read or write, journal write or manager action; attempt left for a later reconcile |
| §5.4 compatibility/pair mismatch | REFUSED/INCOMPATIBLE or INELIGIBLE exit 5 at C7, before reservation | Not evaluated |
| F1 fails, or §5.5 M1–M4/overlap violation | REFUSED/INELIGIBLE exit 5 at C4; no protected-store write; nothing reserved/consumed | Permitted; deterministic Cases A–H under the stored binding, same outcome as with valid roots |
| N1–N6 or F2 fails | REFUSED/INELIGIBLE exit 5 | REFUSED/INELIGIBLE; no journal write or manager action; attempt left for a later reconcile |
| W1, W2 or W4 fails | REFUSED/INELIGIBLE exit 5 at C3 (P1S: PRESUBMIT_FAILURE 7) | Finalized without accessing or removing the leaf |
| W3 size bound or W5 structural part fails | REFUSED/INELIGIBLE exit 5 at C3 (P1S: PRESUBMIT_FAILURE 7) | Not evaluated |
| W3 free space or W5 binding part fails | REFUSED/INELIGIBLE exit 5 at C6 (P1S: PRESUBMIT_FAILURE 7) | Not evaluated |

## 6. Fixed service, identity and finite lifecycle

### 6.1 Complete property construction

StartTransientUnit(name,"fail",properties,[]) on host manager only.
No aux/scope/start-then-attach/replacement/generic updates. Protected sole
creator plus claims/preexistence checks enforce collision refusal, never
kill unknown name. [v256 service setter](https://raw.githubusercontent.com/systemd/systemd/v256/src/core/dbus-service.c),
[execution setter](https://raw.githubusercontent.com/systemd/systemd/v256/src/core/dbus-execute.c)
and [service semantics](https://raw.githubusercontent.com/systemd/systemd/v256/man/systemd.service.xml)
evidence API shapes, not qualified builds.

Complete D-Bus payload allowlist, broker-built; unsupported/extra REFUSE:

| Property | Signature | Fixed value |
|---|---|---|
| Type / ExitType / Restart | s each | exec / cgroup / no |
| ExecStart | a(sasb) | one (fixed broker path,[fixed broker path,"--workload-v1"],false), no privilege prefixes |
| ExecStartPre / ExecStartPost / ExecStop / ExecStopPost / ExecReload | a(sasb) each | [] |
| WorkingDirectory | s | independently validated enrolled canonical root |
| User / Group | s each | enrolled nonzero numeric UID/GID decimal |
| SupplementaryGroups | as | []; effective account groups still must be qualified/nonprivileged |
| DynamicUser / SetLoginEnvironment | b each | false |
| NoNewPrivileges | b | true; workload cannot acquire sudo broker authority |
| CapabilityBoundingSet / AmbientCapabilities | t each | 0 |
| Delegate / RemainAfterExit | b each | false |
| KillMode | s | control-group |
| KillSignal / FinalKillSignal | i each | 15 / 9 |
| SendSIGKILL | b | true |
| RuntimeMaxUSec | t | timeoutMs * 1000 |
| RuntimeRandomizedExtraUSec | t | 0 |
| TimeoutStartUSec / TimeoutStopUSec | t each | 30000000 |
| TimeoutStartFailureMode / TimeoutStopFailureMode | s each | terminate |
| NotifyAccess | s | none |
| CollectMode | s | inactive; failed facts retained until recorded/reset |
| Environment / PassEnvironment / UnsetEnvironment | as each | [] |
| EnvironmentFiles | a(sb) | [] |
| StandardInputFileDescriptor | h | broker-created sealed anonymous launch-envelope memfd |
| StandardOutputFileDescriptor / StandardErrorFileDescriptor | h each | broker-created pipe write ends |
| LimitCORE / LimitCORESoft | t each | 0 |

No dedicated slice; qualified system.slice/one protected domain per service.
Slice omitted/not caller selectable. Effective critical defaults must match
qualification: dependencies/no alias/drop-in/hooks/restart forcing/PAM/
credential load/delegation/executable changes. Unknown default -> refuse.
No further writable property extension/sandbox/quota claim.

Native artifact/libraries protected; manager default env cannot inject unsafe
loader values before native workload clearenv. Workload imports no target code
until exact §9 env installed. Secrets never in Environment/StandardInputData/
credential properties/argv/transient settings/core/debug/journal. Real host
FD/no-log/UID qualification mandatory; workload root refusal supplements User.

### 6.2 Unit and launch identity

Name exactly qa-agent-exec-v1-<executionId>.service, whole-string
^qa-agent-exec-v1-[0-9a-f]{32}\.service$. Protected attempt binds root/package/
principal/manager boot/InvocationID/transient flag/cgroup path/dev/inode/
properties digest. Recreated name/changed boot not original invocation.
Reservation before send, collisions consume attempt/no ID bypass/no reuse.
RefUnit held while attached, facts durable before UnrefUnit. Bounded
namespace enumeration before create; unknown member quarantines runner,
no wildcard kill. Lookup protected attempt -> exact unit -> full binding.

Type=exec proves bootstrap only. STARTED requires broker observation of
manager-bound MainPID UID/executable/cgroup matching qualified Node for
this invocation. PID observation never termination fallback. Missing/
fast-raced launch proof -> error even zero exit; report cannot prove launch.
Qualification covers fast workloads without relaxing proof.

### 6.3 Timeout, whole-tree kill and empty proof

T integer1000..600000/default600000 target config only; no extension/reset.
RuntimeMaxUSec active-runtime bound. Separate phase budgets are in §6.4;
no single request-to-observation bound covering pre-create recovery is
claimed. Reconcile <=60000 stop/confirmation +5000 intake, bounded manager
calls.

Allowed methods after protected ownership check only: GetUnit,
ListUnitsByPatterns read-only enumeration, Properties.GetAll closed fields,
RefUnit/UnrefUnit, StopUnit(name,"fail"), KillUnit(name,"all",9) escalation,
ResetFailedUnit(name) only after durable terminal/empty proof. Returned
object/job binds exact manager/name; no caller signal/job/unit/cgroup/object/
SetUnitProperties/Restart/Enable/Link/AttachProcesses.

Stop closes admission, control-group SIGTERM, full-unit SIGKILL by30000 ms,
empty confirmation within30000 ms. Qualified manager proves nested groups/
forks covered; leader-only build ineligible. No raw cgroup writer/shell/
PID/process-group fallback. Root-owned cgroup.events read only through the
§5.6.1 N5 cgroup-v2 anchor (host PID1 mount/cgroup namespaces):
populated=0 + manager terminal + no start/restart job + admission/migration
closed. Removal needs authenticated retained terminal binding and qualified
removal guarantee/no jobs/recreated unit; reboot requires old-boot extinction/
protected journal continuity/clean namespace. ENOENT/leader/ack insufficient.
Uninterruptible tasks may survive; finite escalation, not guaranteed finite
extinction. Failure QUARANTINED7/claims retained. Timeout8 only exact manager
timeout/invocation/deadline +empty/durable cleanup; local expiry/cancel/
signal/missing proof error7. No immediate parent-death guarantee.

### 6.4 Phase budgets

All clocks monotonic, same boot, never renewed by polling or frames. Each
phase has its own origin and finite bound; none is borrowed from another.

| Phase | Origin | Bound / enforcer | Exhaustion |
|---|---|---|---|
| P0 intake | Broker process start | <=5000 ms request frame read/validate (§4.2) | REFUSED/SCHEMA_INVALID, nothing reserved |
| P1 recovery/admission | Broker monotonic immediately after P0 succeeds, before any pre-create recovery | A=120000 ms global hard deadline, broker | Before reservation commit: REFUSED/RECOVERY_BUDGET_EXHAUSTED exit 5, no reservation/spawn |
| P1S pre-submit | Broker monotonic immediately after the reservation transaction COMMITTED marker is fsynced (durable PREPARED, submission NOT_SENT) | S=30000 ms global hard deadline, broker; checked before each step and immediately before the SUBMITTING write | Consumed: PREPARED -> EXECUTION_ERROR PRESUBMIT_FAILURE exit 7, emptyBy=not-submitted, nothing sent |
| P2 start | Durable SUBMITTING | TimeoutStartUSec 30000 ms (manager) + readback to durable STARTED | START_FAILURE error7 after P4 |
| P3 execution | Manager ActiveEnterTimestampMonotonic of this invocation | T via RuntimeMaxUSec (manager) | HARD_TIMEOUT path (§6.3), then P4 |
| P4 termination/empty | Deadline, natural deactivation, or stop decision | <=30000 ms stop/SIGKILL + <=30000 ms empty confirmation | QUARANTINED7 if empty unproven |
| P5 result | EXITED frame written (§7.2) | R=60000 ms for proposal receipt; broker validation bounded by §9.4 byte limits | OBSERVATION_EXPIRED error7 |
| P6 commit/release | Terminal decision | Bounded fsync + RefUnit/ResetFailedUnit/UnrefUnit + leaf removal | Commit failure: §7.4; release failure: claims retained, next P1 |

P1 covers, in the CREATE order of §5.6.4: first the §4.3 item 1
integrity/authentication gate (C1a: artifact/enrollment/compatibility.json
integrity, effective root, zero argv, authenticated enrolled caller);
then the descriptor-independent
§5.6 checks (N1–N6, F2, W1, W2, W4, W3 size bound, W5 structural part);
then the §5.5 comparison procedure with F1 on its retained dW/dR; then
protected-store transaction recovery, all prior incomplete-root
reconciliations and the runner unit-namespace scan (§7); then the W3
free-space and W5 binding checks; then locks/claims, the §5.4
compatibility/pair part of item 1, qualification checks (root access only through the
retained dW/dR), controller eligibility, launch-size checks and the
reservation commit. A separate RECONCILE invocation follows only the
§5.6.4 reconcile order (R1a authentication before any caller/attempt
ownership) within its §6.3 bound and never reaches a
reservation commit. Up to 256 reconciliations
share A: each manager wait is bounded by min(its §6.3 allowance, remaining A);
no per-item timeout is multiplied by the item count. Each reconciled attempt
commits individually, so abandoning work at A leaves durable, consistent
states (marked ORPHANED or untouched) that the next P1 or reconcile resumes.
Remaining-A is checked immediately before the reservation commit; past it,
REFUSED and no claim/tombstone is written, so the unconsumed request may be
retried later.

P1S is the only interval between P1 and P2; P1 ends and P1S begins at the
same durable reservation commit, and P1S ends exactly when SUBMITTING is
fsynced (P2 origin), so every instant from reservation through submission
is inside a bounded phase. During all of P1S the durable state is PREPARED
with submission NOT_SENT; no D-Bus call is made. P1S covers, in order: the
ACCEPTED frame write (§7.2), the client-liveness check, the §5.6 recheck
(N1–N5, F2, W1–W5, and F1 on the retained dW/dR with the §5.5 re-walk
identity comparison of §5.6.4; the re-walk is check-only substitution
detection, its descriptors are never used for target access), descriptor-anchored creation of the attempt leaf and
its home/tmp/reports directories on the bounded workload mount (§5.6.3, §9.1),
launch-envelope construction and sealing, the mandatory post-reservation
recheck (§4.3 item 4, §8.1 item 7: root/apply/framework binding, exact
target bytes, fingerprint fresh bytes, qualified Node/native/profile, §5.4
compatibility and §5.5 root/mount rule against the retained dW/dR,
launch-size bounds), the
propertiesDigest computation, and the SUBMITTING write.

Outcome inside P1S: the reservation is already durable, so pre-reservation
REFUSED semantics never apply and the attempt is consumed (tombstones
retained, no retry, no reset). Recheck failure, any step failure or S
exhaustion: the broker writes terminal EXECUTION_ERROR reason
PRESUBMIT_FAILURE with cleanup emptyBy=not-submitted (protected NOT_SENT
plus no-send/no-unit/clean-namespace proof, §11.1), fsyncs it and sends
TERMINAL; synchronous exit 7. If that no-send proof fails, the outcome is
QUARANTINED 7. Client loss in P1S is CLIENT_LOST 7 with the same cleanup
(§7.4 S1). Broker crash in P1S leaves PREPARED/NOT_SENT; the next P1 or
reconcile applies Case E: protected NOT_SENT plus no-unit/clean-namespace
proof -> EXECUTION_ERROR PRESUBMIT_FAILURE 7, otherwise QUARANTINED 7. A
crash after the SUBMITTING write is P2/S2 (§7.4), never P1S. PRESUBMIT_FAILURE
cannot reach OBSERVED, PASSED or TEST_FAILED.

Synchronous create observation is P0+P1+P1S+P2+P3+P4+P5+P6:
<=5000+120000+30000+30000+T+60000+60000 ms plus commit/release I/O. Kernel
storage stalls (fsync) are not abortable; a host whose storage stalls fails
qualification, and no hard real-time bound is claimed for them. Client
pre-broker §8.1 verification is bounded by input/size limits, not timed,
and precedes P0. Work left after a broker crash, P1 exhaustion, P6 release
failure or quarantine needs a later reconcile/next P1 and is not part of
any synchronous bound.

## 7. Protected ownership and bounded reconciliation

Broker alone writes protected host store. Root/package/ID order; short
runner admission lock serializes namespace/reservation only. One active
per root/all runs, independent roots concurrent; no stale-PID stealing.
Roots are canonical and pairwise non-overlapping (§5.5), so claims and
consumed keys never alias one physical target through two roots.
Consumed tombstones indexed BOTH root+run+ordinal AND root+packageDigest+
applyRecordId, independent of product version. New ID/upgrade/reboot/copied
ledger/deleted target evidence never resets or authorizes retry.

Recoverable transaction: fsync intent, PREPARED/claims/tombstones/data/
directories, committed marker/fsync. Partial intent blocks root; no start
before complete. SUBMITTING/fsync before D-Bus, no uncertain resubmit.
Readback/fsync CONTROLLER_BOUND; terminal+empty/fsync before claim removal/
fsync. Tombstones retained; crash during release recovered before admission.

Durable root claims exclude competing creates, not recovery calls. Short
per-attempt operation locks serialize journal transitions/manager actions,
never held across lifecycle waits. Reconcile durably marks an incomplete
attempt ORPHANED and closes admission before stop; attached create observes
the transition and cannot accept late PASS. One terminal writer wins;
others return committed record. Cancellation needs no lifetime mutex.

| State | Allowed successor |
|---|---|
| PREPARED | SUBMITTING, ORPHANED, EXECUTION_ERROR, QUARANTINED |
| SUBMITTING | CONTROLLER_BOUND, ORPHANED, EXECUTION_ERROR, QUARANTINED |
| CONTROLLER_BOUND | STARTED, ORPHANED, EXECUTION_ERROR, QUARANTINED |
| STARTED | OBSERVED, EXECUTION_ERROR, ORPHANED, QUARANTINED |
| OBSERVED | PASSED, TEST_FAILED, TIMED_OUT, EXECUTION_ERROR, ORPHANED, QUARANTINED |
| ORPHANED | EXECUTION_ERROR, proven TIMED_OUT, QUARANTINED |
| PASSED / TEST_FAILED / TIMED_OUT / EXECUTION_ERROR | Terminal consumed, no successor/retry |
| QUARANTINED | Terminal/claims retained; separate incident may clear quarantine, never revive/rewrite attempt |

No COMPLETED. OBSERVED = framework process completion plus whole-tree empty
proof durably recorded (observation and cleanup non-null), awaiting result;
PASSED/TEST_FAILED only from OBSERVED with an accepted proposal. Broker
lifecycle-only, never parses target reports (it enumerates/hashes report
bytes opaquely, §9.4). Attached client supplies the §7.2 proposal after
non-root parsing; broker cross-checks process/binding/structure/report
accounting and commits. Lost proposal/client death -> error; incomplete
report/exit never reconstructed PASS. Valid
durably committed terminal result returns as recorded; later inconsistency
separate quarantine incident, not success rewrite.

<=256 incomplete attempts/runner, <=64 roots, <=256 namespace units,
<=16777216 persisted bytes/attempt; capacity exhausted refuses.
Tombstones/history never silently pruned. Before create <=256 fixed-ID
reconciliations, all inside the single global P1 budget A (§6.4), never a
per-item timeout multiplied by count; no daemon/recovery promise while no caller/
operator returns. Systemd runtime independent. Lost/corrupt history runner
quarantine. Recovery caller, authenticated by the §4.3 item 1 gate before
any attempt lookup (§5.6.4 C1a/R1a), must own protected attempt; stored binding
governs even if enrollment disabled or current workspace/root eligibility
fails (§5.6.4), config cannot widen old authority.

| Case | Finalization / retry / cleanup / synchronous exit |
|---|---|
| A incomplete ACTIVE/activating/deactivating | ORPHANED; stop/kill/empty ->error7 or proven timeout8; no retry; failure H |
| B incomplete FAILED | Error7/proven timeout8; FAILED insufficient; drain/finalize/no retry; ambiguity H |
| C incomplete INACTIVE | Unknown error7; exact timeout permits8; inspect jobs/population/finalize/no retry; failure H |
| D incomplete missing | Removal/reboot proof ->error7, never PASS/missing-unit timeout; otherwise H/no retry |
| E crash before framework | PREPARED/NOT_SENT (P1S, §6.4): no-send/no-unit proof -> error7 PRESUBMIT_FAILURE, else H; SUBMITTING uncertainty A–D; consumed without launch/no retry |
| F crash after framework | Manager independent deadline/later A–D; no immediate death-kill/report PASS/no retry |
| G timeout during absence | Retained exact deadline/timeout+empty/durable ->8; otherwise error/H/no retry |
| H stop/cleanup/identity fails | QUARANTINED7/root claims; runner quarantine if ambiguous ownership; operator exact drain/no retry |

Reconcile all prior incomplete root attempts and scan runner unknown namespace
before creates. Already quarantined retains claims until separate operator
incident resolution; replay never revived. Dead client returns no exit.

### 7.1 Identity handoff

| Identity | Source / generation | Handoff |
|---|---|---|
| executionId | Client: 128-bit OS CSPRNG, 32 lowercase hex | CREATE/RECONCILE request; broker validates grammar and non-reuse (journal, tombstones, namespace); echoed in every broker frame |
| unitName | Derived "qa-agent-exec-v1-"+executionId+".service" (§6.2) | Both sides derive; ACCEPTED carries it and the client compares; never accepted as input |
| Attempt / journal identity | No separate attempt ID: attempt key = executionId; entry identity = (executionId, sequence, journalDigest), produced by broker (§11.2) | attemptDigest = journalDigest of the entry backing each broker frame |
| bindingDigest | Client computes (§11.1, profileDigest from the §5.4 record); broker reconstructs independently | CREATE; mismatch REFUSED/INPUT_MISMATCH; echoed in proposal |
| invocationId | systemd manager InvocationID of this started unit, broker readback (§4.3 item 7) | First present in BOUND, constant afterwards; required in proposal |
| controller record | Broker readback/derivation (§11.1) | Durable journal and terminal record only; the client needs none of it before TERMINAL |
| observation | Broker from manager facts (§7.3) | EXITED frame, journal OBSERVED, record |

An identity in any frame must have appeared in an earlier frame of the same
invocation or be derived by a rule above from already bound facts; any
other identity value is a protocol violation (§7.2).

### 7.2 Closed frames

Transport is exactly the two pipes of the one sudo-launched broker process:
client->broker stdin and broker->client stdout. No other descriptor, file,
socket, signal, environment value or filesystem location carries protocol
state; broker stderr carries no protocol and is discarded. The attempt report
directory is data read under §9.4, never a control channel. Client frames:
u32 big-endian length + strict JSON (§4.2 rules). Broker frames: §9.2 kind 3
structural JSON; kinds 1/2 raw stream frames are ephemeral, carry no state,
and are allowed only between STARTED and EXITED.

Broker frame exactly {schemaVersion:1,contractVersion,operation,executionId,
frameSequence,disposition,reason,attemptDigest,invocationId,unitName,
observation,record}, JSON<=262144; it replaces the former single response.
frameSequence starts 0 and increments by exactly 1 per structural frame.
Fields not listed as required for a disposition are null.

| Frame | Producer -> consumer | Required non-null fields | Durable backing | Allowed predecessor | Allowed successor |
|---|---|---|---|---|---|
| CREATE | client -> broker | §4.2 create keys | None (ephemeral) | Process start | ACCEPTED or REFUSED |
| RECONCILE | client -> broker | §4.2 reconcile keys | None | Process start | REFUSED, TERMINAL or QUARANTINED, frameSequence 0 |
| REFUSED | broker -> client | operation, reason (refusal enum, §11.3); executionId except malformed intake | None; proven pre-reservation | CREATE/RECONCILE | End |
| ACCEPTED | broker -> client | executionId, attemptDigest, unitName | PREPARED + claim/tombstone transaction COMMITTED, fsynced | CREATE | BOUND, TERMINAL, QUARANTINED |
| BOUND | broker -> client | + invocationId | CONTROLLER_BOUND fsynced | ACCEPTED | STARTED, TERMINAL, QUARANTINED |
| STARTED | broker -> client | same as BOUND | STARTED fsynced (§6.2 launch proof) | BOUND | Raw frames, EXITED, TERMINAL, QUARANTINED |
| EXITED | broker -> client | + observation | OBSERVED fsynced | STARTED | Client proposal, then TERMINAL or QUARANTINED |
| RESULT_PROPOSAL | client -> broker | §11.2 proposal keys | Ephemeral; accepted content durable only inside terminal record | EXITED received | Stdin EOF; broker TERMINAL or QUARANTINED |
| TERMINAL | broker -> client | reason, attemptDigest, record (status PASSED/TEST_FAILED/TIMED_OUT/EXECUTION_ERROR); invocationId null iff never bound | Terminal journal entry + record fsynced | ACCEPTED/BOUND/STARTED/EXITED, or RECONCILE | End |
| QUARANTINED | broker -> client | reason, record (status QUARANTINED) | Terminal QUARANTINED entry + incident fsynced | Same as TERMINAL | End |

EXITED observation exactly {managerResult,exitCode,signal,timeoutObserved,
resultExpected} (§11.2 types). resultExpected=true iff launch proven,
timeoutObserved=false, no broker-initiated stop, signal=null and
managerResult success or exit-code with exitCode 0 or 1. When false, the
proposal must carry result=null and reports=[].

Every broker structural frame except REFUSED is written only after its
backing entry is fsynced; frames are transport, the journal is truth, and a
lost frame never changes durable state. The broker ignores SIGPIPE, writes
non-blocking, and treats EPIPE or a structural frame not drained within
5000 ms as client loss. The client keeps stdin open until it sends the
proposal, then closes it; stdin EOF/HUP earlier is client loss.

Broker-side violations: proposal before EXITED, second proposal, any bytes
after the proposal, malformed/oversize/unknown-key frame, or identity
mismatch (executionId/invocationId/bindingDigest/attemptDigest). Before
EXITED: admission closes, unit stops (P4), EXECUTION_ERROR RESULT_INVALID
(CLIENT_LOST for EOF/HUP). After EXITED: EXECUTION_ERROR RESULT_INVALID;
CLIENT_LOST for EOF/HUP; OBSERVATION_EXPIRED if no proposal within R.
Proven timeout keeps TIMED_OUT precedence. No late frame changes a decision.

Client-side violations: unknown disposition, frameSequence gap/duplicate/
regression, transition outside the table, missing required identity (for
example BOUND without invocationId), changed executionId/unitName/
invocationId, non-null field required null, malformed/oversize frame, raw
frame outside its window, or EOF before a final frame. The client then sends
no proposal, closes stdin and exits 7 (synchronous orphan); the durable
outcome comes from the broker or a later reconcile. The client reports 0 or
10 only from a validated TERMINAL whose record digest verifies, whose binding
equals the client binding and whose invocationId equals BOUND.

### 7.3 Completion observation and ordering

The attached broker holds RefUnit and observes only the bound unit through
manager PropertiesChanged signals plus bounded Properties.GetAll of closed
fields: ActiveState, SubState, Result, ExecMainCode, ExecMainStatus,
ActiveEnterTimestampMonotonic, InvocationID, ControlGroup, plus
cgroup.events read through the §5.6.1 N5 anchor. With ExitType=cgroup the unit leaves active only after main
exit and whole-cgroup emptiness, or a stop/deadline.

| Observation | Required facts | managerResult / exitCode / signal | Class |
|---|---|---|---|
| Normal exit | ExecMainCode=CLD_EXITED, Result success (0) or exit-code, unchanged InvocationID, empty proof | success or exit-code / status / null | §9.3 precedence |
| Signal | ExecMainCode CLD_KILLED/CLD_DUMPED not caused by broker stop/deadline | signal / null / number | EXECUTION_ERROR |
| Timeout | Result=timeout after ActiveEnter, RuntimeMaxUSec deadline elapsed for this InvocationID, empty proof | timeout, timeoutObserved=true | TIMED_OUT 8 |
| Start failure | Failure/timeout before active or before durable STARTED | other | START_FAILURE 7 |
| Controller/systemd failure | Result resources/oom-kill/watchdog/start-limit-hit/protocol/other; managerId/boot/InvocationID/cgroup/property change; manager call failure | other | CONTROLLER_FAILURE 7 if empty proven, else QUARANTINED |
| Unit missing | Object absent while incomplete | null | §7 Case D |
| Broker-initiated stop | Client loss, cancel, protocol violation | as observed | EXECUTION_ERROR CLIENT_LOST/CANCELLED/RESULT_INVALID |
| Orphan/reconcile | Separate reconcile invocation: journal + retained manager facts, Cases A–H, no proposal | as observed | Proven TIMED_OUT 8, else error 7 or QUARANTINED; never PASSED/TEST_FAILED |

Main exit 0 with a lingering descendant keeps the unit active until empty or
T; a resulting deadline is a timeout. Deterministic create ordering:

1. Framework completion: manager main exit and unit leaving active (or
   deadline/broker stop).
2. Whole-tree termination where required and empty confirmation (§6.3).
3. Broker durable OBSERVED (observation + cleanup proof), then EXITED.
4. Report discovery by the non-root client (§9.4), never before EXITED.
5. Report completeness validation (§9.4).
6. Result parsing/normalization (§9.3).
7. Result proposal (within R).
8. Broker validation/acceptance: identities, resultExpected, independent
   report enumeration/size/hash equality (§9.4), structural consistency,
   §9.3 decision precedence.
9. Terminal durable commitment: terminal journal entry + record v2 fsync,
   then TERMINAL/QUARANTINED frame.
10. Resource release (P6): ResetFailedUnit, UnrefUnit, descriptor-anchored
    workload leaf/report removal, live root claim release fsync; tombstones
    retained.

Containment cleanup (step 2, recorded as record cleanup) precedes parsing;
resource release (step 10) follows commit. Parsing after empty proof means
no process of the controlled tree can still write or race the reports, and
timeout/signal/cancel facts are durable before any result is considered, so
a late report cannot become PASS. Report bytes must still exist at broker
acceptance, so leaf removal follows commit; a failed commit keeps leaf and
unit facts for reconcile. Same-account writers outside the tree remain
R-3/R-4.

### 7.4 Crash and failure matrix

| Stage (last durable) | Client crashes / EOF | Broker crashes | Workload exits | Controller state disappears | Proposal never arrives | Terminal commit fails |
|---|---|---|---|---|---|---|
| S0 P0/P1, nothing reserved | Broker aborts; nothing reserved | Partial INTENT recovered by next P1; client got no REFUSED: exit 7, never assumes unreserved | Not applicable | Stale attempts per Cases A–H | Not applicable | Not applicable (REFUSED not durable) |
| S1 PREPARED (ACCEPTED, P1S) | Liveness checked before SUBMITTING: CLIENT_LOST error 7, emptyBy=not-submitted, consumed | Reconcile Case E: no-send proof PRESUBMIT_FAILURE error 7, else QUARANTINED | Not applicable | Not applicable | Not applicable | Stays PREPARED; reconcile PRESUBMIT_FAILURE error 7 or H |
| S2 SUBMITTING/BOUND | Broker stops unit: CLIENT_LOST error 7 | Manager deadline; reconcile A–E: error 7 or proven timeout 8 | Before launch proof: START_FAILURE 7 even on exit 0 | MISSING_UNIT_PROOF: removal/boot proof error 7, else QUARANTINED | Not applicable | Stays incomplete; reconcile error 7 or H |
| S3 STARTED | Stop: CLIENT_LOST 7 (proven earlier deadline: 8) | Case F: manager deadline; reconcile error 7 or proven timeout 8 | Normal path to S4 | As S2 | Not applicable | As S2 |
| S4 OBSERVED (EXITED sent) | Immediate CLIENT_LOST 7 (observed timeout: 8) | Reconcile from OBSERVED: error 7 or proven timeout 8 | Already exited | Empty proof durable; only release affected | After R: OBSERVATION_EXPIRED 7 (observed timeout: 8) | Stays OBSERVED; client exit 7; reconcile error 7/8 |
| S5 proposal received | Broker still commits; reconcile later returns the committed record | Proposal not durable: reconcile error 7/8; a valid PASS is lost, never inferred | Already exited | As S4 | Not applicable | No TERMINAL; client exit 7; stays OBSERVED; reconcile error 7/8; storage failure quarantines runner |
| S6 terminal committed | Committed outcome stands; reconcile returns it | Outcome stands; release recovered by next P1 | Already exited | Release failure retains claims; ambiguity incident; outcome never rewritten | Not applicable | Not applicable |

In every row a failed terminal commit leaves the last durable state; the
client receives no final frame and exits 7; later reconcile applies that
row's broker-crash outcome. Unknown state is never PASS: the only PASS path
is OBSERVED + accepted proposal + fsynced terminal + client-validated
TERMINAL.

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
   symlink/hardlink substitution (link count exactly 1, §5.5). AppliedRecord v1 lacks historical file
   inode; fresh path/content identity suffices within existing R-4. Invent
   no historical identity and change no Stage 4 schema.
7. Framework agrees across config/plan/package. Freeze verified data-only
   descriptor, revalidate after reservation and immediately before submission.
   Post-apply mutation detected by the client or by the broker before the
   reservation commit refuses before spawn: REFUSED/INPUT_MISMATCH exit 4,
   nothing consumed. The same mismatch detected by the broker's mandatory
   post-reservation recheck (P1S, §6.4) is never REFUSED: the attempt is
   consumed and ends EXECUTION_ERROR PRESUBMIT_FAILURE exit 7, nothing sent.

Only exact applied Cypress/Playwright specs from that package execute.
Helper/config-only packages refuse; no suite fallback, arbitrary target,
arbitrary framework args or provider command. Config/import/dependency code
remains untrusted inside lifecycle containment, not a transitive sandbox.
Sections 8.2 and 9 close fingerprint/compatibility and results; real Linux qualification remains mandatory. Recheck cannot freeze against
same-account writers (R-4); matching bytes do not cure authority ambiguity.

### 8.2 Closed executable/native adapters and fingerprint

No .bin/.cmd/shebang/PATH/global/ancestor/npx/npm-script/install/download.
Fixed non-root workload mode execs exact root-owned qualified Node22;
target-local metadata read as bounded data:

| Framework | Fixed metadata / generated Node argv |
|---|---|
| Cypress | node_modules/cypress/package.json name/version, bin cypress="bin/cypress"; [node,root+"/node_modules/cypress/bin/cypress","run","--headless","--browser",qualifiedAbsoluteChromium,"--spec",commaJoinedSortedCanonicalRootRelativeSpecs,"--reporter","junit","--reporter-options","mochaFile="+reportsDir+"/cypress-[hash].xml","--posix-exit-codes"] |
| Playwright | node_modules/@playwright/test/package.json name/version, bin playwright="cli.js"; [node,root+"/node_modules/@playwright/test/cli.js","test","--config="+root+"/playwright.config.js","--project=chromium","--reporter=junit",...anchoredEscapedAbsoluteSpecRegexes] |

PPI-1 paths/no comma/glob; Playwright escapes all regex metacharacters/
anchors ^...$. Cypress spec paths are root-relative, resolved against the
fixed WorkingDirectory=root project (qualification proves resolution); the
single --spec entry is <=100*300+99 bytes. reportsDir is the §9.4 attempt
directory. --posix-exit-codes is a fixed adapter entry: a Cypress build that
does not accept it with the §9.3 semantics is unsupported, never run with
failure-count exit codes. Caller never sends argv. No subset/grep/suite fallback/custom
config/project/browser selection. Conventional config entries fixed;
target imports only non-root service. Qualified adapter proves ALL exact
specs selected, config additions/exclusions/incomplete selection ->error.
Command syntax is version-qualified, not proof of any installed version.

Exact local framework/reporter/JS closure, Cypress native/cache/browser or
Playwright/playwright-core/Chromium profile paths/versions/digests.
Native/Node/broker ancestors root-owned/non-writable; target dependencies
remain target code. No ambient channel/executablePath/cache/download/global
browser fallback. [Cypress provisioning](https://docs.cypress.io/app/references/advanced-installation)
and [Playwright browsers](https://playwright.dev/docs/browsers) establish
separate native provisioning.

fingerprint exact {algorithm:"od06-files-v1",files,digest:H};
files1..4096 unique/sorted {path,sha256:H,size}, canonical root-relative
<=300 bytes, size integer0..16777216/total hashed<=67108864 bytes.
Required: fixed config/root package.json/package-lock.json/local framework
metadata/entrypoint/exact qualified executable JS/reporter closure, Playwright/
core where applicable/profile-enumerated static config imports. Broker
checks exact required membership/fresh bytes/no link/hardlink/mount escape,
no caller exclusion. Dynamic imports remain account code, not transitive
sandbox/freeze; Node/native bound separately by profileDigest, broker by
§5.4 brokerSha256.
Required-file/version changes demand operator requalification, never target
self-enrollment. Applied ALL changes independently checked.

## 9. Environment, evidence and result taxonomy

### 9.1 Fresh environment and confidential handoff

Native workload mode clears inherited env before Node and installs exactly:

| Category | Policy |
|---|---|
| REQUIRED | PATH=fixed qualified tool directories, HOME=per-attempt runner leaf, CI="true", GITHUB_ACTIONS="false" |
| ALLOWED | LANG=LC_ALL="C.UTF-8", TMPDIR=per-attempt runner leaf |
| STRIPPED | All ambient names: AI/provider/GitHub/npm credentials/config, NODE_OPTIONS/NODE_PATH/preload/loader and all unlisted names |
| TARGET-OWNED | Explicit enrolled/requested SUT_[A-Z][A-Z0-9_]{0,59}, <=32 unique; value<=4096 UTF-8 bytes/total name+value<=65536/no NUL |
| Cypress controls | Product-only CYPRESS_CACHE_FOLDER=qualified cache, CYPRESS_RUN_BINARY=qualified native Cypress, no other CYPRESS_* |
| Playwright controls | Product-only PLAYWRIGHT_BROWSERS_PATH=qualified payloads, PLAYWRIGHT_JUNIT_OUTPUT_FILE=reportsDir+"/playwright.xml" (§9.4), no other PLAYWRIGHT_* |

No credential relabeling into SUT aliases. Fixed locale/tools qualified.
Attempt paths `/var/lib/qa-agent-workload-v1/workloads/<ID>` on the dedicated
size-bounded workload mount B (§5.6.3; no shared /run parent, no fallback),
protected ancestors, runner leaf only; HOME, TMPDIR and reportsDir never
leave B. Before SUBMITTING the broker creates, descriptor-anchored,
the leaf and exactly three empty runner-owned 0700 subdirectories home, tmp
and reports (reportsDir = leaf+"/reports"). No credential reference/handle/
file transport or value echo/hash/persistence.

Anonymous sealed memfd envelope exactly {schemaVersion:1,executionId,
rootDigest,nodePath,argv,environment}; rootDigest H, qualified nodePath/argv
broker-built, environment exact projected name/value array.
<=2097152 encoded bytes, <=128 argv entries, each<=32768 raw UTF-8 bytes,
argv total<=1048576 raw bytes, environment within the table bounds; overflow
refuses before reservation (exit 4). Bounds fit the worst case of 100
in-grammar targets (Playwright: 107 entries, 100 anchored regexes <=8795
bytes each over a <=4096-byte root, about 892000 raw bytes, JSON escaping
included in the encoded bound); qualification proves the service's
effective exec argument capacity covers raw argv plus environment.
Broker creates/seals FD/passes StandardInputFileDescriptor/closes handoff.
Workload checks UID/version/bounds, clears inherited env, reads/closes FD,
sets stdin null, execs Node. No caller descriptors.

Upstream [Environment setter](https://raw.githubusercontent.com/systemd/systemd/v256/src/core/dbus-execute.c)
writes transient settings; secret Environment/StandardInputData/credentials
are forbidden. Real-host proof: no secret payload in manager transient files/
journal/sudo I/O/core/debug/product evidence. OS swap/account-readable memory/
target deliberate secret output outside isolation claim. Product never
intentionally persists values; empty HOME/NoNewPrivileges is not sandbox.

### 9.2 Finite capture/import/persistence

Root broker handles opaque stdout/stderr bytes only, per-stream<=200000,
cap BEFORE copy/drain-discard overflow/saturating counters. No root report
parser. Wire output frames: kind byte1 stdout/2 stderr/3 structural JSON,
u32 big-endian length<=262144 +payload (raw frames<=65536); <=16 queued
frames/<=4194304 queued bytes. Slow/dead reader
drops raw frames/marks truncation, never blocks deadline. No raw values in
journal/log/persistence.

Client parses reports non-root under the §9.4 contract only: fixed attempt
directory, closed filename grammar, exact count, no recursive/arbitrary path.
Raw reports are never persisted. All persisted product data<=16777216/attempt
including root journal/records/report projections. Persist structural counts/digests/refs/truncation only,
no raw stream/label/message/stack/env/secret handle/provider material.
Target disk/network/report output is account activity, not product quota.

### 9.3 Qualified structural results and exits

Exact enrolled-version JUnit profiles; non-root parser, DTD/external entities/
network expansion forbidden, depth<=32/testcases<=10000. Closed
testsuites/testsuite/testcase envelope and bounded totals agree with complete
enumeration. Each framework has exactly one authoritative report-to-spec
mapping rule, defined in §9.4 (Cypress: per-report testsuite file attribute;
Playwright: file-level testsuite name attribute). Mappings must cover ALL
requested specs with no extra or missing spec; a version for which the
exact rule is unprovable is unsupported.
Each spec>=1 executed case; all-skipped/no-test error.

Closed XML vocabulary: testsuites contains testsuite; testsuite contains
 testcase; testcase at most one failure/error/skipped, optional system-out/
system-err. Optional properties under testsuite contains property leaves;
all text/property payloads bounded/discarded. Allowed attributes: testsuites/
testsuite use name,tests,failures,errors,skipped,time,timestamp,file,hostname,
id,package; testcase name,classname,file,time; failure/error message,type;
skipped message; property name,value. Other elements/attributes/entities
refuse. Numeric counts integer0..10000/time finite decimal0..600; each
text/attribute<=4096 UTF-8 bytes. Spec mapping uses only the single
framework rule of §9.4 (byte equality with a requested canonical path),
never label resemblance, another attribute, or a second rule as fallback.
Unsupported shape refuses, no grammar relaxation.

Normalized result exactly {adapterVersion,specs,totals,complete}, specs sorted
{path,total,passed,failed,skipped}, totals={total,passed,failed,skipped},
integers0..10000/sums consistent/complete=true/exact target paths.
No report/provider status trusted. Broker checks proposal binding/process/
structural consistency; forged same-account report remains R-3.

Framework exit semantics are adapter-fixed. Cypress always runs with
--posix-exit-codes (§8.2); qualification proves for the exact build that 0
means the run completed with no failed test and 1 means failed tests or a
run/startup failure, never a failure count. Playwright qualification proves
the same 0/1 meaning. Exit 1 alone never proves TEST_FAILED.

Decision precedence, applied by the broker at §7.3 step 8; first match wins:

1. Controller/infrastructure: empty or cleanup unproven, ownership/identity
   ambiguity -> QUARANTINED 7; missing launch proof, start failure,
   controller failure, missing unit -> EXECUTION_ERROR 7.
2. Timeout: exact §6 manager deadline for this invocation + empty proof ->
   TIMED_OUT 8, whatever the exit code or reports.
3. Broker-initiated stop (client loss, cancel, protocol violation) or no
   valid proposal -> EXECUTION_ERROR 7.
4. Process exit: signal, managerResult other, or exitCode not 0/1 ->
   EXECUTION_ERROR 7 (framework startup/configuration/infrastructure).
5. Report completeness: any §9.4 refusal (missing/duplicate/extra/oversize/
   aggregation failure) or proposal/broker accounting mismatch ->
   EXECUTION_ERROR 7 RESULT_INVALID. This separates a framework startup or
   configuration failure that also exits 1 from a test failure.
6. Normalized result with exit: exit 0 + total failed 0 + every spec
   passed>0 -> PASSED 0; exit 1 + complete result + total failed>0 ->
   TEST_FAILED 10, for any number of failed tests/assertions; exit 0 with
   failed>0, exit 1 with failed 0, or an all-skipped/no-test spec ->
   EXECUTION_ERROR 7 RESULT_INVALID.

QA Agent configuration refusal (exit 3) is pre-broker and unrelated to
framework configuration failure (7). Stream truncation cannot substitute a
complete report; report overflow never yields PASS/TEST_FAILED.

| Outcome/category | Exit |
|---|---:|
| PASSED | 0 |
| TEST_FAILED | 10 |
| Proven TIMED_OUT | 8 |
| EXECUTION_ERROR / synchronous orphan / post-submit quarantine | 7 |
| Pre-start authority/eligibility/replay/pre-existing quarantine | 5 |
| Input/applied binding | 4 |
| Config | 3 |
| Usage | 2 |
| Internal bug before submission | 1 |

Possibly accepted start requires recovery/error7, never harmless1.
Existing provider6 unchanged/reserved execute5 everywhere/no new exit.

### 9.4 Bounded multi-spec report contract

Maximum admitted targets stays 100 (§4.2) and is fully supported; every
report limit below is derived from it. reportsDir is the attempt-owned
directory /var/lib/qa-agent-workload-v1/workloads/ + executionId + /reports
on the bounded workload mount (§5.6.3), created empty by the broker (§9.1). The workload never communicates report
paths: reporter destinations are broker-built argv/environment constants
(§8.2/§9.1), and the client derives reportsDir from executionId. No path from
the workload, report content, streams or frames is ever opened.

| Framework | Exact report count | Filename grammar (whole string) | File to spec mapping |
|---|---|---|---|
| Cypress | Number of targets, 1..100, one per executed spec | ^cypress-[0-9a-f]{32}\.xml$ | Exactly one testsuite carries a file attribute, byte-equal to exactly one requested canonical root-relative path |
| Playwright | 1 | ^playwright\.xml$ | Each file-level testsuite name attribute is byte-equal to exactly one requested canonical root-relative path; testsuites and targets in bijection; no file attribute anywhere |

Cypress [hash] is the junit reporter's lowercase hex MD5 of the complete
written file content. Qualification proves, for the exact Cypress/reporter
build, that the name is computed from exactly the written bytes and that the
spec-path file attribute is present in root-relative form; otherwise the
build is unsupported. Client and broker recompute the MD5 and require name
equality (a write-completeness consistency check, not authentication).

Playwright mapping (single authoritative rule, C2). The trusted identity of
each admitted spec is its canonical PPI-1 root-relative path in the
broker-validated targets[] (§4.2/§4.3); nothing in the report or target
config defines which specs were admitted. The report side of the mapping is
the name attribute of each file-level testsuite. Normalization base: the
Playwright config directory, which the fixed adapter argv pins to the
enrolled canonical root (--config=root+"/playwright.config.js", §8.2). The
target config's testDir/testMatch/rootDir values are never read, joined or
trusted for mapping. Expected value: the testsuite name is byte-equal to the
canonical root-relative target path. There is no repair, case folding,
separator rewrite, "./" or "/" trimming, prefix stripping or testDir join.
Absolute, "..", empty-segment or backslash names are extra. Qualification
proves, for the exact @playwright/test and playwright-core packageVersion
and adapter od06-playwright-v1, that with the fixed argv and one project
(chromium):
(a) exactly one file-level testsuite per executed spec, as a direct child of
testsuites;
(b) its name is the spec path relative to the config directory, with "/"
separators, independent of a testDir that differs from the root, nested
spec directories and testMatch;
(c) every testcase of that spec is a direct child of that testsuite;
(d) no file attribute is emitted.
A build failing any of (a)–(d) is unsupported: the profile fails
qualification and Playwright execute is unavailable on that runner. The
contract has no fallback to classname, testcase name, file attributes,
hostname, testDir joining or label resemblance.

Limits: <=100 reports; each 1..4194304 bytes; aggregate<=16777216 bytes;
<=10000 testcases in total; §9.3 depth/attribute/text bounds. Reports are
read into memory and never persisted.

Deterministic discovery (client, §7.3 step 4, only after EXITED):

1. Descriptor walk to reportsDir with no-follow directory opens; require
   runner ownership, mode 0700 and no mount crossing.
2. Read every entry to end, refusing at the 101st entry (excluding . and ..).
3. Each entry must match the framework grammar and, via no-follow fstatat, be
   a regular runner-owned file with link count 1 and size within bounds.
   Any other entry (directory, symlink, FIFO, temp or other name) is extra.
4. Sort names bytewise; this order, never readdir order, is used for reading
   and for proposal reports[].
5. Open each no-follow/non-blocking, require fstat equal to step 3 (dev, ino,
   size), read exactly size bytes and confirm EOF; enforce the aggregate.

Completeness (§7.3 step 5): Cypress files and targets must be in exact
bijection. Two files mapping to one spec: duplicate, refuse. A target with
no file: missing, refuse. A file with zero or several file attributes, or
mapping to a non-target: extra, refuse. Count != number of targets: refuse.
Playwright: exactly one report file; the file-level testsuites and targets
must be in exact bijection under the rule above. Two testsuites whose names
equal one target: duplicate (ambiguous), refuse. A target with no testsuite:
missing, refuse. A testsuite name that is not byte-equal to a target, or any
file attribute present: extra/unsupported shape, refuse. Testsuite count !=
number of targets: refuse. A testsuite with zero testcases is a no-test spec
(§9.3, RESULT_INVALID).

Aggregation (§7.3 step 6): per file §9.3 parse; per spec total = testcases,
failed = testcases with failure or error, skipped = testcases with skipped,
passed = total - failed - skipped; testsuite tests/failures/errors/skipped
attributes must agree. specs ordered by canonical target path (bytewise),
totals are sums, complete=true only when every step passed. Any parse,
consistency, limit or mapping failure is an aggregation failure: the client
sends result=null and reports=[], giving RESULT_INVALID (§9.3 rule 5).

Accounting provenance. The broker is the authoritative producer of
reportCount, reportBytes and reportOverflow. At §7.3 step 8, as root, it
repeats discovery steps 1–5 on reportsDir through descriptor-anchored
no-follow opens, reading bytes opaquely (no XML parsing), and computes name,
size, SHA-256 and the Cypress MD5 name check per file. Counters saturate at
101 files / 16777217 bytes; reportOverflow is true on any limit breach or
non-conforming entry. With a non-null result, client reports[] (sorted
{name,bytes,sha256}) must equal the broker enumeration exactly; any
difference is RESULT_INVALID. The workload computes no accounting; the record
never contains a client-only accounting value. All of steps 4–8 complete
before the terminal commit.

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
  -> private broker client -> closed request/lifecycle observations
       -> root-owned host broker -> fixed systemd request
            -> non-root workload mode -> qualified Node/framework
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
The former INDETERMINATE consumer-design blocker is resolved. Section 4 resolves the OP-06-03 authority design blocker; broker adds no gate consumer. Finding stays **OPEN / LOW / CONDITIONAL**;
no closure/re-rating/remediation. Future import/call/authority changes require
re-evaluation, with STOP if TRUE or INDETERMINATE. Design FALSE is not runtime
certification or permission to bypass future tests. C1 revalidation: the
§7 frames, §9.4 report contract, §5.4 compatibility read and §5.5 root rule
add only broker-protocol, data-read and broker-side checks; no import/call
edge to either gate, #23F, apply.js or legacy execution. Proposed remains
FALSE. C2 revalidation: the §5.5 mount invariant, the §6.4 P1S phase with
PRESUBMIT_FAILURE and the §9.4 Playwright mapping rule are broker-side
filesystem checks, a broker lifecycle state and a client data-parsing rule;
they add no import/call edge to either gate, #23F, apply.js or legacy
execution. Proposed remains FALSE. C3 revalidation: the §5.6 kernel-namespace,
filesystem-type and bounded workload-storage checks are broker-side host
checks plus a fixed workload path change; they add no import/call edge to
either gate, #23F, apply.js or legacy execution. Proposed remains FALSE.
C4 revalidation: the §5.6.4 check order and reconcile scope reorder and
narrow existing broker-side checks; they add no import/call edge to either
gate, #23F, apply.js or legacy execution. Proposed remains FALSE.
C5 revalidation: placing the existing §4.3 item 1 broker-side integrity/
authentication checks at C1a/R1a and clarifying the check-only P1S re-walk
add no import/call edge to either gate, #23F, apply.js or legacy execution.
Proposed remains FALSE.

## 11. Closed schemas and Stage 5 boundary

### 11.1 Canonical encoding and shared records

All new objects recursively closed/every key required. Canonical encoding
uses existing CRS-1 encodeValue data algorithm: ASCII JSON/sorted ASCII keys/
escaped UTF-16/dense arrays/safe integers/no -0/accessor/exotic values.
Native broker implements only data specification, imports no npm JS.
H = SHA-256 of ASCII domain prefix +canonical bytes excluding own digest
field/no newline. Existing Stage 4 domains/bytes unchanged. H §4,
ID32 lower hex/N nonnegative safe integer/UTC valid canonical
YYYY-MM-DDTHH:mm:ss.sssZ/bootId lowercase canonical UUID/null explicit.
No environment value hash persisted.

binding exactly {projectId,runId,packageOrdinal,product,root,principal,
reviewRecordId,applyRecordId,reviewRecordDigest,packageDigest,changeSetDigest,
automationPlanDigest,repositoryContextDigest,projectionDigest,appliedRecordSha256,
targets,framework,timeoutMs,fingerprintDigest,profileDigest,bindingDigest}.
Existing generation ID/product/root/principal grammars/validators; principal
exact Stage 4 OS-local envelope/review+apply IDs ID/digests H/targets §4.
ALL changes bound by applied/package chain.
bindingDigest domain "qa-ai-agent:execution-binding:v1:"; broker independently
reconstructs launch/security data from fixed Stage 4 evidence, compares digest.
Fingerprint domain "qa-ai-agent:execution-fingerprint:v1:"; profileDigest
domain "qa-ai-agent:execution-profile:v1:" over qualification; the client
takes profileDigest from the §5.4 record, never from enrollment. Compatibility
domain "qa-ai-agent:execution-compatibility:v1:" over the §5.4 record.
propertiesDigest domain "qa-ai-agent:execution-properties:v1:" hashes
fixed semantic payload, FD values replaced by fixed role names, no secret
envelope content.

controller exactly {contractVersion,brokerSha256,bootId,managerId,unitName,
invocationId,cgroupPath,cgroupDev,cgroupIno,propertiesDigest}; literal version/
H hashes/ID invocation/authenticated manager local-bus unique owner<=256
ASCII/manager-derived cgroupPath<=4096/dev+ino decimals. Its initial slash
is interpreted strictly beneath the authenticated cgroup-v2 anchor, defined
as the initial/PID1 cgroup-namespace hierarchy (§5.6.1 N5), never as an
arbitrary filesystem absolute path or another namespace's view. No caller PID/
D-Bus object authority.
cleanup exactly {admissionClosed,managerTerminal,noPendingJobs,emptyBy,
confirmedAt}, booleans true/UTC/emptyBy enum populated-zero/manager-removal/
boot-change/not-submitted. Last variant only protected NOT_SENT plus no
send/no unit/clean namespace proof; never uncertain SUBMITTING shortcut.

### 11.2 Protected journal/transaction/proposal

QaAgentExecutionAttempt v1 exact keys:
kind="QaAgentExecutionAttempt", schemaVersion=1, executionId, sequence,
state, binding, controller, submission, timeline, observation, cleanup,
outcomeDigest, previousDigest, journalDigest.
sequence N starts0/increments1/state §7/controller null until known;
submission NOT_SENT/MAY_HAVE_BEEN_SENT/BOUND.
timeline={reservedAt,submittedAt,startedAt,endedAt,monotonicStartUs,
monotonicEndUs}; reservedAt UTC/subsequent UTC|null/N|null by facts;
monotonic same boot/ordered/never fabricated.
observation={managerResult,exitCode,signal,timeoutObserved,stdoutBytes,
stderrBytes,stdoutTruncated,stderrTruncated}, managerResult null or
success/exit-code/signal/timeout/other, exitCode null|integer0..255,
signal null|integer1..64, counters N saturated MAX_SAFE_INTEGER/flags boolean.
cleanup null until proof/outcomeDigest H|null until terminal;
previousDigest null seq0 then H prior immutable entry;
journalDigest domain "qa-ai-agent:execution-attempt:v1:".

Immutable attempts/<ID>/<8-digit-sequence>.json/sequence<=99999999/
<=1024 entries per attempt; overflow terminates/error/quarantine.
Current pointer exactly {executionId,sequence,journalDigest}, atomic/fsynced.
Bounded contiguous chain verified on recovery; ambiguous/missing/temp/
unknown files quarantine. Root ownership, not hash alone, establishes trust.

Claim/tombstone exactly {schemaVersion:1,key:H,executionId,bindingDigest:H}.
RootKey domain "qa-ai-agent:execution-root:v1:" over root identity.
Consumed keys in fixed order: "qa-ai-agent:execution-consumed-run:v1:"
over [rootDigest,runId,ordinal]; "qa-ai-agent:execution-consumed-package:v1:"
over [rootDigest,packageDigest,applyRecordId].
Transaction {schemaVersion:1,executionId,rootKey,consumedKeys,bindingDigest,
phase}, phase INTENT/COMMITTED, consumedKeys exactly two H. Fixed protected
paths/only validated IDs/hashes as leaves; missing history cannot be rebuilt
from target files.

Result proposal: second client frame<=262144, exactly {schemaVersion:1,
executionId,invocationId,bindingDigest,attemptDigest,reports,result};
attemptDigest = EXITED frame attemptDigest (OBSERVED entry); reports<=100
sorted {name,bytes,sha256} (§9.4); result normalized §9 result or null.
Exactly once, only after EXITED, within P5 (§6.4/§7.2). No caller status/
exit/timeout/cleanup/property assertions; broker determines facts. Reconcile
has no proposal; missing/malformed yields error (§7.2/§7.4).

Incident exactly {kind:"QaAgentExecutionIncident",schemaVersion:1,executionId,
rootDigest,reason,createdAt,resolvedAt,cleanup,incidentDigest}, UTC/
resolvedAt+cleanup null until operator recovery/§11.3 reason;
domain "qa-ai-agent:execution-incident:v1:".
Resolution appends immutable revision, never execution rewrite/retry.

### 11.3 Execution-record v2 and response

AutomationExecutionRecord v2 exact keys:
kind="AutomationExecutionRecord", schemaVersion=2, executionId, binding,
controller, timeline, status, reason, process, result, capture, cleanup,
recordDigest. No silent legacy v1 migration/reuse.
Shared records above; controller null only no proven binding;
status PASSED/TEST_FAILED/TIMED_OUT/EXECUTION_ERROR/QUARANTINED;
result §9|null/complete required PASS+TEST_FAILED; cleanup null only
QUARANTINED. No-send errors use emptyBy=not-submitted and proof above;
uncertain send must prove actual subtree empty or quarantine.
process={exitCode,signal,managerResult,timeoutObserved}, §11.2 types.
capture={stdoutBytes,stderrBytes,stdoutTruncated,stderrTruncated,reportCount,
reportBytes,reportOverflow}, counters N/reportCount 0..101/reportBytes
0..16777217/reportOverflow boolean; report fields are broker-produced (§9.4).
recordDigest domain "qa-ai-agent:automation-execution-record:v2:".

Reasons: SUCCESS, ASSERTION_FAILURE, HARD_TIMEOUT, CANCELLED, CLIENT_LOST,
PRESUBMIT_FAILURE, START_FAILURE, OBSERVATION_EXPIRED, RESULT_INVALID,
CONTROLLER_FAILURE, MISSING_UNIT_PROOF, CLEANUP_UNPROVEN, STATE_INCONSISTENT.
PRESUBMIT_FAILURE (C2) only EXECUTION_ERROR from PREPARED/NOT_SENT with
emptyBy=not-submitted, controller null, process exitCode/signal/managerResult
null with timeoutObserved false, and result null (§6.4 P1S).
SUCCESS iff PASSED/ASSERTION_FAILURE iff TEST_FAILED/HARD_TIMEOUT iff
TIMED_OUT. QUARANTINED only CONTROLLER_FAILURE/MISSING_UNIT_PROOF/
CLEANUP_UNPROVEN/STATE_INCONSISTENT+claims retained. Other reasons error
with cleanup. exit/signal mutually exclusive/PASS0+manager success+
failed0/TEST_FAILED1+failed>0/HARD_TIMEOUT exact manager/deadline facts.
Quarantine may retain preliminary facts, never normal success.
Terminal record/journal fsync before live claim release/tombstones retained.

Broker output is the closed §7.2 broker frame sequence; there is no other
response object. operation create/reconcile; disposition REFUSED/ACCEPTED/
BOUND/STARTED/EXITED/TERMINAL/QUARANTINED with §7.2 field rules;
attemptDigest H|null/record v2|null/reason record reason|null or refusal
SCHEMA_INVALID/CALLER_REFUSED/INELIGIBLE/REPLAY/INPUT_MISMATCH/INCOMPATIBLE/
RECOVERY_BUDGET_EXHAUSTED (the two new C1 refusals are pre-start
eligibility, exit 5; existing mappings unchanged). Pre-reservation refusal null attemptDigest/record;
consumed error terminal/quarantine, not reset REFUSED. Progress frames carry
attemptDigest and null record+reason; final frames carry the full matching
record+reason. Malformed intake allows operation/executionId=null only/fixed
SCHEMA_INVALID/no echo. Oversize malformed frame cannot truncate into PASS;
error/recovery.

### 11.4 Implementation interfaces and retained governance

Future private modules: execute.js/execution-applied-binding.js/
execution-store+state/broker-client/framework-launch+result/
execution-record-v2. verifyApplied -> frozen binding;
create(closed request) -> closed §7.2 frames/record; reconcile(ID) -> record;
normalizeResult -> proposal; validateRecord -> structural read-only evidence.
Broker alone reserves/owns protected consumption, no direct systemd/legacy
#23G retry path. No implementation authorized.

Stage 5 separate authority; preserve Stage 4 record/manifest/review/apply/
TAP-2/CRS-1/PPI-1/#23F/both gates/FUTURE/API/bin/exports/legacy exclusion.
Root state outside target. Future client copies <output.dir>/execution/<ID>.json,
outside Stage 4 runs/<runId> inventories, no silent migration/export/dependency.

| Mission item group | Closed design / later required evidence |
|---|---|
| 1–4 eligibility/provisioning/privilege/service | §§4–6 scoped authority/exact policy/payload; qualify host |
| 5–10 identity/orphan/reconcile/state/timeout/termination | §§6–7 protected claims/A–H/finite budgets; real crash/kill/boot |
| 11–13 executable/targets/binding | §8 closed adapters/fingerprint/exact specs; native/selection proof |
| 14–18 retry/concurrency/env/evidence/record | §§7/9/11 no retry/locks/memory SUT/bounds/closed schemas |
| 19–24 exits/TSB/security/deployment/Stage5/validation | §§9–13 fixed taxonomy/gate-free graph/impact/ordered approval |

No owner-level design blocker remains in approved scope. Future implementation/
qualification is not current support/release proof. Unprovable selected
enforcement or broader invocation/component/distribution/API ->STOP owner.
TSB-F02 current FALSE/proposed FALSE subject to independent review;
OPEN / LOW / CONDITIONAL/no remediation/refactor/closure. R-1..R-5 accepted
only existing OD-04 scope/AT-07/TB-01 RESIDUAL/FUTURE guards OPEN.

| Residual | Execute impact only |
|---|---|
| R-1 / R-2 | Same-principal automation/account attribution, no human proof |
| R-3 | Writable evidence/result forgery; root history prevents consumption deletion, not approval-origin forgery |
| R-4 | Fresh bytes/fingerprint not same-account/dynamic-code freeze |
| R-5 | Harmful tests retain account filesystem/network/SUT authority |
| AT-07/TB-01 | Consistent reconstructed digests not origin authentication |

Root escalation/property freedom forbidden, not absorbed as residual.
Host/network/SUT/dependency/output/resource exposures require independent
Security/owner OD-06; no new residual acceptance.

## 12. Validation, delivery and review boundary

Exact changed-file allowlist: this document only. Sections1–2 preserved
after line-ending normalization; all STOP commits remain ancestry. No
source/test/workflow/package/API/ROADMAP edits. Existing tests run unchanged
for current-surface regression, no broker/controller/framework provisioning
or new tests. Windows Node24 checks not Linux Node22 qualification.

Checks: diff --check/Markdown sections+fences+links+whitespace/historical
preservation/no stale active authority STOP/schema+property+state+exit+timeout/
17 owner directives and24 mission items/static DC-F02 and CLI package suite/
native reserved exit5/direct-child+ancestry+clean tree.
Actual results/final HEAD/tree/PR/check identity reported externally;
source commit cannot contain own SHA.

Authorized: one direct-child commit, fast-forward push existing design branch,
main PR classified HEAVY (security contract), exact-head CI existing workflows.
Cumulative diff includes three preserved STOP/design commits. Synthetic
pull_request merge allowed only when event head SHA and merge parent/source
checkout bind exact PR source HEAD; no stale CI substituted as proof.

**STOP after delivery/CI before independent HEAVY Architecture review.**
Author does not independently approve/merge/close. Then Architecture exact
HEAD ->if APPROVED Security same HEAD ->if both APPROVED PO OD-06 ->
separately authorized Stage5 ->Linux/native/adversarial/installed-package
qualification ->separate activation/release. No merge authority here;
RELEASE_CAPABILITIES.execute disabled.

Future negative qualification: UID/sudo metadata/argv/env/cwd spoof;
broker/config/ancestor/library writable substitution; direct D-Bus property/
aux abuse denied; User/ExecStart/deadline/kill/restart/delegation mutation;
workload broker reentry/escalation; subgroup/fork/setsid/migration;
client/broker SIGKILL around reserve/send/start/proposal/cleanup;
manager restart/reboot/missing/recreated units/uninterruptible tasks;
torn journal/history deletion/replay/upgrades/quarantine; Node/framework/
native/shim substitution/download; exact-spec/suite/config additions;
applied/helper/root/product/review/record tamper/TOCTOU; secrets in
transient/sudo/core/journal/logs; stream/report/persistence/capacity overflow;
forged zero-exit/PASS/signals. Cooperative tests not full qualification.

Required future Stage 5 vectors added by C1 (none implemented here):

| Area | Vectors |
|---|---|
| Protocol (§7) | Client and broker crash at each S0–S6 stage; missing executionId/invocationId/unitName in a frame; out-of-order, duplicate, regressed frameSequence; malformed, oversize, unknown-key and extra frames on both pipes; proposal before EXITED, second proposal, bytes after proposal; proposal never sent (R expiry); stdin EOF/HUP at each stage; terminal commit failure; reconcile never yields PASS/TEST_FAILED; report parsing attempted before EXITED refused; report bytes changed between client parse and broker accounting |
| Cypress reports (§9.4) | 1, 2, 9 and 100 specs; more than 8 report files; maximum admitted count; missing report; duplicate report (two files one spec); extra report (non-target, wrong name, symlink, directory, FIFO); oversized single report; aggregate overflow; MD5 name mismatch; aggregation failure (malformed XML, attribute/count disagreement); 101st entry refusal; readdir order permutation gives identical result |
| Launch size (§9.1) | 100 targets with maximum root/path lengths for Cypress and Playwright fit; one byte over each bound refuses before reservation |
| Exit semantics (§9.3) | Multiple Cypress assertion failures -> TEST_FAILED/10, never EXECUTION_ERROR; Cypress startup/config failure exit 1 with no reports -> 7; exit 0 with failures, exit 1 with zero failures -> 7; timeout overrides exit/report -> 8; Cypress build lacking --posix-exit-codes unsupported |
| Roots (§5.5) | Same root twice; parent then child; child then parent; symlink and bind-mount equivalent roots; same physical spec through two root-relative forms and through a hardlink; persisted overlap makes runner ineligible while reconcile still works |
| Budgets (§6.4) | Recovery/admission global budget exhaustion with up to 256 stale attempts -> REFUSED/RECOVERY_BUDGET_EXHAUSTED before spawn, nothing consumed, durable partial progress resumes |
| Compatibility (§5.4) | Stale npm/broker pair (both directions); broker contractVersion mismatch; broker digest mismatch; qualification profile mismatch/stale live builds; downgrade of npm or broker; client check bypassed still refused by broker |

Required future Stage 5 vectors added by C2 (none implemented here):

| Area | Vectors |
|---|---|
| Mount aliases (§5.5) | Bind mount of a descendant of root A enrolled as root B (and the converse order); FUSE/bindfs mount exposing a descendant of A enrolled as B; overlay or other mount alias; root that is itself a mount point (STATX_ATTR_MOUNT_ROOT); root reached through a mount crossing below the anchor; mount placed on an enrolled root or inside it after enrollment; changed anchor dev/ino; persisted invalid alias makes every create REFUSED/INELIGIBLE before reservation while reconcile still finalizes existing attempts; kernel without STATX_MNT_ID/no-cross-mount resolution ineligible |
| Post-reservation (§6.4 P1S) | Spec, helper, fingerprint, framework metadata or Node/native mutation between reservation and SUBMITTING -> consumed EXECUTION_ERROR PRESUBMIT_FAILURE/7, never REFUSED/4, retry refused as REPLAY; S exhaustion (slow fingerprint read) -> PRESUBMIT_FAILURE; leaf/envelope creation failure; client loss in P1S -> CLIENT_LOST; broker SIGKILL at each P1S step -> reconcile Case E PRESUBMIT_FAILURE or QUARANTINED; no D-Bus call observed during P1S; same mismatch before reservation -> REFUSED/INPUT_MISMATCH/4 with nothing consumed |
| Playwright mapping (§9.4) | 1, 2 and 100 specs; testDir different from root and nested spec directories; testsuite name with "./", backslash, absolute or testDir-relative form; duplicate testsuite name; missing spec; extra non-target testsuite; file attribute present; testsuite with zero testcases; build whose naming depends on testDir fails qualification with no fallback |

Required future Stage 5 vectors added by C3 (none implemented here):

| Area | Vectors |
|---|---|
| Kernel namespaces (§5.6.1) | Broker launched in a private mount namespace (unshare -m, sudo inside a mount-namespaced session) -> REFUSED/INELIGIBLE exit 5, nothing reserved or spawned; private cgroup namespace -> same; child PID namespace whose /proc/1 is a container init -> same; fake or non-procfs /proc, /proc not a mount root; /sys/fs/cgroup not cgroup2, not a mount root, or a v1/hybrid hierarchy; bus manager credentials not resolving to PID 1; reconcile under mismatch -> REFUSED, no journal write or manager action; populated=0 forged in a private cgroup view never yields empty proof; cgroup directory dev/ino changed between readbacks -> identity failure, not empty proof; kernel without the nsfs/pidfd-equivalent primitive ineligible |
| Filesystem trust (§5.6.2) | Workspace anchor or enrolled root on FUSE, NFS, CIFS/SMB, 9p, overlay or tmpfs -> INELIGIBLE before reservation; controller durable state on such a type -> INELIGIBLE with no protected-store write; type changed between P1 and P1S -> PRESUBMIT_FAILURE/7; enrollment or request carrying a filesystem-type claim has no effect (closed schema refusal); each allowlisted type accepted |
| Workload storage (§5.6.3) | B unmounted (empty underlying directory) -> INELIGIBLE, no /run, /tmp, HOME or W fallback; B as a bind/subtree alias or exposed at a second path; B on the root filesystem, W or the state filesystem; Btrfs or non-allowlisted type; size above maxBytes; free space below minFreeBytes; missing nosuid/nodev or read-only; wrong owner/mode or extra entry in B; unknown or unbound leaf in B/workloads; 513th leaf; runner attempts to create, list or write outside its leaf; symlink or mount placed inside a leaf not followed or crossed by the broker; workload filling B -> EXECUTION_ERROR/RESULT_INVALID never PASS, and host /run, root filesystem, W and protected state unaffected; retained quarantined leaves exhausting free space -> every create INELIGIBLE until operator remediation; leaf removal interrupted and resumed by the next P1 |

Required future Stage 5 vectors added by C4 (none implemented here):

| Area | Vectors |
|---|---|
| Check order (§5.6.4) | No protected-store write, §5.5 walk, manager call or cgroup read observed before N1–N6, F2, W1, W2, W4, W3 size bound and W5 structural part; F1 observed only on the dW/dR produced by M1/M3, after the walk and before any protected-store write; W3 free space and W5 binding observed after pre-create reconciliation and before reservation; workspace/root opened by path for authoritative use after C4 -> test failure (the P1S check-only M1–M4 re-walk excepted, C5); P1S re-walk dev/ino or mount-ID mismatch with retained dW/dR -> PRESUBMIT_FAILURE/7 |
| Reconcile scope (§5.6.4) | Workspace or root moved to a type outside L, persisted overlap, mount alias or changed anchor -> CREATE REFUSED/INELIGIBLE exit 5 with no protected-store write, while RECONCILE of an existing attempt yields the same Cases A–H outcome as with valid roots; RECONCILE opens no workspace/root descriptor; RECONCILE never writes reservation/claim/PREPARED/SUBMITTING or calls StartTransientUnit; F2 or N1–N6 failure -> RECONCILE REFUSED with no journal write or manager action; W1/W2/W4 failure -> RECONCILE finalizes without touching the leaf |

Required future Stage 5 vectors added by C5 (none implemented here):

| Area | Vectors |
|---|---|
| Item-1 gate (§5.6.4 C1a/R1a) | No enrollment field (caller, workspace, roots, qualification, workloadStorage), profileDigest or caller ownership consumed and no N1–N6, F2, W1–W5, §5.5 walk, protected-store read/write, manager call or cgroup read observed before broker artifact, enrollment and compatibility.json integrity, effective root, zero argv and caller authentication pass; runner-writable or replaced enrollment/compatibility.json/broker, non-root effective UID, any argv, spoofed SUDO_*, absent/ambiguous/direct-root context or caller != enrollment caller -> CREATE REFUSED at C1a with no protected-store read or write; the same on RECONCILE -> REFUSED at R1a before any protected attempt lookup, no journal write or manager action; non-owner caller of an existing attempt refused at R4 only after R1a authentication; RECONCILE under a changed §5.4 pair or disabled enrollment still passes R1a; §5.4 mismatch observed only at C7 and never on RECONCILE |
| P1S re-walk (§5.6.4) | Workspace or root replaced, renamed or mounted over between C4 and P1S -> re-walk identity mismatch -> PRESUBMIT_FAILURE/7; re-walk descriptors never used for target, fingerprint or report access (all such access via retained dW/dR); substitution after the P1S re-walk still cannot redirect access because retained dW/dR are used |

## 13. Mandatory handoff / final-report schema

~~~text
MISSION RESULT:
DESIGN COMPLETE — report actual delivery/exact-head CI externally.
STOP BEFORE INDEPENDENT HEAVY ARCHITECTURE REVIEW.

C1 / OP-06-02 / OP-06-03:
APPLIED / APPLIED / APPLIED; only helper prohibition superseded.

PRIOR STOP / DESIGN COMMITS:
PRESERVED — full identities section 3.

CONTROLLER / PRIVILEGE / DEPLOYMENT:
Host systemd / transient .service / cgroup v2.
One root-owned operator-installed one-shot broker, no daemon.
Runner no direct manage-units/generic sudo/systemctl/systemd-run.
Target code non-root; normal product npm; opt-in/removable provisioning.

BROKER / PROPERTY / VALIDATION:
Versioned closed create/reconcile/unknown fields REFUSE.
Independent validation/broker-built fixed payload/identity/deadline.
No caller arbitrary executable/argv/env/cwd/user/slice/kill/restart.
SUT only closed policy/memory FD/same binary non-root workload mode.

LIFECYCLE / RECOVERY:
Exact namespace + protected ownership + boot/invocation/cgroup.
Consumed tombstones/no retry/finite manager deadline/A–H reconcile/
whole-tree kill/empty/durable cleanup; ambiguity quarantine7.
No PID/group fallback/immediate death-kill promise.

DESIGN COMPLETENESS:
Closed schemas/adapters/properties/journal/provisioning contract.
No broker implementation/qualified Linux tuple claimed.

TSB-F02 / SECURITY / GOVERNANCE:
Current FALSE/proposed FALSE subject to independent review.
OPEN / LOW / CONDITIONAL; TAP-2/CRS-1/PPI-1/R-1..R-5/AT-07/TB-01 unchanged.
FUTURE OPEN; Controlled Release NOT APPROVED.

SOURCE / PACKAGE / EXPORTS / EXECUTE / STAGE5:
UNCHANGED / UNCHANGED / UNCHANGED / DISABLED / NOT AUTHORIZED.

DELIVERY:
Actual HEAD/TREE/parent/scope/PR/checks; no premature CI success.

INDEPENDENT REVIEWS / MERGE / RELEASE:
NOT STARTED / NOT AUTHORIZED / NOT APPROVED.
~~~

## 14. Architecture corrective C1

Authority: OD-CONTROLLED-V1-OD-06-ARCH-C1 — APPROVED. One consolidated
documentation-only corrective of PR #254 for the six findings of the
independent HEAVY Architecture review (CHANGES REQUIRED) of the exact HEAD
below. The full OD-06 design is not reopened; all owner decisions in
sections 3–6 (C1 containment, OP-06-02 systemd/cgroup, OP-06-03 scoped
broker, runner dispositions, bounded orphan model, containment-only claim,
no daemon, npm primary product) are unchanged.

| Fact | Value |
|---|---|
| Reviewed HEAD / tree | 61aeb27236ce346f93a9dfb1cfe4aed4518f1693 / 2aef65cc3a5f33394e42203489cdfdb548ebf2b7 |
| Base | 126d105841cf404c92752ae54bb616ed710d7f53 |
| Changed-file allowlist | docs/controlled-v1-execution-contract-v1.md only |
| Commit policy | Exactly one direct child of the reviewed HEAD; no amend/squash/rebase/reset/force-push |

| Finding | Corrected sections |
|---|---|
| C1-M1 broker observation/result protocol | §4.2 (stdin frames), §7 (OBSERVED state, proposal text), §7.1 identity handoff, §7.2 closed frames, §7.3 completion observation and ordering, §7.4 crash matrix, §11.2 proposal, §11.3 frame/response, §12 vectors |
| C1-M2 Cypress multi-spec reporting | §8.2 Cypress argv (root-relative specs, [hash] report name), §9.1 report directory and launch-size bounds, §9.2 capture, §9.4 report contract and accounting, §11.3 capture schema, §12 vectors |
| C1-M3 overlapping enrolled roots | §4.3 item 2, §5.5 non-overlap invariant, §7 concurrency identity, §8.1 item 6 link count, §12 vectors |
| C1-m1 Cypress exit semantics | §8.2 --posix-exit-codes, §9.3 decision precedence, §12 vectors |
| C1-m2 recovery/admission vs execution budgets | §6.3 (single bound removed), §6.4 phase budgets, §7 recovery count, §11.3 RECOVERY_BUDGET_EXHAUSTED, §12 vectors |
| C1-m3 product/broker compatibility identity | §4.3 item 1, §5.2 enrollment/compatibility file, §5.3, §5.4 compatibility record, §11.1 domain, §11.3 INCOMPATIBLE, §12 vectors |

Multi-spec maximum stays 100 (option A). No release pair is approved here.
Governance unchanged: RELEASE_CAPABILITIES.execute disabled; reviewRecord
and apply enabled; TSB-F02 OPEN / LOW / CONDITIONAL, current supported
surface trigger FALSE, proposed execute trigger FALSE (§10 revalidation);
TAP-2/CRS-1/PPI-1, R-1..R-5, AT-07/TB-01 residual and FUTURE guards
unchanged; Controlled Release NOT APPROVED.

C1 corrective changes are completed and ready for independent re-review.
The prior Architecture review applied only to the reviewed HEAD above and is
invalidated by the C1 commit; a new full independent HEAVY Architecture
exact-head re-review is required. Security review not started. Merge not
authorized. This section does not mark any review APPROVED.

## 15. Architecture corrective C2

Authority: OD-CONTROLLED-V1-OD-06-ARCH-C2 — APPROVED. One documentation-only
delta corrective of PR #254 for exactly the three MINOR findings of the
independent HEAVY Architecture re-review (CHANGES REQUIRED, 0 MAJOR /
3 MINOR) of the C1 HEAD below. C1 resolutions, OP-06-C1/OP-06-02/OP-06-03,
the broker/systemd/cgroup model, runner dispositions and all owner decisions
are unchanged. INFO observations of that review are out of scope.

| Fact | Value |
|---|---|
| Reviewed HEAD / tree | 12c6a589d3d456914e28be09d7c032fc44e8c6c4 / 9b9d8663ae1214d64ac833765c0a45aff4fed197 |
| Base | 126d105841cf404c92752ae54bb616ed710d7f53 |
| Changed-file allowlist | docs/controlled-v1-execution-contract-v1.md only |
| Commit policy | Exactly one direct child of the reviewed HEAD; no amend/squash/rebase/reset/force-push |

| Finding | Corrected sections |
|---|---|
| C2-m1 descendant mount alias | §4.3 item 2 (anchor, mount rule), §5.2 enrollment workspace key, §5.5 mount invariant M1–M4/comparison procedure/persisted violation/claims consequence, §12 C2 vectors |
| C2-m2 post-reservation recheck window | §6.4 P1S phase row/coverage/outcome text and synchronous sum, §7 Case E, §7.4 S1 row, §8.1 item 7 (exit 4 only pre-reservation), §11.3 PRESUBMIT_FAILURE reason, §12 C2 vectors |
| C2-m3 Playwright report-to-spec mapping | §9.3 single-rule mapping text, §9.4 Playwright row/qualification (a)–(d)/normalization/completeness, §12 C2 vectors |

New closed values: enrollment key workspace; phase P1S with bound S=30000 ms;
reason PRESUBMIT_FAILURE (EXECUTION_ERROR, exit 7). No new exit code,
refusal enum, frame, state, export, owner decision or implementation.
Governance unchanged: RELEASE_CAPABILITIES.execute disabled; TSB-F02 OPEN /
LOW / CONDITIONAL, current FALSE, proposed FALSE (§10 C2 revalidation);
TAP-2/CRS-1/PPI-1, R-1..R-5, AT-07/TB-01 and FUTURE guards unchanged;
Controlled Release NOT APPROVED.

C2 corrective changes are completed and ready for independent re-review.
The C1 re-review applied only to the reviewed HEAD above and is invalidated
by the C2 commit; a new full independent HEAVY Architecture exact-head
re-review is required. Security review not started. Merge not authorized.
This section does not mark any review APPROVED.

## 16. Security corrective C3

Authority: OD-CONTROLLED-V1-OD-06-SEC-C3 — APPROVED. One documentation-only
delta corrective of PR #254 for exactly the three MEDIUM findings of the
independent HEAVY Security review (CHANGES REQUIRED) of the C2 HEAD below,
which independent HEAVY Architecture re-review had APPROVED. The
Architecture-approved C2 design, all resolved C1/C2 findings,
OP-06-C1/OP-06-02/OP-06-03, the broker/systemd/cgroup model and runner
dispositions are unchanged except where these findings require correction.
LOW/INFO observations of that review are out of scope and preserved for
re-review/Stage 5 hardening.

| Fact | Value |
|---|---|
| Reviewed HEAD / tree | 5c1f2311786fadb060fb45af52cb5afeb86f7e8d / b62ba0bf65b6fbcc0dce555199b31f244e16d983 |
| Base | 126d105841cf404c92752ae54bb616ed710d7f53 |
| Changed-file allowlist | docs/controlled-v1-execution-contract-v1.md only |
| Commit policy | Exactly one direct child of the reviewed HEAD; no amend/squash/rebase/reset/force-push |

| Finding | Corrected sections |
|---|---|
| C3-M01 mount/cgroup namespace identity | §4.3 item 6 (unit namespace) and item 8, §5.2 check list, §5.6 preamble, §5.6.1 N1–N6 (PID1 anchor, mount/cgroup nsfs identity, cgroup-v2 anchor = initial/PID1 hierarchy, single-descriptor validate-and-use, no fallback), §6.3 cgroup.events read, §6.4 P1/P1S coverage, §7.3 observation, §11.1 cgroupPath, §12 C3 vectors |
| C3-M02 trusted local filesystem | §4.3 item 2 (storage = live check), §5.2 state-location row, §5.6.2 F1–F4 (existing Stage 4 allowlist, workspace anchor/roots/durable state, P1 + P1S + enrollment timing, no caller claim), §12 C3 vectors |
| C3-M03 bounded workload storage | §5.2 table rows and qualification.workloadStorage, §5.6.3 (dedicated root-provisioned mount B, ext4/XFS/F2FS, maxBytes/minFreeBytes, W1–W6 identity/type/size/options/purpose proof, per-attempt leaf access, cleanup/quarantine bound, no /run fallback), §6.4 P1S, §9.1 attempt paths, §9.4 reportsDir, §12 C3 vectors |

New closed values: enrollment qualification key workloadStorage
{fsType,maxBytes,minFreeBytes}; fixed mount point /var/lib/qa-agent-workload-v1.
No new exit code, refusal enum, frame, state, reason, export, owner decision
or implementation; failures map to existing REFUSED/INELIGIBLE exit 5
(pre-reservation) or EXECUTION_ERROR PRESUBMIT_FAILURE exit 7 (P1S). The PO
did not accept shared /run exhaustion as a residual; it is removed by design.
No new residual-risk acceptance. §9.2/§9.4 report/path/accounting limits
unchanged. Governance unchanged: RELEASE_CAPABILITIES.execute disabled;
public API/exports unchanged; TSB-F02 OPEN / LOW / CONDITIONAL, current
FALSE, proposed FALSE (§10 C3 revalidation); TAP-2/CRS-1/PPI-1, R-1..R-5,
AT-07/TB-01 and FUTURE guards unchanged; Controlled Release NOT APPROVED.

C3 corrective changes are completed and ready for independent re-review.
The Architecture and Security reviews of the reviewed HEAD above are
invalidated by the C3 commit. Next: independent HEAVY Architecture
exact-head re-review, then, only if APPROVED, independent HEAVY Security
exact-head re-review. Merge not authorized. This section does not mark any
review APPROVED.

## 17. Architecture corrective C4

Authority: OD-CONTROLLED-V1-OD-06-ARCH-C4 — APPROVED. One documentation-only
delta corrective of PR #254 for exactly the one MINOR finding ARCH-C3-m01
(F1 placement and reconcile scope) of the independent HEAVY Architecture
re-review (CHANGES REQUIRED, 0 MAJOR / 1 MINOR) of the C3 HEAD below.
C3-M01/C3-M02/C3-M03 security resolutions, all C1/C2 closures, the
state/P1S model, OP-06-C1/OP-06-02/OP-06-03, the broker/systemd/cgroup model
and runner dispositions are unchanged. INFO observations of that review
(free-inode hardening, thin-LV wording, report-walk anchoring, HOME/TMPDIR
wording) are out of scope and preserved for re-review/Stage 5 hardening.

| Fact | Value |
|---|---|
| Reviewed HEAD / tree | 987b99cee788b31005ca217a6b05d18099203278 / 58e3a54a599d2f17e2e41b978061fc886fe0dfa4 |
| Base | 126d105841cf404c92752ae54bb616ed710d7f53 |
| Changed-file allowlist | docs/controlled-v1-execution-contract-v1.md only |
| Commit policy | Exactly one direct child of the reviewed HEAD; no amend/squash/rebase/reset/force-push |

| Finding part | Corrected sections |
|---|---|
| F1 ordering | §4.3 item 8, §5.5 comparison procedure (retained dW/dR, no path re-resolution), §5.6 preamble, §5.6.2 F1/F3/F4, §5.6.3 W5 ordering exceptions (normative MUST), new §5.6.4 CREATE order C1–C7/P1S, §6.4 P1/P1S coverage, §12 C4 vectors |
| Reconcile scope, approved rule (a) | §4.3 item 8, §5.4 reconcile sentence, §5.5 persisted-violation text, §5.6 preamble, §5.6.2 F1/F3/F4, §5.6.3 reconcile leaf rule, §5.6.4 RECONCILE order R1–R7 and outcome table, §6.4 P1, §7 stored binding, §12 C4 vectors |

Result: for CREATE, N1–N6 and the descriptor-independent §5.6 checks run
before §5.5; F1(W)/F1(R) run on the M1/M3 descriptors, which are retained
for all later use, and remain mandatory before any protected-store write
and before reservation/start; W3 free space and W5 binding are the only
explicit post-recovery exceptions. RECONCILE is recovery/finalization only:
it requires N1–N6, F2 and W1/W2/W4 for leaf access, relies on the protected
journal and immutable stored binding, never evaluates F1 or current §5.5
eligibility and never grants reservation/start authority. Invalid current
workspace/root trust: CREATE REFUSED/INELIGIBLE exit 5; RECONCILE of an
existing attempt permitted and deterministic.

No new closed value, exit code, refusal enum, frame, state, reason, export,
owner decision or implementation. No new residual-risk acceptance.
Governance unchanged: RELEASE_CAPABILITIES.execute disabled; public
API/exports unchanged; TSB-F02 OPEN / LOW / CONDITIONAL, current FALSE,
proposed FALSE (§10 C4 revalidation); TAP-2/CRS-1/PPI-1, R-1..R-5,
AT-07/TB-01 and FUTURE guards unchanged; Controlled Release NOT APPROVED.

C4 corrective changes are completed and ready for independent re-review.
The Architecture re-review of the reviewed HEAD above is invalidated by the
C4 commit. Next: independent HEAVY Architecture exact-head re-review, then,
only if APPROVED, independent HEAVY Security exact-head re-review. Merge not
authorized. This section does not mark any review APPROVED.

## 18. Architecture corrective C5

Authority: OD-CONTROLLED-V1-OD-06-ARCH-C5 — APPROVED. One documentation-only
delta corrective of PR #254 for exactly the one MINOR finding ARCH-C4-m01
(§4.3 item 1 placement in the single normative order) of the independent
HEAVY Architecture re-review (CHANGES REQUIRED, 0 MAJOR / 1 MINOR) of the C4
HEAD below, plus the clarification-only INFO I-1 (P1S re-walk). C4 F1
ordering and reconcile rule (a), C3-M01/C3-M02/C3-M03 security resolutions,
all C1/C2 closures, the state/P1S model, OP-06-C1/OP-06-02/OP-06-03, the
broker/systemd/cgroup model and runner dispositions are unchanged. Other
INFO observations of that review are out of scope and preserved.

| Fact | Value |
|---|---|
| Reviewed HEAD / tree | 91943036d885e94760762e277120e174c397e9b5 / a1014b77bc25b9e97a1bbb3794dc988cf97f32ac |
| Base | 126d105841cf404c92752ae54bb616ed710d7f53 |
| Changed-file allowlist | docs/controlled-v1-execution-contract-v1.md only |
| Commit policy | Exactly one direct child of the reviewed HEAD; no amend/squash/rebase/reset/force-push |

| Finding part | Corrected sections |
|---|---|
| CREATE item-1 placement | §4.3 items 1 and 8, §5.4 broker validation, §5.6 preamble, §5.6.4 new step C1a, C4 enrollment reference, C7 narrowed to the §5.4 compatibility/pair part, failure sentence and outcome table, §6.4 P1, §12 C5 vectors |
| RECONCILE item-1 placement | §4.3 item 1, §5.6.4 new step R1a, R4 ownership after R1a, outcome table, §6.4 P1, §7 recovery caller, §12 C5 vectors |
| INFO I-1 re-walk clarification | §5.5 retained-descriptor sentence, §5.6.2 F3, §5.6.4 P1S, §6.4 P1S, §12 C4 vector wording and C5 vectors |

Result: the §4.3 item 1 integrity/authentication gate (broker artifact,
enrollment and compatibility.json integrity, effective root, zero argv,
authenticated enrolled caller) runs read-only at C1a immediately after P0,
before N1–N6 and any enrollment-, qualification-, workloadStorage-,
profile- or caller-dependent operation; protected-state integrity remains
F2 plus transaction recovery, and the §5.4 compatibility/pair part runs
only at C7. RECONCILE runs the same gate at R1a, without the §5.4 part or
the enrollment enabled flag, before any caller, attempt or enrollment
identity use or protected attempt lookup; R4 ownership uses only the
R1a-authenticated caller. RECONCILE remains recovery/finalization only with
no reservation/start authority. The P1S M1–M4 re-walk is intentional
check-only path re-resolution for substitution detection; the
no-re-resolution invariant governs authoritative use of the retained dW/dR.

No new closed value, exit code, refusal enum, frame, state, reason, export,
owner decision or implementation. No new residual-risk acceptance.
Governance unchanged: RELEASE_CAPABILITIES.execute disabled; public
API/exports unchanged; TSB-F02 OPEN / LOW / CONDITIONAL, current FALSE,
proposed FALSE (§10 C5 revalidation); TAP-2/CRS-1/PPI-1, R-1..R-5,
AT-07/TB-01 and FUTURE guards unchanged; Controlled Release NOT APPROVED.

C5 corrective changes are completed and ready for independent re-review.
The Architecture re-review of the reviewed HEAD above is invalidated by the
C5 commit. Next: independent HEAVY Architecture exact-head re-review, then,
only if APPROVED, independent HEAVY Security exact-head re-review. Merge not
authorized. This section does not mark any review APPROVED.

## 19. Final certification record (current lifecycle overlay)

Authority: OD-CONTROLLED-V1-OD-06-CANONICAL-CLOSURE — APPROVED;
OD-CONTROLLED-V1-OD-06-CANONICAL-CLOSURE-C1-SCOPE — APPROVED.
Documentation/governance record only. Sections 3–18 are unchanged and
remain the approved normative OD-06 design. This section adds no closed
value, exit code, frame, state, reason, export, owner decision or
implementation.

| Fact | Value |
|---|---|
| Design PR | #254 |
| Reviewed HEAD / TREE | d6fb535639b004e661c2b5aa2576476a12d9baa7 / 4d7daaa2fbdcb29466f780683d85c1761965c101 |
| Merge SHA / TREE | 22ceb0682f9b56c2fbefdbad35273b7c21225d89 / 4d7daaa2fbdcb29466f780683d85c1761965c101 (equals reviewed TREE) |
| Topology / parents | STANDARD_TWO_PARENT; 126d105841cf404c92752ae54bb616ed710d7f53, d6fb535639b004e661c2b5aa2576476a12d9baa7 |
| Post-merge CI | run 38592925997; event push; head SHA 22ceb0682f9b56c2fbefdbad35273b7c21225d89; completed / success; 7/7 jobs |
| Architecture (independent HEAVY, C5 HEAD) | APPROVED — 0 MAJOR / 0 MINOR |
| Security (independent HEAVY, C5 HEAD) | APPROVED — 0 CRITICAL / 0 HIGH / 0 MEDIUM |
| Carried Security debt | 7 LOW + 5 INFO — OPEN / PRESERVED; not closed, waived or re-rated |
| OD-06 | COMPLETE_ON_MAIN / POST-MERGE CERTIFIED |
| Stage 5 | READY / NOT AUTHORIZED |
| Execute | DISABLED (RELEASE_CAPABILITIES.execute disabled; reserved fixed refusal, exit 5) |
| Controlled Release | NOT APPROVED |
| TSB-F02 | OPEN / LOW / CONDITIONAL; current trigger FALSE; proposed execute trigger FALSE (§10) |

### 19.1 Carried Security review debt (canonical record)

Authority: OD-CONTROLLED-V1-OD-06-CANONICAL-CLOSURE-C2 — APPROVED
(corrective for LIGHT-OD06-B01). This subsection is the durable canonical
source for all 12 final Security findings carried from the independent
HEAVY Security review of the C5 HEAD. It records them only: it does not
close, waive, re-rate, promote or reinterpret any item and adds no
requirement beyond the recorded finding. Each item is a Stage 5
implementation, qualification or adversarial-test input.

| ID | Severity | Finding (as carried) | Disposition |
|---|---|---|---|
| L1 | LOW | Root P0 parser hardening: process-level prechecks where appropriate; memory-safe frame parser or fuzz qualification. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| L2 | LOW | CREATE with enrollment `enabled=false`: explicit REFUSED / INELIGIBLE, exit 5. RECONCILE continues to ignore the flag as already designed. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| L3 | LOW | P0 boundary: P0 remains grammar/structural only; enrollment-relative comparisons occur only after C1a at their normative steps. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| L4 | LOW | Same-account authority: Stage 5 qualification requires Yama `ptrace_scope >= 1` or equivalent and absence of same-account command agents capable of recovering broker authority. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| L5 | LOW | Workload-storage backing: thick, non-overcommitted, non-CoW backing qualification. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| L6 | LOW | Workload-storage inode resource: free-inode / `f_favail` floor. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| L7 | LOW | Broker resource bound: global concurrent root-broker invocation cap with fail-closed refusal beyond the bound. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| I1 | INFO | C1a refusal-reason tabulation / operability. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| I2 | INFO | Optional stronger initial-namespace defence-in-depth. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| I3 | INFO | WorkingDirectory / Node argv post-P1S substitution remains within accepted R-4 (linked: R-4). | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| I4 | INFO | Qualify sudo `use_pty` / relay behaviour and exact pipe plus EOF/EPIPE client-loss semantics. | OPEN / PRESERVED / CARRIED TO STAGE 5 |
| I5 | INFO | Account-writable `/tmp`, `/dev/shm` and repository remain accepted R-5 territory (linked: R-5). | OPEN / PRESERVED / CARRIED TO STAGE 5 |

Totals: 7 LOW (L1–L7) + 5 INFO (I1–I5) = 12, all OPEN / PRESERVED /
CARRIED TO STAGE 5. Security verdict, severity counts and R-4/R-5
ACCEPTED classifications are unchanged.

Security boundary: OD-06 provides **process-lifecycle containment only**
(scoped controller broker, transient systemd service, cgroup v2 lifecycle,
bounded reconciliation). It does **not** provide filesystem sandboxing,
network isolation, secret isolation, same-account isolation, or
hostile/malicious-test sandbox isolation beyond that explicitly defined
containment. R-5 (harmful tests retain account filesystem/network/SUT
authority) is unchanged.

Unchanged: TAP-2/CRS-1/PPI-1, R-1..R-5 ACCEPTED, AT-07/TB-01 RESIDUAL,
FUTURE guards OPEN, public API/exports, CLI grammar and exit codes.
Design certification is not runner certification, Linux/native/installed-
package qualification or activation; each still requires the separately
authorized Stage 5 lifecycle (§12). This canonical-closure sync itself
requires independent exact-head LIGHT review and separate PO merge
authorization; its merge is NOT AUTHORIZED.

## 20. Stage 5 design-gap resolution (PROPOSED)

Authority: OD-CONTROLLED-V1-STAGE5-DESIGN-GAP-RESOLUTION — APPROVED (mission
authority). Status of this section: **PROPOSED** normative design; it is
not approved until independent exact-head HEAVY Architecture review, then
(only if Architecture APPROVED on the same HEAD) independent exact-head HEAVY
Security review, then separate Product Owner design acceptance. Merge of this
section does not authorize Stage 5 implementation; that needs a new,
separate Product Owner authorization against the then-certified main.

| Fact | Value |
|---|---|
| Base main / TREE | 52e23acf0f7e5d2f7fce2b406a27de51ae1af68c / 176960ba98b1e7babfee553729200c49d748d7ca |
| Trigger | Stage 5 implementation preflight (2026-10-15) STOPPED before code; no Stage 5 commit exists |
| Changed-file allowlist | docs/controlled-v1-execution-contract-v1.md; from C2 also native/qa-agent-controller-v1/Containerfile (versioned build-provenance design artifact, §20.3.4a; no broker source) |
| Host of this authoring | Windows; not Linux, sudo, systemd or native evidence |
| Execute / Controlled Release | DISABLED / NOT APPROVED |
| Corrective C1 | OD-CONTROLLED-V1-STAGE5-DESIGN-GAP-C1 — resolves ARCH-S5-m01..m07 of the HEAVY Architecture review of de37be62c16daf10413736cb489efc11abc4ff60 (§20.9); still PROPOSED |
| Corrective C2 | OD-CONTROLLED-V1-STAGE5-DESIGN-GAP-C2 — resolves SEC-S5-m01 and SEC-S5-m02 and corrects Security INFO-2/3/4/6 of the HEAVY Security review of 101122bff15b0c227de76908a1b5e82c4a4269f9 (§20.10); still PROPOSED |

### 20.0 Scope, precedence and unchanged invariants

§20 closes exactly DG-1..DG-4. Sections 3–19 stay in force. §20 supersedes
only the sentences listed here, and only as stated:

| Superseded or refined text | Replacement |
|---|---|
| §5.1 "Sudo must supply/overwrite authentication metadata unforgeably under allowed options; broker uses that qualified context" | §20.2: kernel socket-credential authentication; no sudo environment or plugin metadata is read |
| §5.1 sudoers rule shape | §20.2.3 exact rule plus exact Defaults line (superset of the §5.1 shape) |
| §5.1 client launch "shell:false, framed stdin" | §20.2.4 exact spawn (adds new session, fixed stdio kinds, fixed sudo environment) |
| §7.2 "exactly the two pipes" | Unchanged meaning; the two byte streams are the AF_UNIX SOCK_STREAM socketpair ends of §20.2.4 |
| §5.6.4 C1a/R1a "authenticated caller from the qualified sudo context" | §20.2.5 sub-steps C1a.1–C1a.5 |
| §5.6.4 C7 | §20.1.6 adds step C7-PV (public enrollment view equality) |
| §5.6.4 R4 lookup of an absent attempt (unspecified) | §20.4.7 clarification: REFUSED/INPUT_MISMATCH |
| §8.2 fingerprint membership "profile-enumerated" | §20.1.4 membership rule |
| §4.2 "Current config v1 unchanged ... No new CLI option authorized by this design" | §20.4: closed future grammar and config v2, effective only with Stage 5 implementation; still no activation |
| §5.3 "Distribution/signature/release packaging ... require later release approval" | §20.3 fixes the model; publication of any build and any compatibility pair still requires release approval |
| §3 runner row "macOS / generic Linux / GitHub-hosted Linux / containerized Linux / generic VM — DEFERRED" | §20.0.1 disposition table; §3 text is retained as history and the §20.0.1 table governs |
| §3 runner row "Provisioned self-hosted Linux — Initial candidate" | Refined, not replaced: eligible only as §20.3.6 class D on the named reference target after qualification |
| §8.2 "exact qualified executable JS/reporter closure", "profile-enumerated static config imports" (producer and algorithm unspecified) | §20.1.4a closed enumeration procedure od06-q-enum-v1 |

Unchanged and not reopened: process-lifecycle containment only; R-1..R-5
classifications; AT-07/TB-01 RESIDUAL; FUTURE guards OPEN; Stage 4
review/apply semantics; TAP-2; CRS-1; PPI-1; #23F; both approval gates;
OP-06-02/OP-06-03; the §4.2 request, §7.2 frames, §7 states, §9.3 exits,
§11 schemas and hash domains; the §3 Windows REFUSED row and the §3 VM
sentence ("may physically be a VM"); the productization §10.7 exit taxonomy
and its pipeline tie rule, which §20.4.5 follows without exception. No new
exit code, broker frame, journal state, record reason, refusal enum or hash
domain is introduced. New closed values are listed in §20.6.

#### 20.0.1 Runner disposition after §20 (supersedes the §3 DEFERRED row)

Every class named in the §3 DEFERRED row is assigned exactly one
disposition here. Nothing outside this table changes a §3 disposition.

| §3 class | §20 disposition | Governing row |
|---|---|---|
| macOS | Narrowed to **REFUSED** (no Linux containment primitives) | §20.3.6 "Windows / macOS hosts" |
| GitHub-hosted Linux | Narrowed to **REFUSED** for execute; build and unprivileged tests only (class A, never qualification evidence) | §20.3.6 "GitHub-hosted runners for execute", class A |
| Containerized Linux (Docker, Podman, LXC, Kubernetes) and WSL2 | Narrowed to **REFUSED** for execute; build and unprivileged tests only (class A) | §20.3.6 "Containers", "WSL2", class A |
| Generic Linux — Debian 13 (trixie) amd64 on a dedicated self-hosted host or dedicated VM that is itself the qualified host | **SUPPORTED** only as the named reference target, only for an exact recorded tuple after Stage 5 qualification | §20.3.6 class D |
| Generic Linux — Debian 13 disposable integration and adversarial VMs | **QUALIFICATION-ONLY** (never execute eligibility) | §20.3.6 classes B, C |
| Generic Linux — any host whose sudo is not upstream sudo | Narrowed to **REFUSED** | §20.3.6 "not upstream sudo" |
| Generic Linux — Ubuntu 24.04 LTS, every other distribution or release, aarch64 | Still **DEFERRED** | §20.3.6 Ubuntu, "Other distributions", aarch64 rows |
| Generic VM — not dedicated, or not itself the qualified host (shared, nested-only, provider-managed) | Still **DEFERRED** | §3 VM sentence; §20.3.6 class D |

Windows stays REFUSED (§3, unchanged). DEFERRED keeps its §3 meaning:
no support, not a refusal decision, and reopening needs an owner decision.
REFUSED needs an owner decision to reverse. No class becomes eligible by
labels, configuration booleans or this table alone.

### 20.1 DG-1 — fingerprintDigest client handoff

#### 20.1.1 Reconstructed gap

§7.1/§11.1: the client computes bindingDigest over a binding that contains
fingerprintDigest and profileDigest. profileDigest is client-readable inside
the 0644 §5.4 record. fingerprint lives only in enrollment.json, which §5.2
fixes root:root 0600, and §11.1 forbids the client to read enrollment. §8.2
"profile-enumerated static config imports" and "exact qualified executable
JS/reporter closure" give no algorithm the client could run to derive the
member list. Result: the client cannot compute bindingDigest without either
reading enrollment, guessing, or omitting the field.

#### 20.1.2 Alternatives

| Option | Security | Fail-closed / staleness | Implementability / burden | OD-06 impact | Verdict |
|---|---|---|---|---|---|
| A. Root-authored public view: root:root 0644 file with, per enrolled root, the full fingerprint object; broker requires byte equality with a view it derives from enrollment | No runner write path; broker never uses it for authority | Any drift = runner INELIGIBLE; a stale view cannot reach the binding comparison | One more operator-written file; broker comparison is byte equality (no parse) | Additive; enrollment schema, mode and the §11.1 "never from enrollment" rule unchanged | **SELECTED** |
| B. Make enrollment readable by the runner (0640 root:runner) | No secret in it, but widens runner visibility of workspace/qualification/other roots | Same as broker | Trivial | Changes the §5.2 mode and the §11.1 rule | Rejected: reopens OD-06 decisions for no security gain |
| C. Broker "describe" operation returning fingerprintDigest | Adds a privileged operation reachable by the runner | Fine | New request kind, new frame | Violates the closed create/reconcile interface (§4.2) | Rejected |
| D. Client omits fingerprintDigest; broker inserts it | — | — | — | Changes the §11.1 binding/bindingDigest and every record/claim | Rejected: forbidden omission |
| E. Client derives the member list itself (JS import analysis) | Client-side static analysis of untrusted target JS | Derivation disagreements become ambiguous failures | Large; dynamic imports undecidable | Needs a JS analyzer in two languages | Rejected |

Option A plus the §20.1.4 membership rule is selected. The view carries the
complete fingerprint, not only its digest, so the client can verify fresh
bytes before invoking the broker. The paths and hashes are not secret: the
runner can already read every listed file.

#### 20.1.3 Public enrollment view — location, owner, schema

Path: /usr/local/share/qa-agent-controller-v1/enrollment-public.json
(compiled literal in the broker; product literal in the client). Owner
root:root, mode 0644, regular, link count 1, not a symlink, size 1..1048576
bytes. Parent /usr/local/share/qa-agent-controller-v1 root:root 0755.
Writer: the operator, as root, in the same install/requalification
transaction that writes enrollment.json and compatibility.json (§5.3). Npm,
the client and the broker never write it.

Protected-path predicate PP, used by broker and client for this file and,
as a clarification of §5.2 "protected ancestors", for compatibility.json,
the broker artifact and /usr/bin/sudo: each component from "/" is opened
relative to its parent with no symlink resolution (openat2
RESOLVE_NO_SYMLINKS in the broker; O_NOFOLLOW per component in the client);
every directory has owner UID 0 and (mode & 0o022) == 0; mount crossings are
permitted on these fixed system paths (unlike the §5.5 workspace walks).
Hosts whose distribution default makes /usr/local or a subdirectory
group-writable (for example root:staff 2775) fail PP until the operator
removes group write; that is a qualification failure, never a relaxation.

Closed schema QaAgentControllerPublicEnrollment v1, all keys required:

| Key | Value |
|---|---|
| kind | "QaAgentControllerPublicEnrollment" |
| schemaVersion | 1 |
| contractVersion | "qa-agent-controller-v1" |
| compatibilityDigest | H, equal to enrollment.compatibilityDigest |
| caller | exactly enrollment.caller {uid,gid,account} |
| roots | 1..64 entries, sorted by rootDigest bytewise ascending, unique; each exactly {rootDigest, fingerprint} |
| roots[].rootDigest | H = Stage 4 root-identity-v1 digest of enrollment roots[i].root, equal to roots[i].root.digest |
| roots[].fingerprint | exactly enrollment roots[i].fingerprint {algorithm,files,digest} (§8.2) |

File bytes: exactly the CRS-1 encodeValue canonical encoding (§11.1) of the
object, no BOM, no trailing newline. There is no self-digest field and no new
hash domain: authority comes from root ownership plus the broker's byte
equality, never from a hash alone.

#### 20.1.4 Fingerprint membership and canonical hashing

Membership (closes the §8.2 gap). files = M ∪ Q, sorted bytewise by path,
unique, 1..4096 entries, total size <= 67108864:

- M, mandatory adapter members, literal per adapter version.
  od06-cypress-v1: cypress.config.js, package.json, package-lock.json,
  node_modules/cypress/package.json, node_modules/cypress/bin/cypress.
  od06-playwright-v1: playwright.config.js, package.json,
  package-lock.json, node_modules/@playwright/test/package.json,
  node_modules/@playwright/test/cli.js,
  node_modules/playwright/package.json,
  node_modules/playwright-core/package.json.
- Q, operator-qualified closure members: exactly the output of the closed
  procedure od06-q-enum-v1 (§20.1.4a), recorded as data in enrollment.
  Neither client nor broker recomputes Q at runtime; runtime enforcement is
  the exact listed set. Constructs that §20.1.4a leaves outside Q remain
  R-4 (unchanged).

Applied target specs are bound by targets[].afterDigest, not by the
fingerprint, and are not members. A member path is canonical root-relative
(§4.2 path rules, PPI-1 segment grammar), <=300 bytes. The broker refuses an
enrollment whose files lack any M member of the root's adapter
(INELIGIBLE, at C7 before the binding comparison).

Hashing, with no normalization of any value:

- files[].sha256 = "sha256:" + lowercase hex of SHA-256 over the raw file
  bytes, no domain prefix (the Stage 4 run-store content-digest
  convention); size = exact byte length as a safe integer.
- fingerprint.digest = H with domain "qa-ai-agent:execution-fingerprint:v1:"
  over encodeValue({algorithm, files}).
- profileDigest = H with domain "qa-ai-agent:execution-profile:v1:" over
  encodeValue(qualification). Version and build fields are hashed as the
  exact enrolled strings (no semver parsing or case folding); integers as
  safe integers; frameworkProfiles sorted by framework ascending;
  fingerprint files and sutNames sorted bytewise.
- compatibilityDigest = H with domain "qa-ai-agent:execution-compatibility:v1:"
  over the canonical §5.4 record; compatibility.json bytes are exactly that
  canonical encoding.
- Root digest: Stage 4 root-identity-v1 (domain
  "qa-ai-agent:repository-root-binding:v1:", unchanged).

#### 20.1.4a Q enumeration procedure od06-q-enum-v1 (closed)

Producer and time. The operator runs od06-q-enum-v1 as part of Stage 5
qualification tooling (never shipped in the npm package, never invoked by
the client or the broker), on the qualified host, against the exact
enrolled root, after the target's dependencies are installed and before
enrollment.json is written. Its output is data that the operator reviews
and writes as root; it is not a runtime authority source, and the broker
trusts only the root-owned enrollment that results.

Privilege (C2, normative). od06-q-enum-v1 MUST NOT RUN AS ROOT. It runs as
an unprivileged qualification user (the enrolled runner account, or a
dedicated non-root account) whose only required access is read access to
the enrolled root's target inputs that the procedure opens. At start it
requires getresuid() and getresgid() to contain no 0 and its permitted,
effective and ambient capability sets to be empty, and otherwise refuses
to run. It is not started through sudo, doas, run0, pkexec, a setuid or
file-capability helper, or any other elevation. A member, directory or
specifier that the user cannot open or read is a procedure failure
(qualification FAIL for that root), never a reason to grant the procedure
root, CAP_DAC_READ_SEARCH, ACL exceptions or any other privileged
filesystem access.

Fixed parameters. N = the exact qualified Node version of the profile
(qualification.nodeVersion); resolution and module-format rules are those
documented for exactly N; no --conditions, loaders, hooks, NODE_OPTIONS,
NODE_PATH or --preserve-symlinks; the condition sets are N's defaults for
require and for import. A procedure revision is a new literal, never an
in-place change.

Starting entrypoints E (literal per adapter version; all are also M
members):

| Adapter | E |
|---|---|
| od06-cypress-v1 | cypress.config.js; node_modules/cypress/bin/cypress |
| od06-playwright-v1 | playwright.config.js; node_modules/@playwright/test/cli.js |

The fixed junit reporter (§8.2) is built into the framework; it is covered
only through edges reachable from E, never through a separate list.

Algorithm (worklist over canonical root-relative paths; visited set; the
output is a set, so traversal order cannot change it):

1. Module format of each JavaScript member (.js, .cjs, .mjs and the
   extensionless E member) is N's documented determination (extension,
   nearest package.json "type", and N's syntax detection where N enables
   it). The file is parsed as an ECMAScript program of that goal (hashbang
   allowed). A parse error fails the procedure.
2. Edges recognized syntactically, each only with a specifier that is a
   string literal or a template literal without substitutions: import and
   export ... from declarations; import(specifier); a call
   require(specifier) whose callee is the identifier require with exactly
   one argument; require.resolve(specifier) with exactly one argument. Over-
   inclusion through a shadowed require is harmless (more members or a
   recorded unresolved specifier).
3. Every other construct is a dynamic site and is never resolved: a
   non-literal argument to import() or require(), module.require,
   createRequire results, eval and Function, fs-based loading, and any
   computed callee. Each is recorded as {path, line, column} in the evidence
   record.
4. Resolution of a recognized specifier from its importing file uses N's
   documented algorithms: the CommonJS require resolution (relative paths,
   exact file, then extension probing in N's order, directory package.json
   "main", directory index files, ancestor node_modules directories) for
   require and require.resolve; the ESM resolution algorithm (package
   "exports" and "imports" with the import conditions, no extension
   probing) for import declarations and import(). Node builtins (node:
   prefix or bare builtin names) are excluded and are not members.
5. The resolved path must be inside the root: a result outside the root,
   or a non-file URL (data:, http:, https:), fails the procedure. Each
   component beneath the root is opened without following symlinks
   (openat2 RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV
   semantics); a symlink component, a mount crossing, a non-regular leaf,
   link count other than 1 or size over 16777216 fails the procedure. N's
   realpath step therefore always yields the opened path.
6. Member kinds: .js, .cjs, .mjs and extensionless CommonJS files are
   members and are traversed by steps 1–5; .json files are members and are
   not traversed; .node files are members, hashed as raw bytes and not
   traversed (their own native dependencies are R-4 or bound by the
   profile). Any other resolved extension (for example .ts, .jsx, .wasm)
   fails the procedure as an unsupported construct.
7. Unresolved specifiers: a recognized specifier for which N's algorithm
   finds no file is recorded in the evidence record and is not a member.
   This admits the optional-dependency pattern (try { require("x") } catch)
   inside node_modules; a file that later appears there is outside Q and is
   R-4.
8. Config closure completeness: for the config file and every member it
   reaches that is not beneath a node_modules directory (target-authored
   code), any dynamic site (step 3) or unresolved specifier (step 7) fails
   the procedure. Completeness is required there because those imports are
   the profile's static config imports.
9. Q = all visited members. files = M ∪ Q, deduplicated by path and sorted
   by path bytewise ascending. Cycles terminate through the visited set; no
   depth limit applies. A member of M that is absent or fails step 5 fails
   the procedure.
10. Limits: more than 4096 entries in files, or a total size over 67108864
    bytes, fails the procedure. There is no truncation, sampling or
    priority order.

Failure of the procedure is a qualification FAIL for that root: no
enrollment entry is written and the root is not eligible (§20.7 STOP when
an adapter version cannot be enumerated).

Persistence. The operator writes fingerprint {algorithm:"od06-files-v1",
files, digest} into enrollment roots[i] with the §20.1.4 hashing and the
same fingerprint into the public view; the enrollment and view schemas do
not change. The evidence record, retained with qualification evidence and
never read by client or broker, is {procedure:"od06-q-enum-v1", adapter,
nodeVersion, entrypoints, unresolved[], dynamicSites[], files[]}, each list
sorted bytewise. Determinism evidence: two independent executions on the
same root produce byte-identical files lists.

Requalification triggers (rerun the procedure before re-enrollment): any
runtime fingerprint drift (exit 4 or PRESUBMIT_FAILURE, §20.1.7); any change
of N, the adapter version, the framework version, cypress.config.js or
playwright.config.js, package.json or package-lock.json; any dependency
install, update or removal in the root; a new procedure literal.

#### 20.1.5 Client derivation of bindingDigest (exact)

Advisory and refusal-only; the broker repeats everything authoritatively.

1. §8.1 reconstruction yields projectId, runId, packageOrdinal, product
   (own installed name/version), root {platform:"linux",path,dev,ino,digest},
   principal (Stage 4 OS-local envelope), reviewRecordId, applyRecordId,
   reviewRecordDigest, packageDigest, changeSetDigest, automationPlanDigest,
   repositoryContextDigest, projectionDigest (the Stage 3 run projection,
   unrelated to the public view), appliedRecordSha256, targets, framework.
2. timeoutMs from the effective execute config (§20.4.4).
3. Read compatibility.json under PP (<=262144 bytes, strict JSON, closed §5.4
   schema, bytes equal to its canonical encoding); require product
   name/version = own package and contractVersion = product literal. Compute
   compatibilityDigest. profileDigest = record.profileDigest.
4. Read the public view under PP (<=1048576 bytes, strict JSON, closed
   schema above, bytes equal to canonical encoding). Require
   view.compatibilityDigest = the step-3 digest, view.contractVersion =
   product literal, view.caller.uid/gid = own effective UID/GID and
   view.caller.account = own OS account name (the os.userInfo username
   that Stage 4 escapes into its principal).
5. Select the single roots[] entry whose rootDigest equals the step-1
   root.digest; none refuses.
6. Recompute fingerprint.digest over {algorithm, files}; require equality.
   For each member, open beneath the root without following symlinks;
   require a regular file with link count 1, equal size and equal SHA-256.
7. fingerprintDigest = fingerprint.digest.
8. bindingDigest = H("qa-ai-agent:execution-binding:v1:" +
   encodeValue(binding without bindingDigest)), §11.1.

Client failures, all before any sudo invocation and with nothing written:
steps 3–5 missing/ownership/schema/mismatch -> exit 5
EXECUTE_RUNNER_NOT_ELIGIBLE (product or contract mismatch: exit 5
EXECUTE_INCOMPATIBLE); step 6 member drift -> exit 4
EXECUTION_FINGERPRINT_MISMATCH.

#### 20.1.6 Broker verification (CREATE step C7-PV) and order effects

C1a: unchanged by DG-1. The view is neither opened nor trusted at C1a.

C7, in this order after locks/claims: (i) the §5.4 compatibility/pair part;
(ii) **C7-PV**: verify every enrollment roots[i].root.digest,
fingerprint.digest and M membership by recomputation; derive the expected
view from the C1a-checked enrollment (contractVersion = compiled literal);
open the fixed path under PP; read at most 1048577 bytes; require byte
equality with the canonical encoding of the derived view (no JSON parse of
the file); (iii) §4.3 items 3–6, where the binding is reconstructed with
fingerprintDigest = enrollment roots[R].fingerprint.digest and compared;
(iv) the remaining C7 steps. Failure of (ii): REFUSED/INELIGIBLE exit 5,
before the reservation commit, nothing reserved or consumed. A derived view
over 1048576 bytes is the same failure.

P1S: the view is not re-read; the existing P1S fingerprint fresh-byte
recheck uses the enrollment fingerprint and the retained dR (§6.4).
RECONCILE: the view is never opened; R1a–R7 are unchanged, and a missing,
stale or foreign view never blocks reconcile.

#### 20.1.7 Disagreement and staleness

| Condition | Client | Broker CREATE | Broker RECONCILE |
|---|---|---|---|
| View absent / fails PP / malformed | exit 5 before sudo | C7-PV INELIGIBLE 5 | Not read |
| View caller/roots/fingerprints differ from enrollment | Not detectable by client | C7-PV INELIGIBLE 5 | Not read |
| View compatibilityDigest != record | exit 5 | C7-PV INELIGIBLE 5 (derived view differs) | Not read |
| View and enrollment agree, target files changed | exit 4 | INPUT_MISMATCH 4 before reservation; PRESUBMIT_FAILURE 7 in P1S | Not evaluated |
| Client skips its checks and sends a stale fingerprintDigest | — | Binding comparison INPUT_MISMATCH 4 | — |

A stale view never grants execution: the broker's binding uses only the
enrollment value, and the view must equal the enrollment-derived bytes.
Replacing the view requires root (PP). The runner cannot select a
fingerprint: the entry is keyed by the live root digest and the broker
compares the full binding.

#### 20.1.8 Negative tests and qualification evidence (DG-1)

Negative tests: view absent; symlink leaf or ancestor; owner non-root; mode
0664/0666/0600; group-writable ancestor (root:staff 2775); link count 2;
oversize; BOM; non-canonical key order or whitespace; unknown/missing key;
duplicate rootDigest; unsorted roots; caller mismatch; compatibilityDigest
mismatch; contractVersion mismatch; view from another runner; view one
requalification behind enrollment (fingerprint member added, removed or
changed); fingerprint.digest not recomputable; no entry for the live root;
member symlink, hardlink (link count 2), directory, size or hash drift;
mandatory adapter member missing from enrollment; client with checks
disabled still refused by the broker; RECONCILE with the view deleted still
finalizes. od06-q-enum-v1: config importing a file outside the root;
symlinked or hard-linked package directory or file (npm link, workspace
link); a mount beneath the root on a resolved path; a resolved .ts file;
a non-literal require in the config closure and one inside node_modules
(FAIL versus recorded dynamic site); a missing literal specifier in the
config closure (FAIL) and an optional try/require inside node_modules
(recorded unresolved); a package "exports" map selecting different files
for require and import; an import cycle; 4097 entries and 67108865 bytes
(FAIL, no truncation); an M member missing; two runs producing identical
files. Qualification evidence: the Node encodeValue and the broker's Rust
encoder produce byte-identical canonical vectors for view, fingerprint,
qualification and binding; the od06-q-enum-v1 evidence record for the
exact adapter, framework and Node versions.

### 20.2 DG-2 — trusted sudo caller authentication

#### 20.2.1 Reconstructed gap and evidence

§5.1 requires "authentication metadata" that sudo supplies unforgeably and
forbids ordinary SUDO_UID, but names no primitive. Upstream sudoers
documents that with SETENV (implied for ALL) command-line environment
variables "are not subject to the restrictions" of env_check/env_keep, and
that env_file/restricted_env_file contribute environment
([sudoers](https://www.sudo.ws/docs/man/sudoers.man/)); PAM can contribute
more. Any SUDO_* trust therefore depends on the whole effective policy and
PAM stack, not on a single enforced primitive.

#### 20.2.2 Alternatives

| Option | Authoritative source | Spoofing | Portability / burden | Verdict |
|---|---|---|---|---|
| A. SUDO_UID/SUDO_GID/SUDO_USER environment | sudo policy + PAM + env files | Depends on whole-policy configuration; not kernel evidence | Universal | Rejected (the §5.1 prohibition) |
| B. Parent sudo process real UID from /proc | Undocumented sudo front-end credential behaviour | PID reuse, version drift | Version-coupled | Rejected as identity (kept only as the structural check C1a.4) |
| C. Audit loginuid (/proc/self/loginuid) | pam_loginuid at login | Unset for services; names the session, not the caller | Distribution-coupled | Rejected |
| D. Custom sudo policy/approval plugin | Plugin code inside sudo (root) | Sound, but a second privileged native artifact | High; violates "exactly one artifact" | Rejected |
| E. **Kernel socket credentials**: the broker's stdin/stdout are AF_UNIX SOCK_STREAM socketpair ends created by the client; SO_PEERCRED returns the creator's credentials | Kernel, recorded at socketpair(2) | Unforgeable by another non-root account | Long-standing Linux primitive; needs sudo to pass the descriptors through unchanged (qualified) | **SELECTED** |

Evidence for E: [unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html):
SO_PEERCRED "returns the credentials of the peer process connected to this
socket ... those that were in effect at the time of the call to connect(2),
listen(2), or socketpair(2)". Linux v6.12
[af_unix.c](https://raw.githubusercontent.com/torvalds/linux/v6.12/net/unix/af_unix.c)
init_peercred records task_tgid(current) and get_current_cred() on both
socketpair ends, and
[sock.c](https://raw.githubusercontent.com/torvalds/linux/v6.12/net/core/sock.c)
cred_to_ucred returns cred->euid/egid mapped into the reader's user
namespace. Node child_process stdio "pipe" is created by libuv
uv__process_init_stdio as uv_socketpair(SOCK_STREAM, ...)
([libuv process.c](https://raw.githubusercontent.com/libuv/libuv/v1.x/src/unix/process.c)),
so the client's existing spawn API already yields client-created
socketpairs. That is a libuv implementation property, not a Node API
guarantee: if a client Node build supplied a real pipe, the broker refuses
(ENOTSOCK), so availability, never identity, depends on it.

#### 20.2.3 Exact sudoers policy (operator-owned, not installed by Stage 5 code)

File /etc/sudoers.d/qa-agent-controller-v1, root:root 0440, protected
parent; qa_runner is substituted once by the literal enrolled account:

    Defaults:qa_runner env_reset, !setenv, !requiretty, !use_pty, !log_input, !log_output, !intercept, !log_subcmds, log_exit_status
    qa_runner ALL=(root:root) NOPASSWD: NOSETENV: NOLOG_INPUT: NOLOG_OUTPUT: NOINTERCEPT: /usr/local/libexec/qa-agent-controller-v1 ""

"" forbids every argument ([sudoers](https://www.sudo.ws/docs/man/sudoers.man/)).
!use_pty and the client's new session both keep sudo off the pty path;
!intercept, NOINTERCEPT and !log_subcmds keep sudo from tracing or
preloading into the command; no I/O logging keeps sudo from interposing
pipes. log_exit_status is a forcing input for the §20.2.4a topology (it
keeps the sudoers policy close hook installed); it logs only the exit
status through the existing sudo log, adds no relay and is not relied on as
proof. Effective-policy qualification is the closed procedure
od06-priv-surface-v1 (§20.2.7, C2): this rule is the runner account's only
authorized privilege-elevation path, and the host is INELIGIBLE if the
account has any other root-equivalent or host-control path. That procedure
replaces the informal list that stood here in C1 (sudo -l, no
command_timeout/runchroot/runcwd/SELinux/AppArmor, upstream plugins only, no
doas/run0/pkexec/Polkit rule, no su credential, no elevating group) and is a
strict superset of it.

#### 20.2.4 Exact invocation chain and stdio

1. The client (Node, effective UID = enrolled uid) calls
   child_process.spawn("/usr/bin/sudo", ["-n", "--",
   "/usr/local/libexec/qa-agent-controller-v1"], {shell: false, detached:
   true, cwd: "/", stdio: ["pipe", "pipe", "ignore"], env: {PATH:
   "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C"}}). detached: true makes the
   child a new session leader (setsid), so sudo has no controlling
   terminal. No SUT value, credential or caller variable is placed in the
   sudo environment; SUT values travel only inside the request frame. The
   client checks /usr/bin/sudo under PP (root-owned, setuid-root, not
   group/other writable) as an advisory early refusal.
2. sudo authorizes the invoking account against the rule (NOPASSWD, -n),
   resets the environment and, with no /dev/tty and no pty requirement,
   takes the no-pty path. Upstream sudo
   ([exec.c](https://raw.githubusercontent.com/sudo-project/sudo/main/src/exec.c),
   [exec_pty.c](https://raw.githubusercontent.com/sudo-project/sudo/main/src/exec_pty.c),
   [exec_nopty.c](https://raw.githubusercontent.com/sudo-project/sudo/main/src/exec_nopty.c)):
   exec_pty returns false when /dev/tty cannot be opened; exec_nopty forks
   and the command inherits stdin/stdout/stderr directly unless an I/O
   plugin logs that stream; closefrom (default 3) closes higher descriptors.
   Whether sudo forks at all is not fixed by this policy alone: upstream
   direct_exec_allowed (exec.c) execs the command in place, replacing the
   sudo process, when the policy plugin has no close function, no audit
   plugin has a close function and no RBAC, timeout, sudoedit, intercept,
   log_subcmds or ptrace flag is set; the sudoers plugin clears its close
   function only when I/O logging, use_pty, log_exit_status and log servers
   are all off and the authentication backend needs no session end
   ([policy.c](https://raw.githubusercontent.com/sudo-project/sudo/main/plugins/sudoers/policy.c)).
   The fork therefore depends on the exact sudo build, PAM session
   configuration, audit plugins and Defaults. §20.2.3 sets log_exit_status
   to keep the close function, but the topology is an exact qualification
   invariant (§20.2.4a), not a property of the policy text.
3. Broker process on a qualified host (§20.2.4a): parent = the qualified
   /usr/bin/sudo front-end process; fd 0 and fd 1 = the child ends of two
   client-created socketpairs; fd 2 = /dev/null.

#### 20.2.4a Sudo parent-topology qualification invariant (closed)

A host is eligible only if qualification proves, for the exact recorded
sudo build (version and package digest), sudo.conf, the full PAM stack of
the sudo service, every loaded policy/audit/approval/I/O plugin, and the
exact §20.2.3 file, all of the following by observation of real broker
invocations through the §20.2.4 spawn on that host:

- T1 Not direct exec: the broker's parent PID is a process distinct from
  the client, and the client's direct child (the spawned PID) is that
  parent.
- T2 Parent identity: the parent's `/proc/<pid>/exe` has the dev/ino of
  /usr/bin/sudo under PP (root:root, regular, setuid-root, not group/other
  writable), and the parent stays alive for the whole broker lifetime of
  every observed invocation (S0–S6 and REFUSED paths).
- T3 Structural check meaningful: C1a.4 passes on every observed
  invocation, and fails (CALLER_REFUSED) when the same broker is reached
  with each §20.2.6 non-sudo parent.
- T4 Descriptor pass-through: the broker's fd 0 and fd 1 are the same
  sockets (equal socket inode in `/proc/<pid>/fdinfo` and `/proc/<pid>/fd`) as
  the client-created socketpair child ends; SO_PEERCRED returns the client;
  no pipe, pty or socket is interposed; fd 2 is /dev/null.
- T5 Stability: T1–T4 hold for every observed phase and after
  systemctl daemon-reexec, a sudo package reinstall of the same version,
  and a reboot.

Any T1–T5 failure, or any later change of the sudo build, sudo.conf, PAM
stack for sudo, loaded plugins or the §20.2.3 file without requalification,
makes the host INELIGIBLE (qualification FAIL). There is no
environment-variable, loginuid or /proc credential fallback and SO_PEERCRED
stays the only identity source. At runtime the topology is not trusted but
re-checked: a direct exec leaves the client as the broker's parent, so
C1a.4 refuses (CALLER_REFUSED, exit 5) before any protected-store access;
an unqualified topology change can only make execution unavailable, never
authenticate.

Relay and lifetime semantics (I4 inputs; qualification must observe them on
the exact sudo build):

- No relay: bytes flow kernel-direct between client and broker; sudo reads
  neither stream. The sudo front end holds duplicates of the broker's own
  ends only, so client death closes the only peer ends.
- Client EOF or death: broker read returns 0, or POLLHUP/POLLRDHUP on fd 0
  -> client loss (§7.2). Broker write after client death -> EPIPE (SIGPIPE
  ignored) -> client loss. The 5000 ms structural-frame drain rule is
  unchanged.
- Signals: sudo forwards signals it receives to the command (user-generated
  SIGINT/SIGQUIT/SIGTSTP; others unless sent by the command) and on SIGALRM
  calls terminate_command, which can end in SIGKILL. Where the qualified
  sudo build lets the invoking account signal the sudo front end, a
  same-account process can therefore cause SIGHUP, SIGTERM or SIGKILL of
  the broker. The broker sets SIG_IGN for SIGHUP, SIGINT, SIGQUIT, SIGTERM,
  SIGTSTP, SIGTTIN, SIGTTOU, SIGUSR1, SIGUSR2, SIGALRM and SIGPIPE before P0;
  SIGKILL is a broker crash and is handled only by the existing §7.4
  broker-crash rows (durable journal, manager deadline, reconcile). No new
  state or outcome.
- Ctrl-C at the client's terminal reaches only the client (sudo is in its
  own session). The client then closes its stdin end, which is CLIENT_LOST
  (§7.2); the CLI has no separate cancel operation.
- sudo front-end death: the broker is reparented and continues; peer state
  is still detected through the sockets.

#### 20.2.5 Authoritative identity and C1a/R1a order

Process-start hygiene, before P0, with no refusal semantics: clearenv; set
the signal dispositions above; dup /dev/null onto fd 2; close_range(3, ~0);
umask 077; chdir("/"). Then P0 (§6.4; grammar only, L3 unchanged). Then C1a,
in this order (R1a uses the same sub-steps; the §5.4 part and the enabled
flag are not part of C1a in either case):

- C1a.1 Process: getresuid and getresgid all 0; argc == 1.
- C1a.2 Artifact: the fixed broker path under PP (root:root 0755, regular,
  no setuid/setgid/file capability, link count 1), and the fstat of
  /proc/self/exe (opened through a procfs descriptor validated with
  PROC_SUPER_MAGIC and STATX_ATTR_MOUNT_ROOT) has the same dev/ino.
- C1a.3 Enrollment and compatibility.json integrity (§5.2, unchanged).
- C1a.4 Namespace and parent structure: /proc/self/ns/user and
  /proc/1/ns/user have equal nsfs dev/ino. ppid = getppid(); pidfd =
  pidfd_open(ppid); fstat of /proc/<ppid>/exe (O_PATH through the validated
  procfs descriptor) equals the dev/ino of /usr/bin/sudo opened under PP,
  which must be root:root, regular, setuid-root and not group/other
  writable; afterwards getppid() still equals ppid and pidfd_send_signal
  (pidfd, 0) succeeds, so the inspected /proc entry was the live parent (no
  PID-reuse window). This structurally refuses direct root shells, su, doas,
  run0, pkexec and in-place exec elevation; it is not the identity proof.
- C1a.5 Caller identity: fd 0 and fd 1 each have SO_DOMAIN AF_UNIX and
  SO_TYPE SOCK_STREAM; SO_PEERCRED on both returns identical {pid, uid,
  gid} with pid > 0; uid != 0; uid = enrollment.caller.uid and gid =
  enrollment.caller.gid. The authenticated account is
  enrollment.caller.account, bound to that uid by the root-owned
  enrollment; the broker performs no NSS/passwd lookup.

Any C1a failure: REFUSED reason CALLER_REFUSED, exit 5 (C1a.3 keeps its
existing §5.2 mapping), with no protected-store read or write, manager call
or cgroup read; on RECONCILE the attempt is left for a later reconcile. The
SO_PEERCRED pid is never authority, so PID reuse cannot affect identity; the
pidfd recheck covers the only PID-based structural check.

Socket options and ancillary data (C2, normative). The protocol carries no
ancillary data in either direction. The broker MUST NOT enable SO_PASSCRED,
SO_PASSPIDFD or SO_PASSSEC on fd 0 or fd 1 (the kernel therefore never
attaches credentials to data the broker receives), never sends ancillary
data, and MUST NOT accept file descriptors from the caller. Every read from
fd 0 (P0 intake, the stdin liveness watch and the RESULT_PROPOSAL read) is a
recvmsg(2) with MSG_CMSG_CLOEXEC and a control buffer of exactly
CMSG_SPACE(sizeof(int)) bytes; the kernel closes any passed descriptor that
does not fit. If a call returns any control message or sets MSG_CTRUNC, the
broker closes every descriptor received in an SCM_RIGHTS message at once,
never uses or passes it, discards the bytes of that call, and treats the
event as a malformed frame under the existing closed semantics: before the
reservation commit it is REFUSED/SCHEMA_INVALID with nothing reserved (in
P0 a structural check, L3 unchanged); after the reservation commit the
existing §7.2 broker-side violation outcome applies unchanged
(EXECUTION_ERROR RESULT_INVALID). SO_PEERCRED stays the only socket
credential identity source; no new frame, reason or exit code.

Anti-spoofing proof sketch:

| Attempt | Why refused |
|---|---|
| SUDO_UID/SUDO_USER/LOGNAME/any variable forged | The environment is never read (cleared at start) |
| Other non-root account invokes the rule | sudo denies (the rule names only the account) |
| Other account passes its own socket to the runner | SO_PEERCRED uid = other account != enrollment |
| Root (direct shell, cron, su, doas, run0, pkexec) runs the broker | Parent is not the qualified sudo (C1a.4), or creator uid 0 (C1a.5), or stdin is not a socket |
| Nested sudo (runner -> sudo -> root shell -> sudo broker) | Socket creator is root (uid 0), or stdin is not a client socket |
| setuid program used to create the socket | SO_PEERCRED reports the effective UID (0 or another account) |
| Runner in an unprivileged user namespace | Kernel maps the creator to the runner's real kuid; a broker outside the initial user namespace fails C1a.4 |
| sudo build interposes pipes or a pty | fd 0 not a socket, or creator root -> refused |
| Pipe-based client (non-libuv) | ENOTSOCK -> refused (availability only) |

Root itself is trusted and out of scope; C1a refuses accidental direct-root
use, not a deliberate root operator. Same-account authority: any process
running as the enrolled account can create such sockets and invoke the
rule. That is the existing R-1/R-2 same-principal model and the L4
qualification input (Yama, absence of same-account command agents), not a
new acceptance.

#### 20.2.6 Negative tests and qualification evidence (DG-2)

Negative tests: forged SUDO_UID/SUDO_GID/SUDO_USER via the command line,
env_file, ~/.pam_environment and PAM; argv present ("" rule and C1a.1);
direct root invocation from a root shell, cron and systemd-run; su -c,
doas, run0, pkexec; nested sudo; stdin as pipe, file, tty and /dev/null;
stdin and stdout from different processes (pid mismatch); socket created by
another account, by a setuid helper and by root; runner inside unshare -U;
sudo -b, -E, -s and -i (all denied by policy); sudo with use_pty forced,
log_input/log_output, intercept or command_timeout enabled (each must refuse
or fail qualification, never authenticate); parent PID-reuse race (parent
killed between getppid and pidfd_open); SIGHUP, SIGTERM, SIGTSTP and SIGALRM
sent to the sudo front end at every phase S0–S6 (no outcome other than the
§7.4 rows); client SIGKILL at every phase (EOF/EPIPE -> CLIENT_LOST or the
§7.4 row); sudo front end SIGKILLed. Topology (§20.2.4a): with
log_exit_status removed, pam_session disabled and no audit-plugin close
(the direct-exec configuration), the broker's parent is the client and C1a.4
refuses with no protected-store access, and qualification records T1 FAIL;
an audit or I/O plugin added to sudo.conf after qualification; a PAM stack
change for the sudo service; a sudo build swap of the same version string
with a different package digest (each requalification FAIL until
re-observed). Qualification evidence: exact sudo build, package digest and
sudo.conf, the PAM stack of the sudo service, the loaded plugin list, the
effective policy listing, the T1–T5 observation record (process tree with
client, sudo and broker PIDs; broker parent exe dev/ino; socket inodes of
fds 0/1 on both sides), no pty allocated, the observed signal-relay table
for the exact build, Yama ptrace_scope >= 1.

#### 20.2.7 Runner privilege-surface qualification od06-priv-surface-v1 (C2, closed)

Invariant PS-0. The §20.2.3 broker rule is the runner account's only
authorized privilege-elevation path. A host on which the account has any
other root-equivalent or host-control path is INELIGIBLE. Root-equivalent
means able to run code with UID 0 or with any capability in the initial
user namespace; host-control means able to modify root-owned files or
devices, or to start, configure or enter root-run services, containers or
virtual machines. Both include every way to change the broker, enrollment,
compatibility state, the protected journal or tombstones. The root operator
stays trusted and outside the claim (§20.2.5, unchanged); PS-0 removes
runner-account privilege, it does not defend against a hostile root.

Runtime C1a does not and cannot detect a runner that already holds root:
such a runner can rewrite the broker, enrollment and every check. PS-0 is
therefore a host-eligibility property established and kept by this
procedure, never by C1a.4 or any runtime topology check.

Producer, privilege and phase. The operator runs od06-priv-surface-v1 as
part of Stage 5 qualification tooling (not shipped in the npm package,
never invoked by the client or the broker). It runs as root because its
inputs (sudoers 0440, shadow, other processes' /proc entries) are
root-readable only, and it is read-only: it writes nothing but its output
record into the operator's qualification evidence. It runs on the
qualified host after the §20.2.3 file, the runner account, its groups and
the runner service are final, and before enrollment is enabled (§20.3.5
"qualify"; §5.3). Every probe that executes as the runner account (PS-C3)
runs from a non-tty session of that account, never through the broker.

Closed requirement sections. Every item is checked; any item that fails,
cannot be evaluated or cannot be evaluated completely makes the host
INELIGIBLE. "Package-verified" means shipped by an installed Debian binary
package of the qualified host whose dpkg --verify reports no difference
for that file.

PS-A sudo sources and effective policy:

- A1 Package: exactly the Debian binary package sudo is installed (not
  sudo-ldap), at the recorded version and architecture; every regular file
  of dpkg -L sudo is recorded with its SHA-256 and is package-verified.
  This covers /usr/bin/sudo, visudo, cvtsudoers and every plugin object
  under /usr/libexec/sudo.
- A2 sudo.conf: /etc/sudo.conf is absent, or every line that is not blank
  and not a comment is exactly one of `Plugin sudoers_policy sudoers.so`,
  `Plugin sudoers_io sudoers.so`, `Plugin sudoers_audit sudoers.so`. Any
  other Plugin, plugin argument, Path, Set or Debug line is INELIGIBLE.
- A3 Local source set S: /etc/sudoers plus, recursively, every file named by
  @include or #include and every file that sudoers(5) selects from a
  directory named by @includedir or #includedir. Recorded per file: path,
  uid, gid, mode, size, SHA-256; per include directory: path, uid, gid,
  mode and the complete bytewise-sorted list of entry names, including the
  names sudo skips (ending in "~" or containing "."), so a later rename is
  a change. Every file and directory is root-owned with (mode & 0o022) == 0
  and satisfies the §20.1.3 predicate PP. visudo -c (as root) passes. An
  include path containing a sudoers escape (for example %h), a missing
  include target or an unreadable entry is INELIGIBLE.
- A4 Parsed policy, using sudo's own parser from A1:
  `cvtsudoers -c /dev/null -i sudoers -f json -e /etc/sudoers` (LC_ALL=C,
  root; includes inlined, aliases expanded) is the full policy P;
  `cvtsudoers -c /dev/null -i sudoers -f json -e -M -p -m user=<account>
  /etc/sudoers` is the matched policy U (local password and group data,
  the account's groups added, every host kept). Each output must be strict
  JSON whose numbers are safe integers; its canonical form is the CRS-1
  encodeValue encoding (§11.1). Requirements: (i) no user list in P and
  no Defaults binding in P contains ALL as a user, a netgroup (+name) or a
  non-Unix group (%:name); (ii) U contains exactly one user rule, equal to
  the §20.2.3 rule (Runas root:root; tags NOPASSWD, NOSETENV, NOLOG_INPUT,
  NOLOG_OUTPUT, NOINTERCEPT; command the broker path with the empty
  argument list; host ALL; no option or restriction beyond those tags);
  (iii) P contains no Defaults entry bound to a command or Runas list
  that includes the broker path or ALL; (iv) every user-bound Defaults
  entry in P that matches the account (by name, #uid, %group or %#gid of
  its groups) is exactly the §20.2.3 Defaults line.
- A5 Effective listing L: `sudo -n -l -U <account>` run as root with
  LC_ALL=C, an environment of only PATH=/usr/sbin:/usr/bin:/sbin:/bin, no
  controlling terminal and stdout a pipe (so sudo does not wrap lines).
  Canonicalization, in order: split at LF; remove a trailing CR and
  trailing spaces and tabs from each line; replace the host name in the
  `Matching Defaults entries for <account> on <host>:` and
  `User <account> may run the following commands on <host>:` header lines
  with the literal `<HOST>`; drop empty lines; join with LF and end with one LF. L is
  compared only as these bytes; sudo -l is evidence of the effective result
  for the A1 build, never the authority, which is S plus P. Requirements:
  the command section has exactly one entry and it denotes the §20.2.3
  rule; every option named in the "Matching Defaults entries" and "Runas
  and Command-specific defaults" sections is one of env_reset, setenv,
  requiretty, use_pty, log_input, log_output, intercept, log_subcmds,
  log_exit_status (each finally set as in §20.2.3), mail_badpass or
  secure_path. Any other option (for example command_timeout, runchroot,
  runcwd, role, type, apparmor_profile, closefrom_override, group_plugin,
  log_servers, iolog_*, env_keep, env_file, restricted_env_file) is
  INELIGIBLE.
- A6 sudoers NSS: the sudoers line of /etc/nsswitch.conf is absent or
  exactly `sudoers: files`.
- A7 PAM: /etc/pam.d/sudo and, recursively, every file it includes are
  recorded (path, SHA-256); every module they reference is package-verified
  and shipped by one of libpam-modules, libpam-modules-bin, libpam-runtime
  or libpam-systemd. /etc/security/group.conf has no line that is not blank
  and not a comment (pam_group grants no group).

PS-B account and group surface:

- B1 Account: one passwd entry with the enrolled name, uid != 0, and no
  other passwd entry with that uid; exactly one passwd entry has uid 0 and
  it is root.
- B2 Primary group: the account's private group: group name equal to the
  account name, gid != 0, an empty member list, and no other passwd entry
  using that gid as primary group.
- B3 Supplementary groups: getgrouplist(account, primary gid) through NSS
  equals exactly {primary gid}. The account therefore has no
  supplementary group at all. This closed rule, not a list of dangerous
  names, is the requirement; it excludes in particular root, sudo, wheel,
  admin, adm, docker, podman, lxd, incus, incus-admin, libvirt,
  libvirt-qemu, kvm, disk, shadow, systemd-journal and every group named
  in a sudoers, doas, polkit or D-Bus policy. A host that needs a
  supplementary group for the runner is INELIGIBLE (an owner decision may
  later define an allowlist; this design defines none).
- B4 Observed credentials: for every process of the runner service (the
  recorded systemd unit, or the recorded process tree if the runner is not
  a unit), `/proc/<pid>/status` has all four Uid values equal to uid, all
  four Gid values equal to the primary gid, Groups a subset of {primary
  gid}, and CapInh, CapPrm, CapEff and CapAmb all zero. For a unit,
  systemctl show records User (= account), Group (empty or the primary
  group), SupplementaryGroups (empty), DynamicUser (no) and
  AmbientCapabilities (empty).
- B5 NSS identity sources: the passwd, group, shadow, gshadow and
  initgroups lines of /etc/nsswitch.conf name only the modules files and
  systemd. When systemd is named: the userdb drop-in directories
  /etc/userdb, /run/userdb, /run/host/userdb, /usr/local/lib/userdb and
  /usr/lib/userdb contain no user, group or membership record naming the
  account, its uid or its primary group, and /run/systemd/userdb contains
  no entry other than io.systemd.DynamicUser, io.systemd.Multiplexer and
  io.systemd.NameServiceSwitch. The netgroup line is not restricted
  because no privilege policy may reference a netgroup (A4(i); PS-C).

PS-C alternate elevation mechanisms:

- C1 doas: absence required. No opendoas or doas package is installed and
  none of /usr/bin/doas, /usr/local/bin/doas, /etc/doas.conf and
  /usr/local/etc/doas.conf exists.
- C2 polkit and pkexec: absence required. The polkitd and pkexec packages
  are not installed, /usr/bin/pkexec does not exist, no system bus service
  file declares org.freedesktop.PolicyKit1, and on the system bus that name
  has no owner and is not in ListActivatableNames. No polkit rule or .pkla
  file can then apply, and no polkit-authorized operation is available to
  the account.
- C3 run0, systemd-run and other systemd-mediated elevation: run0 ships
  with systemd and cannot be absent, so the evidence is C2 plus probes run
  as the account: `run0 --no-ask-password /usr/bin/true` and
  `systemd-run --system --no-ask-password --wait /usr/bin/true` each exit
  non-zero with an access-denied result and create no unit (the system
  manager's unit list is unchanged). A probe that succeeds, prompts or
  creates a unit is INELIGIBLE.
- C4 su and root credentials: the root password field in /etc/shadow is
  locked (starts with "!" or "*"); /etc/pam.d/su and its includes are
  recorded and satisfy the A7 module rule, with no pam_wheel trust,
  pam_permit or pam_succeed_if line in the auth stack; /root has
  (mode & 0o077) == 0; if openssh-server is installed, sshd -T reports
  permitrootlogin no. The operator records that no credential of root or
  of any account holding a privilege grant is readable by or available to
  the runner account.
- C5 setuid, setgid and file-capability executables: every regular file on
  every local filesystem of the host with the setuid or setgid bit or a
  security.capability attribute is recorded (path, uid, gid, mode, SHA-256,
  capabilities, owning package). Each must be package-verified, writable
  only by root and in a directory tree writable only by root. Any such
  file that is not package-verified is INELIGIBLE. Elevation through these
  files is covered by A, C1, C2 and C4; a set or digest change is a
  trigger.
- C6 Host-control endpoints: (i) no block device node is readable or
  writable by the account through its uid, primary gid or the other bits;
  (ii) no character device node outside /dev/null, /dev/zero, /dev/full,
  /dev/random, /dev/urandom, /dev/tty, /dev/ptmx, /dev/pts/*, /dev/net/tun
  and /dev/fuse is writable by it; (iii) every listening socket (AF_UNIX
  path and abstract, TCP and UDP on every address, from `ss -lpn` as root)
  whose server process has euid 0 or any capability is either not
  connectable by the account (a path socket on which it lacks write
  permission, or with an ancestor directory on which it lacks search
  permission; abstract sockets always count as connectable) or is served by an executable from a Debian package built
  from source package systemd or dbus, or is openssh-server's sshd under
  C4; (iv) every system bus well-known name that is owned or activatable
  and whose owner or activation user is root or capability-holding belongs
  to an executable from source package systemd or dbus; (v) the D-Bus
  system policy files (system.conf, system-local.conf and every file in
  system.d under /usr/share/dbus-1 and /etc/dbus-1) are recorded and
  contain no policy element naming the account, its uid or its primary
  group. Container engines, VM managers and any other root-run control
  service reachable by the account therefore fail (iii) or (iv).

PS-D remote and dynamic policy. Only local, root-owned files qualify as
privilege-policy or identity sources. If sudoers, passwd, group, shadow,
gshadow or initgroups resolution names any NSS module other than files
(or systemd under B5), if a PAM module outside the A7 packages appears in a
recorded stack, or if any polkit authority exists (C2), the effective
policy cannot be captured deterministically and revalidated, and the host
is INELIGIBLE. No freshness window, cache or "last known" state is
defined, because none is admitted: an unreachable, stale or changed remote
source is never treated as unchanged, and LDAP, SSSD, winbind, FreeIPA,
Active Directory and remote sudoers are not supported.

PS-E procedure completeness. A root-equivalent or host-control path for
the runner account that this procedure revision does not detect is a
procedure defect: every host qualified under the revision becomes
INELIGIBLE until a new procedure literal covers the path and the host is
requalified with it. A revision is a new literal, never an in-place
change.

Record, encoding and digest. The output is one record, closed schema
QaAgentControllerPrivilegeSurface v1, all keys required, each list sorted
bytewise by its first listed key:

| Key | Value |
|---|---|
| kind / schemaVersion / procedure | "QaAgentControllerPrivilegeSurface" / 1 / "od06-priv-surface-v1" |
| contractVersion | "qa-agent-controller-v1" |
| account | {name, uid, primaryGid, primaryGroup} (B1, B2) |
| sudo | {package {name, version, architecture}, files [{path, sha256}], sudoConf null or {sha256}, sources [{path, uid, gid, mode, size, sha256}], includeDirs [{path, uid, gid, mode, entries}], policySha256, matchedPolicy, effectiveListing, pam [{path, sha256}], pamModules [{path, package}], groupConfSha256} (A1–A7; policySha256 over the canonical P bytes; matchedPolicy the canonical U value; effectiveListing the canonical L string) |
| nss | {nsswitchSha256, passwd, group, shadow, gshadow, initgroups, sudoers (each the ordered module list, [] if the line is absent), userdbEntries} (A6, B5) |
| groups | {supplementary} (B3; exactly [primaryGid]) |
| runner | {unit (string or null), properties (object or null), processGroups} (B4; no PIDs) |
| elevation | {doasAbsent, polkitAbsent, probes [{command, exitStatus, unitCreated}], rootPasswordLocked, uidZeroAccounts, suPam [{path, sha256}], sshPermitRootLogin (string or null)} (C1–C4) |
| privilegedFiles | [{path, uid, gid, mode, sha256, capabilities (string or null), package}] (C5) |
| endpoints | {blockAccessible [], charWritable [paths], listeners [{protocol, address, serverExe, package, sourcePackage}], busNames [{name, serverExe, sourcePackage}], dbusPolicy [{path, sha256}]} (C6) |

The record carries no time, PID, inode or boot-specific value, so equal
host state yields equal bytes. Bytes are the CRS-1 encodeValue encoding,
no BOM, no trailing newline. privilegeSurfaceDigest = "sha256:" + lowercase
hex of SHA-256 over those bytes (the Stage 4 content-digest convention of
§20.1.4; no new hash domain). The record and digest are retained with the
qualification evidence (operator-retained, root-owned, with the T1–T5 and
od06-q-enum-v1 evidence). They are host-eligibility evidence, not caller
identity and not authority: the broker never reads them, no runtime
decision is taken from the digest, enrollment does not change, and
SO_PEERCRED stays the only runtime caller identity source (§20.2.5).

Verification and lifecycle. Verification reruns the procedure and requires
the new record to be byte-identical to the qualified record (equal
privilegeSurfaceDigest) and every requirement to hold. It is mandatory at
initial qualification, immediately before every enrollment enable or
re-enable (§5.3, §20.3.5), after every package installation, upgrade or
removal on the host, and after every account, group, PAM, NSS, sudo,
polkit, doas, D-Bus policy or runner-unit administration action. Like T5,
qualification shows the record unchanged after systemctl daemon-reexec and
a reboot. Any trigger change is made with enrollment disabled; one made
while enabled makes the host INELIGIBLE from that moment. A mismatch or a
failed requirement makes the host INELIGIBLE until explicit
requalification: full procedure, review of the new record against
PS-A–PS-E, and re-observation of T1–T5 when an input of §20.2.4a changed.

Requalification triggers (each makes the host INELIGIBLE until
requalified): any change of the sudo build or package; sudo.conf; the PAM
stack of sudo or su, or any module in it; the loaded sudo plugins; the
§20.2.3 file; any other sudoers source, include directory or its entry
list; the NSS or sudoers-source configuration; the parsed or effective sudo
policy (P, U or L); the account's uid, primary group or supplementary
groups, or the runner unit's identity properties; installation or
configuration of doas; installation of polkit or any polkit rule or .pkla
file; the run0/systemd-run probe results; the root password state or sshd
root-login setting; the setuid/setgid/file-capability set or a digest in
it; the host-control endpoint set; the D-Bus system policy; and the
availability, presence or configuration of any remote or dynamic policy
source (which PS-D makes INELIGIBLE outright).

Negative tests (qualification, adversarial; each must leave the qualified
host INELIGIBLE until full requalification, never eligible): a generic
`<account> ALL=(ALL) ALL` rule in another /etc/sudoers.d file;
`Defaults!/usr/local/libexec/qa-agent-controller-v1 use_pty`,
`Defaults!ALL log_output` and `Defaults:<account> env_keep+=X` in another
file; a new @include and a new @includedir source; a file renamed into or
out of an include directory; sudoers via LDAP (`sudoers: files ldap`,
sudo-ldap installed) and via SSSD (`sudoers: files sss`); the account
added to sudo, wheel, docker, disk and libvirt; any other supplementary
group added or removed; SupplementaryGroups= or AmbientCapabilities= set on
the runner unit; a pam_group grant in /etc/security/group.conf; a userdb
membership record in /run/userdb; a doas rule (opendoas installed); polkitd
installed with a rule granting the account
org.freedesktop.systemd1.manage-units (run0 then succeeds); a setuid copy
of a shell or a file-capability binary that is not package-verified; a
root-run Docker or libvirt socket connectable by the account; the sudo
group-plugin or a command_timeout Default added; the root password
unlocked with PermitRootLogin yes; an LDAP or SSSD identity source that is
unreachable, stale or returns a changed group list; and the §20.2.3 rule
byte-identical while any one of the routes above appears. Every case is
detected by PS-A–PS-D at verification or requalification, never by C1a.

### 20.3 DG-3 — native broker, build, distribution and Linux host

#### 20.3.1 Reconstructed gap

§4.1/§5.2/§5.4 fix one root-owned native artifact with a self-digest but
choose no language, D-Bus client, linkage, build, versioning or
distribution, and §5.3 defers packaging; the authoring host has no Linux,
systemd, sudo or compiler.

#### 20.3.2 Language comparison

| Criterion | Rust | C | Go |
|---|---|---|---|
| Memory safety of root parsers (L1) | Safe by construction outside audited unsafe | Manual; highest review burden | Safe |
| Syscall access (openat2, statx mount ID, pidfd, memfd seals, SO_PEERCRED, close_range, execve) | Direct, via rustix/libc | Direct | Mostly via x/sys/unix; the runtime owns threads and signals |
| Process model | No runtime; deterministic | No runtime | Mandatory multithreaded runtime, GC and signal interception; interacts with workload-mode execve and dispositions |
| systemd D-Bus | zbus (pure Rust) or sd-bus FFI | sd-bus native | godbus (pure Go) |
| Static linking | musl static-pie, no loader | glibc static unsupported for NSS; musl possible | Static by default |
| Dependency footprint | Moderate (zbus tree) | Minimal | Moderate (godbus, x/sys) plus runtime |
| Deterministic strict parsing | Safe hand-written parser feasible | Error-prone | Feasible |
| Build complexity / reproducibility | cargo --locked with a pinned toolchain; reproducible | Simple; toolchain-coupled | Simple, reproducible |
| Review burden | Unsafe blocks plus dependency audit | Every line | Runtime behaviour plus dependencies |

**Selected: Rust.** C is rejected on L1 (root-side frame, proposal, report
accounting and D-Bus parsing of untrusted bytes in a memory-unsafe
language). Go is rejected on process-model control: the broker relies on
exact process-wide signal dispositions, a single precise execve in workload
mode and no hidden runtime behaviour in a root one-shot process.

#### 20.3.3 D-Bus strategy

| Option | Untrusted-message parser | Integrity coverage | Footprint | Verdict |
|---|---|---|---|---|
| zbus (pure Rust), statically linked | Memory-safe Rust | Inside brokerSha256 (all broker code is one digest) | Larger Rust dependency tree | **SELECTED** |
| sd-bus via FFI to libsystemd.so.0 | systemd's C parser | Library outside brokerSha256; dynamic loader exposure | Minimal crates | Rejected: weaker integrity model; C parsing of unsolicited signals in root |
| libdbus via the dbus crate | C | Outside the digest | Medium | Rejected |
| Hand-written D-Bus in the broker | New security-sensitive parser | Inside the digest | Small | Rejected (no proof that it is safer) |
| /run/systemd/private peer socket | — | — | — | Rejected: changes the §4.3/§5.6.1 manager identity (bus unique owner) |

Exact use: zbus exactly 5.13.2 (Cargo.toml requirement "=5.13.2"),
blocking API, default features off, features exactly async-io and
blocking-api (no tokio), Unix FD passing enabled. Version evidence from the
published crate sources: ConnectionCredentials has no ProcessFD member in
zbus 5.0.0–5.5.0 and has it from 5.7.1 on; 5.13.2 declares edition 2024 and
rust-version 1.85, and in src/fdo/dbus.rs maps the D-Bus key "ProcessFD" to
an `Option<OwnedFd>` exposed as ConnectionCredentials::process_fd() (with
process_id() for "ProcessID"), returned by the DBus proxy method
get_connection_credentials, whose blocking variant the blocking-api feature
generates. Any other zbus version is a new broker build that must re-prove
this surface before qualification. Connection only to the literal address
unix:path=/run/dbus/system_bus_socket with EXTERNAL authentication; the
environment is already cleared, so no DBUS_* variable can redirect it.
Calls: org.freedesktop.DBus GetNameOwner and GetConnectionCredentials
(ProcessFD and ProcessID for §5.6.1 N1) on the bus driver; the §6.1/§6.3
Manager and Unit methods on org.freedesktop.systemd1 only; AddMatch for
PropertiesChanged limited to the manager's unique name and the bound unit
path. Every received message whose sender is neither the bus driver nor
the authenticated manager unique name is dropped before use. Transient
properties are built as typed zvariant values from the fixed §6.1 table;
FDs (signature h) are passed as owned descriptors. No object server is
registered. zbus's internal executor thread is permitted; the broker sets
signal dispositions before creating the connection.

Unsolicited traffic (C2, Security INFO-4; linked to L1 and L7, which stay
OPEN). Any account may send unicast signals to the broker's unique name,
and the bus driver stamps the sender, so a non-manager sender cannot
present itself as the manager. Such traffic cannot become trusted: it is
dropped by the sender filter above before any use and changes no state.
It cannot grow broker memory without bound: zbus 5.13.2 keeps each incoming
queue bounded (64 messages by default; "When the queue is full, no more
messages can be received until room is created", src/connection/mod.rs of
the published crate), and the broker MUST NOT raise max_queued or create an
unbounded MessageIterator or MessageStream. Each message is bounded by the
system bus max_message_size of the qualified host, recorded as
qualification evidence. In-process buffering is therefore at most the
fixed number of zbus queues the broker opens times 64 times that size,
derived from the pinned crate and the recorded bus configuration, with no
new production limit. It cannot extend execution: a full queue only delays
or blocks receipt of manager messages, and every manager wait is already
bounded by its §6.4 phase deadline (A, S, TimeoutStartUSec, RuntimeMaxUSec,
P4, R); an expiry ends in the existing CONTROLLER_FAILURE, TIMED_OUT,
OBSERVATION_EXPIRED or QUARANTINED outcomes. It cannot produce PASS: PASSED
needs a durable OBSERVED backed by the authenticated manager's properties
(§7.3) and a validated proposal, and no message from another sender is
ever read as manager evidence. It does not bypass L7: the traffic creates
no broker process, so the open L7 concurrency question is unchanged.

#### 20.3.4 Dependencies, toolchain, build and linkage

| Item | Normative value |
|---|---|
| Source location | native/qa-agent-controller-v1/ in this repository (Cargo workspace: Cargo.toml, Cargo.lock, rust-toolchain.toml, build-env.digest, and the build-environment recipe Containerfile of §20.3.4a, which C2 adds as the only file there before Stage 5 implementation); outside the package.json "files" allowlist, so never in the npm tarball |
| Direct dependencies (closed allowlist) | zbus "=5.13.2" (features above), rustix 1, libc 0.2 (only in one sys module), sha2 0.10, md-5 0.10 (§9.4 Cypress name check). No other direct dependency: in particular no direct serde_json, tokio, logging, tracing-subscriber or CLI crate; JSON is an in-repository strict parser in safe Rust. Adding a direct dependency is a §20.7 STOP |
| Transitive closure (distinct from the direct allowlist) | Exactly the Cargo.lock graph resolved for the direct set; it is not claimed to be free of any crate category. For zbus 5.13.2 it includes, among others, tracing (a mandatory zbus dependency; the broker installs no subscriber and no log backend, so events are discarded), serde/serde_repr, winnow, uuid, enumflags2, the zvariant/zbus_names/zbus_macros family and their proc-macro dependencies, and the async-io feature set (async-io, async-executor, async-lock, async-task, blocking, async-process and its async-signal/signal-hook-registry). zbus 5.13.2 uses rustix and libc on Linux; nix and xdg-home were dependencies of earlier zbus 5 releases and are absent unless Cargo.lock shows them |
| Transitive controls | Cargo.lock committed and used with --locked; every package from crates.io with its registry checksum verified by cargo; no git, path (outside the workspace) or alternative-registry source; cargo deny check on the exact lock (advisories with no unignored RUSTSEC entry, an explicit license allowlist, sources restricted to crates.io, bans on duplicate majors only where listed); an unsafe-code inventory per locked crate (cargo geiger output or an equivalent per-crate count) with an audit note for each crate containing unsafe code; an inventory of crates that install signal handlers, spawn processes or start threads, each shown unreachable from or compatible with the broker's paths (the unix:path address never selects the unixexec transport, so async-process is not reached; the broker's dispositions are set before the connection); build scripts in the graph must not compile C or call pkg-config. Any lock change is a new broker build requalified against the new exact graph |
| Unsafe policy | #![forbid(unsafe_code)] in every broker crate except one sys module with an enumerated list of libc calls (getresuid, getresgid, close_range, execve and any primitive rustix lacks), each wrapped and reviewed |
| Toolchain | Exactly Rust 1.85.0 (rustc 1.85.0 (4d91de4e4 2025-02-17), Cargo 1.85.0 = cargo 0.86.0), edition 2024, pinned in rust-toolchain.toml (channel "1.85.0", targets ["x86_64-unknown-linux-musl"], profile minimal) and installed only from the official channel manifest channel-rust-1.85.0.toml (2025-02-20) with these component xz SHA-256 values verified: rustc x86_64-unknown-linux-gnu 7436f13797475082cd87aa65547449e01659d6a810b4cd5f8aedc48bb9f89dfb; cargo x86_64-unknown-linux-gnu 0aff33b57b0e0b102d762a2b53042846c1ca346cff4b7bd96b5c03c9e8e51d81; rust-std x86_64-unknown-linux-gnu 285e105d25ebdf501341238d4c0594ecdda50ec9078f45095f793a736b1f1ac2; rust-std x86_64-unknown-linux-musl 27cebed8bafcb07c1c61a3dfc548efc3c032720d953375391896b664f8fe06f5. Changing any of them is a new broker build |
| Target and linker | Target x86_64-unknown-linux-musl. Linker for the target is exactly rust-lld from the pinned rustc component (lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld, covered by the rustc hash above), flavor ld.lld, with the self-contained musl crt objects and libc from the pinned musl rust-std. No host cc, gcc, binutils ld or system libc participates in linking the broker. Host-target build scripts and proc macros are linked by the build environment's cc; their outputs are not part of the artifact |
| Build environment | Exactly one OCI image, x86-64, referenced only by its immutable manifest digest stored in native/qa-agent-controller-v1/build-env.digest (one line "sha256:" + 64 lowercase hex). The image is built only from the versioned recipe native/qa-agent-controller-v1/Containerfile by the closed §20.3.4a procedure (immutable Debian 13 base digest, fixed Debian snapshot and package versions, the pinned toolchain hash-verified and installed under /opt/rust: toolchain at /opt/rust/rustup/toolchains/1.85.0-x86_64-unknown-linux-gnu, cargo and rustc linked from /opt/rust/cargo/bin, no rustup; RUSTUP_HOME=/opt/rust/rustup, CARGO_HOME=/opt/rust/cargo); build-env.digest is written only by that procedure, never by hand, and an image without that provenance is never qualified however reproducible its output; changing the digest is a new broker build. Builds run in a fresh container from that digest with --network none, source bind-mounted read-only at /build/src, CARGO_TARGET_DIR=/build/target, the prepared registry volume at /opt/rust/cargo/registry, an unprivileged numeric build user, umask 022 |
| Build environment variables | The container starts from an empty environment plus exactly: PATH=/opt/rust/cargo/bin:/usr/bin:/bin, RUSTUP_HOME, CARGO_HOME, CARGO_TARGET_DIR (values above), LANG=C, LC_ALL=C, TZ=UTC, SOURCE_DATE_EPOCH = the committer timestamp of the source commit (for any build script that reads it; the broker embeds no time), CARGO_INCREMENTAL=0, QA_BROKER_SOURCE_COMMIT = 40-hex commit (read by env! for brokerBuild), RUSTFLAGS below. No other variable, no ~/.cargo/config.toml and no .cargo/config.toml outside the source tree |
| Build command | Preparation: cargo fetch --locked in a container from the same digest, with network, into a fresh build volume mounted at /opt/rust/cargo/registry (cargo verifies every registry checksum against Cargo.lock). Build: cargo build --release --frozen --target x86_64-unknown-linux-musl (--frozen = --locked plus --offline) with --network none |
| RUSTFLAGS (exact, in this order) | -C linker=rust-lld -C linker-flavor=ld.lld -C link-self-contained=yes -C target-feature=+crt-static -C link-arg=--build-id=none --remap-path-prefix=/build/src=/qa-agent-controller-v1 --remap-path-prefix=/opt/rust/cargo/registry/src=/cargo-registry --remap-path-prefix=/opt/rust/cargo/git/checkouts=/cargo-git --remap-path-prefix=/opt/rust/rustup=/rustup --remap-path-prefix=/build/target=/target |
| Release profile | opt-level 2, codegen-units 1, lto true, panic "abort", overflow-checks true, debug false, strip "symbols", incremental false |
| Host-specific metadata | No timestamps, hostnames, user names, absolute host paths or build IDs in the artifact: paths are remapped as above (panic locations included), --build-id=none, no .comment beyond the toolchain identification, no embedded environment except QA_BROKER_SOURCE_COMMIT |
| Linkage | Static-pie ELF64 x86-64: no PT_INTERP, no DT_NEEDED, no RPATH/RUNPATH; musl from the pinned Rust target. No shared library, so no dynamic-loader or library-substitution class applies to the broker, and brokerSha256 covers all broker code |
| CPU baseline | x86-64 baseline (no target-cpu override). aarch64: DEFERRED |
| Panic / OOM | Process abort = broker crash, handled only by §7.4 |
| Reproducibility verification | Two builds from the same commit, Cargo.lock and build-env.digest, on two different physical or virtual x86-64 hosts (different kernels, hostnames, users and host checkout paths outside the container), each in a fresh container per the rows above, give byte-identical artifacts (equal SHA-256); a third build by the release-qualification party repeats the check. A difference, or a build that needs any input not listed here, is non-reproducible: release qualification is BLOCKED. Matching artifacts are necessary, not sufficient: the build environment must also pass the §20.3.4a provenance and rebuild checks. The build record is QaAgentControllerBuildRecord v1 (§20.3.4a: commit, recipe and image provenance, toolchain hashes, Cargo.lock SHA-256, RUSTFLAGS, artifact SHA-256 of each build) and is release-qualification evidence |

brokerBuild (enrollment qualification, <=256 ASCII) is exactly
"qa-agent-controller-v1/" + brokerVersion + "+" + 40-hex source commit +
" rustc/" + exact toolchain version + " x86_64-unknown-linux-musl", compiled
into the artifact as a literal; C7 compares it with enrollment
qualification.brokerBuild. brokerVersion is semver, independent of the npm
version. contractVersion stays "qa-agent-controller-v1"; an incompatible
contract is a new literal, new fixed paths and a new artifact, never an
in-place change.

#### 20.3.4a Build-environment provenance (C2, closed)

Reproducibility alone does not make a build image trustworthy: an opaque
image can reproduce its own output. The closed chain is

    versioned recipe -> OCI build -> immutable image manifest digest
      -> build-env.digest -> broker build record

and no step may be skipped or replaced by an image of unknown origin.

Recipe. native/qa-agent-controller-v1/Containerfile in this repository,
recipe revision 1. It builds the build environment only: no broker source,
no broker compilation, no Cargo file. containerfileDigest = "sha256:" +
lowercase hex SHA-256 over the git blob bytes of that path at the source
commit (`git cat-file blob <commit>:native/qa-agent-controller-v1/Containerfile`),
never over a working-tree checkout, so line-ending conversion cannot change
it. The blob must be ASCII, LF line endings, one final LF, no BOM; a blob
that is not is not a qualified recipe. Every input is a literal in the
recipe, so containerfileDigest binds all of them:

| Input | Pinned value (verified 2026-10-15) |
|---|---|
| Base image | docker.io/library/debian:trixie-20260918, linux/amd64 image manifest sha256:d5ce19d4736f0ebbacd686d1040271a5aeb0cc920f5990c1bfae1717627f0674 (from index sha256:9cc080028c43b27d2074d63a5f9caf7166d731494965616c1a6d2827a004585c; one layer sha256:6eefb2f5d3e91a6cfc577476bbec26bb63f0d0fc31f904493f400833783aa2c2; config architecture amd64, os linux; debuerreotype 0.17, epoch @1789689600 = 2026-09-18T00:00:00Z). The tag is informational; FROM uses the digest |
| Debian snapshot | http://snapshot.debian.org/archive/debian/20260917T202223Z (suites trixie = Debian 13.7, trixie-updates) and http://snapshot.debian.org/archive/debian-security/20260917T225432Z (trixie-security); component main; the exact runs to which the base image's own 20260918T000000Z snapshot resolves. Release files are verified by apt against the base image's /usr/share/keyrings/debian-archive-keyring.pgp; Check-Valid-Until is off because snapshot Release files have expired, signature checking is not |
| Packages, environment stage | ca-certificates=20250419, gcc=4:14.2.0-1, gcc-14=14.2.0-19, libc6-dev=2.41-12+deb13u4 (equal to the base image's libc6), --no-install-recommends; their dependencies are fixed by the snapshot |
| Packages, fetch stage only | ca-certificates=20250419, curl=8.14.1-2+deb13u5, xz-utils=5.8.1-1+deb13u1; not in the final image |
| Rust | The four §20.3.4 component tarballs from https://static.rust-lang.org/dist/2025-02-20/, each checked with sha256sum --strict against the §20.3.4 values before extraction (equal to channel-rust-1.85.0.toml, whose published SHA-256 is 009e8b5ff43f12bf644b5e5b9fd89f96453072062a450c623882f64e85405da5), installed with each component's install.sh --disable-ldconfig; rustc --version must equal "rustc 1.85.0 (4d91de4e4 2025-02-17)", and rust-lld plus the musl self-contained objects must exist |
| Final image configuration | Env exactly PATH, RUSTUP_HOME, CARGO_HOME, CARGO_TARGET_DIR, CARGO_INCREMENTAL, LANG, LC_ALL, TZ with the §20.3.4 values; USER 10001:10001 (numeric, no passwd entry); WORKDIR /build/src; /build/target and /opt/rust/cargo/registry owned 10001:10001; ENTRYPOINT []; CMD /usr/bin/false. A broker build still supplies the full §20.3.4 environment explicitly |

The image contains no rustup, so rust-toolchain.toml is not a toolchain
resolution input inside it; the build qualification still requires
rustc -vV in the image to report release 1.85.0 and the §20.3.4
identification "rustc 1.85.0 (4d91de4e4 2025-02-17)", and
rust-toolchain.toml to pin channel "1.85.0". Mutable mirrors
(deb.debian.org) and tags are never trust anchors.

Image build procedure (performed only under a later Stage 5
implementation or build-qualification authorization; C2 builds and
publishes nothing):

1. Extract the recipe blob from the source commit into an empty scratch
   directory and verify containerfileDigest and the format rule.
2. docker buildx build (BuildKit) with --platform linux/amd64, --no-cache,
   --pull, --provenance=false, --sbom=false, -f the extracted recipe and an
   empty build context directory; the output is a single-platform image
   with an OCI image manifest (oci-mediatypes), with no index and no
   attestation manifest. Network is permitted for this step only (signed
   apt over the snapshot, hash-verified Rust downloads); broker builds stay
   --network none (§20.3.4). The builder name and version are recorded.
3. The image manifest digest D is the SHA-256 of the manifest bytes; its
   config must state architecture amd64 and os linux.
4. The content record of D (below) is computed and retained.

Content record. QaAgentBuildEnvContent v1, all keys required:
{kind:"QaAgentBuildEnvContent", schemaVersion:1, image, packages, entries}.
It is computed from the flattened root filesystem of a container created
from D and never started (docker create, then docker export):

- image = {architecture, os, env (config order), user, workingDir,
  entrypoint, cmd} from the image config;
- packages = every var/lib/dpkg/status stanza with Status "install ok
  installed", as {package, version, architecture}, sorted by package;
- entries = every export member under opt/rust, usr and etc (the three
  roots included) except etc/hostname, etc/hosts and etc/resolv.conf, as
  {path, type, mode, uid, gid, size, sha256, linkTarget}, sorted by path
  bytewise. path has no leading "./" or "/" and no trailing "/", and must
  be valid UTF-8; type is "file", "dir" or "symlink"; a tar hard-link
  member is a "file" with its target's size and SHA-256, so member order
  cannot matter; mode = permission and special bits as an integer; size is
  the byte length for a file and 0 otherwise; sha256 = "sha256:" + hex for
  a file, otherwise null; linkTarget is the symlink target, otherwise null.
  Modification times, user and group names are excluded. Any other member
  type, a non-UTF-8 path or a security.capability attribute under the
  roots fails the procedure.

buildEnvContentDigest = "sha256:" + hex SHA-256 over the CRS-1
encodeValue bytes of the record (content-digest convention; no new hash
domain). The exclusion list is closed: a rebuild difference that would
need another exclusion is a mismatch, and only a new recipe revision
reviewed with this section can change the list.

Durable location. ghcr.io/tarasovartem/qa-agent-controller-v1-build-env, a
GitHub Container Registry package of the repository owner, linked to
TarasovArtem/qa-ai-agent (the registry requires the lowercase owner name).
Consumers pull only by digest
(ghcr.io/tarasovartem/qa-agent-controller-v1-build-env@sha256:...); tags,
if any, are informational and never trust anchors. Retention: a manifest
whose digest appears in a release-approved build record is never deleted
while that record's broker artifact is release-approved, installed on any
host, or within the release's own retention; package settings must not
auto-delete it. The package must be readable by every release-qualification
party; its visibility, and publication itself, are decided by the later
publication approval and are NOT AUTHORIZED here. Selecting this location
adds no product or release decision: it is the registry of the repository
whose GitHub Release §20.3.5 already names.

build-env.digest. Written only after D has been pushed to the durable
location, pulled back by digest, and its recomputed content record found
byte-identical to the step-4 record. Then build-env.digest contains D, the
manifest digest the registry serves for that push, and nothing else. Every
broker build uses exactly that digest. C2 defines this procedure; no value
of D, build-env.digest or buildEnvContentDigest exists yet.

Independent rebuild and verification (release qualification). An
independent party:

1. checks out the exact source commit;
2. extracts the exact versioned recipe from it;
3. verifies containerfileDigest;
4. verifies that the recipe's FROM digest is the base digest of the build
   record and that it resolves at docker.io to an amd64 linux image
   manifest with those bytes;
5. uses only the recipe's snapshot URLs and package versions (apt verifies
   the Debian signatures);
6. lets the recipe verify the Rust component hashes (any mismatch stops the
   build);
7. rebuilds the image with the step-2 command;
8. computes the content record of its rebuild and of D pulled from the
   durable location; both must be byte-identical to the qualified record
   (manifest digests of independent rebuilds are not expected to equal D
   and are never compared as anchors);
9. runs the §20.3.4 independent broker builds in a fresh container from D
   and compares artifact digests.

A failure at any step BLOCKS release qualification. Two matching broker
artifacts never qualify an image that fails steps 1–8.

Build record. QaAgentControllerBuildRecord v1, all keys required, CRS-1
canonical bytes, buildRecordDigest = "sha256:" + hex SHA-256 over them (no
new hash domain): {kind:"QaAgentControllerBuildRecord", schemaVersion:1,
contractVersion, brokerVersion, brokerBuild, sourceCommit,
containerfileDigest, baseImage {reference:"docker.io/library/debian",
manifestDigest}, debianSnapshot {debian, debianSecurity}, environmentPackages
[{package, version}], rustComponents [{name, sha256}],
buildEnvImage:"ghcr.io/tarasovartem/qa-agent-controller-v1-build-env",
buildEnvDigest, buildEnvContentDigest, cargoTomlSha256, cargoLockSha256,
rustToolchainTomlSha256, rustflags, builds [{party, artifactSha256}] (at
least the two §20.3.4 hosts and the release-qualification party),
artifactSha256}. artifactSha256 is the raw SHA-256 of the artifact bytes
(the SHA256SUMS form); every builds[] value must equal it; brokerSha256
(§5.4) is computed over the same bytes. The record is release-qualification
evidence and is never read by the client or the broker.

Requalification. A new broker build and requalification are mandatory when
any of these changes: the recipe bytes (containerfileDigest); the base
image digest; a Debian snapshot; the package set or a package version; a
Rust component or toolchain hash; the image manifest digest
(build-env.digest) or buildEnvContentDigest; Cargo.lock; the direct or
transitive dependency graph; RUSTFLAGS or the release profile; any
security-relevant build-environment setting (user, paths, environment,
network mode, linker). No image becomes qualified merely because it
produces a reproducible artifact.

#### 20.3.5 Distribution, install, upgrade and removal

- npm relationship: none. The npm package never contains, downloads,
  builds, installs or upgrades the broker, sudoers file, enrollment, view
  or mounts, and has no postinstall. The client knows only the fixed paths
  and the contract literal.
- Artifact format: one file, qa-agent-controller-v1-<brokerVersion>-x86_64-linux-musl,
  plus SHA256SUMS. Publication channel, if and when release-approved: a
  GitHub Release of TarasovArtem/qa-ai-agent tagged
  controller-v1/<brokerVersion>, built by a separately approved workflow.
  Trust anchor: the release-approved §5.4 record's brokerSha256 plus
  reproducible rebuild from the tagged commit. Signatures, if release
  approval adds them, are additive and never replace the digest check.
- Install (operator, root, a manual documented procedure; no installer
  script, so the single-artifact rule holds): verify SHA-256 against the
  approved record; install -o root -g root -m 0755 to
  /usr/local/libexec/.qa-agent-controller-v1.new; rename to
  /usr/local/libexec/qa-agent-controller-v1 (same directory, atomic); write
  compatibility.json, enrollment.json and enrollment-public.json; install
  the §20.2.3 sudoers file after visudo -cf; provision B (§5.6.3); qualify;
  enable enrollment last.
- Upgrade, downgrade and removal: exactly §5.3 (disable, drain, revoke the
  rule, atomic replacement, requalify, re-enable; no ABI fallback, no
  journal migration). Every new artifact digest needs a new
  release-approved §5.4 record and a new view (compatibilityDigest
  changes). Removal leaves protected history per §5.3; nothing outside the
  fixed paths is touched.

#### 20.3.6 Required Linux/systemd environment

Mandatory primitives (broker-checked or qualification-checked; no
fallback): unified cgroup v2 only; openat2 with RESOLVE_BENEATH,
RESOLVE_NO_SYMLINKS and RESOLVE_NO_XDEV; statx STATX_MNT_ID and
STATX_ATTR_MOUNT_ROOT; pidfd_open and pidfd_send_signal; nsfs namespace
files; memfd_create with F_SEAL_SEAL/SHRINK/GROW/WRITE; close_range;
SO_PEERCRED on AF_UNIX stream sockets; D-Bus GetConnectionCredentials
ProcessFD (dbus-daemon >= 1.15.8/1.16.0 or dbus-broker >= 34; D-Bus
specification revision 0.42); systemd >= 255 (SetLoginEnvironment, used by
the §6.1 table, first appears in v255:
[systemd.exec v257 source](https://raw.githubusercontent.com/systemd/systemd/v257/man/systemd.exec.xml));
the upstream sudo project >= 1.9.15 (not sudo-rs or another
reimplementation); Yama kernel.yama.ptrace_scope >= 1 set by the operator
(L4); filesystems per §5.6.2/§5.6.3.

Reference target (the only one this design names): **Debian 13 (trixie)
amd64**: kernel 6.12 series and systemd 257
([release notes](https://www.debian.org/releases/trixie/release-notes/whats-new.en.html)),
sudo 1.9.16p2 ([package](https://packages.debian.org/trixie/sudo)),
dbus-daemon 1.16.2 ([package](https://packages.debian.org/trixie/dbus-daemon)).
These are distribution facts, not qualification: eligibility exists only
for an exact recorded tuple after Stage 5 qualification.

| Class | Environment | Disposition |
|---|---|---|
| A. Development/build | Any x86-64 Linux, including containers, WSL2 and GitHub-hosted runners, with the pinned toolchain: unit tests, parser fuzzing, canonical vectors, unprivileged protocol tests | SUPPORTED for build and unprivileged tests only; never qualification evidence |
| B. Integration | Disposable Debian 13 VM (KVM/QEMU/libvirt or an equivalent cloud VM) with systemd as PID 1, real sudo, a dedicated thick-provisioned virtual disk for B, root for the harness | QUALIFICATION-ONLY |
| C. Privileged adversarial | As B, plus snapshot/revert between runs, extra local accounts (other user, same-account attacker processes), reboot, daemon-reexec, kill injection and filesystem/mount manipulation; nested virtualization neither required nor relied upon | QUALIFICATION-ONLY |
| D. Release qualification / execute | Dedicated self-hosted runner host (bare metal, or a dedicated VM that is itself the qualified host; the hypervisor is outside the claim) running Debian 13 amd64 with the exact recorded tuple; runner account with no elevation path except §20.2.3, proven by od06-priv-surface-v1 (§20.2.7); dedicated B device; operator-held root | SUPPORTED (reference target, only after qualification) |
| Ubuntu 24.04 LTS | Its dbus-daemon 1.14 series lacks ProcessFD; N1 would need an owner decision | DEFERRED |
| Other distributions (RHEL/Alma/Rocky 10, Fedora, other Ubuntu releases, Arch, ...) | Not analysed | DEFERRED |
| Any host whose sudo is not upstream sudo (for example sudo-rs) | §20.2 evidence is upstream-specific | REFUSED |
| GitHub-hosted runners for execute | Runner account has generic passwordless sudo (violates §5.1/L4); no dedicated B; provider-controlled | REFUSED (class A only) |
| Containers (Docker, Podman, LXC, Kubernetes) | Fail N1–N3 by design | REFUSED |
| WSL2 (any distribution, including docker-desktop) | Windows-hosted shared utility VM, per-distribution namespaces, 9p/drvfs filesystems | REFUSED |
| Windows / macOS hosts | No Linux containment | REFUSED |
| aarch64 | No artifact | DEFERRED |

Root privilege is needed by the operator for provisioning and by the
classes B–D qualification harness, never by the client or Stage 5 product
code. The current Windows host can prove none of this.

#### 20.3.7 Negative tests and qualification evidence (DG-3)

Artifact with PT_INTERP or DT_NEEDED -> release blocked; digest mismatch
with the record -> INCOMPATIBLE; a copied or replaced broker executed from
another path, so that /proc/self/exe differs in dev/ino from the fixed path
-> CALLER_REFUSED at C1a.2, and a broker replaced at the fixed path -> the
C1a.2 owner/mode/link-count checks and the C7 brokerSha256 content check
(C2 correction, Security INFO-2: dev/ino equality alone does not detect a
bind mount of another file onto the fixed path, because the path and
/proc/self/exe then name the same mounted inode; creating that mount needs
CAP_SYS_ADMIN over the mount namespace, a broker outside the initial user
namespace fails C1a.4, so only root can do it and it is outside the
non-root attacker claim; brokerSha256 at C7 still verifies the content of
the file at the fixed path, which is the executed file. STATX_MNT_ID is
not added as a broker invariant by this correction); group-writable
/usr/local ancestor -> refused; brokerBuild mismatch -> INELIGIBLE;
non-reproducible rebuild -> release blocked; a build linked by a host cc or
ld instead of the pinned rust-lld, a build outside the build-env.digest
container, an extra or missing environment variable or RUSTFLAGS entry, or an
artifact containing a host build path or build ID -> not a qualified build
(release blocked); a zbus version other than 5.13.2, a direct dependency
outside the allowlist, a git/path/alternative-registry source or a registry
checksum mismatch -> release blocked; bus reply without ProcessFD on the
reference host -> N1 failure (§5.6.1); unsolicited unicast D-Bus
signals and method calls from another account during observation are
dropped; DBUS_* in the caller environment has no effect; differential
fuzzing of the Rust JSON parser against the product strict parser; P0 frame
fuzzing (L1); panic paths behave as a crash per §7.4.

Unsolicited D-Bus flood (C2, Security INFO-4; adversarial qualification,
linked to L1/L7, not closing them): from the runner account and from a
second local account, sustained unicast signals, method calls and errors
addressed to the broker's unique name, including messages that imitate
systemd1 interfaces, paths and member names and messages at the bus
max_message_size, during every phase P1–P6 and during RECONCILE. Required
observations: no such message is ever used (the sender filter drops it);
broker resident memory stays within the §20.3.3 bound computed from the
zbus queue count, 64 and the recorded max_message_size; no phase exceeds
its §6.4 bound (a starved manager wait ends in the existing outcome for
that phase); no flood yields PASSED, TEST_FAILED or a changed observation;
the global broker invocation count is unchanged by the flood (L7 stays
OPEN).

Build provenance (C2): a recipe blob with a changed byte, CRLF line
endings or a BOM -> containerfileDigest mismatch, not qualified; FROM by
tag only or by another digest; an image built from deb.debian.org or
another moving mirror; a Rust tarball with one flipped byte (sha256sum
fails, build stops); rustup or a distribution rust package present in the
image; an image with an extra package or a changed file under opt/rust,
usr or etc -> content record mismatch; an independent rebuild whose content
record differs -> release blocked; build-env.digest pointing at an image
not pushed to the durable location or not re-pulled and re-verified -> not
qualified; two byte-identical broker artifacts from an unprovenanced image
-> not qualified; any §20.3.4a requalification input changed without a new
build record -> release blocked.

### 20.4 DG-4 — execute CLI and configuration

#### 20.4.1 Reconstructed gap

Today execute is kind "reserved": trailing arguments are not interpreted,
and it exits 5 before root/config reads (args.js/cli.js). Stage 4 commands
use --run/--package and refuse --json. Config v1 has no execute block. §4.2
names a later closed execute={timeoutMs,sutEnvironmentNames} revision and
authorizes no CLI option. Nothing defines the grammar, reconcile surface,
client state, output or exits.

#### 20.4.2 Alternatives

| Option | Verdict |
|---|---|
| Minimal: execute --run --package, no new flag, implicit reconcile through local attempt state | **SELECTED** |
| Explicit --reconcile flag or "execute reconcile" subcommand | Rejected: new option or word; a rerun without it needs a second refusal path; the §20.4.7 guard already prevents accidental reconcile of a live attempt |
| --execution <id> selector | Rejected: new selector concept; executionId is client-generated and recorded locally |
| Additive execute key under schemaVersion 1 | Rejected: two incompatible meanings of "v1" across product versions |
| Free-form spec/grep/browser/framework/timeout flags | Rejected (mission and §4.2) |

#### 20.4.3 Grammar

    qa-agent execute --run <id> --package <NNNN> [--root <dir>] [--config <path>] [--json]
    qa-agent execute --help

Command spec: kind "execute", capability "execute", requiresRun,
requiresPackage, flags exactly [json, root, config, help, run, package].
--run: RUN_ID_PATTERN; --package: four digits, not 0000 (existing messages
and codes). --offline, --history, --version and positional arguments are
refused with the existing usage codes (exit 2); duplicate and unknown
options as today (exit 2). --help prints execute help (stating "disabled in
this release" while disabled) and exits 0, reading nothing. --offline is
refused because it would suggest test-network isolation, which R-5 denies.
No other flag exists. This replaces the reserved route only when Stage 5
implementation is merged; until then today's reserved behaviour is
unchanged. After that change a malformed execute command line exits 2
(usage), not 5, as for the Stage 4 commands.

#### 20.4.4 Configuration schema v2

qa-agent.config.json schemaVersion 2 = the exact v1 schema plus one optional
top-level key, execute; schemaVersion 1 files keep exactly today's closed
schema (an execute key in a v1 file is CONFIG_SCHEMA_INVALID, exit 3). The
product accepts 1 and 2, never writes config and never migrates it.

| Key | Rule |
|---|---|
| execute | Optional closed object {timeoutMs?, sutEnvironmentNames?}; unknown key -> CONFIG_SCHEMA_INVALID 3 |
| execute.timeoutMs | Integer 1000..600000; default 600000 |
| execute.sutEnvironmentNames | Array of 0..32 unique strings, each matching ^SUT_[A-Z][A-Z0-9_]{0,59}$; default []; normalized to bytewise sorted order |

Effective execute config: the values of a v2 execute block, otherwise the
defaults (a v1 file with capabilities.execute=true executes with T=600000
and no SUT variables). Schema validity stays separate from capability (a v2
execute block is valid while execute is disabled). info reports
contracts.config = 2 (highest accepted); config validate reports the file's
schemaVersion. Older product versions refuse v2 files (exit 3); that is the
expected forward incompatibility. Whether the names are a subset of the
enrolled sutNames remains a broker check (§4.3 item 5).

Runtime SUT values: for each effective name, the client reads exactly that
variable from its own environment; missing -> exit 3
EXECUTE_SUT_ENVIRONMENT_INVALID; empty allowed; a value or total over the
§9.1 bounds, or containing NUL -> the same code. No other variable is read
for the workload; nothing is inherited wholesale.

#### 20.4.5 Validation order and exits

The order is exactly the productization §10.7 pipeline, usage (2) → config
(3) → authority (5) → input (4) → provider (6) → execution (7/8/10), with no
Stage-5-specific exception and no change to the numeric taxonomy. Within a
stage the steps run in the listed order. The first failing step ends the
invocation and determines the exit and reason code, so simultaneous failures
always resolve to the earliest stage and, within it, the earliest step.

| # | Stage | Step | Applies to | Exit / code |
|---|---|---|---|---|
| 1 | Usage | §20.4.3 grammar | All | 2 (existing usage codes) |
| 2a | Config | Root resolution and containment, config load, closed v1/v2 schema (§20.4.4), output.dir containment; the current canonical root digest (Stage 4 root-identity-v1) is computed here | All | 3 (existing config codes) |
| 2b | Config | Effective execute config; each effective SUT variable present in the client's own environment and within §9.1 bounds (§20.4.4) | All (values are sent only on CREATE) | 3 EXECUTE_SUT_ENVIRONMENT_INVALID |
| 3a | Authority | RELEASE_CAPABILITIES.execute disabled | All | 5 CAPABILITY_NOT_ENABLED_IN_RELEASE; nothing after this step runs |
| 3b | Authority | Platform linux, Stage 4 principal, Stage 4 storage eligibility | All | 5 EXECUTE_PLATFORM_UNSUPPORTED / existing REVIEWER_IDENTITY_UNAVAILABLE |
| 3c | Authority | Local-state classification (§20.4.7): BOUND_RECORDED, BOUND_LIVE, BOUND_RECONCILABLE, NONE or INVALID | All | BOUND_RECORDED -> 5 EXECUTION_ALREADY_RECORDED; BOUND_LIVE -> 5 EXECUTION_IN_PROGRESS; INVALID emits nothing here (deferred to 4a); operation = RECONCILE iff BOUND_RECONCILABLE, otherwise CREATE |
| 3d | Authority | capabilities.execute opt-in | CREATE (every classification except BOUND_RECONCILABLE) | 5 CAPABILITY_NOT_REQUESTED |
| 3e | Authority | §20.1.5 steps 3–5: compatibility.json, public view, root entry for the step-2a root digest | CREATE | 5 EXECUTE_INCOMPATIBLE / EXECUTE_RUNNER_NOT_ELIGIBLE |
| 3f | Authority | /usr/bin/sudo under PP (advisory early refusal, §20.2.4) | All | 5 EXECUTE_BROKER_UNAVAILABLE |
| 4a | Input | Local state INVALID (from 3c) | All | 4 EXECUTION_CLIENT_STATE_INVALID |
| 4b | Input | §8.1 binding reconstruction | CREATE | 4 (existing Stage 4/applied codes, EXECUTION_BINDING_MISMATCH) |
| 4c | Input | §20.1.5 step 6 fingerprint member bytes, then steps 7–8 | CREATE | 4 EXECUTION_FINGERPRINT_MISMATCH |
| 5 | Provider | None consumed; AI_* and providers.allow are not evaluated | — | — |
| 6a | Execution | Durable attempt marker (§20.4.7) | CREATE | 1 on I/O failure (internal), before sudo |
| 6b | Execution | sudo spawn failure (ENOENT/EACCES) before any byte is sent (a race after 3f) | All | 5 EXECUTE_BROKER_UNAVAILABLE; a CREATE marker is removed |
| 6c | Execution | Broker REFUSED | All | SCHEMA_INVALID -> 1; INPUT_MISMATCH -> 4; CALLER_REFUSED, INELIGIBLE, REPLAY, INCOMPATIBLE, RECOVERY_BUDGET_EXHAUSTED -> 5 |
| 6d | Execution | Validated TERMINAL/QUARANTINED | All | §9.3 table (0, 10, 8, 7) |
| 6e | Execution | Client-side protocol violation, EOF before a final frame, sudo exit without a frame | All | 7 (synchronous orphan; marker retained) |

Why this is the product-wide order and not an exception:

- Applicability, not reordering: 3d, 3e, 4b, 4c and 6a are CREATE-only,
  mirroring §5.6.4 rule (a) (reconcile needs no opt-in, binding,
  fingerprint or execute-block authority). Whether a step applies is
  decided by 3c before the step's stage completes, so no CREATE-only check
  ever runs after a later-stage failure. INVALID state is treated as
  CREATE for applicability: it can never be reconciled, so a 5 from 3d/3e
  precedes the 4 from 4a, exactly as the tie rule requires.
- Config-stage checks precede operation selection, so 2a and 2b apply to
  RECONCILE as well: a reconcile needs a valid config and the effective SUT
  variables present, but sends no SUT value and uses no execute-block value.
  This is the only operational consequence of the tie rule for RECONCILE.
- 3c reads input files but emits only authority-class refusals (5); every
  input-class defect it finds is reported at 4a. The tie rule orders failing
  checks, and no 4 is emitted before stage 3 has passed.
- 6b and 6c are dispositions of the single privileged attempt. They occur
  only after every client stage passed, so they never compete with a
  client-detected failure; the broker's own fixed order (§5.6.4, §20.2.5)
  selects its single refusal. The numeric mappings are unchanged.

Release-disabled invariant: with RELEASE_CAPABILITIES.execute disabled, an
invocation performs only steps 1–3a. It reads the command line, the root
directory identity, the target's config file and its own environment (2b
reads and discards the effective SUT values), and nothing else: no run
evidence, local execution state, compatibility.json, public view or
/usr/bin/sudo; no write; no sudo spawn and no broker or privileged action.
A malformed command line still exits 2 and an invalid config 3, per the
product-wide tie rule; every invocation that passes steps 1–2b exits 5 at
3a.

No interactive TTY is required and the Stage 4 CI/TTY refusals do not
apply: execute never prompts and never reads its own stdin. CI use is
allowed only on a qualified runner; Stage 4 prohibitions are unaffected.

#### 20.4.6 Output and executionId exposure

--json: stdout carries exactly one envelope (existing CLI output schema 1)
{schemaVersion, command:"execute", ok, exitCode, runId, artifacts, errors,
execution}; execution = null until step 3c selects an operation (and for
every failure at or before 3c), otherwise exactly {operation:
"create"|"reconcile", executionId, packageOrdinal, status, reason,
recordPath, recordDigest}, with status, reason, recordPath and recordDigest
null until a validated TERMINAL/QUARANTINED. Human mode: one line on
ACCEPTED ("execution <executionId> accepted (unit <unitName>)") and a final
status line with the record path. In both modes the broker's raw stdout/
stderr frames (§9.2) are written to the client's stderr only, bounded as in
§9.2 and never persisted by the product. executionId is printed, recorded
in the marker and in the record filename; it is never a CLI input.

#### 20.4.7 Client state, CREATE versus RECONCILE

Directory <output.dir>/execution/ (output.dir containment rules; created
non-recursively; no symlink). Files have closed schemas and are created
with O_EXCL and fsynced together with the directory:

- attempt-<runId>-<NNNN>.json = QaAgentExecutionClientAttempt v1, exact keys
  {kind:"QaAgentExecutionClientAttempt", schemaVersion:1, executionId,
  runId, packageOrdinal, rootDigest, product, bindingDigest, clientBootId,
  clientPid, clientStartTime, createdAt}; product is the client's own
  installed {name, version} (the binding product grammar); bindingDigest is
  the step-4c value sent in the CREATE request; clientBootId is the
  lowercase canonical UUID from /proc/sys/kernel/random/boot_id; clientPid
  a safe integer; clientStartTime the decimal string of field 22 of
  /proc/self/stat; createdAt UTC. Bytes are the CRS-1 canonical encoding.
  Written immediately before the sudo spawn of a CREATE (step 6a).
- <executionId>.json = the exact AutomationExecutionRecord v2 bytes from a
  validated TERMINAL/QUARANTINED frame of this invocation's attempt,
  written only after the R-checks below pass on the received record.

These files are local evidence copies and a recovery hint, never authority;
the broker's protected journal and tombstones decide.

Step 3c reads only two names: the marker file for the invocation's --run
and --package, and, if that marker is BOUND, the record file named by
marker.executionId. Files of other (run, package) pairs are never read and
never influence the decision. Each read file must be a regular file opened
without following symlinks beneath the non-symlink execution directory,
link count 1, owner = the client's effective UID, size <= 1048576 (marker)
or the §11.3 record bound, strict JSON in canonical encoding with the
closed schema.

Marker binding (all required for BOUND; any failure is INVALID):

- M1 The marker's file-name runId and NNNN equal marker.runId and
  marker.packageOrdinal.
- M2 marker.runId = --run and marker.packageOrdinal = --package.
- M3 marker.rootDigest = the current canonical root digest from step 2a
  (a marker copied from, or restored for, another root, or written before
  the root's identity changed, never matches).
- M4 marker.product = the client's own product {name, version} (a marker
  written by another product version is foreign, consistent with the
  Stage 4 "run created by another product version" input refusal).
- M5 marker.executionId matches the §7.1 executionId grammar and
  marker.bindingDigest is H. bindingDigest is not recomputed at 3c: it
  needs §8.1 reconstruction (input stage), RECONCILE needs no binding
  (rule (a)), and it is compared with the record below.

Record binding (all required for BOUND_RECORDED; any failure is INVALID):

- R1 The record file name is marker.executionId + ".json" and
  record.executionId = marker.executionId.
- R2 record.recordDigest verifies over the record (§11.3 domain).
- R3 record.binding.bindingDigest = marker.bindingDigest and verifies over
  record.binding (§11.1 execution-binding domain).
- R4 record.binding.runId, packageOrdinal and root.digest equal M2/M3's
  current values; record.binding.product = marker.product; and
  record.binding.principal = the step-3b Stage 4 principal.
- R5 record.status and reason are a valid §11.3 pair.

Review, apply, package and plan identities (reviewRecordId, applyRecordId
and the binding digests) are bound by R3 through bindingDigest and are not
re-derived at 3c. That is sufficient: R4 fixes (root, run, package), and the
broker's tombstone for that triple refuses every further CREATE (REPLAY)
whatever apply identity a different record claimed, so a record cannot make
the client skip a CREATE that the broker would allow.

| Local state for (run, package) | Classification at 3c | Action |
|---|---|---|
| No marker file | NONE | CREATE with a fresh executionId |
| M1–M5 pass; record present and R1–R5 pass | BOUND_RECORDED | Exit 5 EXECUTION_ALREADY_RECORDED (no broker call, no re-execution) |
| M1–M5 pass; no record; clientBootId = current boot_id and a process with clientPid, owned by the client's UID, whose /proc stat field 22 = clientStartTime exists | BOUND_LIVE | Exit 5 EXECUTION_IN_PROGRESS (no broker call) |
| M1–M5 pass; no record; that process is not live (or another boot) | BOUND_RECONCILABLE | RECONCILE(marker.executionId) |
| Any M-check fails; a record file present for a BOUND marker but any R-check fails; a non-regular, symlinked, hard-linked, foreign-owned, oversize, non-canonical or schema-invalid marker or record | INVALID | Exit 4 EXECUTION_CLIENT_STATE_INVALID at 4a (no broker call), unless an earlier step refused |

A copied, restored, foreign or stale marker or record therefore never
selects RECONCILE, EXECUTION_IN_PROGRESS or EXECUTION_ALREADY_RECORDED for
an unrelated execution; it fails closed as INVALID with the existing code.
The broker still re-checks everything on RECONCILE (R1a–R7) and binds the
executionId to its protected attempt.

The liveness guard is a same-account UX safeguard that stops a second
invocation from reconciling (stopping) an attached attempt; it is not a
security boundary. Deleting local files cannot re-authorize execution: a
new CREATE for a consumed (root, run, package) is REFUSED/REPLAY by the
broker's tombstones, which remain authoritative.

A pre-reservation REFUSED on CREATE (proven unreserved, §7.2) and a
step-6b spawn failure remove the attempt file, so a retry after
remediation is a fresh CREATE. Reconcile clarification (refines §5.6.4 R4,
no new enum): an executionId with no protected attempt after transaction
recovery is REFUSED/INPUT_MISMATCH with no journal write or manager action;
the client then removes the attempt file and exits 4 EXECUTION_NOT_FOUND.

#### 20.4.8 Capability and activation boundary

RELEASE_CAPABILITIES.execute stays {enabled:false}. Stage 5 implementation
(separately authorized) may add the grammar, config v2, client and broker
behind that gate; every execute invocation that passes steps 1–2b then
exits 5 CAPABILITY_NOT_ENABLED_IN_RELEASE at step 3a, under the §20.4.5
release-disabled invariant (no local state, protected file, sudo or broker
access). info platform.executeDecision stays "PENDING_OD_06" until
activation. Activation is exactly a separate,
Product-Owner-authorized change that sets enabled:true (and the info
decision value) after Stage 5 implementation, Linux/native/adversarial/
installed-package qualification and independent Security review;
Controlled Release remains a further separate decision. Target opt-in can
never override the release gate.

#### 20.4.9 Negative tests (DG-4)

Every refused flag and duplicate; --json with stdout purity; --help with an
invalid config (exit 0, nothing read); disabled release with well-formed and
malformed trailing input (after implementation: 2 for malformed, 3 for an
invalid config, otherwise 5 at 3a with a syscall trace showing no read of
local execution state, compatibility.json, the public view or
/usr/bin/sudo and no spawn; before: byte-identical reserved behaviour); v1
file with an execute key; v2 bounds (999, 600001, 33 names, duplicate,
lowercase, `SUT_` alone, 61-character suffix); missing SUT variable; oversize
value; v1 defaults. Precedence pairs (§20.4.5), each asserting the earlier
stage's code: usage + invalid config -> 2; invalid config + disabled
release -> 3; missing SUT variable + disabled release -> 3; disabled
release + INVALID local state -> 5 CAPABILITY_NOT_ENABLED_IN_RELEASE with
the state unread; missing opt-in + INVALID local state -> 5
CAPABILITY_NOT_REQUESTED; stale public view + INVALID local state -> 5;
BOUND_RECONCILABLE + missing opt-in + stale view -> RECONCILE proceeds;
INVALID local state + binding mismatch -> 4
EXECUTION_CLIENT_STATE_INVALID; binding mismatch + fingerprint drift -> 4
EXECUTION_BINDING_MISMATCH. Local-state identity (§20.4.7): every
classification row; each M1–M5 and R1–R5 check failing alone (marker
renamed to another run or package, marker copied from another root,
marker from another product version, malformed executionId, record from
another execution, record with a bindingDigest differing from the marker,
record whose binding names another run, package, root or principal, record
digest altered), each -> 4 with no broker call; forged pid/start time;
stale boot; deleted record and deleted attempt (broker REPLAY); RECONCILE
without opt-in; the INPUT_MISMATCH not-found path; sudo absent at 3f and
removed between 3f and 6b.

### 20.5 Trust-boundary data map

The §12 mission chain (client -> Stage 4 reconstruction -> binding -> sudo
-> C1a -> broker reconstruction -> compatibility/qualification -> protected
reservation -> P1S -> StartTransientUnit -> observation -> proposal ->
durable terminal -> release/reconcile) crosses these boundaries:

| Datum | Source / owner | Permissions | Validator | Canonical form / hash domain | Failure |
|---|---|---|---|---|---|
| Caller identity | Kernel SO_PEERCRED of the client socketpair | Kernel-recorded | Broker C1a.5 | — | CALLER_REFUSED 5 |
| Parent elevation structure | Kernel /proc + pidfd | root-readable | Broker C1a.4 | dev/ino equality | CALLER_REFUSED 5 |
| Request frame | Client | Socket, in-kernel | Broker P0, C7 | Strict JSON §4.2 | SCHEMA_INVALID / INPUT_MISMATCH |
| enrollment.json | Operator | root:root 0600 | Broker C1a.3 | Strict JSON §5.2 | §5.2 mapping |
| compatibility.json | Operator (release record) | root:root 0644, PP | Client advisory; broker C1a.3 + C7 | Canonical; execution-compatibility:v1 | INCOMPATIBLE 5 |
| enrollment-public.json | Operator | root:root 0644, PP | Client advisory; broker C7-PV byte equality | Canonical; no own digest | INELIGIBLE 5 |
| Fingerprint member bytes | Target repository (runner) | Runner-owned | Client §20.4.5 step 4c; broker C7 and P1S on dR | Raw sha256; execution-fingerprint:v1 | 4 pre-reservation; PRESUBMIT_FAILURE 7 |
| Stage 4 evidence | Runner output dir | Runner-owned | Client §8.1; broker §4.3 item 3 | Existing Stage 4 domains | 4 |
| Config execute block | Target repository | Runner-owned | Client §20.4.5 step 2a | Strict JSON | 3 |
| SUT values | Client environment | Process memory, socket, memfd | Client §20.4.5 step 2b; broker item 5 | Never hashed or persisted | 3 / broker refusal |
| Broker frames | Broker | Socket | Client §7.2 | §11.3 | 7 |
| Result proposal | Client | Socket | Broker §7.2/§9.4 | §11.2 | RESULT_INVALID 7 |
| Manager D-Bus messages | PID 1 via system bus | Bus policy | Broker sender filter + N1 | — | CONTROLLER_FAILURE / QUARANTINED |
| Record copy / attempt marker | Client | Runner-owned | Client §20.4.7 M1–M5 / R1–R5 against the current invocation | automation-execution-record:v2; execution-binding:v1 | Not authority; INVALID -> 4 |
| Q enumeration evidence record | Operator qualification tooling | Operator-retained | Operator review before writing enrollment | None (data); output is fingerprint.files | Qualification FAIL |
| Privilege-surface record | od06-priv-surface-v1 run by the operator as root (read-only) | Operator-retained, root-owned | Operator: PS-A–PS-E requirements plus byte equality at every verification (§20.2.7); never read by client or broker | CRS-1; content-digest privilegeSurfaceDigest | Host INELIGIBLE until requalified |
| Build-environment recipe | This repository (versioned Containerfile) | Git history | Release qualification: containerfileDigest over the git blob | Raw SHA-256 of blob bytes | Not a qualified recipe |
| Build-environment image and content record | Authorized build qualification; durable GHCR location | Registry, by digest only | Release qualification: re-pull by digest, content-record equality, independent rebuild (§20.3.4a) | Manifest digest; QaAgentBuildEnvContent content-digest | Release BLOCKED |
| Broker build record | Release-qualification parties | Release evidence | Release qualification (§20.3.4, §20.3.4a) | CRS-1; content-digest buildRecordDigest | Release BLOCKED |

No implicit trust transfer: every datum the client reads from a root-owned
file is advisory and is recomputed or byte-compared by the broker from its
own root-owned inputs.

### 20.6 New closed values, governance and debt

New closed values (all proposed): the file
/usr/local/share/qa-agent-controller-v1/enrollment-public.json and schema
QaAgentControllerPublicEnrollment v1; step C7-PV; sub-steps C1a.1–C1a.5;
the exact sudoers Defaults line; the compiled literal /usr/bin/sudo; adapter
mandatory member lists; the brokerBuild format; source path
native/qa-agent-controller-v1/; config schemaVersion 2 with the execute
block; the execute command spec; client files QaAgentExecutionClientAttempt
v1 (with the product key) and the record copy; local-state
classifications NONE, BOUND_RECORDED, BOUND_LIVE, BOUND_RECONCILABLE,
INVALID and checks M1–M5/R1–R5 (client-internal, not output values); the
§20.0.1 runner disposition table; the sudo topology invariant T1–T5 and the
log_exit_status Defaults entry; procedure literal od06-q-enum-v1 and its
evidence record; exact zbus 5.13.2; exact Rust 1.85.0 toolchain pins; the
rust-lld linker rule; native/qa-agent-controller-v1/build-env.digest and the
exact build environment and RUSTFLAGS; CLI reason codes
EXECUTE_SUT_ENVIRONMENT_INVALID,
EXECUTE_PLATFORM_UNSUPPORTED, EXECUTION_BINDING_MISMATCH,
EXECUTE_INCOMPATIBLE, EXECUTE_RUNNER_NOT_ELIGIBLE,
EXECUTION_FINGERPRINT_MISMATCH, EXECUTE_BROKER_UNAVAILABLE,
EXECUTION_ALREADY_RECORDED, EXECUTION_IN_PROGRESS,
EXECUTION_CLIENT_STATE_INVALID, EXECUTION_NOT_FOUND. C2 adds: invariant
PS-0 and procedure literal od06-priv-surface-v1 with requirement sections
PS-A–PS-E and record QaAgentControllerPrivilegeSurface v1
(privilegeSurfaceDigest); the od06-q-enum-v1 non-root rule; the
no-ancillary-data rule (no SO_PASSCRED/SO_PASSPIDFD/SO_PASSSEC, no
SCM_RIGHTS acceptance); the zbus no-raise rule for max_queued; the recipe
native/qa-agent-controller-v1/Containerfile (revision 1) and
containerfileDigest; the pinned base digest, Debian snapshot runs and
package versions of §20.3.4a; record QaAgentBuildEnvContent v1
(buildEnvContentDigest); the durable location
ghcr.io/tarasovartem/qa-agent-controller-v1-build-env; record
QaAgentControllerBuildRecord v1 (buildRecordDigest). Every new digest uses
the existing raw content-digest convention over CRS-1 or file bytes. No new
exit code, frame, journal state, record reason, refusal enum or hash
domain. No public export, bin or package-file change is proposed; the
public CLI/config surface changes only as documented in §20.4, at Stage 5
implementation.

TSB-F02: **OPEN / LOW / CONDITIONAL**; current supported surface trigger
FALSE (no code changed); proposed execute trigger FALSE. §20 revalidation:
caller authentication, the public view read, the C7-PV comparison, the Rust
broker, the CLI grammar, config v2 and the client state files are kernel-
or broker-side checks, data reads and CLI parsing. They add no import or
call edge to either approval gate, #23F, apply.js, gate symbols or legacy
execution; the §10 proposed graph is unchanged. C1 revalidation: the
od06-q-enum-v1 qualification tooling is operator-run and outside the
product import graph; the §20.4.5 reorder, the §20.4.7 M/R identity checks,
the sudo topology invariant, the exact build environment and the zbus pin
are CLI ordering, local data reads, qualification observations and native
build inputs; none adds an import or call edge to either approval gate,
to #23F, apply.js, gate symbols or legacy execution. Current trigger FALSE;
proposed trigger FALSE. C2 revalidation: od06-priv-surface-v1 is
operator-run qualification tooling outside the product import graph; the
ancillary-data and zbus queue rules are broker-internal socket handling;
the Containerfile and the build-environment provenance chain are native
build inputs outside the package.json "files" allowlist; none adds an
import or call edge to either approval gate, #23F, apply.js, gate symbols
or legacy execution. Current trigger FALSE; proposed trigger FALSE. No
closure, re-rating or remediation.

Security debt (§19.1): all 7 LOW + 5 INFO remain **OPEN / PRESERVED /
CARRIED TO STAGE 5**. Design linkage only, no closure claim:

| ID | Linkage |
|---|---|
| L1 | Rust, forbid(unsafe_code) outside one sys module, in-repository strict JSON parser, zbus parser; fuzzing and differential tests are qualification inputs (§20.3.7); C2 adds the unsolicited-D-Bus flood qualification and the ancillary-data refusal (§20.2.5, §20.3.3) as inputs, not closure |
| L2, L3, I1 | Unchanged; C1a.1–C1a.5 make the CALLER_REFUSED cases enumerable for the I1 tabulation |
| L4 | Yama >= 1 and no same-account command agents are §20.3.6 qualification items; §20.2.5 records same-account socket creation as existing R-1/R-2 territory |
| L5, L6 | B on a dedicated thick-provisioned, non-CoW device (classes B–D); the inode floor still has to be qualified |
| L7 | Unchanged; the Rust one-shot process imposes no implicit cap; the C2 unsolicited-D-Bus bound (§20.3.3, §20.3.7) creates no broker process and does not answer L7 |
| I2 | C1a.4 user-namespace equality is additional initial-namespace evidence, not closure |
| I3, I5 | Unchanged (R-4 / R-5) |
| I4 | §20.2.4 specifies no-relay stdio, EOF/EPIPE and signal-forwarding semantics; real-sudo observation remains open |

### 20.7 Qualification boundary and STOP conditions

Design-specified: every mechanism in §20.1–§20.4. Still requiring real
Linux evidence on the exact tuple: the §20.2.4a T1–T5 sudo topology
(forked sudo parent, descriptor pass-through) and signal relay; SO_PEERCRED
values observed at the broker; ProcessFD from the bus through zbus 5.13.2;
a reproducible static build under §20.3.4; zbus behaviour against the
qualified systemd; canonical-encoding equivalence; od06-q-enum-v1 output
and its determinism for each adapter version; every §12 and §20 negative
vector; the od06-priv-surface-v1 record, its requirements and its
reboot/daemon-reexec stability on the exact host; the build-environment
image built from the §20.3.4a recipe, its content record, its publication
at the durable location (separately approved) and an independent rebuild;
the unsolicited-D-Bus flood bounds. Nothing here is runner certification.

Stage 5 implementation must STOP for an owner decision if: the qualified
sudo build, PAM stack and plugin set cannot satisfy T1–T5 under §20.2.3
(sudo direct-execs the broker, does not pass fds 0/1 through or allocates a
pty); the client's Node build does not yield socketpair stdio; the
reference host's bus lacks ProcessFD; zbus 5.13.2 cannot deliver ProcessFD
through the blocking API on the reference host; a reproducible static build
is not achievable with the §20.3.4 environment (including a link failure
with the pinned rust-lld, which is never answered by falling back to a host
linker); a dependency outside the §20.3.4 direct allowlist, or a transitive
crate that fails the transitive controls, becomes necessary; Q cannot be
enumerated for an adapter version under od06-q-enum-v1 (including any
limit, unsupported construct or config-closure completeness failure); the
§20.4.5 order cannot be implemented without departing from the
productization §10.7 tie rule; the reference host cannot satisfy
od06-priv-surface-v1 (for example a default service, socket, device node,
setuid file or Defaults entry that fails PS-A–PS-D and cannot be removed)
— never answered by widening an allowlist without a new procedure literal
and review; the §20.3.4a recipe cannot build, its pinned base digest,
snapshot or package versions become unavailable, or an independent rebuild
yields a different content record — never answered by an opaque or
hand-edited image; the unsolicited-D-Bus bound cannot be met without a new
numeric production limit; or any TSB-F02 edge would become TRUE or
INDETERMINATE.

### 20.8 Delivery boundary

Documentation change of this file plus, from C2, the versioned
build-provenance design artifact native/qa-agent-controller-v1/Containerfile
(no broker source, no Cargo file, nothing built or published). No source,
test, workflow, package, ROADMAP lifecycle, security disposition or
activation change. Next:
independent exact-head HEAVY Architecture review; only if APPROVED,
independent exact-head HEAVY Security review on the same HEAD; then separate
Product Owner acceptance and merge authorization. Merge NOT AUTHORIZED;
Stage 5 implementation NOT AUTHORIZED; execute DISABLED; Controlled Release
NOT APPROVED.

### 20.9 Architecture corrective C1 (record)

Authority: OD-CONTROLLED-V1-STAGE5-DESIGN-GAP-C1 — APPROVED. Reviewed
HEAD de37be62c16daf10413736cb489efc11abc4ff60 (tree
ec55590fbc24917f9ba4a57ee6813fd25ce9a441, base
52e23acf0f7e5d2f7fce2b406a27de51ae1af68c); independent HEAVY Architecture
result CHANGES REQUIRED, 0 MAJOR / 7 MINOR / 11 INFO. C1 is documentation
only, this file only, and resolves exactly the seven MINOR findings:

| Finding | Resolution | Where |
|---|---|---|
| ARCH-S5-m01 sudo parent topology | The unconditional fork claim is removed; the upstream direct-exec conditions are stated; log_exit_status is added as a forcing input only; the closed T1–T5 qualification invariant makes any direct-exec, interposition or unqualified change INELIGIBLE; runtime C1a.4 refuses a direct-exec topology; no environment fallback; SO_PEERCRED unchanged | §20.2.3, §20.2.4, §20.2.4a, §20.2.6, §20.7 |
| ARCH-S5-m02 Q enumeration | Closed procedure od06-q-enum-v1: producer, time, fixed Node parameters, literal entrypoints, edge grammar, CommonJS/ESM resolution of the exact Node version, member kinds, dynamic and unresolved boundaries, config-closure completeness, link/mount rules, set semantics, limits, persistence and requalification triggers | §20.0, §20.1.4, §20.1.4a, §20.1.8, §20.7 |
| ARCH-S5-m03 reproducible build | Exact Rust 1.85.0 toolchain with component hashes; rust-lld from the pinned toolchain as the only target linker; one OCI build image pinned by digest; fixed paths, environment, RUSTFLAGS and path remaps (source, registry, rustup, target); no build ID or host metadata; two-host plus third-party verification; non-reproducible -> release qualification BLOCKED | §20.3.4, §20.3.7, §20.7 |
| ARCH-S5-m04 zbus contract | Exact zbus 5.13.2, with the ProcessFD surface verified in the published sources (absent through 5.5.0); direct allowlist separated from the Cargo.lock transitive closure, which truthfully includes tracing and the async-io set; explicit transitive controls | §20.3.3, §20.3.4, §20.3.7, §20.7 |
| ARCH-S5-m05 runner dispositions | §3 rows added to the §20.0 supersession table; §20.0.1 assigns each §3 DEFERRED class exactly one of DEFERRED, REFUSED, QUALIFICATION-ONLY or SUPPORTED (named reference target only); §3 text kept as history | §20.0, §20.0.1 |
| ARCH-S5-m06 validation precedence | §20.4.5 follows productization §10.7 usage -> config -> authority -> input -> provider -> execution with no exception; CREATE-only steps are applicability rules decided at 3c; release-disabled invariant preserved without reordering; simultaneous-failure pairs tested; numeric taxonomy unchanged | §20.4.5, §20.4.6, §20.4.8, §20.4.9 |
| ARCH-S5-m07 local-state identity | Marker gains product; M1–M5 bind the marker to run, package, current root digest, product and grammar; R1–R5 bind the record to the marker, its bindingDigest, run, package, root, product and principal; copied, restored, foreign or stale state is INVALID (existing exit 4 code); broker tombstones stay authoritative | §20.4.7, §20.4.9, §20.5 |

The 11 INFO findings are preserved on the review record: none is closed,
absorbed, re-rated or converted into scope by C1. No INFO-driven
clarification was needed to make m01..m07 correct. Unchanged: execute
DISABLED; Controlled Release NOT APPROVED; TSB-F02 OPEN / LOW /
CONDITIONAL with current and proposed triggers FALSE; §19.1 L1–L7 and I1–I5
OPEN / PRESERVED / CARRIED TO STAGE 5; process-lifecycle containment only;
R-1..R-5; AT-07/TB-01; FUTURE guards; Stage 4 semantics; TAP-2; CRS-1;
PPI-1; #23F; both approval gates; the broker create/reconcile architecture;
the DG-1..DG-4 selected options. No new exit code, broker frame, journal
state, record reason, refusal enum or hash domain. Next: independent
exact-head HEAVY Architecture re-review of the C1 HEAD; only if APPROVED,
independent exact-head HEAVY Security review; then separate Product Owner
design acceptance. Merge NOT AUTHORIZED.

### 20.10 Security corrective C2 (record)

Authority: OD-CONTROLLED-V1-STAGE5-DESIGN-GAP-C2 — APPROVED. Reviewed HEAD
101122bff15b0c227de76908a1b5e82c4a4269f9 (tree
d6045fa2722f5e0cf81963f15779bbdc2cae3a78, base
52e23acf0f7e5d2f7fce2b406a27de51ae1af68c). Independent HEAVY Architecture
review of that HEAD: APPROVED, 0 MAJOR / 0 MINOR / 7 INFO. Independent
HEAVY Security review of the same HEAD: CHANGES REQUIRED, 0 CRITICAL / 0
MAJOR / 2 MINOR / 7 INFO. C2 changes this file and adds exactly one file,
native/qa-agent-controller-v1/Containerfile, a versioned build-provenance
design artifact (no broker source, no Cargo file, nothing built or
published).

| Finding | Resolution | Where |
|---|---|---|
| SEC-S5-m01 effective privilege surface | Invariant PS-0 (the §20.2.3 rule is the only authorized elevation path); closed procedure od06-priv-surface-v1: sudo build, sudo.conf, complete include-resolved sudoers source set with integrity, sudo's own parsed policy (cvtsudoers JSON, full and runner-matched), canonicalized sudo -l evidence, sudoers NSS, PAM; account, private primary group and an empty supplementary set (closed rule, not a name list); observed process credentials; doas and polkit absence, run0/systemd-run probes, su/root credentials, setuid/setgid/capability files, host-control endpoints and D-Bus policy; remote/dynamic sources INELIGIBLE; procedure-completeness rule; closed record, CRS-1 encoding, content digest, retention, qualification-only (never read at runtime; SO_PEERCRED unchanged); verification events, requalification triggers and negative tests | §20.2.3, §20.2.7, §20.3.6, §20.5, §20.6, §20.7 |
| SEC-S5-m02 build-environment provenance | Versioned recipe with real pinned base digest, Debian snapshot runs and package versions, hash-verified Rust 1.85.0 components, fixed environment and no rustup; containerfileDigest over the git blob; closed image build procedure; content record and digest; durable GHCR location by digest only (publication NOT AUTHORIZED); build-env.digest written only after push, re-pull and content equality; nine-step independent rebuild; closed build record; requalification inputs. No image digest is claimed | Containerfile; §20.3.4, §20.3.4a, §20.3.7, §20.5, §20.6, §20.7 |
| INFO-2 bind-mount expectation | dev/ino no longer claimed to detect a bind mount; copied/replaced broker caught by C1a.2 and brokerSha256; bind mount needs root (outside the non-root claim); STATX_MNT_ID not added | §20.3.7 |
| INFO-3 SO_PASSCRED / SCM_RIGHTS | No SO_PASSCRED/SO_PASSPIDFD/SO_PASSSEC; no ancillary data; passed descriptors closed and treated as a malformed frame under existing semantics; SO_PEERCRED the only credential source | §20.2.5 |
| INFO-4 unsolicited D-Bus flood | Untrusted (sender filter), memory bounded by pinned zbus queues and the recorded bus message size (no new limit), time bounded by §6.4, never PASS, L7 unchanged; adversarial qualification added | §20.3.3, §20.3.7 |
| INFO-6 Q enumerator privilege | od06-q-enum-v1 MUST NOT RUN AS ROOT; unprivileged user; access failure is qualification FAIL; no privileged workaround | §20.1.4a |

Preserved, not corrected, closed, waived or re-rated: Security INFO-1 (P0
reads fd 0 before AF_UNIX validation), INFO-5 (R4 not-found / client
evidence-copy race) and INFO-7 (same-principal RECONCILE cancellation
semantics), each OPEN / PRESERVED / NON-BLOCKING. The Architecture C1
resolutions ARCH-S5-m01..m07 and the 7 Architecture INFO findings are
unchanged; C2 does not reopen DG-1..DG-4. Unchanged: execute DISABLED;
Controlled Release NOT APPROVED; TSB-F02 OPEN / LOW / CONDITIONAL with
current and proposed triggers FALSE; §19.1 L1–L7 and I1–I5 OPEN / PRESERVED
/ CARRIED TO STAGE 5; process-lifecycle containment only (no filesystem
sandboxing, network isolation, secret isolation, same-account isolation or
malicious-test sandboxing); R-1..R-5; AT-07/TB-01; FUTURE guards; Stage 4
review/apply semantics; TAP-2; CRS-1; PPI-1; #23F; both approval gates. No
new exit code, broker frame, journal state, record reason, refusal enum or
hash domain. Next: fresh independent exact-head HEAVY Architecture
re-review of the C2 HEAD; only if APPROVED on that HEAD, fresh independent
exact-head HEAVY Security re-review; then separate Product Owner design
acceptance. Merge NOT AUTHORIZED; Stage 5 implementation NOT AUTHORIZED.
