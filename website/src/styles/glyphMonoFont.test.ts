import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCss } from '../test/styles';
const read = (file: string) => readFileSync(path.resolve(__dirname, file), 'utf8');

describe('Glyph Mono web font', () => {
  it('declares both font weights with blocking font display', () => {
    const css = read('./fonts.css');
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css.match(/font-family:\s*"Glyph Mono"/g)).toHaveLength(2);
    expect(css).toContain('src: url("/fonts/glyph-mono.woff2") format("woff2")');
    expect(css).toContain('src: url("/fonts/glyph-mono-bold.woff2") format("woff2")');
    expect(css).toMatch(/font-weight:\s*400/);
    expect(css).toMatch(/font-weight:\s*700/);
    expect(css.match(/font-display:\s*block/g)).toHaveLength(2);
  });
  it('puts Glyph Mono first in the centralized render stack', () => {
    expect(read('./tokens.css')).toMatch(/--gc-font-render:\s*"Glyph Mono",\s*ui-monospace/);
    const css = readCss(path.resolve(__dirname, '../components/GlyphDemo/GlyphDemo.module.css'));
    const outputRule = css.match(/\.glyph-output[^{}]*\{([^}]+)\}/);
    expect(outputRule).not.toBeNull();
    expect(outputRule![1]).toMatch(/font-family:\s*"Glyph Mono",\s*ui-monospace/);
  });
  it.each(['charts', 'diagrams', 'synth'])('loads the render font through the shared %s page layout', page => {
    expect(read(`../pages/${page}.astro`)).toContain('WorkbenchLayout');
    expect(read('../layouts/WorkbenchLayout.astro')).toContain('SiteLayout');
    expect(read('../layouts/SiteLayout.astro')).toMatch(/import ['"]\.\.\/styles\/global\.css['"]/);
    expect(read('./global.css')).toContain('@import "./fonts.css"');
    expect(read('./global.css')).toContain('@import "./tokens.css"');
    const base = readCss(path.resolve(__dirname, './base.css'));
    expect(base).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(base).toMatch(/line-height:\s*1\s*[;}]/);
  });
  it('loads maps without a remote highlighting stylesheet', () => {
    expect(read('../pages/maps.astro')).toContain('WorkbenchLayout');
    expect(read('./global.css') + read('../layouts/SiteLayout.astro')).not.toContain('glyph-demo.css');
    expect(read('../components/GlyphDemo/GlyphDemo.module.css')).not.toMatch(/@import\s+url\("https:/);
  });
});
