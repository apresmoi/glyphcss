// Speed-reader rules, shared with the device (firmware/main/fluid/mole_fluid.c)
// (same heuristic as the device, no dictionary):
//   ORP: strip leading/trailing non-alnum → core; bucket core length
//        ≤1 → 0, 2–5 → 1, 6–9 → 2, 10–13 → 3, ≥14 → 4; focal = coreStart + bucket.
//   delay = max(40, 60000/wpm × long × punc)
//        long = min(2, 1 + 0.05·(coreLen − 6)) when coreLen > 6
//        punc = paragraph 2.5 · sentence end (. ! ?) 2.0 · clause (, ; :) 1.5

const isAlnum = (c) => /[\p{L}\p{N}]/u.test(c);

export function orpOf(tok) {
  let a = 0, b = tok.length - 1;
  while (a <= b && !isAlnum(tok[a])) a++;
  while (b >= a && !isAlnum(tok[b])) b--;
  const core = b >= a ? b - a + 1 : 0;
  const bucket = core <= 1 ? 0 : core <= 5 ? 1 : core <= 9 ? 2 : core <= 13 ? 3 : 4;
  return { focal: Math.max(0, Math.min(tok.length - 1, (core ? a : 0) + bucket)), core };
}

export function tokenize(text) {
  const out = [];
  const re = /(\n\s*\n)|(\S+)/g;
  let m, para = false;
  while ((m = re.exec(text))) {
    if (m[1]) { para = true; if (out.length) out[out.length - 1].para = true; continue; }
    const w = m[2]; const { focal, core } = orpOf(w);
    out.push({ word: w, orp: focal, core, para: false });
    para = false;
  }
  return out;
}

export function wordDelay(tok, wpm) {
  const base = 60000 / Math.max(1, wpm);
  const longF = tok.core > 6 ? Math.min(2, 1 + 0.05 * (tok.core - 6)) : 1;
  const tail = tok.word.replace(/["'”’)\]]+$/u, '');
  const last = tail[tail.length - 1] || '';
  const punc = tok.para ? 2.5 : '.!?'.includes(last) ? 2.0 : ',;:'.includes(last) ? 1.5 : 1.0;
  return Math.max(40, Math.round(base * longF * punc));
}
