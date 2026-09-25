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

// ---------------------------------------------------------------- Corrective C2 / SEC-L1
// A directory component swapped for a link (and left in place, or reverted) must
// never let the loader return bytes from outside repositoryRoot.

const OUTSIDE_MANIFEST = MANIFEST.replace("example-gate", "OUTSIDE-STOLEN");

function withRootAndOutside(body) {
  return withRoot(({ base, root, file }) => {
    const outside = nodePath.join(base, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(nodePath.join(outside, "m.json"), OUTSIDE_MANIFEST);
    const dir = nodePath.join(root, "governance");
    const backup = nodePath.join(root, "governance.orig");
    const swapIn = () => {
      fs.renameSync(dir, backup);
      fs.symlinkSync(outside, dir, "junction");
    };
    const restore = () => {
      try {
        fs.unlinkSync(dir);
      } catch {
        fs.rmdirSync(dir);
      }
      fs.renameSync(backup, dir);
    };
    return body({ base, root, file, outside, swapIn, restore });
  });
}

const notStolen = (result) => {
  if (result.ok) assert.equal(Buffer.from(result.read()).toString("utf8").includes("OUTSIDE-STOLEN"), false);
};

test("C2 SEC-L1: a persisting intermediate-directory swap before the loader lstat cannot return outside bytes (OUTSIDE-STOLEN)", (t) => {
  withRootAndOutside(({ root, swapIn }) => {
    let swapped = false;
    let reads = 0;
    const attack = hooked({
      lstatSync: (p, o) => {
        if (!swapped && o && o.bigint) {
          swapped = true;
          try {
            swapIn();
          } catch {
            t.skip("symlinks are not permitted in this environment");
          }
        }
        return fs.lstatSync(p, o);
      },
      readSync: (...args) => {
        reads += 1;
        return fs.readSync(...args);
      },
    });
    const result = g.loadManifestBytes(root, "governance/m.json", { fs: attack });
    rejected(result, "UNSAFE_PATH");
    assert.equal(reads, 0, "nothing may be read from the outside file");
  });
});

test("C2 SEC-L1: a swap between the check and the open that is reverted before the location check is rejected", (t) => {
  withRootAndOutside(({ root, swapIn, restore }) => {
    const attack = hooked({
      openSync: (p, f, ...rest) => {
        swapIn();
        const fd = fs.openSync(p, f, ...rest); // opens the OUTSIDE file
        restore();
        return fd;
      },
    });
    const result = g.loadManifestBytes(root, "governance/m.json", { fs: attack });
    notStolen(result);
    rejected(result, "UNSAFE_PATH");
  });
});

test("C2 SEC-L1: a swap after the open that stays in place is rejected and no outside bytes are returned", (t) => {
  withRootAndOutside(({ root, swapIn }) => {
    const attack = hooked({
      openSync: (p, f, ...rest) => {
        const fd = fs.openSync(p, f, ...rest);
        swapIn();
        return fd;
      },
    });
    const result = g.loadManifestBytes(root, "governance/m.json", { fs: attack });
    notStolen(result);
    rejected(result, "UNSAFE_PATH");
  });
});

test("C2 SEC-L1: a stable intermediate junction/symlink to outside is rejected up front", (t) => {
  withRootAndOutside(({ root, swapIn }) => {
    swapIn();
    const result = g.loadManifestBytes(root, "governance/m.json");
    notStolen(result);
    rejected(result, "UNSAFE_PATH");
  });
});

test("C2 SEC-L1: a dangling leaf symlink is rejected", () => {
  withRoot(({ base, root }) => {
    fs.symlinkSync(nodePath.join(base, "nowhere.json"), nodePath.join(root, "governance", "dangling.json"), "file");
    rejected(g.loadManifestBytes(root, "governance/dangling.json"), "UNSAFE_PATH");
  });
});

test("C2 SEC-L1: a repository root reached through a symlinked parent still loads (canonical real root is used)", () => {
  withRoot(({ base }) => {
    const alias = nodePath.join(base, "alias-of-base");
    fs.symlinkSync(base, alias, "junction");
    const viaAlias = nodePath.join(alias, "repo");
    const result = g.loadManifestBytes(viaAlias, "governance/m.json");
    assert.equal(result.ok, true);
    assert.equal(Buffer.from(result.read()).toString("utf8"), MANIFEST);
    assert.equal(g.loadManifestFile(viaAlias, "governance/m.json").valid, true);
  });
});

test("C2 SEC-L1: without procfs the location proof needs realpath inside the root AND the same inode as the descriptor", () => {
  withRoot(({ root }) => {
    const withIno = (s, ino) => Object.create(s, { ino: { value: ino(s.ino) } });
    const fallback = { readlinkSync: undefined };
    const skewed = (ino) =>
      hooked({
        ...fallback,
        lstatSync: (p, o) => (o && o.bigint ? withIno(fs.lstatSync(p, o), ino) : fs.lstatSync(p, o)),
        fstatSync: (fd, o) => (o && o.bigint ? withIno(fs.fstatSync(fd, o), ino) : fs.fstatSync(fd, o)),
      });
    // Consistent lies about the identity (lstat and fstat agree) cannot hide that the
    // file at the real path is a different object than the opened descriptor.
    rejected(g.loadManifestBytes(root, "governance/m.json", { fs: skewed((i) => i + 1n) }), "UNSAFE_PATH");
    // A filesystem that reports inode 0 has no identity proof: fail closed.
    rejected(g.loadManifestBytes(root, "governance/m.json", { fs: skewed(() => 0n) }), "UNSAFE_PATH");
    // The honest fallback path still loads a normal file.
    assert.equal(g.loadManifestBytes(root, "governance/m.json", { fs: hooked(fallback) }).ok, true);
  });
});

test("C2 SEC-L1: on Linux the location is proved from /proc/self/fd and an outside descriptor path is rejected", (t) => {
  if (process.platform !== "linux") {
    t.skip("procfs descriptor proof is Linux-only; the generic fallback is covered above");
    return;
  }
  withRoot(({ root }) => {
    let asked = null;
    const spy = hooked({
      readlinkSync: (p, ...rest) => {
        asked = p;
        return fs.readlinkSync(p, ...rest);
      },
    });
    assert.equal(g.loadManifestBytes(root, "governance/m.json", { fs: spy }).ok, true);
    assert.match(asked, /^\/proc\/self\/fd\/\d+$/);
    const outsideClaim = hooked({ readlinkSync: () => "/definitely/not/in/the/repository/m.json" });
    rejected(g.loadManifestBytes(root, "governance/m.json", { fs: outsideClaim }), "UNSAFE_PATH");
  });
});

test("C2 SEC-L1: the module documents exactly what is and is not guaranteed", () => {
  const source = fs.readFileSync(nodePath.join(__dirname, "manifest-loader.js"), "utf8");
  assert.match(source, /\/proc\/self\/fd/);
  assert.match(source, /Not guaranteed \(residual limits\)/);
  assert.match(source, /hard-linked/);
  assert.match(source, /Windows[\s*]+has no O_NOFOLLOW/);
  assert.equal(/restores? the tree before/.test(source), false, "the old understated-window wording is gone");
});
