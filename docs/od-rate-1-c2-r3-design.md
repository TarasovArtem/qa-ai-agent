# OD-RATE-1-C2-R3 — Provider Gateway Design (Parent Gateway Replacement, C5)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-design.md` (1 of 3; companions: [proofs](od-rate-1-c2-r3-proofs.md), [review matrix](od-rate-1-c2-r3-review-matrix.md)) |
| Revision | **C5: Parent Gateway design replacement.** It replaces the child-owned C4 governor at PR #262 head `38121f95938b28e065283707d01a70b05893e94c` (tree `cf2b202dbbde6c5fa693ceeb41e2df3662fd6c4c`). C4 was REJECTED by the independent R4 review (§2.6). Superseded C4 material: §22. Change log: §23. |
| Status | **DESIGN — PENDING INDEPENDENT EXACT-HEAD ARCHITECTURE REVIEW AND SECURITY REVIEW.** Not approved. It authorizes no implementation, test, contract amendment, ROADMAP entry, real-provider call, merge or release. |
| Authority | Product Owner: **OD-RATE-1 Unified Architecture Decision Package v2, AD-01 … AD-09, APPROVED 2026-10-27** (§2.2) |
| Issue | #258 (OPEN; not modified; its body predates the later PO decisions, §2.3) |
| Baseline | `main` HEAD `a32a6cd7e0a1bdc9917fc3abc7f692039591a145`, TREE `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Author | Claude Code, the same account that authored OD-RATE-1, C1 … C4 and the Gateway spike. **This author cannot approve this design.** |

Normative keywords: **MUST**, **MUST NOT**, **SHOULD**, **MAY** as in RFC 2119.
Durations are milliseconds on a monotonic clock (§6.2). "Contract" means
`docs/controlled-v1-productization-contract-v1.md`. **D** = this document,
**P** = proofs, **M** = review matrix.

---

## 1. Purpose, scope and decision record

This document specifies one production target: an opt-in, **parent-owned
Provider Gateway** for the provider-backed generative stages (`design`, `plan`,
`generate`) of the `qa-agent` CLI. When the governor is enabled, the parent
process alone owns the provider credentials, the provider transport, admission,
rate accounting, the wait budget, the dispatch deadline and revocation. The stage
child keeps the generative work and asks the parent for each provider exchange
over a validated private IPC protocol.

Decision record:

- The child-owned governor of C3/C4 (a governed `fetchImpl` gate inside the
  child, FIFO queue, union wait accounting) is **withdrawn**. It is kept only as
  history (§22).
- The PO approved the Parent Gateway direction (AD-01 … AD-09, §2.2). This
  document turns it into one implementable design. It does **not** copy the
  spike into production. The spike is feasibility evidence (§2.5); every spike
  behavior used here is restated as a production requirement, and the spike-only
  behaviors that production must not have are listed in §15.4 and §22.

In scope: architecture, private IPC, admission, wait and deadline semantics,
transport contract and HTTPS qualification, accounting, revocation, Property A/B
and SEC-C1 analysis, FT0 lifecycle compatibility, failure propagation, public
compatibility.

Out of scope (unchanged and not designed here): triage (`stage-runner.js`, PD-R7);
the attempt budget (PD-R1); provider request payload caps (PD-R4); real-provider
validation (PD-R9); persistent or cross-process rate state (rejected in C1);
OS-level network isolation of the child (Property B, §13.4); release, ROADMAP,
governance, package exports, `README.md`, `SECURITY.md`, `PROVIDERS` docs.

## 2. Authority, evidence and baseline

### 2.1 Evidence classes

Every claim in D, P and M carries one of these classes. They are never merged.

| Class | Meaning | Example |
|---|---|---|
| **PO-CONV** | Approved by the Product Owner in conversation; not (yet) published on GitHub | AD-01 … AD-09; PD-R11 A, PD-R12 A, PD-R12-I1, PD-R15 |
| **PO-GH** | Disposition published on GitHub (Issue #258 body, 2026-10-19) | PD-R2, PD-R3, PD-R5, PD-R6, PD-R8, PD-R10, PD-R13, PD-R14, SEC-C1 |
| **HIST-C4** | Rejected child-owned C4 design and its numbers | §22; P §7.2 |
| **SPIKE** | Behavior of the isolated Gateway spike, independently verified (§2.5) | P §8 |
| **OPEN** | Production behavior not yet verified by anyone | HTTPS transport (§10.2), integrated lifecycle (§14), Windows on Node 22.x |

Issue #258 still lists PD-R11 and PD-R12 as open. Its body predates the later PO
decisions and is unsynchronized. It is **not** evidence that those decisions are
absent. The R4 reviewer noted the same (§2.6).

### 2.2 Approved architecture decisions (PO-CONV, 2026-10-27)

| ID | Decision | Where C5 implements it |
|---|---|---|
| AD-01 | Parent exclusively owns governed provider transport, credentials, admission, accounting and revocation. Child uses validated private IPC. | §3, §7, §8, §10, §13.1 |
| AD-02 | Preserve SEC-C1. Property A is verified; Property B is not provided. Mandatory Security reconciliation, no waiver. | §13; gates SG-01 … SG-04 (§21.2) |
| AD-03 | 900 000 ms cumulative governor waiting; preserve the approved 65 000 ms cold start. | §9.1, §8.6 |
| AD-04 | `now >= deadlineAt` means REFUSE. Timer overshoot may increase charged waiting but must never permit further dispatch. | §9.2, §9.3, §8.4 |
| AD-05 | Count actual waiting elapsed before cancellation. | §9.3 |
| AD-06 | One active Gateway request; a concurrent request receives a private BUSY refusal, not FIFO queueing. | §8.5 |
| AD-07 | Preserve FT0 receipt/ACK and close-based settlement. No arbitrary 300 ms successful-exit grace. `K_SETTLE = 10 000 ms` for the governed post-kill phase. | §14 |
| AD-08 | Preserve public error vocabulary, CLI semantics, IPC compatibility and configuration compatibility. | §4, §5, §15.4, §16 |
| AD-09 | One replacement design, then independent exact-head Architecture and Security reviews. No implementation or real-provider testing authorization. | this PR; M §15 |

### 2.3 Earlier PO dispositions used

| Decision | Class | Status | Use in C5 |
|---|---|---|---|
| PD-R2 | PO-GH | APPROVED DIRECTION | Config schema v2 with opt-in `providerGovernor`; v1 unchanged (§5). |
| PD-R3 | PO-GH | APPROVED FOR DESIGN REVIEW | 30 s request timeout, 65 s per wait, 900 s accumulated wait, 1 800 s stage deadline, 45 s watchdog, 10 s heartbeat (§6.1). |
| PD-R5 | PO-GH | APPROVED | 65 s cold start per governed stage; counts toward wait and stage budgets (§9.1). |
| PD-R6 | PO-GH | APPROVED | No exit 130; native user-signal termination; user cancellation never exit 6. |
| PD-R8 | PO-GH | APPROVED DIRECTION | Closed reason-code extension (§16). |
| PD-R10 | PO-GH | APPROVED | Heuristic, best-effort token admission; exceeding local budgets fails closed (§11.2). |
| PD-R13 | PO-GH | APPROVED | Deadline and watchdog only when governed. |
| SEC-C1 | PO-GH | APPROVED; FT0 implementation certified on `main` | "Parent IPC disconnection must abort pending waits and in-flight provider requests. No subsequent provider calls may be initiated. The child must terminate." (§13.6) |
| PD-R14 | PO-GH | APPROVED | SEC-C1 unconditional, also when the governor is disabled. |
| PD-R11 | PO-CONV | APPROVED: A | `charged = max(reserved, observed)` for valid usage; valid usage survives content failure (§11.4). |
| PD-R12 | PO-CONV | APPROVED: A | Missing usage saturates (§11.4). |
| PD-R12-I1 | PO-CONV | APPROVED | Malformed usage saturates **and** sets `RATE_ACCOUNTING_INVALID`; unavailable usage or uncertain completion saturates; never zero (§11.4). |
| D+15 | PO-CONV | APPROVED: A | Separate measurable lifecycle phases; no whole-CLI 1 815 s claim (§17). |
| PD-R15 | PO-CONV | APPROVED, value `K_SETTLE = 10 000 ms` (reaffirmed by AD-07) | Bounded post-kill settlement (§14.5). |
| PD-R1, PD-R4, PD-R7, PD-R9 | PO-GH | OPEN | Status-quo assumptions (§21.1). |

### 2.4 Certified code baseline (`main` `a32a6cd7`)

| File | Blob | Facts used |
|---|---|---|
| `scripts/ai/cli/stage-process.js` | `4c9a8ab4` | Generic child launcher (`spawn(process.execPath, [runner, stage])`, `shell:false`, `stdio: [ignore, pipe, pipe, ipc]`). The first `result` message is stored, then ACKed with the child's receipt `^[0-9a-f]{32}$` (L118–132); all other message types are ignored. `close` settles (L139). After `exit`, a ref'd `CLOSE_AFTER_EXIT_MS = 10000` timer settles with `result = null` if `close` never arrives (L143–160). Late events after settlement are ignored (`settled` guard). No timeout, watchdog or kill. |
| `scripts/ai/cli/generative-runner.js` | `5adac686` | `guardParentLink()` (L130): parent `disconnect` → abort → `process.exit(1)` in the same turn. `report()` moves `running → sending → awaiting_ack → delivered \| failed`; `RESULT_ACK_DEADLINE_MS = 10000`. `bindCancelSignal(parentLink.signal)` before any provider exists (L238). The child creates its provider with `createProvider(PROVIDER)` (L215); a constructor error is reported as `provider-configuration`. |
| `scripts/ai/cli/child-env.js` | — | `buildGenerativeEnv()` (L116) copies `AI_SECRET_KEYS = ["AI_API_KEY", "AI_MODEL"]` (L37) into the child's closed environment. **Today the generative child holds the credential.** |
| `scripts/ai/cli/generative.js` | `418b5597` | The parent reads `AI_API_KEY` for redaction (L71). It accepts only `result.ok === true && exitCode === 0` (L83). `classifyChildFailure()` (L50): `generation` → `PROVIDER_FAILURE` (6), or exit 4 when `providerAttempts` is 0 or not an integer; `provider-configuration` → `PROVIDER_CONFIGURATION_INVALID`; missing failure → `STAGE_FAILED` (1). |
| `scripts/ai/providers/index.js` | `74c64cd3` | Process-scoped `bindCancelSignal()`; `createProvider()` passes `{cancelSignal}` to Groq and Gemini. |
| `scripts/ai/providers/groq-provider.js` | `3d97fd86` | `fetch(GROQ_API_URL, {POST, Authorization: Bearer, JSON body, signal})` with no `redirect` member; 30 s timer covers fetch and body read. Rejection: `AbortError` → `TIMEOUT` ✓, else `NETWORK` ✓. `mapHttpError`: 401/403 `AUTH` ✗, 429 `RATE_LIMIT` ✓, 408 `TIMEOUT` ✓, 5xx `UNKNOWN` ✓, every other status (incl. 3xx and 421) `UNKNOWN` ✗. Bounded body read (32 MiB), **then** the content check → `INVALID_RESPONSE` ✗. Cancellation → `UNKNOWN` ✗, no cause. |
| `scripts/ai/providers/gemini-provider.js` | `6559416d` | Same structure; credential in header `x-goog-api-key`; model in the URL path. `mapHttpError`: 401/403 `AUTH` ✗, 429 ✓, 5xx ✓, every other status **incl. 408**, 3xx and 421 `UNKNOWN` ✗. |
| `scripts/ai/cli/run-artifacts.js` | `56946794` | `KNOWN_CODES` closed allowlist; unknown codes → `UNKNOWN`. |
| `scripts/ai/cli/config-file.js` | `65ed658f` | Config schema v1 is exactly `schemaVersion: 1`. |
| Generators | — | At most 2 attempts; `providerAttempts` set before `provider.analyze()`. `automation-plan-generator.js` L677 and `generate-change-set.js` L270 replace every provider error with `INVALID_VALUE`. Calls are strictly sequential. |
| `package.json` | — | `engines.node` = `22.x`. |

(✓ retryable, ✗ not retryable.) CLI contract facts: exit taxonomy contract §10.7
(6 = provider failure incl. provider bounded-time exceeded; 1 = internal or
invariant violation); `--json` envelope contract §10.8; config v1 contract §11.2.

### 2.5 Spike evidence identity

| Item | Value |
|---|---|
| Location | `C:\Users\artem\Desktop\OD-RATE-1-Gateway-Spike` (outside every repository) |
| `src/gateway.js` SHA-256 | `f5bc4af4dca14005fa0cd592306aea95d6dd1a84f6e93bf07798a0e01c741ff4` — **matches** the PO-stated C2 identity |
| `test/gateway.test.js` SHA-256 | `7059ad212e063addf39ba8a47b67e93e9def252b95e17f11a519b6b941744bb3` — **matches** |
| Other sources (SHA-256) | `src/parent.js` `cfdc9ce9e181b58a7a0734af17c5e5b2f403c81156502947c8f0a818b6e58dc2`; `src/transport.js` `dabd7978557f094bd7ff0ed7ee6fa67f55a07a43e1e72e51bd2c2e70f2571af6`; `src/worker.js` `d9c9832db61a237b73babb3775a6ce46a23f559a4d25174e56c101236ea05c0c`; `src/schema.js` `b17ff59d79a62c9a9f05c98e4b3f92f2fd67c6c1b1bc7fe8e7a435fa582c3b09`; `src/clock.js` `80301a914e234fddd7d405bf46b785ecc3adbfedc6f9383997c3345a48de8e78`; `test/parent.test.js` `c3bf9e533d8a1490d3e03b7f9c50d72b996b8168d95be5636a212c372f4f5262`; `test/transport.test.js` `6e8b1ca6287c1d0da2ac9c3ec1cd65fa52712694f17bdd138b1895a9bcf26554`; `test/schema.test.js` `18320899ddc9d0d6fa9005a57f868a86a24d1867a4c1c9f4d0d230b614bbac79`; `test/helpers/fakeServer.js` `53745906e46d7be51c50fc8828597b0485747eba01f4fc7c7d8c30897c786d6e` |
| Evidence outputs | `evidence/test-output.txt` `5881cc8881e477ef763e1d3314e5d5b16052ee9d26763158d0a2a5d616b018e6` (Windows 11, Node v24.22.1, 82/82); `evidence/test-output-linux.txt` `61fa4057f0eb5542316748735b38f5b914472f67497f474a85bb27e6dcab12ed` (WSL2 Linux, Node v22.23.3, 82/82). Both equal the hashes recorded in the spike's C2 record. |
| Source manifest | PO-stated `8bcd557c82c50f54006fc84537b0fd72dc0503882e5ecc96bba7b7f743ea5f2c`. **Not reproduced:** the manifest's construction rule is not recorded locally, and the common `sha256sum`-style constructions over `src/`, `test/` and `package.json` did not yield it. Per-file identities above were verified directly. |
| Independent verdict | **As stated by the PO mission:** C2 VERIFIED_PASS; Windows Node 24 82/82; Linux Node 22 82/82; GWV-01/02/03 FIXED_VERIFIED; F1–F5 PASS in spike scope; Property A VERIFIED_PASS; Property B NOT PROVIDED; real HTTPS/TLS not verified; 0 real provider calls. **Gap:** the independent verifier's report is not present on this machine (the only local verifier transcript dated 2026-10-27 is an aborted session without a verdict). The author relies on the PO-stated verdict plus the matching source identities. |
| Spike scope limits | Loopback `node:http` only, no TLS; fake credential; scenario-driven worker, not the production runner; parent lifecycle disconnects first and uses a 300 ms graceful-exit window (not carried, §15.4); Windows ran Node 24 (outside `engines` 22.x); Windows ignored-kill is simulated with a no-op kill hook. |

### 2.6 Independent review history

Codex reviewer session `01a17740-3dc0-7ee2-b26e-a538092270cd` holds R2 (of C2),
R3 (of C3 `eff78a0c`) and R4 (of C4 `38121f95`). Transcript SHA-256 at C5
authoring time: `b70f2e614f380d0176a87b5ee18abb30c99709e68418116ba0eb54a38dbb3a6f`
(it grew with each review; the C4-time hash `00c03958…` covered R2 and R3 only).

R4 verdict: **REJECTED.** Findings and their R4 status:

| Finding | Severity | R4 status | C5 treatment |
|---|---|---|---|
| R2-ARCH-01 | MAJOR | RESOLVED_BY_DESIGN (admission); physical sends via R4-ARCH-02 | §8.6, §10 |
| R2-ARCH-02 | MAJOR | RESOLVED_BY_DESIGN | §15 (C4 machinery retained; parent-authoritative terminal) |
| R2-ARCH-03 | MAJOR | RESOLVED_BY_DESIGN (conditional admission mathematics) | §9.2, §17 |
| R2-ARCH-04 | MAJOR | **REGRESSED** (union wait grows after the last check) | §9.1 (R4-ARCH-01) |
| R2-ARCH-05 | MINOR | RESOLVED_BY_DESIGN | §12 |
| DRIFT-01 | corrective | RESOLVED_BY_DESIGN for observed cancellation; abandonment guarantee refuted (R4-ARCH-03) | §13 |
| DRIFT-02 | corrective | RESOLVED_BY_DESIGN for receipt/ACK/close | §14.1 |
| R3-ARCH-01 | MAJOR | RESOLVED_BY_DESIGN | §11 |
| R3-ARCH-02 | MAJOR | RESOLVED_BY_DESIGN (gate-reading boundary) | §8.4 |
| R3-ARCH-03 | MAJOR | **STILL_OPEN** (T1 refuted by HTTP 421) | §10 |
| R3-ARCH-04 | MINOR | **STILL_OPEN** (admission budget and FIFO serialization) | §8.5, §9.1 |
| R3-ARCH-05 | MINOR | RESOLVED_BY_DESIGN (conditional bounds) | P §7 |
| **R4-ARCH-01** | MAJOR | NEW: wait budget exceeded before admission (computation inside `analyze()` grew union wait after the last check) | §9.1; P Lemma 2, P §6.1 |
| **R4-ARCH-02** | MAJOR | NEW: `redirect: "manual"` does not give one HTTP request per `fetch` — HTTP 421 caused **2 POSTs** on Node 22.23.3/undici 6.28.1 and Node 24.22.1/undici 7.30.1 | §10; P Lemma 5, P §6.2 |
| **R4-ARCH-03** | MAJOR | NEW: abandonment does not guarantee no new provider requests (a live child continued with `transportAllowed=true` after parent `disconnect()`) | §13; P Lemma 4, P §6.3 |
| **R4-ARCH-04** | MINOR | NEW: FIFO released at admission contradicts the single slot | §8.5; P §6.4 |

R4 also recorded: `K_SETTLE = 10 000 ms` accepted as PO-approved; widening the
wait budget to synchronous computation would need a separate PO decision;
weakening the surviving-child guarantee would need a separate PO disposition.
C5 needs neither: §9.1 restores the sum-of-governor-waits meaning, and §13 does
not weaken the guarantee but restates it as Property A with Property B handed to
the mandatory Security gate (AD-02).

### 2.7 Preserved historical evidence

C2 identities (unchanged, not re-sealed): C2 design SHA-256
`1c0851be7a40a9406c7d75daa7d9676534b4e61f7ff542a93be53f3e2f74c054`; manifests
`eeb5a063b09803513eeb6ef77893802a37bf39e55d6abc8d5a955257d9ecbff9`,
`006dae0d317d0ad35c9e0c0591d520f1d63e7f1b5cdbf443f9947ece57d9cdfc`,
`1139919745bf35507bdbe732af3e8e5fb55313e3d9d9ee0b3f42aad2f5470fcc`; Issue #258
raw body `e5b84e8118631885d8034f9d6eab1bc730d5ccda3598597ba5d6c935e95c86cc`. The
full C3 and C4 texts remain in git history at `eff78a0c` and `38121f95`. C2
clauses are still cited as `C2:<line>`.

---

## 3. Architecture

### 3.1 Components and ownership

```text
CLI parent process (qa-agent; generative.js + stage-process.js)
 |
 +-- Provider Gateway session (one per governed stage child; parent memory only)
 |     +-- Admission / rate accounting   RPM + TPM ledgers, reservation, usage charge
 |     +-- Deadline / wait budget        single monotonic origin tOpen; exclusive deadline
 |     +-- Revocation                    synchronous, idempotent, parent-only
 |     +-- Provider adapter              Groq / Gemini request build, response parse, error mapping
 |     +-- Controlled HTTPS transport    single-send core https; no redirects, retries or reuse
 |     +-- Provider credentials          AI_API_KEY, AI_MODEL read from the parent environment
 |
 +-- Lifecycle supervisor (stage-process.js, governed path)
 |     +-- FT0 result store + receipt ACK, close-based settlement, CLOSE_AFTER_EXIT
 |     +-- heartbeat watchdog, stage enforcement, kill, K_SETTLE abandonment
 |
 |   private IPC (validated, closed schema; no credentials, URLs or headers)
 v
Stage child (generative-runner.js, governed path)
       +-- generators (unchanged)
       +-- Gateway client provider       implements the provider contract via IPC
       +-- StageContext                  step, per-step call count, sticky refusal (C4 §11 machinery)
       +-- FT0 guardParentLink           cancellation on parent loss, result receipt/ACK (unchanged)
       +-- heartbeat sender
```

| Responsibility | Owner | Notes |
|---|---|---|
| Provider credential and model | parent Gateway | Never in child env or IPC (§3.3, §7.2) |
| Transport and its 30 s timer | parent Gateway | §10 |
| Admission, RPM/TPM ledgers, cold start, cooldown, hints | parent Gateway | §8 |
| Wait budget and dispatch deadline | parent Gateway | §9 |
| Usage observation and charging | parent Gateway | §11 |
| Revocation | parent (session + supervisor) | §13 |
| Provider error mapping | parent Gateway (same mapping code as today) | §12 |
| Retry policy (two attempts) | child generators (unchanged) | §12 |
| Step, attempt counting, return/unwind classification | child runner | §15.1 |
| Authoritative governor refusal record | parent Gateway | §15.2 |
| Result transfer and receipt | child (`report()`), parent stores + ACKs | §14.1 |
| Kill, watchdog, enforcement, K_SETTLE | parent supervisor | §14 |

### 3.2 Governed and ungoverned modes

| Config | Gateway session | Child provider | Child env credentials | Heartbeat / watchdog / deadline / K_SETTLE | SEC-C1 |
|---|---|---|---|---|---|
| v1 | none | `createProvider()` + global `fetch` (certified) | present (certified) | none (PD-R13) | certified FT0 (PD-R14) |
| v2, `providerGovernor` absent or `enabled: false` | none | same as v1 | present | none | certified FT0 |
| v2, `enabled: true` | one per governed stage child | Gateway client (IPC) | **absent** | present | certified FT0 in the child **plus** parent revocation |

**INV-G13 (ungoverned identity):** the first two rows MUST be indistinguishable
from the certified baseline: spawn, environment, provider construction, IPC,
exit codes and output. No Gateway module is loaded on those paths.

### 3.3 What the governed child can and cannot do

- It holds no provider credential and no model name: the governed environment is
  `buildGenerativeEnv()` **without** `AI_SECRET_KEYS` (§20).
- It never loads the Gateway, the adapter or the transport. Its only provider
  path is the IPC request in §7.
- It cannot name a URL, host, header, method or credential: the IPC schema has
  no such fields (§7.2).
- It **can** still open arbitrary network connections with Node's own modules, as
  any process of the same OS user can. Parent ownership does not prevent this
  (Property B, §13.4).

## 4. Contract boundaries

| Surface | Class | C5 effect |
|---|---|---|
| Package `exports`, `bin`, library API | public | **None.** New modules are internal only. |
| CLI exit codes (contract §10.7) | public | **None new.** Governed outcomes use existing codes 3, 6 and 1. |
| CLI reason codes | public | The PD-R8 closed extension of §16. **No code beyond the set already designed in C4.** Unreachable with v1 or a disabled governor. |
| Config schema | public | v2 adds optional `providerGovernor` (§5). v1 unchanged. |
| stdout | public | Unchanged. |
| stderr | bounded diagnostics | One governed-only fixed-template line on post-kill abandonment (§14.5), as designed in C4 under PD-R15. |
| Persistent data, run manifest, run store, review packages | — | **Unchanged. No new persistent format.** Gateway state lives in parent memory and ends with the session. |
| Child environment | private | Governed path only: credentials removed (§3.3). Ungoverned: unchanged. |
| Parent ↔ child IPC | private | Governed path only: payload marker, `provider-request`, `provider-response`, `heartbeat`, `failure.kind: "stage-timeout"`, optional `failure.governorCode` (§7, §15). FT0 `result` / `result-ack` unchanged. |
| Provider adapters | internal | Mapping functions shared with the ungoverned providers so classification is identical (§12). Ungoverned providers unchanged. |
| Generators | internal | **No change.** |

## 5. Configuration and compatibility

`schemaVersion: 2` is v1 plus one optional top-level key (unchanged from C4):

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

The values are illustrative; no provider plan limit is asserted.

| Key | Rule |
|---|---|
| `providerGovernor` | optional object; closed keys `{enabled, limits}` |
| `enabled` | required boolean |
| `limits` | required when `enabled` is `true`; closed key set ⊆ `{"groq", "gemini"}` |
| `tokensPerMinute` | integer, 2 ≤ v ≤ 10 000 000 |
| `requestsPerMinute` | integer, 1 ≤ v ≤ 100 000 |
| `completionReserveTokens` | integer, 0 ≤ v ≤ 1 000 000 |
| `reasoningReserveTokens` | optional integer, 0 ≤ v ≤ 1 000 000, default 0 |

Timing values are product constants and MUST NOT be configurable. Validation
failures are exit 3 before any provider exists. When `enabled` is `true` and the
effective generative provider has no `limits` entry, the command fails with exit
3, `PROVIDER_GOVERNOR_LIMITS_MISSING`, before spawning the child (zero sends).

Governed provider configuration: the parent builds the adapter before spawn. A
missing `AI_API_KEY` or `AI_MODEL` raises the same `CONFIGURATION` provider error
the child raises today and maps to the same `PROVIDER_CONFIGURATION_INVALID`
outcome (§15.3 row 2), only earlier and without a spawn.

---

## 6. Constants and clock

### 6.1 Constants

| Symbol | Value (ms unless noted) | Source |
|---|---:|---|
| `T_REQ` | 30 000 | PD-R3; existing provider timer |
| `C_COLD` | 65 000 | PD-R5, AD-03 |
| `W_HOLD` | 65 000 | provider minute (60 000) + guard (5 000) |
| `W_MAX` | 65 000 | PD-R3 per-wait cap |
| `W_BUDGET` | 900 000 | PD-R3, AD-03 |
| `D_STAGE` | 1 800 000 | PD-R3 |
| `D_DISPATCH` | 1 770 000 = `D_STAGE − T_REQ` | last dispatch instant (exclusive), from `tOpen` |
| `S_MIN` | 50 | minimum planned sleep |
| `I_MAX` | 64 | wait-loop iterations per request |
| `HB` | 10 000 | PD-R3 heartbeat |
| `WD` | 45 000 | PD-R3 watchdog |
| `K_PARENT` | 1 815 000 | parent enforcement point from `tOpen` (D+15 A) |
| `K_SETTLE` | **10 000, APPROVED** | PD-R15 / AD-07 |
| `ACK` | 10 000 | FT0 `RESULT_ACK_DEADLINE_MS` (unchanged) |
| `CAE` | 10 000 | FT0 `CLOSE_AFTER_EXIT_MS` (unchanged) |
| `MAX_RESPONSE_BYTES` | 32 MiB | existing provider envelope bound (unchanged) |
| `h` | 0.85 | token headroom |
| `κ` | 3.0 bytes/token | heuristic estimator (PD-R10) |
| `O` | 32 tokens | template overhead |
| `U_MAX` | 10 000 000 tokens | maximum accepted usage value |

Derived per session: `B_tok = floor(tokensPerMinute × h)`; `B_req = requestsPerMinute`.

No other numeric constant exists. In particular there is **no** graceful-exit
window and no acceptance grace (§14.6).

### 6.2 Clock semantics

- **One clock, one authority.** Every Gateway and supervisor decision reads the
  parent's `process.hrtime.bigint()` (monotonic nanoseconds). The child's clock is
  never used for a governed decision.
- **One origin.** `tOpen` is read immediately before `spawn()`. Then
  `coldUntil = tOpen + C_COLD`, `dispatchDeadline = tOpen + D_DISPATCH` and
  `enforceAt = tOpen + K_PARENT`. All are absolute instants on the same clock.
- **Exact arithmetic.** All comparisons and sums are done in integer nanoseconds
  (constants × 10⁶). No rounding is applied before a comparison.
- **Fresh readings.** Every time-dependent decision takes a new reading. A
  reading is never reused across an `await`, and the final dispatch reading is
  the last operation before the transport call (§8.4).
- **Exclusive deadlines.** For every absolute deadline `X` used to refuse an
  action, `now >= X` refuses (AD-04).
- **Timers are prompts, not proofs.** A timer fires "at or after" its instant,
  with unbounded lateness `ε ≥ 0`. A decision that matters is re-checked against
  a fresh reading when it is taken.
- **Regression guard.** If a reading is smaller than an earlier one, the session
  refuses with sticky `RATE_ACCOUNTING_INVALID`. (`hrtime` is monotonic; the
  guard is defensive.)
- **Suspend.** No claim is made across system suspend (§19).

---

## 7. Private IPC protocol

### 7.1 Messages (governed path only)

| Direction | Message | Closed shape |
|---|---|---|
| parent → child | payload (existing) + marker | `{type:"payload", stage, payload, gateway:{v:1}}`. The `gateway` member is present only when governed. |
| child → parent | provider request | `{type:"provider-request", v:1, id, systemPrompt, userPrompt}` |
| parent → child | provider response | `{type:"provider-response", v:1, id, outcome:"content", content}` · `{…, outcome:"provider-error", code, retryable}` · `{…, outcome:"refused", code}` |
| child → parent | heartbeat | `{type:"heartbeat", v:1, seq}` |
| child → parent | result (FT0, existing) | `{type:"result", …, receipt}` |
| parent → child | result ACK (FT0, existing) | `{type:"result-ack", receipt}` |

Field domains:

| Field | Domain |
|---|---|
| `id` | integer, `1 ≤ id ≤ 2³¹ − 1` |
| `systemPrompt`, `userPrompt` | strings. No new size cap is introduced here (PD-R4 is open). |
| `content` | non-empty string, from a response body already bounded by `MAX_RESPONSE_BYTES` |
| `code` (provider-error) | one of `AUTH`, `RATE_LIMIT`, `TIMEOUT`, `NETWORK`, `INVALID_RESPONSE`, `UNKNOWN` |
| `retryable` | boolean, exactly as the existing provider mapping would set it (§12) |
| `code` (refused) | governor codes `RATE_REQUEST_EXCEEDS_BUDGET`, `RATE_BUDGET_EXHAUSTED`, `RATE_ACCOUNTING_INVALID`, `STAGE_TIMEOUT`; private codes `BUSY`, `REVOKED`, `INVALID_REQUEST` |
| `seq` | integer, strictly increasing, `1 ≤ seq ≤ 2³¹ − 1` |

### 7.2 Validation

Both sides treat every received message as untrusted input.

- Parent, for every child message: the value MUST be a non-array object; `type`
  MUST be one of the child-to-parent types; the own key set MUST equal the closed
  key set of that type exactly (no missing, no extra); every field MUST be in its
  domain. On success the parent copies the fields into a fresh plain object and
  uses only that copy (spike S1–S7).
- A `provider-request` that fails validation but carries a valid `id` gets
  `refused INVALID_REQUEST`. Anything else is dropped. Neither path dispatches.
- Parent → child messages never contain a credential, model name, URL, header,
  raw provider message, raw usage or raw body. The only provider text that crosses
  IPC is `content`, which the child already receives today from its own provider.
- Child, for every parent message: the same closed-shape rule. A `provider-response`
  whose `id` is not the child's single pending request is ignored.
- The governed child's environment and argv carry no credential (spike P13).

### 7.3 Request IDs and correlation

- The child numbers its requests `1, 2, 3, …` per process. The certified generators
  have at most one request outstanding.
- The parent keeps `lastId`. A request with `id ≤ lastId` (replay or duplicate) is
  refused `INVALID_REQUEST` and makes no admission. Otherwise `lastId = id`.
- Each `provider-response` echoes the request's `id`. Responses MAY arrive in any
  order relative to other responses (a `BUSY` refusal can overtake an in-flight
  reply; spike P4). The child matches only by `id`.

### 7.4 Child Gateway client provider

The governed child passes a `GatewayClientProvider` to the unchanged generators.
It implements the existing provider contract (`name`, `analyze({systemPrompt,
userPrompt})`) and passes `validateProvider()`.

```text
analyze({systemPrompt, userPrompt}):
  if cancelSignal.aborted: throw cancelledError()          // certified SEC-C1 error: UNKNOWN, not retryable, no cause
  ctx.calls += 1                                           // §15.1
  id = ++nextId
  send {type:"provider-request", v:1, id, systemPrompt, userPrompt}   // send error -> FT0 fail() exits
  r = await response(id) or cancelSignal abort             // abort -> throw cancelledError()
  switch r.outcome:
    "content":        return r.content
    "provider-error": throw ProviderError(FIXED_MESSAGE[r.code], {code: r.code, retryable: r.retryable})
    "refused":
      if r.code in GOVERNOR_CODES: refuseLocally(r.code)    // sets ctx.terminal, registers the error, throws (§15.1)
      else /* BUSY, REVOKED, INVALID_REQUEST */: throw ProviderError(FIXED_MESSAGE.UNKNOWN, {code:"UNKNOWN", retryable:false})
```

The client has no timer of its own. A response always arrives, or the parent is
lost (FT0 `fail()` exits the child), or the parent kills the child (§14.4).

### 7.5 Parent routing

`stage-process.js` routes child messages on the governed path only:

```text
on message m from child:
  v = validate(m)                                         // §7.2
  if v is heartbeat:         if !killed and result === null: re-arm watchdog
  elif v is provider-request:
      if killed or settled or session.revoked: reply(id, refused REVOKED); return
      session.onRequest(v)                                 // §8
  elif v is result (FT0):    session.revoke("result"); FT0 store-then-ACK (unchanged); disarm watchdog
  else: ignore (FT0 behavior)
on child "disconnect" | "exit" | "error":  session.revoke(<event>)   then the FT0 handlers run unchanged
```

`reply()` sends only when `child.connected`, inside `try`, with a callback that
ignores errors. A failed reply never dispatches anything and never revives a
session.

---

## 8. Gateway session and admission

### 8.1 Session state

| Field | Meaning |
|---|---|
| `tOpen`, `coldUntil`, `dispatchDeadline` | §6.2 |
| `B_tok`, `B_req`, adapter, credential | per effective provider (§5) |
| `entries` | list of `{tCommit, tSettle \| null, res, charged}`; one per transport invocation |
| `W` | charged governor waiting (ns); starts at `C_COLD` (§9.1) |
| `cooldownUntil`, `hintTok`, `hintReq`, `exhausted` | C4 §7.6 semantics, unchanged (§8.6) |
| `active` | `null` or `{id, controller}` of the one request in the pipeline |
| `revoked` | boolean; set once, never reset |
| `terminal` | `null` or `{code}`; sticky governor refusal (§15.2) |
| `lastId` | §7.3 |
| `stats` | private counters (busy refusals, invalid requests); never public |

An entry is **live at `t`** iff `tSettle === null` or `t < tSettle + W_HOLD`.

### 8.2 Request states

```text
RECEIVED --validate fail--------------------------------------------> REFUSED(INVALID_REQUEST)
RECEIVED --revoked------------------------------------------------> REFUSED(REVOKED)
RECEIVED --active !== null----------------------------------------> REFUSED(BUSY)            (no state change)
RECEIVED --terminal !== null--------------------------------------> REFUSED(terminal.code)
RECEIVED --accepted: active = this--> PLANNING
PLANNING --Res > B_tok / budget / cap / deadline / exhausted------> REFUSED(governor code)   (active cleared)
PLANNING --capacity free now--> COMMIT --send()--> IN_FLIGHT
PLANNING --capacity later--> WAITING --sleep returns--> PLANNING
WAITING  --revoked (sleep aborted)--------------------------------> CANCELLED (wait charged)
IN_FLIGHT --transport outcome--> SETTLING --charge, hints--> RESPONDED   (active cleared before the reply)
IN_FLIGHT --revoked--> abort --> SETTLING (UNAVAILABLE) --> no reply or REVOKED
```

Only COMMIT creates an entry and calls the transport. Every refusal before
COMMIT leaves `entries`, `W`, hints and cooldown unchanged, except that a sleep
that has already happened stays charged (§9.3).

### 8.3 Admission algorithm (normative)

```text
onRequest(req):                                     // req is a validated copy (§7.2)
  if req.id <= lastId: return reply(req.id, refused INVALID_REQUEST)
  lastId = req.id
  if revoked:           return reply(req.id, refused REVOKED)
  if active !== null:   return reply(req.id, refused BUSY)          // §8.5, no other effect
  if terminal !== null: return reply(req.id, refused terminal.code)
  active = {id: req.id, controller: new AbortController()}
  out = await run(req)                              // never throws; returns a reply value
  active = null                                     // cleared BEFORE the reply is sent
  if !revoked: reply(req.id, out)

run(req):
  res  = estimate(req)                              // PD-R10, §11.2
  if res > B_tok: return refuse(RATE_REQUEST_EXCEEDS_BUDGET)
  body = adapter.buildRequest(req)                  // pure; prepared once, before any wait
  for it = 0, 1, …:
    t = now()
    if revoked:                return CANCELLED
    if exhausted:              return refuse(RATE_BUDGET_EXHAUSTED)
    if W > W_BUDGET:           return refuse(RATE_BUDGET_EXHAUSTED)   // after an overshooting sleep
    if t >= dispatchDeadline:  return refuse(STAGE_TIMEOUT)
    f = freeAt(res, t)                              // §8.6
    if f <= t:
      return commit(res, body)                      // §8.4: same synchronous turn, no await before send
    if it >= I_MAX:            return refuse(RATE_BUDGET_EXHAUSTED)
    planned = max(f − t, S_MIN)
    if planned > W_MAX:                              return refuse(RATE_BUDGET_EXHAUSTED)
    if W + chargeable(t, t + planned) > W_BUDGET:    return refuse(RATE_BUDGET_EXHAUSTED)
    if t + planned >= dispatchDeadline:              return refuse(STAGE_TIMEOUT)
    a = now(); fired = await sleep(planned, active.controller.signal); b = now()
    if b < a: return refuse(RATE_ACCOUNTING_INVALID)  // clock regression guard (§6.2)
    W += chargeable(a, b)                           // actual elapsed, incl. overshoot or cancellation (§9.3)
    if !fired or revoked: return CANCELLED

refuse(code): if terminal === null: terminal = {code}; return {outcome:"refused", code: terminal.code}
chargeable(a, b) = max(0, b − max(a, coldUntil))    // §9.1
```

`refuse()` makes the first governor refusal sticky. `CANCELLED` produces no reply:
the session is revoked and the stage is settling. Requests that arrive after
revocation get `refused REVOKED` (§7.5). Revocation never sets `terminal`.

### 8.4 Commit point (irrevocable boundary)

```text
commit(res, body):                                  // entered synchronously from run()
  t2 = now()                                        // final reading, last operation before the checks
  if revoked:                return CANCELLED
  if t2 >= dispatchDeadline: return refuse(STAGE_TIMEOUT)
  p = transport.send(body.bytes, body.headers(credential), active.controller.signal, T_REQ)   // IRREVOCABLE
  e = {tCommit: t2, tSettle: null, res, charged: res}; entries.push(e)
  return settleExchange(e, await p)                 // §11.6
```

- No `await`, I/O or allocation-heavy work (serialization, header building) lies
  between `t2` and the call into `transport.send`. The request bytes and header
  template were prepared before the wait loop. JavaScript run-to-completion means
  no callback (revocation, message, timer) can run between the checks and the call.
- Predicates evaluated at the loop reading `t ≤ t2` stay true at `t2`: live
  entries only expire as time passes; `cooldownUntil`, hints and `exhausted`
  change only at exchange settlement, and no exchange can be outstanding while
  this request is active (§8.5); `W` changes only after a sleep (§9.1). Only the
  deadline and revocation can flip, and both are re-checked at `t2` (P Lemma 3).
- The entry is pushed in the same turn as the send call, so no other code can
  observe the ledger between them.
- The irreducible interval between reading `t2` and entering `send` (evaluating two
  comparisons and a call) is the enforcement granularity. It is disclosed, not
  claimed to be zero. After `send` is entered, socket, DNS, TLS and wire timing
  are not observable or bounded by the Gateway, except by the 30 s timer (§10.1).

### 8.5 Sequential BUSY policy (AD-06)

- At most one request is in PLANNING, WAITING, COMMIT, IN_FLIGHT or SETTLING per
  session (`active`).
- A request that arrives while `active !== null` is refused `BUSY` at once. It
  creates no entry, sleeps for no time, changes no counter except a private
  statistic, and **is not queued**. There is no queue anywhere in the Gateway, so
  queue waiting cannot exist (R3-ARCH-04, R4-ARCH-04).
- `active` is cleared only after the exchange is settled and charged, and before
  the reply is sent. A cooperative child sends its next request only after the
  reply, so the certified sequential generators never meet `BUSY`.
- The child maps `BUSY` to a non-retryable `UNKNOWN` provider error (§7.4). `BUSY`
  is private: it never appears in IPC to the user, in the envelope or on stderr
  (§15.4).

### 8.6 Ledgers, cold start, cooldown and hints

Unchanged in meaning from C4 §7.1, §7.6, now evaluated by the parent:

- **Request ledger** `reqLive(t)` = number of entries live at `t`. **Token ledger**
  `tokLive(t)` = Σ `charged` of entries live at `t`. An entry occupies both from
  commit to `tSettle + W_HOLD` and is never removed early.
- `freeAt(res, t)` = the earliest `t' ≥ t` such that all hold at `t'`:
  `t' ≥ coldUntil`; `t' ≥ cooldownUntil`; `reqLive(t') + 1 ≤ B_req` and
  (`hintReq === null` or `t' ≥ hintReq.until`); `max(tokLive(t'), hintTokUsed(t')) + res ≤ B_tok`.
  Because every entry is settled when `freeAt` runs (single active request), the
  ledgers only decrease with time and `freeAt` is finite unless `exhausted`.
- **Cold start:** no commit before `coldUntil` (PD-R5).
- **Cooldown:** after an HTTP 429, `cooldownUntil = tSettle + min(RA ?? 65 000, 65 000)`;
  `RA > 65 000` sets `exhausted` (sticky `RATE_BUDGET_EXHAUSTED` at the next request).
- **Hints** only tighten, under the strict grammars of C2:151. Groq
  `remaining/reset-tokens` feed `hintTok`. Groq `remaining/reset-requests` are per
  day and never relax `P_req`; `0` sets `hintReq`. Gemini: only `Retry-After` on
  429. Header meanings are unverified (PD-R9). Hints and cooldown are applied only
  at exchange settlement.

**INV-G01.** Every transport invocation happens at a COMMIT whose final reading
`t2` satisfies: not revoked, `t2 < dispatchDeadline`, `W ≤ W_BUDGET`, and every
ledger, cold-start, cooldown and hint predicate.

---

## 9. Wait budget and deadline

### 9.1 What is charged (AD-03, R4-ARCH-01)

`W` is **governor waiting**: time the Gateway deliberately spends asleep before
a commit, plus the fixed cold-start charge.

```text
at session open:        W = C_COLD                            // 65 000 ms, charged once (PD-R5)
after every sleep [a,b]: W += chargeable(a, b) = max(0, b − max(a, coldUntil))
nowhere else
```

- **Cold start.** The 65 000 ms cold start is charged in full at session open,
  whether or not the child's first request arrives before `coldUntil`. Sleeping
  inside `[tOpen, coldUntil)` is already covered by that charge and is not charged
  again. Sleeping past `coldUntil` (including overshoot of a cold-start sleep) is
  charged. The charge is never reduced.
- **Not charged:** request validation, estimation, request-body preparation,
  `freeAt`, the commit section, transport time, response parsing, IPC latency,
  child computation and parent lifecycle work. They are stage time, not governor
  waiting. They still consume the deadline because the deadline is absolute.
- **Why this resolves R4-ARCH-01.** C4's union model let `W` grow during
  synchronous computation after the last budget check. Here `W` changes only in
  the statement right after a sleep. The next loop iteration checks `W > W_BUDGET`
  before any commit, and no sleep can occur between that check and the commit.
  With one active request, no other request's sleep can change `W` either. So the
  `W` at every commit is the `W` that was checked (P Lemma 2, P §6.1).
- **Meaning.** This is the C3 "sum of observed governor sleeps" meaning that the
  PO approved under PD-R3, with the PD-R5 cold-start charge. It does not include
  computation, so the separate PO decision R4 mentioned for a widened meaning is
  not needed.

### 9.2 Deadline predicate (AD-04)

- **Dispatch deadline:** `dispatchDeadline = tOpen + D_DISPATCH`. A commit is
  refused when its final reading satisfies `t2 >= dispatchDeadline`. A planned
  sleep is refused before it starts when `t + planned >= dispatchDeadline`.
- **Exchange bound:** the transport's `T_REQ` timer is armed inside `send`, so an
  exchange committed before `dispatchDeadline` is aborted at the first timer
  callback at or after its commit plus 30 000 ms, i.e. at or after (but normally
  close to) `tOpen + D_STAGE`.
- **Stage enforcement:** the supervisor's kill decision fires at the first timer
  callback at or after `enforceAt = tOpen + K_PARENT` (§14.4).
- **Authority:** the parent alone. The child has no deadline timer and no deadline
  input. One absolute instant, computed once, is used by every Gateway check
  (spike GWV-01 corrective).

### 9.3 Overshoot and cancellation (AD-04, AD-05)

| Event | Effect on `W` | Effect on dispatch |
|---|---|---|
| Sleep ends on time | `+ chargeable(a, b)` | loop re-evaluates |
| Sleep overshoots by `ε` | `+ chargeable(a, b)` including `ε` | loop top: if `W > W_BUDGET` → refuse; if `t >= dispatchDeadline` → refuse. No dispatch is ever allowed by an overshoot. |
| Sleep cancelled by revocation after `x` ms | `+ chargeable(a, a + x)` (actual elapsed) | `CANCELLED`, zero dispatch |
| Refusal before any sleep | unchanged | zero dispatch |

`W` can therefore exceed `W_BUDGET` by at most the lateness of one sleep plus
`S_MIN`-scale rounding of that sleep. After that no commit occurs in the session.
`W` never decreases.

### 9.4 Counterexamples (details in P §5, P §6)

- `W = 899 990`, rate window needs 1 more ms → `planned = 50` →
  `899 990 + 50 > 900 000` → `RATE_BUDGET_EXHAUSTED` before sleeping (PT-01, spike G1).
- `t = dispatchDeadline − 500`, capacity at `dispatchDeadline` → `planned = 500`,
  `t + planned = dispatchDeadline` → `STAGE_TIMEOUT` before sleeping (PT-02, spike E4a).
- Planned 400, timer 100 ms late → loop reads `t = dispatchDeadline` → refused, 500 ms
  charged (PT-03, spike E4b, GWV01-6).

---

## 10. Transport

### 10.1 Single-send contract (TS)

The Gateway's transport MUST satisfy, for each `send()` call:

| ID | Requirement |
|---|---|
| TS-1 | At most **one** HTTP request is written for one `send()`. No automatic retry or resend for any status (including 421) or connection failure. |
| TS-2 | Redirects are never followed. A 3xx response is returned as a response. |
| TS-3 | No connection reuse: a fresh connection per `send()` (`agent: false` or an equivalent non-pooling agent) and `Connection: close`. A stale pooled socket can therefore never cause a silent resend. |
| TS-4 | An explicit `AbortSignal` destroys the request. An already-aborted signal causes zero network activity. |
| TS-5 | A `T_REQ` timer is armed inside `send()` and covers connect, TLS, request, response headers and the whole body read. On expiry the request is destroyed and the outcome is `timeout`. |
| TS-6 | The response body is read with a hard byte bound (`MAX_RESPONSE_BYTES`) while streaming, before any JSON parse (TSB-F06 semantics, as `bounded-response.js` today). |
| TS-7 | The outcome is classified (`response {status, rate headers, bounded body}`, `network_error`, `timeout`, `aborted`), never acted on. It settles exactly once. |
| TS-8 | The credential is supplied by the session at the call and used only for the request header. It is never logged, traced or included in an outcome. |
| TS-9 | Only the fixed provider origins are reachable: `https://api.groq.com:443` and `https://generativelanguage.googleapis.com:443`, with paths built by the adapter. The child cannot influence them. |

Global `fetch` (undici) MUST NOT be used on the governed path: it resends a POST
after 421 even with `redirect: "manual"` (R4-ARCH-02; spike B1 on Node 22 and 24).
The spike's `node:http` transport (`agent:false`, `Connection: close`, no retry,
no redirect logic, explicit abort and timeout) met TS-1 … TS-4 and TS-7 on
loopback for 200, 301/302/303/307/308, **421**, 429, 500, connection reset,
timeout, in-flight abort and pre-abort (spike T1–T10). That is the feasibility
basis for TS.

### 10.2 Production HTTPS qualification (OPEN; required before implementation acceptance)

The production transport is core `node:https` with the same structure. Loopback
HTTP evidence does **not** show real Groq or Gemini HTTPS behavior. These items
MUST be verified for the production transport on every supported Node line
(`engines` 22.x) and on Windows and Linux, against a local TLS test server (test
CA injected only through test-only transport options) and, only after PD-R9
authorizes it, against the real providers:

| ID | Qualification |
|---|---|
| TQ-01 | One `send()` → at most one TLS connection and one HTTP request for every status in §12, incl. 421 and each 3xx. |
| TQ-02 | No retry on connection reset, TLS handshake failure, or handshake timeout. |
| TQ-03 | Abort before connect, during handshake, during request write and during the body read: zero further requests; outcome `aborted`; uncertain completion recorded. |
| TQ-04 | `T_REQ` covers handshake and body; slow-drip body ends as `timeout`. |
| TQ-05 | TLS verification is on (`rejectUnauthorized` default true); SNI equals the fixed host; no `NODE_TLS_REJECT_UNAUTHORIZED` path is honored on the governed transport; behavior with `NODE_EXTRA_CA_CERTS` documented. |
| TQ-06 | No proxy path: environment proxy variables and any runtime proxy switch present on the supported Node line do not route or duplicate governed requests. |
| TQ-07 | HTTP/1.1 only; no ALPN negotiation to HTTP/2 on the governed transport. |
| TQ-08 | The bounded body reader for Node streams matches `bounded-response.js` semantics (byte cap, abort mapping, no parse before full acquisition). |
| TQ-09 | Credential never appears in any outcome, trace, error message, IPC message or diagnostic (marker test). |
| TQ-10 | Request bytes are identical to the ungoverned provider's request body for the same prompts and model (golden comparison), so provider behavior is unchanged apart from transport semantics. |

TQ-05, TQ-06 and TQ-09 are also Security gate SG-04 (§21.2).

### 10.3 Evidence limits

- Spike: loopback `node:http`, fake server, no TLS, no DNS, no real provider.
- R4 and spike B1: `fetch` sends 2 POSTs on 421 on Node 22.23.3 and 24.22.1.
- Not shown by anyone: real provider handling of single-send requests, HTTP 421 or
  3xx from real providers, TLS behavior, Windows on Node 22.x.

---

## 11. Exchange outcome and accounting (R3-ARCH-01; PD-R10, PD-R11 A, PD-R12 A, PD-R12-I1)

### 11.1 Exchange record

One record per commit, owned by the session, written only by the transport
outcome and the adapter's parse, sealed once at settlement.

| Axis | Values |
|---|---|
| A. Transport | `RESPONSE` · `NETWORK_ERROR` · `TIMEOUT` · `ABORTED` (every non-`RESPONSE` value after a send is **uncertain completion**) |
| B. HTTP | `none` · `2xx` · `3xx` (not followed) · `4xx` (incl. 421) · `5xx`; `status`; frozen map of the §8.6 rate headers only |
| C. Body | `NOT_READ` (non-2xx; discarded) · `READ_FAILED` (timeout, oversize, invalid JSON) · `PARSED` |
| D. Content | `PRESENT` · `ABSENT` |
| E. Usage | `VALID(U)` · `MISSING` · `MALFORMED` · `UNAVAILABLE` |

Usage classification:

| Condition | Usage class |
|---|---|
| C = `PARSED`, usage object present, every required field valid, consistency holds (§11.3) | `VALID(U)` |
| C = `PARSED`, usage object absent or `null` | `MISSING` |
| C = `PARSED`, usage present but a required field absent, non-integer, negative, `> U_MAX`, inconsistent, or the normalizer threw | `MALFORMED` |
| C ≠ `PARSED` | `UNAVAILABLE` |

The adapter classifies usage **immediately after** the bounded JSON parse and
**before** the content check. Content validity never changes the usage class.

### 11.2 Estimate and reservation (PD-R10)

`Res = ceil(utf8Bytes(systemPrompt + userPrompt) / κ) + O + completionReserveTokens + reasoningReserveTokens`.
`Res > B_tok` → `RATE_REQUEST_EXCEEDS_BUDGET` with zero commits. `Res` is the
reservation charged from commit until settlement. It is heuristic; provider-side
TPM compliance is not guaranteed.

### 11.3 Usage normalization

| Provider | Required | Optional (absent = 0) | Consistency | `U` |
|---|---|---|---|---|
| Groq `usage` | `prompt_tokens`, `completion_tokens`, `total_tokens` | — | `total ≥ prompt + completion` | `total_tokens` |
| Gemini `usageMetadata` | `promptTokenCount`, `totalTokenCount` | `candidatesTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount` | `total ≥ prompt + candidates + thoughts + toolUse` | `totalTokenCount` |

Every field used is an integer in `[0, U_MAX]`. The normalizer performs a fixed
set of own-property reads on a `JSON.parse` product, never iterates unknown keys,
never stringifies, and maps any throw to `MALFORMED`. It stores only `{class, U}`.

### 11.4 Charge rule

| Usage class | Final `charged` | Effect |
|---|---|---|
| `VALID(U)` | `max(Res, U)` whether content is present or absent | none from accounting |
| `MISSING` | `B_tok` | none |
| `MALFORMED` | `B_tok` | sticky `RATE_ACCOUNTING_INVALID` (PD-R12-I1), even if content is present |
| `UNAVAILABLE` (non-2xx, 3xx, read failure, network error, timeout, abort, uncertain completion) | `B_tok` | none |

`charged ≥ Res` always. `charged > B_tok` is possible for `VALID(U)` with
`U > B_tok` and is recorded unclamped; it blocks token admission until expiry.

Reviewer counterexample (R3-ARCH-01, preserved): `Res = 3 400`, `B_tok = 6 800`,
2xx, usage `{100, 6 900, 7 000}`, content absent → `charged = 7 000`; the child
receives `provider-error INVALID_RESPONSE` (not retryable).

### 11.5 Saturation, expiry, no double charge, no hidden refund

- Every commit creates exactly one entry. Refusals create none. There is no
  "not invoked" entry class in C5: commit and send are one step (§8.4).
- `charged` is set to `Res` at commit (reservation) and replaced exactly once at
  settlement by the §11.4 value, which is `≥ Res`. It never changes afterwards.
- An entry is never removed while live. It expires at `tSettle + W_HOLD` for both
  ledgers. Saturation (`B_tok`) affects only this session's token ledger.
- A retry is always a new IPC request, a new admission and a new entry.
- `W` never decreases. No refund of reservation, charge or wait exists.

### 11.6 Settlement procedure and precedence

```text
settleExchange(e, outcome):                            // runs once per commit
  s = classify(outcome)                                // axes A–E (§11.1)
  e.tSettle = now()
  e.charged = s.usage == VALID ? max(e.res, s.U) : B_tok
  applyHintsAndCooldown(s)                             // from status and frozen rate headers only
  if revoked:                 return CANCELLED          // child is being settled; no reply
  if s.usage == MALFORMED:    return refuse(RATE_ACCOUNTING_INVALID)
  if s.transport == RESPONSE and s.http == 2xx and s.content == PRESENT:
                              return {outcome:"content", content}
  return {outcome:"provider-error", code, retryable} = adapter.mapFailure(s)   // §12
```

Precedence: **revocation > malformed-usage refusal > provider outcome**. Accounting
runs before every branch, including revocation (§9.3, §13.7).

---

## 12. Provider mapping and retry ownership (R2-ARCH-05 preserved)

The adapter reuses the existing provider mapping functions. The governed child
therefore sees the same `{code, retryable}` it would see from its own provider today.

| Condition | Groq | Gemini | Usage class | Gateway action |
|---|---|---|---|---|
| HTTP 408 | `TIMEOUT` ✓ | `UNKNOWN` ✗ | UNAVAILABLE | none |
| HTTP 429 | `RATE_LIMIT` ✓ | `RATE_LIMIT` ✓ | UNAVAILABLE | cooldown; `RA > 65 s` → `exhausted` |
| HTTP 421 | `UNKNOWN` ✗ | `UNKNOWN` ✗ | UNAVAILABLE | single send (TS-1); no transport retry |
| HTTP 3xx (never followed) | `UNKNOWN` ✗ | `UNKNOWN` ✗ | UNAVAILABLE | none |
| HTTP 401 / 403 | `AUTH` ✗ | `AUTH` ✗ | UNAVAILABLE | none |
| Other 4xx | `UNKNOWN` ✗ | `UNKNOWN` ✗ | UNAVAILABLE | none |
| HTTP 5xx | `UNKNOWN` ✓ | `UNKNOWN` ✓ | UNAVAILABLE | none |
| Network error | `NETWORK` ✓ | `NETWORK` ✓ | UNAVAILABLE | none |
| `T_REQ` timeout (connect, headers or body) | `TIMEOUT` ✓ | `TIMEOUT` ✓ | UNAVAILABLE | none |
| Body oversize / not JSON | `INVALID_RESPONSE` ✗ | same | UNAVAILABLE | none |
| 2xx parsed, content absent | `INVALID_RESPONSE` ✗ | same | by usage | §11.6 |
| 2xx, content invalid for the model contract | content returned; generator correction retry | same | by usage | none |
| Revocation (SEC-C1 or settlement) | child: certified cancellation `UNKNOWN` ✗ | same | UNAVAILABLE if sent | no reply / `REVOKED` |
| Governor refusal | `RATE_*` / `STAGE_TIMEOUT` ✗, sticky | same | no entry | §15 |
| `BUSY`, `INVALID_REQUEST` | child: `UNKNOWN` ✗ | same | no entry | none |

Retry ownership: generators keep their two attempts (PD-R1 open). The Gateway and
the transport make **zero** retries. Each attempt is a separate IPC request and a
separate admission. Since 3xx and 421 map to non-retryable errors, they never
trigger attempt 2.

---

## 13. Revocation, Property A, Property B and SEC-C1

### 13.1 Revocation authority and triggers

Only the parent revokes. `session.revoke(reason)` is called synchronously by the
supervisor as the **first** action on each of:

| Trigger | Where |
|---|---|
| Valid FT0 `result` stored | §7.5 (the child declared completion) |
| Kill decision (watchdog or enforcement) | §14.4 step 1 |
| Child `disconnect` (IPC loss seen by the parent) | §7.5 |
| Child `exit`, `close` or spawn `error` | §7.5 |
| Parent settlement of the stage (any path) | §14.6 |

Parent process death (including native signal termination, PD-R6) destroys the
session with the process. No Gateway can dispatch after its process has ended.

### 13.2 Revocation procedure

```text
revoke(reason):
  if revoked: return                 // idempotent
  revoked = true                     // first statement, synchronous
  if active: active.controller.abort()   // ends a sleep (charged, §9.3) or destroys an in-flight request (TS-4)
```

A session is never un-revoked. A later stage gets a new session with a new origin.

### 13.3 Property A

> **Property A.** After `session.revoke()` returns, the session makes no new
> `transport.send()` call. (Equivalently: no authorized Gateway dispatch after
> parent revocation.)

Design argument (P Lemma 4): `transport.send()` is called only from `commit()`,
which checks `revoked` after its final reading with no `await` before the call.
`revoke()` runs to completion in one turn. Either `revoke()` runs before that
check (the check refuses) or after `send()` was entered (that send was authorized
before revocation and is now aborted, best effort). Every other path re-checks
`revoked` after each `await`. The transport object and credential are private to
the session.

Status: **SPIKE_VERIFIED** in prototype scope (spike G4, G9, G11, G12, P5, P7,
P9, P12, GWV01-7). **DESIGNED** for production. Integrated production evidence:
**OPEN** (M §12).

### 13.4 Property B

> **Property B.** A surviving or compromised child has no arbitrary direct
> network access.

**NOT PROVIDED.** The Gateway does not and cannot provide it. A child is an
ordinary Node process of the same OS user. It can load `node:http`, `node:https`,
`node:net` or any file from disk and connect anywhere the user can. Spike P12
measured an abandoned child making **53 (Windows) / 55 (Linux)** unauthenticated
direct HTTP requests while the Gateway made zero. Property A does **not** imply
Property B. Providing B needs OS-level isolation of the worker (sandbox, network
namespace, per-process firewall rule, or a separate OS user), which is a separate
security/architecture requirement. It is not designed here (SG-02).

### 13.5 Scenario analysis

| Scenario | Gateway dispatch (A) | Credentialed provider call by the child | Unauthenticated network by the child (B) | Notes |
|---|---|---|---|---|
| Normal completion | stops at revocation on result | impossible (no credential) | possible only if child code is compromised | certified child code makes none |
| Parent IPC loss (parent alive, channel broken) | revoked at the parent's `disconnect` event | impossible | as above | child FT0 `fail()` aborts and exits in the same turn |
| Parent process dies | no Gateway exists | impossible | as above | child FT0 exits on `disconnect` |
| Delayed IPC disconnect | revoked at the parent's decision, before disconnect | impossible | as above | late requests over the still-open channel are refused `REVOKED` (spike P7) |
| Kill not delivered / delayed (surviving child) | revoked before `kill()` | impossible | **possible** | K_SETTLE abandonment bounds the parent phase only (§14.5); spike P11, P12 |
| Child blocked in synchronous computation | revoked by the watchdog decision | impossible while blocked; refused after | possible after unblocking if compromised | queued requests reach a revoked session (R4-ARCH-03 no longer affects A) |
| Compromised child | revoked as above; IPC requests validated and refused | **not prevented**: a same-user process may read the credential from the parent's initial environment block (e.g. `/proc/<ppid>/environ` on Linux) or process memory, or from wherever the operator stores it | **possible** | analysis, not experiment; SG-03 |
| Missing OS-level isolation | — | — | **possible** | Property B NOT PROVIDED (SG-02) |

**Parent-owned credentials versus arbitrary network permission.** Moving the
credential out of the child's environment and IPC removes it from the child's
normal reach and from every artifact the child produces. It does not confine the
credential against a compromised same-user process, and it does not restrict
network access. Both need OS-level controls.

### 13.6 SEC-C1 reconciliation (mandatory Security gate, AD-02)

SEC-C1 (PO-GH): "Parent IPC disconnection must abort pending waits and in-flight
provider requests. No subsequent provider calls may be initiated. The child must
terminate."

| Clause | C5 mechanism | Relation to the certified FT0 implementation |
|---|---|---|
| Abort pending waits | Gateway waits live in the parent; `revoke()` aborts them (§13.2). The child has no governor waits. | Stronger: the waiting party is the revoking party. |
| Abort in-flight provider requests | `revoke()` destroys the in-flight request (TS-4). The child's pending IPC call rejects through the certified cancel signal. | Equal. Abort cannot undo a transmitted request (§13.7). |
| No subsequent provider calls initiated | **Authorized** calls: Property A (§13.3), and the child holds no credential. **Unauthenticated** network use: not prevented (Property B). | Certified FT0 relies on the cooperative child exiting; a compromised FT0 child holds the credential and raw network. C5 is not weaker on any path, and removes the credential from the child. |
| Child must terminate | Unchanged child `guardParentLink()` exits in the same turn; governed parent adds kill on watchdog/enforcement and K_SETTLE abandonment. | Equal for a cooperative child. A child that does not run its handlers (blocked, compromised, kill undelivered) is not guaranteed to terminate, in FT0 or in C5. |
| Disabled governor (PD-R14) | Unchanged certified FT0. | Identical. |

**The Gateway design does not weaken SEC-C1 relative to its certified
implementation.** Whether the approved SEC-C1 text is satisfied by Property A plus
certified child self-termination, or requires Property B (and a termination
guarantee for non-cooperative children), is a **Security decision this author
cannot make**. It is recorded as **SG-01, SECURITY_GATE_OPEN**. If Security
concludes that SEC-C1 requires Property B, this design is **BLOCKED** until an
OS-isolation requirement is approved and designed, because C5 cannot provide B.
No waiver is requested or assumed.

### 13.7 Abort is not rollback

Once `transport.send()` has been entered, the request may already be on the wire
or processed remotely. Revocation and abort end local activity and suppress any
reply, but cannot retract the request, its remote processing, or any provider-side
charge. The exchange is recorded as uncertain completion and charged `B_tok`
(§11.4). This applies equally to the certified FT0 path.

---

## 14. Process lifecycle and FT0 compatibility (DRIFT-02; AD-07)

### 14.1 Unchanged FT0 behavior

On every path, governed or not, these stay exactly as certified:

- Receipt and ACK: the child sends its result with a fresh random receipt; the
  parent stores the **first** result in memory, then ACKs the matching receipt.
  Only that ACK counts as delivery, even if it overtakes the send callback.
- Child result transfer: `running → sending → awaiting_ack → delivered | failed`;
  missing ACK within `ACK`, a send error or parent loss → child exit 1.
- Close-based settlement; `CAE` recovery after `exit` without `close` (FT0-C2-D1)
  with `result = null`.
- Exit failure semantics: accept only `result.ok === true && exitCode === 0` after
  `close` (generative.js L83). A result followed by a nonzero exit or a signal is
  not accepted.
- Native signal handling: no handler is added; PD-R6 holds.
- Exactly-once settlement via the certified `settled` guard; late events ignored.
- Ungoverned paths: byte-identical (INV-G13).

### 14.2 Governed additions

| Addition | Rule |
|---|---|
| Payload marker | `gateway: {v:1}`; closed; invalid → `STAGE_PAYLOAD_INVALID` (existing) |
| Heartbeat | child sends `{type:"heartbeat", v:1, seq}` from payload receipt, then every `HB`; cleared at `report()` and in FT0 `fail()`; send errors ignored |
| Watchdog | parent timer `WD` from `tOpen`; re-armed by valid heartbeats while no result is stored; disarmed when a result is stored |
| Enforcement | parent timer at `enforceAt = tOpen + K_PARENT`, armed until settlement |
| Revocation hooks | §13.1 |

The child has no governor timer, deadline timer or new abort source.

### 14.3 Parent message handling

```text
on message m:
  if killed: (provider-request → reply REVOKED if connected); return
  heartbeat (valid) and result === null:  re-arm watchdog
  provider-request (valid):               session.onRequest (§8.3)
  result (FT0):                           session.revoke("result"); store first result; ACK; disarm watchdog
  else:                                   ignore
```

### 14.4 Kill decision

When the watchdog or enforcement timer fires before settlement:

1. `session.revoke(reason)` (synchronous, first).
2. `killed = {reason}` (`STAGE_TIMEOUT` or `CHILD_UNRESPONSIVE`); first reason wins; sticky.
3. `result = null`: a stored or ACKed result is discarded.
4. Disarm watchdog and enforcement timers.
5. `child.kill("SIGKILL")` inside `try` (POSIX SIGKILL; Windows `TerminateProcess`);
   record `killIssued`.
6. Arm the `K_SETTLE` timer (§14.5).

The parent does **not** disconnect IPC at the kill decision. On Windows a
parent-side `disconnect()` can prevent `close` from firing, which would turn every
kill into a `CAE`-delayed settlement (C4 NDI-12). Property A does not depend on
disconnect: revocation is step 1.

### 14.5 Post-kill settlement (`K_SETTLE = 10 000 ms`, APPROVED)

Phase K starts at the kill decision `tKill` and ends at the first of:

| Event | Next |
|---|---|
| `exit` | clear `K_SETTLE`; FT0 phase S (`close`, or `CAE` after `exit`) |
| `close` | settle (result already discarded) |
| spawn `error` | settle |
| first `K_SETTLE` callback at or after `tKill + K_SETTLE`, no `exit` | **abandonment** |

Abandonment (one-shot, then `settled = true`):

1. If `child.connected`, `child.disconnect()` inside `try`. A cooperative child
   then runs its SEC-C1 path. **Nothing depends on this for Property A**: the
   session was revoked at `tKill`, and any request that still arrives is refused.
2. Destroy `child.stdout` and `child.stderr`.
3. `child.unref()`.
4. Clear every governed timer (watchdog, enforcement, `K_SETTLE`, `CAE`).
5. Settle once: `result = null`, `abandoned = true`; classification is
   `killed.reason`; no commit.
6. One stderr line:
   `[qa-agent] <stage> process did not exit within 10s after termination (pid <n>); it was abandoned and may still be finishing.`
7. Late `exit`, `close` and messages are ignored (`settled` guard).

Bound (**INV-G18**, parent clock): the post-kill settlement decision is taken at
the first callback at or after `tKill + K_SETTLE` without `exit`, or at or after
`tExit + CAE` when `exit` arrived first; so by `tKill + K_SETTLE + CAE` plus timer
lateness. `K_SETTLE` does **not** guarantee that a surviving process terminates,
and it bounds a phase, not the whole CLI (§17).

### 14.6 Result acceptance and separated mechanisms

Acceptance rule (unchanged FT0, plus the C4 governed-only kill discard): commit
only if a result is stored, `exitCode === 0`, `killed === null` and settlement was
by `close` (**INV-G12**). There is **no** time-based acceptance grace, and the
parent never kills a child on the successful path. A child that stores a result
but never exits is ended by the enforcement timer, and its result is discarded.

These mechanisms stay separate and never substitute for each other:

| Mechanism | Trigger | Effect |
|---|---|---|
| Ordinary successful-result acceptance | `result` + `exit 0` + `close` | validate and commit |
| Gateway dispatch deadline | `t2 >= dispatchDeadline` | refuse dispatch (`STAGE_TIMEOUT`) |
| Stage enforcement | callback at or after `enforceAt` | kill decision, `STAGE_TIMEOUT` (6) |
| Watchdog termination | no valid heartbeat for `WD` before a result | kill decision, `CHILD_UNRESPONSIVE` (1) |
| Post-kill `K_SETTLE` | no `exit` within `K_SETTLE` after a kill | abandonment |
| FT0 `CLOSE_AFTER_EXIT` recovery | `exit` without `close` for `CAE` | settle with `result = null` |
| Parent finalization | settlement | classification (§15.3); validation and commit only on acceptance |

### 14.7 Platform differences

| Aspect | POSIX | Windows |
|---|---|---|
| Kill | SIGKILL; uncatchable; no further user-mode code once delivered | `TerminateProcess`; no further user-mode code once termination begins |
| Ignorable termination | SIGTERM can be ignored (spike P12 used it); C5 uses SIGKILL | cannot be ignored; "kill not delivered" exists only as a fault (spike simulated it with a no-op hook) |
| Kill → `exit` latency | unbounded in uninterruptible I/O | unbounded while pending I/O drains |
| `close` after `exit` | normally prompt | may never arrive with unread IPC data (FT0-C2-D1); `CAE` handles it |
| Parent-side `disconnect()` | `close` follows | `close` may not fire; hence none at the kill decision |
| After the CLI exits | an unreaped child is reparented and reaped | libuv job object closure expected to terminate children (to be verified, M §10) |
| Credential exposure to a same-user child | `/proc/<ppid>/environ` readable subject to ptrace access checks | process memory readable at equal integrity |
| Timer granularity | ≈ 1 ms | ≈ 15.6 ms by default |
| Spike runtime | Node 22.23.3 (WSL2) | Node 24.22.1 — **outside `engines` 22.x**; Windows on Node 22.x is unverified |

---

## 15. Failure propagation and error precedence (R2-ARCH-02 preserved)

### 15.1 Child-side stage context

The C4 §11 machinery is retained in the child, with the Gateway client as the
governor's local proxy:

- `StageContext {stage, stepSeq, step, calls, terminal, refusals, cancelled}`,
  created by the runner on the governed path only; `beginStep(label)` before every
  generator invocation.
- The client increments `ctx.calls` per `analyze()` and, on a governor refusal,
  sets `ctx.terminal = {code, stepSeq, step, callOrdinal}` once and registers the
  thrown error object in `ctx.refusals` (identity, `WeakSet`).
- `classifyReturn` and `classifyThrow` (E1 identity-matched rethrow, E2 unrelated
  exception after a refusal, E3 unchanged baseline) are exactly as C4 §11.3. R4
  found this path RESOLVED_BY_DESIGN.
- Child failure shapes: `{kind:"generation", step, providerAttempts ≥ 1, codes}`,
  `{kind:"stage-timeout", step, providerAttempts ≥ 1}`,
  `{kind:"internal", code:"GENERATIVE_STAGE_FAILED", governorCode}` (E2), baseline
  shapes otherwise.

### 15.2 Parent-authoritative terminal

The parent knows exactly which governor refusal its session issued
(`session.terminal`). The child's report is used only for the step and the
per-step attempt count.

- A governor code in the child's report that the session did not issue is
  removed. The child cannot introduce a governor code.
- `kind:"stage-timeout"` without `session.terminal.code === STAGE_TIMEOUT` is an
  invariant violation → `STAGE_FAILED` (1).
- When `session.terminal` is set and the child's `providerAttempts` is not a
  positive integer, the parent does not synthesize a count; it classifies
  `STAGE_FAILED` (1) (invariant violation). It never falls into the exit-4 rule.

### 15.3 Parent classification and precedence (highest first)

| # | Outcome | CLI result |
|---|---|---|
| 1 | Parent's own native signal termination | process ends natively (PD-R6); no classification |
| 2 | Pre-spawn failure: config, `PROVIDER_GOVERNOR_LIMITS_MISSING`, provider configuration | existing exit 3 codes |
| 3 | Spawn `error` | `STAGE_SPAWN_FAILED` (1), existing |
| 4 | Kill by enforcement | `STAGE_TIMEOUT` (6); result discarded |
| 5 | Kill by watchdog | `CHILD_UNRESPONSIVE` (1); result discarded |
| 6 | Accepted result (INV-G12) | existing validation and commit |
| 7 | `session.terminal = STAGE_TIMEOUT`, child report generation/stage-timeout/E1 | `STAGE_TIMEOUT` (6) |
| 8 | `session.terminal = RATE_*`, child report generation/E1 | `PROVIDER_FAILURE` (6), governor code first, then the child's sanitized codes |
| 9 | `session.terminal` set, child internal failure (E2) | `STAGE_FAILED` (1), message adds "(governor reason code: X)" |
| 10 | Invariant violations of §15.2 | `STAGE_FAILED` (1) |
| 11 | No terminal: existing child failure classification | unchanged (incl. exit 4 when attempts 0) |
| 12 | No result, nonzero exit, signal, `CAE` recovery, SEC-C1 child exit | `STAGE_FAILED` (1), existing |

### 15.4 Private field mapping (spike and IPC names)

| Name | Origin | Production treatment | Public? |
|---|---|---|---|
| `BUSY` | spike, AD-06 | private refusal; child `UNKNOWN` ✗; private counter | **No** |
| `REVOKED`, `REVOKED_IN_FLIGHT` | spike | private; settlement precedence decides the outcome | **No** |
| `INVALID_REQUEST` (spike `rejected`, `DUPLICATE_ID`) | spike | private refusal; child `UNKNOWN` ✗ | **No** |
| `DEADLINE` | spike | `STAGE_TIMEOUT` via `session.terminal` | as `STAGE_TIMEOUT` (§16) |
| `WAIT_BUDGET`, `WAIT_BUDGET_EXCEEDED_AFTER_WAIT`, `RATE_WINDOW` | spike | `RATE_BUDGET_EXHAUSTED` | as `RATE_BUDGET_EXHAUSTED` |
| `PREPARE_FAILED` | spike | not applicable (no prepare hook); a request-build exception → `UNKNOWN` ✗ | **No** |
| `child_failed` + `resultRejection: NONZERO_EXIT \| SIGNAL` | spike C1 | existing FT0 path: no acceptance → `STAGE_FAILED` (1) | **No** new field |
| `resultRejection: KILLED \| NOT_EXITED` | spike C1 | `killed.reason` (rows 4–5) | **No** new field |
| `completed`, `child_exited`, `timeout` reasons; trace events | spike | not emitted | **No** |
| `maybeReachedRemote` | spike | internal → `UNAVAILABLE`, charge `B_tok` | **No** |
| `GRACEFUL_EXIT_MS = 300` | spike | **not carried** (AD-07) | — |
| `stage-timeout`, `governorCode`, `heartbeat`, `provider-*` | C4/C5 private IPC | parent-only, validated, closed | **No** |

## 16. Public reason codes (PD-R8; unchanged from C4)

| Code | Where | Origin | Exit | Reachable when |
|---|---|---|---:|---|
| `RATE_REQUEST_EXCEEDS_BUDGET` | reason code in `PROVIDER_FAILURE` | `Res > B_tok` | 6 | governed |
| `RATE_BUDGET_EXHAUSTED` | reason code in `PROVIDER_FAILURE` | budget, per-wait cap, iteration cap, over-cap 429 hint | 6 | governed |
| `RATE_ACCOUNTING_INVALID` | reason code in `PROVIDER_FAILURE` | malformed usage (PD-R12-I1); clock regression | 6 | governed |
| `STAGE_TIMEOUT` | top-level `errors[].code` | dispatch deadline; enforcement kill | 6 | governed |
| `CHILD_UNRESPONSIVE` | top-level `errors[].code` | watchdog kill | 1 | governed |
| `PROVIDER_GOVERNOR_LIMITS_MISSING` | top-level `errors[].code` | enabled, no limits for the effective provider | 3 | v2 enabled |

No other code is added. None is reachable with v1 or a disabled governor. These
codes still need the separate canonical contract amendment (§20).

## 17. Deadline and termination phases (D+15 A)

| Phase | Clock / origin | Boundary | On violation |
|---|---|---|---|
| G1 — admission | parent, `tOpen` | commit only at `t2 < tOpen + D_DISPATCH` | `STAGE_TIMEOUT` |
| G2 — exchange | parent transport timer | aborted at the first callback at or after commit + `T_REQ` | provider `TIMEOUT` |
| W — wait | parent `W` | `W ≤ W_BUDGET` at every commit | `RATE_BUDGET_EXHAUSTED` |
| C — child computation | child | not bounded by the Gateway; liveness via heartbeat | phase H |
| H — heartbeat liveness | parent | silence `< WD` while no result is stored | kill, `CHILD_UNRESPONSIVE` (1) |
| E — enforcement | parent, `tOpen` | first callback at or after `tOpen + K_PARENT` | kill, `STAGE_TIMEOUT` (6) |
| A — result transfer | child | ACK within `ACK` (FT0) | child exit 1 |
| K — post-kill | parent, `tKill` | `exit` / `close` / `error`, or abandonment at or after `tKill + K_SETTLE` | abandonment |
| S — settlement | parent, `tExit` | `close`, or `CAE` after `exit` (FT0) | settle with `result = null` |
| V — validation and commit | parent | not bounded | existing errors |

Statements that hold (algorithmic): no governed transport invocation at a parent
reading `>= tOpen + 1 770 000`; kill decision at the first callback at or after
`tOpen + 1 815 000`; post-kill settlement decision at or after `tKill + K_SETTLE`
or `tExit + CAE`.

Statements that do **not** hold: "the CLI settles by 1 815 s"; "no HTTP bytes leave
after 1 770 s" (wire timing is not observable); "the 900 s budget binds before the
deadline"; any punctual timer.

## 18. Invariants

| ID | Invariant |
|---|---|
| INV-G01 | Every transport invocation happens at a COMMIT whose final reading satisfies not-revoked, `t2 < dispatchDeadline`, `W ≤ W_BUDGET` and all ledger, cold-start, cooldown and hint predicates (§8.4). |
| INV-G02 | At most one active request per session; a concurrent request is refused `BUSY` without queueing or any accounting effect (§8.5). |
| INV-G03 | Any half-open 65 s interval holds at most `B_req` and at most `floor(B_tok / Res_min)` commits (P Lemma 6). |
| INV-G04 | One entry per commit; `charged ∈ {max(Res, U), B_tok}`, set once at settlement, `≥ Res`; never removed while live (§11.5). |
| INV-G05 | `W` starts at `C_COLD`, changes only by `chargeable()` after a sleep, never decreases, and is `≤ W_BUDGET` at every commit (§9.1). |
| INV-G06 | No commit at a final reading `t2 >= dispatchDeadline`, and no sleep is started when it is planned to end at or after `dispatchDeadline` (§9.2). |
| INV-G07 | No commit before `coldUntil`. |
| INV-G08 | Zero Gateway and transport retries; at most one transport invocation per commit; under TS at most one HTTP request per invocation (§10.1). |
| INV-G09 | The first governor refusal is sticky in the session; afterwards every request is refused with that code and zero commits. |
| INV-G10 | **Property A:** after `revoke()` returns, zero `transport.send()` calls in that session (§13.3). |
| INV-G11 | A governor refusal reaches the envelope on the return and unwind paths as primary classification or as `governorCode` (E2), unless a higher-precedence outcome applies; the code comes from the parent's session record (§15.2). |
| INV-G12 | Commit only if a result is stored, `exitCode === 0`, `killed === null` and settlement was by `close`. |
| INV-G13 | v1 or disabled governor: spawn, environment, provider construction, IPC, exit codes and output identical to baseline; SEC-C1 certified behavior present. |
| INV-G14 | No credential, model name, URL, header, raw usage, raw provider message or body other than validated `content` crosses IPC; none reaches logs or the envelope. |
| INV-G15 | Hints only tighten; invalid hints are ignored. |
| INV-G16 | All accounting arithmetic is exact (BigInt ns, integer tokens). |
| INV-G17 | Valid usage is charged `max(Res, U)` whether or not content is present; malformed usage always sets `RATE_ACCOUNTING_INVALID`. |
| INV-G18 | After a kill decision, parent settlement is decided at or after `tKill + K_SETTLE` (no `exit`) or `tExit + CAE`; abandonment discards the result. |

## 19. Non-guarantees

C5 does **not** guarantee:

1. **Property B** (no arbitrary network access by a surviving or compromised child).
2. Credential confinement against a compromised same-user child (§13.5).
3. Termination of a child whose kill is not delivered or that never yields; only
   that the parent settles and the Gateway dispatches nothing more.
4. That an aborted, timed-out or abandoned request was not processed or charged remotely.
5. Compliance with any provider's TPM, RPM, RPD or TPD accounting (PD-R10); estimator accuracy; provider header meanings (PD-R9).
6. Isolation from other processes, earlier invocations or other tools on the account.
7. Timer punctuality, or any bound across system suspend.
8. The instant at which HTTP bytes leave the host after `transport.send()` is entered.
9. TS on real HTTPS before TQ-01 … TQ-10 pass; real provider behavior before PD-R9.
10. Parent validation and commit time (phase V), or whole-CLI settlement time.
11. That a healthy child is never killed by the watchdog if one synchronous segment
    or result transfer exceeds about 45 s without heartbeats.
12. Completion of any particular amount of work N.

## 20. Future implementation touchpoints (design only; not authorized)

| Area | Expected change |
|---|---|
| New internal modules (parent) | Gateway session (admission, ledgers, wait, deadline, revocation, accounting), single-send `https` transport, bounded stream reader, adapters, IPC schema. Package-surface inventory update and external install proof (C2:444). |
| New internal module (child) | `GatewayClientProvider`, heartbeat sender, `StageContext`. |
| `providers/groq-provider.js`, `gemini-provider.js` | Export the existing pure pieces (request build, `mapHttpError`, body-read and content mapping) for reuse by the adapters; ungoverned behavior byte-identical. |
| `cli/child-env.js` | Governed variant of `buildGenerativeEnv()` without `AI_SECRET_KEYS`. |
| `cli/generative-runner.js` | Governed mode from the payload marker; client provider instead of `createProvider()`; heartbeat; `StageContext`, `classifyReturn` / `classifyThrow`. |
| `cli/stage-process.js` | Governed routing, revocation hooks, watchdog, enforcement, kill sequence, `K_SETTLE` abandonment. |
| `cli/generative.js` | Session open before spawn, adapter construction, classification of §15.3, abandonment diagnostic. |
| `cli/run-artifacts.js` | `GOVERNOR_REASON_CODES` allowlist. |
| `cli/config-file.js` | Schema v2. |
| Contract docs | Canonical amendment for contract §10.7 reason codes and §11 schema v2 (separate). |
| Tests | Specifications in M §12, including owned-process audits based on observed exit status (spike GWV-02 lesson). |

Generators: **no change.**

## 21. Open PO decisions and Security gates

### 21.1 PO decisions

| ID | C5 assumption | Blocks design review? |
|---|---|---|
| PD-R1 | two attempts | No |
| PD-R4 | no completion cap; no new IPC prompt cap | No |
| PD-R7 | generative scope only | No |
| PD-R9 | no real-provider calls; required before production qualification against real endpoints (TQ) | No; blocks production acceptance |
| PO-B (joint with SG-02) | Property B scope: accept it as out of scope for Controlled v1, or open a separate OS-isolation requirement | No for design review; required before implementation authorization |

No other PO decision is needed by C5: AD-03 … AD-07 settle overshoot, cancelled
waits, BUSY, the 300 ms grace and `K_SETTLE`; §9.1 keeps the approved wait meaning.

### 21.2 Security gates (all SECURITY_GATE_OPEN)

| ID | Gate |
|---|---|
| SG-01 | SEC-C1 reconciliation (§13.6): confirm that "no subsequent provider calls" is met by Property A plus the credential-free child, and "the child must terminate" by certified child self-termination plus parent kill and K_SETTLE abandonment. If Security requires Property B or a stronger termination guarantee, C5 is BLOCKED. |
| SG-02 | Property B: NOT PROVIDED. Security and PO decide scope (with PO-B). |
| SG-03 | Credential confinement against a compromised same-user child (§13.5): NOT PROVIDED; accept as residual or require OS isolation. |
| SG-04 | Production HTTPS transport security qualification: TQ-05, TQ-06, TQ-09 and host allowlist TS-9. |

## 22. Superseded C4 material (historical; not normative)

The following C4 content is withdrawn and MUST NOT be implemented. It stays
readable at `38121f95`:

| C4 item | Why withdrawn | C5 replacement |
|---|---|---|
| Child-owned governor, governed `fetchImpl` gate, usage `observer` injected into the child's providers | AD-01; R4-ARCH-03 | Parent Gateway (§3, §8, §11) |
| `redirect: "manual"` with global `fetch`; transport assumption T1 | R4-ARCH-02 (421 → 2 POSTs) | single-send `https` transport (§10) |
| FIFO queue, `P_serial`, union wait accounting | R4-ARCH-01, R4-ARCH-04; AD-06 | BUSY, sum of governor sleeps (§8.5, §9.1) |
| Deadline predicate that admitted a reading equal to the dispatch deadline | AD-04, spike GWV-01 | exclusive predicate (§9.2) |
| `NOT_INVOKED` charge of `Res` after a gate refusal | no separate gate exists | refusals create no entry (§11.5) |
| `K_SETTLE` presented as a proposal awaiting a value | AD-07 approved 10 000 ms | §14.5 |
| Abandonment relying on the child observing `disconnect` before new provider work | R4-ARCH-03 | revocation first; Property A independent of disconnect (§14.4–§14.5) |
| Child clock origin `t0` (payload receipt) for admission and deadline | parent authority | single parent origin `tOpen` (§6.2) |
| Admission counts 36/38/40/39/41/54 and per-stage tables as statements about the governor | model changed | historical only, with assumptions (P §7.2) |

The C4 parts that R4 found RESOLVED_BY_DESIGN are kept in substance: the
`StageContext` E1/E2/E3 paths (§15.1), the usage classes and charge rule (§11),
the provider-specific retry table (§12), the reason-code set (§16), the FT0
receipt/ACK protocol (§14.1), the kill sequence without disconnect and the
abandonment procedure's parent-side steps (§14.4–§14.5).

## 23. Change log

| Rev | Change |
|---|---|
| C3 (`eff78a0c`) | Initial consolidated corrective for R2. |
| C4 (`38121f95`) | Child-owned gate, redirect `manual`, union wait, six-axis exchange record, StageContext, bounded post-kill settlement. REJECTED by R4. |
| C5 | **Replacement.** Parent-owned Provider Gateway (AD-01 … AD-09): credentials, single-send `https` transport, admission, accounting, deadline and revocation in the parent; private validated IPC; BUSY instead of FIFO; wait = cold-start charge + measured governor sleeps; exclusive deadline at a final commit reading; Property A designed, Property B explicitly not provided with Security gates SG-01 … SG-04; FT0 lifecycle unchanged, no successful-exit grace, `K_SETTLE = 10 000 ms` approved; parent-authoritative refusal record; spike-only fields mapped to private or existing outcomes; HTTPS qualification TQ-01 … TQ-10. |
