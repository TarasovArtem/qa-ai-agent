# OD-RATE-1-C2-R3 — Provider Governor Design (Consolidated Corrective C4)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-design.md` (1 of 3; companions: [proofs](od-rate-1-c2-r3-proofs.md), [review matrix](od-rate-1-c2-r3-review-matrix.md)) |
| Revision | **C4** (supersedes C3 at PR #262 head `eff78a0c8d05b85b422f9945ced664485d7d563f`). Change log: §20. |
| Status | **DESIGN — PENDING INDEPENDENT HEAVY REVIEW.** Not approved. No implementation, contract amendment, ROADMAP entry, merge or release is authorized by this document. |
| Issue | #258 (OPEN; not modified) |
| Baseline (review) | `main` HEAD `a32a6cd7e0a1bdc9917fc3abc7f692039591a145`, TREE `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Baseline (historical C2) | HEAD `52e23acf0f7e5d2f7fce2b406a27de51ae1af68c`, TREE `176960ba98b1e7babfee553729200c49d748d7ca` |
| Author | Claude Code (the same account that authored OD-RATE-1, C1, C2 and C3). **This author cannot approve this design.** |

Normative keywords: **MUST**, **MUST NOT**, **SHOULD**, **MAY** as in RFC 2119.
Durations are integer milliseconds on a monotonic clock unless stated otherwise.
"Contract" means `docs/controlled-v1-productization-contract-v1.md`.

---

## 1. Purpose and scope

This document specifies an opt-in **provider governor** for the provider-backed
generative stages (`design`, `plan`, `generate`) of the `qa-agent` CLI. The
governor delays or refuses provider requests so that the process stays within
operator-declared request-rate (RPM) and heuristic token-rate (TPM) budgets, and
it bounds governed stages in time.

C4 is a consolidated, design-only corrective. It answers the second independent
HEAVY re-review (R3) of C3 (§2.3). It keeps the C3 corrections that R3 accepted:
R2-ARCH-04 (wait-budget overshoot), R2-ARCH-05 (HTTP 408), DRIFT-01 (SEC-C1
cancellation) and DRIFT-02 (IPC receipt/ACK).

In scope:

- Governor state model, joint RPM + TPM admission, the governed transport gate,
  and reservation and usage accounting.
- Wait accounting (including queueing), cancellation, stage deadline,
  heartbeat, watchdog, and bounded post-kill settlement.
- Closed reason-code propagation on normal-return and exception paths.
- Configuration schema v2 (opt-in) and exact v1 compatibility.

Out of scope (unchanged and not designed here):

- Triage (`stage-runner.js`, TSB contracts); PD-R7 is open.
- The attempt budget (PD-R1), provider request payload caps (PD-R4) and
  real-provider validation (PD-R9), all open.
- Persistent or cross-process rate state (rejected in C1).
- Release, ROADMAP, governance, package exports, `README.md`, `SECURITY.md`.

## 2. Baseline, evidence and authority

### 2.1 Certified code baseline (`main` `a32a6cd7`)

| File | Blob | Facts used |
|---|---|---|
| `scripts/ai/cli/stage-process.js` | `4c9a8ab4` | First result stored in memory, then ACKed with the child's random receipt (L118–132). `close` settles (L139). After `exit`, a ref'd `CLOSE_AFTER_EXIT_MS = 10000` timer settles with `result = null` if `close` never arrives (L143–160). There is no timeout, watchdog or kill. Late `exit` after settlement is ignored (L147). |
| `scripts/ai/cli/generative-runner.js` | `5adac686` | `guardParentLink()` (L130): parent `disconnect` → abort → `process.exit(1)` in the same turn. `report()` (L167) moves `running → sending → awaiting_ack → delivered \| failed`. `RESULT_ACK_DEADLINE_MS = 10000` (L115). `bindCancelSignal(parentLink.signal)` runs before any provider exists (L238). `runOnce` catch (L226–229) reports `{kind:"internal", code:"GENERATIVE_STAGE_FAILED"}`. |
| `scripts/ai/providers/index.js` | `74c64cd3` | Process-scoped `bindCancelSignal()` (L28). `createProvider(name)` passes `{ cancelSignal }` (L37–). |
| `scripts/ai/providers/groq-provider.js` | `3d97fd86` | Accepts injected `fetchImpl` (L141). `fetchImpl(url, {method, headers, body: JSON.stringify(...), signal})` with **no `redirect` member** (L185–199). A rejection from `fetchImpl` maps to `TIMEOUT` if `err.name === "AbortError"`, else `NETWORK` retryable (L200–219). Non-2xx → `mapHttpError(status)`: 401/403 AUTH ✗, 429 RATE_LIMIT ✓, 408 TIMEOUT ✓, 5xx UNKNOWN ✓, **every other status, including 3xx**, UNKNOWN ✗ (L41–72). Bounded JSON body read (L233), **then** the content check → `INVALID_RESPONSE` (L243–249). |
| `scripts/ai/providers/gemini-provider.js` | `6559416d` | Same structure: `fetchImpl` without `redirect` (L195–210); bounded read (L241); `extractText` content check → `INVALID_RESPONSE` (L253–). `mapHttpError`: 401/403 AUTH ✗, 429 ✓, 5xx ✓, every other status incl. 408 and 3xx UNKNOWN ✗ (L44–69). |
| `scripts/ai/cli/generative.js` | `418b5597` | Accepts only `result.ok === true && exitCode === 0` (L83). `classifyChildFailure()` (L50): `generation` failures → `PROVIDER_FAILURE` (6), or exit 4 when `providerAttempts` is 0 or not an integer (L58–60); `internal` → `STAGE_FAILED` (1). |
| `scripts/ai/cli/run-artifacts.js` | `56946794` | `KNOWN_CODES` closed allowlist (L49); unknown codes → `UNKNOWN` (L62). |
| Generators | — | `providerAttempts` is set before `provider.analyze()`; at most 2 attempts. Design-stage generators report `providerError.code`. `automation-plan-generator.js` L677 and `generate-change-set.js` L270 replace every provider error with `INVALID_VALUE`. Their attempt 2 after a retryable provider error uses the correction prompt. The attempt counter is local to the generator. |
| Precedent | — | `jira-requirements-provider.js` (L108) and `azure-devops-requirements-provider.js` (L104–105, L620, L631) already send `redirect: "manual"` and treat any 3xx or `opaqueredirect` response as a hard failure. |

CLI contract facts: exit taxonomy contract §10.7 (6 = provider failure,
including "provider bounded-time exceeded"; 1 = internal or invariant violation);
`--json` envelope `{schemaVersion, command, ok, exitCode, runId, artifacts, errors:[{code,message}]}`
(contract §10.8); config schema v1 is exactly `schemaVersion: 1` (contract §11.2).

### 2.2 Historical evidence (preserved, not rewritten)

| Item | Identity |
|---|---|
| Evidence package | `OD-RATE-1-C2-R2-EVIDENCE` (local PO package; not in the repository) |
| `MANIFEST.sha256` SHA-256 | `eeb5a063b09803513eeb6ef77893802a37bf39e55d6abc8d5a955257d9ecbff9` |
| `REMEDIATION-MANIFEST.sha256` SHA-256 | `006dae0d317d0ad35c9e0c0591d520f1d63e7f1b5cdbf443f9947ece57d9cdfc` |
| `POST-AUTH-MANIFEST.sha256` SHA-256 | `1139919745bf35507bdbe732af3e8e5fb55313e3d9d9ee0b3f42aad2f5470fcc` |
| C2 design file SHA-256 | `1c0851be7a40a9406c7d75daa7d9676534b4e61f7ff542a93be53f3e2f74c054` |
| Issue #258 raw body SHA-256 | `e5b84e8118631885d8034f9d6eab1bc730d5ccda3598597ba5d6c935e95c86cc` |

C2 clauses are cited as `C2:<line>`. C4 does not edit, re-hash or re-seal C2 or
any manifest.

### 2.3 Review input

Codex session `01a17740-3dc0-7ee2-b26e-a538092270cd` (one session holds both
reviews; transcript SHA-256 at C4 authoring time
`00c039587b2607e9eb017dc8da5118fc6bef03ef89c038de3af3717d8a46777c`; the C3-time
hash `2f274459…22db` covered the R2 review only).

| Finding | Origin | Severity | R3 status | C4 section |
|---|---|---|---|---|
| R2-ARCH-01 | R2 | MAJOR | STILL_OPEN (actual HTTP sends not covered) | §7, §7.8, §7.9 (via R3-ARCH-03) |
| R2-ARCH-02 | R2 | MAJOR | STILL_OPEN (exception path) | §11 |
| R2-ARCH-03 | R2 | MAJOR | STILL_OPEN (dispatch-time guarantee) | §7.8, §14 (via R3-ARCH-02) |
| R2-ARCH-04 | R2 | MAJOR | RESOLVED_BY_DESIGN, preserved | §8 |
| R2-ARCH-05 | R2 | MINOR | RESOLVED_BY_DESIGN, preserved | §10 |
| DRIFT-01 | R2 | corrective | RESOLVED_BY_DESIGN, preserved | §12 |
| DRIFT-02 | R2 | corrective | RESOLVED_BY_DESIGN, preserved | §13 |
| R3-ARCH-01 | R3 | MAJOR | NEW: usage lost when the inner call rejects | §9 |
| R3-ARCH-02 | R3 | MAJOR | NEW: stale clock check at dispatch | §7.8 |
| R3-ARCH-03 | R3 | MAJOR | NEW: one inner call, several HTTP requests (redirect) | §7.9 |
| R3-ARCH-04 | R3 | MINOR | NEW: FIFO waiting not accounted | §8.3 |
| R3-ARCH-05 | R3 | MINOR | NEW: wrong endpoint of the 40-send interval | proofs §5.2 |

### 2.4 Product Owner decisions

| Decision | Status | Interpretation used in C4 |
|---|---|---|
| PD-R2 | APPROVED DIRECTION | Config schema v2 with opt-in `providerGovernor`; v1 unchanged (§5). |
| PD-R3 | APPROVED FOR DESIGN REVIEW | 30 s request timeout, 65 s per wait, 900 s accumulated wait per stage, 1 800 s stage deadline, 45 s watchdog, 10 s heartbeat. Product constants (§6.1). |
| PD-R5 | APPROVED | 65 s cold start per governed stage process; counts toward wait budget and deadline. |
| PD-R6 | APPROVED | No exit 130; platform-native user-signal termination; never exit 6 for user cancellation. |
| PD-R8 | APPROVED DIRECTION | Closed reason-code extension; exact envelope subject to review (§11, §15). |
| PD-R10 | APPROVED | Heuristic, best-effort token admission; no provider-TPM guarantee. |
| PD-R13 | APPROVED | Deadline, heartbeat, watchdog only when governed. |
| SEC-C1 | APPROVED | Parent IPC loss aborts waits and in-flight requests; no new calls; child terminates. |
| PD-R14 | APPROVED | SEC-C1 unconditional. |
| PD-R11 | APPROVED: A | `charged = max(reserved, normalizedObserved)` for valid usage. Known valid usage survives content-validation failure and exception unwinding (§9). |
| PD-R12 | APPROVED: A | Missing usage saturates (§9.5). |
| **PD-R12-I1** | **APPROVED** | Malformed usage → saturate **and** `RATE_ACCOUNTING_INVALID`. Unavailable usage, failed exchange or uncertain remote completion → saturate. Never zero (§9.4). |
| D+15 | APPROVED: A | Separate measurable lifecycle phases; no whole-CLI 1 815 s claim; no change to FT0 termination (§14). |
| **PD-R15** | **BOUNDED SETTLEMENT DIRECTION APPROVED** | Parent settlement after a kill is bounded (§13.8). **The timeout value `K_SETTLE` is NOT approved.** C4 proposes 10 000 ms and requests PO disposition (§19.2). |

Open, not closed by C4: PD-R1, PD-R4, PD-R7, PD-R9, and the `K_SETTLE` value
(§19). C4 assumes status-quo values for PD-R1/R4/R7/R9.

---

## 3. Contract boundaries

| Surface | Class | C4 effect |
|---|---|---|
| Package `exports`, `bin`, library API | public | **None.** |
| CLI exit codes (contract §10.7) | public | **None new.** Governed outcomes use existing codes 3, 6 and 1. |
| CLI reason codes | public | Closed additive extension under PD-R8 (§15). Unreachable with v1 config or a disabled governor. |
| Config schema | public | v2 adds optional `providerGovernor` (§5). v1 unchanged. |
| stdout | public | Unchanged. |
| stderr | public (bounded diagnostics) | One new fixed-template diagnostic, only on governed post-kill abandonment (§13.8). |
| Child environment | private | **Unchanged.** |
| Parent → child IPC | private | Optional closed `governor` member on `payload` (§13.2). |
| Child → parent IPC | private | Governed-only `heartbeat` message; `failure.kind: "stage-timeout"`; optional `failure.governorCode` on `internal` failures (§11.4). Receipt/ACK protocol unchanged. |
| Provider constructors / `createProvider()` | private | Governed child only: an injected **gated `fetchImpl`** (§7.8–§7.9), which both providers already accept, and an internal-only `observer` option (§9.6). Ungoverned: unchanged. |
| Generators | internal | **No change** (§11). |
| Run manifest, run store, review packages, approval/apply | — | Unchanged. |

## 4. Terminology

| Term | Meaning |
|---|---|
| Admission | The synchronous governor decision that all budgets permit one transport invocation. It is linearized at **entry creation** (§7.3). |
| Entry | The ledger record created at admission. Exactly one per admission. |
| Gate | The governed `fetchImpl` wrapper injected into the provider. It is the last code under governor control before the transport (§7.8). |
| Transport invocation | One call from the gate into the real `fetch`. At most one per admission. Timestamp `tDispatch`, read inside the gate. |
| HTTP request | A request emitted by the transport onto a connection. Wire timing is not directly observable (§7.8). |
| Hop | One HTTP request inside one transport invocation. Redirect-following would create more than one; C4 forbids it (§7.9). |
| Settle | The instant the inner `analyze()` resolves or rejects, observed by the governor (`tSettle`). |
| Exchange record | The per-admission record of transport, HTTP, body and usage outcomes (§9.1). |
| `Res` / `U` / charged | Reservation, validated normalized usage, and the tokens counted for an entry (§9). |
| `t0` / `tSpawn` / `tKill` | Child payload-receipt time; parent spawn time; parent kill-decision time. |
| Governed | The governor is enabled for this stage (§5.3). |

---

## 5. Configuration and compatibility

### 5.1 Schema v2

`schemaVersion: 2` is v1 plus one optional top-level key:

```json
{
  "schemaVersion": 2,
  "providerGovernor": {
    "enabled": true,
    "limits": {
      "groq":   { "tokensPerMinute": 8000, "requestsPerMinute": 30, "completionReserveTokens": 2000, "reasoningReserveTokens": 0 },
      "gemini": { "tokensPerMinute": 250000, "requestsPerMinute": 10, "completionReserveTokens": 4000 }
    }
  }
}
```

The values are illustrative; C4 asserts no provider plan limit.

| Key | Rule |
|---|---|
| `providerGovernor` | optional object; closed keys `{enabled, limits}` |
| `enabled` | required boolean |
| `limits` | required when `enabled` is `true`; closed key set ⊆ `{"groq", "gemini"}` |
| `tokensPerMinute` | integer, 2 ≤ v ≤ 10 000 000 |
| `requestsPerMinute` | integer, 1 ≤ v ≤ 100 000 |
| `completionReserveTokens` | integer, 0 ≤ v ≤ 1 000 000 |
| `reasoningReserveTokens` | optional integer, 0 ≤ v ≤ 1 000 000, default 0; operator-declared |

Timing values are product constants and MUST NOT be configurable. Validation
failures are exit 3 before any provider exists.

### 5.2 Effective-provider rule

When `enabled` is `true` and the effective generative provider (contract §10.4.2)
has no `limits` entry, the command fails with exit 3,
`PROVIDER_GOVERNOR_LIMITS_MISSING`, before spawning the child (zero sends).

### 5.3 Governed vs. ungoverned

| Config | Governor, gate, observer | Heartbeat / watchdog / deadline / post-kill settlement | SEC-C1 | IPC payload |
|---|---|---|---|---|
| v1 | absent | absent (PD-R13) | present (PD-R14) | byte-identical to baseline |
| v2, absent or `enabled: false` | absent | absent | present | byte-identical to baseline |
| v2, `enabled: true` | present | present | present | baseline + `governor` member |

In the first two rows, providers keep the default `fetch`, with the default
redirect mode, exactly as certified. **INV-13** requires those rows to be
indistinguishable from the certified baseline.

---

## 6. Governor state model

### 6.1 Product constants

| Symbol | Value | Source |
|---|---:|---|
| `T_REQ` | 30 000 | existing provider timer; PD-R3 |
| `C_COLD` | 65 000 | PD-R5 |
| `W_HOLD` | 65 000 | provider minute (60 000) + guard (5 000) |
| `W_MAX` | 65 000 | PD-R3 per-wait cap |
| `W_BUDGET` | 900 000 | PD-R3 accumulated wait per stage |
| `D_STAGE` | 1 800 000 | PD-R3 stage deadline from `t0` |
| `D_DISPATCH` | `D_STAGE − T_REQ` = 1 770 000 | last permitted transport invocation, from `t0` |
| `S_MIN` | 50 | minimum sleep |
| `I_MAX` | 64 | wait-loop iterations per `analyze()` |
| `HB` | 10 000 | PD-R3 heartbeat |
| `WD` | 45 000 | PD-R3 watchdog |
| `K_PARENT` | 1 815 000 | parent enforcement point from `tSpawn` (D+15) |
| `K_SETTLE` | **10 000, PROPOSED, NOT APPROVED** | PD-R15 post-kill settlement bound (§13.8, §19.2) |
| `ACK` | 10 000 | FT0 `RESULT_ACK_DEADLINE_MS` (unchanged) |
| `CAE` | 10 000 | FT0 `CLOSE_AFTER_EXIT_MS` (unchanged) |
| `h` | 0.85 | token headroom |
| `κ` | 3.0 bytes/token | heuristic estimator |
| `O` | 32 tokens | template overhead |
| `U_MAX` | 10 000 000 | maximum accepted usage value |

Derived: `B_tok = floor(tokensPerMinute × h)`; `B_req = requestsPerMinute`.

### 6.2 State

One governor per governed child, for the single effective provider:

| Field | Meaning |
|---|---|
| `t0` | monotonic ms at payload receipt |
| `entries` | list of `{tAdmit, tSettle \| null, res, charged}` |
| `W` | accumulated governor wait, union model (§8.3) |
| `waiters`, `waitSince` | number of callers currently waiting; start of the current waiting interval |
| `coldUntil`, `cooldownUntil`, `hintTok`, `hintReq`, `exhausted` | as C3 (§7.6) |
| `slot` | `null` or the open exchange record of the one admitted send (§9.1) |
| `queue` | FIFO of callers; only the head may evaluate admission |
| `cancelSignal` | the process-scoped SEC-C1 signal |
| `ctx` | the runner-owned stage context (§11.2); the governor writes to it |

An entry is **live at `t`** iff `tSettle === null` or `t < tSettle + W_HOLD`.

### 6.3 Clock

All times come from `process.hrtime.bigint()` as integer milliseconds. If a later
reading is smaller than an earlier one, the governor refuses with
`RATE_ACCOUNTING_INVALID`. The clock is read **again** at every decision that
depends on time (§7.3, §7.8): a reading is never reused across code that can
take time.

---

## 7. Admission, gate and transport

### 7.1 Two ledgers over one entry list

- **Request ledger:** `reqLive(t)` = number of entries live at `t`.
- **Token ledger:** `tokLive(t)` = Σ `charged` of entries live at `t`.

An entry occupies both ledgers from admission until `tSettle + W_HOLD`. It is never
removed early. An unsettled entry never expires.

### 7.2 Admission predicate

At reading `t`:

```text
P_cancel : cancelSignal not aborted
P_term   : ctx.terminal === null and exhausted === false
P_cold   : t ≥ coldUntil
P_cool   : t ≥ cooldownUntil
P_req    : reqLive(t) + 1 ≤ B_req   and (hintReq === null or t ≥ hintReq.until)
P_tok    : max(tokLive(t), hintTokUsed(t)) + res ≤ B_tok
P_wait   : Wnow(t) ≤ W_BUDGET                     (§8.3)
P_dead   : t ≤ t0 + D_DISPATCH
P_serial : slot === null and the caller is the queue head
```

### 7.3 Linearization of admission

The admission decision and entry creation form one synchronous section with no
`await`:

```text
t = nowMs()                                  // fresh reading
if all predicates hold at t:
  e = {tAdmit: t, tSettle: null, res, charged: res}; entries.push(e)
  slot = openExchange(e, dispatchDeadline = t0 + D_DISPATCH)
```

**Linearization point:** `entries.push(e)`. JavaScript run-to-completion ensures
that no other callback can change ledger, slot, hint or cancellation state between
the reading `t` and the push. Time **does** pass in that section. C4 does not treat
the section as instantaneous. Passing time can only relax `P_cold`, `P_cool`,
`P_req` and `P_tok` (entries only expire; nothing else changes while the section
runs). It can falsify `P_dead` and `P_cancel`, and the gate re-checks both (§7.8).
So the admission decision remains valid at the gate for every predicate the gate
does not re-check (proofs Lemma 5).

After admission the governor calls `inner.analyze(req)`. The provider then
builds the request: it creates its controller, arms its 30 s timer and runs
`JSON.stringify` on the prompts. All of that runs **before** the gate.

### 7.4 Serialization

At most one admitted send exists (`slot !== null`) at a time. Callers wait in a
FIFO queue. The certified generators call `analyze()` strictly sequentially, so
the queue is always empty in the supported scope. Queue waiting is still accounted
(§8.3). No fairness claim beyond FIFO order is made.

### 7.5 Retries

Each `analyze()` call makes at most one admission. A correction or transport
retry is a separate call with a fresh estimate and a new entry. The governor makes
zero retries (INV-08).

### 7.6 Cold start, cooldown and hints

Unchanged from C3. Cold start is `t0 + 65 000`. After a 429,
`cooldownUntil = tSettle + min(RA ?? 65 000, 65 000)`, and `RA > 65 000` →
`exhausted`. Hints only tighten, under the strict grammars of C2:151. Groq
`remaining/reset-tokens` feed `hintTok`. Groq `remaining/reset-requests` are
requests **per day** and never relax `P_req`; `0` sets `hintReq`. Gemini: only
`Retry-After` on 429. Header meanings are unverified (PD-R9). Hints and cooldown
are applied only at settlement, from the exchange record (§9.1).

### 7.7 Invariant (admissions)

**INV-01.** Every admission (entry creation) happens at a fresh reading `t` at
which all §7.2 predicates hold. Proofs Lemma 1: any half-open 65 s interval holds
at most `B_req` admissions and at most `floor(B_tok / Res_min)` admissions.

### 7.8 Governed transport gate (R3-ARCH-02)

The gate is the governed `fetchImpl` the governed child injects into the provider
constructor. Both providers already accept `fetchImpl` (Groq L141; Gemini, same
constructor shape). The gate is a closure over the governor. It receives the
absolute deadline and the cancellation signal through `slot`, not through
provider arguments.

```text
gate(url, init):                                   // called by the provider in place of fetch
  s = governor.slot
  t = nowMs()                                       // fresh reading at the closest enforceable boundary
  if s === null or s.sealed or s.dispatched:  s && (s.gate = "DUPLICATE");  throw GateRefusal
  if cancelSignal.aborted:                    s.gate = "CANCELLED";         throw abortError()
  if t > s.dispatchDeadline:                  s.gate = "DEADLINE";          throw GateRefusal
  s.dispatched = true; s.tDispatch = t
  p = realFetch(url, {...init, redirect: "manual"})   // §7.9; init.signal is the provider's controller
  return p.then(res => { recordResponse(s, res); return res })
```

Enforceable invariant (**INV-06**, restated):

> Every transport invocation of a governed send happens at a monotonic reading
> `tDispatch ≤ t0 + 1 770 000` taken inside the gate, immediately before the
> call into `fetch`. At most one transport invocation happens per admission.

What C4 does **not** claim, and why:

- **Wire dispatch time.** After `fetch()` is called, Node's built-in transport
  (undici) may resolve DNS, open a TCP/TLS connection and write the request in
  later event-loop turns. User code cannot observe or bound when the first byte
  leaves the host. C4 therefore makes no claim that no HTTP bytes leave after an
  exact instant.
- **What is bounded instead.** The provider's own 30 s controller is armed before
  the gate and covers fetch and body read (certified). It aborts the exchange at the
  first timer callback at or after `analyze start + 30 000`. So local transport
  activity for a governed send ends no earlier than that and with OS-dependent
  lateness `ε` (proofs §5).
- **PO impact.** The public contract never promised wire-level timing.
  PD-R3's 1 800 s stage deadline is enforced as above. Restating INV-06 at the
  transport-invocation boundary narrows C3's wording to what is enforceable. It
  does not weaken any approved contract text, so **no PO contract change is
  required**. Reviewer question M §5 Q2 asks the reviewer to confirm this.

Gate refusals and how the provider sees them:

| Gate outcome | What the provider sees | What the governor does at settle |
|---|---|---|
| `DEADLINE` | `fetchImpl` rejects with a non-Abort error; the provider maps it to `NETWORK` (retryable) | discards the provider error; refuses with sticky `STAGE_TIMEOUT` (§9.7) |
| `CANCELLED` | `AbortError`; the provider reports its non-retryable cancellation error | rethrows cancellation (process is exiting, FT0) |
| `DUPLICATE` (a second `fetchImpl` call inside one `analyze()`) | non-Abort error → `NETWORK` | refuses with sticky `RATE_ACCOUNTING_INVALID` (an invariant breach; certified providers never do this) |

**Lemma 5 (proofs).** Between admission and gate, `P_req`, `P_tok`, `P_cold`,
`P_cool` and `P_wait` cannot become false. No entry can be created (slot held),
no wait accrues (no sleep), and hints and cooldown change only at settle. The gate
therefore re-checks exactly the predicates that time can falsify: `P_dead` and
`P_cancel`.

Adversarial 1 ms trace (proofs §4.4): admission reads `t = t0 + 1 770 000` (passes
`P_dead`); provider setup takes 1 ms; the gate reads `t0 + 1 770 001 >`
`dispatchDeadline` → `DEADLINE` → zero transport invocations → `STAGE_TIMEOUT`.

### 7.9 Redirects: never followed on governed calls (R3-ARCH-03)

- The gate always passes `redirect: "manual"`, overriding any value. Certified
  providers pass none.
- With `redirect: "manual"`, Node's `fetch` returns the 3xx response itself and
  makes no further request. Localhost observation on Node 22.23.3 and 24.22.1:
  default mode → **2 POSTs** (`/first`, `/second`); `"manual"` → **1 POST**,
  status 307, `Location: /second`; `"error"` → 1 POST, then `TypeError`
  ("unexpected redirect") (proofs §4.5). This is observation, not certification.
  It is test-specified in M T-R3-03.
- `"error"` is rejected as the mode. The provider would map its `TypeError` to
  retryable `NETWORK`, which invites attempt 2. `"manual"` yields a status the
  certified providers already classify as non-retryable `UNKNOWN` (3xx falls into
  their final branch). The redirect therefore fails closed, with no new provider
  error code and no retry.
- The gate records `httpOutcome = "REDIRECT_NOT_FOLLOWED"` when
  `300 ≤ status ≤ 399` or `type === "opaqueredirect"`. The body is not read (the
  provider releases it); usage is Unavailable; the entry saturates (§9.4).
- This follows the repository precedent (Jira and Azure DevOps providers, §2.1).
- Multi-hop admission (admitting and accounting each redirect hop) is **not**
  designed and would need explicit authority.
- Ungoverned calls keep the default redirect mode. FT0 and v1 behavior are
  unchanged (INV-13).

Transport assumption **T1** (proofs §1): with `redirect: "manual"`, no proxy
configured, and a non-idempotent POST, one `fetch()` call emits at most one HTTP
request. Node's `fetch` does not use environment proxy variables by default, and
the governed child's environment is the closed `buildGenerativeEnv()` set. T1
holds for the observed Node versions in the localhost experiment. It must be
re-verified per supported Node line (M T-R3-03).

**INV-08 (restated).** At most one admission per `analyze()`, at most one
transport invocation per admission, and (under T1) at most one HTTP request per
transport invocation. So proofs Lemma 1 and Corollary 1 bound HTTP requests, not
only admissions (proofs Lemma 4).

---

## 8. Wait loop and wait accounting

### 8.1 Rules (R2-ARCH-04 preserved)

1. Each iteration takes a fresh reading and evaluates `P_cancel`, `P_term`,
   `exhausted`, `P_wait`, `P_dead`, then availability.
2. If all predicates hold, admit (§7.3).
3. Otherwise compute `freeAt` and `planned = max(freeAt − now, S_MIN)`.
4. Before sleeping, refuse if: `planned > W_MAX` → `RATE_BUDGET_EXHAUSTED`;
   `Wnow + planned > W_BUDGET` → `RATE_BUDGET_EXHAUSTED`;
   `now + planned > t0 + D_DISPATCH` → `STAGE_TIMEOUT`.
5. Sleep on a timer bound to `cancelSignal`. Waiting time accrues through §8.3.
6. Repeat. More than `I_MAX` iterations → `RATE_BUDGET_EXHAUSTED`.

### 8.2 Consequences

- **INV-05.** Every admission happens with `Wnow ≤ 900 000`. The budget can be
  exceeded by oversleep; an admission after it is exceeded cannot happen.
- **INV-06** is enforced by the gate (§7.8). The rule-4 deadline check only avoids
  pointless sleeps.

### 8.3 Queue and sleep accounting: union model (R3-ARCH-04)

A caller is **waiting** from the moment it enters `analyze()` (queue entry) until
it is admitted, refused or cancelled, **excluding** nothing. It waits in the queue
while another caller holds the slot, and it waits during its own sleeps. The
governor accounts **global** wait as the length of the union of waiting intervals
on the stage timeline:

```text
enterWaiting():  if waiters == 0: waitSince = nowMs();  waiters += 1
leaveWaiting():  waiters -= 1;  if waiters == 0: W += nowMs() - waitSince
Wnow(t)       =  W + (waiters > 0 ? t - waitSince : 0)
```

- **Entry and exit timestamps.** Enter at `analyze()` entry. Leave at admission
  (inside the §7.3 section, before entry creation), at refusal, or at cancellation.
- **Overlap with sleep.** A sleeping head and queued callers overlap in time.
  The union counts the overlap once, so there is no double counting.
- **Cancellation while queued.** Queue waits are bound to `cancelSignal`. On abort,
  every waiter rejects (FT0 exits the process in the same turn anyway).
- **Deadline.** Queue time is stage time, so it consumes the deadline naturally.
  A caller's first deadline check happens when it becomes head.
- **Budget.** Queue time counts toward the 900 s budget through `Wnow`.

**Meaning of the 900 s budget is unchanged in the supported scope.** With the
certified sequential generators, a caller enters `analyze()` only when no other
caller exists. The queue wait is then zero. The only waiting intervals are the
caller's own sleeps, plus the microseconds between entry and its first decision,
which the union also counts. So `W` equals the C3 sum of observed sleeps, up to
the time spent computing between entry and first sleep (sub-millisecond, and
conservative because it only adds). Queue time is nonzero only for concurrent
callers, and no current caller is concurrent. That is why C4 needs **no new PO
disposition** of the budget's meaning. If the PO prefers per-caller accounting for
a future concurrent caller, that is a separate decision (§19.3, informational).

Deterministic traces: proofs §4.2 (Q1–Q3).

---

## 9. Exchange outcome and usage accounting (R3-ARCH-01; PD-R11 A, PD-R12 A, PD-R12-I1)

### 9.1 The exchange record: six separate axes

Each admission opens one exchange record `slot`. The governor owns it. The gate
and the observer write to it. The governor seals it at settle, and later writes
are ignored.

| Axis | Values | Written by |
|---|---|---|
| A. Transport | `NOT_INVOKED` (gate refused) · `INVOKED_REJECTED` (fetch rejected: network, abort, timeout before headers) · `RESPONSE` | gate |
| B. HTTP | `none` · `2xx` · `REDIRECT_NOT_FOLLOWED` · `4xx` · `5xx`; plus `status` and a frozen map of the §7.6 rate headers only | gate |
| C. Body | `NOT_READ` (non-2xx; provider releases it) · `READ_FAILED` (timeout, oversize, invalid JSON) · `PARSED` | observer, see §9.6 |
| D. Content (provider level) | `PRESENT` · `ABSENT` (provider throws `INVALID_RESPONSE`). Generator-level validity is invisible to the governor and irrelevant to accounting. | inferred at settle from resolve vs. reject |
| E. Usage | `VALID(U)` · `MISSING` · `MALFORMED` · `UNAVAILABLE` | observer normalizer |
| F. Inner result | resolved content, or the rejection error | governor at settle |

**Usage classification** (axis E) depends only on axes C and E:

| Condition | Usage class |
|---|---|
| C = `PARSED`, usage object present, every required field valid, consistency holds (§9.3) | `VALID(U)` |
| C = `PARSED`, usage object absent or `null` | `MISSING` |
| C = `PARSED`, usage object present but any required field absent, non-integer, negative, `> U_MAX`, inconsistent, or the normalizer threw | `MALFORMED` |
| C ≠ `PARSED` (incl. A = `NOT_INVOKED`/`INVOKED_REJECTED`, redirects, non-2xx, read failure) | `UNAVAILABLE` |

Content validity (axis D) and the inner result (axis F) never change the usage
class.

### 9.2 Estimate and reservation (PD-R10)

Unchanged: `Res = ceil(utf8Bytes(system + user) / κ) + O + completionReserveTokens + reasoningReserveTokens`.
`Res > B_tok` → `RATE_REQUEST_EXCEEDS_BUDGET` with zero admissions.

### 9.3 Usage normalization (unchanged rules)

| Provider | Required | Optional | Consistency | `U` |
|---|---|---|---|---|
| Groq `usage` | `prompt_tokens`, `completion_tokens`, `total_tokens` | — | `total ≥ prompt + completion` | `total_tokens` |
| Gemini `usageMetadata` | `promptTokenCount`, `totalTokenCount` | `candidatesTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount` (absent = 0) | `total ≥ prompt + candidates + thoughts + toolUse` | `totalTokenCount` |

Every field used is an integer in `[0, U_MAX]`.

### 9.4 Charge rule: by usage class only

| Usage class | `charged` | Terminal effect |
|---|---|---|
| A = `NOT_INVOKED` (gate refused; nothing sent) | `Res` | per gate outcome (§7.8) |
| `VALID(U)` | `max(Res, U)`, whether the inner call resolved or rejected | none from accounting |
| `MISSING` | `B_tok` | none |
| `MALFORMED` | `B_tok` | sticky `RATE_ACCOUNTING_INVALID` (PD-R12-I1) |
| `UNAVAILABLE` | `B_tok` | none |

`charged ≥ Res` always. No refund. `charged > B_tok` is possible (for example
`U = 7 000`) and recorded unclamped. It blocks admission until expiry.

Reviewer counterexample (`Res = 3 400`, `B_tok = 6 800`, valid
`total_tokens = 7 000`, content absent): the provider parses the body, the observer
records `VALID(7 000)`, and the provider then throws `INVALID_RESPONSE`. At settle:
`charged = max(3 400, 7 000) = 7 000` (not 6 800). No terminal is set, and
`INVALID_RESPONSE` is rethrown (proofs §4.3 AC-13).

The `NOT_INVOKED` charge of `Res` (rather than `B_tok`) is exact: the gate proves no
transport invocation occurred. It still counts one request in the request ledger,
which is conservative. It occurs only on a terminal or cancellation path.

### 9.5 Saturation scope and expiry

Saturation (`charged = B_tok`) applies to the effective provider's token ledger in
this child process. The request ledger is unaffected. It expires at
`tSettle + W_HOLD`. Uncertain remote completion (axis A = `INVOKED_REJECTED` after
a possible send, a body timeout, or a cancellation) is `UNAVAILABLE` and saturates.
A retry is always a new admission and entry.

### 9.6 Observation ownership and delivery on both paths

- The governed child constructs providers with an internal-only `observer` whose
  single method is `onParsedBody(usageSubobject)`. The provider calls it once,
  **immediately after** `readBoundedResponseJson()` succeeds and **before** its
  content check (Groq after L233, before L243; Gemini after L241, before L253).
  It passes `body.usage` (Groq) or `body.usageMetadata` (Gemini) and nothing else.
  The call is wrapped so that an observer exception cannot change provider behavior.
- The observer marks axis C = `PARSED` and runs the §9.3 normalizer synchronously.
  It stores only `{class, U}`. The raw object is not retained.
- The normalizer is bounded. It performs a fixed set of own-property reads on a
  `JSON.parse` product (plain data, no getters), `Number.isInteger` and range
  checks, and one comparison. It never iterates unknown keys, never stringifies, and
  never copies values into messages. Any throw → `MALFORMED`.
- Because the observation is recorded **before** the provider decides between
  resolving and throwing, the governor reads the same sealed record on the resolve
  path and on the reject path. Known valid usage therefore survives content
  failure and exception unwinding (INV-17).
- The gate records axes A and B. The raw `Response`, body and other headers are
  never stored.
- Public outputs (envelope, stderr, IPC) never contain usage values, header values,
  provider messages or content (INV-16). Only closed reason codes leave.

### 9.7 Settlement procedure and terminal precedence

At settle (resolve or reject), with the sealed record `s`:

```text
1. if cancelSignal.aborted (or s.gate == CANCELLED): seal; rethrow the provider's cancellation error. (FT0 exits)
2. charge the entry by §9.4; set tSettle; apply hints and cooldown from axis B
3. if s.gate == DEADLINE:   refuse STAGE_TIMEOUT          (sticky)
4. if s.gate == DUPLICATE:  refuse RATE_ACCOUNTING_INVALID (sticky)
5. if usage == MALFORMED:   refuse RATE_ACCOUNTING_INVALID (sticky), even if content was present
6. otherwise: return the inner result unchanged (resolved content, or rethrow the original provider error)
```

Precedence: **cancellation > gate refusal > malformed-usage refusal > provider
outcome**. Accounting (step 2) happens before any throw on every path except
cancellation, where the process ends.

**INV-17.** On every non-cancelled settle, the entry's charge is determined by the
usage class alone. A `VALID(U)` observation is never discarded because the inner
call rejected or the content was invalid.

---

## 10. Provider-specific retry semantics (R2-ARCH-05 preserved)

The governor adds zero retries. Generators keep two attempts (PD-R1 open).

| Condition | Groq | Gemini | Usage class | Governor action |
|---|---|---|---|---|
| HTTP 408 | `TIMEOUT` / retryable | `UNKNOWN` / not retryable | UNAVAILABLE | none |
| HTTP 429 | `RATE_LIMIT` / retryable | `RATE_LIMIT` / retryable | UNAVAILABLE | cooldown; `RA > 65 s` → `exhausted` |
| HTTP 3xx (governed: not followed) | `UNKNOWN` / not retryable | `UNKNOWN` / not retryable | UNAVAILABLE | records `REDIRECT_NOT_FOLLOWED` |
| HTTP 401 / 403 | `AUTH` / no | `AUTH` / no | UNAVAILABLE | none |
| Other 4xx | `UNKNOWN` / no | `UNKNOWN` / no | UNAVAILABLE | none |
| HTTP 5xx | `UNKNOWN` / yes | `UNKNOWN` / yes | UNAVAILABLE | none |
| Transport error | `NETWORK` / yes | `NETWORK` / yes | UNAVAILABLE | none |
| Own 30 s timer (fetch or body) | `TIMEOUT` / yes | `TIMEOUT` / yes | UNAVAILABLE | none |
| SEC-C1 cancellation | `UNKNOWN` / no, no cause | same | — | rethrow; process exits |
| Body oversize / not JSON | `INVALID_RESPONSE` / no | same | UNAVAILABLE | none |
| 2xx parsed, content absent | `INVALID_RESPONSE` / no | same | by usage (VALID / MISSING / MALFORMED) | §9.7 |
| 2xx, content invalid for the model contract | generator correction retry | same | by usage | §9.7 |
| Gate refusal | provider maps to `NETWORK` | same | `NOT_INVOKED` | governor replaces it (§9.7) |
| Governor refusal before admission | `RATE_*` / `STAGE_TIMEOUT`, not retryable | same | no entry | sticky |

---

## 11. Closed failure propagation (R2-ARCH-02)

### 11.1 Problem

C3 fixed the normal-return path: a generator returns `{ok:false}` after a
non-retryable governor refusal. R3 found that the throw/unwind path was not
specified. When a stage function throws, the runner had only `{code}` and no
authoritative step or attempt count. The parent's exit-4 rule for missing counts
could then misclassify the failure. The design must also not relabel an unrelated
internal error as a governor refusal.

### 11.2 Runner-owned stage context

`generative-runner.js` creates one `StageContext` per governed child and passes it
to the governor. Only the runner and the governor write to it.

| Field | Written by | Meaning |
|---|---|---|
| `stage` | runner | `design`, `plan` or `generate` |
| `stepSeq` | runner | incremented by `beginStep()` before **every** generator invocation (each AutomationCandidate, plan and change set is its own step) |
| `step` | runner | closed label: `requirementModel`, `testCaseModel`, `automationCandidate`, `automationPlan`, `generatedChangeSet` |
| `calls` | governor | number of `analyze()` entries during the current `stepSeq`. It is reset by `beginStep()`. This is the authoritative count of real provider attempts: the baseline `providerAttempts` counts exactly the `analyze()` invocations of a generator call (generators increment it immediately before calling). |
| `terminal` | governor | `null`, or `{code, stepSeq, step, callOrdinal}`, set once at the first refusal (sticky) |
| `refusals` | governor | `WeakSet` of the exact error objects thrown by governor refusals |
| `cancelled` | derived | `cancelSignal.aborted` |

The governor increments `ctx.calls` at `analyze()` entry, before any check, and
records `terminal` and adds the error object to `refusals` before throwing a
refusal. No count is ever synthesized. Every number reported comes from
`ctx.calls` or from the generator's own `providerAttempts`.

### 11.3 Runner algorithm

```text
for each generator invocation g with label L:
  ctx.beginStep(L)
  try:
    r = await g(...)
  catch (e):
    return classifyThrow(e)
  if !r.ok: return classifyReturn(r)
  if ctx.terminal !== null: return failClosed()        // unreachable by construction
...
classifyReturn(r):                                     // NORMAL-RETURN PATH
  if ctx.cancelled: return NO_RESULT                   // FT0 is exiting
  t = ctx.terminal
  if t === null: return existing stepFailure(L, r)     // unchanged baseline
  n = isPositiveInt(r.providerAttempts) ? r.providerAttempts : ctx.calls   // ctx.calls ≥ t.callOrdinal ≥ 1
  if t.code == STAGE_TIMEOUT: return {kind:"stage-timeout", step: t.step, providerAttempts: n}
  return {kind:"generation", step: t.step, providerAttempts: n,
          codes: dedupe([t.code, ...failureCodes(r.errors)]).slice(0, 8)}

classifyThrow(e):                                      // THROW / UNWIND PATH
  if ctx.cancelled: return NO_RESULT
  t = ctx.terminal
  E1: if t !== null and ctx.refusals.has(e) and t.stepSeq == ctx.stepSeq:
        the generator rethrew the governor's own refusal: same result as classifyReturn,
        with providerAttempts = ctx.calls
  E2: if t !== null (and E1 does not apply):
        an unrelated exception after a refusal:
        {kind:"internal", code:"GENERATIVE_STAGE_FAILED", governorCode: t.code}
  E3: otherwise: {kind:"internal", code:"GENERATIVE_STAGE_FAILED"}  // unchanged baseline
```

A throw outside any generator invocation (runner code) is E3 unless a terminal
exists, in which case it is E2.

### 11.4 Child result shapes and parent classification

| Path | Child `failure` | Parent result |
|---|---|---|
| Return or E1, `RATE_*` | `{kind:"generation", step, providerAttempts ≥ 1, codes:[terminal, …]}` | `PROVIDER_FAILURE`, exit 6; reason codes start with the governor code |
| Return or E1, `STAGE_TIMEOUT` | `{kind:"stage-timeout", step, providerAttempts ≥ 1}` | `STAGE_TIMEOUT`, exit 6 |
| E2 | `{kind:"internal", code:"GENERATIVE_STAGE_FAILED", governorCode}` | `STAGE_FAILED`, exit 1. The message adds "(governor reason code: X)". `governorCode` is checked against `GOVERNOR_TERMINAL_CODES`; otherwise it is dropped. |
| E3 / ungoverned | unchanged | unchanged (`STAGE_FAILED`, exit 1) |

### 11.5 What this proves (details: proofs §4.6)

1. **A terminal refusal survives a generator exception.** If the generator rethrows
   the refusal object (E1), the result is identical to the normal-return path, with
   an attempt count from `ctx.calls` (≥ 1). If it throws anything else after the
   refusal (E2), the refusal code is still delivered, as `governorCode`.
2. **Unrelated internal errors are not relabelled.** E2 and E3 keep
   `GENERATIVE_STAGE_FAILED` → `STAGE_FAILED` / exit 1. A governor code becomes the
   primary classification only if the thrown object is the governor's own refusal
   (identity, not message or code matching) in the same step. A wrapped or copied
   error is not treated as the refusal (E2).
3. **Correct envelope and exit status.** `providerAttempts ≥ 1` on every
   governor-classified result, so the parent's exit-4 rule cannot trigger.
   `STAGE_TIMEOUT` → 6; `RATE_*` → 6 inside `PROVIDER_FAILURE`; E2 → 1.
4. **External compatibility.** Ungoverned runs create no context and no governor,
   so results are byte-identical (INV-13). Generator sources and their return
   contracts are unchanged. New IPC members are private and governed-only. Public
   codes are those of §15.

### 11.6 Precedence (highest first)

| # | Outcome | CLI result |
|---|---|---|
| 1 | Parent IPC loss (SEC-C1) | child exits 1 with no result; the parent outcome is decided by what ended it (PD-R6) or `STAGE_FAILED` (1) |
| 2 | Parent enforcement kill | `STAGE_TIMEOUT`, 6; any stored result discarded |
| 3 | Parent watchdog kill | `CHILD_UNRESPONSIVE`, 1; any stored result discarded |
| 4 | Governor `STAGE_TIMEOUT` (pre-admission or gate) | `STAGE_TIMEOUT`, 6 |
| 5 | Governor `RATE_*` (incl. malformed usage) | `PROVIDER_FAILURE`, 6, governor code first |
| 6 | Internal exception after a refusal (E2) | `STAGE_FAILED`, 1, with the governor reason code |
| 7 | Existing generator / provider failure | unchanged |
| 8 | Existing input refusal before any provider call | unchanged (exit 4); the governor is never reached |

Rules 2–3 come from the parent's sticky `killed` reason only.

### 11.7 Future implementation touchpoints (not implemented)

`generative-runner.js`: `StageContext`, `beginStep()` before each generator call
in its own `runDesign` / `runPlan` / `runGenerate`, `classifyReturn` /
`classifyThrow`, and the new failure kinds. `generative.js`
`classifyChildFailure()`: `stage-timeout`, `governorCode` and killed reasons.
`run-artifacts.js`: separate `GOVERNOR_REASON_CODES` allowlist. Governor module:
`ctx` writes. **No generator file changes.**

---

## 12. Cancellation (DRIFT-01 preserved)

The governor uses the certified process-scoped `parentLink.signal`, the same object
passed to `bindCancelSignal()`. It creates no competing mechanism or handler.

| Event | Effect |
|---|---|
| Parent `disconnect` while running | FT0 `fail()`: abort, then `process.exit(1)` in the same turn |
| Queued or sleeping caller | its wait is bound to the signal and rejects (defense in depth) |
| Between admission and transport | the gate checks `P_cancel` and does not invoke `fetch` (§7.8) |
| In-flight fetch | the provider's certified signal link aborts it |
| `analyze()` after abort | `P_cancel` is first in every gate; zero admissions |
| Governor disabled | SEC-C1 exactly as certified (PD-R14) |

**INV-10.** After `cancelSignal` aborts, no admission and no transport invocation
occurs. No signal handler is added (PD-R6).

---

## 13. Process and IPC lifecycle (DRIFT-02 preserved; PD-R15)

### 13.1 Unchanged FT0 protocol

The result is sent with a random receipt. The parent stores the first result in
memory and then ACKs it. Only the matching ACK counts as delivery, even if it
overtakes the send callback. Missing ACK within `ACK`, a send error or parent loss
→ child exit 1. Delivered → `setImmediate` disconnect. The ACK means "stored in
parent memory", not "committed".

### 13.2 Governed additions

| Addition | Rule |
|---|---|
| Payload member | `governor:{provider, tokensPerMinute, requestsPerMinute, completionReserveTokens, reasoningReserveTokens}`, closed and range-checked; invalid → `STAGE_PAYLOAD_INVALID` |
| Heartbeat | `{type:"heartbeat", seq}`, `seq` strictly increasing `1 … 2^31 − 1`; first at `t0`, then every `HB`; send callback ignores errors |
| Heartbeat stop | cleared at `report()` and in FT0 `fail()` |
| Watchdog | parent timer `WD` from `tSpawn`; re-armed by valid heartbeats while no result is stored; disarmed when a result is stored. Invalid heartbeats are ignored. |
| Enforcement timer | parent timer at `tSpawn + K_PARENT`, armed until settlement |

### 13.3 Child timers

At `report()` and `fail()` the heartbeat interval is cleared. The governor has no
timer outside an active `analyze()`. No child self-deadline timer and no new abort
source exist. The child-side deadline is the gate (§7.8) plus the provider's
30 s timer.

### 13.4 Parent message handling

```text
on message m:
  if killed: return
  if valid heartbeat and result === null: re-arm watchdog; return
  if m.type == "result" and result === null: (FT0) store, ACK; disarm watchdog
  else ignore
```

### 13.5 Kill decision

When the watchdog or the enforcement timer fires before settlement, at parent
reading `tKill`:

1. `killed = {reason}` (`STAGE_TIMEOUT` or `CHILD_UNRESPONSIVE`); first reason wins, sticky.
2. `result = null`. A stored or ACKed result is discarded.
3. Disarm the watchdog and enforcement timers.
4. `child.kill("SIGKILL")` inside `try` (POSIX SIGKILL; Windows `TerminateProcess`).
   The return value or exception is recorded as `killIssued: true | false`.
5. Arm the **post-kill settlement timer** `K_SETTLE` (§13.8).

The parent does **not** disconnect IPC at the kill decision. On Windows, a
parent-side `disconnect()` can stop `close` from ever firing. That would turn
every normal kill into a `CAE`-delayed settlement.

### 13.6 Settlement and acceptance

Settle on the first of: `close`; FT0 `CAE` after `exit`; `K_SETTLE` expiry
(§13.8); spawn `error`. Accept (validate, then commit) only if a result is stored,
`exitCode === 0`, `killed === null` and settlement was by `close`. Otherwise
nothing is written (**INV-12**).

### 13.7 Platform differences

| Aspect | POSIX | Windows |
|---|---|---|
| Kill | SIGKILL, uncatchable. Once delivered, the process never returns to user mode, so no JavaScript runs. | `TerminateProcess`. Once termination begins, no user-mode code runs. The process object can linger while I/O completes. |
| Kill → `exit` latency | not bounded by the OS for a task in uninterruptible I/O | not bounded while pending I/O drains |
| `close` after `exit` | normally prompt | may never arrive if IPC data is unread (FT0-C2-D1); `CAE` handles it |
| Parent-side `disconnect()` | `close` follows normally | `close` may not fire. Hence no disconnect at the kill decision (§13.5). |
| After the CLI exits | an unreaped child is reparented to init, which reaps it | libuv places spawned children in a job object; closing the parent's job handle is expected to terminate them (to be verified, M T-D2-14) |
| User interrupt | `128 + n` | `0xC000013A` |
| Timer granularity | ≈ 1 ms | ≈ 15.6 ms by default |

### 13.8 Bounded post-kill settlement (PD-R15)

**Phase K** starts at `tKill` (§13.5). It ends at the first of:

| Event | Next |
|---|---|
| `exit` | clear `K_SETTLE`; FT0 phase S (`close`, or `CAE` after `exit`) |
| `close` | settle normally (result already discarded) |
| spawn `error` | settle |
| `K_SETTLE` expiry (first timer callback at or after `tKill + K_SETTLE`) with no `exit` | **abandonment** |

Abandonment procedure (one-shot, then `settled = true`):

1. If `child.connected`, call `child.disconnect()` inside `try`. If the child is
   still running JavaScript (for example `killIssued === false`), this fires its
   certified SEC-C1 `disconnect` path: abort and `process.exit(1)`, with zero
   further transport invocations (INV-10).
2. Destroy `child.stdout` and `child.stderr` if present.
3. `child.unref()`, so the child handle cannot keep the parent's event loop alive.
4. Clear every parent timer the governed path armed (watchdog, enforcement,
   `K_SETTLE`, `CAE`).
5. Settle once with `result = null`, `exitCode = null`, `signal = null` and
   `abandoned = true`. The classification is `killed.reason`: `STAGE_TIMEOUT` (6)
   or `CHILD_UNRESPONSIVE` (1). No new code, and no commit.
6. Emit one fixed-template stderr line:
   `[qa-agent] <stage> process did not exit within <K_SETTLE/1000>s after termination (pid <n>); it was abandoned and may still be finishing.`
   It contains an integer pid and no secrets.
7. Late `exit`, `close` or messages after settlement are ignored (the certified
   `settled` guard, L134/L140/L147).

Responsibility for a possibly surviving child:

- **Kill delivered** (POSIX SIGKILL or Windows termination started): no user-mode
  code runs again, so no new provider request can start. Only the kernel may
  finish I/O already in progress. The product does not wait for it. The OS reaps
  or reclaims the process: init on POSIX; job-object closure or process exit on
  Windows.
- **Kill not delivered** (`killIssued === false`, or an unknown failure): step 1's
  disconnect engages SEC-C1 in the child. Its governor also still enforces the gate
  deadline. If the child cannot observe the disconnect either (its event loop is
  blocked), it can make no request while blocked. When it unblocks, the
  `disconnect` event is delivered first and SEC-C1 runs. This last point relies on
  Node delivering the queued `disconnect` before any new provider work, which is
  certified FT0 behavior.
- In every case the CLI reports the kill reason and writes nothing. The stderr line
  tells the operator that a process may linger.

Bound (**INV-18**, ALGORITHMIC on the parent clock): after `tKill`, the parent
settles at the first timer callback at or after `tKill + K_SETTLE` if `exit` has
not arrived. If `exit` arrives at `tExit < tKill + K_SETTLE`, the parent settles no
later than the first callback at or after `tExit + CAE`. So the parent's settlement
decision is due by `tKill + K_SETTLE + CAE` at the latest, plus timer lateness `ε`.
This bounds a **phase**, not the whole CLI (§14).

**`K_SETTLE` value: PROPOSED 10 000 ms, NOT APPROVED.** Justification and
alternatives are in §19.2. The design is complete for any approved value in
`[1 000, 60 000]`. Only the constant changes.

---

## 14. Deadline and termination phases (R2-ARCH-03 via R3-ARCH-02; D+15 A)

| Phase | Clock / origin | Boundary | On violation |
|---|---|---|---|
| G1 — admission | child, `t0` | admission only at a fresh reading `≤ t0 + D_DISPATCH` | `STAGE_TIMEOUT` |
| G2 — transport invocation | child, gate reading | `tDispatch ≤ t0 + D_DISPATCH` (INV-06) | gate refusal → `STAGE_TIMEOUT`, zero invocations |
| G3 — exchange | child, provider timer | aborted at the first callback `≥ analyze start + T_REQ` (certified) | provider `TIMEOUT` |
| W — wait | child, union `W` | `Wnow ≤ 900 000` at every admission | `RATE_BUDGET_EXHAUSTED` |
| P — post-response processing | child | not bounded by the governor; liveness via heartbeat | phase H |
| H — heartbeat liveness | parent | silence `≤ WD` while no result is stored | kill, `CHILD_UNRESPONSIVE` (1) |
| E — enforcement | parent, `tSpawn` | decision at the first callback `≥ tSpawn + K_PARENT` | kill, `STAGE_TIMEOUT` (6) |
| A — result transfer | child, `report()` | ACK within `ACK` (FT0) | child exit 1 |
| K — termination | parent, `tKill` | ends at `exit`/`close`/`error`, or abandonment at the first callback `≥ tKill + K_SETTLE` (PD-R15; value pending) | abandonment (§13.8) |
| S — settlement | parent, `tExit` | `close`, or `CAE` after `exit` (FT0) | settle with `result = null` |
| V — validation and commit | parent | not bounded (synchronous validation and writes); only on accepted results | existing errors |

Statements that hold:

- ALGORITHMIC, child clock: no governed transport invocation at a gate reading
  `> t0 + 1 770 000`.
- ALGORITHMIC, parent clock: kill decision at the first callback
  `≥ tSpawn + 1 815 000` if not settled. Settlement decision after a kill at the
  first callback `≥ tKill + K_SETTLE`, or `≥ tExit + CAE`.

Statements that do **not** hold:

- "The CLI settles by 1 815 s." Phases K, S and V, and timer lateness, come after
  it. With an approved `K_SETTLE`, the post-kill decision is due by `K_SETTLE + CAE`
  after `tKill`, plus `ε`. That is a phase bound, not a whole-CLI bound.
- "No HTTP bytes leave after 1 770 s." Wire timing is not observable (§7.8).
- "The 900 s budget binds before the deadline." It does not in general (proofs §5).
- Node does not guarantee timer punctuality. Every timer boundary means "at or after".

---

## 15. Closed reason-code mapping

| Code | Where | Origin | Exit | Reachable when |
|---|---|---|---:|---|
| `RATE_REQUEST_EXCEEDS_BUDGET` | reason code in `PROVIDER_FAILURE` | `Res > B_tok` | 6 | governed |
| `RATE_BUDGET_EXHAUSTED` | reason code in `PROVIDER_FAILURE` | wait cap, budget, iteration cap, over-cap hint | 6 | governed |
| `RATE_ACCOUNTING_INVALID` | reason code in `PROVIDER_FAILURE` | malformed usage (PD-R12-I1); clock regression; duplicate transport invocation | 6 | governed |
| `STAGE_TIMEOUT` | top-level `errors[].code` | admission or gate deadline; parent enforcement kill | 6 | governed |
| `CHILD_UNRESPONSIVE` | top-level `errors[].code` | parent watchdog | 1 | governed |
| `PROVIDER_GOVERNOR_LIMITS_MISSING` | top-level `errors[].code` | enabled, no limits for the effective provider | 3 | v2 enabled |

Governor codes can also appear as an additional reason in a `STAGE_FAILED` (1)
message (E2, §11.4). None is reachable with v1 or a disabled governor.

## 16. Invariants

| ID | Invariant |
|---|---|
| INV-01 | Every admission occurs at a fresh reading at which all §7.2 predicates hold, linearized at entry creation. |
| INV-02 | Any half-open 65 s interval holds ≤ `B_req` and ≤ `floor(B_tok / Res_min)` admissions, transport invocations and (under T1) HTTP requests (proofs Lemma 1, Lemma 4). |
| INV-03 | One entry per admission; never released while live; `charged` monotone and `≥ Res`; unsettled entries never expire. |
| INV-04 | `charged ∈ {Res (not invoked), max(Res, U), B_tok}`. Missing, malformed or unavailable usage is never zero. |
| INV-05 | Every admission has `Wnow ≤ W_BUDGET` (union model); every sleep starts only if `Wnow + planned ≤ W_BUDGET`. |
| INV-06 | Every transport invocation has a gate reading `≤ t0 + D_DISPATCH`. |
| INV-07 | No admission before `t0 + C_COLD`. |
| INV-08 | ≤ 1 admission per `analyze()`, ≤ 1 transport invocation per admission, ≤ 1 HTTP request per transport invocation (T1); zero governor retries; ≤ 1 admitted send outstanding. |
| INV-09 | `ctx.terminal` is sticky; afterwards every `analyze()` refuses with zero admissions. |
| INV-10 | After cancellation, zero admissions and zero transport invocations. |
| INV-11 | A terminal refusal reaches the envelope on both the return and the unwind path, as primary classification (return, E1) or as `governorCode` (E2), unless a higher-precedence outcome applies. Unrelated exceptions keep `STAGE_FAILED`. |
| INV-12 | Commit only if a result is stored, `exitCode === 0`, `killed === null` and settlement was by `close`. |
| INV-13 | v1 or disabled governor: spawn, environment, provider construction (default `fetch` and redirect mode), IPC, exit codes and output identical to baseline; SEC-C1 present. |
| INV-14 | All accounting values are safe integers. |
| INV-15 | Hints only tighten; invalid hints are ignored. |
| INV-16 | No prompt, content, key, raw header, raw usage or raw provider error reaches IPC, logs or the envelope. |
| INV-17 | Charges depend only on the usage class; valid usage survives rejection and content failure. |
| INV-18 | After a kill decision, parent settlement is decided by `tKill + K_SETTLE` (no `exit`) or `tExit + CAE`, at or after those instants; abandonment discards the result. |

## 17. Non-guarantees

C4 does **not** guarantee:

1. Compliance with any provider's TPM, RPM, RPD or TPD accounting (PD-R10).
2. Isolation from other processes, earlier invocations or other tools on the account.
3. That an aborted or timed-out request was not processed or charged remotely.
4. Estimator accuracy.
5. Provider header meanings (PD-R9).
6. Timer punctuality, or any wall-clock bound across system suspend.
7. The time at which HTTP bytes physically leave the host after a transport invocation.
8. T1 on Node versions other than those verified by M T-R3-03.
9. That an abandoned child has exited when the CLI ends; only that it can start no new request.
10. Parent validation and commit time (phase V), or whole-CLI settlement time.
11. Completion of any particular N.
12. That a healthy child is never killed by the watchdog if one synchronous segment
    or result transfer exceeds about 45 s without heartbeats (proofs §5.5).

## 18. Future implementation touchpoints (design only)

| Area | Expected change |
|---|---|
| New internal governor module(s) | ledgers, estimator, normalizer, hints, wait loop with union accounting, gate, exchange record, `ctx` writes; requires a package-surface inventory update and external install proof (C2:444) |
| `providers/groq-provider.js`, `gemini-provider.js` | internal `observer.onParsedBody()` call between bounded read and content check; nothing else (`fetchImpl` injection already exists) |
| `providers/index.js` | internal pass-through of the gate and observer for the governed child only |
| `cli/generative-runner.js` | `StageContext`, `beginStep()`, `classifyReturn` / `classifyThrow`, governor construction, heartbeat start/stop |
| `cli/stage-process.js` | governed-only heartbeat validation, watchdog, enforcement, kill sequence, `K_SETTLE` abandonment |
| `cli/generative.js` | `stage-timeout`, `governorCode`, killed reasons, abandonment diagnostic |
| `cli/run-artifacts.js` | `GOVERNOR_REASON_CODES` allowlist |
| `cli/config-file.js` | schema v2 |
| Contract docs | contract §10.7 reason codes and §11 schema v2 (separate canonical amendment) |

Generators: **no change.**

## 19. Open PO decisions

### 19.1 Unchanged open decisions

| ID | C4 assumption | Blocking for design review? |
|---|---|---|
| PD-R1 | two attempts | No |
| PD-R4 | no completion cap | No |
| PD-R7 | generative scope only | No |
| PD-R9 | no real-provider calls | No; required before S4 |

### 19.2 PD-R15 `K_SETTLE` value: disposition requested

The bounded-settlement **direction** is approved; the **number** is not.

| Option | Pros | Cons |
|---|---|---|
| 2 000 ms | shortest CLI hang after a kill | likelier to abandon a child that would have exited under CI load (safe, but noisier) |
| 5 000 ms | short | same risk, smaller |
| **10 000 ms (proposed)** | same scale as the certified FT0 `ACK` and `CAE` bounds (10 s each); orders of magnitude above normal kill → `exit` latency (milliseconds); post-kill decision due by `K_SETTLE + CAE = 20 s` | 10 s extra hang only in the rare no-`exit` case |
| 30 000 ms | fewer abandonments on very slow hosts | longer hang; exceeds every existing lifecycle constant |

Technical justification for 10 000 ms: a delivered SIGKILL or `TerminateProcess`
normally produces `exit` within milliseconds. Only uninterruptible kernel I/O or a
heavily loaded host delays it. Abandonment is safe in every case: the result is
discarded and no new request can start (§13.8). So the value trades only CLI
latency against diagnostic noise. Matching the certified 10 s FT0 constants keeps
one lifecycle time scale.

**Requested disposition:** "PD-R15: approve `K_SETTLE = 10 000 ms` as a product
constant on the governed path only, or choose another value in
`[1 000, 60 000]` ms." Implementation of the post-kill path is gated on this
disposition. The design itself is complete for any value in that range.

### 19.3 Informational (no decision required now)

- Per-caller queue-wait accounting for a future concurrent caller (§8.3). Not
  needed in the supported sequential scope.
- Acknowledgement that the deadline is enforced at the transport-invocation boundary
  (§7.8). No approved contract text changes.

## 20. Change log

| Rev | Change |
|---|---|
| C3 (`eff78a0c`) | Initial consolidated corrective for R2. |
| C4 | §7.3 linearization and the "time passes" rule; §7.8 governed transport gate (fresh deadline and cancellation check at `fetchImpl`, one invocation per admission); §7.9 `redirect: "manual"` with fail-closed 3xx; §8.3 union wait accounting incl. queue; §9 six-axis exchange record, observation before the content check, charge by usage class on both paths, explicit terminal precedence; §11 runner-owned `StageContext` with return and unwind paths (E1/E2/E3); §13.5–§13.8 kill sequence without disconnect and bounded post-kill settlement (PD-R15, value pending); §16 INV-01/02/04/05/06/08/11/12/13 revised, INV-17/18 added; PD-R12-I1 recorded as approved; `D_DISPATCH` constant. |
