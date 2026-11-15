import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createApp, defineComponent, h, inject, nextTick, type Component } from "vue";
import type { GlyphSceneHandle } from "glyphcss";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphOrthographicCamera } from "../camera/GlyphOrthographicCamera";
import { GlyphSceneContextKey } from "../scene/context";
import { GlyphOrbitControls } from "./GlyphOrbitControls";
import { GlyphMapControls } from "./GlyphMapControls";

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

async function mount(controls: Component, props: Record<string, unknown>): Promise<GlyphSceneHandle> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let scene: GlyphSceneHandle | null = null;
  createApp({
    setup() {
      return () => h(GlyphOrthographicCamera, {}, {
        default: () => h(GlyphScene, {}, {
          default: () => [h(controls, props), h(SceneProbe, { capture: (s: GlyphSceneHandle) => { scene = s; } })],
        }),
      });
    },
  }).mount(container);
  await nextTick();
  if (!scene) throw new Error("scene did not mount");
  return scene;
}

/** Starts a pan and leaves it live, so the margin grid is still mounted. */
function startPan(scene: GlyphSceneHandle, button: number): void {
  scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, button, bubbles: true }));
  scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 8, clientY: 4, pointerId: 1, isPrimary: true, button, bubbles: true }));
}

describe("compositorPan prop (Vue)", () => {
  beforeEach(() => {
    // The compositor pan needs a laid-out cell; happy-dom measures nothing.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const lines = this.textContent?.split("\n") ?? [];
      const pre = this.tagName === "PRE";
      const width = pre ? Math.max(0, ...lines.map((line) => line.length)) * 8 : 640, height = pre ? lines.length * 16 : 384;
      return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON() {} } as DOMRect;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

  it("GlyphOrbitControls forwards compositorPan (a middle-button pan mounts the margin grid)", async () => {
    const scene = await mount(GlyphOrbitControls, { compositorPan: true });
    const cols = scene.getOptions().cols!;
    startPan(scene, 1);
    expect(scene.getOptions().cols).toBeGreaterThan(cols);
  });

  it("GlyphMapControls forwards compositorPan (a left-drag pan mounts the margin grid)", async () => {
    const scene = await mount(GlyphMapControls, { compositorPan: true });
    const cols = scene.getOptions().cols!;
    startPan(scene, 0);
    expect(scene.getOptions().cols).toBeGreaterThan(cols);
  });

  it("defaults to off on both", async () => {
    for (const [controls, button] of [[GlyphOrbitControls, 1], [GlyphMapControls, 0]] as const) {
      const scene = await mount(controls, {});
      const cols = scene.getOptions().cols;
      startPan(scene, button);
      expect(scene.getOptions().cols).toBe(cols);
    }
  });
});
