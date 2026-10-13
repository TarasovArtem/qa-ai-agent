"use strict";
// Executed only by Linux integration tests. Signals target this actual Node
// process; storage uses real Linux file and directory handles throughout.
const fs = require("node:fs");
const path = require("node:path");
const fx = require("./stage4-fixtures");
const { createDurableStore } = require("../../scripts/ai/cli/stage4-durability");
const { runReviewRecord } = require("../../scripts/ai/cli/review-record");
const { runApply } = require("../../scripts/ai/cli/apply");
const { TerminalSession } = require("../../scripts/ai/cli/terminal-session");
const boundary = process.argv[2], disposition = process.argv[3];
async function main() {
  const f = fx.makeRun();
  if (boundary.startsWith("apply-")) await runReviewRecord(f.ctx);
  let paused = false;
  async function checkpoint(name) {
    if (name !== boundary || paused) return;
    paused = true;
    process.send({ type: "boundary", name, root: f.root, runDirReal: f.runDirReal });
    return new Promise(resolve => process.once("message", resolve));
  }
  let lastFile = "";
  const io = { ...fs.promises,
    async open(name, flags, mode) {
      const h = await fs.promises.open(name, flags, mode);
      const directory = fs.statSync(name).isDirectory();
      if (!directory) lastFile = path.basename(name);
      if (path.basename(name).startsWith("claim-")) await checkpoint("review-claim-handle");
      if (path.basename(name).startsWith("attempt-")) await checkpoint("apply-attempt-handle");
      if (disposition === "orphan" && path.basename(name).startsWith("record-")) { await h.close(); throw Object.assign(new Error("injected real record persistence failure"), { code: "EIO" }); }
      return {
        async write(...args) { const r = await h.write(...args); if (lastFile.startsWith("outcome-")) await checkpoint("apply-outcome-write"); return r; },
        async sync() {
          await h.sync();
          if (!directory && path.basename(name).startsWith("manifest.next-")) await checkpoint("review-temp-fsync");
          if (directory && lastFile.startsWith("attempt-")) await checkpoint("apply-attempt-dir-fsync");
        },
        async close() { return h.close(); },
      };
    },
    async rename(a, b) { await fs.promises.rename(a, b); await checkpoint("review-renamed"); },
  };
  const d = createDurableStore({ root: f.ctx.root, runDirReal: f.runDirReal, protectedPaths: f.ctx.protectedPaths, io });
  const create = d.create, replace = d.replace, ensureDirectory = d.ensureDirectory;
  d.ensureDirectory = async name => {
    await ensureDirectory(name);
    if (name === "review") {
      const message = await checkpoint("review-directory-durable");
      if (message && typeof message === "object") {
        if (Object.hasOwn(message, "columns")) tty.stdout.columns = message.columns;
        if (Object.hasOwn(message, "rows")) tty.stdout.rows = message.rows;
      }
    }
  };
  d.create = async (name, ...args) => {
    if (name.startsWith("review/claim-")) await checkpoint("review-before-claim");
    if (name.startsWith("apply/attempt-")) await checkpoint("apply-before-attempt");
    const r = await create(name, ...args);
    if (name.startsWith("review/claim-")) await checkpoint("review-claim-durable");
    if (name.startsWith("review/record-")) await checkpoint("review-record-durable");
    if (name.startsWith("apply/attempt-")) await checkpoint("apply-attempt-durable");
    if (name.startsWith("apply/applied-")) await checkpoint("apply-applied-durable");
    if (name.startsWith("apply/outcome-")) await checkpoint("apply-outcome-durable");
    return r;
  };
  d.replace = async (...args) => { const r = await replace(...args); await checkpoint("review-committed"); return r; };
  // One-shot observers disappear on first delivery. The session can later
  // re-raise the same signal with its native default disposition, unchanged.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => process.send({ type: "signal-observed", signal }));
  const tty = fx.scriptedTerminal({ onWrite: text => process.stdout.write(text) });
  let reportPhase;
  const report = TerminalSession.prototype.report;
  TerminalSession.prototype.report = function (...args) { reportPhase = this.phase; return report.apply(this, args); };
  const stdoutWrite = tty.stdout.write.bind(tty.stdout);
  tty.stdout.write = (text, callback) => {
    if (boundary === "review-report-stalled" && String(text).startsWith("@Q2:S decision recorded:")) {
      process.send({ type: "report-phase", phase: reportPhase });
      checkpoint("review-report-stalled").then(() => stdoutWrite(text, callback)).catch(callback);
      return false; // deliberately withhold the report write callback
    }
    return stdoutWrite(text, callback);
  };
  const stderrWrite = tty.stderr.write.bind(tty.stderr);
  tty.stderr.write = (...args) => { process.stderr.write(args[0]); return stderrWrite(...args); };
  const ctx = { ...fx.withTerminal(f, tty), processAdapter: process, durableStore: () => d };
  try {
    const r = await (boundary.startsWith("apply-") ? runApply(ctx) : runReviewRecord(ctx));
    process.send({ type: "done", result: r, output: tty.output, error: tty.error });
    process.disconnect();
  } catch (e) {
    process.send({ type: "done", code: e.code, exitCode: e.exitCode, output: tty.output, error: tty.error });
    process.exitCode = e.exitCode || 1; process.disconnect();
  }
}
main().catch(e => { process.stderr.write(String(e.stack)); process.exitCode = 1; if (process.connected) process.disconnect(); });
