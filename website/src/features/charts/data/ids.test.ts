import { describe, expect, it } from "vitest";
import { CHARTS_DATASETS, CHARTS_DATASET_ID_ALIASES, findChartsDataset } from "./index";

/**
 * Dataset `id`s are a FROZEN public contract (P2-3, REVIEW-showcase-opus.md;
 * `index.ts`'s own `CHARTS_DATASET_ID_ALIASES` doc): a `?c=` link names one
 * directly, and `select-dataset`/the omission sentinel re-derive a mark's
 * data FROM it alone. This pins the exact current set so a rename is caught
 * HERE — never editing an id in place. To rename one: add
 * `CHARTS_DATASET_ID_ALIASES[oldId] = newId` in `index.ts` and update the
 * pinned list below to the new id.
 *
 * Mutation check: renaming any one id in a vendored dataset file without
 * touching this list makes the first assertion fail with a message naming
 * exactly which id moved (a plain `toEqual` array diff), and dropping the
 * alias fallback in `findChartsDataset` makes the second assertion's own
 * alias-resolution clause go red instead.
 */
describe("dataset ids", () => {
  it("matches the frozen id set — a rename here needs CHARTS_DATASET_ID_ALIASES, not an in-place edit", () => {
    expect(CHARTS_DATASETS.map((d) => d.id).sort()).toEqual([
      "city-monthly-temperatures",
      "co2-mauna-loa",
      "ecommerce-conversion-funnel",
      "energy-consumption-by-source",
      "energy-flow-sankey",
      "gdp-growth-2020-crisis",
      "gdp-life-expectancy-2007",
      "global-electricity-mix",
      "global-temperature",
      "iris-flowers",
      "olympics-2024-medals",
      "olympics-2024-medals-by-type",
      "renewable-electricity-share",
      "treasury-yield-10y",
      "us-unemployment",
      "world-population-by-country",
    ].sort());
  });

  it("every id is unique", () => {
    const ids = CHARTS_DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("findChartsDataset resolves a real id directly and an aliased old id through CHARTS_DATASET_ID_ALIASES", () => {
    expect(findChartsDataset("iris-flowers")).toBe(CHARTS_DATASETS.find((d) => d.id === "iris-flowers"));
    expect(findChartsDataset("not-a-real-id")).toBeUndefined();
    // No alias is registered today (nothing has been renamed) — this proves
    // the RESOLUTION MECHANISM works, not that a specific alias exists,
    // by installing one against the live index and reverting it.
    const spareId = "not-a-real-id";
    (CHARTS_DATASET_ID_ALIASES as Record<string, string>)[spareId] = "iris-flowers";
    try {
      expect(findChartsDataset(spareId)).toBe(CHARTS_DATASETS.find((d) => d.id === "iris-flowers"));
    } finally {
      delete (CHARTS_DATASET_ID_ALIASES as Record<string, string>)[spareId];
    }
  });
});
