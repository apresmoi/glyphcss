import { describe, expect, it } from "vitest";
import { tokenizeDiagramsSource, tokenizeDiagramsSourceLine, type DiagramsSourceDialect } from "./diagramsSourceTokens";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS, GLYPH_LANES_WORKBENCH_PRESETS, GLYPH_SEQUENCE_WORKBENCH_PRESETS } from "./diagramsWorkbenchState";

const kinds = (dialect: DiagramsSourceDialect, line: string) => tokenizeDiagramsSourceLine(dialect, line).filter((t) => t.kind !== "text" || t.text.trim().length > 0).map((t) => `${t.kind}:${t.text}`);

describe("diagramsSourceTokens — the highlight layer stays byte-aligned with the textarea", () => {
  // The one invariant every dialect keeps: tokens concatenate back to the
  // exact input, line for line, on every shipped preset AND on drafts the
  // library would reject (unclosed brackets/strings, stray characters).
  // Mutation: make any tokenizer skip or trim a character -> red.
  const samples: readonly [DiagramsSourceDialect, string][] = [
    ...GLYPH_DIAGRAM_WORKBENCH_PRESETS.map((p): [DiagramsSourceDialect, string] => ["sourceKind" in p && p.sourceKind === "json" ? "json" : "mermaid", p.source]),
    ...GLYPH_SEQUENCE_WORKBENCH_PRESETS.map((p): [DiagramsSourceDialect, string] => ["mermaid", p.source]),
    ...GLYPH_LANES_WORKBENCH_PRESETS.map((p): [DiagramsSourceDialect, string] => [p.sourceKind, p.source]),
    ["mermaid", 'flowchart LR\n  a["unclosed --> b\n  c -.->|half| \n  d>weird]\n%% comment\n  e:::cls & f'],
    ["json", '{ "nodes": [ { "id": "a", "label": "unclosed }\n  1e5 -2.5 true nul ]]]\n\t\n'],
    ["gitlog", "a|b c|(tag: v1)|subject with | a pipe\n||||\n\nnot a commit line"],
    ["mermaid", ""],
    ["json", "\n\n"],
  ];
  it.each(samples)("%s tokens concatenate back to the source", (dialect, source) => {
    const lines = tokenizeDiagramsSource(dialect, source);
    expect(lines.length).toBe(source.split("\n").length);
    expect(lines.map((line) => line.map((t) => t.text).join("")).join("\n")).toBe(source);
  });
});

describe("diagramsSourceTokens — JSON", () => {
  it("tells keys from string values and marks numbers, literals and punctuation", () => {
    expect(kinds("json", '  { "id": "a", "n": -1.5e3, "ok": true, "x": null },')).toEqual([
      "punct:{", 'key:"id"', "punct::", 'string:"a"', "punct:,", 'key:"n"', "punct::", "number:-1.5e3", "punct:,",
      'key:"ok"', "punct::", "literal:true", "punct:,", 'key:"x"', "punct::", "literal:null", "punct:}", "punct:,",
    ]);
  });
  it("an unterminated string still tokenizes as one string to the end of the line", () => {
    expect(kinds("json", '"label": "unclosed, "')).toEqual(['key:"label"', "punct::", 'string:"unclosed, "']);
  });
});

describe("diagramsSourceTokens — Mermaid", () => {
  it("flowchart: keywords, ids, shape brackets as punctuation, shape text and edge labels as labels, arrows", () => {
    expect(kinds("mermaid", "flowchart LR")).toEqual(["keyword:flowchart", "keyword:LR"]);
    expect(kinds("mermaid", '  review -->|approved| result([Result])')).toEqual([
      "id:review", "arrow:-->", "punct:|", "label:approved", "punct:|", "id:result", "punct:(", "punct:[", "label:Result", "punct:]", "punct:)",
    ]);
    expect(kinds("mermaid", "  subgraph crew[Crew]")).toEqual(["keyword:subgraph", "id:crew", "punct:[", "label:Crew", "punct:]"]);
    expect(kinds("mermaid", "  a -.-> b & c ==> d --- e")).toEqual(["id:a", "arrow:-.->", "id:b", "punct:&", "id:c", "arrow:==>", "id:d", "arrow:---", "id:e"]);
    expect(kinds("mermaid", "  %% a comment")).toEqual(["comment:%% a comment"]);
  });
  it("sequenceDiagram: message text after the colon and block conditions are labels, not ids", () => {
    expect(kinds("mermaid", "  Client->>Server: POST /login")).toEqual(["id:Client", "arrow:->>", "id:Server", "punct::", "label: POST /login"]);
    expect(kinds("mermaid", "  alt credentials valid")).toEqual(["keyword:alt", "label:credentials valid"]);
    expect(kinds("mermaid", "  participant IRQ as IRQ Controller")).toEqual(["keyword:participant", "id:IRQ", "keyword:as", "label:IRQ Controller"]);
    expect(kinds("mermaid", "  note over A,B: hi")).toEqual(["keyword:note", "keyword:over", "id:A", "punct:,", "id:B", "punct::", "label: hi"]);
  });
  it("a keyword used as a node id inside an edge is still an id", () => {
    expect(kinds("mermaid", "  x --> end")).toEqual(["id:x", "arrow:-->", "id:end"]);
  });
});

describe("diagramsSourceTokens — git log", () => {
  it("id | parents | decoration | subject, the subject running to the end of the line pipes included", () => {
    expect(kinds("gitlog", "rel210|mrel mdev|(HEAD -> main, tag: v2.1.0)|Release 2.1.0 | final")).toEqual([
      "id:rel210", "punct:|", "id:mrel", "id:mdev", "punct:|", "keyword:(HEAD -> main, tag: v2.1.0)", "punct:|", "label:Release 2.1.0 ", "punct:|", "label: final",
    ]);
    expect(kinds("gitlog", "base|||Initial commit")).toEqual(["id:base", "punct:|", "punct:|", "punct:|", "label:Initial commit"]);
  });
});
