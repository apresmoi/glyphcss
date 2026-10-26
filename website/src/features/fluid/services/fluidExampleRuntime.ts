import { loadMesh, type LoadMeshOptions, type Polygon, type Vec3 } from "@glyphcss/core";
import {
  createGlyphFluid,
  GlyphFluidTargets,
  type GlyphFluid,
  type GlyphFluidMeshTargetOptions,
  type GlyphFluidOptions,
  type GlyphFluidTarget,
  type GlyphFluidZone,
} from "@glyphcss/fluid";
import { createGlyphFluidReader, type GlyphFluidReaderOptions } from "@glyphcss/fluid/reader";
// The package's default `new URL("./worker.js")` only exists next to the built dist.
import FluidWorker from "@glyphcss/fluid/worker?worker";
import { createGlyphOrthographicCamera } from "glyphcss";
import type { PresetModel } from "../../gallery/model/types";
import { fluidExamplePreset, type FluidConfig, type FluidExample, type FluidTuning } from "../model/fluidExamples";
import { fluidReaderFontFamily } from "./fluidReaderFont";
import { FLUID_READER_LOOP_MS, type FluidReaderProgress } from "../model/fluidWorkbench";

/** `createGlyphFluid` options for a config; `tuning` carries only the changed tunables. */
export function glyphFluidOptionsFrom(config: FluidConfig, tuning: FluidTuning): GlyphFluidOptions {
  return {
    glue: config.glue,
    shape: config.shape,
    encoding: config.encoding,
    face: config.face,
    fps: config.fps,
    fpsFallback: config.fpsFallback,
    worker: config.worker ? () => new FluidWorker() : false,
    clock: config.clock,
    reducedMotion: config.reducedMotion,
    pointer: config.pointer,
    shimmer: config.shimmer,
    field: { color: config.fieldColor, level: config.fieldLevel },
    grid: {
      cellAspect: config.cellAspect,
      targetCols: config.targetCols,
      minCellPx: config.minCellPx,
      maxCellPx: config.maxCellPx,
      maxCols: config.maxCols,
    },
    tuning,
  };
}

/** A host-filling fluid for the stage examples. */
export function mountFluidSurface(host: HTMLElement, config: FluidConfig, tuning: FluidTuning): GlyphFluid {
  return createGlyphFluid(host, glyphFluidOptionsFrom(config, tuning));
}

/** A ring from the host's centre, the ripple button's impulse. */
export function rippleFluid(fluid: GlyphFluid, host: HTMLElement, strength: number, radius: number): void {
  const r = host.getBoundingClientRect();
  fluid.impulse(r.left + r.width / 2, r.top + r.height / 2, { strength, radius });
}

// ── Example targets ───────────────────────────────────────────────────────

/** What a mesh example changes in place every frame (camera pose, spin, framing, light). */
export interface FluidMeshView {
  rotX: number;
  rotY: number;
  spin: number;
  extent: number;
  ambient: number;
}

export interface FluidExampleTargetMount {
  setCondensed(condensed: boolean): void;
  setMeshView(view: FluidMeshView): void;
  destroy(): void;
}

const meshes = new Map<string, Promise<{ polygons: Polygon[]; center: Vec3; diameter: number }>>();

function loadOptions(preset: Exclude<PresetModel, { kind: "primitive" }>): LoadMeshOptions {
  const options = preset.options;
  return {
    baseUrl: preset.url,
    ...(preset.mtlUrl ? { mtlUrl: preset.mtlUrl } : {}),
    ...(preset.kind === "obj" && options ? { objOptions: options as LoadMeshOptions["objOptions"] } : {}),
    ...((preset.kind === "glb" || preset.kind === "gltf") && options
      ? { gltfOptions: options as LoadMeshOptions["gltfOptions"] }
      : {}),
    ...(preset.kind === "vox" && options ? { voxOptions: options as LoadMeshOptions["voxOptions"] } : {}),
    ...(preset.kind === "stl" && options ? { stlOptions: options as LoadMeshOptions["stlOptions"] } : {}),
  };
}

/** A gallery preset's polygons with their bounding-box centre and diagonal; one fetch per preset. */
export function loadFluidMesh(preset: PresetModel) {
  let entry = meshes.get(preset.id);
  if (!entry) {
    entry = (async () => {
      const polygons =
        preset.kind === "primitive"
          ? preset.generatePolygons()
          : (await loadMesh(preset.url, loadOptions(preset))).polygons;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const p of polygons)
        for (const v of p.vertices)
          for (let i = 0; i < 3; i++) {
            lo[i] = Math.min(lo[i]!, v[i]!);
            hi[i] = Math.max(hi[i]!, v[i]!);
          }
      const center: Vec3 = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
      const diameter = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) || 1;
      return { polygons, center, diameter };
    })();
    // A failed fetch is retried on the next mount instead of being cached.
    entry.catch(() => meshes.delete(preset.id));
    meshes.set(preset.id, entry);
  }
  return entry;
}

const loadedImages = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  let entry = loadedImages.get(src);
  if (!entry) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    entry = img.decode().then(() => img);
    entry.catch(() => loadedImages.delete(src));
    loadedImages.set(src, entry);
  }
  return entry;
}

/**
 * The example's target on `fluid`: text over `el`'s own text, an image or a mesh over
 * `el`'s box. Images and meshes load first; destroying before they arrive adds nothing.
 */
export function mountFluidExampleTarget(
  fluid: GlyphFluid,
  example: FluidExample,
  el: HTMLElement,
  config: FluidConfig,
  onError?: (message: string) => void,
): FluidExampleTargetMount {
  const shown = { delay: config.delay, visibility: config.visibility };
  let target: GlyphFluidTarget | null = null;
  let condensed = config.condensed;
  let destroyed = false;
  const view: FluidMeshView = {
    rotX: config.meshRotX,
    rotY: config.meshRotY,
    spin: config.meshSpin,
    extent: config.meshExtent,
    ambient: config.meshAmbient,
  };
  let meshOptions: GlyphFluidMeshTargetOptions | null = null;
  let diameter = 1;

  const adopt = (next: GlyphFluidTarget) => {
    if (destroyed) return next.remove();
    target = next;
    if (!condensed) next.melt();
  };

  if (example.kind === "text") {
    adopt(fluid.addTarget(GlyphFluidTargets.text(el, { color: config.color, ...shown })));
  } else if (example.kind === "image" && example.src) {
    loadImage(example.src).then(
      (img) => !destroyed && adopt(fluid.addTarget(GlyphFluidTargets.image(img, el, { ink: config.ink, ...shown }))),
      () => onError?.(`Could not load ${example.src}.`),
    );
  } else if (example.kind === "mesh") {
    const preset = fluidExamplePreset(example);
    if (preset)
      loadFluidMesh(preset).then(
        (mesh) => {
          if (destroyed) return;
          diameter = mesh.diameter;
          const camera = createGlyphOrthographicCamera({ rotX: view.rotX, rotY: view.rotY });
          camera.target = mesh.center;
          const start = performance.now();
          meshOptions = {
            polygons: () => {
              // Read every frame: the spin turns the camera, not the vertices.
              camera.rotX = view.rotX;
              camera.rotY = view.rotY + (view.spin * (performance.now() - start)) / 1000;
              return mesh.polygons;
            },
            camera,
            extent: diameter * view.extent,
            ambient: view.ambient,
            features: config.meshFeatures,
            swell: config.meshSwell,
            ...shown,
          };
          adopt(fluid.addTarget(GlyphFluidTargets.mesh(el, meshOptions)));
        },
        () => onError?.(`Could not load ${preset.label}.`),
      );
  }

  return {
    setCondensed(next) {
      condensed = next;
      if (next) target?.condense();
      else target?.melt();
    },
    setMeshView(next) {
      const reframe = next.extent !== view.extent;
      Object.assign(view, next);
      if (!meshOptions) return;
      meshOptions.ambient = next.ambient;
      if (reframe) {
        // The target derives the camera zoom from `extent` when it measures.
        meshOptions.extent = diameter * next.extent;
        fluid.relayout();
      }
    },
    destroy() {
      destroyed = true;
      target?.remove();
      target = null;
    },
  };
}

export function mountFluidZone(fluid: GlyphFluid, el: HTMLElement, config: FluidConfig): GlyphFluidZone {
  return fluid.addZone({ el, kind: config.zoneKind, level: config.zoneLevel });
}

// ── Reader ────────────────────────────────────────────────────────────────

export interface FluidReaderExampleMount {
  readonly fluid: GlyphFluid;
  setPlaying(playing: boolean): void;
  setWpm(wpm: number): void;
  setText(text: string): void;
  destroy(): void;
}

/** The reader example: every option in `config` that the reader takes at construction. */
export function mountFluidReaderExample(
  host: HTMLElement,
  config: FluidConfig,
  tuning: FluidTuning,
  onProgress: (progress: FluidReaderProgress) => void,
): FluidReaderExampleMount {
  const { glue: _glue, ...fluidOptions } = glyphFluidOptionsFrom(config, tuning);
  const options: GlyphFluidReaderOptions = {
    ...fluidOptions,
    text: config.text,
    wpm: config.wpm,
    loop: config.loop ? FLUID_READER_LOOP_MS : false,
    leadIn: config.leadIn,
    ripple: config.ripple,
    color: config.readerColor,
    look: config.look,
    font: fluidReaderFontFamily(config.font),
    ariaLive: config.ariaLive,
  };
  const handle = createGlyphFluidReader(host, options);
  const { clock } = handle;
  let destroyed = false;
  const report = () => {
    if (!destroyed) onProgress({ index: clock.index, total: clock.tokens.length, playing: clock.playing });
  };
  const unsubscribe = clock.subscribe(report);
  void handle.ready.then(report);
  report();
  return {
    fluid: handle.fluid,
    // The clock emits no play/pause events, so toggling reports the new state itself.
    setPlaying(playing) {
      if (playing) clock.play();
      else clock.pause();
      report();
    },
    setWpm: (wpm) => clock.setWpm(wpm),
    setText: (text) => clock.setText(text),
    destroy() {
      destroyed = true;
      unsubscribe();
      handle.destroy();
    },
  };
}
