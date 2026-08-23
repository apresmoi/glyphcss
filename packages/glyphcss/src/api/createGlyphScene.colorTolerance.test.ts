import { describe, it, expect } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene } from "./createGlyphScene";
import { GlyphEffectOutputChannel, defineGlyphEffect } from "./effects";

/**
 * COLOR-TOLERANCE.md Phase 3 review — coverage for the two `createGlyphScene`
 * call sites `rasterize.colorTolerance.test.ts` and `colorTolerance.test.ts`
 * don't reach:
 *
 *  - `renderRetainedEffects`'s `encodeCellGrid(grid, options.useColors,
 *    options.colorTolerance)` (createGlyphScene.ts:579) — the retained Glyph
 *    Effect recompose path, taken on a params-only update that doesn't
 *    require a full geometry re-render.
 *  - the per-mesh detail layer's `buildRasterizeContext({ ...,
 *    colorTolerance: options.colorTolerance })` (createGlyphScene.ts:1337).
 *
 * Both are proven the same way: render, apply the reviewer's exact mutation
 * (drop the argument), confirm the new assertion fails, then restore.
 */
async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function countSpans(html: string): number {
  return (html.match(/<span/g) ?? []).length;
}

function makeDiv(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

// Fills every cell with glyph "X" at one of two near colors — redmean
// distance ~3.16 (dr=2, rm=129), same pair `rasterize.colorTolerance.test.ts`
// uses — split at the grid midpoint. `target: "viewport"` gives every base
// cell `target.coverage === 1` regardless of mounted geometry (VOLUMETRIC-3.md
// §1), so this needs no mesh at all: the whole row is one continuous
// coverage run with a single color transition, avoiding the "blank cell
// forces nextColor = null" run-break that a geometry-shaped near-color
// boundary would risk (see rasterize.colorTolerance.test.ts for that
// specific hazard and why it matters).
function nearColorGradientProgram() {
  return defineGlyphEffect<{ phase: number }>({
    evaluate({ target, output }) {
      const n = output.coverage.length;
      const half = Math.floor(n / 2);
      for (let i = 0; i < n; i++) {
        if (target.coverage[i]! <= 0) continue;
        output.glyph[i] = "X";
        output.color[i] = i < half ? 0x802020 : 0x822020;
        output.coverage[i] = 1;
        output.channels[i] = GlyphEffectOutputChannel.Glyph | GlyphEffectOutputChannel.Color;
      }
    },
  });
}

describe("createGlyphScene — colorTolerance reaches the retained-effect recompose path (createGlyphScene.ts:579)", () => {
  async function spansAfterRecompose(colorTolerance: number): Promise<number> {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      cols: 20,
      rows: 1,
      useColors: true,
      colorTolerance,
      camera: createGlyphOrthographicCamera(),
    });
    const layer = scene.addEffectLayer({
      effect: nearColorGradientProgram(),
      params: { phase: 0 },
      target: "viewport",
      blend: "replace",
    });
    await flushRenders(); // initial full render — retains the base CellGrid.
    // A params-only write marks the layer dirty without touching geometry,
    // so the next render goes through `renderRetainedEffects` →
    // `composeRetainedGlyphEffectOutput` → `encodeCellGrid` — the recompose
    // path under test, not the full `rasterize()` pipeline already covered
    // elsewhere.
    layer.params.phase = 1;
    await flushRenders();
    const spans = countSpans(scene.output.innerHTML);
    scene.destroy();
    host.remove();
    return spans;
  }

  it("merges the two near-color runs into one span when colorTolerance is set on recompose", async () => {
    const off = await spansAfterRecompose(0);
    const on = await spansAfterRecompose(30);
    // Under the mutation this test was written to catch — dropping the 3rd
    // (`options.colorTolerance`) argument from `encodeCellGrid` — `on` would
    // recompose with an implicit tolerance of 0, identical to `off`, and
    // this assertion fails.
    expect(on).toBeLessThan(off);
    expect(off).toBe(2); // two distinct-color spans, no merge
    expect(on).toBe(1); // merged into one run
  });
});

function makeCubePolygons(): Polygon[] {
  const out: Polygon[] = [];
  const faces: Array<[number, number, number, number, number, number, number, number, number]> = [
    [-1, -1, 1, 1, -1, 1, 1, 1, 1],
    [-1, -1, 1, 1, 1, 1, -1, 1, 1],
  ];
  for (const [x0, y0, z0, x1, y1, z1, x2, y2, z2] of faces) {
    out.push({ vertices: [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]], color: "#88aacc" });
  }
  return out;
}

// Two flat, camera-facing quads at near colors, side by side with no gap
// between them (touching at x=0) — mirrors the `quad()` helper
// `createGlyphScene.targeting.test.ts` uses for exact on-screen placement.
// Flat ambient-only lighting (directional intensity 0, ambient 1) keeps the
// rendered color equal to the authored color, so the redmean distance is
// exactly the authored pair's.
function nearColorQuad(cx: number, color: string): Polygon[] {
  return [{ vertices: [[cx - 1, -1, 0], [cx - 1, 1, 0], [cx + 1, 1, 0], [cx + 1, -1, 0]], color }];
}

describe("createGlyphScene — colorTolerance reaches a per-mesh detail layer's buildRasterizeContext (createGlyphScene.ts:1337)", () => {
  const sceneOptions = {
    cols: 60,
    rows: 16,
    useColors: true,
    mode: "solid" as const,
    doubleSided: true,
    directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
    ambientLight: { intensity: 1 },
    camera: createGlyphOrthographicCamera({ zoom: 50 }),
  };

  async function detailSpans(colorTolerance: number): Promise<number> {
    const host = makeDiv();
    const scene = createGlyphScene(host, { ...sceneOptions, colorTolerance });
    // `density` (any value != 1) pops this mesh into its own detail `<pre>`,
    // rendered through the detail-layer `buildRasterizeContext` call under
    // test — see AGENTS.md "Per-mesh detail layers".
    scene.add(
      [...nearColorQuad(-1, "#802020"), ...nearColorQuad(1, "#822020")],
      { density: 2 },
    );
    await flushRenders();
    const detail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement | null;
    expect(detail).not.toBeNull();
    const spans = countSpans(detail!.innerHTML);
    scene.destroy();
    host.remove();
    return spans;
  }

  it("merges near-color runs on the detail <pre> when colorTolerance is set", async () => {
    const off = await detailSpans(0);
    const on = await detailSpans(30);
    // Under the mutation this test was written to catch — dropping
    // `colorTolerance: options.colorTolerance` from the detail layer's
    // `buildRasterizeContext` call — `on` would render with an implicit
    // tolerance of 0, identical to `off`, and this assertion fails.
    expect(on).toBeLessThan(off);
  });

  it("mounts real base geometry too, so the detail-layer construction itself is sane", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, sceneOptions);
    scene.add(makeCubePolygons()); // shared base <pre>, unaffected by the detail layer under test
    scene.add([...nearColorQuad(-1, "#802020"), ...nearColorQuad(1, "#822020")], { density: 2 });
    await flushRenders();
    const detail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement;
    expect(detail.textContent).toMatch(/\S/); // actually rendered something, not blank
    scene.destroy();
    host.remove();
  });
});
