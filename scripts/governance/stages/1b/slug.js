/**
 * GOV-AUTO-1 Wave 1 / 1B -- heading anchor generation, matching what the
 * repository's renderer (GitHub) produces, so anchor integrity is checked against
 * the anchors that actually exist rather than an informal approximation.
 *
 * Algorithm (github-slugger): take the RENDERED heading text, lowercase it, remove
 * every character that is not a letter, combining mark, number, connector
 * punctuation (`_`), hyphen or space, then turn each space into `-` (spaces are not
 * collapsed). Repeated slugs get `-1`, `-2`, ... suffixes, skipping any suffixed
 * slug that already exists. Unicode is preserved (never transliterated).
 */

"use strict";

const REMOVED = /[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu;

function slugify(text) {
  return text.toLowerCase().replace(REMOVED, "").replace(/ /g, "-");
}

/** A per-document slugger: call slug() for headings in document order. */
function createSlugger() {
  const occurrences = new Map();
  return {
    slug(text) {
      const original = slugify(text);
      let slug = original;
      while (occurrences.has(slug)) {
        occurrences.set(original, occurrences.get(original) + 1);
        slug = `${original}-${occurrences.get(original)}`;
      }
      occurrences.set(slug, 0);
      return slug;
    },
  };
}

module.exports = { slugify, createSlugger };
