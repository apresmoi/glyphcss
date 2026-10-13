import { describe, expect, it } from "vitest";
import { glyphDiagramCompactionFloor } from "./degrade";
import { glyphGraphFromMermaid } from "./mermaid";
import { renderGlyphDiagram } from "./render";

describe("self-loops are not connections that crowd the flow (class)", () => {
  // The count of how many edges meet a node (the compaction floor) is of routed connections only. The search bounds that merely scale with the edge total (repair widening, snake gap enumeration) still include loops: they only widen what is tried, and nothing observable depends on them.
  const graphs = (fan: number) => {
    const flow = ["A --> B", ...Array.from({ length: fan - 1 }, (_, i) => `A --> F${i}`), ...Array.from({ length: fan - 1 }, (_, i) => `G${i} --> A`)];
    return flow.join("\n");
  };
  it("gives the same floor with any number of loops on any node as without them", () => {
    // Mutation: count self-edges in glyphDiagramCompactionFloor -> two loops raise the floor from 3 to 4.
    for (const fan of [1, 2, 3, 4]) {
      const base = glyphDiagramCompactionFloor(glyphGraphFromMermaid(`flowchart TB\n${graphs(fan)}`));
      for (const loops of [1, 2, 3, 5]) for (const host of ["A", "B"]) {
        const looped = `${graphs(fan)}\n${Array.from({ length: loops }, (_, i) => `${host} -->|l${i}| ${host}`).join("\n")}`;
        expect({ fan, loops, host, floor: glyphDiagramCompactionFloor(glyphGraphFromMermaid(`flowchart TB\n${looped}`)) }).toEqual({ fan, loops, host, floor: base });
      }
    }
  });

  it.each(["TB", "LR"] as const)("%s: fits the canvas a looped graph fits without its loops' help", async (direction) => {
    const source = `flowchart ${direction}\nA --> B\nA -->|x| A\nA -->|y| A`;
    const r = await renderGlyphDiagram(source, { target: "chat", width: direction === "TB" ? 20 : 30, height: direction === "TB" ? 13 : 12, autoDirection: false, overflow: "paginate", detail: "faithful" });
    expect(r.pages).toHaveLength(1);
    expect(r.report.unroutable).toEqual([]);
  });
});
