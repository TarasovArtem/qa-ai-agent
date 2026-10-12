/**
 * Controlled-v1 run directory, run manifest and run binding
 * (docs/controlled-v1-productization-contract-v1.md §10.5, §14).
 *
 * Layout (all under the validated output.dir):
 *
 *   <output.dir>/runs/<runId>/manifest.json            QaAgentRunManifest v1
 *   <output.dir>/runs/<runId>/design/...json           design artifacts
 *   <output.dir>/runs/<runId>/plan/...json             plan artifacts
 *   <output.dir>/runs/<runId>/generate/...json         generate artifacts
 *
 * Binding (unchanged approved semantics): the manifest persists the run id,
 * the product version, the RunSemanticProjection v1 version + SHA-256
 * digest, the artifact contract versions, and per stage the effective
 * provider/model plus every artifact's path, kind, schemaVersion and
 * SHA-256 of its exact bytes. Every later command recomputes the projection
 * from the CURRENT validated config + requirements file and refuses any
 * mismatch (exit 4, RUN_BINDING_MISMATCH); it refuses a manifest whose run
 * id differs from the directory it was read from (RUN_IDENTITY_MISMATCH),
 * any artifact whose bytes do not match the recorded digest
 * (RUN_ARTIFACT_DIGEST_MISMATCH), and any stage sequence other than
 * design -> plan -> generate. An artifact of another run is therefore never
 * adopted: it either differs in bytes (digest) or arrives with a manifest
 * naming another run.
 *
 * Integrity scope (§10.5): digests detect corruption, staleness and
 * cross-run substitution. They are NOT authenticity - an actor who rewrites
 * both an artifact and its digest is not detected - and no authority (in
 * particular no approval) is ever derived from them.
 *
 * Reads: open once, bounded, regular files only, symlinked leaves refused,
 * the opened descriptor must be the lstat'ed file, the canonical location
 * must stay inside the run directory. Every persisted file is untrusted at
 * reload and is parsed with the strict duplicate-key-refusing parser.
 * Writes: only below the authorized run directory, through the existing
 * root-anchored safe-write primitive, with the canonical parent re-checked
 * against the protected-path policy immediately before each write.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { resolveSafeRepositoryWritePath, isCanonicalPathInsideRoot } = require("../context-utils");
const { assertCanonicallyContained, pathsOverlap, toPosixRelative } = require("./paths");
const { CliError, inputRefused, authorityRefused } = require("./errors");
const { parseStrictJson } = require("./strict-json");
const { RUN_ID_PATTERN } = require("./args");

const MANIFEST_KIND = "QaAgentRunManifest";
const MANIFEST_SCHEMA_VERSION = 2;
const MANIFEST_FILE_NAME = "manifest.json";
const PROJECTION_VERSION = 1;
const RUNS_DIRECTORY = "runs";
const STAGE_ORDER = Object.freeze(["design", "plan", "generate"]);

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
// Equal to scripts/ai/requirements-file.js MAX_REQUIREMENTS_FILE_BYTES.
const MAX_REQUIREMENTS_BYTES = 5 * 1024 * 1024;
const MAX_ARTIFACTS_PER_STAGE = 512;

// Contract versions of every artifact a run can hold (contract §14).
const ARTIFACT_CONTRACTS = Object.freeze({
  RequirementModel: 1,
  TestCaseModel: 1,
  AutomationCandidate: 1,
  AutomationRepositoryContext: 1,
  AutomationPlan: 1,
  GeneratedChangeSet: 1,
  GeneratedChangeSetReviewPackage: 1,
});

const STAGE_KINDS = Object.freeze({
  design: Object.freeze(["RequirementModel", "TestCaseModel", "AutomationCandidate"]),
  plan: Object.freeze(["AutomationRepositoryContext", "AutomationPlan"]),
  generate: Object.freeze(["GeneratedChangeSet", "GeneratedChangeSetReviewPackage"]),
});

const ARTIFACT_PATH_PATTERN = /^(design|plan|generate)\/[a-z][a-z-]{0,62}(-[0-9]{4})?\.json$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const REVIEW_ORDINAL_PATTERN = /^(?!0000)[0-9]{4}$/;

function validLedgerTimestamp(value) {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
const MODEL_PATTERN = /^[A-Za-z0-9._:/@+-]{1,128}$/;
const PROVIDER_NAMES = Object.freeze(["groq", "gemini"]);

const UTF8 = new TextDecoder("utf-8", { fatal: true });

// --- identity ---------------------------------------------------------------------

function newRunId(now = new Date(), randomBytes = crypto.randomBytes) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.[0-9]{3}Z$/, "Z");
  const runId = `${stamp}-${randomBytes(8).toString("hex")}`;
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("newRunId(): produced an id outside the run id grammar");
  return runId;
}

function runDirectoryRel(config, runId) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("runDirectoryRel(): invalid run id");
  return `${config.output.dir}/${RUNS_DIRECTORY}/${runId}`;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

// Deterministic JSON: object keys sorted at every depth, arrays in order.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function modelForRecord(env) {
  return typeof env === "string" && MODEL_PATTERN.test(env) ? env : null;
}

// --- bounded reads -----------------------------------------------------------------

function refusedRead(code, message) {
  return inputRefused(code, message);
}

// Opens `absPath` once and reads at most maxBytes + 1 bytes through that
// descriptor. The leaf must be a regular non-symlink file whose canonical
// location is inside `containerReal`, and the descriptor must be the same
// file that was lstat'ed.
function readBoundedFile(absPath, { containerReal, maxBytes, label, tooLargeCode = "RUN_ARTIFACT_INVALID" }) {
  let leaf;
  try {
    leaf = fs.lstatSync(absPath, { bigint: true });
  } catch {
    throw refusedRead("RUN_ARTIFACT_MISSING", `${label} is missing.`);
  }
  if (leaf.isSymbolicLink() || !leaf.isFile()) throw refusedRead("RUN_ARTIFACT_INVALID", `${label} must be a regular file (symbolic links are refused).`);
  let real;
  try {
    real = fs.realpathSync(absPath);
  } catch {
    throw refusedRead("RUN_ARTIFACT_INVALID", `${label} could not be resolved.`);
  }
  if (!isCanonicalPathInsideRoot({ root: containerReal, candidate: real }) || real === containerReal) {
    throw refusedRead("RUN_ARTIFACT_INVALID", `${label} resolves outside its expected directory.`);
  }

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd;
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | noFollow);
  } catch {
    throw refusedRead("RUN_ARTIFACT_INVALID", `${label} could not be opened.`);
  }
  const buffer = Buffer.alloc(Math.min(maxBytes + 1, Number(leaf.size) + 1));
  let total = 0;
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== leaf.dev || opened.ino !== leaf.ino) {
      throw refusedRead("RUN_ARTIFACT_INVALID", `${label} changed while it was being opened.`);
    }
    if (opened.size > BigInt(maxBytes)) throw refusedRead(tooLargeCode, `${label} exceeds the maximum of ${maxBytes} bytes.`);
    while (total < buffer.length) {
      const n = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (n === 0) break;
      total += n;
    }
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw refusedRead("RUN_ARTIFACT_INVALID", `${label} could not be read.`);
  } finally {
    fs.closeSync(fd);
  }
  if (total > maxBytes || total !== buffer.length - 1) {
    throw refusedRead("RUN_ARTIFACT_INVALID", `${label} changed size while it was being read.`);
  }
  return buffer.subarray(0, total);
}

function decodeJson(bytes, label) {
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch {
    throw refusedRead("RUN_ARTIFACT_INVALID", `${label} is not valid UTF-8.`);
  }
  try {
    return parseStrictJson(text);
  } catch {
    throw refusedRead("RUN_ARTIFACT_INVALID", `${label} is not valid strict JSON.`);
  }
}

// --- run-semantic projection ---------------------------------------------------------

function requirementsDigest(root, config) {
  if (!config.requirements) {
    throw inputRefused("REQUIREMENTS_NOT_CONFIGURED", "qa-agent.config.json has no requirements section (requirements.source / requirements.path).");
  }
  const abs = path.join(root.realRoot, ...config.requirements.path.split("/"));
  try {
    return sha256(readBoundedFile(abs, { containerReal: root.realRoot, maxBytes: MAX_REQUIREMENTS_BYTES, label: "the requirements file" }));
  } catch (err) {
    if (err instanceof CliError) throw inputRefused("REQUIREMENTS_INPUT_REFUSED", err.message);
    throw err;
  }
}

// RunSemanticProjection v1 (contract §10.5). capabilities, providers.allow
// and output.dir are excluded by design.
function computeProjection(config, reqDigest) {
  const projection = {
    projectionVersion: PROJECTION_VERSION,
    projectProfile: config.projectProfile,
    framework: config.framework,
    frameworkRuntime: config.frameworkRuntime,
    knowledge: config.knowledge,
    requirements: { source: config.requirements.source, path: config.requirements.path, digest: reqDigest },
  };
  return { projectionVersion: PROJECTION_VERSION, digest: sha256(Buffer.from(canonicalJson(projection), "utf8")) };
}

// --- run directory ------------------------------------------------------------------

function writeRefused(message) {
  return authorityRefused(
    "WRITE_TARGET_REFUSED",
    message || "the run directory resolves outside the repository root or into a protected location (symbolic link or junction redirect)."
  );
}

// Canonical containment + protected-prefix check for the run directory (and
// every existing component of it). Returns its canonical repository-relative
// form.
function authorizeRunDirectory(root, runDirRel, protectedPaths) {
  if (!Array.isArray(protectedPaths) || protectedPaths.length === 0) throw writeRefused();
  try {
    return assertCanonicallyContained(root, runDirRel, "the run directory", { protectedPaths });
  } catch {
    throw writeRefused();
  }
}

// Locates an EXISTING run directory for reading (plan/generate/review show).
function openRunDirectory(root, runDirRel, protectedPaths) {
  const authorized = authorizeRunDirectory(root, runDirRel, protectedPaths);
  let stat;
  try {
    stat = fs.statSync(authorized.canonical);
  } catch {
    throw inputRefused("RUN_NOT_FOUND", "no run with this id exists under output.dir (run \"qa-agent design\" first).");
  }
  if (!stat.isDirectory()) throw inputRefused("RUN_NOT_FOUND", "the run path is not a directory.");
  return fs.realpathSync(authorized.canonical);
}

function writeRunFile(root, runDirRel, relName, text, protectedPaths) {
  const authorized = authorizeRunDirectory(root, runDirRel, protectedPaths);
  const intended = path.join(root.realRoot, ...runDirRel.split("/"), ...relName.split("/"));
  let target;
  try {
    target = resolveSafeRepositoryWritePath(intended, root, "qa-agent run artifact");
  } catch (err) {
    throw writeRefused((err && err.message) || undefined);
  }
  let parent;
  try {
    parent = fs.realpathSync(path.dirname(target));
  } catch {
    throw writeRefused();
  }
  if (!isCanonicalPathInsideRoot({ root: root.realRoot, candidate: parent }) || parent === root.realRoot) throw writeRefused();
  const parentRel = toPosixRelative(root.realRoot, parent);
  if (protectedPaths.some((p) => pathsOverlap(parentRel, p))) throw writeRefused();
  if (!isCanonicalPathInsideRoot({ root: authorized.canonical, candidate: parent })) throw writeRefused();

  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(path.join(parent, path.basename(target)), flags, 0o644);
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// --- manifest -------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function closedKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(value, k));
}

function manifestInvalid(detail) {
  return inputRefused("RUN_MANIFEST_INVALID", `the run manifest is invalid (${detail}).`);
}

function validateArtifactEntry(entry, stage) {
  if (!closedKeys(entry, ["path", "kind", "schemaVersion", "sha256"])) throw manifestInvalid("artifact entry shape");
  if (typeof entry.path !== "string" || !ARTIFACT_PATH_PATTERN.test(entry.path) || !entry.path.startsWith(`${stage}/`)) throw manifestInvalid("artifact path");
  if (!STAGE_KINDS[stage].includes(entry.kind)) throw manifestInvalid("artifact kind");
  if (entry.schemaVersion !== ARTIFACT_CONTRACTS[entry.kind]) throw manifestInvalid("artifact schemaVersion");
  if (typeof entry.sha256 !== "string" || !DIGEST_PATTERN.test(entry.sha256)) throw manifestInvalid("artifact digest");
}

function validateStageEntry(entry, index) {
  if (!closedKeys(entry, ["stage", "completedAt", "provider", "artifacts"])) throw manifestInvalid("stage entry shape");
  if (entry.stage !== STAGE_ORDER[index]) throw manifestInvalid("stage order");
  if (typeof entry.completedAt !== "string" || !TIMESTAMP_PATTERN.test(entry.completedAt)) throw manifestInvalid("stage timestamp");
  if (!closedKeys(entry.provider, ["name", "model"]) || !PROVIDER_NAMES.includes(entry.provider.name)) throw manifestInvalid("stage provider");
  if (!(entry.provider.model === null || (typeof entry.provider.model === "string" && MODEL_PATTERN.test(entry.provider.model)))) throw manifestInvalid("stage model");
  if (!Array.isArray(entry.artifacts) || entry.artifacts.length === 0 || entry.artifacts.length > MAX_ARTIFACTS_PER_STAGE) throw manifestInvalid("stage artifacts");
  const seen = new Set();
  for (const artifact of entry.artifacts) {
    validateArtifactEntry(artifact, entry.stage);
    if (seen.has(artifact.path)) throw manifestInvalid("duplicate artifact path");
    seen.add(artifact.path);
  }
}

// Structural (closed schema) validation of a parsed manifest.
function validateManifestShape(manifest) {
  const v2 = manifest && manifest.schemaVersion === 2;
  if (!closedKeys(manifest, ["kind", "schemaVersion", "runId", "createdAt", "product", "projection", "contracts", "stages", ...(v2 ? ["reviews"] : [])])) throw manifestInvalid("top-level shape");
  // Historical Stage 3 v1 can still be read by Stage 3. Stage 4 refuses v1
  // explicitly and never migrates it or falls back from malformed v2.
  if (manifest.kind !== MANIFEST_KIND || ![1, 2].includes(manifest.schemaVersion)) throw manifestInvalid("kind/schemaVersion");
  if (typeof manifest.runId !== "string" || !RUN_ID_PATTERN.test(manifest.runId)) throw manifestInvalid("runId");
  if (typeof manifest.createdAt !== "string" || !TIMESTAMP_PATTERN.test(manifest.createdAt)) throw manifestInvalid("createdAt");
  if (!closedKeys(manifest.product, ["name", "version"]) || typeof manifest.product.name !== "string" || typeof manifest.product.version !== "string") {
    throw manifestInvalid("product");
  }
  if (!closedKeys(manifest.projection, ["projectionVersion", "digest"]) || typeof manifest.projection.digest !== "string" || !DIGEST_PATTERN.test(manifest.projection.digest)) {
    throw manifestInvalid("projection");
  }
  if (!isPlainObject(manifest.contracts)) throw manifestInvalid("contracts");
  if (!Array.isArray(manifest.stages) || manifest.stages.length === 0 || manifest.stages.length > STAGE_ORDER.length) throw manifestInvalid("stages");
  manifest.stages.forEach(validateStageEntry);
  if (v2) {
    if (!Array.isArray(manifest.reviews) || manifest.reviews.length > 9999 || manifest.reviews.length && manifest.stages.length !== 3) throw manifestInvalid("decision ledger");
    const recordIds = new Set();
    manifest.reviews.forEach((e, i) => {
      if (!closedKeys(e, ["ledgerIndex", "packageOrdinal", "recordPath", "recordSha256", "recordId", "decision", "decidedAt"]) || e.ledgerIndex !== i + 1 || !REVIEW_ORDINAL_PATTERN.test(e.packageOrdinal) || typeof e.recordId !== "string" || !/^[0-9a-f]{32}$/.test(e.recordId) || recordIds.has(e.recordId) || e.recordPath !== `review/record-${e.packageOrdinal}-${e.recordId}.json` || !DIGEST_PATTERN.test(e.recordSha256) || !["APPROVE", "REJECT"].includes(e.decision) || !validLedgerTimestamp(e.decidedAt)) throw manifestInvalid("ledger entry");
      recordIds.add(e.recordId);
    });
  }
  return manifest;
}

// Binding: the manifest must belong to THIS run directory, THIS product
// version, the current artifact contracts and the current run-semantic
// projection.
function verifyManifestBinding(manifest, { runId, product, projection }) {
  if (manifest.runId !== runId) throw inputRefused("RUN_IDENTITY_MISMATCH", "the run manifest names a different run than the requested --run (cross-run substitution refused).");
  if (manifest.product.name !== product.name || manifest.product.version !== product.version) {
    throw inputRefused("RUN_BINDING_MISMATCH", "the run was created by a different product version; finish or discard it and start a new run.");
  }
  if (canonicalJson(manifest.contracts) !== canonicalJson(ARTIFACT_CONTRACTS)) throw inputRefused("RUN_BINDING_MISMATCH", "the run's artifact contract versions differ from this product.");
  if (manifest.projection.projectionVersion !== projection.projectionVersion || manifest.projection.digest !== projection.digest) {
    throw inputRefused(
      "RUN_BINDING_MISMATCH",
      "the run-semantic configuration (projectProfile, framework, frameworkRuntime, knowledge, requirements file) changed since the run was created."
    );
  }
}

function loadManifest(runDirReal) {
  const bytes = readBoundedFile(path.join(runDirReal, MANIFEST_FILE_NAME), { containerReal: runDirReal, maxBytes: MAX_MANIFEST_BYTES, label: "the run manifest" });
  return { manifest: validateManifestShape(decodeJson(bytes, "the run manifest")), digest: sha256(bytes) };
}

// Stage gate: `stage` may run only directly after its predecessor and only
// once per run.
function assertStageReady(manifest, stage) {
  const done = manifest.stages.map((s) => s.stage);
  const index = STAGE_ORDER.indexOf(stage);
  if (done.includes(stage)) throw inputRefused("RUN_STAGE_ALREADY_COMPLETED", `"${stage}" already completed for this run; start a new run with "qa-agent design".`);
  if (done.length !== index) throw inputRefused("RUN_STAGE_ORDER", `"${stage}" requires the "${STAGE_ORDER[index - 1]}" stage of this run to be completed first.`);
}

// Reads every artifact recorded for `stage`, verifies its exact bytes
// against the recorded digest and its declared kind/schemaVersion, and
// returns the parsed (still untrusted) values in manifest order.
function loadStageArtifacts(runDirReal, manifest, stage) {
  const entry = manifest.stages.find((s) => s.stage === stage);
  if (!entry) throw inputRefused("RUN_STAGE_ORDER", `the run has no completed "${stage}" stage.`);
  return entry.artifacts.map((artifact) => {
    const label = `run artifact ${artifact.path}`;
    const bytes = readBoundedFile(path.join(runDirReal, ...artifact.path.split("/")), { containerReal: runDirReal, maxBytes: MAX_ARTIFACT_BYTES, label });
    if (sha256(bytes) !== artifact.sha256) {
      throw inputRefused("RUN_ARTIFACT_DIGEST_MISMATCH", `${label} does not match the digest recorded in the run manifest (modified, corrupted or substituted).`);
    }
    const value = decodeJson(bytes, label);
    const typed = artifact.kind !== "AutomationRepositoryContext";
    if (typed && (!isPlainObject(value) || value.kind !== artifact.kind || value.schemaVersion !== artifact.schemaVersion)) {
      throw inputRefused("RUN_ARTIFACT_INVALID", `${label} is not the ${artifact.kind} v${artifact.schemaVersion} the manifest records.`);
    }
    return { path: artifact.path, kind: artifact.kind, value };
  });
}

function stageRecord(stage, { provider, model, completedAt, artifacts }) {
  return { stage, completedAt, provider: { name: provider, model: modelForRecord(model) }, artifacts };
}

function newManifest({ runId, product, projection, createdAt }) {
  return {
    kind: MANIFEST_KIND,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    runId,
    createdAt,
    product: { name: product.name, version: product.version },
    projection: { projectionVersion: projection.projectionVersion, digest: projection.digest },
    contracts: { ...ARTIFACT_CONTRACTS },
    stages: [],
    reviews: [],
  };
}

// Writes the stage artifacts and then (last, as the commit point) the
// manifest with the new stage appended. The manifest bytes on disk must
// still equal those the command started from, so two concurrent commands on
// one run cannot interleave.
function commitStage(root, runDirRel, protectedPaths, { manifest, previousDigest, stage, files, provider, model, now }) {
  const artifacts = [];
  for (const file of files) {
    const text = serialize(file.value);
    writeRunFile(root, runDirRel, file.path, text, protectedPaths);
    artifacts.push({ path: file.path, kind: file.kind, schemaVersion: ARTIFACT_CONTRACTS[file.kind], sha256: sha256(Buffer.from(text, "utf8")) });
  }
  if (previousDigest !== null) {
    const runDirReal = openRunDirectory(root, runDirRel, protectedPaths);
    if (loadManifest(runDirReal).digest !== previousDigest) {
      throw inputRefused("RUN_CHANGED_DURING_COMMAND", "the run manifest changed while this command was running; nothing was recorded.");
    }
  }
  const next = { ...manifest, stages: [...manifest.stages, stageRecord(stage, { provider, model, completedAt: now.toISOString(), artifacts })] };
  validateManifestShape(JSON.parse(JSON.stringify(next)));
  writeRunFile(root, runDirRel, MANIFEST_FILE_NAME, serialize(next), protectedPaths);
  return next;
}

// `design` creates the run directory; it must not exist yet.
function createRunDirectory(root, runDirRel, protectedPaths) {
  const authorized = authorizeRunDirectory(root, runDirRel, protectedPaths);
  if (fs.existsSync(authorized.canonical)) throw writeRefused("the run directory already exists.");
}

module.exports = {
  MANIFEST_KIND,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_FILE_NAME,
  PROJECTION_VERSION,
  RUNS_DIRECTORY,
  STAGE_ORDER,
  ARTIFACT_CONTRACTS,
  MAX_ARTIFACT_BYTES,
  newRunId,
  runDirectoryRel,
  sha256,
  canonicalJson,
  requirementsDigest,
  computeProjection,
  openRunDirectory,
  createRunDirectory,
  loadManifest,
  validateManifestShape,
  verifyManifestBinding,
  assertStageReady,
  loadStageArtifacts,
  newManifest,
  commitStage,
  readBoundedFile,
  decodeJson,
  serialize,
  MAX_MANIFEST_BYTES,
};
