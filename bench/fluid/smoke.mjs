// Load the bench page, let it run, print stats + console errors, save a screenshot.
// node smoke.mjs <out.png> [query]
import { chromium } from "playwright";
const [out = "smoke.png", query = ""] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" || m.type() === "warning" ? errors.push(`${m.type()}: ${m.text()}`) : null);
await p.goto(`http://127.0.0.1:4361/?${query}`);
await p.waitForFunction(() => window.__fluid, null, { timeout: 30000 });
await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(() => window.__fluid.stats())));
await p.screenshot({ path: out });
console.log(errors.length ? errors.join("\n") : "no errors");
await b.close();
