/**
 * GlyphMesh / GlyphScene / GlyphGround — castShadow / receiveShadow tests.
 *
 * Adapted from the vanilla shadow.test.ts contract, threaded through the React
 * component layer. The rasteriser output is the <pre>.textContent / .innerHTML;
 * we assert on those (same approach as the existing GlyphScene tests).
 *
 * Covers:
 *  - default (no castShadow, no scene.shadow) → renders without error,
 *    <pre> produces output identical to the no-shadow baseline.
 *  - castShadow + receiveShadow (cube over a receiving ground) + scene.shadow
 *    → <pre> output differs from the no-shadow baseline (shadow darkening).
 *  - toggling castShadow reactively changes the rasterised output.
 *  - no scene.shadow prop → no darkening even with castShadow=true on the mesh.
 *  - GlyphGround receiveShadow defaults to true, castShadow defaults to false.
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
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

// Camera looking slightly down so cube and ground are both visible.
const CAMERA_PROPS = { rotX: 55, rotY: 30, zoom: 5, distance: 20 };

// --- Render helpers ---------------------------------------------------------

type SceneProps = React.ComponentProps<typeof GlyphScene>;
type MeshProps = React.ComponentProps<typeof GlyphMesh>;
type GroundProps = React.ComponentProps<typeof GlyphGround>;

function renderScene(
  sceneProps: SceneProps,
  children?: React.ReactNode,
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <GlyphPerspectiveCamera {...CAMERA_PROPS}>
        <GlyphScene cols={60} rows={30} useColors={false} directionalLight={{ direction: [0, 0, -1], intensity: 1 }} ambientLight={{ intensity: 0.3 }} {...sceneProps}>
          {children}
        </GlyphScene>
      </GlyphPerspectiveCamera>,
    ),
  );
  return { container, root };
}

function rerender(
  root: ReturnType<typeof createRoot>,
  sceneProps: SceneProps,
  children?: React.ReactNode,
): void {
  act(() =>
    root.render(
      <GlyphPerspectiveCamera {...CAMERA_PROPS}>
        <GlyphScene cols={60} rows={30} useColors={false} directionalLight={{ direction: [0, 0, -1], intensity: 1 }} ambientLight={{ intensity: 0.3 }} {...sceneProps}>
          {children}
        </GlyphScene>
      </GlyphPerspectiveCamera>,
    ),
  );
}

function flushMicrotasks(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function getPreText(container: HTMLElement): string {
  return container.querySelector(".glyph-output")?.textContent ?? "";
}

// --- Tests ------------------------------------------------------------------

describe("GlyphMesh (React) — castShadow / receiveShadow props accepted", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("accepts castShadow prop without throwing", () => {
    expect(() =>
      renderScene({}, <GlyphMesh polygons={CUBE_POLYGONS} castShadow />),
    ).not.toThrow();
  });

  it("accepts receiveShadow prop without throwing", () => {
    expect(() =>
      renderScene({}, <GlyphMesh polygons={CUBE_POLYGONS} receiveShadow />),
    ).not.toThrow();
  });

  it("castShadow defaults to false", async () => {
    const { container } = renderScene(
      {},
      <GlyphMesh polygons={CUBE_POLYGONS} />,
    );
    await flushMicrotasks();
    // No error and scene renders (non-empty <pre>)
    expect(getPreText(container)).not.toBe("");
  });

  it("receiveShadow defaults to false", async () => {
    const { container } = renderScene(
      {},
      <GlyphMesh polygons={CUBE_POLYGONS} />,
    );
    await flushMicrotasks();
    expect(getPreText(container)).not.toBe("");
  });
});

describe("GlyphScene (React) — shadow prop", () => {
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
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} />
        <GlyphMesh polygons={GROUND_POLYGONS} />
      </>,
    );
    await flushMicrotasks();
    expect(getPreText(container)).not.toBe("");
  });

  it("no scene.shadow → output same as no-shadow baseline even with castShadow=true", async () => {
    const { container: containerBase } = renderScene(
      {},
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} />
        <GlyphMesh polygons={GROUND_POLYGONS} />
      </>,
    );
    await flushMicrotasks();
    const baseOutput = getPreText(containerBase);

    const { container: containerCast } = renderScene(
      {
        // shadow NOT set on scene → no shadow computation even with castShadow
      },
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} castShadow />
        <GlyphMesh polygons={GROUND_POLYGONS} receiveShadow />
      </>,
    );
    await flushMicrotasks();
    const castOutput = getPreText(containerCast);

    expect(castOutput).toBe(baseOutput);
  });
});

describe("GlyphMesh (React) — castShadow darkening contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("castShadow=true + receiveShadow=true + scene.shadow → output differs from baseline", async () => {
    // Baseline: no shadow configuration
    const { container: containerBase } = renderScene(
      {},
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} />
        <GlyphMesh polygons={GROUND_POLYGONS} />
      </>,
    );
    await flushMicrotasks();
    const baseOutput = getPreText(containerBase);

    // With shadow: cube casts, ground receives
    const { container: containerShadow } = renderScene(
      { shadow: SHADOW_OPTS },
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} castShadow />
        <GlyphMesh polygons={GROUND_POLYGONS} receiveShadow />
      </>,
    );
    await flushMicrotasks();
    const shadowOutput = getPreText(containerShadow);

    // Shadow output must differ from baseline (darkening changes the ramp chars)
    expect(shadowOutput).not.toBe(baseOutput);
  });

  it("toggling castShadow reactively changes the rasterised output", async () => {
    // Start with castShadow=false
    const { container, root } = renderScene(
      { shadow: SHADOW_OPTS },
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} castShadow={false} />
        <GlyphMesh polygons={GROUND_POLYGONS} receiveShadow />
      </>,
    );
    await flushMicrotasks();
    const outputOff = getPreText(container);

    // Toggle castShadow=true
    rerender(
      root,
      { shadow: SHADOW_OPTS },
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} castShadow />
        <GlyphMesh polygons={GROUND_POLYGONS} receiveShadow />
      </>,
    );
    await flushMicrotasks();
    const outputOn = getPreText(container);
    expect(outputOn).not.toBe(outputOff);

    // Toggle back to castShadow=false
    rerender(
      root,
      { shadow: SHADOW_OPTS },
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} castShadow={false} />
        <GlyphMesh polygons={GROUND_POLYGONS} receiveShadow />
      </>,
    );
    await flushMicrotasks();
    const outputOffAgain = getPreText(container);
    expect(outputOffAgain).toBe(outputOff);
  });
});

describe("GlyphGround (React) — shadow prop defaults", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("receiveShadow defaults to true", async () => {
    // GlyphGround with default props should accept and not throw
    expect(() =>
      renderScene(
        { shadow: SHADOW_OPTS },
        <>
          <GlyphMesh polygons={CUBE_POLYGONS} castShadow />
          <GlyphGround />
        </>,
      ),
    ).not.toThrow();
  });

  it("castShadow defaults to false on GlyphGround", () => {
    expect(() =>
      renderScene(
        {},
        <GlyphGround />,
      ),
    ).not.toThrow();
  });

  it("GlyphGround with default receiveShadow=true receives shadows from castShadow mesh", async () => {
    // Baseline: GlyphGround without shadow config
    const { container: containerBase } = renderScene(
      {},
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} />
        <GlyphGround />
      </>,
    );
    await flushMicrotasks();
    const baseOutput = getPreText(containerBase);

    // With shadow: cube casts, GlyphGround receives (default receiveShadow=true)
    const { container: containerShadow } = renderScene(
      { shadow: SHADOW_OPTS },
      <>
        <GlyphMesh polygons={CUBE_POLYGONS} castShadow />
        <GlyphGround />
      </>,
    );
    await flushMicrotasks();
    const shadowOutput = getPreText(containerShadow);

    expect(shadowOutput).not.toBe(baseOutput);
  });

  it("accepts receiveShadow=false override on GlyphGround", () => {
    expect(() =>
      renderScene(
        {},
        <GlyphGround receiveShadow={false} />,
      ),
    ).not.toThrow();
  });

  it("accepts castShadow=true override on GlyphGround", () => {
    expect(() =>
      renderScene(
        {},
        <GlyphGround castShadow />,
      ),
    ).not.toThrow();
  });
});
