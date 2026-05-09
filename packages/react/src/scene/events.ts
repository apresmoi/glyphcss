/**
 * Pointer event API for <PolyMesh>. Mirrors @react-three/fiber's mesh
 * event surface (handler names + payload shape) so devs migrating from
 * three.js use the same mental model. polycss is DOM-native so we get
 * native pointer events for free — no raycaster, no canvas event
 * synthesis.
 *
 * Diverges from r3f in two intentional ways:
 *   1. Bubbling matches DOM (pointer hits the front element only). r3f
 *      replays events to occluded objects behind the front hit; doing
 *      that here would require running our own raycaster, which defeats
 *      the point of being DOM-native.
 *   2. `face`, `uv`, `uv1`, `instanceId` are omitted — they're three.js
 *      BufferGeometry / InstancedMesh concepts with no polycss analogue.
 *      The polycss-native equivalent of `face` is the hit polygon's
 *      index, exposed via `polygon` (set when the underlying DOM target
 *      is an `<i>` polygon element).
 */
import type { Polygon, Vec3 } from "@polycss/core";

/**
 * Imperative handle exposed by `<PolyMesh ref>`. Read-only view of the
 * mesh's element + current transform + polygons. Mutation flows through
 * controlled props (parent owns transform state) — matches three.js
 * editor's pattern of keeping `selected` external to the object.
 */
export interface PolyMeshHandle {
  /** The `.polycss-mesh` wrapper div (null until mounted). */
  readonly element: HTMLDivElement | null;
  /** Identifier passed via the `id` prop, if any. */
  readonly id?: string;
  /** Current `position` prop value. */
  getPosition(): Vec3 | undefined;
  /** Current `rotation` prop value (Euler degrees). */
  getRotation(): Vec3 | undefined;
  /** Current `scale` prop value. */
  getScale(): number | Vec3 | undefined;
  /** Polygons currently being rendered (post-autoCenter). */
  getPolygons(): Polygon[];
  /**
   * Snapshot the current `rotation` prop as the new "baked rotation" and
   * trigger an atlas re-rasterization with the directional light
   * inverse-rotated into the mesh's local frame.
   *
   * Call this after a rotate-mode drag ends (i.e. on pointer release) —
   * **not** on every pointermove during the drag. The visual wrapper already
   * follows the live `rotation` prop smoothly; the atlas only needs to
   * update once per committed rotation so it doesn't re-bake every frame.
   *
   * Math rationale: baked atlas tiles encode `baseColor × Lambert(worldNormal,
   * worldLight)`. When the mesh wrapper rotates via CSS the world-space normal
   * changes but the baked color does not, causing stale shading. Calling
   * `rebakeAtlas()` inverse-rotates the world light into the mesh-local frame
   * before re-running the atlas baker, so `dot(localNormal, localLight) ===
   * dot(worldNormal, worldLight)` and the shading is correct again.
   *
   * In dynamic (`textureLighting="dynamic"`) mode this call is a no-op for
   * shading purposes (dynamic mode re-evaluates per frame), but it is still
   * safe to call.
   */
  rebakeAtlas(): void;
}

/**
 * Pointer event payload delivered to <PolyMesh> handlers. Mirrors r3f's
 * shape, minus raycaster-specific fields. See module docstring for the
 * intentional divergences.
 */
export interface PolyPointerEvent<E extends Event = PointerEvent> {
  /** The mesh originally under the pointer (deepest hit). */
  object: PolyMeshHandle;
  /** The mesh whose handler is being invoked. Equal to `object` until
   *  ancestor bubbling is added (out of scope for v1). */
  eventObject: PolyMeshHandle;
  /** All meshes stacked under the pointer this moment, front-to-back.
   *  Computed via `document.elementsFromPoint` then filtered to
   *  registered `.polycss-mesh` ancestors. */
  intersections: Array<{ object: PolyMeshHandle }>;
  /** Pointer position in normalized device coords [-1, 1] relative to
   *  the camera viewport. (0,0) = viewport center. Falls back to (0,0)
   *  when the mesh is rendered outside a `<PolyCamera>`. */
  pointer: { x: number; y: number };
  /** Pixel distance from the most recent `pointerdown` to this event.
   *  0 on pointerdown itself. Use to discriminate click-vs-drag. */
  delta: number;
  /** The underlying DOM event. */
  nativeEvent: E;
  /** Stops native bubbling. (Equivalent to `nativeEvent.stopPropagation()`
   *  today; reserved for future r3f-style bubbling above the wrapper.) */
  stopPropagation(): void;
}

export type PolyMouseEvent = PolyPointerEvent<MouseEvent>;
export type PolyWheelEvent = PolyPointerEvent<WheelEvent>;

export type PolyEventHandler<E extends Event = PointerEvent> = (
  event: PolyPointerEvent<E>,
) => void;

/**
 * Pointer / mouse / wheel handlers accepted by `<PolyMesh>`. Names mirror
 * r3f exactly. Provide any handler to opt the mesh into receiving events;
 * absent handlers add zero overhead.
 */
export interface InteractionProps {
  onClick?: PolyEventHandler<MouseEvent>;
  onContextMenu?: PolyEventHandler<MouseEvent>;
  onDoubleClick?: PolyEventHandler<MouseEvent>;
  onWheel?: PolyEventHandler<WheelEvent>;
  onPointerDown?: PolyEventHandler<PointerEvent>;
  onPointerUp?: PolyEventHandler<PointerEvent>;
  onPointerMove?: PolyEventHandler<PointerEvent>;
  onPointerOver?: PolyEventHandler<PointerEvent>;
  onPointerOut?: PolyEventHandler<PointerEvent>;
  onPointerEnter?: PolyEventHandler<PointerEvent>;
  onPointerLeave?: PolyEventHandler<PointerEvent>;
  onPointerCancel?: PolyEventHandler<PointerEvent>;
}

// ── Mesh element registry ────────────────────────────────────────────────
// Maps `.polycss-mesh` DOM elements to their PolyMeshHandle so consumers
// (intersections list, <Select> click delegation, <TransformControls>)
// can resolve a DOM hit back to the owning mesh.

const MESH_REGISTRY = new WeakMap<HTMLElement, PolyMeshHandle>();

export function registerMeshElement(
  el: HTMLElement,
  handle: PolyMeshHandle,
): void {
  MESH_REGISTRY.set(el, handle);
}

export function unregisterMeshElement(el: HTMLElement): void {
  MESH_REGISTRY.delete(el);
}

/** Walk up from `el` looking for the nearest registered mesh wrapper. */
export function findMeshHandle(el: Element | null): PolyMeshHandle | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur instanceof HTMLElement) {
      const h = MESH_REGISTRY.get(cur);
      if (h) return h;
    }
    cur = cur.parentElement;
  }
  return null;
}

// ── JS bounding-rect hit-testing ────────────────────────────────────────
// polycss polygons render via the CSS `border-shape` property, which
// (in current Chromium) clips both paint AND native hit-testing to the
// visible polygon shape — so a click on a transparent corner of an
// `<i>` rectangle frequently falls through to whichever element is
// behind it. That breaks any handler that expects clicks on the
// rendered mesh to bubble through the mesh element.
//
// The workaround is a manual hit-test that ignores `border-shape`:
// each polygon's `<i>` has a real post-3D `getBoundingClientRect`, and
// rectangle membership is enough for "did the user click on this
// mesh / arrow" — we don't need true polygon-edge precision.
//
// Used by both <Select> (to resolve a click target back to the chosen
// mesh) and <TransformControls> (to know which axis arrow was hit
// when the click fell through). DRY: one place defines the rules.

/** Test whether `(clientX, clientY)` falls inside any `<i>` polygon
 *  child of `meshEl`'s post-3D bounding rect. Skips zero-area rects
 *  (happy-dom and pre-layout SSR return those). */
export function pointInMeshElement(
  meshEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const polys = Array.from(meshEl.querySelectorAll("i")) as HTMLElement[];
  for (const p of polys) {
    const r = p.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return true;
    }
  }
  return false;
}

/** Walk every registered `.polycss-mesh` in the document and return
 *  the first whose polygon bounding-rects contain `(clientX, clientY)`.
 *  An optional `filter` skips matched mesh elements (e.g. gizmos). */
export function findMeshUnderPoint(
  clientX: number,
  clientY: number,
  filter?: (meshEl: HTMLElement) => boolean,
): PolyMeshHandle | null {
  if (typeof document === "undefined") return null;
  const meshEls = Array.from(
    document.querySelectorAll(".polycss-mesh"),
  ) as HTMLElement[];
  for (const meshEl of meshEls) {
    if (filter && !filter(meshEl)) continue;
    const handle = findMeshHandle(meshEl);
    if (!handle) continue;
    if (pointInMeshElement(meshEl, clientX, clientY)) return handle;
  }
  return null;
}
