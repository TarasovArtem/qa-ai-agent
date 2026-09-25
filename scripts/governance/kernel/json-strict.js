/**
 * GOV-AUTO-1 Wave 0 -- strict JSON parser (internal; not part of the public API).
 *
 * `JSON.parse` cannot serve as the manifest parser because it (1) silently keeps
 * the last of several duplicate keys and (2) discards the lexical form of
 * numbers, so `1` and `1.0` become indistinguishable. This parser is strict RFC
 * 8259 JSON that rejects duplicate keys, bounds nesting depth, builds objects
 * without a prototype and preserves every number as a RawNumber carrying its raw
 * token, which lets schemaVersion be validated lexically before any numeric
 * normalization. It never evaluates, imports or sources its input.
 */

"use strict";

const { REASON, LIMITS } = require("./contracts");
const { RawNumber } = require("./validation");

class ParseFailure extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.reasonCode = reasonCode;
  }
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

function parseStrictJson(text, options = {}) {
  if (typeof text !== "string") return { ok: false, reasonCode: REASON.MANIFEST_JSON_INVALID };
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : LIMITS.maxJsonDepth;
  let pos = 0;

  const fail = (reasonCode) => {
    throw new ParseFailure(reasonCode, "invalid JSON");
  };
  const skipWhitespace = () => {
    while (pos < text.length) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) pos += 1;
      else break;
    }
  };

  function parseString() {
    // opening quote already checked by caller
    pos += 1;
    let out = "";
    for (;;) {
      if (pos >= text.length) fail(REASON.MANIFEST_JSON_INVALID);
      const ch = text[pos];
      const code = text.charCodeAt(pos);
      if (ch === '"') {
        pos += 1;
        return out;
      }
      if (code < 0x20) fail(REASON.MANIFEST_JSON_INVALID);
      if (ch === "\\") {
        const next = text[pos + 1];
        const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (next !== undefined && Object.hasOwn(simple, next)) {
          out += simple[next];
          pos += 2;
        } else if (next === "u") {
          const hex = text.slice(pos + 2, pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(REASON.MANIFEST_JSON_INVALID);
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 6;
        } else {
          fail(REASON.MANIFEST_JSON_INVALID);
        }
      } else {
        out += ch;
        pos += 1;
      }
    }
  }

  function parseValue(depth) {
    if (depth > maxDepth) fail(REASON.JSON_DEPTH_EXCEEDED);
    skipWhitespace();
    if (pos >= text.length) fail(REASON.MANIFEST_JSON_INVALID);
    const ch = text[pos];
    if (ch === "{") {
      pos += 1;
      const obj = Object.create(null);
      skipWhitespace();
      if (text[pos] === "}") {
        pos += 1;
        return obj;
      }
      for (;;) {
        skipWhitespace();
        if (text[pos] !== '"') fail(REASON.MANIFEST_JSON_INVALID);
        const key = parseString();
        if (Object.hasOwn(obj, key)) fail(REASON.DUPLICATE_JSON_KEY);
        skipWhitespace();
        if (text[pos] !== ":") fail(REASON.MANIFEST_JSON_INVALID);
        pos += 1;
        obj[key] = parseValue(depth + 1);
        skipWhitespace();
        if (text[pos] === ",") {
          pos += 1;
          continue;
        }
        if (text[pos] === "}") {
          pos += 1;
          return obj;
        }
        fail(REASON.MANIFEST_JSON_INVALID);
      }
    }
    if (ch === "[") {
      pos += 1;
      const arr = [];
      skipWhitespace();
      if (text[pos] === "]") {
        pos += 1;
        return arr;
      }
      for (;;) {
        arr.push(parseValue(depth + 1));
        skipWhitespace();
        if (text[pos] === ",") {
          pos += 1;
          continue;
        }
        if (text[pos] === "]") {
          pos += 1;
          return arr;
        }
        fail(REASON.MANIFEST_JSON_INVALID);
      }
    }
    if (ch === '"') return parseString();
    if (text.startsWith("true", pos)) {
      pos += 4;
      return true;
    }
    if (text.startsWith("false", pos)) {
      pos += 5;
      return false;
    }
    if (text.startsWith("null", pos)) {
      pos += 4;
      return null;
    }
    NUMBER.lastIndex = pos;
    const match = NUMBER.exec(text);
    if (match && match.index === pos) {
      pos += match[0].length;
      return new RawNumber(match[0]);
    }
    return fail(REASON.MANIFEST_JSON_INVALID);
  }

  try {
    const value = parseValue(0);
    skipWhitespace();
    if (pos !== text.length) fail(REASON.MANIFEST_JSON_INVALID);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, reasonCode: error.reasonCode };
    if (error instanceof RangeError) return { ok: false, reasonCode: REASON.JSON_DEPTH_EXCEEDED };
    throw error;
  }
}

module.exports = { parseStrictJson };
