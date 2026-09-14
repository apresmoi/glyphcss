import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene } from "./createGlyphScene";
import { defineGlyphEffect, GlyphEffectOutputChannel } from "./effects";
import type { GlyphSceneObject, GlyphSceneOverlay } from "./sceneObject";

/**
 * Packet F4 (PLAN-3d.md §11) acceptance gates for `GlyphSceneObject` /
 * `scene.addObject()` / the overlay registry / the shared label arbiter.
 * Each `it` names, in a comment, the mutation the PLAN requires it to
 * redden.
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

describe("createGlyphScene scene objects (GlyphSceneObject / addObject / overlay registry)", () => {
  // Mesh-option/transform forwarding through `addObject` is exercised with a
  // redenning mutation by the "casts and receives a shadow" test below
  // (dropping `buildObjectMeshTransform`'s spread turns that one red); this
  // test's own job is the registry's no-op path — a mounted object with no
  // overlay, or with an overlay that paints nothing, must never diverge from
  // "no object at all".
  it("with no object mounted, and with an object that has no overlay (or a no-op one), the render is byte-identical", async () => {
    const baselineHost = document.createElement("div");
    document.body.appendChild(baselineHost);
    const baseline = createGlyphScene(baselineHost, baseSceneOptions);
    baseline.add(quad(0, 0));
    await flushRenders();
    const baselineOutput = baseline.output.textContent!;
    baseline.destroy();
    expect(baselineOutput.trim().length).toBeGreaterThan(0);

    const meshOnlyHost = document.createElement("div");
    document.body.appendChild(meshOnlyHost);
    const meshOnlyScene = createGlyphScene(meshOnlyHost, baseSceneOptions);
    const object: GlyphSceneObject = {
      id: "obj-1",
      meshes: [{ name: "mesh", polygons: quad(0, 0) }],
      bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
    };
    meshOnlyScene.addObject(object);
    await flushRenders();
    expect(meshOnlyScene.output.textContent).toBe(baselineOutput);
    meshOnlyScene.destroy();

    const noOpOverlayHost = document.createElement("div");
    document.body.appendChild(noOpOverlayHost);
    const noOpOverlayScene = createGlyphScene(noOpOverlayHost, baseSceneOptions);
    noOpOverlayScene.addObject({
      ...object,
      overlays: [{ id: "noop", stamp(): void {} }],
    });
    await flushRenders();
    expect(noOpOverlayScene.output.textContent).toBe(baselineOutput);
    noOpOverlayScene.destroy();
  });

  it("two objects share ONE label arbiter — a higher-priority label from a different object suppresses an overlapping lower-priority one (mutation: give each object its own arbiter)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, baseSceneOptions);

    const overlayLow: GlyphSceneOverlay = {
      id: "low",
      stamp(_grid, frame): void {
        frame.labels.place({ id: "low", priority: 1, col: 10, row: 5, text: "LOW" });
      },
    };
    const overlayHigh: GlyphSceneOverlay = {
      id: "high",
      stamp(_grid, frame): void {
        frame.labels.place({ id: "high", priority: 2, col: 10, row: 5, text: "HIGH" });
      },
    };
    // Mounted HIGH-priority-first, LOW-priority-second: a shared arbiter
    // resolves by priority regardless of registration order, so this order
    // is irrelevant to the correct outcome — but it is exactly what exposes
    // a PER-OBJECT arbiter, whose only ordering signal left is "last one
    // painted wins" (registration order), which would flip the winner here.
    scene.addObject({ id: "obj-high", meshes: [], overlays: [overlayHigh], bounds: { min: [0, 0, 0], max: [0, 0, 0] } });
    scene.addObject({ id: "obj-low", meshes: [], overlays: [overlayLow], bounds: { min: [0, 0, 0], max: [0, 0, 0] } });
    await flushRenders();

    const text = scene.output.textContent!;
    expect(text).toContain("HIGH");
    expect(text).not.toContain("LOW");
    scene.destroy();
  });

  it("a label hides behind a foreign mesh but not behind its own object's mesh (mutation: drop the winnerMesh check)", async () => {
    // Probe first: two fully-overlapping quads, one biased toward the camera,
    // determine which ACTUALLY wins the shared cell in this render pipeline
    // — sidesteps needing to know the camera's own depth-sign convention.
    const probeOptions = { ...baseSceneOptions, cols: 3, rows: 1, useColors: true };
    const probeHost = document.createElement("div");
    document.body.appendChild(probeHost);
    const probe = createGlyphScene(probeHost, probeOptions);
    probe.add(quad(0, 0, 50, "#336699"), { depthBias: 0.5 });
    probe.add(quad(0, 0, 50, "#996633") /* no bias */);
    await flushRenders();
    const probeHtml = probe.output.innerHTML;
    probe.destroy();
    const biasedWins = probeHtml.includes("#336699");
    const otherWins = probeHtml.includes("#996633");
    // Sanity: exactly one of the two colors painted (a fully-overlapping,
    // same-size pair with a depth bias must have a single, deterministic
    // winner across the whole covered cell).
    expect(biasedWins).not.toBe(otherWins);

    const winnerOptions = { ...baseSceneOptions, cols: 3, rows: 1 };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, winnerOptions);

    const winnerOverlay: GlyphSceneOverlay = {
      id: "winner-label",
      stamp(_grid, frame): void {
        frame.labels.place({ id: "winner", priority: 1, col: 1, row: 0, text: "W", ownMeshIds: frame.ownMeshIds });
      },
    };
    const loserOverlay: GlyphSceneOverlay = {
      id: "loser-label",
      stamp(_grid, frame): void {
        // Higher priority than the winner's, so a dropped occlusion check
        // would let this one win the label-overlap arbitration too.
        frame.labels.place({ id: "loser", priority: 2, col: 1, row: 0, text: "L", ownMeshIds: frame.ownMeshIds });
      },
    };
    const winnerObject: GlyphSceneObject = {
      id: "winner-object",
      meshes: [{ name: "m", polygons: quad(0, 0, 50), options: biasedWins ? { depthBias: 0.5 } : {} }],
      overlays: [winnerOverlay],
      bounds: { min: [-50, -50, 0], max: [50, 50, 0] },
    };
    const loserObject: GlyphSceneObject = {
      id: "loser-object",
      meshes: [{ name: "m", polygons: quad(0, 0, 50), options: biasedWins ? {} : { depthBias: 0.5 } }],
      overlays: [loserOverlay],
      bounds: { min: [-50, -50, 0], max: [50, 50, 0] },
    };
    scene.addObject(winnerObject);
    scene.addObject(loserObject);
    await flushRenders();

    const text = scene.output.textContent!;
    expect(text).toContain("W");
    expect(text).not.toContain("L");
    scene.destroy();
  });

  it("overlays run AFTER effects — a full-viewport effect never overwrites an overlay's label (mutation: swap the composition order)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, baseSceneOptions);

    // A glitch-shaped stock effect stand-in: scrambles every cell to "#".
    const scrambleEffect = defineGlyphEffect({
      evaluate({ output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          output.glyph[i] = "#";
          output.coverage[i] = 1;
          output.channels[i] = GlyphEffectOutputChannel.Glyph;
        }
      },
    });
    scene.addEffectLayer({ effect: scrambleEffect, params: {}, target: "viewport" });

    scene.addObject({
      id: "labelled",
      meshes: [],
      overlays: [{
        id: "label",
        stamp(_grid, frame): void {
          frame.labels.place({ id: "l", priority: 1, col: 5, row: 5, text: "OK" });
        },
      }],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    });
    await flushRenders();

    const text = scene.output.textContent!;
    expect(text).toContain("OK");
    scene.destroy();
  });

  it("an object's mesh casts and receives a shadow through addObject (the same code path scene.add() takes)", async () => {
    const shadowOptions = {
      cols: 40,
      rows: 20,
      useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 60, rotX: 55, rotY: 30 }),
      directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 1 },
      ambientLight: { intensity: 0.3 },
      doubleSided: true,
      shadow: { opacity: 0.6 },
    } as const;

    function groundPolygons(): Polygon[] {
      return [
        { vertices: [[-5, -5, 0], [5, -5, 0], [5, 5, 0]], color: "#888888" },
        { vertices: [[-5, -5, 0], [5, 5, 0], [-5, 5, 0]], color: "#888888" },
      ];
    }
    function boxPolygons(z: number): Polygon[] {
      return quad(0, 0, 0.6, "#cccccc").map((p) => ({
        ...p,
        vertices: p.vertices.map(([x, y]) => [x, y, z] as [number, number, number]),
      }));
    }

    async function renderCastFlag(cast: boolean): Promise<string> {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const scene = createGlyphScene(host, shadowOptions);
      scene.addObject({
        id: "ground",
        meshes: [{ name: "ground", polygons: groundPolygons(), options: { receiveShadow: true } }],
        bounds: { min: [-5, -5, 0], max: [5, 5, 0] },
      });
      scene.addObject({
        id: "box",
        meshes: [{ name: "box", polygons: boxPolygons(1.5), options: { castShadow: cast } }],
        bounds: { min: [-0.6, -0.6, 0.9], max: [0.6, 0.6, 2.1] },
      });
      await flushRenders();
      const text = scene.output.textContent!;
      scene.destroy();
      return text;
    }

    const withShadow = await renderCastFlag(true);
    const withoutShadow = await renderCastFlag(false);
    expect(withShadow).not.toBe(withoutShadow);
  });
});
