"use strict";

/**
 * TEST-ONLY provider double for the Stage 3 generative child process.
 *
 * Loaded exclusively by tests, as `node --require <this file>
 * generative-runner.js <stage>`, through a test `spawnImpl` (or a test
 * harness that wraps child_process.spawn). Production code never references
 * this file, never ships it, and has no fallback to it: without this
 * preload the child constructs the real network provider named by
 * AI_PROVIDER, and the parent refuses mock / --offline before any child
 * exists.
 *
 * It replaces only the resolution of scripts/ai/providers/index.js inside
 * the child, so every other module (generators, validators, the runner, the
 * IPC protocol, the closed environment) is the real code under test. The
 * scripted provider answers provider.analyze() calls in order from the JSON
 * file named by QA_AGENT_TEST_PROVIDER_SCRIPT:
 *
 *   { "responses": [ { "response": "<raw model text>" } | { "throw": { "message", "code" } } ],
 *     "echoToChildOutput": <optional boolean: child prints each raw response>,
 *     "callLog": "<optional file: one JSON line per call>",
 *     "loadedLog": "<optional file: modules loaded by the child, written at exit>" }
 */

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const script = JSON.parse(fs.readFileSync(process.env.QA_AGENT_TEST_PROVIDER_SCRIPT, "utf8"));
let calls = 0;

const provider = {
  name: "stage3-test-double",
  async analyze({ systemPrompt, userPrompt }) {
    const index = calls;
    calls += 1;
    if (script.callLog) {
      fs.appendFileSync(script.callLog, `${JSON.stringify({ index, systemPromptLength: systemPrompt.length, userPrompt, env: Object.keys(process.env).sort() })}\n`);
    }
    const step = script.responses[Math.min(index, script.responses.length - 1)];
    // Adversarial probe: make the child print the raw model text, so a test
    // can prove the parent never forwards child diagnostics.
    if (script.echoToChildOutput && typeof step.response === "string") {
      process.stdout.write(step.response);
      process.stderr.write(step.response);
    }
    if (step.throw) throw Object.assign(new Error(step.throw.message), { code: step.throw.code });
    return step.response;
  },
};

const PROVIDER_INDEX = path.join("scripts", "ai", "providers", "index.js");
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  let resolved = null;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch {
    // fall through to the real loader, which reports the failure
  }
  if (resolved && resolved.endsWith(PROVIDER_INDEX)) {
    return {
      createProvider(name) {
        if (script.callLog) fs.appendFileSync(script.callLog, `${JSON.stringify({ createProvider: name })}\n`);
        return provider;
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

if (script.loadedLog) {
  process.on("exit", () => {
    fs.writeFileSync(script.loadedLog, JSON.stringify(Object.keys(require.cache)));
  });
}
