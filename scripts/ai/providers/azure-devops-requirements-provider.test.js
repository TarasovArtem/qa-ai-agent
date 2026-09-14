"use strict";

/**
 * Roadmap RTI-7F (Azure DevOps Requirements Provider): unit coverage for
 * scripts/ai/providers/azure-devops-requirements-provider.js.
 *
 * TEST TRANSPORT STRATEGY (same philosophy as Jira's RTI-7B tests): a real
 * local Node `http.createServer` mock server plus a per-test `global.fetch`
 * origin-rewrite proxy (saves/restores the original `fetch`) - this
 * exercises the real production URL construction, header construction,
 * method, the WIQL-then-batch control flow, and JSON-parsing code paths
 * with no live TLS server and no executable-callback test seam in public
 * config. The server/proxy mechanism itself (Roadmap RTI-8E1) is shared
 * with the Jira requirements provider's own test suite via
 * test/helpers/http-test-server.js - this file remains entirely
 * responsible for its own Azure-shaped mock payloads and assertions; the
 * shared module knows nothing about WIQL/batch/HTML normalization.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { AzureDevOpsRequirementsProvider } = require("./azure-devops-requirements-provider");
const { loadRequirementsFromProvider } = require("../requirements-source-provider");
const { withServer, respondJson } = require("../../../test/helpers/http-test-server");

function makeConfig(overrides = {}) {
  return {
    id: "azure-test",
    organization: "contoso",
    project: "MyProject",
    wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug'",
    auth: { type: "pat", token: "test-pat-token" },
    timeoutMs: 2000,
    ...overrides,
  };
}

function wiqlResult(ids) {
  return { queryType: "flat", queryResultType: "workItem", asOf: "2026-01-01T00:00:00Z", columns: [], workItems: ids.map((id) => ({ id, url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}` })) };
}

function batchResult(items) {
  return { count: items.length, value: items };
}

function workItem(id, fieldOverrides = {}, relations) {
  const item = {
    id,
    rev: 1,
    url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}`,
    fields: {
      "System.Title": `Title ${id}`,
      "System.WorkItemType": "Bug",
      "System.Description": null,
      "System.Tags": "",
      "System.State": "Active",
      "Microsoft.VSTS.Common.Priority": 2,
      ...fieldOverrides,
    },
  };
  if (relations !== undefined) item.relations = relations;
  return item;
}

function collectRequests(routes) {
  let wiqlCount = 0;
  let batchCount = 0;
  const batchBodies = [];
  const handler = (req, res) => {
    if (req.url.includes("/wiql")) {
      wiqlCount += 1;
      const r = routes.wiql(req, wiqlCount);
      respondJson(res, r.status || 200, r.body, r.headers);
      return;
    }
    batchCount += 1;
    batchBodies.push(req.jsonBody);
    const r = routes.batch(req, batchCount, req.jsonBody);
    respondJson(res, r.status || 200, r.body, r.headers);
  };
  return { handler, counts: () => ({ wiqlCount, batchCount }), batchBodies };
}

// --- config validation --------------------------------------------------

test("RTI-7F config: valid config constructs successfully, provider.id matches", () => {
  const provider = new AzureDevOpsRequirementsProvider(makeConfig());
  assert.equal(provider.id, "azure-test");
});

test("RTI-7F config: unknown top-level keys are rejected", () => {
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ extraneousKey: "x" })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
});

test("RTI-7F config: missing/invalid id rejects", () => {
  for (const bad of [undefined, "", 123, "bad\ncontrolchar", "x".repeat(201)]) {
    assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ id: bad })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  }
});

test("RTI-7F config: organization rejects unsafe characters", () => {
  for (const bad of ["", "a/b", "a?b", "a#b", "a@b", "https://evil.com", undefined, 123]) {
    assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ organization: bad })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("RTI-7F config: project allows spaces, rejects control chars/empty", () => {
  assert.doesNotThrow(() => new AzureDevOpsRequirementsProvider(makeConfig({ project: "My Project Name" })));
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ project: "" })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ project: "bad\ncontrol" })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
});

test("RTI-7F config: wiql must be a non-empty string", () => {
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ wiql: "" })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ wiql: undefined })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
});

test("RTI-7F config: auth union validation", () => {
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "oauth", token: "x" } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "pat", token: "" } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "pat" } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "pat", token: "x", extra: 1 } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ auth: "not-an-object" })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.doesNotThrow(() => new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "bearer", token: "x" } })));
});

test("RTI-7F-C1 (cheap-now): a CR/LF-bearing auth token is rejected at construction, not deferred to a wasted network round trip", () => {
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "bearer", token: "abc\r\nX-Injected: evil" } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "pat", token: "abc\ndef" } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
});

test("RTI-7F config: maxItems validation and vendor-cap ceiling", () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, "100", 20001]) {
    assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: bad })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/, `expected rejection for maxItems=${bad}`);
  }
  assert.doesNotThrow(() => new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 20000 })));
});

test("RTI-7F config: timeoutMs validation", () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, "1000"]) {
    assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ timeoutMs: bad })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  }
});

test("RTI-7F config: fieldMap validation, allows null to disable AC", () => {
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ fieldMap: { unknownKey: "x" } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "" } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.doesNotThrow(() => new AzureDevOpsRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "Custom.Field" } })));
  assert.doesNotThrow(() => new AzureDevOpsRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: null } })));
});

test("RTI-7F config: typeMap validates target values against RTI-1 vocabulary", () => {
  assert.throws(() => new AzureDevOpsRequirementsProvider(makeConfig({ typeMap: { Feature: "not-a-real-type" } })), /AZURE_DEVOPS_PROVIDER_CONFIG_INVALID/);
  assert.doesNotThrow(() => new AzureDevOpsRequirementsProvider(makeConfig({ typeMap: { Feature: "requirement" } })));
});

// --- WIQL contract -----------------------------------------------------

test("RTI-7F WIQL: request uses POST .../_apis/wit/wiql?api-version=7.1 with query in the JSON body, not the URL", async () => {
  let capturedPath, capturedMethod, capturedBody, capturedAuth;
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) {
        capturedPath = req.url;
        capturedMethod = req.method;
        capturedBody = req.jsonBody;
        capturedAuth = req.headers.authorization;
        return respondJson(res, 200, wiqlResult([]));
      }
      respondJson(res, 200, batchResult([]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS 'SECRET_PROJECT_CODE'" }));
      await provider.read();
      assert.equal(capturedMethod, "POST");
      assert.match(capturedPath, /^\/contoso\/MyProject\/_apis\/wit\/wiql\?api-version=7\.1$/);
      assert.equal(capturedPath.includes("SECRET_PROJECT_CODE"), false);
      assert.equal(capturedBody.query.includes("SECRET_PROJECT_CODE"), true);
      const expectedAuth = `Basic ${Buffer.from(":test-pat-token", "utf8").toString("base64")}`;
      assert.equal(capturedAuth, expectedAuth);
    }
  );
});

test("RTI-7F WIQL: organization and project are percent-encoded in the URL", async () => {
  let capturedPath;
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) {
        capturedPath = req.url;
        return respondJson(res, 200, wiqlResult([]));
      }
      respondJson(res, 200, batchResult([]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ project: "My Project" }));
      await provider.read();
      assert.equal(capturedPath.startsWith("/contoso/My%20Project/_apis/wit/wiql"), true);
    }
  );
});

test("RTI-7F WIQL: empty result returns [] with no batch request", async () => {
  const { handler, counts } = collectRequests({
    wiql: () => ({ body: wiqlResult([]) }),
    batch: () => ({ body: batchResult([]) }),
  });
  await withServer(handler, async () => {
    const provider = new AzureDevOpsRequirementsProvider(makeConfig());
    const result = await provider.read();
    assert.deepEqual(result, []);
  });
  assert.deepEqual(counts(), { wiqlCount: 1, batchCount: 0 });
});

test("RTI-7F WIQL: tree query type is rejected", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, { queryType: "tree", queryResultType: "workItemLink", workItems: [], workItemRelations: [] }),
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /unsupported query type/);
    }
  );
});

test("RTI-7F WIQL: oneHop query type is rejected", async () => {
  await withServer(
    (req, res) => respondJson(res, 200, { queryType: "oneHop", queryResultType: "workItemLink", workItems: [], workItemRelations: [] }),
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /unsupported query type/);
    }
  );
});

test("RTI-7F WIQL: malformed response shapes fail deterministically", async () => {
  const malformed = [{}, { queryType: "flat", queryResultType: "workItem" }, { queryType: "flat", queryResultType: "workItem", workItems: "not-array" }, { queryType: "flat", queryResultType: "workItem", workItems: [{ url: "x" }] }, { queryType: "flat", queryResultType: "workItem", workItems: [{ id: -1 }] }, { queryType: "flat", queryResultType: "workItem", workItems: [{ id: 1.5 }] }];
  for (const body of malformed) {
    await withServer(
      (req, res) => respondJson(res, 200, body),
      async () => {
        const provider = new AzureDevOpsRequirementsProvider(makeConfig());
        await assert.rejects(() => provider.read(), undefined, `expected rejection for ${JSON.stringify(body)}`);
      }
    );
  }
});

test("RTI-7F WIQL: duplicate work item ids in the result fail closed before any batch call", async () => {
  const { handler, counts } = collectRequests({
    wiql: () => ({ body: wiqlResult([1, 2, 1]) }),
    batch: () => ({ body: batchResult([]) }),
  });
  await withServer(handler, async () => {
    const provider = new AzureDevOpsRequirementsProvider(makeConfig());
    await assert.rejects(() => provider.read(), /duplicate work item id/);
  });
  assert.equal(counts().batchCount, 0);
});

// --- Completeness (20k cap + maxItems) -----------------------------------

test("RTI-7F completeness: WIQL result at the vendor's 20,000-item cap fails closed, no batch call", async () => {
  const ids = Array.from({ length: 20000 }, (_, i) => i + 1);
  const { handler, counts } = collectRequests({
    wiql: () => ({ body: wiqlResult(ids) }),
    batch: () => ({ body: batchResult([]) }),
  });
  await withServer(handler, async () => {
    const provider = new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 20000 }));
    await assert.rejects(() => provider.read(), /20,000-item result cap/);
  });
  assert.equal(counts().batchCount, 0);
});

test("RTI-7F completeness: 19,999 items is allowed through the vendor-cap guard (still subject to maxItems)", async () => {
  const ids = Array.from({ length: 19999 }, (_, i) => i + 1);
  const { handler } = collectRequests({
    wiql: () => ({ body: wiqlResult(ids) }),
    batch: () => ({ body: batchResult([]) }),
  });
  await withServer(handler, async () => {
    const provider = new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 100 }));
    await assert.rejects(() => provider.read(), /exceeds the configured maxItems bound/);
  });
});

test("RTI-7F completeness: maxItems exact boundary - count==maxItems succeeds, count>maxItems fails", async () => {
  const ids100 = Array.from({ length: 100 }, (_, i) => i + 1);
  const items100 = ids100.map((id) => workItem(id));
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult(ids100));
      respondJson(res, 200, batchResult(items100));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 100 }));
      const result = await provider.read();
      assert.equal(result.length, 100);
    }
  );

  const ids101 = Array.from({ length: 101 }, (_, i) => i + 1);
  await withServer(
    (req, res) => respondJson(res, 200, wiqlResult(ids101)),
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 100 }));
      await assert.rejects(() => provider.read(), /exceeds the configured maxItems bound/);
    }
  );
});

// --- Batch model ----------------------------------------------------------

test("RTI-7F batch: request uses POST .../workitemsbatch with errorPolicy Fail and $expand Relations", async () => {
  let capturedBody;
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      capturedBody = req.jsonBody;
      respondJson(res, 200, batchResult([workItem(1)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await provider.read();
      assert.deepEqual(capturedBody.ids, [1]);
      assert.equal(capturedBody.$expand, "Relations");
      assert.equal(capturedBody.errorPolicy, "Fail");
      assert.ok(Array.isArray(capturedBody.fields) && capturedBody.fields.includes("System.Title"));
    }
  );
});

test("RTI-7F batch: partition counts match expected batch boundaries (199/200/201/400/401)", async () => {
  const cases = [
    [0, 0],
    [1, 1],
    [199, 1],
    [200, 1],
    [201, 2],
    [400, 2],
    [401, 3],
  ];
  for (const [n, expectedBatches] of cases) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const { handler, counts } = collectRequests({
      wiql: () => ({ body: wiqlResult(ids) }),
      batch: (req, count, body) => ({ body: batchResult(body.ids.map((id) => workItem(id))) }),
    });
    await withServer(handler, async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 20000 }));
      const result = await provider.read();
      assert.equal(result.length, n, `n=${n}`);
    });
    assert.equal(counts().batchCount, expectedBatches, `n=${n}`);
  }
});

test("RTI-7F batch: batches are sequential, not parallel (verified via request-count progression)", async () => {
  const ids = Array.from({ length: 400 }, (_, i) => i + 1);
  const timestamps = [];
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult(ids));
      timestamps.push(Date.now());
      setTimeout(() => respondJson(res, 200, batchResult(req.jsonBody.ids.map((id) => workItem(id)))), 20);
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 20000 }));
      await provider.read();
    }
  );
  assert.equal(timestamps.length, 2);
  assert.ok(timestamps[1] - timestamps[0] >= 15, "second batch must start only after the first batch's artificial delay");
});

test("RTI-7F batch: sequential batches preserve correct id partitioning across requests", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const requestedBatches = [];
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult(ids));
      requestedBatches.push(req.jsonBody.ids);
      respondJson(res, 200, batchResult(req.jsonBody.ids.map((id) => workItem(id))));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 20000 }));
      await provider.read();
    }
  );
  assert.equal(requestedBatches.length, 2);
  assert.equal(requestedBatches[0].length, 200);
  assert.equal(requestedBatches[1].length, 50);
});

test("RTI-7F batch: malformed response shapes fail deterministically", async () => {
  const malformed = [{}, { count: 1, value: "not-array" }, { count: 2, value: [workItem(1)] }, { value: [{ id: 1 }] }, { value: [{ id: 1, rev: 1, fields: "not-object" }] }, { value: [{ id: 1, rev: 1, fields: {}, relations: "not-array" }] }];
  for (const body of malformed) {
    await withServer(
      (req, res) => {
        if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
        respondJson(res, 200, body);
      },
      async () => {
        const provider = new AzureDevOpsRequirementsProvider(makeConfig());
        await assert.rejects(() => provider.read(), undefined, `expected rejection for ${JSON.stringify(body)}`);
      }
    );
  }
});

test("RTI-7F batch: missing requested id in response fails closed", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1, 2]));
      respondJson(res, 200, batchResult([workItem(1)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /did not return all requested work item ids/);
    }
  );
});

test("RTI-7F batch: unrequested extra id in response fails closed", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1), workItem(999)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /not requested/);
    }
  );
});

test("RTI-7F batch: duplicate returned id fails closed", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1), workItem(1)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /duplicate work item id/);
    }
  );
});

test("RTI-7F batch: partial batch failure rejects the whole read, no already-fetched items returned", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  let batchCount = 0;
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult(ids));
      batchCount += 1;
      if (batchCount === 1) return respondJson(res, 200, batchResult(req.jsonBody.ids.map((id) => workItem(id))));
      res.writeHead(500);
      res.end();
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ maxItems: 20000 }));
      await assert.rejects(() => provider.read());
    }
  );
});

test("RTI-7F batch: response order does not matter - final output is canonical numeric-id order", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([3, 1, 2]));
      respondJson(res, 200, batchResult([workItem(2), workItem(3), workItem(1)])); // reversed/random order
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.deepEqual(result.map((r) => r.source.sourceId), ["1", "2", "3"]);
    }
  );
});

// --- Auth --------------------------------------------------------------

test("RTI-7F auth: PAT produces correct Basic header (empty username)", async () => {
  let capturedAuth;
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) {
        capturedAuth = req.headers.authorization;
        return respondJson(res, 200, wiqlResult([]));
      }
      respondJson(res, 200, batchResult([]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "pat", token: "secret-pat-xyz" } }));
      await provider.read();
    }
  );
  assert.equal(capturedAuth, `Basic ${Buffer.from(":secret-pat-xyz", "utf8").toString("base64")}`);
});

test("RTI-7F auth: Bearer produces correct header", async () => {
  let capturedAuth;
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) {
        capturedAuth = req.headers.authorization;
        return respondJson(res, 200, wiqlResult([]));
      }
      respondJson(res, 200, batchResult([]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "bearer", token: "entra-access-token-abc" } }));
      await provider.read();
    }
  );
  assert.equal(capturedAuth, "Bearer entra-access-token-abc");
});

test("RTI-7F auth: 401 fails immediately, no retry", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(401);
      res.end();
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /401/);
    }
  );
  assert.equal(requestCount, 1);
});

// --- Redirects / timeout / retry -----------------------------------------

test("RTI-7F network: a 302 redirect fails closed, no follow", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(302, { Location: "https://evil.example.com/steal" });
      res.end();
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /redirect/i);
    }
  );
  assert.equal(requestCount, 1);
});

test("RTI-7F network: a 307 redirect fails closed, no follow", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(307, { Location: "https://evil.example.com/steal" });
      res.end();
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /redirect/i);
    }
  );
});

test("RTI-7F network: request exceeding timeoutMs fails with a bounded error", async () => {
  await withServer(
    (req, res) => {
      setTimeout(() => respondJson(res, 200, wiqlResult([])), 400);
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ timeoutMs: 50 }));
      await assert.rejects(() => provider.read(), /Azure DevOps request failed/);
    }
  );
});

test("RTI-7F network: a permanent 500 fails after exactly 3 total attempts", async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(500);
      res.end();
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /3 attempt\(s\)/);
    }
  );
  assert.equal(requestCount, 3);
});

// --- Rate-limit semantics (Azure-specific, not copied from Jira) -------

test("RTI-7F rate-limit: 429 retries within attempt budget and honors bounded Retry-After", async () => {
  let requestCount = 0;
  const start = Date.now();
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.writeHead(429, { "Retry-After": "0" });
        return res.end();
      }
      respondJson(res, 200, wiqlResult([]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.deepEqual(result, []);
    }
  );
  assert.equal(requestCount, 2);
});

test("RTI-7F rate-limit: HTTP 200 + Retry-After is accepted as successful and NOT retried", async () => {
  let wiqlCount = 0;
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) {
        wiqlCount += 1;
        return respondJson(res, 200, wiqlResult([1]), { "Retry-After": "1" });
      }
      respondJson(res, 200, batchResult([workItem(1)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.equal(result.length, 1);
    }
  );
  assert.equal(wiqlCount, 1, "a successful 200+Retry-After response must not be retried");
});

test("RTI-7F rate-limit: a 200+Retry-After on WIQL delays the following batch request, not the WIQL call itself", async () => {
  const timestamps = {};
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) {
        timestamps.wiql = Date.now();
        return respondJson(res, 200, wiqlResult([1]), { "Retry-After": "1" });
      }
      timestamps.batch = Date.now();
      respondJson(res, 200, batchResult([workItem(1)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await provider.read();
    }
  );
  assert.ok(timestamps.batch - timestamps.wiql >= 900, `expected the batch request to wait ~1s after WIQL's Retry-After hint, got ${timestamps.batch - timestamps.wiql}ms`);
});

test("RTI-7F rate-limit: a 200+Retry-After on the FINAL request causes no pointless terminal wait", async () => {
  const start = Date.now();
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1)]), { "Retry-After": "5" });
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await provider.read();
    }
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `expected read() to complete quickly with no trailing sleep, took ${elapsed}ms`);
});

test("RTI-7F-C1 (closes rate-limit MEDIUM): 429 + Retry-After: 8 is honored in full - a real regression proof that a value well above the OLD, defective 5s cap is no longer truncated", async () => {
  let requestCount = 0;
  const start = Date.now();
  await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.writeHead(429, { "Retry-After": "8" });
        return res.end();
      }
      respondJson(res, 200, wiqlResult([]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const result = await provider.read();
      assert.deepEqual(result, []);
    }
  );
  const elapsed = Date.now() - start;
  assert.equal(requestCount, 2);
  // Under the OLD MAX_RATE_LIMIT_WAIT_MS=5000, this scenario would have
  // retried at ~5s, still throttled in a real Azure sustained-throttling
  // scenario. The corrected cap (35000ms, above Azure's documented ~30s
  // normal ceiling) must let a 8s hint be honored in full, not truncated.
  assert.ok(elapsed >= 7500, `expected the full ~8s Retry-After to be honored (was capped to 5s pre-corrective), took only ${elapsed}ms`);
});

test("RTI-7F-C1 (closes rate-limit MEDIUM): a pathological Retry-After value is still capped, at the corrected ~35s ceiling, not honored verbatim - verified via mock timers, no real wait", async (t) => {
  // The only mock-timer test in this file (kept isolated - combining
  // multiple mock-timer tests in one run was empirically found to risk
  // cross-test interference during RTI-7F-C1's own test development).
  // Advances a REAL setTimeout-based delay inside the real production
  // retry loop without any real wall-clock wait; setImmediate (never
  // mocked) is used to let the real local-HTTP-server I/O settle between
  // steps. No production code, no executable test seam in public config.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestCount = 0;

  function waitForRealIO(n = 10) {
    let p = Promise.resolve();
    for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r)));
    return p;
  }

  try {
    await withServer(
      (req, res) => {
        requestCount += 1;
        if (requestCount === 1) {
          res.writeHead(429, { "Retry-After": "999999999" });
          return res.end();
        }
        respondJson(res, 200, wiqlResult([]));
      },
      async () => {
        const provider = new AzureDevOpsRequirementsProvider(makeConfig());
        const readPromise = provider.read();
        await waitForRealIO();
        assert.equal(requestCount, 1, "expected the first (429) request to have landed");
        await t.mock.timers.tick(34000);
        await waitForRealIO(5);
        assert.equal(requestCount, 1, "must not retry before the capped ~35s elapses, even for an absurd raw value");
        await t.mock.timers.tick(2000);
        await waitForRealIO();
        const result = await readPromise;
        assert.deepEqual(result, []);
        assert.equal(requestCount, 2);
      }
    );
  } finally {
    t.mock.timers.reset();
  }
});

// --- HTML normalization (real HTTP round trip) ---------------------------

test("RTI-7F HTML: description normalizes to deterministic plain text via real HTTP round trip", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": "<p>First paragraph.</p><p>Second with <strong>bold</strong> text.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "First paragraph.\n\nSecond with bold text.");
    }
  );
});

test("RTI-7F HTML: empty/absent description yields no content field", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": null })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal("content" in artifact, false);
    }
  );
});

test("RTI-7F HTML: deeply nested (65-level) description fails cleanly via real HTTP round trip, no RangeError", async () => {
  const deepHtml = "<div>".repeat(65) + "leaf" + "</div>".repeat(65);
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": deepHtml })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      try {
        await provider.read();
        assert.fail("expected rejection");
      } catch (err) {
        assert.equal(err.constructor.name, "Error", `expected clean Error, got ${err.constructor.name}`);
        assert.match(err.message, /maximum supported tag nesting depth/);
      }
    }
  );
});

test("RTI-7F HTML: 64-level nested description succeeds (exact depth boundary)", async () => {
  const html = "<div>".repeat(64) + "leaf" + "</div>".repeat(64);
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": html })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "leaf");
    }
  );
});

test("RTI-7F HTML: oversized description (>200,000 chars) fails cleanly via real HTTP round trip", async () => {
  const oversized = "<p>" + "a".repeat(200001) + "</p>";
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": oversized })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /maximum supported input length/);
    }
  );
});

test("RTI-7F HTML: script/style content is discarded entirely", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": "<script>alert(document.cookie)</script><style>.x{}</style><p>Visible text.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Visible text.");
      assert.equal(artifact.content.includes("alert"), false);
    }
  );
});

test("RTI-7F HTML: malformed unterminated tag fails cleanly", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": "<p>text <b" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /truncated\/malformed tag/);
    }
  );
});

test("RTI-7F HTML: entities decode once, no double-decoding", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": "<p>&amp;lt;not-a-real-tag&amp;gt;</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "&lt;not-a-real-tag&gt;");
    }
  );
});

test("RTI-7F HTML: list items join with single newlines, paragraphs join with blank lines", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": "<ul><li>Item 1</li><li>Item 2</li></ul><p>Follow-up.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "Item 1\nItem 2\n\nFollow-up.");
    }
  );
});

// --- Acceptance criteria --------------------------------------------------

test("RTI-7F AC: default standard field is used when present", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>Given X, when Y, then Z.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.acceptanceCriteria, [{ text: "Given X, when Y, then Z." }]);
    }
  );
});

test("RTI-7F AC: absence of the default field is not an error", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal("acceptanceCriteria" in artifact, false);
    }
  );
});

test("RTI-7F AC: fieldMap override uses a different field", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "Custom.AC": "<p>Custom AC text.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: "Custom.AC" } }));
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.acceptanceCriteria, [{ text: "Custom AC text." }]);
    }
  );
});

test("RTI-7F AC: fieldMap explicit null disables AC extraction entirely", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>Should be ignored.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ fieldMap: { acceptanceCriteria: null } }));
      const [artifact] = await provider.read();
      assert.equal("acceptanceCriteria" in artifact, false);
    }
  );
});

test("RTI-7F AC: criterion ids are never fabricated", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "Microsoft.VSTS.Common.AcceptanceCriteria": "Plain text AC." })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal("id" in artifact.acceptanceCriteria[0], false);
    }
  );
});

// --- Type mapping -----------------------------------------------------

test("RTI-7F type mapping: built-in defaults, unknown -> other", async () => {
  const items = [
    workItem(1, { "System.WorkItemType": "User Story" }),
    workItem(2, { "System.WorkItemType": "Product Backlog Item" }),
    workItem(3, { "System.WorkItemType": "Bug" }),
    workItem(4, { "System.WorkItemType": "Requirement" }),
    workItem(5, { "System.WorkItemType": "Feature" }),
    workItem(6, { "System.WorkItemType": "Task" }),
  ];
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult(items.map((i) => i.id)));
      respondJson(res, 200, batchResult(items));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const result = await provider.read();
      const byId = Object.fromEntries(result.map((a) => [a.source.sourceId, a.type]));
      assert.equal(byId["1"], "user-story");
      assert.equal(byId["2"], "user-story");
      assert.equal(byId["3"], "bug");
      assert.equal(byId["4"], "requirement");
      assert.equal(byId["5"], "other");
      assert.equal(byId["6"], "other");
    }
  );
});

test("RTI-7F type mapping: caller typeMap overrides/extends the built-in map", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.WorkItemType": "Feature" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ typeMap: { Feature: "requirement" } }));
      const [artifact] = await provider.read();
      assert.equal(artifact.type, "requirement");
    }
  );
});

// --- CORRECTIVE C1: prototype-safe vendor-keyed map lookups ----------------

test("RTI-7F-C1 (closes prototype-map MEDIUM): WorkItemType='__proto__' normalizes to 'other', never leaks Object.prototype", async () => {
  for (const hostileType of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    await withServer(
      (req, res) => {
        if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
        respondJson(res, 200, batchResult([workItem(1, { "System.WorkItemType": hostileType })]));
      },
      async () => {
        const provider = new AzureDevOpsRequirementsProvider(makeConfig());
        const [artifact] = await provider.read();
        assert.equal(artifact.type, "other", `expected 'other' for WorkItemType=${JSON.stringify(hostileType)}`);
        assert.notEqual(artifact.type, Object.prototype);
        assert.equal(typeof artifact.type, "string");
      }
    );
  }
});

test("RTI-7F-C1 (closes prototype-map MEDIUM): relation.rel='__proto__'/'constructor' is omitted, never leaks Object.prototype as a relationship type", async () => {
  for (const hostileRel of ["__proto__", "constructor", "toString"]) {
    await withServer(
      (req, res) => {
        if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
        respondJson(res, 200, batchResult([workItem(1, {}, [{ rel: hostileRel, url: "https://dev.azure.com/contoso/_apis/wit/workItems/2" }])]));
      },
      async () => {
        const provider = new AzureDevOpsRequirementsProvider(makeConfig());
        const [artifact] = await provider.read();
        assert.equal("relationships" in artifact, false, `expected relation.rel=${JSON.stringify(hostileRel)} to be omitted`);
      }
    );
  }
});

test("RTI-7F-C1 (closes prototype-map MEDIUM, real end-to-end via RTI-6): a hostile WorkItemType no longer produces an invalid artifact.type - loadRequirementsFromProvider succeeds where it previously rejected with REQUIREMENTS_SOURCE_OUTPUT_INVALID", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.WorkItemType": "__proto__", "System.Description": "<p>Some description text.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      assert.equal(requirements.length, 1);
      assert.equal(requirements[0].type, "other");
    }
  );
});

// --- CORRECTIVE C1: HTML quoted-attribute tag-boundary safety --------------

test("RTI-7F-C1 (closes HTML quoted-attribute MEDIUM): a literal '>' inside a double-quoted attribute value does not terminate the tag early", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": '<a title="1 > 0">hello</a>' })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "hello");
    }
  );
});

test("RTI-7F-C1 (closes HTML quoted-attribute MEDIUM): a literal '>' inside a single-quoted attribute value does not terminate the tag early", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": "<a title='1 > 0'>hello</a>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "hello");
    }
  );
});

test("RTI-7F-C1: a literal '<' inside a quoted attribute value (double or single) does not create false nested-tag state", async () => {
  for (const html of ['<a title="a < b">hello</a>', "<a title='a < b'>hello</a>"]) {
    await withServer(
      (req, res) => {
        if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
        respondJson(res, 200, batchResult([workItem(1, { "System.Description": html })]));
      },
      async () => {
        const provider = new AzureDevOpsRequirementsProvider(makeConfig());
        const [artifact] = await provider.read();
        assert.equal(artifact.content, "hello", `expected 'hello' for ${JSON.stringify(html)}`);
      }
    );
  }
});

test("RTI-7F-C1: multiple mixed-quote attributes on one tag all parse correctly", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": `<a href="x" title="1 > 0" data-v='a < b'>hello</a>` })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "hello");
    }
  );
});

test("RTI-7F-C1: an entity-escaped '>' inside a quoted attribute (already safe pre-corrective) still parses correctly", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": '<a title="1 &gt; 0">hello</a>' })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "hello");
    }
  );
});

test("RTI-7F-C1: an unterminated quoted attribute value fails deterministically closed", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": '<a title="1 > 0>hello' })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /truncated\/malformed tag/);
    }
  );
});

test("RTI-7F-C1: a comment containing an unmatched quote character (ordinary prose) is still handled correctly, unaffected by quote-aware tag scanning", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": "before<!-- it's a comment -->after" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.content, "beforeafter");
    }
  );
});

test("RTI-7F-C1: normal HTML fixture matrix (no regression from the quote-aware tag scanner)", async () => {
  const cases = [
    ["<p>Hello world.</p>", "Hello world."],
    ["<p>First.</p><p>Second.</p>", "First.\n\nSecond."],
    ["line1<br>line2", "line1\nline2"],
    ["<ul><li>Item 1</li><li>Item 2</li></ul>", "Item 1\nItem 2"],
    ["<script>alert(1)</script><p>Safe</p>", "Safe"],
    ["<div><div><div>deep</div></div></div>", "deep"],
  ];
  for (const [html, expected] of cases) {
    await withServer(
      (req, res) => {
        if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
        respondJson(res, 200, batchResult([workItem(1, { "System.Description": html })]));
      },
      async () => {
        const provider = new AzureDevOpsRequirementsProvider(makeConfig());
        const [artifact] = await provider.read();
        assert.equal(artifact.content, expected, `expected ${JSON.stringify(expected)} for ${JSON.stringify(html)}`);
      }
    );
  }
});

// --- Priority / tags -----------------------------------------------------

test("RTI-7F priority/tags: priority is source-derived, tags parsed deterministically", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "Microsoft.VSTS.Common.Priority": 1, "System.Tags": "Web; API ;Web;; Backend" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.equal(artifact.priority, "1");
      assert.deepEqual(artifact.labels, ["Web", "API", "Backend"]);
    }
  );
});

// --- Relationships -------------------------------------------------------

test("RTI-7F relationships: Hierarchy-Reverse -> parent, Related -> related, others omitted", async () => {
  const relations = [
    { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/contoso/_apis/wit/workItems/10" },
    { rel: "System.LinkTypes.Related", url: "https://dev.azure.com/contoso/_apis/wit/workItems/11" },
    { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/contoso/_apis/wit/workItems/12" },
    { rel: "System.LinkTypes.Dependency-Forward", url: "https://dev.azure.com/contoso/_apis/wit/workItems/13" },
    { rel: "System.LinkTypes.Dependency-Reverse", url: "https://dev.azure.com/contoso/_apis/wit/workItems/14" },
    { rel: "Custom.LinkType", url: "https://dev.azure.com/contoso/_apis/wit/workItems/15" },
  ];
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, {}, relations)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.relationships, [
        { type: "parent", targetId: "azure-test:10" },
        { type: "related", targetId: "azure-test:11" },
      ]);
    }
  );
});

test("RTI-7F relationships: malformed relation url fails closed", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, {}, [{ rel: "System.LinkTypes.Related", url: "not-a-url" }])]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /missing or invalid target "url"/);
    }
  );
});

test("RTI-7F relationships: malformed relation missing rel fails closed", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, {}, [{ url: "https://dev.azure.com/contoso/_apis/wit/workItems/10" }])]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      await assert.rejects(() => provider.read(), /missing or invalid "rel"/);
    }
  );
});

test("RTI-7F relationships: out-of-snapshot target is allowed, no extra fetch", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, {}, [{ rel: "System.LinkTypes.Related", url: "https://dev.azure.com/contoso/_apis/wit/workItems/999" }])]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.relationships, [{ type: "related", targetId: "azure-test:999" }]);
    }
  );
});

// --- Identity / provenance -------------------------------------------------

test("RTI-7F identity: exact formula, opaque, provider-qualified, collision-safe across instances", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([123]));
      respondJson(res, 200, batchResult([workItem(123)]));
    },
    async () => {
      const providerA = new AzureDevOpsRequirementsProvider(makeConfig({ id: "azure-prod" }));
      const providerB = new AzureDevOpsRequirementsProvider(makeConfig({ id: "azure-sandbox" }));
      const [a] = await providerA.read();
      const [b] = await providerB.read();
      assert.equal(a.id, "azure-prod:123");
      assert.equal(b.id, "azure-sandbox:123");
      assert.notEqual(a.id, b.id);
    }
  );
});

test("RTI-7F identity: stable across timeout/batch-grouping/rev/description changes", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Title": "Old" }, undefined)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ timeoutMs: 1000 }));
      const [before] = await provider.read();
      assert.equal(before.id, "azure-test:1");
    }
  );
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      const item = workItem(1, { "System.Title": "New" });
      item.rev = 5;
      respondJson(res, 200, batchResult([item]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ timeoutMs: 5000 }));
      const [after] = await provider.read();
      assert.equal(after.id, "azure-test:1");
      assert.equal(after.source.version, "5");
    }
  );
});

test("RTI-7F provenance: source fields exact", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([42]));
      const item = workItem(42, { "System.Title": "Login flow" });
      item.rev = 3;
      respondJson(res, 200, batchResult([item]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ id: "azure-contoso", organization: "contoso", project: "MyProject" }));
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.source, {
        type: "azure-devops",
        sourceId: "42",
        system: "contoso/MyProject",
        location: "https://dev.azure.com/contoso/MyProject/_workitems/edit/42/",
        version: "3",
      });
    }
  );
});

test("RTI-7F provenance: source.location safely percent-encodes organization/project", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1)]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ project: "My Project" }));
      const [artifact] = await provider.read();
      const parsed = new URL(artifact.source.location);
      assert.equal(parsed.origin, "https://dev.azure.com");
      assert.equal(parsed.pathname, "/contoso/My%20Project/_workitems/edit/1/");
    }
  );
});

// --- Metadata / raw payload ------------------------------------------------

test("RTI-7F: metadata is selective and bounded, raw fields never persisted", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.WorkItemType": "Bug", "System.State": "Active" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const [artifact] = await provider.read();
      assert.deepEqual(artifact.metadata, { workItemType: "Bug", state: "Active" });
      assert.equal(JSON.stringify(artifact).includes("fields"), false);
    }
  );
});

// --- Error / secret safety -------------------------------------------------

test("RTI-7F error safety: no thrown error contains PAT, Bearer token, Authorization, or WIQL", async () => {
  const secretToken = "SUPER-SECRET-PAT-VALUE";
  const secretWiql = "SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS 'internal-secret-codename'";
  await withServer(
    (req, res) => {
      res.writeHead(500);
      res.end();
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig({ auth: { type: "pat", token: secretToken }, wiql: secretWiql }));
      try {
        await provider.read();
        assert.fail("expected rejection");
      } catch (err) {
        assert.equal(err.message.includes(secretToken), false);
        assert.equal(err.message.includes(secretWiql), false);
        assert.equal(err.message.toLowerCase().includes("authorization"), false);
      }
    }
  );
});

test("RTI-7F error safety: HTTP error responses never leak the raw response body", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "SENSITIVE_INTERNAL_DETAIL" }));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      try {
        await provider.read();
        assert.fail("expected rejection");
      } catch (err) {
        assert.equal(err.message.includes("SENSITIVE_INTERNAL_DETAIL"), false);
      }
    }
  );
});

// --- RTI-6 integration + full pipeline -----------------------------------

test("RTI-7F: RTI-6's loadRequirementsFromProvider accepts the Azure provider directly", async () => {
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Description": "<p>Login accepts valid credentials.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      assert.equal(requirements.length, 1);
      assert.equal(requirements[0].id, "azure-test:1");
      assert.ok(Object.isFrozen(requirements));
    }
  );
});

test("RTI-7F: full RTI-6 -> RTI-3 -> RTI-4 -> RTI-5 pipeline reaches FULLY_COVERED for a READY Azure requirement", async () => {
  const { analyzeRequirementsQuality } = require("../requirement-quality");
  const { generateTestDesigns } = require("../test-design");
  const { buildRequirementTraceability, analyzeRequirementsCoverage } = require("../requirement-traceability");

  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Title": "Login", "System.Description": "<p>When valid credentials are supplied, the API returns HTTP 200.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
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

test("RTI-7F: a vague Azure requirement ingests successfully - RTI-3 classifies it downstream, the adapter does not judge quality", async () => {
  const { analyzeRequirementQuality } = require("../requirement-quality");
  await withServer(
    (req, res) => {
      if (req.url.includes("/wiql")) return respondJson(res, 200, wiqlResult([1]));
      respondJson(res, 200, batchResult([workItem(1, { "System.Title": "Performance", "System.Description": "<p>The application should respond quickly.</p>" })]));
    },
    async () => {
      const provider = new AzureDevOpsRequirementsProvider(makeConfig());
      const requirements = await loadRequirementsFromProvider(provider);
      assert.equal(requirements.length, 1);
      assert.equal(analyzeRequirementQuality(requirements[0]).status, "AMBIGUOUS");
    }
  );
});
