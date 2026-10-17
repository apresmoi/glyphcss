import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "./mermaid";
import { GLYPH_CHART_MERMAID_STRUCTURE } from "./mermaidStructure";
import { renderGlyphChart } from "./render";

const examples = [
  { name: "Timeline: title, periods, multiple events and continuations", source: `timeline
  title History of social media
  2002 : LinkedIn
  2004 : Facebook : Google
       : YouTube
  2006 : Twitter` },
  { name: "Timeline: sections and authored order", source: `timeline TD
  title Project history
  Before launch : Discover the problem
  section Design
  Later : Sketch the first idea : Discuss the alternatives
  Earlier : Refine the selected idea
  section Delivery
  Later : Ship the first version
        : Listen to feedback
  Future` },
  { name: "Timeline: whole words and explicit breaks", source: `timeline LR
  title A history with carefully wrapped periods and events
  section Research and development
  The first research period : Meet the team and explore the promising alternatives together
    : Discuss the results<br>Choose the next experiment
  The second research period : Revisit the assumptions and share the complete findings` },
  { name: "Timeline: punctuation and inert configuration", source: `---
title: Front title
config:
  timeline:
    disableMulticolor: true
---
%%{init: {theme: 'dark'}}%%
timeline
accTitle: Project history
accDescr { A plain description }
%% comment: unbalanced [ "
section Draft [; quote "
Click [draft " : Style hair; Class reunion &amp; friends
: LinkStyle notes { ready` },
  { name: "Timeline: narrow columns retain whole words", source: `timeline
Extraordinarilylongperiod : An extraordinarilylongdescription remains whole
Next : Finished` },
  { name: "Packet: title, absolute ranges and single bits", source: `packet-beta
  title UDP header
  0-15: "Source Port"
  16-31: "Destination Port"
  32-47: "Length"
  48-63: "Checksum"
  64: "Payload flag"
  65-95: "Payload data"` },
  { name: "Packet: relative counts and mixed ranges", source: `packet
  title Relative header
  +4: "Version"
  +4: "Header length"
  8-15: "Service type"
  +16: "Total length"
  +32: "Identification and fragment information"` },
  { name: "Packet: narrow fields and numbered keys", source: `packet
  title Control register
  +1: "Enable"
  +1: "Interrupt"
  +1: "Ready"
  +1: "Fault"
  +1: "Busy"
  +1: "Retry"
  +1: "Write"
  +1: "Read"
  +1: "Reset"
  +1: "Acknowledge"
  +22: "Reserved"` },
  { name: "Packet: crossing rows, gaps and whole word wrapping", source: `packet
  title Segmented payload
  0-7: "Kind"
  12-47: "Payload containing several complete words"
  +16: "Final checksum"` },
  { name: "Packet: metadata, inert settings and literal punctuation", source: `---
title: Metadata header
config:
  packet:
    bitsPerRow: 16
    bitOrder: descending
    showBits: false
---
%%{init: {theme: 'dark'}}%%
packet
accTitle: Wire layout
accDescr: A fixed 32-bit word
0-15: "Click [draft; %%literal"
16-31: "Style &amp; class<br>Data"
%% comment: unbalanced [ "` },
  { name: "Timeline: wrapped headings and whole-word omission", source: `timeline
  title A carefully documented timeline with enough complete words to require wrapping across two title rows
  section A section heading with enough complete words to wrap across the available width without breaking words
  ${"W".repeat(80)} afterwards : Keep every fitting word` },
  { name: "Packet: tolerant range repairs", source: `packet
  title Range repairs
  0-15: "First field"
  8-23: "Overlapping field"
  24-31: "Last field"
  +0: "Zero width"
  40-32: "Reversed range"
  9007199254740992: "Unsafe integer"` },
  { name: "Packet: bounded oversized field", source: 'packet\n0-8192: "Data"', height: 5 },
  { name: "Timeline: empty declaration", source: "timeline" },
  { name: "Packet: empty declaration", source: "packet" },
  { name: "Timeline: event colons preserve times and URLs", source: `timeline
section Meetings
2024 : Meet at 10:30 : Visit https://example.com
: Return at 11:45 : Read https://example.com:8080/guide
2025: Start at 09:00: Finish at 10:00` },
  { name: "Timeline: grammar-aware hash comments", source: `# Before declaration: [unbalanced "
timeline # Header comment
title Releases # history
# Before section: [unbalanced "
section Phase #1
2024 # Ignore this period suffix: [unbalanced "
2025 : Ship issue #42
: Visit https://example.com/#intro
%% Between periods: [unbalanced "
2026 : Finished` },
  { name: "Timeline: stacked periods retain section hierarchy", source: `timeline
section First
Extraordinarilylongperiod : An extraordinarilylongdescription remains whole
section Second
Anotherextraordinarilylongperiod : Finished` },
];
const commentExamples = [
  { name: "pie", data: '"Issue #42 %%literal": 2' },
  { name: "xychart", data: 'x-axis ["Issue #42 %%literal"]\nbar [2]' },
  { name: "xychart-beta", data: 'x-axis ["Issue #42 %%literal"]\nbar [2]' },
  { name: "sankey", data: '"#42 %%text",Done,2' },
  { name: "sankey-beta", data: '"#42 %%text",Done,2' },
  { name: "quadrantChart", data: '"Issue #42 %%literal": [0.3,0.4] color: #ABCDEF' },
  { name: "gantt", data: 'Issue #42 :2025-01-01, 2d' },
  { name: "journey", data: 'section Work\nTask: 3: Me' },
  { name: "radar", data: 'axis a["#42 %%text"], b["Speed"], c["Cost"]\ncurve q{1,2,3}\ngraticule polygon\nticks 2' },
  { name: "radar-beta", data: 'axis a["#42 %%text"], b["Speed"], c["Cost"]\ncurve q{1,2,3}\ngraticule polygon\nticks 2' },
  { name: "treemap", data: '"Issue #42 %%literal": 2' },
  { name: "treemap-beta", data: '"Issue #42 %%literal": 2' },
  { name: "timeline", data: 'section Work\n2024 : Start' },
  { name: "packet", data: '0-31: "Issue #42 %%literal"' },
  { name: "packet-beta", data: '0-31: "Issue #42 %%literal"' },
].map(({ name, data }) => ({ name: `Comment audit: ${name}`, kind: name, source: `%% Before declaration: [unbalanced "\n${name}\n%% Before data: [unbalanced "\n${data}`, plain: `${name}\n${data}` }));
const render = (source: string, target: "chat" | "web") => renderGlyphChartMermaid(source, { target, width: 72, height: examples.find((example) => example.source === source)?.height });
const structure = (source: string) => (glyphChartFromMermaid(source) as unknown as { [GLYPH_CHART_MERMAID_STRUCTURE]: unknown })[GLYPH_CHART_MERMAID_STRUCTURE];
const trimmed = (source: string) => render(source, "chat").text.split("\n").map((row) => row.trimEnd());

describe("Mermaid timeline and packet", () => {
  it("parses timeline periods, multiple events and continuations without reordering", () => {
    expect(glyphChartFromMermaid(examples[0]!.source).title).toBe("History of social media");
    expect(structure(examples[0]!.source)).toEqual({ kind: "timeline", rows: [
      { kind: "period", text: "2002", events: ["LinkedIn"] },
      { kind: "period", text: "2004", events: ["Facebook", "Google", "YouTube"] },
      { kind: "period", text: "2006", events: ["Twitter"] },
    ] });
    const rows = trimmed(examples[0]!.source);
    expect(rows).toHaveLength(6);
    expect(rows[2]).toMatch(/^                            2004 +│ - Facebook$/);
    expect(rows[3]).toMatch(/^ +│ - Google$/);
    expect(rows[4]).toMatch(/^ +│ - YouTube$/);
    expect(rows[5]).toMatch(/^                            2006 +│ - Twitter$/);
  });

  it("centres the section table, indents periods and separates sections once", () => {
    for (const target of ["chat", "web"] as const) {
      const rows = render(examples[1]!.source, target).text.split("\n").map((row) => row.trimEnd());
      expect(rows.slice(1)).toEqual([
        "  Before launch │ - Discover the problem",
        "",
        "Design",
        "  Later         │ - Sketch the first idea",
        "                │ - Discuss the alternatives",
        "  Earlier       │ - Refine the selected idea",
        "",
        "Delivery",
        "  Later         │ - Ship the first version",
        "                │ - Listen to feedback",
        "  Future        │",
      ].map((row) => row ? "              " + row : row));
    }
    expect(glyphChartFromMermaid(examples[1]!.source).ledger.some((entry) => entry.detail?.feature === "timeline direction and event boxes")).toBe(true);
  });

  it("retains section hierarchy when narrow columns stack the periods and events", () => {
    for (const target of ["chat", "web"] as const) {
      expect(render(examples[17]!.source, target).text.split("\n").map((row) => row.trimEnd())).toEqual([
        "First", "  Extraordinarilylongperiod", "  An extraordinarilylongdescription remains whole", "",
        "Second", "  Anotherextraordinarilylongperiod", "  Finished",
      ].map((row) => row ? "           " + row : row));
    }
  });

  it("splits only whitespace-followed event colons, retaining times and URLs in continuations", () => {
    expect(structure(examples[15]!.source)).toEqual({ kind: "timeline", rows: [
      { kind: "section", text: "Meetings" },
      { kind: "period", text: "2024", events: ["Meet at 10:30", "Visit https://example.com", "Return at 11:45", "Read https://example.com:8080/guide"] },
      { kind: "period", text: "2025", events: ["Start at 09:00", "Finish at 10:00"] },
    ] });
    for (const target of ["chat", "web"] as const) {
      const text = render(examples[15]!.source, target).text;
      for (const event of ["Meet at 10:30", "Visit https://example.com", "Return at 11:45", "Read https://example.com:8080/guide", "Start at 09:00", "Finish at 10:00"]) expect(text).toContain(event);
    }
  });

  it("strips timeline hash comments before declaration and period protection, retaining hashes in text tokens", () => {
    const source = examples[16]!.source;
    expect(glyphChartFromMermaid(source).title).toBe("Releases # history");
    expect(structure(source)).toEqual({ kind: "timeline", rows: [
      { kind: "section", text: "Phase #1" },
      { kind: "period", text: "2024", events: [] },
      { kind: "period", text: "2025", events: ["Ship issue #42", "Visit https://example.com/#intro"] },
      { kind: "period", text: "2026", events: ["Finished"] },
    ] });
    for (const target of ["chat", "web"] as const) {
      const text = render(source, target).text;
      expect(text).not.toMatch(/Before|comment|Ignore|unbalanced/);
      for (const value of ["Phase #1", "Ship issue #42", "https://example.com/#intro"]) expect(text).toContain(value);
    }
  });

  it.each(commentExamples)("preserves comment grammar and literal data: $kind", ({ source, plain, kind }) => {
    expect(glyphChartFromMermaid(source).marks).toEqual(glyphChartFromMermaid(plain).marks);
    for (const target of ["chat", "web"] as const) {
      const result = render(source, target);
      expect(result.text).toBe(render(plain, target).text);
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      expect(result.report.unsupportedGlyphs).toEqual([]);
      expect(result.report.routeConflicts).toEqual([]);
      expect(result.text).not.toMatch(/NaN|undefined|…|\x1b/);
      if (target === "web") { const pre = document.createElement("pre"); pre.innerHTML = result.html!; expect(pre.textContent).toBe(result.text); }
    }
    if (!["journey", "timeline"].includes(kind)) {
      expect(JSON.stringify(glyphChartFromMermaid(source).marks)).toContain("#");
      expect(() => glyphChartFromMermaid(`${kind}\n# Not a comment: [unbalanced "\n${plain.slice(kind.length + 1)}`)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
    }
  });

  it("wraps timeline text without losing words and honors forced breaks", () => {
    const result = render(examples[2]!.source, "chat");
    for (const word of "The first research period Meet the team and explore the promising alternatives together Discuss the results Choose the next experiment Revisit the assumptions and share the complete findings".split(" ")) expect(result.text).toMatch(new RegExp(`\\b${word}\\b`));
    expect(result.text).not.toContain("results Choose");
    expect(result.text.split("\n").filter((s) => s.includes("- "))).toHaveLength(3);
    expect(result.report.ledger.filter((e) => e.detail?.word)).toEqual([]);
    const narrow = render(examples[4]!.source, "chat");
    expect(narrow.text).toContain("Extraordinarilylongperiod");
    expect(narrow.text).toContain("extraordinarilylongdescription");
    expect(narrow.report.ledger.some((e) => e.detail?.feature === "timeline narrow columns")).toBe(true);
  });

  it("protects free punctuation and keeps shared metadata and directives inert", () => {
    const spec = glyphChartFromMermaid(examples[3]!.source);
    expect(spec.title).toBe("Front title");
    expect(spec.description).toBe("Project history\nA plain description");
    expect(structure(examples[3]!.source)).toEqual({ kind: "timeline", rows: [
      { kind: "section", text: 'Draft [; quote "' },
      { kind: "period", text: 'Click [draft "', events: ["Style hair; Class reunion & friends", "LinkStyle notes { ready"] },
    ] });
    expect(spec.ledger.filter((e) => e.code === "mermaid-degraded" && e.message.startsWith("Kept ")).map((e) => e.detail?.feature)).toContain("initialization directive");
    expect(render(examples[3]!.source, "chat").text).not.toContain("unbalanced");
  });

  it("parses packet and packet-beta, titles, absolute ranges, single bits and relative counts", () => {
    expect(glyphChartFromMermaid(examples[5]!.source).title).toBe("UDP header");
    expect(structure(examples[5]!.source)).toEqual({ kind: "packet", fields: [
      { start: 0, end: 15, text: "Source Port" }, { start: 16, end: 31, text: "Destination Port" },
      { start: 32, end: 47, text: "Length" }, { start: 48, end: 63, text: "Checksum" },
      { start: 64, end: 64, text: "Payload flag" }, { start: 65, end: 95, text: "Payload data" },
    ] });
    expect(structure(examples[6]!.source)).toEqual({ kind: "packet", fields: [
      { start: 0, end: 3, text: "Version" }, { start: 4, end: 7, text: "Header length" },
      { start: 8, end: 15, text: "Service type" }, { start: 16, end: 31, text: "Total length" },
      { start: 32, end: 63, text: "Identification and fragment information" },
    ] });
  });

  it("renders 32 bits per row with complete absolute decimal ticks and sharp cell borders", () => {
    for (const target of ["chat", "web"] as const) {
      const rows = render(examples[5]!.source, target).text.split("\n");
      expect(rows[1]!.trim()).toBe("1 1 1 1 1 1 1 1 1 1 2 2 2 2 2 2 2 2 2 2 3 3");
      expect(rows[2]!.trim()).toBe("0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1");
      expect(rows[3]!.trim()).toBe("┌" + "─".repeat(31) + "┬" + "─".repeat(31) + "┐");
      expect(rows[5]!.trim()).toBe("└" + "─".repeat(31) + "┴" + "─".repeat(31) + "┘");
      expect(rows[4]).toContain("Source Port");
      expect(rows[4]).toContain("Destination Port");
      expect(rows[6]!.trim()).toBe("3 3 3 3 3 3 3 3 4 4 4 4 4 4 4 4 4 4 5 5 5 5 5 5 5 5 5 5 6 6 6 6");
    }
  });

  it("uses numbered keys for narrow fields, including multi-digit keys, without losing labels", () => {
    const result = render(examples[7]!.source, "chat"), rows = result.text.split("\n");
    expect(rows[4]!.trim()).toBe("│1│2│3│4│5│6│7│8│9│1│                 Reserved                  │");
    expect(rows[5]!.trim()).toMatch(/^│ │ │ │ │ │ │ │ │ │0│ +│$/);
    expect(result.text).toContain("10. [9] Acknowledge");
    for (const word of ["Enable", "Interrupt", "Ready", "Fault", "Busy", "Retry", "Write", "Read", "Reset", "Acknowledge"]) expect(result.text).toContain(word);
    expect(result.report.ledger.filter((e) => e.detail?.feature === "packet label wider than its cell")).toHaveLength(10);
    expect(result.report.ledger.filter((e) => e.code === "label-abbreviated")).toEqual([]);
  });

  it("splits spanning fields at row boundaries and wraps complete labels inside cells", () => {
    const result = render(examples[8]!.source, "chat");
    expect(result.text.match(/Payload containing several/g)).toHaveLength(2);
    expect(result.text.match(/complete/g)).toHaveLength(2);
    expect(result.text.match(/words/g)).toHaveLength(2);
    expect(result.text).toContain("Final checksum");
    expect(result.report.ledger.filter((e) => e.detail?.feature === "packet label wider than its cell" || e.detail?.word)).toEqual([]);
    const rows = result.text.split("\n");
    expect(rows[3]!.slice(19, 28)).toBe("┬───────┬");
  });

  it("retains packet label punctuation, forced breaks and metadata; ignores configuration", () => {
    const spec = glyphChartFromMermaid(examples[9]!.source), result = render(examples[9]!.source, "web");
    expect(spec.title).toBe("Metadata header");
    expect(spec.description).toBe("Wire layout\nA fixed 32-bit word");
    expect(structure(examples[9]!.source)).toEqual({ kind: "packet", fields: [
      { start: 0, end: 15, text: "Click [draft; %%literal" }, { start: 16, end: 31, text: "Style & class\nData" },
    ] });
    expect(result.text).toContain("%%literal");
    expect(result.text).not.toContain("unbalanced");
    expect(result.report.ledger.some((e) => e.detail?.feature === "packet.bitsPerRow")).toBe(true);
    expect(result.report.ledger.some((e) => e.detail?.feature === "packet.bitOrder")).toBe(true);
    expect(result.report.ledger.some((e) => e.detail?.feature === "packet.showBits")).toBe(true);
  });

  it("wraps long headings and logs omitted whole words without clipping their neighbors", () => {
    const result = render(examples[10]!.source, "chat"), rows = result.text.split("\n");
    expect(rows[0]).toContain("documented timeline");
    expect(rows[1]).toContain("two title rows");
    expect(rows[2]).toContain("A section heading");
    expect(rows[3]).toContain("without breaking words");
    expect(result.text).toContain("afterwards");
    expect(result.text).toContain("Keep every fitting word");
    expect(result.text).not.toContain("WW");
    expect(result.report.ledger.filter((e) => e.detail?.word === "W".repeat(80))).toHaveLength(1);
  });

  it("logs range repairs, overlapping rows and the oversized field limit", () => {
    const result = render(examples[11]!.source, "chat");
    expect(result.text).toContain("First field");
    expect(result.text).toContain("Last");
    expect(result.text).not.toContain("Overlapping");
    expect(result.report.ledger.filter((e) => e.detail?.feature === "unrepresentable packet range")).toHaveLength(3);
    expect(result.report.ledger.filter((e) => e.detail?.feature === "overlapping packet fields")).toHaveLength(1);
    const bounded = render(examples[12]!.source, "chat");
    expect(bounded.text).toContain("Data");
    expect(bounded.report.ledger.filter((e) => e.detail?.feature === "packet field spanning too many rows")).toHaveLength(1);
    expect(bounded.report.ledger.filter((e) => e.detail?.feature === "packet bit row outside the viewport")).toHaveLength(255);
  });

  it.each(examples)("renders $name in the real default targets", ({ source }) => {
    for (const target of ["chat", "web"] as const) {
      const result = render(source, target);
      expect(result.build.resolved.charset).toBe(target === "chat" ? "box" : "braille");
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      expect(result.text).not.toMatch(/NaN|undefined|…|\x1b/);
      expect(result.report.unsupportedGlyphs).toEqual([]);
      expect(result.report.routeConflicts).toEqual([]);
      expect(result.report).toBe(result.build.report);
      expect(result.report.ledger).toEqual(expect.arrayContaining([...glyphChartFromMermaid(source).ledger]));
      expect(renderGlyphChart({ ...glyphChartFromMermaid(source) }, { target, width: 72, height: examples.find((example) => example.source === source)?.height }).text).toBe(result.text);
      if (target === "web") { const pre = document.createElement("pre"); pre.innerHTML = result.html!; expect(pre.textContent).toBe(result.text); }
    }
  });

  it("logs viewport omissions, preserves complete groups, and retains native option errors", () => {
    for (const source of [examples[0]!.source, examples[5]!.source]) {
      const clipped = renderGlyphChartMermaid(source, { target: "chat", width: 72, height: 3 });
      expect(clipped.text.split("\n")).toHaveLength(3);
      expect(clipped.report.ledger.some((e) => String(e.detail?.feature).includes("outside the viewport"))).toBe(true);
      for (const width of [1, 2, 16, 48, 72]) {
        const result = renderGlyphChartMermaid(source, { target: "web", width, textScale: 2 });
        expect(result.text.split("\n").every((s) => [...s].length === width)).toBe(true);
      }
      expect(() => renderGlyphChartMermaid(source, { height: 0 })).toThrow(expect.objectContaining({ code: "bad-size" }));
    }
    for (const source of ["timeline\n: orphan", "packet\nnot a field", 'packet\n-1: "negative"']) expect(() => glyphChartFromMermaid(source)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
    expect(() => glyphChartFromMermaid("flowchart\nA --> B")).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_NOT_CHART_TYPE" }));
  });

  it("writes every example verbatim in both targets and a local web preview", () => {
    const destination = process.env.GLYPH_TIMELINE_PACKET_ARTIFACT;
    if (!destination) return;
    mkdirSync(dirname(destination), { recursive: true });
    const previews: string[] = [];
    const artifactExamples = [...examples, ...commentExamples];
    const artifact = artifactExamples.map(({ name, source }) => `${name}\n\nSOURCE\n${source}\n\n` + (["chat", "web"] as const).map((target) => {
      const result = render(source, target);
      if (target === "web") previews.push(`<article><h2>${name}</h2><pre>${result.html}</pre></article>`);
      return `${target.toUpperCase()} (${result.build.resolved.charset}, 72 columns)\n${result.text}\n\nLEDGER\n${result.report.ledger.map((e) => `${e.code}: ${e.message}`).join("\n")}`;
    }).join("\n\n")).join("\n\n" + "=".repeat(72) + "\n\n") + "\n";
    writeFileSync(destination, artifact);
    const font = readFileSync(join(__dirname, "../../../website/public/fonts/glyph-mono.woff2")).toString("base64");
    writeFileSync(destination.replace(/\.txt$/, ".html"), `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:GlyphMono;src:url(data:font/woff2;base64,${font})}body{background:#10131a;color:#e8eaf0;font:14px system-ui;padding:24px}article{margin:24px 0}pre{font-family:GlyphMono,monospace!important;font-size:16px;line-height:1!important}</style>${previews.join("\n")}`);
    expect(artifact.match(/72 columns\)/g)).toHaveLength(artifactExamples.length * 2);
  });
});
