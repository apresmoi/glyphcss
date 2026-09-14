// @vitest-environment node
// D3 fix round 1, P1-2 — per-node effect targeting's own acceptance
// criterion (PLAN-3d.md §11's D3 acceptance: "highlighting one node's mesh
// leaves the others unchanged"). Exercises the SAME primitives
// `Diagrams3DViewport.tsx` mounts (`createGlyphScene` + `glyphDiagramObject`
// + `scene.addEffectLayer({ target: handle.meshes.get("node:<id>") })`)
// directly, with no React — the property under test is glyphcss's own
// per-object targeting mechanism (`CellGrid.winnerMesh`-scoped
// `targetCoverage`, AGENTS.md "Per-object targeting"), not any page wiring.
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const removeChild = window.Node.prototype.removeChild;
  window.Node.prototype.removeChild = function(child) {
    try { return removeChild.call(this, child); }
    catch (error) {
      if (error instanceof window.DOMException && error.message.includes("removeChild")) throw new window.DOMException(error.message, "NotFoundError");
      throw error;
    }
  };
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "DOMException", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { expect, it, vi } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { renderGlyphDiagram3d } from "@glyphcss/diagrams/3d";
import { glyphGraphFromJson } from "@glyphcss/diagrams";
import { getGlyphEffect, defaultGlyphEffectParams } from "@glyphcss/effects";

const GRAPH = glyphGraphFromJson({
  nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  direction: "TB",
});

async function renderWithTarget(targetNodeId: string | null): Promise<string> {
  const fit = await renderGlyphDiagram3d(GRAPH, { layout: "layered", zBy: "none", target: "web", width: 96, height: 40 });
  const camera = fit.camera.mat
    ? createGlyphOrthographicCamera({ mat: [...fit.camera.mat], useMat: true, zoom: fit.camera.zoom })
    : createGlyphOrthographicCamera({ rotX: fit.camera.rotX, rotY: fit.camera.rotY, zoom: fit.camera.zoom });
  const bounds = fit.object.bounds;
  camera.target = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
  const host = document.createElement("div");
  const scene = createGlyphScene(host, { cols: 96, rows: 40, mode: "solid", useColors: true, camera });
  const handle = scene.addObject(fit.object);
  if (targetNodeId) {
    // "glitch" (one of the curated 3, `DiagramsDock.tsx`'s own
    // `DIAGRAMS_3D_EFFECT_IDS`) paints purely from `context.target.coverage`
    // + a deterministic hash of `(cell index, time)` — no domain-coordinate/
    // UV dependency a plain box mesh may not carry, so it is the most
    // reliable of the three for asserting the TARGETING mechanism itself.
    const definition = getGlyphEffect("glitch")!;
    const layer = scene.addEffectLayer({ effect: definition, params: { ...defaultGlyphEffectParams(definition), time: 0.5 }, target: handle.meshes.get(`node:${targetNodeId}`) });
    expect(layer).toBeDefined();
  }
  scene.rerender();
  const text = scene.output.textContent ?? "";
  scene.destroy();
  return text;
}

function diffIndices(a: string, b: string): Set<number> {
  const indices = new Set<number>();
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) indices.add(i);
  return indices;
}

it("targeting one node's own mesh changes only that node's own cells, never another node's", async () => {
  const baseline = await renderWithTarget(null);
  const targetedA = await renderWithTarget("a");
  const targetedB = await renderWithTarget("b");

  const diffA = diffIndices(baseline, targetedA);
  const diffB = diffIndices(baseline, targetedB);

  // Mutation: mount the effect with no `target` (scene-wide) → `diffA`
  // covers node b's/c's cells too, so this intersection check reddens.
  expect(diffA.size, "targeting node a should paint SOMETHING").toBeGreaterThan(0);
  expect(diffB.size, "targeting node b should paint SOMETHING").toBeGreaterThan(0);
  const intersection = [...diffA].filter((i) => diffB.has(i));
  expect(intersection, "cells changed by targeting a must be disjoint from cells changed by targeting b").toEqual([]);
}, 20_000);
