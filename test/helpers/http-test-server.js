"use strict";

/**
 * Shared local HTTP test-server fixture (Roadmap RTI-8E1) - the generic
 * transport MECHANISM previously duplicated byte-for-byte (44 lines) across
 * scripts/ai/providers/jira-requirements-provider.test.js and
 * scripts/ai/providers/azure-devops-requirements-provider.test.js, extracted
 * once a third network-tested adapter (the future Azure DevOps Test Case
 * destination, Roadmap RTI-8F) crossed the threshold RTI-8A's own carried
 * debt table set for this extraction ("before a third network test adapter
 * of any kind - source or destination").
 *
 * SCOPE - MECHANISM ONLY, NEVER VENDOR POLICY: this module starts a real
 * local Node `http.createServer` on an OS-assigned ephemeral port, captures
 * a request's raw/JSON body, and installs a narrow, temporary replacement
 * of the process-global `fetch` that rewrites only the request's ORIGIN
 * (from whatever host a provider/destination under test is configured
 * against, to `http://127.0.0.1:<port>`) before delegating to the real,
 * original `fetch` - method, headers, body, `redirect`, and `signal` all
 * pass through completely unchanged. It contains zero knowledge of Jira,
 * Azure DevOps, JQL, WIQL, ADF, HTML normalization, ACs, batch ids, JSON
 * Patch, or any other vendor concept - every test file remains entirely
 * responsible for its own request/response assertions and vendor-shaped
 * mock payloads.
 *
 * TEST-ONLY, NEVER SHIPPED: no production module anywhere in this
 * repository imports this file, and it is not reachable from `require
 * ("qa-ai-agent")` or any package subpath - it lives under the repository's
 * top-level `test/` directory, which package.json's own `files` allowlist
 * never includes (only `scripts/ai` is listed), so no `package.json` change
 * was needed to keep it out of the published npm tarball.
 *
 * LIFECYCLE: `withServer(handler, fn)` is the one primary abstraction (the
 * only form either migrated suite ever actually used - `startMockServer`/
 * `closeServer`/`proxyFetchTo` were always private internals of it, never
 * called standalone) - it starts the server, installs the fetch proxy, runs
 * `fn(port)`, and guarantees restore-then-close via `try/finally` even if
 * `fn` throws. A module-level `after()` hook is registered once per process
 * as a safety net in case a test throws before its own `withServer` call
 * unwinds (mirrors both original files' identical safety net exactly).
 *
 * RAW NETWORK CONTROL PRESERVED FOR FUTURE WRITE-SIDE TESTS: `handler`
 * receives the real, raw Node `(req, res)` - nothing is wrapped or hidden -
 * so a future Azure destination test can still do `req.socket.destroy()`
 * for a connection-reset probe, or `res.statusCode = 302; res.setHeader
 * ("Location", ...); res.end()` for a redirect probe, with no new API
 * needed here.
 *
 * ISOLATION: every `withServer` call creates its own server and its own
 * `port` - no module-level shared server, no shared request-array state
 * across calls. Node's test runner isolates each matched test FILE into
 * its own process by default, so the module-level `activeRestore`/`after()`
 * safety net is scoped per test file exactly as it already was before this
 * extraction (each file previously held its own private copy of the same
 * state) - sharing this module across files introduces no new cross-file
 * pollution risk.
 */

const { after } = require("node:test");
const http = require("node:http");

function startMockServer(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      req.rawBody = raw;
      try {
        req.jsonBody = raw.length > 0 ? JSON.parse(raw) : undefined;
      } catch {
        req.jsonBody = undefined;
      }
      handler(req, res);
    });
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

// Safety net: guarantee global.fetch is never left patched if a test
// throws before reaching its own restore call.
after(() => {
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

module.exports = {
  withServer,
  respondJson,
};
