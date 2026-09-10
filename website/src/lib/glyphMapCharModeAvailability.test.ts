import { describe, expect, it } from "vitest";
import { computeGlyphMapCharModeAvailability, type GlyphMapCharModeGateInputs } from "./glyphMapCharModeAvailability";

const BASE: GlyphMapCharModeGateInputs = {
  charMode: "ascii",
  bordersOn: false,
  contourOn: false,
  sunStampingTerminator: false,
};

describe("computeGlyphMapCharModeAvailability — ascii", () => {
  it("is always available, regardless of active stroke layers", () => {
    expect(computeGlyphMapCharModeAvailability(BASE).reason).toBeNull();
    expect(
      computeGlyphMapCharModeAvailability({ ...BASE, bordersOn: true, contourOn: true, sunStampingTerminator: true })
        .reason,
    ).toBeNull();
  });
});

describe("computeGlyphMapCharModeAvailability — halfblock/quadrant vs. the shared stroke hook", () => {
  it("halfblock is available when no stroke layer and no sun terminator are active", () => {
    expect(computeGlyphMapCharModeAvailability({ ...BASE, charMode: "halfblock" }).reason).toBeNull();
  });

  it("quadrant is available when no stroke layer and no sun terminator are active", () => {
    expect(computeGlyphMapCharModeAvailability({ ...BASE, charMode: "quadrant" }).reason).toBeNull();
  });

  it("halfblock is unavailable while Borders is mounted, naming it (not Contour)", () => {
    const result = computeGlyphMapCharModeAvailability({ ...BASE, charMode: "halfblock", bordersOn: true });
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("Borders");
    expect(result.reason).not.toContain("Contour");
  });

  it("quadrant is unavailable while Contour is mounted, naming it (not Borders)", () => {
    const result = computeGlyphMapCharModeAvailability({ ...BASE, charMode: "quadrant", contourOn: true });
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("Contour");
    expect(result.reason).not.toContain("Borders");
  });

  it("names both layers when both Borders and Contour are mounted", () => {
    const result = computeGlyphMapCharModeAvailability({ ...BASE, charMode: "halfblock", bordersOn: true, contourOn: true });
    expect(result.reason).toContain("Borders");
    expect(result.reason).toContain("Contour");
  });

  it("is unavailable while the sun terminator is stamping, naming Sun", () => {
    const result = computeGlyphMapCharModeAvailability({ ...BASE, charMode: "halfblock", sunStampingTerminator: true });
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("Sun");
  });

  it("becomes available again once Borders is turned off — live, not a mount-time snapshot", () => {
    const withBorders = computeGlyphMapCharModeAvailability({ ...BASE, charMode: "halfblock", bordersOn: true });
    expect(withBorders.reason).not.toBeNull();

    const withoutBorders = computeGlyphMapCharModeAvailability({ ...BASE, charMode: "halfblock", bordersOn: false });
    expect(withoutBorders.reason).toBeNull();
  });

  it("the reason is actionable — it says to turn the named layer off", () => {
    const result = computeGlyphMapCharModeAvailability({ ...BASE, charMode: "halfblock", bordersOn: true });
    expect(result.reason).toMatch(/turn it off/i);
  });
});
