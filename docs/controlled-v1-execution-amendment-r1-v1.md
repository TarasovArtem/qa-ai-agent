# Controlled-v1 OD-06 execution contract — R1 amendment v1 (STAGE5-DESIGN-AMENDMENT-1)

Status: **WP1 DESIGN MERGED / POST-MERGE CERTIFIED — documentation only.**

Review state:
- The HEAVY Architecture + Security review of the WP1 head returned three MAJOR findings (C1-F1..C1-F3).
- Corrective C1 is applied (§11).
- The Architecture delta review of C1 returned CHANGES_REQUIRED (ARCH-C1-N1, ARCH-C1-N2, plus the minor items S2 and S3).
- Corrective C2 is applied (§12); Architecture and Security delta reviews APPROVED on exact HEAD `4af2617d048a85b55dfce7bd18fa28e8fb985495`.

WP1 passed its design review, separate PO merge and post-merge certification gates (see §13). The amendment is the approved R1 design overlay to OD-06 sections 3–18; it establishes no runtime qualification or implementation authority. Here OD-06 means [`controlled-v1-execution-contract-v1.md`](controlled-v1-execution-contract-v1.md).

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
OD-R1-STAGE5-WP1-C1                      — APPROVED             2026-11-26
OD-R1-STAGE5-WP1-C2                      — APPROVED             2026-11-26
OD-R1-STAGE5-WP1-MERGE                   — APPROVED             2026-11-26
OD-R1-STAGE5-WP1-CLOSURE                 — APPROVED             2026-11-26
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

OD-06 defines a complete, certified execution-controller design: a scoped root broker, a transient systemd service, cgroup v2 lifecycle and protected reconciliation. Stage 5 implementation stopped on 2026-10-15 at four contract insufficiencies (DG-1..DG-4). Later research added three needs on the system-bus path: a defined RECONCILE ending for unresolved recovery (R5), an availability classification for bus reply loss (C18) and manager re-exec handling (R3/R6).

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
| A5 | RECONCILE response semantics: committed-result preservation, finalization and the incomplete-recovery ending | R5 blocker | PD-2 = A |
| A6 | Classification of bus/manager availability loss by lifecycle phase: fail-closed, never PASS, consumption fixed at the reservation commit | C18, R3/R6 re-exec | PD-2 = A, subject to Security review |
| A7 | Workload filesystem-write confinement to an enumerated, bounded set of writable locations | RC-08 "paths" gap (G1) | PD-1 = B |
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
| **Paths — what the test process tree may write** | A7: filesystem writes are confined to the enumerated permitted set (A7.1):<br>• the attempt leaf;<br>• unit-private, size-bounded `/tmp`, `/var/tmp` and `/dev/shm`.<br>Every other location — including the enrolled root, the host `/tmp` and `/dev/shm`, `/dev/mqueue`, and the host filesystem reached through procfs links of processes outside the unit — is read-only, hidden or inaccessible to the workload | systemd mount and user namespaces with fixed properties; broker readback; qualification enumeration, write-probes and cross-process procfs probes (Q5) | COVERED by design through A7 (PD-1 = B), subject to review. The runtime guarantee is NOT verified: Q5 is OPEN (A7.5). Read access, network and SUT authority remain R-5 (§2.5) |
| **Commands** | Fixed adapter `od06-playwright-v1`: Node argv built by the broker, no shell, no `.bin`/npx/npm script/PATH lookup; exact `sudo -n -- broker` with zero argv; one sudoers rule; closed transient-property allowlist; NoNewPrivileges; capabilities 0; no manage-units or systemctl authority for the runner (§4.1, §5.1, §6.1, §8.2) | Broker, sudoers, systemd | COVERED; the caller-authentication primitive is A3 (PD-3 = B), subject to review |
| **Environment** | Inherited environment cleared in native workload mode; fixed REQUIRED/ALLOWED set; enrolled `SUT_*` allowlist ≤32; credentials stripped; secrets never in unit properties, argv or journal (§6.1, §9.1); the qualified Node/Playwright/Chromium tuple is bound by fingerprint and profileDigest (§8.2, A2) | Broker, workload mode | COVERED; config surface A4 |
| **Execution time** | `timeoutMs` 1000..600000 from the target config only; RuntimeMaxUSec; SIGTERM → SIGKILL over the whole cgroup; empty-cgroup proof; finite phase budgets P0–P6; timeout → 8 only with exact manager deadline facts; unproven cleanup → QUARANTINED 7 (§6.3, §6.4) | systemd manager, broker | COVERED |
| **RC-07 coupling** | Execution only of applied approved bytes; gate-free reconstruction of the whole Stage 4 chain; one consumption per (root, run, ordinal) and (root, package, apply record); no retry (§7, §8.1) | Client plus broker; OD-04 unchanged | COVERED |

"COVERED" in this table means covered by design: certified OD-06 design or a delta of this amendment. No row is a runtime-verified guarantee. Runtime verification is the qualification Q1–Q7 (§2.4, WP7), which stays OPEN.

### 1.2 Gaps in the certified design and their resolution

| Gap | Description | Resolution |
|---|---|---|
| G1 | RC-08 "ограничения путей" can be read as controller path restrictions (provided by OD-06) or as filesystem confinement of the executed test (explicitly not provided by OD-06; R-5 ACCEPTED) | PD-1 = B: both readings are satisfied by design for filesystem writes through A7. The permitted writable set is closed by design (A7.1). Its mandatory qualification acceptance criteria are Q5, which stays OPEN until run on the qualified tuple. Read access remains R-5 and is documented (§2.5) |
| G2 | Availability loss on the system bus (C18): the untrusted test runs as the runner uid and can overfill the broker's dbus-daemon queue, so a manager reply is dropped. The result is QUARANTINED / CLEANUP_UNPROVEN 7. A dedicated host does not remove this actor | PD-2 = A: A6 phase classification (consumption fixed at the reservation commit) + A5 recovery semantics, subject to Security review |
| G3 | §5.1 requires unforgeable caller-authentication metadata from sudo, "never ordinary SUDO_UID", but names no primitive (Stage 5 STOP 2) | PD-3 = B: A3 |
| G4 | `bindingDigest` includes `fingerprintDigest`, but the fingerprint file set has no client-derivable algorithm and lives in root-only enrollment (Stage 5 STOP 1) | A2 |
| G5 | `execute` CLI grammar and `execute` config are "later separately approved" (§4.2) (Stage 5 STOP 4) | A4 |
| G6 | Native broker language, toolchain, build and distribution are unspecified (§5.3; Stage 5 STOP 3) | PD-6 = Rust + D1: A8 |
| G7 | RECONCILE has no defined ending meaning "unresolved after a write, try later" (R5), and committed-result preservation on RECONCILE is stated only indirectly (OD-06 §7, §7.4 S5/S6) | A5: an explicit committed-result preservation rule plus an incomplete-recovery ending that reuses the existing OD-06 no-final-frame / exit-7 semantics; REFUSED keeps its OD-06 pre-action meaning |
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
  - I5: the write part is addressed by the A7 design; I5 stays OPEN until qualification and review dispositions.
- **Q3.** A3 negative vectors (§4.3).
- **Q4.** A6/A5 availability vectors, one per phase row of the A6.2 table, each yielding exactly the outcome, consumption state and evidence of that row:
  - a bus flood or lost manager reply during P1 (pre-create recovery, namespace scan) → REFUSED/INELIGIBLE, or REFUSED/RECOVERY_BUDGET_EXHAUSTED only when budget A is exhausted (A6.2), nothing reserved;
  - during the P1S failure-path no-send proof → PRESUBMIT_FAILURE or QUARANTINED, consumed;
  - during start, observation and stop → CONTROLLER_FAILURE or QUARANTINED, consumed;
  - during P6 release → committed outcome unchanged, claims retained;
  - daemon-reexec and daemon-reload during an attempt;
  - a lost StartTransientUnit reply;
  - RECONCILE of a committed attempt (A5.1) → record returned unchanged; client exit 8 for TIMED_OUT, otherwise 7; never 0 or 10;
  - RECONCILE that cannot obtain facts (A5.3).
- **Q5.** A7 qualification (A7.4):
  - property readback;
  - writable-location enumeration equal to the permitted set;
  - write-probes outside the set fail;
  - unit-private locations are discarded with the unit;
  - size bounds hold;
  - Playwright runs unchanged with `--output`;
  - the empty proof, timeout semantics and OD-06 §6.1 UID checks are unchanged;
  - cross-process procfs probes: no host location is reachable or writable through `/proc/<pid>/root`, `/proc/<pid>/cwd` or `/proc/<pid>/fd/*` of a runner-uid process outside the unit.

  All Q5 criteria are mandatory acceptance criteria. Until every one passes on the qualified tuple, the A7.5 guarantee is a design target, not a verified property.
- **Q6.** F19 / N-04 bounded termination on Linux: the §6.3 empty proof under fork bombs, setsid, nested cgroups and uninterruptible tasks.
- **Q7.** The independent environment assessment (release prerequisite 6), by an assessor other than the author, covering the PD-5 hosting candidate.

### 2.5 Limitations (to be documented for GC-6)

- No malicious-test sandbox. Tests keep:
  - read access to the host filesystem, except `/home`, `/root` and `/run/user`, which A7 hides;
  - network and SUT authority (R-5).

  A7 restricts filesystem writes only (A7.1).
- Kernel pseudo-filesystem interfaces (procfs, sysfs, cgroupfs) are not storage locations.
  - A7 makes `/proc/sys`, `/sys` and cgroupfs read-only for the workload.
  - Per-process procfs links of processes **outside** the unit (`/proc/<pid>/root`, `cwd`, `fd`) are path-resolution routes into the host filesystem, not pseudo-files. Yama `ptrace_scope` restricts attach-mode access only, and A7 does not rely on it here.
    - The A7.2 user namespace (`PrivateUsers`) is the proposed control that denies these links for every process outside the unit, the attached client included.
    - Q5 must verify this (A7.4 criterion 8).
  - Per-process procfs entries of the workload's own processes are not storage locations.
- A7 confines the filesystem writes of the executed test process tree. It does not make a cooperating same-account process outside the unit refuse a request to write on the workload's behalf (for example over a socket). That vector is the existing same-account residual (R-3/R-4, L4 account inventory). It is unchanged and is not newly accepted here.
- RECONCILE never reports success. Exit 0 or 10 comes only from the attached `--run` invocation (OD-06 §7.2); a RECONCILE of a committed PASSED or TEST_FAILED attempt exits 7 (A5.1).
- No authenticated physical-human approval (R-1/R-2); approval provenance is the OD-04 TAP-2 OS-local principal.
- One VM, one root profile, one framework; no CI execution; no Windows or macOS execution.
- Availability (A6):
  - A bus or manager disturbance **before** the reservation commit refuses the request without consuming it; it may be retried after remediation.
  - A disturbance **after** the reservation commit ends in EXECUTION_ERROR or QUARANTINED. The attempt is consumed, and re-execution needs a fresh generation/approval cycle (no retry, by design).
- `execute` stays a reserved refusal until a separate activation decision.

### 2.6 Refusal conditions (all fail-closed; before any spawn unless stated)

These are the OD-06 conditions, unchanged, plus R1:
- Windows, macOS, WSL2 itself, containers or a generic or unqualified host → refused (reserved exit 5 / INELIGIBLE).
- Framework ≠ playwright, or project ≠ chromium → INELIGIBLE 5.
- Live fingerprint ≠ enrolled fingerprint (config or package change) → INELIGIBLE 5.
- Client fingerprint ≠ broker live recomputation → INPUT_MISMATCH 4.
- Caller-authentication failure under A3 → REFUSED/CALLER_REFUSED 5 (at C1a/R1a).
- An A7 property not supported by the qualified manager → INELIGIBLE 5.
- A workspace anchor or root located beneath a path that A7 hides or replaces (A7.3) → enrollment refused; a persisted violation → INELIGIBLE 5.
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
- Exit codes are the existing OD-06 mapping:
  - 0 PASSED and 10 TEST_FAILED, only from a `--run` invocation (OD-06 §7.2);
  - 8 TIMED_OUT;
  - 7 EXECUTION_ERROR/QUARANTINED/synchronous orphan, including the A5.3 incomplete RECONCILE and a RECONCILE of a committed PASSED or TEST_FAILED attempt (A5.1);
  - 5 REFUSED/INELIGIBLE/disabled;
  - 4 INPUT_MISMATCH;
  - 3 config.

  A `--reconcile` invocation never exits 0 or 10.

Until activation the command stays the reserved fixed refusal (exit 5). `execute --help` stays help-only.

**A4.2 Config (target opt-in).** An optional closed top-level key, `execute: {timeoutMs, sutEnvironmentNames}`:
- `timeoutMs` is an integer 1000..600000, default 600000 when the key is absent but execution is enabled;
- `sutEnvironmentNames` holds ≤32 unique `SUT_[A-Z][A-Z0-9_]{0,59}` names and must be a subset of the root enrollment `sutNames`.

Execution additionally requires `capabilities.execute = true` (existing, schema-valid) and, after activation, `RELEASE_CAPABILITIES.execute.enabled = true`.

Runtime values come only from the named caller environment entries; a missing entry refuses, and an empty value is allowed.

The versioning choice (an additive optional key in config v1 versus config v2) is RQ-4. The proposal is an additive optional key, rejected by product versions without execute support.

### A5 — RECONCILE response semantics (§7, §7.2, §7.4, §11.3) — R5 (PD-2 = A)

A5 keeps every OD-06 RECONCILE rule and closes the gap R5 found: there is no defined ending for "unresolved after a write". It introduces **no** new frame, disposition, reason, state or exit code.

**A5.1 Committed-result preservation.**
- RECONCILE of an attempt whose terminal journal entry is committed (PASSED, TEST_FAILED, TIMED_OUT, EXECUTION_ERROR or QUARANTINED) returns, at frameSequence 0:
  - TERMINAL for the first four, or QUARANTINED;
  - carrying **exactly** the committed record v2 and reason, with an unchanged `recordDigest` and `attemptDigest` equal to the committed terminal entry.
- The broker performs no re-observation, re-classification, re-parsing or manager action for that attempt. The only exception is idempotent P6 release recovery: ResetFailedUnit, UnrefUnit, leaf removal and claim release.
- A release failure does not change the returned outcome; claims are retained per §7.4 S6.
- A later inconsistency is a separate quarantine incident and never rewrites the committed record (OD-06 §7).
- The client applies the unchanged OD-06 §7.2 client-side checks and verifies the record digest and `record.executionId` against the requested ID. A failed check takes the existing client-side violation path (exit 7).
- **Client exit code (OD-06 §7.2, §7.3, §9.3; unchanged).** A RECONCILE invocation never exits 0 or 10.
  - OD-06 §7.2 permits 0 or 10 only from a validated TERMINAL whose binding equals the client binding and whose invocationId equals BOUND.
  - A RECONCILE invocation has neither. Its request carries no binding (OD-06 §4.2 reconcile keys: executionId only), and it has no BOUND frame (its single structural frame is frameSequence 0).
  - The OD-06 §7.3 orphan/reconcile exit set therefore applies:
    - committed TIMED_OUT → 8;
    - committed EXECUTION_ERROR or QUARANTINED → 7;
    - committed PASSED or TEST_FAILED → 7. The invocation reports no success and no test failure. The committed outcome itself stays as recorded and is never re-labelled, re-derived or re-committed.
- The only path that reports PASSED (0) or TEST_FAILED (10) stays the attached CREATE invocation: OBSERVED + accepted proposal + fsynced terminal + client-validated TERMINAL (OD-06 §7.4). A CREATE whose final frame was lost exits 7 (OD-06 §7.4 S5). A later RECONCILE does not turn that into a success exit.
- At broker level this states OD-06 §7 ("Valid durably committed terminal result returns as recorded") and §7.4 S5/S6 explicitly. It adds no success path, exit code, frame, output field or client validation rule.

**A5.2 Finalization of an incomplete attempt (unchanged).** When the required manager facts are obtainable, RECONCILE applies OD-06 Cases A–H:
- TERMINAL EXECUTION_ERROR 7;
- proven TIMED_OUT 8;
- or QUARANTINED 7.

RECONCILE never yields PASSED or TEST_FAILED for an attempt it finalizes.

**A5.3 Incomplete-recovery ending (new normative rule, existing mechanism).** When a required manager fact cannot be obtained within the §6.3 reconcile bound and no proven QUARANTINED condition holds:
1. the broker keeps the durable transitions this invocation has already fsynced (for example ORPHANED, admission closed);
2. it writes nothing that implies an outcome;
3. it emits **no final frame** and exits.

The client applies the existing OD-06 §7.2 rule "EOF before a final frame → exit 7 (synchronous orphan)" and reports the attempt as unresolved.

This is the OD-06 post-submit-uncertainty class (§5.2, exit 7). It is durably identical to a broker crash at the same point (§7.4):
- the state is the last fsynced journal entry;
- the attempt stays consumed;
- claims and tombstones are retained;
- a later RECONCILE or the next CREATE P1 continues it.

**A5.4 REFUSED keeps its OD-06 meaning.** RECONCILE answers REFUSED only for pre-action refusals, with no journal write and no manager action. Examples:
- malformed intake;
- R1a authentication failure;
- N1–N6 or F2 failure;
- a non-owner caller;
- an unknown execution ID.

REFUSED carries a null `attemptDigest` and a null record (§7.2, §11.3, unchanged). REFUSED never follows a journal write. The earlier design proposal "REFUSED/RECOVERY_BUDGET_EXHAUSTED after writes" is withdrawn; it conflicted with these rules and with the exit-7 class of §5.2.

**A5.5 CREATE pre-create reconciliation (unchanged).** Inside P1, reconciliation of prior incomplete attempts commits per attempt. If it cannot complete within the global budget A, the **new** request gets REFUSED/RECOVERY_BUDGET_EXHAUSTED exit 5 before its reservation. Nothing is reserved for that request. Earlier attempts keep their individually durable progress (OD-06 §6.4).

### A6 — Availability classification by lifecycle phase (§6.3, §6.4, §7.3, §7.4, §11.3) — C18, re-exec (PD-2 = A)

**A6.1 Availability events.** On the qualified system bus, the following are availability events:
- (a) no reply to a manager method call within its phase bound;
- (b) a LimitsExceeded or other bus error on a manager call;
- (c) loss of the broker's bus connection;
- (d) PropertiesChanged signals not delivered;
- (e) a change of the manager's system-bus unique owner (`managerId`) during an attempt, for example `daemon-reexec`.

An availability event is **never** evidence of success, failure, timeout, launch or cleanup. Outcomes come only from facts actually obtained. Where a timeout is proven by obtained manager facts, the existing TIMED_OUT precedence applies unchanged.

**A6.2 Consumption point and phase outcomes.** An attempt is consumed **exactly** at the durable reservation COMMITTED marker (OD-06 §6.4, the origin of P1S):
- before that marker, no availability event consumes anything;
- after it, no availability event un-consumes, resets or permits a retry;
- tombstones are always retained.

| Phase (last durable state) | Where an availability event can occur | Outcome | Consumption | Mandatory evidence |
|---|---|---|---|---|
| P0 intake | None (no manager call) | — | — | — |
| P1, before the reservation COMMITTED marker | Pre-create recovery and reconciliation of prior attempts, the runner unit-namespace scan, unit preexistence checks | REFUSED exit 5 for the new request. The reason is RECOVERY_BUDGET_EXHAUSTED only when the global budget A is exhausted (OD-06 §6.4); otherwise it is INELIGIBLE, because controller eligibility (OD-06 §6.4 P1) is not established | **Not consumed**; nothing reserved for this request; retry permitted after remediation | No record for the new request; per-attempt durable progress of prior attempts (§6.4) |
| P1S (PREPARED, submission NOT_SENT) | P1S makes no manager call (OD-06 §6.4). An event can occur only in the failure-path no-send / no-unit / clean-namespace proof | Proof obtained → EXECUTION_ERROR PRESUBMIT_FAILURE 7; proof not obtained → QUARANTINED 7 | **Consumed** | Record v2 with `cleanup.emptyBy = not-submitted`; or a QUARANTINED record with incident and retained claims |
| P2–P4 (SUBMITTING, CONTROLLER_BOUND, STARTED, until OBSERVED) | Start, readback, observation, stop/kill and empty confirmation | Empty proof (§6.3, N5 anchor) and manager terminal facts obtained → EXECUTION_ERROR CONTROLLER_FAILURE 7, or proven TIMED_OUT 8; otherwise → QUARANTINED CLEANUP_UNPROVEN or STATE_INCONSISTENT 7 | **Consumed** | Record v2 with non-null cleanup; or a QUARANTINED record with incident and retained claims |
| P5 (OBSERVED; EXITED sent) | Only in later release; observation and empty proof are already durable | The §7.2/§9.3 result rules apply unchanged | **Consumed** | As in OD-06 §7.4 S4/S5 |
| P6 (terminal committed) | Release (ResetFailedUnit, UnrefUnit) | The committed outcome stands; claims are retained until a later release recovery | **Consumed** | Committed record unchanged (A5.1) |
| RECONCILE (any incomplete state) | Any fact-gathering call | A5.2 or A5.3; QUARANTINED when ambiguity is proven | **Consumed** (already reserved) | As A5 |

**A6.3 Manager re-exec.** A `managerId` change (e) stays STATE_INCONSISTENT → QUARANTINED; there is no identity relaxation.

The R1 operating rule forbids the following while any attempt is incomplete, and qualification tests it (Q4):
- `daemon-reexec`;
- `daemon-reload`;
- systemd or dbus package upgrades.

**A6.4 Non-claims.** No availability event may produce PASSED or TEST_FAILED, or a reset or retry of a consumed attempt. The classification is **not** acceptance of an integrity risk; it becomes normative only with HEAVY Security approval.

Hardening, research only and **not** claimed: inside the A7 workload mount namespace, `InaccessiblePaths=/run/dbus/system_bus_socket` could remove the in-unit flood actor. Its sufficiency is NOT PROVEN. It would depend on the qualified A7 user-namespace control removing same-uid routes such as `/proc/<pid>/root` of runner processes outside the unit (A7.4 criterion 8), and on routes outside the filesystem. It is not an R1 prerequisite.

### A7 — Workload filesystem-write confinement (§3, §5.2, §6.1, §8.2, §12) — PD-1 = B

**A7.1 Permitted writable set (normative).** For the executed test process tree, a filesystem location is writable **only** if it is one of:

| # | Location | Lifetime | Bound |
|---|---|---|---|
| P1 | The attempt leaf `/var/lib/qa-agent-workload-v1/workloads/<executionId>` (its `home`, `tmp` and `reports` subdirectories and the Playwright `--output` directory `test-results`) | Until P6 leaf removal | Workload mount B (OD-06 §5.6.3: maxBytes, minFreeBytes) |
| P2 | Unit-private `/tmp` | Discarded when the unit's mount namespace ends | Fixed tmpfs size, A7.2 |
| P3 | Unit-private `/var/tmp` | Same | Fixed tmpfs size, A7.2 |
| P4 | Unit-private `/dev/shm` (needed by Chromium) | Same | Fixed tmpfs size, A7.2 |

Every other filesystem location is read-only, hidden or inaccessible to the workload. This includes:
- the enrolled root and workspace anchor;
- other attempt leaves and B itself;
- controller state, `/etc`, `/usr` and `/var`;
- `/run`, including `/run/lock` and `/run/user`;
- `/home` and `/root`;
- the host's `/tmp`, `/var/tmp`, `/dev/shm` and `/dev/mqueue`;
- every host location reached through a procfs link (`/proc/<pid>/root`, `/proc/<pid>/cwd`, `/proc/<pid>/fd/*`) of a process outside the unit, including the attached client and every other runner-uid process.

The requirement is on locations, not on paths: a location is permitted only if it is in P1–P4, whatever path reaches it.

Writes to device nodes (for example `/dev/null`) create or modify no file and are not storage locations. Kernel pseudo-filesystems are covered in §2.5 and A7.2.

**A7.2 Property set (OD-06 §6.1 allowlist additions; fixed values, broker-built, read back).**

| Property | Signature | Fixed value |
|---|---|---|
| `ProtectSystem` | s | `strict` |
| `ProtectHome` | s | `tmpfs` (read-only empty tmpfs over `/home`, `/root`, `/run/user`) |
| `ReadWritePaths` | as | `[<attempt leaf>]` |
| `TemporaryFileSystem` | a(ss) | `[("/tmp","mode=1777,nosuid,nodev,size=268435456"), ("/var/tmp","mode=1777,nosuid,nodev,size=268435456"), ("/dev/shm","mode=1777,nosuid,nodev,noexec,size=268435456")]` |
| `InaccessiblePaths` | as | `["-/dev/mqueue"]` |
| `PrivateIPC` | b | `true` |
| `ProtectKernelTunables` | b | `true` |
| `ProtectControlGroups` | b | `true` |
| `PrivateUsers` | b | `true` (minimal mapping: root and the unit's own user and group map to themselves; every other ID maps to nobody) |

- `PrivateUsers` is the proposed control for the cross-process procfs routes of A7.1. Following the OD-06 §6.1 workload identity, the workload runs as the enrolled runner uid, which is the uid of the attached client.
  - Without a user namespace, a same-uid process outside the unit can be addressed through `/proc/<pid>/root`, `cwd` and `fd`, and path resolution then continues in that process's host mount namespace.
  - Those links need only ptrace read access. Yama does not restrict read access.
  - Under Linux capability rules, read access to a process in another user namespace needs `CAP_SYS_PTRACE` in that process's namespace. The workload has no capabilities (OD-06 §6.1), so the links are denied for every process outside the unit.
  - This is a design statement, not a verified property; A7.4 criterion 8 verifies it.
- A private PID namespace (`PrivatePIDs`) was considered and is not proposed. It would make the Node main process PID 1 of its namespace, and that changes the OD-06 §6.3/§7.3 behaviour on SIGTERM delivery and on lingering descendants when the main process exits.
- `PrivateTmp` is **not** used. Its backing directories live on the host root filesystem, outside every bound. `TemporaryFileSystem` gives private, memory-backed, size-bounded locations that are charged to the unit cgroup and discarded with the unit.
- The sizes are fixed literals. Changing them needs an amendment, never enrollment or a request.
- HOME, TMPDIR and reportsDir stay inside P1 (§9.1).
- OD-06 §6.1 "No further writable property extension/sandbox/quota claim" is replaced by: "The writable property set is exactly §6.1 plus the A7.2 list; no further extension or sandbox claim."

**A7.3 Placement constraints (enrollment, §5.2).** The workspace anchor W, every enrolled root and B must not be located beneath any path that A7.2 hides or replaces: `/home`, `/root`, `/run/user`, `/tmp`, `/var/tmp`, `/dev/shm` or `/dev/mqueue`.
- Enrollment refuses such a placement.
- A persisted violation makes every create INELIGIBLE (exit 5) before reservation.
- This matches the OD-06 rule that W is never a home directory.

**A7.4 Enforcement and qualification.**
- **Before reservation (P1).** The qualified manager build must support every A7.2 property with the fixed values; otherwise → INELIGIBLE 5, with nothing reserved.
- **After start (P2).** In the OD-06 §4.3 item 7 actual-property readback, the broker compares the read-back A7.2 properties with the fixed values of the broker-built payload. OD-06 computes `propertiesDigest` over that payload in P1S (§6.4, §11.1); the readback does not produce it. A mismatch is a controller failure → CONTROLLER_FAILURE 7 if empty proof is obtained, otherwise QUARANTINED 7. The attempt is consumed, as in the A6.2 P2–P4 row.
- **Qualification (Q5), each required for eligibility:**
  1. property readback equals A7.2;
  2. from inside a qualification unit built by the broker with the same property set, the set of locations writable by the runner uid, enumerated from `/proc/self/mountinfo` and the directory permissions, equals exactly P1–P4;
  3. write and create probes against every location listed under A7.1 "every other" fail;
  4. after the unit ends, nothing written to P2–P4 remains, and the host `/tmp`, `/var/tmp` and `/dev/shm` are unchanged;
  5. writing beyond each P2–P4 size bound fails with no effect outside the unit;
  6. a Playwright fixture runs unchanged with `--output=<leaf>/test-results` and writes only inside P1–P4;
  7. the empty proof and timeout semantics (§6.3) and the OD-06 §6.1 UID and workload-root checks are unchanged with the profile active;
  8. from inside the qualification unit, while a runner-uid fixture process outside the unit holds a writable host working directory and an open writable host file descriptor, every open, create and write attempt through `/proc/<pid>/root`, `/proc/<pid>/cwd` and `/proc/<pid>/fd/*` of that process (and of the attached client) fails, and the host locations are unchanged.

  Criterion 2 enumerates the unit's own mounts and cannot see routes through other processes, so criterion 8 is required in addition to it.

  Any additional writable location found makes the host **INELIGIBLE**. The permitted set is never widened by qualification.
- **§8.2 Playwright argv.** Add the fixed entry `--output=<leaf>/test-results`.

**A7.5 Guarantee (§3, scoped) — design target, not runtime-verified.**

> "The executed test process tree can create, modify or delete files only inside its attempt leaf and its unit-private, size-bounded `/tmp`, `/var/tmp` and `/dev/shm`. Read access to the host filesystem (except the A7.2-hidden paths), network and SUT authority remain (R-5)."

| Element | Status |
|---|---|
| Requirement (A7.1 permitted set P1–P4) | Normative once this amendment is approved; unchanged by C2 |
| Controls (A7.2 property set, A7.3 placement, A7.4 enforcement) | PROPOSED; subject to HEAVY Architecture and Security review |
| Runtime guarantee (the quoted statement) | NOT VERIFIED. It may be claimed (GC-6, release documentation) only after every A7.4 criterion 1–8 has passed on the qualified tuple (Q5, WP7). Until then Q5 and I5 stay OPEN |

- The quoted statement covers writes by the process tree itself. A same-account process outside the unit that writes on the tree's request stays the existing R-3/R-4 / L4 residual (§2.5). It is not newly accepted.
- R-5 stays ACCEPTED. A7 narrows its write part and does not replace it.
- I5 stays OPEN until its qualification disposition (Q2).
- The broker's own §5.6 namespace checks concern the broker, so the workload's private mount, IPC and user namespaces do not affect them. MainPID and cgroup observation are unaffected.

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
| TBΔ-2 | Availability loss on the system bus is classified by lifecycle phase (A6.2). The consumption point is fixed at the reservation commit. RECONCILE gets explicit committed-result preservation and an incomplete-recovery ending that reuses the existing no-final-frame / exit-7 semantics (A5) | Clarifies; no new success path, frame, disposition, reason or exit code | None. Not integrity risk acceptance | PD-2 = A; HEAVY Security |
| TBΔ-3 | Workload filesystem-write confinement to the enumerated permitted set P1–P4 (A7), including a workload user namespace against cross-process procfs routes; proposed controls, runtime guarantee pending Q5 | Adds containment; narrows R-5 (write part) | Positive | PD-1 = B |
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

- **Denied writes.** A workload write or create is denied for each of:
  - the enrolled root and the workspace anchor;
  - another attempt leaf and B itself;
  - `/var/lib/qa-agent-controller-v1`, `/etc`, `/usr` and `/var`;
  - `/run`, `/run/lock` and `/run/user/<uid>`;
  - `/home` and `/root`;
  - `/dev` and `/dev/mqueue`;
  - the host's `/tmp`, `/var/tmp` and `/dev/shm`.
- **Unit-private locations.**
  - Writes to `/tmp`, `/var/tmp` and `/dev/shm` are invisible outside the unit and gone after it ends.
  - Exceeding their size bound fails inside the unit only.
- **Enumeration.** The writable-location enumeration inside the unit returns exactly P1–P4; any extra location → host INELIGIBLE.
- **Hidden paths.** `/proc/sys`, `/sys` and cgroupfs writes are denied (ProtectKernelTunables, ProtectControlGroups).
- **Cross-process procfs.** Open, create and write through `/proc/<pid>/root`, `/proc/<pid>/cwd` and `/proc/<pid>/fd/*` of the attached client and of a runner-uid fixture process outside the unit fail, and the host locations are unchanged (PrivateUsers, A7.4 criterion 8).
- **Readback.** An A7.2 property that is unsupported → INELIGIBLE before reservation; a readback mismatch after start → CONTROLLER_FAILURE or QUARANTINED (consumed).
- **Placement.** A workspace anchor, root or B placed beneath an A7.3 path → enrollment refused.
- **Playwright output.** Playwright writing `test-results` without `--output` fails qualification.
- **Lifecycle.** The empty proof and timeout semantics are unchanged with the profile active.

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
| PD-1 | Reading of RC-08 «ограничения путей» | **B — test write restrictions** | A7 is part of the amendment: an enumerated permitted writable set P1–P4 (A7.1) with qualification (A7.4); G1 addressed by design for filesystem writes (Q5 OPEN); read access remains R-5 |
| PD-2 | Bus/manager availability residual (C18, re-exec) | **A — fail-closed availability behaviour**, subject to Security review | A6 phase classification, consumption at the reservation commit, A5 recovery semantics; not integrity risk acceptance |
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
| WP4 | Broker durable store: transactions, claims, tombstones, journal chain, recovery, Cases A–H, A5 RECONCILE semantics (A5.1 preservation, A5.3 incomplete ending), A6.2 consumption point, capacity bounds (L7) | Crash-injection tests at each S0–S6 row; torn-journal/replay vectors | Arch + Sec | WP3 | 2–3 wk |
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
| RQ-1..RQ-7 | Reviewers | Open (§9) |
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
| 6 | A5 RECONCILE semantics: committed-result preservation (A5.1) with the OD-06 reconcile exit set (never 0 or 10); incomplete-recovery ending through the existing no-final-frame / exit-7 rule (A5.3); REFUSED kept pre-action (A5.4); consistency with §5.2, §6.4, §7.2, §7.4 and §11.3 | ✔ | ✔ |
| 7 | A6 availability classification: the consumption point at the reservation commit; the phase table (A6.2) against §6.4/§7.4; mandatory evidence per row; no new success path; re-exec operating rule; non-claim of the bus-socket hardening | ✔ | ✔ (PD-2) |
| 8 | A7 confinement: the permitted writable set P1–P4 (A7.1); property semantics on systemd 257 (A7.2), including `PrivateUsers` against cross-process procfs routes and its interaction with Node/Chromium; placement constraints (A7.3); readback, qualification enumeration and criterion 8 (A7.4); the design-target status of the guarantee (A7.5); interaction with ExitType=cgroup and the empty proof; `--output`; scoped claim (A7.5); negative vectors (§4.4) | ✔ | ✔ |
| 9 | A8 toolchain/distribution: Rust dependency budget, reproducibility claim, `brokerBuild` identity, D1 install path, L1 fuzzing | ✔ (PD-6) | ✔ |
| 10 | A9 operating flow: root identity, TAP-2 on the VM console, transfer verification, no credentials in the VM | ✔ | ✔ |
| 11 | §2.3 R3 omission: keeping RefUnit on the system bus | ✔ | ✔ |
| 12 | §4 invariants and trust-boundary table: completeness; no weakening; no new risk acceptance | ✔ | ✔ |

**Review questions:**

| RQ | Question |
|---|---|
| RQ-1 | Is fd 0 = fd 1 peer equality plus the pidfd liveness check sufficient, or must the broker also bind the peer's start time? |
| RQ-2 | Should `closefrom=3` and `!use_pty` be qualification checks only, or literal requirements in the §5.1 rule text? |
| RQ-3 | Is `ProtectHome=tmpfs` compatible with HOME inside the attempt leaf on B? C1 addresses this by design: the leaf is never under a hidden path (A7.3) and is the only `ReadWritePaths` entry (A7.2). Reviewers confirm |
| RQ-4 | Config: an additive optional key in v1, or a config v2? |
| RQ-5 | Should the A2 file set also include `node_modules/.package-lock.json`? |
| RQ-6 | Do the post-OD-06 OD-265 planning changes (multi-plan packages, per-candidate attempts) alter any OD-06 §8.1 binding assumption (exactly one apply attempt per package; ALL specs)? |
| RQ-7 | This one predates the amendment and C2 does not change it. The OD-06 §7.1 identity rule wants every frame identity to have appeared earlier in the same invocation or to be derived. Yet OD-06 §7.2 allows a RECONCILE TERMINAL/QUARANTINED at frameSequence 0 with a non-null invocationId. How should the client apply §7.1 to that frame? A5.1's exit set does not depend on the answer for 0/10; it does for 8 versus 7 |

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

---

## 11. Corrective C1 (`OD-R1-STAGE5-WP1-C1`, 2026-11-26)

| Item | Value |
|---|---|
| Reviewed head | `b00fc44b1b486272b3329e3cc6fe888e881945c7` (tree `0849b1ed21591b5736838a29d423d32323b86fb2`); exact-head CI 7/7 PASS |
| Review | Consolidated HEAVY Architecture + Security: three MAJOR findings, consolidated by the PM as C1-F1..C1-F3 |
| Scope | This document only |
| Change policy | No PD disposition, RC-07/RC-08 requirement, OD-04 boundary, A2 qualification obligation, risk disposition or finding status changed. No requirement reduced |

| Finding | Sources | Problem at the reviewed head | Corrective change | Sections |
|---|---|---|---|---|
| C1-F1 MAJOR — A7 write confinement | ARCH-WP1-01, SEC-WP1-01 | The A7 claim limited writes to the leaf and a private /tmp, but the host `/dev/shm` and `/dev/mqueue` stayed writable. `PrivateTmp` storage lay on the host root filesystem, outside every bound. The writable locations were not enumerated, qualification did not prove the set, and the limitations contradicted the claim | A closed permitted writable set P1–P4 (A7.1). A property set that achieves it: `TemporaryFileSystem` for `/tmp`, `/var/tmp` and `/dev/shm` with fixed size bounds instead of `PrivateTmp`; `/dev/mqueue` inaccessible; `PrivateIPC`; `ProtectKernelTunables`; `ProtectControlGroups` (A7.2). Placement constraints (A7.3). Enforcement points and seven mandatory qualification criteria, with any extra writable location → INELIGIBLE (A7.4). A scoped claim consistent with §2.5 (A7.5) | §0, §1.1, §1.2 G1, §2.4 Q2/Q5, §2.5, §2.6, A7, §4.2 TBΔ-3, §4.4, §6, §9 item 8, RQ-3 |
| C1-F2 MAJOR — A6 attempt consumption | ARCH-WP1-02, SEC-WP1-02 | A6 mapped "CREATE before SUBMITTING" to REFUSED. That contradicts the durable reservation: from the COMMITTED marker (P1S) the attempt is consumed and OD-06 allows only PRESUBMIT_FAILURE or QUARANTINED. A6 also stated an unconditional "approval consumed" | The consumption point is fixed at the reservation COMMITTED marker (A6.2). A phase table P0–P6 plus RECONCILE gives, for each phase, where an event can occur, the outcome, the consumption state and the mandatory evidence. Pre-reservation → REFUSED and not consumed; P1S → PRESUBMIT_FAILURE or QUARANTINED, consumed; P2–P4 → CONTROLLER_FAILURE, proven TIMED_OUT or QUARANTINED, consumed; P6 → committed outcome stands. Obtained facts only; TIMED_OUT precedence unchanged (A6.1, A6.4) | §0, §1.2 G2, §2.4 Q4, §2.5, A6, §4.2 TBΔ-2, §6, §9 item 7 |
| C1-F3 MAJOR — A5 recovery semantics | ARCH-WP1-03, SEC-WP1-03 | A5 allowed RECONCILE REFUSED after journal writes. That conflicts with OD-06 §7.2 (REFUSED: no durable backing, pre-reservation), §11.3 (null attemptDigest/record) and §5.2 (post-submit uncertainty is exit 7). Committed-result preservation was not stated | Committed-result preservation (A5.1). Finalization unchanged (A5.2). The incomplete-recovery ending is no final frame, client exit 7 under the existing rule, durably identical to a broker crash (A5.3). REFUSED stays pre-action only (A5.4). CREATE P1 reconciliation unchanged (A5.5). The earlier REFUSED-after-writes proposal is withdrawn. No new frame, disposition, reason, state or exit code | §0, §1.2 G7, §2.4 Q4, A4.1, A5, §4.2 TBΔ-2, §7.1 WP4, §9 item 6 |

Unchanged by C1:
- A1–A4 (except the A4.1 exit-7 wording), A8 and A9;
- §5 (PW-PILOT-1 reuse), the §6 dispositions, §7 (effort), §8 (open decisions) and §10.

Delta review covers §11 and the listed sections only (review rule of §9).

---

## 12. Corrective C2 (`OD-R1-STAGE5-WP1-C2`, 2026-11-26)

| Item | Value |
|---|---|
| Reviewed head | `cb50679653d977faf599f6e922e8d2a10fbf0b8c` (tree `d77a9a8a25b0f109ed0bef03a1cd52c8dfa340fe`); exact-head CI 7/7 PASS |
| Review | Architecture delta review of C1: CHANGES_REQUIRED (C1-F1 and C1-F3 not resolved; C1-F2 resolved) |
| PO dispositions | PD-C2-01 = Option B (ARCH-C1-N1); PD-C2-02 = Option A (ARCH-C1-N2); PD-C2-03 (S2, S3) |
| Scope | This document only |
| Change policy | No PD-1..PD-7 disposition, RC-07/RC-08 requirement, OD-04 boundary, qualification obligation, risk disposition or finding status changed. No requirement reduced. No public contract extended: no new exit code, frame, disposition, reason, state, output field or CLI form. C1-F2 consumption semantics unchanged. No runtime qualification is claimed |

| Finding | Problem at the reviewed head | Corrective change | Sections |
|---|---|---|---|
| ARCH-C1-N1 MAJOR (author observation S1) — RECONCILE success exit | A5.1 let `--reconcile` exit 0/10 after checking only the record digest and executionId. OD-06 §7.2 allows 0/10 only with the client binding and the BOUND invocationId, which a RECONCILE invocation cannot have. The text claimed "no new success path" | PD-C2-01 Option B: RECONCILE uses the OD-06 §7.3 reconcile exit set. Committed TIMED_OUT → 8; committed EXECUTION_ERROR/QUARANTINED → 7; committed PASSED/TEST_FAILED → 7, never 0/10. The record is returned unchanged. The attached CREATE stays the only 0/10 path. The §7.2 client rule is not amended | A4.1, A5.1, §2.4 Q4, §2.5, §9 item 6, RQ-7 (pre-existing OD-06 §7.1 question, recorded for reviewers) |
| ARCH-C1-N2 MAJOR — cross-process procfs write route | The workload (runner uid, OD-06 §6.1) could reach writable host locations through `/proc/<pid>/root`, `cwd` and `fd` of same-uid processes outside the unit, including the attached client. Yama does not gate read-mode access. Q5 enumeration and path probes could not detect it, yet A7.5 claimed the closed set | PD-C2-02 Option A. The requirement P1–P4 is unchanged and stated per location, whatever the path (A7.1). Proposed control: `PrivateUsers=true` (A7.2), with the rationale; PrivatePIDs is considered and not proposed. New mandatory A7.4 criterion 8, cross-process procfs probes; criterion 7 also covers the §6.1 UID checks. A7.5 is restated as a design target: proposed controls versus a runtime guarantee that is NOT VERIFIED until Q5 passes; Q5 and I5 stay OPEN. §2.5 corrected (no reliance on Yama), and the existing same-account delegation residual is named without new acceptance. §1.1 states that COVERED means covered by design | §1.1, §1.2 G1, §2.4 Q5, §2.5, A6.4 (hardening-note reference), A7.1, A7.2, A7.4, A7.5, §4.2 TBΔ-3, §4.4, §6 PD-1 effect wording, §9 item 8 |
| S2 MINOR — propertiesDigest wording | A7.4 said the readback "produces" `propertiesDigest`; OD-06 computes it over the payload in P1S | A7.4: the §4.3 item 7 readback is compared with the fixed payload values; `propertiesDigest` is computed over that payload in P1S | A7.4 |
| S3 MINOR — RECOVERY_BUDGET_EXHAUSTED meaning | The A6.2 P1 row used RECOVERY_BUDGET_EXHAUSTED for every pre-reservation availability refusal, including those that are not budget exhaustion | The reason keeps its exact OD-06 §6.4 meaning: global budget A exhausted. Other pre-reservation availability refusals use the existing INELIGIBLE (controller eligibility not established, OD-06 §6.4 P1). Both stay exit 5, not consumed | A6.2 P1 row, §2.4 Q4 |

Unchanged by C2:
- A1–A3, A8 and A9;
- A4 except the exit-code list;
- A5.2–A5.5;
- A6.1, A6.3 and every A6.2 row except the P1 reason;
- §5, the §6 dispositions, §7 and §10.

Delta review covers §12 and the listed sections only (review rule of §9).

---

## 13. WP1 post-merge lifecycle record (2026-11-26)

- PR [#278](https://github.com/TarasovArtem/qa-ai-agent/pull/278): merged under OD-R1-STAGE5-WP1-MERGE.
- Reviewed HEAD: `4af2617d048a85b55dfce7bd18fa28e8fb985495`; TREE: `65cf758f228b3c57b2d29b9d3c09a376e34e099e`.
- Exact-head [CI #777](https://github.com/TarasovArtem/qa-ai-agent/actions/runs/45836879271): SUCCESS 7/7. Architecture and Security delta reviews APPROVED; no new material findings reported.
- Merge: `130f09af702625388ab3e25bb44787f9b2b972a8`, STANDARD_TWO_PARENT; parents `8ffbf39aa5eb9d3e59dee7a02fc32b52267b410d` and reviewed HEAD. GitHub comparison from reviewed HEAD to merge showed no changed files.
- Fresh automatic [push CI #778](https://github.com/TarasovArtem/qa-ai-agent/actions/runs/45842252904) on exact merge SHA, main: 7/7 jobs SUCCESS.
- WP1 design delivery: MERGED / POST-MERGE CERTIFIED. Earlier review chronology is historical. No independent certification beyond the supplied review verdicts is asserted.
- Outstanding: Q1–Q7 and I5 remain OPEN; RQ-7 is non-blocking for design review but must be disposed before the affected Q4 qualification acceptance. Other open decisions/questions retain their recorded dispositions; no risk or finding closure is asserted by this lifecycle record.
- WP2 requires separate PO authorization. Stage 5 implementation NOT AUTHORIZED; execute DISABLED; R1 NOT RELEASE READY / NOT APPROVED; TPR SUSPENDED / NOT RELEASED, Issue #199 remains OPEN. WIP = 1.
