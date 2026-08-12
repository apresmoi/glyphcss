import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1800,height:1050}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,110)));
await p.goto('http://localhost:4323/examples/loaders/?l=progress-stripes',{waitUntil:'networkidle',timeout:60000});
await p.waitForTimeout(4000);
const sels = p.locator('.lil-gui select');
for (let i=0;i<await sels.count();i++){ const o=await sels.nth(i).locator('option').allTextContents(); if(o.includes('2x4')) await sels.nth(i).selectOption('2x4'); }
await p.waitForTimeout(1500);
const rows=[];
for (let k=0;k<10;k++){
  rows.push(await p.evaluate(()=>[...document.querySelectorAll('.ld-size')].map(f=>{
    const pre=f.querySelector('pre.glyph-output'); const t=(pre.textContent||'').replace(/\n/g,'');
    const br=[...t].filter(c=>c.codePointAt(0)>=0x2800&&c.codePointAt(0)<=0x28FF).length;
    return {w:Math.round(pre.getBoundingClientRect().width), tw:Math.round(f.getBoundingClientRect().width), br, n:t.length};
  })));
  await p.waitForTimeout(550);
}
const dims = await p.evaluate(()=>[...document.querySelectorAll('.ld-size__dims')].map(e=>e.textContent));
dims.forEach((d,i)=>{
  const ws=[...new Set(rows.map(r=>r[i].w))], tws=[...new Set(rows.map(r=>r[i].tw))];
  const cov=rows.map(r=>r[i].br+'/'+r[i].n);
  console.log(d.padEnd(7), 'preW', String(ws.join('/')).padEnd(12), 'tileW', String(tws.join('/')).padEnd(12), ws.length===1&&tws.length===1?'STABLE':'GROWS', '| fill', cov[0], '→', cov[cov.length-1]);
});
console.log('errors:', errs.slice(0,2));
await b.close();
