import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  buildGlyphControlFrame,
  computeGlyphControlContentSha256,
  computeGlyphControlGeometryHashes,
  createGlyphOrthographicCamera,
  cubePolygons,
  packGlyphControlTensor,
  resolveGeometry,
  type GlyphControlFrame,
  type GlyphControlSceneManifest,
  type GlyphControlTensorNormalization,
  type GlyphObjectDictionary,
  type GlyphPackedControlTensors,
  type GlyphGeometryName,
  type Polygon,
} from "glyphcss";
import { Dock } from "../Dock";
import { useDockGui } from "../Dock/slots";
import { useButton, useFolder, useOption, useReadonlyText, useSlider, useText } from "../Dock/primitives";
import {
  InstrumentBody,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentShell,
  InstrumentTray,
  InstrumentViewport,
} from "../InstrumentWorkbench/InstrumentWorkbench";
import dictionaryJson from "../../../../research/ascii-image-generation/config/glyph-object-dictionary.json";
import normalizationJson from "../../../../research/ascii-image-generation/config/control-normalization.json";
import coarseRefinerJson from "../../../../research/ascii-image-generation/browser/coarse-refiner-v1.json";
import {
  runGlyphCoarseRefiner,
  type GlyphCoarseRefinerArtifact,
} from "../../../../research/ascii-image-generation/browser/coarseRefiner";
import "../GalleryWorkbench/gallery-workbench.css";
import "./generative-workbench.css";

const COLS = 42;
const ROWS = 24;
const RAMP = " .:-=+*#%@";
const dictionary = dictionaryJson as GlyphObjectDictionary;
const normalization = normalizationJson as unknown as GlyphControlTensorNormalization;
const coarseRefiner = coarseRefinerJson as unknown as GlyphCoarseRefinerArtifact;
const DEFAULT_SERVICE_URL = "http://127.0.0.1:47331";

export interface GenerativeCamera {
  readonly rotX: number;
  readonly rotY: number;
  readonly zoom: number;
}

const DEFAULT_CAMERA: GenerativeCamera = Object.freeze({ rotX: 63, rotY: 38, zoom: 55 });

export interface GenerativeFixture {
  readonly frame: GlyphControlFrame;
  readonly packed: GlyphPackedControlTensors;
}

export interface GenerativePrimitive {
  readonly id: "cube" | "sphere" | "prism";
  readonly label: string;
  readonly geometry: GlyphGeometryName;
  readonly description: string;
  readonly icon: string;
}

export const GENERATIVE_PRIMITIVES: readonly GenerativePrimitive[] = Object.freeze([
  { id: "cube", label: "Cube", geometry: "cube", description: "6 hard surfaces", icon: "□" },
  { id: "sphere", label: "Sphere", geometry: "sphere", description: "80 faceted surfaces", icon: "◯" },
  { id: "prism", label: "Prism", geometry: "prism", description: "8 explicit surfaces", icon: "⬡" },
]);

type V3 = readonly [number, number, number];
const subtract = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (value: V3): [number, number, number] => {
  const length = Math.hypot(...value);
  if (!(length > 0)) throw new RangeError("Generative primitive contains a degenerate polygon.");
  return [value[0] / length, value[1] / length, value[2] / length];
};

function withFaceUvs(polygons: readonly Polygon[]): Polygon[] {
  return polygons.map((polygon) => {
    if (polygon.vertices.length < 3) throw new RangeError("Generative primitive polygons need at least three vertices.");
    const origin = polygon.vertices[0]!;
    const u = normalize(subtract(polygon.vertices[1]!, origin));
    const normal = normalize(cross(u, subtract(polygon.vertices[2]!, origin)));
    const v = cross(normal, u);
    const projected = polygon.vertices.map((vertex) => {
      const delta = subtract(vertex, origin);
      return [dot(delta, u), dot(delta, v)] as const;
    });
    const minU = Math.min(...projected.map(([value]) => value));
    const maxU = Math.max(...projected.map(([value]) => value));
    const minV = Math.min(...projected.map(([, value]) => value));
    const maxV = Math.max(...projected.map(([, value]) => value));
    const spanU = maxU - minU;
    const spanV = maxV - minV;
    if (!(spanU > 0) || !(spanV > 0)) throw new RangeError("Generative primitive contains a degenerate polygon.");
    return {
      ...polygon,
      uvs: projected.map(([projectedU, projectedV]) => [(projectedU - minU) / spanU, (projectedV - minV) / spanV]),
    };
  });
}

export function makeGenerativePolygons(primitive: GenerativePrimitive): Polygon[] {
  const source = primitive.id === "cube"
    ? cubePolygons({ center: [0, 0, 0], size: 2, color: "#e8edf4" })
    : resolveGeometry(primitive.geometry, { size: 1, color: "#e8edf4" });
  return withFaceUvs(source);
}

export function makeGenerativeFixture(
  primitive: GenerativePrimitive = GENERATIVE_PRIMITIVES[0]!,
  camera: GenerativeCamera = DEFAULT_CAMERA,
): GenerativeFixture {
  const polygons = makeGenerativePolygons(primitive);
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const manifestBase = {
    schemaVersion: "control-scene/v1" as const,
    id: `generative/${primitive.id}-v1`,
    dictionaryId: dictionary.id,
    dictionarySha256: dictionary.contentSha256,
    ...hashes,
    contentSha256: "",
    instances: [{ id: `generative/${primitive.id}`, classId: 1 }],
    surfaces: polygons.map((_, index) => ({ id: `generative/${primitive.id}/face-${index}`, instanceId: `generative/${primitive.id}` })),
    polygonSurfaceIds: polygons.map((_, index) => `generative/${primitive.id}/face-${index}`),
  };
  const scene = { ...manifestBase, contentSha256: computeGlyphControlContentSha256(manifestBase) } satisfies GlyphControlSceneManifest;
  const frame = buildGlyphControlFrame({
    polygons,
    scene,
    dictionary,
    camera: createGlyphOrthographicCamera(camera),
    grid: { cols: COLS, rows: ROWS, cellAspect: 11 / 6, cellWidth: 6, cellHeight: 11 },
    directionalLight: { direction: [0.4, 0.5, 1], intensity: 0.8, color: "#ffffff" },
    ambientLight: { intensity: 0.2, color: "#ffffff" },
    glyphPalette: RAMP,
    supersample: 2,
  });
  return Object.freeze({ frame, packed: packGlyphControlTensor(frame, normalization) });
}

type NumericMapDefinition = {
  readonly title: string;
  readonly short: string;
  readonly detail: string;
  readonly kind: "numeric";
  readonly firstPlane: number;
  readonly width: number;
  readonly display: "scalar" | "vector" | "coverage";
  readonly validityPlane?: number;
};
type MapDefinition =
  | { readonly title: string; readonly short: string; readonly detail: string; readonly kind: "visible" }
  | { readonly title: string; readonly short: string; readonly detail: string; readonly kind: "semantic" }
  | NumericMapDefinition;

export const GENERATIVE_MAPS: readonly MapDefinition[] = Object.freeze([
  { title: "Visible ASCII", short: "VIS", detail: "B5 appearance", kind: "visible" },
  { title: "Semantic ASCII", short: "SEM", detail: "B5 dictionary", kind: "semantic" },
  { title: "Depth", short: "Z", detail: "B32 · p5", kind: "numeric", firstPlane: 5, width: 1, display: "scalar" },
  { title: "Normals", short: "NRM", detail: "B32 · p6–8", kind: "numeric", firstPlane: 6, width: 3, display: "vector" },
  { title: "World position", short: "XYZ", detail: "B32 · p9–11", kind: "numeric", firstPlane: 9, width: 3, display: "vector" },
  { title: "UV", short: "UV", detail: "B32 · p12–13 · valid p14", kind: "numeric", firstPlane: 12, width: 2, display: "vector", validityPlane: 14 },
  { title: "Coverage", short: "COV", detail: "B32 · p15", kind: "numeric", firstPlane: 15, width: 1, display: "coverage" },
  { title: "Shade", short: "LIT", detail: "B32 · p16", kind: "numeric", firstPlane: 16, width: 1, display: "scalar" },
]);

const scalarGlyph = (value: number) => RAMP[Math.round(Math.max(0, Math.min(1, value)) * (RAMP.length - 1))]!;
const compact = (value: string) => value.replace(/\n/g, "");

function colorStyle(color: number): CSSProperties | undefined {
  if (!color) return undefined;
  return { color: `#${(color & 0xffffff).toString(16).padStart(6, "0")}` };
}

function tensorValues(packed: GlyphPackedControlTensors, firstPlane: number, width: number, cell: number): number[] {
  const cells = packed.width * packed.height;
  return Array.from({ length: width }, (_, component) => packed.keyframe[(firstPlane + component) * cells + cell]!);
}

export function nextCoveredCell(frame: GlyphControlFrame, start: number, key: string): number {
  const { cols } = frame.metadata;
  const startRow = Math.floor(start / cols);
  const startCol = start % cols;
  if (key === "Home" || key === "End") {
    const from = key === "Home" ? 0 : cols - 1;
    const direction = key === "Home" ? 1 : -1;
    for (let candidate = from; candidate >= 0 && candidate < cols; candidate += direction) {
      const index = startRow * cols + candidate;
      if (frame.coverage[index]) return index;
    }
    return start;
  }
  if (!key.startsWith("Arrow")) return start;
  let best = start;
  let bestForward = Infinity;
  let bestLateral = Infinity;
  for (let index = 0; index < frame.coverage.length; index++) {
    if (!frame.coverage[index] || index === start) continue;
    const row = Math.floor(index / cols);
    const col = index % cols;
    const forward = key === "ArrowLeft" ? startCol - col
      : key === "ArrowRight" ? col - startCol
        : key === "ArrowUp" ? startRow - row
          : row - startRow;
    if (forward <= 0) continue;
    const lateral = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(row - startRow) : Math.abs(col - startCol);
    if (forward < bestForward || (forward === bestForward && lateral < bestLateral)) {
      best = index;
      bestForward = forward;
      bestLateral = lateral;
    }
  }
  return best;
}

function mapCell(map: MapDefinition, frame: GlyphControlFrame, packed: GlyphPackedControlTensors, index: number): { char: string; style?: CSSProperties; values?: string } {
  if (!frame.coverage[index]) return { char: " " };
  if (map.kind === "visible") return { char: compact(frame.visibleAscii)[index] || " ", style: colorStyle(frame.visibleColor[index] ?? 0) };
  if (map.kind === "semantic") return { char: compact(frame.semanticAscii)[index] || " ", style: colorStyle(frame.semanticColor[index] ?? 0) };
  if (map.validityPlane !== undefined && tensorValues(packed, map.validityPlane, 1, index)[0] !== 1) return { char: "×", values: "uv-unavailable" };
  const values = tensorValues(packed, map.firstPlane, map.width, index);
  const rgb = map.width === 1 ? [values[0]!, values[0]!, values[0]!] : [values[0]!, values[1]!, values[2] ?? 0];
  return {
    char: map.display === "coverage" ? "#" : map.display === "vector" ? "█" : scalarGlyph(values[0]!),
    style: { color: `rgb(${rgb.map((value) => Math.round(value * 255)).join(" ")})` },
    values: values.join(","),
  };
}

function mapText(map: MapDefinition, frame: GlyphControlFrame, packed: GlyphPackedControlTensors): string {
  if (map.kind === "visible") return frame.visibleAscii;
  if (map.kind === "semantic") return frame.semanticAscii;
  const lines = Array.from({ length: frame.metadata.rows }, (_, row) => Array.from({ length: frame.metadata.cols }, (_, col) => {
    const index = row * frame.metadata.cols + col;
    return frame.coverage[index] ? mapCell(map, frame, packed, index).char : " ";
  }).join(""));
  return lines.join("\n");
}

function ControlMap({
  map,
  frame,
  packed,
  selected,
  onSelect,
}: {
  readonly map: MapDefinition;
  readonly frame: GlyphControlFrame;
  readonly packed: GlyphPackedControlTensors;
  readonly selected: number;
  readonly onSelect: (index: number) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextCoveredCell(frame, index, event.key);
    if (next === index) return;
    event.preventDefault();
    onSelect(next);
    event.currentTarget.closest(".gen-control-map")?.querySelector<HTMLElement>(`[data-cell-index="${next}"]`)?.focus();
  };
  return <div
    className="gen-control-map"
    role="grid"
    aria-label={`${map.title} control map`}
    aria-rowcount={frame.metadata.rows}
    aria-colcount={frame.metadata.cols}
    data-cols={frame.metadata.cols}
    data-rows={frame.metadata.rows}
    data-scene-sha256={frame.metadata.scene.contentSha256}
    {...(map.kind === "numeric" ? { "data-first-plane": map.firstPlane, "data-plane-width": map.width } : {})}
  >
    {Array.from({ length: frame.metadata.rows }, (_, row) => <div className="gen-control-row" role="row" key={row}>
      {Array.from({ length: frame.metadata.cols }, (_, col) => {
        const index = row * frame.metadata.cols + col;
        const cell = mapCell(map, frame, packed, index);
        if (!frame.coverage[index]) return <span className="gen-control-cell is-empty" role="gridcell" aria-label={`Empty cell ${col + 1}, ${row + 1}`} data-cell-index={index} key={index}>{" "}</span>;
        return <button
          type="button"
          role="gridcell"
          className="gen-control-cell"
          style={cell.style}
          data-cell-index={index}
          data-values={cell.values}
          tabIndex={index === selected ? 0 : -1}
          aria-pressed={index === selected}
          aria-label={`Select ${map.title} cell ${col + 1}, ${row + 1}`}
          onClick={() => onSelect(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          key={index}
        >{cell.char}</button>;
      })}
    </div>)}
  </div>;
}

type PipelinePhase = "idle" | "retrieving" | "base-ready" | "refining" | "final" | "fallback" | "stale" | "error";

interface CoarseBase {
  readonly id: string;
  readonly label: string;
  readonly image: {
    readonly mimeType: string;
    readonly width: number;
    readonly height: number;
    readonly sha256: string;
    readonly url: string;
  };
  readonly prompt: { readonly text: string; readonly tags: readonly string[] };
  readonly styleIds: readonly string[];
  readonly camera: GenerativeCamera & { readonly projection: "orthographic" };
  readonly controls: { readonly geometry: string; readonly sceneId: string };
  readonly provenance: Record<string, unknown>;
}

export interface CoarseRetrievalResponse {
  readonly status: "matched" | "fallback-required" | "native-pinned-keyframe";
  readonly requestSha256: string;
  readonly confidence: number;
  readonly confidenceThreshold?: number;
  readonly selection: null | {
    readonly base: CoarseBase;
    readonly confidence: number;
    readonly promptAffinity: number;
  };
  readonly fallback?: {
    readonly required: boolean;
    readonly reason: string | null;
    readonly endpoint?: string;
  };
  readonly teacher?: {
    readonly backend: { readonly kind: string; readonly claim: string };
    readonly runId: string;
    readonly runSha256: string;
    readonly manifestContentSha256: string;
    readonly anchorLatentSha256: string;
    readonly selectedBranchId: string;
    readonly branches: readonly {
      readonly id: string;
      readonly seed: number;
      readonly latentSha256: string;
      readonly decodedPreviewSha256: string;
    }[];
    readonly persistedAt?: string;
  };
}

interface LoadedBase {
  readonly base: CoarseBase;
  readonly image: ImageData;
  readonly objectUrl: string;
  readonly requestSha256: string;
  readonly confidence: number;
  readonly source: "library" | "native-pinned-teacher";
  readonly teacher?: NonNullable<CoarseRetrievalResponse["teacher"]>;
  readonly requestBinding: {
    readonly prompt: string;
    readonly style: string;
    readonly geometry: string;
    readonly camera: GenerativeCamera;
  };
}

interface PipelineState {
  readonly phase: PipelinePhase;
  readonly message: string;
  readonly fallbackReason?: string;
}

export interface CoarseBaseRequest {
  readonly schemaVersion: "glyph-coarse-base-request/v1";
  readonly prompt: string;
  readonly seed: number;
  readonly styleId: string;
  readonly controls: {
    readonly geometry: string;
    readonly sceneId: string;
    readonly sceneSha256: string;
    readonly tensorContractSha256: string;
    readonly coverageRatio: number;
    readonly camera: GenerativeCamera & { readonly projection: "orthographic" };
  };
}

export function buildGenerativeCoarseRequest({
  primitive,
  prompt,
  styleId,
  seed,
  camera,
  fixture,
}: {
  readonly primitive: GenerativePrimitive;
  readonly prompt: string;
  readonly styleId: string;
  readonly seed: number;
  readonly camera: GenerativeCamera;
  readonly fixture: GenerativeFixture;
}): CoarseBaseRequest {
  const covered = fixture.frame.coverage.reduce((sum, value) => sum + Number(Boolean(value)), 0);
  return {
    schemaVersion: "glyph-coarse-base-request/v1",
    prompt: prompt.trim(),
    seed,
    styleId,
    controls: {
      geometry: primitive.id,
      sceneId: fixture.frame.metadata.scene.id,
      sceneSha256: fixture.frame.metadata.scene.contentSha256,
      tensorContractSha256: fixture.packed.spec.contractSha256,
      coverageRatio: covered / fixture.frame.coverage.length,
      camera: { projection: "orthographic", ...camera },
    },
  };
}

export function assertCoarseResponseBinding(response: CoarseRetrievalResponse, request: CoarseBaseRequest): CoarseBase {
  const base = response.selection?.base;
  if (!base) throw new Error("The service response did not contain a base.");
  if (base.controls.geometry !== request.controls.geometry || base.controls.sceneId !== request.controls.sceneId) {
    throw new Error("The service response is bound to different glyph controls.");
  }
  if (!base.styleIds.includes(request.styleId)) throw new Error("The service response is bound to a different style slot.");
  if (cameraDivergence(request.controls.camera, base.camera)) {
    throw new Error("The service response is outside the requested camera neighborhood.");
  }
  return base;
}

function byteSha256(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
  );
}

async function decodeBaseImage(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The browser did not provide a 2D image context.");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

function cameraDivergence(current: GenerativeCamera, base: GenerativeCamera): string | null {
  const rotX = Math.abs(current.rotX - base.rotX);
  const rawRotY = Math.abs(current.rotY - base.rotY) % 360;
  const rotY = Math.min(rawRotY, 360 - rawRotY);
  const zoom = Math.abs(current.zoom - base.zoom) / base.zoom;
  if (rotX > 18) return `rotX Δ${rotX.toFixed(1)}° exceeds 18°`;
  if (rotY > 24) return `rotY Δ${rotY.toFixed(1)}° exceeds 24°`;
  if (zoom > 0.25) return `zoom Δ${Math.round(zoom * 100)}% exceeds 25%`;
  return null;
}

function GenerativeDock({
  primitive,
  prompt,
  onPrompt,
  style,
  onStyle,
  frame,
  packed,
  selected,
  serviceUrl,
  onServiceUrl,
  camera,
  onCamera,
  seed,
  onSeed,
  strength,
  onStrength,
  pipeline,
  loadedBase,
  onRetrieve,
  onKeyframe,
  onRefine,
}: {
  readonly primitive: GenerativePrimitive;
  readonly prompt: string;
  readonly onPrompt: (value: string) => void;
  readonly style: string;
  readonly onStyle: (value: string) => void;
  readonly frame: GlyphControlFrame;
  readonly packed: GlyphPackedControlTensors;
  readonly selected: number;
  readonly serviceUrl: string;
  readonly onServiceUrl: (value: string) => void;
  readonly camera: GenerativeCamera;
  readonly onCamera: (value: GenerativeCamera) => void;
  readonly seed: number;
  readonly onSeed: (value: number) => void;
  readonly strength: number;
  readonly onStrength: (value: number) => void;
  readonly pipeline: PipelineState;
  readonly loadedBase: LoadedBase | null;
  readonly onRetrieve: () => void;
  readonly onKeyframe: () => void;
  readonly onRefine: () => void;
}) {
  const gui = useDockGui();
  const appearance = useFolder(gui, "APPEARANCE", { open: true });
  useText(appearance, "Prompt", prompt, onPrompt);
  useOption(appearance, "Style slot", { Base: "base", "Style A": "style A", "Style B": "style B" }, style, onStyle);
  useSlider(appearance, "Seed", { min: 0, max: 65535, step: 1 }, seed, (value) => onSeed(Math.round(value)));
  useReadonlyText(appearance, "Mode", "B57 coarse slice");

  const cameraFolder = useFolder(gui, "CAMERA / NEIGHBORHOOD", { open: true });
  useSlider(cameraFolder, "Rotate X", { min: 20, max: 100, step: 1 }, camera.rotX, (rotX) => onCamera({ ...camera, rotX }));
  useSlider(cameraFolder, "Rotate Y", { min: -180, max: 180, step: 1 }, camera.rotY, (rotY) => onCamera({ ...camera, rotY }));
  useSlider(cameraFolder, "Zoom", { min: 30, max: 90, step: 1 }, camera.zoom, (zoom) => onCamera({ ...camera, zoom }));

  const model = useFolder(gui, "RETRIEVAL / REFINER", { open: true });
  useText(model, "Service", serviceUrl, onServiceUrl, (value) => /^https?:\/\/[^ ]+$/.test(value));
  useButton(model, "Retrieve base", onRetrieve);
  useButton(model, "Request fresh keyframe", onKeyframe);
  useSlider(model, "Refinement", { min: 0, max: 1, step: 0.01 }, strength, onStrength);
  useButton(model, "Refine final", onRefine);
  useReadonlyText(model, "State", pipeline.phase);
  useReadonlyText(model, "Base", loadedBase?.base.label ?? "none");
  useReadonlyText(model, "Confidence", loadedBase ? loadedBase.confidence.toFixed(3) : "n/a");
  useReadonlyText(model, "Artifact", coarseRefiner.contentSha256.slice(0, 12));
  useReadonlyText(model, "Training", "786,432 native continuation pixels");
  useReadonlyText(model, "Teacher", loadedBase?.teacher?.backend.kind ?? "library PNG / no latent");

  const control = useFolder(gui, "CONTROL FRAME", { open: true });
  useReadonlyText(control, "Geometry", primitive.label);
  useReadonlyText(control, "Grid", `${frame.metadata.cols} × ${frame.metadata.rows}`);
  useReadonlyText(control, "B5", frame.metadata.scene.contentSha256.slice(0, 12));
  useReadonlyText(control, "B32", packed.spec.contractSha256.slice(0, 12));
  useReadonlyText(control, "Camera", `${camera.rotX}° ${camera.rotY}° @${camera.zoom}`);
  useReadonlyText(control, "Semantic", "cube · A");

  const lineage = useFolder(gui, "CELL LINEAGE", { open: true });
  const row = Math.floor(selected / frame.metadata.cols);
  const col = selected % frame.metadata.cols;
  useReadonlyText(lineage, "Cell", `${col + 1}, ${row + 1}`);
  useReadonlyText(lineage, "Class", "cube · A");
  useReadonlyText(lineage, "Instance", frame.instanceLookup[frame.instanceId[selected] ?? -1] ?? "none");
  useReadonlyText(lineage, "Surface", frame.surfaceLookup[frame.surfaceId[selected] ?? -1] ?? "none");
  useReadonlyText(lineage, "Polygon", String(frame.winnerPolygon[selected] ?? -1));
  return null;
}

type MobilePanel = "sources" | "controls" | "maps" | null;
type StageView = "output" | "map";

export interface GenerativeWorkbenchProps {
  readonly fixtureFactory?: (primitive: GenerativePrimitive, camera?: GenerativeCamera) => GenerativeFixture;
}

export function GenerativeWorkbench({ fixtureFactory = makeGenerativeFixture }: GenerativeWorkbenchProps) {
  const [primitiveId, setPrimitiveId] = useState<GenerativePrimitive["id"]>("cube");
  const [camera, setCamera] = useState<GenerativeCamera>(DEFAULT_CAMERA);
  const primitive = GENERATIVE_PRIMITIVES.find((candidate) => candidate.id === primitiveId) ?? GENERATIVE_PRIMITIVES[0]!;
  const fixture = useMemo(() => {
    try {
      return { value: fixtureFactory(primitive, camera), error: null };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : "Unknown control-frame error" };
    }
  }, [camera, fixtureFactory, primitive]);
  const [prompt, setPrompt] = useState("weathered red clay in a quiet studio");
  const [style, setStyle] = useState("base");
  const [seed, setSeed] = useState(1427);
  const [strength, setStrength] = useState(0.65);
  const [serviceUrl, setServiceUrl] = useState(DEFAULT_SERVICE_URL);
  const [pipeline, setPipeline] = useState<PipelineState>({ phase: "idle", message: "Start the local service, then retrieve a compatible base." });
  const [loadedBase, setLoadedBase] = useState<LoadedBase | null>(null);
  const [finalImage, setFinalImage] = useState<ImageData | null>(null);
  const [selected, setSelected] = useState(() => fixture.value?.frame.coverage.findIndex(Boolean) ?? -1);
  const [activeMapTitle, setActiveMapTitle] = useState(GENERATIVE_MAPS[0]!.title);
  const [stageView, setStageView] = useState<StageView>("output");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const finalCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setSelected(fixture.value?.frame.coverage.findIndex(Boolean) ?? -1);
  }, [fixture.value]);

  useEffect(() => {
    if (!loadedBase) return;
    return () => URL.revokeObjectURL(loadedBase.objectUrl);
  }, [loadedBase]);

  useEffect(() => {
    if (!finalImage || !finalCanvas.current) return;
    finalCanvas.current.width = finalImage.width;
    finalCanvas.current.height = finalImage.height;
    finalCanvas.current.getContext("2d")?.putImageData(finalImage, 0, 0);
  }, [finalImage]);

  const buildRequest = useCallback((): CoarseBaseRequest => {
    if (!fixture.value) throw new Error("The current glyph control frame is unavailable.");
    return buildGenerativeCoarseRequest({
      primitive,
      prompt,
      styleId: style,
      seed,
      camera,
      fixture: fixture.value,
    });
  }, [camera, fixture.value, primitive.id, prompt, seed, style]);

  const postService = useCallback(async (path: string, request: CoarseBaseRequest): Promise<CoarseRetrievalResponse> => {
    const response = await fetch(`${serviceUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const value = await response.json() as CoarseRetrievalResponse | { error?: string };
    if (!response.ok) throw new Error("error" in value && value.error ? value.error : `Service returned HTTP ${response.status}.`);
    return value as CoarseRetrievalResponse;
  }, [serviceUrl]);

  const loadResponse = useCallback(async (
    response: CoarseRetrievalResponse,
    source: LoadedBase["source"],
    request: CoarseBaseRequest,
  ) => {
    const selectedBase = assertCoarseResponseBinding(response, request);
    const imageResponse = await fetch(selectedBase.image.url);
    if (!imageResponse.ok) throw new Error(`Base image returned HTTP ${imageResponse.status}.`);
    const blob = await imageResponse.blob();
    const actualSha256 = await byteSha256(await blob.arrayBuffer());
    if (actualSha256 !== selectedBase.image.sha256) throw new Error("The retrieved base image failed its SHA-256 binding.");
    const image = await decodeBaseImage(blob);
    const objectUrl = URL.createObjectURL(blob);
    setLoadedBase({
      base: selectedBase,
      image,
      objectUrl,
      requestSha256: response.requestSha256,
      confidence: response.confidence,
      source,
      teacher: response.teacher,
      requestBinding: {
        prompt: request.prompt,
        style: request.styleId,
        geometry: request.controls.geometry,
        camera: request.controls.camera,
      },
    });
    setFinalImage(null);
    setPipeline({
      phase: "base-ready",
      message: `${source === "library" ? "Retrieved" : "Loaded pinned teacher"} ${selectedBase.label}; SHA-256 verified in browser.`,
    });
    setStageView("output");
  }, []);

  const retrieve = useCallback(() => {
    void (async () => {
      try {
        const request = buildRequest();
        setPipeline({ phase: "retrieving", message: "Scoring prompt, style, camera, and glyph controls against the base library." });
        const response = await postService("/v1/retrieve", request);
        if (response.status === "fallback-required") {
          setFinalImage(null);
          setPipeline({
            phase: "fallback",
            message: "No base is safe for local correction. Request a fresh keyframe.",
            fallbackReason: response.fallback?.reason ?? "unknown-divergence",
          });
          setStageView("output");
          return;
        }
        await loadResponse(response, "library", request);
      } catch (error) {
        setPipeline({ phase: "error", message: error instanceof Error ? error.message : "Unknown retrieval error" });
      }
    })();
  }, [buildRequest, loadResponse, postService]);

  const requestKeyframe = useCallback(() => {
    void (async () => {
      try {
        const request = buildRequest();
        setPipeline({ phase: "retrieving", message: "Loading the pinned native teacher keyframe for this exact captured control neighborhood." });
        await loadResponse(await postService("/v1/keyframes", request), "native-pinned-teacher", request);
      } catch (error) {
        setPipeline({ phase: "error", message: error instanceof Error ? error.message : "Unknown keyframe error" });
      }
    })();
  }, [buildRequest, loadResponse, postService]);

  const refine = useCallback(() => {
    if (!loadedBase || !fixture.value) {
      setPipeline({ phase: "error", message: "Retrieve or request a base before refining." });
      return;
    }
    if (loadedBase.requestBinding.prompt !== prompt.trim() || loadedBase.requestBinding.style !== style) {
      setPipeline({ phase: "stale", message: "Prompt or style changed. Retrieve a newly bound base before refining." });
      return;
    }
    const divergence = loadedBase.requestBinding.geometry !== primitive.id
      ? "geometry changed"
      : cameraDivergence(camera, loadedBase.base.camera);
    if (divergence) {
      setPipeline({ phase: "fallback", message: "Current controls left the base neighborhood. Request a fresh keyframe.", fallbackReason: divergence });
      return;
    }
    setPipeline({ phase: "refining", message: "Running the explicit deterministic browser residual artifact." });
    try {
      const image = runGlyphCoarseRefiner({
        artifact: coarseRefiner,
        base: loadedBase.image,
        control: fixture.value.packed.keyframe,
        controlWidth: fixture.value.packed.width,
        controlHeight: fixture.value.packed.height,
        seed,
        prompt,
        strength,
      });
      setFinalImage(image);
      setPipeline({ phase: "final", message: `Final correction applied for seed ${seed}; the student was fitted to pinned native continuation previews.` });
      setStageView("output");
    } catch (error) {
      setPipeline({ phase: "error", message: error instanceof Error ? error.message : "Unknown refinement error" });
    }
  }, [camera, fixture.value, loadedBase, primitive.id, prompt, seed, strength, style]);

  useEffect(() => {
    if (!loadedBase) return;
    const promptOrStyleChanged = loadedBase.requestBinding.prompt !== prompt.trim() || loadedBase.requestBinding.style !== style;
    const divergence = loadedBase.requestBinding.geometry !== primitive.id
      ? "geometry changed"
      : cameraDivergence(camera, loadedBase.base.camera);
    if (!promptOrStyleChanged && !divergence) return;
    setFinalImage(null);
    setPipeline((current) => {
      if (current.phase === "retrieving") return current;
      if (divergence) {
        return { phase: "fallback", message: "Current controls left the retrieved base neighborhood.", fallbackReason: divergence };
      }
      return { phase: "stale", message: "Prompt or style changed; retrieve a newly scored base." };
    });
  }, [camera, loadedBase, primitive.id, prompt, style]);

  useEffect(() => {
    if (!finalImage) return;
    setFinalImage(null);
    setPipeline({ phase: "base-ready", message: "Seed or strength changed; run the refiner for a new nearby variant." });
  }, [seed, strength]);

  if (!fixture.value) return <InstrumentShell kind="generative">
    <section className="gen-failure" role="alert">
      <h1>Generative controls unavailable</h1>
      <p>The local control frame could not be constructed. No model, prompt, or scene data was uploaded.</p>
      <code>{fixture.error}</code>
    </section>
  </InstrumentShell>;

  const { frame, packed } = fixture.value;
  const selectedCell = selected >= 0 && frame.coverage[selected] ? selected : frame.coverage.findIndex(Boolean);
  const activeMap = GENERATIVE_MAPS.find((map) => map.title === activeMapTitle) ?? GENERATIVE_MAPS[0]!;
  const instance = frame.instanceLookup[frame.instanceId[selectedCell] ?? -1];
  const surface = frame.surfaceLookup[frame.surfaceId[selectedCell] ?? -1];

  const showMap = (map: MapDefinition) => {
    setActiveMapTitle(map.title);
    setStageView("map");
    setMobilePanel(null);
  };

  return <InstrumentShell kind="generative">
    <h1 className="gen-sr-only">Generative controls</h1>
    <InstrumentBody>
      <InstrumentRail
        id="generative-sources-panel"
        title="Scene sources"
        open={mobilePanel === "sources"}
        action={<button type="button" className="voice-add" disabled title="Multi-object scene builder is not implemented">Builder · future</button>}
      >
        <div className="gen-primitive-rack" aria-label="Supported geometry">
          {GENERATIVE_PRIMITIVES.map((candidate) => <button
            type="button"
            className={`voice-card gen-primitive${candidate.id === primitive.id ? " is-active" : ""}`}
            aria-pressed={candidate.id === primitive.id}
            onClick={() => setPrimitiveId(candidate.id)}
            key={candidate.id}
          >
            <span className="gen-primitive-icon" aria-hidden="true">{candidate.icon}</span>
            <span className="voice-controls"><span className="voice-title">{candidate.label}</span><small>{candidate.description}</small><code>{candidate.geometry}</code></span>
          </button>)}
        </div>
        <section className="gen-rail-module" aria-label="Scene contract">
          <span className="voice-title">Scene contract</span>
          <dl><dt>Frames</dt><dd>1 × B5</dd><dt>Tensors</dt><dd>1 × B32</dd><dt>Class</dt><dd>cube · A</dd><dt>Builder</dt><dd>not wired</dd></dl>
          <p>Sphere and Prism change geometry only. The frozen dictionary still supplies class cube; no untrained IDs are invented.</p>
        </section>
      </InstrumentRail>

      <InstrumentMain>
        <InstrumentViewport className="gen-viewport">
          <section
            className="gen-stage"
            id="generative-stage"
            aria-label="Control frame stage"
            data-stage-frame-sha256={frame.metadata.scene.contentSha256}
            data-stage-tensor-spec-sha256={packed.spec.contentSha256}
            data-control-frame-count="1"
          >
            <header className="gen-stage-toolbar">
              <div><strong>GLYPH IMAGE SYNTH</strong><span>{primitive.label} · {COLS}×{ROWS}</span></div>
              <div className="gx-toggle" role="group" aria-label="Stage view">
                <button type="button" className={`gx-toggle-btn${stageView === "output" ? " is-active" : ""}`} aria-pressed={stageView === "output"} onClick={() => setStageView("output")}>Output</button>
                <button type="button" className={`gx-toggle-btn${stageView === "map" && activeMap.kind === "visible" ? " is-active" : ""}`} aria-pressed={stageView === "map" && activeMap.kind === "visible"} onClick={() => showMap(GENERATIVE_MAPS[0]!)}>Visible</button>
                <button type="button" className={`gx-toggle-btn${stageView === "map" && activeMap.kind === "semantic" ? " is-active" : ""}`} aria-pressed={stageView === "map" && activeMap.kind === "semantic"} onClick={() => showMap(GENERATIVE_MAPS[1]!)}>Semantic</button>
              </div>
              <span className={`gen-model-led is-${pipeline.phase}`}><i />{pipeline.phase.replace("-", " ").toUpperCase()}</span>
            </header>

            <div className="gen-stage-aperture">
              {stageView === "output" ? <div
                className="gen-output"
                data-generated-panel={pipeline.phase}
                data-base-sha256={loadedBase?.base.image.sha256}
                data-refiner-sha256={coarseRefiner.contentSha256}
                aria-live="polite"
              >
                <pre className="gen-output-ghost" aria-hidden="true">{frame.visibleAscii}</pre>
                {loadedBase ? <div className="gen-pipeline">
                  <figure className="gen-image-card">
                    <figcaption><span>01 / RETRIEVED BASE</span><strong>{loadedBase.base.label}</strong></figcaption>
                    <img src={loadedBase.objectUrl} alt={`Retrieved coarse base: ${loadedBase.base.label}`} />
                    <code>{loadedBase.base.image.sha256.slice(0, 16)}</code>
                  </figure>
                  <div className="gen-pipeline-arrow" aria-hidden="true">＋ B32 →</div>
                  <figure className={`gen-image-card is-final${finalImage ? "" : " is-pending"}`}>
                    <figcaption><span>02 / BROWSER RESIDUAL</span><strong>{finalImage ? `FINAL · SEED ${seed}` : "REFINEMENT PENDING"}</strong></figcaption>
                    <canvas ref={finalCanvas} hidden={!finalImage} aria-label="Final refined image" />
                    {!finalImage && <div className="gen-pending-frame">RUN REFINE FINAL</div>}
                    <code>{coarseRefiner.contentSha256.slice(0, 16)}</code>
                  </figure>
                  <div className="gen-pipeline-meta">
                    <span>CONFIDENCE <b>{loadedBase.confidence.toFixed(3)}</b></span>
                    <span>SOURCE <b>{loadedBase.source}</b></span>
                    <span>REQUEST <b>{loadedBase.requestSha256.slice(0, 12)}</b></span>
                    {loadedBase.teacher && <span>LATENT <b>{loadedBase.teacher.anchorLatentSha256.slice(0, 12)}</b></span>}
                    {loadedBase.teacher && <span>BRANCH <b>{loadedBase.teacher.selectedBranchId}/{loadedBase.teacher.branches.length}</b></span>}
                    <span>STATUS <b>{pipeline.phase}</b></span>
                  </div>
                  {(pipeline.phase === "fallback" || pipeline.phase === "stale" || pipeline.phase === "error") && <div className={`gen-pipeline-alert is-${pipeline.phase}`}>
                    <strong>{pipeline.phase === "fallback" ? "FRESH BASE REQUIRED" : pipeline.phase.toUpperCase()}</strong>
                    <span>{pipeline.fallbackReason ?? pipeline.message}</span>
                    {pipeline.phase === "fallback" && <button type="button" onClick={requestKeyframe}>Request keyframe</button>}
                  </div>}
                  <p className="gen-pipeline-status">{pipeline.message}</p>
                </div> : <div className="gen-output-message">
                  <span>RETRIEVAL → CONTROL RESIDUAL → FINAL</span>
                  <strong>LOCAL RETRIEVAL IDLE</strong>
                  <p>Prompt: “{prompt}” · seed {seed} · {style}</p>
                  <p>Start <code>pnpm --dir research/ascii-image-generation coarse:serve</code></p>
                  <div className="gen-output-actions">
                    <button type="button" onClick={retrieve}>Retrieve compatible base</button>
                    <button type="button" onClick={requestKeyframe}>Request fresh keyframe</button>
                  </div>
                  <small>{pipeline.message} No paid or hidden remote call is used.</small>
                </div>}
              </div> : <div className="gen-map-stage">
                <div className="gen-map-label"><span>{activeMap.short}</span><strong>{activeMap.title}</strong><small>{activeMap.detail}</small></div>
                <ControlMap map={activeMap} frame={frame} packed={packed} selected={selectedCell} onSelect={setSelected} />
              </div>}
            </div>

            <footer className="gen-stage-footer">
              <span>B5 <code>{frame.metadata.scene.contentSha256.slice(0, 10)}</code></span>
              <span>B32 <code>{packed.spec.contentSha256.slice(0, 10)}</code></span>
              <span>REFINER <code>{coarseRefiner.contentSha256.slice(0, 10)}</code></span>
              <span>GEOMETRY {primitive.geometry}</span>
              <span>SEMANTIC cube/A</span>
            </footer>

            <aside className="gen-lineage" aria-live="polite" aria-label="Selected cell lineage">
              <span>CELL {selectedCell % COLS + 1}:{Math.floor(selectedCell / COLS) + 1}</span>
              <span>INSTANCE {instance}</span>
              <span>SURFACE {surface}</span>
              <span>POLY {frame.winnerPolygon[selectedCell]}</span>
            </aside>
          </section>
        </InstrumentViewport>
      </InstrumentMain>

      <Dock id="generative-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
        <GenerativeDock
          primitive={primitive}
          prompt={prompt}
          onPrompt={setPrompt}
          style={style}
          onStyle={setStyle}
          frame={frame}
          packed={packed}
          selected={selectedCell}
          serviceUrl={serviceUrl}
          onServiceUrl={setServiceUrl}
          camera={camera}
          onCamera={setCamera}
          seed={seed}
          onSeed={setSeed}
          strength={strength}
          onStrength={setStrength}
          pipeline={pipeline}
          loadedBase={loadedBase}
          onRetrieve={retrieve}
          onKeyframe={requestKeyframe}
          onRefine={refine}
        />
      </Dock>
    </InstrumentBody>

    <InstrumentTray id="generative-maps-panel" label="Conditioning maps" open={mobilePanel === "maps"}>
      {GENERATIVE_MAPS.map((map) => <button
        type="button"
        className={`synth-tile gen-map-tile${stageView === "map" && activeMap.title === map.title ? " is-active" : ""}`}
        role="listitem"
        aria-pressed={stageView === "map" && activeMap.title === map.title}
        data-control-panel={map.title}
        data-frame-sha256={frame.metadata.scene.contentSha256}
        data-tensor-spec-sha256={packed.spec.contentSha256}
        {...(map.kind === "numeric" ? { "data-first-plane": map.firstPlane, "data-plane-width": map.width } : {})}
        onClick={() => showMap(map)}
        key={map.title}
      >
        <span className="synth-tile-scene gen-map-preview" aria-hidden="true"><pre>{mapText(map, frame, packed)}</pre></span>
        <span className="synth-tile-label"><b>{map.short}</b> {map.title}</span>
      </button>)}
    </InstrumentTray>

    <InstrumentMobileTabs label="Generative panels" items={[
      { id: "sources", label: "Sources", controls: "generative-sources-panel", expanded: mobilePanel === "sources", onClick: () => setMobilePanel((current) => current === "sources" ? null : "sources") },
      { id: "controls", label: "Controls", controls: "generative-controls-panel", expanded: mobilePanel === "controls", onClick: () => setMobilePanel((current) => current === "controls" ? null : "controls") },
      { id: "maps", label: "Maps", controls: "generative-maps-panel", expanded: mobilePanel === "maps", onClick: () => setMobilePanel((current) => current === "maps" ? null : "maps") },
      { id: "output", label: "Output", controls: "generative-stage", expanded: stageView === "output", onClick: () => { setStageView("output"); setMobilePanel(null); } },
    ]} />
  </InstrumentShell>;
}

export default GenerativeWorkbench;
