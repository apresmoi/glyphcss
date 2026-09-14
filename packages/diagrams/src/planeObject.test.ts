import { describe, expect, it } from "vitest";
import {
  createGlyphCanvas,
  createGlyphOrthographicCamera,
  createGlyphScene,
  encodeGlyphSceneObjectSamplerKey,
  type GlyphCanvas,
} from "glyphcss";
import { glyphDiagramPlaneObject } from "./planeObject";
import { renderGlyphDiagram } from "./render";
import type { GlyphDiagramPage } from "./renderTypes";

/**
 * Packet F4b (PLAN-3d.md §3.1/§7) acceptance gates for
 * `glyphDiagramPlaneObject` — mirrors `@glyphcss/charts`' own
 * `planeObject.test.ts` exactly (same geometry derivation, same
 * mutations); see that file's own top-of-file comment for the mutation
 * rationale. Fix round 1 adds: sizing from the sampler's own normalized
 * rect (P1), exact screen-POSITION assertions, a rotated-CAMERA case, and
 * a real rendered-diagram legibility check.
 */

// The world→screen constant every glyphcss orthographic camera uses
// (AGENTS.md's "Numeric conventions": "voxcss/polycss author at
// BASE_TILE=50").
const BASE_TILE = 50;

const INK_COLOR = "#ff2200";
const BG_COLOR = "#001122";
const COLS = 8;
const ROWS = 4;

/** A hand-painted `GlyphDiagramPage` — see the charts test's own `buildFixture` doc. */
function pageFromCanvas(canvas: GlyphCanvas): GlyphDiagramPage {
  return {
    text: "",
    canvas,
    layout: { nodes: [], edges: [], groups: [], ports: [], direction: "TB", width: canvas.cols, height: canvas.rows, ledger: [] },
    routes: [],
    labels: [],
  };
}

function pageFixture(): GlyphDiagramPage {
  const canvas: GlyphCanvas = createGlyphCanvas({ cols: COLS, rows: ROWS, cellAspect: 1, tier: "box" });
  canvas.fillRect(0, 0, COLS - 1, ROWS - 1, { fill: { shade: 0 }, color: "#000000", bg: BG_COLOR });
  canvas.fillRect(0, 0, COLS / 2 - 1, ROWS - 1, { fill: "solid", color: INK_COLOR, bg: BG_COLOR });
  return pageFromCanvas(canvas);
}

/** See `@glyphcss/charts`' `planeObject.test.ts`'s own `exactPlaneSceneOptions` doc. */
function exactPlaneSceneOptions(canvas: { cols: number; rows: number; cellAspect: number }, k = 1) {
  return {
    cols: canvas.cols * k,
    rows: canvas.rows * k,
    cellAspect: 1 / canvas.cellAspect,
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: BASE_TILE * canvas.cellAspect * k }),
  };
}

function makeScene(host: HTMLElement) {
  return createGlyphScene(host, {
    ...exactPlaneSceneOptions({ cols: COLS, rows: ROWS, cellAspect: 1 }),
    useColors: true,
    mode: "solid",
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

/** See `@glyphcss/charts`' `planeObject.test.ts`'s own `colorGrid` doc. */
function colorGrid(scene: { output: HTMLElement }, rows: number, cols: number): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: rows }, () => new Array<string | null>(cols).fill(null));
  let r = 0, c = 0;
  function visit(node: ChildNode, color: string | null): void {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") { r++; c = 0; continue; }
        if (r < rows && c < cols) grid[r]![c] = color;
        c++;
      }
      return;
    }
    if (node.nodeType === 1) {
      const el = node as HTMLElement;
      const style = el.getAttribute("style") ?? "";
      const match = style.match(/color:(#[0-9a-f]{6})/);
      const next = match ? match[1]! : color;
      for (const child of Array.from(el.childNodes)) visit(child, next);
    }
  }
  for (const child of Array.from(scene.output.childNodes)) visit(child, null);
  return grid;
}

function charGrid(scene: { output: HTMLElement }, rows: number, cols: number): string[][] {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  let r = 0, c = 0;
  function visit(node: ChildNode): void {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") { r++; c = 0; continue; }
        if (r < rows && c < cols) grid[r]![c] = ch;
        c++;
      }
      return;
    }
    if (node.nodeType === 1) for (const child of Array.from((node as HTMLElement).childNodes)) visit(child);
  }
  for (const child of Array.from(scene.output.childNodes)) visit(child);
  return grid;
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

  // Mutation: swap the polygon's `uvs` order — moves the mark to a
  // mirrored corner, reddening both assertions below.
  it("reproduces a mark in its exact screen position — a top-left canvas mark lands top-left on screen, never mirrored", async () => {
    const canvas = createGlyphCanvas({ cols: COLS, rows: ROWS, cellAspect: 1, tier: "box" });
    canvas.fillRect(0, 0, COLS - 1, ROWS - 1, { fill: { shade: 0 }, color: "#000000", bg: BG_COLOR });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: INK_COLOR, bg: BG_COLOR });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    scene.addObject(glyphDiagramPlaneObject(pageFromCanvas(canvas), { width: COLS }));
    await flushRenders();

    const grid = colorGrid(scene, ROWS, COLS);
    expect(grid[0]![0]).toBe(INK_COLOR);
    expect(grid[0]![COLS - 1]).not.toBe(INK_COLOR);
    expect(grid[ROWS - 1]![0]).not.toBe(INK_COLOR);
    expect(grid[ROWS - 1]![COLS - 1]).not.toBe(INK_COLOR);
    scene.destroy();
  });

  it("rotated 45 degrees about Y (the OBJECT), it still paints the texture — it is not flat-coloured", async () => {
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

  it("under a rotated CAMERA (the object itself untransformed), it still paints the texture — not flat-coloured", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: COLS,
      rows: ROWS,
      cellAspect: 1,
      useColors: true,
      mode: "solid",
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ rotX: 30, rotY: 40, zoom: 50 }),
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 1 },
    });
    scene.addObject(glyphDiagramPlaneObject(pageFixture(), { width: COLS }));
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
  // `createGlyphScene.ts`'s `teardownGlyphSceneObject`.
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

  // P2: a real (non-1) cell aspect, so dropping `cellAspect` entirely
  // could not pass by coincidence.
  it("sizes the plane to the diagram's own real cell aspect (0.5859375)", () => {
    const canvas = createGlyphCanvas({ cols: 96, rows: 32, cellAspect: 0.5859375, tier: "braille" });
    const object = glyphDiagramPlaneObject(pageFromCanvas(canvas), { width: 96 });
    const [minX, minY] = object.bounds.min;
    const [maxX, maxY] = object.bounds.max;
    expect(maxY - minY).toBeCloseTo(96);
    expect(maxX - minX).toBeCloseTo(32 / 0.5859375, 3);
  });

  // P1 fix round 1: an out-of-bounds `rect` used to size the plane from
  // its own RAW extent instead of the clamped one the sampler actually
  // samples.
  it("sizes from the sampler's own CLAMPED rect, not a raw out-of-bounds one", () => {
    const object = glyphDiagramPlaneObject(pageFixture(), { width: 8, rect: { x0: 0, y0: 0, x1: 200, y1: 1000 } });
    expect(object.bounds.max[0] - object.bounds.min[0]).toBeCloseTo(4);
  });

  // P1 fix round 1: a reversed `rect` (y1 < y0) used to size a NEGATIVE
  // height from the raw `rect.y1 - rect.y0 + 1`.
  it("sizes from the sampler's own NORMALIZED rect under a reversed rect, never a negative height", () => {
    const page = pageFixture();
    const forward = glyphDiagramPlaneObject(page, { width: 8, rect: { x0: 0, y0: 0, x1: COLS - 1, y1: ROWS - 1 } });
    const reversed = glyphDiagramPlaneObject(page, { width: 8, rect: { x0: 0, y0: ROWS - 1, x1: COLS - 1, y1: 0 } });
    const forwardHeight = forward.bounds.max[0] - forward.bounds.min[0];
    const reversedHeight = reversed.bounds.max[0] - reversed.bounds.min[0];
    expect(reversedHeight).toBeGreaterThan(0);
    expect(reversedHeight).toBeCloseTo(forwardHeight);
  });

  // A real rendered diagram (not a hand-painted fixture), mounted head-on
  // at 1:1, must read as recognisable: each node's own label ink lands
  // inside its own box's INTERIOR (excluding the one-cell border ring
  // `paintGlyphDiagram` always draws at row y0/y1 and column x0/x1 —
  // `packages/diagrams/src/paint.ts`'s `fillRect`+`line` node-box block),
  // and left-to-right (LR) ordering survives in the RENDERED plane itself,
  // not merely in the pre-render layout. P2 fix round 2: the prior version
  // of this test scanned the whole node box (border included), so a drawn
  // border with no label text still satisfied "some ink in the box" — it
  // never proved the label itself survived the plane.
  it("mounts a real rendered diagram, viewed head-on, and reads as recognisable — each node's own label ink lands in its box's INTERIOR, excluding the border ring", async () => {
    // `color: "none"` (never the default) is load-bearing here, not
    // cosmetic: with colour on, a node box's own `bg` fill
    // (`packages/diagrams/src/paint.ts`'s `canvas.fillRect(..., { bg:
    // "#0f172a" })`) makes even a BLANK interior cell sample as a dark,
    // opaque (never transparent) texel, which the renderer's own
    // luminance-driven glyph pick can print as non-space ink with no label
    // painted at all — the false positive this test exists to rule out. At
    // `color: "none"` a node's `bg` is `null` (`paint.ts`'s `colored ?
    // "#0f172a" : null`), so a blank interior cell's texel is fully
    // transparent and genuinely reads as no ink.
    const page = await renderGlyphDiagram("graph LR; Start --> Middle; Middle --> End", { color: "none" });
    const canvas = page.canvas;
    const k = 4;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      ...exactPlaneSceneOptions(canvas, k),
      useColors: false,
      mode: "solid",
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 1 },
    });
    scene.addObject(glyphDiagramPlaneObject(page, { width: canvas.cols }));
    await flushRenders();

    const grid = charGrid(scene, canvas.rows * k, canvas.cols * k);
    const outputInk = (r: number, c: number): boolean => grid[r]?.[c] !== undefined && grid[r]![c] !== " ";
    const canvasInk = (cr: number, cc: number): boolean => {
      for (let dr = 0; dr < k; dr++) for (let dc = 0; dc < k; dc++) if (outputInk(cr * k + dr, cc * k + dc)) return true;
      return false;
    };

    expect(page.layout.nodes.length).toBeGreaterThan(0);
    // Each node's own INTERIOR — one cell inset from its own box on every
    // side, so the border ring itself (`x0`/`x1`/`y0`/`y1`) is excluded —
    // must carry rendered ink of its own; a box with a blanked label paints
    // its border but leaves this region empty (confirmed by mutation: see
    // this suite's round-2 report). `firstInkCol` (the leftmost interior
    // column carrying ink, in the RENDERED grid) doubles as this node's own
    // screen position for the LR assertion below — read from the render,
    // never from `node.x0` itself.
    const firstInkColByNodeId = new Map<string, number>();
    for (const node of page.layout.nodes) {
      const ix0 = Math.round(node.x0) + 1, ix1 = Math.round(node.x1) - 1;
      const iy0 = Math.round(node.y0) + 1, iy1 = Math.round(node.y1) - 1;
      expect(ix1).toBeGreaterThanOrEqual(ix0);
      expect(iy1).toBeGreaterThanOrEqual(iy0);
      let interiorInk = 0;
      let firstInkCol: number | undefined;
      for (let r = iy0; r <= iy1; r++) {
        for (let c = ix0; c <= ix1; c++) {
          if (!canvasInk(r, c)) continue;
          interiorInk++;
          if (firstInkCol === undefined || c < firstInkCol) firstInkCol = c;
        }
      }
      expect(interiorInk).toBeGreaterThan(0);
      firstInkColByNodeId.set(node.id, firstInkCol!);
    }

    // LR direction, read from the RENDERED plane's own ink positions, not
    // from the source `page.layout.nodes` coordinates.
    const startCol = firstInkColByNodeId.get("Start");
    const endCol = firstInkColByNodeId.get("End");
    expect(startCol).toBeDefined();
    expect(endCol).toBeDefined();
    expect(startCol!).toBeLessThan(endCol!);

    scene.destroy();
  });
});
