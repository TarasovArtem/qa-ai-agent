# OD-RATE-1-C2-R3 — Proofs, Traces and Evidence (Parent Gateway Replacement, C5)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-proofs.md` (2 of 3; companions: [design](od-rate-1-c2-r3-design.md), [review matrix](od-rate-1-c2-r3-review-matrix.md)) |
| Revision | C5 (replaces the C4 proofs at `38121f95938b28e065283707d01a70b05893e94c`) |
| Status | **DESIGN EVIDENCE — PENDING INDEPENDENT EXACT-HEAD ARCHITECTURE AND SECURITY REVIEW.** Nothing here is a production test result. No new test was written or run for this revision. |
| Baseline | `main` `a32a6cd7e0a1bdc9917fc3abc7f692039591a145` / tree `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Spike identity | `src/gateway.js` `f5bc4af4…41ff4`, `test/gateway.test.js` `7059ad21…44bb3`; full list D §2.5 |

**D** = design, **P** = this document, **M** = review matrix. Symbols are those of
D §6.1. Times in traces are milliseconds relative to `tOpen = 0` unless stated.

---

## 1. Evidence labels

Every statement below carries one label. Labels are never combined into a
stronger claim than the weakest one used.

| Label | Meaning | Strength |
|---|---|---|
| **ALG** | Follows from the normative algorithm (§3) and the stated assumptions (§2) by the argument given | proof, conditional on §2 |
| **BASE** | Follows from certified code on `main` `a32a6cd7` (file and line given) | as certified |
| **SPIKE** | Observed in the Gateway spike's tests (test IDs given), Windows 11 / Node v24.22.1 and WSL2 Linux / Node v22.23.3, 82/82, independently verified per the PO (D §2.5) | prototype scope only |
| **ENV** | Runtime observation outside the spike suite (R4 reviewer experiments, C4 localhost runs) | observation, not certification |
| **OPEN** | Production behavior not yet verified | none |
| **HIST** | C4 result under the C4 model; applicability to C5 stated per item | historical |

SPIKE never upgrades a production statement to verified. The spike is not the
production code: different transport (loopback `http`), different rate model
(sliding window, no token ledger), different lifecycle order (disconnect first,
300 ms grace), scenario workers instead of the production runner.

## 2. Model and assumptions

| ID | Assumption | Used by |
|---|---|---|
| A1 | JavaScript run-to-completion in the parent: no callback runs between two statements of one synchronous section. Time **does** pass inside a section. | Lemmas 2–4 |
| A2 | `process.hrtime.bigint()` is monotonic; readings are exact. Timers fire at or after their instant, with lateness `ε ≥ 0`. | all timing lemmas |
| A3 | The session's transport satisfies TS-1 … TS-9 (D §10.1). **SPIKE** for loopback `http` (TS-1 … TS-4, TS-7); **OPEN** for production `https` (TQ-01 … TQ-10). | Lemma 5, PT-04, PT-05 |
| A4 | Certified FT0 behavior of `stage-process.js` and `generative-runner.js` (BASE). | Lemma 9, PT-09, PT-10 |
| A5 | The certified generators issue `analyze()` calls strictly sequentially. Used only for "BUSY never occurs in the supported scope", **never** for safety. | §5 PT-12 note |

A1 is not used to claim that a section takes zero time (R3-ARCH-02, R4-ARCH-01).
Every argument that depends on elapsed time either re-reads the clock or shows
that the quantity cannot change without a sleep.

## 3. Normative pseudocode (one listing; D §8.3, §8.4, §11.6, §13.2 are authoritative)

```js
// ---------- parent: one Gateway session per governed stage child ----------
const MS = 1_000_000n;                                   // ns per ms
function openSession(cfg, adapter, transport, credential) {
  const tOpen = now();                                   // read immediately before spawn()
  return {
    coldUntil: tOpen + 65_000n * MS,
    dispatchDeadline: tOpen + 1_770_000n * MS,           // exclusive
    enforceAt: tOpen + 1_815_000n * MS,
    W: 65_000n * MS,                                     // cold-start charge (PD-R5)
    Btok: floorTok(cfg.tokensPerMinute * 0.85), Breq: cfg.requestsPerMinute,
    entries: [], cooldownUntil: tOpen, hintTok: null, hintReq: null, exhausted: false,
    active: null, revoked: false, terminal: null, lastId: 0,
  };
}

const chargeable = (S, a, b) => { const from = a > S.coldUntil ? a : S.coldUntil; return b > from ? b - from : 0n; };
const refuse = (S, code) => { if (S.terminal === null) S.terminal = { code }; return { outcome: "refused", code: S.terminal.code }; };

async function onRequest(S, req, reply) {                // req: validated plain copy (D §7.2)
  if (req.id <= S.lastId) return reply(req.id, { outcome: "refused", code: "INVALID_REQUEST" });
  S.lastId = req.id;
  if (S.revoked)            return reply(req.id, { outcome: "refused", code: "REVOKED" });
  if (S.active !== null)    return reply(req.id, { outcome: "refused", code: "BUSY" });   // no queue, no state change
  if (S.terminal !== null)  return reply(req.id, { outcome: "refused", code: S.terminal.code });
  S.active = { id: req.id, controller: new AbortController() };
  const out = await run(S, req);                         // never throws
  S.active = null;                                       // before the reply
  if (!S.revoked) reply(req.id, out);
}

async function run(S, req) {
  const res = estimate(req);                             // PD-R10
  if (res > S.Btok) return refuse(S, "RATE_REQUEST_EXCEEDS_BUDGET");
  const body = adapter.buildRequest(req);                // bytes + header template, prepared once
  for (let it = 0; ; it++) {
    const t = now();
    if (S.revoked) return CANCELLED;
    if (S.exhausted) return refuse(S, "RATE_BUDGET_EXHAUSTED");
    if (S.W > W_BUDGET) return refuse(S, "RATE_BUDGET_EXHAUSTED");
    if (t >= S.dispatchDeadline) return refuse(S, "STAGE_TIMEOUT");
    const f = freeAt(S, res, t);
    if (f <= t) return commit(S, res, body);             // synchronous entry into commit()
    if (it >= I_MAX) return refuse(S, "RATE_BUDGET_EXHAUSTED");
    const planned = f - t > S_MIN ? f - t : S_MIN;
    if (planned > W_MAX) return refuse(S, "RATE_BUDGET_EXHAUSTED");
    if (S.W + chargeable(S, t, t + planned) > W_BUDGET) return refuse(S, "RATE_BUDGET_EXHAUSTED");
    if (t + planned >= S.dispatchDeadline) return refuse(S, "STAGE_TIMEOUT");
    const a = now();
    const fired = await sleep(planned, S.active.controller.signal);
    const b = now();
    if (b < a) return refuse(S, "RATE_ACCOUNTING_INVALID");
    S.W += chargeable(S, a, b);                          // the ONLY place W changes after open
    if (!fired || S.revoked) return CANCELLED;
  }
}

async function commit(S, res, body) {                    // no await before transport.send
  const t2 = now();                                      // final reading
  if (S.revoked) return CANCELLED;
  if (t2 >= S.dispatchDeadline) return refuse(S, "STAGE_TIMEOUT");
  const p = transport.send(body.bytes, body.headers(credential), S.active.controller.signal, T_REQ);  // IRREVOCABLE
  const e = { tCommit: t2, tSettle: null, res, charged: res };
  S.entries.push(e);
  return settleExchange(S, e, await p);
}

function settleExchange(S, e, outcome) {                 // once per commit
  const s = adapter.classify(outcome);                   // axes A–E; usage classified before the content check
  e.tSettle = now();
  e.charged = s.usage.class === "VALID" ? (s.usage.U > e.res ? s.usage.U : e.res) : S.Btok;
  applyHintsAndCooldown(S, s);
  if (S.revoked) return CANCELLED;
  if (s.usage.class === "MALFORMED") return refuse(S, "RATE_ACCOUNTING_INVALID");
  if (s.ok && s.content !== null) return { outcome: "content", content: s.content };
  return { outcome: "provider-error", ...adapter.mapFailure(s) };   // existing {code, retryable}
}

function revoke(S) {                                      // parent only; synchronous; idempotent
  if (S.revoked) return;
  S.revoked = true;
  if (S.active) S.active.controller.abort();
}

// ---------- parent supervisor (governed path of stage-process.js) ----------
function onKillDecision(reason) {                         // watchdog or enforcement callback
  if (settled || killed) return;
  revoke(S);                                              // FIRST
  killed = { reason }; result = null; disarm(watchdog, enforcement);
  try { killIssued = child.kill("SIGKILL"); } catch { killIssued = false; }
  kSettleTimer = setTimeout(abandon, 10_000);             // K_SETTLE, approved
}
function abandon() {
  if (settled) return;
  try { if (child.connected) child.disconnect(); } catch {}
  child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
  clearAllGovernedTimers();
  settleOnce({ result: null, abandoned: true, reason: killed.reason });
  stderr(`[qa-agent] ${stage} process did not exit within 10s after termination (pid ${child.pid}); it was abandoned and may still be finishing.`);
}

// ---------- child: Gateway client provider (generators unchanged) ----------
async function analyze({ systemPrompt, userPrompt }) {
  if (cancelSignal.aborted) throw cancelledError();       // certified: UNKNOWN, not retryable, no cause
  ctx.calls += 1;
  const id = ++nextId;
  send({ type: "provider-request", v: 1, id, systemPrompt, userPrompt });
  const r = await responseFor(id, cancelSignal);          // abort -> throw cancelledError()
  if (r.outcome === "content") return r.content;
  if (r.outcome === "provider-error") throw new ProviderError(FIXED[r.code], { code: r.code, retryable: r.retryable });
  if (GOVERNOR_CODES.has(r.code)) throw refuseLocally(r.code);      // ctx.terminal + ctx.refusals (D §15.1)
  throw new ProviderError(FIXED.UNKNOWN, { code: "UNKNOWN", retryable: false });   // BUSY, REVOKED, INVALID_REQUEST
}
```

`freeAt`, `estimate`, the usage normalizer and the hint grammar are as D §8.6 and
D §11.2–§11.3. `applyHintsAndCooldown` changes only `cooldownUntil`, `hintTok`,
`hintReq` and `exhausted`.

---

## 4. Lemmas

**Lemma 1 (single active request; no queue).** At any instant at most one request
of a session is between acceptance and reply, and no request ever waits for another.
*Proof (ALG).* `onRequest` tests `active !== null` and sets `active` in one
synchronous section before its first `await` (A1). A request finding `active !== null`
is answered `BUSY` in that section and returns. Nothing stores it, so no queue exists.
`active` is cleared only after `run` returns, i.e. after `settleExchange` or a refusal. ∎
*Evidence:* SPIKE G8 (BUSY during wait and in flight), P4 (BUSY reply overtakes the in-flight reply).

**Lemma 2 (wait budget at commit; R4-ARCH-01).** Every `transport.send()` call happens
with `W ≤ W_BUDGET`, and `W` at that moment equals the `W` checked in the same iteration.
*Proof (ALG).* After session open, `W` is assigned only in `run`, in the statement right
after `await sleep(...)`. A commit happens in an iteration whose top tested
`S.W > W_BUDGET` false. Between that test and `send`, `run` and `commit` execute no
`await` (commit is entered synchronously; its only `await` follows `send`), so no
sleep of this request completes in between. By Lemma 1 no other request of the session
is sleeping. Hence `W` is unchanged between the test and `send`. Synchronous computation
(`freeAt`, bookkeeping) is not governor waiting and does not change `W`. ∎
*Evidence:* SPIKE G1, G2, G3b, G5 (prepare CPU time not charged); replay §6.1.

**Lemma 3 (exclusive dispatch deadline).** Every `transport.send()` call is preceded, in
the same synchronous section, by a reading `t2` with `t2 < dispatchDeadline` and
`revoked === false`; no other statement but the two tests lies between `t2` and the
call. No sleep starts when it would end at or after `dispatchDeadline`.
*Proof (ALG).* Direct from `commit()` and the pre-sleep test in `run()`. The ledger,
cold-start, cooldown and hint predicates evaluated at the loop reading `t ≤ t2` remain
true at `t2`: entries only expire as time passes; cooldown, hints and `exhausted` change
only in `settleExchange`, and no exchange of the session is outstanding (Lemma 1);
`coldUntil` is fixed and `t2 ≥ t ≥ coldUntil`. So every admission predicate holds at
`t2` (INV-G01). ∎
*Evidence:* SPIKE E2 (now = deadline → 0 transport, 0 HTTP), E3, E4a, E4b, G10
(checks and send in one turn), GWV01-2, GWV01-3, GWV01-6.

**Lemma 4 (Property A).** After `revoke(S)` returns, `transport.send()` is never called
for `S`.
*Proof (ALG).* `send` is called only in `commit()`, directly after testing `S.revoked`
with no intervening `await` (Lemma 3). `revoke` sets `S.revoked = true` as its first
statement and never resets it. By A1, `revoke` runs entirely before or entirely after
the section `[test revoked … call send]`. If before, the test refuses. If after, the
`send` call preceded the revocation; it is aborted best effort (TS-4) and is not a
dispatch after revocation. Every other path to `commit` passes the loop-top test of
`S.revoked` after its last `await`; a sleep in progress is aborted by `revoke` and then
returns `CANCELLED`. Requests received later are refused at `onRequest`. The transport
and credential are reachable only from the session. ∎
*Scope:* per session. A later stage has its own session. Property A says nothing about
network activity outside the Gateway (Property B, D §13.4).
*Evidence:* SPIKE G4, G9, G11, G12, P5, P7, P9, P12 (0 authorized sends from an
abandoned child), GWV01-7.

**Lemma 5 (one commit, one invocation, at most one HTTP request).** Each commit makes
exactly one `transport.send()` call. Under A3, each call writes at most one HTTP request.
*Proof (ALG + A3).* `commit()` contains one `send` call and is entered once per request
(it returns the settled outcome). No Gateway code calls `send` elsewhere. A3/TS-1 … TS-3
exclude retry, redirect following and pooled-socket resend. ∎
*Evidence:* SPIKE T1–T10 (loopback `http`: 1 request for 200, each 3xx, **421**, 429, 500,
reset, timeout, in-flight abort; 0 for pre-abort), B1 (global `fetch`: 2 POSTs on 421);
ENV R4 (fetch + `redirect:"manual"`: 2 POSTs on 421, Node 22.23.3 and 24.22.1).
**OPEN** for production `https` (TQ-01 … TQ-03).

**Lemma 6 (ledger occupancy).** Any half-open 65 s interval contains at most `B_req`
and at most `floor(B_tok / Res_min)` commits of a session.
*Proof (ALG).* Let `s_j < s_L` be commit readings in `I = [x, x + 65 000)`. Request `j`
was settled before request `L` was accepted (Lemma 1), so `tSettle_j ≤ s_L` and
`tSettle_j ≥ s_j`. Then `s_L < x + 65 000 ≤ s_j + 65 000 ≤ tSettle_j + 65 000`, so entry
`j` is live at `s_L`. The commit at `s_L` required `reqLive(s_L) + 1 ≤ B_req` and
`tokLive(s_L) + res_L ≤ B_tok`, with every live `charged ≥ Res_min` (Lemma 7). ∎
**Corollary 6.1.** Commit readings lie in `[65 000, 1 770 000)` (Lemma 8, Lemma 3). That
span has length 1 705 000 and is covered by `⌈1 705 000 / 65 000⌉ = 27` half-open 65 s
intervals, so a session makes at most `27 · n_max` commits, `n_max = min(B_req, floor(B_tok / Res_min))`,
for any durations, retries and child processing times. Under A3 the same bounds hold
for HTTP requests.
*Evidence:* ALG only. The spike's rate model is a plain sliding window without a token
ledger; it does not exercise this lemma.

**Lemma 7 (accounting).** (a) Each commit creates exactly one entry and refusals create
none. (b) `charged` is `res` until settlement, then set once to `max(res, U)` for
`VALID(U)` and to `B_tok` otherwise; it is `≥ res` and never changes afterwards.
(c) Entries are never removed while live. (d) `W` never decreases.
*Proof (ALG).* (a) `entries.push` occurs only in `commit()`, once. (b) `settleExchange`
runs once per commit (it is reached only through the single `await p`, and TS-7 settles
`p` once) and is the only writer after commit. (c) No code removes entries; liveness is
evaluated, not stored. (d) `chargeable() ≥ 0` and is the only update. ∎ No double charge,
no hidden refund.
*Evidence:* ALG; the spike has no usage accounting.

**Lemma 8 (cold start).** No commit happens before `coldUntil`, and `W ≥ C_COLD` at every
instant after session open.
*Proof (ALG).* `freeAt` returns a value `≥ coldUntil`, and a commit requires `f ≤ t ≤ t2`.
`W` starts at `C_COLD` and never decreases (Lemma 7d). A sleep inside
`[tOpen, coldUntil)` adds `chargeable = 0` for that part, so the cold start is charged
exactly once. ∎
*Evidence:* ALG only (the spike had an `initialChargedMs` seam but no cold-start rule).

**Lemma 9 (lifecycle).** (a) The stage settles exactly once. (b) After a kill decision no
stored result is accepted. (c) After a kill decision without `exit`, the settlement
decision happens at the first callback at or after `tKill + K_SETTLE`; with `exit` at
`tExit`, at `close` or at the first callback at or after `tExit + CAE`.
*Proof.* (a) BASE: every settlement path goes through the certified `settled` guard
(`stage-process.js` L102–L160); `abandon()` tests and sets it. (b) ALG: `onKillDecision`
sets `result = null` and `killed`; acceptance requires `killed === null` (INV-G12).
(c) ALG from the timers armed in `onKillDecision` and the FT0 `exit` handler. ∎
*Evidence:* BASE for FT0 parts; SPIKE P0, P11, P12 for a 10 000 ms bound on a different
(disconnect-first) ordering; production ordering **OPEN**.

**Lemma 10 (governor codes cannot be forged by the child).** A governor reason code
reaches the envelope only if the parent session issued it.
*Proof (ALG).* D §15.2: the parent strips governor codes from the child's report and
adds `session.terminal.code` only when set; a `stage-timeout` report without the
matching terminal is an invariant violation (`STAGE_FAILED`). ∎

---

## 5. Required traces

Each trace lists the evidence label. "HTTP" counts requests written by the transport.

### PT-01 Budget exhausted before admission (ALG; SPIKE G1, G2)

| Step | State |
|---|---|
| request arrives at `t = 1 000 000`; `W = 899 990`; one more ms needed for capacity | `f − t = 1` |
| `planned = max(1, 50) = 50`; `chargeable(t, t + 50) = 50` | `899 990 + 50 = 900 040 > 900 000` |
| refuse before sleeping | `RATE_BUDGET_EXHAUSTED` (sticky); 0 sleeps, 0 commits, 0 HTTP; `W`, entries unchanged |
| variant: `W = 900 000` exactly and capacity free (`f ≤ t`) | commit allowed (`W ≤ W_BUDGET`); any later planned wait `> 0` is refused (G2) |

### PT-02 Wait ending exactly at the deadline (ALG; SPIKE E4a, E2)

| Step | State |
|---|---|
| `dispatchDeadline = 1 770 000`; request at `t = 1 769 500`; capacity free at `1 770 000` | `planned = 500` |
| pre-sleep test `t + planned = 1 770 000 >= 1 770 000` | `STAGE_TIMEOUT` before sleeping; `W` unchanged; 0 HTTP |
| variant: reading exactly `1 770 000` with capacity free | loop-top test `t >= dispatchDeadline` → `STAGE_TIMEOUT`; 0 HTTP (E2) |
| variant: reading `1 769 999`, capacity free, `t2 = 1 769 999` | commit; 1 HTTP (E1) |

### PT-03 Timer overshoot at the final dispatch boundary (ALG; SPIKE E4b, GWV01-6, G3a, G3b)

| Step | State |
|---|---|
| `t = 1 769 500`; capacity at `1 769 900`; `planned = 400`; `1 769 900 < 1 770 000` | sleep starts at `a = 1 769 500` |
| timer fires 100 ms late; `b = 1 770 000` | `W += 500` (actual elapsed) |
| loop top: `t = 1 770 000 >= dispatchDeadline` | `STAGE_TIMEOUT`; 0 commits; 0 HTTP; the 500 ms stay charged |
| budget variant: `W = 899 900`, `planned = 50` (`899 950 ≤ 900 000`), timer 140 ms late | `W = 900 090`; loop top `W > W_BUDGET` → `RATE_BUDGET_EXHAUSTED`; 0 HTTP; `W` stays `900 090` |

AD-04 holds: the overshoot increased the charge and permitted no dispatch.

### PT-04 HTTP 421 with exactly one send (ALG + A3; SPIKE T3, B1; ENV R4; OPEN TQ-01)

| Step | State |
|---|---|
| commit at `t2`; `send()` | 1 transport invocation |
| server answers `421 Misdirected Request` | TS-1: no resend; outcome `RESPONSE`, status 421; **HTTP = 1** |
| `settleExchange`: body not read → usage `UNAVAILABLE` | `charged = B_tok` |
| adapter mapping (Groq and Gemini: "other status") | `provider-error UNKNOWN`, not retryable → generator stops; no attempt 2 |
| contrast: global `fetch` | 2 POSTs for one call (spike B1; R4 on Node 22.23.3/undici 6.28.1 and 24.22.1/undici 7.30.1) |

### PT-05 Redirect refusal (ALG + A3; SPIKE T2 ×5)

| Step | State |
|---|---|
| server answers `307 Location: /second` (same for 301/302/303/308) | TS-2: not followed; **HTTP = 1**; redirect target requests = 0 |
| usage `UNAVAILABLE` | `charged = B_tok` |
| mapping | `UNKNOWN`, not retryable (both providers) |

### PT-06 Revocation before send (ALG; SPIKE G4, G9, P7, GWV01-7)

| Case | Sequence | Result |
|---|---|---|
| (a) during a wait | request sleeping from `a`; watchdog decision at `a + 20` → `revoke` → sleep aborted | `W += 20` (AD-05); `CANCELLED`; 0 commits; 0 HTTP |
| (b) request after revocation | result stored → `revoke`; child (delayed disconnect) sends `provider-request` | `refused REVOKED`; 0 commits; 0 HTTP |
| (c) revocation "between" the final check and `send` | impossible: the section has no `await` (A1); `revoke` runs before (refused) or after (case PT-07) | — |

### PT-07 Revocation during in-flight transport (ALG; SPIKE G11, T7, P9)

| Step | State |
|---|---|
| commit at `t2`; `send()` entered | HTTP = 1 (may already be remote) |
| enforcement decision → `revoke` → `controller.abort()` | TS-4: request destroyed; outcome `ABORTED` |
| `settleExchange` | usage `UNAVAILABLE` → `charged = B_tok`; `tSettle` set; `revoked` → `CANCELLED`, no reply |
| server-side count | stays 1; no resend (P9: `maybeReachedRemote`) |

The abort does not undo the transmitted request (D §13.7).

### PT-08 Child surviving abandonment (ALG; SPIKE P11, P12, P13, P14)

| Parent time | Event |
|---|---|
| `tKill` | watchdog decision: `revoke` (first), `killed`, `result = null`, `kill("SIGKILL")` → not delivered (fault injection) |
| `tKill + 10 000` (first callback at or after) | abandonment: `disconnect()` in `try`, stdio destroyed, `unref()`, timers cleared, settle `CHILD_UNRESPONSIVE` (1), one stderr line |
| after | child keeps running |

| Quantity | Value | Label |
|---|---|---|
| Gateway `send()` calls after `tKill` | **0** (Lemma 4) | ALG; SPIKE P12 |
| Credentialed provider calls by the child | impossible without the credential, which is not in its env or IPC | ALG; SPIKE P13 (no credential in child env), P14 (no transport verb) |
| Unauthenticated direct requests by the child | **possible**: 53 (Windows) / 55 (Linux) in P12 | SPIKE — **Property B NOT PROVIDED** |
| Child termination | not guaranteed | — |

### PT-09 Result followed by nonzero exit (BASE; SPIKE GWV03-1)

| Step | State |
|---|---|
| child sends `result {ok:true, …, receipt}` | parent: `revoke("result")`; store; ACK receipt (FT0) |
| child exits with code 7; `close(7)` | `finish(7, null)` (BASE `stage-process.js` L139) |
| parent acceptance `result.ok === true && exitCode === 0` | false (BASE `generative.js` L83) |
| `classifyChildFailure()`: stored result has no `failure` | `STAGE_FAILED` (1), existing message; nothing written |

No new public field. The spike's `child_failed`/`resultRejection: NONZERO_EXIT` is not emitted (D §15.4).

### PT-10 Normal FT0 ACK/close and missing-close recovery (BASE; FT0-C2-D1)

| Case | Sequence | Result |
|---|---|---|
| (a) normal | requests answered → `result` → `revoke` → store → ACK → child `delivered`, own `disconnect` via `setImmediate` → `exit 0` → `close` | settle by `close`; INV-G12 holds → validate and commit |
| (b) Windows `exit` without `close` | `exit 0`; no `close` | first `CAE` callback at or after `tExit + 10 000`: `result = null`, `disconnect()` if connected, stdio destroyed, settle → `STAGE_FAILED` (1) |
| (c) duplicate result | second `result` message | ignored (first result only, BASE L123) |

No parent kill, timer or grace is involved in (a). The certified receipt/ACK and
close-based settlement are unchanged.

### PT-11 Usage accounting on content failure (ALG; no spike coverage)

`Res = 3 400`, `B_tok = 6 800`, HTTP 200, body parsed.

| Usage in body | Content | Usage class | `charged` | Child receives |
|---|---|---|---:|---|
| `{100, 6 900, 7 000}` | absent | `VALID(7 000)` | **7 000** | `provider-error INVALID_RESPONSE`, not retryable |
| `{100, 900, 1 000}` | absent | `VALID(1 000)` | 3 400 | `provider-error INVALID_RESPONSE` |
| absent | absent | `MISSING` | 6 800 | `provider-error INVALID_RESPONSE` |
| `{3 000, 900, 3 500}` (`3 500 < 3 900`) | absent | `MALFORMED` | 6 800 | `refused RATE_ACCOUNTING_INVALID` (sticky) |
| `{3 000, 900, 3 500}` | present | `MALFORMED` | 6 800 | `refused RATE_ACCOUNTING_INVALID`; content discarded (PD-R12-I1) |
| `total_tokens = 10 000 001` | present | `MALFORMED` | 6 800 | `refused RATE_ACCOUNTING_INVALID` |

After the first row `tokLive = 7 000 > B_tok`: every commit waits until
`tSettle + 65 000`. Nothing is clamped or refunded.

### PT-12 BUSY refusal without hidden queueing (ALG; SPIKE G8, P4)

| Step | State |
|---|---|
| request `id 1` accepted; sleeping or in flight | `active = {id: 1}` |
| request `id 2` arrives | `active !== null` → `refused BUSY` at once; no entry, no sleep, `W` unchanged, no queue |
| replies | `BUSY` for `id 2` may arrive before the reply for `id 1` (P4); the child matches by `id` |
| child | `BUSY` → `UNKNOWN`, not retryable |
| `id 1` | continues unaffected |

A5: the certified generators never send `id 2` before the reply to `id 1`, so BUSY
is unreachable in the supported scope. Lemma 1 does not rely on A5.

---

## 6. Replays of review counterexamples

### 6.1 R4-ARCH-01 (wait budget before admission)

C4 trace: `W = 899 990` at `analyze()` entry, 20 ms computation, union model adds it,
`W = 900 010` at entry creation, no re-check → admitted. C5: computation is not governor
waiting, so `W` stays `899 990` (Lemma 2) and the commit honors `W ≤ 900 000` under the
approved meaning (D §9.1). If capacity requires any sleep, the pre-sleep test refuses
(PT-01). If an earlier sleep had raised `W` above the budget, the loop-top test refuses
(PT-03 variant). **Result: no commit with `W > W_BUDGET`.**

### 6.2 R4-ARCH-02 (hidden resend)

R4: one `fetch` with `redirect: "manual"`, server `421` then `200` → 2 POSTs. C5 never
uses `fetch` on the governed path; the single-send transport writes 1 request and maps
421 to non-retryable `UNKNOWN` (PT-04). SPIKE T3 vs. B1 shows the difference on both
runtimes. HTTPS: **OPEN** (TQ-01).

### 6.3 R4-ARCH-03 (surviving child after abandonment)

R4: after parent `disconnect()`, a live child continued with `aborted=false`,
`transportAllowed=true` until its `disconnect` event ran. C5: the child has no governed
transport and no credential; the parent revoked at the kill decision, before `kill()`
and long before abandonment. Gateway dispatches after revocation: 0 (Lemma 4; SPIKE
P12). The child's direct network ability is Property B, not provided (PT-08).

### 6.4 R4-ARCH-04 (FIFO and the single slot)

R4: two concurrent light callers (`Res = 2 500`, `B_tok = 6 800`); the second passed
capacity checks while the first slot was open. C5: no FIFO, no slot replacement; the
second request is refused `BUSY` (PT-12, Lemma 1).

### 6.5 R3-ARCH-02 (1 ms of setup before dispatch)

C3: admission at `1 770 000`, 1 ms of serialization, dispatch at `1 770 001`. C5: the body
is prepared before the wait loop; the final reading `t2` is taken after all computation
and immediately before `send`. Any setup time is already inside `t2`, and
`t2 >= dispatchDeadline` refuses (Lemma 3).

### 6.6 Spike GWV-01 (deadline not forwarded; then equality)

Spike C1 found the parent did not pass its deadline to the Gateway; C2 found the
Gateway dispatched at exactly the deadline. C5: one absolute `dispatchDeadline` from
the parent's single origin, used by every Gateway check, with `>=` refusal at both the
pre-sleep and commit tests (D §9.2). SPIKE E2, E4a, E4b, GWV01-1 … GWV01-8.

---

## 7. Quantitative bounds

### 7.1 Retained for C5 (ALG)

| Statement | Basis |
|---|---|
| Commits per session `≤ 27 · n_max` | Corollary 6.1 |
| Commits per half-open 65 s interval `≤ min(B_req, floor(B_tok / Res_min))` | Lemma 6 |
| Under A3, the same bounds for HTTP requests | Lemma 5 |
| Governor waiting `W` at every commit `≤ 900 000`; overshoot only after the last sleep | Lemma 2; D §9.3 |
| No commit at a reading `>= 1 770 000` from `tOpen` | Lemma 3 |

### 7.2 Historical C4 results (HIST; not re-derived for C5)

The C4 proofs (`38121f95`, P §5 and P §8) computed admission counts for the C4 model.
R4 independently re-ran both C4 artifacts with matching output hashes
(`c4sim.js` output `93245eac54d8185f6ddaae94a7859ef9a8c7bc5c94ac19068a113f722c0ae20c`;
`c4closed.js` output `81470fd6f2424d9cda73eb00a51109c947b48a325cd90b5fa68ab305fcd988e2`)
and confirmed them **under C4's stated premises**.

| C4 result | C4 premises | Applicability to C5 |
|---|---|---|
| Constant-`d` light regime: 38 (`d = 21 052`), 40 (`21 053`), 40 (`23 500`), 39 (`23 501`), 36 (`29 900`) | child clock origin `t0`; deadline admitted a reading equal to `1 770 000`; `c = 0`; constant `Res`, `d` | **Not transferable.** At `d = 23 500` the 40th send was exactly at `1 770 000`, which C5 refuses. C5's origin precedes the child's `t0` by child startup, and `c > 0` always (IPC round trip). |
| Variable-`d` trace: 41 sends, last at exactly `1 770 000`; Lemma 6 `k ≤ 41` for `c = 0` | as above, two slots | **Not transferable.** The trace's last admission is refused under C5; `c = 0` never holds exactly in C5. |
| Heavy regime: 13 sends, 845 s waited | `c = 0`, waits of exactly 65 s | **Not transferable.** With `c > 0` waits shrink by `c`; only Corollary 6.1 bounds the count. |
| Corollary `k ≤ 27 · n_max` (54 for `n_max = 2`) | admissions in a 1 705 s span | **Re-derived** for C5 as Corollary 6.1 (exclusive end; same 27). |
| Per-stage tables (design/plan/generate, N = 1, 6, 200) | constant `Res`, `d`; `c = 0` | Illustrative only. |

C5 makes no claim that any of these counts is attained or is a maximum.

---

## 8. Spike evidence index (SPIKE)

| Claim | Spike tests | Covers | Does not cover |
|---|---|---|---|
| Wait budget refused before sleep; exact reach; overshoot charged; no dispatch after overshoot | G0, G1, G2, G3a, G3b | sum-of-sleeps charging, `W_MAX = 900 000` | cold-start charge; PD-R3 per-wait cap; iteration cap |
| Cancelled wait charged | G4 | AD-05 | — |
| Exclusive deadline at admission and commit | E1, E1b, E2, E3, E4a, E4b; GWV01-1 … 8 | AD-04 with real loopback transport | production origin `tOpen`; enforcement timer |
| Commit point in one synchronous turn | G10 | Lemma 3 structure | — |
| Revocation: synchronous, idempotent, before disconnect/kill; no send after | G9, G11, G12, P5, P7, P12, GWV01-7 | Property A | Property B |
| In-flight abort, no resend | G11, T7, P9 | PT-07 | remote effects |
| Single send for every status incl. 421; no redirect following | T1–T10; B1 baseline | TS on loopback `http` | TLS, DNS, real providers, Windows Node 22.x |
| BUSY, no queue; out-of-order replies by id | G8, P4 | AD-06 | — |
| Closed IPC schema; malformed/duplicate requests do nothing | S1–S7, P2, P3 | D §7.2 | production message set |
| Credential absent from child and Gateway surface | P13, G13, G14 | D §3.3 | compromised-child confinement (SG-03) |
| Result accepted only after exit 0 | GWV03-1 … 6 | PT-09 (already BASE in production) | — |
| `K_SETTLE = 10 000 ms` abandonment; surviving child | P0, P11, P12 | bounded parent phase; B probe 53/55 | production order (no disconnect at kill) |
| Owned-process audit by observed exit status | GWV02-1 … 7, P99 | test methodology for future suites | — |

Not covered by the spike at all: token ledger and usage accounting (PT-11), cold start,
cooldown and hints, heartbeat and watchdog, the production runner and generators, the
StageContext classification, the production lifecycle order, HTTPS.

## 9. What is and is not proven

**Proven (ALG, given §2):** Lemmas 1–10; PT-01, PT-02, PT-03, PT-06, PT-07, PT-11, PT-12;
the transport-dependent parts of PT-04, PT-05, PT-08 conditionally on A3; Corollary 6.1.

**Shown by certified code (BASE):** PT-09, PT-10; exactly-once settlement.

**Observed in the spike (SPIKE), prototype scope:** single-send loopback transport incl.
421; exclusive deadline; revocation/Property A; BUSY; closed schema; credential-free
child; 10 000 ms abandonment; Property B **absent** (53/55 direct requests).

**Open (OPEN):** production HTTPS transport (TQ-01 … TQ-10); integrated production
lifecycle order; Windows on Node 22.x; real provider behavior (PD-R9).

**Not provided:** Property B; credential confinement against a compromised same-user
child; termination of a non-cooperative child; wire-emission timing; remote rollback.
