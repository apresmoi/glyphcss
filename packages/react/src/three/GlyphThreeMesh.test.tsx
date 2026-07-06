import { describe, expect, afterEach, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "../glyphcss/scene/GlyphScene";
import { GlyphThreeMesh } from "./GlyphThreeMesh";
import { GlyphThreePerspectiveCamera } from "./GlyphThreePerspectiveCamera";

describe("GlyphThreeMesh (React)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a Three-authored mesh inside a glyph scene", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <GlyphThreePerspectiveCamera
          fov={45}
          aspect={1}
          position={[4, 3, 6]}
          lookAt={[0, 0.5, 0]}
        >
          <GlyphScene>
            <GlyphThreeMesh
              id="three-cube"
              geometry="cube"
              position={[0, 0.5, 0]}
              rotation={[0, Math.PI / 4, 0]}
            />
          </GlyphScene>
        </GlyphThreePerspectiveCamera>,
      );
    });

    expect(container.querySelector("[data-glyph-mesh-id='three-cube']")).toBeTruthy();
  });
});
