import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GLYPHCSS_BASE_URL ?? 'http://127.0.0.1:4324';
const browser = await chromium.launch({ headless: true });
const routes = ['gallery', 'charts', 'diagrams', 'maps', 'synth', 'wordart', 'examples/loaders'];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const route of routes) {
      errors.length = 0;
      assert.equal((await page.goto(`${base}/${route}`)).status(), 200);
      await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'), {}, { timeout: 45000 });
      await page.waitForFunction(() => [...document.querySelectorAll('.synth-main pre')].some(node => node.textContent.trim().length > 30), {}, { timeout: 45000 });
      await page.evaluate(() => document.fonts.ready);
      const mobile = viewport.width <= 1100;
      if (mobile) {
        const renderActions = page.locator('.synth-export-bar');
        if (await renderActions.count()) {
          assert.equal(await renderActions.isVisible(), true, `${route}: standalone render actions stay reachable`);
          assert.ok(await renderActions.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${route}: every render action fits without horizontal scrolling`);
          const actionBounds = await renderActions.boundingBox();
          const renderBox = await page.locator('.synth-viewport').evaluate(node => ({
            bottom: node.getBoundingClientRect().bottom - parseFloat(getComputedStyle(node).paddingBottom),
          }));
          assert.ok(renderBox.bottom <= actionBounds.y + 1, `${route}: rendered area clears wrapped footer actions`);
          const tabBarBounds = await page.locator('.dn-mobile-tabs').boundingBox();
          assert.ok(actionBounds.x >= 0 && actionBounds.x + actionBounds.width <= viewport.width, `${route}: render actions fit horizontally`);
          if (viewport.width > 600 && viewport.height <= 500) {
            assert.ok(actionBounds.x + actionBounds.width <= tabBarBounds.x, `${route}: landscape footer groups do not overlap`);
          } else {
            assert.ok(actionBounds.y + actionBounds.height <= tabBarBounds.y, `${route}: render actions clear the mobile tabs`);
          }
        }
        const tabGeometry = await page.locator('.dn-mobile-tabs button').evaluateAll(buttons => buttons.map(button => ({
          label: button.textContent, width: button.clientWidth, content: button.scrollWidth,
          left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right,
          height: button.getBoundingClientRect().height,
        })));
        for (const tab of tabGeometry) {
          assert.ok(tab.content <= tab.width + 1, `${route}: ${tab.label} fits without truncation`);
          assert.ok(tab.left >= 0 && tab.right <= viewport.width, `${route}: ${tab.label} stays on screen`);
          assert.ok(tab.height >= 44, `${route}: ${tab.label} retains a touch-sized target`);
        }
        const tabs = page.locator('.dn-mobile-tabs button');
        for (let index = 0; index < await tabs.count(); index++) {
          const tab = tabs.nth(index);
          if ((await tab.innerText()).includes('Random')) continue;
          const panel = page.locator('#' + await tab.getAttribute('aria-controls'));
          assert.equal(await panel.isVisible(), false, `${route}: closed drawer stays hidden`);
          await tab.click();
          assert.equal(await tab.getAttribute('aria-expanded'), 'true');
          await panel.waitFor({ state: 'visible' });
          const bounds = await panel.boundingBox();
          const tabBounds = await tab.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, `${route}: ${await tab.innerText()} drawer fits horizontally ${JSON.stringify(bounds)}`);
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= tabBounds.y + 1, `${route}: drawer clears tabs`);
          assert.ok(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${route}: drawer content fits`);
          await tab.click();
          await panel.waitFor({ state: 'hidden' });
        }
      } else {
        const layout = await page.evaluate(() => [...document.querySelectorAll('.synth-voices,.synth-body>.dn-floating-controls,.dn-lil-gui-host,.lil-gui.root')].filter(node => node.getBoundingClientRect().width).map(node => ({ name: node.className, client: node.clientWidth, scroll: node.scrollWidth })));
        for (const panel of layout) assert.ok(panel.scroll <= panel.client + 1, `${route}: ${panel.name} overflows (${panel.scroll}/${panel.client})`);
        const rail = await page.locator('.synth-voices').boundingBox();
        assert.equal(rail.width, route === 'diagrams' ? 460 : 320, `${route}: shared rail width`);
      }
      if (route === 'diagrams') {
        await page.locator('.diagrams-preview[aria-busy="false"]').waitFor();
        const scrollFrame = await page.locator('.diagrams-grid-scroll').boundingBox();
        const preview = await page.locator('.diagrams-preview').boundingBox();
        assert.ok(scrollFrame.y >= preview.y - 1 && scrollFrame.y + scrollFrame.height <= preview.y + preview.height + 1, 'Diagram scroll frame stays inside the available viewport');
      }
      const dropdowns = await page.evaluate(() => [...document.querySelectorAll('.synth-body select:not(.diagrams-editor-choice-select)')].filter(node => node.getBoundingClientRect().width > 0).map(node => {
        const frame = node.closest('.gx-select');
        const style = getComputedStyle(node);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d'); context.font = style.font;
        const text = node.selectedOptions[0]?.textContent ?? '';
        return { text, shared: !!frame, width: frame?.getBoundingClientRect().width, textWidth: context.measureText(text).width, padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), font: style.fontSize };
      }));
      for (const dropdown of dropdowns) {
        assert.ok(dropdown.shared, `${route}: native dropdown bypasses BracketSelect: ${dropdown.text}`);
        assert.equal(dropdown.font, '12px', `${route}: shared dropdown type size`);
        assert.ok(dropdown.width <= dropdown.textWidth + dropdown.padding + 4, `${route}: dropdown has excess space: ${JSON.stringify(dropdown)}`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route}: page overflows`);
      assert.deepEqual(errors, [], `${route}: browser errors`);
      if (process.env.GLYPHCSS_SCREENSHOTS) await page.screenshot({ path: `/tmp/glyphcss-layout-${route.replaceAll('/', '-')}-${viewport.width}.png` });
      console.log(`${route} ${viewport.width}: layout, drawers, dropdowns and render passed`);
    }
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('.hero-scene .glyph-output')?.textContent.trim().length > 30, {}, { timeout: 45000 });
    const hero = await page.evaluate(() => {
      const slot = document.querySelector('.hero-scene').getBoundingClientRect();
      const demo = document.querySelector('#hero-demo');
      const bounds = demo.getBoundingClientRect();
      return { slot: slot.toJSON(), demo: bounds.toJSON(), border: getComputedStyle(demo).borderWidth };
    });
    assert.ok(Math.abs(hero.slot.width - hero.demo.width) < 1 && Math.abs(hero.slot.height - hero.demo.height) < 1, 'Hero fills its banner slot');
    assert.equal(hero.border, '0px', 'Embedded hero has no standalone border');
    await page.close();
  }
} finally { await browser.close(); }
