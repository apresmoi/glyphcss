import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticWorkbenchRender } from "../../components/StaticWorkbench";
import { staticFluid, staticGallery, staticLoader, staticMap, staticSynth, staticWordArt } from "./scenes";
import { staticDiagrams } from "../../features/diagrams/render/staticDiagrams";
import { staticCharts } from "../../features/charts/render/staticCharts";

function checkColoredText(entry: { title: string; text: string; html: string }, colored = true) {
  const window = new Window();
  try {
    window.document.body.innerHTML = renderToStaticMarkup(
      createElement(StaticWorkbenchRender, { entry }),
    );
    const pre = window.document.querySelector("pre[data-static-render]")!;
    expect(pre.textContent).toBe(entry.text);
    expect([...pre.querySelectorAll("*")].every((element) => element.tagName === "SPAN")).toBe(true);
    if (colored)
      expect(
        [...pre.querySelectorAll("span")].some((span) => span.style.color || span.style.backgroundColor),
        entry.title,
      ).toBe(true);
  } finally {
    window.happyDOM.abort();
  }
}

describe("build-time workbench renders", () => {
  it("renders every diagram family from the shared corpus", async () => {
    const result = await staticDiagrams();
    expect(result.initial.source).toContain("flowchart");
    expect(result.examples).toHaveLength(16);
    for (const entry of [result.initial, ...result.examples]) {
      expect(entry.text.trim().length).toBeGreaterThan(30);
      checkColoredText(entry);
    }
    expect(result.examples.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(["sequenceDiagram", "gitGraph", "C4Deployment"]),
    );
  }, 60000);

  it("renders Mermaid charts and native-only presets", () => {
    const result = staticCharts();
    expect(result.examples).toHaveLength(16);
    expect(result.examples.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(["gantt", "radar", "Heatmap", "Funnel", "Area", "Donut"]),
    );
    for (const entry of [result.initial, ...result.examples]) {
      expect(entry.text.trim().length).toBeGreaterThan(30);
      // The library's text/rule structure painter has no colour channels.
      checkColoredText(entry, !["timeline", "packet", "kanban"].includes(entry.title));
    }
  });

  it.each([staticFluid, staticGallery, staticLoader, staticMap, staticSynth, staticWordArt])(
    "renders %s without a browser",
    async (render) => {
      const result = await render();
      expect(result.text.trim().length).toBeGreaterThan(30);
      expect(result.text.split("\n").filter((line) => line.trim()).length).toBeGreaterThan(2);
      checkColoredText(result);
    },
  );

  it("condenses the fluid heading out of a braille field run by the package's own core", async () => {
    const result = await staticFluid();
    const rows = result.text.split("\n");
    expect(rows).toHaveLength(36);
    expect(rows.every((row) => row.length === 120)).toBe(true);
    expect(result.text.replace(/\s/g, "")).toMatch(/^[\u2801-\u28ff]+$/u);
    const window = new Window();
    try {
      window.document.body.innerHTML = `<pre>${result.html}</pre>`;
      // Bright (heading-coloured) cells, by grid position.
      const bright: [number, number][] = [];
      let row = 0,
        col = 0;
      for (const node of window.document.querySelector("pre")!.childNodes) {
        const hex = (node as unknown as HTMLElement).getAttribute?.("style")?.match(/#([\da-f]{6})/i)?.[1];
        const rgb = hex && [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
        for (const char of node.textContent!) {
          if (char === "\n") ((row += 1), (col = 0));
          else {
            if (rgb && Math.min(...rgb) > 200) bright.push([row, col]);
            col += 1;
          }
        }
      }
      // The letters are lit in the heading's colour inside the heading's box; the field is dim.
      expect(bright.length).toBeGreaterThan(40);
      expect(bright.every(([r, c]) => r >= 6 && r < 30 && c >= 18 && c < 102)).toBe(true);
    } finally {
      window.happyDOM.abort();
    }
  });

  it("keeps the default WordArt framing readable across two horizontal lines", async () => {
    expect((await staticWordArt()).text).toMatchSnapshot();
  });

  it("keeps the ETOPO1 world coastline and elevation bands", async () => {
    const result = await staticMap();
    expect(result.text).toMatchSnapshot();
    expect(result.text.split("\n")).toHaveLength(72);
    expect(result.text.split("\n").every((line) => line.length === 160)).toBe(true);
    expect(result.text).toContain("~");
    const window = new Window();
    try {
      window.document.body.innerHTML = result.html;
      const colours = [...window.document.querySelectorAll("span")].map((span) =>
        span.style.color.match(/\d+/g)!.map(Number),
      );
      expect(colours.some(([r, g, b]) => g! > r! && g! > b!), "terrain land palette").toBe(true);
      expect(colours.some(([r, g, b]) => b! > r! && b! > g!), "terrain water palette").toBe(true);
    } finally {
      window.happyDOM.abort();
    }
  });
});
