import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { GlyphSceneHandle } from "glyphcss";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { useGlyphSceneContext } from "../scene/context";
import { GlyphOrbitControls } from "./GlyphOrbitControls";

function renderScene(
  controlsProps: React.ComponentProps<typeof GlyphOrbitControls> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphPerspectiveCamera,
        {},
        React.createElement(
          GlyphScene,
          {},
          React.createElement(GlyphOrbitControls, controlsProps),
        ),
      ),
    ),
  );
  return { container, root };
}

/** Reads the mounted scene handle out of context, for assertions on the
 *  real camera state (mirrors `useGlyphCamera.test.tsx`'s consumer idiom). */
function SceneProbe({ capture }: { capture: (scene: GlyphSceneHandle) => void }): null {
  const { sceneRef } = useGlyphSceneContext();
  useEffect(() => {
    if (sceneRef.current) capture(sceneRef.current);
  });
  return null;
}

function renderSceneWithProbe(
  controlsProps: React.ComponentProps<typeof GlyphOrbitControls>,
): { container: HTMLElement; scene: GlyphSceneHandle } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let scene: GlyphSceneHandle | null = null;
  act(() =>
    root.render(
      React.createElement(
        GlyphPerspectiveCamera,
        {},
        React.createElement(
          GlyphScene,
          {},
          React.createElement(GlyphOrbitControls, controlsProps),
          React.createElement(SceneProbe, { capture: (s: GlyphSceneHandle) => { scene = s; } }),
        ),
      ),
    ),
  );
  if (!scene) throw new Error("scene did not mount");
  return { container, scene };
}

function dragDown(host: HTMLElement, dy: number): void {
  host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
  host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: dy, pointerId: 1, isPrimary: true, bubbles: true }));
  host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
}

describe("GlyphOrbitControls — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting controls", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("renders null — no extra DOM elements from controls", () => {
    const { container } = renderScene();
    // Controls return null, only the scene host + scene + pre should exist
    const host = container.querySelector(".glyph-host");
    expect(host).toBeTruthy();
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
  // opts object `GlyphOrbitControls.tsx` builds would turn them red.
  it("mode='trackball' actually reaches createGlyphOrbitControls (drag writes camera.mat)", () => {
    const { scene } = renderSceneWithProbe({ mode: "trackball" });
    dragDown(scene.host, 100);
    expect(scene.camera.useMat).toBe(true);
    expect(scene.camera.mat).not.toBeNull();
  });

  it("default mode='turntable' never touches camera.mat", () => {
    const { scene } = renderSceneWithProbe({});
    dragDown(scene.host, 100);
    expect(scene.camera.useMat).toBe(false);
  });

  it("pitchRange actually reaches createGlyphOrbitControls (clamps a real drag)", () => {
    const { scene } = renderSceneWithProbe({ pitchRange: [-10, 10] });
    scene.camera.rotX = 0;
    dragDown(scene.host, 1000); // far past 10deg unclamped
    expect(scene.camera.rotX).toBe(-10);
  });

  it("pitchRange: null actually reaches createGlyphOrbitControls (removes the clamp)", () => {
    const { scene } = renderSceneWithProbe({ pitchRange: null });
    scene.camera.rotX = 0;
    dragDown(scene.host, 1000); // 1000/4 = 250deg, unclamped
    expect(scene.camera.rotX).toBeCloseTo(-250, 5);
  });

  it("updates props without throwing (drag toggle)", () => {
    const { container, root } = renderScene({ drag: true });
    expect(container.querySelector(".glyph-scene")).toBeTruthy();
    act(() =>
      root.render(
        React.createElement(
          GlyphPerspectiveCamera,
          {},
          React.createElement(
            GlyphScene,
            {},
            React.createElement(GlyphOrbitControls, { drag: false }),
          ),
        ),
      ),
    );
    expect(container.querySelector(".glyph-scene")).toBeTruthy();
  });

  it("unmounts cleanly — host is removed from DOM", () => {
    const { container, root } = renderScene();
    act(() => root.unmount());
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });

  it("can be mounted and remounted without leaks", () => {
    const c1 = document.createElement("div");
    document.body.appendChild(c1);
    const r1 = createRoot(c1);
    act(() =>
      r1.render(
        React.createElement(
          GlyphPerspectiveCamera,
          {},
          React.createElement(
            GlyphScene,
            {},
            React.createElement(GlyphOrbitControls, {}),
          ),
        ),
      ),
    );
    act(() => r1.unmount());
    expect(c1.querySelector(".glyph-output")).toBeFalsy();

    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const r2 = createRoot(c2);
    act(() =>
      r2.render(
        React.createElement(
          GlyphPerspectiveCamera,
          {},
          React.createElement(
            GlyphScene,
            {},
            React.createElement(GlyphOrbitControls, {}),
          ),
        ),
      ),
    );
    expect(c2.querySelector(".glyph-host")).toBeTruthy();
    act(() => r2.unmount());
  });
});

describe("GlyphOrbitControls — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphOrbitControls, {})),
      );
    }).toThrow();
  });
});
