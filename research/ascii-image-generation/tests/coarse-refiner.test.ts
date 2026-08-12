import { describe, expect, it } from "vitest";
import artifactJson from "../browser/coarse-refiner-v1.json";
import {
  runGlyphCoarseRefiner,
  type GlyphCoarseRefinerArtifact,
} from "../browser/coarseRefiner";

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

const artifact = artifactJson as unknown as GlyphCoarseRefinerArtifact;

function run(seed: number, shade: number): Uint8ClampedArray {
  const previous = globalThis.ImageData;
  Object.assign(globalThis, { ImageData: TestImageData });
  try {
    const control = new Float32Array(17 * 4);
    for (let cell = 0; cell < 4; cell++) {
      control[2 * 4 + cell] = 0.9;
      control[5 * 4 + cell] = 0.4;
      control[6 * 4 + cell] = 0.6;
      control[7 * 4 + cell] = 0.5;
      control[8 * 4 + cell] = 0.8;
      control[15 * 4 + cell] = 1;
      control[16 * 4 + cell] = shade;
    }
    return runGlyphCoarseRefiner({
      artifact,
      base: new TestImageData(new Uint8ClampedArray(16).fill(100), 2, 2) as unknown as ImageData,
      control,
      controlWidth: 2,
      controlHeight: 2,
      seed,
      prompt: "weathered blue box",
      strength: 0.7,
    }).data;
  } finally {
    Object.assign(globalThis, { ImageData: previous });
  }
}

describe("coarse browser residual refiner", () => {
  it("is deterministic while responding to seed and glyph control interventions", () => {
    expect(run(1427, 0.4)).toEqual(run(1427, 0.4));
    expect(run(1427, 0.4)).not.toEqual(run(1428, 0.4));
    expect(run(1427, 0.4)).not.toEqual(run(1427, 0.9));
  });
});
