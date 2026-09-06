// @vitest-environment happy-dom
/**
 * Which dataset each POINT layer (`symbol`/`circle`/`heatmap`) starts on.
 *
 * Asserted against `mapsKit.tsx`'s own exported constant — the one
 * `MapsWorkbench.tsx` actually seeds its `pointDataset` state from — rather
 * than a copy, so this cannot pass while the page is wired to something
 * else. It lives in `mapsKit.tsx` rather than inline in the page precisely so
 * a test can read it without importing the whole page component, whose
 * import chain reaches packages the website does not depend on. What makes it worth a test at all is that
 * `symbol`'s default is a product decision (country labels, not city labels)
 * that nothing else in the page states, and `circle`'s is conditional on the
 * countries bake actually carrying a magnitude to size by — a fact this file
 * checks directly against the baked data below.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// See `MapsWorkbench.atlasAvailability.test.ts` for why this stub is required
// before the `mapsKit`/`mapsUrlState` import chain loads under happy-dom.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { POINT_DATASET_DEFAULTS } from "./mapsKit";
import { COUNTRY_TILE_LAYERS } from "../../lib/countryTilesProvider";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public/data/country-tiles");

describe("point layer dataset defaults", () => {
  it("starts the symbol layer on countries", () => {
    expect(POINT_DATASET_DEFAULTS.symbol).toBe("countries");
    expect(COUNTRY_TILE_LAYERS).toContain(POINT_DATASET_DEFAULTS.symbol);
  });

  it("starts the circle layer on countries too", () => {
    expect(POINT_DATASET_DEFAULTS.circle).toBe("countries");
  });

  /**
   * The precondition for the choice above: a circle sized by a column that
   * does not vary is 242 identical dots, which would be a worse default than
   * population-sized cities. `circle` reads `radiusProperty: "pop_scale"`, so
   * that column has to carry a real, varying magnitude in the countries bake.
   */
  it("is only defensible on circle because the countries bake carries a varying pop_scale", async () => {
    const tile = JSON.parse(await fs.readFile(path.join(DATA, "0/0_0.json"), "utf8"));
    const scales = (tile.layers.countries as { properties: Record<string, unknown> }[]).map((f) => Number(f.properties.pop_scale));
    expect(scales.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(new Set(scales).size).toBeGreaterThan(20);
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.5);
  });

  /** A density field wants many samples; 242 country label points are a scatter, not a field. */
  it("leaves the heatmap on the populated-places pyramid", () => {
    expect(POINT_DATASET_DEFAULTS.heatmap).toBe("places");
  });
});
