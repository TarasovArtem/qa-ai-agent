"use strict";
const crypto = require("crypto");
const readline = require("readline");
const os = require("os");
const { authorityRefused } = require("./errors");
const { readEnv } = require("./env");
const { rows, escapeTokens } = require("./canonical-review-serialization");
const { SESSION_MS, APPLY_CONFIRM_MS } = require("./review-record-v2");
function checkInteractivePolicy({ env = {}, platform = process.platform, stdin, stdout, stderr }, command) {
  const ci = readEnv(env, "CI", platform);
  if (readEnv(env, "GITHUB_ACTIONS", platform) === "true" || ci !== undefined && ci !== "" && ci !== "false" && ci !== "0") throw authorityRefused(command === "review" ? "APPROVAL_CI_FORBIDDEN" : "APPLY_CI_FORBIDDEN", "interactive Stage 4 authority is refused under the CI policy.");
  if (![stdin, stdout, stderr].every(s => s && s.isTTY === true)) throw authorityRefused("INTERACTIVE_TERMINAL_REQUIRED", "stdin, stdout and stderr must all be interactive terminals.");
}
function freshChallenge(randomBytes = crypto.randomBytes) {
  const bits = [...randomBytes(5)].map(b => b.toString(2).padStart(8, "0")).join("");
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; let out = "";
  for (let i = 0; i < 40; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(out)) throw new Error("challenge entropy unavailable"); return out;
}
function writeComplete(stream, text) { return new Promise((resolve, reject) => { stream.write(text, e => e ? reject(e) : resolve()); }); }
class TerminalSession {
  constructor({ stdin, stdout, stderr, platform = process.platform, processAdapter = process, monotonic = () => process.hrtime.bigint(), command = "review" }) {
    Object.assign(this, { stdin, stdout, stderr, platform, processAdapter, monotonic, command });
    this.started = monotonic(); this.window = command === "review" ? SESSION_MS : APPLY_CONFIRM_MS; this.phase = "SESSION";
    this.pending = null; this.interrupted = null; this.geometryViolated = false; this.closed = false;
    this.rl = readline.createInterface({ input: stdin, terminal: false, crlfDelay: Infinity });
    this.rl.on("line", line => { if (this.pending && this.pending.armed) this.pending.finish(null, line); });
    this.rl.on("close", () => { this.closed = true; if (this.pending) this.pending.finish(this.refusal()); });
    this.rl.on("error", () => { if (this.pending) this.pending.finish(this.refusal()); });
    this.onInputError = () => { this.interrupted = "INPUT_ERROR"; if (this.pending) this.pending.finish(this.refusal()); };
    stdin.on("error", this.onInputError);
    this.resize = () => { if (this.phase !== "CRITICAL" && this.phase !== "FINISHED" && this.geometryActive) { try { this.checkGeometry(); } catch (e) { if (this.pending) this.pending.finish(e); } } };
    stdout.on("resize", this.resize);
    this.handlers = new Map();
    for (const signal of platform === "win32" ? ["SIGINT", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => { if (!this.interrupted) this.interrupted = signal; if (this.phase !== "CRITICAL" && this.pending) this.pending.finish(this.refusal()); };
      this.handlers.set(signal, handler); processAdapter.on(signal, handler);
    }
  }
  refusal() { return authorityRefused(this.command === "review" ? "HUMAN_DECISION_NOT_CONFIRMED" : "APPLY_NOT_CONFIRMED", "the fresh interactive challenge was not confirmed."); }
  elapsed() { return Number(this.monotonic() - this.started) / 1e6; }
  checkTime() { if (this.elapsed() > this.window) throw authorityRefused(this.command === "review" ? "APPROVAL_SESSION_EXPIRED" : "APPLY_NOT_CONFIRMED", "the product-owned monotonic interaction window elapsed."); if (this.interrupted) throw this.refusal(); }
  startGeometry() { this.geometryActive = true; this.checkGeometry(); }
  checkGeometry() {
    if (this.geometryViolated || !Number.isInteger(this.stdout.columns) || this.stdout.columns < 100 || !Number.isInteger(this.stdout.rows) || this.stdout.rows < 24) { this.geometryViolated = true; throw authorityRefused("INTERACTIVE_TERMINAL_REQUIRED", "TAP-2 requires at least 100 columns and 24 rows; an observed violation requires a fresh session."); }
  }
  async emit(kind, ...parts) { for (const row of rows(kind, ...parts)) await writeComplete(this.stdout, row + "\n"); }
  async report(kind, text, { warning = false } = {}) { const stream = warning ? this.stderr : this.stdout; for (const row of rows(kind, text)) await writeComplete(stream, row + "\n"); }
  async readLine(maxBytes, prompt) {
    this.checkTime(); if (this.geometryActive) this.checkGeometry(); if (this.closed) throw this.refusal();
    // Lines received while no prompt is pending are discarded, never saved
    // as future challenge input. The challenge is fresh after full paging.
    return new Promise((resolve, reject) => {
      const finish = (error, line) => {
        if (!this.pending) return;
        clearTimeout(this.pending.timer); this.pending = null;
        try { this.checkTime(); if (this.geometryActive) this.checkGeometry(); if (error) throw error; if (Buffer.byteLength(line, "utf8") > maxBytes) throw this.refusal(); resolve(line); } catch (e) { reject(e); }
      };
      const timer = setTimeout(() => finish(authorityRefused(this.command === "review" ? "APPROVAL_SESSION_EXPIRED" : "APPLY_NOT_CONFIRMED", "the interaction window elapsed.")), Math.max(1, this.window - this.elapsed()));
      this.pending = { finish, timer, armed: false };
      Promise.resolve().then(prompt).then(() => {
        // Input received before every prompt row has drained is stale. It
        // cannot satisfy a newly presented challenge or page checkpoint.
        if (this.pending) this.pending.armed = true;
      }).catch(e => finish(e));
    });
  }
  async present(presentation) {
    this.startGeometry();
    for (const row of presentation.header) { this.checkTime(); await writeComplete(this.stdout, row + "\n"); }
    for (let k = 0; k < presentation.targets.length; k++) {
      this.checkGeometry(); const target = presentation.targets[k]; const pages = Math.ceil(target.length / 20);
      for (let page = 0; page < pages; page++) {
        this.checkTime(); this.checkGeometry(); const start = page * 20, end = Math.min(target.length, start + 20);
        for (const row of target.slice(start, end)) await writeComplete(this.stdout, row + "\n");
        this.checkGeometry();
        if (page + 1 < pages) await this.readLine(64, () => this.emit("P", `-- target ${k + 1}/${presentation.targets.length} page ${page + 1}/${pages} (rows ${start + 1}-${end} of ${target.length}); press Enter to continue --`));
      }
      this.checkGeometry(); await this.readLine(64, () => this.emit("E", `-- end of target ${k + 1}/${presentation.targets.length}; press Enter to continue --`));
    }
  }
  async decision(challenge, count, context) {
    this.checkGeometry();
    await this.emit("X", "context (not part of the presentation digest):");
    await this.emit("X", "repository root: ", escapeTokens(context.realRoot));
    await this.emit("X", "repository root binding: ", escapeTokens(context.rootDigest));
    await this.emit("X", "reviewer principal: ", escapeTokens(context.principal));
    await this.emit("X", "approval policy: whole package; one apply attempt; expires 24 hours after the decision");
    await this.emit("X", "operating rule: this decision must be typed by you, not by an AI agent or automation (", escapeTokens("§15.1"), ")");
    for (let attempt = 0; attempt < 3; attempt++) {
      const line = await this.readLine(64, async () => {
        await this.emit("A", `To APPROVE writing exactly these ${count} target(s), type:  APPROVE `, escapeTokens(challenge));
        await this.emit("R", "To REJECT this package, type:                        REJECT ", escapeTokens(challenge));
        await this.emit("I", "Anything else, Ctrl-C or end-of-input aborts without recording.");
      });
      if (line === `APPROVE ${challenge}`) return "APPROVE";
      if (line === `REJECT ${challenge}`) return "REJECT";
    }
    throw this.refusal();
  }
  async comment() {
    for (;;) {
      const line = await this.readLine(500, () => this.emit("M", "Optional comment (ASCII, 1..500 characters; empty line skips):"));
      if (line === "") return null;
      if (/^[\x20-\x7e]{1,500}$/.test(line) && line.trim() === line) return line;
    }
  }
  async confirmApply(challenge) {
    this.started = this.monotonic();
    for (let i = 0; i < 3; i++) {
      const line = await this.readLine(64, () => this.emit("S", "To apply this package, type: APPLY ", escapeTokens(challenge)));
      if (line === `APPLY ${challenge}`) return;
    }
    throw this.refusal();
  }
  enterCritical() { this.checkTime(); this.checkGeometry(); this.phase = "CRITICAL"; }
  exitCritical() { this.phase = "FINISHED"; }
  dispose() {
    this.stdout.removeListener("resize", this.resize); this.stdin.removeListener("error", this.onInputError);
    for (const [signal, handler] of this.handlers) this.processAdapter.removeListener(signal, handler);
    this.rl.close(); if (this.pending) this.pending.finish(this.refusal());
  }
  completeSignal() {
    const signal = this.interrupted; if (!this.handlers.has(signal)) return;
    this.dispose();
    if (this.platform === "win32") this.processAdapter.exit(0xc000013a);
    else { this.processAdapter.kill(this.processAdapter.pid, signal); setImmediate(() => this.processAdapter.exit(128 + os.constants.signals[signal])); }
  }
}
module.exports = { checkInteractivePolicy, freshChallenge, writeComplete, TerminalSession };
