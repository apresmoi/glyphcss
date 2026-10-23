// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { GlyphDemo, type GlyphDemoProps } from "./GlyphDemo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const examples = [...readFileSync("src/content/docs/guides/effects.mdx", "utf8").matchAll(/<GlyphDemo [^\n]*\/>/g)].map(([tag]) => ({
  effect: /effect="([^"]+)"/.exec(tag)![1] as GlyphDemoProps["effect"],
  effectParams: JSON.parse(/effectParams={(\{.*?\})}/.exec(tag)![1]),
}));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it.each(examples)("animates the real $effect docs example and cancels all frames on StrictMode unmount", async (example) => {
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++nextId, fn); return nextId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<StrictMode><GlyphDemo id="effect" geometry="cube" defaults='{"renderMode":"solid"}' {...example} noCode noControls /></StrictMode>));
  await vi.waitFor(() => expect(host.querySelector("[data-initialized] pre.glyph-output")).not.toBeNull(), { timeout: 5000 });
  async function step(now: number) {
    const batch = [...frames.values()];
    frames.clear();
    await act(async () => batch.forEach(fn => fn(now)));
  }
  await step(1000);
  const pre = host.querySelector("pre.glyph-output")!;
  const first = pre.innerHTML;
  expect(pre.textContent!.replace(/\s/g, "").length).toBeGreaterThan(20);
  for (let i = 1; i <= 10; i++) await step(1000 + i * 100);
  expect(pre.innerHTML).not.toBe(first);
  await act(async () => root!.render(null));
  expect(frames.size).toBe(0);
}, 15000);
