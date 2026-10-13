# Controlled-v1 Stage 4B — narrow CLI activation

Authority: `OD-CONTROLLED-V1-STAGE-4B-ACTIVATION — APPROVED`.
Implementation branch: `feature/controlled-v1-stage4b-activation`.
Status: **IMPLEMENTED / NOT MERGED**. The implementation PR records exact-head
CI. This document records implementation scope, not canonical lifecycle closure.
After exact-head CI the next action is independent HEAVY Architecture / Software
Engineering review. Architecture review and Security review are not started;
Security review requires Architecture approval of that exact HEAD. Merge and
Controlled Release are not authorized; OD-06 is not entered.

Certified base main: `e7e1f63541dfa938bf88f15f70fcf1c136ef1d9f`.
Certified base tree: `d8db9fa0c6e8712d52e9cd091f9a9424d3b4275a`.
Fresh baseline CI `38376277924`: push / main / that exact SHA / completed-success.
Preflight found a clean working tree, no later main commit and no competing
implementation lifecycle; this mission is the sole implementation WIP.

## Activation inventory and minimal change

| Graph component | Baseline finding | Stage 4B change |
|---|---|---|
| `policy.js` | immutable reviewRecord/apply release-disabled | enable precisely those two; execute remains disabled; enforcement unchanged |
| `args.js` | review/apply reserved; arguments discarded | real Stage 4 specs, approved `--run`/`--package` grammar, no `--json` or automated decision flags |
| `cli.js` | private routes present but reached only from reserved branch | normal Stage 4 dispatch preserving release gate, config opt-in and Stage 4A streams; existing offline contradiction enforcement |
| config validation | capabilities default false; only booleans admitted; frozen snapshot | unchanged contract; only stale example comment corrected |
| review/apply runtime | full Stage 4A implementation and #23F binding already present | unchanged |
| bin / package files / exports | complete private closure ships in 103-file inventory; 19 root names, five export keys | unchanged; no public JS API or supported deep import added |
| tests | some assertions specifically require release-disabled state | update those expectations and add activation, installed CLI and gate-order evidence |

Both commands still require their own target-owned `qa-agent.config.json`
capability opt-in. Missing/false means `CAPABILITY_NOT_REQUESTED`; true permits
remaining gates. Neither command uses a provider/network. `--offline` is
permitted; the existing explicit-provider contradiction remains refused.
`GITHUB_ACTIONS=true` and truthy `CI` remain policy refusals before run input.

## TSB-F02 activation re-evaluation

The supported-consumer path was independently inspected at activation:

```text
installed qa-agent bin -> cli.run -> commandStage4
  -> validated target capabilities.reviewRecord -> runReviewRecord
     -> v2 builder/validator (gate-free) -> durable review evidence
  -> validated target capabilities.apply -> runApply
     -> v2 record/principal/expiry/subject checks -> durable one-use reservation
     -> applyApprovedGeneratedChangeSet (#23F)
        -> validateApprovedGeneratedChangeSetReview (#23E gate)
        -> verifyApprovedChangeBinding (independent per-target decision check)
        -> canonical package rebuild and live filesystem checks -> mutation
```

Review cannot reach either gate module. The sole production importer of the
change-set gate remains #23F; the test-design gate has no production consumer.
#23F still requires exactly one APPROVE decision for each recomputed target
digest and exact operation/path/content binding before filesystem mutation.
The activated CLI delegates to this unchanged consumer; it neither relies on
the weak gate alone nor reports a gate-derived approval verdict. Execute and
#23G remain absent from the shipped CLI closure and release-disabled.

**TSB-F02 TRIGGER = FALSE** under DC-F02-1..5. The finding remains
**OPEN / LOW / CONDITIONAL**; it is not remediated, re-rated or closed.
Static graph tests check real packed closure and exact gate edges, with injected
bypass tests proving non-vacuity. Activation-layer source checks exclude direct
gate/execute calls and filesystem writes. Existing Stage 4A dynamic regressions
exercise the sole real #23F mutation routine and single-use evidence.

## Verification and preserved boundaries

`stage4b-activation.test.js` verifies immutable release state, approved syntax,
config false/missing/true, CI refusal, offline permission and contradiction.
The external installation suite uses a real tarball, installed npm bin shim,
unchanged inventory, unchanged root/subpath exports and deep-import denial.
Its synthetic terminal harness additionally exercises offline review/apply,
real OS principal/storage, #23F outcome and replay refusal on supported Linux;
Windows retains the existing eligibility refusal. The harness replaces only
terminal streams/input and does not change installed product modules or gates.

Stage 4A interaction, state, principal, path, ledger/capacity, durability,
crash/signal, power-loss and #23F regressions remain required, along with package
surface, DC-F02 and AISEC enablement-surface tests and full Linux Node 22
`npm run test:unit` (zero failed/skipped). Exact-head CI results belong to the
implementation PR evidence; this document does not assert an unrun result.

TAP-2, CRS-1, PPI-1, `derivePackageState`, v2 record/manifest semantics, expiry,
same-principal binding, supersession, one-use apply, D-DIR/D-CREATE/D-REPLACE
and outcome evidence are unchanged. Public programmatic API and exit-code
values are unchanged. R-1..R-5 stay ACCEPTED, AT-07/TB-01 stay RESIDUAL, and
the three FUTURE review guards stay OPEN. No cryptographic authenticity,
physical-human proof or externally authenticated reviewer identity is claimed.
