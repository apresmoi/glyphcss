import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

const routes = ['diagrams', 'charts', 'gallery', 'maps', 'synth', 'wordart', 'fluid', 'examples/loaders'];
const richRoutes = new Set(['diagrams', 'charts']);
const rails = { diagrams: 'diagrams-source-panel', charts: 'charts-data-panel', gallery: 'gallery-models-panel', maps: 'maps-layers-panel', synth: 'synth-voices-panel', wordart: 'wa-compose-panel', fluid: 'fluid-controls-panel', 'examples/loaders': 'loaders-voices-panel' };

function check(html, route, mutate = () => {}) {
  const window = new Window();
  try {
    const document = window.document;
    document.body.innerHTML = html;
    mutate(document);
    const heading = document.querySelector('h1');
    assert.ok(heading?.textContent.trim(), `${route}: missing heading`);
    assert.equal(heading.closest('astro-island'), null, `${route}: heading would disappear on hydration`);
    assert.ok(heading.parentElement.querySelector('p')?.textContent.trim().length > 60, `${route}: missing introduction`);
    const fallback = document.querySelector('[data-static-workbench]');
    assert.ok(fallback, `${route}: missing static workbench`);
    assert.ok(fallback.closest('astro-island[client="only"]'), `${route}: static content must be replaced on hydration`);
    assert.ok(fallback.querySelector('.synth-shell .synth-body .synth-main'), `${route}: missing real shell`);
    assert.ok(fallback.querySelector(`#${rails[route]}`), `${route}: missing real rail`);
    assert.ok(fallback.querySelector('.dn-floating-controls .instrument-section-heading'), `${route}: missing dock controls`);
    assert.ok(fallback.querySelector('.dn-mobile-tabs'), `${route}: missing mobile tabs`);
    const stageSelector = route === 'examples/loaders' ? '.ld-stage .ld-size__view' : '.synth-viewport';
    const stageRenders = [...fallback.querySelectorAll(`${stageSelector} pre[data-static-render]`)];
    assert.equal(stageRenders.length, route === 'examples/loaders' ? 11 : 1, `${route}: missing render inside stage`);
    const renders = [...fallback.querySelectorAll('pre[data-static-render]')];
    assert.equal(renders.length, richRoutes.has(route) ? 18 : stageRenders.length, `${route}: missing render gallery (${renders.length})`);
    assert.ok(stageRenders.some(render => [...render.querySelectorAll('span')].some(span => span.style.color || span.style.backgroundColor)), `${route}: missing CSS colour in stage`);
    for (const render of renders) {
      const text = render.textContent;
      if (route === 'examples/loaders') {
        const dimensions = render.closest('.ld-size').querySelector('.ld-size__dims').textContent.match(/(\d+)×(\d+)/);
        const [cols, rows] = dimensions.slice(1).map(Number);
        assert.equal(text.split('\n').length, rows, `${route}: wrong tile height`);
        assert.ok(text.split('\n').every(line => line.length === cols), `${route}: wrong tile width`);
      } else {
        assert.ok(text.trim().length > 30 && text.split('\n').filter(line => line.trim()).length >= 3, `${route}: empty render`);
      }
      assert.ok(!text.includes('\x1b['), `${route}: ANSI escape in plain text`);
      assert.ok([...render.querySelectorAll('*')].every(element => element.tagName === 'SPAN'), `${route}: render must contain only text and spans`);
      if (route === 'maps') {
        assert.match(text, /[.:=+*#%@-]/u, `${route}: missing land glyphs`);
        assert.match(text, /~/u, `${route}: missing water glyphs`);
      }
      if (richRoutes.has(route)) {
        assert.match(text, /[\u2500-\u259f\u2801-\u28ff]/u, `${route}: missing box, block or braille glyphs`);
      }
    }
    if (richRoutes.has(route)) {
      const galleryRenders = [...fallback.querySelectorAll('section > pre[data-static-render]')];
      assert.equal(galleryRenders.length, 17, `${route}: missing initial example or 16-example corpus`);
      for (const render of galleryRenders) {
        assert.ok(render.parentElement.querySelector('details pre code')?.textContent.trim(), `${route}: missing source`);
      }
      for (const text of [`npm install @glyphcss/${route}`, 'npm install -D @glyphcss/compile', `npx glyphcss ${route === 'diagrams' ? 'diagram' : 'chart'}`]) {
        assert.ok(fallback.textContent.includes(text), `${route}: missing installation command ${text}`);
      }
      assert.ok(fallback.querySelector('a[href="/coding-agents/install/"]'), `${route}: missing agent skill`);
      assert.ok(fallback.querySelector(`a[href="/${route}/overview/"]`), `${route}: missing documentation`);
      assert.ok(!fallback.textContent.includes('git clone'), `${route}: obsolete skill installation`);
    }
    return renders.length;
  } finally {
    window.happyDOM.abort();
  }
}

// An isolated build can be checked without touching a running dev server's output.
const dist = process.argv.find(arg => arg.startsWith('--dist='))?.slice('--dist='.length);
const base = dist ? pathToFileURL(`${resolve(dist)}/`) : new URL('../dist/', import.meta.url);
for (const route of routes) {
  const html = await readFile(new URL(`${route}/index.html`, base), 'utf8');
  const count = check(html, route);
  console.log(`${route}: real shell, stage, heading, introduction and ${count} static renders passed`);
  if (process.argv.includes('--mutation-check')) {
    const mutateRender = mutation => document => mutation(document.querySelector('pre[data-static-render]'));
    assert.throws(() => check(html, route, document => document.querySelector('.synth-shell').remove()), /missing real shell/);
    assert.throws(() => check(html, route, document => document.querySelector('[data-static-workbench]').remove()), /missing static workbench/);
    assert.throws(() => check(html, route, document => {
      for (const pre of document.querySelectorAll('.synth-main pre[data-static-render]')) pre.remove();
    }), /missing render inside stage/);
    assert.throws(() => check(html, route, document => {
      for (const pre of document.querySelectorAll('pre[data-static-render]')) pre.textContent = pre.textContent;
    }), /missing CSS colour/);
    assert.throws(() => check(html, route, mutateRender(pre => {
      pre.appendChild(pre.ownerDocument.createElement('canvas'));
    })), /only text and spans/);
    if (route === 'maps') {
      for (const [glyph, message] of [['~', /missing land glyphs/], ['#', /missing water glyphs/]]) {
        assert.throws(() => check(html, route, mutateRender(pre => {
          for (const span of pre.querySelectorAll('span')) span.textContent = span.textContent.replace(/[^\s]/g, glyph);
        })), message);
      }
    }
    console.log(`${route}: shell, fallback, stage, colour, DOM-text${route === 'maps' ? ', land and water' : ''} mutations rejected`);
  }
}
