/**
 * `qa-agent review show --run <id>` - read-only, NON-AUTHORITATIVE
 * presentation of the review packages produced by `generate`
 * (contract §10.2 RC-07 presentation; DC-F02-1..3).
 *
 * It re-validates the whole run exactly like a downstream command would
 * (manifest, binding, stage order, digests, schemas, chain semantics; every
 * review package is rebuilt from the persisted plan/context/change set and
 * must equal the persisted bytes' content), then prints the validated data.
 *
 * It does not, and structurally cannot:
 *   - record, read, infer or report an approval or review status (no review
 *     record is read; there is no status in a review package);
 *   - reach validateApprovedGeneratedChangeSetReview /
 *     validateApprovedTestDesignReview (neither module is in its graph);
 *   - write anything, apply a change, call a provider or the network.
 *
 * Whether the live repository still matches the context the proposal was
 * generated against is reported as information only.
 */

"use strict";

const { inputRefused } = require("./errors");
const store = require("./run-store");
const artifacts = require("./run-artifacts");

const { requireRequirements, openRun, loadDesignStage, loadPlanStage, loadGenerateStage } = artifacts;

const AUTHORITY_STATEMENT = "NON-AUTHORITATIVE: presentation only. No approval is recorded, read, inferred or evaluated by this command.";
const ESCAPE_LEGEND = "display escapes: \\uXXXX / \\u{XXXXX} = a control, invisible-format or bidirectional character shown escaped; \\\\ = one literal backslash.";

// Terminal safety for the human rendering (ARCH-S3-m05). Shown escaped,
// never emitted raw or deleted:
//   - C0/C1 control characters other than newline and tab;
//   - every Unicode format character (General_Category Cf): the bidi
//     embeddings/overrides U+202A-U+202E and isolates U+2066-U+2069, the
//     zero-width characters U+200B-U+200F / U+2060-U+2064, U+FEFF, U+00AD,
//     tag characters, ...;
//   - the line/paragraph separators U+2028/U+2029 and lone surrogates;
//   - the backslash itself, so the rendering stays unambiguous: "\u202e" in
//     the data is shown as "\\u202e", the character U+202E as "\u202e".
// Only the rendered text changes; the review-package data is never touched.
const DISPLAY_ESCAPED = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\\]|\p{Cf}|\p{Cs}/gu;

function escapeForDisplay(ch) {
  if (ch === "\\") return "\\\\";
  const cp = ch.codePointAt(0);
  return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, "0")}`;
}

function printable(text) {
  return String(text).replace(DISPLAY_ESCAPED, escapeForDisplay);
}

function liveContextStatus(root, config, persisted) {
  try {
    return artifacts.sameContext(persisted, artifacts.buildLiveRepositoryContext(root, config)) ? "CURRENT" : "CHANGED_SINCE_GENERATE";
  } catch {
    return "UNAVAILABLE";
  }
}

function runReviewShow(ctx) {
  requireRequirements(ctx.config);
  const { root, config } = ctx;
  const run = openRun(ctx, null);
  if (run.manifest.stages.length !== store.STAGE_ORDER.length) {
    throw inputRefused("RUN_STAGE_ORDER", "\"review show\" requires the generate stage of this run to be completed first.");
  }
  const design = loadDesignStage(run, config);
  const plan = loadPlanStage(run, design, config);
  const generated = loadGenerateStage(run, design, plan, config);
  const repositoryContextStatus = liveContextStatus(root, config, plan.repositoryContext);

  const packagePaths = run.manifest.stages[2].artifacts.filter((a) => a.kind === "GeneratedChangeSetReviewPackage").map((a) => `${run.runDirRel}/${a.path}`);
  const reviewPackages = generated.reviewPackages.map((p, i) => ({ path: packagePaths[i], reviewPackage: p }));

  const human = [`review show: run ${ctx.runId}`, AUTHORITY_STATEMENT, ESCAPE_LEGEND, `repository context: ${repositoryContextStatus}`];
  for (const { path: rel, reviewPackage: p } of reviewPackages) {
    human.push(
      "",
      `package ${printable(rel)}`,
      `  plan ${printable(p.automationPlanId)} (${printable(p.framework)}), packageDigest ${p.packageDigest}`,
      `  changeSetDigest ${p.changeSetDigest}`
    );
    for (const t of p.reviewTargets) {
      human.push(`  ${printable(t.operation)} ${printable(t.path)}`, `    purpose: ${printable(t.purpose)}`, `    proposedContentDigest: ${t.proposedContentDigest}`);
      if (t.baseContentDigest) human.push(`    baseContentDigest: ${t.baseContentDigest}`);
      human.push("    proposed content:", ...printable(t.proposedContent).split("\n").map((line) => `    | ${line}`));
    }
  }
  return {
    runId: ctx.runId,
    data: { authority: "NON_AUTHORITATIVE_PRESENTATION", repositoryContext: repositoryContextStatus, reviewPackages },
    artifacts: packagePaths,
    human,
  };
}

module.exports = { AUTHORITY_STATEMENT, ESCAPE_LEGEND, printable, runReviewShow };
