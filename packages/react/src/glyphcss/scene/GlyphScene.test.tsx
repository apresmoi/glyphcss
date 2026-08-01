import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "./GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphOrthographicCamera } from "../camera/GlyphOrthographicCamera";
import { GlyphMesh } from "./GlyphMesh";
import { GlyphOrbitControls } from "../controls/GlyphOrbitControls";
import type { Polygon } from "@glyphcss/core";
import { computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, type GlyphControlSceneManifest, type GlyphObjectDictionary } from "glyphcss";

const POLYGON: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const SEMANTIC_POLYGON: Polygon = { vertices: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], color: "#ffffff" };
const semanticDigest = (char: string) => char.repeat(64);
const semanticDictionaryBase = { schemaVersion: "glyph-object-dictionary/v2" as const, id: "dictionary/react", font: { id: "font/react", version: "1", sha256: semanticDigest("a") }, classes: [{ id: 1, name: "quad", semanticGlyph: "Q", controlColor: "#123456" }] };
const semanticDictionary: GlyphObjectDictionary = { ...semanticDictionaryBase, contentSha256: computeGlyphControlContentSha256(semanticDictionaryBase) };
const semanticHashes = computeGlyphControlGeometryHashes([SEMANTIC_POLYGON]);
const semanticManifestBase = { schemaVersion: "control-scene/v1" as const, id: "scene/react", dictionaryId: semanticDictionary.id, dictionarySha256: semanticDictionary.contentSha256, ...semanticHashes, contentSha256: "", instances: [{ id: "quad", classId: 1 }], surfaces: [{ id: "surface", instanceId: "quad" }], polygonSurfaceIds: ["surface"] };
const semanticManifest: GlyphControlSceneManifest = { ...semanticManifestBase, contentSha256: computeGlyphControlContentSha256(semanticManifestBase) };

function renderScene(
  sceneProps: React.ComponentProps<typeof GlyphScene>,
  children?: React.ReactNode,
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphPerspectiveCamera,
        {},
        React.createElement(GlyphScene, sceneProps, children),
      ),
    ),
  );
  return container;
}

describe("GlyphScene — basic rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a .glyph-host element", () => {
    const container = renderScene({});
    const host = container.querySelector(".glyph-host");
    expect(host).toBeTruthy();
  });

  it("renders a .glyph-scene element inside the host", () => {
    const container = renderScene({});
    const scene = container.querySelector(".glyph-scene");
    expect(scene).toBeTruthy();
  });

  it("renders a .glyph-output <pre> inside the scene", () => {
    const container = renderScene({});
    const pre = container.querySelector(".glyph-output");
    expect(pre).toBeTruthy();
    expect(pre?.tagName.toLowerCase()).toBe("pre");
  });

  it("applies custom className to the host element", () => {
    const container = renderScene({ className: "my-scene" });
    const host = container.querySelector(".glyph-host");
    expect(host?.classList.contains("my-scene")).toBe(true);
  });

  it("renders children inside the host", () => {
    const container = renderScene(
      {},
      React.createElement("div", { className: "my-child" }, "hello"),
    );
    const child = container.querySelector(".my-child");
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe("hello");
  });
});

describe("GlyphScene — options forwarding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders with custom cols/rows", () => {
    const container = renderScene({ cols: 40, rows: 12 });
    const scene = container.querySelector(".glyph-scene");
    expect(scene).toBeTruthy();
  });

  it("renders in wireframe mode without errors", () => {
    expect(() => renderScene({ mode: "wireframe" })).not.toThrow();
  });

  it("renders with useColors=false without errors", () => {
    expect(() => renderScene({ useColors: false })).not.toThrow();
  });

  it("renders wireframe mode with charMode=\"braille\" without errors", () => {
    expect(() => renderScene({ mode: "wireframe", charMode: "braille" })).not.toThrow();
  });

  it("renders wireframe mode with wireframeJunctions=true without errors", () => {
    expect(() => renderScene({ mode: "wireframe", wireframeJunctions: true })).not.toThrow();
  });

  it("enables semantic output and resets to visible when the prop is removed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const paint = (semantic: boolean) => act(() => root.render(
      <GlyphOrthographicCamera zoom={8}>
        <GlyphScene cols={12} rows={8} useColors={false} {...(semantic ? { glyphOutput: "semantic" as const, sceneManifest: semanticManifest, dictionary: semanticDictionary } : {})}>
          <GlyphMesh polygons={[SEMANTIC_POLYGON]} />
        </GlyphScene>
      </GlyphOrthographicCamera>,
    ));
    paint(false);
    const visible = container.querySelector(".glyph-output")?.textContent;
    paint(true);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector(".glyph-output")?.textContent).toContain("Q");
    paint(false);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector(".glyph-output")?.textContent).toBe(visible);
    act(() => root.unmount());
  });
});

describe("GlyphScene — GlyphMesh child", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts a GlyphMesh without throwing", () => {
    expect(() =>
      renderScene(
        {},
        React.createElement(GlyphMesh, { polygons: [POLYGON] }),
      ),
    ).not.toThrow();
  });

  it("GlyphMesh renders a wrapper div", () => {
    const container = renderScene(
      {},
      React.createElement(GlyphMesh, { id: "test-mesh", polygons: [POLYGON] }),
    );
    const mesh = container.querySelector(".glyph-mesh");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphScene — controls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphOrbitControls mounts without throwing", () => {
    expect(() =>
      renderScene(
        {},
        React.createElement(GlyphOrbitControls, { drag: false, wheel: false }),
      ),
    ).not.toThrow();
  });
});

describe("GlyphScene — error (no context)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphMesh throws when used outside GlyphScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphMesh, { polygons: [] })),
      );
    }).toThrow();
  });

  it("GlyphScene throws when used without a camera ancestor", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphScene, {})),
      );
    }).toThrow();
  });
});
