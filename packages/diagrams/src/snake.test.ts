/**
 * The snake layout (`snake.ts`): a left-to-right graph too wide for its
 * budget wraps its main path into rows like text, with whole words, and
 * hangs every other node under the main-path node it connects to.
 */
import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid } from "./mermaid";
import { measureGlyphGraph } from "./pipeline";
import { renderGlyphDiagram } from "./render";
import { glyphDiagramSnakeLayout } from "./snake";

const deploy = `flowchart LR
  push[Push] --> ci[Run tests]
  ci --> ok{Tests pass?}
  ok -->|yes| build[Build image]
  ok -->|no| fix[Fix code]
  fix --> push
  build --> staging[Deploy staging]
  staging --> prod[Deploy prod]`;
const chat = { width: 72, height: 24, target: "chat", charset: "box", color: "none", autoDirection: true, detail: "faithful", overflow: "paginate" } as const;

describe("snake layout", () => {
  it("wraps a path too wide for chat into rows instead of cutting words", async () => {
    // Mutation: drop the snake from the fitter -> the fit cuts "Deploy" into "Deplo"/"y".
    const r = await renderGlyphDiagram(deploy, chat);
    expect(r.pages).toHaveLength(1);
    expect(r.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    for (const label of ["Push", "Run tests", "Tests pass?", "Build image", "Fix code", "Deploy staging", "Deploy prod", "yes", "no"]) expect(r.text, label).toContain(label);
    expect(r.report.unroutable).toEqual([]);
  });

  it("keeps the main path in reading order and hangs the branch under its anchor", async () => {
    const r = await renderGlyphDiagram(deploy, chat);
    const at = (id: string) => r.layout.nodes.find((n) => n.id === id)!;
    const row = ["push", "ci", "ok", "build"];
    for (const id of row) expect(at(id).y0, id).toBe(at("push").y0);
    for (let i = 1; i < row.length; i++) expect(at(row[i]!).x0).toBeGreaterThan(at(row[i - 1]!).x1);
    expect(at("staging").y0).toBeGreaterThan(at("fix").y1);
    expect(at("staging").x0).toBeLessThan(at("build").x0);
    // Mutation: centre the branch by box instead of by port -> the drop jogs a column.
    const drop = r.layout.ports.filter((p) => p.edgeId.includes('"ok","fix"'));
    expect(drop.map((p) => p.side).sort()).toEqual(["n", "s"]);
    expect(drop[0]!.anchor.x).toBe(drop[1]!.anchor.x);
  });

  it("declines graphs it cannot wrap: groups, or a main path under three nodes", () => {
    const grouped = measureGlyphGraph(glyphGraphFromMermaid("flowchart LR\n  subgraph g [G]\n    a --> b\n  end\n  b --> c --> d"), { direction: "LR" });
    expect(glyphDiagramSnakeLayout(grouped, { width: 20, gap: 4, margin: 1 })).toBeUndefined();
    const short = measureGlyphGraph(glyphGraphFromMermaid("flowchart LR\n  a --> b"), { direction: "LR" });
    expect(glyphDiagramSnakeLayout(short, { width: 20, gap: 4, margin: 1 })).toBeUndefined();
  });
});
