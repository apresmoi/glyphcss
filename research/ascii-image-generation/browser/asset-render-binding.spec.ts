import { expect, test } from "playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.env.GLYPHCSS_REPO_ROOT ?? "/Users/apresmoi/glyphcss";
const source = (path: string) => `/@fs${path}`;
const runtimeSource = source(`${root}/website/src/glyph-runtime.ts`);
const coreSource = source(`${root}/packages/core/src/index.ts`);
const glyphcssSource = source(`${root}/packages/glyphcss/src/index.ts`);
const presetsSource = source(`${root}/website/src/components/GalleryWorkbench/presets/presetList.ts`);

type DecoderParityRecord = {
  sourcePath: string;
  canonicalAssetId: string;
  textureId: string;
  sampleUv: [number, number];
  node: { decodedPixelSha256: string; rgba: [number, number, number, number] };
  browser: { decodedPixelSha256: string | null; rgba: [number, number, number, number] };
  decodedMatches: boolean;
  exactUvSampleMatches: boolean;
};

test("asset-render-binding-browser", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const report = JSON.parse(await readFile(resolve(root, "research/ascii-image-generation/reports/asset-render-bindings.json"), "utf8"));
  await page.goto((process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "/"));
  const actual = await page.evaluate(async ({ report, runtimeSource, coreSource, glyphcssSource, presetsSource, root }) => {
    const runtime = await import(runtimeSource), core = await import(coreSource), glyphcss = await import(glyphcssSource), presets = await import(presetsSource);
    const hex = async (data: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data.slice().buffer as ArrayBuffer))).map((value) => value.toString(16).padStart(2, "0")).join("");
    const presetByPath = new Map<string, { mtlUrl?: string; options?: Record<string, unknown> }>(presets.PRESETS.filter((preset: { url?: string }) => preset.url).map((preset: { url: string; mtlUrl?: string; options?: Record<string, unknown> }) => [preset.url.replace(/^\/gallery\//, "website/public/gallery/"), preset]));
    const evidence = [];
    for (const sourceRecord of report.sourceCoverage) {
      const preset = presetByPath.get(sourceRecord.sourcePath);
      const url = `/@fs${root}/${sourceRecord.sourcePath}`;
      const geometry = await runtime.loadMeshAsGeometry(url, false, preset?.mtlUrl, preset?.options ? { ...preset.options, baseUrl: url } : { baseUrl: url });
      try {
        const samplers = await core.buildTextureSamplers(geometry.polygons, { decodePolicy: "shared-exact" });
        const samplerByByteSha256 = new Map();
        for (const [textureUrl, sampler] of samplers) samplerByByteSha256.set(await hex(new Uint8Array(await (await fetch(textureUrl)).arrayBuffer())), { textureUrl, sampler });
        const records = [];
      for (const expected of sourceRecord.baseColorSources) {
        const found = samplerByByteSha256.get(expected.byteSha256), sampler = found?.sampler;
        const sameUv = (left: readonly number[], right: readonly number[]) => left.length >= 2 && right.length >= 2 && left[0] === right[0] && left[1] === right[1];
        const polygon = found ? geometry.polygons.find((polygon: { vertices: readonly unknown[]; uvs?: readonly (readonly number[])[]; textureTriangles?: readonly { texture?: string; uvs: readonly (readonly number[])[] }[] }) => {
          if (core.polygonTexture(polygon) !== found.textureUrl) return false;
          const hasExpectedUv = (uvs: readonly (readonly number[])[]) => uvs.length >= 3 && uvs.some((uv) => Number.isFinite(uv[0]) && Number.isFinite(uv[1]) && sameUv(uv, expected.sample.uv));
          return polygon.uvs?.length === polygon.vertices.length && hasExpectedUv(polygon.uvs) || polygon.textureTriangles?.some((triangle) => triangle.texture === found.textureUrl && hasExpectedUv(triangle.uvs));
        }) : null;
        const uv = polygon ? expected.sample.uv : null;
        let rendererSample = null;
        let directSample = null;
        if (polygon && uv && sampler) {
          // Keep this independent of the imported mesh's placement and authored tint.
          // The binding gate proves browser decode + UV + raster transport only; B44
          // owns the lit/material target contract.
          const textured = {
            ...polygon,
            vertices: [[-1, -1, 0], [1, -1, 0], [-1, 1, 0]],
            color: "#ffffff",
            material: undefined,
            texture: found.textureUrl,
            uvs: [uv, uv, uv],
            textureTriangles: undefined,
          };
          const dictionaryBase = { schemaVersion: "glyph-object-dictionary/v2", id: "dictionary/browser", font: { id: "font/browser", version: "1", sha256: "b".repeat(64) }, classes: [{ id: 1, name: "asset", semanticGlyph: "A", controlColor: "#ffffff" }] };
          const dictionary = { ...dictionaryBase, contentSha256: glyphcss.computeGlyphControlContentSha256(dictionaryBase) };
          const hashes = glyphcss.computeGlyphControlGeometryHashes([textured]);
          const sceneBase = { schemaVersion: "control-scene/v1", id: "scene/browser", dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes, instances: [{ id: "instance/browser", classId: 1 }], surfaces: [{ id: "surface/browser", instanceId: "instance/browser" }], polygonSurfaceIds: ["surface/browser"] };
          const scene = { ...sceneBase, contentSha256: glyphcss.computeGlyphControlContentSha256(sceneBase) };
          const frame = glyphcss.buildGlyphControlFrame({ polygons: [textured], scene, dictionary, camera: glyphcss.createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 120 }), grid: { cols: 8, rows: 8, cellAspect: 2 }, textureSamplers: new Map([[found.textureUrl, sampler]]), doubleSided: true, directionalLight: { direction: [0, 0, 1], intensity: 0 }, ambientLight: { intensity: 1 } });
          const covered = Array.from(frame.coverage).findIndex(Boolean);
          const direct = core.sampleTexel(sampler, uv[0], uv[1]);
          directSample = direct ? { rgba: [direct.r, direct.g, direct.b, direct.a] } : null;
          rendererSample = covered < 0 ? null : {
            rgb: [frame.targetRgb[covered] >>> 16, frame.targetRgb[covered] >>> 8 & 255, frame.targetRgb[covered] & 255],
            coverage: frame.coverage[covered],
          };
        }
          records.push({ textureId: expected.textureId, decodedPixelSha256: sampler ? await hex(sampler.data) : null, width: sampler?.width ?? null, height: sampler?.height ?? null, uvBound: !!polygon, sampleUv: uv, directSample, rendererSample });
        }
        evidence.push({ sourcePath: sourceRecord.sourcePath, polygonTextureRefCount: geometry.polygons.filter((polygon: unknown) => !!core.polygonTexture(polygon)).length, samplerByteSha256s: [...samplerByByteSha256.keys()].sort(), records });
      } finally {
        geometry.dispose?.();
      }
    }
    return evidence;
  }, { report, runtimeSource, coreSource, glyphcssSource, presetsSource, root });
  const parityRecords: DecoderParityRecord[] = report.sourceCoverage.flatMap((sourceRecord: { sourcePath: string; canonicalAssetId: string; baseColorSources: Array<{ textureId: string; decodedPixelSha256: string; sample: { uv: [number, number]; rgba: [number, number, number, number] } }> }) => sourceRecord.baseColorSources.map((expected): DecoderParityRecord => {
    const browser = actual.find((entry: { sourcePath: string }) => entry.sourcePath === sourceRecord.sourcePath)?.records.find((entry: { textureId: string }) => entry.textureId === expected.textureId);
    if (!browser?.directSample) throw new Error(`browser direct sampler is unavailable: ${sourceRecord.sourcePath}/${expected.textureId}`);
    const decodedMatches = browser.decodedPixelSha256 === expected.decodedPixelSha256;
    const exactUvSampleMatches = browser.directSample.rgba.every((value: number, index: number) => value === expected.sample.rgba[index]);
    return { sourcePath: sourceRecord.sourcePath, canonicalAssetId: sourceRecord.canonicalAssetId, textureId: expected.textureId, sampleUv: expected.sample.uv, node: { decodedPixelSha256: expected.decodedPixelSha256, rgba: expected.sample.rgba }, browser: { decodedPixelSha256: browser.decodedPixelSha256, rgba: browser.directSample.rgba as [number, number, number, number] }, decodedMatches, exactUvSampleMatches };
  }));
  const unique = <T>(records: T[], key: (record: T) => string) => [...new Map(records.map((record) => [key(record), record])).values()];
  const decoderParityBase = {
    sourceRecords: parityRecords.length,
    uniqueTextures: unique(parityRecords, (record) => record.textureId).length,
    sourceDecodedHashMismatches: parityRecords.filter((record) => !record.decodedMatches),
    uniqueDecodedHashMismatches: unique(parityRecords.filter((record) => !record.decodedMatches), (record) => record.textureId),
    sourceExactUvSampleMismatches: parityRecords.filter((record) => !record.exactUvSampleMatches),
    uniqueExactUvSampleMismatches: unique(parityRecords.filter((record) => !record.exactUvSampleMatches), (record) => record.textureId),
  };
  const decoderParity = {
    ...decoderParityBase,
    b44ExactSharedDecoderStatus: decoderParityBase.sourceDecodedHashMismatches.length === 0
      && decoderParityBase.uniqueDecodedHashMismatches.length === 0
      && decoderParityBase.sourceExactUvSampleMismatches.length === 0
      && decoderParityBase.uniqueExactUvSampleMismatches.length === 0 ? "pass" : "fail",
    browserNodeDecoderStatus: decoderParityBase.sourceDecodedHashMismatches.length === 0
      && decoderParityBase.uniqueDecodedHashMismatches.length === 0
      && decoderParityBase.sourceExactUvSampleMismatches.length === 0
      && decoderParityBase.uniqueExactUvSampleMismatches.length === 0 ? "pass" : "fail",
  };
  await testInfo.attach("asset-render-binding-evidence", { body: JSON.stringify({ schemaVersion: "glyph-asset-render-binding-browser/v2", reportSha256: report.contentSha256, records: actual, decoderParity }, null, 2), contentType: "application/json" });
  for (const sourceRecord of report.sourceCoverage) {
    const found = actual.find((entry) => entry.sourcePath === sourceRecord.sourcePath);
    expect(found, sourceRecord.sourcePath).toBeDefined();
    for (const expected of sourceRecord.baseColorSources) {
      const record = found?.records.find((entry) => entry.textureId === expected.textureId);
      expect(record, `${sourceRecord.sourcePath}/${expected.textureId}`).toMatchObject({ width: expected.width, height: expected.height, uvBound: true, sampleUv: expected.sample.uv });
      expect(record?.rendererSample?.coverage, `${sourceRecord.sourcePath}/${expected.textureId} renderer coverage`).toBe(1);
      expect(record?.rendererSample?.rgb, `${sourceRecord.sourcePath}/${expected.textureId} renderer/native sampler transport`).toEqual(record?.directSample?.rgba.slice(0, 3));
    }
    expect(found?.samplerByteSha256s).toEqual(sourceRecord.baseColorSources.map((entry: { byteSha256: string }) => entry.byteSha256).sort());
  }
  // This is a gate, not merely an attachment producer. A parity mismatch must
  // make the remote Playwright invocation fail nonzero and therefore cannot be
  // represented as a passing browser run manifest.
  expect(decoderParity.b44ExactSharedDecoderStatus).toBe("pass");
  expect(decoderParity.browserNodeDecoderStatus).toBe("pass");
  expect(decoderParity.sourceDecodedHashMismatches).toEqual([]);
  expect(decoderParity.uniqueDecodedHashMismatches).toEqual([]);
  expect(decoderParity.sourceExactUvSampleMismatches).toEqual([]);
  expect(decoderParity.uniqueExactUvSampleMismatches).toEqual([]);
});
