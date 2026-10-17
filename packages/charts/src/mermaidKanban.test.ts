import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "./mermaid";
import { GLYPH_CHART_MERMAID_STRUCTURE } from "./mermaidStructure";
import { renderGlyphChart } from "./render";

const examples = [
  { name: "Columns, ordered cards, and an empty lane", source: `kanban
  todo[Todo]
    one[Write documentation]
    two[Review the examples]
  progress[In progress]
    three[Build the parser]
  done[Done]` },
  { name: "Every priority and metadata key", source: `kanban
 todo[Todo]
  a[Database migration]@{ ticket: MC-2037, assigned: 'Alice', priority: 'Very High' }
  b[Review documentation]@{ priority: 'High', assigned: Bob, ticket: MC-2038 }
 done[Done]
  c[Publish the examples]@{ priority: 'Low' }
  d[Archive the draft]@{ priority: 'Very Low' }` },
  { name: "Official full example", source: `---
config:
  kanban:
    ticketBaseUrl: 'https://mermaidchart.atlassian.net/browse/#TICKET#'
---
kanban
  Todo
    [Create Documentation]
    docs[Create Blog about the new diagram]
  [In progress]
    id6[Create renderer so that it works in all cases. We also add some extra text here for testing purposes. And some more just for the extra flare.]
  id9[Ready for deploy]
    id8[Design grammar]@{ assigned: 'knsv' }
  id10[Ready for test]
    id4[Create parsing tests]@{ ticket: MC-2038, assigned: 'K.Sveidqvist', priority: 'High' }
    id66[last item]@{ priority: 'Very Low', assigned: 'knsv' }
  id11[Done]
    id5[define getData]
    id2[Title of diagram is more than 100 chars when user duplicates diagram with 100 char]@{ ticket: MC-2036, priority: 'Very High'}
    id3[Update DB function]@{ ticket: MC-2037, assigned: knsv, priority: 'High' }
  id12[Can't reproduce]
    id3[Weird flickering in Firefox]` },
  { name: "Comment boundaries, punctuation, and inert directives", source: `%% Before header: unbalanced [ "
%%{init: {kanban: {ticketBaseUrl: 'https://example.com/#TICKET#'}}}%%
kanban
%% Before data: unbalanced [ "
  todo[Issue #42 %% literal]
    click[Click; Class &amp; Style can't fail]@{ assigned: "Alice, Bob", ticket: '#42', priority: 'Low' } %% unbalanced [ "
  done[Done] %% trailing comment` },
  { name: "Tabs, quoted labels, breaks, and multiline metadata", source: `---
title: Delivery board
---
kanban
accTitle: Delivery status
accDescr { Ordered work }
\ttodo["Todo [draft]"]
\t\ta["Read the guide<br>Write the examples"]@{
 assigned: 'Alice O''Brien',
 ticket: "MC:2037",
 priority: 'High'
}
\tdone[Done]` },
  { name: "Long whole words widen lanes and wrap columns", source: `kanban
 alpha[Research]
  a[Extraordinarilylongdescription remains whole]
 beta[Development]
  b[Interoperabilityverification stays intact]
 gamma[Delivery]
  c[Finished]` },
  { name: "Empty declaration", source: "kanban" },
  { name: "Empty columns and repeated labels", source: `kanban
 a[Waiting]
 b[Waiting]
 c[Done]
 d[Archive]` },
  { name: "Height budget omits whole cards", source: `kanban
 todo[Todo]
  a[First card]
  b[Second card]
 done[Done]`, height: 8 },
  { name: "Oversized word omitted whole", source: `kanban
 todo[Todo]
  a[${"W".repeat(80)} keep every fitting word]` },
  { name: "Unknown metadata and nested indentation degrade", source: `kanban
 todo[Todo]
  a[First]@{ owner: team, labels: ['one', 'two'], assigned: O'Brien, priority: Urgent }
    b[Nested card]
 done[Done]` },
  { name: "Multiline quoted label", source: `kanban
 todo[Todo]
  a["Read the guide
and write a summary"]
 done[Done]` },
  { name: "Whitespace-only lines between lanes and cards", source: "kanban\n  \n  todo[Todo]\n  \n\t \t\n    a[Keep this card]\n  \n  done[Done]\n\t " },
  { name: "Title directives stay outside indented nodes", source: `kanban
title Delivery board
  title column[Title lane]
    title task[Task]
    title bare
    accTitle card[Accessible task]
  done[Done]` },
  { name: "Single-quoted metadata retains literal backslashes", source: String.raw`kanban
 todo[Todo]
  a[Keep the path]@{ assigned: 'C:\', ticket: 'MC\42', priority: 'High' }
  b[Keep the next card]@{ assigned: 'O''Brien\', priority: Low }
 done[Done]` },
  { name: "Nested XY category title remains data", source: `xychart
title Category audit
x-axis [
 title task,
 Other
]
bar [1, 2]` },
];
const render = (example: typeof examples[number], target: "chat" | "web") => renderGlyphChartMermaid(example.source, { target, width: 72, height: example.height });
const structure = (source: string) => (glyphChartFromMermaid(source) as unknown as { [GLYPH_CHART_MERMAID_STRUCTURE]: { kind: string; columns: { id: string; text: string; items: { id: string; text: string; metadata: Record<string, string> }[] }[] } })[GLYPH_CHART_MERMAID_STRUCTURE];
const features = (source: string) => renderGlyphChartMermaid(source, { target: "chat", width: 72 }).report.ledger.map((e) => e.detail?.feature);

describe("Mermaid kanban", () => {
  it("dispatches kanban, preserving columns, indentation, empty lanes and authored card order", () => {
    expect(structure(examples[0]!.source)).toEqual({ kind: "kanban", columns: [
      { id: "todo", text: "Todo", items: [{ id: "one", text: "Write documentation", metadata: {} }, { id: "two", text: "Review the examples", metadata: {} }] },
      { id: "progress", text: "In progress", items: [{ id: "three", text: "Build the parser", metadata: {} }] },
      { id: "done", text: "Done", items: [] },
    ] });
    const rows = render(examples[0]!, "chat").text.split("\n").map((row) => row.trimEnd());
    expect(rows[0]!.match(/┌─+┐/g)).toHaveLength(3);
    expect(rows[1]).toMatch(/^│ Todo +│  │ In progress +│  │ Done +│$/);
    expect(rows[2]).toMatch(/^├─+┤  ├─+┤  ├─+┤$/);
    expect(rows[3]).toMatch(/^│ ┌─+┐ │  │ ┌─+┐ │  │ +│$/);
    expect(rows[4]).toContain("Write");
    expect(rows.findIndex((row) => row.includes("Review"))).toBeGreaterThan(rows.findIndex((row) => row.includes("Write")));
    expect(features(examples[0]!.source)).not.toContain("kanban columns wrapped");
    expect(features(examples[7]!.source)).not.toContain("kanban columns wrapped");
    expect(render(examples[7]!, "chat").text.split("\n")[0]!.match(/┌/g)).toHaveLength(4);
  });

  it("skips whitespace-only lines without changing the board", () => {
    const source = examples[12]!.source;
    const compact = source.split("\n").filter((line) => line.trim()).join("\n");
    expect(structure(source)).toEqual(structure(compact));
    for (const target of ["chat", "web"] as const) expect(render(examples[12]!, target).text).toBe(renderGlyphChartMermaid(compact, { target, width: 72 }).text);
  });

  it("recognizes title only outside indented kanban nodes", () => {
    const source = examples[13]!.source, board = structure(source);
    expect(glyphChartFromMermaid(source).title).toBe("Delivery board");
    expect(glyphChartFromMermaid(source).description).toBeUndefined();
    expect(board.columns[0]).toEqual({ id: "title column", text: "Title lane", items: [
      { id: "title task", text: "Task", metadata: {} },
      { id: "title bare", text: "title bare", metadata: {} },
      { id: "accTitle card", text: "Accessible task", metadata: {} },
    ] });
  });

  it("keeps YAML single-quoted backslashes literal without consuming the next card", () => {
    const board = structure(examples[14]!.source);
    expect(board.columns).toHaveLength(2);
    expect(board.columns[0]!.items.map((item) => item.metadata)).toEqual([
      { assigned: "C:\\", ticket: "MC\\42", priority: "High" },
      { assigned: "O'Brien\\", priority: "Low" },
    ]);
    expect(board.columns[0]!.items[1]!.text).toBe("Keep the next card");
  });

  it("keeps shared title recognition outside nested chart data", () => {
    const xy = glyphChartFromMermaid(examples[15]!.source);
    expect(xy.title).toBe("Category audit");
    expect(xy.scales?.x?.domain).toEqual(["title task", "Other"]);
  });

  it("aligns every lane bottom before drawing, including wrapped lane rows and height limits", () => {
    for (const example of [examples[0]!, examples[2]!, examples[8]!]) for (const target of ["chat", "web"] as const) {
      const rows = render(example, target).text.split("\n");
      for (let y = 0; y < rows.length; y++) {
        if (!rows[y]!.startsWith("┌")) continue;
        const starts = [...rows[y]!.matchAll(/┌/g)].map((match) => match.index!);
        const bottoms = starts.map((x) => rows.findIndex((row, index) => index > y && row[x] === "└"));
        expect(new Set(bottoms).size).toBe(1);
        expect(bottoms[0]).toBeGreaterThan(y);
      }
    }
  });

  it("uses the empty-body row only for empty lanes", () => {
    for (const target of ["chat", "web"] as const) {
      const rows = render(examples[0]!, target).text.split("\n");
      expect(rows).toHaveLength(10);
      expect(rows[rows.length - 2]![2]).toBe("└");
      const empty = render(examples[7]!, target).text.split("\n");
      expect(empty).toHaveLength(5);
      expect(empty[3]).toMatch(/^│ +│  │ +│  │ +│  │ +│ *$/);
    }
  });

  it("allocates spare width to minimize wrapped card rows rather than equal shares", () => {
    for (const target of ["chat", "web"] as const) {
      const rows = render(examples[0]!, target).text.split("\n");
      for (const text of ["Write documentation", "Review the examples", "Build the parser"]) expect(rows.some((row) => row.includes(text))).toBe(true);
      const board = structure(examples[0]!.source);
      const textRows = rows.filter((row) => board.columns.some((column) => column.items.some((item) => row.includes(item.text))));
      expect(textRows).toHaveLength(2);
    }
  });

  it("reads every metadata key, priority, quote form and renders metadata after the label", () => {
    const board = structure(examples[1]!.source);
    expect(board.columns[0]!.items[0]!.metadata).toEqual({ ticket: "MC-2037", assigned: "Alice", priority: "Very High" });
    expect(board.columns.flatMap((column) => column.items.map((item) => item.metadata.priority))).toEqual(["Very High", "High", "Low", "Very Low"]);
    for (const target of ["chat", "web"] as const) {
      const rows = render(examples[1]!, target).text.split("\n");
      const label = rows.findIndex((row) => row.includes("Database migration"));
      expect(rows[label + 1]).toContain("#MC-2037 · Alice · Very High");
      expect(rows.some((row) => row.includes("#MC-2038 · Bob · High"))).toBe(true);
      expect(rows.some((row) => row.includes("Very Low"))).toBe(true);
    }
  });

  it("accepts every official full-example form, preserving repeated ids as occurrences", () => {
    const board = structure(examples[2]!.source);
    expect(board.columns.map((column) => column.text)).toEqual(["Todo", "In progress", "Ready for deploy", "Ready for test", "Done", "Can't reproduce"]);
    expect(board.columns[0]!.items.map((item) => item.text)).toEqual(["Create Documentation", "Create Blog about the new diagram"]);
    expect(board.columns[4]!.items[2]!.id).toBe("id3");
    expect(board.columns[5]!.items[0]!.id).toBe("id3");
    expect(features(examples[2]!.source)).toContain("kanban columns wrapped");
    expect(glyphChartFromMermaid(examples[2]!.source).ledger).toContainEqual(expect.objectContaining({ code: "mermaid-degraded", detail: expect.objectContaining({ feature: "kanban.ticketBaseUrl" }) }));
  });

  it("uses grammar-aware comments while preserving bracket literals and quoted metadata", () => {
    const board = structure(examples[3]!.source);
    expect(board.columns[0]!.text).toBe("Issue #42 %% literal");
    expect(board.columns[0]!.items[0]).toEqual({ id: "click", text: "Click; Class & Style can't fail", metadata: { assigned: "Alice, Bob", ticket: "#42", priority: "Low" } });
    expect(board.columns[1]!.text).toBe("Done");
    const spec = glyphChartFromMermaid(examples[3]!.source);
    expect(spec.ledger.map((e) => e.detail?.feature)).toContain("initialization directive");
    expect(spec.ledger.map((e) => e.detail?.feature)).toContain("kanban.ticketBaseUrl");
    expect(render(examples[3]!, "web").html).not.toContain("href=");
  });

  it("retains indentation through preprocessing, multiline data, titles, accessibility and explicit breaks", () => {
    const spec = glyphChartFromMermaid(examples[4]!.source), board = structure(examples[4]!.source);
    expect(spec.title).toBe("Delivery board");
    expect(spec.description).toBe("Delivery status\nOrdered work");
    expect(board.columns[0]!.text).toBe("Todo [draft]");
    expect(board.columns[0]!.items[0]!.metadata).toEqual({ assigned: "Alice O'Brien", ticket: "MC:2037", priority: "High" });
    expect(board.columns[0]!.items[0]!.text).toBe("Read the guide\nWrite the examples");
    expect(structure(examples[11]!.source).columns[0]!.items[0]!.text).toBe("Read the guide and write a summary");
    for (const target of ["chat", "web"] as const) expect(render(examples[4]!, target).text).not.toContain("guide Write");
  });

  it("wraps lanes instead of breaking long words and logs unavoidable omissions", () => {
    for (const target of ["chat", "web"] as const) {
      const result = render(examples[5]!, target);
      for (const word of ["Extraordinarilylongdescription", "Interoperabilityverification", "remains", "whole", "stays", "intact", "Finished"]) expect(result.text).toContain(word);
      expect(result.report.ledger.map((e) => e.detail?.feature)).toContain("kanban columns wrapped");
      expect(result.report.ledger.some((e) => e.detail?.word)).toBe(false);
      const omitted = render(examples[9]!, target);
      expect(omitted.text).not.toContain("WWW");
      expect(omitted.text).toContain("keep every fitting word");
      expect(omitted.report.ledger).toContainEqual(expect.objectContaining({ code: "mermaid-degraded", detail: expect.objectContaining({ word: "W".repeat(80) }) }));
      const clipped = render(examples[8]!, target);
      expect(clipped.text).toContain("First card");
      expect(clipped.text).not.toContain("Second");
      expect(clipped.report.ledger).toContainEqual(expect.objectContaining({ code: "mermaid-degraded", detail: expect.objectContaining({ feature: "kanban card outside the viewport", id: "b" }) }));
    }
    expect(features(examples[10]!.source)).toEqual(expect.arrayContaining(["kanban metadata owner", "kanban metadata labels", "kanban nested indentation"]));
    expect(structure(examples[10]!.source).columns[0]!.items[0]!.metadata.assigned).toBe("O'Brien");
  });

  it.each(examples)("renders $name in chat/box and web/braille at 72 columns", (example) => {
    for (const target of ["chat", "web"] as const) {
      const result = render(example, target);
      expect(result.build.resolved.charset).toBe(target === "chat" ? "box" : "braille");
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      expect(result.report.unsupportedGlyphs).toEqual([]);
      expect(result.report.routeConflicts).toEqual([]);
      expect(result.text).not.toMatch(/NaN|undefined|…|\x1b/);
      expect(result.report).toBe(result.build.report);
      expect(result.report.ledger).toEqual(expect.arrayContaining([...glyphChartFromMermaid(example.source).ledger]));
      expect(renderGlyphChart({ ...glyphChartFromMermaid(example.source) }, { target, width: 72, height: example.height }).text).toBe(result.text);
      if (target === "web") { const pre = document.createElement("pre"); pre.innerHTML = result.html!; expect(pre.textContent).toBe(result.text); }
    }
  });

  it("keeps valid boards tolerant at narrow/scaled viewports and errors named", () => {
    for (const width of [1, 2, 8, 9, 16, 48, 72]) for (const target of ["chat", "web"] as const) for (const textScale of [1, 2]) {
      const result = renderGlyphChartMermaid(examples[0]!.source, { target, width, textScale });
      expect(result.text.split("\n").every((row) => [...row].length === width)).toBe(true);
    }
    for (const source of ["kanban\ntodo[Unclosed", "kanban\ntodo[Todo]@{ assigned Alice }", "kanban\ntodo[Todo]@{ assigned: Alice"]) expect(() => glyphChartFromMermaid(source)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
    expect(() => glyphChartFromMermaid("flowchart\nA --> B")).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_NOT_CHART_TYPE" }));
    expect(() => renderGlyphChartMermaid(examples[0]!.source, { height: 0 })).toThrow(expect.objectContaining({ code: "bad-size" }));
  });

  it("writes every added example verbatim in both targets and a local HTML preview", () => {
    const destination = process.env.GLYPH_KANBAN_ARTIFACT;
    if (!destination) return;
    mkdirSync(dirname(destination), { recursive: true });
    const previews: string[] = [];
    const artifact = examples.map((example) => `${example.name}\n\nSOURCE\n${example.source}\n\n` + (["chat", "web"] as const).map((target) => {
      const result = render(example, target);
      if (target === "web") previews.push(`<article><h2>${example.name}</h2><pre>${result.html}</pre></article>`);
      return `${target.toUpperCase()} (${result.build.resolved.charset}, 72 columns)\n${result.text}\n\nLEDGER\n${JSON.stringify(result.report.ledger, null, 2)}`;
    }).join("\n\n")).join("\n\n" + "=".repeat(72) + "\n\n") + "\n";
    writeFileSync(destination, artifact);
    const font = readFileSync(join(__dirname, "../../../website/public/fonts/glyph-mono.woff2")).toString("base64");
    writeFileSync(destination.replace(/\.txt$/, ".html"), `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:GlyphMono;src:url(data:font/woff2;base64,${font})}body{background:#10131a;color:#e8eaf0;font:14px system-ui;padding:24px}article{margin:24px 0}pre{font-family:GlyphMono,monospace!important;font-size:16px;line-height:1!important}</style>${previews.join("\n")}`);
    expect(artifact.match(/72 columns\)/g)).toHaveLength(examples.length * 2);
  });
});
