import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";

let map: ReturnType<typeof createGlyphMap> | undefined;
afterEach(() => { map?.destroy(); map = undefined; vi.restoreAllMocks(); document.body.innerHTML = ""; });

it("keeps layout cached during headlight pans and remeasures on grid option changes", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const reads = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    const el = this as HTMLElement;
    const probe = el.tagName === "PRE" && el.style.visibility === "hidden";
    const width = el === host ? 256 : probe ? 8 : 0;
    const height = el === host ? 256 : probe ? 16 * (el.textContent ?? "").split("\n").length : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  });
  map = createGlyphMap(host, { view: { center: [0, 0], span: 0.1, cols: 32, rows: 16 },
    projection: glyphMapGlobe(), keyLight: "headlight", layers: [{ type: "line", id: "road",
      source: { features: [{ rings: [[[-0.03, 0], [0.03, 0]]] }] }, color: "#ff0000" }] });
  await map.idle(); map.scene.rerender();
  const output = map.scene.output;
  const layoutReads = () => reads.mock.contexts.filter(e => e === host || e === output).length;
  reads.mockClear();
  for (let i = 1; i <= 5; i++) map.setView({ center: [i * 0.001, 0] });
  expect(output.textContent!.trim().length).toBeGreaterThan(0);
  expect(layoutReads()).toBe(0);
  map.scene.setOptions({ cols: 40 }); map.scene.rerender();
  expect(layoutReads()).toBeGreaterThan(0);
});
