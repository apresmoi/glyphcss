import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { renderGlyphChartMermaid } from "./mermaid";
import { encodeGlyphChart } from "./render";

interface Preset { type: string; source: string; labels: string[]; height: number }
const types = ["gantt", "treemap", "journey", "timeline", "packet", "kanban"];
const presets = (JSON.parse(readFileSync("../../website/src/features/mermaid/data/examples.json", "utf8")) as Preset[]).filter((e) => types.includes(e.type));
const render = (preset: Preset, target: "chat" | "web") => renderGlyphChartMermaid(preset.source, { target, width: 72, height: preset.height, color: "none" });
const preset = (type: string) => presets.find((example) => example.type === type)!;
const statusExample: Preset = { type: "gantt-combined-status", source: "gantt\n title Combined statuses\n A :crit, active, a, 2026-01-01, 1d\n Longer :done, after a, 1d", labels: ["A", "Longer", "crit,active", "done"], height: 5 };

describe("Mermaid showcase layouts", () => {
  for (const target of ["chat", "web"] as const) {
    it(`folds kanban metadata separators to ASCII in ${target}`, () => {
      const example = preset("kanban");
      for (const width of [72, 120]) {
        const result = renderGlyphChartMermaid(example.source, { target, charset: "ascii", width, color: "none" });
        expect(result.text).toMatch(/^[\x00-\x7f]*$/);
        for (const label of example.labels) expect(result.text).toContain(label);
        if (width === 120) expect(result.text).toContain("#241 - Mia - High");
      }
    });

    it(`keeps within-section Gantt gaps equal at 30 rows in ${target}`, () => {
      const example = preset("gantt");
      const lines = renderGlyphChartMermaid(example.source, { target, width: 72, height: 30, color: "none" }).text.split("\n");
      const gaps = [["Interviews", "Prototype", "Sign off"], ["API", "Dashboard", "Integration"], ["Acceptance", "Runbook", "Go live"]].flatMap((tasks) => {
        const rows = tasks.map((task) => lines.findIndex((line) => line.includes(task)));
        expect(rows.every((row) => row >= 0)).toBe(true);
        return rows.slice(1).map((row, i) => row - rows[i]! - 1);
      });
      expect(gaps).toEqual([1, 1, 1, 1, 1, 1]);
      for (const label of example.labels) expect(lines.join("\n")).toContain(label);
    });

    it.each(presets)(`$type keeps every label at 72 columns in ${target}`, (example) => {
      const result = render(example, target);
      expect(result.build.resolved.charset).toBe(target === "chat" ? "box" : "braille");
      const lines = result.text.split("\n");
      expect(lines).toHaveLength(example.height);
      expect(lines.every((line) => [...line].length === 72)).toBe(true);
      for (const label of example.labels) expect(result.text).toContain(label);
      expect(lines.at(-1)!.trim()).not.toBe("");
      const thinned = result.report.ledger.filter((entry) => entry.code === "ticks-thinned");
      expect(thinned.map((entry) => entry.detail)).toEqual(example.type === "gantt" ? [{ axis: "x", shown: 5, stride: 2, total: 10 }] : []);
      expect(result.report.ledger.filter((entry) => /omitted|outside the viewport|label-(dropped|abbreviated)/.test(entry.message + entry.code))).toEqual([]);
    });

    it.each(["journey", "timeline"])(`centres the complete %s body independently of its title in ${target}`, (type) => {
      const result = render(preset(type), target);
      const body = result.text.split("\n").slice(1).filter((line) => line.trim());
      const left = Math.min(...body.map((line) => line.search(/\S/)));
      const right = Math.max(...body.map((line) => line.trimEnd().length));
      expect(left).toBeGreaterThan(0);
      expect(Math.abs(left - (72 - right))).toBeLessThanOrEqual(1);
      if (type === "journey") {
        const bar = target === "web" ? "▄" : "█";
        const tasks = body.filter((line) => line.includes(bar));
        expect(tasks).toHaveLength(8);
        expect(new Set(tasks.map((line) => line.indexOf(bar))).size).toBe(1);
        expect(tasks.map((line) => Number(/([1-5])  Buyer/.exec(line)![1]))).toEqual([4, 3, 2, 3, 2, 5, 4, 5]);
      } else {
        expect(body.filter((line) => line.includes("│ - "))).toHaveLength(13);
      }
    });

    it(`keeps nested treemap branch headers and every complete leaf in ${target}`, () => {
      const result = render(preset("treemap"), target);
      expect(result.report.ledger.filter((entry) => entry.code === "treemap-omitted")).toEqual([]);
      const lines = result.text.split("\n");
      for (const [parent, child] of [["Product", "Experience"], ["Experience", "Portal"], ["Services", "Billing"], ["Platform", "Security"]]) {
        const header = lines.findIndex((line) => line.includes(parent!));
        const leaf = lines.findIndex((line) => line.includes(child!));
        expect(leaf).toBeGreaterThan(header);
        expect(lines[header + 1]).toContain("─");
      }
      expect(result.text).toContain("┬");
      expect(result.text).toContain("├");
      expect(result.text).toContain("┴");
    });

    it(`wraps kanban metadata between whole items and balances lane widths in ${target}`, () => {
      const lines = render(preset("kanban"), target).text.split("\n");
      const top = lines.find((line) => line.includes("┌"))!;
      const widths = [...top.matchAll(/┌─+┐/g)].map((match) => match[0].length);
      expect(widths).toHaveLength(3);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      for (const line of lines) for (const cell of line.split("│").map((cell) => cell.trim()).filter(Boolean)) {
        expect(cell).not.toMatch(/^·|·$/);
        expect(cell).not.toMatch(/Very$/);
      }
      expect(lines.some((line) => line.includes("Very High"))).toBe(true);
      const wide = renderGlyphChartMermaid(preset("kanban").source, { target, width: 120 }).text;
      expect(wide).toContain("#241 · Mia · High");
    });

    it(`pads packet labels and aligns every numbered key with its grid in ${target}`, () => {
      const lines = render(preset("packet"), target).text.split("\n");
      const left = lines.find((line) => line.includes("┌"))!.indexOf("┌");
      const keys = lines.filter((line) => /^\s*\d+\. \[/.test(line));
      expect(keys).toHaveLength(1);
      expect(keys[0]!.search(/\S/)).toBe(left);
      expect(keys[0]).toContain("1. [96-99] Offset");
      expect(keys[0]).toContain("2. [100-103] Reserved");
      for (const line of lines.filter((line) => line.includes("│"))) {
        for (const cell of line.trim().split("│").slice(1, -1)) {
          expect(cell).toMatch(/^ .* $/);
        }
      }
    });

    it(`separates Gantt status from names in an aligned column in ${target}`, () => {
      const result = render(preset("gantt"), target), lines = result.text.split("\n");
      const positions = [["Interviews", "done"], ["Prototype", "done"], ["API", "active"], ["Dashboard", "active"], ["Integration", "crit"], ["Acceptance", "crit"]].map(([label, status]) => {
        const line = lines.find((line) => line.includes(label!))!;
        expect(line).toBeDefined();
        expect(line).toMatch(new RegExp(`${label} {2,}${status}`));
        return line.indexOf(status!);
      });
      expect(new Set(positions).size).toBe(1);
      const combined = render(statusExample, target).text;
      expect(combined).toMatch(/A {2,}crit,active/);
      expect(combined).toMatch(/Longer {2,}done/);
      expect(result.report.ledger.some((entry) => entry.detail?.replacement === "an aligned status column, retaining simultaneous crit/active/done tags")).toBe(true);
    });

    it(`places every treemap leaf value directly below its label in ${target}`, () => {
      const lines = render(preset("treemap"), target).text.split("\n");
      for (const [label, value] of [["Portal", 28], ["Mobile", 22], ["Design", 16], ["API", 26], ["Search", 18], ["Billing", 14], ["Cloud", 24], ["Data", 20], ["Security", 16], ["Tools", 12]] as const) {
        const row = lines.findIndex((line) => line.includes(label));
        const col = lines[row]!.indexOf(label);
        expect(lines[row + 1]!.slice(col, col + String(value).length)).toBe(String(value));
        expect(lines[row]!.slice(col + label.length).split("│")[0]!.trim()).toBe("");
      }
    });

    it(`balances kanban lane heights before minimizing total wraps in ${target}`, () => {
      const example = preset("kanban"), automatic = renderGlyphChartMermaid(example.source, { target, width: 72, color: "none" });
      expect(automatic.text.split("\n")).toHaveLength(20);
      const result = render(example, target);
      expect(result.text).toContain("Audit log");
      for (const id of [241, 242, 243, 238, 239, 235, 236, 231, 232]) expect(result.text).toContain(`#${id}`);
      expect(result.text.match(/High/g)).toHaveLength(6);
      expect(result.report.ledger).toEqual([]);
    });
  }

  it.each(["gantt", "journey"])("separates compact web %s bars with existing half-height block marks", (type) => {
    const example = preset(type), height = type === "gantt" ? 17 : 14;
    for (const color of ["none", "css"] as const) {
      const result = renderGlyphChartMermaid(example.source, { target: "web", width: 72, height, color });
      const bars = result.text.split("\n").filter((line) => /[█▄]/.test(line));
      expect(bars).toHaveLength(type === "gantt" ? 7 : 8);
      expect(bars.every((line) => line.includes("▄") && !line.includes("█"))).toBe(true);
      if (color === "css") expect(result.html).toContain("▄");
      expect(renderGlyphChartMermaid(example.source, { target: "chat", width: 72, height }).text).toContain("█");
    }
  });

  it.each(["gantt", "journey"])("scales the half-height %s bar as one contiguous mark", (type) => {
    for (const scale of [1, 2, 3]) {
      const height = (type === "gantt" ? 17 : 14) * scale;
      const result = renderGlyphChartMermaid(preset(type).source, { target: "web", width: 72 * scale, height, textScale: scale });
      const bars = result.text.split("\n").filter((line) => /[█▄]/.test(line));
      expect(bars).toHaveLength((type === "gantt" ? 7 : 8) * Math.ceil(scale / 2));
      expect(bars.filter((line) => line.includes("▄"))).toHaveLength(scale % 2 ? (type === "gantt" ? 7 : 8) : 0);
    }
  });

  it.each(["gantt", "journey", "timeline"])("spends surplus %s height between complete rows with a bounded gap", (type) => {
    const example = preset(type);
    for (const width of [72, 96]) {
      const result = renderGlyphChartMermaid(example.source, { target: "web", width, height: 32 });
      const lines = result.text.split("\n");
      const labels = type === "gantt" ? ["API", "Dashboard", "Integration"] : type === "journey" ? ["Find the store", "Compare plans", "Ask a question"] : ["April", "May", "June", "July", "August", "September"];
      const positions = labels.map((label) => lines.findIndex((line) => line.includes(label)));
      for (let i = 1; i < positions.length; i++) expect(positions[i]! - positions[i - 1]!).toBeGreaterThanOrEqual(2);
      expect(lines.reduce((last, line, row) => line.trim() ? row : last, -1)).toBeGreaterThanOrEqual(27);
      for (const label of example.labels) expect(result.text).toContain(label);
      expect(result.report.ledger.filter((entry) => /omitted|outside the viewport/.test(entry.message))).toEqual([]);
      const tall = renderGlyphChartMermaid(example.source, { target: "web", width, height: 96 }).text.split("\n");
      expect(tall.reduce((last, line, row) => line.trim() ? row : last, -1)).toBeLessThan(40);
    }
    const compactHeight = { gantt: 17, journey: 14, timeline: 19 }[type]!;
    const compact = renderGlyphChartMermaid(example.source, { target: "chat", width: 72, height: compactHeight });
    for (const label of example.labels) expect(compact.text).toContain(label);
    expect(compact.text.split("\n").at(-1)!.trim()).not.toBe("");
  });

  it("uses visible full point marks for both Gantt milestones including the plot boundary", () => {
    for (const width of [72, 96]) for (const color of ["none", "css"] as const) {
      const result = renderGlyphChartMermaid(preset("gantt").source, { target: "web", width, height: 32, color });
      const lines = result.text.split("\n");
      for (const label of ["Sign off", "Go live"]) expect(lines.find((line) => line.includes(label))).toContain("●");
      expect(result.text.match(/●/g)).toHaveLength(2);
      if (color === "css") expect(result.html).toContain("●");
    }
  });

  it("records requested target renders", () => {
    const path = process.env.GLYPH_PRETTY_ARTIFACT;
    if (!path) return;
    const baseline = process.env.GLYPH_PRETTY_BEFORE;
    const examples: Preset[] = baseline ? JSON.parse(readFileSync(baseline, "utf8")).filter((e: Preset) => types.includes(e.type)) : presets;
    const renders = [...examples, statusExample].flatMap((preset) => ([{ target: "chat", width: 72, height: preset.height }, { target: "web", width: 72, height: preset.height }, { target: "web", width: 96, height: 32 }] as const).map(({ target, width, height }) => {
      const result = renderGlyphChartMermaid(preset.source, { target, width, height, color: "none" });
      expect(result.text.split("\n")).toHaveLength(height);
      expect(result.text.split("\n").every((line) => [...line].length === width)).toBe(true);
      for (const label of preset.labels) expect(result.text).toContain(label);
      const times: number[] = [];
      for (let i = 0; i < 21; i++) { const start = performance.now(); renderGlyphChartMermaid(preset.source, { target, width, height }); times.push(performance.now() - start); }
      const medianMs = times.sort((a, b) => a - b)[10]!;
      expect(medianMs).toBeLessThan(50);
      return { ...preset, width, height, target, charset: result.build.resolved.charset, medianMs, text: result.text, html: target === "web" ? renderGlyphChartMermaid(preset.source, { target, width, height }).html : encodeGlyphChart(result.build, "html"), ledger: result.report.ledger };
    }));
    writeFileSync(path, renders.map((r) => `${r.type} / ${r.target} / ${r.width} columns / ${r.height} rows\nSOURCE\n${r.source}\nRENDER\n${r.text}\n`).join("\n"));
    writeFileSync(path + ".json", JSON.stringify(renders, null, 2));
    expect(renders).toHaveLength(21);
  });
});
