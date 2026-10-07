/**
 * AISEC-7 machine-readable node:test reporter (SEC-02).
 *
 * Harness-internal only; loaded solely by the outer completeness verifier via
 * --test-reporter for its controlled evidence child run. It writes one JSON
 * object per runner event and line, keeping only the fields the verifier
 * binds to. Any line that is not such an object makes the run unparseable,
 * and the verifier treats an unparseable run as invalid evidence.
 */

"use strict";

function text(value, max = 500) {
  return value === undefined || value === null ? undefined : String(value).slice(0, max);
}

// Hook failures wrap the assertion in `cause`, so both messages are kept.
function errorText(error) {
  if (!error) return undefined;
  const parts = [error.message || String(error)];
  if (error.cause && error.cause.message && error.cause.message !== parts[0]) parts.push(error.cause.message);
  return text(parts.join(" | "), 2000);
}

module.exports = async function* aisec7EvidenceReporter(source) {
  for await (const event of source) {
    const data = event.data || {};
    const details = data.details || {};
    yield `${JSON.stringify({
      type: event.type,
      file: data.file,
      name: data.name,
      nesting: data.nesting,
      skip: data.skip,
      todo: data.todo,
      detailsType: details.type,
      message: text(data.message, 20000),
      error: errorText(details.error),
      counts: data.counts,
      success: data.success,
    })}\n`;
  }
};
