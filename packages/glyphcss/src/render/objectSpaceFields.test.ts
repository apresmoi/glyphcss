import type { Polygon } from "@glyphcss/core";
import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { createGlyphScene } from "../api/createGlyphScene";
import { defineGlyphEffect } from "../api/effects";

const quad: Polygon = {
  vertices: [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]],
  color: "#ffffff",
};

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Box-corner mesh, authored in the MESH'S OWN (object-space) frame: a cap
// (facing +Z) and a wall (facing +Y) sharing the edge y=1, z=1. Used to prove
// object-space positions stay CONTINUOUS across a polygon boundary that has
// two different face orientations — exactly the case where a per-face UV
// atlas would seam (each face gets its own 2D parameterization) but a single
// 3D field filling the object's volume does not.
const cap: Polygon = {
  vertices: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
  color: "#ffffff",
};
const wall: Polygon = {
  vertices: [[-1, 1, 0], [1, 1, 0], [1, 1, 1], [-1, 1, 1]],
  color: "#ffffff",
};

describe("space: \"object\" — objectPosition retained cell field", () => {
  it("is undefined unless an effect's requirement asks for it (pays nothing otherwise)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let sawObjectPosition: boolean | undefined;
    const scene = createGlyphScene(host, {
      cols: 24,
      rows: 16,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
    });
    scene.add([quad]);
    // This effect only asks for worldPosition/normal — never objectPosition.
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        optionalRequirements: ["worldPosition", "normal"],
        evaluate({ base }) {
          sawObjectPosition = base.objectPosition !== undefined;
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();
    expect(sawObjectPosition).toBe(false);
    scene.destroy();
    host.remove();
  });

  it("is defined (with NaN empty cells) once an effect requests it", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let captured: { defined?: boolean; centerFinite?: boolean; emptyIsNaN?: boolean } = {};
    const scene = createGlyphScene(host, {
      cols: 24,
      rows: 16,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
    });
    scene.add([quad]);
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        optionalRequirements: ["objectPosition"],
        evaluate({ base }) {
          const op = base.objectPosition;
          const covered = Array.from(base.coverage).findIndex((v) => v > 0);
          const empty = Array.from(base.coverage).findIndex((v) => v <= 0);
          captured = {
            defined: op !== undefined,
            centerFinite: op !== undefined && covered >= 0 && Number.isFinite(op[covered * 3]!),
            emptyIsNaN: op !== undefined && empty >= 0 && Number.isNaN(op[empty * 3]!),
          };
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();
    expect(captured.defined).toBe(true);
    expect(captured.centerFinite).toBe(true);
    expect(captured.emptyIsNaN).toBe(true);
    scene.destroy();
    host.remove();
  });

  it("samples the SAME object-space value at the same mesh-local point across different mesh rotations", async () => {
    // The target object-space point: not the origin (rotation-invariant by
    // construction), so this only passes if `objectVertices` recovery — not
    // just "reuse the center" — is actually working.
    const target: [number, number, number] = [0.5, 0.5, 0];

    async function sampleAtRotation(rotY: number): Promise<{ object: [number, number, number]; world: [number, number, number] }> {
      const host = document.createElement("div");
      document.body.appendChild(host);
      let best: { dist: number; object: [number, number, number]; world: [number, number, number] } = {
        dist: Infinity,
        object: [NaN, NaN, NaN],
        world: [NaN, NaN, NaN],
      };
      const scene = createGlyphScene(host, {
        cols: 60,
        rows: 60,
        useColors: false,
        doubleSided: true,
        camera: createGlyphOrthographicCamera({ zoom: 300, rotX: 25 }),
      });
      scene.add([quad], { rotation: [0, rotY, 0] });
      scene.addEffectLayer({
        effect: defineGlyphEffect<{ phase: number }>({
          optionalRequirements: ["objectPosition", "worldPosition"],
          evaluate({ base }) {
            const op = base.objectPosition!;
            const wp = base.worldPosition!;
            for (let i = 0; i < base.length; i++) {
              const ox = op[i * 3]!, oy = op[i * 3 + 1]!, oz = op[i * 3 + 2]!;
              if (!Number.isFinite(ox)) continue;
              const dist = Math.hypot(ox - target[0], oy - target[1], oz - target[2]);
              if (dist < best.dist) {
                best = {
                  dist,
                  object: [ox, oy, oz],
                  world: [wp[i * 3]!, wp[i * 3 + 1]!, wp[i * 3 + 2]!],
                };
              }
            }
          },
        }),
        params: { phase: 0 },
      });
      await flushRenders();
      scene.destroy();
      host.remove();
      return { object: best.object, world: best.world };
    }

    const atZero = await sampleAtRotation(0);
    const atRotated = await sampleAtRotation(47);

    // Both renders recover an object-space cell close to the SAME target
    // point, regardless of the mesh's rotation.
    expect(Math.hypot(...atZero.object.map((v, i) => v - target[i]!) as [number, number, number])).toBeLessThan(0.1);
    expect(Math.hypot(...atRotated.object.map((v, i) => v - target[i]!) as [number, number, number])).toBeLessThan(0.1);

    // Their WORLD positions, in contrast, are different — the mesh actually
    // rotated. This proves objectPosition is decoupled from the rotation
    // that worldPosition is NOT.
    const worldDelta = Math.hypot(
      atZero.world[0] - atRotated.world[0],
      atZero.world[1] - atRotated.world[1],
      atZero.world[2] - atRotated.world[2],
    );
    expect(worldDelta).toBeGreaterThan(0.3);
  });

  it("agrees across a cap/wall polygon boundary (no seam), unlike per-face UV parameterization", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let boundaryDeltas: number[] = [];
    let farApartDelta = 0;
    const scene = createGlyphScene(host, {
      cols: 80,
      rows: 80,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 30, rotY: 40 }),
    });
    // A non-trivial rotation: world vertices differ from the authored
    // (object-space) cap/wall vertices above, exercising the actual
    // objectVertices recovery path, not a coincidental identity.
    scene.add([cap, wall], { rotation: [12, 24, 6] });
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        optionalRequirements: ["objectPosition", "normal"],
        evaluate({ base }) {
          const op = base.objectPosition!;
          const nrm = base.normal!;
          const cols = base.cols, rows = base.rows;
          // Classify each covered cell as "cap" (|nz| dominant) or "wall"
          // (|ny| dominant) from its geometric face normal, then walk every
          // row looking for an adjacent column pair whose classification
          // flips — the visible cap/wall silhouette boundary.
          const kindOf = (i: number): "cap" | "wall" | null => {
            if (!Number.isFinite(op[i * 3]!)) return null;
            const ny = Math.abs(nrm[i * 3 + 1]!), nz = Math.abs(nrm[i * 3 + 2]!);
            if (nz > ny + 0.3) return "cap";
            if (ny > nz + 0.3) return "wall";
            return null;
          };
          const deltas: number[] = [];
          for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols - 1; col++) {
              const i = row * cols + col;
              const j = i + 1;
              const ki = kindOf(i), kj = kindOf(j);
              if (ki && kj && ki !== kj) {
                const dx = op[i * 3]! - op[j * 3]!;
                const dy = op[i * 3 + 1]! - op[j * 3 + 1]!;
                const dz = op[i * 3 + 2]! - op[j * 3 + 2]!;
                deltas.push(Math.hypot(dx, dy, dz));
              }
            }
          }
          boundaryDeltas = deltas;
          // Contrast: two cells far apart on cap vs. wall (not adjacent).
          const capI = Array.from({ length: base.length }, (_, i) => i).find((i) => kindOf(i) === "cap" && op[i * 3]! < -0.5);
          const wallI = Array.from({ length: base.length }, (_, i) => i).find((i) => kindOf(i) === "wall" && op[i * 3]! < -0.5);
          if (capI !== undefined && wallI !== undefined) {
            farApartDelta = Math.hypot(
              op[capI * 3]! - op[wallI * 3]!,
              op[capI * 3 + 1]! - op[wallI * 3 + 1]!,
              op[capI * 3 + 2]! - op[wallI * 3 + 2]!,
            );
          }
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();
    scene.destroy();
    host.remove();

    expect(boundaryDeltas.length).toBeGreaterThan(0);
    // Object-space position across the boundary is close — a couple of cell
    // widths at most (~2/80 world units per cell here), never a seam jump.
    for (const delta of boundaryDeltas) expect(delta).toBeLessThan(0.25);
    // Far-apart cap/wall cells are NOT this close — the boundary agreement
    // above is a real geometric-continuity result, not just "everything in
    // this scene happens to be close together".
    expect(farApartDelta).toBeGreaterThan(0.3);
  });
});
