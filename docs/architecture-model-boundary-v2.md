# Architecture Model Boundary v2

CRW2-ACG-A3, addressing Architecture Conformance Gate finding A-3; path
transition ACG-D2, addressing finding D-2.

Status: **CURRENT**.

Supersedes: [`architecture-model-boundary-v1.md`](architecture-model-boundary-v1.md).

## What changed from v1

The A-3 decision (`SEPARATE_BOUNDED_CONTEXTS`), the single permitted seam
(`RequirementArtifact[]` → `#22` evidence), the adapter
`ingestRequirementArtifactsAsEvidence()`, its limits, `EvidenceRef`
ownership, one-way direction, explicit opt-in and fail-closed validation are
carried forward unchanged. Only the executable path of the adapter changed:
ACG-D2 renamed the private directory `scripts/ai/test-design/` to
`scripts/ai/generative-test-design/`. This is a path/authority transition,
not a boundary redesign.

Subject: the relationship between RTI's deterministic model stack
(`RequirementArtifact`, `TestDesignArtifact`) and the `#22`/`#23`
generative model stack (`RequirementModel`, `TestCaseModel`).

## Why this exists

The Architecture Conformance Gate flagged `A-3`: this repository never
explicitly decided whether `RequirementArtifact`/`TestDesignArtifact`
(RTI-1/RTI-4, deterministic) and `RequirementModel`/`TestCaseModel`
(`#22`, provider-assisted) are the same model family, adapted variants of
each other, or genuinely separate bounded contexts. A prior conformance
analysis already correctly warned that any "one generic core" language
elsewhere describes RTI's own internal core only, not a resolved claim
about this relationship (see `ROADMAP.md`) — but no document actually
*resolved* the question until now.

**This document does not implement `#22`/`#23`'s own generation logic,
prompts, or provider calls.** It defines the architectural boundary and
records the one explicit conversion this boundary permits; the runtime
adapter that implements that one conversion lives in
[`scripts/ai/generative-test-design/evidence-ingestion.js`](../scripts/ai/generative-test-design/evidence-ingestion.js)
(`ingestRequirementArtifactsAsEvidence()`), reviewed and merged alongside
this document.

## Decision

```text
A3_DECISION: SEPARATE_BOUNDED_CONTEXTS, with one explicit, opt-in,
             one-directional adapter seam (RequirementArtifact[] -> #22
             evidence). Not unification. Not a bidirectional adapter.
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
  `RequirementModel`-compatible, and **not** an AI grounding model — it
  predates and is architecturally unrelated to `#22`'s own grounding
  concept.

### `RequirementModel` (`#22`, provider-assisted)

- Belongs to the `#22` generative bounded context.
- Purpose: convert low-trust, **project-scoped** evidence into a
  validated, evidence-grounded requirement representation.
- Carries `schemaVersion`/`kind` (frozen v1 contract), `projectId`
  (A2-isolation-enforced), a mandatory `evidenceRefs` grounding registry
  (every requirement must cite at least one evidence reference that
  actually exists — the core anti-hallucination invariant), plus
  `assumptions[]`/`openQuestions[]` for explicitly representing gaps.
- Is **not interchangeable** with `RequirementArtifact` — the grounding
  requirement alone makes silent equivalence impossible without either
  inventing fake evidence or weakening the anti-hallucination invariant.

### `TestDesignArtifact` (RTI-4, deterministic)

- Belongs to deterministic RTI.
- Purpose: a flat, source-preserving, one-idea-per-acceptance-criterion
  traceability record consumed by RTI-5's coverage analysis.
- Deliberately does **not** model procedural steps, automation planning,
  framework-specific execution structure, or provider reasoning — see
  `scripts/ai/test-design.js`'s own docstring: "no executable test/
  automation output... is exported here yet."
- Not expanded by this document or this Gate slice.

### `TestCaseModel` (`#22`/`#23`, provider-assisted)

- Belongs to `#22`/`#23` generative architecture.
- Purpose: provider-assisted, project-scoped, **step-structured** test
  cases (`steps[{action, expectedResult, requirementIds}]`,
  `preconditions`, structured `priority`) specifically designed to feed
  `AutomationCandidate`/`AutomationPlan` (`#23`) generation.
- Contains semantics `TestDesignArtifact` intentionally does not carry.
  No implicit conversion in either direction.

## The one allowed transform

```text
RequirementArtifact[]
        |
        v  (explicit, opt-in adapter:
        |   ingestRequirementArtifactsAsEvidence())
evidence item(s)
        |
        v  (existing #22 provider-assisted grounding stage,
        |   unchanged by this document)
RequirementModel
```

This does **not** mean `RequirementArtifact == RequirementModel`. The
adapter only produces evidence *input* for `#22`'s existing grounding
stage — it never constructs a `RequirementModel` itself, never calls a
provider, and never invents `RequirementModel` fields
(`schemaVersion`/`kind`/`projectId`/`evidenceRefs`/etc.) on its own
authority.

### Why this specific direction, and only this one

`evidence-ingestion.js` (`#22B`) today accepts only bounded, direct
user-provided requirement *text* as its evidence source. A
`RequirementArtifact` is a **more grounded** evidence source than raw
text — it is already structurally validated, already has a title/content/
acceptance-criteria shape, and already carries its own provenance. This
is a genuine, currently-missing seam, not a speculative one.

### Allowed transformations

- `RequirementArtifact[]` → `#22` evidence bundle, via
  `ingestRequirementArtifactsAsEvidence()`. Explicit, opt-in (a caller
  must choose to call this function; nothing invokes it implicitly),
  one-directional, deterministic, offline, provider-free, lossy by
  design (see "Text projection" below).

### Forbidden transformations

```text
RequirementArtifact -> RequirementModel (direct):  FORBIDDEN
RequirementModel -> RequirementArtifact:            FORBIDDEN
TestCaseModel -> TestDesignArtifact:                FORBIDDEN
TestDesignArtifact -> TestCaseModel:                FORBIDDEN
```

Model fields must never be silently copied across these bounded contexts
merely because field names are similar (e.g. both `RequirementArtifact`
and `RequirementModel` having a concept of "id" is not license to treat
them as the same id space). Any future adapter beyond the one defined
here requires its own explicit versioned architecture decision and its
own tests — never an ad hoc field-copy.

### Text projection (what becomes evidence)

The adapter's projection is deterministic, offline, and does not invoke
an AI/provider: same validated artifact always produces byte-identical
evidence text. Included, in fixed order: `title`, then `content` (when
present), then `acceptanceCriteria[].text` (when present, in original
array order). Explicitly excluded from v1, with reasons:

- `source.location` — never filesystem/executable authority; provenance
  stays in the adapter's own `mapping` output, never in evidence text.
- `metadata` — no evidence-backed reason yet to surface arbitrary
  caller-supplied metadata as grounding text.
- `relationships[]` — structural cross-references, not requirement
  wording; resolving them across a collection would invent an
  RTI collection-level responsibility `RequirementArtifact`'s own
  contract explicitly defers (see `scripts/ai/requirement-artifact.js`'s
  docstring: a `RequirementSet` aggregate is deferred to RTI-2 "once a
  real ingestion adapter proved the actual shape needed").
- `type`, `priority`, `labels` — structural/classification metadata, not
  requirement wording.

A future version of this document may extend the projection if a real
caller proves one of these fields is needed as grounding text — this is
a decision for that future version, not a default to reach for now.

### Artifact evidence budget

**RTI-1 structural validity alone does not guarantee a `RequirementArtifact`
is representable by this adapter** (ACG-A3 corrective, finding
ACG-A3-R02 - discovered during independent review). `RequirementArtifact
.content` is valid up to 20000 characters and `acceptanceCriteria` up to
200 entries at up to 20000 characters each
(`scripts/ai/requirement-artifact.js`) - far more than a single evidence
item can carry.

The adapter enforces its own explicit, named budget
(`ARTIFACT_EVIDENCE_LIMITS` in `scripts/ai/generative-test-design/evidence-ingestion.js`)
against each artifact's deterministic projection, **before** any evidence
bundle is built:

```text
MAX_PROJECTED_TEXT_LENGTH:            4000   (per artifact projection)
MAX_AGGREGATE_PROJECTED_TEXT_LENGTH: 20000   (per collection)
```

An artifact whose projection exceeds the per-artifact limit fails closed
with an artifact-facing `$.artifacts[i]` error; a collection whose combined
projected text exceeds the aggregate limit (with every individual artifact
still within its own limit) fails closed with a `$.artifacts` error. Neither
case truncates, summarizes, or otherwise silently drops any part of a
projection - a caller either gets the complete projection or a clear
rejection, never a partial one.

**Why these numbers, specifically, and why they are not raised to match
RTI-1's own larger limits**: `scripts/ai/generative-test-design/
requirement-model-generator.js` (`#22C`) imports this same module's shared
`LIMITS` and independently re-validates every evidence bundle it receives -
regardless of which ingestion path produced it - against these exact same
per-item/aggregate thresholds, as its own caller-can't-be-trusted trust-
boundary re-check (its own `MAX_REQUIREMENT_MODEL_RESPONSE_CHARS` is itself
derived from `LIMITS.MAX_AGGREGATE_TEXT_LENGTH`). Raising the artifact
adapter's own acceptance threshold above these numbers could therefore never
be honored end-to-end: an oversized bundle would simply be rejected later,
by `#22C`'s own independent re-validation, with an even more disconnected
error that can no longer be traced back to the originating
`RequirementArtifact`. Changing that downstream, separately-reviewed trust
boundary is explicitly out of scope for this adapter.

This is therefore a deliberate, documented, narrower **adapter-specific
evidence-budget profile** layered on top of RTI-1's own (larger) structural
contract - not a relaxation of RTI-1, and not an accidental reuse of an
unrelated bound. A future version of this document may revisit these
numbers if `#22C`'s own downstream contract changes; that is a decision for
that future version, not a default to reach for now.

### Traceability without touching the frozen `EvidenceRef` schema

`EvidenceRef` identity (`id`/`kind`/`sourceId`) remains entirely owned by
`evidence-ingestion.js`'s existing canonical assignment logic — the
adapter never lets a `RequirementArtifact.id` become an `EvidenceRef.id`.
Traceability from artifact to evidence item is carried in a separate,
adapter-owned `mapping` array
(`{requirementArtifactId, evidenceRefId}[]`, input order preserved),
returned alongside the unchanged evidence `bundle` — no field was added
to the frozen v1 `EvidenceRef` shape.

### Project identity

`RequirementArtifact` deliberately has no `projectId`. The adapter
therefore **requires** an explicit, caller-supplied `projectId` — it is
never inferred from `source.system`, `metadata`, `source.location`, a
target name, or `cwd`. This matches every other `#22`/RTI contract's
existing project-identity rule: `ProjectProfile.id` (or an equivalent
explicit caller value) is the only project-identity authority anywhere
in this codebase.

## Trust boundary

```text
RequirementArtifact:        validated deterministic source
Adapter:                     deterministic projection only
Evidence ingestion:          canonical EvidenceRef owner (unchanged)
RequirementModel generator:  low-trust provider boundary (unchanged)
RequirementModel validator:  schema authority (unchanged)
Cross-model validation:      generative-chain authority (unchanged)
```

No provider output becomes trusted merely because its upstream evidence
happened to originate from an already-validated `RequirementArtifact`.
The adapter does not change, weaken, or bypass any existing trust
boundary in the `#22` pipeline — it only adds one new, equally-guarded
entry point into the same existing evidence layer.

## Public API / package boundary

This document does **not** create, imply, or require a public package
API change. `#22`/`#23` remain intentionally internal (Architecture
Conformance Gate finding `A-1`, decided separately as
`PRIVATE_GENERATIVE_SURFACE` in `package-surface-v2.md`) — `ingestRequirementArtifactsAsEvidence()` is exported only
from `scripts/ai/generative-test-design/evidence-ingestion.js` (an internal module
path), never from `scripts/ai/index.js`, and `package.json`'s `exports`
field is unchanged by this document or its adapter.

## Future RAG / Memory relationship

A future retrieval (`RAG`) or persistent-memory (`MEM`) component may
enrich `#22`'s evidence-ingestion stage with additional evidence sources
(alongside direct text and, now, `RequirementArtifact[]`) — but any such
future source must still flow through an equally explicit, equally
validated ingestion seam, and must never be treated as a canonical
`RequirementModel` or `RequirementArtifact` field merely because it
originated from a trusted-sounding retrieval system. This document does
not implement RAG or MEM, and does not define their eventual adapter —
only reserves the principle that they too, when built, extend evidence,
never bypass grounding.

## What this document does not do

- It does not implement `#22`'s or `#23`'s own generation logic, prompts,
  or provider calls.
- It does not decide the package/public-API surface (`A-1`, see
  `package-surface-v2.md`) or change the canonical `ROADMAP.md` status of
  `D-2` (the `test-design.js` vs. former `test-design/` naming collision,
  resolved by renaming the private directory) — those are separately
  decided lifecycle steps.
- It does not expand `TestDesignArtifact` with step-level structure, and
  does not shrink `TestCaseModel`'s existing structure.
- It does not create a machine-readable manifest, resolver, or runtime
  registry of model relationships — this is a normative document read by
  humans/LLMs and enforced by each contract's own existing validator, not
  a new executable authority.
- It does not close Architecture Conformance Gate finding `A-3` on
  canonical `ROADMAP.md` — that is a separate, later closure-sync
  mission, after independent review, merge, and post-merge certification
  of this implementation slice.
