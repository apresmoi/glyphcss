import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { admitRenderedTargetsFixture, buildExactTransitionLanes, checkRenderedTargetAdmission, deriveExactReprojectionEvidence, verifyFrozenB10Bytes } from "../scripts/admit-rendered-targets.mjs";
import { assertExactPairMembership, traceBoundMotion, traceFrameBindings } from "../src/trace-bound-schedule.mjs";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value as Record<string, unknown>).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha = (value: unknown) => hash(canonical(value));
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
async function rendererContractSha256() {
  const workspace = resolve(process.cwd(), "..", ".."), files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name); if (entry.isDirectory()) await visit(path); else if (entry.isFile()) files.push(path);
    }
  };
  await Promise.all(["packages/core/src", "packages/glyphcss/src", "packages/compile/src"].map((path) => visit(join(workspace, path))));
  files.push(
    join(process.cwd(), "src/render-asset-corpus.mjs"),
    join(process.cwd(), "src/asset-corpus-render-worker.mjs"),
    join(workspace, "pnpm-lock.yaml"),
  );
  const digest = createHash("sha256");
  for (const path of files.sort()) digest.update(relative(workspace, path).replaceAll("\\", "/")).update("\0").update(await readFile(path)).update("\0");
  return digest.digest("hex");
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "glyph-rendered-target-admission-"));
  const registry = JSON.parse(await readFile(join(process.cwd(), "reports/asset-registry.json"), "utf8"));
  const authority = registry.assets.find((asset: { admitted: boolean; appearanceDisposition: string; label: string }) => asset.admitted && asset.appearanceDisposition === "exact-rgb" && asset.label === "avocado");
  if (!authority) throw new Error("test exact-rgb registry authority missing");
  const assetId = authority.id as string;
  const nativeConfig = await readFile(join(process.cwd(), "config/asset-corpus.json")), config = JSON.parse(nativeConfig.toString("utf8")), nativeConfigSha = hash(nativeConfig);
  const dataset = join(directory, "native-v3"), assetRoot = join(dataset, assetId.slice("asset/".length));
  const roles = ["visible", "semantic", "selected", "metadata", "indexLookups", "semantic-color-argb", "visible-color-argb", "albedo-rgb-u32", "target-rgb-u32", "coverage-u8", "winner-polygon-i32", "class-id-i32", "instance-id-i32", "surface-id-i32", "depth-f64", "shade-f32", "normal-f32", "world-position-f32", "surface-uv-f32", "tensorSpec", "tensor-keyframe-f32", "depth-normalized-f32", "normal-normalized-f32", "world-position-normalized-f32", "surface-uv-normalized-f32"];
  const variants = [] as any[], targetsByPath = new Map<string, Buffer>();
  for (const [variantIndex, occlusion] of config.trajectory.occlusions.entries()) {
    const pose = { id: "static", kind: "static", clip: null, timeSeconds: null }, variantId = `static--${occlusion.id}`;
    const variantRoot = join(assetRoot, "variants", variantId), controls = join(variantRoot, "controls"); await mkdir(controls, { recursive: true });
    const manifestFiles: Record<string, string> = {}, controlFrames = [], renderedFrames = [], targets = [];
    for (const base of ["scene.json", "dictionary.json"]) { const value = json({ fixture: base }); await writeFile(join(controls, base), value); manifestFiles[base] = hash(value); }
    const bindings = traceFrameBindings(config, { id: variantId, pose, occlusion });
    for (const [index, binding] of bindings.entries()) {
      const id = binding.id, frameRoot = join(controls, "frames", id); await mkdir(frameRoot, { recursive: true });
      const anchorIndex = config.trajectory.anchors.findIndex((anchor: { id: string }) => anchor.id === binding.anchorId);
      const camera = { kind: "orthographic", rotX: 61 + config.trajectory.anchors[anchorIndex].rotXOffset, rotY: 12 + config.trajectory.anchors[anchorIndex].rotYOffset + binding.step * traceBoundMotion(config).max, center: [0.5, 0.5], mat: null, useMat: false, distance: 0, perspective: 0, zoom: 1, stretch: 1, fovScale: 1, target: [0, 0, 0], eyeMode: false };
      const sceneSha = hash(`${variantId}-scene`), moved = binding.role === "adjacent", coveredCell = moved ? 1 : 0;
      const scene = { schemaVersion: "glyph-control-scene/v1", id: `scene/${variantId.replaceAll("--", "/")}`, dictionaryId: "dictionary/fixture", dictionarySha256: "d".repeat(64), geometrySha256: "e".repeat(64), polygonOrderSha256: "f".repeat(64), contentSha256: sceneSha, instances: [{ id: "instance/a", classId: 7 }], surfaces: [{ id: "surface/a", instanceId: "instance/a" }], polygonSurfaceIds: ["surface/a"] };
      const metadata = { cols: 2, rows: 1, cellAspect: 2, supersample: 1, camera, scene, dictionary: { schemaVersion: "glyph-object-dictionary/v2", id: "dictionary/fixture", contentSha256: "d".repeat(64), font: { id: "font/fixture", version: "1", sha256: "a".repeat(64) } } };
      const targetRgb = Buffer.alloc(8), coverage = Buffer.from(moved ? [0, 1] : [1, 0]), winner = Buffer.alloc(8), classId = Buffer.alloc(8), instanceId = Buffer.alloc(8), surfaceId = Buffer.alloc(8), depth = Buffer.alloc(16), shade = Buffer.alloc(8), normal = Buffer.alloc(24), world = Buffer.alloc(24), uv = Buffer.alloc(16);
      const red = 0x12 + variantIndex * 8 + index, emptyCell = 1 - coveredCell; targetRgb.writeUInt32LE((red << 16) | 0x3456, coveredCell * 4);
      for (const map of [winner, classId, instanceId, surfaceId]) { map.writeInt32LE(-1, emptyCell * 4); map.writeInt32LE(map === classId ? 7 : map === winner ? 0 : 0, coveredCell * 4); }
      for (let cell = 0; cell < 2; cell++) {
        depth.writeDoubleLE(cell === coveredCell ? 1 : Number.NaN, cell * 8); shade.writeFloatLE(cell === coveredCell ? 1 : Number.NaN, cell * 4);
        for (let component = 0; component < 3; component++) { normal.writeFloatLE(cell === coveredCell ? (component === 2 ? 1 : 0) : Number.NaN, (cell * 3 + component) * 4); world.writeFloatLE(cell === coveredCell ? component + 1 : Number.NaN, (cell * 3 + component) * 4); }
        uv.writeFloatLE(cell === coveredCell ? 0.25 : Number.NaN, (cell * 2) * 4); uv.writeFloatLE(cell === coveredCell ? 0.5 : Number.NaN, (cell * 2 + 1) * 4);
      }
      const ascii = moved ? " x" : "x ", semantic = moved ? " A" : "A ", colors = Buffer.from(targetRgb), semanticColors = Buffer.from(targetRgb);
      const values: Record<string, Buffer | string> = {
        visible: ascii, semantic, selected: ascii, metadata: json(metadata), indexLookups: json({ instanceLookup: ["instance/a"], surfaceLookup: ["surface/a"] }),
        "visible-color-argb": colors, "semantic-color-argb": semanticColors, "albedo-rgb-u32": Buffer.from(targetRgb), "target-rgb-u32": targetRgb,
        "coverage-u8": coverage, "winner-polygon-i32": winner, "class-id-i32": classId, "instance-id-i32": instanceId, "surface-id-i32": surfaceId,
        "depth-f64": depth, "shade-f32": shade, "normal-f32": normal, "world-position-f32": world, "surface-uv-f32": uv,
        tensorSpec: json({ fixture: true, contentSha256: hash(`tensor-${id}`) })
      };
      const frameFiles: Record<string, string> = {};
      for (const role of roles) { const ext = ["visible", "semantic", "selected"].includes(role) ? "txt" : ["metadata", "indexLookups", "tensorSpec"].includes(role) ? "json" : "bin", path = `frames/${id}/${role}.${ext}`, value = values[role] ?? Buffer.from([index, variantIndex]); await writeFile(join(controls, path), value); manifestFiles[path] = hash(value); frameFiles[role] = path; }
      controlFrames.push({ id, files: frameFiles, tensorSpecSha256: hash(`tensor-${id}`), transition: null });
      const pixels = moved ? [0, 0, 0, 0, red, 0x34, 0x56, 255] : [red, 0x34, 0x56, 255, 0, 0, 0, 0];
      const canvas = createCanvas(2, 1), context = canvas.getContext("2d"); context.putImageData(new ImageData(new Uint8ClampedArray(pixels), 2, 1), 0, 0);
      const png = canvas.toBuffer("image/png"), targetPath = `target-${id}.png`; await writeFile(join(variantRoot, targetPath), png); targetsByPath.set(join(variantRoot, targetPath), png); targets.push(hash(png));
      renderedFrames.push({ ...binding, camera, controlSceneSha256: sceneSha, visibleAsciiSha256: hash(ascii), semanticAsciiSha256: hash(semantic), targetSha256: hash(png), targetPngPath: targetPath, albedoRgbMapPath: frameFiles["albedo-rgb-u32"], targetRgbMapPath: frameFiles["target-rgb-u32"], coverageMapPath: frameFiles["coverage-u8"] });
    }
    const trajectory = { id: config.trajectory.id, seed: config.trajectory.seed, traceAuthority: config.trajectory.traceAuthority, variation: { id: variantId, pose, occlusion }, anchors: config.trajectory.anchors, steps: config.trajectory.steps, lighting: config.trajectory.lighting, frames: bindings, assetId, split: authority.split, splitGroupId: authority.splitGroupId, staticPose: "not-applicable-no-animation" };
    const controlRaw = { schemaVersion: "glyph-control-export/v2", appearanceRgb: "albedo-and-target", glyphOutput: "visible", files: manifestFiles, frames: controlFrames, trajectory };
    const control = { ...controlRaw, contentSha256: sha(controlRaw) }; await writeFile(join(controls, "manifest.json"), json(control));
    variants.push({ id: variantId, pose, occlusion, controlsManifestSha256: control.contentSha256, targets, frames: renderedFrames });
  }
  const runtime = { imageId: `sha256:${"6".repeat(64)}`, baseImage: "fixture", nodeVersion: process.version, sourceFileSetSha256: "7".repeat(64) };
  const decoder = config.assetDecoderParity, bindings = config.assetRenderBindings;
  const normalizationBytes = await readFile(join(process.cwd(), config.controlNormalization)), normalizationValue = JSON.parse(normalizationBytes.toString("utf8"));
  const normalization = { path: `research/ascii-image-generation/${config.controlNormalization}`, contentSha256: sha(normalizationValue), fileSha256: hash(normalizationBytes) };
  const dictionary = JSON.parse(await readFile(join(process.cwd(), config.dictionary), "utf8")), mapping = JSON.parse(await readFile(join(process.cwd(), config.assetClassMapping), "utf8"));
  const taxonomy = { dictionarySha256: dictionary.contentSha256, mappingSha256: mapping.contentSha256 }, classId = mapping.mappings.find((entry: any) => entry.assetId === assetId).classId;
  const renderer = { runtime, configSha256: nativeConfigSha, rendererContractSha256: await rendererContractSha256(), registrySha256: registry.contentSha256, assetRenderBindingsSha256: bindings.contentSha256, assetDecoderParity: { path: `research/ascii-image-generation/${decoder.path}`, contentSha256: decoder.contentSha256, fileSha256: decoder.fileSha256 }, controlNormalization: normalization, dictionarySha256: taxonomy.dictionarySha256, mappingSha256: taxonomy.mappingSha256, classId };
  const assetRaw = { schemaVersion: "glyph-asset-trajectory/v2", population: "exact-rgb", target: { targetStatus: "exact-rgb" }, asset: { id: assetId, split: authority.split, splitGroupId: authority.splitGroupId, sourceGeometrySha256: authority.geometry.sha256, textureIds: authority.textureIds, sourcePackIds: authority.sourcePackIds }, renderer, variants };
  const assetManifest = { ...assetRaw, contentSha256: sha(assetRaw) }; const manifestBytes = Buffer.from(json(assetManifest)); await writeFile(join(assetRoot, "asset-manifest.json"), manifestBytes);
  const aggregate = { schemaVersion: "glyph-asset-corpus-report/v2", runtime, config: { path: "research/ascii-image-generation/config/asset-corpus.json", sha256: nativeConfigSha }, registry: { contentSha256: registry.contentSha256 }, assetRenderBindings: { path: `research/ascii-image-generation/${bindings.path}`, contentSha256: renderer.assetRenderBindingsSha256 }, assetDecoderParity: renderer.assetDecoderParity, controlNormalization: normalization, taxonomy, assets: { exactRgbTargets: "ready-for-remote-render", expectedAdmittedExactRgb: 1, admittedExactRgb: 1 }, rendered: [{ assetId, provenanceSha256: hash(manifestBytes), variants }] };
  const report = join(directory, "asset-corpus.json"); await writeFile(report, json(aggregate));
  const target = [...targetsByPath.keys()][0], png = targetsByPath.get(target)!;
  return { directory, dataset, assetId, report, target, controls: join(assetRoot, "variants/static--none/controls"), aggregate, png };
}

async function resealAsset(item: any, mutate: (asset: any) => void) {
  const path = join(item.dataset, item.assetId.slice("asset/".length), "asset-manifest.json"), asset = JSON.parse(await readFile(path, "utf8"));
  mutate(asset); delete asset.contentSha256; asset.contentSha256 = sha(asset); const bytes = Buffer.from(json(asset)); await writeFile(path, bytes);
  const aggregate = structuredClone(item.aggregate); aggregate.rendered[0].variants = asset.variants; aggregate.rendered[0].provenanceSha256 = hash(bytes); await writeFile(item.report, json(aggregate)); item.aggregate = aggregate;
}

async function resealControl(item: any, variantId: string, mutate: (control: any) => void) {
  const path = join(item.dataset, item.assetId.slice("asset/".length), "variants", variantId, "controls", "manifest.json"), control = JSON.parse(await readFile(path, "utf8"));
  mutate(control); delete control.contentSha256; control.contentSha256 = sha(control); await writeFile(path, json(control));
  await resealAsset(item, (asset) => { asset.variants.find((variant: any) => variant.id === variantId).controlsManifestSha256 = control.contentSha256; });
}

describe("B45 rendered native target admission", () => {
  it("rejects traversal-order-dependent sparse UV bins while retaining an exact local correspondence", () => {
    const makeFrame = (observations: readonly { readonly uv: readonly [number, number]; readonly world: readonly [number, number, number] }[]) => ({
      coverage: observations.map(() => true), winnerPolygon: observations.map(() => 3), surfaceId: observations.map(() => 0), surfaceLookup: ["surface/a"],
      surfaceUv: new Float32Array(observations.flatMap(({ uv }) => uv)), worldPosition: new Float32Array(observations.flatMap(({ world }) => world)),
      normal: new Float32Array(observations.flatMap(() => [0, 0, 1])),
    });
    const observations = [{ uv: [.10, .10] as const, world: [1, 1, 1] as const }, { uv: [.11, .11] as const, world: [1.01, 1.01, 1.01] as const }];
    const target = makeFrame([{ uv: [.1001, .1001] as const, world: [1.0001, 1.0001, 1.0001] as const }]);
    const evidence = deriveExactReprojectionEvidence(makeFrame(observations), target, new Float32Array([1, 0, 0, 0, 0, 1]));
    // The legacy 64² atlas would let the final (blue) source cell overwrite
    // the red source sample in the same bin: 2/3 RGB error, well above B10.
    const legacyLastWriterError = (Math.abs(1 - 0) + Math.abs(0 - 0) + Math.abs(0 - 1)) / 3;
    expect(legacyLastWriterError).toBeGreaterThan(.05);
    expect(Array.from(evidence.reprojectionValid)).toEqual([1]);
    expect(Array.from(evidence.disocclusion)).toEqual([0]);
    expect(Array.from(evidence.warpRgb)).toEqual([1, 0, 0]);

    // RGB is intentionally absent from the geometry-derived mask, and a
    // reversed traversal remains identical because the closest UV/world
    // observation is unambiguous.
    const targetWithMutatedRgb = { ...target, targetRgb: new Float32Array([0, 1, 0]) };
    const reversed = deriveExactReprojectionEvidence(makeFrame([...observations].reverse()), targetWithMutatedRgb, new Float32Array([0, 0, 1, 1, 0, 0]));
    expect(Array.from(reversed.reprojectionValid)).toEqual(Array.from(evidence.reprojectionValid));
    expect(Array.from(reversed.disocclusion)).toEqual(Array.from(evidence.disocclusion));
    expect(Array.from(reversed.warpRgb)).toEqual(Array.from(evidence.warpRgb));

    const unsupported = deriveExactReprojectionEvidence(makeFrame([observations[0]]), target, new Float32Array([1, 0, 0]));
    expect(unsupported.routableCellCount).toBe(1);
    expect(Array.from(unsupported.reprojectionValid)).toEqual([0]);
    expect(Array.from(unsupported.disocclusion)).toEqual([1]);
  });

  it("uses exact spatial indexes with subquadratic distance evaluations at corpus-scale surface density", () => {
    const dense = (side: number, mode: "distributed" | "duplicate-uv" | "epsilon-uv" = "distributed") => {
      const observations = Array.from({ length: side * side }, (_, cell) => {
        const u = (cell % side + .25) / side, v = (Math.floor(cell / side) + .25) / side;
        if (mode === "duplicate-uv") return { uv: [.5, .5] as [number, number], world: [cell, 0, 1] as [number, number, number] };
        if (mode === "epsilon-uv") return { uv: [cell * 2.5e-8, .5] as [number, number], world: [cell, 0, 1] as [number, number, number] };
        return { uv: [u, v] as [number, number], world: [u, v, 1] as [number, number, number] };
      });
      const frame = {
        coverage: new Uint8Array(observations.length).fill(1), winnerPolygon: new Int32Array(observations.length).fill(3), surfaceId: new Int32Array(observations.length), surfaceLookup: ["surface/a"],
        surfaceUv: new Float32Array(observations.flatMap(({ uv }) => uv)), worldPosition: new Float32Array(observations.flatMap(({ world }) => world)), normal: new Float32Array(observations.flatMap(() => [0, 0, 1])),
      };
      return deriveExactReprojectionEvidence(frame, frame, new Float32Array(observations.length * 3).fill(.5));
    };
    const countValid = (value: ReturnType<typeof dense>) => value.reprojectionValid.reduce((sum: number, entry: number) => sum + entry, 0);
    const distributedFourK = dense(64), distributedSixteenK = dense(128);
    const duplicateFourK = dense(64, "duplicate-uv"), duplicateSixteenK = dense(128, "duplicate-uv");
    const epsilonFourK = dense(64, "epsilon-uv"), epsilonSixteenK = dense(128, "epsilon-uv");
    expect(distributedFourK.routableCellCount).toBe(4096);
    expect(distributedSixteenK.routableCellCount).toBe(16384);
    expect(countValid(distributedFourK)).toBe(4096);
    expect(countValid(distributedSixteenK)).toBe(16384);
    // Exact duplicates and distinct points separated by <= epsilon are both
    // conservatively unknown, not arbitrary source-cell picks.
    expect(countValid(duplicateFourK)).toBe(0);
    expect(countValid(duplicateSixteenK)).toBe(0);
    expect(countValid(epsilonFourK)).toBe(0);
    expect(countValid(epsilonSixteenK)).toBe(0);
    // Four times as many points would take ~16× comparisons under either old
    // quadratic loop. The exact k-d queries stay below 6× (measured work,
    // rather than a timing-sensitive wall-clock assertion).
    for (const [fourK, sixteenK] of [[distributedFourK, distributedSixteenK], [duplicateFourK, duplicateSixteenK], [epsilonFourK, epsilonSixteenK]]) {
      expect(sixteenK.distanceEvaluations).toBeLessThan(fourK.distanceEvaluations * 6);
    }
  });

  it("derives trace-bound pairs and rejects cross-anchor/light, skipped, shuffled, duplicate, and unreferenced membership", () => {
    const config = { trajectory: {
      seed: "fixture", traceAuthority: { id: "b39-slow-trace-32-subdivision-v1", segmentId: "slow", traceModule: "src/generate-controls.mjs" },
      anchors: [{ id: "orbit-a", rotXOffset: 0, rotYOffset: 0 }, { id: "orbit-b", rotXOffset: 11, rotYOffset: 37 }],
      steps: [{ id: "keyframe", role: "keyframe", traceOffset: 0 }, { id: "adjacent", role: "adjacent", traceOffset: 1 }],
      lighting: [{ id: "key-a" }, { id: "key-b" }],
    } };
    expect(traceBoundMotion(config)).toMatchObject({ min: .1875, max: .21875, mean: .203125 });
    const bindings = traceFrameBindings(config, { pose: { id: "static" }, occlusion: { id: "none" } });
    expect(bindings).toHaveLength(8);
    expect(assertExactPairMembership(bindings).map((pair: any[]) => pair.map(({ role }: { role: string }) => role))).toEqual([["keyframe", "adjacent"], ["keyframe", "adjacent"], ["keyframe", "adjacent"], ["keyframe", "adjacent"]]);
    const frames = bindings.map((expectedFrame: any) => ({ expectedFrame }));
    expect(buildExactTransitionLanes(frames, config).map((lane: any) => lane.frames.map((frame: any) => frame.expectedFrame.id)))
      .toEqual([["frame-000", "frame-001"], ["frame-002", "frame-003"], ["frame-004", "frame-005"], ["frame-006", "frame-007"]]);
    const shuffled = structuredClone(frames); [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    expect(() => buildExactTransitionLanes(shuffled, config)).toThrow("RENDERED_TARGET_TRANSITION_PAIR_MEMBERSHIP_REBOUND");
    const crossAnchor = structuredClone(frames); crossAnchor[1].expectedFrame.anchorId = "orbit-b";
    expect(() => buildExactTransitionLanes(crossAnchor, config)).toThrow("RENDERED_TARGET_TRANSITION_PAIR_MEMBERSHIP_REBOUND");
    const crossLight = structuredClone(frames); crossLight[1].expectedFrame.lightingId = "key-b";
    expect(() => buildExactTransitionLanes(crossLight, config)).toThrow("RENDERED_TARGET_TRANSITION_PAIR_MEMBERSHIP_REBOUND");
    const skipped = frames.filter((_frame: any, index: number) => index !== 1);
    expect(() => buildExactTransitionLanes(skipped, config)).toThrow("RENDERED_TARGET_TRANSITION_PAIR_MEMBERSHIP_REBOUND");
    const duplicate = [...frames, frames[0]];
    expect(() => buildExactTransitionLanes(duplicate, config)).toThrow("RENDERED_TARGET_TRANSITION_PAIR_MEMBERSHIP_REBOUND");
    const unreferenced = structuredClone(frames); unreferenced.push({ expectedFrame: { ...bindings[0], id: "frame-999", pairId: "pair-unreferenced", trackId: "track-unreferenced" } });
    expect(() => buildExactTransitionLanes(unreferenced, config)).toThrow("RENDERED_TARGET_TRANSITION_PAIR_MEMBERSHIP_REBOUND");
  });
  it("decodes native-v3 targets, binds controls/lineage, and runs unchanged B10", async () => {
    const item = await fixture();
    try {
      const report = await admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] });
      expect(report.exactRgb.admittedFrameCount).toBe(16);
      expect(report.exactRgb.accepted[0]).toMatchObject({ assetId: item.assetId, frameId: "frame-000", b10: { evaluator: "admission-v1", accepted: true } });
      expect(report.exactRgb.accepted.some((entry: any) => entry.b10.metrics["temporal-warp-error"] > 0
        || entry.b10.metrics["correction-magnitude"] > 0 || entry.b10.transition.disoccludedCellCount > 0)).toBe(true);
      const orbit = report.exactRgb.accepted.find((entry: any) => entry.variantId === "static--none" && entry.frameId === "frame-001");
      expect(orbit.b10.transition).toMatchObject({ sourceFrameId: "frame-000", targetFrameId: "frame-001", pairId: "pair-orbit-a--key-a", anchorId: "orbit-a", trackId: "track-orbit-a--key-a", cameraChanged: true });
      expect(orbit.b10.transition.oracleStateSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(orbit.b10.transition.validCellCount + orbit.b10.transition.disoccludedCellCount).toBeGreaterThan(0);
      expect(report).toMatchObject({ status: "fixture-only", productionAdmissible: false });
    } finally { await rm(item.directory, { recursive: true, force: true }); }
  }, 15_000);

  it("fails closed on corrupt pixels, stale controls, provenance tampering, and cross-split duplicate lineage", async () => {
    const item = await fixture();
    try {
      await writeFile(item.target, Buffer.from("not a PNG"));
      await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] })).rejects.toThrow(/PNG_HASH_MISMATCH/);
      await writeFile(item.target, item.png);
      await writeFile(join(item.controls, "frames/frame-000/coverage-u8.bin"), Buffer.from([0, 0]));
      await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] })).rejects.toThrow(/CONTROL_HASH_MISMATCH/);
      await writeFile(join(item.controls, "frames/frame-000/coverage-u8.bin"), Buffer.from([1, 0]));
      const tampered = structuredClone(item.aggregate); tampered.rendered[0].provenanceSha256 = "0".repeat(64); await writeFile(item.report, json(tampered));
      await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] })).rejects.toThrow(/ASSET_MANIFEST_HASH_MISMATCH/);
    } finally { await rm(item.directory, { recursive: true, force: true }); }
  });

  it("rejects a resealed exact-frame camera rebound across angle, zoom, center, target, and adjacent delta", async () => {
    const item = await fixture();
    try {
      const frameId = "frame-001", metadataPath = join(item.controls, `frames/${frameId}/metadata.json`);
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      metadata.camera.rotX += 1; metadata.camera.rotY += 1; metadata.camera.zoom += 1;
      metadata.camera.center = [0.25, 0.75]; metadata.camera.target = [9, 8, 7];
      const metadataBytes = Buffer.from(json(metadata)); await writeFile(metadataPath, metadataBytes);
      await resealControl(item, "static--none", (control) => {
        control.files[control.frames.find((frame: any) => frame.id === frameId).files.metadata] = hash(metadataBytes);
      });
      await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] }))
        .rejects.toThrow(/RENDERED_TARGET_CAMERA_REBOUND/);
    } finally { await rm(item.directory, { recursive: true, force: true }); }
  });

  it("rejects an invented cross-split alias before its separately sealed manifest can enter admission", async () => {
    const item = await fixture();
    try {
      await cp(join(item.dataset, item.assetId.slice("asset/".length)), join(item.dataset, "b"), { recursive: true });
      const source = JSON.parse(await readFile(join(item.dataset, "b/asset-manifest.json"), "utf8"));
      source.asset.split = "test"; source.asset.splitGroupId = "group/b"; delete source.contentSha256; source.contentSha256 = sha(source);
      const bytes = Buffer.from(json(source)); await writeFile(join(item.dataset, "b/asset-manifest.json"), bytes);
      const aggregate = structuredClone(item.aggregate); aggregate.assets.expectedAdmittedExactRgb = 2;
      // The registry itself remains immutable and correctly rejects this
      // invented alias before a forged cross-split target can be admitted.
      aggregate.rendered.push({ ...aggregate.rendered[0], assetId: "asset/b", provenanceSha256: hash(bytes) }); await writeFile(item.report, json(aggregate));
      await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] })).rejects.toThrow(/EXACT_POPULATION_REBOUND|ASSET_REGISTRY_REBOUND/);
    } finally { await rm(item.directory, { recursive: true, force: true }); }
  });

  it("rejects unknown, missing, and corrupt frozen control roles", async () => {
    for (const fault of ["unknown", "missing", "corrupt"] as const) {
      const item = await fixture();
      try {
        if (fault === "corrupt") {
          await writeFile(join(item.controls, "frames/frame-000/world-position-normalized-f32.bin"), Buffer.from("corrupt"));
        } else {
          await resealControl(item, "static--none", (control) => {
            if (fault === "unknown") control.frames[0].files.rogue = control.frames[0].files.visible;
            else delete control.frames[0].files["normal-normalized-f32"];
          });
        }
        await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] })).rejects.toThrow(/CONTROL_(ROLE_SET_INVALID|HASH_MISMATCH)/);
      } finally { await rm(item.directory, { recursive: true, force: true }); }
    }
  }, 30_000);

  it("rejects a consistently resealed subset of the frozen variant schedule", async () => {
    const item = await fixture();
    try {
      await resealAsset(item, (asset) => asset.variants.pop());
      await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] })).rejects.toThrow(/VARIANT_SCHEDULE_REBOUND/);
    } finally { await rm(item.directory, { recursive: true, force: true }); }
  });

  it("rejects identical decoded target pixels regardless of frame identity", async () => {
    const item = await fixture();
    try {
      const variantRoot = join(item.dataset, item.assetId.slice("asset/".length), "variants/static--none"), controls = join(variantRoot, "controls");
      const sourceManifest = JSON.parse(await readFile(join(controls, "manifest.json"), "utf8"));
      const sourceFrame = sourceManifest.frames[0], targetFrame = sourceManifest.frames[1];
      // Clone every ownership- and appearance-coupled payload from frame 000
      // while retaining frame 001's metadata/camera, which must still match its
      // declared adjacent pose. This makes the hostile frame internally valid
      // until duplicate decoded pixels are rejected.
      const copied = new Map<string, Buffer>();
      for (const [role, sourcePath] of Object.entries(sourceFrame.files as Record<string, string>)) {
        if (role === "metadata") continue;
        const payload = await readFile(join(controls, sourcePath));
        const targetPath = targetFrame.files[role];
        await writeFile(join(controls, targetPath), payload); copied.set(role, payload);
      }
      const firstPng = await readFile(join(variantRoot, "target-frame-000.png"));
      await writeFile(join(variantRoot, "target-frame-001.png"), firstPng);
      await resealControl(item, "static--none", (control) => {
        for (const [role, payload] of copied) control.files[control.frames[1].files[role]] = hash(payload);
      });
      await resealAsset(item, (asset) => {
        const variant = asset.variants.find((entry: any) => entry.id === "static--none"), digest = hash(firstPng), source = variant.frames[0], target = variant.frames[1];
        variant.targets[1] = digest; target.targetSha256 = digest;
        target.visibleAsciiSha256 = source.visibleAsciiSha256; target.semanticAsciiSha256 = source.semanticAsciiSha256;
      });
      await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] })).rejects.toThrow(/DUPLICATE_PIXELS/);
    } finally { await rm(item.directory, { recursive: true, force: true }); }
  });

  it("rejects threshold drift from the frozen B10 contract", async () => {
    const [contractBytes, evaluatorBytes, baselineBytes] = await Promise.all([
      readFile(join(process.cwd(), "config/derivations/admission-v1.json")),
      readFile(join(process.cwd(), "src/eval/admission.mjs")),
      readFile(join(process.cwd(), "reports/eval-baseline.json")),
    ]);
    const drifted = JSON.parse(contractBytes.toString("utf8"));
    drifted.thresholds.temporalWarpError += 0.001;
    expect(() => verifyFrozenB10Bytes({ contractBytes: Buffer.from(json(drifted)), evaluatorBytes, baselineBytes }))
      .toThrow(/B10_FROZEN_AUTHORITY_DRIFT/);
  });

  it("rejects a shallow forged report before reconstruction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-rendered-target-forgery-")), path = join(directory, "admission.json");
    try {
      await writeFile(path, json({ schemaVersion: "glyph-rendered-target-admission/v1", status: "admitted", population: "exact-rgb", b10: { evaluator: "admission-v1", contractVersion: "v3" } }));
      await expect(checkRenderedTargetAdmission(path)).rejects.toThrow(/ADMISSION_SCHEMA_INVALID/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects a renderer authority rebound even when the aggregate is otherwise internally consistent", async () => {
    const item = await fixture();
    try {
      const aggregate = structuredClone(item.aggregate);
      aggregate.assetRenderBindings.contentSha256 = "0".repeat(64);
      await writeFile(item.report, json(aggregate));
      await expect(admitRenderedTargetsFixture({ assetReport: item.report, datasetRoot: item.dataset, assetIds: [item.assetId] }))
        .rejects.toThrow(/AGGREGATE_EXTERNAL_AUTHORITY_REBOUND/);
    } finally { await rm(item.directory, { recursive: true, force: true }); }
  });
});
