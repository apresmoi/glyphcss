import { describe, it, expect } from "vitest";
import {
  AZIMUTH_BINS,
  ELEVATION_BINS,
  OCCLUSION_DIR_BINS,
  directionBinFromCamera,
  directionVectorFromBin,
} from "./occlusionDirection";

describe("constants", () => {
  it("AZIMUTH_BINS is 4", () => expect(AZIMUTH_BINS).toBe(4));
  it("ELEVATION_BINS is 2", () => expect(ELEVATION_BINS).toBe(2));
  it("OCCLUSION_DIR_BINS is 8", () => expect(OCCLUSION_DIR_BINS).toBe(8));
});

describe("directionBinFromCamera", () => {
  it("uses defaults rotX=65 rotY=45 and returns a valid bin", () => {
    const bin = directionBinFromCamera();
    expect(bin).toBeGreaterThanOrEqual(0);
    expect(bin).toBeLessThan(OCCLUSION_DIR_BINS);
  });

  it("returns 0 for rotX=0 rotY=0 (top-left octant)", () => {
    // azimuth 0 → azBin 0, elevation 0 → elBin 0 → bin 0
    expect(directionBinFromCamera(0, 0)).toBe(0);
  });

  it("handles negative rotY by wrapping to positive", () => {
    // rotY=-90 → 270° → azBin = floor((270/360)*4) = 3
    // rotX=0 → elBin=0 → bin=3*2+0=6
    expect(directionBinFromCamera(0, -90)).toBe(6);
  });

  it("handles rotY >= 360 by wrapping", () => {
    // rotY=360 → 0° → same as rotY=0
    expect(directionBinFromCamera(0, 360)).toBe(directionBinFromCamera(0, 0));
  });

  it("clamps rotX to 0 when negative", () => {
    // rotX=-30 → clamped to 0 → elBin=0
    expect(directionBinFromCamera(-30, 0)).toBe(directionBinFromCamera(0, 0));
  });

  it("clamps rotX to 180 when > 180", () => {
    // rotX=200 → clamped to 180 → elBin = floor((180/180)*2) capped at 1
    expect(directionBinFromCamera(200, 0)).toBe(directionBinFromCamera(180, 0));
  });

  it("rotX=90 lands in elevation bin 1 (lower hemisphere)", () => {
    // el=90 → floor((90/180)*2) = 1
    const bin = directionBinFromCamera(90, 0);
    const elBin = bin % ELEVATION_BINS;
    expect(elBin).toBe(1);
  });

  it("rotX=179 stays in elevation bin 1", () => {
    const bin = directionBinFromCamera(179, 0);
    expect(bin % ELEVATION_BINS).toBe(1);
  });

  it("rotY=359 lands in azimuth bin 3", () => {
    const bin = directionBinFromCamera(0, 359);
    const azBin = Math.floor(bin / ELEVATION_BINS);
    expect(azBin).toBe(3);
  });

  it("rotY=90 lands in azimuth bin 1", () => {
    // 90/360 * 4 = 1.0, floor = 1
    const bin = directionBinFromCamera(0, 90);
    const azBin = Math.floor(bin / ELEVATION_BINS);
    expect(azBin).toBe(1);
  });

  it("all bins are in valid range across a sweep", () => {
    for (let rotY = 0; rotY < 360; rotY += 30) {
      for (let rotX = 0; rotX <= 180; rotX += 30) {
        const bin = directionBinFromCamera(rotX, rotY);
        expect(bin).toBeGreaterThanOrEqual(0);
        expect(bin).toBeLessThan(OCCLUSION_DIR_BINS);
      }
    }
  });
});

describe("directionVectorFromBin", () => {
  it("returns a unit vector for every bin", () => {
    for (let bin = 0; bin < OCCLUSION_DIR_BINS; bin++) {
      const [x, y, z] = directionVectorFromBin(bin);
      const len = Math.sqrt(x * x + y * y + z * z);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it("bin 0 (top elevation, first azimuth) has positive z component", () => {
    // elevation 0 → elBin=0, center at (0.25/2)*180=22.5°, cos(22.5°)>0
    const [, , z] = directionVectorFromBin(0);
    expect(z).toBeGreaterThan(0);
  });

  it("bin 1 (lower elevation, first azimuth) has negative z component", () => {
    // elevation bin 1, center at (1.5/2)*180=135°, cos(135°)<0
    const [, , z] = directionVectorFromBin(1);
    expect(z).toBeLessThan(0);
  });

  it("bin 2 (top elevation, second azimuth) has different azimuth than bin 0", () => {
    const [x0, y0] = directionVectorFromBin(0);
    const [x2, y2] = directionVectorFromBin(2);
    // Different horizontal direction
    expect(Math.abs(x0 - x2) + Math.abs(y0 - y2)).toBeGreaterThan(0.01);
  });

  it("returns the same bin when feeding vector back through bin→camera→bin (round-trip check)", () => {
    // For each bin, derive approximate rotY/rotX from the vector and check the resulting bin
    for (let bin = 0; bin < OCCLUSION_DIR_BINS; bin++) {
      const [x, y, z] = directionVectorFromBin(bin);
      // Convert vector back to spherical coords
      const elRad = Math.acos(Math.max(-1, Math.min(1, z)));
      const azRad = Math.atan2(y, x);
      const rotX = (elRad * 180) / Math.PI;
      const rotY = ((azRad * 180) / Math.PI + 360) % 360;
      const roundTrip = directionBinFromCamera(rotX, rotY);
      expect(roundTrip).toBe(bin);
    }
  });
});
