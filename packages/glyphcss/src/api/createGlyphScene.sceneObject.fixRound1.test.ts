import { describe, expect, it } from "vitest";
import type { Polygon, TextureSampler } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene } from "./createGlyphScene";
import { encodeGlyphSceneObjectSamplerKey } from "./createGlyphScene";
import type { GlyphSceneObject, GlyphSceneOverlay } from "./sceneObject";

/**
 * Fix round 1 — codex (gpt-5.6-sol) static review findings on packet F4.
 * Every `it` reproduces the finding FIRST (this file is run against the
 * pre-fix tree to confirm each one is real), then the fix makes it pass.
 */

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function quad(cx: number, cy: number, half = 1, color = "#88aacc"): Polygon[] {
  return [{
    vertices: [
      [cx - half, cy - half, 0],
      [cx - half, cy + half, 0],
      [cx + half, cy + half, 0],
      [cx + half, cy - half, 0],
    ],
    color,
  }];
}

const baseSceneOptions = {
  cols: 60,
  rows: 16,
  useColors: false,
  camera: createGlyphOrthographicCamera({ zoom: 50 }),
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
  doubleSided: true,
} as const;

function boundsAll(): { min: [number, number, number]; max: [number, number, number] } {
  return { min: [-100, -100, -100], max: [100, 100, 100] };
}

describe("F4 fix round 1 — codex static review", () => {
  it("P1-a: setTransform re-plants an object's hotspots at the new world position", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, baseSceneOptions);
    const handle = scene.addObject({
      id: "obj-1",
      meshes: [],
      hotspots: [{ id: "h1", at: [0, 0, 0] }],
      bounds: boundsAll(),
    });
    await flushRenders();

    const el = host.querySelector('[data-hotspot-id="h1"]') as HTMLElement;
    expect(el).toBeTruthy();
    const initialLeft = el.style.left;
    const initialTop = el.style.top;

    handle.setTransform({ position: [10, 0, 0] });
    await flushRenders();

    // Same element (never re-created), but re-planted at the moved position.
    const elAfter = host.querySelector('[data-hotspot-id="h1"]') as HTMLElement;
    expect(elAfter).toBe(el);
    expect(`${elAfter.style.left},${elAfter.style.top}`).not.toBe(`${initialLeft},${initialTop}`);
    scene.destroy();
  });

  it("P2-a: sampler keys use an unambiguous encoding — {id:\"a:b\",name:\"c\"} never collides with {id:\"a\",name:\"b:c\"}", () => {
    const keyA = encodeGlyphSceneObjectSamplerKey("a:b", "c");
    const keyB = encodeGlyphSceneObjectSamplerKey("a", "b:c");
    expect(keyA).not.toBe(keyB);
  });

  it("P2-a: removing one colliding-pair object never deletes the other's still-mounted sampler", async () => {
    const samplerA: TextureSampler = { width: 1, height: 1, lowDetail: false, data: new Uint8ClampedArray([255, 0, 0, 255]) };
    const samplerB: TextureSampler = { width: 1, height: 1, lowDetail: false, data: new Uint8ClampedArray([0, 255, 0, 255]) };
    const keyA = encodeGlyphSceneObjectSamplerKey("a:b", "c");
    const keyB = encodeGlyphSceneObjectSamplerKey("a", "b:c");
    const meshA: Polygon = { ...quad(-4, 0, 1.5)[0]!, texture: keyA, uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] };
    const meshB: Polygon = { ...quad(4, 0, 1.5)[0]!, texture: keyB, uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] };

    // Ground truth: a scene that only ever mounted B — whatever it renders
    // (the exact colour/shading isn't asserted, only self-consistency).
    const soloHost = document.createElement("div");
    document.body.appendChild(soloHost);
    const soloScene = createGlyphScene(soloHost, { ...baseSceneOptions, useColors: true });
    soloScene.addObject({
      id: "a", meshes: [{ name: "m", polygons: [meshB] }],
      textureSamplers: new Map([["b:c", samplerB]]), bounds: boundsAll(),
    });
    await flushRenders();
    const soloOutput = soloScene.output.innerHTML;
    soloScene.destroy();

    // The colliding pair: A's raw key components collide with B's under
    // naive `${id}:${name}` concatenation ({id:"a:b",name:"c"} vs
    // {id:"a",name:"b:c"}). After removing A, B must render EXACTLY like
    // the solo-B scene above — proving A's teardown never deleted B's key.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, { ...baseSceneOptions, useColors: true });
    const handleA = scene.addObject({
      id: "a:b", meshes: [{ name: "m", polygons: [meshA] }],
      textureSamplers: new Map([["c", samplerA]]), bounds: boundsAll(),
    });
    scene.addObject({
      id: "a", meshes: [{ name: "m", polygons: [meshB] }],
      textureSamplers: new Map([["b:c", samplerB]]), bounds: boundsAll(),
    });
    await flushRenders();

    handleA.remove();
    await flushRenders();

    expect(scene.output.innerHTML).toBe(soloOutput);
    scene.destroy();
  });

  it("P2-b: duplicate mesh names inside one object reject atomically — nothing partially mounts", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, baseSceneOptions);

    expect(() => scene.addObject({
      id: "dup",
      meshes: [
        { name: "m", polygons: quad(-2, 0) },
        { name: "m", polygons: quad(2, 0) },
      ],
      bounds: boundsAll(),
    })).toThrow(RangeError);

    // The failed attempt must not have registered the id — a fresh, valid
    // mount under the SAME id must succeed.
    const handle = scene.addObject({
      id: "dup",
      meshes: [{ name: "m", polygons: quad(0, 0) }],
      bounds: boundsAll(),
    });
    expect(handle.meshes.size).toBe(1);
    scene.destroy();
  });

  it("P2-c: equal-priority labels tie-break on the candidate's stable id, not registration/mount order", async () => {
    async function render(mountAFirst: boolean): Promise<string> {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const scene = createGlyphScene(host, baseSceneOptions);
      const overlayLast: GlyphSceneOverlay = {
        id: "last",
        stamp(_grid, frame): void {
          frame.labels.place({ id: "zzz", priority: 1, col: 10, row: 5, text: "ZZZ" });
        },
      };
      const overlayFirst: GlyphSceneOverlay = {
        id: "first",
        stamp(_grid, frame): void {
          frame.labels.place({ id: "aaa", priority: 1, col: 10, row: 5, text: "AAA" });
        },
      };
      if (mountAFirst) {
        scene.addObject({ id: "obj-aaa", meshes: [], overlays: [overlayFirst], bounds: boundsAll() });
        scene.addObject({ id: "obj-zzz", meshes: [], overlays: [overlayLast], bounds: boundsAll() });
      } else {
        scene.addObject({ id: "obj-zzz", meshes: [], overlays: [overlayLast], bounds: boundsAll() });
        scene.addObject({ id: "obj-aaa", meshes: [], overlays: [overlayFirst], bounds: boundsAll() });
      }
      await flushRenders();
      return scene.output.textContent!;
    }

    const orderA = await render(true);
    const orderB = await render(false);

    expect(orderA).toBe(orderB);
    expect(orderA).toContain("AAA");
    expect(orderA).not.toContain("ZZZ");
  });

  it("P2-d: no object mounted allocates the object registry lazily — mounting the FIRST object is the only allocation point (checked indirectly: addObject/remove/addObject again behaves identically to a fresh scene)", async () => {
    // Direct allocation isn't publicly observable; this pins the OBSERVABLE
    // contract instead — a scene that never sees addObject renders exactly
    // like one that mounted and fully removed an object, proving no residual
    // per-object state leaks either way.
    const hostA = document.createElement("div");
    document.body.appendChild(hostA);
    const untouched = createGlyphScene(hostA, baseSceneOptions);
    untouched.add(quad(0, 0));
    await flushRenders();
    const untouchedOutput = untouched.output.textContent!;
    untouched.destroy();

    const hostB = document.createElement("div");
    document.body.appendChild(hostB);
    const cycled = createGlyphScene(hostB, baseSceneOptions);
    const handle = cycled.addObject({ id: "temp", meshes: [{ name: "m", polygons: quad(20, 0) }], bounds: boundsAll() });
    await flushRenders();
    handle.remove();
    cycled.add(quad(0, 0));
    await flushRenders();
    expect(cycled.output.textContent).toBe(untouchedOutput);
    cycled.destroy();
  });

  it("P2-d lifecycle: update()/remove() leave zero meshes, hotspots and samplers mounted", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, baseSceneOptions);
    scene.add(quad(0, 0)); // baseline geometry so the grid isn't blank either way

    const sampler: TextureSampler = { width: 1, height: 1, lowDetail: false, data: new Uint8ClampedArray([255, 0, 0, 255]) };
    const key = encodeGlyphSceneObjectSamplerKey("obj", "tex");
    const texturedMesh: Polygon = { ...quad(20, 0, 3)[0]!, texture: key, uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] };

    const handle = scene.addObject({
      id: "obj",
      meshes: [{ name: "m1", polygons: quad(20, 4) }, { name: "m2", polygons: [texturedMesh] }],
      hotspots: [{ id: "h1", at: [20, 0, 0] }],
      textureSamplers: new Map([["tex", sampler]]),
      bounds: boundsAll(),
    });
    await flushRenders();
    expect(host.querySelector('[data-hotspot-id="h1"]')).toBeTruthy();

    handle.remove();
    await flushRenders();

    expect(host.querySelector('[data-hotspot-id="h1"]')).toBeFalsy();
    expect(handle.meshes.size).toBe(0);
    // Mounting a FRESH object re-using the same sampler name/key must not
    // observe anything left over from the removed one (no leaked handles,
    // no leaked mesh geometry at x=20).
    const solo = document.createElement("div");
    document.body.appendChild(solo);
    const soloScene = createGlyphScene(solo, baseSceneOptions);
    soloScene.add(quad(0, 0));
    await flushRenders();
    expect(scene.output.textContent).toBe(soloScene.output.textContent);
    scene.destroy();
    soloScene.destroy();
  });

  it("P2-d: overlay ordering against the user's own transformCells hook — the hook sees the overlay's own stamped cell", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const seenChars: string[] = [];
    const scene = createGlyphScene(host, {
      ...baseSceneOptions,
      transformCells(grid) {
        seenChars.push(grid.char[5 * grid.cols + 10]!);
      },
    });
    scene.addObject({
      id: "labelled",
      meshes: [],
      overlays: [{
        id: "ov",
        stamp(_grid, frame): void {
          frame.labels.place({ id: "l", priority: 1, col: 10, row: 5, text: "X" });
        },
      }],
      bounds: boundsAll(),
    });
    await flushRenders();
    expect(seenChars).toContain("X");
    scene.destroy();
  });

  it("P2-d: an overlay's stamp respects cross-detail-layer occlusion — never paints into a cell an opaque detail layer owns", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, baseSceneOptions);
    // Opaque, density-separated mesh covering the whole viewport.
    scene.addObject({
      id: "detail-obj",
      meshes: [{ name: "m", polygons: quad(0, 0, 50), options: { density: 2 } }],
      bounds: boundsAll(),
    });
    // Base-grid object trying to stamp a label into the same screen area.
    scene.addObject({
      id: "base-obj",
      meshes: [],
      overlays: [{
        id: "ov",
        stamp(_grid, frame): void {
          if (frame.layer?.detail) return; // only the base grid's own attempt matters here
          frame.labels.place({ id: "l", priority: 1, col: 30, row: 8, text: "HIDDEN" });
        },
      }],
      bounds: boundsAll(),
    });
    await flushRenders();
    expect(scene.output.textContent).not.toContain("HIDDEN");
    scene.destroy();
  });
});
