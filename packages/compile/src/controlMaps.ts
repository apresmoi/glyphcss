/**
 * Node-only, content-addressed serialization of B5/B24/B30/B32 control data.
 * The renderer never imports this module: it accepts immutable control frames
 * captured by glyphcss and publishes a complete directory in one rename.
 */
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { packGlyphControlTensorForNode } from "./controlTensor";
import type { GlyphControlFrame, GlyphControlTensorNormalization, GlyphTemporalControlInputs } from "glyphcss";

/** The frozen B32/reference-corpus contract. */
export const GLYPH_CONTROL_EXPORT_VERSION = "glyph-control-export/v1" as const;
/** B44's explicit appearance-control extension. */
export const GLYPH_CONTROL_APPEARANCE_EXPORT_VERSION = "glyph-control-export/v2" as const;
export type GlyphControlAppearanceRgbExport = "albedo-and-target";

export interface GlyphControlExportFrame {
  /** B5 output from the real post-load polygon order. */
  readonly frame: GlyphControlFrame;
  /** B24 result for this frame; omitted for a keyframe/reset. */
  readonly temporal?: GlyphTemporalControlInputs;
  /** Required binding for B24 temporal maps; prevents stale-source admission. */
  readonly transition?: {
    readonly sourceFrameId: string;
    readonly sourceSceneSha256: string;
    readonly sourcePolygonOrderSha256: string;
  };
  /** Stable trajectory position, defaults to the array position. */
  readonly id?: string;
}

export interface GlyphControlExportOptions {
  readonly destination: string;
  readonly frames: readonly GlyphControlExportFrame[];
  readonly normalization: GlyphControlTensorNormalization;
  /** Default-visible selector used by consumers which only need one text file. */
  readonly glyphOutput?: "visible" | "semantic";
  /**
   * Opt in to B44 appearance maps. Omitting this keeps the frozen v1 export
   * byte-for-byte compatible with the reference-corpus contract.
   */
  readonly appearanceRgb?: GlyphControlAppearanceRgbExport;
  /** Explicitly refuse replacement by default; no partial destination is ever created. */
  readonly overwrite?: boolean;
  /** Test-only fault injection, before publishing the staged directory. */
  readonly failAfterWrites?: number;
  readonly trajectory?: Readonly<Record<string, unknown>>;
}

export interface GlyphControlExportResult {
  readonly destination: string;
  readonly manifestPath: string;
  readonly manifest: GlyphControlExportManifest;
}

interface GlyphControlExportManifestBase {
  readonly schemaVersion: typeof GLYPH_CONTROL_EXPORT_VERSION | typeof GLYPH_CONTROL_APPEARANCE_EXPORT_VERSION;
  readonly glyphOutput: "visible" | "semantic";
  readonly scene: { readonly id: string; readonly contentSha256: string; readonly geometrySha256: string; readonly polygonOrderSha256: string };
  readonly dictionary: { readonly id: string; readonly contentSha256: string };
  readonly normalization: GlyphControlTensorNormalization;
  readonly trajectory: Readonly<Record<string, unknown>> | null;
  readonly frames: readonly { readonly id: string; readonly files: Readonly<Record<string, string>>; readonly tensorSpecSha256: string; readonly transition: GlyphControlExportFrame["transition"] | null }[];
  readonly files: Readonly<Record<string, string>>;
  readonly contentSha256: string;
}

export interface GlyphControlExportManifestV1 extends GlyphControlExportManifestBase {
  readonly schemaVersion: typeof GLYPH_CONTROL_EXPORT_VERSION;
}

export interface GlyphControlExportManifestV2 extends GlyphControlExportManifestBase {
  readonly schemaVersion: typeof GLYPH_CONTROL_APPEARANCE_EXPORT_VERSION;
  readonly appearanceRgb: GlyphControlAppearanceRgbExport;
}

export type GlyphControlExportManifest = GlyphControlExportManifestV1 | GlyphControlExportManifestV2;

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const bytes = (view: ArrayBufferView) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
const rel = (base: string, file: string) => file.slice(base.length + 1).replace(/\\/g, "/");

function stableMapBytes(view: ArrayBufferView): Uint8Array {
  if (view instanceof Float64Array) {
    const stable = new Float64Array(view.length);
    for (let index = 0; index < view.length; index++) {
      const value = view[index]!;
      stable[index] = Number.isFinite(value) ? Number(value.toPrecision(13)) || 0 : Number.isNaN(value) ? Number.NaN : value;
    }
    return bytes(stable);
  }
  if (view instanceof Float32Array) {
    const stable = new Float32Array(view.length);
    for (let index = 0; index < view.length; index++) {
      const value = view[index]!;
      stable[index] = Number.isFinite(value) ? value || 0 : Number.isNaN(value) ? Number.NaN : value;
    }
    return bytes(stable);
  }
  return bytes(view);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function assertFrameIdentity(first: GlyphControlFrame, next: GlyphControlFrame): void {
  const a = first.metadata, b = next.metadata;
  if (a.scene.contentSha256 !== b.scene.contentSha256 || a.scene.geometrySha256 !== b.scene.geometrySha256 || a.scene.polygonOrderSha256 !== b.scene.polygonOrderSha256) throw new TypeError("glyphcss: every exported frame must use the same verified scene and post-load polygon order.");
  if (a.dictionary.contentSha256 !== b.dictionary.contentSha256) throw new TypeError("glyphcss: every exported frame must use the same dictionary.");
}

async function hashFiles(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const file = join(directory, name); const info = await stat(file);
      if (info.isDirectory()) await walk(file);
      else result[rel(root, file)] = digest(await readFile(file));
    }
  };
  await walk(root); return result;
}

/**
 * Serialize a little-endian typed-array map. Float64 values are canonicalized
 * to 13 significant digits and signed zero is normalized at this artifact
 * boundary; runtime frames remain untouched. Across the frozen reference
 * domain this removes <=5.60e-15 platform noise, introduces <=4.99e-13
 * quantization error, and still distinguishes a 1e-10 depth change.
 */
async function writeMap(path: string, value: ArrayBufferView, write: (path: string, data: Uint8Array | string) => Promise<void>): Promise<string> {
  const data = stableMapBytes(value); await write(path, data); return digest(data);
}

/**
 * Stages a complete export beside its destination and atomically renames it only
 * after all raw maps and hashes validate. Existing destinations are never
 * replaced unless `overwrite` is explicitly requested.
 */
export async function writeGlyphControlMaps(options: GlyphControlExportOptions): Promise<GlyphControlExportResult> {
  if (!options.frames.length) throw new RangeError("glyphcss: control export needs at least one frame.");
  const destination = resolve(options.destination);
  const glyphOutput = options.glyphOutput ?? "visible";
  const appearanceRgb = options.appearanceRgb;
  const first = options.frames[0]!.frame;
  for (const entry of options.frames) assertFrameIdentity(first, entry.frame);
  const ids = options.frames.map((entry, index) => entry.id ?? `frame-${String(index).padStart(6, "0")}`);
  if (new Set(ids).size !== ids.length) throw new TypeError("glyphcss: control-export frame ids must be unique.");
  for (let index = 0; index < options.frames.length; index++) {
    const entry = options.frames[index]!;
    if (!entry.temporal && entry.transition) throw new TypeError("glyphcss: a temporal transition requires B24 temporal maps.");
    if (!entry.temporal) continue;
    const sourceId = ids[index - 1];
    if (!entry.transition || index === 0 || entry.transition.sourceFrameId !== sourceId
      || entry.transition.sourceSceneSha256 !== first.metadata.scene.contentSha256
      || entry.transition.sourcePolygonOrderSha256 !== first.metadata.scene.polygonOrderSha256) {
      throw new TypeError("glyphcss: temporal transition is stale or not bound to the immediately preceding control frame.");
    }
  }
  try { await access(destination); if (!options.overwrite) throw new Error(`glyphcss: refusing to overwrite ${destination}.`); } catch (error) { if (!(error as NodeJS.ErrnoException).code || (error as NodeJS.ErrnoException).code !== "ENOENT") { if (!String(error).includes("refusing")) throw error; throw error; } }
  if (options.overwrite) throw new Error("glyphcss: overwrite publication is intentionally unsupported until a recovery ledger is supplied.");
  const parent = dirname(destination); await mkdir(parent, { recursive: true });
  const stage = join(parent, `.${destination.split(/[/\\]/).pop()}.glyph-stage-${randomUUID()}`);
  let writes = 0;
  const write = async (path: string, data: Uint8Array | string): Promise<void> => {
    writes++; if (options.failAfterWrites !== undefined && writes > options.failAfterWrites) throw new Error("glyphcss: injected control-export write failure.");
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, data);
  };
  try {
    await mkdir(stage);
    await write(join(stage, "scene.json"), json(first.metadata.scene));
    await write(join(stage, "dictionary.json"), json(first.metadata.dictionary));
    const frameEntries: GlyphControlExportManifest["frames"][number][] = [];
    for (let index = 0; index < options.frames.length; index++) {
      const entry = options.frames[index]!; const frame = entry.frame; const id = ids[index]!;
      if (!/^[a-z0-9._-]+$/.test(id)) throw new TypeError("glyphcss: control-export frame ids must be path-safe lowercase identifiers.");
      const root = join(stage, "frames", id); const files: Record<string, string> = {};
      const map = async (name: string, value: ArrayBufferView) => { const target = join(root, `${name}.bin`); await writeMap(target, value, write); files[name] = `frames/${id}/${name}.bin`; };
      await write(join(root, "visible.txt"), frame.visibleAscii); files.visible = `frames/${id}/visible.txt`;
      await write(join(root, "semantic.txt"), frame.semanticAscii); files.semantic = `frames/${id}/semantic.txt`;
      await write(join(root, "selected.txt"), glyphOutput === "visible" ? frame.visibleAscii : frame.semanticAscii); files.selected = `frames/${id}/selected.txt`;
      await write(join(root, "metadata.json"), json(frame.metadata)); files.metadata = `frames/${id}/metadata.json`;
      const lookups = { instanceLookup: frame.instanceLookup, surfaceLookup: frame.surfaceLookup };
      await write(join(root, "index-lookups.json"), json(lookups)); files.indexLookups = `frames/${id}/index-lookups.json`;
      for (let cell = 0; cell < frame.coverage.length; cell++) {
        if (frame.coverage[cell] === 0) {
          if (frame.instanceId[cell] !== -1 || frame.surfaceId[cell] !== -1) throw new TypeError("glyphcss: empty index-map cells must use -1.");
        } else if (frame.instanceId[cell]! < 0 || frame.instanceId[cell]! >= frame.instanceLookup.length || frame.surfaceId[cell]! < 0 || frame.surfaceId[cell]! >= frame.surfaceLookup.length) {
          throw new RangeError("glyphcss: instance/surface index map is not bound to its lookup table.");
        }
      }
      await map("semantic-color-argb", frame.semanticColor); await map("visible-color-argb", frame.visibleColor);
      if (appearanceRgb === "albedo-and-target") {
        await map("albedo-rgb-u32", frame.albedoRgb); await map("target-rgb-u32", frame.targetRgb);
      }
      await map("coverage-u8", frame.coverage); await map("winner-polygon-i32", frame.winnerPolygon);
      await map("class-id-i32", frame.classId); await map("instance-id-i32", frame.instanceId); await map("surface-id-i32", frame.surfaceId);
      await map("depth-f64", frame.depth); await map("shade-f32", frame.shade); await map("normal-f32", frame.normal);
      await map("world-position-f32", frame.worldPosition); await map("surface-uv-f32", frame.surfaceUv);
      const packed = packGlyphControlTensorForNode(frame, options.normalization, entry.temporal);
      await write(join(root, "tensor-spec.json"), json(packed.spec)); files.tensorSpec = `frames/${id}/tensor-spec.json`;
      await map("tensor-keyframe-f32", packed.keyframe); if (packed.temporal) await map("tensor-temporal-f32", packed.temporal);
      // These are the frozen B32-normalized geometric controls in independently
      // addressable maps as well as in the packed tensor: planes 5..13.
      const cells = frame.metadata.cols * frame.metadata.rows;
      await map("depth-normalized-f32", packed.keyframe.slice(5 * cells, 6 * cells));
      await map("normal-normalized-f32", packed.keyframe.slice(6 * cells, 9 * cells));
      await map("world-position-normalized-f32", packed.keyframe.slice(9 * cells, 12 * cells));
      await map("surface-uv-normalized-f32", packed.keyframe.slice(12 * cells, 14 * cells));
      if (entry.temporal) { await map("reprojection-valid-f32", entry.temporal.reprojectionValid); await map("disocclusion-f32", entry.temporal.disocclusion); await map("atlas-confidence-f32", entry.temporal.atlasConfidence); await map("warp-rgb-f32", entry.temporal.warpRgb); }
      frameEntries.push({ id, files, tensorSpecSha256: packed.spec.contentSha256, transition: entry.transition ?? null });
    }
    const before = await hashFiles(stage);
    const raw = appearanceRgb === "albedo-and-target"
      ? { schemaVersion: GLYPH_CONTROL_APPEARANCE_EXPORT_VERSION, appearanceRgb, glyphOutput, scene: { id: first.metadata.scene.id, contentSha256: first.metadata.scene.contentSha256, geometrySha256: first.metadata.scene.geometrySha256, polygonOrderSha256: first.metadata.scene.polygonOrderSha256 }, dictionary: { id: first.metadata.dictionary.id, contentSha256: first.metadata.dictionary.contentSha256 }, normalization: options.normalization, trajectory: options.trajectory ?? null, frames: frameEntries, files: before }
      : { schemaVersion: GLYPH_CONTROL_EXPORT_VERSION, glyphOutput, scene: { id: first.metadata.scene.id, contentSha256: first.metadata.scene.contentSha256, geometrySha256: first.metadata.scene.geometrySha256, polygonOrderSha256: first.metadata.scene.polygonOrderSha256 }, dictionary: { id: first.metadata.dictionary.id, contentSha256: first.metadata.dictionary.contentSha256 }, normalization: options.normalization, trajectory: options.trajectory ?? null, frames: frameEntries, files: before };
    const manifest: GlyphControlExportManifest = { ...raw, contentSha256: digest(canonical(raw)) };
    await write(join(stage, "manifest.json"), json(manifest));
    const finalHashes = await hashFiles(stage);
    if (finalHashes["manifest.json"] !== digest(json(manifest))) throw new Error("glyphcss: staged manifest hash validation failed.");
    await rename(stage, destination);
    return { destination, manifestPath: join(destination, "manifest.json"), manifest };
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}
