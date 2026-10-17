import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderGlyphChartMermaid } from "./mermaid";
import baseline from "./fixtures/mermaidLabelFoldingHashes.json";

const examples = [
  { name: "kanban", source: "kanban\n lane[列東]\n  card[札京]@{ticket: '券西', assigned: '人南', priority: '級北'}", labels: ["列東", "札京", "券西", "人南", "級北"] },
  { name: "journey", source: "journey\nsection 節東\n作京: 4: 人西", labels: ["節東", "作京", "人西"] },
  { name: "timeline", source: "timeline\nsection 節東\n期京 : 事西", labels: ["節東", "期京", "事西"] },
  { name: "packet", source: 'packet\n0-15: "欄東"\n16-31: "欄京"', labels: ["欄東", "欄京"] },
  { name: "gantt", source: "gantt\ndateFormat YYYY-MM-DD\nsection 節東\n作京 :a, 2025-01-01, 2d", labels: ["節東", "作京"] },
  { name: "radar", source: 'radar-beta\naxis a["軸東"], b["軸京"], c["軸西"]\ncurve s["組南"]{3,4,5}\nmax 5\nticks 2', labels: ["軸東", "軸京", "軸西", "組南"] },
  { name: "treemap", source: 'treemap-beta\n"枝東"\n  "葉京": 3\n  "葉西": 2', labels: ["枝東", "葉京", "葉西"] },
  { name: "quadrant", source: "quadrantChart\nx-axis 左東 --> 右京\ny-axis 下西 --> 上南\nquadrant-1 域北\n点中: [0.7,0.7]", labels: ["左東", "右京", "下西", "上南", "域北", "点中"] },
  { name: "xychart", source: 'xychart\nx-axis 軸東 [類京,類西]\ny-axis 軸南 0 --> 5\nline "組北" [2 "点中",4]', labels: ["軸東", "類京", "類西", "軸南", "組北", "点中"] },
  { name: "pie", source: 'pie\n"片東": 3\n"片京": 2', labels: ["片東", "片京"] },
  { name: "sankey", source: "sankey\n源東,先京,3\n先京,終西,3", labels: ["源東", "先京", "終西"] },
  { name: "sankey flow list", source: "sankey\n源東,先京,3\n先京,源東,2", labels: ["源東", "先京"] },
] as const;
const artifacts: { name: string; source: string; target: string; charset: string; text: string; html: string | undefined; ledger: unknown }[] = [];
const hashes: Record<string, string> = {};

describe("Mermaid label folding", () => {
  it.each(examples.flatMap((example) => (["chat", "web"] as const).map((target) => ({ ...example, target }))))("$name/$target logs every folded label", ({ name, source, labels, target }) => {
    const result = renderGlyphChartMermaid(source, { target, width: 72 });
    artifacts.push({ name, source, target, charset: result.build.resolved.charset, text: result.text, html: result.html, ledger: result.report.ledger });
    const key = `${name}/${target}` as keyof typeof baseline;
    hashes[key] = createHash("sha256").update(JSON.stringify([result.text, result.html])).digest("hex");
    expect(hashes[key]).toBe(baseline[key]);
    expect(result.build.resolved.charset).toBe(target === "chat" ? "box" : "braille");
    expect(result.text.split("\n").every((row) => [...row].length === 72)).toBe(true);
    expect(result.text).toContain("??");
    expect(result.report).toBe(result.build.report);
    const folds = result.report.ledger.filter((entry) => entry.code === "label-folded");
    for (const label of labels) {
      expect(folds.some((entry) => String(entry.detail?.before).includes(label)), `${target}: ${label}`).toBe(true);
    }
    expect(folds.every((entry) => String(entry.detail?.after).includes("??"))).toBe(true);
  });
});

afterAll(() => {
  const destination = process.env.GLYPH_LABEL_FOLD_ARTIFACT;
  if (!destination) return;
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, artifacts.map((r) => `${r.name} — ${r.target}/${r.charset}, 72 columns\nSOURCE\n${r.source}\nRENDER\n${r.text}\nLEDGER\n${JSON.stringify(r.ledger, null, 2)}\n`).join("\n"));
  const fontPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../website/public/fonts/glyph-mono.woff2");
  const font = `data:font/woff2;base64,${readFileSync(fontPath).toString("base64")}`;
  writeFileSync(destination.replace(/\.txt$/, ".html"), `<!doctype html><meta charset="utf-8"><title>Mermaid folding</title><style>@font-face{font-family:GlyphMono;src:url("${font}")}body{background:#111;color:#eee}pre{font-family:GlyphMono,monospace;font-size:14px;line-height:1;white-space:pre}</style>${artifacts.filter((r) => r.target === "web").map((r) => `<h2>${r.name}</h2><pre>${r.html}</pre>`).join("\n")}`);
  writeFileSync(destination.replace(/\.txt$/, ".json"), JSON.stringify(hashes, null, 2));
});
