# TSB-F05 ProjectProfile Contract Decision v1

| Field | Value |
|---|---|
| Decision | `TSB-F05-D1 — Strict Snapshotting ProjectProfile Contract / Pre-Controlled-v1 Public Contract Correction` |
| Corrective | `TSB-F05-D1-C1 — consolidated design corrective after HEAVY Architecture review` |
| Authorities | `OD-TSB-F05-D1 — APPROVED`; `OD-TSB-F05-D1-C1 — APPROVED` |
| Stage | Architecture/design record only |
| Review class | `HEAVY` — independent Architecture + Security exact-head reviews required |
| Governed base | `main` @ `158477fb30fc3ab85f82831fef1eaae068e2997c` |
| Governed base TREE | `fb8b9642b63dafc503320dcc4c69a3b6cfc53e03` |
| Previous reviewed HEAD | `8dd5f7eaec0768f6d996f0c57e8265e3714e59e0` — Architecture `CHANGES_REQUIRED` |
| Finding | `TSB-F05` / boundary `TSB-018` |
| Compatibility class | `BREAKING PUBLIC API BEHAVIOR CORRECTION` before Controlled v1 |
| Implementation | **NOT AUTHORIZED / NOT IMPLEMENTED** |
| Merge | **NOT AUTHORIZED** |

## 1. Status, review history, and decision boundary

This document records the Product Owner-approved architecture direction for
`TSB-F05` and the authorized C1 correction of the first independent HEAVY
Architecture review findings. It does not implement the decision, change the
runtime public API, alter `package.json`, revise `ROADMAP.md`, or grant merge,
release, remediation, or downstream activation authority.

The first Architecture review of HEAD `8dd5f7eaec0768f6d996f0c57e8265e3714e59e0`
returned `CHANGES_REQUIRED` with:

- `MAJOR-1` — Proxy handling undefined;
- `MAJOR-2` — ProjectProfile-shaped #22 consumers omitted from the closure scope;
- `MINOR-1` — `validateProjectProfile` described as public/supported when it is not a root package export;
- `MINOR-2` — no defined non-throwing central snapshot result for private consumers;
- `MINOR-3` — Array mechanics and the unit of string bounds under-specified;
- `MINOR-4` — adversarial/regression matrix incomplete;
- three INFO observations preserved below.

C1 resolves those design gaps without changing the approved D1 field model,
numeric bounds, breaking-compatibility classification, no-weak-bridge decision,
Package Surface v3 direction, ID-3 separation, or Controlled-v1 applicability.

The governing finding remains `TSB-F05`: the current ProjectProfile validator is
open, unbounded, accessor-permitting, and returns the caller-owned live object.
`assertValidProjectProfile` is a supported package root export, so tightening
its accepted input domain and return identity requires the separately governed
compatibility decision recorded here.

The approved direction remains:

```text
TSB-F05-D1: STRICT SNAPSHOTTING PROJECTPROFILE CONTRACT
```

The future trust boundary accepts only the strict v1 data contract defined
below and returns/propagates a detached, immutable authoritative snapshot. No
consumer, whether public-facing or repository-private, may establish a second
weaker ProjectProfile contract.

## 2. Why TSB-F05 is applicable to Controlled v1

`docs/package-surface-v2.md` defines the supported root package API and includes:

- `assertValidProjectProfile`;
- `collectContext`;
- `collectHistory`;
- `analyzeFailure`.

Those names are compatibility commitments. The external-install proof supplies
a consumer-owned profile through installed package entry points. Therefore the
finding is already relevant to the supported external surface independently of
private #22/#23 implementation.

```text
CONTROLLED_V1_APPLICABILITY: REQUIRED under the current approved public surface
```

Private #22/#23 consumers are included in F05 implementation scope because they
also consume values semantically treated as ProjectProfile guidance. Their
inclusion does **not** make those modules public package APIs.

## 3. Current contract and confirmed weakness

At the governed baseline, `scripts/ai/project-profile.js` performs basic
presence/type checks only:

- `id` is a non-empty string;
- `displayName` is a non-empty string;
- `knownProjectConstraints` is a non-empty array of non-empty strings.

The current boundary does not establish:

- a closed plain-data object;
- own/enumerable data-descriptor semantics;
- accessor or Proxy rejection;
- symbol-key rejection;
- finite string/count/aggregate bounds;
- control-character rejection;
- a detached authoritative snapshot.

`assertValidProjectProfile()` currently returns the original caller object and
existing tests explicitly assert same-object return identity.

Audit probe `P-05` established that unknown keys, control characters, a
100,000-character `displayName`, changing accessors, and the live caller object
are accepted. This creates validate/use divergence and lets unbounded guidance
enter prompt/context authority.

## 4. Threat and trust model

### 4.1 Input authority

ProjectProfile is operator-/consumer-supplied configuration. It is not remote
model output, but it crosses a public/package trust boundary and may influence:

- project identity;
- system/generation prompt guidance;
- history/config identity checks;
- repository-context projections;
- target-specific behavior.

The trust transition is:

```text
caller-owned value
  -> untrusted structural input
  -> strict Proxy rejection + descriptor-safe inspection
  -> validated detached ProjectProfile snapshot
  -> trusted immutable guidance value
```

### 4.2 Explicit Proxy policy — C1-MAJOR-1

D1-C1 chooses a single fail-closed policy:

**Proxy objects are not valid ProjectProfile v1 data.**

Required behavior:

- a top-level ProjectProfile Proxy is rejected;
- a Proxy wrapping `knownProjectConstraints` is rejected;
- a revoked Proxy is rejected;
- Proxy detection occurs before `Object.getPrototypeOf`, `Reflect.ownKeys`,
  `Object.getOwnPropertyDescriptor`, array-length inspection, or any other
  operation that could invoke Proxy traps;
- an implementation may use Node 22 `util.types.isProxy()` or an equivalent
  deterministic runtime primitive that does not invoke user traps;
- failure/exception in the inspection boundary becomes a bounded,
  deterministic invalid result; no raw caller exception/stack becomes a
  validation diagnostic;
- successful validation never depends on executing Proxy traps.

The design does **not** claim that arbitrary JavaScript Proxy structure can be
inspected safely without executing caller code. Instead, accepted inputs are
non-Proxy plain data, which lets the subsequent descriptor inspection guarantee
that no getter/setter or Proxy trap is executed for an accepted profile.

### 4.3 Security objective

After successful trust escalation:

1. the profile has exactly the approved v1 semantic shape;
2. every field came from an own enumerable data descriptor;
3. no getter/setter or Proxy trap was executed to obtain accepted values;
4. strings/counts/aggregate content are bounded;
5. the consumed value is detached from caller mutation;
6. downstream consumers use only that authoritative snapshot/projection.

### 4.4 Non-goals

D1 does not authenticate the caller, repository, repository root, or persisted
context, and does not prove that a profile belongs to a specific repository.
`SADR-01`, `XI-01`, and related identity/provenance work remain separate.

## 5. Exact ProjectProfile v1 data contract

A valid profile has exactly these semantic fields:

```js
{
  id: string,
  displayName: string,
  knownProjectConstraints: string[]
}
```

No fourth semantic field is accepted by v1.

### 5.1 Top-level object rules

Before prototype/key/descriptor inspection, the implementation must establish
that the value is not a Proxy.

A valid top-level input then must:

- be non-null and of type object;
- not be an Array;
- have prototype exactly `Object.prototype` or `null`;
- contain exactly the three own string keys `id`, `displayName`, and
  `knownProjectConstraints`;
- contain no unknown own string key, enumerable or non-enumerable;
- contain no own symbol key;
- expose every required field as an own enumerable data descriptor;
- reject getter/setter descriptors without invoking them;
- reject inherited substitutes for required fields;
- reject class/custom-prototype instances.

The inspection captures `descriptor.value` and never later re-reads
`input.id`, `input.displayName`, or `input.knownProjectConstraints` from the
caller object.

Frozen and sealed ordinary objects remain valid when their data shape satisfies
the contract. A valid `Object.create(null)` record is accepted and canonicalized
into the same trusted snapshot representation as an ordinary object literal.

### 5.2 String rules

All ProjectProfile strings must:

- be JavaScript strings;
- contain at least one non-whitespace character;
- satisfy the field-specific bound below;
- contain no C0 control character `U+0000..U+001F`;
- contain no DEL `U+007F`.

The unit of every D1 string bound is **JavaScript UTF-16 code units**, matching
`String.length` and the repository's existing JavaScript validator conventions.

Validation does not mutate accepted content. `trim()` may be used only to test
blankness. Accepted strings are not trimmed, normalized, case-folded, or
rewritten in the snapshot.

C1 does not broaden the approved C0+DEL policy. Bidi controls, other Unicode
format characters, and lone surrogates remain explicit Security-review input
(Architecture INFO-1).

### 5.3 Approved bounds — unchanged by C1

| Field | Approved maximum / range |
|---|---:|
| `id` | 128 UTF-16 code units |
| `displayName` | 256 UTF-16 code units |
| `knownProjectConstraints` count | 1..32 entries |
| one constraint | 2048 UTF-16 code units |
| aggregate constraint content | 8192 UTF-16 code units |

Changing these architecture values after exact-head review changes the reviewed
design and requires explicit disposition.

### 5.4 Repository measurements supporting the bounds

| Profile | `id` | `displayName` | constraints | longest constraint | aggregate constraints |
|---|---:|---:|---:|---:|---:|
| Targomo | 16 | 67 | 2 | 519 | 764 |
| Project B | 26 | 91 | 1 | 235 | 235 |

The approved ceilings retain substantial headroom while preventing the
unbounded P-05 behavior.

## 6. Exact `knownProjectConstraints` Array contract — C1-MINOR-3

After capturing the top-level data descriptor value, the boundary must first
reject it if it is a Proxy. A valid constraints value then must:

- be an actual Array;
- have prototype exactly `Array.prototype` — Array subclasses/custom Array
  prototypes are rejected;
- have `length` in `1..32`, checked **before** iterating indexes;
- contain every canonical index `0..length-1` as an own enumerable data
  descriptor;
- contain no hole;
- contain no accessor-backed indexed element;
- rely on no inherited indexed element;
- contain no extra own string property other than canonical indexes and the
  intrinsic `length` property;
- contain no own symbol key;
- contain only strings satisfying §5.2 and the 2048-unit per-entry maximum;
- remain within the 8192-unit aggregate maximum.

The implementation must use descriptor values for indexed elements and must not
call caller-provided array methods. Array order is preserved. Duplicate strings
remain allowed because uniqueness is not required to close TSB-F05.

A huge/sparse `length` cannot trigger a long scan: the count bound is checked
before index iteration.

## 7. Central inspection and single-read semantics — C1-MAJOR-1/C1-MINOR-2

There shall be one central repository-internal inspection primitive in
`scripts/ai/project-profile.js`, conceptually:

```js
inspectProjectProfile(input)
```

Exact private naming is not a public contract, but its semantics are.

Success is equivalent to:

```js
{
  valid: true,
  errors: [],
  snapshot: <authoritative deep-frozen ProjectProfile>
}
```

Failure is equivalent to:

```js
{
  valid: false,
  errors: [<bounded deterministic diagnostic>, ...]
}
```

The primitive must:

1. perform Proxy rejection before trap-capable structural operations;
2. establish non-Proxy plain-record shape;
3. enumerate the exact key set and reject unknown/non-enumerable extras;
4. obtain own property descriptors without invoking getters;
5. capture each required descriptor value once;
6. validate captured `id` and `displayName`;
7. reject a Proxy constraints value before Array structural inspection;
8. validate Array prototype/count/key/descriptor rules from §6;
9. capture each constraint descriptor value once;
10. validate per-entry and aggregate bounds;
11. construct a new canonical object and new canonical Array from captured
    primitive values only;
12. freeze the Array and top-level object;
13. return either the bounded failure or authoritative snapshot.

Forbidden implementation pattern:

```text
validate original
  -> success
re-read original
  -> build snapshot
```

No post-inspection semantic read from the original caller object or Array is
permitted.

### 7.1 Internal visibility

`inspectProjectProfile` is repository-internal. It may be a module-local helper
or a source-relative/internal export from `project-profile.js` when private
consumers need result-style semantics.

It must **not**:

- be root-exported from `scripts/ai/index.js`;
- be added to `package.json` exports;
- become a Package Surface public symbol.

## 8. Snapshot and freeze semantics

The authoritative snapshot is:

- newly allocated;
- detached from caller top-level identity;
- detached from caller Array identity;
- exactly three semantic keys;
- composed only of accepted primitive strings and the new Array;
- frozen at top level;
- frozen at Array level;
- stable against later source mutation.

For v1:

```text
Object.isFrozen(snapshot) === true
Object.isFrozen(snapshot.knownProjectConstraints) === true
```

Strings are primitives and require no recursive freeze. The snapshot does not
preserve caller prototype, descriptors, accessors, unknown fields, symbols, or
object identity.

## 9. Validator/assert contracts — C1-MINOR-1/C1-MINOR-2

### 9.1 `validateProjectProfile(profile)` — repository/module validator, not package public API

`validateProjectProfile` is **not** one of the supported root package exports in
Package Surface v2. It is a repository/module validator used through
source-relative code.

It remains non-throwing for ordinary invalid input and returns the existing
high-level shape:

```js
{ valid: boolean, errors: string[] }
```

It derives from the same central inspection primitive but does **not** make the
original caller object authoritative and does not expose a second schema.

Package Surface v3 must not add `validateProjectProfile` to the root export set.

### 9.2 `assertValidProjectProfile(profile, callerLabel)` — supported root public API

`assertValidProjectProfile` remains the existing supported root symbol and call
signature.

Future success changes intentionally from:

```text
return caller-owned profile
```

to:

```text
return authoritative detached deep-frozen ProjectProfile snapshot
```

Failures retain stable high-level prefixes where applicable:

```text
PROJECT_PROFILE_REQUIRED
PROJECT_PROFILE_INVALID
```

The assertion derives from the same central inspection result; it must not run
a second validation pass over caller-owned input.

### 9.3 Private non-throwing consumers

A repository-private consumer that needs result-style behavior must consume the
central inspection result and use `result.snapshot` on success. It must not call
`validateProjectProfile(input)` and then continue reading `input`.

This specifically covers result-style paths such as
`test-automation/automation-repository-context.js` and private #22 generation/
review paths where throwing semantics would be inappropriate.

No new root/public symbol is created.

### 9.4 Intentional identity break

The current observable behavior:

```js
assertValidProjectProfile(profile, label) === profile
```

becomes false for a valid caller-owned profile. This is an intentional,
documented breaking behavior correction.

## 10. Bounded diagnostics — C1 corrective requirement

Validation errors are themselves a trust boundary. Rejection must not amplify
attacker/caller-controlled keys or values into unbounded diagnostics.

D1-C1 fixes these design bounds:

- maximum unknown keys represented in validation detail: `8`;
- maximum displayed text for one unknown key: `80` UTF-16 code units;
- maximum total validation-detail text emitted by the ProjectProfile boundary:
  `1024` UTF-16 code units.

Diagnostics must not:

- stringify/serialize the hostile input;
- include unbounded property values;
- include unbounded property names;
- include raw Proxy/accessor exceptions or stack traces.

When additional errors exist beyond the reporting bound, the diagnostic may use
a fixed truncation/omission indicator rather than enumerate them.

## 11. Mandatory consumer rule

Any consumer that treats a value as ProjectProfile must cross the central D1
boundary once and then use only the authoritative snapshot or a projection
constructed from that snapshot.

Throwing public-style example:

```js
const profile = assertValidProjectProfile(inputProfile, callerLabel);
use(profile.id);
```

Result-style private example:

```js
const result = inspectProjectProfile(inputProfile);
if (!result.valid) return boundedFailure(result.errors);
use(result.snapshot.displayName);
```

Forbidden:

```js
assertValidProjectProfile(inputProfile, callerLabel);
use(inputProfile.id);
```

Forbidden equally for private paths:

```js
validateProjectProfile(inputProfile);
use(inputProfile.knownProjectConstraints);
```

A projection may intentionally omit fields, but it must be derived from the
central snapshot, never from independently snapshotted raw ProjectProfile input.

## 12. Complete current producer/consumer scope — C1-MAJOR-2

### 12.1 Producers

Current concrete producers include:

- `scripts/targets/targomo/project-profile.js`;
- `scripts/targets/project-b/project-profile.js`;
- synthetic/unit/external-install fixtures.

Producer freezing is hygiene, not a substitute for consumer validation.

### 12.2 Supported/public-path consumers

Future implementation must trace and migrate all ProjectProfile uses in the
supported pipeline, including at minimum:

- `scripts/ai/qa-agent-prompt.js`;
- `scripts/ai/collect-context.js`;
- `scripts/ai/collect-history.js`;
- `scripts/ai/analyze-failure.js`;
- `scripts/ai/index.js` as a compatibility/export verification surface without
  adding a new public export.

### 12.3 Repository-private #23 consumer

At minimum:

- `scripts/ai/test-automation/automation-repository-context.js`.

If ProjectProfile reaches this result-style path, the path must consume the
central inspection snapshot. Its current validate-then-read-original pattern is
not acceptable under D1.

### 12.4 Repository-private #22 generation/review consumers

F05 closure also includes current ProjectProfile-shaped guidance paths in #22.
At minimum:

- `scripts/ai/generative-test-design/automation-candidate-generator.js`;
- `scripts/ai/generative-test-design/test-design-review-package.js`.

Current local ProjectProfile snapshot/projection logic in those modules may not
remain a divergent schema after D1. Required architecture:

- absence may remain valid where the parameter is currently optional;
- when supplied, ProjectProfile must pass the central D1 inspection contract;
- any prompt/review projection is built from the central authoritative
  snapshot;
- bounds, controls, Proxy policy, closed keys, and snapshot semantics are not
  reimplemented differently in #22.

Evaluation/test code such as `scripts/ai/evaluation/scoring-v6.js` must be
accounted for when it invokes or models these paths, but test/evaluation wiring
does not itself become a public product contract.

### 12.5 Repository-wide completion rule

The implementation baseline must be searched repository-wide for all semantic
ProjectProfile consumers. The list above is the known minimum, not permission to
omit another discovered consumer.

A newly discovered consumer may be added to implementation scope only when it
is genuinely necessary to apply the same approved D1 contract. Discovery of a
consumer whose semantics conflict with D1 triggers the STOP condition in §24.

## 13. Compatibility decision — unchanged

D1 remains:

```text
BREAKING PUBLIC API BEHAVIOR CORRECTION
```

Breaking aspects include:

1. formerly accepted unknown/accessor/inherited/non-enumerable/Proxy/control/
   oversized inputs become invalid;
2. `assertValidProjectProfile()` no longer returns caller identity.

This is a governed pre-Controlled-v1 correction, not a silent backwards-
compatible bug fix and not a claim that a formal semver-major release already
occurred.

## 14. Rejected compatibility strategies

### 14.1 Silent unrecorded hardening — rejected

Would conceal a breaking change to a declared supported symbol.

### 14.2 Parallel strict symbol while weak symbol remains supported — rejected

Would preserve a supported bypass and leave F05 open.

### 14.3 Weak deprecation bridge — rejected

Controlled v1 has not been formally released under ID-3. Preserving the weak
boundary into first release solely for pre-release compatibility is not
justified.

### 14.4 Premature semver-major release workflow — rejected for this stage

Formal package version/release mechanics remain ID-3 work.

## 15. Package Surface v3 and migration

Future implementation is expected to introduce:

```text
docs/package-surface-v3.md
```

Package Surface v3 must:

- supersede v2 for the revised ProjectProfile behavior;
- preserve the existing 19 root export names unless separately authorized;
- preserve existing `package.json` export keys unless separately authorized;
- keep `assertValidProjectProfile` as the public symbol;
- not root-export `validateProjectProfile`;
- not root-export the central inspection helper;
- record the narrower accepted domain;
- record authoritative-snapshot success semantics;
- classify the behavior change as a breaking pre-Controlled-v1 correction;
- preserve private #22/#23 classification.

External consumers migrate by supplying only valid v1 data and by not relying
on caller-object identity or post-assert mutation visibility.

This design stage does not authorize creating v3.

## 16. Compatibility matrix

| Caller/input behavior | D1-C1 disposition |
|---|---|
| Plain valid object literal | ACCEPT; new snapshot returned |
| Valid `Object.create(null)` record | ACCEPT; canonical snapshot returned |
| Frozen/sealed valid ordinary profile | ACCEPT |
| Targomo profile | ACCEPT |
| Project B profile | ACCEPT |
| JSON round-trip valid profile | ACCEPT |
| Top-level Proxy | REJECT before trap-capable inspection |
| Revoked top-level Proxy | REJECT |
| Proxy constraints Array | REJECT before Array inspection |
| Unknown own string key, enumerable or not | REJECT |
| Any own symbol key | REJECT |
| Class/custom-prototype instance | REJECT |
| Inherited required field | REJECT |
| Non-enumerable required field | REJECT |
| Getter/setter required field | REJECT without invoking accessor |
| Sparse constraints Array | REJECT |
| Array subclass/custom Array prototype | REJECT |
| Accessor/inherited Array element | REJECT without invoking accessor |
| Extra Array own string/symbol key | REJECT |
| C0/DEL | REJECT |
| Over-limit field/count/aggregate | REJECT |
| Caller mutation after assertion | no effect on snapshot |
| Caller Array mutation after assertion | no effect on snapshot |
| Reliance on returned object identity | BREAKING / migration required |
| Future fourth semantic field | REJECT until governed contract revision |

## 17. Interaction with Package Surface v2 and ID-3

Package Surface v2 remains current until a separately authorized replacement
lands. Its existing facts remain:

- 19 supported root names;
- `assertValidProjectProfile` is public;
- `validateProjectProfile` is not a root export;
- #22/#23 implementation remains private;
- deep imports remain unsupported.

ID-3 remains responsible for:

- formal package version policy;
- production release tags;
- npm-registry publication decision;
- consumer install guidance;
- rollback/version lifecycle;
- CLI/convenience surface;
- reusable CI integration.

F05 can be corrected before ID-3 because D1 defines the security/behavior
contract that Controlled v1 should eventually release. D1 must not change
`package.json` version, create release tags, publish npm artifacts, or invent a
formal semver lifecycle.

## 18. Future implementation scope — revised by C1

No implementation is authorized by this document.

Subject to a later Product Owner grant, expected production categories include:

```text
scripts/ai/project-profile.js
scripts/ai/qa-agent-prompt.js
scripts/ai/collect-context.js
scripts/ai/collect-history.js
scripts/ai/analyze-failure.js
scripts/ai/test-automation/automation-repository-context.js
scripts/ai/generative-test-design/automation-candidate-generator.js
scripts/ai/generative-test-design/test-design-review-package.js
```

`scripts/ai/index.js` is an export-compatibility verification surface; it should
not need a new root export.

Evaluation callers such as `scripts/ai/evaluation/scoring-v6.js` are included
when required to preserve/prove behavior of the migrated private paths.

Expected future tests/documentation include:

```text
scripts/ai/project-profile.test.js
consumer-specific ProjectProfile tests
#22 generation/review ProjectProfile tests
#23 repository-context ProjectProfile tests
scripts/targets/targomo/project-profile.test.js
scripts/targets/project-b/project-profile.test.js
test/installation/external-repository-proof.test.js
package/public-boundary compatibility tests
docs/package-surface-v3.md
```

The future implementation PR must not include ROADMAP lifecycle closure; that
remains a later, separately governed sync after merge/post-merge certification.

Any unrelated refactor, new feature, package-export change, or remediation of a
separate finding requires separate authority.

## 19. Future regression and adversarial test matrix — C1-MINOR-4

A future implementation must prove all categories below.

### 19.1 Happy path / canonical snapshot

- ordinary exact valid profile accepted;
- valid null-prototype record accepted;
- frozen and sealed valid ordinary records accepted;
- Targomo profile accepted;
- Project B profile accepted;
- external-installed valid profile accepted;
- snapshot has exact three semantic keys;
- snapshot is not caller object;
- snapshot Array is not caller Array;
- both snapshot containers are frozen;
- accepted content and Array order preserved.

### 19.2 Top-level closed-schema negatives

Reject:

- unknown enumerable own key;
- unknown non-enumerable own key;
- symbol key;
- missing key;
- class/custom-prototype instance;
- inherited required field;
- non-enumerable required field;
- getter;
- setter-only descriptor;
- throwing getter without getter invocation.

### 19.3 Proxy negatives

Prove:

- top-level Proxy rejected;
- proxied constraints Array rejected;
- revoked Proxy rejected;
- Proxy with traps that would throw is rejected before those traps run;
- Proxy with mutating/inconsistent traps is rejected before those traps run.

Tests must instrument traps and prove the trap counters remain zero through the
rejection path used by the approved runtime mechanism.

### 19.4 Array contract negatives

Reject/prove bounded handling for:

- empty Array;
- 33 entries;
- huge sparse `length` before iteration;
- ordinary sparse Array;
- accessor numeric element;
- non-enumerable numeric element;
- inherited numeric element;
- extra own string property;
- own symbol property;
- Array subclass/custom Array prototype;
- constraint over 2048 units;
- aggregate over 8192 units.

### 19.5 String/bound negatives

Reject:

- blank `id`, `displayName`, or constraint;
- `id` length 129;
- `displayName` length 257;
- C0 and DEL in every field category.

Accept exact maximum valid values. Bounds are tested in UTF-16 code units.

### 19.6 validate/assert parity and diagnostics

- every accepted fixture is accepted by both high-level paths;
- every rejected fixture is rejected by both;
- `validateProjectProfile()` never invokes getters;
- assert uses the same central inspection outcome, not a second caller read;
- no more than 8 unknown keys are represented;
- displayed unknown key text is at most 80 units;
- total validation detail is at most 1024 units;
- diagnostics contain no raw hostile values, stack traces, or serialized input.

### 19.7 TOCTOU/detachment

- mutate/replace caller top-level fields after success → snapshot unchanged;
- mutate/replace caller constraints Array → snapshot unchanged;
- attempted snapshot mutation → trusted state unchanged;
- no consumer validates one object and later reads the original;
- prompt/context/review projections derive only from the authoritative snapshot.

### 19.8 Complete consumer migration

For every repository-wide ProjectProfile consumer discovered at the
implementation baseline:

- prove use of central D1 contract;
- prove downstream output is insensitive to post-boundary source mutation;
- prove invalid input fails before relevant downstream side effects.

At minimum explicitly cover:

- `qa-agent-prompt`;
- `collect-context`;
- `collect-history`;
- `analyze-failure`;
- #23 `automation-repository-context` result-style path;
- #22 `automation-candidate-generator` ProjectProfile guidance path;
- #22 `test-design-review-package` ProjectProfile projection;
- relevant evaluation callers such as scoring-v6.

### 19.9 External/package compatibility

From a real installed package, prove:

- supported root export names remain unchanged;
- valid external profile works;
- invalid extra/accessor/Proxy/oversized profile fails through the supported
  public API;
- assert returns detached snapshot semantics;
- private deep-import rules remain unchanged.

## 20. Error and fail-closed requirements

Invalid ProjectProfile must fail before any ProjectProfile-derived prompt,
context, history request, review projection, filesystem action, or other
relevant downstream side effect.

The boundary must not:

- invoke accessors on accepted/rejected ordinary descriptor inputs;
- invoke Proxy traps before Proxy rejection;
- serialize caller objects for diagnostics;
- emit unbounded diagnostic text;
- silently drop unknown fields and continue;
- silently normalize strings into another identity;
- fabricate defaults for missing required profile data;
- fall back to the old weak contract.

Where ProjectProfile is optional, **absence may retain existing optional
semantics**; a present value must satisfy D1.

## 21. Architecture review findings disposition

### MAJOR-1 — Proxy handling undefined

`RESOLVED_BY_D1_C1_DESIGN`

Explicit rejection-before-inspection policy is defined in §§4, 5, 6, 7, 16,
19, and 20.

### MAJOR-2 — omitted #22 ProjectProfile consumers

`RESOLVED_BY_D1_C1_DESIGN`

The central contract now explicitly covers #22 automation candidate generation
and test-design review package paths as well as #23/public consumers (§§11-12,
18-19).

### MINOR-1 — public/private terminology

`RESOLVED_BY_D1_C1_DESIGN`

Only `assertValidProjectProfile` is described as supported root public API;
`validateProjectProfile` and the central inspector remain non-root internal
interfaces (§9, §15, §17).

### MINOR-2 — no non-throwing authoritative-snapshot path

`RESOLVED_BY_D1_C1_DESIGN`

The central internal inspection result includes the authoritative snapshot and
is available to result-style private consumers (§§7, 9.3, 11).

### MINOR-3 — Array/string mechanics under-specified

`RESOLVED_BY_D1_C1_DESIGN`

Exact Array prototype/key/descriptor/count rules and UTF-16 bound units are
fixed in §§5-6.

### MINOR-4 — test matrix gaps

`RESOLVED_BY_D1_C1_DESIGN`

The expanded matrix is in §19.

### INFO-1 — wider Unicode control policy

`PRESERVED FOR SECURITY REVIEW`

C1 does not silently broaden the C0+DEL policy. Security review must assess
whether bidi/format controls or surrogate handling require another design
corrective.

### INFO-2 — frozen/sealed/null-prototype/JSON ordinary inputs

`INFORMATIONAL / NO ACTION`

Their intended compatibility is explicit in §§5 and 16.

### INFO-3 — stale #23 comment saying upstream constraints are unbounded

`INFORMATIONAL / FUTURE IMPLEMENTATION COMMENT DEBT`

No production file is changed in this design corrective solely to clean a
comment.

## 22. Preserved unrelated findings and boundaries

D1-C1 does not close, waive, absorb, re-rate, or risk-accept unrelated debt,
including:

- `TSB-F02`;
- `TSB-F04`;
- `TSB-F06` / `ADV-01`;
- `TSB-F07`;
- `XI-01` / `XI-02`;
- `SADR-01`;
- `TB-01` / `AT-07`;
- `TB-09`;
- `TB-10`;
- `TB-15`;
- `TB-18`;
- generated-code isolation/process-survival/path-alias/productization debt.

A strict snapshot may be prerequisite evidence for later
profile↔root↔context binding, but D1-C1 does not implement or claim that
binding.

## 23. Review requirements after C1

The previous Architecture review and CI #609 were bound to obsolete HEAD
`8dd5f7eaec0768f6d996f0c57e8265e3714e59e0` once this corrective creates a new
HEAD.

Required lifecycle for the new exact HEAD:

1. fresh automatic `pull_request` CI on the new HEAD;
2. independent exact-head `HEAVY Architecture` corrective re-review;
3. only if Architecture = `APPROVED`, independent exact-head `HEAVY Security`
   design review;
4. return to Product Owner for design disposition / separate merge authority.

Security review must not run against the obsolete pre-C1 HEAD.

A new corrective HEAD again invalidates prior exact-head approvals.

## 24. STOP conditions for future implementation

A future implementation mission must STOP if:

- `main` differs from its separately authorized implementation baseline;
- D1 cannot be implemented without adding/removing/renaming a supported root
  export or package subpath;
- implementation would need a weak compatibility bridge or second public
  ProjectProfile validator;
- Package Surface v3 would require an unauthorized `package.json` version or
  export-key change;
- current target profiles do not fit approved bounds;
- repository-wide consumer discovery finds semantics incompatible with the
  single central ProjectProfile contract;
- a #22/#23 path cannot migrate to the central snapshot without changing
  unrelated product semantics;
- implementation would require a fourth ProjectProfile field or change field
  meaning;
- ID-3 release/version policy must be decided to proceed safely;
- an unrelated finding must be fixed to make implementation/tests pass;
- scope would broaden into F02/F04/F06/F07/XI/SADR or another corrective
  without separate authority.

No implementation agent may silently weaken D1 or broaden scope.

## 25. Lifecycle boundary

Current design lifecycle state after this C1 document is committed:

```text
TSB-F01 + TSB-F03: CANONICALLY CLOSED
TSB-F05 preflight: COMPLETE
TSB-F05-D1 architecture direction: PRODUCT OWNER APPROVED
TSB-F05-D1 original Architecture review: CHANGES_REQUIRED
TSB-F05-D1-C1 design corrective: AUTHORIZED / new exact-head review required
TSB-F05 implementation: NOT AUTHORIZED / NOT STARTED
Controlled Release: NOT APPROVED
MEM/RAG/LEARN: NOT ACTIVATED
```

Even successful design review and merge do not remediate TSB-F05. Finding
closure requires a separately authorized implementation lifecycle with
independent review, merge, post-merge certification, and canonical closure.

## 26. Decision summary

```text
DECISION:
  Keep exactly:
    id
    displayName
    knownProjectConstraints

  Enforce one central ProjectProfile v1 trust contract across public and
  private semantic consumers.

  Reject top-level/Array Proxy inputs before trap-capable structural
  inspection.

  Require exact own enumerable data shape, finite UTF-16 bounds,
  C0+DEL rejection, exact Array mechanics, and bounded diagnostics.

  Build one detached deep-frozen authoritative snapshot from captured
  descriptor values and never re-read caller input afterward.

  Keep assertValidProjectProfile as the supported public symbol and change
  its success result to the authoritative snapshot.

  Keep validateProjectProfile and the central inspector out of the package
  root public surface.

  Require #22 generation/review, #23 repository context, and supported
  public consumers to derive ProjectProfile guidance from the same central
  snapshot contract; no divergent local ProjectProfile schema remains.

  Treat the behavior change as a BREAKING PUBLIC API BEHAVIOR CORRECTION
  before Controlled v1.

  Do not preserve a weak public compatibility path.
  Record eventual public behavior in Package Surface v3.
  Leave formal semver/publication/release mechanics to ID-3.

  No implementation, merge, release, or downstream activation is granted
  by this design record.
```
