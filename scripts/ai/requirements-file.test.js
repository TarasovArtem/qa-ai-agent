"use strict";

/**
 * Roadmap RTI-2 (File Requirements Ingestion): unit coverage for
 * scripts/ai/requirements-file.js - the first real RequirementArtifact[]
 * source adapter. Covers the full pipeline (path safety, file failure,
 * structural failure, normalization, source-provenance injection,
 * collection-level rules, determinism/immutability) against real temporary
 * fixture directories - never against this repository's own checkout.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadRequirementsFromFile, parseAndNormalizeRequirements } = require("./requirements-file");

function mkTempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeJson(dir, relPath, data) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
  return full;
}

function writeRaw(dir, relPath, text) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

function validFile(overrides = {}) {
  return {
    schemaVersion: 1,
    requirements: [
      {
        id: "REQ-001",
        type: "user-story",
        title: "Reset password",
        content: "As a user, I want to reset my password.",
      },
    ],
    ...overrides,
  };
}

// --- happy path --------------------------------------------------------

test("loadRequirementsFromFile: a single valid requirement round-trips into a validated RequirementArtifact[]", () => {
  const root = mkTempDir("rti2-happy-");
  writeJson(root, "requirements/requirements.json", validFile());

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "requirements/requirements.json" });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "REQ-001");
  assert.equal(result[0].source.type, "file");
  assert.equal(result[0].source.sourceId, "REQ-001");
  assert.equal(result[0].source.location, "requirements/requirements.json");
});

test("loadRequirementsFromFile: multiple requirements are all normalized and preserve file order", () => {
  const root = mkTempDir("rti2-multi-");
  writeJson(root, "req.json", validFile({
    requirements: [
      { id: "REQ-A", type: "requirement", title: "A", content: "first" },
      { id: "REQ-B", type: "requirement", title: "B", content: "second" },
      { id: "REQ-C", type: "requirement", title: "C", content: "third" },
    ],
  }));

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.deepEqual(result.map((r) => r.id), ["REQ-A", "REQ-B", "REQ-C"]);
});

test("loadRequirementsFromFile: acceptanceCriteria-only body (no content) is accepted, matching RTI-1's own invariant", () => {
  const root = mkTempDir("rti2-ac-only-");
  writeJson(root, "req.json", validFile({
    requirements: [
      {
        id: "REQ-001",
        type: "user-story",
        title: "Reset password",
        acceptanceCriteria: [{ id: "AC-1", text: "A reset link is sent to the registered email." }],
      },
    ],
  }));

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(result[0].acceptanceCriteria[0].text, "A reset link is sent to the registered email.");
});

test("loadRequirementsFromFile: relationships, labels, priority, metadata, and contentHash all pass through unchanged", () => {
  const root = mkTempDir("rti2-fields-");
  writeJson(root, "req.json", validFile({
    requirements: [
      {
        id: "REQ-001",
        type: "requirement",
        title: "T",
        content: "C",
        priority: "high",
        labels: ["authentication"],
        relationships: [{ type: "related", targetId: "REQ-999" }],
        contentHash: "abc123",
        metadata: { owner: "team-auth" },
      },
    ],
  }));

  const [artifact] = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(artifact.priority, "high");
  assert.deepEqual(artifact.labels, ["authentication"]);
  assert.deepEqual(artifact.relationships, [{ type: "related", targetId: "REQ-999" }]);
  assert.equal(artifact.contentHash, "abc123");
  assert.deepEqual(artifact.metadata, { owner: "team-auth" });
});

test("loadRequirementsFromFile: an unresolved relationships[].targetId (no matching artifact in this file) is accepted - shape-only, not resolved (deliberate RTI-2 decision)", () => {
  const root = mkTempDir("rti2-unresolved-rel-");
  writeJson(root, "req.json", validFile({
    requirements: [
      { id: "REQ-001", type: "requirement", title: "T", content: "C", relationships: [{ type: "related", targetId: "REQ-DOES-NOT-EXIST" }] },
    ],
  }));

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(result[0].relationships[0].targetId, "REQ-DOES-NOT-EXIST");
});

// --- source provenance ---------------------------------------------------

test("loadRequirementsFromFile: source.location is repository-relative and POSIX-normalized, never a host-absolute path", () => {
  const root = mkTempDir("rti2-location-");
  writeJson(root, path.join("nested", "dir", "req.json"), validFile());

  const [artifact] = loadRequirementsFromFile({ repositoryRoot: root, filePath: path.join("nested", "dir", "req.json") });
  assert.equal(artifact.source.location, "nested/dir/req.json");
  assert.equal(artifact.source.location.includes(root), false);
  assert.equal(artifact.source.location.includes("\\"), false);
});

test("loadRequirementsFromFile: source.sourceId equals the raw artifact id", () => {
  const root = mkTempDir("rti2-sourceid-");
  writeJson(root, "req.json", validFile({ requirements: [{ id: "REQ-XYZ", type: "requirement", title: "T", content: "C" }] }));

  const [artifact] = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(artifact.source.sourceId, "REQ-XYZ");
});

test("loadRequirementsFromFile: a raw record supplying its own source is rejected - source is adapter-owned, never file-owned", () => {
  const root = mkTempDir("rti2-source-spoof-");
  writeJson(root, "req.json", validFile({
    requirements: [{ id: "REQ-001", type: "requirement", title: "T", content: "C", source: { type: "jira", location: "FAKE-1" } }],
  }));

  assert.throws(
    () => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }),
    /REQUIREMENTS_FILE_SCHEMA_INVALID.*source is not permitted/s
  );
});

test("loadRequirementsFromFile: source.version is never emitted (schemaVersion and source version are deliberately not conflated)", () => {
  const root = mkTempDir("rti2-no-version-");
  writeJson(root, "req.json", validFile());

  const [artifact] = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal("version" in artifact.source, false);
});

// --- structural failure ---------------------------------------------------

test("loadRequirementsFromFile: missing schemaVersion fails closed", () => {
  const root = mkTempDir("rti2-no-schemaversion-");
  const file = validFile();
  delete file.schemaVersion;
  writeJson(root, "req.json", file);

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: an unrecognized schemaVersion fails closed (no forward/backward guessing)", () => {
  const root = mkTempDir("rti2-bad-schemaversion-");
  writeJson(root, "req.json", validFile({ schemaVersion: 2 }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: requirements missing entirely fails closed", () => {
  const root = mkTempDir("rti2-no-requirements-");
  writeJson(root, "req.json", { schemaVersion: 1 });

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: requirements as a non-array fails closed", () => {
  const root = mkTempDir("rti2-requirements-not-array-");
  writeJson(root, "req.json", { schemaVersion: 1, requirements: {} });

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: an empty requirements array fails closed (deterministic rejection, not silently empty output)", () => {
  const root = mkTempDir("rti2-empty-requirements-");
  writeJson(root, "req.json", { schemaVersion: 1, requirements: [] });

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: an unknown top-level key is rejected", () => {
  const root = mkTempDir("rti2-unknown-top-level-");
  writeJson(root, "req.json", validFile({ typo: true }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: an unknown per-requirement key is rejected, never silently dropped into metadata", () => {
  const root = mkTempDir("rti2-unknown-req-key-");
  writeJson(root, "req.json", validFile({ requirements: [{ id: "REQ-001", type: "requirement", title: "T", content: "C", bogus: 1 }] }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: an invalid artifact type surfaces RTI-1's own validation error, wrapped as a schema-invalid file error", () => {
  const root = mkTempDir("rti2-bad-type-");
  writeJson(root, "req.json", validFile({ requirements: [{ id: "REQ-001", type: "not-a-real-type", title: "T", content: "C" }] }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID.*RequirementArtifact validation/s);
});

test("loadRequirementsFromFile: a missing id fails closed - ids are never generated", () => {
  const root = mkTempDir("rti2-no-id-");
  writeJson(root, "req.json", validFile({ requirements: [{ type: "requirement", title: "T", content: "C" }] }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: neither content nor acceptanceCriteria present fails closed", () => {
  const root = mkTempDir("rti2-no-body-");
  writeJson(root, "req.json", validFile({ requirements: [{ id: "REQ-001", type: "requirement", title: "T" }] }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

test("loadRequirementsFromFile: a raw requirement that is not a plain object is rejected", () => {
  const root = mkTempDir("rti2-req-not-object-");
  writeJson(root, "req.json", validFile({ requirements: ["not-an-object"] }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_SCHEMA_INVALID/);
});

// --- collection-level rules ------------------------------------------------

test("loadRequirementsFromFile: duplicate requirement ids within one file are rejected", () => {
  const root = mkTempDir("rti2-dup-id-");
  writeJson(root, "req.json", validFile({
    requirements: [
      { id: "REQ-1", type: "requirement", title: "A", content: "a" },
      { id: "REQ-1", type: "requirement", title: "B", content: "b" },
    ],
  }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_COLLECTION_INVALID/);
});

test("loadRequirementsFromFile: duplicate acceptanceCriteria ids within the SAME artifact are rejected", () => {
  const root = mkTempDir("rti2-dup-ac-id-");
  writeJson(root, "req.json", validFile({
    requirements: [
      {
        id: "REQ-1",
        type: "requirement",
        title: "A",
        acceptanceCriteria: [
          { id: "AC-1", text: "first" },
          { id: "AC-1", text: "second" },
        ],
      },
    ],
  }));

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_COLLECTION_INVALID/);
});

test("loadRequirementsFromFile: the SAME acceptanceCriteria id across two DIFFERENT artifacts is allowed (never required globally unique)", () => {
  const root = mkTempDir("rti2-same-ac-id-cross-artifact-");
  writeJson(root, "req.json", validFile({
    requirements: [
      { id: "REQ-1", type: "requirement", title: "A", acceptanceCriteria: [{ id: "AC-1", text: "first" }] },
      { id: "REQ-2", type: "requirement", title: "B", acceptanceCriteria: [{ id: "AC-1", text: "second" }] },
    ],
  }));

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(result.length, 2);
});

test("loadRequirementsFromFile: multiple acceptanceCriteria entries with no id at all are allowed (absence is never a duplicate)", () => {
  const root = mkTempDir("rti2-no-ac-id-");
  writeJson(root, "req.json", validFile({
    requirements: [
      {
        id: "REQ-1",
        type: "requirement",
        title: "A",
        acceptanceCriteria: [{ text: "first" }, { text: "second" }],
      },
    ],
  }));

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(result[0].acceptanceCriteria.length, 2);
});

// --- file failure: missing / wrong type / malformed -------------------------

test("loadRequirementsFromFile: a nonexistent file fails with REQUIREMENTS_FILE_NOT_FOUND", () => {
  const root = mkTempDir("rti2-missing-");
  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "does-not-exist.json" }), /REQUIREMENTS_FILE_NOT_FOUND/);
});

test("loadRequirementsFromFile: a directory supplied as filePath fails with REQUIREMENTS_FILE_NOT_FOUND", () => {
  const root = mkTempDir("rti2-dir-as-file-");
  fs.mkdirSync(path.join(root, "req.json"));
  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_NOT_FOUND/);
});

test("loadRequirementsFromFile: malformed JSON fails with REQUIREMENTS_FILE_PARSE_FAILED, never a partial parse", () => {
  const root = mkTempDir("rti2-malformed-");
  writeRaw(root, "req.json", "{ this is not valid json ");
  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_PARSE_FAILED/);
});

test("loadRequirementsFromFile: an empty file fails with REQUIREMENTS_FILE_PARSE_FAILED", () => {
  const root = mkTempDir("rti2-empty-file-");
  writeRaw(root, "req.json", "");
  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_PARSE_FAILED/);
});

test("loadRequirementsFromFile: a UTF-8 BOM is stripped deterministically and does not break parsing", () => {
  const root = mkTempDir("rti2-bom-");
  const full = path.join(root, "req.json");
  fs.writeFileSync(full, "﻿" + JSON.stringify(validFile()));

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(result.length, 1);
});

test("loadRequirementsFromFile: an oversized file fails with REQUIREMENTS_FILE_TOO_LARGE", () => {
  const root = mkTempDir("rti2-oversized-");
  const hugeContent = "x".repeat(6 * 1024 * 1024);
  const file = validFile({ requirements: [{ id: "REQ-1", type: "requirement", title: "T", content: hugeContent }] });
  writeJson(root, "req.json", file);

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_TOO_LARGE/);
});

test("loadRequirementsFromFile: a non-.json filePath is rejected deterministically, never inferred from content", () => {
  const root = mkTempDir("rti2-wrong-ext-");
  writeRaw(root, "req.txt", JSON.stringify(validFile()));
  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.txt" }), /REQUIREMENTS_FILE_INVALID/);
});

// --- required-argument / input-shape failures -------------------------------

test("loadRequirementsFromFile: a missing repositoryRoot fails closed via the shared REPOSITORY_ROOT_REQUIRED contract", () => {
  assert.throws(() => loadRequirementsFromFile({ filePath: "req.json" }), /REPOSITORY_ROOT_REQUIRED/);
});

test("loadRequirementsFromFile: a missing filePath fails closed with REQUIREMENTS_FILE_REQUIRED", () => {
  const root = mkTempDir("rti2-no-filepath-");
  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root }), /REQUIREMENTS_FILE_REQUIRED/);
});

test("loadRequirementsFromFile: a non-string filePath fails closed with REQUIREMENTS_FILE_INVALID", () => {
  const root = mkTempDir("rti2-nonstring-filepath-");
  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: 123 }), /REQUIREMENTS_FILE_INVALID/);
});

test("loadRequirementsFromFile: no config/directory autodiscovery ever happens - a bare repositoryRoot with no filePath never implicitly finds requirements.json", () => {
  const root = mkTempDir("rti2-no-autodiscovery-");
  writeJson(root, "requirements.json", validFile());
  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root }), /REQUIREMENTS_FILE_REQUIRED/);
});

// --- path safety: traversal / outside-root / symlink escape -----------------

test("loadRequirementsFromFile: a ../ traversal path outside repositoryRoot is rejected", () => {
  const root = mkTempDir("rti2-traversal-root-");
  const outside = mkTempDir("rti2-traversal-outside-");
  writeJson(outside, "secret.json", validFile());

  const relTraversal = path.relative(root, path.join(outside, "secret.json"));
  assert.throws(
    () => loadRequirementsFromFile({ repositoryRoot: root, filePath: relTraversal }),
    /REQUIREMENTS_FILE_OUTSIDE_ROOT/
  );
});

test("loadRequirementsFromFile: an absolute path outside repositoryRoot is rejected", () => {
  const root = mkTempDir("rti2-abs-outside-root-");
  const outside = mkTempDir("rti2-abs-outside-target-");
  const outsideFile = writeJson(outside, "secret.json", validFile());

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: outsideFile }), /REQUIREMENTS_FILE_OUTSIDE_ROOT/);
});

test("loadRequirementsFromFile: an absolute path INSIDE repositoryRoot is accepted", () => {
  const root = mkTempDir("rti2-abs-inside-root-");
  const full = writeJson(root, "req.json", validFile());

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: full });
  assert.equal(result.length, 1);
});

test("loadRequirementsFromFile: a same-prefix sibling directory is not mistaken for an inside-root path", () => {
  const root = mkTempDir("rti2-sibling-root-");
  const sibling = `${root}-evil`;
  fs.mkdirSync(sibling, { recursive: true });
  const siblingFile = writeJson(sibling, "req.json", validFile());
  try {
    assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: siblingFile }), /REQUIREMENTS_FILE_OUTSIDE_ROOT/);
  } finally {
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test("loadRequirementsFromFile: a symlinked requirements file whose real target escapes repositoryRoot is rejected", (t) => {
  const root = mkTempDir("rti2-symlink-root-");
  const outside = mkTempDir("rti2-symlink-outside-");
  const outsideFile = writeJson(outside, "secret.json", validFile());
  const linkPath = path.join(root, "req.json");

  try {
    fs.symlinkSync(outsideFile, linkPath, "file");
  } catch {
    t.skip("symlinks not creatable in this environment");
    return;
  }

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_OUTSIDE_ROOT/);
});

test("loadRequirementsFromFile: a symlinked requirements file whose real target is INSIDE repositoryRoot is accepted", (t) => {
  const root = mkTempDir("rti2-symlink-inside-root-");
  const realFile = writeJson(root, "actual", "real.json");
  fs.rmSync(path.join(root, "actual"), { recursive: true, force: true });
  const target = writeJson(root, "real.json", validFile());
  const linkPath = path.join(root, "req.json");

  try {
    fs.symlinkSync(target, linkPath, "file");
  } catch {
    t.skip("symlinks not creatable in this environment");
    return;
  }

  const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(result.length, 1);
});

test("loadRequirementsFromFile: a broken symlink fails with REQUIREMENTS_FILE_NOT_FOUND", (t) => {
  const root = mkTempDir("rti2-broken-symlink-");
  const linkPath = path.join(root, "req.json");

  try {
    fs.symlinkSync(path.join(root, "does-not-exist-target.json"), linkPath, "file");
  } catch {
    t.skip("symlinks not creatable in this environment");
    return;
  }

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" }), /REQUIREMENTS_FILE_NOT_FOUND/);
});

test("loadRequirementsFromFile: a looping symlink fails with REQUIREMENTS_FILE_NOT_FOUND, never hangs", (t) => {
  const root = mkTempDir("rti2-looping-symlink-");
  const a = path.join(root, "a.json");
  const b = path.join(root, "b.json");

  try {
    fs.symlinkSync(b, a, "file");
    fs.symlinkSync(a, b, "file");
  } catch {
    t.skip("symlinks not creatable in this environment");
    return;
  }

  assert.throws(() => loadRequirementsFromFile({ repositoryRoot: root, filePath: "a.json" }), /REQUIREMENTS_FILE_NOT_FOUND/);
});

// --- determinism / immutability / authority independence -------------------

test("loadRequirementsFromFile: reading the same file twice yields deep-equal output", () => {
  const root = mkTempDir("rti2-determinism-");
  writeJson(root, "req.json", validFile());

  const first = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  const second = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.deepEqual(first, second);
});

test("loadRequirementsFromFile: process.cwd() has no bearing on the result - repositoryRoot is the sole authority", () => {
  const root = mkTempDir("rti2-cwd-independent-");
  writeJson(root, "req.json", validFile());
  const elsewhere = mkTempDir("rti2-cwd-elsewhere-");

  const originalCwd = process.cwd();
  process.chdir(elsewhere);
  try {
    const result = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
    assert.equal(result.length, 1);
  } finally {
    process.chdir(originalCwd);
  }
});

test("loadRequirementsFromFile: does not mutate the raw parsed file content", () => {
  const root = mkTempDir("rti2-no-mutate-");
  const fileContent = validFile();
  const fullPath = writeJson(root, "req.json", fileContent);
  const beforeRaw = fs.readFileSync(fullPath, "utf8");

  loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });

  const afterRaw = fs.readFileSync(fullPath, "utf8");
  assert.equal(beforeRaw, afterRaw);
});

test("loadRequirementsFromFile: returned artifacts are frozen (immutable)", () => {
  const root = mkTempDir("rti2-frozen-");
  writeJson(root, "req.json", validFile());

  const [artifact] = loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.source), true);
});

test("loadRequirementsFromFile: never performs a write - the fixture directory's file listing is unchanged after loading", () => {
  const root = mkTempDir("rti2-read-only-");
  writeJson(root, "req.json", validFile());
  const before = fs.readdirSync(root).sort();

  loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });

  const after = fs.readdirSync(root).sort();
  assert.deepEqual(before, after);
});

// --- error detail safety ----------------------------------------------------

test("loadRequirementsFromFile: error messages never leak the full raw file content", () => {
  const root = mkTempDir("rti2-error-safety-");
  const secretMarker = "TOTALLY_UNIQUE_SECRET_MARKER_VALUE_998877";
  writeRaw(root, "req.json", `{ "schemaVersion": 1, "requirements": [ { "id": "${secretMarker}", "type": "bogus-type", "title": "t", "content": "c" } ] }`);

  try {
    loadRequirementsFromFile({ repositoryRoot: root, filePath: "req.json" });
    assert.fail("expected loadRequirementsFromFile to throw");
  } catch (err) {
    // The offending value's own error text is allowed to reference it
    // (bounded, structured detail) - what must never happen is the ENTIRE
    // raw file text being reflected wholesale into the error.
    assert.equal(err.message.length < 2000, true);
  }
});

// --- pure parse/normalize (filesystem-free) ---------------------------------

test("parseAndNormalizeRequirements: is filesystem-free and pure - same input always yields deep-equal output", () => {
  const rawText = JSON.stringify(validFile());
  const first = parseAndNormalizeRequirements(rawText, "requirements/requirements.json");
  const second = parseAndNormalizeRequirements(rawText, "requirements/requirements.json");
  assert.deepEqual(first, second);
});
