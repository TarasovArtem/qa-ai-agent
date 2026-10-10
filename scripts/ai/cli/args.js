/**
 * Closed command table and argument parser of the Controlled-v1 CLI
 * (docs/controlled-v1-productization-contract-v1.md §10.2).
 *
 * There is deliberately no commit / push / pr / merge / publish / release /
 * regenerate / review verify / review status / init command, and no
 * --provider flag. Reserved commands exist only so the surface shape is
 * stable; their arguments are never interpreted (only --help and --json are
 * recognized) because their sole implementation is a fixed refusal.
 */

"use strict";

const { usageError } = require("./errors");

const COMMON_FLAGS = Object.freeze(["json", "offline", "root", "config", "help"]);
const VALUE_FLAGS = Object.freeze(["root", "config"]);

const COMMANDS = Object.freeze({
  info: Object.freeze({ kind: "baseline", flags: COMMON_FLAGS, summary: "Show version, contracts, capability and provider status (no network)." }),
  "config validate": Object.freeze({ kind: "baseline", flags: COMMON_FLAGS, summary: "Validate qa-agent.config.json." }),
  "requirements check": Object.freeze({
    kind: "baseline",
    flags: COMMON_FLAGS,
    summary: "Deterministic requirements quality, test-design and coverage check (no provider).",
  }),
  "triage collect": Object.freeze({ kind: "triage", stage: "collect", flags: COMMON_FLAGS, summary: "Collect failure context into reports/ai/context.json." }),
  "triage history": Object.freeze({ kind: "triage", stage: "history", flags: COMMON_FLAGS, summary: "Collect GitHub Actions history (network; refused with --offline)." }),
  "triage aggregate": Object.freeze({ kind: "triage", stage: "aggregate", flags: COMMON_FLAGS, summary: "Aggregate per-browser triage inputs." }),
  "triage analyze": Object.freeze({ kind: "triage", stage: "analyze", flags: COMMON_FLAGS, summary: "Analyze reports/ai/context.json with the effective provider." }),
  "triage run": Object.freeze({
    kind: "triage",
    stage: "run",
    flags: Object.freeze([...COMMON_FLAGS, "history"]),
    summary: "Local one-invocation triage: collect -> [history] -> analyze.",
  }),
  design: Object.freeze({ kind: "reserved", ownerDecision: "OD-02", summary: "Reserved (AI-assisted test design)." }),
  plan: Object.freeze({ kind: "reserved", ownerDecision: "OD-02", summary: "Reserved (automation planning)." }),
  generate: Object.freeze({ kind: "reserved", ownerDecision: "OD-02", summary: "Reserved (change-set proposal)." }),
  "review show": Object.freeze({ kind: "reserved", ownerDecision: "OD-02", summary: "Reserved (presents generate output)." }),
  "review record": Object.freeze({ kind: "reserved", ownerDecision: "OD-04", summary: "Reserved (human review recording)." }),
  apply: Object.freeze({ kind: "reserved", ownerDecision: "OD-04", summary: "Reserved (apply approved change set)." }),
  execute: Object.freeze({ kind: "reserved", ownerDecision: "OD-06", summary: "Reserved (controlled execution)." }),
});

const GROUPS = Object.freeze(["config", "requirements", "triage", "review"]);

function parseFlagToken(token) {
  const eq = token.indexOf("=");
  if (token.startsWith("--") && eq > 2) return { name: token.slice(2, eq), inlineValue: token.slice(eq + 1) };
  if (token.startsWith("--")) return { name: token.slice(2), inlineValue: undefined };
  return { name: null, inlineValue: undefined };
}

function resolveCommand(words) {
  if (words.length === 0) return { name: null, rest: [] };
  if (GROUPS.includes(words[0])) {
    if (words.length < 2) throw usageError("USAGE_SUBCOMMAND_REQUIRED", `"${words[0]}" requires a subcommand. Run "qa-agent --help".`);
    const name = `${words[0]} ${words[1]}`;
    if (!COMMANDS[name]) throw usageError("USAGE_UNKNOWN_COMMAND", 'unknown command. Run "qa-agent --help" for the supported commands.');
    return { name, rest: words.slice(2) };
  }
  if (!COMMANDS[words[0]] || words[0].includes(" ")) {
    throw usageError("USAGE_UNKNOWN_COMMAND", 'unknown command. Run "qa-agent --help" for the supported commands.');
  }
  return { name: words[0], rest: words.slice(1) };
}

/**
 * @returns {{ command: string|null, spec: object|null, flags: object }}
 *   flags: { json, offline, root, config, help, version, history }
 */
function parseArgs(argv) {
  if (!Array.isArray(argv)) throw usageError("USAGE_INVALID", "arguments must be an array.");
  const flags = { json: false, offline: false, root: undefined, config: undefined, help: false, version: false, history: false };
  const seen = new Set();
  const words = [];
  let reserved = null;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== "string") throw usageError("USAGE_INVALID", "arguments must be strings.");

    if (reserved) {
      // Reserved commands never interpret their arguments.
      if (token === "--help") flags.help = true;
      if (token === "--json") flags.json = true;
      continue;
    }

    if (token.startsWith("-")) {
      const { name, inlineValue } = parseFlagToken(token);
      if (!name || !["json", "offline", "root", "config", "help", "version", "history"].includes(name)) {
        throw usageError("USAGE_UNKNOWN_OPTION", 'unknown option. Run "qa-agent --help" for the supported options.');
      }
      if (seen.has(name)) throw usageError("USAGE_DUPLICATE_OPTION", `option --${name} was given more than once.`);
      seen.add(name);
      if (VALUE_FLAGS.includes(name)) {
        let value = inlineValue;
        if (value === undefined) {
          value = argv[i + 1];
          i += 1;
        }
        if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
          throw usageError("USAGE_MISSING_VALUE", `option --${name} requires a value.`);
        }
        flags[name] = value;
      } else {
        if (inlineValue !== undefined) throw usageError("USAGE_UNEXPECTED_VALUE", `option --${name} does not take a value.`);
        flags[name] = true;
      }
      continue;
    }

    words.push(token);
    // Identify a reserved command as soon as its words are complete, so the
    // rest of its argv is never interpreted.
    const candidate = words.length === 1 ? words[0] : `${words[0]} ${words[1]}`;
    if ((words.length === 1 && !GROUPS.includes(words[0])) || words.length === 2) {
      const spec = COMMANDS[candidate];
      if (spec && spec.kind === "reserved") reserved = candidate;
    }
  }

  if (reserved) return Object.freeze({ command: reserved, spec: COMMANDS[reserved], flags: Object.freeze(flags) });

  const { name, rest } = resolveCommand(words);
  if (rest.length > 0) throw usageError("USAGE_UNEXPECTED_ARGUMENT", "unexpected positional argument.");

  if (flags.version) {
    if (name || [...seen].some((f) => f !== "version")) throw usageError("USAGE_CONFLICT", "--version takes no command or other option.");
    return Object.freeze({ command: null, spec: null, flags: Object.freeze(flags) });
  }
  if (!name) {
    if (flags.help && [...seen].every((f) => f === "help")) return Object.freeze({ command: null, spec: null, flags: Object.freeze(flags) });
    throw usageError("USAGE_COMMAND_REQUIRED", 'a command is required. Run "qa-agent --help".');
  }

  const spec = COMMANDS[name];
  for (const flag of seen) {
    if (!spec.flags.includes(flag)) throw usageError("USAGE_OPTION_NOT_APPLICABLE", `option --${flag} is not valid for "${name}".`);
  }
  return Object.freeze({ command: name, spec, flags: Object.freeze(flags) });
}

module.exports = { COMMANDS, GROUPS, COMMON_FLAGS, parseArgs };
