"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createDurableStore } = require("../../scripts/ai/cli/stage4-durability");
// Faults wrap actual file handles. Only Windows directory handles are
// simulated; real Linux CI exercises open/write/fsync/close on disk.
function faultStore(f, { match = () => false, phase, log = [] } = {}) {
  let lastFile;
  const fail = (step, name) => {
    log.push([step, name]);
    if (step === phase && match(name, lastFile)) throw Object.assign(new Error("injected persistence failure"), { code: "EIO" });
  };
  const io = { ...fs.promises,
    async mkdir(name, options) { fail("mkdir", name); return fs.promises.mkdir(name, options); },
    async open(name, flags, mode) {
      const directory = fs.existsSync(name) && fs.lstatSync(name).isDirectory();
      if (!directory) lastFile = name;
      fail(directory ? "dir-open" : "create", name);
      const h = directory && process.platform === "win32" ? { async sync() {}, async close() {} } : await fs.promises.open(name, flags, mode);
      return {
        async write(...args) { fail("write", name); return h.write(...args); },
        async sync() { fail(directory ? "dir-fsync" : "fsync", name); return h.sync(); },
        async close() { await h.close(); fail(directory ? "dir-close" : "close", name); },
      };
    },
    async rename(a, b) { fail("rename", a); return fs.promises.rename(a, b); },
  };
  return createDurableStore({ root: f.ctx.root, runDirReal: f.runDirReal, protectedPaths: f.ctx.protectedPaths, io });
}
module.exports = { faultStore };
