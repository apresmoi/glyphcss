import { describe, expect, it } from "vitest";
import { MAP_DATASET_ROWS } from "./mapsDatasets";
import { DATASET_DENSITY_TITLES } from "./terrain";

describe("DATASET_DENSITY_TITLES", () => {
  it.each(MAP_DATASET_ROWS.map((row) => [row.id, row.type, row.label] as const))(
    "prices (or explains the absence of) a density for the %s row mounted as %s",
    (_id, type, label) => {
      expect(DATASET_DENSITY_TITLES[type]).toBeTypeOf("function");
      expect(DATASET_DENSITY_TITLES[type]!(label)).toContain(label);
    },
  );
});
