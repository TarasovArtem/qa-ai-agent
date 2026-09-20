# Package Surface v2

CRW2-ACG-A1, addressing Architecture Conformance Gate finding A-1; path
transition ACG-D2, addressing finding D-2.

Status: **CURRENT**.

Supersedes: [`package-surface-v1.md`](package-surface-v1.md).

## What changed from v1

The A-1 decision (`A1_DECISION: PRIVATE_GENERATIVE_SURFACE`) and every
semantic rule below are carried forward unchanged. Only the repository path
of the private `#22` directory changed: ACG-D2 renamed it from
`scripts/ai/test-design/` to `scripts/ai/generative-test-design/`, while the
deterministic RTI module `scripts/ai/test-design.js` keeps its identity.
The distribution file set is unchanged (45 files); because `package.json`
itself ships and its `files` field changed, the tarball bytes and shasum
changed: 45 files / `cbbea05237a25d35df5cd026b9e58441bbcc1060` at A-1 (historical),
45 files / `bdf502ab65327532da238a7d76312cb14b89a7b6` after D-2. The
manifest path set is identical; only the shipped `package.json` bytes differ.

Subject: the installable product surface of the `qa-ai-agent` npm package —
which modules are supported public API, and which files are physically
distributed.

## Why this exists

`package.json` has two independent mechanisms that describe a package:

- `exports` — the **supported import surface**: what a consumer may
  `require()`. Node enforces it: any specifier not listed fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `files` — the **physical distribution surface**: what `npm pack` puts in the
  tarball.

Before A-1 these disagreed. `files` shipped `scripts/ai` wholesale (minus
tests, fixtures and evaluation), so 32 files of the repository-private
`#22`/`#23` generative implementation were physically present in every
installed copy, although `exports` made them unreachable. That was not a
public-API leak — deep imports were blocked — but it left the *installable
product* ambiguous: a reader of an installed package could not tell which
files were product and which were repository internals, and any future change
to `exports` (or a consumer bypassing it with a filesystem path) would have
exposed code that was never meant to be a compatibility commitment.

This document fixes the boundary: **the physical surface must not contain
code that is not part of the supported surface or required by it.**

## Decision

```text
A1_DECISION: PRIVATE_GENERATIVE_SURFACE
```

The `#22`/`#23` generative implementation is **repository-private**. It is not
a supported package API and it is not distributed. The supported package
surface is exactly the pre-existing one, unchanged by A-1.

## Supported public surface

Root entrypoint — `require("qa-ai-agent")`, exactly these 19 names:

```text
aggregateBrowserContext     analyzeFailure                 analyzeRequirementQuality
analyzeRequirementsCoverage analyzeRequirementsQuality     assertValidFrameworkRuntimeConfig
assertValidProjectKnowledgeConfig  assertValidProjectProfile  assertValidRepositoryRoot
assertValidRequirementArtifact     assertValidTestDesignArtifact  buildRequirementTraceability
collectContext              collectHistory                 generateTestDesign
generateTestDesigns         loadRequirementsFromFile       loadRequirementsFromProvider
publishTestDesigns
```

Explicit subpaths — `package.json` `exports`, exactly these five keys:

| Export key | Target |
|---|---|
| `.` | `scripts/ai/index.js` |
| `./providers/jira` | `scripts/ai/providers/jira-requirements-provider.js` |
| `./providers/azure-devops` | `scripts/ai/providers/azure-devops-requirements-provider.js` |
| `./destinations/azure-devops` | `scripts/ai/destinations/azure-devops-test-case-destination.js` |
| `./package.json` | `package.json` |

There is no wildcard export and no `#22`/`#23` subpath. Nothing else is a
supported import.

## Classification

| Path / group | Class | Shipped |
|---|---|---|
| `scripts/ai/index.js` | `PUBLIC_ROOT_ENTRYPOINT` | yes |
| the three provider/destination modules above | `PUBLIC_SUBPATH` | yes |
| `package.json` | `PUBLIC_METADATA_SUBPATH` | yes |
| `scripts/ai/test-design.js` (deterministic RTI-4) | `SHIPPED_PRIVATE_RUNTIME_IMPLEMENTATION` behind the root API | yes |
| other modules transitively required by a public entrypoint (adapters, providers, knowledge loader/schema, validators, RTI modules, and the internal helper modules they require) | `SHIPPED_PRIVATE_RUNTIME_DEPENDENCY` | yes |
| `scripts/ai/knowledge/units/*.json` (loaded by directory at runtime, so not visible to a static require graph) | `SHIPPED_PRIVATE_RUNTIME_DEPENDENCY` (data) | yes |
| `scripts/ai/generation/**` | `REPOSITORY_ONLY_PRIVATE` | **no** |
| `scripts/ai/generative-test-design/**` (directory) | `REPOSITORY_ONLY_PRIVATE` | **no** |
| `scripts/ai/test-automation/**` | `REPOSITORY_ONLY_PRIVATE` | **no** |
| `scripts/ai/format-pr-comment.js`, `scripts/ai/normalized-failure.js`, `scripts/ai/pr-comment-client.js` | `REPOSITORY_ONLY_CI_HELPER` | **no** |
| `*.test.js`, `__fixtures__`, `scripts/ai/evaluation/**` | `TEST_ONLY` / `EVALUATION_ONLY` | no |
| `scripts/targets/**`, `.github/**`, `cypress/**` | `TARGET_OWNED` / repository-only | no |

Two rules follow:

1. **`exports` decides what is supported; `files` decides what is
   distributed.** A shipped file is not thereby public API. Private modules
   ship only because a supported module needs them.
2. **A JavaScript implementation file that is not a supported entrypoint or
   explicit subpath ships if and only if it is required by the transitive
   runtime closure of a supported entrypoint.** Runtime-discovered non-JS
   data ships when a supported runtime path needs it *and* the dependency is
   documented here — currently exactly `scripts/ai/knowledge/units/*.json`.
   The distribution list is derived from the real `require` graph, never
   from folder names alone, and a file's mere historical presence in the
   package is not a reason to keep shipping it.

`scripts/ai/test-design.js` (the deterministic RTI module, required by the
root entrypoint) and `scripts/ai/generative-test-design/` (the private `#22`
directory) no longer share a base name: ACG-D2 (Gate finding `D-2`) renamed
the private directory from `scripts/ai/test-design/`. `require("./test-design")`
resolves to the file, unchanged. The A-1 decision itself did not change; only
the repository path implementing the private surface did.

Three root-level CI helpers (`format-pr-comment.js`, `normalized-failure.js`,
`pr-comment-client.js`) are `REPOSITORY_ONLY_CI_HELPER`: no supported
entrypoint and no shipped module requires them, `package.json` declares no
`bin` that uses them, and their only consumers are this repository's own
tests and GitHub Actions workflow, which run from a repository checkout. They
remain in the repository and are not distributed. They are not `#22`/`#23`
code; they are excluded because rule 2 above does not admit them.

## Physical distribution policy

`package.json` `files` is the deliberate declaration of the physical surface:

```text
scripts/ai
!scripts/ai/**/*.test.js
!scripts/ai/__fixtures__
!scripts/ai/evaluation
!scripts/ai/generation
!scripts/ai/generative-test-design
!scripts/ai/test-automation
!scripts/ai/format-pr-comment.js
!scripts/ai/normalized-failure.js
!scripts/ai/pr-comment-client.js
```

The tarball is 45 files (80 before A-1; the file count is unchanged by the D-2
rename): the 35 files removed by A-1 are exactly the private `generation` (8),
`generative-test-design/` (10, formerly `test-design/`)
and `test-automation` (14) trees plus the three repository-only CI helpers
(3). The removals were verified against the dependency graph — none is
required by any supported entrypoint.

### Fail-closed invariants

**Closure (nothing missing).** For every `.js` file in the tarball, every
relative `require` must resolve to a file that is also in the tarball, and no
shipped file may use a non-literal `require(...)` or `import()`.

**Minimality (nothing extra).** Every `.js` file in the tarball must be a
supported entrypoint or be reachable through `require` from one, and every
non-JS file must be package metadata (`package.json`, `README.md`, `LICENSE`)
or a documented runtime-discovered data file.

Both are asserted by
`test/installation/package-surface.test.js` on the **actual `npm pack`
manifest**, so a future change that makes a public module depend on a private
tree fails in CI instead of shipping a package that cannot start, and a future
unreachable file fails in CI instead of quietly widening the package. A
dynamic local load found by review must be listed explicitly rather than
assumed excludable.

## The ACG-A3 adapter

`scripts/ai/generative-test-design/evidence-ingestion.js` — including
`ingestRequirementArtifactsAsEvidence` — is `REPOSITORY_ONLY_PRIVATE` for
packaging purposes. The `RequirementArtifact[]` → `#22` evidence seam decided
by `A-3` (`docs/architecture-model-boundary-v2.md`) exists inside the
repository; it does not become a package contract by existing there.

## Deep-import policy

There is no deep-import contract. Importing any path that is not an `exports`
key is unsupported. A-1 makes this true in two independent ways, and both are
tested from a fresh external install:

- **Encapsulation** — Node rejects the specifier with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Physical absence** — the private file is not in the installed package at
  all.

Before A-1 only the first held. Neither is sufficient alone.

## Compatibility commitment

The root exports, the four explicit subpaths and `package.json` are the
supported surface and are unchanged by A-1 (19 → 19 root names, 5 → 5
`exports` keys). Files outside that surface — including every shipped private
runtime dependency — may be renamed, moved or removed in any release without
notice.

## Verification

- `npm pack --dry-run --json` manifest assertions and the static closure
  invariant (above).
- A real `npm pack` tarball installed into a fresh external consumer, and a
  real Git-dependency install, both checked for: the exact 19 root names, every
  explicit subpath, blocked private deep imports, physically absent private
  files, an installed file set equal to the pack manifest, and a working RTI
  chain.
- The existing ID-2 external-repository proofs, which exercise all four
  generic pipeline stages from an installed tarball.

## Future evolution

A stable high-level `#22`/`#23` API may one day be offered. That requires an
explicit new version of this document, a defined public contract,
external-install compatibility tests, security/trust review and independent
review. It must never happen through accidental shipping or deep imports.

## What this document does not do

- It does not add, remove or rename any public export or subpath.
- It does not by itself change the canonical `ROADMAP.md` status of `D-2`;
  that is a separate closure-sync mission after independent review, merge
  and post-merge certification.
- It does not decide npm-registry publication, versioning or release policy
  (`ID-3`).
- It does not close the Architecture Conformance Gate. `A-1` is already
  `CLOSED_ON_MAIN`; Gate closure is a separate lifecycle step.
