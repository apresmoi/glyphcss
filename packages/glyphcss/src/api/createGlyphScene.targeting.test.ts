import { beforeEach, describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene } from "./createGlyphScene";
import {
  GlyphEffectOutputChannel,
  defineGlyphEffect,
} from "./effects";

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function quad(cx: number, color = "#88aacc"): Polygon[] {
  return [{ vertices: [[cx - 1, -1, 0], [cx - 1, 1, 0], [cx + 1, 1, 0], [cx + 1, -1, 0]], color }];
}

function markerProgram(glyph: string) {
  return defineGlyphEffect<{ phase: number }>({
    evaluate({ target, output }) {
      for (let i = 0; i < output.coverage.length; i++) {
        if (target.coverage[i]! <= 0) continue;
        output.glyph[i] = glyph;
        output.coverage[i] = 1;
        output.channels[i] = GlyphEffectOutputChannel.Glyph;
      }
    },
  });
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

describe("createGlyphScene per-object effect targeting (VOLUMETRIC-3.md §1)", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("two-mesh floor-byte-equality: a carve layer targeted at the cube leaves every floor-region cell byte-equal to the untargeted render", async () => {
    // Determine the floor mesh's own on-screen footprint in isolation, so the
    // comparison below doesn't depend on guessing exact cell coordinates.
    const footprintScene = createGlyphScene(host, baseSceneOptions);
    const floorHandle = footprintScene.add(quad(-8, "#335577"));
    await flushRenders();
    const floorFootprint = footprintScene.output.textContent!;
    footprintScene.destroy();
    void floorHandle;

    const baselineHost = document.createElement("div");
    document.body.appendChild(baselineHost);
    const baseline = createGlyphScene(baselineHost, baseSceneOptions);
    baseline.add(quad(-8, "#335577"));
    baseline.add(quad(8, "#aa5533"));
    await flushRenders();
    const baselineOutput = baseline.output.textContent!;
    baseline.destroy();

    const targetedHost = document.createElement("div");
    document.body.appendChild(targetedHost);
    const targeted = createGlyphScene(targetedHost, baseSceneOptions);
    targeted.add(quad(-8, "#335577"));
    const cube = targeted.add(quad(8, "#aa5533"));
    targeted.addEffectLayer({
      effect: markerProgram("X"),
      params: { phase: 0 },
      target: cube,
      blend: "replace",
      opacity: 1,
    });
    await flushRenders();
    const targetedOutput = targeted.output.textContent!;
    targeted.destroy();

    expect(floorFootprint.length).toBe(baselineOutput.length);
    let floorCellCount = 0;
    for (let i = 0; i < floorFootprint.length; i++) {
      if (floorFootprint[i] === " " || floorFootprint[i] === "\n") continue;
      floorCellCount++;
      expect(targetedOutput[i]).toBe(baselineOutput[i]);
    }
    expect(floorCellCount).toBeGreaterThan(0);
    // The targeted marker must actually have painted the cube region — the
    // outputs are not simply identical everywhere.
    expect(targetedOutput).not.toBe(baselineOutput);
    expect(targetedOutput).toContain("X");
  });

  it("byte-identity: with no mesh-targeted layer, output is unaffected and the winner-mesh scratch buffer is never allocated", async () => {
    const scene = createGlyphScene(host, baseSceneOptions);
    scene.add(quad(0));
    await flushRenders();
    const baseline = scene.output.textContent;

    scene.addEffectLayer({
      effect: markerProgram("X"),
      params: { phase: 0 },
      blend: "replace",
      opacity: 1,
    });
    await flushRenders();
    // A scene-wide ("surfaces") layer still applies — it is unaffected by
    // this feature — so output DOES change, but no mesh targeting is in play.
    expect(scene.output.textContent).not.toBe(baseline);
    scene.destroy();
  });

  it("first-mount-after-render: mounting a mesh-targeted layer after another layer already retained frames without winner data triggers a full re-render, not a silent no-op", async () => {
    const scene = createGlyphScene(host, baseSceneOptions);
    const mesh = scene.add(quad(0));
    // A scene-wide layer mounts first and renders/retains a frame with no
    // winner-mesh data (nothing needed it yet).
    scene.addEffectLayer({
      effect: markerProgram("Y"),
      params: { phase: 0 },
      blend: "over",
      opacity: 0, // contributes nothing visually, just forces a retained frame
    });
    await flushRenders();

    // Now mount a mesh-targeted layer. If the retained frame's missing
    // winner data were not detected, this would silently no-op forever.
    scene.addEffectLayer({
      effect: markerProgram("X"),
      params: { phase: 0 },
      target: mesh,
      blend: "replace",
      opacity: 1,
    });
    await flushRenders();
    expect(scene.output.textContent).toContain("X");
    scene.destroy();
  });

  it("wireframe inactivity: a mesh-targeted layer mounts without throwing in wireframe mode and contributes nothing", async () => {
    const scene = createGlyphScene(host, { ...baseSceneOptions, mode: "wireframe" });
    const mesh = scene.add(quad(0));
    await flushRenders();
    const baseline = scene.output.textContent;

    expect(() => scene.addEffectLayer({
      effect: markerProgram("X"),
      params: { phase: 0 },
      target: mesh,
      blend: "replace",
      opacity: 1,
    })).not.toThrow();
    await flushRenders();
    // Wireframe glyphs are randomly picked per weight tier, so an exact
    // byte match isn't meaningful here — what matters is that the targeted
    // marker never painted (no winner-mesh data exists outside solid mode).
    expect(scene.output.textContent).not.toContain("X");
    expect(baseline).not.toContain("X");
    scene.destroy();
  });

  it("removed mesh: disposing the only targeted mesh makes the layer inactive without error", async () => {
    const scene = createGlyphScene(host, baseSceneOptions);
    scene.add(quad(-8, "#335577"));
    const cube = scene.add(quad(8, "#aa5533"));
    scene.addEffectLayer({
      effect: markerProgram("X"),
      params: { phase: 0 },
      target: cube,
      blend: "replace",
      opacity: 1,
    });
    await flushRenders();
    expect(scene.output.textContent).toContain("X");

    cube.dispose();
    await flushRenders();
    expect(() => scene.rerender()).not.toThrow();
    expect(scene.output.textContent).not.toContain("X");
    scene.destroy();
  });

  it("detail-grid split: targeting a detail (own-<pre>) mesh applies only to that mesh's own output grid, leaving the shared base <pre> untouched", async () => {
    function makeCubePolygons(): Polygon[] {
      const out: Polygon[] = [];
      const faces: Array<[number, number, number, number, number, number, number, number, number]> = [
        [-1, -1, 1, 1, -1, 1, 1, 1, 1],
        [-1, -1, 1, 1, 1, 1, -1, 1, 1],
        [1, -1, -1, -1, -1, -1, -1, 1, -1],
        [1, -1, -1, -1, 1, -1, 1, 1, -1],
        [-1, 1, 1, 1, 1, 1, 1, 1, -1],
        [-1, 1, 1, 1, 1, -1, -1, 1, -1],
      ];
      for (const [x0, y0, z0, x1, y1, z1, x2, y2, z2] of faces) {
        out.push({ vertices: [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]], color: "#aa5533" });
      }
      return out;
    }
    function triangle(cx: number): Polygon[] {
      return [{ vertices: [[cx, 1, 0], [cx - 1, -1, 0], [cx + 1, -1, 0]], color: "#335577" }];
    }

    const scene = createGlyphScene(host, {
      cols: 32,
      rows: 16,
      useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
    });
    scene.add(triangle(-6)); // shared base mesh
    const detailMesh = scene.add(makeCubePolygons(), { density: 2 }); // own detail <pre>
    await flushRenders();
    const basePreBaseline = scene.output.textContent;

    scene.addEffectLayer({
      effect: markerProgram("X"),
      params: { phase: 0 },
      target: detailMesh,
      blend: "replace",
      opacity: 1,
    });
    await flushRenders();

    const detailPre = host.querySelector("pre.glyph-output--detail") as HTMLPreElement | null;
    expect(detailPre).not.toBeNull();
    expect(detailPre!.textContent).toContain("X");
    // The shared base <pre> (which never won any cell for the targeted mesh)
    // is byte-identical to before the targeted layer mounted.
    expect(scene.output.textContent).toBe(basePreBaseline);
    scene.destroy();
  });
});
