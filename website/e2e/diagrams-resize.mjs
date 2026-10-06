import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GLYPHCSS_BASE_URL ?? 'http://127.0.0.1:4324';
const labels = { docs: 'Docs', prep: 'Chunk + embed', index: 'Index', query: 'Query', qembed: 'Embed', retrieve: 'Retrieve', rerank: 'Rerank', generate: 'Generate' };
const edges = ['docs → prep', 'prep → index', 'query → qembed', 'index → retrieve', 'qembed → retrieve', 'retrieve → rerank', 'rerank → generate'];
const normalize = text => text.replace(/[^a-z0-9]/gi, '').toLowerCase();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/diagrams`);
  await page.getByRole('button', { name: 'Apply RAG pipeline', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);

  async function settle(title = 'RAG pipeline', count = 8) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Completed-render dimensions distinguish a fresh layout from the prior
    // frame before ResizeObserver invalidates its aria-busy state.
    await page.waitForFunction(({ title, count }) => {
      const preview = document.querySelector('.diagrams-preview');
      const pre = preview?.querySelector('pre');
      if (!pre || preview.getAttribute('aria-busy') !== 'false' || pre.getAttribute('aria-label') !== title) return false;
      const bounds = preview.getBoundingClientRect();
      return Math.abs(Number(preview.dataset.viewportWidth) - bounds.width) < 1
        && Math.abs(Number(preview.dataset.viewportHeight) - bounds.height) < 1
        && preview.querySelectorAll('.diagrams-hotspot.is-node').length === count
        && !preview.querySelector('.diagrams-hotspot-layer')?.hidden;
    }, { title, count }, { timeout: 15000 });
  }

  async function inspect(viewport, direction, graph = { title: 'RAG pipeline', labels, edges }) {
    const count = Object.keys(graph.labels).length;
    await settle(graph.title, count);
    const snapshot = await page.waitForFunction(count => {
      const preview = document.querySelector('.diagrams-preview');
      if (preview.getAttribute('aria-busy') !== 'false' || preview.querySelectorAll('.diagrams-hotspot.is-node').length !== count) return false;
      const bounds = preview.getBoundingClientRect();
      if (Math.abs(Number(preview.dataset.viewportWidth) - bounds.width) >= 1 || Math.abs(Number(preview.dataset.viewportHeight) - bounds.height) >= 1) return false;
      const pre = preview.querySelector('pre');
      const box = preview.getBoundingClientRect(), rendered = pre.getBoundingClientRect();
      const overlay = document.querySelector('.diagrams-data-overlay');
      const overlayBounds = overlay.getBoundingClientRect();
      const parentBounds = overlay.parentElement.getBoundingClientRect();
      const contains = (outer, inner) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1
        && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
      const controlsFit = contains(parentBounds, overlayBounds)
        && [...overlay.children].every(child => contains(overlayBounds, child.getBoundingClientRect()));
      const lines = pre.textContent.split('\n');
      const cellW = rendered.width / lines[0].length, cellH = rendered.height / lines.length;
      const nodes = [...preview.querySelectorAll('.diagrams-hotspot.is-node')].map(node => {
        const rect = node.getBoundingClientRect();
        const x0 = Math.round((rect.left - rendered.left) / cellW), y0 = Math.round((rect.top - rendered.top) / cellH);
        const cols = Math.round(rect.width / cellW), rows = Math.round(rect.height / cellH);
        return { id: node.getAttribute('aria-label').replace('Edit node ', ''), x0, y0, rows,
          text: lines.slice(y0, y0 + rows).map(line => line.slice(x0, x0 + cols)).join('\n') };
      });
      return {
        controlsFit, controlsClear: box.top >= overlayBounds.bottom,
        footerClear: box.bottom <= document.querySelector('.synth-export-bar').getBoundingClientRect().top,
        description: pre.getAttribute('aria-description'), font: parseFloat(getComputedStyle(pre).fontSize), nodes,
        fits: rendered.left >= box.left - 1 && rendered.top >= box.top - 1
          && rendered.right <= box.right + 1 && rendered.bottom <= box.bottom + 1,
        edges: [...new Set([...preview.querySelectorAll('.diagrams-hotspot.is-edge')].map(edge => edge.getAttribute('aria-label').replace('Edit edge ', '')))].sort(),
      };
    }, count, { timeout: 15000 });
    const result = await snapshot.jsonValue();
    const context = `${viewport.width}×${viewport.height}`;
    assert.equal(result.font, 13, `${context}: resizing preserves explicit density`);
    assert.ok(result.controlsFit, `${context}: dataset picker stays inside the center pane`);
    assert.ok(result.controlsClear, `${context}: dataset picker does not cover the graph`);
    assert.ok(result.footerClear, `${context}: wrapped export buttons do not cover the graph`);
    assert.match(result.description, /1 panel\./);
    assert.deepEqual(result.nodes.map(node => node.id).sort(), Object.keys(graph.labels).sort());
    assert.deepEqual(result.edges, [...graph.edges].sort());
    for (const node of result.nodes) assert.ok(normalize(node.text).includes(normalize(graph.labels[node.id])), `${context}: complete label ${graph.labels[node.id]} in its node box`);
    if (direction) assert.match(result.description, new RegExp(`; ${direction};`));
    if ([1440, 390].includes(viewport.width)) assert.equal(result.font, 13, `${context}: layout fits at full font size`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(`${graph.title} ${context}: intact graph at fixed ${result.font}px`);
    return result;
  }

  for (const viewport of [
    { width: 1920, height: 1080 }, { width: 1440, height: 900 },
    { width: 1200, height: 800 }, { width: 1101, height: 700 },
    { width: 1024, height: 768 }, { width: 390, height: 844 },
    { width: 320, height: 568 }, { width: 844, height: 390 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await inspect(viewport);
    if (viewport.width === 390) await page.screenshot({ path: '/tmp/glyphcss-stable-graph-390.png' });
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await settle();
  const region = page.getByRole('region', { name: 'Diagram viewport', exact: true });
  await page.waitForFunction(() => document.querySelector('.diagrams-preview').dataset.pannable === 'true', undefined, { timeout: 15000 });
  await region.focus();
  await page.keyboard.press('End');
  assert.ok(await region.evaluate(el => el.scrollTop > 0), 'End reaches overflowing graph rows');
  await page.keyboard.press('Home');
  assert.equal(await region.evaluate(el => el.scrollTop), 0);
  await region.hover();
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => document.querySelector('.diagrams-preview').scrollTop > 0);
  await region.focus();
  await page.keyboard.press('Home');
  const bounds = await region.boundingBox();
  await page.mouse.move(bounds.x + 8, bounds.y + bounds.height - 8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 8, bounds.y + 8, { steps: 10 });
  await page.mouse.up();
  assert.ok(await region.evaluate(el => el.scrollTop > 0), 'Dragging pans overflowing rows');
  assert.equal(await region.evaluate(el => getComputedStyle(el).overflow), 'hidden');

  const generate = page.getByRole('button', { name: 'Edit node generate', exact: true });
  await generate.click();
  assert.equal(await generate.getAttribute('aria-pressed'), 'true');
  const text = await page.locator('.diagrams-preview pre').textContent();
  await page.getByRole('button', { name: /Copy as text/ }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const density = page.locator('#diagrams-controls-panel .controller').filter({ has: page.locator('.name', { hasText: /^Density$/i }) }).locator('input');
  await density.fill('2');
  await density.press('Enter');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await settle();
    assert.equal(await page.locator('.diagrams-preview pre').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 6.5);
    console.log(`Explicit density 2 at ${viewport.width}×${viewport.height}: 6.5px`);
  }
  await density.fill('1');
  await density.press('Enter');
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.diagrams-preview pre')).fontSize) === 13);

  await page.getByRole('button', { name: 'Character set: braille', exact: true }).click();
  await page.getByRole('button', { name: 'Output target: chat', exact: true }).click();
  let chatText;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1101, height: 700 }, { width: 1100, height: 700 }, { width: 390, height: 844 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await settle();
    assert.equal(await page.locator('.target-preview--chat').count(), 1);
    const output = await page.locator('.diagrams-preview pre').evaluate(el => ({ text: el.textContent, font: getComputedStyle(el).fontSize, description: el.getAttribute('aria-description') }));
    assert.match(output.description, /LR; 1 panel\./);
    assert.equal(output.font, '12px', 'Chat font size stays fixed across resizing');
    const lines = output.text.split('\n');
    assert.equal(lines.length, 24, 'Chat keeps the configured row budget instead of stacking edge panels');
    assert.ok(lines.every(line => line.length === 72), 'Chat keeps its configured 72 columns');
    if (chatText !== undefined) assert.equal(output.text, chatText, 'Resizing cannot change a fixed chat export');
    chatText = output.text;
    console.log(`Chat RAG ${viewport.width}×${viewport.height}: complete 72×24 graph at ${output.font}`);
  }
  await page.getByRole('button', { name: /Copy as text/ }).click();
  await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), chatText);
  await page.getByRole('button', { name: /Copy link/ }).click();
  await page.waitForFunction(() => navigator.clipboard.readText().then(text => text.startsWith(location.origin + '/diagrams?d=')));
  const chatLink = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(chatLink);
  await settle();
  assert.equal(await page.locator('.target-preview--chat').count(), 1, 'Saved chat link restores the target');
  assert.equal(await page.getByRole('button', { name: 'Character set: braille', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.diagrams-preview pre').textContent(), chatText, 'Saved chat link preserves the complete graph');
  await page.getByRole('button', { name: 'Output target: terminal', exact: true }).click();
  await settle();
  assert.match(await page.locator('.diagrams-preview pre').getAttribute('aria-description'), /LR; 1 panel\./);
  assert.equal((await page.locator('.diagrams-preview pre').textContent()).split('\n')[0].length, 80);
  await page.getByRole('button', { name: 'Output target: web', exact: true }).click();
  await settle();

  const eventQueue = {
    title: 'Event queue + DLQ',
    labels: { producer: 'Producer', queue: 'Queue', orders: 'Order svc', payments: 'Payment svc', ok1: 'OK?', ok2: 'OK?', doneA: 'Shipped', doneB: 'Charged', dlq: 'Dead letter' },
    edges: ['producer → queue', 'queue → orders', 'queue → payments', 'orders → ok1', 'payments → ok2', 'ok1 → doneA', 'ok2 → doneB', 'ok1 → dlq', 'ok2 → dlq'],
  };
  await page.getByRole('button', { name: 'Apply Event queue + DLQ', exact: true }).click();
  for (const height of [900, 768, 700]) {
    for (const width of [1200, 1150, 1120, 1101, 1100, 1099, 1101]) {
      await page.setViewportSize({ width, height });
      await inspect({ width, height }, undefined, eventQueue);
    }
  }
  await page.screenshot({ path: '/tmp/glyphcss-event-breakpoint-1101-700.png' });

  for (const [form, presets] of [['Sequence', ['Login round trip', 'Hardware interrupt path']], ['Lanes', ['Release train (git)', 'Warehouse lineage']]]) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByRole('button', { name: `Diagram form: ${form}`, exact: true }).click();
    for (const preset of presets) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByRole('button', { name: `Apply ${preset}`, exact: true }).click();
      const widths = [];
      for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(title => {
          const host = document.querySelector('.diagrams-preview'), pre = host?.querySelector('pre');
          const rect = host?.getBoundingClientRect();
          return pre?.getAttribute('aria-label') === title && host.getAttribute('aria-busy') === 'false'
            && Math.abs(Number(host.dataset.viewportWidth) - rect.width) < 1
            && Math.abs(Number(host.dataset.viewportHeight) - rect.height) < 1;
        }, preset, { timeout: 15000 });
        const output = await page.locator('.diagrams-preview pre').evaluate(el => ({ font: parseFloat(getComputedStyle(el).fontSize), cols: el.textContent.split('\n')[0].length, description:el.getAttribute('aria-description'), text: el.textContent }));
        assert.equal(output.font, 13, `${form} ${preset}: fixed density`);
        assert.ok(output.text.trim(), `${form} ${preset}: rendered content`);
        const measuredWidth = await page.locator('.diagrams-preview').evaluate(el => el.getBoundingClientRect().width);
        assert.equal(output.cols, Math.max(1, Math.floor(measuredWidth / (13 * 0.5859375))), `${preset}: exact measured columns`);
        if (preset === 'Login round trip') assert.match(output.description, /2 participants, 3 messages/);
        if (preset === 'Hardware interrupt path') assert.match(output.description, /4 participants, 6 messages/);
        if (form === 'Lanes') assert.match(output.description, /\d+ nodes, \d+ lanes?; \d+ panels?\./);
        widths.push(output.cols);
        console.log(`${form} ${preset} ${viewport.width}×${viewport.height}: ${output.cols} columns at 13px`);
        if (viewport.width === 390) await page.screenshot({ path: `/tmp/glyphcss-stable-${form.toLowerCase()}-390.png` });
      }
      assert.ok(widths[0] > widths[1] && widths[1] >= widths[2], `${preset}: cell budget follows viewport`);
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: 'Output target: terminal', exact: true }).click();
  assert.equal(await density.isDisabled(), true);
  assert.match(await density.locator('..').locator('..').getAttribute('title') ?? '', /only on web/);
    assert.deepEqual(errors, []);
  console.log('Hotspot selection and copied text remain correct after resizing');
} finally {
  await browser.close();
}
