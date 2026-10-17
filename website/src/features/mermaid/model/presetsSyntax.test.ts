import { describe, expect, it, vi } from "vitest";
import { glyphParseMermaid } from "../../../../../packages/diagrams/src/mermaid";
import { glyphSequenceFromMermaid } from "../../../../../packages/diagrams/src/sequence/mermaid";
import { glyphChartFromMermaid } from "../../../../../packages/charts/src/mermaid";
import { GLYPH_MERMAID_PRESETS } from "./presets";

vi.mock(
  "@glyphcss/core",
  () => import("../../../../../packages/core/src/index"),
);
const source = (type: string) =>
  GLYPH_MERMAID_PRESETS.find((preset) => preset.type === type)!.source;
const graph = (type: string) => glyphParseMermaid(source(type)).graph;

describe("Mermaid showcases exercise their syntax rather than CLI smoke density", () => {
  it("retains flow decisions, disjoint groups, and solid/dotted/thick edges", () => {
    const g = graph("flowchart");
    expect(g.nodes).toHaveLength(9);
    expect(g.nodes.some((node) => node.shape === "diamond")).toBe(true);
    expect(g.groups).toHaveLength(2);
    expect(
      g.groups![0]!.members.some((id) => g.groups![1]!.members.includes(id)),
    ).toBe(false);
    expect(new Set(g.edges.map((edge) => edge.style))).toEqual(
      new Set(["solid", "dotted", "thick"]),
    );
    expect(g.edges.map((edge) => edge.label).filter(Boolean)).toEqual([
      "yes",
      "no",
    ]);
  });
  it("retains parallel quality gates in graph syntax", () => {
    const g = graph("graph");
    expect(g.nodes).toHaveLength(9);
    expect(g.edges.filter((edge) => edge.to === "gate")).toHaveLength(3);
    expect(g.groups![0]!.members).toEqual(
      expect.arrayContaining(["lint", "unit", "audit", "gate"]),
    );
  });
  it("retains scoped state markers, a composite, choice and note", () => {
    const { graph: g, notes } = glyphParseMermaid(source("stateDiagram"));
    expect(g.groups).toMatchObject([{ id: "Payment" }]);
    expect(g.nodes.filter((node) => node.shape === "point")).toHaveLength(4);
    expect(g.nodes.find((node) => node.id === "Check")?.shape).toBe("diamond");
    expect(g.nodes.find((node) => node.id === "Authorize")?.label).toContain(
      "Key per order",
    );
    expect(g.edges.map((edge) => edge.label)).toEqual(
      expect.arrayContaining(["approved", "refused", "response", "dispatch"]),
    );
    expect(notes.some((note) => note.detail?.kind === "state-note")).toBe(true);
  });
  it("retains sequence actors, alternation, loop, note and numbered messages around inert activations", () => {
    const sequence = glyphSequenceFromMermaid(source("sequenceDiagram"));
    expect(sequence.participants).toHaveLength(4);
    expect(sequence.participants[0]?.shape).toBe("actor");
    expect(sequence.frames?.map((frame) => frame.kind).sort()).toEqual([
      "alt",
      "loop",
    ]);
    expect(
      sequence.frames?.find((frame) => frame.kind === "alt")?.branches,
    ).toMatchObject([{ kind: "else", label: "declined" }]);
    expect(sequence.notes?.[0]?.text).toBe("One key per order");
    expect(sequence.messages).toHaveLength(10);
    expect(sequence.messages[0]?.label).toBe("1. Submit cart");
  });
  it("retains six classes, member compartments, multiplicities and all eight relation operators", () => {
    const g = graph("classDiagram");
    expect(g.nodes).toHaveLength(6);
    expect(g.nodes.every((node) => node.compartments?.length)).toBe(true);
    expect(g.edges).toHaveLength(8);
    expect(
      g.edges.map(({ style, startHead, endHead }) => [
        style,
        startHead,
        endHead,
      ]),
    ).toEqual([
      ["solid", "triangle", "none"],
      ["solid", "none", "arrow"],
      ["solid", "filled-diamond", "none"],
      ["solid", "open-diamond", "none"],
      ["dotted", "none", "triangle"],
      ["dotted", "none", "arrow"],
      ["solid", "none", "none"],
      ["dotted", "none", "none"],
    ]);
    expect(g.edges[1]?.label).toBe("[1] places [*]");
  });
  it("retains five entities, keyed attributes and cardinalities", () => {
    const g = graph("erDiagram");
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(4);
    expect(g.nodes.every((node) => node.compartments?.[0]?.length === 3)).toBe(
      true,
    );
    expect(
      g.nodes.find((node) => node.id === "LINE")?.compartments?.[0],
    ).toContain("int order_id PK,FK");
    expect(new Set(g.edges.map((edge) => edge.endHead)).size).toBeGreaterThan(
      1,
    );
  });
  it("retains a four-level mindmap and separate sibling leaves", () => {
    const g = graph("mindmap");
    expect(g.nodes).toHaveLength(22);
    expect(g.edges).toHaveLength(21);
    const child = (from: string) =>
      g.edges.filter((edge) => edge.from === from).map((edge) => edge.to);
    const root = g.nodes.find((node) => node.label === "Portal launch")!;
    expect(child(root.id)).toHaveLength(3);
    const descendants = child(root.id).flatMap(child).flatMap(child);
    expect(descendants).toHaveLength(12);
  });
  it("retains two feature branches, two merges, cherry-pick provenance and release tags", () => {
    const { graph: g, lanes } = glyphParseMermaid(source("gitGraph"));
    expect(lanes).toBeDefined();
    expect(g.nodes).toHaveLength(9);
    expect(g.edges).toHaveLength(10);
    expect(g.nodes.map((node) => node.label).join("\n")).toContain(
      "cherry-pick",
    );
    expect(source("gitGraph").match(/branch /g)).toHaveLength(2);
    expect(source("gitGraph").match(/merge /g)).toHaveLength(2);
  });
  it("retains a spanning block group and six services inside two architecture groups", () => {
    const blocks = graph("block"),
      architecture = graph("architecture");
    expect(blocks.nodes).toHaveLength(9);
    expect(blocks.groups).toMatchObject([
      { id: "Gateway", members: ["auth", "api", "quota"] },
    ]);
    expect(blocks.edges).toHaveLength(6);
    expect(architecture.nodes).toHaveLength(6);
    expect(architecture.groups).toHaveLength(2);
    expect(architecture.edges).toHaveLength(5);
  });
  it("retains three typed requirements, fields, test and service traces", () => {
    const g = graph("requirementDiagram");
    expect(g.nodes).toHaveLength(5);
    expect(
      g.nodes.filter((node) =>
        /Requirement$|^requirement$/.test(node.kind ?? ""),
      ),
    ).toHaveLength(3);
    expect(g.edges.map((edge) => edge.label)).toEqual([
      "satisfies",
      "satisfies",
      "satisfies",
      "verifies",
      "verifies",
    ]);
    expect(g.nodes[0]?.compartments?.[0]).toContain("risk: high");
  });
  it.each([
    "C4Context",
    "C4Container",
    "C4Component",
    "C4Deployment",
    "C4Dynamic",
  ])("retains persons, systems, boundaries and relations in %s", (type) => {
    const g = graph(type);
    expect(g.nodes.length).toBeGreaterThanOrEqual(5);
    expect(g.nodes.some((node) => node.kind === "Person")).toBe(true);
    expect(g.nodes.some((node) => node.kind === "System_Ext")).toBe(true);
    expect(g.groups!.length).toBeGreaterThanOrEqual(1);
    expect(g.edges.length).toBeGreaterThanOrEqual(4);
    if (type === "C4Deployment") expect(g.groups).toHaveLength(4);
    if (type === "C4Dynamic")
      expect(g.edges.map((edge) => edge.label)).toEqual([
        "1: Submit cart",
        "2: Place order",
        "3: Authorize",
        "4: Save order",
        "5: Confirm",
        "6: Show receipt",
      ]);
  });
  it("retains six pie slices, ten paired XY values, three Sankey stages, nine quadrant points and three six-axis radar curves", () => {
    expect(glyphChartFromMermaid(source("pie")).marks[0]!.data).toHaveLength(6);
    const xy = glyphChartFromMermaid(source("xychart"));
    expect(xy.marks.map((mark) => mark.type)).toEqual(["bar", "line"]);
    expect(xy.marks.every((mark) => mark.data.length === 10)).toBe(true);
    expect(glyphChartFromMermaid(source("sankey")).marks[0]!.data).toHaveLength(
      7,
    );
    const flows = source("sankey")
      .split("\n")
      .slice(1)
      .map((line) => line.split(","));
    const sources = new Set(flows.map(([from]) => from)),
      sinks = new Set(flows.map(([, to]) => to));
    expect(
      flows.filter(([from, to]) => sinks.has(from) && sources.has(to)),
    ).toHaveLength(0);
    expect(
      glyphChartFromMermaid(source("quadrantChart"))
        .marks.filter((mark) => mark.type === "dot")
        .flatMap((mark) => mark.data),
    ).toHaveLength(9);
    const radar = glyphChartFromMermaid(source("radar"));
    expect(
      radar.marks.filter((mark) => mark.type === "line").length,
    ).toBeGreaterThanOrEqual(3);
    expect(source("radar").match(/curve /g)).toHaveLength(3);
    expect(
      source("radar")
        .split("\n")
        .find((line) => line.trim().startsWith("axis "))
        ?.split(","),
    ).toHaveLength(6);
  });
});
