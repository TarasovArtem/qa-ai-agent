"use strict";

/**
 * Roadmap RTI-8F (Azure DevOps Test Case Destination): unit coverage for
 * scripts/ai/destinations/azure-devops-test-case-destination.js.
 *
 * TEST TRANSPORT STRATEGY: uses the RTI-8E1 shared local HTTP test fixture
 * (test/helpers/http-test-server.js) - the exact same mechanism already
 * proven by the Jira/Azure source provider suites, never duplicated here.
 * Every `withServer` call in this file is a single, fully-awaited lifecycle
 * - never nested, never overlapping (RTI-8E1's own carried LOW/INFO
 * non-reentrancy limitation is therefore never reached).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { AzureDevOpsTestCaseDestination } = require("./azure-devops-test-case-destination");
const { withServer, respondJson } = require("../../../test/helpers/http-test-server");

function makeConfig(overrides = {}) {
  return {
    id: "azure-dest-test",
    organization: "contoso",
    project: "MyProject",
    auth: { type: "pat", token: "test-pat-token" },
    ...overrides,
  };
}

function td(overrides = {}) {
  return {
    id: "REQ-X::test::1",
    requirementId: "REQ-X",
    title: "Example title",
    objective: "Example objective",
    expectedResults: ["Example result"],
    source: { requirementId: "REQ-X" },
    ...overrides,
  };
}

function successBody(id, withLocation = true) {
  const body = { id };
  if (withLocation) body._links = { html: { href: `https://dev.azure.com/contoso/MyProject/_workitems/edit/${id}` } };
  return body;
}

// --- constructor / config strictness ----------------------------------------

test("RTI-8F: constructor rejects missing config", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsTestCaseDestination(null), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor rejects a non-object config", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination("not-an-object"), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor rejects missing/empty/invalid id", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ id: undefined })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ id: "" })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ id: 123 })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor rejects missing organization", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ organization: undefined })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor rejects unsafe organization values", () => {
  for (const bad of ["a/b", "a\\b", "a?b", "a#b", "a@b", ".", "..", "https://evil"]) {
    assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ organization: bad })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/, `organization "${bad}" should be rejected`);
  }
});

test("RTI-8F: constructor rejects missing project", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ project: undefined })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor accepts a project name with spaces and Unicode", () => {
  assert.doesNotThrow(() => new AzureDevOpsTestCaseDestination(makeConfig({ project: "My Café Project 日本語" })));
});

test("RTI-8F: constructor rejects missing auth", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ auth: undefined })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor rejects an unknown auth.type", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "oauth1", token: "x" } })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor rejects an empty auth.token", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "pat", token: "" } })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor rejects CR/LF in auth.token (header injection defense)", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "pat", token: "tok\r\nX-Injected: 1" } })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "pat", token: "tok\n" } })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/);
});

test("RTI-8F: constructor rejects an unknown top-level config key", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ baseUrl: "https://evil" })), /unrecognized config key\(s\): baseUrl/);
});

test("RTI-8F: constructor rejects an unknown auth key", () => {
  assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "pat", token: "x", scope: "y" } })), /"auth" has unrecognized key\(s\): scope/);
});

test("RTI-8F: constructor rejects invalid timeoutMs (type, bounds)", () => {
  for (const bad of [NaN, Infinity, -Infinity, 1.5, "1000", 999, 120001, null]) {
    assert.throws(() => new AzureDevOpsTestCaseDestination(makeConfig({ timeoutMs: bad })), /AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID/, `timeoutMs ${bad} should be rejected`);
  }
});

test("RTI-8F: constructor accepts valid PAT config, valid Bearer config, and a custom in-range timeout", () => {
  assert.doesNotThrow(() => new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "pat", token: "x" } })));
  assert.doesNotThrow(() => new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "bearer", token: "x" } })));
  assert.doesNotThrow(() => new AzureDevOpsTestCaseDestination(makeConfig({ timeoutMs: 1000 })));
  assert.doesNotThrow(() => new AzureDevOpsTestCaseDestination(makeConfig({ timeoutMs: 120000 })));
});

test("RTI-8F: constructor does not perform any network I/O", () => {
  // constructing with an unreachable-looking config must not throw or hang
  assert.doesNotThrow(() => new AzureDevOpsTestCaseDestination(makeConfig()));
});

test("RTI-8F: constructor does not mutate the caller's config or auth object", () => {
  const config = makeConfig();
  const authRef = config.auth;
  const json = JSON.stringify(config);
  new AzureDevOpsTestCaseDestination(config);
  assert.equal(JSON.stringify(config), json);
  assert.equal(config.auth, authRef);
  assert.equal(Object.isFrozen(config), false);
});

test("RTI-8F: public instance surface does not expose token/auth/config", () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  assert.equal(Object.keys(dest).includes("auth"), false);
  assert.equal(Object.keys(dest).includes("token"), false);
  assert.equal(JSON.stringify(dest).includes("test-pat-token"), false);
});

// --- URL / encoding ----------------------------------------------------------

test("RTI-8F: request path/query is exactly correct for a simple org/project", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let captured;
  await withServer(
    (req, res) => {
      captured = { method: req.method, url: req.url };
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(captured.method, "POST");
  assert.equal(captured.url, "/contoso/MyProject/_apis/wit/workitems/$Test%20Case?api-version=7.1");
});

test("RTI-8F: project with spaces is percent-encoded", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig({ project: "My Project" }));
  let captured;
  await withServer(
    (req, res) => {
      captured = req.url;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(captured, "/contoso/My%20Project/_apis/wit/workitems/$Test%20Case?api-version=7.1");
});

test("RTI-8F: Unicode project name is percent-encoded", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig({ project: "日本語" }));
  let captured;
  await withServer(
    (req, res) => {
      captured = req.url;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(captured, `/contoso/${encodeURIComponent("日本語")}/_apis/wit/workitems/$Test%20Case?api-version=7.1`);
});

// --- auth headers --------------------------------------------------------

test("RTI-8F: PAT produces exact Basic base64(\":\"+token) header", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "pat", token: "abc123" } }));
  let captured;
  await withServer(
    (req, res) => {
      captured = req.headers["authorization"];
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(captured, `Basic ${Buffer.from(":abc123", "utf8").toString("base64")}`);
});

test("RTI-8F: Bearer produces exact 'Bearer <token>' header", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "bearer", token: "xyz789" } }));
  let captured;
  await withServer(
    (req, res) => {
      captured = req.headers["authorization"];
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(captured, "Bearer xyz789");
});

// --- content type / body ------------------------------------------------

test("RTI-8F: Content-Type is exactly application/json-patch+json", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let captured;
  await withServer(
    (req, res) => {
      captured = req.headers["content-type"];
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(captured, "application/json-patch+json");
});

test("RTI-8F: request body is exactly two JSON Patch operations, Title then Description, in order", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let captured;
  await withServer(
    (req, res) => {
      captured = req.jsonBody;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td({ title: "T", objective: "O", expectedResults: ["R1", "R2"] })] });
    }
  );
  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0], { op: "add", path: "/fields/System.Title", value: "T" });
  assert.equal(captured[1].op, "add");
  assert.equal(captured[1].path, "/fields/System.Description");
  assert.match(captured[1].value, /Objective/);
  assert.match(captured[1].value, /O/);
  assert.match(captured[1].value, /R1/);
  assert.match(captured[1].value, /R2/);
});

test("RTI-8F: request body is deterministic for identical input", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  const bodies = [];
  await withServer(
    (req, res) => {
      bodies.push(req.rawBody);
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td({ id: "A::test::1" })] });
      await dest.publish({ testDesigns: [td({ id: "A::test::1" })] });
    }
  );
  assert.equal(bodies[0], bodies[1]);
});

// --- HTML escaping ---------------------------------------------------------

test("RTI-8F: HTML-escapes &, <, >, \", ' in objective and expectedResults", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let captured;
  await withServer(
    (req, res) => {
      captured = req.jsonBody[1].value;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td({ objective: `A & B < C > D " E ' F`, expectedResults: ["ok"] })] });
    }
  );
  assert.match(captured, /A &amp; B &lt; C &gt; D &quot; E &#39; F/);
});

test("RTI-8F: a <script> tag in objective becomes inert escaped text, never raw markup", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let captured;
  await withServer(
    (req, res) => {
      captured = req.jsonBody[1].value;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td({ objective: `<script>alert("x")</script>`, expectedResults: ["ok"] })] });
    }
  );
  assert.equal(captured.includes("<script>"), false);
  assert.match(captured, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});

test("RTI-8F: all expectedResults entries are preserved, in order, never joined lossily", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let captured;
  await withServer(
    (req, res) => {
      captured = req.jsonBody[1].value;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td({ expectedResults: ["first", "second", "third"] })] });
    }
  );
  const firstIndex = captured.indexOf("first");
  const secondIndex = captured.indexOf("second");
  const thirdIndex = captured.indexOf("third");
  assert.ok(firstIndex >= 0 && secondIndex > firstIndex && thirdIndex > secondIndex);
  assert.equal((captured.match(/<li>/g) || []).length, 3);
});

// --- cross-vendor provenance ------------------------------------------------

test("RTI-8F: a foreign (Jira-shaped) requirementId is never interpreted as numeric or Azure-native, and creates no relation/second request", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let capturedBody;
  await withServer(
    (req, res) => {
      requestCount++;
      capturedBody = req.jsonBody;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      await dest.publish({ testDesigns: [td({ requirementId: "JIRA-123", source: { requirementId: "JIRA-123", criterionId: "AC-99" } })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(JSON.stringify(capturedBody).includes("JIRA-123"), false);
  assert.equal(JSON.stringify(capturedBody).includes("relations"), false);
});

// --- success / response validation -----------------------------------------

test("RTI-8F: valid success response with location produces CREATED with remoteId and location", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 200, successBody(123)),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "CREATED");
  assert.equal(result.items[0].remoteId, "123");
  assert.equal(result.items[0].location, "https://dev.azure.com/contoso/MyProject/_workitems/edit/123");
});

test("RTI-8F: 201 is also accepted as a success status", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 201, successBody(5)),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "CREATED");
});

test("RTI-8F: valid id but no _links.html.href still succeeds, with location omitted", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 200, { id: 7 }),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "CREATED");
  assert.equal(result.items[0].remoteId, "7");
  assert.equal("location" in result.items[0], false);
});

test("RTI-8F: a malicious/foreign location URL is omitted, CREATED still succeeds if id is valid", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 200, { id: 9, _links: { html: { href: "https://evil.example/phish" } } }),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "CREATED");
  assert.equal("location" in result.items[0], false);
});

test("RTI-8F: a javascript: location URL is omitted", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 200, { id: 10, _links: { html: { href: "javascript:alert(1)" } } }),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "CREATED");
  assert.equal("location" in result.items[0], false);
});

test("RTI-8F: overlong location URL is omitted", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  const overlong = "https://dev.azure.com/" + "x".repeat(2100);
  await withServer(
    (req, res) => respondJson(res, 200, { id: 11, _links: { html: { href: overlong } } }),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "CREATED");
  assert.equal("location" in result.items[0], false);
});

test("RTI-8F: missing id in an otherwise-2xx response -> RESPONSE_INVALID, not a throw, not rollback wording", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 200, {}),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "FAILED");
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_RESPONSE_INVALID");
  assert.match(result.items[0].error.message, /may have occurred/);
  assert.doesNotMatch(result.items[0].error.message, /rolled back|nothing was created/i);
});

test("RTI-8F: invalid id shapes (null, 0, negative, fractional, string) -> RESPONSE_INVALID", async () => {
  for (const badId of [null, 0, -1, 1.5, "123"]) {
    const dest = new AzureDevOpsTestCaseDestination(makeConfig());
    let result;
    await withServer(
      (req, res) => respondJson(res, 200, { id: badId }),
      async () => {
        result = await dest.publish({ testDesigns: [td()] });
      }
    );
    assert.equal(result.items[0].status, "FAILED", `id ${JSON.stringify(badId)} should be FAILED`);
    assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_RESPONSE_INVALID");
  }
});

test("RTI-8F: invalid JSON in a 2xx body -> RESPONSE_INVALID, no raw body in error", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not-json{{{secret-marker");
    },
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "FAILED");
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_RESPONSE_INVALID");
  assert.equal(result.items[0].error.message.includes("secret-marker"), false);
});

test("RTI-8F: valid JSON but wrong shape (array instead of object) -> RESPONSE_INVALID", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 200, [1, 2, 3]),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(result.items[0].status, "FAILED");
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_RESPONSE_INVALID");
});

// --- Azure title limit -------------------------------------------------------

test("RTI-8F: a title within Azure's 255-char limit is sent; no local rejection", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ title: "T".repeat(255) })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(result.items[0].status, "CREATED");
});

test("RTI-8F: a title exceeding Azure's 255-char limit fails locally with zero network request, and does not truncate", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      respondJson(res, 200, successBody(1));
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ title: "T".repeat(256) })] });
    }
  );
  assert.equal(requestCount, 0, "must not attempt a network request for a locally-invalid title");
  assert.equal(result.items[0].status, "FAILED");
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_CREATE_REJECTED");
});

// --- per-item continuation (400/409) -----------------------------------------

test("RTI-8F: HTTP 400 on item A then success on item B - both attempted, no retry, no short-circuit", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      if (requestCount === 1) return respondJson(res, 400, { message: "bad" });
      respondJson(res, 200, successBody(2));
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 2);
  assert.equal(result.items[0].status, "FAILED");
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_CREATE_REJECTED");
  assert.equal(result.items[1].status, "CREATED");
  assert.equal(result.allSucceeded, false);
});

test("RTI-8F: HTTP 409 on item A then success on item B - continues, no retry", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      if (requestCount === 1) return respondJson(res, 409, { message: "conflict" });
      respondJson(res, 200, successBody(2));
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 2);
  assert.equal(result.items[0].status, "FAILED");
  assert.equal(result.items[1].status, "CREATED");
});

// --- global short-circuit ----------------------------------------------------

test("RTI-8F: HTTP 401 short-circuits - only one network request for three inputs, remainder NOT_ATTEMPTED", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      respondJson(res, 401, { message: "unauthorized" });
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" }), td({ id: "C::test::1" })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_AUTH_FAILED");
  assert.equal(result.items[1].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
  assert.equal(result.items[2].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
  assert.equal(result.items.length, 3);
});

test("RTI-8F: HTTP 403 short-circuits", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      respondJson(res, 403, {});
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_PERMISSION_DENIED");
  assert.equal(result.items[1].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
});

test("RTI-8F: HTTP 404 short-circuits", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      respondJson(res, 404, {});
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_TARGET_NOT_FOUND");
  assert.equal(result.items[1].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
});

test("RTI-8F: HTTP 429 short-circuits, no retry even with Retry-After present", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      respondJson(res, 429, {}, { "Retry-After": "1" });
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_RATE_LIMITED");
  assert.equal(result.items[1].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
});

test("RTI-8F: HTTP 3xx redirect is not followed and short-circuits; Authorization never reaches the redirect target", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      res.writeHead(302, { Location: "https://evil.example/" });
      res.end();
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 1, "only the local mock server should ever have been contacted - no redirect target");
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_REDIRECT_BLOCKED");
  assert.equal(result.items[1].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
});

test("RTI-8F: HTTP 500 is an ambiguous outcome, short-circuits, no retry, 'may have occurred' wording", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      respondJson(res, 500, {});
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_OUTCOME_UNKNOWN");
  assert.match(result.items[0].error.message, /may have occurred/);
  assert.equal(result.items[1].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
});

test("RTI-8F: timeout is an ambiguous outcome, short-circuits, no retry", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig({ timeoutMs: 1000 }));
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      // never respond - let the client's own timeout fire
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(result.items[0].status, "FAILED");
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_OUTCOME_UNKNOWN");
  assert.match(result.items[0].error.message, /may have occurred/);
  assert.equal(result.items[1].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
});

test("RTI-8F: connection reset (socket destroyed mid-response) is an ambiguous outcome, short-circuits, no retry", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let requestCount = 0;
  let result;
  await withServer(
    (req, res) => {
      requestCount++;
      req.socket.destroy();
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(requestCount, 1);
  assert.equal(result.items[0].status, "FAILED");
  assert.equal(result.items[0].error.code, "AZURE_TEST_CASE_OUTCOME_UNKNOWN");
  assert.equal(result.items[1].error.code, "AZURE_TEST_CASE_NOT_ATTEMPTED");
});

// --- partial / full result semantics -----------------------------------------

test("RTI-8F: mixed CREATED/FAILED/CREATED batch returns normally with allSucceeded=false, input order preserved", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let call = 0;
  let result;
  await withServer(
    (req, res) => {
      call++;
      if (call === 2) return respondJson(res, 400, {});
      respondJson(res, 200, successBody(call));
    },
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" }), td({ id: "C::test::1" })] });
    }
  );
  assert.equal(result.allSucceeded, false);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map((i) => i.status), ["CREATED", "FAILED", "CREATED"]);
  assert.deepEqual(result.items.map((i) => i.testDesignId), ["A::test::1", "B::test::1", "C::test::1"]);
});

test("RTI-8F: all-success batch returns allSucceeded=true", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 200, successBody(1)),
    async () => {
      result = await dest.publish({ testDesigns: [td({ id: "A::test::1" }), td({ id: "B::test::1" })] });
    }
  );
  assert.equal(result.allSucceeded, true);
});

test("RTI-8F: no scenario issues more network requests than attempted items (no retry, ever)", async () => {
  const scenarios = [
    { status: 400 },
    { status: 401 },
    { status: 403 },
    { status: 404 },
    { status: 429 },
    { status: 500 },
  ];
  for (const scenario of scenarios) {
    const dest = new AzureDevOpsTestCaseDestination(makeConfig());
    let requestCount = 0;
    await withServer(
      (req, res) => {
        requestCount++;
        respondJson(res, scenario.status, {});
      },
      async () => {
        await dest.publish({ testDesigns: [td()] });
      }
    );
    assert.equal(requestCount, 1, `status ${scenario.status} should trigger exactly one request, zero retries`);
  }
});

// --- secret / content safety --------------------------------------------------

test("RTI-8F: a server error body containing the auth token verbatim never leaks into the result", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig({ auth: { type: "pat", token: "SUPER_SECRET_TOKEN_abc" } }));
  let result;
  await withServer(
    (req, res) => respondJson(res, 400, { message: "your token SUPER_SECRET_TOKEN_abc is invalid" }),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(JSON.stringify(result).includes("SUPER_SECRET_TOKEN_abc"), false);
});

test("RTI-8F: canonical title/objective/expectedResults text never appears in error output", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 400, {}),
    async () => {
      result = await dest.publish({ testDesigns: [td({ title: "VERY_UNIQUE_TITLE_MARKER", objective: "VERY_UNIQUE_OBJECTIVE_MARKER" })] });
    }
  );
  assert.equal(JSON.stringify(result).includes("VERY_UNIQUE_TITLE_MARKER"), false);
  assert.equal(JSON.stringify(result).includes("VERY_UNIQUE_OBJECTIVE_MARKER"), false);
});

test("RTI-8F: raw Azure response is never returned or retained (only remoteId/location/normalized error)", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  let result;
  await withServer(
    (req, res) => respondJson(res, 200, { id: 1, fields: { "Secret.Internal": "leak-marker" }, _links: {} }),
    async () => {
      result = await dest.publish({ testDesigns: [td()] });
    }
  );
  assert.equal(JSON.stringify(result).includes("leak-marker"), false);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["remoteId", "status", "testDesignId"]);
});

// --- input immutability (defense-in-depth, generic core already isolates) ---

test("RTI-8F: publish() never mutates the request or its testDesigns", async () => {
  const dest = new AzureDevOpsTestCaseDestination(makeConfig());
  const testDesigns = [td()];
  const request = { testDesigns };
  const before = JSON.stringify(request);
  await withServer(
    (req, res) => respondJson(res, 200, successBody(1)),
    async () => {
      await dest.publish(request);
    }
  );
  assert.equal(JSON.stringify(request), before);
});
