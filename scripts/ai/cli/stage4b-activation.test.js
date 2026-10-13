"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, COMMANDS } = require("./args");
const policy = require("./policy");
const { cleanupScratch, baseConfig, makeRoot, runCli, hermeticEnv } = require("../../../test/helpers/qa-agent-cli");

after(cleanupScratch);
const RUN = "20261012T120000Z-0123456789abcdef";
const commands = [["reviewRecord", ["review", "record"], "APPROVAL_CI_FORBIDDEN"], ["apply", ["apply"], "APPLY_CI_FORBIDDEN"]];
const selection = ["--run", RUN, "--package", "0001"];

test("Stage 4B release enables only reviewRecord/apply; immutable policy and execute refusal remain", async () => {
  for (const key of ["reviewRecord", "apply", "execute"]) {
    assert.equal(policy.RELEASE_CAPABILITIES[key].enabled, key !== "execute");
    assert.ok(Object.isFrozen(policy.RELEASE_CAPABILITIES[key]));
  }
  assert.ok(Object.isFrozen(policy.RELEASE_CAPABILITIES));
  assert.equal(COMMANDS.execute.kind, "reserved");
  const r = await runCli(["execute", "--json", "--root", "/nonexistent", "--force"]);
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "CAPABILITY_NOT_ENABLED_IN_RELEASE");
});

for (const [key, command, ciCode] of commands) {
  test(`Stage 4B ${key}: approved selection grammar, no automated decision flags or JSON`, () => {
    const parsed = parseArgs([...command, ...selection, "--offline"]);
    assert.equal(parsed.spec.kind, "stage4");
    assert.equal(parsed.spec.capability, key);
    assert.equal(parsed.flags.package, "0001");
    assert.equal(parsed.flags.run, RUN);
    for (const [args, code] of [
      [[], "USAGE_MISSING_RUN"],
      [["--run", RUN], "USAGE_MISSING_PACKAGE"],
      ...["0000", "1", "../1", "10000", "abcd"].map(p => [["--run", RUN, "--package", p], "USAGE_INVALID_PACKAGE"]),
      [[...selection, "--json"], "USAGE_OPTION_NOT_APPLICABLE"],
      ...["yes", "force", "decision", "reviewer", "comment", "non-interactive"].map(f => [[...selection, `--${f}`], "USAGE_UNKNOWN_OPTION"]),
    ]) assert.throws(() => parseArgs([...command, ...args]), { exitCode: 2, code });
    assert.equal(parseArgs([...command, "--help"]).flags.help, true);
    assert.throws(() => parseArgs(["review", "show", "--run", RUN, "--package", "0001"]), { code: "USAGE_OPTION_NOT_APPLICABLE" });
  });

  test(`Stage 4B ${key}: validated target config false/missing refuses; true reaches existing terminal gate`, async () => {
    for (const capabilities of [undefined, {}, { [key]: false }, { [key]: true }]) {
      const root = makeRoot(baseConfig(capabilities === undefined ? {} : { capabilities }));
      const before = fs.readFileSync(path.join(root, "qa-agent.config.json"));
      const r = await runCli([...command, ...selection, "--root", root]);
      assert.equal(r.code, 5, r.stderr);
      assert.match(r.stderr, capabilities?.[key] ? /INTERACTIVE_TERMINAL_REQUIRED/ : /CAPABILITY_NOT_REQUESTED/);
      assert.deepEqual(fs.readFileSync(path.join(root, "qa-agent.config.json")), before);
      assert.deepEqual(fs.readdirSync(root), ["qa-agent.config.json"]);
    }
    const invalid = makeRoot(baseConfig({ capabilities: { [key]: "true" } }));
    assert.equal((await runCli([...command, ...selection, "--root", invalid])).code, 3);
  });

  test(`Stage 4B ${key}: CI refusal survives activation and offline, before run access`, async () => {
    const root = makeRoot(baseConfig({ capabilities: { [key]: true } }));
    for (const extra of [{ CI: "true" }, { CI: "1" }, { CI: "other" }, { GITHUB_ACTIONS: "true", CI: "false" }]) {
      for (const flags of [[], ["--offline"]]) {
        const r = await runCli([...command, ...selection, "--root", root, ...flags], { env: hermeticEnv(extra) });
        assert.equal(r.code, 5);
        assert.ok(r.stderr.includes(ciCode), r.stderr);
      }
    }
    assert.deepEqual(fs.readdirSync(root), ["qa-agent.config.json"]);
  });

  test(`Stage 4B ${key}: offline needs no provider; existing contradiction check remains`, async () => {
    const root = makeRoot(baseConfig({ capabilities: { [key]: true }, providers: { allow: [] } }));
    for (const extra of [{}, { CI: "false" }, { CI: "0" }]) {
      const r = await runCli([...command, ...selection, "--root", root, "--offline"], { env: hermeticEnv(extra) });
      assert.equal(r.code, 5);
      assert.match(r.stderr, /INTERACTIVE_TERMINAL_REQUIRED/);
    }
    const contradiction = await runCli([...command, ...selection, "--root", root, "--offline"], { env: hermeticEnv({ AI_PROVIDER: "groq" }) });
    assert.match(contradiction.stderr, /OFFLINE_PROVIDER_CONTRADICTION/);
    const noProvider = await runCli([...command, ...selection, "--root", root], { env: hermeticEnv({ AI_PROVIDER: "groq" }) });
    assert.match(noProvider.stderr, /INTERACTIVE_TERMINAL_REQUIRED/);
  });
}
