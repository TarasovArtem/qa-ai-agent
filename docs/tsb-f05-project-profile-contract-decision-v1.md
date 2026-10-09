# TSB-F05 ProjectProfile Contract Decision v1

| Field | Value |
|---|---|
| Decision | `TSB-F05-D1 — Strict Snapshotting ProjectProfile Contract / Pre-Controlled-v1 Public Contract Correction` |
| Authority | `OD-TSB-F05-D1 — APPROVED` |
| Stage | Architecture/design record only |
| Review class | `HEAVY` — independent Architecture + Security exact-head reviews required |
| Governed base | `main` @ `158477fb30fc3ab85f82831fef1eaae068e2997c` |
| Governed base TREE | `fb8b9642b63dafc503320dcc4c69a3b6cfc53e03` |
| Finding | `TSB-F05` / boundary `TSB-018` |
| Compatibility class | `BREAKING PUBLIC API BEHAVIOR CORRECTION` before Controlled v1 |
| Implementation | **NOT AUTHORIZED / NOT IMPLEMENTED** |
| Merge | **NOT AUTHORIZED** |

## 1. Status and decision boundary

This document records the Product Owner-approved architecture direction for
`TSB-F05`. It does not implement the decision, does not change the public API,
does not alter `package.json`, does not revise `ROADMAP.md`, and does not grant
merge, release, remediation, or downstream activation authority.

The governing finding is `TSB-F05`: the current public ProjectProfile validator
is open, unbounded, accessor-permitting, and returns the caller-owned live
object. The Type & Schema Boundary Audit requires a separately governed
compatibility decision before any corrective implementation because
`assertValidProjectProfile` is a supported package export.

The approved design direction is:

```text
TSB-F05-D1: STRICT SNAPSHOTTING PROJECTPROFILE CONTRACT
```

The future ProjectProfile trust boundary shall accept only a strict, closed,
bounded, accessor-safe plain-data contract and shall return a detached,
deep-frozen authoritative snapshot. Every consumer that crosses this boundary
shall use only that snapshot after validation.

## 2. Why TSB-F05 is applicable to Controlled v1

`docs/package-surface-v2.md` defines the current supported root package API and
includes all of the following names:

- `assertValidProjectProfile`;
- `collectContext`;
- `collectHistory`;
- `analyzeFailure`.

The same package-surface record defines those exports as a compatibility
commitment and separately classifies `scripts/ai/test-automation/**` as
repository-only private code.

Therefore ProjectProfile is already part of the supported external surface
independently of future #23 productization. The existing external-install proof
also supplies a consumer-owned profile to the installed package through these
public entry points.

The Controlled-v1 disposition is therefore:

```text
CONTROLLED_V1_APPLICABILITY: REQUIRED under the current approved public surface
```

If a later Product Owner decision deliberately removes every ProjectProfile-
consuming capability from the supported Controlled-v1 surface, applicability
may be reconsidered. This design record does not make such a change.

## 3. Current contract and confirmed weakness

At the governed baseline, `scripts/ai/project-profile.js` performs only basic
presence/type checks:

- `id` is a non-empty string;
- `displayName` is a non-empty string;
- `knownProjectConstraints` is a non-empty array of non-empty strings.

The current validator does not establish:

- a plain-data object boundary;
- closed top-level keys;
- own-property semantics;
- enumerable data-descriptor semantics;
- accessor rejection;
- symbol-key rejection;
- string-length bounds;
- constraint-count bounds;
- aggregate-size bounds;
- control-character rejection;
- a detached authoritative snapshot.

`assertValidProjectProfile()` currently returns the original caller object, and
existing tests explicitly assert same-object return identity.

The audit probe `P-05` demonstrated that the current contract accepts:

- unknown keys;
- control characters;
- a 100,000-character `displayName`;
- accessor-backed values that can change after validation;
- the caller's live object as the post-validation object.

This is a trust-boundary TOCTOU problem even when the caller is normally an
operator: the object validated is not guaranteed to be the object later used.
ProjectProfile content also enters high-authority prompt guidance.

## 4. Threat and trust model

### 4.1 Input authority

ProjectProfile is operator-/consumer-supplied configuration. It is not treated
as hostile remote model output, but it crosses a public package trust boundary
and can influence:

- project identity;
- prompt/system-guidance text;
- history/config identity checks;
- repository-context projections;
- target-specific runtime behavior.

The correct model is therefore:

```text
caller-owned value -> untrusted structural input -> strict validation/snapshot
                  -> trusted immutable ProjectProfile snapshot
```

Validation must not execute caller-provided code. A getter, proxy-like accessor
pattern, inherited property, or mutable object must not be able to change what
a consumer observes after the trust boundary has accepted the input.

### 4.2 Security objective

The boundary must guarantee that, after successful assertion:

1. the ProjectProfile has exactly the approved v1 shape;
2. every consumed value came from an own enumerable data property inspected
   without invoking an accessor;
3. all strings/counts/aggregate content are finite and bounded;
4. the value used by downstream consumers is detached from caller mutation;
5. downstream consumers cannot accidentally re-open TOCTOU by re-reading the
   original object.

### 4.3 Non-goals

This decision does not authenticate the caller, repository, or project.
It does not prove that a profile belongs to a particular repository root or
persisted context. Those authenticity/binding concerns remain separate
findings/design work (including `SADR-01` / `XI-01` where applicable).

## 5. Exact ProjectProfile v1 data contract

A valid future ProjectProfile v1 is exactly:

```js
{
  id: string,
  displayName: string,
  knownProjectConstraints: string[]
}
```

No fourth field is accepted by v1.

### 5.1 Top-level object rules

The input must:

- be non-null and of type object;
- not be an Array;
- have prototype exactly `Object.prototype` or `null`;
- contain exactly the three string-named keys:
  - `id`;
  - `displayName`;
  - `knownProjectConstraints`;
- contain no unknown string key;
- contain no symbol key;
- expose each required field as an own property;
- expose each required field as enumerable;
- expose each required field as a data descriptor with a `value`;
- reject accessors (`get` / `set`) without invoking them;
- reject inherited substitutes for any required field.

The validator shall inspect property descriptors directly. It must not first
read `profile.id`, `profile.displayName`, or `profile.knownProjectConstraints`
from the caller object and then attempt to classify the property afterward.

### 5.2 String rules

All ProjectProfile strings must:

- be JavaScript strings;
- contain at least one non-whitespace character;
- not exceed the field-specific maximum below;
- contain no C0 control character (`U+0000`..`U+001F`);
- contain no DEL (`U+007F`).

Validation must not mutate accepted string content. In particular, the
snapshot preserves the original accepted string; validation may use
`trim().length > 0` only to reject blank strings. This decision does not add
Unicode normalization, case folding, or implicit trimming.

### 5.3 Approved bounds

| Field | Approved maximum / range |
|---|---:|
| `id` | 128 characters |
| `displayName` | 256 characters |
| `knownProjectConstraints` count | 1..32 entries |
| one constraint | 2048 characters |
| aggregate constraint characters | 8192 characters |

These limits are architecture values and are part of the reviewed D1 contract.
Changing them after review changes the reviewed design and requires explicit
disposition under the normal exact-head lifecycle.

### 5.4 Repository measurements supporting the bounds

The two concrete target-owned profiles present at the governed baseline are
well below the proposed ceilings:

| Profile | `id` chars | `displayName` chars | constraints | longest constraint | aggregate constraint chars |
|---|---:|---:|---:|---:|---:|
| Targomo (`scripts/targets/targomo/project-profile.js`) | 16 | 67 | 2 | 519 | 764 |
| Project B (`scripts/targets/project-b/project-profile.js`) | 26 | 91 | 1 | 235 | 235 |

The largest observed values therefore have substantial headroom under D1:

- `id`: 26 observed vs 128 allowed;
- `displayName`: 91 observed vs 256 allowed;
- constraint count: 2 observed vs 32 allowed;
- individual constraint: 519 observed vs 2048 allowed;
- aggregate constraints: 764 observed vs 8192 allowed.

These measurements justify the proposed bounds for current known consumers
without claiming that future schema expansion is automatically authorized.
A future need to exceed the D1 contract must be handled as an explicit public
contract revision.

## 6. `knownProjectConstraints` array contract

`knownProjectConstraints` is itself part of the trust boundary.

It must:

- be a real Array;
- contain between 1 and 32 entries inclusive;
- be dense for indexes `0..length-1`;
- have every indexed element as an own enumerable data property;
- contain no accessor-backed indexed element;
- contain no holes;
- contain only valid constraint strings under §5.2 and the 2048-character
  per-entry bound;
- remain within the 8192-character aggregate bound;
- contain no additional enumerable non-index string property;
- contain no symbol property supplied as contract data.

Array order is preserved because constraint ordering is meaningful prompt
presentation state. Duplicate constraint strings are not forbidden by D1;
there is no evidence that deduplication is part of the current public contract,
and adding that semantic restriction is unnecessary to close TSB-F05.

## 7. Single-read inspection semantics

A valid design must not implement this pattern:

```text
validate caller object
  -> success
re-read caller object to build snapshot
```

That would preserve the accessor/mutation TOCTOU window.

Instead, the implementation shall have one internal inspection operation that:

1. establishes plain-object shape;
2. enumerates/certifies the exact allowed key set;
3. obtains own property descriptors without invoking getters;
4. captures the descriptor `value` once for each accepted field;
5. validates captured primitive/string values;
6. performs an equivalent descriptor-safe inspection of the constraints
   array and each indexed element;
7. constructs a new canonical plain object and a new constraints array from
   only the captured values;
8. freezes the constraints array;
9. freezes the top-level snapshot;
10. returns validation errors or the authoritative snapshot.

Both public validation helpers must derive their decision from this same
inspection primitive so that validation and assertion cannot drift into two
contracts.

## 8. Snapshot and freeze semantics

On successful assertion, the authoritative ProjectProfile must be:

- newly allocated;
- detached from the caller's top-level object;
- detached from the caller's constraints array;
- composed only of the three approved fields;
- composed only of primitive strings plus the newly allocated constraints
  array;
- deeply frozen for the full v1 object graph;
- stable for the remainder of the consumer operation regardless of later
  mutation of caller-owned values.

For ProjectProfile v1, deep freeze means at minimum:

```text
Object.isFrozen(snapshot) === true
Object.isFrozen(snapshot.knownProjectConstraints) === true
```

Strings require no additional freeze operation.

The canonical snapshot does not preserve caller prototype, property
descriptors, getters/setters, non-enumerability, unknown fields, symbol fields,
or object identity.

## 9. Public validator/assert behavior

### 9.1 `validateProjectProfile(profile)`

The supported validation behavior remains non-throwing for ordinary invalid
inputs and returns the existing high-level result shape:

```js
{ valid: boolean, errors: string[] }
```

Its implementation shall derive that result from the same descriptor-safe
inspection primitive used by assertion.

Diagnostics must themselves remain bounded and deterministic. Unknown-key
reporting must not echo arbitrarily large caller-controlled keys without a
bound. The implementation should follow the already-established
FrameworkRuntimeConfig / ProjectKnowledgeConfig validation discipline rather
than introduce unbounded diagnostics.

`validateProjectProfile()` does not make the caller object authoritative and
must not be used as a substitute for obtaining the snapshot at a trust
boundary.

### 9.2 `assertValidProjectProfile(profile, callerLabel)`

The existing supported symbol and call signature are retained.

Future success semantics change intentionally from:

```text
return caller-owned profile
```

to:

```text
return authoritative detached deep-frozen ProjectProfile snapshot
```

Required/malformed failures retain stable error-prefix semantics:

```text
PROJECT_PROFILE_REQUIRED
PROJECT_PROFILE_INVALID
```

Error detail must remain bounded and must not invoke caller accessors.

### 9.3 Intentional identity break

The current test contract:

```js
assertValidProjectProfile(profile, label) === profile
```

shall become false for a valid caller-owned profile.

This is deliberate and is the central compatibility-breaking behavior of D1.
It is not to be hidden as an incidental implementation detail.

## 10. Mandatory consumer rule

Any consumer that receives a ProjectProfile across this boundary must use this
pattern:

```js
const validatedProfile = assertValidProjectProfile(inputProfile, callerLabel);

// From here onward use only validatedProfile.
```

After the assertion returns, the original input object is no longer an
authoritative source and must not be read again by that consumer.

This applies transitively to values passed to downstream helper functions:
pass the snapshot, not the caller object.

A future implementation review must reject code of the form:

```js
assertValidProjectProfile(inputProfile, callerLabel);
use(inputProfile.id); // forbidden: reopens the trust boundary
```

## 11. Known producer and consumer inventory

### 11.1 Concrete producers

Current target-owned concrete profiles include:

- `scripts/targets/targomo/project-profile.js`;
- `scripts/targets/project-b/project-profile.js`;
- synthetic profiles used by unit/external-install tests.

The Targomo and Project B production/synthetic target constants already use
frozen data objects/arrays and satisfy the proposed D1 numeric bounds.
Their existing freeze practice is helpful producer hygiene but is not accepted
as a substitute for consumer-side validation/snapshotting.

### 11.2 Current/public consumers to migrate

Future implementation investigation must include at least:

- `scripts/ai/qa-agent-prompt.js`;
- `scripts/ai/collect-context.js`;
- `scripts/ai/collect-history.js`;
- `scripts/ai/analyze-failure.js`;
- public root wiring in `scripts/ai/index.js` as a compatibility verification
  surface, without adding a new export.

The implementation must trace every use of the original object after
assertion, including helper calls that later read `id`, `displayName`, or
`knownProjectConstraints`.

### 11.3 Repository-private consumer

The audit additionally identifies
`scripts/ai/test-automation/automation-repository-context.js` as a #23
consumer/projection path. It is repository-private under Package Surface v2,
but if ProjectProfile reaches that path in the future Controlled-v1 chain, it
must consume the same authoritative D1 snapshot and may not create a divergent
second contract.

The final implementation scope must be established by repository-wide search
at implementation baseline; this design document is a minimum inventory, not
permission to silently omit a discovered consumer.

## 12. Compatibility decision

D1 classifies the change as:

```text
BREAKING PUBLIC API BEHAVIOR CORRECTION
```

There are two breaking aspects:

1. the accepted input domain becomes narrower because formerly accepted
   unknown fields, accessors, inherited/non-enumerable fields, control
   characters, and oversized values will fail;
2. successful `assertValidProjectProfile()` no longer preserves caller object
   identity.

This change is approved as a governed pre-Controlled-v1 contract correction,
not as a silent backwards-compatible bug fix.

## 13. Rejected compatibility strategies

### 13.1 Silent in-place hardening without versioned contract record — rejected

It would technically close the security weakness but would conceal a breaking
change to a declared supported public API.

### 13.2 New strict public validator while retaining the weak public validator — rejected

It would create two competing ProjectProfile contracts and leave the weak
contract supported. TSB-F05 would remain architecturally ambiguous.

### 13.3 Deprecation bridge retaining weak behavior — rejected

Controlled v1 has not yet been formally released under ID-3. Carrying a known
weak trust-boundary behavior into the first release solely to preserve a
pre-release behavior is not justified by repository evidence and would leave
F05 open.

### 13.4 Premature semver-major release workflow — rejected for this stage

The repository deliberately separates proven installability from formal
release maturity. ID-3 still owns formal version policy, production release
tags, npm-registry publication decisions, install guidance,
rollback/version lifecycle, CLI/convenience surface, and reusable CI
integration. D1 must not invent that unimplemented lifecycle.

## 14. Versioning, deprecation, and migration strategy

### 14.1 Public symbol strategy

Keep the existing public symbol:

```text
assertValidProjectProfile
```

Do not add `assertValidProjectProfileV2`, `assertStrictProjectProfile`, or any
parallel public validator merely to retain the weak contract.

### 14.2 Package Surface v3

A future D1 implementation is expected to require a new versioned contract
record:

```text
docs/package-surface-v3.md
```

Package Surface v3 shall:

- supersede Package Surface v2 for the behavior being revised;
- preserve the existing root export-name set unless separately authorized;
- preserve existing explicit `package.json` export keys unless separately
  authorized;
- explicitly record the stricter ProjectProfile accepted-input domain;
- explicitly record authoritative-snapshot return semantics;
- state that this is a breaking pre-Controlled-v1 behavior correction;
- preserve the private classification of #22/#23 implementation unless a
  separate productization decision changes it.

This architecture decision does not itself authorize creating v3 or changing
Package Surface v2.

### 14.3 Consumer migration

Known external consumers must migrate by:

- providing only the three supported keys;
- using ordinary data properties;
- staying within D1 bounds;
- not relying on post-validation mutation being visible;
- not relying on `assertValidProjectProfile(profile) === profile`.

Typical plain JSON/object-literal profiles remain source-compatible if they do
not use extra fields or exceed bounds; their return-identity behavior still
changes.

## 15. Compatibility matrix

| Existing/future caller behavior | D1 disposition |
|---|---|
| Plain object literal with exactly three valid fields | ACCEPT |
| `Object.create(null)` record with valid own enumerable data fields | ACCEPT |
| Frozen Targomo profile | ACCEPT |
| Frozen Project B profile | ACCEPT |
| JSON serialize/deserialize round-trip of valid profile | ACCEPT |
| Unknown top-level string key | REJECT / migration required |
| Symbol key on top-level profile | REJECT |
| Class instance | REJECT |
| Required field inherited from prototype | REJECT |
| Required field non-enumerable | REJECT |
| Required field implemented as getter/setter | REJECT without invoking accessor |
| Accessor-backed constraint element | REJECT without invoking accessor |
| Sparse constraints array | REJECT |
| Extra enumerable array property / symbol contract data | REJECT |
| C0/DEL in any profile string | REJECT |
| Over-limit string/count/aggregate | REJECT |
| Mutate caller object after successful assertion | no effect on snapshot |
| Mutate caller constraints array after successful assertion | no effect on snapshot |
| Rely on returned object identity | BREAKING / migration required |
| Add a future fourth ProjectProfile field | REJECT until a governed contract revision |

## 16. Interaction with Package Surface v2

Package Surface v2 remains the current canonical package-surface record until
a separately authorized and reviewed replacement lands.

D1 does not change its current facts:

- root package entry point has 19 supported names;
- `assertValidProjectProfile` is one of them;
- supported subpath export keys remain unchanged;
- `scripts/ai/test-automation/**` remains repository-only private;
- deep imports remain unsupported;
- physical distribution remains governed by `package.json` `files` and the
  package-surface closure/minimality tests.

The future D1 implementation should preserve those name/path boundaries and
change ProjectProfile behavior deliberately through Package Surface v3 rather
than accidentally through package-export expansion.

## 17. Exact boundary with unfinished ID-3 productization

D1 decides the ProjectProfile data/security/public-behavior contract.
It does **not** decide formal product release mechanics.

ID-3 remains responsible for:

- formal package version policy;
- production release tags;
- npm-registry publication decision;
- consumer install guidance;
- rollback/version lifecycle;
- CLI/convenience surface;
- reusable CI integration.

Consequently, future D1 implementation must not change `package.json` version,
create release tags, publish to npm, or invent a semver-major release without a
separate ID-3/productization authority.

D1 may be implemented before ID-3 because the purpose is to ensure the public
contract entering Controlled v1 is already the intended strict contract.

## 18. Future implementation scope

No implementation is authorized by this document. Subject to a future Product
Owner implementation grant, the expected minimum production scope is:

```text
scripts/ai/project-profile.js
scripts/ai/qa-agent-prompt.js
scripts/ai/collect-context.js
scripts/ai/collect-history.js
scripts/ai/analyze-failure.js
scripts/ai/test-automation/automation-repository-context.js
```

Implementation may touch another ProjectProfile consumer only when repository
evidence shows it is necessary to apply the same approved D1 contract. Any
broader public API, unrelated refactor, new feature, unrelated finding, or
package-export change requires separate authority.

Expected test/documentation scope for a future corrective includes:

```text
scripts/ai/project-profile.test.js
consumer-specific ProjectProfile tests
scripts/targets/targomo/project-profile.test.js
scripts/targets/project-b/project-profile.test.js
test/installation/external-repository-proof.test.js
package/public-boundary compatibility tests where required
docs/package-surface-v3.md
```

Exact filenames remain subject to implementation-baseline verification.

## 19. Future regression and adversarial test requirements

A future TSB-F05 implementation must prove at least the following.

### 19.1 Happy-path contract

- normal valid profile accepted;
- null-prototype valid data object accepted;
- Targomo profile accepted;
- Project B profile accepted;
- external-installed package path accepts a valid external consumer profile;
- returned snapshot has exact three-key shape;
- returned snapshot preserves accepted string bytes/content and constraint
  order;
- snapshot and constraints array are frozen;
- snapshot is not the caller object;
- snapshot constraints array is not the caller array.

### 19.2 Closed-schema negatives

Reject:

- unknown top-level key;
- symbol top-level key;
- missing key;
- class instance/custom prototype;
- inherited required property;
- non-enumerable required property;
- accessor-backed required field;
- setter-only property;
- malformed constraints type;
- empty constraints array;
- sparse constraints array;
- accessor-backed indexed element;
- extra array property/symbol data where contract rules forbid it.

### 19.3 Bound negatives

Reject:

- blank `id` / `displayName` / constraint;
- `id` length 129;
- `displayName` length 257;
- 33 constraints;
- one constraint length 2049;
- aggregate constraint characters 8193;
- C0 controls and DEL in each field class.

Boundary tests must also accept the exact maximum valid values.

### 19.4 Accessor/TOCTOU adversarial tests

- getter on any required field is never invoked;
- throwing getter is rejected without getter execution;
- getter that would return `safe` then `evil` cannot influence validation or
  downstream use;
- mutating the top-level caller object after assertion does not alter snapshot;
- mutating/replacing caller constraints after assertion does not alter snapshot;
- a consumer cannot pass validation and then use the original caller object;
- downstream prompt/context output is derived from the snapshot.

### 19.5 Consumer migration tests

For each ProjectProfile-consuming entry point:

- assert the returned snapshot is assigned and used;
- prove post-validation caller mutation cannot change later output;
- prove unknown/oversized/accessor input fails before downstream side effects;
- preserve established behavior for valid existing Targomo/Project B inputs.

### 19.6 Public/external compatibility proof

The real external-install proof must cover the revised behavior through bare
`require("qa-ai-agent")`, not a source-checkout deep import. It must prove:

- public export names remain expected;
- valid external profile succeeds;
- invalid extra/accessor/oversized profile fails through the supported API;
- private deep-import rules remain unchanged.

## 20. Error and fail-closed requirements

The future boundary must fail before any ProjectProfile-derived prompt,
context, history request, report, filesystem action, or other downstream side
effect when the profile is invalid.

Validation/assertion must not:

- invoke accessors;
- serialize the hostile/caller object for diagnostics;
- emit unbounded unknown-key/error text;
- silently drop unknown fields and continue;
- silently trim/normalize caller strings into a different identity;
- fabricate defaults for a missing required profile;
- fall back to the old weak contract.

Existing public error prefixes should remain stable unless a separately
reviewed compatibility need requires otherwise.

## 21. Preserved unrelated findings and boundaries

D1 is intentionally narrow. It does not close, waive, absorb, re-rate, or
risk-accept other findings, including but not limited to:

- `TSB-F02` — approval gate contract;
- `TSB-F04` — triage result/output binding and schema;
- `TSB-F06` / `ADV-01` — remote response/body-size/time bounds;
- `TSB-F07` — persisted context consumption schema;
- `XI-01` / `XI-02` — existing context provenance/shape debt;
- `SADR-01` — authentic profile/repository/context binding where applicable;
- `TB-01` / `AT-07` — approval/reviewer authenticity;
- `TB-09` — caller-trusted repository root;
- any generated-code isolation, process-survival, Windows alias/path, or
  unrelated package/productization debt.

A strict ProjectProfile snapshot may become a prerequisite for later authentic
profile↔root↔context joining, but it does not itself provide that binding.

## 22. Review requirements

This design record requires two independent exact-head reviews:

1. `HEAVY Architecture`;
2. `HEAVY Security`.

Each review must bind to the exact:

- PR number;
- HEAD commit SHA;
- TREE SHA;
- CI evidence for that exact HEAD.

A new HEAD invalidates both reviews.

Architecture review must verify at minimum:

- coherent public-contract semantics;
- exact schema and bounds;
- single-read inspection design;
- authoritative snapshot rule;
- compatibility classification;
- Package Surface v2/v3 transition;
- ID-3 separation;
- complete consumer inventory methodology;
- no accidental public surface expansion.

Security review must verify at minimum:

- accessor non-execution;
- own-data semantics;
- TOCTOU closure;
- bounded strings/counts/diagnostics;
- fail-closed behavior;
- prompt/context authority implications;
- adversarial test adequacy;
- preservation of unrelated finding boundaries.

## 23. STOP conditions for future implementation

A future implementation mission must STOP and return to Product Owner if any
of the following is discovered:

- current `main` differs from the separately authorized implementation
  baseline;
- D1 cannot be implemented without adding/removing/renaming a supported root
  export or subpath;
- a required public migration would need a second public validator or weak
  compatibility bridge;
- Package Surface v3 would require changing `package.json` version/export keys
  beyond separately authorized scope;
- current real target profiles do not fit the approved bounds;
- repository search finds a consumer whose required semantics conflict with
  the authoritative-snapshot rule;
- implementing D1 would require changing ProjectProfile field meaning or
  adding a fourth field;
- ID-3 release/version policy must be decided to proceed safely;
- an unrelated finding must be fixed to make the tests pass;
- the implementation would broaden into `TSB-F02`, `F04`, `F06`, `F07`,
  `XI-*`, `SADR-*`, or another non-D1 corrective without separate authority.

No implementation agent may resolve such a conflict by silently weakening D1
or broadening scope.

## 24. Lifecycle boundary

At the time this record is authored:

```text
TSB-F01 + TSB-F03: CANONICALLY CLOSED
TSB-F05 preflight: COMPLETE
TSB-F05-D1 architecture direction: PRODUCT OWNER APPROVED
TSB-F05-D1 design record: this document / review pending
TSB-F05 implementation: NOT AUTHORIZED / NOT STARTED
Controlled Release: NOT APPROVED
MEM/RAG/LEARN: NOT ACTIVATED
```

Successful review/merge of this design record would still not remediate
TSB-F05. The finding can close only after a separately authorized corrective
implementation is independently reviewed, merged, post-merge certified, and
canonically closed under the repository lifecycle.

## 25. Decision summary

```text
DECISION:
  Keep the existing ProjectProfile v1 field model:
    id
    displayName
    knownProjectConstraints

  Replace the weak live-object trust boundary with a strict closed,
  bounded, descriptor-safe, single-read snapshotting contract.

  Keep assertValidProjectProfile as the public symbol.
  Change its success return semantics to a detached deep-frozen snapshot.
  Require all consumers to use only that snapshot after the boundary.

  Treat this as an explicit BREAKING PUBLIC API BEHAVIOR CORRECTION
  before Controlled v1.

  Do not create a parallel weak/strict public validator pair.
  Do not create a deprecation bridge preserving the weak behavior.
  Record the eventual behavior change in Package Surface v3.
  Leave formal semver/publication/release mechanics to ID-3.

  No implementation, merge, release, or downstream activation is granted
  by this design record.
```
