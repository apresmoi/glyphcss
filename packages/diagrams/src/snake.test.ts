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
import { routeGlyphGraphEdges } from "./route";

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

  it("slides a crowded hanging row left, keeps a branch's own chain after it, and fits a fan-out in chat", async () => {
    // Mutation: hang each branch only straight under its anchor (no pull-back
    // from the right edge), or re-anchor followers to the top anchor -> red.
    const arch = `flowchart LR
  client[Browser] --> gw[API gateway]
  gw --> auth[Auth service]
  auth -->|ok| orders[Orders]
  auth -->|ok| pay[Payments]
  auth -->|ok| inv[Inventory]
  auth -->|denied| err[401 page]
  orders --> db[(Postgres)]
  pay --> db
  inv --> db
  pay --> stripe[Stripe API]`;
    const r = await renderGlyphDiagram(arch, chat);
    expect(r.pages).toHaveLength(1);
    expect(r.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    for (const word of ["Browser", "gateway", "service", "Payments", "Stripe", "Inventory", "Postgres", "denied"]) expect(r.text, word).toContain(word);
    const at = (id: string) => r.layout.nodes.find((n) => n.id === id)!;
    expect(at("stripe").y0).toBe(at("pay").y0);
    expect(at("stripe").x0).toBeGreaterThan(at("pay").x1);
  });

  it("lines a hanging node's entry up under the exit feeding it, even when the row is too crowded to slide the box there", () => {
    // Mutation: drop `straightenDrops` -> "In stock?" has two bottom exits,
    // the Backorder drop jogs across the wrap edge's and neither routes.
    const order = glyphGraphFromMermaid(`flowchart LR
  order[New order] --> validate[Validate cart]
  validate --> stock{In stock?}
  stock -->|yes| charge[Charge card]
  stock -->|no| backorder[Backorder]
  backorder --> notify[Email customer]
  charge --> paid{Paid?}
  paid -->|no| retry[Retry payment]
  retry --> charge
  paid -->|yes| pack[Pack box]
  pack --> ship[Ship]
  ship --> done[Delivered]`);
    const raw = glyphDiagramSnakeLayout(measureGlyphGraph(order, { direction: "LR", labelWidth: 18 }), { width: 72, gap: 4, margin: 1, branchGap: 3, rowGap: 3 })!;
    const drop = raw.ports.filter((p) => p.edgeId.includes('"stock","backorder"'));
    expect(drop[0]!.anchor.x).toBe(drop[1]!.anchor.x);
    expect(routeGlyphGraphEdges(raw, { width: raw.width, height: raw.height }).unroutable).toEqual([]);
  });

  it("declines graphs it cannot wrap: groups, or a main path under three nodes", () => {
    const grouped = measureGlyphGraph(glyphGraphFromMermaid("flowchart LR\n  subgraph g [G]\n    a --> b\n  end\n  b --> c --> d"), { direction: "LR" });
    expect(glyphDiagramSnakeLayout(grouped, { width: 20, gap: 4, margin: 1, branchGap: 3, rowGap: 3 })).toBeUndefined();
    const short = measureGlyphGraph(glyphGraphFromMermaid("flowchart LR\n  a --> b"), { direction: "LR" });
    expect(glyphDiagramSnakeLayout(short, { width: 20, gap: 4, margin: 1, branchGap: 3, rowGap: 3 })).toBeUndefined();
  });
});
