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
 *     mesh transform; mounts each polygon as a child SVG/img via
 *     `renderPoly` from `../render/polyDOM`.
 *   - `destroy()` removes the scene element and disposes every mesh
 *     (which in turn disposes per-polygon blob URLs).
 *
 * The scene element is a 0×0 anchor at world (0,0,0) — pinned via
 * top:50%/left:50% so it sits at the visible center of the host. This
 * matches React/Vue's PolyScene anchor pattern. Polygons render around
 * the anchor via their own matrix3d translations.
 */
import type {
  DirectionalLight,
  ParseResult,
  Polygon,
  Vec3,
} from "@polycss/core";
import { computeSceneBbox, mergePolygons } from "@polycss/core";
import { renderPoly, type RenderedPoly } from "../render/polyDOM";
import { slicePolygons } from "../render/slicePolygons";
import { injectBaseStyles } from "../styles/styles";

export interface PolySceneOptions {
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  directionalLight?: DirectionalLight;
  /**
   * Mesh post-processing.
   *   - `"off"` (default): each polygon = one DOM element.
   *   - `"auto"`: coplanar same-color polygons merge (`mergePolygons`).
   *   - `"slice"`: aggressively rasterize coplanar polygons (across colors)
   *     into one textured polygon per axis-aligned plane. Massive DOM
   *     reduction (a 7k-poly voxel scene → ~tens of textured polys).
   *     Trades per-polygon DOM inspection for compositor framerate.
   */
  merge?: "off" | "auto" | "slice";
  /**
   * When `true`, rotation pivots around the union bbox of all added meshes
   * instead of world (0,0,0). The scene wraps polygons in an inner div
   * translated by `-bboxCenter`. Updates whenever a mesh is added/removed
   * or `setOptions` is called. Mirrors React's `<PolyScene autoCenter>`.
   */
  autoCenter?: boolean;
  /**
   * When `true`, attach pointerdown/move/up handlers to the host so the
   * user can drag-rotate the scene (drag-X = yaw / rotY, drag-Y = pitch
   * / rotX). Mirrors React's `<PolyCamera interactive>`. Default false.
   */
  interactive?: boolean;
}

export interface MeshTransform {
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}

export interface MeshHandle {
  /** The polygons that were loaded (post-merge if scene merge is enabled). */
  polygons: Polygon[];
  /** Remove the mesh from the scene. */
  remove(): void;
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

// ─── Direction-binned face culling ───────────────────────────────────────────
// Each axis-aligned polygon is classified into one of 6 face-direction
// buckets (±X, ±Y, ±Z). On every camera change, we compute which 3 of the
// 6 directions face AWAY from the camera and toggle CSS classes on the
// scene element to `display: none` those buckets — removes them from the
// compositor entirely (vs `backface-visibility: hidden` which keeps the
// layer alive). Off-axis polygons get no class; they always render.
const DIR_CLASSES = ["px", "nx", "py", "ny", "pz", "nz"] as const;
type DirCode = (typeof DIR_CLASSES)[number];

function classifyNormal(p: Polygon): DirCode | null {
  if (p.vertices.length < 3) return null;
  const v0 = p.vertices[0], v1 = p.vertices[1], v2 = p.vertices[2];
  const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const max = Math.max(ax, ay, az);
  if (max < 1e-9) return null;
  // Axis-aligned iff the OTHER two components are ~0 relative to the
  // dominant one. Voxel faces have other == 0 exactly; curved meshes
  // (apples, characters) fall through to "always render" so they don't
  // get incorrectly bucketed and culled.
  const TOL = 0.01;
  if (ax === max && ay < ax * TOL && az < ax * TOL) return nx > 0 ? "px" : "nx";
  if (ay === max && ax < ay * TOL && az < ay * TOL) return ny > 0 ? "py" : "ny";
  if (az === max && ax < az * TOL && ay < az * TOL) return nz > 0 ? "pz" : "nz";
  return null;
}

/**
 * Return the set of direction codes whose faces point AWAY from a camera
 * at the given (rotX, rotY) — those bins get culled. Camera convention:
 *   rotY = azimuth around vertical world-Z axis (degrees)
 *   rotX = polar angle from straight-down (0 = top-down view, 90 = horizon)
 */
function cullSetFromCamera(rotX: number, rotY: number): Set<DirCode> {
  const az = ((rotY % 360) + 360) % 360 * Math.PI / 180;
  const el = Math.max(0, Math.min(180, rotX)) * Math.PI / 180;
  // Camera position unit vector: standard spherical with elevation from +Z.
  const horiz = Math.sin(el);
  const cx = horiz * Math.cos(az);
  const cy = horiz * Math.sin(az);
  const cz = Math.cos(el);
  const cull = new Set<DirCode>();
  // A face direction is BACK-facing iff dot(faceNormal, camera) < 0.
  if (cx <= 0) cull.add("px");
  if (cx >= 0) cull.add("nx");
  if (cy <= 0) cull.add("py");
  if (cy >= 0) cull.add("ny");
  if (cz <= 0) cull.add("pz");
  if (cz >= 0) cull.add("nz");
  return cull;
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
  centerWrapper.setAttribute("data-polycss-auto-center-wrapper", "");
  // Wrapper is always present so meshes append into a stable parent.
  // When autoCenter is off, transform stays empty (identity).
  sceneEl.appendChild(centerWrapper);

  host.appendChild(sceneEl);

  interface MeshEntry {
    handle: MeshHandle;
    wrapper: HTMLDivElement;
    parseResult: ParseResult;
    rendered: RenderedPoly[];
    polygons: Polygon[];
    disposed: boolean;
  }
  const meshes = new Set<MeshEntry>();

  function applySceneStyle(el: HTMLElement, opts: PolySceneOptions): void {
    el.style.position = "absolute";
    el.style.top = "50%";
    el.style.left = "50%";
    el.style.width = "0";
    el.style.height = "0";
    el.style.transformStyle = "preserve-3d";
    el.style.perspective = `${opts.perspective ?? DEFAULT_PERSPECTIVE}px`;
    el.style.transform = buildSceneTransform(opts);
    applyCullClasses(el, opts);
  }

  function applyCullClasses(el: HTMLElement, opts: PolySceneOptions): void {
    const cull = cullSetFromCamera(opts.rotX ?? DEFAULT_ROT_X, opts.rotY ?? DEFAULT_ROT_Y);
    for (const code of DIR_CLASSES) {
      el.classList.toggle(`polycss-cull-${code}`, cull.has(code));
    }
  }

  function recomputeAutoCenter(): void {
    if (!currentOptions.autoCenter) {
      centerWrapper.style.transform = "";
      return;
    }
    // Combine all live mesh polygons into a single bbox.
    const all: Polygon[] = [];
    for (const m of meshes) {
      if (!m.disposed) all.push(...m.polygons);
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
    const css = buildMeshTransform(transform);
    if (css) wrapper.style.transform = css;

    let sourcePolygons: Polygon[];
    if (currentOptions.merge === "auto") {
      sourcePolygons = mergePolygons(parseResult.polygons);
    } else if (currentOptions.merge === "slice") {
      sourcePolygons = slicePolygons(parseResult.polygons, { doc: mountDoc });
    } else {
      sourcePolygons = parseResult.polygons;
    }

    const rendered: RenderedPoly[] = [];
    for (const poly of sourcePolygons) {
      const r = renderPoly(poly, {
        directionalLight: currentOptions.directionalLight,
      });
      if (!r) continue;
      const dir = classifyNormal(poly);
      if (dir) r.element.classList.add(`polycss-dir-${dir}`);
      wrapper.appendChild(r.element);
      rendered.push(r);
    }

    centerWrapper.appendChild(wrapper);

    const entry: MeshEntry = {
      handle: undefined as unknown as MeshHandle,
      wrapper,
      parseResult,
      rendered,
      polygons: sourcePolygons,
      disposed: false,
    };

    const handle: MeshHandle = {
      polygons: sourcePolygons,
      remove() {
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        // Removing from DOM doesn't auto-dispose blob URLs — call dispose()
        // for that. But we DO drop the per-poly cleanup so a re-mount
        // doesn't leak.
        for (const r of rendered) {
          try { r.dispose(); } catch { /* ignore */ }
        }
        rendered.length = 0;
        meshes.delete(entry);
        recomputeAutoCenter();
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
        for (const r of rendered) {
          try { r.dispose(); } catch { /* ignore */ }
        }
        rendered.length = 0;
        try { parseResult.dispose(); } catch { /* ignore */ }
        meshes.delete(entry);
        recomputeAutoCenter();
      },
    };

    entry.handle = handle;
    meshes.add(entry);
    recomputeAutoCenter();
    return handle;
  }

  function setOptions(partial: Partial<PolySceneOptions>): void {
    currentOptions = { ...currentOptions, ...partial };
    applySceneStyle(sceneEl, currentOptions);
    syncInteractive();
    recomputeAutoCenter();
  }

  // ─── Pointer-drag rotation when options.interactive is true ───────────────
  // Mirrors React's useCamera drag handling: drag-X rotates around the
  // world Z (yaw / rotY), drag-Y tilts around screen X (pitch / rotX).
  // Touch + mouse via pointer events; prior listener removed on toggle so
  // setOptions({ interactive: false }) cleanly detaches.

  const POINTER_DRAG_SPEED = 4; // px per degree (lower = more sensitive)
  let activePointerId: number | null = null;
  let pointer = { x: 0, y: 0 };
  let interactiveAttached = false;

  const onPointerDown = (e: PointerEvent): void => {
    if (!currentOptions.interactive) return;
    if (activePointerId !== null) return;
    if (e.isPrimary === false) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    pointer = { x: e.clientX, y: e.clientY };
    host.style.cursor = "grabbing";
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    e.preventDefault();
    const dX = (e.clientX - pointer.x) / POINTER_DRAG_SPEED;
    const dY = (e.clientY - pointer.y) / POINTER_DRAG_SPEED;
    const rotX = Math.max(0, Math.min(100, (currentOptions.rotX ?? DEFAULT_ROT_X) - dY));
    const rotY = ((currentOptions.rotY ?? DEFAULT_ROT_Y) - dX + 360) % 360;
    currentOptions = { ...currentOptions, rotX, rotY };
    applySceneStyle(sceneEl, currentOptions);
    pointer = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    activePointerId = null;
    host.style.cursor = currentOptions.interactive ? "grab" : "";
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  // Wheel → zoom. Browsers translate trackpad pinch into wheel events with
  // ctrlKey=true, so this covers desktop scroll + Mac pinch in one path.
  // Multiplicative step gives smooth zooming across the full range.
  const ZOOM_MIN = 0.05;
  const ZOOM_MAX = 8;
  const ZOOM_STEP = 0.0015; // tuned for unit `deltaY` per wheel notch
  const onWheel = (e: WheelEvent): void => {
    if (!currentOptions.interactive) return;
    e.preventDefault();
    const current = currentOptions.zoom ?? DEFAULT_ZOOM;
    // Normalize across wheel-line / wheel-pixel modes (deltaMode 0 = px,
    // 1 = lines, 2 = pages). Lines ≈ 33 px, pages ≈ 800 px.
    const lineFactor = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
    const factor = Math.exp(-e.deltaY * lineFactor * ZOOM_STEP);
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current * factor));
    currentOptions = { ...currentOptions, zoom: next };
    applySceneStyle(sceneEl, currentOptions);
  };

  function syncInteractive(): void {
    const want = !!currentOptions.interactive;
    if (want === interactiveAttached) return;
    if (want) {
      host.addEventListener("pointerdown", onPointerDown);
      host.addEventListener("pointermove", onPointerMove);
      host.addEventListener("pointerup", onPointerUp);
      host.addEventListener("pointercancel", onPointerUp);
      // passive:false because we call preventDefault() to stop the page
      // from scrolling while the user is zooming the scene.
      host.addEventListener("wheel", onWheel, { passive: false });
      host.style.cursor = "grab";
      host.style.touchAction = "none";
      host.style.userSelect = "none";
    } else {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("wheel", onWheel);
      host.style.cursor = "";
      host.style.touchAction = "";
      host.style.userSelect = "";
    }
    interactiveAttached = want;
  }

  syncInteractive();

  function destroy(): void {
    // Detach pointer listeners before tearing down meshes.
    currentOptions = { ...currentOptions, interactive: false };
    syncInteractive();
    // Dispose all meshes (revokes blob URLs) before removing the scene.
    // Snapshot first since dispose() mutates the set.
    const snapshot = Array.from(meshes);
    for (const m of snapshot) {
      try { m.handle.dispose(); } catch { /* ignore */ }
    }
    if (sceneEl.parentNode) sceneEl.parentNode.removeChild(sceneEl);
  }

  return { add, setOptions, destroy };
}
