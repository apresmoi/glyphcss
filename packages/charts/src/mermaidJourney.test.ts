import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { glyphChartFromMermaid, renderGlyphChartMermaid, renderGlyphChart } from "./index";

const examples = [
  { name: "Documented journey: title, sections, scores and multiple actors", source: `journey
  title My working day
  section Go to work
    Make tea: 5: Me
    Go upstairs: 3: Me
    Do work: 1: Me, Cat
  section Go home
    Go downstairs: 5: Me
    Sit down: 5: Me` },
  { name: "All five scores in authored order, repeated task/section names", source: `journey
  title Satisfaction
  section Visit
  Browse: 1: Visitor, Guide
  Ask: 2: Visitor
  Browse: 3: Visitor, Support
  section Visit
  Choose: 4: Visitor
  Pay: 5: Visitor, Cashier` },
  { name: "Whole-word wrapping for sections, tasks and actors", source: `journey
  title First visit
  section Discover the service together
  Read the welcome message carefully: 3: New customer, Support specialist
  section Finish the first visit
  Confirm the account details: 4: New customer, Account manager` },
  { name: "Free punctuation, entities, comment protection and inert directives", source: `---
title: A configured journey
config:
  journey:
    width: 900
---
%%{init: {"theme": "forest"}}%%
journey
  title Check: [alpha; unmatched "
  accTitle: First visit
  accDescr {A plain
  description}
  %% Section: [unbalanced "
  section Bob's "draft [
  Read; review &amp; approve [: 2: Me, QA "lead
  Quote " and brace {: 5: Me %% ignored comment` },
  { name: "Actorless tasks, empty and repeated sections", source: `journey
  title Quiet steps
  Wait: 2
  section Empty
  section Work
  Start: 3:
  Start: 4: Team, Reviewer
  section Empty` },
  { name: "Scores outside the documented range clamp with notes", source: `journey
  title Repaired scores
  Low: -2: Me
  High: 10: Team` },
  { name: "Unfittable task word omitted; long actor below the bar", source: `journey
  section Review
  Supercalifragilisticexpialidocious review: 3: Extraordinarilylongactorname, Me` },
  { name: "Empty declaration", source: "journey" },
  { name: "Section without tasks", source: "journey\nsection Empty" },
  { name: "Wide title keeps only complete words", source: `journey
  title A lengthy journey heading whose complete words exceed the available seventy two columns
  Read: 3: Me` },
  { name: "Actor lists wrap below their own bar", source: `journey
  section Collaborate
  Plan: 2: New customer, Support specialist, Account manager, Reviewer, Quality lead, Release manager
  Ship: 5: Team` },
  { name: "Wide section wraps and oversized actor is omitted whole", source: `journey
  section Review the customer experience across every department and every stage together
  Review: 4: SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious, Me
  Finish: 5: Me` },
  { name: "Directive-like task names and colon-bearing labels", source: `journey
  title Task names stay data
  Click button: 3: Me
  Style hair: 4: Me
  Class reunion: 5: Me
  ClassDef meetup: 2: Me
  LinkStyle review: 1: Me
  Click: button: 3: Me
  Style: hair: 4: Me
  Class: reunion: 5: Me
  Click button [draft ": 3: Me` },
  { name: "Journey hash comments and empty score repairs", source: `# Before the declaration: [unbalanced "
journey # Header comment
  title Quiet morning # Hidden heading
  # Before a task: [unbalanced "
  section Work # Hidden section
  Wait: 3 # Inline task comment
  Empty: : Me # Inline actor comment
  Empty actorless: 
  Empty actors: :
  Finish: 5: Team # Hidden actor` },
];
const observed = new Map(examples.map((e) => [e.source, e.name]));
const exampleHeights = new Map<string, { chat: number; web: number }>();
const renderExample = (source: string, target: "chat" | "web") => renderGlyphChartMermaid(source, { target, width: 72, height: exampleHeights.get(source)?.[target] });
const parse = (source: string) => { if (!observed.has(source)) observed.set(source, `Syntax case ${observed.size + 1}`); return glyphChartFromMermaid(source); };
const bars = (source: string) => parse(source).marks.filter((m) => m.type === "bar").flatMap((m) => m.data) as { x: number; y: string; task: string; score: number; actors: string }[];

describe("Mermaid journey", () => {
  it("dispatches journey into native horizontal bars and keeps title, sections, actors and authored order", () => {
    const source = examples[0]!.source, spec = parse(source);
    expect(spec.title).toBe("My working day");
    expect(spec.marks).toHaveLength(1);
    expect(spec.marks[0]).toMatchObject({ type: "bar", options: { orientation: "horizontal" }, channels: { x: "x", y: "y" } });
    expect(bars(source).map((b) => [b.task, b.x, b.actors])).toEqual([
      ["Make tea", 5, "Me"], ["Go upstairs", 3, "Me"], ["Do work", 1, "Me, Cat"], ["Go downstairs", 5, "Me"], ["Sit down", 5, "Me"],
    ]);
    expect(spec.scales!.x).toEqual({ type: "linear", domain: [0, 5], nice: false });
    expect(spec.legend).toBe(false);
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(source, { target, width: 72 });
      const rows = result.text.split("\n").map((row) => row.trimEnd());
      expect(rows).toHaveLength(9);
      expect(rows[0]!.trim()).toBe("My working day");
      expect(rows[1]).toBe("Go to work");
      expect(rows[5]).toBe("");
      expect(rows[6]).toBe("Go home");
      for (const [i, task, score, actors] of [[2, "Make tea", 5, "Me"], [3, "Go upstairs", 3, "Me"], [4, "Do work", 1, "Me, Cat"], [7, "Go downstairs", 5, "Me"], [8, "Sit down", 5, "Me"]] as const) {
        expect(rows[i]).toMatch(new RegExp(`^  ${task} +█+ +${score}  ${actors}$`));
      }
      expect(result.text).not.toContain("Actors:");
      expect(rows.filter((row) => row === "")).toHaveLength(1);
    }
  });

  it("keeps duplicate task names as separate task rows and all five score lengths", () => {
    const source = examples[1]!.source;
    expect(bars(source).map((b) => b.x)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(bars(source).map((b) => b.y)).size).toBe(5);
    expect(renderGlyphChartMermaid(source, { target: "chat", width: 72 }).text.split("\n").filter((row) => row.trimEnd() === "Visit")).toHaveLength(2);
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(source, { target, width: 72 });
      const lengths = result.text.split("\n").filter((s) => s.includes("█")).map((s) => s.match(/█/g)!.length);
      expect(lengths).toHaveLength(5);
      expect(lengths.every((length, i) => i === 0 || length > lengths[i - 1]!)).toBe(true);
      const rows = result.text.split("\n").filter((row) => row.includes("█"));
      rows.forEach((row, i) => {
        expect(row.slice(result.build.plot.x0 + 1, result.build.plot.x1 + 1).trim().length).toBe(Math.round((i + 1) * 26 / 5));
        expect(row.slice(result.build.plot.x1 + 1)).toMatch(new RegExp(`^ ${i + 1}  Visitor`));
      });
      expect(result.text).not.toMatch(/[☺☻😀😐😞]/u);
    }
  });

  it("wraps every fitting word without abbreviations or missing label rows at 72 columns", () => {
    const source = examples[2]!.source;
    const words = "Discover the service together Read the welcome message carefully New customer Support specialist Finish the first visit Confirm the account details Account manager".split(" ");
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(source, { target, width: 72 });
      for (const word of words) expect(result.text).toMatch(new RegExp(`\\b${word}\\b`));
      expect(result.report.ledger.filter((e) => /label-(abbreviated|dropped)|ticks-thinned/.test(e.code))).toEqual([]);
      expect(result.text).not.toContain("…");
    }
  });

  it("wraps actors under their own bar without inserting blank rows or moving the next task", () => {
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(examples[10]!.source, { target, width: 72 });
      const rows = result.text.split("\n").map((row) => row.trimEnd());
      const barCol = rows[1]!.indexOf("█");
      expect(rows).toHaveLength(5);
      expect(rows[1]).toMatch(/^  Plan +█+ +2$/);
      expect(rows[2]).toBe(" ".repeat(barCol) + "New customer, Support specialist, Account manager, Reviewer,");
      expect(rows[3]).toBe(" ".repeat(barCol) + "Quality lead, Release manager");
      expect(rows[4]).toMatch(/^  Ship +█+ +5  Team$/);
      expect(result.report.ledger.filter((entry) => entry.detail?.word)).toEqual([]);
      const wrapped = renderGlyphChartMermaid(examples[2]!.source, { target, width: 72 }).text.split("\n");
      expect(wrapped[2]).toMatch(/^  Read the welcome message +█+ +3 +$/);
      expect(wrapped[3]).toMatch(/^  carefully +New customer, Support specialist +$/);
      const oversized = renderGlyphChartMermaid(examples[11]!.source, { target, width: 72 });
      expect(oversized.text).not.toContain("Supercal");
      expect(oversized.report.ledger.filter((entry) => entry.detail?.word)).toHaveLength(1);
      expect(oversized.text.split("\n")[1]!.trim()).toBe("together");
    }
  });

  it("omits complete tasks with a note when height cannot fit them", () => {
    const result = renderGlyphChartMermaid(examples[0]!.source, { target: "chat", width: 72, height: 3 });
    expect(result.text.split("\n")).toHaveLength(3);
    expect(result.text).toContain("Make tea");
    expect(result.text).not.toContain("Go upstairs");
    expect(result.report.ledger.filter((entry) => entry.detail?.feature === "journey task outside the viewport")).toHaveLength(4);
    expect(() => renderGlyphChartMermaid(examples[0]!.source, { width: 1, height: 1 })).not.toThrow();
  });

  it("protects free text while keeping metadata and configuration inert", () => {
    const source = examples[3]!.source, spec = parse(source);
    expect(spec.title).toBe('Check: [alpha; unmatched "');
    expect(spec.description).toBe("First visit\nA plain   description");
    expect(bars(source).map((b) => [b.task, b.actors])).toEqual([
      ["Read; review & approve [", 'Me, QA "lead'], ['Quote " and brace {', "Me"],
    ]);
    expect(spec.ledger.filter((e) => e.code === "mermaid-degraded" && e.message.startsWith("Kept ")).map((e) => e.detail?.feature)).toEqual(["frontmatter configuration", "chart.width", "initialization directive"]);
  });

  it("preserves directive-like and colon-bearing task names", () => {
    const source = examples[12]!.source;
    expect(bars(source).map((b) => [b.task, b.x, b.actors])).toEqual([
      ["Click button", 3, "Me"], ["Style hair", 4, "Me"], ["Class reunion", 5, "Me"],
      ["ClassDef meetup", 2, "Me"], ["LinkStyle review", 1, "Me"],
      ["Click: button", 3, "Me"], ["Style: hair", 4, "Me"], ["Class: reunion", 5, "Me"], ['Click button [draft "', 3, "Me"],
    ]);
    expect(parse(source).ledger.filter((e) => e.code === "mermaid-degraded" && e.message.startsWith("Kept "))).toEqual([]);
  });

  it("strips journey hash comments and repairs empty scores through the existing score ledger", () => {
    const source = examples[13]!.source, spec = parse(source);
    expect(spec.title).toBe("Quiet morning");
    expect(bars(source).map((b) => [b.task, b.score, b.x, b.actors])).toEqual([
      ["Wait", 3, 3, ""], ["Empty", 0, 1, "Me"], ["Empty actorless", 0, 1, ""], ["Empty actors", 0, 1, ""], ["Finish", 5, 5, "Team"],
    ]);
    expect(spec.ledger.filter((e) => e.detail?.feature === "journey score outside 1–5").map((e) => [e.detail?.score, e.detail?.value])).toEqual([[0, 1], [0, 1], [0, 1]]);
    for (const target of ["chat", "web"] as const) {
      const result = renderGlyphChartMermaid(source, { target, width: 72 });
      expect(result.text).toContain("Work");
      expect(result.text).not.toMatch(/Hidden|comment|unbalanced/);
      expect(result.report.ledger.filter((e) => e.detail?.score === 0)).toHaveLength(3);
    }
  });

  it.each([
    ["pie", 'pie\n"Click button": 3\n"Style hair": 4\n"Class reunion": 5'],
    ["xychart", 'xychart\nx-axis ["Click button", "Style hair", "Class reunion"]\nbar [3,4,5]\nline "ClassDef meetup" [2,3,4]'],
    ["sankey", 'sankey\nClick button,Class reunion,3\nStyle hair,Class reunion,4'],
    ["quadrantChart", 'quadrantChart\nClick button: [0.2,0.3]\nStyle hair: [0.5,0.6]\nClass reunion: [0.8,0.7]\nClassDef meetup: [0.3,0.8]'],
    ["gantt", 'gantt\nClick button: a,2025-01-01,1d\nStyle hair: b,after a,1d\nClass reunion: c,after b,1d\nClassDef meetup: after c,1d'],
    ["radar", 'radar\naxis Click["Click button"],Style["Style hair"],Class["Class reunion"]\ncurve ClassDef["ClassDef meetup"]{3,4,5}'],
    ["treemap", 'treemap\n"Click button"\n  "Style hair": 4\n  "Class reunion": 5'],
  ])("keeps directive-like names as data across the %s reader", (kind, source) => {
    observed.set(source, `${kind}: directive-like names remain data`);
    const height = kind === "gantt" ? 10 : 16;
    exampleHeights.set(source, kind === "radar" ? { chat: 10, web: 22 } : { chat: height, web: height });
    const spec = parse(source), data = JSON.stringify(spec.marks) + JSON.stringify(spec.scales);
    for (const name of ["Click button", "Style hair", "Class reunion"]) expect(data).toContain(name);
    if (["xychart", "quadrantChart", "gantt", "radar"].includes(kind)) expect(data).toContain("ClassDef meetup");
    expect(spec.ledger.filter((e) => e.code === "mermaid-degraded" && e.message.startsWith("Kept "))).toEqual([]);
    for (const target of ["chat", "web"] as const) {
      const result = renderExample(source, target);
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      expect(result.report.ledger.filter((e) => /label-(abbreviated|dropped)/.test(e.code))).toEqual([]);
    }
  });

  it("recognizes only the owning chart grammar's directive syntax", () => {
    for (const kind of ["journey", "pie", "xychart", "xychart-beta", "sankey", "sankey-beta", "quadrantChart", "gantt", "radar", "radar-beta", "treemap", "treemap-beta"]) {
      for (const statement of ['click item "example.com"', "style item", "class item red", "linkStyle 0"]) {
        expect(() => glyphChartFromMermaid(`${kind}\n${statement}`), `${kind}: ${statement}`).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
      }
      if (!["treemap", "treemap-beta", "quadrantChart"].includes(kind)) {
        expect(() => glyphChartFromMermaid(`${kind}\nclassDef item`)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
      }
    }
    const source = `gantt
Click button: a,2025-01-01,1d
click a href "https://example.com/a:b"
click a call handler("never"); %% Inert comment: [unbalanced "
click a href "https://example.com" call handler()
click a call handler() href "https://example.com"`;
    observed.set(source, "Gantt: exact href/call directives stay inert");
    exampleHeights.set(source, { chat: 5, web: 5 });
    expect(parse(source).ledger.filter((e) => e.detail?.feature === "click")).toHaveLength(4);
    expect(JSON.stringify(parse(source).marks)).toContain("Click button");
    const treemap = 'treemap\n"Click button": 4\nclassDef theme fill:red;';
    observed.set(treemap, "Treemap: exact classDef stays inert");
    exampleHeights.set(treemap, { chat: 6, web: 6 });
    expect(parse(treemap).ledger.filter((e) => e.detail?.feature === "classDef")).toHaveLength(1);
  });

  it.each(["treemap", "treemap-beta", "gantt"])("strips trailing comments before recognizing %s directives", (kind) => {
    const data = kind === "gantt" ? '"Leaf": a,2025-01-01,1d' : '"Root"\n  "Leaf": 1';
    const directives = kind === "gantt"
      ? ['click a href "https://example.com/%%literal";', 'click a call handler("%%literal")']
      : ['classDef theme fill:red;', 'classDef quoted font-family:"%%literal"'];
    const bare = `${kind}\n${data}\n${directives.join("\n")}`;
    const source = `${kind}\n${data}\n${directives.map((line) => `${line} %% comment: [unbalanced "`).join("\n")}`;
    observed.set(source, `${kind}: trailing directive comments stay inert`);
    exampleHeights.set(source, { chat: 6, web: 6 });
    const spec = parse(source);
    expect(spec.ledger).toEqual(glyphChartFromMermaid(bare).ledger);
    expect(spec.ledger.filter((e) => e.code === "mermaid-degraded" && e.message.startsWith("Kept ") && e.detail?.feature === (kind === "gantt" ? "click" : "classDef"))).toHaveLength(2);
    for (const target of ["chat", "web"] as const) {
      const result = renderExample(source, target);
      expect(result.text).toBe(renderGlyphChartMermaid(bare, { target, width: 72, height: 6 }).text);
      expect(result.text).toContain("Leaf");
      expect(result.text).not.toContain("comment");
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      expect(result.build.resolved.charset).toBe(target === "chat" ? "box" : "braille");
      expect(result.report.ledger.filter((e) => e.detail?.feature === (kind === "gantt" ? "click" : "classDef"))).toHaveLength(2);
      expect(result.build.report.ledger).toEqual(result.report.ledger);
    }
  });

  it("accepts actorless tasks and preserves empty sections without inventing bars", () => {
    const source = examples[4]!.source;
    expect(bars(source).map((b) => b.actors)).toEqual(["", "", "Team, Reviewer"]);
    expect(renderGlyphChartMermaid(source, { target: "chat", width: 72 }).text.split("\n").filter((row) => row.trimEnd() === "Empty")).toHaveLength(2);
  });

  it("repairs out-of-range scores and logs whole-word omissions", () => {
    expect(bars(examples[5]!.source).map((b) => b.x)).toEqual([1, 5]);
    expect(parse(examples[5]!.source).ledger.filter((e) => e.detail?.score !== undefined).map((e) => e.detail?.score)).toEqual([-2, 10]);
    const result = renderGlyphChartMermaid(examples[6]!.source, { target: "chat", width: 72 });
    expect(result.text).not.toMatch(/Supercal/);
    expect(result.text).toContain("Extraordinarilylongactorname, Me");
    expect(result.text).toContain("review");
    expect(result.report.ledger.filter((e) => e.detail?.word !== undefined)).toHaveLength(1);
    const titleResult = renderGlyphChartMermaid(examples[9]!.source, { target: "chat", width: 72 });
    const title = titleResult.text.split("\n")[0]!.trim();
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title).toBe("A lengthy journey heading whose complete words exceed the available");
    expect(titleResult.report.ledger.some((e) => e.detail?.feature === "journey title wider than the viewport")).toBe(true);
  });

  it("fits the target width and scaled web labels with native size errors", () => {
    const source = examples[0]!.source;
    for (const width of [48, 72, 96]) {
      const result = renderGlyphChartMermaid(source, { target: "web", width, textScale: 2 });
      expect(result.text.split("\n").every((row) => [...row].length === width)).toBe(true);
      expect(result.report.ledger.filter((e) => /label-(abbreviated|dropped)/.test(e.code))).toEqual([]);
    }
    expect(() => renderGlyphChartMermaid(source, { textScale: 0 })).toThrow(expect.objectContaining({ code: "bad-text-scale" }));
  });

  it.each(examples)("renders $name in both real target defaults", ({ source }) => {
    for (const target of ["chat", "web"] as const) {
      const result = renderExample(source, target);
      expect(result.build.resolved.charset).toBe(target === "chat" ? "box" : "braille");
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      expect(result.report).toBe(result.build.report);
      expect(result.report.unsupportedGlyphs).toEqual([]);
      expect(result.report.ledger.some((e) => e.code === "mermaid-degraded" && e.detail?.fallback === "journey-summary")).toBe(true);
      expect(result.text).not.toMatch(/NaN|undefined|\x1b/);
      if (target === "web") {
        const preview = document.createElement("pre");
        preview.innerHTML = result.html!;
        expect(preview.textContent).toBe(result.text);
      }
    }
  });

  it("retains normal native rendering and explicit height validation", () => {
    const source = examples[0]!.source, spec = parse(source);
    expect(renderGlyphChartMermaid(source, { target: "chat", width: 72, height: 32 }).text).toBe(renderGlyphChart(spec, { target: "chat", width: 72, height: 32 }).text);
    const auto = renderGlyphChartMermaid(source, { target: "chat", width: 72 });
    expect(auto.build.resolved.height).toBe(9);
    expect(renderGlyphChart({ ...spec }, { target: "chat", width: 72 }).text).toBe(auto.text);
    expect(() => renderGlyphChartMermaid(source, { height: 0 })).toThrow(expect.objectContaining({ code: "bad-size" }));
    expect(() => renderGlyphChartMermaid(source, { width: 1.5 })).toThrow(expect.objectContaining({ code: "bad-size" }));
    for (const broken of ["journey\nBroken", "journey\nTask: bad: Me"]) expect(() => glyphChartFromMermaid(broken)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
  });

  it("writes every example twice at 72 columns and a local web preview", () => {
    const destination = process.env.GLYPH_JOURNEY_ARTIFACT;
    if (!destination) return;
    mkdirSync(dirname(destination), { recursive: true });
    const previews: string[] = [];
    const text = [...observed].map(([source, name]) => `${name}\n\nSOURCE\n${source}\n\n` + (["chat", "web"] as const).map((target) => {
      const result = renderExample(source, target);
      expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
      if (target === "web") previews.push(`<article><h2>${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h2><pre>${result.html}</pre></article>`);
      return `${target.toUpperCase()} (${result.build.resolved.charset}, 72 columns)\n${result.text}\n\nLEDGER\n${result.report.ledger.map((e) => `${e.code}: ${e.message}`).join("\n")}`;
    }).join("\n\n")).join("\n\n" + "=".repeat(72) + "\n\n") + "\n";
    writeFileSync(destination, text);
    const font = readFileSync(join(__dirname, "../../../website/public/fonts/glyph-mono.woff2")).toString("base64");
    writeFileSync(destination.replace(/\.txt$/, ".html"), `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:GlyphMono;src:url(data:font/woff2;base64,${font})}body{background:#10131a;color:#e8eaf0;font:14px system-ui;padding:24px}article{margin:24px 0}pre{font-family:GlyphMono,monospace!important;font-size:16px;line-height:1!important}</style>${previews.join("\n")}`);
    expect(text.match(/72 columns\)/g)).toHaveLength(observed.size * 2);
  });
});
