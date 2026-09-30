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
