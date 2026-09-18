# Branch Inventory v1

CRW2-B1, addressing conformance finding B-1.

## Why this exists

A conformance analysis flagged `B-1`: this repository had no durable,
versioned answer to *"what branch classes exist, what do they mean, which
branch roles are long-lived/protected/transient, and how can tooling or a
reviewer distinguish them without relying on undocumented naming
folklore?"* Before this document, that answer existed only as habit: a live
inventory of this repository's own branches
(`gh api repos/.../branches`) shows 13 distinct, recurring purpose-prefix
conventions (`feature/`, `docs/`, `chore/`, `fix/`, `corrective/`,
`refactor/`, `experiment/`, `evidence/`, `independence/`, `installation/`,
`proof/`, `spike/`, `dependabot/`) plus `main` - none of it was written down
in `ROADMAP.md` or `README.md`, and no script or workflow classified a
branch name at all (`.github/workflows/*.yml` only ever filter on the
literal branch `main`, never on a naming pattern). A new contributor, or a
future automation, had no single place to learn this.

**This document does not implement anything.** The runtime enforcement of
the decision recorded here lives in
[`scripts/diagnostics/branch-inventory.js`](../scripts/diagnostics/branch-inventory.js)
- specifically its `MANIFEST` object and `validateManifest()` /
`classifyBranch()` functions. If this decision ever changes, update both
this document and that module together.

## The model: one named long-lived branch, thirteen transient/automation classes

This repository has exactly **one** long-lived, GitHub-protected branch:
`main` (confirmed live via `gh api repos/.../branches/main/protection` -
required status checks, `enforce_admins`, no force-push/deletion). Every
other branch observed is transient: created for one PR, merged, and
deleted. A manifest that tried to list every transient branch by exact name
would be stale within days. This is why the manifest uses a **hybrid
model**: `main` is a `namedBranches` exact entry; everything else is a
`classes` purpose-prefix pattern.

| Class | Pattern | Kind | Purpose |
|---|---|---|---|
| `main` (named) | exact `main` | `long-lived` | Sole integration target. Every PR merges here; nothing merges from here. |
| `feature` | `^feature/` | `transient` | New capability implementation. |
| `docs` | `^docs/` | `transient` | Documentation, canonical-record, or governance-metadata-only changes. |
| `chore` | `^chore/` | `transient` | Routine maintenance/cleanup not tied to a specific finding fix. |
| `fix` | `^fix/` | `transient` | Targeted bug fix. |
| `corrective` | `^corrective/` | `transient` | Standalone corrective work opened as its own PR/branch, distinct from a `Cn` corrective commit appended to an existing implementation branch (this repository's more common pattern for post-review correctives - see e.g. `feature/crw2-a2-strict-evaluation`'s own `C1`/`C2` commits). |
| `refactor` | `^refactor/` | `transient` | Internal restructuring with no behavior change and no finding closure claimed. |
| `experiment` | `^experiment/` | `transient` | Exploratory/research work (e.g. AI evaluation knowledge experiments). May carry local-only, non-pushed state (e.g. a git stash) tied to that specific experiment - never assume a branch in this class is disposable without checking for such state first. |
| `evidence` | `^evidence/` | `transient` | Evidence-gathering/reproduction for a specific investigation. |
| `independence` | `^independence/` | `transient` | Full Project Independence initiative work (`FPI-*`, `TI-*`). |
| `installation` | `^installation/` | `transient` | Package installability/public-API initiative work (`ID-*`). |
| `proof` | `^proof/` | `transient` | Standalone proof-of-concept demonstration. Not necessarily intended to merge - check the branch's own PR/description before assuming merge intent (e.g. `proof/acq-upg-version-b` is explicitly marked "DO NOT MERGE" in its own name). |
| `spike` | `^spike/` | `transient` | Throwaway technical exploration, not expected to merge as-is. |
| `dependabot` | `^dependabot/` | `automation` | Bot-created dependency-update branch (`npm`/`github-actions` ecosystems, see `.github/dependabot.yml`). Created, merged, and deleted by Dependabot, not a human author. |

Every one of these 13 patterns, plus `main`, is evidenced against this
repository's own live branch list at the time this document was written -
none is speculative. Two historical, now-superseded prefix conventions
(`feat/` - an older synonym for `feature/`, and one-off `ci/`, `security/`,
`hardening/` branches) were deliberately **not** added as current classes:
they exist only as already-merged-and-deleted-from-GitHub local branch
remnants, never live, and do not represent an active convention a new
branch should follow. A future branch using one of those prefixes will
classify `UNKNOWN` (see below) rather than being silently misclassified -
that is the correct, safe outcome for a discontinued convention, not a gap
that needs to be closed here.

## Fail-closed classification semantics

`classifyBranch(name, manifest)` (in
[`branch-inventory.js`](../scripts/diagnostics/branch-inventory.js)) never
throws and never silently resolves an unrecognized input to a privileged
classification:

- **`NAMED`** - exact match against `namedBranches` (currently only `main`).
- **`CLASSIFIED`** - exactly one `classes` pattern matches.
- **`UNKNOWN`** - zero patterns match. This is the expected, safe outcome
  for a branch using a discontinued or not-yet-recognized convention - it
  is informational today (see "What this does not do" below), never a
  silent pass into a privileged class.
- **`AMBIGUOUS`** - more than one pattern matches. The manifest's own 13
  patterns are structurally non-overlapping (distinct literal prefixes), so
  this should never occur against the real manifest; `classifyBranch()`
  still checks for it defensively (see its own adversarial test coverage)
  rather than relying on JavaScript object/iteration order as implicit,
  undocumented precedence.
- **`INVALID_INPUT`** - the branch-name argument itself is not a plausible
  branch short name (non-string, empty, contains whitespace, or contains
  `refs/`).
- **`INVALID_MANIFEST`** - the supplied `manifest` argument itself fails
  `validateManifest()`. Distinct from `INVALID_INPUT` (which describes the
  branch-name argument) and from `UNKNOWN` (which presumes a *valid*
  manifest that simply has no matching class) - an invalid manifest is
  never silently treated as "no class matched", because that would let a
  caller mistake "the contract itself is broken" for "this branch is
  merely unrecognized". Precedence is branch-input shape first, then
  manifest validity, then classification - see `classifyBranch()`'s own
  docstring. `errors` (the same array `validateManifest()` itself would
  return) is included so a caller understands why classification was
  refused.

**`classifyBranch()` never merely assumes a supplied manifest is valid.**
Every call - including against the built-in default `MANIFEST` - runs
`validateManifest()` first and only proceeds to classification on a
`VALID` result. This closes a real gap: before this hardening, a
caller-supplied manifest that `validateManifest()` would reject as
`INVALID` (e.g. a named branch entry with an invalid `kind`, or a `classes`
entry with an unparseable regex) could still be silently consumed by
`classifyBranch()` and produce an authoritative-looking `NAMED`/`CLASSIFIED`
result - or, for some malformed shapes (e.g. `null`), throw instead of
returning a status at all. Neither is acceptable for a function documented
as fail-closed and never-throwing; `classifyBranch()` is guaranteed today
to never throw for any `manifest`/`branchName` shape, and an invalid
manifest can never produce a privileged classification.

**Input contract - no hidden normalization.** `classifyBranch()` expects a
short branch name exactly as `git rev-parse --abbrev-ref HEAD` or
`git branch --format=%(refname:short)` would print it. A `refs/heads/`- or
remote-qualified form (e.g. `origin/main`) is **not** stripped and will not
match `main` - `origin/main` classifies `UNKNOWN` by design. A caller that
needs to handle those forms must normalize explicitly before calling this
function; the function never guesses a caller's intent.

## Manifest validation - fail-closed on malformed contract data

`validateManifest()` never throws and never treats an unrecognized or
contradictory manifest shape as valid. It rejects (among other checks):

- an unsupported or missing `schemaVersion` (only `1` is currently
  supported);
- a missing/unrepresented `defaultBranch`;
- an invalid regular-expression `pattern`;
- two classes sharing the same `pattern` (a real duplicate-mapping risk,
  not a false positive - iteration order would otherwise silently decide
  which one "wins");
- a class `pattern` that would also match a `namedBranches` exact name (a
  class must never be able to reclassify a named, long-lived branch);
- an unrecognized `kind` enum value, on either a named branch or a class;
- a `transient`/`automation` class declaring `protected: true` - only a
  `namedBranches` (long-lived) entry may carry a protection expectation;
  this catches a contradictory manifest edit before it can mislead a
  reader into thinking a transient branch class is protected.

None of these fall back to "assume valid" - every failure mode above
returns `{ result: "INVALID", errors: [...] }`, and the CLI
(`node scripts/diagnostics/branch-inventory.js`) exits non-zero if the
built-in `MANIFEST` itself is ever invalid.

## Declared expectation vs. observed GitHub state

This document and `MANIFEST` record a **declared** contract: what a branch
class is *supposed* to mean. They are not, by themselves, proof that live
GitHub branch protection currently matches that declaration. At the time
this document was written, `main`'s live protection was independently
observed (`gh api repos/.../branches/main/protection`,
`gh api repos/.../branches?...&protected=true`) to match the `main`
`namedBranches` entry's `protected: true` expectation, and no other branch
was observed to carry any protection - but that observation is a
point-in-time fact, not something this static manifest re-proves on every
read. A future optional live-comparison diagnostic could check this
continuously; none exists yet (see "What this does not do"). If one is
added, its result vocabulary must distinguish `PASS` from an actual
mismatch from `INFRA_ERROR`/`UNKNOWN` (an API/permission failure must never
be reported as `PASS`) - the same fail-closed evidence discipline this
repository already applies in
[`scripts/diagnostics/audit-drift-check.js`](../scripts/diagnostics/audit-drift-check.js).

## Branch name is not project identity

Critical invariant, unrelated to classification correctness but essential
to this repository's independence model: **a branch name must never become
project/target identity.** `classifyBranch()`'s output (a class name, kind,
and protection expectation) is governance metadata only. Nothing in this
module selects a `ProjectProfile`, a target repository, or a customer
configuration based on a branch name, and nothing should ever be added that
does - that would violate this repository's existing "no target registry,
no target-name branching, no config autodiscovery" invariants (see
`scripts/ai/repository-root.js` and the Full Project Independence
architecture it supports).

## What this does not do

- It does not close `B-4` (fail-closed test-infrastructure verification).
  This module's own fail-closed manifest/classification behavior is a
  local property of the branch-inventory tool, not a global `B-4` closure.
- It does not close `B-6` (versioned governance/process knowledge). A
  branch-inventory contract is one governance artifact, not the whole
  governance/process knowledge layer `B-6` requires.
- It does not close `GOV-VERIFY-1` (future reusable merge-evidence
  verification: exact-HEAD/TREE authority, branch-protection verifier,
  pack-diff authority). No such engine is added here.
- It does not enforce anything in CI today. `classifyBranch()`/
  `validateManifest()` are exercised by
  [`branch-inventory.test.js`](../scripts/diagnostics/branch-inventory.test.js),
  which runs under the existing `Unit tests` required check (via
  `test:unit`'s existing `scripts/diagnostics/*.test.js` glob) - no new
  required CI context was created. An `UNKNOWN` classification is
  informational only today; nothing currently blocks a merge on it.
- It does not perform live GitHub comparison automatically, and does not
  require network access or credentials for its core validation/
  classification tests.
- It does not claim every currently-open branch on GitHub has been
  individually verified against this taxonomy going forward - only that,
  at the time this document was written, every branch class actually
  observed live classifies correctly (see this module's own test suite).
