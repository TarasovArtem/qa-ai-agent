# OD-RATE-1-C2-R3 — Proofs, Traces and Bounds (Consolidated Corrective C4)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-proofs.md` (2 of 3; companions: [design](od-rate-1-c2-r3-design.md), [review matrix](od-rate-1-c2-r3-review-matrix.md)) |
| Revision | C4 (supersedes C3 at `eff78a0c`) |
| Status | **DESIGN EVIDENCE — PENDING INDEPENDENT HEAVY REVIEW.** Nothing here is an implementation test result. |
| Baseline | `main` `a32a6cd7e0a1bdc9917fc3abc7f692039591a145` / tree `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Reproducibility | Every number is either derived inline or produced by **two independent artifacts** in §8: a ledger simulator (§8.1) and a closed-form checker that shares no code with it (§8.2). A localhost-only redirect experiment is in §8.3. None touches the network beyond `127.0.0.1`, the repository or a provider. |

Symbols are those of design §6.1. Seconds in prose; integer milliseconds in scripts.

---

## 1. Model and assumptions

| ID | Assumption | Used by |
|---|---|---|
| A1 | One governor per child; at most one admitted send outstanding (design §7.4). | all |
| A2 | Monotonic clock readings are exact. Time passes between any two readings, including inside synchronous code. Timer callbacks may fire late by any amount `ε ≥ 0`. | §3, §4.4 |
| A3 | Each send's duration `d` (admission to settle) is `≤ T_REQ + ε` (certified provider timer). Tables use `d ≤ 30 s`. | §5 |
| A4 | `c` = caller time between one settle and the next `analyze()` call. Tables use `c = 0`; §5.5–§5.6 treat `c > 0`. | §5 |
| A5 | Heavy: `Res > B_tok/2`. Light: `B_tok/3 < Res ≤ B_tok/2`. `B_tok = 6 800`, `B_req = 30` unless stated. | §5 |
| A6 | Requests per stage per C2:688–689: `design` `N + 2` / `2(N + 2)`; `plan`/`generate` `≤ N` / `≤ 2N`. | §5.3 |
| T1 | With `redirect: "manual"`, no proxy, and a non-idempotent POST, one `fetch()` call emits at most one HTTP request. Observed on Node 22.23.3 and 24.22.1 (§8.3). Must be re-verified per supported Node line (M T-R3-03). | Lemma 4 |
| H1 | A healthy governed child yields to its event loop at least every `≈ WD − HB = 35 s`, so heartbeats reach the parent within `WD`. Long `c` must be made of shorter synchronous segments. | §5.5 |

**ALGORITHMIC** statements follow from governor decisions and clock readings and
hold for any `ε`. **OS** statements depend on scheduling, kill delivery, I/O or
transport internals. C4 makes no quantitative OS claim.

---

## 2. Algorithm (normative pseudocode, C4)

```text
// ---------------- construction (governed child only) ----------------
Governor(cfg, cancelSignal, ctx, nowMs):
  t0 = nowMs(); coldUntil = t0 + C_COLD; cooldownUntil = t0
  B_tok = floor(cfg.tokensPerMinute * 0.85); B_req = cfg.requestsPerMinute
  entries = []; W = 0; waiters = 0; waitSince = null
  hintTok = hintReq = null; exhausted = false; slot = null; queue = FIFO()
  inner = provider built with fetchImpl = gate and observer = Observer()   // design §7.8, §9.6

live(t)  = entries where e.tSettle == null or t < e.tSettle + W_HOLD
Wnow(t)  = W + (waiters > 0 ? t - waitSince : 0)
enterWaiting(): if waiters == 0: waitSince = nowMs();  waiters += 1
leaveWaiting(): waiters -= 1; if waiters == 0: W += nowMs() - waitSince

refuse(code):
  if ctx.terminal == null: ctx.terminal = {code, stepSeq: ctx.stepSeq, step: ctx.step, callOrdinal: ctx.calls}
  err = ProviderError(fixedMessage(ctx.terminal.code), {code: ctx.terminal.code, retryable: false})
  ctx.refusals.add(err); throw err

// ---------------- one outer call ----------------
analyze(req):
  ctx.calls += 1
  enterWaiting()
  try:
    await queue.enter(cancelSignal)                  // FIFO; rejects on abort
    if cancelSignal.aborted: throw cancelledError()
    if ctx.terminal != null: refuse(ctx.terminal.code)
    res = ceil((utf8(req.systemPrompt) + utf8(req.userPrompt)) / 3.0) + 32
          + cfg.completionReserveTokens + cfg.reasoningReserveTokens
    if res > B_tok: refuse(RATE_REQUEST_EXCEEDS_BUDGET)
    for it in 0 .. :
      t = nowMs()                                    // fresh reading
      if cancelSignal.aborted: throw cancelledError()
      if ctx.terminal != null: refuse(ctx.terminal.code)
      if exhausted: refuse(RATE_BUDGET_EXHAUSTED)
      if Wnow(t) > W_BUDGET: refuse(RATE_BUDGET_EXHAUSTED)
      if t > t0 + D_DISPATCH: refuse(STAGE_TIMEOUT)
      f = freeAt(res, t)
      if f <= t:
        // ---- linearized admission (no await) ----
        leaveWaiting()
        e = {tAdmit: t, tSettle: null, res, charged: res}; entries.push(e)
        slot = {entry: e, dispatchDeadline: t0 + D_DISPATCH, dispatched: false, sealed: false,
                gate: null, transport: "NOT_INVOKED", http: "none", status: null,
                rateHeaders: null, body: "NOT_READ", usage: null}
        queue.leaveHead()
        break
      if it >= I_MAX: refuse(RATE_BUDGET_EXHAUSTED)
      planned = max(f - t, S_MIN)
      if planned > W_MAX: refuse(RATE_BUDGET_EXHAUSTED)
      if Wnow(t) + planned > W_BUDGET: refuse(RATE_BUDGET_EXHAUSTED)
      if t + planned > t0 + D_DISPATCH: refuse(STAGE_TIMEOUT)
      a = nowMs(); await sleep(planned, cancelSignal); b = nowMs()
      if b < a: refuse(RATE_ACCOUNTING_INVALID)
  catch err:
    if waiting(this caller): leaveWaiting(); queue.leave()
    throw err
  return await settle(slot, inner.analyze(req))       // provider runs; it calls gate() at most once

// ---------------- gate (closest enforceable transport boundary) ----------------
gate(url, init):
  s = slot; t = nowMs()                                // fresh reading
  if s == null or s.sealed or s.dispatched: if s: s.gate = "DUPLICATE"; throw GateRefusal()
  if cancelSignal.aborted: s.gate = "CANCELLED"; throw abortError()
  if t > s.dispatchDeadline: s.gate = "DEADLINE"; throw GateRefusal()
  s.dispatched = true; s.tDispatch = t; s.transport = "INVOKED_REJECTED"
  res = await realFetch(url, {...init, redirect: "manual"})    // rejection leaves INVOKED_REJECTED
  s.transport = "RESPONSE"; s.status = res.status; s.rateHeaders = pickRateHeaders(res.headers)
  s.http = (300 <= res.status <= 399 or res.type == "opaqueredirect") ? "REDIRECT_NOT_FOLLOWED"
         : res.ok ? "2xx" : (res.status < 500 ? "4xx" : "5xx")
  return res

// ---------------- observer (provider calls it after a successful bounded JSON read) ----------------
Observer.onParsedBody(usageSubobject):
  s = slot; if s == null or s.sealed: return
  s.body = "PARSED"
  try: s.usage = normalize(provider, usageSubobject)   // {class: VALID, U} | {class: MISSING} | {class: MALFORMED}
  catch: s.usage = {class: "MALFORMED"}

// ---------------- settlement ----------------
settle(s, p):
  try: out = await p; ok = true  catch e: err = e; ok = false
  s.sealed = true; slot = null
  if cancelSignal.aborted or s.gate == "CANCELLED": throw (ok ? cancelledError() : err)
  cls = (s.transport == "NOT_INVOKED") ? "NOT_INVOKED"
      : (s.body == "PARSED") ? s.usage.class : "UNAVAILABLE"
  s.entry.tSettle = nowMs()
  s.entry.charged = cls == "NOT_INVOKED" ? s.entry.res
                  : cls == "VALID"       ? max(s.entry.res, s.usage.U)
                  :                        B_tok                      // MISSING, MALFORMED, UNAVAILABLE
  applyHintsAndCooldown(s)                             // from s.status / s.rateHeaders only
  if s.gate == "DEADLINE":  refuse(STAGE_TIMEOUT)
  if s.gate == "DUPLICATE": refuse(RATE_ACCOUNTING_INVALID)
  if cls == "MALFORMED":    refuse(RATE_ACCOUNTING_INVALID)
  if ok: return out
  throw err                                            // original provider error, unchanged
```

`freeAt` is unchanged from C3: the earliest `t' ≥ t` at which `P_cold`, `P_cool`,
`P_req`, `P_tok` and hint conditions hold, given that live entries only expire.

---

## 3. Lemmas

**Lemma 1 (admission occupancy).** For any half-open 65 s interval `I`,
admissions in `I` number at most `B_req` and at most `floor(B_tok / Res_min)`.

*Proof.* Let `s_L` be the last admission reading in `I`, and `s_j < s_L` another one
in `I`. Then `tSettle_j ≥ s_j`, so entry `j` expires at `≥ s_j + 65 > s_L`, and an
unsettled entry never expires. So `j` is live at `s_L`. Admission at `s_L` required
`reqLive + 1 ≤ B_req` and `tokLive + Res_L ≤ B_tok`, with every live charge
`≥ Res_min`. ∎

**Corollary 1.** Admission readings lie in `[65, 1 770] s` (INV-07, `P_dead`).
That span is covered by `⌈1 705.001 / 65⌉ = 27` half-open 65 s intervals, so
`k ≤ 27 · n_max` admissions per stage, with `n_max = min(B_req, floor(B_tok / Res_min))`.
This holds for any durations, retries and caller processing. R3 independently
confirmed it.

**Lemma 2 (wait budget, union model).** No admission occurs with `Wnow > 900 000`.
*Proof.* `Wnow` is evaluated at a fresh reading in the same iteration as the
admission, after every sleep. ∎

**Lemma 3 (transport-invocation deadline, INV-06).** Every transport invocation
has a gate reading `≤ t0 + 1 770 000`. *Proof.* The gate takes its own fresh reading
after all provider setup, and calls `fetch` only if that reading passes. No code
under governor control runs between that reading and the call into `fetch` except
the `slot` update. ∎ The lemma bounds the invocation, not wire emission (design §7.8).

**Lemma 4 (one entry, one invocation, one HTTP request).** (a) Entries correspond
one-to-one with admissions. (b) Each admission has at most one transport invocation:
the gate sets `dispatched` and refuses a second call. (c) Under T1, each invocation
emits at most one HTTP request: `redirect: "manual"` forbids redirect hops. (d) Lemma 1
extends to transport invocation times `g`. Let `g_j < g_L` be in a 65 s interval.
By A1, `L` was admitted after `j` settled, so `s_L ≥ tSettle_j ≥ g_j`. Then
`s_L ≤ g_L < g_j + 65 ≤ tSettle_j + 65`, so `j` is live at `s_L`. The rest is as in
Lemma 1. Hence INV-02 bounds HTTP requests under T1. ∎

**Lemma 5 (validity between admission and gate).** From the admission reading `t_a`
to the gate reading `t_g`: no entry is created (`slot` is held, A1); no hint or
cooldown changes (applied only at settle); no waiting accrues (no sleep). Entries
can only expire. So `P_req`, `P_tok`, `P_cold`, `P_cool` and `P_wait`, true at
`t_a`, remain true at `t_g`. Only `P_dead` and `P_cancel` can change, and the gate
re-checks both. ∎

**Lemma 6 (two-slot bound with zero caller processing).** Assume A1, `c = 0`, and
at most two live entries at any admission (`n_max = 2`). Then `k ≤ 41` per stage.

*Proof.* Let admissions be `s_1 < … < s_k`, durations `d_i`, settles
`e_i = s_i + d_i`, and gaps `w_1 = s_1 − t0 ≥ 65` (cold start), `w_{i+1} = s_{i+1} − e_i`.
With `c = 0`, every gap is waiting, so the observed wait at `s_k` is
`W = Σ_{i ≤ k} w_i ≤ 900` (Lemma 2), and `s_k = W + Σ_{i<k} d_i`. Admission
`i + 2` needs entry `i` expired (two slots), so `s_{i+2} ≥ e_i + 65`. Writing
`s_{i+2} − s_i = d_i + w_{i+1} + d_{i+1} + w_{i+2}` gives
`d_{i+1} + w_{i+1} + w_{i+2} ≥ 65`. Summing over `i = 1 … k−2`:

```text
65(k−2) ≤ (Σ_{j=2}^{k−1} d_j) + (W − w_1 − w_k) + (W − w_1 − w_2)
        ≤ Σ_{j<k} d_j + 2W − 130                       (w_1 ≥ 65, others ≥ 0)
65k     ≤ Σ_{j<k} d_j + 2W = s_k + W ≤ 1 770 + 900 = 2 670   →   k ≤ 41
```

The variable-duration trace in §5.6 attains `k = 41` with `65·41 = 2 665 = 1 770 + 895`. ∎

With `c > 0`, the identity `s_k = W + Σ d` becomes `s_k = W + Σ d + Σ c`, and
Lemma 6 no longer applies. Only Corollary 1 (`k ≤ 54`) remains (§5.6).

**Lemma 7 (accounting survives rejection).** The observer writes the usage class
before the provider's content check. `settle` reads the sealed record on both
branches and charges by class before throwing anything. So for a `VALID(U)`
observation the charge is `max(Res, U)` whatever the inner outcome or later
exception (INV-17). ∎

---

## 4. Traces

### 4.1 RPM counterexample (R2-ARCH-01; unchanged)

`B_req = 1`, `B_tok = 6 800`, `Res = 3 201`, first request 0.1 s. Admission 1 at
65.0 s settles at 65.1 s (expires 130.1 s). Candidate 2 at 65.1 s: tokens
`6 402 ≤ 6 800` ✓, requests `1 + 1 > 1` ✗. It sleeps 65.0 s (waited 130.0 s) and
is admitted at 130.1 s. Under C4, gate readings follow admissions by at most the
provider setup time, and Lemma 4(d) bounds transport invocations. Simulator table A
reproduces 65.0 / 130.1 s.

### 4.2 Wait accounting (R2-ARCH-04 preserved; R3-ARCH-04)

| Trace | Start | Steps | Result |
|---|---|---|---|
| T1 | `Wnow = 899 990`, `freeAt − t = 1` | `planned = 50`; `899 990 + 50 > 900 000` | `RATE_BUDGET_EXHAUSTED` before sleeping; 0 admissions |
| T2 | as T1 with a raw-wait pre-check (C2 behavior) | sleeps 50 → `Wnow = 900 040` → next iteration refuses | 0 admissions |
| T3 | `Wnow = 899 900`, planned 50, timer 140 ms late | `Wnow = 900 040` → refuse | 0 admissions |
| T4 | `t = t0 + 1 700 000`, `Wnow = 500 000`, planned 30 000 | `1 700 000 + 30 000 ≤ 1 770 000` → sleep; wakes at `t0 + 2 330 000` (`Wnow = 1 130 000`) | `RATE_BUDGET_EXHAUSTED` (checked before `P_dead`); 0 admissions |
| T5 | sleeping; parent disconnects | FT0 exits in the same turn | 0 admissions |
| Q1 | one sequential caller enters at `t0 = 0` | `enterWaiting` at 0; cold-start sleep to 65 000; admission → `leaveWaiting` | `W = 65 000`: identical to C3's sleep sum |
| Q2 | callers A and B both enter at 0 (concurrency is outside the supported scope; shown for accounting) | waiters 2 from 0. A sleeps to 65.0 and is admitted (waiters 1). A in flight 65.0–95.0, valid charge 4 605. B becomes head at 95.0: `P_tok` blocks until 160.0; `Wnow(95.0) = 95.0`, planned 65.0, `160.0 ≤ 900` → sleeps; admitted at 160.0 (waiters 0) | **union `W = 160.0 s`**. Per-caller sums would be 65 + 160 = 225 s; the union counts the overlap 0–65 once. |
| Q3 | as Q2; abort at 100.0 while B sleeps | B's sleep rejects; FT0 exits | B: 0 admissions |
| Q4 | B queued while A in flight, with `Wnow` near budget: `W = 899 000` at A's admission, A in flight 30 s | at 30 s into A's flight `Wnow` = 929 000; B becomes head and refuses at its first check | queue time consumes the budget; B: 0 admissions |

Q1 shows the budget's meaning is unchanged for the supported sequential callers.
Q2–Q4 define the union rule for concurrent callers, which no current caller produces.

### 4.3 Accounting (R3-ARCH-01; PD-R11 A, PD-R12 A, PD-R12-I1)

`B_tok = 6 800`, `completionReserveTokens = 2 000`.

| Trace | Exchange record | Charge | Thrown to generator |
|---|---|---|---|
| AC-1 | RM, `Res = 4 605`, 2xx, content present, valid `U = 3 700` | `4 605` | content returned |
| AC-2 | TCM, `Res = 5 989` at 69.0 s after AC-1 | waits to 134.0 s (`4 605 + 5 989 > 6 800`) | — |
| AC-3 | `Res = 3 400`, valid `U = 3 600` | `3 600`; the next `3 400` waits for expiry | content returned |
| AC-4 | `Res = 3 400`, valid `U = 1 000` | `3 400` (no refund) | content returned |
| AC-5 | 2xx parsed, usage absent | `6 800` (MISSING) | content returned |
| AC-8 | Groq own timer at 30 s (INVOKED_REJECTED) | `6 800` (UNAVAILABLE) | `TIMEOUT` (retryable); attempt 2 waits to settle + 65 s |
| AC-9 | Gemini HTTP 408 | `6 800` | `UNKNOWN` (not retryable) |
| AC-10 | hint `remaining-tokens 1200`, `reset 38.5s` at 69.0 s | `hintTok = {5 600, until 112.5}` → next `4 605` waits to 134.0 s | — |
| AC-11 | `remaining-tokens: 99999999999` | ignored (grammar) | — |
| AC-12 | 429 with `Retry-After: 120` | `6 800`; `exhausted` | `RATE_LIMIT`; next call → `RATE_BUDGET_EXHAUSTED`, no sleep |
| **AC-13** (R3 counterexample) | `Res = 3 400`; 2xx parsed; usage `{prompt 100, completion 6 900, total 7 000}` → VALID(7 000); content absent | **`max(3 400, 7 000) = 7 000`**, not 6 800 | `INVALID_RESPONSE` (original, unchanged) |
| AC-14 | 2xx parsed; usage `{prompt 3 000, completion 900, total 3 500}` (`3 500 < 3 900`) → MALFORMED; content absent | `6 800` | **`RATE_ACCOUNTING_INVALID`** (sticky), replacing `INVALID_RESPONSE` |
| AC-15 | MALFORMED usage; content present | `6 800` | `RATE_ACCOUNTING_INVALID`; content discarded (PD-R12-I1) |
| AC-16 | VALID(1 000); content absent | `3 400` | `INVALID_RESPONSE` |
| AC-17 | MISSING; content absent | `6 800` | `INVALID_RESPONSE` |
| AC-18 | gate `DEADLINE` (NOT_INVOKED) | `3 400` (exact: nothing sent); 1 request counted | `STAGE_TIMEOUT` (sticky) |
| AC-19 | HTTP 307, not followed | `6 800` (UNAVAILABLE) | `UNKNOWN` (not retryable) |
| AC-20 | AC-13, then the generator throws while unwinding | already charged `7 000` at settle, before any throw | per §4.6 |
| AC-21 | `total_tokens = 10 000 001` | MALFORMED → `6 800` | `RATE_ACCOUNTING_INVALID` |

After AC-13, `tokLive = 7 000 > B_tok`, so every admission is blocked until
`tSettle + 65 s`. Nothing is clamped.

### 4.4 Dispatch deadline (R3-ARCH-02)

`D_DISPATCH = 1 770 000`. All readings relative to `t0`.

| Trace | Readings | Result |
|---|---|---|
| DT-1 (R3 adversarial) | admission reading `1 770 000` passes `P_dead`; entry pushed; provider setup (`AbortController`, timer, `JSON.stringify`) takes 1 ms; gate reading `1 770 001` | `1 770 001 > 1 770 000` → `DEADLINE`; **0 transport invocations**; settle: NOT_INVOKED charge `Res`; `STAGE_TIMEOUT` |
| DT-2 | admission `1 769 999`; gate `1 770 000` | invoked (`≤`); exchange bounded by the provider timer armed before the gate |
| DT-3 | admission `1 769 990`; a 40 K-character prompt makes serialization take 14 ms; gate `1 770 004` | refused; 0 invocations |
| DT-4 | admission `1 000 000`; signal aborted before the gate (in-process harness, no exit) | `CANCELLED`; 0 invocations; cancellation rethrown |
| DT-5 | admission with `reqLive = B_req − 1`; 1 ms passes before the gate | Lemma 5: no admission can intervene (slot held); `P_req` still holds at the gate |
| DT-6 | C3 behavior for comparison | C3 checked `P_dead` only at the stale admission reading, so DT-1 would have invoked `fetch` at `1 770 001` |

### 4.5 Redirect (R3-ARCH-03)

| Trace | Transport | HTTP requests | Governor admissions | Outcome |
|---|---|---|---|---|
| RD-1 (R3 counterexample, C3 design) | default `fetch` (follow); `POST /first` → `307 Location: /second` | **2** | 1 | RPM = 1 exceeded at the HTTP level |
| RD-2 (C4) | gate forces `redirect: "manual"` | **1** | 1 | 307 returned; provider: 3xx → `UNKNOWN`, not retryable; usage UNAVAILABLE → charge `B_tok`; generator stops |
| RD-3 (rejected alternative) | `redirect: "error"` | 1 | 1 (then 2 with attempt 2) | `TypeError` → provider `NETWORK` (retryable) → attempt 2 is a new admission. Accounted, but needlessly retried. |
| RD-4 (ungoverned) | default `fetch` | as certified | — | unchanged (INV-13) |

Localhost observations (§8.3; `127.0.0.1` only, no credentials):

| Node | Default mode | `manual` | `error` |
|---|---|---|---|
| 22.23.3 (WSL Ubuntu) | 200, 2 requests (`POST /first`, `POST /second`) | 307, `Location: /second`, 1 request | `TypeError` "unexpected redirect", 1 request |
| 24.22.1 (Windows) | identical | identical | identical |

### 4.6 Exception paths (R2-ARCH-02)

| Trace | Sequence | `ctx` at classification | Child failure | CLI |
|---|---|---|---|---|
| EX-1 | `plan`: attempt 1 invalid JSON; attempt 2 correction prompt `> B_tok` → refusal; generator returns `{ok:false, providerAttempts:2, errors:[INVALID_VALUE]}` | `calls = 2`, terminal `RATE_REQUEST_EXCEEDS_BUDGET` | generation, attempts 2, codes `[RATE_REQUEST_EXCEEDS_BUDGET, INVALID_VALUE]` | `PROVIDER_FAILURE`, 6 |
| EX-2 (E1) | refusal on attempt 1; a (hypothetical) generator rethrows the same error object | `calls = 1`; `refusals.has(e)` | generation, attempts 1, codes `[RATE_BUDGET_EXHAUSTED]` | `PROVIDER_FAILURE`, 6 |
| EX-3 (E2) | refusal on attempt 1; the generator then throws `TypeError` | terminal set; `e` not in `refusals` | internal, `GENERATIVE_STAGE_FAILED`, `governorCode: RATE_BUDGET_EXHAUSTED` | `STAGE_FAILED`, 1, message includes the governor code |
| EX-4 (E3) | no refusal; generator throws `TypeError` | terminal `null` | internal (baseline) | `STAGE_FAILED`, 1 (unchanged) |
| EX-5 (E2) | the generator throws `new Error("x", {cause: refusal})` | identity fails | as EX-3 | `STAGE_FAILED`, 1 |
| EX-6 (E1) | gate `DEADLINE` → `STAGE_TIMEOUT`; generator rethrows it | `calls = 1` | stage-timeout, attempts 1 | `STAGE_TIMEOUT`, 6 |
| EX-7 | return path with `providerAttempts: undefined` (malformed) after a refusal | `calls = 1` | uses `ctx.calls = 1` | 6, never 4 |
| EX-8 | refusal, then cancellation before classification | `cancelled` | no result (FT0) | per SEC-C1 |
| EX-9 | AC-13 (valid 7 000, content absent) then the generator throws `TypeError` | no terminal | E3: internal | `STAGE_FAILED`, 1; the entry still holds `7 000` |
| EX-10 | AC-14 malformed; the generator rethrows the refusal | terminal `RATE_ACCOUNTING_INVALID`, identity matches | generation, `[RATE_ACCOUNTING_INVALID]` | `PROVIDER_FAILURE`, 6 |

Properties shown: a refusal survives unwinding (EX-2, EX-3, EX-5, EX-6, EX-10); no
unrelated exception is relabelled (EX-3, EX-4, EX-5, EX-9 keep `STAGE_FAILED`/1);
attempt counts come from `ctx.calls` or the generator (EX-1, EX-7), never invented.

---

## 5. Temporal bounds

All counts below are admissions. By Lemma 4 they bound transport invocations
(≤, with equality unless the gate refuses) and, under T1, HTTP requests.

### 5.1 Closed forms (`c = 0`, constant `d`)

**Heavy.** `s_1 = 65`, `s_{i+1} = s_i + d + 65`, waited before send `i` = `65i`.
So `k ≤ 13`; the last send is at `≤ 1 205 s` and ends at `≤ 1 235 s` for `d ≤ 30`.
This requires `c = 0`.

**Light.** Pair `j` at `a_j = 65 + (j−1)(65 + d)` and `a_j + d`. Pair `j` needs
(W) `65 + (j−1)(65 − d) ≤ 900` and (D) `a_j ≤ 1 770`, plus `a_j + d ≤ 1 770` for
its second send.

### 5.2 Reviewer CE-03 and the corrected 40-send interval (R3-ARCH-05)

`d = 29.9 s`: (D) gives `j ≤ 18`; (W) at `j = 18` is `661.7 ≤ 900`. Result: 36
sends, 661.7 s waited, stop at 1 738.1 s with `STAGE_TIMEOUT`. This equals R3/R2.

20 pairs (40 sends) need both:

```text
(W) 65 + 19(65 − d) ≤ 900   ⇔  d ≥ 65 − 835/19 = 400/19 s = 21.052631… s
(D) 1 300 + 20d ≤ 1 770     ⇔  d ≤ 23.5 s
```

So the 40-send interval is **`d ∈ [400/19, 23.5] s`**, i.e. **`[21 053, 23 500]` ms** at
integer-millisecond resolution. C3's "21.05 s" endpoint was wrong:
`65 + 19 × (65 − 21.05) = 900.05 > 900`.

| `d` (ms) | (W) value for 20 pairs (s) | Sends | Stop |
|---:|---:|---:|---|
| 21 052 | 900.012 > 900 | **38** (pair 20 refused) | `RATE_BUDGET_EXHAUSTED` |
| 21 053 | 899.993 ≤ 900 | **40** | `RATE_BUDGET_EXHAUSTED` before pair 21 |
| 23 500 | 853.500 | 40 | `STAGE_TIMEOUT` (second send of pair 20 exactly at 1 770 000) |
| 23 501 | 853.481 | 39 | `STAGE_TIMEOUT` at the second send of pair 20 |

21 052 ms is **not** in the 40-send interval: it yields 38. Pair 21 is impossible for
constant `d` (it needs `d ≥ 23.25` and `d ≤ 20.25`). So 40 is the **constant-duration**
maximum. It is not the global maximum (§5.6).

### 5.3 Per-stage tables (`c = 0`; `B_tok = 6 800`, `B_req = 30`)

Heavy uses `Res = 4 605`; light uses `Res = 3 400`. Cells read "sends, waited s /
elapsed s". Elapsed is child time from `t0` and excludes phases P, A, K, S and V.

| Stage, N, pass | k | Heavy d=5 | Heavy d=30 | Light d=5 | Light d=30 |
|---|---:|---|---|---|---|
| design, N=1, first | 3 | 3, 195.0 / 210.0 | 3, 195.0 / 285.0 | 3, 125.0 / 140.0 | 3, 100.0 / 190.0 |
| design, N=1, worst | 6 | 6, 390.0 / 420.0 | 6, 390.0 / 570.0 | 6, 185.0 / 215.0 | 6, 135.0 / 315.0 |
| plan or generate, N=1, first | 1 | 1, 65.0 / 70.0 | 1, 65.0 / 95.0 | 1, 65.0 / 70.0 | 1, 65.0 / 95.0 |
| plan or generate, N=1, worst | 2 | 2, 130.0 / 140.0 | 2, 130.0 / 190.0 | 2, 65.0 / 75.0 | 2, 65.0 / 125.0 |
| design, N=6, first | 8 | 8, 520.0 / 560.0 | 8, 520.0 / 760.0 | 8, 245.0 / 285.0 | 8, 170.0 / 410.0 |
| design, N=6, worst | 16 | **13, 845.0 / 910.0, `RATE_BUDGET_EXHAUSTED`** | **13, 845.0 / 1 235.0, `RATE_BUDGET_EXHAUSTED`** | 16, 485.0 / 565.0 | 16, 310.0 / 790.0 |
| plan or generate, N=6, first | 6 | 6, 390.0 / 420.0 | 6, 390.0 / 570.0 | 6, 185.0 / 215.0 | 6, 135.0 / 315.0 |
| plan or generate, N=6, worst | 12 | 12, 780.0 / 840.0 | 12, 780.0 / 1 140.0 | 12, 365.0 / 425.0 | 12, 240.0 / 600.0 |
| any stage, N=200 | 200–404 | **13, 845.0 / 910.0, `RATE_BUDGET_EXHAUSTED`** | **13, 845.0 / 1 235.0, `RATE_BUDGET_EXHAUSTED`** | **28, 845.0 / 985.0, `RATE_BUDGET_EXHAUSTED`** | **36, 660.0 / 1 740.0, `STAGE_TIMEOUT`** |

The heavy column checks by hand against §5.1 (`65k` waited; `65k + kd` elapsed).
Light rows that complete check against the pair formulas (e.g. N=6 plan, light,
`d = 30`: pairs at 65, 160, 255 → last settle `255 + 60 = 315`; waited
`65 + 2 × 35 = 135`).

### 5.4 Combined workflow

Three separate invocations, with separate ledgers and cold starts. Per invocation,
governed transport invocations end by gate reading `1 770 s`, and the exchange is
bounded by the provider timer. Summed governed activity (`c = 0`, heavy,
`d ≤ 30`): N=1 first pass `285 + 95 + 95 = 475 s`; worst `950 s`. **No
whole-workflow wall-clock bound is claimed.**

### 5.5 Caller processing (`c > 0`) and heartbeat limits

| Scenario | Admissions | Note |
|---|---:|---|
| heavy, `c = 65 s`, `d = 0` | 27 | attains Corollary 1 for `n_max = 1`; last admission 1 755 s |
| heavy, `c = 30 s`, `d = 30` | 18 | the deadline binds first |
| light, `c = 65 s` before each pair, `d = 0` (R3) | 54 | attains Corollary 1 for `n_max = 2` |

These are **arithmetic admission bounds**, not healthy lifecycle traces. A single
synchronous segment of 65 s stops heartbeats for more than `WD = 45 s`, and the
parent kills the child (`CHILD_UNRESPONSIVE`). Under H1, `c` must consist of
segments shorter than about 35 s with event-loop yields. The admission bounds hold
either way. The watchdog limitation is non-guarantee 12 in design §17.

### 5.6 Variable duration: 41 sends (R3)

`Res = 3 400` (light), `c = 0`:

```text
d_1 = 0; d_2, d_4, …, d_40 = 23 500 ms; d_3, d_5, …, d_37 = 21 316 ms; d_39 = 21 312 ms; d_41 = 100 ms
```

Hand recurrence (two slots): `s_1 = 65 000`; `s_{i+1} = max(e_i, e_{i−1} + 65 000)`.
Result: **41 admissions, waited 895 000 ms, last admission exactly 1 770 000 ms,
last settle 1 770 100 ms**. Lemma 6's bound is met with equality:
`65 × 41 = 2 665 = 1 770 + 895`. Both §8.1 (ledger simulation) and §8.2
(recurrence) reproduce it independently.

Conclusions: the constant-`d` maximum 40 is **not** global. For `c = 0` the
two-slot maximum is 41 (Lemma 6, tight). For `c ≥ 0` in general the proven bound is
54 (Corollary 1), and it is attained arithmetically (§5.5).

---

## 6. Child/parent settlement timelines

Parent origin `tSpawn = 0`; child `t0 = δ`. `ε` marks OS lateness. No row is summed
into a CLI-level bound.

### 6.1 Success

Spawn; watchdog and enforcement armed. Child `t0`; heartbeats every 10 s. Admissions
and gate invocations per §2. `report()` at `r`: heartbeat cleared. Parent stores,
ACKs and disarms the watchdog. ACK within 10 s; child disconnects; `exit 0`; `close`;
settle; enforcement cleared; validate and commit (phase V, unbounded).

### 6.2 Governor `STAGE_TIMEOUT` (CE-03 or DT-1)

The child refuses (pre-admission or at the gate). Return path → `stage-timeout`.
`exitCode = 1`. The parent stores, ACKs and classifies `STAGE_TIMEOUT`, exit 6;
nothing is written.

### 6.3 Parent enforcement

| Parent time | Event |
|---|---|
| `≥ 1 815` (first callback) | `killed = STAGE_TIMEOUT`; `result = null`; timers disarmed; `kill("SIGKILL")`; `K_SETTLE` armed; **no disconnect** |
| `tExit` | `exit` → `K_SETTLE` cleared; FT0 phase S |
| `≤ tExit + CAE + ε` | `close` or `CAE` fallback → settle → `STAGE_TIMEOUT`, 6 |

### 6.4 Watchdog

The last valid heartbeat is at `h`. At the first callback `≥ h + 45`: `killed =
CHILD_UNRESPONSIVE`; then as §6.3. Exit 1.

### 6.5 Parent loss

The child exits in the same turn. Zero further admissions or gate invocations.

### 6.6 Windows: missing `close`

`exit` without `close` → `CAE` → settle with `result = null` (FT0-C2-D1, unchanged).

### 6.7 Result ACKed, then killed

`killed` wins; the result is discarded; nothing is written.

### 6.8 Post-kill settlement scenarios (PD-R15; `K_SETTLE` = proposed 10 000 ms, not approved)

| Scenario | Events after `tKill` | Parent settlement decision | Classification |
|---|---|---|---|
| KS-1 normal | `exit` at `tKill + 3 ms`, `close` at `+5 ms` | at `close` | kill reason; no write |
| KS-2 no `exit` (POSIX D-state / Windows pending I/O) | nothing | first callback `≥ tKill + 10 000`: disconnect if connected, destroy stdio, `unref`, clear timers, settle `abandoned`, one stderr line | kill reason; no write; the child can run no user code |
| KS-3 kill not delivered (`killIssued = false`), child alive | child keeps running | `≥ tKill + 10 000`: abandonment; `disconnect()` → child SEC-C1 → child exits 1; zero further invocations (gate and SEC-C1) | kill reason; no write |
| KS-4 Windows `exit` without `close` | `exit` at `+4 ms` | `≥ tExit + CAE` (FT0 fallback) | kill reason; no write |
| KS-5 late `exit` | `exit` at `tKill + 9 999` | `K_SETTLE` cleared; `≥ tExit + CAE` → by `tKill + 19 999 + ε` | kill reason; no write |
| KS-6 `exit` after abandonment | `exit` at `tKill + 12 000` | already settled at `≥ 10 000`; late `exit` ignored (certified `settled` guard) | unchanged |

Worst-case parent settlement decision after a kill: `tKill + K_SETTLE + CAE` (KS-5),
plus `ε`. With the proposed value that is 20 s.

---

## 7. What is and is not proven

**Proven (ALGORITHMIC, given A1–A2):** Lemma 1 and Corollary 1 (`k ≤ 27·n_max`
admissions); Lemma 2 (union wait budget); Lemma 3 (transport-invocation deadline);
Lemma 4 (one entry, one invocation; one HTTP request under T1; occupancy over
invocation times); Lemma 5 (gate re-checks exactly the time-sensitive predicates);
Lemma 6 (`k ≤ 41` for `c = 0` two-slot, tight); Lemma 7 (charge by usage class on
both paths); the exception-path classification (§4.6); INV-18's decision points;
the closed forms of §5.1–§5.2 including the exact interval `[400/19, 23.5] s`.

**Reproduced, not proven in general:** per-stage tables for constant `d`;
random-search figures.

**Observed, not certified:** T1 (redirect behavior and the absence of hidden
retries) on Node 22.23.3 and 24.22.1.

**Not guaranteed (OS or external):** wire emission time; timer punctuality; kill →
`exit` latency (bounded only by abandonment); whether an abandoned child has
exited; heartbeat delivery under long synchronous work; provider accounting;
remote completion after abort.

**Quantitative limitations.** Constant `Res`/`d` in the tables; `k ≤ 13` heavy and
`k ≤ 41` light require `c = 0`; light/heavy depends on heuristic estimates;
saturation turns light into heavy behavior; nothing here is provider evidence (PD-R9).

---

## 8. Reproduction artifacts

Run each with Node 22 or later, outside the repository. Compare output
byte-for-byte (LF line endings).

### 8.1 Ledger simulator

Sections A–D are byte-identical to C3. Section E adds the C4 boundary and
variable-duration cases.

Source (`c4sim.js`, SHA-256 `8bdfe697ab421c4fe286b771dd622d5df1124f4e082546a714974f1290ea8e8b`):

```js
"use strict";
// OD-RATE-1-C2-R3 C4 reference simulator. Design evidence only: pure arithmetic,
// no I/O, no network. Integer ms on a fake monotonic clock; t0 = 0.
// Sequential sends (governor concurrency 1). model "C2" = C2 Appendix A as
// written (no RPM gate, raw-wait pre-check, no post-wake budget check).
const K = { C: 65000, H: 65000, T: 30000, MAXW: 65000, WB: 900000, D: 1800000, MINS: 50, ITER: 64 };

function simulate({ B, Breq = Infinity, reqs, oversleep = () => 0, model = "C3" }) {
  const led = [];
  let now = 0, waited = 0, sends = 0;
  const trace = [];
  const live = (t) => led.filter((e) => e.settle === null || t < e.settle + K.H);
  function freeAt(res, t) {
    const l = live(t).sort((a, b) => a.settle - b.settle);
    let f = t, sum = l.reduce((s, e) => s + e.charged, 0), cnt = l.length, i = 0;
    while (sum + res > B || (model === "C3" && cnt + 1 > Breq)) {
      if (i >= l.length || l[i].settle === null) return Infinity;
      f = l[i].settle + K.H; sum -= l[i].charged; cnt -= 1; i += 1;
    }
    return Math.max(f, K.C);
  }
  const stop = (why) => ({ stop: why, sends, waited, now, trace });
  for (let r = 0; r < reqs.length; r++) {
    const { res, d, usage, c = 0 } = reqs[r];
    now += c; // caller processing between the previous settle and this analyze()
    if (res > B) return stop("RATE_REQUEST_EXCEEDS_BUDGET");
    for (let it = 0; ; it++) {
      if (model === "C3" && waited > K.WB) return stop("RATE_BUDGET_EXHAUSTED(post-wake)");
      if (now + K.T > K.D) return stop("STAGE_TIMEOUT(pre-send)");
      const f = freeAt(res, now);
      if (f <= now) break;
      if (it >= K.ITER) return stop("RATE_BUDGET_EXHAUSTED(iter)");
      const planned = model === "C3" ? Math.max(f - now, K.MINS) : f - now;
      if (planned > K.MAXW || waited + planned > K.WB) return stop("RATE_BUDGET_EXHAUSTED(pre-sleep)");
      if (now + planned + K.T > K.D) return stop("STAGE_TIMEOUT(pre-sleep)");
      const slept = Math.max(planned, K.MINS) + oversleep(r, it);
      now += slept; waited += slept;
    }
    const e = { settle: null, charged: res };
    led.push(e); sends += 1; trace.push(now);
    now += d; e.settle = now;
    // PD-R11 A: max(reserved, observed); PD-R12 A: missing (null) -> B
    e.charged = usage === undefined ? res : usage === null ? B : Math.max(res, usage);
  }
  return stop("COMPLETED");
}

const s = (ms) => (ms / 1000).toFixed(1);
const rep = (n, x) => Array.from({ length: n }, () => ({ ...x }));
const out = (label, r) => console.log(`| ${label} | ${r.sends} | ${s(r.waited)} | ${s(r.now)} | ${r.stop} |`);
const HEAVY = { res: 4605 }, LIGHT = { res: 3400 };

console.log("## A. Reviewer counterexamples\n| Scenario | Sends | Waited s | Elapsed s | Stop |\n|---|---:|---:|---:|---|");
out("CE-03 C2 model, B=6800, Res=3400, d=29.9", simulate({ B: 6800, model: "C2", reqs: rep(400, { res: 3400, d: 29900 }) }));
out("CE-03 C3 model, same, RPM=30", simulate({ B: 6800, Breq: 30, reqs: rep(400, { res: 3400, d: 29900 }) }));
for (const m of ["C2", "C3"]) {
  const r = simulate({ B: 6800, Breq: 1, model: m, reqs: rep(2, { res: 3201, d: 100 }) });
  console.log(`| CE-01 ${m} model, RPM=1, Res=3201, d=0.1 | ${r.sends} | sends at ${r.trace.map(s).join(" and ")} s | ${s(r.now)} | ${r.stop} |`);
}

console.log("\n## B. Per-stage bounds, B_tok=6800, RPM=30, c=0\n| Scenario | Sends | Waited s | Elapsed s | Stop |\n|---|---:|---:|---:|---|");
const SC = [["N=1 design first k=3", 3], ["N=1 design worst k=6", 6], ["N=1 plan/generate first k=1", 1], ["N=1 plan/generate worst k=2", 2],
  ["N=6 design first k=8", 8], ["N=6 design worst k=16", 16], ["N=6 plan/generate first k=6", 6], ["N=6 plan/generate worst k=12", 12],
  ["N=200 design first k=202", 202], ["N=200 design worst k=404", 404], ["N=200 plan/generate first k=200", 200], ["N=200 plan/generate worst k=400", 400]];
for (const [name, k] of SC) for (const [rg, x] of [["heavy", HEAVY], ["light", LIGHT]]) for (const d of [5000, 30000])
  out(`${name}, ${rg}, d=${d / 1000}`, simulate({ B: 6800, Breq: 30, reqs: rep(k, { ...x, d }) }));

console.log("\n## C. Light regime, unlimited demand, constant d (refutes k<=26)\n| Scenario | Sends | Waited s | Elapsed s | Stop |\n|---|---:|---:|---:|---|");
for (const d of [0, 5000, 15000, 21100, 25000, 29700, 29900, 30000]) out(`light d=${d / 1000}`, simulate({ B: 6800, Breq: 30, reqs: rep(400, { ...LIGHT, d }) }));
let maxS = { sends: 0 }, maxE = { now: 0 };
for (let d = 0; d <= 30000; d += 100) {
  const r = simulate({ B: 6800, Breq: 30, reqs: rep(400, { ...LIGHT, d }) });
  if (r.sends > maxS.sends) maxS = { sends: r.sends, d };
  if (r.now > maxE.now) maxE = { now: r.now, d };
}
console.log(`\nconstant-d sweep 0..30 s step 0.1 s: max sends ${maxS.sends} at d=${s(maxS.d)} s; max elapsed ${s(maxE.now)} s at d=${s(maxE.d)} s`);
let seed = 12345, best = 0, bestNow = 0;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let n = 0; n < 2000; n++) {
  const reqs = Array.from({ length: 200 }, () => ({ res: rnd() < 0.8 ? 3400 : 1 + Math.floor(rnd() * 3400), d: Math.floor(rnd() * 30001) }));
  const r = simulate({ B: 6800, Breq: 30, reqs });
  best = Math.max(best, r.sends); bestNow = Math.max(bestNow, r.now);
}
console.log(`seeded random search (2000 runs, Res<=3400, variable d): max sends ${best}; max elapsed ${s(bestNow)} s (exploration, not proof)`);

console.log("\n## D. Accounting, processing time and RPM variants\n| Scenario | Sends | Waited s | Elapsed s | Stop |\n|---|---:|---:|---:|---|");
out("light Res, usage missing (PD-R12 A), d=5", simulate({ B: 6800, Breq: 30, reqs: rep(400, { res: 3400, d: 5000, usage: null }) }));
out("light Res, observed 3600 > Res (PD-R11 A), d=5", simulate({ B: 6800, Breq: 30, reqs: rep(400, { res: 3400, d: 5000, usage: 3600 }) }));
out("light Res, observed 1000 < Res (no refund), d=5", simulate({ B: 6800, Breq: 30, reqs: rep(400, { res: 3400, d: 5000, usage: 1000 }) }));
out("heavy, c=65 s, d=0", simulate({ B: 6800, Breq: 30, reqs: rep(400, { ...HEAVY, d: 0, c: 65000 }) }));
out("heavy, c=30 s, d=30", simulate({ B: 6800, Breq: 30, reqs: rep(400, { ...HEAVY, d: 30000, c: 30000 }) }));
out("light, RPM=2, d=0", simulate({ B: 6800, Breq: 2, reqs: rep(400, { ...LIGHT, d: 0 }) }));
out("light, RPM=1, d=0", simulate({ B: 6800, Breq: 1, reqs: rep(400, { ...LIGHT, d: 0 }) }));
out("tiny Res=100 (n_max=30 by RPM), RPM=30, d=0", simulate({ B: 6800, Breq: 30, reqs: rep(2000, { res: 100, d: 0 }) }));

console.log("\n## E. C4 boundary and variable-duration cases (light, RPM=30, c=0)\n| Scenario | Sends | Waited | Elapsed | Stop |\n|---|---:|---:|---:|---|");
const ms = (r) => `| ${r.label} | ${r.sends} | ${r.waited} ms | ${r.now} ms | ${r.stop} |`;
for (const d of [21052, 21053, 23500, 23501]) { const r = simulate({ B: 6800, Breq: 30, reqs: rep(400, { ...LIGHT, d }) }); r.label = `light d=${d} ms`; console.log(ms(r)); }
{
  const ds = [0];
  for (let i = 2; i <= 41; i++) ds.push(i % 2 === 0 ? 23500 : i <= 37 ? 21316 : i === 39 ? 21312 : 100);
  const r = simulate({ B: 6800, Breq: 30, reqs: ds.map((d) => ({ res: 3400, d })).concat(rep(10, { res: 3400, d: 0 })) });
  r.label = "variable d (R3 41-send trace)"; console.log(ms(r));
  console.log(`41-trace: last admission ${r.trace[40]} ms; admissions ${r.trace.length}`);
}
```

Expected output (SHA-256 `93245eac54d8185f6ddaae94a7859ef9a8c7bc5c94ac19068a113f722c0ae20c`):

```text
## A. Reviewer counterexamples
| Scenario | Sends | Waited s | Elapsed s | Stop |
|---|---:|---:|---:|---|
| CE-03 C2 model, B=6800, Res=3400, d=29.9 | 36 | 661.7 | 1738.1 | STAGE_TIMEOUT(pre-sleep) |
| CE-03 C3 model, same, RPM=30 | 36 | 661.7 | 1738.1 | STAGE_TIMEOUT(pre-sleep) |
| CE-01 C2 model, RPM=1, Res=3201, d=0.1 | 2 | sends at 65.0 and 65.1 s | 65.2 | COMPLETED |
| CE-01 C3 model, RPM=1, Res=3201, d=0.1 | 2 | sends at 65.0 and 130.1 s | 130.2 | COMPLETED |

## B. Per-stage bounds, B_tok=6800, RPM=30, c=0
| Scenario | Sends | Waited s | Elapsed s | Stop |
|---|---:|---:|---:|---|
| N=1 design first k=3, heavy, d=5 | 3 | 195.0 | 210.0 | COMPLETED |
| N=1 design first k=3, heavy, d=30 | 3 | 195.0 | 285.0 | COMPLETED |
| N=1 design first k=3, light, d=5 | 3 | 125.0 | 140.0 | COMPLETED |
| N=1 design first k=3, light, d=30 | 3 | 100.0 | 190.0 | COMPLETED |
| N=1 design worst k=6, heavy, d=5 | 6 | 390.0 | 420.0 | COMPLETED |
| N=1 design worst k=6, heavy, d=30 | 6 | 390.0 | 570.0 | COMPLETED |
| N=1 design worst k=6, light, d=5 | 6 | 185.0 | 215.0 | COMPLETED |
| N=1 design worst k=6, light, d=30 | 6 | 135.0 | 315.0 | COMPLETED |
| N=1 plan/generate first k=1, heavy, d=5 | 1 | 65.0 | 70.0 | COMPLETED |
| N=1 plan/generate first k=1, heavy, d=30 | 1 | 65.0 | 95.0 | COMPLETED |
| N=1 plan/generate first k=1, light, d=5 | 1 | 65.0 | 70.0 | COMPLETED |
| N=1 plan/generate first k=1, light, d=30 | 1 | 65.0 | 95.0 | COMPLETED |
| N=1 plan/generate worst k=2, heavy, d=5 | 2 | 130.0 | 140.0 | COMPLETED |
| N=1 plan/generate worst k=2, heavy, d=30 | 2 | 130.0 | 190.0 | COMPLETED |
| N=1 plan/generate worst k=2, light, d=5 | 2 | 65.0 | 75.0 | COMPLETED |
| N=1 plan/generate worst k=2, light, d=30 | 2 | 65.0 | 125.0 | COMPLETED |
| N=6 design first k=8, heavy, d=5 | 8 | 520.0 | 560.0 | COMPLETED |
| N=6 design first k=8, heavy, d=30 | 8 | 520.0 | 760.0 | COMPLETED |
| N=6 design first k=8, light, d=5 | 8 | 245.0 | 285.0 | COMPLETED |
| N=6 design first k=8, light, d=30 | 8 | 170.0 | 410.0 | COMPLETED |
| N=6 design worst k=16, heavy, d=5 | 13 | 845.0 | 910.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=6 design worst k=16, heavy, d=30 | 13 | 845.0 | 1235.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=6 design worst k=16, light, d=5 | 16 | 485.0 | 565.0 | COMPLETED |
| N=6 design worst k=16, light, d=30 | 16 | 310.0 | 790.0 | COMPLETED |
| N=6 plan/generate first k=6, heavy, d=5 | 6 | 390.0 | 420.0 | COMPLETED |
| N=6 plan/generate first k=6, heavy, d=30 | 6 | 390.0 | 570.0 | COMPLETED |
| N=6 plan/generate first k=6, light, d=5 | 6 | 185.0 | 215.0 | COMPLETED |
| N=6 plan/generate first k=6, light, d=30 | 6 | 135.0 | 315.0 | COMPLETED |
| N=6 plan/generate worst k=12, heavy, d=5 | 12 | 780.0 | 840.0 | COMPLETED |
| N=6 plan/generate worst k=12, heavy, d=30 | 12 | 780.0 | 1140.0 | COMPLETED |
| N=6 plan/generate worst k=12, light, d=5 | 12 | 365.0 | 425.0 | COMPLETED |
| N=6 plan/generate worst k=12, light, d=30 | 12 | 240.0 | 600.0 | COMPLETED |
| N=200 design first k=202, heavy, d=5 | 13 | 845.0 | 910.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 design first k=202, heavy, d=30 | 13 | 845.0 | 1235.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 design first k=202, light, d=5 | 28 | 845.0 | 985.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 design first k=202, light, d=30 | 36 | 660.0 | 1740.0 | STAGE_TIMEOUT(pre-sleep) |
| N=200 design worst k=404, heavy, d=5 | 13 | 845.0 | 910.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 design worst k=404, heavy, d=30 | 13 | 845.0 | 1235.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 design worst k=404, light, d=5 | 28 | 845.0 | 985.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 design worst k=404, light, d=30 | 36 | 660.0 | 1740.0 | STAGE_TIMEOUT(pre-sleep) |
| N=200 plan/generate first k=200, heavy, d=5 | 13 | 845.0 | 910.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 plan/generate first k=200, heavy, d=30 | 13 | 845.0 | 1235.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 plan/generate first k=200, light, d=5 | 28 | 845.0 | 985.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 plan/generate first k=200, light, d=30 | 36 | 660.0 | 1740.0 | STAGE_TIMEOUT(pre-sleep) |
| N=200 plan/generate worst k=400, heavy, d=5 | 13 | 845.0 | 910.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 plan/generate worst k=400, heavy, d=30 | 13 | 845.0 | 1235.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 plan/generate worst k=400, light, d=5 | 28 | 845.0 | 985.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| N=200 plan/generate worst k=400, light, d=30 | 36 | 660.0 | 1740.0 | STAGE_TIMEOUT(pre-sleep) |

## C. Light regime, unlimited demand, constant d (refutes k<=26)
| Scenario | Sends | Waited s | Elapsed s | Stop |
|---|---:|---:|---:|---|
| light d=0 | 26 | 845.0 | 845.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light d=5 | 28 | 845.0 | 985.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light d=15 | 34 | 865.0 | 1375.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light d=21.1 | 40 | 899.1 | 1743.1 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light d=25 | 38 | 785.0 | 1735.0 | STAGE_TIMEOUT(pre-sleep) |
| light d=29.7 | 37 | 700.4 | 1799.3 | STAGE_TIMEOUT(pre-send) |
| light d=29.9 | 36 | 661.7 | 1738.1 | STAGE_TIMEOUT(pre-sleep) |
| light d=30 | 36 | 660.0 | 1740.0 | STAGE_TIMEOUT(pre-sleep) |

constant-d sweep 0..30 s step 0.1 s: max sends 40 at d=21.1 s; max elapsed 1799.3 s at d=29.7 s
seeded random search (2000 runs, Res<=3400, variable d): max sends 38; max elapsed 1587.7 s (exploration, not proof)

## D. Accounting, processing time and RPM variants
| Scenario | Sends | Waited s | Elapsed s | Stop |
|---|---:|---:|---:|---|
| light Res, usage missing (PD-R12 A), d=5 | 13 | 845.0 | 910.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light Res, observed 3600 > Res (PD-R11 A), d=5 | 13 | 845.0 | 910.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light Res, observed 1000 < Res (no refund), d=5 | 28 | 845.0 | 985.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| heavy, c=65 s, d=0 | 27 | 0.0 | 1820.0 | STAGE_TIMEOUT(pre-send) |
| heavy, c=30 s, d=30 | 18 | 630.0 | 1740.0 | STAGE_TIMEOUT(pre-sleep) |
| light, RPM=2, d=0 | 26 | 845.0 | 845.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light, RPM=1, d=0 | 13 | 845.0 | 845.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| tiny Res=100 (n_max=30 by RPM), RPM=30, d=0 | 390 | 845.0 | 845.0 | RATE_BUDGET_EXHAUSTED(pre-sleep) |

## E. C4 boundary and variable-duration cases (light, RPM=30, c=0)
| Scenario | Sends | Waited | Elapsed | Stop |
|---|---:|---:|---:|---|
| light d=21052 ms | 38 | 856064 ms | 1656040 ms | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light d=21053 ms | 40 | 899993 ms | 1742113 ms | RATE_BUDGET_EXHAUSTED(pre-sleep) |
| light d=23500 ms | 40 | 853500 ms | 1793500 ms | STAGE_TIMEOUT(pre-send) |
| light d=23501 ms | 39 | 853481 ms | 1770020 ms | STAGE_TIMEOUT(pre-send) |
| variable d (R3 41-send trace) | 41 | 895000 ms | 1770100 ms | STAGE_TIMEOUT(pre-send) |
41-trace: last admission 1770000 ms; admissions 41
```

Scope: sequential sends, cold start, both ledgers, PD-R11/PD-R12 charges,
pre-sleep and post-wake checks, deadline, iteration cap. It does not model hints,
cooldown, the queue, the gate, cancellation or IPC. Those are covered by §4.

### 8.2 Independent closed-form checker

It shares no code with §8.1. It evaluates the §5.1–§5.2 pair formulas, the Lemma 6
recurrence and inequality, and the Corollary 1 interval count.

Source (`c4closed.js`, SHA-256 `5280b22c4dd359667d471ce43aacd9ad1a33f0742a42630c0f84febea6a2447d`):

```js
"use strict";
// OD-RATE-1-C2-R3 C4 independent closed-form checker. Shares no code with the
// simulator: it evaluates the proofs-doc formulas directly. Integer ms.
const W_BUDGET = 900000, LAST_SEND = 1770000, HOLD = 65000, COLD = 65000;

// Constant-d light regime, c = 0: pair j sends at a_j and a_j + d.
function lightConstant(d) {
  let sends = 0;
  for (let j = 1; ; j++) {
    const a = COLD + (j - 1) * (HOLD + d);
    const waited = COLD + (j - 1) * (HOLD - d);
    if (waited > W_BUDGET) return `${sends} sends, stop (W) before pair ${j}`;
    if (a > LAST_SEND) return `${sends} sends, stop (D) before pair ${j}`;
    sends += 1;
    if (a + d > LAST_SEND) return `${sends} sends, stop (D) at second send of pair ${j}`;
    sends += 1;
  }
}
for (const d of [0, 21052, 21053, 23500, 23501, 29900]) console.log(`constant d=${d} ms: ${lightConstant(d)}`);
console.log(`exact (W) endpoint for 20 pairs: d >= 65 - 835/19 s = ${(65 - 835 / 19).toFixed(6)} s = 400/19 s`);
console.log(`exact (D) endpoint for 20 pairs: 1300 + 20d <= 1770 -> d <= ${(470 / 20).toFixed(1)} s`);

// Variable-d two-slot recurrence, c = 0: s_{i+1} = max(e_i, e_{i-1} + HOLD).
function twoSlot(ds) {
  const s = [COLD], e = [COLD + ds[0]];
  let waited = COLD;
  for (let i = 1; i < ds.length; i++) {
    const free = i >= 2 ? Math.max(e[i - 1], e[i - 2] + HOLD) : e[i - 1];
    waited += free - e[i - 1];
    s.push(free); e.push(free + ds[i]);
  }
  return { k: s.length, last: s[s.length - 1], settle: e[e.length - 1], waited };
}
const ds = [0];
for (let i = 2; i <= 41; i++) ds.push(i % 2 === 0 ? 23500 : i <= 37 ? 21316 : i === 39 ? 21312 : 100);
const r = twoSlot(ds);
console.log(`41-trace: k=${r.k} last admission=${r.last} last settle=${r.settle} waited=${r.waited} deadline ${r.last <= LAST_SEND ? "ok" : "VIOLATED"} budget ${r.waited <= W_BUDGET ? "ok" : "VIOLATED"}`);
console.log(`Lemma 6 check 65k <= s_k + W: ${65000 * r.k} <= ${r.last + r.waited} -> ${65000 * r.k <= r.last + r.waited}; floor((1770+900)/65) = ${Math.floor(2670 / 65)}`);
console.log(`Corollary 1 cover: ceil((1770000-65000+1)/65000) = ${Math.ceil((LAST_SEND - COLD + 1) / HOLD)} intervals`);
```

Expected output (SHA-256 `81470fd6f2424d9cda73eb00a51109c947b48a325cd90b5fa68ab305fcd988e2`):

```text
constant d=0 ms: 26 sends, stop (W) before pair 14
constant d=21052 ms: 38 sends, stop (W) before pair 20
constant d=21053 ms: 40 sends, stop (W) before pair 21
constant d=23500 ms: 40 sends, stop (D) before pair 21
constant d=23501 ms: 39 sends, stop (D) at second send of pair 20
constant d=29900 ms: 36 sends, stop (D) before pair 19
exact (W) endpoint for 20 pairs: d >= 65 - 835/19 s = 21.052632 s = 400/19 s
exact (D) endpoint for 20 pairs: 1300 + 20d <= 1770 -> d <= 23.5 s
41-trace: k=41 last admission=1770000 last settle=1770100 waited=895000 deadline ok budget ok
Lemma 6 check 65k <= s_k + W: 2665000 <= 2665000 -> true; floor((1770+900)/65) = 41
Corollary 1 cover: ceil((1770000-65000+1)/65000) = 27 intervals
```

### 8.3 Localhost redirect experiment

This is a localhost-only HTTP server on `127.0.0.1` with an ephemeral port. No
credentials or providers are involved.

Source (`redir.js`, SHA-256 `ae0d47ed3b205bec3fb442982a289b02936285ad4345625c414a9f22e73871c3`):

```js
"use strict";
// Localhost-only redirect experiment: counts POSTs received for one fetch() call.
const http = require("http");
async function run(mode) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    req.resume();
    req.on("end", () => {
      if (req.url === "/first") { res.writeHead(307, { Location: "/second" }); res.end(); }
      else { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); }
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/first`;
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: '{"x":1}' };
  if (mode) init.redirect = mode;
  let out;
  try { const r = await fetch(url, init); out = `status=${r.status} ok=${r.ok} type=${r.type} redirected=${r.redirected} location=${r.headers.get("location")}`; if (r.body) await r.body.cancel(); }
  catch (e) { out = `threw ${e.name}: ${e.message} cause=${e.cause && e.cause.message}`; }
  srv.close();
  console.log(`node ${process.version} redirect=${mode || "(default)"} -> ${out}; requests=${hits.length} [${hits.join(", ")}]`);
}
(async () => { for (const m of [undefined, "manual", "error"]) await run(m); })();
```

Observed output:

```text
node v24.22.1 redirect=(default) -> status=200 ok=true type=basic redirected=true location=null; requests=2 [POST /first, POST /second]
node v24.22.1 redirect=manual -> status=307 ok=false type=basic redirected=false location=/second; requests=1 [POST /first]
node v24.22.1 redirect=error -> threw TypeError: fetch failed cause=unexpected redirect; requests=1 [POST /first]
node v22.23.3 redirect=(default) -> status=200 ok=true type=basic redirected=true location=null; requests=2 [POST /first, POST /second]
node v22.23.3 redirect=manual -> status=307 ok=false type=basic redirected=false location=/second; requests=1 [POST /first]
node v22.23.3 redirect=error -> threw TypeError: fetch failed cause=unexpected redirect; requests=1 [POST /first]
```
