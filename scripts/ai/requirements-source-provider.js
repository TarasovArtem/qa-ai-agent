"use strict";

/**
 * External Requirements Source Provider Contract (Roadmap RTI-6) - the
 * generic, explicit boundary through which arbitrary external systems
 * (issue trackers, requirements tools, test-management systems, custom
 * enterprise services) normalize their own data into RTI-1
 * RequirementArtifact[], without leaking vendor semantics into the
 * generic RTI pipeline (RTI-3/RTI-4/RTI-5).
 *
 * CONCEPTUAL PIPELINE:
 *
 *   External system
 *           |
 *           v
 *   RequirementsSourceProvider   (caller-constructed, trusted executable code)
 *           |
 *           v
 *   provider-owned raw retrieval + normalization  (never seen by this module)
 *           |
 *           v
 *   RequirementArtifact[]        (untrusted DATA - the actual boundary this
 *           |                     module defends)
 *           v
 *   loadRequirementsFromProvider()   (this module - shape check, invoke,
 *           |                          validate, atomicity, freeze)
 *           v
 *   existing RTI-3 -> RTI-4 -> RTI-5 pipeline, unchanged
 *
 * THE CORE ARCHITECTURAL PRINCIPLE: this module never branches on a
 * provider or source-family identity string - no conditional logic
 * anywhere in this file inspects `provider.id` or `artifact.source.type`
 * to select different behavior, and no provider registry exists. A
 * concrete adapter for any specific external issue tracker, requirements
 * tool, or test-management system (Roadmap RTI-7, NOT implemented here) is
 * simply any object satisfying the interface below; this module treats
 * every provider identically and polymorphically.
 *
 * PROVIDER CONTRACT (documentation + tests are the contract - plain JS has
 * no runtime interface enforcement):
 *
 *   interface RequirementsSourceProvider {
 *     readonly id: string;                                    // required
 *     read(): Promise<RequirementArtifact[]> | RequirementArtifact[];
 *   }
 *
 * PROVIDER.ID vs ARTIFACT.SOURCE.TYPE - DELIBERATELY INDEPENDENT, NO FORCED
 * EQUALITY: `provider.id` identifies the PROVIDER INSTANCE/adapter
 * configuration a caller constructed (e.g. "company-tracker-prod",
 * "internal-requirements-service") - it is diagnostic/observability
 * identity, never a claim about source family. `RequirementArtifact.
 * source.type` (RTI-1's own, already-required field) identifies the
 * SOURCE FAMILY (e.g. the name of the external system kind). This module
 * never asserts
 * `artifact.source.type === provider.id` - a single provider instance
 * could legitimately normalize data originally drawn from more than one
 * underlying source kind (e.g. an internal aggregator), and forcing
 * equality would forbid that legitimate pattern while imposing a semantic
 * assumption this generic layer has no business owning.
 *
 * READ CONTRACT: `read()` takes NO arguments. Provider-specific
 * query/filter/pagination configuration belongs entirely to provider
 * CONSTRUCTION (a concrete RTI-7 adapter's own constructor/factory), never
 * a generic public query object - this keeps the generic interface small,
 * stable, and free of vendor query leakage (no generic JQL/WIQL-shaped
 * `query` field invented here). Called as `provider.read()` (never
 * destructured into a bare function reference first) so `this` binding is
 * preserved for class-instance providers. `read()` may return a plain
 * array OR a Promise resolving to one - this module always does
 * `await provider.read()`, which handles both uniformly with no special
 * casing.
 *
 * TWO DISTINCT TRUST BOUNDARIES (the single most important security
 * property of this module):
 *
 *   Boundary A - the provider IMPLEMENTATION is TRUSTED, caller-supplied
 *     executable code, exactly analogous to how a target's own
 *     ProjectProfile/FrameworkRuntimeConfig construction code is already
 *     trusted elsewhere in this repository. No interface check can sandbox
 *     arbitrary code; provider-shape validation here verifies SHAPE only
 *     (does it look like a provider), never behavioral safety. Reading
 *     `provider.id`/`provider.read` uses ORDINARY property access
 *     (NOT RTI-1's own-enumerable-data-property-only hardening) -
 *     deliberately, because a legitimate class-instance provider's `id`
 *     may be a prototype getter (`get id() { return this._id; }`), and
 *     invoking that getter is expected, safe behavior for trusted code we
 *     are about to call `.read()` on anyway (a far more powerful
 *     operation than reading one property).
 *
 *   Boundary B - `provider.read()`'s RETURN VALUE is UNTRUSTED DATA and is
 *     the actual boundary this module defends: every returned
 *     RequirementArtifact goes through RTI-1's existing hostile-getter-
 *     safe `assertValidRequirementArtifact`, completely unchanged, exactly
 *     as RTI-2/RTI-4/RTI-5 already do for their own RequirementArtifact
 *     inputs. No RTI-1 schema duplication, no schema weakening.
 *
 * REQUIREMENTARTIFACT.ID - PROVIDER-OWNED, NEVER GENERATED/REWRITTEN HERE:
 * this module never generates, rewrites, prefixes, hashes, or repairs
 * `RequirementArtifact.id` - a provider's returned ids are used exactly as
 * given. A `RequirementsSourceProvider` implementation MUST produce
 * `RequirementArtifact.id` values that are stable and collision-safe
 * within any snapshot the caller intends to compose; when a source
 * system's native ids are only locally unique, a well-behaved provider
 * SHOULD use a provider-qualified id (e.g.
 * "<source-family>:<provider-instance-id>:<native-id>") - the EXACT format
 * remains entirely provider-owned, never imposed by this generic module.
 * Native identity should be preserved
 * separately via `source.sourceId` (RTI-1's existing, optional field) -
 * `RequirementArtifact.id` is normalized traceability identity;
 * `source.sourceId` is native provenance; the two are never conflated.
 * This module verifies only what it CAN verify: no duplicate id WITHIN one
 * single `read()` call's returned collection. Cross-provider global
 * uniqueness (when a caller manually composes multiple providers' output)
 * remains a documented provider obligation - RTI-5's own existing
 * duplicate-id rejection is the downstream backstop for a manually
 * composed collection; this module requires zero RTI-5 change.
 *
 * DUPLICATE POLICY (fail closed, atomic, mirrors RTI-2's/RTI-5's own
 * identical rule): a duplicate `RequirementArtifact.id` within one
 * provider's returned collection, or a duplicate non-empty
 * `acceptanceCriteria[].id` WITHIN one artifact, both reject the WHOLE
 * load - never a silent overwrite, never a partial result - even though
 * RTI-1's own structural validator permits the latter shape (a duplicate
 * criterion id would make downstream criterion-id-based traceability
 * genuinely ambiguous).
 *
 * EMPTY RESULT IS VALID: unlike RTI-5's own `requirements[]` input (which
 * must be non-empty because it represents an already-known analysis
 * target set), a provider `read()` represents a QUERY against an external
 * system - zero matching external requirements is legitimate, meaningful
 * information, not an error. `read()` resolving to `[]` returns a fresh,
 * frozen empty array.
 *
 * COPY / FREEZE SEMANTICS: this module returns a FRESH, FROZEN array
 * (`Object.freeze([...validated])`) - distinct from whatever array
 * reference the provider itself returned, so a caller's received
 * collection's membership/order/length cannot later change out from under
 * them. The individual RequirementArtifact objects WITHIN that array are
 * the SAME references the provider returned - not deep-copied, not
 * re-frozen beyond whatever RTI-1/the provider itself already established
 * (RTI-1's own validator does not enforce freezing - "the caller's
 * convention," per its own docstring). Stated exactly that way, not
 * overclaimed: this is NOT a deep-immutability guarantee. A trusted-but-
 * buggy provider retaining and later mutating its own returned artifact
 * object references is an accepted, documented limitation of this trust
 * model (see Boundary A above) - not defended against, not a security gap
 * given the "provider is trusted code" framing already governs
 * `read()` itself.
 *
 * NO NETWORK / FILESYSTEM / PROJECT COUPLING IN THIS MODULE: this generic
 * runner performs zero network I/O itself (network access, if any, occurs
 * entirely inside the caller-supplied provider's own `read()`
 * implementation), requires no `repositoryRoot` (RTI-2's file adapter
 * remains the separate, repositoryRoot-bound ingestion path, unchanged),
 * no ProjectProfile, no ProjectKnowledgeConfig, no FrameworkRuntimeConfig,
 * and zero new runtime dependencies.
 *
 * NO PROVIDER REGISTRY, NO FACTORY, NO AUTODISCOVERY: callers explicitly
 * construct/import whatever concrete provider they want and pass the
 * instance directly to `loadRequirementsFromProvider(provider)` - no
 * environment/cwd/config-file/package scanning, no central map of known
 * provider implementations keyed by name, no
 * `createRequirementsSourceProvider(name, config)` factory anywhere in
 * this module. This matches every other authority in this repository
 * (ProjectProfile, FrameworkRuntimeConfig, ProjectKnowledgeConfig,
 * repositoryRoot) - explicit caller-supplied injection, never hidden
 * selection.
 *
 * NO NORMALIZATION IN THIS MODULE: native-schema-to-RequirementArtifact
 * mapping (field mapping, artifact-type mapping, relationship mapping,
 * pagination, transport, authentication) is 100% the concrete provider's
 * own responsibility (Roadmap RTI-7). This module never sees a native
 * payload and never performs any vendor-specific transformation - it only
 * validates and orchestrates already-normalized RequirementArtifact[].
 *
 * MULTI-PROVIDER COMPOSITION AND STREAMING/PAGINATION ARE DELIBERATELY OUT
 * OF SCOPE: a caller who wants to combine multiple providers already can,
 * with zero new code, by concatenating two `loadRequirementsFromProvider`
 * results before handing the combined array to RTI-3/4/5 (RTI-5's own
 * existing duplicate-id atomicity protects that manually composed
 * collection). A dedicated composition helper and a streaming/cursor read
 * variant are both explicitly deferred pending a demonstrated need,
 * neither implemented nor stubbed here.
 */

const { assertValidRequirementArtifact } = require("./requirement-artifact");

const MAX_STRING_LENGTH = 200;
const MAX_VALIDATION_DETAIL_LENGTH = 1024;
const MAX_REPORTED_ERRORS = 20;

// --- Shared primitives (deliberately duplicated, not imported - matching
// this repository's own established "small duplicated primitives over
// premature shared abstraction" convention) ------------------------------

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isSafeBoundedString(value, maxLength) {
  return isNonEmptyString(value) && value.length <= maxLength && !hasControlChar(value);
}

function boundedDetail(errors) {
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const omitted = errors.length - shown.length;
  const joined = shown.join("; ") + (omitted > 0 ? `; ${omitted} additional error(s) omitted` : "");
  return joined.length <= MAX_VALIDATION_DETAIL_LENGTH ? joined : `${joined.slice(0, MAX_VALIDATION_DETAIL_LENGTH)}...`;
}

// Provider SHAPE validation only (Boundary A - see module docstring):
// ordinary property access, deliberately NOT RTI-1's own-enumerable-data-
// property-only hardening, because a legitimate class-instance provider's
// `id` may be a prototype getter and invoking it is expected/safe for
// trusted code. Never claims to validate provider BEHAVIOR.
function assertValidProviderShape(provider, callerLabel) {
  if (provider === undefined || provider === null) {
    throw new Error(`REQUIREMENTS_SOURCE_PROVIDER_REQUIRED: ${callerLabel} requires an explicit RequirementsSourceProvider; none was supplied.`);
  }
  const providerType = typeof provider;
  if (providerType !== "object" && providerType !== "function") {
    throw new Error(`REQUIREMENTS_SOURCE_PROVIDER_INVALID: ${callerLabel} received a provider that is not an object or function.`);
  }
  if (!isSafeBoundedString(provider.id, MAX_STRING_LENGTH)) {
    throw new Error(`REQUIREMENTS_SOURCE_PROVIDER_INVALID: ${callerLabel} received a provider with an invalid "id" (must be a non-empty, bounded, control-character-free string).`);
  }
  if (typeof provider.read !== "function") {
    throw new Error(`REQUIREMENTS_SOURCE_PROVIDER_INVALID: ${callerLabel} received a provider whose "read" is not a function (provider id "${provider.id}").`);
  }
}

// Rejects a duplicate RequirementArtifact.id across the collection, and a
// duplicate acceptanceCriteria[].id WITHIN any single artifact - mirrors
// RTI-2's/RTI-5's own identical rule (see module docstring "DUPLICATE
// POLICY").
function assertNoDuplicateIds(artifacts, providerId, callerLabel) {
  const collectionErrors = [];
  const seenArtifactIds = new Map();
  artifacts.forEach((artifact, index) => {
    if (seenArtifactIds.has(artifact.id)) {
      collectionErrors.push(`artifacts[${index}].id "${artifact.id}" duplicates artifacts[${seenArtifactIds.get(artifact.id)}].id`);
    } else {
      seenArtifactIds.set(artifact.id, index);
    }
    if (Array.isArray(artifact.acceptanceCriteria)) {
      const seenCriterionIds = new Map();
      artifact.acceptanceCriteria.forEach((criterion, criterionIndex) => {
        const id = criterion && typeof criterion.id === "string" ? criterion.id : undefined;
        if (!id) return;
        if (seenCriterionIds.has(id)) {
          collectionErrors.push(
            `artifacts[${index}] (id "${artifact.id}").acceptanceCriteria[${criterionIndex}].id "${id}" duplicates acceptanceCriteria[${seenCriterionIds.get(id)}].id`
          );
        } else {
          seenCriterionIds.set(id, criterionIndex);
        }
      });
    }
  });
  if (collectionErrors.length > 0) {
    throw new Error(
      `REQUIREMENTS_SOURCE_COLLECTION_INVALID: ${callerLabel} received a collection with duplicate id(s) from provider "${providerId}" (${boundedDetail(collectionErrors)}).`
    );
  }
}

/**
 * Loads RequirementArtifact[] from an explicitly caller-supplied
 * RequirementsSourceProvider. See this module's own docstring for the
 * full provider contract, trust model, identity/collision model,
 * provenance model, duplicate policy, and copy/freeze semantics.
 *
 * @param {{id: string, read: function}} provider a RequirementsSourceProvider
 * @returns {Promise<object[]>} a fresh, frozen RequirementArtifact[], in
 *   provider-returned order - the artifact objects themselves are the same
 *   references the provider returned, not deep-copied
 * @throws {Error} REQUIREMENTS_SOURCE_PROVIDER_REQUIRED /
 *   REQUIREMENTS_SOURCE_PROVIDER_INVALID (provider shape) /
 *   REQUIREMENTS_SOURCE_READ_FAILED (provider.read() threw/rejected) /
 *   REQUIREMENTS_SOURCE_OUTPUT_INVALID (non-array output, or a
 *   structurally invalid RequirementArtifact) /
 *   REQUIREMENTS_SOURCE_COLLECTION_INVALID (duplicate requirement or
 *   criterion id)
 */
async function loadRequirementsFromProvider(provider) {
  assertValidProviderShape(provider, "loadRequirementsFromProvider");

  let result;
  try {
    result = await provider.read();
  } catch (err) {
    throw new Error(`REQUIREMENTS_SOURCE_READ_FAILED: loadRequirementsFromProvider provider "${provider.id}" failed to read requirements.`, { cause: err });
  }

  if (!Array.isArray(result)) {
    throw new Error(`REQUIREMENTS_SOURCE_OUTPUT_INVALID: loadRequirementsFromProvider provider "${provider.id}" did not return an array of RequirementArtifact.`);
  }

  const shapeErrors = [];
  result.forEach((artifact, index) => {
    try {
      assertValidRequirementArtifact(artifact, "loadRequirementsFromProvider");
    } catch (err) {
      shapeErrors.push(`artifacts[${index}]: ${err.message}`);
    }
  });
  if (shapeErrors.length > 0) {
    throw new Error(
      `REQUIREMENTS_SOURCE_OUTPUT_INVALID: loadRequirementsFromProvider provider "${provider.id}" returned invalid requirement record(s) (${boundedDetail(shapeErrors)}).`
    );
  }

  assertNoDuplicateIds(result, provider.id, "loadRequirementsFromProvider");

  return Object.freeze([...result]);
}

module.exports = {
  loadRequirementsFromProvider,
};
