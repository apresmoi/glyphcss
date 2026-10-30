// Speed-reader rules (mirroring `reference/fluid/reader.js`):
// same heuristic, no dictionary. `rules.parity.test.ts` holds
// this file to the reference on a corpus; change both (and the reference) or neither.
//   ORP:   strip leading/trailing non-alnum → core; bucket core length
//          ≤1 → 0, 2–5 → 1, 6–9 → 2, 10–13 → 3, ≥14 → 4; focal = coreStart + bucket.
//   delay: max(40, 60000/wpm × long × punc), rounded
//          long = min(2, 1 + 0.05·(coreLen − 6)) when coreLen > 6
//          punc = paragraph 2.5 · sentence end (. ! ?) 2.0 · clause (, ; :) 1.5
// Indices are UTF-16 code units, exactly as the reference counts them.

/** One word to show. */
export interface GlyphReaderToken {
  /** The whitespace-delimited word, punctuation included. */
  word: string;
  /** Optimal recognition point: index (UTF-16 code unit) of the focal letter. */
  orp: number;
  /** Length of the word with leading/trailing non-alphanumerics stripped. */
  core: number;
  /** A paragraph break follows this word. */
  para: boolean;
}

const isAlnum = (c: string | undefined) => /[\p{L}\p{N}]/u.test(c as string);

/** The focal letter of `word` and its core length. */
export function glyphReaderOrp(word: string): { focal: number; core: number } {
  let a = 0,
    b = word.length - 1;
  while (a <= b && !isAlnum(word[a])) a++;
  while (b >= a && !isAlnum(word[b])) b--;
  const core = b >= a ? b - a + 1 : 0;
  const bucket = core <= 1 ? 0 : core <= 5 ? 1 : core <= 9 ? 2 : core <= 13 ? 3 : 4;
  return { focal: Math.max(0, Math.min(word.length - 1, (core ? a : 0) + bucket)), core };
}

/** Split text into words; a blank line marks the word before it as a paragraph end. */
export function tokenizeGlyphReaderText(text: string): GlyphReaderToken[] {
  const out: GlyphReaderToken[] = [];
  const re = /(\n\s*\n)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) {
      if (out.length) out[out.length - 1]!.para = true;
      continue;
    }
    const w = m[2]!;
    const { focal, core } = glyphReaderOrp(w);
    out.push({ word: w, orp: focal, core, para: false });
  }
  return out;
}

/** How long `token` stays on screen at `wpm`, in ms. */
export function glyphReaderWordDelay(token: GlyphReaderToken, wpm: number): number {
  const base = 60000 / Math.max(1, wpm);
  const longF = token.core > 6 ? Math.min(2, 1 + 0.05 * (token.core - 6)) : 1;
  const tail = token.word.replace(/["'”’)\]]+$/u, "");
  const last = tail[tail.length - 1] || "";
  const punc = token.para ? 2.5 : ".!?".includes(last) ? 2.0 : ",;:".includes(last) ? 1.5 : 1.0;
  return Math.max(40, Math.round(base * longF * punc));
}
