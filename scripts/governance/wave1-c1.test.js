"use strict";

// GOV-AUTO-1 Wave 1 / Corrective C1: one regression per open HEAVY-review finding
// (W1-SEC-H1, W1-SEC-M2, W1-SEC-L1, W1-DEV-L1, W1-DEV-L2). W1-SEC-M1 lives in
// stages/1a/secrets.test.js and W1-SEC-M3 in stages/1a/identity.test.js. Every test here
// fails against the reviewed head c0b4734 and passes on C1. Timing assertions use a generous
// ceiling only as a hang detector; termination is guaranteed by the parser's own budget.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const g = require("./index");
const { GIT, createTempRepo, basePolicy, changedResult, fakeReader, gitOptions, makeSubject } = require("./test-support-git");
const { createGitAdapter } = require("./stages/1a/git-adapter");

const CEILING_MS = 15_000;
const timed = (fn) => {
  const t0 = process.hrtime.bigint();
  const value = fn();
  return { value, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
};
const parse = (text) => g.parseMarkdown({ path: "docs/a.md", text });

// ------------------------------------------------------------- W1-SEC-H1

const nested = (n) => "[".repeat(n) + "]".repeat(n);
const CONTEXTS = {
  paragraph: (core) => `${core}\n`,
  heading: (core) => `# ${core}\n`,
  "table row": (core) => `| a | b |\n|---|---|\n| ${core} | x |\n`,
  "link text": (core) => `[${core}](a.md)\n`,
};

test("W1-SEC-H1: hostile nested brackets terminate promptly and fail closed in every context (one shared work budget)", () => {
  for (const [context, build] of Object.entries(CONTEXTS)) {
    for (const n of [100, 300, 1000]) {
      const text = build(nested(n));
      const first = timed(() => parse(text));
      assert.ok(first.ms < CEILING_MS, `${context} n=${n} took ${first.ms.toFixed(0)}ms`);
      const again = parse(text);
      assert.deepEqual(again, first.value, `${context} n=${n}: deterministic`);
      if (n === 1000) {
        assert.equal(first.value.ok, false, `${context} n=1000 fails closed`);
        assert.equal(first.value.reasonCode, "MARKDOWN_BOUND_EXCEEDED");
      } else assert.ok(first.value.ok === true || first.value.reasonCode === "MARKDOWN_BOUND_EXCEEDED", `${context} n=${n}: result is ok or fail-closed`);
    }
  }
});

test("W1-SEC-H1: the work bound covers a whole file, not one paragraph (a maximum-size hostile document)", () => {
  const cases = {
    "500 paragraph lines of 1000-deep nesting": `${nested(1000)}\n`.repeat(500),
    "1 MiB of open brackets": `${"[".repeat(32_000)}\n`.repeat(32),
    "1 MiB of link openers": `${"[a](".repeat(8000)}\n`.repeat(32),
    "1 MiB of image openers": `${"![".repeat(16_000)}\n`.repeat(32),
    "deeply nested link text with targets": `${"[".repeat(300)}x${"](a.md)".repeat(300)}\n`.repeat(50),
    "table rows of nesting": `| a | b |\n|---|---|\n${`| ${nested(200)} | x |\n`.repeat(200)}`,
  };
  for (const [name, text] of Object.entries(cases)) {
    const r = timed(() => parse(text));
    assert.ok(r.ms < CEILING_MS, `${name} took ${r.ms.toFixed(0)}ms`);
    assert.ok(r.value.ok === true || r.value.reasonCode === "MARKDOWN_BOUND_EXCEEDED", name);
  }
});

test("W1-SEC-H1: a hostile file makes checkReferences INCOMPLETE (never a clean PASS) and does not hang", async () => {
  const subject = makeSubject();
  const policy = basePolicy();
  const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy, reader: fakeReader({ "docs/a.md": `${nested(1000)}\n` }) });
  const files = r.records.find((x) => x.checkId === "1B.MARKDOWN.FILES");
  assert.equal(`${files.status}/${files.reasonCode}`, "INCOMPLETE/MARKDOWN_BOUND_EXCEEDED");
  assert.notEqual(g.aggregate(r.records).readiness.state, "READY");
});

test("W1-SEC-H1: legitimate deep-but-reasonable structure still parses, and the budget is not a public surface", () => {
  const deep = parse(`[${"[a]".repeat(10)} [b [c [d]]]](x.md#top)\n\n${"- [item](i.md)\n".repeat(2000)}`);
  assert.equal(deep.ok, true);
  assert.equal(deep.links.length, 2001);
  assert.equal(parse(`${nested(20)}\n`).ok, true);
  for (const name of ["newBudget", "spend", "budget"]) assert.equal(name in g, false, `${name} must not be exported`);
});

// ------------------------------------------------------------- W1-SEC-M2

test("W1-SEC-M2: a head-controlled .gitmodules (ignore = all) cannot hide a gitlink addition or pointer move", async () => {
  const repo = createTempRepo();
  try {
    const A = "1".repeat(40);
    const B = "2".repeat(40);
    repo.commit("base", { "README.md": "x\n" });
    const base = repo.sha("HEAD");
    repo.write(".gitmodules", '[submodule "evil"]\n\tpath = secrets/evil\n\turl = https://example.invalid/x.git\n\tignore = all\n');
    repo.git("add", "-A");
    repo.git("update-index", "--add", "--cacheinfo", `160000,${A},secrets/evil`);
    repo.git("commit", "-q", "-m", "add gitlink");
    const added = repo.sha("HEAD");
    repo.git("update-index", "--cacheinfo", `160000,${B},secrets/evil`);
    repo.git("commit", "-q", "-m", "move gitlink");
    const moved = repo.sha("HEAD");
    // Preconditions: the attack really hides it from a plain diff of this repository.
    const plain = (a, b) => repo.git("diff", "--name-only", "-z", "--no-renames", a, b, "--").split("\0").filter(Boolean);
    assert.deepEqual(plain(added, moved), [], "precondition: default git diff hides the moved gitlink");

    const adapter = createGitAdapter({ repositoryRoot: repo.root, gitExecutable: GIT });
    assert.deepEqual([...(await adapter.diffNames(base, added)).value.paths].sort(), [".gitmodules", "secrets/evil"]);
    assert.deepEqual([...(await adapter.diffNames(added, moved)).value.paths], ["secrets/evil"], "pointer move is visible");

    // Through the public interface, and it then lands in the forbidden scope domain.
    const subject = { head: moved, tree: repo.tree(moved), base: added, range: { mode: "PR_REVIEW", from: added, to: moved } };
    const files = await g.getChangedFiles({ subject, ...gitOptions(repo), invocationTrust: "OPERATOR_SUPPLIED" });
    assert.deepEqual([...files.files], ["secrets/evil"]);
    const scope = await g.checkScope({ subject, changedFiles: files, policy: basePolicy() });
    assert.equal(scope.records.find((r) => r.checkId === "1A.SCOPE.FORBIDDEN").status, "FAIL");
  } finally {
    repo.cleanup();
  }
});

test("W1-SEC-M2: every Git diff invocation in 1A forces --ignore-submodules=none", () => {
  const source = fs.readFileSync(nodePath.join(__dirname, "stages", "1a", "git-adapter.js"), "utf8");
  const diffs = source.match(/\[\s*"diff"[^\]]*\]/g) || [];
  assert.ok(diffs.length >= 1);
  for (const call of diffs) assert.match(call, /"--ignore-submodules=none"/);
  const anywhere = fs.readdirSync(nodePath.join(__dirname, "stages"), { recursive: true }).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  for (const file of anywhere) {
    const text = fs.readFileSync(nodePath.join(__dirname, "stages", file), "utf8");
    if (!file.endsWith("git-adapter.js")) assert.equal(/"diff"|'diff'/.test(text), false, `${file} must not run its own diff`);
  }
});

// ------------------------------------------------------------- W1-SEC-L1

const isUnsafe = (text) => [...text].some((ch) => { const c = ch.codePointAt(0); return c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x61c || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x2069) || c === 0xfeff; });
function* strings(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) yield* strings(v);
}
const assertInert = (result, label) => {
  for (const record of result.records) for (const text of strings([record.observed, record.expected, record.detail])) assert.equal(isUnsafe(text), false, `${label}: ${record.checkId} carries a raw control or bidi character: ${JSON.stringify(text)}`);
};

test("W1-SEC-L1: hostile fragment text never reaches a result record as a raw control, bidi or ANSI character", async () => {
  const subject = makeSubject();
  const fragment = "%0A%E2%80%AEevil%00%1B[31m";
  const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, ["docs/a.md"]), policy: basePolicy(), reader: fakeReader({ "docs/a.md": `[x](#${fragment})\n[y](b.md#${fragment})\n`, "docs/b.md": "# B\n" }) });
  const anchors = r.records.find((x) => x.checkId === "1B.MARKDOWN.ANCHORS");
  assert.equal(anchors.status, "FAIL");
  assert.match(anchors.observed.findings[0], /\\u000a\\u202eevil\\u0000\\u001b\[31m/, "still diagnosable, as visible escapes");
  assertInert(r, "fragment");
});

test("W1-SEC-L1: link, ID and path text is sanitized on every record path", async () => {
  const subject = makeSubject();
  const evilPath = `docs/${String.fromCharCode(0x202e)}evil${String.fromCharCode(0x200b)}.md`;
  const family = { family: "TB", prefix: "TB-", segments: [{ minDigits: 2, maxDigits: 3 }], separator: "-", definitionSources: ["docs/**"], definitionContexts: ["HEADING"], ignoreContexts: [] };
  const policy = basePolicy({ markdown: { filePatterns: ["**/*.md"], idFamilies: [family] } });
  const doc = "# TB-01 x\n\n[gone](missing%E2%80%AE.md) [ctl](a%0Ab.md) [lab][%1Bx] TB-1 TB-7777 TB-99\n";
  const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, [evilPath]), policy, reader: fakeReader({ [evilPath]: doc }) });
  assertInert(r, "1B");
  assert.ok(r.records.some((x) => x.status === "FAIL"), "the hostile document produced findings");
  const scope = await g.checkScope({ subject, changedFiles: changedResult(subject, [evilPath]), policy: basePolicy({ scope: { allowedPathDomains: ["src/**"], forbiddenPathDomains: [], protectedPaths: [] } }) });
  assertInert(scope, "scope");
  const scan = await g.scanSecrets({ subject, changedFiles: changedResult(subject, [evilPath]), policy: basePolicy(), reader: fakeReader({ [evilPath]: `x gh${"p_"}${"Q".repeat(36)}\n` }), now: "2026-09-25" });
  assertInert(scan, "secrets");
  assert.equal(scan.records[0].status, "FAIL");
});

// ------------------------------------------------------------- W1-DEV-L1

const TABLE = "| a | b |\n|---|---|\n| 1 | 2 |\n";
const rows = (text) => {
  const s = parse(text);
  assert.equal(s.ok, true);
  return s.tables[0];
};

test("W1-DEV-L1: a table ends before a list item, thematic break or HTML block (and only there)", () => {
  const enders = ["- item", "* item", "+ item", "1. item", "123. item", "1) item", "-", "***", "---", "___", "* * *", "- - -", "<div>", "<div class=\"x\">x</div>", "<details>", "</div>", "<table>", "<!-- c -->", "<pre>", "<script>", "<br>", "<hr>"];
  for (const line of enders) {
    const t = rows(`${TABLE}${line}\n`);
    assert.deepEqual([...t.problems], [], `table must end before ${JSON.stringify(line)}`);
    assert.equal(t.rows.length, 1, `${JSON.stringify(line)} is not a table row`);
  }
  // Blank line, heading, fence and blockquote still end it (unchanged).
  for (const line of ["", "## H", "```", "> q"]) assert.equal(rows(`${TABLE}${line}\n`).rows.length, 1, JSON.stringify(line));
});

test("W1-DEV-L1: legitimate row content that merely resembles a block start stays a table row", () => {
  const lookalikes = ["-5 | x", "+1 | q", "**bold** | y", "1.5 | z", "*emph* | z", "<b>x</b> | y", "a | <br> b", "--- | ---"];
  for (const line of lookalikes) {
    const t = rows(`${TABLE}${line}\n`);
    assert.equal(t.rows.length, 2, `${JSON.stringify(line)} must remain a body row`);
  }
  // A plain paragraph line directly under a table IS a row in GFM, so it is still reported.
  const paragraph = rows(`${TABLE}just text\n`);
  assert.deepEqual(paragraph.problems.map((p) => p.kind), ["CARDINALITY"]);
});

test("W1-DEV-L1: the real table defect in the merged design document is still detected (not hidden)", () => {
  const doc = fs.readFileSync(nodePath.join(__dirname, "..", "..", "docs", "gov-auto-1-design-reconciliation-v1.md"), "utf8");
  const s = parse(doc);
  assert.equal(s.ok, true);
  const bad = s.tables.flatMap((t) => t.problems.map((p) => p.line));
  assert.ok(bad.some((line) => line >= 1172 && line <= 1177), `expected the known defect near lines 1172-1177, got ${JSON.stringify(bad)}`);
});

// ------------------------------------------------------------- W1-DEV-L2

const linkResult = async (docPath, dest, files = {}) => {
  const subject = makeSubject();
  const r = await g.checkReferences({ subject, changedFiles: changedResult(subject, [docPath]), policy: basePolicy(), reader: fakeReader({ [docPath]: `[x](${dest})\n`, "README.md": "# R\n", ...files }) });
  const links = r.records.find((x) => x.checkId === "1B.MARKDOWN.LINKS");
  return `${links.status}/${links.reasonCode}`;
};

test("W1-DEV-L2: the repository root is a valid in-repository link target", async () => {
  for (const dest of ["../", "..", "/", ".", "./", "../#top", "../."]) assert.equal(await linkResult("docs/a.md", dest), "PASS/OK", dest);
  assert.equal(await linkResult("a.md", "."), "PASS/OK");
  assert.equal(await linkResult("a.md", "./"), "PASS/OK");
  assert.equal(await linkResult("docs/deep/a.md", "../../"), "PASS/OK", "two levels up from docs/deep is the root");
});

test("W1-DEV-L2: real upward escapes above the root still fail closed", async () => {
  for (const dest of ["../../", "../../../x", "../../x.md", "%2e%2e/%2e%2e/", "../../.."]) assert.equal(await linkResult("docs/a.md", dest), "FAIL/LINK_ESCAPES_ROOT", dest);
  // docs/../../x from docs/a.md resolves to x INSIDE the root (docs/docs/../../x): a missing file, not an escape.
  assert.equal(await linkResult("docs/a.md", "docs/../../x"), "FAIL/LINK_TARGET_MISSING");
  assert.equal(await linkResult("a.md", "../"), "FAIL/LINK_ESCAPES_ROOT", "a root-level document cannot go above the root");
  assert.equal(await linkResult("a.md", ".."), "FAIL/LINK_ESCAPES_ROOT");
  assert.equal(await linkResult("docs/a.md", "../missing.md"), "FAIL/LINK_TARGET_MISSING", "a missing in-root file is still missing");
});
