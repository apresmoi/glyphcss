// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import examples from "../data/examples.json";
import docs from "../../../../../packages/diagrams/fixtures/mermaid-12.json";
import additions from "../../../../../packages/diagrams/fixtures/mermaid-12-additions.json";

mermaid.initialize({ startOnLoad: false });

describe("showcases use Mermaid 12.2 syntax", () => {
  it.each(examples)(
    "parses $type with Mermaid's own parser",
    async ({ source }) => {
      expect(await mermaid.parse(source)).toHaveProperty("diagramType");
    },
  );

  it.each([...docs, ...additions])(
    "parses reader regression $name with Mermaid\'s own parser",
    async ({ source }) => {
      expect(await mermaid.parse(source)).toHaveProperty("diagramType");
    },
  );

  it.each([
    "flowchart TB\nA --> --> ]]",
    "radar\naxis a,b,c\ncurve x{1,2,3}",
    "requirementDiagram\nrequirement r {\nid: 1\nrisk: extreme\n}",
  ])("rejects malformed syntax %s", async (source) => {
    await expect(mermaid.parse(source)).rejects.toThrow();
  });
});
