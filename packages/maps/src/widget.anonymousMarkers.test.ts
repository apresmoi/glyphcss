// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

// No `id`s, like the baked Dams file: these markers take the wholesale path, all under the empty key.
const anonymous: GlyphMapVectorFeature[] = Array.from({ length: 30 }, (_, i) => ({
  geometryType: "point", rings: [[[7 + (i % 6), 44 + Math.floor(i / 6)]]], properties: { name: `Dam ${i}` },
}));

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, { view: { center: [9.5, 46.5], span: 12, cols: 80, rows: 40 }, projection: glyphMapEquirectangular(), tilt: 0 });
  return { host, map, labels: () => host.querySelectorAll(".glyph-map-symbol").length };
}

describe("point markers without feature ids", () => {
  it("are all removed with their layer", async () => {
    const { host, map, labels } = mount();
    map.addLayer({ type: "symbol", id: "dams", source: { features: anonymous }, color: "#fff", textProperty: "name" });
    await map.idle();
    expect(labels()).toBe(30);
    map.removeLayer("dams");
    expect(labels()).toBe(0);
    map.destroy();
    host.remove();
  });

  it("are all replaced when the source switches to keyed features", async () => {
    const { host, map, labels } = mount();
    map.addLayer({ type: "symbol", id: "dams", source: { features: anonymous }, color: "#fff", textProperty: "name" });
    await map.idle();
    map.setLayerSource("dams", { features: anonymous.slice(0, 5).map((f, i) => ({ ...f, id: `k${i}` })) });
    await map.idle();
    expect(labels()).toBe(5);
    map.destroy();
    host.remove();
  });
});
