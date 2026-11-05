# OD-RATE-1-C2-R3 — Proofs, Traces and Evidence (Parent Gateway, C6 Consolidated Containment Corrective)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-proofs.md` (2 of 3; companions: [design](od-rate-1-c2-r3-design.md), [review matrix](od-rate-1-c2-r3-review-matrix.md)) |
| Revision | C6 (amends the C5 proofs at `0c91393d68f9ac66f8ae5a7e9a719d76187fed03`; C5 replaced the C4 proofs at `38121f95`). C6 changes: Lemma 3 (C5-ARCH-01), Lemma 9 (C5-ARCH-02), Lemma 4b and Lemmas 11–15 (containment), PT-08 replaced, PT-13 … PT-26 added, provenance (§10). |
| Status | **DESIGN EVIDENCE — PENDING INDEPENDENT EXACT-HEAD ARCHITECTURE AND SECURITY REVIEW.** Nothing here is a production test result. No new test, probe or host experiment was written or run for this revision. **Host feasibility BLOCKED: every containment statement is conditional on host assumptions that no one has verified (D §30).** |
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
| **ALG** | Follows from the normative algorithm (§3) and the stated assumptions (§2) by the argument given. Matrix status `ALGORITHMICALLY_PROVEN` | proof, conditional on §2 |
| **ALG/H** | (C6) ALG **conditional on host assumptions** `H-L…` / `H-W…` (D §27.4.1, §27.5.1), which are ASSUMPTION provenance. Matrix status `ALGORITHMICALLY_PROVEN` plus `HOST_NOT_VERIFIED` | proof of the design logic only; says nothing about any host |
| **BASE** | Follows from certified code on `main` `a32a6cd7` (file and line given) | as certified |
| **SPIKE** | Observed in the Gateway spike's tests (test IDs given), Windows 11 / Node v24.22.1 and WSL2 Linux / Node v22.23.3, 82/82. Independent C2 verdict: PO-SUPPLIED (D §2.5) | prototype scope only |
| **SMOKE** | (C6) Host-feasibility setup smoke S1–S7 and WSL2 inventory (D §30.1); author-observed | not a probe, not a certification |
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
| A6 | (C6) The launcher satisfies LC-1 … LC-10 (D §27.3), and the host satisfies the platform's `H-L…` / `H-W…` assumptions (D §27.4.1, §27.5.1). **ASSUMPTION provenance; every item is an open qualification gate (D §30.2).** | Lemmas 11–15 (ALG/H) |
| A7 | (C6) Status records reach the parent in the order the launcher wrote them, and every record written before the launcher's exit is read before the launcher's `close` event (one pipe, stream order). | Lemma 12, PT-15 |

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
    // C6 (C5-ARCH-01): fresh pre-sleep reading; checks at `a`; no await before the sleep is armed
    const a = now();
    if (a < t) return refuse(S, "RATE_ACCOUNTING_INVALID");
    if (S.revoked) return CANCELLED;
    if (a >= S.dispatchDeadline) return refuse(S, "STAGE_TIMEOUT");
    if (S.W + chargeable(S, a, a + planned) > W_BUDGET) return refuse(S, "RATE_BUDGET_EXHAUSTED");
    if (a + planned >= S.dispatchDeadline) return refuse(S, "STAGE_TIMEOUT");
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

// ---------- parent: pass-through session (C6, PD-C6-1; ungoverned) ----------
async function onRequestPT(S, req, reply) {               // provider = certified createProvider(..., {cancelSignal})
  if (req.id <= S.lastId) return reply(req.id, { outcome: "refused", code: "INVALID_REQUEST" });
  S.lastId = req.id;
  if (S.revoked)         return reply(req.id, { outcome: "refused", code: "REVOKED" });
  if (S.active !== null) return reply(req.id, { outcome: "refused", code: "BUSY" });
  S.active = { id: req.id };
  let out;
  try { out = { outcome: "content", content: await S.provider.analyze(req) }; }      // only call site
  catch (e) { out = S.revoked ? CANCELLED : { outcome: "provider-error", code: e.code, retryable: e.retryable }; }
  S.active = null;
  if (!S.revoked && out !== CANCELLED) reply(req.id, out);
}

// ---------- parent supervisor (stage-process.js; C6: both modes) ----------
// child = the LAUNCHER process (D §27.3). C.state is the containment state (D §27.2).
function onStatusRecord(rec) {                            // validated against the closed schema; else LAUNCHER_FAULT
  if (settled) return;
  if (!allowedIn(C.state, rec)) return faultAndTerminate("LAUNCHER_FAULT");                     // T7d
  switch (rec.type) {
    case "ready":              C.state = PROCESS_RUNNING; C.pid = rec.workerPid; break;         // T1
    case "setup-failed":       C.setupFailed = true; break;                                     // T2 at launcher exit
    case "worker-exit":        C.leaderExit = rec; C.exitSeen = true;
                               if (C.state === PROCESS_RUNNING || C.state === TERMINATION_REQUESTED)
                                 C.state = PROCESS_EXIT_OBSERVED; break;                        // T4, T5 (C.termRequested kept)
    case "termination-delivered": C.delivered = rec.ok; break;
    case "containment-empty":  C.state = CONTAINMENT_EMPTY; break;                              // T6 (Windows)
    case "cleanup-unresolved": C.state = CLEANUP_UNRESOLVED; break;                             // T7a
  }
}
function onTerminationDecision(reason) {                  // watchdog/enforcement (governed); IPC_LOST, LAUNCHER_FAULT (both)
  if (settled || killed) return;
  revoke(S);                                              // FIRST
  killed = { reason }; result = null; disarm(watchdog, enforcement);
  requestContainmentTermination();                        // Linux: kill(C.pid,"SIGKILL") under the PID-reuse guard,
                                                          //   else fallback kill(launcher) and C.confirmable = false (T7f);
                                                          // Windows: control "terminate", fallback kill(launcher), C.confirmable = false
  C.termRequested = true;
  if (C.state === PROCESS_RUNNING) C.state = TERMINATION_REQUESTED;                             // T3
  kSettleTimer = setTimeout(settleUnresolved, 10_000);    // K_SETTLE: settlement bound ONLY (PD-C6-5)
}
function onLauncherExit(code, signal) {                   // FT0 "exit": clear K_SETTLE; arm CAE (FT0, unchanged)
  clearTimeout(kSettleTimer);
  if (isLinux && C.exitSeen && C.confirmable !== false && consistent(code, signal, C.leaderExit))
    C.state = CONTAINMENT_EMPTY;                          // R-L-EMPTY (D §27.4.4), T6 (Linux)
  else if (C.state === LAUNCHING && C.setupFailed) C.refusal = true;                            // T2
  else if (C.state !== CONTAINMENT_EMPTY) C.state = CLEANUP_UNRESOLVED;                         // T7b, T7e
}
function onLauncherClose(code, signal) { settleOnce(classify(C, killed, result, code, signal)); }   // event-driven; may be immediate
function settleUnresolved() {                             // first K_SETTLE callback, no launcher exit seen
  if (settled) return;
  if (C.state !== CONTAINMENT_EMPTY) C.state = CLEANUP_UNRESOLVED;                              // T7c
  try { if (child.connected) child.disconnect(); } catch {}
  closeControlChannel(); destroyLauncherStreams(); child.unref();
  clearAllStageTimers();
  settleOnce({ result: null, containment: C.state, reason: killed.reason });
  stderr(`[qa-agent] ${stage} process termination could not be confirmed within 10s (launcher pid ${child.pid}); provider access was revoked; processes may still be running.`);
}
// classify(): INV-G12 acceptance requires C.state === CONTAINMENT_EMPTY; CLEANUP_UNRESOLVED -> candidate
// WORKER_TERMINATION_UNCONFIRMED; C.refusal -> candidate HOST_ISOLATION_UNAVAILABLE (D §27.2.3).

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
`hintReq` and `exhausted`. (C6) The child message router serves a
`provider-request` only when `C.state === PROCESS_RUNNING` and the session is not
revoked (D §7.5, INV-G20). It routes to `onRequest` (governed) or `onRequestPT`
(pass-through). The parent decides termination with `IPC_LOST` on a child
`disconnect` without a valid C7 post-ACK intent/permit transaction (D §32.4), and with `LAUNCHER_FAULT` on T7d.

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

**Lemma 3 (exclusive dispatch deadline; C6 pre-sleep form).** Every `transport.send()` call is preceded, in
the same synchronous section, by a reading `t2` with `t2 < dispatchDeadline` and
`revoked === false`; no other statement but the two tests lies between `t2` and the
call. (C6) No sleep starts unless a **fresh** reading `a`, taken after all
synchronous planning work of the iteration, satisfies `a < dispatchDeadline`,
`a + planned < dispatchDeadline` and `W + chargeable(a, a + planned) ≤ W_BUDGET`.
Only those comparisons and the arming of the timer lie between `a` and the start
of the sleep.
*Proof (ALG).* The commit part follows directly from `commit()`. The pre-sleep part:
in `run()`, `a = now()` is the first statement after the per-wait cap test, and the
checks that follow use `a`, never the loop reading `t`. The section from `a` to
`sleep(...)` contains no `await` (A1). The timer is armed inside `sleep()` before the
first `await` yields, so the armed sleep starts at a reading `≥ a`, and its planned
end is `≥ a + planned`. Synchronous work done before `a` (`freeAt`, bookkeeping) can
no longer make the test stale (C5-ARCH-01). Lateness between `a` and the arming is
the disclosed granularity (a few comparisons). A sleep that still ends at or after
the deadline because of timer lateness is refused at the next loop top and at the
commit check. The ledger,
cold-start, cooldown and hint predicates evaluated at the loop reading `t ≤ t2` remain
true at `t2`: entries only expire as time passes; cooldown, hints and `exhausted` change
only in `settleExchange`, and no exchange of the session is outstanding (Lemma 1);
`coldUntil` is fixed and `t2 ≥ t ≥ coldUntil`. So every admission predicate holds at
`t2` (INV-G01). ∎
*Evidence:* SPIKE E2 (now = deadline → 0 transport, 0 HTTP), E3, E4a, E4b, G10
(checks and send in one turn), GWV01-2, GWV01-3, GWV01-6. The C6 fresh pre-sleep
reading is ALG only; the spike did not have it (PT-13).

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

**Lemma 4b (Property A, pass-through; C6).** After `revoke(S)` returns, a pass-through
session makes no new `provider.analyze()` call.
*Proof (ALG).* `provider.analyze()` is called only in `onRequestPT`. The call follows
the `S.revoked` test in the same synchronous section (the `active` test and the
assignment lie between them; no `await` does). By A1, `revoke` runs entirely before
that section (the test refuses) or after the call was entered. In the second case
the call was authorized before revocation, and `revoke` aborts it through the
session signal (best effort, D §13.7). Later requests are refused at the test.
Router refusal when `C.state !== PROCESS_RUNNING` adds a second guard. ∎
*Evidence:* ALG only. The spike had no pass-through mode.

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

**Lemma 9 (lifecycle; C6 corrected, C5-ARCH-02).** (a) The stage settles exactly once.
(b) After a termination decision no stored result is accepted. (c) After a termination
decision at `tKill`, settlement happens at the **first** of these events: launcher
`close`; spawn `error`; the first `CAE` callback at or after `tExit + CAE`, when the
launcher's `exit` at `tExit` was not followed by `close`; the first `K_SETTLE` callback
at or after `tKill + K_SETTLE`, when no `exit` was observed. (d) No lower bound beyond
`tKill` exists: settlement may be immediate. The upper bound is the first such callback
at or after `tKill + K_SETTLE + CAE`.
*Proof.* (a) BASE: every settlement path goes through the certified `settled` guard
(`stage-process.js` L102–L160). `settleUnresolved()` tests and sets it. (b) ALG:
`onTerminationDecision` sets `result = null` and `killed`; acceptance requires
`killed === null` (INV-G12). (c) ALG. Settlement handlers exist only for `close` and
`error` (immediate), the `CAE` timer (armed by FT0 at `exit`), and the `K_SETTLE` timer
(armed at `tKill`, cleared at `exit`). The first to run settles; the guard ignores the
rest. (d) If `exit` occurs at `tExit < tKill + K_SETTLE`, `K_SETTLE` is cleared and the
`CAE` fallback fires at or after `tExit + CAE < tKill + K_SETTLE + CAE`. Otherwise the
`K_SETTLE` callback settles. Nothing delays a `close` that arrives earlier. ∎
C5's statement (settlement decided "at or after `tKill + K_SETTLE` … or `tExit + CAE`")
was false for an early `close` (PT-14) and is withdrawn.
*Evidence:* BASE for FT0 parts; SPIKE P0, P11, P12 for a 10 000 ms bound on a different
(disconnect-first) ordering; production ordering **OPEN**.

**Lemma 10 (governor codes cannot be forged by the child).** A governor reason code
reaches the envelope only if the parent session issued it.
*Proof (ALG).* D §15.2: the parent strips governor codes from the child's report and
adds `session.terminal.code` only when set; a `stage-timeout` report without the
matching terminal is an invariant violation (`STAGE_FAILED`). ∎

### C6 containment lemmas — HISTORICAL / REFUTED / SUPERSEDED BY C7 §10

**C7 notice:** C6 Lemmas 11–15 depended on false H-L-04/H-L-06 or unestablished Windows lifetime assumptions. They are not normative evidence of C7 correctness. Use C7 §10 instead.

#### Historical C6 containment lemmas

**Lemma 11 (no false termination).** The containment state becomes `CONTAINMENT_EMPTY`
only through T6, that is, a valid `containment-empty` record (Windows) or rule
R-L-EMPTY (Linux). A termination request, a `worker-exit` record, a `K_SETTLE` expiry,
a `CAE` settlement, or a launcher exit without the R-L-EMPTY conditions never produce
it (INV-G19).
*Proof (ALG).* By inspection of `onStatusRecord`, `onTerminationDecision`,
`onLauncherExit` and `settleUnresolved` (§3). Only the `containment-empty` branch and
the R-L-EMPTY branch assign `CONTAINMENT_EMPTY`. Every other path assigns
`TERMINATION_REQUESTED`, `PROCESS_EXIT_OBSERVED` or `CLEANUP_UNRESOLVED`, or leaves the
state unchanged. ∎ Whether `CONTAINMENT_EMPTY` corresponds to real emptiness is A6:
H-W-05 (Windows) or H-L-04 and H-L-06 (Linux). **HOST_NOT_VERIFIED.**

**Lemma 12 (no acceptance without confirmed emptiness).** No result is accepted unless the
containment state at settlement is `CONTAINMENT_EMPTY`.
*Proof (ALG).* `classify()` implements INV-G12, which requires `CONTAINMENT_EMPTY`.
Acceptance additionally requires settlement by `close`. By A7, every status record the
launcher wrote before its exit has been processed when `close` runs. So a launcher that
reported emptiness before exiting (LC-5) is seen as empty at `close`, and one that did
not is `CLEANUP_UNRESOLVED` (T7b). ∎

**Lemma 13 (fail closed).** (a) No provider request is served before `ready` or after any
termination decision. (b) A launcher fault never leads to acceptance. (c) Every final
state other than `CONTAINMENT_EMPTY` maps to the candidate
`WORKER_TERMINATION_UNCONFIRMED` or to a refusal, and never to a successful or
"terminated" outcome (INV-G23).
*Proof (ALG).* (a) The router condition `C.state === PROCESS_RUNNING` together with
Lemmas 4 and 4b. A termination decision revokes first and leaves `PROCESS_RUNNING`.
(b) T7d takes a termination decision (`killed` set) → INV-G12 fails. (c) D §27.2.3
mapping, implemented by `classify()`. ∎

**Lemma 14 (refusal before credential use).** On an unqualified host, or after a
`setup-failed` record, no provider request is built or sent, and the credential is
passed to no transport and no child.
*Proof (ALG/H).* The host predicate (D §26.2) runs before session open and before
spawn; on failure the command settles with a refusal, and neither spawn nor
`createProvider` nor the adapter runs. After spawn, requests are refused until
`ready` (Lemma 13a). `setup-failed` is only valid in `LAUNCHING` (before `ready`), and
by LC-2 the worker never started. The credential is never placed in the worker or
launcher environment (INV-G22). ∎ LC-2 is A6 (HQ-L-01, HQ-W-01).

**Lemma 15 (termination does not depend on the worker).** Given A6, after a termination
decision every member of the containment is terminated by the OS without any action of
any member. The parent records `CONTAINMENT_EMPTY` only after the OS emptiness
condition holds.
*Proof (ALG/H).* Linux: `SIGKILL` to the sandbox init is forcibly delivered from the
ancestor namespace (H-L-10). The kernel then kills every other member (H-L-03). No
member can leave the namespace (H-L-11), and `SIGKILL` cannot be caught. If the
fallback is used, the parent-death signal kills the init (H-L-05), but confirmation is
forfeited (T7f). Windows: `TerminateJobObject` terminates every job member (H-W-04). No
member can break away (H-W-03). The fallback closes the last job handle, so
`KILL_ON_JOB_CLOSE` applies (H-W-02), again with confirmation forfeited. Emptiness is
recorded only as in Lemma 11. ∎ **HOST_NOT_VERIFIED** (HQ-L-03, HQ-L-04, HQ-W-03,
HQ-W-04).

---

## 5. Required traces

Each trace lists the evidence label. "HTTP" counts requests written by the transport.

### PT-01 Budget exhausted before admission (ALG; SPIKE G1, G2)

| Step | State |
|---|---|
| request arrives at `t = 1 000 000`; `W = 899 990`; one more ms needed for capacity | `f − t = 1` |
| `planned = max(1, 50) = 50`; fresh `a = t` (no synchronous delay); `chargeable(a, a + 50) = 50` | `899 990 + 50 = 900 040 > 900 000` |
| refuse before sleeping | `RATE_BUDGET_EXHAUSTED` (sticky); 0 sleeps, 0 commits, 0 HTTP; `W`, entries unchanged |
| variant: `W = 900 000` exactly and capacity free (`f ≤ t`) | commit allowed (`W ≤ W_BUDGET`); any later planned wait `> 0` is refused (G2) |

### PT-02 Wait ending exactly at the deadline (ALG; SPIKE E4a, E2)

| Step | State |
|---|---|
| `dispatchDeadline = 1 770 000`; request at `t = 1 769 500`; capacity free at `1 770 000` | `planned = 500` |
| pre-sleep test at the fresh reading `a = 1 769 500` (no synchronous delay): `a + planned = 1 770 000 >= 1 770 000` | `STAGE_TIMEOUT` before sleeping; `W` unchanged; 0 HTTP |
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

### PT-08 Surviving child (C5 trace; **superseded in C6** by PT-16, PT-21, PT-22)

The C5 trace showed that without containment a child whose kill was not delivered
kept running after abandonment. It made **0** Gateway sends (Lemma 4; SPIKE P12) and
**53 (Windows) / 55 (Linux)** unauthenticated direct requests (SPIKE P12, Property B
not provided). Its termination was not guaranteed. C6 keeps those observations as
the motivation for `SG01-SEC-01`. The C6 behavior for the same situations is in
PT-16 (worker ignores cancellation), PT-21 (cleanup cannot be confirmed) and PT-22
(`K_SETTLE` timeout). The C5 outcome "settle `CHILD_UNRESPONSIVE` (1) and abandon" is
**withdrawn**. In C6 an unconfirmed termination is `CLEANUP_UNRESOLVED`.

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

### PT-13 Stale pre-sleep deadline (C5-ARCH-01; ALG, Lemma 3)

`dispatchDeadline = D`.

| Step | C5 behavior | C6 behavior |
|---|---|---|
| loop reading `t = D − 75`; capacity at `t + 50`; `planned = 50` | — | — |
| pre-sleep test | `t + planned = D − 25 < D` → sleep starts | (not yet) |
| synchronous work after `t` (planning, GC) takes 100 ms | — | fresh `a = D + 25` |
| pre-sleep test at `a` | — | `a >= D` → **`STAGE_TIMEOUT` before sleeping** |
| effect | a 50 ms sleep is charged; the next loop top refuses | 0 sleeps; `W` unchanged; 0 commits; 0 HTTP |

Variant: `a = D − 30`, `planned = 50` → `a + planned = D + 20 >= D` → `STAGE_TIMEOUT`
before sleeping. Variant: `a = D − 60`, `planned = 50`, `W + 50 ≤ W_BUDGET` → sleep;
if the timer is late, the loop top and `commit()` refuse at `t2 >= D` (strict final
checks unchanged).

### PT-14 Immediate close after kill (C5-ARCH-02; ALG, Lemma 9)

| Parent time (from `tKill`) | Event | Settlement |
|---|---|---|
| 0 | termination decision: `revoke`, `killed`, `result = null`, containment termination requested, `K_SETTLE` armed | — |
| 3 | launcher `exit` (after `containment-empty` / R-L-EMPTY) | `K_SETTLE` cleared; `CAE` armed |
| 5 | launcher `close` | **settled at 5**: `CONTAINMENT_EMPTY` → `killed.reason` |

`CAE` (10 000) and `K_SETTLE` (10 000) never fired. Neither is a lower bound. C5's
INV-G18 would have placed the decision at or after 10 000 here, which was wrong.

### PT-15–PT-26 Historical C6 lifecycle traces — SUPERSEDED BY C7 §10

**C7 notice:** C6 PT-15…26 remain historical counterexamples and must not be used to establish Linux emptiness or Windows parent death. See C7-T01…13.

#### Historical C6 PT-15 Normal worker termination

| Step | Linux | Windows |
|---|---|---|
| launch | `bwrap` creates the namespaces, `{"child-pid"}` → `ready` | helper creates `J` and the AppContainer, worker suspended → in-job check → `ready` → resume |
| work | provider requests via IPC (governed or pass-through) | same |
| result | `result` → `revoke` → store → ACK | same |
| leader exit | worker exits 0 → `{"exit-code":0}` → `worker-exit 0` (`PROCESS_EXIT_OBSERVED`) | `worker-exit 0` |
| purge and emptiness | init exits with its command → namespace torn down (H-L-03) → monitor reaps the init (H-L-04, H-L-06) | `TerminateJobObject` for any remaining member → `ActiveProcesses == 0` → `containment-empty` |
| launcher exit | monitor exits 0 → R-L-EMPTY → `CONTAINMENT_EMPTY` | helper exits 0 |
| `close` | settle: INV-G12 holds → accept | same |

No parent termination request, timer or grace is involved.

### PT-16 Worker ignores cancellation (ALG/H, Lemma 15; HQ-L-03, HQ-W-03)

| Step | State |
|---|---|
| parent IPC loss or watchdog → termination decision | `revoke` first; `killed`; `TERMINATION_REQUESTED` |
| the worker ignores its disconnect handler and keeps computing | irrelevant: no step needs it |
| Linux: `SIGKILL` → sandbox init (H-L-10) → namespace killed (H-L-03) | `worker-exit` (signal) → monitor exit → R-L-EMPTY |
| Windows: `terminate` → `TerminateJobObject` (H-W-04) | `termination-delivered ok` → `ActiveProcesses == 0` → `containment-empty` |
| settlement at `close` (event-driven) | `CONTAINMENT_EMPTY` → `killed.reason` (`STAGE_FAILED` for `IPC_LOST`) |
| Gateway dispatches after the decision | 0 (Lemma 4 / 4b) |

### PT-17 Termination request fails (ALG; fallback T7f)

| Platform | Failure | Path | Final state |
|---|---|---|---|
| Linux | `kill(initPid)` → `EPERM`, or the PID-reuse guard precondition fails while the monitor is alive | fallback `kill(monitor)` → parent-death signal to the init (H-L-05) | `CLEANUP_UNRESOLVED` (confirmation forfeited) |
| Linux | `ESRCH` | the init has already exited; wait for `exit-code` and the monitor exit | `CONTAINMENT_EMPTY` via R-L-EMPTY, or `CLEANUP_UNRESOLVED` at `K_SETTLE` |
| Windows | control write fails, or `termination-delivered{ok:false}` | helper writes `cleanup-unresolved` and exits, or the parent kills the helper → `KILL_ON_JOB_CLOSE` (H-W-02) | `CLEANUP_UNRESOLVED` |

In every row: 0 Gateway dispatches after the decision; result discarded; outcome the
candidate `WORKER_TERMINATION_UNCONFIRMED`, except the `ESRCH` row with confirmed emptiness.

### PT-18 Parent dies with the worker active (ALG/H; HQ-L-05, HQ-W-05)

| Step | Linux | Windows |
|---|---|---|
| parent process ends (any cause, incl. `SIGKILL`) | the Gateway ends with it: no dispatch possible | same |
| kernel-backed path | monitor and init receive the parent-death `SIGKILL` → namespace killed | helper killed or sees EOF → last `J` handle closed → `KILL_ON_JOB_CLOSE` |
| worker cooperation needed | none | none |
| confirmation | **none possible** (no product process remains) | **none possible** |

The design claims the mechanism. It claims no confirmation. Evidence can only come
from qualification. Parent-death cleanup is **NOT VERIFIED** (D §30.1).

### PT-19 Descendants survive the leader's exit (ALG/H; HQ-L-04, HQ-W-04)

| Step | State |
|---|---|
| the worker spawns a descendant `d` (double-forked or `setsid`), then the leader exits 0 | `worker-exit 0` → `PROCESS_EXIT_OBSERVED` (**not** terminated) |
| Linux | `d` was reparented to the sandbox init (H-L-11). The init exits with its command, and the kernel kills `d` (H-L-03). The monitor reaps the init only after the namespace is empty (H-L-04) → R-L-EMPTY |
| Windows | `d` is in `J` (no breakaway, H-W-03). Purge by `TerminateJobObject` (LC-6) → `ActiveProcesses == 0` → `containment-empty` |
| if `d` cannot be confirmed gone | no emptiness → `CLEANUP_UNRESOLVED`; the stored result is **not** accepted |

### PT-20 OS containment cannot be created (ALG; Lemma 14; HQ-L-01, HQ-W-01, HQ-X-01)

| Case | Path | Result |
|---|---|---|
| host not in QHM, Node ≠ 22.x, launcher missing or version below floor | host predicate fails before spawn | proposed `HOST_ISOLATION_UNAVAILABLE`; 0 children; 0 provider requests; credential not passed |
| qualified host, but user-namespace creation (Linux) or AppContainer or job setup (Windows) fails | launcher `setup-failed` before the worker ran (LC-2) → T2 | same outcome; 0 provider requests (none served before `ready`) |
| launcher exits without `ready` and without `setup-failed` | T7e | `CLEANUP_UNRESOLVED` (a worker may have run); 0 provider requests |

### PT-21 Containment cleanup cannot be confirmed (ALG/H; HQ-L-06, HQ-W-07)

| Step | State |
|---|---|
| termination requested; a member is in an uninterruptible kernel wait (Linux) or held by pending I/O (Windows) | the OS has not finished terminating it |
| no `containment-empty` / R-L-EMPTY | the state stays `TERMINATION_REQUESTED` or `PROCESS_EXIT_OBSERVED` |
| first `K_SETTLE` callback at or after `tKill + 10 000` | T7c → `CLEANUP_UNRESOLVED`; one-shot unresolved settlement; stderr line |
| outcome | candidate `WORKER_TERMINATION_UNCONFIRMED` (exit 1, proposed); **never** "terminated" |

### PT-22 K_SETTLE timeout (ALG; Lemma 9)

| Parent time | Event |
|---|---|
| `tKill` | termination decision; `K_SETTLE` armed |
| no launcher `exit` by `tKill + 10 000` | — |
| first `K_SETTLE` callback at or after `tKill + 10 000` | `settleUnresolved()`: disconnect if connected; close the control channel (Windows: prompts another `TerminateJobObject`); destroy launcher streams; `unref`; clear timers; settle once with `CLEANUP_UNRESOLVED` |
| later `exit`, `close`, records | ignored (`settled` guard); they do not change the outcome |
| CLI ends | the kernel parent-death path runs (PT-18); unconfirmed |

`K_SETTLE` expiry is a settlement bound, not a termination proof (PD-C6-5).

### PT-23 Same-user credential boundary (ALG/H; SG-03; HQ-L-07, HQ-L-10, HQ-L-11, HQ-W-08, HQ-W-10, HQ-W-11)

| Attempt by a compromised worker | Linux | Windows | Label |
|---|---|---|---|
| read its own environment for `AI_API_KEY` | absent (`--clearenv` + allowlist) | absent (explicit block) | ALG (INV-G22) |
| read the parent's environment or memory | the parent is outside the PID namespace and not visible in `/proc` (H-L-07) | `OpenProcess(parent)` denied to the AppContainer token (H-W-08) | ALG/H |
| read a credential file of the user | not in the filesystem view (PRQ-FS-1) | no ACL grant to the SID (H-W-08) | ALG/H |
| obtain it over IPC or the status channel | no such field exists (§7.2) | same | ALG |
| inspect another same-user process holding the key | not addressable | not openable | ALG/H |

**Not verified on any host.** The spike's credential-inspection probe was **BLOCKED**
and is not to be reproduced by this author (D §30.1). SG-03 stays open.
Environment hygiene alone (row 1) is not claimed as confinement.

### PT-24 Direct provider bypass attempt (ALG/H; SEC-D2; HQ-L-08, HQ-W-09)

| Attempt by a compromised worker | Linux | Windows |
|---|---|---|
| `https.request("https://api.groq.com/…")` with a guessed or stolen key | DNS unavailable and no route (isolated loopback only) → fails | no network capability → connect blocked |
| connect to a numeric provider IP | no route → fails | blocked |
| connect to a host-loopback proxy or relay | separate loopback → unreachable | loopback blocked, no exemption |
| connect through a pathname socket or named-pipe broker | not in the filesystem view | reachable only if its ACL admits AppContainers (residual, HQ-W-09) |
| request through the IPC channel | the Gateway serves it only through admission or pass-through; no endpoint, header or credential can be chosen | same |
| C5 comparison | 55 direct requests succeeded (SPIKE P12, no containment) | 53 succeeded |

Two independent barriers (no credential, no network). Neither is host-verified.

### PT-25 Ungoverned pass-through behavior (ALG; Lemma 4b; HQ-X-02)

| Step | State |
|---|---|
| v1 config; network provider; qualified host | pass-through session opened before spawn; certified provider constructed in the parent (D-1) |
| worker `provider-request id 1` | validated; `revoked` false; `active` null → `provider.analyze()` |
| provider HTTP 429 | the certified provider throws `RATE_LIMIT` retryable → `provider-error RATE_LIMIT, retryable` → the worker rethrows → generator attempt 2 (unchanged PD-R1) |
| no admission, no wait, no deadline, no heartbeat, no watchdog | INV-G24 |
| result → ACK → exit 0 → containment empty → `close` | accepted; output identical to the baseline (INV-G13) |
| variant: parent IPC loss mid-request | `revoke` → certified provider's fetch aborted via the session signal → termination decision `IPC_LOST` → `CONTAINMENT_EMPTY` → `STAGE_FAILED` (1), as baseline "no result" (D-3) |

### PT-26 Child IPC under isolation (ALG/H; HQ-L-12, HQ-W-13)

| Step | State |
|---|---|
| parent spawns the launcher with stdio `[ignore or control, pipe, pipe, ipc, status]` | the IPC channel endpoint belongs to the launcher process |
| launcher passes the channel to the worker unchanged and closes its own copy (LC-9) | the worker's `process.send` reaches the parent; the parent's validation, receipt/ACK and `close` semantics are unchanged |
| the worker disconnects after its ACK | the parent's `disconnect` fires (no launcher copy keeps it open) |
| if the launcher kept a copy (LC-9 violated) | `disconnect` is delayed to the launcher's exit; Property A is unaffected (revocation on `result`, `exit`, `close`, termination) |
| evidence | **none**: private IPC under containment was never exercised (D §30.1) |

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
P12). In C5 the child's direct network ability was Property B, not provided (PT-08).
(C6) The surviving child is addressed by containment: worker-independent
termination (PT-16, Lemma 15) and no network path (PT-24). Both are ALG/H and
HOST_NOT_VERIFIED.

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
| `K_SETTLE = 10 000 ms` abandonment (spike); surviving child | P0, P11, P12 | bounded parent phase; B probe 53/55 | production order (no disconnect at kill); C6 containment, unresolved settlement and confirmation (none in the spike) |
| Owned-process audit by observed exit status | GWV02-1 … 7, P99 | test methodology for future suites | — |

Not covered by the spike at all: token ledger and usage accounting (PT-11), cold start,
cooldown and hints, heartbeat and watchdog, the production runner and generators, the
StageContext classification, the production lifecycle order, HTTPS, (C6) the fresh
pre-sleep reading, pass-through mode, and every containment behavior.

(C6) Host-feasibility SMOKE (D §30.1), **not** probes: a Windows Job Object setup with
`NEW_PROCESS`/`EXIT_PROCESS`/`ACTIVE_PROCESS_ZERO` messages and accounting `active=0`
(S3, S6); an AppContainer creation that needed profile registration and profile
environment variables (S2–S6); the host shell inside a job with flags `0x1800` (S1);
WSL2 inventory only for Linux. These observations support **none** of Lemmas 11–15
and none of PT-15 … PT-26.

## 9. What is and is not proven

**Proven (ALG, given §2):** Lemmas 1–10 and 4b; PT-01, PT-02, PT-03, PT-06, PT-07, PT-11,
PT-12, PT-13, PT-14, PT-22, PT-25, and the state and classification logic of PT-17; the
transport-dependent parts of PT-04 and PT-05 conditionally on A3; Corollary 6.1.

**Proven only as design logic (ALG/H; conditional on A6, A7; HOST_NOT_VERIFIED):** Lemmas
11–15; PT-15, PT-16, PT-18, PT-19, PT-20, PT-21, PT-23, PT-24, PT-26; the OS effects of the
PT-17 fallbacks. No host evidence supports
them (§8, D §30.1).

**Shown by certified code (BASE):** PT-09, PT-10; exactly-once settlement.

**Observed in the spike (SPIKE), prototype scope:** single-send loopback transport incl.
421; exclusive deadline; revocation/Property A; BUSY; closed schema; credential-free
child; 10 000 ms abandonment; Property B **absent** (53/55 direct requests).

**Open (OPEN):** production HTTPS transport (TQ-01 … TQ-10); integrated production
lifecycle order; Windows on Node 22.x; real provider behavior (PD-R9).

**C5 "Not provided", restated for C6:** Property B, credential confinement against a
compromised worker, and termination of a non-cooperative worker are now **DESIGNED
(candidate), ALG/H, HOST_NOT_VERIFIED, SECURITY_GATE_OPEN**. They are not provided on
any host until their gates pass. Still not provided: wire-emission timing; remote
rollback; confirmation of termination after parent death (PT-18).

## 10. Evidence provenance (C6; C5-EVID-01)

| Evidence | Provenance (D §2.8) |
|---|---|
| Spike per-file SHA-256 (D §2.5) and 24-file manifest `8bcd557c82c50f54006fc84537b0fd72dc0503882e5ecc96bba7b7f743ea5f2c`, reproduced with the rule `sorted relative path + space + lowercase SHA-256 + LF` | AUTHOR-LOCAL |
| Spike C2 independent verdict (82/82 on both runtimes; GWV-01/02/03 FIXED_VERIFIED; Property A VERIFIED_PASS; Property B NOT PROVIDED) | PO-SUPPLIED |
| Independent C2 report SHA-256 `5447dc2ab15de967f39ee4497ded79a0e3c29a0795f7b27d2c29082fb713f9c7` | PO-SUPPLIED (reviewer-reported); the report is not available to the author |
| R4 reruns of the C4 artifacts (P §7.2) | historical C4 evidence, reviewer-run |
| Host-feasibility report and evidence file hashes (D §30.1) | AUTHOR-LOCAL |
| Host-feasibility S1–S7 and WSL2 inventory contents | SMOKE |
| `H-L…`, `H-W…`, LC-1 … LC-10 as host facts | ASSUMPTION |

SPIKE-labelled statements rest on PO-SUPPLIED independence plus AUTHOR-LOCAL identities.
No statement in this document is IND-VERIFIED in the sense of D §2.8.


---

## 10. C7 normative proof obligations (all HOST_NOT_VERIFIED where OS-dependent)

**Lemma C7-A: no recycled PID signalling.** Termination selects the retained cgroup.kill descriptor or the held Windows Job, never numeric process IDs. Given a valid unique, sealed containment object, a recycled unrelated PID cannot receive a signal. Qualify cgroup membership and handle ownership; no host proof claimed.

**Lemma C7-B: no false emptiness.** Linux success needs retained cgroup.events populated=0 after populated=1 and closed admission. Windows success needs sealed worker Job membership and queried ActiveProcesses=0. Monitor/leader exits, completion-port notifications, K_SETTLE and CAE are never emptiness. A remaining descendant prevents success under these documented witness semantics, conditional on verified membership/non-escape.

**Lemma C7-C: parent death.** Linux requires armed parent-death signalling before worker release, including child-init teardown; Windows requires native creation-time helper Job enrollment and exclusive parent J_life last handle. Parent callbacks are not part of these obligations. All atomic-start and zero-survivor claims are future HQ gates, not executed tests.

**Lemma C7-D: event ordering.** Worker cannot issue IPC until the parent has processed trusted ready and sent RELEASE. Exit callback is not final; only trusted status drained to EOF before close/CAE settlement can support classification. Thus ready/status cross-stream callback races cannot reject otherwise valid normal work or falsely accept it.

**Lemma C7-E: post-result SEC-C1 (C7-C1 corrected).** The first result synchronously causes `session.revoke("result")` **before** storing the receipt and sending ACK. This blocks all further provider requests, but the separate closed FT0 delivery-control path still accepts exactly one valid post-ACK `disconnect-intent(receipt)` while `session.revoked===true` **solely because of the result** and `delivery===ACK_PENDING`. A matching parent `disconnect-permit` advances that control path to `PERMIT_SENT`; only this still-valid transaction can exempt the subsequent voluntary disconnect from IPC_LOST. Any different revocation cause, termination decision, IPC loss or launcher fault invalidates the control state, denying any permit; storing a result, attempting an ACK or seeing a child exit is insufficient. All unexpected IPC loss synchronously aborts/revokes, discards the result and requests containment kill. Normal disconnect with non-exit triggers the 10000 ms security-only guard. Success still requires exit 0, true OS emptiness and close. Thus control-plane delivery permission never reverses provider revocation and preserves governed/disabled-governor SEC-C1, conditional on OS enforcement.

**Lemma C7-F: transport D-5.** Built-in Worker thread explicit env/execArgv and thread-local CA configuration furnish a concrete baseline-equivalence *candidate*, not a proof that Undici ignores every parent process startup setting. The finite TLS/proxy golden qualification is mandatory. Failure excludes the host; relaxing certificate validation is never allowed.

### 10.1 C7 mandatory traces and qualification

D §32.5 C7-T01…13 are normative verification scenarios; C6 PT-15…26 and Lemmas 11…15 are historical where contradicted. Required host gates: HQ-L-C7-01…05, HQ-W-C7-01…04, HQ-X-C7-01 readiness, HQ-X-C7-02 status-drain, HQ-X-C7-03 unexpected loss, valid ACK intent after result-only revocation, and refusal after non-result revocation (C7-T08/C7-T09A), HQ-X-C7-04 guard at 10000, HQ-X-C7-05 unsupported-host refusal, and PRQ-D5-1…3. All are NOT RUN. At least 100 per-host-class repetitions and an external zero-survivor audit are required for termination cases. Witness mismatch ⇒ CLEANUP_UNRESOLVED and never accepted success. Keep SG-01…05, legacy HQ/TQ suites and FT0 tests pending independent review and qualification.

C5 timer regression PT-13 (stale pre-sleep refusal) and PT-14 (kill 0, exit 3, close 5 ⇒ settle at 5) remain normative and unchanged. No new public error or exit code is established by this proof.
