/**
 * Strict RFC 8259 JSON parser for target-owned CLI configuration.
 *
 * JSON.parse() silently keeps the LAST of two duplicate keys, which lets two
 * readers of one file disagree about its meaning. This parser refuses
 * duplicates at every depth, refuses prototype-sensitive keys before any
 * object is built, bounds nesting depth, and accepts nothing beyond the
 * standard grammar (no comments, trailing commas, single quotes, NaN,
 * leading zeros or raw control characters). Diagnostics carry an offset and a
 * fixed reason only - never input text.
 */

"use strict";

const { configError } = require("./errors");

const MAX_DEPTH = 64;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

function parseError(offset, reason) {
  return configError("CONFIG_PARSE_ERROR", `configuration is not valid strict JSON (${reason} at offset ${offset}).`);
}

function parseStrictJson(text) {
  if (typeof text !== "string") throw parseError(0, "input is not text");
  let i = 0;

  function skipWhitespace() {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i += 1;
      else break;
    }
  }

  function parseString() {
    // text[i] === '"'
    i += 1;
    let out = "";
    while (i < text.length) {
      const ch = text[i];
      const code = text.charCodeAt(i);
      if (ch === '"') {
        i += 1;
        return out;
      }
      if (code < 0x20) throw parseError(i, "unescaped control character in string");
      if (ch === "\\") {
        const next = text[i + 1];
        if (next === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw parseError(i, "invalid unicode escape");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (Object.prototype.hasOwnProperty.call(ESCAPES, next)) {
          out += ESCAPES[next];
          i += 2;
        } else {
          throw parseError(i, "invalid escape sequence");
        }
        continue;
      }
      out += ch;
      i += 1;
    }
    throw parseError(i, "unterminated string");
  }

  function parseValue(depth) {
    if (depth > MAX_DEPTH) throw parseError(i, "nesting too deep");
    skipWhitespace();
    const ch = text[i];
    if (ch === "{") return parseObject(depth);
    if (ch === "[") return parseArray(depth);
    if (ch === '"') return parseString();
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    NUMBER_PATTERN.lastIndex = i;
    const match = NUMBER_PATTERN.exec(text);
    if (match && match[0].length > 0) {
      const after = text[i + match[0].length];
      if (after !== undefined && /[0-9.eE+-]/.test(after)) throw parseError(i, "invalid number");
      i += match[0].length;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw parseError(i, "number out of range");
      return value;
    }
    throw parseError(i, i >= text.length ? "unexpected end of input" : "unexpected token");
  }

  function parseObject(depth) {
    i += 1;
    const obj = {};
    const seen = new Set();
    skipWhitespace();
    if (text[i] === "}") {
      i += 1;
      return obj;
    }
    for (;;) {
      skipWhitespace();
      if (text[i] !== '"') throw parseError(i, "expected string key");
      const keyOffset = i;
      const key = parseString();
      if (FORBIDDEN_KEYS.has(key)) {
        throw configError("CONFIG_FORBIDDEN_KEY", `configuration contains a forbidden key at offset ${keyOffset}.`);
      }
      if (seen.has(key)) {
        throw configError("CONFIG_DUPLICATE_KEY", `configuration contains a duplicate key at offset ${keyOffset}.`);
      }
      seen.add(key);
      skipWhitespace();
      if (text[i] !== ":") throw parseError(i, "expected ':'");
      i += 1;
      const value = parseValue(depth + 1);
      // defineProperty, never assignment: no setter on Object.prototype can run.
      Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
      skipWhitespace();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "}") {
        i += 1;
        return obj;
      }
      throw parseError(i, "expected ',' or '}'");
    }
  }

  function parseArray(depth) {
    i += 1;
    const arr = [];
    skipWhitespace();
    if (text[i] === "]") {
      i += 1;
      return arr;
    }
    for (;;) {
      arr.push(parseValue(depth + 1));
      skipWhitespace();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "]") {
        i += 1;
        return arr;
      }
      throw parseError(i, "expected ',' or ']'");
    }
  }

  const value = parseValue(1);
  skipWhitespace();
  if (i !== text.length) throw parseError(i, "unexpected trailing content");
  return value;
}

module.exports = { parseStrictJson, MAX_DEPTH };
