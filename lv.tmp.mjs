import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1800,height:1050}});
await p.goto('http://localhost:4323/examples/loaders/?l=moire',{waitUntil:'networkidle',timeout:60000});
await p.waitForTimeout(4200);
await p.locator('.lil-gui .controller').filter({hasText:'Paused'}).first().locator('input[type=checkbox]').check();
await p.waitForTimeout(500);
await p.locator('.voice-card').first().hover(); await p.waitForTimeout(700);
for (const lvl of [0.6,0.75,0.85,0.92]) {
  await p.evaluate((l)=>{ window.__ghostLevel = l; }, lvl);
  // drive the level through the page's own overlay params
  await p.evaluate((l) => {
    const ev = new CustomEvent('noop'); void ev;
    // no public hook — instead nudge via the dock is not wired for the ghost,
    // so measure by re-hovering after patching the constant is not possible here.
  }, lvl);
}
console.log('note: ghost level is a page constant, measuring via effect directly instead');
await b.close();
