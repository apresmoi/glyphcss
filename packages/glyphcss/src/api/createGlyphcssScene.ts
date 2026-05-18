/**
 * createGlyphcssScene — imperative scene API. The vanilla counterpart to
 * `<glyphcss-scene>` custom element.
 *
 * Mirrors glyphcss's `createPolyScene` architecturally:
 *   - Takes a host element + scene options, returns a `GlyphcssSceneHandle`.
 *   - `handle.add(polygons, transform?)` registers a mesh and returns a
 *     removable `GlyphcssMeshHandle`.
 *
 * DOM: injects `<div class="glyphcss-scene">` containing one `<pre>` (text
 * output) and one `<div class="glyphcss-hotspot-layer">` (positioned overlay
 * for hotspot dots).
 *
 * Paint backend: on each render, walks all registered meshes, applies each
 * mesh's transform to its polygons in memory, builds a `RasterizeContext`,
 * calls `rasterize`, and sets `<pre>.innerHTML` (or `.textContent` when
 * `useColors` is false).
 *
 * Camera changes trigger a re-rasterize; scene-root transform is NOT a CSS
 * matrix3d — the ASCII output bakes the camera rotation into the projected
 * text every render.
 */

import type {
  Vec3,
  RenderMode,
  Hotspot,
  Polygon,
} from "@glyphcss/core";
import type { GlyphcssCamera } from "./createGlyphcssCamera";
import { createGlyphcssPerspectiveCamera } from "./createGlyphcssCamera";
import { buildRasterizeContext } from "./rasterizeContext";
import { rasterize } from "../render/rasterize";
import { injectGlyphcssBaseStyles } from "../styles/styles";
import { projectHotspots } from "./projectHotspots";
import type { GlyphcssDirectionalLight, GlyphcssAmbientLight, GlyphcssMeshTransform } from "./types";
export type { GlyphcssMeshTransform } from "./types";

export interface GlyphcssSceneOptions {
  /** Render mode: "wireframe" | "solid". Default "solid". */
  mode?: RenderMode;
  /** Named glyph palette. Defaults to "default". */
  glyphPalette?: string;
  /** Whether to emit color spans. Default true. */
  useColors?: boolean;
  /** Grid columns. Default 80. */
  cols?: number;
  /** Grid rows. Default 24. */
  rows?: number;
  /** Character cell aspect ratio (height/width). Default 2.0. */
  cellAspect?: number;
  directionalLight?: GlyphcssDirectionalLight;
  ambientLight?: GlyphcssAmbientLight;
  camera?: GlyphcssCamera;
}

export interface GlyphcssHotspotOptions {
  id: string;
  at: Vec3;
  size?: [number, number];
}

export interface GlyphcssHotspotHandle {
  remove(): void;
}

export interface GlyphcssMeshHandle {
  readonly id: number;
  /** The raw polygons registered with this mesh. */
  readonly polygons: Polygon[];
  setTransform(transform: GlyphcssMeshTransform): void;
  dispose(): void;
}

export interface GlyphcssSceneHandle {
  /** The host element passed to `createGlyphcssScene`. */
  readonly host: HTMLElement;
  /** The `<pre>` element for reading rendered text output. */
  readonly output: HTMLPreElement;
  /** The camera attached to this scene (mutate then call `rerender()`). */
  readonly camera: GlyphcssCamera;
  /**
   * Register a polygon list as a mesh. Optionally supply a transform.
   * Returns a handle to update or dispose the mesh.
   */
  add(polygons: Polygon[], transform?: GlyphcssMeshTransform): GlyphcssMeshHandle;
  addHotspot(opts: GlyphcssHotspotOptions, onClick?: () => void): GlyphcssHotspotHandle;
  /** Force an immediate re-rasterize. Normally called automatically on add/remove/setOptions. */
  rerender(): void;
  setOptions(opts: Partial<GlyphcssSceneOptions>): void;
  getOptions(): GlyphcssSceneOptions;
  destroy(): void;
}

interface MeshEntry {
  id: number;
  polygons: Polygon[];
  transform: GlyphcssMeshTransform;
}

let nextMeshId = 1;

function applyTransform(polygons: Polygon[], transform: GlyphcssMeshTransform): Polygon[] {
  const { position, scale, rotation } = transform;
  if (!position && !scale && !rotation) return polygons;

  const [px, py, pz] = position ?? [0, 0, 0];
  let sx = 1, sy = 1, sz = 1;
  if (scale !== undefined) {
    if (typeof scale === "number") { sx = sy = sz = scale; }
    else { [sx, sy, sz] = scale; }
  }
  const [rx, ry, rz] = rotation ?? [0, 0, 0];

  // Compose rotation matrices: R = Rx(rx) * Ry(ry) * Rz(rz)
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

  function transformVertex(v: Vec3): Vec3 {
    // Scale
    let x = v[0] * sx, y = v[1] * sy, z = v[2] * sz;
    // Rz
    let nx = cosZ * x - sinZ * y;
    let ny = sinZ * x + cosZ * y;
    let nz = z;
    // Ry
    x = cosY * nx + sinY * nz;
    y = ny;
    z = -sinY * nx + cosY * nz;
    // Rx
    nx = x;
    ny = cosX * y - sinX * z;
    nz = sinX * y + cosX * z;
    // Translate
    return [nx + px, ny + py, nz + pz];
  }

  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(transformVertex),
  }));
}

export function createGlyphcssScene(
  host: HTMLElement,
  opts: GlyphcssSceneOptions = {},
): GlyphcssSceneHandle {
  injectGlyphcssBaseStyles(host.ownerDocument ?? undefined);

  const options: Required<GlyphcssSceneOptions> = {
    mode: opts.mode ?? "solid",
    glyphPalette: opts.glyphPalette ?? "default",
    useColors: opts.useColors ?? true,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cellAspect: opts.cellAspect ?? 2.0,
    directionalLight: opts.directionalLight ?? { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: opts.ambientLight ?? { intensity: 0.4 },
    camera: opts.camera ?? createGlyphcssPerspectiveCamera(),
  };

  // Build DOM
  const sceneEl = host.ownerDocument!.createElement("div");
  sceneEl.className = "glyphcss-scene";
  const pre = host.ownerDocument!.createElement("pre") as HTMLPreElement;
  pre.className = "glyphcss-output";
  const hotspotLayer = host.ownerDocument!.createElement("div");
  hotspotLayer.className = "glyphcss-hotspot-layer";
  sceneEl.appendChild(pre);
  sceneEl.appendChild(hotspotLayer);
  host.appendChild(sceneEl);

  const meshes = new Map<number, MeshEntry>();
  const hotspots: Array<{ hotspot: Hotspot; el: HTMLElement; onClick?: () => void }> = [];
  let pendingRender = false;

  function scheduleRender(): void {
    if (pendingRender) return;
    pendingRender = true;
    Promise.resolve().then(() => {
      pendingRender = false;
      doRender();
    });
  }

  function doRender(): void {
    // Gather all polygons after transforms.
    const allPolygons: Polygon[] = [];
    for (const entry of meshes.values()) {
      const transformed = applyTransform(entry.polygons, entry.transform);
      for (const p of transformed) allPolygons.push(p);
    }

    const ctx = buildRasterizeContext({
      camera: options.camera,
      grid: { cols: options.cols, rows: options.rows, cellAspect: options.cellAspect },
      polygons: allPolygons,
      mode: options.mode,
      directionalLight: options.directionalLight,
      ambientLight: options.ambientLight,
      glyphPalette: options.glyphPalette,
      useColors: options.useColors,
    });

    const output = rasterize(ctx);
    if (options.useColors) {
      pre.innerHTML = output;
    } else {
      pre.textContent = output;
    }

    // Update hotspot positions.
    updateHotspots();
  }

  function updateHotspots(): void {
    const { cols, rows, cellAspect, camera } = options;
    const cells = projectHotspots(
      hotspots.map((h) => h.hotspot),
      camera,
      cols,
      rows,
      cellAspect,
    );

    // Compute character cell dimensions from the <pre> bounding box.
    const preRect = pre.getBoundingClientRect();
    const cellW = cols > 0 ? preRect.width / cols : 8;
    const cellH = rows > 0 ? preRect.height / rows : 16;

    for (let i = 0; i < hotspots.length; i++) {
      const { el } = hotspots[i]!;
      const cell = cells[i]!;
      if (!cell.visible) {
        el.style.display = "none";
      } else {
        el.style.display = "";
        el.style.left = `${cell.col * cellW}px`;
        el.style.top = `${cell.row * cellH}px`;
        el.style.zIndex = String(Math.round(cell.depth * 1000));
      }
    }
  }

  function add(polygons: Polygon[], transform: GlyphcssMeshTransform = {}): GlyphcssMeshHandle {
    const id = nextMeshId++;
    meshes.set(id, { id, polygons, transform });
    scheduleRender();

    return {
      get id() { return id; },
      get polygons() { return polygons; },
      setTransform(next: GlyphcssMeshTransform): void {
        const entry = meshes.get(id);
        if (entry) { entry.transform = next; scheduleRender(); }
      },
      dispose(): void {
        meshes.delete(id);
        scheduleRender();
      },
    };
  }

  function addHotspot(hotspotOpts: GlyphcssHotspotOptions, onClick?: () => void): GlyphcssHotspotHandle {
    const el = host.ownerDocument!.createElement("div");
    el.className = "glyphcss-hotspot";
    el.setAttribute("data-hotspot-id", hotspotOpts.id);
    const [w, h] = hotspotOpts.size ?? [1, 1];
    el.style.position = "absolute";
    el.style.width = `${w}ch`;
    el.style.height = `${h * options.cellAspect}ch`;
    if (onClick) el.addEventListener("click", onClick);
    hotspotLayer.appendChild(el);

    const entry = {
      hotspot: { id: hotspotOpts.id, at: hotspotOpts.at, size: hotspotOpts.size },
      el,
      onClick,
    };
    hotspots.push(entry);
    scheduleRender();

    return {
      remove(): void {
        const idx = hotspots.indexOf(entry);
        if (idx >= 0) hotspots.splice(idx, 1);
        if (onClick) el.removeEventListener("click", onClick);
        hotspotLayer.removeChild(el);
        scheduleRender();
      },
    };
  }

  function rerender(): void {
    doRender();
  }

  function setOptions(partial: Partial<GlyphcssSceneOptions>): void {
    if (partial.mode !== undefined) options.mode = partial.mode;
    if (partial.glyphPalette !== undefined) options.glyphPalette = partial.glyphPalette;
    if (partial.useColors !== undefined) options.useColors = partial.useColors;
    if (partial.cols !== undefined) options.cols = partial.cols;
    if (partial.rows !== undefined) options.rows = partial.rows;
    if (partial.cellAspect !== undefined) options.cellAspect = partial.cellAspect;
    if (partial.directionalLight !== undefined) options.directionalLight = partial.directionalLight;
    if (partial.ambientLight !== undefined) options.ambientLight = partial.ambientLight;
    if (partial.camera !== undefined) options.camera = partial.camera;
    scheduleRender();
  }

  function getOptions(): GlyphcssSceneOptions {
    return { ...options };
  }

  function destroy(): void {
    meshes.clear();
    if (host.contains(sceneEl)) host.removeChild(sceneEl);
  }

  scheduleRender();

  return {
    get host() { return host; },
    get output() { return pre; },
    get camera() { return options.camera; },
    add,
    addHotspot,
    rerender,
    setOptions,
    getOptions,
    destroy,
  };
}
