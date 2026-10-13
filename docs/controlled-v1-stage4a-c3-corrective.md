# Stage 4A Architecture corrective C3

C3 addresses ARCH-S4A-C1-10 and ARCH-S4A-C2-12 on PR #247. It changes no
owner decision, public package export, supported operation, approval gate,
release capability, or Stage 4B behavior.

## Structured #23F binding inventory

The inventory follows the actual error emitters in
`validateGeneratedChangeSet`, `validateApprovedGeneratedChangeSetReview`,
`verifyApprovedChangeBinding`, and the canonical package rebuild in
`applyApprovedGeneratedChangeSet`. Classification uses error code and exact
field path, never error messages. Indexed paths below accept only the named
field at an integer array index.

| Emitter / binding | Structured code | Structured path |
| --- | --- | --- |
| Plan content digest | INVALID_REFERENCE | `$.generatedChangeSet.automationPlanDigest` |
| Context content digest | INVALID_REFERENCE | `$.generatedChangeSet.repositoryContextDigest` |
| Reviewed changeset relationship | INVALID_REFERENCE | `$.generatedChangeSet.changeSetDigest` |
| Changeset self-digest | INVALID_VALUE | `$.generatedChangeSet.changeSetDigest` |
| Canonical GeneratedChangeSet equality (including plan ID, order and closed canonical representation) | INVALID_REFERENCE | `$.generatedChangeSet` |
| Missing required planned change / changes array | MISSING_FIELD | `$.generatedChangeSet.changes` |
| Planned target path relationship | INVALID_REFERENCE | `$.generatedChangeSet.changes[i].path` |
| Planned operation / context base content relationship | INVALID_VALUE | `$.generatedChangeSet.changes[i].operation`, `.baseContentDigest` |
| Context/plan framework relationship | INVALID_VALUE | `$.repositoryContext.framework` |
| Project identity | PROJECT_MISMATCH | `$.repositoryContext.projectId`, `$.generatedChangeSet.projectId`, `$.reviewPackage.projectId`, `$.reviewRecord.projectId` |
| Package self-digest | INVALID_VALUE | `$.reviewPackage.packageDigest` |
| Record self-digest | INVALID_VALUE | `$.reviewRecord.recordDigest` |
| Record/package relationship | INVALID_REFERENCE | `$.reviewRecord.packageDigest` |
| Canonical review package equality (all remaining immutable package fields: plan/context metadata, purpose, before-state, etc.) | INVALID_REFERENCE | `$.reviewPackage` |
| Target count/array relationship | INVALID_REFERENCE | `$.reviewPackage.reviewTargets` |
| Missing target / target fields | INVALID_REFERENCE | `$.reviewPackage.reviewTargets[i]`, `.operation`, `.path`, `.baseContentDigest`, `.proposedContent` |
| Target/content digest recomputation | INVALID_VALUE | `$.reviewPackage.reviewTargets[i].targetDigest` |
| Record decision/target relationship | INVALID_REFERENCE | `$.reviewRecord.decisions` |

All rows map to `APPLY_BINDING_MISMATCH / 4`. Canonical validation can reject
malformed artifacts before reaching a binding-specific error; generic type,
schema, path-safety and invariant errors are not blanket binding mappings.
In particular, live CREATE/MODIFY failures at
`$.generatedChangeSet.changes[i] / INVARIANT_VIOLATION` remain
`APPLY_PRECONDITION_FAILED / 4`. Mutation/compensation outcome handling is
unchanged. Post-reservation refusals still consume the attempt and persist
`REFUSED_NO_WRITE` outcome evidence.

## Manifest capacity

The canonical reader's existing `run-store.MAX_MANIFEST_BYTES` remains
1,048,576 bytes. `serializeManifest` validates shape, serializes using the
existing JSON format into UTF-8 bytes (including the final newline), and
checks this same bound. Review invokes it before durable-store construction,
D-DIR, CS-ENTER, and claim creation. Capacity uses the existing ledger-full
taxonomy `RUN_STATE_INCONSISTENT / 4`.

The stage manifest writer uses the same serialization/check. Direct internal
manifest D-CREATE and D-REPLACE paths also check the bound before opening a
manifest or temporary manifest. No new public exit code or size constant is
introduced. Capacity refusal preserves old bytes and authority evidence,
leaves the ledger slot unused, and creates no quarantine warning/evidence.

## Regression evidence

`scripts/ai/cli/stage4-c3.test.js` exercises every table row through real
#23F validation after a real single-use reservation. It checks reason/exit,
zero target writes, persisted outcome, consumption and retry refusal.
Live MODIFY probes supply canonical MODIFY artifacts at the existing test-only
#23F boundary; the Stage 4 context collector currently supplies no relevant
target files. No production context collection behavior is changed.

The approved V1 operations are CREATE and MODIFY. UPDATE and DELETE are not
supported by AutomationPlan/GeneratedChangeSet v1. UPDATE-like live target
tests use MODIFY (disappeared/changed), and additional probes verify UPDATE
and DELETE substitutions fail closed with zero writes and consumed outcomes.
No DELETE live-mutation capability is introduced to satisfy a test name.

Manifest regressions cover exactly 1,048,576, one byte below, limit+1, the
independent reproduction (1,048,343 -> 1,048,721), real multi-thousand-entry
history, varying record IDs/timestamps/ledger-index widths/decisions, UTF-8,
and the alternate stage/D-CREATE/D-REPLACE paths. Refusal checks assert no
CS-ENTER, claim, record, directory persistence, temp manifest or old-manifest
change, and reader/state preservation.

Release-disabled installed-package, prior C1/C2, durability/crash/power-loss,
#23F, package surface, DC-F02 and AISEC enablement-surface checks remain part
of `npm run test:unit` on the supported Ubuntu / Node 22 CI job. DC-F02 must
continue to report TSB-F02 OPEN / LOW / CONDITIONAL, trigger FALSE. This
mission does not start Security review or authorize merge or Stage 4B.
