import { describe, expect, it } from "vitest";
import {
  createGlyphCanvas,
  createGlyphOrthographicCamera,
  createGlyphScene,
  encodeGlyphSceneObjectSamplerKey,
  type GlyphCanvas,
} from "glyphcss";
import { glyphDiagramPlaneObject } from "./planeObject";
import type { GlyphDiagramPage } from "./renderTypes";

/**
 * Packet F4b (PLAN-3d.md §3.1/§7) acceptance gates for
 * `glyphDiagramPlaneObject` — mirrors `@glyphcss/charts`'
 * `planeObject.test.ts` exactly (same geometry derivation, same mutations);
 * see that file's own top-of-file comment for the mutation rationale.
 */

const INK_COLOR = "#ff2200";
const BG_COLOR = "#001122";
const COLS = 8;
const ROWS = 4;

/** A hand-painted `GlyphDiagramPage` — see the charts test's own `buildFixture` doc. */
function pageFixture(): GlyphDiagramPage {
  const canvas: GlyphCanvas = createGlyphCanvas({ cols: COLS, rows: ROWS, cellAspect: 1, tier: "box" });
  canvas.fillRect(0, 0, COLS - 1, ROWS - 1, { fill: { shade: 0 }, color: "#000000", bg: BG_COLOR });
  canvas.fillRect(0, 0, COLS / 2 - 1, ROWS - 1, { fill: "solid", color: INK_COLOR, bg: BG_COLOR });
  return {
    text: "",
    canvas,
    layout: { nodes: [], edges: [], groups: [], ports: [], direction: "TB", width: COLS, height: ROWS, ledger: [] },
    routes: [],
    labels: [],
  };
}

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

function renderedColors(scene: { output: HTMLElement }): string[] {
  return [...new Set([...scene.output.innerHTML.matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!))];
}

describe("glyphDiagramPlaneObject", () => {
  // Mutation: swap fg/bg in `glyphCanvasTextureSampler`'s own ink/non-ink
  // split (`packages/glyphcss/src/render/canvas/sampler.ts`'s `const ink =
  // mask[...] === 1`) — see `@glyphcss/charts`' `planeObject.test.ts` for
  // the manual mutation run/revert this mirrors; reddens the same way.
  it("mounted with scene.addObject, facing the camera at 1:1, reproduces the diagram's fg/bg colours cell for cell", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    scene.addObject(glyphDiagramPlaneObject(pageFixture(), { width: COLS }));
    await flushRenders();

    const colors = renderedColors(scene);
    expect(colors).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));
    scene.destroy();
  });

  it("rotated 45 degrees about Y, it still paints the texture — it is not flat-coloured", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    scene.setOptions({ doubleSided: true });
    scene.addObject(glyphDiagramPlaneObject(pageFixture(), { width: COLS }), { rotation: [0, 45, 0] });
    await flushRenders();

    const colors = renderedColors(scene);
    expect(colors).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));
    scene.destroy();
  });

  // Mutation: drop `castShadow`/`receiveShadow` forwarding in
  // `planeObject.ts` (make the mesh's `options` always `undefined`) —
  // reddens automatically, since a mesh that never forwards `castShadow`
  // renders identically whether the caller asked for it or not.
  it("casts a shadow onto a ground mesh — dropping castShadow forwarding erases it", async () => {
    const sceneOptions = {
      cols: 40,
      rows: 40,
      cellAspect: 1,
      useColors: true,
      mode: "solid" as const,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 60 }),
      directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 1 },
      ambientLight: { intensity: 0.1 },
      shadow: { color: "#000000", opacity: 0.6, lift: 0 },
    };
    // Wound to face +Z (the same bottom-left/bottom-right/top-right/top-
    // left convention `glyphDiagramPlaneObject` itself uses) so it faces
    // the overhead light — a backward-facing receiver reads pure ambient
    // everywhere and never shows a shadow at all, regardless of casting.
    const ground = { vertices: [[6, -6, -2], [6, 6, -2], [-6, 6, -2], [-6, -6, -2]] as [number, number, number][], color: "#cccccc" };

    const hostCast = document.createElement("div");
    document.body.appendChild(hostCast);
    const sceneCast = createGlyphScene(hostCast, sceneOptions);
    sceneCast.add([ground], { receiveShadow: true });
    sceneCast.addObject(glyphDiagramPlaneObject(pageFixture(), { width: 4, castShadow: true }), { position: [0, 0, 3] });
    await flushRenders();
    const withCaster = sceneCast.output.innerHTML;
    sceneCast.destroy();

    const hostNoCast = document.createElement("div");
    document.body.appendChild(hostNoCast);
    const sceneNoCast = createGlyphScene(hostNoCast, sceneOptions);
    sceneNoCast.add([ground], { receiveShadow: true });
    sceneNoCast.addObject(glyphDiagramPlaneObject(pageFixture(), { width: 4, castShadow: false }), { position: [0, 0, 3] });
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
    sceneReceive.addObject(glyphDiagramPlaneObject(pageFixture(), { width: 4, receiveShadow: true }), { position: [0, 0, 0] });
    await flushRenders();
    const withReceiver = sceneReceive.output.innerHTML;
    sceneReceive.destroy();

    const hostNoReceive = document.createElement("div");
    document.body.appendChild(hostNoReceive);
    const sceneNoReceive = createGlyphScene(hostNoReceive, sceneOptions);
    sceneNoReceive.add([{ vertices: box, color: "#cccccc" }], { castShadow: true });
    sceneNoReceive.addObject(glyphDiagramPlaneObject(pageFixture(), { width: 4, receiveShadow: false }), { position: [0, 0, 0] });
    await flushRenders();
    const withoutReceiver = sceneNoReceive.output.innerHTML;
    sceneNoReceive.destroy();

    expect(withReceiver).not.toBe(withoutReceiver);
  });

  // Mutation: comment out the sampler-key cleanup in
  // `createGlyphScene.ts`'s `teardownGlyphSceneObject` — see the charts
  // test's own equivalent for the manual run/revert this mirrors.
  it("remove() leaves no sampler key behind", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    const object = glyphDiagramPlaneObject(pageFixture(), { width: COLS, id: "removable-plane" });
    const handle = scene.addObject(object);
    await flushRenders();
    expect(renderedColors(scene)).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));

    handle.remove();
    await flushRenders();

    const leakProbeColor = "#123456";
    const staleKey = encodeGlyphSceneObjectSamplerKey("removable-plane", "diagram");
    // Same vertex/UV winding `glyphDiagramPlaneObject` itself uses (front
    // face +Z), so this probe is visible under the same untransformed
    // camera the removed object rendered under.
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
    expect(() => glyphDiagramPlaneObject(pageFixture(), { width: 0 })).toThrow(RangeError);
    expect(() => glyphDiagramPlaneObject(pageFixture(), { width: -1 })).toThrow(RangeError);
  });

  it("sizes the plane to the diagram's own cell aspect", () => {
    const object = glyphDiagramPlaneObject(pageFixture(), { width: 8 });
    const [minX, minY] = object.bounds.min;
    const [maxX, maxY] = object.bounds.max;
    expect(maxY - minY).toBeCloseTo(8);
    expect(maxX - minX).toBeCloseTo(4);
  });
});
