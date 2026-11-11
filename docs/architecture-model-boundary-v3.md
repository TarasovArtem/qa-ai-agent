# Architecture Model Boundary v3

CRW2-ACG-A3, addressing Architecture Conformance Gate finding A-3; path
transition ACG-D2, addressing finding D-2; canonical requirement projection
TPR-G2-R1 (`OD-TPR-R1-IMPLEMENTATION-1`, design direction `PD-R1-1`),
addressing TPR G2 finding R1.

Status: **CURRENT**.

Supersedes: [`architecture-model-boundary-v2.md`](architecture-model-boundary-v2.md).

## What changed from v2

v2's decision (`SEPARATE_BOUNDED_CONTEXTS`), the single adapter seam
(`RequirementArtifact[]` → `#22` evidence), the adapter
`ingestRequirementArtifactsAsEvidence()`, its text projection, its limits,
`EvidenceRef` ownership, one-way direction, explicit opt-in and fail-closed
validation are carried forward unchanged.

v3 adds exactly one bounded, deterministic projection to that same seam: the
**canonical requirement projection** (below). It copies a validated
`RequirementArtifact`'s `content` and each `acceptanceCriteria[].text`,
verbatim, into `RequirementModel.requirements[]`, with requirement ids taken
only from the `#22`-owned `EvidenceRef` identity space. As a consequence the
`RequirementModel` generator no longer authors requirement wording: its
provider contributes only `assumptions[]` and `openQuestions[]`.

Nothing else crosses the boundary. `RequirementArtifact` and
`RequirementModel` remain separate bounded contexts with separate identity
spaces; no other field of either model is copied, inferred or shared.

## Why this exists

The Architecture Conformance Gate flagged `A-3`: this repository never
explicitly decided whether `RequirementArtifact`/`TestDesignArtifact`
(RTI-1/RTI-4, deterministic) and `RequirementModel`/`TestCaseModel`
(`#22`, provider-assisted) are the same model family, adapted variants of
each other, or genuinely separate bounded contexts. v1/v2 resolved that as
separate bounded contexts with one evidence seam.

TPR G2 finding R1 showed the cost of the v2 arrangement for one specific
property, **verbatim requirement fidelity**. Under v2 the provider *derived*
requirement text from evidence. In the bounded TPR G2 design run the
provider paraphrased three canonical source statements (`REQ-1.AC-1`,
`REQ-2.AC-1`, `REQ-3.content`), so the strict external Design Gate's
`design.acceptance-criteria-preserved` check stopped. Prompting alone cannot
guarantee byte-exact preservation; only a deterministic projection can.
`PD-R1-1` (design direction, PO-approved) chose that projection;
`OD-TPR-R1-IMPLEMENTATION-1` authorized this transition and its
implementation together.

**This document does not implement `#22`/`#23`'s own generation logic,
prompts, or provider calls.** It defines the architectural boundary and
records the conversions this boundary permits; the runtime code that
implements them is named in each section, reviewed and merged alongside
this document.

## Decision

```text
A3_DECISION (v3): SEPARATE_BOUNDED_CONTEXTS, with one explicit, opt-in,
                  one-directional adapter seam (RequirementArtifact[] -> #22
                  evidence + the bounded canonical requirement projection).
                  Not unification. Not a bidirectional adapter. Not a shared
                  identity space.
```

## Model responsibilities

### `RequirementArtifact` (RTI-1, deterministic)

- Normalized, source-independent, **already-curated** requirement input
  for the deterministic RTI pipeline (RTI-1 through RTI-8).
- Deliberately has **no `projectId`** — RTI's own source-independence
  rule (see `scripts/ai/requirement-artifact.js`'s own docstring)
  explicitly excludes project-scoping from this contract.
- Carries `source` as inert provenance metadata (never filesystem
  authority, never a behavioral branch point).
- Has **no evidence-grounding concept** — it assumes its own input is
  already trustworthy structured data, not raw low-trust material.
- It is **not** `RequirementModel v0`, **not**
  `RequirementModel`-compatible, and **not** an AI grounding model. v3
  does not change that: the projection below reads two of its fields; it
  does not make the two models interchangeable.

### `RequirementModel` (`#22`, deterministic requirements + provider-assisted gaps)

- Belongs to the `#22` generative bounded context. Its frozen v1 schema
  (`scripts/ai/generation/requirement-model.js`) is unchanged.
- Purpose: a validated, evidence-grounded, **project-scoped** requirement
  representation.
- Carries `schemaVersion`/`kind` (frozen v1 contract), `projectId`
  (A2-isolation-enforced), a mandatory `evidenceRefs` grounding registry
  (every requirement must cite at least one evidence reference that
  actually exists — the core anti-hallucination invariant), plus
  `assumptions[]`/`openQuestions[]` for explicitly representing gaps.
- **Since v3, ownership is split:** `id`, `schemaVersion`, `kind`,
  `projectId`, `evidenceRefs` and `requirements[]` are fixed
  deterministically (canonical projection + canonical evidence);
  `assumptions[]` and `openQuestions[]` are the only provider-authored
  content.
- Is **not interchangeable** with `RequirementArtifact` — the grounding
  requirement alone makes silent equivalence impossible without either
  inventing fake evidence or weakening the anti-hallucination invariant.

### `TestDesignArtifact` (RTI-4, deterministic)

- Belongs to deterministic RTI.
- Purpose: a flat, source-preserving, one-idea-per-acceptance-criterion
  traceability record consumed by RTI-5's coverage analysis.
- Deliberately does **not** model procedural steps, automation planning,
  framework-specific execution structure, or provider reasoning — see
  `scripts/ai/test-design.js`'s own docstring.
- Not changed by this document.

### `TestCaseModel` (`#22`/`#23`, provider-assisted)

- Belongs to `#22`/`#23` generative architecture.
- Purpose: provider-assisted, project-scoped, **step-structured** test
  cases (`steps[{action, expectedResult, requirementIds}]`,
  `preconditions`, structured `priority`) specifically designed to feed
  `AutomationCandidate`/`AutomationPlan` (`#23`) generation.
- Contains semantics `TestDesignArtifact` intentionally does not carry.
  No implicit conversion in either direction. Unchanged by v3: it still
  cites requirements by `RequirementModel.requirements[].id`, which are now
  the canonical ids below.

## The allowed transforms

```text
RequirementArtifact[]
        |
        v  (explicit, opt-in adapter:
        |   ingestRequirementArtifactsAsEvidence())
        +--> evidence item(s) + mapping                      (v1/v2, unchanged)
        +--> canonicalRequirements                           (v3, bounded)
                    |
                    v  (#22C generator: deterministic assembly;
                    |   provider adds assumptions/openQuestions only)
              RequirementModel
```

The adapter still never constructs a `RequirementModel` itself, never calls
a provider, and never invents `schemaVersion`/`kind`/`projectId`/
`evidenceRefs` on its own authority. It returns the projection as data; the
`#22C` generator assembles the model from that data, the canonical evidence
and the caller-supplied `projectId`, and the frozen v1 validator remains the
schema authority.

### Allowed transformations

- `RequirementArtifact[]` → `#22` evidence bundle, via
  `ingestRequirementArtifactsAsEvidence()`. Explicit, opt-in (a caller
  must choose to call this function; nothing invokes it implicitly),
  one-directional, deterministic, offline, provider-free, lossy by
  design (see "Text projection" below). Unchanged from v2.
- `RequirementArtifact[]` → `RequirementModel.requirements[]`, **only** via
  the canonical requirement projection defined below and returned by the
  same adapter call as `canonicalRequirements`. No other route.

### Forbidden transformations

```text
RequirementArtifact -> RequirementModel, any field other than
  requirements[].text via the canonical projection:  FORBIDDEN
RequirementArtifact.id / acceptanceCriteria[].id ->
  any RequirementModel or EvidenceRef id:            FORBIDDEN
RequirementModel -> RequirementArtifact:              FORBIDDEN
TestCaseModel -> TestDesignArtifact:                  FORBIDDEN
TestDesignArtifact -> TestCaseModel:                  FORBIDDEN
```

Model fields must never be silently copied across these bounded contexts
merely because field names are similar (e.g. both `RequirementArtifact`
and `RequirementModel` having a concept of "id" is not license to treat
them as the same id space). Any future adapter or projection beyond the
ones defined here requires its own explicit versioned architecture decision
and its own tests — never an ad hoc field-copy.

### Text projection (what becomes evidence)

Unchanged from v2. The adapter's projection is deterministic, offline, and
does not invoke an AI/provider: same validated artifact always produces
byte-identical evidence text. Included, in fixed order: `title`, then
`content` (when present), then `acceptanceCriteria[].text` (when present, in
original array order), as the lines `Title: …`, `Content: …`,
`Acceptance Criteria:` and `- …`. Explicitly excluded, with reasons:

- `source.location` — never filesystem/executable authority; provenance
  stays in the adapter's own `mapping` output, never in evidence text.
- `metadata` — no evidence-backed reason yet to surface arbitrary
  caller-supplied metadata as grounding text.
- `relationships[]` — structural cross-references, not requirement
  wording; resolving them across a collection would invent an
  RTI collection-level responsibility `RequirementArtifact`'s own
  contract explicitly defers.
- `type`, `priority`, `labels` — structural/classification metadata, not
  requirement wording.

### Canonical requirement projection (v3)

Implemented in
[`scripts/ai/generative-test-design/evidence-ingestion.js`](../scripts/ai/generative-test-design/evidence-ingestion.js)
(`ingestRequirementArtifactsAsEvidence()` → `canonicalRequirements`;
`verifyCanonicalRequirements()`).

**Leaves.** For each validated artifact, in input (file) order: one leaf for
`content` when present, then one leaf per `acceptanceCriteria[]` entry in
original array order. `title` is never a leaf. Every validated artifact has
at least one leaf (RTI-1 requires `content` or a non-empty
`acceptanceCriteria`).

**Requirement per leaf.**

```text
id:             <evidenceRefId>.content                 content leaf
                <evidenceRefId>.ac-<NNNN>               criterion leaf, NNNN = 1-based
                                                        array position, zero-padded to 4
text:           the exact source string - byte-for-byte; never trimmed,
                case-folded, whitespace-collapsed, re-punctuated, translated,
                summarized or otherwise normalized
evidenceRefIds: [<evidenceRefId>]                       the artifact's own evidence item
```

Example (three artifacts → seven requirements):

```text
evidence-0001.content  evidence-0001.ac-0001  evidence-0001.ac-0002
evidence-0002.content  evidence-0002.ac-0001
evidence-0003.content  evidence-0003.ac-0001
```

**Identity separation.** `<evidenceRefId>` is the canonical id the adapter
itself assigned (`evidence-NNNN`). `RequirementArtifact.id` and optional
`acceptanceCriteria[].id` values are **never** used: RTI-1 bounds them only to
200 characters, does not require them to be trim-stable or present, and does
not check criterion ids for uniqueness, so they cannot be v1 requirement ids;
and using them would merge the two identity spaces this decision keeps
separate. Duplicate or missing source criterion ids therefore cannot change or
break a canonical id. Traceability back to the source artifact and criterion
is the adapter's `mapping` (`requirementArtifactId` ↔ `evidenceRefId`) plus
the criterion position encoded in `ac-NNNN`.

**RequirementModel assembly** (`#22C`,
[`requirement-model-generator.js`](../scripts/ai/generative-test-design/requirement-model-generator.js)):
`id` is the fixed `requirement-model-0001`; `evidenceRefs` is the full
canonical registry in bundle order (every evidence item is cited);
`requirements` is the canonical projection, unchanged; `assumptions` and
`openQuestions` are the provider's only contribution. The provider response
must be exactly `{ "assumptions": [...], "openQuestions": [...] }`; any other
key (including `requirements`, `evidenceRefs`, `id`, `projectId`,
`schemaVersion`, `kind`) is rejected as `UNKNOWN_FIELD`, within the existing
bound of at most two provider attempts. There is no fallback to
provider-authored requirements.

**Fail-closed conditions** (all before any provider call):

- more than 200 leaves (`LIMITS.MAX_REQUIREMENTS` of the frozen v1
  `RequirementModel`) → the adapter refuses with a `$.artifacts` error;
  the CLI reports its existing `REQUIREMENTS_EVIDENCE_REFUSED` (exit 4). Never
  truncated, merged or delegated to a provider;
- a leaf text that is not representable as v1 requirement text, an invalid or
  duplicate canonical id (both unreachable by construction; checked anyway);
- a missing, empty, reordered, re-identified, reworded or otherwise misaligned
  `canonicalRequirements` list handed to the generator — re-proven against the
  bundle's own evidence text by `verifyCanonicalRequirements()`; evidence text
  that does not have the adapter's fixed projection line format (for example
  ordinary direct user text from `ingestRequirementEvidence()`) cannot yield
  canonical requirements and is refused.

`verifyCanonicalRequirements()` is a check of **text shape and exact
equality**, not of origin: a bundle carries no marker of which ingestion path
produced it. Direct user text that itself has exactly the projection line
format (`Title: …` / `Content: …` / `Acceptance Criteria:` / `- …`) is
therefore parsed the same way, and a requirement list that exactly equals its
leaves is accepted. This does not weaken verbatim fidelity (every accepted
requirement text is still an exact line of the supplied evidence, with ids
from the canonical `EvidenceRef` id) and is not reachable from the CLI, whose
only evidence source is `ingestRequirementArtifactsAsEvidence()`; it is
recorded by a regression test in `evidence-ingestion.test.js`. Distinguishing
the two origins would require a new bundle field and its own versioned
decision.

**Re-validation of fresh and persisted designs** (CLI,
[`scripts/ai/cli/run-artifacts.js`](../scripts/ai/cli/run-artifacts.js)
`validateDesign`): every command that accepts or re-reads a design
recomputes the projection from the requirements file and requires the
RequirementModel's `id`, `evidenceRefs` and `requirements` to equal it
exactly. Fresh output that does not → existing `PROVIDER_OUTPUT_REFUSED`
(exit 6), nothing written; a persisted design that does not → existing
`RUN_ARTIFACT_INVALID` (exit 4) before any provider call.

### Artifact evidence budget

Unchanged from v2. **RTI-1 structural validity alone does not guarantee a
`RequirementArtifact` is representable by this adapter** (ACG-A3 corrective,
finding ACG-A3-R02). `RequirementArtifact.content` is valid up to 20000
characters and `acceptanceCriteria` up to 200 entries at up to 20000
characters each (`scripts/ai/requirement-artifact.js`) - far more than a
single evidence item can carry.

The adapter enforces its own explicit, named budget
(`ARTIFACT_EVIDENCE_LIMITS` in `scripts/ai/generative-test-design/evidence-ingestion.js`)
against each artifact's deterministic projection, **before** any evidence
bundle is built:

```text
MAX_PROJECTED_TEXT_LENGTH:            4000   (per artifact projection)
MAX_AGGREGATE_PROJECTED_TEXT_LENGTH: 20000   (per collection)
canonical requirements (v3):           200   (per collection; frozen v1 MAX_REQUIREMENTS)
```

An artifact whose projection exceeds the per-artifact limit fails closed
with an artifact-facing `$.artifacts[i]` error; a collection whose combined
projected text exceeds the aggregate limit, or that projects more than 200
canonical requirements, fails closed with a `$.artifacts` error. No case
truncates, summarizes, or otherwise silently drops any part of a projection -
a caller either gets the complete projection or a clear rejection, never a
partial one. Every leaf therefore also fits the v1 requirement text bound
(4000).

The reasons the text limits equal `#22C`'s own trust-boundary limits, and are
not raised to RTI-1's larger structural limits, are unchanged from v2: `#22C`
independently re-validates every bundle against the same thresholds, so a
relaxation here could never be honored end-to-end.

### Traceability without touching the frozen `EvidenceRef` schema

`EvidenceRef` identity (`id`/`kind`/`sourceId`) remains entirely owned by
`evidence-ingestion.js`'s existing canonical assignment logic — the
adapter never lets a `RequirementArtifact.id` become an `EvidenceRef.id`.
Traceability from artifact to evidence item is carried in a separate,
adapter-owned `mapping` array
(`{requirementArtifactId, evidenceRefId}[]`, input order preserved),
returned alongside the unchanged evidence `bundle` — no field was added
to the frozen v1 `EvidenceRef` shape. Canonical requirement ids extend that
same `#22` identity space with a fixed suffix; no field was added to the
frozen v1 `RequirementModel` shape either.

### Project identity

`RequirementArtifact` deliberately has no `projectId`. The adapter
therefore **requires** an explicit, caller-supplied `projectId` — it is
never inferred from `source.system`, `metadata`, `source.location`, a
target name, or `cwd`. This matches every other `#22`/RTI contract's
existing project-identity rule: `ProjectProfile.id` (or an equivalent
explicit caller value) is the only project-identity authority anywhere
in this codebase. The assembled `RequirementModel.projectId` is that same
caller-supplied value.

## Trust boundary

```text
RequirementArtifact:           validated deterministic source
Adapter:                       deterministic projection only (evidence text,
                               mapping, canonical requirements)
Evidence ingestion:            canonical EvidenceRef owner (unchanged)
RequirementModel generator:    deterministic assembly of requirements/
                               evidenceRefs/id; low-trust provider boundary
                               for assumptions/openQuestions only
RequirementModel validator:    schema authority (unchanged)
Cross-model validation:        generative-chain authority (unchanged)
CLI design re-validation:      canonical-projection equality on fresh and
                               persisted designs
```

No provider output becomes trusted merely because its upstream evidence
happened to originate from an already-validated `RequirementArtifact`.
Provider-authored `assumptions`/`openQuestions` are validated exactly as
before (frozen v1 primitives, bounded, duplicate-id checked) and remain
low-trust text; they never alter, add or remove a canonical requirement. The
projection does not change, weaken, or bypass any existing trust boundary in
the `#22` pipeline: the external Design Gate, the frozen validators under
`scripts/ai/generation/*`, canonical provenance checks and the bounded retry
policy are unchanged.

## Public API / package boundary

This document does **not** create, imply, or require a public package
API change. `#22`/`#23` remain intentionally internal (Architecture
Conformance Gate finding `A-1`, `PRIVATE_GENERATIVE_SURFACE` in
`package-surface-v2.md`) — `ingestRequirementArtifactsAsEvidence()` and
`verifyCanonicalRequirements()` are exported only from
`scripts/ai/generative-test-design/evidence-ingestion.js` (an internal module
path), never from `scripts/ai/index.js`, and `package.json`'s `exports`
field is unchanged. No CLI command, flag, exit code, reason code or artifact
schema version changes.

The product behavior of `qa-agent design` does change (requirement wording,
count and ids now follow the source; requirement collections of more than 200
leaves are refused). That compatibility consequence is carried by the product
version, not by this document: the implementing change moves the product to
candidate `2.0.0`, and runs created by earlier versions are refused by the
existing product-version binding (`RUN_BINDING_MISMATCH`).

## Future RAG / Memory relationship

Unchanged from v2. A future retrieval (`RAG`) or persistent-memory (`MEM`)
component may enrich `#22`'s evidence-ingestion stage with additional
evidence sources — but any such future source must still flow through an
equally explicit, equally validated ingestion seam, and must never be
treated as a canonical `RequirementModel` or `RequirementArtifact` field
merely because it originated from a trusted-sounding retrieval system. In
particular, the v3 canonical requirement projection applies to validated
`RequirementArtifact`s only; it is not a precedent for projecting any other
source into `RequirementModel.requirements[]`.

## What this document does not do

- It does not implement `#22`'s or `#23`'s own generation logic, prompts,
  or provider calls.
- It does not change the frozen v1 contracts under `scripts/ai/generation/*`,
  `RequirementArtifact` (RTI-1), the external TPR Design Gate, or any CLI
  command, flag, exit code or reason code.
- It does not decide the package/public-API surface (`A-1`, see
  `package-surface-v2.md`).
- It does not expand `TestDesignArtifact` with step-level structure, and
  does not shrink `TestCaseModel`'s existing structure.
- It does not address TPR G2 finding R2 (gate execution environment), does
  not authorize a new G2 attempt, G3/G4/G5, a release, or any change to the
  frozen TPR `1.0.2` evidence.
- It does not create a machine-readable manifest, resolver, or runtime
  registry of model relationships — this is a normative document read by
  humans/LLMs and enforced by each contract's own existing validator and the
  code named above, not a new executable authority.
- It does not change canonical `ROADMAP.md` lifecycle status — that is a
  separate, later closure-sync mission after independent review, merge, and
  post-merge certification of this transition.
