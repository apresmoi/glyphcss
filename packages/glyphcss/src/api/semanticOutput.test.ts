import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { compileScene } from "./compileScene";
import { createGlyphScene } from "./createGlyphScene";
import { encodeGlyphBuffers } from "../render/cells";
import { defineGlyphEffect, GlyphEffectOutputChannel } from "./effects";
import {
  buildGlyphControlFrame,
  computeGlyphControlContentSha256,
  computeGlyphControlGeometryHashes,
  type GlyphControlSceneManifest,
  type GlyphObjectDictionary,
} from "./controlFrame";

const hash = (digit: string) => digit.repeat(64);
const dictionaryBase: Omit<GlyphObjectDictionary, "contentSha256"> = {
  schemaVersion: "glyph-object-dictionary/v2",
  id: "dictionary/semantic-output",
  font: { id: "font/semantic-output", version: "1", sha256: hash("a") },
  classes: [{ id: 1, name: "quad", semanticGlyph: "Q", controlColor: "#123456" }],
};
const dictionary: GlyphObjectDictionary = {
  ...dictionaryBase,
  contentSha256: computeGlyphControlContentSha256(dictionaryBase),
};
const polygon: Polygon = { vertices: [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]], color: "#ffffff" };

function sceneManifest(polygons: readonly Polygon[]): GlyphControlSceneManifest {
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const base = {
    schemaVersion: "control-scene/v1" as const,
    id: "scene/semantic-output",
    dictionaryId: dictionary.id,
    dictionarySha256: dictionary.contentSha256,
    ...hashes,
    contentSha256: "",
    instances: polygons.map((_, index) => ({ id: `instance/quad-${index}`, classId: 1 })),
    surfaces: polygons.map((_, index) => ({ id: `surface/quad-${index}`, instanceId: `instance/quad-${index}` })),
    polygonSurfaceIds: polygons.map((_, index) => `surface/quad-${index}`),
  };
  return { ...base, contentSha256: computeGlyphControlContentSha256(base) };
}

describe("glyphOutput semantic", () => {
  it("matches B5 raw and colored semantic output in static and runtime scenes", () => {
    const camera = createGlyphOrthographicCamera({ zoom: 8 });
    const manifest = sceneManifest([polygon]);
    const control = buildGlyphControlFrame({ polygons: [polygon], scene: manifest, dictionary, camera, grid: { cols: 12, rows: 8, cellAspect: 2 } });
    const compiled = compileScene({ polygons: [polygon], sceneManifest: manifest, dictionary, glyphOutput: "semantic", camera, cols: 12, rows: 8, useColors: false });
    expect(compiled.inner).toBe(control.semanticAscii);
    const expectedColored = encodeGlyphBuffers(
      control.semanticAscii.replace(/\n/g, "").split(""),
      Array.from(control.semanticColor, (packed) => packed === 0 ? null : `#${(packed & 0xffffff).toString(16).padStart(6, "0")}`),
      12,
      8,
      true,
    );
    expect(compileScene({ polygons: [polygon], sceneManifest: manifest, dictionary, glyphOutput: "semantic", camera, cols: 12, rows: 8, useColors: true }).inner).toBe(expectedColored);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const runtime = createGlyphScene(host, { camera, cols: 12, rows: 8, useColors: false });
    runtime.add([polygon]);
    runtime.rerender();
    const visible = runtime.output.textContent;
    runtime.setOptions({ glyphOutput: "semantic", sceneManifest: manifest, dictionary });
    runtime.rerender();
    expect(runtime.output.textContent).toBe(control.semanticAscii);
    runtime.setOptions({ glyphOutput: "visible" });
    runtime.rerender();
    expect(runtime.output.textContent).toBe(visible);
    runtime.destroy();
    host.remove();
  });

  it("publishes immutable base-cell lineage from the committed semantic raster only", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const runtime = createGlyphScene(host, { camera: createGlyphOrthographicCamera({ zoom: 8 }), cols: 12, rows: 8, useColors: false, doubleSided: true });
    runtime.add([polygon]);
    runtime.setOptions({ glyphOutput: "semantic", sceneManifest: sceneManifest([polygon]), dictionary });
    runtime.rerender();
    const frame = runtime.getGlyphSemanticCellFrame();
    expect(frame).not.toBeNull();
    const winner = frame!.cells.find((cell) => cell !== null);
    expect(winner).toMatchObject({ polygonIndex: 0, surfaceId: "surface/quad-0", instanceId: "instance/quad-0", classId: 1, className: "quad", semanticGlyph: "Q", controlColor: "#123456" });
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame!.cells)).toBe(true);
    runtime.setOptions({ glyphOutput: "visible" });
    runtime.rerender();
    expect(runtime.getGlyphSemanticCellFrame()).toBeNull();
    runtime.destroy();
    host.remove();
  });

  it("renders semantic detail layers through the same winner and color encoding", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 8 });
    const manifest = sceneManifest([polygon]);
    const runtime = createGlyphScene(host, { camera, cols: 12, rows: 8, useColors: false, doubleSided: true });
    runtime.add([polygon], { density: 2 });
    runtime.setOptions({ glyphOutput: "semantic", sceneManifest: manifest, dictionary });
    await Promise.resolve();
    expect(host.querySelector<HTMLPreElement>("pre.glyph-output--detail")?.textContent).toContain("Q");
    runtime.destroy();
    host.remove();
  });

  it("rejects non-solid semantic output without changing the prior selection", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const runtime = createGlyphScene(host, { cols: 12, rows: 8, useColors: false });
    runtime.add([polygon]);
    runtime.rerender();
    const before = runtime.output.textContent;
    expect(() => runtime.setOptions({ glyphOutput: "semantic", mode: "wireframe", sceneManifest: sceneManifest([polygon]), dictionary })).toThrow(/solid mode/);
    expect(runtime.getOptions().glyphOutput).toBe("visible");
    expect(runtime.output.textContent).toBe(before);
    runtime.destroy();
    host.remove();
  });

  it("rejects every invalid semantic transition atomically after a visible paint", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 8 });
    const runtime = createGlyphScene(host, { camera, cols: 12, rows: 8, useColors: false });
    const shifted: Polygon = { ...polygon, vertices: polygon.vertices.map(([x, y, z]) => [x + 0.25, y, z]) };
    const other: Polygon = { ...polygon, vertices: polygon.vertices.map(([x, y, z]) => [x + 2, y, z]) };
    runtime.add([polygon, other]);
    runtime.rerender();
    const visible = runtime.output.textContent;
    const visibleOptions = runtime.getOptions();
    const cases: Array<[string, Partial<Parameters<typeof runtime.setOptions>[0]>]> = [
      ["missing manifest", { glyphOutput: "semantic", dictionary }],
      ["missing dictionary", { glyphOutput: "semantic", sceneManifest: sceneManifest([polygon, other]) }],
      ["stale dictionary content hash", { glyphOutput: "semantic", sceneManifest: sceneManifest([polygon, other]), dictionary: { ...dictionary, contentSha256: hash("f") } }],
      ["stale geometry", { glyphOutput: "semantic", sceneManifest: sceneManifest([shifted, other]), dictionary }],
      ["stale polygon order", { glyphOutput: "semantic", sceneManifest: sceneManifest([other, polygon]), dictionary }],
    ];
    for (const [label, partial] of cases) {
      expect(() => runtime.setOptions(partial)).toThrow();
      expect(runtime.output.textContent, label).toBe(visible);
      expect(runtime.getOptions()).toMatchObject(visibleOptions);
      expect(runtime.getOptions().glyphOutput, label).toBe("visible");
    }
    runtime.destroy();
    host.remove();
  });

  it("keeps visible output on the no-winner-buffer path and ignores invalid semantic metadata", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 8 });
    const runtime = createGlyphScene(host, {
      camera,
      cols: 12,
      rows: 8,
      useColors: false,
      sceneManifest: { ...sceneManifest([polygon]), contentSha256: hash("0") },
      dictionary: { ...dictionary, contentSha256: hash("f") },
    });
    runtime.add([polygon]);
    runtime.rerender();
    const scratch = camera as unknown as { __glyphScratch?: { winnerPolygon?: Int32Array | null } };
    expect(runtime.getOptions().glyphOutput).toBe("visible");
    expect(runtime.output.textContent).not.toContain("Q");
    expect(scratch.__glyphScratch?.winnerPolygon).toBeNull();
    runtime.destroy();
    host.remove();
  });

  it("treats an explicit undefined selector as a reset to visible", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const runtime = createGlyphScene(host, { cols: 12, rows: 8, useColors: false, camera: createGlyphOrthographicCamera({ zoom: 8 }) });
    runtime.add([polygon]);
    runtime.setOptions({ glyphOutput: "semantic", sceneManifest: sceneManifest([polygon]), dictionary });
    expect(runtime.getOptions().glyphOutput).toBe("semantic");
    runtime.setOptions({ glyphOutput: undefined });
    expect(runtime.getOptions().glyphOutput).toBe("visible");
    runtime.destroy();
    host.remove();
  });

  it("rejects invalid initial semantic metadata before inserting scene DOM", () => {
    const host = document.createElement("div");
    const manifest = sceneManifest([polygon]);
    const invalid = { ...dictionary, contentSha256: hash("f") };
    expect(() => createGlyphScene(host, { glyphOutput: "semantic", sceneManifest: manifest, dictionary: invalid })).toThrow(/dictionary/);
    expect(host.childElementCount).toBe(0);
  });

  it("bypasses retained effects and the legacy hook without mutating either, then restores visible composition", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const manifest = sceneManifest([polygon]);
    const runtime = createGlyphScene(host, {
      cols: 12,
      rows: 8,
      useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 8 }),
      doubleSided: true,
      temporalBlend: 0.8,
      transformCells(grid) {
        for (let index = 0; index < grid.char.length; index++) if (grid.char[index] === "X") grid.char[index] = "Y";
      },
    });
    runtime.add([polygon]);
    runtime.addEffectLayer({
      effect: defineGlyphEffect({
        evaluate({ target, output }) {
          for (let index = 0; index < output.coverage.length; index++) {
            if (target.coverage[index]! <= 0) continue;
            output.glyph[index] = "X";
            output.coverage[index] = 1;
            output.channels[index] = GlyphEffectOutputChannel.Glyph;
          }
        },
      }),
      params: {},
      blend: "replace",
    });
    await Promise.resolve(); await Promise.resolve();
    expect(runtime.output.textContent).toContain("Y");
    runtime.setOptions({ glyphOutput: "semantic", sceneManifest: manifest, dictionary });
    runtime.rerender();
    expect(runtime.output.textContent).toContain("Q");
    expect(runtime.output.textContent).not.toContain("Y");
    runtime.setOptions({ glyphOutput: "visible" });
    runtime.rerender();
    expect(runtime.output.textContent).toContain("Y");
    runtime.destroy();
    host.remove();
  });
});
