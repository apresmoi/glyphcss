import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { loadMeshFromFile } from "@glyphcss/compile";
import { buildGlyphControlFrame, computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, createGlyphOrthographicCamera } from "glyphcss";
import { loadAssetTaxonomy } from "../scripts/asset-taxonomy.mjs";

const root = process.env.GLYPHCSS_REPO_ROOT ?? "/Users/apresmoi/glyphcss";
const source = (path: string) => `/@fs${path}`;
const glyphcssSource = source(`${root}/packages/glyphcss/src/index.ts`);
const coreSource = source(`${root}/packages/core/src/index.ts`);
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value as Record<string, unknown>).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
    : JSON.stringify(value);

function normalized(polygons: any[]) {
  const vertices = polygons.flatMap((polygon) => polygon.vertices);
  const min = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis])));
  const scale = Math.max(...max.map((value, axis) => value - min[axis])) || 1;
  return polygons.map((polygon) => ({ ...polygon, vertices: polygon.vertices.map((vertex: number[]) => vertex.map((value, axis) => (value - (min[axis] + max[axis]) / 2) * 2 / scale)) }));
}

function sceneFor(polygons: any[], dictionary: any, representative: any) {
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const instanceId = `instance/${representative.assetId.slice("asset/".length)}`;
  const surfaces = polygons.map((_: unknown, index: number) => ({ id: `surface/${representative.assetId.slice("asset/".length)}/${index}`, instanceId }));
  const base = { schemaVersion: "control-scene/v1", id: `scene/${representative.assetId.slice("asset/".length)}`, dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes, instances: [{ id: instanceId, classId: representative.classId }], surfaces, polygonSurfaceIds: surfaces.map((surface) => surface.id) };
  return { ...base, contentSha256: computeGlyphControlContentSha256(base) };
}

function frameHashes(frame: any) {
  const bytes = (value: { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const identity = { scene: frame.metadata.scene, dictionary: frame.metadata.dictionary, instanceLookup: frame.instanceLookup, surfaceLookup: frame.surfaceLookup };
  return {
    semanticAsciiSha256: sha(frame.semanticAscii), semanticColorSha256: sha(bytes(frame.semanticColor)), classIdSha256: sha(bytes(frame.classId)),
    instanceIdSha256: sha(bytes(frame.instanceId)), surfaceIdSha256: sha(bytes(frame.surfaceId)), coverageSha256: sha(bytes(frame.coverage)),
    controlIdentitySha256: sha(canonical(identity)),
  };
}

test("asset-semantic-parity-browser", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const requestFailures: string[] = [];
  page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown failure"})`));
  const taxonomy = await loadAssetTaxonomy();
  const representatives = taxonomy.dictionary.classes
    .filter((entry: any) => (taxonomy.coverage[entry.id] ?? 0) > 0)
    .map((entry: any) => taxonomy.mapping.mappings.find((mapping: any) => mapping.classId === entry.id && mapping.canonicalPath.endsWith(".glb")));
  expect(representatives).toHaveLength(11);
  expect(representatives.every(Boolean)).toBe(true);
  const nodeCases = [];
  for (const representative of representatives) {
    const loaded = await loadMeshFromFile(resolve(root, representative.canonicalPath), { solidTextureSamples: false });
    try {
      const polygons = normalized(loaded.polygons);
      const frame = buildGlyphControlFrame({ polygons, scene: sceneFor(polygons, taxonomy.dictionary, representative), dictionary: taxonomy.dictionary, camera: createGlyphOrthographicCamera({ rotX: 20, rotY: 35, zoom: 14 }), grid: { cols: 28, rows: 20, cellAspect: 2 }, doubleSided: true });
      expect(frame.coverage.some(Boolean), representative.canonicalPath).toBe(true);
      nodeCases.push({ ...representative, semanticGlyph: taxonomy.dictionary.classes.find((entry: any) => entry.id === representative.classId)!.semanticGlyph, controlColor: taxonomy.dictionary.classes.find((entry: any) => entry.id === representative.classId)!.controlColor.toLowerCase(), hashes: frameHashes(frame) });
    } finally { loaded.dispose?.(); }
  }
  const galleryOrigin = (process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "");
  await page.goto(`${galleryOrigin}/robots.txt`);
  let browserCases: any;
  try { browserCases = await page.evaluate(async ({ root, glyphcssSource, coreSource, nodeCases }) => {
    const glyphcss = await import(glyphcssSource), core = await import(coreSource);
    const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
    const hex = async (value: string | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : value.slice().buffer as ArrayBuffer))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const normalized = (polygons: any[]) => { const vertices = polygons.flatMap((polygon) => polygon.vertices); const min = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis]))); const max = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis]))); const scale = Math.max(...max.map((value, axis) => value - min[axis])) || 1; return polygons.map((polygon) => ({ ...polygon, vertices: polygon.vertices.map((vertex: number[]) => vertex.map((value, axis) => (value - (min[axis] + max[axis]) / 2) * 2 / scale)) })); };
    const bytes = (value: any) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const dictionary = await (await fetch(`/@fs${root}/research/ascii-image-generation/config/asset-object-dictionary.json`)).json();
    const mapping = await (await fetch(`/@fs${root}/research/ascii-image-generation/config/asset-class-mapping.json`)).json();
    const registry = await (await fetch(`/@fs${root}/research/ascii-image-generation/reports/asset-registry.json`)).json();
    if (glyphcss.computeGlyphControlContentSha256(dictionary) !== dictionary.contentSha256 || await hex(canonical(mapping)) !== mapping.contentSha256 || mapping.dictionary.contentSha256 !== dictionary.contentSha256 || mapping.registry.contentSha256 !== registry.contentSha256) throw new Error("B50 authority seal is stale or rebound in browser");
    const result = [];
    for (const representative of nodeCases) {
      const mapped = mapping.mappings.find((entry: any) => entry.assetId === representative.assetId);
      const entry = dictionary.classes.find((candidate: any) => candidate.id === representative.classId);
      if (!mapped || mapped.canonicalPath !== representative.canonicalPath || mapped.classId !== representative.classId || !entry || entry.semanticGlyph !== representative.semanticGlyph || entry.controlColor.toLowerCase() !== representative.controlColor) throw new Error(`B50 authority mismatch for ${representative.assetId}`);
      const url = `/@fs${root}/${representative.canonicalPath}`;
      let loaded: any;
      try { loaded = await core.loadMesh(url, { baseUrl: url, solidTextureSamples: false }); } catch (cause) { throw new Error(`asset load failed ${representative.assetId} ${representative.canonicalPath}: ${cause instanceof Error ? cause.message : String(cause)}`); }
      try {
        const polygons = normalized(loaded.polygons), hashes = glyphcss.computeGlyphControlGeometryHashes(polygons), instanceId = `instance/${representative.assetId.slice("asset/".length)}`, surfaces = polygons.map((_: unknown, index: number) => ({ id: `surface/${representative.assetId.slice("asset/".length)}/${index}`, instanceId }));
        const base = { schemaVersion: "control-scene/v1", id: `scene/${representative.assetId.slice("asset/".length)}`, dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes, instances: [{ id: instanceId, classId: representative.classId }], surfaces, polygonSurfaceIds: surfaces.map((surface) => surface.id) };
        const frame = glyphcss.buildGlyphControlFrame({ polygons, scene: { ...base, contentSha256: glyphcss.computeGlyphControlContentSha256(base) }, dictionary, camera: glyphcss.createGlyphOrthographicCamera({ rotX: 20, rotY: 35, zoom: 14 }), grid: { cols: 28, rows: 20, cellAspect: 2 }, doubleSided: true });
        const actual = { semanticAsciiSha256: await hex(frame.semanticAscii), semanticColorSha256: await hex(bytes(frame.semanticColor)), classIdSha256: await hex(bytes(frame.classId)), instanceIdSha256: await hex(bytes(frame.instanceId)), surfaceIdSha256: await hex(bytes(frame.surfaceId)), coverageSha256: await hex(bytes(frame.coverage)), controlIdentitySha256: await hex(canonical({ scene: frame.metadata.scene, dictionary: frame.metadata.dictionary, instanceLookup: frame.instanceLookup, surfaceLookup: frame.surfaceLookup })) };
        result.push({ assetId: representative.assetId, canonicalPath: representative.canonicalPath, classId: representative.classId, semanticGlyph: representative.semanticGlyph, controlColor: representative.controlColor, actual, expected: representative.hashes, verdict: JSON.stringify(actual) === JSON.stringify(representative.hashes) ? "pass" : "fail" });
      } finally { loaded.dispose?.(); }
    }
    return { authorities: { registrySha256: registry.contentSha256, dictionary: { id: dictionary.id, contentSha256: dictionary.contentSha256 }, mapping: { id: mapping.id, contentSha256: mapping.contentSha256 } }, cases: result };
  }, { root, glyphcssSource, coreSource, nodeCases }); } catch (cause) { throw new Error(`asset semantic parity browser evaluation failed: ${cause instanceof Error ? cause.message : String(cause)}; request failures: ${requestFailures.join(" | ") || "none"}`); }
  await testInfo.attach("asset-semantic-parity-evidence", { body: JSON.stringify({ schemaVersion: "glyph-asset-semantic-parity-browser/v1", ...browserCases }, null, 2), contentType: "application/json" });
  expect(browserCases.cases.every((entry: any) => entry.verdict === "pass")).toBe(true);
});
