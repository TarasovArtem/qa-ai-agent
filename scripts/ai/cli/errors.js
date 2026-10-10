/**
 * Controlled-v1 CLI exit-code taxonomy and the single error class every CLI
 * module throws (docs/controlled-v1-productization-contract-v1.md §10.7).
 *
 * Exit codes and `code` reason strings are the stable CLI contract within a
 * CLI major version. 7/8/10 are reserved for the future `execute` command
 * (OD-06) and are never produced by any Stage 1-2 path.
 */

"use strict";

const EXIT_CODES = Object.freeze({
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  CONFIGURATION: 3,
  INPUT_REFUSED: 4,
  AUTHORITY_REFUSED: 5,
  PROVIDER_FAILURE: 6,
  EXECUTION_ERROR: 7,
  TIMED_OUT: 8,
  TEST_FAILED: 10,
});

const MAX_MESSAGE_LENGTH = 512;

// Messages are bounded and never carry caller-controlled values beyond what
// the throwing site deliberately includes (key names, fixed reasons).
function boundMessage(message) {
  const text = typeof message === "string" ? message : String(message);
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}...` : text;
}

class CliError extends Error {
  constructor(exitCode, code, message) {
    super(boundMessage(message));
    this.name = "CliError";
    this.exitCode = exitCode;
    this.code = code;
  }
}

function usageError(code, message) {
  return new CliError(EXIT_CODES.USAGE, code, message);
}

function configError(code, message) {
  return new CliError(EXIT_CODES.CONFIGURATION, code, message);
}

function inputRefused(code, message) {
  return new CliError(EXIT_CODES.INPUT_REFUSED, code, message);
}

function authorityRefused(code, message) {
  return new CliError(EXIT_CODES.AUTHORITY_REFUSED, code, message);
}

function providerFailure(code, message) {
  return new CliError(EXIT_CODES.PROVIDER_FAILURE, code, message);
}

module.exports = {
  EXIT_CODES,
  MAX_MESSAGE_LENGTH,
  CliError,
  boundMessage,
  usageError,
  configError,
  inputRefused,
  authorityRefused,
  providerFailure,
};
