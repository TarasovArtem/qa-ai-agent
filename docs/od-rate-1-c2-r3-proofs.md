# OD-RATE-1-C2-R3 — Proofs, Traces and Bounds (Consolidated Corrective C3)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-proofs.md` (2 of 3; companions: [design](od-rate-1-c2-r3-design.md), [review matrix](od-rate-1-c2-r3-review-matrix.md)) |
| Status | **DESIGN EVIDENCE — PENDING INDEPENDENT HEAVY REVIEW.** Nothing here is an implementation test result. |
| Baseline | `main` `a32a6cd7e0a1bdc9917fc3abc7f692039591a145` / tree `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Reproducibility | Every number in §4–§5 is either a closed-form calculation shown inline or an output of the reference simulator in §8. The simulator is pure arithmetic (no I/O, no network, no repository code). |

Symbols and constants are those of design §6.1. Times are in seconds in prose and
tables, and integer milliseconds in the simulator.

---

## 1. Model and assumptions

| ID | Assumption | Used by |
|---|---|---|
| A1 | One governor per child process. At most one send in flight (design §7.4). | all |
| A2 | The governor's clock is monotonic and its readings are exact. Timer **callbacks** may fire late by any amount. | §4.2, §5 |
| A3 | Each send's duration `d` (admission to settle) is `≤ T_REQ + ε_T`, where `ε_T ≥ 0` is the provider timer's overshoot. Tables use `d ≤ 30 s`. | §5 |
| A4 | `c` = caller processing time between one settle and the next `analyze()` call. Tables in §5.3 use `c = 0`; §5.5 shows `c > 0`. | §5 |
| A5 | Reservations are constant per scenario. "Heavy" means `Res > B_tok / 2` (one live entry fits); "light" means `B_tok / 3 < Res ≤ B_tok / 2` (two fit). Both use `B_tok = 6 800` (`tokensPerMinute = 8 000`, `h = 0.85`) and `B_req = 30` unless stated. | §5 |
| A6 | Request counts per stage follow C2:688–689: `design` `k = N + 2` (first pass) or `2(N + 2)` (every artifact needs attempt 2); `plan`/`generate` `k ≤ N` or `≤ 2N`. For `plan`/`generate`, N bounds the AUTOMATE-candidate / plan count from above. | §5.3 |

**Deterministic vs. operating-system properties.** Statements labelled
**ALGORITHMIC** follow from the governor's decision rules and clock readings
alone, and hold for any timer lateness. Statements labelled **OS** depend on
timer punctuality, process scheduling, kill delivery or I/O. C3 makes no
quantitative OS claim.

---

## 2. Algorithm (normative pseudocode)

```text
// ---- construction (governed child only) -----------------------------------
Governor(cfg, cancelSignal, inner, nowMs):
  t0 = nowMs(); coldUntil = t0 + C_COLD; cooldownUntil = t0
  B_tok = floor(cfg.tokensPerMinute * 0.85); B_req = cfg.requestsPerMinute
  entries = []; waited = 0; terminal = null; exhausted = false
  hintTok = null; hintReq = null; inFlight = false; queue = FIFO()

live(t)    = entries where e.tSettle == null or t < e.tSettle + W_HOLD
reqLive(t) = |live(t)|
tokLive(t) = sum(e.charged for e in live(t))
hintTokUsed(t) = (hintTok != null and t < hintTok.until) ? hintTok.used : 0

refuse(code):                      // RATE_* or STAGE_TIMEOUT; sticky
  if terminal == null: terminal = {code}
  throw ProviderError(fixedMessage(terminal.code), {code: terminal.code, retryable: false})

// ---- one outer call ---------------------------------------------------------
analyze(req):
  await queue.enter()                                       // FIFO; head only
  try:
    if cancelSignal.aborted: throw cancelledError()         // P_cancel first
    if terminal != null: refuse(terminal.code)              // INV-09
    res = ceil((utf8(req.systemPrompt) + utf8(req.userPrompt)) / 3.0) + 32
          + cfg.completionReserveTokens + cfg.reasoningReserveTokens
    if res > B_tok: refuse(RATE_REQUEST_EXCEEDS_BUDGET)
    for it in 0 .. :
      now = nowMs()
      if cancelSignal.aborted: throw cancelledError()       // P_cancel
      if terminal != null: refuse(terminal.code)            // P_term
      if exhausted: refuse(RATE_BUDGET_EXHAUSTED)
      if waited > W_BUDGET: refuse(RATE_BUDGET_EXHAUSTED)   // P_wait (observed)
      if now + T_REQ > t0 + D_STAGE: refuse(STAGE_TIMEOUT)  // P_dead
      f = freeAt(res, now)
      if f <= now:                                          // ---- atomic section ----
        e = {tAdmit: now, tSettle: null, res, charged: res}
        entries.push(e); inFlight = true
        return await settle(e, inner.analyze(req))          // invoked in this turn
      if it >= I_MAX: refuse(RATE_BUDGET_EXHAUSTED)
      planned = max(f - now, S_MIN)
      if planned > W_MAX: refuse(RATE_BUDGET_EXHAUSTED)
      if waited + planned > W_BUDGET: refuse(RATE_BUDGET_EXHAUSTED)
      if now + planned + T_REQ > t0 + D_STAGE: refuse(STAGE_TIMEOUT)
      a = nowMs(); await sleep(planned, cancelSignal); b = nowMs()
      if b < a: refuse(RATE_ACCOUNTING_INVALID)
      waited += b - a                                       // observed, incl. oversleep
  finally:
    queue.leave()

// earliest t >= now at which P_cold, P_cool, P_req, P_tok and hints all hold,
// assuming no new entries (true: A1 and the queue).
freeAt(res, now):
  L = live(now) sorted by tSettle (unsettled entries last; they never expire)
  t = max(now, coldUntil, cooldownUntil, hintReq ? hintReq.until : now)
  repeat:
    if reqLive(t) + 1 <= B_req and max(tokLive(t), hintTokUsed(t)) + res <= B_tok: return t
    next = min over e in live(t) with e.tSettle != null of e.tSettle + W_HOLD,
           and hintTok.until if hintTokUsed(t) > 0
    if none: return +infinity          // only unsettled entries block: impossible under A1
    t = next

settle(e, p):
  try:
    out = await p                                           // provider: one HTTP request at most
    obs = observer.take()                                   // {status, rateHeaders, usage?}
    applyHints(obs, nowMs())
    cls = classifyUsage(obs.usage)                          // design §9.3
  catch err:
    obs = observer.take(); applyHints(obs, nowMs())
    if obs.status == 429: cooldownUntil = nowMs() + min(RA(obs) ?? 65000, 65000)
                          if RA(obs) > 65000: exhausted = true
    e.tSettle = nowMs(); e.charged = B_tok                  // Unavailable: saturate
    inFlight = false
    throw err                                               // unchanged; retry stays with generator
  e.tSettle = nowMs(); inFlight = false
  if cls.valid:     e.charged = max(e.res, cls.U); return out
  if cls.missing:   e.charged = B_tok;            return out
  /* malformed */   e.charged = B_tok;            refuse(RATE_ACCOUNTING_INVALID)
```

The pseudocode is the C3 algorithm. Simulator §8 implements the same decision
rules for sequential sends without hints, cooldown or queueing. Those three only
add constraints, so they can only delay or refuse sends.

---

## 3. Ledger invariants

**Lemma 1 (window occupancy).** Let `I` be any half-open interval of length
65 s, and let `S_I` be the sends admitted in `I`. Then `|S_I| ≤ B_req` and
`|S_I| ≤ floor(B_tok / Res_min(S_I))`.

*Proof.* Let `s_L` be the last admission in `I`, and let `s_j < s_L` be any
other admission in `I`. Then `s_L − s_j < 65 s`. Entry `j` expires at
`tSettle_j + 65 s ≥ s_j + 65 s > s_L`. An unsettled entry never expires (INV-03).
So entry `j` is live at `s_L`. Admission of `s_L` required
`reqLive(s_L) + 1 ≤ B_req`, and `reqLive(s_L) ≥ |S_I| − 1`, so `|S_I| ≤ B_req`. It
also required `tokLive(s_L) + Res_L ≤ B_tok`. Every live entry has
`charged ≥ Res ≥ Res_min` (INV-03/04), so `|S_I| · Res_min ≤ B_tok`. ∎

Lemma 1 holds for any request durations, any caller processing time and any
timer lateness. It needs only INV-01 (admission checked at the send instant) and
INV-03 (no early expiry). It is **ALGORITHMIC** and **local**: it bounds this
process's admissions, not provider-side counting.

**Corollary 1 (sends per governed stage).** All sends lie in `[65, 1 770] s` of
child time (INV-07, INV-06). That closed span of 1 705 s is covered by 27
consecutive half-open 65 s intervals (`⌈1 705.001 / 65⌉ = 27`). Therefore

```text
k ≤ 27 · n_max,     n_max = min(B_req, floor(B_tok / Res_min))
```

Heavy regime: `n_max = 1`, so `k ≤ 27`. Light regime: `n_max = 2`, so `k ≤ 54`.
The heavy bound is attained (§5.5, `c = 65 s, d = 0`: 27 sends).

**Lemma 2 (wait budget, INV-05).** No send occurs with observed
`waited > 900 000 ms`. *Proof.* `waited` changes only after a sleep. Every sleep
is followed by a new loop iteration whose first non-cancel checks include
`waited > W_BUDGET → refuse`, before any `freeAt` evaluation or admission. A send
happens only inside an iteration that passed that check, with no sleep between
the check and the send. ∎

**Lemma 3 (deadline, INV-06).** Every send happens at child time
`≤ t0 + 1 770 000 ms`. Same structure as Lemma 2, with `P_dead` evaluated at the
send iteration's own `now`. ∎

**Lemma 4 (no double reservation).** The loop holds no ledger state. An entry
is created only in the atomic section, which also starts the inner call. So
`#entries = #sends` exactly. A correction or transport retry is a separate
`analyze()` call, with a separate estimate, a separate admission and one new entry. ∎

---

## 4. Numerical traces

### 4.1 R2-ARCH-01: RPM counterexample

Inputs: `requestsPerMinute = 1` (`B_req = 1`), `B_tok = 6 800`, every
`Res = 3 201`, first request lasts 0.1 s.

| t (s) | Event | `reqLive+1 ≤ 1`? | `tokLive+Res ≤ 6 800`? | Decision |
|---:|---|---|---|---|
| 0 | `t0`; `coldUntil = 65` | — | — | sleep 65 (waited 65) |
| 65.0 | send 1 admitted | 0+1 ≤ 1 ✓ | 0+3 201 ✓ | **send** |
| 65.1 | send 1 settles (valid `U ≤ 3 201` → charged 3 201); expiry 130.1 | — | — | — |
| 65.1 | send 2 evaluated | 1+1 ≤ 1 **✗** | 3 201+3 201 = 6 402 ✓ | not admissible; `freeAt = 130.1`; planned 65.0 ≤ `W_MAX`; waited 65+65 = 130 ≤ 900; 130.1+30 ≤ 1 800 → sleep |
| 130.1 | wake; revalidate: entry 1 expired (`130.1 < 130.1` is false) | 0+1 ≤ 1 ✓ | 0+3 201 ✓ | **send 2** |

C2 model: sends at 65.0 and 65.1 (RPM = 1 violated locally). C3 model: sends at
65.0 and 130.1. Simulator §8 table A reproduces both rows. If the planned wait
had exceeded `W_MAX` or the wait budget, the result would be
`RATE_BUDGET_EXHAUSTED` with zero further sends. Never a dispatch.

### 4.2 R2-ARCH-04: post-wait revalidation and oversleep

| Trace | Start state | Steps | Result |
|---|---|---|---|
| T1 (reviewer) | `waited = 899 990`, `freeAt − now = 1` | `planned = max(1, 50) = 50`; `899 990 + 50 = 900 040 > 900 000` | `RATE_BUDGET_EXHAUSTED` **before sleeping**; 0 sends |
| T2 (weaker pre-check, as in C2) | same, but suppose the pre-check had used the raw wait (`899 991 ≤ 900 000`) | sleep floor 50 → observed `waited = 900 040`; next iteration: `waited > W_BUDGET` | `RATE_BUDGET_EXHAUSTED` **after waking**; 0 sends. The post-wake gate alone is sufficient. |
| T3 (oversleep) | `waited = 899 900`, `freeAt − now = 50` | `899 900 + 50 = 899 950 ≤ 900 000` → sleep; timer fires after 140 ms → `waited = 900 040` | `RATE_BUDGET_EXHAUSTED` after waking; 0 sends |
| T4 (arbitrary oversleep vs. deadline) | `now = t0 + 1 700 000`, `waited = 500 000`, planned 30 000 | pre-check: `1 700 000 + 30 000 + 30 000 = 1 760 000 ≤ 1 800 000` → sleep; process stalls; wakes at `t0 + 2 330 000` → `waited = 1 130 000` | `RATE_BUDGET_EXHAUSTED` (`P_wait` is checked before `P_dead`); 0 sends. With `waited` small, `P_dead` gives `STAGE_TIMEOUT`. Either way 0 sends. |
| T5 (cancel during wait) | any sleeping state | parent `disconnect` → FT0 `fail()` aborts the signal and calls `process.exit(1)` in the same turn; the sleep promise would reject on abort | no JavaScript runs after exit; 0 sends (INV-10) |

Ordering note: within an iteration, the observed-budget check precedes `freeAt`.
A wake-up that finds capacity free still refuses if the budget was exceeded
while sleeping.

### 4.3 Accounting traces (PD-R11 A, PD-R12 A)

`B_tok = 6 800`, `B_req = 30`, `completionReserveTokens = 2 000`, `reasoningReserveTokens = 0`.

| Trace | Inputs | Computation | Result |
|---|---|---|---|
| AC-1 (C2 Appendix A, RM) | `b = 4 718 + 3 000` | `E_in = ⌈7 718/3⌉ + 32 = 2 573 + 32 = 2 605`; `Res = 4 605`; admitted at 65.0 | settles 69.0 with valid `U = 3 700` → `charged = max(4 605, 3 700) = 4 605` (no refund) |
| AC-2 (TCM, C3 config) | `b = 5 871 + 6 000` at 69.0 | `E_in = ⌈11 871/3⌉ + 32 = 3 957 + 32 = 3 989`; `Res = 5 989`; `4 605 + 5 989 = 10 594 > 6 800` | waits to `69 + 65 = 134`; planned 65.0 (= `W_MAX`, allowed); waited 130 |
| AC-2 note | C2:655 used `R_c = 2 500` for TCM and 2 000 for RM | C3 config has one `completionReserveTokens` per provider (design §5.1) | C2's per-step reserve is not representable. With 2 500 the result (wait to 134) is unchanged. |
| AC-3 above reservation | `Res = 3 400`, valid `U = 3 600` | `charged = 3 600`; next `Res = 3 400`: `3 600 + 3 400 = 7 000 > 6 800` | the light pattern becomes heavy (table D: 13 sends instead of 28 at `d = 5`) |
| AC-4 below reservation | `Res = 3 400`, valid `U = 1 000` | `charged = max(3 400, 1 000) = 3 400` | no refund; identical to no-usage-reported light behavior (table D: 28 sends) |
| AC-5 missing | 2xx body, no `usage` | `charged = B_tok = 6 800` until `tSettle + 65` | saturation; next send waits the full hold (table D: 13 sends) |
| AC-6 malformed (partial / inconsistent) | Groq `{prompt_tokens: 3 000, completion_tokens: 900, total_tokens: 3 500}` | `3 500 < 3 000 + 900` → Malformed | `charged = 6 800`; `terminal = RATE_ACCOUNTING_INVALID`; that response's content is discarded; zero further sends |
| AC-7 untrusted large | `total_tokens = 10 000 001` | `> U_MAX` → Malformed | as AC-6 |
| AC-8 Unavailable + retry | Groq send 1 at 65.0; own timer at 95.0 → `TIMEOUT` (retryable) | `charged = 6 800`; generator attempt 2 (same prompt for design) | attempt 2 waits to `95 + 65 = 160`; waited 130; send 2 at 160.0. Both sends occupy both ledgers, even if send 1 completed remotely. |
| AC-9 Gemini 408 | HTTP 408 | `UNKNOWN`, non-retryable (certified) | `charged = 6 800`; artifact fails at that attempt; no attempt 2 |
| AC-10 hint tightening | settle at 69.0 with `remaining-tokens: 1200`, `reset-tokens: 38.5s` | `hintTok = {used: 5 600, until: 69 + 38.5 + 5 = 112.5}`; next `Res = 4 605`: `max(4 605, 5 600) + 4 605 > 6 800` | `freeAt = max(112.5, ledger expiry 134) = 134`. The hint never loosens. |
| AC-11 invalid hint | `remaining-tokens: 99999999999` (11 digits) | grammar rejects (> 9 digits) | ignored; ledger alone decides |
| AC-12 over-cap Retry-After | 429 with `Retry-After: 120` | `120 000 > 65 000` → `exhausted = true` | next `analyze()` → `RATE_BUDGET_EXHAUSTED`, no sleep, 0 sends |

**Conservation check.** In every trace, the set of live entries is exactly the
set of sends admitted in the last `65 s + (their durations)`. Each charge is
`≥` its reservation. No charge is ever 0 or reduced.

---

## 5. Temporal bounds (R2-ARCH-03)

### 5.1 Closed forms (c = 0, constant d)

**Heavy.** One live entry at a time. `s_1 = 65`; `s_{i+1} = s_i + d + 65`.
Observed wait before send `i` is `65·i`. The pre-sleep check refuses send `i+1`
when `65(i+1) > 900`, so `k ≤ 13`. The last send is at `s_13 = 845 + 12d ≤ 1 205`
and ends by `845 + 13d ≤ 1 235`. The deadline check (`s_i ≤ 1 770`) never binds
for `d ≤ 30`. These figures **assume `c = 0`**. §5.5 shows they are not
universal; Corollary 1 (`k ≤ 27`) is.

**Light.** Two live entries. Pair `j` sends at `a_j = 65 + (j−1)(65 + d)` and
`a_j + d`. Before pair `j` the observed wait is `65 + (j−1)(65 − d)`. Pair `j` is
permitted iff

```text
(W)  65 + (j−1)(65 − d) ≤ 900        (pre-sleep budget check)
(D)  a_j ≤ 1 770                     (pre-sleep deadline check), and a_j + d ≤ 1 770 for its second send
```

The stage stops at the first `j` violating (W) or (D). The reason is
`RATE_BUDGET_EXHAUSTED` for (W) and `STAGE_TIMEOUT` for (D).

### 5.2 Reviewer counterexample reproduced: `k ≤ 26` refuted

`B_tok = 6 800`, `Res = 3 400` (light), `d = 29.9`:

- `a_j = 65 + 94.9(j − 1)`. (D): `j ≤ 1 + ⌊1 705 / 94.9⌋ = 18`. `a_18 = 1 678.3`; second send at `1 708.2 ≤ 1 770` ✓. `a_19 = 1 773.2 > 1 770` ✗.
- (W) at `j = 18`: `65 + 17 × 35.1 = 661.7 ≤ 900` ✓.
- **36 sends, 661.7 s waited.** Stop at `a_18 + 2d = 1 738.1 s` with
  `STAGE_TIMEOUT`, because the next planned send `1 773.2 + 30 > 1 800`.

This equals the reviewer's 36 / 661.7 s / 1 738.1 s exactly. C3 keeps the same
behavior; that is correct fail-closed behavior. What C3 corrects is the **claim**:
the deadline, not the wait budget, can bind first.

`k ≤ 26` holds only for `d = 0` (`65j ≤ 900 → j ≤ 13`). Over constant `d ∈ [0, 30]`,
the maximum is **40 sends**. (W) gives `j − 1 ≤ 835/(65 − d)` and (D) gives
`j − 1 ≤ 1 705/(65 + d)`. Reaching `j = 21` would need `835/(65 − d) ≥ 20`,
i.e. `d ≥ 23.25`, **and** `1 705/(65 + d) ≥ 20`, i.e. `d ≤ 20.25`. That is a
contradiction. `j = 20` (40 sends) needs (W) `d ≥ 21.05` and the second-send edge
`a_20 + d = 1 300 + 20d ≤ 1 770`, i.e. `d ≤ 23.5`, so it occurs for
`d ∈ [21.05, 23.5] s`. The sweep in §8 table C
confirms max 40 at `d = 21.1 s` (899.1 s waited, `RATE_BUDGET_EXHAUSTED`) and max
elapsed 1 799.3 s at `d = 29.7 s` (`STAGE_TIMEOUT`).

For **variable** `d`, C3 proves only Corollary 1 (`k ≤ 54` light). A seeded random
search (§8) found at most 38 sends. That is exploration, not proof.

### 5.3 Per-stage tables (c = 0; `B_tok = 6 800`, `B_req = 30`)

Heavy uses `Res = 4 605`; light uses `Res = 3 400`. "Elapsed" is child time from
`t0` to the last settle (or to the refusal). It excludes phases P, A, K, S and V
(§6).

| Stage, N, pass | k | Heavy d=5 | Heavy d=30 | Light d=5 | Light d=30 |
|---|---:|---|---|---|---|
| design, N=1, first | 3 | 3 sends, 195.0 / 210.0 | 3, 195.0 / 285.0 | 3, 125.0 / 140.0 | 3, 100.0 / 190.0 |
| design, N=1, worst | 6 | 6, 390.0 / 420.0 | 6, 390.0 / 570.0 | 6, 185.0 / 215.0 | 6, 135.0 / 315.0 |
| plan or generate, N=1, first | 1 | 1, 65.0 / 70.0 | 1, 65.0 / 95.0 | 1, 65.0 / 70.0 | 1, 65.0 / 95.0 |
| plan or generate, N=1, worst | 2 | 2, 130.0 / 140.0 | 2, 130.0 / 190.0 | 2, 65.0 / 75.0 | 2, 65.0 / 125.0 |
| design, N=6, first | 8 | 8, 520.0 / 560.0 | 8, 520.0 / 760.0 | 8, 245.0 / 285.0 | 8, 170.0 / 410.0 |
| design, N=6, worst | 16 | **13, 845.0 / 910.0, `RATE_BUDGET_EXHAUSTED`** | **13, 845.0 / 1 235.0, `RATE_BUDGET_EXHAUSTED`** | 16, 485.0 / 565.0 | 16, 310.0 / 790.0 |
| plan or generate, N=6, first | 6 | 6, 390.0 / 420.0 | 6, 390.0 / 570.0 | 6, 185.0 / 215.0 | 6, 135.0 / 315.0 |
| plan or generate, N=6, worst | 12 | 12, 780.0 / 840.0 | 12, 780.0 / 1 140.0 | 12, 365.0 / 425.0 | 12, 240.0 / 600.0 |
| any stage, N=200, first or worst | 200–404 | **13, 845.0 / 910.0, `RATE_BUDGET_EXHAUSTED`** | **13, 845.0 / 1 235.0, `RATE_BUDGET_EXHAUSTED`** | **28, 845.0 / 985.0, `RATE_BUDGET_EXHAUSTED`** | **36, 660.0 / 1 740.0, `STAGE_TIMEOUT`** |

Cells read "sends, waited s / elapsed s". Rows without a stop reason complete. Every
N=200 configuration fails closed. Feasible N on a first pass (c = 0, heavy):
design `N + 2 ≤ 13 → N ≤ 11`; plan/generate `N ≤ 13`. With all retries:
design `N ≤ 4`, plan/generate `N ≤ 6`. These match C2's heavy figures and remain
conditional on A4/A5. The heavy-regime numbers agree with the reviewer's
independent figures (N=1 design 195 / 210; N=6 design 520 / 560; 16-send
scenario refused after 13 at ≤ 1 235 s).

### 5.4 Combined workflow

`design`, `plan` and `generate` are separate CLI invocations, each with its own
child, its own cold start and its own ledger. There is no shared clock or
ledger, and the time between invocations is user-controlled. Supported
statements:

- **ALGORITHMIC, per invocation:** governed sends end by child time
  `1 770 + T_REQ = 1 800 s` plus `ε_T`.
- **Summed governed activity (c = 0, heavy, d ≤ 30):** N=1 first pass
  `285 + 95 + 95 = 475 s`; N=1 worst `570 + 190 + 190 = 950 s` (the reviewer's
  `d = 5` figures are 350 s and up to 950 s).
- **Not supported:** any whole-workflow wall-clock bound. C2's "3 × 1 815 s ≈ 91 min"
  is withdrawn. Phases P, K, V and the gaps between invocations are unbounded by
  the product.

### 5.5 Caller processing time (`c > 0`) and RPM variants

| Scenario | Sends | Waited | Elapsed | Stop | Lesson |
|---|---:|---:|---:|---|---|
| heavy, `c = 65`, `d = 0` | 27 | 0.0 | 1 820.0* | `STAGE_TIMEOUT` | Corollary 1's heavy bound is attained. `k ≤ 13` is not universal. |
| heavy, `c = 30`, `d = 30` | 18 | 630.0 | 1 740.0 | `STAGE_TIMEOUT` | the deadline binds in the heavy regime too |
| light, RPM = 2, `d = 0` | 26 | 845.0 | 845.0 | `RATE_BUDGET_EXHAUSTED` | the RPM ledger agrees with tokens |
| light, RPM = 1, `d = 0` | 13 | 845.0 | 845.0 | `RATE_BUDGET_EXHAUSTED` | RPM binds; tokens would allow 26 |
| `Res = 100`, RPM = 30, `d = 0` | 390 | 845.0 | 845.0 | `RATE_BUDGET_EXHAUSTED` | `n_max = 30` (RPM). 390 = 13 × 30 ≤ 27 × 30. |

\* Elapsed includes the caller's 65 s processing before the refused 28th call.
The last send is at 1 755 s ≤ 1 770 s.

---

## 6. Child/parent settlement timelines

Parent clock origin `tSpawn = 0`. Child `t0 = δ` (start-up skew; illustrative
`δ = 0.3 s`). `ε` marks OS-dependent lateness. **No row sums phases into a
CLI-level hard bound.**

### 6.1 Success

| Parent time | Event | Phase |
|---|---|---|
| 0 | spawn; watchdog armed (45 s); enforcement timer armed (1 815 s) | E, H |
| 0.3 | child `t0`; heartbeat seq 1; governor cold start until child 65 s | G |
| 0.3 + 10n | heartbeats; each valid one re-arms the watchdog | H |
| … | sends per §2; each ends ≤ 30 s + ε after start | G |
| r | child `report()`: heartbeat cleared; result sent with receipt | A |
| r + ε | parent stores result in memory; ACK sent; watchdog disarmed | A |
| ≤ r + 10 | child receives ACK → delivered → `setImmediate` disconnect; event loop drains | A |
| x | child `exit` (code 0) | K (no kill) |
| x + ε | `close` → settle; enforcement timer cleared | S |
| after | validate, then synchronous commit (manifest last) | V (unbounded) |

### 6.2 Governor `STAGE_TIMEOUT` (CE-03 inputs)

Child refuses at child 1 738.1 s, before sleeping. The generator returns at once
(non-retryable). The runner reads `terminal = STAGE_TIMEOUT` and reports
`failure.kind = "stage-timeout"`. `process.exitCode = 1`. The parent stores the
result and ACKs it. The child exits 1 and `close` settles. The parent classifies
`STAGE_TIMEOUT`, exit 6. Nothing is written. Parent time at settle:
`≈ δ + 1 738.1 + c + ε`, which is below `K_PARENT`, so enforcement never fires.

### 6.3 Parent enforcement

| Parent time | Event |
|---|---|
| 1 815 + ε | enforcement callback: `killed = STAGE_TIMEOUT`; `result = null`; timers disarmed; SIGKILL / `TerminateProcess` |
| 1 815 + ε + δK | child `exit` (δK: **no product bound**, phase K) |
| ≤ exit + 10 + ε | `close`, or the FT0 `CAE` fallback settles |
| after | envelope `STAGE_TIMEOUT`, exit 6; no validation, no write |

### 6.4 Watchdog

The last valid heartbeat is at `h`. At `h + 45 + ε`: `killed = CHILD_UNRESPONSIVE`;
the rest is as in §6.3. Exit 1.

### 6.5 Parent loss (SEC-C1)

The child observes `disconnect`. In the same turn it aborts the signal and calls
`process.exit(1)`. Zero sends after that. Any in-flight fetch is aborted, and its
remote outcome is unknown. No result is sent. If the parent process survives
(only its channel closed), it settles with no result: `STAGE_FAILED`, exit 1.

### 6.6 Windows missing `close`

The child exits with IPC data unread, and `close` never arrives. `CAE = 10 s`
after `exit`, the parent disconnects, destroys stdio and settles with
`result = null`: `STAGE_FAILED` (exit 1), or the sticky kill reason if E or H
fired first. This is unchanged FT0-C2-D1 behavior.

### 6.7 Result ACKed, then killed

The result is stored and ACKed at `r`. The child is slow to exit, and
enforcement fires before settlement. `killed` wins and the result is discarded:
`STAGE_TIMEOUT`, nothing written. The child may have exited 0 on its own. That
is consistent with INV-12, because the ACK means "in parent memory", not
"accepted".

---

## 7. What is and is not proven

**Proven (ALGORITHMIC, given A1–A2):** INV-01 joint admission; Lemma 1 occupancy;
Corollary 1 `k ≤ 27 · n_max`; Lemma 2 no send with exceeded observed wait; Lemma 3
no send after `t0 + 1 770 s`; Lemma 4 one entry per send; INV-09 sticky refusal;
INV-10 zero sends after cancellation; the closed forms in §5.1 under their stated
assumptions; the CE-01/CE-03/CE-04 traces.

**Reproduced numerically, not proven in general:** the per-stage tables (§5.3)
for constant `d` and `c = 0`; the constant-`d` light maximum of 40 (proved
analytically in §5.2 for constant `d`); random-search maxima.

**Not guaranteed (OS or external):** timer punctuality (`ε`); kill → `exit` latency;
`close` delivery (bounded only by the FT0 `CAE` fallback after `exit`); parent
validation and commit time; heartbeat delivery under a blocked event loop or a very
large result transfer; provider-side accounting; remote completion after a local
abort; monotonic-clock behavior across system suspend.

**Quantitative limitations.**

1. Tables assume constant `Res` and `d`. Real stages mix them. Use Corollary 1
   for a worst-case send count.
2. The heavy bound `k ≤ 13` assumes `c = 0`. With `c > 0`, up to 27 sends are
   possible, and the deadline, not the wait budget, may bind.
3. Light/heavy classification depends on the declared reserves and the heuristic
   estimate (PD-R10), which may be wrong in either direction.
4. Saturation (missing or unavailable usage) turns light behavior into heavy
   behavior. The tables' light columns are therefore best cases for throughput.
5. No figure here is evidence about Groq or Gemini runtime behavior (PD-R9).

---

## 8. Reference simulator (reproduction)

Reproduce with Node 22 (any recent Node works; the script uses no APIs beyond
`console.log`):

```text
1. Copy the block below into c3sim.js outside the repository.
2. node c3sim.js > out.txt
3. Compare out.txt with the "Expected output" block (byte-for-byte, LF line endings).
```

Source (`c3sim.js`, SHA-256 `0259f8a53fc421590ebb8125d44fdb82a559770c045935d214b3af7e339e48b5` with LF endings):

```js
"use strict";
// OD-RATE-1-C2-R3-C3 reference simulator. Design evidence only: pure arithmetic,
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
```

Expected output (SHA-256 `60ecbff5a85dd1666863c0723509fc4f3daf6e71f9c7410cd73388538b4a2352` with LF endings):

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
```

Simulator scope limits: it models sequential sends, the cold start, both ledgers,
PD-R11/PD-R12 charges, the pre-sleep and post-wake checks, the deadline and the
iteration cap. It does **not** model hints, cooldown, the FIFO queue, cancellation,
IPC or process lifecycle. Those are covered by the traces in §4 and §6 and by the
deterministic test specifications in the review matrix.
