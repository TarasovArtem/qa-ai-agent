"use strict";

/**
 * File Requirements Ingestion (Roadmap RTI-2) - the first real, deterministic
 * RequirementArtifact[] source adapter.
 *
 * loadRequirementsFromFile({ repositoryRoot, filePath }) reads a target-owned,
 * explicitly-authorized JSON requirements file and returns validated,
 * source-independent RequirementArtifact[] (scripts/ai/requirement-artifact.js,
 * Roadmap RTI-1) - unchanged, unweakened. This module proves the ingestion
 * ARCHITECTURE (filesystem authority, path safety, parsing, normalization,
 * validation, failure semantics), never document-understanding capability:
 *
 *   ZERO AI/LLM calls. ZERO semantic invention - acceptance criteria,
 *   priority, and requirements text are never synthesized from unstructured
 *   text, only normalized from explicitly-provided structured JSON fields.
 *   "The app should be fast." is accepted structurally, exactly like every
 *   other RequirementArtifact - whether it is measurably testable is a
 *   future RTI-3 (requirement quality/testability) concern, untouched here.
 *
 * FORMAT SCOPE: JSON only. JSON maps directly onto the RTI-1 data-only
 * contract, needs no new parser dependency, and has fully deterministic
 * syntax - it isolates this phase's real architectural questions (filesystem
 * authority, path safety, source-adapter contract, normalization, failure
 * semantics) from document-understanding concerns (PDF/DOCX extraction,
 * Markdown heading/ID conventions, OCR, LLM inference) that a future format
 * adapter would each need its own separate design for. Markdown/YAML/PDF/
 * DOCX/XLSX are explicitly deferred, not implemented, and no dependency for
 * any of them is introduced here.
 *
 * FILE SCHEMA (v1, the one canonical top-level shape - see this module's own
 * TOP_LEVEL_ALLOWED_KEYS below):
 *
 *   {
 *     "schemaVersion": 1,
 *     "requirements": [
 *       {
 *         "id": "REQ-001",
 *         "type": "user-story",
 *         "title": "Reset password",
 *         "content": "As a user, I want to reset my password.",
 *         "acceptanceCriteria": [ { "id": "AC-1", "text": "..." } ],
 *         "priority": "high",
 *         "labels": ["authentication"],
 *         "relationships": [ { "type": "related", "targetId": "REQ-002" } ],
 *         "contentHash": "...",
 *         "metadata": { }
 *       }
 *     ]
 *   }
 *
 * `schemaVersion` is required and must be EXACTLY the integer 1 - an
 * unrecognized value fails closed rather than guessing forward/backward
 * compatibility (this is the FILE format's own version, independent of this
 * package's npm SemVer). A raw requirement record may include every
 * RequirementArtifact field EXCEPT `source`: source provenance is this
 * adapter's job, not the file's - a raw record supplying its own `source`
 * would let file content impersonate a different origin (a different
 * external system's shape, a different file, etc.) and is rejected as an
 * unknown key, with a
 * dedicated error message. Unknown/unrecognized keys anywhere (top-level or
 * per-requirement) are rejected outright, never silently ignored or dumped
 * into `metadata` - a typo in a real requirements file is a real authoring
 * mistake that deserves to be visible, not silently swallowed.
 *
 * SOURCE PROVENANCE IS ADAPTER-OWNED: this module constructs
 * `source = { type: "file", sourceId: <artifact.id>, location: <repo-
 * relative POSIX-normalized path> }` itself - the raw file record never
 * supplies it. `source.location` is derived from `repositoryRoot` +
 * `filePath` (never a host-absolute path, never a temp-directory internal),
 * so the SAME requirements file produces byte-identical provenance on any
 * machine or CI runner. `source.version` is deliberately omitted - file
 * SCHEMA version (`schemaVersion`) and a future SOURCE version are different
 * concerns and must never be conflated onto the same field.
 *
 * FILESYSTEM AUTHORITY: `repositoryRoot` (scripts/ai/repository-root.js) is
 * the SOLE filesystem authority - `filePath` is resolved against it, never
 * against process.cwd(), this module's own __dirname, or any other implicit
 * location. There is NO autodiscovery: this module never searches for
 * requirements.json/requirements//docs//spec/ - the caller must supply an
 * explicit filePath every time. Path safety reuses the existing trust
 * primitives (scripts/ai/context-utils.js's isCanonicalPathInsideRoot(),
 * scripts/ai/repository-root.js's lexical/canonical two-namespace boundary)
 * rather than inventing a second filesystem trust model - see
 * resolveRequirementsFilePath() below, which mirrors
 * scripts/ai/knowledge/loader.js's loadProjectKnowledgeUnits() "resolve
 * lexically, then canonically re-verify via realpath" pattern for the exact
 * same reason: a validated parent directory (repositoryRoot) does not
 * authorize an unverified child (filePath) without its own containment
 * check, and a symlink at any point in that path must never be able to
 * redirect the read outside the trusted root.
 *
 * COLLECTION-LEVEL RULES (RTI-1 explicitly deferred these to "once a real
 * ingestion adapter exists to prove the actual shape needed" - see
 * requirement-artifact.js's own docstring; this module is that adapter):
 *
 *   - Duplicate RequirementArtifact.id within one ingested file is REJECTED
 *     (REQUIREMENTS_COLLECTION_INVALID). Stable, unique identity within one
 *     ingestion set is a prerequisite for any future traceability work.
 *   - Duplicate, non-empty acceptanceCriteria[].id values WITHIN THE SAME
 *     artifact are REJECTED. Criterion ids remain optional and are never
 *     required to be unique ACROSS unrelated artifacts.
 *   - relationships[].targetId is validated only for SHAPE here (already
 *     RTI-1's own job) - resolving it against the loaded artifact set is
 *     DELIBERATELY NOT done in RTI-2. A single JSON file is not assumed to
 *     be a closed world: a relationship may legitimately reference an
 *     artifact that arrives from a different file or a different source
 *     once multiple ingestion results are composed (a future RTI-5/RTI-6
 *     concern). Enforcing strict internal-only resolution now would fail
 *     closed on exactly that legitimate forward/cross-source reference -
 *     the same "avoid speculative complexity with no real caller yet"
 *     reasoning RTI-1's own docstring already applies to relationship
 *     resolution in general.
 *
 * NO HASHING: this module does not compute or require a whole-file or
 * per-artifact content hash. A raw record MAY supply its own `contentHash`
 * (passed through unchanged, exactly like `priority`/`labels`) - unlike
 * `source`, `contentHash` describes the requirement's own content, never
 * its origin, so there is no provenance-spoofing concern in allowing it.
 * Computing one here would invent hashing semantics with no real
 * reproducibility/audit consumer yet - deferred until that need is concrete.
 *
 * FAIL-CLOSED, NEVER REPAIRED: malformed JSON, an unrecognized schema
 * shape, or an invalid artifact all fail with a stable, bounded, path-free
 * error - never a partial parse, a guessed default, or AI-assisted repair.
 *
 * IMMUTABLE, NON-MUTATING, DETERMINISTIC: raw parsed objects are never
 * mutated in place - every normalized artifact is a freshly constructed,
 * frozen object built by copying only explicitly allowed fields (see
 * RAW_REQUIREMENT_ALLOWED_KEYS below), preserving file order throughout. No
 * requirement or acceptance-criterion id is ever generated - a missing id
 * fails validation rather than being synthesized. Reading the identical
 * file twice, from any process.cwd(), yields deep-equal output.
 *
 * SYNC, DEPENDENCY-FREE: matching every other filesystem-touching module in
 * this directory (scripts/ai/knowledge/loader.js, scripts/ai/collect-
 * context.js) - plain synchronous `fs`, zero new runtime dependencies, no
 * schema-validation library.
 */

const fs = require("fs");
const path = require("path");

const { assertValidRepositoryRoot } = require("./repository-root");
const { assertValidRequirementArtifact } = require("./requirement-artifact");
const { isCanonicalPathInsideRoot } = require("./context-utils");

// Conservative but not needlessly tiny - a structured JSON requirements file
// (unlike an arbitrary evidence attachment) may legitimately describe
// thousands of requirements. 5 MiB comfortably covers realistic ingestion
// sets while remaining a firm, deterministic DoS-resistant bound (checked via
// fs.statSync BEFORE the file is ever read into memory).
const MAX_REQUIREMENTS_FILE_BYTES = 5 * 1024 * 1024;

const MAX_VALIDATION_DETAIL_LENGTH = 1024;
const MAX_REPORTED_ERRORS = 20;

// RTI-1's own ARTIFACT_ALLOWED_KEYS minus "source" - source provenance is
// this adapter's own job, never the raw file's (see module docstring).
// Deliberately duplicated here rather than imported (requirement-artifact.js
// does not export it) - matching this repository's established "small
// duplicated primitives over premature shared abstraction" convention.
const RAW_REQUIREMENT_ALLOWED_KEYS = Object.freeze([
  "id",
  "type",
  "title",
  "content",
  "acceptanceCriteria",
  "priority",
  "labels",
  "relationships",
  "contentHash",
  "metadata",
]);

const TOP_LEVEL_ALLOWED_KEYS = Object.freeze(["schemaVersion", "requirements"]);

function isPlainDataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function boundedDetail(errors) {
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const omitted = errors.length - shown.length;
  const joined = shown.join("; ") + (omitted > 0 ? `; ${omitted} additional error(s) omitted` : "");
  return joined.length <= MAX_VALIDATION_DETAIL_LENGTH ? joined : `${joined.slice(0, MAX_VALIDATION_DETAIL_LENGTH)}...`;
}

// Mirrors scripts/ai/knowledge/loader.js's loadProjectKnowledgeUnits() /
// scripts/ai/context-utils.js's resolveRepositoryLocalPath() pattern: resolve
// the caller-supplied filePath lexically against repositoryRoot (never
// process.cwd()), require it be contained by EITHER trusted namespace
// (lexicalRoot or realRoot - a symlinked repositoryRoot has two legitimate
// forms of the same trusted directory), then canonically re-verify via
// fs.realpathSync against realRoot - the only way to close a symlink-escape
// gap. A broken symlink, a symlink loop, or a genuinely missing path all
// surface as REQUIREMENTS_FILE_NOT_FOUND (fs.realpathSync throws for all
// three); an out-of-root traversal or an out-of-root symlink target both
// surface as REQUIREMENTS_FILE_OUTSIDE_ROOT.
function resolveRequirementsFilePath(filePath, root) {
  const lexical = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root.lexicalRoot, filePath);

  const insideEitherNamespace =
    isCanonicalPathInsideRoot({ root: root.lexicalRoot, candidate: lexical }) ||
    isCanonicalPathInsideRoot({ root: root.realRoot, candidate: lexical });
  if (!insideEitherNamespace) {
    throw new Error("REQUIREMENTS_FILE_OUTSIDE_ROOT: loadRequirementsFromFile received a filePath outside the trusted repository root.");
  }

  let real;
  try {
    real = fs.realpathSync(lexical);
  } catch {
    throw new Error(
      "REQUIREMENTS_FILE_NOT_FOUND: loadRequirementsFromFile could not resolve the requirements file (missing, broken symlink, or unresolvable path)."
    );
  }

  if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: real })) {
    throw new Error("REQUIREMENTS_FILE_OUTSIDE_ROOT: loadRequirementsFromFile requirements file escapes the trusted repository root.");
  }

  return real;
}

function readRequirementsFileBytes(repositoryRoot, filePath) {
  const root = assertValidRepositoryRoot(repositoryRoot, "loadRequirementsFromFile");

  if (filePath === undefined || filePath === null) {
    throw new Error("REQUIREMENTS_FILE_REQUIRED: loadRequirementsFromFile requires an explicit filePath; none was supplied.");
  }
  if (typeof filePath !== "string" || filePath.length === 0 || hasControlChar(filePath)) {
    throw new Error("REQUIREMENTS_FILE_INVALID: loadRequirementsFromFile received an invalid filePath.");
  }
  // Explicit, deterministic extension gate - RTI-2 supports JSON only and
  // never infers format from file content heuristics (module docstring).
  if (!filePath.toLowerCase().endsWith(".json")) {
    throw new Error("REQUIREMENTS_FILE_INVALID: loadRequirementsFromFile only supports .json requirements files in RTI-2.");
  }

  const realPath = resolveRequirementsFilePath(filePath, root);

  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch {
    throw new Error("REQUIREMENTS_FILE_NOT_FOUND: loadRequirementsFromFile could not stat the requirements file.");
  }
  // Covers "directory supplied as file" and any other non-regular-file
  // object (fs.statSync already followed the fully-resolved realPath, so no
  // further symlink can be involved at this point).
  if (!stat.isFile()) {
    throw new Error("REQUIREMENTS_FILE_NOT_FOUND: loadRequirementsFromFile requirements file path does not resolve to a regular file.");
  }
  if (stat.size > MAX_REQUIREMENTS_FILE_BYTES) {
    throw new Error(
      `REQUIREMENTS_FILE_TOO_LARGE: loadRequirementsFromFile requirements file exceeds the maximum allowed size of ${MAX_REQUIREMENTS_FILE_BYTES} bytes.`
    );
  }

  let raw = fs.readFileSync(realPath, "utf8");
  // Deterministic UTF-8 BOM handling - always stripped when present, never
  // conditionally guessed (module docstring's "no charset autodetection").
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  // Deterministic, repository-relative, POSIX-normalized provenance - never
  // a host-absolute or temp-directory-internal path (module docstring).
  // Computed against whichever namespace filePath was actually expressed
  // against (lexicalRoot), matching context-utils.js's own convention of
  // preferring the caller-visible namespace for repo-relative display paths.
  const lexicalForDisplay = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root.lexicalRoot, filePath);
  const base = isCanonicalPathInsideRoot({ root: root.lexicalRoot, candidate: lexicalForDisplay }) ? root.lexicalRoot : root.realRoot;
  const location = path.relative(base, lexicalForDisplay).split(path.sep).join("/");

  return { raw, location };
}

function validateTopLevelSchema(parsedFile, errors) {
  if (!isPlainDataObject(parsedFile)) {
    errors.push("requirements file must contain a plain JSON object at the top level");
    return;
  }
  const unknown = Object.keys(parsedFile).filter((k) => !TOP_LEVEL_ALLOWED_KEYS.includes(k));
  if (unknown.length > 0) {
    errors.push(`unknown top-level key(s): ${unknown.slice(0, 8).join(", ")}`);
  }
  if (parsedFile.schemaVersion !== 1) {
    errors.push(`schemaVersion must be exactly the integer 1 (received ${JSON.stringify(parsedFile.schemaVersion)})`);
  }
  if (!Array.isArray(parsedFile.requirements)) {
    errors.push("requirements must be an array");
  } else if (parsedFile.requirements.length === 0) {
    // Strong recommendation (module docstring / RTI-2 mission): a caller
    // ingesting requirements in order to design tests gains nothing from an
    // empty set - deterministic rejection surfaces a likely authoring
    // mistake (an accidentally-empty file) rather than silently proceeding.
    errors.push("requirements must be a non-empty array");
  }
}

function describeRawUnknownKey(index, key) {
  if (key === "source") {
    return `requirements[${index}].source is not permitted in the raw file - source provenance is injected by the file adapter, never supplied by file content`;
  }
  return `requirements[${index}].${key}: unknown key is not permitted`;
}

function validateRawRequirementShape(item, index, errors) {
  if (!isPlainDataObject(item)) {
    errors.push(`requirements[${index}] must be a plain object`);
    return;
  }
  const unknown = Object.keys(item).filter((k) => !RAW_REQUIREMENT_ALLOWED_KEYS.includes(k));
  for (const key of unknown.slice(0, 8)) {
    errors.push(describeRawUnknownKey(index, key));
  }
}

function buildSource(item, location) {
  const source = { type: "file", location };
  if (typeof item.id === "string" && item.id.length > 0) {
    source.sourceId = item.id;
  }
  return Object.freeze(source);
}

// Constructs a brand-new object by copying ONLY explicitly allowed fields -
// never Object.assign(target, raw) or a spread of the raw record (module
// docstring's "never mutate/never trust an unbounded shape" rule). The raw
// `item` is itself untouched throughout.
function normalizeRawRequirement(item, location) {
  const normalized = {};
  for (const key of RAW_REQUIREMENT_ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(item, key)) {
      normalized[key] = item[key];
    }
  }
  normalized.source = buildSource(item, location);
  return Object.freeze(normalized);
}

function detectDuplicateArtifactIds(artifacts, errors) {
  const seen = new Map(); // id -> first index it was seen at
  artifacts.forEach((artifact, index) => {
    if (seen.has(artifact.id)) {
      errors.push(`requirements[${index}].id "${artifact.id}" duplicates requirements[${seen.get(artifact.id)}].id`);
    } else {
      seen.set(artifact.id, index);
    }
  });
}

function detectDuplicateAcceptanceCriterionIds(artifacts, errors) {
  artifacts.forEach((artifact, index) => {
    if (!Array.isArray(artifact.acceptanceCriteria)) return;
    const seen = new Set();
    artifact.acceptanceCriteria.forEach((criterion, acIndex) => {
      const id = criterion && typeof criterion === "object" ? criterion.id : undefined;
      if (typeof id !== "string" || id.length === 0) return; // absence is allowed, never synthesized
      if (seen.has(id)) {
        errors.push(`requirements[${index}].acceptanceCriteria[${acIndex}].id "${id}" duplicates another acceptanceCriteria id within the same artifact`);
      } else {
        seen.add(id);
      }
    });
  });
}

// Pure, filesystem-free: parses already-read file text and produces
// validated RequirementArtifact[]. Deliberately separable from
// readRequirementsFileBytes() above (module docstring's "parsing/
// normalization separable from filesystem access where practical") so this
// half is directly unit-testable without touching disk.
function parseAndNormalizeRequirements(rawText, location) {
  let parsedFile;
  try {
    parsedFile = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`REQUIREMENTS_FILE_PARSE_FAILED: loadRequirementsFromFile could not parse the requirements file as JSON (${err.message}).`);
  }

  const schemaErrors = [];
  validateTopLevelSchema(parsedFile, schemaErrors);
  if (schemaErrors.length > 0) {
    throw new Error(`REQUIREMENTS_FILE_SCHEMA_INVALID: loadRequirementsFromFile requirements file has an invalid top-level shape (${boundedDetail(schemaErrors)}).`);
  }

  const rawItems = parsedFile.requirements;
  const shapeErrors = [];
  rawItems.forEach((item, index) => validateRawRequirementShape(item, index, shapeErrors));
  if (shapeErrors.length > 0) {
    throw new Error(`REQUIREMENTS_FILE_SCHEMA_INVALID: loadRequirementsFromFile requirements file contains invalid requirement record(s) (${boundedDetail(shapeErrors)}).`);
  }

  const normalized = rawItems.map((item) => normalizeRawRequirement(item, location));

  const artifactErrors = [];
  normalized.forEach((artifact, index) => {
    try {
      assertValidRequirementArtifact(artifact, "loadRequirementsFromFile");
    } catch (err) {
      artifactErrors.push(`requirements[${index}] failed RequirementArtifact validation: ${err.message}`);
    }
  });
  if (artifactErrors.length > 0) {
    throw new Error(`REQUIREMENTS_FILE_SCHEMA_INVALID: loadRequirementsFromFile requirements file contains invalid requirement record(s) (${boundedDetail(artifactErrors)}).`);
  }

  const collectionErrors = [];
  detectDuplicateArtifactIds(normalized, collectionErrors);
  detectDuplicateAcceptanceCriterionIds(normalized, collectionErrors);
  if (collectionErrors.length > 0) {
    throw new Error(`REQUIREMENTS_COLLECTION_INVALID: loadRequirementsFromFile requirements file collection is invalid (${boundedDetail(collectionErrors)}).`);
  }

  return normalized;
}

/**
 * Loads and validates a target-owned JSON requirements file into
 * RequirementArtifact[] (Roadmap RTI-2, File Requirements Ingestion). See
 * this module's own docstring for the full file schema, filesystem-
 * authority, provenance, and collection-level-rule contract.
 *
 * @param {{repositoryRoot: string, filePath: string}} options
 * @returns {object[]} validated, frozen RequirementArtifact[] in file order
 */
function loadRequirementsFromFile({ repositoryRoot, filePath } = {}) {
  const { raw, location } = readRequirementsFileBytes(repositoryRoot, filePath);
  return parseAndNormalizeRequirements(raw, location);
}

module.exports = {
  loadRequirementsFromFile,
  parseAndNormalizeRequirements,
};
