/**
 * createPolyScene — imperative scene API. The vanilla counterpart to
 * `<PolyScene>` in React / Vue.
 *
 * Per §API freeze: takes a host element + scene options, returns a
 * `PolySceneHandle` whose `add(parseResult, transform?)` mounts a mesh under
 * the scene root and returns a removable `PolyMeshHandle`.
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
  PolyAmbientLight,
  PolyDirectionalLight,
  ParseResult,
  Polygon,
  PolyTextureLightingMode,
  Vec3,
} from "@layoutit/polycss-core";
import { BASE_TILE, computeSceneBbox, inverseRotateVec3, mergePolygons, parseHexColor } from "@layoutit/polycss-core";
import {
  renderPolygonsWithTextureAtlas,
  renderPolygonsWithStableTriangles,
  updatePolygonsWithStableTriangles,
  type AtlasScale,
  type RenderedPoly,
} from "../render/textureAtlas";
import { injectPolyBaseStyles } from "../styles/styles";

export interface PolySceneOptions {
  perspective?: number | false;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  /**
   * Camera pull-back distance in CSS pixels. Increasing distance moves the
   * camera farther from the target (scene appears smaller), applied as an
   * outermost `translateZ(-distance)` in the scene transform. Matches the
   * `distance` field in core's `CameraState`. Default: 0 (no dolly offset).
   */
  distance?: number;
  /**
   * World-coordinate camera target — the world point that appears at the
   * viewport centre. Matches React's `CameraState.target`. Defaults to
   * `[0, 0, 0]` so existing scenes that don't set it keep working.
   *
   * Internally encoded as the innermost translate in the scene transform:
   * `scale(zoom) rotateX(rotX) rotate(rotY) translate3d(-ty*tile, -tx*tile, -tz*tile)`
   * (world→CSS axis swap: world-X→CSS-Y, world-Y→CSS-X, world-Z→CSS-Z).
   */
  target?: Vec3;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: PolyTextureLightingMode;
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

export interface PolyMeshTransform {
  /** Stable identifier — exposed on the handle and reflected on the
   *  wrapper as `data-poly-mesh-id`. Used by selection helpers to
   *  resolve clicks back to the mesh and to dedupe selection state. */
  id?: string;
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

export interface PolyMeshHandle {
  /** The polygons that were loaded after normalization and automatic merge. */
  polygons: Polygon[];
  /** The `.polycss-mesh` wrapper div for this mesh. Exposed so layered
   *  helpers (selection, transform controls) can resolve a click target
   *  back to its owning mesh, attach event listeners, or measure the
   *  mesh's screen position via `getBoundingClientRect`. */
  readonly element: HTMLElement;
  /** Identifier passed via `PolyMeshTransform.id` (if any). Reflected on
   *  the wrapper as `data-poly-mesh-id`. */
  readonly id?: string;
  /** Current transform snapshot (position / rotation / scale). Returned
   *  by reference — treat as read-only and use `setTransform` to
   *  mutate. */
  readonly transform: PolyMeshTransform;
  /** Remove the mesh from the scene. */
  remove(): void;
  /** Replace polygon geometry without tearing down the scene or controls. */
  setPolygons(polygons: Polygon[], options?: {
    merge?: boolean;
    stableDom?: boolean;
    recomputeAutoCenter?: boolean;
  }): void;
  /** Update transform without re-parsing. */
  setTransform(t: Partial<PolyMeshTransform>): void;
  /** Revoke any blob URLs the parse created. Idempotent. */
  dispose(): void;
  /**
   * Re-rasterize the atlas using the directional light inverse-rotated into
   * the mesh's local frame. Call this after a mesh rotation has been
   * committed (e.g., on pointer release in rotate-mode transform controls) to
   * correct stale baked shading.
   *
   * **Background:** Baked atlas tiles encode `baseColor × Lambert(worldNormal,
   * worldLight)`. When the mesh wrapper rotates via CSS, the polygon's normal
   * in world space changes but the baked color doesn't — faces stay lit/unlit
   * incorrectly. `rebakeAtlas()` inverse-rotates the world light into the
   * mesh's local frame and re-runs the rasterizer; because
   * `dot(localNormal, localLight) === dot(worldNormal, worldLight)` the
   * output is correct for any rotation.
   *
   * **Performance note:** This does NOT run on every `setTransform` call —
   * only when explicitly invoked, so dragging remains smooth. Call it on
   * pointer release (or any point where you want to commit the new shading).
   */
  rebakeAtlas(): void;
  /** Current `position` from the transform (matches framework API). */
  getPosition(): Vec3 | undefined;
  /** Current `rotation` from the transform (matches framework API). */
  getRotation(): Vec3 | undefined;
  /** Current `scale` from the transform (matches framework API). */
  getScale(): number | Vec3 | undefined;
  /** Polygons currently being rendered (matches framework API). */
  getPolygons(): Polygon[];
}

export interface PolySceneHandle {
  /** Add a mesh to the scene. Returns a handle for later removal. */
  add(mesh: ParseResult, opts?: PolyMeshTransform): PolyMeshHandle;
  /** Update scene-level config (rotation, lighting, etc.). */
  setOptions(partial: Partial<PolySceneOptions>): void;
  /** Tear down the scene; revokes all blob URLs of registered meshes. */
  destroy(): void;
  /**
   * The host element passed to `createPolyScene`. Exposed for layered
   * helpers like `createPolyOrbitControls` that need to attach event listeners
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
  /** Snapshot of mesh handles currently in the scene (insertion order).
   *  Used by selection helpers to enumerate hit-test candidates. */
  meshes(): readonly PolyMeshHandle[];
  /** Resolve a `.polycss-mesh` element back to its handle, or `null` if
   *  the element doesn't belong to this scene. */
  findMeshByElement(element: Element | null): PolyMeshHandle | null;
}

// Match React's PolyCamera default — 1000px is a strong fish-eye that
// distorts loaded meshes; 8000px gives the gentle iso look users expect.
const DEFAULT_PERSPECTIVE = 8000;
const DEFAULT_ROT_X = 65;
const DEFAULT_ROT_Y = 45;
const DEFAULT_ZOOM = 1;
const DEFAULT_TILE = BASE_TILE;

function buildMeshTransform(t: PolyMeshTransform): string | undefined {
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
  const distance = opts.distance ?? 0;
  const target = opts.target ?? [0, 0, 0];
  // World→CSS axis swap: world[0]→CSS Y, world[1]→CSS X, world[2]→CSS Z.
  // Negate so the scene moves such that `target` appears at viewport centre.
  const cssX = target[1] * DEFAULT_TILE;  // world Y → CSS X
  const cssY = target[0] * DEFAULT_TILE;  // world X → CSS Y
  const cssZ = target[2] * DEFAULT_TILE;  // world Z → CSS Z
  // Match React's PolyCamera transform: rotate() (i.e. rotateZ) — NOT
  // rotateY. After the rotateX tilt, the world's Z axis is what reads
  // as "spin in place"; rotateY rotates around an oblique axis and
  // makes the mesh wobble. Names line up: rotY in our API == CSS rotate.
  // translate3d is innermost (applied first) → world-space pan at any tilt.
  // translateZ(-distance) is outermost (applied last) — pulls the camera
  // back from the target along the view axis (dolly). Matches core's getStyle().
  const distancePart = distance !== 0 ? `translateZ(${-distance}px) ` : "";
  return `${distancePart}scale(${zoom}) rotateX(${rotX}deg) rotate(${rotY}deg) translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`;
}

// ─── Lambert-bucket grouping ────────────────────────────────────────────────
// For dynamic-mode scenes: group polygons by quantized face normal + color
// into wrapper divs. The wrapper has the bucket's normal as inline CSS
// vars; the per-bucket cascade rule computes `--plam` ONCE per
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
  // bucket's normal sits in the same frame as `--plx/ly/lz`. The
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
): PolySceneHandle {
  if (!host || typeof host.appendChild !== "function") {
    throw new Error("createPolyScene: host must be an HTMLElement");
  }

  // Inject base styles into the host's owning document so .polycss-scene
  // has perspective + preserve-3d defaults.
  if (host.ownerDocument) injectPolyBaseStyles(host.ownerDocument);

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
  sceneEl.setAttribute("aria-hidden", "true");
  // 0×0 anchor at the host's visible center. Polygons render around it.
  applySceneStyle(sceneEl, currentOptions);

  // autoCenter wrapper: a child div translated so the union mesh bbox
  // center coincides with the scene anchor (world (0,0,0)).
  const centerWrapper = doc.createElement("div");
  centerWrapper.className = "polycss-offset";
  // Wrapper is always present so meshes append into a stable parent.
  // When autoCenter is off, transform stays empty (identity).
  sceneEl.appendChild(centerWrapper);

  host.appendChild(sceneEl);

  interface MeshEntry {
    handle: PolyMeshHandle;
    wrapper: HTMLDivElement;
    parseResult: ParseResult;
    rendered: RenderedPoly[];
    disposeAtlas?: () => void;
    polygons: Polygon[];
    disposed: boolean;
    stableDom: boolean;
    excludeFromAutoCenter: boolean;
    /** Rotation snapshot used by the baked atlas baker. Advances only when
     *  `rebakeAtlas()` is called — not on every `setTransform`. */
    bakedRotation: Vec3;
  }
  const meshes = new Set<MeshEntry>();

  function applySceneStyle(el: HTMLElement, opts: PolySceneOptions): void {
    el.style.setProperty("--scene-transform", buildSceneTransform(opts));
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
      "--plx", "--ply", "--plz",
      "--plr", "--plg", "--plb", "--pli",
      "--par", "--pag", "--pab", "--pai",
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
    el.style.setProperty("--plx", lx.toFixed(4));
    el.style.setProperty("--ply", ly.toFixed(4));
    el.style.setProperty("--plz", lz.toFixed(4));
    el.style.setProperty("--plr", ch(lightRgb[0]));
    el.style.setProperty("--plg", ch(lightRgb[1]));
    el.style.setProperty("--plb", ch(lightRgb[2]));
    el.style.setProperty("--pli", lightIntensity.toFixed(4));
    el.style.setProperty("--par", ch(ambRgb[0]));
    el.style.setProperty("--pag", ch(ambRgb[1]));
    el.style.setProperty("--pab", ch(ambRgb[2]));
    el.style.setProperty("--pai", ambientIntensity.toFixed(4));
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
      bucketEl.style.setProperty("--pnx", String(group.vec[0]));
      bucketEl.style.setProperty("--pny", String(group.vec[1]));
      bucketEl.style.setProperty("--pnz", String(group.vec[2]));
      for (const item of group.items) {
        bucketEl.appendChild(item.element);
        // Atlas sets per-poly --pnx/y/z inline (for the non-bucketed
        // dynamic-lighting path used by other consumers). Inside a bucket
        // those inline values are dead weight — the lambert is computed at
        // the wrapper and inherited. Strip them.
        item.element.style.removeProperty("--pnx");
        item.element.style.removeProperty("--pny");
        item.element.style.removeProperty("--pnz");
      }
      fragment.appendChild(bucketEl);
    }

    entry.wrapper.appendChild(fragment);
  }

  // Dynamic-mode per-mesh light override: when the mesh has a non-zero rotation
  // and the scene is in dynamic lighting mode, emit --plx/ly/lz on the
  // wrapper element, computed by inverse-rotating the world-space light into the
  // mesh's local frame. The cascade means these override the scene-level vars
  // only for polygons inside this wrapper. Cleared when conditions are not met.
  function applyMeshLightVarOverride(wrapper: HTMLDivElement, rotation: Vec3 | undefined): void {
    const isDynamic = currentOptions.textureLighting === "dynamic";
    const dir = currentOptions.directionalLight?.direction;
    const hasNonZeroRotation = rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0);

    if (!isDynamic || !hasNonZeroRotation || !dir) {
      wrapper.style.removeProperty("--plx");
      wrapper.style.removeProperty("--ply");
      wrapper.style.removeProperty("--plz");
      return;
    }

    const localDir = inverseRotateVec3(dir as Vec3, rotation as Vec3);
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    wrapper.style.setProperty("--plx", (localDir[0] / len).toFixed(4));
    wrapper.style.setProperty("--ply", (localDir[1] / len).toFixed(4));
    wrapper.style.setProperty("--plz", (localDir[2] / len).toFixed(4));
  }

  function renderEntry(entry: MeshEntry, lightDirectionOverride?: Vec3): void {
    clearRendered(entry);
    const baseDirLight = currentOptions.directionalLight;
    const directionalLight: typeof baseDirLight = lightDirectionOverride
      ? { ...baseDirLight, direction: lightDirectionOverride }
      : baseDirLight;
    const renderOptions = {
      doc,
      directionalLight,
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
      centerWrapper.style.removeProperty("--offset-transform");
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
      centerWrapper.style.removeProperty("--offset-transform");
      return;
    }
    const bbox = computeSceneBbox(all);
    const tile = DEFAULT_TILE;
    // Match React's axis remap: world-Y → CSS-x, world-X → CSS-y, world-Z → CSS-z.
    const cssX = ((bbox.min[1] + bbox.max[1]) / 2) * tile;
    const cssY = ((bbox.min[0] + bbox.max[0]) / 2) * tile;
    const cssZ = ((bbox.min[2] + bbox.max[2]) / 2) * tile;
    centerWrapper.style.setProperty("--offset-transform", `translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`);
  }

  function add(parseResult: ParseResult, transformIn: PolyMeshTransform = {}): PolyMeshHandle {
    const mountDoc = sceneEl.ownerDocument ?? document;
    const wrapper = mountDoc.createElement("div");
    wrapper.className = "polycss-mesh";
    if (transformIn.id) wrapper.setAttribute("data-poly-mesh-id", transformIn.id);

    let transform: PolyMeshTransform = { ...transformIn };
    let mergeOnUpdate = transformIn.merge !== false;
    let stableDomOnUpdate = !!transformIn.stableDom;
    const css = buildMeshTransform(transform);
    if (css) wrapper.style.transform = css;

    const preparePolygons = (polygons: Polygon[], merge: boolean): Polygon[] =>
      merge ? mergePolygons(polygons) : polygons;
    const sourcePolygons = preparePolygons(parseResult.polygons, mergeOnUpdate);

    // Pivot rotations around the mesh's polygon bbox center, not the
    // wrapper's local (0,0,0). The wrapper sits at `transform.position`
    // inside centerWrapper, but its polygons live at their world coords
    // — without an explicit transform-origin, rotateX/Y/Z would pivot
    // at the wrapper's anchor (= world origin in mesh-local), so the
    // mesh would orbit around world (0,0,0) rather than rotating in
    // place. Setting transform-origin to the polygon bbox center makes
    // setTransform({rotation}) behave intuitively.
    function applyTransformOrigin(polygons: Polygon[]): void {
      if (polygons.length === 0) {
        wrapper.style.removeProperty("--origin");
        return;
      }
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const poly of polygons) {
        for (const v of poly.vertices) {
          if (v[0] < minX) minX = v[0];
          if (v[0] > maxX) maxX = v[0];
          if (v[1] < minY) minY = v[1];
          if (v[1] > maxY) maxY = v[1];
          if (v[2] < minZ) minZ = v[2];
          if (v[2] > maxZ) maxZ = v[2];
        }
      }
      if (!Number.isFinite(minX)) {
        wrapper.style.removeProperty("--origin");
        return;
      }
      // World→CSS axis remap (matches polygonGeometry / autoCenter).
      const cssX = ((minY + maxY) / 2) * DEFAULT_TILE;
      const cssY = ((minX + maxX) / 2) * DEFAULT_TILE;
      const cssZ = ((minZ + maxZ) / 2) * DEFAULT_TILE;
      wrapper.style.setProperty("--origin", `${cssX}px ${cssY}px ${cssZ}px`);
    }
    applyTransformOrigin(sourcePolygons);

    centerWrapper.appendChild(wrapper);

    const entry: MeshEntry = {
      handle: undefined as unknown as PolyMeshHandle,
      wrapper,
      parseResult,
      rendered: [],
      polygons: sourcePolygons,
      disposed: false,
      stableDom: stableDomOnUpdate,
      excludeFromAutoCenter: !!transformIn.excludeFromAutoCenter,
      bakedRotation: (transformIn.rotation ? [...transformIn.rotation] : [0, 0, 0]) as Vec3,
    };

    const handle: PolyMeshHandle = {
      polygons: sourcePolygons,
      element: wrapper,
      id: transformIn.id,
      get transform() { return transform; },
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
        applyTransformOrigin(entry.polygons);
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
      setTransform(t: Partial<PolyMeshTransform>) {
        transform = { ...transform, ...t };
        const css2 = buildMeshTransform(transform);
        wrapper.style.transform = css2 ?? "";
        applyMeshLightVarOverride(wrapper, transform.rotation);
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
      rebakeAtlas() {
        // Advance the baked rotation to match the current live rotation.
        // The atlas baker will use this to inverse-rotate the world light
        // into the mesh's local frame so Lambert shading stays correct.
        entry.bakedRotation = (transform.rotation ? [...transform.rotation] : [0, 0, 0]) as Vec3;
        // Compute the local-frame light direction by inverse-rotating the
        // world-space directional light through the baked rotation.
        // dot(localNormal, localLight) === dot(worldNormal, worldLight),
        // so the rasterized atlas produces correct shading after rotation.
        const worldDir = currentOptions.directionalLight?.direction ?? [0.4, -0.7, 0.59] as Vec3;
        const localLightDir = inverseRotateVec3(worldDir as Vec3, entry.bakedRotation);
        renderEntry(entry, localLightDir);
      },
      getPosition() { return transform.position; },
      getRotation() { return transform.rotation; },
      getScale() { return transform.scale; },
      getPolygons() { return handle.polygons; },
    };

    entry.handle = handle;
    meshes.add(entry);
    renderEntry(entry);
    applyMeshLightVarOverride(wrapper, transform.rotation);
    recomputeAutoCenter();
    return handle;
  }

  function setOptions(partial: Partial<PolySceneOptions>): void {
    const prevAutoCenter = !!currentOptions.autoCenter;
    currentOptions = { ...currentOptions, ...partial };
    applySceneStyle(sceneEl, currentOptions);
    const nextAutoCenter = !!currentOptions.autoCenter;
    // Re-evaluate per-mesh light overrides when lighting settings change —
    // textureLighting or directionalLight may have changed.
    for (const entry of meshes) {
      applyMeshLightVarOverride(entry.wrapper, entry.handle.transform.rotation);
    }
    // No syncInteractive — pointer/wheel input now lives in
    // createPolyOrbitControls / createPolyMapControls (additive layers).
    // createPolyScene is the pure renderer + camera-state owner.
    if (prevAutoCenter !== nextAutoCenter) recomputeAutoCenter();
  }

  function getOptions(): Readonly<PolySceneOptions> {
    return currentOptions;
  }

  function listMeshes(): readonly PolyMeshHandle[] {
    const out: PolyMeshHandle[] = [];
    for (const entry of meshes) out.push(entry.handle);
    return out;
  }

  function findMeshByElement(el: Element | null): PolyMeshHandle | null {
    let cur: Element | null = el;
    while (cur) {
      if (cur instanceof HTMLElement && cur.classList.contains("polycss-mesh")) {
        for (const entry of meshes) {
          if (entry.wrapper === cur) return entry.handle;
        }
        return null;
      }
      cur = cur.parentElement;
    }
    return null;
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

  return { add, setOptions, destroy, host, getOptions, meshes: listMeshes, findMeshByElement };
}
