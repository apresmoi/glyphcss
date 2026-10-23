// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import * as maps from "@glyphcss/maps";
import { GlyphMapDemo } from "./GlyphMapDemo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixtureFetch() {
  return vi.fn(async (url: string) => {
    const bytes = readFileSync(`public${url}`);
    return { ok: true, json: async () => JSON.parse(bytes.toString()), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  });
}
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<StrictMode><GlyphMapDemo /></StrictMode>));
  return host;
}

it("renders real bundled terrain through the widget, displays its credit, and destroys the surviving StrictMode map", async () => {
  const fetch = fixtureFetch();
  vi.stubGlobal("fetch", fetch);
  const create = vi.spyOn(maps, "createGlyphMap");
  const host = await mount();
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce(), { timeout: 10000 });
  const map = create.mock.results[0]!.value as maps.GlyphMapHandle;
  await act(async () => { await map.idle(); });
  const pre = host.querySelector("pre.glyph-output")!;
  expect(pre.textContent!.replace(/\s/g, "").length).toBeGreaterThan(100);
  expect(pre.querySelector("span")).not.toBeNull();
  expect(fetch.mock.calls.some(([url]) => url.endsWith(".bin"))).toBe(true);
  for (const credit of map.getAttributions()) {
    expect(host.textContent).toContain(credit.name);
    expect(host.textContent).toContain(credit.license);
  }
  expect(map.getAttributions().length).toBeGreaterThan(0);
  expect(host.querySelector('[role="status"]')).toBeNull();
  const destroy = vi.spyOn(map, "destroy");
  await act(async () => root!.render(null));
  expect(destroy).toHaveBeenCalledOnce();
  expect(pre.isConnected).toBe(false);
}, 20000);

it("does not mount after unmounting during the provider fetch", async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal("fetch", () => new Promise(done => { resolve = done; }));
  const create = vi.spyOn(maps, "createGlyphMap");
  await mount();
  await act(async () => root!.render(null));
  await act(async () => resolve({ ok: true, json: async () => JSON.parse(readFileSync("public/data/geo-tiles/manifest.json", "utf8")) }));
  expect(create).not.toHaveBeenCalled();
});

it("reports a failed terrain request without leaving an unhandled rejection", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const host = await mount();
  await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain("could not be loaded"), { timeout: 5000 });
});
