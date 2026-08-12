import { chromium } from 'playwright';
import fs from 'node:fs';

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
async function setNumberByLabel(name, value) {
  const rows = await page.$$('.lil-gui .controller');
  for (const row of rows) {
    const label = await row.$eval('.name', (el) => el.textContent).catch(() => null);
    if (label === name) {
      const input = await row.$('input[type="text"], input[type="number"]');
      if (input) {
        await input.fill(String(value));
        await input.press('Enter');
        return true;
      }
    }
  }
  return false;
}

console.log('effect:', await selectByLabel('Effect', 'Matrix rain'));
await page.waitForTimeout(500);
console.log('mapping:', await selectByLabel('Mapping', 'object'));
await page.waitForTimeout(500);
console.log('direction:', await selectByLabel('Direction', 'down'));
await page.waitForTimeout(300);
// Turn off auto-spin so rotation is deterministic, then drag to set rotation.
try {
  const autoSpinRow = await page.$$('.lil-gui .controller');
  for (const row of autoSpinRow) {
    const label = await row.$eval('.name', (el) => el.textContent).catch(() => null);
    if (label === 'Auto-spin') {
      const cb = await row.$('input[type="checkbox"]');
      if (cb && await cb.isVisible() && await cb.isChecked()) await cb.click({ timeout: 3000 });
    }
  }
} catch (e) { console.log('auto-spin toggle skipped:', e.message); }
await page.waitForTimeout(300);

async function grab(tag) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/wordart-object-${tag}.png` });
  const pre = await page.$eval('pre.glyph-output, .wa-stage pre, pre', (el) => el.innerText).catch(() => null);
  return pre;
}

const stage = await page.$('.wa-stage, [class*="stage"]');
const box = stage ? await stage.boundingBox() : null;
console.log('stage box:', box);

const textA = await grab('rot0');

if (box) {
  // Drag horizontally across the stage to rotate the mesh.
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy, { steps: 20 });
  await page.mouse.up();
}
const textB = await grab('rot1');

if (box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy, { steps: 20 });
  await page.mouse.up();
}
const textC = await grab('rot2');

fs.writeFileSync(`${OUT}/wordart-object-rot0.txt`, textA ?? '(none)');
fs.writeFileSync(`${OUT}/wordart-object-rot1.txt`, textB ?? '(none)');
fs.writeFileSync(`${OUT}/wordart-object-rot2.txt`, textC ?? '(none)');
console.log('rot0 length', textA?.length, 'rot1 length', textB?.length, 'rot2 length', textC?.length);

await browser.close();
