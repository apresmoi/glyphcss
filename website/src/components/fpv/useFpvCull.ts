/**
 * Distance-based mesh culling for FPV mode.
 *
 * In FPV the player typically only sees a small slice of a large scene,
 * so mounting every mesh's polygons (one DOM node per polygon) wastes
 * paint/layout work on geometry the player can't see. This hook
 * subscribes to PolyFirstPersonControls' `change` event, throttles
 * updates to camera moves bigger than a step threshold, and returns the
 * set of item IDs within `renderDistance` world units of the camera origin.
 *
 * Outside FPV the hook returns `null` (no culling — render everything).
 * Callers should treat null as "all items visible".
 *
 * The selected item is always included so the gizmo doesn't snap off
 * the camera while editing a distant placement.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { PolyFirstPersonControlsHandle } from "@layoutit/polycss-react";

export interface FpvCullItem {
  id: string;
  worldX: number;
  worldY: number;
}

export interface UseFpvCullOptions {
  /** Imperative handle ref for the FPV controls (exposed via `ref`
   *  on `<PolyFirstPersonControls>`). */
  controlsRef: RefObject<PolyFirstPersonControlsHandle | null>;
  /** Currently placed items — each must have a stable `id` and world
   *  XY coordinates (Z is irrelevant for floor-plane culling). */
  items: FpvCullItem[];
  /** Max render distance in world units. Items farther than this from
   *  the camera origin are excluded. */
  renderDistance: number;
  /** Only cull when this is `true` — typically when `dragMode === "fpv"`. */
  enabled: boolean;
  /** Always include this item in the visible set (the gizmo target,
   *  for example) so distant edits don't blink out from under the user. */
  alwaysIncludeId?: string | null;
  /** Recompute when the camera origin has moved this many world units
   *  since the last update. Default 2. Larger = fewer updates, more
   *  flicker risk near the boundary. */
  stepThreshold?: number;
}

export function useFpvCull({
  controlsRef,
  items,
  renderDistance,
  enabled,
  alwaysIncludeId,
  stepThreshold = 2,
}: UseFpvCullOptions): Set<string> | null {
  // null sentinel = no culling (render everything). A Set means we're in
  // FPV and the contents are the visible item IDs.
  const [visible, setVisible] = useState<Set<string> | null>(null);

  // Items + alwaysIncludeId via ref so the change listener (attached
  // once per FPV engagement) always reads the latest without re-binding
  // and losing the throttle baseline on every render.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const alwaysIncludeRef = useRef(alwaysIncludeId);
  alwaysIncludeRef.current = alwaysIncludeId;

  useEffect(() => {
    if (!enabled) {
      setVisible(null);
      return;
    }
    const ctrl = controlsRef.current;
    if (!ctrl) {
      setVisible(null);
      return;
    }

    const r2 = renderDistance * renderDistance;
    const stepSq = stepThreshold * stepThreshold;
    let lastOrigin = ctrl.getOrigin();

    const compute = (): Set<string> => {
      const [ox, oy] = lastOrigin;
      const next = new Set<string>();
      for (const it of itemsRef.current) {
        const dx = it.worldX - ox;
        const dy = it.worldY - oy;
        if (dx * dx + dy * dy <= r2) next.add(it.id);
      }
      const pinned = alwaysIncludeRef.current;
      if (pinned) next.add(pinned);
      return next;
    };

    setVisible(compute());

    const onChange = (): void => {
      const origin = ctrl.getOrigin();
      const dx = origin[0] - lastOrigin[0];
      const dy = origin[1] - lastOrigin[1];
      if (dx * dx + dy * dy < stepSq) return;
      lastOrigin = origin;
      setVisible(compute());
    };
    ctrl.addEventListener("change", onChange);
    return () => {
      ctrl.removeEventListener("change", onChange);
    };
  }, [controlsRef, enabled, renderDistance, stepThreshold]);

  // Re-run compute when items change (placement add/remove/drag) so
  // the visible set stays accurate without waiting for the next camera
  // move. We keep the same baseline `lastOrigin` (held inside the effect
  // closure above) by reading the controls' current origin directly.
  useEffect(() => {
    if (!enabled) return;
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const [ox, oy] = ctrl.getOrigin();
    const r2 = renderDistance * renderDistance;
    const next = new Set<string>();
    for (const it of items) {
      const dx = it.worldX - ox;
      const dy = it.worldY - oy;
      if (dx * dx + dy * dy <= r2) next.add(it.id);
    }
    if (alwaysIncludeId) next.add(alwaysIncludeId);
    setVisible(next);
  }, [controlsRef, enabled, items, renderDistance, alwaysIncludeId]);

  return visible;
}
