/**
 * GOV-AUTO-1 Wave 4 / 1F -- governance CLI (design sections 18, 19, 24; D6-A:
 * one entrypoint, explicit Phase 1 / Phase 2 subcommands).
 *
 * This module owns exactly three things: allow-listed argument validation,
 * safe report-file output, and exit-code discipline. It never performs the
 * actual Git/GitHub orchestration itself -- that is an injected `pipeline`
 * function (the composition of 1A-1F for a real invocation), kept behind
 * the same dependency-injection seam every other stage already uses, so
 * this module's own tests never touch the network or a real repository.
 *
 * Non-negotiables (design sections 18, 24 and the Wave 4 implementation
 * mission's own explicit CLI requirements):
 *   - never observes its own unfinished CI workflow (Phase 1 and Phase 2 are
 *     explicit, mutually exclusive, caller-selected modes; nothing here
 *     infers "the run must be done by now");
 *   - a repository value never selects an external API endpoint by itself --
 *     `--repository` is validated shape only; the injected pipeline is what
 *     was already configured with real access, never re-derived from the flag;
 *   - an unrecognized flag is a hard error (`INVALID_ARGUMENT`), never ignored;
 *   - an uncaught error in the pipeline is caught here and mapped to a
 *     non-zero exit code -- this module never lets an uncaught exception
 *     produce a process exit code of 0;
 *   - the output path is validated through `lexicalResolveWithin()` (Wave 0),
 *     so a `--output-dir` value can never escape `repositoryRoot`; the
 *     injected `writeFile` is expected to additionally harden the actual
 *     write with `resolveWithinRoot()`'s real-filesystem symlink check;
 *   - never touches Git state, branches, PRs, CI or the reviewed HEAD.
 */

"use strict";

const { isPlainObject } = require("../../kernel/validation");
const { lexicalResolveWithin } = require("../../safety/path");

const ALLOWED_FLAGS = new Set(["--phase", "--repository", "--workflow-path", "--event", "--output-dir"]);
const REPOSITORY_ID = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const EVENTS = new Set(["pull_request", "push"]);

// design section 22's optional CLI exit-code mapping; an uncaught error must
// never map to 0, and an argument/parse failure is its own distinct code.
const EXIT_CODES = { PASS: 0, FAIL: 1, CONFIGURATION_ERROR: 2, HUMAN_REVIEW_REQUIRED: 3, INCOMPLETE: 4, INVALID_ARGUMENT: 5, UNCAUGHT_ERROR: 6 };

/** Strict allow-listed argument parsing: `--flag value` pairs only, no bare flags, no unknown flags, no environment-variable fallback. */
function parseArgs(argv) {
  if (!Array.isArray(argv)) return { ok: false, reason: "argv must be an array" };
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (typeof flag !== "string" || !ALLOWED_FLAGS.has(flag)) return { ok: false, reason: `unrecognized argument: ${typeof flag === "string" ? flag : "(non-string)"}` };
    if (typeof value !== "string" || value.length === 0) return { ok: false, reason: `${flag} requires a value` };
    args[flag.slice(2)] = value;
  }
  if (args.phase !== "1" && args.phase !== "2") return { ok: false, reason: "--phase must be exactly 1 or 2" };
  if (typeof args.repository !== "string" || !REPOSITORY_ID.test(args.repository)) return { ok: false, reason: "--repository must be an owner/name identity" };
  if (typeof args["workflow-path"] !== "string" || args["workflow-path"].length === 0) return { ok: false, reason: "--workflow-path is required" };
  if (!EVENTS.has(args.event)) return { ok: false, reason: "--event must be pull_request or push" };
  if (typeof args["output-dir"] !== "string" || args["output-dir"].length === 0) return { ok: false, reason: "--output-dir is required" };
  return {
    ok: true,
    args: { phase: Number(args.phase), repository: args.repository, workflowPath: args["workflow-path"], event: args.event, outputDir: args["output-dir"] },
  };
}

/**
 * runCli({ argv, repositoryRoot, pipeline, writeFile })
 *   argv           the raw CLI argument array (excluding the node/script path entries)
 *   repositoryRoot the trusted path authority (Wave 0)
 *   pipeline       async (parsedArgs) -> { report, markdown } -- the actual
 *                  1A-1F orchestration and JSON/Markdown assembly; injected
 *                  so this module's own tests never perform it for real
 *   writeFile      async (absolutePath, contents) -> void -- injected file
 *                  writer (the deterministic suite uses an in-memory fixture)
 *
 * Returns { exitCode, error? }. Never throws: every failure path, including
 * an uncaught pipeline exception, is caught and mapped to a fixed exit code.
 */
async function runCli(input) {
  if (!isPlainObject(input) || typeof input.repositoryRoot !== "string") return { exitCode: EXIT_CODES.UNCAUGHT_ERROR, error: "malformed CLI invocation" };
  const parsed = parseArgs(input.argv);
  if (!parsed.ok) return { exitCode: EXIT_CODES.INVALID_ARGUMENT, error: parsed.reason };
  if (typeof input.pipeline !== "function" || typeof input.writeFile !== "function") return { exitCode: EXIT_CODES.UNCAUGHT_ERROR, error: "malformed CLI invocation" };

  let jsonPath, mdPath;
  try {
    // Pure lexical containment check (no real filesystem access, so this
    // module's own tests need no real directory); a "real" writeFile
    // implementation additionally hardens the actual write with
    // resolveWithinRoot()'s symlink-aware real-filesystem check at the
    // point it touches disk (the same layering io/manifest-loader.js uses
    // for reads -- this module never re-implements that check itself).
    jsonPath = lexicalResolveWithin(input.repositoryRoot, `${parsed.args.outputDir}/pre-review.json`).absolute;
    mdPath = lexicalResolveWithin(input.repositoryRoot, `${parsed.args.outputDir}/pre-review.md`).absolute;
  } catch {
    return { exitCode: EXIT_CODES.INVALID_ARGUMENT, error: "output-dir escapes the repository root or is otherwise unsafe" };
  }

  let outcome;
  try {
    outcome = await input.pipeline(parsed.args);
  } catch {
    // An uncaught pipeline error must never surface as exit code 0.
    return { exitCode: EXIT_CODES.UNCAUGHT_ERROR, error: "the pipeline raised an uncaught error" };
  }
  if (!isPlainObject(outcome) || !isPlainObject(outcome.report) || typeof outcome.markdown !== "string") {
    return { exitCode: EXIT_CODES.UNCAUGHT_ERROR, error: "the pipeline returned a malformed result" };
  }

  try {
    await input.writeFile(jsonPath, JSON.stringify(outcome.report, null, 2));
    await input.writeFile(mdPath, outcome.markdown);
  } catch {
    return { exitCode: EXIT_CODES.UNCAUGHT_ERROR, error: "writing the report failed" };
  }

  const status = outcome.report.overallStatus;
  return { exitCode: Object.hasOwn(EXIT_CODES, status) ? EXIT_CODES[status] : EXIT_CODES.UNCAUGHT_ERROR };
}

module.exports = { runCli, parseArgs, EXIT_CODES };
