/**
 * /diagrams source editor, driven in a REAL browser.
 *
 * Why this exists. The editor's choice controls are invisible `<select>`
 * elements laid over a `<textarea>`, positioned and sized in pixels from
 * character offsets, and they write back by offset. Every part of that is
 * geometry and focus — and neither survives a jsdom/happy-dom test:
 * `document.execCommand`, the write path Chrome actually takes, does not
 * exist there at all, and an element's box is always zero. So the unit
 * suites stayed green through a run of defects that made the page unusable:
 * controls a full line below their own text, a shape menu stretched over the
 * label beside it, and choices written at offsets the text had since moved
 * past — which put arrows inside node ids (USER, verbatim: "its like it puts
 * the arrows in other places... its quite obvious that its not working").
 *
 * Two invariants, both proven to fail when their fix is reverted:
 *
 *  1. GEOMETRY — every control covers exactly its own field's cells. Width
 *     within half a cell of its own value's length; the cell past its right
 *     edge belongs to the textarea, not to it; every cell inside it answers
 *     with it. A control that overshoots steals clicks meant for the text
 *     beside it, and the option then picked is written at ITS offsets.
 *  2. WRITES — picking any option changes that field and nothing else. The
 *     source must still parse, and its nodes and edges must come back
 *     IDENTICAL apart from the styling the choice owns: same ids, same
 *     labels, same endpoints. Every corruption seen so far broke this by
 *     rewriting an id or a label.
 *
 * Run: `pnpm --filter @glyphcss/website test:e2e` (starts its own server).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { glyphGraphFromMermaid } from "@glyphcss/diagrams";

const PORT = 4399;
const PAGE = `${process.env.GLYPHCSS_BASE_URL ?? `http://localhost:${PORT}`}/diagrams`;

const fail = [];
const check = (ok, message) => { if (!ok) fail.push(message); return ok; };

async function waitForServer(timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await fetch(PAGE)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** The graph a source means, reduced to what a CHOICE may never change. */
function skeleton(source) {
  const graph = glyphGraphFromMermaid(source); // throws if the source stopped parsing
  return JSON.stringify({
    nodes: graph.nodes.map((n) => [n.id, n.label ?? ""]).sort(),
    edges: graph.edges.map((e) => [e.from, e.to]).sort(),
  });
}

const server = process.env.GLYPHCSS_BASE_URL ? null : spawn("pnpm", ["exec", "astro", "dev", "--port", String(PORT)], { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "ignore" });
process.on("exit", () => server?.kill());

if (!(await waitForServer())) {
  console.error("dev server did not come up");
  server?.kill();
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(PAGE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'), {}, { timeout: 45000 });
await page.getByRole("button", { name: "Apply LangGraph agent", exact: true }).click();
await page.getByRole("tab", { name: /Mermaid/ }).click();
await page.waitForSelector("select.diagrams-editor-choice-select");

const textarea = page.locator("textarea").first();
const controls = page.locator("select.diagrams-editor-choice-select");

// ---- 1. geometry -----------------------------------------------------------
const boxes = await page.evaluate(() => {
  const ta = document.querySelector("textarea");
  return Array.from(document.querySelectorAll("select.diagrams-editor-choice-select")).map((select) => {
    const box = select.getBoundingClientRect();
    const at = (x, y) => { const hit = document.elementFromPoint(x, y); return hit === select ? "self" : hit === ta ? "textarea" : "other"; };
    return {
      label: select.getAttribute("aria-label"), value: select.value,
      width: box.width,
      inside: [0.15, 0.5, 0.85].map((fx) => at(box.left + box.width * fx, box.top + box.height / 2)),
      past: at(box.right + 3, box.top + box.height / 2),
    };
  });
});
check(boxes.length > 0, "no choice controls rendered at all");
// One cell, read off a control whose own value is several characters wide.
const widest = boxes.reduce((a, b) => (b.value.length > a.value.length ? b : a), boxes[0]);
const cellW = widest.width / widest.value.length;
for (const box of boxes) {
  const cells = box.width / cellW;
  check(cells <= box.value.length + 0.5, `${box.label} (${JSON.stringify(box.value)}) covers ${cells.toFixed(1)} cells, its field is ${box.value.length}`);
  check(box.past !== "self", `${box.label} (${JSON.stringify(box.value)}) still answers one cell past its own field`);
  check(box.inside.every((hit) => hit === "self"), `${box.label} (${JSON.stringify(box.value)}) does not own its own cells: ${box.inside}`);
}

// ---- 2. writes -------------------------------------------------------------
const before = skeleton(await textarea.inputValue());
const total = await controls.count();
for (let index = 0; index < total; index++) {
  const select = controls.nth(index);
  const label = await select.getAttribute("aria-label");
  const options = await select.locator("option").evaluateAll((els) => els.map((e) => e.value));
  for (const option of options) {
    // A reader opens the menu, reads it, and only then picks — long enough
    // for the page's debounced commit to land and re-render underneath.
    await select.focus();
    await page.waitForTimeout(250);
    await select.selectOption(option);
    await page.waitForTimeout(250);
    const source = await textarea.inputValue();
    let after;
    try { after = skeleton(source); } catch (error) { after = `UNPARSEABLE: ${error.message}`; }
    check(after === before, `${label} -> ${JSON.stringify(option)} changed more than its own field\n    expected ${before}\n    got      ${after}\n--- source ---\n${source}`);
    if (after !== before) break; // one report per control is enough
  }
}

check(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
await browser.close();
server?.kill();

if (fail.length) {
  console.error(`\n${fail.length} failure(s):`);
  for (const message of fail) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`diagrams editor e2e: ${boxes.length} controls, every option driven, all clean`);
