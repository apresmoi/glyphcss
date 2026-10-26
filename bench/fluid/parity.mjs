// Real-Worker parity run (see src/parity.ts). node parity.mjs [frames] [mutate]
import { chromium } from "playwright";
const [frames = "600", mutate = ""] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage();
p.on("pageerror", (e) => console.error(e.message));
await p.goto(`http://127.0.0.1:4361/parity.html?frames=${frames}${mutate ? `&mutate=${mutate}` : ""}`);
await p.waitForFunction(() => window.__parity, null, { timeout: 30000 });
console.log(JSON.stringify(await p.evaluate(() => window.__parity)));
await b.close();
