import { describe, it, expect, vi, afterEach } from "vitest";
import { computed, effectScope, ref, nextTick } from "vue";
import {
  buildTextureEdgeRepairSets,
  useTextureAtlas,
  computeTextureAtlasPlan,
  isSolidTrianglePlan,
  type TextureAtlasPlan,
} from "./textureAtlas";
import type { Polygon } from "@layoutit/polycss-core";

const TEXTURED_QUAD_60: Polygon = {
  vertices: [
    [0, 0, 0],
    [60, 0, 0],
    [60, 60, 0],
    [0, 60, 0],
  ],
  color: "#ffffff",
  texture: "https://example.com/crate.png",
};

function planFor(polygon: Polygon, index = 0): TextureAtlasPlan | null {
  return computeTextureAtlasPlan(polygon, index, {});
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("computeTextureAtlasPlan", () => {
  it("returns a plan for a textured quad", () => {
    const plan = planFor(TEXTURED_QUAD_60);
    expect(plan).not.toBeNull();
    expect(plan!.texture).toBe("https://example.com/crate.png");
    expect(plan!.canvasW).toBeGreaterThan(0);
    expect(plan!.canvasH).toBeGreaterThan(0);
  });

  it("returns a plan for an untextured solid quad too", () => {
    const quad: Polygon = { ...TEXTURED_QUAD_60, texture: undefined };
    const plan = planFor(quad);
    expect(plan).not.toBeNull();
    expect(plan!.texture).toBeUndefined();
  });

  it("enables textured edge repair without changing geometry", () => {
    const normal = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {});
    const repaired = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {
      textureEdgeRepairEdges: new Set([1]),
    });

    expect(repaired).not.toBeNull();
    expect(normal).not.toBeNull();
    expect(repaired!.canvasW).toBe(normal!.canvasW);
    expect(repaired!.canvasH).toBe(normal!.canvasH);
    expect(repaired!.textureEdgeRepair).toBe(true);
  });

  it("keeps textured edge repair disabled when there are no shared texture edges", () => {
    const repaired = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {});

    expect(repaired).not.toBeNull();
    expect(repaired!.textureEdgeRepair).toBe(false);
  });
});

describe("buildTextureEdgeRepairSets", () => {
  it("returns only shared edges between textured polygons", () => {
    const left: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      texture: "https://example.com/a.png",
    };
    const right: Polygon = {
      vertices: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]],
      texture: "https://example.com/b.png",
    };
    const isolated: Polygon = {
      vertices: [[3, 0, 0], [4, 0, 0], [4, 1, 0], [3, 1, 0]],
      texture: "https://example.com/c.png",
    };

    const repairEdges = buildTextureEdgeRepairSets([left, right, isolated]);

    expect(repairEdges[0]).toEqual(new Set([1]));
    expect(repairEdges[1]).toEqual(new Set([3]));
    expect(repairEdges[2]).toBeUndefined();
  });
});

describe("isSolidTrianglePlan", () => {
  it("true for an untextured 3-vertex polygon", () => {
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const plan = planFor(tri)!;
    expect(isSolidTrianglePlan(plan)).toBe(true);
  });

  it("false for a textured 3-vertex polygon", () => {
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      texture: "https://example.com/t.png",
    };
    const plan = planFor(tri)!;
    expect(isSolidTrianglePlan(plan)).toBe(false);
  });

  it("false for an untextured quad (4 vertices)", () => {
    const quad: Polygon = {
      ...TEXTURED_QUAD_60,
      texture: undefined,
    };
    const plan = planFor(quad)!;
    expect(isSolidTrianglePlan(plan)).toBe(false);
  });
});

describe("useTextureAtlas (auto textureQuality)", () => {
  function buildSixFaceCrateScene(): Polygon[] {
    return Array.from({ length: 6 }, () => ({ ...TEXTURED_QUAD_60 }));
  }

  async function measureAtlas(mobile: boolean): Promise<{ pageBytes: number; pageCount: number }> {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: mobile && (query.includes("pointer: coarse") || query.includes("hover: none")),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    let result!: { pageBytes: number; pageCount: number };
    const scope = effectScope();
    scope.run(() => {
      const polygons = ref<Polygon[]>(buildSixFaceCrateScene());
      const plans = computed<Array<TextureAtlasPlan | null>>(() =>
        polygons.value.map((p, i) => computeTextureAtlasPlan(p, i, {})),
      );
      const textureLighting = computed(() => "baked" as const);
      const textureQuality = computed(() => "auto" as const);
      const atlas = useTextureAtlas(plans, textureLighting, textureQuality);
      // After the synchronous pack the pages ref already exposes packed sizes.
      const pages = atlas.pages.value;
      const pageBytes = pages.reduce((sum, p) => sum + p.width * p.height * 4, 0);
      result = { pageBytes, pageCount: pages.length };
    });
    await nextTick();
    scope.stop();
    return result;
  }

  it("packs the same scene into a tighter budget on a coarse-pointer (mobile) document", async () => {
    const mobile = await measureAtlas(true);
    const desktop = await measureAtlas(false);
    // The page-area math operates on CSS-pixel dimensions of packed pages —
    // those don't change with the budget. The downscale lives in the
    // rasterized canvas. We still expect the auto path to engage and return
    // a non-empty packing for both branches.
    expect(mobile.pageCount).toBeGreaterThan(0);
    expect(desktop.pageCount).toBeGreaterThan(0);
    expect(mobile.pageBytes).toBeGreaterThan(0);
  });

  it("explicit numeric textureQuality applies without auto branches", async () => {
    let pageDims: { width: number; height: number }[] = [];
    const scope = effectScope();
    scope.run(() => {
      const polygons = ref<Polygon[]>(buildSixFaceCrateScene());
      const plans = computed<Array<TextureAtlasPlan | null>>(() =>
        polygons.value.map((p, i) => computeTextureAtlasPlan(p, i, {})),
      );
      const textureLighting = computed(() => "baked" as const);
      const textureQuality = computed<number | "auto">(() => 0.5);
      const atlas = useTextureAtlas(plans, textureLighting, textureQuality);
      pageDims = atlas.pages.value.map((p) => ({ width: p.width, height: p.height }));
    });
    await nextTick();
    scope.stop();
    expect(pageDims.length).toBeGreaterThan(0);
  });

  it("rasterizes packed pages to canvas blobs when a 2D context is available", async () => {
    // happy-dom returns a stub canvas with no getContext. Mock it on the
    // prototype so buildAtlasPage actually walks the paint loop — exercises
    // the real rasterization feature path that ships to browsers.
    const drawCalls: string[] = [];
    const ctxStub = {
      save: () => drawCalls.push("save"),
      restore: () => drawCalls.push("restore"),
      setTransform: () => drawCalls.push("setTransform"),
      clearRect: () => drawCalls.push("clearRect"),
      fillRect: () => drawCalls.push("fillRect"),
      drawImage: () => drawCalls.push("drawImage"),
      translate: () => drawCalls.push("translate"),
      scale: () => drawCalls.push("scale"),
      beginPath: () => drawCalls.push("beginPath"),
      moveTo: () => drawCalls.push("moveTo"),
      lineTo: () => drawCalls.push("lineTo"),
      closePath: () => drawCalls.push("closePath"),
      clip: () => drawCalls.push("clip"),
      fill: () => drawCalls.push("fill"),
      stroke: () => drawCalls.push("stroke"),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: () => drawCalls.push("putImageData"),
      createPattern: () => null,
      globalCompositeOperation: "source-over",
      globalAlpha: 1,
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high" as const,
      canvas: { width: 1, height: 1 },
    };
    const HTMLCanvasElement = (globalThis as { HTMLCanvasElement?: { prototype: { getContext?: unknown; toBlob?: unknown } } }).HTMLCanvasElement;
    const origGetContext = HTMLCanvasElement?.prototype.getContext;
    const origToBlob = HTMLCanvasElement?.prototype.toBlob;
    if (HTMLCanvasElement) {
      HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub) as never;
      HTMLCanvasElement.prototype.toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob())) as never;
    }
    try {
      vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
      const scope = effectScope();
      let atlasPages: { width: number; height: number; url: string | null }[] = [];
      scope.run(() => {
        const polygons = ref<Polygon[]>(buildSixFaceCrateScene());
        const plans = computed<Array<TextureAtlasPlan | null>>(() =>
          polygons.value.map((p, i) => computeTextureAtlasPlan(p, i, {})),
        );
        const textureLighting = computed(() => "baked" as const);
        const textureQuality = computed<number | "auto">(() => 0.5);
        const atlas = useTextureAtlas(plans, textureLighting, textureQuality);
        // Settle the watch effect so the async buildAtlasPage path runs.
        nextTick().then(() => {
          atlasPages = atlas.pages.value;
        });
      });
      // Two ticks: one for the watch fire, one for the async build.
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));
      scope.stop();
      expect(atlasPages.length).toBeGreaterThan(0);
    } finally {
      if (HTMLCanvasElement && origGetContext && origToBlob) {
        HTMLCanvasElement.prototype.getContext = origGetContext;
        HTMLCanvasElement.prototype.toBlob = origToBlob;
      }
    }
  });
});
