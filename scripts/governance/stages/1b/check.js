/**
 * GOV-AUTO-1 Wave 1 / 1B -- Markdown and reference integrity (design sections 6, 18).
 *
 * checkReferences() consumes the canonical changed-file set that 1A produced (it
 * never runs its own diff and never calls Git to rediscover changed files), the
 * exact head bytes (read from Git objects through the head reader), the validated
 * effective policy's Markdown/ID-family configuration and the run subject.
 *
 * Every structural fact is its own record (no single aggregate PASS hides an
 * underlying fact):
 *   1B.MARKDOWN.FILES      selection, readability, encoding and bounds
 *   1B.MARKDOWN.FENCES     fenced code blocks (unclosed fence)
 *   1B.MARKDOWN.TABLES     table delimiter/alignment/row cardinality
 *   1B.MARKDOWN.HEADINGS   headings extracted (anchors generated)
 *   1B.MARKDOWN.ANCHORS    local and cross-file heading anchors exist
 *   1B.MARKDOWN.LINKS      repository-local link targets exist and stay in the root
 *   1B.REFERENCES.<FAMILY> per configured ID family: dangling, duplicate, malformed
 *
 * 1B judges STRUCTURE only. It never decides whether a statement is true, whether
 * evidence is sufficient, whether a risk is acceptable or whether a word such as
 * "confirmed" is justified: that is human review and later stages.
 * External URLs are structural only (no network, no liveness).
 */

"use strict";

const nodePath = require("node:path");
const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { parsePathPattern, matchPathPattern } = require("../../safety/path-patterns");
const { validateRepoRelativePath, compareBytewise } = require("../../safety/repo-path");
const { createRecordFactory, isValidSubject, sameSubject, sample } = require("../common");
const { resolveGitAdapter } = require("../1a/git-adapter");
const { resolveReader } = require("../head-reader");
const { validateBasePolicy, resolveFrameworkMetadata } = require("../1a/policy");

/** Metadata deciding schema/capability support: the caller-supplied target-tip metadata when valid. */
const metadataOf = (input) => {
  const r = resolveFrameworkMetadata(input.targetFrameworkMetadata);
  return r.ok ? r.metadata : { supportedCapabilities: [], supportedSchemaVersions: { minSupported: 1, maxSupported: 0 } };
};
const { parseDocument, MAX_BYTES } = require("./markdown");
const { compileFamily, extractFamily } = require("./ids");

const MAX_SELECTED = 500;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_TARGET_DOCS = 200;
const MAX_DEFINITION_DOCS = 500;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

const finding = (path, line, message, code) => ({ path, line, message, code });
const render = (f) => `${f.path}:${f.line}: ${f.message}`;
const byLocation = (a, b) => compareBytewise(a.path, b.path) || a.line - b.line || compareBytewise(a.message, b.message);

function invalid(detail, status = STATUS.CONFIGURATION_ERROR, reasonCode = REASON.CHANGED_FILES_INPUT_INVALID) {
  return deepFreeze({ subject: null, records: [], outcome: { status, reasonCode, detail } });
}

/** Decide (without I/O) what a link destination points at. */
function classifyDestination(docPath, raw) {
  const dest = raw.trim();
  if (dest === "") return { error: REASON.LINK_TARGET_MISSING, message: "empty link destination" };
  if (/^[A-Za-z]:[\\/]/.test(dest)) return { error: REASON.LINK_ESCAPES_ROOT, message: "drive-letter link destination" };
  if (SCHEME.test(dest) || dest.startsWith("//")) return { external: true };
  const hash = dest.indexOf("#");
  let pathPart = hash >= 0 ? dest.slice(0, hash) : dest;
  let fragment = hash >= 0 ? dest.slice(hash + 1) : "";
  const query = pathPart.indexOf("?");
  if (query >= 0) pathPart = pathPart.slice(0, query);
  try {
    pathPart = decodeURIComponent(pathPart);
  } catch {
    return { error: REASON.LINK_TARGET_MISSING, message: "invalid percent-encoding in link path" };
  }
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    /* keep the raw fragment: it can then only fail to match */
  }
  if (UNSAFE_CHARS.test(pathPart)) return { error: REASON.LINK_ESCAPES_ROOT, message: "link path contains a control character or backslash" };
  if (pathPart === "") return { kind: "anchor", target: docPath, fragment };
  const isDir = pathPart.endsWith("/");
  const joined = pathPart.startsWith("/") ? pathPart.slice(1) : nodePath.posix.join(nodePath.posix.dirname(docPath), pathPart);
  const normalized = nodePath.posix.normalize(joined).replace(/\/$/, "");
  // The repository root itself ("" or ".") is a valid in-repository directory target;
  // only a path that climbs ABOVE it escapes.
  if (normalized === "" || normalized === ".") return { kind: "path", target: "", root: true, fragment, expectDir: true };
  if (normalized === ".." || normalized.startsWith("../") || !validateRepoRelativePath(normalized).ok) {
    return { error: REASON.LINK_ESCAPES_ROOT, message: "link path resolves outside the repository root" };
  }
  return { kind: "path", target: normalized, fragment, expectDir: isDir };
}

/**
 * checkReferences({ subject, changedFiles, policy, git | reader | { repositoryRoot, gitExecutable } })
 * `changedFiles` must be the getChangedFiles() result for the same subject.
 */
async function checkReferences(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalid("a valid subject is required");
  const subject = input.subject;
  const out = createRecordFactory(subject, "1B");
  const { add, notApplicable } = out;
  const done = () => deepFreeze({ subject, records: out.records, outcome: null });

  const changed = input.changedFiles;
  if (!isPlainObject(changed) || !Array.isArray(changed.files) || !sameSubject(changed.subject, subject)) {
    add("1B.MARKDOWN.FILES", STATUS.CONFIGURATION_ERROR, REASON.CHANGED_FILES_INPUT_INVALID, "changedFiles must be the 1A getChangedFiles() result for the same subject", {});
    return done();
  }
  if (changed.complete !== true) {
    add("1B.MARKDOWN.FILES", STATUS.INCOMPLETE, REASON.CHANGED_FILES_INPUT_INVALID, "the 1A changed-file set is not complete: Markdown integrity cannot be trusted", {});
    return done();
  }
  if (!changed.files.every((p) => validateRepoRelativePath(p).ok)) {
    add("1B.MARKDOWN.FILES", STATUS.CONFIGURATION_ERROR, REASON.CHANGED_FILES_INPUT_INVALID, "the 1A changed-file set contains a non-canonical path", {});
    return done();
  }

  // Effective Markdown configuration: validated policy, or the built-in minimum (nothing selected).
  const supplied = input.policy;
  let markdown = { filePatterns: [], idFamilies: [] };
  if (isPlainObject(supplied) && !(supplied.scope && Array.isArray(supplied.scope.allowedPathDomains) && supplied.scope.allowedPathDomains.length === 0)) {
    const validated = validateBasePolicy(supplied, metadataOf(input));
    if (!validated.ok) {
      add("1B.MARKDOWN.FILES", validated.status, REASON.ID_FAMILY_CONFIG_INVALID, "the effective policy (Markdown / ID-family configuration) is not valid", {});
      return done();
    }
    markdown = validated.policy.markdown;
  } else if (!isPlainObject(supplied)) {
    add("1B.MARKDOWN.FILES", STATUS.INCOMPLETE, REASON.POLICY_INVALID, "no effective policy was supplied", {});
    return done();
  }
  const families = markdown.idFamilies.map(compileFamily);
  const patterns = markdown.filePatterns.map((p) => parsePathPattern(p).pattern);

  const selected = changed.files.filter((f) => patterns.some((p) => matchPathPattern(p, f)));
  const naAll = (proof) => {
    for (const id of ["FILES", "FENCES", "TABLES", "HEADINGS", "ANCHORS", "LINKS"]) notApplicable(`1B.MARKDOWN.${id}`, proof);
    for (const f of families) notApplicable(`1B.REFERENCES.${f.name}`, proof);
  };
  if (selected.length === 0) {
    naAll(patterns.length === 0 ? "the effective policy selects no Markdown files" : "no changed file matches the configured Markdown file patterns");
    return done();
  }
  if (selected.length > MAX_SELECTED) {
    add("1B.MARKDOWN.FILES", STATUS.INCOMPLETE, REASON.MARKDOWN_BOUND_EXCEEDED, "too many changed Markdown files for one run", { selected: selected.length });
    return done();
  }

  const adapter = resolveGitAdapter(input);
  const resolved = resolveReader(input, adapter.ok ? adapter.git : null, subject.head);
  if (!resolved.ok) {
    add("1B.MARKDOWN.FILES", STATUS.CONFIGURATION_ERROR, REASON.MARKDOWN_UNREADABLE, "no usable content reader was supplied", {});
    return done();
  }
  const reader = resolved.reader;

  // Documents are loaded once and cached: changed documents, link targets and ID-definition sources.
  const cache = new Map();
  let totalBytes = 0;
  const problems = { encoding: [], bound: [], unreadable: [] };
  async function load(path, why) {
    if (cache.has(path)) return cache.get(path);
    const got = await reader.read(path, MAX_BYTES);
    let entry;
    if (got.kind === "blob") {
      totalBytes += got.bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        problems.bound.push(finding(path, 1, "the total Markdown bytes exceed the supported bound"));
        entry = { kind: "bound" };
      } else {
        const doc = parseDocument({ path, bytes: got.bytes });
        if (doc.ok) entry = { kind: "doc", doc, anchors: new Set(doc.structure.anchors) };
        else if (doc.reasonCode === REASON.MARKDOWN_ENCODING_INVALID) {
          problems.encoding.push(finding(path, 1, "the file is not valid UTF-8"));
          entry = { kind: "encoding" };
        } else {
          problems.bound.push(finding(path, 1, doc.detail));
          entry = { kind: "bound" };
        }
      }
    } else if (got.kind === "too-large") {
      problems.bound.push(finding(path, 1, "the file exceeds the per-file size bound"));
      entry = { kind: "bound" };
    } else if (got.kind === "error") {
      problems.unreadable.push(finding(path, 1, `${why} could not be read`));
      entry = { kind: "unreadable" };
    } else entry = { kind: got.kind }; // absent | symlink | tree | submodule
    cache.set(path, entry);
    return entry;
  }

  const changedDocs = [];
  let skipped = 0;
  for (const path of selected) {
    const entry = await load(path, "a changed Markdown file");
    if (entry.kind === "doc") changedDocs.push({ path, entry });
    else skipped += 1;
  }

  const fenceFindings = [];
  const tableFindings = [];
  const anchorFindings = [];
  const linkFindings = [];
  let headingCount = 0;
  let targetDocs = 0;
  let linkChecks = 0;
  let externalLinks = 0;

  const targetEntry = async (path) => {
    if (cache.has(path)) return cache.get(path);
    if (targetDocs >= MAX_TARGET_DOCS) {
      problems.bound.push(finding(path, 1, "too many link-target documents to inspect"));
      return { kind: "bound" };
    }
    targetDocs += 1;
    return load(path, "a link-target Markdown file");
  };

  for (const { path, entry } of changedDocs.sort((a, b) => compareBytewise(a.path, b.path))) {
    const doc = entry.doc;
    headingCount += doc.structure.headings.length;
    for (const f of doc.structure.fences) if (!f.closed) fenceFindings.push(finding(path, f.line, `fenced code block opened here is never closed (marker ${f.marker.repeat(Math.min(f.length, 8))})`));
    for (const t of doc.structure.tables) {
      for (const p of t.problems) {
        const what = p.kind === "CARDINALITY" ? `table row has ${p.actual} cell(s), expected ${p.expected} (a paragraph directly after a table also becomes a row)` : p.kind === "DELIMITER" ? `table delimiter row has ${p.actual} cell(s), expected ${p.expected}` : "table delimiter row cells are not alignment markers";
        tableFindings.push(finding(path, p.line, what));
      }
    }
    const labels = new Map(doc.structure.definitions.map((d) => [d.label, d.destination]));
    const targets = [
      ...doc.structure.links.map((l) => ({ line: l.line, kind: l.kind, dest: l.kind === "reference" ? (labels.has(String(l.label).trim().replace(/\s+/g, " ").toLowerCase()) ? labels.get(String(l.label).trim().replace(/\s+/g, " ").toLowerCase()) : null) : l.destination, label: l.label })),
      ...doc.structure.definitions.map((d) => ({ line: d.line, kind: "definition", dest: d.destination, label: d.label })),
    ];
    for (const t of targets) {
      if (t.dest === null) {
        linkChecks += 1;
        linkFindings.push({ ...finding(path, t.line, "reference link uses an undefined label", REASON.LINK_TARGET_MISSING) });
        continue;
      }
      const c = classifyDestination(path, t.dest);
      if (c.external) {
        externalLinks += 1; // structural only: never requested, never counted as verified
        continue;
      }
      linkChecks += 1;
      if (c.error) {
        linkFindings.push(finding(path, t.line, c.message, c.error));
        continue;
      }
      let targetDoc = null;
      if (c.kind === "anchor") targetDoc = entry;
      else if (c.root) {
        // The repository root always exists and is a directory: nothing to stat or to anchor.
      } else {
        const st = await reader.stat(c.target);
        if (st.kind === "error") {
          problems.unreadable.push(finding(path, t.line, "a link target could not be inspected"));
          continue;
        }
        if (st.kind === "absent") {
          linkFindings.push(finding(path, t.line, `link target does not exist at the head: ${c.target}`, REASON.LINK_TARGET_MISSING));
          continue;
        }
        if (st.kind === "symlink" || st.kind === "submodule") {
          linkFindings.push(finding(path, t.line, `link target is a ${st.kind} (never followed): ${c.target}`, REASON.LINK_TARGET_MISSING));
          continue;
        }
        if (c.expectDir && st.kind !== "dir") {
          linkFindings.push(finding(path, t.line, `link target with a trailing slash is not a directory: ${c.target}`, REASON.LINK_TARGET_MISSING));
          continue;
        }
        if (c.fragment !== "" && st.kind === "file" && c.target.endsWith(".md")) targetDoc = await targetEntry(c.target);
      }
      if (c.fragment !== "" && targetDoc !== null) {
        if (targetDoc.kind === "doc") {
          if (!targetDoc.anchors.has(c.fragment)) anchorFindings.push(finding(path, t.line, `anchor #${c.fragment.slice(0, 120)} does not exist in ${c.kind === "anchor" ? "this document" : c.target}`, REASON.ANCHOR_DANGLING));
        } else if (targetDoc.kind !== "bound" && targetDoc.kind !== "encoding" && targetDoc.kind !== "unreadable") {
          anchorFindings.push(finding(path, t.line, `anchor target ${c.target} is not a readable regular file`, REASON.ANCHOR_DANGLING));
        }
      }
    }
  }

  // ---- ID families: definitions come from the configured source documents; references
  // and malformed IDs come from the CHANGED documents.
  const familyResults = new Map();
  let listing = null;
  if (families.length > 0) {
    listing = await reader.list();
    for (const family of markdown.idFamilies) {
      const compiled = compileFamily(family);
      const sourcePatterns = family.definitionSources.map((p) => parsePathPattern(p).pattern);
      const result = { definitions: [], references: [], malformed: [], incomplete: null };
      if (!listing.ok) result.incomplete = "the repository file listing could not be established";
      else {
        const sources = listing.paths.filter((p) => p.endsWith(".md") && sourcePatterns.some((sp) => matchPathPattern(sp, p)));
        if (sources.length > MAX_DEFINITION_DOCS) result.incomplete = "too many ID-definition source documents";
        else {
          for (const path of sources) {
            const entry = await load(path, "an ID-definition source");
            if (entry.kind === "doc") {
              const extracted = extractFamily(compiled, entry.doc, path);
              if (extracted.exhausted) result.incomplete = "an ID-definition source exceeded its scan work bound";
              result.definitions.push(...extracted.definitions);
            }
            else if (entry.kind !== "absent") result.incomplete = "an ID-definition source could not be read as Markdown";
          }
        }
      }
      for (const { path, entry } of changedDocs) {
        const found = extractFamily(compiled, entry.doc, path);
        if (found.exhausted) result.incomplete = "a changed document exceeded its ID scan work bound";
        result.references.push(...found.references);
        result.malformed.push(...found.malformed);
      }
      familyResults.set(family.family, result);
    }
  }

  // ---- Emit records.
  const changedSet = new Set(changed.files);
  const summarize = (list) => sample([...list].sort(byLocation).map(render), 20);
  const emitFindings = (checkId, list, reasonFor, passDetail, extra = {}) => {
    if (list.length > 0) {
      const code = reasonFor(list);
      add(checkId, STATUS.FAIL, code, `${list.length} finding(s); see observed.findings`, { count: list.length, findings: summarize(list), ...extra });
    } else add(checkId, STATUS.PASS, REASON.OK, passDetail, extra);
  };

  const fileProblems = [...problems.encoding, ...problems.bound, ...problems.unreadable];
  const filesObserved = { selected: selected.length, parsed: changedDocs.length, notParsed: skipped };
  if (problems.encoding.length > 0) add("1B.MARKDOWN.FILES", STATUS.FAIL, REASON.MARKDOWN_ENCODING_INVALID, "a Markdown file is not valid UTF-8", { ...filesObserved, findings: summarize(problems.encoding) });
  else if (problems.bound.length > 0) add("1B.MARKDOWN.FILES", STATUS.INCOMPLETE, REASON.MARKDOWN_BOUND_EXCEEDED, "a Markdown bound was exceeded: the result is incomplete", { ...filesObserved, findings: summarize(problems.bound) });
  else if (problems.unreadable.length > 0) add("1B.MARKDOWN.FILES", STATUS.INCOMPLETE, REASON.MARKDOWN_UNREADABLE, "a Markdown file could not be read", { ...filesObserved, findings: summarize(problems.unreadable) });
  else add("1B.MARKDOWN.FILES", STATUS.PASS, REASON.OK, "changed Markdown files selected and parsed", filesObserved);

  const incompleteNote = fileProblems.length > 0;
  const withIncomplete = (checkId, list, reasonFor, passDetail, extra) => {
    if (list.length === 0 && incompleteNote) add(checkId, STATUS.INCOMPLETE, problems.bound.length > 0 ? REASON.MARKDOWN_BOUND_EXCEEDED : REASON.MARKDOWN_UNREADABLE, "the check ran on an incomplete set of files", extra);
    else emitFindings(checkId, list, reasonFor, passDetail, extra);
  };
  withIncomplete("1B.MARKDOWN.FENCES", fenceFindings, () => REASON.MARKDOWN_STRUCTURE_INVALID, "every fenced code block is closed", { files: changedDocs.length });
  withIncomplete("1B.MARKDOWN.TABLES", tableFindings, () => REASON.MARKDOWN_STRUCTURE_INVALID, "every table is structurally consistent", { files: changedDocs.length });
  add("1B.MARKDOWN.HEADINGS", STATUS.PASS, REASON.OK, "headings extracted and anchors generated", { files: changedDocs.length, headings: headingCount });
  withIncomplete("1B.MARKDOWN.ANCHORS", anchorFindings, () => REASON.ANCHOR_DANGLING, "every checked heading anchor exists", { files: changedDocs.length });
  withIncomplete("1B.MARKDOWN.LINKS", linkFindings, (list) => (list.some((f) => f.code === REASON.LINK_ESCAPES_ROOT) ? REASON.LINK_ESCAPES_ROOT : REASON.LINK_TARGET_MISSING), "every repository-local link target exists inside the repository root", { files: changedDocs.length, linksChecked: linkChecks, externalNotChecked: externalLinks });

  for (const family of markdown.idFamilies) {
    const r = familyResults.get(family.family);
    const checkId = `1B.REFERENCES.${family.family}`;
    if (r.incomplete) {
      add(checkId, STATUS.INCOMPLETE, REASON.MARKDOWN_UNREADABLE, r.incomplete, {});
      continue;
    }
    const defined = new Map();
    for (const d of r.definitions) {
      if (!defined.has(d.id)) defined.set(d.id, []);
      defined.get(d.id).push(d);
    }
    const list = [];
    for (const ref of r.references) if (!defined.has(ref.id)) list.push({ ...finding(ref.path, ref.line, `${ref.id} is referenced but never defined`), code: REASON.REFERENCE_DANGLING });
    for (const [id, defs] of defined) {
      if (defs.length > 1 && defs.some((d) => changedSet.has(d.path))) {
        const first = defs.slice().sort((a, b) => compareBytewise(a.path, b.path) || a.line - b.line)[0];
        list.push({ ...finding(first.path, first.line, `${id} is defined ${defs.length} times (${sample(defs.map((d) => `${d.path}:${d.line}`), 5).join(", ")})`), code: REASON.REFERENCE_DUPLICATE });
      }
    }
    for (const m of r.malformed) list.push({ ...finding(m.path, m.line, `${m.token} starts like the ${family.family} family but is not a valid identifier`), code: REASON.REFERENCE_MALFORMED });
    const observed = { definitions: r.definitions.length, references: r.references.length };
    if (list.length > 0) {
      const order = [REASON.REFERENCE_MALFORMED, REASON.REFERENCE_DUPLICATE, REASON.REFERENCE_DANGLING];
      const code = order.find((c) => list.some((f) => f.code === c));
      add(checkId, STATUS.FAIL, code, `${list.length} finding(s); see observed.findings`, { ...observed, count: list.length, findings: summarize(list) });
    } else if (incompleteNote) add(checkId, STATUS.INCOMPLETE, problems.bound.length > 0 ? REASON.MARKDOWN_BOUND_EXCEEDED : REASON.MARKDOWN_UNREADABLE, "the check ran on an incomplete set of files", observed);
    else add(checkId, STATUS.PASS, REASON.OK, "every reference resolves to exactly one well-formed definition", observed);
  }
  return done();
}

module.exports = { checkReferences };
