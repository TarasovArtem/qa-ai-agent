# Controlled-v1 OD-06 execution contract v1 — scoped controller broker design

Date: 2026-10-13 (Europe/Berlin).

Design authority: OD-CONTROLLED-V1-OD-06-EXECUTION-DESIGN — APPROVED.
Continuation: OD-CONTROLLED-V1-OD-06-C1-RUNNER-CONTAINMENT — APPROVED.
Controller: OD-CONTROLLED-V1-OD-06-OP-06-02-SYSTEMD-CONTROLLER — APPROVED.
Broker: OD-CONTROLLED-V1-OD-06-OP-06-03-SCOPED-CONTROLLER-BROKER — APPROVED.
Architecture corrective: OD-CONTROLLED-V1-OD-06-ARCH-C1 — APPROVED.
Architecture corrective: OD-CONTROLLED-V1-OD-06-ARCH-C2 — APPROVED.
Security corrective: OD-CONTROLLED-V1-OD-06-SEC-C3 — APPROVED.

Mission result: **DESIGN COMPLETE — READY FOR DELIVERY / EXACT-HEAD CI /
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
C3 corrective changes are completed and ready for independent re-review; no
prior exact-head review covers the C3 HEAD.

OP-06-03 is APPLIED. Host systemd, transient .service and cgroup v2 remain
selected. Sole privileged mediation boundary: root-owned, operator-installed,
one-shot execution controller broker. Runner gets no direct manage-units,
generic sudo, systemctl or systemd-run authority. Only OP-06-02's privileged
helper prohibition is superseded; custom daemon prohibition remains.
Sections 1–2 preserve historical discovery; sections 3–16 govern this proposal.

**DESIGN ONLY**: no broker/source/test/workflow/package/export implementation,
execute activation, Stage 5, release or merge. Normal product remains npm.
Exactly one new host provisioning executable artifact; its fixed policy,
configuration and durable state are operator-managed controller contract
parts, never target-repository components or permanent QA Agent services.

Execute stays reserved (exit 5), RELEASE_CAPABILITIES.execute disabled.
Stage 4B COMPLETE_ON_MAIN / POST-MERGE CERTIFIED; reviewRecord/apply semantics
and target opt-ins unchanged. TSB-F02 OPEN / LOW / CONDITIONAL; TAP-2/CRS-1/
PPI-1, R-1..R-5, AT-07/TB-01 unchanged; FUTURE guards OPEN.
Controlled Release NOT APPROVED. No canonical ROADMAP closure.

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
   filesystem types and the bounded workload-storage mount (§5.6). Evaluated
   first in P1, before items 2–7 and any protected-store write, §5.5 walk,
   manager call or cgroup read; repeated in the P1S recheck (§6.4).

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

Broker validation (authoritative, before reservation): canonical record bytes
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
attempts uses the stored binding (§7) and is not blocked by a pair change.

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
candidate against every existing root, and run by every broker invocation
over the whole persisted roots[] (<=64 roots, <=2016 pairs) before any
eligibility decision: (a) M1 once; (b) M2–M4 for each root, live; (c)
overlap rules 1–3 pairwise on canonical path bytes and live dev/ino. Any
failure is a violation. Two enrolled roots MUST NOT overlap or violate
M1–M4. A violating candidate is REFUSED at enrollment, with no coexistence
or priority rule. A persisted violation (overlap, mount alias, mount-root
root, changed anchor, or a live identity no longer matching enrollment) makes
runner qualification fail closed: every create REFUSED/INELIGIBLE exit 5,
nothing reserved, no root silently selected. Operator remediation edits
enrollment and requalifies. Reconcile of existing attempts remains permitted
under their stored binding (§7); it never creates authority.

Target identity = (rootDigest, canonical PPI-1 relative path) plus live
dev/ino. Execution opens beneath the root with no symlink and no mount
crossing (§4.3 item 2), and targets/fingerprint files require regular files
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
has a fallback. N1–N6 and F1–F4 run in P1 of every create and every
reconcile; W1–W6 run in P1 of every create. All of them precede any
protected-store write, §5.5 walk, manager call or cgroup read (except the
journal-dependent W5 binding part and the W3 free-space part, §5.6.3, which
run after recovery/reconciliation and still precede reservation),
and all are repeated in the P1S recheck (§6.4). Failure before the reservation commit is
REFUSED/INELIGIBLE exit 5 with nothing reserved or spawned. For reconcile it
is REFUSED/INELIGIBLE with no journal write or manager action, leaving the
attempt for a later reconcile. Failure inside P1S is the consumed
EXECUTION_ERROR PRESUBMIT_FAILURE exit 7 of §6.4.

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

F1. Workspace anchor W: fstatfs on the descriptor obtained by the §5.5 M1
    walk is in L. Each enrolled root R, which is on W's mount by M3, has an
    fstatfs type equal to W's.
F2. Controller durable state /var/lib/qa-agent-controller-v1: fstatfs on the
    descriptor opened for the protected store is in L, in addition to the
    existing directory-fsync durability requirement. It is checked before any
    protected-store read is trusted or any write is made.
F3. Timing: at enrollment/requalification; in P1 of every create and
    reconcile before reservation or any journal write; and again in the P1S
    recheck together with §5.5. Each check uses the same descriptor as the
    subsequent openat-relative use, with no path re-resolution between check
    and use.
F4. No caller-controlled trust: enrollment carries no filesystem-type claim
    for W or the state location, the request carries none, and §4.3 item 2
    "storage" denotes F1–F2. A live type outside L makes the runner
    INELIGIBLE until operator remediation and requalification. F2 failure
    permits no protected-store write.

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

Live qualification proof, run by the broker at enrollment, in P1 before
reservation and again in P1S before leaf creation:

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
    entry is INELIGIBLE and is never deleted on sight. The binding part of W5
    needs the protected journal, and the W3 free-space part should see space
    freed by pre-create reconciliation, so both run after F2, protected-store
    recovery and the §7 pre-create reconciliations, still before the
    reservation commit; all other checks of this section precede any
    protected-store read.
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
Reconcile is not blocked by W3 or W5 (it is how space is recovered); before
removing any leaf it requires W1, W2 and W4, and if they fail it finalizes
the attempt without removing the leaf, which stays for operator remediation.
Exhausting B makes the affected attempt's writes fail (EXECUTION_ERROR or
RESULT_INVALID, never PASS); it cannot consume host /run, the root
filesystem, W or the protected state.

The §9.2/§9.4 report, path and accounting limits are unchanged; B's bound is
an additional host-resource bound, not a product quota. The design grants no
writable location outside B. Host locations the runner account can already
write independently of this design (for example world-writable /tmp or
/dev/shm) remain the account's pre-existing authority under R-5, not
design-granted workload storage.

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

P1 covers, first, the §5.6 kernel-namespace, filesystem-type and
workload-storage checks, then protected-store transaction recovery, all prior incomplete-root
reconciliations and the runner unit-namespace scan (§7), locks/claims, integrity/
§5.4 compatibility/§5.5 root/qualification checks, controller eligibility,
launch-size checks and the reservation commit. Up to 256 reconciliations
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
(N1–N5, F1–F2, W1–W5), descriptor-anchored creation of the attempt leaf and
its home/tmp/reports directories on the bounded workload mount (§5.6.3, §9.1),
launch-envelope construction and sealing, the mandatory post-reservation
recheck (§4.3 item 4, §8.1 item 7: root/apply/framework binding, exact
target bytes, fingerprint fresh bytes, qualified Node/native/profile, §5.4
compatibility and §5.5 root/mount rule, launch-size bounds), the
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
quarantine. Recovery caller must own protected attempt; stored binding
governs even if enrollment disabled, config cannot widen old authority.

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
