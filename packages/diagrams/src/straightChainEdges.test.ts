import { expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";

const source = (draft: string) => `stateDiagram-v2
  [*] --> ${draft}
  ${draft} --> Review: submit
  Review --> ${draft}: changes
  Review --> Rejected: reject
  Review --> Published: approve
  Published --> [*]
`;

it.each(["chat", "web"] as const)("straightens half-cell state chains in %s without moving the jog to their point entry", async target => {
  for (const width of [48, 72]) for (const draft of ["Draft", "Drafting"]) {
    const options = { target, width, height: 24, autoDirection: true, detail: "faithful" as const, overflow: "expand" as const };
    const result = await renderGlyphDiagram(source(draft), options);
    expect(result.canvas.cols).toBe(width);
    expect(result.canvas.rows).toBe(24);
    expect(result.pages).toHaveLength(1);
    expect(result.routes).toHaveLength(6);
    expect(result.labels.map(label => label.text).sort()).toEqual(["approve", "changes", "reject", "submit"]);
    expect(computeGlyphDiagramQuality(result, options)).toMatchObject({
      crossings: 0, fakeFrames: 0, wordCuts: 0, droppedEdges: 0, droppedLabels: 0,
    });
    // Mutation: restore the point-node exclusion in glyphDiagramStraightenPorts;
    // unequal box parity again leaves two bends on submit (or the start edge).
    for (const [from, to] of [["[*]:start", draft], [draft, "Review"], ["Published", "[*]:end"]]) {
      const route = result.routes.find(route => route.edge.from === from && route.edge.to === to)!;
      const ports = result.layout.ports.filter(port => port.edgeId === route.edge.id);
      expect(new Set([...route.cells, ...ports.map(port => port.anchor)].map(cell => cell.x)).size, `${width}: ${from} -> ${to}`).toBe(1);
    }
    expect((await renderGlyphDiagram(source(draft), options)).text).toBe(result.text);
    if (target === "web") {
      const pre = document.createElement("pre");
      pre.innerHTML = result.html!;
      expect(pre.textContent).toBe(result.text);
    }
  }
});
