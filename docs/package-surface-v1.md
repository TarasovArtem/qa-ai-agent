# Package Surface v1

CRW2-ACG-A1, addressing Architecture Conformance Gate finding A-1.

Status: **CURRENT**.

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
| other modules transitively required by a public entrypoint (adapters, providers, knowledge loader/schema, validators, RTI modules, helpers) | `SHIPPED_PRIVATE_RUNTIME_DEPENDENCY` | yes |
| `scripts/ai/knowledge/units/*.json` (loaded by directory at runtime, so not visible to a static require graph) | `SHIPPED_PRIVATE_RUNTIME_DEPENDENCY` (data) | yes |
| `scripts/ai/generation/**` | `REPOSITORY_ONLY_PRIVATE` | **no** |
| `scripts/ai/test-design/**` (directory) | `REPOSITORY_ONLY_PRIVATE` | **no** |
| `scripts/ai/test-automation/**` | `REPOSITORY_ONLY_PRIVATE` | **no** |
| `*.test.js`, `__fixtures__`, `scripts/ai/evaluation/**` | `TEST_ONLY` / `EVALUATION_ONLY` | no |
| `scripts/targets/**`, `.github/**`, `cypress/**` | `TARGET_OWNED` / repository-only | no |

Two rules follow:

1. **`exports` decides what is supported; `files` decides what is
   distributed.** A shipped file is not thereby public API. Private modules
   ship only because a supported module needs them.
2. **A private module ships if and only if a supported entrypoint requires it
   (transitively).** The distribution list is derived from the real
   `require` graph, never from folder names alone.

`scripts/ai/test-design.js` (the deterministic RTI module, required by the
root entrypoint) and `scripts/ai/test-design/` (the private `#22` directory)
are different paths that happen to share a base name. Node resolves
`require("./test-design")` to the file first, so the public module is
unaffected by the directory being excluded. Renaming either is Gate finding
`D-2` and is **not** decided here.

Three root-level CI-triage helpers (`format-pr-comment.js`,
`normalized-failure.js`, `pr-comment-client.js`) are shipped but not required
by any supported entrypoint. They are not `#22`/`#23` code and A-1 does not
change them; they remain shipped, unexported internals.

## Physical distribution policy

`package.json` `files` is the deliberate declaration of the physical surface:

```text
scripts/ai
!scripts/ai/**/*.test.js
!scripts/ai/__fixtures__
!scripts/ai/evaluation
!scripts/ai/generation
!scripts/ai/test-design
!scripts/ai/test-automation
```

At the time of this decision the tarball is 48 files (previously 80): the 32
removed files are exactly the private `generation` (8), `test-design/` (10)
and `test-automation` (14) trees. The removals were verified against the
dependency graph — none is required by any supported entrypoint.

### Fail-closed invariant

For every `.js` file in the tarball, every relative `require` must resolve to a
file that is also in the tarball, and no shipped file may use a non-literal
`require(...)` or `import()`. `test/installation/package-surface.test.js`
asserts this on the **actual `npm pack` manifest**, so a future change that
makes a public module depend on a private tree fails in CI instead of shipping
a package that cannot start. A dynamic local load found by review must be
listed explicitly rather than assumed excludable.

## The ACG-A3 adapter

`scripts/ai/test-design/evidence-ingestion.js` — including
`ingestRequirementArtifactsAsEvidence` — is `REPOSITORY_ONLY_PRIVATE` for
packaging purposes. The `RequirementArtifact[]` → `#22` evidence seam decided
by `A-3` (`docs/architecture-model-boundary-v1.md`) exists inside the
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
- It does not resolve `D-2` (the `test-design.js` / `test-design/` naming
  collision).
- It does not decide npm-registry publication, versioning or release policy
  (`ID-3`).
- It does not narrow the shipped-but-unexported root CI-triage helpers named
  above.
- It does not close Architecture Conformance Gate finding `A-1` on the
  canonical `ROADMAP.md` — that is a separate closure-sync mission after
  independent review, merge and post-merge certification.
