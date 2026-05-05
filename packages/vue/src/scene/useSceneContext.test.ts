import { describe, it, expect } from "vitest";
import { ref, computed } from "vue";
import { createApp, h } from "vue";
import { useSceneContext } from "./useSceneContext";
import type { UseSceneContextResult } from "./useSceneContext";
import type { Polygon } from "@polycss/core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const QUAD: Polygon = {
  vertices: [
    [0, 0, 0],
    [2, 0, 0],
    [2, 2, 0],
    [0, 2, 0],
  ],
  color: "#00ff00",
};

function captureSceneContext(
  polygons: Polygon[],
  options: { merge?: "off" | "auto" } = {}
): UseSceneContextResult {
  let captured!: UseSceneContextResult;
  const container = document.createElement("div");
  const polygonsRef = ref<Polygon[]>(polygons);
  const optionsRef = computed(() => options);
  const app = createApp({
    setup() {
      const result = useSceneContext(polygonsRef, optionsRef);
      captured = result.value;
      return () => h("div");
    },
  });
  app.mount(container);
  return captured!;
}

describe("useSceneContext", () => {
  it("returns empty polygons and valid bbox for empty input", () => {
    const result = captureSceneContext([]);
    expect(result.polygons).toEqual([]);
    expect(result.sceneBbox).toBeDefined();
    expect(result.sceneBbox.min).toBeDefined();
    expect(result.sceneBbox.max).toBeDefined();
  });

  it("returns polygons for valid input (merge=off)", () => {
    const result = captureSceneContext([TRIANGLE], { merge: "off" });
    expect(result.polygons.length).toBeGreaterThan(0);
  });

  it("returns sceneBbox reflecting polygon extents", () => {
    const result = captureSceneContext([TRIANGLE]);
    expect(result.sceneBbox.min[0]).toBeCloseTo(0, 3);
    expect(result.sceneBbox.max[0]).toBeCloseTo(1, 3);
  });

  it("passes through 2 polygons when merge='off'", () => {
    const result = captureSceneContext([TRIANGLE, QUAD], { merge: "off" });
    expect(result.polygons.length).toBe(2);
  });

  it("merge='auto' still returns polygons (may reduce count)", () => {
    const result = captureSceneContext([TRIANGLE, QUAD], { merge: "auto" });
    expect(result.polygons.length).toBeGreaterThan(0);
  });

  it("sceneBbox covers multiple polygons", () => {
    const result = captureSceneContext([TRIANGLE, QUAD]);
    expect(result.sceneBbox.max[0]).toBeCloseTo(2, 3);
  });

  it("returns a reactive computed ref that updates when polygons change", () => {
    const polygonsRef = ref<Polygon[]>([TRIANGLE]);
    const optionsRef = computed(() => ({ merge: "off" as const }));
    let capturedRef: ReturnType<typeof useSceneContext> | null = null;

    const container = document.createElement("div");
    const app = createApp({
      setup() {
        capturedRef = useSceneContext(polygonsRef, optionsRef);
        return () => h("div");
      },
    });
    app.mount(container);

    expect(capturedRef!.value.polygons.length).toBe(1);

    polygonsRef.value = [TRIANGLE, QUAD];
    expect(capturedRef!.value.polygons.length).toBe(2);
  });
});
