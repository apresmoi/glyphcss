import { mountGlyphDemo } from "../../services/glyph-scene/mountGlyphDemo";
// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { GlyphDemo } from './GlyphDemo';

const runtime = vi.hoisted(() => ({ mount: vi.fn(), dispose: vi.fn() }));
vi.mock('../../services/glyph-scene/mountGlyphDemo', () => ({ mountGlyphDemo: runtime.mount }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach(root => root.unmount()));
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it('owns one runtime per surviving host and disposes it on unmount, including StrictMode remounts', async () => {
  expect(mountGlyphDemo).toBe(runtime.mount);
  runtime.mount.mockImplementation(() => runtime.dispose);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => { root.render(<StrictMode><GlyphDemo id="lifecycle" noControls noCode /></StrictMode>); });
  await vi.waitFor(() => expect(runtime.mount).toHaveBeenCalledTimes(1), { timeout: 5000 });
  expect(runtime.mount.mock.calls[0][0]).toBe(host.querySelector('#lifecycle'));
  expect(runtime.dispose).not.toHaveBeenCalled();
  await act(async () => { root.render(null); });
  expect(runtime.dispose).toHaveBeenCalledTimes(1);
  await act(async () => { root.render(<GlyphDemo id="remounted" noControls noCode />); });
  await vi.waitFor(() => expect(runtime.mount).toHaveBeenCalledTimes(2), { timeout: 5000 });
  await act(async () => { root.render(null); });
  expect(runtime.dispose).toHaveBeenCalledTimes(2);
}, 10000);

it('does not mount a runtime into a host removed before its lazy import resolves', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => { root.render(<GlyphDemo id="removed" />); });
  act(() => { root.render(null); });
  await act(async () => {});
  expect(runtime.mount).not.toHaveBeenCalled();
});

async function mount(props: Parameters<typeof GlyphDemo>[0]) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  runtime.mount.mockImplementation((_element, observer) => {
    if (observer) {
      const state = { ...DEFAULT_TUNABLES, ...JSON.parse(props.defaults ?? '{}'), geometry: props.geometry ?? 'cuboctahedron' };
      observer.onReady((partial: Partial<Tunables>) => {
        Object.assign(state, partial);
        observer.onChange({ ...state });
      });
      observer.onChange(state);
    }
    return runtime.dispose;
  });
  await act(async () => root.render(<GlyphDemo {...props} />));
  return { host, root };
}

import { DEFAULT_TUNABLES, type Tunables } from '../../services/glyph-scene/types';
import styles from './GlyphDemo.module.css';
import sectionStyles from '../ControlSection/ControlSection.module.css';
import sliderStyles from '../SliderRow/SliderRow.module.css';
import selectStyles from '../BracketSelect/BracketSelect.module.css';
import panelStyles from '../CodePanel/CodePanel.module.css';

const openCode = (host: HTMLElement) => {
  // Code starts collapsed under the feature; the reader opens it on request.
  expect(host.querySelector('aside')).toBeNull();
  const toggle = [...host.querySelectorAll('button')].find(b => b.textContent === 'Code')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  act(() => toggle.click());
};

it('uses shared workbench controls and code for the apple, with no inapplicable geometry or period control', async () => {
  const { host } = await mount({ id: 'apple', mesh: '/gallery/glb/apple.glb', defaults: '{"renderMode":"solid"}' });
  openCode(host);
  expect(host.querySelector('fieldset')!.disabled).toBe(false);
  expect(host.querySelector(`[class~="${sectionStyles.root}"]`)).not.toBeNull();
  expect(host.querySelector(`[class~="${sliderStyles.track}"]`)).not.toBeNull();
  expect(host.querySelector(`[class~="${selectStyles.root}"]`)).not.toBeNull();
  expect(host.querySelector('aside')!.classList.contains(panelStyles.inline)).toBe(true);
  expect(host.textContent).toContain('Mesh: apple.glb');
  expect(host.querySelector('[aria-label="Geometry"]')).toBeNull();
  expect(host.querySelector('[aria-label="Period (s)"]')).toBeNull();
  expect(host.querySelector('.lil-gui, .glyph-demo__tabs, .glyph-demo__snippet')).toBeNull();
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Export format"]')!;
  for (const framework of ['vanilla', 'react', 'vue']) {
    act(() => { select.value = framework; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelector('code')!.textContent).toContain('/gallery/glb/apple.glb');
    expect(host.querySelector('code')!.textContent).not.toMatch(/cuboctahedron|resolveGeometry/);
  }
});

it('updates built-in geometry, numeric settings, snippets, copy, and close/reopen through shared controls', async () => {
  const { host } = await mount({ id: 'geometry' });
  openCode(host);
  const geometry = host.querySelector<HTMLSelectElement>('[aria-label="Geometry"]')!;
  act(() => { geometry.value = 'cube'; geometry.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelector('code')!.textContent).toContain('resolveGeometry("cube", { size: 100 })');
  const tilt = host.querySelector<HTMLInputElement>('[aria-label="Tilt"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tilt, '42'); tilt.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.querySelector<HTMLInputElement>('[aria-label="Tilt value"]')!.value).toBe('42');
  expect(host.querySelector('code')!.textContent).toContain('rotX: 42');
  const zoom = host.querySelector<HTMLInputElement>('[aria-label="Zoom"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(zoom, '0.5'); zoom.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.querySelector<HTMLInputElement>('[aria-label="Zoom value"]')!.value).toBe('10');
  expect(zoom.getAttribute('aria-valuetext')).toBe('10');
  expect(host.querySelector('code')!.textContent).toContain('zoom: 10');
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
  await act(async () => button('Copy code').click());
  expect(write).toHaveBeenCalledWith(host.querySelector('code')!.textContent);
  act(() => button('Close').click());
  expect(host.querySelector('aside')).toBeNull();
  act(() => button('Code').click());
  expect(host.querySelector('code')!.textContent).toContain('resolveGeometry("cube"');
  write.mockRestore();
});

it('preserves the embedded hero prop path without controls, code or a tuning observer', async () => {
  const { host } = await mount({
    id: 'hero-demo', embedded: true, noControls: true, noCode: true,
    polygonsUrl: '/data/landing-earth.json', autoRotate: true, invertDrag: true,
    pitchRange: null, noZoom: true, interactiveDownscale: 1, realSunLight: true,
  });
  const demo = host.querySelector('#hero-demo')!;
  expect(demo.classList.contains(styles.embedded)).toBe(true);
  expect(demo.getAttribute('data-polygons-url')).toBe('/data/landing-earth.json');
  expect(demo.getAttribute('data-pitch-range')).toBe('none');
  for (const attribute of ['auto-rotate', 'invert-drag', 'no-zoom', 'real-sun-light', 'interactive-downscale']) {
    expect(demo.getAttribute(`data-${attribute}`)).toBe('1');
  }
  expect(host.querySelector('.glyph-demo__viewer')!.getAttribute('data-layout')).toBe('canvas-only');
  expect(host.querySelector('fieldset, aside, button')).toBeNull();
  expect(runtime.mount.mock.calls.at(-1)![1]).toBeUndefined();
});

it('honors explicit controls and polygon-source precedence over mesh and geometry', async () => {
  const { host } = await mount({ id: 'polygons', polygonsUrl: '/earth.json', mesh: '/apple.glb', controls: '["geometry", "density", "lineHeight"]' });
  openCode(host);
  expect(host.querySelector('[aria-label="Geometry"], [aria-label="Zoom"], [aria-label="Render mode"]')).toBeNull();
  expect(host.querySelector('[aria-label="Density"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Line height"]')).not.toBeNull();
  expect(host.querySelector('code')!.textContent).toContain('fetch("/earth.json")');
  expect(host.querySelector('code')!.textContent).not.toMatch(/apple.glb|cuboctahedron/);
});

it('ignores observer notifications after unmount', async () => {
  const { root } = await mount({ id: 'removed-observer' });
  const observer = runtime.mount.mock.calls.at(-1)![1];
  await act(async () => root.render(null));
  await act(async () => observer.onChange({ ...DEFAULT_TUNABLES, zoom: 99 }));
  expect(runtime.dispose).toHaveBeenCalledOnce();
});

it('shows only the requested encoding controls and keeps the collapsed code in sync', async () => {
  const { host } = await mount({ id: 'encoding', controls: '["colorEncoding","charMode","hiddenLines","wireframeJunctions","colorTolerance"]', defaults: '{"renderMode":"wireframe","colorEncoding":"spans"}' });
  expect(host.querySelector('[aria-label="Zoom"], [aria-label="Geometry"], aside')).toBeNull();
  const atlas = [...host.querySelectorAll('button')].find(button => button.textContent === 'Atlas')!;
  act(() => atlas.click());
  expect(atlas.getAttribute('aria-pressed')).toBe('true');
  const chars = host.querySelector<HTMLSelectElement>('[aria-label="Character encoding"]')!;
  expect(chars.querySelector<HTMLOptionElement>('[value="halfblock"]')!.disabled).toBe(true);
  expect(chars.querySelector<HTMLOptionElement>('[value="braille"]')!.disabled).toBe(false);
  act(() => { chars.value = 'braille'; chars.dispatchEvent(new Event('change', { bubbles: true })); });
  const hidden = host.querySelector<HTMLSelectElement>('[aria-label="Hidden lines"]')!;
  act(() => { hidden.value = 'hide'; hidden.dispatchEvent(new Event('change', { bubbles: true })); });
  act(() => host.querySelector<HTMLInputElement>('[aria-label="Box junctions"]')!.click());
  const tolerance = host.querySelector<HTMLInputElement>('[aria-label="Color tolerance"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tolerance, '64'); tolerance.dispatchEvent(new Event('input', { bubbles: true })); });
  openCode(host);
  const code = host.querySelector('code')!.textContent!;
  for (const option of ['colorEncoding: "atlas"', 'charMode: "braille"', 'hiddenLines: "hide"', 'wireframeJunctions: true', 'colorTolerance: 64']) expect(code).toContain(option);
});

it('forwards the hotspot opt-in and includes it in the code panel', async () => {
  const { host } = await mount({ id: 'hotspot', hotspot: true, noControls: true });
  expect(host.querySelector('#hotspot')!.getAttribute('data-docs-hotspot')).toBe('1');
  expect(host.querySelector('#hotspot')!.getAttribute('data-no-hotspots')).toBeNull();
  openCode(host);
  expect(host.querySelector('code')!.textContent).toContain('scene.addHotspot');
});
