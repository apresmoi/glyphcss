/**
 * The FIFTH "the roads are on top of the buildings", from the same
 * street-level link — and the second defect found in the SAME place as
 * `80121f4`'s: the retained-effect compositor rebuilds the grid handed to the
 * legacy `transformCells` hook, and what it rebuilt it without this time is
 * the hook's SECOND ARGUMENT.
 *
 * `withTransformCellsLayer` binds each output's own
 * {@link GlyphTransformCellsLayer} — `detail`, `density`, `mesh`, and above
 * all `cellToSceneGrid`, the affine a hook needs to convert a SCENE cell into
 * the grid it was actually handed. Mount ANY effect layer and every output
 * routes through `transformEffectCells` instead, which called the hook with
 * the grid alone. A hook that reads the second argument therefore got
 * `undefined` for a DETAIL grid — indistinguishable, from inside the hook,
 * from the base grid — and `@glyphcss/maps` (the reference consumer named in
 * `GlyphTransformCellsLayer`'s own doc) then stamped its strokes through the
 * IDENTITY affine into a grid `density` times finer, i.e. at `1/density` of
 * their real position. Walk mode always mounts an effect layer (the sky is a
 * mesh-targeted appearance program), so on `/maps` every road in a
 * street-level frame was redrawn across the buildings at roughly half its own
 * height.
 *
 * The discriminator needs no absolute value and no maps knowledge:
 * **mounting an effect layer must not change what the hook is told about the
 * grid it was handed.** Recorded per output, with and without a layer
 * mounted, and compared field for field — a count would pass on a fix that
 * handed every grid the base tag.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene, type GlyphTransformCellsLayer } from "./createGlyphScene";
import { GlyphEffectOutputChannel, defineGlyphEffect } from "./effects";
import type { CellGrid } from "../render/cells";

const COLS = 32;
const ROWS = 24;
const DENSITY = 1.7;

afterEach(() => {
  document.body.innerHTML = "";
});

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** world[0] → rows, world[1] → cols (voxcss axis map). */
function quad(z: number, a0 = -1, a1 = 1, b0 = -1, b1 = 1): Polygon[] {
  return [{ vertices: [[a0, b0, z], [a0, b1, z], [a1, b1, z], [a1, b0, z]], color: "#ffffff" }];
}

const tint = defineGlyphEffect<{ phase: number }>({
  evaluate({ target, output }) {
    for (let i = 0; i < output.coverage.length; i++) {
      if (target.coverage[i]! <= 0) continue;
      output.glyph[i] = "X";
      output.coverage[i] = 1;
      output.channels[i] = GlyphEffectOutputChannel.Glyph;
    }
  },
});

/** Everything the hook was told, per output grid, in call order. */
type Told = {
  readonly cols: number;
  readonly rows: number;
  readonly layer: GlyphTransformCellsLayer | undefined;
};

async function record(withEffect: boolean): Promise<Told[]> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const told: Told[] = [];
  const scene = createGlyphScene(host, {
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 }),
    cols: COLS, rows: ROWS, cellAspect: 2,
    mode: "solid", useColors: false, doubleSided: true,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
    transformCells: (grid: CellGrid, layer?: GlyphTransformCellsLayer) => {
      told.push({ cols: grid.cols, rows: grid.rows, layer });
    },
  });
  // A plain mesh (base grid) and one that separates into its own `<pre>`.
  scene.add(quad(0, -1, 1, -1, 0));
  const detail = scene.add(quad(0.5, -1, 1, 0, 1), { density: DENSITY });
  if (withEffect) scene.addEffectLayer({ effect: tint, target: detail, params: { phase: 0 } });
  await flushRenders();
  scene.rerender();
  await flushRenders();
  const out = told.slice(-2);
  scene.destroy();
  host.remove();
  return out;
}

describe("a mounted effect layer does not erase the transformCells layer identity", () => {
  it("hands every output grid the same layer tag it gets with no effect mounted", async () => {
    const plain = await record(false);
    const withEffect = await record(true);

    // Premises, so neither clause below can pass vacuously: both renders
    // really produce two outputs, and the plain one really distinguishes them.
    expect(plain.map((t) => `${t.cols}x${t.rows}`)).toEqual(withEffect.map((t) => `${t.cols}x${t.rows}`));
    expect(plain.some((t) => t.layer?.detail === true)).toBe(true);
    expect(plain.some((t) => t.layer?.detail === false)).toBe(true);

    // The claim, field for field — `cellToSceneGrid` above all, since that is
    // the number a stroke layer converts its scene cells through.
    for (let i = 0; i < plain.length; i++) {
      expect(withEffect[i]!.layer).toBeDefined();
      expect(withEffect[i]!.layer!.detail).toBe(plain[i]!.layer!.detail);
      expect(withEffect[i]!.layer!.viewport).toBe(plain[i]!.layer!.viewport);
      expect(withEffect[i]!.layer!.density).toBe(plain[i]!.layer!.density);
      expect(withEffect[i]!.layer!.mesh).toBe(plain[i]!.layer!.mesh);
      expect([...withEffect[i]!.layer!.cellToSceneGrid]).toEqual([...plain[i]!.layer!.cellToSceneGrid]);
    }
  });

  it("the detail grid's affine really is not the identity — so the clause above has something to catch", async () => {
    const plain = await record(false);
    const detail = plain.find((t) => t.layer?.detail === true)!;
    // `density` 1.7 → the scale terms are 1/1.7, and a silhouette-fitted grid
    // carries its own origin. A hook handed the identity instead would place
    // every scene cell at `1/1.7` of where it belongs.
    expect(detail.layer!.cellToSceneGrid[0]).toBeCloseTo(1 / DENSITY, 6);
    expect(detail.layer!.cellToSceneGrid[3]).toBeCloseTo(1 / DENSITY, 6);
    expect(detail.layer!.density).toBe(DENSITY);
  });
});
