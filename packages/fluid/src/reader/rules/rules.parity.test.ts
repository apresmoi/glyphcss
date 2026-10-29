// The reader rules must match the reference's vendored reader.js exactly (the firmware applies the
// same rules in C). A corpus of hand-picked edge cases plus seeded random words; each
// planted-bug case proves the comparison would catch a one-character slip.
import { describe, expect, it } from "vitest";
import * as ref from "../../../reference/fluid/reader.js";
import { glyphReaderOrp, glyphReaderWordDelay, tokenizeGlyphReaderText, type GlyphReaderToken } from "./words";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const ALPHABET = ["a", "Z", "é", "ß", "ж", "日", "7", ".", ",", "!", "?", ";", ":", "\"", "'", "”", "’", ")", "]", "(", "-", "—", "…", "😀", "#"];
function randomWord(r: () => number): string {
  const n = 1 + Math.floor(r() * 18);
  let w = "";
  for (let i = 0; i < n; i++) w += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return w;
}

const TEXTS = [
  "",
  "   ",
  "a",
  "Hello, world!",
  "The quick brown fox jumps over the lazy dog.",
  "Wait… what?! (Really.) \"Yes,\" she said; 'no' — he replied: maybe.",
  "First paragraph ends here.\n\nSecond one starts.\n \t\nThird after a spaced blank line.",
  "\n\nLeading blank lines then words",
  "internationalization antidisestablishmentarianism supercalifragilisticexpialidocious",
  "naïve café über straße жизнь 日本語 1234 3.14159 v2.0",
  "😀 emoji 😀😀 mixed😀word",
  "!!! ... ??? --- ",
  "end.\"  end!’  end?)  end:]  end,”",
];

function corpus(): string[] {
  const r = rng(42);
  const words: string[] = [];
  for (let i = 0; i < 400; i++) words.push(randomWord(r));
  return words;
}

/** Number of words/tokens where `impl` disagrees with the reference. */
function mismatches(impl: {
  orp: (w: string) => { focal: number; core: number };
  tokenize: (t: string) => GlyphReaderToken[];
  delay: (t: GlyphReaderToken, wpm: number) => number;
}): number {
  let bad = 0;
  const words = corpus();
  for (const w of words) if (JSON.stringify(impl.orp(w)) !== JSON.stringify(ref.orpOf(w))) bad++;
  const texts = [...TEXTS, words.join(" "), words.slice(0, 60).join("\n\n")];
  for (const t of texts) {
    const a = impl.tokenize(t), b = ref.tokenize(t);
    if (JSON.stringify(a) !== JSON.stringify(b)) bad++;
    for (const wpm of [0, -5, 1, 100, 250, 333.3, 400, 600, 1000, 5000])
      for (const tok of b) if (impl.delay(tok, wpm) !== ref.wordDelay(tok, wpm)) bad++;
  }
  return bad;
}

const port = { orp: glyphReaderOrp, tokenize: tokenizeGlyphReaderText, delay: glyphReaderWordDelay };

describe("reader rules parity with the reference's reader.js", () => {
  it("ORP, tokenizer and word delay agree on every corpus word and text", () => {
    expect(mismatches(port)).toBe(0);
  });

  it("matches known values (a sanity anchor independent of the reference)", () => {
    expect(glyphReaderOrp("I")).toEqual({ focal: 0, core: 1 });
    expect(glyphReaderOrp("hello")).toEqual({ focal: 1, core: 5 });
    expect(glyphReaderOrp("(quickly),")).toEqual({ focal: 3, core: 7 });
    expect(glyphReaderOrp("internationalization")).toEqual({ focal: 4, core: 20 });
    const [a, b] = tokenizeGlyphReaderText("Stop.\n\nGo");
    expect(a).toEqual({ word: "Stop.", orp: 1, core: 4, para: true });
    expect(glyphReaderWordDelay(a!, 250)).toBe(600); // 240 × 2.5 (paragraph beats sentence end)
    expect(glyphReaderWordDelay(b!, 250)).toBe(240);
    expect(glyphReaderWordDelay({ word: "x", orp: 0, core: 1, para: false }, 10000)).toBe(40);
  });

  it("is not vacuous: a planted ORP bucket slip goes red", () => {
    const orp = (w: string) => {
      const r = glyphReaderOrp(w);
      // bucket boundary 5 → 6: a 6-letter core gets the shorter bucket
      return r.core === 6 ? { ...r, focal: r.focal - 1 } : r;
    };
    expect(mismatches({ ...port, orp })).toBeGreaterThan(0);
  });

  it("is not vacuous: a planted paragraph-flag slip goes red", () => {
    const tokenize = (t: string) => tokenizeGlyphReaderText(t.replace(/\n\s*\n/g, " "));
    expect(mismatches({ ...port, tokenize })).toBeGreaterThan(0);
  });

  it("is not vacuous: a planted punctuation-factor slip goes red", () => {
    const delay = (t: GlyphReaderToken, wpm: number) =>
      /[,;:]["'”’)\]]*$/u.test(t.word) && !t.para ? Math.max(40, Math.round((60000 / Math.max(1, wpm)) * (t.core > 6 ? Math.min(2, 1 + 0.05 * (t.core - 6)) : 1) * 1.4)) : glyphReaderWordDelay(t, wpm);
    expect(mismatches({ ...port, delay })).toBeGreaterThan(0);
  });
});
