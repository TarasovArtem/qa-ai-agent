"use strict";

/**
 * Test-only source of truth for the Controlled-v1 Stage 3 package surface
 * (docs/package-surface-v4.md): the exact closed tarball inventory, the
 * Stage 3 private runtime closure, the private files that must stay
 * unshipped, and a static require-graph analyzer that works over ANY
 * directory (the checkout, an installed package, a deliberately broken
 * copy) so the same closure proof can be shown to pass and to fail.
 */

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_EXPORTS = Object.freeze({
  ".": "./scripts/ai/index.js",
  "./providers/jira": "./scripts/ai/providers/jira-requirements-provider.js",
  "./providers/azure-devops": "./scripts/ai/providers/azure-devops-requirements-provider.js",
  "./destinations/azure-devops": "./scripts/ai/destinations/azure-devops-test-case-destination.js",
  "./package.json": "./package.json",
});

const EXPECTED_BIN = Object.freeze({ "qa-agent": "scripts/ai/cli/qa-agent.js" });

const STAGE12_CLI_FILES = Object.freeze([
  "scripts/ai/cli/args.js",
  "scripts/ai/cli/child-env.js",
  "scripts/ai/cli/cli.js",
  "scripts/ai/cli/config-file.js",
  "scripts/ai/cli/env.js",
  "scripts/ai/cli/errors.js",
  "scripts/ai/cli/paths.js",
  "scripts/ai/cli/policy.js",
  "scripts/ai/cli/qa-agent.js",
  "scripts/ai/cli/requirements-check.js",
  "scripts/ai/cli/stage-process.js",
  "scripts/ai/cli/stage-runner.js",
  "scripts/ai/cli/strict-json.js",
  "scripts/ai/cli/triage.js",
]);

// New Stage 3 CLI orchestration modules (not exported; reachable from bin).
const STAGE3_CLI_FILES = Object.freeze([
  "scripts/ai/cli/generative-runner.js",
  "scripts/ai/cli/generative.js",
  "scripts/ai/cli/review-show.js",
  "scripts/ai/cli/run-artifacts.js",
  "scripts/ai/cli/run-store.js",
]);

const CLI_FILES = Object.freeze([...STAGE12_CLI_FILES, ...STAGE3_CLI_FILES].sort());

// OD-02: the minimal private runtime closure of design/plan/generate/review
// show - INTERNAL / SHIPPED PRIVATE RUNTIME DEPENDENCY, never exported.
const STAGE3_PRIVATE_RUNTIME = Object.freeze([
  "scripts/ai/generation/automation-candidate.js",
  "scripts/ai/generation/automation-plan.js",
  "scripts/ai/generation/cross-model-validation.js",
  "scripts/ai/generation/errors.js",
  "scripts/ai/generation/limits.js",
  "scripts/ai/generation/primitives.js",
  "scripts/ai/generation/requirement-model.js",
  "scripts/ai/generation/test-case-model.js",
  "scripts/ai/generative-test-design/automation-candidate-generator.js",
  "scripts/ai/generative-test-design/automation-candidate-prompt.js",
  "scripts/ai/generative-test-design/evidence-ingestion.js",
  "scripts/ai/generative-test-design/requirement-model-generator.js",
  "scripts/ai/generative-test-design/test-case-model-generator.js",
  "scripts/ai/generative-test-design/test-case-model-prompt.js",
  "scripts/ai/generative-test-design/test-design-prompt.js",
  "scripts/ai/test-automation/automation-plan-generator.js",
  "scripts/ai/test-automation/automation-plan-prompt.js",
  "scripts/ai/test-automation/automation-repository-context.js",
  "scripts/ai/test-automation/generate-change-set-prompt.js",
  "scripts/ai/test-automation/generate-change-set.js",
  "scripts/ai/test-automation/generated-change-set-review-canonical.js",
  "scripts/ai/test-automation/generated-change-set-review-package.js",
  "scripts/ai/test-automation/generated-change-set.js",
]);

// Stage 4A private implementation closure. These files ship to make the
// approved implementation available to the installation, but remain behind
// the unchanged release capability gate and are not package exports.
const STAGE4_PRIVATE_RUNTIME = Object.freeze([
  "scripts/ai/cli/apply.js",
  "scripts/ai/cli/canonical-review-serialization.js",
  "scripts/ai/cli/path-identity.js",
  "scripts/ai/cli/review-record-v2.js",
  "scripts/ai/cli/review-record.js",
  "scripts/ai/cli/stage4-durability.js",
  "scripts/ai/cli/stage4-principal.js",
  "scripts/ai/cli/stage4-run.js",
  "scripts/ai/cli/stage4-state.js",
  "scripts/ai/cli/terminal-session.js",
  "scripts/ai/test-automation/applied-change-set-record.js",
  "scripts/ai/test-automation/change-set-application.js",
  "scripts/ai/test-automation/generated-change-set-review-record.js",
  "scripts/ai/test-automation/generated-change-set-review-record-builder.js",
].sort());

// Private modules that remain REPOSITORY-ONLY (approval gates, review
// records, application, execution, regeneration).
const EXCLUDED_PRIVATE = Object.freeze([
  "scripts/ai/generative-test-design/test-design-review-canonical.js",
  "scripts/ai/generative-test-design/test-design-review-package.js",
  "scripts/ai/generative-test-design/test-design-review-record.js",
  "scripts/ai/test-automation/automation-execution-record.js",
  "scripts/ai/test-automation/controlled-execution.js",
  "scripts/ai/test-automation/regenerate-change-set.js",
]);

const PRIVATE_TREES = Object.freeze(["scripts/ai/generation/", "scripts/ai/generative-test-design/", "scripts/ai/test-automation/"]);

// The certified 47-file baseline, the 19 CLI modules and the 23 Stage 3
// private runtime files.
const EXPECTED_INVENTORY = Object.freeze(
  [
    "LICENSE",
    "README.md",
    "package.json",
    "scripts/ai/adapters/cypress-adapter.js",
    "scripts/ai/adapters/playwright-adapter.js",
    "scripts/ai/agent-policy.js",
    "scripts/ai/aggregate-browser-context.js",
    "scripts/ai/analyze-failure.js",
    "scripts/ai/bounded-response.js",
    ...CLI_FILES,
    "scripts/ai/collect-context.js",
    "scripts/ai/collect-history.js",
    "scripts/ai/config.js",
    "scripts/ai/context-utils.js",
    "scripts/ai/correlation-projection.js",
    "scripts/ai/destinations/azure-devops-test-case-destination.js",
    "scripts/ai/framework-runtime-config.js",
    ...STAGE3_PRIVATE_RUNTIME,
    ...STAGE4_PRIVATE_RUNTIME,
    "scripts/ai/index.js",
    "scripts/ai/knowledge/loader.js",
    "scripts/ai/knowledge/schema.js",
    "scripts/ai/knowledge/selector.js",
    "scripts/ai/knowledge/units/ci-job-isolation-runner-state.json",
    "scripts/ai/knowledge/units/cross-browser-differing-signature-caution.json",
    "scripts/ai/knowledge/units/framework-cypress-command-retry-ability-scope.json",
    "scripts/ai/knowledge/units/framework-cypress-retry-timeout-semantics.json",
    "scripts/ai/knowledge/units/project-firefox-execution-environment-split.json",
    "scripts/ai/knowledge/units/qa-timeout-error-multiple-causes.json",
    "scripts/ai/project-knowledge-config.js",
    "scripts/ai/project-profile.js",
    "scripts/ai/providers/azure-devops-requirements-provider.js",
    "scripts/ai/providers/gemini-provider.js",
    "scripts/ai/providers/groq-provider.js",
    "scripts/ai/providers/index.js",
    "scripts/ai/providers/jira-requirements-provider.js",
    "scripts/ai/providers/mock-provider.js",
    "scripts/ai/providers/provider-contract.js",
    "scripts/ai/providers/provider-error.js",
    "scripts/ai/qa-agent-prompt.js",
    "scripts/ai/repository-root.js",
    "scripts/ai/requirement-artifact.js",
    "scripts/ai/requirement-quality.js",
    "scripts/ai/requirement-traceability.js",
    "scripts/ai/requirements-file.js",
    "scripts/ai/requirements-source-provider.js",
    "scripts/ai/runtime-framework-selector.js",
    "scripts/ai/test-design-publishing.js",
    "scripts/ai/test-design.js",
    "scripts/ai/triage-boundary-contract.js",
  ].sort()
);

// --- static require graph ---------------------------------------------------------

// A `/` after one of these (or at the start) begins a regular expression
// literal, otherwise it is division - the usual tokenizer heuristic.
const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

/**
 * Minimal lexer (not a parser): separates comments, string / template
 * literals and regular-expression literals from code so that `//` or `/*`
 * inside a string never starts a comment and a quote inside a regex never
 * starts a string. Returns:
 *   code       the source with comments blanked (strings kept)
 *   bare       the source with comments AND literal contents blanked
 *              (delimiters kept) - for keyword-level checks
 *   strings    every string / template-chunk content
 *   problems   unterminated constructs (the scan is then not trustworthy)
 * Line structure is preserved in `code` and `bare`.
 */
function lexSource(src) {
  let code = "";
  let bare = "";
  const strings = [];
  const problems = [];
  const templateDepth = [];
  const n = src.length;
  let i = 0;
  let prev = "";
  let prevWord = "";
  const blank = (text) => text.replace(/[^\n]/g, " ");
  const emit = (text, bareText = text) => {
    code += text;
    bare += bareText;
  };

  // Reads template text from i (just after "`" or after the "}" closing a
  // "${"). Returns "end", "expr" or "eof".
  const readTemplate = () => {
    let text = "";
    while (i < n) {
      const ch = src[i];
      if (ch === "\\") {
        const esc = src.slice(i, i + 2);
        text += esc;
        emit(esc, blank(esc));
        i += 2;
        continue;
      }
      if (ch === "`") {
        emit(ch);
        i += 1;
        strings.push(text);
        return "end";
      }
      if (ch === "$" && src[i + 1] === "{") {
        emit("${");
        i += 2;
        strings.push(text);
        templateDepth.push(0);
        return "expr";
      }
      text += ch;
      emit(ch, blank(ch));
      i += 1;
    }
    problems.push("unterminated template literal");
    return "eof";
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      const comment = blank(src.slice(i, stop));
      emit(comment);
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) {
        problems.push("unterminated block comment");
        break;
      }
      emit(blank(src.slice(i, end + 2)));
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let text = "";
      while (j < n && src[j] !== ch && src[j] !== "\n") {
        if (src[j] === "\\") {
          text += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        text += src[j];
        j += 1;
      }
      if (j >= n || src[j] !== ch) {
        problems.push("unterminated string literal");
        break;
      }
      emit(src.slice(i, j + 1), `${ch}${blank(src.slice(i + 1, j))}${ch}`);
      strings.push(text);
      i = j + 1;
      prev = ch;
      prevWord = "";
      continue;
    }
    if (ch === "`" || (ch === "}" && templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === 0)) {
      if (ch === "}") templateDepth.pop();
      emit(ch);
      i += 1;
      if (readTemplate() === "eof") break;
      prev = "`";
      prevWord = "";
      continue;
    }
    if (ch === "/" && (REGEX_PRECEDERS.has(prev) || REGEX_KEYWORDS.has(prevWord))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        const c = src[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (inClass) {
          if (c === "]") inClass = false;
        } else if (c === "[") {
          inClass = true;
        } else if (c === "/") {
          break;
        }
        j += 1;
      }
      if (j >= n || src[j] !== "/") {
        problems.push("unterminated regular expression literal");
        break;
      }
      j += 1;
      while (j < n && /[a-z]/i.test(src[j])) j += 1;
      const literal = src.slice(i, j);
      emit(literal, `/${blank(literal.slice(1))}`);
      i = j;
      prev = ")";
      prevWord = "";
      continue;
    }
    if (templateDepth.length > 0 && ch === "{") templateDepth[templateDepth.length - 1] += 1;
    if (templateDepth.length > 0 && ch === "}") templateDepth[templateDepth.length - 1] -= 1;
    emit(ch);
    if (!/\s/.test(ch)) {
      prevWord = IDENTIFIER_CHAR.test(ch) ? (IDENTIFIER_CHAR.test(prev) ? prevWord : "") + ch : "";
      prev = ch;
    }
    i += 1;
  }
  if (templateDepth.length > 0 && !problems.includes("unterminated template literal")) problems.push("unterminated template expression");
  return { code, bare, strings, problems };
}

function stripComments(src) {
  return lexSource(src).code;
}

// Module-loading forms other than a direct require(...) / require.resolve(...)
// call. Each makes the static graph unprovable and is reported as a problem.
// `require.main` (entrypoint detection) is the only other use of `require`.
const INDIRECT_LOADERS = Object.freeze([
  [/\brequire\b(?!\s*\(|\s*\.\s*resolve\s*\(|\s*\.\s*main\b)/, "indirect use of require"],
  [/\bcreateRequire\b/, "createRequire"],
  [/\bmodule\s*\.\s*require\b/, "module.require"],
  [/\b_load\s*\(/, "Module._load"],
  [/\bmainModule\b/, "process.mainModule"],
  [/\bimport\s*\(/, "dynamic import()"],
]);

// Literal relative specifiers of require(...) and, optionally,
// require.resolve(...) (the CLI locates its spawned child entrypoints that
// way); literal bare (package / builtin) specifiers; and, as problems, any
// non-literal require, indirect loader or unterminated lexical construct.
function scanModule(source, { includeResolve = true } = {}) {
  const lexed = lexSource(source);
  const relative = [];
  const bareSpecifiers = [];
  const problems = [...lexed.problems];
  const pattern = includeResolve ? /\brequire(?:\.resolve)?\s*\(\s*([^)]*?)\s*\)/g : /\brequire\s*\(\s*([^)]*?)\s*\)/g;
  for (const m of lexed.code.matchAll(pattern)) {
    const literal = m[1].match(/^(["'])([^"'`\\]*)\1$/);
    if (!literal) {
      problems.push(`non-literal require(${m[1]})`);
      continue;
    }
    if (literal[2].startsWith(".")) relative.push(literal[2]);
    else bareSpecifiers.push(literal[2]);
  }
  for (const [loader, label] of INDIRECT_LOADERS) if (loader.test(lexed.bare)) problems.push(label);
  return { relative, bare: bareSpecifiers, strings: lexed.strings, problems };
}

// Node's resolution order for a relative specifier over a set of available
// files: exact file, .js, .json, directory index.
function resolveIn(available, fromRel, spec) {
  const base = path.posix.join(path.posix.dirname(fromRel), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, `${base}/index.js`]) if (available.has(candidate)) return candidate;
  return null;
}

/**
 * Static closure of `entries` inside `baseDir`, restricted to the `available`
 * file set (repository-relative POSIX paths). Returns every reached file,
 * every edge, and every edge whose target is NOT available ("missing").
 * `readSource(rel)` defaults to reading baseDir/rel; tests may overlay it.
 */
function staticClosure({ baseDir, available, entries, includeResolve = true, readSource }) {
  const read = readSource || ((rel) => fs.readFileSync(path.join(baseDir, ...rel.split("/")), "utf8"));
  const reached = new Set();
  const edges = [];
  const missing = [];
  const problems = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    if (!available.has(file)) {
      missing.push(file);
      continue;
    }
    reached.add(file);
    if (!file.endsWith(".js")) continue;
    const scan = scanModule(read(file), { includeResolve });
    for (const p of scan.problems) problems.push(`${file}: ${p}`);
    for (const spec of scan.relative) {
      const resolved = resolveIn(available, file, spec);
      if (!resolved) {
        missing.push(`${file} -> ${spec}`);
        continue;
      }
      edges.push([file, resolved]);
      queue.push(resolved);
    }
  }
  return { reached, edges, missing, problems };
}

function listFiles(dir) {
  const out = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  })(dir);
  return out.sort();
}

function supportedEntrypoints(pkg) {
  return [...Object.values(pkg.exports), ...Object.values(pkg.bin || {})].map((t) => t.replace(/^\.\//, "")).filter((t) => t.endsWith(".js"));
}

module.exports = {
  EXPECTED_EXPORTS,
  EXPECTED_BIN,
  STAGE12_CLI_FILES,
  STAGE3_CLI_FILES,
  CLI_FILES,
  STAGE3_PRIVATE_RUNTIME,
  STAGE4_PRIVATE_RUNTIME,
  EXCLUDED_PRIVATE,
  PRIVATE_TREES,
  EXPECTED_INVENTORY,
  lexSource,
  stripComments,
  scanModule,
  resolveIn,
  staticClosure,
  listFiles,
  supportedEntrypoints,
};
