#!/usr/bin/env node
/**
 * `qa-agent` package binary (package.json `bin`). Not in `exports`:
 * requiring this file is unsupported. Non-interactive: it never reads stdin
 * and never prompts.
 */

"use strict";

const { run } = require("./cli");

run({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  platform: process.platform,
}).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write("qa-agent: error [INTERNAL_ERROR]: an unexpected internal error occurred.\n");
    process.exitCode = 1;
  }
);
