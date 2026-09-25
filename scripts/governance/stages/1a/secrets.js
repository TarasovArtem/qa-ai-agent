/**
 * GOV-AUTO-1 Wave 1 / 1A -- secret scanning and suppression application
 * (design sections 6, 14, 16, 24). 1A is the single owner of secret scanning.
 *
 * Detection reuses the certified Wave 0 redaction primitive as the single
 * definition of "secret-shaped": a line is a hit exactly where redactString()
 * masks something, and the rule ID comes from the mask it inserted. The base
 * policy may ADD declarative prefixed-token rules (bounded, never a regular
 * expression supplied by the repository); it can never remove or weaken a
 * built-in rule, and a head can never disable a rule for its own review.
 *
 * Unscanned is never PASS: a changed file that cannot be interpreted as UTF-8 text (any NUL
 * byte, which covers binary files and UTF-16/32, or a UTF-16 byte-order mark) is scanned
 * byte-for-byte as Latin-1 so a plain-ASCII token inside it still FAILs, but the file can
 * never be declared clean: it makes the scan INCOMPLETE (SECRET_CONTENT_UNSCANNABLE).
 *
 * Output secrecy: a finding carries rule ID, path, line and the mask
 * `[REDACTED:<RULE>]` ONLY. The matched text exists solely inside this module to
 * compute a change-detection fingerprint for suppression matching; it is never
 * put in a record, an error, a log line or a return value. The fingerprint of an
 * UNSUPPRESSED hit is never emitted (an unkeyed digest of a low-entropy secret is
 * not a secrecy control).
 *
 * Suppression trust (design 16): only base-anchored suppressions yield PASS; a
 * head-added suppression is a proposal and leaves the hit HUMAN_REVIEW_REQUIRED.
 * A suppression that matches nothing, several hits, a changed value or that has
 * expired is FAIL (never silently ignored); PRIVATE_KEY_BLOCK is never
 * suppressible.
 */

"use strict";

const crypto = require("node:crypto");
const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { redactString, TOKEN_RULES } = require("../../safety/redaction");
const { createRecordFactory, isValidSubject, sameSubject, sample } = require("../common");
const { resolveGitAdapter } = require("./git-adapter");
const { resolveReader } = require("../head-reader");
const { BUILTIN_SECRET_RULE_IDS, parseSuppression, validateBasePolicy, resolveFrameworkMetadata } = require("./policy");

/** Metadata deciding schema/capability support: the caller-supplied target-tip metadata when valid. */
const metadataOf = (input) => {
  const r = resolveFrameworkMetadata(input.targetFrameworkMetadata);
  return r.ok ? r.metadata : { supportedCapabilities: [], supportedSchemaVersions: { minSupported: 1, maxSupported: 0 } };
};

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_LINE_LENGTH = 32768;
const MAX_FINDINGS = 200;
const MAX_REPORTED = 50;
const MARKER = /\[REDACTED:([A-Z_]+)\]/g;
const CHARSET_CLASS = { ALNUM: "A-Za-z0-9", HEX: "0-9a-fA-F", BASE64URL: "A-Za-z0-9_-" };
const HEURISTIC_RULES = new Set(["SENSITIVE_VALUE"]);

/** True when a file cannot be reliably read as UTF-8 text by this scanner. */
function isUnscannable(bytes) {
  if (bytes.includes(0)) return true; // binary, UTF-16 without BOM, UTF-32
  return bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)); // UTF-16 BOM
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const markersOf = (text) => [...text.matchAll(MARKER)].map((m) => m[1]);

const PLACEHOLDER = "\uE000"; // a private-use character standing in for an already-detected token
const TOKEN_MATCHERS = TOKEN_RULES.map((rule) => ({ ruleId: rule.id, source: rule.source, flags: rule.flags }));

/**
 * Token-shaped hits, detected INDEPENDENTLY per built-in rule against the original
 * line, so a secret keeps its specific rule (and its FAIL severity) whatever text
 * precedes it (for example "token: <secret>" must not be downgraded to the heuristic
 * rule). Overlapping matches keep the earliest, longest one.
 */
function tokenHits(line) {
  const found = [];
  for (const matcher of TOKEN_MATCHERS) {
    for (const match of line.matchAll(new RegExp(matcher.source, matcher.flags))) {
      if (match[0].length > 0) found.push({ ruleId: matcher.ruleId, start: match.index, end: match.index + match[0].length, text: match[0] });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end || (a.ruleId < b.ruleId ? -1 : 1));
  const kept = [];
  let coveredUntil = -1;
  for (const hit of found) {
    if (hit.start >= coveredUntil) {
      kept.push(hit);
      coveredUntil = hit.end;
    }
  }
  return kept;
}

/**
 * Heuristic sensitive-value hits: the Wave 0 redactor is run on the line with the
 * token hits already replaced by a placeholder, and only SENSITIVE_VALUE masks that
 * cover something other than placeholders are hits. The masked span is recovered by
 * aligning the literal segments of the redacted line with the source; if that is
 * ambiguous the whole line is the matched text (deterministic and conservative).
 */
function heuristicHits(line, tokens) {
  let masked = "";
  let cursor = 0;
  for (const t of tokens) {
    masked += line.slice(cursor, t.start) + PLACEHOLDER;
    cursor = t.end;
  }
  masked += line.slice(cursor);
  if (masked.length < 8) return [];
  const redacted = redactString(masked, { maxLength: 65536 });
  if (redacted === masked) return [];
  const parts = redacted.split(/(\[REDACTED:[A-Z_]+\])/);
  const hasSourceMarker = masked.includes("[REDACTED:");
  const hits = [];
  let aligned = !hasSourceMarker;
  let pos = 0;
  if (aligned) {
    if (!masked.startsWith(parts[0])) aligned = false;
    else pos = parts[0].length;
  }
  for (let i = 1; aligned && i < parts.length; i += 2) {
    const literal = parts[i + 1];
    const end = i + 2 >= parts.length ? masked.length - literal.length : literal === "" ? -1 : masked.indexOf(literal, pos + 1);
    if (end < pos + 1 || !masked.startsWith(literal, end)) aligned = false;
    else {
      hits.push({ ruleId: parts[i].slice(10, -1), text: masked.slice(pos, end) });
      pos = end + literal.length;
    }
  }
  if (aligned && pos !== masked.length) aligned = false;
  const spans = aligned ? hits : markersOf(redacted).map((ruleId) => ({ ruleId, text: masked }));
  return spans.filter((h) => h.ruleId === "SENSITIVE_VALUE" && h.text.split(PLACEHOLDER).join("").trim() !== "");
}

/** All hits on one line as { ruleId, text } (text is INTERNAL and never emitted). */
function detectLineHits(line, customRules) {
  const hits = [];
  if (line.length >= 8) {
    const tokens = tokenHits(line);
    for (const t of tokens) hits.push({ ruleId: t.ruleId, text: t.text });
    hits.push(...heuristicHits(line, tokens));
  }
  for (const rule of customRules) {
    rule.regex.lastIndex = 0;
    for (const match of line.matchAll(rule.regex)) hits.push({ ruleId: rule.ruleId, text: match[0] });
  }
  return hits;
}

function compileCustomRules(rules) {
  return rules.map((r) => ({ ruleId: r.ruleId, regex: new RegExp(`${escapeRegExp(r.prefix)}[${CHARSET_CLASS[r.charset]}]{${r.minLength},${r.maxLength}}`, "g") }));
}

const fingerprintOf = (ruleId, path, text) => crypto.createHash("sha256").update(`${ruleId}\0${path}\0${text}`).digest("hex");

function todayOf(now) {
  if (now instanceof Date && Number.isFinite(now.getTime())) return now.toISOString().slice(0, 10);
  if (typeof now === "string" && /^\d{4}-\d{2}-\d{2}/.test(now)) return now.slice(0, 10);
  return null;
}
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Evaluate one suppression against the hits; returns { problem|null, hit|null }. */
function evaluateSuppression(s, hits, today, maxExpiryDays) {
  if (today === null) return { problem: "no clock was supplied", hit: null };
  if (s.expires < today) return { problem: "expired", hit: null };
  if (s.expires > addDays(today, maxExpiryDays)) return { problem: "expiry exceeds the policy maximum", hit: null };
  const candidates = hits.filter((h) => h.ruleId === s.ruleId && h.path === s.path && (s.lineStart === null || (h.line >= s.lineStart && h.line <= s.lineEnd)));
  if (candidates.length === 0) return { problem: "matches no hit", hit: null };
  if (candidates.length > 1) return { problem: "matches more than one hit", hit: null };
  const hit = candidates[0];
  if (fingerprintOf(hit.ruleId, hit.path, hit.text) !== s.fingerprint) return { problem: "fingerprint no longer matches", hit };
  return { problem: null, hit };
}

/**
 * scanSecrets({ subject, changedFiles, policy, git | reader | { repositoryRoot, gitExecutable },
 *               headSuppressions?, now? })
 */
async function scanSecrets(input) {
  const bad = (detail) => deepFreeze({ subject: null, records: [], outcome: { status: STATUS.CONFIGURATION_ERROR, reasonCode: REASON.SCAN_INPUT_INVALID, detail } });
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return bad("a valid subject is required");
  const subject = input.subject;
  const changed = input.changedFiles;
  if (!isPlainObject(changed) || !Array.isArray(changed.files) || !sameSubject(changed.subject, subject)) return bad("changedFiles must be the getChangedFiles() result for the same subject");
  const out = createRecordFactory(subject, "1A");
  const { add, notApplicable } = out;
  const done = () => deepFreeze({ subject, records: out.records, outcome: null });

  if (changed.complete !== true) {
    add("1A.SECRETS.SCAN", STATUS.INCOMPLETE, REASON.DIFF_COMPUTATION_FAILED, "secret scanning cannot be trusted: the changed-file set is not complete", {});
    return done();
  }
  // Effective policy (validated) or the built-in minimum (no custom rule, no honored suppression).
  let customRules = [];
  let baseSuppressions = [];
  let maxExpiryDays = 1;
  const policy = input.policy;
  if (isPlainObject(policy) && !(policy.scope && Array.isArray(policy.scope.allowedPathDomains) && policy.scope.allowedPathDomains.length === 0)) {
    const validated = validateBasePolicy(policy, metadataOf(input));
    if (!validated.ok) {
      add("1A.SECRETS.SCAN", STATUS.INCOMPLETE, REASON.POLICY_INVALID, "the effective policy is not valid: secret rules cannot be established", {});
      return done();
    }
    customRules = compileCustomRules(validated.policy.secretRules);
    baseSuppressions = validated.policy.suppressions;
    maxExpiryDays = validated.policy.suppressionPolicy.maxExpiryDays;
  } else if (!isPlainObject(policy)) {
    add("1A.SECRETS.SCAN", STATUS.INCOMPLETE, REASON.POLICY_INVALID, "no effective policy was supplied", {});
    return done();
  }

  const adapter = resolveGitAdapter(input);
  const readerResult = resolveReader(input, adapter.ok ? adapter.git : null, subject.head);
  if (!readerResult.ok) return bad("no usable content reader was supplied");
  const reader = readerResult.reader;

  const files = changed.files;
  if (files.length > MAX_FILES) {
    add("1A.SECRETS.SCAN", STATUS.INCOMPLETE, REASON.SCAN_BOUND_EXCEEDED, "too many changed files to scan within the supported bound", { count: files.length });
    return done();
  }

  const hits = [];
  let scanned = 0;
  let unscannable = 0;
  const unscannablePaths = [];
  let deletedOrLink = 0;
  let totalBytes = 0;
  let bound = null;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (const path of files) {
    const got = await reader.read(path, MAX_FILE_BYTES);
    if (got.kind === "absent" || got.kind === "symlink" || got.kind === "tree" || got.kind === "submodule") {
      deletedOrLink += 1;
      continue;
    }
    if (got.kind === "too-large") {
      bound = "a file exceeds the per-file scan bound";
      continue;
    }
    if (got.kind !== "blob") {
      bound = "a changed file could not be read";
      continue;
    }
    totalBytes += got.bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      bound = "the total scanned bytes exceed the supported bound";
      break;
    }
    let content;
    if (isUnscannable(got.bytes)) {
      unscannable += 1;
      unscannablePaths.push(path);
      content = Buffer.from(got.bytes.buffer, got.bytes.byteOffset, got.bytes.length).toString("latin1");
    } else {
      scanned += 1;
      content = decoder.decode(got.bytes);
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i];
      if (line.length > MAX_LINE_LENGTH) {
        bound = "a line exceeds the per-line scan bound";
        continue;
      }
      for (const hit of detectLineHits(line, customRules)) {
        hits.push({ ruleId: hit.ruleId, path, line: i + 1, text: hit.text });
        if (hits.length > MAX_FINDINGS) bound = "too many findings";
      }
    }
    if (hits.length > MAX_FINDINGS) break;
  }

  // Suppressions: base-anchored (may yield PASS) and head proposals (never PASS).
  const ruleIds = new Set([...BUILTIN_SECRET_RULE_IDS, ...customRules.map((r) => r.ruleId)]);
  const today = todayOf(input.now);
  const suppressionRows = [];
  const suppressedHits = new Set();
  const proposedHits = new Set();
  let baseInvalid = 0;
  let proposals = 0;
  const changedSet = new Set(files);
  for (const s of baseSuppressions) {
    // A base suppression for a file this change did not touch is not in scope: it is not
    // evaluated (and so never reported stale); a suppression whose file changed is.
    if (!changedSet.has(s.path)) {
      suppressionRows.push({ ruleId: s.ruleId, path: s.path, anchored: true, valid: true, problem: null, inScope: false });
      continue;
    }
    const r = evaluateSuppression(s, hits, today, maxExpiryDays);
    if (r.problem === null) suppressedHits.add(r.hit);
    else baseInvalid += 1;
    suppressionRows.push({ ruleId: s.ruleId, path: s.path, anchored: true, valid: r.problem === null, problem: r.problem });
  }
  const headList = Array.isArray(input.headSuppressions) ? input.headSuppressions : [];
  for (const raw of headList.slice(0, 64)) {
    proposals += 1;
    const parsed = parseSuppression(raw, ruleIds);
    if (!parsed.ok) {
      suppressionRows.push({ ruleId: isPlainObject(raw) && typeof raw.ruleId === "string" ? raw.ruleId.slice(0, 41) : null, path: isPlainObject(raw) && typeof raw.path === "string" ? raw.path.slice(0, 300) : null, anchored: false, valid: false, problem: parsed.problem });
      continue;
    }
    const s = parsed.suppression;
    for (const h of hits) if (h.ruleId === s.ruleId && h.path === s.path && (s.lineStart === null || (h.line >= s.lineStart && h.line <= s.lineEnd))) proposedHits.add(h);
    const r = evaluateSuppression(s, hits, today, maxExpiryDays);
    suppressionRows.push({ ruleId: s.ruleId, path: s.path, anchored: false, valid: r.problem === null, problem: r.problem });
  }

  // Disposition per hit.
  const findings = [];
  let fail = 0;
  let review = 0;
  for (const hit of hits.slice(0, MAX_FINDINGS)) {
    let disposition;
    if (suppressedHits.has(hit)) disposition = "SUPPRESSED";
    else if (proposedHits.has(hit)) {
      disposition = "SUPPRESSION_PROPOSED";
      review += 1;
    } else if (HEURISTIC_RULES.has(hit.ruleId)) {
      disposition = "HEURISTIC";
      review += 1;
    } else {
      disposition = "SECRET";
      fail += 1;
    }
    findings.push({ ruleId: hit.ruleId, path: hit.path, line: hit.line, masked: `[REDACTED:${hit.ruleId}]`, disposition });
  }
  const suppressedCount = findings.filter((f) => f.disposition === "SUPPRESSED").length;

  const observed = { filesScanned: scanned, unscannable, unscannablePaths: sample(unscannablePaths), notFileContent: deletedOrLink, findingsTotal: findings.length, suppressed: suppressedCount, findings: findings.filter((f) => f.disposition !== "SUPPRESSED").slice(0, MAX_REPORTED) };
  if (fail > 0) add("1A.SECRETS.SCAN", STATUS.FAIL, REASON.SECRET_FOUND, "secret-shaped content was found (values are never printed)", observed);
  else if (unscannable > 0) add("1A.SECRETS.SCAN", STATUS.INCOMPLETE, REASON.SECRET_CONTENT_UNSCANNABLE, "a changed file cannot be scanned as text (binary or UTF-16/32 content): it is never reported clean", observed);
  else if (bound !== null) add("1A.SECRETS.SCAN", STATUS.INCOMPLETE, REASON.SCAN_BOUND_EXCEEDED, bound, observed);
  else if (proposals > 0 && proposedHits.size > 0) add("1A.SECRETS.SCAN", STATUS.HUMAN_REVIEW_REQUIRED, REASON.SUPPRESSION_PROPOSED, "a head-proposed suppression covers a hit: it is a proposal and never PASS", observed);
  else if (review > 0) add("1A.SECRETS.SCAN", STATUS.HUMAN_REVIEW_REQUIRED, REASON.SECRET_HEURISTIC_HIT, "a heuristic sensitive-value hit needs human review (values are never printed)", observed);
  else add("1A.SECRETS.SCAN", STATUS.PASS, REASON.OK, suppressedCount > 0 ? "no unsuppressed secret-shaped content (base-anchored suppressions applied)" : "no secret-shaped content found", observed);

  const rows = suppressionRows.slice(0, MAX_REPORTED);
  if (suppressionRows.length === 0) notApplicable("1A.SECRETS.SUPPRESSIONS", "no suppression is configured or proposed");
  else if (baseInvalid > 0) add("1A.SECRETS.SUPPRESSIONS", STATUS.FAIL, REASON.SUPPRESSION_INVALID, "a base-anchored suppression is stale, expired or matches an unexpected number of hits", { total: suppressionRows.length, rows: sample(rows.map((r) => `${r.anchored ? "base" : "head"}:${r.ruleId}:${r.path}:${r.valid ? "valid" : r.problem}`)) });
  else if (proposals > 0) add("1A.SECRETS.SUPPRESSIONS", STATUS.HUMAN_REVIEW_REQUIRED, REASON.SUPPRESSION_PROPOSED, "the head proposes suppression(s): proposals are never honored as PASS", { total: suppressionRows.length, rows: sample(rows.map((r) => `${r.anchored ? "base" : "head"}:${r.ruleId}:${r.path}:${r.valid ? "valid" : r.problem}`)) });
  else add("1A.SECRETS.SUPPRESSIONS", STATUS.PASS, REASON.OK, "every in-scope base-anchored suppression matches exactly one hit with an unchanged value", { total: suppressionRows.length });
  return done();
}

module.exports = { scanSecrets, fingerprintOf };
