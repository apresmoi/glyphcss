import { chromium } from 'playwright';

const OUT = '/private/tmp/claude-501/-Users-apresmoi-glyphcss/243f410f-b122-4525-8a7b-42478386b127/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));
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
await selectByLabel('Mapping', 'object');
await page.waitForTimeout(300);
console.log('density slider:', await dragSliderByLabel('Density', 0.85));
await page.waitForTimeout(300);
console.log('streams slider:', await dragSliderByLabel('Streams', 0.95));
await page.waitForTimeout(300);
console.log('trail slider:', await dragSliderByLabel('Trail', 0.6));
await page.waitForTimeout(800);

await page.screenshot({ path: `${OUT}/wordart-object-dense-rot0.png` });

const stage = await page.$('.wa-stage, [class*="stage"]');
const box = stage ? await stage.boundingBox() : null;
if (box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy, { steps: 25 });
  await page.mouse.up();
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/wordart-object-dense-rot1.png` });

console.log('console/page errors:', JSON.stringify(errors));
await browser.close();
