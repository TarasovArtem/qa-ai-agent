"use strict";

/**
 * Roadmap RTI-7B (Jira Reference Requirements Provider), CORRECTIVE C1:
 * unit coverage for scripts/ai/providers/jira-requirements-provider.js.
 *
 * C1 migrates production from the removed legacy `GET /rest/api/3/search`
 * endpoint to the current enhanced `POST /rest/api/3/search/jql` endpoint
 * and its `nextPageToken`-based pagination, and closes two independently
 * discovered robustness gaps (silent-truncation on an anomalous empty page,
 * and unbounded ADF recursion). This file's mock-server handlers now read
 * the JSON request BODY (jql/nextPageToken/fields) rather than URL query
 * parameters, since the request itself moved from GET+query-string to
 * POST+JSON-body.
 *
 * TEST TRANSPORT STRATEGY (unchanged from the original implementation,
 * re-affirmed by RTI-7C's own independent review as safe): every test
 * starts a real local plain-HTTP server (Node's built-in `http`) and
 * installs a narrow, temporary replacement of the process-global `fetch`
 * that rewrites only the request's ORIGIN (from the provider's configured
 * `https://...` baseUrl to `http://127.0.0.1:<port>`) before delegating to
 * the real, original `fetch` - method, headers, body, `redirect`, and
 * `signal` all pass through completely unchanged. Restored per test via
 * `finally`, with an `after`-hook safety net. The server/proxy mechanism
 * itself (Roadmap RTI-8E1) is shared with the Azure DevOps requirements
 * provider's own test suite via test/helpers/http-test-server.js - this
 * file remains entirely responsible for its own Jira-shaped mock payloads
 * and assertions; the shared module knows nothing about Jira/JQL/ADF.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { JiraRequirementsProvider } = require("./jira-requirements-provider");
const { loadRequirementsFromProvider } = require("../requirements-source-provider");
const { withServer, respondJson } = require("../../../test/helpers/http-test-server");

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

// CORRECTIVE C1: enhanced-search response shape - issues[] plus an
// optional opaque nextPageToken. No startAt/maxResults/total.
function searchPayload(issues, nextPageToken) {
  const payload = { issues };
  if (nextPageToken !== undefined) payload.nextPageToken = nextPageToken;
  return payload;
}

function paragraph(text) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function adfDoc(...blocks) {
  return { type: "doc", version: 1, content: blocks };
}

// --- config validation (unchanged by C1) ------------------------------------

test("RTI-7B config: valid config constructs successfully, provider.id matches", () => {
  const provider = new JiraRequirementsProvider(makeConfig());
  assert.equal(provider.id, "jira-test");
});

test("RTI-7B config: missing/invalid id rejects", () => {
  for (const bad of [undefined, "", 123, "bad\ncontrolchar", "x".repeat(201)]) {
    assert.throws(() => new JiraRequirementsProvider(makeConfig({ id: bad })), /JIRA_PROVIDER_CONFIG_INVALID/);
  }
});

test("RTI-7B config: baseUrl must be https, absolute, no embedded credentials, no query/fragment", () => {
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
    (req, res) => respondJson(res, 200, searchPayload([])),
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

test("RTI-7I-A (closes Jira/Azure config-strictness parity gap): unknown top-level config keys are rejected at construction", () => {
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ typoTimeout: 10000 })), /JIRA_PROVIDER_CONFIG_INVALID: unrecognized config key\(s\): typoTimeout/);
  assert.throws(() => new JiraRequirementsProvider(makeConfig({ extra1: "a", extra2: "b" })), /JIRA_PROVIDER_CONFIG_INVALID: unrecognized config key\(s\): extra1, extra2/);
});

test("RTI-7I-A: unknown-key rejection error never leaks the caller's apiToken or jql, and does not falsely reject on inherited (non-own) properties", () => {
  const secretToken = "SUPER-SECRET-JIRA-TOKEN";
  const secretJql = "project = PROJ AND reporter = 'internal-secret-user'";
  try {
    // eslint-disable-next-line no-new
    new JiraRequirementsProvider(makeConfig({ apiToken: secretToken, jql: secretJql, bogusKey: "x" }));
    assert.fail("expected rejection");
  } catch (err) {
    assert.match(err.message, /unrecognized config key\(s\): bogusKey/);
    assert.equal(err.message.includes(secretToken), false);
    assert.equal(err.message.includes(secretJql), false);
  }

  // A plain config object (real Object.prototype in its chain, satisfying
  // the pre-existing isPlainDataObject check) must NOT be falsely rejected
  // merely because an INHERITED (not own) enumerable property is reachable
  // through its prototype chain - Object.keys() (own-enumerable-only) is
  // used, not a for...in-style walk that would also see inherited keys.
  const sentinelKey = "__rti7ia_inherited_sentinel__";
  Object.defineProperty(Object.prototype, sentinelKey, { value: "should not matter", enumerable: true, configurable: true });
  try {
    const config = makeConfig();
    assert.ok(sentinelKey in config, "sanity check: the sentinel must be reachable via property access");
    assert.equal(Object.keys(config).includes(sentinelKey), false, "sanity check: Object.keys() must not report the inherited sentinel as an own key");
    assert.doesNotThrow(() => new JiraRequirementsProvider(config));
  } finally {
    delete Object.prototype[sentinelKey];
  }
});

test("RTI-7I-A: documented full valid config (matching the README example shape) still constructs successfully - no backward-compatibility regression", () => {
  assert.doesNotThrow(() =>
    new JiraRequirementsProvider({
      id: "company-jira-prod",
      baseUrl: "https://company.atlassian.net",
      email: "bot@company.com",
      apiToken: "token-value",
      jql: "project = PROJ AND type = Story ORDER BY key ASC",
      fieldMap: { acceptanceCriteria: "customfield_12345" },
      maxItems: 1000,
      timeoutMs: 10000,
    })
  );
});

// --- CORRECTIVE C1: enhanced endpoint / request contract --------------------

test("RTI-7B-C1: request uses POST /rest/api/3/search/jql with jql in the JSON body, not the URL", async () => {
  let capturedPath, capturedMethod, capturedContentType, capturedBody;
  await withServer(
    (req, res) => {
      capturedPath = req.url;
      capturedMethod = req.method;
      capturedContentType = req.headers["content-type"];
      capturedBody = req.jsonBody;
      respondJson(res, 200, searchPayload([]));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ jql: "project = SECRET_PROJECT" }));
      await provider.read();
    }
  );
  assert.equal(capturedMethod, "POST");
  assert.equal(capturedPath, "/rest/api/3/search/jql");
  assert.equal(capturedPath.includes("SECRET_PROJECT"), false, "jql must not appear in the request URL/path");
  assert.match(capturedContentType, /application\/json/);
  assert.equal(capturedBody.jql, "project = SECRET_PROJECT");
  assert.equal(capturedBody.maxResults, 50);
  assert.equal("startAt" in capturedBody, false);
});

test("RTI-7B-C1: production source contains no reference to the removed legacy /rest/api/3/search endpoint path", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "jira-requirements-provider.js"), "utf8");
  // The only permitted mentions are inside corrective-history prose
  // explaining what was migrated AWAY from - never a literal usable path
  // constant/string used as an actual request target.
  assert.equal(/["'`]\/rest\/api\/3\/search["'`]/.test(source), false, 'the bare legacy path string "/rest/api/3/search" (as an actual path literal) must not appear');
  assert.match(source, /\/rest\/api\/3\/search\/jql/, "the enhanced search endpoint path must be present");
});

// --- CORRECTIVE C1: token pagination ----------------------------------------

test("RTI-7B-C1: multi-page token pagination collects all issues across 3 pages, sends the correct token each request", async () => {
  const page1 = Array.from({ length: 50 }, (_, i) => makeIssue(`PROJ-${i + 1}`));
  const page2 = Array.from({ length: 50 }, (_, i) => makeIssue(`PROJ-${i + 51}`));
  const page3 = Array.from({ length: 20 }, (_, i) => makeIssue(`PROJ-${i + 101}`));
  const tokensSent = [];
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      tokensSent.push(req.jsonBody.nextPageToken);
      if (requestCount === 1) return respondJson(res, 200, searchPayload(page1, "token-A"));
      if (requestCount === 2) return respondJson(res, 200, searchPayload(page2, "token-B"));
      return respondJson(res, 200, searchPayload(page3)); // terminal, no token
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ maxItems: 200 }));
      const result = await provider.read();
      assert.equal(result.length, 120);
      assert.deepEqual(tokensSent, [undefined, "token-A", "token-B"]);
      assert.equal(result[0].source.sourceId, "PROJ-1");
      assert.equal(result[result.length - 1].source.sourceId, "PROJ-120");
    }
  );
  assert.equal(requestCount, 3);
});

test("RTI-7B-C1: a terminal page (no nextPageToken) with issues completes the read", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1")])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.equal(result.length, 1);
    }
  );
});

test("RTI-7B-C1: a terminal empty page (no issues, no nextPageToken) is a valid empty result", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.deepEqual(result, []);
    }
  );
});

// --- CORRECTIVE C1: snapshot-completeness fail-closed guard (the MEDIUM finding) ---

test("RTI-7B-C1 (closes RTI-7C snapshot-completeness MEDIUM): an empty page that still reports nextPageToken fails the whole read closed, never a truncated success", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) return respondJson(res, 200, searchPayload([makeIssue("PROJ-1")], "token-A"));
      // Anomalous: no issues, but still claims there's a next page.
      return respondJson(res, 200, searchPayload([], "token-B"));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /inconsistent remote response as a complete snapshot/);
    }
  );
  assert.equal(requestCount, 2, "the anomaly must be detected only after actually observing it, not guessed in advance");
});

test("RTI-7B-C1: token self-repeat (same token returned twice) fails closed, does not loop", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount > 5) return respondJson(res, 200, searchPayload([], "still-going")); // would spin forever if unguarded
      return respondJson(res, 200, searchPayload([makeIssue(`PROJ-${requestCount}`)], "abc"));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /previously-seen page token/);
    }
  );
  assert.ok(requestCount <= 3, `expected the guard to trip quickly, got ${requestCount} requests`);
});

test("RTI-7B-C1: a longer token cycle (A -> B -> A) fails closed", async () => {
  const tokenSequence = ["A", "B", "A"];
  let requestCount = 0;
  await withServer(
    (req, res) => {
      const token = tokenSequence[requestCount];
      requestCount += 1;
      if (requestCount > 10) return respondJson(res, 200, searchPayload([], "runaway"));
      return respondJson(res, 200, searchPayload([makeIssue(`PROJ-${requestCount}`)], token));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /previously-seen page token/);
    }
  );
  assert.ok(requestCount <= 5, `expected the cycle guard to trip within a few requests, got ${requestCount}`);
});

test("RTI-7B-C1: malformed nextPageToken types fail closed", async () => {
  const malformedTokens = [123, {}, [], true];
  for (const badToken of malformedTokens) {
    await withServer(
      (req, res) => respondJson(res, 200, { issues: [makeIssue("PROJ-1")], nextPageToken: badToken }),
      async () => {
        const provider = new JiraRequirementsProvider(makeConfig());
        await assert.rejects(() => provider.read(), /nextPageToken/, `expected rejection for token ${JSON.stringify(badToken)}`);
      }
    );
  }
});

test("RTI-7B-C1: an empty-string nextPageToken is treated as invalid, not as an alternate terminal signal", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, { issues: [makeIssue("PROJ-1")], nextPageToken: "" }),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /nextPageToken/);
    }
  );
});

// --- CORRECTIVE C1: maxItems cumulative enforcement -------------------------

test("RTI-7B-C1: maxItems is enforced cumulatively across pages, exact boundary (=maxItems succeeds, >maxItems fails)", async () => {
  {
    // current=90 (from a first page), next page=10 -> exactly 100 -> success
    const page1 = Array.from({ length: 90 }, (_, i) => makeIssue(`PROJ-${i + 1}`));
    const page2 = Array.from({ length: 10 }, (_, i) => makeIssue(`PROJ-${i + 91}`));
    let requestCount = 0;
    await withServer(
      (req, res) => {
        requestCount += 1;
        if (requestCount === 1) return respondJson(res, 200, searchPayload(page1, "next"));
        return respondJson(res, 200, searchPayload(page2));
      },
      async () => {
        const provider = new JiraRequirementsProvider(makeConfig({ maxItems: 100 }));
        const result = await provider.read();
        assert.equal(result.length, 100);
      }
    );
  }
  {
    // current=90, next page=11 -> 101 > 100 -> whole read fails, no truncation
    const page1 = Array.from({ length: 90 }, (_, i) => makeIssue(`PROJ-${i + 1}`));
    const page2 = Array.from({ length: 11 }, (_, i) => makeIssue(`PROJ-${i + 91}`));
    let requestCount = 0;
    await withServer(
      (req, res) => {
        requestCount += 1;
        if (requestCount === 1) return respondJson(res, 200, searchPayload(page1, "next"));
        return respondJson(res, 200, searchPayload(page2));
      },
      async () => {
        const provider = new JiraRequirementsProvider(makeConfig({ maxItems: 100 }));
        await assert.rejects(() => provider.read(), /exceeds the configured maxItems bound/);
      }
    );
  }
});

test("RTI-7B-C1 (§48 regression, no silent 75-item truncation): maxItems=75, page1=50+next, page2=30 -> whole read fails", async () => {
  const page1 = Array.from({ length: 50 }, (_, i) => makeIssue(`PROJ-${i + 1}`));
  const page2 = Array.from({ length: 30 }, (_, i) => makeIssue(`PROJ-${i + 51}`));
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) return respondJson(res, 200, searchPayload(page1, "next"));
      return respondJson(res, 200, searchPayload(page2));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ maxItems: 75 }));
      await assert.rejects(() => provider.read(), /exceeds the configured maxItems bound/);
    }
  );
});

// --- retry/timeout/redirect/auth regression (unchanged transport semantics) ---

test("RTI-7B-C1 regression (§74): request carries correct HTTP Basic auth header", async () => {
  let capturedAuth;
  await withServer(
    (req, res) => {
      capturedAuth = req.headers.authorization;
      respondJson(res, 200, searchPayload([]));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ email: "bot@example.com", apiToken: "secret-token-xyz" }));
      await provider.read();
    }
  );
  const expected = `Basic ${Buffer.from("bot@example.com:secret-token-xyz", "utf8").toString("base64")}`;
  assert.equal(capturedAuth, expected);
});

test("RTI-7B-C1 regression (§75): a 3xx redirect response fails closed, no second-host request occurs", async () => {
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
  assert.equal(requestCount, 1);
});

test("RTI-7B-C1 regression (§76): a request exceeding timeoutMs fails with a bounded error", async () => {
  await withServer(
    (req, res) => {
      setTimeout(() => respondJson(res, 200, searchPayload([])), 400);
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ timeoutMs: 50 }));
      await assert.rejects(() => provider.read(), /Jira request failed/);
    }
  );
});

test("RTI-7B-C1 regression (§77): a 429 response with Retry-After retries and succeeds", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.writeHead(429, { "Retry-After": "0" });
        res.end();
        return;
      }
      respondJson(res, 200, searchPayload([makeIssue("PROJ-1")]));
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.equal(result.length, 1);
    }
  );
  assert.equal(requestCount, 2);
});

test("RTI-7B-C1 regression (§78): a 401 response fails immediately, no retry", async () => {
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

test("RTI-7B-C1 regression: a permanent 500 fails after exactly 3 total attempts", async () => {
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

test("RTI-7B-C1 regression: malformed JSON body fails closed, no raw body leaked", async () => {
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

test("RTI-7B-C1 regression: malformed response shapes all fail deterministically", async () => {
  const malformedBodies = [
    {},
    { issues: null },
    { issues: {} },
    { issues: [{ fields: {} }] }, // missing key
    { issues: [{ key: "PROJ-1" }] }, // missing fields
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

test("RTI-7B-C1 regression: partial-page failure rejects the whole read atomically", async () => {
  let requestCount = 0;
  const page1 = Array.from({ length: 50 }, (_, i) => makeIssue(`PROJ-${i + 1}`));
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        respondJson(res, 200, searchPayload(page1, "next"));
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

// --- CORRECTIVE C1: ADF depth bound ------------------------------------------

function nestedPanel(depth, leaf) {
  let node = leaf;
  for (let i = 0; i < depth; i++) {
    node = { type: "panel", content: [node] };
  }
  return node;
}

test("RTI-7B-C1 (closes RTI-7C ADF-resource-safety MEDIUM): ADF nesting at the depth limit succeeds", async () => {
  // adfDocumentToPlainText passes each top-level block in at depth 1, so a
  // block nested `MAX_ADF_DEPTH - 1` panels deep around a text leaf reaches
  // exactly the boundary depth without exceeding it.
  const doc = adfDoc(nestedPanel(62, { type: "text", text: "leaf" }));
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: doc })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "leaf");
    }
  );
});

test("RTI-7B-C1: ADF nesting beyond the depth limit fails cleanly - no RangeError, real HTTP round-trip", async () => {
  // Deliberately well beyond the limit and beyond what JSON.stringify's own
  // recursive serializer could produce in this test process - built via
  // string concatenation (non-recursive) exactly as the independent review
  // did to prove this is a genuine remote-data-boundary risk, not a local
  // test-construction artifact.
  const depth = 5000;
  const open = '{"type":"panel","content":['.repeat(depth);
  const close = "]}".repeat(depth);
  const leaf = '{"type":"text","text":"leaf"}';
  const docJson = `{"type":"doc","version":1,"content":[${open}${leaf}${close}]}`;
  const issueJson = `{"key":"PROJ-1","fields":{"summary":"s","description":${docJson},"issuetype":{"name":"Story"},"priority":null,"labels":[],"issuelinks":[],"updated":null,"status":null}}`;
  const bodyJson = `{"issues":[${issueJson}]}`;

  await withServer(
    (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(bodyJson);
    },
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      try {
        await provider.read();
        assert.fail("expected a clean depth-exceeded rejection, got success");
      } catch (err) {
        assert.equal(err.constructor.name, "Error", `expected a clean Error, got ${err.constructor.name}: ${err.message}`);
        assert.match(err.message, /maximum supported nesting depth/);
      }
    }
  );
});

// --- CORRECTIVE C1: hardBreak -------------------------------------------------

test("RTI-7B-C1: an ADF hardBreak preserves a line boundary, never silently concatenates surrounding text", async () => {
  const para = { type: "paragraph", content: [{ type: "text", text: "line1" }, { type: "hardBreak" }, { type: "text", text: "line2" }] };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(para) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "line1\nline2");
      assert.notEqual(artifact.content, "line1line2");
    }
  );
});

// --- ADF fixtures (unchanged behavior, re-verified after the depth-bound change) ---

test("RTI-7B ADF: empty document yields no content field (genuinely absent, not empty string)", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc() })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal("content" in artifact, false);
    }
  );
});

test("RTI-7B ADF: single paragraph converts to plain text", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(paragraph("Hello world.")) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Hello world.");
    }
  );
});

test("RTI-7B ADF: multiple paragraphs are joined with a blank line", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(paragraph("First."), paragraph("Second.")) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "First.\n\nSecond.");
    }
  );
});

test("RTI-7B ADF: heading plus paragraph both appear as separate blocks", async () => {
  const heading = { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(heading, paragraph("Body.")) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Title\n\nBody.");
    }
  );
});

test("RTI-7B ADF: bullet list items are joined with single newlines", async () => {
  const bulletList = {
    type: "bulletList",
    content: [
      { type: "listItem", content: [paragraph("Item 1")] },
      { type: "listItem", content: [paragraph("Item 2")] },
    ],
  };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(bulletList) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Item 1\nItem 2");
    }
  );
});

test("RTI-7B ADF: nested inline text runs (marks) join with no inserted spaces", async () => {
  const para = { type: "paragraph", content: [{ type: "text", text: "Bold ", marks: [{ type: "strong" }] }, { type: "text", text: "and normal." }] };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(para) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Bold and normal.");
    }
  );
});

test("RTI-7B ADF: an unrecognized wrapper node is recursed into gracefully", async () => {
  const panel = { type: "panel", attrs: { panelType: "info" }, content: [paragraph("Note text.")] };
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: adfDoc(panel) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Note text.");
    }
  );
});

test("RTI-7B ADF: a malformed (non-doc-shaped) description fails closed", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { description: { unexpected: "shape" } })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /not a recognized ADF document/);
    }
  );
});

// --- acceptance criteria (unchanged) -----------------------------------------

test("RTI-7B AC: fieldMap absent -> no acceptanceCriteria", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1")])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal("acceptanceCriteria" in artifact, false);
    }
  );
});

test("RTI-7B AC: configured plain-text field -> one AC entry without id", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: "Given X, when Y, then Z." })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.acceptanceCriteria, [{ text: "Given X, when Y, then Z." }]);
    }
  );
});

test("RTI-7B AC: configured ADF field -> deterministic plain-text AC", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: adfDoc(paragraph("Criteria text.")) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.acceptanceCriteria, [{ text: "Criteria text." }]);
    }
  );
});

test("RTI-7B AC: configured field missing/null -> no AC (not an error)", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: null })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      const [artifact] = await provider.read();
      assert.equal("acceptanceCriteria" in artifact, false);
    }
  );
});

test("RTI-7B AC: invalid configured field shape fails closed", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: 12345 })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      await assert.rejects(() => provider.read(), /not a recognized ADF document/);
    }
  );
});

test("RTI-7B AC: criterion ids are never fabricated", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { customfield_100: "One text criterion." })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "customfield_100" } }));
      const [artifact] = await provider.read();
      assert.equal("id" in artifact.acceptanceCriteria[0], false);
    }
  );
});

// --- type mapping (unchanged) -------------------------------------------------

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
    (req, res) => respondJson(res, 200, searchPayload(issues)),
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

test("RTI-7I-A (closes Jira/Azure vendor-keyed-lookup parity gap): hostile issue-type names never leak Object.prototype, always fall back to 'other'", async () => {
  for (const hostileType of ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"]) {
    await withServer(
      (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { issuetype: { name: hostileType } })])),
      async () => {
        const provider = new JiraRequirementsProvider(makeConfig());
        const [artifact] = await provider.read();
        assert.equal(artifact.type, "other", `expected 'other' for issuetype.name=${JSON.stringify(hostileType)}`);
        assert.notEqual(artifact.type, Object.prototype);
        assert.equal(typeof artifact.type, "string");
      }
    );
  }
});

test("RTI-7I-A (real end-to-end via RTI-6): a hostile issue-type name normalizes safely, loadRequirementsFromProvider succeeds", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { issuetype: { name: "__proto__" }, description: adfDoc(paragraph("Some description text.")) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      assert.equal(requirements.length, 1);
      assert.equal(requirements[0].type, "other");
    }
  );
});

// --- relationships (unchanged) -------------------------------------------------

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
    (req, res) => respondJson(res, 200, searchPayload([issue])),
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

test("RTI-7I-A (audit confirms already-safe): hostile link-type names are safely omitted, never mapped via prototype leakage - mapRelationship compares against literal string constants, not a bracket lookup", async () => {
  for (const hostileType of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
    const issue = makeIssue("PROJ-1", { issuelinks: [{ type: { name: hostileType }, outwardIssue: { key: "PROJ-2" } }] });
    await withServer(
      (req, res) => respondJson(res, 200, searchPayload([issue])),
      async () => {
        const provider = new JiraRequirementsProvider(makeConfig());
        const [artifact] = await provider.read();
        assert.equal("relationships" in artifact, false, `expected link type=${JSON.stringify(hostileType)} to be omitted`);
      }
    );
  }
});

test("RTI-7B relationships: malformed issuelinks entry fails closed", async () => {
  const issue = makeIssue("PROJ-1", { issuelinks: [{ type: { name: "Blocks" }, outwardIssue: { key: "PROJ-2" }, inwardIssue: { key: "PROJ-3" } }] });
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /exactly one of inwardIssue\/outwardIssue/);
    }
  );
});

test("RTI-7B relationships: out-of-snapshot target is not rejected merely because it wasn't returned by this read", async () => {
  const issue = makeIssue("PROJ-1", { issuelinks: [{ type: { name: "Relates" }, outwardIssue: { key: "PROJ-999" } }] });
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.relationships, [{ type: "related", targetId: "jira-test:PROJ-999" }]);
    }
  );
});

// --- CORRECTIVE C1: issue-key hygiene + source.location encoding -----------

test("RTI-7B-C1: normal issue key succeeds", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-123")])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.source.sourceId, "PROJ-123");
    }
  );
});

test("RTI-7B-C1: a control-character-bearing issue key fails closed", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1\n")])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /\.key was missing or invalid/);
    }
  );
});

test("RTI-7B-C1: an over-bound (>200 char) issue key fails closed", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-" + "1".repeat(250))])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /\.key was missing or invalid/);
    }
  );
});

test("RTI-7B-C1 (closes RTI-7C issue-key/source.location LOW/INFO): a path/query-like issue key cannot alter source.location's URL structure", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1/../../evil?x=1")])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      const parsed = new URL(artifact.source.location);
      assert.equal(parsed.origin, "https://example.atlassian.net");
      assert.equal(parsed.pathname, "/browse/PROJ-1%2F..%2F..%2Fevil%3Fx%3D1");
      assert.equal(parsed.search, "", "the crafted key must not be interpreted as a real query string");
      // sourceId still preserves the exact native value (unencoded) - it is
      // provenance data, not itself a URL.
      assert.equal(artifact.source.sourceId, "PROJ-1/../../evil?x=1");
    }
  );
});

test("RTI-7B-C1: relationship targetId also uses the same issue-key hygiene as the primary issue key", async () => {
  const issue = makeIssue("PROJ-1", { issuelinks: [{ type: { name: "Relates" }, outwardIssue: { key: "PROJ-2\n" } }] });
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /target issue had a missing or invalid "key"/);
    }
  );
});

// --- provenance -----------------------------------------------------------

test("RTI-7B provenance: source fields are exact (except location, now percent-encoded)", async () => {
  const issue = makeIssue("PROJ-1", { updated: "2026-03-05T12:00:00.000Z" });
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue])),
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

// --- identity stability (unchanged) -------------------------------------------

test("RTI-7B identity: stable across timeoutMs/maxItems config changes", async () => {
  const issue = makeIssue("PROJ-1");
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue])),
    async () => {
      const providerA = new JiraRequirementsProvider(makeConfig({ timeoutMs: 1000, maxItems: 50 }));
      const providerB = new JiraRequirementsProvider(makeConfig({ timeoutMs: 5000, maxItems: 500 }));
      const [a] = await providerA.read();
      const [b] = await providerB.read();
      assert.equal(a.id, b.id);
    }
  );
});

test("RTI-7B identity: content update changes content/version, id stays stable", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { summary: "Old summary", updated: "2026-01-01T00:00:00.000Z" })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [before] = await provider.read();
      assert.equal(before.id, "jira-test:PROJ-1");
      assert.equal(before.title, "Old summary");
      assert.equal(before.source.version, "2026-01-01T00:00:00.000Z");
    }
  );

  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { summary: "New summary", updated: "2026-02-01T00:00:00.000Z" })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [after] = await provider.read();
      assert.equal(after.id, "jira-test:PROJ-1");
      assert.equal(after.title, "New summary");
      assert.equal(after.source.version, "2026-02-01T00:00:00.000Z");
    }
  );
});

test("RTI-7B identity: changing provider.id changes the normalized artifact id prefix (intentional)", async () => {
  const issue = makeIssue("PROJ-1");
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue])),
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

test("RTI-7B identity: two provider instances with the same native key produce collision-safe distinct ids", async () => {
  const issue = makeIssue("PROJ-123");
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([issue])),
    async () => {
      const prod = new JiraRequirementsProvider(makeConfig({ id: "jira-prod" }));
      const staging = new JiraRequirementsProvider(makeConfig({ id: "jira-staging" }));
      const [a] = await prod.read();
      const [b] = await staging.read();
      assert.deepEqual([a.id, b.id], ["jira-prod:PROJ-123", "jira-staging:PROJ-123"]);
    }
  );
});

// --- RTI-6 integration + full pipeline -----------------------------------------

test("RTI-7B: RTI-6's loadRequirementsFromProvider accepts the Jira provider directly", async () => {
  await withServer(
    (req, res) =>
      respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { summary: "Login", description: adfDoc(paragraph("Valid credentials return HTTP 200.")) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      assert.equal(requirements.length, 1);
      assert.equal(requirements[0].id, "jira-test:PROJ-1");
      assert.ok(Object.isFrozen(requirements));
    }
  );
});

test("RTI-7B: full RTI-6 -> RTI-3 -> RTI-4 -> RTI-5 pipeline reaches FULLY_COVERED for a READY Jira requirement", async () => {
  const { analyzeRequirementsQuality } = require("../requirement-quality");
  const { generateTestDesigns } = require("../test-design");
  const { buildRequirementTraceability, analyzeRequirementsCoverage } = require("../requirement-traceability");

  await withServer(
    (req, res) =>
      respondJson(
        res,
        200,
        searchPayload([makeIssue("PROJ-1", { summary: "Login", description: adfDoc(paragraph("When valid credentials are supplied, the API returns HTTP 200.")) })])
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

test("RTI-7B: a Jira requirement with vague text ingests successfully - RTI-3 classifies it downstream, the adapter does not judge quality", async () => {
  const { analyzeRequirementQuality } = require("../requirement-quality");
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { summary: "Performance", description: adfDoc(paragraph("The page should load quickly.")) })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      assert.equal(requirements.length, 1);
      assert.equal(analyzeRequirementQuality(requirements[0]).status, "AMBIGUOUS");
    }
  );
});

// --- error / secret safety -------------------------------------------------

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

// --- metadata / raw payload --------------------------------------------------

test("RTI-7B: metadata is selective and bounded, raw issue is never stored", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { issuetype: { name: "Story" }, status: { name: "Done" } })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.metadata, { issueType: "Story", status: "Done" });
      assert.equal(JSON.stringify(artifact).includes("fields"), false);
    }
  );
});

// --- priority / labels -----------------------------------------------------

test("RTI-7B: priority and labels are source-provided values, deduplicated", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, searchPayload([makeIssue("PROJ-1", { priority: { name: "Critical" }, labels: ["a", "b", "a"] })])),
    async () => {
      const provider = new JiraRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.priority, "Critical");
      assert.deepEqual(artifact.labels, ["a", "b"]);
    }
  );
});
