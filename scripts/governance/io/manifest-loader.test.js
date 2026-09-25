"use strict";

// Corrective C1: SEC-L1 (open hardening / check-then-open race) and SEC-L6
// (the returned payload is genuinely immutable).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");
const g = require("../index");

const MANIFEST = '{"schemaVersion":1,"gateId":"example-gate","requiredCapabilities":[],"domains":[]}';

function withRoot(body) {
  const base = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gov-wave0-c1-load-"));
  const root = nodePath.join(base, "repo");
  fs.mkdirSync(nodePath.join(root, "governance"), { recursive: true });
  const file = nodePath.join(root, "governance", "m.json");
  fs.writeFileSync(file, MANIFEST);
  try {
    return body({ base, root, file });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/** An fs whose named functions run a hook (which may swap the file) first. */
function hooked(overrides) {
  return { ...fs, ...overrides };
}

const rejected = (result, reasonCode) => {
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, reasonCode);
  assert.equal("read" in result, false);
  assert.equal("bytes" in result, false);
};

// ---------------------------------------------------------------- SEC-L6

test("SEC-L6: the payload is a read-only handle; there is no shared mutable byte array", () => {
  withRoot(({ root }) => {
    const loaded = g.loadManifestBytes(root, "governance/m.json");
    assert.equal(loaded.ok, true);
    assert.equal(Object.isFrozen(loaded), true);
    assert.equal(loaded.byteLength, MANIFEST.length);
    assert.equal("bytes" in loaded, false);
    assert.throws(() => {
      "use strict";
      loaded.bytes = new Uint8Array(1);
    }, TypeError);
  });
});

test("SEC-L6: mutating one consumer copy cannot affect another copy or the stored data", () => {
  withRoot(({ root }) => {
    const loaded = g.loadManifestBytes(root, "governance/m.json");
    const first = loaded.read();
    const original = Buffer.from(first).toString("utf8");
    first.fill(0x58);
    first[0] = 0;
    const second = loaded.read();
    assert.notEqual(first, second);
    assert.equal(Buffer.from(second).toString("utf8"), original);
    assert.equal(original, MANIFEST);
    assert.equal(g.parseManifestBytes(loaded.read()).valid, true);
    assert.equal(g.parseManifestBytes(first).valid, false);
    assert.equal(g.parseManifestBytes(loaded.read()).valid, true);
  });
});

test("SEC-L6: changing the file on disk after loading does not change the stored payload", () => {
  withRoot(({ root, file }) => {
    const loaded = g.loadManifestBytes(root, "governance/m.json");
    fs.writeFileSync(file, "tampered after load");
    assert.equal(Buffer.from(loaded.read()).toString("utf8"), MANIFEST);
  });
});

test("SEC-L6: the payload is stable for validation even if the internal read buffer is reused by the loader", () => {
  withRoot(({ root, file }) => {
    const a = g.loadManifestBytes(root, "governance/m.json");
    fs.writeFileSync(file, MANIFEST.replace("example-gate", "other-gate"));
    const b = g.loadManifestBytes(root, "governance/m.json");
    assert.match(Buffer.from(a.read()).toString("utf8"), /example-gate/);
    assert.match(Buffer.from(b.read()).toString("utf8"), /other-gate/);
  });
});

// ---------------------------------------------------------------- SEC-L1

test("SEC-L1: a normal manifest still loads and validates", () => {
  withRoot(({ root }) => {
    assert.equal(g.loadManifestFile(root, "governance/m.json").valid, true);
  });
});

test("SEC-L1: the open uses O_NOFOLLOW (where the platform has it) and O_NONBLOCK, and the descriptor is fstat-ed", () => {
  withRoot(({ root }) => {
    let flags = null;
    let fstats = 0;
    const spy = hooked({
      openSync: (p, f, ...rest) => {
        flags = f;
        return fs.openSync(p, f, ...rest);
      },
      fstatSync: (...args) => {
        fstats += 1;
        return fs.fstatSync(...args);
      },
    });
    assert.equal(g.loadManifestBytes(root, "governance/m.json", { fs: spy }).ok, true);
    assert.equal(fstats >= 1, true);
    if (fs.constants.O_NOFOLLOW) assert.equal((flags & fs.constants.O_NOFOLLOW) !== 0, true);
    if (fs.constants.O_NONBLOCK) assert.equal((flags & fs.constants.O_NONBLOCK) !== 0, true);
  });
});

test("SEC-L1: a symlink swapped in after the path check is not followed silently", (t) => {
  withRoot(({ base, root, file }) => {
    const secret = nodePath.join(base, "outside-secret.json");
    fs.writeFileSync(secret, MANIFEST.replace("example-gate", "stolen-gate"));
    const swapping = hooked({
      openSync: (p, f, ...rest) => {
        fs.rmSync(file);
        try {
          fs.symlinkSync(secret, file, "file");
        } catch {
          t.skip("symlinks are not permitted in this environment");
          throw new Error("skip");
        }
        return fs.openSync(p, f, ...rest);
      },
    });
    let result;
    try {
      result = g.loadManifestBytes(root, "governance/m.json", { fs: swapping });
    } catch {
      return;
    }
    // POSIX: O_NOFOLLOW makes the open itself fail. Windows: the opened object is a
    // different file than the one lstat inspected, so the identity check fails.
    rejected(result, "UNSAFE_PATH");
  });
});

test("SEC-L1: a file replaced by a special object (directory) after the check is rejected", () => {
  withRoot(({ root, file }) => {
    const swapping = hooked({
      openSync: (p, f, ...rest) => {
        fs.rmSync(file);
        fs.mkdirSync(file);
        return fs.openSync(p, f, ...rest);
      },
    });
    rejected(g.loadManifestBytes(root, "governance/m.json", { fs: swapping }), "UNSAFE_PATH");
  });
});

test("SEC-L1: a different regular file swapped in after the check fails the identity comparison", () => {
  withRoot(({ root, file }) => {
    const swapping = hooked({
      openSync: (p, f, ...rest) => {
        const replacement = `${file}.replacement`;
        fs.writeFileSync(replacement, MANIFEST.replace("example-gate", "swapped-gate"));
        fs.rmSync(file);
        fs.renameSync(replacement, file);
        return fs.openSync(p, f, ...rest);
      },
    });
    const result = g.loadManifestBytes(root, "governance/m.json", { fs: swapping });
    rejected(result, "UNSAFE_PATH");
  });
});

test("SEC-L1: a file that grows past the limit between the check and the open is rejected as oversized", () => {
  withRoot(({ root, file }) => {
    const growing = hooked({
      openSync: (p, f, ...rest) => {
        fs.appendFileSync(file, " ".repeat(500));
        return fs.openSync(p, f, ...rest);
      },
    });
    rejected(g.loadManifestBytes(root, "governance/m.json", { fs: growing, maxBytes: MANIFEST.length + 10 }), "MANIFEST_TOO_LARGE");
  });
});

test("SEC-L1: growth after fstat cannot cause an unbounded read (the read loop is capped at maxBytes + 1)", () => {
  withRoot(({ root, file }) => {
    const limit = 64;
    fs.writeFileSync(file, "x".repeat(10 * 1024));
    let bytesRead = 0;
    const lying = hooked({
      lstatSync: (p, o) => {
        const s = fs.lstatSync(p, o);
        return o && o.bigint ? Object.create(s, { size: { value: 1n } }) : s;
      },
      fstatSync: (fd, o) => Object.create(fs.fstatSync(fd, o), { size: { value: 1n } }),
      readSync: (...args) => {
        const n = fs.readSync(...args);
        bytesRead += n;
        return n;
      },
    });
    rejected(g.loadManifestBytes(root, "governance/m.json", { fs: lying, maxBytes: limit }), "MANIFEST_TOO_LARGE");
    assert.ok(bytesRead <= limit + 1, `read ${bytesRead} bytes`);
  });
});

test("SEC-L1: an object swapped in after the read (path no longer the opened file) is rejected", () => {
  withRoot(({ root, file }) => {
    let readDone = false;
    const swapping = hooked({
      readSync: (...args) => {
        const n = fs.readSync(...args);
        if (n === 0) readDone = true;
        return n;
      },
      lstatSync: (p, o) => {
        if (readDone && o && o.bigint) {
          const s = fs.lstatSync(p, o);
          return Object.create(s, { ino: { value: s.ino + 1n } });
        }
        return fs.lstatSync(p, o);
      },
    });
    rejected(g.loadManifestBytes(root, "governance/m.json", { fs: swapping }), "UNSAFE_PATH");
  });
});

test("SEC-L1: symlink leaf, directory, missing file and traversal are all refused up front", (t) => {
  withRoot(({ base, root }) => {
    rejected(g.loadManifestBytes(root, "governance"), "UNSAFE_PATH");
    assert.equal(g.loadManifestBytes(root, "governance/missing.json").ok, false);
    rejected(g.loadManifestBytes(root, "../outside.json"), "UNSAFE_PATH");
    try {
      fs.symlinkSync(nodePath.join(base, "elsewhere.json"), nodePath.join(root, "governance", "link.json"), "file");
    } catch {
      t.skip("symlinks are not permitted in this environment");
      return;
    }
    fs.writeFileSync(nodePath.join(base, "elsewhere.json"), MANIFEST);
    rejected(g.loadManifestBytes(root, "governance/link.json"), "UNSAFE_PATH");
  });
});

test("SEC-L1: residual limitation is documented in the module (no atomic intermediate-directory protection)", () => {
  const source = fs.readFileSync(nodePath.join(__dirname, "manifest-loader.js"), "utf8");
  assert.match(source, /Residual limits/);
  assert.match(source, /INTERMEDIATE directory/);
  assert.match(source, /Windows has no O_NOFOLLOW/);
});
