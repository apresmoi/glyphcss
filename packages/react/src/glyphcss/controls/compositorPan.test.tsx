import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { GlyphSceneHandle } from "glyphcss";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphOrthographicCamera } from "../camera/GlyphOrthographicCamera";
import { useGlyphSceneContext } from "../scene/context";
import { GlyphOrbitControls } from "./GlyphOrbitControls";
import { GlyphMapControls } from "./GlyphMapControls";

function SceneProbe({ capture }: { capture: (scene: GlyphSceneHandle) => void }): null {
  const { sceneRef } = useGlyphSceneContext();
  useEffect(() => { if (sceneRef.current) capture(sceneRef.current); });
  return null;
}

async function mount(controls: React.ReactElement): Promise<GlyphSceneHandle> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let scene: GlyphSceneHandle | null = null;
  // Async act: the scene's first render is a microtask, and the pan measures its text.
  await act(async () => createRoot(container).render(
    React.createElement(GlyphOrthographicCamera, {},
      React.createElement(GlyphScene, {}, controls, React.createElement(SceneProbe, { capture: (s: GlyphSceneHandle) => { scene = s; } }))),
  ));
  if (!scene) throw new Error("scene did not mount");
  return scene;
}

/** Starts a pan and leaves it live, so the margin grid is still mounted. */
function startPan(scene: GlyphSceneHandle, button: number): void {
  scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, button, bubbles: true }));
  scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 8, clientY: 4, pointerId: 1, isPrimary: true, button, bubbles: true }));
}

describe("compositorPan prop", () => {
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
    const scene = await mount(React.createElement(GlyphOrbitControls, { compositorPan: true }));
    const cols = scene.getOptions().cols!;
    startPan(scene, 1);
    expect(scene.getOptions().cols).toBeGreaterThan(cols);
  });

  it("GlyphMapControls forwards compositorPan (a left-drag pan mounts the margin grid)", async () => {
    const scene = await mount(React.createElement(GlyphMapControls, { compositorPan: true }));
    const cols = scene.getOptions().cols!;
    startPan(scene, 0);
    expect(scene.getOptions().cols).toBeGreaterThan(cols);
  });

  it("defaults to off on both", async () => {
    for (const [element, button] of [[React.createElement(GlyphOrbitControls, {}), 1], [React.createElement(GlyphMapControls, {}), 0]] as const) {
      const scene = await mount(element);
      const cols = scene.getOptions().cols;
      startPan(scene, button);
      expect(scene.getOptions().cols).toBe(cols);
    }
  });
});
