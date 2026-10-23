import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { expect, it } from 'vitest';
const css = postcss.parse(readFileSync(new URL('./GlyphDemo.module.css', import.meta.url), 'utf8'));
function declarations(selector: string) {
  const values: Record<string, string> = {};
  css.walkRules(selector, rule => { rule.walkDecls(decl => { values[decl.prop] = decl.value; }); });
  return values;
}
it('keeps the docs shell, stage, and controls transparent and unframed', () => {
  for (const selector of [':local(.root)', '.root :global(.glyph-demo__canvas)', '.root :global(.glyph-demo__scene-host)', '.controls']) {
    const values = declarations(selector);
    expect(values['border-radius'] ?? '0').toBe('0');
    expect(values.border ?? '0').toBe('0');
    expect(values.background ?? 'transparent').toBe('transparent');
  }
});
it('stacks the stage and controls on narrow screens while preserving the embedded sizing and render font', () => {
  const media = css.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params === '(max-width: 768px)') as postcss.AtRule;
  expect(media).toBeDefined();
  expect(media.toString()).toContain('grid-template-columns: minmax(0, 1fr)');
  expect(declarations('.root.embedded')).toMatchObject({ position: 'absolute', inset: '0', width: '100%', height: '100%', margin: '0', background: 'transparent' });
  expect(declarations('.root :global(.glyph-demo__scene-host) :global(.glyph-output)')['font-family']).toBe('var(--gc-font-render)');
});
