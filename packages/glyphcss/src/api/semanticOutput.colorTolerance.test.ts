import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { compileScene } from "./compileScene";
import { createGlyphScene } from "./createGlyphScene";
import {
  computeGlyphControlContentSha256,
  computeGlyphControlGeometryHashes,
  type GlyphControlSceneManifest,
  type GlyphObjectDictionary,
} from "./controlFrame";

/**
 * "Semantic-exactness under `colorTolerance`" (adversarial council review of
 * PR #35, finding 3): `glyphOutput: "semantic"` is documented (AGENTS.md,
 * `glyph-scene.mdx`) to be a no-op for `colorTolerance` — the semantic
 * encode is a class-identity lookup, and merging two DIFFERENT classes'
 * `controlColor` runs just because they happen to be near each other would
 * silently corrupt semantic class-identity colors and any control map
 * derived from them. Both call sites currently never forward
 * `colorTolerance` to `encodeGlyphBuffers` at all
 * (`createGlyphScene.ts`'s `encodeSemanticCells`, `compileScene.ts`'s own
 * semantic branch) — this file pins that with a mutation-verified test per
 * encoder, proven non-vacuous by using the SAME near-color pair that DOES
 * merge in visible mode elsewhere (`createGlyphScene.colorTolerance.test.ts`,
 * `rasterize.colorTolerance.test.ts`).
 */

const hash = (digit: string) => digit.repeat(64);
const dictionaryBase: Omit<GlyphObjectDictionary, "contentSha256"> = {
  schemaVersion: "glyph-object-dictionary/v2",
  id: "dictionary/semantic-color-tolerance",
  font: { id: "font/semantic-color-tolerance", version: "1", sha256: hash("a") },
  // Same near-color pair (redmean distance ~3.16) used elsewhere to prove a
  // colorTolerance around 30 DOES merge in visible mode — two DISTINCT
  // classes, so a semantic merge would conflate two different class
  // identities into one run.
  classes: [
    { id: 1, name: "left", semanticGlyph: "L", controlColor: "#802020" },
    { id: 2, name: "right", semanticGlyph: "R", controlColor: "#822020" },
  ],
};
const dictionary: GlyphObjectDictionary = {
  ...dictionaryBase,
  contentSha256: computeGlyphControlContentSha256(dictionaryBase),
};

// Two flat, camera-facing quads, side by side with no gap at x=0 — each
// mapped to its own class below, so the semantic grid is one continuous
// coverage run split by class/color at the midpoint (mirrors
// `nearColorGradientProgram`'s viewport-fill run shape).
function quad(cx: number, color = "#ffffff"): Polygon {
  return { vertices: [[cx - 1, -1, 0], [cx - 1, 1, 0], [cx + 1, 1, 0], [cx + 1, -1, 0]], color };
}
const polygons: Polygon[] = [quad(-1), quad(1)];

function sceneManifest(): GlyphControlSceneManifest {
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const base = {
    schemaVersion: "control-scene/v1" as const,
    id: "scene/semantic-color-tolerance",
    dictionaryId: dictionary.id,
    dictionarySha256: dictionary.contentSha256,
    ...hashes,
    contentSha256: "",
    instances: [
      { id: "instance/left", classId: 1 },
      { id: "instance/right", classId: 2 },
    ],
    surfaces: [
      { id: "surface/left", instanceId: "instance/left" },
      { id: "surface/right", instanceId: "instance/right" },
    ],
    polygonSurfaceIds: ["surface/left", "surface/right"],
  };
  return { ...base, contentSha256: computeGlyphControlContentSha256(base) };
}

const manifest = sceneManifest();
const camera = createGlyphOrthographicCamera({ zoom: 50 });
const cols = 40, rows = 4;

function countSpans(html: string): number {
  return (html.match(/<span/g) ?? []).length;
}

describe("compileScene — glyphOutput: \"semantic\" ignores colorTolerance (compileScene.ts's semantic branch)", () => {
  function semanticInner(colorTolerance: number): string {
    return compileScene({
      polygons, sceneManifest: manifest, dictionary, glyphOutput: "semantic",
      camera, cols, rows, useColors: true, colorTolerance, doubleSided: true,
    }).inner;
  }

  it("renders byte-identically regardless of colorTolerance, even at a tolerance that merges the SAME near-color pair in visible mode", () => {
    const off = semanticInner(0);
    const on = semanticInner(30);
    // Under the mutation this test is written to catch — forwarding
    // `colorTolerance` into the semantic branch's `encodeGlyphBuffers` call
    // — the two classes' near controlColors would merge into one run and
    // `on` would differ from `off`.
    expect(on).toBe(off);
    expect(countSpans(off)).toBe(2); // two distinct class-color spans, no merge
  });

  it("is non-vacuous: the same near-color pair genuinely merges under colorTolerance in VISIBLE mode on this exact geometry", () => {
    // Unlike `polygons` above (both quads plain white — class identity is
    // carried by the dictionary, not polygon color), these two quads carry
    // the near-color pair directly as polygon colors so visible-mode
    // rendering actually exercises colorTolerance's run-merging on them.
    const nearColorPolygons: Polygon[] = [quad(-1, "#802020"), quad(1, "#822020")];
    const render = (colorTolerance: number) =>
      compileScene({ polygons: nearColorPolygons, camera, cols, rows, useColors: true, colorTolerance, doubleSided: true }).inner;
    const visibleOff = render(0);
    const visibleOn = render(30);
    expect(countSpans(visibleOff)).toBe(2); // distinct colors, no merge
    expect(countSpans(visibleOn)).toBeLessThan(countSpans(visibleOff)); // near colors merge into one run
  });
});

describe("createGlyphScene — glyphOutput: \"semantic\" ignores colorTolerance (createGlyphScene.ts's encodeSemanticCells)", () => {
  async function flushRenders(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function semanticOutput(colorTolerance: number): Promise<string> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      camera, cols, rows, useColors: true, colorTolerance, doubleSided: true,
      glyphOutput: "semantic", sceneManifest: manifest, dictionary,
    });
    scene.add(polygons);
    await flushRenders();
    const html = scene.output.innerHTML;
    scene.destroy();
    host.remove();
    return html;
  }

  it("renders byte-identically regardless of colorTolerance, even at a tolerance that merges the SAME near-color pair in visible mode", async () => {
    const off = await semanticOutput(0);
    const on = await semanticOutput(30);
    // Under the mutation this test is written to catch — forwarding
    // `options.colorTolerance` into `encodeSemanticCells`'s
    // `encodeGlyphBuffers` call — the two classes' near controlColors would
    // merge into one run and `on` would differ from `off`.
    expect(on).toBe(off);
    expect(countSpans(off)).toBe(2); // two distinct class-color spans, no merge
  });
});
