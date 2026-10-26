// Speed reader in Chrome (see src/reader.ts): the live reader advances words on the worker
// with no errors in both looks; a deterministic capture accents the ORP letter on the
// centre column (glyph look); mid-word, the plain look shows the word as real letters,
// decoded, the ORP letter orange on the centre column.
// node reader.mjs [shot-dir] [capture.txt]   (shots: <look>-<wpm>.png at 250/400/600 wpm)
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
const [dir, txt] = process.argv.slice(2);
if (dir) mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ channel: "chrome" });
const fails = [];
const out = [];
for (const look of ["plain", "glyph"])
  for (const wpm of [250, 400, 600]) {
    const p = await b.newPage({ viewport: { width: 460, height: 460 } });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && errors.push(`${r.status()} ${r.url()}`));
    p.on("console", (m) => (m.type() === "error" && !m.location().url.endsWith("/favicon.ico") && !/^Failed to load resource/.test(m.text()) ? errors.push(m.text()) : null));
    await p.goto(`http://127.0.0.1:4361/reader.html?look=${look}&wpm=${wpm}&text=${encodeURIComponent("Molty reads one word at a time, condensing letters out of the living fluid.")}`);
    await p.waitForFunction(() => window.__reader?.ready, null, { timeout: 30000 });
    const mid = await p.evaluate(() => window.__reader.midWord(7)); // "condensing": long, ORP off the middle
    if (dir) await p.screenshot({ path: `${dir}/${look}-${wpm}.png` });
    const r = { look, wpm, word: mid.word, shown: mid.letters.map((l) => l.ch).join(""), pipeline: mid.stats.pipeline };
    if (mid.stats.pipeline !== "worker") fails.push(`${look}@${wpm}: pipeline ${mid.stats.pipeline}`);
    if (look === "plain") {
      const chars = [...mid.word];
      const { orp } = mid;
      const orange = (c) => {
        const [r, g, bl] = c.match(/\d+/g).map(Number);
        return r > 200 && g > 110 && g < 180 && bl < 120;
      };
      const orpL = mid.letters.find((l) => orange(l.color));
      r.orpCx = orpL?.cx;
      if (r.shown !== mid.word) fails.push(`${look}@${wpm}: shows "${r.shown}" for "${mid.word}"`);
      if (!orpL || Math.abs(orpL.cx - 206) > 3) fails.push(`${look}@${wpm}: ORP letter not orange on the centre (${JSON.stringify(orpL)})`);
      else if (orpL.ch !== mid.word[orp] && chars.length === mid.word.length) fails.push(`${look}@${wpm}: orange letter "${orpL.ch}" is not the ORP "${mid.word[orp]}"`);
    } else if (mid.letters.length) fails.push(`${look}@${wpm}: glyph look drew DOM letters`);
    if (errors.length) fails.push(`${look}@${wpm}: ${errors.join("; ")}`);
    out.push(r);
    if (look === "glyph" && wpm === 250) {
      const cap = await p.evaluate(() => window.__reader.capture("reading", 90));
      if (txt) writeFileSync(txt, cap.text.replace(/⠀/g, " ").split("\n").map((l) => l.trimEnd()).join("\n") + "\n");
      r.accentCells = cap.accentCells;
      r.accentCentreCol = cap.accentCentreCol;
      if (!(cap.accentCells > 0 && Math.abs(cap.accentCentreCol - 26) < 1.5)) fails.push("capture: ORP accent off the centre column");
    }
    await p.close();
  }
await b.close();
for (const r of out) console.log(JSON.stringify(r));
console.log(fails.length ? fails.join("\n") : "ok");
process.exit(fails.length ? 1 : 0);
