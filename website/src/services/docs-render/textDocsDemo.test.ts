// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { mountGlyphDemo } from "../glyph-scene/mountGlyphDemo";
import type { Tunables } from "../glyph-scene/types";
import { glyphDocsInkBounds } from "./glyphRender";

const text = readFileSync(resolve("src/content/docs/guides/text.mdx"), "utf8");
const asset = JSON.parse(readFileSync(resolve("public/data/docs-text.json"), "utf8"));
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads the fonts page's JSON through the real demo and keeps the text when tilted", async () => {
  const demo = text.match(/<GlyphDemo\b[\s\S]*?\/>/)![0];
  const url = demo.match(/polygonsUrl="([^"]+)"/)![1]!;
  const defaults = demo.match(/defaults='([^']+)'/)![1]!;
  expect(JSON.parse(readFileSync(resolve(`public${url}`), "utf8"))).toEqual(asset);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(asset)),
  );
  const host = document.createElement("div");
  host.setAttribute("data-polygons-url", url);
  host.setAttribute("data-defaults", defaults);
  host.setAttribute("data-no-hotspots", "1");
  host.innerHTML =
    '<div class="glyph-demo__scene-host"></div><div class="glyph-demo__loading"></div><div class="glyph-demo__stats"></div>';
  const sceneHost = host.querySelector<HTMLElement>(".glyph-demo__scene-host")!;
  Object.defineProperties(sceneHost, { clientWidth: { value: 400 }, clientHeight: { value: 320 } });
  // happy-dom has no layout; supply a docs viewport and Glyph Mono cell metrics.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.style.visibility === "hidden" ? new DOMRect(0, 0, 4, 20 * (10 / 1.5)) : new DOMRect(0, 0, 400, 320);
  });
  document.body.append(host);
  let update!: (partial: Partial<Tunables>) => void;
  const changed = vi.fn();
  cleanups.push(
    mountGlyphDemo(host, {
      onReady: (fn) => {
        update = fn;
      },
      onChange: changed,
    })!,
  );
  await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 5000 });
  expect(fetch).toHaveBeenCalledWith(url);
  const handle = (host as HTMLElement & { glyphcssDemo: { getPolygons: () => Polygon[] } }).glyphcssDemo;
  const polygons = handle.getPolygons();
  expect(polygons).toHaveLength(
    asset.faces.reduce((count: number, face: { v: number[] }) => count + face.v.length - 2, 0),
  );
  const pre = host.querySelector("pre.glyph-output")!;
  const before = pre.textContent!;
  expect(before.trim()).not.toBe("");
  const lines = before.split("\n");
  const bounds = glyphDocsInkBounds(before);
  expect(bounds.cols / lines[0]!.length).toBeGreaterThan(0.5);
  expect(bounds.rows / lines.length).toBeGreaterThan(0.5);
  update({ rotX: 65 });
  expect(handle.getPolygons()).toBe(polygons);
  expect(pre.textContent!.trim()).not.toBe("");
  expect(pre.textContent).not.toBe(before);
});
