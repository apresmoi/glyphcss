/**
 * Pointer event API for `<PolyMesh>` (Vue). Mirrors @react-three/fiber's
 * mesh event surface (handler names + payload shape) so devs migrating
 * from three.js use the same mental model. polycss is DOM-native so
 * we get native pointer events for free — no raycaster, no canvas
 * event synthesis.
 *
 * Diverges from r3f in two intentional ways:
 *   1. Bubbling matches DOM (pointer hits the front element only).
 *   2. `face`, `uv`, `uv1`, `instanceId` are omitted — three.js
 *      BufferGeometry / InstancedMesh concepts with no polycss
 *      analogue.
 */
import type { Polygon, Vec3 } from "@layoutit/polycss-core";

/** Imperative handle exposed by `<PolyMesh>` via Vue's defineExpose.
 *  Read-only view of the mesh's element + current transform +
 *  polygons. Mutation flows through controlled props (parent owns
 *  transform state). */
export interface PolyMeshHandle {
  readonly element: HTMLDivElement | null;
  readonly id?: string;
  getPosition(): Vec3 | undefined;
  getRotation(): Vec3 | undefined;
  getScale(): number | Vec3 | undefined;
  getPolygons(): Polygon[];
  /**
   * Update a single polygon in place. `target` is either a polygon
   * reference (as returned by `getPolygons()`) or its index. `partial`
   * fields are merged onto the polygon; the mesh is then re-rendered.
   * Skips the merge pass, so this is cheaper than replacing the
   * `polygons` prop for targeted edits like color picker updates from
   * an inspector UI. Silently no-ops if `target` isn't found.
   */
  updatePolygon(target: Polygon | number, partial: Partial<Polygon>): void;
  /**
   * Re-rasterize the baked texture atlas using the mesh's current rotation.
   *
   * Call this after a rotation gesture completes (e.g. on rotate-ring pointer
   * release) to correct stale lighting. Baked atlas tiles encode
   * `baseColor × Lambert(worldNormal, worldLight)` at bake time. When the
   * mesh wrapper rotates via CSS, the polygon normals change in world space
   * but the pre-multiplied colors don't — faces stay lit/unlit incorrectly.
   *
   * `rebakeAtlas()` advances the internal `bakedRotation` snapshot to the
   * current `rotation` prop and re-runs the atlas pipeline, this time
   * inverse-rotating the world light into the mesh-local frame so that
   * `dot(localNormal, localLight) === dot(worldNormal, worldLight)` holds.
   *
   * In `textureLighting === "dynamic"` mode this is a no-op: dynamic
   * shading is computed per-frame from live surface-normal CSS vars, so it
   * is always correct and never needs rebaking.
   */
  rebakeAtlas(): void;
}

export interface PolyPointerEvent<E extends Event = PointerEvent> {
  object: PolyMeshHandle;
  eventObject: PolyMeshHandle;
  intersections: Array<{ object: PolyMeshHandle }>;
  pointer: { x: number; y: number };
  delta: number;
  nativeEvent: E;
  stopPropagation(): void;
}

export type PolyMouseEvent = PolyPointerEvent<MouseEvent>;
export type PolyWheelEvent = PolyPointerEvent<WheelEvent>;

export type PolyEventHandler<E extends Event = PointerEvent> = (
  event: PolyPointerEvent<E>,
) => void;

/** Pointer / mouse / wheel handlers accepted by `<PolyMesh>`. Same
 *  names as r3f. Provide any handler to opt in to events. */
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

export function findPolyMeshHandle(el: Element | null): PolyMeshHandle | null {
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
// behind it. The JS bbox hit-test bypasses the clip.

export function pointInMeshElement(
  meshEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const polys = Array.from(meshEl.querySelectorAll("i,b,s,u")) as HTMLElement[];
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
    const handle = findPolyMeshHandle(meshEl);
    if (!handle) continue;
    if (pointInMeshElement(meshEl, clientX, clientY)) return handle;
  }
  return null;
}
