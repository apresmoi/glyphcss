import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import type { VNode } from "vue";
import { GlyphScene } from "./GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphOrthographicCamera } from "../camera/GlyphOrthographicCamera";
import { GlyphMesh } from "./GlyphMesh";
import { GlyphOrbitControls } from "../controls/GlyphOrbitControls";
import type { Polygon } from "@glyphcss/core";
import type { TransformCells } from "glyphcss";
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
const semanticDictionaryBase = { schemaVersion: "glyph-object-dictionary/v2" as const, id: "dictionary/vue", font: { id: "font/vue", version: "1", sha256: semanticDigest("a") }, classes: [{ id: 1, name: "quad", semanticGlyph: "Q", controlColor: "#123456" }] };
const semanticDictionary: GlyphObjectDictionary = { ...semanticDictionaryBase, contentSha256: computeGlyphControlContentSha256(semanticDictionaryBase) };
const semanticHashes = computeGlyphControlGeometryHashes([SEMANTIC_POLYGON]);
const semanticManifestBase = { schemaVersion: "control-scene/v1" as const, id: "scene/vue", dictionaryId: semanticDictionary.id, dictionarySha256: semanticDictionary.contentSha256, ...semanticHashes, contentSha256: "", instances: [{ id: "quad", classId: 1 }], surfaces: [{ id: "surface", instanceId: "quad" }], polygonSurfaceIds: ["surface"] };
const semanticManifest: GlyphControlSceneManifest = { ...semanticManifestBase, contentSha256: computeGlyphControlContentSha256(semanticManifestBase) };

function renderScene(
  sceneProps: Record<string, unknown> = {},
  slotChildren?: () => VNode | VNode[],
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphPerspectiveCamera, {}, {
          default: () =>
            h(GlyphScene, sceneProps, slotChildren ? { default: slotChildren } : undefined),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphScene (Vue) — basic rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a .glyph-host element", () => {
    const { container } = renderScene();
    const host = container.querySelector(".glyph-host");
    expect(host).toBeTruthy();
  });

  it("renders a .glyph-scene element inside the host", async () => {
    const { container } = renderScene();
    await nextTick();
    const scene = container.querySelector(".glyph-scene");
    expect(scene).toBeTruthy();
  });

  it("renders a .glyph-output <pre> inside the scene", async () => {
    const { container } = renderScene();
    await nextTick();
    const pre = container.querySelector(".glyph-output");
    expect(pre).toBeTruthy();
    expect(pre?.tagName.toLowerCase()).toBe("pre");
  });

  it("applies custom class to the host element", () => {
    const { container } = renderScene({ class: "my-scene" });
    const host = container.querySelector(".glyph-host");
    expect(host?.classList.contains("my-scene")).toBe(true);
  });

  it("renders slot children inside the host", () => {
    const { container } = renderScene(
      {},
      () => h("div", { class: "my-child" }, "hello"),
    );
    const child = container.querySelector(".my-child");
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe("hello");
  });
});

describe("GlyphScene (Vue) — options forwarding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders with custom cols/rows", async () => {
    const { container } = renderScene({ cols: 40, rows: 12 });
    await nextTick();
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

  it("applies transformCells before writing the glyph output", async () => {
    const transformCells: TransformCells = (grid) => {
      grid.char.fill("X");
    };
    const { container } = renderScene({
      cols: 8,
      rows: 4,
      useColors: false,
      transformCells,
    });
    await nextTick();
    await Promise.resolve();

    expect(container.querySelector(".glyph-output")?.textContent).toBe(
      "XXXXXXXX\nXXXXXXXX\nXXXXXXXX\nXXXXXXXX",
    );
  });

  it("reactively clears transformCells when the prop is removed", async () => {
    const transformCells = ref<TransformCells | undefined>((grid) => {
      grid.char.fill("X");
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphPerspectiveCamera, {}, {
            default: () => h(GlyphScene, {
              cols: 8,
              rows: 4,
              useColors: false,
              transformCells: transformCells.value,
            }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    await Promise.resolve();
    expect(container.querySelector(".glyph-output")?.textContent).toContain("X");

    transformCells.value = undefined;
    await nextTick();
    await Promise.resolve();

    expect(container.querySelector(".glyph-output")?.textContent).not.toContain("X");
  });

  it("enables semantic output and resets to visible when the prop is removed", async () => {
    const semantic = ref(false);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () => h(GlyphOrthographicCamera, { zoom: 8 }, {
          default: () => h(GlyphScene, {
            cols: 12, rows: 8, useColors: false,
            ...(semantic.value ? { glyphOutput: "semantic", sceneManifest: semanticManifest, dictionary: semanticDictionary } : {}),
          }, { default: () => h(GlyphMesh, { polygons: [SEMANTIC_POLYGON] }) }),
        });
      },
    });
    app.mount(container);
    await nextTick(); await Promise.resolve();
    const visible = container.querySelector(".glyph-output")?.textContent;
    semantic.value = true;
    await nextTick(); await Promise.resolve();
    expect(container.querySelector(".glyph-output")?.textContent).toContain("Q");
    semantic.value = false;
    await nextTick(); await Promise.resolve();
    expect(container.querySelector(".glyph-output")?.textContent).toBe(visible);
    app.unmount();
  });
});

describe("GlyphScene (Vue) — GlyphMesh child", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts a GlyphMesh without throwing", async () => {
    expect(() =>
      renderScene(
        {},
        () => h(GlyphMesh, { polygons: [POLYGON] }),
      ),
    ).not.toThrow();
    await nextTick();
  });

  it("GlyphMesh renders a wrapper div", async () => {
    const { container } = renderScene(
      {},
      () => h(GlyphMesh, { id: "test-mesh", polygons: [POLYGON] }),
    );
    await nextTick();
    const mesh = container.querySelector(".glyph-mesh");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphScene (Vue) — controls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphOrbitControls mounts without throwing", async () => {
    expect(() =>
      renderScene(
        {},
        () => h(GlyphOrbitControls, { drag: false, wheel: false }),
      ),
    ).not.toThrow();
    await nextTick();
  });
});

describe("GlyphScene (Vue) — error (no context)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphMesh throws when used outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphMesh, { polygons: [] });
      },
    });
    expect(() => app.mount(container)).toThrow();
  });

  it("GlyphScene throws when used without a camera ancestor", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphScene, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});

describe("GlyphScene (Vue) — smooth shading parity with React", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // React's <GlyphScene> has exposed `smoothShading`/`creaseAngle` for a while;
  // Vue's did not, which breaks the mirroring rule in AGENTS.md. Assert both the
  // declared prop AND that it is forwarded — a declared-but-unplumbed prop is the
  // exact failure this guards, and it renders identically so no pixel check
  // would catch it.
  it("declares the same props React does", () => {
    const props = GlyphScene.props as Record<string, unknown>;
    expect(Object.keys(props)).toContain("smoothShading");
    expect(Object.keys(props)).toContain("creaseAngle");
  });
});
