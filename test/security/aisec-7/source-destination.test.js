"use strict";

/**
 * AISEC-7 H-10 (source / destination / redirect / outcome) and H-04
 * (remote-content diagnostics through the requirements loader).
 *
 * globalThis.fetch is replaced by a scripted stub for every case: no socket
 * is opened and an unscripted call throws. The organization/project names
 * are synthetic, the token is an inert dummy. Request counts, URLs, redirect
 * mode and headers are read from the stub's own call log.
 */

const nodeTest = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const fx = require("./lib/fixtures");
const { createEvidenceLedger } = require("./lib/execution-ledger");

const ledger = createEvidenceLedger(__filename);
const { confirmCase } = ledger;

// Registered from this file so node:test attributes every result to it; the
// ledger records completion and refuses test options (SEC-02).
function test(name, fn) {
  return nodeTest(name, ledger.track(name, fn));
}
test.after = nodeTest.after;

const { AzureDevOpsTestCaseDestination } = require(path.join(fx.AI, "destinations", "azure-devops-test-case-destination.js"));
const { AzureDevOpsRequirementsProvider } = require(path.join(fx.AI, "providers", "azure-devops-requirements-provider.js"));
const { publishTestDesigns, loadRequirementsFromProvider } = require(path.join(fx.AI, "index.js"));

const ORG = "aisec7-org";
const DUMMY_BASIC = Buffer.from(`:${fx.DUMMY_TOKEN}`, "utf8").toString("base64");

function destination(project = "aisec7-project-a") {
  return new AzureDevOpsTestCaseDestination({ id: "aisec7-destination", organization: ORG, project, auth: { type: "pat", token: fx.DUMMY_TOKEN }, timeoutMs: 1000 });
}

function designs(count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    id: `REQ-A::aisec7::${i + 1}`,
    requirementId: "REQ-A",
    title: `Synthetic design ${i + 1}`,
    objective: "Synthetic objective.",
    expectedResults: ["Synthetic result."],
    source: { requirementId: "REQ-A" },
  }));
}

function created(id) {
  return fx.jsonResponse(200, { id });
}

async function publish(respond, { project, count = 2 } = {}) {
  return fx.withFetchStub(respond, async (calls) => {
    const result = await publishTestDesigns(destination(project), { testDesigns: designs(count) });
    return { result, calls };
  });
}

const statuses = (result) => result.items.map((item) => item.status === "CREATED" ? "CREATED" : item.error.code);

// --- H-10: destination ---------------------------------------------------------

test("H10-C1: a valid 2xx create sends exactly one POST per item to the fixed https host with redirect:manual and never echoes the dummy token", async () => {
  let next = 100;
  const { result, calls } = await publish(() => created(next++));
  const expectedPrefix = `https://dev.azure.com/${ORG}/aisec7-project-a/_apis/wit/workitems/`;
  const transport = calls.length === 2 && calls.every((c) => c.url.startsWith(expectedPrefix) && c.method === "POST" && c.redirect === "manual" && c.headers.Authorization === `Basic ${DUMMY_BASIC}`);
  const serialized = JSON.stringify(result);
  assert.deepEqual(statuses(result), ["CREATED", "CREATED"]);
  confirmCase("H10-C1", transport && !serialized.includes(fx.DUMMY_TOKEN) && !serialized.includes(DUMMY_BASIC));
});

test("H10-C2: a wrong but valid destination project receives the publish; nothing maps source to destination (ODR-04)", async () => {
  const { result, calls } = await publish(() => created(200), { project: "aisec7-victim-project", count: 1 });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes("/aisec7-victim-project/"), "requirement REQ-A was published into an unrelated project");
  assert.deepEqual(statuses(result), ["CREATED"]);
  confirmCase("H10-C2", null);
});

test("H10-C3: a destination redirect is not followed; the batch stops after one request", async () => {
  const { result, calls } = await publish(() => new Response(null, { status: 302 }));
  assert.deepEqual(statuses(result), ["AZURE_TEST_CASE_REDIRECT_BLOCKED", "AZURE_TEST_CASE_NOT_ATTEMPTED"]);
  confirmCase("H10-C3", calls.length === 1 && calls[0].redirect === "manual");
});

test("H10-C4: an invalid 2xx is item-local and the batch continues with the next create (ODR-09)", async () => {
  const { result, calls } = await publish((call, index) => (index === 0 ? fx.jsonResponse(200, { id: "not-a-number" }) : created(301)));
  assert.equal(calls.length, 2, "the second create was sent after a possibly-created first item");
  assert.deepEqual(statuses(result), ["AZURE_TEST_CASE_RESPONSE_INVALID", "CREATED"]);
  assert.match(result.items[0].error.message, /remote creation may have occurred/);
  confirmCase("H10-C4", null);
});

test("H10-C5: a transport failure yields OUTCOME_UNKNOWN with no retry; remaining items are NOT_ATTEMPTED", async () => {
  const { result, calls } = await publish(() => { throw new TypeError("aisec7 synthetic transport failure"); });
  assert.deepEqual(statuses(result), ["AZURE_TEST_CASE_OUTCOME_UNKNOWN", "AZURE_TEST_CASE_NOT_ATTEMPTED"]);
  confirmCase("H10-C5", calls.length === 1);
});

test("H10-C6: a 5xx yields OUTCOME_UNKNOWN with no retry and stops the batch", async () => {
  const { result, calls } = await publish(() => fx.jsonResponse(503, { message: "synthetic" }));
  assert.deepEqual(statuses(result), ["AZURE_TEST_CASE_OUTCOME_UNKNOWN", "AZURE_TEST_CASE_NOT_ATTEMPTED"]);
  confirmCase("H10-C6", calls.length === 1);
});

test("H10-C7: re-invoking the same batch creates again; there is no idempotency key or durable ledger (ODR-09)", async () => {
  let next = 400;
  const first = await publish(() => created(next++), { count: 1 });
  const second = await publish(() => created(next++), { count: 1 });
  assert.deepEqual([...statuses(first.result), ...statuses(second.result)], ["CREATED", "CREATED"]);
  assert.notEqual(first.result.items[0].remoteId, second.result.items[0].remoteId, "two distinct remote objects for one design");
  confirmCase("H10-C7", null);
});

// --- H-10 / H-04: requirements source -----------------------------------------------

function source() {
  return new AzureDevOpsRequirementsProvider({ id: "aisec7-source", organization: ORG, project: "aisec7-project-a", wiql: "SELECT [System.Id] FROM WorkItems", auth: { type: "pat", token: fx.DUMMY_TOKEN }, timeoutMs: 1000 });
}

async function load(respond) {
  return fx.withFetchStub(respond, async (calls) => {
    const error = await loadRequirementsFromProvider(source()).then(() => null, (e) => e);
    return { error, calls };
  });
}

test("H10-C8: a requirements source redirect is refused and not followed; one request", async () => {
  const { error, calls } = await load(() => new Response(null, { status: 302 }));
  assert.ok(error, "read must fail");
  assert.match(String(error.cause && error.cause.message), /redirect/);
  confirmCase("H10-C8", calls.length === 1 && calls[0].redirect === "manual");
});

async function queryTypeCanaryRun() {
  const marker = fx.canary("REMOTE_QUERY_TYPE");
  const run = await load(() => fx.jsonResponse(200, { queryType: marker, queryResultType: "workItem", workItems: [] }));
  assert.ok(run.error, "read must fail");
  return { ...run, marker };
}

test("H04-C4: the loader's outer error omits a remote queryType canary", async () => {
  const { error, marker } = await queryTypeCanaryRun();
  assert.match(error.message, /^REQUIREMENTS_SOURCE_READ_FAILED/);
  confirmCase("H04-C4", !error.message.includes(marker));
});

test("H04-C5: the remote queryType canary is preserved verbatim in error.cause (whether cause may reach logs/UI/persistence is ODR-03/05)", async () => {
  const { error, marker } = await queryTypeCanaryRun();
  assert.ok(error.cause.message.includes(marker), "remote content reaches the caller-visible cause");
  confirmCase("H04-C5", null);
});
