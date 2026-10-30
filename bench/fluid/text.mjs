// Text-target layout check in Chrome (see src/text.ts). node text.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
p.on("pageerror", (e) => console.error(e.message));
await p.goto("http://127.0.0.1:4361/text.html");
await p.waitForFunction(() => window.__text, null, { timeout: 30000 });
const r = await p.evaluate(() => window.__text);
console.log(JSON.stringify(r));
await b.close();
process.exit(r.every((x) => x.inked === x.words && x.stray === 0) ? 0 : 1);
