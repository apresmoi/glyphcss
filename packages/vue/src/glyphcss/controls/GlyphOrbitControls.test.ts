import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, defineComponent, h, inject, nextTick, ref } from "vue";
import type { GlyphSceneHandle } from "glyphcss";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphSceneContextKey } from "../scene/context";
import { GlyphOrbitControls } from "./GlyphOrbitControls";

/** Reads the mounted scene handle out of context, for assertions on the
 *  real camera state (same idiom as GlyphEffectLayer.test.ts's provide). */
const SceneProbe = defineComponent({
  props: { capture: { type: Function, required: true } },
  setup(props) {
    const ctx = inject(GlyphSceneContextKey);
    return () => {
      if (ctx?.sceneRef.value) (props.capture as (s: GlyphSceneHandle) => void)(ctx.sceneRef.value);
      return null;
    };
  },
});

async function renderSceneWithProbe(
  controlsProps: OrbitProps,
): Promise<{ container: HTMLElement; scene: GlyphSceneHandle }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let scene: GlyphSceneHandle | null = null;
  const app = createApp({
    setup() {
      return () =>
        h(GlyphPerspectiveCamera, {}, {
          default: () =>
            h(GlyphScene, {}, {
              default: () => [
                h(GlyphOrbitControls, controlsProps),
                h(SceneProbe, { capture: (s: GlyphSceneHandle) => { scene = s; } }),
              ],
            }),
        });
    },
  });
  app.mount(container);
  await nextTick();
  if (!scene) throw new Error("scene did not mount");
  return { container, scene };
}

function dragDown(host: HTMLElement, dy: number): void {
  host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
  host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: dy, pointerId: 1, isPrimary: true, bubbles: true }));
  host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
}

type OrbitProps = {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  pitchRange?: [number, number] | null;
  mode?: "turntable" | "trackball";
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
  zoomRange?: [number, number] | null;
  pan?: boolean;
};

function renderScene(
  controlsProps: OrbitProps = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphPerspectiveCamera, {}, {
          default: () =>
            h(GlyphScene, {}, {
              default: () => h(GlyphOrbitControls, controlsProps),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphOrbitControls (Vue) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting controls", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("mounts with drag=false", () => {
    expect(() => renderScene({ drag: false })).not.toThrow();
  });

  it("mounts with wheel=false", () => {
    expect(() => renderScene({ wheel: false })).not.toThrow();
  });

  it("mounts with invert=true", () => {
    expect(() => renderScene({ invert: true })).not.toThrow();
  });

  it("mounts with animate config", () => {
    expect(() =>
      renderScene({ animate: { speed: 0.5, axis: "y", pauseOnInteraction: true } }),
    ).not.toThrow();
  });

  // P2-c (codex gpt-5.6-sol fix round 1): "mounts without throwing" cannot
  // tell a forwarded prop from a silently dropped one. These read the real
  // camera state a drag produces, so removing `pitchRange`/`mode` from the
  // opts object `GlyphOrbitControls.ts` builds would turn them red.
  it("mode='trackball' actually reaches createGlyphOrbitControls (drag writes camera.mat)", async () => {
    const { scene } = await renderSceneWithProbe({ mode: "trackball" });
    dragDown(scene.host, 100);
    expect(scene.camera.useMat).toBe(true);
    expect(scene.camera.mat).not.toBeNull();
  });

  it("default mode='turntable' never touches camera.mat", async () => {
    const { scene } = await renderSceneWithProbe({});
    dragDown(scene.host, 100);
    expect(scene.camera.useMat).toBe(false);
  });

  it("pitchRange actually reaches createGlyphOrbitControls (clamps a real drag)", async () => {
    const { scene } = await renderSceneWithProbe({ pitchRange: [-10, 10] });
    scene.camera.rotX = 0;
    dragDown(scene.host, 1000); // far past 10deg unclamped
    expect(scene.camera.rotX).toBe(-10);
  });

  it("pitchRange: null actually reaches createGlyphOrbitControls (removes the clamp)", async () => {
    const { scene } = await renderSceneWithProbe({ pitchRange: null });
    scene.camera.rotX = 0;
    dragDown(scene.host, 1000); // 1000/4 = 250deg, unclamped
    expect(scene.camera.rotX).toBeCloseTo(-250, 5);
  });

  it("zoomRange actually reaches createGlyphOrbitControls (clamps a real wheel zoom)", async () => {
    const { scene } = await renderSceneWithProbe({ zoomRange: [1, 2] });
    for (let i = 0; i < 40; i++) {
      scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 10000, bubbles: true }));
    }
    expect(scene.camera.zoom).toBeCloseTo(1, 6);
  });

  it("zoomRange: null actually reaches createGlyphOrbitControls (removes the clamp)", async () => {
    const { scene } = await renderSceneWithProbe({ zoomRange: null });
    for (let i = 0; i < 20; i++) {
      scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true }));
    }
    expect(scene.camera.zoom).toBeLessThan(0.1);
  });

  it("pan=false actually reaches createGlyphOrbitControls (a middle-button drag no longer moves camera.target)", async () => {
    const { scene } = await renderSceneWithProbe({ pan: false });
    const target0 = [...scene.camera.target];
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, button: 1, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 0, pointerId: 1, isPrimary: true, button: 1, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    expect([...scene.camera.target]).toEqual(target0);
  });

  it("default pan=true pans camera.target on a middle-button drag", async () => {
    const { scene } = await renderSceneWithProbe({});
    const target0 = [...scene.camera.target];
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, button: 1, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 0, pointerId: 1, isPrimary: true, button: 1, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    expect([...scene.camera.target]).not.toEqual(target0);
  });

  it("reacts to drag prop change", async () => {
    const drag = ref(true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphPerspectiveCamera, {}, {
            default: () =>
              h(GlyphScene, {}, {
                default: () => h(GlyphOrbitControls, { drag: drag.value }),
              }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".glyph-scene")).toBeTruthy();

    drag.value = false;
    await nextTick();
    expect(container.querySelector(".glyph-scene")).toBeTruthy();
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene();
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });

  it("can be mounted and remounted without leaks", async () => {
    const c1 = document.createElement("div");
    document.body.appendChild(c1);
    const a1 = createApp({
      setup() {
        return () =>
          h(GlyphPerspectiveCamera, {}, {
            default: () =>
              h(GlyphScene, {}, { default: () => h(GlyphOrbitControls, {}) }),
          });
      },
    });
    a1.mount(c1);
    await nextTick();
    a1.unmount();
    expect(c1.querySelector(".glyph-output")).toBeFalsy();

    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const a2 = createApp({
      setup() {
        return () =>
          h(GlyphPerspectiveCamera, {}, {
            default: () =>
              h(GlyphScene, {}, { default: () => h(GlyphOrbitControls, {}) }),
          });
      },
    });
    a2.mount(c2);
    await nextTick();
    expect(c2.querySelector(".glyph-host")).toBeTruthy();
    a2.unmount();
  });
});

describe("GlyphOrbitControls (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphOrbitControls, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
