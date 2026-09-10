import { describe, expect, it } from "vitest";
import {
  EXTRUSION_HEIGHT_BOUNDS_M as EXTRUSION_HEIGHT_BOUNDS,
  HEATMAP_RELIEF_HEIGHT_BOUNDS_M as HEATMAP_RELIEF_BOUNDS,
  formatHeightMeters,
  logHeightSliderSpec,
} from "./mapsKit";

/**
 * `logHeightSliderSpec` backs both `MapsWorkbench.tsx`'s `fill-extrusion`
 * height row (`EXTRUSION_HEIGHT_BOUNDS_M` — an ABSOLUTE structure height
 * that must stay reachable at both landmark and hemisphere-wide view) and
 * its `heatmap` height row (`HEATMAP_RELIEF_HEIGHT_BOUNDS_M` — a relief
 * AMPLITUDE added on top of real terrain, whose ceiling relates to
 * terrain's own ~19 km variation rather than to planetary scale). This
 * imports the SAME exported constants `MapsWorkbench.tsx` wires the two
 * rows to — not a copy that could silently drift from production.
 */

describe("formatHeightMeters", () => {
  it("formats sub-kilometre values in metres", () => {
    expect(formatHeightMeters(20)).toBe("20 m");
    expect(formatHeightMeters(999)).toBe("999 m");
  });

  it("formats kilometre-and-above values in km, with a decimal near the low end", () => {
    expect(formatHeightMeters(1_500)).toBe("1.5 km");
    expect(formatHeightMeters(9_999)).toBe("10.0 km");
    expect(formatHeightMeters(15_000)).toBe("15 km");
    expect(formatHeightMeters(2_000_000)).toBe("2000 km");
  });
});

describe("logHeightSliderSpec", () => {
  it("the extrusion row reaches a landmark-scale value at its floor", () => {
    const spec = logHeightSliderSpec({
      key: "height", label: "height", ...EXTRUSION_HEIGHT_BOUNDS,
      value: EXTRUSION_HEIGHT_BOUNDS.min, onChange: () => {}, title: "",
    });
    expect(spec.value).toBeCloseTo(0, 10);
    expect(spec.format(spec.value)).toBe("20 m");
  });

  it("the extrusion row reaches well past the old 600 km ceiling at its top", () => {
    const spec = logHeightSliderSpec({
      key: "height", label: "height", ...EXTRUSION_HEIGHT_BOUNDS,
      value: EXTRUSION_HEIGHT_BOUNDS.max, onChange: () => {}, title: "",
    });
    expect(spec.value).toBeCloseTo(1, 10);
    expect(spec.format(spec.value)).toBe("2000 km");
    // Comfortably exceeds the pre-existing 600,000 m cap this task widened.
    expect(EXTRUSION_HEIGHT_BOUNDS.max).toBeGreaterThan(600_000 * 3);
  });

  it("the extrusion row's onChange converts a slider position back to real metres", () => {
    let last: number | null = null;
    const spec = logHeightSliderSpec({
      key: "height", label: "height", ...EXTRUSION_HEIGHT_BOUNDS,
      value: 150_000, onChange: (v) => { last = v; }, title: "",
    });
    spec.onChange(0);
    expect(last).toBeCloseTo(EXTRUSION_HEIGHT_BOUNDS.min, 6);
    spec.onChange(1);
    expect(last).toBeCloseTo(EXTRUSION_HEIGHT_BOUNDS.max, 0);
  });

  it("the heatmap relief row reaches a subtle, landmark-scale bump at its floor", () => {
    const spec = logHeightSliderSpec({
      key: "height", label: "height", ...HEATMAP_RELIEF_BOUNDS,
      value: HEATMAP_RELIEF_BOUNDS.min, onChange: () => {}, title: "",
    });
    expect(spec.format(spec.value)).toBe("10 m");
  });

  it("the heatmap relief row's ceiling stays at terrain scale, not planetary scale", () => {
    const spec = logHeightSliderSpec({
      key: "height", label: "height", ...HEATMAP_RELIEF_BOUNDS,
      value: HEATMAP_RELIEF_BOUNDS.max, onChange: () => {}, title: "",
    });
    expect(spec.format(spec.value)).toBe("20 km");
    // Deliberately far below the extrusion row's ceiling — relief rides ON
    // terrain (Everest-to-trench is ~19 km), it isn't an absolute altitude.
    expect(HEATMAP_RELIEF_BOUNDS.max).toBeLessThan(EXTRUSION_HEIGHT_BOUNDS.max / 50);
  });

  it("a mid-range value round-trips through position and back within one ULP-scale tolerance", () => {
    for (const bounds of [EXTRUSION_HEIGHT_BOUNDS, HEATMAP_RELIEF_BOUNDS]) {
      let last: number | null = null;
      const mid = Math.sqrt(bounds.min * bounds.max);
      const spec = logHeightSliderSpec({ key: "height", label: "height", ...bounds, value: mid, onChange: (v) => { last = v; }, title: "" });
      expect(spec.value).toBeCloseTo(0.5, 6);
      spec.onChange(spec.value);
      expect(last).toBeCloseTo(mid, 3);
    }
  });
});
