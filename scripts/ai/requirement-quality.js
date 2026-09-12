"use strict";

/**
 * Requirement Quality / Testability Analysis (Roadmap RTI-3) - the first
 * derived-analysis layer on top of RequirementArtifact[] (Roadmap RTI-1).
 *
 * analyzeRequirementQuality(artifact) / analyzeRequirementsQuality(artifacts)
 * answer exactly one question: "is this requirement sufficiently specified
 * to be trustworthy input for test design?" - never "what should the
 * missing detail be?" and never "generate tests for this requirement."
 *
 * THE CENTRAL INVARIANT: this module may identify what is missing or
 * ambiguous, but it must NEVER fabricate the missing requirement. Given
 * "The search results should load quickly.", this module may report that a
 * measurable threshold is absent - it must never invent "within 2 seconds."
 * There is no field anywhere in this module's output for a corrected,
 * improved, or rewritten requirement, an invented actor, an invented error
 * condition, or a generated test case/scenario - all of those remain
 * strictly out of scope (see RTI-4+).
 *
 * DETERMINISTIC, ZERO AI: no LLM/AI calls, no network, no filesystem, no
 * environment variables, no randomness, no clock dependency. The same
 * RequirementArtifact always produces the same RequirementQualityResult.
 * This is a deliberate first step - semantic/AI-assisted analysis, if ever
 * justified, belongs to a SEPARATE future analyzer, not a retrofit onto
 * this one (matching every other provider/adapter boundary already
 * established in this repository).
 *
 * SOURCE-INDEPENDENT: this module knows only the RequirementArtifact shape
 * (scripts/ai/requirement-artifact.js) - `artifact.type` (domain semantics,
 * e.g. selecting a check) may influence analysis; `artifact.source.type`
 * (provenance, e.g. "file") never does and is never even read here.
 *
 * STRUCTURAL VS SEMANTIC VALIDITY: RTI-1's assertValidRequirementArtifact()
 * answers "is this RequirementArtifact structurally valid JSON-like data?"
 * RTI-3 answers a completely different question - "is the WORDING inside a
 * structurally valid artifact sufficiently explicit and measurable for
 * testing?" A structurally perfect artifact can still be AMBIGUOUS or
 * UNTESTABLE here; this module never conflates the two.
 *
 * INPUT SAFETY / GETTER SAFETY: assertValidRequirementArtifact(artifact,
 * "analyzeRequirementQuality") is called FIRST, before this module reads a
 * single property of `artifact`. Every field this module subsequently
 * reads (id, type, content, acceptanceCriteria[].text/.id) is EXACTLY one
 * of the fields RTI-1's own validator already certified via
 * getOwnEnumerableDataProperty() (own, enumerable, data-only - never an
 * inherited, non-enumerable, or accessor-backed value, and an accessor's
 * getter is never invoked). This module deliberately reuses that guarantee
 * rather than re-implementing RTI-1's own hardening primitives - it never
 * reads a field RTI-1 has not already certified this way. Execution is
 * fully synchronous with no intervening async boundary between validation
 * and these reads, so no concurrent mutation of `artifact` can occur
 * between the two (single-threaded JS, no I/O in between).
 *
 * RESULT CONTRACT (data-only, JSON-serializable, deliberately smaller than
 * the roadmap's own candidate shape - no `testable` boolean, which would
 * only restate `status` ambiguously; no `missingInformation[]`, which would
 * duplicate `issues[]`; no `evidence[]`/`analyzedFields[]`, which have no
 * concrete consumer yet):
 *
 *   RequirementQualityResult = {
 *     artifactId: string,               // === artifact.id
 *     status: RequirementQualityStatus, // see STATUS MODEL below
 *     issues: RequirementQualityIssue[] // ordered, deterministic, may be []
 *   }
 *
 *   RequirementQualityIssue = {
 *     code: string,                 // stable machine-readable code
 *     severity: "warning" | "error",// "error" blocks READY; "warning" never does
 *     message: string,              // bounded, human-readable, no raw content dump
 *     field: "content" | "acceptanceCriteria",
 *     criterionId?: string,         // present only for an id-bearing acceptanceCriteria entry
 *     criterionIndex?: number,      // positional fallback only when criterionId is absent - NEVER a generated/persisted id
 *   }
 *
 * STATUS MODEL (a single primary status + multiple issue codes - never one
 * enum value per defect combination, since a requirement can simultaneously
 * be ambiguous AND missing information):
 *
 *   READY               - zero "error"-severity issues. May still carry
 *                          "warning" issues (usable with caution).
 *   PARTIALLY_TESTABLE   - content itself is clean; only some (not all)
 *                          acceptanceCriteria entries carry a blocking issue.
 *   AMBIGUOUS            - content itself carries an unresolved blocking
 *                          issue (a quantifiable-but-unstated quality claim,
 *                          e.g. "fast"/"secure" with no threshold anywhere
 *                          in the artifact).
 *   MISSING_INFORMATION  - an explicit placeholder marker (TBD/TODO/TBC/???)
 *                          is present anywhere - the author literally left a
 *                          gap, distinct in kind from merely vague wording.
 *   UNTESTABLE           - content itself makes an inherently subjective/
 *                          emotional claim (e.g. "delightful") with NO
 *                          acceptanceCriteria at all and no measurable
 *                          signal anywhere - there is no other surface in
 *                          the artifact a test could be hung on.
 *
 *   Precedence when multiple conditions are simultaneously true:
 *     UNTESTABLE > MISSING_INFORMATION > AMBIGUOUS > PARTIALLY_TESTABLE > READY.
 *
 *   CONTRADICTORY IS DELIBERATELY NOT PART OF THIS ENUM. Detecting that two
 *   natural-language statements are mutually exclusive requires semantic
 *   reasoning this deterministic module does not have and must not fake -
 *   there is no reliable, evidence-backed pattern for it today. Rather than
 *   include an enum value this analyzer can never actually produce, it is
 *   left out entirely; a future analyzer may reintroduce it once a real,
 *   evidence-based detection rule exists. This is a documented, honest
 *   limitation, not an oversight.
 *
 * ISSUE VOCABULARY (small, reviewed, four codes - not "dozens without
 * demonstrated need"):
 *
 *   PLACEHOLDER_TEXT (error)             - TBD/TODO/TBC/??? marker present.
 *   MISSING_MEASURABLE_CRITERION (error) - a QUANTIFIABLE quality term
 *     appears with no measurable signal FOR THE SAME DIMENSION anywhere in
 *     the artifact. DIMENSION-SCOPED, not generically artifact-wide (RTI-3
 *     corrective - see MEASURABILITY MODEL below for why and how): a
 *     performance term (fast/quick/quickly/slow/slowly/responsive/
 *     performant/efficient) is only resolved by a duration/latency signal;
 *     an availability term (available/reliable/scalable) is only resolved
 *     by an uptime/availability-percentage or failure-rate signal. An
 *     UNRELATED number elsewhere (a retry count, an HTTP status code, a
 *     bare percentage with no uptime/availability context) never resolves
 *     either - see ACCEPTANCE-CRITERIA INTERACTION below.
 *   UNVERIFIABLE_SUBJECTIVE_CLAIM (error) - an inherently SUBJECTIVE/
 *     emotional term (intuitive/user-friendly/delightful/pleasant/elegant/
 *     satisfying/appealing/easy to use) appears - "secure" is deliberately
 *     included here too, not in the quantifiable-performance category: no
 *     generic number makes "secure" objectively verifiable the way a
 *     duration number makes "fast" verifiable (a security claim would need
 *     an explicit control/standard reference, which this module does not
 *     attempt to recognize). Unlike MISSING_MEASURABLE_CRITERION, this is
 *     never suppressed merely because a measurable signal exists elsewhere
 *     in the artifact, related dimension or not.
 *   VAGUE_QUALIFIER (warning) - a weaker, context-dependent qualifier
 *     (appropriate/reasonable/sufficient/as needed/as appropriate) appears.
 *     Lower confidence than MISSING_MEASURABLE_CRITERION (these words are
 *     frequently fine in context), so "warning" rather than "error" - it is
 *     reported but never blocks READY or changes status.
 *
 * MEASURABILITY MODEL (dimension-scoped, RTI-3 corrective): the original
 * design used ONE generic "does any measurable-looking signal exist
 * anywhere in the artifact" check to resolve every quantifiable-vague term.
 * Independent review found this topic-blind: an unrelated acceptance
 * criterion containing ANY number ("retry up to 5 times", "Return HTTP
 * 200") silently suppressed an unrelated vague PERFORMANCE claim ("should
 * load quickly"), producing READY for a materially underspecified
 * requirement. The corrective replaces the single generic signal check
 * with two narrow, dimension-scoped signal patterns - DURATION_SIGNAL_PATTERN
 * (seconds/ms/minutes/hours, optionally with a comparison/bound phrase) for
 * PERFORMANCE_TERM_PATTERN, and AVAILABILITY_SIGNAL_PATTERN (a percentage
 * tied to "uptime"/"availability" wording, or a "N failures/errors per M"
 * ratio) for AVAILABILITY_TERM_PATTERN - each vague term category is only
 * ever resolved by its own category's signal, never by an unrelated one. A
 * bare percentage with no uptime/availability context ("95% of requests
 * succeed") deliberately does NOT resolve either category - it says nothing
 * about response time, and by itself is too generic to safely count as an
 * availability commitment either. This remains deterministic, regex-only,
 * bounded, and AI-free - it correlates *category*, never true semantic
 * meaning; a genuinely on-topic but oddly-worded signal could still be
 * conservatively unresolved, which is the intended, safer failure direction
 * (see FALSE-NEGATIVE POLICY below).
 *
 * ACCEPTANCE-CRITERIA INTERACTION: a precise, measurable acceptanceCriteria
 * entry resolves an otherwise-vague `content` claim about the SAME quality
 * dimension - "Search should be fast." + "95% of searches complete within
 * 2 seconds." produces NO MISSING_MEASURABLE_CRITERION finding at all (the
 * duration signal is artifact-wide within the performance dimension, see
 * above). An unrelated signal from a DIFFERENT dimension never resolves it
 * - "Search should be fast." + "Users may retry login up to 5 times." (no
 * duration signal anywhere) still reports MISSING_MEASURABLE_CRITERION.
 * UNVERIFIABLE_SUBJECTIVE_CLAIM is never resolved by any number, related
 * dimension or not, and is always reported regardless of other evidence.
 *
 * FALSE-NEGATIVE POLICY: when it is not clearly established that a
 * measurable signal resolves a given vague claim, this module does NOT
 * suppress the finding. A false positive (a genuinely fine requirement
 * flagged for human review) is preferred over a false negative (an
 * underspecified requirement silently marked READY) - a quality GATE that
 * a future RTI-4 will trust must fail closed on uncertainty, not fail open.
 *
 * TYPE-AWARE SCOPE (deliberately minimal for the first RTI-3 phase): only
 * `content` and `acceptanceCriteria[].text` are analyzed - `title`,
 * `priority`, `labels`, `metadata`, `contentHash`, and `relationships` are
 * never inspected for quality (see this module's own docstring sections
 * below on why). `artifact.type` is not yet used to select different rule
 * sets - the four rules above apply uniformly to every artifact type. A
 * type-aware rule matrix is a plausible future extension, deferred until a
 * concrete, evidence-based need for it exists (matching this repository's
 * consistent "avoid speculative complexity" convention).
 *
 * SINGLE-ARTIFACT SCOPE ONLY: cross-artifact analysis (duplicate intent,
 * contradiction between two DIFFERENT artifacts) is out of scope for RTI-3
 * - it would require a semantic graph this deterministic module does not
 * have. analyzeRequirementsQuality() is a thin per-item collection wrapper
 * (order-preserving, duplicate-artifactId-rejecting) - it never compares
 * one artifact's content against another's.
 *
 * DATA-ONLY, SHALLOW-FROZEN (RTI-2's own documentation-accuracy lesson
 * applied here from the start, not retrofitted after a review finding): the
 * returned RequirementQualityResult object itself is frozen
 * (Object.freeze()); its `issues` array and the issue objects within it are
 * NOT deep-frozen. No security or correctness invariant depends on deeper
 * immutability, and this module makes no claim beyond what Object.freeze()
 * actually does.
 */

const { assertValidRequirementArtifact } = require("./requirement-artifact");

const MAX_VALIDATION_DETAIL_LENGTH = 1024;
const MAX_REPORTED_ERRORS = 20;

// Deliberately simple alternations with fixed-width numeric quantifiers -
// no nested unbounded repetition, no catastrophic-backtracking shape (see
// this module's own docstring on regex safety).
const PLACEHOLDER_PATTERN = /\b(TBD|TODO|TBC)\b|\?\?\?/i;

// Generic "is there ANY numeric/measurable-looking signal anywhere" check -
// used ONLY for the UNTESTABLE-vs-AMBIGUOUS boundary (deriveStatus() below:
// does a subjective claim with no acceptanceCriteria have literally nothing
// else quantitative in the artifact?). Never used to decide whether a
// MISSING_MEASURABLE_CRITERION finding is suppressed - that decision is
// dimension-scoped (see DURATION_SIGNAL_PATTERN/AVAILABILITY_SIGNAL_PATTERN
// below and this module's own MEASURABILITY MODEL docstring section) to
// close the topic-blind false-negative an independent review found in this
// generic pattern's original, broader use.
const MEASURABLE_SIGNAL_PATTERN =
  /\d+(\.\d+)?\s*(%|percent|ms|milliseconds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|requests?|attempts?|times?)\b|HTTP\s*\d{3}\b|status\s*code\s*\d{3}\b|[<>]=?\s*\d|between\s+\d+\s+and\s+\d+/i;

// Dimension-scoped signal patterns (RTI-3 corrective) - each resolves ONLY
// its own vague-term category, never a different one. Deliberately narrow:
// a bare percentage/count/HTTP-status is never treated as evidence for a
// dimension it says nothing about (see MEASURABILITY MODEL docstring).
const DURATION_SIGNAL_PATTERN =
  /(?:[<>]=?|no\s+more\s+than|at\s+most|within|no\s+later\s+than)?\s*\d+(\.\d+)?\s*(ms|milliseconds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|s)\b/i;
const AVAILABILITY_SIGNAL_PATTERN =
  /\d+(\.\d+)?\s*%\s*(uptime|availab\w*)|\b(uptime|availab\w*)\b[^.]{0,20}?\d+(\.\d+)?\s*%|\d+(\.\d+)?\s*(failures?|errors?)\s*per\s*\d+/i;

const PERFORMANCE_TERM_PATTERN = /\b(fast|quick|quickly|slow|slowly|responsive|performant|efficient)\b/i;
const AVAILABILITY_TERM_PATTERN = /\b(available|reliable|scalable)\b/i;

// "secure" is deliberately NOT in a measurable-quantifiable category (see
// MISSING_MEASURABLE_CRITERION / UNVERIFIABLE_SUBJECTIVE_CLAIM docstring
// section above for why) - no generic number resolves it, so it lives here,
// alongside the other never-suppressed subjective/emotional terms.
const SUBJECTIVE_TERM_PATTERN =
  /\b(intuitive|user-friendly|user\s+friendly|delightful|delight|pleasant|elegant|satisfying|appealing|easy\s+to\s+use|easy-to-use|secure)\b/i;
const WEAK_QUALIFIER_PATTERN = /\b(appropriate|reasonable|sufficient)\b|as\s+needed|as\s+appropriate/i;

function boundedDetail(errors) {
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const omitted = errors.length - shown.length;
  const joined = shown.join("; ") + (omitted > 0 ? `; ${omitted} additional error(s) omitted` : "");
  return joined.length <= MAX_VALIDATION_DETAIL_LENGTH ? joined : `${joined.slice(0, MAX_VALIDATION_DETAIL_LENGTH)}...`;
}

// Builds the ordered list of text surfaces this module analyzes - content
// first (if present), then acceptanceCriteria in artifact order. Every
// field read here was already certified own/enumerable/data-only by
// assertValidRequirementArtifact() (see module docstring's INPUT SAFETY
// section) - the caller of buildAnalysisTargets() is required to have
// already called it.
function buildAnalysisTargets(artifact) {
  const targets = [];
  if (typeof artifact.content === "string") {
    targets.push({ field: "content", text: artifact.content, criterionId: undefined, criterionIndex: undefined });
  }
  if (Array.isArray(artifact.acceptanceCriteria)) {
    artifact.acceptanceCriteria.forEach((criterion, index) => {
      const hasId = typeof criterion.id === "string" && criterion.id.length > 0;
      targets.push({
        field: "acceptanceCriteria",
        text: criterion.text,
        criterionId: hasId ? criterion.id : undefined,
        criterionIndex: hasId ? undefined : index,
      });
    });
  }
  return targets;
}

function hasMeasurableSignalAnywhere(targets) {
  return targets.some((t) => typeof t.text === "string" && MEASURABLE_SIGNAL_PATTERN.test(t.text));
}

function hasDurationSignalAnywhere(targets) {
  return targets.some((t) => typeof t.text === "string" && DURATION_SIGNAL_PATTERN.test(t.text));
}

function hasAvailabilitySignalAnywhere(targets) {
  return targets.some((t) => typeof t.text === "string" && AVAILABILITY_SIGNAL_PATTERN.test(t.text));
}

function issueKey(issue) {
  return `${issue.code}|${issue.field}|${issue.criterionId || ""}|${issue.criterionIndex === undefined ? "" : issue.criterionIndex}`;
}

function pushIssue(issues, seen, issue) {
  const key = issueKey(issue);
  if (seen.has(key)) return;
  seen.add(key);
  issues.push(issue);
}

// Rule order (deterministic, documented): for each target in
// buildAnalysisTargets() order (content first, then acceptanceCriteria in
// array order), placeholder findings before quality-wording findings.
// `signals` carries the two dimension-scoped, artifact-wide suppression
// flags (see MEASURABILITY MODEL docstring) - never a single generic flag,
// which is exactly the topic-blind shape an independent review found unsafe.
function analyzeTarget(target, signals, issues, seen) {
  const { field, text, criterionId, criterionIndex } = target;
  if (typeof text !== "string") return;
  // Only include criterionId/criterionIndex when actually meaningful - an
  // issue object never carries an own `undefined`-valued key for the one
  // that does not apply (matches this module's own "optional means absent,
  // not present-but-undefined" contract).
  const ref = { field };
  if (criterionId !== undefined) ref.criterionId = criterionId;
  if (criterionIndex !== undefined) ref.criterionIndex = criterionIndex;

  if (PLACEHOLDER_PATTERN.test(text)) {
    pushIssue(issues, seen, {
      code: "PLACEHOLDER_TEXT",
      severity: "error",
      message: "Contains an unresolved placeholder marker (e.g. TBD/TODO/TBC) instead of a concrete value.",
      ...ref,
    });
  }

  if (!signals.hasDurationSignal && PERFORMANCE_TERM_PATTERN.test(text)) {
    pushIssue(issues, seen, {
      code: "MISSING_MEASURABLE_CRITERION",
      severity: "error",
      message: "Uses a performance/quality term (e.g. fast/responsive) with no duration/latency threshold anywhere in the requirement.",
      ...ref,
    });
  }

  if (!signals.hasAvailabilitySignal && AVAILABILITY_TERM_PATTERN.test(text)) {
    pushIssue(issues, seen, {
      code: "MISSING_MEASURABLE_CRITERION",
      severity: "error",
      message: "Uses an availability/reliability term with no uptime, availability-percentage, or failure-rate threshold anywhere in the requirement.",
      ...ref,
    });
  }

  if (SUBJECTIVE_TERM_PATTERN.test(text)) {
    pushIssue(issues, seen, {
      code: "UNVERIFIABLE_SUBJECTIVE_CLAIM",
      severity: "error",
      message: "Uses a subjective/emotional term with no objective, verifiable criterion.",
      ...ref,
    });
  }

  if (WEAK_QUALIFIER_PATTERN.test(text)) {
    pushIssue(issues, seen, {
      code: "VAGUE_QUALIFIER",
      severity: "warning",
      message: "Uses a vague qualifier (e.g. appropriate/reasonable/sufficient) that may admit multiple interpretations.",
      ...ref,
    });
  }
}

// Deterministic precedence: UNTESTABLE > MISSING_INFORMATION > AMBIGUOUS >
// PARTIALLY_TESTABLE > READY. Only "error"-severity issues participate -
// "warning"-only artifacts remain READY (see module docstring).
function deriveStatus(artifact, targets, issues) {
  const errorIssues = issues.filter((i) => i.severity === "error");
  if (errorIssues.length === 0) return "READY";

  const hasAcceptanceCriteria = Array.isArray(artifact.acceptanceCriteria) && artifact.acceptanceCriteria.length > 0;
  const measurableAnywhere = hasMeasurableSignalAnywhere(targets);

  const contentHasSubjectiveClaim = errorIssues.some((i) => i.field === "content" && i.code === "UNVERIFIABLE_SUBJECTIVE_CLAIM");
  if (contentHasSubjectiveClaim && !hasAcceptanceCriteria && !measurableAnywhere) {
    return "UNTESTABLE";
  }

  if (errorIssues.some((i) => i.code === "PLACEHOLDER_TEXT")) {
    return "MISSING_INFORMATION";
  }

  const contentHasBlockingIssue = errorIssues.some((i) => i.field === "content");
  if (contentHasBlockingIssue) {
    return "AMBIGUOUS";
  }

  // Remaining error issues are confined to specific acceptanceCriteria
  // entries while content itself (if present) is clean.
  return "PARTIALLY_TESTABLE";
}

function runAnalysis(artifact) {
  const targets = buildAnalysisTargets(artifact);
  const signals = {
    hasDurationSignal: hasDurationSignalAnywhere(targets),
    hasAvailabilitySignal: hasAvailabilitySignalAnywhere(targets),
  };
  const issues = [];
  const seen = new Set();
  for (const target of targets) {
    analyzeTarget(target, signals, issues, seen);
  }
  const status = deriveStatus(artifact, targets, issues);
  return Object.freeze({ artifactId: artifact.id, status, issues });
}

/**
 * Analyzes a single, already-structurally-valid RequirementArtifact for
 * quality/testability. See this module's own docstring for the full
 * contract, status model, and issue vocabulary.
 *
 * @param {object} artifact a RequirementArtifact (scripts/ai/requirement-artifact.js)
 * @returns {{artifactId: string, status: string, issues: object[]}}
 *   the top-level result object is frozen; `issues` and its entries are not
 */
function analyzeRequirementQuality(artifact) {
  assertValidRequirementArtifact(artifact, "analyzeRequirementQuality");
  try {
    return runAnalysis(artifact);
  } catch (err) {
    throw new Error(
      `REQUIREMENT_QUALITY_ANALYSIS_FAILED: analyzeRequirementQuality could not analyze the supplied RequirementArtifact (${err.message}).`
    );
  }
}

/**
 * Analyzes an array of RequirementArtifact[] and returns results in the
 * same order. Each item is independently structurally validated (via
 * analyzeRequirementQuality()'s own RTI-1 call); duplicate artifact ids
 * within the collection are rejected defensively, since result identity
 * depends on artifactId. Cross-artifact semantic analysis (contradiction,
 * duplicate intent) is explicitly out of scope - see module docstring.
 *
 * @param {object[]} artifacts RequirementArtifact[]
 * @returns {object[]} RequirementQualityResult[] in input order
 */
function analyzeRequirementsQuality(artifacts) {
  if (artifacts === undefined || artifacts === null) {
    throw new Error("REQUIREMENT_QUALITY_INPUT_REQUIRED: analyzeRequirementsQuality requires an explicit array of RequirementArtifact; none was supplied.");
  }
  if (!Array.isArray(artifacts)) {
    throw new Error("REQUIREMENT_QUALITY_INPUT_INVALID: analyzeRequirementsQuality requires an array of RequirementArtifact.");
  }

  const results = [];
  const itemErrors = [];
  artifacts.forEach((artifact, index) => {
    try {
      results.push(analyzeRequirementQuality(artifact));
    } catch (err) {
      itemErrors.push(`artifacts[${index}]: ${err.message}`);
    }
  });
  if (itemErrors.length > 0) {
    throw new Error(`REQUIREMENT_QUALITY_INPUT_INVALID: analyzeRequirementsQuality received invalid requirement record(s) (${boundedDetail(itemErrors)}).`);
  }

  const collectionErrors = [];
  const seenIds = new Map();
  results.forEach((result, index) => {
    if (seenIds.has(result.artifactId)) {
      collectionErrors.push(`artifacts[${index}].id "${result.artifactId}" duplicates artifacts[${seenIds.get(result.artifactId)}].id`);
    } else {
      seenIds.set(result.artifactId, index);
    }
  });
  if (collectionErrors.length > 0) {
    throw new Error(`REQUIREMENT_QUALITY_COLLECTION_INVALID: analyzeRequirementsQuality received a collection with duplicate artifact ids (${boundedDetail(collectionErrors)}).`);
  }

  return results;
}

module.exports = {
  analyzeRequirementQuality,
  analyzeRequirementsQuality,
};
