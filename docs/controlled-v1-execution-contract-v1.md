# Controlled-v1 OD-06 execution contract v1 — scoped controller broker design

Date: 2026-10-13 (Europe/Berlin).

Design authority: OD-CONTROLLED-V1-OD-06-EXECUTION-DESIGN — APPROVED.
Continuation: OD-CONTROLLED-V1-OD-06-C1-RUNNER-CONTAINMENT — APPROVED.
Controller: OD-CONTROLLED-V1-OD-06-OP-06-02-SYSTEMD-CONTROLLER — APPROVED.
Broker: OD-CONTROLLED-V1-OD-06-OP-06-03-SCOPED-CONTROLLER-BROKER — APPROVED.

Mission result: **DESIGN COMPLETE — READY FOR DELIVERY / EXACT-HEAD CI /
INDEPENDENT HEAVY ARCHITECTURE REVIEW**. Author completion is not independent
approval, runner certification, PO OD-06 acceptance or release approval.

OP-06-03 is APPLIED. Host systemd, transient .service and cgroup v2 remain
selected. Sole privileged mediation boundary: root-owned, operator-installed,
one-shot execution controller broker. Runner gets no direct manage-units,
generic sudo, systemctl or systemd-run authority. Only OP-06-02's privileged
helper prohibition is superseded; custom daemon prohibition remains.
Sections 1–2 preserve historical discovery; sections 3–13 govern this proposal.

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
One later result-proposal frame permitted during attached create after BOUND;
any other extra frame refuses/reconciles.

| Operation | Exact top-level keys |
|---|---|
| create | schemaVersion, contractVersion, operation, executionId, root, subject, framework, targets, timeoutMs, environment |
| reconcile | schemaVersion, contractVersion, operation, executionId |

schemaVersion=1, contractVersion literal above. executionId=32 lowercase hex
OS-random 128 bits generated by client; broker independently validates
grammar/non-reuse. Create starts/observes one attempt; reconcile combines
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
   from request/ordinary caller environment.
2. Literal operator-enrolled canonical root/dev/inode/digest/account/storage;
   descriptor-relative no-follow/beneath/no-mount-crossing opens of fixed
   data locations; no wildcard ancestor/home or caller evidence pathname.
   Root must be a runner-owned repository below a literal operator workspace,
   never /, a system directory or an ancestor of controller artifacts. The
   workspace anchor is root-protected; enrolling root/home itself is forbidden.
3. Enrolled config/bounded Stage 4 data, request successful apply outcome/
   record/chain identities/framework, approved afterDigest of ALL changes/
   fresh canonical bytes and exact specs. Client still performs §8.1 full
   gate-free reconstruction; broker reconstructs §11 launch/security
   binding from fixed data and compares bindingDigest, imports no target JS.
4. Exact qualified Node/framework/native/fingerprint/adapter; metadata as
   bounded data; recheck canonical files immediately before submission.
5. Timeout/SUT enrolled names/bounds; constructs complete launch envelope
   and systemd payload; no raw caller property/privilege semantics.
6. Protected claims/consumption, reconciliation and namespace; collisions/
   unbound units; manager/boot/cgroup/property/non-root UID/nonprivileged
   group identity, absence of direct manager/sudo/delegation escape rights.
   Qualification excludes caller-accessible user managers/schedulers/agents
   that can launch requested descendants outside the owned service; config
   labels or clearing DBUS_SESSION_BUS_ADDRESS cannot prove this absence.
7. Durable SUBMITTING before D-Bus; actual property/InvocationID/cgroup
   readback and durable CONTROLLER_BOUND before returning bound observation.

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
| sudoers.d exact rule | root:root 0440, protected parent |
| /var/lib/qa-agent-controller-v1 | root:root 0700, journal/claims/tombstones 0600, durable fsync filesystem |
| /run/qa-agent-controller-v1 and workloads parent | root:root 0711, traversable but non-writable/non-listable by runner; descriptor-anchored workload leaf runner-owned 0700 |

Runner-controlled/replaced broker/config invalid. Enrollment strict JSON
<=1048576 bytes exact keys {schemaVersion,contractVersion,enabled,brokerSha256,
profileDigest,caller,roots,qualification}; version1/literal contract/boolean/
H hashes. caller={uid,gid,account}, IDs integer1..4294967294, account<=64 ASCII
[A-Za-z0-9_-]+. roots<=64 exact {root,projectId,outputDir,framework,sutNames,
fingerprint}, §4 root/existing project ID grammar/configured canonical
relative outputDir<=300 bytes safe segments/no '..'/framework literal/
<=32 SUT names/§8 fingerprint.
qualification={profileVersion,osBuild,kernelBuild,systemdBuild,sudoBuild,
nodePath,nodeVersion,nodeSha256,brokerBuild,frameworkProfiles};
profileVersion="od06-linux-v1", builds<=256 ASCII/no controls, nodePath
absolute canonical<=4096, nodeVersion exact22.x.y/hash H.
frameworkProfiles<=2 unique {framework,packageVersion,packageSha256,nativePath,
nativeVersion,nativeSha256,browserPath,browserVersion,browserSha256,adapterVersion};
paths<=4096 absolute/versions<=256/hashes H, adapters od06-cypress-v1/
od06-playwright-v1. profileDigest hashes qualification (§11), no templates.

Later product-owned qualification manifest lists exact tested tuples and
npm/broker digests. Enrollment cannot qualify unlisted builds; no >=version/
floating latest/distro label inference. Empty manifest refuses all.
No Linux tuple certified in Windows session. Real evidence populates future
Stage 5 outputs, not an unresolved controller design choice.

Every check before target code: exact qualified Linux/self-hosted/account/
OS/kernel/systemd/sudo/Node/broker/storage/bus; cgroup v2 protected domain,
no runner migration/delegation; fixed property/FD/stop/kill support; no
namespace aliases/drop-ins/hooks/unbound units; durable crash/boot history;
canonical root/apply/framework/native/env/capture/result bounds. No target
preflight script. Pre-start authority exit5/input4/config3; post-submit
uncertainty controller7/reconciliation.

### 5.3 Install, compatibility, upgrade and revocation

Operator installs single digest-identified broker/rule/config, qualifies
host, then target opts in. Npm does no root install/postinstall/upgrade or
target system config. Distribution/signature/release packaging and exact
npm/broker compatibility pair require later owner approval; design fixes
version IDs/fail-closed matching, not publication channel/new exports.
Both sides match versions and enrolled qualified exact builds.

Upgrade: disable creates, reconcile/drain/prove empty/fsync outcomes/history,
revoke invocation during atomic verified root-owned replacement, requalify,
operator reenables. No ABI fallback/consumption reset/silent journal migration.
Removal: disable creates; retain reconcile until empty/durable; revoke rule/
broker; retain consumed/quarantine history; safe runtime cleanup. Failed
drain retains quarantine; emergency revocation is not stop proof. Lost/
restored history/re-enrollment cannot manufacture fresh consumption.
Cleanup descriptor-anchored/no symlink/mount traversal/root recursive target
deletion. No permanent QA Agent service, Docker/OCI/Kubernetes requirement.

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
RuntimeMaxUSec active-runtime bound; 30000 ms start + T +30000 stop +30000
confirmation = <=T+90000 observation from request, monotonic/no poll renewal.
Reconcile <=60000 stop/confirmation +5000 intake, bounded manager calls.

Allowed methods after protected ownership check only: GetUnit,
ListUnitsByPatterns read-only enumeration, Properties.GetAll closed fields,
RefUnit/UnrefUnit, StopUnit(name,"fail"), KillUnit(name,"all",9) escalation,
ResetFailedUnit(name) only after durable terminal/empty proof. Returned
object/job binds exact manager/name; no caller signal/job/unit/cgroup/object/
SetUnitProperties/Restart/Enable/Link/AttachProcesses.

Stop closes admission, control-group SIGTERM, full-unit SIGKILL by30000 ms,
empty confirmation within30000 ms. Qualified manager proves nested groups/
forks covered; leader-only build ineligible. No raw cgroup writer/shell/
PID/process-group fallback. Secure anchored root-owned cgroup.events read:
populated=0 + manager terminal + no start/restart job + admission/migration
closed. Removal needs authenticated retained terminal binding and qualified
removal guarantee/no jobs/recreated unit; reboot requires old-boot extinction/
protected journal continuity/clean namespace. ENOENT/leader/ack insufficient.
Uninterruptible tasks may survive; finite escalation, not guaranteed finite
extinction. Failure QUARANTINED7/claims retained. Timeout8 only exact manager
timeout/invocation/deadline +empty/durable cleanup; local expiry/cancel/
signal/missing proof error7. No immediate parent-death guarantee.

## 7. Protected ownership and bounded reconciliation

Broker alone writes protected host store. Root/package/ID order; short
runner admission lock serializes namespace/reservation only. One active
per root/all runs, independent roots concurrent; no stale-PID stealing.
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
| STARTED | PASSED, TEST_FAILED, TIMED_OUT, EXECUTION_ERROR, ORPHANED, QUARANTINED |
| ORPHANED | EXECUTION_ERROR, proven TIMED_OUT, QUARANTINED |
| PASSED / TEST_FAILED / TIMED_OUT / EXECUTION_ERROR | Terminal consumed, no successor/retry |
| QUARANTINED | Terminal/claims retained; separate incident may clear quarantine, never revive/rewrite attempt |

No COMPLETED. Broker lifecycle-only, never parses target reports. Attached
client supplies §11 proposal after non-root parsing; broker cross-checks
process/binding/structure and commits after empty. Lost proposal/client
death -> error; incomplete report/exit never reconstructed PASS. Valid
durably committed terminal result returns as recorded; later inconsistency
separate quarantine incident, not success rewrite.

<=256 incomplete attempts/runner, <=64 roots, <=256 namespace units,
<=16777216 persisted bytes/attempt; capacity exhausted refuses.
Tombstones/history never silently pruned. Before create <=256 individually
bounded fixed-ID reconciliations; no daemon/recovery promise while no caller/
operator returns. Systemd runtime independent. Lost/corrupt history runner
quarantine. Recovery caller must own protected attempt; stored binding
governs even if enrollment disabled, config cannot widen old authority.

| Case | Finalization / retry / cleanup / synchronous exit |
|---|---|
| A incomplete ACTIVE/activating/deactivating | ORPHANED; stop/kill/empty ->error7 or proven timeout8; no retry; failure H |
| B incomplete FAILED | Error7/proven timeout8; FAILED insufficient; drain/finalize/no retry; ambiguity H |
| C incomplete INACTIVE | Unknown error7; exact timeout permits8; inspect jobs/population/finalize/no retry; failure H |
| D incomplete missing | Removal/reboot proof ->error7, never PASS/missing-unit timeout; otherwise H/no retry |
| E crash before framework | No-send/no-unit proof error7; SUBMITTING uncertainty A–D; consumed without launch/no retry |
| F crash after framework | Manager independent deadline/later A–D; no immediate death-kill/report PASS/no retry |
| G timeout during absence | Retained exact deadline/timeout+empty/durable ->8; otherwise error/H/no retry |
| H stop/cleanup/identity fails | QUARANTINED7/root claims; runner quarantine if ambiguous ownership; operator exact drain/no retry |

Reconcile all prior incomplete root attempts and scan runner unknown namespace
before creates. Already quarantined retains claims until separate operator
incident resolution; replay never revived. Dead client returns no exit.

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
Sections 8.2 and 9 close fingerprint/compatibility and results; real Linux qualification remains mandatory. Recheck cannot freeze against
same-account writers (R-4); matching bytes do not cure authority ambiguity.

### 8.2 Closed executable/native adapters and fingerprint

No .bin/.cmd/shebang/PATH/global/ancestor/npx/npm-script/install/download.
Fixed non-root workload mode execs exact root-owned qualified Node22;
target-local metadata read as bounded data:

| Framework | Fixed metadata / generated Node argv |
|---|---|
| Cypress | node_modules/cypress/package.json name/version, bin cypress="bin/cypress"; [node,root+"/node_modules/cypress/bin/cypress","run","--headless","--browser",qualifiedAbsoluteChromium,"--spec",commaJoinedExactAbsoluteSpecs,"--reporter","junit","--reporter-options","mochaFile="+attemptReportPath] |
| Playwright | node_modules/@playwright/test/package.json name/version, bin playwright="cli.js"; [node,root+"/node_modules/@playwright/test/cli.js","test","--config="+root+"/playwright.config.js","--project=chromium","--reporter=junit",...anchoredEscapedAbsoluteSpecRegexes] |

PPI-1 paths/no comma/glob; Playwright escapes all regex metacharacters/
anchors ^...$. Caller never sends argv. No subset/grep/suite fallback/custom
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
sandbox/freeze; Node/native/broker bound separately by profileDigest.
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
| Playwright controls | Product-only PLAYWRIGHT_BROWSERS_PATH=qualified payloads, PLAYWRIGHT_JUNIT_OUTPUT_FILE=exact attempt report, no other PLAYWRIGHT_* |

No credential relabeling into SUT aliases. Fixed locale/tools qualified.
Attempt paths /run/qa-agent-controller-v1/workloads/<ID>, protected ancestors,
runner leaf only. No credential reference/handle/file transport or value
echo/hash/persistence.

Anonymous sealed memfd envelope exactly {schemaVersion:1,executionId,
rootDigest,nodePath,argv,environment}; rootDigest H, qualified nodePath/argv
broker-built, environment exact projected name/value array.
<=262144 bytes, <=128 argv entries, each<=32768/total<=65536; overflow refuses.
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

Client parses reports non-root: <=8 exact generated regular owner-checked/
no-follow files, <=1048576 each/<=8388608 total, no recursive/arbitrary path.
All persisted product data<=16777216/attempt including root journal/records/
report projections. Persist structural counts/digests/refs/truncation only,
no raw stream/label/message/stack/env/secret handle/provider material.
Target disk/network/report output is account activity, not product quota.

### 9.3 Qualified structural results and exits

Exact enrolled-version JUnit profiles; non-root parser, DTD/external entities/
network expansion forbidden, depth<=32/testcases<=10000. Closed
testsuites/testsuite/testcase envelope and bounded totals agree with complete
enumeration. Transient labels/file attributes map canonical requested specs.
Cypress per-spec output/Playwright file attributes must cover ALL requested
specs/no extra/missing; unsupported version if exact mapping unprovable.
Each spec>=1 executed case; all-skipped/no-test error.

Closed XML vocabulary: testsuites contains testsuite; testsuite contains
 testcase; testcase at most one failure/error/skipped, optional system-out/
system-err. Optional properties under testsuite contains property leaves;
all text/property payloads bounded/discarded. Allowed attributes: testsuites/
testsuite use name,tests,failures,errors,skipped,time,timestamp,file,hostname,
id,package; testcase name,classname,file,time; failure/error message,type;
skipped message; property name,value. Other elements/attributes/entities
refuse. Numeric counts integer0..10000/time finite decimal0..600; each
text/attribute<=4096 UTF-8 bytes. Spec mapping requires canonical file
attribute or qualification-proven exact suite-name-to-requested-path mapping,
never label resemblance. Unsupported shape refuses, no grammar relaxation.

Normalized result exactly {adapterVersion,specs,totals,complete}, specs sorted
{path,total,passed,failed,skipped}, totals={total,passed,failed,skipped},
integers0..10000/sums consistent/complete=true/exact target paths.
No report/provider status trusted. Broker checks proposal binding/process/
structural consistency; forged same-account report remains R-3.

PASSED: proven Node launch/normal manager exit0/complete exact spec result,
failed0/passed>0 each spec/empty/durable cleanup.
TEST_FAILED: complete actual failed>0/qualified normal framework exit1/exact
specs/empty/durable cleanup. Other nonzero/signal/cancel/no report/selection/
start/controller errors EXECUTION_ERROR. Timeout requires §6 exact manager
deadline/empty proof, overrides late report PASS. Stream truncation cannot
substitute complete report; report truncation never PASS/TEST_FAILED.

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
certification or permission to bypass future tests.

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
domain "qa-ai-agent:execution-profile:v1:" over qualification.
propertiesDigest domain "qa-ai-agent:execution-properties:v1:" hashes
fixed semantic payload, FD values replaced by fixed role names, no secret
envelope content.

controller exactly {contractVersion,brokerSha256,bootId,managerId,unitName,
invocationId,cgroupPath,cgroupDev,cgroupIno,propertiesDigest}; literal version/
H hashes/ID invocation/authenticated manager local-bus unique owner<=256
ASCII/manager-derived cgroupPath<=4096/dev+ino decimals. Its initial slash
is interpreted strictly beneath the authenticated cgroup-v2 mount, never as
an arbitrary filesystem absolute path. No caller PID/
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

Result proposal: second request frame<=65536, exactly {schemaVersion:1,
executionId,invocationId,bindingDigest,result}; normalized §9 result or null.
Once after BOUND within same lifecycle budget. No caller status/exit/
timeout/cleanup/property assertions; broker determines facts. Reconcile
has no proposal; missing/malformed yields error after cleanup.

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
reportBytes}, counters N/reportCount<=8/reportBytes<=8388608.
recordDigest domain "qa-ai-agent:automation-execution-record:v2:".

Reasons: SUCCESS, ASSERTION_FAILURE, HARD_TIMEOUT, CANCELLED, CLIENT_LOST,
START_FAILURE, OBSERVATION_EXPIRED, RESULT_INVALID, CONTROLLER_FAILURE,
MISSING_UNIT_PROOF, CLEANUP_UNPROVEN, STATE_INCONSISTENT.
SUCCESS iff PASSED/ASSERTION_FAILURE iff TEST_FAILED/HARD_TIMEOUT iff
TIMED_OUT. QUARANTINED only CONTROLLER_FAILURE/MISSING_UNIT_PROOF/
CLEANUP_UNPROVEN/STATE_INCONSISTENT+claims retained. Other reasons error
with cleanup. exit/signal mutually exclusive/PASS0+manager success+
failed0/TEST_FAILED1+failed>0/HARD_TIMEOUT exact manager/deadline facts.
Quarantine may retain preliminary facts, never normal success.
Terminal record/journal fsync before live claim release/tombstones retained.

Response exactly {schemaVersion:1,contractVersion,operation,executionId,
disposition,reason,attemptDigest,record}, JSON<=262144.
operation create/reconcile/disposition REFUSED/BOUND/TERMINAL/QUARANTINED,
attemptDigest H|null/record v2|null/reason result enum|null or SCHEMA_INVALID/
CALLER_REFUSED/INELIGIBLE/REPLAY/INPUT_MISMATCH.
Pre-reservation refusal null attemptDigest/record; consumed error terminal/
quarantine, not reset REFUSED. BOUND attemptDigest/null record+reason;
terminal full matching record+reason. Malformed intake allows operation/
executionId=null only/fixed SCHEMA_INVALID/no echo. Oversize malformed
response cannot truncate into PASS; error/recovery.

### 11.4 Implementation interfaces and retained governance

Future private modules: execute.js/execution-applied-binding.js/
execution-store+state/broker-client/framework-launch+result/
execution-record-v2. verifyApplied -> frozen binding;
create(closed request) -> bounded frames/record; reconcile(ID) -> record;
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
