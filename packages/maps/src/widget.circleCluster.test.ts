// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

// 400 points in a 4x4 degree square: at a 40-degree view several share every cell.
const points: GlyphMapVectorFeature[] = Array.from({ length: 400 }, (_, i) => ({
  id: `p${i}`, geometryType: "point", rings: [[[(i % 20) / 5, Math.floor(i / 20) / 5]]], properties: {},
}));

const hosts: HTMLElement[] = [];
afterEach(() => { for (const h of hosts.splice(0)) h.remove(); });

async function mount(cluster?: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, { view: { center: [2, 2], span: 40, cols: 80, rows: 40 }, projection: glyphMapEquirectangular(), tilt: 0 });
  map.addLayer({ type: "circle", id: "dots", source: { features: points }, color: "#5ad1c4", ...(cluster === undefined ? {} : { cluster }) });
  await map.idle();
  map.scene.rerender();
  const dots = () => [...host.querySelectorAll<HTMLElement>(".glyph-map-circle")];
  return { map, dots };
}

describe("circle cluster", () => {
  it("draws one dot per point when omitted", async () => {
    const { map, dots } = await mount();
    expect(dots()).toHaveLength(400);
    map.destroy();
  });

  it("aggregates points that share a bin into one larger dot", async () => {
    const { map, dots } = await mount(2);
    expect(dots().length).toBeGreaterThan(0);
    expect(dots().length).toBeLessThan(20);
    const sizes = dots().map(d => parseFloat(d.style.width));
    expect(Math.max(...sizes)).toBeGreaterThan(4); // a lone 2 px dot is 4 px wide
    map.destroy();
  });

  it("re-bins when the zoom crosses an octave, and keeps every marker across a pan", async () => {
    const { map, dots } = await mount(2);
    const coarse = dots().length;
    const before = new Set(dots());
    map.setView({ center: [2.3, 2.1] });
    map.scene.rerender();
    expect(new Set(dots())).toEqual(before);
    // A live refresh with the same points must MOVE the bins, not recreate them.
    map.setLayerSource("dots", { features: points.map(p => ({ ...p })) });
    await map.idle();
    map.scene.rerender();
    expect(new Set(dots())).toEqual(before);
    map.setView({ center: [2, 2], span: 5 });
    map.scene.rerender();
    expect(dots().length).toBeGreaterThan(coarse * 4);
    map.destroy();
  });
});
