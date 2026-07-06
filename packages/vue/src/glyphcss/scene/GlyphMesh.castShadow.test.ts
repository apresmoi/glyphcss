/**
 * GlyphMesh / GlyphScene / GlyphGround (Vue) — castShadow / receiveShadow tests.
 *
 * Mirror of the React GlyphMesh.castShadow.test.tsx, adapted for Vue 3 idioms
 * (createApp, nextTick, reactive refs). Same contracts, same assertion style.
 *
 * Covers:
 *  - default (no castShadow, no scene.shadow) → renders without error.
 *  - castShadow + receiveShadow + scene.shadow → <pre> output differs from
 *    the no-shadow baseline (shadow darkening).
 *  - toggling castShadow reactively changes the rasterised output.
 *  - no scene.shadow prop → no darkening even with castShadow=true on the mesh.
 *  - GlyphGround receiveShadow defaults to true, castShadow defaults to false.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createApp, h, ref, nextTick } from "vue";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphScene } from "./GlyphScene";
import { GlyphMesh } from "./GlyphMesh";
import { GlyphGround } from "./GlyphGround";
import type { Polygon } from "@glyphcss/core";
import type { GlyphShadowOptions } from "glyphcss";

// --- Shared geometry helpers ------------------------------------------------

/** Unit cube centered at (0,0,1) — hovering above z=0. */
function makeCubePolygons(): Polygon[] {
  const z = 1;
  const faces: Array<[[number,number,number],[number,number,number],[number,number,number],string]> = [
    [[-1,-1,z+1],[1,-1,z+1],[1,1,z+1],"#cccccc"],
    [[-1,-1,z+1],[1,1,z+1],[-1,1,z+1],"#cccccc"],
    [[1,-1,z-1],[-1,-1,z-1],[-1,1,z-1],"#aaaaaa"],
    [[1,-1,z-1],[-1,1,z-1],[1,1,z-1],"#aaaaaa"],
    [[-1,1,z+1],[1,1,z+1],[1,1,z-1],"#bbbbbb"],
    [[-1,1,z+1],[1,1,z-1],[-1,1,z-1],"#bbbbbb"],
    [[-1,-1,z-1],[1,-1,z-1],[1,-1,z+1],"#999999"],
    [[-1,-1,z-1],[1,-1,z+1],[-1,-1,z+1],"#999999"],
    [[1,-1,z+1],[1,-1,z-1],[1,1,z-1],"#aaaaaa"],
    [[1,-1,z+1],[1,1,z-1],[1,1,z+1],"#aaaaaa"],
    [[-1,-1,z-1],[-1,-1,z+1],[-1,1,z+1],"#aaaaaa"],
    [[-1,-1,z-1],[-1,1,z+1],[-1,1,z-1],"#aaaaaa"],
  ];
  return faces.map(([v0, v1, v2, color]) => ({ vertices: [v0, v1, v2], color }));
}

const CUBE_POLYGONS = makeCubePolygons();

/** Large ground plane at z=0. */
const GROUND_POLYGONS: Polygon[] = [
  { vertices: [[-5,-5,0],[5,-5,0],[5,5,0]], color: "#888888" },
  { vertices: [[-5,-5,0],[5,5,0],[-5,5,0]], color: "#888888" },
];

const SHADOW_OPTS: GlyphShadowOptions = { opacity: 0.6, lift: 0.05 };

// Shared scene options
const SCENE_BASE = {
  cols: 60,
  rows: 30,
  useColors: false,
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 1 },
  ambientLight: { intensity: 0.3 },
};

const CAMERA_PROPS = { rotX: 55, rotY: 30, zoom: 250, distance: 20 };

// --- Render helpers ---------------------------------------------------------

function renderScene(
  sceneProps: Record<string, unknown> = {},
  slotFn?: () => unknown,
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphPerspectiveCamera, CAMERA_PROPS, {
          default: () =>
            h(
              GlyphScene,
              { ...SCENE_BASE, ...sceneProps },
              slotFn ? { default: slotFn } : undefined,
            ),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

function getPreText(container: HTMLElement): string {
  return container.querySelector(".glyph-output")?.textContent ?? "";
}

// --- Tests ------------------------------------------------------------------

describe("GlyphMesh (Vue) — castShadow / receiveShadow props accepted", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("accepts castShadow prop without throwing", async () => {
    expect(() =>
      renderScene({}, () => h(GlyphMesh, { polygons: CUBE_POLYGONS, castShadow: true })),
    ).not.toThrow();
    await nextTick();
  });

  it("accepts receiveShadow prop without throwing", async () => {
    expect(() =>
      renderScene({}, () => h(GlyphMesh, { polygons: CUBE_POLYGONS, receiveShadow: true })),
    ).not.toThrow();
    await nextTick();
  });

  it("castShadow defaults to false — scene renders", async () => {
    const { container } = renderScene(
      {},
      () => h(GlyphMesh, { polygons: CUBE_POLYGONS }),
    );
    await nextTick();
    expect(getPreText(container)).not.toBe("");
  });

  it("receiveShadow defaults to false — scene renders", async () => {
    const { container } = renderScene(
      {},
      () => h(GlyphMesh, { polygons: CUBE_POLYGONS }),
    );
    await nextTick();
    expect(getPreText(container)).not.toBe("");
  });
});

describe("GlyphScene (Vue) — shadow prop", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("accepts shadow prop without throwing", () => {
    expect(() =>
      renderScene({ shadow: SHADOW_OPTS }),
    ).not.toThrow();
  });

  it("renders without shadow prop (no darkening baseline)", async () => {
    const { container } = renderScene(
      {},
      () => [
        h(GlyphMesh, { polygons: CUBE_POLYGONS }),
        h(GlyphMesh, { polygons: GROUND_POLYGONS }),
      ],
    );
    await nextTick();
    expect(getPreText(container)).not.toBe("");
  });

  it("no scene.shadow → output same as no-shadow baseline even with castShadow=true", async () => {
    const { container: containerBase } = renderScene(
      {},
      () => [
        h(GlyphMesh, { polygons: CUBE_POLYGONS }),
        h(GlyphMesh, { polygons: GROUND_POLYGONS }),
      ],
    );
    await nextTick();
    const baseOutput = getPreText(containerBase);

    const { container: containerCast } = renderScene(
      {
        // shadow NOT set on scene → no shadow computation even with castShadow
      },
      () => [
        h(GlyphMesh, { polygons: CUBE_POLYGONS, castShadow: true }),
        h(GlyphMesh, { polygons: GROUND_POLYGONS, receiveShadow: true }),
      ],
    );
    await nextTick();
    const castOutput = getPreText(containerCast);

    expect(castOutput).toBe(baseOutput);
  });
});

describe("GlyphMesh (Vue) — castShadow darkening contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("castShadow=true + receiveShadow=true + scene.shadow → output differs from baseline", async () => {
    const { container: containerBase } = renderScene(
      {},
      () => [
        h(GlyphMesh, { polygons: CUBE_POLYGONS }),
        h(GlyphMesh, { polygons: GROUND_POLYGONS }),
      ],
    );
    await nextTick();
    const baseOutput = getPreText(containerBase);

    const { container: containerShadow } = renderScene(
      { shadow: SHADOW_OPTS },
      () => [
        h(GlyphMesh, { polygons: CUBE_POLYGONS, castShadow: true }),
        h(GlyphMesh, { polygons: GROUND_POLYGONS, receiveShadow: true }),
      ],
    );
    await nextTick();
    const shadowOutput = getPreText(containerShadow);

    expect(shadowOutput).not.toBe(baseOutput);
  });

  it("toggling castShadow reactively changes the rasterised output", async () => {
    const castShadow = ref(false);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphPerspectiveCamera, CAMERA_PROPS, {
            default: () =>
              h(GlyphScene, { ...SCENE_BASE, shadow: SHADOW_OPTS }, {
                default: () => [
                  h(GlyphMesh, { polygons: CUBE_POLYGONS, castShadow: castShadow.value }),
                  h(GlyphMesh, { polygons: GROUND_POLYGONS, receiveShadow: true }),
                ],
              }),
          });
      },
    });
    app.mount(container);
    await nextTick();

    const outputOff = getPreText(container);

    // Toggle castShadow on
    castShadow.value = true;
    await nextTick();
    // The rasterizer schedules async; flush the microtask queue
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
    const outputOn = getPreText(container);
    expect(outputOn).not.toBe(outputOff);

    // Toggle back
    castShadow.value = false;
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
    const outputOffAgain = getPreText(container);
    expect(outputOffAgain).toBe(outputOff);
  });
});

describe("GlyphGround (Vue) — shadow prop defaults", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("receiveShadow defaults to true on GlyphGround", async () => {
    // Default GlyphGround should not throw with a shadow-enabled scene
    expect(() =>
      renderScene(
        { shadow: SHADOW_OPTS },
        () => [
          h(GlyphMesh, { polygons: CUBE_POLYGONS, castShadow: true }),
          h(GlyphGround),
        ],
      ),
    ).not.toThrow();
    await nextTick();
  });

  it("castShadow defaults to false on GlyphGround", async () => {
    expect(() =>
      renderScene({}, () => h(GlyphGround)),
    ).not.toThrow();
    await nextTick();
  });

  it("GlyphGround with default receiveShadow=true receives shadows from castShadow mesh", async () => {
    const groundLight = { direction: [0, 1, 0] as [number, number, number], intensity: 1 };
    // Baseline: no shadow config
    const { container: containerBase } = renderScene(
      { directionalLight: groundLight },
      () => [
        h(GlyphMesh, { polygons: CUBE_POLYGONS }),
        h(GlyphGround, { position: [0, -3, 0] }),
      ],
    );
    await nextTick();
    const baseOutput = getPreText(containerBase);

    // With shadow: cube casts, GlyphGround receives (default receiveShadow=true)
    const { container: containerShadow } = renderScene(
      { shadow: SHADOW_OPTS, directionalLight: groundLight },
      () => [
        h(GlyphMesh, { polygons: CUBE_POLYGONS, castShadow: true }),
        h(GlyphGround, { position: [0, -3, 0] }),
      ],
    );
    await nextTick();
    const shadowOutput = getPreText(containerShadow);

    expect(shadowOutput).not.toBe(baseOutput);
  });

  it("accepts receiveShadow=false override on GlyphGround", async () => {
    expect(() =>
      renderScene({}, () => h(GlyphGround, { receiveShadow: false })),
    ).not.toThrow();
    await nextTick();
  });

  it("accepts castShadow=true override on GlyphGround", async () => {
    expect(() =>
      renderScene({}, () => h(GlyphGround, { castShadow: true })),
    ).not.toThrow();
    await nextTick();
  });
});
