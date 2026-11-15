import { describe, it, expect } from "vitest";
import { buildGlyphFramesExport, buildGlyphFramesSvgExport } from "./framesExport";
import { cubePolygons } from "@glyphcss/core";
import type { Polygon, Vec3 } from "@glyphcss/core";

describe("buildGlyphFramesExport", () => {
  const cube = cubePolygons({ center: [0, 0, 0], size: 1 });

  it("bakes N frames into a zero-JS, CSS-animated roll", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 8, cols: 30, rows: 12, autoCenter: true });
    expect(r.frameCount).toBe(8);
    expect(r.pen.js).toBe("");
    expect(r.html).toContain('class="glyph-roll"');
    expect(r.pen.css).toContain("animation:glyph-roll");
    expect(r.pen.css).toContain("steps(8)");
    // ships no glyphcss runtime / mesh
    expect(r.html).not.toMatch(/esm\.sh|createGlyphScene|vertices/);
  });

  it("stacks frameCount equal-size frames in one <pre> (cropped to content)", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 6, cols: 24, rows: 14, autoCenter: true });
    const inner = r.html.replace(/^[\s\S]*?<pre[^>]*>/, "").replace(/<\/pre>[\s\S]*$/, "");
    const lineCount = inner.split("\n").length;
    expect(lineCount % 6).toBe(0);          // equal-size frames
    expect(lineCount).toBeLessThan(6 * 14); // cropped below the rendered grid
    expect(lineCount).toBeGreaterThan(0);
  });

  it("dedupes colors across all frames (one class map)", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 12, cols: 30, rows: 12, autoCenter: true });
    // class refs exist; inline per-run color styles do not
    expect(r.html).toContain('class="c');
    expect(r.html).not.toContain('style="color:');
  });

  it("frame height = cropped rows × line-height", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 4, cols: 20, rows: 14, lineHeightPx: 20, autoCenter: true });
    const inner = r.html.replace(/^[\s\S]*?<pre[^>]*>/, "").replace(/<\/pre>[\s\S]*$/, "");
    const rowsPerFrame = inner.split("\n").length / 4;
    const m = r.pen.css.match(/\.glyph-roll\{height:(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(rowsPerFrame * 20);
  });
});

describe("buildGlyphFramesExport stack layout", () => {
  const cube = cubePolygons({ center: [0, 0, 0], size: 1 });
  const base = { frameCount: 6, cols: 24, rows: 14, autoCenter: true, durationSec: 3 } as const;
  const text = (html: string): string => html.replace(/<[^>]+>/g, "");

  it("leaves the default roll untouched", () => {
    expect(buildGlyphFramesExport(cube, { ...base, layout: "roll" })).toEqual(buildGlyphFramesExport(cube, base));
  });

  it("splits the same frames into one <pre> each", () => {
    const roll = buildGlyphFramesExport(cube, base);
    const stack = buildGlyphFramesExport(cube, { ...base, layout: "stack" });
    const pres = stack.html.match(/<pre[^>]*>[\s\S]*?<\/pre>/g)!;
    expect(pres).toHaveLength(6);
    expect(pres.map(text).join("\n")).toBe(text(roll.html));
    expect(stack.pen.js).toBe("");
  });

  it("shows one frame at a time, each a frame later than the last", () => {
    const { html, pen } = buildGlyphFramesExport(cube, { ...base, layout: "stack" });
    expect(pen.css).toContain("animation:glyph-frame 3s step-end infinite");
    expect(pen.css).toContain("@keyframes glyph-frame{0%{visibility:visible}16.6667%{visibility:hidden}}");
    expect([...html.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => Number(m[1]))).toEqual([0.5, 1, 1.5, 2, 2.5]);
    // The first frame shows without the animation, so the export never rests blank.
    expect(pen.css).toContain(".glyph-output:first-child{visibility:visible}");
    expect(pen.css).not.toContain("opacity");
  });
});

describe("buildGlyphFramesExport lighting and shadows", () => {
  const base = { frameCount: 4, cols: 40, rows: 24, autoCenter: true, rotX: 60, zoom: 12 } as const;

  it("passes the lights to every frame", () => {
    const cube = cubePolygons({ center: [0, 0, 0], size: 1 });
    const lit = buildGlyphFramesExport(cube, { ...base, directionalLight: { direction: [1, 0, 0], intensity: 1 }, ambientLight: { intensity: 0.1 } });
    expect(lit.pen.css).not.toBe(buildGlyphFramesExport(cube, base).pen.css);
  });

  it("casts the model's shadow onto itself only when shadow is set", () => {
    const floor: Polygon = { vertices: [[-8, -8, 0], [8, -8, 0], [8, 8, 0], [-8, 8, 0]], color: "#8899aa" };
    const post = [1, 3, 5].flatMap((z) => cubePolygons({ center: [0, 0, z], size: 2 }));
    const opts = { frameCount: 2, cols: 60, rows: 30, zoom: 100, rotX: 50, rotY: 30, projection: "orthographic", directionalLight: { direction: [1, 0, 0.5] as Vec3, intensity: 1 } } as const;
    const plain = buildGlyphFramesExport([floor, ...post], opts);
    const shadowed = buildGlyphFramesExport([floor, ...post], { ...opts, shadow: { opacity: 0.9, lift: 0 } });
    expect(shadowed.html).not.toBe(plain.html);
    // Same silhouette: a shadow only recolours cells that were already drawn.
    const ink = (html: string): string => html.replace(/<[^>]+>/g, "").replace(/\S/g, "#");
    expect(ink(shadowed.html)).toBe(ink(plain.html));
  });
});

describe("buildGlyphFramesSvgExport", () => {
  const cube = cubePolygons({ center: [0, 0, 0], size: 1 });
  const base = { frameCount: 5, cols: 30, rows: 16, zoom: 300, autoCenter: true, durationSec: 2, fontSizePx: 10 } as const;

  it("is one script-free SVG document sized to the cropped frames", () => {
    const r = buildGlyphFramesSvgExport(cube, base);
    expect(r.frameCount).toBe(5);
    expect(r.svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">`)).toBe(true);
    expect(r.svg.endsWith("</svg>")).toBe(true);
    expect(r.svg).not.toMatch(/<script|@keyframes|animation:/);
    const rows = r.svg.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)![1].split("\n").length;
    expect(r.height).toBe(rows * 10);
    expect(r.width).toBeGreaterThan(0);
  });

  it("carries the same frames as the HTML export", () => {
    const opts = { ...base, cellAspect: 2 };
    const text = (html: string): string => html.replace(/<[^>]+>/g, "");
    const pres = buildGlyphFramesSvgExport(cube, opts).svg.match(/<pre[^>]*>[\s\S]*?<\/pre>/g)!;
    expect(pres).toHaveLength(5);
    expect(pres.map(text).join("\n")).toBe(text(buildGlyphFramesExport(cube, opts).html));
    // XHTML inside an SVG needs its namespace or the text is not laid out.
    for (const pre of pres) expect(pre).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it("shows each frame for one slot of the loop, in order, by SMIL", () => {
    const { svg } = buildGlyphFramesSvgExport(cube, base);
    const frames = [...svg.matchAll(/<g display="(\w+)"><animate attributeName="display" calcMode="discrete" dur="2s" repeatCount="indefinite" values="([^"]+)" keyTimes="([^"]+)"\/>/g)];
    expect(frames).toHaveLength(5);
    expect(frames.map((m) => m[1])).toEqual(["inline", "none", "none", "none", "none"]);
    expect(frames[0]!.slice(2)).toEqual(["inline;none", "0;0.2"]);
    expect(frames[2]!.slice(2)).toEqual(["none;inline;none", "0;0.4;0.6"]);
    // keyTimes must stay inside the loop, so the last frame ends just short of 1.
    expect(frames[4]!.slice(2)).toEqual(["none;inline;none", "0;0.8;0.99999"]);
  });

  it("renders for the cell the SVG draws unless cellAspect is given", () => {
    const fitted = buildGlyphFramesSvgExport(cube, base);
    expect(buildGlyphFramesSvgExport(cube, { ...base, cellAspect: 1 / 0.6 }).svg).toBe(fitted.svg);
    expect(buildGlyphFramesSvgExport(cube, { ...base, cellAspect: 2 }).svg).not.toBe(fitted.svg);
  });
});

describe("buildGlyphFramesExport fit", () => {
  const size = (html: string): [number, number] => {
    const lines = html.replace(/<[^>]+>/g, "").split("\n");
    return [Math.max(...lines.map((l) => l.length)), lines.length / 4];
  };

  it("fills the grid whatever the model's units", () => {
    for (const s of [0.01, 1, 500]) {
      const cube = cubePolygons({ center: [0, 0, 0], size: s });
      for (const projection of ["orthographic", "perspective"] as const) {
        const [w, h] = size(buildGlyphFramesExport(cube, { frameCount: 4, cols: 60, rows: 30, autoCenter: true, fit: true, projection }).html);
        expect(w).toBeLessThanOrEqual(60);
        expect(h).toBeLessThanOrEqual(30);
        // One of the two axes is the tight one.
        expect(Math.max(w / 60, h / 30)).toBeGreaterThan(0.85);
      }
    }
  });
});

describe("buildGlyphFramesExport per-frame geometry", () => {
  const cube = cubePolygons({ center: [0, 0, 0], size: 1 });
  const base = { frameCount: 4, cols: 40, rows: 20, zoom: 300, rotY: 30, autoCenter: true } as const;
  const spinZ = (i: number, n: number): Polygon[] => {
    const a = (i * 2 * Math.PI) / n;
    return cube.map((p) => ({ ...p, vertices: p.vertices.map(([x, y, z]): Vec3 => [Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y, z]) }));
  };
  const ink = (html: string): string => html.replace(/<[^>]+>/g, "").replace(/\S/g, "#");

  it("asks for every frame once per bake and keeps the camera still", () => {
    const calls: number[][] = [];
    const still = buildGlyphFramesExport((i, n) => (calls.push([i, n]), cube), base);
    expect(calls).toEqual([[0, 4], [1, 4], [2, 4], [3, 4]]);
    // Same geometry under a still camera: four identical frames.
    const lines = still.html.replace(/^[\s\S]*?<pre[^>]*>/, "").replace(/<\/pre>[\s\S]*$/, "").split("\n");
    const rows = lines.length / 4;
    for (let f = 1; f < 4; f++) expect(lines.slice(f * rows, (f + 1) * rows)).toEqual(lines.slice(0, rows));
  });

  it("a model turned about z draws the silhouette of the orbit, the other way round", () => {
    const orbit = buildGlyphFramesExport(cube, { ...base, frameCount: 8 });
    const turned = buildGlyphFramesExport((i, n) => spinZ(n - i, n), { ...base, frameCount: 8 });
    expect(ink(turned.html)).toBe(ink(orbit.html));
  });

  it("keeps the light in the world: quarter turns of a cube look alike, where the orbit's frames differ", () => {
    const light = { directionalLight: { direction: [1, 0, 0.3] as Vec3, intensity: 1 }, ambientLight: { intensity: 0.2 } };
    const frames = (html: string): string[] => {
      const lines = html.replace(/^[\s\S]*?<pre[^>]*>/, "").replace(/<\/pre>[\s\S]*$/, "").split("\n");
      return Array.from({ length: 4 }, (_, f) => lines.slice((f * lines.length) / 4, ((f + 1) * lines.length) / 4).join("\n"));
    };
    const turned = frames(buildGlyphFramesExport((i, n) => spinZ(i, n), { ...base, ...light }).html);
    expect(new Set(turned).size).toBe(1);
    // The orbit carries the light round with the model, so each view is lit from another side.
    expect(new Set(frames(buildGlyphFramesExport(cube, { ...base, ...light }).html)).size).toBeGreaterThan(1);
  });
});

describe("buildGlyphFramesExport character modes", () => {
  const cube = cubePolygons({ center: [0, 0, 0], size: 1 });
  const base = { frameCount: 3, cols: 30, rows: 16, zoom: 300, autoCenter: true } as const;

  it("passes charMode and hiddenLines to every frame", () => {
    const wire = { ...base, mode: "wireframe" } as const;
    expect(buildGlyphFramesExport(cube, { ...wire, charMode: "braille" }).html).toMatch(/[\u2800-\u28ff]/);
    expect(buildGlyphFramesExport(cube, wire).html).not.toMatch(/[\u2800-\u28ff]/);
    expect(buildGlyphFramesExport(cube, { ...wire, hiddenLines: "hide" }).html).not.toBe(buildGlyphFramesExport(cube, wire).html);
  });

  it("rejects the solid modes whose cells carry a background colour", () => {
    expect(() => buildGlyphFramesExport(cube, { ...base, charMode: "halfblock" })).toThrow(/cannot encode solid charMode "halfblock"/);
    expect(() => buildGlyphFramesSvgExport(cube, { ...base, charMode: "quadrant" })).toThrow(/cannot encode solid charMode "quadrant"/);
    expect(() => buildGlyphFramesExport(cube, { ...base, mode: "wireframe", charMode: "halfblock" })).not.toThrow();
  });
});
