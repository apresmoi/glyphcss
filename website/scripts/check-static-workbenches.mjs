import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const routes = ['diagrams', 'charts', 'gallery', 'maps', 'synth', 'wordart', 'examples/loaders'];
const richRoutes = new Set(['diagrams', 'charts']);

function check(html, route, mutate = () => {}) {
  const window = new Window();
  try {
    const document = window.document;
    document.body.innerHTML = html;
    mutate(document);
    const heading = document.querySelector('h1');
    assert.ok(heading?.textContent.trim(), `${route}: missing heading`);
    assert.equal(heading.closest('astro-island'), null, `${route}: heading would disappear on hydration`);
    const fallback = document.querySelector('[data-static-workbench]');
    assert.ok(fallback, `${route}: missing static workbench`);
    assert.ok(fallback.querySelector('p')?.textContent.trim().length > 60, `${route}: missing introduction`);
    assert.ok(fallback.closest('astro-island[client="only"]'), `${route}: static content must be replaced on hydration`);
    const renders = [...fallback.querySelectorAll('pre[data-static-render]')];
    assert.ok(renders.length >= (richRoutes.has(route) ? 13 : 1), `${route}: missing render gallery (${renders.length})`);
    assert.ok(renders.some(render => [...render.querySelectorAll('span')].some(span => span.style.color || span.style.backgroundColor)), `${route}: missing CSS colour`);
    for (const render of renders) {
      const text = render.textContent;
      assert.ok(text.trim().length > 30 && text.split('\n').filter(line => line.trim()).length >= 3, `${route}: empty render`);
      assert.ok(!text.includes('\x1b['), `${route}: ANSI escape in plain text`);
      assert.ok([...render.querySelectorAll('*')].every(element => element.tagName === 'SPAN'), `${route}: render must contain only text and spans`);
      if (route === 'maps') {
        assert.match(text, /[.:=+*#%@-]/u, `${route}: missing land glyphs`);
        assert.match(text, /~/u, `${route}: missing water glyphs`);
      }
      if (richRoutes.has(route)) {
        assert.match(text, /[\u2500-\u259f\u2801-\u28ff]/u, `${route}: missing box, block or braille glyphs`);
        assert.ok(render.parentElement.querySelector('details pre code')?.textContent.trim(), `${route}: missing source`);
      }
    }
    if (richRoutes.has(route)) {
      for (const text of [`npm install @glyphcss/${route}`, 'npm install -D @glyphcss/compile', `npx glyphcss ${route === 'diagrams' ? 'diagram' : 'chart'}`]) {
        assert.ok(fallback.textContent.includes(text), `${route}: missing installation command ${text}`);
      }
      assert.ok(fallback.querySelector('a[href="https://github.com/apresmoi/glyphcss-diagrams#install"]'), `${route}: missing agent skill`);
      assert.ok(fallback.querySelector('a[href^="/guides/"]'), `${route}: missing documentation`);
    }
    return renders.length;
  } finally {
    window.happyDOM.abort();
  }
}

for (const route of routes) {
  const html = await readFile(new URL(`../dist/${route}/index.html`, import.meta.url), 'utf8');
  const count = check(html, route);
  console.log(`${route}: heading, introduction and ${count} static renders passed`);
  if (process.argv.includes('--mutation-check')) {
    const mutateRender = mutation => document => mutation(document.querySelector('pre[data-static-render]'));
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
    console.log(`${route}: colour, DOM-text${route === 'maps' ? ', land and water' : ''} mutations rejected`);
  }
}
