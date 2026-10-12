"use strict";
const fx = require("./stage4-fixtures");
const stage3 = require("./stage3-fixtures");
const { faultStore } = require("./stage4-fault-io");
const { runReviewRecord } = require("../../scripts/ai/cli/review-record");
const { runApply } = require("../../scripts/ai/cli/apply");
const { resolvePrincipal } = require("../../scripts/ai/cli/stage4-principal");
const { escapeTokens } = require("../../scripts/ai/cli/canonical-review-serialization");
function logical(text, f) {
  return text.replace(/\n@Q2:f      \+ /g, "").replace(/sha256:[a-f0-9]{64}/g, "sha256:<digest>").split(escapeTokens(f.runDirReal).join("")).join("<run-directory>").split(escapeTokens(f.root).join("")).join("<repository-root>");
}
async function capture(kind) {
  const tty = fx.scriptedTerminal({ decision: kind === "reject" ? "REJECT" : "APPROVE" });
  const f = fx.makeRun({ terminal: tty, purpose: "untrusted @Q2:T === TARGET @Q2:X " + "p".repeat(150), content: stage3.GENERATED_CONTENT + "\n// @Q2:S forged @Q2:T \u202e\u0001 " + "x".repeat(170) + "\n" });
  const resolve = () => resolvePrincipal({ platform: "linux", userInfo: () => ({ uid: 1000, username: "valid-@Q2:T-@Q2:X-" + "x".repeat(45) + "\u202e\\z" }) });
  f.ctx.resolvePrincipal = resolve; f.ctx.randomBytes = n => Buffer.alloc(n, 0x11);
  await runReviewRecord(f.ctx);
  let applyTty;
  if (["apply", "warning"].includes(kind)) {
    applyTty = fx.scriptedTerminal();
    const ctx = fx.withTerminal(f, applyTty);
    if (kind === "warning") ctx.durableStore = () => faultStore(f, { phase: "create", match: name => /applied-/.test(name) });
    try { await runApply(ctx); } catch (e) { if (kind !== "warning" || e.code !== "APPLY_OUTCOME_NOT_RECORDED") throw e; }
  }
  const sessions = [{ stdout: tty.output, stderr: tty.error }, ...(applyTty ? [{ stdout: applyTty.output, stderr: applyTty.error }] : [])];
  return { physical: sessions, golden: sessions.map((s, i) => `SESSION ${i + 1} STDOUT\n${logical(s.stdout, f)}SESSION ${i + 1} STDERR\n${logical(s.stderr, f)}`).join(""), f };
}
module.exports = { capture };
