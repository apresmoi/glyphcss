/**
 * createPolyScene — imperative scene API. The vanilla counterpart to
 * `<PolyScene>` in React / Vue.
 *
 * Per §API freeze: takes a host element + scene options, returns a
 * `SceneHandle` whose `add(parseResult, transform?)` mounts a mesh under
 * the scene root and returns a removable `MeshHandle`.
 *
 * Implementation:
 *   - Inserts a `<div class="polycss-scene">` into the host.
 *   - Each `add(...)` creates a `<div class="polycss-mesh">` with the
 *     mesh transform; mounts every valid polygon as an atlas-backed
 *     background sprite.
 *   - `destroy()` removes the scene element and disposes every mesh
 *     (which in turn disposes generated atlas blob URLs).
 *
 * The scene element is a 0×0 anchor at world (0,0,0) — pinned via
 * top:50%/left:50% so it sits at the visible center of the host. This
 * matches React/Vue's PolyScene anchor pattern. Polygons render around
 * the anchor via their own matrix3d translations.
 */
import type {
  AmbientLight,
  DirectionalLight,
  ParseResult,
  Polygon,
  TextureLightingMode,
  Vec3,
} from "@polycss/core";
import { computeSceneBbox, mergePolygons, parseHexColor } from "@polycss/core";
import {
  renderPolygonsWithTextureAtlas,
  renderPolygonsWithStableTriangles,
  updatePolygonsWithStableTriangles,
  type AtlasScale,
  type RenderedPoly,
} from "../render/textureAtlas";
import { injectBaseStyles } from "../styles/styles";

export interface PolySceneOptions {
  perspective?: number | false;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  directionalLight?: DirectionalLight;
  ambientLight?: AmbientLight;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: TextureLightingMode;
  /** Raster scale for generated atlas pages. `"auto"` reduces large atlases. */
  atlasScale?: AtlasScale;
  /**
   * When `true`, rotation pivots around the union bbox of all added meshes
   * instead of world (0,0,0). The scene wraps polygons in an inner div
   * translated by `-bboxCenter`. Updates whenever a mesh is added/removed
   * or `setOptions` is called. Mirrors React's `<PolyScene autoCenter>`.
   */
  autoCenter?: boolean;
}

export interface MeshTransform {
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  /**
   * Whether `scene.add()` should merge coplanar polygons before rendering.
   * Defaults to `true`. Set `false` for animated/deforming meshes whose
   * triangle topology must remain stable from frame to frame.
   */
  merge?: boolean;
  /**
   * Keep polygon leaf DOM nodes stable across setPolygons() calls when the
   * mesh topology is unchanged. Intended for animated/deforming meshes.
   */
  stableDom?: boolean;
  /**
   * When `true`, this mesh's polygons are NOT included in the scene's
   * auto-center bbox. Use for debug overlays / helpers that shouldn't
   * shift the camera target when toggled. Defaults to `false`.
   */
  excludeFromAutoCenter?: boolean;
}

export interface MeshHandle {
  /** The polygons that were loaded after normalization and automatic merge. */
  polygons: Polygon[];
  /** Remove the mesh from the scene. */
  remove(): void;
  /** Replace polygon geometry without tearing down the scene or controls. */
  setPolygons(polygons: Polygon[], options?: {
    merge?: boolean;
    stableDom?: boolean;
    recomputeAutoCenter?: boolean;
  }): void;
  /** Update transform without re-parsing. */
  setTransform(t: Partial<MeshTransform>): void;
  /** Revoke any blob URLs the parse created. Idempotent. */
  dispose(): void;
}

export interface SceneHandle {
  /** Add a mesh to the scene. Returns a handle for later removal. */
  add(mesh: ParseResult, opts?: MeshTransform): MeshHandle;
  /** Update scene-level config (rotation, lighting, etc.). */
  setOptions(partial: Partial<PolySceneOptions>): void;
  /** Tear down the scene; revokes all blob URLs of registered meshes. */
  destroy(): void;
  /**
   * The host element passed to `createPolyScene`. Exposed for layered
   * helpers like `createPolyControls` that need to attach event listeners
   * without tracking the host separately.
   */
  readonly host: HTMLElement;
  /**
   * Snapshot of the current options (camera, lighting, merge, autoCenter,
   * textureLighting, atlasScale, perspective). Returned by reference, so
   * callers must treat it as read-only — mutations won't propagate. Used
   * by helpers that need to read the current camera state without
   * duplicating it.
   */
  getOptions(): Readonly<PolySceneOptions>;
}

// Match React's PolyCamera default — 1000px is a strong fish-eye that
// distorts loaded meshes; 8000px gives the gentle iso look users expect.
const DEFAULT_PERSPECTIVE = 8000;
const DEFAULT_ROT_X = 65;
const DEFAULT_ROT_Y = 45;
const DEFAULT_ZOOM = 1;
const DEFAULT_TILE = 50;

function buildMeshTransform(t: MeshTransform): string | undefined {
  const parts: string[] = [];
  if (t.position) {
    parts.push(
      `translate3d(${t.position[0]}px, ${t.position[1]}px, ${t.position[2]}px)`
    );
  }
  if (t.scale !== undefined) {
    if (typeof t.scale === "number") {
      if (t.scale !== 1) parts.push(`scale3d(${t.scale}, ${t.scale}, ${t.scale})`);
    } else {
      parts.push(`scale3d(${t.scale[0]}, ${t.scale[1]}, ${t.scale[2]})`);
    }
  }
  if (t.rotation) {
    if (t.rotation[0]) parts.push(`rotateX(${t.rotation[0]}deg)`);
    if (t.rotation[1]) parts.push(`rotateY(${t.rotation[1]}deg)`);
    if (t.rotation[2]) parts.push(`rotateZ(${t.rotation[2]}deg)`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildSceneTransform(opts: PolySceneOptions): string {
  const rotX = opts.rotX ?? DEFAULT_ROT_X;
  const rotY = opts.rotY ?? DEFAULT_ROT_Y;
  const zoom = opts.zoom ?? DEFAULT_ZOOM;
  // Match React's PolyCamera transform: rotate() (i.e. rotateZ) — NOT
  // rotateY. After the rotateX tilt, the world's Z axis is what reads
  // as "spin in place"; rotateY rotates around an oblique axis and
  // makes the mesh wobble. Names line up: rotY in our API == CSS rotate.
  return `scale(${zoom}) rotateX(${rotX}deg) rotate(${rotY}deg)`;
}

// ─── Lambert-bucket grouping ────────────────────────────────────────────────
// For dynamic-mode scenes: group polygons by quantized face normal + color
// into wrapper divs. The wrapper has the bucket's normal as inline CSS
// vars; the per-bucket cascade rule computes `--polycss-lambert` ONCE per
// wrapper. Polys inside inherit the lambert and skip the per-poly dot
// product. For voxel meshes (chicken, castle walls) this collapses
// thousands of per-frame calc()s into a few dozen; for organic meshes
// (saucer) the quantization gives ~7× fewer dot products at sub-1 %
// lighting error per channel.
//
// Quantization precision: each normal component is rounded to the nearest
// LAMBERT_BUCKET_PRECISION step then re-normalized. Voxel face normals
// (±1, 0, 0) are already on the grid so they bucket exactly; curved-mesh
// normals snap to the nearest cell on the unit sphere. With precision 0.1
// the worst-case angular error is ~6° → cos delta < 0.005, visually
// imperceptible.
const LAMBERT_BUCKET_PRECISION = 0.1;

function quantizeNormalKey(p: Polygon): { key: string; vec: Vec3 } | null {
  if (p.vertices.length < 3) return null;
  const v0 = p.vertices[0], v1 = p.vertices[1], v2 = p.vertices[2];
  // CSS-space edges — must match `computeTextureAtlasPlan` exactly so the
  // bucket's normal sits in the same frame as `--polycss-lx/ly/lz`. The
  // atlas applies `toCss(v) = [v.y, v.x, v.z]` (x↔y swap) and then takes
  // a NEGATED cross product. Reproducing both here means the cascade
  // dot(normal, light) computes the same value as the original per-poly
  // path that was set inline by `applyDynamicNormalVars`.
  const e1x = v1[1] - v0[1], e1y = v1[0] - v0[0], e1z = v1[2] - v0[2];
  const e2x = v2[1] - v0[1], e2y = v2[0] - v0[0], e2z = v2[2] - v0[2];
  let nx = -(e1y * e2z - e1z * e2y);
  let ny = -(e1z * e2x - e1x * e2z);
  let nz = -(e1x * e2y - e1y * e2x);
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  nx /= len; ny /= len; nz /= len;
  // Quantize each component to the precision grid, then renormalize so the
  // bucket's normal stays a true unit vector. Two polys with identical
  // quantized triples land in the same bucket.
  const inv = 1 / LAMBERT_BUCKET_PRECISION;
  const qx = Math.round(nx * inv) / inv;
  const qy = Math.round(ny * inv) / inv;
  const qz = Math.round(nz * inv) / inv;
  const qLen = Math.hypot(qx, qy, qz);
  if (qLen < 1e-9) return null;
  return {
    key: qx + "," + qy + "," + qz,
    vec: [qx / qLen, qy / qLen, qz / qLen],
  };
}

export function createPolyScene(
  host: HTMLElement,
  options: PolySceneOptions = {},
): SceneHandle {
  if (!host || typeof host.appendChild !== "function") {
    throw new Error("createPolyScene: host must be an HTMLElement");
  }

  // Inject base styles into the host's owning document so .polycss-scene
  // has perspective + preserve-3d defaults.
  if (host.ownerDocument) injectBaseStyles(host.ownerDocument);

  // The scene element pins itself at top:50%/left:50% — needs the host to
  // be a positioned ancestor or the offsets resolve against the document.
  // Force `position: relative` only if the host has no positioning yet, so
  // we don't clobber a deliberate `absolute`/`fixed`/`sticky` from the user.
  if (host.ownerDocument?.defaultView) {
    const computed = host.ownerDocument.defaultView.getComputedStyle(host);
    if (computed.position === "static") host.style.position = "relative";
  }

  let currentOptions: PolySceneOptions = { ...options };

  const doc = host.ownerDocument ?? document;
  const sceneEl = doc.createElement("div");
  sceneEl.className = "polycss-scene";
  // 0×0 anchor at the host's visible center. Polygons render around it.
  applySceneStyle(sceneEl, currentOptions);

  // autoCenter wrapper: a child div translated so the union mesh bbox
  // center coincides with the scene anchor (world (0,0,0)).
  const centerWrapper = doc.createElement("div");
  centerWrapper.style.transformStyle = "preserve-3d";
  // Wrapper is always present so meshes append into a stable parent.
  // When autoCenter is off, transform stays empty (identity).
  sceneEl.appendChild(centerWrapper);

  host.appendChild(sceneEl);

  interface MeshEntry {
    handle: MeshHandle;
    wrapper: HTMLDivElement;
    parseResult: ParseResult;
    rendered: RenderedPoly[];
    disposeAtlas?: () => void;
    polygons: Polygon[];
    disposed: boolean;
    stableDom: boolean;
    excludeFromAutoCenter: boolean;
  }
  const meshes = new Set<MeshEntry>();

  function applySceneStyle(el: HTMLElement, opts: PolySceneOptions): void {
    el.style.position = "absolute";
    el.style.top = "50%";
    el.style.left = "50%";
    el.style.width = "0";
    el.style.height = "0";
    el.style.transformStyle = "preserve-3d";
    el.style.perspective = opts.perspective === false
      ? "none"
      : `${opts.perspective ?? DEFAULT_PERSPECTIVE}px`;
    el.style.transform = buildSceneTransform(opts);
    applyDynamicLightVars(el, opts);
  }

  // Dynamic lighting cascade vars: PolyScene writes the directional + ambient
  // light setup to these custom properties on the scene root. Each polygon's
  // <i> bakes its own normal directly into an inline calc() that reads these
  // vars to resolve the Lambert dot product and per-channel tint. Sliding
  // the light only writes these scene-root vars — no JS, no atlas redraw.
  function applyDynamicLightVars(el: HTMLElement, opts: PolySceneOptions): void {
    const dynamic = opts.textureLighting === "dynamic";
    el.dataset.polycssLighting = opts.textureLighting ?? "baked";
    const vars = [
      "--polycss-lx", "--polycss-ly", "--polycss-lz",
      "--polycss-lr", "--polycss-lg", "--polycss-lb", "--polycss-li",
      "--polycss-ar", "--polycss-ag", "--polycss-ab", "--polycss-ai",
    ] as const;
    if (!dynamic) {
      for (const v of vars) el.style.removeProperty(v);
      return;
    }
    const dir = opts.directionalLight?.direction ?? [0.4, -0.7, 0.59];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const lx = dir[0] / len, ly = dir[1] / len, lz = dir[2] / len;
    const lightRgb = parseHexColor(opts.directionalLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
    const ambRgb = parseHexColor(opts.ambientLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
    const lightIntensity = opts.directionalLight?.intensity ?? 1;
    const ambientIntensity = opts.ambientLight?.intensity ?? 0.4;
    const ch = (n: number) => (n / 255).toFixed(4);
    el.style.setProperty("--polycss-lx", lx.toFixed(4));
    el.style.setProperty("--polycss-ly", ly.toFixed(4));
    el.style.setProperty("--polycss-lz", lz.toFixed(4));
    el.style.setProperty("--polycss-lr", ch(lightRgb[0]));
    el.style.setProperty("--polycss-lg", ch(lightRgb[1]));
    el.style.setProperty("--polycss-lb", ch(lightRgb[2]));
    el.style.setProperty("--polycss-li", lightIntensity.toFixed(4));
    el.style.setProperty("--polycss-ar", ch(ambRgb[0]));
    el.style.setProperty("--polycss-ag", ch(ambRgb[1]));
    el.style.setProperty("--polycss-ab", ch(ambRgb[2]));
    el.style.setProperty("--polycss-ai", ambientIntensity.toFixed(4));
  }

  function clearRendered(entry: MeshEntry): void {
    disposeRendered(entry.rendered, entry.disposeAtlas);
    entry.disposeAtlas = undefined;
    entry.rendered.length = 0;
    while (entry.wrapper.firstChild) entry.wrapper.removeChild(entry.wrapper.firstChild);
  }

  function disposeRendered(rendered: RenderedPoly[], disposeAtlas?: () => void): void {
    disposeAtlas?.();
    for (const r of rendered) {
      try { r.dispose(); } catch { /* ignore */ }
      if (r.element.parentNode) r.element.parentNode.removeChild(r.element);
    }
  }

  function syncMountedRendered(entry: MeshEntry): void {
    const fragment = doc.createDocumentFragment();

    // Lambert-bucketing only pays off in dynamic mode, where the cascade
    // recomputes lambert per polygon every frame. Baked mode bakes lambert
    // into atlas pixels at parse time — no per-frame computation to save.
    const useBuckets =
      currentOptions.textureLighting === "dynamic" && !entry.stableDom;

    interface BucketGroup {
      vec: Vec3;
      items: RenderedPoly[];
    }
    const groups = new Map<string, BucketGroup>();
    const soloItems: RenderedPoly[] = [];

    // Pass 1 — gather per (quantized-normal × color) keys.
    for (const item of entry.rendered) {
      const poly = entry.polygons[item.polygonIndex];
      const q = useBuckets && poly ? quantizeNormalKey(poly) : null;
      if (!q) {
        soloItems.push(item);
        continue;
      }
      const key = q.key + "|" + (poly.color ?? "");
      let group = groups.get(key);
      if (!group) {
        group = { vec: q.vec, items: [] };
        groups.set(key, group);
      }
      group.items.push(item);
    }

    // Pass 2 — wrap groups of ≥ 2 (where one bucket-level lambert calc
    // beats the per-poly calcs it replaces). Singletons fall back to the
    // per-poly path so we don't add a wrapper that costs more than it saves.
    for (const item of soloItems) fragment.appendChild(item.element);
    for (const group of groups.values()) {
      if (group.items.length < 2) {
        for (const item of group.items) fragment.appendChild(item.element);
        continue;
      }
      const bucketEl = doc.createElement("div");
      bucketEl.className = "polycss-bucket";
      bucketEl.style.setProperty("--polycss-nx", String(group.vec[0]));
      bucketEl.style.setProperty("--polycss-ny", String(group.vec[1]));
      bucketEl.style.setProperty("--polycss-nz", String(group.vec[2]));
      for (const item of group.items) {
        bucketEl.appendChild(item.element);
        // Atlas sets per-poly --polycss-nx/y/z inline (for the non-bucketed
        // dynamic-lighting path used by other consumers). Inside a bucket
        // those inline values are dead weight — the lambert is computed at
        // the wrapper and inherited. Strip them.
        item.element.style.removeProperty("--polycss-nx");
        item.element.style.removeProperty("--polycss-ny");
        item.element.style.removeProperty("--polycss-nz");
      }
      fragment.appendChild(bucketEl);
    }

    entry.wrapper.appendChild(fragment);
  }

  function renderEntry(entry: MeshEntry): void {
    clearRendered(entry);
    const renderOptions = {
      doc,
      directionalLight: currentOptions.directionalLight,
      ambientLight: currentOptions.ambientLight,
      textureLighting: currentOptions.textureLighting,
      atlasScale: currentOptions.atlasScale,
    };
    const atlas = (
      entry.stableDom
        ? renderPolygonsWithStableTriangles(entry.polygons, renderOptions)
        : null
    ) ?? renderPolygonsWithTextureAtlas(entry.polygons, renderOptions);
    entry.rendered = atlas.rendered;
    entry.disposeAtlas = atlas.dispose;
    syncMountedRendered(entry);
  }

  function recomputeAutoCenter(): void {
    if (!currentOptions.autoCenter) {
      centerWrapper.style.transform = "";
      return;
    }
    // Combine all live mesh polygons into a single bbox. Helper meshes
    // (axes, light marker) opt out via `excludeFromAutoCenter` so they
    // don't shift the camera target when toggled.
    const all: Polygon[] = [];
    for (const m of meshes) {
      if (!m.disposed && !m.excludeFromAutoCenter) all.push(...m.polygons);
    }
    if (all.length === 0) {
      centerWrapper.style.transform = "";
      return;
    }
    const bbox = computeSceneBbox(all);
    const tile = DEFAULT_TILE;
    // Match React's axis remap: world-Y → CSS-x, world-X → CSS-y, world-Z → CSS-z.
    const cssX = ((bbox.min[1] + bbox.max[1]) / 2) * tile;
    const cssY = ((bbox.min[0] + bbox.max[0]) / 2) * tile;
    const cssZ = ((bbox.min[2] + bbox.max[2]) / 2) * tile;
    centerWrapper.style.transform = `translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`;
  }

  function add(parseResult: ParseResult, transformIn: MeshTransform = {}): MeshHandle {
    const mountDoc = sceneEl.ownerDocument ?? document;
    const wrapper = mountDoc.createElement("div");
    wrapper.className = "polycss-mesh";
    wrapper.style.position = "absolute";
    wrapper.style.transformStyle = "preserve-3d";

    let transform: MeshTransform = { ...transformIn };
    let mergeOnUpdate = transformIn.merge !== false;
    let stableDomOnUpdate = !!transformIn.stableDom;
    const css = buildMeshTransform(transform);
    if (css) wrapper.style.transform = css;

    const preparePolygons = (polygons: Polygon[], merge: boolean): Polygon[] =>
      merge ? mergePolygons(polygons) : polygons;
    const sourcePolygons = preparePolygons(parseResult.polygons, mergeOnUpdate);

    centerWrapper.appendChild(wrapper);

    const entry: MeshEntry = {
      handle: undefined as unknown as MeshHandle,
      wrapper,
      parseResult,
      rendered: [],
      polygons: sourcePolygons,
      disposed: false,
      stableDom: stableDomOnUpdate,
      excludeFromAutoCenter: !!transformIn.excludeFromAutoCenter,
    };

    const handle: MeshHandle = {
      polygons: sourcePolygons,
      remove() {
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        // Removing from DOM doesn't auto-dispose generated atlas/blob URLs.
        clearRendered(entry);
        meshes.delete(entry);
        recomputeAutoCenter();
      },
      setPolygons(polygons: Polygon[], options?: {
        merge?: boolean;
        stableDom?: boolean;
        recomputeAutoCenter?: boolean;
      }) {
        mergeOnUpdate = options?.merge ?? mergeOnUpdate;
        stableDomOnUpdate = options?.stableDom ?? stableDomOnUpdate;
        entry.stableDom = stableDomOnUpdate;
        entry.polygons = preparePolygons(polygons, mergeOnUpdate);
        handle.polygons = entry.polygons;
        const shouldRecomputeAutoCenter = options?.recomputeAutoCenter ?? true;
        if (entry.stableDom && !entry.wrapper.querySelector(".polycss-bucket")) {
          const renderOptions = {
            doc,
            directionalLight: currentOptions.directionalLight,
            ambientLight: currentOptions.ambientLight,
            textureLighting: currentOptions.textureLighting,
            atlasScale: currentOptions.atlasScale,
          };
          const atlas = updatePolygonsWithStableTriangles(
            entry.rendered,
            entry.polygons,
            renderOptions,
          );
          if (atlas) {
            entry.disposeAtlas?.();
            entry.rendered = atlas.rendered;
            entry.disposeAtlas = atlas.dispose;
            if (shouldRecomputeAutoCenter) recomputeAutoCenter();
            return;
          }
        }
        renderEntry(entry);
        if (shouldRecomputeAutoCenter) recomputeAutoCenter();
      },
      setTransform(t: Partial<MeshTransform>) {
        transform = { ...transform, ...t };
        const css2 = buildMeshTransform(transform);
        wrapper.style.transform = css2 ?? "";
      },
      dispose() {
        if (entry.disposed) return;
        entry.disposed = true;
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        clearRendered(entry);
        try { parseResult.dispose(); } catch { /* ignore */ }
        meshes.delete(entry);
        recomputeAutoCenter();
      },
    };

    entry.handle = handle;
    meshes.add(entry);
    renderEntry(entry);
    recomputeAutoCenter();
    return handle;
  }

  function setOptions(partial: Partial<PolySceneOptions>): void {
    const prevAutoCenter = !!currentOptions.autoCenter;
    currentOptions = { ...currentOptions, ...partial };
    applySceneStyle(sceneEl, currentOptions);
    const nextAutoCenter = !!currentOptions.autoCenter;
    // No syncInteractive — pointer/wheel input now lives in createPolyControls
    // (an additive layer). createPolyScene is the pure renderer + camera-state
    // owner.
    if (prevAutoCenter !== nextAutoCenter) recomputeAutoCenter();
  }

  function getOptions(): Readonly<PolySceneOptions> {
    return currentOptions;
  }

  function destroy(): void {
    // Dispose all meshes (revokes blob URLs) before removing the scene.
    // Snapshot first since dispose() mutates the set.
    const snapshot = Array.from(meshes);
    for (const m of snapshot) {
      try { m.handle.dispose(); } catch { /* ignore */ }
    }
    if (sceneEl.parentNode) sceneEl.parentNode.removeChild(sceneEl);
  }

  return { add, setOptions, destroy, host, getOptions };
}
