import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glyphChartFromMermaid, renderGlyphChartMermaid as renderMermaid } from "./index";
import { renderGlyphChart } from "./render";
import { ledgerMermaidDegraded, ledgerMermaidIgnored } from "./ledger";
import examples from "./fixtures/mermaidExamples.json";

const options = { target: "chat", width: 72, height: 24 } as const;
const codes = (source: string) => renderGlyphChartMermaid(source, options).report.ledger.map((entry) => entry.code);
const observedSources = new Set<string>();
const spec = (source: string) => { observedSources.add(source); return glyphChartFromMermaid(source); };
const renderGlyphChartMermaid: typeof renderMermaid = (source, renderOptions) => { observedSources.add(source); return renderMermaid(source, renderOptions); };

describe("Mermaid chart reader", () => {
  it.each(examples)("renders $name through existing marks at 72 columns", ({ source, height }) => {
    const chart = spec(source);
    const renderOptions = { ...options, height: height ?? options.height };
    const rendered = renderGlyphChartMermaid(source, renderOptions);
    expect(rendered.text).toBe(renderGlyphChart(chart, renderOptions).text);
    expect(rendered.text.split("\n")).toHaveLength(renderOptions.height);
    expect(rendered.text.split("\n").every((line) => [...line].length === 72)).toBe(true);
    expect(rendered.text.trim()).not.toBe("");
    expect(rendered.text).not.toMatch(/undefined|NaN|\x1b/);
    expect(rendered.report).toBe(rendered.build.report);
    expect(rendered.report.routeConflicts).toEqual([]);
    expect(rendered.report.ledger.slice(0, chart.ledger.length)).toEqual(chart.ledger);
  });

  it("parses pie title, showData, decimals and ordered labels", () => {
    const chart = spec(examples[0]!.source);
    expect(chart.title).toBe("Pets");
    expect(chart.marks[0]).toMatchObject({ type: "arc", channels: { y: "value", fill: "label" }, data: [{ label: "Dogs [45.5]", value: 45.5 }, { label: "Cats [32.25]", value: 32.25 }, { label: "Birds [22.25]", value: 22.25 }] });
    expect(spec('pie; "A": 1; "B": 2').marks[0]!.data).toEqual([{ label: "A", value: 1 }, { label: "B", value: 2 }]);
    expect(spec('pie\n"A": 0').marks[0]!.data).toEqual([{ label: "A", value: 0 }]);
    expect(codes('pie\n"A": 0')).toContain("empty-total");
  });

  it.each(["xychart", "xychart-beta"])("parses %s categories, axis titles and named mixed series", (header) => {
    const chart = spec(examples[1]!.source.replace("xychart-beta", header));
    expect(chart.scales?.x).toEqual({ type: "band", domain: ["Q1", "Q2", "Q3", "Q4"] });
    expect(chart.scales?.y).toEqual({ type: "linear", domain: [0, 50], nice: false });
    expect(chart.axes).toEqual({ x: { title: "Quarter" }, y: { title: "Revenue" } });
    expect(chart.marks.map((mark) => mark.type)).toEqual(["bar", "line", "text"]);
    expect(chart.marks[0]!.options?.name).toBe("Sales");
    expect(chart.marks[1]!.options?.name).toBe("Goal");
    expect(chart.marks[2]!.data).toEqual([{ x: "Q2", y: 25, label: "Launch" }, { x: "Q4", y: 45, label: "Peak" }]);
    expect(chart.ledger).toEqual([expect.objectContaining({ code: "mermaid-degraded", detail: expect.objectContaining({ feature: "bar domain excluding zero", before: [10, 50], after: [0, 50] }) })]);
    const text = renderGlyphChartMermaid(examples[1]!.source, options).text;
    for (const word of ["Quarterly sales", "Launch", "Peak", "Revenue", "Quarter", "Sales", "Goal"]) expect(text).toContain(word);
  });

  it("parses numeric ranges, signed decimals, optional axes and vertical orientation", () => {
    const chart = spec(examples[2]!.source);
    expect(chart.scales?.x).toEqual({ type: "linear", domain: [0, 12], nice: false });
    expect(chart.marks[0]!.data).toEqual([{ x: 0, y: 1.3, label: "" }, { x: 4, y: 0.6, label: "" }, { x: 8, y: 2.4, label: "" }, { x: 12, y: -0.34, label: "" }]);
    expect(chart.scales?.y?.domain).toEqual([-5, 10]);
    expect(spec('xychart vertical\ny-axis Amount\nline [1,2]').axes?.y?.title).toBe("Amount");
    expect(spec('xychart\nx-axis Time\nline [1,2]').axes?.x?.title).toBe("Time");
    expect(spec('xychart\nx-axis ["2025-01-01", "2025-01-02"]\nline [1,2]').scales?.x?.type).toBe("band");
  });

  it("places each numeric series across the complete explicit x range, including singleton series", () => {
    const chart = spec('xychart\nx-axis 0 --> 10\nline [1,2]\nline [1,2,3]\nline [7]');
    expect(chart.marks.map((mark) => mark.data.map((d) => (d as { x: number }).x))).toEqual([[0,10], [0,5,10], [0]]);
    const bars = spec('xychart\nx-axis -10 --> 10\nbar [1,2]\nbar [1,2,3]');
    expect(bars.marks.map((mark) => mark.data.map((d) => (d as { x: number }).x))).toEqual([[-10,10], [-10,0,10]]);
  });

  it("starts omitted or title-only x axes at one, without falsely naming unnamed legend entries", () => {
    for (const axis of ['', 'x-axis Time\n']) {
      const chart = spec(`xychart\n${axis}line [1,2]\nbar "Named" [1,2,3]`);
      expect(chart.marks.map((mark) => mark.data.map((d) => (d as { x: number }).x))).toEqual([[1,2], [1,1.5,2]]);
      expect(chart.scales?.x?.domain).toEqual([1,2]);
      expect(chart.marks.map((mark) => mark.options?.name)).toEqual([undefined, "Named"]);
      expect(chart.ledger).toEqual([]);
      expect(renderGlyphChartMermaid(`xychart\n${axis}line [1,2]\nbar "Named" [1,2,3]`, options).text).toContain("Named");
    }
  });

  it("treats title punctuation as free text before either scanner sees it", () => {
    for (const header of ['quadrantChart', 'xychart', 'pie', 'pie showData']) {
      const data = header === 'quadrantChart' ? 'P: [0.1,0.2]' : header === 'xychart' ? 'line [1,2]' : '"A": 1';
      for (const title of ['Cost [USD', 'Cost "USD', 'Cost ]USD', 'Cost; [USD " %% literal']) {
        const source = `${header}\ntitle ${title}\n${data}`;
        expect(spec(source).title).toBe(title);
        expect(renderGlyphChartMermaid(source, options).text).toContain(title);
      }
    }
    expect(spec('quadrantChart\ntitle "Cost &amp;lt;USD"\nP: [0.1,0.2]').title).toBe("Cost &lt;USD");
    expect(spec('pie showData title Cost [USD "\n"A": 1').title).toBe('Cost [USD "');
    expect(spec('quadrantChart\ntitle "Quoted [USD]"\nP: [0.1,0.2]').title).toBe('Quoted [USD]');
  });

  it("transposes horizontal line coordinates, scales, titles and point annotations without changing the painter", () => {
    const chart = spec('xychart horizontal\nx-axis Region [East, West, North]\ny-axis Units 0 --> 20\nline "Sales" [10,18 "Peak",14]');
    expect(chart.ledger).toEqual([]);
    expect(chart.scales).toEqual({ x: { type: "linear", domain: [0,20], nice: false }, y: { type: "band", domain: ["East", "West", "North"] } });
    expect(chart.axes).toEqual({ x: { title: "Units" }, y: { title: "Region" } });
    expect(chart.marks[0]!.data).toEqual([{ x: 10, y: "East", label: "" }, { x: 18, y: "West", label: "Peak" }, { x: 14, y: "North", label: "" }]);
    expect(chart.marks[1]!.data).toEqual([{ x: 18, y: "West", label: "Peak" }]);
    const source = 'xychart horizontal\nx-axis Hour 0 --> 10\ny-axis Value -5 --> 5\nline [1,-2,3]';
    const numeric = spec(source);
    expect(numeric.marks[0]!.data).toEqual([{ x: 1, y: 0, label: "" }, { x: -2, y: 5, label: "" }, { x: 3, y: 10, label: "" }]);
    expect(numeric.scales?.y?.domain).toEqual([0,10]);
    expect(renderGlyphChartMermaid(source, options).text).toBe(renderGlyphChart(numeric, options).text);
  });

  it("keeps brackets in quoted axis and series names separate from data", () => {
    const chart = spec('xychart\nx-axis "Month [UTC]" [Jan, Feb]\nline "Mean [daily]" [1,2]');
    expect(chart.axes?.x?.title).toBe("Month [UTC]");
    expect(chart.marks[0]!.options?.name).toBe("Mean [daily]");
    expect(chart.marks[0]!.data).toMatchObject([{ x: "Jan", y: 1 }, { x: "Feb", y: 2 }]);
  });

  it("transposes mixed bars and lines through native horizontal bars", () => {
    const chart = spec(examples[3]!.source);
    expect(chart.ledger.some((e) => e.detail?.feature === "horizontal bar orientation")).toBe(false);
    expect(chart.marks[0]!.options?.orientation).toBe("horizontal");
    expect(chart.marks[0]!.data[1]).toEqual({ x: 18, y: "West", label: "" });
  });

  it.each(["sankey", "sankey-beta"])("parses %s RFC CSV commas, doubled quotes, blank lines and multiline fields", (header) => {
    const chart = spec(examples[4]!.source.replace("sankey-beta", header));
    expect(chart.marks[0]).toMatchObject({ type: "sankey", channels: { source: "source", target: "target", value: "value" }, data: [{ source: "Coal, mined", target: "Power", value: 40 }, { source: 'Gas "clean"', target: "Power", value: 60 }, { source: "Power", target: "Homes", value: 70 }, { source: "Power", target: "Industry", value: 30 }] });
    expect(spec(examples[11]!.source).marks[0]!.data[0]).toEqual({ source: "Solar roof", target: "Grid", value: 12 });
    expect(spec(examples[11]!.source).ledger).toEqual([expect.objectContaining({ code: "mermaid-degraded", detail: { feature: "multiline CSV label", replacement: "a single-line node label" } })]);
    expect(codes(examples[11]!.source)).toContain("label-dropped");
  });

  it("preserves literal CSV percent signs, semicolons and quoted names", () => {
    expect(spec('sankey\n"""quoted""",100%%; output,2').marks[0]!.data).toEqual([{ source: '"quoted"', target: '100%%; output', value: 2 }]);
  });

  it("degrades cyclic/self-loop graphs to an honest flow list and nonpositive flows to notes", () => {
    const chart = spec(examples[5]!.source);
    expect(chart.marks[0]!.type).toBe("text");
    expect(chart.marks[0]!.data).toHaveLength(3);
    expect(renderGlyphChartMermaid(examples[5]!.source, options).text).toContain("C -> A (3)");
    expect(codes('sankey\nA,A,1')).toContain("mermaid-degraded");
    expect(codes('sankey\nA,B,0')).toContain("mermaid-degraded");
  });

  it("preserves CSV node identity when names are empty or normalize to the same label", () => {
    expect(() => renderGlyphChartMermaid('sankey\n,B,1', options)).not.toThrow();
    const chart = spec('sankey\n"A\nB",X,1\n"A B",Y,2');
    expect(chart.marks[0]!.type).toBe("text");
    expect(chart.marks[0]!.data).toMatchObject([{ label: 'A\\nB -> X (1)' }, { label: 'A B -> Y (2)' }]);
    expect(chart.ledger).toContainEqual(expect.objectContaining({ detail: expect.objectContaining({ feature: "ambiguous normalized CSV names" }) }));
    expect(renderGlyphChartMermaid(examples[5]!.source, { width: 72, target: "chat" }).text.split("\n")).toHaveLength(3);
  });

  it("maps quadrant axes, all four captions, rules and exact point coordinates", () => {
    const chart = spec(examples[6]!.source);
    expect(chart.title).toBe("Campaign priorities");
    expect(chart.scales).toEqual({ x: { domain: [0, 1], nice: false }, y: { domain: [0, 1], nice: false } });
    expect(chart.axes?.x?.title).toBe("");
    expect((chart.axes?.x?.format as (v: number) => string)(0)).toBe("Low Reach");
    expect((chart.axes?.x?.format as (v: number) => string)(1)).toBe("High Reach");
    expect((chart.axes?.y?.format as (v: number) => string)(0)).toBe("Low Engagement");
    expect((chart.axes?.y?.format as (v: number) => string)(1)).toBe("High Engagement");
    expect(chart.marks.slice(0, 2)).toMatchObject([{ type: "rule", data: [0.5], options: { axis: "x" } }, { type: "rule", data: [0.5], options: { axis: "y" } }]);
    expect(chart.marks[2]).toMatchObject({ type: "dot", data: [{ x: 0.3, y: 0.6 }] });
    expect(chart.marks.at(-1)?.data).toEqual([{ x: .75, y: .94, label: "Expand" }, { x: .25, y: .94, label: "Promote" }, { x: .25, y: .44, label: "Reassess" }, { x: .75, y: .44, label: "Improve" }]);
    const text = renderGlyphChartMermaid(examples[6]!.source, options).text;
    for (const word of ["Expand", "Promote", "Reassess", "Improve", "Campaign A", "Campaign B", "Campaign C", "Campaign D"]) expect(text).toContain(word);
  });

  it("resolves forward point classes with direct-style precedence, normalizes hex colors and notes unsupported pixel styling", () => {
    const chart = spec(examples[7]!.source);
    const dots = chart.marks.filter((mark) => mark.type === "dot");
    expect(dots.map((mark) => mark.options?.color)).toEqual(["#ff3300", "#00ff33"]);
    expect(chart.ledger.filter((e) => e.detail?.feature === "point radius and border styling")).toHaveLength(2);
    const css = renderGlyphChartMermaid(examples[7]!.source, { ...options, target: "web", color: "css" }).html;
    expect(css).toContain("#ff3300"); expect(css).toContain("#00ff33");
    expect(spec('quadrantChart\nP: [0,1] color: #ABCDEF').marks[2]!.options?.color).toBe("#abcdef");
    expect(codes('quadrantChart\nP: [0,1] color: red')).toContain("mermaid-degraded");
    const axes = spec('quadrantChart\nx-axis Left\ny-axis Bottom').axes;
    expect((axes?.x?.format as (v: number) => string)(0)).toBe("Left");
    expect((axes?.y?.format as (v: number) => string)(0)).toBe("Bottom");
  });

  it("keeps configuration and executable-looking directives inert, preserving accessibility metadata", () => {
    const chart = spec(examples[9]!.source);
    expect(chart.title).toBe("Browser share");
    expect(chart.description).toBe("Browsers\nShare by browser");
    expect(chart.ledger.map((e) => e.code)).toEqual(["mermaid-ignored", "mermaid-ignored", "mermaid-ignored"]);
    expect(chart.ledger[1]?.detail?.feature).toBe("pie.donutHole");
    expect(spec('pie\nclick A "javascript:alert(1)"\n"A":1').ledger[0]?.code).toBe("mermaid-ignored");
    expect(spec('pie\n"A %% literal; &amp; B": 1 %% ignored').marks[0]!.data[0]).toEqual({ label: "A %% literal; & B", value: 1 });
    expect(spec('xychart\ntitle "`Markdown title`"\nx-axis ["A, B", C]\nline [1,2]').title).toBe("Markdown title");
  });

  it.each([
    ["pie", "textPosition", "0.5", "no radial-position option"],
    ["pie", "legendPosition", "left", "bottom legend"],
    ["pie", "donutHole", "0.4", "solid pie"],
    ["pie", "highlightSlice", "hover", "no highlight or hover state"],
    ["sankey", "nodeAlignment", "right", "native depth columns"],
    ["sankey", "nodeColors", '{A: "red"}', "default per-source palette"],
    ["sankey", "linkColor", "gradient", "source-colored links"],
    ["sankey", "labelStyle", "outlined", "plain node labels"],
    ["sankey", "nodeWidth", "20", "one-cell node bars"],
    ["sankey", "nodePadding", "16", "native cell-based padding"],
    ["sankey", "showValues", "false", "native node totals and flow values"],
    ["sankey", "prefix", "USD", "unprefixed numeric values"],
    ["sankey", "suffix", "TWh", "unsuffixed numeric values"],
    ["sankey", "width", "800", "caller's column budget"],
    ["sankey", "height", "400", "caller's row budget"],
  ])("logs %s.%s with the precise native replacement while keeping configuration inert", (kind, key, value, replacement) => {
    const body = kind === "pie" ? 'pie\n"A": 1\n"B": 2' : 'sankey\nA,B,2';
    const source = `---\nconfig:\n  ${kind}:\n    ${key}: ${value}\n---\n${body}`;
    const chart = spec(source);
    expect(chart.ledger).toContainEqual(expect.objectContaining({ code: "mermaid-ignored", detail: { feature: `${kind}.${key}`, replacement: expect.stringContaining(replacement) } }));
    expect(renderGlyphChartMermaid(source, options).text).toBe(renderGlyphChartMermaid(body, options).text);
    const directive = `%%{init: {'${kind}': {'${key}': '${value}'}}}%%\n${body}`;
    expect(spec(directive).ledger).toContainEqual(expect.objectContaining({ detail: { feature: `${kind}.${key}`, replacement: expect.stringContaining(replacement) } }));
  });

  it("protects arbitrary accessibility prose and quoted axis delimiters", () => {
    const chart = spec('pie\naccTitle: A lone " bracket [; %% literal\naccDescr {Words with [ and " punctuation}\n"A": 1');
    expect(chart.description).toBe('A lone " bracket [; %% literal\nWords with [ and " punctuation');
    const format = spec('quadrantChart\nx-axis "Low --> literal" --> "High"').axes?.x?.format as (v: number) => string;
    expect(format(0)).toBe("Low --> literal"); expect(format(1)).toBe("High");
    expect(spec('sankey\n"C:\\",B,1').marks[0]!.data).toEqual([{ source: "C:\\", target: "B", value: 1 }]);
    expect(spec('xychart\nbar [1 "ignored", 2]').marks.map((mark) => mark.type)).toEqual(["bar"]);
  });

  it("rejects every other header by name before parsing foreign delimiters", () => {
    for (const header of ["flowchart", "sequenceDiagram", "stateDiagram-v2"]) {
      expect(() => spec(`%% comment\n${header}\nforeign [ \"`)).toThrowError(expect.objectContaining({ code: "GLYPH_MERMAID_NOT_CHART_TYPE" }));
    }
  });

  it("uses named syntax errors for malformed input", () => {
    for (const source of ["", "pie\nA: 1", 'pie\n"A": -1', 'pie\n"A: 1', 'xychart\nline [bad]', 'xychart\nline [1, 2', 'sankey\nA,B', 'quadrantChart\nP:[2,0]']) {
      expect(() => spec(source)).toThrowError(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
    }
  });

  it("handles short/single categories, empty charts and mixed unnamed legends without runtime validation errors", () => {
    for (const source of ['xychart\nx-axis [A]\nbar [1,2]', 'xychart\nline [1,2]\nbar "Named" [1,2]', 'xychart', 'sankey', 'quadrantChart']) {
      expect(() => renderGlyphChartMermaid(source, options)).not.toThrow();
    }
    expect(codes('xychart\nx-axis [A]\nbar [1,2]')).toContain("mermaid-degraded");
  });

  it("constructs Mermaid ledger entries with stable codes, sentence messages and structured detail", () => {
    for (const entry of [ledgerMermaidDegraded({ feature: "orientation", replacement: "vertical marks", count: 3 }), ledgerMermaidIgnored({ feature: "configuration" })]) {
      expect(entry.code).toMatch(/^[a-z][a-z-]+$/);
      expect(entry.message).toMatch(/^[A-Z].*\.$/);
      expect(entry.detail?.feature).toBeDefined();
    }
  });

  it("writes every example verbatim when the artifact destination is requested", () => {
    const dir = process.env.GLYPH_MERMAID_ARTIFACT_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const fixtureSources = new Set(examples.map((example) => example.source));
    const additional = [...observedSources].filter((source) => {
      if (fixtureSources.has(source)) return false;
      try { glyphChartFromMermaid(source); return true; }
      catch (error) {
        if (["GLYPH_MERMAID_SYNTAX", "GLYPH_MERMAID_NOT_CHART_TYPE"].includes((error as { code: string }).code)) return false;
        throw error;
      }
    }).map((source, index) => ({ name: `Additional syntax case ${index + 1}`, source, height: undefined }));
    const renderedExamples = [...examples, ...additional];
    const text = renderedExamples.map(({ name, source, height }) => {
      const result = renderGlyphChartMermaid(source, { ...options, height: height ?? options.height });
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      return `${name}\n\nSOURCE\n${source}\n\nRENDER (72 columns)\n${result.text}\n\nLEDGER\n${result.report.ledger.map((e) => `${e.code}: ${e.message}`).join("\n") || "(none)"}`;
    }).join("\n\n" + "=".repeat(72) + "\n\n") + "\n";
    writeFileSync(join(dir, "t2.txt"), text);
    expect(text.match(/RENDER \(72 columns\)/g)).toHaveLength(renderedExamples.length);
  });
});
