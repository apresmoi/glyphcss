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
import {
  BASE_TILE,
  computeSceneBbox,
  findOverlappingPolygonDuplicates,
  inverseRotateVec3,
  mergePolygons,
  parseHexColor,
} from "@layoutit/polycss-core";
import {
  cssBorderShapeForPlan,
  getSolidPaintDefaults,
  renderPolygonsWithTextureAtlas,
  renderPolygonsWithTextureAtlasAsync,
  renderPolygonsWithStableTriangles,
  updatePolygonsWithStableTopology,
  type TextureQuality,
  type PolyRenderStrategiesOption,
  type RenderedPoly,
  type SolidPaintDefaults,
} from "../render/textureAtlas";
import { injectPolyBaseStyles } from "../styles/styles";

// Used only by the internal async mesh update path. Batching DOM insertion
// keeps large gallery meshes below Chrome's long-task warning threshold
// without changing the synchronous public setPolygons() contract.
const ASYNC_MOUNT_BATCH_SIZE = 750;
const DEFAULT_SCENE_PERSPECTIVE = 8000;

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
  /** Raster scale for generated atlas pages. `"auto"` reduces large atlases
   *  to fit a device-appropriate memory budget (~4 MB mobile / ~16 MB desktop).
   *  Numeric values 0.1..1 force an explicit scale. */
  textureQuality?: TextureQuality;
  /**
   * Skip specific render-strategy tags. Polygons that would normally use a
   * disabled tag fall through the chain (b → i → s, u → i → s, i → s).
   * `<s>` is the universal fallback and cannot be disabled.
   */
  strategies?: PolyRenderStrategiesOption;
  /**
   * When `true`, rotation pivots around the union bbox of all added meshes
   * instead of world (0,0,0). The scene wraps polygons in an inner div
   * translated by `-bboxCenter`. Updates whenever a mesh is added/removed
   * or `setOptions` is called. Mirrors React's `<PolyScene autoCenter>`.
   */
  autoCenter?: boolean;
  /**
   * Shadow appearance for meshes with `castShadow: true`. Only applies in
   * dynamic lighting mode — baked mode does not emit shadow leaves.
   * Defaults: `{ color: "#000000", opacity: 0.25, lift: 0.05 }`.
   */
  shadow?: {
    /** Shadow color as a CSS hex string. Default: `"#000000"`. */
    color?: string;
    /** Shadow opacity 0..1. Default: `0.25`. */
    opacity?: number;
    /**
     * Raises the shadow plane slightly above the model bbox floor along
     * +Z (Z up) so it sits on top of a receiver mesh placed at the bbox
     * bottom, rather than below it where the receiver would occlude the
     * shadow. In world units. Default: `0.05`.
     */
    lift?: number;
  };
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
  /**
   * When `true` and the scene is in dynamic lighting mode, the renderer emits
   * a flat shadow leaf sibling for each non-textured polygon. The shadow is
   * projected onto the ground plane (min world-Y of all casting meshes) along
   * the CSS-space light direction (driven by `--clx/--cly/--clz` vars). Zero
   * JS in the render loop — the projection matrix is a CSS var that recomputes
   * via `calc()` when the light vars change. Defaults to `false`.
   */
  castShadow?: boolean;
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
  /**
   * Update a single polygon in place. `target` is either a polygon
   * reference (as returned by `getPolygons()`) or its index. `partial`
   * fields are merged onto the polygon; the mesh is then re-rendered.
   * Skips the merge pass, so this is cheaper than `setPolygons` for
   * targeted edits like color picker updates from an inspector UI.
   * Silently no-ops if `target` isn't found.
   */
  updatePolygon(target: Polygon | number, partial: Partial<Polygon>): void;
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

// Internal-only async update hook for large imperative scene users. Keeping it
// off PolyMeshHandle avoids turning a debug-workbench long-task fix into a
// public API contract that React/Vue also need to mirror.
interface InternalPolyMeshHandle extends PolyMeshHandle {
  setPolygonsChunked(polygons: Polygon[], options?: {
    merge?: boolean;
    stableDom?: boolean;
    recomputeAutoCenter?: boolean;
  }): Promise<void>;
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
   * textureLighting, textureQuality, and perspective). Returned by reference,
   * so callers must treat it as read-only —
   * mutations won't propagate. Used by helpers that need to read the current
   * camera state without duplicating it.
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

function strategiesEqual(
  a: PolyRenderStrategiesOption | undefined,
  b: PolyRenderStrategiesOption | undefined,
): boolean {
  const da = a?.disable ?? [];
  const db = b?.disable ?? [];
  if (da.length !== db.length) return false;
  for (const s of da) if (!db.includes(s)) return false;
  return true;
}

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

function buildSceneTransform(
  opts: PolySceneOptions,
  autoCenterOffset: Vec3 = [0, 0, 0],
  layoutScale = 1,
): string {
  const rotX = opts.rotX ?? DEFAULT_ROT_X;
  const rotY = opts.rotY ?? DEFAULT_ROT_Y;
  const zoom = (opts.zoom ?? DEFAULT_ZOOM) * layoutScale;
  const distance = (opts.distance ?? 0) * layoutScale;
  const target = opts.target ?? [0, 0, 0];
  // World→CSS axis swap: world[0]→CSS Y, world[1]→CSS X, world[2]→CSS Z.
  // Negate so the scene moves such that `target + autoCenterOffset` appears
  // at viewport centre. `autoCenterOffset` is the bbox-center of all meshes
  // (auto-managed); `target` is the user-driven pan delta (orbit/map
  // controls). Keeping them separate means panning is preserved across
  // mesh add/remove, and an automatic recenter doesn't fight the user's
  // chosen view target.
  const wx = target[0] + autoCenterOffset[0];
  const wy = target[1] + autoCenterOffset[1];
  const wz = target[2] + autoCenterOffset[2];
  const cssX = wy * DEFAULT_TILE;  // world Y → CSS X
  const cssY = wx * DEFAULT_TILE;  // world X → CSS Y
  const cssZ = wz * DEFAULT_TILE;  // world Z → CSS Z
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

function parseCssZoom(value: string): number {
  const text = value.trim();
  if (!text || text === "normal") return 1;
  const numeric = text.endsWith("%")
    ? Number(text.slice(0, -1)) / 100
    : Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function effectiveCssZoom(element: HTMLElement): number {
  const win = element.ownerDocument?.defaultView;
  if (!win) return 1;

  let zoom = 1;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    zoom *= parseCssZoom(win.getComputedStyle(current).getPropertyValue("zoom"));
  }
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function scaledCssPixels(value: number, scale: number): number {
  return scale === 1 ? value : value * scale;
}

function applyCssZoomCompensation(el: HTMLElement, scale: number): void {
  // Chromium's CSS zoom can scale layout metrics without scaling the
  // preserve-3d rasterization path consistently. Neutralize zoom on the scene
  // root, then fold the same scale into the matrix/perspective explicitly.
  if (Math.abs(scale - 1) < 1e-6) {
    el.style.removeProperty("zoom");
  } else {
    el.style.setProperty("zoom", String(1 / scale));
  }
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
  // CSS-space edges — must match `computeTextureAtlasPlan` exactly so the
  // bucket's normal sits in the same frame as `--plx/ly/lz`. The
  // atlas applies `toCss(v) = [v.y, v.x, v.z]` (x↔y swap) and then takes
  // a NEGATED cross product. Reproducing both here means the cascade
  // dot(normal, light) computes the same value as the original per-poly
  // path that was set inline by `applyDynamicNormalVars`.
  const v0 = p.vertices[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < p.vertices.length; i++) {
    const v1 = p.vertices[i];
    const v2 = p.vertices[i + 1];
    const e1x = v1[1] - v0[1], e1y = v1[0] - v0[0], e1z = v1[2] - v0[2];
    const e2x = v2[1] - v0[1], e2y = v2[0] - v0[0], e2z = v2[2] - v0[2];
    nx -= e1y * e2z - e1z * e2y;
    ny -= e1z * e2x - e1x * e2z;
    nz -= e1x * e2y - e1y * e2x;
  }
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

  // Bbox-center of all live meshes (helpers opt out). Auto-managed by
  // `recomputeAutoCenter`. Folded into the scene transform alongside
  // `target` so the camera orbits the model's visible center without
  // shifting the mesh DOM. Independent of `target` so user pan survives
  // mesh add/remove. Declared here (above the first `applySceneStyle`
  // call) so it's initialized before the closure reads it.
  let autoCenterOffset: Vec3 = [0, 0, 0];

  const doc = host.ownerDocument ?? document;
  const sceneEl = doc.createElement("div");
  sceneEl.className = "polycss-scene";
  sceneEl.setAttribute("aria-hidden", "true");
  // 0×0 anchor at the host's visible center. Polygons render around it.
  applySceneStyle(sceneEl, currentOptions);

  host.appendChild(sceneEl);

  interface MeshEntry {
    handle: PolyMeshHandle;
    wrapper: HTMLDivElement;
    parseResult: ParseResult;
    rendered: RenderedPoly[];
    /** Shadow leaf elements, one per non-textured non-atlas polygon. Kept
     *  separate from `rendered` so they can be removed independently when
     *  castShadow is toggled or lighting mode changes. */
    shadowRendered: HTMLElement[];
    disposeAtlas?: () => void;
    polygons: Polygon[];
    disposed: boolean;
    stableDom: boolean;
    excludeFromAutoCenter: boolean;
    castShadow: boolean;
    /** Rotation snapshot used by the baked atlas baker. Advances only when
     *  `rebakeAtlas()` is called — not on every `setTransform`. */
    bakedRotation: Vec3;
  }
  const meshes = new Set<MeshEntry>();

  function applySceneStyle(el: HTMLElement, opts: PolySceneOptions): void {
    const layoutScale = effectiveCssZoom(host);
    applyCssZoomCompensation(el, layoutScale);
    el.style.transform = buildSceneTransform(opts, autoCenterOffset, layoutScale);
    if (typeof opts.perspective === "number") {
      el.style.perspective = `${scaledCssPixels(opts.perspective, layoutScale)}px`;
    } else if (opts.perspective === false) {
      // Orthographic projection — true `perspective: none` triggers a Chrome
      // compositor fast path that mis-rasterizes <u> border-triangle leaves
      // (0×0 layout box with asymmetric borders): holes and dropped fragments
      // at initial paint. A very large finite perspective is visually
      // indistinguishable from orthographic (no perceptible foreshortening at
      // this distance) but routes Chrome through the normal compositor path.
      el.style.perspective = `${scaledCssPixels(1000000, layoutScale)}px`;
    } else {
      if (Math.abs(layoutScale - 1) < 1e-6) {
        el.style.removeProperty("perspective");
      } else {
        el.style.perspective = `${scaledCssPixels(DEFAULT_SCENE_PERSPECTIVE, layoutScale)}px`;
      }
    }
    applyDynamicLightVars(el, opts);
  }

  // Dynamic lighting cascade vars: PolyScene writes the directional + ambient
  // light setup to these custom properties on the scene root. Each polygon's
  // <i> bakes its own normal directly into an inline calc() that reads these
  // vars to resolve the Lambert dot product and per-channel tint. Sliding
  // the light only writes these scene-root vars — no JS, no atlas redraw.
  //
  // Additionally emits --clx/--cly/--clz: the directional light expressed in
  // CSS coordinate space (world-Y→CSS-X, world-X→CSS-Y, world-Z→CSS-Z). These
  // are used by the shadow projection matrix (--shadow-proj) which must operate
  // on matrix3d positions that live in CSS space — not world space. The Lambert
  // dot product can use world-space normals because both normals and light sit
  // in the same frame there; the shadow projection works against 3D positions
  // that have already been through the axis swap, so it needs the light in
  // that same swapped frame.
  function applyDynamicLightVars(el: HTMLElement, opts: PolySceneOptions): void {
    const dynamic = opts.textureLighting === "dynamic";
    el.dataset.polycssLighting = opts.textureLighting ?? "baked";
    const vars = [
      "--plx", "--ply", "--plz",
      "--plr", "--plg", "--plb", "--pli",
      "--par", "--pag", "--pab", "--pai",
      "--clx", "--cly", "--clz",
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
    // Light direction vars for the shadow projection. These match the
    // axis convention used by Lambert (`--plx/--ply/--plz`) where the
    // X and Y component naming follows the user-facing light direction
    // vector directly (NO world→CSS axis swap). The shadow projection
    // matrix in styles.ts is written against this same convention.
    // Clamp clz away from zero — shadow projection divides by clz (the
    // up-axis component), so a near-horizontal light would project
    // shadows to infinity.
    const rawClz = lz;
    const clz = Math.sign(rawClz || 1) * Math.max(Math.abs(rawClz), 0.01);
    el.style.setProperty("--clx", lx.toFixed(4));
    el.style.setProperty("--cly", ly.toFixed(4));
    el.style.setProperty("--clz", clz.toFixed(4));
  }

  function clearRendered(entry: MeshEntry): void {
    disposeRendered(entry.rendered, entry.disposeAtlas);
    entry.disposeAtlas = undefined;
    entry.rendered.length = 0;
    clearShadowLeaves(entry);
    while (entry.wrapper.firstChild) entry.wrapper.removeChild(entry.wrapper.firstChild);
  }

  function clearShadowLeaves(entry: MeshEntry): void {
    for (const el of entry.shadowRendered) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    entry.shadowRendered.length = 0;
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

  function yieldToMainThread(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function syncMountedRenderedChunked(
    entry: MeshEntry,
    shouldCancel: () => boolean,
  ): Promise<boolean> {
    const useBuckets =
      currentOptions.textureLighting === "dynamic" && !entry.stableDom;
    if (useBuckets) {
      syncMountedRendered(entry);
      return !shouldCancel();
    }

    let fragment = doc.createDocumentFragment();
    let count = 0;
    for (const item of entry.rendered) {
      if (shouldCancel()) return false;
      fragment.appendChild(item.element);
      count++;
      if (count % ASYNC_MOUNT_BATCH_SIZE === 0) {
        entry.wrapper.appendChild(fragment);
        fragment = doc.createDocumentFragment();
        await yieldToMainThread();
      }
    }
    if (fragment.childNodes.length > 0) entry.wrapper.appendChild(fragment);
    return !shouldCancel();
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

  function applySolidPaintVars(wrapper: HTMLDivElement, defaults: SolidPaintDefaults): void {
    if (defaults.paintColor) {
      wrapper.style.setProperty("--polycss-paint", defaults.paintColor);
    } else {
      wrapper.style.removeProperty("--polycss-paint");
    }

    if (defaults.dynamicColor) {
      wrapper.style.setProperty("--psr", (defaults.dynamicColor.r / 255).toFixed(4));
      wrapper.style.setProperty("--psg", (defaults.dynamicColor.g / 255).toFixed(4));
      wrapper.style.setProperty("--psb", (defaults.dynamicColor.b / 255).toFixed(4));
    } else {
      wrapper.style.removeProperty("--psr");
      wrapper.style.removeProperty("--psg");
      wrapper.style.removeProperty("--psb");
    }
  }

  // Emits shadow leaves for all non-textured rendered polys in the entry.
  // Each shadow leaf uses the same tag and shape as the original but with a
  // flat shadow color and a transform prepended by var(--shadow-proj) so it
  // projects onto the ground plane driven entirely by CSS vars.
  //
  // Shadow leaves are inserted BEFORE their caster siblings so they sit
  // below in DOM order, which keeps them behind the casters when both are
  // coplanar in 3D (painter-order tie-breaking favors earlier nodes).
  function emitShadowLeaves(entry: MeshEntry): void {
    clearShadowLeaves(entry);
    if (!entry.castShadow || currentOptions.textureLighting !== "dynamic") return;

    const shadowColor = currentOptions.shadow?.color ?? "#000000";
    const shadowOpacity = currentOptions.shadow?.opacity ?? 0.25;
    // Build a CSS rgba color from the hex + opacity.
    const parsed = parseHexColor(shadowColor)?.rgb ?? [0, 0, 0];
    const r = parsed[0], g = parsed[1], b = parsed[2];
    const shadowColorCss = `rgba(${r},${g},${b},${shadowOpacity})`;

    // Loose-tolerance dedup for shadow casting ONLY — much more permissive
    // than the parse-time dedup that affects the rendered model. Multiple
    // coincident or near-coincident polygons cast overlapping shadow
    // leaves that visibly stack on the receiver; emitting one is enough.
    // Tolerances allow ~25° off-parallel normals and ~0.5 world units of
    // plane-offset drift, catching back-to-back doubled faces and minor
    // importer artifacts without false-positively dropping legitimate
    // inner/outer wall pairs that cast genuinely distinct shadows.
    // Light-independent — runs once per mesh-polygon change, never per
    // camera tick or light slider tick.
    const shadowDedupDrop = findOverlappingPolygonDuplicates(entry.polygons, {
      normalTolerance: 0.1,
      distanceTolerance: 0.5,
      overlapFraction: 0.4,
    });

    const fragment = doc.createDocumentFragment();
    for (const item of entry.rendered) {
      // Atlas (<s>) polygons cast shadows too — the shadow only needs
      // the polygon's OUTLINE (border-shape) and a flat dark color, not
      // the texture content. So fully textured meshes like the Frog Guy
      // get proper shadows just like solid-color meshes.
      // Skip polygons identified as shadow-duplicates of another caster.
      if (shadowDedupDrop.has(item.polygonIndex)) continue;
      const plan = item.plan;
      if (!plan) continue;

      // Read the original matrix3d from the plan (not from the element
      // style string) so we never parse strings.
      const origMatrix = `matrix3d(${plan.matrix})`;

      // Shadow leaves emit as <q> — a dedicated single-letter element
      // that lives alongside <b>/<i>/<s>/<u> in the tag-as-strategy
      // taxonomy. Using its own tag means we don't have to thread
      // `:not(.polycss-shadow)` exclusions through every dynamic-mode
      // color rule (regular polygon leaves get relit by Lambert; shadow
      // leaves shouldn't). Rendering rides the <q> + border-shape path
      // mirrored from <i>'s border-color: currentColor mechanism.
      // clip-path is forbidden by repo policy (4000+ clip-paths inside
      // preserve-3d = ~15 s/frame on Chromium).
      //
      // The caster's normal is pinned inline as --pnx/--pny/--pnz so the
      // cascade can compute a Lambert factor and gate the shadow's
      // opacity: polygons facing AWAY from the light don't cast a
      // shadow on the receiver (their projection is inside the
      // silhouette of the front-facing parts anyway, just adding
      // overdraw). Pure CSS — no JS at light-change time.
      const shadowEl = doc.createElement("q");
      shadowEl.className = "polycss-shadow";
      shadowEl.style.transform = `var(--shadow-proj) ${origMatrix}`;
      shadowEl.style.color = shadowColorCss;
      shadowEl.style.width = `${plan.canvasW}px`;
      shadowEl.style.height = `${plan.canvasH}px`;
      shadowEl.style.setProperty("border-shape", cssBorderShapeForPlan(plan));
      shadowEl.style.setProperty("--pnx", plan.normal[0].toFixed(4));
      shadowEl.style.setProperty("--pny", plan.normal[1].toFixed(4));
      shadowEl.style.setProperty("--pnz", plan.normal[2].toFixed(4));

      fragment.appendChild(shadowEl);
      entry.shadowRendered.push(shadowEl);
    }

    // Insert all shadow leaves BEFORE the first normal polygon child so
    // they appear below casters in DOM order. appendChild would put them
    // after; insertBefore(fragment, firstChild) puts them at the front.
    const firstChild = entry.wrapper.firstChild;
    if (firstChild) {
      entry.wrapper.insertBefore(fragment, firstChild);
    } else {
      entry.wrapper.appendChild(fragment);
    }
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
      textureQuality: currentOptions.textureQuality,
      strategies: currentOptions.strategies,
    };
    const solidPaintDefaults = getSolidPaintDefaults(entry.polygons, renderOptions);
    applySolidPaintVars(entry.wrapper, solidPaintDefaults);
    const renderOptionsWithDefaults = {
      ...renderOptions,
      solidPaintDefaults,
    };
    const atlas = (
      entry.stableDom
        ? renderPolygonsWithStableTriangles(entry.polygons, renderOptionsWithDefaults)
        : null
    ) ?? renderPolygonsWithTextureAtlas(entry.polygons, renderOptionsWithDefaults);
    entry.rendered = atlas.rendered;
    entry.disposeAtlas = atlas.dispose;
    syncMountedRendered(entry);
    emitShadowLeaves(entry);
  }

  // Recomputes --shadow-ground-cssz from the minimum world-Z across all
  // casting meshes. World Z stays as CSS Z under the world→CSS axis swap.
  // In polycss's world convention Z is up — the red-green plane in the axes
  // helper is the floor. An optional `lift` (in world units) raises the
  // plane slightly above the bbox floor to prevent z-fighting with
  // receiver polygons.
  function recomputeShadowGround(): void {
    if (currentOptions.textureLighting !== "dynamic") {
      sceneEl.style.removeProperty("--shadow-ground-cssz");
      return;
    }
    let minWorldZ = Infinity;
    for (const m of meshes) {
      if (!m.disposed && m.castShadow) {
        for (const poly of m.polygons) {
          for (const v of poly.vertices) {
            if (v[2] < minWorldZ) minWorldZ = v[2];
          }
        }
      }
    }
    if (!Number.isFinite(minWorldZ)) {
      sceneEl.style.removeProperty("--shadow-ground-cssz");
      return;
    }
    const lift = currentOptions.shadow?.lift ?? 0.05;
    // World Z → CSS Z: the ground plane in CSS-Z coordinates. Lift is added
    // (not subtracted) so the shadow plane sits slightly *above* the model
    // bbox floor — putting it on top of a receiver mesh placed at minZ
    // rather than below it, where the receiver would occlude the shadow.
    // Stored as a unitless number (not px) because matrix3d() calc() entries
    // must be dimensionless — see styles.ts @property --shadow-ground-cssz.
    const groundCssZ = (minWorldZ + lift) * DEFAULT_TILE;
    sceneEl.style.setProperty("--shadow-ground-cssz", groundCssZ.toFixed(3));
  }

  async function renderEntryChunked(
    entry: MeshEntry,
    shouldCancel: () => boolean,
  ): Promise<boolean> {
    clearRendered(entry);
    const renderOptions = {
      doc,
      directionalLight: currentOptions.directionalLight,
      ambientLight: currentOptions.ambientLight,
      textureLighting: currentOptions.textureLighting,
      textureQuality: currentOptions.textureQuality,
      strategies: currentOptions.strategies,
    };
    const atlas = entry.stableDom
      ? renderPolygonsWithStableTriangles(entry.polygons, renderOptions)
      : null;
    if (atlas) {
      const solidPaintDefaults = getSolidPaintDefaults(entry.polygons, renderOptions);
      applySolidPaintVars(entry.wrapper, solidPaintDefaults);
      entry.rendered = atlas.rendered;
      entry.disposeAtlas = atlas.dispose;
      syncMountedRendered(entry);
      emitShadowLeaves(entry);
      return !shouldCancel();
    }

    const asyncAtlas = await renderPolygonsWithTextureAtlasAsync(
      entry.polygons,
      renderOptions,
      shouldCancel,
    );
    if (shouldCancel()) {
      asyncAtlas.dispose();
      return false;
    }
    applySolidPaintVars(entry.wrapper, asyncAtlas.solidPaintDefaults);
    entry.rendered = asyncAtlas.rendered;
    entry.disposeAtlas = asyncAtlas.dispose;
    const mounted = await syncMountedRenderedChunked(entry, shouldCancel);
    if (mounted) emitShadowLeaves(entry);
    return mounted;
  }

  function recomputeAutoCenter(): void {
    // Three.js–style: instead of moving the meshes (via a wrapper translate),
    // store the bbox center as a camera-target offset. `buildSceneTransform`
    // folds it into the scene's rotation pivot, so the visible center stays
    // at the viewport without adding a DOM wrapper or shifting polygon
    // coordinates.
    const prev = autoCenterOffset;
    let next: Vec3 = [0, 0, 0];
    if (currentOptions.autoCenter) {
      const all: Polygon[] = [];
      for (const m of meshes) {
        if (!m.disposed && !m.excludeFromAutoCenter) all.push(...m.polygons);
      }
      if (all.length > 0) {
        const bbox = computeSceneBbox(all);
        next = [
          (bbox.min[0] + bbox.max[0]) / 2,
          (bbox.min[1] + bbox.max[1]) / 2,
          (bbox.min[2] + bbox.max[2]) / 2,
        ];
      }
    }
    if (prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) return;
    autoCenterOffset = next;
    applySceneStyle(sceneEl, currentOptions);
  }

  function add(parseResult: ParseResult, transformIn: PolyMeshTransform = {}): PolyMeshHandle {
    const mountDoc = sceneEl.ownerDocument ?? document;
    const wrapper = mountDoc.createElement("div");
    wrapper.className = "polycss-mesh";
    if (transformIn.id) wrapper.setAttribute("data-poly-mesh-id", transformIn.id);

    let transform: PolyMeshTransform = { ...transformIn };
    let mergeOnUpdate = transformIn.merge !== false;
    let stableDomOnUpdate = !!transformIn.stableDom;
    let polygonUpdateVersion = 0;
    const css = buildMeshTransform(transform);
    if (css) wrapper.style.transform = css;

    const preparePolygons = (polygons: Polygon[], merge: boolean): Polygon[] =>
      merge ? mergePolygons(polygons) : polygons;
    const sourcePolygons = preparePolygons(parseResult.polygons, mergeOnUpdate);

    // Pivot rotations around the mesh's polygon bbox center, not the
    // wrapper's local (0,0,0). The wrapper sits at `transform.position`
    // inside the scene element, but its polygons live at their world coords
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

    sceneEl.appendChild(wrapper);

    const entry: MeshEntry = {
      handle: undefined as unknown as PolyMeshHandle,
      wrapper,
      parseResult,
      rendered: [],
      shadowRendered: [],
      polygons: sourcePolygons,
      disposed: false,
      stableDom: stableDomOnUpdate,
      excludeFromAutoCenter: !!transformIn.excludeFromAutoCenter,
      castShadow: !!transformIn.castShadow,
      bakedRotation: (transformIn.rotation ? [...transformIn.rotation] : [0, 0, 0]) as Vec3,
    };

    const handle: InternalPolyMeshHandle = {
      polygons: sourcePolygons,
      element: wrapper,
      id: transformIn.id,
      get transform() { return transform; },
      remove() {
        polygonUpdateVersion++;
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        // Removing from DOM doesn't auto-dispose generated atlas/blob URLs.
        clearRendered(entry);
        meshes.delete(entry);
        recomputeAutoCenter();
        recomputeShadowGround();
      },
      setPolygons(polygons: Polygon[], options?: {
        merge?: boolean;
        stableDom?: boolean;
        recomputeAutoCenter?: boolean;
      }) {
        polygonUpdateVersion++;
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
            textureQuality: currentOptions.textureQuality,
          };
          const solidPaintDefaults = getSolidPaintDefaults(entry.polygons, renderOptions);
          applySolidPaintVars(entry.wrapper, solidPaintDefaults);
          if (
            updatePolygonsWithStableTopology(
              entry.rendered,
              entry.polygons,
              { ...renderOptions, solidPaintDefaults },
            )
          ) {
            if (shouldRecomputeAutoCenter) recomputeAutoCenter();
            return;
          }
        }
        renderEntry(entry);
        if (shouldRecomputeAutoCenter) recomputeAutoCenter();
      },
      updatePolygon(target: Polygon | number, partial: Partial<Polygon>) {
        const idx = typeof target === "number"
          ? target
          : entry.polygons.indexOf(target);
        if (idx < 0 || idx >= entry.polygons.length) return;
        Object.assign(entry.polygons[idx], partial);
        renderEntry(entry);
      },
      async setPolygonsChunked(polygons: Polygon[], options?: {
        merge?: boolean;
        stableDom?: boolean;
        recomputeAutoCenter?: boolean;
      }) {
        const version = ++polygonUpdateVersion;
        mergeOnUpdate = options?.merge ?? mergeOnUpdate;
        stableDomOnUpdate = options?.stableDom ?? stableDomOnUpdate;
        entry.stableDom = stableDomOnUpdate;
        entry.polygons = preparePolygons(polygons, mergeOnUpdate);
        handle.polygons = entry.polygons;
        applyTransformOrigin(entry.polygons);
        const shouldRecomputeAutoCenter = options?.recomputeAutoCenter ?? true;
        const shouldCancel = () => entry.disposed || version !== polygonUpdateVersion;
        const completed = await renderEntryChunked(entry, shouldCancel);
        if (!completed) {
          clearRendered(entry);
          return;
        }
        if (shouldRecomputeAutoCenter) recomputeAutoCenter();
      },
      setTransform(t: Partial<PolyMeshTransform>) {
        const prevCastShadow = entry.castShadow;
        if (t.castShadow !== undefined) entry.castShadow = !!t.castShadow;
        transform = { ...transform, ...t };
        const css2 = buildMeshTransform(transform);
        wrapper.style.transform = css2 ?? "";
        applyMeshLightVarOverride(wrapper, transform.rotation);
        if (entry.castShadow !== prevCastShadow) {
          emitShadowLeaves(entry);
          recomputeShadowGround();
        }
      },
      dispose() {
        if (entry.disposed) return;
        entry.disposed = true;
        polygonUpdateVersion++;
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        clearRendered(entry);
        try { parseResult.dispose(); } catch { /* ignore */ }
        meshes.delete(entry);
        recomputeAutoCenter();
        recomputeShadowGround();
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
    recomputeShadowGround();
    return handle;
  }

  function setOptions(partial: Partial<PolySceneOptions>): void {
    const prevAutoCenter = !!currentOptions.autoCenter;
    const prevStrategies = currentOptions.strategies;
    const prevTextureLighting = currentOptions.textureLighting;
    currentOptions = { ...currentOptions, ...partial };
    applySceneStyle(sceneEl, currentOptions);
    const nextAutoCenter = !!currentOptions.autoCenter;
    // Re-evaluate per-mesh light overrides when lighting settings change —
    // textureLighting or directionalLight may have changed.
    for (const entry of meshes) {
      applyMeshLightVarOverride(entry.wrapper, entry.handle.transform.rotation);
    }
    // `strategies` controls which leaf tags the renderer emits. A change
    // means we have to re-render every mesh against the new constraint.
    // Skip the re-render when the value didn't actually change so callers
    // that pass the same strategies on every tick (bundled with camera
    // updates) don't blow up the atlas every frame.
    const strategiesChanged = partial.strategies !== undefined &&
      !strategiesEqual(partial.strategies, prevStrategies);
    if (strategiesChanged) {
      for (const entry of meshes) renderEntry(entry);
    }
    if (prevAutoCenter !== nextAutoCenter) recomputeAutoCenter();
    // When lighting mode changes, re-emit or clear shadow leaves on all meshes
    // that have castShadow set. Shadow emission is only valid in dynamic mode.
    const textureLightingChanged = partial.textureLighting !== undefined &&
      prevTextureLighting !== currentOptions.textureLighting;
    if (textureLightingChanged) {
      for (const entry of meshes) emitShadowLeaves(entry);
      recomputeShadowGround();
    }
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
