/**
 * PolyMesh dynamic-mode lighting override tests.
 *
 * When textureLighting="dynamic" and the mesh has a non-zero rotation,
 * the mesh wrapper must emit --polycss-lx/ly/lz CSS custom properties
 * that hold the scene directionalLight direction inverse-rotated into
 * the mesh's local frame. This corrects the per-polygon Lambert calc
 * which uses mesh-local normals and would otherwise receive the wrong
 * (world-space) light direction after the CSS wrapper rotation.
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import type { Polygon } from "@polycss/core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

function renderScene(
  sceneProps: React.ComponentProps<typeof PolyScene>,
  meshProps: React.ComponentProps<typeof PolyMesh>,
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        PolyCamera,
        {},
        React.createElement(
          PolyScene,
          sceneProps,
          React.createElement(PolyMesh, meshProps),
        ),
      ),
    ),
  );
  return container;
}

describe("PolyMesh — dynamic lighting override", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("emits inverse-rotated --polycss-lx/ly/lz when dynamic + rotation is set", () => {
    // directionalLight direction [1, 0, 0], mesh rotated [0, 90, 0] (Y-axis).
    // inverseRotateVec3([1,0,0], [0,90,0]) = rotateY(-90) of [1,0,0] = [0, 0, 1]
    // after normalization: lx=0.0000, ly=0.0000, lz=1.0000
    const container = renderScene(
      {
        textureLighting: "dynamic",
        directionalLight: { direction: [1, 0, 0], color: "#ffffff", intensity: 1 },
      },
      {
        polygons: [TRIANGLE],
        rotation: [0, 90, 0],
      },
    );

    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh).toBeTruthy();

    const lx = mesh.style.getPropertyValue("--polycss-lx");
    const ly = mesh.style.getPropertyValue("--polycss-ly");
    const lz = mesh.style.getPropertyValue("--polycss-lz");

    // rotateY(-90deg) of [1,0,0] → [0, 0, 1]
    expect(lx).toBe("0.0000");
    expect(ly).toBe("0.0000");
    expect(lz).toBe("1.0000");
  });

  it("no-rotation = no inline --polycss-lx override (relies on scene cascade)", () => {
    // When rotation is [0, 0, 0] no override should be emitted so the
    // scene-level vars cascade down unmodified.
    const container = renderScene(
      {
        textureLighting: "dynamic",
        directionalLight: { direction: [1, 0, 0], color: "#ffffff", intensity: 1 },
      },
      {
        polygons: [TRIANGLE],
        rotation: [0, 0, 0],
      },
    );

    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh).toBeTruthy();
    expect(mesh.style.getPropertyValue("--polycss-lx")).toBe("");
  });

  it("no rotation prop = no inline --polycss-lx override", () => {
    // Omitting rotation entirely is the same as no rotation.
    const container = renderScene(
      {
        textureLighting: "dynamic",
        directionalLight: { direction: [1, 0, 0], color: "#ffffff", intensity: 1 },
      },
      {
        polygons: [TRIANGLE],
      },
    );

    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh).toBeTruthy();
    expect(mesh.style.getPropertyValue("--polycss-lx")).toBe("");
  });

  it("baked mode = no inline --polycss-lx override even when rotation is set", () => {
    // In baked mode the atlas pre-multiplies the light; dynamic CSS vars
    // are unused and should not be emitted on the mesh wrapper.
    const container = renderScene(
      {
        textureLighting: "baked",
        directionalLight: { direction: [1, 0, 0], color: "#ffffff", intensity: 1 },
      },
      {
        polygons: [TRIANGLE],
        rotation: [0, 90, 0],
      },
    );

    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh).toBeTruthy();
    expect(mesh.style.getPropertyValue("--polycss-lx")).toBe("");
  });

  it("emits correct values for a Z-axis rotation", () => {
    // directionalLight [0, 1, 0], mesh rotateZ(90deg).
    // inverseRotateVec3([0,1,0], [0,0,90]) = rotateZ(-90) of [0,1,0]
    // rotateZ(-90): x'=x*0 - y*(-1)=1, y'=x*(-1)+y*0=0  → [1, 0, 0]
    // after normalization: lx=1.0000, ly=0.0000, lz=0.0000
    const container = renderScene(
      {
        textureLighting: "dynamic",
        directionalLight: { direction: [0, 1, 0], color: "#ffffff", intensity: 1 },
      },
      {
        polygons: [TRIANGLE],
        rotation: [0, 0, 90],
      },
    );

    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    const lx = mesh.style.getPropertyValue("--polycss-lx");
    const ly = mesh.style.getPropertyValue("--polycss-ly");
    const lz = mesh.style.getPropertyValue("--polycss-lz");

    expect(lx).toBe("1.0000");
    expect(ly).toBe("0.0000");
    expect(lz).toBe("0.0000");
  });

  it("does not emit override when scene has no directionalLight", () => {
    // Without a scene directionalLight there is nothing to inverse-rotate.
    const container = renderScene(
      {
        textureLighting: "dynamic",
        // no directionalLight
      },
      {
        polygons: [TRIANGLE],
        rotation: [0, 90, 0],
      },
    );

    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.getPropertyValue("--polycss-lx")).toBe("");
  });
});
