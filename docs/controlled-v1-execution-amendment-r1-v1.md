# Controlled-v1 OD-06 execution contract — R1 amendment v1 (STAGE5-DESIGN-AMENDMENT-1)

Status: **PROPOSED AMENDMENT — PO DISPOSITIONS APPROVED FOR REVIEW; NOT YET REVIEWED; NOT NORMATIVE.**

Until this amendment passes independent HEAVY Architecture and HEAVY Security review, is merged under separate PO authority and is post-merge certified, OD-06 sections 3–18 stay the governing design, unchanged. Here OD-06 means [`controlled-v1-execution-contract-v1.md`](controlled-v1-execution-contract-v1.md).

This document:
- implements nothing;
- does not enable `execute`;
- does not authorize Stage 5;
- does not accept, waive or re-rate any risk or finding.

Product Owner authority:

```text
OD-R1-STAGE5-DESIGN-AMENDMENT-1          — APPROVED FOR DESIGN  2026-11-26
OD-R1-STAGE5-DESIGN-DISPOSITIONS-1       — APPROVED FOR REVIEW  2026-11-26
OD-R1-STAGE5-WP1                         — APPROVED             2026-11-26
```

| Item | Value |
|---|---|
| Repository baseline | `TarasovArtem/qa-ai-agent` `main` `8ffbf39aa5eb9d3e59dee7a02fc32b52267b410d`, tree `ad2c7d4669b2cd02bfdc2c854ebe32b18037ec4a` |
| Lifecycle at authoring | Issue #199 OPEN; R1 primary priority; TPR SUSPENDED / NOT RELEASED; Stage 5 implementation **NOT AUTHORIZED**; `qa-agent execute` **DISABLED** |
| Amended contract | [`controlled-v1-execution-contract-v1.md`](controlled-v1-execution-contract-v1.md) (OD-06). Sections 3–18 are normative; §19/§19.1 hold the certification and the carried Security debt. The file is unchanged since `96ebc4f6`; on top of merge `22ceb068` it carries only the canonical-closure commits `9b230280` and `7ca09f52` |
| Approval/apply contract | [`controlled-v1-approval-apply-contract-v1.md`](controlled-v1-approval-apply-contract-v1.md) (OD-04), unchanged by this amendment. Since the OD-06 merge it has received the OD-265 planning commits `853b2f4`, `ad0a27e` and `fe6d76f` (see RQ-6) |
| Release contract | [`controlled-v1-release-contract-v1.md`](controlled-v1-release-contract-v1.md). RC-08 wording (§3.1) governs; nothing here adds, removes or reinterprets an acceptance criterion |
| Design input | The out-of-repository working document `STAGE5-DESIGN-AMENDMENT-1.md`, SHA-256 `fde4410a02cb32c8bc41e52d2f6a477e5bbfa580e1c40e3ba86fcf583f4c0dec`, approved as input by `OD-R1-STAGE5-WP1` |
| Other inputs | R1-STAGE5-DIRECTION-1 (PM design decision report, 2026-11-24). PW-PILOT-1 Closure Record (`OD-PW-PILOT-1-CLOSURE`, 2026-11-26, PM record). Stage 5 research records R2–R6, C17, C18, D4 and D5 (2026-10-15..18), cited by finding only |

### Relation to the design input

This repository version is the design input with three kinds of change:
1. The PO dispositions (§6) are integrated. As a consequence:
   - A7 is part of the amendment instead of conditional;
   - the options not selected are kept only as decision rationale;
   - the effort is restated for the selected options.
2. The consolidated HEAVY review scope (§9) is added.
3. Operator-local environment detail is removed.

No other normative content changed.

PO-approved design direction:
- the minimum R1 execution scope is Playwright Chromium;
- one dedicated Linux VM;
- integration stays opt-in, removable and minimally invasive;
- the approved human-approval and fail-closed requirements are preserved;
- previously accepted evidence is reused where it applies;
- the existing demo and its evidence are preserved.

---

## 0. Summary

OD-06 defines a complete, certified execution-controller design: a scoped root broker, a transient systemd service, cgroup v2 lifecycle and protected reconciliation. Stage 5 implementation stopped on 2026-10-15 at four contract insufficiencies (DG-1..DG-4). Later research added three needs on the system-bus path: a RECONCILE non-commit ending (R5), an availability classification for bus reply loss (C18) and manager re-exec handling (R3/R6).

This amendment closes those insufficiencies for one minimum scope:
- one qualified dedicated Debian 13 Linux VM;
- Playwright Chromium only;
- one static, digest-pinned config;
- the system D-Bus;
- workload filesystem-write confinement.

It contains nine deltas:

| ID | Delta | Closes | PO disposition |
|---|---|---|---|
| A1 | R1 runner/framework scope overlay on §3. No schema change | Minimum scope | PD-4, PD-5 |
| A2 | Client-derivable Playwright fingerprint and browser-tree digest | DG-1 (Stage 5 STOP 1) | — |
| A3 | Caller authentication through kernel peer credentials of the stdio sockets | DG-2 (Stage 5 STOP 2) | PD-3 = B, subject to Architecture/Security review |
| A4 | `execute` CLI grammar and `execute` config block | DG-4 (Stage 5 STOP 4) | Review (public surface) |
| A5 | RECONCILE non-commit ending | R5 blocker | PD-2 = A |
| A6 | Classification of bus/manager availability loss: fail-closed, never PASS | C18, R3/R6 re-exec | PD-2 = A, subject to Security review |
| A7 | Workload filesystem-write confinement profile | RC-08 "paths" gap (G1) | PD-1 = B |
| A8 | Native broker toolchain, reproducible build and distribution | DG-3 (Stage 5 STOP 3) | PD-6 = Rust + D1, subject to Architecture review |
| A9 | R1 operating flow: where generation, approval/apply and execution run | Root binding, GC-1 environment | PD-5 |

**Not included, deliberately:**
- Private systemd transport (R2/R4: not viable).
- Manager-identity redefinition (R6: only needed for the private transport; R6-C1 blocked it).
- RemainAfterExit unit-lifetime change (R3: needed only without RefUnit; the system bus keeps RefUnit; §2.3).
- The D5 OD-04 separate-principal broker.
- CI-runner trust transport (D4).
- Cypress.

---

## 1. RC-08 contract coverage

RC-08 (release contract §3.1, governing): «Контролируемое выполнение — Применяются ограничения путей, команд, окружения и времени выполнения».

These go together with:
- RC-07 («Неподтверждённые изменения не применяются и не исполняются»);
- release prerequisite 6, an independently assessed supported execution environment;
- GC-1..GC-3 on the exact release-candidate identity.

### 1.1 Coverage matrix

| RC-08 restriction | Enforced by (OD-06 as amended) | Enforcer / evidence | Status |
|---|---|---|---|
| **Paths — what executes** | Only the exact applied, approved spec paths of one package; ALL of them, no subset or suite fallback; PPI-1 canonical form; regular files with link count 1; descriptor-anchored, no-follow, no mount crossing (OD-06 §4.2, §4.3 items 2–3, §5.5, §8.1) | Root broker plus client gate-free binding | COVERED |
| **Paths — where it runs** | WorkingDirectory = enrolled canonical root; roots below one operator workspace anchor, pairwise non-overlapping, mount-alias-free (§5.5, §6.1) | Broker; systemd property readback | COVERED |
| **Paths — where product data goes** | HOME, TMPDIR and reports in a per-attempt leaf on a dedicated size-bounded mount (§5.6.3, §9.1); execution record under `<output.dir>/execution/<ID>.json` (§11.4) | Broker; workload mode | COVERED |
| **Paths — what the test process tree may write** | A7: the host filesystem is read-only to the workload except the attempt leaf; /tmp is private; the enrolled root is read-only | systemd mount namespace, broker readback, qualification write-probe (Q5) | COVERED by A7 (PD-1 = B), subject to review. Read access, `/dev/shm`, network and SUT authority remain R-5 |
| **Commands** | Fixed adapter `od06-playwright-v1`: Node argv built by the broker, no shell, no `.bin`/npx/npm script/PATH lookup; exact `sudo -n -- broker` with zero argv; one sudoers rule; closed transient-property allowlist; NoNewPrivileges; capabilities 0; no manage-units or systemctl authority for the runner (§4.1, §5.1, §6.1, §8.2) | Broker, sudoers, systemd | COVERED; the caller-authentication primitive is A3 (PD-3 = B), subject to review |
| **Environment** | Inherited environment cleared in native workload mode; fixed REQUIRED/ALLOWED set; enrolled `SUT_*` allowlist ≤32; credentials stripped; secrets never in unit properties, argv or journal (§6.1, §9.1); the qualified Node/Playwright/Chromium tuple is bound by fingerprint and profileDigest (§8.2, A2) | Broker, workload mode | COVERED; config surface A4 |
| **Execution time** | `timeoutMs` 1000..600000 from the target config only; RuntimeMaxUSec; SIGTERM → SIGKILL over the whole cgroup; empty-cgroup proof; finite phase budgets P0–P6; timeout → 8 only with exact manager deadline facts; unproven cleanup → QUARANTINED 7 (§6.3, §6.4) | systemd manager, broker | COVERED |
| **RC-07 coupling** | Execution only of applied approved bytes; gate-free reconstruction of the whole Stage 4 chain; one consumption per (root, run, ordinal) and (root, package, apply record); no retry (§7, §8.1) | Client plus broker; OD-04 unchanged | COVERED |

### 1.2 Gaps in the certified design and their resolution

| Gap | Description | Resolution |
|---|---|---|
| G1 | RC-08 "ограничения путей" can be read as controller path restrictions (provided by OD-06) or as filesystem confinement of the executed test (explicitly not provided by OD-06; R-5 ACCEPTED) | PD-1 = B: both readings are satisfied for writes through A7. Read access remains R-5 and is documented (§2.5) |
| G2 | Availability loss on the system bus (C18): the untrusted test runs as the runner uid and can overfill the broker's dbus-daemon queue, so a manager reply is dropped. The result is QUARANTINED / CLEANUP_UNPROVEN 7. A dedicated host does not remove this actor | PD-2 = A: A5 + A6, subject to Security review |
| G3 | §5.1 requires unforgeable caller-authentication metadata from sudo, "never ordinary SUDO_UID", but names no primitive (Stage 5 STOP 2) | PD-3 = B: A3 |
| G4 | `bindingDigest` includes `fingerprintDigest`, but the fingerprint file set has no client-derivable algorithm and lives in root-only enrollment (Stage 5 STOP 1) | A2 |
| G5 | `execute` CLI grammar and `execute` config are "later separately approved" (§4.2) (Stage 5 STOP 4) | A4 |
| G6 | Native broker language, toolchain, build and distribution are unspecified (§5.3; Stage 5 STOP 3) | PD-6 = Rust + D1: A8 |
| G7 | RECONCILE has no ending meaning "unresolved after a write, try later" (R5) | A5 |
| G8 | Manager daemon-reexec changes the system-bus unique owner (`managerId`), which yields a false STATE_INCONSISTENT (R3 finding) | A6: classified fail-closed; operating rule; no identity relaxation |

No other gap was found. No acceptance criterion is reduced or reinterpreted.

---

## 2. Minimum supported scope (R1)

### 2.1 Execution environment

| Element | R1 value |
|---|---|
| Runner class | Exactly **one** operator-provisioned, dedicated, self-hosted Linux VM. OD-06 §3 "Provisioned self-hosted Linux" already allows a VM. Every other class stays REFUSED or DEFERRED as in §3 |
| OS tuple (PD-5) | Debian 13 (trixie) at a pinned point release and snapshot; Debian kernel 6.12.x; systemd/libsystemd 257.x Debian build (research reference `257.13-1~deb13u1`, no Debian patches); dbus-daemon 1.16.x (reference `1.16.2-2`); Debian sudo 1.9.x; cgroup v2 unified only. The exact builds go into `qualification` (OD-06 §5.2); no floating values |
| Kernel features required | STATX_MNT_ID, STATX_ATTR_MOUNT_ROOT, openat2 RESOLVE_NO_SYMLINKS/NO_XDEV, nsfs inode identity, pidfd, SO_PEERCRED and SO_PEERPIDFD (A3; Linux ≥ 6.5) |
| Hosting (PD-5) | A KVM guest. **Nested KVM inside WSL2 on the operator workstation is a qualification candidate**, not a qualified environment; it becomes eligible only by passing qualification (§2.4) and the independent assessment (Q7). The execution host is the KVM guest kernel, never WSL2 itself, which stays unsupported. A separate physical Linux host is an equivalent alternative candidate |
| Network | Loopback-only (no NIC) is the recommended qualification posture. No provider or credential ever enters the VM (A9). The SUT runs on 127.0.0.1 |
| Storage | ext4 for the workspace anchor W and the root; ext4 for `/var/lib/qa-agent-controller-v1`; a **dedicated** ext4 partition for workload mount B (OD-06 §5.6.3). Thick, non-CoW virtual disk (for L5); inode floor (for L6) |
| Accounts | One enrolled runner account (non-root, nonprivileged groups); a separate admin account for the operator. No other interactive same-account agents (L4); Yama `ptrace_scope ≥ 1` |
| Node | One root-owned qualified Node 22.x (exact version and SHA-256) outside any runner-writable ancestor |
| Lifetime | **Persistent**, not per-run disposable. OD-06 needs protected history continuity: lost history quarantines the runner, and re-enrollment cannot manufacture fresh consumption. Destruction applies only when the runner is retired, after drain/reconcile per OD-06 §5.3 |

### 2.2 Supported Playwright configuration (PD-4)

| Element | R1 rule | Enforcement |
|---|---|---|
| Framework | `playwright` only. The release-approved OD-06 §5.4 compatibility record carries a qualification with exactly one `frameworkProfiles` entry (playwright, adapter `od06-playwright-v1`). A Cypress request fails §5.4 profile agreement → REFUSED/INELIGIBLE 5 | Broker C7; enrollment validation. No schema change |
| Project | `chromium` only (the adapter passes the fixed `--project=chromium`) | Adapter, §8.2 |
| Config | Exactly one root `playwright.config.js` (fixed adapter path), CommonJS, whose only import is `@playwright/test`. Its bytes are pinned in the fingerprint (A2). Any change → fingerprint mismatch → INELIGIBLE until operator requalification. Packages that touch the config are helper/config packages and already refuse (§8.1) | Digest pin; operator qualification review. **No JavaScript parsing by the broker** |
| Selection | ALL applied specs of the package, anchored escaped regexes; no grep, subset or suite fallback | §8.2 unchanged |
| Reporter | Fixed `--reporter=junit` plus `PLAYWRIGHT_JUNIT_OUTPUT_FILE` in the leaf; config reporters are overridden | §8.2/§9.1 unchanged |
| Output | Fixed `--output=<leaf>/test-results` (A7) | A7 |
| Versions | Exactly the qualified `@playwright/test`/`playwright`/`playwright-core` version and the Chromium revision of the qualified browser tree | profileDigest, fingerprint |
| Workers / retries | Must come out as 1 worker and 0 retries for result admissibility (§9.3/§9.4, unchanged) | Client parser, broker accounting |

### 2.3 RefUnit is retained; R3 is not adopted

On the system bus, RefUnit is bound to the broker's bus connection and keeps a successfully exited unit from being garbage-collected while the broker is attached (R2/R3 source facts).

R3's RemainAfterExit change was needed only for a transport without RefUnit. It would also change the stop path (KillUnit-based P4) and the active/exited semantics in OD-06 §6.3, §7.3 and §7.4.

Leaving it out keeps the amendment smaller. The residual is an availability one only: a lost RefUnit reply under the C18 condition can turn a true PASS into EXECUTION_ERROR 7. It is covered by A6, and it never produces a false PASS. This departs from item 4 of the R1-STAGE5-DIRECTION-1 recommendation and is a review item (§9).

### 2.4 Qualification requirements (R1, in addition to OD-06 §5.2/§5.6/§12)

- **Q1.** Every OD-06 §12 vector (C1–C5 tables) applicable to Playwright on the R1 tuple; the Cypress-specific vectors are replaced by "Cypress request → INELIGIBLE".
- **Q2.** Every §19.1 debt item (L1–L7, I1–I5) has a disposition with evidence:
  - L1 by the memory-safe parser (A8) plus fuzzing;
  - L4 by Yama plus the account inventory;
  - L5/L6 by disk/partition evidence;
  - L7 by a fail-closed concurrency cap;
  - I4 by the A3 pass-through test;
  - I5 as narrowed by A7.
- **Q3.** A3 negative vectors (§4.3).
- **Q4.** A6 availability vectors: a bus flood from the workload during start, observation and stop; daemon-reexec and daemon-reload during an attempt; a lost StartTransientUnit reply. Each must yield a non-PASS fail-closed outcome and the A5 RECONCILE ending where applicable.
- **Q5.** A7 write-probes from the workload outside the leaf fail; /tmp is private; the root is read-only to the workload; Playwright runs unchanged with `--output`; property readback matches.
- **Q6.** F19 / N-04 bounded termination on Linux: the §6.3 empty proof under fork bombs, setsid, nested cgroups and uninterruptible tasks.
- **Q7.** The independent environment assessment (release prerequisite 6), by an assessor other than the author, covering the PD-5 hosting candidate.

### 2.5 Limitations (to be documented for GC-6)

- No malicious-test sandbox. Tests keep read access to the host filesystem, `/dev/shm`, network and SUT authority (R-5; A7 narrows only writes).
- No authenticated physical-human approval (R-1/R-2); approval provenance is the OD-04 TAP-2 OS-local principal.
- One VM, one root profile, one framework; no CI execution; no Windows or macOS execution.
- Availability: bus or manager disturbances end in QUARANTINED/EXECUTION_ERROR, and a consumed approval needs a fresh generation/approval cycle (no retry, by design).
- `execute` stays a reserved refusal until a separate activation decision.

### 2.6 Refusal conditions (all fail-closed; before any spawn unless stated)

These are the OD-06 conditions, unchanged, plus R1:
- Windows, macOS, WSL2 itself, containers or a generic or unqualified host → refused (reserved exit 5 / INELIGIBLE).
- Framework ≠ playwright, or project ≠ chromium → INELIGIBLE 5.
- Live fingerprint ≠ enrolled fingerprint (config or package change) → INELIGIBLE 5.
- Client fingerprint ≠ broker live recomputation → INPUT_MISMATCH 4.
- Caller-authentication failure under A3 → REFUSED/CALLER_REFUSED 5 (at C1a/R1a).
- An A7 property not supported or not read back → INELIGIBLE 5.
- Package not APPLIED, or ambiguous / expired / foreign evidence → REFUSED 5 or 4 per OD-06 §8.1.

---

## 3. Normative deltas to OD-06 (proposed text)

The deltas are written as amendments to the cited OD-06 sections. Anything not mentioned is unchanged. Each delta becomes effective only through the lifecycle stated under Status.

### A1 — R1 scope overlay (§3, §5.2, §5.4)

- **§3 (overlay).** For the Controlled Agent R1 release, the only supported execute runner is one provisioned self-hosted Linux VM qualified on the R1 tuple (§2.1), with exactly one Playwright framework profile. Cypress execution is DEFERRED for R1; the schema keeps the `cypress` literal.
- **§5.4 (overlay).** The R1 release-approved compatibility manifest contains only records whose qualification has exactly one `frameworkProfiles` entry, with `framework:"playwright"` and `adapterVersion:"od06-playwright-v1"`. No enrollment, compatibility or request schema changes.

### A2 — Client-derivable fingerprint (§8.2, §11.1) — closes DG-1

**A2.1** `fingerprint.algorithm = "od06-files-v1"`. For `framework:"playwright"`, the file set **F** is defined only by the following deterministic rule, evaluated by both client and broker over the live root:
1. `playwright.config.js`, `package.json` and `package-lock.json` at the root (each required).
2. Every regular file reached by a recursive no-follow walk of `node_modules/@playwright/test`, `node_modules/playwright` and `node_modules/playwright-core`. The walk is descriptor-anchored beneath the root with no mount crossing.

Any of the following in those trees **refuses** (the client exits 4; the broker returns INELIGIBLE 5):
- a symlink, FIFO, socket, device or a hard link (link count ≠ 1);
- a directory that is a mount root;
- an entry whose name violates the PPI-1 segment grammar.

The applied target specs are **not** in F; they are bound separately by `afterDigest`.

Paths are canonical root-relative and sorted by byte. Each entry is `{path, sha256, size}`. The limits are unchanged: ≤4096 files, ≤16 MiB per file, ≤64 MiB total.

Design-time measurement (PW-PILOT-1 install of Playwright 1.63.0): 187 files, 18,576,425 bytes, largest 3,477,183 bytes, longest path 101 bytes, no symlinks. That is within the limits. R1 qualification re-measures the qualified version.

**A2.2** `fingerprintDigest` = H(domain `qa-ai-agent:execution-fingerprint:v1:`, canonical `{algorithm, files}`).
- **Client:** computes it from live files with A2.1 and puts it into `binding`/`bindingDigest`. It never reads the root-only enrollment.
- **Broker:**
  - recomputes it from live files and compares it with the enrolled `roots[].fingerprint.digest`; a mismatch → REFUSED/INELIGIBLE 5, and requalification is needed;
  - compares the request `bindingDigest` with its own reconstruction; a mismatch → REFUSED/INPUT_MISMATCH 4;
  - repeats both in P1S; a mismatch there → PRESUBMIT_FAILURE 7 (consumed), as in §6.4.

**A2.3** Inside `frameworkProfiles`, `browserSha256` is defined as the same `od06-files-v1` digest computed over the qualified browser directory `browserPath`, which is root-owned and outside the root. It uses the domain `qa-ai-agent:execution-browser-tree:v1:`. The limits are raised for this tree only: ≤16384 files, ≤1 GiB total, measured at qualification.

`browserVersion` is the Playwright browser revision string (for example `chromium-1243`).

`nativePath`/`nativeVersion`/`nativeSha256` name the Chromium executable inside that tree that the qualified version actually launches.

**Effect:** Stage 5 STOP 1 is resolved without moving the fingerprint out of root-only enrollment and without trusting a client value.

### A3 — Caller authentication primitive (§5.1, §4.3 item 1, §7.2) — closes DG-2 (PD-3 = B)

**A3.1 Transport (§7.2 wording).**
- The client launches the qualified absolute `sudo` with the fixed argv `["-n","--","/usr/local/libexec/qa-agent-controller-v1"]`, `shell:false`, `stdio: ["pipe","pipe","ignore"]`.
- On Linux, Node/libuv creates each `pipe` stdio as an AF_UNIX SOCK_STREAM socketpair. This was observed at design time on Node 22.23.3: the child's fd 0 and fd 1 were sockets, and SO_PEERCRED returned the client's pid/uid/gid. Qualification verifies it on the qualified Node.
- "Exactly the two pipes" in §7.2 becomes "exactly the two client-created stdio stream sockets (fd 0 and fd 1)".
- Framing, frames and all §7.2 rules are unchanged. The client asserts before launch that it is on Linux and that its spawn API yields sockets; otherwise it refuses with exit 5 and nothing is sent.

**A3.2 Broker C1a/R1a check (replaces "Sudo must supply/overwrite authentication metadata unforgeably").** The broker authenticates the caller **only** if all of the following hold, before reading any enrollment-dependent or protected state beyond the C1a integrity checks:
1. euid = ruid = 0 and argv is empty (unchanged).
2. fd 0 and fd 1 are each `S_ISSOCK`, with `SO_DOMAIN = AF_UNIX` and `SO_TYPE = SOCK_STREAM`.
3. `SO_PEERCRED` on fd 0 and fd 1 returns the same pid, which is > 1, and uid/gid equal to the enrolled `caller.uid`/`caller.gid`.
4. `SO_PEERPIDFD` on fd 0 yields a pidfd of a live process whose real and effective uid equal `caller.uid`. The peer is never used for authority beyond this check.
5. `SUDO_UID`, `SUDO_GID` and `SUDO_USER` are present and equal the enrolled caller (a consistency cross-check only; never sufficient on its own).
6. The effective sudo policy is qualified (A3.3).

Failure of any of these → REFUSED/CALLER_REFUSED (exit 5). On CREATE nothing is read from or written to the protected store; on RECONCILE nothing happens before the attempt lookup.

The kernel stamps SO_PEERCRED when the socketpair is created. A non-root process cannot forge it, and a socket that another uid created and passed in carries that other uid, so it is refused.

**A3.3 Sudo qualification.**
- The exact rule from §5.1 is unchanged, plus `Defaults!/usr/local/libexec/qa-agent-controller-v1 !use_pty, !log_input, !log_output, closefrom=3`.
- The qualification test proves that sudo passes fd 0 and fd 1 through unrelayed, so that the broker observes the client's sockets and peer credentials; this disposes I4.
- `sudo -l -U <account>` over every local account proves that only the enrolled account can run the broker without a password.
- A direct-root invocation, a relayed or pty stdio, spoofed `SUDO_*` and any sudo option are negative vectors.

**A3.4 Residual (unchanged class).** Any process of the enrolled account is that account (R-1/R-2). Root can forge anything; root is outside the threat model, as before. Nothing broadens invocation.

### A4 — `execute` CLI grammar and config (§4.2, §11.4) — closes DG-4

**A4.1 CLI (proposed public surface; activation is separate).**

    qa-agent execute --run <runId> --package <NNNN> [--json]
    qa-agent execute --reconcile <executionId> [--json]

The two forms are mutually exclusive, and every other option, positional argument or repetition → usage exit 2 (the existing parser class).
- `--run` / `--package` use the OD-06 §4.2 grammars; `--reconcile` takes a 32-lowercase-hex ID.
- `--reconcile` is the only cancel/recovery entry, and the caller must own the attempt (§7).
- Exit codes are the existing OD-06 mapping: 0 PASSED, 10 TEST_FAILED, 8 TIMED_OUT, 7 EXECUTION_ERROR/QUARANTINED/synchronous orphan, 5 REFUSED/INELIGIBLE/disabled, 4 INPUT_MISMATCH, 3 config.

Until activation the command stays the reserved fixed refusal (exit 5). `execute --help` stays help-only.

**A4.2 Config (target opt-in).** An optional closed top-level key, `execute: {timeoutMs, sutEnvironmentNames}`:
- `timeoutMs` is an integer 1000..600000, default 600000 when the key is absent but execution is enabled;
- `sutEnvironmentNames` holds ≤32 unique `SUT_[A-Z][A-Z0-9_]{0,59}` names and must be a subset of the root enrollment `sutNames`.

Execution additionally requires `capabilities.execute = true` (existing, schema-valid) and, after activation, `RELEASE_CAPABILITIES.execute.enabled = true`.

Runtime values come only from the named caller environment entries; a missing entry refuses, and an empty value is allowed.

The versioning choice (an additive optional key in config v1 versus config v2) is RQ-4. The proposal is an additive optional key, rejected by product versions without execute support.

### A5 — RECONCILE non-commit ending (§7.2, §7.4, §11.3) — R5

- **§7.2 RECONCILE row.** The allowed successors become REFUSED, TERMINAL or QUARANTINED, where **REFUSED with reason RECOVERY_BUDGET_EXHAUSTED (exit 5) is permitted after durable journal writes of that invocation**, for example ORPHANED and admission-closed.
- It means: the attempt is not finalized; its durable state is the last fsynced entry; claims are retained; a later RECONCILE or the next P1 continues.
- REFUSED from RECONCILE never carries a record and never implies "nothing happened".
- It is used when a required manager fact (unit state, job set, cgroup emptiness via the N5 anchor, deadline facts) cannot be obtained within the §6.3 reconcile bound, and no QUARANTINED condition (proven ambiguity) is yet met.
- RECONCILE never yields PASSED or TEST_FAILED (unchanged).
- The CREATE pre-create reconciliation inside P1 keeps its existing REFUSED/RECOVERY_BUDGET_EXHAUSTED before reservation.
- An attached CREATE that loses a reply after SUBMITTING keeps the existing §7.4 S2 rows (client exit 7, durable SUBMITTING / MAY_HAVE_BEEN_SENT); recovery uses Cases A–E (R5: the journal is sufficient, no new durable state).

### A6 — Availability classification (§6.3, §7.3, §7.4, §11.3) — C18, re-exec (PD-2 = A)

A new normative paragraph:

> **Bus and manager availability loss is a fail-closed availability outcome, never an integrity outcome.** On the qualified system bus, the following are availability events:
> (a) no reply to a manager method call within its phase bound;
> (b) a LimitsExceeded or other bus error on a manager call;
> (c) loss of the broker's bus connection;
> (d) PropertiesChanged signals not delivered;
> (e) a change of the manager's system-bus unique owner (`managerId`) during an attempt, for example `daemon-reexec`.
> None of them is evidence of success, failure, timeout or cleanup.
> In CREATE before SUBMITTING they are REFUSED before reservation (exit 5).
> After SUBMITTING the broker applies the existing rows:
> - if empty proof (§6.3, N5 anchor) and the manager terminal facts are obtained → EXECUTION_ERROR CONTROLLER_FAILURE 7;
> - otherwise → QUARANTINED CLEANUP_UNPROVEN or STATE_INCONSISTENT 7.
> In RECONCILE they give the A5 REFUSED/RECOVERY_BUDGET_EXHAUSTED 5 until proof is obtainable, or QUARANTINED when ambiguity is proven.
> `managerId` change (e) stays STATE_INCONSISTENT → QUARANTINED (no identity relaxation). The R1 operating rule forbids `daemon-reexec`, `daemon-reload` and systemd/dbus package upgrades while any attempt is incomplete, and qualification tests it.
> No availability event may produce PASSED, TEST_FAILED, TIMED_OUT or a reset or retry of a consumed attempt.

Consequence: the approval/apply is consumed, and re-execution needs a new generation and approval cycle. That is the OD-06 no-retry design, unchanged. This classification is **not** acceptance of an integrity risk. It becomes normative only with HEAVY Security approval.

Hardening, research only and **not** claimed: within the A7 workload mount namespace, `InaccessiblePaths=/run/dbus/system_bus_socket` could remove the in-unit flood actor. Its sufficiency is NOT PROVEN, because same-uid paths such as `/proc/<pid>/root` of runner processes outside the unit exist. It needs a separate adversarial study before any claim, and it is not an R1 prerequisite.

### A7 — Workload filesystem-write confinement profile (§6.1, §8.2) — PD-1 = B

- **§6.1 allowlist additions** (fixed values, broker-built, read back after start):

| Property | Signature | Fixed value |
|---|---|---|
| `ProtectSystem` | s | `strict` |
| `ProtectHome` | s | `tmpfs` |
| `PrivateTmp` | b | `true` |
| `ReadWritePaths` | as | `[<attempt leaf>]` |

  The enrolled root, which is the WorkingDirectory, becomes read-only to the workload. HOME, TMPDIR and reportsDir are inside the attempt leaf (§9.1) and stay writable.
- **§8.2 Playwright argv.** Add the fixed entry `--output=<leaf>/test-results`.
- **§3 claim, scoped.** "The executed test process tree cannot write outside its attempt leaf and its private /tmp; read access to the host filesystem, `/dev/shm`, network and SUT authority remain (R-5; I5 narrowed for /tmp only)."
- **§6.1 sentence "No further writable property extension/sandbox/quota claim"** is replaced by: "The writable property set is exactly §6.1 plus the A7 list; no further extension or sandbox claim."
- **Qualification Q5.** An unsupported or ineffective property, or a readback mismatch → INELIGIBLE before reservation; a mismatch after start → CONTROLLER_FAILURE or QUARANTINED per §7.3.

R-5 stays ACCEPTED; A7 narrows its write part and does not replace it. The broker's own §5.6 namespace checks concern the broker, so the workload's private mount namespace does not affect them; MainPID and cgroup observation are unaffected.

### A8 — Native broker toolchain, build and distribution (§4.1, §5.3, §5.4) — PD-6 = Rust + D1

- **Language/toolchain (R).** Rust, built with the Debian 13 packaged `rustc`/`cargo` of the qualification tuple (no rustup).
  - Dependency budget: `libc` plus one vendored, pinned SHA-256 implementation.
  - No serde: a hand-written strict parser for the closed schemas.
  - Hand-written minimal FFI to libsystemd sd-bus (zbus excluded by C17).
  - Build: `--locked --offline` from vendored sources, with `SOURCE_DATE_EPOCH` and `--remap-path-prefix`.
  - Fuzzing of the P0 frame parser and the strict JSON parser is still required for L1.
- **Distribution (D1).**
  - The broker source lives in this repository, in a dedicated native directory outside the npm package inventory; npm never builds or installs it.
  - The operator builds it on the qualified VM (or an identical build VM) from the exact release commit with the documented reproducible procedure. The result must equal the `brokerSha256` in the release-approved §5.4 record; a mismatch → no install.
  - `qualification.brokerBuild` records the toolchain identity.
  - A signed prebuilt binary (D2) may be added later only under OD-01/OD-03.
- **Unchanged regardless of language:**
  - one artifact at `/usr/local/libexec/qa-agent-controller-v1` with root and `--workload-v1` modes;
  - no daemon or listener;
  - the §5.2 ownership and permissions;
  - the §5.4 binding and the fail-closed pair rules.

### A9 — R1 operating flow (overlay on OD-06 §2.3 / §8.1)

1. **Generation** (`design`/`plan`/`generate`) runs outside the execution VM, on the provider-connected operator host. No provider credential ever enters the VM.
2. **Transfer.** The run directory and its inputs are copied byte-identically into the **enrolled root on the VM** through a read-only medium. The handoff is verified (manifest digests).
3. **Approval and apply.** `qa-agent review record` and `qa-agent apply` run **on the VM, in the enrolled root**, by the human approver at the VM console TTY (TAP-2). Root identity (path, dev, ino) is therefore native, and the copied-root refusal is respected. The PW-PILOT-1 model, where apply ran in a separate host copy and only the applied bytes were carried to the runner, is **not** valid for OD-06 execution.
4. **Execution.** `qa-agent execute --run … --package …` runs on the VM.
5. **Evidence.** The execution record v2 plus structural report projections are exported read-only for RC-09/GC-6. Raw reports are never persisted by the product (OD-06 §9.2, unchanged).

---

## 4. Security and governance

### 4.1 Invariants preserved

- RC-07 / OD-04:
  - no approval → no apply, and no apply → no execute;
  - approved bytes == applied bytes == executed bytes;
  - execution never calls #23F, approval gates or `apply`;
  - gate-free reconstruction (OD-06 §8.1);
  - TSB-F02's execute trigger stays FALSE (§10).
- One-shot root broker, no daemon or listener; one exact sudo rule; no manage-units, systemctl, systemd-run or Polkit grant for the runner.
- Closed transient-property allowlist (A7 only adds a closed list); NoNewPrivileges; capabilities 0; cleared environment; secrets never in properties, argv, journal or records.
- Whole-tree containment with empty proof; unknown state → QUARANTINED, never PASS; the only PASS path is OBSERVED + accepted proposal + fsynced terminal + client-validated TERMINAL.
- Durable journal before D-Bus; no resubmit on uncertainty; consumption tombstones never reset; no retry.
- Fail-closed refusal on every unsupported platform or condition; `execute` stays DISABLED until separate activation.
- R-1..R-5 ACCEPTED within their existing scope; AT-07/TB-01 RESIDUAL; FUTURE guards OPEN; §19.1 L1–L7/I1–I5 OPEN / PRESERVED / CARRIED TO STAGE 5. Nothing waived, closed or re-rated.
- RC-01..RC-12 and GC-1..GC-6 unchanged; release prerequisites 1–11 and the AISEC-6/SADR-11 dossier unchanged.
- The existing demo, its evidence and the PW-PILOT-1 accepted evidence are unchanged; product behaviour is unchanged.

### 4.2 Trust-boundary and accepted-risk changes

| ID | Change | Direction | Integrity impact | Disposition |
|---|---|---|---|---|
| TBΔ-1 | Caller authentication: kernel SO_PEERCRED/SO_PEERPIDFD of the client-created stdio sockets replaces the unspecified "sudo metadata"; §7.2 transport wording changes from pipes to stdio stream sockets | Strengthens (adds a concrete, kernel-attested primitive) | None negative | PD-3 = B; Architecture/Security review; the §5.1 Security owner decision is exercised through that review |
| TBΔ-2 | Availability loss on the system bus is formally classified as a fail-closed availability outcome; RECONCILE gets a non-commit ending | Clarifies; no new success path | None. Not integrity risk acceptance | PD-2 = A; HEAVY Security |
| TBΔ-3 | Workload filesystem-write confinement (A7) | Adds containment; narrows R-5 (write part) | Positive | PD-1 = B |
| TBΔ-4 | New native artifact supply chain: Rust toolchain, reproducible build, D1 distribution | New component boundary | Must not weaken §5.2/§5.4 integrity | PD-6 = Rust + D1; Architecture review; OD-01 linkage |
| TBΔ-5 | New public surface: `execute` CLI grammar and `execute` config | Governance (productization, package surface, SADR-11 dossier) | None by itself; inactive until activation | Review; dossier |
| TBΔ-6 | Approval and apply happen on the execution VM console, not on the developer host | Operating model | None; same TAP-2/OS-local principal (R-1 unchanged) | PD-5 |

No change makes the approval boundary weaker, introduces a sandbox claim beyond A7, or accepts a new risk.

### 4.3 A3 negative vectors (added to OD-06 §12)

- spoofed `SUDO_UID`/`SUDO_GID`/`SUDO_USER`;
- `sudo -E`, `--preserve-env` or any sudo option;
- a direct root invocation;
- fd 0 or fd 1 as a pipe, regular file, tty, pty or `/dev/null`;
- fd 0 and fd 1 with different peers;
- a socket created by another uid and passed via SCM_RIGHTS;
- the peer exited before the check (dead pidfd);
- sudo relaying stdio (use_pty or I/O log enabled → must refuse);
- a peer in a user namespace mapping to another uid;
- a caller who is not the enrolled account but is permitted by an unrelated sudoers rule;
- every refusal happens before any protected-store read or write.

### 4.4 A7 negative vectors (added to OD-06 §12)

- a workload write to the enrolled root, the workspace anchor, `/etc`, `/var/lib/qa-agent-controller-v1`, `/home` or another attempt leaf → denied;
- a workload `/tmp` write is invisible outside the unit;
- a property missing or with a different value on readback → INELIGIBLE / CONTROLLER_FAILURE;
- Playwright writing `test-results` without `--output` → refused by qualification;
- the empty proof and timeout semantics are unchanged with the profile active.

---

## 5. PW-PILOT-1 evidence reuse

The PW-PILOT-1 Closure Record (`OD-PW-PILOT-1-CLOSURE`, COMPLETE/PASS) is accepted evidence for its own scope. **The manual Playwright run does not qualify RC-08**: it used no broker, no systemd containment and no `qa-agent execute`.

| Pilot evidence | Reuse for this design | Limit |
|---|---|---|
| Generated spec `playwright/tests/add-task-success.spec.js` (`43fb946a…`) ran PASS against the demo SUT (1 passed / 0 failed / 0 skipped / 0 flaky) under Playwright 1.63.0, Chromium 1243 and Node 22.23.3 | Supports RC-06 ("executable tests for the pilot environment") as historical evidence; shows that the §2.2 Playwright profile (project chromium, loopback SUT) is viable | Identity-bound to product 2.0.1 (release-contract §5 rule 4); not R1 qualification |
| Playwright closure measurements (187 files / 18.6 MB) | Inputs for the A2 limits | Re-measured at R1 qualification |
| Disposable-VM provisioning pattern: signed cloud image, cloud-init seed, no NIC, read-only copy-in, serial console | Template for the R1 VM build (§2.1) and the A9 transfer step | The R1 VM is Debian 13 and persistent; the pilot VM was Ubuntu 24.04 and disposable |
| Runner qualification procedure R1–R8, with independent assessor/approver separation | Structure for the prerequisite-6 independent environment assessment (Q7) | Its result was bound to the boot of a destroyed VM; not reusable as qualification |
| Stage 4 findings: record/apply bind root identity; apply needs an existing parent directory; `verify-applied-spec` is digest-only and portable | Drives A9 (approval/apply on the VM in the enrolled root) | Confirms that the pilot's host-copy apply model cannot feed OD-06 execution |
| Offline export pattern (read-only overlay read, MANIFEST, sealed evidence) | Runner retirement procedure (OD-06 §5.3 removal) and GC-6 evidence export | R1 runners are not destroyed per run |

**R1-specific obligations that stay open:**
- OD-06 host qualification on the R1 tuple (Q1–Q6);
- the independent environment assessment (Q7, prerequisite 6), including the nested-KVM hosting candidate;
- GC-1, three consecutive successful `qa-agent execute` runs on the exact release candidate in the qualified VM;
- GC-2, at least two negative scenarios (proposed: an unapproved or unapplied package → REFUSED; a spec mutated after apply → INPUT_MISMATCH 4; a forced timeout → TIMED_OUT 8 with empty proof; a Cypress request → INELIGIBLE);
- prerequisite 9 (`qa-agent-demo` through the supported `execute` surface);
- AISEC-7 scope for execute;
- the SADR-11 dossier for the execute capability;
- §19.1 L1–L7/I1–I5 dispositions.

---

## 6. Product Owner dispositions (PD-1..PD-7)

Recorded under `OD-R1-STAGE5-DESIGN-DISPOSITIONS-1 — APPROVED FOR REVIEW` (2026-11-26). A disposition marked "subject to review" becomes final only with the named independent review.

| PD | Question | Disposition | Effect in this amendment |
|---|---|---|---|
| PD-1 | Reading of RC-08 «ограничения путей» | **B — test write restrictions** | A7 is part of the amendment; G1 resolved for writes; read access remains R-5 |
| PD-2 | Bus/manager availability residual (C18, re-exec) | **A — fail-closed availability behaviour**, subject to Security review | A5 + A6; not integrity risk acceptance |
| PD-3 | Caller-authentication primitive (OD-06 §5.1 owner security decision) | **B — stdio socket peer credentials**, authentication design direction subject to Architecture/Security review | A3 |
| PD-4 | Framework/config scope | **Playwright Chromium**; one static, digest-pinned config; Cypress DEFERRED | A1, §2.2 |
| PD-5 | Execution environment | **Dedicated Debian 13 VM**; nested KVM within WSL2 is a **qualification candidate** | §2.1, A9, Q7 |
| PD-6 | Broker toolchain/distribution | **Rust + D1**, subject to Architecture review | A8 |
| PD-7 | Amendment form | **One consolidated OD-06 amendment** | This document |

Rationale for the options not selected (kept for the reviewers):

| PD | Not selected | Reason |
|---|---|---|
| PD-1 | A, controller path restrictions only | Would rest RC-08 "paths" on an interpretation; leaves test writes unrestricted |
| PD-3 | A, trust `SUDO_UID` under a qualified policy | Contradicts §5.1 "never ordinary SUDO_UID as account proof"; not kernel-attested |
| PD-3 | C, systemd socket activation (Accept=yes, SO_PEERCRED of the accepted connection) | Introduces a PID1-held listener, which conflicts with §4.1 "No listener/scheduler/background service" and would reopen OP-06-03; activation-socket identity limits (R6-C1 F1) |
| PD-3 | D, setuid helper or file capabilities | Forbidden by §5.2 |
| PD-6 | C, the C language | Smallest toolchain, but a root-run parser of untrusted frames without memory safety; L1 would rest on fuzzing alone |
| PD-6 | D2 / D3 (signed prebuilt binary / apt repository) | New signing and publication channel; belongs to OD-01/OD-03; beyond the R1 minimum |

---

## 7. Implementation readiness (plan only; each package needs separate authority)

### 7.1 Dependency-ordered work packages

| WP | Scope | Acceptance criteria | Reviews | Depends on | Effort (low confidence) |
|---|---|---|---|---|---|
| WP1 | This amendment: delivery, exact-head CI, consolidated HEAVY Architecture + Security review (§9), correctives, PO merge, post-merge certification | Both reviews APPROVED on the exact head; PO merge; certification | HEAVY Arch + HEAVY Sec | Dispositions (done) | 2–4 wk |
| WP2 | R1 VM and tuple on the PD-5 candidate: Debian 13 image provenance, partitions (W, state, B), accounts, Yama, sudoers, Node, Playwright/Chromium, Rust toolchain; loopback-only | Reproducible provisioning record; tuple builds captured; thick/non-CoW disk | Operator; Security spot-check | WP1 merged (or authorized in parallel) | 1–2 wk |
| WP3 | Broker core (Rust): framing/strict parser + fuzzing (L1), C1a integrity and A3 authentication, enrollment/compatibility (§5.4), §5.5/§5.6 checks, fingerprint (A2) | Unit tests, fuzz evidence; A3 negative vectors pass on the VM | Architecture + Security code review | WP1, WP2 | 3–4 wk |
| WP4 | Broker durable store: transactions, claims, tombstones, journal chain, recovery, Cases A–H, A5 ending, capacity bounds (L7) | Crash-injection tests at each S0–S6 row; torn-journal/replay vectors | Arch + Sec | WP3 | 2–3 wk |
| WP5 | Broker systemd control via sd-bus: closed property construction including A7, StartTransientUnit, readback, RefUnit, observation, stop/kill/empty proof (N5 anchor), P1S, workload mode, A6 classification | §12 lifecycle, kill, timeout, availability and A7 vectors (Q4–Q6) on the VM | Arch + Sec | WP4 | 3–4 wk |
| WP6 | Client: `execution-applied-binding` (gate-free §8.1), fingerprint, broker client over stdio sockets, framing, JUnit result parsing (§9.3/§9.4), record v2, CLI/config (A4), still disabled | Existing suites unchanged; new unit and installed-package tests; TSB-F02 trigger FALSE confirmed; package-surface review | Arch + Sec; productization surface review | WP1 (WP3 interface) | 2–3 wk |
| WP7 | Host qualification and adversarial campaign on the R1 VM: §12 C1–C5, Q1–Q6, L1–L7/I1–I5 dispositions; independent environment assessment (Q7) | Qualification evidence bound to the exact broker digest, product version and tuple; assessor ≠ author | Independent assessor; Security | WP5, WP6 | 2–4 wk |
| WP8 | Delivery: CI (Linux build/unit/fuzz; qualification evidence attached), reviews, merge, post-merge certification | Exact identities; CI green; reviews APPROVED | HEAVY per repository rules | WP7 | 1–2 wk |
| WP9 | Separate activation decision, then R1 qualification runs (GC-1 × 3, GC-2 ≥ 2) on the release candidate | Activation OD; evidence per release-contract §5 | PO; release review | WP8 | ~1 wk (part of R1 release qualification) |

### 7.2 Estimated effort

About **15–25 weeks** of calendar engineering time for the selected options (PD-1 = B, PD-6 = Rust), low confidence, with WP2 overlapping the WP1 review. It excludes TPR, the generation-side reviews and the other R1 prerequisites (AISEC-7, the Type & Schema audit, RC-12 distribution).

### 7.3 Remaining prerequisites (outside this amendment)

- OD-01/OD-03/OD-05 (distribution, version, upgrade), which interact with A8 (D2) and RC-12.
- Release prerequisites 1–3 and 11 for the execute capability.
- PO decision on whether `qa-agent-demo` (prerequisite 9) runs on the same VM (proposed: yes).

---

## 8. Open decisions

| Item | Owner | Status |
|---|---|---|
| PD-2 final (A5/A6 normative) | Independent HEAVY Security | Pending review |
| PD-3 final (A3 primitive, §7.2 wording) | Independent HEAVY Architecture + Security; Security owner per §5.1 | Pending review |
| PD-6 final (Rust + D1) | Independent HEAVY Architecture | Pending review |
| PD-5 hosting qualification (nested KVM in WSL2) | Independent assessor (Q7) | Pending qualification (WP7) |
| RQ-1..RQ-6 | Reviewers | Open (§9) |
| `qa-agent-demo` on the same VM (prerequisite 9) | PO | Proposed: yes |

---

## 9. Consolidated HEAVY review scope (Architecture + Security)

**One** independent exact-head review pass with two reviewers, Architecture and Security, on the PR head that adds this document.

**Review rule (reuse of accepted evidence):**
- The certified OD-06 sections 3–18, the accepted OD-04 boundary, R-1..R-5 and the §19.1 debt are **not re-reviewed**, except where a delta below amends them.
- The Stage 5 research facts (R2–R6, C17, C18, D4, D5) are reused by citation; the reviewer checks only that each delta is consistent with them.
- The PW-PILOT-1 Closure Record is accepted evidence for its own scope.
- No new experiments are required for this documentation review; qualification evidence belongs to WP7.

| # | Item | Architecture | Security |
|---|---|---|---|
| 1 | §1 RC-08 coverage and gap list: complete, no criterion reduced or reinterpreted | ✔ | ✔ |
| 2 | A1 scope overlay: no schema change; Cypress refusal path | ✔ | — |
| 3 | A2 fingerprint: file-set completeness for the qualified executable closure; browser-tree digest; refusal semantics; client derivability; P1S recheck | ✔ | ✔ |
| 4 | A3 caller authentication: kernel SO_PEERCRED/SO_PEERPIDFD semantics; sudo pass-through and `use_pty`; Node/libuv stdio-socket dependency; user-namespace mapping; ordering in C1a/R1a; §7.2 wording; negative vectors (§4.3) | ✔ | ✔ (owner decision §5.1) |
| 5 | A4 public surface: parser class, exit codes, config versioning (RQ-4), opt-in/removal, disabled until activation | ✔ | — |
| 6 | A5 RECONCILE ending: consistency with §6.4, §7.2 frame rules, §7.4 rows and §11.3 reasons | ✔ | ✔ |
| 7 | A6 availability classification: no new success path; quarantine semantics; re-exec operating rule; non-claim of the bus-socket hardening | ✔ | ✔ (PD-2) |
| 8 | A7 confinement: property semantics on systemd 257; readback; interaction with ExitType=cgroup and the empty proof; `--output`; scoped claim; negative vectors (§4.4) | ✔ | ✔ |
| 9 | A8 toolchain/distribution: Rust dependency budget, reproducibility claim, `brokerBuild` identity, D1 install path, L1 fuzzing | ✔ (PD-6) | ✔ |
| 10 | A9 operating flow: root identity, TAP-2 on the VM console, transfer verification, no credentials in the VM | ✔ | ✔ |
| 11 | §2.3 R3 omission: keeping RefUnit on the system bus | ✔ | ✔ |
| 12 | §4 invariants and trust-boundary table: completeness; no weakening; no new risk acceptance | ✔ | ✔ |

**Review questions:**

| RQ | Question |
|---|---|
| RQ-1 | Is fd 0 = fd 1 peer equality plus the pidfd liveness check sufficient, or must the broker also bind the peer's start time? |
| RQ-2 | Should `closefrom=3` and `!use_pty` be qualification checks only, or literal requirements in the §5.1 rule text? |
| RQ-3 | Is `ProtectHome=tmpfs` compatible with HOME inside the attempt leaf on B, or should `ReadWritePaths` cover B explicitly? |
| RQ-4 | Config: an additive optional key in v1, or a config v2? |
| RQ-5 | Should the A2 file set also include `node_modules/.package-lock.json`? |
| RQ-6 | Do the post-OD-06 OD-265 planning changes (multi-plan packages, per-candidate attempts) alter any OD-06 §8.1 binding assumption (exactly one apply attempt per package; ALL specs)? |

Expected outcome per reviewer: APPROVED or CHANGES REQUIRED with severity-classified findings. Correctives are applied as later commits on the same branch under separate authority.

---

## 10. Non-claims

This document:
- implements nothing;
- does not enable `execute`;
- does not authorize Stage 5, activation, release or merge;
- does not accept, waive, close or re-rate any risk or finding (R-1..R-5, AT-07/TB-01, TSB-F02, §19.1);
- does not change OD-04, RC-01..RC-12, GC-1..GC-6 or the release prerequisites;
- makes no sandbox claim beyond A7 as scoped;
- makes no provider call or pilot run.

The design-time observations it cites are design inputs, not qualification:
- the Node stdio socket behaviour;
- the Playwright tree sizes.
