/**
 * `GlyphMapSymbolLayer.text` — a label composed from the whole feature.
 *
 * `textProperty` names ONE column, and a real label is often two. The case
 * that forced it is `mountain_peak`: OpenFreeMap ships `name` on 100% of the
 * peaks in an alpine tile and `ele` on 98.9%, and the row that rendered them
 * drew an anonymous 1px dot and discarded both. `Matterhorn 4478` is one
 * label; `Matterhorn` alone throws away the only number the feature has.
 *
 * Asserted on the label the widget actually PUTS IN THE DOM, never on the
 * option being set — the whole defect class this replaces is a layer option
 * that is declared and then dropped on the floor.
 */
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  return { host, map, teardown: () => { map.destroy(); host.remove(); } };
}

const peak = (name: string, ele: number | undefined, lon: number, lat: number): GlyphMapVectorFeature => ({
  id: name,
  geometryType: "point",
  properties: ele === undefined ? { name } : { name, ele },
  rings: [[[lon, lat]]],
});

const labels = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")].map((el) => el.textContent);

describe("GlyphMapSymbolLayer.text", () => {
  it("prints the composed label, not the single property textProperty would have named", async () => {
    const { host, map, teardown } = mount();
    try {
      map.addLayer({
        type: "symbol",
        id: "peaks",
        source: { features: [peak("Matterhorn", 4478, 0, 0)] },
        textProperty: "name",
        text: (f) => `${f.properties!.name} ${f.properties!.ele}`,
      });
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-symbol")).toHaveLength(1));
      expect(labels(host)).toEqual(["Matterhorn 4478"]);
    } finally { teardown(); }
  });

  it("leaves textProperty in charge when no builder is given, so every existing symbol row is untouched", async () => {
    const { host, map, teardown } = mount();
    try {
      map.addLayer({
        type: "symbol",
        id: "peaks",
        source: { features: [peak("Matterhorn", 4478, 0, 0)] },
        textProperty: "name",
      });
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-symbol")).toHaveLength(1));
      expect(labels(host)).toEqual(["Matterhorn"]);
    } finally { teardown(); }
  });

  it("is the LABEL, so a feature missing one half gets the other — beside one that has both, in the same layer", async () => {
    // BOTH features in one layer on purpose: a lone half-feature would read
    // the same whether the builder ran or `textProperty` fell back to
    // `name`, so the assertion would pass against a widget that ignored
    // `text` entirely. The pair discriminates.
    const { host, map, teardown } = mount();
    try {
      map.addLayer({
        type: "symbol",
        id: "peaks",
        source: { features: [peak("Matterhorn", 4478, -8, 4), peak("Büel", undefined, 8, -4)] },
        text: (f) => ["name", "ele"].map((k) => f.properties?.[k]).filter((v) => v !== undefined && v !== null && v !== "").join(" "),
      });
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-symbol")).toHaveLength(2));
      expect(labels(host)).toEqual(["Matterhorn 4478", "Büel"]);
    } finally { teardown(); }
  });
});
