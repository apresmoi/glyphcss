import { chromium } from 'playwright';

const OUT = '/private/tmp/claude-501/-Users-apresmoi-glyphcss/243f410f-b122-4525-8a7b-42478386b127/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto('http://localhost:4323/wordart/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

async function selectByLabel(name, value) {
  const rows = await page.$$('.lil-gui .controller');
  for (const row of rows) {
    const label = await row.$eval('.name', (el) => el.textContent).catch(() => null);
    if (label === name) {
      const sel = await row.$('select');
      if (sel) { await sel.selectOption(value); return true; }
    }
  }
  return false;
}
async function dragSliderByLabel(name, targetFrac) {
  const rows = await page.$$('.lil-gui .controller');
  for (const row of rows) {
    const label = await row.$eval('.name', (el) => el.textContent).catch(() => null);
    if (label === name) {
      const slider = await row.$('.slider');
      if (slider) {
        const box = await slider.boundingBox();
        await page.mouse.move(box.x + box.width * targetFrac, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.up();
        return true;
      }
    }
  }
  return false;
}
async function readPerfTile() {
  // Perf tiles at top-left: "FPS", "MS", "MB" — read raw text.
  const text = await page.$$eval('div', (els) => {
    const t = els.map(e => e.textContent).filter(t => t && /^\d+ (FPS|MS|MB)/.test(t.trim()));
    return t;
  });
  return text.slice(0, 6);
}

await selectByLabel('Effect', 'Matrix rain');
await page.waitForTimeout(300);
await dragSliderByLabel('Density', 0.85);
await page.waitForTimeout(300);
await dragSliderByLabel('Streams', 0.95);
await page.waitForTimeout(300);
await dragSliderByLabel('Trail', 0.6);
await page.waitForTimeout(500);

const results = {};
for (const space of ['auto', 'surface', 'object']) {
  await selectByLabel('Mapping', space);
  // Let FPS counters warm up / stabilize over a few seconds of continuous animation.
  await page.waitForTimeout(4000);
  results[space] = await readPerfTile();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
