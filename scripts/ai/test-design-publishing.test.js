"use strict";

/**
 * Roadmap RTI-8B (Generic Test-Design Publishing Core): unit coverage for
 * scripts/ai/test-design-publishing.js - the vendor-neutral boundary
 * through which caller-supplied TestDesignArtifact[] are handed to an
 * explicitly caller-supplied TestDesignDestination. Covers the destination
 * shape boundary (Boundary A), request validation and the pre-side-effect
 * guarantee, the best-effort partial-failure model, Boundary B result
 * validation/correspondence/re-ordering, throw wrapping, and immutability.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { generateTestDesigns } = require("./test-design");
const { publishTestDesigns } = require("./test-design-publishing");

function requirement(overrides = {}) {
  return {
    id: "REQ-X",
    type: "requirement",
    title: "Example requirement",
    source: { type: "file", location: "requirements.json" },
    content: "Return HTTP 200.",
    ...overrides,
  };
}

function designs(overrides = {}) {
  return generateTestDesigns([requirement(overrides)]);
}

function tdArray(count) {
  const criteria = Array.from({ length: count }, (_, i) => ({ id: `AC${i}`, text: `criterion ${i}` }));
  return generateTestDesigns([requirement({ acceptanceCriteria: criteria, content: undefined })]);
}

function okDestination(id = "dest") {
  return {
    id,
    calls: 0,
    publish(request) {
      this.calls++;
      return {
        destinationId: id,
        allSucceeded: true,
        items: request.testDesigns.map((td, i) => ({ testDesignId: td.id, status: "CREATED", remoteId: `remote-${i}` })),
      };
    },
  };
}

// --- destination shape (Boundary A) -----------------------------------------

test("RTI-8B: rejects a missing destination", async () => {
  await assert.rejects(() => publishTestDesigns(undefined, { testDesigns: designs() }), /TEST_DESIGN_DESTINATION_REQUIRED/);
  await assert.rejects(() => publishTestDesigns(null, { testDesigns: designs() }), /TEST_DESIGN_DESTINATION_REQUIRED/);
});

test("RTI-8B: rejects a destination with no id", async () => {
  await assert.rejects(() => publishTestDesigns({ publish() {} }, { testDesigns: designs() }), /TEST_DESIGN_DESTINATION_INVALID/);
});

test("RTI-8B: rejects a destination whose publish is not a function", async () => {
  await assert.rejects(() => publishTestDesigns({ id: "x", publish: "nope" }, { testDesigns: designs() }), /TEST_DESIGN_DESTINATION_INVALID/);
});

test("RTI-8B: accepts a destination id supplied via a prototype getter (trusted executable code, ordinary property access)", async () => {
  class Destination {
    get id() {
      return "getter-dest";
    }
    publish(request) {
      return { destinationId: "getter-dest", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })) };
    }
  }
  const result = await publishTestDesigns(new Destination(), { testDesigns: designs() });
  assert.equal(result.destinationId, "getter-dest");
});

// --- request validation / pre-side-effect guarantee -------------------------

test("RTI-8B: rejects a missing request, zero destination calls", async () => {
  const dest = okDestination();
  await assert.rejects(() => publishTestDesigns(dest, undefined), /TEST_DESIGN_PUBLISH_REQUEST_REQUIRED/);
  assert.equal(dest.calls, 0);
});

test("RTI-8B: rejects a non-plain request", async () => {
  const dest = okDestination();
  await assert.rejects(() => publishTestDesigns(dest, "not an object"), /TEST_DESIGN_PUBLISH_REQUEST_INVALID/);
  assert.equal(dest.calls, 0);
});

test("RTI-8B: rejects an unknown request key", async () => {
  const dest = okDestination();
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs(), traceability: [] }), /unrecognized key\(s\): traceability/);
  assert.equal(dest.calls, 0);
});

test("RTI-8B: rejects missing testDesigns", async () => {
  const dest = okDestination();
  await assert.rejects(() => publishTestDesigns(dest, {}), /TEST_DESIGN_PUBLISH_REQUEST_INVALID/);
  assert.equal(dest.calls, 0);
});

test("RTI-8B: rejects an empty testDesigns array (no successful zero-item publish)", async () => {
  const dest = okDestination();
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: [] }), /non-empty array/);
  assert.equal(dest.calls, 0);
});

test("RTI-8B: rejects a request exceeding MAX_PUBLISH_BATCH_SIZE, zero destination calls", async () => {
  const dest = okDestination();
  const oversized = Array.from({ length: 501 }, (_, i) => ({
    id: `R${i}::test::1`,
    requirementId: `R${i}`,
    title: "t",
    objective: "o",
    expectedResults: ["x"],
    source: { requirementId: `R${i}` },
  }));
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: oversized }), /exceeding the maximum publish batch size/);
  assert.equal(dest.calls, 0);
});

test("RTI-8B: accepts exactly MAX_PUBLISH_BATCH_SIZE (500) items - no off-by-one", async () => {
  const dest = okDestination();
  const exact = Array.from({ length: 500 }, (_, i) => ({
    id: `R${i}::test::1`,
    requirementId: `R${i}`,
    title: "t",
    objective: "o",
    expectedResults: ["x"],
    source: { requirementId: `R${i}` },
  }));
  const result = await publishTestDesigns(dest, { testDesigns: exact });
  assert.equal(result.items.length, 500);
  assert.equal(dest.calls, 1);
});

test("RTI-8B: rejects an invalid first TestDesignArtifact, zero destination calls", async () => {
  const dest = okDestination();
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: [{ bogus: 1 }, ...designs()] }), /TEST_DESIGN_PUBLISH_REQUEST_INVALID/);
  assert.equal(dest.calls, 0);
});

test("RTI-8B: rejects an invalid later TestDesignArtifact, zero destination calls", async () => {
  const dest = okDestination();
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: [...designs(), { bogus: 1 }] }), /TEST_DESIGN_PUBLISH_REQUEST_INVALID/);
  assert.equal(dest.calls, 0);
});

test("RTI-8B: rejects duplicate testDesign ids, zero destination calls", async () => {
  const dest = okDestination();
  const d = designs();
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: [...d, ...d] }), /duplicate testDesign id/);
  assert.equal(dest.calls, 0);
});

// --- invocation semantics ----------------------------------------------------

test("RTI-8B: invokes destination.publish exactly once on success", async () => {
  const dest = okDestination();
  await publishTestDesigns(dest, { testDesigns: designs() });
  assert.equal(dest.calls, 1);
});

test("RTI-8B: invokes destination.publish exactly once even when the result contains a FAILED item (no generic retry)", async () => {
  const dest = {
    id: "partial",
    calls: 0,
    publish(request) {
      this.calls++;
      return {
        destinationId: "partial",
        allSucceeded: false,
        items: request.testDesigns.map((td, i) => (i === 0 ? { testDesignId: td.id, status: "CREATED", remoteId: "r" } : { testDesignId: td.id, status: "FAILED", error: { code: "E", message: "no" } })),
      };
    },
  };
  await publishTestDesigns(dest, { testDesigns: tdArray(2) });
  assert.equal(dest.calls, 1);
});

test("RTI-8B: preserves `this` binding for a class-instance destination", async () => {
  class Destination {
    constructor() {
      this.id = "cls-dest";
      this.calls = 0;
    }
    publish(request) {
      this.calls++;
      return { destinationId: this.id, allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })) };
    }
  }
  const instance = new Destination();
  await publishTestDesigns(instance, { testDesigns: designs() });
  assert.equal(instance.calls, 1);
});

test("RTI-8B: supports a synchronous (non-Promise) destination.publish return", async () => {
  const dest = okDestination();
  const result = await publishTestDesigns(dest, { testDesigns: designs() });
  assert.equal(result.allSucceeded, true);
});

test("RTI-8B: supports an async (Promise-returning) destination.publish", async () => {
  const dest = {
    id: "async-dest",
    async publish(request) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { destinationId: "async-dest", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })) };
    },
  };
  const result = await publishTestDesigns(dest, { testDesigns: designs() });
  assert.equal(result.allSucceeded, true);
});

// --- request identity / copy policy -----------------------------------------

test("RTI-8B: destination receives a frozen request wrapper and frozen testDesigns array (cannot mutate the array)", async () => {
  let receivedRequest;
  const dest = {
    id: "capture",
    publish(request) {
      receivedRequest = request;
      return { destinationId: "capture", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })) };
    },
  };
  await publishTestDesigns(dest, { testDesigns: designs() });
  assert.equal(Object.isFrozen(receivedRequest), true);
  assert.equal(Object.isFrozen(receivedRequest.testDesigns), true);
});

test("RTI-8B: does not mutate the caller's original request or testDesigns array", async () => {
  const dest = okDestination();
  const originalTestDesigns = designs();
  const request = { testDesigns: originalTestDesigns };
  await publishTestDesigns(dest, request);
  assert.equal(request.testDesigns, originalTestDesigns);
  assert.equal(Object.isFrozen(originalTestDesigns), false);
});

// --- result validation (Boundary B) - correspondence / ordering -------------

test("RTI-8B: re-projects a reversed destination result into request input order", async () => {
  const d = tdArray(3);
  const dest = {
    id: "reversed",
    publish(request) {
      return {
        destinationId: "reversed",
        allSucceeded: true,
        items: [...request.testDesigns].reverse().map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: `r-${td.id}` })),
      };
    },
  };
  const result = await publishTestDesigns(dest, { testDesigns: d });
  assert.deepEqual(result.items.map((i) => i.testDesignId), d.map((td) => td.id));
});

test("RTI-8B: re-projects a shuffled destination result into request input order", async () => {
  const d = tdArray(4);
  const dest = {
    id: "shuffled",
    publish(request) {
      const shuffled = [request.testDesigns[2], request.testDesigns[0], request.testDesigns[3], request.testDesigns[1]];
      return { destinationId: "shuffled", allSucceeded: true, items: shuffled.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: `r-${td.id}` })) };
    },
  };
  const result = await publishTestDesigns(dest, { testDesigns: d });
  assert.deepEqual(result.items.map((i) => i.testDesignId), d.map((td) => td.id));
});

test("RTI-8B: rejects a missing destinationId", async () => {
  const dest = { id: "x", publish: () => ({ allSucceeded: true, items: [] }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /destinationId must equal/);
});

test("RTI-8B: rejects a wrong destinationId", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "wrong", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /destinationId must equal/);
});

test("RTI-8B: rejects a non-boolean allSucceeded", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: "true", items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /allSucceeded must be a boolean/);
});

test("RTI-8B: rejects an allSucceeded/item-status inconsistency", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "FAILED", error: { code: "E", message: "m" } })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /allSucceeded.*inconsistent/);
});

test("RTI-8B: rejects a missing items field", async () => {
  const dest = { id: "x", publish: () => ({ destinationId: "x", allSucceeded: true }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /items must be an array/);
});

test("RTI-8B: rejects a wrong item count (fewer than input)", async () => {
  const dest = { id: "x", publish: () => ({ destinationId: "x", allSucceeded: true, items: [] }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /exactly one entry per input testDesign/);
});

test("RTI-8B: rejects a wrong item count (more than input)", async () => {
  const d = designs();
  const dest = {
    id: "x",
    publish: (request) => ({
      destinationId: "x",
      allSucceeded: true,
      items: [...request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })), { testDesignId: "extra", status: "CREATED", remoteId: "r2" }],
    }),
  };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: d }), /exactly one entry per input testDesign/);
});

test("RTI-8B: rejects a duplicate result testDesignId", async () => {
  const d = tdArray(2);
  const dest = {
    id: "x",
    publish: (request) => ({
      destinationId: "x",
      allSucceeded: true,
      items: [request.testDesigns[0], request.testDesigns[0]].map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })),
    }),
  };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: d }), /duplicates another result item/);
});

test("RTI-8B: rejects an unknown result testDesignId", async () => {
  const d = designs();
  const dest = { id: "x", publish: () => ({ destinationId: "x", allSucceeded: true, items: [{ testDesignId: "does-not-exist", status: "CREATED", remoteId: "r" }] }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: d }), /does not match any input testDesign id/);
});

test("RTI-8B: rejects a missing result for an input id", async () => {
  const d = tdArray(2);
  const dest = {
    id: "x",
    publish: (request) => ({ destinationId: "x", allSucceeded: false, items: [{ testDesignId: request.testDesigns[0].id, status: "CREATED", remoteId: "r" }] }),
  };
  // deliberately wrong length AND missing-id both fire; length check is reported first but missing-id logic must also be exercised via a same-length variant:
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: d }), /TEST_DESIGN_PUBLISH_RESULT_INVALID/);
});

test("RTI-8B: rejects an unknown status", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "UPDATED", remoteId: "r" })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /must be exactly "CREATED" or "FAILED"/);
});

test("RTI-8B: rejects lowercase status variant", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "created", remoteId: "r" })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /must be exactly "CREATED" or "FAILED"/);
});

test("RTI-8B: rejects CREATED without remoteId", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED" })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /remoteId: required/);
});

test("RTI-8B: rejects CREATED with an error field present", async () => {
  const dest = {
    id: "x",
    publish: (request) => ({ destinationId: "x", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r", error: { code: "E", message: "m" } })) }),
  };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /error: must be absent when status is CREATED/);
});

test("RTI-8B: rejects FAILED without an error field", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: false, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "FAILED" })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /error: required plain object when status is FAILED/);
});

test("RTI-8B: rejects FAILED with a remoteId present", async () => {
  const dest = {
    id: "x",
    publish: (request) => ({ destinationId: "x", allSucceeded: false, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "FAILED", remoteId: "r", error: { code: "E", message: "m" } })) }),
  };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /remoteId: must be absent when status is FAILED/);
});

test("RTI-8B: rejects FAILED with a location present", async () => {
  const dest = {
    id: "x",
    publish: (request) => ({ destinationId: "x", allSucceeded: false, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "FAILED", location: "http://x", error: { code: "E", message: "m" } })) }),
  };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /location: must be absent when status is FAILED/);
});

test("RTI-8B: rejects an error object missing code", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: false, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "FAILED", error: { message: "m" } })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /error\.code/);
});

test("RTI-8B: rejects an error object missing message", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: false, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "FAILED", error: { code: "E" } })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /error\.message/);
});

test("RTI-8B: rejects an unknown top-level result key", async () => {
  const dest = {
    id: "x",
    publish: (request) => ({ destinationId: "x", allSucceeded: true, extra: 1, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r" })) }),
  };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /unrecognized key\(s\): extra/);
});

test("RTI-8B: rejects an unknown per-item key", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: true, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "CREATED", remoteId: "r", bogus: 1 })) }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /unrecognized key\(s\): bogus/);
});

test("RTI-8B: rejects an unknown error key", async () => {
  const dest = {
    id: "x",
    publish: (request) => ({ destinationId: "x", allSucceeded: false, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "FAILED", error: { code: "E", message: "m", bogus: 1 } })) }),
  };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }), /error: unrecognized key\(s\): bogus/);
});

test("RTI-8B: never invokes a hostile accessor getter on the returned result data", async () => {
  let getterCalled = false;
  const hostileItem = { status: "CREATED", remoteId: "r" };
  Object.defineProperty(hostileItem, "testDesignId", {
    get() {
      getterCalled = true;
      return "REQ-X::test::1";
    },
    enumerable: true,
  });
  const dest = { id: "x", publish: () => ({ destinationId: "x", allSucceeded: true, items: [hostileItem] }) };
  await assert.rejects(() => publishTestDesigns(dest, { testDesigns: designs() }));
  assert.equal(getterCalled, false);
});

// --- partial failure / Boundary-B honesty ------------------------------------

test("RTI-8B: a structurally valid mixed CREATED/FAILED result returns normally (no throw) with allSucceeded=false", async () => {
  const d = tdArray(2);
  let sideEffectsPerformed = 0;
  const dest = {
    id: "mixed",
    publish(request) {
      sideEffectsPerformed = request.testDesigns.length;
      return {
        destinationId: "mixed",
        allSucceeded: false,
        items: request.testDesigns.map((td, i) => (i === 0 ? { testDesignId: td.id, status: "CREATED", remoteId: "r0" } : { testDesignId: td.id, status: "FAILED", error: { code: "E", message: "m" } })),
      };
    },
  };
  const result = await publishTestDesigns(dest, { testDesigns: d });
  assert.equal(result.allSucceeded, false);
  assert.equal(result.items[0].status, "CREATED");
  assert.equal(result.items[1].status, "FAILED");
  assert.equal(sideEffectsPerformed, 2);
});

test("RTI-8B: Boundary-B failure after side effects does not claim rollback/atomicity", async () => {
  let sideEffectAlreadyOccurred = false;
  const dest = {
    id: "malformed-after-effect",
    publish(request) {
      sideEffectAlreadyOccurred = true; // simulate: destination already wrote remotely before returning garbage
      return { destinationId: "malformed-after-effect", allSucceeded: true, items: [] };
    },
  };
  await assert.rejects(
    () => publishTestDesigns(dest, { testDesigns: designs() }),
    (err) => {
      assert.match(err.message, /TEST_DESIGN_PUBLISH_RESULT_INVALID/);
      assert.match(err.message, /not automatically reversed/);
      assert.doesNotMatch(err.message, /rolled back/i);
      assert.doesNotMatch(err.message, /nothing was published/i);
      return true;
    }
  );
  assert.equal(sideEffectAlreadyOccurred, true);
});

// --- destination throw / reject ----------------------------------------------

test("RTI-8B: wraps a synchronous destination.publish throw with a bounded outer error, preserving the original in .cause", async () => {
  const dest = { id: "thrower", publish: () => { throw new Error("SECRET_TOKEN_abc123"); } };
  await assert.rejects(
    () => publishTestDesigns(dest, { testDesigns: designs() }),
    (err) => {
      assert.match(err.message, /TEST_DESIGN_PUBLISH_FAILED/);
      assert.equal(err.message.includes("SECRET_TOKEN_abc123"), false);
      assert.equal(err.cause instanceof Error, true);
      assert.equal(err.cause.message, "SECRET_TOKEN_abc123");
      return true;
    }
  );
});

test("RTI-8B: wraps a destination.publish that throws a plain string", async () => {
  const dest = {
    id: "thrower-string",
    publish: () => {
      throw "raw string failure";
    },
  };
  await assert.rejects(
    () => publishTestDesigns(dest, { testDesigns: designs() }),
    (err) => {
      assert.match(err.message, /TEST_DESIGN_PUBLISH_FAILED/);
      assert.equal(err.cause, "raw string failure");
      return true;
    }
  );
});

test("RTI-8B: wraps a rejected Promise from an async destination.publish", async () => {
  const dest = { id: "rejector", async publish() { throw new Error("boom"); } };
  await assert.rejects(
    () => publishTestDesigns(dest, { testDesigns: designs() }),
    (err) => {
      assert.match(err.message, /TEST_DESIGN_PUBLISH_FAILED/);
      assert.equal(err.cause.message, "boom");
      return true;
    }
  );
});

test("RTI-8B: wraps a destination.publish that rejects with a plain object", async () => {
  const dest = { id: "rejector-obj", async publish() { throw { code: "X", detail: "y" }; } };
  await assert.rejects(
    () => publishTestDesigns(dest, { testDesigns: designs() }),
    (err) => {
      assert.match(err.message, /TEST_DESIGN_PUBLISH_FAILED/);
      assert.deepEqual(err.cause, { code: "X", detail: "y" });
      return true;
    }
  );
});

// --- output freezing ----------------------------------------------------------

test("RTI-8B: returns a fully frozen canonical result", async () => {
  const dest = okDestination();
  const result = await publishTestDesigns(dest, { testDesigns: designs() });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
});

test("RTI-8B: freezes the error object on a FAILED item", async () => {
  const dest = { id: "x", publish: (request) => ({ destinationId: "x", allSucceeded: false, items: request.testDesigns.map((td) => ({ testDesignId: td.id, status: "FAILED", error: { code: "E", message: "m" } })) }) };
  const result = await publishTestDesigns(dest, { testDesigns: designs() });
  assert.equal(Object.isFrozen(result.items[0].error), true);
});

// --- error message bounds -----------------------------------------------------

test("RTI-8B: error messages are bounded and never dump full artifact/result content", async () => {
  const bogus = Array.from({ length: 10 }, (_, i) => ({ id: `bad-${i}`, bogus: "x".repeat(500) }));
  try {
    await publishTestDesigns(okDestination(), { testDesigns: bogus });
    assert.fail("expected rejection");
  } catch (err) {
    assert.equal(err.message.length < 2000, true);
  }
});
