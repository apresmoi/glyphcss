import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1800,height:1050}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
const ids=['pulse','spinner','comet','bars','wave','rings','orbit','barber','sweep','breathe','moire','grid','static','braille','scan','ripple','flow','matrix','scramble','glitch','progress-bar','progress-soft','progress-stripes','progress-gauge','progress-voices','progress-ring','progress-dissolve'];
const dead=[];
for (const id of ids) {
  await p.goto('http://localhost:4323/examples/loaders?l='+id,{waitUntil:'networkidle',timeout:60000});
  await p.waitForTimeout(3200);
  const sel='.ld-size:nth-child(8) .glyph-output';
  const a=await p.locator(sel).textContent(); await p.waitForTimeout(750);
  const c=await p.locator(sel).textContent();
  if (a===c) dead.push(id);
}
console.log('frozen loaders:', dead.length ? dead.join(', ') : 'none');
console.log('errors:', errs.slice(0,3));
await b.close();
