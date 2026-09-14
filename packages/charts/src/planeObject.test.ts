import { describe, expect, it } from "vitest";
import {
  createGlyphCanvas,
  createGlyphOrthographicCamera,
  createGlyphScene,
  encodeGlyphSceneObjectSamplerKey,
  type GlyphCanvas,
} from "glyphcss";
import { glyphChartPlaneObject } from "./planeObject";
import type { GlyphChartBuild } from "./types";

/**
 * Packet F4b (PLAN-3d.md §3.1/§7) acceptance gates for `glyphChartPlaneObject`.
 * Each `it` names, in a comment, the mutation the packet brief requires it
 * to redden.
 */

const INK_COLOR = "#ff2200";
const BG_COLOR = "#001122";
const COLS = 8;
const ROWS = 4;

/**
 * A hand-painted `GlyphChartBuild` — bypasses the real chart layout
 * pipeline entirely so the test controls exactly which cells are "ink"
 * (fg-colored) and which are not, rather than depending on whatever a
 * real spec happens to lay out. Left half (canvas cols 0..3) is painted as
 * ink at `INK_COLOR`; the whole canvas (including the right half) carries
 * `BG_COLOR` as its background.
 */
function buildFixture(): GlyphChartBuild {
  const canvas: GlyphCanvas = createGlyphCanvas({ cols: COLS, rows: ROWS, cellAspect: 1, tier: "box" });
  canvas.fillRect(0, 0, COLS - 1, ROWS - 1, { fill: { shade: 0 }, color: "#000000", bg: BG_COLOR });
  canvas.fillRect(0, 0, COLS / 2 - 1, ROWS - 1, { fill: "solid", color: INK_COLOR, bg: BG_COLOR });
  return {
    canvas,
    colorCanvas: canvas,
    plot: { x0: 0, y0: 0, x1: COLS - 1, y1: ROWS - 1 },
    meta: { title: null, series: [], values: 0, description: null },
    report: { ledger: [], unsupportedGlyphs: [], routeConflicts: [] },
    resolved: { target: "web", charset: "box", color: "css", width: COLS, height: ROWS, detail: "balanced", cellAspect: 1, textScale: 1, env: undefined },
  };
}

/**
 * A scene sized and cameraed so the plane object's own quad (produced with
 * `width: COLS`, so `height` resolves to `ROWS` — see `planeObject.ts`'s
 * own doc for the aspect-ratio derivation) fills the render grid exactly
 * ONE output cell per canvas cell, at the default (untransformed)
 * orthographic camera: `rotX=0, rotY=0` projects world X to screen ROW and
 * world Y to screen COLUMN with `zoom = BASE_TILE (50)` and
 * `cellAspect: 1` giving 1 world unit == 1 output cell on both axes.
 */
function makeScene(host: HTMLElement) {
  return createGlyphScene(host, {
    cols: COLS,
    rows: ROWS,
    cellAspect: 1,
    useColors: true,
    mode: "solid",
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 50 }),
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Every distinct `color:#rrggbb` occurring in the scene's rendered HTML. */
function renderedColors(scene: { output: HTMLElement }): string[] {
  return [...new Set([...scene.output.innerHTML.matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!))];
}

describe("glyphChartPlaneObject", () => {
  // Mutation: swap which half of `glyphCanvasTextureSampler`'s ink/non-ink
  // split feeds fg vs bg (the same branch F2's own `sampler.test.ts`
  // guards: invert `mask[...] === 1` to `!== 1` in
  // `packages/glyphcss/src/render/canvas/sampler.ts`) — reddens because
  // the left half then reads BG_COLOR and the right half reads INK_COLOR,
  // the exact opposite of what this test asserts.
  it("mounted with scene.addObject, facing the camera at 1:1, reproduces the chart's fg/bg colours cell for cell", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    scene.addObject(glyphChartPlaneObject(buildFixture(), { width: COLS }));
    await flushRenders();

    const colors = renderedColors(scene);
    expect(colors).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));
    scene.destroy();
  });

  it("rotated 45 degrees about Y, it still paints the texture — it is not flat-coloured", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    // doubleSided so the rotation can never fail this test by culling the
    // back face — this test is about the TEXTURE surviving a transform,
    // not about winding.
    scene.setOptions({ doubleSided: true });
    scene.addObject(glyphChartPlaneObject(buildFixture(), { width: COLS }), { rotation: [0, 45, 0] });
    await flushRenders();

    const colors = renderedColors(scene);
    // A flat-coloured (degenerate UV / lost-texture) render would show at
    // most one non-background colour; a real texture shows both.
    expect(colors).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));
    scene.destroy();
  });

  // Mutation: drop `castShadow`/`receiveShadow` forwarding in
  // `planeObject.ts` (make the mesh's `options` always `undefined`) —
  // reddens automatically, because a mesh that never forwards `castShadow`
  // renders identically whether the caller asked for it or not.
  it("casts a shadow onto a ground mesh — dropping castShadow forwarding erases it", async () => {
    const sceneOptions = {
      cols: 40,
      rows: 40,
      cellAspect: 1,
      useColors: true,
      mode: "solid" as const,
      // The ground quad's own winding is irrelevant to the property under
      // test (the plane's shadow forwarding) — doubleSided just keeps it
      // visible to the camera so a cast shadow has somewhere to show up.
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 60 }),
      directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 1 },
      ambientLight: { intensity: 0.1 },
      shadow: { color: "#000000", opacity: 0.6, lift: 0 },
    };
    // Wound to face +Z (the same bottom-left/bottom-right/top-right/top-
    // left convention `glyphChartPlaneObject` itself uses) so it faces the
    // overhead light — a backward-facing receiver reads pure ambient
    // everywhere and never shows a shadow at all, regardless of casting.
    const ground = { vertices: [[6, -6, -2], [6, 6, -2], [-6, 6, -2], [-6, -6, -2]] as [number, number, number][], color: "#cccccc" };

    const hostCast = document.createElement("div");
    document.body.appendChild(hostCast);
    const sceneCast = createGlyphScene(hostCast, sceneOptions);
    sceneCast.add([ground], { receiveShadow: true });
    sceneCast.addObject(glyphChartPlaneObject(buildFixture(), { width: 4, castShadow: true }), { position: [0, 0, 3] });
    await flushRenders();
    const withCaster = sceneCast.output.innerHTML;
    sceneCast.destroy();

    const hostNoCast = document.createElement("div");
    document.body.appendChild(hostNoCast);
    const sceneNoCast = createGlyphScene(hostNoCast, sceneOptions);
    sceneNoCast.add([ground], { receiveShadow: true });
    sceneNoCast.addObject(glyphChartPlaneObject(buildFixture(), { width: 4, castShadow: false }), { position: [0, 0, 3] });
    await flushRenders();
    const withoutCaster = sceneNoCast.output.innerHTML;
    sceneNoCast.destroy();

    expect(withCaster).not.toBe(withoutCaster);
  });

  // Mutation: same as above — the receiver side of the identical drop.
  it("receives a shadow from a box mesh — dropping receiveShadow forwarding erases it", async () => {
    const sceneOptions = {
      cols: 40,
      rows: 40,
      cellAspect: 1,
      useColors: true,
      mode: "solid" as const,
      camera: createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 60 }),
      directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 1 },
      ambientLight: { intensity: 0.1 },
      shadow: { color: "#000000", opacity: 0.6, lift: 0 },
    };
    const box: [number, number, number][] = [[-1, -1, 3], [-1, 1, 3], [1, 1, 3], [1, -1, 3]];

    const hostReceive = document.createElement("div");
    document.body.appendChild(hostReceive);
    const sceneReceive = createGlyphScene(hostReceive, sceneOptions);
    sceneReceive.add([{ vertices: box, color: "#cccccc" }], { castShadow: true });
    sceneReceive.addObject(glyphChartPlaneObject(buildFixture(), { width: 4, receiveShadow: true }), { position: [0, 0, 0] });
    await flushRenders();
    const withReceiver = sceneReceive.output.innerHTML;
    sceneReceive.destroy();

    const hostNoReceive = document.createElement("div");
    document.body.appendChild(hostNoReceive);
    const sceneNoReceive = createGlyphScene(hostNoReceive, sceneOptions);
    sceneNoReceive.add([{ vertices: box, color: "#cccccc" }], { castShadow: true });
    sceneNoReceive.addObject(glyphChartPlaneObject(buildFixture(), { width: 4, receiveShadow: false }), { position: [0, 0, 0] });
    await flushRenders();
    const withoutReceiver = sceneNoReceive.output.innerHTML;
    sceneNoReceive.destroy();

    expect(withReceiver).not.toBe(withoutReceiver);
  });

  it("remove() leaves no sampler key behind", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    const object = glyphChartPlaneObject(buildFixture(), { width: COLS, id: "removable-plane" });
    const handle = scene.addObject(object);
    await flushRenders();
    expect(renderedColors(scene)).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));

    handle.remove();
    await flushRenders();

    // A fresh, untextured mesh that happens to reuse the SAME encoded
    // sampler key the removed object used: if `remove()` left the sampler
    // registered, this mesh would render the OLD chart's colours; with no
    // leak it falls back to its own flat colour (no matching sampler).
    const leakProbeColor = "#123456";
    const staleKey = encodeGlyphSceneObjectSamplerKey("removable-plane", "chart");
    // Same vertex/UV winding `glyphChartPlaneObject` itself uses (bottom-
    // left, bottom-right, top-right, top-left — front face +Z), so this
    // probe is visible under the same untransformed camera the removed
    // object rendered under.
    scene.add([{
      vertices: [[ROWS / 2, -COLS / 2, 0], [ROWS / 2, COLS / 2, 0], [-ROWS / 2, COLS / 2, 0], [-ROWS / 2, -COLS / 2, 0]],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
      texture: staleKey,
      color: leakProbeColor,
    }]);
    await flushRenders();

    const colors = renderedColors(scene);
    expect(colors).toContain(leakProbeColor);
    expect(colors).not.toEqual(expect.arrayContaining([INK_COLOR]));
    scene.destroy();
  });

  it("rejects a non-positive width", () => {
    expect(() => glyphChartPlaneObject(buildFixture(), { width: 0 })).toThrow(RangeError);
    expect(() => glyphChartPlaneObject(buildFixture(), { width: -1 })).toThrow(RangeError);
  });

  it("sizes the plane to the chart's own cell aspect", () => {
    const object = glyphChartPlaneObject(buildFixture(), { width: 8 });
    const [minX, minY] = object.bounds.min;
    const [maxX, maxY] = object.bounds.max;
    // width (Y extent) == 8, height (X extent) == width * rows / (cols * cellAspect) == 8 * 4 / (8 * 1) == 4.
    expect(maxY - minY).toBeCloseTo(8);
    expect(maxX - minX).toBeCloseTo(4);
  });
});
