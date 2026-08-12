import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.addInitScript(() => { window.__glyphPerf = {}; });
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
  await page.evaluate(() => { window.__glyphPerf.raster = []; });
  await page.waitForTimeout(3000);
  const stats = await page.evaluate(() => {
    const arr = (window.__glyphPerf.raster || []).slice(-200);
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      n: arr.length,
      mean: sum / arr.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
    };
  });
  results[space] = stats;
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
