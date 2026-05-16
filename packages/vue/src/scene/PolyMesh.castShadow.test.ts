/**
 * PolyMesh castShadow tests — mirrors createPolyScene's castShadow describe block.
 *
 * Required cases:
 *   - default → no .polycss-shadow elements
 *   - castShadow + dynamic → 1 shadow per non-duplicate polygon
 *   - castShadow + baked → 0 shadows
 *   - shadow tag is <q>
 *   - transform contains var(--shadow-proj) then matrix3d
 *   - --shadow-ground-cssz is set on the scene element when a casting mesh is added
 *   - toggling castShadow reactively adds/removes shadows
 *   - textured polygons ALSO cast shadows
 */
import { describe, it, expect, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import type { Polygon } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const DISTINCT_TRIANGLE: Polygon = {
  vertices: [
    [10, 10, 5],
    [11, 10, 5],
    [10, 11, 5],
  ],
  color: "#00ff00",
};

const TEXTURED_TRIANGLE: Polygon = {
  vertices: TRIANGLE.vertices,
  texture: "https://example.com/tex.png",
  uvs: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
};

const DYNAMIC_SCENE_PROPS = {
  textureLighting: "dynamic" as const,
  directionalLight: {
    direction: [0.4, -0.7, 0.59] as [number, number, number],
    color: "#ffffff",
    intensity: 1,
  },
};

function mount(
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

describe("PolyMesh (Vue) — castShadow", () => {
  it("default (no castShadow) emits no .polycss-shadow elements", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, { polygons: [TRIANGLE] });
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("castShadow:true in dynamic mode emits shadow leaves, one per non-duplicate polygon", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE, DISTINCT_TRIANGLE],
      castShadow: true,
    });
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(2);
  });

  it("castShadow:true in baked mode emits NO shadow leaves", () => {
    const { container } = mount(
      { textureLighting: "baked" },
      { polygons: [TRIANGLE], castShadow: true },
    );
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("shadow leaves are always <q> with class polycss-shadow", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE, DISTINCT_TRIANGLE],
      castShadow: true,
    });
    const shadows = Array.from(container.querySelectorAll(".polycss-shadow"));
    expect(shadows.length).toBeGreaterThan(0);
    for (const el of shadows) {
      expect(el.tagName.toLowerCase()).toBe("q");
      expect(el.classList.contains("polycss-shadow")).toBe(true);
    }
  });

  it("shadow leaves have border-shape set", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE, DISTINCT_TRIANGLE],
      castShadow: true,
    });
    const shadows = Array.from(container.querySelectorAll(".polycss-shadow")) as HTMLElement[];
    expect(shadows.length).toBeGreaterThan(0);
    for (const el of shadows) {
      expect(el.style.getPropertyValue("border-shape")).not.toBe("");
    }
  });

  it("shadow leaves transform contains var(--shadow-proj) followed by matrix3d", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: true,
    });
    const shadow = container.querySelector(".polycss-shadow") as HTMLElement;
    expect(shadow).not.toBeNull();
    expect(shadow.style.transform).toMatch(/^var\(--shadow-proj\)\s+matrix3d\(/);
  });

  it("adding a casting mesh sets --shadow-ground-cssz on the scene element", async () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: true,
    });
    // watchEffect writes --shadow-ground-cssz after the child PolyMesh registers,
    // which happens asynchronously after mount in Vue's reactive scheduler.
    await nextTick();
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl).not.toBeNull();
    const groundVar = sceneEl.style.getPropertyValue("--shadow-ground-cssz");
    expect(groundVar).not.toBe("");
  });

  it("--shadow-ground-cssz is NOT set when there are no casting meshes", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: false,
    });
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--shadow-ground-cssz")).toBe("");
  });

  it("toggling castShadow reactively adds and removes shadow leaves", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const castShadow = ref(false);

    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, DYNAMIC_SCENE_PROPS, {
                default: () => h(PolyMesh, { polygons: [TRIANGLE], castShadow: castShadow.value }),
              }),
          });
      },
    });
    app.mount(container);

    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);

    castShadow.value = true;
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBeGreaterThan(0);

    castShadow.value = false;
    await nextTick();
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(0);
  });

  it("textured polygons (s) ALSO emit shadow leaves", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TEXTURED_TRIANGLE],
      castShadow: true,
    });
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(1);
  });

  it("--clx/--cly/--clz are set on the scene element in dynamic mode", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, { polygons: [TRIANGLE] });
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--clx")).not.toBe("");
    expect(sceneEl.style.getPropertyValue("--cly")).not.toBe("");
    expect(sceneEl.style.getPropertyValue("--clz")).not.toBe("");
  });

  it("--clx/--cly/--clz are cleared when scene is in baked mode", () => {
    const { container } = mount({ textureLighting: "baked" }, { polygons: [TRIANGLE] });
    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--clx")).toBe("");
    expect(sceneEl.style.getPropertyValue("--cly")).toBe("");
    expect(sceneEl.style.getPropertyValue("--clz")).toBe("");
  });

  it("shadow leaves have --pnx/--pny/--pnz inline for Lambert gate", () => {
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE],
      castShadow: true,
    });
    const shadow = container.querySelector(".polycss-shadow") as HTMLElement;
    expect(shadow).not.toBeNull();
    expect(shadow.style.getPropertyValue("--pnx")).not.toBe("");
    expect(shadow.style.getPropertyValue("--pny")).not.toBe("");
    expect(shadow.style.getPropertyValue("--pnz")).not.toBe("");
  });

  it("duplicate coincident polygons emit only one shadow leaf", () => {
    // Two triangles at the same position should be deduped to one shadow leaf.
    const { container } = mount(DYNAMIC_SCENE_PROPS, {
      polygons: [TRIANGLE, { ...TRIANGLE }],
      castShadow: true,
    });
    expect(container.querySelectorAll(".polycss-shadow").length).toBe(1);
  });

  it("--shadow-ground-cssz is set when a casting mesh is removed (scene without casting meshes clears it)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const hasMesh = ref(true);

    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, DYNAMIC_SCENE_PROPS, {
                default: () =>
                  hasMesh.value
                    ? h(PolyMesh, { polygons: [TRIANGLE], castShadow: true })
                    : null,
              }),
          });
      },
    });
    app.mount(container);

    // Allow watchEffect to flush after child registers itself.
    await nextTick();

    const sceneEl = container.querySelector(".polycss-scene") as HTMLElement;
    expect(sceneEl.style.getPropertyValue("--shadow-ground-cssz")).not.toBe("");

    hasMesh.value = false;
    await nextTick();
    expect(sceneEl.style.getPropertyValue("--shadow-ground-cssz")).toBe("");
  });
});
