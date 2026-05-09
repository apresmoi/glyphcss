/**
 * PolyMesh dynamic lighting override tests.
 *
 * Verifies that when textureLighting="dynamic" and a mesh has a non-zero
 * rotation, the mesh wrapper emits per-mesh --polycss-lx/ly/lz CSS var
 * overrides computed by inverseRotateVec3(sceneDirectionalLight, rotation).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import type { Polygon, DirectionalLight } from "@layoutit/polycss-core";
import { inverseRotateVec3 } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const DYNAMIC_LIGHT: DirectionalLight = {
  direction: [1, 0, 0],
  color: "#ffffff",
  intensity: 1,
};

/**
 * Mount a PolyMesh inside PolyScene with specified props. Returns the
 * mesh wrapper element so tests can inspect inline style vars.
 */
function mountDynamic(
  sceneProps: Record<string, unknown>,
  meshProps: Record<string, unknown>,
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, sceneProps, {
              default: () => h(PolyMesh, meshProps),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

afterEach(() => {
  document.body.innerHTML = "";
});

// ── 1. Dynamic mode with rotation: override vars are emitted ─────────────
describe("PolyMesh (Vue) — dynamic lighting override", () => {
  it("emits --polycss-lx/ly/lz on the wrapper when textureLighting=dynamic and rotation is non-zero", () => {
    const rotation: [number, number, number] = [0, 90, 0];
    const { container } = mountDynamic(
      { textureLighting: "dynamic", directionalLight: DYNAMIC_LIGHT },
      { polygons: [TRIANGLE], rotation },
    );

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl).toBeTruthy();

    // Compute expected values using the same math as the implementation.
    const localDir = inverseRotateVec3(DYNAMIC_LIGHT.direction, rotation);
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    const expectedLx = (localDir[0] / len).toFixed(4);
    const expectedLy = (localDir[1] / len).toFixed(4);
    const expectedLz = (localDir[2] / len).toFixed(4);

    expect(meshEl.style.getPropertyValue("--polycss-lx")).toBe(expectedLx);
    expect(meshEl.style.getPropertyValue("--polycss-ly")).toBe(expectedLy);
    expect(meshEl.style.getPropertyValue("--polycss-lz")).toBe(expectedLz);
  });

  // Sanity-check concrete values: [0,90,0] with light [1,0,0] → local [0,0,1]
  it("produces the correct concrete values: rotateY(90) maps [1,0,0] light to [0,0,1] local", () => {
    const { container } = mountDynamic(
      { textureLighting: "dynamic", directionalLight: DYNAMIC_LIGHT },
      { polygons: [TRIANGLE], rotation: [0, 90, 0] },
    );

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl.style.getPropertyValue("--polycss-lx")).toBe("0.0000");
    expect(meshEl.style.getPropertyValue("--polycss-ly")).toBe("0.0000");
    expect(meshEl.style.getPropertyValue("--polycss-lz")).toBe("1.0000");
  });

  // ── 2. No rotation: no override emitted ─────────────────────────────────
  it("does NOT emit --polycss-lx override when rotation prop is absent", () => {
    const { container } = mountDynamic(
      { textureLighting: "dynamic", directionalLight: DYNAMIC_LIGHT },
      { polygons: [TRIANGLE] }, // no rotation
    );

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl.style.getPropertyValue("--polycss-lx")).toBe("");
  });

  it("does NOT emit --polycss-lx override when rotation is [0,0,0]", () => {
    const { container } = mountDynamic(
      { textureLighting: "dynamic", directionalLight: DYNAMIC_LIGHT },
      { polygons: [TRIANGLE], rotation: [0, 0, 0] },
    );

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl.style.getPropertyValue("--polycss-lx")).toBe("");
  });

  // ── 3. Baked mode: no override even with rotation ────────────────────────
  it("does NOT emit --polycss-lx override when textureLighting=baked (even with rotation)", () => {
    const { container } = mountDynamic(
      { textureLighting: "baked", directionalLight: DYNAMIC_LIGHT },
      { polygons: [TRIANGLE], rotation: [0, 90, 0] },
    );

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl.style.getPropertyValue("--polycss-lx")).toBe("");
  });

  // ── 4. No directionalLight: no override ──────────────────────────────────
  it("does NOT emit --polycss-lx override when scene has no directionalLight", () => {
    const { container } = mountDynamic(
      { textureLighting: "dynamic" }, // no directionalLight
      { polygons: [TRIANGLE], rotation: [0, 45, 0] },
    );

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl.style.getPropertyValue("--polycss-lx")).toBe("");
  });

  // ── 5. Reactive: override updates when rotation changes ──────────────────
  it("updates --polycss-lx/ly/lz in real time when rotation prop changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const rotation = ref<[number, number, number]>([0, 90, 0]);

    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, { textureLighting: "dynamic", directionalLight: DYNAMIC_LIGHT }, {
                default: () =>
                  h(PolyMesh, { polygons: [TRIANGLE], rotation: rotation.value }),
              }),
          });
      },
    });
    app.mount(container);

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;

    // Initial: [0, 90, 0] → localDir ≈ [0, 0, 1]
    expect(meshEl.style.getPropertyValue("--polycss-lz")).toBe("1.0000");

    // Change to [0, 0, 0] — rotation becomes zero → no override
    rotation.value = [0, 0, 0];
    await nextTick();
    expect(meshEl.style.getPropertyValue("--polycss-lx")).toBe("");

    // Change to [0, -90, 0] → inverseRotateVec3([1,0,0], [0,-90,0])
    //   rotateY(+90): x'=cos90*1=0, z'=-sin90*1=-1  → localDir=[0,0,-1]
    rotation.value = [0, -90, 0];
    await nextTick();
    const localDir2 = inverseRotateVec3([1, 0, 0], [0, -90, 0]);
    const len2 = Math.hypot(...localDir2) || 1;
    expect(meshEl.style.getPropertyValue("--polycss-lx")).toBe((localDir2[0] / len2).toFixed(4));
    expect(meshEl.style.getPropertyValue("--polycss-lz")).toBe((localDir2[2] / len2).toFixed(4));
  });

  // ── 6. Per-mesh override does not affect scene-level vars ────────────────
  it("does not modify scene-level --polycss-lx vars on the scene element", () => {
    const { container } = mountDynamic(
      { textureLighting: "dynamic", directionalLight: DYNAMIC_LIGHT },
      { polygons: [TRIANGLE], rotation: [0, 90, 0] },
    );

    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    // Scene emits world-space lx for direction [1,0,0], normalized → 1.0000
    expect(sceneEl.style.getPropertyValue("--polycss-lx")).toBe("1.0000");
    expect(sceneEl.style.getPropertyValue("--polycss-ly")).toBe("0.0000");
    expect(sceneEl.style.getPropertyValue("--polycss-lz")).toBe("0.0000");
  });
});
