import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import dictionaryJson from "../config/glyph-object-dictionary.json";
import coarseRefinerJson from "../browser/coarse-refiner-v1.json";
import {
  GENERATIVE_MAPS,
  GENERATIVE_PRIMITIVES,
  GenerativeWorkbench,
  assertCoarseResponseBinding,
  buildGenerativeCoarseRequest,
  makeGenerativeFixture,
  makeGenerativePolygons,
  nextCoveredCell,
} from "../../../website/src/components/GenerativeWorkbench/GenerativeWorkbench";

const compact = (value: string) => value.replace(/\n/g, "");

describe("GenerativeWorkbench", () => {
  it("binds the exact B32 contract and validates service responses before image decode", () => {
    const primitive = GENERATIVE_PRIMITIVES[0]!;
    const camera = { rotX: 63, rotY: 70, zoom: 55 };
    const fixture = makeGenerativeFixture(primitive, camera);
    const request = buildGenerativeCoarseRequest({
      primitive,
      prompt: " weathered red clay in a quiet studio ",
      styleId: "base",
      seed: 1427,
      camera,
      fixture,
    });
    expect(request.prompt).toBe("weathered red clay in a quiet studio");
    expect(request.controls.tensorContractSha256).toBe("a1e8600ad64f63b119e2113711b235a3007b28416ae03c38c2440eb6ed1c7a3f");
    expect(request.controls.sceneSha256).toBe("38201f4a7604dd864d228e9ecd5ed208db3c2b864502e0d770412ba4d69a65f5");
    const base = {
      id: "native/test/branch-02",
      label: "native",
      image: { mimeType: "image/png", width: 512, height: 512, sha256: "a".repeat(64), url: "http://localhost/image" },
      prompt: { text: request.prompt, tags: [] },
      styleIds: ["base"],
      camera: request.controls.camera,
      controls: { geometry: "cube", sceneId: request.controls.sceneId },
      provenance: {},
    };
    const response = {
      status: "native-pinned-keyframe" as const,
      requestSha256: "b".repeat(64),
      confidence: 1,
      selection: { base, confidence: 1, promptAffinity: 1 },
    };
    expect(assertCoarseResponseBinding(response, request)).toBe(base);
    expect(() => assertCoarseResponseBinding({
      ...response,
      selection: { ...response.selection, base: { ...base, controls: { ...base.controls, geometry: "sphere" } } },
    }, request)).toThrow("different glyph controls");
  });

  it("derives all eight maps from one aligned B5 frame and its exact B32 tensor", () => {
    const { frame, packed } = makeGenerativeFixture();
    const cells = frame.metadata.cols * frame.metadata.rows;

    expect(GENERATIVE_MAPS.map((map) => map.title)).toEqual([
      "Visible ASCII",
      "Semantic ASCII",
      "Depth",
      "Normals",
      "World position",
      "UV",
      "Coverage",
      "Shade",
    ]);
    expect(compact(frame.visibleAscii)).toHaveLength(cells);
    expect(compact(frame.semanticAscii)).toHaveLength(cells);
    expect(packed.width).toBe(frame.metadata.cols);
    expect(packed.height).toBe(frame.metadata.rows);
    expect(packed.keyframe).toHaveLength(17 * cells);
    expect(packed.spec.contract.keyframeWidth).toBe(17);

    for (const map of GENERATIVE_MAPS) {
      if (!("firstPlane" in map)) continue;
      expect(map.firstPlane).toBeGreaterThanOrEqual(5);
      expect(map.firstPlane + map.width).toBeLessThanOrEqual(17);
    }
  });

  it("rebuilds one synchronized frame for every supported primitive", () => {
    const frames = GENERATIVE_PRIMITIVES.map((primitive) => ({ primitive, fixture: makeGenerativeFixture(primitive) }));
    expect(frames.map(({ primitive }) => primitive.id)).toEqual(["cube", "sphere", "prism"]);
    expect(new Set(frames.map(({ fixture }) => fixture.frame.metadata.scene.contentSha256)).size).toBe(frames.length);

    for (const { primitive, fixture } of frames) {
      const cells = fixture.frame.metadata.cols * fixture.frame.metadata.rows;
      expect(fixture.frame.metadata.scene.id).toBe(`generative/${primitive.id}-v1`);
      expect(fixture.frame.metadata.scene.instances[0]?.id).toBe(`generative/${primitive.id}`);
      expect(compact(fixture.frame.visibleAscii)).toHaveLength(cells);
      expect(compact(fixture.frame.semanticAscii)).toHaveLength(cells);
      expect(fixture.packed.keyframe).toHaveLength(17 * cells);
      expect(fixture.frame.coverage.some(Boolean)).toBe(true);
    }
  });

  it("uses equally framed, non-degenerate primitive geometry with face-local UVs", () => {
    const expectedSurfaces = { cube: 6, sphere: 80, prism: 8 };
    for (const primitive of GENERATIVE_PRIMITIVES) {
      const polygons = makeGenerativePolygons(primitive);
      expect(polygons).toHaveLength(expectedSurfaces[primitive.id]);
      const vertices = polygons.flatMap((polygon) => polygon.vertices);
      for (let axis = 0; axis < 3; axis++) {
        const minimum = Math.min(...vertices.map((vertex) => vertex[axis]!));
        const maximum = Math.max(...vertices.map((vertex) => vertex[axis]!));
        expect(minimum).toBeGreaterThanOrEqual(-1);
        expect(maximum).toBeLessThanOrEqual(1);
        expect(maximum - minimum).toBeGreaterThanOrEqual(1.7);
      }
      for (const polygon of polygons) {
        expect(polygon.uvs).toHaveLength(polygon.vertices.length);
        expect(new Set(polygon.uvs!.map(([u, v]) => `${u.toFixed(12)},${v.toFixed(12)}`)).size).toBe(polygon.vertices.length);
        for (const [u, v] of polygon.uvs!) {
          expect(u).toBeGreaterThanOrEqual(0);
          expect(u).toBeLessThanOrEqual(1);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("keeps semantic glyph, color, and winner lineage authoritative for every covered cell", () => {
    const { frame } = makeGenerativeFixture();
    const semantic = compact(frame.semanticAscii);
    let covered = 0;

    for (let cell = 0; cell < frame.coverage.length; cell++) {
      if (!frame.coverage[cell]) continue;
      covered++;
      const polygon = frame.winnerPolygon[cell]!;
      const surface = frame.surfaceLookup[frame.surfaceId[cell]!]!;
      const instance = frame.instanceLookup[frame.instanceId[cell]!]!;
      const entry = dictionaryJson.classes.find((candidate) => candidate.id === frame.classId[cell])!;
      expect(frame.metadata.scene.polygonSurfaceIds[polygon]).toBe(surface);
      expect(surface.startsWith(`${instance}/`)).toBe(true);
      expect(semantic[cell]).toBe(entry.semanticGlyph);
      expect(frame.semanticColor[cell] & 0xffffff).toBe(Number.parseInt(entry.controlColor.slice(1), 16));
    }
    expect(covered).toBeGreaterThan(100);
  });

  it("uses roving covered-cell keyboard navigation", () => {
    const { frame } = makeGenerativeFixture();
    const first = frame.coverage.findIndex(Boolean);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(nextCoveredCell(frame, first, "ArrowDown")).not.toBe(first);
    expect(frame.coverage[nextCoveredCell(frame, first, "ArrowRight")]).toBe(1);
    expect(frame.coverage[nextCoveredCell(frame, first, "ArrowDown")]).toBe(1);
    expect(nextCoveredCell(frame, first, "Enter")).toBe(first);
  });

  it("renders the shared full-screen apparatus with an honest idle retrieval state", () => {
    const html = renderToStaticMarkup(createElement(GenerativeWorkbench));
    expect(html.match(/data-control-panel=/g)).toHaveLength(8);
    expect(html).toContain('data-control-frame-count="1"');
    expect(html).toContain('data-generated-panel="idle"');
    expect(html).toContain("synth-shell dn-root dn-root--generative");
    expect(html).toContain("synth-body");
    expect(html).toContain("synth-voices");
    expect(html).toContain("synth-main");
    expect(html).toContain("synth-viewport gen-viewport");
    expect(html).toContain("synth-presets");
    expect(html).toContain("dn-mobile-tabs");
    expect(html).toContain("IDLE");
    expect(html).toContain("LOCAL RETRIEVAL IDLE");
    expect(html).toContain("Retrieve compatible base");
    expect(html).toContain("No paid or hidden remote call is used");
    expect(html).toContain(coarseRefinerJson.contentSha256.slice(0, 10));
    expect(html).toContain("no untrained IDs are invented");
    expect(html).toContain("Builder · future");
    expect(html).not.toContain("gw-grid");
    expect(html).not.toContain("gw-panel");
  });

  it("fails closed with an accessible error state", () => {
    const html = renderToStaticMarkup(createElement(GenerativeWorkbench, {
      fixtureFactory: () => { throw new Error("fixture rejected"); },
    }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Generative controls unavailable");
    expect(html).toContain("fixture rejected");
    expect(html).not.toContain("Generated image / persistent texture");
  });
});
