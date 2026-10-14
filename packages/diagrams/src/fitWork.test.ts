import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Preserve the existing balanced-BK work guarantees at their original bounds.
// The combined default + four-alignment search is checked in fitAlignment.test.ts.
vi.mock("./fitAlignment", async importOriginal => {
  const real = await importOriginal<typeof import("./fitAlignment")>();
  return { ...real, GLYPH_DIAGRAM_DAGRE_ALIGNMENTS: [] };
});

// Counts the snake layouts the fitter asks for, a measure of its work that does not depend on how fast the machine is.
vi.mock("./snake", async (importOriginal) => {
  const real = await importOriginal<typeof import("./snake")>();
  return { ...real, glyphDiagramSnakeLayout: vi.fn(real.glyphDiagramSnakeLayout) };
});
vi.mock("./pipeline", async (importOriginal) => {
  const real = await importOriginal<typeof import("./pipeline")>();
  return { ...real, layoutGlyphGraph: vi.fn(real.layoutGlyphGraph) };
});
vi.mock("./route", async (importOriginal) => {
  const real = await importOriginal<typeof import("./route")>();
  return { ...real, routeGlyphGraphEdges: vi.fn(real.routeGlyphGraphEdges) };
});
import { glyphDiagramSnakeLayout } from "./snake";
import { layoutGlyphGraph } from "./pipeline";
import { renderGlyphDiagram } from "./render";
import { routeGlyphGraphEdges } from "./route";
import { computeGlyphDiagramQuality } from "./quality";

const chain = (nodes: number, loops: readonly number[]) => `flowchart LR\n${Array.from({ length: nodes }, (_, i) => `n${i}[Node ${i}]`).join(" --> ")}\n${loops.map((at, i) => `n${at} -->|retry step ${i}| n${at}`).join("\n")}\n`;
const work = async (source: string, options: Parameters<typeof renderGlyphDiagram>[1]) => {
  vi.mocked(glyphDiagramSnakeLayout).mockClear();
  const r = await renderGlyphDiagram(source, { target: "chat", autoDirection: false, detail: "faithful", ...options });
  return { r, calls: vi.mocked(glyphDiagramSnakeLayout).mock.calls.length };
};

describe("the snake search does a bounded amount of work with loops", () => {
  // Counts are exact for a given search, so each bound sits just above today's and below what dropping a bound produces. Before the search was bounded the same graphs took 15 s to 4 minutes.
  it("14 nodes with 2 loops at 72x24", async () => {
    const { r, calls } = await work(chain(14, [1, 7]), { width: 72, height: 24, overflow: "paginate" });
    expect(r.pages).toHaveLength(1);
    expect(calls).toBeLessThan(CALLS.fourteen);
  });
  it("15 nodes with 3 loops at 72x24", async () => {
    const { r, calls } = await work(chain(15, [0, 5, 10]), { width: 72, height: 24, overflow: "paginate" });
    expect(r.pages).toHaveLength(1);
    expect(calls).toBeLessThan(CALLS.fifteen);
  });
  it("12 nodes with a loop on each, expanding", async () => {
    const { calls } = await work(chain(12, Array.from({ length: 12 }, (_, i) => i)), { width: 40, height: 20, overflow: "expand" });
    expect(calls).toBeLessThan(CALLS.twelve);
  });
  it("5 nodes with 4 loops in a tight canvas", async () => {
    const { calls } = await work(chain(5, [0, 1, 2, 3]), { width: 40, height: 12, overflow: "paginate" });
    expect(calls).toBeLessThan(CALLS.five);
  });
});
// Today: 13, 401, 962 and 1276 layouts. The snake now searches every loop wrap that could fit and keeps looking for a snake of the requested
// height while expanding, so the last two are higher than when it took three wraps and stopped at three tall candidates (485, 1108). Dropping
// the cheap height check that keeps it from routing hopeless candidates gives 5860 for the twelve; enumerating branch gaps gives 513 and 18644.
const CALLS = { fourteen: 20, fifteen: 450, twelve: 1050, five: 1350 };

describe("the layout search prunes loop wraps by the stacked footprint", () => {
  it("tries few layouts when stacked loops cannot fit the height at any wrap", async () => {
    // Mutation: size each node's loops by their tallest label alone (drop the stacked rows from `footprint`) -> far more wraps survive and are laid out.
    vi.mocked(layoutGlyphGraph).mockClear();
    const source = "flowchart TB\nA[Processor] -->|one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen| A\nA -->|retry after the backoff window until success with delay forever| A";
    await renderGlyphDiagram(source, { target: "chat", width: 39, height: 7, autoDirection: false, overflow: "paginate", detail: "faithful" });
    expect(vi.mocked(layoutGlyphGraph).mock.calls.length).toBeLessThan(LAYOUTS);
  });
});
// Today 231 layouts; without the stacked rows 735.
const LAYOUTS = 300;

// Hashes pin approved output; the count bound must fail when the spacing-first probe is removed.
describe("expansion repairs spacing before repeating exterior gutters", () => {
  it("event-queue considers cheaper gutters of already-probed spacing candidates", async () => {
    const source = readFileSync(resolve(__dirname, "../fixtures/event-queue.mmd"), "utf8");
    const result = await renderGlyphDiagram(source, {
      width: 60, height: 24, target: "chat", charset: "box", color: "none", autoDirection: true, detail: "faithful", overflow: "expand",
    });
    expect(result.pages).toHaveLength(1);
    // Clean cylinders save one row; the reviewed output has one crossing and no semantic loss.
    expect(computeGlyphDiagramQuality(result, { width: 60, height: 24 })).toMatchObject({
      wordCuts: 0, crossings: 1, droppedEdges: 0, droppedLabels: 0,
    });
    expect(result.canvas.grid).toMatchObject({ cols: 60, rows: 33 });
    expect(createHash("sha256").update(JSON.stringify(result.pages.map(page => page.text))).digest("hex"))
      .toBe("ed4757e6bdd04a45136ee40352ab5a5b6b268922a5b9ecbe317413ee6fba18db");
  });
  it.each([
    ["galaxy-sources-to-model", 24, "e40003730a21b65eb449231c56f0924a608dc6a85a02bf4a6d062a4bdd20c441", 350, 900_000],
    ["galaxy-sources-h60", 60, "73412184ca223fe59d25c54a2df17bd6f8c9db371f85e24f09551e6712c034c8", 110, 75_000],
  ] as const)("%s keeps its text within routing and A* work bounds", async (name, height, hash, routingBound, stateBound) => {
    const source = readFileSync(resolve(__dirname, `../bench/corpus/${name}.mmd`), "utf8");
    vi.mocked(routeGlyphGraphEdges).mockClear();
    // A routing-call bound alone misses exhaustive A* inside each gutter.
    // Count best-cost state writes, identified by the router's x,y,direction key.
    let states = 0;
    const set = Map.prototype.set;
    const spy = vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (typeof key === "string" && /^-?\d+,-?\d+,[0-3]$/.test(key)) states++;
      return set.call(this, key, value);
    });
    let result: Awaited<ReturnType<typeof renderGlyphDiagram>>;
    try {
      result = await renderGlyphDiagram(source, {
        width: 72, height, target: "chat", charset: "box", color: "none", autoDirection: true, detail: "faithful", overflow: "expand",
      });
    } finally { spy.mockRestore(); }
    expect(computeGlyphDiagramQuality(result, { width: 72, height })).toMatchObject({
      wordCuts: 0, crossings: 0,
      droppedEdges: 0, droppedLabels: 0, pages: 1,
    });
    expect(result.pages).toHaveLength(1);
    expect(createHash("sha256").update(JSON.stringify(result.pages.map(page => page.text))).digest("hex")).toBe(hash);
    expect(vi.mocked(routeGlyphGraphEdges).mock.calls.length).toBeLessThan(routingBound);
    expect(states).toBeLessThan(stateBound);
  }, 180_000);
});
