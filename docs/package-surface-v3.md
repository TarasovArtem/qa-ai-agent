# Package Surface v3

TSB-F05-D1-C1 implementation — strict snapshotting ProjectProfile contract.
Authority: `OD-TSB-F05-D1-C1-IMPLEMENTATION`. Governing design:
[`tsb-f05-project-profile-contract-decision-v1.md`](tsb-f05-project-profile-contract-decision-v1.md).

Status: **CURRENT for ProjectProfile behavior only.**

Supersedes: [`package-surface-v2.md`](package-surface-v2.md) **only** for the
revised `assertValidProjectProfile` behavior recorded below. For everything
else — the 19 root names, the five `exports` keys, the classification table,
the physical distribution policy and its fail-closed invariants, the ACG-A3
adapter, the deep-import policy and the verification list — `package-surface-v2.md`
remains authoritative and is intentionally left unedited by this change.

## What changed from v2

One supported root symbol keeps its name and call signature but changes
behavior:

```text
assertValidProjectProfile(profile, callerLabel)
```

| Aspect | v2 behavior | v3 behavior |
|---|---|---|
| Accepted input domain | any object with a non-empty string `id`/`displayName` and a non-empty string array `knownProjectConstraints`; extra keys, accessors, inherited values, Proxies, control characters and unbounded lengths accepted | only the strict ProjectProfile v1 data contract below |
| Success return value | the caller's own object (`result === profile`) | a newly allocated, detached, frozen authoritative snapshot (`result !== profile`) |
| Later caller mutation | visible through the returned value | has no effect on the returned value |
| Failure | `Error` with `PROJECT_PROFILE_REQUIRED` / `PROJECT_PROFILE_INVALID` prefix | unchanged prefixes; diagnostics now bounded (see below) |

Compatibility class:

```text
BREAKING PUBLIC API BEHAVIOR CORRECTION — pre-Controlled-v1
```

This is a governed correction of a supported symbol before Controlled v1. It
is not a silent bug fix, and it is not a formal semver-major release: no
version, tag, release or npm publication changed (see *What this document
does not do*). There is no weak compatibility bridge, no deprecation path and
no second public validator.

## Unchanged public surface

Root entrypoint — `require("qa-ai-agent")`, exactly the same 19 names as v2:

```text
aggregateBrowserContext     analyzeFailure                 analyzeRequirementQuality
analyzeRequirementsCoverage analyzeRequirementsQuality     assertValidFrameworkRuntimeConfig
assertValidProjectKnowledgeConfig  assertValidProjectProfile  assertValidRepositoryRoot
assertValidRequirementArtifact     assertValidTestDesignArtifact  buildRequirementTraceability
collectContext              collectHistory                 generateTestDesign
generateTestDesigns         loadRequirementsFromFile       loadRequirementsFromProvider
publishTestDesigns
```

`package.json` `exports` keys are unchanged: `.`, `./providers/jira`,
`./providers/azure-devops`, `./destinations/azure-devops`, `./package.json`.
`package.json` itself (version, `exports`, `files`) is unchanged.

Not root-exported, before or after this change:

| Symbol | Location | Class |
|---|---|---|
| `assertValidProjectProfile` | `scripts/ai/project-profile.js` | **supported root public API** |
| `validateProjectProfile` | `scripts/ai/project-profile.js` | repository/module validator — not a root export |
| `inspectProjectProfile` (central inspector) | `scripts/ai/project-profile.js` | repository-internal — not a root export, not a subpath |

`scripts/ai/project-profile.js` remains a `SHIPPED_PRIVATE_RUNTIME_DEPENDENCY`;
a deep import of it is still rejected with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
The `#22` (`scripts/ai/generative-test-design/**`) and `#23`
(`scripts/ai/test-automation/**`) trees remain `REPOSITORY_ONLY_PRIVATE` and
undistributed; routing their ProjectProfile inputs through the central
boundary does not make them public.

## ProjectProfile v1 accepted input domain

A value is accepted only if all of the following hold (D1-C1 §§5–6):

- not a Proxy (top-level or `knownProjectConstraints`), detected with Node's
  `util.types.isProxy()` before any trap-capable reflection; revoked Proxies
  are rejected too;
- a non-Array object whose prototype is exactly `Object.prototype` or `null`;
- exactly the own string keys `id`, `displayName`, `knownProjectConstraints` —
  no other own key (enumerable or not) and no own symbol key;
- each of the three is an own, enumerable **data** property; accessors are
  rejected without being invoked and inherited values never substitute;
- `knownProjectConstraints` is an actual Array with prototype exactly
  `Array.prototype`, `length` 1..32 (checked before iterating), dense
  canonical indexes `0..length-1` as own enumerable data properties, and no
  other own string or symbol key;
- every string is a JavaScript string with at least one non-whitespace
  character and no C0 (`U+0000..U+001F`) or DEL (`U+007F`) character.

Bounds, in JavaScript UTF-16 code units (`String.length`):

| Field | Bound |
|---|---:|
| `id` | 1..128 |
| `displayName` | 1..256 |
| `knownProjectConstraints` entries | 1..32 |
| one constraint | 1..2048 |
| all constraints combined | ≤ 8192 |

Accepted strings are preserved exactly — never trimmed, normalized or
case-folded. Valid frozen, sealed, null-prototype and JSON-parsed records are
accepted. No fourth field is accepted.

## Authoritative snapshot semantics

On success `assertValidProjectProfile` returns a snapshot that is:

- newly allocated, with prototype `Object.prototype` and exactly the three
  keys, whatever the input's prototype was;
- built only from the primitive strings captured from the input's own
  property descriptors during the single inspection — the caller's object is
  never read again;
- detached: its `knownProjectConstraints` is a new Array (prototype
  `Array.prototype`), never the caller's array;
- frozen at both levels: `Object.isFrozen(snapshot)` and
  `Object.isFrozen(snapshot.knownProjectConstraints)` are both `true`.

Every supported pipeline entry that accepts a ProjectProfile
(`collectContext.main`, `collectHistory.main`, `analyzeFailure.main`) uses
only this snapshot after the boundary; a caller mutating its own object
mid-run cannot change persisted `context.json`/`history.json` identity or the
provider-visible system prompt.

## Bounded diagnostics

`PROJECT_PROFILE_REQUIRED` (absent/`null`) and `PROJECT_PROFILE_INVALID`
prefixes are preserved. The validation detail inside an invalid-profile error:

- represents at most 8 unknown keys, each rendered as at most 80 UTF-16
  units of printable ASCII (other characters `\uXXXX`-escaped);
- is at most 1024 UTF-16 units in total, with a fixed omission indicator for
  anything that does not fit;
- never contains property values, serialized input, symbol descriptions,
  raw Proxy/accessor exception text or stack traces.

`callerLabel` remains a static, internal provenance string supplied by this
package's own call sites; it is not a validated external input.

## Consumer migration

External consumers migrate by:

1. supplying only data that satisfies the v1 domain above (plain object or
   null-prototype record, exactly three fields, within bounds); and
2. using the returned snapshot instead of relying on
   `assertValidProjectProfile(profile, label) === profile`, and not relying on
   post-assertion mutation of their own object being observed.

The repository's own target profiles already conform with headroom:

| Profile | `id` | `displayName` | constraints | longest | aggregate |
|---|---:|---:|---:|---:|---:|
| Targomo | 16 | 67 | 2 | 519 | 764 |
| Project B | 26 | 91 | 1 | 235 | 235 |

## Verification

- `scripts/ai/project-profile.test.js` — the D1-C1 adversarial matrix
  (happy path, closed schema, accessors, Proxy with zero trap invocations,
  Array mechanics, UTF-16 bounds, C0/DEL, diagnostic bounds, parity,
  TOCTOU/detachment).
- Consumer migration tests for `qa-agent-prompt`, `collect-context`,
  `collect-history`, `analyze-failure`, `#23` `automation-repository-context`,
  `#22` `automation-candidate-generator` and `test-design-review-package`, and
  the `scoring-v6` evaluation path.
- `scripts/targets/targomo/project-profile.test.js`,
  `scripts/targets/project-b/project-profile.test.js`.
- `test/installation/external-repository-proof.test.js` — through a real
  `npm pack` + install external consumer using only the bare
  `require("qa-ai-agent")`: valid profile → detached frozen snapshot;
  extra-key, accessor, Proxy, proxied-constraints and oversized profiles
  rejected with zero getter/trap calls; pipeline fails closed before output;
  the root export set unchanged (19); deep import blocked.
- `test/installation/package-surface.test.js` — unchanged manifest, `exports`
  and 19-name assertions continue to pass.

## Preserved observations (not closed by this document)

- Unicode policy beyond C0+DEL (bidi/format controls, lone surrogates) is not
  part of v1; it remains a Security-review observation.
- Own-key enumeration of a rejected input is O(number of own keys) before the
  bounded diagnostic is produced.
- The snapshot does not bind a profile to a repository root or a persisted
  context; that profile↔root↔context binding remains `SADR-01`/`XI` scope.
- Global JavaScript intrinsics are assumed unmodified (the repository-wide
  convention). The boundary captures its reflection intrinsics
  (`util.types.isProxy`, `Object.getOwnPropertyDescriptor`,
  `Object.getPrototypeOf`, `Object.hasOwn`, `Object.freeze`,
  `Reflect.ownKeys`, `Array.isArray`) at module load; string checks still use
  `String.prototype.trim` and `RegExp.prototype.test` at call time.

## What this document does not do

- It does not add, remove or rename any root export or `exports` subpath.
- It does not change `package.json`, the package version, tags, releases or
  npm publication; `ID-3` continues to own formal version/release/publication
  policy.
- It does not edit `package-surface-v2.md`.
- It does not change the canonical `ROADMAP.md` status of `TSB-F05`; finding
  closure requires independent review, merge, post-merge certification and a
  separate closure sync.
- It does not approve Controlled Release.
