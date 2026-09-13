"use strict";

/**
 * Roadmap RTI-7B (Jira Reference Requirements Provider): unit coverage for
 * scripts/ai/providers/jira-requirements-provider.js.
 *
 * TEST TRANSPORT STRATEGY (deliberately chosen, documented per the module's
 * own docstring): the public JiraRequirementsProvider config is data-only -
 * it accepts no executable fetch/transport callback, so it cannot be
 * "injected" with a test double the way some libraries allow. Instead,
 * every test in this file starts a real local plain-HTTP server (Node's
 * built-in `http`, zero new dependency) and installs a narrow, temporary
 * replacement of the process-global `fetch` that rewrites only the
 * request's ORIGIN (from the provider's configured `https://...` baseUrl
 * to `http://127.0.0.1:<port>`) before delegating to the real, original
 * `fetch` - method, headers, `redirect`, and `signal` all pass through
 * completely unchanged. This exercises the REAL production code path (URL
 * construction, Basic-auth header construction, pagination loop, timeout/
 * retry behavior, JSON parsing) over a real loopback HTTP connection,
 * without requiring a brittle self-signed-certificate HTTPS test server.
 * The replacement is installed and restored per test (via `after`/`finally`
 * with the original `fetch` saved first) - global state never leaks
 * between tests.
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { JiraRequirementsProvider } = require("./jira-requirements-provider");
const { loadRequirementsFromProvider } = require("../requirements-source-provider");

// --- test infrastructure ---------------------------------------------------

function startMockServer(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => handler(req, res));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

let activeRestore = null;
function proxyFetchTo(port) {
  const originalFetch = global.fetch;
  global.fetch = (url, options) => {
    const parsed = new URL(url);
    const proxied = `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
    return originalFetch(proxied, options);
  };
  activeRestore = () => {
    global.fetch = originalFetch;
    activeRestore = null;
  };
  return activeRestore;
}

after(() => {
  // Safety net: guarantee global.fetch is never left patched if a test
  // throws before reaching its own restore call.
  if (activeRestore) activeRestore();
});

async function withServer(handler, fn) {
  const { server, port } = await startMockServer(handler);
  const restore = proxyFetchTo(port);
  try {
    return await fn(port);
  } finally {
    restore();
    await closeServer(server);
  }
}

function respondJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(payload);
}

function makeConfig(overrides = {}) {
  return {
    id: "jira-test",
    baseUrl: "https://example.atlassian.net",
    email: "bot@example.com",
    apiToken: "test-token-abc",
    jql: "project = PROJ ORDER BY key ASC",
    timeoutMs: 2000,
    ...overrides,
  };
}

function makeIssue(key, fieldOverrides = {}) {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      description: null,
      issuetype: { name: "Story" },
      priority: { name: "High" },
      labels: [],
      issuelinks: [],
      updated: "2026-01-01T00:00:00.000Z",
      status: { name: "In Progress" },
      ...fieldOverrides,
    },
  };
}

function searchPayload(issues, startAt, total, maxResults = 50) {
  return { startAt, maxResults, total, issues };
}

function paragraph(text) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function adfDoc(...blocks) {
  return { type: "doc", version: 1, content: blocks };
}

// --- config validation (§9-10) ---------------------------------------------

test("RTI-7B config: valid config constructs successfully, provider.id matches", () => {
  const provider = new JiraRequirementsProvider(makeConfig());
  assert.equal(provider.id, "jira-test");
});

test("RTI-7B config: missing/invalid id rejects", () => {
  for (const bad of [undefined, "", 123, "bad\ncontrolchar", "x".repeat(201)]) {
    assert.throws(() => new JiraRequirementsProvider(makeConfig({ id: bad })), /JIRA_PROVIDER_CONFIG_INVALID/);
  }
});

test("RTI-7B config (§12): baseUrl must be https, absolute, no embedded credentials, no query/fragment", () => {
  const invalid = [
    "http://example.atlassian.net",
    "ftp://example.atlassian.net",
    "not a url",
    "https://user:pass@example.atlassian.net",
    "https://example.atlassian.net?x=1",
    "https://example.atlassian.net#frag",
    "",
    undefined,
    123,
  ];
  for (const bad of invalid) {
    assert.throws(() => new JiraRequirementsProvider(makeConfig({ baseUrl: bad })), /JIRA_PROVIDER_CONFIG_INVALID/, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("RTI-7B config: baseUrl trailing slash is normalized", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([], 0, 0)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ baseUrl: "https://example.atlassian.net/" }));
      const result = await provider.read();
      assert.deepEqual(result, []);
    }
  );
});

test("RTI-7B config: email/apiToken/jql validation", () => {
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ email: "not-an-email" })), /JIRA_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ email: "" })), /JIRA_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ apiToken: "" })), /JIRA_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ apiToken: undefined })), /JIRA_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ jql: "" })), /JIRA_PROVIDER_CONFIG_INVALID/);
});

test("RTI-7B config: maxItems validation", () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, "100", 999999]) {
    assert.throws(() => new JiraRequirementsProvider(makeConfig({ maxItems: bad })), /JIRA_PROVIDER_CONFIG_INVALID/, `expected rejection for maxItems=${bad}`);
  }
});

test("RTI-7B config: timeoutMs validation", () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, "1000"]) {
    assert.throws(() => new JiraRequirementsProvider(makeConfig({ timeoutMs: bad })), /JIRA_PROVIDER_CONFIG_INVALID/, `expected rejection for timeoutMs=${bad}`);
  }
});

test("RTI-7B config: fieldMap validation", () => {
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ fieldMap: "not an object" })), /JIRA_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ fieldMap: { unknownKey: "x" } })), /JIRA_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "" } })), /JIRA_PROVIDER_CONFIG_INVALID/);
  assert.doesNotThrow(() => new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_1" } })));
});

// --- auth header (§74) ------------------------------------------------------

test("RTI-7B (§74): request carries correct HTTP Basic auth header", async () => {
  let capturedAuth;
  await withServer(
    (req, res) => {
      capturedAuth = req.headers.authorization;
      respondJson(res, 200, searchPayload([], 0, 0));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ email: "bot@example.com", apiToken: "secret-token-xyz" }));
      await provider.read();
    }
  );
  const expected = `Basic ${Buffer.from("bot@example.com:secret-token-xyz", "utf8").toString("base64")}`;
  assert.equal(capturedAuth, expected);
});

// --- redirects (§75) --------------------------------------------------------

test("RTI-7B (§75): a 3xx redirect response fails closed, no second-host request occurs", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(302, { Location: "https://evil.example.com/steal" });
      res.end();
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /redirect/i);
    }
  );
  assert.equal(requestCount, 1, "no retry/follow-up request should occur for a redirect");
});

// --- timeout (§76) -----------------------------------------------------------

test("RTI-7B (§76): a request exceeding timeoutMs fails with a bounded error", async () => {
  await withServer(
    (req, res) => {
      setTimeout(() => respondJson(res, 200, searchPayload([], 0, 0)), 400);
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ timeoutMs: 50 }));
      await assert.rejects(() => provider.read(), /Jira request failed/);
    }
  );
});

// --- 429 retry with Retry-After (§77) ---------------------------------------

test("RTI-7B (§77): a 429 response with Retry-After retries and succeeds", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.writeHead(429, { "Retry-After": "0" });
        res.end();
        return;
      }
      respondJson(res, 200, searchPayload([makeIssue("PROJ-1")], 0, 1));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.equal(result.length, 1);
    }
  );
  assert.equal(requestCount, 2);
});

// --- 401 no-retry (§78) ------------------------------------------------------

test("RTI-7B (§78): a 401 response fails immediately, no retry", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(401);
      res.end();
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /401/);
    }
  );
  assert.equal(requestCount, 1);
});

test("RTI-7B (§25): a 403 response fails immediately, no retry", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(403);
      res.end();
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /403/);
    }
  );
  assert.equal(requestCount, 1);
});

// --- 5xx retry (§79) ---------------------------------------------------------

test("RTI-7B (§79): a transient 503 then success retries and succeeds", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.writeHead(503);
        res.end();
        return;
      }
      respondJson(res, 200, searchPayload([makeIssue("PROJ-1")], 0, 1));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.equal(result.length, 1);
    }
  );
  assert.equal(requestCount, 2);
});

test("RTI-7B (§79/§22): a permanent 500 fails after exactly 3 total attempts", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(500);
      res.end();
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /3 attempt\(s\)/);
    }
  );
  assert.equal(requestCount, 3);
});

// --- malformed JSON / response shape (§80-81) -------------------------------

test("RTI-7B (§80): malformed JSON body fails closed, no raw body leaked", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not valid json {{{");
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      try {
        await provider.read();
        assert.fail("expected rejection");
      } catch (err) {
        assert.match(err.message, /not valid JSON/);
        assert.equal(err.message.includes("{{{"), false);
      }
    }
  );
});

test("RTI-7B (§81): malformed response shapes all fail deterministically", async () => {
  const malformedBodies = [
    {},
    { issues: null, startAt: 0, maxResults: 50, total: 0 },
    { issues: {}, startAt: 0, maxResults: 50, total: 0 },
    { issues: [{ fields: {} }], startAt: 0, maxResults: 50, total: 1 }, // missing key
    { issues: [{ key: "PROJ-1" }], startAt: 0, maxResults: 50, total: 1 }, // missing fields
    { issues: [], startAt: "0", maxResults: 50, total: 0 }, // invalid pagination field type
  ];
  for (const body of malformedBodies) {
    await withServer(
      (req, res) => respondJson(res, 200, body),
      async () => {
        const provider = new JiraRequirementsProvider(makeConfig());
        await assert.rejects(() => provider.read(), undefined, `expected rejection for ${JSON.stringify(body)}`);
      }
    );
  }
});

// --- pagination (§82) --------------------------------------------------------

test("RTI-7B (§82): multi-page results are collected completely, deduplicated by key, in canonical key order", async () => {
  const totalIssues = 120; // 3 pages at the provider's internal 50-per-page size
  const allIssues = Array.from({ length: totalIssues }, (_, i) => makeIssue(`PROJ-${i + 1}`));
  await withServer(
    (req, res) => {
      const url = new URL(req.url, "http://localhost");
      const startAt = Number(url.searchParams.get("startAt"));
      const page = allIssues.slice(startAt, startAt + 50);
      respondJson(res, 200, searchPayload(page, startAt, totalIssues));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ maxItems: 200 }));
      const result = await provider.read();
      assert.equal(result.length, totalIssues);
      assert.deepEqual(result.map((r) => r.source.sourceId).slice(0, 5), ["PROJ-1", "PROJ-2", "PROJ-3", "PROJ-4", "PROJ-5"]);
      assert.equal(result[result.length - 1].source.sourceId, "PROJ-120");
      // Numeric-suffix ordering: PROJ-2 before PROJ-10, not lexical "PROJ-10" before "PROJ-2".
      const idx2 = result.findIndex((r) => r.source.sourceId === "PROJ-2");
      const idx10 = result.findIndex((r) => r.source.sourceId === "PROJ-10");
      assert.ok(idx2 < idx10);
    }
  );
});

test("RTI-7B (§30): pagination that fails to advance aborts with a bounded loop-safety error", async () => {
  // Simulates a misbehaving server that always echoes startAt:0 regardless
  // of the requested startAt, with a total the first two (non-empty,
  // advancing) fetches never reach - the loop's own computed `startAt`
  // (payload.startAt + issues.length) repeats on the third iteration,
  // which must trip the progress guard rather than spin forever.
  const twoIssues = [makeIssue("PROJ-1"), makeIssue("PROJ-2")];
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload(twoIssues, 0, 10)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /did not advance/);
    }
  );
});

// --- maxItems (§83) ----------------------------------------------------------

test("RTI-7B (§83): a remote total exceeding maxItems rejects the whole read, no partial result", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1")], 0, 500)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ maxItems: 100 }));
      await assert.rejects(() => provider.read(), /exceeds the configured maxItems bound/);
    }
  );
});

test("RTI-7B: partial-page failure rejects the whole read atomically (§33)", async () => {
  let requestCount = 0;
  const page1 = Array.from({ length: 50 }, (_, i) => makeIssue(`PROJ-${i + 1}`));
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        respondJson(res, 200, searchPayload(page1, 0, 150));
        return;
      }
      res.writeHead(500);
      res.end();
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ maxItems: 200 }));
      await assert.rejects(() => provider.read());
    }
  );
});

// --- ADF fixtures (§84-85) ---------------------------------------------------

test("RTI-7B ADF (§84): empty document yields no content field (genuinely absent, not empty string)", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc() })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal("content" in artifact, false);
    }
  );
});

test("RTI-7B ADF (§84): single paragraph converts to plain text", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(paragraph("Hello world.")) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Hello world.");
    }
  );
});

test("RTI-7B ADF (§84): multiple paragraphs are joined with a blank line", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(paragraph("First."), paragraph("Second.")) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "First.\n\nSecond.");
    }
  );
});

test("RTI-7B ADF (§84): heading plus paragraph both appear as separate blocks", async () => {
  const heading = { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(heading, paragraph("Body.")) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Title\n\nBody.");
    }
  );
});

test("RTI-7B ADF (§84): bullet list items are joined with single newlines", async () => {
  const bulletList = {
    type: "bulletList",
    content: [
      { type: "listItem", content: [paragraph("Item 1")] },
      { type: "listItem", content: [paragraph("Item 2")] },
    ],
  };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(bulletList) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Item 1\nItem 2");
    }
  );
});

test("RTI-7B ADF (§84): nested inline text runs (marks) join with no inserted spaces", async () => {
  const para = { type: "paragraph", content: [{ type: "text", text: "Bold ", marks: [{ type: "strong" }] }, { type: "text", text: "and normal." }] };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(para) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Bold and normal.");
    }
  );
});

test("RTI-7B ADF (§84): an unrecognized wrapper node is recursed into gracefully", async () => {
  const panel = { type: "panel", attrs: { panelType: "info" }, content: [paragraph("Note text.")] };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(panel) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Note text.");
    }
  );
});

test("RTI-7B ADF (§85): a malformed (non-doc-shaped) description fails closed", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: { unexpected: "shape" } })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /not a recognized ADF document/);
    }
  );
});

// --- acceptance criteria (§86) -----------------------------------------------

test("RTI-7B AC (§86): fieldMap absent -> no acceptanceCriteria", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1")], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal("acceptanceCriteria" in artifact, false);
    }
  );
});

test("RTI-7B AC (§86): configured plain-text field -> one AC entry without id", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: "Given X, when Y, then Z." })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.acceptanceCriteria, [{ text: "Given X, when Y, then Z." }]);
    }
  );
});

test("RTI-7B AC (§86): configured ADF field -> deterministic plain-text AC", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: adfDoc(paragraph("Criteria text.")) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.acceptanceCriteria, [{ text: "Criteria text." }]);
    }
  );
});

test("RTI-7B AC (§86): configured field missing/null -> no AC (not an error)", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: null })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      const [artifact] = await provider.read();
      assert.equal("acceptanceCriteria" in artifact, false);
    }
  );
});

test("RTI-7B AC (§86): invalid configured field shape fails closed", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: 12345 })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      await assert.rejects(() => provider.read(), /not a recognized ADF document/);
    }
  );
});

test("RTI-7B AC: criterion ids are never fabricated", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: "One text criterion." })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      const [artifact] = await provider.read();
      assert.equal("id" in artifact.acceptanceCriteria[0], false);
    }
  );
});

// --- type mapping ------------------------------------------------------------

test("RTI-7B type mapping: Story/Bug/Risk/Requirement map, unknown types map to other", async () => {
  const issues = [
    makeIssue("PROJ-1", { issuetype: { name: "Story" } }),
    makeIssue("PROJ-2", { issuetype: { name: "Bug" } }),
    makeIssue("PROJ-3", { issuetype: { name: "Risk" } }),
    makeIssue("PROJ-4", { issuetype: { name: "Requirement" } }),
    makeIssue("PROJ-5", { issuetype: { name: "Epic" } }),
    makeIssue("PROJ-6", { issuetype: { name: "Task" } }),
  ];
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload(issues, 0, issues.length)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const result = await provider.read();
      const byKey = Object.fromEntries(result.map((a) => [a.source.sourceId, a.type]));
      assert.equal(byKey["PROJ-1"], "user-story");
      assert.equal(byKey["PROJ-2"], "bug");
      assert.equal(byKey["PROJ-3"], "risk");
      assert.equal(byKey["PROJ-4"], "requirement");
      assert.equal(byKey["PROJ-5"], "other");
      assert.equal(byKey["PROJ-6"], "other");
    }
  );
});

// --- relationships -----------------------------------------------------------

test("RTI-7B relationships: blocks/blocked-by direction, duplicate, related all map correctly; unknown link type omitted", async () => {
  const issue = makeIssue("PROJ-1", {
    issuelinks: [
      { type: { name: "Blocks" }, outwardIssue: { key: "PROJ-2" } },
      { type: { name: "Blocks" }, inwardIssue: { key: "PROJ-3" } },
      { type: { name: "Duplicate" }, outwardIssue: { key: "PROJ-4" } },
      { type: { name: "Relates" }, outwardIssue: { key: "PROJ-5" } },
      { type: { name: "Cloners" }, outwardIssue: { key: "PROJ-6" } }, // unmapped, omitted
    ],
  });
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.relationships, [
        { type: "blocks", targetId: "jira-test:PROJ-2" },
        { type: "blocked-by", targetId: "jira-test:PROJ-3" },
        { type: "duplicate", targetId: "jira-test:PROJ-4" },
        { type: "related", targetId: "jira-test:PROJ-5" },
      ]);
    }
  );
});

test("RTI-7B relationships: malformed issuelinks entry fails closed", async () => {
  const issue = makeIssue("PROJ-1", { issuelinks: [{ type: { name: "Blocks" }, outwardIssue: { key: "PROJ-2" }, inwardIssue: { key: "PROJ-3" } }] });
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /exactly one of inwardIssue\/outwardIssue/);
    }
  );
});

test("RTI-7B relationships: out-of-snapshot target is not rejected merely because it wasn't returned by this read", async () => {
  const issue = makeIssue("PROJ-1", { issuelinks: [{ type: { name: "Relates" }, outwardIssue: { key: "PROJ-999" } }] });
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.relationships, [{ type: "related", targetId: "jira-test:PROJ-999" }]);
    }
  );
});

// --- provenance (§87) ---------------------------------------------------------

test("RTI-7B (§87): source provenance fields are exact", async () => {
  const issue = makeIssue("PROJ-1", { updated: "2026-03-05T12:00:00.000Z" });
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ id: "jira-prod" }));
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.source, {
        type: "jira",
        sourceId: "PROJ-1",
        system: "example.atlassian.net",
        location: "https://example.atlassian.net/browse/PROJ-1",
        version: "2026-03-05T12:00:00.000Z",
      });
    }
  );
});

// --- identity stability (§88-91) ----------------------------------------------

test("RTI-7B (§88): identity is stable across timeoutMs/maxItems/page-size-irrelevant config changes", async () => {
  const issue = makeIssue("PROJ-1");
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue], 0, 1)),
    async () => {
      const providerA = new JiraRequirementsProvider(makeConfig({ timeoutMs: 1000, maxItems: 50 }));
      const providerB = new JiraRequirementsProvider(makeConfig({ timeoutMs: 5000, maxItems: 500 }));
      const [a] = await providerA.read();
      const [b] = await providerB.read();
      assert.equal(a.id, b.id);
    }
  );
});

test("RTI-7B (§89): content update changes content/version, id stays stable", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { summary: "Old summary", updated: "2026-01-01T00:00:00.000Z" })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [before] = await provider.read();
      assert.equal(before.id, "jira-test:PROJ-1");
      assert.equal(before.title, "Old summary");
      assert.equal(before.source.version, "2026-01-01T00:00:00.000Z");
    }
  );

  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { summary: "New summary", updated: "2026-02-01T00:00:00.000Z" })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [after] = await provider.read();
      assert.equal(after.id, "jira-test:PROJ-1");
      assert.equal(after.title, "New summary");
      assert.equal(after.source.version, "2026-02-01T00:00:00.000Z");
    }
  );
});

test("RTI-7B (§90): changing provider.id changes the normalized artifact id prefix (intentional)", async () => {
  const issue = makeIssue("PROJ-1");
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue], 0, 1)),
    async () => {
      const providerProd = new JiraRequirementsProvider(makeConfig({ id: "jira-prod" }));
      const providerStaging = new JiraRequirementsProvider(makeConfig({ id: "jira-staging" }));
      const [a] = await providerProd.read();
      const [b] = await providerStaging.read();
      assert.equal(a.id, "jira-prod:PROJ-1");
      assert.equal(b.id, "jira-staging:PROJ-1");
      assert.notEqual(a.id, b.id);
    }
  );
});

test("RTI-7B (§91): two provider instances with the same native key produce collision-safe distinct ids", async () => {
  const issue = makeIssue("PROJ-123");
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue], 0, 1)),
    async () => {
      const prod = new JiraRequirementsProvider(makeConfig({ id: "jira-prod" }));
      const staging = new JiraRequirementsProvider(makeConfig({ id: "jira-staging" }));
      const [a] = await prod.read();
      const [b] = await staging.read();
      assert.deepEqual([a.id, b.id], ["jira-prod:PROJ-123", "jira-staging:PROJ-123"]);
    }
  );
});

// --- RTI-6 integration + full pipeline (§92-94) -------------------------------

test("RTI-7B (§92): RTI-6's loadRequirementsFromProvider accepts the Jira provider directly", async () => {
  await withServer(
    (req, res) =>
      respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { summary: "Login", description: adfDoc(paragraph("Valid credentials return HTTP 200.")) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      assert.equal(requirements.length, 1);
      assert.equal(requirements[0].id, "jira-test:PROJ-1");
      assert.ok(Object.isFrozen(requirements));
    }
  );
});

test("RTI-7B (§93): full RTI-6 -> RTI-3 -> RTI-4 -> RTI-5 pipeline reaches FULLY_COVERED for a READY Jira requirement", async () => {
  const { analyzeRequirementsQuality } = require("../requirement-quality");
  const { generateTestDesigns } = require("../test-design");
  const { buildRequirementTraceability, analyzeRequirementsCoverage } = require("../requirement-traceability");

  await withServer(
    (req, res) =>
      respondJson(
        res,
        200,
        searchPayload([makeIssue("PROJ-1", { summary: "Login", description: adfDoc(paragraph("When valid credentials are supplied, the API returns HTTP 200.")) })], 0, 1)
      ),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      const quality = analyzeRequirementsQuality(requirements);
      assert.equal(quality[0].status, "READY");
      const designs = generateTestDesigns(requirements);
      const links = buildRequirementTraceability(requirements, designs);
      const [coverage] = analyzeRequirementsCoverage(requirements, designs);
      assert.equal(links.length, 1);
      assert.equal(coverage.status, "FULLY_COVERED");
    }
  );
});

test("RTI-7B (§94): a Jira requirement with vague text ingests successfully - RTI-3 classifies it downstream, the adapter does not judge quality", async () => {
  const { analyzeRequirementQuality } = require("../requirement-quality");
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { summary: "Performance", description: adfDoc(paragraph("The page should load quickly.")) })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      assert.equal(requirements.length, 1);
      assert.equal(analyzeRequirementQuality(requirements[0]).status, "AMBIGUOUS");
    }
  );
});

// --- error / secret safety (§37-38) -------------------------------------------

test("RTI-7B error safety: no adapter-thrown error ever contains the apiToken, email, or jql", async () => {
  const secretToken = "SUPER-SECRET-TOKEN-VALUE";
  const secretJql = "project = PROJ AND reporter = 'internal-secret-user'";
  await withServer(
    (req, res) => {
      res.writeHead(500);
      res.end();
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ apiToken: secretToken, jql: secretJql }));
      try {
        await provider.read();
        assert.fail("expected rejection");
      } catch (err) {
        assert.equal(err.message.includes(secretToken), false);
        assert.equal(err.message.includes(secretJql), false);
        assert.equal(err.message.toLowerCase().includes("authorization"), false);
      }
    }
  );
});

test("RTI-7B error safety: HTTP error responses never leak the raw response body", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ errorMessages: ["SENSITIVE_INTERNAL_DETAIL"] }));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      try {
        await provider.read();
        assert.fail("expected rejection");
      } catch (err) {
        assert.equal(err.message.includes("SENSITIVE_INTERNAL_DETAIL"), false);
      }
    }
  );
});

// --- metadata / raw payload (§61) ---------------------------------------------

test("RTI-7B: metadata is selective and bounded, raw issue is never stored", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { issuetype: { name: "Story" }, status: { name: "Done" } })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.metadata, { issueType: "Story", status: "Done" });
      assert.equal(JSON.stringify(artifact).includes("fields"), false);
    }
  );
});

// --- priority / labels ---------------------------------------------------------

test("RTI-7B: priority and labels are source-provided values, deduplicated", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { priority: { name: "Critical" }, labels: ["a", "b", "a"] })], 0, 1)),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.priority, "Critical");
      assert.deepEqual(artifact.labels, ["a", "b"]);
    }
  );
});
