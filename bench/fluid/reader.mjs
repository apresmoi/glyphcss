// Speed reader in Chrome (see src/reader.ts): the live reader advances words with no
// errors, and a deterministic capture accents the ORP letter on the centre column.
// node reader.mjs [screenshot.png] [capture.txt]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const [shot, txt] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 520, height: 470 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && errors.push(`${r.status()} ${r.url()}`));
p.on("console", (m) => (m.type() === "error" && !m.location().url.endsWith("/favicon.ico") && !/^Failed to load resource/.test(m.text()) ? errors.push(m.text()) : null));
await p.goto("http://127.0.0.1:4361/reader.html");
await p.waitForFunction(() => window.__reader?.ready, null, { timeout: 30000 });
await p.waitForFunction(() => window.__reader.words.length >= 3, null, { timeout: 30000 });
if (shot) await p.screenshot({ path: shot });
const live = await p.evaluate(() => ({ words: window.__reader.words.slice(), stats: window.__reader.reader.fluid.stats() }));
const cap = await p.evaluate(() => window.__reader.capture("reading", 90));
if (txt) writeFileSync(txt, cap.text.replace(/⠀/g, " ").split("\n").map((l) => l.trimEnd()).join("\n") + "\n");
console.log(JSON.stringify({ live, accentCells: cap.accentCells, accentCentreCol: cap.accentCentreCol }));
console.log(errors.length ? errors.join("\n") : "no errors");
await b.close();
const ok = !errors.length && live.words.length >= 3 && live.stats.pipeline === "worker" && cap.accentCells > 0 && Math.abs(cap.accentCentreCol - 26) < 1.5;
process.exit(ok ? 0 : 1);
