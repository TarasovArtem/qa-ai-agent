"use strict";
const path = require("node:path");
const fs = require("node:fs");
// Namespace and inode data durability are independent. A child-directory
// fsync cannot persist the link to that child in its parent. Pending namespace
// operations may be lost or reordered; flushed operations are never moved.
function orders(ops) {
  if (!ops.length) return [[]];
  return [[], ...ops.flatMap((op, i) => orders(ops.filter((_, j) => i !== j)).map(tail => [op, ...tail]))];
}
class FlushModel {
  constructor(root) {
    this.root = root; this.nodes = new Map(); this.next = 0; this.log = []; this.snapshots = [];
    this.rootId = this.node("directory");
    this.io = {
      mkdir: async p => { const [parent, name] = this.parent(p); if (parent.entries.has(name)) throw Object.assign(new Error("exists"), { code: "EEXIST" }); const id = this.node("directory"); this.set(parent, name, id); this.event("mkdir", p); },
      lstat: async p => { const node = this.get(p); this.event("lstat", p); return { isDirectory: () => node.kind === "directory", isSymbolicLink: () => false }; },
      realpath: async p => { this.get(p); return p; },
      readFile: async p => Buffer.from(this.get(p).data),
      open: async (p, flags) => {
        let node;
        if (flags & fs.constants.O_EXCL) {
          const [parent, name] = this.parent(p); if (parent.entries.has(name)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
          const id = this.node("file"); this.set(parent, name, id); node = this.nodes.get(id);
        } else node = this.get(p);
        this.event(node.kind === "directory" ? "open-directory" : "open", p);
        return {
          write: async (buffer, offset, length) => { node.data = Buffer.concat([node.data, buffer.subarray(offset, offset + length)]); this.event("write", p); return { bytesWritten: length }; },
          sync: async () => {
            if (node.kind === "directory") { node.durableEntries = new Map(node.entries); node.pending = []; }
            else node.durableData = Buffer.from(node.data);
            this.event(node.kind === "directory" ? "directory-fsync" : "file-fsync", p);
          },
          close: async () => { this.event("close", p); },
        };
      },
      rename: async (a, b) => {
        const [parent, name] = this.parent(a), [other, target] = this.parent(b);
        if (parent !== other) throw new Error("model supports contract's same-directory atomic rename only");
        const id = parent.entries.get(name); if (id === undefined) throw new Error("missing rename source");
        parent.entries.delete(name); parent.entries.set(target, id);
        parent.pending.push({ kind: "rename", name, target, id }); this.event("rename", a);
      },
    };
  }
  node(kind) { const id = ++this.next; this.nodes.set(id, { kind, data: Buffer.alloc(0), durableData: Buffer.alloc(0), entries: new Map(), durableEntries: new Map(), pending: [] }); return id; }
  get(p) {
    let node = this.nodes.get(this.rootId);
    for (const segment of path.relative(this.root, p).split(path.sep).filter(Boolean)) { const id = node.entries.get(segment); if (id === undefined) throw new Error(`missing model path: ${p}`); node = this.nodes.get(id); }
    return node;
  }
  parent(p) { return [this.get(path.dirname(p)), path.basename(p)]; }
  set(parent, name, id) { parent.entries.set(name, id); parent.pending.push({ kind: "set", name, id }); }
  seed(p, kind, bytes = Buffer.alloc(0)) { const [parent, name] = this.parent(p), id = this.node(kind), node = this.nodes.get(id); parent.entries.set(name, id); parent.durableEntries.set(name, id); node.data = Buffer.from(bytes); node.durableData = Buffer.from(bytes); }
  seedDisk(dir, skip = new Set()) {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name), st = fs.lstatSync(p);
      this.seed(p, st.isDirectory() ? "directory" : "file", st.isFile() ? fs.readFileSync(p) : undefined);
      if (st.isDirectory()) this.seedDisk(p);
    }
  }
  event(step, p) { this.log.push([step, path.relative(this.root, p)]); this.capture(`${step}:${path.relative(this.root, p)}`); }
  capture(label) { this.snapshots.push({ label, rootId: this.rootId, nodes: structuredClone(this.nodes) }); }
  static recoveries(snapshot) {
    const variants = [...snapshot.nodes].filter(([, n]) => n.pending.length).map(([id, n]) => [id, orders(n.pending)]);
    const choices = [];
    function combine(i, selected) { if (i === variants.length) { choices.push(new Map(selected)); return; } const [id, options] = variants[i]; for (const ops of options) combine(i + 1, [...selected, [id, ops]]); }
    combine(0, []);
    const results = [], seen = new Set();
    for (const selected of choices) for (const keepUnflushedData of [false, true]) {
      const files = new Map(), dirs = new Set();
      const walk = (id, prefix) => {
        const node = snapshot.nodes.get(id);
        if (node.kind === "file") { files.set(prefix, Buffer.from(keepUnflushedData ? node.data : node.durableData)); return; }
        dirs.add(prefix); const entries = new Map(node.durableEntries);
        for (const op of selected.get(id) || []) {
          if (op.kind === "set") entries.set(op.name, op.id);
          else if (entries.get(op.name) === op.id) { entries.delete(op.name); entries.set(op.target, op.id); }
        }
        for (const [name, child] of entries) walk(child, prefix ? `${prefix}/${name}` : name);
      };
      walk(snapshot.rootId, "");
      const key = JSON.stringify([...files].map(([p, b]) => [p, b.toString("hex")]));
      if (!seen.has(key)) { seen.add(key); results.push({ files, dirs }); }
    }
    return results;
  }
}
module.exports = { FlushModel };
